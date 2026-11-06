// Flota de SG-SST: hoja de vida (kilometraje, pólizas RC, plan de mantenimiento e historial).
// SOAT y técnico-mecánica se leen de Vehículos (allá se editan). Kilometraje: una sola fuente,
// la lectura más reciente entre la hoja de vida, los mantenimientos y el preoperacional del conductor.
import mongoose from 'mongoose';
import { Tercero, Vehiculo } from '../../models/index.js';
import { SstVehiculo } from '../../models/sst.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { diasHasta, estadoVence, nombreTercero, noFutura } from './comun.js';

const fmtKm = (n) => `${Math.round(n).toLocaleString('es-CO')} km`;
const DIA = 86400000;

/**
 * Estado de una actividad del plan: vence lo que llegue primero (kilómetros o días).
 * Devuelve el estado (vencido, semana, mes, ok o sin_dato), cuánto falta y un texto claro.
 */
export function estadoActividad(a, kmActual, ahora = new Date()) {
  const proxKm = a.cadaKm && a.ultimoKm != null ? a.ultimoKm + a.cadaKm : null;
  const proxFecha = a.cadaDias && a.ultimaFecha ? new Date(new Date(a.ultimaFecha).getTime() + a.cadaDias * DIA) : null;
  const faltanKm = proxKm != null && kmActual != null ? proxKm - kmActual : null;
  const faltanDias = proxFecha ? diasHasta(proxFecha, ahora) : null;
  if (faltanKm == null && faltanDias == null) return { estado: 'sin_dato', faltanKm: null, faltanDias: null, proxKm, proxFecha, texto: 'Falta el último km o la última fecha' };
  const rango = (km, dias) => {
    if ((km != null && km <= 0) || (dias != null && dias < 0)) return 'vencido';
    if ((km != null && km <= 500) || (dias != null && dias <= 7)) return 'semana';
    if ((km != null && km <= 2000) || (dias != null && dias <= 30)) return 'mes';
    return 'ok';
  };
  const estado = rango(faltanKm, faltanDias);
  const partes = [];
  if (faltanKm != null) partes.push(faltanKm <= 0 ? `pasó ${fmtKm(-faltanKm)}` : `faltan ${fmtKm(faltanKm)}`);
  if (faltanDias != null) partes.push(faltanDias < 0 ? `venció hace ${-faltanDias} días` : faltanDias === 0 ? 'vence hoy' : `faltan ${faltanDias} días`);
  return { estado, faltanKm, faltanDias, proxKm, proxFecha, texto: `${estado === 'vencido' ? 'Vencido: ' : ''}${partes.join(' o ')}` };
}

const ORDEN = { vencido: 0, semana: 1, mes: 2, ok: 3, sin_dato: 4 };

/** El mantenimiento más urgente del plan. */
export function proximoMantenimiento(plan = [], kmActual, ahora = new Date()) {
  const l = plan.map((a) => ({ actividad: a.actividad, ...estadoActividad(a, kmActual, ahora) })).filter((x) => x.estado !== 'sin_dato');
  l.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || (a.faltanDias ?? 9e9) - (b.faltanDias ?? 9e9));
  return l[0] || null;
}

/** Kilometraje vigente: la lectura más reciente. Avisa si una lectura nueva es menor que la anterior. */
export function kilometrajeVigente(lecturas) {
  const v = lecturas.filter((x) => x && x.valor != null && x.fecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  if (!v.length) return { valor: null, fecha: null, fuente: '', bajo: false };
  const maximo = Math.max(...v.map((x) => x.valor));
  return { ...v[0], bajo: v[0].valor < maximo, maximo };
}

async function vehiculoDeEmpresa(empresaId, vehiculoId) {
  if (!mongoose.isValidObjectId(vehiculoId)) throw new ErrorHttp(400, 'Identificador inválido');
  const v = await Vehiculo.findOne({ empresa: empresaId, _id: vehiculoId })
    .select('placa marca marcaNombre linea modelo clase soat venceTecnomecanica conductorHabitual activo').lean();
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  return v;
}

function lecturasDe(h, preo) {
  const ult = [...(h?.historial || [])].filter((x) => x.km != null).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
  return [
    h?.kilometraje?.valor != null ? { valor: h.kilometraje.valor, fecha: h.kilometraje.fecha, fuente: h.kilometraje.fuente || 'web' } : null,
    ult ? { valor: ult.km, fecha: ult.fecha, fuente: 'mantenimiento' } : null,
    preo?.kilometraje != null ? { valor: preo.kilometraje, fecha: preo.fecha, fuente: 'preoperacional' } : null,
  ];
}

/**
 * Lista de la flota. `preoperacionales`: último preoperacional por placa (lo trae la app; puede faltar).
 */
export async function listar(empresaId, preoperacionales = new Map(), ahora = new Date()) {
  const vehiculos = await Vehiculo.find({ empresa: empresaId, activo: { $ne: false }, clase: { $ne: 'remolque' } })
    .select('placa marca marcaNombre linea modelo soat venceTecnomecanica conductorHabitual').sort({ placa: 1 }).lean();
  const hojas = new Map((await SstVehiculo.find({ empresa: empresaId }).lean()).map((h) => [String(h.vehiculo), h]));
  const conductores = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: vehiculos.map((v) => v.conductorHabitual).filter(Boolean) } })
    .select('nombres apellido1 apellido2').lean()).map((t) => [String(t._id), nombreTercero(t)]));
  return vehiculos.map((v) => {
    const h = hojas.get(String(v._id));
    const preo = preoperacionales.get(v.placa) || null;
    const km = kilometrajeVigente(lecturasDe(h, preo));
    const rc = [h?.rcContractual?.vence, h?.rcExtracontractual?.vence].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null;
    return {
      id: String(v._id), placa: v.placa, marca: v.marcaNombre || v.marca || '', modelo: v.modelo || null,
      conductor: v.conductorHabitual ? conductores.get(String(v.conductorHabitual)) || '' : (preo?.conductor || ''),
      soat: v.soat?.vence ? { vence: v.soat.vence, estado: estadoVence(v.soat.vence, ahora) } : null,
      tecnomecanica: v.venceTecnomecanica ? { vence: v.venceTecnomecanica, estado: estadoVence(v.venceTecnomecanica, ahora) } : null,
      polizasRc: rc ? { vence: rc, estado: estadoVence(rc, ahora) } : null,
      kilometraje: km,
      proximoMantenimiento: proximoMantenimiento(h?.plan, km.valor, ahora),
      tienePlan: !!h?.plan?.length,
      ultimoPreoperacional: preo ? { fecha: preo.fecha, resultado: preo.resultado, id: preo.checklistId } : null,
    };
  });
}

export async function hojaDeVida(empresaId, vehiculoId, preo = null, ahora = new Date()) {
  const v = await vehiculoDeEmpresa(empresaId, vehiculoId);
  const h = await SstVehiculo.findOne({ empresa: empresaId, vehiculo: v._id }).lean();
  const km = kilometrajeVigente(lecturasDe(h, preo));
  return {
    vehiculo: { id: String(v._id), placa: v.placa, marca: v.marcaNombre || v.marca || '', linea: v.linea || '', modelo: v.modelo || null,
      soat: v.soat?.vence || null, tecnomecanica: v.venceTecnomecanica || null },
    kilometraje: km,
    rcContractual: h?.rcContractual || { vence: null, numero: '' },
    rcExtracontractual: h?.rcExtracontractual || { vence: null, numero: '' },
    plan: (h?.plan || []).map((a) => ({ id: String(a._id), actividad: a.actividad, cadaKm: a.cadaKm, cadaDias: a.cadaDias, ultimoKm: a.ultimoKm, ultimaFecha: a.ultimaFecha,
      ...estadoActividad(a, km.valor, ahora) })),
    historial: [...(h?.historial || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((x) => ({ id: String(x._id), fecha: x.fecha, tipo: x.tipo, actividad: x.actividad, km: x.km, taller: x.taller, costo: x.costo })),
  };
}

/** Guarda kilometraje, pólizas y plan. Valida fechas y que el kilometraje no baje. */
export async function guardarHoja(empresaId, vehiculoId, d, preo = null) {
  const v = await vehiculoDeEmpresa(empresaId, vehiculoId);
  const h = await SstVehiculo.findOne({ empresa: empresaId, vehiculo: v._id }).lean();
  const actual = kilometrajeVigente(lecturasDe(h, preo));
  if (d.kilometraje != null && actual.maximo != null && d.kilometraje < actual.maximo && !d.confirmarBaja) {
    throw Object.assign(new ErrorHttp(409, `El kilometraje no puede bajar: la última lectura es ${fmtKm(actual.maximo)}. Si fue un error de digitación anterior, confirme la corrección.`), { codigo: 'km_baja' });
  }
  for (const a of d.plan || []) {
    if (!a.cadaKm && !a.cadaDias) throw new ErrorHttp(400, `«${a.actividad}»: indique cada cuántos km o cada cuántos días`);
    if (!noFutura(a.ultimaFecha)) throw new ErrorHttp(400, `«${a.actividad}»: la última fecha no puede ser futura`);
    if (a.ultimoKm != null && d.kilometraje != null && a.ultimoKm > d.kilometraje) throw new ErrorHttp(400, `«${a.actividad}»: el último km no puede ser mayor que el kilometraje actual`);
  }
  const set = { rcContractual: d.rcContractual, rcExtracontractual: d.rcExtracontractual, plan: d.plan || [] };
  if (d.kilometraje != null && d.kilometraje !== h?.kilometraje?.valor) set.kilometraje = { valor: d.kilometraje, fecha: new Date(), fuente: 'web' };
  await SstVehiculo.updateOne({ empresa: empresaId, vehiculo: v._id }, { $set: set }, { upsert: true });
  return hojaDeVida(empresaId, vehiculoId, preo);
}

/** Mantenimiento hecho. Si coincide con una actividad del plan, actualiza su último km y fecha. */
export async function agregarMantenimiento(empresaId, vehiculoId, d, usuarioId, preo = null) {
  const v = await vehiculoDeEmpresa(empresaId, vehiculoId);
  if (!noFutura(d.fecha)) throw new ErrorHttp(400, 'La fecha del mantenimiento no puede ser futura');
  const h = (await SstVehiculo.findOne({ empresa: empresaId, vehiculo: v._id })) || new SstVehiculo({ empresa: empresaId, vehiculo: v._id });
  h.historial.push({ ...d, registradoPor: usuarioId });
  const norm = (s) => String(s || '').trim().toLowerCase();
  const a = h.plan.find((x) => norm(x.actividad) === norm(d.actividad));
  if (a && (!a.ultimaFecha || new Date(d.fecha) >= new Date(a.ultimaFecha))) { a.ultimaFecha = d.fecha; if (d.km != null) a.ultimoKm = d.km; }
  await h.save();
  return hojaDeVida(empresaId, vehiculoId, preo);
}

export async function quitarMantenimiento(empresaId, vehiculoId, id, preo = null) {
  const v = await vehiculoDeEmpresa(empresaId, vehiculoId);
  const r = await SstVehiculo.updateOne({ empresa: empresaId, vehiculo: v._id }, { $pull: { historial: { _id: id } } });
  if (!r.modifiedCount) throw new ErrorHttp(404, 'Mantenimiento no encontrado');
  return hojaDeVida(empresaId, vehiculoId, preo);
}
