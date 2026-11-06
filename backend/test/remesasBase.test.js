// Fase 12: remesas de los clientes con base de datos (consecutivo, remesas de antes de la fase 12, impresas y formato)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_remesas_test');
process.env.CORREO_TRANSPORTE = 'memoria';

const mongoose = (await import('mongoose')).default;
const ExcelJS = (await import('exceljs')).default;
const { Empresa, Cliente, RemesaDulces } = await import('../src/models/index.js');
const R = await import('../src/services/gestion/remesasDulces.js');

const dia = new Date('2026-11-03T00:00:00Z');
const fila = (vpl, remesa = '', extra = {}) => ({ vpl, remesa, zona: 'PASTO', conductor: 'ANA PEREZ', placa: 'AAA111', costo: 1000, ...extra });
async function libro(filas) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['FECHA', 'VPL', 'ZONA', 'PESO', 'MANIFIESTO', 'CONDUCTOR', 'PLACA', 'REMESA', 'COSTO']);
  for (const f of filas) ws.addRow([dia, Number(f.vpl), f.zona, 10, 'URBANO', f.conductor, f.placa, f.remesa === '' ? '' : Number(f.remesa), f.costo]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const numeros = async (empresa) => (await RemesaDulces.find({ empresa }).sort({ vpl: 1 }).lean()).map(x => `${x.vpl}:${x.remesa}`);
let empresa; let cliente; let otro;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

async function nueva() {
  empresa = (await Empresa.create({ nombre: `Empresa ${crypto.randomUUID().slice(0, 6)}`, nit: String(900000000 + crypto.randomInt(99999)) }))._id;
  cliente = (await Cliente.create({ empresa, nombre: 'Cliente A' }))._id;
  otro = (await Cliente.create({ empresa, nombre: 'Cliente B' }))._id;
}

test('El formato se consulta en MongoDB (antes chocaban los campos pedidos)', async () => {
  await nueva();
  await Cliente.updateOne({ _id: cliente, empresa }, { $set: { 'remesaFormato.remitente': 'Remitente A', 'remesaFormato.logo': 'data:image/png;base64,AAAA' } });
  const f = await R.formato(empresa, cliente);
  assert.equal(f.remitente, 'Remitente A');
  assert.equal(f.logoCliente, 'data:image/png;base64,AAAA');
  assert.equal(f.siguiente, 1);
});

test('Nunca repite un número: los vacíos saltan los que trae el archivo y los que ya están en la base', async () => {
  await nueva();
  await R.guardar(empresa, cliente, await libro([fila(101), fila(102, 1), fila(103, 3)]));
  assert.deepEqual(await numeros(empresa), ['101:2', '102:1', '103:3']);
  // Otro cliente: el consecutivo es uno solo para la empresa
  await R.guardar(empresa, otro, await libro([fila(201), fila(202)]));
  const todos = (await RemesaDulces.find({ empresa }).lean()).map(x => x.remesa);
  assert.equal(new Set(todos).size, todos.length, 'sin números repetidos');
  assert.deepEqual(todos.sort(), ['1', '2', '3', '4', '5']);
});

test('Un número que ya tiene otro viaje no se pasa (ni el repetido dentro del archivo)', async () => {
  await nueva();
  await R.guardar(empresa, cliente, await libro([fila(101, 50)]));
  const p = await R.previa(empresa, cliente, await libro([fila(102, 50), fila(103, 60), fila(104, 60)]));
  assert.deepEqual(p.filas.map(x => x.estado), ['conflicto', 'nuevo', 'conflicto']);
  assert.match(p.filas[0].conflicto, /VPL 101/);
  const r = await R.guardar(empresa, cliente, await libro([fila(102, 50), fila(103, 60), fila(104, 60)]));
  assert.equal(r.conflictos.length, 2);
  assert.deepEqual(await numeros(empresa), ['101:50', '103:60']);
});

test('Las remesas de antes de la fase 12 (sin cliente) se reconocen, conservan su número y el consecutivo sigue después', async () => {
  await nueva();
  await RemesaDulces.collection.insertOne({ empresa, vpl: '5501', remesa: '300', conductor: 'VIEJO', placa: 'CCC333', impreso: new Date(), createdAt: new Date(), updatedAt: new Date() });
  await R.prepararIndices(); await R.completarNumeros();
  const p = await R.previa(empresa, cliente, await libro([fila(5501), fila(5502)]));
  assert.deepEqual(p.filas.map(x => [x.estado === 'nuevo', x.legado]), [[false, true], [true, false]]);
  assert.ok(p.siguiente > 300, 'el consecutivo sigue después de la remesa vieja');
  await R.guardar(empresa, cliente, await libro([fila(5501), fila(5502)]), { modo: 'reemplazar' });
  const docs = await RemesaDulces.find({ empresa }).sort({ vpl: 1 }).lean();
  assert.equal(docs.length, 2, 'no se duplica el VPL viejo');
  assert.equal(docs[0].remesa, '300'); assert.equal(String(docs[0].cliente), String(cliente), 'queda del cliente');
  assert.equal(docs[1].remesa, '301');
  assert.equal(docs[0].conductor, 'VIEJO', 'ya estaba impresa: «Reemplazar» no la cambia');
});

test('«Reemplazar» no cambia una remesa ya impresa; una pendiente sí', async () => {
  await nueva();
  await R.guardar(empresa, cliente, await libro([fila(101), fila(102)]));
  await RemesaDulces.updateOne({ empresa, vpl: '101' }, { $set: { impreso: new Date() } });
  const r = await R.guardar(empresa, cliente, await libro([fila(101, '', { zona: 'IPIALES' }), fila(102, '', { zona: 'IPIALES' })]), { modo: 'reemplazar' });
  assert.deepEqual(r.impresasSinCambio, ['101']);
  const [a, b] = await RemesaDulces.find({ empresa }).sort({ vpl: 1 }).lean();
  assert.equal(a.zona, 'PASTO'); assert.equal(b.zona, 'IPIALES');
  assert.equal(b.remesa, '2', 'la pendiente conserva su número');
});

test('Revisión: los números que ya están en la base no salen como faltantes', async () => {
  await nueva();
  await R.guardar(empresa, cliente, await libro([fila(100, 10), fila(101, 11), fila(102, 12)]));
  const p = await R.previa(empresa, cliente, await libro([fila(200, 10), fila(201, 13)]));
  assert.ok(!p.avisos.some(a => a.tipo === 'salto'), JSON.stringify(p.avisos));
});

test('Selección compacta: rangos de los VPL del archivo, para incluir o excluir', () => {
  const vpls = ['12400', '12401', '12402', '12410', '690'];
  assert.deepEqual([...R.leerSeleccion('i:12400-12402,690', vpls).vpls].sort(), ['12400', '12401', '12402', '690']);
  const e = R.leerSeleccion('e:12410', vpls);
  assert.equal(e.excluir, true); assert.deepEqual([...e.vpls], ['12410']);
  assert.throws(() => R.leerSeleccion('["12400"]', vpls), /inválida/);
});

test('PDF: el logo va una sola vez aunque haya muchas remesas', async () => {
  // PNG de 300x300 con ruido (no se comprime) para que el tamaño del logo se note
  const zlib = await import('node:zlib');
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const trozo = (tipo, datos) => { const l = Buffer.alloc(4); l.writeUInt32BE(datos.length); const td = Buffer.concat([Buffer.from(tipo), datos]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const W = 300; const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  const crudo = Buffer.concat(Array.from({ length: W }, () => Buffer.concat([Buffer.from([0]), crypto.randomBytes(W * 3)])));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
  const f = R.formatoPorDefecto({ nombre: 'Empresa', nit: '900000001' }, { nombre: 'Cliente' });
  f.logo = `data:image/png;base64,${png.toString('base64')}`; f.logoCliente = f.logo;
  const lista = (n) => Array.from({ length: n }, (_, i) => ({ vpl: String(1000 + i), remesa: String(5000 + i), fecha: dia, conductor: 'ANA', placa: 'AAA111', costo: 1000, peso: 10 }));
  const una = await R.remesasPdf(f, lista(1), { porHoja: 2 });
  const cien = await R.remesasPdf(f, lista(100), { porHoja: 2 });
  assert.ok(una.length > png.length / 2, 'el logo sí está en el PDF');
  assert.ok(cien.length < una.length * 3, `100 remesas pesan ${cien.length} bytes; una sola ${una.length}`);
});

test('Posición y tamaño de los logos: dentro de los límites, se guarda y el PDF sale con los logos movidos', async () => {
  // Fuera de los límites se acota (el logo no sale del encabezado)
  assert.deepEqual(R.ajusteDe('logo', { dx: 999, dy: -50, escala: 5 }), { dx: 300, dy: -10, escala: 2 });
  assert.deepEqual(R.ajusteDe('logoCliente', { dx: 'x' }), { dx: 0, dy: 0, escala: 1 });
  await nueva();
  await Empresa.updateOne({ _id: empresa }, { $set: { 'remesaFormato.ajusteLogo': { dx: 40, dy: 5, escala: 1.3 }, 'remesaFormato.logo': 'data:image/png;base64,AAAA' } });
  await Cliente.updateOne({ _id: cliente, empresa }, { $set: { 'remesaFormato.ajusteLogo': { dx: -60, dy: 10, escala: 0.8 } } });
  const f = await R.formato(empresa, cliente);
  assert.deepEqual(f.ajusteLogo, { dx: 40, dy: 5, escala: 1.3 });
  assert.deepEqual(f.ajusteLogoCliente, { dx: -60, dy: 10, escala: 0.8 });
  const pdf = await R.remesasPdf(f, [{ vpl: '1', remesa: '1', fecha: dia, conductor: 'ANA', placa: 'AAA111', costo: 1, peso: 1 }], { porHoja: 1 });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
});
