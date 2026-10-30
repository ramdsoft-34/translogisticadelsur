// Contabilidad simplificada (módulo de contabilidad de la plantilla). Apoyo administrativo:
// un contador debe revisarla. Partida doble: cada asiento cuadra (débitos = créditos).
import { CuentaContable, Asiento, FacturaCont, LiquidacionConductor, Viaje, Cliente, Tarifa, siguiente, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { asegurarMesAbierto } from './cierre.js';
import { lineaLiquidacion, respaldosAuxiliar, NO_FACTURAR } from '../calculos.js';

// Plan de cuentas de la plantilla (_CONT_PUC)
export const PUC_BASE = [
  ['1105', 'Caja', 'ACTIVO', 'D'], ['1110', 'Bancos', 'ACTIVO', 'D'],
  ['1305', 'Clientes (cuentas por cobrar por fletes)', 'ACTIVO', 'D'],
  ['1355', 'Retencion en la fuente a favor (practicada por clientes)', 'ACTIVO', 'D'],
  ['1356', 'Retencion de ICA a favor (practicada por clientes)', 'ACTIVO', 'D'],
  ['1385', 'Prestamos a conductores', 'ACTIVO', 'D'],
  ['2205', 'Cuentas por pagar a conductores y propietarios', 'PASIVO', 'C'],
  ['2335', 'Costos y gastos por pagar', 'PASIVO', 'C'], ['2365', 'Retencion en la fuente por pagar', 'PASIVO', 'C'],
  ['2380', 'FOPAT y contribuciones por pagar', 'PASIVO', 'C'], ['3115', 'Aportes sociales', 'PATRIMONIO', 'C'],
  ['3605', 'Excedentes del ejercicio', 'PATRIMONIO', 'C'], ['4135', 'Ingresos por servicio de transporte de carga', 'INGRESO', 'C'],
  ['4210', 'Ingresos financieros (intereses de prestamos)', 'INGRESO', 'C'], ['5105', 'Gastos de personal', 'GASTO', 'D'],
  ['5135', 'Servicios', 'GASTO', 'D'], ['5195', 'Gastos diversos', 'GASTO', 'D'], ['5305', 'Gastos financieros', 'GASTO', 'D'],
  ['6155', 'Costo de transporte: fletes a conductores', 'COSTO', 'D'],
];

export async function asegurarPuc(empresaId) {
  if (await CuentaContable.exists({ empresa: empresaId })) return;
  await CuentaContable.insertMany(PUC_BASE.map(([codigo, nombre, tipo, naturaleza]) => ({ empresa: empresaId, codigo, nombre, tipo, naturaleza })), { ordered: false }).catch(() => {});
}

// Registra un asiento. lineas: [[cuenta, valor]] con valor positivo = débito y negativo = crédito.
export async function postear(empresaId, { fecha, documento = '', concepto = '', origen = 'MAN', terceroDoc = '', tercero = '', centroCosto = '', lineas, usuario = null }) {
  await asegurarPuc(empresaId);
  await asegurarMesAbierto(empresaId, fecha);
  const cuentas = new Map((await CuentaContable.find({ empresa: empresaId }).lean()).map(c => [c.codigo, c]));
  const ls = lineas.filter(([, v]) => Math.round(Number(v) || 0) !== 0).map(([cuenta, v]) => {
    const c = cuentas.get(String(cuenta));
    if (!c) throw new ErrorHttp(400, `La cuenta ${cuenta} no existe en el plan de cuentas`);
    const val = Math.round(Number(v));
    return { cuenta: c.codigo, nombre: c.nombre, debito: val > 0 ? val : 0, credito: val < 0 ? -val : 0 };
  });
  if (!ls.length) throw new ErrorHttp(400, 'El asiento no tiene valores');
  const deb = ls.reduce((a, l) => a + l.debito, 0); const cre = ls.reduce((a, l) => a + l.credito, 0);
  if (deb !== cre) throw new ErrorHttp(400, `El asiento no cuadra: débitos ${deb} y créditos ${cre}`);
  const numero = `A-${String(await siguiente(empresaId, 'asiento')).padStart(5, '0')}`;
  return Asiento.create({ empresa: empresaId, numero, fecha, documento, concepto, origen, terceroDoc, tercero, centroCosto, lineas: ls, usuario });
}

export async function anularAsiento(empresaId, numero) {
  const a = await Asiento.findOne({ empresa: empresaId, numero });
  if (!a) throw new ErrorHttp(404, 'Asiento no encontrado');
  if (a.estado === 'ANULADO') throw new ErrorHttp(409, 'El asiento ya estaba anulado');
  await asegurarMesAbierto(empresaId, a.fecha);
  a.estado = 'ANULADO';
  await a.save();
  return a;
}

// ── Documentos ───────────────────────────────────────────────────────────────
// Facturas vigentes del mismo cliente cuyo periodo se cruza con el indicado
export async function facturasCruzadas(empresaId, { cliente, desde, hasta }) {
  return FacturaCont.find({ empresa: empresaId, cliente, estado: { $ne: 'ANULADA' }, desde: { $lte: hasta }, hasta: { $gte: desde } })
    .select('numero fecha desde hasta neto').sort({ desde: 1 }).lean();
}

// Factura a una empresa (cliente): suma la tarifa y el auxiliar (según la política del cliente, RN-15) de los
// viajes del rango, sin los marcados «[NO FACTURAR]». Sin IVA. Si el periodo se cruza con otra factura del
// mismo cliente se avisa y solo se factura con `permitirCruce`.
export async function facturar(empresaId, { cliente, desde, hasta, retefuentePct = 1, icaPct = 0, fecha = new Date(), usuario, permitirCruce = false }) {
  const cli = await Cliente.findOne({ empresa: empresaId, _id: cliente }).lean();
  if (!cli) throw new ErrorHttp(400, 'Cliente no encontrado');
  const cruces = await facturasCruzadas(empresaId, { cliente, desde, hasta });
  if (cruces.length && !permitirCruce) {
    throw new ErrorHttp(409, `El periodo se cruza con ${cruces.length === 1 ? 'la factura' : 'las facturas'} ${cruces.map(f => f.numero).join(', ')} del mismo cliente`,
      cruces.map(f => `${f.numero}: ${f.desde?.toISOString().slice(0, 10)} a ${f.hasta?.toISOString().slice(0, 10)}`));
  }
  const viajes = await Viaje.find({ empresa: empresaId, cliente, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' }, observaciones: { $not: NO_FACTURAR } }).lean();
  if (!viajes.length) throw new ErrorHttp(400, 'No hay viajes para facturar de ese cliente en el rango');
  const tarifas = await Tarifa.find({ empresa: empresaId, cliente }).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldo = respaldosAuxiliar(tarifas).get(String(cliente));
  const total = viajes.reduce((a, v) => a + lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo, cliente: cli }).totalCobrado, 0);
  const retefuente = Math.round(total * retefuentePct / 100);
  const ica = Math.round(total * icaPct / 100);
  const neto = total - retefuente - ica;
  const numero = `FV-${String(await siguiente(empresaId, 'factura')).padStart(4, '0')}`;
  const a = await postear(empresaId, { fecha, documento: numero, concepto: `Factura ${numero} - ${cli.nombre}`, origen: 'FAC',
    terceroDoc: cli.nit, tercero: cli.nombre, usuario, lineas: [['1305', neto], ['1355', retefuente], ['1356', ica], ['4135', -total]] });
  const f = await FacturaCont.create({ empresa: empresaId, numero, fecha, cliente, desde, hasta, viajes: viajes.length, total, retefuentePct, retefuente, icaPct, ica, neto, asiento: a.numero });
  return Object.assign(f.toObject(), { cruces: cruces.map(c => c.numero) });
}

export async function cobrar(empresaId, { factura, valor, fecha = new Date(), cuenta = '1110', usuario }) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero: factura }).populate(pob(empresaId, 'cliente'));
  if (!f || f.estado === 'ANULADA') throw new ErrorHttp(404, 'Factura no encontrada');
  const saldo = f.neto - f.cobrado;
  const v = Math.round(valor || saldo);
  if (v <= 0 || v > saldo) throw new ErrorHttp(400, `El valor debe estar entre 1 y el saldo (${saldo})`);
  const a = await postear(empresaId, { fecha, documento: f.numero, concepto: `Cobro factura ${f.numero}`, origen: 'COB',
    terceroDoc: f.cliente?.nit, tercero: f.cliente?.nombre, usuario, lineas: [[cuenta, v], ['1305', -v]] });
  f.cobrado += v;
  if (f.neto - f.cobrado <= 0) f.estado = 'COBRADA';
  await f.save();
  return { factura: f, asiento: a.numero };
}

export async function pagarLiquidacion(empresaId, { liquidacion, valor, fecha = new Date(), cuenta = '1110', usuario }) {
  const l = await LiquidacionConductor.findOne({ empresa: empresaId, numero: liquidacion });
  if (!l || l.estado === 'ANULADA') throw new ErrorHttp(404, 'Liquidación no encontrada');
  const saldo = l.neto - l.pagado;
  const v = Math.round(valor || saldo);
  if (v <= 0 || v > saldo) throw new ErrorHttp(400, `El valor debe estar entre 1 y el saldo (${saldo})`);
  const a = await postear(empresaId, { fecha, documento: l.numero, concepto: `Pago liquidación ${l.numero} - ${l.conductorNombre}`, origen: 'PAG',
    terceroDoc: l.cedula, tercero: l.conductorNombre, usuario, lineas: [['2205', v], [cuenta, -v]] });
  l.pagado += v;
  await l.save();
  return { liquidacion: l, asiento: a.numero };
}

export async function gasto(empresaId, { fecha, cuenta, concepto, valor, tercero = '', formaPago = '1110', usuario }) {
  if (!/^5\d{3}$/.test(String(cuenta))) throw new ErrorHttp(400, 'La cuenta del gasto debe ser de la clase 5 (5105, 5135, 5195, 5305)');
  return postear(empresaId, { fecha, concepto, origen: 'GAS', tercero, usuario, lineas: [[cuenta, valor], [formaPago, -valor]] });
}

// ── Informes ─────────────────────────────────────────────────────────────────
async function lineasActivas(empresaId, hasta, desde = null) {
  const f = { empresa: empresaId, estado: 'ACTIVO', fecha: { $lte: hasta, ...(desde ? { $gte: desde } : {}) } };
  return (await Asiento.find(f).sort({ fecha: 1, numero: 1 }).lean()).flatMap(a => a.lineas.map(l => ({ ...l, asiento: a })));
}

export async function libroDiario(empresaId, desde, hasta) {
  return Asiento.find({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta } }).sort({ fecha: 1, numero: 1 }).lean();
}

// Saldos por cuenta al corte (según naturaleza) → balance general y estado de resultados
export async function saldos(empresaId, hasta, desde = null) {
  await asegurarPuc(empresaId);
  const cuentas = await CuentaContable.find({ empresa: empresaId }).sort({ codigo: 1 }).lean();
  const sum = new Map();
  for (const l of await lineasActivas(empresaId, hasta, desde)) {
    const s = sum.get(l.cuenta) || { debito: 0, credito: 0 };
    s.debito += l.debito; s.credito += l.credito; sum.set(l.cuenta, s);
  }
  return cuentas.map(c => {
    const s = sum.get(c.codigo) || { debito: 0, credito: 0 };
    return { ...c, debito: s.debito, credito: s.credito, saldo: c.naturaleza === 'D' ? s.debito - s.credito : s.credito - s.debito };
  });
}

export async function balance(empresaId, hasta) {
  const s = await saldos(empresaId, hasta);
  const grupo = (t) => s.filter(c => c.tipo === t);
  const total = (l) => l.reduce((a, c) => a + c.saldo, 0);
  const ingresos = total(grupo('INGRESO')); const gastos = total(grupo('GASTO')) + total(grupo('COSTO'));
  return { activos: grupo('ACTIVO'), pasivos: grupo('PASIVO'), patrimonio: grupo('PATRIMONIO'),
    totalActivos: total(grupo('ACTIVO')), totalPasivos: total(grupo('PASIVO')), totalPatrimonio: total(grupo('PATRIMONIO')),
    resultadoEjercicio: ingresos - gastos };
}

export async function resultados(empresaId, desde, hasta) {
  const s = (await saldos(empresaId, hasta, desde)).filter(c => ['INGRESO', 'GASTO', 'COSTO'].includes(c.tipo));
  const ingresos = s.filter(c => c.tipo === 'INGRESO'); const costos = s.filter(c => c.tipo === 'COSTO'); const gastos = s.filter(c => c.tipo === 'GASTO');
  const t = (l) => l.reduce((a, c) => a + c.saldo, 0);
  return { ingresos, costos, gastos, totalIngresos: t(ingresos), totalCostos: t(costos), totalGastos: t(gastos), utilidad: t(ingresos) - t(costos) - t(gastos) };
}

export async function cuentasPorCobrar(empresaId) {
  return (await FacturaCont.find({ empresa: empresaId, estado: 'PENDIENTE' }).populate(pob(empresaId, 'cliente', 'nombre nit')).sort({ fecha: 1 }).lean())
    .map(f => ({ numero: f.numero, fecha: f.fecha, cliente: f.cliente?.nombre, neto: f.neto, cobrado: f.cobrado, saldo: f.neto - f.cobrado }));
}

export async function cuentasPorPagar(empresaId) {
  return (await LiquidacionConductor.find({ empresa: empresaId, estado: 'VIGENTE' }).sort({ fecha: 1 }).lean())
    .filter(l => l.neto - (l.pagado || 0) > 0)
    .map(l => ({ numero: l.numero, fecha: l.fecha, conductor: l.conductorNombre, placa: l.placa, neto: l.neto, pagado: l.pagado || 0, saldo: l.neto - (l.pagado || 0) }));
}

// Cartera por edades: saldo de las facturas pendientes por cliente según los días desde la factura
export const EDADES = [['d0_30', '0 a 30 días', 0, 30], ['d31_60', '31 a 60 días', 31, 60], ['d61_90', '61 a 90 días', 61, 90], ['d90', 'Más de 90 días', 91, Infinity]];
export async function carteraPorEdades(empresaId, corte = new Date()) {
  const g = new Map();
  for (const f of await cuentasPorCobrar(empresaId)) {
    const dias = Math.max(0, Math.floor((corte - new Date(f.fecha)) / 86400000));
    const x = g.get(f.cliente) || { cliente: f.cliente || '(sin cliente)', facturas: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 };
    const [k] = EDADES.find(([, , a, b]) => dias >= a && dias <= b);
    x[k] += f.saldo; x.total += f.saldo; x.facturas += 1;
    g.set(f.cliente, x);
  }
  const filas = [...g.values()].sort((a, b) => b.total - a.total);
  const totales = filas.reduce((a, x) => { for (const k of ['facturas', 'd0_30', 'd31_60', 'd61_90', 'd90', 'total']) a[k] += x[k]; return a; },
    { facturas: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 });
  return { filas, totales };
}

// Panel de resumen contable del mes: por cobrar, por pagar, facturado, cobrado, gastos y excedente
export async function resumenContable(empresaId, desde, hasta) {
  const [cxc, cxp, facturas, asientos, res] = await Promise.all([
    cuentasPorCobrar(empresaId), cuentasPorPagar(empresaId),
    FacturaCont.find({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'ANULADA' } }).select('total neto').lean(),
    Asiento.find({ empresa: empresaId, estado: 'ACTIVO', fecha: { $gte: desde, $lte: hasta }, origen: { $in: ['COB', 'PAG', 'GAS'] } }).lean(),
    resultados(empresaId, desde, hasta),
  ]);
  const suma = (l, k) => l.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const deOrigen = (o, f) => asientos.filter(a => a.origen === o).reduce((a, x) => a + x.lineas.filter(f).reduce((b, l) => b + l.debito, 0), 0);
  const cartera = await carteraPorEdades(empresaId);
  return {
    porCobrar: suma(cxc, 'saldo'), facturasPendientes: cxc.length, porPagar: suma(cxp, 'saldo'), liquidacionesPendientes: cxp.length,
    facturado: suma(facturas, 'total'), facturas: facturas.length,
    cobrado: deOrigen('COB', l => /^11/.test(l.cuenta)), pagadoConductores: deOrigen('PAG', l => l.cuenta === '2205'),
    gastos: res.totalGastos, costos: res.totalCostos, ingresos: res.totalIngresos, excedente: res.utilidad,
    carteraVencida: cartera.totales.d31_60 + cartera.totales.d61_90 + cartera.totales.d90,
  };
}

export async function retenciones(empresaId, desde, hasta) {
  const s = await saldos(empresaId, hasta, desde);
  return s.filter(c => ['1355', '1356', '2365', '2380'].includes(c.codigo));
}
