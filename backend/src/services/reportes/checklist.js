// PDF del checklist preoperacional diario que el conductor diligencia en Sur Track.
import { nuevoPdf, encabezadoPdf, pdfABuffer, COLOR } from './comun.js';

export const ETIQUETAS_CHECKLIST = {
  documentos: { titulo: 'Documentos', items: {
    licenciaConduccion: 'Licencia de conducción', licenciaTransito: 'Licencia de tránsito', tarjetaOperacion: 'Tarjeta de operación',
    seguroSOAT: 'SOAT', revisionTecnica: 'Revisión técnico-mecánica', revisionPreventiva: 'Revisión preventiva',
    polizaResponsabilidad: 'Póliza de responsabilidad civil', formatoFUEC: 'Formato FUEC', soporteInspeccion: 'Soporte de inspección',
    soporteLimpieza: 'Soporte de limpieza' } },
  equipos: { titulo: 'Equipos de seguridad', items: {
    cinturonesPito: 'Cinturones y pito', luces: 'Luces', cajaHerramientas: 'Caja de herramientas', gatoConos: 'Gato y conos',
    extintor: 'Extintor', sistemaElectrico: 'Sistema eléctrico', sistemasBaterias: 'Baterías' } },
  vehiculo: { titulo: 'Estado del vehículo', items: {
    espejosRetrovisores: 'Espejos retrovisores', direccion: 'Dirección', inspeccionMotor: 'Motor', tanqueCombustible: 'Tanque de combustible',
    vidriosPanoramicos: 'Vidrios panorámicos', limpiaparabrisas: 'Limpiaparabrisas', frenosServicio: 'Frenos de servicio', llantasEstado: 'Estado de las llantas' } },
};

const fechaHora = (d) => (d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }) : '—');
const dia = (d) => (d ? new Date(d).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) : '—');

export async function checklistPdf(empresa, { viaje, conductor, checklist: c }) {
  const doc = nuevoPdf('Checklist preoperacional', 'portrait');
  encabezadoPdf(doc, { empresa, titulo: 'Checklist preoperacional diario',
    subtitulo: `Placa ${viaje.placa} · Conductor ${c.firma?.nombre || conductor?.nombre || viaje.conductor || '—'} · Diligenciado ${fechaHora(c.fecha)}` });
  const x0 = doc.page.margins.left; const ancho = doc.page.width - x0 - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(c.vigente ? '#1f7a3f' : '#b42318')
    .text(c.vigente ? 'VIGENTE HOY' : (c.completo ? 'NO VIGENTE (no es de hoy)' : 'INCOMPLETO'), x0, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#333').text(`Vencimiento revisión técnico-mecánica declarado: ${dia(c.venceRevisionTecnica)}`);
  if (c.resultado) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(c.resultado === 'apto' ? '#1f7a3f' : '#b42318')
      .text(`Resultado: ${c.resultado === 'apto' ? 'APTO' : 'NO APTO'}${c.kilometraje ? ` · Kilometraje ${Number(c.kilometraje).toLocaleString('es-CO')}` : ''}`);
    if (c.autorizacion?.fecha) doc.font('Helvetica').fontSize(9).fillColor('#333')
      .text(`Salida autorizada por ${c.autorizacion.por} el ${fechaHora(c.autorizacion.fecha)}. Motivo: ${c.autorizacion.motivo}`);
  }
  doc.moveDown(0.6);
  if (Array.isArray(c.detalle) && c.detalle.length) {
    const TXT = { bien: 'Bien', mal: 'Mal', na: 'N/A' };
    for (const [grupo, def] of Object.entries(ETIQUETAS_CHECKLIST)) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.primario).text(def.titulo, x0);
      doc.moveDown(0.2);
      for (const it of c.detalle.filter(i => i.grupo === grupo)) {
        const mal = it.valor === 'mal';
        const y = doc.y;
        const alto = mal && it.observacion ? 26 : 14;
        doc.rect(x0, y - 1, ancho, alto).fill(mal ? '#FDF2F2' : '#F3FAF5');
        doc.fillColor('#222').font('Helvetica').fontSize(9).text(`${it.nombre}${it.critico ? ' (crítico)' : ''}`, x0 + 6, y + 2, { width: ancho * 0.7 });
        doc.fillColor(mal ? '#b42318' : '#1f7a3f').font('Helvetica-Bold').text(TXT[it.valor] || '—', x0 + ancho * 0.75, y + 2);
        if (mal && it.observacion) doc.fillColor('#444').font('Helvetica').fontSize(8).text(it.observacion, x0 + 12, y + 14, { width: ancho - 24, height: 10, ellipsis: true });
        doc.y = y + alto + 1;
      }
      doc.moveDown(0.5);
    }
  } else for (const [grupo, def] of Object.entries(ETIQUETAS_CHECKLIST)) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.primario).text(def.titulo, x0);
    doc.moveDown(0.2);
    for (const [k, etiqueta] of Object.entries(def.items)) {
      const ok = c[grupo]?.[k] === true;
      const y = doc.y;
      doc.rect(x0, y - 1, ancho, 14).fill(ok ? '#F3FAF5' : '#FDF2F2');
      doc.fillColor('#222').font('Helvetica').fontSize(9).text(etiqueta, x0 + 6, y + 2, { width: ancho * 0.7 });
      doc.fillColor(ok ? '#1f7a3f' : '#b42318').font('Helvetica-Bold').text(ok ? 'Cumple' : 'No cumple', x0 + ancho * 0.75, y + 2);
      doc.y = y + 15;
    }
    doc.moveDown(0.5);
  }
  if (c.firma) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.primario).text('Firma del conductor', x0);
    const img = String(c.firma.imagenBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (img) { try { doc.image(Buffer.from(img, 'base64'), x0, doc.y + 4, { fit: [200, 80] }); doc.y += 88; } catch { /* imagen ilegible */ } }
    doc.font('Helvetica').fontSize(8.5).fillColor('#444')
      .text(`${c.firma.nombre || ''} · C.C. ${c.firma.cedula || '—'} · Firmado ${fechaHora(c.firma.fecha)}${c.firma.dispositivo ? ` · ${c.firma.dispositivo}` : ''}`, x0);
  }
  return pdfABuffer(doc);
}
