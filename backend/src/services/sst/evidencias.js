// Fase 13b: sugerencia de cumple / no cumple con lo que ya tiene la plataforma (para la vigencia que se evalúa).
// Es una sugerencia con su motivo: la calificación final la confirma el responsable del SG-SST, que es quien firma.
// Lo que la plataforma no puede saber (política firmada, matriz legal escrita, curso de 50 horas…) no se sugiere.
import { Empresa, Tercero, Empleado, Vehiculo, CapacitacionSst, Mantenimiento, InspeccionSst, RegistroSst } from '../../models/index.js';
import { SstActividad } from '../../models/sstPlanes.js';
import * as planillas from './planillas.js';

const rango = (vigencia) => ({ $gte: new Date(`${vigencia}-01-01T00:00:00-05:00`), $lt: new Date(`${vigencia + 1}-01-01T00:00:00-05:00`) });
const C = (motivo, fuente) => ({ estado: 'C', motivo, fuente });
const NC = (motivo, fuente) => ({ estado: 'NC', motivo, fuente });
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

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
  if (d.planillas) s['1.1.4'] = d.planillas.cumplimiento >= 100 ? C(`Planillas del último mes al 100 %`, 'Planillas')
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
    ? C(`Las ${d.personas.total} personas tienen examen médico vigente`, 'Personas')
    : NC(`${d.personas.conExamen} de ${d.personas.total} personas con examen médico vigente`, 'Personas');
  s['4.2.4'] = d.inspecciones ? C(`${plural(d.inspecciones, 'inspección', 'inspecciones')} registradas en el año`, 'Formatos y preoperacionales')
    : NC('No hay inspecciones registradas en el año', 'Formatos y preoperacionales');
  if (d.mantenimiento.vehiculos) s['4.2.5'] = d.mantenimiento.conPreventivo / d.mantenimiento.vehiculos >= 0.8
    ? C(`${d.mantenimiento.conPreventivo} de ${d.mantenimiento.vehiculos} vehículos con mantenimiento preventivo en el año`, 'Flota')
    : NC(`${d.mantenimiento.conPreventivo} de ${d.mantenimiento.vehiculos} vehículos con mantenimiento preventivo en el año`, 'Flota');
  s['4.2.6'] = d.eppFirmados ? C(`${plural(d.eppFirmados, 'entrega', 'entregas')} de EPP firmadas en el año`, 'Personas y formatos (SST-FOR-02)')
    : NC('No hay entregas de EPP firmadas en el año', 'Personas y formatos (SST-FOR-02)');
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
  const [e, caps, actas, simulacros, eppForm, inspForm, preop, vehiculos, mants, acts, mejora, terceros, empleados] = await Promise.all([
    Empresa.findById(empresaId).select('sst.responsableSst sst.licenciaSst').lean(),
    CapacitacionSst.find({ empresa: empresaId, fecha: r, estado: { $ne: 'cancelada' } }).select('tema fecha estado').lean(),
    RegistroSst.countDocuments({ empresa: empresaId, codigo: 'SST-ACT-01', estado: { $ne: 'anulado' }, createdAt: r }),
    RegistroSst.countDocuments({ empresa: empresaId, codigo: 'SST-FOR-03', estado: { $ne: 'anulado' }, createdAt: r }),
    RegistroSst.countDocuments({ empresa: empresaId, codigo: 'SST-FOR-02', estado: 'firmado', createdAt: r }),
    RegistroSst.countDocuments({ empresa: empresaId, codigo: 'SST-FOR-01', estado: { $ne: 'anulado' }, createdAt: r }),
    InspeccionSst.countDocuments({ empresa: empresaId, fecha: r }),
    Vehiculo.find({ empresa: empresaId, activo: { $ne: false }, clase: { $ne: 'remolque' } }).select('_id').lean(),
    Mantenimiento.distinct('vehiculo', { empresa: empresaId, tipo: 'preventivo', fecha: r }),
    SstActividad.find({ empresa: empresaId, anio: vigencia, origen: 'norma' }).select('clave estado').lean(),
    SstActividad.find({ empresa: empresaId, origen: 'mejora' }).select('estado fecha').lean(),
    Tercero.find({ empresa: empresaId, roles: 'conductor', activo: true }).select('+sst').lean(),
    Empleado.find({ empresa: empresaId, activo: { $ne: false } }).select('+sst').lean().catch(() => []),
  ]);
  const actividades = {};
  for (const a of acts) { const ob = a.clave.split('@')[0]; actividades[ob] ||= { total: 0, hechas: 0 }; actividades[ob].total += 1; if (a.estado === 'hecha') actividades[ob].hechas += 1; }
  const personas = [...terceros, ...empleados];
  const vigente = (p) => (p.sst?.examenes || []).some((x) => x.concepto !== 'no_apto' && (x.vence ? new Date(x.vence) >= ahora : x.fecha && ahora - new Date(x.fecha) < 366 * 864e5));
  const eppPerfil = personas.reduce((s, p) => s + (p.sst?.epp || []).filter((x) => x.firma?.imagen && x.entrega && x.entrega >= r.$gte && x.entrega < r.$lt).length, 0);
  let pl = null;
  try {
    const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(new Date(hasta.getTime() - 15 * 864e5));
    const l = await planillas.listar(empresaId, { periodo: mes });
    if (l?.indicadores) pl = { cumplimiento: l.indicadores.cumplimiento ?? 0 };
  } catch { pl = null; }   // sin la app de conductores no se sugiere el 1.1.4
  const ids = new Set(vehiculos.map((v) => String(v._id)));
  return {
    responsable: e?.sst?.responsableSst || '', licencia: e?.sst?.licenciaSst || '', planillas: pl, actas,
    capacitaciones: { programadas: caps.length, vencidas: caps.filter((k) => new Date(k.fecha) <= hasta).length,
      ejecutadas: caps.filter((k) => k.estado === 'ejecutada').length, induccion: caps.filter((k) => k.estado === 'ejecutada' && /inducci/i.test(k.tema)).length },
    personas: { total: personas.length, conExamen: personas.filter(vigente).length },
    eppFirmados: eppForm + eppPerfil, inspecciones: inspForm + preop,
    mantenimiento: { vehiculos: ids.size, conPreventivo: mants.filter((v) => ids.has(String(v))).length }, simulacros, actividades,
    mejora: { total: mejora.length, abiertasVencidas: mejora.filter((x) => ['pendiente', 'en_curso'].includes(x.estado) && new Date(x.fecha) < ahora).length },
  };
}

export async function sugerencias(empresaId, vigencia, ahora = new Date()) {
  const d = await datosVigencia(empresaId, vigencia, ahora);
  return Object.entries(reglas(d)).map(([numeral, x]) => ({ numeral, ...x }));
}
