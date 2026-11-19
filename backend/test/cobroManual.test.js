import { test } from 'node:test';
import assert from 'node:assert/strict';
const { lineaLiquidacion } = await import('../src/services/calculos.js');

test('valores escritos a mano en la relación reemplazan la tarifa y el auxiliar del destino', () => {
  const t = { tarifaCliente: 187000, fleteConductor: 150000, tarifaAuxiliar: 100000, auxiliarPagado: 60000 };
  const base = { cantidad: 1, conAuxiliar: true, diasAuxiliar: 2 };
  const a = lineaLiquidacion(base, t);
  assert.equal(a.totalTarifa, 187000); assert.equal(a.totalAuxiliar, 200000);
  const b = lineaLiquidacion({ ...base, cobroManual: { tarifa: 250000, auxiliar: 50000 } }, t);
  assert.equal(b.totalTarifa, 250000); assert.equal(b.totalAuxiliar, 50000); assert.equal(b.totalCobrado, 300000);
  assert.equal(b.totalFlete, 150000);   // al conductor se le paga igual
  const c = lineaLiquidacion({ ...base, cobroManual: { tarifa: null, auxiliar: null } }, t);
  assert.equal(c.totalCobrado, 387000);
});
