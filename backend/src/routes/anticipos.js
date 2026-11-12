// Fase 15: soportes de anticipos.
//   /api/anticipos      oficina (con sesión): lista del día, enlace del mensajero, imagen, confirmar a mano
//   /api/a              página pública del mensajero (/a/<token>): entra con su cédula y sube los soportes
//   /api/whatsapp/webhook  avisos de Meta (enviado, entregado, leído)
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { z } from 'zod';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import * as A from '../services/anticipos.js';
import * as WA from '../services/whatsappMeta.js';

const oid = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const soporteSchema = z.object({ forma: z.enum(['transferencia', 'efectivo']).default('transferencia'),
  imagen: z.string().max(A.IMAGEN_MAX), firma: z.string().max(A.IMAGEN_MAX).optional().default('') });

// ── Oficina ──
const r = Router();
r.use(autenticar, soloEmpresa);

r.get('/', permitir(P.VIAJES_VER), async (req, res) => {
  const [lista, enlaces] = await Promise.all([A.listaDelDia(req.empresaId, req.query.fecha), A.enlacesDelDia(req.empresaId, req.query.fecha)]);
  res.json({ ...lista, enlaces, whatsappApi: WA.configurado() });
});

r.post('/enlace', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = z.object({ fecha: z.string().max(10).optional(), nombre: z.string().trim().min(2).max(80), documento: z.string().max(15),
    celular: z.string().max(15).optional().default('') }).parse(req.body || {});
  const e = await A.crearEnlace(req.empresaId, d, req.usuario?._id || null);
  await auditar(req, 'anticipos.enlace', { entidad: 'EnlaceMensajero', entidadId: e.id, detalle: { nombre: d.nombre, fecha: d.fecha } });
  res.status(201).json(e);
});

r.delete('/enlace/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  await A.anularEnlace(req.empresaId, oid.parse(req.params.id));
  res.json({ ok: true });
});

// La oficina también puede subir el soporte (por ejemplo, si consignó desde el banco)
r.post('/:viaje/soporte', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = soporteSchema.parse(req.body || {});
  const s = await A.guardarSoporte(req.empresaId, oid.parse(req.params.viaje), d,
    { tipo: 'usuario', nombre: req.usuario?.nombre || '', usuario: req.usuario?._id || null });
  await auditar(req, 'anticipos.soporte', { entidad: 'Viaje', entidadId: req.params.viaje, detalle: { forma: d.forma, whatsapp: s.whatsapp } });
  res.status(201).json(s);
});

r.post('/:viaje/confirmar', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = z.object({ nota: z.string().max(200).optional().default('') }).parse(req.body || {});
  const c = await A.confirmarManual(req.empresaId, oid.parse(req.params.viaje), req.usuario?._id || null, d.nota);
  await auditar(req, 'anticipos.confirmar', { entidad: 'Viaje', entidadId: req.params.viaje, detalle: { nota: d.nota } });
  res.json(c);
});

r.get('/:viaje/imagen', permitir(P.VIAJES_VER), async (req, res) => {
  const i = await A.imagenSoporte(req.empresaId, oid.parse(req.params.viaje), req.query.cual === 'firma' ? 'firma' : 'imagen');
  res.setHeader('Content-Type', i.tipo); res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(i.datos);
});

export default r;

// ── Mensajero (público) ──
export const publico = Router();
publico.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }));
const limiteIngreso = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espere unos minutos.' } });
const sesion = (req) => req.get('X-Sesion-Mensajero') || '';

publico.get('/:token', async (req, res) => res.json(await A.verEnlace(req.params.token)));

publico.post('/:token/ingresar', limiteIngreso, async (req, res) => {
  const d = z.object({ documento: z.string().max(15) }).parse(req.body || {});
  res.json(await A.ingresar(req.params.token, d.documento));
});

publico.get('/:token/viajes', async (req, res) => {
  const e = await A.enlaceConSesion(req.params.token, sesion(req));
  const l = await A.listaDelDia(e.empresa, e.fecha, { publico: true });
  res.json({ ...l, mensajero: e.nombre });
});

publico.post('/:token/viajes/:viaje/soporte', async (req, res) => {
  const e = await A.enlaceConSesion(req.params.token, sesion(req));
  const d = soporteSchema.parse(req.body || {});
  const s = await A.guardarSoporte(e.empresa, oid.parse(req.params.viaje), d,
    { tipo: 'mensajero', nombre: e.nombre, documento: e.documento, enlace: e._id }, { fechaEnlace: e.fecha });
  await auditar(null, 'anticipos.soporte', { empresa: e.empresa, usuario: null, entidad: 'Viaje', entidadId: req.params.viaje,
    detalle: { forma: d.forma, whatsapp: s.whatsapp, mensajero: e.nombre } });
  res.status(201).json(s);
});

// ── Webhook de Meta ──
export const webhook = Router();
webhook.get('/', (req, res) => {
  const t = WA.tokenVerificacion();
  if (t && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === t) return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  throw new ErrorHttp(403, 'Verificación inválida');
});
webhook.post('/', async (req, res) => {
  if (!WA.firmaValida(req.cuerpoCrudo, req.get('X-Hub-Signature-256'))) throw new ErrorHttp(401, 'Firma inválida');
  await A.aplicarEstados(req.body);
  res.sendStatus(200);
});
