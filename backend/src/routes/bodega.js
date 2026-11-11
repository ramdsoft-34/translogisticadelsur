// Cargues del día del jefe de bodega: rutas internas (/api/bodega) y públicas del enlace (/api/b).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Cliente, ReporteBodega } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { celularWhatsapp } from '../services/whatsappBusiness.js';
import { soloDigitos } from '../utils/texto.js';
import { descifrar } from '../utils/cifrado.js';
import { env } from '../config/env.js';
import * as B from '../services/bodega.js';

const oid = z.string().refine((v) => mongoose.isValidObjectId(v), 'identificador inválido');
const sinCache = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

// ── Público: el enlace del jefe de bodega ──
export const publico = Router();
publico.use(sinCache, rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
const limiteIngreso = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espere unos minutos e intente de nuevo.' } });
const sesion = (req) => req.get('X-Sesion-Bodega') || '';

publico.get('/:token', async (req, res) => res.json(await B.portada(req.params.token)));
publico.post('/:token/ingresar', limiteIngreso, async (req, res) => {
  const { cedula } = z.object({ cedula: z.string().max(20) }).parse(req.body || {});
  res.json(await B.ingresar(req.params.token, cedula));
});
publico.get('/:token/datos', async (req, res) => res.json(await B.datosFormulario(req.params.token, sesion(req), req.query.cual === 'ayer' ? 'ayer' : 'hoy')));
publico.get('/:token/placas', async (req, res) => res.json(await B.buscarPlacas(req.params.token, sesion(req), String(req.query.q || ''))));
publico.put('/:token/reporte', async (req, res) => {
  const d = z.object({ cual: z.enum(['hoy', 'ayer']), tipo: z.enum(['urbano', 'correria']), items: z.array(z.object({
    placa: z.string().max(10), destino: z.string().max(80), planilla: z.string().max(30).optional().default(''), viajes: z.coerce.number().min(1).max(5).optional().default(1),
    auxiliar: z.coerce.number().int().min(0).max(5).optional().default(0), conductor: z.string().max(30).nullable().optional(), conductorTexto: z.string().max(80).optional().default(''),
  })).max(60) }).parse(req.body || {});
  res.json(await B.guardarReporte(req.params.token, sesion(req), d));
});

// ── Interno ──
const r = Router();
r.use(autenticar, soloEmpresa);

r.get('/dia', permitir(P.VIAJES_VER), async (req, res) => {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fecha || '')) ? String(req.query.fecha) : '';
  res.json(await B.resumenDia(req.empresaId, f));
});

r.post('/enviar', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const { clientes } = z.object({ clientes: z.array(oid).min(1).max(100) }).parse(req.body);
  const resultados = [];
  for (const id of [...new Set(clientes)]) {
    try { resultados.push({ cliente: id, ...(await B.enviarSolicitud(req.empresaId, id, { usuario: req.usuario._id })) }); }
    catch (e) { resultados.push({ cliente: id, error: e.message }); }
  }
  await auditar(req, 'enviar_solicitud_bodega', { detalle: { resultados: resultados.map((x) => ({ cliente: x.cliente, enviados: x.enviados || 0, error: x.error || '' })) } });
  res.json({ resultados });
});

r.get('/reportes/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => res.json(await B.revision(req.empresaId, oid.parse(req.params.id))));

// Enlace del día (para abrirlo o compartirlo por otro medio); solo quien registra viajes
r.get('/reportes/:id/enlace', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const rep = await ReporteBodega.findOne(deEmpresa(req, { _id: oid.parse(req.params.id) })).select('+tokenCifrado vence').lean();
  if (!rep?.tokenCifrado) throw new ErrorHttp(404, 'Todavía no se ha enviado el enlace de ese día');
  if (!rep.vence || rep.vence < new Date()) throw new ErrorHttp(410, 'El enlace de ese día ya venció');
  res.json({ enlace: `${env.urlPublica}/b/${descifrar(rep.tokenCifrado)}`, vence: rep.vence });
});

r.post('/reportes/:id/vincular', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = z.object({ item: oid, viaje: oid }).parse(req.body);
  res.json(await B.vincularViaje(req.empresaId, oid.parse(req.params.id), d.item, d.viaje));
});

// Configuración en Clientes y tarifas
async function clienteDe(req) {
  const c = await Cliente.findOne(deEmpresa(req, { _id: oid.parse(req.params.cliente) })).select('nombre tipoId nit dv sedeRemitente bodega').lean();
  if (!c) throw new ErrorHttp(404, 'Cliente no encontrado');
  return c;
}
r.get('/config/:cliente', permitir(P.MAESTROS_VER), async (req, res) => {
  const c = await clienteDe(req);
  res.json({ bodega: c.bodega || {}, frecuentes: await B.frecuentes(req.empresaId, c) });
});

const configSchema = z.object({
  activa: z.boolean(), envioAutomatico: z.boolean(),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no válida (HH:MM)'),
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  manifiestoUrbanos: z.boolean(), manifiestoCorrerias: z.boolean(), auxiliarPagado: z.boolean(),
  jefes: z.array(z.object({ nombre: z.string().trim().min(2, 'Escriba el nombre del jefe de bodega').max(80),
    cedula: z.string().trim().max(15), celular: z.string().trim().max(15) })).max(10),
});
r.put('/config/:cliente', permitir(P.MAESTROS_EDITAR), async (req, res) => {
  const c = await clienteDe(req);
  const d = configSchema.parse(req.body);
  const cedulas = new Set();
  for (const j of d.jefes) {
    j.cedula = soloDigitos(j.cedula);
    if (j.cedula.length < 5 || j.cedula.length > 12) throw new ErrorHttp(400, `Cédula no válida para ${j.nombre}`);
    if (cedulas.has(j.cedula)) throw new ErrorHttp(400, `La cédula ${j.cedula} está repetida`);
    cedulas.add(j.cedula);
    if (!celularWhatsapp(j.celular)) throw new ErrorHttp(400, `Celular no válido para ${j.nombre}: 10 dígitos que empiecen por 3`);
    j.celular = soloDigitos(j.celular).slice(-10);
  }
  if (d.activa && !d.jefes.length) throw new ErrorHttp(400, 'Para activarla registre al menos un jefe de bodega');
  const set = Object.fromEntries(Object.entries(d).map(([k, v]) => [`bodega.${k}`, k === 'dias' ? [...new Set(v)].sort() : v]));
  await Cliente.updateOne(deEmpresa(req, { _id: c._id }), { $set: set });
  await auditar(req, 'configurar_bodega', { entidad: 'Cliente', entidadId: c._id, detalle: { cliente: c.nombre, activa: d.activa, jefes: d.jefes.length, automatico: d.envioAutomatico ? d.hora : '' } });
  const n = await Cliente.findOne(deEmpresa(req, { _id: c._id })).select('nombre tipoId nit dv sedeRemitente bodega').lean();
  res.json({ bodega: n.bodega, frecuentes: await B.frecuentes(req.empresaId, n) });
});

// Buscar vehículos para agregar (por placa o conductor)
r.get('/config/:cliente/buscar', permitir(P.MAESTROS_VER), async (req, res) => {
  await clienteDe(req);
  res.json(await B.buscarVehiculos(req.empresaId, String(req.query.q || '')));
});

// Agregar al formulario del jefe de bodega o quitar de él
r.put('/config/:cliente/placas', permitir(P.MAESTROS_EDITAR), async (req, res) => {
  const c = await clienteDe(req);
  const d = z.object({ placa: z.string().trim().toUpperCase().transform((v) => v.replace(/[^A-Z0-9]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'Placa no válida')),
    accion: z.enum(['agregar', 'quitar', 'tipo']), tipo: z.enum(['urbano', 'correria', 'ambos', '']).optional() }).parse(req.body);
  if (d.accion === 'tipo') {
    // Urbanos, correrías o ambos; vacío = según sus viajes
    await Cliente.updateOne(deEmpresa(req, { _id: c._id }), { $pull: { 'bodega.tiposPlaca': { placa: d.placa } } });
    if (d.tipo) await Cliente.updateOne(deEmpresa(req, { _id: c._id }), { $push: { 'bodega.tiposPlaca': { placa: d.placa, tipo: d.tipo } } });
  } else {
    const op = d.accion === 'agregar' ? { $addToSet: { 'bodega.fijadas': d.placa }, $pull: { 'bodega.quitadas': d.placa } }
      : { $addToSet: { 'bodega.quitadas': d.placa }, $pull: { 'bodega.fijadas': d.placa } };
    await Cliente.updateOne(deEmpresa(req, { _id: c._id }), op);
  }
  const n = await Cliente.findOne(deEmpresa(req, { _id: c._id })).select('nombre tipoId nit dv sedeRemitente bodega').lean();
  res.json({ bodega: n.bodega, frecuentes: await B.frecuentes(req.empresaId, n) });
});

export default r;
