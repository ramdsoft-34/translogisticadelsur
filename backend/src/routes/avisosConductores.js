// Avisos a los conductores de la app (solo administradores): historial, crear, programar, reenviar
// y avisos automáticos. Los avisos viven en el backend de Sur Track, que los manda al celular.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { exigirApp } from '../services/sst/planillas.js';
import { llamarApp } from '../services/rastreo/surtrack.js';

const r = Router();
r.use(autenticar, soloEmpresa, permitir(P.NOTIFICACIONES_GESTIONAR));
r.use(async (req, _res, next) => { await exigirApp(req.empresaId); next(); });

const id = (v) => { if (!/^[a-f0-9]{24}$/i.test(String(v))) throw new ErrorHttp(400, 'Identificador inválido'); return String(v); };
const por = (req) => String(req.usuario.nombre || req.usuario.email).slice(0, 120);
const emp = (req) => String(req.empresaId);
const q = (req, extra = {}) => new URLSearchParams({ ...extra, empresaId: emp(req) }).toString();
const destino = z.object({
  modo: z.enum(['todos', 'conductores', 'planilla']),
  conductores: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(500).default([]),
  estadosPlanilla: z.array(z.enum(['pendiente', 'recibida', 'vencida', 'excluida', 'tardia_habilitada'])).max(5).default([]),
});
// Fecha y hora escrita en la web, en hora de Colombia (sin depender de la zona del navegador)
const fechaColombia = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Fecha y hora inválidas').transform(v => `${v}:00-05:00`);

r.get('/conductores', async (req, res) => res.json(await llamarApp(`/avisos/conductores?${q(req)}`)));
r.get('/', async (req, res) => res.json(await llamarApp(`/avisos?${q(req, { pagina: String(Math.max(1, Number(req.query.pagina) || 1)) })}`)));
r.get('/automaticos', async (req, res) => res.json(await llamarApp(`/avisos/automaticos/reglas?${q(req)}`)));
r.get('/:id', async (req, res) => res.json(await llamarApp(`/avisos/${id(req.params.id)}?${q(req)}`)));

r.post('/vista-previa', async (req, res) => {
  const d = z.object({ destino }).parse(req.body);
  res.json(await llamarApp('/avisos/vista-previa', { metodo: 'POST', cuerpo: { empresaId: emp(req), destino: d.destino } }));
});

r.post('/', async (req, res) => {
  const d = z.object({
    titulo: z.string().trim().min(3).max(80), texto: z.string().trim().min(3).max(500), destino,
    accion: z.enum(['borrador', 'programar', 'enviar']), programadaPara: fechaColombia.optional(),
    claveIdempotencia: z.string().min(8).max(100).default(() => randomUUID()),
    confirmarTotal: z.number().int().min(0).optional(), forzar: z.boolean().default(false),
  }).parse(req.body);
  const n = await llamarApp('/avisos', { metodo: 'POST', cuerpo: { ...d, empresaId: emp(req), por: por(req) } });
  await auditar(req, d.accion === 'enviar' ? 'enviar_aviso_conductores' : d.accion === 'programar' ? 'programar_aviso_conductores' : 'borrador_aviso_conductores',
    { entidad: 'AvisoConductores', entidadId: n.id, detalle: { titulo: d.titulo, destino: d.destino.modo, total: n.total, programadaPara: d.programadaPara } });
  res.status(201).json(n);
});

r.put('/:id', async (req, res) => {
  const d = z.object({ titulo: z.string().trim().min(3).max(80), texto: z.string().trim().min(3).max(500), destino, programadaPara: fechaColombia.nullable().optional() }).parse(req.body);
  const n = await llamarApp(`/avisos/${id(req.params.id)}`, { metodo: 'PUT', cuerpo: { ...d, empresaId: emp(req) } });
  await auditar(req, 'editar_aviso_conductores', { entidad: 'AvisoConductores', entidadId: n.id, detalle: { titulo: d.titulo } });
  res.json(n);
});

r.post('/:id/enviar', async (req, res) => {
  const d = z.object({ confirmarTotal: z.number().int().min(0).optional(), forzar: z.boolean().default(false) }).parse(req.body || {});
  const n = await llamarApp(`/avisos/${id(req.params.id)}/enviar`, { metodo: 'POST', cuerpo: { ...d, empresaId: emp(req), por: por(req) } });
  await auditar(req, 'enviar_aviso_conductores', { entidad: 'AvisoConductores', entidadId: n.id, detalle: { titulo: n.titulo, total: n.total } });
  res.json(n);
});

r.post('/:id/cancelar', async (req, res) => {
  const n = await llamarApp(`/avisos/${id(req.params.id)}/cancelar`, { metodo: 'POST', cuerpo: { empresaId: emp(req) } });
  await auditar(req, 'cancelar_aviso_conductores', { entidad: 'AvisoConductores', entidadId: n.id, detalle: { titulo: n.titulo } });
  res.json(n);
});

r.post('/:id/reenviar', async (req, res) => {
  const d = z.object({ conductor: z.string().regex(/^[a-f0-9]{24}$/i).optional(), claveIdempotencia: z.string().min(8).max(100).default(() => randomUUID()),
    confirmarTotal: z.number().int().min(0).optional() }).parse(req.body || {});
  const n = await llamarApp(`/avisos/${id(req.params.id)}/reenviar`, { metodo: 'POST', cuerpo: { ...d, empresaId: emp(req), por: por(req) } });
  await auditar(req, 'reenviar_aviso_conductores', { entidad: 'AvisoConductores', entidadId: n.id, detalle: { original: req.params.id, total: n.total, conductor: d.conductor || 'todos' } });
  res.status(201).json(n);
});

r.put('/automaticos/:clave', async (req, res) => {
  const clave = z.enum(['viaje_asignado', 'viaje_actualizado', 'viaje_cancelado', 'salida_autorizada', 'pago', 'planilla_recordatorio']).parse(req.params.clave);
  const d = z.object({ activa: z.boolean(), turnos: z.array(z.object({ dia: z.number().int().min(1).max(5), hora: z.string(), titulo: z.string(), texto: z.string() })).max(15).optional() }).parse(req.body);
  const g = await llamarApp(`/avisos/automaticos/reglas/${clave}`, { metodo: 'PUT', cuerpo: { ...d, empresaId: emp(req), por: por(req) } });
  await auditar(req, 'configurar_aviso_automatico', { detalle: { clave, activa: d.activa, turnos: d.turnos?.length } });
  res.json(g);
});

export default r;
