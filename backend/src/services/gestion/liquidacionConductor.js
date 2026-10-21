// Liquidación del conductor (pago por placa/conductor y periodo), reglas de la plantilla:
//   Retefuente: 1 % del flete a todos los viajes.
//   FOPAT: 0,1 % del flete solo si el PBV del vehículo supera 10.500 kg y el destino no es Pasto.
//   Saldo = flete - anticipo - retefuente - FOPAT; al liquidar se descuentan las cuotas vencidas de préstamos.
import { Viaje, Vehiculo, LiquidacionConductor, siguiente, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar } from '../../utils/texto.js';
import { postear } from './contabilidad.js';
import { asegurarMesAbierto } from './cierre.js';
import { cuotaPendiente, descontar, revertirDescuentos } from './prestamos.js';

export const RETE_PCT = 0.01; export const FOPAT_PCT = 0.001; export const PBV_MIN = 10500;
export const esPasto = (destino) => /pasto/i.test(String(destino || ''));
export const retefuente = (flete) => Math.round(flete * RETE_PCT);
export const fopat = (flete, pbv, destino) => (Number(pbv) > PBV_MIN && !esPasto(destino) ? Math.round(flete * FOPAT_PCT) : 0);
const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');

// Viajes sin liquidar al conductor en el rango; `q`: todas las palabras deben aparecer (placa, conductor, empresa, destino…)
export async function calcular(empresaId, { desde, hasta, q = '', placa = '', conductor = '', incluirLiquidados = false }) {
  const f = { empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' } };
  if (!incluirLiquidados) f.liquidacionConductor = null;
  if (placa) f.placa = String(placa).toUpperCase();
  if (conductor) f.conductor = conductor;
  const viajes = await Viaje.find(f).sort({ placa: 1, fecha: 1, numero: 1 })
    .populate([pob(empresaId, 'conductor', 'nombres apellido1 apellido2 numId'), pob(empresaId, 'cliente', 'nombre')]).lean();
  const pbv = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: [...new Set(viajes.map(v => v.placa))] } }).select('placa pbv').lean()).map(v => [v.placa, v.pbv]));
  const palabras = normalizar(q).split(' ').filter(Boolean);
  const lineas = [];
  for (const v of viajes) {
    const cond = nombre(v.conductor) || v.conductorNombre;
    const texto = normalizar(`${v.cliente?.nombre} ${cond} ${v.placa} ${v.destino} ${v.conductor?.numId || ''} ${v.manifiesto?.numero || ''}`);
    if (palabras.length && !palabras.every(p => texto.includes(p))) continue;
    const flete = Number(v.flete) || 0; const anticipo = Number(v.anticipo) || 0;
    const rt = retefuente(flete); const fp = fopat(flete, pbv.get(v.placa), v.destino);
    lineas.push({ viaje: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: cond, cedula: v.conductor?.numId || '',
      conductorId: v.conductor?._id || null, empresa: v.cliente?.nombre || '', destino: v.destino, manifiesto: v.manifiesto?.numero || '',
      flete, anticipo, retefuente: rt, fopat: fp, saldo: flete - anticipo - rt - fp, liquidado: !!v.liquidacionConductor });
  }
  const tot = (k) => lineas.reduce((a, l) => a + l[k], 0);
  return { lineas, totales: { viajes: lineas.length, flete: tot('flete'), anticipo: tot('anticipo'), retefuente: tot('retefuente'), fopat: tot('fopat'), saldo: tot('saldo') } };
}

// Liquida los viajes elegidos (una placa / un conductor): descuenta préstamos, marca los viajes y contabiliza
export async function liquidar(empresaId, { viajes: ids, desde, hasta, descontarPrestamos = true, usuario }) {
  const { lineas } = await calcular(empresaId, { desde, hasta });
  const elegidas = lineas.filter(l => ids.map(String).includes(String(l.viaje)));
  if (!elegidas.length) throw new ErrorHttp(400, 'No hay viajes sin liquidar entre los elegidos');
  const cedulas = new Set(elegidas.map(l => l.cedula).filter(Boolean));
  if (cedulas.size > 1) throw new ErrorHttp(400, 'Liquide un conductor a la vez (los viajes elegidos son de varios conductores)');
  await asegurarMesAbierto(empresaId, new Date());
  const tot = (k) => elegidas.reduce((a, l) => a + l[k], 0);
  const flete = tot('flete'); const anticipo = tot('anticipo'); const rt = tot('retefuente'); const fp = tot('fopat');
  const base = flete - anticipo - rt - fp;
  const cedula = [...cedulas][0] || '';
  const numero = `LC-${String(await siguiente(empresaId, 'liqConductor')).padStart(4, '0')}`;
  let desc = { aplicado: 0, interes: 0 }; let detallePrestamos = '';
  if (descontarPrestamos && cedula && base > 0) {
    const pend = await cuotaPendiente(empresaId, cedula, new Date(hasta));
    if (pend.total > 0) { desc = await descontar(empresaId, cedula, Math.min(pend.total, base), numero, usuario); detallePrestamos = pend.detalle.join(', '); }
  }
  const neto = base - desc.aplicado;
  const l = await LiquidacionConductor.create({ empresa: empresaId, numero, fecha: new Date(), placa: [...new Set(elegidas.map(x => x.placa))].join(', '),
    conductor: elegidas[0].conductorId, conductorNombre: elegidas[0].conductor, cedula, desde, hasta, viajes: elegidas.map(x => x.viaje), lineas: elegidas,
    flete, anticipo, retefuente: rt, fopat: fp, descuentoPrestamos: desc.aplicado, interesPrestamos: desc.interes, neto,
    empresas: [...new Set(elegidas.map(x => x.empresa))].join(', '), creadoPor: usuario });
  await Viaje.updateMany({ empresa: empresaId, _id: { $in: l.viajes } }, { $set: { liquidacionConductor: l._id } });
  // Asiento: costo del flete contra anticipo, retenciones, préstamo (capital e interés) y cuenta por pagar al conductor
  await postear(empresaId, { fecha: l.fecha, documento: numero, concepto: `Liquidacion ${numero} - ${l.conductorNombre}`, origen: 'LIQ',
    terceroDoc: cedula, tercero: l.conductorNombre, usuario, lineas: [['6155', flete], ['1110', -anticipo], ['2365', -rt], ['2380', -fp],
      ['1385', -(desc.aplicado - desc.interes)], ['4210', -desc.interes], ['2205', -neto]] });
  return { liquidacion: l, detallePrestamos };
}

export async function anularLiquidacion(empresaId, numero) {
  const l = await LiquidacionConductor.findOne({ empresa: empresaId, numero });
  if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
  if (l.estado === 'ANULADA') throw new ErrorHttp(409, 'La liquidación ya estaba anulada');
  if (l.pagado > 0) throw new ErrorHttp(409, 'La liquidación ya tiene pagos registrados: no se puede anular');
  await asegurarMesAbierto(empresaId, l.fecha);
  await revertirDescuentos(empresaId, numero);
  await Viaje.updateMany({ empresa: empresaId, liquidacionConductor: l._id }, { $set: { liquidacionConductor: null } });
  l.estado = 'ANULADA';
  await l.save();
  const { Asiento } = await import('../../models/index.js');
  await Asiento.updateMany({ empresa: empresaId, documento: numero, origen: 'LIQ' }, { $set: { estado: 'ANULADO' } });
  return l;
}
