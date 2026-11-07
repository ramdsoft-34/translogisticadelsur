// Numeración desde el RNDC: solo cuenta la serie de la empresa (caso R100632601: un dígito de más no es «el último»)
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.JWT_SECRET ||= 'x'.repeat(64);
const { digitosSerie, ultimoDeLaSerie } = await import('../src/services/rndc/operaciones.js');

test('Un número con un dígito de más no mueve la numeración', () => {
  const rndc = [10063258, 10063259, 10063261, 10063263, 10063264, 100632601, 100632602, 100632603, 100632604];
  assert.equal(digitosSerie(rndc), 8);
  assert.equal(ultimoDeLaSerie(rndc), 10063264, 'el siguiente es R10063265, no R100632605');
});

test('Serie sin datos o con un solo número', () => {
  assert.equal(ultimoDeLaSerie([]), null);
  assert.equal(ultimoDeLaSerie([500]), 500);
  assert.equal(ultimoDeLaSerie([500, 501, 5021]), 501);
});
