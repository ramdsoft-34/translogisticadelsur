// Planilla de seguridad social de los conductores. Los datos y los PDF viven en el backend de Sur Track
// (la app los sube allá); Translogística le manda la lista de conductores activos y la oficina
// consulta y decide desde aquí. Las reglas de fecha (día 1 al 5, hora de Colombia) las aplica Sur Track.
import { Empresa, Tercero } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { configuradoServidor, llamarApp } from '../rastreo/surtrack.js';

const digitos = (v) => String(v || '').replace(/\D/g, '');
const nombreDe = (t) => [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ').trim();

/** La empresa usa la app de conductores (y el servidor está conectado). */
export async function exigirApp(empresaId) {
  if (!configuradoServidor('app')) throw new ErrorHttp(503, 'La app de conductores no está configurada en el servidor');
  const e = await Empresa.findById(empresaId).select('rastreo').lean();
  if (!e?.rastreo?.surTrack) throw new ErrorHttp(403, 'La app de conductores no está habilitada para esta empresa');
}

// Conductores activos: Terceros con rol conductor, persona natural (no NIT) y con documento válido
export async function conductoresActivos(empresaId) {
  const lista = await Tercero.find({ empresa: empresaId, roles: 'conductor', activo: true, tipoId: { $ne: 'N' } })
    .select('numId nombres apellido1 apellido2').lean();
  return lista.map(t => ({ terceroId: String(t._id), cedula: digitos(t.numId), nombre: nombreDe(t) })).filter(c => c.cedula.length >= 5);
}

// La lista se manda al abrir el módulo (máximo cada 5 minutos por empresa) y cada 6 horas para todas
const ultimoEnvio = new Map();
export async function enviarPadron(empresaId, { forzar = false } = {}) {
  const clave = String(empresaId);
  if (!forzar && Date.now() - (ultimoEnvio.get(clave) || 0) < 5 * 60000) return null;
  const r = await llamarApp('/planillas/padron', { metodo: 'PUT', cuerpo: { empresaId: clave, conductores: await conductoresActivos(empresaId) } });
  ultimoEnvio.set(clave, Date.now());
  return r;
}

export async function enviarPadronTodas() {
  if (!configuradoServidor('app')) return;
  for (const e of await Empresa.find({ 'rastreo.surTrack': true, activa: { $ne: false } }).select('_id').lean()) {
    try { await enviarPadron(e._id, { forzar: true }); }
    catch (err) { console.warn(`Planillas: no se pudo enviar la lista de conductores (${e._id}): ${err.message}`); }
  }
}

export function iniciarPadronPeriodico() {
  setTimeout(() => void enviarPadronTodas(), 30000).unref();
  return setInterval(() => void enviarPadronTodas(), 6 * 3600000).unref();
}

const conEmpresa = (empresaId, q = {}) => new URLSearchParams({ ...q, empresaId: String(empresaId) }).toString();

export async function listar(empresaId, f = {}) {
  await enviarPadron(empresaId).catch(() => null);   // si falla, se muestra lo último que se sabe
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
