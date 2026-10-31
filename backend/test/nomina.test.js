// Pruebas de la contabilidad (Fase 4): nómina con aportes y provisiones, activos fijos y depreciación, cierre anual
// y notas crédito/débito. Las reglas puras corren sin base de datos; la API contra MongoDB local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_nomina_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const N = await import('../src/services/gestion/nomina.js');
const PAR = { smmlv: 1750905, auxilioTransporte: 249095, exoneradaAportes: true };
const emp = (x = {}) => ({ _id: 'e1', numId: '1', nombres: 'Ana', salario: 1750905, tipoSalario: 'ordinario', tipoContrato: 'indefinido', nivelRiesgoArl: 4, ...x });

// ── Reglas puras ────────────────────────────────────────────────────────────
test('Nómina de un salario mínimo: auxilio, deducciones, exoneración, ARL nivel IV y provisiones', () => {
  const c = N.calcularEmpleado(emp(), {}, PAR);
  assert.equal(c.auxilioTransporte, 249095);
  assert.equal(c.devengado, 2000000);
  assert.deepEqual([c.saludEmp, c.pensionEmp, c.fondoSolidaridad], [70036, 70036, 0]);
  assert.equal(c.neto, 2000000 - 140072);
  assert.deepEqual(c.aportes, { salud: 0, pension: 210109, arl: 76164, caja: 70036, icbf: 0, sena: 0 }, 'exonerada de salud, ICBF y SENA');
  assert.deepEqual(c.provisiones, { cesantias: 166600, intCesantias: 20000, prima: 166600, vacaciones: 73013 });
});

test('Nómina: días proporcionales, sin auxilio por encima de 2 SMMLV, integral al 70 % con tope de 25 SMMLV y fondo de solidaridad', () => {
  assert.equal(N.calcularEmpleado(emp(), { dias: 15 }, PAR).salario, 875453);
  assert.equal(N.calcularEmpleado(emp({ salario: 4000000 }), {}, PAR).auxilioTransporte, 0);
  const i = N.calcularEmpleado(emp({ salario: 20000000, tipoSalario: 'integral', nivelRiesgoArl: 1 }), {}, PAR);
  assert.equal(i.ibc, 14000000); assert.equal(i.provisiones.cesantias, 0); assert.ok(i.aportes.icbf > 0, 'más de 10 SMMLV no está exonerado');
  assert.equal(N.calcularEmpleado(emp({ salario: 80000000, tipoSalario: 'integral' }), {}, PAR).ibc, 25 * 1750905);
  assert.equal(N.fondoSolidaridadPct(5 * 1750905, 1750905), 1);
  assert.equal(N.fondoSolidaridadPct(17 * 1750905, 1750905), 1.4);
  assert.equal(N.fondoSolidaridadPct(21 * 1750905, 1750905), 2);
});

test('Asiento de nómina cuadra y los periodos quincenales tienen 15 días', () => {
  const t = N.totalesNomina([N.calcularEmpleado(emp(), { horasExtras: 120000, retencion: 0, otrasDeducciones: 50000 }, PAR), N.calcularEmpleado(emp({ _id: 'e2', numId: '2', salario: 3000000 }), {}, PAR)]);
  assert.equal(N.lineasAsientoNomina(t).reduce((a, l) => a + l[1], 0), 0);
  assert.equal(N.fechasPeriodo('2026-02-Q2').diasPeriodo, 15);
  assert.equal(N.fechasPeriodo('2026-02-Q2').hasta.getUTCDate(), 28);
  assert.throws(() => N.fechasPeriodo('2026-13'), /Periodo inválido/);
});

test('Depreciación en línea recta, cierre del año y notas proporcionales al asiento de la factura', () => {
  assert.equal(N.cuotaDepreciacion({ costo: 120000000, valorResidual: 0, vidaUtilMeses: 120, depreciacionAcumulada: 0, estado: 'ACTIVO' }), 1000000);
  assert.equal(N.cuotaDepreciacion({ costo: 1000, valorResidual: 0, vidaUtilMeses: 3, depreciacionAcumulada: 900, estado: 'ACTIVO' }), 100, 'la última cuota completa el costo');
  assert.equal(N.cuotaDepreciacion({ costo: 1000, valorResidual: 0, vidaUtilMeses: 3, depreciacionAcumulada: 1000, estado: 'ACTIVO' }), 0);
  const u = N.calcularCierre([{ _id: '4145', d: 0, c: 1000 }, { _id: '5105', d: 600, c: 0 }]);
  assert.deepEqual(u.lineas, [['4145', 1000], ['5105', -600], ['3605', -400]]); assert.equal(u.resultado, 400);
  assert.deepEqual(N.calcularCierre([{ _id: '4145', d: 0, c: 100 }, { _id: '5105', d: 600, c: 0 }]).lineas.at(-1), ['3610', 500]);
  const nc = N.lineasNota([{ cuenta: '1305', debito: 980, credito: 0 }, { cuenta: '1355', debito: 20, credito: 0 }, { cuenta: '4135', debito: 0, credito: 1000 }], 1000, 333, 'CREDITO');
  assert.equal(nc.reduce((a, l) => a + l[1], 0), 0); assert.deepEqual(nc.find(l => l[0] === '4135'), ['4135', 333]);
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
});
const asiento = async (numero) => (await s.conta.get('/api/gestion/contabilidad/asientos?desde=2025-01-01&hasta=2026-12-31')).body.find(a => a.numero === numero);

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  const e = await M.Empresa.create({ nombre: 'Transportes Nómina', nit: '900333444', dv: '1' });
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Admin N', email: 'admin@nom.test', rol: 'admin', empresa: e._id, passwordHash: hash },
    { nombre: 'Conta N', email: 'conta@nom.test', rol: 'contabilidad', empresa: e._id, passwordHash: hash },
    { nombre: 'Consulta N', email: 'consulta@nom.test', rol: 'consulta', empresa: e._id, passwordHash: hash }]);
  for (const [k, email] of [['admin', 'admin@nom.test'], ['conta', 'conta@nom.test'], ['consulta', 'consulta@nom.test']]) {
    const r = await request(app).post('/api/auth/login').send({ email, password: CLAVE });
    assert.equal(r.status, 200, JSON.stringify(r.body)); s[k] = con(r.body.token);
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('Protección de datos: el rol de consulta ve la contabilidad pero no salarios ni datos de empleados', async () => {
  assert.equal((await s.consulta.get('/api/gestion/contabilidad/resumen')).status, 200);
  for (const u of ['/api/gestion/nomina/empleados', '/api/gestion/nomina']) assert.equal((await s.consulta.get(u)).status, 403, u);
  assert.equal((await s.consulta.post('/api/gestion/nomina/calcular', { periodo: '2026-10' })).status, 403);
});

test('Empleado, nómina de octubre, pago neto y planilla PILA', async () => {
  const e = await s.conta.post('/api/gestion/nomina/empleados', { numId: '1010', nombres: 'Pedro', apellidos: 'Pérez', cargo: 'Conductor', salario: 1750905,
    fechaIngreso: '2026-01-15', nivelRiesgoArl: 4 });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const calc = await s.conta.post('/api/gestion/nomina/calcular', { periodo: '2026-10', novedades: { [e.body._id]: { horasExtras: 100000 } } });
  assert.equal(calc.status, 200, JSON.stringify(calc.body)); assert.equal(calc.body.lineas[0].extras, 100000);
  const n = await s.conta.post('/api/gestion/nomina', { periodo: '2026-10', novedades: { [e.body._id]: { horasExtras: 100000 } } });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  assert.equal((await s.conta.post('/api/gestion/nomina', { periodo: '2026-10' })).status, 409, 'no se liquida dos veces');
  const a = await asiento(n.body.asiento);
  assert.equal(a.lineas.reduce((t, l) => t + l.debito, 0), a.lineas.reduce((t, l) => t + l.credito, 0));
  assert.equal(a.lineas.find(l => l.cuenta === '2505').credito, n.body.totales.neto);
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/asientos/${n.body.asiento}/anular`, {})).status, 409, 'se anula desde la nómina');
  const p1 = await s.conta.post(`/api/gestion/nomina/${n.body.numero}/pagar`, { que: 'empleados', fecha: '2026-10-31' });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  const p2 = await s.conta.post(`/api/gestion/nomina/${n.body.numero}/pagar`, { que: 'aportes', fecha: '2026-11-05' });
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  assert.equal((await s.conta.get(`/api/gestion/nomina/${n.body.numero}`)).body.estado, 'PAGADA');
  assert.equal((await s.conta.post(`/api/gestion/nomina/${n.body.numero}/anular`, {})).status, 409, 'con pagos no se anula');
  const mayor = (await s.conta.get('/api/gestion/contabilidad/informes/mayor?desde=2026-01-01&hasta=2026-12-31&nivel=6')).body.datos;
  for (const c of ['2505', '237005', '237030', '237006', '237010']) assert.equal(mayor.find(x => x.codigo === c)?.final || 0, 0, `${c} queda en cero`);
  const pdf = await s.conta.get(`/api/gestion/nomina/${n.body.numero}/desprendible/1010`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal((await s.conta.get(`/api/gestion/nomina/${n.body.numero}/electronica?formato=xlsx`)).status, 200);
});

test('Activo fijo: compra, depreciación del mes (una sola vez) y venta con utilidad', async () => {
  const a = await s.conta.post('/api/gestion/activos', { nombre: 'Camión NHR', cuenta: '1540', placa: 'ABC123', fechaCompra: '2026-01-10', costo: 120000000, vidaUtilMeses: 120, cuentaPago: '1110' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const d = await s.conta.post('/api/gestion/activos/depreciar', { mes: '2026-10' });
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.equal(d.body.total, 1000000);
  assert.equal((await s.conta.post('/api/gestion/activos/depreciar', { mes: '2026-10' })).status, 409);
  const v = await s.conta.post(`/api/gestion/activos/${a.body.codigo}/baja`, { fecha: '2026-10-31', precio: 125000000 });
  assert.equal(v.status, 200, JSON.stringify(v.body)); assert.equal(v.body.resultado, 6000000);
  const as = await asiento(v.body.asiento);
  assert.equal(as.lineas.find(l => l.cuenta === '4245').credito, 6000000);
  assert.equal((await s.conta.get('/api/gestion/activos')).body[0].estado, 'VENDIDO');
});

test('Cierre del año: el estado de resultados del año no cambia y las cuentas de resultado quedan en cero', async () => {
  const antes = (await s.conta.get('/api/gestion/contabilidad/informes/resultados?desde=2026-01-01&hasta=2026-12-31')).body.datos;
  const c = await s.conta.post('/api/gestion/cierre-anual', { anio: 2026 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.resultado, antes.utilidad);
  assert.equal((await s.conta.post('/api/gestion/cierre-anual', { anio: 2026 })).status, 409);
  const despues = (await s.conta.get('/api/gestion/contabilidad/informes/resultados?desde=2026-01-01&hasta=2026-12-31')).body.datos;
  assert.equal(despues.utilidad, antes.utilidad, 'el cierre no afecta el estado de resultados');
  const mayor = (await s.conta.get('/api/gestion/contabilidad/informes/mayor?desde=2026-01-01&hasta=2026-12-31&nivel=1')).body.datos;
  for (const k of ['4', '5']) assert.equal(mayor.find(x => x.codigo === k)?.final || 0, 0, `clase ${k} en cero`);
  const b = (await s.conta.get('/api/gestion/contabilidad/informes/balance?hasta=2026-12-31')).body.datos;
  assert.equal(b.totalActivos, b.totalPasivos + b.totalPatrimonio + b.resultadoEjercicio);
  assert.equal((await s.conta.post('/api/gestion/cierre-anual/2026/anular', {})).status, 200);
});

test('Notas crédito y débito: ajustan el saldo de la factura y no dejan acreditar más del saldo', async () => {
  const cli = await s.admin.post('/api/maestros/clientes', { nombre: 'Cliente Notas', tipoId: 'N', nit: '890111222', siglas: 'CN' });
  assert.equal(cli.status, 201, JSON.stringify(cli.body));
  const t = await s.admin.post('/api/maestros/tarifas', { cliente: cli.body._id, destino: 'CALI', tarifaCliente: 1000000, fleteConductor: 800000 });
  const cond = await s.admin.post('/api/maestros/terceros', { tipoId: 'C', numId: '55667788', nombres: 'Luis', apellido1: 'Ruta', roles: ['conductor'],
    licencia: { categoria: 'C2', numero: '55667788', vence: '2035-01-01' }, placas: ['NOT123'], placaPrincipal: 'NOT123' });
  await s.admin.post('/api/maestros/vehiculos', { placa: 'NOT123', pbv: 9000, soat: { numero: 'S1', vence: '2035-01-01' }, venceTecnomecanica: '2035-01-01' });
  const v = await s.admin.post('/api/viajes', { fecha: '2026-10-20', cliente: cli.body._id, tarifaRef: t.body._id, destino: 'CALI', placa: 'NOT123', conductor: cond.body._id });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const f = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: cli.body._id, viajes: [v.body._id], retefuentePct: 1 });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  const nc = await s.conta.post(`/api/gestion/contabilidad/facturas/${f.body.numero}/notas`, { tipo: 'CREDITO', valor: 100000, motivo: 'Descuento por demora' });
  assert.equal(nc.status, 201, JSON.stringify(nc.body));
  assert.equal(nc.body.saldo, f.body.neto - 99000, 'el neto de la nota descuenta su retención proporcional');
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/facturas/${f.body.numero}/notas`, { tipo: 'CREDITO', valor: 5000000, motivo: 'Demasiado' })).status, 400);
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/facturas/${f.body.numero}/anular`, {})).status, 409, 'con notas no se anula la factura');
  const cxc = (await s.conta.get('/api/gestion/contabilidad/informes/cxc')).body.datos.find(x => x.numero === f.body.numero);
  assert.equal(cxc.saldo, nc.body.saldo);
  const an = await s.conta.post(`/api/gestion/contabilidad/facturas/${f.body.numero}/notas/${nc.body.nota}/anular`, {});
  assert.equal(an.status, 200, JSON.stringify(an.body)); assert.equal(an.body.saldo, f.body.neto);
});
