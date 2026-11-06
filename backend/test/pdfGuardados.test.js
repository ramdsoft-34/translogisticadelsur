// PDF permanentes: se generan una vez, se guardan, no se reemplazan y se verifica su huella
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.MONGODB_URI = (process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/translogisticadelsur_test').replace(/\/[^/]*$/, '/translogisticadelsur_documentos_test');
process.env.ARCHIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-documentos-'));

const mongoose = (await import('mongoose')).default;
const PDFKit = (await import('pdfkit')).default;
const { PDFDocument } = await import('pdf-lib');
const { DocumentoPdf } = await import('../src/models/documentos.js');
const G = await import('../src/services/documentos/guardados.js');
const { componerMediasHojas } = await import('../src/services/documentos/componer.js');

const empresa = new mongoose.Types.ObjectId();
const ref = new mongoose.Types.ObjectId();
function pdf(texto) {
  return new Promise((ok) => { const d = new PDFKit({ size: 'LETTER' }); const p = []; d.on('data', (c) => p.push(c)); d.on('end', () => ok(Buffer.concat(p))); d.text(texto); d.end(); });
}

before(async () => { await mongoose.connect(process.env.MONGODB_URI); await mongoose.connection.dropDatabase(); await DocumentoPdf.syncIndexes(); });
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); fs.rmSync(process.env.ARCHIVO_DIR, { recursive: true, force: true }); });

test('Se genera una sola vez: la segunda vez se entrega el archivo guardado sin volver a generarlo', async () => {
  let llamadas = 0;
  const generar = async () => { llamadas += 1; return pdf(`Manifiesto M1 · generado ${llamadas}`); };
  const a = await G.pdfGuardado(empresa, { tipo: 'manifiesto', ref, clave: 'M1', nombre: 'Manifiesto_M1.pdf', generar });
  const b = await G.pdfGuardado(empresa, { tipo: 'manifiesto', ref, clave: 'M1', nombre: 'Manifiesto_M1.pdf', generar });
  assert.equal(llamadas, 1);
  assert.equal(a.nuevo, true); assert.equal(b.nuevo, false);
  assert.ok(a.buffer.equals(b.buffer), 'el mismo archivo');
  assert.equal(b.version, 1);
  assert.equal(await DocumentoPdf.countDocuments({ empresa, tipo: 'manifiesto' }), 1, 'sin duplicados');
});

test('Un cambio permitido es otra versión y la anterior se conserva (no se reemplaza)', async () => {
  const r = new mongoose.Types.ObjectId();
  const v1 = await G.pdfGuardado(empresa, { tipo: 'soporte', ref: r, clave: 'MC1:vigente', generar: () => pdf('vigente') });
  const v2 = await G.pdfGuardado(empresa, { tipo: 'soporte', ref: r, clave: 'MC1:cumplido', generar: () => pdf('cumplido') });
  assert.deepEqual([v1.version, v2.version], [1, 2]);
  const otra = await G.versionGuardada(empresa, 'soporte', r, 1);
  assert.ok(otra.buffer.equals(v1.buffer), 'la versión 1 sigue igual');
  assert.equal((await G.versiones(empresa, 'soporte', r)).length, 2);
  // Volver al estado anterior entrega la versión que ya existía (no crea otra)
  const otraVez = await G.pdfGuardado(empresa, { tipo: 'soporte', ref: r, clave: 'MC1:vigente', generar: () => { throw new Error('no debía generarse'); } });
  assert.equal(otraVez.version, 1);
});

test('Si el archivo guardado se altera, no se entrega y se avisa', async () => {
  const r = new mongoose.Types.ObjectId();
  await G.pdfGuardado(empresa, { tipo: 'liquidacion', ref: r, clave: 'L1:facturada', generar: () => pdf('original') });
  const doc = await DocumentoPdf.findOne({ empresa, tipo: 'liquidacion', ref: String(r) }).lean();
  const ruta = path.join(process.env.ARCHIVO_DIR, String(empresa), doc.archivo);
  fs.chmodSync(ruta, 0o644); fs.writeFileSync(ruta, await pdf('alterado'));
  await assert.rejects(G.pdfGuardado(empresa, { tipo: 'liquidacion', ref: r, clave: 'L1:facturada', generar: () => pdf('x') }), /no coincide con su huella/);
});

test('Dos pedidos al mismo tiempo dejan un solo documento', async () => {
  const r = new mongoose.Types.ObjectId();
  const generar = () => pdf('mismo');
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => G.pdfGuardado(empresa, { tipo: 'remesa', ref: r, clave: 'R9', generar })));
  assert.equal(await DocumentoPdf.countDocuments({ empresa, tipo: 'remesa', ref: String(r) }), 1);
  assert.ok(a.buffer.equals(b.buffer) && b.buffer.equals(c.buffer));
  const carpeta = path.join(process.env.ARCHIVO_DIR, String(empresa), 'documentos', 'remesa', String(r));
  assert.equal(fs.readdirSync(carpeta).length, 1, 'sin archivos sueltos');
});

test('Hoja de 2 por hoja armada con los PDF guardados (sin regenerarlos)', async () => {
  const items = await Promise.all(['A', 'B', 'C'].map(async (t) => ({ buffer: await pdf(`Remesa ${t}`), completa: false })));
  const dos = await PDFDocument.load(await componerMediasHojas(items, { desplazamiento: 394, linea: true, textoLinea: 'cortar aquí' }));
  assert.equal(dos.getPageCount(), 2, '3 remesas en 2 hojas');
  const una = await PDFDocument.load(await componerMediasHojas(items, { desplazamiento: 394, porHoja: 1 }));
  assert.equal(una.getPageCount(), 3);
  const completa = await PDFDocument.load(await componerMediasHojas([{ buffer: items[0].buffer, completa: true }, ...items.slice(1)], { desplazamiento: 390 }));
  assert.equal(completa.getPageCount(), 2, 'la completa va sola y las otras dos comparten hoja');
});
