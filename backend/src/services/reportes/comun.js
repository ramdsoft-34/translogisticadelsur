// Utilidades comunes para PDF (pdfkit) y Excel (exceljs).
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

export function pdfABuffer(doc) {
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
  return Buffer.from(await wb.xlsx.writeBuffer());
}
