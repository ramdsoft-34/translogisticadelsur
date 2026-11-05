// Fase 8: vencimientos del SG-SST y del PESV en un solo lugar (SOAT, técnico-mecánica, pólizas, licencias,
// exámenes médicos, reposición de EPP y mantenimiento preventivo por fecha o por kilómetros) y el resumen del tablero.
import mongoose from 'mongoose';
import { Vehiculo, Tercero, Empleado, Viaje, InspeccionSst, CapacitacionSst, RegistroSst, Empresa } from '../../models/index.js';

const DIA = 864e5;
// Día calendario en Colombia como número de días (para comparar sin horas)
const diaCol = (d) => Math.floor((new Date(d).getTime() - 5 * 3600e3) / DIA);
const diaFecha = (d) => Math.floor(new Date(d).getTime() / DIA);   // fechas guardadas a medianoche UTC

// nivel: 'vencido' | 'semana' (≤ 7 días) | 'mes' (≤ 30 días) | null
export function clasificar(vence, hoy = new Date(), aviso = 30) {
  if (!vence) return null;
  const faltan = diaFecha(vence) - diaCol(hoy);
  if (faltan < 0) return { nivel: 'vencido', dias: faltan };
  if (faltan <= 7) return { nivel: 'semana', dias: faltan };
  if (faltan <= aviso) return { nivel: 'mes', dias: faltan };
  return null;
}

// Próximo mantenimiento de una actividad del plan: lo que llegue primero entre la fecha y los kilómetros
export function proximoMantenimiento(item, kmActual) {
  const porFecha = item.cadaDias && item.ultimaFecha ? new Date(new Date(item.ultimaFecha).getTime() + item.cadaDias * DIA) : null;
  const kmProximo = item.cadaKm && item.ultimoKm != null ? item.ultimoKm + item.cadaKm : null;
  const kmFaltan = kmProximo != null && kmActual != null ? kmProximo - kmActual : null;
  return { porFecha, kmProximo, kmFaltan, vencidoKm: kmFaltan != null && kmFaltan <= 0, cercaKm: kmFaltan != null && kmFaltan > 0 && kmFaltan <= 1000 };
}

const ORDEN = { vencido: 0, semana: 1, mes: 2 };

// Km recorridos con Sur Track por placa desde la última lectura del odómetro (sst.kmFecha)
export async function kmRecorridos(empresa, vehiculos) {
  const desde = vehiculos.map(v => v.sst?.kmFecha).filter(Boolean).sort((a, b) => a - b)[0];
  if (!desde) return {};
  const viajes = await Viaje.find({ empresa, placa: { $in: vehiculos.map(v => v.placa) }, 'rastreo.finalizado': { $gt: desde }, 'rastreo.resumen.km': { $gt: 0 } })
    .select('placa rastreo.finalizado rastreo.resumen.km').lean();
  const fechaDe = new Map(vehiculos.map(v => [v.placa, v.sst?.kmFecha ? new Date(v.sst.kmFecha) : null]));
  const km = {};
  for (const v of viajes) { const f = fechaDe.get(v.placa); if (f && v.rastreo.finalizado > f) km[v.placa] = (km[v.placa] || 0) + v.rastreo.resumen.km; }
  return km;
}
// Odómetro + lo recorrido después con Sur Track
export const kmEstimado = (v, km = {}) => (v.sst?.kmActual == null ? null : Math.round(v.sst.kmActual + (km[v.placa] || 0)));

export async function alertas(empresaId, { hoy = new Date(), aviso = 30 } = {}) {
  const empresa = new mongoose.Types.ObjectId(String(empresaId));
  const lista = [];
  const poner = (tipo, quien, detalle, vence, extra = {}) => {
    const c = clasificar(vence, hoy, aviso);
    if (c) lista.push({ tipo, quien, detalle, vence, ...c, ...extra });
  };
  const vehiculos = await Vehiculo.find({ empresa, activo: true, clase: 'vehiculo' }).select('placa soat venceTecnomecanica sst').lean();
  const km = await kmRecorridos(empresa, vehiculos);
  for (const v of vehiculos) {
    poner('SOAT', v.placa, v.soat?.numero ? `Póliza ${v.soat.numero}` : '', v.soat?.vence, { placa: v.placa, ref: v._id });
    poner('Técnico-mecánica', v.placa, '', v.venceTecnomecanica, { placa: v.placa, ref: v._id });
    poner('RC contractual', v.placa, '', v.sst?.venceRcContractual, { placa: v.placa, ref: v._id });
    poner('RC extracontractual', v.placa, '', v.sst?.venceRcExtracontractual, { placa: v.placa, ref: v._id });
    for (const it of v.sst?.plan || []) {
      const p = proximoMantenimiento(it, kmEstimado(v, km));
      if (p.vencidoKm || p.cercaKm) lista.push({ tipo: 'Mantenimiento', quien: v.placa, detalle: `${it.actividad} · ${p.kmFaltan <= 0 ? `pasado ${Math.abs(p.kmFaltan).toLocaleString('es-CO')} km` : `faltan ${p.kmFaltan.toLocaleString('es-CO')} km`}`,
        vence: null, nivel: p.vencidoKm ? 'vencido' : 'semana', dias: null, placa: v.placa, ref: v._id });
      else poner('Mantenimiento', v.placa, it.actividad, p.porFecha, { placa: v.placa, ref: v._id });
    }
  }
  // Conductores (licencia del RNDC + perfil SST) y empleados de nómina (perfil SST)
  const nombre = (t) => [t.nombres, t.apellido1, t.apellido2, t.apellidos].filter(Boolean).join(' ');
  const perfil = (p, quien, extra) => {
    const ultimo = [...(p?.examenes || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
    if (ultimo?.vence) poner('Examen médico', quien, 'Periódico', ultimo.vence, extra);
    for (const e of p?.epp || []) poner('Reposición de EPP', quien, e.elemento, e.reposicion, extra);
  };
  for (const t of await Tercero.find({ empresa, roles: 'conductor', activo: true }).select('nombres apellido1 apellido2 licencia +sst').lean()) {
    poner('Licencia', nombre(t), t.licencia?.categoria ? `Categoría ${t.licencia.categoria}` : '', t.licencia?.vence, { persona: { tipo: 'tercero', id: t._id } });
    perfil(t.sst, nombre(t), { persona: { tipo: 'tercero', id: t._id } });
  }
  for (const e of await Empleado.find({ empresa, activo: true }).select('nombres apellidos +sst').lean()) perfil(e.sst, nombre(e), { persona: { tipo: 'empleado', id: e._id } });
  return lista.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel] || (a.dias ?? -1e9) - (b.dias ?? -1e9));
}

// Resumen del tablero SG-SST + PESV
export async function resumen(empresaId, { hoy = new Date() } = {}) {
  const empresa = new mongoose.Types.ObjectId(String(empresaId));
  const inicioDia = new Date((diaCol(hoy)) * DIA + 5 * 3600e3);
  const inicioMes = new Date(Date.UTC(new Date(hoy.getTime() - 5 * 3600e3).getUTCFullYear(), new Date(hoy.getTime() - 5 * 3600e3).getUTCMonth(), 1, 5));
  const [emp, vehiculos, personas, hoyInsp, mesInsp, capacitaciones, registrosMes, lista] = await Promise.all([
    Empresa.findById(empresa).select('sst nombre').lean(),
    Vehiculo.find({ empresa, activo: true, clase: 'vehiculo' }).select('placa').lean(),
    Promise.all([Tercero.countDocuments({ empresa, roles: 'conductor', activo: true }), Empleado.countDocuments({ empresa, activo: true })]),
    InspeccionSst.find({ empresa, fecha: { $gte: inicioDia } }).select('placa apto conductor fecha numeroViaje').sort({ fecha: -1 }).lean(),
    InspeccionSst.aggregate([{ $match: { empresa, fecha: { $gte: inicioMes } } }, { $group: { _id: '$apto', n: { $sum: 1 } } }]),
    CapacitacionSst.find({ empresa, fecha: { $gte: new Date(hoy.getTime() - 365 * DIA) } }).select('tema fecha estado eje asistentes horas').sort({ fecha: 1 }).lean(),
    RegistroSst.countDocuments({ empresa, createdAt: { $gte: inicioMes }, estado: { $ne: 'anulado' } }),
    alertas(empresa, { hoy }),
  ]);
  // Vehículos que salen hoy (viajes del día) sin el checklist de Sur Track del día
  const fechaHoy = new Date(Date.UTC(new Date(hoy.getTime() - 5 * 3600e3).getUTCFullYear(), new Date(hoy.getTime() - 5 * 3600e3).getUTCMonth(), new Date(hoy.getTime() - 5 * 3600e3).getUTCDate()));
  const viajesHoy = await Viaje.find({ empresa, fecha: fechaHoy, estado: { $ne: 'anulado' } }).select('placa').lean();
  const placasHoy = new Set(hoyInsp.map(i => i.placa));
  const placasViaje = [...new Set(viajesHoy.map(v => v.placa))];
  const c = { total: personas[0] + personas[1], conductores: personas[0], directos: personas[1] };
  const ejecutadas = capacitaciones.filter(x => x.estado === 'ejecutada').length;
  const programadas = capacitaciones.filter(x => x.estado !== 'cancelada').length;
  const proximas = capacitaciones.filter(x => x.estado === 'programada' && diaFecha(x.fecha) >= diaCol(hoy)).slice(0, 5);
  const porNivel = { vencido: 0, semana: 0, mes: 0 };
  for (const a of lista) porNivel[a.nivel] += 1;
  return {
    empresa: { nombre: emp?.nombre, ...(emp?.sst || {}) },
    colaboradores: c, vehiculos: vehiculos.length,
    preoperacional: { hoy: hoyInsp.length, aptos: hoyInsp.filter(i => i.apto).length, noAptos: hoyInsp.filter(i => !i.apto),
      conViaje: placasViaje.length, sinReporte: placasViaje.filter(p => !placasHoy.has(p)),
      mes: Object.fromEntries(mesInsp.map(x => [x._id ? 'aptos' : 'noAptos', x.n])) },
    capacitaciones: { programadas, ejecutadas, cumplimiento: programadas ? Math.round(ejecutadas / programadas * 100) : null, proximas },
    registrosMes, alertas: { ...porNivel, lista: lista.slice(0, 40) },
  };
}
