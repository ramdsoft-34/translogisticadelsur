import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { enCola } from '../src/services/rndc/limitador.js';

test('Limitador RNDC: una petición a la vez y pausa mínima entre peticiones', async () => {
  const antes = { ...env.rndc };
  env.rndc.maxConcurrentes = 1; env.rndc.pausaMs = 60;
  const inicios = []; let activas = 0; let maxActivas = 0;
  const tarea = (i) => enCola(async () => {
    inicios.push(Date.now()); activas += 1; maxActivas = Math.max(maxActivas, activas);
    await new Promise(r => setTimeout(r, 10)); activas -= 1; return i;
  });
  const r = await Promise.all([1, 2, 3, 4].map(tarea));
  assert.deepEqual(r, [1, 2, 3, 4], 'conserva el orden y los resultados');
  assert.equal(maxActivas, 1, 'nunca hay dos peticiones simultáneas');
  for (let i = 1; i < inicios.length; i += 1) assert.ok(inicios[i] - inicios[i - 1] >= 55, `pausa entre peticiones (${inicios[i] - inicios[i - 1]} ms)`);
  Object.assign(env.rndc, antes);
});
