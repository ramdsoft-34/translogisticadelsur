// Documento de la liquidación del conductor, con el formato de la plantilla (FORMATO_LIQUIDACION):
// encabezado con la empresa y el número, datos del conductor y el periodo, los viajes (flete, auxiliar,
// anticipo reconocido y saldo) y el resumen: (+) saldos, (−) retefuente, (−) FOPAT, (−) préstamos = NETO A PAGAR.
// Una liquidación por hoja carta, o dos por hoja (media hoja cada una, con línea de corte).
import { nuevoPdf, pdfABuffer, COLOR } from './comun.js';
import { fmtFecha, txt } from '../../utils/texto.js';

const $ = (v) => Math.round(Number(v) || 0);
const pesos = (v) => ($(v) < 0 ? `- $ ${(-$(v)).toLocaleString('es-CO')}` : `$ ${$(v).toLocaleString('es-CO')}`);
const imagenDeDataUrl = (u) => {
  const m = String(u || '').match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/);
  return m ? Buffer.from(m[2], 'base64') : null;
};

// Totales del documento. Las líneas antiguas (antes del auxiliar y del anticipo reconocido) usan el anticipo original.
export function resumenLiquidacion(l) {
  const antRec = l.anticipoReconocido ?? l.anticipo ?? 0;
  const saldos = $(l.flete) + $(l.auxiliar) - $(antRec);
  return { saldos, retefuente: $(l.retefuente), fopat: $(l.fopat), prestamos: $(l.descuentoPrestamos), neto: $(l.neto), anticipoReconocido: $(antRec) };
}
const saldoLinea = (x) => $(x.flete) + $(x.auxiliar) - $(x.anticipoReconocido ?? x.anticipo);

// Dibuja una liquidación dentro del recuadro (x, y, ancho, alto). `compacto` = media hoja.
function dibujar(doc, empresa, l, { x, y, ancho, alto, compacto }) {
  const R = resumenLiquidacion(l);
  const f = compacto ? 0.86 : 1;                         // escala de letra
  const fin = y + alto;
  let yy = y;
  // ── Encabezado: logo y razón social a la izquierda, número de liquidación a la derecha ──
  const logo = imagenDeDataUrl(empresa?.logo);
  let xt = x;
  if (logo) { try { doc.image(logo, x, yy, { fit: [compacto ? 54 : 70, compacto ? 30 : 38] }); xt = x + (compacto ? 62 : 80); } catch { /* logo ilegible: sin logo */ } }
  doc.fillColor(COLOR.primario).font('Helvetica-Bold').fontSize(12 * f)
    .text(txt(empresa?.rndc?.razonSocial) || txt(empresa?.nombre), xt, yy, { width: ancho - (xt - x) - 170, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(8 * f).fillColor('#444')
    .text(`NIT ${txt(empresa?.nit)}${empresa?.dv ? `-${empresa.dv}` : ''}${txt(empresa?.direccion) ? ` · ${txt(empresa.direccion)}` : ''}`, xt, yy + 15 * f,
      { width: ancho - (xt - x) - 170, lineBreak: false, ellipsis: true });
  // Recuadro del número
  const wb = 160; const hb = compacto ? 34 : 40;
  doc.roundedRect(x + ancho - wb, yy, wb, hb, 4).fill(COLOR.primario);
  doc.fillColor(COLOR.acento).font('Helvetica-Bold').fontSize(7.5 * f).text('LIQUIDACIÓN DE FLETES', x + ancho - wb, yy + 6, { width: wb, align: 'center' });
  doc.fillColor('white').fontSize(14 * f).text(l.numero, x + ancho - wb, yy + (compacto ? 16 : 19), { width: wb, align: 'center' });
  yy += hb + 6;
  doc.rect(x, yy, ancho, 3).fill(COLOR.acento);
  yy += 9;

  // ── Datos: conductor, cédula, placa, periodo, empresa(s) y fecha ──
  const datos = [
    ['Conductor', l.conductorNombre], ['Cédula', l.cedula], ['Placa', l.placa],
    ['Periodo', `${fmtFecha(l.desde)} al ${fmtFecha(l.hasta)}`], ['Empresa(s)', l.empresas], ['Fecha', fmtFecha(l.fecha)],
  ];
  const colW = ancho / 3; const filaDato = 22 * f;
  datos.forEach(([etq, val], i) => {
    const cx = x + (i % 3) * colW; const cy = yy + Math.floor(i / 3) * filaDato;
    doc.fillColor('#777').font('Helvetica').fontSize(6.5 * f).text(etq.toUpperCase(), cx, cy, { width: colW - 8, lineBreak: false });
    doc.fillColor(COLOR.primario).font('Helvetica-Bold').fontSize(8.5 * f).text(txt(val) || '—', cx, cy + 8 * f, { width: colW - 8, lineBreak: false, ellipsis: true });
  });
  yy += 2 * filaDato + 4;

  // ── Viajes ──
  const cols = [['N°', 0.45, 'left'], ['Fecha', 0.95, 'left'], ['Manifiesto', 1.05, 'left'], ['Empresa', 1.3, 'left'], ['Destino', 1.9, 'left'],
    ['Flete', 1.05, 'right'], ['Auxiliar', 0.95, 'right'], ['Anticipo', 1, 'right'], ['Saldo', 1.1, 'right']];
  const suma = cols.reduce((a, c) => a + c[1], 0);
  const anchos = cols.map(c => (c[1] / suma) * ancho);
  const FILA = (compacto ? 10 : 12.5);
  const resumenAlto = (R.prestamos ? 5 : 4) * (compacto ? 11 : 13) + 16;
  const firmasAlto = compacto ? 34 : 46;
  const caben = Math.max(1, Math.floor((fin - yy - FILA * 2 - resumenAlto - firmasAlto - 10) / FILA));
  const fila = (valores, { negrita = false, fondo = null, color = COLOR.primario } = {}) => {
    if (fondo) doc.rect(x, yy, ancho, FILA).fill(fondo);
    let cx = x;
    doc.fillColor(color).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize((compacto ? 6.6 : 7.6));
    valores.forEach((v, i) => {
      doc.text(String(v ?? ''), cx + 3, yy + (FILA - 7) / 2, { width: anchos[i] - 6, align: cols[i][2], lineBreak: false, ellipsis: true });
      cx += anchos[i];
    });
    yy += FILA;
  };
  fila(cols.map(c => c[0]), { negrita: true, fondo: COLOR.primario, color: 'white' });
  const lineas = l.lineas || [];
  const visibles = lineas.length > caben ? lineas.slice(0, caben - 1) : lineas;
  visibles.forEach((v, i) => fila([i + 1, fmtFecha(v.fecha), v.manifiesto, v.empresa, v.destino, pesos(v.flete), pesos(v.auxiliar), pesos(v.anticipoReconocido ?? v.anticipo), pesos(saldoLinea(v))],
    { fondo: i % 2 ? COLOR.cebra : null }));
  if (visibles.length < lineas.length) {
    const resto = lineas.slice(visibles.length);
    fila(['', '', `+ ${resto.length} viaje(s) más`, '', '', pesos(resto.reduce((a, v) => a + $(v.flete), 0)), pesos(resto.reduce((a, v) => a + $(v.auxiliar), 0)),
      pesos(resto.reduce((a, v) => a + $(v.anticipoReconocido ?? v.anticipo), 0)), pesos(resto.reduce((a, v) => a + saldoLinea(v), 0))], { color: '#555' });
  }
  fila(['', '', `${lineas.length} viaje(s)`, '', 'TOTALES', pesos(l.flete), pesos(l.auxiliar), pesos(R.anticipoReconocido), pesos(R.saldos)], { negrita: true, fondo: COLOR.encabezado });
  doc.moveTo(x, yy).lineTo(x + ancho, yy).lineWidth(0.6).strokeColor(COLOR.borde).stroke();
  yy += 8;

  // ── Resumen (derecha) y notas (izquierda) ──
  const wr = Math.min(250, ancho * 0.48); const xr = x + ancho - wr; const fr = compacto ? 11 : 13;
  const filasResumen = [['(+) Total saldos (flete + auxiliar - anticipo)', R.saldos], ['(-) Retención en la fuente', -R.retefuente], ['(-) FOPAT', -R.fopat],
    ...(R.prestamos ? [['(-) Cuota de préstamo o descuento', -R.prestamos]] : [])];
  let yr = yy;
  filasResumen.forEach(([t, v]) => {
    doc.fillColor('#333').font('Helvetica').fontSize(compacto ? 7 : 8).text(t, xr, yr, { width: wr - 80, lineBreak: false });
    doc.text(pesos(v), xr + wr - 80, yr, { width: 76, align: 'right', lineBreak: false });
    yr += fr;
  });
  doc.roundedRect(xr, yr + 1, wr, fr + 6, 3).fill(COLOR.acento);
  doc.fillColor(COLOR.primario).font('Helvetica-Bold').fontSize(compacto ? 8.5 : 10).text('NETO A PAGAR', xr + 6, yr + 5, { width: wr - 90, lineBreak: false });
  doc.text(pesos(R.neto), xr + wr - 90, yr + 5, { width: 84, align: 'right', lineBreak: false });
  const notas = ['Saldo de cada viaje = flete + auxiliar - anticipo reconocido.', 'Retefuente: porcentaje del flete según las reglas de la empresa.',
    'FOPAT: 0,1 % del flete si el PBV supera el límite y el destino no es Pasto.'];
  if (!compacto) doc.fillColor('#777').font('Helvetica').fontSize(6.8).text(notas.join('\n'), x, yy, { width: ancho - wr - 18 });
  if (l.estado === 'ANULADA') {
    doc.save().rotate(-18, { origin: [x + ancho / 2, y + alto / 2] }).fillColor('#C62828').opacity(0.18).font('Helvetica-Bold').fontSize(compacto ? 48 : 70)
      .text('ANULADA', x, y + alto / 2 - 30, { width: ancho, align: 'center' }).restore();
  }

  // ── Firmas ──
  // Firmas: al pie de la media hoja; en hoja completa, un poco debajo del resumen
  const yf = compacto ? fin - 16 : Math.min(fin - 22, yr + 110);
  const wf = Math.min(200, ancho * 0.4);
  doc.lineWidth(0.6).strokeColor('#333').moveTo(x, yf).lineTo(x + wf, yf).stroke().moveTo(x + ancho - wf, yf).lineTo(x + ancho, yf).stroke();
  doc.fillColor('#333').font('Helvetica').fontSize(compacto ? 6.8 : 7.8)
    .text(`Recibí conforme: ${txt(l.conductorNombre)}${l.cedula ? ` · C.C. ${l.cedula}` : ''}`, x, yf + 3, { width: wf, align: 'center', lineBreak: false, ellipsis: true })
    .text(`Por ${txt(empresa?.nombre)}`, x + ancho - wf, yf + 3, { width: wf, align: 'center', lineBreak: false, ellipsis: true });
}

// Una liquidación en hoja carta vertical
export function liquidacionPdf(empresa, l) {
  const doc = nuevoPdf(`Liquidación ${l.numero}`, 'portrait');
  doc.options.margin = 0; doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  const M = 36;
  dibujar(doc, empresa, l, { x: M, y: M, ancho: doc.page.width - 2 * M, alto: doc.page.height - 2 * M - 10, compacto: false });
  return pdfABuffer(doc, { marca: 'pie' });
}

// Dos liquidaciones por hoja carta: media hoja cada una, separadas por una línea de corte.
// Una liquidación con muchos viajes (no caben en media hoja) va sola en la hoja completa.
const MAX_MEDIA_HOJA = 17;
export function liquidacionesMediaHoja(empresa, lista) {
  const doc = nuevoPdf('Liquidaciones de conductores', 'portrait');
  doc.options.margin = 0; doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  const W = doc.page.width; const H = doc.page.height; const M = 26; const mitad = H / 2;
  let ocupada = 0;                       // 0 = hoja vacía, 1 = mitad superior usada, 2 = hoja llena
  lista.forEach((l, i) => {
    const completa = (l.lineas?.length || 0) > MAX_MEDIA_HOJA;
    if (i > 0 && (completa || ocupada !== 1)) { doc.addPage(); ocupada = 0; }
    if (completa) { dibujar(doc, empresa, l, { x: 36, y: 36, ancho: W - 72, alto: H - 82, compacto: false }); ocupada = 2; return; }
    const arriba = ocupada === 0;
    dibujar(doc, empresa, l, { x: M, y: arriba ? M - 6 : mitad + 14, ancho: W - 2 * M, alto: mitad - M - 6, compacto: true });
    if (arriba) doc.save().dash(4, { space: 3 }).strokeColor('#999999').lineWidth(0.6).moveTo(12, mitad).lineTo(W - 12, mitad).stroke().undash().restore();
    ocupada = arriba ? 1 : 2;
  });
  return pdfABuffer(doc, { marca: 'pie' });
}
