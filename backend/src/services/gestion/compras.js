// Contabilidad fase 2: proveedores con datos fiscales, compras (causación) con retenciones, lectura del XML
// de la factura electrónica (DIAN), comprobantes de egreso y conciliación bancaria.
// Apoyo administrativo: la contadora debe revisar retenciones y cuentas antes de presentar declaraciones.
import mongoose from 'mongoose';
import { ProveedorCont, CompraCont, EgresoCont, ConciliacionCont, Asiento, CuentaContable, siguiente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { postear, validarAsiento, anularAsiento, parametros, asegurarPuc } from './contabilidad.js';
import { asegurarMesAbierto } from './cierre.js';
import { nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../reportes/comun.js';
import { fmtFecha } from '../../utils/texto.js';

const $ = (n) => Math.round(Number(n) || 0);

// ── Tabla de retención en la fuente ─────────────────────────────────────────
// Bases y tarifas del Decreto 572 de 2025 (vigentes desde el 1 de julio de 2026, cuando el Consejo de Estado
// levantó la suspensión). Cada empresa puede cambiarlas en Parámetros si la norma cambia. UVT 2026: $52.374.
export const CONCEPTOS_RETENCION = {
  ninguna: { nombre: 'Sin retención en la fuente', pct: 0, baseUvt: 0 },
  compras: { nombre: 'Compras generales (declarante)', pct: 2.5, baseUvt: 10 },
  compras_no_declarante: { nombre: 'Compras generales (no declarante)', pct: 3.5, baseUvt: 10 },
  servicios: { nombre: 'Servicios generales (declarante)', pct: 4, baseUvt: 2 },
  servicios_no_declarante: { nombre: 'Servicios generales (no declarante)', pct: 6, baseUvt: 2 },
  transporte_carga: { nombre: 'Transporte de carga', pct: 1, baseUvt: 2 },
  honorarios_pj: { nombre: 'Honorarios y comisiones (persona jurídica)', pct: 11, baseUvt: 0 },
  honorarios_pn: { nombre: 'Honorarios y comisiones (persona natural)', pct: 10, baseUvt: 0 },
  arrendamiento_inmuebles: { nombre: 'Arrendamiento de inmuebles', pct: 3.5, baseUvt: 10 },
  arrendamiento_muebles: { nombre: 'Arrendamiento de muebles', pct: 4, baseUvt: 0 },
  combustibles: { nombre: 'Compra de combustibles', pct: 0.1, baseUvt: 0 },
};

// Tabla efectiva de la empresa: la base con los cambios guardados en Parámetros
export function tablaRetenciones(param = {}) {
  const t = {};
  for (const [k, v] of Object.entries(CONCEPTOS_RETENCION)) {
    const p = param.retenciones?.[k] || {};
    t[k] = { ...v, pct: Number.isFinite(Number(p.pct)) && p.pct !== '' && p.pct !== undefined ? Number(p.pct) : v.pct,
      baseUvt: Number.isFinite(Number(p.baseUvt)) && p.baseUvt !== '' && p.baseUvt !== undefined ? Number(p.baseUvt) : v.baseUvt };
  }
  return t;
}

// Cálculo de una compra (regla pura, sin base de datos).
//   lineas: [{ cuenta, descripcion, base, ivaPct }]
//   proveedor.fiscal: { declarante, autorretenedor, granContribuyente, reteIcaPorMil }
//   param: { uvt, ivaDescontable, agenteReteIva, reteIvaPct, retenciones }
//   manual: { retefuentePct, reteIvaPct, reteIcaPorMil } reemplazan lo calculado si vienen
// Reglas: al autorretenedor no se le practica retefuente; si el proveedor no declara renta se usa la tarifa de
// no declarante; la retención solo aplica si el subtotal llega a la base mínima en UVT. ReteIVA solo si la
// empresa es agente de retención de IVA y el proveedor no es gran contribuyente. Si la empresa no es responsable
// de IVA (transporte de carga, excluido), el IVA de la compra es mayor valor de la cuenta de cada línea.
export function calcularCompra({ lineas = [], concepto = 'servicios', proveedor = {}, param = {}, manual = {} }) {
  const f = proveedor.fiscal || {};
  const tabla = tablaRetenciones(param);
  const uvt = Number(param.uvt) || 52374;
  const ls = lineas.filter(l => $(l.base) > 0).map(l => {
    const base = $(l.base), ivaPct = Number(l.ivaPct) || 0;
    return { cuenta: String(l.cuenta || ''), descripcion: String(l.descripcion || '').slice(0, 200), base, ivaPct, iva: Math.round(base * ivaPct / 100) };
  });
  if (!ls.length) throw new ErrorHttp(400, 'La compra no tiene valores');
  const subtotal = ls.reduce((a, l) => a + l.base, 0);
  const iva = ls.reduce((a, l) => a + l.iva, 0);
  const total = subtotal + iva;
  let conceptoEf = concepto in tabla ? concepto : 'ninguna';
  if (f.declarante === false && tabla[`${conceptoEf}_no_declarante`]) conceptoEf = `${conceptoEf}_no_declarante`;
  const c = tabla[conceptoEf];
  let retefuentePct = f.autorretenedor || subtotal < c.baseUvt * uvt ? 0 : c.pct;
  if (manual.retefuentePct !== undefined && manual.retefuentePct !== null && manual.retefuentePct !== '') retefuentePct = Number(manual.retefuentePct);
  let reteIvaPct = param.agenteReteIva && iva > 0 && !f.granContribuyente ? Number(param.reteIvaPct ?? 15) : 0;
  if (manual.reteIvaPct !== undefined && manual.reteIvaPct !== null && manual.reteIvaPct !== '') reteIvaPct = Number(manual.reteIvaPct);
  let reteIcaPorMil = Number(f.reteIcaPorMil) || 0;
  if (manual.reteIcaPorMil !== undefined && manual.reteIcaPorMil !== null && manual.reteIcaPorMil !== '') reteIcaPorMil = Number(manual.reteIcaPorMil);
  const retefuente = Math.round(subtotal * retefuentePct / 100);
  const reteIva = Math.round(iva * reteIvaPct / 100);
  const reteIca = Math.round(subtotal * reteIcaPorMil / 1000);
  const neto = total - retefuente - reteIva - reteIca;
  if (neto < 0) throw new ErrorHttp(400, 'Las retenciones superan el valor de la compra');
  return { lineas: ls, subtotal, iva, total, conceptoRetencion: conceptoEf, baseMinima: c.baseUvt * uvt,
    retefuentePct, retefuente, reteIvaPct, reteIva, reteIcaPorMil, reteIca, neto };
}

// Asiento de la causación: gasto/costo/activo por línea, IVA (descontable o mayor valor), retenciones y 2335 por el neto
export function lineasAsientoCompra(c, { ivaDescontable = false } = {}) {
  const lineas = c.lineas.map(l => [l.cuenta, l.base + (ivaDescontable ? 0 : l.iva)]);
  if (ivaDescontable) lineas.push(['240810', c.iva]);
  lineas.push(['2365', -c.retefuente], ['2367', -c.reteIva], ['2368', -c.reteIca], ['2335', -c.neto]);
  return lineas;
}

// Cuentas que se pueden usar en una compra: activos fijos y diferidos (15–19), anticipos (1330), inventarios (14),
// gastos (5), costos (6 y 7)
export const cuentaDeCompra = (c) => /^(1330|14\d{2}|1[5-9]\d{2}|[5-7]\d{3})\d{0,6}$/.test(String(c));

// ── Proveedores ─────────────────────────────────────────────────────────────
export async function guardarProveedor(empresaId, datos, id = null) {
  const nit = String(datos.nit || '').replace(/\D/g, '');
  if (!nit) throw new ErrorHttp(400, 'El NIT o la cédula es obligatorio');
  const otro = await ProveedorCont.findOne({ empresa: empresaId, nit, ...(id ? { _id: { $ne: id } } : {}) }).select('_id').lean();
  if (otro) throw new ErrorHttp(409, `Ya existe un proveedor con el documento ${nit}`);
  if (datos.cuentaGasto && !cuentaDeCompra(datos.cuentaGasto)) throw new ErrorHttp(400, 'La cuenta habitual debe ser de gasto, costo, activo o anticipo');
  if (!id) return ProveedorCont.create({ ...datos, nit, empresa: empresaId });
  const p = await ProveedorCont.findOneAndUpdate({ empresa: empresaId, _id: id }, { $set: { ...datos, nit } }, { new: true, runValidators: true });
  if (!p) throw new ErrorHttp(404, 'Proveedor no encontrado');
  return p;
}

// ── Compras (causación) ─────────────────────────────────────────────────────
export async function vistaPreviaCompra(empresaId, { proveedor, lineas, conceptoRetencion, manual = {} }) {
  const p = await ProveedorCont.findOne({ empresa: empresaId, _id: proveedor }).lean();
  if (!p) throw new ErrorHttp(400, 'Proveedor no encontrado');
  const param = await parametros(empresaId);
  return calcularCompra({ lineas, concepto: conceptoRetencion || p.conceptoRetencion, proveedor: p, param, manual });
}

export async function causarCompra(empresaId, d, usuario = null) {
  const p = await ProveedorCont.findOne({ empresa: empresaId, _id: d.proveedor }).lean();
  if (!p) throw new ErrorHttp(400, 'Proveedor no encontrado');
  const malas = (d.lineas || []).filter(l => !cuentaDeCompra(l.cuenta)).map(l => l.cuenta || '(vacía)');
  if (malas.length) throw new ErrorHttp(400, `Cuentas que no sirven para una compra: ${[...new Set(malas)].join(', ')}. Use gasto (5), costo (6/7), activo (15) o anticipo (1330).`);
  const param = await parametros(empresaId);
  let documento = String(d.documento || '').trim().toUpperCase();
  // Documento soporte (compras a quien no está obligado a facturar): la empresa lo numera con su consecutivo
  if (!documento && d.tipoDocumento === 'documento_soporte') documento = `${param.prefijoDocumentoSoporte || 'DS'}-${await siguiente(empresaId, 'documentoSoporte')}`;
  if (documento && await CompraCont.exists({ empresa: empresaId, proveedor: p._id, documento, estado: { $ne: 'ANULADA' } })) {
    throw new ErrorHttp(409, `La factura ${documento} de ${p.nombre} ya está causada`);
  }
  const cufe = String(d.cufe || '').trim().toLowerCase();
  if (cufe && await CompraCont.exists({ empresa: empresaId, cufe, estado: { $ne: 'ANULADA' } })) throw new ErrorHttp(409, 'Esa factura electrónica (CUFE) ya está causada');
  const c = calcularCompra({ lineas: d.lineas, concepto: d.conceptoRetencion || p.conceptoRetencion, proveedor: p, param, manual: d.manual || {} });
  const lineas = lineasAsientoCompra(c, param);
  await validarAsiento(empresaId, { fecha: d.fecha, lineas });
  const numero = `CC-${String(await siguiente(empresaId, 'compra')).padStart(4, '0')}`;
  const a = await postear(empresaId, { fecha: d.fecha, documento: numero, origen: 'CMP', terceroDoc: p.nit, tercero: p.nombre, usuario, lineas,
    concepto: `Compra ${numero} - ${p.nombre}${documento ? ` (fact. ${documento})` : ''}` });
  try {
    return await CompraCont.create({ empresa: empresaId, numero, fecha: d.fecha, vence: d.vence || null, proveedor: p._id, proveedorNit: p.nit, proveedorNombre: p.nombre,
      tipoDocumento: d.tipoDocumento || 'factura', documento, cufe, ...c, asiento: a.numero, observaciones: d.observaciones || '', xml: d.xml || '', usuario });
  } catch (e) {
    await Asiento.updateOne({ empresa: empresaId, _id: a._id }, { $set: { estado: 'ANULADO', concepto: `${a.concepto} (anulado: la compra no se pudo guardar)` } });
    throw e;
  }
}

export async function anularCompra(empresaId, numero) {
  const c = await CompraCont.findOne({ empresa: empresaId, numero });
  if (!c) throw new ErrorHttp(404, 'Compra no encontrada');
  if (c.estado === 'ANULADA') throw new ErrorHttp(409, 'La compra ya estaba anulada');
  if (c.pagado > 0) throw new ErrorHttp(409, 'La compra ya tiene pagos: anule primero el comprobante de egreso');
  if (c.asiento) await anularAsiento(empresaId, c.asiento, { desdeDocumento: true });
  c.estado = 'ANULADA'; await c.save();
  return c;
}

export async function cuentasPorPagarProveedores(empresaId) {
  return (await CompraCont.find({ empresa: empresaId, estado: 'PENDIENTE' }).sort({ fecha: 1 }).lean())
    .map(c => ({ numero: c.numero, fecha: c.fecha, vence: c.vence, proveedor: c.proveedorNombre, nit: c.proveedorNit, documento: c.documento,
      neto: c.neto, pagado: c.pagado || 0, saldo: c.neto - (c.pagado || 0) }));
}

// ── Lectura del XML de la factura electrónica (UBL 2.1 DIAN) ────────────────
// Acepta la factura (Invoice), la nota crédito (CreditNote) o el AttachedDocument que la envuelve.
// Lectura por texto, sin librerías: solo trae los datos que se necesitan para causar.
const quitarNs = (n) => `(?:[\\w-]+:)?${n}`;
// Seguridad: el XML lo sube un usuario, así que se lee en tiempo lineal (sin expresiones que puedan quedarse
// recorriendo el archivo una y otra vez con un XML armado a propósito: ReDoS). Cada etiqueta se busca una sola vez.
// Devuelve [inicio del contenido, fin del contenido, fin del bloque] de cada bloque completo <n ...>…</n>.
function rangos(xml, n) {
  const abre = new RegExp(`<${quitarNs(n)}(?:\\s[^>]{0,2000})?>`, 'g');
  const cierra = new RegExp(`</${quitarNs(n)}>`, 'g');
  const out = []; let m;
  while ((m = abre.exec(xml))) {
    const ini = m.index; cierra.lastIndex = abre.lastIndex;
    const c = cierra.exec(xml);
    if (!c) break;                                   // sin cierre: no quedan bloques completos
    out.push([ini, abre.lastIndex, c.index, cierra.lastIndex]);
    abre.lastIndex = cierra.lastIndex;
  }
  return out;
}
const bloques = (xml, n) => rangos(xml, n).map(([, a, b]) => xml.slice(a, b));
// Quita los bloques <n>…</n> (líneas, firma, extensiones) sin expresiones regulares sobre todo el documento
function quitarBloques(xml, n) {
  let out = ''; let desde = 0;
  for (const [ini, , , fin] of rangos(xml, n)) { out += xml.slice(desde, ini); desde = fin; }
  return out + xml.slice(desde);
}
// Contenido de las secciones CDATA (o el texto tal cual si no tiene)
function cdatas(xml) {
  const out = []; let i = 0;
  for (;;) {
    const a = xml.indexOf('<![CDATA[', i); if (a < 0) break;
    const b = xml.indexOf(']]>', a + 9); if (b < 0) break;
    out.push(xml.slice(a + 9, b)); i = b + 3;
  }
  return out;
}
const sinCdata = (t) => { const c = cdatas(t); return c.length ? c.join('') : t; };
const bloque = (xml, n) => bloques(xml, n)[0] || '';
const texto = (xml, n) => desescapar(sinCdata(bloque(xml, n)).replace(/<[^>]{0,2000}>/g, '').trim());
const atributo = (xml, n, a) => (new RegExp(`<${quitarNs(n)}\\s[^>]{0,500}?\\b${a}="([^"]{0,200})"`).exec(xml) || [])[1] || '';
const numero = (v) => { const x = Number(String(v || '').trim()); return Number.isFinite(x) ? x : 0; };
function desescapar(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

// Lectores de XML UBL en tiempo lineal, compartidos con el envío de la factura electrónica al RNDC (fase 5)
export const xmlUbl = { bloques, bloque, texto, atributo, cdatas, desescapar, quitarBloques };

export function leerFacturaXml(xml) {
  let doc = String(xml || '');
  if (!doc.trim().startsWith('<')) throw new ErrorHttp(400, 'El archivo no es un XML');
  // AttachedDocument: la factura viene dentro de un CDATA (o escapada) en cbc:Description
  if (/<(?:\w+:)?AttachedDocument[\s>]/.test(doc)) {
    const candidatos = cdatas(doc);
    for (const d of bloques(doc, 'Description')) candidatos.push(desescapar(d));
    const interno = candidatos.find(t => /<(?:\w+:)?(Invoice|CreditNote|DebitNote)[\s>]/.test(t));
    if (!interno) throw new ErrorHttp(400, 'El AttachedDocument no trae la factura adentro');
    doc = interno;
  }
  const tipoM = /<(?:\w+:)?(Invoice|CreditNote|DebitNote)[\s>]/.exec(doc);
  if (!tipoM) throw new ErrorHttp(400, 'No se encontró una factura electrónica (Invoice) en el XML');
  doc = quitarBloques(quitarBloques(doc, 'UBLExtensions'), 'Signature');
  const tipo = { Invoice: 'factura', CreditNote: 'nota_credito', DebitNote: 'nota_debito' }[tipoM[1]];
  const lineaTag = { Invoice: 'InvoiceLine', CreditNote: 'CreditNoteLine', DebitNote: 'DebitNoteLine' }[tipoM[1]];
  const lineasXml = bloques(doc, lineaTag);
  const cabecera = quitarBloques(doc, lineaTag);
  const parte = (n) => { const b = bloque(cabecera, n); return { nit: texto(b, 'CompanyID').replace(/\D/g, ''), dv: atributo(b, 'CompanyID', 'schemeID'),
    nombre: texto(b, 'RegistrationName') || texto(b, 'Name'), correo: texto(b, 'ElectronicMail'), telefono: texto(b, 'Telephone'),
    responsabilidades: texto(b, 'TaxLevelCode'), ciudad: texto(bloque(b, 'PhysicalLocation') || b, 'CityName'), direccion: texto(bloque(b, 'AddressLine') || '', 'Line') }; };
  const prov = parte('AccountingSupplierParty');
  const cliente = parte('AccountingCustomerParty');
  // IVA de la cabecera (esquema 01); los demás impuestos (INC 04, ICA 03…) se suman como mayor valor
  let iva = 0; let otros = 0;
  for (const t of bloques(cabecera, 'TaxTotal')) {
    for (const st of bloques(t, 'TaxSubtotal')) {
      const id = texto(bloque(st, 'TaxScheme'), 'ID'); const v = numero(texto(st, 'TaxAmount'));
      if (id === '01') iva += v; else otros += v;
    }
  }
  const lm = bloque(cabecera, 'LegalMonetaryTotal');
  const lineas = lineasXml.map(l => {
    const base = numero(texto(l, 'LineExtensionAmount'));
    const st = bloques(bloque(l, 'TaxTotal'), 'TaxSubtotal').find(x => texto(bloque(x, 'TaxScheme'), 'ID') === '01');
    return { descripcion: texto(bloque(l, 'Item'), 'Description') || texto(bloque(l, 'Item'), 'Name'), cantidad: numero(texto(l, 'InvoicedQuantity') || texto(l, 'CreditedQuantity')),
      base: Math.round(base), ivaPct: st ? numero(texto(st, 'Percent')) : 0 };
  });
  const r = prov.responsabilidades.split(';').map(x => x.trim());
  return {
    tipo, numero: texto(cabecera, 'ID'), cufe: texto(cabecera, 'UUID').toLowerCase(), fecha: texto(cabecera, 'IssueDate'),
    vence: texto(cabecera, 'DueDate') || texto(bloque(cabecera, 'PaymentMeans'), 'PaymentDueDate'),
    moneda: texto(cabecera, 'DocumentCurrencyCode') || 'COP',
    proveedor: { nit: prov.nit, dv: prov.dv, nombre: prov.nombre, correo: prov.correo.toLowerCase(), telefono: prov.telefono, ciudad: prov.ciudad, direccion: prov.direccion,
      fiscal: { granContribuyente: r.includes('O-13'), autorretenedor: r.includes('O-15'), regimen: r.includes('O-47') ? 'simple' : 'ordinario', responsableIva: iva > 0 } },
    cliente: { nit: cliente.nit, nombre: cliente.nombre },
    subtotal: Math.round(numero(texto(lm, 'LineExtensionAmount'))), iva: Math.round(iva), otrosImpuestos: Math.round(otros),
    total: Math.round(numero(texto(lm, 'PayableAmount')) || numero(texto(lm, 'TaxInclusiveAmount'))),
    lineas,
  };
}

// Agrupa las líneas del XML por tarifa de IVA para causarlas (la contadora escoge la cuenta de cada grupo)
export function lineasParaCausar(f, cuenta = '5195') {
  const g = new Map();
  for (const l of f.lineas.length ? f.lineas : [{ descripcion: `Factura ${f.numero}`, base: f.subtotal, ivaPct: f.subtotal ? Math.round(f.iva * 100 / f.subtotal) : 0 }]) {
    const x = g.get(l.ivaPct) || { cuenta, descripcion: [], base: 0, ivaPct: l.ivaPct };
    x.base += l.base; if (x.descripcion.length < 4 && l.descripcion) x.descripcion.push(l.descripcion);
    g.set(l.ivaPct, x);
  }
  const ls = [...g.values()].map(x => ({ ...x, descripcion: x.descripcion.join('; ').slice(0, 200) }));
  // Otros impuestos (impuesto al consumo, bolsas…) como mayor valor, para que el total cuadre con la factura
  if (f.otrosImpuestos) ls.push({ cuenta, descripcion: 'Otros impuestos de la factura', base: f.otrosImpuestos, ivaPct: 0 });
  return ls;
}

export async function leerXmlEmpresa(empresaId, empresa, xml) {
  const f = leerFacturaXml(xml);
  if (!f.proveedor.nit) throw new ErrorHttp(400, 'El XML no trae el NIT del proveedor');
  const proveedor = await ProveedorCont.findOne({ empresa: empresaId, nit: f.proveedor.nit }).lean();
  const avisos = [];
  if (f.cliente.nit && empresa?.nit && f.cliente.nit !== String(empresa.nit).replace(/\D/g, '')) avisos.push(`La factura está a nombre de ${f.cliente.nombre || f.cliente.nit}, no de esta empresa`);
  if (f.tipo !== 'factura') avisos.push('El XML es una nota (crédito o débito), no una factura: revise antes de causar');
  if (f.cufe && await CompraCont.exists({ empresa: empresaId, cufe: f.cufe, estado: { $ne: 'ANULADA' } })) avisos.push('Esta factura ya está causada');
  if (f.moneda !== 'COP') avisos.push(`La factura está en ${f.moneda}`);
  return { factura: f, proveedor, lineas: lineasParaCausar(f, proveedor?.cuentaGasto || '5195'), avisos };
}

// ── Comprobantes de egreso ──────────────────────────────────────────────────
// Paga una o varias compras pendientes de un proveedor (y otros conceptos, como anticipos).
// Asiento: 2335 por lo pagado de compras · cuentas de «otros» · GMF 4x1000 (530505) si sale de bancos · crédito a 1110/1105
export async function crearEgreso(empresaId, d, usuario = null) {
  const p = d.proveedor ? await ProveedorCont.findOne({ empresa: empresaId, _id: d.proveedor }).lean() : null;
  if (d.proveedor && !p) throw new ErrorHttp(400, 'Proveedor no encontrado');
  const pagos = (d.pagos || []).filter(x => $(x.valor) > 0);
  const otros = (d.otros || []).filter(x => $(x.valor) > 0);
  if (!pagos.length && !otros.length) throw new ErrorHttp(400, 'El egreso no tiene valores');
  if (pagos.length && !p) throw new ErrorHttp(400, 'Escoja el proveedor de las compras que se pagan');
  const compras = await CompraCont.find({ empresa: empresaId, numero: { $in: pagos.map(x => x.compra) } });
  const porNumero = new Map(compras.map(c => [c.numero, c]));
  for (const x of pagos) {
    const c = porNumero.get(x.compra);
    if (!c || c.estado !== 'PENDIENTE') throw new ErrorHttp(409, `La compra ${x.compra} no está pendiente de pago`);
    if (String(c.proveedor) !== String(p._id)) throw new ErrorHttp(409, `La compra ${x.compra} es de otro proveedor`);
    if ($(x.valor) > c.neto - c.pagado) throw new ErrorHttp(400, `El pago de ${x.compra} supera su saldo (${c.neto - c.pagado})`);
  }
  if (new Set(pagos.map(x => x.compra)).size !== pagos.length) throw new ErrorHttp(400, 'Una compra aparece dos veces en el egreso');
  const cuenta = d.cuenta === '1105' ? '1105' : '1110';
  const param = await parametros(empresaId);
  const totalCompras = pagos.reduce((a, x) => a + $(x.valor), 0);
  const total = totalCompras + otros.reduce((a, x) => a + $(x.valor), 0);
  const gmf = cuenta === '1110' && (d.gmf ?? param.gmf) ? Math.round(total * 4 / 1000) : 0;
  const lineas = [['2335', totalCompras], ...otros.map(x => [String(x.cuenta), $(x.valor)]), ['530505', gmf], [cuenta, -(total + gmf)]];
  await validarAsiento(empresaId, { fecha: d.fecha, lineas });
  const numero = `CE-${String(await siguiente(empresaId, 'egreso')).padStart(4, '0')}`;
  const beneficiario = p?.nombre || String(d.beneficiario || '').trim();
  const beneficiarioDoc = p?.nit || String(d.beneficiarioDoc || '').replace(/\D/g, '');
  if (!beneficiario) throw new ErrorHttp(400, 'Indique a quién se le paga');
  const a = await postear(empresaId, { fecha: d.fecha, documento: numero, origen: 'EGR', terceroDoc: beneficiarioDoc, tercero: beneficiario, usuario, lineas,
    concepto: `Egreso ${numero} - ${beneficiario}${d.concepto ? ` - ${d.concepto}` : ''}` });
  let e;
  try {
    e = await EgresoCont.create({ empresa: empresaId, numero, fecha: d.fecha, proveedor: p?._id || null, beneficiarioDoc, beneficiario, cuenta,
      medio: d.medio || 'transferencia', referencia: d.referencia || '', concepto: d.concepto || '',
      pagos: pagos.map(x => ({ compra: x.compra, documento: porNumero.get(x.compra).documento, valor: $(x.valor) })),
      otros: otros.map(x => ({ cuenta: String(x.cuenta), descripcion: x.descripcion || '', valor: $(x.valor) })), total, gmf, asiento: a.numero, usuario });
  } catch (err) {
    await Asiento.updateOne({ empresa: empresaId, _id: a._id }, { $set: { estado: 'ANULADO', concepto: `${a.concepto} (anulado: el egreso no se pudo guardar)` } });
    throw err;
  }
  for (const x of pagos) {
    const c = porNumero.get(x.compra);
    c.pagado += $(x.valor); if (c.neto - c.pagado <= 0) c.estado = 'PAGADA';
    await c.save();
  }
  return e;
}

export async function anularEgreso(empresaId, numero) {
  const e = await EgresoCont.findOne({ empresa: empresaId, numero });
  if (!e) throw new ErrorHttp(404, 'Comprobante de egreso no encontrado');
  if (e.estado === 'ANULADO') throw new ErrorHttp(409, 'El egreso ya estaba anulado');
  await asegurarMesAbierto(empresaId, e.fecha);
  if (e.asiento) await anularAsiento(empresaId, e.asiento, { desdeDocumento: true });
  for (const x of e.pagos) {
    const c = await CompraCont.findOne({ empresa: empresaId, numero: x.compra });
    if (c && c.estado !== 'ANULADA') { c.pagado = Math.max(0, c.pagado - x.valor); c.estado = c.neto - c.pagado > 0 ? 'PENDIENTE' : 'PAGADA'; await c.save(); }
  }
  e.estado = 'ANULADO'; await e.save();
  return e;
}

// Valor en letras para el comprobante (pesos colombianos)
const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function menorMil(n) {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100), r = n % 100;
  const resto = r < 30 ? UNIDADES[r] : `${DECENAS[Math.floor(r / 10)]}${r % 10 ? ` Y ${UNIDADES[r % 10]}` : ''}`;
  return [CENTENAS[c], resto].filter(Boolean).join(' ');
}
export function enLetras(valor) {
  let n = Math.round(Math.abs(Number(valor) || 0));
  if (!n) return 'CERO PESOS M/CTE';
  const partes = [];
  const millones = Math.floor(n / 1e6); n %= 1e6;
  const miles = Math.floor(n / 1000); const unidades = n % 1000;
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${millones < 1000 ? menorMil(millones) : enLetras(millones).replace(/ (DE )?PESOS M\/CTE$/, '')} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${menorMil(miles)} MIL`);
  if (unidades) partes.push(menorMil(unidades));
  const t = partes.join(' ');
  if (t === 'UN') return 'UN PESO M/CTE';
  return `${t}${!miles && !unidades && millones ? ' DE' : ''} PESOS M/CTE`;
}

export async function egresoPdf(empresa, empresaId, numero) {
  const e = await EgresoCont.findOne({ empresa: empresaId, numero }).lean();
  if (!e) throw new ErrorHttp(404, 'Comprobante de egreso no encontrado');
  const a = e.asiento ? await Asiento.findOne({ empresa: empresaId, numero: e.asiento }).lean() : null;
  const doc = nuevoPdf(`Comprobante de egreso ${e.numero}`, 'portrait');
  encabezadoPdf(doc, { empresa, titulo: `COMPROBANTE DE EGRESO ${e.numero}${e.estado === 'ANULADO' ? ' (ANULADO)' : ''}`, subtitulo: `Fecha: ${fmtFecha(e.fecha)}` });
  doc.font('Helvetica').fontSize(10).fillColor('black');
  doc.text(`Pagado a: ${e.beneficiario}${e.beneficiarioDoc ? `  ·  NIT / C.C. ${e.beneficiarioDoc}` : ''}`);
  doc.text(`Valor: $ ${(e.total).toLocaleString('es-CO')}${e.gmf ? `   (GMF 4x1000: $ ${e.gmf.toLocaleString('es-CO')})` : ''}`);
  doc.font('Helvetica-Bold').text(`Son: ${enLetras(e.total)}`);
  doc.font('Helvetica').text(`Forma de pago: ${e.cuenta === '1105' ? 'Caja (efectivo)' : `Bancos · ${e.medio}`}${e.referencia ? `  ·  Ref. ${e.referencia}` : ''}`);
  if (e.concepto) doc.text(`Concepto: ${e.concepto}`);
  doc.moveDown(0.6);
  const detalle = [...e.pagos.map(x => [x.compra, x.documento ? `Factura ${x.documento}` : 'Compra', `$ ${x.valor.toLocaleString('es-CO')}`]),
    ...e.otros.map(x => [x.cuenta, x.descripcion || 'Otro concepto', `$ ${x.valor.toLocaleString('es-CO')}`])];
  tablaPdf(doc, [{ titulo: 'Documento', peso: 1 }, { titulo: 'Detalle', peso: 3 }, { titulo: 'Valor', peso: 1, alin: 'right' }], detalle,
    { total: ['', 'TOTAL', `$ ${e.total.toLocaleString('es-CO')}`] });
  if (a) {
    doc.font('Helvetica-Bold').fontSize(10).text(`Contabilización (asiento ${a.numero})`); doc.moveDown(0.3);
    tablaPdf(doc, [{ titulo: 'Cuenta', peso: 1 }, { titulo: 'Nombre', peso: 3 }, { titulo: 'Débito', peso: 1, alin: 'right' }, { titulo: 'Crédito', peso: 1, alin: 'right' }],
      a.lineas.map(l => [l.cuenta, l.nombre, l.debito ? `$ ${l.debito.toLocaleString('es-CO')}` : '', l.credito ? `$ ${l.credito.toLocaleString('es-CO')}` : '']));
  }
  doc.moveDown(2.5);
  const y = doc.y, w = (doc.page.width - 60) / 3;
  ['Elaboró', 'Aprobó', 'Recibí conforme (firma y C.C.)'].forEach((t, i) => {
    const x = 30 + i * w;
    doc.moveTo(x + 8, y).lineTo(x + w - 8, y).lineWidth(0.6).strokeColor('#333').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#333').text(t, x, y + 4, { width: w, align: 'center' });
  });
  numerarPaginas(doc);
  return pdfABuffer(doc);
}

// ── Conciliación bancaria ───────────────────────────────────────────────────
const oid = (v) => new mongoose.Types.ObjectId(String(v));
export const rangoMes = (mes) => {
  if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new ErrorHttp(400, 'Mes inválido (aaaa-mm)');
  const [a, m] = mes.split('-').map(Number);
  return { desde: new Date(Date.UTC(a, m - 1, 1)), hasta: new Date(Date.UTC(a, m, 0, 23, 59, 59, 999)) };
};

// Cruza movimientos del banco con los de libros: mismo valor (con signo) y fecha a no más de `dias` días;
// si hay varios candidatos, el de fecha más cercana. Regla pura.
export function cruzar(libros, banco, dias = 5) {
  const usados = new Set(); const cruzados = []; const bancoSinLibros = [];
  const ms = dias * 86400000;
  banco.forEach((b, i) => {
    let mejor = -1; let dist = Infinity;
    libros.forEach((l, j) => {
      if (usados.has(j) || $(l.valor) !== $(b.valor)) return;
      const d = Math.abs(new Date(l.fecha) - new Date(b.fecha));
      if (d <= ms && d < dist) { mejor = j; dist = d; }
    });
    if (mejor >= 0) { usados.add(mejor); cruzados.push({ banco: { ...b, i }, libro: libros[mejor] }); } else bancoSinLibros.push({ ...b, i });
  });
  const librosSinBanco = libros.filter((_, j) => !usados.has(j));
  return { cruzados, librosSinBanco, bancoSinLibros };
}

// Saldo ajustado: extracto + movimientos de libros que el banco aún no registra = libros + movimientos del banco
// que aún no están en libros. La diferencia debe ser cero.
export function resumenConciliacion({ saldoExtracto, saldoLibros, librosSinBanco, bancoSinLibros }) {
  const pendLibros = librosSinBanco.reduce((a, x) => a + $(x.valor), 0);
  const pendBanco = bancoSinLibros.reduce((a, x) => a + $(x.valor), 0);
  const extractoAjustado = $(saldoExtracto) + pendLibros;
  const librosAjustado = $(saldoLibros) + pendBanco;
  return { pendLibros, pendBanco, extractoAjustado, librosAjustado, diferencia: extractoAjustado - librosAjustado };
}

async function movimientosLibro(empresaId, cuenta, desde, hasta) {
  return Asiento.aggregate([{ $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $gte: desde, $lte: hasta } } }, { $unwind: '$lineas' },
    { $match: { 'lineas.cuenta': cuenta } }, { $sort: { fecha: 1, numero: 1 } },
    { $project: { _id: 0, numero: 1, fecha: 1, documento: 1, concepto: 1, tercero: 1, valor: { $subtract: ['$lineas.debito', '$lineas.credito'] } } }]);
}
async function saldoCuenta(empresaId, cuenta, hasta) {
  const [x] = await Asiento.aggregate([{ $match: { empresa: oid(empresaId), estado: 'ACTIVO', fecha: { $lte: hasta } } }, { $unwind: '$lineas' },
    { $match: { 'lineas.cuenta': cuenta } }, { $group: { _id: null, d: { $sum: '$lineas.debito' }, c: { $sum: '$lineas.credito' } } }]);
  return x ? x.d - x.c : 0;
}

export async function calcularConciliacion(empresaId, { cuenta = '1110', mes, saldoExtracto, extracto = [], dias = 5 }) {
  await asegurarPuc(empresaId);
  if (!await CuentaContable.exists({ empresa: empresaId, codigo: cuenta })) throw new ErrorHttp(400, `La cuenta ${cuenta} no existe`);
  const { desde, hasta } = rangoMes(mes);
  const libros = await movimientosLibro(empresaId, cuenta, desde, hasta);
  // Lo que quedó pendiente en la conciliación del mes anterior también puede aparecer en el extracto de este mes
  const [a, m] = mes.split('-').map(Number);
  const mesAnt = `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const anterior = await ConciliacionCont.findOne({ empresa: empresaId, cuenta, mes: mesAnt }).lean();
  const arrastre = (anterior?.librosSinBanco || []).map(x => ({ ...x, anterior: true }));
  const banco = extracto.map(x => ({ fecha: new Date(x.fecha), descripcion: String(x.descripcion || '').slice(0, 200), valor: $(x.valor) })).filter(x => x.valor && !Number.isNaN(+x.fecha));
  const r = cruzar([...arrastre, ...libros], banco, dias);
  const saldoLibros = await saldoCuenta(empresaId, cuenta, hasta);
  return { cuenta, mes, saldoExtracto: $(saldoExtracto), saldoLibros, movimientosLibro: libros.length, movimientosBanco: banco.length,
    ...r, ...resumenConciliacion({ saldoExtracto, saldoLibros, ...r }) };
}

export async function guardarConciliacion(empresaId, d, usuario = null) {
  const r = await calcularConciliacion(empresaId, d);
  const cerrar = !!d.cerrar;
  if (cerrar && r.diferencia !== 0) throw new ErrorHttp(409, `No se puede cerrar: la diferencia es ${r.diferencia}`);
  const previa = await ConciliacionCont.findOne({ empresa: empresaId, cuenta: r.cuenta, mes: r.mes }).select('estado').lean();
  if (previa?.estado === 'CERRADA') throw new ErrorHttp(409, 'La conciliación de ese mes ya está cerrada');
  const extracto = [...r.cruzados.map(x => ({ fecha: x.banco.fecha, descripcion: x.banco.descripcion, valor: x.banco.valor, asiento: x.libro.numero })),
    ...r.bancoSinLibros.map(x => ({ fecha: x.fecha, descripcion: x.descripcion, valor: x.valor, asiento: '' }))];
  const c = await ConciliacionCont.findOneAndUpdate({ empresa: empresaId, cuenta: r.cuenta, mes: r.mes },
    { $set: { saldoExtracto: r.saldoExtracto, saldoLibros: r.saldoLibros, diferencia: r.diferencia, extracto, librosSinBanco: r.librosSinBanco,
      bancoSinLibros: r.bancoSinLibros, estado: cerrar ? 'CERRADA' : 'BORRADOR', usuario } },
    { new: true, upsert: true });
  return { ...r, estado: c.estado };
}

