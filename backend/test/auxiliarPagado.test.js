// Auxiliar ya pagado: el viaje reportado el mismo día ya se canceló; el registrado después queda pendiente
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auxiliarYaPagado } from '../src/services/calculos.js';
import { lineaConductor } from '../src/services/gestion/liquidacionConductor.js';

test('auxiliar pagado: regla por día de registro y lo marcado a mano', () => {
  const fecha = new Date('2026-11-09T00:00:00Z');
  assert.equal(auxiliarYaPagado({ fecha, createdAt: new Date('2026-11-09T22:00:00Z') }), true, 'reportado el mismo día (5 p. m. Colombia)');
  assert.equal(auxiliarYaPagado({ fecha, createdAt: new Date('2026-11-10T03:00:00Z') }), true, '10 p. m. del 9 en Colombia');
  assert.equal(auxiliarYaPagado({ fecha, createdAt: new Date('2026-11-11T15:00:00Z') }), false, 'registrado después (relación de fletes)');
  assert.equal(auxiliarYaPagado({ fecha, createdAt: new Date('2026-11-09T15:00:00Z'), auxiliarPagado: false }), false, 'desmarcado a mano');
  assert.equal(auxiliarYaPagado({ fecha, createdAt: new Date('2026-11-12T15:00:00Z'), auxiliarPagado: true }), true, 'marcado a mano');
  assert.equal(auxiliarYaPagado({ fecha: new Date('2026-10-08T00:00:00Z'), createdAt: new Date('2026-10-30T20:00:00Z') }), true, 'importado del Excel');
});

test('liquidación: el auxiliar pagado se muestra pero no suma al saldo (ejemplo de Jairo Bolaños)', () => {
  const reglas = { retefuentePct: 0, fopatPct: 0, pbvFopat: 0, ciudadesSinFopat: [], ciudadesAnticipoCero: [] };
  const pend = lineaConductor({ flete: 485000, auxiliar: 180000, anticipo: 200000 }, reglas);
  const pag = lineaConductor({ flete: 485000, auxiliar: 180000, auxiliarPagado: true, anticipo: 200000 }, reglas);
  assert.equal(pend.saldo, 465000); assert.equal(pend.auxiliarPagado, false);
  assert.equal(pag.saldo, 285000); assert.equal(pag.auxiliarPagado, true);
  assert.equal(lineaConductor({ flete: 100, auxiliar: 0, auxiliarPagado: true }, reglas).auxiliarPagado, false, 'sin auxiliar no se marca');
});
