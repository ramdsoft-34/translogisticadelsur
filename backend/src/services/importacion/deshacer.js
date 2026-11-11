// Deshacer una importación de viajes (Importar datos → Viajes): elimina los viajes de ese archivo como si no se hubieran
// subido, después de guardar una copia completa (descargable en Excel). No toca los viajes que ya tienen documentos del
// RNDC, están liquidados o en una relación de cobro facturada.
import ExcelJS from 'exceljs';
import { Auditoria, EnvioWhatsapp, RespaldoViajes, Viaje, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { bloqueadosPorRelacion } from '../gestion/relaciones.js';
import { marcarLibro } from '../reportes/comun.js';
import { txt } from '../../utils/texto.js';

export async function lotesImportados(empresaId) {
  const regs = await Auditoria.find({ empresa: empresaId, accion: 'importar_viajes_excel' }).sort({ createdAt: -1 }).limit(50).lean();
  const salida = [];
  for (const a of regs) {
    const numeros = (a.detalle?.numeros || []).map(Number).filter(Boolean);
    if (!numeros.length) continue;
    const existentes = await Viaje.countDocuments({ empresa: empresaId, numero: { $in: numeros } });
    salida.push({ _id: a._id, fecha: a.createdAt, usuario: a.usuarioNombre, archivo: a.detalle?.archivo || '', creados: numeros.length,
      desde: Math.min(...numeros), hasta: Math.max(...numeros), existentes });
  }
  return salida;
}

async function viajesDelLote(empresaId, loteId) {
  const a = await Auditoria.findOne({ empresa: empresaId, _id: loteId, accion: 'importar_viajes_excel' }).lean();
  if (!a) throw new ErrorHttp(404, 'Importación no encontrada');
  const numeros = (a.detalle?.numeros || []).map(Number).filter(Boolean);
  const viajes = await Viaje.find({ empresa: empresaId, numero: { $in: numeros } }).sort({ numero: 1 }).lean();
  const facturados = await bloqueadosPorRelacion(empresaId, viajes.map((v) => v._id));
  const borrables = []; const omitidos = [];
  for (const v of viajes) {
    const motivo = v.liquidacionConductor ? 'Ya está liquidado al conductor' : v.liquidacion ? 'Está en una liquidación de fletes'
      : facturados.has(String(v._id)) ? `Está en la relación ${facturados.get(String(v._id))}, ya facturada`
        : (txt(v.remesa?.numero) || txt(v.manifiesto?.numero)) ? 'Tiene documentos del RNDC' : '';
    if (motivo) omitidos.push({ _id: v._id, numero: v.numero, placa: v.placa, motivo }); else borrables.push(v);
  }
  return { lote: a, borrables, omitidos };
}

export async function revisarDeshacer(empresaId, loteId) {
  const { lote, borrables, omitidos } = await viajesDelLote(empresaId, loteId);
  return { archivo: lote.detalle?.archivo || '', fecha: lote.createdAt, borrar: borrables.length, omitidos,
    muestra: borrables.slice(0, 200).map((v) => ({ numero: v.numero, fecha: v.fecha, placa: v.placa, destino: v.destino, soporte: v.soporteInterno?.mc || '' })) };
}

/** Guarda la copia y elimina los viajes del lote. */
export async function deshacerImportacion(empresaId, usuario, loteId) {
  const { lote, borrables, omitidos } = await viajesDelLote(empresaId, loteId);
  if (!borrables.length) throw new ErrorHttp(409, 'No queda ningún viaje de esa importación que se pueda borrar');
  const respaldo = await RespaldoViajes.create({ empresa: empresaId, motivo: `Deshacer importación «${lote.detalle?.archivo || 'archivo'}»`,
    archivo: lote.detalle?.archivo || '', usuario, viajes: borrables });
  const ids = borrables.map((v) => v._id);
  await EnvioWhatsapp.updateMany({ empresa: empresaId, viaje: { $in: ids }, estado: { $in: ['por_aprobar', 'pendiente'] } }, { $set: { estado: 'descartado', error: 'Viaje borrado (importación deshecha)' } });
  const r = await Viaje.deleteMany({ empresa: empresaId, _id: { $in: ids } });
  return { borrados: r.deletedCount, omitidos, respaldo: respaldo._id, numeros: borrables.map((v) => v.numero) };
}

/** Copia en Excel de los viajes borrados. */
export async function respaldoExcel(empresaId, respaldoId) {
  const r = await RespaldoViajes.findOne({ empresa: empresaId, _id: respaldoId }).populate(pob(empresaId, 'usuario', 'nombre')).lean();
  if (!r) throw new ErrorHttp(404, 'Copia no encontrada');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Viajes borrados');
  ws.addRow(['N°', 'Fecha', 'Placa', 'Conductor', 'Destino', 'Planilla', 'Cantidad', 'Tarifa', 'Flete', 'Anticipo', 'Días auxiliar', 'Soporte interno', 'Observaciones', 'Registrado']).font = { bold: true };
  for (const v of r.viajes) {
    ws.addRow([v.numero, v.fecha ? new Date(v.fecha) : '', v.placa, v.conductorNombre, v.destino, v.planilla, v.cantidad, v.tarifa, v.flete, v.anticipo,
      v.conAuxiliar ? v.diasAuxiliar || 1 : 0, v.soporteInterno?.mc || '', v.observaciones, v.createdAt ? new Date(v.createdAt) : '']);
  }
  ws.getColumn(2).numFmt = 'dd/mm/yyyy'; ws.getColumn(14).numFmt = 'dd/mm/yyyy hh:mm';
  ws.columns.forEach((c) => { c.width = 16; });
  const info = wb.addWorksheet('Información');
  info.addRow(['Motivo', r.motivo]); info.addRow(['Borrado', new Date(r.createdAt)]); info.addRow(['Por', r.usuario?.nombre || '']); info.addRow(['Viajes', r.viajes.length]);
  marcarLibro(wb);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nombre: `Viajes_borrados_${new Date(r.createdAt).toISOString().slice(0, 10)}.xlsx` };
}
