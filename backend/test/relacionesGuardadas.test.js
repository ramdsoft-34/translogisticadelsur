// Relación de cobro: lo enviado queda guardado (PDF y Excel) y no se reemplaza; un cambio después de enviar es otra versión
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_relaciones_test');
process.env.ARCHIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-relaciones-'));

const mongoose = (await import('mongoose')).default;
const M = await import('../src/models/index.js');
const { DocumentoPdf } = await import('../src/models/documentos.js');
const R = await import('../src/services/gestion/relaciones.js');
const G = await import('../src/services/documentos/guardados.js');

const d = (s) => new Date(`${s}T00:00:00Z`);
let empresa; let cliente; let tarifa; let usuario; const viajes = [];

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all([M.RelacionCliente.syncIndexes(), DocumentoPdf.syncIndexes()]);
  empresa = await M.Empresa.create({ nombre: 'Transportes Prueba', nit: '900000001', dv: '1' });
  usuario = new mongoose.Types.ObjectId();
  cliente = await M.Cliente.create({ empresa: empresa._id, nombre: 'Nutrisur Pasto', nit: '800000002', tipoId: 'N' });
  tarifa = await M.Tarifa.create({ empresa: empresa._id, cliente: cliente._id, destino: 'Ipiales', codMunicipio: '52356000', tarifaCliente: 500000, grupoRelacion: 'Viajeros' });
  for (const [n, f, placa] of [[1, '2026-10-16', 'AAA111'], [2, '2026-10-20', 'BBB222'], [3, '2026-10-25', 'AAA111']]) {
    viajes.push(await M.Viaje.create({ empresa: empresa._id, numero: n, fecha: d(f), cliente: cliente._id, tarifaRef: tarifa._id, destino: 'Ipiales',
      placa, conductorNombre: `Conductor ${placa}`, tarifa: 500000, flete: 450000 }));
  }
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); fs.rmSync(process.env.ARCHIVO_DIR, { recursive: true, force: true }); });

const periodo = () => ({ cliente: cliente._id, desde: d('2026-10-16'), hasta: new Date(Date.UTC(2026, 9, 31, 23, 59, 59)), grupo: 'Viajeros' });
const guardados = (rel) => DocumentoPdf.find({ empresa: empresa._id, ref: String(rel._id) }).sort({ tipo: 1, version: 1 }).lean();

test('Ciclo: borrador sin guardar archivos → enviada guarda v1 → cambio = versión 2 en borrador → facturada guarda v2', async () => {
  // 1. Borrador: los archivos se generan cada vez y no se guardan
  const rel = await R.guardar(empresa._id, periodo(), usuario);
  assert.equal(rel.estado, 'borrador'); assert.equal(rel.version, 1); assert.equal(rel.totales.viajes, 3);
  assert.match(rel.numero, /^NP-2026-001$/);
  const a0 = await R.archivos(empresa._id, rel._id);
  assert.equal(a0.pdf.subarray(0, 4).toString(), '%PDF'); assert.equal(a0.xlsx.subarray(0, 2).toString(), 'PK');
  assert.equal(a0.guardado, null);
  assert.equal((await guardados(rel)).length, 0, 'el borrador no se guarda');

  // 2. Se comparte por WhatsApp: queda enviada y se guardan PDF y Excel (v1)
  const w = await R.marcarWhatsapp(empresa._id, rel._id, { para: '3001234567' }, usuario);
  assert.equal(w.estado, 'enviada');
  let g = await guardados(rel);
  assert.deepEqual(g.map(x => [x.tipo, x.clave]), [['relacion-cobro', 'v1'], ['relacion-cobro-excel', 'v1']]);
  const v1 = await R.archivos(empresa._id, rel._id);
  assert.equal(v1.guardado.version, 1);
  // Volver a abrirla entrega el mismo archivo (no se regenera ni se duplica)
  const v1b = await R.archivos(empresa._id, rel._id);
  assert.ok(v1.pdf.equals(v1b.pdf)); assert.equal((await guardados(rel)).length, 2);

  // 3. Guardar sin cambios no cambia la versión
  const igual = await R.guardar(empresa._id, periodo(), usuario);
  assert.equal(igual.version, 1); assert.equal(igual.estado, 'enviada'); assert.equal(igual.nuevaVersion, false);

  // 4. Un viaje nuevo en el periodo: versión 2 en borrador; lo enviado (v1) se conserva tal cual
  viajes.push(await M.Viaje.create({ empresa: empresa._id, numero: 4, fecha: d('2026-10-28'), cliente: cliente._id, tarifaRef: tarifa._id, destino: 'Ipiales',
    placa: 'CCC333', conductorNombre: 'Conductor CCC333', tarifa: 500000, flete: 450000 }));
  const v2 = await R.guardar(empresa._id, periodo(), usuario);
  assert.equal(v2.version, 2); assert.equal(v2.estado, 'borrador'); assert.equal(v2.nuevaVersion, true); assert.equal(v2.totales.viajes, 4);
  g = await guardados(rel);
  assert.equal(g.length, 2, 'la versión 1 sigue guardada');
  // El enlace de la empresa sigue mostrando lo enviado (3 viajes, versión 1)
  const pub = await R.resumenPublico(await M.RelacionCliente.findOne({ empresa: empresa._id, _id: rel._id }));
  assert.deepEqual([pub.version, pub.totales.viajes, pub.estado], [1, 3, 'enviada']);
  const leido = await G.ultimoGuardado(empresa._id, 'relacion-cobro', rel._id);
  assert.ok(leido.buffer.equals(v1.pdf), 'lo enviado no cambia');
  // Una relación que ya se envió no se elimina aunque esté en borrador
  await assert.rejects(R.eliminar(empresa._id, rel._id), /nunca se ha enviado/);

  // 5. Facturar guarda la versión 2 y cierra los viajes
  await R.facturar(empresa._id, rel._id, { factura: 'fe-100' }, usuario);
  g = await guardados(rel);
  assert.deepEqual(g.map(x => [x.tipo, x.clave]), [['relacion-cobro', 'v1'], ['relacion-cobro', 'v2'], ['relacion-cobro-excel', 'v1'], ['relacion-cobro-excel', 'v2']]);
  await assert.rejects(R.exigirNoFacturado(empresa._id, [viajes[0]._id]), /ya está facturada/);
  await assert.rejects(R.guardar(empresa._id, periodo(), usuario), /ya está facturada/);
});

test('El enlace no cuenta las vistas previas de WhatsApp como apertura', async () => {
  const rel = await M.RelacionCliente.findOne({ empresa: empresa._id });
  await R.porToken(rel.token, { agente: 'WhatsApp/2.23.20.0 A' });
  await R.porToken(rel.token, { agente: 'facebookexternalhit/1.1' });
  assert.equal((await M.RelacionCliente.findOne({ empresa: empresa._id, _id: rel._id }).lean()).aperturas || 0, 0);
  await R.porToken(rel.token, { agente: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0' });
  const x = await M.RelacionCliente.findOne({ empresa: empresa._id, _id: rel._id }).lean();
  assert.equal(x.aperturas, 1); assert.ok(x.abierto);
  assert.equal(await R.porToken('no-existe'), null);
});

test('Celular para WhatsApp', () => {
  assert.equal(R.numeroWhatsapp('300 123 4567'), '573001234567');
  assert.equal(R.numeroWhatsapp('+57 300 123 4567'), '573001234567');
  assert.equal(R.numeroWhatsapp('7234567'), '');
});
