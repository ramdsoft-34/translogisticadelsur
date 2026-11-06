// SG-SST con la app del conductor (backend de Sur Track): pedir firmas de asistencia y de EPP,
// traer las firmas hechas en el celular y consultar los reportes de incidentes.
// Si la empresa no usa la app, nada de esto falla: simplemente no se pide ni se trae.
import { Tercero } from '../../models/index.js';
import { SstCapacitacion, SstColaborador, SstEmpresa } from '../../models/sst.js';
import { llamarApp } from '../rastreo/surtrack.js';
import { usaApp } from './inspecciones.js';
import { nombreTercero } from './comun.js';

const fmt = (f) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' }).format(new Date(f));

async function pedir(empresaId, cuerpo) {
  try {
    const r = await llamarApp('/sst/solicitudes', { metodo: 'POST', cuerpo: { empresaId: String(empresaId), ...cuerpo } });
    return r.id;
  } catch (e) {
    if (e.codigo === 'sin_conductor') return null; // no tiene la app: firma en la web
    throw e;
  }
}

/** Pide al conductor (si tiene la app) firmar el recibido de una entrega de EPP. Devuelve si se pidió. */
export async function pedirFirmaEpp(empresaId, colaboradorId, eppId) {
  if (!(await usaApp(empresaId))) return false;
  const c = await SstColaborador.findOne({ empresa: empresaId, _id: colaboradorId }).lean();
  const e = c?.epp?.find((x) => String(x._id) === String(eppId));
  if (!c || !e || e.firmadoEn) return false;
  const t = await Tercero.findOne({ empresa: empresaId, _id: c.tercero }).select('numId').lean();
  const id = await pedir(empresaId, { cedula: t?.numId || '', tipo: 'epp', referencia: `epp:${colaboradorId}:${eppId}`,
    titulo: `${e.motivo === 'reposicion' ? 'Reposición' : 'Entrega'} de EPP del ${fmt(e.fecha)}`, detalle: e.elementos.map((x) => `${x.cantidad} × ${x.nombre}`), fecha: e.fecha });
  if (id) await SstColaborador.updateOne({ empresa: empresaId, _id: colaboradorId, 'epp._id': eppId }, { $set: { 'epp.$.solicitudApp': id } });
  return !!id;
}

/** Pide la firma de asistencia a los conductores con la app que aún no firmaron. Devuelve cuántos. */
export async function pedirFirmasCapacitacion(empresaId, capacitacionId) {
  if (!(await usaApp(empresaId))) return 0;
  const k = await SstCapacitacion.findOne({ empresa: empresaId, _id: capacitacionId }).lean();
  if (!k) return 0;
  let n = 0;
  for (const a of k.asistentes) {
    if (a.firmadoEn || a.solicitudApp || !a.documento) continue;
    const id = await pedir(empresaId, { cedula: a.documento, tipo: 'capacitacion', referencia: `cap:${capacitacionId}:${a._id}`,
      titulo: k.tema, detalle: [`${fmt(k.fecha)} · ${k.horas} h`, k.facilitador ? `Facilitador: ${k.facilitador}` : '', k.lugar ? `Lugar: ${k.lugar}` : ''].filter(Boolean), fecha: k.fecha });
    if (id) { await SstCapacitacion.updateOne({ empresa: empresaId, _id: k._id, 'asistentes._id': a._id }, { $set: { 'asistentes.$.solicitudApp': id } }); n += 1; }
  }
  return n;
}

/** Cancela en la app la solicitud de un asistente que se quitó (si no la ha firmado). */
export async function cancelarSolicitud(empresaId, solicitudId) {
  if (!solicitudId || !(await usaApp(empresaId))) return;
  await llamarApp(`/sst/solicitudes/${encodeURIComponent(solicitudId)}?empresaId=${encodeURIComponent(empresaId)}`, { metodo: 'DELETE' }).catch(() => {});
}

/**
 * Trae las firmas hechas en la app desde la última vez y las guarda en la capacitación o la entrega.
 * Se llama al abrir Capacitaciones, el perfil de un colaborador o el tablero.
 */
export async function sincronizarFirmas(empresaId) {
  if (!(await usaApp(empresaId))) return 0;
  const conf = await SstEmpresa.findOne({ empresa: empresaId }).select('firmasAppHasta').lean();
  const desde = conf?.firmasAppHasta ? new Date(conf.firmasAppHasta).toISOString() : new Date(0).toISOString();
  let lista;
  try { lista = await llamarApp(`/sst/firmas?empresaId=${encodeURIComponent(empresaId)}&desde=${encodeURIComponent(desde)}`); } catch (e) {
    console.warn(`No se pudieron traer las firmas de la app: ${e.message}`);
    return 0;
  }
  let n = 0; let hasta = conf?.firmasAppHasta || null;
  for (const f of lista) {
    const [tipo, a, b] = String(f.referencia).split(':');
    const cuando = new Date(f.firmadoEn);
    if (tipo === 'cap') {
      const r = await SstCapacitacion.updateOne({ empresa: empresaId, _id: a, asistentes: { $elemMatch: { _id: b, firmadoEn: null } } },
        { $set: { 'asistentes.$.firma': f.firma, 'asistentes.$.firmadoEn': cuando, 'asistentes.$.firmaOrigen': 'app' } });
      n += r.modifiedCount;
    } else if (tipo === 'epp') {
      const r = await SstColaborador.updateOne({ empresa: empresaId, _id: a, epp: { $elemMatch: { _id: b, firmadoEn: null } } },
        { $set: { 'epp.$.firma': f.firma, 'epp.$.firmadoEn': cuando, 'epp.$.firmaOrigen': 'app' } });
      n += r.modifiedCount;
    }
    if (!hasta || cuando > new Date(hasta)) hasta = cuando;
  }
  if (hasta) await SstEmpresa.updateOne({ empresa: empresaId }, { $set: { firmasAppHasta: hasta } }, { upsert: true });
  return n;
}

// ── Reportes de incidentes desde la app ──
export async function incidentes(empresaId, estado = '') {
  if (!(await usaApp(empresaId))) return { usaApp: false, items: [] };
  const items = await llamarApp(`/sst/incidentes?empresaId=${encodeURIComponent(empresaId)}${estado ? `&estado=${estado}` : ''}`);
  return { usaApp: true, items };
}

export async function seguimientoIncidente(empresaId, id, { estado, por, nota }) {
  return llamarApp(`/sst/incidentes/${encodeURIComponent(id)}`, { metodo: 'PUT', cuerpo: { empresaId: String(empresaId), estado, por, nota } });
}

/** Datos para registrar el reporte de la app como formato PESV-FOR-01. */
export function datosFormatoIncidente(i) {
  const fecha = new Date(i.fecha);
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(fecha);
  const hora = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha);
  return {
    datos: {
      tipo: { incidente: 'Incidente', accidente: 'Accidente vial', condicion_insegura: 'Condición insegura' }[i.tipo] || '',
      fecha: dia, hora, lugar: [i.lugar, i.ubicacion ? `(${i.ubicacion.lat.toFixed(5)}, ${i.ubicacion.lng.toFixed(5)})` : ''].filter(Boolean).join(' '),
      placa: i.placa, conductor: i.conductor ? `${i.conductor.nombre} · C.C. ${i.conductor.cedula}` : '',
      lesionados: i.lesionados ? 'Sí' : 'No', cuantos: i.lesionados ? String(i.cuantos) : '', descripcion: i.descripcion, danos: i.danos || '', acciones: '',
    },
  };
}

export { nombreTercero };
