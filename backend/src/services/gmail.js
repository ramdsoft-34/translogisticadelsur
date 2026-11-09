// Fase 14: Gmail de cada usuario dentro de la plataforma (leer, buscar, responder y enviar con los documentos
// de los viajes). Conexión con OAuth 2.0 de Google y la API oficial de Gmail, sin librerías extra (fetch).
//
// - La contraseña de Gmail nunca pasa por la plataforma: el usuario autoriza en la pantalla de Google.
// - Se guarda solo el refresh token, cifrado (utils/cifrado.js). El token de acceso vive en memoria ~1 hora.
// - Cada usuario conecta su propio buzón y solo él lo ve; desconectar revoca el permiso en Google.
// - Permiso pedido: gmail.modify (leer, marcar leído y enviar; no borra correos definitivamente).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { CuentaGmail, ReglaCorreo } from '../models/gmail.js';
import { Viaje, Cliente } from '../models/index.js';
import { cifrar, descifrar } from '../utils/cifrado.js';
import { ErrorHttp } from '../middleware/auth.js';

export const ALCANCES = ['https://www.googleapis.com/auth/gmail.modify'];
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function configurado() { return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
export const urlRetorno = () => process.env.GOOGLE_REDIRECT_URI || `${env.urlPublica}/api/gmail/oauth/callback`;
function exigirConfig() { if (!configurado()) throw new ErrorHttp(503, 'La conexión con Gmail no está configurada en el servidor (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)'); }

// ── OAuth ──
/** El estado firmado evita que otro sitio complete la conexión a nombre del usuario (CSRF). Vale 10 minutos. */
export function firmarEstado(usuarioId, empresaId) {
  return jwt.sign({ u: String(usuarioId), e: String(empresaId), n: crypto.randomBytes(8).toString('hex') }, env.jwtSecret, { algorithm: 'HS256', expiresIn: '10m', audience: 'gmail-oauth' });
}
export function leerEstado(estado) {
  try { return jwt.verify(String(estado || ''), env.jwtSecret, { algorithms: ['HS256'], audience: 'gmail-oauth' }); }
  catch { throw new ErrorHttp(400, 'La autorización de Google venció o no es válida. Vuelva a conectar.'); }
}

export function urlAutorizacion(usuarioId, empresaId, correoSugerido = '') {
  exigirConfig();
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: urlRetorno(), response_type: 'code', scope: ALCANCES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: firmarEstado(usuarioId, empresaId),
    ...(correoSugerido ? { login_hint: correoSugerido } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function token(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorHttp(r.status === 400 ? 401 : 502, d.error === 'invalid_grant' ? 'Google retiró el permiso de Gmail: vuelva a conectar la cuenta' : 'No se pudo hablar con Google');
  return d;
}

/** Cambia el código de Google por los tokens y guarda la cuenta del usuario. */
export async function completarConexion(code, estado) {
  exigirConfig();
  const { u, e } = leerEstado(estado);
  const t = await token({ code: String(code || ''), grant_type: 'authorization_code', redirect_uri: urlRetorno() });
  if (!t.refresh_token) throw new ErrorHttp(400, 'Google no entregó el permiso permanente. Quite el acceso de la plataforma en su cuenta de Google y conecte otra vez.');
  const perfil = await fetch(`${API}/profile`, { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
  await CuentaGmail.updateOne({ empresa: e, usuario: u }, { $set: { email: perfil.emailAddress || '', refreshToken: cifrar(t.refresh_token), alcances: String(t.scope || '').split(' '),
    conectadoEn: new Date(), error: '' } }, { upsert: true });
  accesos.delete(u);
  return { usuario: u, email: perfil.emailAddress };
}

const accesos = new Map();   // usuarioId → { token, vence }
async function acceso(cuenta) {
  const k = String(cuenta.usuario); const c = accesos.get(k);
  if (c && c.vence > Date.now() + 60000) return c.token;
  try {
    const t = await token({ refresh_token: descifrar(cuenta.refreshToken), grant_type: 'refresh_token' });
    accesos.set(k, { token: t.access_token, vence: Date.now() + (t.expires_in || 3600) * 1000 });
    return t.access_token;
  } catch (err) {
    if (err.status === 401) await CuentaGmail.updateOne({ _id: cuenta._id, empresa: cuenta.empresa }, { $set: { error: 'permiso_retirado' } });
    throw err;
  }
}

export async function cuentaDe(req) {
  const c = await CuentaGmail.findOne({ empresa: req.empresaId, usuario: req.usuario._id }).select('+refreshToken').lean();
  if (!c) throw new ErrorHttp(409, 'Conecte su Gmail para ver el correo');
  return c;
}

/** Llamada a la API de Gmail con el token del usuario. */
export async function gmail(cuenta, ruta, { metodo = 'GET', cuerpo, crudo = false } = {}) {
  const r = await fetch(`${API}${ruta}`, { method: metodo, headers: { authorization: `Bearer ${await acceso(cuenta)}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (r.status === 404) throw new ErrorHttp(404, 'El correo ya no existe en Gmail');
  if (!r.ok) throw new ErrorHttp(r.status === 429 ? 429 : 502, r.status === 429 ? 'Gmail pide esperar un momento: intente de nuevo' : 'Gmail no respondió');
  return crudo ? r : r.json();
}

export async function desconectar(req) {
  const c = await CuentaGmail.findOne({ empresa: req.empresaId, usuario: req.usuario._id }).select('+refreshToken').lean();
  if (!c) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(descifrar(c.refreshToken))}`, { method: 'POST' }).catch(() => null);
  await CuentaGmail.deleteOne({ _id: c._id, empresa: req.empresaId });
  accesos.delete(String(req.usuario._id));
}

// ── Lectura (reglas puras) ──
export const cabecera = (headers = [], nombre) => headers.find((h) => h.name.toLowerCase() === nombre.toLowerCase())?.value || '';
const b64 = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** «Nombre <correo>» → { nombre, correo } */
export function persona(valor = '') {
  const m = String(valor).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { nombre: m[1].trim() || m[2], correo: m[2].trim().toLowerCase() } : { nombre: String(valor).trim(), correo: String(valor).trim().toLowerCase() };
}

/** Recorre las partes MIME y devuelve el texto, el HTML y los adjuntos. */
export function partes(payload) {
  const out = { texto: '', html: '', adjuntos: [] };
  const ver = (p) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) out.adjuntos.push({ id: p.body.attachmentId, nombre: p.filename, tipo: p.mimeType, tamano: p.body.size || 0 });
    else if (p.mimeType === 'text/plain' && p.body?.data && !out.texto) out.texto = b64(p.body.data).toString('utf8');
    else if (p.mimeType === 'text/html' && p.body?.data && !out.html) out.html = b64(p.body.data).toString('utf8');
    for (const h of p.parts || []) ver(h);
  };
  ver(payload);
  return out;
}

export function resumenMensaje(m) {
  const h = m.payload?.headers || [];
  return { id: m.id, hilo: m.threadId, de: persona(cabecera(h, 'From')), para: cabecera(h, 'To'), cc: cabecera(h, 'Cc'), asunto: cabecera(h, 'Subject') || '(sin asunto)',
    fecha: new Date(Number(m.internalDate || 0)).toISOString(), extracto: m.snippet || '', etiquetas: m.labelIds || [],
    noLeido: (m.labelIds || []).includes('UNREAD'), idMensaje: cabecera(h, 'Message-ID'), referencias: cabecera(h, 'References'),
    conAdjuntos: JSON.stringify(m.payload || {}).includes('"attachmentId"') };
}

// ── Vínculos con la operación ──
// Placas colombianas de carga (ABC123, ABC-123) y manifiestos (M10063289 o 10063289) en el asunto o el extracto
export function detectar(texto = '') {
  const t = String(texto).toUpperCase();
  const placas = [...new Set([...t.matchAll(/\b([A-Z]{3})-?(\d{3})\b/g)].map((m) => m[1] + m[2]))];
  const manifiestos = [...new Set([...t.matchAll(/\bM?(\d{8})\b/g)].map((m) => m[1]))];
  return { placas, manifiestos };
}

// ── Pestañas por cliente ──
const sinTildes = (t = '') => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
// Dominios de correo gratuito: no identifican a una empresa (ana@gmail.com no hace a Gmail cliente)
const PUBLICOS = new Set(['gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'msn.com', 'aol.com', 'protonmail.com']);
const dominio = (correo = '') => String(correo).toLowerCase().split('@')[1] || '';
const correoDe = (x = '') => (String(x).match(/<([^>]+)>/)?.[1] || String(x)).trim().toLowerCase();
// Palabras que nombran al cliente: nombre, razón social sin «S.A.S.» y siglas largas
const LEGALES = /\b(S\.?\s?A\.?\s?S\.?|S\.?\s?A\.?|LTDA\.?|E\.?\s?U\.?|S\.?\s?C\.?\s?A\.?|Y\s+CIA\.?|SOCIEDAD|COMERCIALIZADORA)\b/g;
export function palabrasCliente(c) {
  return [...new Set([c.nombre, c.razonSocial, c.siglas].filter(Boolean).map((s) => sinTildes(s).replace(LEGALES, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 4))];
}

/** Datos para reconocer a cada cliente: palabras, correos y dominios propios, y reglas aprendidas. */
export async function clavesClientes(empresaId) {
  const [clientes, reglas] = await Promise.all([
    Cliente.find({ empresa: empresaId, activo: { $ne: false } }).select('nombre razonSocial siglas correos').lean(),
    ReglaCorreo.find({ empresa: empresaId }).select('remitente cliente').lean(),
  ]);
  return clientes.map((c) => {
    const id = String(c._id);
    const correos = (c.correos || []).map(correoDe).filter((x) => x.includes('@'));
    const propias = reglas.filter((r) => String(r.cliente) === id).map((r) => r.remitente);
    return { id, nombre: c.nombre, palabras: palabrasCliente(c), correos: [...new Set([...correos, ...propias.filter((r) => !r.startsWith('@'))])],
      dominios: [...new Set([...correos.map(dominio), ...propias.filter((r) => r.startsWith('@')).map((r) => r.slice(1))].filter((d) => d && !PUBLICOS.has(d)))] };
  });
}

/** Cliente de un correo por quién lo envía o recibe (lo más seguro), luego por el nombre en el texto. */
export function clienteDe(claves, { correos = [], texto = '' }) {
  const cs = correos.map(correoDe);
  const porCorreo = claves.find((c) => cs.some((x) => c.correos.includes(x))) || claves.find((c) => cs.some((x) => c.dominios.includes(dominio(x))));
  if (porCorreo) return porCorreo.id;
  const t = ` ${sinTildes(texto).replace(/[^A-Z0-9]/g, ' ')} `;
  return claves.find((c) => c.palabras.some((w) => t.includes(` ${w} `)))?.id || null;
}

/** Búsqueda de Gmail que trae todo lo de un cliente: lo que envía o se le envía, lo que lo nombra y lo de sus placas recientes. */
export function consultaCliente(clave, placas = []) {
  const partes = [
    ...clave.correos.flatMap((x) => [`from:${x}`, `to:${x}`]), ...clave.dominios.flatMap((d) => [`from:${d}`, `to:${d}`]),
    ...clave.palabras.map((w) => `"${w.toLowerCase()}"`), ...placas.slice(0, 15),
  ];
  return partes.length ? `{${partes.join(' ')}}` : `"${clave.nombre.replace(/"/g, '')}"`;
}

/** Id de la etiqueta «Clientes/Nombre» en el Gmail del usuario; la crea si no existe (con caché por cuenta). */
const cacheEtiquetas = new Map();   // usuarioId → Map(nombre en minúsculas → id)
export const nombreEtiqueta = (cliente) => `Clientes/${String(cliente).replace(/\//g, '-').trim()}`.slice(0, 200);
export async function etiquetaCliente(cuenta, cliente) {
  const k = String(cuenta.usuario); const nombre = nombreEtiqueta(cliente);
  let m = cacheEtiquetas.get(k);
  if (!m) { const { labels = [] } = await gmail(cuenta, '/labels'); m = new Map(labels.map((l) => [l.name.toLowerCase(), l.id])); cacheEtiquetas.set(k, m); }
  if (!m.has(nombre.toLowerCase())) {
    const nueva = await gmail(cuenta, '/labels', { metodo: 'POST', cuerpo: { name: nombre, labelListVisibility: 'labelShow', messageListVisibility: 'show' } })
      .catch(async () => { cacheEtiquetas.delete(k); const { labels = [] } = await gmail(cuenta, '/labels'); return labels.find((l) => l.name.toLowerCase() === nombre.toLowerCase()); });
    if (!nueva?.id) throw new ErrorHttp(502, 'Gmail no dejó crear la etiqueta del cliente');
    m.set(nombre.toLowerCase(), nueva.id);
  }
  return m.get(nombre.toLowerCase());
}

/** Pone en Gmail la etiqueta del cliente a las conversaciones reconocidas que aún no la tienen (en segundo plano). */
export async function etiquetarHilos(cuenta, hilos, nombres) {
  for (const h of hilos.filter((x) => x.cliente && nombres.get(x.cliente))) {
    const id = await etiquetaCliente(cuenta, nombres.get(h.cliente));
    if (!(h.etiquetas || []).includes(id)) await gmail(cuenta, `/threads/${h.id}/modify`, { metodo: 'POST', cuerpo: { addLabelIds: [id] } });
  }
}

/** Busca en la base los viajes y clientes que mencionan los correos (una sola consulta por lista). */
export async function vincular(empresaId, lista) {
  const det = lista.map((x) => detectar(`${x.asunto} ${x.extracto}`));
  const placas = [...new Set(det.flatMap((d) => d.placas))]; const manis = [...new Set(det.flatMap((d) => d.manifiestos))];
  const [viajes, claves] = await Promise.all([
    placas.length || manis.length ? Viaje.find({ empresa: empresaId, $or: [{ 'manifiesto.numero': { $in: manis } }, { placa: { $in: placas } }] })
      .sort({ fecha: -1 }).limit(300).select('numero placa fecha manifiesto.numero cliente').lean() : [],
    clavesClientes(empresaId),
  ]);
  const nombreCliente = new Map(claves.map((c) => [c.id, c.nombre]));
  return lista.map((x, i) => {
    const v = [];
    for (const n of det[i].manifiestos) { const vj = viajes.find((y) => y.manifiesto?.numero === n); v.push({ tipo: 'manifiesto', texto: `Manifiesto ${n}`, viaje: vj?._id || null }); }
    for (const p of det[i].placas) { const vj = viajes.find((y) => y.placa === p); v.push({ tipo: 'placa', texto: p, viaje: vj?._id || null, numeroViaje: vj?.numero || null }); }
    let cliente = clienteDe(claves, { correos: [x.de?.correo, ...(x.correos || [])].filter(Boolean), texto: `${x.asunto} ${x.extracto} ${x.de?.nombre || ''}` });
    if (!cliente) { const vj = viajes.find((y) => det[i].manifiestos.includes(y.manifiesto?.numero) || det[i].placas.includes(y.placa)); if (vj?.cliente) cliente = String(vj.cliente); }
    if (cliente) v.unshift({ tipo: 'cliente', texto: `Cliente: ${nombreCliente.get(cliente) || ''}`, cliente });
    return { ...x, cliente: cliente || null, vinculos: v };
  });
}

// ── Envío ──
const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const lineas76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

/** «Nombre <correo>» con el nombre codificado si lleva tildes. */
export const remitente = (nombre, correo) => (nombre ? `${enc(String(nombre).replace(/["\r\n<>]/g, ''))} <${correo}>` : correo);

/**
 * Arma el correo MIME en base64url, como lo pide users.messages.send.
 * Con html: multipart/alternative (texto + HTML). Con logo de firma: el HTML lo usa como cid:logo-firma (multipart/related),
 * así se ve en Gmail, Outlook y el celular sin bloquearse como imagen externa. Cco va en la cabecera Bcc: Gmail la quita al entregar.
 */
export function mime({ de = '', para, cc = '', cco = '', asunto, texto, html = '', logo = null, enRespuestaA = '', referencias = '', adjuntos = [] }) {
  const lim = () => `tls_${crypto.randomBytes(12).toString('hex')}`;
  const parte = (tipo, datos, extra = []) => [`Content-Type: ${tipo}`, ...extra, 'Content-Transfer-Encoding: base64', '', lineas76(Buffer.from(datos).toString('base64'))];
  const multi = (tipo, partes) => { const l = lim(); return [`Content-Type: ${tipo}; boundary="${l}"`, '', ...partes.flatMap((p) => [`--${l}`, ...p]), `--${l}--`, '']; };
  const plano = parte('text/plain; charset="UTF-8"', texto || '');
  let cuerpo = plano;
  if (html) {
    cuerpo = multi('multipart/alternative', [plano, parte('text/html; charset="UTF-8"', html)]);
    if (logo?.datos && html.includes('cid:logo-firma')) {
      cuerpo = multi('multipart/related', [cuerpo, parte(logo.tipo, Buffer.from(logo.datos, 'base64'), ['Content-ID: <logo-firma>', 'Content-Disposition: inline; filename="logo.png"'])]);
    }
  }
  if (adjuntos.length) {
    cuerpo = multi('multipart/mixed', [cuerpo, ...adjuntos.map((a) => {
      const n = enc(a.nombre.replace(/["\r\n]/g, ''));
      return parte(`${a.tipo || 'application/octet-stream'}; name="${n}"`, a.datos, [`Content-Disposition: attachment; filename="${n}"`]);
    })]);
  }
  const cab = [de && `From: ${de}`, `To: ${para}`, cc && `Cc: ${cc}`, cco && `Bcc: ${cco}`, `Subject: ${enc(asunto)}`, 'MIME-Version: 1.0',
    enRespuestaA && `In-Reply-To: ${enRespuestaA}`, (referencias || enRespuestaA) && `References: ${[referencias, enRespuestaA].filter(Boolean).join(' ')}`].filter(Boolean);
  return Buffer.from([...cab, ...cuerpo].join('\r\n'), 'utf8').toString('base64url');
}
