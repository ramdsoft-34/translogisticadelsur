// Colaboradores de SG-SST: un solo perfil por persona, enlazado al Tercero (nombre, documento,
// licencia, placas y contacto se leen de allá; no se escriben otra vez).
import mongoose from 'mongoose';
import { Tercero } from '../../models/index.js';
import { SstColaborador, SstCapacitacion } from '../../models/sst.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { estadoVence, nombreTercero, noFutura } from './comun.js';

const CAMPOS_TERCERO = 'tipoId numId nombres apellido1 apellido2 celular telefono correo direccion licencia placas placaPrincipal fechaNacimiento roles activo';
export const TEXTO_CONCEPTO = { apto: 'Apto', apto_restricciones: 'Apto con restricciones', no_apto: 'No apto', aplazado: 'Aplazado' };

const escapar = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Último examen con vigencia (el más reciente por fecha). */
function examenVigente(examenes = []) {
  const con = examenes.filter((x) => x.tipo !== 'retiro' && x.fecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return con[0] || null;
}

function resumen(c, t) {
  const ex = examenVigente(c.examenes);
  return {
    id: String(c._id), terceroId: String(t._id), tipo: c.tipo, cargo: c.cargo, vinculacion: c.vinculacion, activo: c.activo !== false,
    nombre: nombreTercero(t), tipoId: t.tipoId, documento: t.numId, placa: t.placaPrincipal || t.placas?.[0] || '',
    licencia: t.licencia?.vence ? { categoria: t.licencia.categoria || '', vence: t.licencia.vence, estado: estadoVence(t.licencia.vence) } : null,
    seguridadSocial: c.seguridadSocial || {},
    epp: (c.epp || []).length,
    eppSinFirma: (c.epp || []).filter((x) => !x.firmadoEn).length,
    examen: ex ? { concepto: ex.concepto, vence: ex.vence, estado: ex.vence ? estadoVence(ex.vence) : 'sin_dato' } : null,
    comparendosPendientes: (c.comparendos || []).filter((x) => x.estado !== 'pagado').length,
  };
}

export async function listar(empresaId, { q = '', tipo = '', inactivos = false } = {}) {
  const f = { empresa: empresaId, ...(tipo ? { tipo } : {}), ...(inactivos ? {} : { activo: { $ne: false } }) };
  const lista = await SstColaborador.find(f).select('-epp.firma').lean();
  const terceros = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: lista.map((c) => c.tercero) } }).select(CAMPOS_TERCERO).lean()).map((t) => [String(t._id), t]));
  let filas = lista.map((c) => { const t = terceros.get(String(c.tercero)); return t ? resumen(c, t) : null; }).filter(Boolean);
  if (q) {
    const re = new RegExp(escapar(q.trim()), 'i');
    filas = filas.filter((x) => re.test(x.nombre) || re.test(x.documento) || re.test(x.placa));
  }
  filas.sort((a, b) => (a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre, 'es') : a.tipo === 'conductor' ? -1 : 1));
  return filas;
}

/** «Traer conductores y empleados»: crea el perfil de los Terceros con rol conductor o empleado que aún no lo tienen. */
export async function traer(empresaId) {
  const terceros = await Tercero.find({ empresa: empresaId, activo: { $ne: false }, roles: { $in: ['conductor', 'empleado'] }, tipoId: { $ne: 'N' } }).select('roles').lean();
  const ya = new Set((await SstColaborador.find({ empresa: empresaId }).select('tercero').lean()).map((c) => String(c.tercero)));
  const nuevos = terceros.filter((t) => !ya.has(String(t._id)));
  if (nuevos.length) {
    await SstColaborador.insertMany(nuevos.map((t) => {
      const conductor = t.roles.includes('conductor');
      return { empresa: empresaId, tercero: t._id, tipo: conductor ? 'conductor' : 'directo', cargo: conductor ? 'Conductor' : '', vinculacion: conductor ? 'contratista' : 'directo' };
    }), { ordered: false }).catch((e) => { if (e.code !== 11000 && !e.writeErrors) throw e; });
  }
  return { nuevos: nuevos.length, total: ya.size + nuevos.length };
}

/**
 * Nuevo colaborador. Si la persona ya existe en Terceros (mismo documento) se enlaza;
 * si no, se crea el Tercero con el rol «empleado» (o «conductor»).
 */
export async function crear(empresaId, d) {
  let t = d.terceroId
    ? await Tercero.findOne({ empresa: empresaId, _id: d.terceroId })
    : await Tercero.findOne({ empresa: empresaId, tipoId: { $ne: 'N' }, numId: d.persona.numId });
  if (!t) {
    if (!d.persona) throw new ErrorHttp(400, 'Escriba los datos de la persona');
    t = await Tercero.create({ empresa: empresaId, ...d.persona, roles: [d.tipo === 'conductor' ? 'conductor' : 'empleado'] });
  } else {
    const rol = d.tipo === 'conductor' ? 'conductor' : 'empleado';
    if (!t.roles.includes(rol)) { t.roles.push(rol); await t.save(); }
  }
  if (await SstColaborador.exists({ empresa: empresaId, tercero: t._id })) throw new ErrorHttp(409, `${nombreTercero(t)} ya tiene perfil de colaborador`);
  const c = await SstColaborador.create({ empresa: empresaId, tercero: t._id, tipo: d.tipo, cargo: d.cargo, vinculacion: d.vinculacion,
    ingreso: d.ingreso || null, seguridadSocial: d.seguridadSocial, contactoEmergencia: d.contactoEmergencia });
  return perfil(empresaId, c._id);
}

async function cargar(empresaId, id, { conFirmas = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(400, 'Identificador inválido');
  const q = SstColaborador.findOne({ empresa: empresaId, _id: id });
  if (conFirmas) q.select('+epp.firma');
  const c = await q;
  if (!c) throw new ErrorHttp(404, 'Colaborador no encontrado');
  return c;
}

export async function perfil(empresaId, id) {
  const c = await cargar(empresaId, id);
  const t = await Tercero.findOne({ empresa: empresaId, _id: c.tercero }).select(CAMPOS_TERCERO).lean();
  if (!t) throw new ErrorHttp(404, 'La persona ya no existe en Terceros');
  const capacitaciones = await SstCapacitacion.find({ empresa: empresaId, 'asistentes.colaborador': c._id })
    .select('fecha tema eje horas ejecutada asistentes.colaborador asistentes.firmadoEn').sort({ fecha: -1 }).limit(50).lean();
  const o = c.toObject();
  return {
    ...resumen(o, t),
    persona: { tipoId: t.tipoId, numId: t.numId, nombre: nombreTercero(t), celular: t.celular || t.telefono || '', correo: t.correo || '', direccion: t.direccion || '',
      fechaNacimiento: t.fechaNacimiento || null, licencia: t.licencia || null, placas: t.placas || [], roles: t.roles || [] },
    ingreso: o.ingreso, contactoEmergencia: o.contactoEmergencia || {},
    examenes: [...(o.examenes || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((x) => ({ id: String(x._id), tipo: x.tipo, fecha: x.fecha, vence: x.vence, concepto: x.concepto, restricciones: x.restricciones, entidad: x.entidad,
        estado: x.vence ? estadoVence(x.vence) : 'sin_dato' })),
    eppEntregas: [...(o.epp || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((x) => ({ id: String(x._id), fecha: x.fecha, motivo: x.motivo, elementos: x.elementos, observacion: x.observacion, proximaReposicion: x.proximaReposicion || null,
        firmadoEn: x.firmadoEn, firmaOrigen: x.firmaOrigen, pendienteApp: !!x.solicitudApp && !x.firmadoEn })),
    comparendosLista: [...(o.comparendos || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .map((x) => ({ id: String(x._id), fecha: x.fecha, numero: x.numero, codigo: x.codigo, descripcion: x.descripcion, placa: x.placa, valor: x.valor, estado: x.estado })),
    capacitaciones: capacitaciones.map((k) => {
      const a = k.asistentes.find((x) => String(x.colaborador) === String(c._id));
      return { id: String(k._id), fecha: k.fecha, tema: k.tema, eje: k.eje, horas: k.horas, ejecutada: k.ejecutada, firmada: !!a?.firmadoEn };
    }),
  };
}

export async function actualizar(empresaId, id, d) {
  const c = await cargar(empresaId, id);
  for (const k of ['cargo', 'vinculacion', 'ingreso', 'seguridadSocial', 'contactoEmergencia', 'activo']) if (d[k] !== undefined) c.set(k, d[k]);
  if (d.tipo) c.tipo = d.tipo;
  await c.save();
  return perfil(empresaId, id);
}

// ── Exámenes médicos: solo concepto, fechas y restricciones ──
export async function agregarExamen(empresaId, id, d, usuarioId) {
  if (!noFutura(d.fecha)) throw new ErrorHttp(400, 'La fecha del examen no puede ser futura');
  if (d.vence && new Date(d.vence) < new Date(d.fecha)) throw new ErrorHttp(400, 'La vigencia no puede ser anterior a la fecha del examen');
  const c = await cargar(empresaId, id);
  c.examenes.push({ ...d, registradoPor: usuarioId });
  await c.save();
  return perfil(empresaId, id);
}

export async function quitarExamen(empresaId, id, examenId) {
  const c = await cargar(empresaId, id);
  const x = c.examenes.id(examenId);
  if (!x) throw new ErrorHttp(404, 'Examen no encontrado');
  x.deleteOne();
  await c.save();
  return perfil(empresaId, id);
}

// ── EPP: entrega con la firma de quien recibe (en la web o en la app) ──
export async function agregarEpp(empresaId, id, d, usuarioId) {
  if (!noFutura(d.fecha)) throw new ErrorHttp(400, 'La fecha de entrega no puede ser futura');
  if (d.proximaReposicion && new Date(d.proximaReposicion) <= new Date(d.fecha)) throw new ErrorHttp(400, 'La próxima reposición debe ser posterior a la entrega');
  const c = await cargar(empresaId, id);
  c.epp.push({ fecha: d.fecha, motivo: d.motivo, elementos: d.elementos, observacion: d.observacion, proximaReposicion: d.proximaReposicion || null,
    ...(d.firma ? { firma: d.firma, firmadoEn: new Date(), firmaOrigen: 'web' } : {}), registradoPor: usuarioId });
  await c.save();
  return { perfil: await perfil(empresaId, id), eppId: String(c.epp[c.epp.length - 1]._id) };
}

/** Firma tomada después en la web (por ejemplo, si el conductor está en la oficina). */
export async function firmarEpp(empresaId, id, eppId, firma, origen = 'web', fecha = new Date()) {
  const c = await cargar(empresaId, id, { conFirmas: true });
  const x = c.epp.id(eppId);
  if (!x) throw new ErrorHttp(404, 'Entrega no encontrada');
  if (x.firmadoEn) throw new ErrorHttp(409, 'Esta entrega ya está firmada');
  x.firma = firma; x.firmadoEn = fecha; x.firmaOrigen = origen;
  await c.save();
  return perfil(empresaId, id);
}

export async function marcarSolicitudEpp(empresaId, id, eppId, solicitudId) {
  await SstColaborador.updateOne({ empresa: empresaId, _id: id, 'epp._id': eppId }, { $set: { 'epp.$.solicitudApp': solicitudId } });
}

export async function quitarEpp(empresaId, id, eppId) {
  const c = await cargar(empresaId, id);
  const x = c.epp.id(eppId);
  if (!x) throw new ErrorHttp(404, 'Entrega no encontrada');
  if (x.firmadoEn) throw new ErrorHttp(409, 'Una entrega firmada no se borra: es evidencia');
  x.deleteOne();
  await c.save();
  return perfil(empresaId, id);
}

export async function firmaEpp(empresaId, id, eppId) {
  const c = await cargar(empresaId, id, { conFirmas: true });
  const t = await Tercero.findOne({ empresa: empresaId, _id: c.tercero }).select(CAMPOS_TERCERO).lean();
  const x = c.epp.id(eppId);
  if (!x) throw new ErrorHttp(404, 'Entrega no encontrada');
  return { colaborador: { nombre: nombreTercero(t), documento: t?.numId || '', cargo: c.cargo }, entrega: x.toObject() };
}

// ── Comparendos (registro manual; no hay conexión con el SIMIT) ──
export async function agregarComparendo(empresaId, id, d, usuarioId) {
  if (!noFutura(d.fecha)) throw new ErrorHttp(400, 'La fecha del comparendo no puede ser futura');
  const c = await cargar(empresaId, id);
  if (d.numero && c.comparendos.some((x) => x.numero === d.numero)) throw new ErrorHttp(409, 'Ese comparendo ya está registrado');
  c.comparendos.push({ ...d, registradoPor: usuarioId });
  await c.save();
  return perfil(empresaId, id);
}

export async function estadoComparendo(empresaId, id, compId, estado) {
  const c = await cargar(empresaId, id);
  const x = c.comparendos.id(compId);
  if (!x) throw new ErrorHttp(404, 'Comparendo no encontrado');
  x.estado = estado;
  await c.save();
  return perfil(empresaId, id);
}

export async function quitarComparendo(empresaId, id, compId) {
  const c = await cargar(empresaId, id);
  const x = c.comparendos.id(compId);
  if (!x) throw new ErrorHttp(404, 'Comparendo no encontrado');
  x.deleteOne();
  await c.save();
  return perfil(empresaId, id);
}

/** Colaborador por cédula (lo usa la app del conductor y el tablero). */
export async function porDocumento(empresaId, numId) {
  const t = await Tercero.findOne({ empresa: empresaId, tipoId: { $ne: 'N' }, numId }).select('_id').lean();
  return t ? SstColaborador.findOne({ empresa: empresaId, tercero: t._id }) : null;
}
