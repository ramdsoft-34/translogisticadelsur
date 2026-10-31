// Contabilidad simplificada (módulo de contabilidad de la plantilla). Apoyo administrativo:
// un contador debe revisarla. Partida doble: cada asiento cuadra (débitos = créditos).
import mongoose from 'mongoose';
import { CuentaContable, Asiento, FacturaCont, LiquidacionConductor, Viaje, Cliente, Tarifa, Empresa, CompraCont, Nomina, siguiente, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { asegurarMesAbierto } from './cierre.js';
import { lineaLiquidacion, respaldosAuxiliar, NO_FACTURAR } from '../calculos.js';

// Plan de cuentas base para una empresa de transporte (S.A.S.). Las cuentas que falten se agregan solas
// a cada empresa; las que ya existen no se modifican (la empresa puede renombrarlas o crear subcuentas).
export const PUC_BASE = [
  // Activo
  ['1105', 'Caja', 'ACTIVO', 'D'], ['1110', 'Bancos', 'ACTIVO', 'D'],
  ['1305', 'Clientes (cuentas por cobrar por fletes)', 'ACTIVO', 'D'], ['1330', 'Anticipos y avances', 'ACTIVO', 'D'],
  ['1355', 'Retencion en la fuente a favor (practicada por clientes)', 'ACTIVO', 'D'],
  ['1356', 'Retencion de ICA a favor (practicada por clientes)', 'ACTIVO', 'D'],
  ['1365', 'Cuentas por cobrar a trabajadores', 'ACTIVO', 'D'], ['1380', 'Deudores varios', 'ACTIVO', 'D'],
  ['1385', 'Prestamos a conductores', 'ACTIVO', 'D'],
  ['1524', 'Equipo de oficina', 'ACTIVO', 'D'], ['1528', 'Equipo de computo y comunicacion', 'ACTIVO', 'D'],
  ['1540', 'Flota y equipo de transporte', 'ACTIVO', 'D'], ['1592', 'Depreciacion acumulada', 'ACTIVO', 'C'],
  // Pasivo
  ['2205', 'Cuentas por pagar a conductores y propietarios', 'PASIVO', 'C'],
  ['2335', 'Costos y gastos por pagar (proveedores)', 'PASIVO', 'C'], ['2365', 'Retencion en la fuente por pagar', 'PASIVO', 'C'],
  ['2367', 'Impuesto a las ventas retenido (ReteIVA)', 'PASIVO', 'C'],
  ['2368', 'Retencion de ICA por pagar', 'PASIVO', 'C'], ['2370', 'Retenciones y aportes de nomina', 'PASIVO', 'C'],
  ['237005', 'Aportes a EPS por pagar', 'PASIVO', 'C'], ['237006', 'Aportes a ARL por pagar', 'PASIVO', 'C'],
  ['237010', 'Aportes parafiscales por pagar (caja, ICBF, SENA)', 'PASIVO', 'C'], ['237030', 'Aportes a fondos de pensiones por pagar', 'PASIVO', 'C'],
  ['2380', 'FOPAT y contribuciones por pagar', 'PASIVO', 'C'], ['2404', 'Impuesto de renta por pagar', 'PASIVO', 'C'], ['2412', 'Impuesto de industria y comercio por pagar', 'PASIVO', 'C'],
  ['2408', 'IVA por pagar', 'PASIVO', 'C'], ['240810', 'IVA descontable en compras', 'PASIVO', 'D'], ['2505', 'Salarios por pagar', 'PASIVO', 'C'],
  ['2510', 'Cesantias consolidadas', 'PASIVO', 'C'], ['2515', 'Intereses sobre cesantias', 'PASIVO', 'C'],
  ['2520', 'Prima de servicios', 'PASIVO', 'C'], ['2525', 'Vacaciones consolidadas', 'PASIVO', 'C'],
  ['2815', 'Ingresos recibidos para terceros', 'PASIVO', 'C'],
  ['281505', 'Fletes recibidos para conductores y propietarios', 'PASIVO', 'C'],
  ['281510', 'Auxiliares de cargue recibidos para terceros', 'PASIVO', 'C'],
  // Patrimonio (S.A.S.)
  ['3105', 'Capital suscrito y pagado', 'PATRIMONIO', 'C'], ['3115', 'Aportes sociales', 'PATRIMONIO', 'C'],
  ['3305', 'Reserva legal', 'PATRIMONIO', 'C'], ['3605', 'Utilidad del ejercicio', 'PATRIMONIO', 'C'],
  ['3610', 'Perdida del ejercicio', 'PATRIMONIO', 'D'], ['3705', 'Utilidades acumuladas', 'PATRIMONIO', 'C'],
  ['3710', 'Perdidas acumuladas', 'PATRIMONIO', 'D'], ['3910', 'Saldos iniciales (cuenta puente)', 'PATRIMONIO', 'C'],
  // Ingresos
  ['4135', 'Ingresos por servicio de transporte de carga', 'INGRESO', 'C'],
  ['4145', 'Comisiones por intermediacion de transporte (ingreso propio)', 'INGRESO', 'C'],
  ['4210', 'Ingresos financieros (intereses de prestamos)', 'INGRESO', 'C'], ['4245', 'Utilidad en venta de activos', 'INGRESO', 'C'], ['4250', 'Recuperaciones', 'INGRESO', 'C'],
  // Gastos y costos
  ['5105', 'Gastos de personal', 'GASTO', 'D'],
  ['510506', 'Sueldos', 'GASTO', 'D'], ['510515', 'Horas extras y recargos', 'GASTO', 'D'], ['510527', 'Auxilio de transporte', 'GASTO', 'D'],
  ['510530', 'Cesantias', 'GASTO', 'D'], ['510533', 'Intereses sobre cesantias', 'GASTO', 'D'], ['510536', 'Prima de servicios', 'GASTO', 'D'],
  ['510539', 'Vacaciones', 'GASTO', 'D'], ['510548', 'Bonificaciones', 'GASTO', 'D'], ['510568', 'Aportes a ARL', 'GASTO', 'D'],
  ['510569', 'Aportes a EPS', 'GASTO', 'D'], ['510570', 'Aportes a fondos de pensiones', 'GASTO', 'D'], ['510572', 'Aportes a cajas de compensacion', 'GASTO', 'D'],
  ['510575', 'Aportes ICBF', 'GASTO', 'D'], ['510578', 'Aportes SENA', 'GASTO', 'D'], ['5110', 'Honorarios', 'GASTO', 'D'], ['5115', 'Impuestos', 'GASTO', 'D'],
  ['5120', 'Arrendamientos', 'GASTO', 'D'], ['5130', 'Seguros', 'GASTO', 'D'], ['5135', 'Servicios', 'GASTO', 'D'],
  ['5140', 'Gastos legales', 'GASTO', 'D'], ['5155', 'Gastos de viaje', 'GASTO', 'D'],
  ['5145', 'Mantenimiento y reparaciones', 'GASTO', 'D'], ['5160', 'Depreciaciones', 'GASTO', 'D'],
  ['5195', 'Gastos diversos', 'GASTO', 'D'], ['5305', 'Gastos financieros', 'GASTO', 'D'], ['5310', 'Perdida en venta y retiro de bienes', 'GASTO', 'D'],
  ['530505', 'Gastos bancarios y GMF (4 x 1000)', 'GASTO', 'D'], ['530520', 'Intereses de mora (impuestos)', 'GASTO', 'D'], ['5315', 'Gastos extraordinarios', 'GASTO', 'D'],
  ['5405', 'Impuesto de renta y complementarios', 'GASTO', 'D'],
  ['6155', 'Costo de transporte: fletes a conductores', 'COSTO', 'D'],
];

// Agrega a la empresa las cuentas del plan base que todavía no tenga (una vez por empresa y proceso)
const pucRevisado = new Set();
export async function asegurarPuc(empresaId) {
  const k = String(empresaId);
  if (pucRevisado.has(k)) return;
  const tiene = new Set((await CuentaContable.find({ empresa: empresaId }).select('codigo').lean()).map(c => c.codigo));
  const faltan = PUC_BASE.filter(([codigo]) => !tiene.has(codigo));
  if (faltan.length) {
    await CuentaContable.insertMany(faltan.map(([codigo, nombre, tipo, naturaleza]) => ({ empresa: empresaId, codigo, nombre, tipo, naturaleza })), { ordered: false }).catch(() => {});
  }
  pucRevisado.add(k);
}

// ── Parámetros contables de la empresa ───────────────────────────────────────
export async function parametros(empresaId) {
  const e = await Empresa.findById(empresaId).select('contabilidad').lean();
  const c = e?.contabilidad || {};
  return { modeloIngresos: c.modeloIngresos || 'bruto', tipoSociedad: c.tipoSociedad || 'SAS',
    uvt: c.uvt || 52374, ivaDescontable: !!c.ivaDescontable, agenteReteIva: !!c.agenteReteIva, reteIvaPct: c.reteIvaPct ?? 15,
    gmf: c.gmf !== false, retenciones: c.retenciones || {},
    icaTarifaPorMil: c.icaTarifaPorMil || 0, avisosTablerosPct: c.avisosTablerosPct ?? 15, sobretasaBomberilPct: c.sobretasaBomberilPct || 0,
    vencimientos: (c.vencimientos || []).map(v => ({ obligacion: v.obligacion, periodo: v.periodo, fecha: v.fecha })),
    smmlv: c.smmlv || 1750905, auxilioTransporte: c.auxilioTransporte || 249095, exoneradaAportes: c.exoneradaAportes !== false,
    prefijoDocumentoSoporte: c.prefijoDocumentoSoporte || 'DS', rndcFeAutomatico: !!c.rndcFeAutomatico };
}
const PARAMETROS = ['modeloIngresos', 'tipoSociedad', 'uvt', 'ivaDescontable', 'agenteReteIva', 'reteIvaPct', 'gmf', 'retenciones',
  'icaTarifaPorMil', 'avisosTablerosPct', 'sobretasaBomberilPct', 'vencimientos', 'smmlv', 'auxilioTransporte', 'exoneradaAportes', 'prefijoDocumentoSoporte'];
export async function guardarParametros(empresaId, datos) {
  const $set = {};
  for (const k of PARAMETROS) if (datos[k] !== undefined) $set[`contabilidad.${k}`] = datos[k];
  if (Object.keys($set).length) await Empresa.updateOne({ _id: empresaId }, { $set });
  return parametros(empresaId);
}

// Ingresos para terceros: de lo cobrado al cliente, lo que es del conductor (flete + auxiliar pagado)
// va al pasivo 2815 y la diferencia es la comisión propia. Nunca se separa más de lo cobrado.
export function divisionTerceros(l) {
  const cobro = Math.round(l.totalCobrado || 0);
  const terceros = Math.min(cobro, Math.round((l.totalFlete || 0) + (l.totalAuxiliarPagado || 0)));
  const flete = Math.min(Math.round(l.totalFlete || 0), terceros);
  return { cobro, terceros, flete, auxiliar: terceros - flete, propio: cobro - terceros };
}

// Registra un asiento. lineas: [[cuenta, valor]] con valor positivo = débito y negativo = crédito.
export async function postear(empresaId, { fecha, documento = '', concepto = '', origen = 'MAN', terceroDoc = '', tercero = '', centroCosto = '', lineas, usuario = null }) {
  const ls = await validarAsiento(empresaId, { fecha, lineas });
  const numero = `A-${String(await siguiente(empresaId, 'asiento')).padStart(5, '0')}`;
  return Asiento.create({ empresa: empresaId, numero, fecha, documento, concepto, origen, terceroDoc, tercero, centroCosto, lineas: ls, usuario });
}

// Valida un asiento sin guardarlo: mes abierto, cuentas existentes y partida doble. Devuelve las líneas listas.
// Sirve para revisar antes de crear el documento (factura, liquidación…) y no dejar documentos sin asiento.
export async function validarAsiento(empresaId, { fecha, lineas }) {
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
  return ls;
}

// Los asientos de documentos (factura, liquidación, préstamo, abono) se anulan desde su documento.
const ORIGEN_DOCUMENTO = { FAC: 'la factura', LIQ: 'la liquidación del conductor', PRE: 'el préstamo', ABO: 'el abono del préstamo', CMP: 'la compra', EGR: 'el comprobante de egreso',
  NOM: 'la nómina', DEP: 'la depreciación del mes', ACT: 'el activo fijo', CIE: 'el cierre del año', NOT: 'la nota de la factura' };
// Anula un asiento. Si es un cobro (COB) o un pago (PAG) devuelve el saldo a la factura o a la liquidación,
// para que la cartera y las cuentas por pagar sigan cuadrando con la contabilidad.
export async function anularAsiento(empresaId, numero, { desdeDocumento = false } = {}) {
  const a = await Asiento.findOne({ empresa: empresaId, numero });
  if (!a) throw new ErrorHttp(404, 'Asiento no encontrado');
  if (a.estado === 'ANULADO') throw new ErrorHttp(409, 'El asiento ya estaba anulado');
  if (!desdeDocumento && ORIGEN_DOCUMENTO[a.origen]) throw new ErrorHttp(409, `Este asiento se anula desde ${ORIGEN_DOCUMENTO[a.origen]} ${a.documento}`);
  await asegurarMesAbierto(empresaId, a.fecha);
  if (a.origen === 'COB') {
    const valor = a.lineas.filter(l => l.cuenta === '1305').reduce((t, l) => t + l.credito, 0);
    const f = await FacturaCont.findOne({ empresa: empresaId, numero: a.documento });
    if (f && valor) { f.cobrado = Math.max(0, (f.cobrado || 0) - valor); if (f.estado === 'COBRADA' && saldoFactura(f) > 0) f.estado = 'PENDIENTE'; await f.save(); }
  }
  if (a.origen === 'PAG') {
    const valor = a.lineas.filter(l => l.cuenta === '2205').reduce((t, l) => t + l.debito, 0);
    const l = await LiquidacionConductor.findOne({ empresa: empresaId, numero: a.documento });
    if (l && valor) { l.pagado = Math.max(0, (l.pagado || 0) - valor); await l.save(); }
  }
  if (a.origen === 'NPA') {
    // Pago de nómina o de planilla PILA: la nómina vuelve a quedar pendiente de ese pago
    const n = await Nomina.findOne({ empresa: empresaId, numero: a.documento });
    if (n) { if (n.asientoPago === a.numero) n.asientoPago = ''; if (n.asientoAportes === a.numero) n.asientoAportes = ''; if (n.estado === 'PAGADA') n.estado = 'VIGENTE'; await n.save(); }
  }
  a.estado = 'ANULADO';
  await a.save();
  return a;
}

// Saldo por cobrar de una factura: neto, más notas débito, menos notas crédito, menos lo cobrado
export const saldoFactura = (f) => Math.round((f.neto || 0) + (f.ajusteNeto || 0) - (f.cobrado || 0));

// ── Documentos ───────────────────────────────────────────────────────────────
// Facturas vigentes del mismo cliente cuyo periodo se cruza con el indicado
export async function facturasCruzadas(empresaId, { cliente, desde, hasta }) {
  return FacturaCont.find({ empresa: empresaId, cliente, estado: { $ne: 'ANULADA' }, desde: { $lte: hasta }, hasta: { $gte: desde } })
    .select('numero fecha desde hasta neto').sort({ desde: 1 }).lean();
}

// Viajes que se pueden facturar a un cliente en el rango, con lo que se cobra y su división
// (para terceros / ingreso propio). No incluye «[NO FACTURAR]», anulados ni viajes ya facturados.
export async function viajesPorFacturar(empresaId, { cliente, desde, hasta, viajes = null }) {
  const cli = await Cliente.findOne({ empresa: empresaId, _id: cliente }).lean();
  if (!cli) throw new ErrorHttp(400, 'Cliente no encontrado');
  const filtro = { empresa: empresaId, cliente, estado: { $ne: 'anulado' }, observaciones: { $not: NO_FACTURAR }, facturaCont: null };
  if (viajes?.length) filtro._id = { $in: viajes }; else filtro.fecha = { $gte: desde, $lte: hasta };
  const lista = await Viaje.find(filtro).sort({ fecha: 1, numero: 1 }).lean();
  if (viajes?.length && lista.length !== new Set(viajes.map(String)).size) throw new ErrorHttp(409, 'Algunos viajes escogidos no existen, son de otro cliente, están anulados, son «[NO FACTURAR]» o ya fueron facturados');
  const tarifas = await Tarifa.find({ empresa: empresaId, cliente }).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldo = respaldosAuxiliar(tarifas).get(String(cliente));
  const filas = lista.map(v => {
    const l = lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo, cliente: cli });
    return { _id: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, destino: v.destino, conductor: v.conductorNombre || '', manifiesto: v.manifiesto?.numero || '',
      totalCobrado: l.totalCobrado, totalFlete: l.totalFlete, totalAuxiliarPagado: l.totalAuxiliarPagado, ...divisionTerceros(l) };
  });
  return { cliente: cli, filas };
}

// Factura a una empresa (cliente): suma la tarifa y el auxiliar (según la política del cliente, RN-15) de los
// viajes del rango (o de los viajes escogidos), sin los marcados «[NO FACTURAR]» ni los ya facturados. Sin IVA.
// Si el periodo se cruza con otra factura del mismo cliente se avisa y solo se factura con `permitirCruce`.
// Según el modelo de ingresos de la empresa:
//   bruto:    1305 neto · 1355/1356 retenciones · 4135 total
//   terceros: 1305 neto · 1355/1356 retenciones · 281505 fletes · 281510 auxiliares · 4145 comisión propia
export async function facturar(empresaId, { cliente, desde, hasta, viajes = null, retefuentePct = 1, icaPct = 0, fecha = new Date(), usuario, permitirCruce = false }) {
  if (viajes?.length) {
    const ds = await Viaje.find({ empresa: empresaId, _id: { $in: viajes } }).select('fecha').lean();
    if (ds.length) { const t = ds.map(v => +new Date(v.fecha)); desde = new Date(Math.min(...t)); hasta = new Date(Math.max(...t)); }
  }
  const cruces = await facturasCruzadas(empresaId, { cliente, desde, hasta });
  if (cruces.length && !permitirCruce) {
    throw new ErrorHttp(409, `El periodo se cruza con ${cruces.length === 1 ? 'la factura' : 'las facturas'} ${cruces.map(f => f.numero).join(', ')} del mismo cliente`,
      cruces.map(f => `${f.numero}: ${f.desde?.toISOString().slice(0, 10)} a ${f.hasta?.toISOString().slice(0, 10)}`));
  }
  const { cliente: cli, filas } = await viajesPorFacturar(empresaId, { cliente, desde, hasta, viajes });
  if (!filas.length) throw new ErrorHttp(400, 'No hay viajes para facturar de ese cliente en el rango');
  const suma = (k) => filas.reduce((a, x) => a + x[k], 0);
  const total = suma('cobro');
  const retefuente = Math.round(total * retefuentePct / 100);
  const ica = Math.round(total * icaPct / 100);
  const neto = total - retefuente - ica;
  const { modeloIngresos } = await parametros(empresaId);
  const terceros = modeloIngresos === 'terceros';
  const lineas = terceros
    ? [['1305', neto], ['1355', retefuente], ['1356', ica], ['281505', -suma('flete')], ['281510', -suma('auxiliar')], ['4145', -suma('propio')]]
    : [['1305', neto], ['1355', retefuente], ['1356', ica], ['4135', -total]];
  await validarAsiento(empresaId, { fecha, lineas });   // antes de numerar: un error no deja factura ni asiento a medias
  const numero = `FV-${String(await siguiente(empresaId, 'factura')).padStart(4, '0')}`;
  const a = await postear(empresaId, { fecha, documento: numero, concepto: `Factura ${numero} - ${cli.nombre}`, origen: 'FAC',
    terceroDoc: cli.nit, tercero: cli.nombre, usuario, lineas });
  let f;
  try {
    f = await FacturaCont.create({ empresa: empresaId, numero, fecha, cliente, desde, hasta, viajes: filas.length, total, retefuentePct, retefuente, icaPct, ica, neto,
      modeloIngresos, terceros: terceros ? suma('terceros') : 0, propio: terceros ? suma('propio') : total, viajesIds: filas.map(x => x._id), asiento: a.numero });
  } catch (e) {
    await Asiento.updateOne({ empresa: empresaId, _id: a._id }, { $set: { estado: 'ANULADO', concepto: `${a.concepto} (anulado: la factura no se pudo guardar)` } });
    throw e;
  }
  await Viaje.updateMany({ empresa: empresaId, _id: { $in: f.viajesIds } }, { $set: { facturaCont: f._id } });
  return Object.assign(f.toObject(), { cruces: cruces.map(c => c.numero) });
}

// Anula una factura sin cobros: anula su asiento y libera los viajes para facturarlos de nuevo
export async function anularFactura(empresaId, numero) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero });
  if (!f) throw new ErrorHttp(404, 'Factura no encontrada');
  if (f.estado === 'ANULADA') throw new ErrorHttp(409, 'La factura ya estaba anulada');
  if (f.cobrado > 0) throw new ErrorHttp(409, 'La factura ya tiene cobros: no se puede anular');
  if ((f.notas || []).some(n => n.estado !== 'ANULADA')) throw new ErrorHttp(409, 'La factura tiene notas crédito o débito: anúlelas primero');
  if (f.fe?.rndc?.estado === 'ACEPTADA') throw new ErrorHttp(409, 'La factura electrónica ya está registrada en el RNDC: se corrige con una nota crédito');
  if (f.asiento) await anularAsiento(empresaId, f.asiento, { desdeDocumento: true });
  await Viaje.updateMany({ empresa: empresaId, facturaCont: f._id }, { $set: { facturaCont: null } });
  f.estado = 'ANULADA'; await f.save();
  return f;
}

export async function cobrar(empresaId, { factura, valor, fecha = new Date(), cuenta = '1110', usuario }) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero: factura }).populate(pob(empresaId, 'cliente'));
  if (!f || f.estado === 'ANULADA') throw new ErrorHttp(404, 'Factura no encontrada');
  const saldo = saldoFactura(f);
  const v = Math.round(valor || saldo);
  if (v <= 0 || v > saldo) throw new ErrorHttp(400, `El valor debe estar entre 1 y el saldo (${saldo})`);
  const a = await postear(empresaId, { fecha, documento: f.numero, concepto: `Cobro factura ${f.numero}`, origen: 'COB',
    terceroDoc: f.cliente?.nit, tercero: f.cliente?.nombre, usuario, lineas: [[cuenta, v], ['1305', -v]] });
  f.cobrado += v;
  if (saldoFactura(f) <= 0) f.estado = 'COBRADA';
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
  if (!/^5\d{3,9}$/.test(String(cuenta))) throw new ErrorHttp(400, 'La cuenta del gasto debe ser de la clase 5 (por ejemplo 5135 o 530505)');
  return postear(empresaId, { fecha, concepto, origen: 'GAS', tercero, usuario, lineas: [[cuenta, valor], [formaPago, -valor]] });
}

// ── Informes ─────────────────────────────────────────────────────────────────
// Los informes suman en la base de datos (agregaciones), no cargando todos los asientos en memoria.
const oid = (v) => new mongoose.Types.ObjectId(String(v));
// Signo de cada tipo de cuenta: activos, gastos y costos crecen por el débito; pasivo, patrimonio e ingresos por el crédito.
// Así una cuenta correctora (depreciación acumulada, pérdidas) resta dentro de su grupo.
export const signoTipo = (tipo) => (['ACTIVO', 'GASTO', 'COSTO'].includes(tipo) ? 1 : -1);

async function sumasPorCuenta(empresaId, { hasta, desde = null, cuenta = null, terceroDoc = null, excluirOrigen = null }) {
  const m = { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $lte: hasta, ...(desde ? { $gte: desde } : {}) } };
  if (excluirOrigen?.length) m.origen = { $nin: excluirOrigen };
  if (terceroDoc) m.terceroDoc = terceroDoc;
  const pipe = [{ $match: m }, { $unwind: '$lineas' }];
  if (cuenta) pipe.push({ $match: { 'lineas.cuenta': { $regex: `^${String(cuenta).replace(/\D/g, '')}` } } });
  pipe.push({ $group: { _id: '$lineas.cuenta', debito: { $sum: '$lineas.debito' }, credito: { $sum: '$lineas.credito' } } });
  return new Map((await Asiento.aggregate(pipe)).map(x => [x._id, x]));
}

export async function libroDiario(empresaId, desde, hasta) {
  return Asiento.find({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta } }).sort({ fecha: 1, numero: 1 }).lean();
}

// Saldos por cuenta al corte → balance general y estado de resultados
export async function saldos(empresaId, hasta, desde = null, excluirOrigen = null) {
  await asegurarPuc(empresaId);
  const cuentas = await CuentaContable.find({ empresa: empresaId }).sort({ codigo: 1 }).lean();
  const sum = await sumasPorCuenta(empresaId, { hasta, desde, excluirOrigen });
  return cuentas.map(c => {
    const s = sum.get(c.codigo) || { debito: 0, credito: 0 };
    return { ...c, debito: s.debito, credito: s.credito, saldo: signoTipo(c.tipo) * (s.debito - s.credito) };
  });
}

// Libro mayor: por cuenta, saldo anterior al periodo, débitos, créditos y saldo final.
// nivel = cantidad de dígitos con que se agrupa (1 clase, 2 grupo, 4 cuenta, 6 subcuenta).
export async function libroMayor(empresaId, desde, hasta, nivel = 4) {
  await asegurarPuc(empresaId);
  const cuentas = new Map((await CuentaContable.find({ empresa: empresaId }).lean()).map(c => [c.codigo, c]));
  const antes = await sumasPorCuenta(empresaId, { hasta: new Date(desde.getTime() - 1) });
  const periodo = await sumasPorCuenta(empresaId, { hasta, desde });
  const g = new Map();
  for (const [mapa, k] of [[antes, 'ant'], [periodo, 'per']]) {
    for (const [codigo, x] of mapa) {
      const c = codigo.slice(0, nivel), o = g.get(c) || { codigo: c, antD: 0, antC: 0, debito: 0, credito: 0 };
      if (k === 'ant') { o.antD += x.debito; o.antC += x.credito; } else { o.debito += x.debito; o.credito += x.credito; }
      g.set(c, o);
    }
  }
  const tipoDe = (c) => cuentas.get(c)?.tipo || [...cuentas.values()].find(x => x.codigo.startsWith(c) || c.startsWith(x.codigo))?.tipo || 'ACTIVO';
  return [...g.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)).map(o => {
    const sg = signoTipo(tipoDe(o.codigo)), anterior = sg * (o.antD - o.antC);
    return { codigo: o.codigo, nombre: cuentas.get(o.codigo)?.nombre || '', anterior, debito: o.debito, credito: o.credito, final: anterior + sg * (o.debito - o.credito) };
  });
}

// Auxiliar de una cuenta (y sus subcuentas), opcionalmente de un tercero: movimientos con saldo acumulado
// y, si no se escoge tercero, el saldo por tercero.
export async function auxiliar(empresaId, { cuenta, terceroDoc = '', desde, hasta }) {
  const c = String(cuenta || '').replace(/\D/g, '');
  if (!c) throw new ErrorHttp(400, 'Escoja la cuenta del auxiliar');
  await asegurarPuc(empresaId);
  const cta = await CuentaContable.findOne({ empresa: empresaId, codigo: c }).lean()
    || await CuentaContable.findOne({ empresa: empresaId, codigo: { $regex: `^${c.slice(0, 1)}` } }).lean();
  const sg = signoTipo(cta?.tipo || 'ACTIVO');
  const m = { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $lte: hasta } };
  if (terceroDoc) m.terceroDoc = terceroDoc;
  const filas = await Asiento.aggregate([{ $match: m }, { $unwind: '$lineas' }, { $match: { 'lineas.cuenta': { $regex: `^${c}` } } }, { $sort: { fecha: 1, numero: 1 } },
    { $project: { _id: 0, numero: 1, fecha: 1, documento: 1, concepto: 1, tercero: 1, terceroDoc: 1, cuenta: '$lineas.cuenta', debito: '$lineas.debito', credito: '$lineas.credito' } }]);
  const anterior = filas.filter(x => x.fecha < desde).reduce((t, x) => t + sg * (x.debito - x.credito), 0);
  let saldo = anterior;
  const movimientos = filas.filter(x => x.fecha >= desde).map(x => ({ ...x, saldo: (saldo += sg * (x.debito - x.credito)) }));
  const porTercero = new Map();
  for (const x of filas) {
    const k = x.terceroDoc || x.tercero || '(sin tercero)', o = porTercero.get(k) || { terceroDoc: x.terceroDoc || '', tercero: x.tercero || '(sin tercero)', anterior: 0, debito: 0, credito: 0 };
    if (x.fecha < desde) o.anterior += sg * (x.debito - x.credito); else { o.debito += x.debito; o.credito += x.credito; }
    porTercero.set(k, o);
  }
  const terceros = [...porTercero.values()].map(o => ({ ...o, final: o.anterior + sg * (o.debito - o.credito) })).filter(o => o.final || o.debito || o.credito).sort((a, b) => b.final - a.final);
  return { cuenta: c, nombre: cta?.codigo === c ? cta.nombre : '', anterior, movimientos, final: saldo, terceros };
}

// Saldos iniciales: los saldos de la contabilidad anterior a la fecha de corte.
// filas: [{ cuenta, terceroDoc, tercero, documento, debito, credito }]. Débitos y créditos deben sumar igual.
// Se registra un asiento por tercero y documento (así la cartera y las cuentas por pagar quedan por documento);
// cada asiento cuadra contra la cuenta puente 3910, que en total queda en cero.
export async function saldosIniciales(empresaId, { fecha, filas, usuario }) {
  if (!filas?.length) throw new ErrorHttp(400, 'No hay filas de saldos');
  await asegurarPuc(empresaId);
  const existe = new Set((await CuentaContable.find({ empresa: empresaId }).select('codigo').lean()).map(c => c.codigo));
  const malas = [...new Set(filas.map(f => String(f.cuenta)).filter(c => !existe.has(c)))];
  if (malas.length) throw new ErrorHttp(400, `Cuentas que no existen en el plan de cuentas: ${malas.join(', ')}`);
  const d = filas.reduce((t, f) => t + Math.round(Number(f.debito) || 0), 0), c = filas.reduce((t, f) => t + Math.round(Number(f.credito) || 0), 0);
  if (d !== c) throw new ErrorHttp(400, `Los saldos no cuadran: débitos ${d} y créditos ${c}`);
  if (await Asiento.exists({ empresa: empresaId, origen: 'SI', estado: 'ACTIVO' })) throw new ErrorHttp(409, 'Ya hay saldos iniciales registrados. Anúlelos en el libro diario antes de cargarlos de nuevo.');
  const grupos = new Map();
  for (const f of filas) { const k = `${f.terceroDoc || ''}|${f.documento || ''}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(f); }
  // Primero se validan todos (mes abierto y cuentas), después se registran
  const asientos = [...grupos.values()].map(L => {
    const lineas = L.map(f => [String(f.cuenta), Math.round(Number(f.debito) || 0) - Math.round(Number(f.credito) || 0)]);
    const dif = lineas.reduce((t, l) => t + l[1], 0);
    if (dif) lineas.push(['3910', -dif]);
    return { L, lineas };
  });
  for (const x of asientos) await validarAsiento(empresaId, { fecha, lineas: x.lineas });
  const hechos = [];
  for (const { L, lineas } of asientos) {
    const f0 = L[0];
    hechos.push((await postear(empresaId, { fecha, documento: f0.documento || 'SALDOS-INICIALES', concepto: `Saldos iniciales${f0.tercero ? ' - ' + f0.tercero : ''}`, origen: 'SI',
      terceroDoc: f0.terceroDoc || '', tercero: f0.tercero || '', usuario, lineas })).numero);
  }
  return { asientos: hechos, debitos: d, creditos: c };
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

// El asiento de cierre del año (CIE) no cuenta en el estado de resultados: si no, el año cerrado quedaría en cero
export async function resultados(empresaId, desde, hasta) {
  const s = (await saldos(empresaId, hasta, desde, ['CIE'])).filter(c => ['INGRESO', 'GASTO', 'COSTO'].includes(c.tipo));
  const ingresos = s.filter(c => c.tipo === 'INGRESO'); const costos = s.filter(c => c.tipo === 'COSTO'); const gastos = s.filter(c => c.tipo === 'GASTO');
  const t = (l) => l.reduce((a, c) => a + c.saldo, 0);
  return { ingresos, costos, gastos, totalIngresos: t(ingresos), totalCostos: t(costos), totalGastos: t(gastos), utilidad: t(ingresos) - t(costos) - t(gastos) };
}

export async function cuentasPorCobrar(empresaId) {
  return (await FacturaCont.find({ empresa: empresaId, estado: 'PENDIENTE' }).populate(pob(empresaId, 'cliente', 'nombre nit')).sort({ fecha: 1 }).lean())
    .map(f => ({ numero: f.numero, fecha: f.fecha, cliente: f.cliente?.nombre, neto: f.neto + (f.ajusteNeto || 0), cobrado: f.cobrado, saldo: saldoFactura(f) }));
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
  const [cxc, cxp, facturas, asientos, res, compras] = await Promise.all([
    cuentasPorCobrar(empresaId), cuentasPorPagar(empresaId),
    FacturaCont.find({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'ANULADA' } }).select('total neto').lean(),
    Asiento.find({ empresa: empresaId, estado: 'ACTIVO', fecha: { $gte: desde, $lte: hasta }, origen: { $in: ['COB', 'PAG', 'GAS'] } }).lean(),
    resultados(empresaId, desde, hasta),
    CompraCont.find({ empresa: empresaId, estado: 'PENDIENTE' }).select('neto pagado').lean(),
  ]);
  const suma = (l, k) => l.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  const deOrigen = (o, f) => asientos.filter(a => a.origen === o).reduce((a, x) => a + x.lineas.filter(f).reduce((b, l) => b + l.debito, 0), 0);
  const cartera = await carteraPorEdades(empresaId);
  return {
    porCobrar: suma(cxc, 'saldo'), facturasPendientes: cxc.length, porPagar: suma(cxp, 'saldo'), liquidacionesPendientes: cxp.length,
    porPagarProveedores: compras.reduce((a, c) => a + (c.neto - (c.pagado || 0)), 0), comprasPendientes: compras.length,
    facturado: suma(facturas, 'total'), facturas: facturas.length,
    cobrado: deOrigen('COB', l => /^11/.test(l.cuenta)), pagadoConductores: deOrigen('PAG', l => l.cuenta === '2205'),
    gastos: res.totalGastos, costos: res.totalCostos, ingresos: res.totalIngresos, excedente: res.utilidad,
    carteraVencida: cartera.totales.d31_60 + cartera.totales.d61_90 + cartera.totales.d90,
  };
}

export async function retenciones(empresaId, desde, hasta) {
  const s = await saldos(empresaId, hasta, desde);
  return s.filter(c => ['1355', '1356', '2365', '2367', '2368', '240810', '2380'].includes(c.codigo));
}
