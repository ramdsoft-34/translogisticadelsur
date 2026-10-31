// Contabilidad fase 3 (tributario y fiscal): borrador de la declaración de retención en la fuente (350),
// ReteICA e ICA, pago de impuestos, calendario de vencimientos, información exógena (1001, 1007, 1008, 1009),
// certificados de retención y relación de remesas para la factura electrónica de transporte (RNDC).
// Son borradores de apoyo: la contadora revisa y presenta en los servicios en línea de la DIAN y del municipio.
import mongoose from 'mongoose';
import { CompraCont, FacturaCont, LiquidacionConductor, Asiento, ProveedorCont, Cliente, Tercero, Viaje, Tarifa, Empresa } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { postear, parametros, resultados } from './contabilidad.js';
import { CONCEPTOS_RETENCION, rangoMes } from './compras.js';
import { lineaLiquidacion, respaldosAuxiliar } from '../calculos.js';
import { nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../reportes/comun.js';
import { fmtFecha } from '../../utils/texto.js';

const $ = (n) => Math.round(Number(n) || 0);
const oid = (v) => new mongoose.Types.ObjectId(String(v));
const rangoAnio = (anio) => {
  const a = Number(anio);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new ErrorHttp(400, 'Año inválido');
  return { desde: new Date(Date.UTC(a, 0, 1)), hasta: new Date(Date.UTC(a, 11, 31, 23, 59, 59, 999)) };
};
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');

// Dígito de verificación del NIT (algoritmo de la DIAN, módulo 11)
export function digitoVerificacion(nit) {
  const n = soloDigitos(nit);
  if (!n) return '';
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let suma = 0;
  [...n].reverse().forEach((d, i) => { suma += Number(d) * pesos[i]; });
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}

// ── Retención en la fuente (formulario 350, borrador) ───────────────────────
// Agrupa las retenciones practicadas en las compras del mes por concepto, con su base. Las retenciones
// registradas en 2365 por otros documentos (liquidaciones de conductores, asientos manuales) van aparte.
export const GRUPOS_350 = {
  honorarios_pj: 'Honorarios', honorarios_pn: 'Honorarios', servicios: 'Servicios', servicios_no_declarante: 'Servicios',
  transporte_carga: 'Servicios de transporte de carga', arrendamiento_inmuebles: 'Arrendamientos', arrendamiento_muebles: 'Arrendamientos',
  compras: 'Compras', compras_no_declarante: 'Compras', combustibles: 'Compras (combustibles)',
};

export function agruparRetenciones(compras) {
  const g = new Map();
  for (const c of compras) {
    if (!c.retefuente) continue;
    const k = GRUPOS_350[c.conceptoRetencion] || 'Otros pagos sujetos a retención';
    const x = g.get(k) || { concepto: k, base: 0, retencion: 0, documentos: 0 };
    x.base += $(c.subtotal); x.retencion += $(c.retefuente); x.documentos += 1;
    g.set(k, x);
  }
  return [...g.values()].sort((a, b) => b.retencion - a.retencion);
}

async function creditosCuenta(empresaId, cuenta, desde, hasta, excluirOrigen = []) {
  const [x] = await Asiento.aggregate([{ $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $gte: desde, $lte: hasta }, origen: { $nin: excluirOrigen } } },
    { $unwind: '$lineas' }, { $match: { 'lineas.cuenta': cuenta } }, { $group: { _id: null, c: { $sum: '$lineas.credito' }, d: { $sum: '$lineas.debito' } } }]);
  return { creditos: x?.c || 0, debitos: x?.d || 0 };
}
async function saldoCuenta(empresaId, cuenta, hasta) {
  const [x] = await Asiento.aggregate([{ $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $lte: hasta } } },
    { $unwind: '$lineas' }, { $match: { 'lineas.cuenta': cuenta } }, { $group: { _id: null, c: { $sum: '$lineas.credito' }, d: { $sum: '$lineas.debito' } } }]);
  return (x?.c || 0) - (x?.d || 0);
}

export async function borrador350(empresaId, mes) {
  const { desde, hasta } = rangoMes(mes);
  const compras = await CompraCont.find({ empresa: empresaId, estado: { $ne: 'ANULADA' }, fecha: { $gte: desde, $lte: hasta } }).lean();
  const conceptos = agruparRetenciones(compras);
  const otras2365 = (await creditosCuenta(empresaId, '2365', desde, hasta, ['CMP', 'IMP'])).creditos;
  const liquidaciones = await LiquidacionConductor.find({ empresa: empresaId, estado: 'VIGENTE', fecha: { $gte: desde, $lte: hasta } }).select('flete auxiliar retefuente').lean();
  const retencionTransporte = liquidaciones.reduce((a, l) => a + $(l.retefuente), 0);
  const reteIva = compras.reduce((a, c) => a + $(c.reteIva), 0);
  const totalRenta = conceptos.reduce((a, x) => a + x.retencion, 0) + otras2365;
  return {
    mes, conceptos,
    otrasRetenciones: { valor: otras2365, transporteConductores: retencionTransporte,
      baseConductores: liquidaciones.reduce((a, l) => a + $(l.flete) + $(l.auxiliar), 0) },
    reteIva, totalRenta, totalAPagar: totalRenta + reteIva,
    saldosContables: { '2365': await saldoCuenta(empresaId, '2365', hasta), '2367': await saldoCuenta(empresaId, '2367', hasta) },
    pagos: await pagosDe(empresaId, ['retefuente'], mes),
  };
}

// ── ReteICA practicado e ICA de la empresa ──────────────────────────────────
export async function borradorReteIca(empresaId, desde, hasta) {
  const compras = await CompraCont.find({ empresa: empresaId, estado: { $ne: 'ANULADA' }, fecha: { $gte: desde, $lte: hasta }, reteIca: { $gt: 0 } }).lean();
  const g = new Map();
  for (const c of compras) {
    const x = g.get(c.proveedorNit) || { nit: c.proveedorNit, nombre: c.proveedorNombre, base: 0, tarifaPorMil: c.reteIcaPorMil, retencion: 0 };
    x.base += $(c.subtotal); x.retencion += $(c.reteIca); g.set(c.proveedorNit, x);
  }
  const filas = [...g.values()];
  return { filas, total: filas.reduce((a, x) => a + x.retencion, 0) };
}

// ICA: ingresos del periodo (clase 41) × tarifa por mil del municipio, más avisos y tableros y sobretasa bomberil.
// Con ingresos para terceros la base es solo la comisión (4145): lo recibido para terceros no es ingreso propio.
export function calcularIca({ ingresos, tarifaPorMil = 0, avisosTablerosPct = 15, sobretasaBomberilPct = 0, retencionesPracticadas = 0 }) {
  const impuesto = Math.round($(ingresos) * Number(tarifaPorMil) / 1000);
  const avisos = Math.round(impuesto * Number(avisosTablerosPct) / 100);
  const bomberil = Math.round(impuesto * Number(sobretasaBomberilPct) / 100);
  const total = impuesto + avisos + bomberil;
  return { base: $(ingresos), impuesto, avisos, bomberil, total, retencionesPracticadas: $(retencionesPracticadas), aPagar: Math.max(0, total - $(retencionesPracticadas)) };
}

export async function borradorIca(empresaId, desde, hasta) {
  const p = await parametros(empresaId);
  const r = await resultados(empresaId, desde, hasta);
  const ingresos = r.ingresos.filter(c => /^41/.test(c.codigo)).reduce((a, c) => a + c.saldo, 0);
  // ReteICA que los clientes le practicaron a la empresa (1356) en el periodo
  const retenido = (await creditosCuenta(empresaId, '1356', desde, hasta)).debitos;
  return { ...calcularIca({ ingresos, tarifaPorMil: p.icaTarifaPorMil, avisosTablerosPct: p.avisosTablerosPct, sobretasaBomberilPct: p.sobretasaBomberilPct, retencionesPracticadas: retenido }),
    tarifaPorMil: p.icaTarifaPorMil, ingresosPorCuenta: r.ingresos.filter(c => /^41/.test(c.codigo) && c.saldo).map(c => ({ codigo: c.codigo, nombre: c.nombre, valor: c.saldo })),
    pagos: await pagosDe(empresaId, ['ica'], null, desde, hasta) };
}

// ── Pago de impuestos (asiento IMP) ─────────────────────────────────────────
export const IMPUESTOS = {
  retefuente: { nombre: 'Retención en la fuente (350)', cuenta: '2365' },
  reteiva: { nombre: 'ReteIVA (350)', cuenta: '2367' },
  reteica: { nombre: 'ReteICA practicado', cuenta: '2368' },
  ica: { nombre: 'Industria y comercio', cuenta: '2412' },
  iva: { nombre: 'IVA (300)', cuenta: '2408' },
  renta: { nombre: 'Renta (110)', cuenta: '2404' },
  fopat: { nombre: 'FOPAT y contribuciones', cuenta: '2380' },
};
export const documentoPago = (tipo, periodo) => `IMP-${tipo.toUpperCase()}-${periodo}`;

// Un pago puede cubrir varios impuestos del mismo formulario (350: retefuente + ReteIVA). Intereses y sanciones al gasto.
export async function pagarImpuestos(empresaId, { fecha, periodo, formulario = '', cuenta = '1110', items, intereses = 0, sancion = 0, usuario = null }) {
  const ls = (items || []).filter(i => $(i.valor) > 0);
  if (!ls.length) throw new ErrorHttp(400, 'Indique el valor de al menos un impuesto');
  for (const i of ls) if (!IMPUESTOS[i.tipo]) throw new ErrorHttp(400, `Impuesto desconocido: ${i.tipo}`);
  const total = ls.reduce((a, i) => a + $(i.valor), 0) + $(intereses) + $(sancion);
  const tipos = ls.map(i => i.tipo);
  const lineas = [...ls.map(i => [IMPUESTOS[i.tipo].cuenta, $(i.valor)]), ['530520', $(intereses)], ['5315', $(sancion)], [cuenta === '1105' ? '1105' : '1110', -total]];
  const a = await postear(empresaId, { fecha, documento: documentoPago(tipos[0], periodo), origen: 'IMP', usuario, lineas, tercero: 'DIAN / municipio',
    concepto: `Pago ${ls.map(i => IMPUESTOS[i.tipo].nombre).join(' + ')} · periodo ${periodo}${formulario ? ` · formulario ${formulario}` : ''}` });
  return { asiento: a.numero, total, tipos, periodo };
}

// Pagos registrados (asientos IMP) de unos impuestos, por periodo o por rango de fechas
async function pagosDe(empresaId, tipos, periodo = null, desde = null, hasta = null) {
  const f = { empresa: empresaId, origen: 'IMP', estado: 'ACTIVO' };
  if (periodo) f.documento = { $in: tipos.map(t => documentoPago(t, periodo)) };
  else { f.documento = { $regex: `^IMP-(${tipos.map(t => t.toUpperCase()).join('|')})-` }; if (desde) f.fecha = { $gte: desde, $lte: hasta }; }
  return (await Asiento.find(f).sort({ fecha: 1 }).lean()).map(a => ({ asiento: a.numero, fecha: a.fecha, documento: a.documento, concepto: a.concepto,
    valor: a.lineas.reduce((t, l) => t + l.credito, 0) }));
}

// ── Calendario de vencimientos ──────────────────────────────────────────────
// La contadora carga las fechas del calendario tributario (DIAN según el último dígito del NIT y municipio).
// Se marca «pagado» si hay un pago (asiento IMP) de esa obligación y periodo.
export function estadoVencimientos(vencimientos, pagados, hoy = new Date()) {
  const dia = 86400000;
  return vencimientos.map(v => {
    const dias = Math.ceil((new Date(v.fecha) - hoy) / dia);
    const pagado = pagados.has(documentoPago(v.obligacion, v.periodo));
    return { ...v, dias, pagado, estado: pagado ? 'PAGADO' : dias < 0 ? 'VENCIDO' : dias <= 7 ? 'PRÓXIMO' : 'PENDIENTE' };
  }).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
}
export async function vencimientos(empresaId) {
  const p = await parametros(empresaId);
  const pagos = await Asiento.find({ empresa: empresaId, origen: 'IMP', estado: 'ACTIVO' }).select('documento').lean();
  return estadoVencimientos(p.vencimientos, new Set(pagos.map(x => x.documento)));
}

// ── Información exógena (medios magnéticos) ─────────────────────────────────
// Códigos de concepto del formato 1001 según el concepto de retención de la compra
const CONCEPTO_1001 = { honorarios_pj: '5002', honorarios_pn: '5002', servicios: '5004', servicios_no_declarante: '5004', transporte_carga: '5004',
  arrendamiento_inmuebles: '5005', arrendamiento_muebles: '5005', compras: '5007', compras_no_declarante: '5007', combustibles: '5007', ninguna: '5016' };
const DIRECCION_VACIA = { direccion: '', depto: '', municipio: '' };
const divipola = (cod) => { const c = soloDigitos(cod); return c.length >= 5 ? { depto: c.slice(0, 2), municipio: c.slice(2, 5) } : { depto: '', municipio: '' }; };
const tipoDoc = (t, nit) => ({ N: '31', C: '13', E: '22', P: '41', T: '12' }[String(t || '').toUpperCase()] || (soloDigitos(nit).length >= 9 ? '31' : '13'));

function sumarPorTercero(mapa, clave, base, campos) {
  const x = mapa.get(clave) || { ...base };
  for (const [k, v] of Object.entries(campos)) x[k] = (x[k] || 0) + $(v);
  mapa.set(clave, x);
}

export async function exogena(empresaId, anio, formato) {
  const { desde, hasta } = rangoAnio(anio);
  if (formato === '1001') {
    const m = new Map();
    const provs = new Map((await ProveedorCont.find({ empresa: empresaId }).lean()).map(p => [p.nit, p]));
    for (const c of await CompraCont.find({ empresa: empresaId, estado: { $ne: 'ANULADA' }, fecha: { $gte: desde, $lte: hasta } }).lean()) {
      const p = provs.get(c.proveedorNit) || {};
      const concepto = CONCEPTO_1001[c.conceptoRetencion] || '5016';
      sumarPorTercero(m, `${concepto}|${c.proveedorNit}`, { concepto, tipoDoc: tipoDoc(p.tipoId, c.proveedorNit), nit: c.proveedorNit, dv: p.dv || '', nombre: c.proveedorNombre,
        direccion: p.direccion || '', depto: '', municipio: '' }, { pago: c.subtotal, ivaMayorValor: c.iva, retencion: c.retefuente, reteIva: c.reteIva });
    }
    const terceros = new Map((await Tercero.find({ empresa: empresaId }).select('tipoId numId nombres apellido1 apellido2 direccion codMunicipio').lean()).map(t => [t.numId, t]));
    for (const l of await LiquidacionConductor.find({ empresa: empresaId, estado: 'VIGENTE', fecha: { $gte: desde, $lte: hasta } }).lean()) {
      const t = terceros.get(l.cedula) || {};
      sumarPorTercero(m, `5004|${l.cedula}`, { concepto: '5004', tipoDoc: tipoDoc(t.tipoId, l.cedula), nit: l.cedula, dv: '', nombre: l.conductorNombre,
        direccion: t.direccion || '', ...divipola(t.codMunicipio) }, { pago: $(l.flete) + $(l.auxiliar), ivaMayorValor: 0, retencion: l.retefuente, reteIva: 0 });
    }
    const filas = [...m.values()].filter(x => x.pago || x.retencion).sort((a, b) => a.concepto.localeCompare(b.concepto) || b.pago - a.pago);
    return { formato, titulo: 'Formato 1001 · Pagos o abonos en cuenta y retenciones practicadas',
      columnas: ['Concepto', 'Tipo doc.', 'Número', 'DV', 'Nombre o razón social', 'Dirección', 'Depto.', 'Municipio', 'Pago deducible', 'IVA mayor valor', 'Retención renta', 'ReteIVA'],
      filas: filas.map(x => [x.concepto, x.tipoDoc, x.nit, x.dv || (x.tipoDoc === '31' ? digitoVerificacion(x.nit) : ''), x.nombre, x.direccion, x.depto, x.municipio, x.pago, x.ivaMayorValor, x.retencion, x.reteIva]) };
  }
  if (formato === '1007') {
    const m = new Map();
    const facturas = await FacturaCont.find({ empresa: empresaId, estado: { $ne: 'ANULADA' }, fecha: { $gte: desde, $lte: hasta } }).populate({ path: 'cliente', match: { empresa: empresaId }, select: 'nombre nit dv tipoId' }).lean();
    for (const f of facturas) {
      const c = f.cliente || {};
      const nit = soloDigitos(c.nit);
      sumarPorTercero(m, nit || c.nombre, { concepto: '4001', tipoDoc: tipoDoc(c.tipoId, nit), nit, dv: c.dv || '', nombre: c.nombre || '' },
        { ingreso: f.modeloIngresos === 'terceros' ? f.propio : f.total, terceros: f.modeloIngresos === 'terceros' ? f.terceros : 0,
          devoluciones: (f.notas || []).filter(n => n.tipo === 'CREDITO' && n.estado !== 'ANULADA').reduce((t, n) => t + n.valor, 0) });
    }
    const filas = [...m.values()].sort((a, b) => b.ingreso - a.ingreso);
    return { formato, titulo: 'Formato 1007 · Ingresos recibidos',
      columnas: ['Concepto', 'Tipo doc.', 'Número', 'DV', 'Nombre o razón social', 'País', 'Ingresos brutos recibidos', 'Devoluciones', 'Recibido para terceros (informativo)'],
      filas: filas.map(x => [x.concepto, x.tipoDoc, x.nit, x.dv || (x.tipoDoc === '31' ? digitoVerificacion(x.nit) : ''), x.nombre, '169', x.ingreso, x.devoluciones, x.terceros]) };
  }
  if (formato === '1008' || formato === '1009') {
    const cuentas = formato === '1008' ? [['1305', '1315'], ['1330', '1317'], ['1380', '1318']] : [['2335', '2201'], ['2205', '2201'], ['2815', '2206'], ['281505', '2206'], ['281510', '2206']];
    const porCuenta = new Map(cuentas);
    const filasAg = await Asiento.aggregate([{ $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $lte: hasta } } }, { $unwind: '$lineas' },
      { $match: { 'lineas.cuenta': { $in: cuentas.map(c => c[0]) } } },
      { $group: { _id: { cuenta: '$lineas.cuenta', doc: '$terceroDoc' }, tercero: { $last: '$tercero' }, d: { $sum: '$lineas.debito' }, c: { $sum: '$lineas.credito' } } }]);
    const m = new Map();
    for (const x of filasAg) {
      const saldo = formato === '1008' ? x.d - x.c : x.c - x.d;
      if (!saldo) continue;
      const concepto = porCuenta.get(x._id.cuenta); const nit = soloDigitos(x._id.doc);
      sumarPorTercero(m, `${concepto}|${nit || x.tercero}`, { concepto, tipoDoc: tipoDoc('', nit), nit, nombre: x.tercero || '(sin tercero)' }, { saldo });
    }
    const filas = [...m.values()].filter(x => x.saldo > 0).sort((a, b) => b.saldo - a.saldo);
    return { formato, titulo: formato === '1008' ? `Formato 1008 · Cuentas por cobrar al 31/12/${anio}` : `Formato 1009 · Cuentas por pagar al 31/12/${anio}`,
      columnas: ['Concepto', 'Tipo doc.', 'Número', 'DV', 'Nombre o razón social', 'Saldo al 31 de diciembre'],
      filas: filas.map(x => [x.concepto, x.tipoDoc, x.nit, x.tipoDoc === '31' ? digitoVerificacion(x.nit) : '', x.nombre, x.saldo]) };
  }
  throw new ErrorHttp(404, 'Formato no disponible (1001, 1007, 1008 o 1009)');
}

// ── Certificados de retención ───────────────────────────────────────────────
export async function retencionesPorProveedor(empresaId, anio) {
  const { desde, hasta } = rangoAnio(anio);
  const g = new Map();
  for (const c of await CompraCont.find({ empresa: empresaId, estado: { $ne: 'ANULADA' }, fecha: { $gte: desde, $lte: hasta } }).lean()) {
    if (!c.retefuente && !c.reteIva && !c.reteIca) continue;
    sumarPorTercero(g, c.proveedorNit, { nit: c.proveedorNit, nombre: c.proveedorNombre }, { base: c.subtotal, retefuente: c.retefuente, iva: c.iva, reteIva: c.reteIva, reteIca: c.reteIca });
  }
  return [...g.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function certificadoPdf(empresa, empresaId, { nit, anio, tipo = 'fuente' }) {
  const { desde, hasta } = rangoAnio(anio);
  const compras = await CompraCont.find({ empresa: empresaId, proveedorNit: soloDigitos(nit), estado: { $ne: 'ANULADA' }, fecha: { $gte: desde, $lte: hasta } }).sort({ fecha: 1 }).lean();
  if (!compras.length) throw new ErrorHttp(404, 'El proveedor no tiene compras en ese año');
  const campo = { fuente: 'retefuente', iva: 'reteIva', ica: 'reteIca' }[tipo];
  if (!campo) throw new ErrorHttp(400, 'Tipo de certificado: fuente, iva o ica');
  const titulo = { fuente: 'CERTIFICADO DE RETENCIÓN EN LA FUENTE', iva: 'CERTIFICADO DE RETENCIÓN DE IVA', ica: 'CERTIFICADO DE RETENCIÓN DE ICA' }[tipo];
  const filas = new Map();
  for (const c of compras) {
    if (!c[campo]) continue;
    const k = tipo === 'fuente' ? (CONCEPTOS_RETENCION[c.conceptoRetencion]?.nombre || c.conceptoRetencion) : tipo === 'iva' ? `IVA ${c.reteIvaPct} %` : `ICA ${c.reteIcaPorMil} por mil`;
    const x = filas.get(k) || { concepto: k, base: 0, retenido: 0 };
    x.base += tipo === 'iva' ? $(c.iva) : $(c.subtotal); x.retenido += $(c[campo]); filas.set(k, x);
  }
  if (!filas.size) throw new ErrorHttp(404, 'No se le practicó esa retención en el año');
  const doc = nuevoPdf(`${titulo} ${anio}`, 'portrait');
  encabezadoPdf(doc, { empresa, titulo: `${titulo} · AÑO GRAVABLE ${anio}`, subtitulo: `Expedido el ${fmtFecha(new Date())}` });
  doc.font('Helvetica').fontSize(10).fillColor('black');
  doc.text(`Retenido: ${compras[0].proveedorNombre} · NIT / C.C. ${compras[0].proveedorNit}`);
  doc.text(`Agente retenedor: ${empresa.nombre} · NIT ${empresa.nit}${empresa.dv ? `-${empresa.dv}` : ''}${empresa.ciudad ? ` · ${empresa.ciudad}` : ''}`);
  doc.text(`Periodo: 01/01/${anio} a 31/12/${anio}`); doc.moveDown(0.6);
  const ls = [...filas.values()]; const tb = ls.reduce((a, x) => a + x.base, 0); const tr = ls.reduce((a, x) => a + x.retenido, 0);
  const pesos = (n) => `$ ${n.toLocaleString('es-CO')}`;
  tablaPdf(doc, [{ titulo: 'Concepto', peso: 3 }, { titulo: tipo === 'iva' ? 'IVA facturado' : 'Base', peso: 1, alin: 'right' }, { titulo: 'Valor retenido', peso: 1, alin: 'right' }],
    ls.map(x => [x.concepto, pesos(x.base), pesos(x.retenido)]), { total: ['TOTAL', pesos(tb), pesos(tr)] });
  doc.moveDown(1).fontSize(8).fillColor('#444').text('Los valores retenidos fueron consignados oportunamente a favor de la administración correspondiente. ' +
    'Certificado expedido sin firma autógrafa (artículo 10 del Decreto 836 de 1991, compilado en el Decreto 1625 de 2016).');
  numerarPaginas(doc);
  return pdfABuffer(doc);
}

// ── Factura electrónica de transporte: relación de remesas (Guía V11 del RNDC) ─
// Una fila por remesa de los viajes de la factura: radicado y consecutivo de la remesa en el RNDC, flete facturado
// y cantidad entregada (kg). Sirve para el proveedor tecnológico (campos 01/02/03 de cada ítem) y para reportar la
// factura al RNDC.
export const COLUMNAS_RELACION = ['TIPOIDFACTURADOR', 'NUMIDFACTURADOR', 'TIPOIDADQUIRENTE', 'NUMIDADQUIRENTE', 'NUMEROFACTURA', 'CUFE', 'TIPODOCUMENTO',
  'TIPOOPERACION', 'RADICADOREMESA', 'CONSECUTIVOREMESA', 'VALORFLETE', 'CANTIDADENTREGADA', 'UNIDADMEDIDA'];
const conDv = (nit) => { const n = soloDigitos(nit); return n.length === 9 ? n + digitoVerificacion(n) : n; };

export async function relacionRemesas(empresaId, numero) {
  const f = await FacturaCont.findOne({ empresa: empresaId, numero }).lean();
  if (!f) throw new ErrorHttp(404, 'Factura no encontrada');
  if (!f.viajesIds?.length) throw new ErrorHttp(409, 'La factura no tiene viajes escogidos (se facturó antes de la fase 1): no se puede armar la relación');
  const [empresa, cliente] = await Promise.all([Empresa.findById(empresaId).lean(), Cliente.findOne({ empresa: empresaId, _id: f.cliente }).lean()]);
  const viajes = await Viaje.find({ empresa: empresaId, _id: { $in: f.viajesIds } }).sort({ fecha: 1, numero: 1 }).lean();
  const tarifas = await Tarifa.find({ empresa: empresaId, cliente: f.cliente }).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldo = respaldosAuxiliar(tarifas).get(String(f.cliente));
  const nitCli = soloDigitos(cliente?.nit);
  const avisos = [];
  if (!f.fe?.numero || !f.fe?.cufe) avisos.push('Falta el número y el CUFE de la factura electrónica (los da el proveedor tecnológico)');
  const filas = viajes.map(v => {
    const l = lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo, cliente });
    if (!v.remesa?.numero) avisos.push(`El viaje ${v.numero} no tiene remesa en el RNDC`);
    return ['N', conDv(empresa.nit), nitCli.length >= 9 ? 'N' : 'C', nitCli.length >= 9 ? conDv(nitCli) : nitCli, f.fe?.numero || '', f.fe?.cufe || '', 'FV',
      f.fe?.tipoOperacion || '12', v.remesa?.radicado || '0', v.remesa?.numero || '', $(l.totalCobrado), $(v.pesoKg), 'K'];
  });
  // Ítems para el XML UBL (AdditionalItemProperty 01 radicado, 02 consecutivo, 03 valor del flete en kg)
  const items = viajes.map((v, i) => ({ descripcion: `Servicio de transporte de carga remesa ${v.remesa?.numero || ''} · ${v.destino || ''}`.trim(),
    valor: filas[i][10], propiedades: [{ nombre: '01', valor: v.remesa?.radicado || '0' }, { nombre: '02', valor: v.remesa?.numero || '' },
      { nombre: '03', valor: String(filas[i][10]), unidad: 'KGM', cantidad: filas[i][11] }] }));
  return { factura: f.numero, fe: f.fe || {}, columnas: COLUMNAS_RELACION, filas, items, avisos: [...new Set(avisos)] };
}

export async function guardarDatosFe(empresaId, numero, { numero: numFe, cufe, tipoOperacion = '12' }) {
  const n = String(numFe || '').trim().toUpperCase(); const c = String(cufe || '').trim().toLowerCase();
  if (c && !/^[0-9a-f]{96}$/.test(c)) throw new ErrorHttp(400, 'El CUFE debe tener 96 caracteres hexadecimales (SHA-384)');
  const f = await FacturaCont.findOneAndUpdate({ empresa: empresaId, numero }, { $set: { 'fe.numero': n, 'fe.cufe': c, 'fe.tipoOperacion': tipoOperacion } }, { new: true });
  if (!f) throw new ErrorHttp(404, 'Factura no encontrada');
  return f;
}
