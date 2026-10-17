// Envío de documentos por correo cuando el RNDC acepta remesa y manifiesto.
//
// - Cada cliente define sus destinatarios, copias y qué documentos recibe:
//   «manifiesto» (PDF adjunto) y «salida» (carta de autorización de salida).
// - La cuenta SMTP es de la empresa; la contraseña se guarda cifrada.
// - Cada envío queda en EnvioCorreo con su estado, destinatarios, intentos y error,
//   y se puede reintentar. Una falla de conexión se reintenta sola una vez.
import nodemailer from 'nodemailer';
import { Empresa, Viaje, Cliente, EnvioCorreo, pob } from '../models/index.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from './reportes/manifiesto.js';
import { aplicarPlantilla, saludo } from './whatsapp.js';
import { descifrar } from '../utils/cifrado.js';
import { txt } from '../utils/texto.js';

const REINTENTO_AUTOMATICO_MS = 60 * 1000;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Formato de la carta de salida (modelo enviado por Cooespatrans a Corbeta). Editable por cliente.
export const SALIDA_BASE = Object.freeze({
  asunto: 'Autorización de salida {placa} - {cliente}',
  cuerpo: [
    '{saludo},', '', 'Señores:', '{cliente_mayus}', '', 'Fecha: {fecha_larga}', '',
    'Por medio del presente, la {empresa} solicita autorización para la salida del siguiente vehículo:', '',
    '  - Placa:      {placa}', '  - Conductor:  {conductor_corto}', '  - Destino:    {destino}', '',
    'El vehículo realizará la salida de {cliente} hasta Parqueadero Privado y mañana continuará con destino a {destino}; bajo la responsabilidad de {empresa_mayus}.', '',
    'Agradecemos su atención y quedamos atentos a cualquier novedad.', '', 'Cordialmente,', '{empresa_mayus}',
  ].join('\n'),
});
export const MARCADORES_SALIDA = {
  saludo: 'Buenos días / tardes / noches', cliente: 'Nombre del cliente', cliente_mayus: 'Cliente en mayúsculas',
  fecha_larga: 'Fecha del viaje (16 de octubre de 2026)', empresa: 'Nombre de la empresa', empresa_mayus: 'Empresa en mayúsculas',
  placa: 'Placa', remolque: 'Remolque', conductor: 'Nombre completo del conductor', conductor_corto: 'Nombre y primer apellido',
  cedula: 'Cédula del conductor', destino: 'Destino', manifiesto: 'N.° de manifiesto', remesa: 'N.° de remesa', radicado: 'Radicado del manifiesto',
};

// Buzón en memoria para pruebas (CORREO_TRANSPORTE=memoria): no sale nada a internet.
export const buzonPruebas = [];

const titulo = (s) => txt(s).toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
const fechaLarga = (d) => { const f = new Date(d); return `${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`; };
const escaparHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nombre = (t) => [t?.nombres, t?.apellido1, t?.apellido2].filter(Boolean).join(' ');

export function datosCorreo(empresa, v) {
  const c = v.conductor || {};
  return {
    saludo: saludo(), cliente: txt(v.cliente?.nombre), cliente_mayus: txt(v.cliente?.nombre).toUpperCase(),
    fecha_larga: fechaLarga(v.fecha), empresa: txt(empresa.nombre), empresa_mayus: txt(empresa.nombre).toUpperCase(),
    placa: txt(v.placa), remolque: txt(v.remolque), conductor: titulo(nombre(c) || v.conductorNombre),
    conductor_corto: titulo([txt(c.nombres).split(/\s+/)[0], c.apellido1].filter(Boolean).join(' ') || v.conductorNombre),
    cedula: txt(c.numId), destino: txt(v.destino), manifiesto: txt(v.manifiesto?.numero), remesa: txt(v.remesa?.numero),
    radicado: txt(v.manifiesto?.radicado),
  };
}

export function cartaSalida(plantilla, datos) {
  const p = { ...SALIDA_BASE, ...Object.fromEntries(Object.entries(plantilla || {}).filter(([, x]) => txt(x))) };
  return { asunto: aplicarPlantilla(p.asunto, datos).replace(/\n/g, ' '), texto: aplicarPlantilla(p.cuerpo, datos) };
}

function transporte(smtp) {
  if (process.env.CORREO_TRANSPORTE === 'memoria') {
    return { sendMail: async (m) => { buzonPruebas.push(m); return { messageId: `<prueba-${buzonPruebas.length}@local>`, response: '250 OK (memoria)' }; } };
  }
  return nodemailer.createTransport({
    host: smtp.host, port: smtp.puerto, secure: smtp.seguridad === 'tls', requireTLS: smtp.seguridad === 'starttls',
    auth: smtp.usuario ? { user: smtp.usuario, pass: descifrar(smtp.claveCifrada) } : undefined,
    tls: { minVersion: 'TLSv1.2' }, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}

async function cuentaCorreo(empresaId) {
  const e = await Empresa.findById(empresaId).select('+smtp.claveCifrada').lean();
  const s = e?.smtp || {};
  if (!s.activo || !s.host || !s.remitenteCorreo) {
    const err = new Error('La cuenta de correo de la empresa no está configurada o está desactivada (Configuración → Correo)');
    err.sinCuenta = true;
    throw err;
  }
  return { empresa: e, smtp: s };
}

export async function enviarPrueba(empresaId, para) {
  const { empresa, smtp } = await cuentaCorreo(empresaId);
  const r = await transporte(smtp).sendMail({
    from: { name: smtp.remitenteNombre || empresa.nombre, address: smtp.remitenteCorreo }, to: para, replyTo: smtp.responderA || undefined,
    subject: `Prueba de correo - ${empresa.nombre}`,
    text: `Este es un correo de prueba de Translogística del Sur.\nLa cuenta ${smtp.remitenteCorreo} quedó lista para enviar documentos.`,
  });
  return { ok: true, idMensaje: r.messageId || '' };
}

async function mensaje(empresa, smtp, envio) {
  const d = await datosManifiesto(empresa, envio.viaje);
  const v = await Viaje.findOne({ empresa: empresa._id, _id: envio.viaje })
    .populate([pob(empresa._id, 'cliente'), pob(empresa._id, 'conductor', 'nombres apellido1 apellido2 numId')]).lean();
  const datos = datosCorreo(empresa, v);
  const base = { from: { name: smtp.remitenteNombre || empresa.nombre, address: smtp.remitenteCorreo }, to: envio.destinatarios,
    cc: envio.cc.length ? envio.cc : undefined, replyTo: smtp.responderA || undefined };
  if (envio.tipo === 'salida') {
    const c = cartaSalida(v.cliente?.envios?.salida, datos);
    return { ...base, subject: c.asunto, text: c.texto,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-line">${escaparHtml(c.texto)}</div>` };
  }
  const texto = [`${datos.saludo},`, '',
    `Adjuntamos el manifiesto de carga N.° ${datos.manifiesto}${datos.radicado ? ` (radicado RNDC ${datos.radicado})` : ''} y la remesa ${datos.remesa}.`, '',
    `  - Placa:      ${datos.placa}${datos.remolque ? ` / remolque ${datos.remolque}` : ''}`, `  - Conductor:  ${datos.conductor} (C.C. ${datos.cedula})`,
    `  - Destino:    ${datos.destino}`, `  - Fecha:      ${datos.fecha_larga}`, '', 'Cordialmente,', datos.empresa_mayus].join('\n');
  return { ...base, subject: `Manifiesto ${datos.manifiesto} - ${datos.placa} - ${datos.cliente}`, text: texto,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-line">${escaparHtml(texto)}</div>`,
    attachments: [{ filename: nombreArchivo(d), content: await manifiestoPdf(d), contentType: 'application/pdf' }] };
}

const esConexion = (e) => ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'EDNS'].includes(e?.code);

// Envía un registro de EnvioCorreo (bloqueándolo para que no se mande dos veces a la vez).
export async function procesarEnvio(empresaId, envioId, { automatico = false } = {}) {
  const envio = await EnvioCorreo.findOneAndUpdate({ empresa: empresaId, _id: envioId, estado: { $in: ['pendiente', 'error'] } },
    { $set: { estado: 'enviando' }, $inc: { intentos: 1 } }, { new: true }).lean();
  if (!envio) return null;
  try {
    const { empresa, smtp } = await cuentaCorreo(empresaId);
    const m = await mensaje(empresa, smtp, envio);
    const r = await transporte(smtp).sendMail(m);
    const set = { estado: 'enviado', error: '', idMensaje: r.messageId || '', respuesta: txt(r.response).slice(0, 300), enviadoEn: new Date(), asunto: m.subject };
    await EnvioCorreo.updateOne({ empresa: empresaId, _id: envioId }, { $set: set });
    return { ...envio, ...set };
  } catch (e) {
    const error = e.sinCuenta ? e.message : `${e.code ? `${e.code}: ` : ''}${e.message}`.slice(0, 500);
    await EnvioCorreo.updateOne({ empresa: empresaId, _id: envioId }, { $set: { estado: 'error', error } });
    if (automatico && esConexion(e) && envio.intentos < 2) {
      setTimeout(() => procesarEnvio(empresaId, envioId).catch(() => {}), REINTENTO_AUTOMATICO_MS).unref?.();
    }
    return { ...envio, estado: 'error', error };
  }
}

// Crea los envíos de un viaje según la configuración del cliente y los procesa.
// Solo cuando el RNDC aceptó remesa y manifiesto.
export async function programarEnvios(empresaId, viajeId, { origen = 'automatico', usuario = null, tipos } = {}) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('cliente remesa manifiesto estado').lean();
  if (!v || v.remesa?.estado !== 'aceptado' || v.manifiesto?.estado !== 'aceptado') {
    const e = new Error('Solo se envía cuando el RNDC aceptó la remesa y el manifiesto'); e.status = 409; throw e;
  }
  const cliente = await Cliente.findOne({ empresa: empresaId, _id: v.cliente }).lean();
  const cfg = cliente?.envios;
  if (!cfg?.activo || !cfg.destinatarios?.length) return [];
  const documentos = (tipos || ['manifiesto', 'salida']).filter(t => cfg.documentos?.[t]);
  const creados = [];
  for (const tipo of documentos) {
    const envio = await EnvioCorreo.create({ empresa: empresaId, viaje: viajeId, cliente: cliente._id, tipo, documento: v.manifiesto.numero,
      destinatarios: cfg.destinatarios, cc: cfg.cc || [], origen, usuario });
    creados.push(await procesarEnvio(empresaId, envio._id, { automatico: origen === 'automatico' }));
  }
  return creados;
}
