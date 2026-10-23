// El RNDC devuelve todo el historial de una placa sin orden: se debe tomar el registro vigente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.JWT_SECRET ||= crypto.randomBytes(32).toString('hex');
const { registroVigente } = await import('../src/services/rndc/operaciones.js');

test('Vehículo RNDC: se toma el registro con el SOAT más reciente aunque venga en medio de la lista (caso SPK308)', () => {
  const fechas = ['27/02/2016', '27/02/2016', '9/07/2027', '27/02/2016', '27/02/2017', '28/02/2018', '1/03/2020', '5/03/2022', '30/06/2023', '4/07/2024', '6/07/2025'];
  const docs = fechas.map((f, i) => ({ numplaca: 'SPK308', fechavencimientosoat: f, numsegurosoat: String(i), numidtenedor: i === 2 ? '1085337767' : '12958618' }));
  const d = registroVigente(docs);
  assert.equal(d.fechavencimientosoat, '9/07/2027');
  assert.equal(d.numidtenedor, '1085337767', 'el tenedor sale del mismo registro vigente');
});

test('Vehículo RNDC: con un solo registro o sin fechas se usa el último', () => {
  assert.equal(registroVigente([{ a: 1 }]).a, 1);
  assert.equal(registroVigente([{ a: 1, fechavencimientosoat: '' }, { a: 2, fechavencimientosoat: '' }]).a, 2);
  assert.equal(registroVigente([]), null);
});
