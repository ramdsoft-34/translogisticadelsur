// Viajes (bitácora). Cada viaje concentra los datos operativos y el estado de
// sus documentos en el RNDC (remesa, manifiesto y cumplidos).
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Viaje, Cliente, Tarifa, Tercero, Vehiculo, PlantillaWhatsapp, siguiente, proximo, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P, tienePermiso } from '../config/permisos.js';
import { auditar, cambios } from '../services/auditoria.js';
import { mensajesPorCliente, PLANTILLA_BASE, MARCADORES } from '../services/whatsapp.js';
import { asegurarMesAbierto } from '../services/gestion/cierre.js';
import { exigirDocumentosVigentes, registrarAutorizacion } from '../services/gestion/documentos.js';
import { reglasDe, pesoPorTamano } from '../services/gestion/reglas.js';
import { lineaLiquidacion, respaldosAuxiliar } from '../services/calculos.js';
import * as liq from '../services/gestion/liquidacionConductor.js';
import { parseFecha, hoyColombia, escaparRegex } from '../utils/texto.js';
import { saldoViaje, utilidadViaje, valoresDesdeTarifa } from '../services/calculos.js';
// Autorización del administrador para registrar con documentos vencidos (CA-06)
export const autorizacionSchema = z.object({ email: z.string().trim().max(120), clave: z.string().max(100), codigo: z.string().max(10).optional().default(''),
  motivo: z.string().trim().max(300) }).optional();
import * as rastreo from '../services/rastreo/surtrack.js';
import { asegurarSoporte } from '../services/gestion/soporteInterno.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const oid = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const dinero = z.coerce.number().min(0);
const viajeSchema = z.object({
  fecha: z.union([z.string(), z.date()]).transform(v => parseFecha(v)).refine(Boolean, 'fecha inválida'),
  cliente: oid,
  tarifaRef: oid.nullable().optional(),
  destino: z.string().trim().min(2).max(120),
  codOrigen: z.string().trim().regex(/^(\d{8})?$/, 'DIVIPOLA de 8 dígitos').optional(),
  codDestino: z.string().trim().regex(/^(\d{8})?$/, 'DIVIPOLA de 8 dígitos').optional(),
  placa: z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida')),
  remolque: z.string().trim().toUpperCase().max(6).optional(),
  conductor: oid,
  titular: oid.nullable().optional(),
  destinatario: z.object({ tipoId: z.string().trim().max(1).optional().default(''), numId: z.string().trim().max(15).optional().default(''),
    sede: z.string().trim().max(6).optional().default('') }).optional(),
  pesoKg: dinero.optional(), cantidad: dinero.optional(), conAuxiliar: z.boolean().optional(),
  diasAuxiliar: z.coerce.number().int().min(0).max(5, 'el auxiliar va de 1 a 5 días').optional(), planilla: z.string().trim().max(30).optional(),
  tarifa: dinero.optional(), flete: dinero.optional(), anticipo: dinero.optional(),
  observaciones: z.string().trim().max(500).optional(),
  licencia: z.string().trim().max(40).optional(),
  // N° de manifiesto escrito a mano (opcional): se usa al expedir en el RNDC
  numeroManifiesto: z.string().trim().toUpperCase().max(15).optional(),
  historico: z.boolean().optional(),
  requiereManifiesto: z.boolean().optional(),
  origen: z.enum(['viajes', 'manifiesto']).optional(),
});

// El titular del manifiesto sale del vehículo (titular habitual); si no tiene, es el conductor (null).
export async function titularDePlaca(empresaId, placa) {
  const v = await Vehiculo.findOne({ empresa: empresaId, placa }).select('titularHabitual').lean();
  return v?.titularHabitual || null;
}
// Después de expedir documentos en el RNDC solo se pueden cambiar datos internos.
const CAMPOS_INTERNOS = ['observaciones', 'cantidad', 'conAuxiliar', 'diasAuxiliar', 'planilla', 'tarifa', 'historico', 'licencia'];
// «Manifiesto» del formulario → número manual del manifiesto para el RNDC
function numeroManifiestoA(d) {
  if (d.numeroManifiesto === undefined) return;
  d['numerosManuales.manifiesto'] = d.numeroManifiesto; delete d.numeroManifiesto;
}

const POBLAR = (req) => [
  pob(req.empresaId, 'cliente', 'nombre nit dv tipoId'),
  pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId tipoId celular'),
  pob(req.empresaId, 'titular', 'nombres apellido1 apellido2 numId tipoId'),
];

const nombreTercero = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
function presentar(v) {
  return { ...v, conductorNombre: nombreTercero(v.conductor) || v.conductorNombre || '', titularNombre: nombreTercero(v.titular),
    saldo: saldoViaje(v), utilidad: utilidadViaje(v) };
}

// Verifica que todas las referencias pertenezcan a la empresa del usuario.
async function validarReferencias(req, d) {
  const chequeos = [];
  if (d.cliente) chequeos.push(Cliente.exists(deEmpresa(req, { _id: d.cliente })).then(x => x || 'cliente'));
  if (d.tarifaRef) chequeos.push(Tarifa.exists(deEmpresa(req, { _id: d.tarifaRef, cliente: d.cliente })).then(x => x || 'destino/tarifa'));
  if (d.conductor) chequeos.push(Tercero.exists(deEmpresa(req, { _id: d.conductor })).then(x => x || 'conductor'));
  if (d.titular) chequeos.push(Tercero.exists(deEmpresa(req, { _id: d.titular })).then(x => x || 'titular'));
  const malos = (await Promise.all(chequeos)).filter(x => typeof x === 'string');
  if (malos.length) throw new ErrorHttp(400, `Datos que no pertenecen a su empresa: ${malos.join(', ')}`);
}

function filtroLista(req) {
  const f = deEmpresa(req);
  const desde = parseFecha(req.query.desde); const hasta = parseFecha(req.query.hasta);
  if (desde || hasta) f.fecha = { ...(desde ? { $gte: desde } : {}), ...(hasta ? { $lte: hasta } : {}) };
  if (req.query.cliente && mongoose.isValidObjectId(req.query.cliente)) f.cliente = req.query.cliente;
  if (req.query.estado) f.estado = { $in: String(req.query.estado).split(',') };
  if (req.query.placa) f.placa = new RegExp(escaparRegex(String(req.query.placa).toUpperCase()));
  if (req.query.sinLiquidar === '1') f.liquidacion = null;
  if (req.query.historico === '0') f.historico = { $ne: true };
  if (req.query.historico === '1') f.historico = true;
  // Solo los viajes que deben expedir remesa y manifiesto (módulo Manifiestos RNDC)
  if (req.query.rndc === '1') f.requiereManifiesto = { $ne: false };
  // Viajes sin manifiesto del RNDC (pestaña «Soporte interno»)
  if (req.query.soporte === '1') f.requiereManifiesto = false;
  // Estado del soporte interno: vigente (sin cumplir), cumplido o anulado
  if (['vigente', 'cumplido', 'anulado'].includes(req.query.soporteEstado)) f['soporteInterno.estado'] = req.query.soporteEstado === 'vigente' ? { $in: ['', null] } : req.query.soporteEstado;
  // Con remesa o manifiesto anulados en el RNDC: fuera de «Por enviar» (anulados=0) o solo ellos (anulados=1)
  const anulado = [{ 'remesa.estado': 'anulado' }, { 'manifiesto.estado': 'anulado' },
    { 'anuladoBase.remesa': { $nin: ['', null] }, 'remesa.estado': { $ne: 'aceptado' } },
    { 'anuladoBase.manifiesto': { $nin: ['', null] }, 'manifiesto.estado': { $ne: 'aceptado' } }];
  if (req.query.anulados === '0') f.$nor = anulado;
  if (req.query.anulados === '1') (f.$and ||= []).push({ $or: anulado });
  if (req.query.q) {
    const re = new RegExp(escaparRegex(req.query.q), 'i');
    f.$or = [{ destino: re }, { placa: re }, { 'manifiesto.numero': re }, { 'remesa.numero': re }, { observaciones: re }, { conductorNombre: re }, { planilla: re }];
  }
  return f;
}

r.get('/', permitir(P.VIAJES_VER), async (req, res) => {
  const limite = Math.min(Number(req.query.limite) || 100, 1000);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);
  const filtro = filtroLista(req);
  // En la agregación los identificadores no se convierten solos
  const filtroAgg = { ...filtro, empresa: new mongoose.Types.ObjectId(String(req.empresaId)) };
  if (typeof filtroAgg.cliente === 'string') filtroAgg.cliente = new mongoose.Types.ObjectId(filtroAgg.cliente);
  const [total, listaSinAux, sumas] = await Promise.all([
    Viaje.countDocuments(filtro),
    Viaje.find(filtro).sort({ fecha: -1, numero: -1 }).skip((pagina - 1) * limite).limit(limite).populate(POBLAR(req)).lean(),
    // Totales de TODO el filtro (no solo de la página cargada)
    pagina === 1 ? Viaje.aggregate([{ $match: filtroAgg }, { $group: { _id: null, flete: { $sum: '$flete' }, anticipo: { $sum: '$anticipo' }, tarifa: { $sum: '$tarifa' } } }]) : null,
  ]);
  const lista = await conAuxiliar(req, listaSinAux);
  // Sin coincidencias la agregación no devuelve grupo: las sumas son cero
  const s = sumas ? (sumas[0] || { flete: 0, anticipo: 0, tarifa: 0 }) : null;
  res.json({ total, pagina, limite, viajes: lista.map(presentar),
    ...(s ? { sumas: { flete: s.flete, anticipo: s.anticipo, tarifa: s.tarifa, saldo: s.flete - s.anticipo, ...(await sumasConductor(req, filtro)) } } : {}) });
});

// Auxiliar pagado al conductor de cada viaje de la página (columna «Auxiliar» de la lista)
async function conAuxiliar(req, viajes) {
  if (!viajes.length) return viajes;
  const tarifas = await Tarifa.find(deEmpresa(req, { cliente: { $in: [...new Set(viajes.map(v => String(v.cliente?._id || v.cliente)))] } })).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t])); const respaldo = respaldosAuxiliar(tarifas);
  return viajes.map(v => ({ ...v, auxiliar: lineaLiquidacion(v, porId.get(String(v.tarifaRef?._id || v.tarifaRef)), { respaldo: respaldo.get(String(v.cliente?._id || v.cliente)) }).totalAuxiliarPagado }));
}

// Próximo N° de registro (sin consumirlo), para mostrarlo en el formulario
r.get('/siguiente-numero', permitir(P.VIAJES_VER), async (req, res) => res.json({ numero: await proximo(req.empresaId, 'viaje') }));

// Auxiliar pagado, retefuente y FOPAT de todos los viajes del filtro (mismas reglas de la liquidación del conductor)
async function sumasConductor(req, filtro) {
  const viajes = await Viaje.find(filtro).select('flete anticipo destino placa cliente tarifaRef conAuxiliar diasAuxiliar cantidad').limit(20000).lean();
  if (!viajes.length) return { auxiliar: 0, retefuente: 0, fopat: 0 };
  const [reglas, tarifas, vehiculos] = await Promise.all([reglasDe(req.empresaId),
    Tarifa.find(deEmpresa(req, { cliente: { $in: [...new Set(viajes.map(v => String(v.cliente)))] } })).lean(),
    Vehiculo.find(deEmpresa(req, { placa: { $in: [...new Set(viajes.map(v => v.placa))] } })).select('placa pbv').lean()]);
  const porId = new Map(tarifas.map(t => [String(t._id), t])); const respaldo = respaldosAuxiliar(tarifas);
  const pbv = new Map(vehiculos.map(v => [v.placa, v.pbv]));
  const t = { auxiliar: 0, retefuente: 0, fopat: 0 };
  for (const v of viajes) {
    const flete = Number(v.flete) || 0;
    t.auxiliar += lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo: respaldo.get(String(v.cliente)) }).totalAuxiliarPagado;
    t.retefuente += liq.retefuente(flete, reglas); t.fopat += liq.fopat(flete, pbv.get(v.placa), v.destino, reglas);
  }
  return t;
}

r.get('/resumen', permitir(P.VIAJES_VER), async (req, res) => {
  const hoy = hoyColombia();
  const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const base = { empresa: new mongoose.Types.ObjectId(String(req.empresaId)) };
  const [hoyN, porEstado, mes] = await Promise.all([
    Viaje.countDocuments(deEmpresa(req, { fecha: hoy })),
    // Los históricos importados del Excel no cuentan como pendientes de RNDC
    // Igual que «Por enviar» en Manifiestos RNDC: sin históricos, sin los que no requieren manifiesto y sin anulados
    Viaje.aggregate([{ $match: { ...base, historico: { $ne: true }, requiereManifiesto: { $ne: false },
      $nor: [{ 'remesa.estado': 'anulado' }, { 'manifiesto.estado': 'anulado' }] } }, { $group: { _id: '$estado', n: { $sum: 1 } } }]),
    Viaje.aggregate([{ $match: { ...base, fecha: { $gte: inicioMes }, estado: { $ne: 'anulado' } } },
      { $group: { _id: null, viajes: { $sum: 1 }, tarifa: { $sum: '$tarifa' }, flete: { $sum: '$flete' }, anticipo: { $sum: '$anticipo' } } }]),
  ]);
  const estados = Object.fromEntries(porEstado.map(x => [x._id, x.n]));
  // Tablero de inicio: tendencia de 14 días, mes anterior al mismo día, clientes, rechazos, en ruta y últimos viajes
  const desde14 = new Date(hoy.getTime() - 13 * 86400000);
  const inicioAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
  const mismoDiaAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, Math.min(hoy.getUTCDate(), 28), 23, 59));
  const vivos = { ...base, estado: { $ne: 'anulado' } };
  const [serie, mesAnt, clientes, rechazos, enRuta, ultimos] = await Promise.all([
    Viaje.aggregate([{ $match: { ...vivos, fecha: { $gte: desde14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } }, viajes: { $sum: 1 }, tarifa: { $sum: '$tarifa' } } }]),
    Viaje.aggregate([{ $match: { ...vivos, fecha: { $gte: inicioAnt, $lte: mismoDiaAnt } } },
      { $group: { _id: null, viajes: { $sum: 1 }, tarifa: { $sum: '$tarifa' } } }]),
    Viaje.aggregate([{ $match: { ...vivos, fecha: { $gte: inicioMes } } },
      { $group: { _id: '$cliente', viajes: { $sum: 1 }, tarifa: { $sum: '$tarifa' } } }, { $sort: { tarifa: -1 } }, { $limit: 5 },
      { $lookup: { from: 'clientes', localField: '_id', foreignField: '_id', as: 'c' } }]),
    Viaje.countDocuments(deEmpresa(req, { historico: { $ne: true }, requiereManifiesto: { $ne: false },
      $or: [{ 'remesa.estado': 'rechazado' }, { 'manifiesto.estado': 'rechazado' }], estado: { $in: ['registrado', 'remesa'] } })),
    Viaje.countDocuments(deEmpresa(req, { 'rastreo.activo': true })),
    Viaje.find(deEmpresa(req, {})).sort({ createdAt: -1 }).limit(6)
      .select('numero fecha placa destino estado conductorNombre tarifa cliente requiereManifiesto').populate(pob(req.empresaId, 'cliente', 'nombre')).lean(),
  ]);
  const porDia = new Map(serie.map(x => [x._id, x]));
  const dias = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(desde14.getTime() + i * 86400000).toISOString().slice(0, 10);
    return { dia: d, viajes: porDia.get(d)?.viajes || 0, tarifa: porDia.get(d)?.tarifa || 0 };
  });
  res.json({ hoy: hoyN, estados, mes: mes[0] || { viajes: 0, tarifa: 0, flete: 0, anticipo: 0 },
    mesAnterior: mesAnt[0] || { viajes: 0, tarifa: 0 }, dias, rechazos, enRuta,
    clientes: clientes.map(c => ({ nombre: c.c?.[0]?.nombre || 'Sin cliente', viajes: c.viajes, tarifa: c.tarifa })),
    ultimos: ultimos.map(v => ({ _id: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, destino: v.destino, estado: v.estado,
      conductor: v.conductorNombre, cliente: v.cliente?.nombre || '', tarifa: v.tarifa, sinManifiesto: v.requiereManifiesto === false })) });
});

// ── Reporte de vehículos por WhatsApp (plantillas editables) ──────────────
const plantillaSchema = z.object({
  nombre: z.string().trim().min(2).max(60),
  encabezado: z.string().max(1000).optional().default(''),
  linea: z.string().min(1, 'Escriba el texto de cada viaje').max(1000),
  separador: z.enum(['blanco', 'linea', 'guiones']).optional().default('blanco'),
  pie: z.string().max(1000).optional().default(''),
  predeterminada: z.boolean().optional().default(false),
});

async function viajesDelReporte(req, fecha, incluirReportados) {
  const filtro = deEmpresa(req, { fecha, estado: { $ne: 'anulado' } });
  if (!incluirReportados) filtro['reporteWhatsapp.fecha'] = null;
  const viajes = (await Viaje.find(filtro).sort({ numero: 1 }).populate(POBLAR(req))
    .populate(pob(req.empresaId, 'cliente', 'nombre whatsapp')).lean()).map(presentar);
  // Auxiliar pagado al conductor de cada viaje (para el reporte y la opción «Unificar auxiliar»)
  const tarifas = viajes.length ? await Tarifa.find(deEmpresa(req, { cliente: { $in: [...new Set(viajes.map(v => String(v.cliente?._id)))] } })).lean() : [];
  const porId = new Map(tarifas.map(t => [String(t._id), t])); const respaldo = respaldosAuxiliar(tarifas);
  return viajes.map(v => ({ ...v, auxiliar: lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo: respaldo.get(String(v.cliente?._id)) }).totalAuxiliarPagado }));
}

// Plantilla pedida, la predeterminada de la empresa o la de la plataforma.
async function plantillaDe(req, id) {
  if (id && id !== 'base' && mongoose.isValidObjectId(id)) {
    const p = await PlantillaWhatsapp.findOne(deEmpresa(req, { _id: id })).lean();
    if (p) return p;
  }
  if (id === 'base') return { _id: 'base', ...PLANTILLA_BASE };
  return (await PlantillaWhatsapp.findOne(deEmpresa(req, { predeterminada: true })).lean()) || { _id: 'base', ...PLANTILLA_BASE };
}

r.get('/reporte-whatsapp', permitir(P.VIAJES_VER), async (req, res) => {
  const fecha = parseFecha(req.query.fecha) || hoyColombia();
  const plantilla = await plantillaDe(req, req.query.plantilla);
  const viajes = await viajesDelReporte(req, fecha, req.query.incluirReportados === '1');
  const opciones = { unificarAuxiliar: req.query.unificarAuxiliar === '1' };
  // Con seleccion=1 el mensaje lleva solo los viajes elegidos (ninguno si no se eligió nada)
  const elegidos = req.query.seleccion === '1'
    ? (() => { const ids = new Set(String(req.query.viajes || '').split(',').filter(Boolean)); return viajes.filter(v => ids.has(String(v._id))); })()
    : viajes;
  res.json({
    fecha, plantilla: plantilla._id,
    // Valores originales del viaje (la unificación del auxiliar solo cambia el texto del mensaje)
    viajes: viajes.map(v => ({ _id: v._id, numero: v.numero, placa: v.placa, conductor: v.conductorNombre, destino: v.destino,
      cliente: v.cliente?.nombre || '', reportado: !!v.reporteWhatsapp?.fecha, reportadoEn: v.reporteWhatsapp?.fecha || null,
      flete: Number(v.flete) || 0, anticipo: Number(v.anticipo) || 0, auxiliar: Number(v.auxiliar) || 0, diasAuxiliar: v.auxiliar ? (Number(v.diasAuxiliar) || 1) : 0 })),
    mensajes: mensajesPorCliente(elegidos, fecha, new Date(), plantilla, opciones),
  });
});

// Vista previa de una plantilla en edición con los viajes de la fecha (no guarda nada).
r.post('/reporte-whatsapp/vista-previa', permitir(P.VIAJES_VER), async (req, res) => {
  const d = z.object({ fecha: z.string().optional(), plantilla: plantillaSchema.partial({ nombre: true }), unificarAuxiliar: z.boolean().optional().default(false) }).parse(req.body);
  const fecha = parseFecha(d.fecha) || hoyColombia();
  const viajes = await viajesDelReporte(req, fecha, true);
  res.json({ fecha, mensajes: mensajesPorCliente(viajes, fecha, new Date(), d.plantilla, { unificarAuxiliar: d.unificarAuxiliar }) });
});

r.get('/plantillas-whatsapp', permitir(P.VIAJES_VER), async (req, res) => {
  const propias = await PlantillaWhatsapp.find(deEmpresa(req)).sort({ nombre: 1 }).lean();
  res.json({ marcadores: MARCADORES, plantillas: [{ _id: 'base', ...PLANTILLA_BASE, predeterminada: !propias.some(p => p.predeterminada), base: true }, ...propias] });
});

async function guardarPlantilla(req, res, existente) {
  const d = plantillaSchema.parse(req.body);
  if (d.predeterminada) await PlantillaWhatsapp.updateMany(deEmpresa(req, { predeterminada: true }), { $set: { predeterminada: false } });
  let p;
  if (existente) { existente.set(d); p = await existente.save(); }
  else p = await PlantillaWhatsapp.create({ ...d, empresa: req.empresaId, creadoPor: req.usuario._id });
  await auditar(req, existente ? 'editar_plantilla_whatsapp' : 'crear_plantilla_whatsapp', { entidad: 'PlantillaWhatsapp', entidadId: p._id, detalle: { nombre: p.nombre } });
  res.status(existente ? 200 : 201).json(p);
}
r.post('/plantillas-whatsapp', permitir(P.VIAJES_REGISTRAR), (req, res) => guardarPlantilla(req, res, null));
r.put('/plantillas-whatsapp/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const p = mongoose.isValidObjectId(req.params.id) && await PlantillaWhatsapp.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!p) throw new ErrorHttp(404, 'Plantilla no encontrada (la de la plataforma no se modifica: cree una copia)');
  await guardarPlantilla(req, res, p);
});
r.delete('/plantillas-whatsapp/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const p = mongoose.isValidObjectId(req.params.id) && await PlantillaWhatsapp.findOneAndDelete(deEmpresa(req, { _id: req.params.id }));
  if (!p) throw new ErrorHttp(404, 'Plantilla no encontrada');
  await auditar(req, 'eliminar_plantilla_whatsapp', { entidad: 'PlantillaWhatsapp', entidadId: p._id, detalle: { nombre: p.nombre } });
  res.json({ ok: true });
});

// Marca los viajes como reportados (columna «Reportado» de la bitácora).
r.post('/reporte-whatsapp/marcar', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const { viajes } = z.object({ viajes: z.array(oid).min(1).max(500) }).parse(req.body);
  const r2 = await Viaje.updateMany(deEmpresa(req, { _id: { $in: viajes } }),
    { $set: { 'reporteWhatsapp.fecha': new Date(), 'reporteWhatsapp.usuario': req.usuario._id } });
  await auditar(req, 'reporte_whatsapp', { entidad: 'Viaje', detalle: { viajes: viajes.length, marcados: r2.modifiedCount } });
  res.json({ marcados: r2.modifiedCount });
});

r.get('/:id', permitir(P.VIAJES_VER), async (req, res) => {
  const v = await Viaje.findOne(deEmpresa(req, { _id: req.params.id })).populate(POBLAR(req)).populate(pob(req.empresaId, 'tarifaRef')).lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  res.json(presentar(v));
});

r.post('/', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const rastrear = req.body?.rastrear === true;
  const autorizacion = autorizacionSchema.parse(req.body?.autorizacion);
  const d = viajeSchema.parse(req.body);
  if (d.numeroManifiesto) d.numerosManuales = { remesa: '', manifiesto: d.numeroManifiesto };
  delete d.numeroManifiesto;
  await validarReferencias(req, d);
  // Mes cerrado y documentos del viaje (licencia, SOAT y tecnomecánica vencidos no dejan registrar sin autorización del administrador)
  await asegurarMesAbierto(req.empresaId, d.fecha);
  const { avisos: avisosDocumentos, autorizado } = await exigirDocumentosVigentes(req.empresaId, { conductor: d.conductor, placa: d.placa }, autorizacion);
  // Con auxiliar: de 1 a 5 días (sin indicar, 1)
  if (d.conAuxiliar && !d.diasAuxiliar) d.diasAuxiliar = 1;
  // Valores sugeridos por la tarifa del destino cuando no se escriben
  if (d.tarifaRef) {
    const t = await Tarifa.findOne(deEmpresa(req, { _id: d.tarifaRef })).lean();
    const sug = valoresDesdeTarifa(t);
    for (const k of ['tarifa', 'flete', 'anticipo', 'pesoKg', 'codDestino']) if (d[k] === undefined || d[k] === '') d[k] = sug[k];
    if (!d.destinatario?.numId && sug.destinatario?.numId) d.destinatario = sug.destinatario;
  }
  // Remolque habitual / conductor del vehículo no se imponen: solo se sugieren en la interfaz.
  if (!d.titular) d.titular = await titularDePlaca(req.empresaId, d.placa);
  if (d.origen === 'manifiesto') d.requiereManifiesto = true;
  const numero = await siguiente(req.empresaId, 'viaje');
  const cond = await Tercero.findOne(deEmpresa(req, { _id: d.conductor })).select('nombres apellido1 apellido2').lean();
  const v = await Viaje.create({ ...d, numero, conductorNombre: nombreTercero(cond), empresa: req.empresaId,
    creadoPor: req.usuario._id, actualizadoPor: req.usuario._id });
  // Sin manifiesto del RNDC: el soporte interno es obligatorio y se numera al registrar
  await asegurarSoporte(req.empresaId, v._id);
  await auditar(req, 'crear_viaje', { entidad: 'Viaje', entidadId: v._id, detalle: { numero, placa: v.placa, destino: v.destino } });
  if (autorizado) {
    await registrarAutorizacion(req.empresaId, autorizado, [v], req.usuario);
    await auditar(req, 'autorizar_documentos_vencidos', { entidad: 'Viaje', entidadId: v._id,
      detalle: { numero, administrador: autorizado.admin.email, motivo: autorizado.motivo, vencidos: autorizado.vencidos } });
  }
  // «Rastrear este viaje con Sur Track»: si falla, el viaje queda registrado igual y se avisa
  let errorRastreo = '';
  if (rastrear) {
    try {
      await rastreo.activar(req.empresaId, v._id, req.usuario._id);
      await auditar(req, 'activar_rastreo', { entidad: 'Viaje', entidadId: v._id });
    } catch (e) { errorRastreo = e.message; }
  }
  res.status(201).json({ ...presentar((await Viaje.findOne(deEmpresa(req, { _id: v._id })).populate(POBLAR(req)).lean())), avisosDocumentos, errorRastreo });
});

async function viajeEditable(req) {
  const v = await Viaje.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  const propio = String(v.creadoPor) === String(req.usuario._id);
  if (!tienePermiso(req.usuario.rol, P.VIAJES_EDITAR_TODOS) && !propio) throw new ErrorHttp(403, 'Solo puede modificar los viajes que usted registró');
  if (v.liquidacion) throw new ErrorHttp(409, 'El viaje ya está en una liquidación de fletes');
  if (v.liquidacionConductor) throw new ErrorHttp(409, 'El viaje ya está liquidado al conductor: anule esa liquidación para modificarlo');
  await asegurarMesAbierto(req.empresaId, v.fecha);
  return v;
}

r.put('/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const v = await viajeEditable(req);
  let d = viajeSchema.partial().parse(req.body);
  if (d.numeroManifiesto !== undefined && v.manifiesto?.estado === 'aceptado') delete d.numeroManifiesto;
  numeroManifiestoA(d);
  if (d.fecha) await asegurarMesAbierto(req.empresaId, d.fecha);
  if (v.estado !== 'registrado') {
    const bloqueados = Object.keys(d).filter(k => !CAMPOS_INTERNOS.includes(k));
    if (bloqueados.length) {
      throw new ErrorHttp(409, `El viaje ya tiene documentos en el RNDC; no se puede cambiar: ${bloqueados.join(', ')}. Anule el documento o corrija con un reemplazo.`);
    }
  }
  await validarReferencias(req, { ...d, cliente: d.cliente || (d.tarifaRef ? String(v.cliente) : undefined) });
  if (d.historico !== undefined && !tienePermiso(req.usuario.rol, P.VIAJES_EDITAR_TODOS)) throw new ErrorHttp(403, 'No puede cambiar el estado histórico del viaje');
  const antes = v.toObject();
  if (d.conductor) {
    const cond = await Tercero.findOne(deEmpresa(req, { _id: d.conductor })).select('nombres apellido1 apellido2').lean();
    d.conductorNombre = nombreTercero(cond);
  }
  delete d.origen;
  // Si cambia la placa, el titular vuelve a tomarse del vehículo
  if (d.placa && d.placa !== v.placa && d.titular === undefined) d.titular = await titularDePlaca(req.empresaId, d.placa);
  v.set({ ...d, actualizadoPor: req.usuario._id });
  await v.save();
  await asegurarSoporte(req.empresaId, v._id);
  await auditar(req, 'editar_viaje', { entidad: 'Viaje', entidadId: v._id,
    detalle: { numero: v.numero, cambios: cambios(antes, v.toObject(), Object.keys(d)) } });
  res.json(presentar(await Viaje.findOne(deEmpresa(req, { _id: v._id })).populate(POBLAR(req)).lean()));
});

// Solo se eliminan viajes sin documentos en el RNDC.
r.delete('/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const v = await viajeEditable(req);
  if (v.estado !== 'registrado' || v.remesa?.radicado || v.manifiesto?.radicado) {
    throw new ErrorHttp(409, 'El viaje tiene documentos en el RNDC; debe anularlos en lugar de eliminar el viaje');
  }
  if (v.rastreo?.activo) await rastreo.finalizar(req.empresaId, v._id);
  await Viaje.deleteOne(deEmpresa(req, { _id: v._id }));
  await auditar(req, 'eliminar_viaje', { entidad: 'Viaje', entidadId: v._id, detalle: { numero: v.numero, placa: v.placa, destino: v.destino } });
  res.json({ ok: true });
});

// Placa principal del conductor (o la de su último viaje) para proponerla al registrar
r.get('/sugerencias/conductor/:id', permitir(P.VIAJES_VER), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ErrorHttp(400, 'Identificador inválido');
  const t = await Tercero.findOne(deEmpresa(req, { _id: req.params.id })).select('placas placaPrincipal').lean();
  if (!t) throw new ErrorHttp(404, 'Conductor no encontrado');
  const ultimo = await Viaje.findOne(deEmpresa(req, { conductor: t._id })).sort({ fecha: -1, numero: -1 }).select('placa remolque').lean();
  res.json({ placa: t.placaPrincipal || t.placas?.[0] || ultimo?.placa || '', placas: t.placas || [], placaPrincipal: t.placaPrincipal || '', remolque: ultimo?.remolque || '' });
});

// Datos sugeridos para el formulario: tarifa del destino y conductor habitual de la placa.
r.get('/sugerencias/placa/:placa', permitir(P.VIAJES_VER), async (req, res) => {
  const placa = String(req.params.placa).toUpperCase().replace(/[\s-]/g, '');
  const v = await Vehiculo.findOne(deEmpresa(req, { placa })).populate(pob(req.empresaId, 'conductorHabitual', 'nombres apellido1 apellido2 numId')).lean();
  const ultimo = await Viaje.findOne(deEmpresa(req, { placa })).sort({ fecha: -1, numero: -1 }).select('conductor remolque titular').lean();
  res.json({ vehiculo: v, conductor: v?.conductorHabitual?._id || ultimo?.conductor || null, remolque: ultimo?.remolque || '', titular: v?.titularHabitual || null });
});

export default r;
