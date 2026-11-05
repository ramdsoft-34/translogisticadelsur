// Fase 8: motor de auto-llenado de formatos con los datos y el membrete de la empresa activa.
//
//  1. contexto(empresa) arma los datos fijos: razón social, NIT con DV, representante legal, responsable del
//     SG-SST, ARL, clase de riesgo, fecha de hoy… Son los mismos para el PDF, el Word y el Excel.
//  2. Los formatos propios en Word o Excel llevan marcadores {{empresa.razonSocial}}, {{empresa.nitCompleto}},
//     {{fecha.larga}}… que se cambian por esos datos (llenarDocx, llenarXlsx). Word suele partir un marcador en
//     varios fragmentos de texto: se reemplaza sobre el texto completo del párrafo y se respeta el formato del
//     primer fragmento.
//  3. Si la empresa subió su membrete (franja de encabezado y de pie), el Word sale con ese encabezado y pie, y
//     el PDF de los formatos de la plataforma lo dibuja arriba y abajo de cada página. Sin membrete, el PDF usa
//     el encabezado clásico del SG-SST: logo | razón social y título | código, versión, fecha y página.
//  4. plantillaDesdeDocumento convierte un formato ya diligenciado de la empresa (por ejemplo un acta en Word
//     con la razón social y el NIT escritos) en plantilla: busca esos datos y pone los marcadores.
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { txt, MESES, fmtFecha } from '../../utils/texto.js';
import { pdfABuffer } from '../reportes/comun.js';

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];
const NIVEL_PESV = { basico: 'Básico', estandar: 'Estándar', avanzado: 'Avanzado' };
const dd = (n) => String(n).padStart(2, '0');

export function nitConPuntos(nit) {
  const d = String(nit || '').replace(/\D/g, '');
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Fecha de hoy en Colombia (UTC−5) en las formas que piden los formatos
export function fechas(hoy = new Date()) {
  const c = new Date(hoy.getTime() - 5 * 3600e3);
  const d = c.getUTCDate(); const m = c.getUTCMonth(); const a = c.getUTCFullYear();
  return { hoy: `${dd(d)}/${dd(m + 1)}/${a}`, iso: `${a}-${dd(m + 1)}-${dd(d)}`, larga: `${d} de ${MESES[m]} de ${a}`, anio: String(a), mes: MESES[m], dia: String(d) };
}

// Datos que se inyectan en cualquier formato. `empresa` es el documento de la base (lean).
export function contexto(empresa = {}, { usuario = null, formato = null, numVehiculos = null, hoy = new Date(), extras = {} } = {}) {
  const s = empresa.sst || {};
  const nit = String(empresa.nit || '').replace(/\D/g, '');
  const f = fechas(hoy);
  const razonSocial = txt(empresa.rndc?.razonSocial) || txt(empresa.nombre);
  const ciudad = txt(empresa.ciudad);
  const ctx = {
    empresa: {
      razonSocial, nombre: txt(empresa.nombre), nit: nitConPuntos(nit), nitSinPuntos: nit, dv: txt(empresa.dv),
      nitCompleto: `${nitConPuntos(nit)}${empresa.dv ? `-${empresa.dv}` : ''}`,
      direccion: txt(empresa.direccion), ciudad, telefono: txt(empresa.telefono), correo: txt(empresa.correo),
      representanteLegal: txt(s.representanteLegal), documentoRepresentante: txt(s.documentoRepresentante),
      responsableSst: txt(s.responsableSst), licenciaSst: txt(s.licenciaSst), liderPesv: txt(s.liderPesv),
      arl: txt(s.arl), claseRiesgo: ROMANOS[s.claseRiesgo] || '', actividad: txt(s.actividad),
      numTrabajadores: s.numTrabajadores ? String(s.numTrabajadores) : '', numVehiculos: numVehiculos == null ? '' : String(numVehiculos),
      nivelPesv: NIVEL_PESV[s.nivelPesv] || '',
    },
    fecha: { ...f, ciudadFecha: `${ciudad ? `${ciudad}, ` : ''}${f.larga}` },
    usuario: { nombre: txt(usuario?.nombre), correo: txt(usuario?.email) },
    formato: { codigo: txt(formato?.codigo), version: formato?.version ? String(formato.version) : '', titulo: txt(formato?.titulo || formato?.nombre),
      consecutivo: formato?.consecutivo ? String(formato.consecutivo) : '' },
    ...extras,
  };
  return ctx;
}

// Lista de marcadores disponibles (para la ayuda de la pantalla y para avisar marcadores mal escritos)
export const MARCADORES = [
  ['empresa.razonSocial', 'Razón social'], ['empresa.nitCompleto', 'NIT con DV (900.109.959-2)'], ['empresa.nit', 'NIT sin DV con puntos'],
  ['empresa.dv', 'Dígito de verificación'], ['empresa.direccion', 'Dirección'], ['empresa.ciudad', 'Ciudad'], ['empresa.telefono', 'Teléfono'],
  ['empresa.correo', 'Correo'], ['empresa.representanteLegal', 'Representante legal'], ['empresa.documentoRepresentante', 'Documento del representante'],
  ['empresa.responsableSst', 'Responsable del SG-SST'], ['empresa.licenciaSst', 'Licencia en SST del responsable'], ['empresa.liderPesv', 'Líder del PESV'],
  ['empresa.arl', 'ARL'], ['empresa.claseRiesgo', 'Clase de riesgo (I a V)'], ['empresa.actividad', 'Actividad económica'],
  ['empresa.numTrabajadores', 'Número de trabajadores'], ['empresa.numVehiculos', 'Número de vehículos'], ['empresa.nivelPesv', 'Nivel del PESV'],
  ['fecha.hoy', 'Fecha dd/mm/aaaa'], ['fecha.larga', 'Fecha en letras (4 de noviembre de 2026)'], ['fecha.ciudadFecha', 'Ciudad y fecha'],
  ['fecha.anio', 'Año'], ['usuario.nombre', 'Quien genera el documento'],
  ['formato.codigo', 'Código del formato'], ['formato.version', 'Versión'], ['formato.consecutivo', 'Consecutivo'],
];

const RE_MARCADOR = /\{\{\s*([A-Za-z][\w]*(?:\.[\w]+)*)\s*\}\}/g;
const valorDe = (ctx, ruta) => ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);

// Reemplaza {{ruta}} en un texto. Los marcadores sin dato quedan vacíos y se informan en `faltantes`.
export function reemplazar(texto, ctx, faltantes = new Set()) {
  return String(texto).replace(RE_MARCADOR, (_m, ruta) => {
    const v = valorDe(ctx, ruta);
    if (v === undefined || v === null || v === '' || typeof v === 'object') { faltantes.add(ruta); return ''; }
    return String(v);
  });
}
export const marcadoresEn = (texto) => [...String(texto).matchAll(RE_MARCADOR)].map(m => m[1]);

// ── Word (DOCX) ─────────────────────────────────────────────────────────────
const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const desXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const RE_PARRAFO = /<w:p[ >][\s\S]*?<\/w:p>/g;
const RE_TEXTO = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g;

// Aplica `cambiar(textoCompletoDelParrafo)` → [{ desde, hasta, nuevo }] sobre los fragmentos <w:t> de cada párrafo,
// aunque Word haya partido el texto en varios fragmentos con distinto formato.
function editarParrafos(xml, buscar) {
  return xml.replace(RE_PARRAFO, (p) => {
    const nodos = [];
    let completo = '';
    for (const m of p.matchAll(RE_TEXTO)) {
      const t = desXml(m[1] || '');
      nodos.push({ ini: m.index, fin: m.index + m[0].length, desde: completo.length, texto: t });
      completo += t;
    }
    if (!nodos.length) return p;
    const cambios = buscar(completo).sort((a, b) => b.desde - a.desde);
    if (!cambios.length) return p;
    const textos = nodos.map(n => n.texto);
    for (const c of cambios) {
      const i = nodos.findIndex(n => c.desde >= n.desde && c.desde < n.desde + n.texto.length);
      const j = nodos.findIndex(n => c.hasta - 1 >= n.desde && c.hasta - 1 < n.desde + n.texto.length);
      if (i < 0 || j < 0) continue;
      const ni = nodos.at(i); const nj = nodos.at(j);
      const antes = textos.at(i).slice(0, c.desde - ni.desde);
      const despues = textos.at(j).slice(c.hasta - nj.desde);
      if (i === j) textos.splice(i, 1, antes + c.nuevo + despues);
      else {
        textos.splice(i, 1, antes + c.nuevo);
        for (let k = i + 1; k < j; k += 1) textos.splice(k, 1, '');
        textos.splice(j, 1, despues);
      }
    }
    let res = ''; let pos = 0;
    nodos.forEach((n, k) => { res += p.slice(pos, n.ini) + `<w:t xml:space="preserve">${escXml(textos.at(k))}</w:t>`; pos = n.fin; });
    return res + p.slice(pos);
  });
}

const partesTexto = (zip) => Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));

export async function marcadoresDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const vistos = new Set();
  for (const n of partesTexto(zip)) {
    const xml = await zip.file(n).async('string');
    editarParrafos(xml, (t) => { marcadoresEn(t).forEach(m => vistos.add(m)); return []; });
  }
  return [...vistos];
}

// Llena un Word con los datos y, si se da `membrete` con imágenes, le pone el encabezado y el pie de la empresa.
export async function llenarDocx(buffer, ctx, { membrete = null } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const faltantes = new Set();
  for (const n of partesTexto(zip)) {
    const xml = await zip.file(n).async('string');
    zip.file(n, editarParrafos(xml, (t) => [...t.matchAll(RE_MARCADOR)].map(m => ({ desde: m.index, hasta: m.index + m[0].length, nuevo: reemplazar(m[0], ctx, faltantes) }))));
  }
  if (membrete?.encabezado || membrete?.pie) await ponerMembreteDocx(zip, membrete);
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), faltantes: [...faltantes] };
}

// Convierte un formato ya diligenciado en plantilla: cambia los datos de la empresa escritos por sus marcadores.
// `equivalencias` agrega pares propios [{ texto, marcador }] (por ejemplo un NIT mal escrito en el formato viejo).
export function equivalenciasEmpresa(ctx) {
  const e = ctx.empresa; const lista = [];
  const add = (texto, marcador) => { if (txt(texto).length >= 4) lista.push({ texto: txt(texto), marcador }); };
  add(e.razonSocial, 'empresa.razonSocial');
  if (e.nombre !== e.razonSocial) add(e.nombre, 'empresa.razonSocial');
  // «COOPERATIVA DE TRANSPORTES ESPAÑA - COOESPATRANS»: también cada parte por separado
  for (const parte of e.razonSocial.split(/\s+[-–—]\s+/)) if (parte !== e.razonSocial && parte.length >= 8) add(parte, 'empresa.razonSocial');
  add(e.ciudad, 'empresa.ciudad');
  if (e.dv) { add(`${e.nit}-${e.dv}`, 'empresa.nitCompleto'); add(`${e.nitSinPuntos}-${e.dv}`, 'empresa.nitCompleto'); add(`${e.nitSinPuntos}${e.dv}`, 'empresa.nitCompleto'); }
  add(e.nit, 'empresa.nit'); add(e.nitSinPuntos, 'empresa.nit');
  add(e.direccion, 'empresa.direccion'); add(e.telefono, 'empresa.telefono'); add(e.correo, 'empresa.correo');
  add(e.representanteLegal, 'empresa.representanteLegal'); add(e.responsableSst, 'empresa.responsableSst');
  return lista.sort((a, b) => b.texto.length - a.texto.length);   // primero lo más largo (NIT con DV antes que sin DV)
}

export async function plantillaDesdeDocumento(buffer, ctx, equivalencias = []) {
  const pares = [...equivalencias.filter(p => txt(p.texto) && txt(p.marcador)), ...equivalenciasEmpresa(ctx)];
  const zip = await JSZip.loadAsync(buffer);
  const cuenta = new Map();
  for (const n of partesTexto(zip)) {
    const xml = await zip.file(n).async('string');
    zip.file(n, editarParrafos(xml, (t) => {
      const usados = []; const cambios = [];
      const bajo = t.toLowerCase();   // sin distinguir mayúsculas (los formatos viejos escriben la razón social de varias formas)
      for (const { texto, marcador } of pares) {
        const buscado = texto.toLowerCase();
        if (buscado.length !== texto.length || bajo.length !== t.length) continue;
        let i = bajo.indexOf(buscado);
        while (i >= 0) {
          const f = i + texto.length;
          if (!usados.some(([a, b]) => i < b && f > a)) {
            usados.push([i, f]); cambios.push({ desde: i, hasta: f, nuevo: `{{${marcador}}}` });
            cuenta.set(`${texto}→${marcador}`, (cuenta.get(`${texto}→${marcador}`) || 0) + 1);
          }
          i = bajo.indexOf(buscado, f);
        }
      }
      return cambios;
    }));
  }
  const cambios = [...cuenta].map(([k, veces]) => { const [texto, marcador] = k.split('→'); return { texto, marcador, veces }; });
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), cambios };
}

// Tamaño de una imagen PNG o JPEG (para mantener la proporción)
export function tamanoImagen(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20), ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marca = buf[i + 1]; const largo = buf.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) return { ancho: buf.readUInt16BE(i + 7), alto: buf.readUInt16BE(i + 5), ext: 'jpeg' };
      i += 2 + largo;
    }
  }
  return null;
}
export function imagenDeDataUrl(u) {
  const m = String(u || '').match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
  return m ? Buffer.from(m[2], 'base64') : null;
}

const NS_PARTE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
function parrafoImagen(rid, cx, cy, id, nombre) {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${nombre}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// Cambia el encabezado y el pie de todas las secciones del Word por las franjas del membrete.
async function ponerMembreteDocx(zip, membrete) {
  const doc = await zip.file('word/document.xml').async('string');
  const relsNombre = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relsNombre).async('string');
  let tipos = await zip.file('[Content_Types].xml').async('string');
  // Ancho útil de la página (en EMU) desde la primera sección: ancho − márgenes
  const pg = doc.match(/<w:pgSz[^>]*w:w="(\d+)"/); const izq = doc.match(/<w:pgMar[^>]*w:left="(\d+)"/); const der = doc.match(/<w:pgMar[^>]*w:right="(\d+)"/);
  const util = ((pg ? Number(pg[1]) : 12240) - (izq ? Number(izq[1]) : 1440) - (der ? Number(der[1]) : 1440)) * 635;
  const partes = {};
  let n = 0;
  for (const [clave, dataUrl] of [['header', membrete.encabezado], ['footer', membrete.pie]]) {
    const img = imagenDeDataUrl(dataUrl);
    const t = img && tamanoImagen(img);
    if (!t) continue;
    n += 1;
    const media = `media/membrete_${clave}.${t.ext === 'png' ? 'png' : 'jpeg'}`;
    zip.file(`word/${media}`, img);
    const parte = `${clave}_membrete.xml`;
    const cy = Math.round(util * (t.alto / t.ancho));
    const raiz = clave === 'header' ? 'hdr' : 'ftr';
    zip.file(`word/${parte}`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${raiz} ${NS_PARTE}>${parrafoImagen('rIdImg1', util, cy, 900 + n, `Membrete ${clave}`)}</w:${raiz}>`);
    zip.file(`word/_rels/${parte}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${media}"/></Relationships>`);
    const rid = `rIdMembrete${clave}`;
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${clave}" Target="${parte}"/></Relationships>`);
    const ct = clave === 'header' ? 'header' : 'footer';
    tipos = tipos.replace('</Types>', `<Override PartName="/word/${parte}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${ct}+xml"/></Types>`);
    if (!/Extension="png"/i.test(tipos) && t.ext === 'png') tipos = tipos.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    if (!/Extension="jpe?g"/i.test(tipos) && t.ext === 'jpeg') tipos = tipos.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
    partes[clave] = rid;
  }
  // Cada sección: quita sus encabezados/pies y pone los del membrete (default)
  const nuevo = doc.replace(/<w:sectPr(\s[^>]*)?>([\s\S]*?)<\/w:sectPr>/g, (_m, attrs = '', cuerpo) => {
    let c = cuerpo;
    if (partes.header) c = c.replace(/<w:headerReference[^>]*\/>/g, '');
    if (partes.footer) c = c.replace(/<w:footerReference[^>]*\/>/g, '');
    const refs = (partes.header ? `<w:headerReference w:type="default" r:id="${partes.header}"/>` : '') + (partes.footer ? `<w:footerReference w:type="default" r:id="${partes.footer}"/>` : '');
    c = c.replace(/<w:titlePg\/>/g, '');
    return `<w:sectPr${attrs || ''}>${refs}${c}</w:sectPr>`;
  });
  zip.file('word/document.xml', nuevo);
  zip.file(relsNombre, rels);
  zip.file('[Content_Types].xml', tipos);
}

// ── Excel (XLSX) ────────────────────────────────────────────────────────────
// Reemplaza marcadores en todas las celdas. Una celda con {{empresa.logo}} o {{membrete.encabezado}} recibe la imagen
// sobre su rango combinado (o 4 columnas × 3 filas si no está combinada).
export async function llenarXlsx(buffer, ctx, { logo = null, membrete = null } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const faltantes = new Set();
  const imagenes = { 'empresa.logo': imagenDeDataUrl(logo), 'membrete.encabezado': imagenDeDataUrl(membrete?.encabezado), 'membrete.pie': imagenDeDataUrl(membrete?.pie) };
  for (const ws of wb.worksheets) {
    const combinadas = (ws.model.merges || []).map(r => r);
    ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.formula) return;
      const v = cell.value;
      if (typeof v === 'string' && v.includes('{{')) {
        const img = Object.keys(imagenes).find(k => v.trim() === `{{${k}}}`);
        if (img) {
          cell.value = '';
          const buf = imagenes[img]; const t = buf && tamanoImagen(buf);
          if (t) {
            const id = wb.addImage({ buffer: buf, extension: t.ext });
            const rango = combinadas.find(m => { const [a] = m.split(':'); return a === cell.address; });
            if (rango) ws.addImage(id, rango);
            else ws.addImage(id, { tl: { col: cell.col - 1, row: cell.row - 1 }, ext: { width: 220, height: Math.round(220 * t.alto / t.ancho) } });
          }
          return;
        }
        cell.value = reemplazar(v, ctx, faltantes);
      } else if (v && Array.isArray(v.richText) && v.richText.some(r => r.text.includes('{{'))) {
        const unido = v.richText.map(r => r.text).join('');
        cell.value = { richText: [{ ...v.richText[0], text: reemplazar(unido, ctx, faltantes) }] };
      }
    }));
    // Encabezado y pie al imprimir, si la hoja no trae los suyos
    if (!ws.headerFooter?.oddHeader) {
      ws.headerFooter = { ...(ws.headerFooter || {}), oddHeader: `&L&8${ctx.empresa.razonSocial} · NIT ${ctx.empresa.nitCompleto}&R&8${ctx.formato.codigo || ''}`, oddFooter: '&C&8Página &P de &N' };
    }
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), faltantes: [...faltantes] };
}

// ── PDF de un formato de la plataforma (esquema del catálogo + datos diligenciados) ──
const GRIS = '#5a6474'; const BORDE = '#c6ccd5'; const SUAVE = '#f3f5f8';
const ETIQUETAS_OPCION = { bien: 'B', mal: 'M', na: 'NA', cumple: 'C', no_cumple: 'NC' };
const fmtValor = (c, v) => {
  if (v === undefined || v === null || v === '') return '';
  if (c.tipo === 'fecha' || c?.tipo === 'fecha') { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); }
  return String(v);
};

export async function pdfFormato({ plantilla: p, datos = {}, ctx, membrete = {}, logo = '', firmas = [] }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 36, bottom: 36, left: 36, right: 36 }, bufferPages: true, info: { Title: `${p.codigo} ${p.titulo}` } });
  const X = 36; const W = doc.page.width - 72;
  const primario = /^#[0-9a-f]{6}$/i.test(membrete.colorPrimario || '') ? membrete.colorPrimario : '#0d1117';
  const acento = /^#[0-9a-f]{6}$/i.test(membrete.colorSecundario || '') ? membrete.colorSecundario : '#f6b80f';
  const enc = imagenDeDataUrl(membrete.encabezado); const encT = enc && tamanoImagen(enc);
  const pie = imagenDeDataUrl(membrete.pie); const pieT = pie && tamanoImagen(pie);
  const logoBuf = imagenDeDataUrl(logo);
  const altoEnc = encT ? Math.min(110, W * encT.alto / encT.ancho) : 0;
  const altoPie = pieT ? Math.min(70, W * pieT.alto / pieT.ancho) : 0;
  const cabecera = (encT ? altoEnc + 8 : 0) + 62;     // franja + bloque de título/código
  const piePagina = (pieT ? altoPie + 6 : 0) + 22;
  const limite = () => doc.page.height - 36 - piePagina;
  const inicio = 36 + cabecera + 10;

  const dibujarCabecera = () => {
    let y = 36;
    if (encT) { try { doc.image(enc, X, y, { width: W, height: altoEnc }); } catch { /* imagen dañada: sigue sin franja */ } y += altoEnc + 8; }
    // Encabezado clásico del SG-SST: logo | empresa y título | código, versión, fecha y página
    const h = 58; const wLogo = encT ? 0 : 96; const wDer = 130;
    doc.lineWidth(0.8).strokeColor(BORDE).rect(X, y, W, h).stroke();
    if (wLogo) {
      doc.moveTo(X + wLogo, y).lineTo(X + wLogo, y + h).stroke();
      if (logoBuf) { try { doc.image(logoBuf, X + 6, y + 5, { fit: [wLogo - 12, h - 10], align: 'center', valign: 'center' }); } catch { /* imagen inválida */ } }
      else doc.font('Helvetica-Bold').fontSize(9).fillColor(primario).text(ctx.empresa.nombre || ctx.empresa.razonSocial, X + 4, y + h / 2 - 12, { width: wLogo - 8, align: 'center', height: 30, ellipsis: true });
    }
    doc.moveTo(X + W - wDer, y).lineTo(X + W - wDer, y + h).stroke();
    const xc = X + wLogo + 6; const wc = W - wLogo - wDer - 12;
    // La línea de la empresa nunca se parte: se reduce la letra hasta que quepa
    const linea = `${ctx.empresa.razonSocial} · NIT ${ctx.empresa.nitCompleto}`;
    let tam = 8.5; doc.font('Helvetica-Bold');
    while (tam > 5.5 && doc.fontSize(tam).widthOfString(linea) > wc) tam -= 0.25;
    doc.fontSize(tam).fillColor(GRIS).text(linea, xc, y + 8, { width: wc, align: 'center', height: tam + 2, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#0d1117').text(p.titulo.toUpperCase(), xc, y + 22, { width: wc, align: 'center', height: 30, ellipsis: true });
    const filas = [['Código', p.codigo], ['Versión', String(p.version || 1)], ['Fecha', ctx.fecha.hoy], ['Página', '']];
    filas.forEach(([k, v], i) => {
      const yy = y + i * (h / 4);
      if (i) doc.moveTo(X + W - wDer, yy).lineTo(X + W, yy).stroke();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS).text(k, X + W - wDer + 6, yy + 4, { lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor('#0d1117').text(v, X + W - wDer + 50, yy + 4, { width: wDer - 54, lineBreak: false, ellipsis: true });
    });
    doc.rect(X, y + h, W, 2.5).fill(acento);
    return { yPagina: y + 3 * (h / 4) + 4, xPagina: X + W - wDer + 50 };
  };
  const dibujarPie = () => {
    const yb = doc.page.height - 36 - piePagina;
    // Con franja de pie propia, el texto automático sobra (la franja ya trae la dirección)
    const texto = membrete.textoPie || (pieT ? '' : [ctx.empresa.direccion, ctx.empresa.ciudad, ctx.empresa.telefono, ctx.empresa.correo].filter(Boolean).join(' · '));
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(texto, X, yb + 6, { width: W, align: 'center', lineBreak: false, ellipsis: true });
    if (pieT) { try { doc.image(pie, X, yb + 22, { width: W, height: altoPie }); } catch { /* imagen dañada */ } }
  };

  let y = inicio;
  const nuevaPagina = () => { doc.addPage(); y = inicio; };
  const asegurar = (alto) => { if (y + alto > limite()) nuevaPagina(); };

  const tituloSeccion = (t) => {
    asegurar(40);
    doc.rect(X, y, W, 18).fill(primario);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(t.toUpperCase(), X + 8, y + 5, { width: W - 16, lineBreak: false });
    y += 24;
  };
  const casilla = (x, yy, marcada) => {
    doc.lineWidth(0.8).strokeColor('#434c5a').rect(x, yy, 9, 9).stroke();
    if (marcada) doc.moveTo(x + 2, yy + 4.8).lineTo(x + 3.8, yy + 7).lineTo(x + 7.4, yy + 2).lineWidth(1.4).strokeColor(primario).stroke();
  };
  const dibujarFirma = (img, x, yy, w, nombre, rol) => {
    const buf = imagenDeDataUrl(img);
    if (buf) { try { doc.image(buf, x + 4, yy, { fit: [w - 8, 38], align: 'center', valign: 'bottom' }); } catch { /* firma inválida */ } }
    doc.moveTo(x + 4, yy + 42).lineTo(x + w - 4, yy + 42).lineWidth(0.8).strokeColor('#434c5a').stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0d1117').text(nombre || ' ', x, yy + 45, { width: w, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(rol || '', x, yy + 55, { width: w, align: 'center', lineBreak: false, ellipsis: true });
  };

  for (const s of p.secciones) {
    tituloSeccion(s.titulo);
    // Campos simples en una rejilla de 4 columnas
    let col = 0; let filaAlto = 0;
    const simples = s.campos.filter(c => ['texto', 'fecha', 'hora', 'numero', 'seleccion'].includes(c.tipo));
    for (const c of simples) {
      const ancho = Math.min(4, c.ancho || 2);
      if (col + ancho > 4) { y += filaAlto + 6; col = 0; filaAlto = 0; }
      if (col === 0) asegurar(34);
      const x = X + (W / 4) * col; const w = (W / 4) * ancho - 6;
      doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(c.etiqueta.toUpperCase(), x, y, { width: w, lineBreak: false, ellipsis: true });
      const v = fmtValor(c, datos[c.id]);
      const alto = Math.max(16, doc.font('Helvetica').fontSize(9).heightOfString(v || ' ', { width: w - 8 }) + 6);
      doc.lineWidth(0.6).strokeColor(BORDE).rect(x, y + 9, w, alto).stroke();
      doc.fillColor('#0d1117').text(v, x + 4, y + 13, { width: w - 8 });
      filaAlto = Math.max(filaAlto, alto + 10); col += ancho;
    }
    if (simples.length) y += filaAlto + 8;
    for (const c of s.campos) {
      const v = datos[c.id];
      if (c.tipo === 'textoLargo') {
        const t = String(v || '');
        const alto = Math.max(34, doc.font('Helvetica').fontSize(9).heightOfString(t || ' ', { width: W - 8 }) + 8);
        asegurar(alto + 14);
        doc.font('Helvetica').fontSize(7).fillColor(GRIS).text(c.etiqueta.toUpperCase(), X, y);
        doc.lineWidth(0.6).strokeColor(BORDE).rect(X, y + 9, W, alto).stroke();
        doc.font('Helvetica').fontSize(9).fillColor('#0d1117').text(t, X + 4, y + 13, { width: W - 8 });
        y += alto + 16;
      } else if (c.tipo === 'casilla') {
        asegurar(16); casilla(X, y, !!v);
        doc.font('Helvetica').fontSize(9).fillColor('#0d1117').text(c.etiqueta, X + 15, y, { width: W - 15 });
        y += 16;
      } else if (c.tipo === 'verificacion') {
        const wOp = 26; const wNum = 20; const wObs = 150; const wItem = W - wNum - wOp * c.opciones.length - wObs;
        const cabezaTabla = () => {
          doc.rect(X, y, W, 16).fill(SUAVE);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0d1117');
          doc.text('N.°', X, y + 5, { width: wNum, align: 'center' }); doc.text('Ítem a verificar', X + wNum + 4, y + 5, { lineBreak: false });
          c.opciones.forEach((o, k) => doc.text(ETIQUETAS_OPCION[o] || o, X + wNum + wItem + k * wOp, y + 5, { width: wOp, align: 'center' }));
          doc.text('Observación', X + W - wObs + 4, y + 5, { lineBreak: false });
          y += 16;
        };
        asegurar(40); cabezaTabla();
        c.items.forEach((it, k) => {
          const r = v?.[it.codigo] || {};
          const alto = Math.max(15, doc.font('Helvetica').fontSize(8).heightOfString(it.texto, { width: wItem - 8 }) + 6,
            doc.fontSize(7.5).heightOfString(r.observacion || ' ', { width: wObs - 8 }) + 6);
          if (y + alto > limite()) { nuevaPagina(); cabezaTabla(); }
          doc.lineWidth(0.5).strokeColor(BORDE).moveTo(X, y + alto).lineTo(X + W, y + alto).stroke();
          doc.font('Helvetica').fontSize(8).fillColor('#0d1117').text(String(k + 1), X, y + 4, { width: wNum, align: 'center' });
          doc.text(it.texto + (it.critico ? ' *' : ''), X + wNum + 4, y + 3, { width: wItem - 8 });
          c.opciones.forEach((o, j) => casilla(X + wNum + wItem + j * wOp + (wOp - 9) / 2, y + (alto - 9) / 2, r.resultado === o));
          doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(r.observacion || '', X + W - wObs + 4, y + 3, { width: wObs - 8 });
          y += alto;
        });
        if (c.items.some(i => i.critico)) { doc.font('Helvetica').fontSize(7).fillColor(GRIS).text('* Ítem crítico: si está mal o no cumple, el vehículo no puede salir.', X, y + 3); y += 12; }
        y += 8;
      } else if (c.tipo === 'tabla') {
        const filas = Array.isArray(v) && v.length ? v : [{}, {}, {}];
        const conFirma = c.columnas.some(k => k.tipo === 'firma');
        const pesos = c.columnas.map(k => (k.tipo === 'firma' ? 1.3 : k.tipo === 'numero' ? 0.5 : k.tipo === 'fecha' ? 0.8 : 1.4));
        const total = pesos.reduce((a, b) => a + b, 0); const anchos = pesos.map(pz => W * pz / total);
        const cabezaTabla = () => {
          doc.rect(X, y, W, 16).fill(SUAVE); let x = X;
          c.columnas.forEach((k, i) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0d1117').text(k.etiqueta, x + 3, y + 5, { width: anchos.at(i) - 6, lineBreak: false, ellipsis: true }); x += anchos.at(i); });
          y += 16;
        };
        asegurar(40); cabezaTabla();
        for (const f of filas) {
          const alto = conFirma ? 30 : 16;
          if (y + alto > limite()) { nuevaPagina(); cabezaTabla(); }
          let x = X;
          c.columnas.forEach((k, i) => {
            const w = anchos.at(i);
            if (k.tipo === 'firma') { const b = imagenDeDataUrl(f[k.id]); if (b) { try { doc.image(b, x + 3, y + 2, { fit: [w - 6, alto - 4], align: 'center', valign: 'center' }); } catch { /* */ } } }
            else doc.font('Helvetica').fontSize(8).fillColor('#0d1117').text(fmtValor(k, f[k.id]), x + 3, y + 4, { width: w - 6, height: alto - 4, ellipsis: true });
            doc.lineWidth(0.5).strokeColor(BORDE).rect(x, y, w, alto).stroke();
            x += w;
          });
          y += alto;
        }
        y += 10;
      } else if (c.tipo === 'firma') {
        asegurar(70);
        const f = firmas.find(z => z.campo === c.id) || {};
        dibujarFirma(v, X, y, 200, f.nombre || '', c.etiqueta);
        y += 70;
      }
    }
  }
  // Encabezado, pie y número de página en todas las páginas
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i += 1) {
    doc.switchToPage(i);
    const { yPagina, xPagina } = dibujarCabecera();
    doc.font('Helvetica').fontSize(7.5).fillColor('#0d1117').text(`${i + 1} de ${rango.count}`, xPagina, yPagina, { lineBreak: false });
    dibujarPie();
  }
  return pdfABuffer(doc, { marca: false });
}

// Fecha legible para tablas y PDF
export const diaCorto = (d) => (d ? fmtFecha(d) : '');
