// Liquidación del conductor (pago por conductor, o por placa y empresa, en un periodo). Reglas de la
// plantilla, con porcentajes y destinos configurables por empresa (ver reglas.js):
//   Retefuente: 1 % del flete a todos los viajes.
//   FOPAT: 0,1 % del flete solo si el PBV del vehículo supera 10.500 kg y el destino no es Pasto.
//   Anticipo reconocido (RN-05): si el anticipo es mayor o igual al flete y el destino es Pasto,
//     Mayorista o Popayán, cuenta como 0.
//   Neto (RN-06) = flete + auxiliar − anticipo reconocido − retefuente − FOPAT − préstamos.
// Al liquidar se descuentan las cuotas vencidas de préstamos, o el valor que se escoja (máximo lo pendiente).
import { Viaje, Vehiculo, Tarifa, Cliente, LiquidacionConductor, siguiente, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar } from '../../utils/texto.js';
import { lineaLiquidacion, respaldosAuxiliar } from '../calculos.js';
import { postear } from './contabilidad.js';
import { asegurarMesAbierto } from './cierre.js';
import { cuotaPendiente, pendienteTotal, descontar, revertirDescuentos } from './prestamos.js';
import { REGLAS_BASE, reglasDe, destinoEn } from './reglas.js';

export const esPasto = (destino) => /pasto/i.test(String(destino || ''));
export const retefuente = (flete, reglas = REGLAS_BASE) => Math.round(flete * (Number(reglas.retefuenteConductorPct) || 0) / 100);
export const fopat = (flete, pbv, destino, reglas = REGLAS_BASE) => (Number(pbv) > Number(reglas.pbvFopat) && !destinoEn(destino, reglas.ciudadesSinFopat)
  ? Math.round(flete * (Number(reglas.fopatPct) || 0) / 100) : 0);
export const anticipoReconocido = (anticipo, flete, destino, reglas = REGLAS_BASE) =>
  (anticipo > 0 && anticipo >= flete && destinoEn(destino, reglas.ciudadesAnticipoCero) ? 0 : anticipo);
const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');

// Valores de una línea a partir de un viaje ya calculado (se exporta para las pruebas de aceptación)
export function lineaConductor({ flete, auxiliar = 0, anticipo = 0, pbv = null, destino = '' }, reglas = REGLAS_BASE) {
  const rt = retefuente(flete, reglas); const fp = fopat(flete, pbv, destino, reglas);
  const antRec = anticipoReconocido(anticipo, flete, destino, reglas);
  return { retefuente: rt, fopat: fp, anticipoReconocido: antRec, saldo: flete + auxiliar - antRec - rt - fp };
}

// Viajes sin liquidar al conductor en el rango; `q`: todas las palabras deben aparecer (placa, conductor, empresa, destino…)
export async function calcular(empresaId, { desde, hasta, q = '', placa = '', conductor = '', incluirLiquidados = false }) {
  const reglas = await reglasDe(empresaId);
  const f = { empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' } };
  if (!incluirLiquidados) f.liquidacionConductor = null;
  if (placa) f.placa = String(placa).toUpperCase();
  if (conductor) f.conductor = conductor;
  const viajes = await Viaje.find(f).sort({ placa: 1, fecha: 1, numero: 1 })
    .populate([pob(empresaId, 'conductor', 'nombres apellido1 apellido2 numId'), pob(empresaId, 'cliente', 'nombre siglas')]).lean();
  const pbv = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: [...new Set(viajes.map(v => v.placa))] } }).select('placa pbv').lean()).map(v => [v.placa, v.pbv]));
  const tarifas = await Tarifa.find({ empresa: empresaId, cliente: { $in: [...new Set(viajes.map(v => String(v.cliente?._id || v.cliente)))] } }).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldo = respaldosAuxiliar(tarifas);
  const palabras = normalizar(q).split(' ').filter(Boolean);
  const lineas = [];
  for (const v of viajes) {
    const cond = nombre(v.conductor) || v.conductorNombre;
    const texto = normalizar(`${v.cliente?.nombre} ${cond} ${v.placa} ${v.destino} ${v.conductor?.numId || ''} ${v.manifiesto?.numero || ''}`);
    if (palabras.length && !palabras.every(p => texto.includes(p))) continue;
    const flete = Number(v.flete) || 0; const anticipo = Number(v.anticipo) || 0;
    const auxiliar = lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo: respaldo.get(String(v.cliente?._id)) }).totalAuxiliarPagado;
    const c = lineaConductor({ flete, auxiliar, anticipo, pbv: pbv.get(v.placa), destino: v.destino }, reglas);
    lineas.push({ viaje: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: cond, cedula: v.conductor?.numId || '',
      conductorId: v.conductor?._id || null, clienteId: v.cliente?._id || null, empresa: v.cliente?.nombre || '', siglas: v.cliente?.siglas || '',
      destino: v.destino, manifiesto: v.manifiesto?.numero || '', flete, auxiliar, anticipo, ...c, liquidado: !!v.liquidacionConductor });
  }
  return { lineas, totales: totalesLineas(lineas) };
}

export function totalesLineas(lineas) {
  const tot = (k) => lineas.reduce((a, l) => a + (Number(l[k]) || 0), 0);
  return { viajes: lineas.length, flete: tot('flete'), auxiliar: tot('auxiliar'), anticipo: tot('anticipo'), anticipoReconocido: tot('anticipoReconocido'),
    retefuente: tot('retefuente'), fopat: tot('fopat'), saldo: tot('saldo') };
}

// Número con las siglas del cliente (COR-0001); si mezcla clientes o el cliente no tiene siglas, las de la empresa (LC-0001)
async function numeroLiquidacion(empresaId, elegidas, reglas) {
  const clientes = [...new Set(elegidas.map(l => String(l.clienteId)))];
  let siglas = '';
  if (clientes.length === 1) siglas = (await Cliente.findOne({ empresa: empresaId, _id: clientes[0] }).select('siglas').lean())?.siglas || '';
  siglas = (siglas || reglas.siglasLiquidacion || 'LC').toUpperCase();
  const clave = siglas === 'LC' ? 'liqConductor' : `liqConductor:${siglas}`;
  return `${siglas}-${String(await siguiente(empresaId, clave)).padStart(4, '0')}`;
}

// Liquida los viajes elegidos: un conductor (agrupacion «conductor») o una placa de una empresa («placa_empresa»).
// `descuentoPrestamos`: valor a descontar de préstamos (máximo lo pendiente); sin él se descuentan las cuotas vencidas.
export async function liquidar(empresaId, { viajes: ids, desde, hasta, descontarPrestamos = true, descuentoPrestamos, agrupacion = 'conductor', usuario }) {
  const reglas = await reglasDe(empresaId);
  const { lineas } = await calcular(empresaId, { desde, hasta });
  const elegidas = lineas.filter(l => ids.map(String).includes(String(l.viaje)));
  if (!elegidas.length) throw new ErrorHttp(400, 'No hay viajes sin liquidar entre los elegidos');
  const cedulas = new Set(elegidas.map(l => l.cedula).filter(Boolean));
  if (agrupacion === 'placa_empresa') {
    if (new Set(elegidas.map(l => l.placa)).size > 1 || new Set(elegidas.map(l => String(l.clienteId))).size > 1) {
      throw new ErrorHttp(400, 'Liquide una placa de una empresa a la vez (los viajes elegidos son de varias placas o empresas)');
    }
  } else if (cedulas.size > 1) throw new ErrorHttp(400, 'Liquide un conductor a la vez (los viajes elegidos son de varios conductores)');
  await asegurarMesAbierto(empresaId, new Date());
  const t = totalesLineas(elegidas);
  const base = t.saldo;
  const cedula = cedulas.size === 1 ? [...cedulas][0] : '';
  // El descuento se valida antes de numerar: un intento rechazado no consume consecutivo
  const pedido = descuentoPrestamos === undefined || descuentoPrestamos === null ? null : Math.max(0, Math.round(Number(descuentoPrestamos) || 0));
  if (pedido && !cedula) throw new ErrorHttp(400, 'Para descontar préstamos los viajes deben ser de un solo conductor');
  let valor = 0; let detallePrestamos = '';
  if (descontarPrestamos && cedula && base > 0) {
    if (pedido === null) {
      const pend = await cuotaPendiente(empresaId, cedula, new Date(hasta));
      valor = Math.min(pend.total, base); detallePrestamos = pend.detalle.join(', ');
    } else if (pedido > 0) {
      const total = await pendienteTotal(empresaId, cedula);
      if (pedido > total) throw new ErrorHttp(400, `El descuento (${pedido.toLocaleString('es-CO')}) supera lo pendiente de préstamos (${total.toLocaleString('es-CO')})`);
      if (pedido > base) throw new ErrorHttp(400, `El descuento de préstamos (${pedido.toLocaleString('es-CO')}) supera el saldo de la liquidación (${base.toLocaleString('es-CO')})`);
      valor = pedido; detallePrestamos = `Descuento escogido: ${pedido}`;
    }
  }
  const numero = await numeroLiquidacion(empresaId, elegidas, reglas);
  const desc = valor > 0 ? await descontar(empresaId, cedula, valor, numero, usuario) : { aplicado: 0, interes: 0 };
  const neto = base - desc.aplicado;
  const conductores = [...new Set(elegidas.map(x => x.conductor).filter(Boolean))];
  const l = await LiquidacionConductor.create({ empresa: empresaId, numero, fecha: new Date(), placa: [...new Set(elegidas.map(x => x.placa))].join(', '),
    conductor: cedula ? elegidas[0].conductorId : null, conductorNombre: conductores.join(' / '), cedula, desde, hasta, viajes: elegidas.map(x => x.viaje), lineas: elegidas,
    flete: t.flete, auxiliar: t.auxiliar, anticipo: t.anticipo, anticipoReconocido: t.anticipoReconocido, retefuente: t.retefuente, fopat: t.fopat,
    descuentoPrestamos: desc.aplicado, interesPrestamos: desc.interes, neto, agrupacion,
    empresas: [...new Set(elegidas.map(x => x.empresa))].join(', '), creadoPor: usuario });
  await Viaje.updateMany({ empresa: empresaId, _id: { $in: l.viajes } }, { $set: { liquidacionConductor: l._id } });
  // Asiento: costo del flete y el auxiliar contra anticipo reconocido, retenciones, préstamo (capital e interés) y cuenta por pagar
  await postear(empresaId, { fecha: l.fecha, documento: numero, concepto: `Liquidacion ${numero} - ${l.conductorNombre}`, origen: 'LIQ',
    terceroDoc: cedula, tercero: l.conductorNombre, usuario, lineas: [['6155', t.flete + t.auxiliar], ['1110', -t.anticipoReconocido], ['2365', -t.retefuente], ['2380', -t.fopat],
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
