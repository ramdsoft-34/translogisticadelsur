// Fase 13: autoevaluación de estándares mínimos (Res. 0312) con puntaje calculado, plan de mejora automático,
// plan anual de trabajo con el calendario del Ministerio del Trabajo, la ARL, MinTransporte y la Supertransporte, y alertas.
// Se monta dentro de /api/sst (routes/sst.js). Ver: sst.ver o sst.gestionar. Calificar, cerrar y editar: sst.gestionar.
import { Router } from 'express';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { libroExcel } from '../services/reportes/comun.js';
import * as planes from '../services/sst/planes.js';
import { ESTANDARES, CICLOS } from '../services/sst/estandares.js';
import { OBLIGACIONES, ENTIDADES } from '../services/sst/obligaciones.js';

const r = Router();
r.use(autenticar, soloEmpresa);
const ver = permitir(P.SST_VER, P.SST_GESTIONAR);
const gestionar = permitir(P.SST_GESTIONAR);
const id = (v) => { if (!/^[a-f0-9]{24}$/i.test(String(v))) throw new ErrorHttp(400, 'Identificador inválido'); return String(v); };
const txt = (max) => z.string().trim().max(max).optional().default('');
const fechaReq = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').transform((v) => new Date(`${v}T12:00:00-05:00`));
const fechaOpc = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'), z.literal(''), z.null()]).optional()
  .transform((v) => (v ? new Date(`${v}T12:00:00-05:00`) : null));

const ESTADO_ITEM = { C: 'Cumple', NC: 'No cumple', NA: 'No aplica', '': 'Sin calificar' };
const itemsEval = z.array(z.object({ numeral: z.string().regex(/^\d+\.\d+\.\d+$/), estado: z.enum(['', 'C', 'NC', 'NA']), justificacion: txt(600).optional() })).max(60);
const datosArl = z.object({ fecha: fechaOpc, consecutivo: txt(40).optional() });
const vigencia = z.coerce.number().int().min(2017).max(2100);

r.get('/estandares', ver, (_req, res) => res.json({ estandares: ESTANDARES, ciclos: CICLOS, obligaciones: OBLIGACIONES, entidades: ENTIDADES }));
r.get('/autoevaluaciones', ver, async (req, res) => res.json(await planes.listarAutoevaluaciones(req.empresaId)));
r.post('/autoevaluaciones', gestionar, async (req, res) => {
  const d = z.object({
    vigencia, fecha: fechaReq, origen: z.enum(['plataforma', 'alissta', 'excel']).default('plataforma'),
    copiarDe: z.string().regex(/^[a-f0-9]{24}$/i).optional(), items: itemsEval.optional(),
    soloTotal: z.boolean().default(false), total: z.coerce.number().min(0).max(100).optional(), reporteArl: datosArl.optional(),
  }).refine((x) => !x.soloTotal || x.total !== undefined, { message: 'Escriba el puntaje de la evaluación', path: ['total'] }).parse(req.body);
  const a = await planes.crear(req.empresaId, d, req.usuario._id);
  await auditar(req, 'sst_autoevaluacion_crear', { entidad: 'SstAutoevaluacion', entidadId: a._id, detalle: { vigencia: d.vigencia, origen: d.origen, soloTotal: d.soloTotal } });
  res.status(201).json(a);
});
r.get('/autoevaluaciones/:id', ver, async (req, res) => res.json(await planes.obtener(req.empresaId, id(req.params.id))));
r.put('/autoevaluaciones/:id', gestionar, async (req, res) => {
  const d = z.object({ items: itemsEval.optional(), fecha: fechaOpc, reporteArl: datosArl.optional(), recomendacionesArl: z.object({ fecha: fechaOpc, resumen: txt(2000).optional() }).optional() }).parse(req.body);
  res.json(await planes.guardar(req.empresaId, id(req.params.id), d, req.usuario._id));
});
r.post('/autoevaluaciones/:id/cerrar', gestionar, async (req, res) => {
  const a = await planes.cerrar(req.empresaId, id(req.params.id), req.usuario._id);
  await auditar(req, 'sst_autoevaluacion_cerrar', { entidad: 'SstAutoevaluacion', entidadId: a._id, detalle: { vigencia: a.vigencia, total: a.calculo.total, plan: a.plan } });
  res.json(a);
});
r.post('/autoevaluaciones/:id/reabrir', gestionar, async (req, res) => {
  const a = await planes.reabrir(req.empresaId, id(req.params.id), req.usuario._id);
  await auditar(req, 'sst_autoevaluacion_reabrir', { entidad: 'SstAutoevaluacion', entidadId: a._id, detalle: { vigencia: a.vigencia } });
  res.json(a);
});
r.delete('/autoevaluaciones/:id', gestionar, async (req, res) => {
  await planes.borrar(req.empresaId, id(req.params.id));
  await auditar(req, 'sst_autoevaluacion_borrar', { entidad: 'SstAutoevaluacion', entidadId: req.params.id });
  res.status(204).end();
});
// Informe para la ARL y el registro en el Ministerio: los 60 ítems con su calificación y el plan de mejora
r.get('/autoevaluaciones/:id/excel', ver, async (req, res) => {
  const a = await planes.obtener(req.empresaId, id(req.params.id));
  if (a.soloTotal) throw new ErrorHttp(400, 'Esta autoevaluación solo tiene el puntaje registrado');
  const c = a.calculo; const de = new Map(a.items.map((i) => [i.numeral, i]));
  const ciclos = c.ciclos.map((x) => `${x.nombre} ${x.obtenido}/${x.peso}`).join(' · ');
  const buf = await libroExcel({
    empresa: await Empresa.findById(req.empresaId).lean(),
    titulo: `Autoevaluación estándares mínimos ${a.vigencia}`,
    subtitulo: `Res. 0312 de 2019 · Puntaje ${c.total} % · ${c.nivel.texto} · ${ciclos}`,
    columnas: [['Numeral', 10], ['Ítem', 60], ['Peso', 8], ['Calificación', 14], ['Valor obtenido', 12], ['Justificación', 40], ['Evidencia', 14], ['Acción del plan de mejora', 60], ['Responsable', 26], ['Fecha límite', 14], ['Estado', 12]]
      .map(([titulo, ancho]) => ({ titulo, ancho })),
    filas: ESTANDARES.map((e) => {
      const i = de.get(e.numeral) || {}; const ac = a.acciones.find((x) => x.numeral === e.numeral);
      return [e.numeral, e.item, e.peso, ESTADO_ITEM[i.estado || ''], ['C', 'NA'].includes(i.estado) ? e.peso : 0, i.justificacion || '', e.formato,
        ac?.titulo || '', ac?.responsable || '', ac?.fecha ? new Date(ac.fecha).toISOString().slice(0, 10) : '', ac ? { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', cancelada: 'Cancelada' }[ac.estado] : ''];
    }),
    total: ['', 'TOTAL', 100, '', c.total],
  });
  await auditar(req, 'sst_autoevaluacion_exportar', { entidad: 'SstAutoevaluacion', entidadId: a._id, detalle: { vigencia: a.vigencia } });
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition', `attachment; filename="autoevaluacion_${a.vigencia}.xlsx"`);
  res.send(buf);
});

const anioQ = z.object({ anio: z.coerce.number().int().min(2017).max(2100).optional(), origen: z.enum(['norma', 'mejora', 'propia']).optional(),
  estado: z.enum(['pendiente', 'en_curso', 'hecha', 'cancelada']).optional() });
r.get('/actividades', ver, async (req, res) => {
  const q = anioQ.parse({ anio: req.query.anio || undefined, origen: req.query.origen || undefined, estado: req.query.estado || undefined });
  const items = await planes.actividades(req.empresaId, q);
  res.json({ items, resumen: planes.resumenPlan(items) });
});
const datosAct = z.object({
  titulo: z.string().trim().min(3, 'Escriba la actividad').max(300), detalle: txt(1000).optional(), responsable: txt(160).optional(),
  recursos: txt(300).optional(), evidencia: txt(160).optional(), nota: txt(1000).optional(), fecha: fechaReq,
  estado: z.enum(['pendiente', 'en_curso', 'hecha', 'cancelada']).optional(), ciclo: z.enum(['', 'P', 'H', 'V', 'A']).optional(),
});
r.post('/actividades', gestionar, async (req, res) => res.status(201).json(await planes.crearActividad(req.empresaId, datosAct.parse(req.body), req.usuario._id)));
r.put('/actividades/:id', gestionar, async (req, res) => {
  const d = datosAct.partial().refine((x) => x.estado !== 'cancelada' || (x.nota || '').trim(), { message: 'Escriba por qué se cancela', path: ['nota'] }).parse(req.body);
  const x = await planes.actualizarActividad(req.empresaId, id(req.params.id), d, req.usuario._id);
  if (d.estado) await auditar(req, 'sst_actividad_estado', { entidad: 'SstActividad', entidadId: x._id, detalle: { titulo: x.titulo, estado: d.estado } });
  res.json(x);
});
r.delete('/actividades/:id', gestionar, async (req, res) => { await planes.borrarActividad(req.empresaId, id(req.params.id)); res.status(204).end(); });
r.post('/plan-anual/:anio/generar', gestionar, async (req, res) => {
  const anio = vigencia.parse(req.params.anio);
  const r2 = await planes.generarPlanAnual(req.empresaId, anio, req.usuario._id);
  await auditar(req, 'sst_plan_anual_generar', { detalle: { anio, ...r2 } });
  res.json(r2);
});
r.get('/plan-anual/:anio/excel', ver, async (req, res) => {
  const anio = vigencia.parse(req.params.anio);
  const items = await planes.actividades(req.empresaId, { anio });
  const res2 = planes.resumenPlan(items);
  const buf = await libroExcel({
    empresa: await Empresa.findById(req.empresaId).lean(),
    titulo: `Plan anual de trabajo SG-SST y PESV ${anio}`,
    subtitulo: `${res2.total} actividades · ${res2.hechas} hechas · ${res2.vencidas} vencidas`,
    columnas: [['Fecha', 12], ['Ciclo', 7], ['Actividad', 60], ['Origen', 12], ['Entidad', 18], ['Norma', 40], ['Responsable', 26], ['Evidencia', 16], ['Estado', 12], ['Nota', 40]]
      .map(([titulo, ancho]) => ({ titulo, ancho })),
    filas: items.map((x) => [new Date(x.fecha).toISOString().slice(0, 10), x.ciclo, x.titulo, { norma: 'Norma', mejora: 'Plan de mejora', propia: 'Propia' }[x.origen],
      ENTIDADES[x.entidad] || x.entidad, x.norma, x.responsable, x.evidencia, { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', cancelada: 'Cancelada' }[x.estado], x.nota]),
  });
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition', `attachment; filename="plan_anual_${anio}.xlsx"`);
  res.send(buf);
});
r.get('/alertas', ver, async (req, res) => res.json(await planes.alertas(req.empresaId)));


// Para el tablero: última autoevaluación, avance del plan del año y alertas
r.get('/planes/resumen', ver, async (req, res) => res.json(await planes.resumenTablero(req.empresaId)));

export default r;
