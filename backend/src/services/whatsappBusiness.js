// WhatsApp Business (Cloud API de Meta): manifiesto al conductor. Por defecto sale del número de Translogística,
// con el nombre de la empresa en el mensaje; la empresa que quiera registra su propia cuenta y número.
// Igual que los correos: al aceptarse el manifiesto queda «por aprobar» y solo sale con la confirmación de una persona.
import crypto from 'node:crypto';
import { Empresa, EnvioWhatsapp, MensajeWhatsapp, PlataformaWhatsapp, Tercero, Viaje } from '../models/index.js';
import { publicar } from './eventos.js';
import { descifrar } from '../utils/cifrado.js';
import { txt } from '../utils/texto.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from './reportes/manifiesto.js';
import { soporteInterno } from './gestion/soporteInterno.js';
import { resolverConductor } from './gestion/conductorViaje.js';
import { soporteExpedido } from './documentos/expedidos.js';

const urlGraph = () => (process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v23.0').replace(/\/$/, '');
// Meta puede avisar en desorden: el estado nunca retrocede
const ORDEN = { enviado: 1, entregado: 2, leido: 3 };
const ESTADO_META = { sent: 'enviado', delivered: 'entregado', read: 'leido' };

// Celular colombiano en el formato de WhatsApp (57 + 10 dígitos); vacío si no es válido
export function celularWhatsapp(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(d)) return `57${d}`;
  if (/^573\d{9}$/.test(d)) return d;
  return '';
}

export const plataformaLista = (p) => !!(p?.activo && p.phoneNumberId && p.tokenCifrado);
export const cuentaPlataforma = () => PlataformaWhatsapp.findOne({ clave: 'whatsapp' }).select('+tokenCifrado +appSecretCifrado +webhookToken').lean();

// La cuenta con la que sale el mensaje: la propia de la empresa o la de Translogística
async function cuentaWhatsapp(empresaId) {
  const e = await Empresa.findById(empresaId).select('+whatsapp.tokenCifrado').lean();
  const w = e?.whatsapp || {};
  const sinCuenta = (m) => { const err = new Error(m); err.sinCuenta = true; return err; };
  if (!w.activo) throw sinCuenta('WhatsApp está desactivado para esta empresa (Configuración → WhatsApp)');
  if (w.modo === 'propia') {
    if (!w.phoneNumberId || !w.tokenCifrado) throw sinCuenta('Falta la cuenta propia de WhatsApp de la empresa (Configuración → WhatsApp)');
    return { empresa: e, cuenta: w, token: descifrar(w.tokenCifrado), tipo: 'propia' };
  }
  const p = await cuentaPlataforma();
  if (!plataformaLista(p)) throw sinCuenta('La cuenta de WhatsApp de Translogística todavía no está disponible');
  return { empresa: e, cuenta: p, token: descifrar(p.tokenCifrado), tipo: 'plataforma' };
}

async function llamarMeta(ruta, token, opciones = {}) {
  const r = await fetch(`${urlGraph()}/${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${token}`, ...(opciones.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = cuerpo?.error || {};
    throw new Error(`${e.code ? `${e.code}: ` : ''}${e.error_data?.details || e.message || `Meta respondió ${r.status}`}`.slice(0, 500));
  }
  return cuerpo;
}

// Comprueba la cuenta sin enviar ningún mensaje
export const probarCuenta = async (empresaId) => probarDatos(await cuentaWhatsapp(empresaId));
export async function probarPlataforma() {
  const p = await cuentaPlataforma();
  if (!plataformaLista(p)) throw new Error('Active la cuenta e indique el identificador del número y el token');
  return probarDatos({ cuenta: p, token: descifrar(p.tokenCifrado) });
}
// Nombre visible del número: mientras Meta no lo aprueba, los mensajes se aceptan pero no se entregan
const NOMBRE_ESTADO = { APPROVED: 'aprobado', AVAILABLE_WITHOUT_REVIEW: 'aprobado', PENDING_REVIEW: 'en revisión', DECLINED: 'rechazado', EXPIRED: 'vencido', NONE: 'sin nombre' };
async function probarDatos({ cuenta, token }) {
  const r = await llamarMeta(`${cuenta.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,name_status,status`, token);
  // Sin esta suscripción Meta no avisa a la plataforma si el mensaje se entregó, se leyó o falló
  let suscrito = false, avisoSuscripcion = '';
  if (cuenta.wabaId) {
    try { suscrito = !!(await llamarMeta(`${cuenta.wabaId}/subscribed_apps`, token, { method: 'POST' })).success; }
    catch (e) { avisoSuscripcion = `No se pudo suscribir la cuenta a los avisos de entrega: ${e.message}`; }
  } else avisoSuscripcion = 'Falta el identificador de la cuenta (WABA ID): sin él no llegan los avisos de entrega';
  return { ok: true, numero: r.display_phone_number, nombre: r.verified_name, calidad: r.quality_rating,
    estadoNombre: NOMBRE_ESTADO[r.name_status] || (r.name_status ? String(r.name_status).toLowerCase() : ''), estadoNumero: r.status || '', suscrito, avisoSuscripcion };
}

async function subirPdf(cuenta, token, pdf, nombre) {
  const f = new FormData();
  f.append('messaging_product', 'whatsapp');
  f.append('type', 'application/pdf');
  f.append('file', new Blob([pdf], { type: 'application/pdf' }), nombre);
  return (await llamarMeta(`${cuenta.phoneNumberId}/media`, token, { method: 'POST', body: f })).id;
}

// Los valores de una plantilla no admiten saltos de línea ni pueden ir vacíos
const valor = (v) => ({ type: 'text', text: txt(v).replace(/\s+/g, ' ').trim().slice(0, 300) || '-' });

function mensajePlantilla(cuenta, para, mediaId, nombre, d, conductor, empresa) {
  return { messaging_product: 'whatsapp', to: para, type: 'template', template: {
    name: cuenta.plantilla, language: { code: cuenta.idioma },
    components: [
      { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: nombre } }] },
      // Orden de las variables {{1}} a {{8}} de la plantilla aprobada en Meta
      { type: 'body', parameters: [txt(conductor.nombres).split(/\s+/)[0] || d.condNom, empresa.nombre, d.numero, d.placa, d.origen, d.destino, d.remesa, empresa.nombre].map(valor) },
    ] } };
}

// Documento que se le envía al conductor: el manifiesto aceptado por el RNDC o, en los viajes sin RNDC,
// el soporte interno (MC/RC) mientras no esté anulado
function documentoVigente(v) {
  if (v?.manifiesto?.estado === 'aceptado' && v.manifiesto.numero) return { tipo: 'manifiesto', documento: v.manifiesto.numero };
  const s = v?.soporteInterno;
  if (s?.mc && s.estado !== 'anulado') return { tipo: 'soporte', documento: s.mc };
  return null;
}

// Envía un manifiesto (o soporte interno) ya aprobado. Se revisa de nuevo: pudo anularse o cambiar el conductor mientras esperaba.
export async function procesarEnvio(empresaId, envioId) {
  const r = await EnvioWhatsapp.findOneAndUpdate({ empresa: empresaId, _id: envioId, tipo: { $ne: 'bodega' }, estado: { $in: ['pendiente', 'error'] } },
    { $set: { estado: 'enviando', error: '' }, $inc: { intentos: 1 } }, { new: true }).lean();
  if (!r) return null;
  const terminar = async (set) => (await EnvioWhatsapp.findOneAndUpdate({ empresa: empresaId, _id: envioId }, { $set: set }, { new: true }).lean());
  try {
    const v = await Viaje.findOne({ empresa: empresaId, _id: r.viaje }).select('conductor conductorNombre placa manifiesto soporteInterno').lean();
    const doc = documentoVigente(v);
    if (!doc || doc.documento !== r.documento) {
      return await terminar({ estado: 'descartado', error: `${r.tipo === 'soporte' ? 'El soporte interno' : 'El manifiesto'} ya no está vigente: no se envió` });
    }
    const idConductor = await resolverConductor(empresaId, v);
    const conductor = idConductor && await Tercero.findOne({ empresa: empresaId, _id: idConductor }).select('nombres celular whatsappAutorizado').lean();
    if (!conductor) throw new Error(v.conductorNombre ? `No se encontró a «${v.conductorNombre}» en Conductores y terceros: edite el viaje y elija el conductor` : 'El viaje no tiene conductor');
    if (!conductor.whatsappAutorizado) throw new Error('El conductor no ha autorizado recibir mensajes por WhatsApp (Conductores y terceros)');
    const para = celularWhatsapp(conductor.celular);
    if (!para) throw new Error('El conductor no tiene un celular válido de 10 dígitos (Conductores y terceros)');
    const { empresa, cuenta, token, tipo } = await cuentaWhatsapp(empresaId);
    let d, pdf, nombre;
    if (doc.tipo === 'soporte') {
      // Mismos datos de la plantilla (MC como manifiesto y RC como remesa) y el PDF tal como quedó expedido
      d = await soporteInterno(empresa, r.viaje, { asignar: false });
      const s = await soporteExpedido(empresa, r.viaje);
      pdf = s.buffer; nombre = s.nombre;
    } else {
      d = await datosManifiesto(empresa, r.viaje);
      nombre = nombreArchivo(d); pdf = await manifiestoPdf(d);
    }
    const mediaId = await subirPdf(cuenta, token, pdf, nombre);
    const res = await llamarMeta(`${cuenta.phoneNumberId}/messages`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mensajePlantilla(cuenta, para, mediaId, nombre, d, conductor, empresa)) });
    return await terminar({ estado: 'enviado', tipo: doc.tipo, cuenta: tipo, conductor: conductor._id, telefono: para, idMensaje: res.messages?.[0]?.id || '', enviadoEn: new Date(), error: '' });
  } catch (e) {
    return await terminar({ estado: 'error', error: String(e.message).slice(0, 500) });
  }
}

// Al aceptarse el manifiesto (o numerarse el soporte interno) queda por aprobar; un envío manual sale de una vez.
export async function prepararEnvio(empresaId, viajeId, { origen = 'automatico', usuario = null } = {}) {
  const e = await Empresa.findById(empresaId).select('whatsapp.activo whatsapp.modo').lean();
  if (!e?.whatsapp?.activo) {
    if (origen === 'automatico') return null;
    const err = new Error('WhatsApp está desactivado para esta empresa (Configuración → WhatsApp)'); err.status = 400; throw err;
  }
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('conductor conductorNombre placa manifiesto soporteInterno').lean();
  const doc = documentoVigente(v);
  if (!doc) { const err = new Error('Solo se envía el manifiesto aceptado por el RNDC o el soporte interno vigente'); err.status = 409; throw err; }
  const { tipo, documento } = doc;
  // Automático una sola vez por documento: si ya se envió, se descartó o falló, no se vuelve a crear (abrir el soporte no lo repite)
  if (origen === 'automatico' && await EnvioWhatsapp.exists({ empresa: empresaId, viaje: viajeId, documento })) return null;
  if (origen === 'manual') await EnvioWhatsapp.updateMany({ empresa: empresaId, viaje: viajeId, estado: 'por_aprobar' }, { $set: { estado: 'descartado', error: 'Reemplazado por un envío manual' } });
  const envio = await EnvioWhatsapp.create({ empresa: empresaId, viaje: viajeId, conductor: await resolverConductor(empresaId, v), tipo, documento, origen, usuario, cuenta: e.whatsapp.modo || 'plataforma',
    estado: origen === 'automatico' ? 'por_aprobar' : 'pendiente' });
  return origen === 'automatico' ? envio.toObject() : procesarEnvio(empresaId, envio._id);
}

export async function aprobarEnvios(empresaId, viajes, usuario) {
  const lista = await EnvioWhatsapp.find({ empresa: empresaId, viaje: { $in: viajes }, estado: 'por_aprobar' }).select('_id').lean();
  const ids = lista.map(x => x._id);
  await EnvioWhatsapp.updateMany({ empresa: empresaId, _id: { $in: ids } }, { $set: { estado: 'pendiente', aprobadoPor: usuario, aprobadoEn: new Date() } });
  const resultados = [];
  for (const id of ids) {
    const x = await procesarEnvio(empresaId, id);
    if (x) resultados.push({ viaje: x.viaje, estado: x.estado, error: x.error });
  }
  return { aprobados: ids.length, resultados };
}

export async function descartarEnvios(empresaId, viajes, usuario) {
  const r = await EnvioWhatsapp.updateMany({ empresa: empresaId, viaje: { $in: viajes }, estado: 'por_aprobar' },
    { $set: { estado: 'descartado', aprobadoPor: usuario, aprobadoEn: new Date() } });
  return { descartados: r.modifiedCount };
}

// Firma de Meta (X-Hub-Signature-256) sobre el cuerpo exacto recibido
export function firmaValida(cuerpo, firma, secreto) {
  if (!secreto || !firma) return false;
  const esperada = Buffer.from(`sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`);
  const recibida = Buffer.from(String(firma));
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

// Estados que avisa Meta: enviado, entregado, leído o fallido
const estadosDe = (datos) => (datos?.entry || []).flatMap(x => x.changes || []).flatMap(c => c.value?.statuses || []);

async function aplicarEstado(empresaId, s) {
  const envio = await EnvioWhatsapp.findOne({ empresa: empresaId, idMensaje: String(s.id || '') }).select('estado').lean();
  if (!envio) return;
  if (s.status === 'failed') {
    const e = s.errors?.[0] || {};
    await EnvioWhatsapp.updateOne({ empresa: empresaId, _id: envio._id }, { $set: { estado: 'error', error: `${e.code ? `${e.code}: ` : ''}${e.error_data?.details || e.title || 'Meta no pudo entregar el mensaje'}`.slice(0, 500) } });
    return;
  }
  const estado = ESTADO_META[s.status];
  if (!estado || (ORDEN[estado] || 0) <= (ORDEN[envio.estado] || 0)) return;
  const fecha = new Date(Number(s.timestamp) * 1000 || Date.now());
  await EnvioWhatsapp.updateOne({ empresa: empresaId, _id: envio._id }, { $set: { estado, ...(estado === 'entregado' ? { entregadoEn: fecha } : {}), ...(estado === 'leido' ? { leidoEn: fecha } : {}) } });
}

export async function registrarEstados(empresaId, datos) {
  for (const s of estadosDe(datos)) await aplicarEstado(empresaId, s);
  await registrarRecibidos(datos, { empresaId, cuenta: 'propia' });
}

// ── Mensajes que la gente le escribe al número ──
// Se guardan solo para leerlos en «Mensajes de WhatsApp». No se responde nada desde la plataforma.
const recibidosDe = (datos) => (datos?.entry || []).flatMap((x) => x.changes || []).map((c) => c.value || {})
  .flatMap((v) => (v.messages || []).map((m) => ({ m, nombre: (v.contacts || []).find((k) => k.wa_id === m.from)?.profile?.name || '', phoneNumberId: v.metadata?.phone_number_id || '' })));
const TIPOS = { image: 'Imagen', audio: 'Audio', video: 'Video', document: 'Documento', sticker: 'Sticker', location: 'Ubicación', contacts: 'Contacto', reaction: 'Reacción' };
function textoDe(m) {
  if (m.type === 'text') return m.text?.body || '';
  if (m.type === 'button') return m.button?.text || '';
  if (m.type === 'interactive') return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
  if (m.type === 'reaction') return m.reaction?.emoji || '';
  const caption = m[m.type]?.caption || m.document?.filename || '';
  return `[${TIPOS[m.type] || m.type}]${caption ? ` ${caption}` : ''}`;
}

async function conductorDe(empresaId, numero) {
  const diez = String(numero || '').replace(/\D/g, '').slice(-10);
  if (diez.length !== 10) return null;
  const t = await Tercero.findOne({ empresa: empresaId, celular: { $in: [diez, `57${diez}`, `+57${diez}`] } }).select('_id').lean();
  return t?._id || null;
}

/** Guarda los mensajes recibidos. Con empresaId (cuenta propia) o, en el número de Translogística, la del último envío a ese número. */
export async function registrarRecibidos(datos, { empresaId = null, cuenta = 'propia' } = {}) {
  for (const { m, nombre } of recibidosDe(datos)) {
    const de = String(m.from || '').replace(/\D/g, '');
    if (!de) continue;
    let empresa = empresaId;
    if (!empresa) {
      const ultimo = await EnvioWhatsapp.collection.findOne({ telefono: de, cuenta: 'plataforma' }, { sort: { createdAt: -1 }, projection: { empresa: 1 } });
      empresa = ultimo?.empresa;
      if (!empresa) continue;              // nadie de la plataforma le ha escrito a ese número
    }
    if (m.id && await MensajeWhatsapp.exists({ empresa, idMensaje: String(m.id) })) continue;
    const doc = await MensajeWhatsapp.create({ empresa, cuenta, idMensaje: String(m.id || ''), de, nombre: String(nombre).slice(0, 120), tipo: String(m.type || ''),
      texto: textoDe(m).slice(0, 4000), fecha: new Date(Number(m.timestamp) * 1000 || Date.now()), conductor: await conductorDe(empresa, de) }).catch((e) => (e?.code === 11000 ? null : Promise.reject(e)));
    if (!doc) continue;
    if (!empresaId) publicar(empresa, { recurso: 'whatsapp', ruta: '/recibidos', metodo: 'POST' });
  }
}

// Avisos del número de Translogística: la empresa sale del propio envío. Es una búsqueda global,
// por eso va directo a la colección: el identificador lo genera Meta y el aviso viene firmado.
export async function registrarEstadosPlataforma(datos) {
  for (const s of estadosDe(datos)) {
    const x = await EnvioWhatsapp.collection.findOne({ idMensaje: String(s.id || ''), cuenta: 'plataforma' }, { projection: { empresa: 1 } });
    if (x) await aplicarEstado(x.empresa, s);
  }
  await registrarRecibidos(datos, { cuenta: 'plataforma' });
}

// Mensajes que salieron en el mes, por empresa y número (para cobrarlos). Mira todas las empresas: solo SuperAdmin.
export async function consumoDelMes(mes) {
  const desde = new Date(`${mes}-01T05:00:00.000Z`);            // hora de Colombia
  const hasta = new Date(desde); hasta.setUTCMonth(hasta.getUTCMonth() + 1);
  const filas = await EnvioWhatsapp.collection.aggregate([
    { $match: { enviadoEn: { $gte: desde, $lt: hasta } } },
    { $group: { _id: { empresa: '$empresa', cuenta: '$cuenta' }, mensajes: { $sum: 1 } } },
  ]).toArray();
  const empresas = await Empresa.find({ _id: { $in: filas.map(x => x._id.empresa) } }).select('nombre').lean();
  const nombres = new Map(empresas.map(e => [String(e._id), e.nombre]));
  return filas.map(x => ({ empresa: nombres.get(String(x._id.empresa)) || '', cuenta: x._id.cuenta, mensajes: x.mensajes }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, 'es'));
}

/** Envía una plantilla de texto con un botón de enlace cuyo final es variable (cargues de bodega). Devuelve el id del mensaje. */
export async function enviarPlantillaEnlace(empresaId, para, { plantilla, idioma = 'es', cuerpo = [], sufijo = '' }) {
  const { cuenta, token } = await cuentaWhatsapp(empresaId);
  const components = [{ type: 'body', parameters: cuerpo.map(valor) }];
  if (sufijo) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(sufijo) }] });
  const r = await llamarMeta(`${cuenta.phoneNumberId}/messages`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'template', template: { name: plantilla, language: { code: idioma }, components } }) });
  return r.messages?.[0]?.id || '';
}
