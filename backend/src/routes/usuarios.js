// Usuarios de la empresa (los gestiona su Administrador).
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Usuario } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P, ROLES, ROLES_EMPRESA, ROLES_ASIGNABLES } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { claveSegura } from './auth.js';

const r = Router();
r.use(autenticar, soloEmpresa, permitir(P.USUARIOS_GESTIONAR));

const rol = z.enum(ROLES_ASIGNABLES);
const SOLO_UN_ADMIN = 'Cada empresa tiene un único Administrador; los demás usuarios llevan otro rol';
const campos = 'nombre email rol activo ultimoAcceso bloqueadoHasta createdAt';

r.get('/roles', (_req, res) => {
  res.json(ROLES_EMPRESA.map(k => ({ clave: k, nombre: ROLES[k], asignable: ROLES_ASIGNABLES.includes(k) })));
});

r.get('/', async (req, res) => {
  res.json(await Usuario.find(deEmpresa(req)).select(campos).sort({ nombre: 1 }).lean());
});

r.post('/', async (req, res) => {
  const d = z.object({ nombre: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email(), rol: z.string(), password: claveSegura }).parse(req.body);
  if (d.rol === 'admin') throw new ErrorHttp(409, SOLO_UN_ADMIN);
  rol.parse(d.rol);
  if (await Usuario.exists({ email: d.email })) throw new ErrorHttp(409, 'Ya existe un usuario con ese correo');
  const u = await Usuario.create({ nombre: d.nombre, email: d.email, rol: d.rol, empresa: req.empresaId,
    passwordHash: await bcrypt.hash(d.password, 12), debeCambiarClave: true });
  await auditar(req, 'crear_usuario', { entidad: 'Usuario', entidadId: u._id, detalle: { email: u.email, rol: u.rol } });
  res.status(201).json(await Usuario.findById(u._id).select(campos).lean());
});

r.put('/:id', async (req, res) => {
  const d = z.object({ nombre: z.string().trim().min(2).max(120).optional(), rol: z.enum(ROLES_EMPRESA).optional(), activo: z.boolean().optional(),
    password: claveSegura.optional() }).parse(req.body);
  const u = await Usuario.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!u) throw new ErrorHttp(404, 'Usuario no encontrado');
  const propio = String(u._id) === String(req.usuario._id);
  if (d.rol === u.rol) delete d.rol;
  if (d.rol === 'admin') throw new ErrorHttp(409, SOLO_UN_ADMIN);
  if (propio && (d.activo === false || (d.rol && d.rol !== u.rol))) {
    throw new ErrorHttp(400, 'No puede desactivarse ni cambiar su propio rol');
  }
  if (d.nombre) u.nombre = d.nombre;
  if (d.rol) { u.rol = d.rol; u.tokenVersion += 1; }
  if (d.activo !== undefined) { u.activo = d.activo; u.tokenVersion += 1; }
  if (d.password) {
    u.passwordHash = await bcrypt.hash(d.password, 12);
    u.debeCambiarClave = true; u.tokenVersion += 1; u.bloqueadoHasta = null; u.intentosFallidos = 0;
  }
  await u.save();
  await auditar(req, 'editar_usuario', { entidad: 'Usuario', entidadId: u._id,
    detalle: { rol: d.rol, activo: d.activo, claveRestablecida: !!d.password } });
  res.json(await Usuario.findById(u._id).select(campos).lean());
});

export default r;
