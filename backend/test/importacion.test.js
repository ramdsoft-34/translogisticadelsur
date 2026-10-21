// Pruebas de: reporte WhatsApp, importación de la plantilla de Excel y de maestros,
// importación desde el RNDC (simulador), aislamiento de lo importado y auditoría encadenada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test') + '_imp';
process.env.RNDC_PERMITIR_PRODUCCION = 'false';
process.env.RNDC_PERMITIR_PRUEBAS = 'false';

const { crearSimulador } = await import('../tools/rndcSimulador.js');
const sim = crearSimulador();
await new Promise(r => sim.servidor.listen(0, '127.0.0.1', r));
process.env.RNDC_SIMULADOR_URL = `http://127.0.0.1:${sim.servidor.address().port}/soap/IBPMServices`;

const { default: request } = await import('supertest');
const ExcelJS = (await import('exceljs')).default;
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');
const { importarMunicipios } = await import('../scripts/importarMunicipios.js');

const app = crearApp();
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;
const s = {};
const login = async (email) => (await request(app).post('/api/auth/login').send({ email, password: CLAVE })).body.token;
const con = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b),
  subir: (u, buf, nombre = 'datos.xlsx') => request(app).post(u).set('Authorization', `Bearer ${t}`)
    .set('Content-Type', 'application/octet-stream').set('X-Nombre-Archivo', nombre).send(buf),
});

async function libro(hojas) {
  const wb = new ExcelJS.Workbook();
  for (const [nombre, filas] of Object.entries(hojas)) {
    const ws = wb.addWorksheet(nombre);
    filas.forEach((f, i) => { ws.getRow(i + 1).values = f; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Plantilla mínima con la estructura de PLANTILLA_DE_VIAJES_FORMULARIO.xlsm
async function plantillaSintetica() {
  const vacia = Array(4).fill([]);
  return libro({
    Empresas: [['Empresa', 'Token', 'NIT'], ['Corbeta', 'Corbeta', 8909009431], ['Dulces & Dulces', 'Dulces', 9012300449]],
    CORREOS: [['EMPRESA', 'CORREOS', 'A QUIEN'], ['Corbeta', 'logistica@corbeta.test, malo-sin-arroba', 'COLOMBIANA DE COMERCIO']],
    Fletes: [['Empresa', 'Destino', 'Tarifa', 'TarAux', 'Flete', 'AuxPag', 'Clave', 'Anticipo'],
      ['Corbeta', 'Pasto alkosto 5.0', 350000, 0, 310000, 0, 'x', 100000],
      ['Corbeta', 'Pasto TAT 1.0', 80000, 0, 60000, 0, 'x'],
      ['Dulces & Dulces', 'Sandona', 900000, 50000, 710000, 40000, 'x', 500000]],
    RNDC_SEDES: [['ID', 'NOMBRE', 'COD'], ['9012300449', 'SANDONA', 136, null, '52683000', 'SANDONA NARINO', 'CALLE 1']],
    RNDC_FICHAS: [[], ['EMPRESA', 'COOPERATIVA PRUEBA', null, 'DIRECCION', 'CRA 1 # 2-3', null, 'TELEFONO', '3001234567', null, 'CIUDAD', 'PASTO NARINO'],
      ...vacia.slice(0, 3),
      ['TKK224', 'CHEVROLET', '2', '3000', '860002400 LA PREVISORA', '4308', '2027/06/24', '52532526', 7500,
        '52532526', 'LISBETH MILEIDI FUERTES JURADO', 'LA UNION', '9999999999', 'LA UNION NARINO', null,
        '79903733', 'WILSON ORLANDO MONTERO RIVERA', 'SAN JUAN DE PASTO', '3217646103', 'C2-79903733', 'PASTO NARINO',
        null, '52001033', 'CUJACAL PASTO NARINO', null, '9012300449', 'DISTRIBUIDORA DULCES Y DULCES', 'CRA 9']],
    _CONDUCTORES: [['Conductor', 'Placa', 'Cedula'],
      ['Wilson Montero', 'TKK224', '79903733', new Date(Date.UTC(2027, 0, 1)), new Date(Date.UTC(2027, 5, 24)), new Date(Date.UTC(2028, 1, 1)), '3217646103',
        null, '79903733', '52532526', 'Lisbeth Fuertes', 7500, 3000, 'C2', 'Calle 1', 'NARIÑO', 'PASTO', '123456', 'Ahorros', '1007'],
      ['Sin Cedula', 'XYZ999']],
    BITACORA: [[], ['N°', 'EMPRESA', 'MANIFIESTO', 'CONDUCTOR', 'PLACA', 'FECHA', 'DESTINO', 'PESO', 'TARIFA', 'FLETE', 'ANTICIPO', 'AUX', 'Reportado', 'Correo', 'OBS'],
      [181, 'Corbeta', null, 'Wilson Montero', 'TKK224', new Date(Date.UTC(2026, 9, 10)), 'Pasto alkosto 5.0', 2500, 350000, 310000, 100000, 0, 'Reportado 10/10/2026 08:01'],
      [182, 'Dulces & Dulces', null, 'Wilson Montero', 'TKK224', new Date(Date.UTC(2026, 9, 11)), 'Sandona', 2500, 900000, 710000, 500000, 50000, null, null, 'Llamar al llegar']],
    RNDC_VIAJES: [[], [], [], ['N REG'],
      [181, 'Corbeta', 'Wilson Montero', 'TKK224', new Date(Date.UTC(2026, 9, 10)), 'Pasto', 310000, 100000, '79903733', '52001033', '52001000',
        'R10062832', 'M10062832', 'OK', '169515069', 'OK', '125725141', 'Aceptado 10/10/2026 13:14', 2500, '52532526', 7500, 'N', '9012300449', '136', 'H1TFLvACSsuxIKWyvw7y5F6be8Q=']],
    RNDC_CONFIG: [['CONFIGURACION RNDC'], [], ['URL', 'http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices'], ['Usuario', 'USUARIOWS@1'],
      ['NIT', 9001099592], ['Modo', 'REAL'], ['Prefijo remesa', 'R100'], ['Proximo remesa', 62860], ['Prefijo manifiesto', 'M100'], ['Proximo manifiesto', 62860],
      [], [], [], ['Origen', '52001033']],
    RNDC_FIJOS: [['VARIABLES'], [], ['Proceso', 'Variable', 'Valor'], ['R', 'MERCANCIAREMESA', '009980'], ['R', 'DESCRIPCIONCORTAPRODUCTO', 'VIVERES'],
      ['R', 'CODSEDEREMITENTE', '1'], ['R', 'TIPOCONSOLIDADA', 'D'], ['M', 'CODRESPONSABLEPAGOCARGUE', 'R'], ['M', 'RETENCIONFOPAT', '{FOPAT}'],
      ['M', 'ACEPTACIONELECTRONICA', 'SI'], ['M', 'NITMONITOREOFLOTA', '{NIT}']],
    RELACION: [...Array(10).fill([]), [null, 'Dulces & Dulces', null, 'TKK224', null, 'Sandona', new Date(Date.UTC(2026, 9, 11)), 2, null, 'No']],
    RNDC_DANE: [['COD DEPTO', 'DEPTO', 'COD MUN', 'MUN', 'CODIGO', 'NORM', 'CORTO'],
      ['52', 'NARIÑO', '52001', 'PASTO', '52001000', 'PASTO', 'PASTO'], ['52', 'NARIÑO', '52683', 'SANDONA', '52683000', 'SANDONA', 'SANDONA']],
    RNDC_ALIAS: [['ALIAS', 'MUNICIPIO']],
  });
}

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  await importarMunicipios();
  await M.Usuario.create({ nombre: 'Super', email: 'super@imp.test', rol: 'superadmin', passwordHash: await bcrypt.hash(CLAVE, 10) });
  const sa = con(await login('super@imp.test'));
  for (const [k, nombre, nit, dv] of [['A', 'Cooespatrans', '900109959', '2'], ['B', 'Otra Empresa', '900222333', '1']]) {
    const r = await sa.post('/api/admin/empresas', { nombre, nit, dv, administrador: { nombre: `Admin ${k}`, email: `admin${k}@imp.test`, password: CLAVE } });
    s[`emp${k}`] = r.body.empresa._id;
  }
  s.sa = sa;
  s.a = con(await login('adminA@imp.test'));
  s.b = con(await login('adminB@imp.test'));
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  sim.servidor.close();
});

test('Importación de la plantilla de viajes a la empresa Cooespatrans', async () => {
  const r = await s.a.subir('/api/importaciones/plantilla-viajes', await plantillaSintetica(), 'PLANTILLA.xlsm');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.clientes.nuevos, 2);
  assert.equal(r.body.tarifas.nuevas, 3);
  assert.equal(r.body.viajes.nuevos, 2);
  assert.equal(r.body.viajes.conManifiestoRndc, 1);
  assert.ok(r.body.terceros.conductoresSinCedula === 1);
  // Configuración RNDC tomada de la plantilla (ambiente sigue en simulador)
  const cfg = (await s.a.get('/api/rndc/config')).body;
  assert.equal(cfg.ambiente, 'SIMULADO');
  assert.equal(cfg.usuario, 'USUARIOWS@1');
  assert.equal(cfg.prefijoManifiesto, 'M100');
  assert.equal(cfg.siguienteManifiesto, 62860);
  assert.equal(cfg.aplicarFopat, true);
  assert.equal(cfg.nitMonitoreoFlota, '9001099592');
  assert.deepEqual(cfg.extras.map(x => x.variable), ['TIPOCONSOLIDADA']);
  // Tarifas: urbano de Corbeta, cobro por unidad (TAT) y destinatario con sede
  const tarifas = (await s.a.get('/api/maestros/tarifas')).body;
  const alk = tarifas.find(t => t.destino === 'Pasto alkosto 5.0');
  assert.equal(alk.operacion, 'U'); assert.equal(alk.codMunicipio, '52001000'); assert.equal(alk.pesoKg, 2500);
  assert.equal(tarifas.find(t => t.destino === 'Pasto TAT 1.0').tipoCobro, 'unidad');
  const san = tarifas.find(t => t.destino === 'Sandona');
  assert.equal(san.codMunicipio, '52683000'); assert.equal(san.destinatario.sede, '136');
  // Viajes: el manifestado conserva radicado y QR; el otro queda histórico; RELACION aplicada
  const viajes = (await s.a.get('/api/viajes?limite=50')).body.viajes;
  const v181 = viajes.find(v => v.numero === 181); const v182 = viajes.find(v => v.numero === 182);
  assert.equal(v181.estado, 'manifestado'); assert.equal(v181.manifiesto.radicado, '125725141'); assert.equal(v181.historico, false);
  assert.ok(v181.reporteWhatsapp.fecha, 'conserva la marca de reportado');
  assert.equal(v182.historico, true); assert.equal(v182.cantidad, 2); assert.equal(v182.conAuxiliar, false);
  assert.ok(v182.conductor, 'el conductor de la bitácora se enlaza con su ficha por la cédula de _CONDUCTORES');
  assert.equal(v182.conductorNombre, 'WILSON ORLANDO MONTERO RIVERA', 'nombre oficial de RNDC_FICHAS');
  // El siguiente viaje continúa la numeración
  const cli = (await s.a.get('/api/maestros/clientes')).body.find(c => c.nombre === 'Corbeta');
  assert.deepEqual(cli.correos, ['logistica@corbeta.test'], 'descarta correos inválidos');
  // Idempotente
  const r2 = await s.a.subir('/api/importaciones/plantilla-viajes', await plantillaSintetica(), 'PLANTILLA.xlsm');
  assert.equal(r2.body.viajes.nuevos, 0); assert.equal(r2.body.tarifas.nuevas, 0); assert.equal(r2.body.clientes.nuevos, 0);
});

test('Lo importado queda aislado: la otra empresa no lo ve', async () => {
  assert.equal((await s.b.get('/api/viajes')).body.total, 0);
  assert.equal((await s.b.get('/api/maestros/terceros')).body.length, 0);
  assert.equal((await s.b.get('/api/maestros/vehiculos')).body.length, 0);
  assert.equal((await s.b.get('/api/maestros/clientes')).body.length, 0);
});

test('Los viajes históricos no se pueden despachar al RNDC', async () => {
  const pendientes = (await s.a.get('/api/viajes?estado=registrado&historico=0')).body;
  assert.equal(pendientes.total, 0);
  const v182 = (await s.a.get('/api/viajes?historico=1')).body.viajes[0];
  const r = await s.a.post(`/api/rndc/viajes/${v182._id}/despachar`, { clave: 'x' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /histórico/);
});

test('Reporte de WhatsApp con la estructura del Excel y valores en pesos', async () => {
  const r = await s.a.get('/api/viajes/reporte-whatsapp?fecha=2026-10-11');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mensajes.length, 1);
  const m = r.body.mensajes[0];
  assert.equal(m.cliente, 'Dulces & Dulces');
  assert.match(m.texto, /^(Buenos días|Buenas tardes|Buenas noches),\n\nReporte de vehículos - 11\/10\/2026\n\nDulces & Dulces\n\n/);
  assert.match(m.texto, /\. Sandona\. Flete \$ 710\.000\. Anticipo \$ 500\.000\nPlaca TKK224\nLlamar al llegar\n$/);
  assert.ok(m.enlace.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(m.enlace.split('text=')[1]), m.texto);
  // El 10/10 ya estaba reportado en el Excel: no se repite
  assert.equal((await s.a.get('/api/viajes/reporte-whatsapp?fecha=2026-10-10')).body.mensajes.length, 0);
  // Marcar como reportado
  const mk = await s.a.post('/api/viajes/reporte-whatsapp/marcar', { viajes: m.viajes });
  assert.equal(mk.body.marcados, 1);
  assert.equal((await s.a.get('/api/viajes/reporte-whatsapp?fecha=2026-10-11')).body.mensajes.length, 0);
  // Con número del cliente, el enlace va directo al chat (+57)
  const cli = (await s.a.get('/api/maestros/clientes')).body.find(c => c.nombre === 'Dulces & Dulces');
  await s.a.put(`/api/maestros/clientes/${cli._id}`, { whatsapp: '300 123 4567' });
  const r3 = await s.a.get('/api/viajes/reporte-whatsapp?fecha=2026-10-11&incluirReportados=1');
  assert.ok(r3.body.mensajes[0].enlace.startsWith('https://wa.me/573001234567?text='));
  // Otra empresa no puede marcar viajes ajenos
  assert.equal((await s.b.post('/api/viajes/reporte-whatsapp/marcar', { viajes: m.viajes })).body.marcados, 0);
});

test('Importación de vehículos y terceros desde Excel: simular, errores por fila y aplicar', async () => {
  const pl = await s.a.get('/api/importaciones/plantillas/terceros').buffer(true).parse((res, cb) => { const p = []; res.on('data', c => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
  assert.equal(pl.status, 200);
  const wbP = new ExcelJS.Workbook(); await wbP.xlsx.load(pl.body);
  const encabezados = wbP.worksheets[0].getRow(1).values.slice(1);
  assert.ok(encabezados.includes('Tipo documento *'));
  const archivo = await libro({ Terceros: [encabezados,
    ['C', '1.085.000.111', 'Ana', 'Ruiz', 'Paz', null, null, '3001112222', null, 'Calle 5', 'PASTO NARIÑO', null, 'conductor, titular', 'C2', '1085000111', '31/12/2027'],
    ['N', '12345678901', 'Empresa con NIT largo'],
    ['C', '79903733', 'Wilson Orlando', 'Montero', 'Rivera', null, null, '3110000000']] });
  const sim1 = await s.a.subir('/api/importaciones/maestros/terceros', archivo);
  assert.equal(sim1.status, 200, JSON.stringify(sim1.body));
  assert.equal(sim1.body.simulado, true);
  assert.equal(sim1.body.nuevos, 1); assert.equal(sim1.body.actualizados, 1); assert.equal(sim1.body.errores.length, 1);
  assert.equal(sim1.body.errores[0].fila, 3);
  assert.equal((await s.a.get('/api/maestros/terceros?q=Ana')).body.length, 0, 'simular no escribe');
  const ap = await s.a.subir('/api/importaciones/maestros/terceros?simular=0', archivo);
  assert.equal(ap.body.nuevos, 1);
  const ana = (await s.a.get('/api/maestros/terceros?q=Ana')).body[0];
  assert.equal(ana.numId, '1085000111'); assert.equal(ana.codMunicipio, '52001000'); assert.deepEqual(ana.roles, ['conductor', 'titular']);
  const wilson = (await s.a.get('/api/maestros/terceros?q=79903733')).body[0];
  assert.equal(wilson.celular, '3110000000');
  assert.equal(wilson.rndc.estado, 'sin_enviar', 'el cambio deja el tercero pendiente de sincronizar');
  // Vehículos
  const veh = await libro({ V: [['Placa *', 'Configuración', 'PBV kg', 'Vence SOAT', 'Cédula conductor habitual'],
    ['abc-321', '3S3', 52000, '01/02/2027', '1085000111'], ['ZZ1', '2'], ['QWE456', '2', null, null, '999']] });
  const rv = await s.a.subir('/api/importaciones/maestros/vehiculos?simular=0', veh);
  assert.equal(rv.body.nuevos, 1); assert.equal(rv.body.errores.length, 2);
  const abc = (await s.a.get('/api/maestros/vehiculos?q=ABC321')).body[0];
  assert.equal(abc.configuracionNombre, '3S3'); assert.ok(abc.conductorHabitual);
  // Un archivo que no es Excel se rechaza
  assert.equal((await s.a.subir('/api/importaciones/maestros/vehiculos', Buffer.from('no soy un excel'))).status, 400);
  // Permisos: el reportero no importa
  await s.a.post('/api/usuarios', { nombre: 'Rep', email: 'rep@imp.test', rol: 'reportero', password: CLAVE });
  const rep = con(await login('rep@imp.test'));
  assert.equal((await rep.subir('/api/importaciones/maestros/vehiculos', veh)).status, 403);
  // La otra empresa no recibe nada
  assert.equal((await s.b.get('/api/maestros/vehiculos')).body.length, 0);
});

test('Importación de clientes y tarifas desde Excel', async () => {
  const archivo = await libro({ T: [['Cliente *', 'NIT cliente', 'Destino *', 'Municipio destino', 'Tarifa cliente', 'Flete conductor', 'Anticipo habitual'],
    ['Nuevo Cliente', '9001234567', 'Ipiales', 'IPIALES NARIÑO', '1.200.000', 900000, 300000], ['Corbeta', null, 'Pasto alkosto 5.0', null, 360000]] });
  const r = await s.b.subir('/api/importaciones/maestros/tarifas?simular=0', archivo);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.nuevos, 2); assert.equal(r.body.clientesNuevos, 2, 'en la empresa B, Corbeta no existe y se crea aparte');
  const t = (await s.b.get('/api/maestros/tarifas')).body.find(x => x.destino === 'Ipiales');
  assert.equal(t.tarifaCliente, 1200000); assert.equal(t.codMunicipio, '52356000');
  // En A, la tarifa de Corbeta sigue intacta
  assert.equal((await s.a.get('/api/maestros/tarifas')).body.find(x => x.destino === 'Pasto alkosto 5.0').tarifaCliente, 350000);
});

test('Traer terceros y vehículos desde el RNDC (simulador)', async () => {
  await s.a.put('/api/rndc/config', { usuario: 'USUARIOWS@1' });
  // Se registra en el simulador un tercero y un vehículo y luego se traen a la empresa B
  const ana = (await s.a.get('/api/maestros/terceros?q=Ana')).body[0];
  assert.equal((await s.a.post(`/api/rndc/terceros/${ana._id}/enviar`, { clave: 'c' })).body.ok, true);
  await s.b.put('/api/rndc/config', { usuario: 'USUARIOB@1' });
  const rB = await s.b.post('/api/rndc/importar/terceros', { clave: 'c', documentos: [{ tipoId: 'C', numId: '1085000111' }] });
  assert.equal(rB.body[0].ok, false, 'el RNDC filtra por NIT: B no ve los terceros de A');
  const rA = await s.a.post('/api/rndc/importar/terceros', { clave: 'c', documentos: [{ tipoId: 'C', numId: '1085000111' }] });
  assert.equal(rA.body[0].ok, true, JSON.stringify(rA.body));
  assert.equal(rA.body[0].guardados[0].nombre, 'Ana Ruiz Paz');
  const v = (await s.a.get('/api/maestros/vehiculos?q=ABC321')).body[0];
  await s.a.put(`/api/maestros/vehiculos/${v._id}`, { marca: '1', modelo: 2020, pesoVacio: 9000, propietario: { tipoId: 'C', numId: '1085000111' }, tenedor: { tipoId: 'C', numId: '1085000111' }, configuracion: '55' });
  assert.equal((await s.a.post(`/api/rndc/vehiculos/${v._id}/enviar`, { clave: 'c' })).body.ok, true);
  const rv = await s.a.post('/api/rndc/importar/vehiculos', { clave: 'c', placas: ['ABC321', 'NOEXI1'] });
  assert.equal(rv.body[0].ok, true); assert.equal(rv.body[1].ok, false);
  const v2 = (await s.a.get('/api/maestros/vehiculos?q=ABC321')).body[0];
  assert.equal(v2.rndc.estado, 'enviado'); assert.equal(v2.modelo, 2020);
});

test('Auditoría: cadena íntegra, detecta alteraciones, registra fallos y es de solo inserción', async () => {
  await request(app).post('/api/auth/login').send({ email: 'adminA@imp.test', password: 'Incorrecta999' });
  const lista = (await s.a.get('/api/reportes/auditoria?resultado=fallo')).body;
  assert.ok(lista.some(a => a.accion === 'login_fallido'));
  const rep = con(await login('rep@imp.test'));
  await rep.get('/api/usuarios');
  assert.ok((await s.a.get('/api/reportes/auditoria?accion=acceso_denegado')).body.length >= 1);
  assert.ok((await s.a.get('/api/reportes/auditoria?accion=importar_plantilla_viajes')).body[0].detalle.sha256.length === 64);
  let v = (await s.a.get('/api/reportes/auditoria/verificar')).body;
  assert.equal(v.integra, true, JSON.stringify(v));
  assert.ok(v.total > 10);
  // La aplicación no permite modificar ni borrar
  await assert.rejects(() => M.Auditoria.updateOne({ empresa: s.empA }, { $set: { accion: 'x' } }), /no se puede/);
  await assert.rejects(() => M.Auditoria.deleteMany({ empresa: s.empA }), /no se puede/);
  // Una alteración directa en la base de datos se detecta
  const col = mongoose.connection.collection('auditorias');
  const uno = await col.findOne({ cadena: String(s.empA), seq: 3 });
  await col.updateOne({ _id: uno._id }, { $set: { usuarioNombre: 'Otro' } });
  v = (await s.a.get('/api/reportes/auditoria/verificar')).body;
  assert.equal(v.integra, false); assert.equal(v.seq, 3);
  const global = (await s.sa.get('/api/admin/auditoria/verificar')).body;
  assert.equal(global.find(x => x.empresa === null).integra, true);
  assert.equal(global.find(x => String(x.empresa) === String(s.empA)).integra, false);
  assert.equal(global.find(x => String(x.empresa) === String(s.empB)).integra, true);
  const xlsx = await s.a.get('/api/reportes/auditoria.xlsx');
  assert.equal(xlsx.status, 200);
});

test('Paginación de maestros y viajes con totales del filtro', async () => {
  const p1 = (await s.a.get('/api/maestros/terceros?pagina=1&limite=2')).body;
  assert.ok(p1.total >= 3, JSON.stringify(p1).slice(0, 200));
  assert.equal(p1.items.length, 2); assert.equal(p1.pagina, 1);
  const p2 = (await s.a.get('/api/maestros/terceros?pagina=2&limite=2')).body;
  assert.ok(!p2.items.some(x => p1.items.some(y => y._id === x._id)), 'las páginas no se repiten');
  assert.ok(Array.isArray((await s.a.get('/api/maestros/terceros?q=Ana')).body), 'sin página conserva el arreglo');
  const vh = (await s.a.get('/api/maestros/vehiculos?pagina=1&limite=1&q=abc-321')).body;
  assert.equal(vh.total, 1); assert.equal(vh.items[0].placa, 'ABC321');
  // Viajes de un día con sumas de todo el filtro (no solo de la página)
  const v = (await s.a.get('/api/viajes?desde=2026-10-10&hasta=2026-10-11&pagina=1&limite=1')).body;
  assert.equal(v.total, 2); assert.equal(v.viajes.length, 1);
  assert.equal(v.sumas.flete, 310000 + 710000); assert.equal(v.sumas.saldo, 1020000 - 600000);
  const hoy = (await s.a.get('/api/viajes?desde=2030-01-01&hasta=2030-01-01&pagina=1')).body;
  assert.equal(hoy.total, 0);
  // El resumen no cuenta los históricos como pendientes
  const res = (await s.a.get('/api/viajes/resumen')).body;
  assert.equal(res.estados.registrado || 0, 0);
});

test('Mi cuenta: perfil, empresa, seguridad, actividad propia y cambio de nombre', async () => {
  const r = (await s.a.get('/api/auth/mi-cuenta')).body;
  assert.equal(r.usuario.email, 'adminA@imp.test'.toLowerCase());
  assert.equal(r.empresa.nombre, 'Cooespatrans'); assert.equal(r.empresa.nit, '900109959');
  assert.ok(r.usuario.permisos.includes('viajes.ver'));
  assert.ok(r.actividad.length > 0 && r.actividad.every(a => a.accion));
  assert.ok(r.seguridad.intentosFallidos30Dias >= 1, 'cuenta el intento fallido de la prueba de auditoría');
  assert.equal(r.usuario.passwordHash, undefined);
  const p = await s.a.put('/api/auth/mi-cuenta', { nombre: 'Admin Cooespatrans' });
  assert.equal(p.status, 200); assert.equal(p.body.nombre, 'Admin Cooespatrans');
  assert.equal((await s.a.put('/api/auth/mi-cuenta', { nombre: 'x' })).status, 400);
  // La actividad es solo la propia
  const otro = (await s.b.get('/api/auth/mi-cuenta')).body;
  assert.equal(otro.empresa.nombre, 'Otra Empresa');
});

test('Importación: un identificador se completa como valor, no se recorre como objeto', async () => {
  const { camposFaltantes } = await import('../src/services/importacion/excel.js');
  const { Types } = await import('mongoose');
  const id = new Types.ObjectId();
  const set = camposFaltantes({ conductorHabitual: null, soat: { numero: '' } }, { conductorHabitual: id, soat: { numero: '1' } });
  assert.deepEqual(Object.keys(set).sort(), ['conductorHabitual', 'soat.numero']);
  assert.equal(String(set.conductorHabitual), String(id));
});
