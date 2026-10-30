// Administración global (solo SuperAdmin): empresas y sus administradores.
// Son las únicas acciones que no pertenecen a una empresa.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa, Usuario, Auditoria, Viaje } from '../models/index.js';
import { autenticar, permitir, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar, verificarCadena } from '../services/auditoria.js';
import { filtroAuditoria, excelAuditoria } from '../services/reportes/auditoriaExport.js';
import { claveSegura } from './auth.js';
import { soloDigitos } from '../utils/texto.js';

const r = Router();
r.use(autenticar, permitir(P.EMPRESAS_GESTIONAR));

const empresaBase = z.object({
  nombre: z.string().trim().min(2).max(120),
  nit: z.string().trim().transform(soloDigitos).pipe(z.string().min(5, 'NIT inválido').max(10)),
  dv: z.string().trim().max(1).optional().default(''),
  direccion: z.string().trim().max(150).optional().default(''),
  telefono: z.string().trim().max(30).optional().default(''),
  ciudad: z.string().trim().max(80).optional().default(''),
  correo: z.string().trim().toLowerCase().email().or(z.literal('')).optional().default(''),
});
const adminBase = z.object({
  nombre: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: claveSegura,
});
const id = (v) => {
  if (!mongoose.isValidObjectId(v)) throw new ErrorHttp(400, 'Identificador inválido');
  return v;
};

r.get('/empresas', async (_req, res) => {
  const empresas = await Empresa.find().sort({ nombre: 1 }).select('-rndc.extras').lean();
  const usuarios = await Usuario.aggregate([{ $match: { empresa: { $ne: null } } }, { $group: { _id: '$empresa', n: { $sum: 1 } } }]);
  const porEmpresa = new Map(usuarios.map(u => [String(u._id), u.n]));
  res.json(empresas.map(e => ({ ...e, usuarios: porEmpresa.get(String(e._id)) || 0 })));
});

// Crea la empresa y, si se envía, su primer administrador.
r.post('/empresas', async (req, res) => {
  const datos = empresaBase.extend({ administrador: adminBase.optional() }).parse(req.body);
  const { administrador, ...emp } = datos;
  if (administrador && await Usuario.exists({ email: administrador.email })) throw new ErrorHttp(409, 'Ya existe un usuario con ese correo');
  const empresa = await Empresa.create(emp);
  let admin = null;
  if (administrador) {
    admin = await Usuario.create({
      nombre: administrador.nombre, email: administrador.email, rol: 'admin', empresa: empresa._id,
      passwordHash: await bcrypt.hash(administrador.password, 12), debeCambiarClave: true,
    });
  }
  await auditar(req, 'crear_empresa', { empresa: null, entidad: 'Empresa', entidadId: empresa._id,
    detalle: { nombre: empresa.nombre, nit: empresa.nit, administrador: admin?.email } });
  res.status(201).json({ empresa, administrador: admin ? { id: admin._id, email: admin.email } : null });
});

r.put('/empresas/:id', async (req, res) => {
  const datos = empresaBase.partial().extend({ activa: z.boolean().optional() }).parse(req.body);
  const empresa = await Empresa.findByIdAndUpdate(id(req.params.id), { $set: datos }, { new: true, runValidators: true });
  if (!empresa) throw new ErrorHttp(404, 'Empresa no encontrada');
  await auditar(req, datos.activa === false ? 'desactivar_empresa' : 'editar_empresa', { empresa: null, entidad: 'Empresa', entidadId: empresa._id, detalle: datos });
  res.json(empresa);
});

r.get('/empresas/:id/resumen', async (req, res) => {
  const empresa = id(req.params.id);
  const oid = new mongoose.Types.ObjectId(empresa);
  const [usuarios, viajes] = await Promise.all([
    Usuario.countDocuments({ empresa: oid }),
    Viaje.countDocuments({ empresa: oid }),
  ]);
  res.json({ usuarios, viajes });
});

r.get('/empresas/:id/administradores', async (req, res) => {
  const lista = await Usuario.find({ empresa: id(req.params.id), rol: 'admin' })
    .select('nombre email activo ultimoAcceso createdAt totp.activo').sort({ nombre: 1 }).lean();
  res.json(lista);
});

r.post('/empresas/:id/administradores', async (req, res) => {
  const empresa = await Empresa.findById(id(req.params.id)).lean();
  if (!empresa) throw new ErrorHttp(404, 'Empresa no encontrada');
  const datos = adminBase.parse(req.body);
  if (await Usuario.exists({ empresa: empresa._id, rol: 'admin' })) {
    throw new ErrorHttp(409, 'La empresa ya tiene un administrador. Puede editar sus datos o restablecer su clave.');
  }
  if (await Usuario.exists({ email: datos.email })) throw new ErrorHttp(409, 'Ya existe un usuario con ese correo');
  const u = await Usuario.create({ nombre: datos.nombre, email: datos.email, rol: 'admin', empresa: empresa._id,
    passwordHash: await bcrypt.hash(datos.password, 12), debeCambiarClave: true });
  await auditar(req, 'crear_administrador', { empresa: null, entidad: 'Usuario', entidadId: u._id, detalle: { email: u.email, empresa: empresa.nombre } });
  res.status(201).json({ id: u._id, nombre: u.nombre, email: u.email, activo: u.activo });
});

// Edita el nombre o el correo (p. ej. cuando cambia la persona encargada), restablece la clave o activa/desactiva al administrador.
r.put('/administradores/:id', async (req, res) => {
  const datos = z.object({ activo: z.boolean().optional(), password: claveSegura.optional(), nombre: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email().optional(), quitarDobleFactor: z.boolean().optional() }).parse(req.body);
  const u = await Usuario.findOne({ _id: id(req.params.id), rol: 'admin' });
  if (!u) throw new ErrorHttp(404, 'Administrador no encontrado');
  if (datos.nombre) u.nombre = datos.nombre;
  if (datos.email && datos.email !== u.email) {
    if (await Usuario.exists({ email: datos.email })) throw new ErrorHttp(409, 'Ya existe un usuario con ese correo');
    u.email = datos.email; u.tokenVersion += 1;
  }
  if (datos.activo !== undefined) { u.activo = datos.activo; u.tokenVersion += 1; }
  if (datos.password) {
    u.passwordHash = await bcrypt.hash(datos.password, 12);
    u.debeCambiarClave = true; u.tokenVersion += 1; u.bloqueadoHasta = null; u.intentosFallidos = 0;
  }
  // Si perdió el celular: el SuperAdmin quita el doble factor y el administrador lo vuelve a activar
  if (datos.quitarDobleFactor) { u.totp = { activo: false, secreto: '', pendiente: '', ultimoPaso: 0 }; u.tokenVersion += 1; }
  await u.save();
  await auditar(req, 'editar_administrador', { empresa: null, entidad: 'Usuario', entidadId: u._id,
    detalle: { activo: datos.activo, claveRestablecida: !!datos.password, nombre: datos.nombre, email: datos.email, dobleFactorQuitado: !!datos.quitarDobleFactor } });
  res.json({ id: u._id, nombre: u.nombre, email: u.email, activo: u.activo });
});

// El SuperAdmin revisa la auditoría de seguridad de todas las empresas (no sus datos operativos).
function ambito(req) {
  if (req.query.empresa === 'global') return { empresa: null };
  if (req.query.empresa) return { empresa: id(req.query.empresa) };
  return {};
}

r.get('/auditoria', async (req, res) => {
  const lista = await Auditoria.find(filtroAuditoria(req.query, ambito(req))).sort({ createdAt: -1, seq: -1 })
    .limit(Math.min(Number(req.query.limite) || 300, 1000)).populate('empresa', 'nombre').lean();
  res.json(lista);
});

r.get('/auditoria/verificar', async (req, res) => {
  const empresas = req.query.empresa && req.query.empresa !== 'global' ? [id(req.query.empresa)]
    : [null, ...(await Empresa.find().select('_id').lean()).map(e => e._id)];
  const resultados = [];
  for (const e of empresas) resultados.push({ empresa: e, ...(await verificarCadena(e)) });
  await auditar(req, 'verificar_auditoria', { empresa: null, detalle: { cadenas: resultados.length, integras: resultados.filter(x => x.integra).length } });
  res.json(resultados);
});

r.get('/auditoria.xlsx', async (req, res) => {
  const buf = await excelAuditoria({ nombre: 'Translogística del Sur - Administración global', nit: '', dv: '' }, filtroAuditoria(req.query, ambito(req)), 'Auditoría');
  await auditar(req, 'exportar_auditoria', { empresa: null, detalle: { ambito: req.query.empresa || 'todo' } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Auditoria.xlsx"');
  res.send(buf);
});

export default r;
