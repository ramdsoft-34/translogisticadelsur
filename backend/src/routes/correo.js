// Correo de la empresa: cuenta SMTP, envío de documentos por cliente y trazabilidad.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa, Cliente, EnvioCorreo, Viaje } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { cifrar } from '../utils/cifrado.js';
import { enviarPrueba, programarEnvios, procesarEnvio, enviarPendientes, enviarGrupoCliente, cartaSalida, datosCorreo, SALIDA_BASE, MARCADORES_SALIDA } from '../services/correo.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const gestionar = permitir(P.CONFIG_GESTIONAR);
const operar = permitir(P.RNDC_OPERAR, P.CONFIG_GESTIONAR);
const correo = z.string().trim().toLowerCase().email('correo inválido');
const id = (v) => { if (!mongoose.isValidObjectId(v)) throw new ErrorHttp(400, 'Identificador inválido'); return v; };

// ── Cuenta SMTP ─────────────────────────────────────────────────────────────
r.get('/config', gestionar, async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('+smtp.claveCifrada').lean();
  const { claveCifrada, ...smtp } = e.smtp || {};
  res.json({ ...smtp, tieneClave: !!claveCifrada });
});

r.put('/config', gestionar, async (req, res) => {
  const d = z.object({
    activo: z.boolean(), host: z.string().trim().max(120).regex(/^[a-zA-Z0-9.-]*$/, 'servidor inválido'),
    puerto: z.coerce.number().int().min(1).max(65535), seguridad: z.enum(['starttls', 'tls']),
    usuario: z.string().trim().max(120), clave: z.string().max(200).optional(),
    remitenteNombre: z.string().trim().max(80), remitenteCorreo: correo.or(z.literal('')), responderA: correo.or(z.literal('')).optional().default(''),
    agruparMinutos: z.coerce.number().int().min(0).max(240).optional(),
  }).parse(req.body);
  if (d.activo && (!d.host || !d.remitenteCorreo)) throw new ErrorHttp(400, 'Para activar el envío indique el servidor y el correo remitente');
  const set = Object.fromEntries(Object.entries(d).filter(([k, v]) => k !== 'clave' && v !== undefined).map(([k, v]) => [`smtp.${k}`, v]));
  if (d.clave) set['smtp.claveCifrada'] = cifrar(d.clave);       // vacío = conservar la actual
  await Empresa.updateOne({ _id: req.empresaId }, { $set: set });
  await auditar(req, 'editar_config_correo', { entidad: 'Empresa', entidadId: req.empresaId,
    detalle: { activo: d.activo, host: d.host, puerto: d.puerto, seguridad: d.seguridad, remitente: d.remitenteCorreo, claveCambiada: !!d.clave } });
  res.json({ ok: true });
});

r.post('/config/probar', gestionar, async (req, res) => {
  const { para } = z.object({ para: correo }).parse(req.body);
  try {
    const x = await enviarPrueba(req.empresaId, para);
    await auditar(req, 'probar_correo', { detalle: { para } });
    res.json(x);
  } catch (e) {
    res.json({ ok: false, error: `${e.code ? `${e.code}: ` : ''}${e.message}` });
  }
});

// ── Envío por cliente ───────────────────────────────────────────────────────
r.get('/clientes', gestionar, async (req, res) => {
  const lista = await Cliente.find(deEmpresa(req)).select('nombre activo envios correos').sort({ nombre: 1 }).lean();
  res.json({ clientes: lista, salidaBase: SALIDA_BASE, marcadores: MARCADORES_SALIDA });
});

const enviosSchema = z.object({
  activo: z.boolean(),
  destinatarios: z.array(correo).max(30),
  cc: z.array(correo).max(30).optional().default([]),
  documentos: z.object({ manifiesto: z.boolean(), salida: z.boolean() }),
  salida: z.object({ asunto: z.string().trim().max(200).optional().default(''), cuerpo: z.string().max(3000).optional().default('') }).optional().default({}),
});
r.put('/clientes/:id', gestionar, async (req, res) => {
  const d = enviosSchema.parse(req.body);
  if (d.activo && !d.destinatarios.length) throw new ErrorHttp(400, 'Agregue al menos un destinatario');
  if (d.activo && !d.documentos.manifiesto && !d.documentos.salida) throw new ErrorHttp(400, 'Elija al menos un documento para enviar');
  const c = await Cliente.findOneAndUpdate(deEmpresa(req, { _id: id(req.params.id) }), { $set: { envios: d } }, { new: true }).lean();
  if (!c) throw new ErrorHttp(404, 'Cliente no encontrado');
  await auditar(req, 'editar_envios_cliente', { entidad: 'Cliente', entidadId: c._id,
    detalle: { cliente: c.nombre, activo: d.activo, destinatarios: d.destinatarios, cc: d.cc, documentos: d.documentos } });
  res.json(c);
});

// Vista previa de la carta de salida con el último viaje manifestado del cliente (o datos de ejemplo).
r.post('/clientes/:id/vista-previa', gestionar, async (req, res) => {
  const d = z.object({ asunto: z.string().max(200).optional(), cuerpo: z.string().max(3000).optional() }).parse(req.body);
  const empresa = await Empresa.findById(req.empresaId).lean();
  const cliente = await Cliente.findOne(deEmpresa(req, { _id: id(req.params.id) })).lean();
  if (!cliente) throw new ErrorHttp(404, 'Cliente no encontrado');
  const v = await Viaje.findOne(deEmpresa(req, { cliente: cliente._id, 'manifiesto.estado': 'aceptado' })).sort({ fecha: -1 })
    .populate({ path: 'conductor', select: 'nombres apellido1 apellido2 numId', match: { empresa: req.empresaId } }).lean();
  const ejemplo = { fecha: new Date(), placa: 'ABC123', destino: 'Destino de ejemplo', conductorNombre: 'NOMBRE APELLIDO',
    conductor: { nombres: 'NOMBRE', apellido1: 'APELLIDO', numId: '12345678' }, manifiesto: { numero: 'M1' }, remesa: { numero: 'R1' } };
  res.json({ ...cartaSalida(d, datosCorreo(empresa, { ...(v || ejemplo), cliente })), conViajeReal: !!v });
});

// ── Trazabilidad y reintentos ───────────────────────────────────────────────
r.get('/envios', operar, async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.viaje) f.viaje = id(req.query.viaje);
  if (req.query.viajes) f.viaje = { $in: String(req.query.viajes).split(',').filter(mongoose.isValidObjectId) };
  if (req.query.estado) f.estado = String(req.query.estado);
  const lista = await EnvioCorreo.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limite) || 200, 1000))
    .populate({ path: 'usuario', select: 'nombre' }).lean();
  res.json(lista);
});

r.post('/envios/:id/reintentar', operar, async (req, res) => {
  const e = await EnvioCorreo.findOne(deEmpresa(req, { _id: id(req.params.id) })).lean();
  if (!e) throw new ErrorHttp(404, 'Envío no encontrado');
  if (e.estado === 'enviado') throw new ErrorHttp(409, 'Este correo ya fue enviado; use «Enviar de nuevo» en el viaje');
  if (e.estado === 'enviando') throw new ErrorHttp(409, 'Este correo se está enviando');
  let x;
  if (e.tipo === 'manifiesto' && e.origen === 'automatico') {
    // Se vuelve a enviar el grupo completo (y cualquier otro pendiente del cliente) en un solo correo
    await EnvioCorreo.updateMany(deEmpresa(req, e.grupo ? { grupo: e.grupo, estado: 'error' } : { _id: e._id }), { $set: { estado: 'pendiente' } });
    const g = await enviarGrupoCliente(req.empresaId, e.cliente);
    x = { ...e, estado: g?.estado || 'error', error: g?.error || '', intentos: e.intentos + 1 };
  } else x = await procesarEnvio(req.empresaId, e._id);
  await auditar(req, 'reintentar_correo', { entidad: 'EnvioCorreo', entidadId: e._id, detalle: { tipo: e.tipo, estado: x?.estado, error: x?.error } });
  res.json(x);
});

// Enviar ya los manifiestos pendientes (sin esperar a que se junten más).
r.post('/pendientes/enviar', operar, async (req, res) => {
  const d = z.object({ cliente: z.string().optional() }).parse(req.body);
  const resultados = await enviarPendientes(req.empresaId, { cliente: d.cliente && mongoose.isValidObjectId(d.cliente) ? d.cliente : undefined });
  await auditar(req, 'enviar_pendientes_correo', { detalle: { grupos: resultados.length, manifiestos: resultados.reduce((a, x) => a + x.cantidad, 0) } });
  res.json(resultados);
});

// Envío manual (p. ej. reenviar a un cliente que no lo recibió o recién configurado).
r.post('/viajes/:id/enviar', operar, async (req, res) => {
  const d = z.object({ tipos: z.array(z.enum(['manifiesto', 'salida'])).optional() }).parse(req.body);
  const lista = await programarEnvios(req.empresaId, id(req.params.id), { origen: 'manual', usuario: req.usuario._id, tipos: d.tipos });
  if (!lista.length) throw new ErrorHttp(400, 'El cliente de este viaje no tiene activado el envío por correo o no tiene destinatarios (Configuración → Correo)');
  await auditar(req, 'enviar_correo_manual', { entidad: 'Viaje', entidadId: req.params.id, detalle: { envios: lista.map(x => ({ tipo: x.tipo, estado: x.estado })) } });
  res.json(lista);
});

export default r;
