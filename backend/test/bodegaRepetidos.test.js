// Cargues de bodega: un renglón con «ya hay viaje ese día» se marca como ese viaje o se quita; registrado o quitado,
// el jefe de bodega ya no lo puede cambiar
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_bodega_test');

const mongoose = (await import('mongoose')).default;
const B = await import('../src/services/bodega.js');
const { ReporteBodega } = await import('../src/models/index.js');

const empresa = new mongoose.Types.ObjectId();
const cliente = new mongoose.Types.ObjectId();
const otroCliente = new mongoose.Types.ObjectId();
const fecha = new Date('2026-11-12T00:00:00Z');
const col = (n) => mongoose.connection.collection(n);
let rep; let v1266; let vOtro;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI); await mongoose.connection.dropDatabase();
  await col('empresas').insertOne({ _id: empresa, nombre: 'Transportes', rndc: { codOrigen: '52001000' } });
  await col('clientes').insertOne({ _id: cliente, empresa, nombre: 'Nutrisur Pasto', tipoId: 'N', nit: '900', sedeRemitente: '1', bodega: { activa: true } });
  await col('tarifas').insertOne({ empresa, cliente, destino: 'Sandona 3.0', codMunicipio: '52683000', tarifaCliente: 562000, fleteConductor: 510000, anticipoHabitual: 300000, activo: true });
  v1266 = new mongoose.Types.ObjectId(); vOtro = new mongoose.Types.ObjectId();
  await col('viajes').insertMany([
    { _id: v1266, empresa, cliente, numero: 1266, fecha, placa: 'SPV505', destino: 'Sandona 3.0', estado: 'registrado' },
    { _id: vOtro, empresa, cliente: otroCliente, numero: 1280, fecha, placa: 'SPV505', destino: 'Ipiales', estado: 'registrado' },
  ]);
  rep = await ReporteBodega.create({ empresa, cliente, fecha, items: [
    { tipo: 'urbano', placa: 'SPV505', destinoTexto: 'Sandona', planilla: '36913', viajes: 1 },
    { tipo: 'urbano', placa: 'SLF645', destinoTexto: 'Pasto', viajes: 2 },
  ] });
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test('«Ya hay viaje ese día»: ofrece marcar el viaje del mismo cliente (no el de otro cliente)', async () => {
  const r = await B.revision(empresa, rep._id);
  const f = r.filas.find((x) => x.placa === 'SPV505');
  assert.equal(f.repetidos.length, 2);
  assert.deepEqual(f.existentes.map((x) => x.numero), [1266]);
});

test('Marcar registrado: el renglón queda con ese viaje, no se repite y el jefe ya no lo cambia', async () => {
  const item = rep.items.find((x) => x.placa === 'SPV505')._id;
  await B.vincularViaje(empresa, rep._id, item, v1266);
  const r = await B.revision(empresa, rep._id);
  const f = r.filas.find((x) => x.placa === 'SPV505');
  assert.equal(f.registrado, String(v1266));
  assert.equal(r.numeros[String(v1266)], 1266);
  await assert.rejects(B.vincularViaje(empresa, rep._id, item, v1266), /todos sus viajes registrados/);
  const otro = rep.items.find((x) => x.placa === 'SLF645')._id;
  await assert.rejects(B.vincularViaje(empresa, rep._id, otro, vOtro), /no es de este cliente/);
});

test('Quitar: sale de la revisión un viaje pendiente; lo registrado no se quita', async () => {
  const item = rep.items.find((x) => x.placa === 'SLF645')._id;
  assert.equal((await B.revision(empresa, rep._id)).filas.filter((x) => x.placa === 'SLF645').length, 2);
  await B.quitarViaje(empresa, rep._id, item);
  assert.equal((await B.revision(empresa, rep._id)).filas.filter((x) => x.placa === 'SLF645').length, 1);
  await B.quitarViaje(empresa, rep._id, item);
  assert.equal((await B.revision(empresa, rep._id)).filas.filter((x) => x.placa === 'SLF645').length, 0);
  await assert.rejects(B.quitarViaje(empresa, rep._id, item), /no tiene viajes pendientes/);
  const registrado = rep.items.find((x) => x.placa === 'SPV505')._id;
  await assert.rejects(B.quitarViaje(empresa, rep._id, registrado), /los registrados no se quitan/);
  // Lo registrado se sigue mostrando todo el día
  assert.ok((await B.revision(empresa, rep._id)).filas.some((x) => x.placa === 'SPV505' && x.registrado));
});

test('El jefe de bodega no puede cambiar ni quitar lo registrado o quitado por la transportadora', async () => {
  const token = 'enlace-de-prueba-0123456789abc';
  await col('clientes').updateOne({ _id: cliente }, { $set: { 'bodega.jefes': [{ nombre: 'Willian Jossa', cedula: '1085123456', celular: '3176248158' }] } });
  await col('reportebodegas').updateOne({ _id: rep._id }, { $set: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), vence: new Date(Date.now() + 3600000) } });
  const { sesion } = await B.ingresar(token, '1085123456');
  const vistos = (await B.datosFormulario(token, sesion)).reporte.items;
  assert.ok(vistos.every((x) => x.registrado), 'los dos renglones le salen bloqueados');
  // Intenta cambiar el destino y la planilla del registrado, borrar el quitado y agregar otro
  const r = await B.guardarReporte(token, sesion, { tipo: 'urbano', items: [{ placa: 'SPV505', destino: 'Otro lado', planilla: '1', viajes: 1 }, { placa: 'TKK252', destino: 'Pasto', viajes: 1 }] });
  const spv = r.items.filter((x) => x.placa === 'SPV505');
  assert.deepEqual(spv.map((x) => [x.destino, x.planilla]), [['Sandona', '36913']], 'el registrado queda como estaba');
  assert.ok(r.items.some((x) => x.placa === 'SLF645'), 'el quitado no lo puede borrar');
  assert.ok(r.items.some((x) => x.placa === 'TKK252' && !x.registrado), 'lo nuevo sí lo agrega');
});
