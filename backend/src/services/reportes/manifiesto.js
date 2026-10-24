// Copia impresa del Manifiesto Electrónico de Carga, idéntica al formato que imprime el RNDC
// (FastReport, vigente desde agosto de 2026). El dibujo (cajas, líneas, fondos, rótulos y logos)
// sale de assets/manifiesto-rndc.json, extraído de un manifiesto oficial con tools/plantillaManifiesto.py;
// cada dato va en la posición, tamaño y alineación medidos en 619 manifiestos expedidos por el RNDC.
//
// Los datos son los que el RNDC aceptó: las variables del XML de la remesa y del manifiesto
// enviados (TransaccionRndc), y los maestros (terceros por sede, vehículo) tal como están registrados.
//
// El texto del QR sigue el manual RNDC v3.0, sección 8.6.6: datos en orden MEC, Fecha (AAAA/MM/DD),
// Placa, Remolque (si hay), Config, Orig (20), Dest (20), Mercancia (30), Conductor, Empresa (30),
// Obs (si el RNDC las entregó, 120) y Seguro; separados por CR+LF y sin CR+LF después del último.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Municipio, Tercero, Vehiculo } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { contextoViaje, variablesRemesa, variablesManifiesto } from '../rndc/documentos.js';
import { fmtMilManifiesto, numeroALetras, quitarTildes, txt, enColombia, soloDigitos, normalizar } from '../../utils/texto.js';
import { pdfABuffer } from './comun.js';
import { lugarRndc } from '../../utils/lugares.js';

export { lugarRndc };
import { cargarViaje, variablesEnviadas as enviadas } from '../rndc/operaciones.js';

const recurso = (r) => fileURLToPath(new URL(`../../assets/${r}`, import.meta.url));
const PLANTILLA = JSON.parse(fs.readFileSync(recurso('manifiesto-rndc.json'), 'utf8'));
const LOGO_TRANSPORTE = recurso('logos/transporte.jpg');
const LOGO_SUPERTRANSPORTE = recurso('logos/supertransporte.jpg');

// ── Textos como los escribe el RNDC ─────────────────────────────────────────
const sinTildes = (s) => quitarTildes(s).toUpperCase();
const dd = (n) => String(n).padStart(2, '0');
const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].map(txt).filter(Boolean).join(' ') : '');
// Fecha AAAA/MM/DD desde Date o desde "DD/MM/AAAA" (como va en el XML)
function fechaRndc(d) {
  if (!d) return '';
  const m = txt(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}/${dd(m[2])}/${dd(m[1])}`;
  const f = new Date(d);
  return Number.isNaN(f.getTime()) ? txt(d) : `${f.getUTCFullYear()}/${dd(f.getUTCMonth() + 1)}/${dd(f.getUTCDate())}`;
}
// El RNDC imprime la radicación con hora de 12 horas y sin AM/PM (13:52 → 01:52)
export function radicacionRndc(d) {
  if (!d) return '';
  const c = enColombia(d);
  const h = c.getUTCHours() % 12 || 12;
  return `${c.getUTCFullYear()}/${dd(c.getUTCMonth() + 1)}/${dd(c.getUTCDate())} ${dd(h)}:${dd(c.getUTCMinutes())}`;
}

async function lugar(codigo) {
  if (!txt(codigo)) return '';
  const m = await Municipio.findOne({ codigo: txt(codigo) }).lean();
  return m ? lugarRndc(m) : txt(codigo);
}
async function lugarPorNombre(ciudad) {
  const n = normalizar(ciudad);
  if (!n) return '';
  const m = await Municipio.findOne({ codigo: /000$/, busqueda: new RegExp(`^${n} `) }).lean();
  return m ? lugarRndc(m) : sinTildes(ciudad);
}

// Nombres de las aseguradoras del SOAT tal como los imprime el RNDC (tomados de manifiestos oficiales)
const ASEGURADORAS_RNDC = {
  860002400: 'LA PREVISORA S.A.COMPAÑIA', 860037013: 'COMPAÑIA MUNDIAL DE', 860009578: 'SEGUROS DEL ESTADO S.A.',
  860002180: 'SEGUROS COMERCIALES', 860002184: 'AXA COLPATRIA SEGUROS SA', 890903407: 'SEGUROS GENERALES',
  860524654: 'ASEGURADORA SOLIDARIA DE', 891700037: 'MAPFRE SEGUROS GENERALES',
};
function aseguradora(vehiculo) {
  const nit = soloDigitos(vehiculo?.soat?.aseguradoraNit);
  if (!nit) return '';
  const base = ASEGURADORAS_RNDC[nit] ? nit : ASEGURADORAS_RNDC[nit.slice(0, 9)] ? nit.slice(0, 9) : nit;
  return `${base} ${ASEGURADORAS_RNDC[base] || sinTildes(vehiculo?.aseguradoraSoat || '')}`.trim();
}
const EMPAQUE_RNDC = { 0: 'Paquetes.' };
const NATURALEZA_RNDC = { 1: 'Carga Normal', 2: 'Carga Peligrosa', 3: 'Carga Extradimensionada', 4: 'Carga Extrapesada', 5: 'Desechos Peligrosos', 6: 'Semovientes', 7: 'Refrigerada' };
const UNIDAD_RNDC = { 1: 'Kilogramos', 2: 'Galones' };
const RESPONSABLE_RNDC = { E: 'EMPRESA DE TRANSPORTE', R: 'REMITENTE', D: 'DESTINATARIO' };
const DUENO_POLIZA_RNDC = { E: 'Empresa de Transporte', G: 'Generador de Carga' };

export function textoQR(d) {
  const p = (s, n) => sinTildes(s).slice(0, n);
  const datos = [`MEC:${d.radicado}`, `Fecha:${d.fechaExp}`, `Placa:${d.placa}`];
  if (d.remolque) datos.push(`Remolque:${d.remolque}`);
  datos.push(`Config:${d.config}`, `Orig:${p(d.origen, 20)}`, `Dest:${p(d.destino, 20)}`, `Mercancia:${p(d.mercancia, 30)}`,
    `Conductor:${d.condDoc}`, `Empresa:${p(d.empresa, 30)}`);
  if (d.qrObs) datos.push(`Obs:${p(d.qrObs, 120)}`);
  datos.push(`Seguro:${d.seguro}`);
  return datos.join('\r\n');
}

// Tercero tal como está registrado (por documento y, si se indica, sede)
async function tercero(empresaId, tipoId, numId, sede, preferido) {
  if (preferido && txt(preferido.numId) === txt(numId) && (!sede || txt(preferido.sede?.codigo) === txt(sede))) return preferido;
  const f = { empresa: empresaId, numId: txt(numId), ...(tipoId ? { tipoId } : {}), ...(sede ? { 'sede.codigo': txt(sede) } : {}) };
  const l = await Tercero.find(f).lean();
  l.sort((a, b) => (Number(a.sede?.codigo) || 0) - (Number(b.sede?.codigo) || 0));
  return l[0] || null;
}

// Reúne los datos del manifiesto de un viaje de la empresa.
export async function datosManifiesto(empresa, viajeId) {
  const { v, vehiculo } = await cargarViaje(empresa._id, viajeId);
  if (v.manifiesto?.estado !== 'aceptado' && v.estado !== 'cumplido') throw new ErrorHttp(409, 'El viaje no tiene un manifiesto aceptado por el RNDC');
  // Lo enviado y aceptado; si no hay registro del envío (viajes importados), se recalcula igual que al enviar
  const ctx = contextoViaje(empresa, v, vehiculo);
  const R = (await enviadas(empresa._id, v._id, 3)) || Object.fromEntries(variablesRemesa(empresa, v, ctx, v.remesa?.numero || ''));
  const M = (await enviadas(empresa._id, v._id, 4)) || Object.fromEntries(variablesManifiesto(empresa, v, ctx, v.manifiesto?.numero || ''));
  const placa = txt(M.NUMPLACA) || v.placa;
  const veh = placa === v.placa ? vehiculo : await Vehiculo.findOne({ empresa: empresa._id, placa }).lean();
  const remolquePlaca = txt(M.NUMPLACAREMOLQUE);
  const rem = remolquePlaca ? await Vehiculo.findOne({ empresa: empresa._id, placa: remolquePlaca }).lean() : null;
  const titular = await tercero(empresa._id, M.CODIDTITULARMANIFIESTO, M.NUMIDTITULARMANIFIESTO, '', v.titular || v.conductor);
  const conductor = await tercero(empresa._id, M.CODIDCONDUCTOR, M.NUMIDCONDUCTOR, '', v.conductor);
  const remitente = await tercero(empresa._id, R.CODTIPOIDREMITENTE, R.NUMIDREMITENTE, R.CODSEDEREMITENTE);
  const destinatario = await tercero(empresa._id, R.CODTIPOIDDESTINATARIO, R.NUMIDDESTINATARIO, R.CODSEDEDESTINATARIO);

  const n = (x) => Number(txt(x).replace(',', '.')) || 0;
  const flete = n(M.VALORFLETEPACTADOVIAJE);
  const rete = n(M.RETENCIONFUENTEMANIFIESTO);
  const ica = Math.round(flete * n(M.RETENCIONICAMANIFIESTOCARGA) / 1000);
  const fopat = n(M.RETENCIONFOPAT);
  const neto = flete - rete - ica - fopat;
  const anticipo = n(M.VALORANTICIPOMANIFIESTO);
  const origen = await lugar(M.CODMUNICIPIOORIGENMANIFIESTO);
  const destino = await lugar(M.CODMUNICIPIODESTINOMANIFIESTO);
  const tel = (x) => soloDigitos(x) || '0';
  const lic = conductor?.licencia || {};
  return {
    empresa: txt(empresa.rndc?.razonSocial) || sinTildes(empresa.nombre), empNit: `${empresa.nit}${empresa.dv || ''}`,
    empDir: txt(empresa.direccion), empTel: txt(empresa.telefono), empCiudad: await lugarPorNombre(empresa.ciudad),
    numero: v.manifiesto.numero, radicado: v.manifiesto.radicado, seguro: v.manifiesto.qr, qrObs: v.manifiesto.qrObs,
    fechaRad: radicacionRndc(v.manifiesto.fecha), fechaExp: fechaRndc(M.FECHAEXPEDICIONMANIFIESTO || v.fecha),
    tipo: M.CODOPERACIONTRANSPORTE === 'U' ? 'Viaje Municipal o Urbano' : 'General',
    origen, destino,
    titular: nombre(titular), titDoc: txt(M.NUMIDTITULARMANIFIESTO), titDir: txt(titular?.direccion), titTel: tel(titular?.telefono),
    titCiudad: await lugar(titular?.codMunicipio),
    placa, marca: sinTildes(veh?.marcaNombre || veh?.marca || ''), remolque: remolquePlaca,
    config: txt(veh?.configuracionNombre || veh?.configuracion), pesoVacio: txt(veh?.pesoVacio ?? ''),
    pesoVacioRemolque: txt(rem?.pesoVacio ?? 0) || '0',
    soatAseg: aseguradora(veh), soatNum: txt(veh?.soat?.numero), soatVence: fechaRndc(veh?.soat?.vence),
    condNom: nombre(conductor), condDoc: txt(M.NUMIDCONDUCTOR), condDir: txt(conductor?.direccion),
    condTel: `${tel(conductor?.telefono)} ${tel(conductor?.celular)}`,
    condLic: lic.numero ? `${txt(lic.categoria)}-${txt(lic.numero)}` : '', condCiudad: await lugar(conductor?.codMunicipio),
    remesa: txt(R.CONSECUTIVOREMESA) || v.remesa?.numero || '', unidad: UNIDAD_RNDC[R.UNIDADMEDIDACAPACIDAD] || 'Kilogramos',
    cantidad: n(R.CANTIDADCARGADA), naturaleza: NATURALEZA_RNDC[R.CODNATURALEZACARGA] || '',
    empaque: EMPAQUE_RNDC[R.CODTIPOEMPAQUE] ?? txt(R.CODTIPOEMPAQUE),
    mercanciaCod: txt(R.MERCANCIAREMESA), mercancia: txt(R.DESCRIPCIONCORTAPRODUCTO),
    remNit: txt(R.NUMIDREMITENTE), remNom: nombre(remitente) || sinTildes(v.cliente?.razonSocial || v.cliente?.nombre || ''),
    remDir: txt(remitente?.direccion), remLugar: (await lugar(remitente?.codMunicipio)) || origen,
    desNit: txt(R.NUMIDDESTINATARIO), desNom: nombre(destinatario), desDir: txt(destinatario?.direccion),
    desLugar: (await lugar(destinatario?.codMunicipio)) || destino,
    dueno: DUENO_POLIZA_RNDC[R.DUENOPOLIZA] || DUENO_POLIZA_RNDC.E,
    flete, rete, ica, fopat, neto, anticipo, saldo: neto - anticipo,
    lugarPago: await lugar(M.CODMUNICIPIOPAGOSALDO), fechaPago: fechaRndc(M.FECHAPAGOSALDOMANIFIESTO),
    carguePor: RESPONSABLE_RNDC[M.CODRESPONSABLEPAGOCARGUE] || '', descarguePor: RESPONSABLE_RNDC[M.CODRESPONSABLEPAGODESCARGUE] || '',
    observaciones: txt(M.OBSERVACIONES),
  };
}

// ── Dibujo ──────────────────────────────────────────────────────────────────
// Campos: x (izquierda, centro o derecha según alin), y = línea base, tamaño en puntos.
// Con ancho, el texto se parte en palabras como FastReport y se recorta a las líneas indicadas.
const C = {
  empresa: { x: 348.7, y: 60.16, tam: 10, negrita: true, alin: 'centro', max: 270 },
  nit: { x: 352.8, y: 84.91, tam: 8, negrita: true, alin: 'centro', max: 260 },
  dir: { x: 346.2, y: 98.61, tam: 8, alin: 'centro', max: 260 },
  tel: { x: 348.4, y: 113.61, tam: 8, alin: 'centro', max: 260 },
  manifiesto: { x: 495.4, y: 97.14, tam: 11, negrita: true, max: 185 },
  autorizacion: { x: 495.4, y: 121.11, tam: 12, negrita: true, max: 185 },
  radicacion: { x: 120.4, y: 122.38, tam: 9, max: 95 },
  expedicion: { x: 33.7, y: 149.08, tam: 9, max: 85 },
  tipo: { x: 158, y: 146.53, tam: 7, alin: 'centro', ancho: 82, lineas: 2, paso: 8 },
  origen: { x: 207, y: 149.08, tam: 9, ancho: 168 },
  destino: { x: 513.2, y: 149.78, tam: 9, ancho: 168 },
  titular: { x: 119.5, y: 227.29, tam: 10, alin: 'centro', ancho: 178 },
  titDoc: { x: 265, y: 227.29, tam: 10, alin: 'centro', max: 100 },
  titDir: { x: 415, y: 225.51, tam: 8, alin: 'centro', ancho: 132, lineas: 2, paso: 10 },
  titTel: { x: 538, y: 227.29, tam: 10, alin: 'centro', max: 70 },
  titCiudad: { x: 628.5, y: 227.29, tam: 10, alin: 'centro', ancho: 110 },
  placa: { x: 62.5, y: 254.06, tam: 10, alin: 'centro', max: 60 },
  marca: { x: 99.7, y: 253.26, tam: 10, ancho: 72, cortar: true },
  remolque: { x: 193, y: 253.26, tam: 10, max: 80 },
  config: { x: 353, y: 253.26, tam: 10, alin: 'centro', max: 60 },
  pesoVacio: { x: 412, y: 253.26, tam: 10, alin: 'centro', max: 55 },
  pesoVacioRemolque: { x: 473, y: 253.26, tam: 10, alin: 'centro', max: 55 },
  soatAseg: { x: 511, y: 251.51, tam: 8, ancho: 172 },
  soatNum: { x: 689.3, y: 247.6, tam: 7, max: 42, lineas: 2, paso: 7, partir: true },
  soatVence: { x: 733.8, y: 253.26, tam: 10, max: 58 },
  condNom: { x: 34.9, y: 278.86, tam: 10, ancho: 175 },
  condDoc: { x: 217.3, y: 278.86, tam: 10, max: 105 },
  condDir: { x: 328.7, y: 275.51, tam: 8, ancho: 178, lineas: 2, paso: 10 },
  condTel: { x: 512.7, y: 274.53, tam: 7, ancho: 78 },
  condLic: { x: 594.5, y: 277.11, tam: 8, max: 68 },
  condCiudad: { x: 665.5, y: 278.86, tam: 10, ancho: 128 },
  remesa: { x: 31.1, y: 345.33, tam: 7, max: 58 },
  unidad: { x: 91.4, y: 345.33, tam: 7, max: 46 },
  cantidad: { x: 158.75, y: 345.33, tam: 7, alin: 'centro', max: 40 },
  naturaleza: { x: 181.5, y: 345.33, tam: 7, ancho: 52 },
  empaque: { x: 237.6, y: 345.33, tam: 7, ancho: 48 },
  mercanciaCod: { x: 288.1, y: 345.33, tam: 7, max: 78 },
  mercancia: { x: 238, y: 358.53, tam: 7, ancho: 128, lineas: 3, paso: 8.4 },
  remNit: { x: 374.1, y: 345.33, tam: 7, max: 43 },
  remNom: { x: 419, y: 345.43, tam: 7, ancho: 122, lineas: 2, paso: 8.3 },
  remDir: { x: 374.1, y: 361.83, tam: 7, ancho: 168 },
  remLugar: { x: 374.1, y: 374.33, tam: 7, ancho: 168 },
  desNit: { x: 547.5, y: 345.33, tam: 7, max: 45 },
  desNom: { x: 595.3, y: 345.33, tam: 7, ancho: 125, lineas: 2, paso: 8.3 },
  desDir: { x: 547.9, y: 361.83, tam: 7, ancho: 172 },
  desLugar: { x: 548.4, y: 373.93, tam: 7, ancho: 172 },
  dueno: { x: 725.3, y: 344.36, tam: 6, ancho: 68, lineas: 2, paso: 7 },
  flete: { x: 260.4, y: 402.23, tam: 7, alin: 'der', max: 80 },
  rete: { x: 260.4, y: 416.43, tam: 7, alin: 'der', max: 80 },
  ica: { x: 260.4, y: 429.83, tam: 7, alin: 'der', max: 80 },
  fopat: { x: 260.4, y: 444.03, tam: 7, alin: 'der', max: 80 },
  neto: { x: 260.4, y: 457.43, tam: 7, alin: 'der', max: 80 },
  anticipo: { x: 260.4, y: 469.43, tam: 7, alin: 'der', max: 80 },
  saldo: { x: 260.4, y: 482.63, tam: 7, alin: 'der', max: 80 },
  lugarPago: { x: 327.3, y: 404.33, tam: 7, ancho: 72 },
  fechaPago: { x: 437.7, y: 404.33, tam: 7, max: 52 },
  carguePor: { x: 389.15, y: 437.53, tam: 7, alin: 'centro', max: 105 },
  descarguePor: { x: 386.35, y: 466.93, tam: 7, alin: 'centro', max: 105 },
  letras: { x: 177.3, y: 499.06, tam: 6, ancho: 320 },
  observaciones: { x: 500, y: 407.3, tam: 8, ancho: 290, lineas: 9, paso: 9.5 },
};

// Parte el texto en líneas que caben en `ancho` (palabras completas; una palabra muy larga se corta)
function lineas(doc, texto, ancho, cortar) {
  const cabe = (s) => doc.widthOfString(s) <= ancho;
  const ajustar = (s) => { while (s && !cabe(s)) s = s.slice(0, -1); return s; };
  if (cortar) return [ajustar(texto)];
  const res = [];
  let actual = '';
  for (const p of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (cabe(prueba)) { actual = prueba; continue; }
    if (actual) res.push(actual);
    actual = cabe(p) ? p : ajustar(p);
  }
  if (actual) res.push(actual);
  return res;
}

// Ningún texto invade el recuadro vecino: si no cabe, se reduce la letra (hasta 5 pt) y,
// si aún no cabe, se parte en las líneas permitidas; solo en último caso se recorta.
function campo(doc, def, valor) {
  const texto = txt(valor);
  if (!texto) return;
  doc.font(def.negrita ? 'Helvetica-Bold' : 'Helvetica').fillColor('black');
  const limite = def.ancho || def.max;
  const maxLineas = def.lineas || 1;
  let tam = def.tam;
  let filas = [texto];
  if (limite) {
    const MIN = Math.min(5, def.tam);
    for (;;) {
      doc.fontSize(tam);
      filas = def.partir ? partirEnTrozos(doc, texto, limite) : def.cortar || maxLineas === 1 ? [texto] : lineasEnteras(doc, texto, limite);
      const cabe = filas.length <= maxLineas && filas.every(f => doc.widthOfString(f) <= limite);
      if (cabe || tam <= MIN) break;
      tam = Math.max(MIN, tam - 0.5);
    }
    const cabe = filas.length <= maxLineas && filas.every(f => doc.widthOfString(f) <= limite);
    if (!cabe) filas = def.partir && maxLineas > 1 ? partirEnTrozos(doc, texto, limite).slice(0, maxLineas) : lineas(doc, texto, limite, def.cortar).slice(0, maxLineas);
  } else doc.fontSize(tam);
  const paso = (def.paso || 0) * (tam / def.tam);
  filas.forEach((t, i) => {
    const w = doc.widthOfString(t);
    const x = def.alin === 'centro' ? def.x - w / 2 : def.alin === 'der' ? def.x - w : def.x;
    doc.text(t, x, def.y + i * paso, { lineBreak: false, baseline: 'alphabetic' });
  });
}
// Palabras completas por línea (sin recortar): sirve para medir si el texto cabe
function lineasEnteras(doc, texto, ancho) {
  const res = []; let actual = '';
  for (const p of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (!actual || doc.widthOfString(prueba) <= ancho) { actual = prueba; continue; }
    res.push(actual); actual = p;
  }
  if (actual) res.push(actual);
  return res;
}
// Un número largo sin espacios (p. ej. la póliza SOAT) en trozos que caben en el ancho
function partirEnTrozos(doc, texto, ancho) {
  const res = []; let actual = '';
  for (const c of texto) { if (actual && doc.widthOfString(actual + c) > ancho) { res.push(actual); actual = ''; } actual += c; }
  if (actual) res.push(actual);
  return res;
}

// Imagen PNG/JPEG guardada como data URL → Buffer (vacío si no es válida)
export function imagenDeDataUrl(u) {
  const m = String(u || '').match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
  return m ? Buffer.from(m[2], 'base64') : null;
}

// Límites para mover el logo del soporte interno: no sale del encabezado ni tapa el título
export const LIMITES_LOGO = { dx: [-15, 150], dy: [-15, 45], escala: [0.5, 1.8] };
const limitar = (v, [a, b], def) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : def);
export function ajusteLogo(a) {
  return { dx: limitar(a?.dx, LIMITES_LOGO.dx, 0), dy: limitar(a?.dy, LIMITES_LOGO.dy, 0), escala: limitar(a?.escala, LIMITES_LOGO.escala, 1) };
}

export async function manifiestoPdf(d) {
  const [ancho, alto] = PLANTILLA.pagina;
  const doc = new PDFDocument({ size: [ancho, alto], margin: 0, info: { Title: `Manifiesto ${d.numero}` } });
  // Fondos grises del formato oficial
  for (const x of PLANTILLA.dibujos) if (x.t === 'r' && x.relleno) doc.rect(x.x, x.y, x.w, x.h).fillColor(x.relleno).fill();
  // Soporte interno: el logo de la empresa va debajo de líneas y textos (se puede mover y escalar con límites)
  const im0 = PLANTILLA.imagenes;
  let logoDibujado = false;
  if (d.interno) {
    const logo = imagenDeDataUrl(d.logoEmpresa);
    if (logo) {
      const a = ajusteLogo(d.logoAjuste);
      const w = 94 * a.escala; const h = 84 * a.escala;
      try { doc.image(logo, im0.transporte[0] + a.dx, im0.transporte[1] + a.dy, { fit: [w, h], align: 'center', valign: 'center' }); logoDibujado = true; } catch { /* imagen inválida: va el nombre */ }
    }
  }
  // Cajas y líneas
  for (const x of PLANTILLA.dibujos) {
    if (x.t === 'r') { if (x.trazo) doc.rect(x.x, x.y, x.w, x.h).lineWidth(x.grosor).strokeColor(x.trazo).stroke(); }
    else doc.moveTo(x.x1, x.y1).lineTo(x.x2, x.y2).lineWidth(x.grosor).strokeColor(x.trazo).stroke();
  }
  // Soporte interno: sin logos ni leyendas del Ministerio; lleva el logo y el nombre de la empresa que lo expide
  const interno = !!d.interno;
  const leyendaRndc = (t) => (t.x > 480 && t.y < 90) || (t.x < 40 && t.y > 510);
  for (const t of PLANTILLA.textos) {
    if (interno && leyendaRndc(t)) continue;
    const texto = interno && t.texto === 'MANIFIESTO ELECTRONICO DE CARGA' ? 'SOPORTE INTERNO DE CARGA' : t.texto;
    doc.font(t.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(t.tam).fillColor(t.color || 'black')
      .text(texto, t.x, t.y, { lineBreak: false, baseline: 'alphabetic' });
  }
  const im = PLANTILLA.imagenes;
  if (interno) {
    // Zona de los dos logos oficiales (arriba a la izquierda)
    const [x, y] = [im.transporte[0], im.transporte[1]];
    // Sin tocar el recuadro «Fecha hora radicación» (empieza en x≈128, y≈118)
    const w = Math.min(Math.max(im.transporte[2], im.supertransporte[2]), 94); const h = 84;
    if (!logoDibujado) campo(doc, { x: x + w / 2, y: y + h / 2, tam: 9, alin: 'centro', ancho: w, lineas: 3, paso: 11 }, d.empresa);
    doc.font('Helvetica').fontSize(6).fillColor('black');
    ['Soporte interno de la empresa transportadora para viajes', 'que no se expiden en el RNDC. No es un documento del', 'Ministerio de Transporte.',
      'Compruebe que existe y es válido escaneando el código QR.'].forEach((l, i) => doc.text(l, 490.96, 36.65 + i * 7.5, { lineBreak: false, baseline: 'alphabetic' }));
    doc.text('Documento interno de la empresa transportadora.', 31.14, 519.4, { lineBreak: false, baseline: 'alphabetic' });
    doc.text('Verifique su validez escaneando el código QR del encabezado.', 31.14, 527.4, { lineBreak: false, baseline: 'alphabetic' });
  } else {
    doc.image(LOGO_TRANSPORTE, im.transporte[0], im.transporte[1], { width: im.transporte[2], height: im.transporte[3] });
    doc.image(LOGO_SUPERTRANSPORTE, im.supertransporte[0], im.supertransporte[1], { width: im.supertransporte[2], height: im.supertransporte[3] });
  }
  if (d.seguro && d.radicado) {
    // El soporte interno lleva su propio texto de QR (código interno), nunca el del RNDC
    const png = await QRCode.toBuffer(d.qrTexto || textoQR(d), { errorCorrectionLevel: 'L', margin: 0, scale: 6 });
    doc.image(png, im.qr[0], im.qr[1], { width: im.qr[2], height: im.qr[3] });
  } else {
    campo(doc, { x: im.qr[0] + im.qr[2] / 2, y: im.qr[1] + im.qr[3] / 2, tam: 7, alin: 'centro', ancho: im.qr[2] - 6, lineas: 3, paso: 8 },
      'SIN CÓDIGO QR: el RNDC no entregó el código de seguridad');
  }

  const v = { ...d, nit: `Nit: ${d.empNit}`, dir: d.empDir ? `   ${d.empDir}` : '',
    tel: `Tel:  ${d.empTel}  ${d.empCiudad}`, manifiesto: `${interno ? 'Soporte     ' : 'Manifiesto  '}: ${d.numero}`, autorizacion: `${interno ? 'Código' : 'Autorización'}:  ${d.radicado}`,
    radicacion: d.fechaRad, expedicion: d.fechaExp, cantidad: fmtMilManifiesto(d.cantidad), letras: numeroALetras(d.flete) };
  for (const k of ['flete', 'rete', 'ica', 'fopat', 'neto', 'anticipo', 'saldo']) v[k] = fmtMilManifiesto(d[k]);
  for (const [k, def] of Object.entries(C)) campo(doc, def, v[k]);
  // Los manifiestos no llevan marca de agua: el del RNDC sale sin marca y el soporte interno solo con la línea al pie
  return pdfABuffer(doc, { marca: interno ? 'pie' : false });
}

export const nombreArchivo = (d) => `Manifiesto_${txt(d.numero) || 'sin_numero'}.pdf`;
