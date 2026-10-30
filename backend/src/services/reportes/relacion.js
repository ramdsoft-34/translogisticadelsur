// Relación de viajes de un cliente (lo que se le cobra en el periodo), para enviarla por correo.
// No incluye lo que se paga al conductor ni la utilidad. Sin los viajes «[NO FACTURAR]».
import { Empresa, Cliente, Viaje, Tarifa, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { fmtFecha } from '../../utils/texto.js';
import { lineaLiquidacion, respaldosAuxiliar, NO_FACTURAR } from '../calculos.js';
import { nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer, libroExcel } from './comun.js';

const nombreT = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
const $ = (n) => Math.round(Number(n) || 0);

export async function relacionCliente(empresaId, clienteId, desde, hasta) {
  const [empresa, cliente] = await Promise.all([Empresa.findById(empresaId).lean(), Cliente.findOne({ empresa: empresaId, _id: clienteId }).lean()]);
  if (!cliente) throw new ErrorHttp(404, 'Cliente no encontrado');
  const viajes = await Viaje.find({ empresa: empresaId, cliente: clienteId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' }, observaciones: { $not: NO_FACTURAR } })
    .sort({ fecha: 1, numero: 1 }).populate(pob(empresaId, 'conductor', 'nombres apellido1 apellido2')).lean();
  const tarifas = await Tarifa.find({ empresa: empresaId, cliente: clienteId }).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t])); const respaldo = respaldosAuxiliar(tarifas).get(String(clienteId));
  const lineas = viajes.map(v => ({ v, l: lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo, cliente }) }));
  const filas = lineas.map(({ v, l }) => [v.numero, fmtFecha(v.fecha), v.placa, nombreT(v.conductor) || v.conductorNombre, v.destino, v.planilla || '',
    v.manifiesto?.numero || v.soporteInterno?.mc || '', l.cantidad, $(l.totalTarifa), $(l.totalAuxiliar), $(l.totalCobrado)]);
  const total = { tarifa: lineas.reduce((a, x) => a + x.l.totalTarifa, 0), auxiliar: lineas.reduce((a, x) => a + x.l.totalAuxiliar, 0), cobrado: lineas.reduce((a, x) => a + x.l.totalCobrado, 0) };
  const titulo = `Relación de viajes - ${cliente.nombre}`;
  const subtitulo = `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · ${lineas.length} viaje(s)`;
  const columnas = [{ titulo: 'N°', peso: 0.5 }, { titulo: 'Fecha', peso: 0.9 }, { titulo: 'Placa', peso: 0.8 }, { titulo: 'Conductor', peso: 1.8 },
    { titulo: 'Destino', peso: 1.6 }, { titulo: 'Planilla', peso: 0.8 }, { titulo: 'Manifiesto', peso: 1 }, { titulo: 'Cant.', peso: 0.5, alin: 'right' },
    { titulo: 'Tarifa', peso: 1, alin: 'right' }, { titulo: 'Auxiliar', peso: 1, alin: 'right' }, { titulo: 'Total', peso: 1, alin: 'right' }];
  const m = (v) => `$ ${$(v).toLocaleString('es-CO')}`;
  const filaTotal = (fm) => ['', '', '', 'TOTAL', '', '', '', '', fm(total.tarifa), fm(total.auxiliar), fm(total.cobrado)];
  const doc = nuevoPdf(titulo);
  encabezadoPdf(doc, { empresa, titulo, subtitulo });
  tablaPdf(doc, columnas, filas.map(f => f.map((v, i) => (i > 7 ? m(v) : v))), { total: filaTotal(m) });
  numerarPaginas(doc);
  const pdf = await pdfABuffer(doc);
  const xlsx = await libroExcel({ empresa, titulo, subtitulo, columnas: columnas.map((c, i) => ({ ...c, ancho: [6, 12, 10, 30, 26, 12, 14, 7, 14, 14, 14][i], formato: i > 7 ? '#,##0' : undefined })),
    filas, total: filaTotal(v => v) });
  return { empresa, cliente, viajes: lineas.length, total: total.cobrado, pdf, xlsx, titulo, subtitulo };
}
