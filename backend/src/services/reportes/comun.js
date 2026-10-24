// Utilidades comunes para PDF (pdfkit) y Excel (exceljs).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

// ── Marca de Translogística en todo lo que se exporta ──────────────────────
// Discreta: el logo muy tenue en el centro de cada página y una línea pequeña al pie.
const LOGO_TLS = fs.readFileSync(fileURLToPath(new URL('../../assets/logos/translogistica.png', import.meta.url)));
const PROPORCION_LOGO = 66 / 160;
const ahoraTexto = () => new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const TEXTO_MARCA = 'Exportado desde Translogística del Sur';

function marcarPagina(doc, cuando) {
  const { width: W, height: H } = doc.page;
  const margenInf = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  // Marca de agua central: ~28 % del ancho, casi transparente
  const ancho = Math.min(W * 0.28, 240);
  doc.opacity(0.05).image(LOGO_TLS, (W - ancho) / 2, (H - ancho * PROPORCION_LOGO) / 2, { width: ancho });
  // Pie: logo pequeño + texto gris
  const x = Math.max(doc.page.margins.left, 18);
  doc.opacity(0.55).image(LOGO_TLS, x, H - 17, { width: 24 });
  doc.opacity(0.7).font('Helvetica').fontSize(6.5).fillColor('#555555')
    .text(`${TEXTO_MARCA} · ${cuando}`, x + 28, H - 13.5, { lineBreak: false });
  doc.restore();
  doc.page.margins.bottom = margenInf;
}

export function marcarPdf(doc) {
  const cuando = ahoraTexto();
  let rango = null;
  try { rango = doc.bufferedPageRange(); } catch { rango = null; }
  if (rango && rango.count > 0 && doc.options?.bufferPages) {
    for (let i = 0; i < rango.count; i += 1) { doc.switchToPage(rango.start + i); marcarPagina(doc, cuando); }
  } else marcarPagina(doc, cuando);
}

// Excel: logo pequeño arriba a la derecha, nota al final y pie de página al imprimir
export function marcarLibro(wb) {
  const cuando = ahoraTexto();
  const imagen = wb.addImage({ buffer: LOGO_TLS, extension: 'png' });
  wb.eachSheet(ws => {
    const ultimaCol = Math.max(ws.columnCount, 1);
    ws.addImage(imagen, { tl: { col: Math.max(ultimaCol - 1, 0), row: 0 }, ext: { width: 72, height: 30 }, editAs: 'absolute' });
    ws.addRow([]);
    const r = ws.addRow([`${TEXTO_MARCA} · ${cuando}`]);
    r.font = { italic: true, size: 8, color: { argb: 'FF8A8A8A' } };
    ws.headerFooter = { ...(ws.headerFooter || {}), oddFooter: `&L&8${TEXTO_MARCA} · ${cuando}&R&8Página &P de &N` };
  });
}

export function pdfABuffer(doc) {
  marcarPdf(doc);
  return new Promise((resolve, reject) => {
    const partes = [];
    doc.on('data', b => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

export const COLOR = { primario: '#111111', acento: '#F5B800', encabezado: '#FFF3C4', cebra: '#FAFAF7', borde: '#D6D3C4' };

export function nuevoPdf(titulo, layout = 'landscape') {
  return new PDFDocument({ size: 'LETTER', layout, margin: 30, bufferPages: true, info: { Title: titulo } });
}

export function encabezadoPdf(doc, { empresa, titulo, subtitulo }) {
  doc.fillColor(COLOR.primario).font('Helvetica-Bold').fontSize(14).text(empresa.nombre, { align: 'left' });
  doc.fillColor('#333').font('Helvetica').fontSize(9).text(`NIT ${empresa.nit}${empresa.dv ? `-${empresa.dv}` : ''}`);
  // Franja corporativa amarilla
  doc.rect(doc.page.margins.left, doc.y + 3, doc.page.width - doc.page.margins.left - doc.page.margins.right, 3).fill(COLOR.acento);
  doc.moveDown(0.6);
  doc.fillColor('black').font('Helvetica-Bold').fontSize(12).text(titulo);
  if (subtitulo) doc.font('Helvetica').fontSize(9).fillColor('#444').text(subtitulo);
  doc.moveDown(0.6);
}

// Tabla simple con encabezado repetido y paginación.
export function tablaPdf(doc, columnas, filas, { total } = {}) {
  const x0 = doc.page.margins.left;
  const ancho = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const sumaPesos = columnas.reduce((a, c) => a + (c.peso || 1), 0);
  const anchos = columnas.map(c => (ancho * (c.peso || 1)) / sumaPesos);
  const alto = 15;
  let y = doc.y;
  const fila = (valores, { negrita = false, fondo = null } = {}) => {
    if (y + alto > doc.page.height - doc.page.margins.bottom - 15) {
      doc.addPage(); y = doc.page.margins.top; encabezado();
    }
    let x = x0;
    if (fondo) doc.rect(x0, y, ancho, alto).fill(fondo);
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('black');
    valores.forEach((v, i) => {
      doc.text(String(v ?? ''), x + 3, y + 4, { width: anchos[i] - 6, align: columnas[i].alin || 'left', lineBreak: false, ellipsis: true });
      x += anchos[i];
    });
    doc.moveTo(x0, y + alto).lineTo(x0 + ancho, y + alto).lineWidth(0.4).strokeColor(COLOR.borde).stroke();
    y += alto;
  };
  const encabezado = () => fila(columnas.map(c => c.titulo), { negrita: true, fondo: COLOR.encabezado });
  encabezado();
  filas.forEach((f, i) => fila(f, { fondo: i % 2 ? COLOR.cebra : null }));
  if (total) fila(total, { negrita: true, fondo: COLOR.encabezado });
  doc.y = y + 8;
  doc.x = x0;
}

export function numerarPaginas(doc) {
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    const margen = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor('#666')
      .text(`Página ${i + 1} de ${rango.count}`, 0, doc.page.height - 20, { width: doc.page.width - 30, align: 'right' });
    doc.page.margins.bottom = margen;
  }
}

// Libro de Excel con una hoja con título, encabezados con estilo y totales.
export async function libroExcel({ empresa, titulo, subtitulo, columnas, filas, total }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = empresa.nombre;
  const ws = wb.addWorksheet(titulo.slice(0, 30), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.addRow([empresa.nombre]).font = { bold: true, size: 14, color: { argb: 'FF111111' } };
  ws.addRow([titulo]).font = { bold: true, size: 12 };
  if (subtitulo) ws.addRow([subtitulo]).font = { italic: true, size: 10 };
  ws.addRow([]);
  const h = ws.addRow(columnas.map(c => c.titulo));
  h.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFF5B800' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: h.number }];
  for (const f of filas) ws.addRow(f);
  if (total) {
    const t = ws.addRow(total);
    t.font = { bold: true };
    t.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } }; });
  }
  columnas.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.ancho || 14;
    if (c.formato) col.numFmt = c.formato;
  });
  ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number, column: columnas.length } };
  marcarLibro(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
