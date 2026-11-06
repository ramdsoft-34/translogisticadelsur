// Programa anual de capacitaciones (SST, seguridad vial o ambos) con la asistencia firmada.
// Estado: ejecutada (la marca el responsable), atrasada (pasó la fecha sin ejecutarse) o programada.
import mongoose from 'mongoose';
import { Tercero } from '../../models/index.js';
import { SstCapacitacion, SstColaborador } from '../../models/sst.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { diasHasta, nombreTercero, noFutura } from './comun.js';

export const EJES = { sst: 'SST', vial: 'Seguridad vial', ambos: 'SST y seguridad vial' };

export function estadoCapacitacion(k, ahora = new Date()) {
  if (k.ejecutada) return 'ejecutada';
  return diasHasta(k.fecha, ahora) < 0 ? 'atrasada' : 'programada';
}

function presentar(k, ahora = new Date()) {
  const asistentes = (k.asistentes || []).map((a) => ({
    id: String(a._id), colaborador: a.colaborador ? String(a.colaborador) : null, nombre: a.nombre, documento: a.documento, cargo: a.cargo,
    firmado: !!a.firmadoEn, firmadoEn: a.firmadoEn || null, firmaOrigen: a.firmaOrigen || '', pendienteApp: !!a.solicitudApp && !a.firmadoEn,
  }));
  return {
    id: String(k._id), fecha: k.fecha, tema: k.tema, eje: k.eje, dirigidoA: k.dirigidoA, horas: k.horas, facilitador: k.facilitador, lugar: k.lugar,
    observaciones: k.observaciones, ejecutada: k.ejecutada, ejecutadaEn: k.ejecutadaEn, estado: estadoCapacitacion(k, ahora),
    asistentes, firmados: asistentes.filter((a) => a.firmado).length,
  };
}

/** Programa del año con indicadores. Cumplimiento: ejecutadas sobre las que ya debían hacerse. */
export async function listar(empresaId, anio, ahora = new Date()) {
  const desde = new Date(`${anio}-01-01T00:00:00-05:00`); const hasta = new Date(`${anio + 1}-01-01T00:00:00-05:00`);
  const l = (await SstCapacitacion.find({ empresa: empresaId, fecha: { $gte: desde, $lt: hasta } }).sort({ fecha: 1 }).lean()).map((k) => presentar(k, ahora));
  const ejecutadas = l.filter((k) => k.estado === 'ejecutada');
  const aLaFecha = l.filter((k) => k.estado !== 'programada').length;
  return {
    anio,
    items: l,
    indicadores: {
      programadas: l.length, ejecutadas: ejecutadas.length, atrasadas: l.filter((k) => k.estado === 'atrasada').length,
      horas: ejecutadas.reduce((s, k) => s + (Number(k.horas) || 0), 0),
      aLaFecha, cumplimiento: aLaFecha ? Math.round((ejecutadas.length / aLaFecha) * 100) : null,
    },
  };
}

export async function proximas(empresaId, limite = 3, ahora = new Date()) {
  const l = await SstCapacitacion.find({ empresa: empresaId, ejecutada: false, fecha: { $gte: new Date(ahora.getTime() - 86400000) } }).sort({ fecha: 1 }).limit(limite).lean();
  return l.map((k) => presentar(k, ahora));
}

async function cargar(empresaId, id, { conFirmas = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(400, 'Identificador inválido');
  const q = SstCapacitacion.findOne({ empresa: empresaId, _id: id });
  if (conFirmas) q.select('+asistentes.firma');
  const k = await q;
  if (!k) throw new ErrorHttp(404, 'Capacitación no encontrada');
  return k;
}

export async function detalle(empresaId, id) { return presentar((await cargar(empresaId, id)).toObject()); }

export async function crear(empresaId, d, usuarioId) {
  const k = await SstCapacitacion.create({ empresa: empresaId, ...d, creadoPor: usuarioId, actualizadoPor: usuarioId });
  return presentar(k.toObject());
}

export async function actualizar(empresaId, id, d, usuarioId) {
  const k = await cargar(empresaId, id);
  if (k.ejecutada && d.fecha && +new Date(d.fecha) !== +new Date(k.fecha)) throw new ErrorHttp(409, 'Una capacitación ejecutada no cambia de fecha');
  Object.assign(k, d, { actualizadoPor: usuarioId });
  await k.save();
  return presentar(k.toObject());
}

export async function eliminar(empresaId, id) {
  const k = await cargar(empresaId, id);
  if (k.asistentes.some((a) => a.firmadoEn)) throw new ErrorHttp(409, 'Tiene asistencia firmada: es evidencia y no se borra');
  await k.deleteOne();
}

/** Agrega colaboradores (por id) o personas externas a la lista de asistencia. Sin repetir documento. */
export async function agregarAsistentes(empresaId, id, { colaboradores = [], externos = [] }) {
  const k = await cargar(empresaId, id);
  const docs = new Set(k.asistentes.map((a) => a.documento));
  const cols = await SstColaborador.find({ empresa: empresaId, _id: { $in: colaboradores } }).select('tercero cargo').lean();
  const terceros = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: cols.map((c) => c.tercero) } }).select('nombres apellido1 apellido2 numId').lean())
    .map((t) => [String(t._id), t]));
  for (const c of cols) {
    const t = terceros.get(String(c.tercero));
    if (!t || docs.has(t.numId)) continue;
    k.asistentes.push({ colaborador: c._id, nombre: nombreTercero(t), documento: t.numId, cargo: c.cargo });
    docs.add(t.numId);
  }
  for (const e of externos) {
    if (docs.has(e.documento)) continue;
    k.asistentes.push({ nombre: e.nombre, documento: e.documento, cargo: e.cargo || '' });
    docs.add(e.documento);
  }
  await k.save();
  return presentar(k.toObject());
}

export async function quitarAsistente(empresaId, id, asistenteId) {
  const k = await cargar(empresaId, id);
  const a = k.asistentes.id(asistenteId);
  if (!a) throw new ErrorHttp(404, 'Asistente no encontrado');
  if (a.firmadoEn) throw new ErrorHttp(409, 'Ya firmó la asistencia: no se quita');
  a.deleteOne();
  await k.save();
  return presentar(k.toObject());
}

export async function firmar(empresaId, id, asistenteId, firma, origen = 'web', fecha = new Date()) {
  const k = await cargar(empresaId, id, { conFirmas: true });
  const a = k.asistentes.id(asistenteId);
  if (!a) throw new ErrorHttp(404, 'Asistente no encontrado');
  if (a.firmadoEn) return presentar(k.toObject());
  if (diasHasta(k.fecha) > 0) throw new ErrorHttp(409, 'La asistencia se firma el día de la capacitación o después');
  a.firma = firma; a.firmadoEn = fecha; a.firmaOrigen = origen;
  await k.save();
  return presentar(k.toObject());
}

export async function marcarSolicitud(empresaId, id, asistenteId, solicitudId) {
  await SstCapacitacion.updateOne({ empresa: empresaId, _id: id, 'asistentes._id': asistenteId }, { $set: { 'asistentes.$.solicitudApp': solicitudId } });
}

export async function ejecutar(empresaId, id, ejecutada, usuarioId) {
  const k = await cargar(empresaId, id);
  if (ejecutada && !noFutura(k.fecha)) throw new ErrorHttp(409, 'No se puede marcar como ejecutada antes de su fecha');
  k.ejecutada = ejecutada; k.ejecutadaEn = ejecutada ? new Date() : null; k.actualizadoPor = usuarioId;
  await k.save();
  return presentar(k.toObject());
}

/** Datos completos para el PDF de asistencia (con las firmas). */
export async function paraPdf(empresaId, id) {
  const k = await cargar(empresaId, id, { conFirmas: true });
  const o = k.toObject();
  return { ...presentar(o), firmas: Object.fromEntries(o.asistentes.filter((a) => a.firma).map((a) => [String(a._id), a.firma])) };
}
