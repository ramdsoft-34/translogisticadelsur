// WhatsApp Business (Cloud API de Meta): manifiesto al conductor. Por defecto sale del número de Translogística,
// con el nombre de la empresa en el mensaje; la empresa que quiera registra su propia cuenta y número.
// Igual que los correos: al aceptarse el manifiesto queda «por aprobar» y solo sale con la confirmación de una persona.
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { unirPdf } from './reportes/unirPdf.js';
import { Cliente, Empresa, EnvioWhatsapp, MensajeWhatsapp, PlataformaWhatsapp, Tercero, Viaje } from '../models/index.js';
import { publicar } from './eventos.js';
import { descifrar } from '../utils/cifrado.js';
import { txt } from '../utils/texto.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from './reportes/manifiesto.js';
import { soporteInterno } from './gestion/soporteInterno.js';
import { resolverConductor } from './gestion/conductorViaje.js';
import { soporteExpedido } from './documentos/expedidos.js';
import { errorClaro, causaDeCodigo } from './erroresWhatsapp.js';

// Error de un envío con su causa (para explicar y corregir en la ventana de errores)
class ErrorEnvio extends Error { constructor(mensaje, causa) { super(mensaje); this.causa = causa; } }

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
    const err = new Error(errorClaro(e.code, e.error_data?.details || e.message || `Meta respondió ${r.status}`));
    err.codigoMeta = e.code;
    throw err;
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
export async function procesarEnvio(empresaId, envioId, { forzar = false } = {}) {
  // Al cliente se envía por grupos (como el correo)
  if (await EnvioWhatsapp.exists({ empresa: empresaId, _id: envioId, para: 'cliente' })) return reintentarGrupoCliente(empresaId, envioId);
  const r = await EnvioWhatsapp.findOneAndUpdate({ empresa: empresaId, _id: envioId, tipo: { $ne: 'bodega' }, para: { $ne: 'cliente' }, estado: { $in: ['pendiente', 'error'] } },
    { $set: { estado: 'enviando', error: '', causa: '' }, $inc: { intentos: 1 } }, { new: true }).lean();
  if (!r) return null;
  const terminar = async (set) => (await EnvioWhatsapp.findOneAndUpdate({ empresa: empresaId, _id: envioId }, { $set: set }, { new: true }).lean());
  try {
    const v = await Viaje.findOne({ empresa: empresaId, _id: r.viaje }).select('conductor conductorNombre placa manifiesto soporteInterno').lean();
    const doc = documentoVigente(v);
    if (!doc || doc.documento !== r.documento) {
      return await terminar({ estado: 'descartado', causa: 'no_vigente', error: `${r.tipo === 'soporte' ? 'El soporte interno' : 'El manifiesto'} ya no está vigente: no se envió` });
    }
    const idConductor = await resolverConductor(empresaId, v);
    const conductor = idConductor && await Tercero.findOne({ empresa: empresaId, _id: idConductor }).select('nombres celular whatsappAutorizado whatsappFallo').lean();
    if (!conductor) throw new ErrorEnvio(v.conductorNombre ? `No se encontró a «${v.conductorNombre}» en Conductores y terceros: edite el viaje y elija el conductor` : 'El viaje no tiene conductor', 'sin_conductor');
    if (!conductor.whatsappAutorizado) throw new ErrorEnvio('El conductor no ha autorizado recibir mensajes por WhatsApp (Conductores y terceros)', 'sin_autorizacion');
    const para = celularWhatsapp(conductor.celular);
    if (!para) throw new ErrorEnvio('El conductor no tiene un celular válido de 10 dígitos (Conductores y terceros)', 'celular_invalido');
    // Ese mismo celular ya falló por no tener WhatsApp activo: no se vuelve a intentar solo (Meta lo rechazaría igual)
    if (!forzar && conductor.whatsappFallo?.telefono === para) {
      const dia = new Date(conductor.whatsappFallo.en || Date.now()).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
      throw new ErrorEnvio(`WhatsApp ya no pudo entregar a ${para} el ${dia} (sin WhatsApp activo o términos sin aceptar). Confirme el número con el conductor y reintente`, 'no_entregado');
    }
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
    return await terminar({ estado: 'enviado', tipo: doc.tipo, cuenta: tipo, conductor: conductor._id, telefono: para, idMensaje: res.messages?.[0]?.id || '', enviadoEn: new Date(), error: '', causa: '' });
  } catch (e) {
    return await terminar({ estado: 'error', error: String(e.message).slice(0, 500), causa: e.causa || (e.codigoMeta ? causaDeCodigo(e.codigoMeta) : 'meta') });
  }
}

// ── Manifiesto al cliente (números de WhatsApp de Clientes → WhatsApp de manifiestos) ──
// Solo el manifiesto aceptado por el RNDC (el soporte interno no va al cliente) y solo con la plantilla del cliente
// configurada: mientras Meta no la apruebe, el campo queda vacío y no se crea ningún envío al cliente.
export async function plantillaClienteDe(empresaId) {
  const e = await Empresa.findById(empresaId).select('whatsapp.activo whatsapp.modo whatsapp.plantillaCliente').lean();
  if (!e?.whatsapp?.activo) return '';
  if (e.whatsapp.modo === 'propia') return txt(e.whatsapp.plantillaCliente);
  return txt((await PlataformaWhatsapp.findOne({ clave: 'whatsapp' }).select('plantillaCliente').lean())?.plantillaCliente);
}
// Números activos y válidos del cliente (sin repetir)
export function numerosActivos(cliente) {
  const vistos = new Set();
  return (cliente?.whatsappManifiestos || []).filter((n) => n.activo !== false).map((n) => ({ nombre: txt(n.nombre), telefono: celularWhatsapp(n.numero) }))
    .filter((n) => n.telefono && !vistos.has(n.telefono) && vistos.add(n.telefono));
}

// Texto de la lista de manifiestos para la plantilla: «M10063403 (TDM027), M10063404 (SET146)»; si es muy larga, «y N más»
export function listaManifiestos(items, max = 700) {
  const partes = items.map((x) => `${x.numero}${x.placa ? ` (${x.placa})` : ''}`);
  let texto = '';
  for (let i = 0; i < partes.length; i++) {
    const resto = partes.length - i - 1;
    const prueba = texto ? `${texto}, ${partes[i]}` : partes[i];
    if (prueba.length + (resto ? ` y ${resto} más`.length : 0) > max) return `${texto} y ${partes.length - i} más`;
    texto = prueba;
  }
  return texto;
}
export const cantidadManifiestos = (n) => (n === 1 ? '1 manifiesto de carga' : `${n} manifiestos de carga`);

function mensajePlantillaCliente(plantilla, idioma, para, mediaId, nombre, empresa, items) {
  const parametro = (t, max) => ({ type: 'text', text: txt(t).replace(/\s+/g, ' ').trim().slice(0, max) || '-' });
  return { messaging_product: 'whatsapp', to: para, type: 'template', template: {
    name: plantilla, language: { code: idioma },
    components: [
      { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: nombre } }] },
      // {{1}} empresa · {{2}} cuántos («3 manifiestos de carga») · {{3}} números y placas (plantilla «manifiesto_cliente»)
      { type: 'body', parameters: [parametro(empresa.nombre, 100), parametro(cantidadManifiestos(items.length), 40), parametro(listaManifiestos(items), 720)] },
    ] } };
}

/**
 * Como el correo: todos los manifiestos pendientes de un cliente para un mismo número salen en UN mensaje,
 * con un solo PDF que los reúne (WhatsApp admite un documento por mensaje de plantilla). 1 pendiente → 1 manifiesto.
 */
export async function enviarGrupoWhatsappCliente(empresaId, clienteId, telefono) {
  const grupo = new mongoose.Types.ObjectId();
  const base = { empresa: empresaId, para: 'cliente', cliente: clienteId, telefono };
  const r = await EnvioWhatsapp.updateMany({ ...base, estado: 'pendiente' }, { $set: { estado: 'enviando', grupo, error: '', causa: '' }, $inc: { intentos: 1 } });
  if (!r.modifiedCount) return null;
  const envios = await EnvioWhatsapp.find({ empresa: empresaId, grupo }).sort({ documento: 1 }).lean();
  const marcar = (ids, set) => EnvioWhatsapp.updateMany({ empresa: empresaId, _id: { $in: ids } }, { $set: set });
  // Lo que ya no está vigente (anulado o reemplazado) no va en el grupo
  const viajes = new Map((await Viaje.find({ empresa: empresaId, _id: { $in: envios.map((e) => e.viaje) } }).select('manifiesto soporteInterno').lean()).map((v) => [String(v._id), v]));
  const vigentes = []; const vencidos = [];
  for (const e of envios) {
    const doc = documentoVigente(viajes.get(String(e.viaje)));
    (doc?.tipo === 'manifiesto' && doc.documento === e.documento ? vigentes : vencidos).push(e);
  }
  if (vencidos.length) await marcar(vencidos.map((e) => e._id), { estado: 'descartado', causa: 'no_vigente', error: 'El manifiesto ya no está vigente: no se envió' });
  if (!vigentes.length) return { grupo, cantidad: 0, estado: 'descartado' };
  const ids = vigentes.map((e) => e._id);
  try {
    // El número pudo apagarse o quitarse en Clientes mientras esperaba
    const c = await Cliente.findOne({ empresa: empresaId, _id: clienteId }).select('nombre whatsappManifiestos').lean();
    if (!numerosActivos(c).some((n) => n.telefono === telefono)) {
      await marcar(ids, { estado: 'descartado', causa: 'numero_inactivo', error: `El número ${telefono} ya no está activo en el cliente${c ? ` ${c.nombre}` : ''}: no se envió` });
      return { grupo, cantidad: ids.length, estado: 'descartado' };
    }
    const plantilla = await plantillaClienteDe(empresaId);
    if (!plantilla) throw new ErrorEnvio('Falta la plantilla de WhatsApp para clientes (Configuración → WhatsApp)', 'plantilla');
    const { empresa, cuenta, token, tipo } = await cuentaWhatsapp(empresaId);
    const items = []; const pdfs = [];
    for (const e of vigentes) {
      const d = await datosManifiesto(empresa, e.viaje);
      items.push({ numero: d.numero, placa: d.placa });
      pdfs.push(await manifiestoPdf(d));
    }
    const fecha = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    const nombre = vigentes.length === 1 ? `Manifiesto_${items[0].numero}.pdf` : `Manifiestos_${txt(c.nombre).replace(/[^\wÁÉÍÓÚÑáéíóúñ]+/g, '_').slice(0, 40)}_${fecha}.pdf`;
    const pdf = pdfs.length === 1 ? pdfs[0] : await unirPdf(pdfs);
    const mediaId = await subirPdf(cuenta, token, pdf, nombre);
    const res = await llamarMeta(`${cuenta.phoneNumberId}/messages`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mensajePlantillaCliente(plantilla, cuenta.idioma || 'es', telefono, mediaId, nombre, empresa, items)) });
    await marcar(ids, { estado: 'enviado', cuenta: tipo, idMensaje: res.messages?.[0]?.id || '', enviadoEn: new Date(), error: '', causa: '' });
    return { grupo, cantidad: ids.length, estado: 'enviado' };
  } catch (e) {
    const causa = e.causa || (e.codigoMeta ? causaDeCodigo(e.codigoMeta) : 'meta');
    const error = String(e.message).slice(0, 500);
    await marcar(ids, { estado: 'error', error, causa });
    return { grupo, cantidad: ids.length, estado: 'error', error, causa, ids };
  }
}

// Reintento de un envío al cliente (ventana de errores o «Reintentar»): vuelve a salir junto con los demás de su grupo que fallaron
async function reintentarGrupoCliente(empresaId, envioId) {
  const e = await EnvioWhatsapp.findOne({ empresa: empresaId, _id: envioId, para: 'cliente' }).lean();
  if (!e || !['pendiente', 'error'].includes(e.estado)) return null;
  const mismos = e.grupo ? { $or: [{ _id: e._id }, { grupo: e.grupo }] } : { _id: e._id };
  await EnvioWhatsapp.updateMany({ empresa: empresaId, para: 'cliente', estado: { $in: ['pendiente', 'error'] }, ...mismos }, { $set: { estado: 'pendiente' } });
  await enviarGrupoWhatsappCliente(empresaId, e.cliente, e.telefono);
  return EnvioWhatsapp.findOne({ empresa: empresaId, _id: envioId }).lean();
}

/** Crea los envíos del manifiesto a los números activos del cliente del viaje. Automático: una vez por número y documento. */
export async function prepararEnviosCliente(empresaId, viajeId, { origen = 'automatico', usuario = null } = {}) {
  const plantilla = await plantillaClienteDe(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('cliente manifiesto soporteInterno').lean();
  const doc = documentoVigente(v);
  const falla = (m, st = 409) => { const err = new Error(m); err.status = st; throw err; };
  if (!plantilla) { if (origen === 'automatico') return []; falla('El envío del manifiesto al cliente aún no está activo: falta la plantilla de WhatsApp para clientes (Configuración → WhatsApp)', 400); }
  if (doc?.tipo !== 'manifiesto') { if (origen === 'automatico') return []; falla('Al cliente solo se envía el manifiesto aceptado por el RNDC'); }
  const c = v.cliente && await Cliente.findOne({ empresa: empresaId, _id: v.cliente }).select('whatsappManifiestos').lean();
  const numeros = numerosActivos(c);
  if (!numeros.length) { if (origen === 'automatico') return []; falla('Este cliente no tiene números de WhatsApp activos para manifiestos (Clientes → WhatsApp de manifiestos)'); }
  const e = await Empresa.findById(empresaId).select('whatsapp.modo').lean();
  if (origen === 'manual') await EnvioWhatsapp.updateMany({ empresa: empresaId, viaje: viajeId, para: 'cliente', estado: 'por_aprobar' }, { $set: { estado: 'descartado', error: 'Reemplazado por un envío manual' } });
  const creados = [];
  for (const n of numeros) {
    if (origen === 'automatico' && await EnvioWhatsapp.exists({ empresa: empresaId, viaje: viajeId, documento: doc.documento, para: 'cliente', telefono: n.telefono })) continue;
    creados.push(await EnvioWhatsapp.create({ empresa: empresaId, viaje: viajeId, para: 'cliente', cliente: v.cliente, destinatario: n.nombre, telefono: n.telefono,
      tipo: 'manifiesto', documento: doc.documento, origen, usuario, cuenta: e?.whatsapp?.modo || 'plataforma', estado: origen === 'automatico' ? 'por_aprobar' : 'pendiente' }));
  }
  if (origen === 'automatico') return creados.map((x) => x.toObject());
  for (const n of numeros) await enviarGrupoWhatsappCliente(empresaId, v.cliente, n.telefono);
  return EnvioWhatsapp.find({ empresa: empresaId, _id: { $in: creados.map((x) => x._id) } }).lean();
}

// Al aceptarse el manifiesto (o numerarse el soporte interno) queda por aprobar; un envío manual sale de una vez.
// Lo automático también deja por aprobar el manifiesto a los números del cliente; el envío manual es solo al conductor.
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
  if (origen === 'automatico') await prepararEnviosCliente(empresaId, viajeId, { usuario }).catch(() => {});
  const alConductor = { para: { $ne: 'cliente' } };
  // Automático una sola vez por documento: si ya se envió, se descartó o falló, no se vuelve a crear (abrir el soporte no lo repite)
  if (origen === 'automatico' && await EnvioWhatsapp.exists({ empresa: empresaId, viaje: viajeId, documento, ...alConductor })) return null;
  if (origen === 'manual') await EnvioWhatsapp.updateMany({ empresa: empresaId, viaje: viajeId, estado: 'por_aprobar', ...alConductor }, { $set: { estado: 'descartado', error: 'Reemplazado por un envío manual' } });
  const envio = await EnvioWhatsapp.create({ empresa: empresaId, viaje: viajeId, conductor: await resolverConductor(empresaId, v), tipo, documento, origen, usuario, cuenta: e.whatsapp.modo || 'plataforma',
    estado: origen === 'automatico' ? 'por_aprobar' : 'pendiente' });
  return origen === 'automatico' ? envio.toObject() : procesarEnvio(empresaId, envio._id);
}

// Aprobación: cada conductor recibe su documento; cada número del cliente recibe UN mensaje con todos sus manifiestos
export async function aprobarEnvios(empresaId, viajes, usuario) {
  const lista = await EnvioWhatsapp.find({ empresa: empresaId, viaje: { $in: viajes }, estado: 'por_aprobar' }).select('_id para cliente telefono').lean();
  const ids = lista.map(x => x._id);
  await EnvioWhatsapp.updateMany({ empresa: empresaId, _id: { $in: ids } }, { $set: { estado: 'pendiente', aprobadoPor: usuario, aprobadoEn: new Date() } });
  const resultados = [];
  for (const x of lista.filter((e) => e.para !== 'cliente')) {
    const r = await procesarEnvio(empresaId, x._id);
    if (r) resultados.push({ id: r._id, viaje: r.viaje, para: 'conductor', estado: r.estado, error: r.error, causa: r.causa });
  }
  const grupos = new Map();
  for (const x of lista.filter((e) => e.para === 'cliente')) grupos.set(`${x.cliente}|${x.telefono}`, x);
  for (const x of grupos.values()) {
    const g = await enviarGrupoWhatsappCliente(empresaId, x.cliente, x.telefono);
    if (!g) continue;
    // El error del grupo se muestra una sola vez (un envío representa al grupo)
    const uno = await EnvioWhatsapp.findOne({ empresa: empresaId, grupo: g.grupo, ...(g.estado === 'error' ? { estado: 'error' } : {}) }).select('_id viaje estado error causa').lean();
    resultados.push({ id: uno?._id, viaje: uno?.viaje, para: 'cliente', cantidad: g.cantidad, estado: g.estado, error: g.error || '', causa: g.causa || '' });
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
  const envio = await EnvioWhatsapp.findOne({ empresa: empresaId, idMensaje: String(s.id || '') }).select('estado conductor telefono').lean();
  if (!envio) return;
  // Un mensaje al cliente lleva varios manifiestos: el estado aplica a todos los envíos de ese mensaje
  const delMensaje = { empresa: empresaId, idMensaje: String(s.id) };
  if (s.status === 'failed') {
    const e = s.errors?.[0] || {};
    const causa = causaDeCodigo(e.code);
    await EnvioWhatsapp.updateMany(delMensaje, { $set: { estado: 'error', causa, error: errorClaro(e.code, e.error_data?.details || e.title || e.message || '') } });
    if (causa === 'no_entregado' && envio.conductor && envio.telefono) {
      await Tercero.updateOne({ empresa: empresaId, _id: envio.conductor }, { $set: { whatsappFallo: { telefono: envio.telefono, codigo: Number(e.code) || 0, en: new Date() } } });
    }
    return;
  }
  if (['delivered', 'read'].includes(s.status) && envio.conductor && envio.telefono) {
    await Tercero.updateOne({ empresa: empresaId, _id: envio.conductor, 'whatsappFallo.telefono': envio.telefono }, { $unset: { whatsappFallo: 1 } });
  }
  const estado = ESTADO_META[s.status];
  if (!estado || (ORDEN[estado] || 0) <= (ORDEN[envio.estado] || 0)) return;
  const fecha = new Date(Number(s.timestamp) * 1000 || Date.now());
  await EnvioWhatsapp.updateMany(delMensaje, { $set: { estado, ...(estado === 'entregado' ? { entregadoEn: fecha } : {}), ...(estado === 'leido' ? { leidoEn: fecha } : {}) } });
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
