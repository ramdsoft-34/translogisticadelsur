// Fase 8: el PESV alimentado por Sur Track.
//  - Copia de los checklists preoperacionales de los conductores (evidencia aunque Sur Track cambie o borre).
//  - Excesos de velocidad (velocidad máxima del viaje sobre el límite de la empresa).
//  - Conducción continua: tramos en ruta sin una pausa de al menos N minutos (aviso de fatiga).
//  - Kilómetros recorridos por placa (para el mantenimiento por kilómetros).
import mongoose from 'mongoose';
import { Empresa, Viaje, Tercero, Vehiculo, InspeccionSst, RegistroSst } from '../../models/index.js';
import * as st from '../rastreo/surtrack.js';
import { ETIQUETAS_CHECKLIST } from '../reportes/checklist.js';
import { CRITICOS_SURTRACK, evaluarSurTrack, diaColombia, diaFecha } from './checklistSurTrack.js';

const MIN = 60e3;

// Minutos de la racha más larga manejando sin una pausa de al menos `pausaMin` minutos.
// Eventos de Sur Track: inicio / en_ruta (empieza o sigue la marcha), detenido / entrega / sin_senal / finalizado (para).
export function conduccionContinua(eventos = [], { pausaMin = 15, fin = null } = {}) {
  const ev = [...eventos].filter(e => e?.fecha).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const MARCHA = new Set(['inicio', 'en_ruta']); const PARA = new Set(['detenido', 'entrega', 'finalizado']);
  let racha = 0; let mayor = 0; let desde = null; let parado = null;
  for (const e of ev) {
    const t = new Date(e.fecha).getTime();
    if (MARCHA.has(e.tipo)) {
      if (parado != null) {                       // vuelve a la marcha: ¿la parada fue una pausa?
        if (t - parado >= pausaMin * MIN) racha = 0;
        parado = null;
      }
      if (desde == null) desde = t;
    } else if (PARA.has(e.tipo) && desde != null) {
      racha += (t - desde) / MIN; desde = null; parado = t;
      mayor = Math.max(mayor, racha);
      if (e.tipo === 'finalizado') racha = 0;
    }
  }
  if (desde != null && fin) { racha += (new Date(fin).getTime() - desde) / MIN; mayor = Math.max(mayor, racha); }
  return Math.round(mayor);
}

// Checklist de Sur Track → copia en la plataforma
export function copiaDeChecklist(c, { viaje = null, tercero = null, vehiculo = null } = {}) {
  const ev = evaluarSurTrack(c, viaje?.fecha);
  const items = Object.entries(ETIQUETAS_CHECKLIST).flatMap(([grupo, def]) => Object.entries(def.items).map(([codigo, texto]) =>
    ({ grupo, codigo, texto, critico: CRITICOS_SURTRACK.includes(codigo), cumple: c[grupo]?.[codigo] === true })));
  const ub = c.ubicacion || c.firma?.ubicacion || (c.lat != null ? { lat: c.lat, lng: c.lng } : null);
  const img = String(c.firma?.imagenBase64 || '').replace(/\s/g, '');
  return {
    checklistId: String(c.checklistId), viaje: viaje?._id || null, numeroViaje: viaje?.numero ?? null, fechaViaje: viaje?.fecha || null,
    vehiculo: vehiculo?._id || null, placa: String(viaje?.placa || c.placa || '').toUpperCase(),
    tercero: tercero?._id || null, conductor: c.firma?.nombre || viaje?.conductorNombre || '', cedula: c.firma?.cedula || tercero?.numId || '',
    fecha: new Date(c.fecha), items, completo: c.completo !== false, apto: ev.apto, delDia: ev.delDia,
    venceRtmDeclarada: c.venceRevisionTecnica ? new Date(c.venceRevisionTecnica) : null,
    ubicacion: { lat: ub?.lat ?? null, lng: ub?.lng ?? null },
    firma: c.firma ? { rol: 'conductor', nombre: c.firma.nombre || '', documento: c.firma.cedula || '', imagen: img ? (img.startsWith('data:') ? img : `data:image/png;base64,${img}`) : '',
      fecha: c.firma.fecha ? new Date(c.firma.fecha) : new Date(c.fecha) } : null,
  };
}

// Trae de Sur Track los checklists de los viajes de los últimos `dias` días que aún no tienen copia.
// Como mucho una vez cada 15 minutos por empresa (salvo `forzar`).
const ultimaSync = new Map();
export async function sincronizarChecklists(empresaId, { dias = 2, forzar = false, hoy = new Date() } = {}) {
  const clave = String(empresaId);
  if (!forzar && Date.now() - (ultimaSync.get(clave) || 0) < 15 * MIN) return { omitido: 'reciente' };
  ultimaSync.set(clave, Date.now());
  try { await st.exigirHabilitado(empresaId); } catch (e) { return { omitido: e.message }; }
  const empresa = new mongoose.Types.ObjectId(clave);
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - dias));
  const viajes = await Viaje.find({ empresa, fecha: { $gte: desde }, estado: { $ne: 'anulado' }, conductor: { $ne: null } })
    .select('numero fecha placa conductor conductorNombre').sort({ fecha: -1 }).limit(400).lean();
  const terceros = new Map((await Tercero.find({ empresa, _id: { $in: [...new Set(viajes.map(v => String(v.conductor)))] } }).select('numId').lean()).map(t => [String(t._id), t]));
  const vehiculos = new Map((await Vehiculo.find({ empresa, placa: { $in: [...new Set(viajes.map(v => v.placa))] } }).select('placa').lean()).map(v => [v.placa, v]));
  const vistos = new Set(); let nuevas = 0; let errores = 0;
  for (const v of viajes) {
    const t = terceros.get(String(v.conductor));
    const par = `${t?.numId}|${v.placa}`;
    if (!t?.numId || vistos.has(par)) continue;
    vistos.add(par);
    try {
      const c = await st.checklistPorConductor(t.numId, v.placa);
      if (!c?.checklistId || await InspeccionSst.exists({ empresa, checklistId: String(c.checklistId) })) continue;
      const completo = await st.checklistPorConductor(t.numId, v.placa, { conFirma: true });
      // El viaje al que pertenece: el del mismo conductor y placa con la fecha del checklist (o el más reciente)
      const delDia = viajes.find(x => String(x.conductor) === String(v.conductor) && x.placa === v.placa && diaFecha(x.fecha) === diaColombia(completo.fecha)) || v;
      await InspeccionSst.create({ empresa, ...copiaDeChecklist(completo, { viaje: delDia, tercero: t, vehiculo: vehiculos.get(v.placa) }) });
      nuevas += 1;
    } catch (e) { if (e.code !== 11000) errores += 1; }
  }
  return { revisados: vistos.size, nuevas, errores };
}

// Indicadores del PESV del mes (aaaa-mm), con lo que llega de Sur Track y los reportes de incidentes
export async function indicadores(empresaId, mes) {
  const empresa = new mongoose.Types.ObjectId(String(empresaId));
  const [a, m] = mes.split('-').map(Number);
  const desde = new Date(Date.UTC(a, m - 1, 1)); const hasta = new Date(Date.UTC(a, m, 1));
  const emp = await Empresa.findById(empresa).select('rastreo sst').lean();
  const limite = emp?.rastreo?.velocidadMaxima || 80;
  const horas = emp?.sst?.horasConduccionContinua || 4; const pausaMin = emp?.sst?.minutosPausa || 15;
  const [viajes, checks, incidentes] = await Promise.all([
    Viaje.find({ empresa, fecha: { $gte: desde, $lt: hasta }, estado: { $ne: 'anulado' } })
      .select('numero fecha placa conductor conductorNombre rastreo.activado rastreo.resumen rastreo.eventos rastreo.finalizado').lean(),
    InspeccionSst.find({ empresa, fecha: { $gte: new Date(desde.getTime() - 864e5), $lt: hasta } }).select('placa tercero fecha fechaViaje apto delDia numeroViaje').lean(),
    RegistroSst.countDocuments({ empresa, codigo: 'PESV-FOR-01', createdAt: { $gte: desde, $lt: hasta }, estado: { $ne: 'anulado' } }),
  ]);
  const conRastreo = viajes.filter(v => v.rastreo?.activado);
  const clave = (placa, dia) => `${placa}|${dia}`;
  const checkDia = new Set(checks.filter(c => c.delDia).map(c => clave(c.placa, diaColombia(c.fecha))));
  const conChecklist = viajes.filter(v => checkDia.has(clave(v.placa, diaFecha(v.fecha))));
  const excesos = conRastreo.filter(v => (v.rastreo?.resumen?.velocidadMaxima || 0) > limite)
    .map(v => ({ numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre, velocidad: Math.round(v.rastreo.resumen.velocidadMaxima) }))
    .sort((x, y) => y.velocidad - x.velocidad);
  const fatiga = conRastreo.map(v => ({ numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre,
    minutos: conduccionContinua(v.rastreo?.eventos, { pausaMin, fin: v.rastreo?.finalizado }) })).filter(x => x.minutos > horas * 60).sort((x, y) => y.minutos - x.minutos);
  const km = {};
  for (const v of conRastreo) if (v.rastreo?.resumen?.km) km[v.placa] = (km[v.placa] || 0) + v.rastreo.resumen.km;
  const porConductor = {};
  for (const e of excesos) porConductor[e.conductor] = (porConductor[e.conductor] || 0) + 1;
  const pct = (n, d) => (d ? Math.round(n / d * 1000) / 10 : null);
  return {
    mes, limite, horasConduccion: horas, viajes: viajes.length, viajesConRastreo: conRastreo.length,
    checklist: { conChecklist: conChecklist.length, pct: pct(conChecklist.length, viajes.length), noAptos: checks.filter(c => !c.apto && c.fecha >= desde).length },
    excesos: { total: excesos.length, por100: pct(excesos.length, conRastreo.length),   // excesos por cada 100 viajes con rastreo
      lista: excesos.slice(0, 20), porConductor: Object.entries(porConductor).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([conductor, n]) => ({ conductor, n })) },
    fatiga: { total: fatiga.length, lista: fatiga.slice(0, 20) },
    km: Object.entries(km).map(([placa, k]) => ({ placa, km: Math.round(k) })).sort((x, y) => y.km - x.km),
    kmTotal: Math.round(Object.values(km).reduce((x, y) => x + y, 0)),
    incidentes,
  };
}

// Kilómetros recorridos con Sur Track por placa desde una fecha (para estimar el kilometraje entre lecturas del odómetro)
export async function kmDesde(empresaId, placa, desde) {
  const empresa = new mongoose.Types.ObjectId(String(empresaId));
  const r = await Viaje.aggregate([{ $match: { empresa, placa, 'rastreo.finalizado': { $gt: desde || new Date(0) }, 'rastreo.resumen.km': { $gt: 0 } } },
    { $group: { _id: null, km: { $sum: '$rastreo.resumen.km' } } }]);
  return Math.round(r[0]?.km || 0);
}
