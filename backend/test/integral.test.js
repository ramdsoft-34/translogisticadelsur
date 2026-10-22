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

// Sur Track simulado (puerta de integración de Cooespatrans) para las pruebas de rastreo
const http = await import('node:http');
const surTrack = { viajes: new Map(), activos: [], clave: crypto.randomBytes(24).toString('hex') };
surTrack.servidor = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', c => { cuerpo += c; });
  req.on('end', () => {
    const json = (st, b) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.url.startsWith('/search')) return json(200, [{ display_name: 'Ipiales, Nariño, Colombia', lat: '0.8300', lon: '-77.6400' }]);
    if (req.url.startsWith('/route/v1/driving/')) return json(200, { code: 'Ok', routes: [{ distance: 82318, duration: 4467,
      geometry: { coordinates: [[-77.28, 1.21], [-77.4, 1.08], [-77.64, 0.83]] } }] });
    if (req.headers['x-integracion-clave'] !== surTrack.clave) return json(401, { mensaje: 'clave' });
    const ruta = new URL(req.url, 'http://x').pathname.replace('/api/integracion', '');
    const choferes = [{ choferId: 'c1', nombre: 'Pedro Pablo Perez Gomez', cedula: '12345678', placa: 'ABC123' },
      { choferId: 'c2', nombre: 'Ana Ruiz', cedula: '55667788', placa: 'XYZ987' }, { choferId: 'c3', nombre: 'Sin Placa', cedula: '1', placa: '' }];
    if (ruta === '/vehiculos') return json(200, choferes);
    if (ruta === '/rastreo/activos') return json(200, surTrack.activos);
    if (ruta === '/viajes' && req.method === 'GET') return json(200, [...surTrack.viajes.values()]);
    if (ruta === '/viajes' && req.method === 'POST') {
      const b = JSON.parse(cuerpo);
      const previo = [...surTrack.viajes.values()].find(v => v.referenciaExterna === b.referencia);
      if (previo) return json(200, { ...previo, existente: true });
      const ch = choferes.find(c => c.placa === String(b.placa).toUpperCase());
      if (!ch) return json(404, { mensaje: 'El conductor o la placa no están registrados en Sur Track' });
      const viajeId = crypto.randomBytes(12).toString('hex');
      const clientes = (b.clientes || []).map((c, i) => ({ ...c, clienteId: crypto.randomBytes(12).toString('hex'), estadoEntrega: 'pendiente' }));
      const v = { viajeId, codigo: b.codigo, estado: 'pendiente', chofer: ch, referenciaExterna: b.referencia, clientesSt: clientes, rutaSugerida: b.rutaSugerida };
      surTrack.viajes.set(viajeId, v);
      return json(201, { ...v, clientes: clientes.map(c => ({ clienteId: c.clienteId, referencia: c.referencia })) });
    }
    let m = ruta.match(/^\/viajes\/([a-f0-9]{24})\/clientes$/);
    if (m && req.method === 'PUT') {
      const v = surTrack.viajes.get(m[1]); if (!v) return json(404, {});
      if (v.estado !== 'pendiente') return json(409, { mensaje: 'El conductor ya aceptó el viaje en Sur Track: los clientes no se pueden cambiar' });
      v.clientesSt = (JSON.parse(cuerpo).clientes || []).map(c => ({ ...c, clienteId: crypto.randomBytes(12).toString('hex'), estadoEntrega: 'pendiente' }));
      return json(200, { clientes: v.clientesSt.map(c => ({ clienteId: c.clienteId, referencia: c.referencia })) });
    }
    m = ruta.match(/^\/viajes\/([a-f0-9]{24})\/finalizar$/);
    if (m) { const v = surTrack.viajes.get(m[1]); if (!v) return json(404, {}); v.estado = 'completado'; return json(200, { estado: v.estado }); }
    m = ruta.match(/^\/rastreo\/([a-f0-9]{24})$/);
    if (m) {
      const v = surTrack.viajes.get(m[1]); if (!v) return json(404, { mensaje: 'no' });
      return json(200, { viaje: v, ultima: null, clientes: (v.clientesSt || []).map(c => ({ clienteId: c.clienteId, nombre: c.nombre, direccion: c.direccion,
        estadoEntrega: c.estadoEntrega, valorRecibido: c.valorRecibido || 0, fechaEntrega: c.fechaEntrega || null })),
        ruta: v.clientesSt?.length ? { coordenadas: [{ lat: 1.21, lng: -77.28 }, { lat: 1.22, lng: -77.29 }] } : null, puntos: [{ lat: 1.2136, lng: -77.2811, velocidad: 10, hora: '2026-11-20T10:00:00Z' },
        { lat: 1.2236, lng: -77.2811, velocidad: 25, hora: '2026-11-20T10:05:00Z' }] });
    }
    json(404, { mensaje: 'ruta' });
  });
});
await new Promise(r => surTrack.servidor.listen(0, '127.0.0.1', r));
process.env.COOESPATRANS_INTEGRACION_URL = `http://127.0.0.1:${surTrack.servidor.address().port}/api/integracion`;
process.env.COOESPATRANS_INTEGRACION_CLAVE = surTrack.clave;
process.env.OSRM_URL = `http://127.0.0.1:${surTrack.servidor.address().port}`;
process.env.NOMINATIM_URL = `http://127.0.0.1:${surTrack.servidor.address().port}`;

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
  surTrack.servidor.close();
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
    destinatario: { tipoId: 'N', numId: '8001234567', sede: '2' },
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

test('RNDC: consecutivo con letras y números', async () => {
  const cfg = (await s.adminA.get('/api/rndc/config')).body;
  assert.equal(cfg.consecutivoRemesa, 'R500');
  assert.equal((await s.adminA.put('/api/rndc/config', { consecutivoRemesa: 'R-500' })).status, 400, 'solo letras y números');
  assert.equal((await s.adminA.put('/api/rndc/config', { consecutivoRemesa: 'REM' })).status, 400, 'debe terminar en número');
  // Se puede bajar si el número no está usado (corrección de un número mal escrito)
  assert.equal((await s.adminA.put('/api/rndc/config', { consecutivoRemesa: 'R499' })).status, 200);
  assert.equal((await s.adminA.get('/api/rndc/config')).body.consecutivoRemesa, 'R499');
  await s.adminA.put('/api/rndc/config', { consecutivoRemesa: 'R500' });
  // Cambio de serie con ceros a la izquierda: se conservan
  assert.equal((await s.adminA.put('/api/rndc/config', { consecutivoManifiesto: 'mc0700' })).status, 200);
  const c2 = (await s.adminA.get('/api/rndc/config')).body;
  assert.equal(c2.consecutivoManifiesto, 'MC0700');
  assert.equal(c2.prefijoManifiesto, 'MC0');
  // Se vuelve a la serie de las demás pruebas
  await s.adminA.put('/api/rndc/config', { consecutivoManifiesto: 'M700' });
  assert.equal((await s.adminA.get('/api/rndc/config')).body.consecutivoManifiesto, 'M700');
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
  // Con la contraseña mal, la consulta del número al RNDC falla antes de enviar
  const sinClave = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/despachar`, { clave: 'clave-incorrecta' });
  assert.equal(sinClave.status, 400);
  assert.match(sinClave.body.error, /no aceptó el usuario o la contraseña/);
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/despachar`, { clave: 'rechaza-registros' });
  assert.equal(r.body.remesa.estado, 'rechazado', JSON.stringify(r.body));
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
  const malo = await s.manif.post(`/api/rndc/viajes/${s.viaje3}/despachar`, { clave: 'rechaza-registros' });
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

test('Actualizar vehículos desde el RNDC: individual y por lotes de 30', async () => {
  const esperar = async (estados) => {
    for (let i = 0; i < 150; i += 1) {
      const p = (await s.manif.get('/api/rndc/vehiculos/actualizacion')).body.proceso;
      if (p && estados.includes(p.estado)) return p;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('el proceso no llegó a ' + estados.join('/'));
  };
  // El vehículo está en el RNDC; aquí se le cambia un dato y se recupera
  const env = await s.manif.post(`/api/rndc/vehiculos/${s.vehiculo}/enviar`, { clave: CLAVE_RNDC, forzar: true });
  assert.equal(env.body.ok, true, JSON.stringify(env.body));
  await M.Vehiculo.updateOne({ empresa: s.empresaA, _id: s.vehiculo }, { $set: { pesoVacio: 1111 } });
  const uno = await s.manif.post('/api/rndc/vehiculos/actualizar', { clave: CLAVE_RNDC, placa: 'abc-123' });
  assert.equal(uno.body.estado, 'actualizado', JSON.stringify(uno.body));
  assert.ok(uno.body.campos.includes('pesoVacio'), JSON.stringify(uno.body.campos));
  assert.equal((await M.Vehiculo.findOne({ empresa: s.empresaA, _id: s.vehiculo }).lean()).pesoVacio, 4000);
  assert.equal((await s.manif.post('/api/rndc/vehiculos/actualizar', { clave: CLAVE_RNDC, placa: 'ABC123' })).body.estado, 'sin_cambios');
  assert.equal((await s.manif.post('/api/rndc/vehiculos/actualizar', { clave: CLAVE_RNDC, placa: 'ZZZ999' })).body.estado, 'no_registrado');
  assert.equal((await s.reportero.post('/api/rndc/vehiculos/actualizar', { clave: CLAVE_RNDC, placa: 'ABC123' })).status, 403);

  // 31 vehículos más (no están en el RNDC) para tener dos lotes
  await M.Vehiculo.insertMany(Array.from({ length: 31 }, (_, i) => ({ empresa: s.empresaA, placa: `LOT${String(i).padStart(3, '0')}` })));
  const total = await M.Vehiculo.countDocuments({ empresa: s.empresaA });
  const ini = await s.manif.post('/api/rndc/vehiculos/actualizacion', { clave: CLAVE_RNDC, modo: 'lotes' });
  assert.equal(ini.status, 202, JSON.stringify(ini.body));
  assert.equal(ini.body.clave, undefined, 'la contraseña no se devuelve');
  assert.equal((await s.manif.post('/api/rndc/vehiculos/actualizacion', { clave: CLAVE_RNDC, modo: 'todos' })).status, 409, 'un solo proceso por empresa');
  const p1 = await esperar(['esperando']);
  assert.equal(p1.lotes.length, 1);
  assert.equal(p1.lotes[0].resultados.length, 30);
  assert.equal(p1.procesados, 30);
  const p2 = await (async () => { await s.manif.post('/api/rndc/vehiculos/actualizacion/continuar', {}); return esperar(['esperando', 'terminado']); })();
  assert.equal(p2.loteActual, 2);
  let fin = p2;
  while (fin.estado === 'esperando') { await s.manif.post('/api/rndc/vehiculos/actualizacion/continuar', {}); fin = await esperar(['esperando', 'terminado']); }
  assert.equal(fin.procesados, total);
  assert.equal(fin.actualizados + fin.sinCambios + fin.noEncontrados + fin.errores, total);
  assert.ok(fin.noEncontrados >= 31, 'las placas que el RNDC no tiene quedan como no encontradas');
  assert.equal(await M.Vehiculo.countDocuments({ empresa: s.empresaA }), total, 'no se crean vehículos');

  // Contraseña rechazada: el proceso se detiene de inmediato
  await s.manif.post('/api/rndc/vehiculos/actualizacion', { clave: 'clave-incorrecta', modo: 'todos' });
  const det = await esperar(['detenido']);
  assert.equal(det.procesados, 1);
  assert.match(det.mensaje, /contraseña/);
  await M.Vehiculo.deleteMany({ empresa: s.empresaA, placa: /^LOT/ });
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
  assert.match(rep.mensajes[0].texto, /^Distribuidora Sur 02\/11\/2026\n\nABC123 · Pedro Pérez Gómez · \$ 1\.400\.000\n\nTotal \$ 1\.400\.000\n$/);
  const prev = await s.reportero.post('/api/viajes/reporte-whatsapp/vista-previa', { fecha: '2026-11-02', plantilla: { linea: 'Placa {placa}' } });
  assert.match(prev.body.mensajes[0].texto, /Placa ABC123/);
  assert.equal((await s.adminB.put(`/api/viajes/plantillas-whatsapp/${p.body._id}`, { nombre: 'X', linea: 'x' })).status, 404, 'otra empresa no la ve');
  assert.equal((await s.reportero.del(`/api/viajes/plantillas-whatsapp/${p.body._id}`)).status, 200);
  assert.equal((await s.reportero.get('/api/viajes/reporte-whatsapp?fecha=2026-11-02&incluirReportados=1')).body.plantilla, 'base');
});

test('Nuevo en el RNDC: próxima sede de una empresa y vista previa sin enviar', async () => {
  const nit = '9007770001';
  assert.equal((await s.adminA.get(`/api/maestros/terceros/sedes?numId=${nit}`)).body.siguiente, '1');
  for (const c of ['1', '3']) assert.equal((await s.adminA.post('/api/maestros/terceros', { tipoId: 'N', numId: nit, nombres: 'Sedes SAS', sede: { codigo: c, nombre: `S${c}` }, roles: ['destinatario'] })).status, 201);
  const r = (await s.adminA.get(`/api/maestros/terceros/sedes?numId=${nit}`)).body;
  assert.equal(r.sedes.length, 2); assert.equal(r.siguiente, '4');
  const v = await s.adminA.post('/api/maestros/terceros/vista-rndc', { tipoId: 'N', numId: nit, nombres: 'Sedes SAS', sede: { codigo: '4', nombre: 'NUEVA' }, roles: ['destinatario'] });
  assert.equal(v.status, 200);
  assert.ok(v.body.variables.some(([n, x]) => n === 'CODSEDETERCERO' && x === '4'));
  assert.equal((await s.adminA.get(`/api/maestros/terceros/sedes?numId=${nit}`)).body.sedes.length, 2, 'la vista previa no guarda');
});

test('Conductores: búsqueda por varias palabras y placa asociada', async () => {
  const r = (await s.reportero.get('/api/maestros/terceros?rol=conductor&conPlacas=1&q=pedro%20gomez')).body;
  const pedro = r.find(t => String(t._id) === String(s.conductor));
  assert.ok(pedro, JSON.stringify(r.map(t => t.nombres)));
  assert.ok(pedro.placas.includes('ABC123'), JSON.stringify(pedro.placas));
  // Sin texto: primero los que manejaron más recientemente, con su placa
  const recientes = (await s.reportero.get('/api/maestros/terceros?rol=conductor&conPlacas=1')).body;
  assert.equal(String(recientes[0]._id), String(s.conductor));
  assert.equal((await s.reportero.get('/api/maestros/terceros?rol=conductor&conPlacas=1&q=pedro%20zzz')).body.length, 0);
});

test('WhatsApp: el mensaje lleva solo los viajes seleccionados', async () => {
  const a = await s.reportero.post('/api/viajes', { fecha: '2026-11-09', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  const b = await s.reportero.post('/api/viajes', { fecha: '2026-11-09', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'XYZ987', conductor: s.conductor });
  const url = '/api/viajes/reporte-whatsapp?fecha=2026-11-09&seleccion=1';
  const nada = (await s.reportero.get(`${url}&viajes=`)).body;
  assert.equal(nada.viajes.length, 2, 'lista los viajes para elegir');
  assert.equal(nada.mensajes.length, 0, 'sin selección no se arma ningún mensaje');
  const uno = (await s.reportero.get(`${url}&viajes=${b.body._id}`)).body;
  assert.equal(uno.mensajes.length, 1);
  assert.deepEqual(uno.mensajes[0].viajes.map(String), [String(b.body._id)]);
  assert.match(uno.mensajes[0].texto, /XYZ987/);
  assert.doesNotMatch(uno.mensajes[0].texto, /ABC123/);
  for (const x of [a, b]) await s.manif.del(`/api/viajes/${x.body._id}`);
});

test('Remesa: destinatario en la sede del municipio de destino y bloqueo de origen = destino', async () => {
  // Tarifa sin destinatario y viaje sin destinatario
  const t2 = await s.adminA.post('/api/maestros/tarifas', { cliente: s.cliente, destino: 'Ipiales', codMunicipio: '52356000', tarifaCliente: 900000, fleteConductor: 700000 });
  assert.equal(t2.status, 201, JSON.stringify(t2.body));
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-04', cliente: s.cliente, tarifaRef: t2.body._id, destino: 'Ipiales', placa: 'ABC123', conductor: s.conductor });
  // Sin sede del cliente en Ipiales: sería el mismo remitente y sede → se bloquea antes de enviar
  const p1 = (await s.manif.get(`/api/rndc/viajes/${v.body._id}/vista-previa`)).body;
  assert.ok(p1.remesa.problemas.some(x => x.includes('REM019')), JSON.stringify(p1.remesa.problemas));
  const antes = (await s.adminA.get('/api/rndc/config')).body.consecutivoRemesa;
  assert.equal((await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: CLAVE_RNDC })).status, 422);
  assert.equal((await s.adminA.get('/api/rndc/config')).body.consecutivoRemesa, antes, 'el rechazo por datos no consume consecutivo');
  // Con la sede del cliente registrada en Ipiales se usa sola
  await s.manif.post('/api/maestros/terceros', { tipoId: 'N', numId: '8001234567', nombres: 'Distribuidora Sur', sede: { codigo: '6', nombre: 'IPIALES' },
    direccion: 'Ipiales', codMunicipio: '52356000', celular: '3000000000', roles: ['destinatario'] });
  const p2 = (await s.manif.get(`/api/rndc/viajes/${v.body._id}/vista-previa`)).body;
  assert.deepEqual([p2.destinatario.numId, p2.destinatario.sede, p2.destinatario.origen], ['8001234567', '6', 'municipio']);
  assert.ok(!p2.remesa.problemas.some(x => x.includes('REM019')));
  await s.manif.del(`/api/viajes/${v.body._id}`);
});

test('MAN354: sede «EL PLATEADO» guardada en Argelia → se sugiere el centro poblado y el destino se puede fijar', async () => {
  await s.manif.post('/api/maestros/terceros', { tipoId: 'N', numId: '8001234567', nombres: 'Distribuidora Sur', sede: { codigo: '34', nombre: 'EL PLATEADO' },
    direccion: 'Calle principal', codMunicipio: '19050000', celular: '3000000001', roles: ['destinatario'] });
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-05', cliente: s.cliente, destino: 'Argelia', codDestino: '19050000', placa: 'ABC123', conductor: s.conductor, flete: 900000 });
  const p1 = (await s.manif.get(`/api/rndc/viajes/${v.body._id}/vista-previa`)).body;
  assert.deepEqual([p1.destinatario.sede, p1.destinatario.origen], ['34', 'municipio']);
  assert.match(p1.destinoManifiesto, /^19050000/);
  assert.equal(p1.destinoSugerido?.codigo, '19050006', JSON.stringify(p1.destinoSugerido));
  const p2 = (await s.manif.put(`/api/rndc/viajes/${v.body._id}/datos`, { codDestinoManifiesto: '19050006' })).body;
  assert.match(p2.destinoManifiesto, /^19050006 · EL PLATEADO \(ARGELIA\)/);
  assert.equal(p2.destinoSugerido, null);
  const vars = Object.fromEntries(p2.manifiesto.variables);
  assert.equal(vars.CODMUNICIPIODESTINOMANIFIESTO, '19050006');
  await s.manif.del(`/api/viajes/${v.body._id}`);
});

test('Revisión de datos: sedes en centros poblados, licencias y SOAT, con corrección en lote', async () => {
  const r1 = await s.manif.get('/api/maestros/revision');
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const sede = r1.body.items.find(x => x.categoria === 'sede' && x.referencia.includes('EL PLATEADO'));
  assert.ok(sede, JSON.stringify(r1.body.items.map(x => x.referencia)));
  assert.equal(sede.sugerencia.codigo, '19050006');
  assert.ok(r1.body.items.every(x => x.problema && x.referencia));
  assert.equal((await s.reportero.post('/api/maestros/revision/sedes', { cambios: [{ id: sede.id, codMunicipio: '19050006' }] })).status, 403);
  const ok = await s.manif.post('/api/maestros/revision/sedes', { cambios: [{ id: sede.id, codMunicipio: '19050006' }, { id: sede.id, codMunicipio: '99999999' }] });
  assert.deepEqual(ok.body, { corregidas: 1 });
  const r2 = (await s.manif.get('/api/maestros/revision')).body;
  assert.ok(!r2.items.some(x => x.categoria === 'sede' && String(x.id) === String(sede.id)), 'ya corregida');
});

test('Correo: cuenta SMTP cifrada, envío por cliente al aceptar el RNDC, trazabilidad y reintento', async () => {
  process.env.CORREO_TRANSPORTE = 'memoria';
  const { buzonPruebas } = await import('../src/services/correo.js');
  const { descifrar } = await import('../src/utils/cifrado.js');
  buzonPruebas.length = 0;
  const smtp = { activo: true, host: 'smtp.prueba.local', puerto: 587, seguridad: 'starttls', usuario: 'envios@transportesa.test',
    clave: 'Secreto-SMTP-1', remitenteNombre: 'Transportes A', remitenteCorreo: 'envios@transportesa.test' };
  assert.equal((await s.manif.put('/api/correo/config', smtp)).status, 403, 'solo el administrador configura el correo');
  assert.equal((await s.adminA.put('/api/correo/config', smtp)).status, 200);
  const cfg = (await s.adminA.get('/api/correo/config')).body;
  assert.equal(cfg.tieneClave, true);
  assert.equal(cfg.claveCifrada, undefined, 'la contraseña no se devuelve');
  const guardada = (await M.Empresa.findById(s.empresaA).select('+smtp.claveCifrada').lean()).smtp.claveCifrada;
  assert.notEqual(guardada, 'Secreto-SMTP-1');
  assert.equal(descifrar(guardada), 'Secreto-SMTP-1', 'cifrada y recuperable solo por el servidor');
  // Destinatarios y documentos del cliente
  const cfgCli = await s.adminA.put(`/api/correo/clientes/${s.cliente}`, { activo: true, destinatarios: ['logistica@cliente.test'], cc: ['copia@cliente.test'],
    documentos: { manifiesto: true, salida: true }, salida: {} });
  assert.equal(cfgCli.status, 200, JSON.stringify(cfgCli.body));
  // Sin aceptación del RNDC no se envía nada
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-05', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  assert.equal((await s.manif.post(`/api/correo/viajes/${v.body._id}/enviar`, {})).status, 409);
  await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: 'clave-incorrecta' });
  await new Promise(r => setTimeout(r, 300));
  assert.equal(buzonPruebas.length, 0, 'un rechazo del RNDC no envía correos');
  // Aceptados dos viajes del mismo cliente: la carta de salida sale por vehículo y los manifiestos quedan pendientes
  const ok = await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(ok.body.manifiesto.estado, 'aceptado', JSON.stringify(ok.body));
  const v2 = await s.reportero.post('/api/viajes', { fecha: '2026-11-05', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  const ok2 = await s.manif.post(`/api/rndc/viajes/${v2.body._id}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(ok2.body.manifiesto.estado, 'aceptado', JSON.stringify(ok2.body));
  // Nada sale sin aprobación: quedan «por aprobar» (2 manifiestos y 2 cartas de salida)
  await new Promise(r => setTimeout(r, 300));
  assert.equal(buzonPruebas.length, 0, 'sin aprobación no se envía ningún correo');
  assert.equal((await s.manif.get('/api/correo/envios?estado=por_aprobar')).body.length, 4);
  assert.equal((await s.manif.post('/api/correo/pendientes/enviar', {})).body.length, 0, 'el envío de pendientes no toma lo que falta aprobar');
  assert.equal((await s.reportero.post('/api/correo/aprobar', { viajes: [v.body._id] })).status, 403);
  // Al aprobar: un solo correo con los dos manifiestos del cliente y una carta de salida por vehículo
  const ap = (await s.manif.post('/api/correo/aprobar', { viajes: [v.body._id, v2.body._id] })).body;
  assert.equal(ap.aprobados, 4, JSON.stringify(ap));
  const grupo = ap.resultados.filter(x => x.tipo === 'manifiesto');
  assert.equal(grupo.length, 1);
  assert.equal(grupo[0].cantidad, 2);
  assert.equal(buzonPruebas.length, 3);
  const man = buzonPruebas.find(m => m.attachments?.length);
  assert.deepEqual(man.to, ['logistica@cliente.test']);
  assert.deepEqual(man.cc, ['copia@cliente.test']);
  assert.equal(man.attachments.length, 2);
  assert.match(man.subject, /^MANIFIESTOS DISTRIBUIDORA SUR - .+ \(2\)$/);
  // Solo números de manifiesto y remesa y el agradecimiento: sin placa, conductor, destino ni fecha
  assert.match(man.text, / {2}- Manifiesto M\d+ · Remesa R\d+\n/);
  assert.match(man.text, /Muchas gracias\./);
  assert.doesNotMatch(man.text, /Placa|Conductor|Destino|C\.C\./);
  assert.equal(man.attachments[0].contentType, 'application/pdf');
  assert.equal(man.attachments[0].content.subarray(0, 4).toString(), '%PDF');
  // Lo ya enviado no se repite
  assert.equal((await s.manif.post('/api/correo/pendientes/enviar', {})).body.length, 0);
  const sal = buzonPruebas.find(m => !m.attachments);
  assert.match(sal.subject, /^Autorización de salida ABC123 - Distribuidora Sur$/);
  assert.match(sal.text, /Señores:\nDISTRIBUIDORA SUR\n/);
  assert.match(sal.text, /  - Placa:      ABC123\n  - Conductor:  Pedro Pérez\n  - Destino:    Tumaco/);
  const envios = (await s.manif.get(`/api/correo/envios?viaje=${v.body._id}`)).body;
  assert.deepEqual(envios.map(x => x.estado).sort(), ['enviado', 'enviado']);
  const [m1, m2] = await Promise.all([v, v2].map(async x => (await s.manif.get(`/api/correo/envios?viaje=${x.body._id}`)).body.find(e => e.tipo === 'manifiesto')));
  assert.equal(String(m1.grupo), String(m2.grupo), 'salieron en el mismo correo');
  // Falla (cuenta desactivada): queda el error y se puede reintentar
  await s.adminA.put('/api/correo/config', { ...smtp, activo: false, clave: undefined });
  const manual = (await s.manif.post(`/api/correo/viajes/${v.body._id}/enviar`, { tipos: ['manifiesto'] })).body;
  assert.equal(manual[0].estado, 'error');
  assert.match(manual[0].error, /no está configurada/);
  await s.adminA.put('/api/correo/config', { ...smtp, clave: undefined });
  const re = await s.manif.post(`/api/correo/envios/${manual[0]._id}/reintentar`, {});
  assert.equal(re.body.estado, 'enviado', JSON.stringify(re.body));
  assert.equal(re.body.intentos, 2);
  // Reenvío individual: solo la carta de salida, al instante
  const antes = buzonPruebas.length;
  const soloSalida = (await s.manif.post(`/api/correo/viajes/${v.body._id}/enviar`, { tipos: ['salida'] })).body;
  assert.deepEqual(soloSalida.map(x => [x.tipo, x.estado]), [['salida', 'enviado']]);
  assert.equal(buzonPruebas.length, antes + 1);
  assert.ok(!buzonPruebas.at(-1).attachments, 'la carta de salida va sin el PDF del manifiesto');
  assert.equal((await s.reportero.get(`/api/correo/envios?viaje=${v.body._id}`)).status, 403);
  delete process.env.CORREO_TRANSPORTE;
});

test('RNDC: la numeración sale del RNDC y salta los números ya radicados', async () => {
  const usado = (await s.manif.get(`/api/viajes/${s.viaje}`)).body.remesa.numero;     // R500
  const r1 = await s.adminA.put('/api/rndc/config', { consecutivoRemesa: usado });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /ya se usó en el viaje/);
  const actual = (await s.adminA.get('/api/rndc/config')).body.consecutivoRemesa;
  // La numeración interna no manda: aunque se baje a R499, el número sale del RNDC
  assert.equal((await s.adminA.put('/api/rndc/config', { consecutivoRemesa: 'R499' })).status, 200);
  const nuevo = () => s.reportero.post('/api/viajes', { fecha: '2026-11-06', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  const a = await nuevo();
  const ra = (await s.manif.post(`/api/rndc/viajes/${a.body._id}/despachar`, { clave: CLAVE_RNDC })).body;
  const ultimoRndc = Math.max(...[...sim.estado.remesas.values()].filter(x => x.CONSECUTIVOREMESA !== ra.remesa.numero)
    .map(x => Number(String(x.CONSECUTIVOREMESA).match(/^R(\d+)$/)?.[1] || 0)));
  assert.equal(ra.remesa.numero, `R${ultimoRndc + 1}`, 'el siguiente al último radicado en el RNDC');
  assert.equal(ra.remesa.estado, 'aceptado', JSON.stringify(ra));
  // Números radicados por fuera de la plataforma (portal del Ministerio): se saltan sin preguntar
  const n = Number(ra.remesa.numero.slice(1));
  for (const x of [n + 1, n + 2]) sim.estado.remesas.set(`9001112221|R${x}`, { NUMNITEMPRESATRANSPORTE: '9001112221', CONSECUTIVOREMESA: `R${x}` });
  const b = await nuevo();
  const rb = (await s.manif.post(`/api/rndc/viajes/${b.body._id}/despachar`, { clave: CLAVE_RNDC })).body;
  assert.equal(rb.remesa.numero, `R${n + 3}`, JSON.stringify(rb.remesa));
  assert.notEqual(rb.remesa.numero, usado);
  assert.equal(rb.manifiesto.estado, 'aceptado', JSON.stringify(rb));
  // Se restablece la numeración que traían las demás pruebas
  await s.adminA.put('/api/rndc/config', { consecutivoRemesa: `R${Math.max(Number(actual.slice(1)), n + 4)}` });
});

test('RNDC: verificación previa contra el RNDC y consecutivos', async () => {
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-08', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  const r1 = await s.manif.post(`/api/rndc/viajes/${v.body._id}/verificar`, { clave: CLAVE_RNDC, forzar: true });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const roles = r1.body.resultados.map(x => x.rol);
  assert.ok(roles.includes('Vehículo') && roles.includes('Conductor') && roles.includes('Remitente'), JSON.stringify(r1.body.resultados));
  assert.ok(r1.body.resultados.every(x => ['verificado', 'no_existe', 'reciente'].includes(x.estado)), JSON.stringify(r1.body.resultados));
  assert.equal(r1.body.previa.verificacionVigente, true);
  // Lo recién verificado no se vuelve a consultar
  const r2 = (await s.manif.post(`/api/rndc/viajes/${v.body._id}/verificar`, { clave: CLAVE_RNDC })).body;
  assert.ok(r2.resultados.filter(x => x.estado !== 'no_existe').every(x => x.estado === 'reciente'), JSON.stringify(r2.resultados));
  assert.equal((await s.manif.post(`/api/rndc/viajes/${v.body._id}/verificar`, { clave: 'clave-incorrecta', forzar: true })).status, 400);
  // Consecutivos: último radicado en el RNDC frente al siguiente de la plataforma
  assert.equal((await s.manif.post('/api/rndc/consecutivos/verificar', { clave: CLAVE_RNDC })).status, 403, 'solo el administrador');
  const c = await s.adminA.post('/api/rndc/consecutivos/verificar', { clave: CLAVE_RNDC });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.match(c.body.remesa.siguientePlataforma, /^R\d+$/);
  assert.match(c.body.remesa.ultimoRndc, /^R\d+$/, JSON.stringify(c.body));
  assert.ok(Number(c.body.remesa.ultimoRndc.slice(1)) < Number(c.body.remesa.siguientePlataforma.slice(1)), 'la plataforma va adelante');
  assert.equal(c.body.remesa.sugerido, '');
  assert.ok(c.body.remesa.consultasPorNumero >= 1, 'pregunta al RNDC por el número siguiente');
  // Remesas radicadas por fuera de la plataforma (portal del Ministerio): el último real es el del RNDC
  const sig = Number(c.body.remesa.siguientePlataforma.slice(1));
  for (const n of [sig, sig + 1, sig + 2]) sim.estado.remesas.set(`9001112221|R${n}`, { NUMNITEMPRESATRANSPORTE: '9001112221', CONSECUTIVOREMESA: `R${n}` });
  const c2 = (await s.adminA.post('/api/rndc/consecutivos/verificar', { clave: CLAVE_RNDC })).body;
  assert.equal(c2.remesa.ultimoRndc, `R${sig + 2}`, JSON.stringify(c2.remesa));
  assert.equal(c2.remesa.sugerido, `R${sig + 3}`);
  for (const n of [sig, sig + 1, sig + 2]) sim.estado.remesas.delete(`9001112221|R${n}`);
  await s.manif.del(`/api/viajes/${v.body._id}`);
});

test('RNDC: tras un DUPLICADO se escriben a mano los números de remesa y manifiesto', async () => {
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-08', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  const id = v.body._id;
  const usado = (await s.manif.get(`/api/viajes/${s.viaje}`)).body.remesa.numero;
  const r1 = await s.manif.put(`/api/rndc/viajes/${id}/datos`, { numeroRemesa: usado });
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /ya lo tiene el viaje/);
  const cfg = (await s.adminA.get('/api/rndc/config')).body;
  const libreR = `R${cfg.siguienteRemesa + 40}`;
  const libreM = `M${cfg.siguienteManifiesto + 40}`;
  const r2 = await s.manif.put(`/api/rndc/viajes/${id}/datos`, { numeroRemesa: libreR.toLowerCase(), numeroManifiesto: libreM });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.numeros.remesa, libreR);
  assert.equal(r2.body.numeros.manifiesto, libreM);
  const d = (await s.manif.post(`/api/rndc/viajes/${id}/despachar`, { clave: CLAVE_RNDC })).body;
  assert.equal(d.remesa.numero, libreR);
  assert.equal(d.manifiesto.numero, libreM, JSON.stringify(d));
  const x = (await s.manif.get(`/api/viajes/${id}`)).body;
  assert.equal(x.numerosManuales.remesa, '');
  const cfg2 = (await s.adminA.get('/api/rndc/config')).body;
  assert.equal(cfg2.siguienteRemesa, cfg.siguienteRemesa + 41, 'el consecutivo avanza para no repetir el número');
  assert.equal(cfg2.siguienteManifiesto, cfg.siguienteManifiesto + 41);
});

test('RNDC: cumplir y anular varios viajes a la vez', async () => {
  const nuevo = async (placa) => {
    const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-10', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa, conductor: s.conductor });
    const d = (await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: CLAVE_RNDC })).body;
    assert.equal(d.manifiesto?.estado, 'aceptado', JSON.stringify(d));
    return v.body._id;
  };
  const [a, b, c, d] = [await nuevo('ABC123'), await nuevo('ABC123'), await nuevo('ABC123'), await nuevo('ABC123')];
  // Cumplido en lote: cada viaje con su fecha y su cantidad
  assert.equal((await s.reportero.post('/api/rndc/cumplir-lote', { clave: CLAVE_RNDC, viajes: [a, b] })).status, 403);
  const hora = { fecha: '', hora: '08:00' };
  const cum = await s.manif.post('/api/rndc/cumplir-lote', { clave: CLAVE_RNDC, viajes: [a, b], usarFechaViaje: true,
    remesa: { tipo: 'C', llegada: hora, entrada: { fecha: '', hora: '08:30' }, salida: { fecha: '', hora: '10:00' } },
    manifiesto: { tipo: 'C', fechaEntregaDocumentos: '2026-11-11' } });
  assert.equal(cum.status, 200, JSON.stringify(cum.body));
  assert.deepEqual(cum.body.map(x => x.ok), [true, true], JSON.stringify(cum.body));
  for (const id of [a, b]) assert.equal((await s.manif.get(`/api/viajes/${id}`)).body.estado, 'cumplido');
  // Anulación en lote de manifiesto y remesa
  const sinMotivo = await s.manif.post('/api/rndc/anular-lote', { clave: CLAVE_RNDC, viajes: [c, d], documento: 'ambos', motivo: 'V', observaciones: 'Cambio de vehiculo' });
  assert.equal(sinMotivo.status, 400);
  const an = await s.manif.post('/api/rndc/anular-lote', { clave: CLAVE_RNDC, viajes: [c, d], documento: 'ambos', motivo: 'V', motivoRemesa: 'D', observaciones: 'Cambio de vehiculo' });
  assert.deepEqual(an.body.map(x => x.ok), [true, true], JSON.stringify(an.body));
  for (const id of [c, d]) {
    const x = (await s.manif.get(`/api/viajes/${id}`)).body;
    assert.deepEqual([x.remesa.estado, x.manifiesto.estado], ['anulado', 'anulado']);
  }
});

test('RNDC: anulación de manifiesto por cambio de conductor y reemplazo', async () => {
  const r = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/anular`, { clave: CLAVE_RNDC, documento: 'manifiesto', motivo: 'C', observaciones: 'Cambio de conductor' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  let v = (await s.manif.get(`/api/viajes/${s.viaje2}`)).body;
  assert.equal(v.estado, 'remesa');
  assert.equal(v.manifiestoReemplazado, v.manifiesto.numero);
  // Con documento anulado sale de «Por enviar» y queda en «Anulados»
  const ids = async (q) => (await s.manif.get(`/api/viajes?estado=registrado,remesa&rndc=1&${q}`)).body.viajes.map(x => x._id);
  assert.ok(!(await ids('anulados=0')).includes(s.viaje2));
  assert.ok((await ids('anulados=1')).includes(s.viaje2));
  const nuevo = await s.manif.post(`/api/rndc/viajes/${s.viaje2}/despachar`, { clave: CLAVE_RNDC });
  assert.equal(nuevo.body.manifiesto.estado, 'aceptado', JSON.stringify(nuevo.body));
  assert.equal(nuevo.body.manifiesto.numero, `${v.manifiesto.numero}.`, 'el reemplazo conserva el número con un punto al final');
  const enviado = sim.estado.manifiestos.get(`9001112221|${nuevo.body.manifiesto.numero}`);
  assert.equal(enviado.MANNROMANIFIESTOTRANSBORDO, v.manifiesto.numero);
});

test('RNDC: anular manifiesto y remesa a la vez; el reemplazo conserva los números (R…A y M….)', async () => {
  const v = await s.reportero.post('/api/viajes', { fecha: '2026-11-07', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  const d = (await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: CLAVE_RNDC })).body;
  assert.equal(d.manifiesto.estado, 'aceptado', JSON.stringify(d));
  const sinMotivo = await s.manif.post(`/api/rndc/viajes/${v.body._id}/anular`, { clave: CLAVE_RNDC, documento: 'ambos', motivo: 'V', observaciones: 'Cambio de vehiculo' });
  assert.equal(sinMotivo.status, 400);
  const r = await s.manif.post(`/api/rndc/viajes/${v.body._id}/anular`, { clave: CLAVE_RNDC, documento: 'ambos', motivo: 'V', motivoRemesa: 'D', observaciones: 'Cambio de vehiculo' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  let x = (await s.manif.get(`/api/viajes/${v.body._id}`)).body;
  assert.equal(x.estado, 'registrado');
  assert.equal(x.remesa.estado, 'anulado');
  assert.equal(x.manifiesto.estado, 'anulado');
  const previa = (await s.manif.get(`/api/rndc/viajes/${v.body._id}/vista-previa`)).body;
  assert.deepEqual(previa.reemplazo, { remesa: `${d.remesa.numero}A`, manifiesto: `${d.manifiesto.numero}.` });
  const nuevo = (await s.manif.post(`/api/rndc/viajes/${v.body._id}/despachar`, { clave: CLAVE_RNDC })).body;
  assert.equal(nuevo.remesa.numero, `${d.remesa.numero}A`);
  assert.equal(nuevo.manifiesto.numero, `${d.manifiesto.numero}.`);
  assert.equal(nuevo.manifiesto.estado, 'aceptado', JSON.stringify(nuevo));
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

// ═══════════ Módulos de gestión de la plantilla ═══════════
test('Gestión: documentos vencidos no dejan registrar el viaje', async () => {
  const veh = await s.manif.post('/api/maestros/vehiculos', { placa: 'VEN111', configuracion: '50', configuracionNombre: '2', marca: '1', modelo: 2015, pesoVacio: 4000,
    soat: { numero: 'S9', vence: '2020-01-01', aseguradoraNit: '8600284155' }, propietario: { tipoId: 'C', numId: '12345678' }, tenedor: { tipoId: 'C', numId: '12345678' } });
  assert.equal(veh.status, 201, JSON.stringify(veh.body));
  const doc = (await s.manif.get(`/api/gestion/documentos?placa=VEN111&conductor=${s.conductor}`)).body;
  assert.ok(doc.vencidos.some(x => /SOAT de VEN111/.test(x)), JSON.stringify(doc));
  const v = await s.manif.post('/api/viajes', { fecha: '2026-11-12', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'VEN111', conductor: s.conductor });
  assert.equal(v.status, 422);
  assert.ok(v.body.detalles.some(x => /SOAT/.test(x)));
});

test('Gestión: préstamo, liquidación del conductor con descuento y contabilidad', async () => {
  // Préstamo de la plantilla: 279.980 al 0,1 % mensual en 1 cuota quincenal = 280.120
  const sim1 = (await s.conta.post('/api/gestion/prestamos/simular', { capital: 279980, tasaMensual: 0.1, nCuotas: 1, primeraCuota: '2026-11-15' })).body;
  assert.equal(sim1.valorCuota, 280120);
  const p = await s.conta.post('/api/gestion/prestamos', { conductor: s.conductor, placa: 'ABC123', concepto: 'Faltante de entregas', capital: 279980, tasaMensual: 0.1, nCuotas: 1, primeraCuota: '2026-11-15' });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.numero, 'PR-0001');
  assert.equal(p.body.cuotas[0].interes, 140);
  // Plan quincenal: 15 y último día del mes
  const p3 = (await s.conta.post('/api/gestion/prestamos/simular', { capital: 300000, tasaMensual: 2, nCuotas: 3, primeraCuota: '2026-11-15' })).body;
  assert.deepEqual(p3.cuotas.map(c => new Date(c.fecha).toISOString().slice(0, 10)), ['2026-11-15', '2026-11-30', '2026-12-15']);
  assert.equal(p3.cuotas.reduce((a, c) => a + c.capital, 0), 300000);
  // Viajes del conductor y su liquidación
  const v1 = await s.manif.post('/api/viajes', { fecha: '2026-11-12', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor, flete: 1000000, anticipo: 300000 });
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  const c = (await s.conta.post('/api/gestion/liq-conductores/calcular', { desde: '2026-11-12', hasta: '2026-11-30', placa: 'ABC123' })).body;
  const linea = c.lineas.find(l => String(l.viaje) === String(v1.body._id));
  assert.deepEqual([linea.flete, linea.anticipo, linea.retefuente, linea.fopat, linea.saldo], [1000000, 300000, 10000, 0, 690000]);
  assert.equal(c.prestamos['12345678'].total, 280120);
  const lq = await s.conta.post('/api/gestion/liq-conductores', { viajes: [v1.body._id], desde: '2026-11-12', hasta: '2026-11-30' });
  assert.equal(lq.status, 201, JSON.stringify(lq.body));
  const L = lq.body.liquidacion;
  assert.deepEqual([L.descuentoPrestamos, L.interesPrestamos, L.neto], [280120, 140, 690000 - 280120]);
  assert.equal((await s.conta.get('/api/gestion/prestamos')).body.find(x => x.numero === 'PR-0001').estado, 'PAGADO');
  // El viaje liquidado ya no se modifica
  assert.equal((await s.manif.put(`/api/viajes/${v1.body._id}`, { observaciones: 'x' })).status, 409);
  const pdf = await s.conta.get(`/api/gestion/liq-conductores/${L.numero}/pdf`);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  // Factura al cliente, cobro y pago al conductor
  const f = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: s.cliente, desde: '2026-11-12', hasta: '2026-11-12', retefuentePct: 1 });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  assert.equal(f.body.neto, f.body.total - f.body.retefuente);
  assert.equal((await s.conta.post('/api/gestion/contabilidad/cobros', { factura: f.body.numero })).status, 200);
  assert.equal((await s.conta.post('/api/gestion/contabilidad/pagos', { liquidacion: L.numero })).status, 200);
  assert.equal((await s.conta.get('/api/gestion/contabilidad/informes/cxp')).body.filas.length, 0, 'liquidación pagada');
  // Partida doble: activos = pasivos + patrimonio + resultado
  const b = (await s.conta.get('/api/gestion/contabilidad/informes/balance?hasta=2026-12-31')).body.datos;
  assert.equal(b.totalActivos, b.totalPasivos + b.totalPatrimonio + b.resultadoEjercicio);
  const diario = (await s.conta.get('/api/gestion/contabilidad/asientos?desde=2026-01-01&hasta=2026-12-31')).body;
  for (const a of diario) assert.equal(a.lineas.reduce((x, l) => x + l.debito, 0), a.lineas.reduce((x, l) => x + l.credito, 0), `asiento ${a.numero} cuadra`);
  // Cuenta inexistente: se rechaza
  assert.equal((await s.conta.post('/api/gestion/contabilidad/asientos', { fecha: '2026-11-20', debito: '9999', credito: '1110', valor: 10, concepto: 'Prueba' })).status, 400);
  assert.equal((await s.manif.post('/api/gestion/prestamos', {})).status, 403);
});

test('Gestión: relaciones, soporte interno MC/RC y remesas Dulces', async () => {
  const pago = (await s.conta.get('/api/gestion/relaciones/pago-conductores?desde=2026-11-01&hasta=2026-11-30')).body;
  assert.ok(pago.filas.some(x => x.cedula === '12345678'));
  assert.equal(pago.totales.total, pago.totales.flete + pago.totales.auxiliar);
  const ve = (await s.conta.get(`/api/gestion/relaciones/viajes?agrupar=placa&cliente=${s.cliente}&desde=2026-10-01&hasta=2026-11-30`)).body;
  const orden = ve.filas.map(x => `${x.placa}|${new Date(x.fecha).toISOString()}`);
  assert.deepEqual(orden, [...orden].sort(), 'por placa y fecha');
  assert.equal(ve.grupos.reduce((a, g) => a + g.totales.viajes, 0), ve.filas.length);
  for (const ag of ['general', 'empresa']) assert.equal((await s.conta.get(`/api/gestion/relaciones/viajes?agrupar=${ag}&formato=pdf`)).status, 200);
  assert.equal((await s.conta.get('/api/gestion/relaciones/viajes?agrupar=empresa&formato=xlsx')).status, 200);
  const inf = (await s.conta.get('/api/gestion/relaciones/informe?desde=2026-10-01&hasta=2026-11-30')).body;
  assert.equal(inf.totales.utilidad, inf.filas.reduce((a, x) => a + x.utilidad, 0));
  // Registro masivo: salta domingos y festivos (lunes 16-nov-2026 es festivo)
  const base = { cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Pasto urbano', placa: 'ABC123', conductor: s.conductor, desde: '2026-11-14', hasta: '2026-11-18', incluirSabados: false };
  const pv = (await s.manif.post('/api/gestion/relaciones/masivo/previa', base)).body;
  assert.deepEqual(pv.dias.map(x => x.motivo.split(':')[0]), ['sábado excluido', 'domingo', 'festivo', '', '']);
  const ms = await s.manif.post('/api/gestion/relaciones/masivo', base);
  assert.equal(ms.status, 201, JSON.stringify(ms.body));
  assert.equal(ms.body.creados.length, 2);
  assert.equal((await s.manif.post('/api/gestion/relaciones/masivo/previa', base)).body.dias.filter(x => x.registrar).length, 0, 'ya tienen viaje');
  assert.equal((await s.conta.get('/api/gestion/relaciones/pago-conductores?formato=xlsx')).status, 200);
  // Soporte interno de un viaje que no va al RNDC
  const v = await s.manif.post('/api/viajes', { fecha: '2026-11-13', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Pasto urbano', placa: 'ABC123', conductor: s.conductor, requiereManifiesto: false });
  const si = await s.manif.post(`/api/gestion/soportes/viajes/${v.body._id}`);
  assert.equal(si.status, 200, JSON.stringify(si.body));
  assert.match(si.body.mc, /^MC1\d{5}$/);
  assert.equal(si.body.rc, si.body.mc.replace('MC', 'RC'));
  assert.match(si.body.codigo, /^[0-9A-F]{16}$/);
  const otra = (await s.manif.post(`/api/gestion/soportes/viajes/${v.body._id}`)).body;
  assert.equal(otra.mc, si.body.mc, 'el número no cambia');
  const pdf = await s.manif.get(`/api/gestion/soportes/viajes/${v.body._id}/pdf`);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  // Remesas Dulces: importar la base y generar las remesas
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('BASE');
  ws.addRow(['VPL', 'FECHA', 'ZONA', 'PESO', 'MANIFIESTO', 'CONDUCTOR', 'PLACA', 'REMESA', 'COSTO']);
  ws.addRow([5501, new Date('2026-11-10'), 'Ipiales', 1200, 'M1', 'PEDRO PEREZ', 'ABC123', 'RD-1', 450000]);
  ws.addRow([5502, new Date('2026-11-10'), 'Tuquerres', 900, 'M2', 'PEDRO PEREZ GOMEZ', 'ABC123', 'RD-2', 380000]);
  const token = await login('manif@a.test');
  const imp = await api().post('/api/gestion/remesas-dulces/importar').set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.nuevos, 2);
  const rp = await s.manif.post('/api/gestion/remesas-dulces/pdf', { vpls: ['5501', '5502'] });
  assert.equal(rp.headers['content-type'], 'application/pdf');
  assert.equal((await s.manif.get('/api/gestion/remesas-dulces?pendientes=1')).body.length, 0, 'quedan marcadas como impresas');
});

test('Gestión: cierre de mes bloquea registrar y modificar ese mes', async () => {
  assert.equal((await s.conta.post('/api/gestion/cierres', { mes: '2026-09' })).status, 403, 'solo el administrador cierra');
  const r1 = await s.adminA.post('/api/gestion/cierres', { mes: '2026-09' });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const v = await s.manif.post('/api/viajes', { fecha: '2026-09-15', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor });
  assert.equal(v.status, 409);
  assert.match(v.body.error, /cerrado/);
  assert.equal((await s.conta.post('/api/gestion/contabilidad/asientos', { fecha: '2026-09-20', debito: '5195', credito: '1110', valor: 1000, concepto: 'Prueba' })).status, 409);
  assert.equal((await s.adminA.post('/api/gestion/cierres', { mes: '2099-01' })).status, 409, 'no se cierra un mes futuro');
  assert.equal((await s.adminA.post('/api/gestion/cierres/2026-09/reabrir')).status, 200);
  assert.equal((await s.manif.post('/api/viajes', { fecha: '2026-09-15', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Tumaco', placa: 'ABC123', conductor: s.conductor })).status, 201);
});

test('Rastreo Sur Track: habilitar, traer vehículos sin duplicar, activar, ver en vivo, recorrido y finalizar', async () => {
  const adm = s.adminA;
  assert.equal((await adm.get('/api/rastreo/estado')).body.habilitado, false);
  assert.equal((await adm.post('/api/rastreo/viajes/' + '0'.repeat(24) + '/activar')).status, 403, 'sin habilitar no se activa');
  assert.equal((await adm.put('/api/rastreo/configuracion', { surTrack: true, velocidadMaxima: 80, minutosSinSenal: 10 })).status, 200);
  assert.equal((await adm.get('/api/rastreo/estado')).body.habilitado, true);
  // Vehículos: ABC123 ya existe (se vincula), XYZ987 se crea; el de sin placa se omite
  const plan = (await adm.get('/api/rastreo/vehiculos/plan')).body;
  assert.deepEqual(plan.items.map(x => `${x.placa}:${x.vehiculo}`).sort(), ['ABC123:vincular', 'XYZ987:crear']);
  assert.equal(plan.sinPlaca.length, 1);
  const sinc = (await adm.post('/api/rastreo/vehiculos/sincronizar')).body;
  assert.equal(sinc.vehiculosCreados, 1); assert.equal(sinc.vehiculosVinculados, 1);
  const otra = (await adm.post('/api/rastreo/vehiculos/sincronizar')).body;
  assert.deepEqual(otra, { vehiculosCreados: 0, vehiculosVinculados: 0, conductoresCreados: 0 }, 'la segunda vez no duplica');
  const ana = await M.Tercero.findOne({ empresa: (await M.Empresa.findOne({ nit: '900111222' }))._id, numId: '55667788' }).lean();
  assert.equal(ana.nombres, 'ANA'); assert.equal(ana.apellido1, 'RUIZ');
  // Registrar un viaje con «Rastrear este viaje»
  const nuevo = (placa, rastrear) => adm.post('/api/viajes', { fecha: '2026-11-20', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Pasto urbano',
    placa, conductor: s.conductor, requiereManifiesto: false, rastrear });
  const v = await nuevo('ABC123', true);
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.errorRastreo, '');
  assert.equal(v.body.rastreo.activo, true); assert.equal(v.body.rastreo.estado, 'esperando');
  assert.match(v.body.rastreo.codigoExterno, /^TLS-\d+$/);
  await adm.post(`/api/rastreo/viajes/${v.body._id}/activar`);
  assert.equal(surTrack.viajes.size, 1, 'activar dos veces no duplica');
  let vivo = (await adm.get('/api/rastreo/en-vivo')).body;
  assert.equal(vivo.viajes[0].estado, 'esperando');
  const ext = v.body.rastreo.externoId;
  surTrack.viajes.get(ext).estado = 'aceptado';
  surTrack.activos = [{ viajeId: ext, lat: 1.21, lng: -77.28, velocidad: 25, rumbo: 90, hora: new Date().toISOString() },
    { viajeId: 'f'.repeat(24), codigo: 'N-1', chofer: 'Otro', lat: 1, lng: -77, velocidad: 0, hora: new Date().toISOString() }];
  const { limpiarCache } = await import('../src/services/rastreo/surtrack.js');
  limpiarCache();
  vivo = (await adm.get('/api/rastreo/en-vivo')).body;
  assert.equal(vivo.viajes[0].estado, 'en_ruta');
  assert.equal(vivo.viajes[0].ultima.velocidad, 90, 'm/s → km/h');
  assert.ok(vivo.viajes[0].alertas.some(a => a.startsWith('Exceso de velocidad')));
  assert.equal(vivo.externos.length, 1, 'rastreo de Cooespatrans sin enlazar');
  assert.equal((await s.adminB.get('/api/rastreo/en-vivo')).status, 403, 'otra empresa no lo ve');
  const rec = (await adm.get(`/api/rastreo/viajes/${v.body._id}/recorrido`)).body;
  assert.equal(rec.puntos.length, 2); assert.ok(rec.resumen.km > 1 && rec.resumen.km < 1.2, String(rec.resumen.km));
  // Enlazar un viaje propio con un rastreo que viene de Cooespatrans
  const v2 = await nuevo('XYZ987', false);
  surTrack.viajes.set('f'.repeat(24), { viajeId: 'f'.repeat(24), codigo: 'N-1', estado: 'aceptado' });
  const enl = await adm.post(`/api/rastreo/viajes/${v2.body._id}/enlazar`, { externoId: 'f'.repeat(24) });
  assert.equal(enl.status, 200, JSON.stringify(enl.body)); assert.equal(enl.body.origen, 'cooespatrans');
  assert.equal((await adm.post(`/api/rastreo/viajes/${v.body._id}/enlazar`, { externoId: 'f'.repeat(24) })).status, 409);
  // Finalizar: lo creado aquí se cierra en Sur Track; lo enlazado no se toca allá
  assert.equal((await adm.post(`/api/rastreo/viajes/${v.body._id}/finalizar`)).body.estado, 'finalizado');
  assert.equal(surTrack.viajes.get(ext).estado, 'completado');
  await adm.post(`/api/rastreo/viajes/${v2.body._id}/finalizar`);
  assert.equal(surTrack.viajes.get('f'.repeat(24)).estado, 'aceptado');
  // Placa que no está en Sur Track: el viaje se registra igual y se avisa
  const v3 = await nuevo('QWE111', true);
  assert.equal(v3.status, 201); assert.match(v3.body.errorRastreo, /no están registrados en Sur Track/);
  assert.equal(v3.body.rastreo?.activo || false, false);
});

test('Rastreo: modalidad solo destino (ruta sugerida) y con clientes (Excel, entregas), historial y recorrido guardado', async () => {
  const adm = s.adminA;
  const nuevo = (placa) => adm.post('/api/viajes', { fecha: '2026-11-21', cliente: s.cliente, tarifaRef: s.tarifa, destino: 'Ipiales', placa,
    conductor: s.conductor, requiereManifiesto: false });
  // Solo destino: sin coordenadas se buscan por el nombre; la ruta sugerida sale de la posición actual al destino
  const v1 = (await nuevo('ABC123')).body;
  const a1 = await adm.post(`/api/rastreo/viajes/${v1._id}/activar`, { modalidad: 'destino', destino: { nombre: 'Ipiales' } });
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  assert.equal(a1.body.modalidad, 'destino'); assert.equal(a1.body.destino.lat, 0.83);
  assert.equal(a1.body.eventos[0].tipo, 'activado');
  const ext1 = a1.body.externoId;
  surTrack.viajes.get(ext1).estado = 'aceptado';
  surTrack.activos = [{ viajeId: ext1, lat: 1.21, lng: -77.28, velocidad: 10, rumbo: 0, hora: new Date().toISOString() }];
  const { limpiarCache } = await import('../src/services/rastreo/surtrack.js');
  limpiarCache();
  const vivo = (await adm.get('/api/rastreo/en-vivo')).body.viajes.find(x => x._id === v1._id);
  assert.equal(vivo.modalidad, 'destino'); assert.equal(vivo.puntoDestino.nombre, 'Ipiales'); assert.equal(vivo.destino, 'Ipiales');
  const r1 = (await adm.get(`/api/rastreo/viajes/${v1._id}/recorrido`)).body;
  assert.equal(r1.ruta.length, 3, 'ruta sugerida al destino'); assert.ok(r1.eventos.some(e => e.tipo === 'inicio'));
  // Con clientes: plantilla, importar Excel, activar y ver las entregas del conductor
  const pl = await adm.get('/api/rastreo/clientes/plantilla').buffer(true).parse((res, cb) => { const d = []; res.on('data', c => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
  assert.equal(pl.status, 200);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('C');
  ws.addRow(['Cliente', 'Dirección', 'Ciudad', 'Teléfono', 'Factura', 'Valor']);
  ws.addRow(['Tienda Uno', 'Calle 1 # 2-3', 'Pasto', '3001112233', 'F-1', '150.000']);
  ws.addRow(['Tienda Dos', 'Cra 4 # 5-6', 'Pasto', '', 'F-2', 80000]);
  ws.addRow(['', '', '', '', '', '']);
  const imp = await adm.post('/api/rastreo/clientes/importar').set('Content-Type', 'application/octet-stream').send(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.equal(imp.body.clientes.length, 2); assert.equal(imp.body.clientes[0].valor, 150000); assert.equal(imp.body.clientes[0].factura, 'F-1');
  const v2 = (await nuevo('XYZ987')).body;
  assert.equal((await adm.post(`/api/rastreo/viajes/${v2._id}/activar`, { modalidad: 'clientes', clientes: [] })).status, 400, 'sin clientes no');
  const a2 = await adm.post(`/api/rastreo/viajes/${v2._id}/activar`, { modalidad: 'clientes', clientes: imp.body.clientes });
  assert.equal(a2.status, 200, JSON.stringify(a2.body));
  assert.equal(a2.body.clientes.length, 2); assert.ok(a2.body.clientes.every(c => c.externoId), 'vinculados con Sur Track');
  assert.equal(a2.body.destino?.nombre || '', '', 'con clientes no se guarda destino');
  const st2 = surTrack.viajes.get(a2.body.externoId);
  assert.equal(st2.clientesSt.length, 2, 'los clientes llegan a Sur Track');
  // Agregar un cliente antes de que el conductor acepte (reemplaza, no duplica)
  const p2 = await adm.put(`/api/rastreo/viajes/${v2._id}/paradas`, { modalidad: 'clientes', clientes: [...imp.body.clientes, { nombre: 'Tienda Tres', direccion: 'Cl 9' }] });
  assert.equal(p2.status, 200); assert.equal(st2.clientesSt.length, 3); assert.equal(p2.body.clientes.length, 3);
  // El conductor acepta y entrega a la Tienda Uno
  st2.estado = 'aceptado';
  st2.clientesSt[0].estadoEntrega = 'completa'; st2.clientesSt[0].valorRecibido = 150000;
  limpiarCache();
  const r2 = (await adm.get(`/api/rastreo/viajes/${v2._id}/recorrido`)).body;
  assert.equal(r2.clientes.find(c => c.nombre === 'Tienda Uno').estadoEntrega, 'completa');
  assert.ok(r2.eventos.some(e => e.tipo === 'entrega' && e.detalle.startsWith('Tienda Uno')));
  assert.equal((await adm.put(`/api/rastreo/viajes/${v2._id}/paradas`, { modalidad: 'clientes', clientes: [{ nombre: 'X' }] })).status, 409, 'aceptado: ya no se cambian');
  // Terminar: el recorrido queda guardado en Translogística y el historial lo muestra con su resumen
  await adm.post(`/api/rastreo/viajes/${v2._id}/finalizar`);
  const h = (await adm.get('/api/rastreo/historial?desde=2020-01-01')).body;
  const fila = h.items.find(x => x._id === v2._id);
  assert.equal(fila.activo, false); assert.equal(fila.modalidad, 'clientes'); assert.equal(fila.clientes, 3); assert.equal(fila.entregados, 1);
  assert.ok(fila.km > 1);
  surTrack.viajes.clear();   // aunque Sur Track ya no tenga el viaje, el historial conserva el recorrido
  const g = (await adm.get(`/api/rastreo/viajes/${v2._id}/recorrido`)).body;
  assert.equal(g.puntos.length, 2); assert.ok(g.eventos.some(e => e.tipo === 'finalizado'));
  assert.equal((await adm.get('/api/rastreo/historial')).body.items.some(x => x._id === v1._id), false, 'el historial no muestra rastreos en curso');
  assert.equal((await adm.get('/api/rastreo/historial?placa=xyz-987')).body.items.every(x => x.placa === 'XYZ987'), true);
  assert.ok(((await s.adminB.get('/api/rastreo/historial')).body.items || []).every(x => x._id !== v2._id), 'otra empresa no ve el historial');
  await adm.post(`/api/rastreo/viajes/${v1._id}/finalizar`);
});
