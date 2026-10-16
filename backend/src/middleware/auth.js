// Autenticación (JWT Bearer) y autorización por permisos.
// En cada petición se recarga el usuario: si fue desactivado, cambió su clave
// (tokenVersion) o su empresa fue desactivada, el token deja de servir.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Usuario, Empresa } from '../models/index.js';
import { tienePermiso, permisosDe } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';

export class ErrorHttp extends Error {
  constructor(status, mensaje, detalles) { super(mensaje); this.status = status; this.detalles = detalles; }
}

export function firmarToken(usuario) {
  return jwt.sign({ sub: String(usuario._id), v: usuario.tokenVersion }, env.jwtSecret,
    { expiresIn: env.jwtExpires, algorithm: 'HS256' });
}

export async function autenticar(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new ErrorHttp(401, 'Debe iniciar sesión');
  let datos;
  try {
    datos = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new ErrorHttp(401, 'La sesión expiró o no es válida');
  }
  const usuario = await Usuario.findById(datos.sub).lean();
  if (!usuario || !usuario.activo || usuario.tokenVersion !== datos.v) throw new ErrorHttp(401, 'La sesión ya no es válida');
  if (usuario.rol !== 'superadmin') {
    const empresa = await Empresa.findById(usuario.empresa).select('activa nombre').lean();
    if (!empresa?.activa) throw new ErrorHttp(403, 'La empresa está inactiva');
    req.empresaId = usuario.empresa;
  }
  req.usuario = usuario;
  req.permisos = permisosDe(usuario.rol);
  next();
}

// Exige al menos uno de los permisos indicados.
// Los intentos de acceso sin permiso quedan en la auditoría (resultado «denegado»).
export const permitir = (...permisos) => async (req, _res, next) => {
  if (!req.usuario || !permisos.some(p => tienePermiso(req.usuario.rol, p))) {
    await auditar(req, 'acceso_denegado', { resultado: 'denegado', detalle: { metodo: req.method, ruta: req.originalUrl.split('?')[0], requiere: permisos } });
    throw new ErrorHttp(403, 'No tiene permiso para esta acción');
  }
  next();
};

// Rutas de operación: solo usuarios de una empresa (nunca el SuperAdmin).
export async function soloEmpresa(req, _res, next) {
  if (!req.empresaId) {
    await auditar(req, 'acceso_denegado', { resultado: 'denegado', detalle: { metodo: req.method, ruta: req.originalUrl.split('?')[0], motivo: 'ruta de empresa' } });
    throw new ErrorHttp(403, 'Esta sección es de uso de las empresas');
  }
  next();
}

// Filtro base por empresa para todas las consultas de la empresa del usuario.
export const deEmpresa = (req, extra = {}) => ({ ...extra, empresa: req.empresaId });
