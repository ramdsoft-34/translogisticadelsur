// Contabilidad fase 4: nómina con aportes y provisiones, pago de nómina y de seguridad social (PILA), activos fijos
// con depreciación en línea recta, venta o baja de activos, cierre contable del año y notas crédito/débito a facturas.
// Apoyo administrativo: la contadora revisa la nómina (retención laboral, novedades) antes de pagarla y de enviarla
// como nómina electrónica por el proveedor tecnológico.
import mongoose from 'mongoose';
import { Empleado, Nomina, ActivoFijo, Asiento, FacturaCont, CuentaContable, siguiente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { postear, validarAsiento, anularAsiento, parametros, asegurarPuc, saldoFactura } from './contabilidad.js';
import { nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../reportes/comun.js';

const $ = (n) => Math.round(Number(n) || 0);
const oid = (v) => new mongoose.Types.ObjectId(String(v));

// ── Nómina ──────────────────────────────────────────────────────────────────
// Tarifas de ley (Colombia): salud 12,5 % (4 % empleado, 8,5 % empleador), pensión 16 % (4 % y 12 %), caja 4 %,
// ICBF 3 %, SENA 2 %. ARL según el nivel de riesgo (los conductores de carga suelen ser nivel IV o V).
// Exoneración (art. 114-1 E.T.): la sociedad no paga salud del empleador, ICBF ni SENA por quien gana menos de 10 SMMLV.
// Provisiones: cesantías 8,33 %, intereses 1 % mensual (12 % anual de las cesantías), prima 8,33 %, vacaciones 4,17 %.
export const ARL = { 1: 0.522, 2: 1.044, 3: 2.436, 4: 4.35, 5: 6.96 };
export const TASAS = { saludEmp: 4, pensionEmp: 4, saludPat: 8.5, pensionPat: 12, caja: 4, icbf: 3, sena: 2, cesantias: 8.33, intCesantias: 1, prima: 8.33, vacaciones: 4.17 };

// Fondo de solidaridad pensional: 1 % desde 4 SMMLV; de 16 SMMLV en adelante sube 0,2 % por SMMLV hasta 2 %
export function fondoSolidaridadPct(ibc, smmlv) {
  const n = ibc / smmlv;
  if (n < 4) return 0;
  if (n < 16) return 1;
  if (n >= 20) return 2;
  return 1 + 0.2 * (Math.floor(n) - 15);
}

// Cálculo de un empleado en el periodo (regla pura). n: novedades { dias, horasExtras, bonificaciones (salariales),
// noSalariales, retencion, otrasDeducciones }.
export function calcularEmpleado(emp, n = {}, { smmlv = 1750905, auxilioTransporte = 249095, exoneradaAportes = true, diasPeriodo = 30 } = {}) {
  const dias = Math.max(0, Math.min(diasPeriodo, Number(n.dias ?? diasPeriodo)));
  const integral = emp.tipoSalario === 'integral';
  const salario = Math.round(emp.salario * dias / 30);
  const extras = $(n.horasExtras); const bonif = $(n.bonificaciones); const noSalariales = $(n.noSalariales);
  // Auxilio de transporte: solo a quien gana hasta 2 SMMLV (no al salario integral ni al aprendiz)
  const aux = !integral && emp.tipoContrato !== 'aprendiz' && emp.salario <= 2 * smmlv ? Math.round(auxilioTransporte * dias / 30) : 0;
  const devengadoSalarial = salario + extras + bonif;
  // IBC: lo salarial (70 % en salario integral), entre un SMMLV proporcional a los días y 25 SMMLV
  const ibc = Math.min(25 * smmlv, Math.max(Math.round(devengadoSalarial * (integral ? 0.7 : 1)), Math.round(smmlv * dias / 30)));
  const aprendiz = emp.tipoContrato === 'aprendiz';
  const exonerado = exoneradaAportes && emp.salario < 10 * smmlv;
  const pct = (b, t) => Math.round(b * t / 100);
  const saludEmp = aprendiz ? 0 : pct(ibc, TASAS.saludEmp);
  const pensionEmp = aprendiz ? 0 : pct(ibc, TASAS.pensionEmp);
  const fsp = aprendiz ? 0 : pct(ibc, fondoSolidaridadPct(ibc, smmlv));
  const retencion = $(n.retencion); const otrasDeducciones = $(n.otrasDeducciones);
  const deducciones = saludEmp + pensionEmp + fsp + retencion + otrasDeducciones;
  const devengado = devengadoSalarial + aux + noSalariales;
  const aportes = {
    salud: aprendiz ? pct(ibc, 12.5) : exonerado ? 0 : pct(ibc, TASAS.saludPat),
    pension: aprendiz ? 0 : pct(ibc, TASAS.pensionPat),
    arl: pct(ibc, ARL[emp.nivelRiesgoArl] ?? ARL[1]),
    caja: aprendiz ? 0 : pct(ibc, TASAS.caja),
    icbf: aprendiz || exonerado ? 0 : pct(ibc, TASAS.icbf),
    sena: aprendiz || exonerado ? 0 : pct(ibc, TASAS.sena),
  };
  // Prestaciones: base salario + extras + bonificaciones + auxilio de transporte (vacaciones sin auxilio). El integral no las causa (salvo vacaciones).
  const basePrest = devengadoSalarial + aux;
  const provisiones = {
    cesantias: integral || aprendiz ? 0 : pct(basePrest, TASAS.cesantias),
    intCesantias: integral || aprendiz ? 0 : pct(basePrest, TASAS.intCesantias),
    prima: integral || aprendiz ? 0 : pct(basePrest, TASAS.prima),
    vacaciones: aprendiz ? 0 : pct(salario + extras + bonif, TASAS.vacaciones),
  };
  return { empleado: String(emp._id || ''), numId: emp.numId, nombre: `${emp.nombres} ${emp.apellidos || ''}`.trim(), cargo: emp.cargo || '', dias,
    salario, extras, bonificaciones: bonif, noSalariales, auxilioTransporte: aux, devengado, ibc,
    saludEmp, pensionEmp, fondoSolidaridad: fsp, retencion, otrasDeducciones, deducciones, neto: devengado - deducciones,
    aportes, provisiones, totalAportes: Object.values(aportes).reduce((a, b) => a + b, 0), totalProvisiones: Object.values(provisiones).reduce((a, b) => a + b, 0) };
}

const sumar = (ls, f) => ls.reduce((a, l) => a + f(l), 0);
export function totalesNomina(lineas) {
  const k = (c) => sumar(lineas, l => l[c]);
  const a = (c) => sumar(lineas, l => l.aportes[c]); const p = (c) => sumar(lineas, l => l.provisiones[c]);
  return { empleados: lineas.length, salario: k('salario'), extras: k('extras'), bonificaciones: k('bonificaciones'), noSalariales: k('noSalariales'),
    auxilioTransporte: k('auxilioTransporte'), devengado: k('devengado'), saludEmp: k('saludEmp'), pensionEmp: k('pensionEmp'), fondoSolidaridad: k('fondoSolidaridad'),
    retencion: k('retencion'), otrasDeducciones: k('otrasDeducciones'), deducciones: k('deducciones'), neto: k('neto'),
    aportes: { salud: a('salud'), pension: a('pension'), arl: a('arl'), caja: a('caja'), icbf: a('icbf'), sena: a('sena') },
    provisiones: { cesantias: p('cesantias'), intCesantias: p('intCesantias'), prima: p('prima'), vacaciones: p('vacaciones') } };
}

// Asiento de la nómina: gastos de personal por concepto contra salarios por pagar, aportes y prestaciones por pagar.
// Las «otras deducciones» (préstamos, libranzas) van a 1365 (cuentas por cobrar a trabajadores).
export function lineasAsientoNomina(t) {
  const A = t.aportes; const P = t.provisiones;
  return [
    ['510506', t.salario], ['510515', t.extras], ['510548', t.bonificaciones + t.noSalariales], ['510527', t.auxilioTransporte],
    ['510569', A.salud], ['510570', A.pension], ['510568', A.arl], ['510572', A.caja], ['510575', A.icbf], ['510578', A.sena],
    ['510530', P.cesantias], ['510533', P.intCesantias], ['510536', P.prima], ['510539', P.vacaciones],
    ['2505', -t.neto], ['237005', -(t.saludEmp + A.salud)], ['237030', -(t.pensionEmp + t.fondoSolidaridad + A.pension)], ['237006', -A.arl],
    ['237010', -(A.caja + A.icbf + A.sena)], ['2365', -t.retencion], ['1365', -t.otrasDeducciones],
    ['2510', -P.cesantias], ['2515', -P.intCesantias], ['2520', -P.prima], ['2525', -P.vacaciones],
  ];
}

const PERIODO = /^(\d{4})-(\d{2})(?:-(Q[12]))?$/;
export function fechasPeriodo(periodo) {
  const m = PERIODO.exec(String(periodo || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new ErrorHttp(400, 'Periodo inválido: aaaa-mm (mensual) o aaaa-mm-Q1 / aaaa-mm-Q2 (quincenal)');
  const a = Number(m[1]), mes = Number(m[2]);
  const ultimo = new Date(Date.UTC(a, mes, 0)).getUTCDate();
  const desde = m[3] === 'Q2' ? 16 : 1; const hasta = m[3] === 'Q1' ? 15 : ultimo;
  return { desde: new Date(Date.UTC(a, mes - 1, desde)), hasta: new Date(Date.UTC(a, mes - 1, hasta, 12)), diasPeriodo: m[3] ? 15 : 30 };
}

export async function calcularNomina(empresaId, { periodo, novedades = {} }) {
  const { desde, hasta, diasPeriodo } = fechasPeriodo(periodo);
  const p = await parametros(empresaId);
  const empleados = await Empleado.find({ empresa: empresaId, activo: true, fechaIngreso: { $lte: hasta },
    $or: [{ fechaRetiro: null }, { fechaRetiro: { $gte: desde } }] }).sort({ nombres: 1 }).lean();
  const lineas = empleados.map(e => {
    // Días por defecto: los del periodo menos los que no alcanzó a trabajar (ingreso o retiro dentro del periodo)
    const ini = e.fechaIngreso > desde ? Math.round((e.fechaIngreso - desde) / 86400000) : 0;
    const fin = e.fechaRetiro && e.fechaRetiro < hasta ? Math.round((hasta - e.fechaRetiro) / 86400000) : 0;
    const n = { dias: Math.max(0, diasPeriodo - ini - fin), ...(novedades[String(e._id)] || {}) };
    return calcularEmpleado(e, n, { ...p, diasPeriodo });
  });
  return { periodo, fecha: hasta, lineas, totales: totalesNomina(lineas), parametros: { smmlv: p.smmlv, auxilioTransporte: p.auxilioTransporte, exoneradaAportes: p.exoneradaAportes } };
}

export async function liquidarNomina(empresaId, { periodo, novedades, usuario = null }) {
  const numero = `NOM-${periodo}`;
  if (await Nomina.exists({ empresa: empresaId, numero, estado: { $ne: 'ANULADA' } })) throw new ErrorHttp(409, `La nómina ${periodo} ya está liquidada`);
  const c = await calcularNomina(empresaId, { periodo, novedades });
  if (!c.lineas.length) throw new ErrorHttp(400, 'No hay empleados activos en el periodo');
  const lineas = lineasAsientoNomina(c.totales);
  await validarAsiento(empresaId, { fecha: c.fecha, lineas });
  // Si se anuló antes, se reemplaza el documento anulado con el mismo número
  await Nomina.deleteOne({ empresa: empresaId, numero, estado: 'ANULADA' });
  const a = await postear(empresaId, { fecha: c.fecha, documento: numero, origen: 'NOM', usuario, lineas, tercero: 'Empleados', concepto: `Nómina ${periodo} (${c.lineas.length} empleados)` });
  try {
    return await Nomina.create({ empresa: empresaId, numero, periodo, fecha: c.fecha, lineas: c.lineas, totales: c.totales, asiento: a.numero, usuario });
  } catch (e) {
    await Asiento.updateOne({ empresa: empresaId, _id: a._id }, { $set: { estado: 'ANULADO', concepto: `${a.concepto} (anulado: la nómina no se pudo guardar)` } });
    throw e;
  }
}

export async function anularNomina(empresaId, numero) {
  const n = await Nomina.findOne({ empresa: empresaId, numero });
  if (!n) throw new ErrorHttp(404, 'Nómina no encontrada');
  if (n.estado === 'ANULADA') throw new ErrorHttp(409, 'La nómina ya estaba anulada');
  if (n.asientoPago || n.asientoAportes) throw new ErrorHttp(409, 'La nómina ya tiene pagos registrados: anúlelos primero en el libro diario');
  await anularAsiento(empresaId, n.asiento, { desdeDocumento: true });
  n.estado = 'ANULADA'; await n.save();
  return n;
}

// Pago de la nómina (neto a los empleados) o de la seguridad social y parafiscales (planilla PILA)
export async function pagarNomina(empresaId, numero, { que = 'empleados', fecha = new Date(), cuenta = '1110', usuario = null }) {
  const n = await Nomina.findOne({ empresa: empresaId, numero });
  if (!n || n.estado === 'ANULADA') throw new ErrorHttp(404, 'Nómina no encontrada');
  const t = n.totales; const A = t.aportes;
  let lineas; let concepto;
  if (que === 'empleados') {
    if (n.asientoPago) throw new ErrorHttp(409, 'El pago de esta nómina ya está registrado');
    lineas = [['2505', t.neto], [cuenta, -t.neto]]; concepto = `Pago nómina ${n.periodo}`;
  } else {
    if (n.asientoAportes) throw new ErrorHttp(409, 'La planilla de esta nómina ya está registrada');
    const salud = t.saludEmp + A.salud; const pension = t.pensionEmp + t.fondoSolidaridad + A.pension; const para = A.caja + A.icbf + A.sena;
    const total = salud + pension + A.arl + para;
    lineas = [['237005', salud], ['237030', pension], ['237006', A.arl], ['237010', para], [cuenta, -total]]; concepto = `Pago planilla PILA ${n.periodo}`;
  }
  const a = await postear(empresaId, { fecha, documento: n.numero, origen: 'NPA', usuario, lineas, tercero: que === 'empleados' ? 'Empleados' : 'Operador PILA', concepto });
  if (que === 'empleados') { n.asientoPago = a.numero; n.estado = n.asientoAportes ? 'PAGADA' : n.estado; } else n.asientoAportes = a.numero;
  if (n.asientoPago && n.asientoAportes) n.estado = 'PAGADA';
  await n.save();
  return { nomina: n.numero, asiento: a.numero };
}

export async function desprendiblePdf(empresa, empresaId, numero, numId) {
  const n = await Nomina.findOne({ empresa: empresaId, numero }).lean();
  if (!n) throw new ErrorHttp(404, 'Nómina no encontrada');
  const l = n.lineas.find(x => x.numId === String(numId));
  if (!l) throw new ErrorHttp(404, 'El empleado no está en esa nómina');
  const doc = nuevoPdf(`Desprendible ${n.periodo} ${l.nombre}`, 'portrait');
  encabezadoPdf(doc, { empresa, titulo: `COMPROBANTE DE PAGO DE NÓMINA · ${n.periodo}`, subtitulo: `${l.nombre} · C.C. ${l.numId}${l.cargo ? ` · ${l.cargo}` : ''} · ${l.dias} días` });
  const p = (v) => `$ ${$(v).toLocaleString('es-CO')}`;
  const dev = [['Salario', l.salario], ['Auxilio de transporte', l.auxilioTransporte], ['Horas extras y recargos', l.extras], ['Bonificaciones', l.bonificaciones], ['Pagos no salariales', l.noSalariales]].filter(x => x[1]);
  const ded = [['Salud (4 %)', l.saludEmp], ['Pensión (4 %)', l.pensionEmp], ['Fondo de solidaridad pensional', l.fondoSolidaridad], ['Retención en la fuente', l.retencion], ['Otras deducciones', l.otrasDeducciones]].filter(x => x[1]);
  tablaPdf(doc, [{ titulo: 'Devengos', peso: 3 }, { titulo: 'Valor', peso: 1, alin: 'right' }], dev.map(x => [x[0], p(x[1])]), { total: ['Total devengado', p(l.devengado)] });
  tablaPdf(doc, [{ titulo: 'Deducciones', peso: 3 }, { titulo: 'Valor', peso: 1, alin: 'right' }], ded.map(x => [x[0], p(x[1])]), { total: ['Total deducciones', p(l.deducciones)] });
  doc.font('Helvetica-Bold').fontSize(12).fillColor('black').text(`NETO A PAGAR: ${p(l.neto)}`); doc.moveDown(2);
  doc.moveTo(40, doc.y).lineTo(260, doc.y).lineWidth(0.6).stroke(); doc.font('Helvetica').fontSize(8).text('Recibí conforme (firma y C.C.)', 40, doc.y + 4);
  numerarPaginas(doc);
  return pdfABuffer(doc);
}

// Nómina electrónica: devengos y deducciones por empleado para el proveedor tecnológico (documento soporte de pago de nómina)
export const COLUMNAS_NE = ['Periodo', 'Tipo doc.', 'Número', 'Nombre', 'Días', 'Salario', 'Auxilio transporte', 'Horas extras', 'Bonificaciones', 'No salariales',
  'Total devengado', 'Salud', 'Pensión', 'Fondo solidaridad', 'Retención', 'Otras deducciones', 'Total deducciones', 'Neto'];
export async function nominaElectronica(empresaId, numero) {
  const n = await Nomina.findOne({ empresa: empresaId, numero }).lean();
  if (!n || n.estado === 'ANULADA') throw new ErrorHttp(404, 'Nómina no encontrada');
  const tipos = new Map((await Empleado.find({ empresa: empresaId, numId: { $in: n.lineas.map(l => l.numId) } }).select('numId tipoId').lean()).map(e => [e.numId, e.tipoId]));
  return { titulo: `Nómina electrónica ${n.periodo}`, columnas: COLUMNAS_NE,
    filas: n.lineas.map(l => [n.periodo, tipos.get(l.numId) || 'CC', l.numId, l.nombre, l.dias, l.salario, l.auxilioTransporte, l.extras, l.bonificaciones, l.noSalariales,
      l.devengado, l.saludEmp, l.pensionEmp, l.fondoSolidaridad, l.retencion, l.otrasDeducciones, l.deducciones, l.neto]) };
}

// ── Activos fijos y depreciación ────────────────────────────────────────────
export const VIDA_UTIL = { 1540: 120, 1524: 120, 1528: 60, 1516: 540 };
export function cuotaDepreciacion(a) {
  const depreciable = Math.max(0, $(a.costo) - $(a.valorResidual));
  const pendiente = depreciable - $(a.depreciacionAcumulada);
  if (pendiente <= 0 || a.estado !== 'ACTIVO') return 0;
  return Math.min(pendiente, Math.round(depreciable / a.vidaUtilMeses));
}
const finMes = (mes) => { const [a, m] = mes.split('-').map(Number); return new Date(Date.UTC(a, m, 0, 12)); };

// Registra un activo. Si se indica `cuentaPago`, también contabiliza la compra (activo contra bancos, caja o proveedores).
export async function crearActivo(empresaId, d, usuario = null) {
  await asegurarPuc(empresaId);
  if (!await CuentaContable.exists({ empresa: empresaId, codigo: d.cuenta })) throw new ErrorHttp(400, `La cuenta ${d.cuenta} no existe`);
  if (!/^15\d{2}/.test(d.cuenta) || d.cuenta.startsWith('1592')) throw new ErrorHttp(400, 'La cuenta del activo debe ser de propiedad, planta y equipo (15xx)');
  if ($(d.valorResidual) >= $(d.costo)) throw new ErrorHttp(400, 'El valor residual debe ser menor que el costo');
  const codigo = d.codigo || `AF-${String(await siguiente(empresaId, 'activoFijo')).padStart(4, '0')}`;
  if (await ActivoFijo.exists({ empresa: empresaId, codigo })) throw new ErrorHttp(409, `Ya existe el activo ${codigo}`);
  let asientoCompra = '';
  if (d.cuentaPago) {
    const a = await postear(empresaId, { fecha: d.fechaCompra, documento: codigo, origen: 'ACT', usuario, concepto: `Compra de activo ${codigo} - ${d.nombre}`,
      lineas: [[d.cuenta, $(d.costo)], [d.cuentaPago, -$(d.costo)]] });
    asientoCompra = a.numero;
  }
  return ActivoFijo.create({ ...d, empresa: empresaId, codigo, depreciacionAcumulada: $(d.depreciacionAcumulada), asientoCompra });
}

// Depreciación del mes de todos los activos (un asiento DEP-aaaa-mm): 5160 contra 1592
export async function depreciarMes(empresaId, mes, usuario = null) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new ErrorHttp(400, 'Mes inválido (aaaa-mm)');
  const documento = `DEP-${mes}`;
  if (await Asiento.exists({ empresa: empresaId, documento, origen: 'DEP', estado: 'ACTIVO' })) throw new ErrorHttp(409, `La depreciación de ${mes} ya está registrada`);
  const fecha = finMes(mes);
  const activos = await ActivoFijo.find({ empresa: empresaId, estado: 'ACTIVO', fechaCompra: { $lte: fecha } });
  const cuotas = activos.map(a => ({ a, valor: a.depreciaciones.some(x => x.mes === mes) ? 0 : cuotaDepreciacion(a) })).filter(x => x.valor > 0);
  if (!cuotas.length) throw new ErrorHttp(400, 'No hay activos por depreciar en ese mes');
  const total = cuotas.reduce((t, x) => t + x.valor, 0);
  const asiento = await postear(empresaId, { fecha, documento, origen: 'DEP', usuario, concepto: `Depreciación ${mes} (${cuotas.length} activos)`, lineas: [['5160', total], ['1592', -total]] });
  for (const { a, valor } of cuotas) { a.depreciacionAcumulada += valor; a.depreciaciones.push({ mes, valor, asiento: asiento.numero }); await a.save(); }
  return { mes, total, activos: cuotas.length, asiento: asiento.numero };
}

export async function anularDepreciacion(empresaId, mes) {
  const a = await Asiento.findOne({ empresa: empresaId, documento: `DEP-${mes}`, origen: 'DEP', estado: 'ACTIVO' });
  if (!a) throw new ErrorHttp(404, 'No hay depreciación registrada de ese mes');
  await anularAsiento(empresaId, a.numero, { desdeDocumento: true });
  for (const x of await ActivoFijo.find({ empresa: empresaId, 'depreciaciones.mes': mes })) {
    const d = x.depreciaciones.find(y => y.mes === mes);
    x.depreciacionAcumulada -= d.valor; x.depreciaciones = x.depreciaciones.filter(y => y.mes !== mes); await x.save();
  }
  return { mes, anulado: a.numero };
}

// Venta o baja: sale el costo y la depreciación acumulada; la diferencia con el precio es utilidad (4245) o pérdida (5310)
export async function darDeBaja(empresaId, codigo, { fecha, precio = 0, cuentaCobro = '1110', motivo = '', usuario = null }) {
  const a = await ActivoFijo.findOne({ empresa: empresaId, codigo });
  if (!a) throw new ErrorHttp(404, 'Activo no encontrado');
  if (a.estado !== 'ACTIVO') throw new ErrorHttp(409, 'El activo ya fue vendido o dado de baja');
  const neto = $(a.costo) - $(a.depreciacionAcumulada); const p = $(precio);
  const resultado = p - neto;
  const lineas = [['1592', $(a.depreciacionAcumulada)], [cuentaCobro, p], [a.cuenta, -$(a.costo)], resultado > 0 ? ['4245', -resultado] : ['5310', -resultado]];
  const as = await postear(empresaId, { fecha, documento: a.codigo, origen: 'ACT', usuario, lineas,
    concepto: `${p ? 'Venta' : 'Baja'} del activo ${a.codigo} - ${a.nombre}${motivo ? ` (${motivo})` : ''}` });
  a.estado = p ? 'VENDIDO' : 'BAJA'; a.baja = { fecha, precio: p, asiento: as.numero, motivo }; await a.save();
  return { activo: a.codigo, estado: a.estado, resultado, asiento: as.numero };
}

// ── Cierre contable del año ─────────────────────────────────────────────────
// Lleva a cero las cuentas de resultado (clases 4 a 7) del año contra 3605 (utilidad) o 3610 (pérdida).
export async function cierreAnual(empresaId, anio, usuario = null) {
  const a = Number(anio);
  if (!Number.isInteger(a)) throw new ErrorHttp(400, 'Año inválido');
  const documento = `CIERRE-${a}`;
  if (await Asiento.exists({ empresa: empresaId, documento, origen: 'CIE', estado: 'ACTIVO' })) throw new ErrorHttp(409, `El año ${a} ya está cerrado`);
  const desde = new Date(Date.UTC(a, 0, 1)); const hasta = new Date(Date.UTC(a, 11, 31, 23, 59, 59));
  const sumas = await Asiento.aggregate([{ $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $gte: desde, $lte: hasta }, origen: { $ne: 'CIE' } } },
    { $unwind: '$lineas' }, { $match: { 'lineas.cuenta': { $regex: '^[4-7]' } } }, { $group: { _id: '$lineas.cuenta', d: { $sum: '$lineas.debito' }, c: { $sum: '$lineas.credito' } } }]);
  const cierre = calcularCierre(sumas);
  if (cierre.lineas.length < 2) throw new ErrorHttp(400, 'No hay movimientos de resultado en el año');
  const as = await postear(empresaId, { fecha: new Date(Date.UTC(a, 11, 31, 12)), documento, origen: 'CIE', usuario, lineas: cierre.lineas,
    concepto: `Cierre contable ${a}: ${cierre.resultado >= 0 ? 'utilidad' : 'pérdida'} del ejercicio` });
  return { anio: a, resultado: cierre.resultado, asiento: as.numero };
}

// Regla pura del cierre: cada cuenta de resultado con su saldo invertido; el resultado del año a 3605 o 3610.
// resultado > 0 = utilidad (créditos de ingresos mayores que débitos de costos y gastos).
export function calcularCierre(sumas) {
  const lineas = sumas.filter(x => /^[4-7]/.test(x._id) && Math.round(x.d - x.c) !== 0).map(x => [x._id, -Math.round(x.d - x.c)]);
  const resultado = lineas.reduce((t, l) => t + l[1], 0);
  if (resultado) lineas.push([resultado > 0 ? '3605' : '3610', -resultado]);
  return { lineas, resultado };
}

export async function anularCierre(empresaId, anio) {
  const a = await Asiento.findOne({ empresa: empresaId, documento: `CIERRE-${anio}`, origen: 'CIE', estado: 'ACTIVO' });
  if (!a) throw new ErrorHttp(404, 'Ese año no tiene cierre');
  await anularAsiento(empresaId, a.numero, { desdeDocumento: true });
  return { anio: Number(anio), anulado: a.numero };
}

// ── Notas crédito y débito a facturas de venta ──────────────────────────────
// La nota toma el asiento de la factura en proporción al valor (sirve igual para el modelo bruto o de terceros):
// la nota crédito lo reversa en esa proporción y la débito lo repite. El neto (1305) ajusta el saldo por cobrar.
export function lineasNota(lineasFactura, total, valor, tipo) {
  const f = valor / total; const signo = tipo === 'CREDITO' ? -1 : 1;
  const ls = lineasFactura.map(l => [l.cuenta, signo * Math.round((l.debito - l.credito) * f)]);
  const dif = ls.reduce((t, l) => t + l[1], 0);
  const i = ls.findIndex(l => l[0] === '1305');
  if (dif && i >= 0) ls[i][1] -= dif;           // el redondeo se ajusta en la cuenta por cobrar
  return ls;
}

export async function crearNota(empresaId, numeroFactura, { tipo, valor, motivo, fecha = new Date(), cude = '', usuario = null }) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero: numeroFactura }).populate({ path: 'cliente', match: { empresa: empresaId }, select: 'nombre nit' });
  if (!f || f.estado === 'ANULADA') throw new ErrorHttp(404, 'Factura no encontrada');
  const v = $(valor);
  if (v <= 0) throw new ErrorHttp(400, 'El valor de la nota debe ser mayor que cero');
  const fa = await Asiento.findOne({ empresa: empresaId, numero: f.asiento }).lean();
  if (!fa) throw new ErrorHttp(409, 'La factura no tiene asiento contable');
  const lineas = lineasNota(fa.lineas, f.total, v, tipo);
  const neto = lineas.find(l => l[0] === '1305')?.[1] || 0;
  if (tipo === 'CREDITO' && -neto > saldoFactura(f)) throw new ErrorHttp(400, `La nota crédito (neto ${-neto}) supera el saldo por cobrar de la factura (${saldoFactura(f)})`);
  const numero = `${tipo === 'CREDITO' ? 'NC' : 'ND'}-${String(await siguiente(empresaId, tipo === 'CREDITO' ? 'notaCredito' : 'notaDebito')).padStart(4, '0')}`;
  const a = await postear(empresaId, { fecha, documento: numero, origen: 'NOT', usuario, lineas, terceroDoc: f.cliente?.nit, tercero: f.cliente?.nombre,
    concepto: `Nota ${tipo === 'CREDITO' ? 'crédito' : 'débito'} ${numero} a la factura ${f.numero}${motivo ? ` - ${motivo}` : ''}` });
  f.notas.push({ numero, tipo, fecha, valor: v, neto, motivo, asiento: a.numero, cude, estado: 'VIGENTE' });
  f.ajusteNeto = $(f.ajusteNeto) + neto;
  f.estado = saldoFactura(f) <= 0 ? 'COBRADA' : 'PENDIENTE';
  await f.save();
  return { factura: f.numero, nota: numero, neto, saldo: saldoFactura(f), asiento: a.numero };
}

export async function anularNota(empresaId, numeroFactura, numeroNota) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero: numeroFactura });
  const n = f?.notas.find(x => x.numero === numeroNota);
  if (!n || n.estado === 'ANULADA') throw new ErrorHttp(404, 'Nota no encontrada');
  if (n.tipo === 'DEBITO' && saldoFactura(f) - n.neto < 0) throw new ErrorHttp(409, 'La nota débito ya se cobró: anule primero el cobro');
  await anularAsiento(empresaId, n.asiento, { desdeDocumento: true });
  n.estado = 'ANULADA'; f.ajusteNeto = $(f.ajusteNeto) - n.neto;
  f.estado = saldoFactura(f) <= 0 ? 'COBRADA' : 'PENDIENTE';
  f.markModified('notas'); await f.save();
  return { factura: f.numero, nota: n.numero, saldo: saldoFactura(f) };
}

