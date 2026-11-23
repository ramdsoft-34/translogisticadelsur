// Manifiestos al WhatsApp del cliente: textos de la plantilla y números activos (sin base de datos ni red)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cualManifiesto, manifiestoConPlaca, numerosActivos } from '../src/services/whatsappBusiness.js';
import { explicacionDe } from '../src/services/erroresWhatsapp.js';

test('texto de cada mensaje: cuál manifiesto de la tanda y su placa', () => {
  assert.equal(cualManifiesto(1, 1), 'el manifiesto de carga');
  assert.equal(cualManifiesto(2, 5), 'el manifiesto de carga 2 de 5');
  assert.equal(manifiestoConPlaca({ numero: 'M10063404', placa: 'SET146' }), 'M10063404 (SET146)');
  assert.equal(manifiestoConPlaca({ numero: 'M1', placa: '' }), 'M1');
});

test('números del cliente: solo los activos, válidos y sin repetir', () => {
  const c = { whatsappManifiestos: [
    { nombre: 'Despachos', numero: '3009998877' }, { nombre: 'Repetido', numero: '573009998877' },
    { nombre: 'Apagado', numero: '3105556677', activo: false }, { nombre: 'Malo', numero: '12345' }, { nombre: 'Otro', numero: '3201112233', activo: true },
  ] };
  assert.deepEqual(numerosActivos(c), [{ nombre: 'Despachos', telefono: '573009998877' }, { nombre: 'Otro', telefono: '573201112233' }]);
  assert.deepEqual(numerosActivos(null), []);
});

test('explicación del error según a quién iba: al cliente nunca propone corregir al conductor', () => {
  assert.ok(explicacionDe('no_entregado', 'conductor').acciones.includes('celular'));
  const cli = explicacionDe('no_entregado', 'cliente');
  assert.ok(cli.acciones.includes('cliente') && !cli.acciones.includes('celular'));
  assert.ok(explicacionDe('limite', 'cliente').acciones.includes('reintentar'), 'las causas comunes se conservan');
  assert.ok(explicacionDe('numero_inactivo', 'cliente').acciones.includes('cliente'));
});
