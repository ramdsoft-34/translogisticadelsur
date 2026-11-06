// SG-SST y PESV: datos y membrete, colaboradores, flota, vencimientos, capacitaciones, formatos,
// Word y Excel propios, firmas e incidentes con la app (simulada) y tablero. Base de datos propia de prueba.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]+$/, '/translogisticadelsur_sst_test');
process.env.RNDC_PERMITIR_PRODUCCION = 'false';
process.env.RNDC_PERMITIR_PRUEBAS = 'false';
process.env.RNDC_LLAVE_MAESTRA = crypto.randomBytes(32).toString('base64');
process.env.ARCHIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sst-'));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const DIA = 86400000;
const iso = (ms = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() + ms));

// App Sur Track simulada: solicitudes de firma, firmas, incidentes y preoperacionales
const app2 = { solicitudes: [], firmas: [], incidentes: [], cuentas: new Set(['12345678']), clave: crypto.randomBytes(24).toString('hex'), seguimiento: null };
app2.servidor = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    const json = (st, b) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.headers['x-integracion-clave'] !== app2.clave) return json(401, { error: 'clave' });
    const url = new URL(req.url, 'http://x'); const ruta = url.pathname.replace('/api/integracion', '');
    const b = partes.length ? JSON.parse(Buffer.concat(partes).toString() || '{}') : {};
    if (ruta === '/sst/solicitudes' && req.method === 'POST') {
      if (!app2.cuentas.has(b.cedula)) return json(404, { error: 'sin app', codigo: 'sin_conductor' });
      const id = crypto.randomBytes(12).toString('hex'); app2.solicitudes.push({ id, ...b }); return json(201, { id, estado: 'pendiente' });
    }
    if (ruta.startsWith('/sst/solicitudes/') && req.method === 'DELETE') { app2.cancelada = ruta.split('/').pop(); res.writeHead(204); return res.end(); }
    if (ruta === '/sst/firmas') return json(200, app2.firmas.filter((f) => new Date(f.firmadoEn) > new Date(url.searchParams.get('desde'))));
    if (ruta === '/sst/incidentes' && req.method === 'GET') return json(200, app2.incidentes.filter((i) => !url.searchParams.get('estado') || i.estado === url.searchParams.get('estado')));
    if (ruta.startsWith('/sst/incidentes/') && req.method === 'PUT') { app2.seguimiento = b; return json(200, { id: ruta.split('/').pop(), estado: b.estado }); }
    if (ruta === '/preoperacionales/ultimos') return json(200, [{ placa: 'ABC123', checklistId: 'e'.repeat(24), fecha: new Date().toISOString(), resultado: 'no_apto', kilometraje: 151000, conductor: 'Pedro', cedula: '12345678' }]);
    if (ruta === '/preoperacionales') return json(200, [{ checklistId: 'e'.repeat(24), fecha: new Date().toISOString(), dia: iso(), placa: 'ABC123', kilometraje: 151000, resultado: 'no_apto',
      criticosMal: ['luces'], noCumplen: ['luces'], conductor: { nombre: 'Pedro', cedula: '12345678' }, autorizacion: null, revision: null }]);
    json(404, { error: 'ruta ' + ruta });
  });
});
await new Promise((r) => app2.servidor.listen(0, '127.0.0.1', r));
process.env.SURTRACK_APP_INTEGRACION_URL = `http://127.0.0.1:${app2.servidor.address().port}/api/integracion`;
process.env.SURTRACK_APP_INTEGRACION_CLAVE = app2.clave;

const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const bcrypt = (await import('bcryptjs')).default;
const { default: JSZip } = await import('jszip');
const { default: ExcelJS } = await import('exceljs');
const { conectar } = await import('../src/db.js');
const { crearApp } = await import('../src/app.js');
const M = await import('../src/models/index.js');
const S = await import('../src/models/sst.js');
const { estadoActividad, kilometrajeVigente } = await import('../src/services/sst/flota.js');
const { estadoVence } = await import('../src/services/sst/comun.js');

const app = crearApp();
const CLAVE = `Prueba${crypto.randomInt(100000, 999999)}`;
const s = {};
const login = async (email) => { const r = await request(app).post('/api/auth/login').send({ email, password: CLAVE }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.token; };
const con = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b),
  del: (u) => request(app).delete(u).set('Authorization', `Bearer ${t}`),
  bin: (u, datos, nombre) => request(app).post(u).set('Authorization', `Bearer ${t}`).set('Content-Type', 'application/octet-stream').set('X-Nombre-Archivo', nombre).send(datos),
});

before(async () => {
  await conectar(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([...Object.values(M), ...Object.values(S)].filter((x) => x?.syncIndexes).map((m) => m.syncIndexes()));
  await M.Usuario.create({ nombre: 'Super', email: 'super@sst.test', rol: 'superadmin', passwordHash: await bcrypt.hash(CLAVE, 10) });
  const sa = con(await login('super@sst.test'));
  for (const [k, nit] of [['A', '901111222'], ['B', '901333444']]) {
    const r = await sa.post('/api/admin/empresas', { nombre: `Transportes ${k}`, nit, dv: '1', ciudad: 'Pasto', administrador: { nombre: `Admin ${k}`, email: `admin${k.toLowerCase()}@sst.test`, password: CLAVE } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    s[`empresa${k}`] = r.body.empresa._id;
  }
  await M.Empresa.updateOne({ _id: s.empresaA }, { $set: { 'rastreo.surTrack': true } });
  s.a = con(await login('admina@sst.test'));
  s.b = con(await login('adminb@sst.test'));
  assert.equal((await s.a.post('/api/usuarios', { nombre: 'Consulta', email: 'consulta@sst.test', rol: 'consulta', password: CLAVE })).status, 201);
  s.consulta = con(await login('consulta@sst.test'));
  // Conductor y vehículo de la empresa A
  s.pedro = await M.Tercero.create({ empresa: s.empresaA, tipoId: 'C', numId: '12345678', nombres: 'Pedro Pablo', apellido1: 'Perez', roles: ['conductor'], placaPrincipal: 'ABC123',
    licencia: { categoria: 'C2', vence: new Date(Date.now() - 3 * DIA) } });
  s.vehiculo = await M.Vehiculo.create({ empresa: s.empresaA, placa: 'ABC123', marca: 'HINO', modelo: 2019, soat: { numero: 'SO-1', vence: new Date(Date.now() + 5 * DIA) }, venceTecnomecanica: new Date(Date.now() + 200 * DIA) });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  app2.servidor.close();
  fs.rmSync(process.env.ARCHIVO_DIR, { recursive: true, force: true });
});

test('Reglas: vence lo que llegue primero y el kilometraje vigente es la lectura más reciente', () => {
  const ahora = new Date('2026-11-05T15:00:00Z');
  const a = { actividad: 'Aceite', cadaKm: 10000, cadaDias: 180, ultimoKm: 140000, ultimaFecha: new Date('2026-07-01T12:00:00Z') };
  assert.equal(estadoActividad(a, 151000, ahora).estado, 'vencido', 'pasó por kilómetros');
  assert.match(estadoActividad(a, 151000, ahora).texto, /pasó 1\.000 km/);
  assert.equal(estadoActividad(a, 148500, ahora).estado, 'mes', 'faltan 1.500 km');
  assert.equal(estadoActividad({ ...a, ultimaFecha: new Date('2026-05-01T12:00:00Z') }, 141000, ahora).estado, 'vencido', 'pasó por días');
  assert.equal(estadoActividad({ actividad: 'x', cadaKm: 5000, ultimoKm: null }, 1000, ahora).estado, 'sin_dato');
  const km = kilometrajeVigente([{ valor: 150000, fecha: '2026-11-01' }, { valor: 149000, fecha: '2026-11-04' }]);
  assert.equal(km.valor, 149000); assert.equal(km.bajo, true, 'avisa que bajó');
  assert.equal(estadoVence(new Date(Date.now() - DIA)), 'vencido'); assert.equal(estadoVence(new Date(Date.now() + 3 * DIA)), 'semana');
  assert.equal(estadoVence(new Date(Date.now() + 20 * DIA)), 'mes'); assert.equal(estadoVence(new Date(Date.now() + 90 * DIA)), 'ok');
});

test('Datos y membrete: valida, guarda, la consulta solo ve y cada empresa ve lo suyo', async () => {
  const d0 = (await s.a.get('/api/sst/datos')).body;
  assert.equal(d0.empresa.nombre, 'Transportes A'); assert.equal(d0.autoevaluacion.estandares.valor, null, 'sin números de ejemplo');
  const cuerpo = { responsables: { representanteLegal: 'Miguel López', documentoRepresentante: '1004135410', responsableSst: 'Cristian Salcedo', licenciaSst: 'Res. 123', liderPesv: 'Cristian Salcedo' },
    riesgo: { arl: 'Positiva', claseRiesgo: 'IV', actividadEconomica: 'Transporte de carga', trabajadores: 3, nivelPesv: 'basico' },
    autoevaluacion: { estandares: { valor: 14.5, fecha: '2025-12-15' }, pesv: { valor: 62, fecha: '2026-08-24' } }, colores: { principal: '#0B2A6B', acento: '#F5B400' }, pieTexto: 'Cra 67 · 300 000 0000' };
  assert.equal((await s.a.put('/api/sst/datos', { ...cuerpo, autoevaluacion: { ...cuerpo.autoevaluacion, pesv: { valor: 120, fecha: '' } } })).status, 400, 'porcentaje > 100');
  assert.equal((await s.a.put('/api/sst/datos', { ...cuerpo, autoevaluacion: { ...cuerpo.autoevaluacion, pesv: { valor: 50, fecha: iso(5 * DIA) } } })).status, 400, 'fecha futura');
  const r = await s.a.put('/api/sst/datos', cuerpo);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.riesgo.arl, 'Positiva');
  assert.equal((await s.consulta.get('/api/sst/datos')).status, 200);
  assert.equal((await s.consulta.put('/api/sst/datos', cuerpo)).status, 403, 'consulta no edita');
  assert.equal((await s.b.get('/api/sst/datos')).body.riesgo.arl, '', 'otra empresa no ve los datos');
  assert.equal((await s.a.put('/api/sst/datos/membrete/encabezado', { imagen: 'data:text/html;base64,PGh0bWw+' })).status, 400);
  const m = await s.a.put('/api/sst/datos/membrete/encabezado', { imagen: PNG });
  assert.equal(m.status, 200); assert.equal(m.body.membrete.encabezado, true);
  const muestra = await s.a.get('/api/sst/datos/membrete/muestra');
  assert.equal(muestra.headers['content-type'], 'application/pdf');
  assert.ok(await M.Auditoria.exists({ accion: 'sst_datos' }));
});

test('Colaboradores: se traen sin duplicar, se crean con rol empleado y el perfil guarda exámenes, EPP y comparendos', async () => {
  const t1 = await s.a.post('/api/sst/colaboradores/traer');
  assert.equal(t1.body.nuevos, 1); assert.equal((await s.a.post('/api/sst/colaboradores/traer')).body.nuevos, 0, 'no duplica');
  const nuevo = await s.a.post('/api/sst/colaboradores', { tipo: 'directo', cargo: 'Auxiliar', vinculacion: 'directo',
    persona: { tipoId: 'C', numId: '1087046522', nombres: 'Ricardo', apellido1: 'Melo', celular: '3001234567' } });
  assert.equal(nuevo.status, 201, JSON.stringify(nuevo.body));
  assert.deepEqual((await M.Tercero.findOne({ empresa: s.empresaA, numId: '1087046522' }).lean()).roles, ['empleado']);
  assert.equal((await s.a.post('/api/sst/colaboradores', { tipo: 'directo', persona: { tipoId: 'C', numId: '1087046522', nombres: 'Ricardo', apellido1: 'Melo' } })).status, 409, 'una persona, un perfil');
  const lista = (await s.a.get('/api/sst/colaboradores')).body;
  assert.equal(lista.length, 2);
  s.colPedro = lista.find((x) => x.documento === '12345678');
  assert.equal(s.colPedro.licencia.estado, 'vencido'); assert.equal(s.colPedro.placa, 'ABC123');
  assert.equal((await s.a.get('/api/sst/colaboradores?q=ABC123')).body.length, 1, 'busca por placa');
  assert.equal((await s.b.get(`/api/sst/colaboradores/${s.colPedro.id}`)).status, 404, 'otra empresa no lo ve');

  const id = s.colPedro.id;
  assert.equal((await s.a.post(`/api/sst/colaboradores/${id}/examenes`, { tipo: 'periodico', fecha: iso(3 * DIA), concepto: 'apto' })).status, 400, 'fecha futura');
  assert.equal((await s.a.post(`/api/sst/colaboradores/${id}/examenes`, { tipo: 'periodico', fecha: iso(), concepto: 'apto_restricciones' })).status, 400, 'restricciones obligatorias');
  const ex = await s.a.post(`/api/sst/colaboradores/${id}/examenes`, { tipo: 'periodico', fecha: iso(-300 * DIA), vence: iso(10 * DIA), concepto: 'apto', entidad: 'IPS Salud' });
  assert.equal(ex.status, 201); assert.equal(ex.body.examen.estado, 'mes');

  const epp = await s.a.post(`/api/sst/colaboradores/${id}/epp`, { fecha: iso(-100 * DIA), elementos: [{ nombre: 'Casco', cantidad: 1 }], proximaReposicion: iso(-5 * DIA), firma: PNG });
  assert.equal(epp.status, 201); assert.ok(epp.body.eppEntregas[0].firmadoEn);
  // Sin firma en la web: se pide en la app (el conductor la tiene)
  const epp2 = await s.a.post(`/api/sst/colaboradores/${id}/epp`, { fecha: iso(), elementos: [{ nombre: 'Chaleco reflectivo', cantidad: 2 }], pedirFirmaApp: true });
  assert.equal(epp2.body.pedidaApp, true);
  assert.equal(app2.solicitudes.at(-1).tipo, 'epp'); assert.deepEqual(app2.solicitudes.at(-1).detalle, ['2 × Chaleco reflectivo']);
  assert.equal(epp2.body.eppEntregas.find((x) => x.id === epp2.body.eppId).pendienteApp, true);
  // El conductor firma en la app: al abrir el perfil se trae la firma
  app2.firmas.push({ id: app2.solicitudes.at(-1).id, referencia: app2.solicitudes.at(-1).referencia, tipo: 'epp', firmadoEn: new Date().toISOString(), firma: PNG });
  const p = (await s.a.get(`/api/sst/colaboradores/${id}`)).body;
  const firmada = p.eppEntregas.find((x) => x.id === epp2.body.eppId);
  assert.equal(firmada.firmaOrigen, 'app'); assert.ok(firmada.firmadoEn);
  assert.equal(p.inspecciones[0].resultado, 'no_apto', 'últimas inspecciones del conductor');
  // Una entrega firmada no se borra
  assert.equal((await s.a.del(`/api/sst/colaboradores/${id}/epp/${firmada.id}`)).status, 409);
  const pdf = await s.a.get(`/api/sst/colaboradores/${id}/epp/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');

  const cmp = { fecha: iso(-40 * DIA), numero: '52001000000041234567', codigo: 'C29', descripcion: 'Velocidad superior a la máxima', placa: 'abc123', valor: 604100 };
  assert.equal((await s.a.post(`/api/sst/colaboradores/${id}/comparendos`, cmp)).status, 201);
  assert.equal((await s.a.post(`/api/sst/colaboradores/${id}/comparendos`, cmp)).status, 409, 'no se repite');
  assert.equal((await s.consulta.post(`/api/sst/colaboradores/${id}/comparendos`, { ...cmp, numero: '999' })).status, 403);
  // El rol «empleado» también lo admite Conductores y terceros
  const t = await M.Tercero.findOne({ empresa: s.empresaA, numId: '1087046522' }).lean();
  const ed = await s.a.put(`/api/maestros/terceros/${t._id}`, { tipoId: 'C', numId: '1087046522', nombres: 'Ricardo Andrés', apellido1: 'Melo', roles: ['empleado'] });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
});

test('Flota: hoja de vida con plan, kilometraje que no baja y vencimientos con mantenimiento y pólizas', async () => {
  const flota = (await s.a.get('/api/sst/flota')).body;
  assert.equal(flota.length, 1);
  assert.equal(flota[0].kilometraje.valor, 151000, 'del preoperacional'); assert.equal(flota[0].ultimoPreoperacional.resultado, 'no_apto');
  const id = flota[0].id;
  const base = { kilometraje: 151000, rcContractual: { vence: iso(20 * DIA), numero: 'RC-1' }, rcExtracontractual: { vence: iso(-2 * DIA), numero: 'RCE-1' },
    plan: [{ actividad: 'Cambio de aceite y filtros', cadaKm: 10000, cadaDias: 180, ultimoKm: 140000, ultimaFecha: iso(-60 * DIA) }] };
  assert.equal((await s.a.put(`/api/sst/flota/${id}`, { ...base, plan: [{ ...base.plan[0], ultimaFecha: iso(10 * DIA) }] })).status, 400, 'última fecha futura');
  assert.equal((await s.a.put(`/api/sst/flota/${id}`, { ...base, plan: [{ actividad: 'Sin frecuencia', cadaKm: '', cadaDias: '' }] })).status, 400);
  const h = await s.a.put(`/api/sst/flota/${id}`, base);
  assert.equal(h.status, 200, JSON.stringify(h.body)); assert.equal(h.body.plan[0].estado, 'vencido');
  const baja = await s.a.put(`/api/sst/flota/${id}`, { ...base, kilometraje: 100000 });
  assert.equal(baja.status, 409, 'el kilometraje no baja sin confirmar');
  assert.equal((await s.a.put(`/api/sst/flota/${id}`, { ...base, kilometraje: 151500 })).status, 200);
  const m = await s.a.post(`/api/sst/flota/${id}/mantenimientos`, { fecha: iso(), tipo: 'preventivo', actividad: 'Cambio de aceite y filtros', km: 151500, taller: 'Lubricentro', costo: 420000 });
  assert.equal(m.status, 201); assert.equal(m.body.plan[0].ultimoKm, 151500, 'el plan se actualiza'); assert.equal(m.body.plan[0].estado, 'ok');
  assert.equal((await s.a.post(`/api/sst/flota/${id}/mantenimientos`, { fecha: iso(2 * DIA), tipo: 'correctivo', actividad: 'Bombillo' })).status, 400);

  const v = (await s.a.get('/api/sst/vencimientos')).body;
  const tipos = v.items.map((x) => x.tipo);
  for (const t of ['Licencia', 'SOAT', 'Póliza RC extracontractual', 'Póliza RC contractual', 'Examen médico', 'EPP']) assert.ok(tipos.includes(t), `vence ${t}`);
  assert.ok(v.resumen.vencidos >= 3);
  // Datos → Alertas usa la misma lógica
  const alertas = (await s.a.get('/api/maestros/alertas')).body;
  assert.ok(alertas.some((x) => x.tipo === 'Licencia') && alertas.some((x) => x.tipo === 'SOAT'));
});

test('Inspecciones: lista de la app, PDF y cierre de la revisión', async () => {
  const l = (await s.a.get(`/api/sst/inspecciones?desde=${iso(-7 * DIA)}&hasta=${iso()}`)).body;
  assert.equal(l.usaApp, true); assert.equal(l.items.length, 1);
  const hoy = (await s.a.get('/api/sst/inspecciones/hoy')).body;
  assert.equal(hoy.noAptos.length, 1); assert.equal(hoy.noAptos[0].placa, 'ABC123');
  const sinApp = (await s.b.get('/api/sst/inspecciones')).body;
  assert.equal(sinApp.usaApp, false, 'la empresa B no usa la app');
});

test('Capacitaciones: programa, asistencia firmada (web y app), ejecución, indicadores y PDF', async () => {
  const k = await s.a.post('/api/sst/capacitaciones', { fecha: iso(-2 * DIA), tema: 'Manejo defensivo', eje: 'vial', horas: 8, facilitador: 'ARL Positiva', dirigidoA: 'Conductores' });
  assert.equal(k.status, 201);
  const fut = await s.a.post('/api/sst/capacitaciones', { fecha: iso(20 * DIA), tema: 'Primeros auxilios', eje: 'sst', horas: 4 });
  const a = await s.a.post(`/api/sst/capacitaciones/${k.body.id}/asistentes`, { colaboradores: [s.colPedro.id], externos: [{ nombre: 'Visitante Uno', documento: '99887766', cargo: 'Externo' }] });
  assert.equal(a.status, 200); assert.equal(a.body.asistentes.length, 2); assert.equal(a.body.pedidasApp, 1, 'al conductor se le pide en la app');
  assert.equal(app2.solicitudes.at(-1).tipo, 'capacitacion');
  const externo = a.body.asistentes.find((x) => x.documento === '99887766');
  const f1 = await s.a.post(`/api/sst/capacitaciones/${k.body.id}/asistentes/${externo.id}/firma`, { firma: PNG });
  assert.equal(f1.body.firmados, 1);
  // En la futura no se firma todavía
  const af = await s.a.post(`/api/sst/capacitaciones/${fut.body.id}/asistentes`, { externos: [{ nombre: 'Visitante Dos', documento: '11223344' }] });
  assert.equal((await s.a.post(`/api/sst/capacitaciones/${fut.body.id}/asistentes/${af.body.asistentes[0].id}/firma`, { firma: PNG })).status, 409);
  assert.equal((await s.a.post(`/api/sst/capacitaciones/${fut.body.id}/ejecutada`, { ejecutada: true })).status, 409, 'no se ejecuta antes de su fecha');
  // El conductor firma en la app
  const sol = app2.solicitudes.at(-1);
  app2.firmas.push({ id: sol.id, referencia: sol.referencia, tipo: 'capacitacion', firmadoEn: new Date().toISOString(), firma: PNG });
  const d = (await s.a.get(`/api/sst/capacitaciones/${k.body.id}`)).body;
  assert.equal(d.firmados, 2); assert.equal(d.asistentes.find((x) => x.documento === '12345678').firmaOrigen, 'app');
  assert.equal((await s.a.del(`/api/sst/capacitaciones/${k.body.id}`)).status, 409, 'con firmas no se borra');
  await s.a.post(`/api/sst/capacitaciones/${k.body.id}/ejecutada`, { ejecutada: true });
  const pr = (await s.a.get(`/api/sst/capacitaciones?anio=${new Date().getFullYear()}`)).body;
  assert.equal(pr.indicadores.ejecutadas, 1); assert.equal(pr.indicadores.horas, 8);
  const pdf = await s.a.get(`/api/sst/capacitaciones/${k.body.id}/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.headers['content-type'], 'application/pdf');
  const perfil = (await s.a.get(`/api/sst/colaboradores/${s.colPedro.id}`)).body;
  assert.equal(perfil.capacitaciones[0].firmada, true);
});

test('Formatos: catálogo, en blanco, borrador, versión final con versiones y PDF', async () => {
  const cat = (await s.a.get('/api/sst/formatos')).body;
  assert.equal(cat.length, 7);
  for (const f of cat) {
    const r = await s.a.get(`/api/sst/formatos/${f.codigo}/en-blanco`);
    assert.equal(r.status, 200, f.codigo); assert.equal(r.headers['content-type'], 'application/pdf');
  }
  const def = (await s.a.get('/api/sst/formatos/SST-FOR-01/definicion')).body;
  assert.equal(def.auto.inspector, 'Cristian Salcedo', 'se llena con los datos de la empresa'); assert.equal(def.auto.fecha, iso());
  const b = await s.a.post('/api/sst/formatos/SST-FOR-01/diligenciados', { datos: { placa: 'ABC123' }, final: false });
  assert.equal(b.status, 201); assert.equal(b.body.estado, 'borrador'); assert.equal(b.body.numero, 'SST-FOR-01-0001');
  const falta = await s.a.put(`/api/sst/diligenciados/${b.body.id}`, { datos: { placa: 'ABC123' }, final: true });
  assert.equal(falta.status, 400); assert.match(falta.body.error || falta.body.mensaje, /sin calificar/);
  const items = def.secciones.find((x) => x.tipo === 'items').items.map((i) => ({ clave: i.clave, valor: 'cumple' }));
  items[0].valor = 'no_cumple';
  assert.equal((await s.a.put(`/api/sst/diligenciados/${b.body.id}`, { datos: { placa: 'ABC123', fecha: iso() }, items, final: true })).status, 400, 'observación en lo que no cumple');
  items[0].observacion = 'SOAT por vencer';
  const v1 = await s.a.put(`/api/sst/diligenciados/${b.body.id}`, { datos: { placa: 'ABC123', fecha: iso(), inventado: 'x' }, items, firmas: { inspector: PNG }, final: true });
  assert.equal(v1.status, 200, JSON.stringify(v1.body)); assert.equal(v1.body.version, 1); assert.equal(v1.body.datos.inventado, undefined, 'no guarda claves inventadas');
  const v2 = await s.a.put(`/api/sst/diligenciados/${b.body.id}`, { datos: { placa: 'ABC123', fecha: iso() }, items, final: true });
  assert.equal(v2.body.version, 2); assert.equal(v2.body.versiones.length, 2);
  assert.ok(v2.body.firmados.includes('inspector'), 'conserva la firma');
  const pdf = await s.a.get(`/api/sst/diligenciados/${b.body.id}/pdf`);
  assert.equal(pdf.status, 200); assert.ok(pdf.body.length > 2000);
  assert.equal((await s.a.del(`/api/sst/diligenciados/${b.body.id}`)).status, 409, 'el final no se borra');
  assert.equal((await s.a.post('/api/sst/formatos/SST-FOR-06/diligenciados', { final: false })).status, 409, 'el preoperacional es de la app');
  assert.equal((await s.b.get(`/api/sst/diligenciados/${b.body.id}`)).status, 404, 'otra empresa no lo ve');
});

test('Word y Excel propios: se llenan las variables (aunque Word las parta) y el logo', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>'
    + '<w:p><w:r><w:t>Empresa: {{empresa.</w:t></w:r><w:r><w:t>nombre}} · Responsable: {{sst.responsable}} · {{desconocida}}</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>{{membrete.encabezado}}</w:t></w:r></w:p></w:body></w:document>');
  const docx = await zip.generateAsync({ type: 'nodebuffer' });
  const sub = await s.a.bin('/api/sst/archivos', docx, 'acta.docx');
  assert.equal(sub.status, 201, JSON.stringify(sub.body)); assert.equal(sub.body.tipo, 'docx');
  const desc = await s.a.get(`/api/sst/archivos/${sub.body.id}`).buffer(true).parse((res, cb) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
  const z = await JSZip.loadAsync(desc.body);
  const xml = await z.file('word/document.xml').async('string');
  assert.match(xml, /Empresa: Transportes A/); assert.match(xml, /Responsable: Cristian Salcedo/);
  assert.match(xml, /\{\{desconocida\}\}/, 'lo que no es variable queda igual');
  assert.match(xml, /<w:drawing>/, 'la franja del membrete como imagen');
  assert.ok(Object.keys(z.files).some((n) => n.startsWith('word/media/')));

  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Hoja');
  ws.getCell('A1').value = 'NIT {{empresa.nit}}'; ws.getCell('B2').value = '{{empresa.logo}}';
  const sx = await s.a.bin('/api/sst/archivos', Buffer.from(await wb.xlsx.writeBuffer()), 'matriz.xlsx');
  assert.equal(sx.body.tipo, 'xlsx');
  const dx = await s.a.get(`/api/sst/archivos/${sx.body.id}`).buffer(true).parse((res, cb) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p))); });
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(dx.body);
  assert.equal(wb2.getWorksheet('Hoja').getCell('A1').value, 'NIT 901111222-1');
  assert.equal((await s.a.bin('/api/sst/archivos', Buffer.from('no es un zip'), 'x.docx')).status, 415);
  assert.equal((await s.b.get(`/api/sst/archivos/${sub.body.id}`)).status, 404, 'otra empresa no lo descarga');
  assert.equal((await s.a.del(`/api/sst/archivos/${sub.body.id}`)).status, 204);
});

test('Incidentes de la app: seguimiento y registro como PESV-FOR-01 sin duplicar', async () => {
  app2.incidentes.push({ id: 'f'.repeat(24), tipo: 'accidente', nombreTipo: 'Accidente vial', fecha: new Date().toISOString(), lugar: 'Vía Pasto - Ipiales', placa: 'ABC123',
    descripcion: 'Choque leve por alcance en un semáforo', estado: 'recibido', lesionados: false, cuantos: 0, danos: 'Bómper', conductor: { nombre: 'Pedro', cedula: '12345678' }, ubicacion: { lat: 1.1, lng: -77.3 } });
  const l = (await s.a.get('/api/sst/incidentes')).body;
  assert.equal(l.items.length, 1);
  const seg = await s.a.put(`/api/sst/incidentes/${'f'.repeat(24)}`, { estado: 'en_investigacion', nota: 'Se cita al conductor' });
  assert.equal(seg.status, 200); assert.equal(app2.seguimiento.por, 'Admin A');
  const f1 = await s.a.post(`/api/sst/incidentes/${'f'.repeat(24)}/formato`);
  assert.equal(f1.status, 201); assert.equal(f1.body.codigo, 'PESV-FOR-01'); assert.equal(f1.body.datos.tipo, 'Accidente vial'); assert.equal(f1.body.origen, 'app');
  assert.equal((await s.a.post(`/api/sst/incidentes/${'f'.repeat(24)}/formato`)).body.id, f1.body.id, 'no duplica');
});

test('Tablero: todo sale de los datos reales', async () => {
  const t = (await s.a.get('/api/sst/tablero')).body;
  assert.equal(t.empresa.arl, 'Positiva'); assert.equal(t.autoevaluacion.estandares.valor, 14.5);
  assert.equal(t.indicadores.noAptosHoy, 1); assert.ok(t.indicadores.vencidos >= 3);
  assert.equal(t.colaboradores.total, 2); assert.equal(t.colaboradores.conductores, 1);
  assert.equal(t.capacitaciones.ejecutadas, 1); assert.equal(t.proximasCapacitaciones[0].tema, 'Primeros auxilios');
  assert.equal(t.incidentesSinRevisar, 1);
  const vacio = (await s.b.get('/api/sst/tablero')).body;
  assert.equal(vacio.autoevaluacion.estandares.valor, null); assert.equal(vacio.indicadores.preoperacionalesHoy, null, 'sin la app: vacío, no cero inventado');
  assert.equal((await s.consulta.get('/api/sst/tablero')).status, 200);
});
