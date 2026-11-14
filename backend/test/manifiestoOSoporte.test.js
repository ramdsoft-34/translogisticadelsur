// Acción «Manifiesto o soporte»: solo la impide un documento vigente en el RNDC (caso viaje 1315: remesa anulada y
// manifiesto rechazado porque se envió por error; debía poder pasar a soporte interno)
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(64);
const { cambioMasivo } = await import('../src/routes/viajes.js');
const viaje = (extra) => ({ estado: 'registrado', requiereManifiesto: true, remesa: {}, manifiesto: {}, ...extra });
const soporte = (v) => cambioMasivo(v, 'manifiesto', { requiere: false });

test('Remesa anulada y manifiesto rechazado: pasa a soporte interno', () => {
  const r = soporte(viaje({ remesa: { numero: 'R10063375', estado: 'anulado' }, manifiesto: { numero: 'M10063375', estado: 'rechazado' } }));
  assert.deepEqual(r.set, { requiereManifiesto: false });
  assert.ok(soporte(viaje({ remesa: { numero: 'R1', estado: 'rechazado' } })).set);
  assert.ok(soporte(viaje({ manifiesto: { numero: 'M1', estado: 'anulado' }, remesa: { numero: 'R1', estado: 'anulado' } })).set);
});

test('Con remesa o manifiesto vigente en el RNDC no se cambia', () => {
  assert.match(soporte(viaje({ estado: 'remesa', remesa: { numero: 'R1', estado: 'aceptado' } })).omitir, /vigentes en el RNDC/);
  assert.match(soporte(viaje({ remesa: { numero: 'R1', estado: 'aceptado' } })).omitir, /vigentes en el RNDC/);
  assert.match(soporte(viaje({ estado: 'manifestado', manifiesto: { numero: 'M1', estado: 'aceptado' } })).omitir, /vigentes en el RNDC/);
  assert.match(soporte(viaje({ requiereManifiesto: false })).omitir, /Ya va con soporte interno/);
});
