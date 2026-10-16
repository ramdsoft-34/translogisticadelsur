// Construcción e interpretación de los mensajes XML del RNDC.
// Estructura oficial (guía v4, manual v3 cap. 6 y 9):
//   <root>
//     <acceso><username/><password/></acceso>
//     <solicitud><tipo/><procesoid/></solicitud>
//     <variables>…</variables>            registro: etiquetas; consulta: lista de campos
//     <documento>…</documento>            solo consultas: filtros
//     <documentorango>…</documentorango>  solo consultas: rango de fechas
//   </root>
import { SOAP_NS } from './catalogos.js';
import { DICCIONARIO } from './diccionario.js';
import { quitarTildes, txt } from '../../utils/texto.js';

export const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// El RNDC recibe ISO-8859-1; se envía sin tildes (como lo hacía la plantilla).
export const limpiarValor = (v) => quitarTildes(txt(v)).replace(/[\r\n\t]+/g, ' ');

const etiqueta = (nombre, valor) => `<${nombre}>${escXml(limpiarValor(valor))}</${nombre}>`;
const acceso = (usuario, clave) =>
  `<acceso><username>${escXml(usuario)}</username><password>${escXml(clave)}</password></acceso>`;
const cabecera = "<?xml version='1.0' encoding='ISO-8859-1' ?>";

// Variables de un registro (tipo 1). `variables` es una lista ordenada de
// [NOMBRE, valor]; los valores vacíos no se envían. `anexos` es XML ya armado
// (ej. el bloque REMESASMAN del manifiesto).
export function xmlRegistro({ usuario, clave, proceso, variables, anexos = '' }) {
  const cuerpo = variables.filter(([, v]) => txt(v) !== '').map(([n, v]) => etiqueta(n, v)).join('');
  return `${cabecera}<root>${acceso(usuario, clave)}<solicitud><tipo>1</tipo><procesoid>${proceso}</procesoid></solicitud>` +
    `<variables>${cuerpo}${anexos}</variables></root>`;
}

// Consulta (tipo 2 maestros, tipo 3 documentos). Los filtros van entre
// comillas simples como en los ejemplos del manual (9.1 a 9.7).
export function xmlConsulta({ usuario, clave, tipo, proceso, campos, filtros = {}, desde, hasta }) {
  const doc = Object.entries(filtros).filter(([, v]) => txt(v) !== '')
    .map(([k, v]) => {
      const s = limpiarValor(v);
      return `<${k}>${/^NULL$/i.test(s) ? 'NULL' : `'${escXml(s.replace(/'/g, ''))}'`}</${k}>`;
    }).join('');
  const rango = desde && hasta
    ? `<documentorango><iniFECHAING>'${desde}'</iniFECHAING><finFECHAING>'${hasta}'</finFECHAING></documentorango>` : '';
  return `${cabecera}<root>${acceso(usuario, clave)}<solicitud><tipo>${tipo}</tipo><procesoid>${proceso}</procesoid></solicitud>` +
    `<variables>${escXml(campos.join(','))}</variables><documento>${doc}</documento>${rango}</root>`;
}

// Bloque de remesas del manifiesto (proceso 43 dentro del 4).
export function bloqueRemesas(consecutivos) {
  return `<REMESASMAN procesoid="43">${consecutivos.map(c => `<REMESA>${etiqueta('CONSECUTIVOREMESA', c)}</REMESA>`).join('')}</REMESASMAN>`;
}

export function ocultarClave(xml) {
  return String(xml).replace(/<password>[\s\S]*?<\/password>/gi, '<password>*****</password>');
}

// Sobre SOAP 1.1 rpc/encoded. modo 1 = contenido escapado, modo 2 = CDATA.
export function sobreSoap(xmlInterno, modo = 1) {
  const cuerpo = modo === 1 ? escXml(xmlInterno) : `<![CDATA[${xmlInterno.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
    ` xmlns:urn="${SOAP_NS}">` +
    '<soapenv:Header/><soapenv:Body>' +
    '<urn:AtenderMensajeRNDC soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<Request xsi:type="xsd:string">${cuerpo}</Request>` +
    '</urn:AtenderMensajeRNDC></soapenv:Body></soapenv:Envelope>';
}

const desescapar = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function entre(t, tag) {
  const m = String(t).match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

// Extrae el contenido de <return> del sobre SOAP de respuesta.
export function contenidoRespuesta(sobre) {
  const s = String(sobre);
  const m = s.match(/<return[^>]*>([\s\S]*?)<\/return>/i);
  let r = m ? m[1] : s;
  r = r.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return desescapar(r);
}

// Respuesta de un registro: <ingresoid> (radicado) o <ErrorMSG>; el
// manifiesto devuelve además <seguridadqr>.
export function interpretarRegistro(sobre) {
  const r = contenidoRespuesta(sobre);
  const radicado = entre(r, 'ingresoid');
  if (radicado) return { ok: true, radicado, qr: entre(r, 'seguridadqr'), qrObs: entre(r, 'observacionesqr'), mensaje: '' };
  const err = entre(r, 'ErrorMSG');
  return { ok: false, radicado: '', qr: '', mensaje: err || r.slice(0, 1000) || 'Respuesta vacía del RNDC' };
}

// Respuesta de una consulta: lista de <documento> con sus campos.
export function interpretarConsulta(sobre) {
  const r = contenidoRespuesta(sobre);
  const err = entre(r, 'ErrorMSG');
  if (err) return { ok: false, mensaje: err, documentos: [] };
  const documentos = [];
  for (const m of r.matchAll(/<documento>([\s\S]*?)<\/documento>/gi)) {
    const d = {};
    for (const c of m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) d[c[1].toLowerCase()] = c[2].trim();
    documentos.push(d);
  }
  return { ok: true, mensaje: '', documentos };
}

// Valida contra el diccionario oficial: obligatorios (S) presentes, tamaño
// máximo y formato de fechas dd/mm/aaaa. Devuelve lista de problemas.
export function validarVariables(proceso, variables) {
  const dic = DICCIONARIO[proceso] || {};
  const mapa = new Map(variables.map(([n, v]) => [n, txt(v)]));
  const problemas = [];
  for (const [nombre, [tam, tipo, req]] of Object.entries(dic)) {
    const v = mapa.get(nombre) ?? '';
    if (req === 'S' && v === '') { problemas.push(`${nombre}: es obligatorio`); continue; }
    if (v === '') continue;
    if (v.length > tam && tipo !== 'fecha') problemas.push(`${nombre}: máximo ${tam} caracteres`);
    if (tipo === 'numero' && !/^-?\d+(\.\d+)?$/.test(v)) problemas.push(`${nombre}: debe ser numérico`);
    if (tipo === 'fecha' && !/^\d{2}\/\d{2}\/\d{4}$/.test(v)) problemas.push(`${nombre}: fecha en formato dd/mm/aaaa`);
  }
  return problemas;
}
