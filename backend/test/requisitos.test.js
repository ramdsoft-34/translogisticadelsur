// Pruebas de los requisitos del documento (RN, RF y casos de aceptación CA) contra MongoDB local.
// Los viajes son datos de ejemplo armados para reproducir los valores de cada caso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_req_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { PDFDocument } = await import('pdf-lib');
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');
const { lineaConductor } = await import('../src/services/gestion/liquidacionConductor.js');
const { lineaLiquidacion, respaldosAuxiliar } = await import('../src/services/calculos.js');
const { planCuotas, tasaQuincenal } = await import('../src/services/gestion/prestamos.js');
const { pesoPorTamano, REGLAS_BASE } = await import('../src/services/gestion/reglas.js');
const { codigoTotp, verificarTotp, base32 } = await import('../src/services/totp.js');
const { mensajesPorCliente } = await import('../src/services/whatsapp.js');
const { buzonPruebas } = await import('../src/services/correo.js');

const app = crearApp();
const api = () => request(app);
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;
const s = {};
const con = (token) => ({
  token,
  get: (u) => api().get(u).set('Authorization', `Bearer ${token}`),
  // Viajes de la misma placa el mismo día a propósito: se confirman (la pregunta tiene su prueba en integral.test.js)
  post: (u, b) => api().post(u).set('Authorization', `Bearer ${token}`)
    .send(u === '/api/viajes' && b && b.confirmarRepetido === undefined ? { ...b, confirmarRepetido: true } : b),
  put: (u, b) => api().put(u).set('Authorization', `Bearer ${token}`).send(b),
});
const login = async (email, extra = {}) => {
  const r = await api().post('/api/auth/login').send({ email, password: CLAVE, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const iso = (d) => d.toISOString().slice(0, 10);
// Lunes a domingo de la semana anterior (los viajes del caso CA-03 van en una semana)
const hoy = new Date(); const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7) - 7));
const dia = (n) => iso(new Date(lunes.getTime() + n * 86400000));
const binario = (r) => r.buffer(true).parse((res, cb) => { const p = []; res.on('data', c => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  const e = await M.Empresa.create({ nombre: 'Transportes Requisitos', nit: '900555666', dv: '1' });
  s.empresa = e._id;
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Admin R', email: 'admin@req.test', rol: 'admin', empresa: e._id, passwordHash: hash },
    { nombre: 'Reportero R', email: 'reportero@req.test', rol: 'reportero', empresa: e._id, passwordHash: hash },
    { nombre: 'Conta R', email: 'conta@req.test', rol: 'contabilidad', empresa: e._id, passwordHash: hash }]);
  s.admin = con((await login('admin@req.test')).token);
  s.reportero = con((await login('reportero@req.test')).token);
  s.conta = con((await login('conta@req.test')).token);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ── Reglas puras ─────────────────────────────────────────────────────────────
test('RN-05: anticipo ≥ flete en Pasto, Mayorista o Popayán cuenta como 0', () => {
  assert.equal(lineaConductor({ flete: 460000, anticipo: 460000, destino: 'PASTO 3.0' }).anticipoReconocido, 0);
  assert.equal(lineaConductor({ flete: 300000, anticipo: 350000, destino: 'Pasto Mayorista' }).anticipoReconocido, 0);
  assert.equal(lineaConductor({ flete: 300000, anticipo: 300000, destino: 'Popayan' }).anticipoReconocido, 0);
  // Otro destino o anticipo menor que el flete: se reconoce completo
  assert.equal(lineaConductor({ flete: 460000, anticipo: 460000, destino: 'Ipiales' }).anticipoReconocido, 460000);
  assert.equal(lineaConductor({ flete: 460000, anticipo: 100000, destino: 'Pasto' }).anticipoReconocido, 100000);
});

test('RN-06: neto = flete + auxiliar − anticipo reconocido − retefuente − FOPAT', () => {
  const l = lineaConductor({ flete: 1000000, auxiliar: 60000, anticipo: 200000, pbv: 12000, destino: 'Ipiales' });
  assert.deepEqual(l, { retefuente: 10000, fopat: 1000, anticipoReconocido: 200000, auxiliarPagado: false, saldo: 1000000 + 60000 - 200000 - 10000 - 1000 });
  // En Pasto no hay FOPAT aunque el PBV supere 10.500 kg
  assert.equal(lineaConductor({ flete: 1000000, pbv: 12000, destino: 'Pasto' }).fopat, 0);
});

test('RF-REG-05: peso según la capacidad escrita en el destino', () => {
  assert.equal(pesoPorTamano('IPIALES 1.0'), 800);
  assert.equal(pesoPorTamano('Tumaco 3.0'), 1500);
  assert.equal(pesoPorTamano('PASTO 5,0'), 2500);
  assert.equal(pesoPorTamano('Mocoa 6.0'), 5000);
  assert.equal(pesoPorTamano('Mocoa 16.0'), 0);
  assert.equal(pesoPorTamano('Pasto'), 0);
  assert.equal(REGLAS_BASE.diasAvisoDocumentos, 10);
});

test('RN-15 y RF-REG-07: política de auxiliar del cliente y tarifa de auxiliar de respaldo', () => {
  const cliente = 'c1';
  const tarifas = [{ _id: 't1', cliente, destino: 'Ipiales', tarifaCliente: 500000, fleteConductor: 400000, tarifaAuxiliar: 0, auxiliarPagado: 0, createdAt: new Date(2026, 0, 2) },
    { _id: 't2', cliente, destino: 'Pasto', tarifaCliente: 300000, fleteConductor: 250000, tarifaAuxiliar: 40000, auxiliarPagado: 30000, createdAt: new Date(2026, 0, 1) }];
  const respaldo = respaldosAuxiliar(tarifas).get(cliente);
  assert.equal(respaldo._id, 't2', 'la primera tarifa con auxiliar del cliente');
  const v = { conAuxiliar: true, diasAuxiliar: 2, anticipo: 0 };
  const con = (politica) => lineaLiquidacion(v, tarifas[0], { respaldo, cliente: { politicaAuxiliar: politica, valorAuxiliarSinAnticipo: 30000 } });
  assert.equal(con('registrado').totalAuxiliar, 80000);
  assert.equal(con('registrado').totalAuxiliarPagado, 60000);
  assert.equal(con('sin').totalAuxiliar, 0);
  assert.equal(con('incluido').totalCobrado, 500000);
  assert.equal(con('sin_anticipo').totalAuxiliar, 30000);
  assert.equal(lineaLiquidacion({ ...v, anticipo: 100000 }, tarifas[0], { respaldo, cliente: { politicaAuxiliar: 'sin_anticipo' } }).totalAuxiliar, 0);
  // El conductor recibe su auxiliar sin importar la política de cobro del cliente
  assert.equal(con('sin').totalAuxiliarPagado, 60000);
});

test('CA-04: préstamo de cuota fija quincenal', () => {
  const capital = 1200000; const tasa = 2.5; const n = 6;
  const plan = planCuotas(capital, tasa, n, new Date(Date.UTC(2026, 0, 15)));
  const r = tasaQuincenal(tasa);
  assert.equal(plan.valorCuota, Math.round(capital * r / (1 - (1 + r) ** -n)));
  assert.equal(plan.cuotas.reduce((a, c) => a + c.capital, 0), capital);
  assert.equal(plan.cuotas.at(-1).saldoCapital, 0);
  assert.deepEqual(plan.cuotas.slice(0, 3).map(c => iso(c.fecha)), ['2026-01-15', '2026-01-31', '2026-02-15']);
});

test('RNF-01: TOTP según el vector de prueba del RFC 6238', () => {
  const secreto = base32(Buffer.from('12345678901234567890'));
  assert.equal(secreto, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(codigoTotp(secreto, Math.floor(59 / 30)), '287082');
  assert.equal(codigoTotp(secreto, Math.floor(1111111109 / 30)), '081804');
  assert.equal(verificarTotp(secreto, '287082', { ahora: 59000 }), 1);
  assert.equal(verificarTotp(secreto, '287082', { ahora: 59000, ultimoPaso: 1 }), -1, 'un código no se usa dos veces');
});

test('RF-WA-03b: «Unificar aux.» solo en los viajes elegidos para unificar', () => {
  const base = { cliente: { _id: 'c1', nombre: 'Cliente' }, conductorNombre: 'Ana Ruiz', destino: 'Pasto', placa: 'AAA111', flete: 100000, anticipo: 100000, auxiliar: 50000, diasAuxiliar: 1 };
  const [m] = mensajesPorCliente([{ ...base, _id: 'v1' }, { ...base, _id: 'v2', placa: 'BBB222' }], new Date(), new Date(), undefined, { unificarIds: new Set(['v2']) });
  assert.match(m.texto, /Flete \$ 100\.000\. Anticipo \$ 100\.000\nPlaca AAA111/);
  assert.match(m.texto, /Flete \$ 150\.000\. Anticipo \$ 150\.000\nPlaca BBB222/);
  assert.equal((m.texto.match(/Unificado/g) || []).length, 1);
});

test('RF-WA-03: «Unificar auxiliar» suma el auxiliar al flete y al anticipo del reporte (solo en el mensaje)', () => {
  const v = { _id: 'v1', cliente: { _id: 'c', nombre: 'Corbeta' }, conductorNombre: 'Pedro Perez Gomez', destino: 'Ipiales', placa: 'SLF645', flete: 100000, anticipo: 100000, auxiliar: 50000, diasAuxiliar: 1 };
  const [aparte] = mensajesPorCliente([v], new Date(), new Date());
  assert.match(aparte.texto, /Flete \$ 100\.000\. Anticipo \$ 100\.000/);
  assert.match(aparte.texto, /Auxiliar \$ 50\.000/);
  const [unido] = mensajesPorCliente([v], new Date(), new Date(), undefined, { unificarAuxiliar: true });
  assert.match(unido.texto, /Flete \$ 150\.000\. Anticipo \$ 150\.000/);
  assert.match(unido.texto, /Auxiliar de 1 día Unificado/);
  assert.equal(unido.totalFlete, 150000); assert.equal(unido.totalAnticipo, 150000);
  assert.equal(v.flete, 100000, 'el viaje no cambia'); assert.equal(v.anticipo, 100000);
  // Sin anticipo, el anticipo sigue en cero
  assert.match(mensajesPorCliente([{ ...v, anticipo: 0, diasAuxiliar: 2 }], new Date(), new Date(), undefined, { unificarAuxiliar: true })[0].texto, /Anticipo \$ 0\nPlaca SLF645\nAuxiliar de 2 días Unificado/);
  // La licencia guardada con el viaje va después de la placa
  assert.match(mensajesPorCliente([{ ...v, licencia: 'C1-1085250528' }], new Date(), new Date())[0].texto, /Placa SLF645\nLicencia C1-1085250528\nAuxiliar/);
  // Sin auxiliar la línea no aparece
  assert.doesNotMatch(mensajesPorCliente([{ ...v, auxiliar: 0 }], new Date(), new Date())[0].texto, /Auxiliar/);
});

// ── Maestros ─────────────────────────────────────────────────────────────────
test('Maestros: siglas y política del cliente, peso automático, placas y edad del conductor', async () => {
  const cor = await s.admin.post('/api/maestros/clientes', { nombre: 'Corbeta', tipoId: 'N', nit: '890900943', siglas: 'cor', politicaAuxiliar: 'sin' });
  assert.equal(cor.status, 201, JSON.stringify(cor.body));
  assert.equal(cor.body.siglas, 'COR');
  s.corbeta = cor.body._id;
  const andina = await s.admin.post('/api/maestros/clientes', { nombre: 'Casa Andina', tipoId: 'N', nit: '900777888', siglas: 'CA', politicaAuxiliar: 'sin_anticipo' });
  s.andina = andina.body._id;
  const t1 = await s.admin.post('/api/maestros/tarifas', { cliente: s.corbeta, destino: 'PASTO 3.0', tarifaCliente: 600000, tarifaAuxiliar: 45000, fleteConductor: 460000, auxiliarPagado: 30000 });
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  assert.equal(t1.body.pesoKg, 1500, 'RF-REG-05');
  const t2 = await s.admin.post('/api/maestros/tarifas', { cliente: s.corbeta, destino: 'IPIALES 3.0', tarifaCliente: 1400000, fleteConductor: 1150000, pesoKg: 1800 });
  assert.equal(t2.body.pesoKg, 1800, 'el peso escrito se respeta');
  const t3 = await s.admin.post('/api/maestros/tarifas', { cliente: s.corbeta, destino: 'TUQUERRES', tarifaCliente: 1400000, fleteConductor: 1150000 });
  const t4 = await s.admin.post('/api/maestros/tarifas', { cliente: s.andina, destino: 'TUMACO', tarifaCliente: 900000, fleteConductor: 700000 });
  Object.assign(s, { tPasto: t1.body._id, tIpiales: t2.body._id, tTuquerres: t3.body._id, tTumaco: t4.body._id });

  const cond = await s.admin.post('/api/maestros/terceros', { tipoId: 'C', numId: '98765432', nombres: 'Wilson', apellido1: 'Montero', apellido2: 'Rivera',
    direccion: 'CALLE 5', codMunicipio: '52001000', roles: ['conductor'], fechaNacimiento: '1980-05-20', licencia: { categoria: 'C2', numero: '98765432', vence: '2035-01-01' }, placas: ['ABC123'], placaPrincipal: 'slf645' });
  assert.equal(cond.status, 201, JSON.stringify(cond.body));
  assert.deepEqual(cond.body.placas, ['SLF645', 'ABC123']);
  assert.equal(cond.body.placaPrincipal, 'SLF645');
  assert.equal(cond.body.edad, M.edad('1980-05-20'));
  assert.ok(cond.body.edad >= 46);
  s.conductor = cond.body._id;
  const sug = await s.admin.get(`/api/viajes/sugerencias/conductor/${s.conductor}`);
  assert.equal(sug.body.placa, 'SLF645', 'RF-CON-02: se propone la placa principal');
  const lista = await s.admin.get('/api/maestros/terceros?rol=conductor&conPlacas=1&q=wilson');
  assert.equal(lista.body[0].placas[0], 'SLF645');

  const veh = await s.admin.post('/api/maestros/vehiculos', { placa: 'SLF645', pesoVacio: 4000, pbv: 9000, soat: { numero: 'S1', vence: '2035-01-01' }, venceTecnomecanica: '2035-01-01' });
  assert.equal(veh.status, 201, JSON.stringify(veh.body));
  const vencido = await s.admin.post('/api/maestros/vehiculos', { placa: 'VEN001', pesoVacio: 4000, pbv: 9000, soat: { numero: 'S2', vence: '2020-01-01' }, venceTecnomecanica: '2035-01-01' });
  assert.equal(vencido.status, 201);
});

// ── CA-06: autorización del administrador ────────────────────────────────────
test('CA-06: viaje con SOAT vencido solo se guarda con autorización del administrador', async () => {
  const viaje = { fecha: dia(0), cliente: s.corbeta, tarifaRef: s.tPasto, destino: 'PASTO 3.0', placa: 'VEN001', conductor: s.conductor };
  const sin = await s.reportero.post('/api/viajes', viaje);
  assert.equal(sin.status, 422);
  assert.match(sin.body.detalles.join(' '), /SOAT de VEN001 vencido/);
  const mala = await s.reportero.post('/api/viajes', { ...viaje, autorizacion: { email: 'admin@req.test', clave: 'equivocada1', motivo: 'Renovación en trámite' } });
  assert.equal(mala.status, 403);
  const noAdmin = await s.reportero.post('/api/viajes', { ...viaje, autorizacion: { email: 'conta@req.test', clave: CLAVE, motivo: 'Renovación en trámite' } });
  assert.equal(noAdmin.status, 403, 'solo el administrador autoriza');
  const sinMotivo = await s.reportero.post('/api/viajes', { ...viaje, autorizacion: { email: 'admin@req.test', clave: CLAVE, motivo: '' } });
  assert.equal(sinMotivo.status, 400);
  const ok = await s.reportero.post('/api/viajes', { ...viaje, autorizacion: { email: 'admin@req.test', clave: CLAVE, motivo: 'SOAT renovado, soporte en camino' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  s.viajeAutorizado = ok.body._id;
  // RF-SEG-05: historial visible para el administrador
  const hist = await s.admin.get('/api/gestion/autorizaciones');
  assert.equal(hist.status, 200);
  assert.equal(hist.body.length, 1);
  assert.equal(hist.body[0].adminNombre, 'Admin R');
  assert.equal(hist.body[0].solicitanteNombre, 'Reportero R');
  assert.equal(hist.body[0].motivo, 'SOAT renovado, soporte en camino');
  assert.equal(hist.body[0].viajeNumero, ok.body.numero);
  assert.equal((await s.reportero.get('/api/gestion/autorizaciones')).status, 403);
  // Se elimina para no afectar los totales de las demás pruebas
  await M.Viaje.deleteOne({ empresa: s.empresa, _id: s.viajeAutorizado });
});

test('RF-REG-11: los días de aviso de documentos se configuran por empresa', async () => {
  await M.Vehiculo.updateOne({ empresa: s.empresa, placa: 'SLF645' }, { $set: { 'soat.vence': new Date(Date.now() + 12 * 86400000) } });
  const a10 = await s.admin.get('/api/gestion/documentos?placa=SLF645');
  assert.equal(a10.body.avisos.length, 0, 'a 12 días no avisa con 10 días de aviso');
  const r = await s.admin.put('/api/gestion/reglas', { diasAvisoDocumentos: 15 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a15 = await s.admin.get('/api/gestion/documentos?placa=SLF645');
  assert.equal(a15.body.avisos.length, 1);
  assert.equal((await s.reportero.put('/api/gestion/reglas', { diasAvisoDocumentos: 3 })).status, 403);
  await s.admin.put('/api/gestion/reglas', { diasAvisoDocumentos: 10 });
  await M.Vehiculo.updateOne({ empresa: s.empresa, placa: 'SLF645' }, { $set: { 'soat.vence': new Date('2035-01-01') } });
});

// ── CA-03: liquidación del conductor ─────────────────────────────────────────
test('CA-03: liquidación de SLF645 con auxiliar y anticipo reconocido (neto $ 2.624.400)', async () => {
  const base = { cliente: s.corbeta, placa: 'SLF645', conductor: s.conductor };
  const viajes = [
    // Pasto: anticipo igual al flete → anticipo reconocido 0 (RN-05); 1 día de auxiliar de 30.000
    { ...base, fecha: dia(0), tarifaRef: s.tPasto, destino: 'PASTO 3.0', flete: 460000, anticipo: 460000, conAuxiliar: true, diasAuxiliar: 1, auxiliarPagado: false },
    // Ipiales: sin tarifa de auxiliar → la primera del cliente (Pasto, 30.000) (RF-REG-07)
    { ...base, fecha: dia(2), tarifaRef: s.tIpiales, destino: 'IPIALES 3.0', flete: 1150000, anticipo: 100000, conAuxiliar: true, auxiliarPagado: false },
    { ...base, fecha: dia(4), tarifaRef: s.tTuquerres, destino: 'TUQUERRES', flete: 1150000, anticipo: 68000 },
  ];
  for (const v of viajes) { const r = await s.admin.post('/api/viajes', v); assert.equal(r.status, 201, JSON.stringify(r.body)); }
  const mucho = await s.admin.post('/api/viajes', { ...viajes[0], diasAuxiliar: 6 });
  assert.equal(mucho.status, 400, 'el auxiliar va de 1 a 5 días');

  const c = await s.admin.post('/api/gestion/liq-conductores/calcular', { desde: dia(0), hasta: dia(6), placa: 'SLF645' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body.lineas.map(l => [l.auxiliar, l.anticipoReconocido]), [[30000, 0], [30000, 100000], [0, 68000]]);
  assert.deepEqual(c.body.totales, { viajes: 3, flete: 2760000, auxiliar: 60000, auxiliarYaPagado: 0, anticipo: 628000, anticipoReconocido: 168000, retefuente: 27600, fopat: 0, saldo: 2624400 });

  // RF-REG-16 / RF-BIT-02: totales de la bitácora con auxiliar, retefuente y FOPAT
  const bit = await s.admin.get(`/api/viajes?desde=${dia(0)}&hasta=${dia(6)}&placa=SLF645`);
  assert.equal(bit.body.sumas.auxiliar, 60000);
  assert.equal(bit.body.sumas.retefuente, 27600);
  assert.equal(bit.body.sumas.fopat, 0);

  // Préstamo del conductor: se escoge cuánto descontar (máximo lo pendiente)
  const p = await s.admin.post('/api/gestion/prestamos', { conductor: s.conductor, concepto: 'Avería', capital: 300000, tasaMensual: 0, nCuotas: 3, primeraCuota: dia(-30) });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const ids = c.body.lineas.map(l => l.viaje);
  const demasiado = await s.admin.post('/api/gestion/liq-conductores', { viajes: ids, desde: dia(0), hasta: dia(6), agrupacion: 'placa_empresa', descuentoPrestamos: 400000 });
  assert.equal(demasiado.status, 400, 'no se descuenta más de lo pendiente');
  const liq = await s.admin.post('/api/gestion/liq-conductores', { viajes: ids, desde: dia(0), hasta: dia(6), agrupacion: 'placa_empresa', descuentoPrestamos: 50000 });
  assert.equal(liq.status, 201, JSON.stringify(liq.body));
  const l = liq.body.liquidacion;
  assert.equal(l.numero, 'COR-0001', 'RF-LIQ-04: siglas de la empresa');
  assert.equal(l.auxiliar, 60000);
  assert.equal(l.anticipoReconocido, 168000);
  assert.equal(l.descuentoPrestamos, 50000);
  assert.equal(l.neto, 2624400 - 50000);
  s.liq1 = l.numero;
  // El asiento cuadra con el auxiliar y el anticipo reconocido
  const a = await M.Asiento.findOne({ empresa: s.empresa, documento: l.numero, origen: 'LIQ' }).lean();
  assert.equal(a.lineas.find(x => x.cuenta === '6155').debito, 2820000);
  assert.equal(a.lineas.find(x => x.cuenta === '2205').credito, 2574400);
});

test('RF-LIQ-01/04/06: por placa y empresa, siglas por defecto y dos liquidaciones por hoja', async () => {
  const v1 = await s.admin.post('/api/viajes', { fecha: dia(1), cliente: s.andina, tarifaRef: s.tTumaco, destino: 'TUMACO', placa: 'SLF645', conductor: s.conductor });
  const v2 = await s.admin.post('/api/viajes', { fecha: dia(1), cliente: s.corbeta, tarifaRef: s.tTuquerres, destino: 'TUQUERRES', placa: 'SLF645', conductor: s.conductor });
  const mezcla = await s.admin.post('/api/gestion/liq-conductores', { viajes: [v1.body._id, v2.body._id], desde: dia(0), hasta: dia(6), agrupacion: 'placa_empresa' });
  assert.equal(mezcla.status, 400, 'una placa de una empresa a la vez');
  // Por conductor se pueden mezclar empresas: lleva las siglas de la empresa (LC)
  const lc = await s.admin.post('/api/gestion/liq-conductores', { viajes: [v1.body._id, v2.body._id], desde: dia(0), hasta: dia(6), descontarPrestamos: false });
  assert.equal(lc.status, 201, JSON.stringify(lc.body));
  assert.equal(lc.body.liquidacion.numero, 'LC-0001');
  assert.equal((await api().get(`/api/gestion/liq-conductores-lote/pdf?numeros=${s.liq1}`)).status, 401);
  const pdf = await binario(s.admin.get(`/api/gestion/liq-conductores-lote/pdf?numeros=${s.liq1},LC-0001`));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal((await PDFDocument.load(pdf.body)).getPageCount(), 1, 'dos liquidaciones en una hoja');
  const xlsx = await s.admin.get(`/api/gestion/liq-conductores/${s.liq1}/xlsx`);
  assert.equal(xlsx.status, 200);
});

// ── CA-01: facturación con política de auxiliar ──────────────────────────────
test('CA-01: factura sin el auxiliar (Corbeta), sin los «[NO FACTURAR]» y con aviso de cruce', async () => {
  const nf = await s.admin.post('/api/viajes', { fecha: dia(3), cliente: s.corbeta, tarifaRef: s.tPasto, destino: 'PASTO 3.0', placa: 'SLF645', conductor: s.conductor,
    observaciones: 'Viaje de prueba [NO FACTURAR]' });
  assert.equal(nf.status, 201);
  const f = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: s.corbeta, desde: dia(0), hasta: dia(6) });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  // Pasto 600.000 + Ipiales 1.400.000 + Túquerres 1.400.000 × 2; el auxiliar no se cobra (política «sin auxiliar»)
  assert.equal(f.body.total, 600000 + 1400000 + 1400000 * 2);
  assert.equal(f.body.viajes, 4, 'el viaje «[NO FACTURAR]» no entra');
  assert.equal(f.body.retefuente, Math.round(f.body.total * 0.01));
  // RF-CTB: aviso de facturas que se cruzan en fechas
  const cruces = await s.conta.get(`/api/gestion/contabilidad/facturas/cruces?cliente=${s.corbeta}&desde=${dia(5)}&hasta=${dia(9)}`);
  assert.equal(cruces.body.length, 1);
  const otra = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: s.corbeta, desde: dia(5), hasta: dia(9) });
  assert.equal(otra.status, 409);
  assert.match(otra.body.error, /se cruza/);
  // Casa Andina: +30.000 por viaje sin anticipo
  const ca = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: s.andina, desde: dia(0), hasta: dia(6) });
  assert.equal(ca.status, 201, JSON.stringify(ca.body));
  assert.equal(ca.body.total, 900000 + 30000);
  // Liquidación de fletes (relación) también aplica la política y excluye «[NO FACTURAR]»
  const rel = await s.conta.post('/api/liquidaciones/calcular', { cliente: s.corbeta, desde: dia(0), hasta: dia(6) });
  assert.equal(rel.body.totales.viajes, 4);
  assert.equal(rel.body.totales.totalAuxiliar, 0);
  s.facturaCorbeta = f.body.numero;
});

test('RF-CTB-09/11: cartera por edades y panel de resumen contable', async () => {
  await M.FacturaCont.updateOne({ empresa: s.empresa, cliente: s.andina }, { $set: { fecha: new Date(Date.now() - 45 * 86400000) } });
  const cartera = await s.conta.get('/api/gestion/contabilidad/informes/cartera');
  assert.equal(cartera.status, 200, JSON.stringify(cartera.body));
  const t = cartera.body.datos.totales;
  assert.equal(t.d31_60, 930000 - Math.round(930000 * 0.01));
  assert.ok(t.d0_30 > 0);
  assert.equal(t.total, t.d0_30 + t.d31_60 + t.d61_90 + t.d90);
  const xlsx = await s.conta.get('/api/gestion/contabilidad/informes/cartera?formato=xlsx');
  assert.equal(xlsx.status, 200);
  await s.conta.post('/api/gestion/contabilidad/cobros', { factura: s.facturaCorbeta, valor: 1000000 });
  const r = await s.conta.get('/api/gestion/contabilidad/resumen');
  assert.equal(r.status, 200);
  assert.equal(r.body.cobrado, 1000000);
  assert.equal(r.body.porCobrar, t.total - 1000000);
  assert.ok(r.body.porPagar > 0);
  assert.equal(r.body.carteraVencida, t.d31_60);
  for (const k of ['facturado', 'gastos', 'excedente']) assert.equal(typeof r.body[k], 'number');
});

// ── Correos ──────────────────────────────────────────────────────────────────
test('RF-COR-01/03: relación por correo a sus destinatarios y correo manual con adjuntos', async () => {
  await M.Empresa.updateOne({ _id: s.empresa }, { $set: { smtp: { activo: true, host: 'smtp.prueba.test', puerto: 587, remitenteCorreo: 'envios@req.test', unirPdf: true } } });
  const sinDest = await s.admin.post('/api/correo/relaciones', { cliente: s.corbeta, desde: dia(0), hasta: dia(6) });
  assert.equal(sinDest.status, 400);
  const cfg = await s.admin.put(`/api/correo/clientes/${s.corbeta}/relaciones`, { destinatarios: ['facturacion@corbeta.test'], cc: ['copia@corbeta.test'] });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
  const antes = buzonPruebas.length;
  const adj = { nombre: 'soporte.txt', tipo: 'text/plain', base64: Buffer.from('soporte').toString('base64') };
  const r = await s.admin.post('/api/correo/relaciones', { cliente: s.corbeta, desde: dia(0), hasta: dia(6), adjuntos: [adj] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.estado, 'enviado', JSON.stringify(r.body));
  const m = buzonPruebas[antes];
  assert.deepEqual(m.to, ['facturacion@corbeta.test']);
  assert.deepEqual(m.attachments.map(a => a.filename.split('.').pop()), ['pdf', 'xlsx', 'txt']);
  const manual = await s.admin.post('/api/correo/manual', { para: ['alguien@req.test'], asunto: 'Soportes', adjuntos: [adj] });
  assert.equal(manual.status, 200, JSON.stringify(manual.body));
  assert.equal(buzonPruebas.at(-1).attachments[0].filename, 'soporte.txt');
  const envios = await M.EnvioCorreo.find({ empresa: s.empresa, tipo: { $in: ['relacion', 'manual'] } }).lean();
  assert.equal(envios.length, 2);
  // Soporte interno de un viaje sin RNDC: se envía en PDF por el correo manual
  const vs = await M.Viaje.findOne({ empresa: s.empresa, 'manifiesto.estado': { $ne: 'aceptado' } }).lean();
  await M.Viaje.updateOne({ empresa: s.empresa, _id: vs._id }, { $set: { requiereManifiesto: false } });
  const sop = (await s.admin.post(`/api/gestion/soportes/viajes/${vs._id}`, {})).body;
  const cs = await s.admin.post('/api/correo/manual', { para: ['cliente@req.test'], soportes: [String(vs._id)] });
  assert.equal(cs.status, 200, JSON.stringify(cs.body));
  assert.equal(cs.body.estado, 'enviado', JSON.stringify(cs.body));
  assert.equal(buzonPruebas.at(-1).attachments[0].filename, `Soporte_${sop.mc}.pdf`);
  assert.equal((await s.admin.post('/api/correo/manual', { para: ['x@req.test'] })).status, 400);
});

// ── Doble factor ─────────────────────────────────────────────────────────────
test('RNF-01: el administrador activa el doble factor y el ingreso pide el código', async () => {
  const ini = await s.admin.post('/api/auth/doble-factor/iniciar', {});
  assert.equal(ini.status, 200);
  assert.match(ini.body.url, /^otpauth:\/\/totp\//);
  assert.match(ini.body.qr, /^data:image\/png;base64,/);
  assert.equal((await s.admin.post('/api/auth/doble-factor/activar', { codigo: '000000' })).status, 400);
  const act = await s.admin.post('/api/auth/doble-factor/activar', { codigo: codigoTotp(ini.body.secreto) });
  assert.equal(act.status, 200, JSON.stringify(act.body));
  assert.equal(act.body.usuario.dobleFactor, true);
  s.secreto = ini.body.secreto;
  const paso1 = await api().post('/api/auth/login').send({ email: 'admin@req.test', password: CLAVE });
  assert.deepEqual(paso1.body, { segundoFactor: true });
  const malo = await api().post('/api/auth/login').send({ email: 'admin@req.test', password: CLAVE, codigo: '123456' });
  assert.equal(malo.status, 401);
  // El código ya usado al activar no sirve otra vez: se usa el del siguiente paso
  const siguiente = codigoTotp(s.secreto, Math.floor(Date.now() / 30000) + 1);
  const ok = await api().post('/api/auth/login').send({ email: 'admin@req.test', password: CLAVE, codigo: siguiente });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  s.admin = con(ok.body.token);
  // La autorización de documentos vencidos también pide el código del administrador
  const viaje = { fecha: dia(0), cliente: s.corbeta, tarifaRef: s.tPasto, destino: 'PASTO 3.0', placa: 'VEN001', conductor: s.conductor };
  const sinCodigo = await s.reportero.post('/api/viajes', { ...viaje, autorizacion: { email: 'admin@req.test', clave: CLAVE, motivo: 'Prueba con doble factor' } });
  assert.equal(sinCodigo.status, 403);
  assert.match(sinCodigo.body.error, /código/);
});

// ── Cierre de mes y respaldos ────────────────────────────────────────────────
test('RF-ADM-02/04 y RF-MAN-03: al cerrar el mes se guarda la copia, los informes por empresa y se descarga el respaldo', async () => {
  const pasado = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 10));
  const mes = iso(pasado).slice(0, 7);
  const v = await s.admin.post('/api/viajes', { fecha: iso(pasado), cliente: s.andina, tarifaRef: s.tTumaco, destino: 'TUMACO', placa: 'SLF645', conductor: s.conductor,
    requiereManifiesto: false });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const c = await s.admin.post('/api/gestion/cierres', { mes });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(c.body.archivos.includes(`${mes}/respaldo-${mes}.json.gz`));
  assert.ok(c.body.archivos.includes(`${mes}/informes/Viajes Casa Andina.xlsx`));
  assert.ok(c.body.archivos.some(a => a.startsWith(`${mes}/manifiestos/Casa Andina/Soporte_MC`)), JSON.stringify(c.body.archivos));
  const lista = await s.admin.get(`/api/gestion/archivo?mes=${mes}`);
  assert.equal(lista.body.length, c.body.archivos.length);
  const xlsx = await s.admin.get(`/api/gestion/archivo/descargar?ruta=${encodeURIComponent(`${mes}/informes/Utilidad por empresa.xlsx`)}`);
  assert.equal(xlsx.status, 200);
  assert.equal((await s.admin.get('/api/gestion/archivo/descargar?ruta=../../etc/passwd')).status, 400);
  assert.equal((await s.conta.get(`/api/gestion/archivo?mes=${mes}`)).status, 403, 'solo el administrador');
  // Respaldo completo desde la plataforma
  const r = await binario(s.admin.get('/api/gestion/respaldo'));
  assert.equal(r.status, 200);
  const lineas = zlib.gunzipSync(r.body).toString('utf8').trim().split('\n').map(x => JSON.parse(x));
  assert.equal(lineas[0].coleccion, 'respaldo');
  assert.ok(lineas.some(x => x.coleccion === 'viajes'));
  assert.ok(!lineas.some(x => x.coleccion === 'usuarios' && (x.doc.passwordHash || x.doc.totp?.secreto)), 'sin claves');
  assert.equal((await s.conta.get('/api/gestion/respaldo')).status, 403);
  await s.admin.post(`/api/gestion/cierres/${mes}/reabrir`, {});
});

// ── Completar viajes importados del Excel (solo llena lo vacío) ──────────────
test('Completar viajes importados: conductor por nombre corto y placa, tarifa por destino, y a mano', async () => {
  const t = await M.Tarifa.findOne({ empresa: s.empresa, _id: s.tPasto }).lean();
  const base = { empresa: s.empresa, cliente: s.corbeta, fecha: new Date(`${dia(5)}T00:00:00Z`), estado: 'registrado', historico: true };
  const [a, b, c] = await M.Viaje.create([
    { ...base, numero: 9001, placa: 'SLF645', destino: t.destino, conductorNombre: 'Wilson Monteros' },   // una letra de diferencia
    { ...base, numero: 9002, placa: 'ZZZ999', destino: 'Destino raro', conductorNombre: 'Pedro Nadie' },
    { ...base, numero: 9003, placa: 'SLF645', destino: t.destino, conductor: s.conductor, conductorNombre: 'Wilson', codDestino: '11111111' },
  ]);
  const revisar = await s.admin.post('/api/importaciones/completar-viajes', {});
  assert.equal(revisar.status, 200, JSON.stringify(revisar.body));
  assert.equal(revisar.body.aplicado, false);
  assert.equal((await M.Viaje.findOne({ empresa: s.empresa, _id: a._id }).lean()).conductor, null, 'revisar no cambia nada');
  assert.ok(revisar.body.pendientes.some(p => p.numero === 9002 && p.falta.includes('conductor') && p.falta.includes('tarifa')));
  assert.ok(!revisar.body.pendientes.some(p => p.numero === 9001));
  assert.equal((await s.reportero.post('/api/importaciones/completar-viajes', {})).status, 403);

  const aplicar = await s.admin.post('/api/importaciones/completar-viajes?aplicar=1', {});
  assert.equal(aplicar.status, 200);
  const va = await M.Viaje.findOne({ empresa: s.empresa, _id: a._id }).lean();
  assert.equal(String(va.conductor), String(s.conductor));
  assert.equal(String(va.tarifaRef), String(s.tPasto));
  assert.equal(va.codDestino, t.codMunicipio);
  const vc = await M.Viaje.findOne({ empresa: s.empresa, _id: c._id }).lean();
  assert.equal(vc.codDestino, '11111111', 'lo que ya tenía no se cambia');

  // El que no se encontró se elige a mano (una sola vez)
  const mano = await s.admin.post(`/api/importaciones/completar-viajes/${b._id}/conductor`, { conductor: s.conductor });
  assert.equal(mano.status, 200, JSON.stringify(mano.body));
  assert.equal((await s.admin.post(`/api/importaciones/completar-viajes/${b._id}/conductor`, { conductor: s.conductor })).status, 409);
  await M.Viaje.deleteMany({ empresa: s.empresa, numero: { $in: [9001, 9002, 9003] } });
});

// ── Importar viajes desde Excel (relación de fletes del cliente) ─────────────
test('Importar viajes: relación de fletes con bloques, repetidos que se aprueban y errores que se corrigen', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const t = await M.Tarifa.findOne({ empresa: s.empresa, _id: s.tPasto }).lean();
  await M.Vehiculo.create({ empresa: s.empresa, placa: 'IMP001' });
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('RELACION');
  ws.addRow(['Relación de cargues para facturación']);
  const h = ['N°', 'Transportador', 'Placa', 'N° Planilla', 'Destino', 'Fecha', 'Cantidad', 'Tarifa', 'Auxiliar', 'Total'];
  ws.addRow(h);
  ws.addRow([1, 'Wilson Montero', 'IMP001', 501, t.destino, new Date(`${dia(1)}T00:00:00Z`), 1, t.tarifaCliente, '', t.tarifaCliente]);
  ws.addRow([2, 'Wilson Montero', 'IMP001', 502, t.destino.toLowerCase(), new Date(`${dia(2)}T00:00:00Z`), 1, 999999, '', 999999]);
  ws.addRow(h);                                                           // segundo bloque
  ws.addRow([1, 'Nadie Inexistente', 'IMP002', 503, 'Destino que no existe', new Date(`${dia(1)}T00:00:00Z`), 1, 100000, '', 100000]);
  ws.addRow(['TOTAL', 'TOTAL', null, null, null, null, null, null, null, 1]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { token } = s.admin;
  const subir = () => api().post(`/api/importaciones/viajes/analizar?cliente=${s.corbeta}&manifiesto=0`).set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/octet-stream').send(buf);

  const a = await subir();
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.total, 3);
  const [f1, f2, f3] = a.body.filas;
  assert.equal(f1.estado, 'lista', JSON.stringify(f1));
  assert.equal(String(f1.conductor), String(s.conductor));
  assert.equal(f2.estado, 'revisar', 'tarifa distinta a la registrada');
  assert.ok(f2.avisos.some(x => /distinta/.test(x)));
  assert.equal(f3.estado, 'error');
  assert.ok(f3.errorConductor && f3.errorDestino);
  assert.equal((await M.Viaje.countDocuments({ empresa: s.empresa, placa: 'IMP001' })), 0, 'revisar no guarda');

  // Se registran la lista y la aprobada; la de error con conductor y destino elegidos a mano
  const base = (f) => ({ fila: f.fila, fecha: f.fecha, cliente: f.cliente, tarifaRef: f.tarifaRef, conductor: f.conductor, placa: f.placa, planilla: f.planilla,
    tarifa: f.tarifa, flete: f.flete, anticipo: f.anticipo, requiereManifiesto: f.requiereManifiesto });
  const reg = await api().post('/api/importaciones/viajes/registrar').set('Authorization', `Bearer ${token}`)
    .send({ filas: [base(f1), base(f2), { ...base(f3), conductor: s.conductor, tarifaRef: s.tPasto, completarDeTarifa: true }] });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.equal(reg.body.creados.length, 3, JSON.stringify(reg.body.fallidos));
  const v1 = await M.Viaje.findOne({ empresa: s.empresa, placa: 'IMP001', planilla: '501' }).lean();
  assert.equal(v1.fecha.toISOString().slice(0, 10), dia(1), 'con la fecha del archivo');
  assert.equal(v1.requiereManifiesto, false);
  assert.equal(f1.auxiliarPagado, true, 'por defecto el auxiliar importado ya está pagado');
  assert.ok(v1.soporteInterno?.mc, 'soporte interno numerado como al registrar');
  const v3 = await M.Viaje.findOne({ empresa: s.empresa, placa: 'IMP002' }).lean();
  assert.equal(v3.flete, t.fleteConductor, 'destino elegido a mano: flete de la tarifa');

  // Al subir otra vez el mismo archivo, avisa que ya están subidos y no los deja sin aprobar
  const b = await subir();
  assert.deepEqual(b.body.filas.map(f => f.estado).slice(0, 2), ['repetida', 'repetida']);
  const sinAprobar = await api().post('/api/importaciones/viajes/registrar').set('Authorization', `Bearer ${token}`).send({ filas: [base(b.body.filas[0])] });
  assert.equal(sinAprobar.body.creados.length, 0);
  assert.match(sinAprobar.body.fallidos[0].error, /Ya existe/);
  assert.equal((await s.reportero.post('/api/importaciones/viajes/registrar', { filas: [base(f1)] })).status, 403);
  const pl = await binario(api().get('/api/importaciones/viajes/plantilla').set('Authorization', `Bearer ${token}`));
  assert.equal(pl.status, 200);
  await M.Viaje.deleteMany({ empresa: s.empresa, placa: { $in: ['IMP001', 'IMP002'] } });
  await M.Vehiculo.deleteMany({ empresa: s.empresa, placa: 'IMP001' });
});

// ── Acciones con varios viajes a la vez ──────────────────────────────────────
test('Viajes masivo: revisar sin cambiar, aplicar auxiliar pagado, omitir los que no aplican y eliminar', async () => {
  const base = { cliente: s.corbeta, tarifaRef: s.tPasto, destino: 'PASTO 3.0', placa: 'MAS001', conductor: s.conductor };
  const v1 = await s.admin.post('/api/viajes', { ...base, fecha: dia(1), conAuxiliar: true, diasAuxiliar: 1, auxiliarPagado: false });
  const v2 = await s.admin.post('/api/viajes', { ...base, fecha: dia(2), conAuxiliar: true, diasAuxiliar: 2, auxiliarPagado: false });
  const v3 = await s.admin.post('/api/viajes', { ...base, fecha: dia(3) });
  for (const r of [v1, v2, v3]) assert.equal(r.status, 201, JSON.stringify(r.body));
  const ids = [v1.body._id, v2.body._id, v3.body._id];

  const sim = await s.admin.post('/api/viajes/masivo', { ids, accion: 'auxiliar_pagado', valores: { pagado: true } });
  assert.equal(sim.status, 200, JSON.stringify(sim.body));
  assert.equal(sim.body.aplicables.length, 2);
  assert.equal(sim.body.omitidos.length, 1);
  assert.equal(sim.body.omitidos[0].motivo, 'No lleva auxiliar');
  assert.equal((await M.Viaje.findOne({ empresa: s.empresa, _id: v1.body._id }).lean()).auxiliarPagado, false, 'revisar no cambia nada');

  const ap = await s.admin.post('/api/viajes/masivo', { ids, accion: 'auxiliar_pagado', valores: { pagado: true }, simular: false });
  assert.equal(ap.body.aplicados.length, 2);
  assert.equal((await M.Viaje.findOne({ empresa: s.empresa, _id: v2.body._id }).lean()).auxiliarPagado, true);

  const nf = await s.admin.post('/api/viajes/masivo', { ids, accion: 'no_facturar', valores: { marcar: true }, simular: false });
  assert.equal(nf.body.aplicados.length, 3);
  assert.match((await M.Viaje.findOne({ empresa: s.empresa, _id: v3.body._id }).lean()).observaciones, /\[NO FACTURAR\]/);

  const val = await s.admin.post('/api/viajes/masivo', { ids, accion: 'valores', valores: { flete: 123000 } });
  assert.equal(val.body.aplicables.length, 3);
  assert.match(val.body.aplicables[0].cambio, /Flete .* → \$ 123\.000/);

  assert.equal((await s.reportero.post('/api/viajes/masivo', { ids, accion: 'eliminar', simular: false })).body.aplicados.length, 0, 'el reportero solo cambia los suyos');
  const el = await s.admin.post('/api/viajes/masivo', { ids, accion: 'eliminar', simular: false });
  assert.equal(el.status, 200);
  assert.equal(await M.Viaje.countDocuments({ empresa: s.empresa, _id: { $in: ids } }), 0);
  assert.equal((await s.admin.post('/api/viajes/masivo', { ids, accion: 'auxiliar_pagado' })).status, 400, 'sin indicar el valor');
});

// ── Cargues del día del jefe de bodega (enlace por WhatsApp) ─────────────────
test('Bodega: configuración, enlace con cédula, reporte por pestaña, revisión y vínculo con los viajes', async () => {
  const cfg = { activa: true, envioAutomatico: false, hora: '06:30', dias: [1, 2, 3, 4, 5, 6], manifiestoUrbanos: false, manifiestoCorrerias: true, auxiliarPagado: true,
    jefes: [{ nombre: 'Carlos Ruiz', cedula: '12.345.678', celular: '315 123 4567' }] };
  assert.equal((await s.admin.put(`/api/bodega/config/${s.corbeta}`, { ...cfg, jefes: [{ nombre: 'X Y', cedula: '1', celular: '3151234567' }] })).status, 400, 'cédula no válida');
  const c = await s.admin.put(`/api/bodega/config/${s.corbeta}`, cfg);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.bodega.jefes[0].cedula, '12345678');
  assert.equal(c.body.bodega.jefes[0].celular, '3151234567');

  // Se envía (sin WhatsApp activo queda el enlace creado y el envío como fallido)
  const env = await s.admin.post('/api/bodega/enviar', { clientes: [s.corbeta] });
  assert.equal(env.status, 200, JSON.stringify(env.body));
  const dia = await s.admin.get('/api/bodega/dia');
  const fila = dia.body.clientes.find((x) => String(x._id) === String(s.corbeta));
  assert.ok(fila?.reporte?._id, 'el reporte del día existe');
  const enl = await s.admin.get(`/api/bodega/reportes/${fila.reporte._id}/enlace`);
  assert.equal(enl.status, 200, JSON.stringify(enl.body));
  const token = enl.body.enlace.split('/b/')[1];
  assert.ok(token.length >= 20);
  assert.equal((await s.reportero.get(`/api/bodega/config/${s.corbeta}`)).status, 200);
  assert.equal((await s.reportero.put(`/api/bodega/config/${s.corbeta}`, cfg)).status, 403, 'solo quien edita maestros configura');

  // Público: portada sin datos, cédula ajena rechazada, sesión con la del jefe
  const pub = (u) => api().get(`/api/b/${token}${u}`);
  const portada = await pub('');
  assert.equal(portada.status, 200);
  assert.deepEqual(Object.keys(portada.body).sort(), ['cliente', 'empresa', 'fecha', 'fechaTexto', 'vence']);
  assert.equal((await api().get('/api/b/inexistente-pero-con-forma-valida1')).status, 404);
  assert.equal((await api().post(`/api/b/${token}/ingresar`).send({ cedula: '99999999' })).status, 403);
  const ing = await api().post(`/api/b/${token}/ingresar`).send({ cedula: '12345678' });
  assert.equal(ing.status, 200, JSON.stringify(ing.body));
  const sesion = ing.body.sesion;
  assert.equal((await pub('/datos')).status, 401, 'sin sesión no ve nada');
  assert.equal((await pub('/datos').set('X-Sesion-Bodega', `${sesion}x`)).status, 401, 'sesión alterada');
  const datos = await pub('/datos').set('X-Sesion-Bodega', sesion);
  assert.equal(datos.status, 200, JSON.stringify(datos.body));
  const tipo = 'correria';
  assert.equal(datos.body.destinos, undefined, 'al jefe de bodega no se le sugieren destinos');
  const t = await M.Tarifa.findOne({ empresa: s.empresa, _id: s.tPasto }).lean();
  assert.ok(!JSON.stringify(datos.body).includes('98765432'), 'nunca muestra cédulas de conductores');

  const guardar = (items, cual = 'hoy', t = tipo) => api().put(`/api/b/${token}/reporte`).set('X-Sesion-Bodega', sesion).send({ cual, tipo: t, items });
  assert.equal((await guardar([{ placa: 'BOD001', destino: '' }])).status, 400, 'el destino es obligatorio');
  const g = await guardar([{ placa: 'bod-001', destino: t.destino.toLowerCase(), viajes: 2, auxiliar: 2, planilla: '77', conductorTexto: 'Wilson Montero' }]);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.items[0].placa, 'BOD001');

  // Revisión: un renglón por viaje, con el conductor que escribió la bodega
  const rev = await s.admin.get(`/api/bodega/reportes/${fila.reporte._id}`);
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.equal(rev.body.filas.length, 2);
  assert.equal(String(rev.body.filas[0].conductor), String(s.conductor));
  assert.equal(String(rev.body.filas[0].tarifaRef), String(s.tPasto), 'sugiere la tarifa del destino escrito');
  assert.equal(rev.body.filas[0].auxiliar, 2);
  assert.equal(rev.body.filas[0].auxiliarPagado, true);
  assert.equal(rev.body.filas[0].requiereManifiesto, true);

  // Se registra con el proceso normal y se vincula al renglón
  const f0 = rev.body.filas[0];
  const v = await s.admin.post('/api/viajes', { fecha: rev.body.fecha, cliente: s.corbeta, tarifaRef: f0.tarifaRef, destino: f0.destino, placa: 'BOD001', conductor: f0.conductor,
    planilla: '77', conAuxiliar: true, diasAuxiliar: 1, auxiliarPagado: true, requiereManifiesto: true });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const vin = await s.admin.post(`/api/bodega/reportes/${fila.reporte._id}/vincular`, { item: f0.item, viaje: v.body._id });
  assert.equal(vin.status, 200, JSON.stringify(vin.body));
  // La bodega ya no puede quitar lo registrado
  const g2 = await guardar([]);
  assert.equal(g2.body.items.length, 1);
  assert.equal(g2.body.items[0].registrado, true);
  const rev2 = await s.admin.get(`/api/bodega/reportes/${fila.reporte._id}`);
  assert.equal(rev2.body.filas.filter((x) => x.registrado).length, 1);

  // Fijar placas
  const fij = await s.admin.put(`/api/bodega/config/${s.corbeta}/placas`, { placa: 'zzz999', accion: 'agregar' });
  assert.equal(fij.status, 200, JSON.stringify(fij.body));
  assert.ok(fij.body.frecuentes.some((x) => x.placa === 'ZZZ999' && x.origen === 'agregada' && x.visible && x.tipos.length === 2));
  const tp = await s.admin.put(`/api/bodega/config/${s.corbeta}/placas`, { placa: 'ZZZ999', accion: 'tipo', tipo: 'urbano' });
  assert.deepEqual(tp.body.frecuentes.find((x) => x.placa === 'ZZZ999').tipos, ['urbano'], 'solo en urbanos');
  const qui = await s.admin.put(`/api/bodega/config/${s.corbeta}/placas`, { placa: 'ZZZ999', accion: 'quitar' });
  assert.ok(qui.body.frecuentes.some((x) => x.placa === 'ZZZ999' && x.origen === 'quitada' && !x.visible));
  const bus = await s.admin.get(`/api/bodega/config/${s.corbeta}/buscar?q=wilson`);
  assert.equal(bus.status, 200);
  assert.ok(bus.body.some((x) => x.placa === 'SLF645'), 'busca por el nombre del conductor');
  await M.Viaje.deleteMany({ empresa: s.empresa, placa: 'BOD001' });
  await M.ReporteBodega.deleteMany({ empresa: s.empresa });
});

// ── Viajes duplicados (importación del Excel) ────────────────────────────────
test('Duplicados: detecta el viaje repetido del Excel, conserva el del manifiesto y anula el duplicado con su soporte', async () => {
  const t = await M.Tarifa.findOne({ empresa: s.empresa, _id: s.tPasto }).lean();
  const fecha = new Date(`${dia(2)}T00:00:00Z`);
  const base = { empresa: s.empresa, cliente: s.corbeta, placa: 'DUP001', fecha, conductor: s.conductor, tarifaRef: t._id, flete: 400000 };
  const [orig] = await M.Viaje.create([{ ...base, numero: 9101, destino: t.destino, estado: 'manifestado', manifiesto: { numero: 'M999', estado: 'aceptado' } }]);
  await new Promise((r) => setTimeout(r, 20));
  const [dup, otro] = await M.Viaje.create([
    { ...base, numero: 9102, destino: t.destino.toLowerCase(), historico: true, requiereManifiesto: false, soporteInterno: { mc: 'MC9102', rc: 'RC9102' } },
    { ...base, numero: 9103, destino: 'Otro destino', historico: true, tarifaRef: null },
  ]);
  const det = await s.admin.get('/api/importaciones/duplicados');
  assert.equal(det.status, 200, JSON.stringify(det.body));
  const mios = det.body.pares.filter((p) => p.placa === 'DUP001');
  assert.equal(mios.length, 2);
  assert.ok(mios.every((p) => p.original.numero === 9101), 'se conserva el del manifiesto');
  assert.equal(mios.find((p) => p.duplicado.numero === 9102).certeza, 'seguro');
  assert.equal(mios.find((p) => p.duplicado.numero === 9103).certeza, 'revisar');
  assert.equal((await s.reportero.get('/api/importaciones/duplicados')).status, 403);

  const an = await s.admin.post('/api/importaciones/duplicados/anular', { ids: [String(dup._id), String(orig._id)] });
  assert.equal(an.status, 200, JSON.stringify(an.body));
  assert.equal(an.body.anulados.length, 1);
  assert.equal(an.body.omitidos.length, 1, 'el original no se anula');
  const v = await M.Viaje.findOne({ empresa: s.empresa, _id: dup._id }).lean();
  assert.equal(v.estado, 'anulado');
  assert.equal(v.soporteInterno.estado, 'anulado');
  assert.match(v.observaciones, /Duplicado del viaje N° 9101/);
  assert.equal((await M.Viaje.findOne({ empresa: s.empresa, _id: orig._id }).lean()).estado, 'manifestado');
  assert.ok(!(await s.admin.get('/api/importaciones/duplicados')).body.pares.some((p) => p.duplicado.numero === 9102), 'ya no aparece');
  await M.Viaje.deleteMany({ empresa: s.empresa, placa: 'DUP001' });
  void otro;
});

// ── Deshacer una importación de viajes (con copia) ───────────────────────────
test('Deshacer importación: borra los viajes del archivo con copia en Excel y no toca lo que tiene documentos', async () => {
  const t = await M.Tarifa.findOne({ empresa: s.empresa, _id: s.tPasto }).lean();
  const fila = (n, placa) => ({ fila: n, fecha: dia(3), cliente: String(s.corbeta), tarifaRef: String(s.tPasto), conductor: String(s.conductor), placa, tarifa: t.tarifaCliente, flete: t.fleteConductor, requiereManifiesto: false });
  const reg = await s.admin.post('/api/importaciones/viajes/registrar', { filas: [fila(1, 'DES001'), fila(2, 'DES002')], archivo: 'relacion_prueba.xlsx' });
  assert.equal(reg.body.creados.length, 2, JSON.stringify(reg.body));
  // Uno de ellos ya tiene documentos del RNDC: no se borra
  await M.Viaje.updateOne({ empresa: s.empresa, placa: 'DES002' }, { $set: { 'manifiesto.numero': 'M777' } });
  const lotes = await s.admin.get('/api/importaciones/viajes/lotes');
  const lote = lotes.body.find((l) => l.archivo === 'relacion_prueba.xlsx');
  assert.ok(lote && lote.existentes === 2, JSON.stringify(lotes.body));
  const rev = await s.admin.get(`/api/importaciones/viajes/lotes/${lote._id}`);
  assert.equal(rev.body.borrar, 1);
  assert.equal(rev.body.omitidos[0].motivo, 'Tiene documentos del RNDC');
  assert.equal((await s.reportero.post(`/api/importaciones/viajes/lotes/${lote._id}/deshacer`, {})).status, 403);
  const des = await s.admin.post(`/api/importaciones/viajes/lotes/${lote._id}/deshacer`, {});
  assert.equal(des.status, 200, JSON.stringify(des.body));
  assert.equal(des.body.borrados, 1);
  assert.equal(await M.Viaje.countDocuments({ empresa: s.empresa, placa: 'DES001' }), 0, 'borrado');
  assert.equal(await M.Viaje.countDocuments({ empresa: s.empresa, placa: 'DES002' }), 1, 'el del manifiesto se queda');
  const copia = await binario(s.admin.get(`/api/importaciones/respaldos/${des.body.respaldo}/xlsx`));
  assert.equal(copia.status, 200);
  assert.ok(copia.body.length > 1000, 'copia en Excel');
  await M.Viaje.deleteMany({ empresa: s.empresa, placa: { $in: ['DES001', 'DES002'] } });
});

test('Duplicados: un viaje anulado por error se reactiva y no vuelve a salir como duplicado', async () => {
  const fecha = new Date(`${dia(4)}T00:00:00Z`);
  const base = { empresa: s.empresa, cliente: s.corbeta, placa: 'REA001', fecha, conductor: s.conductor, destino: 'X', flete: 1 };
  const [a] = await M.Viaje.create([{ ...base, numero: 9201 }]);
  await new Promise((r) => setTimeout(r, 20));
  const [b] = await M.Viaje.create([{ ...base, numero: 9202 }]);
  const an = await s.admin.post('/api/importaciones/duplicados/anular', { ids: [String(b._id)] });
  assert.equal(an.body.anulados.length, 1);
  const re = await s.admin.post(`/api/importaciones/duplicados/${b._id}/no-es-duplicado`, {});
  assert.equal(re.status, 200, JSON.stringify(re.body));
  const v = await M.Viaje.findOne({ empresa: s.empresa, _id: b._id }).lean();
  assert.equal(v.estado, 'registrado');
  assert.equal(v.observaciones, '');
  assert.ok(!(await s.admin.get('/api/importaciones/duplicados')).body.pares.some((p) => p.placa === 'REA001'), 'ya no sale como duplicado');
  await M.Viaje.deleteMany({ empresa: s.empresa, _id: { $in: [a._id, b._id] } });
});

// ── Paginación desde el servidor ─────────────────────────────────────────────
test('Paginación: listas por páginas con total, sin romper las respuestas de siempre', async () => {
  const urls = ['/api/rndc/transacciones', '/api/correo/envios', '/api/liquidaciones', '/api/gestion/liq-conductores', '/api/gestion/prestamos', '/api/reportes/auditoria'];
  for (const u of urls) {
    const sin = await s.admin.get(u);
    assert.equal(sin.status, 200, `${u}: ${JSON.stringify(sin.body).slice(0, 200)}`);
    assert.ok(Array.isArray(sin.body), `${u} sin «pagina» sigue devolviendo la lista`);
    const p1 = await s.admin.get(`${u}?pagina=1&limite=5`);
    assert.equal(p1.status, 200, u);
    assert.ok(Array.isArray(p1.body.items) && typeof p1.body.total === 'number', `${u} con página`);
    assert.ok(p1.body.items.length <= 5);
    assert.equal(p1.body.paginas, Math.max(1, Math.ceil(p1.body.total / 5)));
  }
  // La auditoría tiene muchos registros: la página 2 no repite la 1
  const a1 = await s.admin.get('/api/reportes/auditoria?pagina=1&limite=5');
  const a2 = await s.admin.get('/api/reportes/auditoria?pagina=2&limite=5');
  assert.ok(a1.body.total > 10);
  assert.ok(!a2.body.items.some((x) => a1.body.items.some((y) => y._id === x._id)), 'páginas distintas');
  // Mensajes de WhatsApp: totales del periodo y página
  const d = `desde=${dia(-30)}&hasta=${dia(10)}`;
  const m = await s.admin.get(`/api/whatsapp/mensajes?${d}&pagina=1&limite=5`);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.ok(m.body.totales && Array.isArray(m.body.mensajes) && typeof m.body.total === 'number');
  const rc = await s.admin.get(`/api/whatsapp/recibidos?${d}&pagina=1&limite=5`);
  assert.equal(rc.status, 200);
  assert.ok(Array.isArray(rc.body.mensajes) && typeof rc.body.total === 'number');
  const mSin = await s.admin.get(`/api/whatsapp/mensajes?${d}`);
  assert.ok(mSin.body.totales && Array.isArray(mSin.body.mensajes), 'sin página igual que antes');
});

test('Paginación optimizada: cursor igual a skip, total solo en la primera página y listas livianas', async () => {
  // Auditoría: suficientes registros para varias páginas
  const u = '/api/reportes/auditoria';
  const p1 = (await s.admin.get(`${u}?pagina=1&limite=5`)).body;
  assert.ok(p1.total > 15 && typeof p1.paginas === 'number');
  const p2skip = (await s.admin.get(`${u}?pagina=2&limite=5`)).body;
  assert.equal(p2skip.total, null, 'la página 2 no vuelve a contar');
  assert.equal(p2skip.paginas, null);
  assert.equal(typeof (await s.admin.get(`${u}?pagina=2&limite=5&contar=1`)).body.total, 'number', 'contar=1 fuerza el total');
  const ids = (b) => b.items.map((x) => x._id);
  const p2cur = (await s.admin.get(`${u}?pagina=2&limite=5&despuesDe=${p1.items.at(-1)._id}`)).body;
  assert.deepEqual(ids(p2cur), ids(p2skip), 'siguiente con cursor = siguiente con skip');
  const p3skip = (await s.admin.get(`${u}?pagina=3&limite=5`)).body;
  const p3cur = (await s.admin.get(`${u}?pagina=3&limite=5&despuesDe=${p2cur.items.at(-1)._id}`)).body;
  assert.deepEqual(ids(p3cur), ids(p3skip));
  const p2atras = (await s.admin.get(`${u}?pagina=2&limite=5&antesDe=${p3cur.items[0]._id}`)).body;
  assert.deepEqual(ids(p2atras), ids(p2skip), 'anterior con cursor = anterior con skip');
  // Un cursor que no pertenece a la empresa o no existe no rompe: se usa skip
  const raro = (await s.admin.get(`${u}?pagina=2&limite=5&despuesDe=${'0'.repeat(24)}`)).body;
  assert.deepEqual(ids(raro), ids(p2skip));
  const malo = await s.admin.get(`${u}?pagina=2&limite=5&despuesDe[$gt]=`);
  assert.equal(malo.status, 200);

  // RNDC: la lista no trae el XML enviado ni la respuesta
  await M.TransaccionRndc.create({ empresa: s.empresa, proceso: 4, tipo: 1, referencia: 'Viaje PAG-1', solicitud: '<x>'.repeat(500), respuesta: '<y>'.repeat(500), ok: false, mensaje: 'Rechazo de prueba paginación' });
  const tr = (await s.admin.get('/api/rndc/transacciones?pagina=1&limite=5&q=PAG-1')).body;
  assert.equal(tr.total, 1);
  assert.equal(tr.items[0].respuesta, undefined); assert.equal(tr.items[0].solicitud, undefined);
  assert.equal((await s.admin.get('/api/rndc/transacciones?pagina=1&limite=5&q=paginación')).body.total, 1, 'busca en el mensaje');
  assert.equal((await s.admin.get('/api/rndc/transacciones?pagina=1&limite=5&q=zzz-no-existe&procesos=4')).body.total >= 1, true, 'busca por proceso');
  assert.equal((await s.admin.get('/api/rndc/transacciones?pagina=1&limite=5&q=zzz-no-existe')).body.total, 0);
  await M.TransaccionRndc.deleteMany({ empresa: s.empresa, referencia: 'Viaje PAG-1' });

  // Liquidaciones de conductores: cifras de arriba calculadas en la base con la primera página
  const lc = (await s.admin.get('/api/gestion/liq-conductores?pagina=1&limite=5')).body;
  assert.ok('resumen' in lc);
  assert.ok(!('resumen' in (await s.admin.get('/api/gestion/liq-conductores?pagina=2&limite=5')).body));
  // Búsqueda y estado en la base
  for (const url of ['/api/liquidaciones?pagina=1&limite=5&q=zzz-no-existe&estado=borrador', '/api/gestion/prestamos?pagina=1&limite=5&q=zzz-no-existe&estado=VIGENTE',
    '/api/correo/envios?pagina=1&limite=5&q=zzz-no-existe', `/api/whatsapp/mensajes?desde=${dia(-30)}&hasta=${dia(10)}&pagina=1&limite=5&texto=zzz-no-existe`,
    `/api/whatsapp/recibidos?desde=${dia(-30)}&hasta=${dia(10)}&pagina=1&limite=5&texto=zzz-no-existe`]) {
    const r = await s.admin.get(url);
    assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.equal(r.body.total, 0, url);
  }
});
