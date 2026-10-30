// Une varios PDF en uno solo (p. ej. todos los manifiestos de un correo).
import { PDFDocument } from 'pdf-lib';

export async function unirPdf(buffers) {
  const salida = await PDFDocument.create();
  for (const b of buffers) {
    const doc = await PDFDocument.load(b);
    for (const p of await salida.copyPages(doc, doc.getPageIndices())) salida.addPage(p);
  }
  return Buffer.from(await salida.save());
}
