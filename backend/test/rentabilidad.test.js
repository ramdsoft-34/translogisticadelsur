// Pruebas de la contabilidad (Fase 6): rentabilidad por viaje, vehículo, cliente o ruta.
// Las reglas puras corren sin base de datos; la API contra MongoDB local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_rentab_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const R = await import('../src/services/gestion/rentabilidad.js');
const v = (numero, placa, cobrado, flete, cliente = 'c1', ruta = 'IPIALES → CALI') =>
  ({ numero, placa, cliente, clienteNombre: cliente.toUpperCase(), ruta, totalCobrado: cobrado, totalFlete: flete, totalAuxiliarPagado: 0 });

// ── Reglas puras ─────────────────────────────────────────────────────────────
test('Rentabilidad: los costos del vehículo se reparten entre sus viajes según lo cobrado, sin perder pesos', () => {
  const { viajes, sinViajes } = R.repartirCostos([v(1, 'AAA111', 300, 200), v(2, 'AAA111', 100, 50, 'c2'), v(3, 'BBB222', 500, 400)], { AAA111: 100, CCC333: 70 });
  assert.deepEqual(viajes.map(x => x.costosVehiculo), [75, 25, 0]);
  assert.deepEqual(sinViajes, [{ placa: 'CCC333', valor: 70 }]);
  const impar = R.repartirCostos([v(1, 'AAA111', 1, 0), v(2, 'AAA111', 1, 0), v(3, 'AAA111', 1, 0)], { AAA111: 100 }).viajes;
  assert.equal(impar.reduce((t, x) => t + x.costosVehiculo, 0), 100, 'el redondeo queda en el último viaje');
  assert.deepEqual(R.repartirCostos([v(1, 'AAA111', 0, 0), v(2, 'AAA111', 0, 0)], { AAA111: 10 }).viajes.map(x => x.costosVehiculo), [5, 5], 'sin cobro: partes iguales');
});

test('Rentabilidad: agrupación por vehículo, cliente, ruta y viaje con utilidad y margen', () => {
  const { viajes, sinViajes } = R.repartirCostos([v(1, 'AAA111', 300, 200), v(2, 'AAA111', 100, 50, 'c2', 'IPIALES → PASTO'), v(3, 'BBB222', 500, 400)], { AAA111: 100, CCC333: 70 });
  const p = R.agruparRentabilidad(viajes, sinViajes, 'placa');
  assert.deepEqual(p.filas.map(f => [f.clave, f.utilidad]), [['BBB222', 100], ['AAA111', 50], ['CCC333', -70]]);
  assert.equal(p.filas[1].margen, 12.5);
  assert.deepEqual([p.totales.ingreso, p.totales.utilidad, p.totales.margen], [900, 80, 8.9]);
  const c = R.agruparRentabilidad(viajes, sinViajes, 'cliente');
  assert.equal(c.totales.utilidad, 80, 'el total no cambia con la agrupación');
  assert.ok(c.filas.some(f => f.clave === '-' && f.costosVehiculo === 70), 'los costos de vehículos sin viajes van en una fila aparte');
  assert.deepEqual(R.agruparRentabilidad(viajes, [], 'ruta').filas.map(f => f.clave).sort(), ['IPIALES → CALI', 'IPIALES → PASTO']);
  assert.deepEqual(R.agruparRentabilidad(viajes, [], 'viaje').filas.map(f => f.clave), ['1', '2', '3']);
  assert.throws(() => R.agruparRentabilidad(viajes, [], 'otro'), /Agrupe/);
});

// ── API (necesita MongoDB) ───────────────────────────────────────────────────
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
});

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  const e = await M.Empresa.create({ nombre: 'Transportes Rentables', nit: '900444555', dv: '1' });
  const otra = await M.Empresa.create({ nombre: 'Otra empresa', nit: '900666777', dv: '2' });
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Admin R', email: 'admin@ren.test', rol: 'admin', empresa: e._id, passwordHash: hash },
    { nombre: 'Conta R', email: 'conta@ren.test', rol: 'contabilidad', empresa: e._id, passwordHash: hash },
    { nombre: 'Consulta R', email: 'consulta@ren.test', rol: 'consulta', empresa: e._id, passwordHash: hash },
    { nombre: 'Admin Otra', email: 'admin@otra.test', rol: 'admin', empresa: otra._id, passwordHash: hash }]);
  for (const [k, email] of [['admin', 'admin@ren.test'], ['conta', 'conta@ren.test'], ['consulta', 'consulta@ren.test'], ['otra', 'admin@otra.test']]) {
    const r = await request(app).post('/api/auth/login').send({ email, password: CLAVE });
    assert.equal(r.status, 200, JSON.stringify(r.body)); s[k] = con(r.body.token);
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('Rentabilidad: viajes, gasto cargado al vehículo y depreciación; Excel y PDF; aislada por empresa', async () => {
  const cli = await s.admin.post('/api/maestros/clientes', { nombre: 'Cliente Rentable', tipoId: 'N', nit: '890222333', siglas: 'CR' });
  assert.equal(cli.status, 201, JSON.stringify(cli.body));
  const t = await s.admin.post('/api/maestros/tarifas', { cliente: cli.body._id, destino: 'CALI', tarifaCliente: 1000000, fleteConductor: 800000 });
  const cond = await s.admin.post('/api/maestros/terceros', { tipoId: 'C', numId: '44556677', nombres: 'Ana', apellido1: 'Ruta', roles: ['conductor'],
    licencia: { categoria: 'C2', numero: '44556677', vence: '2035-01-01' }, placas: ['REN123'], placaPrincipal: 'REN123' });
  await s.admin.post('/api/maestros/vehiculos', { placa: 'REN123', pbv: 9000, soat: { numero: 'S1', vence: '2035-01-01' }, venceTecnomecanica: '2035-01-01' });
  for (const fecha of ['2026-10-10', '2026-10-20']) {
    const vj = await s.admin.post('/api/viajes', { fecha, cliente: cli.body._id, tarifaRef: t.body._id, destino: 'CALI', placa: 'REN123', conductor: cond.body._id });
    assert.equal(vj.status, 201, JSON.stringify(vj.body));
  }
  const g = await s.conta.post('/api/gestion/contabilidad/gastos', { fecha: '2026-10-15', cuenta: '5145', concepto: 'Cambio de llantas', valor: 150000, placa: 'ren123' });
  assert.equal(g.status, 201, JSON.stringify(g.body)); assert.equal(g.body.centroCosto, 'REN123');
  assert.equal((await s.conta.post('/api/gestion/contabilidad/gastos', { fecha: '2026-10-15', cuenta: '5145', concepto: 'Mala placa', valor: 1, placa: 'REN-123<' })).status, 400);
  const a = await s.conta.post('/api/gestion/activos', { nombre: 'Camión REN123', cuenta: '1540', placa: 'REN123', fechaCompra: '2026-01-10', costo: 60000000, vidaUtilMeses: 120 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal((await s.conta.post('/api/gestion/activos/depreciar', { mes: '2026-10' })).status, 200);

  const q = '/api/gestion/contabilidad/rentabilidad?desde=2026-10-01&hasta=2026-10-31';
  const r = await s.consulta.get(`${q}&agrupar=placa`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = r.body.filas.find(x => x.clave === 'REN123');
  assert.deepEqual([f.viajes, f.ingreso, f.flete, f.costosVehiculo], [2, 2000000, 1600000, 150000 + 500000]);
  assert.equal(f.utilidad, 2000000 - 1600000 - 650000);
  const porViaje = (await s.conta.get(`${q}&agrupar=viaje`)).body;
  assert.equal(porViaje.filas.reduce((t2, x) => t2 + x.costosVehiculo, 0), 650000, 'los costos se reparten completos entre los viajes');
  assert.equal(porViaje.totales.utilidad, r.body.totales.utilidad);
  assert.equal((await s.conta.get(`${q}&agrupar=ruta`)).body.filas.length, 1);
  const x = await s.conta.get(`${q}&agrupar=cliente&formato=xlsx`);
  assert.equal(x.status, 200); assert.match(x.headers['content-type'], /spreadsheetml/);
  const p = await s.conta.get(`${q}&formato=pdf`);
  assert.equal(p.status, 200); assert.equal(p.headers['content-type'], 'application/pdf');
  assert.equal((await s.conta.get('/api/gestion/contabilidad/rentabilidad?desde=2024-01-01&hasta=2026-10-31')).status, 400, 'rango de más de un año');
  assert.equal((await s.otra.get(q)).body.filas.length, 0, 'otra empresa no ve estos viajes');
});
