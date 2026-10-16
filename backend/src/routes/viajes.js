// Viajes (bitácora). Cada viaje concentra los datos operativos y el estado de
// sus documentos en el RNDC (remesa, manifiesto y cumplidos).
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Viaje, Cliente, Tarifa, Tercero, Vehiculo, PlantillaWhatsapp, siguiente, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P, tienePermiso } from '../config/permisos.js';
import { auditar, cambios } from '../services/auditoria.js';
import { mensajesPorCliente, PLANTILLA_BASE, MARCADORES } from '../services/whatsapp.js';
import { parseFecha, hoyColombia, escaparRegex } from '../utils/texto.js';
import { saldoViaje, utilidadViaje, valoresDesdeTarifa } from '../services/calculos.js';

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
  tarifa: dinero.optional(), flete: dinero.optional(), anticipo: dinero.optional(),
  observaciones: z.string().trim().max(500).optional(),
  historico: z.boolean().optional(),
  requiereManifiesto: z.boolean().optional(),
});
// Después de expedir documentos en el RNDC solo se pueden cambiar datos internos.
const CAMPOS_INTERNOS = ['observaciones', 'cantidad', 'conAuxiliar', 'tarifa', 'historico'];

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
  if (req.query.q) {
    const re = new RegExp(escaparRegex(req.query.q), 'i');
    f.$or = [{ destino: re }, { placa: re }, { 'manifiesto.numero': re }, { 'remesa.numero': re }, { observaciones: re }];
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
  const [total, lista, sumas] = await Promise.all([
    Viaje.countDocuments(filtro),
    Viaje.find(filtro).sort({ fecha: -1, numero: -1 }).skip((pagina - 1) * limite).limit(limite).populate(POBLAR(req)).lean(),
    // Totales de TODO el filtro (no solo de la página cargada)
    pagina === 1 ? Viaje.aggregate([{ $match: filtroAgg }, { $group: { _id: null, flete: { $sum: '$flete' }, anticipo: { $sum: '$anticipo' }, tarifa: { $sum: '$tarifa' } } }]) : null,
  ]);
  // Sin coincidencias la agregación no devuelve grupo: las sumas son cero
  const s = sumas ? (sumas[0] || { flete: 0, anticipo: 0, tarifa: 0 }) : null;
  res.json({ total, pagina, limite, viajes: lista.map(presentar),
    ...(s ? { sumas: { flete: s.flete, anticipo: s.anticipo, tarifa: s.tarifa, saldo: s.flete - s.anticipo } } : {}) });
});

r.get('/resumen', permitir(P.VIAJES_VER), async (req, res) => {
  const hoy = hoyColombia();
  const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const base = { empresa: new mongoose.Types.ObjectId(String(req.empresaId)) };
  const [hoyN, porEstado, mes] = await Promise.all([
    Viaje.countDocuments(deEmpresa(req, { fecha: hoy })),
    // Los históricos importados del Excel no cuentan como pendientes de RNDC
    Viaje.aggregate([{ $match: { ...base, historico: { $ne: true }, requiereManifiesto: { $ne: false } } }, { $group: { _id: '$estado', n: { $sum: 1 } } }]),
    Viaje.aggregate([{ $match: { ...base, fecha: { $gte: inicioMes }, estado: { $ne: 'anulado' } } },
      { $group: { _id: null, viajes: { $sum: 1 }, tarifa: { $sum: '$tarifa' }, flete: { $sum: '$flete' }, anticipo: { $sum: '$anticipo' } } }]),
  ]);
  const estados = Object.fromEntries(porEstado.map(x => [x._id, x.n]));
  res.json({ hoy: hoyN, estados, mes: mes[0] || { viajes: 0, tarifa: 0, flete: 0, anticipo: 0 } });
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
  return (await Viaje.find(filtro).sort({ numero: 1 }).populate(POBLAR(req))
    .populate(pob(req.empresaId, 'cliente', 'nombre whatsapp')).lean()).map(presentar);
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
  res.json({ fecha, plantilla: plantilla._id, mensajes: mensajesPorCliente(viajes, fecha, new Date(), plantilla) });
});

// Vista previa de una plantilla en edición con los viajes de la fecha (no guarda nada).
r.post('/reporte-whatsapp/vista-previa', permitir(P.VIAJES_VER), async (req, res) => {
  const d = z.object({ fecha: z.string().optional(), plantilla: plantillaSchema.partial({ nombre: true }) }).parse(req.body);
  const fecha = parseFecha(d.fecha) || hoyColombia();
  const viajes = await viajesDelReporte(req, fecha, true);
  res.json({ fecha, mensajes: mensajesPorCliente(viajes, fecha, new Date(), d.plantilla) });
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
  const d = viajeSchema.parse(req.body);
  await validarReferencias(req, d);
  // Valores sugeridos por la tarifa del destino cuando no se escriben
  if (d.tarifaRef) {
    const t = await Tarifa.findOne(deEmpresa(req, { _id: d.tarifaRef })).lean();
    const sug = valoresDesdeTarifa(t);
    for (const k of ['tarifa', 'flete', 'anticipo', 'pesoKg', 'codDestino']) if (d[k] === undefined || d[k] === '') d[k] = sug[k];
    if (!d.destinatario?.numId && sug.destinatario?.numId) d.destinatario = sug.destinatario;
  }
  // Remolque habitual / conductor del vehículo no se imponen: solo se sugieren en la interfaz.
  const numero = await siguiente(req.empresaId, 'viaje');
  const cond = await Tercero.findOne(deEmpresa(req, { _id: d.conductor })).select('nombres apellido1 apellido2').lean();
  const v = await Viaje.create({ ...d, numero, conductorNombre: nombreTercero(cond), empresa: req.empresaId,
    creadoPor: req.usuario._id, actualizadoPor: req.usuario._id });
  await auditar(req, 'crear_viaje', { entidad: 'Viaje', entidadId: v._id, detalle: { numero, placa: v.placa, destino: v.destino } });
  res.status(201).json(presentar((await Viaje.findOne(deEmpresa(req, { _id: v._id })).populate(POBLAR(req)).lean())));
});

async function viajeEditable(req) {
  const v = await Viaje.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  const propio = String(v.creadoPor) === String(req.usuario._id);
  if (!tienePermiso(req.usuario.rol, P.VIAJES_EDITAR_TODOS) && !propio) throw new ErrorHttp(403, 'Solo puede modificar los viajes que usted registró');
  if (v.liquidacion) throw new ErrorHttp(409, 'El viaje ya está en una liquidación de fletes');
  return v;
}

r.put('/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const v = await viajeEditable(req);
  let d = viajeSchema.partial().parse(req.body);
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
  v.set({ ...d, actualizadoPor: req.usuario._id });
  await v.save();
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
  await Viaje.deleteOne(deEmpresa(req, { _id: v._id }));
  await auditar(req, 'eliminar_viaje', { entidad: 'Viaje', entidadId: v._id, detalle: { numero: v.numero, placa: v.placa, destino: v.destino } });
  res.json({ ok: true });
});

// Datos sugeridos para el formulario: tarifa del destino y conductor habitual de la placa.
r.get('/sugerencias/placa/:placa', permitir(P.VIAJES_VER), async (req, res) => {
  const placa = String(req.params.placa).toUpperCase().replace(/[\s-]/g, '');
  const v = await Vehiculo.findOne(deEmpresa(req, { placa })).populate(pob(req.empresaId, 'conductorHabitual', 'nombres apellido1 apellido2 numId')).lean();
  const ultimo = await Viaje.findOne(deEmpresa(req, { placa })).sort({ fecha: -1, numero: -1 }).select('conductor remolque titular').lean();
  res.json({ vehiculo: v, conductor: v?.conductorHabitual?._id || ultimo?.conductor || null, remolque: ultimo?.remolque || '', titular: ultimo?.titular || null });
});

export default r;
