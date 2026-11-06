// Impresión de varios documentos guardados en hoja carta, 2 por hoja (media hoja cada uno), SIN volver a generarlos:
// se toma la mitad de arriba de cada PDF guardado y se pone arriba o abajo de la hoja. Un documento que ocupa la hoja
// completa (p. ej. una liquidación con muchos viajes) va en su propia hoja tal cual.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * @param items [{ buffer, completa }] en el orden de impresión
 * @param desplazamiento cuánto más abajo (en puntos, desde arriba) va el de abajo respecto al de arriba
 * @param linea dibuja la línea «cortar aquí» entre los dos
 */
export async function componerMediasHojas(items, { desplazamiento, linea = true, textoLinea = '', porHoja = 2 } = {}) {
  const salida = await PDFDocument.create();
  const fuente = textoLinea ? await salida.embedFont(StandardFonts.HelveticaBold) : null;
  let hoja = null; let usada = 0;   // 0 = vacía, 1 = mitad de arriba usada
  for (const it of items) {
    const origen = await PDFDocument.load(it.buffer);
    if (it.completa) {
      const paginas = await salida.copyPages(origen, origen.getPageIndices());
      for (const p of paginas) salida.addPage(p);
      hoja = null; usada = 0;
      continue;
    }
    const pag = origen.getPage(0);
    const { width: W, height: H } = pag.getSize();
    const mitad = await salida.embedPage(pag, { left: 0, right: W, bottom: H / 2, top: H });
    if (!hoja || usada === 2 || porHoja === 1) { hoja = salida.addPage([W, H]); usada = 0; }
    if (usada === 0) {
      hoja.drawPage(mitad, { x: 0, y: H / 2 });
      if (linea) {
        hoja.drawLine({ start: { x: 10, y: H / 2 }, end: { x: W - 10, y: H / 2 }, thickness: 0.6, color: rgb(0.33, 0.33, 0.33), dashArray: [4, 3] });
        if (fuente) {
          const ancho = fuente.widthOfTextAtSize(textoLinea, 7);
          hoja.drawRectangle({ x: W / 2 - 34, y: H / 2 - 5, width: 68, height: 10, color: rgb(1, 1, 1) });
          hoja.drawText(textoLinea, { x: W / 2 - ancho / 2, y: H / 2 - 2.5, size: 7, font: fuente, color: rgb(0.33, 0.33, 0.33) });
        }
      }
      usada = 1;
    } else {
      hoja.drawPage(mitad, { x: 0, y: H / 2 - desplazamiento });
      usada = 2;
    }
  }
  if (!salida.getPageCount()) salida.addPage();
  return Buffer.from(await salida.save());
}
