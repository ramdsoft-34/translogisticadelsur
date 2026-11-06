// Vencimientos: una sola lógica para «Alertas» de Datos y para SG-SST.
// Base (licencias, SOAT, técnico-mecánica) y, para SG-SST, pólizas RC, exámenes, EPP y mantenimiento.
import { Tercero, Vehiculo } from '../../models/index.js';
import { SstColaborador, SstVehiculo } from '../../models/sst.js';
import { estadoVence, nombreTercero, textoVence } from './comun.js';
import { estadoActividad, kilometrajeVigente } from './flota.js';

const DIA = 86400000;

/** Lo de Datos → Alertas: licencias de conductores, SOAT y técnico-mecánica que vencen antes de `limite`. */
export async function documentosPorVencer(empresaId, limite) {
  const [terceros, vehiculos] = await Promise.all([
    Tercero.find({ empresa: empresaId, activo: true, roles: 'conductor', 'licencia.vence': { $ne: null, $lte: limite } })
      .select('nombres apellido1 apellido2 numId licencia').lean(),
    Vehiculo.find({ empresa: empresaId, activo: true, $or: [{ 'soat.vence': { $ne: null, $lte: limite } }, { venceTecnomecanica: { $ne: null, $lte: limite } }] })
      .select('placa soat venceTecnomecanica').lean(),
  ]);
  const alertas = [];
  for (const x of terceros) alertas.push({ tipo: 'Licencia', referencia: `${x.nombres} ${x.apellido1}`.trim(), vence: x.licencia.vence,
    nombre: nombreTercero(x), documento: x.numId, detalle: x.licencia.categoria ? `Categoría ${x.licencia.categoria}` : '' });
  for (const v of vehiculos) {
    if (v.soat?.vence && v.soat.vence <= limite) alertas.push({ tipo: 'SOAT', referencia: v.placa, vence: v.soat.vence, placa: v.placa, detalle: v.soat.numero ? `Póliza ${v.soat.numero}` : '' });
    if (v.venceTecnomecanica && v.venceTecnomecanica <= limite) alertas.push({ tipo: 'Tecnomecánica', referencia: v.placa, vence: v.venceTecnomecanica, placa: v.placa, detalle: '' });
  }
  alertas.sort((a, b) => new Date(a.vence) - new Date(b.vence));
  return alertas;
}

/**
 * Todo lo de SG-SST que vence en los próximos `dias`, agrupado por estado.
 * `kmPreoperacional`: último kilometraje del preoperacional por placa (si la app está activa).
 */
export async function vencimientosSst(empresaId, { dias = 30, kmPreoperacional = new Map(), ahora = new Date() } = {}) {
  const limite = new Date(ahora.getTime() + dias * DIA);
  const items = (await documentosPorVencer(empresaId, limite)).map((a) => ({
    tipo: a.tipo === 'Tecnomecánica' ? 'Técnico-mecánica' : a.tipo, titulo: a.placa || a.nombre || a.referencia, placa: a.placa || '', detalle: a.detalle, vence: a.vence,
  }));

  const [hojas, colaboradores] = await Promise.all([
    SstVehiculo.find({ empresa: empresaId }).lean(),
    SstColaborador.find({ empresa: empresaId, activo: { $ne: false } }).select('tercero examenes epp.fecha epp.proximaReposicion epp.elementos').lean(),
  ]);
  const placas = new Map((await Vehiculo.find({ empresa: empresaId, _id: { $in: hojas.map((h) => h.vehiculo) }, activo: { $ne: false } }).select('placa').lean())
    .map((v) => [String(v._id), v.placa]));
  for (const h of hojas) {
    const placa = placas.get(String(h.vehiculo));
    if (!placa) continue;
    for (const [k, nombre] of [['rcContractual', 'Póliza RC contractual'], ['rcExtracontractual', 'Póliza RC extracontractual']]) {
      const v = h[k]?.vence;
      if (v && new Date(v) <= limite) items.push({ tipo: nombre, titulo: placa, placa, detalle: h[k].numero ? `Póliza ${h[k].numero}` : '', vence: v });
    }
    const p = kmPreoperacional.get(placa);
    const km = kilometrajeVigente([h.kilometraje?.valor != null ? h.kilometraje : null, p ? { valor: p.kilometraje, fecha: p.fecha } : null]).valor;
    for (const a of h.plan || []) {
      const e = estadoActividad(a, km, ahora);
      if (e.estado === 'ok' || e.estado === 'sin_dato') continue;
      items.push({ tipo: 'Mantenimiento', titulo: placa, placa, detalle: a.actividad, vence: e.proxFecha, estadoFijo: e.estado, textoFijo: e.texto, kmFaltan: e.faltanKm });
    }
  }

  const terceros = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: colaboradores.map((c) => c.tercero) } }).select('nombres apellido1 apellido2').lean())
    .map((t) => [String(t._id), nombreTercero(t)]));
  for (const c of colaboradores) {
    const nombre = terceros.get(String(c.tercero));
    if (!nombre) continue;
    // Examen: solo el más reciente con vigencia
    const ex = [...(c.examenes || [])].filter((x) => x.tipo !== 'retiro' && x.fecha).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
    if (ex?.vence && new Date(ex.vence) <= limite) items.push({ tipo: 'Examen médico', titulo: nombre, detalle: `Examen ${ex.tipo === 'ingreso' ? 'de ingreso' : 'periódico'}`, vence: ex.vence });
    // EPP: la reposición pendiente más reciente de cada entrega
    for (const e of c.epp || []) {
      if (!e.proximaReposicion || new Date(e.proximaReposicion) > limite) continue;
      const repuesto = (c.epp || []).some((o) => o !== e && new Date(o.fecha) > new Date(e.fecha) && (o.elementos || []).some((x) => (e.elementos || []).some((y) => y.nombre === x.nombre)));
      if (!repuesto) items.push({ tipo: 'EPP', titulo: nombre, detalle: `Reponer ${(e.elementos || []).map((x) => x.nombre).join(', ')}`.slice(0, 120), vence: e.proximaReposicion });
    }
  }

  const salida = items.map(({ estadoFijo, textoFijo, ...x }) => ({ ...x, estado: estadoFijo || estadoVence(x.vence, ahora), texto: textoFijo || textoVence(x.vence, ahora) }))
    .filter((x) => x.estado !== 'ok' && x.estado !== 'sin_dato');
  const orden = { vencido: 0, semana: 1, mes: 2 };
  salida.sort((a, b) => orden[a.estado] - orden[b.estado] || new Date(a.vence || 0) - new Date(b.vence || 0));
  return {
    items: salida,
    resumen: { vencidos: salida.filter((x) => x.estado === 'vencido').length, semana: salida.filter((x) => x.estado === 'semana').length, mes: salida.filter((x) => x.estado === 'mes').length },
  };
}
