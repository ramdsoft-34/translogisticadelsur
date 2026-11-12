// Cargues del día por el jefe de bodega del cliente.
// 1. Cooespatrans envía por WhatsApp (plantilla con botón) un enlace del día: /b/<token>. Vence a las 11:59 p. m.
// 2. El jefe de bodega entra con su cédula (debe estar registrada como jefe de bodega de ese cliente) y marca, en dos
//    pestañas (urbanos y correrías), los vehículos que cargaron hoy o ayer: destino, planilla, viajes y auxiliar.
// 3. En Viajes se revisan y se registran con el proceso normal (POST /viajes). Nada se crea solo.
// Seguridad: el enlace es aleatorio (144 bits) y solo se guarda su huella; tras la cédula se entrega una sesión firmada
// de 2 horas; 5 cédulas erradas bloquean el enlace 15 minutos. La bodega solo ve placas y nombres de conductores que
// han cargado con su cliente (nunca cédulas ni el resto de la flota).
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Cliente, Empresa, EnvioWhatsapp, ReporteBodega, Tarifa, Tercero, Vehiculo, Viaje } from '../models/index.js';
import { ErrorHttp } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { cifrar, descifrar } from '../utils/cifrado.js';
import { hoyColombia, normalizar, soloDigitos, txt, enColombia } from '../utils/texto.js';
import { idCliente } from './rndc/documentos.js';
import { publicar } from './eventos.js';
import { celularWhatsapp, enviarPlantillaEnlace } from './whatsappBusiness.js';
import { buscarPorNombre } from './importacion/completarViajes.js';
import { valoresDesdeTarifa } from './calculos.js';

export const PLANTILLA_BODEGA = 'cargues_bodega';
const DIA = 86400000;
const SESION_MS = 2 * 3600000;
const MAX_FALLIDOS = 5;
const RE_PLACA = /^[A-Z]{3}[0-9]{2}[A-Z0-9]$|^[A-Z0-9]{5,6}$/;
const huella = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const nombreDe = (t) => [t?.nombres, t?.apellido1, t?.apellido2].filter(Boolean).join(' ');
const primerNombre = (n) => txt(n).split(/\s+/)[0] || '';
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const FECHA_LARGA = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
export const fechaTexto = (d) => FECHA_LARGA.format(new Date(d)).replace(',', '');

// ── Urbanos o correrías ──
// Urbano: el destino está en el mismo municipio donde carga el cliente (o la tarifa es de viaje municipal). Correría: otro municipio.
const municipio = (cod) => { const d = soloDigitos(cod); return d.length >= 5 ? d.slice(0, 5) : ''; };
async function municipioCargue(empresaId, cliente) {
  if (txt(cliente.sedeRemitente)) {
    const s = await Tercero.findOne({ empresa: empresaId, tipoId: cliente.tipoId || 'N', numId: idCliente(cliente), 'sede.codigo': txt(cliente.sedeRemitente) }).select('codMunicipio').lean();
    if (s?.codMunicipio) return municipio(s.codMunicipio);
  }
  const e = await Empresa.findById(empresaId).select('rndc.codOrigen').lean();
  return municipio(e?.rndc?.codOrigen);
}
export const tipoTarifa = (t, cargue) => (t?.operacion === 'U' || (cargue && municipio(t?.codMunicipio) === cargue) ? 'urbano' : 'correria');

/** Destinos del cliente separados en urbanos y correrías. */
async function destinosCliente(empresaId, cliente) {
  const cargue = await municipioCargue(empresaId, cliente);
  const tarifas = await Tarifa.find({ empresa: empresaId, cliente: cliente._id, activo: { $ne: false } })
    .select('destino codMunicipio operacion tarifaCliente fleteConductor anticipoHabitual pesoKg destinatario tarifaAuxiliar').lean();
  const porId = new Map(tarifas.map((t) => [String(t._id), { ...t, tipo: tipoTarifa(t, cargue) }]));
  return { cargue, porId };
}

// ── Vehículos frecuentes del cliente (últimos 60 días) ──
// Los ve el jefe de bodega: las «automáticas» (3 o más cargues) y las «agregadas» por la empresa.
// Sugeridas: menos de 3 cargues (no salen hasta que se agreguen). Quitadas: no salen aunque carguen seguido.
// Cada placa sale en la pestaña de sus viajes (urbanos, correrías o las dos); si nunca ha cargado, en las dos.
export async function frecuentes(empresaId, cliente, { dias = 60 } = {}) {
  const { porId } = await destinosCliente(empresaId, cliente);
  const desde = new Date(hoyColombia().getTime() - dias * DIA);
  const grupos = await Viaje.aggregate([
    { $match: { empresa: oid(empresaId), cliente: oid(cliente._id), estado: { $ne: 'anulado' }, fecha: { $gte: desde } } },
    { $sort: { fecha: -1 } },
    { $group: { _id: '$placa', cargues: { $sum: 1 }, ultimo: { $first: '$fecha' }, conductores: { $push: '$conductor' }, tarifas: { $push: '$tarifaRef' } } },
  ]);
  const moda = (l) => { const c = new Map(); for (const x of l.filter(Boolean)) c.set(String(x), (c.get(String(x)) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
  const b = cliente.bodega || {};
  const fijadas = new Set(b.fijadas || []); const quitadas = new Set(b.quitadas || []);
  const elegidos = new Map((b.tiposPlaca || []).map((x) => [x.placa, x.tipo]));
  const placas = [...new Set([...grupos.map((g) => g._id), ...fijadas, ...quitadas])];
  const vehs = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: placas } }).select('placa conductorHabitual').lean()).map((v) => [v.placa, v]));
  const filas = placas.map((placa) => {
    const g = grupos.find((x) => x._id === placa) || { cargues: 0, ultimo: null, conductores: [], tarifas: [] };
    const conductor = moda(g.conductores) || (vehs.get(placa)?.conductorHabitual ? String(vehs.get(placa).conductorHabitual) : null);
    const tarifa = moda(g.tarifas);
    const t = tarifa ? porId.get(tarifa) : null;
    const origen = quitadas.has(placa) ? 'quitada' : fijadas.has(placa) ? 'agregada' : g.cargues >= 3 ? 'automatica' : 'sugerida';
    const deViajes = [...new Set(g.tarifas.map((x) => porId.get(String(x))?.tipo).filter(Boolean))];
    const elegido = elegidos.get(placa) || '';
    const tipos = elegido === 'ambos' ? ['urbano', 'correria'] : elegido ? [elegido] : deViajes.length ? deViajes : ['urbano', 'correria'];
    return { placa, cargues: g.cargues, ultimo: g.ultimo, conductor, tarifa: t ? String(t._id) : null, destino: t?.destino || '',
      tipos, tipoElegido: elegido, origen, visible: origen === 'agregada' || origen === 'automatica' };
  });
  const ids = [...new Set(filas.map((f) => f.conductor).filter(Boolean))];
  const nombres = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: ids } }).select('nombres apellido1 apellido2').lean()).map((t) => [String(t._id), nombreDe(t)]));
  return filas.map((f) => ({ ...f, conductorNombre: f.conductor ? nombres.get(f.conductor) || '' : '' }))
    .sort((a, b) => b.cargues - a.cargues || a.placa.localeCompare(b.placa));
}

/** Vehículos de la empresa para agregar al formulario: por placa o por el nombre de su conductor (mientras se escribe). */
export async function buscarVehiculos(empresaId, q) {
  const t = txt(q).slice(0, 40);
  const placa = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const palabras = normalizar(t).split(' ').filter((w) => w.length > 1);
  if (placa.length < 2 && !palabras.length) return [];
  const porPlaca = placa.length >= 2 ? await Vehiculo.find({ empresa: empresaId, placa: { $regex: `^${placa}` } }).select('placa conductorHabitual').limit(8).lean() : [];
  let porNombre = [];
  if (palabras.length) {
    const conds = (await Tercero.find({ empresa: empresaId, roles: 'conductor', activo: { $ne: false } }).select('nombres apellido1 apellido2 placas placaPrincipal').lean())
      .filter((c) => { const n = normalizar(nombreDe(c)); return palabras.every((w) => n.includes(w)); }).slice(0, 8);
    porNombre = conds.flatMap((c) => [...new Set([c.placaPrincipal, ...(c.placas || [])].filter(Boolean))].map((pl) => ({ placa: pl, conductor: c })));
  }
  const ids = [...new Set(porPlaca.map((v) => v.conductorHabitual).filter(Boolean).map(String))];
  const nombres = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: ids } }).select('nombres apellido1 apellido2').lean()).map((c) => [String(c._id), nombreDe(c)]));
  const salida = new Map();
  for (const v of porPlaca) salida.set(v.placa, { placa: v.placa, conductorNombre: v.conductorHabitual ? nombres.get(String(v.conductorHabitual)) || '' : '' });
  for (const x of porNombre) if (!salida.has(x.placa)) salida.set(x.placa, { placa: x.placa, conductorNombre: nombreDe(x.conductor) });
  return [...salida.values()].slice(0, 10);
}

// Tarifa que corresponde al destino escrito: igual (sin tildes ni mayúsculas) o la única que lo contiene o está contenida
function sugerirTarifa(texto, tarifas) {
  const d = normalizar(texto); if (!d) return null;
  const iguales = tarifas.filter((t) => normalizar(t.destino) === d);
  if (iguales.length) return iguales[0];
  const parecidas = tarifas.filter((t) => { const a = normalizar(t.destino); return a.includes(d) || d.includes(a); });
  return parecidas.length === 1 ? parecidas[0] : null;
}

// ── Enlace del día ──
async function reporteDelDia(empresaId, clienteId, fecha) {
  const f = { empresa: empresaId, cliente: clienteId, fecha };
  return ReporteBodega.findOneAndUpdate(f, { $setOnInsert: f }, { upsert: true, new: true }).select('+tokenHash +tokenCifrado');
}

/** Envía (o reenvía, con el mismo enlace) la solicitud del día a los jefes de bodega del cliente. */
export async function enviarSolicitud(empresaId, clienteId, { usuario = null, automatico = false } = {}) {
  const cliente = await Cliente.findOne({ empresa: empresaId, _id: clienteId }).select('nombre bodega').lean();
  if (!cliente) throw new ErrorHttp(404, 'Cliente no encontrado');
  const jefes = (cliente.bodega?.jefes || []).filter((j) => celularWhatsapp(j.celular) && soloDigitos(j.cedula));
  if (!cliente.bodega?.activa) throw new ErrorHttp(409, `${cliente.nombre}: la solicitud por WhatsApp no está activa (Clientes y tarifas)`);
  if (!jefes.length) throw new ErrorHttp(409, `${cliente.nombre}: registre al menos un jefe de bodega con cédula y celular`);
  const hoy = hoyColombia();
  const r = await reporteDelDia(empresaId, cliente._id, hoy);
  let token = r.tokenCifrado ? descifrar(r.tokenCifrado) : '';
  if (!token) {
    token = crypto.randomBytes(18).toString('base64url');
    r.tokenHash = huella(token); r.tokenCifrado = cifrar(token);
  }
  r.vence = new Date(hoy.getTime() + DIA + 5 * 3600000 - 1000);          // 11:59:59 p. m. en Colombia
  const empresa = await Empresa.findById(empresaId).select('nombre whatsapp.modo').lean();
  const destinatarios = [];
  for (const j of jefes) {
    // Cada solicitud queda en Mensajes de WhatsApp (con entregado / leído / error que avisa Meta)
    const envio = await EnvioWhatsapp.create({ empresa: empresaId, tipo: 'bodega', cliente: cliente._id, reporteBodega: r._id, documento: 'Cargues de bodega',
      destinatario: j.nombre || '', telefono: celularWhatsapp(j.celular) || '', estado: 'enviando', intentos: 1,
      origen: automatico ? 'automatico' : 'manual', usuario, cuenta: empresa?.whatsapp?.modo || 'plataforma' });
    try {
      const idMensaje = await enviarPlantillaEnlace(empresaId, celularWhatsapp(j.celular), { plantilla: PLANTILLA_BODEGA,
        // Plantilla «cargues_bodega»: Hola, {{1}}. {{2}} le solicita reportar los vehículos que cargan hoy, {{3}}, para {{4}}. … (botón con /b/{{1}})
        cuerpo: [primerNombre(j.nombre) || 'jefe de bodega', empresa?.nombre || 'La transportadora', fechaTexto(hoy), cliente.nombre], sufijo: token });
      destinatarios.push({ nombre: j.nombre, celular: j.celular, ok: true, error: '', idMensaje });
      await EnvioWhatsapp.updateOne({ empresa: empresaId, _id: envio._id }, { $set: { estado: 'enviado', idMensaje, enviadoEn: new Date() } });
    } catch (e) {
      const error = String(e.message || e).slice(0, 300);
      destinatarios.push({ nombre: j.nombre, celular: j.celular, ok: false, error, idMensaje: '' });
      await EnvioWhatsapp.updateOne({ empresa: empresaId, _id: envio._id }, { $set: { estado: 'error', error } });
    }
  }
  r.envio = { enviadoEn: new Date(), automatico, usuario, destinatarios };
  await r.save();
  publicar(empresaId, { recurso: 'bodega', ruta: '/enviar', metodo: 'POST' });
  return { cliente: cliente.nombre, enviados: destinatarios.filter((d) => d.ok).length, fallidos: destinatarios.filter((d) => !d.ok) };
}

// ── Lado del jefe de bodega (público) ──
async function porToken(token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token || ''))) return null;
  return ReporteBodega.findOne({ empresa: { $exists: true }, tokenHash: huella(token) });
}
async function vigente(token) {
  const r = await porToken(token);
  if (!r) throw new ErrorHttp(404, 'El enlace no existe. Pida uno nuevo a la transportadora.');
  if (!r.vence || r.vence < new Date()) throw new ErrorHttp(410, 'Este enlace ya venció. Cada día llega uno nuevo por WhatsApp.');
  return r;
}
const firmar = (datos) => crypto.createHmac('sha256', env.jwtSecret).update(`bodega:${datos}`).digest('base64url');
function crearSesion(r, cedula) {
  const datos = Buffer.from(JSON.stringify({ r: String(r._id), c: cedula, e: Date.now() + SESION_MS })).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}
function leerSesion(r, sesion) {
  const [datos, firma] = String(sesion || '').split('.');
  const esperada = firmar(datos || '');
  if (!datos || !firma || firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) throw new ErrorHttp(401, 'Ingrese de nuevo con su cédula');
  const s = JSON.parse(Buffer.from(datos, 'base64url').toString());
  if (s.r !== String(r._id) || s.e < Date.now()) throw new ErrorHttp(401, 'Su sesión terminó. Ingrese de nuevo con su cédula');
  return s.c;
}

/** Portada del enlace: solo el nombre de la transportadora, el cliente y el día (nada más sin la cédula). */
export async function portada(token) {
  const r = await vigente(token);
  const [cliente, empresa] = await Promise.all([Cliente.findOne({ empresa: r.empresa, _id: r.cliente }).select('nombre').lean(), Empresa.findById(r.empresa).select('nombre').lean()]);
  return { empresa: empresa?.nombre || '', cliente: cliente?.nombre || '', fecha: iso(r.fecha), fechaTexto: fechaTexto(r.fecha), vence: r.vence };
}

async function jefeDe(r, cedula) {
  const cliente = await Cliente.findOne({ empresa: r.empresa, _id: r.cliente }).select('nombre tipoId nit dv sedeRemitente bodega').lean();
  const jefe = cliente?.bodega?.activa ? (cliente.bodega.jefes || []).find((j) => soloDigitos(j.cedula) && soloDigitos(j.cedula) === cedula) : null;
  return { cliente, jefe };
}

/** Ingreso con la cédula: debe ser un jefe de bodega registrado de ese cliente. */
export async function ingresar(token, cedulaEscrita) {
  const r = await vigente(token);
  if (r.ingreso?.bloqueadoHasta && r.ingreso.bloqueadoHasta > new Date()) throw new ErrorHttp(429, 'Demasiados intentos. Espere 15 minutos e intente de nuevo.');
  const cedula = soloDigitos(cedulaEscrita).slice(0, 15);
  const { jefe } = cedula.length >= 5 ? await jefeDe(r, cedula) : { jefe: null };
  if (!jefe) {
    const fallidos = (r.ingreso?.fallidos || 0) + 1;
    await ReporteBodega.updateOne({ empresa: r.empresa, _id: r._id }, { $set: fallidos >= MAX_FALLIDOS
      ? { 'ingreso.fallidos': 0, 'ingreso.bloqueadoHasta': new Date(Date.now() + 15 * 60000) } : { 'ingreso.fallidos': fallidos } });
    throw new ErrorHttp(403, 'Esa cédula no está registrada como jefe de bodega de este cliente. Comuníquese con la transportadora.');
  }
  await ReporteBodega.updateOne({ empresa: r.empresa, _id: r._id }, { $set: { 'ingreso.fallidos': 0, 'ingreso.bloqueadoHasta': null } });
  return { sesion: crearSesion(r, cedula), jefe: primerNombre(jefe.nombre) };
}

async function contexto(token, sesion) {
  const r = await vigente(token);
  const cedula = leerSesion(r, sesion);
  const { cliente, jefe } = await jefeDe(r, cedula);
  if (!jefe) throw new ErrorHttp(403, 'Su cédula ya no está autorizada para este cliente');
  return { r, cliente, jefe, cedula };
}
// Hoy (el día del enlace) o ayer
async function reporteDe(r, cual) {
  if (cual !== 'ayer') return r;
  return reporteDelDia(r.empresa, r.cliente, new Date(r.fecha.getTime() - DIA));
}
const itemPublico = (i) => ({ id: String(i._id), tipo: i.tipo, placa: i.placa, conductor: i.conductor ? String(i.conductor) : null, conductorTexto: i.conductorTexto,
  destino: i.destinoTexto, planilla: i.planilla, viajes: i.viajes, auxiliar: Number(i.auxiliar) || 0,
  // Registrado (o quitado) por la transportadora: el jefe de bodega ya no lo puede cambiar
  registrado: i.registrados.length > 0 || (Number(i.quitados) || 0) > 0, quitado: !i.registrados.length && (Number(i.quitados) || 0) > 0 });

/** Lo que ve el jefe de bodega: los vehículos de su formulario por pestaña y lo que ya reportó (el destino lo escribe él). */
export async function datosFormulario(token, sesion, cual = 'hoy') {
  const { r, cliente, jefe } = await contexto(token, sesion);
  const rep = await reporteDe(r, cual);
  const frec = (await frecuentes(r.empresa, cliente)).filter((f) => f.visible);
  const vehiculos = { urbano: [], correria: [] };
  for (const f of frec) for (const tp of f.tipos) vehiculos[tp].push({ placa: f.placa, conductor: f.conductor, conductorNombre: f.conductorNombre, cargues: f.cargues });
  return { jefe: primerNombre(jefe.nombre), cliente: cliente.nombre, fecha: iso(rep.fecha), fechaTexto: fechaTexto(rep.fecha), cual: cual === 'ayer' ? 'ayer' : 'hoy',
    vehiculos, reporte: { reportadoEn: rep.reportadoEn, items: rep.items.map(itemPublico) } };
}

/** Placas que han cargado con el cliente (para «otra placa»): nunca el resto de la flota. */
export async function buscarPlacas(token, sesion, q) {
  const { r } = await contexto(token, sesion);
  const t = txt(q).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (t.length < 2) return [];
  const placas = await Viaje.distinct('placa', { empresa: r.empresa, cliente: r.cliente, estado: { $ne: 'anulado' }, placa: { $regex: `^${t}` }, fecha: { $gte: new Date(Date.now() - 365 * DIA) } });
  return placas.sort().slice(0, 8);
}

/** Guarda lo marcado en una pestaña. Los renglones ya registrados por la transportadora no se pueden cambiar ni quitar. */
export async function guardarReporte(token, sesion, { cual = 'hoy', tipo, items = [] }) {
  if (!['urbano', 'correria'].includes(tipo)) throw new ErrorHttp(400, 'Pestaña no válida');
  if (!Array.isArray(items) || items.length > 60) throw new ErrorHttp(400, 'Máximo 60 vehículos por pestaña');
  const { r, cliente, jefe, cedula } = await contexto(token, sesion);
  const rep = await reporteDe(r, cual);
  const conductores = new Set((await frecuentes(r.empresa, cliente)).map((f) => f.conductor).filter(Boolean));
  const limpios = []; const vistos = new Set();
  for (const x of items) {
    const placa = txt(x?.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!RE_PLACA.test(placa)) throw new ErrorHttp(400, `Placa no válida: ${txt(x?.placa).slice(0, 10)}`);
    const destinoTexto = txt(x?.destino).replace(/\s+/g, ' ').slice(0, 80);
    if (destinoTexto.length < 2) throw new ErrorHttp(400, `Escriba el destino de ${placa}`);
    const viajes = Math.min(5, Math.max(1, Math.round(Number(x?.viajes) || 1)));
    const clave = `${placa}|${normalizar(destinoTexto)}`;
    if (vistos.has(clave)) throw new ErrorHttp(400, `${placa} está dos veces con el mismo destino: use «viajes» para indicar cuántos hizo`);
    vistos.add(clave);
    limpios.push({ tipo, placa, destinoTexto, viajes, auxiliar: Math.min(5, Math.max(0, Math.round(Number(x?.auxiliar) || 0))), planilla: txt(x?.planilla).slice(0, 30),
      conductorTexto: txt(x?.conductorTexto).replace(/\s+/g, ' ').slice(0, 80),
      conductor: conductores.has(String(x?.conductor || '')) ? x.conductor : null });
  }
  // Se conservan los renglones de la otra pestaña y los ya registrados de esta
  const fijos = rep.items.filter((i) => i.tipo !== tipo || i.registrados.length || (Number(i.quitados) || 0) > 0);
  // Una placa ya registrada (o quitada) por la transportadora en esta pestaña no se vuelve a cambiar desde la página
  const placasFijas = new Set(fijos.filter((i) => i.tipo === tipo).map((i) => i.placa));
  rep.items = [...fijos, ...limpios.filter((i) => !placasFijas.has(i.placa))];
  rep.jefe = { nombre: jefe.nombre, cedula };
  rep.reportadoEn = new Date();
  await rep.save();
  publicar(r.empresa, { recurso: 'bodega', ruta: '/reporte', metodo: 'PUT' });
  return { ok: true, fechaTexto: fechaTexto(rep.fecha), items: rep.items.map(itemPublico) };
}

// ── Lado de la transportadora ──
/** Estado del día por cliente (los que tienen la solicitud activa o reportaron ese día). */
export async function resumenDia(empresaId, fechaIso) {
  const fecha = fechaIso ? new Date(`${fechaIso}T00:00:00Z`) : hoyColombia();
  const [clientes, reportes] = await Promise.all([
    Cliente.find({ empresa: empresaId, $or: [{ 'bodega.activa': true }] }).select('nombre bodega.activa bodega.jefes bodega.envioAutomatico bodega.hora').sort({ nombre: 1 }).lean(),
    ReporteBodega.find({ empresa: empresaId, fecha }).lean(),
  ]);
  const ids = new Set(clientes.map((c) => String(c._id)));
  const extra = reportes.filter((x) => !ids.has(String(x.cliente))).map((x) => x.cliente);
  const otros = extra.length ? await Cliente.find({ empresa: empresaId, _id: { $in: extra } }).select('nombre bodega').lean() : [];
  const cuenta = (rep, tipo) => {
    const l = (rep?.items || []).filter((i) => i.tipo === tipo);
    return { vehiculos: l.length, viajes: l.reduce((a, i) => a + i.viajes, 0), registrados: l.reduce((a, i) => a + Math.min(i.viajes, i.registrados.length), 0) };
  };
  return { fecha: iso(fecha), fechaTexto: fechaTexto(fecha), clientes: [...clientes, ...otros].map((c) => {
    const rep = reportes.find((x) => String(x.cliente) === String(c._id));
    return { _id: c._id, nombre: c.nombre, activa: !!c.bodega?.activa, jefes: (c.bodega?.jefes || []).map((j) => ({ nombre: j.nombre, celular: j.celular })),
      automatico: c.bodega?.envioAutomatico ? c.bodega.hora : '', reporte: rep ? { _id: rep._id, enviadoEn: rep.envio?.enviadoEn, automatico: rep.envio?.automatico,
        destinatarios: (rep.envio?.destinatarios || []).map((d) => ({ nombre: d.nombre, ok: d.ok, error: d.error })), reportadoEn: rep.reportadoEn, jefe: rep.jefe?.nombre || '',
        urbano: cuenta(rep, 'urbano'), correria: cuenta(rep, 'correria') } : null };
  }) };
}

/** Viajes propuestos para revisar: un renglón por cada viaje que marcó la bodega. */
export async function revision(empresaId, reporteId) {
  const rep = await ReporteBodega.findOne({ empresa: empresaId, _id: reporteId }).lean();
  if (!rep) throw new ErrorHttp(404, 'Reporte no encontrado');
  const cliente = await Cliente.findOne({ empresa: empresaId, _id: rep.cliente }).select('nombre tipoId nit dv sedeRemitente bodega').lean();
  const { porId } = await destinosCliente(empresaId, cliente);
  const b = cliente.bodega || {};
  const conductores = (await Tercero.find({ empresa: empresaId, roles: 'conductor' }).select('nombres apellido1 apellido2 placas placaPrincipal').lean())
    .map((t) => Object.assign(t, { _s: new Set(normalizar(nombreDe(t)).split(' ').filter((w) => w.length > 1)) }));
  const porIdCond = new Map(conductores.map((t) => [String(t._id), t]));
  const existentes = await Viaje.find({ empresa: empresaId, fecha: rep.fecha, estado: { $ne: 'anulado' }, placa: { $in: rep.items.map((i) => i.placa) } }).select('numero placa destino cliente').lean();
  const registradosIds = new Set(rep.items.flatMap((i) => i.registrados.map(String)));
  const vehs = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: rep.items.map((i) => i.placa) } }).select('placa conductorHabitual').lean()).map((v) => [v.placa, v]));
  const filas = [];
  const deTipo = (tp) => [...porId.values()].filter((t) => t.tipo === tp);
  for (const i of rep.items) {
    // Destino: el que escribió la bodega se busca entre las tarifas de esa pestaña (igual o el único que lo contiene)
    const t = i.tarifaRef ? porId.get(String(i.tarifaRef)) : sugerirTarifa(i.destinoTexto, deTipo(i.tipo)) || sugerirTarifa(i.destinoTexto, [...porId.values()]);
    const sug = valoresDesdeTarifa(t);
    // Conductor: el que escribió la bodega («otro conductor»), si no el habitual que se le mostró
    let cond = null; let avisoConductor = '';
    if (i.conductorTexto) {
      const deLaPlaca = conductores.filter((c) => (c.placas || []).includes(i.placa) || c.placaPrincipal === i.placa || String(c._id) === String(vehs.get(i.placa)?.conductorHabitual || ''));
      cond = buscarPorNombre(i.conductorTexto, deLaPlaca).elegido || buscarPorNombre(i.conductorTexto, conductores).elegido;
      avisoConductor = cond ? `La bodega escribió «${i.conductorTexto}»` : `La bodega escribió «${i.conductorTexto}»: elíjalo`;
    } else if (i.conductor) cond = porIdCond.get(String(i.conductor)) || null;
    else if (vehs.get(i.placa)?.conductorHabitual) cond = porIdCond.get(String(vehs.get(i.placa).conductorHabitual)) || null;
    const otros = existentes.filter((v) => v.placa === i.placa && !registradosIds.has(String(v._id)));
    // Los viajes quitados por la transportadora ya no salen (los registrados siempre se muestran)
    const mostrar = Math.max(i.registrados.length, i.viajes - (Number(i.quitados) || 0));
    for (let n = 0; n < mostrar; n++) {
      const viaje = i.registrados[n] || null;
      filas.push({ item: String(i._id), n, tipo: i.tipo, placa: i.placa, planilla: i.planilla, auxiliar: Number(i.auxiliar) || 0, destinoEscrito: i.destinoTexto || '',
        conductor: cond ? String(cond._id) : null, conductorNombre: cond ? nombreDe(cond) : '', avisoConductor,
        tarifaRef: t ? String(t._id) : null, destino: t?.destino || '', tarifa: sug.tarifa || 0, flete: sug.flete || 0, anticipo: sug.anticipo || 0,
        requiereManifiesto: i.tipo === 'urbano' ? !!b.manifiestoUrbanos : b.manifiestoCorrerias !== false, auxiliarPagado: b.auxiliarPagado !== false,
        registrado: viaje ? String(viaje) : null, repetidos: viaje ? [] : otros.map((v) => `N° ${v.numero} · ${v.destino}`),
        // Los del mismo cliente se pueden marcar como el viaje de este renglón
        existentes: viaje ? [] : otros.filter((v) => String(v.cliente) === String(rep.cliente)).map((v) => ({ _id: String(v._id), numero: v.numero, destino: v.destino })) });
    }
  }
  const viajesRegistrados = registradosIds.size ? await Viaje.find({ empresa: empresaId, _id: { $in: [...registradosIds] } }).select('numero').lean() : [];
  const numeros = Object.fromEntries(viajesRegistrados.map((v) => [String(v._id), v.numero]));
  const destinos = [...porId.values()].map((t) => ({ _id: String(t._id), destino: t.destino, tipo: t.tipo, tarifa: Number(t.tarifaCliente) || 0, flete: Number(t.fleteConductor) || 0, anticipo: Number(t.anticipoHabitual) || 0 }))
    .sort((a, b2) => a.destino.localeCompare(b2.destino, 'es'));
  return { _id: rep._id, cliente: { _id: cliente._id, nombre: cliente.nombre }, fecha: iso(rep.fecha), fechaTexto: fechaTexto(rep.fecha),
    jefe: rep.jefe?.nombre || '', reportadoEn: rep.reportadoEn, filas, destinos, numeros };
}

/** Anota en el renglón del reporte el viaje que se acaba de registrar desde la revisión. */
export async function vincularViaje(empresaId, reporteId, itemId, viajeId) {
  const rep = await ReporteBodega.findOne({ empresa: empresaId, _id: reporteId });
  if (!rep) throw new ErrorHttp(404, 'Reporte no encontrado');
  const item = rep.items.id(itemId);
  if (!item) throw new ErrorHttp(404, 'Renglón no encontrado');
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId, cliente: rep.cliente }).select('_id').lean();
  if (!v) throw new ErrorHttp(400, 'El viaje no es de este cliente');
  if (item.registrados.length >= item.viajes - (Number(item.quitados) || 0)) throw new ErrorHttp(409, 'Ese renglón ya tiene todos sus viajes registrados');
  if (rep.items.some((x) => x.registrados.some((y) => String(y) === String(v._id)))) throw new ErrorHttp(409, 'Ese viaje ya está marcado en otro renglón del reporte');
  item.registrados.push(v._id);
  await rep.save();
  publicar(empresaId, { recurso: 'bodega', ruta: '/vincular', metodo: 'POST' });
  return { ok: true };
}

/** Quita de la revisión un viaje pendiente del renglón (p. ej. ya estaba registrado por otro lado). El jefe de bodega ya no lo puede cambiar. */
export async function quitarViaje(empresaId, reporteId, itemId) {
  const rep = await ReporteBodega.findOne({ empresa: empresaId, _id: reporteId });
  if (!rep) throw new ErrorHttp(404, 'Reporte no encontrado');
  const item = rep.items.id(itemId);
  if (!item) throw new ErrorHttp(404, 'Renglón no encontrado');
  if (item.viajes - (Number(item.quitados) || 0) - item.registrados.length <= 0) throw new ErrorHttp(409, 'Ese renglón no tiene viajes pendientes: los registrados no se quitan');
  item.quitados = (Number(item.quitados) || 0) + 1;
  await rep.save();
  publicar(empresaId, { recurso: 'bodega', ruta: '/quitar', metodo: 'POST' });
  return { ok: true, placa: item.placa };
}

// ── Envío automático a la hora configurada ──
let corriendo = false;
export function iniciarProgramadorBodega() {
  if (process.env.NODE_ENV === 'test') return;
  setInterval(async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const ahora = enColombia(new Date());
      const hhmm = ahora.toISOString().slice(11, 16); const dia = ahora.getUTCDay(); const hoy = hoyColombia();
      const clientes = await Cliente.find({ empresa: { $exists: true }, 'bodega.activa': true, 'bodega.envioAutomatico': true, 'bodega.dias': dia, 'bodega.hora': { $lte: hhmm } }).select('empresa').lean();
      for (const c of clientes) {
        const ya = await ReporteBodega.exists({ empresa: c.empresa, cliente: c._id, fecha: hoy, 'envio.enviadoEn': { $ne: null } });
        if (ya) continue;
        await enviarSolicitud(c.empresa, c._id, { automatico: true }).catch((e) => console.error('Cargues de bodega (automático):', e.message));
      }
    } catch (e) { console.error('Cargues de bodega:', e.message); } finally { corriendo = false; }
  }, 60000).unref();
}
