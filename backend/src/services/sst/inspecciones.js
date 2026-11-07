// Inspecciones preoperacionales (las hace el conductor en la app Sur Track nueva).
// La web las consulta por la integración; si la empresa no usa la app, todo queda vacío (sin errores).
import { Empresa, Tercero, Vehiculo } from '../../models/index.js';
import { configuradoServidor, llamarApp } from '../rastreo/surtrack.js';
import { diaColombia } from './comun.js';

/** La empresa usa la app de conductores nueva (y el servidor está conectado). */
export async function usaApp(empresaId) {
  if (!configuradoServidor('app')) return false;
  const e = await Empresa.findById(empresaId).select('rastreo').lean();
  return !!e?.rastreo?.surTrack;
}

/** Último preoperacional por placa → Map(placa → {fecha, resultado, kilometraje, conductor, checklistId}). */
export async function ultimosPorPlaca(empresaId) {
  if (!(await usaApp(empresaId))) return new Map();
  try {
    const l = await llamarApp(`/preoperacionales/ultimos?empresaId=${encodeURIComponent(empresaId)}`);
    return new Map((l || []).map((x) => [x.placa, x]));
  } catch (e) {
    console.warn(`No se pudieron traer los últimos preoperacionales: ${e.message}`);
    return new Map();
  }
}

export async function listar(empresaId, { desde, hasta, placa = '', resultado = '', cedula = '' } = {}) {
  if (!(await usaApp(empresaId))) return { usaApp: false, items: [] };
  const p = new URLSearchParams({ empresaId: String(empresaId) });
  if (desde) p.set('desde', desde);
  if (hasta) p.set('hasta', hasta);
  if (placa) p.set('placa', placa);
  if (resultado) p.set('resultado', resultado);
  if (cedula) p.set('cedula', cedula);
  const items = await llamarApp(`/preoperacionales?${p}`);
  return { usaApp: true, items };
}

/**
 * Hoy: aptos, no aptos y vehículos sin preoperacional (de los conductores con la app).
 * «Sin preoperacional» = placas que usan los conductores con la app y aún no lo hicieron hoy.
 */
export async function hoy(empresaId) {
  if (!(await usaApp(empresaId))) return { usaApp: false, aptos: 0, noAptos: [], sinPreoperacional: [], total: 0, hechos: 0 };
  const dia = diaColombia(new Date());
  const [lista, ultimos] = await Promise.all([llamarApp(`/preoperacionales?empresaId=${encodeURIComponent(empresaId)}&dia=${dia}`), ultimosPorPlaca(empresaId)]);
  const hechas = new Set(lista.map((x) => x.placa));
  // Placas activas de la empresa que algún conductor con la app ya inspeccionó alguna vez
  const activas = new Set((await Vehiculo.find({ empresa: empresaId, activo: { $ne: false }, clase: { $ne: 'remolque' }, placa: { $in: [...ultimos.keys()] } }).select('placa').lean()).map((v) => v.placa));
  const ultimoPorPlaca = new Map();
  for (const x of lista) if (!ultimoPorPlaca.has(x.placa)) ultimoPorPlaca.set(x.placa, x);
  const vigentes = [...ultimoPorPlaca.values()];
  return {
    usaApp: true,
    aptos: vigentes.filter((x) => x.resultado === 'apto').length,
    noAptos: vigentes.filter((x) => x.resultado === 'no_apto').map((x) => ({ placa: x.placa, conductor: x.conductor?.nombre || '', fecha: x.fecha, checklistId: x.checklistId,
      autorizado: !!x.autorizacion, revisado: !!x.revision, criticos: x.criticosMal || [] })),
    sinPreoperacional: [...activas].filter((p) => !hechas.has(p)).sort(),
    total: activas.size,
    hechos: vigentes.length,
  };
}

/** Indicador del mes: aptos y no aptos. */
export async function delMes(empresaId) {
  if (!(await usaApp(empresaId))) return null;
  const hoyDia = diaColombia(new Date());
  const l = await llamarApp(`/preoperacionales?empresaId=${encodeURIComponent(empresaId)}&desde=${hoyDia.slice(0, 8)}01&hasta=${hoyDia}`);
  return { aptos: l.filter((x) => x.resultado === 'apto').length, noAptos: l.filter((x) => x.resultado === 'no_apto').length };
}

export async function detalle(empresaId, checklistId) {
  const d = await llamarApp(`/checklist/${encodeURIComponent(checklistId)}`);
  // Solo de la empresa: el conductor debe estar entre sus terceros
  const t = d.chofer?.cedula ? await Tercero.exists({ empresa: empresaId, numId: d.chofer.cedula }) : null;
  if (!t) { const e = new Error('Inspección no encontrada'); e.status = 404; throw e; }
  return d;
}

export const revisar = (checklistId, por, accion) => llamarApp(`/checklist/${encodeURIComponent(checklistId)}/revisar`, { metodo: 'POST', cuerpo: { por, accion } });
export const autorizar = (checklistId, por, motivo) => llamarApp(`/checklist/${encodeURIComponent(checklistId)}/autorizar`, { metodo: 'POST', cuerpo: { por, motivo } });
// Un preoperacional por día: la oficina habilita que el conductor haga otro hoy (queda quién y por qué)
export const permitirRepetir = (checklistId, por, motivo) => llamarApp(`/checklist/${encodeURIComponent(checklistId)}/permitir-repetir`, { metodo: 'POST', cuerpo: { por, motivo } });
