import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lugarRndc, radicacionRndc, textoQR, manifiestoPdf } from '../src/services/reportes/manifiesto.js';

// Nombres tal como los imprime el RNDC (tomados de manifiestos oficiales)
test('Manifiesto: lugares con el nombre del RNDC (centro poblado, municipio y departamento)', () => {
  assert.equal(lugarRndc({ codigo: '52001000', nombre: 'PASTO', departamento: 'NARIÑO' }), 'PASTO NARINO');
  assert.equal(lugarRndc({ codigo: '52001033', nombre: 'CUJACAL (PASTO)', departamento: 'NARIÑO' }), 'CUJACAL PASTO NARINO');
  assert.equal(lugarRndc({ codigo: '52835031', nombre: 'LLORENTE (SAN ANDRES DE TUMACO)', departamento: 'NARIÑO' }), 'LLORENTE TUMACO NARINO');
  assert.equal(lugarRndc({ codigo: '52835000', nombre: 'SAN ANDRES DE TUMACO', departamento: 'NARIÑO' }), 'TUMACO NARINO');
  assert.equal(lugarRndc({ codigo: '11001000', nombre: 'BOGOTA, D.C.', departamento: 'BOGOTA, D.C.' }), 'BOGOTA BOGOTA D. C.');
});

test('Manifiesto: la radicación va con hora de 12 horas sin AM/PM, como el RNDC', () => {
  assert.equal(radicacionRndc(new Date('2026-10-17T18:52:00Z')), '2026/10/17 01:52');   // 13:52 en Colombia
  assert.equal(radicacionRndc(new Date('2026-10-17T13:25:00Z')), '2026/10/17 08:25');
  assert.equal(radicacionRndc(new Date('2026-10-17T17:05:00Z')), '2026/10/17 12:05');   // mediodía
});

test('Manifiesto: el PDF usa la página y los textos del formato oficial', async () => {
  const d = JSON.parse(fs.readFileSync(new URL('./datos/manifiesto-ejemplo.json', import.meta.url), 'utf8'));
  const pdf = await manifiestoPdf(d);
  const s = pdf.toString('latin1');
  assert.match(s, /\/MediaBox \[0 0 855 612\]/);
  assert.ok(pdf.length > 20000);
  assert.match(textoQR({ ...d, radicado: '126061258', seguro: 'ABC' }), /^MEC:126061258\r\nFecha:2026\/10\/17\r\nPlaca:ABC123\r\nConfig:2\r\nOrig:CUJACAL PASTO NARINO\r\nDest:LLORENTE TUMACO NARI/);
});

test('Municipios: los nombres del RNDC con centro poblado se resuelven al centro poblado, no al municipio', async () => {
  const { buscadorMunicipios } = await import('../src/services/importacion/excel.js');
  const filas = JSON.parse(fs.readFileSync(new URL('../data/municipios.json', import.meta.url), 'utf8'));
  const buscar = buscadorMunicipios(filas.map(([codigo, nombre, departamento]) => ({ codigo, nombre, departamento })));
  assert.equal(buscar('EL PLATEADO ARGELIA CAUCA'), '19050006');
  assert.equal(buscar('LLORENTE TUMACO NARINO'), '52835031');
  assert.equal(buscar('CATAMBUCO PASTO NARINO'), '52001001');
  assert.equal(buscar('ARGELIA CAUCA'), '19050000');
});
