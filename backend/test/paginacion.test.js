// Funciones puras de la paginación (sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginacion, pagina, ordenEstable, rangoDespues } from '../src/utils/paginacion.js';

test('paginacion: activa solo con «pagina», límites y conteo solo en la primera página', () => {
  assert.equal(paginacion({}).activa, false);
  const p1 = paginacion({ pagina: '1', limite: '25' });
  assert.deepEqual([p1.activa, p1.pagina, p1.limite, p1.salto, p1.contar], [true, 1, 25, 0, true]);
  const p3 = paginacion({ pagina: '3', limite: '25' });
  assert.deepEqual([p3.salto, p3.contar], [50, false]);
  assert.equal(paginacion({ pagina: '3', contar: '1' }).contar, true);
  assert.equal(paginacion({ pagina: '1', limite: '99999' }, { maximo: 200 }).limite, 200);
  assert.equal(paginacion({ pagina: '1', limite: '1' }).limite, 5);
  assert.equal(paginacion({ pagina: '1', limite: '1' }, { minimo: 1 }).limite, 1);
  assert.equal(paginacion({ pagina: '-4' }).pagina, 1);
});

test('paginacion: el cursor solo acepta identificadores válidos', () => {
  const id = '65a1b2c3d4e5f60718293a4b';
  assert.equal(paginacion({ pagina: '2', despuesDe: id }).despuesDe, id);
  assert.equal(paginacion({ pagina: '2', despuesDe: { $gt: '' } }).despuesDe, null);
  assert.equal(paginacion({ pagina: '2', antesDe: 'abc' }).antesDe, null);
});

test('pagina: sin total devuelve null para que el navegador conserve el que tiene', () => {
  const p = paginacion({ pagina: '2', limite: '10' });
  assert.deepEqual(pagina([1], null, p), { items: [1], total: null, pagina: 2, limite: 10, paginas: null });
  assert.equal(pagina([], 31, paginacion({ pagina: '1', limite: '10' })).paginas, 4);
  assert.equal(pagina([], 0, paginacion({ pagina: '1', limite: '10' })).paginas, 1);
});

test('ordenEstable agrega el desempate por _id salvo que el orden ya sea único', () => {
  assert.deepEqual(ordenEstable({ createdAt: -1 }), { createdAt: -1, _id: -1 });
  assert.deepEqual(ordenEstable({ nombres: 1 }), { nombres: 1, _id: 1 });
  assert.deepEqual(ordenEstable({ numero: -1 }, true), { numero: -1 });
  assert.deepEqual(ordenEstable({ a: 1, _id: -1 }), { a: 1, _id: -1 });
});

test('rangoDespues: comparación lexicográfica según la dirección de cada campo', () => {
  const f = new Date('2026-11-01'); const id = 'X';
  assert.deepEqual(rangoDespues({ fecha: -1, _id: -1 }, { fecha: f, _id: id }), { $or: [{ fecha: { $lt: f } }, { fecha: f, _id: { $lt: id } }] });
  assert.deepEqual(rangoDespues({ fecha: -1, _id: -1 }, { fecha: f, _id: id }, true), { $or: [{ fecha: { $gt: f } }, { fecha: f, _id: { $gt: id } }] });
  assert.deepEqual(rangoDespues({ nombres: 1, apellido1: 1, _id: 1 }, { nombres: 'ANA', apellido1: 'RUIZ', _id: id }),
    { $or: [{ nombres: { $gt: 'ANA' } }, { nombres: 'ANA', apellido1: { $gt: 'RUIZ' } }, { nombres: 'ANA', apellido1: 'RUIZ', _id: { $gt: id } }] });
  // Un campo vacío no permite un rango seguro: se usa skip
  assert.equal(rangoDespues({ fecha: -1, _id: -1 }, { fecha: null, _id: id }), null);
});
