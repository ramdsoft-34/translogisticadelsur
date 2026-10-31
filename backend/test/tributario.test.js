// Pruebas de la contabilidad (Fase 3): DV del NIT, borrador 350, ICA, pago de impuestos, vencimientos, exógena,
// certificados de retención y relación de remesas. Las reglas puras corren sin base de datos; la API contra MongoDB local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_trib_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const T = await import('../src/services/gestion/tributario.js');

// ── Reglas puras ────────────────────────────────────────────────────────────
test('Dígito de verificación del NIT (DIAN)', () => {
  assert.equal(T.digitoVerificacion('890903938'), '8');
  assert.equal(T.digitoVerificacion('860034313'), '7');
  assert.equal(T.digitoVerificacion('900.222.333'), '5');
});

test('350: agrupa retenciones por concepto (declarante y no declarante juntos) y omite las compras sin retención', () => {
  const g = T.agruparRetenciones([{ conceptoRetencion: 'servicios', subtotal: 1000000, retefuente: 40000 }, { conceptoRetencion: 'servicios_no_declarante', subtotal: 500000, retefuente: 30000 },
    { conceptoRetencion: 'honorarios_pj', subtotal: 200000, retefuente: 22000 }, { conceptoRetencion: 'compras', subtotal: 100000, retefuente: 0 }]);
  assert.deepEqual(g.map(x => [x.concepto, x.base, x.retencion]), [['Servicios', 1500000, 70000], ['Honorarios', 200000, 22000]]);
});

test('ICA: impuesto por mil, avisos y tableros, sobretasa bomberil y descuento de lo retenido', () => {
  const r = T.calcularIca({ ingresos: 10000000, tarifaPorMil: 9.66, avisosTablerosPct: 15, sobretasaBomberilPct: 5, retencionesPracticadas: 20000 });
  assert.deepEqual([r.impuesto, r.avisos, r.bomberil, r.total, r.aPagar], [96600, 14490, 4830, 115920, 95920]);
  assert.equal(T.calcularIca({ ingresos: 100, tarifaPorMil: 10, retencionesPracticadas: 50 }).aPagar, 0, 'nunca negativo');
});

test('Vencimientos: pagado, vencido y próximo', () => {
  const v = T.estadoVencimientos([{ obligacion: 'retefuente', periodo: '2026-10', fecha: new Date('2026-11-10') }, { obligacion: 'ica', periodo: '2026-B5', fecha: new Date('2026-10-01') },
    { obligacion: 'renta', periodo: '2025', fecha: new Date('2026-05-12') }], new Set(['IMP-ICA-2026-B5']), new Date('2026-11-05'));
  assert.deepEqual(v.map(x => x.estado), ['VENCIDO', 'PAGADO', 'PRÓXIMO']);
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

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  const e = await M.Empresa.create({ nombre: 'Transportes Tributario', nit: '900222333', dv: '5' });
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Conta T', email: 'conta@trib.test', rol: 'contabilidad', empresa: e._id, passwordHash: hash }]);
  const r = await request(app).post('/api/auth/login').send({ email: 'conta@trib.test', password: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r.body)); s.conta = con(r.body.token);
  // Un proveedor de servicios con ReteICA y una compra en octubre
  const p = await s.conta.post('/api/gestion/contabilidad/proveedores', { nit: '900555444', nombre: 'Taller Diesel S.A.S.', conceptoRetencion: 'servicios', cuentaGasto: '5145',
    fiscal: { reteIcaPorMil: 9.66 } });
  assert.equal(p.status, 201, JSON.stringify(p.body)); s.proveedor = p.body._id;
  const c = await s.conta.post('/api/gestion/contabilidad/compras', { proveedor: s.proveedor, fecha: '2026-10-15', documento: 'TD-1', lineas: [{ cuenta: '5145', base: 2000000, ivaPct: 19 }] });
  assert.equal(c.status, 201, JSON.stringify(c.body)); s.compra = c.body;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('Borrador 350 del mes y pago con intereses: el pasivo 2365 queda en cero', async () => {
  const b = await s.conta.get('/api/gestion/tributario/350?mes=2026-10');
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(b.body.conceptos.map(x => [x.concepto, x.base, x.retencion]), [['Servicios', 2000000, 80000]]);
  assert.equal(b.body.totalAPagar, 80000);
  assert.equal(b.body.saldosContables['2365'], 80000);
  const pg = await s.conta.post('/api/gestion/tributario/pagos', { fecha: '2026-11-10', periodo: '2026-10', formulario: '3500000001', intereses: 1000,
    items: [{ tipo: 'retefuente', valor: 80000 }] });
  assert.equal(pg.status, 201, JSON.stringify(pg.body));
  assert.equal(pg.body.total, 81000);
  const b2 = (await s.conta.get('/api/gestion/tributario/350?mes=2026-10')).body;
  assert.equal(b2.pagos.length, 1);
  assert.equal(b2.saldosContables['2365'], 80000, 'el saldo al cierre de octubre no cambia con un pago de noviembre');
  const mayor = (await s.conta.get('/api/gestion/contabilidad/informes/mayor?desde=2026-01-01&hasta=2026-12-31&nivel=4')).body.datos;
  assert.equal(mayor.find(x => x.codigo === '2365').final, 0);
});

test('ReteICA practicado, calendario de vencimientos y tarifa de ICA', async () => {
  const ri = (await s.conta.get('/api/gestion/tributario/reteica?desde=2026-10-01&hasta=2026-10-31')).body;
  assert.equal(ri.total, 19320);
  const v = await s.conta.put('/api/gestion/tributario/vencimientos', { vencimientos: [{ obligacion: 'retefuente', periodo: '2026-10', fecha: '2026-11-10' },
    { obligacion: 'reteica', periodo: '2026-10', fecha: '2026-11-20' }] });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.find(x => x.obligacion === 'retefuente').pagado, true);
  assert.equal(v.body.find(x => x.obligacion === 'reteica').pagado, false);
  assert.equal((await s.conta.put('/api/gestion/tributario/ica/parametros', { icaTarifaPorMil: 9.66, avisosTablerosPct: 15, sobretasaBomberilPct: 0 })).status, 200);
  const ica = await s.conta.get('/api/gestion/tributario/ica?desde=2026-01-01&hasta=2026-12-31');
  assert.equal(ica.status, 200, JSON.stringify(ica.body)); assert.equal(ica.body.tarifaPorMil, 9.66);
});

test('Exógena 1001 y 1009, y certificado de retención en PDF', async () => {
  const f1001 = await s.conta.get('/api/gestion/tributario/exogena/1001?anio=2026');
  assert.equal(f1001.status, 200, JSON.stringify(f1001.body));
  const fila = f1001.body.filas.find(x => x[2] === '900555444');
  assert.equal(fila[0], '5004'); assert.equal(fila[3], T.digitoVerificacion('900555444'));
  assert.equal(fila[8], 2000000); assert.equal(fila[9], 380000); assert.equal(fila[10], 80000);
  const f1009 = (await s.conta.get('/api/gestion/tributario/exogena/1009?anio=2026')).body;
  assert.equal(f1009.filas.find(x => x[2] === '900555444')[5], s.compra.neto, 'saldo por pagar al proveedor');
  const xlsx = await s.conta.get('/api/gestion/tributario/exogena/1007?anio=2026&formato=xlsx');
  assert.equal(xlsx.status, 200);
  const lista = (await s.conta.get('/api/gestion/tributario/certificados?anio=2026')).body;
  assert.equal(lista[0].retefuente, 80000);
  const pdf = await s.conta.get('/api/gestion/tributario/certificados/900555444?anio=2026&tipo=fuente');
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal((await s.conta.get('/api/gestion/tributario/certificados/900555444?anio=2026&tipo=iva')).status, 404, 'no se le practicó ReteIVA');
});

test('Datos de la factura electrónica: el CUFE debe ser SHA-384', async () => {
  assert.equal((await s.conta.put('/api/gestion/tributario/facturas/FV-9999/fe', { numero: 'FE1', cufe: 'abc' })).status, 400);
  assert.equal((await s.conta.put('/api/gestion/tributario/facturas/FV-9999/fe', { numero: 'FE1', cufe: 'a'.repeat(96) })).status, 404);
});
