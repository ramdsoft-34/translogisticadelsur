// Pruebas de la contabilidad (Fase 1): ingresos para terceros, facturar escogiendo viajes, anulación de cobros
// y pagos, libro mayor, auxiliares, saldos iniciales, parámetros y permisos contables. Contra MongoDB local.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_cont_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');
const { divisionTerceros, signoTipo, PUC_BASE } = await import('../src/services/gestion/contabilidad.js');
const { permisosDe, P } = await import('../src/config/permisos.js');

const app = crearApp();
const api = () => request(app);
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;
const s = {};
const con = (token) => ({
  get: (u) => api().get(u).set('Authorization', `Bearer ${token}`),
  post: (u, b) => api().post(u).set('Authorization', `Bearer ${token}`).send(b),
  put: (u, b) => api().put(u).set('Authorization', `Bearer ${token}`).send(b),
});
const login = async (email) => {
  const r = await api().post('/api/auth/login').send({ email, password: CLAVE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return con(r.body.token);
};
const cuadra = (a) => a.lineas.reduce((x, l) => x + l.debito, 0) === a.lineas.reduce((x, l) => x + l.credito, 0);
const linea = (a, cuenta) => a.lineas.find(l => l.cuenta === cuenta) || { debito: 0, credito: 0 };

// ── Reglas puras (no necesitan base de datos) ────────────────────────────────
test('Ingresos para terceros: lo del conductor va al pasivo y la diferencia es comisión', () => {
  assert.deepEqual(divisionTerceros({ totalCobrado: 600000, totalFlete: 460000, totalAuxiliarPagado: 30000 }),
    { cobro: 600000, terceros: 490000, flete: 460000, auxiliar: 30000, propio: 110000 });
  // Nunca se separa para terceros más de lo cobrado (comisión negativa no existe)
  assert.deepEqual(divisionTerceros({ totalCobrado: 400000, totalFlete: 460000, totalAuxiliarPagado: 30000 }),
    { cobro: 400000, terceros: 400000, flete: 400000, auxiliar: 0, propio: 0 });
});

test('Signo por tipo: las cuentas correctoras restan dentro de su grupo', () => {
  assert.equal(signoTipo('ACTIVO'), 1); assert.equal(signoTipo('GASTO'), 1); assert.equal(signoTipo('COSTO'), 1);
  assert.equal(signoTipo('PASIVO'), -1); assert.equal(signoTipo('PATRIMONIO'), -1); assert.equal(signoTipo('INGRESO'), -1);
});

test('Plan de cuentas base S.A.S. y permisos contables', () => {
  const codigos = new Set(PUC_BASE.map(c => c[0]));
  for (const c of ['2815', '281505', '281510', '4145', '3105', '3605', '3610', '3910', '2368', '530505']) assert.ok(codigos.has(c), `falta la cuenta ${c}`);
  assert.equal(codigos.size, PUC_BASE.length, 'sin códigos repetidos');
  assert.ok(permisosDe('contabilidad').includes(P.CONTABILIDAD_GESTIONAR));
  assert.ok(permisosDe('consulta').includes(P.CONTABILIDAD_VER));
  assert.ok(!permisosDe('consulta').includes(P.CONTABILIDAD_GESTIONAR));
  assert.ok(!permisosDe('reportero').includes(P.CONTABILIDAD_VER));
  assert.ok(permisosDe('admin').includes(P.CONTABILIDAD_GESTIONAR));
});

// ── API (necesita MongoDB) ───────────────────────────────────────────────────
before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  const e = await M.Empresa.create({ nombre: 'Transportes Contables', nit: '900111222', dv: '3' });
  s.empresa = e._id;
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Admin C', email: 'admin@cont.test', rol: 'admin', empresa: e._id, passwordHash: hash },
    { nombre: 'Conta C', email: 'conta@cont.test', rol: 'contabilidad', empresa: e._id, passwordHash: hash },
    { nombre: 'Consulta C', email: 'consulta@cont.test', rol: 'consulta', empresa: e._id, passwordHash: hash },
    { nombre: 'Reportero C', email: 'reportero@cont.test', rol: 'reportero', empresa: e._id, passwordHash: hash }]);
  s.admin = await login('admin@cont.test'); s.conta = await login('conta@cont.test');
  s.consulta = await login('consulta@cont.test'); s.reportero = await login('reportero@cont.test');
  // Maestros: cliente que cobra el auxiliar, tarifa con auxiliar, conductor y vehículo
  const cli = await s.admin.post('/api/maestros/clientes', { nombre: 'Cliente Terceros', tipoId: 'N', nit: '890123456', siglas: 'CT', politicaAuxiliar: 'registrado' });
  assert.equal(cli.status, 201, JSON.stringify(cli.body)); s.cliente = cli.body._id;
  const t = await s.admin.post('/api/maestros/tarifas', { cliente: s.cliente, destino: 'PASTO 3.0', tarifaCliente: 600000, tarifaAuxiliar: 45000, fleteConductor: 460000, auxiliarPagado: 30000 });
  assert.equal(t.status, 201, JSON.stringify(t.body)); s.tarifa = t.body._id;
  const cond = await s.admin.post('/api/maestros/terceros', { tipoId: 'C', numId: '11223344', nombres: 'Carlos', apellido1: 'Conductor', roles: ['conductor'],
    licencia: { categoria: 'C2', numero: '11223344', vence: '2035-01-01' }, placas: ['TER123'], placaPrincipal: 'TER123' });
  assert.equal(cond.status, 201, JSON.stringify(cond.body)); s.conductor = cond.body._id;
  const veh = await s.admin.post('/api/maestros/vehiculos', { placa: 'TER123', pbv: 9000, soat: { numero: 'S9', vence: '2035-01-01' }, venceTecnomecanica: '2035-01-01' });
  assert.equal(veh.status, 201, JSON.stringify(veh.body));
  s.viajes = [];
  for (const fecha of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    const v = await s.admin.post('/api/viajes', { fecha, cliente: s.cliente, tarifaRef: s.tarifa, destino: 'PASTO 3.0', placa: 'TER123', conductor: s.conductor, conAuxiliar: true });
    assert.equal(v.status, 201, JSON.stringify(v.body)); s.viajes.push(v.body._id);
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('Permisos: el reportero no ve la contabilidad; consulta ve pero no registra', async () => {
  assert.equal((await s.reportero.get('/api/gestion/contabilidad/resumen')).status, 403);
  assert.equal((await s.consulta.get('/api/gestion/contabilidad/resumen')).status, 200);
  assert.equal((await s.consulta.put('/api/gestion/contabilidad/parametros', { modeloIngresos: 'terceros' })).status, 403);
});

test('Parámetros: modelo de ingresos para terceros y plan de cuentas completo', async () => {
  assert.equal((await s.conta.get('/api/gestion/contabilidad/parametros')).body.modeloIngresos, 'bruto', 'por defecto se conserva el modelo anterior');
  const p = await s.conta.put('/api/gestion/contabilidad/parametros', { modeloIngresos: 'terceros', tipoSociedad: 'SAS' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.modeloIngresos, 'terceros');
  const cuentas = (await s.conta.get('/api/gestion/contabilidad/cuentas')).body.map(c => c.codigo);
  for (const c of ['281505', '281510', '4145', '3910']) assert.ok(cuentas.includes(c), `cuenta ${c}`);
});

test('Facturar escogiendo viajes con ingresos para terceros (2815 + comisión 4145)', async () => {
  const lista = await s.conta.get(`/api/gestion/contabilidad/facturas/viajes?cliente=${s.cliente}&desde=2026-10-01&hasta=2026-10-31`);
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  assert.equal(lista.body.filas.length, 3);
  const f0 = lista.body.filas[0];
  assert.equal(f0.cobro, 600000 + 45000);
  assert.equal(f0.terceros, 460000 + 30000);
  assert.equal(f0.propio, 645000 - 490000);
  // Se facturan solo dos de los tres viajes
  const f = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: s.cliente, viajes: s.viajes.slice(0, 2), retefuentePct: 1 });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  assert.equal(f.body.viajes, 2);
  assert.equal(f.body.total, 645000 * 2);
  assert.equal(f.body.modeloIngresos, 'terceros');
  assert.equal(f.body.terceros, 490000 * 2);
  assert.equal(f.body.propio, 155000 * 2);
  const a = (await s.conta.get('/api/gestion/contabilidad/asientos?desde=2026-01-01&hasta=2026-12-31')).body.find(x => x.numero === f.body.asiento);
  assert.ok(cuadra(a));
  assert.equal(linea(a, '281505').credito, 920000);
  assert.equal(linea(a, '281510').credito, 60000);
  assert.equal(linea(a, '4145').credito, 310000);
  assert.equal(linea(a, '4135').credito, 0, 'en modelo terceros no hay ingreso bruto');
  s.factura = f.body.numero;
  // Los viajes facturados ya no aparecen ni se pueden volver a facturar
  const resto = await s.conta.get(`/api/gestion/contabilidad/facturas/viajes?cliente=${s.cliente}&desde=2026-10-01&hasta=2026-10-31`);
  assert.equal(resto.body.filas.length, 1);
  const otra = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: s.cliente, viajes: [s.viajes[0]], permitirCruce: true });
  assert.equal(otra.status, 409, 'un viaje ya facturado no se cobra dos veces');
});

test('Anular un cobro devuelve el saldo a la factura; los asientos de documentos no se anulan sueltos', async () => {
  const c = await s.conta.post('/api/gestion/contabilidad/cobros', { factura: s.factura, valor: 500000 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.factura.cobrado, 500000);
  const an = await s.conta.post(`/api/gestion/contabilidad/asientos/${c.body.asiento}/anular`, {});
  assert.equal(an.status, 200, JSON.stringify(an.body));
  const f = (await s.conta.get('/api/gestion/contabilidad/facturas')).body.find(x => x.numero === s.factura);
  assert.equal(f.cobrado, 0, 'el cobro anulado se devuelve');
  assert.equal(f.estado, 'PENDIENTE');
  const asientoFactura = await s.conta.post(`/api/gestion/contabilidad/asientos/${f.asiento}/anular`, {});
  assert.equal(asientoFactura.status, 409, 'el asiento de la factura se anula desde la factura');
});

test('Liquidación del conductor en modelo terceros cancela el pasivo 2815 en vez de llevar costo', async () => {
  const lq = await s.conta.post('/api/gestion/liq-conductores', { viajes: s.viajes.slice(0, 2), desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(lq.status, 201, JSON.stringify(lq.body));
  const L = lq.body.liquidacion;
  const a = (await s.conta.get('/api/gestion/contabilidad/asientos?desde=2026-01-01&hasta=2026-12-31')).body.find(x => x.documento === L.numero && x.origen === 'LIQ');
  assert.ok(a && cuadra(a));
  assert.equal(linea(a, '6155').debito, 0);
  assert.equal(linea(a, '281505').debito, L.flete);
  // Pago y anulación del pago: la liquidación vuelve a quedar por pagar
  const pg = await s.conta.post('/api/gestion/contabilidad/pagos', { liquidacion: L.numero, valor: 100000 });
  assert.equal(pg.status, 200, JSON.stringify(pg.body));
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/asientos/${pg.body.asiento}/anular`, {})).status, 200);
  const cxp = (await s.conta.get('/api/gestion/contabilidad/informes/cxp')).body.datos.find(x => x.numero === L.numero);
  assert.equal(cxp.pagado, 0);
});

test('Saldos iniciales por tercero y documento, libro mayor y auxiliar', async () => {
  const malo = await s.conta.post('/api/gestion/contabilidad/saldos-iniciales', { fecha: '2025-12-31', filas: [{ cuenta: '1110', debito: 100 }, { cuenta: '3105', credito: 90 }] });
  assert.equal(malo.status, 400, 'no cuadra');
  const si = await s.conta.post('/api/gestion/contabilidad/saldos-iniciales', { fecha: '2025-12-31', filas: [
    { cuenta: '1110', debito: 5000000 },
    { cuenta: '1305', terceroDoc: '890123456', tercero: 'Cliente Terceros', documento: 'FV-0900', debito: 2000000 },
    { cuenta: '2205', terceroDoc: '11223344', tercero: 'Carlos Conductor', documento: 'LIQ-0900', credito: 1000000 },
    { cuenta: '3105', credito: 6000000 }] });
  assert.equal(si.status, 201, JSON.stringify(si.body));
  assert.equal(si.body.asientos.length, 3, 'uno por tercero y documento');
  assert.equal((await s.conta.post('/api/gestion/contabilidad/saldos-iniciales', { fecha: '2025-12-31', filas: [{ cuenta: '1110', debito: 1 }, { cuenta: '3105', credito: 1 }] })).status, 409);
  // Libro mayor: saldo anterior de bancos, y la cuenta puente queda en cero
  const my = await s.conta.get('/api/gestion/contabilidad/informes/mayor?desde=2026-01-01&hasta=2026-12-31');
  assert.equal(my.status, 200, JSON.stringify(my.body));
  const bancos = my.body.datos.find(c => c.codigo === '1110');
  assert.equal(bancos.anterior, 5000000);
  const puente = my.body.datos.find(c => c.codigo === '3910');
  assert.equal(puente?.final || 0, 0, 'la cuenta puente queda en cero');
  assert.equal(my.body.datos.reduce((a, c) => a + c.debito, 0), my.body.datos.reduce((a, c) => a + c.credito, 0));
  // Auxiliar de 1305 por tercero
  const ax = await s.conta.get('/api/gestion/contabilidad/informes/auxiliar?cuenta=1305&desde=2026-01-01&hasta=2026-12-31');
  assert.equal(ax.status, 200, JSON.stringify(ax.body));
  assert.equal(ax.body.datos.anterior, 2000000);
  assert.ok(ax.body.datos.terceros.some(t => t.terceroDoc === '890123456'));
  const axT = await s.conta.get('/api/gestion/contabilidad/informes/auxiliar?cuenta=1305&tercero=890123456&desde=2026-01-01&hasta=2026-12-31');
  assert.equal(axT.body.datos.movimientos.every(x => x.terceroDoc === '890123456'), true);
  // Balance: activos = pasivos + patrimonio + resultado
  const b = (await s.conta.get('/api/gestion/contabilidad/informes/balance?hasta=2026-12-31')).body.datos;
  assert.equal(b.totalActivos, b.totalPasivos + b.totalPatrimonio + b.resultadoEjercicio);
});

test('Anular la factura libera los viajes', async () => {
  const an = await s.conta.post(`/api/gestion/contabilidad/facturas/${s.factura}/anular`, {});
  assert.equal(an.status, 200, JSON.stringify(an.body));
  const lista = await s.conta.get(`/api/gestion/contabilidad/facturas/viajes?cliente=${s.cliente}&desde=2026-10-01&hasta=2026-10-31`);
  assert.equal(lista.body.filas.length, 3);
});
