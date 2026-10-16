// Prueba integral de la API contra MongoDB local (base *_test) y el simulador
// local del RNDC. Nunca contacta el RNDC real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test';
process.env.RNDC_PERMITIR_PRODUCCION = 'false';
process.env.RNDC_PERMITIR_PRUEBAS = 'false';

const { crearSimulador } = await import('../tools/rndcSimulador.js');
const sim = crearSimulador();
await new Promise(r => sim.servidor.listen(0, '127.0.0.1', r));
process.env.RNDC_SIMULADOR_URL = `http://127.0.0.1:${sim.servidor.address().port}/soap/IBPMServices`;

const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');
const { importarMunicipios } = await import('../scripts/importarMunicipios.js');

const app = crearApp();
const api = () => request(app);
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;   // contraseña local de prueba
const CLAVE_RNDC = 'clave-simulador';
const s = {};                                                  // estado compartido entre pruebas

const login = async (email, password = CLAVE) => {
  const r = await api().post('/api/auth/login').send({ email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
};
const con = (token) => ({
  get: (u) => api().get(u).set('Authorization', `Bearer ${token}`),
  post: (u, b) => api().post(u).set('Authorization', `Bearer ${token}`).send(b),
  put: (u, b) => api().put(u).set('Authorization', `Bearer ${token}`).send(b),
  del: (u) => api().delete(u).set('Authorization', `Bearer ${token}`),
});

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  await importarMunicipios();
  await M.Usuario.create({ nombre: 'Super', email: 'super@prueba.test', rol: 'superadmin', passwordHash: await bcrypt.hash(CLAVE, 10) });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  sim.servidor.close();
});

test('SuperAdmin crea dos empresas con su administrador', async () => {
  s.sa = con(await login('super@prueba.test'));
  for (const [k, nit] of [['A', '900111222'], ['B', '900333444']]) {
    const r = await s.sa.post('/api/admin/empresas', {
      nombre: `Transportes ${k}`, nit, dv: '1', ciudad: 'Pasto',
      administrador: { nombre: `Admin ${k}`, email: `admin${k.toLowerCase()}@prueba.test`, password: CLAVE },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    s[`empresa${k}`] = r.body.empresa._id;
  }
  const lista = await s.sa.get('/api/admin/empresas');
  assert.equal(lista.body.length, 2);
  s.adminA = con(await login('admina@prueba.test'));
  s.adminB = con(await login('adminb@prueba.test'));
});

test('Solo hay un SuperAdmin y un Administrador por empresa', async () => {
  await assert.rejects(M.Usuario.create({ nombre: 'Otro', email: 'super2@prueba.test', rol: 'superadmin', passwordHash: 'x' }), { code: 11000 });
  const segundo = await s.sa.post(`/api/admin/empresas/${s.empresaA}/administradores`, { nombre: 'Otro admin', email: 'admin2@prueba.test', password: CLAVE });
  assert.equal(segundo.status, 409);
  await assert.rejects(M.Usuario.create({ nombre: 'Otro', email: 'admin3@prueba.test', rol: 'admin', empresa: s.empresaA, passwordHash: 'x' }), { code: 11000 });
  const porAdmin = await s.adminA.post('/api/usuarios', { nombre: 'Otro admin', email: 'admin4@prueba.test', rol: 'admin', password: CLAVE });
  assert.equal(porAdmin.status, 409);
  const roles = (await s.adminA.get('/api/usuarios/roles')).body;
  assert.equal(roles.find(r => r.clave === 'admin').asignable, false);
  // El SuperAdmin reemplaza a la persona encargada editando el único administrador
  const [admin] = (await s.sa.get(`/api/admin/empresas/${s.empresaB}/administradores`)).body;
  const cambio = await s.sa.put(`/api/admin/administradores/${admin._id}`, { nombre: 'Admin B2', email: 'adminb2@prueba.test' });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.body));
  s.adminB = con(await login('adminb2@prueba.test'));
});

test('El SuperAdmin no opera datos de empresas y los demás no administran empresas', async () => {
  assert.equal((await s.sa.get('/api/viajes')).status, 403);
  assert.equal((await s.adminA.get('/api/admin/empresas')).status, 403);
});

test('Administrador crea usuarios de su empresa con roles válidos', async () => {
  for (const [rol, email] of [['reportero', 'reportero@a.test'], ['manifiestos', 'manif@a.test'], ['contabilidad', 'conta@a.test']]) {
    const r = await s.adminA.post('/api/usuarios', { nombre: rol, email, rol, password: CLAVE });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const malo = await s.adminA.post('/api/usuarios', { nombre: 'x', email: 'x@a.test', rol: 'superadmin', password: CLAVE });
  assert.equal(malo.status, 400);
  s.reportero = con(await login('reportero@a.test'));
  s.manif = con(await login('manif@a.test'));
  s.conta = con(await login('conta@a.test'));
  assert.equal((await s.reportero.get('/api/usuarios')).status, 403);
  assert.equal((await s.adminB.get('/api/usuarios')).body.length, 1, 'B solo ve su propio usuario');
});

test('Maestros: cliente, destino/tarifa, conductor y vehículo', async () => {
  const cli = await s.adminA.post('/api/maestros/clientes', { nombre: 'Distribuidora Sur', tipoId: 'N', nit: '800123456', dv: '7', sedeRemitente: '1' });
  assert.equal(cli.status, 201, JSON.stringify(cli.body));
  s.cliente = cli.body._id;
  const tar = await s.adminA.post('/api/maestros/tarifas', {
    cliente: s.cliente, destino: 'Tumaco', codMunicipio: '52835000', tarifaCliente: 2000000, tarifaAuxiliar: 50000,
    fleteConductor: 1500000, auxiliarPagado: 40000, anticipoHabitual: 500000, pesoKg: 5000,
  });
  assert.equal(tar.status, 201, JSON.stringify(tar.body));
  s.tarifa = tar.body._id;
  const cond = await s.manif.post('/api/maestros/terceros', {
    tipoId: 'C', numId: '12.345.678', nombres: 'Pedro', apellido1: 'Pérez', apellido2: 'Gómez', celular: '3001234567',
    direccion: 'Calle 1 # 2-3', codMunicipio: '52001000', roles: ['conductor', 'titular'],
    licencia: { categoria: 'C2', numero: '12345678', vence: '2030-01-01' },
  });
  assert.equal(cond.status, 201, JSON.stringify(cond.body));
  assert.equal(cond.body.numId, '12345678');
  s.conductor = cond.body._id;
  const veh = await s.manif.post('/api/maestros/vehiculos', {
    placa: 'abc-123', configuracion: '50', configuracionNombre: '2', marca: '1', modelo: 2015, pesoVacio: 4000, pbv: 9000,
    soat: { numero: 'S1', vence: '2030-01-01', aseguradoraNit: '8600284155' },
    propietario: { tipoId: 'C', numId: '12345678' }, tenedor: { tipoId: 'C', numId: '12345678' }, conductorHabitual: s.conductor,
  });
  assert.equal(veh.status, 201, JSON.stringify(veh.body));
  assert.equal(veh.body.placa, 'ABC123');
  s.vehiculo = veh.body._id;
  // Un conductor con NIT no es válido (manual RNDC 8.1)
  const malo = await s.manif.post('/api/maestros/terceros', { tipoId: 'N', numId: '9001112221', nombres: 'Empresa', roles: ['conductor'] });
  assert.equal(malo.status, 400);
  // El reportero no edita maestros
  assert.equal((await s.reportero.post('/api/maestros/clientes', { nombre: 'X' })).status, 403);
});

test('Aislamiento: la empresa B no ve ni usa datos de A', async () => {
  assert.equal((await s.adminB.get('/api/maestros/clientes')).body.length, 0);
  assert.equal((await s.adminB.get(`/api/maestros/terceros/${s.conductor}`)).status, 404);
  assert.equal((await s.adminB.put(`/api/maestros/clientes/${s.cliente}`, { nombre: 'Robado' })).status, 404);
  const cruzado = await s.adminB.post('/api/viajes', { fecha: '2026-10-10', cliente: s.cliente, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  assert.equal(cruzado.status, 400, 'no puede usar cliente/conductor de otra empresa');
  // Defensa en profundidad: una consulta sin empresa es rechazada por el modelo
  await assert.rejects(() => M.Viaje.find({}).lean(), /sin empresa/);
});

test('Reportero registra un viaje; se completan valores desde la tarifa', async () => {
  const r = await s.reportero.post('/api/viajes', {
    fecha: '2026-10-10', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123',
    conductor: s.conductor, conAuxiliar: true, observaciones: 'Entrega en bodega',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.numero, 1);
  assert.equal(r.body.flete, 1500000);
  assert.equal(r.body.tarifa, 2000000);
  assert.equal(r.body.codDestino, '52835000');
  assert.equal(r.body.saldo, 1000000);
  s.viaje = r.body._id;
  const lista = await s.manif.get('/api/viajes?estado=registrado');
  assert.equal(lista.body.total, 1);
  assert.equal((await s.adminB.get(`/api/viajes/${s.viaje}`)).status, 404);
});

test('RNDC: sin configuración la remesa no se envía y se informan los faltantes', async () => {
  const prev = await s.manif.get(`/api/rndc/viajes/${s.viaje}/vista-previa`);
  assert.equal(prev.status, 200);
  assert.ok(prev.body.remesa.problemas.some(p => p.startsWith('MERCANCIAREMESA')), JSON.stringify(prev.body.remesa.problemas));
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(r.status, 422);
  assert.ok(r.body.detalles.length > 0);
  assert.equal(sim.estado.log.length, 0, 'no se envió nada al simulador');
});

test('RNDC: configuración (solo admin) y bloqueo de ambientes oficiales', async () => {
  assert.equal((await s.manif.put('/api/rndc/config', { prefijoRemesa: 'R' })).status, 403);
  const prod = await s.adminA.put('/api/rndc/config', { ambiente: 'PRODUCCION' });
  assert.equal(prod.status, 400, 'producción deshabilitada en el servidor de pruebas');
  const r = await s.adminA.put('/api/rndc/config', {
    ambiente: 'SIMULADO', usuario: 'USUARIOWS@1', prefijoRemesa: 'R', prefijoManifiesto: 'M', codOrigen: '52001000',
    poliza: { numero: 'POL1', vence: '2027-12-31', aseguradoraNit: '8600284155', dueno: 'E' },
    mercancia: { codigo: '009980', descripcion: 'VIVERES Y ABARROTES' }, siguienteRemesa: 500, siguienteManifiesto: 700,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cfg = await s.adminA.get('/api/rndc/config');
  assert.equal(cfg.body.siguienteRemesa, 500);
  assert.equal(cfg.body.usuario, 'USUARIOWS@1');
  assert.equal(cfg.body.mercancia.codigo, '009980');
});

test('RNDC: el reportero no puede despachar', async () => {
  assert.equal((await s.reportero.post(`/api/rndc/viajes/${s.viaje}/despachar`, { clave: CLAVE_RNDC })).status, 403);
});

test('RNDC: despacho de remesa + manifiesto contra el simulador', async () => {
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.remesa.estado, 'aceptado', JSON.stringify(r.body));
  assert.equal(r.body.remesa.numero, 'R500');
  assert.equal(r.body.manifiesto.estado, 'aceptado', JSON.stringify(r.body));
  assert.equal(r.body.manifiesto.numero, 'M700');
  assert.equal(r.body.manifiesto.qr.length, 28);
  const v = (await s.manif.get(`/api/viajes/${s.viaje}`)).body;
  assert.equal(v.estado, 'manifestado');
  // Los datos bloqueados ya no se pueden cambiar
  assert.equal((await s.manif.put(`/api/viajes/${s.viaje}`, { placa: 'XYZ999' })).status, 409);
  assert.equal((await s.manif.put(`/api/viajes/${s.viaje}`, { observaciones: 'Ok' })).status, 200);
  // La transacción quedó registrada sin la clave
  const tx = await s.manif.get(`/api/rndc/transacciones?viaje=${s.viaje}`);
  assert.equal(tx.body.length, 2);
  assert.ok(tx.body.every(t => !t.solicitud.includes(CLAVE_RNDC) && t.solicitud.includes('<password>*****</password>')));
  // Envío al simulador con el NIT con dígito de verificación y la remesa en el manifiesto
  const m = [...sim.estado.manifiestos.values()][0];
  assert.equal(m.NUMNITEMPRESATRANSPORTE, '9001112221');
  assert.deepEqual(m.remesas, ['R500']);
  assert.equal(m.CODMUNICIPIODESTINOMANIFIESTO, '52835000');
  assert.equal(m.RETENCIONFUENTEMANIFIESTO, '15000');
});

test('Manifiesto PDF con QR', async () => {
  const r = await s.manif.get(`/api/reportes/manifiesto/${s.viaje}`).buffer(true).parse((res, cb) => {
    const partes = []; res.on('data', c => partes.push(c)); res.on('end', () => cb(null, Buffer.concat(partes)));
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/pdf');
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  const { textoQR } = await import('../src/services/reportes/manifiesto.js');
  const t = textoQR({ radicado: '1', fechaExp: '2026/10/10', placa: 'ABC123', config: '2', origen: 'PASTO NARIÑO', destino: 'TUMACO NARIÑO',
    mercancia: 'VIVERES', condDoc: '12345678', empresa: 'Transportes A', seguro: 'x'.repeat(28) });
  assert.ok(t.startsWith('MEC:1\r\nFecha:2026/10/10\r\nPlaca:ABC123\r\nConfig:2\r\nOrig:PASTO NARINO'));
  assert.ok(t.endsWith(`Seguro:${'x'.repeat(28)}`));
  assert.ok(!t.includes('Remolque:'), 'sin remolque no va el dato');
});

test('RNDC: consulta de manifiesto en el simulador', async () => {
  const r = await s.manif.post('/api/rndc/consultar', { clave: CLAVE_RNDC, que: 'manifiesto', filtros: { NUMMANIFIESTOCARGA: 'M700' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.documentos.length, 1);
  assert.equal(r.body.documentos[0].numplaca, 'ABC123');
});

test('RNDC: tercero se envía una vez y no se reenvía sin cambios', async () => {
  const r1 = await s.manif.post(`/api/rndc/terceros/${s.conductor}/enviar`, { clave: CLAVE_RNDC });
  assert.equal(r1.body.ok, true, JSON.stringify(r1.body));
  const r2 = await s.manif.post(`/api/rndc/terceros/${s.conductor}/enviar`, { clave: CLAVE_RNDC });
  assert.equal(r2.body.sinCambios, true);
  await s.manif.put(`/api/maestros/terceros/${s.conductor}`, { celular: '3109998888' });
  const t = (await s.manif.get(`/api/maestros/terceros/${s.conductor}`)).body;
  assert.equal(t.rndc.estado, 'sin_enviar', 'al cambiar datos queda pendiente de sincronizar');
  const r3 = await s.manif.post(`/api/rndc/terceros/${s.conductor}/enviar`, { clave: CLAVE_RNDC });
  assert.equal(r3.body.ok, true);
});

test('RNDC: contraseña incorrecta queda como rechazo del RNDC', async () => {
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-10-11', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  s.viaje2 = v.body._id;
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/despachar`, { clave: 'clave-incorrecta' });
  assert.equal(r.body.remesa.estado, 'rechazado');
  assert.match(r.body.remesa.mensaje, /no válidos/);
  // El reintento usa el mismo consecutivo (la remesa rechazada no existe en el RNDC)
  const r2 = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(r2.body.remesa.numero, r.body.remesa.numero);
  assert.equal(r2.body.manifiesto.estado, 'aceptado');
});

test('Manifiestos RNDC: revisar, corregir tras un rechazo y reenviar', async () => {
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-02', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  s.viaje3 = v.body._id;
  // Solo quien opera el RNDC corrige los datos de envío
  assert.equal((await s.reportero.put(`/api/rndc/viajes/${s.viaje3}/datos`, { pesoKg: 1 })).status, 403);
  const malo = await s.manif.post(`/api/rndc/viajes/${s.viaje3}/despachar`, { clave: 'clave-incorrecta' });
  assert.equal(malo.body.remesa.estado, 'rechazado');
  const prev = (await s.manif.get(`/api/rndc/viajes/${s.viaje3}/vista-previa`)).body;
  assert.match(prev.ultimoError.mensaje, /no válidos/, 'se muestra la respuesta real del RNDC');
  assert.equal(prev.documentos.remesa.estado, 'rechazado');
  assert.deepEqual(prev.maestros.map(m => m.rol), ['Vehículo', 'Conductor']);
  // Corrección antes de reenviar (devuelve la nueva vista previa)
  const c = await s.manif.put(`/api/rndc/viajes/${s.viaje3}/datos`, { pesoKg: 4200, observaciones: 'Corregido', flete: 1400000 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.ok(c.body.manifiesto.variables.some(([n, x]) => n === 'VALORFLETEPACTADOVIAJE' && x === '1400000'));
  const ok = await s.manif.post(`/api/rndc/viajes/${s.viaje3}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(ok.body.manifiesto.estado, 'aceptado', JSON.stringify(ok.body));
  assert.equal((await s.manif.get(`/api/rndc/viajes/${s.viaje3}/vista-previa`)).body.ultimoError, null);
  // Con manifiesto aceptado ya no se editan sus datos aquí
  assert.equal((await s.manif.put(`/api/rndc/viajes/${s.viaje3}/datos`, { pesoKg: 1 })).status, 409);
});

test('Viajes que no requieren manifiesto no aparecen en Manifiestos RNDC', async () => {
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-02', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123',
    conductor: s.conductor, requiereManifiesto: false });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.requiereManifiesto, false);
  const pendientes = (await s.manif.get('/api/viajes?estado=registrado,remesa&rndc=1')).body.viajes.map(x => x._id);
  assert.ok(!pendientes.includes(v.body._id));
  const r = await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(r.status, 409);
  // Se puede cambiar de opinión mientras no tenga documentos
  assert.equal((await s.reportero.put(`/api/viajes/${v.body._id}`, { requiereManifiesto: true })).status, 200);
  assert.ok((await s.manif.get('/api/viajes?estado=registrado,remesa&rndc=1')).body.viajes.some(x => x._id === v.body._id));
  assert.equal((await s.reportero.del(`/api/viajes/${v.body._id}`)).status, 200);
});

test('Titular automático según la placa y manifiesto sin pasar por Viajes', async () => {
  const tit = await s.manif.post('/api/maestros/terceros', { tipoId: 'C', numId: '7654321', nombres: 'Rosa', apellido1: 'Titular', celular: '3001112233',
    direccion: 'Calle 9', codMunicipio: '52001000', roles: ['titular'] });
  assert.equal(tit.status, 201, JSON.stringify(tit.body));
  await s.manif.put(`/api/maestros/vehiculos/${s.vehiculo}`, { titularHabitual: tit.body._id });
  // Creado desde Manifiestos RNDC: no se pide titular; sale del vehículo
  const v = await s.manif.post('/api/viajes', { fecha: '2026-11-03', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123',
    conductor: s.conductor, origen: 'manifiesto', requiereManifiesto: false });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.titular._id, tit.body._id);
  assert.equal(v.body.origen, 'manifiesto');
  assert.equal(v.body.requiereManifiesto, true, 'lo creado en Manifiestos siempre requiere manifiesto');
  // Sin titular habitual, el titular es el conductor (vacío)
  await s.manif.put(`/api/maestros/vehiculos/${s.vehiculo}`, { titularHabitual: null });
  const v2 = await s.reportero.post('/api/viajes', { fecha: '2026-11-03', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  assert.equal(v2.body.titular, null);
  for (const x of [v.body._id, v2.body._id]) await s.manif.del(`/api/viajes/${x}`);
});

test('Vehículos y terceros: verificar antes de crear (base local, RNDC o nuevo)', async () => {
  // Ya existe en la empresa: no se duplica
  const local = await s.manif.post('/api/rndc/verificar/vehiculo', { placa: 'abc-123' });
  assert.equal(local.body.origen, 'local');
  assert.equal(local.body.registro._id, s.vehiculo);
  // Sin contraseña no se consulta el RNDC
  assert.deepEqual((await s.manif.post('/api/rndc/verificar/vehiculo', { placa: 'NUE321' })).body, { origen: 'nuevo', consultado: false });
  // Consulta al RNDC: no lo tiene → nuevo con el mensaje real
  const nuevo = await s.manif.post('/api/rndc/verificar/vehiculo', { placa: 'NUE321', clave: CLAVE_RNDC });
  assert.equal(nuevo.body.origen, 'nuevo');
  assert.equal(nuevo.body.consultado, true);
  assert.ok(nuevo.body.mensaje);
  // Un conductor registrado en el RNDC desde otra plataforma (aquí se envía y se borra de la empresa)
  const prop = await s.manif.post('/api/maestros/terceros', { tipoId: 'C', numId: '1098765432', nombres: 'Ana', apellido1: 'Rosero', celular: '3005556666',
    direccion: 'Carrera 5 # 10-20', codMunicipio: '52001000', roles: ['conductor'], licencia: { categoria: 'C3', numero: '1098765432', vence: '2031-05-01' } });
  assert.equal(prop.status, 201, JSON.stringify(prop.body));
  const env = await s.manif.post(`/api/rndc/terceros/${prop.body._id}/enviar`, { clave: CLAVE_RNDC });
  assert.equal(env.body.ok, true, JSON.stringify(env.body));
  // Si existe en el RNDC pero no en la empresa, se crea con esos datos y queda sincronizado
  await M.Tercero.deleteOne({ empresa: s.empresaA, _id: prop.body._id });
  const rndc = await s.manif.post('/api/rndc/verificar/tercero', { tipoId: 'C', numId: '1098765432', clave: CLAVE_RNDC, roles: ['conductor'] });
  assert.equal(rndc.body.origen, 'rndc', JSON.stringify(rndc.body));
  assert.equal(rndc.body.registro.nombres, 'Ana');
  assert.equal(rndc.body.registro.licencia.numero, '1098765432');
  assert.equal(rndc.body.registro.rndc.estado, 'enviado');
  assert.deepEqual(rndc.body.faltantes, []);
  // Los faltantes se informan con su etiqueta
  const f = await s.manif.get(`/api/rndc/faltantes/vehiculo/${s.vehiculo}`);
  assert.equal(f.status, 200);
  assert.ok(f.body.faltantes.every(x => x.etiqueta && x.variable));
  // El reportero no verifica (no edita maestros)
  assert.equal((await s.reportero.post('/api/rndc/verificar/vehiculo', { placa: 'NUE321' })).status, 403);
});

test('Plantillas de WhatsApp: crear, predeterminar, vista previa y eliminar', async () => {
  const base = (await s.reportero.get('/api/viajes/plantillas-whatsapp')).body;
  assert.equal(base.plantillas[0]._id, 'base');
  assert.ok(base.marcadores.viaje.placa);
  const p = await s.reportero.post('/api/viajes/plantillas-whatsapp', { nombre: 'Corta', encabezado: '{cliente} {fecha}', linea: '{placa} · {conductor} · {flete}',
    separador: 'linea', pie: 'Total {total_flete}', predeterminada: true });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const rep = (await s.reportero.get('/api/viajes/reporte-whatsapp?fecha=2026-11-02&incluirReportados=1')).body;
  assert.equal(rep.plantilla, p.body._id);
  assert.match(rep.mensajes[0].texto, /^Distribuidora Sur 02\/11\/2026\n\nABC123 · Pedro Pérez Gómez · \$ 1\.400\.000 COP\n\nTotal \$ 1\.400\.000 COP\n$/);
  const prev = await s.reportero.post('/api/viajes/reporte-whatsapp/vista-previa', { fecha: '2026-11-02', plantilla: { linea: 'Placa {placa}' } });
  assert.match(prev.body.mensajes[0].texto, /Placa ABC123/);
  assert.equal((await s.adminB.put(`/api/viajes/plantillas-whatsapp/${p.body._id}`, { nombre: 'X', linea: 'x' })).status, 404, 'otra empresa no la ve');
  assert.equal((await s.reportero.del(`/api/viajes/plantillas-whatsapp/${p.body._id}`)).status, 200);
  assert.equal((await s.reportero.get('/api/viajes/reporte-whatsapp?fecha=2026-11-02&incluirReportados=1')).body.plantilla, 'base');
});

test('RNDC: anulación de manifiesto por cambio de conductor y reemplazo', async () => {
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/anular`, { clave: CLAVE_RNDC, documento: 'manifiesto', motivo: 'C', observaciones: 'Cambio de conductor' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  let v = (await s.manif.get(`/api/viajes/${s.viaje2}`)).body;
  assert.equal(v.estado, 'remesa');
  assert.equal(v.manifiestoReemplazado, v.manifiesto.numero);
  const nuevo = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(nuevo.body.manifiesto.estado, 'aceptado', JSON.stringify(nuevo.body));
  assert.notEqual(nuevo.body.manifiesto.numero, v.manifiesto.numero, 'el reemplazo usa un número nuevo');
  const enviado = sim.estado.manifiestos.get(`9001112221|${nuevo.body.manifiesto.numero}`);
  assert.equal(enviado.MANNROMANIFIESTOTRANSBORDO, v.manifiesto.numero);
});

test('RNDC: cumplido de remesa y manifiesto', async () => {
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje}/cumplir`, {
    clave: CLAVE_RNDC,
    remesa: { tipo: 'C', cantidadEntregada: 5000, llegada: { fecha: '2026-10-11', hora: '08:00' }, entrada: { fecha: '2026-10-11', hora: '08:30' }, salida: { fecha: '2026-10-11', hora: '10:00' } },
    manifiesto: { tipo: 'C', fechaEntregaDocumentos: '2026-10-12' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cumplidoRemesa.estado, 'aceptado');
  assert.equal(r.body.cumplidoManifiesto.estado, 'aceptado');
  assert.equal((await s.manif.get(`/api/viajes/${s.viaje}`)).body.estado, 'cumplido');
});

test('Liquidación de fletes: cálculo, guardado, sin doble cobro y descargas', async () => {
  const calc = await s.conta.post('/api/liquidaciones/calcular', { cliente: s.cliente, desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(calc.status, 200, JSON.stringify(calc.body));
  assert.equal(calc.body.totales.viajes, 2);
  // Viaje 1 con auxiliar: 2.000.000 + 50.000 cobrado; 1.500.000 + 40.000 pagado
  const l1 = calc.body.lineas.find(l => l.numero === 1);
  assert.equal(l1.totalCobrado, 2050000);
  assert.equal(l1.utilidad, 2050000 - 1540000);
  const g = await s.conta.post('/api/liquidaciones', { cliente: s.cliente, desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  s.liq = g.body._id;
  assert.equal((await s.conta.post('/api/liquidaciones', { cliente: s.cliente, desde: '2026-10-01', hasta: '2026-10-31' })).status, 400);
  assert.equal((await s.manif.put(`/api/viajes/${s.viaje}`, { observaciones: 'x' })).status, 409, 'viaje liquidado no se edita');
  const xlsx = await s.conta.get(`/api/reportes/liquidacion/${s.liq}.xlsx`);
  assert.equal(xlsx.status, 200);
  const pdf = await s.conta.get(`/api/reportes/liquidacion/${s.liq}.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal((await s.adminB.get(`/api/reportes/liquidacion/${s.liq}.pdf`)).status, 404);
  assert.equal((await s.reportero.get('/api/liquidaciones')).status, 403);
  // Anular libera los viajes
  await s.conta.put(`/api/liquidaciones/${s.liq}/estado`, { estado: 'anulada' });
  assert.equal((await s.conta.post('/api/liquidaciones/calcular', { cliente: s.cliente, desde: '2026-10-01', hasta: '2026-10-31' })).body.totales.viajes, 2);
});

test('Bitácora en Excel y PDF', async () => {
  const x = await s.manif.get('/api/reportes/bitacora.xlsx?desde=2026-10-01&hasta=2026-10-31');
  assert.equal(x.status, 200);
  assert.match(x.headers['content-type'], /spreadsheetml/);
  const p = await s.manif.get('/api/reportes/bitacora.pdf?desde=2026-10-01&hasta=2026-10-31');
  assert.equal(p.status, 200);
});

test('Seguridad de sesión: desactivar usuario invalida su token y bloqueo por intentos', async () => {
  const lista = (await s.adminA.get('/api/usuarios')).body;
  const rep = lista.find(u => u.email === 'reportero@a.test');
  await s.adminA.put(`/api/usuarios/${rep._id}`, { activo: false });
  assert.equal((await s.reportero.get('/api/viajes')).status, 401);
  for (let i = 0; i < 5; i++) await api().post('/api/auth/login').send({ email: 'conta@a.test', password: 'Incorrecta123' });
  const r = await api().post('/api/auth/login').send({ email: 'conta@a.test', password: CLAVE });
  assert.equal(r.status, 423, 'bloqueado tras 5 intentos fallidos');
  // Desactivar la empresa corta el acceso de sus usuarios
  await s.sa.put(`/api/admin/empresas/${s.empresaB}`, { activa: false });
  assert.equal((await s.adminB.get('/api/viajes')).status, 403);
});

test('Auditoría registra acciones globales y de empresa por separado', async () => {
  const global = await s.sa.get('/api/admin/auditoria?empresa=global');
  assert.ok(global.body.some(a => a.accion === 'crear_empresa'));
  assert.ok(global.body.every(a => a.empresa === null));
  const deA = await s.adminA.get('/api/reportes/auditoria');
  assert.ok(deA.body.some(a => a.accion === 'rndc_despachar'));
  assert.ok(deA.body.every(a => String(a.empresa) === String(s.empresaA)));
});
