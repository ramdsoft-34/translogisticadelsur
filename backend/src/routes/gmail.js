// Fase 14: módulo Correo — el Gmail de cada usuario dentro de la plataforma.
// /oauth/callback es la única ruta sin sesión (la llama Google); la valida el estado firmado.
// Todo lo demás exige sesión y ver viajes (para adjuntar sus documentos). Cada usuario solo ve su propio buzón.
import express, { Router } from 'express';
import { z } from 'zod';
import { Empresa, Viaje } from '../models/index.js';
import { CuentaGmail } from '../models/gmail.js';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { env } from '../config/env.js';
import { auditar } from '../services/auditoria.js';
import * as G from '../services/gmail.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from '../services/reportes/manifiesto.js';
import { datosRemesa, remesaPdf, nombreRemesa } from '../services/reportes/remesa.js';

const r = Router();
const idGmail = (v) => { if (!/^[a-zA-Z0-9_-]{6,64}$/.test(String(v))) throw new ErrorHttp(400, 'Identificador inválido'); return String(v); };
const idMongo = z.string().regex(/^[a-f0-9]{24}$/i);

// ── Regreso desde Google (sin sesión) ──
r.get('/oauth/callback', async (req, res) => {
  const volver = (q) => res.redirect(`${env.urlPublica}/correo?${q}`);
  if (req.query.error) return volver('gmail=cancelado');
  try { await G.completarConexion(req.query.code, req.query.state); volver('gmail=conectado'); }
  catch (e) { volver(`gmail=error&motivo=${encodeURIComponent(String(e.message || 'Error').slice(0, 160))}`); }
});

r.use(autenticar, soloEmpresa, permitir(P.VIAJES_VER));

r.get('/estado', async (req, res) => {
  const c = await CuentaGmail.findOne({ empresa: req.empresaId, usuario: req.usuario._id }).lean();
  res.json({ configurado: G.configurado(), conectado: !!c && !c.error, email: c?.email || '', error: c?.error || '', conectadoEn: c?.conectadoEn || null,
    nombre: c?.nombre || req.usuario.nombre || '', firma: { texto: c?.firma?.texto || '', logo: c?.firma?.logo?.datos ? `data:${c.firma.logo.tipo};base64,${c.firma.logo.datos}` : '',
      enRespuestas: c?.firma?.enRespuestas ?? true } });
});

// Nombre en «De» y firma, como en la configuración de Gmail. El logo solo PNG o JPEG (un SVG podría llevar código).
r.put('/firma', express.json({ limit: '400kb' }), async (req, res) => {
  const d = z.object({ nombre: z.string().trim().max(80), texto: z.string().max(1500), enRespuestas: z.boolean().default(true),
    logo: z.string().max(300_000).regex(/^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$/, 'El logo debe ser PNG o JPEG').optional() }).parse(req.body);
  const set = { nombre: d.nombre, 'firma.texto': d.texto, 'firma.enRespuestas': d.enRespuestas };
  if (d.logo !== undefined) { const m = d.logo.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/); set['firma.logo'] = m ? { tipo: m[1], datos: m[2] } : { tipo: '', datos: '' }; }
  const r2 = await CuentaGmail.updateOne({ empresa: req.empresaId, usuario: req.usuario._id }, { $set: set });
  if (!r2.matchedCount) throw new ErrorHttp(409, 'Conecte su Gmail primero');
  res.status(204).end();
});

r.post('/conectar', async (req, res) => res.json({ url: G.urlAutorizacion(req.usuario._id, req.empresaId, req.usuario.email) }));

r.delete('/cuenta', async (req, res) => {
  await G.desconectar(req);
  await auditar(req, 'gmail_desconectar', { detalle: {} });
  res.status(204).end();
});

// Carpetas y etiquetas con sus contadores
// Pospuestos no es una etiqueta de la API: se busca con in:snoozed (igual que la barra de Gmail)
const SISTEMA = [['INBOX', 'Recibidos'], ['STARRED', 'Destacados'], ['SNOOZED', 'Pospuestos'], ['IMPORTANT', 'Importantes'], ['SENT', 'Enviados'], ['DRAFT', 'Borradores'], ['SPAM', 'Spam'], ['TRASH', 'Papelera']];
r.get('/etiquetas', async (req, res) => {
  const c = await G.cuentaDe(req);
  const { labels = [] } = await G.gmail(c, '/labels');
  const propias = labels.filter((l) => l.type === 'user').slice(0, 30);
  const det = await Promise.all([...SISTEMA.filter(([id]) => id !== 'SNOOZED').map(([id]) => ({ id })), ...propias].map((l) => G.gmail(c, `/labels/${encodeURIComponent(l.id)}`).catch(() => null)));
  const de = new Map(det.filter(Boolean).map((l) => [l.id, l]));
  res.json({
    sistema: SISTEMA.map(([id, nombre]) => ({ id, nombre, noLeidos: de.get(id)?.threadsUnread ?? 0, total: de.get(id)?.threadsTotal ?? 0 })),
    propias: propias.map((l) => ({ id: l.id, nombre: l.name, color: l.color?.backgroundColor || '', noLeidos: de.get(l.id)?.threadsUnread ?? 0 })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  });
});

// Lista de conversaciones (25 por página) con sus vínculos a viajes, manifiestos y clientes
r.get('/hilos', async (req, res) => {
  const q = z.object({ etiqueta: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('INBOX'), q: z.string().trim().max(200).default(''),
    pagina: z.string().max(200).default(''), filtro: z.string().max(40).default(''), fecha: z.enum(['', '1d', '7d', '30d', '6m', '1y']).default('') }).parse(req.query);
  const c = await G.cuentaDe(req);
  const f = new Set(q.filtro.split(',').filter(Boolean));   // chips combinables: no_leidos, adjuntos
  const busqueda = [q.q, q.etiqueta === 'SNOOZED' ? 'in:snoozed' : '', f.has('no_leidos') ? 'is:unread' : '', f.has('adjuntos') ? 'has:attachment' : '',
    q.fecha ? `newer_than:${q.fecha}` : ''].filter(Boolean).join(' ');
  const p = new URLSearchParams({ maxResults: '25', ...(q.etiqueta !== 'SNOOZED' ? { labelIds: q.etiqueta } : {}), ...(busqueda ? { q: busqueda } : {}), ...(q.pagina ? { pageToken: q.pagina } : {}) });
  const l = await G.gmail(c, `/threads?${p}`);
  const hilos = await Promise.all((l.threads || []).map((t) => G.gmail(c, `/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`).catch(() => null)));
  const items = hilos.filter(Boolean).map((h) => {
    const ult = G.resumenMensaje(h.messages.at(-1)); const pri = G.resumenMensaje(h.messages[0]);
    const participantes = [...new Set(h.messages.map((m) => G.persona(G.cabecera(m.payload?.headers, 'From')).nombre.split(' ')[0]))];
    return { id: h.id, asunto: pri.asunto, de: ult.de, participantes, mensajes: h.messages.length, fecha: ult.fecha, extracto: ult.extracto,
      noLeido: h.messages.some((m) => (m.labelIds || []).includes('UNREAD')), conAdjuntos: h.messages.some((m) => G.resumenMensaje(m).conAdjuntos),
      destacado: h.messages.some((m) => (m.labelIds || []).includes('STARRED')) };
  });
  res.json({ items: await G.vincular(req.empresaId, items), siguiente: l.nextPageToken || '', estimado: l.resultSizeEstimate || 0 });
});

r.get('/hilos/:id', async (req, res) => {
  const c = await G.cuentaDe(req);
  const h = await G.gmail(c, `/threads/${idGmail(req.params.id)}?format=full`);
  const mensajes = h.messages.map((m) => ({ ...G.resumenMensaje(m), ...G.partes(m.payload) }));
  const [v] = await G.vincular(req.empresaId, [{ asunto: mensajes[0].asunto, extracto: mensajes.map((m) => m.extracto).join(' '), de: mensajes[0].de }]);
  res.json({ id: h.id, asunto: mensajes[0].asunto, mensajes, vinculos: v.vinculos });
});

r.post('/hilos/:id/leido', async (req, res) => {
  const c = await G.cuentaDe(req);
  await G.gmail(c, `/threads/${idGmail(req.params.id)}/modify`, { metodo: 'POST', cuerpo: { removeLabelIds: ['UNREAD'] } });
  res.status(204).end();
});

// Destacar (estrella) y mover a la papelera (se puede recuperar desde Papelera, como en Gmail)
r.post('/hilos/:id/destacar', express.json(), async (req, res) => {
  const c = await G.cuentaDe(req); const si = req.body?.si !== false;
  await G.gmail(c, `/threads/${idGmail(req.params.id)}/modify`, { metodo: 'POST', cuerpo: si ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] } });
  res.status(204).end();
});
r.post('/hilos/:id/papelera', async (req, res) => {
  const c = await G.cuentaDe(req);
  await G.gmail(c, `/threads/${idGmail(req.params.id)}/trash`, { metodo: 'POST' });
  res.status(204).end();
});

// Descarga del adjunto. La vista previa la arma la página con un blob (PDF e imágenes), sin servirlo como página de este sitio.
r.get('/mensajes/:id/adjuntos/:adj', async (req, res) => {
  const c = await G.cuentaDe(req);
  const a = await G.gmail(c, `/messages/${idGmail(req.params.id)}/attachments/${encodeURIComponent(String(req.params.adj).slice(0, 2000))}`);
  const nombre = String(req.query.nombre || 'adjunto').replace(/[^\w.\- ]/g, '_').slice(0, 120);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(a.data, 'base64url'));
});

// Documentos de la plataforma que se pueden adjuntar: viajes por número, placa o manifiesto
r.get('/documentos', async (req, res) => {
  const q = z.string().trim().max(40).parse(req.query.q || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const f = { empresa: req.empresaId, estado: { $ne: 'anulado' } };
  if (q) f.$or = [{ placa: q }, { 'manifiesto.numero': q.replace(/^M/, '') }, ...(/^\d+$/.test(q) ? [{ numero: Number(q) }] : [])];
  const l = await Viaje.find(f).sort({ fecha: -1 }).limit(15).select('numero placa fecha destino manifiesto.numero remesa.numero').lean();
  res.json(l.map((v) => ({ viaje: v._id, numero: v.numero, placa: v.placa, fecha: v.fecha, destino: v.destino,
    documentos: [v.manifiesto?.numero && { tipo: 'manifiesto', texto: `Manifiesto ${v.manifiesto.numero}` }, v.remesa?.numero && { tipo: 'remesa', texto: `Remesa ${v.remesa.numero}` }].filter(Boolean) })));
});

// Enviar o responder. Adjuntos: archivos del computador (base64) y documentos de la plataforma (se generan aquí)
const correos = z.string().trim().max(1000).refine((v) => v.split(',').map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x.replace(/^.*<([^>]+)>$/, '$1'))), 'Revise los correos de los destinatarios');
r.post('/enviar', express.json({ limit: '30mb' }), async (req, res) => {
  const d = z.object({
    para: correos.refine((v) => v.trim(), 'Escriba al menos un destinatario'), cc: correos.optional().default(''), cco: correos.optional().default(''),
    asunto: z.string().trim().max(250), texto: z.string().max(50000), html: z.string().max(400_000).optional().default(''), hilo: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/).optional(),
    enRespuestaA: z.string().max(500).optional().default(''), referencias: z.string().max(4000).optional().default(''),
    adjuntos: z.array(z.object({ nombre: z.string().max(150), tipo: z.string().max(120), datos: z.string().max(20_000_000) })).max(10).default([]),
    documentos: z.array(z.object({ tipo: z.enum(['manifiesto', 'remesa']), viaje: idMongo })).max(10).default([]),
  }).parse(req.body);
  const c = await G.cuentaDe(req);
  const conFirma = await CuentaGmail.findOne({ _id: c._id, empresa: req.empresaId }).select('nombre firma').lean();
  const empresa = await Empresa.findById(req.empresaId).lean();
  const adjuntos = d.adjuntos.map((a) => ({ nombre: a.nombre, tipo: a.tipo, datos: Buffer.from(a.datos, 'base64') }));
  for (const doc of d.documentos) {
    if (doc.tipo === 'manifiesto') { const x = await datosManifiesto(empresa, doc.viaje); adjuntos.push({ nombre: nombreArchivo(x), tipo: 'application/pdf', datos: await manifiestoPdf(x) }); }
    else { const x = await datosRemesa(empresa, doc.viaje); adjuntos.push({ nombre: nombreRemesa(x), tipo: 'application/pdf', datos: await remesaPdf(x) }); }
  }
  if (adjuntos.reduce((s, a) => s + a.datos.length, 0) > 24 * 1024 * 1024) throw new ErrorHttp(400, 'Los adjuntos pasan de 24 MB, el límite de Gmail');
  const raw = G.mime({ de: G.remitente(conFirma?.nombre || req.usuario.nombre, c.email), para: d.para, cc: d.cc, cco: d.cco, asunto: d.asunto, texto: d.texto,
    html: d.html, logo: conFirma?.firma?.logo, enRespuestaA: d.enRespuestaA, referencias: d.referencias, adjuntos });
  const m = await G.gmail(c, '/messages/send', { metodo: 'POST', cuerpo: { raw, ...(d.hilo ? { threadId: d.hilo } : {}) } });
  await auditar(req, 'gmail_enviar', { detalle: { para: d.para.slice(0, 300), cc: d.cc.slice(0, 300), cco: d.cco ? 'sí' : '', asunto: d.asunto.slice(0, 200), adjuntos: adjuntos.map((a) => a.nombre), respuesta: !!d.hilo } });
  res.status(201).json({ id: m.id, hilo: m.threadId });
});

export default r;
