// Manifiestos al WhatsApp del cliente: textos de la plantilla y números activos (sin base de datos ni red)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listaManifiestos, cantidadManifiestos, numerosActivos } from '../src/services/whatsappBusiness.js';
import { explicacionDe } from '../src/services/erroresWhatsapp.js';

test('lista de manifiestos: números con placa y, si no cabe, «y N más»', () => {
  assert.equal(listaManifiestos([{ numero: 'M1', placa: 'ABC123' }, { numero: 'M2', placa: '' }]), 'M1 (ABC123), M2');
  const muchos = Array.from({ length: 80 }, (_, i) => ({ numero: `M100634${String(i).padStart(2, '0')}`, placa: 'TDM027' }));
  const t = listaManifiestos(muchos);
  assert.ok(t.length <= 700, `largo ${t.length}`);
  const visibles = t.split(', ').length;
  assert.match(t, new RegExp(` y ${80 - visibles} más$`));
  assert.equal(cantidadManifiestos(1), '1 manifiesto de carga');
  assert.equal(cantidadManifiestos(5), '5 manifiestos de carga');
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
