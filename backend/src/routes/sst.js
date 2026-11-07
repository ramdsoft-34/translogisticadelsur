// SG-SST y PESV: módulo de la oficina (planillas, datos y membrete, colaboradores, flota e inspecciones,
// vencimientos, capacitaciones, formatos y tablero).
// Ver: sst.ver (admin y consulta). Registrar y decidir: sst.gestionar (admin).
import express, { Router } from 'express';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { SstCapacitacion } from '../models/sst.js';
import { autenticar, permitir, soloEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { libroExcel } from '../services/reportes/comun.js';
import { checklistPdf } from '../services/reportes/checklist.js';
import { pdfGuardado, cabecerasDocumento } from '../services/documentos/guardados.js';
import crypto from 'node:crypto';
import * as pl from '../services/sst/planillas.js';
import * as datos from '../services/sst/datos.js';
import * as col from '../services/sst/colaboradores.js';
import * as flota from '../services/sst/flota.js';
import * as insp from '../services/sst/inspecciones.js';
import { vencimientosSst } from '../services/sst/vencimientos.js';
import * as cap from '../services/sst/capacitaciones.js';
import * as fmt from '../services/sst/formatos.js';
import * as archivos from '../services/sst/archivos.js';
import * as sstApp from '../services/sst/app.js';
import { tablero } from '../services/sst/tablero.js';
import * as pdfSst from '../services/reportes/sst.js';

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

// ═════════════ Datos y membrete ═════════════
const txt = (max) => z.string().trim().max(max).optional().default('');
const fechaOpc = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'), z.literal(''), z.null()]).optional()
  .transform((v) => (v ? new Date(`${v}T12:00:00-05:00`) : null));
const fechaReq = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').transform((v) => new Date(`${v}T12:00:00-05:00`));
const numOpc = z.union([z.coerce.number(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v)));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido');
const imagen = z.string().max(datos.MAX_IMAGEN, 'La imagen pesa demasiado (máximo 1 MB)')
  .regex(/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/, 'Suba una imagen PNG o JPG').or(z.literal(''));
const pct = numOpc.refine((v) => v === null || (v >= 0 && v <= 100), 'El porcentaje va de 0 a 100');

r.get('/datos', ver, async (req, res) => res.json(await datos.datosEmpresa(req.empresaId)));
r.put('/datos', gestionar, async (req, res) => {
  const d = z.object({
    responsables: z.object({ representanteLegal: txt(120), documentoRepresentante: txt(20), responsableSst: txt(120), licenciaSst: txt(120), liderPesv: txt(120) }),
    riesgo: z.object({
      arl: txt(80), claseRiesgo: z.enum(['', 'I', 'II', 'III', 'IV', 'V']).default(''), actividadEconomica: txt(160),
      trabajadores: numOpc.refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 100000), 'Número de trabajadores inválido'),
      nivelPesv: z.enum(['', 'basico', 'estandar', 'avanzado']).default(''),
    }),
    autoevaluacion: z.object({ estandares: z.object({ valor: pct, fecha: fechaOpc }), pesv: z.object({ valor: pct, fecha: fechaOpc }) }),
    colores: z.object({ principal: color, acento: color }),
    pieTexto: txt(200),
  }).parse(req.body);
  for (const k of ['estandares', 'pesv']) {
    if (d.autoevaluacion[k].fecha && d.autoevaluacion[k].fecha > new Date()) throw new ErrorHttp(400, 'La fecha de la autoevaluación no puede ser futura');
  }
  const r1 = await datos.guardarDatos(req.empresaId, d, req.usuario._id);
  await auditar(req, 'sst_datos', { detalle: { responsables: d.responsables, riesgo: d.riesgo } });
  res.json(r1);
});
r.get('/datos/membrete', ver, async (req, res) => res.json((await datos.datosEmpresa(req.empresaId, { conImagenes: true })).membrete));
r.put('/datos/membrete/:parte', gestionar, express.json({ limit: '2mb' }), async (req, res) => {
  const parte = z.enum(['encabezado', 'pie']).parse(req.params.parte);
  const { imagen: img } = z.object({ imagen }).parse(req.body);
  const r1 = await datos.guardarMembrete(req.empresaId, parte, img, req.usuario._id);
  await auditar(req, img ? 'sst_membrete' : 'sst_quitar_membrete', { detalle: { parte } });
  res.json(r1);
});

// ═════════════ Colaboradores ═════════════
const persona = z.object({
  tipoId: z.enum(['C', 'E', 'P', 'T']), numId: z.string().trim().regex(/^[0-9A-Za-z]{4,15}$/, 'Documento inválido'),
  nombres: z.string().trim().min(2, 'Escriba los nombres').max(100), apellido1: z.string().trim().min(2, 'Escriba el primer apellido').max(100), apellido2: txt(100),
  celular: z.string().trim().regex(/^(\d{10})?$/, 'El celular tiene 10 dígitos').optional().default(''),
  correo: z.string().trim().toLowerCase().email('Correo inválido').or(z.literal('')).optional().default(''),
});
const datosColab = {
  cargo: txt(120), vinculacion: z.enum(['', 'directo', 'contratista', 'temporal', 'aprendiz']).default(''), ingreso: fechaOpc,
  seguridadSocial: z.object({ eps: txt(80), afp: txt(80), arl: txt(80) }).optional().default({}),
  contactoEmergencia: z.object({ nombre: txt(120), parentesco: txt(40), telefono: txt(20) }).optional().default({}),
};
r.get('/colaboradores', ver, async (req, res) => {
  const q = z.object({ q: txt(100), tipo: z.enum(['', 'conductor', 'directo']).default(''), inactivos: z.enum(['', '1']).default('') }).parse(req.query);
  res.json(await col.listar(req.empresaId, { q: q.q, tipo: q.tipo, inactivos: q.inactivos === '1' }));
});
r.post('/colaboradores/traer', gestionar, async (req, res) => {
  const r1 = await col.traer(req.empresaId);
  await auditar(req, 'sst_traer_colaboradores', { detalle: r1 });
  res.json(r1);
});
r.post('/colaboradores', gestionar, async (req, res) => {
  const d = z.object({ tipo: z.enum(['conductor', 'directo']), terceroId: z.string().regex(/^[a-f0-9]{24}$/i).optional(), persona: persona.optional(), ...datosColab })
    .refine((x) => x.terceroId || x.persona, 'Elija la persona o escriba sus datos').parse(req.body);
  const p = await col.crear(req.empresaId, d);
  await auditar(req, 'sst_nuevo_colaborador', { entidad: 'SstColaborador', entidadId: p.id, detalle: { nombre: p.nombre, documento: p.documento } });
  res.status(201).json(p);
});
r.get('/colaboradores/:id', ver, async (req, res) => {
  await sstApp.sincronizarFirmas(req.empresaId).catch(() => 0);
  const p = await col.perfil(req.empresaId, id(req.params.id));
  // Últimas inspecciones del conductor (si la empresa usa la app)
  let inspecciones = [];
  if (p.tipo === 'conductor') {
    try {
      inspecciones = (await insp.listar(req.empresaId, { desde: '2020-01-01', cedula: p.documento })).items.slice(0, 5)
        .map((x) => ({ id: x.checklistId, fecha: x.fecha, placa: x.placa, resultado: x.resultado }));
    } catch { /* la app no responde: el perfil se ve igual */ }
  }
  res.json({ ...p, inspecciones });
});
r.get('/colaboradores/:id/epp/pdf', ver, async (req, res) => {
  await sstApp.sincronizarFirmas(req.empresaId).catch(() => 0);
  const p = await col.perfil(req.empresaId, id(req.params.id));
  const d = await datos.datosEmpresa(req.empresaId, { conImagenes: true });
  const entregas = await Promise.all(p.eppEntregas.map(async (e) => ({ ...e, firma: e.firmadoEn ? (await col.firmaEpp(req.empresaId, p.id, e.id)).entrega.firma : '' })));
  const generar = () => pdfSst.eppPdf(d, { nombre: p.nombre, documento: p.documento, cargo: p.cargo }, entregas);
  // Con entregas firmadas es evidencia: se guarda y una entrega firmada nueva crea otra versión (la anterior queda)
  const firmadas = entregas.filter(e => e.firmadoEn).map(e => String(e.id)).sort();
  const g = firmadas.length && entregas.every(e => e.firmadoEn)
    ? await pdfGuardado(req.empresaId, { tipo: 'sst-epp', ref: p.id, clave: crypto.createHash('sha1').update(firmadas.join(',')).digest('hex').slice(0, 16),
      nombre: `EPP_${p.documento}.pdf`, generar, usuario: req.usuario._id }) : null;
  await auditar(req, 'descarga', { entidad: 'SstColaborador', entidadId: p.id, detalle: { archivo: 'SST-FOR-02', ...(g ? { version: g.version } : {}) } });
  cabecerasDocumento(res, g);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="EPP_${p.documento}.pdf"`);
  res.send(g ? g.buffer : await generar());
});
r.post('/colaboradores/:id/epp/:epp/pedir-firma', gestionar, async (req, res) => {
  const ok = await sstApp.pedirFirmaEpp(req.empresaId, id(req.params.id), id(req.params.epp));
  if (!ok) throw new ErrorHttp(409, 'No se pudo pedir en la app: el colaborador no tiene la app activada. Tome la firma aquí.');
  res.json(await col.perfil(req.empresaId, id(req.params.id)));
});
r.put('/colaboradores/:id', gestionar, async (req, res) => {
  const d = z.object({ tipo: z.enum(['conductor', 'directo']).optional(), activo: z.boolean().optional(), ...datosColab }).parse(req.body);
  const p = await col.actualizar(req.empresaId, id(req.params.id), d);
  await auditar(req, 'sst_editar_colaborador', { entidad: 'SstColaborador', entidadId: p.id, detalle: { nombre: p.nombre } });
  res.json(p);
});
r.post('/colaboradores/:id/examenes', gestionar, async (req, res) => {
  const d = z.object({
    tipo: z.enum(['ingreso', 'periodico', 'retiro', 'post_incapacidad', 'cambio_cargo']), fecha: fechaReq, vence: fechaOpc,
    concepto: z.enum(['apto', 'apto_restricciones', 'no_apto', 'aplazado']), restricciones: txt(300), entidad: txt(120),
  }).refine((x) => x.concepto !== 'apto_restricciones' || x.restricciones, 'Escriba las restricciones laborales').parse(req.body);
  const p = await col.agregarExamen(req.empresaId, id(req.params.id), d, req.usuario._id);
  await auditar(req, 'sst_examen', { entidad: 'SstColaborador', entidadId: req.params.id, detalle: { tipo: d.tipo, concepto: d.concepto } });
  res.status(201).json(p);
});
r.delete('/colaboradores/:id/examenes/:ex', gestionar, async (req, res) => {
  const p = await col.quitarExamen(req.empresaId, id(req.params.id), id(req.params.ex));
  await auditar(req, 'sst_quitar_examen', { entidad: 'SstColaborador', entidadId: req.params.id });
  res.json(p);
});
const firma = z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Firma inválida');
r.post('/colaboradores/:id/epp', gestionar, express.json({ limit: '1mb' }), async (req, res) => {
  const d = z.object({
    fecha: fechaReq, motivo: z.enum(['entrega', 'reposicion']).default('entrega'),
    elementos: z.array(z.object({ nombre: z.string().trim().min(2).max(80), cantidad: z.coerce.number().int().min(1).max(100).default(1) }))
      .min(1, 'Agregue al menos un elemento').max(20),
    observacion: txt(300), proximaReposicion: fechaOpc, firma: firma.optional(), pedirFirmaApp: z.boolean().optional().default(false),
  }).parse(req.body);
  const { perfil, eppId } = await col.agregarEpp(req.empresaId, id(req.params.id), d, req.usuario._id);
  // Sin firma en la web: si el conductor tiene la app, se le pide que confirme allá
  const pedidaApp = !d.firma && d.pedirFirmaApp ? await sstApp.pedirFirmaEpp(req.empresaId, id(req.params.id), eppId) : false;
  await auditar(req, 'sst_entrega_epp', { entidad: 'SstColaborador', entidadId: req.params.id, detalle: { elementos: d.elementos, firmado: !!d.firma, pedidaApp } });
  res.status(201).json({ ...(pedidaApp ? await col.perfil(req.empresaId, id(req.params.id)) : perfil), eppId, pedidaApp });
});
r.post('/colaboradores/:id/epp/:epp/firma', gestionar, express.json({ limit: '1mb' }), async (req, res) => {
  const d = z.object({ firma }).parse(req.body);
  const p = await col.firmarEpp(req.empresaId, id(req.params.id), id(req.params.epp), d.firma);
  await auditar(req, 'sst_firma_epp', { entidad: 'SstColaborador', entidadId: req.params.id });
  res.json(p);
});
r.delete('/colaboradores/:id/epp/:epp', gestionar, async (req, res) => {
  const p = await col.quitarEpp(req.empresaId, id(req.params.id), id(req.params.epp));
  await auditar(req, 'sst_quitar_epp', { entidad: 'SstColaborador', entidadId: req.params.id });
  res.json(p);
});
r.post('/colaboradores/:id/comparendos', gestionar, async (req, res) => {
  const d = z.object({
    fecha: fechaReq, numero: z.string().trim().regex(/^[0-9A-Za-z-]{3,30}$/, 'Número de comparendo inválido'), codigo: z.string().trim().max(10).toUpperCase(),
    descripcion: txt(300), placa: z.string().trim().max(7).toUpperCase().optional().default(''), valor: z.coerce.number().min(0).max(100_000_000),
    estado: z.enum(['pendiente', 'pagado', 'en_curso']).default('pendiente'),
  }).parse(req.body);
  const p = await col.agregarComparendo(req.empresaId, id(req.params.id), d, req.usuario._id);
  await auditar(req, 'sst_comparendo', { entidad: 'SstColaborador', entidadId: req.params.id, detalle: { numero: d.numero, codigo: d.codigo } });
  res.status(201).json(p);
});
r.put('/colaboradores/:id/comparendos/:c', gestionar, async (req, res) => {
  const { estado } = z.object({ estado: z.enum(['pendiente', 'pagado', 'en_curso']) }).parse(req.body);
  const p = await col.estadoComparendo(req.empresaId, id(req.params.id), id(req.params.c), estado);
  await auditar(req, 'sst_estado_comparendo', { entidad: 'SstColaborador', entidadId: req.params.id, detalle: { estado } });
  res.json(p);
});
r.delete('/colaboradores/:id/comparendos/:c', gestionar, async (req, res) => {
  const p = await col.quitarComparendo(req.empresaId, id(req.params.id), id(req.params.c));
  await auditar(req, 'sst_quitar_comparendo', { entidad: 'SstColaborador', entidadId: req.params.id });
  res.json(p);
});

// ═════════════ Flota e inspecciones ═════════════
r.get('/flota', ver, async (req, res) => res.json(await flota.listar(req.empresaId, await insp.ultimosPorPlaca(req.empresaId))));
// Último preoperacional del vehículo (para su kilometraje)
async function preoDe(req, vehiculoId) {
  const v = await flota.hojaDeVida(req.empresaId, vehiculoId);
  return (await insp.ultimosPorPlaca(req.empresaId)).get(v.vehiculo.placa) || null;
}
r.get('/flota/:id', ver, async (req, res) => res.json(await flota.hojaDeVida(req.empresaId, id(req.params.id), await preoDe(req, id(req.params.id)))));
const poliza = z.object({ vence: fechaOpc, numero: txt(40) }).optional().default({});
r.put('/flota/:id', gestionar, async (req, res) => {
  const d = z.object({
    kilometraje: numOpc.refine((v) => v === null || (v >= 0 && v < 5_000_000), 'Kilometraje inválido'), confirmarBaja: z.boolean().optional().default(false),
    rcContractual: poliza, rcExtracontractual: poliza,
    plan: z.array(z.object({
      actividad: z.string().trim().min(3, 'Escriba la actividad').max(120),
      cadaKm: numOpc.refine((v) => v === null || (v > 0 && v <= 500_000), 'Cada cuántos km: entre 1 y 500.000'),
      cadaDias: numOpc.refine((v) => v === null || (Number.isInteger(v) && v > 0 && v <= 3650), 'Cada cuántos días: entre 1 y 3.650'),
      ultimoKm: numOpc, ultimaFecha: fechaOpc,
    })).max(30).default([]),
  }).parse(req.body);
  const h = await flota.guardarHoja(req.empresaId, id(req.params.id), d, await preoDe(req, id(req.params.id)));
  await auditar(req, 'sst_hoja_vida', { entidad: 'Vehiculo', entidadId: req.params.id, detalle: { placa: h.vehiculo.placa, kilometraje: d.kilometraje, actividades: d.plan.length } });
  res.json(h);
});
r.post('/flota/:id/mantenimientos', gestionar, async (req, res) => {
  const d = z.object({
    fecha: fechaReq, tipo: z.enum(['preventivo', 'correctivo']), actividad: z.string().trim().min(3, 'Escriba la actividad').max(160),
    km: numOpc, taller: txt(120), costo: z.coerce.number().min(0).max(1_000_000_000).default(0),
  }).parse(req.body);
  const h = await flota.agregarMantenimiento(req.empresaId, id(req.params.id), d, req.usuario._id, await preoDe(req, id(req.params.id)));
  await auditar(req, 'sst_mantenimiento', { entidad: 'Vehiculo', entidadId: req.params.id, detalle: { placa: h.vehiculo.placa, tipo: d.tipo, actividad: d.actividad } });
  res.status(201).json(h);
});
r.delete('/flota/:id/mantenimientos/:m', gestionar, async (req, res) => {
  const h = await flota.quitarMantenimiento(req.empresaId, id(req.params.id), id(req.params.m), await preoDe(req, id(req.params.id)));
  await auditar(req, 'sst_quitar_mantenimiento', { entidad: 'Vehiculo', entidadId: req.params.id });
  res.json(h);
});

const diaQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
r.get('/inspecciones', ver, async (req, res) => {
  const q = z.object({ desde: diaQ, hasta: diaQ, placa: txt(10), resultado: z.enum(['', 'apto', 'no_apto']).default('') }).parse(req.query);
  res.json(await insp.listar(req.empresaId, q));
});
r.get('/inspecciones/hoy', ver, async (req, res) => res.json(await insp.hoy(req.empresaId)));
r.get('/inspecciones/:id', ver, async (req, res) => res.json(await insp.detalle(req.empresaId, id(req.params.id))));
r.get('/inspecciones/:id/pdf', ver, async (req, res) => {
  const d = await insp.detalle(req.empresaId, id(req.params.id));
  // El preoperacional es evidencia: se guarda; si después se autoriza la salida, esa es otra versión
  const g = await pdfGuardado(req.empresaId, { tipo: 'preoperacional', ref: req.params.id, clave: d.checklist.autorizacion?.fecha ? 'autorizado' : 'registrado',
    nombre: `preoperacional_${d.checklist.placa}_${d.checklist.dia || ''}.pdf`, usuario: req.usuario._id,
    generar: async () => checklistPdf(await Empresa.findById(req.empresaId).lean(), { viaje: { placa: d.checklist.placa }, conductor: d.chofer, checklist: d.checklist }) });
  const buf = g.buffer;
  cabecerasDocumento(res, g);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="preoperacional_${d.checklist.placa}_${d.checklist.dia || ''}.pdf"`);
  res.send(buf);
});
r.post('/inspecciones/:id/revisar', gestionar, async (req, res) => {
  await insp.detalle(req.empresaId, id(req.params.id));
  const d = z.object({ accion: z.string().trim().min(3, 'Escriba la acción tomada').max(1000) }).parse(req.body);
  const x = await insp.revisar(id(req.params.id), por(req), d.accion);
  await auditar(req, 'sst_revisar_inspeccion', { entidad: 'Preoperacional', entidadId: req.params.id, detalle: { accion: d.accion } });
  res.json(x);
});
// Un preoperacional por día: habilitar que el conductor haga otro hoy (con motivo; le llega un aviso)
r.post('/inspecciones/:id/permitir-repetir', gestionar, async (req, res) => {
  await insp.detalle(req.empresaId, id(req.params.id));
  const d = z.object({ motivo: z.string().trim().min(10, 'Escriba el motivo (mínimo 10 caracteres)').max(500) }).parse(req.body);
  const x = await insp.permitirRepetir(id(req.params.id), por(req), d.motivo);
  await auditar(req, 'sst_permitir_otro_preoperacional', { entidad: 'Preoperacional', entidadId: req.params.id, detalle: { placa: x?.placa, motivo: d.motivo } });
  res.json(x);
});

// ═════════════ Vencimientos ═════════════
r.get('/vencimientos', ver, async (req, res) => {
  const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
  res.json(await vencimientosSst(req.empresaId, { dias, kmPreoperacional: await insp.ultimosPorPlaca(req.empresaId) }));
});

// ═════════════ Tablero ═════════════
r.get('/tablero', ver, async (req, res) => res.json(await tablero(req.empresaId)));

// ═════════════ Capacitaciones ═════════════
const datosCap = z.object({
  fecha: fechaReq, tema: z.string().trim().min(3, 'Escriba el tema').max(200), eje: z.enum(['sst', 'vial', 'ambos']),
  dirigidoA: txt(160), horas: z.coerce.number().min(0.5, 'Mínimo media hora').max(200), facilitador: txt(160), lugar: txt(160), observaciones: txt(1000),
});
r.get('/capacitaciones', ver, async (req, res) => {
  const { anio } = z.object({ anio: z.coerce.number().int().min(2020).max(2100).default(() => new Date().getFullYear()) }).parse(req.query);
  await sstApp.sincronizarFirmas(req.empresaId).catch(() => 0);
  res.json(await cap.listar(req.empresaId, anio));
});
r.post('/capacitaciones', gestionar, async (req, res) => {
  const k = await cap.crear(req.empresaId, datosCap.parse(req.body), req.usuario._id);
  await auditar(req, 'sst_programar_capacitacion', { entidad: 'SstCapacitacion', entidadId: k.id, detalle: { tema: k.tema, fecha: k.fecha } });
  res.status(201).json(k);
});
r.get('/capacitaciones/:id', ver, async (req, res) => {
  await sstApp.sincronizarFirmas(req.empresaId).catch(() => 0);
  res.json(await cap.detalle(req.empresaId, id(req.params.id)));
});
r.put('/capacitaciones/:id', gestionar, async (req, res) => {
  const k = await cap.actualizar(req.empresaId, id(req.params.id), datosCap.parse(req.body), req.usuario._id);
  await auditar(req, 'sst_editar_capacitacion', { entidad: 'SstCapacitacion', entidadId: k.id, detalle: { tema: k.tema } });
  res.json(k);
});
r.delete('/capacitaciones/:id', gestionar, async (req, res) => {
  const antes = await SstCapacitacion.findOne({ empresa: req.empresaId, _id: id(req.params.id) }).select('tema asistentes.solicitudApp').lean();
  await cap.eliminar(req.empresaId, id(req.params.id));
  for (const a of antes?.asistentes || []) if (a.solicitudApp) await sstApp.cancelarSolicitud(req.empresaId, a.solicitudApp);
  const k = { id: req.params.id, tema: antes?.tema };
  await auditar(req, 'sst_eliminar_capacitacion', { entidad: 'SstCapacitacion', entidadId: k.id, detalle: { tema: k.tema } });
  res.status(204).end();
});
r.post('/capacitaciones/:id/asistentes', gestionar, async (req, res) => {
  const d = z.object({
    colaboradores: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(200).default([]),
    externos: z.array(z.object({ nombre: z.string().trim().min(3).max(120), documento: z.string().trim().regex(/^[0-9A-Za-z]{4,15}$/, 'Documento inválido'), cargo: txt(120) })).max(50).default([]),
    pedirFirmaApp: z.boolean().default(true),
  }).parse(req.body);
  let k = await cap.agregarAsistentes(req.empresaId, id(req.params.id), d);
  const pedidas = d.pedirFirmaApp ? await sstApp.pedirFirmasCapacitacion(req.empresaId, k.id) : 0;
  if (pedidas) k = await cap.detalle(req.empresaId, k.id);
  await auditar(req, 'sst_asistentes_capacitacion', { entidad: 'SstCapacitacion', entidadId: k.id, detalle: { agregados: d.colaboradores.length + d.externos.length, pedidasApp: pedidas } });
  res.json({ ...k, pedidasApp: pedidas });
});
r.delete('/capacitaciones/:id/asistentes/:a', gestionar, async (req, res) => {
  const antes = await SstCapacitacion.findOne({ empresa: req.empresaId, _id: id(req.params.id) }).select('asistentes._id asistentes.solicitudApp').lean();
  const solicitud = antes?.asistentes.find((x) => String(x._id) === req.params.a)?.solicitudApp;
  const k = await cap.quitarAsistente(req.empresaId, id(req.params.id), id(req.params.a));
  await sstApp.cancelarSolicitud(req.empresaId, solicitud);
  await auditar(req, 'sst_quitar_asistente', { entidad: 'SstCapacitacion', entidadId: k.id });
  res.json(k);
});
r.post('/capacitaciones/:id/asistentes/:a/firma', gestionar, express.json({ limit: '1mb' }), async (req, res) => {
  const d = z.object({ firma }).parse(req.body);
  const k = await cap.firmar(req.empresaId, id(req.params.id), id(req.params.a), d.firma);
  await auditar(req, 'sst_firma_asistencia', { entidad: 'SstCapacitacion', entidadId: k.id });
  res.json(k);
});
r.post('/capacitaciones/:id/ejecutada', gestionar, async (req, res) => {
  const { ejecutada } = z.object({ ejecutada: z.boolean() }).parse(req.body);
  const k = await cap.ejecutar(req.empresaId, id(req.params.id), ejecutada, req.usuario._id);
  await auditar(req, ejecutada ? 'sst_capacitacion_ejecutada' : 'sst_capacitacion_reabierta', { entidad: 'SstCapacitacion', entidadId: k.id, detalle: { tema: k.tema } });
  res.json(k);
});
r.get('/capacitaciones/:id/pdf', ver, async (req, res) => {
  await sstApp.sincronizarFirmas(req.empresaId).catch(() => 0);
  const k = await cap.paraPdf(req.empresaId, id(req.params.id));
  const generar = async () => pdfSst.asistenciaPdf(await datos.datosEmpresa(req.empresaId, { conImagenes: true }), k);
  // Ejecutada: se guarda; una firma que llegue después crea otra versión (la anterior queda). Programada: se genera cada vez.
  const firmas = (k.asistentes || []).filter(a => a.firmado).length;
  const g = k.ejecutada ? await pdfGuardado(req.empresaId, { tipo: 'sst-asistencia', ref: k.id, clave: `ejecutada:${firmas}`,
    nombre: `asistencia_${k.id}.pdf`, generar, usuario: req.usuario._id }) : null;
  const buf = g ? g.buffer : await generar();
  cabecerasDocumento(res, g);
  await auditar(req, 'descarga', { entidad: 'SstCapacitacion', entidadId: k.id, detalle: { archivo: 'SST-FOR-07', ...(g ? { version: g.version } : {}) } });
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="asistencia_${k.id}.pdf"`);
  res.send(buf);
});

// ═════════════ Formatos ═════════════
r.get('/formatos', ver, (_req, res) => res.json(fmt.catalogo()));
r.get('/formatos/:codigo/definicion', ver, async (req, res) => {
  const f = fmt.formatoDe(req.params.codigo);
  res.json({ ...f, auto: fmt.autoValores(f, await datos.datosEmpresa(req.empresaId)) });
});
r.get('/formatos/:codigo/en-blanco', ver, async (req, res) => {
  const f = fmt.formatoDe(req.params.codigo);
  const def = f.soloApp ? { ...f, secciones: blancoPreoperacional() } : f;
  const buf = await pdfSst.formatoPdf(await datos.datosEmpresa(req.empresaId, { conImagenes: true }), def);
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${f.codigo}_en_blanco.pdf"`);
  res.send(buf);
});
r.get('/diligenciados', ver, async (req, res) => {
  const q = z.object({ codigo: txt(20), q: txt(100) }).parse(req.query);
  res.json(await fmt.listarDiligenciados(req.empresaId, q));
});
const cuerpoFormato = z.object({
  datos: z.record(z.any()).default({}), tablas: z.record(z.array(z.record(z.any()))).default({}),
  items: z.array(z.object({ clave: z.string().max(10), valor: z.string().max(12).default(''), observacion: z.string().max(300).default('') })).max(100).default([]),
  firmas: z.record(z.string().max(400_000)).default({}), final: z.boolean().default(false),
});
r.post('/formatos/:codigo/diligenciados', gestionar, express.json({ limit: '4mb' }), async (req, res) => {
  const d = cuerpoFormato.parse(req.body);
  const x = await fmt.guardar(req.empresaId, req.params.codigo, d, { final: d.final, usuario: req.usuario });
  await auditar(req, d.final ? 'sst_formato_final' : 'sst_formato_borrador', { entidad: 'SstFormato', entidadId: x.id, detalle: { numero: x.numero } });
  res.status(201).json(x);
});
r.get('/diligenciados/:id', ver, async (req, res) => res.json(await fmt.obtener(req.empresaId, id(req.params.id))));
r.put('/diligenciados/:id', gestionar, express.json({ limit: '4mb' }), async (req, res) => {
  const actual = await fmt.obtener(req.empresaId, id(req.params.id));
  const d = cuerpoFormato.parse(req.body);
  const x = await fmt.guardar(req.empresaId, actual.codigo, d, { id: actual.id, final: d.final, usuario: req.usuario });
  await auditar(req, d.final ? 'sst_formato_final' : 'sst_formato_borrador', { entidad: 'SstFormato', entidadId: x.id, detalle: { numero: x.numero, version: x.version } });
  res.json(x);
});
r.delete('/diligenciados/:id', gestionar, async (req, res) => {
  await fmt.eliminarBorrador(req.empresaId, id(req.params.id));
  await auditar(req, 'sst_borrar_borrador', { entidad: 'SstFormato', entidadId: req.params.id });
  res.status(204).end();
});
r.get('/diligenciados/:id/pdf', ver, async (req, res) => {
  const x = await fmt.obtener(req.empresaId, id(req.params.id), { conFirmas: true });
  const generar = async () => pdfSst.formatoPdf(await datos.datosEmpresa(req.empresaId, { conImagenes: true }), fmt.formatoDe(x.codigo), x);
  // Cada versión final es evidencia y se guarda; el borrador se genera cada vez
  const g = x.estado === 'final' ? await pdfGuardado(req.empresaId, { tipo: 'sst-formato', ref: x.id, clave: `v${x.version}`,
    nombre: `${x.numero}_v${x.version}.pdf`, generar, usuario: req.usuario._id }) : null;
  const buf = g ? g.buffer : await generar();
  cabecerasDocumento(res, g);
  await auditar(req, 'descarga', { entidad: 'SstFormato', entidadId: x.id, detalle: { archivo: x.numero, ...(g ? { version: g.version } : {}) } });
  res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="${x.numero}.pdf"`);
  res.send(buf);
});

// ── Word y Excel propios ──
r.get('/archivos', ver, async (req, res) => res.json(await archivos.listar(req.empresaId)));
r.post('/archivos', gestionar, express.raw({ type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], limit: archivos.MAX_ARCHIVO }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new ErrorHttp(400, 'Adjunte el archivo');
  let nombre = 'documento';
  try { nombre = decodeURIComponent(req.get('x-nombre-archivo') || 'documento'); } catch { /* nombre ilegible */ }
  let descripcion = '';
  try { descripcion = decodeURIComponent(req.get('x-descripcion') || '').slice(0, 300); } catch { /* sin descripción */ }
  const a = await archivos.subir(req.empresaId, { nombre, descripcion, datos: req.body }, req.usuario);
  await auditar(req, 'sst_subir_archivo', { entidad: 'SstArchivo', entidadId: a.id, detalle: { nombre: a.nombre } });
  res.status(201).json(a);
});
r.get('/archivos/:id', ver, async (req, res) => {
  const d = await datos.datosEmpresa(req.empresaId, { conImagenes: true });
  const a = await archivos.descargar(req.empresaId, id(req.params.id), datos.variables(d), d);
  await auditar(req, 'descarga', { entidad: 'SstArchivo', entidadId: req.params.id, detalle: { archivo: a.nombre } });
  res.type(a.tipo === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
  res.send(a.datos);
});
r.delete('/archivos/:id', gestionar, async (req, res) => {
  const a = await archivos.eliminar(req.empresaId, id(req.params.id));
  await auditar(req, 'sst_borrar_archivo', { entidad: 'SstArchivo', entidadId: req.params.id, detalle: { nombre: a.nombre } });
  res.status(204).end();
});
r.get('/variables', ver, async (req, res) => res.json(datos.variables(await datos.datosEmpresa(req.empresaId))));

// ── Reportes de incidentes desde la app ──
r.get('/incidentes', ver, async (req, res) => {
  const { estado } = z.object({ estado: z.enum(['', 'recibido', 'en_investigacion', 'cerrado']).default('') }).parse(req.query);
  res.json(await sstApp.incidentes(req.empresaId, estado));
});
r.put('/incidentes/:id', gestionar, async (req, res) => {
  const d = z.object({ estado: z.enum(['recibido', 'en_investigacion', 'cerrado']), nota: txt(500) }).parse(req.body);
  const x = await sstApp.seguimientoIncidente(req.empresaId, id(req.params.id), { ...d, por: por(req) });
  await auditar(req, 'sst_seguimiento_incidente', { entidad: 'IncidenteSst', entidadId: req.params.id, detalle: d });
  res.json(x);
});
// El reporte de la app queda como formato PESV-FOR-01 (la oficina completa las acciones y lo guarda)
r.post('/incidentes/:id/formato', gestionar, async (req, res) => {
  const { items } = await sstApp.incidentes(req.empresaId);
  const i = items.find((x) => x.id === req.params.id);
  if (!i) throw new ErrorHttp(404, 'Reporte no encontrado');
  const ya = (await fmt.listarDiligenciados(req.empresaId, { codigo: 'PESV-FOR-01' })).find((x) => x.referencia === i.id);
  if (ya) return res.json(ya);
  const x = await fmt.guardar(req.empresaId, 'PESV-FOR-01', sstApp.datosFormatoIncidente(i), { usuario: req.usuario, origen: 'app', referencia: i.id });
  await auditar(req, 'sst_incidente_formato', { entidad: 'SstFormato', entidadId: x.id, detalle: { numero: x.numero, incidente: i.id } });
  res.status(201).json(x);
});

// ── Vista previa del membrete ──
r.get('/datos/membrete/muestra', ver, async (req, res) => {
  const buf = await pdfSst.muestraMembrete(await datos.datosEmpresa(req.empresaId, { conImagenes: true }));
  res.type('application/pdf').setHeader('Content-Disposition', 'inline; filename="membrete.pdf"');
  res.send(buf);
});

// El preoperacional en blanco (SST-FOR-06): los 25 ítems para imprimir, por si falla el celular
function blancoPreoperacional() {
  return [
    { tipo: 'campos', titulo: 'Datos', campos: [{ clave: 'placa', etiqueta: 'Placa' }, { clave: 'conductor', etiqueta: 'Conductor' }, { clave: 'fecha', etiqueta: 'Fecha y hora' }, { clave: 'km', etiqueta: 'Kilometraje' }] },
    { tipo: 'items', titulo: 'Ítems (Bien / Mal / N/A)', items: ITEMS_PREOPERACIONAL.map((t, i) => ({ clave: `i${i + 1}`, texto: t })) },
    { tipo: 'texto', clave: 'obs', titulo: 'Observaciones' },
    { tipo: 'firmas', firmas: [{ clave: 'conductor', etiqueta: 'Firma del conductor' }, { clave: 'revisa', etiqueta: 'Revisado por' }] },
  ];
}
const ITEMS_PREOPERACIONAL = ['Licencia de conducción (crítico)', 'Licencia de tránsito', 'Tarjeta de operación', 'SOAT (crítico)', 'Revisión técnico-mecánica (crítico)',
  'Revisión preventiva', 'Póliza de responsabilidad civil', 'Formato FUEC', 'Soporte de inspección', 'Soporte de limpieza', 'Cinturones y pito (crítico)', 'Luces (crítico)',
  'Caja de herramientas', 'Gato y conos', 'Extintor', 'Sistema eléctrico', 'Baterías', 'Espejos retrovisores', 'Dirección (crítico)', 'Motor', 'Tanque de combustible',
  'Vidrios panorámicos', 'Limpiaparabrisas', 'Frenos de servicio (crítico)', 'Estado de las llantas (crítico)'];

export default r;
