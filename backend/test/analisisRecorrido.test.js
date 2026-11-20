import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analizarRecorrido, metros } from '../src/services/rastreo/analisis.js';

// Pasto: utilidades para armar recorridos de prueba
const BASE = { lat: 1.2136, lng: -77.2811 };
const mover = (p, norte, este) => ({ lat: p.lat + norte / 110540, lng: p.lng + este / (111320 * Math.cos(p.lat * Math.PI / 180)) });
const T0 = new Date('2026-11-19T22:00:00Z').getTime();
const punto = (p, seg, velocidad = 0) => ({ ...p, velocidad, hora: new Date(T0 + seg * 1000) });

/** Avance en línea recta: [metros] en [segundos], un punto cada [cada] segundos, empezando en el segundo [desde]. */
function tramo(desdeP, norte, este, segundos, desde, cada = 10) {
  const n = Math.max(1, Math.round(segundos / cada)); const out = [];
  const kmh = Math.hypot(norte, este) / segundos * 3.6;
  for (let k = 1; k <= n; k++) out.push(punto(mover(desdeP, norte * k / n, este * k / n), desde + k * segundos / n, kmh));
  return out;
}

test('a pie dentro de un local: las vueltas se vuelven una parada y no suman kilómetros', () => {
  const llegada = mover(BASE, 1000, 0);
  const ida = [punto(BASE, 0, 30), ...tramo(BASE, 1000, 0, 120, 0)];                 // 1 km en moto (30 km/h)
  // 15 minutos caminando por el local, con el GPS saltando hasta 50 m (bajo techo)
  const vueltas = []; let s = 120;
  for (let k = 0; k < 90; k++) { s += 10; vueltas.push(punto(mover(llegada, Math.sin(k * 1.7) * 45, Math.cos(k * 2.3) * 50), s, 2)); }
  const vuelta = tramo(llegada, 0, 800, 100, s);                                      // sigue 800 m
  const clientes = [{ nombre: 'Tienda Éxito', entrega: mover(llegada, 20, 10) }];
  const r = analizarRecorrido([...ida, ...vueltas, ...vuelta], { clientes });
  assert.equal(r.paradas.length, 1);
  assert.ok(r.paradas[0].minutos >= 14 && r.paradas[0].minutos <= 16, `minutos ${r.paradas[0].minutos}`);
  assert.equal(r.paradas[0].cliente, 'Tienda Éxito');
  assert.ok(metros(r.paradas[0], llegada) < 30);
  assert.ok(r.km >= 1.7 && r.km <= 1.9, `km ${r.km}`);       // 1 km + 0,8 km, sin las vueltas
  assert.equal(r.lentos.length, 0);
});

test('trancón avanzando despacio: se conserva el trazado y se marca como tráfico lento', () => {
  const ida = [punto(BASE, 0, 40), ...tramo(BASE, 500, 0, 45, 0)];                    // 500 m normales
  const p1 = mover(BASE, 500, 0);
  const trancon = tramo(p1, 600, 0, 25 * 60, 45, 15);                                  // 600 m en 25 min (1,4 km/h)
  const p2 = mover(p1, 600, 0);
  const sale = tramo(p2, 700, 0, 60, 45 + 25 * 60);
  const r = analizarRecorrido([...ida, ...trancon, ...sale]);
  assert.equal(r.paradas.length, 0, 'un trancón no es una parada');
  assert.equal(r.lentos.length, 1);
  assert.ok(r.lentos[0].minutos >= 24 && r.lentos[0].minutos <= 26);
  assert.ok(Math.abs(r.lentos[0].km - 0.6) <= 0.1);
  assert.ok(Math.abs(r.km - 1.8) <= 0.1, `km ${r.km}`);       // todo cuenta: 0,5 + 0,6 + 0,7
  assert.equal(r.puntos.length, 1 + 5 + 100 + 6);             // no se pierde ningún punto
});

test('carro quieto en un trancón (GPS casi fijo): no es parada', () => {
  const ida = [punto(BASE, 0, 30), ...tramo(BASE, 300, 0, 40, 0)];
  const p1 = mover(BASE, 300, 0);
  const quieto = []; for (let k = 1; k <= 40; k++) quieto.push(punto(mover(p1, (k % 3) - 1, (k % 2) * 2), 40 + k * 10, 0)); // 7 min, ±2 m
  const sale = tramo(p1, 400, 0, 50, 440);
  const r = analizarRecorrido([...ida, ...quieto, ...sale]);
  assert.equal(r.paradas.length, 0);
  assert.equal(r.puntos.length, ida.length + quieto.length + sale.length);
});

test('quieto junto a un cliente cuenta como parada aunque el GPS no se mueva', () => {
  const p1 = mover(BASE, 300, 0);
  const quieto = []; for (let k = 1; k <= 30; k++) quieto.push(punto(mover(p1, (k % 3) - 1, 1), 40 + k * 10, 0));
  const r = analizarRecorrido([punto(BASE, 0, 30), ...tramo(BASE, 300, 0, 40, 0), ...quieto, ...tramo(p1, 400, 0, 50, 340)],
    { clientes: [{ nombre: 'Droguería', entrega: mover(p1, 15, 0) }] });
  assert.equal(r.paradas.length, 1);
  assert.equal(r.paradas[0].cliente, 'Droguería');
});

test('recorrido vacío o con un punto', () => {
  assert.deepEqual(analizarRecorrido([]), { puntos: [], paradas: [], lentos: [], km: 0 });
  assert.equal(analizarRecorrido([punto(BASE, 0)]).puntos.length, 1);
});
