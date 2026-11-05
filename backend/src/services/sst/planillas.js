// Planilla de seguridad social de los conductores con la app (cuenta activada). Los datos y los PDF viven
// en el backend de Sur Track (la app los sube allá); la oficina consulta y decide desde aquí.
// Las reglas de fecha (día 1 al 5, hora de Colombia) las aplica Sur Track.
import { Empresa } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { configuradoServidor, llamarApp } from '../rastreo/surtrack.js';

/** La empresa usa la app de conductores (y el servidor está conectado). */
export async function exigirApp(empresaId) {
  if (!configuradoServidor('app')) throw new ErrorHttp(503, 'La app de conductores no está configurada en el servidor');
  const e = await Empresa.findById(empresaId).select('rastreo').lean();
  if (!e?.rastreo?.surTrack) throw new ErrorHttp(403, 'La app de conductores no está habilitada para esta empresa');
}

const conEmpresa = (empresaId, q = {}) => new URLSearchParams({ ...q, empresaId: String(empresaId) }).toString();

export async function listar(empresaId, f = {}) {
  const q = {};
  if (/^\d{4}-\d{2}$/.test(f.periodo || '')) q.periodo = f.periodo;
  if (f.estado) q.estado = f.estado;
  if (f.q) q.q = String(f.q).slice(0, 100);
  return llamarApp(`/planillas?${conEmpresa(empresaId, q)}`);
}

export const detalle = (empresaId, id) => llamarApp(`/planillas/${encodeURIComponent(id)}?${conEmpresa(empresaId)}`);
export const historialConductor = (empresaId, terceroId) => llamarApp(`/planillas/conductor/${encodeURIComponent(terceroId)}?${conEmpresa(empresaId)}`);
export const archivo = (empresaId, id, version) =>
  llamarApp(`/planillas/${encodeURIComponent(id)}/archivo?${conEmpresa(empresaId, version ? { version: String(version) } : {})}`, { binario: true });
export const subir = (empresaId, id, por, nombre, datos) =>
  llamarApp(`/planillas/${encodeURIComponent(id)}/archivo?${conEmpresa(empresaId, { por, nombre })}`, { metodo: 'POST', archivo: { tipo: 'application/pdf', datos } });
export const cargaTardia = (empresaId, id, cuerpo) => llamarApp(`/planillas/${encodeURIComponent(id)}/carga-tardia`, { metodo: 'POST', cuerpo: { ...cuerpo, empresaId: String(empresaId) } });
export const excluir = (empresaId, id, cuerpo) => llamarApp(`/planillas/${encodeURIComponent(id)}/excluir`, { metodo: 'POST', cuerpo: { ...cuerpo, empresaId: String(empresaId) } });
export const incluir = (empresaId, id, cuerpo) => llamarApp(`/planillas/${encodeURIComponent(id)}/incluir`, { metodo: 'POST', cuerpo: { ...cuerpo, empresaId: String(empresaId) } });
