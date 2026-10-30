// Cierre de mes: un mes cerrado (aaaa-mm) ya no admite registrar, modificar ni anular viajes,
// liquidaciones, préstamos ni asientos con fecha de ese mes (equivale al cierre de la plantilla,
// que archivaba las filas del mes; aquí los datos se conservan y quedan bloqueados).
import { Empresa, Viaje, Liquidacion, LiquidacionConductor, FacturaCont } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { enColombia } from '../../utils/texto.js';

export const mesDe = (fecha) => { const c = enColombia(new Date(fecha)); return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}`; };
const rangoMes = (mes) => { const [a, m] = mes.split('-').map(Number); return { desde: new Date(Date.UTC(a, m - 1, 1)), hasta: new Date(Date.UTC(a, m, 0, 23, 59, 59)) }; };

export async function mesesCerrados(empresaId) {
  const e = await Empresa.findById(empresaId).select('cierres').lean();
  return new Set((e?.cierres || []).map(c => c.mes));
}

// Lanza 409 si alguna de las fechas cae en un mes cerrado
export async function asegurarMesAbierto(empresaId, ...fechas) {
  const cerrados = await mesesCerrados(empresaId);
  if (!cerrados.size) return;
  for (const f of fechas.filter(Boolean)) {
    const m = mesDe(f);
    if (cerrados.has(m)) throw new ErrorHttp(409, `El mes ${m} está cerrado: no se puede registrar ni modificar información con esa fecha. El administrador puede reabrirlo.`);
  }
}

// Resumen del mes antes de cerrarlo (lo que la plantilla revisaba: viajes, pendientes RNDC, sin facturar, sin liquidar)
export async function resumenMes(empresaId, mes) {
  const { desde, hasta } = rangoMes(mes);
  const f = { empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' } };
  const [viajes, pendientesRndc, sinFacturar, sinLiquidarConductor, liquidaciones, liqConductores, facturas] = await Promise.all([
    Viaje.countDocuments(f),
    Viaje.countDocuments({ ...f, requiereManifiesto: { $ne: false }, historico: { $ne: true }, estado: { $in: ['registrado', 'remesa'] } }),
    Viaje.countDocuments({ ...f, liquidacion: null }),
    Viaje.countDocuments({ ...f, liquidacionConductor: null }),
    Liquidacion.countDocuments({ empresa: empresaId, desde: { $lte: hasta }, hasta: { $gte: desde }, estado: { $ne: 'anulada' } }),
    LiquidacionConductor.countDocuments({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: 'VIGENTE' }),
    FacturaCont.countDocuments({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'ANULADA' } }),
  ]);
  const avisos = [];
  if (pendientesRndc) avisos.push(`${pendientesRndc} viaje(s) sin manifiesto expedido en el RNDC`);
  if (sinFacturar) avisos.push(`${sinFacturar} viaje(s) sin liquidación de fletes al cliente (sin facturar)`);
  if (sinLiquidarConductor) avisos.push(`${sinLiquidarConductor} viaje(s) sin liquidación al conductor`);
  return { mes, viajes, pendientesRndc, sinFacturar, sinLiquidarConductor, liquidaciones, liqConductores, facturas, avisos };
}

// Antes de cerrar se guarda en el archivo del servidor la copia completa de los datos, los informes
// por empresa (cliente) y los PDF de manifiestos del mes. Si no se pueden guardar, el mes no se cierra.
export async function cerrarMes(empresaId, mes, usuario) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErrorHttp(400, 'Mes inválido (aaaa-mm)');
  if (mes >= mesDe(new Date())) throw new ErrorHttp(409, 'Solo se pueden cerrar meses ya terminados');
  const cerrados = await mesesCerrados(empresaId);
  if (cerrados.has(mes)) throw new ErrorHttp(409, `El mes ${mes} ya está cerrado`);
  const resumen = await resumenMes(empresaId, mes);
  const { archivarMes } = await import('./archivo.js');
  let archivo;
  try { archivo = await archivarMes(empresaId, mes); }
  catch (e) { throw new ErrorHttp(500, `No se pudo guardar la copia del mes; el mes no se cerró: ${e.message}`); }
  if (archivo.errores.length) resumen.avisos.push(`${archivo.errores.length} manifiesto(s) no se pudieron archivar en PDF`);
  await Empresa.updateOne({ _id: empresaId }, { $push: { cierres: { mes, fecha: new Date(), usuario, resumen, archivos: archivo.archivos } } });
  return { ...resumen, archivos: archivo.archivos, erroresArchivo: archivo.errores };
}

export async function reabrirMes(empresaId, mes) {
  const r = await Empresa.updateOne({ _id: empresaId }, { $pull: { cierres: { mes } } });
  if (!r.modifiedCount) throw new ErrorHttp(404, `El mes ${mes} no estaba cerrado`);
}
