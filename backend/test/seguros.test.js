// Seguros: el manifiesto se anula el día siguiente antes de las 9:00 a. m. (hora de Colombia)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiteSeguro, datosSeguro } from '../src/services/gestion/seguros.js';

test('seguro creado el 9/11 a las 12:00 m. se anula antes del 10/11 a las 9:00 a. m.', () => {
  const v = { estado: 'manifestado', seguro: { marcado: true, fecha: new Date('2026-11-09T17:00:00Z') }, manifiesto: { estado: 'aceptado', fecha: new Date('2026-11-09T17:00:00Z') } };
  assert.equal(limiteSeguro(v).toISOString(), '2026-11-10T14:00:00.000Z');
});

test('expedido a las 11:30 p. m. de Colombia cuenta ese mismo día', () => {
  const v = { seguro: { marcado: true, fecha: new Date('2026-11-10T04:30:00Z') } };   // 9/11 11:30 p. m. en Colombia
  assert.equal(limiteSeguro(v).toISOString(), '2026-11-10T14:00:00.000Z');
});

test('vencido y pendiente; al anular el manifiesto deja de estar pendiente', () => {
  const v = { estado: 'manifestado', seguro: { marcado: true, fecha: new Date('2026-11-09T17:00:00Z') }, manifiesto: { estado: 'aceptado', fecha: new Date('2026-11-09T17:00:00Z') } };
  assert.equal(datosSeguro(v, new Date('2026-11-10T13:59:00Z')).vencido, false);
  assert.equal(datosSeguro(v, new Date('2026-11-10T14:01:00Z')).vencido, true);
  const anulado = { ...v, manifiesto: { ...v.manifiesto, estado: 'anulado' } };
  assert.equal(datosSeguro(anulado).pendiente, false);
  assert.equal(limiteSeguro({ seguro: { marcado: false } }), null);
});
