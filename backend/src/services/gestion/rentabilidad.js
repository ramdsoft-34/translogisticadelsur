// Contabilidad fase 6: rentabilidad por viaje, vehículo, cliente o ruta.
//
// Por viaje se toma lo mismo que la liquidación de fletes (services/calculos.js): lo cobrado al cliente (tarifa +
// auxiliar cobrado), el flete del conductor y el auxiliar pagado. A cada vehículo se le cargan además sus costos
// propios del periodo: gastos y compras registrados con su placa (centro de costo, cuentas de las clases 5, 6 y 7)
// y la depreciación de los activos fijos con esa placa. Esos costos se reparten entre los viajes del vehículo en el
// periodo en proporción a lo cobrado (o por partes iguales si no se cobró nada).
//
// Es la utilidad de la operación (contribución): no incluye los gastos generales de la empresa sin vehículo
// (administración, nómina de oficina…), que están en el estado de resultados.
import mongoose from 'mongoose';
import { Viaje, Tarifa, Cliente, Asiento, ActivoFijo, Municipio } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { lineaLiquidacion, respaldosAuxiliar } from '../calculos.js';

const $ = (n) => Math.round(Number(n) || 0);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const AGRUPACIONES = ['viaje', 'placa', 'cliente', 'ruta'];
export const MAX_DIAS = 366;
const ORIGENES_COSTO = ['GAS', 'CMP', 'MAN'];         // los documentos que se cargan a mano a un vehículo
const SIN_VIAJES = 'Costos de vehículos sin viajes en el periodo';

// ── Regla pura ───────────────────────────────────────────────────────────────
// viajes: [{ viaje, numero, fecha, placa, cliente, clienteNombre, ruta, totalCobrado, totalFlete, totalAuxiliarPagado }]
// costosPlaca: { PLACA: valor } (gastos, compras y depreciación del vehículo en el periodo)
export function repartirCostos(viajes, costosPlaca = {}) {
  const porPlaca = new Map();
  for (const v of viajes) { if (!porPlaca.has(v.placa)) porPlaca.set(v.placa, []); porPlaca.get(v.placa).push(v); }
  const salida = viajes.map(v => ({ ...v, costosVehiculo: 0 }));
  const indice = new Map(viajes.map((v, i) => [v, i]));
  const sinViajes = [];
  for (const [placa, valor] of Object.entries(costosPlaca)) {
    const total = $(valor); if (!total) continue;
    const lista = porPlaca.get(placa);
    if (!lista?.length) { sinViajes.push({ placa, valor: total }); continue; }
    const base = lista.reduce((t, v) => t + Math.max(0, $(v.totalCobrado)), 0);
    let repartido = 0;
    lista.forEach((v, k) => {
      const parte = k === lista.length - 1 ? total - repartido
        : Math.round(total * (base ? Math.max(0, $(v.totalCobrado)) / base : 1 / lista.length));
      repartido += parte;
      salida[indice.get(v)].costosVehiculo += parte;
    });
  }
  return { viajes: salida, sinViajes };
}

const fila = (clave, nombre) => ({ clave, nombre, viajes: 0, ingreso: 0, flete: 0, auxiliar: 0, costosVehiculo: 0, utilidad: 0, margen: 0 });
function sumar(f, v) {
  f.viajes += 1; f.ingreso += $(v.totalCobrado); f.flete += $(v.totalFlete); f.auxiliar += $(v.totalAuxiliarPagado); f.costosVehiculo += $(v.costosVehiculo);
}
const cerrar = (f) => { f.utilidad = f.ingreso - f.flete - f.auxiliar - f.costosVehiculo; f.margen = f.ingreso ? Math.round(f.utilidad / f.ingreso * 1000) / 10 : 0; return f; };

export function agruparRentabilidad(viajes, sinViajes, agrupar = 'placa') {
  if (!AGRUPACIONES.includes(agrupar)) throw new ErrorHttp(400, `Agrupe por ${AGRUPACIONES.join(', ')}`);
  const grupos = new Map();
  const clave = { viaje: v => [String(v.numero), `Viaje ${v.numero} · ${v.placa} · ${v.clienteNombre}`], placa: v => [v.placa, v.placa],
    cliente: v => [String(v.cliente), v.clienteNombre], ruta: v => [v.ruta, v.ruta] }[agrupar];
  for (const v of viajes) {
    const [k, nombre] = clave(v);
    if (!grupos.has(k)) grupos.set(k, fila(k, nombre));
    sumar(grupos.get(k), v);
  }
  const filas = [...grupos.values()].map(cerrar);
  // Vehículos con costos pero sin viajes: en la vista por vehículo, una fila cada uno; en las demás, una fila aparte
  if (agrupar === 'placa') for (const s of sinViajes) filas.push(cerrar({ ...fila(s.placa, `${s.placa} (sin viajes)`), costosVehiculo: s.valor }));
  else if (sinViajes.length) filas.push(cerrar({ ...fila('-', SIN_VIAJES), costosVehiculo: sinViajes.reduce((t, s) => t + s.valor, 0) }));
  filas.sort((a, b) => (agrupar === 'viaje' ? Number(a.clave) - Number(b.clave) : b.utilidad - a.utilidad || b.ingreso - a.ingreso));
  const totales = cerrar(filas.reduce((t, f) => { for (const k of ['ingreso', 'flete', 'auxiliar', 'costosVehiculo']) t[k] += f[k]; t.viajes += f.viajes; return t; }, fila('total', 'Total')));
  return { filas, totales };
}

// ── Consulta ─────────────────────────────────────────────────────────────────
export async function costosPorPlaca(empresaId, desde, hasta) {
  const costos = {};
  const sumas = await Asiento.aggregate([
    { $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $gte: desde, $lte: hasta }, origen: { $in: ORIGENES_COSTO }, centroCosto: { $regex: '^[A-Z0-9]{3,7}$' } } },
    { $unwind: '$lineas' }, { $match: { 'lineas.cuenta': { $regex: '^[567]' } } },
    { $group: { _id: '$centroCosto', v: { $sum: { $subtract: ['$lineas.debito', '$lineas.credito'] } } } }]);
  for (const s of sumas) costos[s._id] = (costos[s._id] || 0) + $(s.v);
  // Depreciación de los activos con placa, por los meses del rango
  const mDesde = desde.toISOString().slice(0, 7); const mHasta = hasta.toISOString().slice(0, 7);
  for (const a of await ActivoFijo.find({ empresa: empresaId, placa: { $ne: '' }, 'depreciaciones.0': { $exists: true } }).select('placa depreciaciones').lean()) {
    const v = a.depreciaciones.filter(d => d.mes >= mDesde && d.mes <= mHasta).reduce((t, d) => t + $(d.valor), 0);
    if (v) costos[a.placa] = (costos[a.placa] || 0) + v;
  }
  return costos;
}

export async function rentabilidad(empresaId, { desde, hasta, agrupar = 'placa', placa = '', cliente = '' }) {
  if (!(desde instanceof Date) || !(hasta instanceof Date) || hasta < desde) throw new ErrorHttp(400, 'Indique el rango de fechas');
  if ((hasta - desde) / 86400000 > MAX_DIAS) throw new ErrorHttp(400, `El rango no puede pasar de ${MAX_DIAS} días`);
  const f = { empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' } };
  if (placa) f.placa = String(placa).toUpperCase();
  if (cliente) { if (!mongoose.isValidObjectId(cliente)) throw new ErrorHttp(400, 'Cliente inválido'); f.cliente = cliente; }
  const viajes = await Viaje.find(f).select('numero fecha placa cliente tarifaRef destino codOrigen cantidad tarifa flete conAuxiliar diasAuxiliar anticipo conductorNombre')
    .sort({ fecha: 1, numero: 1 }).limit(20000).lean();
  const idsCli = [...new Set(viajes.map(v => String(v.cliente)))];
  const [clientes, tarifas] = await Promise.all([
    Cliente.find({ empresa: empresaId, _id: { $in: idsCli } }).select('nombre politicaAuxiliar valorAuxiliarSinAnticipo').lean(),
    Tarifa.find({ empresa: empresaId, cliente: { $in: idsCli } }).lean()]);
  const cliPorId = new Map(clientes.map(c => [String(c._id), c]));
  const tarPorId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldos = respaldosAuxiliar(tarifas);
  const codigos = [...new Set(viajes.map(v => v.codOrigen).filter(Boolean))];
  const municipios = new Map((await Municipio.find({ codigo: { $in: codigos } }).select('codigo nombre').lean()).map(m => [m.codigo, m.nombre]));
  let sinTarifa = 0;
  const lineas = viajes.map(v => {
    const c = cliPorId.get(String(v.cliente));
    const l = lineaLiquidacion(v, tarPorId.get(String(v.tarifaRef)), { respaldo: respaldos.get(String(v.cliente)), cliente: c });
    if (l.sinTarifa) sinTarifa += 1;
    const origen = municipios.get(v.codOrigen) || v.codOrigen || 'Origen sin registrar';
    return { viaje: String(v._id), numero: v.numero, fecha: v.fecha, placa: v.placa, cliente: String(v.cliente), clienteNombre: c?.nombre || 'Cliente',
      ruta: `${origen} → ${v.destino || 'sin destino'}`, totalCobrado: l.totalCobrado, totalFlete: l.totalFlete, totalAuxiliarPagado: l.totalAuxiliarPagado };
  });
  // Con filtro por cliente no se cargan los costos de vehículos sin viajes de ese cliente (serían de otros clientes)
  let costos = await costosPorPlaca(empresaId, desde, hasta);
  if (placa) costos = { [f.placa]: costos[f.placa] || 0 };
  const { viajes: conCostos, sinViajes } = repartirCostos(lineas, costos);
  const { filas, totales } = agruparRentabilidad(conCostos, cliente ? [] : sinViajes, agrupar);
  const avisos = [];
  if (sinTarifa) avisos.push(`${sinTarifa} viaje(s) sin tarifa: se usó el valor escrito en el viaje`);
  if (viajes.length === 20000) avisos.push('Se tomaron los primeros 20.000 viajes: use un rango más corto');
  return { desde, hasta, agrupar, filas, totales, avisos };
}

export const COLUMNAS = ['Clave', 'Nombre', 'Viajes', 'Ingreso', 'Flete conductor', 'Auxiliar pagado', 'Costos del vehículo', 'Utilidad', 'Margen %'];
export const filaExcel = (f) => [f.clave, f.nombre, f.viajes, f.ingreso, f.flete, f.auxiliar, f.costosVehiculo, f.utilidad, f.margen];
