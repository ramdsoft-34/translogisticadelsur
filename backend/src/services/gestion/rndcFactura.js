// Contabilidad fase 5: registro en el RNDC (proceso 86) de la factura electrónica de transporte validada por la DIAN.
// Guía Factura Electrónica de Transporte (MinTransporte · RNDC): después de que la DIAN valida la factura, se carga en el
// RNDC el XML que devuelve la DIAN (AttachedDocument), una factura por mensaje:
//   <solicitud><tipo>1</tipo><procesoid>86</procesoid></solicitud>
//   <variables><NUMNITEMPRESATRANSPORTE/><ARCHIVOBASE64/></variables>
// Antes de enviar se revisa el XML contra la factura de la plataforma: emisor, adquirente, número y CUFE, la validación
// de la DIAN y las remesas de cada línea (01 radicado, 02 consecutivo, 03 flete) frente a la relación de remesas.
//
// Seguridad:
// - El XML se lee en tiempo lineal y con límites (sin DOCTYPE ni ENTITY); se guarda aparte y solo se lee al enviarlo.
// - La contraseña del RNDC es la guardada cifrada de la empresa (services/rndc/claveGuardada.js) o la que escribe a mano
//   quien puede hacerlo; nunca se guarda en la factura ni en el registro (TransaccionRndc la oculta).
// - Si el RNDC rechaza la contraseña guardada, queda marcada como inválida y el envío automático se detiene (el RNDC
//   bloquea el usuario tras varios intentos). Los errores de datos no se reintentan solos; los de conexión sí, con espera
//   creciente y un máximo de intentos. Todo pasa por el limitador de peticiones del RNDC.
import crypto from 'node:crypto';
import { Empresa, FacturaCont, Cliente, XmlFacturaRndc } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { xmlUbl } from './compras.js';
import { relacionRemesas } from './tributario.js';
import { enviar, registrarTransaccion } from '../rndc/cliente.js';
import { xmlRegistro, interpretarRegistro } from '../rndc/xml.js';
import { nitEmpresa } from '../rndc/documentos.js';
import * as claveRndc from '../rndc/claveGuardada.js';
import { auditar } from '../auditoria.js';
import { soloDigitos, txt } from '../../utils/texto.js';

const { bloques, bloque, texto, cdatas, desescapar, quitarBloques } = xmlUbl;
export const PROCESO_FE = 86;
export const LIMITE_XML = 800 * 1024;           // un AttachedDocument normal pesa entre 20 y 200 KB
export const MAX_INTENTOS = 6;                  // reintentos automáticos por falta de conexión
const BLOQUEO_MS = 5 * 60 * 1000;
export const RECHAZO_CLAVE = /usuario o (la )?contrase|contrase[ñn]a (no |inv|incorrect)|password (no |inv|incorrect)|autentic|usuario (no |inv)/i;
// Espera antes del siguiente intento por conexión: 10 min, 20, 40… hasta 6 horas
export const esperaReintento = (intentos) => Math.min(6 * 3600e3, 10 * 60e3 * 2 ** Math.max(0, intentos - 1));
const etiqueta = (n) => new RegExp(`<(?:[\\w-]+:)?${n}[\\s>]`);

// ── Lectura del AttachedDocument (regla pura) ────────────────────────────────
export function leerAttachedDocument(xml) {
  const doc = String(xml || '');
  if (Buffer.byteLength(doc, 'utf8') > LIMITE_XML) throw new ErrorHttp(400, `El XML pesa más de ${Math.round(LIMITE_XML / 1024)} KB: no parece un AttachedDocument de una factura`);
  if (!doc.trimStart().startsWith('<')) throw new ErrorHttp(400, 'El archivo no es un XML');
  if (/<!DOCTYPE|<!ENTITY/i.test(doc)) throw new ErrorHttp(400, 'El XML trae DOCTYPE o ENTITY: no se acepta por seguridad');
  if (!etiqueta('AttachedDocument').test(doc)) {
    throw new ErrorHttp(400, 'Se necesita el AttachedDocument que entrega el proveedor tecnológico después de la validación de la DIAN (no el XML de la factura sola)');
  }
  // La factura y la respuesta de la DIAN vienen dentro de cbc:Description (en CDATA o escapadas)
  const candidatos = [...cdatas(doc), ...bloques(doc, 'Description').map(desescapar)];
  const factura = candidatos.find(t => etiqueta('Invoice').test(t));
  if (!factura) throw new ErrorHttp(400, 'El AttachedDocument no trae la factura (Invoice) adentro');
  const respuesta = candidatos.find(t => etiqueta('ApplicationResponse').test(t)) || '';
  const inv = quitarBloques(quitarBloques(factura, 'UBLExtensions'), 'Signature');
  const cab = quitarBloques(inv, 'InvoiceLine');
  const nit = (n) => soloDigitos(texto(bloque(cab, n), 'CompanyID'));
  const codigos = bloques(respuesta, 'ResponseCode').map(c => desescapar(c.replace(/<[^>]{0,2000}>/g, '')).trim());
  const remesas = bloques(inv, 'InvoiceLine').map((l, i) => {
    const p = Object.fromEntries(bloques(l, 'AdditionalItemProperty').map(x => [texto(x, 'Name'), texto(x, 'Value')]));
    return { linea: i + 1, radicado: p['01'] || '', consecutivo: p['02'] || '', flete: p['03'] || '', valor: Math.round(Number(texto(l, 'LineExtensionAmount')) || 0) };
  });
  return { numero: texto(cab, 'ID').toUpperCase(), cufe: texto(cab, 'UUID').toLowerCase(), tipoOperacion: texto(cab, 'CustomizationID'),
    fecha: texto(cab, 'IssueDate'), emisor: nit('AccountingSupplierParty'), adquirente: nit('AccountingCustomerParty'),
    validadaDian: codigos.includes('02'), codigosDian: codigos, remesas };
}

// El NIT del XML va sin dígito de verificación; en la plataforma puede estar con él o aparte
const mismoNit = (xmlNit, nit, dv = '') => {
  const a = soloDigitos(xmlNit); const b = soloDigitos(nit);
  return !!a && (a === b || a + soloDigitos(dv) === b || a === b + soloDigitos(dv) || (b.length === a.length + 1 && b.startsWith(a)));
};

// Revisión del XML contra la factura y su relación de remesas (regla pura). problemas: impiden el envío; avisos: no.
export function revisarXml(x, { numeroFe = '', cufe = '', tipoOperacion = '12', empresa = {}, cliente = {}, filas = [] }) {
  const problemas = []; const avisos = [];
  if (!x.validadaDian) problemas.push('El XML no trae la respuesta de la DIAN «Documento validado» (código 02): use el AttachedDocument que entrega el proveedor después de la validación');
  if (!/^[0-9a-f]{96}$/.test(x.cufe)) problemas.push('El CUFE del XML no tiene 96 caracteres hexadecimales');
  if (cufe && x.cufe !== cufe) problemas.push(`El CUFE del XML no es el registrado en la factura (${cufe.slice(0, 12)}…)`);
  if (numeroFe && x.numero !== numeroFe) problemas.push(`El XML es de la factura ${x.numero} y la plataforma tiene registrada la ${numeroFe}`);
  if (x.tipoOperacion !== tipoOperacion) problemas.push(`El tipo de operación del XML es ${x.tipoOperacion || 'vacío'} y debe ser ${tipoOperacion} (transporte de carga)`);
  if (!mismoNit(x.emisor, empresa.nit, empresa.dv)) problemas.push(`El emisor del XML (${x.emisor || 'sin NIT'}) no es la empresa`);
  if (cliente?.nit && !mismoNit(x.adquirente, cliente.nit, cliente.dv)) problemas.push(`El adquirente del XML (${x.adquirente || 'sin NIT'}) no es el cliente de la factura`);
  if (!x.remesas.length) problemas.push('El XML no tiene líneas');
  for (const r of x.remesas) {
    if (!r.radicado || !r.consecutivo || !r.flete) problemas.push(`Línea ${r.linea}: faltan los datos de la remesa (01 radicado, 02 consecutivo, 03 flete)`);
  }
  const enXml = new Map(x.remesas.map(r => [r.consecutivo, r]));
  const enFactura = new Map(filas.map(f => [String(f[9]), f]));
  for (const c of enFactura.keys()) if (c && !enXml.has(c)) problemas.push(`La remesa ${c} de la factura no está en el XML`);
  for (const c of enXml.keys()) if (c && !enFactura.has(c)) problemas.push(`La remesa ${c} del XML no está en la factura`);
  for (const [c, f] of enFactura) {
    const r = enXml.get(c); if (!r) continue;
    if (txt(f[8]) && txt(f[8]) !== '0' && r.radicado !== txt(f[8])) problemas.push(`Remesa ${c}: el radicado del XML (${r.radicado}) no es el del RNDC (${f[8]})`);
    if (Math.round(Number(r.flete)) !== Math.round(Number(f[10]))) avisos.push(`Remesa ${c}: el flete del XML (${r.flete}) es distinto al de la relación (${f[10]})`);
  }
  return { problemas: [...new Set(problemas)], avisos };
}

// ── Cargar el XML ────────────────────────────────────────────────────────────
export async function cargarXml(empresaId, numero, xml, usuario = null) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero });
  if (!f || f.estado === 'ANULADA') throw new ErrorHttp(404, 'Factura no encontrada');
  if (f.fe?.rndc?.estado === 'ACEPTADA') throw new ErrorHttp(409, `La factura ya está registrada en el RNDC (radicado ${f.fe.rndc.radicado})`);
  if (f.fe?.rndc?.enviando && Date.now() - f.fe.rndc.enviando < BLOQUEO_MS) throw new ErrorHttp(409, 'La factura se está enviando al RNDC en este momento');
  const x = leerAttachedDocument(xml);
  const [empresa, cliente, rel] = await Promise.all([Empresa.findById(empresaId).select('nit dv').lean(),
    Cliente.findOne({ empresa: empresaId, _id: f.cliente }).select('nit dv').lean(), relacionRemesas(empresaId, numero)]);
  const rev = revisarXml(x, { numeroFe: f.fe?.numero, cufe: f.fe?.cufe, tipoOperacion: f.fe?.tipoOperacion || '12', empresa, cliente, filas: rel.filas });
  if (rev.problemas.length) throw new ErrorHttp(400, 'El XML no se puede registrar en el RNDC', rev.problemas);
  const contenido = String(xml);
  await XmlFacturaRndc.updateOne({ empresa: empresaId, factura: numero }, { $set: { xml: contenido, sha256: crypto.createHash('sha256').update(contenido).digest('hex'),
    bytes: Buffer.byteLength(contenido, 'utf8'), numeroFe: x.numero, cufe: x.cufe, cargadoPor: usuario?._id || null, cargadoPorNombre: usuario?.nombre || '' } }, { upsert: true });
  await FacturaCont.updateOne({ empresa: empresaId, _id: f._id }, { $set: { 'fe.numero': x.numero, 'fe.cufe': x.cufe,
    'fe.rndc': { estado: 'PENDIENTE', radicado: '', mensaje: '', intentos: 0, ultimoIntento: null, siguienteIntento: new Date(), enviadaEn: null, enviando: null } } });
  return { factura: numero, numeroFe: x.numero, cufe: x.cufe, remesas: x.remesas.length, avisos: rev.avisos };
}

// ── Enviar al RNDC ───────────────────────────────────────────────────────────
// clave: la escrita a mano (solo quien puede, ver la ruta); sin ella se usa la guardada de la empresa.
export async function enviarFactura(empresaId, numero, { clave = '', usuario = null, automatico = false } = {}) {
  const ahora = new Date();
  const estados = automatico ? ['PENDIENTE', 'ERROR_CONEXION'] : ['PENDIENTE', 'ERROR_CONEXION', 'RECHAZADA', 'ERROR'];
  const f = await FacturaCont.findOneAndUpdate({ empresa: empresaId, numero, estado: { $ne: 'ANULADA' }, 'fe.rndc.estado': { $in: estados },
    $or: [{ 'fe.rndc.enviando': null }, { 'fe.rndc.enviando': { $lt: new Date(ahora - BLOQUEO_MS) } }] }, { $set: { 'fe.rndc.enviando': ahora } }, { new: true }).lean();
  if (!f) {
    const x = await FacturaCont.findOne({ empresa: empresaId, numero }).select('estado fe').lean();
    if (!x || x.estado === 'ANULADA') throw new ErrorHttp(404, 'Factura no encontrada');
    if (x.fe?.rndc?.estado === 'ACEPTADA') throw new ErrorHttp(409, `La factura ya está registrada en el RNDC (radicado ${x.fe.rndc.radicado})`);
    if (!x.fe?.rndc?.estado) throw new ErrorHttp(400, 'Cargue primero el XML validado por la DIAN (AttachedDocument)');
    throw new ErrorHttp(409, 'La factura se está enviando al RNDC en este momento');
  }
  const set = (campos) => FacturaCont.updateOne({ empresa: empresaId, _id: f._id }, { $set: Object.fromEntries(Object.entries(campos).map(([k, v]) => [`fe.rndc.${k}`, v])) });
  try {
    const [empresa, archivo] = await Promise.all([Empresa.findById(empresaId).lean(), XmlFacturaRndc.findOne({ empresa: empresaId, factura: numero }).select('+xml').lean()]);
    if (!archivo?.xml) throw new ErrorHttp(400, 'No está el XML de la factura: cárguelo de nuevo');
    const ambiente = empresa.rndc?.ambiente || 'SIMULADO';
    const usuarioRndc = txt(empresa.rndc?.usuario);
    if (ambiente !== 'SIMULADO' && !usuarioRndc) throw new ErrorHttp(400, 'Configure el usuario del web service del RNDC (Configuración > RNDC)');
    const conGuardada = !txt(clave);
    let xml = xmlRegistro({ usuario: usuarioRndc || 'SIMULADO', clave: conGuardada ? await claveRndc.usar(empresaId, usuarioRndc) : clave, proceso: PROCESO_FE,
      variables: [['NUMNITEMPRESATRANSPORTE', nitEmpresa(empresa)], ['ARCHIVOBASE64', Buffer.from(archivo.xml, 'utf8').toString('base64')]] });
    const meta = { empresa: empresaId, usuario: usuario?._id || null, ambiente, tipo: 1, proceso: PROCESO_FE, referencia: f.fe?.numero || numero };
    const resp = await enviar(xml, meta);
    const resultado = resp.conectado ? interpretarRegistro(resp.texto) : { ok: false, radicado: '', mensaje: `No hubo conexión con el RNDC: ${resp.texto}` };
    await registrarTransaccion(meta, xml, resp, resultado);        // guarda la solicitud con la contraseña oculta
    xml = null;
    const intentos = (f.fe?.rndc?.intentos || 0) + 1;
    const mensaje = String(resultado.mensaje || '').slice(0, 1000);
    let estado;
    if (resultado.ok) {
      estado = 'ACEPTADA';
      await set({ estado, radicado: resultado.radicado, mensaje: '', intentos, ultimoIntento: ahora, siguienteIntento: null, enviadaEn: new Date() });
    } else if (resp.conectado && RECHAZO_CLAVE.test(mensaje)) {
      // Contraseña rechazada: no cuenta como intento de la factura y no se insiste
      if (conGuardada) await claveRndc.invalidar(empresaId);
      estado = 'PENDIENTE';
      await set({ estado, mensaje: `El RNDC rechazó la contraseña: ${mensaje}`, ultimoIntento: ahora });
    } else if (!resp.conectado) {
      estado = intentos >= MAX_INTENTOS ? 'ERROR' : 'ERROR_CONEXION';
      await set({ estado, mensaje, intentos, ultimoIntento: ahora, siguienteIntento: estado === 'ERROR' ? null : new Date(Date.now() + esperaReintento(intentos)) });
    } else {
      estado = 'RECHAZADA';            // datos rechazados: lo corrige una persona, no se reintenta solo
      await set({ estado, mensaje, intentos, ultimoIntento: ahora, siguienteIntento: null });
    }
    return { factura: numero, numeroFe: f.fe?.numero || '', estado, radicado: resultado.radicado || '', mensaje: estado === 'ACEPTADA' ? '' : mensaje, claveRechazada: estado === 'PENDIENTE' };
  } finally {
    await set({ enviando: null });
  }
}

// Estado del envío para la pantalla (nunca la contraseña)
export async function estadoEnvio(empresaId) {
  const [e, clave, pendientes] = await Promise.all([Empresa.findById(empresaId).select('rndc.ambiente rndc.usuario contabilidad.rndcFeAutomatico').lean(), claveRndc.estado(empresaId),
    FacturaCont.countDocuments({ empresa: empresaId, estado: { $ne: 'ANULADA' }, 'fe.rndc.estado': { $in: ['PENDIENTE', 'ERROR_CONEXION'] } })]);
  return { automatico: !!e?.contabilidad?.rndcFeAutomatico, ambiente: e?.rndc?.ambiente || 'SIMULADO', usuarioRndc: e?.rndc?.usuario || '',
    claveGuardada: clave.guardada, claveInvalida: clave.invalida, llaveServidor: clave.disponible, pendientes };
}

export async function configurarAutomatico(empresaId, activo) {
  await Empresa.updateOne({ _id: empresaId }, { $set: { 'contabilidad.rndcFeAutomatico': !!activo } });
  return estadoEnvio(empresaId);
}

// ── Envío automático ─────────────────────────────────────────────────────────
// Cada 5 minutos: empresas con el envío automático activo y la contraseña del RNDC guardada y vigente. Hasta 10
// facturas por empresa y vuelta, de una en una (además pasan por el limitador del RNDC).
export async function enviarPendientes(empresaId, { limite = 10 } = {}) {
  const c = await claveRndc.estado(empresaId);
  if (!c.disponible || !c.guardada) return [];
  const facturas = await FacturaCont.find({ empresa: empresaId, estado: { $ne: 'ANULADA' }, 'fe.rndc.estado': { $in: ['PENDIENTE', 'ERROR_CONEXION'] },
    $or: [{ 'fe.rndc.siguienteIntento': null }, { 'fe.rndc.siguienteIntento': { $lte: new Date() } }] }).select('numero').sort({ 'fe.rndc.siguienteIntento': 1 }).limit(limite).lean();
  const resultados = [];
  for (const { numero } of facturas) {
    try {
      const r = await enviarFactura(empresaId, numero, { automatico: true });
      resultados.push(r);
      await auditar(null, 'factura_rndc_automatica', { empresa: empresaId, usuario: null, entidad: 'FacturaCont', detalle: { factura: numero, estado: r.estado, radicado: r.radicado } });
      if (r.claveRechazada) break;
    } catch (e) {
      resultados.push({ factura: numero, estado: 'NO_ENVIADA', mensaje: e.message });
      if (e.status === 400 || e.status === 409 || e.status === 503) break;     // sin contraseña utilizable: se espera a que la arreglen
    }
  }
  return resultados;
}

let temporizador = null; let ocupado = false;
export function iniciarEnvioAutomatico(intervaloMs = 5 * 60 * 1000) {
  if (temporizador) return;
  temporizador = setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      for (const e of await Empresa.find({ 'contabilidad.rndcFeAutomatico': true }).select('_id').lean()) {
        await enviarPendientes(e._id).catch(err => console.error('Envío de facturas al RNDC:', err.message));
      }
    } catch (err) { console.error('Envío de facturas al RNDC:', err.message); } finally { ocupado = false; }
  }, intervaloMs);
  temporizador.unref?.();
}
