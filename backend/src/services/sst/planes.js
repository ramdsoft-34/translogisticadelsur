// Fase 13: autoevaluación de estándares mínimos, plan de mejora automático, plan anual de trabajo y alertas.
//
// 1. La autoevaluación guarda la calificación de los 60 ítems; el puntaje se calcula (estandares.js).
// 2. Al cerrarla, cada ítem que no cumple crea su acción en el plan de mejora (con plazo según su peso) y las
//    acciones abiertas de ítems que ahora cumplen se cierran solas. También se agenda el informe de avances
//    a la ARL que exige el resultado (crítico 3 meses, moderado 6 meses).
// 3. El plan anual junta el calendario de obligaciones (obligaciones.js) con el plan de mejora.
// 4. Las alertas son las actividades pendientes vencidas o que vencen en 30 días, más avisos de lo que falta.
import { SstAutoevaluacion, SstActividad } from '../../models/sstPlanes.js';
import { Empresa } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { ESTANDARES, calcular, accionesDeMejora, metaSalida, estandar, nivelDe } from './estandares.js';
import { ocurrencias, obligacionesPorResultado } from './obligaciones.js';

// Fechas en hora de Colombia y estado de vencimiento (mismos grupos del tablero: vencido, 7 días, 30 días)
const DIA_MS = 86400000;
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });
export const hoyColombia = (ahora = new Date()) => new Date(`${fmtDia.format(ahora)}T00:00:00-05:00`);
function diasHasta(f, ahora = new Date()) { return f ? Math.round((new Date(`${fmtDia.format(new Date(f))}T00:00:00-05:00`) - hoyColombia(ahora)) / DIA_MS) : null; }
export function estadoVence(f, ahora = new Date()) { const d = diasHasta(f, ahora); return d === null ? 'sin_dato' : d < 0 ? 'vencido' : d <= 7 ? 'semana' : d <= 30 ? 'mes' : 'ok'; }
export function textoVence(f, ahora = new Date()) {
  const d = diasHasta(f, ahora);
  if (d === null) return 'Sin fecha'; if (d < -1) return `Venció hace ${-d} días`; if (d === -1) return 'Venció ayer';
  if (d === 0) return 'Vence hoy'; if (d === 1) return 'Vence mañana'; return `Vence en ${d} días`;
}
// Responsables desde Datos y membrete (Empresa.sst)
async function responsablesDe(empresaId) {
  const e = await Empresa.findById(empresaId).select('sst.responsableSst sst.liderPesv').lean();
  return { responsableSst: e?.sst?.responsableSst || '', liderPesv: e?.sst?.liderPesv || '' };
}

const anioCol = (f = new Date()) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric' }).format(f));

function conResultado(a) {
  if (!a) return a;
  if (a.soloTotal) {
    const total = a.totalRegistrado ?? 0;
    return { ...a, calculo: { total, nivel: nivelDe(total), conteos: null, completa: true, ciclos: null }, meta: null };
  }
  return { ...a, calculo: calcular(a.items), meta: metaSalida(a.items) };
}

export async function listarAutoevaluaciones(empresaId) {
  const l = await SstAutoevaluacion.find({ empresa: empresaId }).sort({ vigencia: -1 }).lean();
  return l.map((a) => {
    const c = conResultado(a).calculo;
    return { id: a._id, vigencia: a.vigencia, fecha: a.fecha, origen: a.origen, estado: a.estado, soloTotal: a.soloTotal,
      total: c.total, nivel: c.nivel, conteos: a.soloTotal ? null : c.conteos, reporteArl: a.reporteArl, recomendacionesArl: a.recomendacionesArl };
  });
}

export async function obtener(empresaId, id) {
  const a = await SstAutoevaluacion.findOne({ _id: id, empresa: empresaId }).lean();
  if (!a) throw new ErrorHttp(404, 'Autoevaluación no encontrada');
  const acciones = await SstActividad.find({ empresa: empresaId, origen: 'mejora', autoevaluacion: a._id }).sort({ fecha: 1 }).lean();
  return { ...conResultado(a), acciones };
}

/** Nueva autoevaluación. copiarDe: id de otra para partir de su calificación. soloTotal: evaluación anterior sin detalle. */
export async function crear(empresaId, d, usuarioId) {
  if (await SstAutoevaluacion.exists({ empresa: empresaId, vigencia: d.vigencia })) throw new ErrorHttp(409, `Ya existe la autoevaluación de la vigencia ${d.vigencia}`);
  let items = ESTANDARES.map((e) => ({ numeral: e.numeral, estado: '', justificacion: '' }));
  if (d.copiarDe) {
    const base = await SstAutoevaluacion.findOne({ _id: d.copiarDe, empresa: empresaId }).lean();
    if (!base || base.soloTotal) throw new ErrorHttp(400, 'La autoevaluación de base no tiene la calificación de los ítems');
    const de = new Map(base.items.map((i) => [i.numeral, i]));
    items = items.map((i) => ({ ...i, estado: de.get(i.numeral)?.estado || '', justificacion: de.get(i.numeral)?.justificacion || '' }));
  }
  if (d.items) {
    const de = new Map(d.items.map((i) => [i.numeral, i]));
    items = items.map((i) => (de.has(i.numeral) ? { ...i, estado: de.get(i.numeral).estado, justificacion: de.get(i.numeral).justificacion || '' } : i));
  }
  const a = await SstAutoevaluacion.create({
    empresa: empresaId, vigencia: d.vigencia, fecha: d.fecha, origen: d.origen || 'plataforma',
    soloTotal: !!d.soloTotal, totalRegistrado: d.soloTotal ? d.total : null, items: d.soloTotal ? [] : items,
    estado: d.soloTotal ? 'cerrada' : 'borrador', cerradaEn: d.soloTotal ? new Date() : null,
    resultado: d.soloTotal ? { total: d.total, nivel: nivelDe(d.total).clave } : undefined,
    reporteArl: d.reporteArl || undefined, creadoPor: usuarioId,
  });
  return obtener(empresaId, a._id);
}

/** Guarda la calificación y los datos de la ARL. Una cerrada solo admite los datos de la ARL. */
export async function guardar(empresaId, id, d, usuarioId) {
  const a = await SstAutoevaluacion.findOne({ _id: id, empresa: empresaId });
  if (!a) throw new ErrorHttp(404, 'Autoevaluación no encontrada');
  if (d.items) {
    if (a.estado === 'cerrada') throw new ErrorHttp(409, 'La autoevaluación está cerrada: reábrala para cambiar la calificación');
    const de = new Map(d.items.map((i) => [i.numeral, i]));
    a.items = a.items.map((i) => (de.has(i.numeral) ? { numeral: i.numeral, estado: de.get(i.numeral).estado, justificacion: de.get(i.numeral).justificacion ?? i.justificacion } : i));
  }
  if (d.fecha) a.fecha = d.fecha;
  if (d.reporteArl) a.reporteArl = d.reporteArl;
  if (d.recomendacionesArl) a.recomendacionesArl = d.recomendacionesArl;
  a.actualizadoPor = usuarioId;
  await a.save();
  return obtener(empresaId, id);
}

/**
 * Cierra la autoevaluación y actualiza el plan: crea las acciones de mejora de los ítems que no cumplen, cierra las
 * abiertas de ítems que ahora cumplen, agenda el informe de avances a la ARL y deja el puntaje en Datos y membrete.
 */
export async function cerrar(empresaId, id, usuarioId) {
  const a = await SstAutoevaluacion.findOne({ _id: id, empresa: empresaId });
  if (!a) throw new ErrorHttp(404, 'Autoevaluación no encontrada');
  if (a.estado === 'cerrada') throw new ErrorHttp(409, 'La autoevaluación ya está cerrada');
  const c = calcular(a.items);
  if (!c.completa) throw new ErrorHttp(400, `Faltan ${c.conteos.sinCalificar} ítem(s) por calificar`);
  const sinJustificar = a.items.filter((i) => i.estado === 'NA' && !i.justificacion.trim()).map((i) => i.numeral);
  if (sinJustificar.length) throw new ErrorHttp(400, `Los ítems que no aplican necesitan justificación: ${sinJustificar.join(', ')}`);

  const responsable = (await responsablesDe(empresaId)).responsableSst;
  const plan = await sincronizarMejora(empresaId, a, { responsable, usuarioId });

  for (const o of obligacionesPorResultado({ vigencia: a.vigencia, fecha: a.fecha, nivel: c.nivel })) {
    await SstActividad.updateOne({ empresa: empresaId, clave: o.clave },
      { $set: { titulo: o.titulo, norma: o.norma, entidad: o.entidad, ciclo: o.ciclo, evidencia: o.evidencia, fecha: o.fecha, autoevaluacion: a._id },
        $setOnInsert: { empresa: empresaId, anio: anioCol(o.fecha), origen: 'norma', responsable, estado: 'pendiente', creadoPor: usuarioId } }, { upsert: true });
  }
  a.estado = 'cerrada'; a.cerradaEn = new Date(); a.cerradaPor = usuarioId;
  a.resultado = { total: c.total, nivel: c.nivel.clave };
  await a.save();
  // El tablero y los formatos siguen usando el porcentaje de Datos y membrete: se actualiza con el calculado
  const ultima = await SstAutoevaluacion.findOne({ empresa: empresaId, estado: 'cerrada' }).sort({ vigencia: -1 }).lean();
  if (String(ultima?._id) === String(a._id)) {
    await Empresa.updateOne({ _id: empresaId }, { $set: { 'sst.puntaje0312': c.total, 'sst.fechaEvaluacion0312': a.fecha } });
  }
  return { ...(await obtener(empresaId, id)), plan };
}

/** Plan de mejora a partir de la calificación: crea lo nuevo y cierra lo que ya se cumple. Devuelve lo que cambió. */
export async function sincronizarMejora(empresaId, a, { responsable = '', usuarioId = null } = {}) {
  const acciones = accionesDeMejora(a.items, { desde: a.fecha, responsable });
  const abiertas = await SstActividad.find({ empresa: empresaId, origen: 'mejora', estado: { $in: ['pendiente', 'en_curso'] } }).lean();
  const abiertaDe = new Map(abiertas.map((x) => [x.numeral, x]));
  let creadas = 0, cerradas = 0;
  for (const ac of acciones) {
    if (abiertaDe.has(ac.numeral)) continue;      // ya hay una acción abierta para ese ítem: se conserva con su avance
    const e = estandar(ac.numeral);
    await SstActividad.create({
      empresa: empresaId, anio: anioCol(ac.fecha), origen: 'mejora', numeral: ac.numeral, titulo: ac.titulo, detalle: `${ac.numeral} ${ac.detalle}`,
      entidad: 'MinTrabajo', norma: 'Res. 0312 de 2019', ciclo: ac.ciclo, responsable: ac.responsable, evidencia: e?.formato || '',
      fecha: ac.fecha, autoevaluacion: a._id, creadoPor: usuarioId,
    });
    creadas += 1;
  }
  const cumple = new Set(a.items.filter((i) => ['C', 'NA'].includes(i.estado)).map((i) => i.numeral));
  for (const x of abiertas) {
    if (!cumple.has(x.numeral)) continue;
    await SstActividad.updateOne({ _id: x._id }, { $set: { estado: 'hecha', hechaEn: new Date(), nota: `Cumple en la autoevaluación de la vigencia ${a.vigencia}`, actualizadoPor: usuarioId } });
    cerradas += 1;
  }
  return { creadas, cerradas };
}

export async function reabrir(empresaId, id, usuarioId) {
  const a = await SstAutoevaluacion.findOne({ _id: id, empresa: empresaId });
  if (!a) throw new ErrorHttp(404, 'Autoevaluación no encontrada');
  if (a.soloTotal) throw new ErrorHttp(400, 'Esta autoevaluación solo tiene el puntaje registrado');
  a.estado = 'borrador'; a.actualizadoPor = usuarioId;
  await a.save();
  return obtener(empresaId, id);
}

export async function borrar(empresaId, id) {
  const a = await SstAutoevaluacion.findOne({ _id: id, empresa: empresaId }).lean();
  if (!a) throw new ErrorHttp(404, 'Autoevaluación no encontrada');
  if (a.estado === 'cerrada' && !a.soloTotal) throw new ErrorHttp(409, 'Una autoevaluación cerrada no se borra: reábrala primero');
  await SstAutoevaluacion.deleteOne({ _id: id, empresa: empresaId });
  await SstActividad.deleteMany({ empresa: empresaId, origen: 'mejora', autoevaluacion: id, estado: 'pendiente' });
}

// ── Plan anual de trabajo ──
/**
 * Agrega al plan del año las obligaciones del calendario que falten. No toca lo que ya existe (fechas ajustadas, hechas…).
 * Si el plan se carga con el año empezado, las fechas que ya pasaron no se agregan (no son alertas reales): se informan.
 */
export async function generarPlanAnual(empresaId, anio, usuarioId, ahora = new Date()) {
  const { responsableSst: responsable, liderPesv } = await responsablesDe(empresaId);
  const vial = liderPesv || responsable;
  let nuevas = 0, anteriores = 0;
  const hoy = hoyColombia(ahora);
  for (const o of ocurrencias(anio)) {
    if (o.fecha < hoy) { anteriores += 1; continue; }
    const r = await SstActividad.updateOne({ empresa: empresaId, clave: o.clave }, {
      $setOnInsert: { empresa: empresaId, anio, origen: 'norma', clave: o.clave, titulo: o.titulo, entidad: o.entidad, norma: o.norma, ciclo: o.ciclo,
        evidencia: o.evidencia, fecha: o.fecha, responsable: ['MinTransporte', 'Supertransporte'].includes(o.entidad) ? vial : responsable, estado: 'pendiente', creadoPor: usuarioId },
    }, { upsert: true });
    nuevas += r.upsertedCount || 0;
  }
  return { nuevas, anteriores };
}

/**
 * Actividades del plan. Con año: las de ese año más las que quedaron abiertas de años anteriores (arrastradas),
 * para que nada pendiente se pierda al cambiar de año.
 */
export async function actividades(empresaId, { anio, origen, estado } = {}) {
  const f = { empresa: empresaId };
  if (anio) f.$or = [{ anio }, { anio: { $lt: anio }, estado: { $in: ['pendiente', 'en_curso'] } }];
  if (origen) f.origen = origen;
  if (estado) f.estado = estado;
  const l = await SstActividad.find(f).sort({ fecha: 1, titulo: 1 }).lean();
  const ahora = new Date();
  return l.map((x) => ({ ...x, arrastrada: !!anio && x.anio < anio,
    vence: ['hecha', 'cancelada'].includes(x.estado) ? null : { estado: estadoVence(x.fecha, ahora), texto: textoVence(x.fecha, ahora) } }));
}

/**
 * Proyección automática: si el año no tiene calendario se carga solo (sin las fechas que ya pasaron) y desde el
 * 1 de diciembre se carga también el del año siguiente. Devuelve los años que cargó.
 */
export async function proyectar(empresaId, ahora = new Date()) {
  const anio = anioCol(ahora);
  const mes = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', month: '2-digit' }).format(ahora));
  const cargados = [];
  for (const y of mes === 12 ? [anio, anio + 1] : [anio]) {
    if (await SstActividad.exists({ empresa: empresaId, anio: y, origen: 'norma', clave: { $not: /^avance-resultado@/ } })) continue;
    const r = await generarPlanAnual(empresaId, y, null, ahora);
    if (r.nuevas) cargados.push({ anio: y, nuevas: r.nuevas });
  }
  return cargados;
}

export function resumenPlan(lista) {
  const vivas = lista.filter((x) => x.estado !== 'cancelada');
  const hechas = vivas.filter((x) => x.estado === 'hecha').length;
  const aLaFecha = vivas.filter((x) => x.estado === 'hecha' || x.vence?.estado === 'vencido').length;
  return { total: vivas.length, hechas, vencidas: vivas.filter((x) => x.vence?.estado === 'vencido').length,
    cumplimiento: aLaFecha ? Math.round(hechas / aLaFecha * 100) : null, avance: vivas.length ? Math.round(hechas / vivas.length * 100) : 0 };
}

export async function crearActividad(empresaId, d, usuarioId) {
  const x = await SstActividad.create({ ...d, empresa: empresaId, origen: 'propia', clave: '', anio: anioCol(d.fecha), creadoPor: usuarioId });
  return x.toObject();
}

export async function actualizarActividad(empresaId, id, d, usuarioId) {
  const x = await SstActividad.findOne({ _id: id, empresa: empresaId });
  if (!x) throw new ErrorHttp(404, 'Actividad no encontrada');
  for (const k of ['titulo', 'detalle', 'responsable', 'recursos', 'evidencia', 'nota', 'fecha', 'estado']) if (d[k] !== undefined) x[k] = d[k];
  if (d.fecha) x.anio = anioCol(d.fecha);
  if (d.estado === 'hecha' && !x.hechaEn) x.hechaEn = new Date();
  if (d.estado && d.estado !== 'hecha') x.hechaEn = null;
  x.actualizadoPor = usuarioId;
  await x.save();
  return x.toObject();
}

export async function borrarActividad(empresaId, id) {
  const x = await SstActividad.findOne({ _id: id, empresa: empresaId }).lean();
  if (!x) throw new ErrorHttp(404, 'Actividad no encontrada');
  if (x.origen !== 'propia') throw new ErrorHttp(400, 'Las actividades de la norma y del plan de mejora no se borran: márquelas como canceladas con una nota');
  await SstActividad.deleteOne({ _id: id });
}

// ── Alertas ──
/** Pendientes vencidas o que vencen en 30 días, y avisos de lo que falta (autoevaluación del año, plan anual). */
export async function alertas(empresaId, ahora = new Date()) {
  const anio = anioCol(ahora);
  const cargados = await proyectar(empresaId, ahora).catch(() => []);
  const hasta = new Date(hoyColombia(ahora).getTime() + 31 * 86400000);
  const [pend, hayPlan, ultima] = await Promise.all([
    SstActividad.find({ empresa: empresaId, estado: { $in: ['pendiente', 'en_curso'] }, fecha: { $lte: hasta } }).sort({ fecha: 1 }).lean(),
    SstActividad.exists({ empresa: empresaId, anio, origen: 'norma' }),
    SstAutoevaluacion.findOne({ empresa: empresaId }).sort({ vigencia: -1 }).lean(),
  ]);
  const items = pend.map((x) => ({ id: x._id, titulo: x.titulo, origen: x.origen, entidad: x.entidad, norma: x.norma, evidencia: x.evidencia,
    responsable: x.responsable, fecha: x.fecha, estado: estadoVence(x.fecha, ahora), texto: textoVence(x.fecha, ahora) }))
    .filter((x) => x.estado !== 'ok');
  const avisos = cargados.map((c) => ({ clave: `proyeccion-${c.anio}`, texto: `Se cargó solo el calendario ${c.anio}: ${c.nuevas} actividades con las fechas de la norma. Revise las fechas y los responsables.` }));
  if (!hayPlan) avisos.push({ clave: 'plan', texto: `Aún no hay plan anual de trabajo ${anio}. Genérelo para recibir las alertas del calendario.` });
  if (!ultima) avisos.push({ clave: 'autoevaluacion', texto: 'No hay autoevaluación de estándares mínimos registrada.' });
  else if (ultima.vigencia < anio - 1) avisos.push({ clave: 'autoevaluacion', texto: `La última autoevaluación es de la vigencia ${ultima.vigencia}. Falta la de ${anio - 1}.` });
  else if (ultima.estado === 'borrador') avisos.push({ clave: 'autoevaluacion', texto: `La autoevaluación de la vigencia ${ultima.vigencia} está sin cerrar: el plan de mejora sale al cerrarla.` });
  const resumen = { vencidas: items.filter((x) => x.estado === 'vencido').length, semana: items.filter((x) => x.estado === 'semana').length, mes: items.filter((x) => x.estado === 'mes').length };
  return { resumen, items, avisos };
}

/** Lo del tablero: última autoevaluación calculada, avance del plan del año y alertas. */
export async function resumenTablero(empresaId, ahora = new Date()) {
  const anio = anioCol(ahora);
  const [ultima, lista, al] = await Promise.all([
    SstAutoevaluacion.findOne({ empresa: empresaId, estado: 'cerrada' }).sort({ vigencia: -1 }).lean(),
    actividades(empresaId, { anio }),
    alertas(empresaId, ahora),
  ]);
  const c = ultima ? conResultado(ultima).calculo : null;
  return {
    autoevaluacion: ultima ? { vigencia: ultima.vigencia, fecha: ultima.fecha, total: c.total, nivel: c.nivel.texto, claveNivel: c.nivel.clave } : null,
    plan: { anio, ...resumenPlan(lista), mejoraAbiertas: lista.filter((x) => x.origen === 'mejora' && ['pendiente', 'en_curso'].includes(x.estado)).length },
    alertas: al,
  };
}
