// Liquidación de fletes (antes "Relación" de la plantilla): agrupa los viajes
// de un cliente en un periodo, calcula cobro, pago al conductor y utilidad, y
// deja una copia fija para facturar.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Liquidacion, Viaje, Tarifa, Cliente, siguiente, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { lineaLiquidacion, totalesLiquidacion } from '../services/calculos.js';
import { parseFecha, fmtFecha } from '../utils/texto.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
const periodo = z.object({
  cliente: z.string().refine(v => mongoose.isValidObjectId(v), 'cliente inválido'),
  desde: z.string().transform(parseFecha).refine(Boolean, 'fecha inválida'),
  hasta: z.string().transform(parseFecha).refine(Boolean, 'fecha inválida'),
});

// Calcula las líneas de los viajes no liquidados del cliente en el periodo.
async function calcular(req, { cliente, desde, hasta, viajes: ids }) {
  if (desde > hasta) throw new ErrorHttp(400, 'La fecha inicial es posterior a la final');
  if (!(await Cliente.exists(deEmpresa(req, { _id: cliente })))) throw new ErrorHttp(400, 'Cliente no encontrado');
  const filtro = deEmpresa(req, { cliente, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' }, liquidacion: null });
  if (ids?.length) filtro._id = { $in: ids };
  const viajes = await Viaje.find(filtro).sort({ fecha: 1, placa: 1 }).populate(pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2')).lean();
  const tarifas = await Tarifa.find(deEmpresa(req, { cliente })).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const porDestino = new Map(tarifas.map(t => [t.destino.toLowerCase(), t]));
  const lineas = viajes.map(v => lineaLiquidacion({ ...v, conductorNombre: nombre(v.conductor) },
    porId.get(String(v.tarifaRef)) || porDestino.get(String(v.destino).toLowerCase())));
  return { viajes, lineas, totales: totalesLiquidacion(lineas) };
}

r.post('/calcular', permitir(P.LIQUIDACION_VER), async (req, res) => {
  const d = periodo.parse(req.body);
  const { lineas, totales } = await calcular(req, d);
  res.json({ lineas, totales });
});

r.get('/', permitir(P.LIQUIDACION_VER), async (req, res) => {
  const lista = await Liquidacion.find(deEmpresa(req)).select('-lineas').sort({ numero: -1 }).limit(200).populate(pob(req.empresaId, 'cliente', 'nombre')).lean();
  res.json(lista);
});

r.get('/:id', permitir(P.LIQUIDACION_VER), async (req, res) => {
  const l = await Liquidacion.findOne(deEmpresa(req, { _id: req.params.id })).populate(pob(req.empresaId, 'cliente', 'nombre nit dv razonSocial')).lean();
  if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
  res.json(l);
});

// Guarda la liquidación y marca los viajes para que no se cobren dos veces.
r.post('/', permitir(P.LIQUIDACION_GESTIONAR), async (req, res) => {
  const d = periodo.extend({ viajes: z.array(z.string()).optional(), titulo: z.string().trim().max(120).optional().default('') }).parse(req.body);
  const { viajes, lineas, totales } = await calcular(req, d);
  if (!viajes.length) throw new ErrorHttp(400, 'No hay viajes sin liquidar en ese periodo');
  const numero = await siguiente(req.empresaId, 'liquidacion');
  const l = await Liquidacion.create({
    empresa: req.empresaId, numero, cliente: d.cliente, desde: d.desde, hasta: d.hasta,
    titulo: d.titulo || `Del ${fmtFecha(d.desde)} al ${fmtFecha(d.hasta)}`,
    viajes: viajes.map(v => v._id), lineas, totales, creadoPor: req.usuario._id,
  });
  // Solo marca los que siguen libres (evita carreras entre dos usuarios)
  const marcados = await Viaje.updateMany(deEmpresa(req, { _id: { $in: l.viajes }, liquidacion: null }), { $set: { liquidacion: l._id } });
  if (marcados.modifiedCount !== l.viajes.length) {
    await Viaje.updateMany(deEmpresa(req, { liquidacion: l._id }), { $set: { liquidacion: null } });
    await Liquidacion.deleteOne(deEmpresa(req, { _id: l._id }));
    throw new ErrorHttp(409, 'Algunos viajes fueron liquidados por otro usuario. Vuelva a calcular.');
  }
  await auditar(req, 'crear_liquidacion', { entidad: 'Liquidacion', entidadId: l._id, detalle: { numero, viajes: l.viajes.length, total: totales.totalCobrado } });
  res.status(201).json(l);
});

r.put('/:id/estado', permitir(P.LIQUIDACION_GESTIONAR), async (req, res) => {
  const { estado } = z.object({ estado: z.enum(['borrador', 'facturada', 'anulada']) }).parse(req.body);
  const l = await Liquidacion.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
  if (l.estado === 'anulada') throw new ErrorHttp(409, 'La liquidación está anulada');
  l.estado = estado;
  await l.save();
  // Al anular, los viajes quedan libres para otra liquidación
  if (estado === 'anulada') await Viaje.updateMany(deEmpresa(req, { liquidacion: l._id }), { $set: { liquidacion: null } });
  await auditar(req, 'estado_liquidacion', { entidad: 'Liquidacion', entidadId: l._id, detalle: { numero: l.numero, estado } });
  res.json(l);
});

export default r;
