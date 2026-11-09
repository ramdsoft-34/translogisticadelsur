// WhatsApp Business: cuenta de cada empresa, manifiestos al conductor y avisos de estado de Meta.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa, EnvioWhatsapp, MensajeWhatsapp, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { env } from '../config/env.js';
import { auditar } from '../services/auditoria.js';
import { cifrar, descifrar } from '../utils/cifrado.js';
import { RESPUESTA_BASE, aprobarEnvios, cuentaPlataforma, descartarEnvios, firmaValida, plataformaLista, prepararEnvio, probarCuenta, procesarEnvio, registrarEstados, registrarEstadosPlataforma } from '../services/whatsappBusiness.js';

const r = Router();
const id = (v) => { if (!mongoose.isValidObjectId(v)) throw new ErrorHttp(400, 'Identificador inválido'); return v; };

// ── Avisos de Meta (públicos): cada cuenta tiene su dirección, su token y su firma ──
r.get('/webhook', async (req, res) => {
  const p = await cuentaPlataforma();
  if (req.query['hub.mode'] !== 'subscribe' || !p?.webhookToken || req.query['hub.verify_token'] !== p.webhookToken) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

r.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const p = await cuentaPlataforma();
  const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!firmaValida(cuerpo, req.get('x-hub-signature-256'), p?.appSecretCifrado ? descifrar(p.appSecretCifrado) : '')) return res.sendStatus(403);
  let datos;
  try { datos = JSON.parse(cuerpo.toString('utf8')); } catch { return res.sendStatus(400); }
  await registrarEstadosPlataforma(datos);
  res.sendStatus(200);
});

const cuentaWebhook = async (empresaId) => (mongoose.isValidObjectId(empresaId)
  ? Empresa.findById(empresaId).select('+whatsapp.webhookToken +whatsapp.appSecretCifrado').lean() : null);

r.get('/webhook/:empresa', async (req, res) => {
  const e = await cuentaWebhook(req.params.empresa);
  const token = e?.whatsapp?.webhookToken;
  if (req.query['hub.mode'] !== 'subscribe' || !token || req.query['hub.verify_token'] !== token) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

r.post('/webhook/:empresa', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const e = await cuentaWebhook(req.params.empresa);
  const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const secreto = e?.whatsapp?.appSecretCifrado ? descifrar(e.whatsapp.appSecretCifrado) : '';
  if (!firmaValida(cuerpo, req.get('x-hub-signature-256'), secreto)) return res.sendStatus(403);
  let datos;
  try { datos = JSON.parse(cuerpo.toString('utf8')); } catch { return res.sendStatus(400); }
  req.empresaId = e._id;      // la pantalla de Manifiestos se actualiza en vivo
  await registrarEstados(e._id, datos);
  res.sendStatus(200);
});

r.use(autenticar, soloEmpresa);
const gestionar = permitir(P.CONFIG_GESTIONAR);
const operar = permitir(P.RNDC_OPERAR, P.CONFIG_GESTIONAR);

export const datosCuenta = {
  phoneNumberId: z.string().trim().regex(/^\d*$/, 'el identificador del número solo lleva dígitos').max(30),
  wabaId: z.string().trim().regex(/^\d*$/, 'el identificador de la cuenta solo lleva dígitos').max(30).optional().default(''),
  plantilla: z.string().trim().regex(/^[a-z0-9_]+$/, 'la plantilla solo lleva minúsculas, números y guion bajo').max(100),
  idioma: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'idioma inválido').max(5),
  token: z.string().trim().max(1000).optional(), appSecret: z.string().trim().max(200).optional(),
  // Respuesta automática a quien le escribe al número
  respuesta: z.object({ activa: z.boolean().default(true), texto: z.string().trim().max(1000).optional().default('') }).optional(),
};

// Cuenta de una empresa: la usan su administrador y el SuperAdmin, cada una con sus datos aparte
export async function datosCuentaEmpresa(empresaId) {
  const e = await Empresa.findById(empresaId).select('+whatsapp.tokenCifrado +whatsapp.appSecretCifrado +whatsapp.webhookToken').lean();
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  const { tokenCifrado, appSecretCifrado, webhookToken, ...w } = e.whatsapp || {};
  return { modo: 'plataforma', plantilla: 'manifiesto_conductor', idioma: 'es', ...w, respuesta: { activa: w.respuesta?.activa !== false, texto: w.respuesta?.texto || '' }, respuestaBase: RESPUESTA_BASE, plataformaLista: plataformaLista(await cuentaPlataforma()), tieneToken: !!tokenCifrado, tieneSecreto: !!appSecretCifrado,
    webhookToken: webhookToken || '', webhookUrl: `${env.urlPublica}/api/whatsapp/webhook/${empresaId}` };
}

export const cuentaEmpresaSchema = z.object({ activo: z.boolean(), modo: z.enum(['plataforma', 'propia']).default('plataforma'), ...datosCuenta });

export async function guardarCuentaEmpresa(empresaId, d) {
  const antes = await Empresa.findById(empresaId).select('+whatsapp.tokenCifrado +whatsapp.appSecretCifrado +whatsapp.webhookToken').lean();
  if (!antes) throw new ErrorHttp(404, 'Empresa no encontrada');
  if (d.activo && d.modo === 'plataforma' && !plataformaLista(await cuentaPlataforma())) {
    throw new ErrorHttp(400, 'La cuenta de WhatsApp de Translogística todavía no está disponible. Puede registrar un número propio o activarlo más adelante.');
  }
  if (d.activo && d.modo === 'propia' && (!d.phoneNumberId || !(d.token || antes.whatsapp?.tokenCifrado) || !(d.appSecret || antes.whatsapp?.appSecretCifrado))) {
    throw new ErrorHttp(400, 'Para activar WhatsApp indique el identificador del número, el token y el secreto de la app');
  }
  const set = { 'whatsapp.activo': d.activo, 'whatsapp.modo': d.modo, 'whatsapp.phoneNumberId': d.phoneNumberId, 'whatsapp.wabaId': d.wabaId, 'whatsapp.plantilla': d.plantilla, 'whatsapp.idioma': d.idioma };
  if (d.respuesta) { set['whatsapp.respuesta.activa'] = d.respuesta.activa; set['whatsapp.respuesta.texto'] = d.respuesta.texto || ''; }
  if (d.token) set['whatsapp.tokenCifrado'] = cifrar(d.token);           // vacío = conservar el actual
  if (d.appSecret) set['whatsapp.appSecretCifrado'] = cifrar(d.appSecret);
  if (!antes.whatsapp?.webhookToken) set['whatsapp.webhookToken'] = crypto.randomBytes(24).toString('hex');
  await Empresa.updateOne({ _id: empresaId }, { $set: set });
  return { activo: d.activo, modo: d.modo, phoneNumberId: d.phoneNumberId, plantilla: d.plantilla, tokenCambiado: !!d.token, secretoCambiado: !!d.appSecret };
}

// ── Cuenta de la empresa ─────────────────────────────────────────────────────
r.get('/config', gestionar, async (req, res) => res.json(await datosCuentaEmpresa(req.empresaId)));

r.put('/config', gestionar, async (req, res) => {
  const detalle = await guardarCuentaEmpresa(req.empresaId, cuentaEmpresaSchema.parse(req.body));
  await auditar(req, 'editar_config_whatsapp', { entidad: 'Empresa', entidadId: req.empresaId, detalle });
  res.json({ ok: true });
});

r.post('/config/probar', gestionar, async (req, res) => {
  try {
    const x = await probarCuenta(req.empresaId);
    await auditar(req, 'probar_whatsapp', { detalle: { numero: x.numero } });
    res.json(x);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Envíos ───────────────────────────────────────────────────────────────────
r.get('/estado', operar, async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('whatsapp.activo').lean();
  res.json({ activo: !!e?.whatsapp?.activo });
});

r.get('/envios', operar, async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.viajes) f.viaje = { $in: String(req.query.viajes).split(',').filter(x => mongoose.isValidObjectId(x)).slice(0, 1000) };
  if (req.query.estado) f.estado = String(req.query.estado);
  res.json(await EnvioWhatsapp.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limite) || 300, 1000)).lean());
});

// Mensajes de WhatsApp de la empresa en un periodo: cada envío con su conductor, documento y horas
// (enviado, entregado, leído). Los estados los avisa Meta por el webhook, sin costo.
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha inválida');
const ENVIADOS = ['enviado', 'entregado', 'leido'];
r.get('/mensajes', operar, async (req, res) => {
  const q = z.object({ desde: fechaIso, hasta: fechaIso, estado: z.string().max(20).optional().default(''), texto: z.string().trim().max(60).optional().default('') }).parse(req.query);
  const desde = new Date(`${q.desde}T05:00:00.000Z`);             // medianoche en Colombia
  const hasta = new Date(`${q.hasta}T05:00:00.000Z`); hasta.setUTCDate(hasta.getUTCDate() + 1);
  if (!(hasta > desde)) throw new ErrorHttp(400, 'El rango de fechas no es válido');
  // Solo lo que alguien mandó a enviar: lo «por aprobar» (nadie pulsó Enviar) y lo descartado no aparece.
  // La fecha es la del envío (o la del último intento si falló antes de salir).
  const rango = { $gte: desde, $lt: hasta };
  const lista = await EnvioWhatsapp.find(deEmpresa(req, { estado: { $nin: ['por_aprobar', 'descartado'] },
    $or: [{ enviadoEn: rango }, { enviadoEn: null, updatedAt: rango }] })).sort({ updatedAt: -1 }).limit(3000)
    .populate([pob(req.empresaId, 'viaje', 'numero placa destino fecha'), pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId')]).lean();
  const cuenta = (f) => lista.filter(f).length;
  const totales = { total: lista.length, enviados: cuenta(x => ENVIADOS.includes(x.estado)),
    entregados: cuenta(x => ['entregado', 'leido'].includes(x.estado)), leidos: cuenta(x => x.estado === 'leido'), errores: cuenta(x => x.estado === 'error') };
  const nombreDe = (t) => [t?.nombres, t?.apellido1, t?.apellido2].filter(Boolean).join(' ');
  const texto = q.texto.toLowerCase();
  const mensajes = lista
    .filter(x => !q.estado || (q.estado === 'enviados' ? ENVIADOS.includes(x.estado) : x.estado === q.estado))
    .map(x => ({ _id: x._id, fecha: x.enviadoEn || x.updatedAt, tipo: x.tipo || 'manifiesto', documento: x.documento, estado: x.estado, error: x.error, telefono: x.telefono,
      origen: x.origen, cuenta: x.cuenta, intentos: x.intentos, enviadoEn: x.enviadoEn, entregadoEn: x.entregadoEn, leidoEn: x.leidoEn,
      viaje: x.viaje ? { _id: x.viaje._id, numero: x.viaje.numero, placa: x.viaje.placa, destino: x.viaje.destino } : null,
      conductor: x.conductor ? { nombre: nombreDe(x.conductor), numId: x.conductor.numId } : null }))
    .filter(x => !texto || [x.documento, x.telefono, x.viaje?.placa, x.viaje?.numero, x.conductor?.nombre, x.conductor?.numId]
      .some(v => String(v ?? '').toLowerCase().includes(texto)));
  res.json({ totales, mensajes });
});

// Mensajes que la gente le escribió al número (solo para leerlos) con la respuesta automática que se le dio
r.get('/recibidos', operar, async (req, res) => {
  const q = z.object({ desde: fechaIso, hasta: fechaIso, texto: z.string().trim().max(60).optional().default('') }).parse(req.query);
  const desde = new Date(`${q.desde}T05:00:00.000Z`);
  const hasta = new Date(`${q.hasta}T05:00:00.000Z`); hasta.setUTCDate(hasta.getUTCDate() + 1);
  if (!(hasta > desde)) throw new ErrorHttp(400, 'El rango de fechas no es válido');
  const lista = await MensajeWhatsapp.find(deEmpresa(req, { fecha: { $gte: desde, $lt: hasta } })).sort({ fecha: -1 }).limit(2000)
    .populate(pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId')).lean();
  const t = q.texto.toLowerCase();
  const mensajes = lista.map((x) => ({ _id: x._id, fecha: x.fecha, de: x.de, nombre: x.nombre, tipo: x.tipo, texto: x.texto, respuesta: x.respuesta,
    conductor: x.conductor ? { nombre: [x.conductor.nombres, x.conductor.apellido1, x.conductor.apellido2].filter(Boolean).join(' '), numId: x.conductor.numId } : null }))
    .filter((x) => !t || [x.de, x.nombre, x.texto, x.conductor?.nombre, x.conductor?.numId].some((v) => String(v ?? '').toLowerCase().includes(t)));
  res.json({ total: mensajes.length, mensajes });
});

const listaViajes = z.object({ viajes: z.array(z.string().refine(x => mongoose.isValidObjectId(x), 'viaje inválido')).min(1).max(200) });
r.post('/aprobar', operar, async (req, res) => {
  const { viajes } = listaViajes.parse(req.body);
  const x = await aprobarEnvios(req.empresaId, viajes, req.usuario._id);
  await auditar(req, 'aprobar_whatsapp', { detalle: { viajes: viajes.length, aprobados: x.aprobados } });
  res.json(x);
});
r.post('/descartar', operar, async (req, res) => {
  const { viajes } = listaViajes.parse(req.body);
  const x = await descartarEnvios(req.empresaId, viajes, req.usuario._id);
  await auditar(req, 'descartar_whatsapp', { detalle: { viajes: viajes.length, descartados: x.descartados } });
  res.json(x);
});

// Envío o reenvío manual del manifiesto vigente del viaje
r.post('/viajes/:id/enviar', operar, async (req, res) => {
  try {
    const x = await prepararEnvio(req.empresaId, id(req.params.id), { origen: 'manual', usuario: req.usuario._id });
    await auditar(req, 'enviar_whatsapp_manual', { entidad: 'Viaje', entidadId: req.params.id, detalle: { estado: x?.estado } });
    res.json(x);
  } catch (e) { throw e.status ? new ErrorHttp(e.status, e.message) : e; }
});

r.post('/envios/:id/reintentar', operar, async (req, res) => {
  const x = await procesarEnvio(req.empresaId, id(req.params.id));
  if (!x) throw new ErrorHttp(409, 'Este envío no se puede reintentar');
  await auditar(req, 'reintentar_whatsapp', { entidad: 'EnvioWhatsapp', entidadId: req.params.id, detalle: { estado: x.estado } });
  res.json(x);
});

export default r;
