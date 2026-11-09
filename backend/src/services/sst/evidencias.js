// Sugerencia de cumple / no cumple con lo que ya tiene la plataforma (para la vigencia que se evalúa).
// Es una sugerencia con su motivo: la calificación final la confirma el responsable del SG-SST, que es quien firma.
// Lo que la plataforma no puede saber (política firmada, matriz legal escrita, curso de 50 horas…) no se sugiere.
// Fuentes: Datos y membrete, Colaboradores, Flota, Capacitaciones, Formatos, Planillas y Preoperacional (app de conductores).
import { Vehiculo } from '../../models/index.js';
import { SstEmpresa, SstColaborador, SstVehiculo, SstCapacitacion, SstFormato } from '../../models/sst.js';
import { SstActividad } from '../../models/sstPlanes.js';
import * as planillas from './planillas.js';
import * as inspecciones from './inspecciones.js';

const rango = (vigencia) => ({ $gte: new Date(`${vigencia}-01-01T00:00:00-05:00`), $lt: new Date(`${vigencia + 1}-01-01T00:00:00-05:00`) });
const C = (motivo, fuente) => ({ estado: 'C', motivo, fuente });
const NC = (motivo, fuente) => ({ estado: 'NC', motivo, fuente });
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const diaCol = (f) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(f);

/**
 * Reglas puras: reciben lo que se contó en la base de datos y devuelven la sugerencia de cada numeral.
 * d: { responsable, licencia, planillas: { cumplimiento } | null, capacitaciones: { programadas, vencidas, ejecutadas, induccion },
 *      actas, personas: { total, conExamen }, eppFirmados, inspecciones, mantenimiento: { vehiculos, conPreventivo }, simulacros,
 *      actividades: { [obligacion]: { total, hechas } }, mejora: { abiertasVencidas, total } }
 */
export function reglas(d) {
  const s = {};
  s['1.1.1'] = d.responsable && d.licencia ? C(`Responsable del SG-SST: ${d.responsable}, licencia ${d.licencia}`, 'Datos y membrete')
    : NC('Falta el responsable del SG-SST o su licencia en Datos y membrete', 'Datos y membrete');
  if (d.planillas) s['1.1.4'] = d.planillas.cumplimiento >= 100 ? C('Planillas del último mes al 100 %', 'Planillas')
    : NC(`Planillas del último mes al ${d.planillas.cumplimiento ?? 0} %: faltan conductores por presentar`, 'Planillas');
  if (d.actas !== null) s['1.1.6'] = d.actas >= 10 ? C(`${plural(d.actas, 'acta', 'actas')} de reunión en el año`, 'Formatos (SST-ACT-01)')
    : NC(`Solo ${plural(d.actas, 'acta', 'actas')} de reunión en el año; el Vigía se reúne cada mes`, 'Formatos (SST-ACT-01)');
  const k = d.capacitaciones;
  if (!k.programadas) s['1.2.1'] = NC('No hay programa de capacitación en el año', 'Capacitaciones');
  else s['1.2.1'] = k.vencidas && k.ejecutadas / k.vencidas >= 0.8
    ? C(`${k.ejecutadas} de ${k.vencidas} capacitaciones a la fecha ejecutadas (${k.programadas} en el programa)`, 'Capacitaciones')
    : NC(`${k.ejecutadas} de ${k.vencidas} capacitaciones a la fecha ejecutadas`, 'Capacitaciones');
  s['1.2.2'] = k.induccion ? C(`${plural(k.induccion, 'inducción ejecutada', 'inducciones ejecutadas')} en el año`, 'Capacitaciones')
    : NC('No hay inducción ni reinducción ejecutada en el año', 'Capacitaciones');
  if (d.personas.total) s['3.1.4'] = d.personas.conExamen >= d.personas.total
    ? C(`Los ${d.personas.total} colaboradores tienen examen médico vigente`, 'Colaboradores')
    : NC(`${d.personas.conExamen} de ${d.personas.total} colaboradores con examen médico vigente`, 'Colaboradores');
  s['4.2.4'] = d.inspecciones ? C(`${plural(d.inspecciones, 'inspección', 'inspecciones')} registradas en el año`, 'Formatos y preoperacional')
    : NC('No hay inspecciones registradas en el año', 'Formatos y preoperacional');
  if (d.mantenimiento.vehiculos) s['4.2.5'] = d.mantenimiento.conPreventivo / d.mantenimiento.vehiculos >= 0.8
    ? C(`${d.mantenimiento.conPreventivo} de ${d.mantenimiento.vehiculos} vehículos con mantenimiento preventivo en el año`, 'Flota')
    : NC(`${d.mantenimiento.conPreventivo} de ${d.mantenimiento.vehiculos} vehículos con mantenimiento preventivo en el año`, 'Flota');
  s['4.2.6'] = d.eppFirmados ? C(`${plural(d.eppFirmados, 'entrega', 'entregas')} de EPP firmadas en el año`, 'Colaboradores y formatos (SST-FOR-02)')
    : NC('No hay entregas de EPP firmadas en el año', 'Colaboradores y formatos (SST-FOR-02)');
  s['5.1.2'] = d.simulacros ? C(`${plural(d.simulacros, 'simulacro', 'simulacros')} en el año`, 'Formatos (SST-FOR-03)') : NC('No hay acta de simulacro en el año', 'Formatos (SST-FOR-03)');
  // Lo que se marcó como hecho en el plan anual
  const hecha = (ob, num, texto) => { const a = d.actividades[ob]; if (a?.total) s[num] = a.hechas ? C(`${texto}: hecha en el plan anual`, 'Plan anual') : NC(`${texto}: pendiente en el plan anual`, 'Plan anual'); };
  hecha('matriz-legal', '2.7.1', 'Actualización de la matriz legal');
  hecha('rendicion', '2.6.1', 'Rendición de cuentas');
  hecha('matriz-peligros', '4.1.2', 'Revisión de la matriz de peligros');
  hecha('auditoria', '6.1.2', 'Auditoría interna');
  hecha('revision-direccion', '6.1.3', 'Revisión por la alta dirección');
  const ind = d.actividades.indicadores;
  if (ind?.total) for (const n of ['3.3.1', '3.3.2', '3.3.6'])
    s[n] = ind.hechas >= Math.min(10, ind.total) ? C(`Indicadores medidos ${ind.hechas} de ${ind.total} meses`, 'Plan anual') : NC(`Indicadores medidos solo ${ind.hechas} de ${ind.total} meses`, 'Plan anual');
  if (d.mejora.total) s['7.1.1'] = d.mejora.abiertasVencidas === 0 ? C('El plan de mejora no tiene acciones vencidas', 'Plan de mejora')
    : NC(`${plural(d.mejora.abiertasVencidas, 'acción vencida', 'acciones vencidas')} en el plan de mejora`, 'Plan de mejora');
  return s;
}

/** Cuenta en la base de datos lo que usan las reglas. */
export async function datosVigencia(empresaId, vigencia, ahora = new Date()) {
  const r = rango(vigencia);
  const hasta = new Date(Math.min(ahora.getTime(), r.$lt.getTime()));
  const formatos = (codigo) => SstFormato.countDocuments({ empresa: empresaId, codigo, estado: 'final', createdAt: r });
  const [e, caps, actas, simulacros, eppForm, inspForm, vehiculos, hojas, acts, mejora, colaboradores] = await Promise.all([
    SstEmpresa.findOne({ empresa: empresaId }).select('responsables').lean(),
    SstCapacitacion.find({ empresa: empresaId, fecha: r }).select('tema fecha ejecutada').lean(),
    formatos('SST-ACT-01'), formatos('SST-FOR-03'), formatos('SST-FOR-02'), formatos('SST-FOR-01'),
    Vehiculo.find({ empresa: empresaId, activo: { $ne: false }, clase: { $ne: 'remolque' } }).select('_id').lean(),
    SstVehiculo.find({ empresa: empresaId }).select('vehiculo historial.tipo historial.fecha').lean(),
    SstActividad.find({ empresa: empresaId, anio: vigencia, origen: 'norma' }).select('clave estado fecha').lean(),
    SstActividad.find({ empresa: empresaId, origen: 'mejora' }).select('estado fecha').lean(),
    SstColaborador.find({ empresa: empresaId, activo: { $ne: false } }).select('examenes epp.firmadoEn').lean(),
  ]);
  const actividades = {};
  // Solo cuenta lo que ya debía estar hecho a la fecha (lo que vence más adelante no es incumplimiento)
  for (const a of acts.filter((x) => x.estado === 'hecha' || new Date(x.fecha) <= hasta)) { const ob = a.clave.split('@')[0]; actividades[ob] ||= { total: 0, hechas: 0 }; actividades[ob].total += 1; if (a.estado === 'hecha') actividades[ob].hechas += 1; }
  const vigente = (p) => (p.examenes || []).some((x) => x.concepto !== 'no_apto' && (x.vence ? new Date(x.vence) >= ahora : x.fecha && ahora - new Date(x.fecha) < 366 * 864e5));
  const eppPerfil = colaboradores.reduce((s, p) => s + (p.epp || []).filter((x) => x.firmadoEn && x.firmadoEn >= r.$gte && x.firmadoEn < r.$lt).length, 0);
  // Planillas del último mes cerrado y preoperacionales del año (de la app de conductores; sin la app no se sugieren)
  let pl = null;
  try {
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(new Date(hasta.getTime() - 15 * 864e5));
    const l = await planillas.listar(empresaId, { periodo: mes });
    if (l?.indicadores) pl = { cumplimiento: l.indicadores.cumplimiento ?? 0 };
  } catch { pl = null; }
  let preop = 0;
  try {
    const l = await inspecciones.listar(empresaId, { desde: diaCol(r.$gte), hasta: diaCol(new Date(hasta.getTime() - 1)) });
    preop = Array.isArray(l?.items) ? l.items.length : 0;
  } catch { preop = 0; }
  const ids = new Set(vehiculos.map((v) => String(v._id)));
  const conPreventivo = hojas.filter((h) => ids.has(String(h.vehiculo)) && (h.historial || []).some((x) => x.tipo === 'preventivo' && x.fecha >= r.$gte && x.fecha < r.$lt)).length;
  const r0 = e?.responsables || {};
  return {
    responsable: r0.responsableSst || '', licencia: r0.licenciaSst || '', planillas: pl, actas,
    capacitaciones: { programadas: caps.length, vencidas: caps.filter((k) => new Date(k.fecha) <= hasta).length,
      ejecutadas: caps.filter((k) => k.ejecutada).length, induccion: caps.filter((k) => k.ejecutada && /inducci/i.test(k.tema)).length },
    personas: { total: colaboradores.length, conExamen: colaboradores.filter(vigente).length },
    eppFirmados: eppForm + eppPerfil, inspecciones: inspForm + preop,
    mantenimiento: { vehiculos: ids.size, conPreventivo }, simulacros, actividades,
    mejora: { total: mejora.length, abiertasVencidas: mejora.filter((x) => ['pendiente', 'en_curso'].includes(x.estado) && new Date(x.fecha) < ahora).length },
  };
}

export async function sugerencias(empresaId, vigencia, ahora = new Date()) {
  const d = await datosVigencia(empresaId, vigencia, ahora);
  return Object.entries(reglas(d)).map(([numeral, x]) => ({ numeral, ...x }));
}
