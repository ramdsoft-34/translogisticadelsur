// Fase 11: relaciones de cobro (Generar relación y Relaciones generadas). Se monta dentro de /api/gestion (ya autenticado).
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { permitir, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha } from '../utils/texto.js';

const finDia = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));
import * as R from '../services/gestion/relaciones.js';

const r = Router();
const ver = permitir(P.REPORTES_VER, P.LIQUIDACION_VER);
const gestionar = permitir(P.LIQUIDACION_GESTIONAR, P.VIAJES_REGISTRAR, P.CONTABILIDAD_GESTIONAR);
const facturar = permitir(P.LIQUIDACION_GESTIONAR, P.CONTABILIDAD_GESTIONAR);
const id = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const correo = z.string().trim().toLowerCase().email('correo inválido');
const fecha = (v) => { const f = parseFecha(v); if (!f) throw new ErrorHttp(400, 'Fecha inválida'); return f; };
const periodoZ = z.object({ cliente: id, desde: z.string(), hasta: z.string(), grupo: z.string().trim().max(30).optional().default('') });
const periodo = (d) => ({ cliente: d.cliente, desde: fecha(d.desde), hasta: finDia(fecha(d.hasta)), grupo: d.grupo });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Plantilla general del correo (la que se usa si la empresa no tiene una propia)
r.get('/relaciones-cobro/plantilla-general', ver, (_req, res) => res.json(R.PLANTILLA_GENERAL));

// Grupos de relación de la empresa (Viajeros, TAT…) para el selector
r.get('/relaciones-cobro/grupos', ver, async (req, res) => res.json(await R.gruposDe(req.empresaId, id.parse(req.query.cliente))));

// Vista previa con la revisión (no guarda)
r.post('/relaciones-cobro/previa', ver, async (req, res) => res.json(await R.armar(req.empresaId, periodo(periodoZ.parse(req.body || {})))));

// Guardar (o actualizar la del mismo periodo y grupo)
r.post('/relaciones-cobro', gestionar, async (req, res) => {
  const d = periodoZ.extend({ titulo: z.string().trim().max(250).optional().default('') }).parse(req.body || {});
  const rel = await R.guardar(req.empresaId, { ...periodo(d), titulo: d.titulo }, req.usuario._id);
  await auditar(req, 'relacion_guardar', { entidad: 'RelacionCliente', entidadId: rel._id, detalle: { numero: rel.numero, viajes: rel.totales.viajes, total: rel.totales.total } });
  res.status(201).json({ ...rel, token: undefined });
});

r.get('/relaciones-cobro', ver, async (req, res) => {
  const cliente = req.query.cliente && mongoose.isValidObjectId(req.query.cliente) ? req.query.cliente : null;
  res.json(await R.listar(req.empresaId, { cliente, estado: String(req.query.estado || ''), anio: Number(req.query.anio) || null }));
});
r.get('/relaciones-cobro/:id', ver, async (req, res) => { const d = await R.detalle(req.empresaId, id.parse(req.params.id)); res.json({ ...d, token: undefined }); });

// Archivos: Excel o PDF (ver=1 abre el PDF en pantalla)
r.get('/relaciones-cobro/:id/archivo', ver, async (req, res) => {
  const a = await R.archivos(req.empresaId, id.parse(req.params.id));
  const pdf = req.query.formato === 'pdf';
  res.setHeader('Content-Type', pdf ? 'application/pdf' : XLSX);
  res.setHeader('Content-Disposition', `${pdf && req.query.ver === '1' ? 'inline' : 'attachment'}; filename="${a.nombre}.${pdf ? 'pdf' : 'xlsx'}"`);
  res.send(pdf ? a.pdf : a.xlsx);
});

// Correo: vista previa con la plantilla de la empresa y envío
r.get('/relaciones-cobro/:id/correo', ver, async (req, res) => res.json(await R.previaCorreo(req.empresaId, id.parse(req.params.id), req.usuario._id)));
r.post('/relaciones-cobro/:id/correo', gestionar, express.json({ limit: '12mb' }), async (req, res) => {
  const d = z.object({ para: z.array(correo).max(30).optional().default([]), cc: z.array(correo).max(30).optional().default([]),
    asunto: z.string().trim().max(200).optional().default(''), cuerpo: z.string().trim().max(4000).optional().default(''),
    adjuntos: z.array(z.object({ nombre: z.string().max(150), tipo: z.string().max(100).optional(), base64: z.string().max(14_000_000) })).max(5).optional().default([]) }).parse(req.body || {});
  const x = await R.enviarCorreo(req.empresaId, id.parse(req.params.id), d, req.usuario._id);
  await auditar(req, 'relacion_correo', { entidad: 'RelacionCliente', entidadId: req.params.id, resultado: x.estado === 'enviado' ? 'ok' : 'error', detalle: { para: d.para, error: x.error } });
  if (x.estado !== 'enviado') throw new ErrorHttp(502, `No se pudo enviar el correo: ${x.error || 'error del servidor de correo'}`);
  res.json(x);
});

// WhatsApp: enlaces wa.me para los contactos de la empresa; al hacer clic se anota el envío
r.post('/relaciones-cobro/:id/whatsapp', gestionar, async (req, res) => res.json(await R.prepararWhatsapp(req.empresaId, id.parse(req.params.id))));
r.put('/relaciones-cobro/:id/whatsapp/enviado', gestionar, async (req, res) => {
  const d = z.object({ para: z.string().trim().max(80).optional().default('') }).parse(req.body || {});
  const x = await R.marcarWhatsapp(req.empresaId, id.parse(req.params.id), d, req.usuario._id);
  await auditar(req, 'relacion_whatsapp', { entidad: 'RelacionCliente', entidadId: req.params.id, detalle: d });
  res.json(x);
});

r.put('/relaciones-cobro/:id/facturar', facturar, async (req, res) => {
  const d = z.object({ factura: z.string().trim().min(1, 'Escriba el número de la factura').max(40), fecha: z.string().optional() }).parse(req.body || {});
  const x = await R.facturar(req.empresaId, id.parse(req.params.id), { factura: d.factura, fecha: d.fecha ? fecha(d.fecha) : new Date() }, req.usuario._id);
  await auditar(req, 'relacion_facturar', { entidad: 'RelacionCliente', entidadId: x._id, detalle: { numero: x.numero, factura: x.factura.numero } });
  res.json({ ...x, token: undefined });
});
// Reabrir una facturada: solo el administrador, con motivo (queda en el historial)
r.put('/relaciones-cobro/:id/reabrir', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const d = z.object({ motivo: z.string().trim().min(10, 'Escriba el motivo (mínimo 10 letras)').max(300) }).parse(req.body || {});
  const x = await R.reabrir(req.empresaId, id.parse(req.params.id), d, req.usuario._id);
  await auditar(req, 'relacion_reabrir', { entidad: 'RelacionCliente', entidadId: x._id, detalle: { numero: x.numero, motivo: d.motivo } });
  res.json({ ...x, token: undefined });
});
r.delete('/relaciones-cobro/:id', gestionar, async (req, res) => {
  const x = await R.eliminar(req.empresaId, id.parse(req.params.id));
  await auditar(req, 'relacion_eliminar', { entidad: 'RelacionCliente', entidadId: req.params.id, detalle: x });
  res.json(x);
});

// Corregir la fecha de un viaje desde la revisión (p. ej. 23/11 → 23/10)
r.put('/relaciones-cobro/viaje/:id/fecha', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = z.object({ fecha: z.string() }).parse(req.body || {});
  const x = await R.corregirFecha(req.empresaId, id.parse(req.params.id), fecha(d.fecha));
  await auditar(req, 'viaje_corregir_fecha', { entidad: 'Viaje', entidadId: req.params.id, detalle: x });
  res.json(x);
});

export default r;
