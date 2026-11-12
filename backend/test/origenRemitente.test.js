// Remitente según el origen del viaje (caso viaje 1258: Corbeta de Túquerres a Cujacal con la sede remitente
// de la ficha en la bodega de Cujacal; el RNDC lo rechazaba con REM019 y el origen salía Cujacal)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_origen_test');

const mongoose = (await import('mongoose')).default;
const { cargarViaje } = await import('../src/services/rndc/operaciones.js');
const { contextoViaje, variablesRemesa, variablesManifiesto, destinoIgualOrigen } = await import('../src/services/rndc/documentos.js');

const empresa = { _id: new mongoose.Types.ObjectId(), nit: '900109959', dv: '2', rndc: {} };
const cliente = new mongoose.Types.ObjectId();
const tarifa = new mongoose.Types.ObjectId();
const col = (n) => mongoose.connection.collection(n);
const sede = (codigo, nombre, codMunicipio) => ({ empresa: empresa._id, tipoId: 'N', numId: '8909009431', sede: { codigo, nombre }, codMunicipio, roles: [] });
const valor = (vars, n) => Object.fromEntries(vars)[n];

async function viaje(extra) {
  const _id = new mongoose.Types.ObjectId();
  await col('viajes').insertOne({ _id, empresa: empresa._id, numero: 1258, fecha: new Date('2026-11-12'), cliente, tarifaRef: tarifa, placa: 'ABC123',
    codDestino: '52001033', destinatario: { tipoId: 'N', numId: '8909009431', sede: '1' }, pesoKg: 1500, flete: 550000, remesa: {}, manifiesto: {}, ...extra });
  return _id;
}
async function documentos(id) {
  const { v, vehiculo } = await cargarViaje(empresa._id, id);
  const ctx = contextoViaje(empresa, v, vehiculo);
  return { v, ctx, R: variablesRemesa(empresa, v, ctx, 'R1'), M: variablesManifiesto(empresa, v, ctx, 'M1') };
}

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI); await mongoose.connection.dropDatabase();
  await col('clientes').insertOne({ _id: cliente, empresa: empresa._id, nombre: 'Corbeta', tipoId: 'N', nit: '890900943', dv: '1', sedeRemitente: '1' });
  await col('tarifas').insertOne({ _id: tarifa, empresa: empresa._id, cliente, destino: 'Cujacal 5.0', codMunicipio: '52001033', operacion: 'G',
    destinatario: { tipoId: 'N', numId: '8909009431', sede: '1' } });
  await col('terceros').insertMany([
    sede('', '', '52001033'),                 // registro sin código de sede (no sirve como remitente ni destinatario)
    sede('1', 'BODEGA', '52001033'), sede('9', 'TUQUERRES', '52838000'), sede('2', 'TUMACO', '52835000'),
  ]);
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test('De Túquerres a Cujacal: remitente la sede de Túquerres, origen Túquerres y sin REM019', async () => {
  const { ctx, R, M } = await documentos(await viaje({ codOrigen: '52838000' }));
  assert.equal(valor(R, 'CODSEDEREMITENTE'), '9');
  assert.equal(valor(R, 'CODSEDEPROPIETARIO'), '9');
  assert.equal(valor(R, 'CODSEDEDESTINATARIO'), '1');
  assert.equal(destinoIgualOrigen(ctx), false);
  assert.equal(valor(M, 'CODMUNICIPIOORIGENMANIFIESTO'), '52838000');
  assert.equal(valor(M, 'CODMUNICIPIODESTINOMANIFIESTO'), '52001033');
  assert.equal(ctx.OPERACION, 'G');
});

test('Sin origen en el viaje, o con origen en el municipio de la ficha, queda la sede remitente de la ficha', async () => {
  for (const codOrigen of [undefined, '', '52001000', '52001033']) {
    const { R, M } = await documentos(await viaje({ codOrigen, codDestino: '52835000', destinatario: { tipoId: 'N', numId: '8909009431', sede: '2' } }));
    assert.equal(valor(R, 'CODSEDEREMITENTE'), '1', `origen ${codOrigen}`);
    assert.equal(valor(M, 'CODMUNICIPIOORIGENMANIFIESTO'), '52001033');
  }
});

test('Origen en un municipio donde el cliente no tiene sede: queda la de la ficha', async () => {
  const { R } = await documentos(await viaje({ codOrigen: '86001000' }));
  assert.equal(valor(R, 'CODSEDEREMITENTE'), '1');
});

test('Sin destinatario: la sede automática en el destino no es la del remitente elegido por el origen', async () => {
  await col('tarifas').updateOne({ _id: tarifa }, { $set: { destinatario: { tipoId: '', numId: '', sede: '' } } });
  try {
    const { ctx, R } = await documentos(await viaje({ codOrigen: '52838000', destinatario: { tipoId: '', numId: '', sede: '' } }));
    assert.equal(valor(R, 'CODSEDEREMITENTE'), '9');
    assert.equal(valor(R, 'CODSEDEDESTINATARIO'), '1', 'la bodega de Cujacal recibe');
    assert.equal(destinoIgualOrigen(ctx), false);
  } finally {
    await col('tarifas').updateOne({ _id: tarifa }, { $set: { destinatario: { tipoId: 'N', numId: '8909009431', sede: '1' } } });
  }
});
