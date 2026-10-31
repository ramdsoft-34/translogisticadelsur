// Pruebas de la contabilidad (Fase 5): registro de la factura electrónica de transporte en el RNDC (proceso 86).
// Las reglas puras corren sin base de datos; la API contra MongoDB local y el simulador local del RNDC (nunca el real).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_ferndc_test');
process.env.CORREO_TRANSPORTE = 'memoria';
process.env.RNDC_PERMITIR_PRODUCCION = 'false';
process.env.RNDC_PERMITIR_PRUEBAS = 'false';
process.env.RNDC_LLAVE_MAESTRA = crypto.randomBytes(32).toString('base64');

const { crearSimulador } = await import('../tools/rndcSimulador.js');
const sim = crearSimulador();
await new Promise(r => sim.servidor.listen(0, '127.0.0.1', r));
process.env.RNDC_SIMULADOR_URL = `http://127.0.0.1:${sim.servidor.address().port}/soap/IBPMServices`;

const F = await import('../src/services/gestion/rndcFactura.js');
const cufeDe = (s) => crypto.createHash('sha384').update(s).digest('hex');

// AttachedDocument de prueba con la estructura de la DIAN: la factura y la respuesta de validación en CDATA
function attached({ numero = 'FETR1', cufe = cufeDe('x'), emisor = '900111222', adquirente = '890111222', tipo = '12', validada = true, lineas = [] } = {}) {
  const parte = (n, nit) => `<cac:${n}><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>X</cbc:RegistrationName><cbc:CompanyID schemeID="1" schemeName="31">${nit}</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:${n}>`;
  const factura = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="c" xmlns:cac="a" xmlns:ext="e">` +
    `<ext:UBLExtensions><ext:UBLExtension><cbc:ID>NO-ES-ESTE</cbc:ID></ext:UBLExtension></ext:UBLExtensions><cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>` +
    `<cbc:CustomizationID>${tipo}</cbc:CustomizationID><cbc:ProfileExecutionID>1</cbc:ProfileExecutionID><cbc:ID>${numero}</cbc:ID><cbc:UUID schemeName="CUFE-SHA384">${cufe}</cbc:UUID>` +
    `<cbc:IssueDate>2026-10-30</cbc:IssueDate>${parte('AccountingSupplierParty', emisor)}${parte('AccountingCustomerParty', adquirente)}` +
    lineas.map((l, i) => `<cac:InvoiceLine><cbc:ID>${i + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="KGM">${l.kg || 1000}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">${l.flete}.00</cbc:LineExtensionAmount>` +
      `<cac:Item><cbc:Description>Servicio de transporte remesa ${l.consecutivo}</cbc:Description><cac:StandardItemIdentification><cbc:ID schemeID="1">${l.consecutivo}</cbc:ID></cac:StandardItemIdentification>` +
      `<cac:AdditionalItemProperty><cbc:Name>01</cbc:Name><cbc:Value>${l.radicado}</cbc:Value></cac:AdditionalItemProperty>` +
      `<cac:AdditionalItemProperty><cbc:Name>02</cbc:Name><cbc:Value>${l.consecutivo}</cbc:Value></cac:AdditionalItemProperty>` +
      `<cac:AdditionalItemProperty><cbc:Name>03</cbc:Name><cbc:Value>${l.flete}</cbc:Value><cbc:ValueQuantity unitCode="KGM">${l.kg || 1000}</cbc:ValueQuantity></cac:AdditionalItemProperty></cac:Item></cac:InvoiceLine>`).join('') +
    `</Invoice>`;
  const respuesta = `<ApplicationResponse xmlns:cbc="c" xmlns:cac="a"><cac:DocumentResponse><cac:Response><cbc:ResponseCode>${validada ? '02' : '04'}</cbc:ResponseCode>` +
    `<cbc:Description>${validada ? 'Documento validado por la DIAN' : 'Documento rechazado'}</cbc:Description></cac:Response></cac:DocumentResponse></ApplicationResponse>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?><AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" xmlns:cbc="c" xmlns:cac="a">` +
    `<cbc:ID>${numero}</cbc:ID><cac:Attachment><cac:ExternalReference><cbc:MimeCode>text/xml</cbc:MimeCode><cbc:Description><![CDATA[${factura}]]></cbc:Description></cac:ExternalReference></cac:Attachment>` +
    `<cac:ParentDocumentLineReference><cbc:LineID>1</cbc:LineID><cac:DocumentReference><cbc:ID>${numero}</cbc:ID><cac:Attachment><cac:ExternalReference>` +
    `<cbc:Description><![CDATA[${respuesta}]]></cbc:Description></cac:ExternalReference></cac:Attachment></cac:DocumentReference></cac:ParentDocumentLineReference></AttachedDocument>`;
}

// ── Reglas puras ─────────────────────────────────────────────────────────────
test('FE · RNDC: lee el AttachedDocument (factura, CUFE, NIT, validación DIAN y remesas 01/02/03)', () => {
  const cufe = cufeDe('a');
  const x = F.leerAttachedDocument(attached({ cufe, lineas: [{ radicado: '555', consecutivo: 'R100', flete: 1000000 }, { radicado: '556', consecutivo: 'R101', flete: 900000 }] }));
  assert.equal(x.numero, 'FETR1'); assert.equal(x.cufe, cufe); assert.equal(x.tipoOperacion, '12');
  assert.equal(x.emisor, '900111222'); assert.equal(x.adquirente, '890111222'); assert.equal(x.validadaDian, true);
  assert.deepEqual(x.remesas.map(r => [r.radicado, r.consecutivo, r.flete]), [['555', 'R100', '1000000'], ['556', 'R101', '900000']]);
});

test('FE · RNDC: revisión contra la factura y su relación de remesas', () => {
  const filas = [['N', '9001112223', 'N', '8901112221', 'FETR1', '', 'FV', '12', '555', 'R100', 1000000, 1000, 'K']];
  const base = { numeroFe: 'FETR1', empresa: { nit: '900111222', dv: '3' }, cliente: { nit: '890111222', dv: '1' }, filas };
  const ok = F.revisarXml(F.leerAttachedDocument(attached({ lineas: [{ radicado: '555', consecutivo: 'R100', flete: 1000000 }] })), base);
  assert.deepEqual(ok.problemas, []);
  const mal = F.revisarXml(F.leerAttachedDocument(attached({ validada: false, emisor: '800999888', tipo: '10', lineas: [{ radicado: '999', consecutivo: 'R100', flete: 5 }, { radicado: '1', consecutivo: 'R200', flete: 1 }] })), base);
  for (const t of [/validado/, /emisor/, /tipo de operación/, /radicado del XML/, /R200 del XML no está/]) assert.ok(mal.problemas.some(p => t.test(p)), String(t));
  assert.ok(mal.avisos.some(a => /flete/.test(a)));
  assert.ok(F.revisarXml(F.leerAttachedDocument(attached({ lineas: [] })), base).problemas.some(p => /R100 de la factura no está/.test(p)));
});

test('FE · RNDC: seguridad del XML (tamaño, DOCTYPE/ENTITY, documento equivocado) y reintentos con espera creciente', () => {
  assert.throws(() => F.leerAttachedDocument('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><AttachedDocument>&a;</AttachedDocument>'), /DOCTYPE/);
  assert.throws(() => F.leerAttachedDocument('<Invoice><cbc:ID>1</cbc:ID></Invoice>'), /AttachedDocument/);
  assert.throws(() => F.leerAttachedDocument('<AttachedDocument>' + 'x'.repeat(F.LIMITE_XML) + '</AttachedDocument>'), /pesa más/);
  const t0 = Date.now();
  assert.throws(() => F.leerAttachedDocument('<AttachedDocument>' + '<cbc:Description '.repeat(20000)), /no trae la factura/);
  assert.ok(Date.now() - t0 < 3000, 'un XML armado para trabar el servidor se rechaza rápido');
  assert.deepEqual([1, 2, 3].map(F.esperaReintento), [600000, 1200000, 2400000]);
  assert.equal(F.esperaReintento(20), 6 * 3600e3);
});

// ── API (necesita MongoDB) ───────────────────────────────────────────────────
const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');
const claveRndc = await import('../src/services/rndc/claveGuardada.js');

const app = crearApp();
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;
const s = {};
let empresa;
const con = (token) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${token}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${token}`).send(b),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${token}`).send(b),
});

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(M).filter(x => x?.syncIndexes).map(m => m.syncIndexes()));
  empresa = await M.Empresa.create({ nombre: 'Transportes FE', nit: '900111222', dv: '3', rndc: { ambiente: 'SIMULADO', usuario: 'USUARIO@1' } });
  const hash = await bcrypt.hash(CLAVE, 10);
  await M.Usuario.create([{ nombre: 'Admin F', email: 'admin@fe.test', rol: 'admin', empresa: empresa._id, passwordHash: hash },
    { nombre: 'Conta F', email: 'conta@fe.test', rol: 'contabilidad', empresa: empresa._id, passwordHash: hash },
    { nombre: 'Consulta F', email: 'consulta@fe.test', rol: 'consulta', empresa: empresa._id, passwordHash: hash }]);
  for (const [k, email] of [['admin', 'admin@fe.test'], ['conta', 'conta@fe.test'], ['consulta', 'consulta@fe.test']]) {
    const r = await request(app).post('/api/auth/login').send({ email, password: CLAVE });
    assert.equal(r.status, 200, JSON.stringify(r.body)); s[k] = con(r.body.token);
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  sim.servidor.close();
});

// Factura de un viaje con remesa aceptada en el RNDC; devuelve la factura y su relación de remesas
let n = 0;
async function facturaConRemesa() {
  n += 1;
  const cli = await s.admin.post('/api/maestros/clientes', { nombre: `Cliente FE ${n}`, tipoId: 'N', nit: `89011122${n}`, dv: '1', siglas: `C${n}` });
  assert.equal(cli.status, 201, JSON.stringify(cli.body));
  const t = await s.admin.post('/api/maestros/tarifas', { cliente: cli.body._id, destino: 'CALI', tarifaCliente: 1000000, fleteConductor: 800000 });
  const placa = `FEL${String(100 + n)}`;
  const cond = await s.admin.post('/api/maestros/terceros', { tipoId: 'C', numId: `5566770${n}`, nombres: 'Luis', apellido1: 'Ruta', roles: ['conductor'],
    licencia: { categoria: 'C2', numero: `5566770${n}`, vence: '2035-01-01' }, placas: [placa], placaPrincipal: placa });
  await s.admin.post('/api/maestros/vehiculos', { placa, pbv: 9000, soat: { numero: 'S1', vence: '2035-01-01' }, venceTecnomecanica: '2035-01-01' });
  const v = await s.admin.post('/api/viajes', { fecha: '2026-10-20', cliente: cli.body._id, tarifaRef: t.body._id, destino: 'CALI', placa, conductor: cond.body._id, pesoKg: 1000 });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  await M.Viaje.updateOne({ empresa: empresa._id, _id: v.body._id }, { $set: { 'remesa.numero': `R${500 + n}`, 'remesa.radicado': `${7000 + n}`, 'remesa.estado': 'aceptado' } });
  const f = await s.conta.post('/api/gestion/contabilidad/facturas', { cliente: cli.body._id, viajes: [v.body._id], retefuentePct: 1 });
  assert.equal(f.status, 201, JSON.stringify(f.body));
  const rel = await s.conta.get(`/api/gestion/tributario/facturas/${f.body.numero}/relacion-remesas`);
  return { f: f.body, nit: cli.body.nit, lineas: rel.body.filas.map(x => ({ radicado: x[8], consecutivo: x[9], flete: x[10] })) };
}

test('FE · RNDC: cargar el XML validado, enviarlo al RNDC (simulador) y no repetirlo', async () => {
  const { f, nit, lineas } = await facturaConRemesa();
  const url = `/api/gestion/tributario/facturas/${f.numero}`;
  const bueno = attached({ numero: 'FETR10', cufe: cufeDe(f.numero), adquirente: nit, lineas });
  assert.equal((await s.consulta.post(`${url}/fe/xml`, { xml: bueno })).status, 403, 'el rol de consulta no carga XML');
  const sinValidar = await s.conta.post(`${url}/fe/xml`, { xml: attached({ numero: 'FETR10', cufe: cufeDe(f.numero), adquirente: nit, lineas, validada: false }) });
  assert.equal(sinValidar.status, 400); assert.ok(sinValidar.body.detalles.some(d => /validado/.test(d)), JSON.stringify(sinValidar.body));
  assert.equal((await s.conta.post(`${url}/fe/rndc`, {})).status, 400, 'sin XML no se envía');
  const c = await s.conta.post(`${url}/fe/xml`, { xml: bueno });
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.numeroFe, 'FETR10');
  const lista = (await s.conta.get('/api/gestion/contabilidad/facturas')).body.find(x => x.numero === f.numero);
  assert.equal(lista.fe.rndc.estado, 'PENDIENTE'); assert.equal(lista.fe.cufe, cufeDe(f.numero));
  assert.equal(JSON.stringify(lista).includes('AttachedDocument'), false, 'el XML no viaja en los listados');

  const mal = await s.conta.post(`${url}/fe/rndc`, { clave: 'clave-incorrecta' });
  assert.equal(mal.status, 200, JSON.stringify(mal.body)); assert.equal(mal.body.estado, 'PENDIENTE'); assert.equal(mal.body.claveRechazada, true);
  const env = await s.conta.post(`${url}/fe/rndc`, { clave: 'clave-simulador' });
  assert.equal(env.status, 200, JSON.stringify(env.body)); assert.equal(env.body.estado, 'ACEPTADA'); assert.ok(env.body.radicado);
  assert.equal((await s.conta.post(`${url}/fe/rndc`, { clave: 'clave-simulador' })).status, 409, 'no se registra dos veces');
  assert.equal((await s.conta.post(`${url}/fe/xml`, { xml: bueno })).status, 409, 'no se cambia el XML de una factura registrada');
  assert.equal((await s.conta.post(`/api/gestion/contabilidad/facturas/${f.numero}/anular`, {})).status, 409, 'registrada en el RNDC no se anula');
  const t = await M.TransaccionRndc.findOne({ empresa: empresa._id, proceso: 86, ok: true }).lean();
  assert.ok(t); assert.equal(/clave-simulador/.test(t.solicitud), false, 'la contraseña no queda en el registro');
});

test('FE · RNDC: envío automático con la contraseña guardada; solo el administrador lo activa', async () => {
  const { f, nit, lineas } = await facturaConRemesa();
  const c = await s.conta.post(`/api/gestion/tributario/facturas/${f.numero}/fe/xml`, { xml: attached({ numero: 'FETR11', cufe: cufeDe(f.numero), adquirente: nit, lineas }) });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal((await s.conta.put('/api/gestion/tributario/fe/rndc', { automatico: true })).status, 403, 'contabilidad no activa el envío automático');
  const a = await s.admin.put('/api/gestion/tributario/fe/rndc', { automatico: true });
  assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.automatico, true);
  assert.deepEqual(await F.enviarPendientes(empresa._id), [], 'sin contraseña guardada no envía');
  await claveRndc.guardar(empresa._id, 'USUARIO@1', 'clave-simulador', { _id: null, nombre: 'Prueba' });
  const e = await s.consulta.get('/api/gestion/tributario/fe/rndc');
  assert.equal(e.status, 200); assert.equal(e.body.claveGuardada, true); assert.equal(e.body.pendientes, 1);
  assert.equal(JSON.stringify(e.body).includes('clave-simulador'), false);
  assert.equal((await s.conta.post(`/api/gestion/tributario/facturas/${f.numero}/fe/rndc`, { clave: 'otra' })).status, 403, 'con la contraseña registrada no se escribe otra');
  const r = await F.enviarPendientes(empresa._id);
  assert.equal(r.length, 1); assert.equal(r[0].estado, 'ACEPTADA', JSON.stringify(r));
  assert.deepEqual(await F.enviarPendientes(empresa._id), [], 'nada pendiente');
});
