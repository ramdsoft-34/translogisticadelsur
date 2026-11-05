// SG-SST y PESV: módulo de la oficina. Por ahora, planillas de seguridad social de los conductores.
// Ver: sst.ver (admin y consulta). Decidir y subir: sst.gestionar (admin).
import express, { Router } from 'express';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { libroExcel } from '../services/reportes/comun.js';
import * as pl from '../services/sst/planillas.js';

const r = Router();
r.use(autenticar, soloEmpresa);
const ver = permitir(P.SST_VER);
const gestionar = permitir(P.SST_GESTIONAR);
const id = (v) => { if (!/^[a-f0-9]{24}$/i.test(String(v))) throw new ErrorHttp(400, 'Identificador inválido'); return String(v); };
const por = (req) => String(req.usuario.nombre || req.usuario.email).slice(0, 120);
const ESTADOS = ['pendiente', 'recibida', 'vencida', 'excluida', 'tardia_habilitada'];
const TEXTO_ESTADO = { pendiente: 'Pendiente', recibida: 'Recibida', vencida: 'Vencida', excluida: 'Excluida', tardia_habilitada: 'Carga tardía habilitada' };

// Toda ruta de planillas exige que la empresa use la app de conductores
r.use('/planillas', async (req, _res, next) => { await pl.exigirApp(req.empresaId); next(); });
r.use('/conductores', async (req, _res, next) => { await pl.exigirApp(req.empresaId); next(); });

const filtros = (q) => z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  estado: z.enum(ESTADOS).optional(),
  q: z.string().trim().max(100).optional(),
}).parse({ periodo: q.periodo || undefined, estado: q.estado || undefined, q: q.q || undefined });

r.get('/planillas', ver, async (req, res) => res.json(await pl.listar(req.empresaId, filtros(req.query))));

r.get('/planillas/exportar', ver, async (req, res) => {
  const d = await pl.listar(req.empresaId, filtros(req.query));
  const fecha = (v) => (v ? new Date(v).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '');
  const buf = await libroExcel({
    empresa: await Empresa.findById(req.empresaId).lean(),
    titulo: `Planillas de seguridad social ${d.periodo}`,
    subtitulo: `Recibidas ${d.indicadores.recibidas} de ${d.indicadores.total - d.indicadores.excluidas} · Cumplimiento ${d.indicadores.cumplimiento ?? '—'} %`,
    columnas: [['Conductor', 34], ['Cédula', 14], ['Estado', 22], ['Fecha de carga', 18], ['Subida desde', 14], ['Versiones', 10], ['Observación', 40]].map(([titulo, ancho]) => ({ titulo, ancho })),
    filas: d.items.map(p => [p.nombre, p.cedula, TEXTO_ESTADO[p.estado] || p.estado, fecha(p.recibida?.subidoEn), p.recibida ? (p.recibida.origen === 'web' ? 'Web' : 'App') : '',
      p.cantidadVersiones, p.exclusion ? `Excluido: ${p.exclusion.motivo}` : p.cargaTardia ? `Carga tardía hasta ${fecha(p.cargaTardia.hasta)}: ${p.cargaTardia.motivo}` : p.ingresoTardio ? 'Activó la app después del día 5: por decidir' : ''])
  });
  await auditar(req, 'exportar_planillas', { detalle: { periodo: d.periodo, filas: d.items.length } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="planillas_${d.periodo}.xlsx"`);
  res.send(buf);
});

r.get('/planillas/:id', ver, async (req, res) => res.json(await pl.detalle(req.empresaId, id(req.params.id))));

// Ver o descargar el PDF (queda en la auditoría: son datos personales)
r.get('/planillas/:id/archivo', ver, async (req, res) => {
  const version = z.coerce.number().int().min(1).max(100).optional().parse(req.query.version || undefined);
  const f = await pl.archivo(req.empresaId, id(req.params.id), version);
  await auditar(req, 'ver_planilla', { entidad: 'Planilla', entidadId: req.params.id, detalle: { version: version || 'vigente' } });
  res.set('Cache-Control', 'private, no-store').type('application/pdf');
  res.setHeader('Content-Disposition', `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename="planilla.pdf"`);
  res.send(f.datos);
});

r.get('/conductores/:terceroId/planillas', ver, async (req, res) => res.json(await pl.historialConductor(req.empresaId, id(req.params.terceroId))));

// La oficina sube el PDF por el conductor (por ejemplo, si no tiene la app)
r.post('/planillas/:id/archivo', gestionar, express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '10mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ErrorHttp(400, 'Adjunte la planilla en PDF');
  let nombre = 'planilla.pdf';
  try { nombre = decodeURIComponent(req.get('x-nombre-archivo') || String(req.query.nombre || 'planilla.pdf')).slice(0, 120); } catch { /* nombre ilegible */ }
  const p = await pl.subir(req.empresaId, id(req.params.id), por(req), nombre, req.body);
  await auditar(req, 'subir_planilla', { entidad: 'Planilla', entidadId: req.params.id, detalle: { conductor: p.nombre, periodo: p.periodo } });
  res.status(201).json(p);
});

r.post('/planillas/:id/carga-tardia', gestionar, async (req, res) => {
  const d = z.object({ motivo: z.string().trim().min(5, 'Escriba el motivo').max(500), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha límite inválida') }).parse(req.body);
  // Hasta el final de ese día en Colombia
  const p = await pl.cargaTardia(req.empresaId, id(req.params.id), { por: por(req), motivo: d.motivo, hasta: `${d.hasta}T23:59:59-05:00` });
  await auditar(req, 'habilitar_carga_tardia_planilla', { entidad: 'Planilla', entidadId: req.params.id, detalle: { conductor: p.nombre, periodo: p.periodo, hasta: d.hasta, motivo: d.motivo } });
  res.json(p);
});

r.post('/planillas/:id/excluir', gestionar, async (req, res) => {
  const d = z.object({ motivo: z.string().trim().min(5, 'Escriba el motivo').max(500) }).parse(req.body);
  const p = await pl.excluir(req.empresaId, id(req.params.id), { por: por(req), motivo: d.motivo });
  await auditar(req, 'excluir_planilla', { entidad: 'Planilla', entidadId: req.params.id, detalle: { conductor: p.nombre, periodo: p.periodo, motivo: d.motivo } });
  res.json(p);
});

r.post('/planillas/:id/incluir', gestionar, async (req, res) => {
  const p = await pl.incluir(req.empresaId, id(req.params.id), { por: por(req) });
  await auditar(req, 'incluir_planilla', { entidad: 'Planilla', entidadId: req.params.id, detalle: { conductor: p.nombre, periodo: p.periodo } });
  res.json(p);
});

export default r;
