// Remesas de Dulces & Dulces (módulo REMESAS DULCES de la plantilla):
// base de viajes por VPL (fecha, zona, peso, manifiesto, conductor, placa, remesa, costo),
// cédulas de los conductores y la remesa impresa, dos por hoja carta.
import PDFDocument from 'pdfkit';
import { RemesaDulces, Tercero, Vehiculo, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar, fmtFecha } from '../../utils/texto.js';
import { leerLibro, filas, txt, entero, num, fecha } from '../importacion/excel.js';
import { pdfABuffer } from '../reportes/comun.js';

const COLUMNAS = ['VPL', 'FECHA', 'ZONA', 'PESO', 'MANIFIESTO', 'CONDUCTOR', 'PLACA', 'REMESA', 'COSTO'];

// Lee la hoja BASE (o la primera con esas columnas) y agrega o actualiza por VPL
export async function importarBase(empresaId, buffer) {
  if (!buffer?.length) throw new ErrorHttp(400, 'Adjunte el archivo de Excel');
  const wb = await leerLibro(buffer);
  let datos = null;
  for (const ws of wb.worksheets) {
    const fs = filas(ws);
    const i = fs.findIndex(f => f.map(c => normalizar(c)).includes('VPL'));
    if (i < 0) continue;
    const enc = fs[i].map(c => normalizar(c));
    const idx = Object.fromEntries(COLUMNAS.map(c => [c, enc.indexOf(c)]));
    datos = fs.slice(i + 1).filter(f => txt(f[idx.VPL])).map(f => ({
      vpl: entero(f[idx.VPL]), fecha: idx.FECHA >= 0 ? fecha(f[idx.FECHA]) : null, zona: txt(f[idx.ZONA]), peso: num(f[idx.PESO]) || 0,
      manifiesto: txt(f[idx.MANIFIESTO]), conductor: txt(f[idx.CONDUCTOR]), placa: txt(f[idx.PLACA]).replace(/[\s-]/g, '').toUpperCase(),
      remesa: txt(f[idx.REMESA]), costo: num(f[idx.COSTO]) || 0,
    }));
    break;
  }
  if (!datos) throw new ErrorHttp(400, `No se encontró una hoja con las columnas ${COLUMNAS.join(', ')}`);
  let nuevos = 0; let actualizados = 0;
  for (const d of datos) {
    const r = await RemesaDulces.updateOne({ empresa: empresaId, vpl: d.vpl }, { $set: d }, { upsert: true });
    if (r.upsertedCount) nuevos += 1; else if (r.modifiedCount) actualizados += 1;
  }
  return { leidos: datos.length, nuevos, actualizados };
}

// Cédula del conductor: por placa (conductor habitual) o por nombre
export async function cedulaDe(empresaId, x) {
  const v = x.placa ? await Vehiculo.findOne({ empresa: empresaId, placa: x.placa }).populate(pob(empresaId, 'conductorHabitual', 'numId')).lean() : null;
  if (v?.conductorHabitual?.numId) return v.conductorHabitual.numId;
  const palabras = normalizar(x.conductor).split(' ').filter(Boolean);
  if (!palabras.length) return '';
  const candidatos = await Tercero.find({ empresa: empresaId, roles: 'conductor', nombres: new RegExp(palabras[0], 'i') }).select('numId nombres apellido1 apellido2').lean();
  const t = candidatos.find(c => palabras.every(p => normalizar(`${c.nombres} ${c.apellido1} ${c.apellido2}`).includes(p)));
  return t?.numId || '';
}

// Remesas en PDF, dos por hoja carta
export async function remesasPdf(empresa, lista) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 30, info: { Title: 'Remesas' } });
  const ancho = doc.page.width - 60;
  const alto = (doc.page.height - 60 - 20) / 2;
  const $ = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
  lista.forEach((x, i) => {
    if (i > 0 && i % 2 === 0) doc.addPage();
    const y0 = 30 + (i % 2) * (alto + 20);
    doc.rect(30, y0, ancho, alto).lineWidth(0.8).stroke('#000');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text('REMESA TERRESTRE DE CARGA', 40, y0 + 12, { width: ancho - 20, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(`${empresa.rndc?.razonSocial || empresa.nombre} · NIT ${empresa.nit}${empresa.dv ? `-${empresa.dv}` : ''} · ${empresa.direccion || ''} ${empresa.telefono ? `· Tel ${empresa.telefono}` : ''}`, 40, y0 + 30, { width: ancho - 20, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).text(`Remesa N° ${x.remesa || '—'}`, 40, y0 + 50).text(`VPL ${x.vpl}`, 40, y0 + 50, { width: ancho - 20, align: 'right' });
    const campos = [['Cliente', 'DULCES & DULCES'], ['Fecha', x.fecha ? fmtFecha(x.fecha) : ''], ['Zona / destino', x.zona], ['Peso (kg)', x.peso ? Number(x.peso).toLocaleString('es-CO') : ''],
      ['Manifiesto', x.manifiesto], ['Conductor', x.conductor], ['Cédula', x.cedula || ''], ['Placa', x.placa], ['Costo del flete', x.costo ? $(x.costo) : '']];
    let y = y0 + 78;
    for (const [k, v] of campos) {
      doc.font('Helvetica-Bold').fontSize(10).text(k, 50, y, { width: 150 });
      doc.font('Helvetica').text(String(v || ''), 200, y, { width: ancho - 190 });
      doc.moveTo(200, y + 13).lineTo(ancho + 20, y + 13).lineWidth(0.3).stroke('#999');
      y += 22;
    }
    doc.moveTo(60, y0 + alto - 30).lineTo(250, y0 + alto - 30).stroke('#000');
    doc.moveTo(ancho - 200, y0 + alto - 30).lineTo(ancho + 10, y0 + alto - 30).stroke('#000');
    doc.fontSize(8).text('Firma conductor', 60, y0 + alto - 26, { width: 190, align: 'center' }).text('Recibido (firma y sello)', ancho - 200, y0 + alto - 26, { width: 210, align: 'center' });
  });
  return pdfABuffer(doc);
}
