// Autenticación (JWT en cookie HttpOnly o Bearer) y autorización por permisos.
// La interfaz web usa la cookie «tls_sesion»: HttpOnly (JavaScript no la puede leer), Secure en producción y
// SameSite=Strict, así que el navegador no guarda el token en localStorage ni sessionStorage. Con la cookie, las
// peticiones que modifican datos deben traer la cabecera X-Cliente-Id (protección CSRF adicional).
// El encabezado Authorization: Bearer sigue sirviendo para integraciones y pruebas.
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

export const COOKIE_SESION = 'tls_sesion';
const opcionesCookie = () => ({ httpOnly: true, secure: env.nodeEnv === 'production', sameSite: 'strict', path: '/api' });
// Entrega el token en la cookie de sesión (dura lo mismo que el token)
export function ponerSesion(res, token) {
  const exp = jwt.decode(token)?.exp;
  res.cookie(COOKIE_SESION, token, { ...opcionesCookie(), ...(exp ? { maxAge: Math.max(0, exp * 1000 - Date.now()) } : {}) });
  return token;
}
export const quitarSesion = (res) => res.clearCookie(COOKIE_SESION, opcionesCookie());
function cookieSesion(req) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE_SESION) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

export async function autenticar(req, _res, next) {
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const token = bearer || cookieSesion(req);
  if (!token) throw new ErrorHttp(401, 'Debe iniciar sesión');
  // CSRF: con la cookie, lo que modifica datos debe venir de la propia interfaz (cabecera que otro sitio no puede poner)
  if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.get('X-Cliente-Id')) throw new ErrorHttp(403, 'Petición no permitida');
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
