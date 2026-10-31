// Pruebas de la contabilidad (Fase 2): retenciones, lectura del XML de la DIAN, compras (causación),
// comprobantes de egreso y conciliación bancaria. Las reglas puras corren sin base de datos; la API contra MongoDB local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_compras_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const C = await import('../src/services/gestion/compras.js');

// Factura electrónica de ejemplo envuelta en un AttachedDocument, como llega por correo
const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><cbc:ID>NO-ES-EL-NUMERO</cbc:ID></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:CustomizationID>10</cbc:CustomizationID><cbc:ID>FE-1234</cbc:ID><cbc:UUID schemeName="CUFE-SHA384">ABC123def</cbc:UUID>
  <cbc:IssueDate>2026-10-10</cbc:IssueDate><cbc:DueDate>2026-11-09</cbc:DueDate><cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Llantas &amp; Repuestos S.A.S.</cbc:RegistrationName>
    <cbc:CompanyID schemeAgencyID="195" schemeID="7" schemeName="31">900555444</cbc:CompanyID><cbc:TaxLevelCode>O-13;O-15</cbc:TaxLevelCode></cac:PartyTaxScheme>
    <cac:Contact><cbc:ElectronicMail>Facturas@Llantas.co</cbc:ElectronicMail></cac:Contact></cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Transportes Compras</cbc:RegistrationName>
    <cbc:CompanyID schemeID="3" schemeName="31">900222333</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">1000000.00</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">1200000.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="COP">1000000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">1390000.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="COP">1390000.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="94">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">190000.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Description>Llanta 11R22.5</cbc:Description></cac:Item></cac:InvoiceLine>
  <cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="94">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">200000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Montaje (excluido)</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>`;
const ADJUNTO = `<?xml version="1.0" encoding="UTF-8"?><AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>AD-1</cbc:ID><cac:Attachment><cac:ExternalReference><cbc:MimeCode>text/xml</cbc:MimeCode><cbc:Description><![CDATA[${FACTURA}]]></cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;

// ── Reglas puras ────────────────────────────────────────────────────────────
test('XML DIAN: lee factura dentro del AttachedDocument (número, CUFE, proveedor, IVA y líneas)', () => {
  const f = C.leerFacturaXml(ADJUNTO);
  assert.equal(f.tipo, 'factura');
  assert.equal(f.numero, 'FE-1234', 'no toma el ID de las extensiones');
  assert.equal(f.cufe, 'abc123def');
  assert.equal(f.fecha, '2026-10-10'); assert.equal(f.vence, '2026-11-09');
  assert.equal(f.proveedor.nit, '900555444'); assert.equal(f.proveedor.dv, '7');
  assert.equal(f.proveedor.nombre, 'Llantas & Repuestos S.A.S.');
  assert.equal(f.proveedor.correo, 'facturas@llantas.co');
  assert.equal(f.proveedor.fiscal.granContribuyente, true); assert.equal(f.proveedor.fiscal.autorretenedor, true);
  assert.equal(f.cliente.nit, '900222333');
  assert.equal(f.subtotal, 1200000); assert.equal(f.iva, 190000); assert.equal(f.total, 1390000);
  assert.deepEqual(f.lineas.map(l => [l.base, l.ivaPct]), [[1000000, 19], [200000, 0]]);
  const ls = C.lineasParaCausar(f, '5145');
  assert.equal(ls.length, 2, 'una línea por tarifa de IVA');
  assert.equal(ls.reduce((a, l) => a + l.base, 0), 1200000);
});

test('XML DIAN: la factura sola también se lee, y un XML sin factura se rechaza', () => {
  assert.equal(C.leerFacturaXml(FACTURA).numero, 'FE-1234');
  assert.throws(() => C.leerFacturaXml('<Otro><a>1</a></Otro>'), /factura electrónica/);
  assert.throws(() => C.leerFacturaXml('hola'), /no es un XML/);
});

test('Seguridad: un XML armado para trabar el servidor (etiquetas sin cerrar) se lee en poco tiempo', () => {
  for (const x of ['<Invoice>' + '<cbc:Description>'.repeat(50000), '<AttachedDocument>' + '<![CDATA['.repeat(80000), '<Invoice>' + '<cac:InvoiceLine '.repeat(40000)]) {
    const t = Date.now();
    try { C.leerFacturaXml(x); } catch { /* se rechaza: lo que importa es que no se quede pegado */ }
    assert.ok(Date.now() - t < 3000, `tardó ${Date.now() - t} ms con ${x.length} caracteres`);
  }
});

test('Retenciones: base mínima en UVT, no declarante, autorretenedor, ReteIVA, ReteICA y cambios manuales', () => {
  const param = { uvt: 52374 };
  const servicio = (base, fiscal = {}, extra = {}) => C.calcularCompra({ lineas: [{ cuenta: '5145', base, ivaPct: 19 }], concepto: 'servicios', proveedor: { fiscal }, param: { ...param, ...extra.param }, manual: extra.manual });
  assert.equal(servicio(100000).retefuente, 0, 'debajo de 2 UVT no hay retención');
  assert.equal(servicio(1000000).retefuente, 40000, 'servicios 4 %');
  assert.equal(servicio(1000000, { declarante: false }).retefuente, 60000, 'no declarante 6 %');
  assert.equal(servicio(1000000, { autorretenedor: true }).retefuente, 0, 'al autorretenedor no se le retiene');
  assert.equal(servicio(1000000, {}, { param: { agenteReteIva: true, reteIvaPct: 15 } }).reteIva, 28500, 'ReteIVA 15 % del IVA');
  assert.equal(servicio(1000000, { granContribuyente: true }, { param: { agenteReteIva: true } }).reteIva, 0, 'al gran contribuyente no se le retiene IVA');
  assert.equal(servicio(1000000, { reteIcaPorMil: 9.66 }).reteIca, 9660);
  assert.equal(servicio(1000000, {}, { manual: { retefuentePct: 0 } }).retefuente, 0, 'la contadora puede quitarla');
  const c = servicio(1000000);
  assert.equal(c.neto, 1190000 - 40000);
  // Tabla cambiada en Parámetros
  assert.equal(C.calcularCompra({ lineas: [{ cuenta: '5145', base: 1000000 }], concepto: 'servicios', proveedor: {}, param: { uvt: 52374, retenciones: { servicios: { pct: 6, baseUvt: 4 } } } }).retefuente, 60000);
});

test('Asiento de compra: IVA como mayor valor (transporte excluido) o descontable, y siempre cuadra', () => {
  const c = C.calcularCompra({ lineas: [{ cuenta: '5145', base: 1000000, ivaPct: 19 }], concepto: 'servicios', proveedor: {}, param: { uvt: 52374 } });
  const suma = (ls) => ls.reduce((a, l) => a + l[1], 0);
  const mayor = C.lineasAsientoCompra(c, { ivaDescontable: false });
  assert.deepEqual(mayor.find(l => l[0] === '5145'), ['5145', 1190000]);
  assert.equal(suma(mayor), 0);
  const desc = C.lineasAsientoCompra(c, { ivaDescontable: true });
  assert.deepEqual(desc.find(l => l[0] === '240810'), ['240810', 190000]);
  assert.equal(suma(desc), 0);
  assert.ok(C.cuentaDeCompra('5145') && C.cuentaDeCompra('1540') && C.cuentaDeCompra('1330') && C.cuentaDeCompra('6155'));
  assert.ok(!C.cuentaDeCompra('1110') && !C.cuentaDeCompra('2335') && !C.cuentaDeCompra('4135'));
});

test('Conciliación: cruza por valor y fecha cercana, y la diferencia es cero cuando todo está explicado', () => {
  const libros = [{ numero: 'A1', fecha: '2026-10-02', valor: -500000 }, { numero: 'A2', fecha: '2026-10-03', valor: 2000000 }, { numero: 'A3', fecha: '2026-10-30', valor: -300000 }];
  const banco = [{ fecha: '2026-10-04', valor: -500000 }, { fecha: '2026-10-03', valor: 2000000 }, { fecha: '2026-10-31', valor: -12000 }];
  const r = C.cruzar(libros, banco, 5);
  assert.equal(r.cruzados.length, 2);
  assert.deepEqual(r.librosSinBanco.map(x => x.numero), ['A3'], 'pago de fin de mes que el banco aún no registra');
  assert.deepEqual(r.bancoSinLibros.map(x => x.valor), [-12000], 'gasto bancario sin registrar');
  // Libros: 1.200.000 (saldo); banco: 1.200.000 + 300.000 (aún no sale) − 12.000 (cobro del banco) = 1.488.000
  const res = C.resumenConciliacion({ saldoExtracto: 1488000, saldoLibros: 1200000, ...r });
  assert.equal(res.diferencia, 0);
  assert.equal(C.cruzar(libros, [{ fecha: '2026-10-20', valor: -500000 }], 5).cruzados.length, 0, 'fuera de los días no se cruza');
});

test('Valor en letras del comprobante de egreso', () => {
  assert.equal(C.enLetras(1150000), 'UN MILLÓN CIENTO CINCUENTA MIL PESOS M/CTE');
  assert.equal(C.enLetras(2000000), 'DOS MILLONES DE PESOS M/CTE');
  assert.equal(C.enLetras(21500), 'VEINTIÚN MIL QUINIENTOS PESOS M/CTE');
});

// ── API (necesita MongoDB) ──────────────────────────────────────────────────
const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');

const app = crearApp();
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;
const s = {};
const con = (token) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${token}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${token}`).send(b),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${token}`).send(b),
});
const asiento = async (numero) => (await s.conta.get('/api/gestion/contabilidad/asientos?desde=2026-01-01&hasta=2026-12-31')).body.find(a => a.numero === numero);
const linea = (a, c) => a.lineas.find(l => l.cuenta === c) || { debito: 0, credito: 0 };

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  const e = await M.Empresa.create({ nombre: 'Transportes Compras', nit: '900222333', dv: '3' });
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Conta P', email: 'conta@compras.test', rol: 'contabilidad', empresa: e._id, passwordHash: hash },
    { nombre: 'Consulta P', email: 'consulta@compras.test', rol: 'consulta', empresa: e._id, passwordHash: hash }]);
  for (const [k, email] of [['conta', 'conta@compras.test'], ['consulta', 'consulta@compras.test']]) {
    const r = await request(app).post('/api/auth/login').send({ email, password: CLAVE });
    assert.equal(r.status, 200, JSON.stringify(r.body)); s[k] = con(r.body.token);
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('Proveedor desde el XML y causación de la factura con retenciones', async () => {
  const lx = await s.conta.post('/api/gestion/contabilidad/compras/leer-xml', { xml: ADJUNTO });
  assert.equal(lx.status, 200, JSON.stringify(lx.body));
  assert.equal(lx.body.proveedor, null, 'el proveedor aún no existe');
  assert.deepEqual(lx.body.avisos, []);
  const f = lx.body.factura;
  const p = await s.conta.post('/api/gestion/contabilidad/proveedores', { nit: f.proveedor.nit, dv: f.proveedor.dv, nombre: f.proveedor.nombre, correo: f.proveedor.correo,
    fiscal: { ...f.proveedor.fiscal, autorretenedor: false, granContribuyente: false }, conceptoRetencion: 'compras', cuentaGasto: '5145' });
  assert.equal(p.status, 201, JSON.stringify(p.body)); s.proveedor = p.body._id;
  assert.equal((await s.consulta.post('/api/gestion/contabilidad/proveedores', { nit: '1', nombre: 'No' })).status, 403);
  const c = await s.conta.post('/api/gestion/contabilidad/compras', { proveedor: s.proveedor, fecha: f.fecha, vence: f.vence, documento: f.numero, cufe: f.cufe,
    lineas: lx.body.lineas.map(l => ({ ...l, cuenta: '5145' })), xml: ADJUNTO });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.total, 1390000);
  assert.equal(c.body.retefuente, 30000, 'compras 2,5 % sobre 1.200.000');
  assert.equal(c.body.neto, 1360000);
  assert.equal(c.body.xml, undefined, 'el XML no se devuelve');
  const a = await asiento(c.body.asiento);
  assert.equal(linea(a, '5145').debito, 1390000, 'IVA como mayor valor del gasto');
  assert.equal(linea(a, '2365').credito, 30000);
  assert.equal(linea(a, '2335').credito, 1360000);
  s.compra = c.body.numero;
  const otra = await s.conta.post('/api/gestion/contabilidad/compras', { proveedor: s.proveedor, fecha: f.fecha, documento: f.numero, lineas: [{ cuenta: '5145', base: 10 }] });
  assert.equal(otra.status, 409, 'la misma factura no se causa dos veces');
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/asientos/${c.body.asiento}/anular`, {})).status, 409, 'el asiento se anula desde la compra');
  assert.equal((await s.conta.post('/api/gestion/contabilidad/compras', { proveedor: s.proveedor, fecha: '2026-10-11', lineas: [{ cuenta: '1110', base: 1000 }] })).status, 400);
  const xml = await s.conta.get(`/api/gestion/contabilidad/compras/${s.compra}/xml`);
  assert.equal(xml.status, 200); assert.match(xml.text, /AttachedDocument/);
});

test('Comprobante de egreso: paga la compra, cobra el 4x1000, genera PDF y se puede anular', async () => {
  const e = await s.conta.post('/api/gestion/contabilidad/egresos', { fecha: '2026-10-20', proveedor: s.proveedor, cuenta: '1110', referencia: 'TRF-77',
    pagos: [{ compra: s.compra, valor: 1000000 }] });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.gmf, 4000);
  const a = await asiento(e.body.asiento);
  assert.equal(linea(a, '2335').debito, 1000000); assert.equal(linea(a, '530505').debito, 4000); assert.equal(linea(a, '1110').credito, 1004000);
  let compra = (await s.conta.get('/api/gestion/contabilidad/compras')).body.find(x => x.numero === s.compra);
  assert.equal(compra.pagado, 1000000); assert.equal(compra.estado, 'PENDIENTE');
  const pasa = await s.conta.post('/api/gestion/contabilidad/egresos', { fecha: '2026-10-20', proveedor: s.proveedor, pagos: [{ compra: s.compra, valor: 999999 }] });
  assert.equal(pasa.status, 400, 'no se paga más del saldo');
  const pdf = await s.conta.get(`/api/gestion/contabilidad/egresos/${e.body.numero}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/compras/${s.compra}/anular`, {})).status, 409, 'una compra con pagos no se anula');
  const an = await s.conta.post(`/api/gestion/contabilidad/egresos/${e.body.numero}/anular`, {});
  assert.equal(an.status, 200, JSON.stringify(an.body));
  compra = (await s.conta.get('/api/gestion/contabilidad/compras')).body.find(x => x.numero === s.compra);
  assert.equal(compra.pagado, 0, 'anular el egreso devuelve el saldo');
  const cxp = (await s.conta.get('/api/gestion/contabilidad/informes/cxpProv')).body.datos;
  assert.equal(cxp.find(x => x.numero === s.compra).saldo, 1360000);
  const res = (await s.conta.get('/api/gestion/contabilidad/resumen?desde=2026-10-01&hasta=2026-10-31')).body;
  assert.equal(res.porPagarProveedores, 1360000);
});

test('Egreso sin compra (anticipo) y conciliación bancaria del mes', async () => {
  const e = await s.conta.post('/api/gestion/contabilidad/egresos', { fecha: '2026-10-25', beneficiario: 'Taller El Paso', beneficiarioDoc: '12345678', cuenta: '1110', gmf: false,
    otros: [{ cuenta: '1330', descripcion: 'Anticipo reparación', valor: 200000 }] });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  // Libros de 1110 en octubre: −1.004.000 (egreso anulado no cuenta) → solo −200.000 del anticipo
  const calc = await s.conta.post('/api/gestion/contabilidad/conciliacion/calcular', { mes: '2026-10', saldoExtracto: -215000,
    extracto: [{ fecha: '2026-10-26', descripcion: 'TRANSF TALLER', valor: -200000 }, { fecha: '2026-10-31', descripcion: 'CUOTA MANEJO', valor: -15000 }] });
  assert.equal(calc.status, 200, JSON.stringify(calc.body));
  assert.equal(calc.body.saldoLibros, -200000);
  assert.equal(calc.body.cruzados.length, 1);
  assert.equal(calc.body.bancoSinLibros.length, 1);
  assert.equal(calc.body.diferencia, 0);
  const malo = await s.conta.post('/api/gestion/contabilidad/conciliaciones', { mes: '2026-10', saldoExtracto: -100000, cerrar: true, extracto: [] });
  assert.equal(malo.status, 409, 'no se cierra con diferencia');
  const ok = await s.conta.post('/api/gestion/contabilidad/conciliaciones', { mes: '2026-10', saldoExtracto: -215000, cerrar: true,
    extracto: [{ fecha: '2026-10-26', valor: -200000 }, { fecha: '2026-10-31', descripcion: 'CUOTA MANEJO', valor: -15000 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.estado, 'CERRADA');
  assert.equal((await s.conta.post('/api/gestion/contabilidad/conciliaciones', { mes: '2026-10', saldoExtracto: -215000, extracto: [] })).status, 409, 'cerrada no se cambia');
});
