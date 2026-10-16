import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Usuario, Empresa, Auditoria } from '../models/index.js';
import { env } from '../config/env.js';
import { autenticar, firmarToken, ErrorHttp } from '../middleware/auth.js';
import { ROLES, permisosDe } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';

const r = Router();
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

export const claveSegura = z.string().min(8, 'mínimo 8 caracteres').max(100)
  .regex(/[A-Za-z]/, 'debe tener letras').regex(/\d/, 'debe tener números');

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espere unos minutos.' } });

// Hash de referencia para igualar el tiempo de respuesta cuando el correo no existe.
const HASH_FALSO = bcrypt.hashSync('no-existe-0000', 10);

export async function perfil(usuario) {
  const empresa = usuario.empresa ? await Empresa.findById(usuario.empresa).select('nombre nit dv rndc.ambiente').lean() : null;
  return {
    id: usuario._id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, rolNombre: ROLES[usuario.rol],
    permisos: permisosDe(usuario.rol), debeCambiarClave: !!usuario.debeCambiarClave,
    empresa: empresa ? { id: empresa._id, nombre: empresa.nombre, nit: empresa.nit, dv: empresa.dv, ambienteRndc: empresa.rndc?.ambiente } : null,
  };
}

r.post('/login', limiteLogin, async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(100) }).parse(req.body);
  const u = await Usuario.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, u?.passwordHash || HASH_FALSO);
  const generico = new ErrorHttp(401, 'Correo o contraseña incorrectos');
  // Los intentos fallidos se auditan en la cadena de la empresa del usuario (o global).
  const fallo = (motivo) => auditar(req, 'login_fallido', { empresa: u?.empresa || null, usuario: u?._id || null,
    resultado: 'fallo', detalle: { email, motivo } });
  if (!u || !u.activo) { await fallo(u ? 'usuario inactivo' : 'correo no registrado'); throw generico; }
  if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) {
    await fallo('usuario bloqueado');
    throw new ErrorHttp(423, 'Usuario bloqueado temporalmente por intentos fallidos. Intente más tarde.');
  }
  if (!ok) {
    u.intentosFallidos += 1;
    const bloquea = u.intentosFallidos >= MAX_INTENTOS;
    if (bloquea) {
      u.bloqueadoHasta = new Date(Date.now() + BLOQUEO_MIN * 60000);
      u.intentosFallidos = 0;
    }
    await u.save();
    await fallo(bloquea ? `contraseña incorrecta; bloqueado ${BLOQUEO_MIN} min` : 'contraseña incorrecta');
    throw generico;
  }
  if (u.rol !== 'superadmin') {
    const emp = await Empresa.findById(u.empresa).select('activa').lean();
    if (!emp?.activa) { await fallo('empresa inactiva'); throw new ErrorHttp(403, 'La empresa está inactiva'); }
  }
  u.intentosFallidos = 0;
  u.bloqueadoHasta = null;
  u.ultimoAcceso = new Date();
  await u.save();
  req.usuario = u; req.empresaId = u.empresa;
  await auditar(req, 'login');
  res.json({ token: firmarToken(u), usuario: await perfil(u) });
});

r.get('/yo', autenticar, async (req, res) => {
  res.json(await perfil(req.usuario));
});

r.post('/cambiar-clave', autenticar, async (req, res) => {
  const { actual, nueva } = z.object({ actual: z.string().min(1), nueva: claveSegura }).parse(req.body);
  const u = await Usuario.findById(req.usuario._id).select('+passwordHash');
  if (!(await bcrypt.compare(actual, u.passwordHash))) throw new ErrorHttp(400, 'La contraseña actual no es correcta');
  u.passwordHash = await bcrypt.hash(nueva, 12);
  u.tokenVersion += 1;          // cierra las demás sesiones
  u.debeCambiarClave = false;
  await u.save();
  await auditar(req, 'cambiar_clave');
  res.json({ token: firmarToken(u), usuario: await perfil(u) });
});

// Datos de la cuenta del propio usuario: perfil, empresa, seguridad y su actividad reciente.
r.get('/mi-cuenta', autenticar, async (req, res) => {
  const u = await Usuario.findById(req.usuario._id).select('nombre email rol activo ultimoAcceso createdAt updatedAt intentosFallidos bloqueadoHasta').lean();
  const empresa = u && req.usuario.empresa
    ? await Empresa.findById(req.usuario.empresa).select('nombre nit dv ciudad direccion telefono correo rndc.ambiente rndc.usuario').lean() : null;
  const filtro = { usuario: req.usuario._id, ...(req.usuario.empresa ? { empresa: req.usuario.empresa } : {}) };
  const [actividad, ultimoCambioClave, fallidos30] = await Promise.all([
    Auditoria.find(filtro).sort({ createdAt: -1 }).limit(15).select('accion resultado createdAt ip entidad detalle').lean(),
    Auditoria.findOne({ ...filtro, accion: 'cambiar_clave' }).sort({ createdAt: -1 }).select('createdAt').lean(),
    Auditoria.countDocuments({ ...filtro, accion: 'login_fallido', createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
  ]);
  res.json({
    usuario: { ...u, rolNombre: ROLES[u.rol], permisos: permisosDe(u.rol) },
    empresa: empresa ? { nombre: empresa.nombre, nit: empresa.nit, dv: empresa.dv, ciudad: empresa.ciudad, direccion: empresa.direccion,
      telefono: empresa.telefono, correo: empresa.correo, ambienteRndc: empresa.rndc?.ambiente, usuarioRndc: empresa.rndc?.usuario } : null,
    seguridad: { ultimoCambioClave: ultimoCambioClave?.createdAt || null, intentosFallidos30Dias: fallidos30, sesionExpira: env.jwtExpires },
    actividad: actividad.map(a => ({ accion: a.accion, resultado: a.resultado, fecha: a.createdAt, ip: a.ip, entidad: a.entidad })),
  });
});

// El usuario puede corregir su propio nombre (el correo y el rol los gestiona el administrador).
r.put('/mi-cuenta', autenticar, async (req, res) => {
  const { nombre } = z.object({ nombre: z.string().trim().min(2).max(120) }).parse(req.body);
  await Usuario.updateOne({ _id: req.usuario._id }, { $set: { nombre } });
  await auditar(req, 'editar_mi_cuenta', { entidad: 'Usuario', entidadId: req.usuario._id, detalle: { nombre } });
  res.json(await perfil({ ...req.usuario, nombre }));
});

r.post('/salir', autenticar, async (req, res) => {
  await Usuario.updateOne({ _id: req.usuario._id }, { $inc: { tokenVersion: 1 } });
  await auditar(req, 'logout');
  res.json({ ok: true });
});

export default r;
