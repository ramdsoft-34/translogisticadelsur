// Fase 15: soportes de anticipos (pestaña «Soportes de anticipos» en Viajes y enlace del mensajero /a/<token>).
import crypto from 'node:crypto';
import { Empresa, Viaje, pob } from '../models/index.js';
import { EnlaceMensajero, SoporteAnticipo } from '../models/anticipos.js';
import { ErrorHttp } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { fmtFecha, fmtPesos, hoyColombia, parseFecha, soloDigitos, txt } from '../utils/texto.js';
import { nombreCorto } from './whatsapp.js';
import * as WA from './whatsappMeta.js';

export const INTENTOS_MAX = 5;
export const IMAGEN_MAX = 900_000;           // caracteres del data URL (≈ 650 KB); la página la reduce antes de subirla
const RE_TOKEN = /^[A-Za-z0-9_-]{12,32}$/;
const RE_IMAGEN = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

export const enlaceMensajero = (token) => `${env.urlPublica}/a/${token}`;
export const nombreDe = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') || txt(t.razonSocial) : '');

// Celular colombiano en el formato de WhatsApp (57 + 10 dígitos); '' si no es válido
export function celularWhatsapp(numero) {
  const d = soloDigitos(numero);
  if (/^3\d{9}$/.test(d)) return `57${d}`;
  if (/^573\d{9}$/.test(d)) return d;
  return '';
}
export const ocultarCuenta = (c) => { const d = String(c || '').replace(/\s/g, ''); return d.length > 4 ? `****${d.slice(-4)}` : d; };

export function imagenValida(img, { requerida = true } = {}) {
  if (!img) return !requerida;
  return typeof img === 'string' && img.length <= IMAGEN_MAX && RE_IMAGEN.test(img);
}

// Sesión del mensajero: firma del enlace + su cédula (no se guarda; se recalcula en cada petición)
export const sesionDe = (token, documento) => crypto.createHmac('sha256', env.jwtSecret || 'tls').update(`anticipos:${token}:${soloDigitos(documento)}`).digest('base64url');

// Por qué un enlace del mensajero no sirve ('' = vigente)
export function motivoEnlace(e, ahora = new Date()) {
  if (!e) return 'El enlace no existe';
  if (e.anulado) return 'La oficina cerró este enlace';
  if ((e.intentos || 0) >= INTENTOS_MAX) return 'El enlace se bloqueó por intentos con una cédula equivocada. Pida uno nuevo a la oficina';
  if (new Date(e.vence).getTime() < ahora.getTime()) return 'El enlace venció. Pida el de hoy a la oficina';
  return '';
}

// A quién se le paga: al titular (propietario) si tiene cuenta registrada; si no, al conductor
export function datosPago(v) {
  const t = v.titular; const c = v.conductor;
  const banco = (x) => (x?.banco?.cuenta ? { entidad: txt(x.banco.entidad), tipoCuenta: txt(x.banco.tipoCuenta), cuenta: txt(x.banco.cuenta) } : null);
  if (t && String(t._id) !== String(c?._id) && banco(t)) return { a: 'titular', nombre: nombreDe(t), ...banco(t) };
  if (banco(c)) return { a: 'conductor', nombre: nombreDe(c), ...banco(c) };
  return { a: 'conductor', nombre: nombreDe(c), entidad: '', tipoCuenta: '', cuenta: '' };
}

// Valores {{1}}…{{7}} de la plantilla y el mismo texto para compartir a mano
export function datosMensaje(v, empresa, forma) {
  return [
    nombreCorto(v.conductor, v.conductorNombre).split(' ')[0] || 'conductor',
    txt(empresa?.nombre),
    forma === 'efectivo' ? 'le entregó en efectivo' : 'le consignó',
    v.placa,
    [txt(v.cliente?.nombre), txt(v.destino)].filter(Boolean).join(' → '),
    fmtFecha(v.fecha),
    fmtPesos(v.anticipo),
  ];
}
export function textoMensaje(p) {
  return [`Hola ${p[0]} 👋, ${p[1]} ${p[2]} el *anticipo de su viaje*:`, '',
    `🚚 *${p[3]}* · ${p[4]}`, `📅 Fecha de cargue: *${p[5]}*`, `💵 Anticipo: *${p[6]}*`, '', 'Soporte en la imagen. Buen viaje.'].join('\n');
}

const CAMPOS_VIAJE = 'numero fecha cliente destino placa conductor conductorNombre titular anticipo estado soporteAnticipo';
const poblar = (empresa) => [
  pob(empresa, 'cliente', 'nombre'),
  pob(empresa, 'conductor', 'nombres apellido1 apellido2 razonSocial celular banco'),
  pob(empresa, 'titular', 'nombres apellido1 apellido2 razonSocial banco'),
];

function fila(v, s, { publico = false } = {}) {
  const pago = datosPago(v);
  return {
    id: String(v._id), numero: v.numero, fecha: v.fecha, cliente: txt(v.cliente?.nombre), destino: v.destino, placa: v.placa,
    conductor: nombreDe(v.conductor) || v.conductorNombre || '', anticipo: v.anticipo || 0,
    celular: publico ? '' : soloDigitos(v.conductor?.celular), tieneCelular: !!celularWhatsapp(v.conductor?.celular),
    pago: { ...pago, cuenta: pago.cuenta },        // el mensajero necesita la cuenta completa para consignar
    soporte: s ? {
      id: String(s._id), forma: s.forma, subido: s.createdAt, por: s.subidoPor?.nombre || '',
      whatsapp: s.whatsapp?.estado || '', enviado: s.whatsapp?.enviado, entregado: s.whatsapp?.entregado, leido: s.whatsapp?.leido,
      error: s.whatsapp?.error || '', confirmado: s.confirmado?.fecha || null,
    } : null,
  };
}

// Viajes con anticipo de una fecha de cargue (los anulados no)
export async function listaDelDia(empresaId, fecha, opciones = {}) {
  const dia = parseFecha(fecha) || hoyColombia();
  const viajes = await Viaje.find({ empresa: empresaId, fecha: dia, estado: { $ne: 'anulado' }, anticipo: { $gt: 0 } })
    .select(CAMPOS_VIAJE).sort({ numero: -1 }).populate(poblar(empresaId)).lean();
  const soportes = await SoporteAnticipo.find({ empresa: empresaId, viaje: { $in: viajes.map(v => v._id) }, reemplazado: null })
    .select('-imagen -firma').lean();
  const porViaje = new Map(soportes.map(s => [String(s.viaje), s]));
  const filas = viajes.map(v => fila(v, porViaje.get(String(v._id)), opciones));
  const pagados = filas.filter(f => f.soporte);
  return {
    fecha: dia, filas,
    resumen: {
      viajes: filas.length, total: filas.reduce((a, f) => a + f.anticipo, 0),
      pagados: pagados.length, porPagar: filas.length - pagados.length,
      valorPorPagar: filas.filter(f => !f.soporte).reduce((a, f) => a + f.anticipo, 0),
      leidos: pagados.filter(f => f.soporte.whatsapp === 'leido' || f.soporte.confirmado).length,
      sinLeer: pagados.filter(f => !f.soporte.confirmado && f.soporte.whatsapp !== 'leido' && Date.now() - new Date(f.soporte.subido).getTime() > 2 * 3600e3).length,
    },
  };
}

// ── Enlace del mensajero ──
export async function crearEnlace(empresaId, { fecha, nombre, documento, celular }, usuario = null) {
  const dia = parseFecha(fecha) || hoyColombia();
  const doc = soloDigitos(documento);
  if (doc.length < 5) throw new ErrorHttp(400, 'Escriba la cédula del mensajero');
  // Vence al final del día siguiente a la fecha de cargue (hora Colombia)
  const vence = new Date(dia.getTime() + 2 * 864e5 + 5 * 3600e3 - 1000);
  const e = await EnlaceMensajero.create({ empresa: empresaId, token: crypto.randomBytes(12).toString('base64url'), fecha: dia,
    nombre: txt(nombre), documento: doc, celular: soloDigitos(celular), vence, creadoPor: usuario });
  const url = enlaceMensajero(e.token);
  const empresa = await Empresa.findById(empresaId).select('nombre').lean();
  const texto = [`Hola ${txt(nombre).split(' ')[0]} 👋`, `Estos son los anticipos del ${fmtFecha(dia)} de ${txt(empresa?.nombre)}.`,
    'Entre con su cédula, consigne y suba la foto de cada comprobante:', url].join('\n');
  const num = celularWhatsapp(celular);
  return { id: String(e._id), token: e.token, url, vence, texto, whatsapp: num ? `https://wa.me/${num}?text=${encodeURIComponent(texto)}` : '' };
}

export async function enlacesDelDia(empresaId, fecha) {
  const dia = parseFecha(fecha) || hoyColombia();
  const l = await EnlaceMensajero.find({ empresa: empresaId, fecha: dia, anulado: null }).sort({ createdAt: -1 }).lean();
  return l.map(e => ({ id: String(e._id), nombre: e.nombre, documento: `****${e.documento.slice(-4)}`, url: enlaceMensajero(e.token), vence: e.vence,
    ultimoIngreso: e.ultimoIngreso, bloqueado: !!motivoEnlace(e) }));
}

export async function anularEnlace(empresaId, id) {
  await EnlaceMensajero.updateOne({ empresa: empresaId, _id: id }, { $set: { anulado: new Date() } });
}

async function enlacePorToken(token) {
  if (!RE_TOKEN.test(String(token || ''))) return null;
  return EnlaceMensajero.findOne({ empresa: { $exists: true }, token }).lean();
}

export async function verEnlace(token) {
  const e = await enlacePorToken(token);
  const motivo = motivoEnlace(e);
  const empresa = e ? await Empresa.findById(e.empresa).select('nombre').lean() : null;
  return { valido: !motivo, motivo, empresa: txt(empresa?.nombre), fecha: e?.fecha || null, mensajero: e && !motivo ? e.nombre : '' };
}

export async function ingresar(token, documento) {
  const e = await enlacePorToken(token);
  const motivo = motivoEnlace(e);
  if (motivo) throw new ErrorHttp(410, motivo);
  if (soloDigitos(documento) !== e.documento) {
    await EnlaceMensajero.updateOne({ empresa: e.empresa, _id: e._id }, { $inc: { intentos: 1 } });
    const quedan = INTENTOS_MAX - (e.intentos || 0) - 1;
    throw new ErrorHttp(403, quedan > 0 ? `La cédula no coincide. Le quedan ${quedan} intento(s)` : 'La cédula no coincide. El enlace se bloqueó');
  }
  await EnlaceMensajero.updateOne({ empresa: e.empresa, _id: e._id }, { $set: { ultimoIngreso: new Date() } });
  return { sesion: sesionDe(token, e.documento) };
}

// Verifica la sesión del mensajero y devuelve su enlace
export async function enlaceConSesion(token, sesion) {
  const e = await enlacePorToken(token);
  const motivo = motivoEnlace(e);
  if (motivo) throw new ErrorHttp(410, motivo);
  const esperada = Buffer.from(sesionDe(token, e.documento)); const recibida = Buffer.from(String(sesion || ''));
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) throw new ErrorHttp(401, 'Entre de nuevo con su cédula');
  return e;
}

// ── Soporte ──
export async function guardarSoporte(empresaId, viajeId, { forma = 'transferencia', imagen, firma = '' }, por, { fechaEnlace = null } = {}) {
  if (!['transferencia', 'efectivo'].includes(forma)) throw new ErrorHttp(400, 'Forma de pago inválida');
  if (!imagenValida(imagen)) throw new ErrorHttp(400, 'La foto no es válida o es muy grande');
  if (forma === 'efectivo' && !imagenValida(firma)) throw new ErrorHttp(400, 'Falta la firma del conductor');
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select(CAMPOS_VIAJE).populate(poblar(empresaId)).lean();
  if (!v || v.estado === 'anulado') throw new ErrorHttp(404, 'Viaje no encontrado');
  if (fechaEnlace && new Date(v.fecha).getTime() !== new Date(fechaEnlace).getTime()) throw new ErrorHttp(403, 'Ese viaje no es de la fecha de este enlace');
  if (!(v.anticipo > 0)) throw new ErrorHttp(409, 'El viaje no tiene anticipo');
  await SoporteAnticipo.updateMany({ empresa: empresaId, viaje: v._id, reemplazado: null }, { $set: { reemplazado: new Date() } });
  const para = celularWhatsapp(v.conductor?.celular);
  const s = await SoporteAnticipo.create({ empresa: empresaId, viaje: v._id, forma, valor: v.anticipo, imagen, firma: forma === 'efectivo' ? firma : '',
    subidoPor: por, whatsapp: { estado: 'pendiente', para } });
  const empresa = await Empresa.findById(empresaId).select('nombre').lean();
  const parametros = datosMensaje(v, empresa, forma);
  let estado = 'manual'; let error = ''; let idMensaje = '';
  if (para && WA.configurado()) {
    try { idMensaje = await WA.enviarSoporte(para, imagen, parametros); estado = 'enviado'; }
    catch (e) { estado = 'error'; error = String(e.message || e).slice(0, 300); }
  } else if (!para) error = 'El conductor no tiene un celular válido';
  const ahora = new Date();
  await SoporteAnticipo.updateOne({ empresa: empresaId, _id: s._id }, { $set: { 'whatsapp.estado': estado, 'whatsapp.error': error, 'whatsapp.idMensaje': idMensaje,
    ...(estado === 'enviado' ? { 'whatsapp.enviado': ahora } : {}) } });
  await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { soporteAnticipo: { id: s._id, forma, subido: s.createdAt, whatsapp: estado, leido: null, confirmado: null } } });
  return { id: String(s._id), whatsapp: estado, error, texto: textoMensaje(parametros), celular: para };
}

// Cuando se envió a mano (sin la API) o el conductor no tiene confirmación de lectura
export async function confirmarManual(empresaId, viajeId, usuario, nota = '') {
  const s = await SoporteAnticipo.findOneAndUpdate({ empresa: empresaId, viaje: viajeId, reemplazado: null },
    { $set: { confirmado: { fecha: new Date(), usuario, nota: txt(nota).slice(0, 200) } } }, { new: true }).lean();
  if (!s) throw new ErrorHttp(404, 'El viaje no tiene soporte');
  await Viaje.updateOne({ empresa: empresaId, _id: viajeId }, { $set: { 'soporteAnticipo.confirmado': s.confirmado.fecha } });
  return { confirmado: s.confirmado.fecha };
}

export async function imagenSoporte(empresaId, viajeId, cual = 'imagen') {
  const s = await SoporteAnticipo.findOne({ empresa: empresaId, viaje: viajeId, reemplazado: null }).select(cual === 'firma' ? 'firma' : 'imagen').lean();
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(s?.[cual === 'firma' ? 'firma' : 'imagen'] || '');
  if (!m) throw new ErrorHttp(404, 'No hay imagen');
  return { tipo: m[1], datos: Buffer.from(m[2], 'base64') };
}

// Webhook de Meta: enviado → entregado → leído (o error)
export async function aplicarEstados(datos) {
  let n = 0;
  for (const e of WA.estadosDe(datos)) {
    const s = await SoporteAnticipo.findOne({ empresa: { $exists: true }, 'whatsapp.idMensaje': e.id }).select('empresa viaje whatsapp reemplazado').lean();
    if (!s || !WA.avanza(s.whatsapp?.estado, e.estado)) continue;
    const set = { 'whatsapp.estado': e.estado, ...(e.error ? { 'whatsapp.error': e.error } : {}),
      ...(e.estado === 'entregado' ? { 'whatsapp.entregado': e.fecha } : {}), ...(e.estado === 'leido' ? { 'whatsapp.leido': e.fecha } : {}) };
    await SoporteAnticipo.updateOne({ empresa: s.empresa, _id: s._id }, { $set: set });
    if (!s.reemplazado) await Viaje.updateOne({ empresa: s.empresa, _id: s.viaje, 'soporteAnticipo.id': s._id },
      { $set: { 'soporteAnticipo.whatsapp': e.estado, ...(e.estado === 'leido' ? { 'soporteAnticipo.leido': e.fecha } : {}) } });
    n++;
  }
  return n;
}
