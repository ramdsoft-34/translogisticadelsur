// Fase 11: Excel y PDF de la relación de cobro con el formato aprobado:
// encabezado con el logo o el membrete de la empresa; un bloque por conductor y placa con las columnas
// N° · Nombre · Placa · Fecha · Planilla · Manifiesto · Destino · Días aux. · Tarifa · Auxiliar · Total,
// la franja con el nombre, la placa y los viajes DESPUÉS del último viaje, un solo total general y las firmas.
import ExcelJS from 'exceljs';
import { txt, fmtFecha } from '../../utils/texto.js';
import { imagenDeDataUrl } from './manifiesto.js';
import { nuevoPdf, pdfABuffer, numerarPaginas, marcarLibro } from './comun.js';

export const COLUMNAS = ['N°', 'Nombre', 'Placa', 'Fecha', 'Planilla', 'Manifiesto', 'Destino', 'Días aux.', 'Tarifa', 'Auxiliar', 'Total'];
const ANCHOS = [5, 22, 9, 11, 11, 15, 24, 8, 13, 13, 14];
const color = (c, def) => (/^#[0-9a-f]{6}$/i.test(txt(c)) ? txt(c).slice(1).toUpperCase() : def);
const nitDe = (e) => `${txt(e?.nit).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${e?.dv ? `-${e.dv}` : ''}`;   // 900.109.959-2
const razon = (e) => txt(e?.rndc?.razonSocial) || txt(e?.nombre);
const extension = (b) => (b[0] === 0xFF && b[1] === 0xD8 ? 'jpeg' : 'png');
const diasAux = (f) => (f.diasAux == null ? 'Bodega' : f.diasAux);
export const franjaTexto = (g) => `${txt(g.conductor).toUpperCase()}  ·  PLACA ${g.placa}  ·  ${g.filas.length} viaje(s)`;
export function subtituloRel({ cliente, rel, totales }) {
  return `Cliente: ${txt(cliente?.nombre).toUpperCase()}${cliente?.nit ? ` · NIT ${nitDe(cliente)}` : ''} · ${totales.viajes} viajes · ${totales.vehiculos} vehículos`
    + ` · Generada el ${fmtFecha(new Date())} · Relación N° ${rel.numero}`;
}

export async function relacionExcel({ empresa, cliente, rel, grupos, totales }) {
  const prim = color(empresa?.membrete?.colorPrimario, '0D1117'); const sec = color(empresa?.membrete?.colorSecundario, 'F6B80F');
  const wb = new ExcelJS.Workbook(); wb.creator = razon(empresa);
  const ws = wb.addWorksheet('RELACION', { pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:6' } });
  ANCHOS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const borde = { style: 'thin', color: { argb: 'FFC9CED6' } }; const bordes = { top: borde, left: borde, bottom: borde, right: borde };
  const relleno = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${argb}` } });
  // Encabezado: la franja del membrete si la subieron; si no, logo + razón social + NIT
  const franja = imagenDeDataUrl(empresa?.membrete?.encabezado);
  const logo = imagenDeDataUrl(empresa?.logo);
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 20;
  if (franja) {
    ws.addImage(wb.addImage({ buffer: franja, extension: extension(franja) }), { tl: { col: 0, row: 0 }, br: { col: 11, row: 3 }, editAs: 'oneCell' });
  } else {
    if (logo) ws.addImage(wb.addImage({ buffer: logo, extension: extension(logo) }), { tl: { col: 0, row: 0 }, br: { col: 2, row: 3 }, editAs: 'oneCell' });
    const lineas = [[razon(empresa), { bold: true, size: 14 }], [`NIT ${nitDe(empresa)}`, { size: 10 }], [txt(empresa?.membrete?.textoPie), { italic: true, size: 9, color: { argb: 'FF555555' } }]];
    lineas.forEach(([t, font], i) => { ws.mergeCells(i + 1, 3, i + 1, 11); const c = ws.getCell(i + 1, 3); c.value = t; c.font = font; c.alignment = { horizontal: 'center', vertical: 'middle' }; });
  }
  ws.getRow(4).height = 4;
  for (let c = 1; c <= 11; c++) ws.getCell(4, c).fill = relleno(c <= 9 ? prim : sec);
  ws.mergeCells(5, 1, 5, 11);
  Object.assign(ws.getCell(5, 1), { value: rel.titulo, font: { bold: true, size: 12 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
  ws.getRow(5).height = 30;
  ws.mergeCells(6, 1, 6, 11);
  Object.assign(ws.getCell(6, 1), { value: subtituloRel({ cliente, rel, totales }), font: { size: 9, color: { argb: 'FF555555' } }, alignment: { horizontal: 'center' } });
  let r = 8; const primera = r;
  for (const g of grupos) {
    const h = ws.getRow(r);
    COLUMNAS.forEach((t, i) => { const c = h.getCell(i + 1); c.value = t; c.font = { bold: true, size: 9 }; c.fill = relleno('F1F3F6'); c.border = bordes; c.alignment = { horizontal: 'center' }; });
    r++;
    for (const f of g.filas) {
      const fila = ws.getRow(r);
      const vals = [f.n, f.conductor, f.placa, new Date(f.fecha), f.planilla || '', f.manifiesto, f.destino, diasAux(f), f.tarifa, f.auxiliar, { formula: `I${r}+J${r}`, result: f.tarifa + f.auxiliar }];
      vals.forEach((v, i) => { const c = fila.getCell(i + 1); c.value = v; c.border = bordes;
        if (i === 3) c.numFmt = 'dd/mm/yyyy';
        if (i >= 8) c.numFmt = '"$" #,##0';
        if ([0, 2, 7].includes(i)) c.alignment = { horizontal: 'center' }; });
      r++;
    }
    ws.mergeCells(r, 1, r, 11);
    Object.assign(ws.getCell(r, 1), { value: franjaTexto(g), font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: relleno(prim) });
    r++;
  }
  ws.mergeCells(r, 1, r, 8);
  Object.assign(ws.getCell(r, 1), { value: 'TOTAL GENERAL DE LA RELACIÓN', font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }, fill: relleno(prim), alignment: { horizontal: 'right' } });
  [['I', totales.tarifa], ['J', totales.auxiliar], ['K', totales.total]].forEach(([col, v]) => {
    Object.assign(ws.getCell(`${col}${r}`), { value: { formula: `SUM(${col}${primera}:${col}${r - 1})`, result: v }, numFmt: '"$" #,##0',
      font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }, fill: relleno(prim) });
  });
  r += 4;
  ws.getCell(r, 2).value = '_______________________________'; ws.getCell(r, 7).value = '_______________________________';
  Object.assign(ws.getCell(r + 1, 2), { value: `Elaboró: ${razon(empresa)}`, font: { size: 9 } });
  Object.assign(ws.getCell(r + 1, 7), { value: `Recibido: ${txt(cliente?.nombre).toUpperCase()}`, font: { size: 9 } });
  ws.views = [{ state: 'frozen', ySplit: 7 }];
  marcarLibro(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function relacionPdf({ empresa, cliente, rel, grupos, totales }) {
  const prim = `#${color(empresa?.membrete?.colorPrimario, '0D1117')}`; const sec = `#${color(empresa?.membrete?.colorSecundario, 'F6B80F')}`;
  const doc = nuevoPdf(rel.titulo, 'landscape');
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  const pesos = [0.45, 2, 0.8, 0.95, 0.9, 1.25, 2, 0.75, 1.05, 1.05, 1.1];
  const suma = pesos.reduce((a, b) => a + b, 0); const anchos = pesos.map(p => (p / suma) * ancho);
  const franja = imagenDeDataUrl(empresa?.membrete?.encabezado); const logo = imagenDeDataUrl(empresa?.logo);
  const encabezado = () => {
    let y = doc.page.margins.top;
    if (franja) { doc.image(franja, x0, y, { fit: [ancho, 60], align: 'center' }); y += 64; }
    else {
      if (logo) doc.image(logo, x0, y, { fit: [90, 46] });
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(13).text(razon(empresa), x0 + 100, y + 2, { width: ancho - 200, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#333').text(`NIT ${nitDe(empresa)}`, x0 + 100, doc.y + 1, { width: ancho - 200, align: 'center' });
      if (txt(empresa?.membrete?.textoPie)) doc.fontSize(8).fillColor('#555').text(txt(empresa.membrete.textoPie), x0 + 100, doc.y + 1, { width: ancho - 200, align: 'center' });
      y += 50;
    }
    doc.rect(x0, y, ancho * 0.82, 3).fill(prim); doc.rect(x0 + ancho * 0.82, y, ancho * 0.18, 3).fill(sec);
    return y + 8;
  };
  let y = encabezado();
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text(rel.titulo, x0, y, { width: ancho, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor('#555').text(subtituloRel({ cliente, rel, totales }), x0, doc.y + 2, { width: ancho, align: 'center' });
  y = doc.y + 8;
  const ALTO = 14; const limite = () => doc.page.height - doc.page.margins.bottom - 24;
  const nueva = () => { doc.addPage(); y = encabezado(); };
  const celdas = (vals, { negrita = false, fondo = null, colorTexto = '#111' } = {}) => {
    if (y + ALTO > limite()) nueva();
    if (fondo) doc.rect(x0, y, ancho, ALTO).fill(fondo);
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.2).fillColor(colorTexto);
    let x = x0;
    vals.forEach((v, i) => { doc.text(String(v ?? ''), x + 3, y + 3.5, { width: anchos[i] - 6, height: ALTO - 3, ellipsis: true, lineBreak: false, align: i >= 8 ? 'right' : [0, 2, 7].includes(i) ? 'center' : 'left' }); x += anchos[i]; });
    doc.moveTo(x0, y + ALTO).lineTo(x0 + ancho, y + ALTO).lineWidth(0.4).strokeColor('#C9CED6').stroke();
    y += ALTO;
  };
  const m = (n) => `$ ${Math.round(n).toLocaleString('es-CO')}`;
  for (const g of grupos) {
    if (y + ALTO * 3 > limite()) nueva();
    celdas(COLUMNAS, { negrita: true, fondo: '#F1F3F6' });
    for (const f of g.filas) celdas([f.n, f.conductor, f.placa, fmtFecha(f.fecha), f.planilla || '', f.manifiesto, f.destino, diasAux(f), m(f.tarifa), m(f.auxiliar), m(f.tarifa + f.auxiliar)]);
    if (y + ALTO > limite()) nueva();
    doc.rect(x0, y, ancho, ALTO).fill(prim);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff').text(franjaTexto(g), x0 + 4, y + 3.5, { width: ancho - 8, lineBreak: false });
    y += ALTO;
  }
  if (y + ALTO * 4 > limite()) nueva();
  doc.rect(x0, y, ancho, ALTO + 2).fill(prim);
  const xi = x0 + anchos.slice(0, 8).reduce((a, b) => a + b, 0);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text('TOTAL GENERAL DE LA RELACIÓN', x0, y + 4, { width: xi - x0 - 6, align: 'right', lineBreak: false });
  [totales.tarifa, totales.auxiliar, totales.total].forEach((v, i) => {
    const xx = xi + anchos.slice(8, 8 + i).reduce((a, b) => a + b, 0);
    doc.text(m(v), xx + 3, y + 4, { width: anchos[8 + i] - 6, align: 'right', lineBreak: false });
  });
  y += ALTO + 40;
  if (y + 30 > limite()) { nueva(); y += 30; }
  doc.lineWidth(0.6).strokeColor('#333');
  doc.moveTo(x0 + 20, y).lineTo(x0 + 240, y).stroke(); doc.moveTo(x0 + ancho - 260, y).lineTo(x0 + ancho - 40, y).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#333').text(`Elaboró: ${razon(empresa)}`, x0 + 20, y + 4, { width: 220 })
    .text(`Recibido: ${txt(cliente?.nombre).toUpperCase()}`, x0 + ancho - 260, y + 4, { width: 220 });
  numerarPaginas(doc);
  return pdfABuffer(doc, { marca: 'pie' });
}
