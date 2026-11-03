// Fase 7: horas del cumplido de la remesa según las guías del Ministerio de Transporte (tiempos logísticos V2 y
// cumplido de remesa y manifiesto, junio de 2026).
//
// - La empresa reporta la ENTRADA al cargue y la ENTRADA al descargue. La llegada y la salida de cada punto las
//   reporta la empresa de monitoreo de flota (registro de monitoreo de manifiesto); el RNDC arma el cumplido inicial.
// - Si un punto no se monitorea (sede sin coordenadas, novedad RNMM o incumplimiento de la empresa de monitoreo), la
//   empresa de transporte escribe también su llegada y salida en el cumplido de la remesa.
// - Mercancía consolidada con recolección y/o distribución en varios puntos: no aplica el monitoreo; el RNDC usa un
//   tiempo estándar (1 h de cargue y 1 h de descargue). En el cumplido van las dos entradas.
// - Validaciones del RNDC: llegada ≤ entrada ≤ salida, nada en el futuro y velocidad (km SICETAC ÷ horas entre la
//   salida del cargue y la llegada al descargue) de máximo 90 km/h.
//
// La propuesta usa, en este orden: el GPS de Sur Track (inicio del viaje, llegada al destino, entregas a clientes),
// los tiempos de la tarifa (cliente y destino) y los de la empresa. Siempre la revisa una persona antes de enviar.
import { Empresa, Viaje, RecorridoRastreo } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';

export const VELOCIDAD_MAXIMA = 90;
export const CONSOLIDADA_VARIOS_PUNTOS = ['R', 'D', 'A'];
const MIN = 60000;
const RADIO_LLEGADA_M = 1000;              // a menos de 1 km del destino cuenta como llegada
const ZONA = '-05:00';                     // Colombia, sin horario de verano

// ── Fechas y horas (hora de Colombia) ────────────────────────────────────────
const dosDigitos = (n) => String(n).padStart(2, '0');
export function aFechaHora(d) {
  if (!d) return { fecha: '', hora: '' };
  const c = new Date(new Date(d).getTime() - 5 * 3600e3);       // UTC → Colombia
  return { fecha: `${c.getUTCFullYear()}-${dosDigitos(c.getUTCMonth() + 1)}-${dosDigitos(c.getUTCDate())}`, hora: `${dosDigitos(c.getUTCHours())}:${dosDigitos(c.getUTCMinutes())}` };
}
// fecha: 'aaaa-mm-dd' o Date (día del viaje); hora 'HH:MM' en Colombia
export function deFechaHora(fecha, hora) {
  if (!fecha || !hora || !/^\d{1,2}:\d{2}$/.test(hora)) return null;
  // Las fechas de día (viaje, formularios) se guardan a las 00:00 UTC: se toma ese día tal cual
  const dia = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
  const d = new Date(`${dia}T${hora.padStart(5, '0')}:00${ZONA}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
const mas = (d, minutos) => (d ? new Date(d.getTime() + minutos * MIN) : null);
const mayor = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

// 5 días hábiles (lunes a viernes) para el cumplido del manifiesto desde la entrega. No descuenta festivos.
export function fechaLimiteManifiesto(entrega) {
  if (!entrega) return null;
  const d = new Date(entrega); let n = 0;
  while (n < 5) { d.setUTCDate(d.getUTCDate() + 1); const s = new Date(d.getTime() - 5 * 3600e3).getUTCDay(); if (s !== 0 && s !== 6) n += 1; }
  return d;
}

function distanciaM(a, b) {
  const r = (x) => x * Math.PI / 180; const R = 6371000;
  const dLat = r(b.lat - a.lat); const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Primer punto del recorrido GPS a menos de 1 km del destino (o del primer cliente)
export function llegadaPorGps(puntos = [], destino) {
  if (!destino || !Number.isFinite(destino.lat) || !Number.isFinite(destino.lng)) return null;
  for (const p of puntos) if (p?.length >= 4 && distanciaM({ lat: p[0], lng: p[1] }, destino) <= RADIO_LLEGADA_M) return new Date(p[3]);
  return null;
}

// Parámetros efectivos: tarifa (cliente y destino) y, si están vacíos, los de la empresa
export function parametrosTiempo(empresa = {}, tarifa = {}) {
  const r = empresa.rndc || {};
  const num = (v, def) => (v === null || v === undefined || v === '' ? def : Number(v));
  const tipoOperacion = tarifa.tipoOperacionRemesa || '';
  const consolidacion = tipoOperacion === 'P' ? (tarifa.tipoConsolidacion || '') : '';
  return {
    horaCitaCargue: tarifa.horaCitaCargue || r.horaCitaCargue || '08:00',
    horaCitaDescargue: tarifa.horaCitaDescargue || r.horaCitaDescargue || '18:00',
    pactoCargue: num(tarifa.minutosPactoCargue, num(r.horasPactoCargue, 1) * 60),
    pactoDescargue: num(tarifa.minutosPactoDescargue, num(r.horasPactoDescargue, 1) * 60),
    minutosViaje: num(tarifa.minutosViaje, null), minutosEspera: num(tarifa.minutosEspera, 15), km: num(tarifa.kmRuta, null),
    tipoOperacion, consolidacion, variosPuntos: CONSOLIDADA_VARIOS_PUNTOS.includes(consolidacion),
    cargueMonitoreado: tarifa.cargueMonitoreado !== false, descargueMonitoreado: tarifa.descargueMonitoreado !== false,
  };
}

// ── Propuesta (regla pura) ───────────────────────────────────────────────────
// viaje: { fecha }; gps: { inicio, llegadaDescargue, primeraEntrega, ultimaEntrega } (Date o null)
export function proponerTiempos({ viaje, parametros: p, gps = {} }) {
  const fuente = {};
  const citaCargue = deFechaHora(viaje.fecha, p.horaCitaCargue);
  let citaDescargue = deFechaHora(viaje.fecha, p.horaCitaDescargue);
  if (citaDescargue && citaCargue && citaDescargue <= citaCargue) citaDescargue = mas(citaDescargue, 24 * 60);   // la cita de descargue es al día siguiente
  // Cargue: entrada a la cita; salida = inicio del viaje en Sur Track o entrada + tiempo pactado
  const entradaCargue = citaCargue; fuente.cargue = 'cita de cargue';
  const llegadaCargue = citaCargue;
  let salidaCargue = mas(entradaCargue, p.variosPuntos ? 60 : p.pactoCargue);
  if (gps.inicio && gps.inicio > entradaCargue) { salidaCargue = gps.inicio; fuente.salidaCargue = 'inicio del viaje en Sur Track'; }
  // Descargue: llegada por GPS al destino, primera entrega a un cliente, tiempo de viaje de la ruta o la cita
  let llegada = null;
  if (gps.llegadaDescargue) { llegada = gps.llegadaDescargue; fuente.descargue = 'llegada al destino por GPS (Sur Track)'; }
  else if (gps.primeraEntrega) { llegada = mas(gps.primeraEntrega, -p.minutosEspera); fuente.descargue = 'primera entrega registrada en Sur Track'; }
  else if (p.minutosViaje !== null) { llegada = mas(salidaCargue, p.minutosViaje); fuente.descargue = 'tiempo de viaje de la tarifa'; }
  else { llegada = citaDescargue; fuente.descargue = 'cita de descargue'; }
  // Si llega antes de la cita, entra a la cita; si llega después, entra tras la espera en el sitio
  const entrada = gps.primeraEntrega ? mayor(mas(llegada, p.minutosEspera), null) : mayor(mas(llegada, p.minutosEspera), citaDescargue);
  let salida = gps.ultimaEntrega && gps.ultimaEntrega > entrada ? gps.ultimaEntrega : mas(entrada, p.variosPuntos ? 60 : p.pactoDescargue);
  if (gps.ultimaEntrega && gps.ultimaEntrega > entrada) fuente.salidaDescargue = 'última entrega registrada en Sur Track';
  const ff = aFechaHora;
  return {
    cargueMonitoreado: p.variosPuntos ? true : p.cargueMonitoreado, descargueMonitoreado: p.variosPuntos ? true : p.descargueMonitoreado,
    variosPuntos: p.variosPuntos, consolidacion: p.consolidacion, tipoOperacion: p.tipoOperacion,
    citaCargue: ff(citaCargue), citaDescargue: ff(citaDescargue),
    entradaCargue: ff(entradaCargue), llegadaCargue: ff(llegadaCargue), salidaCargue: ff(salidaCargue),
    llegada: ff(llegada), entrada: ff(entrada), salida: ff(salida), km: p.km, fuente,
    fechaLimiteManifiesto: ff(fechaLimiteManifiesto(entrada)),
  };
}

// ── Validación (regla pura) ──────────────────────────────────────────────────
// datos de la remesa del cumplido: { entradaCargue, llegadaCargue, salidaCargue, llegada, entrada, salida } con { fecha, hora };
// opciones: { cargueMonitoreado, descargueMonitoreado, km, ahora, expedicion }. Devuelve { bloqueantes, avisos }.
export function validarTiempos(r = {}, { cargueMonitoreado = true, descargueMonitoreado = true, km = null, ahora = new Date(), expedicion = null, revisarFuturo = true } = {}) {
  const t = (x) => (x?.fecha && x?.hora ? deFechaHora(x.fecha, x.hora) : null);
  const ec = t(r.entradaCargue); const lc = cargueMonitoreado ? null : t(r.llegadaCargue); const sc = cargueMonitoreado ? null : t(r.salidaCargue);
  const ld = descargueMonitoreado ? null : t(r.llegada); const ed = t(r.entrada); const sd = descargueMonitoreado ? null : t(r.salida);
  const bloqueantes = []; const avisos = [];
  const orden = (a, b, texto) => { if (a && b && a > b) bloqueantes.push(texto); };
  if (!ed) bloqueantes.push('Falta la fecha y hora de entrada al descargue');
  orden(lc, ec, 'Cargue: la entrada no puede ser antes de la llegada');
  orden(ec, sc, 'Cargue: la entrada no puede ser después de la salida');
  orden(ld, ed, 'Descargue: la entrada no puede ser antes de la llegada');
  orden(ed, sd, 'Descargue: la entrada no puede ser después de la salida');
  orden(ec, ed, 'La entrada al descargue no puede ser antes de la entrada al cargue');
  orden(sc, ld, 'La llegada al descargue no puede ser antes de la salida del cargue');
  if (revisarFuturo) for (const [n, d] of [['entrada al cargue', ec], ['salida del cargue', sc], ['llegada al descargue', ld], ['entrada al descargue', ed], ['salida del descargue', sd]]) {
    if (d && d > ahora) bloqueantes.push(`La ${n} está en el futuro: el RNDC no la acepta`);
  }
  // Velocidad: km de la ruta ÷ horas entre la salida del cargue y la llegada al descargue (si no se escriben, entre las entradas)
  const desde = sc || ec; const hasta = ld || ed;
  if (km && desde && hasta && hasta > desde) {
    const kmh = Math.round(km / ((hasta - desde) / 3600e3));
    if (kmh > VELOCIDAD_MAXIMA) bloqueantes.push(`Da ${kmh} km/h para ${km} km: el RNDC no acepta más de ${VELOCIDAD_MAXIMA} km/h. Revise la salida del cargue o la llegada al descargue`);
  }
  if (expedicion && (sc || ec) && (sc || ec) < new Date(new Date(expedicion).getTime() - 24 * 3600e3)) avisos.push('Las horas del cargue son de más de un día antes de la expedición del manifiesto: revíselas');
  return { bloqueantes: [...new Set(bloqueantes)], avisos };
}

// ── Propuesta para un viaje (lee la base) ────────────────────────────────────
export async function propuestaViaje(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).populate({ path: 'tarifaRef', match: { empresa: empresaId } })
    .select('numero fecha pesoKg tarifaRef remesa manifiesto rastreo estado').lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  const empresa = await Empresa.findById(empresaId).select('rndc').lean();
  const p = parametrosTiempo(empresa, v.tarifaRef || {});
  const gps = {};
  const rs = v.rastreo || {};
  if (rs.activo || rs.externoId) {
    const inicio = (rs.eventos || []).find(e => e.tipo === 'inicio')?.fecha || rs.resumen?.inicio;
    if (inicio) gps.inicio = new Date(inicio);
    const entregas = (rs.clientes || []).filter(c => c.fechaEntrega && c.estadoEntrega && c.estadoEntrega !== 'pendiente').map(c => new Date(c.fechaEntrega)).sort((a, b) => a - b);
    if (entregas.length) { gps.primeraEntrega = entregas[0]; gps.ultimaEntrega = entregas.at(-1); }
    const destino = Number.isFinite(rs.destino?.lat) ? rs.destino : (rs.clientes || []).find(c => Number.isFinite(c.lat));
    if (destino) {
      const rec = await RecorridoRastreo.findOne({ empresa: empresaId, viaje: v._id }).select('puntos').lean();
      const l = llegadaPorGps(rec?.puntos || [], destino);
      if (l && (!gps.inicio || l > gps.inicio)) gps.llegadaDescargue = l;
    }
  }
  const propuesta = proponerTiempos({ viaje: v, parametros: p, gps });
  const remesa = { entradaCargue: propuesta.entradaCargue, llegadaCargue: propuesta.llegadaCargue, salidaCargue: propuesta.salidaCargue,
    llegada: propuesta.llegada, entrada: propuesta.entrada, salida: propuesta.salida };
  const revision = validarTiempos(remesa, { cargueMonitoreado: propuesta.cargueMonitoreado, descargueMonitoreado: propuesta.descargueMonitoreado,
    km: p.km, expedicion: v.manifiesto?.fecha });
  return { viaje: v.numero, ...propuesta, cantidadEntregada: v.pesoKg || 0, revision,
    conGps: !!(gps.inicio || gps.llegadaDescargue || gps.primeraEntrega) };
}
