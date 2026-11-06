// PDF de SG-SST con el membrete de la empresa: franja de encabezado y de pie (si se subieron)
// o el encabezado clásico con el logo del soporte interno. Formatos, asistencia y entrega de EPP.
import PDFDocument from 'pdfkit';
import { pdfABuffer } from './comun.js';

const fmtFecha = (v) => {
  if (!v) return '';
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00-05:00`) : new Date(v);
  return Number.isNaN(+d) ? s : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
};
const fmtFechaHora = (v) => (v ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '');
const imagenDe = (dataUrl) => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(String(dataUrl || ''));
  return m ? Buffer.from(m[2], 'base64') : null;
};
const VALOR = { cumple: 'Cumple', no_cumple: 'No cumple', na: 'N/A' };

/** Documento con márgenes que dejan espacio al membrete; el membrete se dibuja al final en cada página. */
export function nuevoDocumento(titulo) {
  return new PDFDocument({ size: 'LETTER', margins: { top: 108, bottom: 64, left: 42, right: 42 }, bufferPages: true, info: { Title: titulo } });
}

function membrete(doc, d, { codigo, titulo, version }) {
  const rango = doc.bufferedPageRange();
  const enc = imagenDe(d.membrete?.encabezado); const pie = imagenDe(d.membrete?.pie); const logo = imagenDe(d.empresa?.logo);
  const W = doc.page.width; const x0 = 42; const ancho = W - 84;
  const principal = d.colores?.principal || '#0B2A6B'; const acento = d.colores?.acento || '#F5B400';
  for (let i = 0; i < rango.count; i += 1) {
    doc.switchToPage(rango.start + i);
    const m = doc.page.margins; doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    if (enc) {
      try { doc.image(enc, 0, 0, { fit: [W, 70], align: 'center' }); } catch { /* imagen dañada: sin franja */ }
    } else {
      let x = x0;
      if (logo) { try { doc.image(logo, x0, 18, { fit: [70, 48] }); x = x0 + 80; } catch { /* sin logo */ } }
      doc.fillColor(principal).font('Helvetica-Bold').fontSize(11).text(d.empresa.nombre, x, 22, { width: ancho - (x - x0) - 150, lineBreak: true, height: 28 });
      doc.fillColor('#333').font('Helvetica').fontSize(8).text(`NIT ${d.empresa.nit}${d.empresa.dv ? `-${d.empresa.dv}` : ''}`, x, 50, { width: 260, lineBreak: false });
      doc.rect(x0, 72, ancho, 2.5).fill(acento);
    }
    // Recuadro con el código del formato
    doc.rect(W - x0 - 140, 20, 140, 44).lineWidth(0.6).strokeColor('#9A9A9A').stroke();
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8.5).text(codigo || '', W - x0 - 136, 25, { width: 132, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor('#444').text(`Versión ${version || 1} · Página ${i + 1} de ${rango.count}`, W - x0 - 136, 38, { width: 132, align: 'center', lineBreak: false });
    doc.text(fmtFecha(new Date()), W - x0 - 136, 49, { width: 132, align: 'center', lineBreak: false });
    // Título del documento debajo del membrete
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11.5).text(titulo, x0, 82, { width: ancho, align: 'center', lineBreak: false, ellipsis: true });
    // Pie
    const H = doc.page.height;
    if (pie) {
      try { doc.image(pie, 0, H - 46, { fit: [W, 46], align: 'center', valign: 'bottom' }); } catch { /* sin franja */ }
    } else {
      doc.rect(x0, H - 44, ancho, 1).fill(principal);
      const textoPie = d.pieTexto || [d.empresa.direccion, d.empresa.telefono, d.empresa.correo].filter(Boolean).join(' · ');
      doc.fillColor('#555').font('Helvetica').fontSize(7.5).text(textoPie, x0, H - 38, { width: ancho, align: 'center', lineBreak: false, ellipsis: true });
    }
    doc.page.margins = m;
  }
}

export async function terminar(doc, d, meta) {
  membrete(doc, d, meta);
  return pdfABuffer(doc, { marca: false });
}

// ── Piezas de contenido ──
// El título nunca queda solo al final de la página: debe caber con algo de su contenido
function seccion(doc, titulo, principal = '#0B2A6B') {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 95) doc.addPage();
  doc.moveDown(0.4);
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  doc.rect(x0, doc.y, ancho, 15).fill(principal);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5).text(titulo.toUpperCase(), x0 + 6, doc.y + 4, { width: ancho - 12, lineBreak: false });
  doc.y += 19; doc.x = x0; doc.fillColor('#111');
}

function campos(doc, lista) {
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  const col = ancho / 2;
  for (let i = 0; i < lista.length; i += 2) {
    const par = lista.slice(i, i + 2);
    const alto = Math.max(...par.map(([, v]) => doc.font('Helvetica').fontSize(9).heightOfString(String(v || ' '), { width: col - 12 }))) + 16;
    if (doc.y + alto > doc.page.height - doc.page.margins.bottom - 10) doc.addPage();
    const y = doc.y;
    par.forEach(([etiqueta, valor], j) => {
      const x = x0 + j * col;
      doc.rect(x, y, col, alto).lineWidth(0.4).strokeColor('#C9C9C9').stroke();
      doc.fillColor('#666').font('Helvetica').fontSize(6.8).text(etiqueta, x + 5, y + 3, { width: col - 10, lineBreak: false });
      doc.fillColor('#111').font('Helvetica').fontSize(9).text(String(valor || ''), x + 5, y + 12, { width: col - 10 });
    });
    doc.y = y + alto; doc.x = x0;
  }
}

function tabla(doc, columnas, filas, { firmas = null, altoFirma = 30 } = {}) {
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  const cols = firmas ? [...columnas, { titulo: 'Firma', peso: 1.4 }] : columnas;
  const suma = cols.reduce((a, c) => a + (c.peso || 1), 0);
  const anchos = cols.map((c) => (ancho * (c.peso || 1)) / suma);
  const encabezado = () => {
    let x = x0; const y = doc.y;
    doc.rect(x0, y, ancho, 16).fill('#EEF0F4');
    cols.forEach((c, i) => { doc.fillColor('#111').font('Helvetica-Bold').fontSize(7.5).text(c.titulo, x + 4, y + 5, { width: anchos[i] - 8, lineBreak: false }); x += anchos[i]; });
    doc.y = y + 16;
  };
  encabezado();
  filas.forEach((f, n) => {
    const textos = columnas.map((c, i) => String(f[i] ?? ''));
    const alto = Math.max(firmas ? altoFirma : 0, ...textos.map((t, i) => doc.font('Helvetica').fontSize(8).heightOfString(t || ' ', { width: anchos[i] - 8 }) + 8));
    if (doc.y + alto > doc.page.height - doc.page.margins.bottom - 6) { doc.addPage(); encabezado(); }
    const y = doc.y; let x = x0;
    textos.forEach((t, i) => { doc.fillColor('#111').font('Helvetica').fontSize(8).text(t, x + 4, y + 4, { width: anchos[i] - 8 }); x += anchos[i]; });
    if (firmas) {
      const img = imagenDe(firmas[n]?.imagen);
      if (img) { try { doc.image(img, x + 4, y + 2, { fit: [anchos[anchos.length - 1] - 8, alto - 12] }); } catch { /* firma ilegible */ } }
      if (firmas[n]?.texto) doc.fillColor('#666').fontSize(6).text(firmas[n].texto, x + 4, y + alto - 9, { width: anchos[anchos.length - 1] - 8, lineBreak: false });
    }
    doc.moveTo(x0, y + alto).lineTo(x0 + ancho, y + alto).lineWidth(0.4).strokeColor('#C9C9C9').stroke();
    doc.y = y + alto;
  });
  doc.x = x0; doc.moveDown(0.3);
}

function parrafo(doc, texto, { vacio = 4 } = {}) {
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  const t = String(texto || '');
  const alto = Math.max(t ? doc.font('Helvetica').fontSize(9).heightOfString(t, { width: ancho - 10 }) + 10 : vacio * 14, 18);
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom - 6) doc.addPage();
  const y = doc.y;
  doc.rect(x0, y, ancho, alto).lineWidth(0.4).strokeColor('#C9C9C9').stroke();
  if (t) doc.fillColor('#111').font('Helvetica').fontSize(9).text(t, x0 + 5, y + 5, { width: ancho - 10 });
  doc.y = y + alto; doc.x = x0;
}

function cuadrosFirma(doc, lista) {
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  if (doc.y + 90 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(1.2);
  const w = (ancho - 20 * (lista.length - 1)) / lista.length; const y = doc.y;
  lista.forEach((f, i) => {
    const x = x0 + i * (w + 20);
    const img = imagenDe(f.imagen);
    if (img) { try { doc.image(img, x, y, { fit: [w, 50] }); } catch { /* ilegible */ } }
    doc.moveTo(x, y + 54).lineTo(x + w, y + 54).lineWidth(0.6).strokeColor('#333').stroke();
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(8).text(f.etiqueta, x, y + 58, { width: w, align: 'center' });
    if (f.nombre) doc.font('Helvetica').fontSize(7.5).fillColor('#444').text(f.nombre, x, y + 69, { width: w, align: 'center' });
  });
  doc.y = y + 84; doc.x = x0;
}

/** Formato genérico desde su definición. Sin `x` sale en blanco (para imprimir y llenar a mano). */
export async function formatoPdf(d, f, x = null) {
  const doc = nuevoDocumento(f.titulo);
  const principal = d.colores?.principal;
  const datos = x?.datos || {}; const items = new Map((x?.items || []).map((i) => [i.clave, i]));
  if (x) doc.fillColor('#444').font('Helvetica').fontSize(8).text(`N.º ${x.numero} · ${x.estado === 'final' ? 'Guardado' : 'Borrador'} ${fmtFechaHora(x.actualizado)}${x.autorNombre ? ` · ${x.autorNombre}` : ''}`, { align: 'right' });
  for (const s of f.secciones || []) {
    if (s.tipo === 'campos') {
      seccion(doc, s.titulo, principal);
      campos(doc, s.campos.map((c) => [c.etiqueta, c.tipo === 'fecha' ? fmtFecha(datos[c.clave]) : datos[c.clave]]));
    } else if (s.tipo === 'items') {
      seccion(doc, s.titulo, principal);
      tabla(doc, [{ titulo: 'N.º', peso: 0.35 }, { titulo: 'Ítem', peso: 4 }, { titulo: 'Resultado', peso: 1 }, { titulo: 'Observación', peso: 2.4 }],
        s.items.map((it, i) => { const v = items.get(it.clave); return [i + 1, it.texto, VALOR[v?.valor] || '', v?.observacion || '']; }));
    } else if (s.tipo === 'texto') {
      seccion(doc, s.titulo, principal);
      parrafo(doc, datos[s.clave]);
    } else if (s.tipo === 'tabla') {
      seccion(doc, s.titulo, principal);
      const filas = datos.tablas?.[s.clave] || [];
      const lineas = filas.length ? filas : Array.from({ length: x ? 0 : 8 }, () => ({}));
      tabla(doc, s.columnas.map((c) => ({ titulo: c.etiqueta, peso: c.clave === 'nombre' || c.clave === 'elemento' || c.clave === 'compromiso' ? 2.4 : 1 })),
        lineas.map((r) => s.columnas.map((c) => (c.tipo === 'fecha' ? fmtFecha(r[c.clave]) : r[c.clave] || ''))),
        s.firma ? { firmas: lineas.map((_, i) => ({ imagen: x?.firmas?.[`${s.clave}.${i}`] || '' })) } : {});
      if (!lineas.length) parrafo(doc, 'Sin registros.', { vacio: 1 });
    } else if (s.tipo === 'firmas') {
      cuadrosFirma(doc, s.firmas.map((c) => ({ etiqueta: c.etiqueta, imagen: x?.firmas?.[c.clave] || '', nombre: datos[c.clave] || '' })));
    } else if (s.tipo === 'nota') {
      doc.moveDown(0.5).fillColor('#555').font('Helvetica-Oblique').fontSize(8).text(s.texto);
    }
  }
  return terminar(doc, d, { codigo: f.codigo, titulo: f.titulo, version: x?.version || 1 });
}

/** SST-FOR-07 con las firmas reales de la capacitación del programa. */
export async function asistenciaPdf(d, k) {
  const titulo = 'Registro de asistencia a capacitaciones';
  const doc = nuevoDocumento(titulo);
  const principal = d.colores?.principal;
  seccion(doc, 'Capacitación', principal);
  campos(doc, [['Tema', k.tema], ['Fecha', fmtFecha(k.fecha)], ['Eje', { sst: 'SST', vial: 'Seguridad vial', ambos: 'SST y seguridad vial' }[k.eje]], ['Horas', k.horas],
    ['Facilitador', k.facilitador], ['Lugar', k.lugar], ['Dirigido a', k.dirigidoA], ['Estado', k.ejecutada ? 'Ejecutada' : 'Programada']]);
  seccion(doc, `Asistentes (${k.asistentes.length})`, principal);
  tabla(doc, [{ titulo: 'N.º', peso: 0.35 }, { titulo: 'Nombre', peso: 2.4 }, { titulo: 'Documento', peso: 1.1 }, { titulo: 'Cargo', peso: 1.4 }],
    k.asistentes.map((a, i) => [i + 1, a.nombre, a.documento, a.cargo]),
    { firmas: k.asistentes.map((a) => ({ imagen: k.firmas[a.id] || '', texto: a.firmadoEn ? `${a.firmaOrigen === 'app' ? 'App' : 'Web'} · ${fmtFechaHora(a.firmadoEn)}` : '' })) });
  if (k.observaciones) { seccion(doc, 'Observaciones', principal); parrafo(doc, k.observaciones); }
  cuadrosFirma(doc, [{ etiqueta: 'Facilitador', nombre: k.facilitador }, { etiqueta: 'Responsable del SG-SST', nombre: d.responsables.responsableSst }]);
  return terminar(doc, d, { codigo: 'SST-FOR-07', titulo });
}

/** SST-FOR-02 con las entregas del colaborador y la firma de cada una. */
export async function eppPdf(d, persona, entregas) {
  const titulo = 'Entrega y reposición de elementos de protección personal (EPP)';
  const doc = nuevoDocumento(titulo);
  const principal = d.colores?.principal;
  seccion(doc, 'Trabajador', principal);
  campos(doc, [['Nombre', persona.nombre], ['Documento', persona.documento], ['Cargo', persona.cargo], ['Fecha del reporte', fmtFecha(new Date())]]);
  seccion(doc, 'Elementos entregados', principal);
  tabla(doc, [{ titulo: 'Fecha', peso: 0.9 }, { titulo: 'Elementos', peso: 3 }, { titulo: 'Motivo', peso: 0.9 }, { titulo: 'Próxima reposición', peso: 1 }],
    entregas.map((e) => [fmtFecha(e.fecha), e.elementos.map((x) => `${x.cantidad} × ${x.nombre}`).join(', '), e.motivo === 'reposicion' ? 'Reposición' : 'Entrega', fmtFecha(e.proximaReposicion)]),
    { firmas: entregas.map((e) => ({ imagen: e.firma || '', texto: e.firmadoEn ? `${e.firmaOrigen === 'app' ? 'App' : 'Web'} · ${fmtFechaHora(e.firmadoEn)}` : 'Sin firma' })) });
  doc.moveDown(0.5).fillColor('#333').font('Helvetica').fontSize(8.5)
    .text('Recibo los elementos en buen estado, me comprometo a usarlos durante la jornada, cuidarlos e informar cuando requieran reposición.');
  return terminar(doc, d, { codigo: 'SST-FOR-02', titulo });
}

/** «Ver cómo queda»: una hoja de muestra con el membrete actual. */
export async function muestraMembrete(d) {
  const doc = nuevoDocumento('Vista previa del membrete');
  seccion(doc, 'Vista previa', d.colores?.principal);
  parrafo(doc, 'Así salen el encabezado y el pie en todos los formatos de SG-SST y PESV.');
  campos(doc, [['Representante legal', d.responsables.representanteLegal], ['Responsable del SG-SST', d.responsables.responsableSst], ['ARL', d.riesgo.arl], ['Clase de riesgo', d.riesgo.claseRiesgo]]);
  return terminar(doc, d, { codigo: 'MUESTRA', titulo: 'Vista previa del membrete' });
}
