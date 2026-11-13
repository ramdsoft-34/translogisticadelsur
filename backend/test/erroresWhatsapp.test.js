import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aclararError, errorClaro } from '../src/services/erroresWhatsapp.js';

test('Errores de WhatsApp: el código de Meta se explica en palabras claras y se conserva', () => {
  const t = aclararError('131026: Message Undeliverable.');
  assert.match(t, /^No se pudo entregar: ese celular no tiene WhatsApp activo/);
  assert.match(t, /\(código 131026 · Message Undeliverable\.\)$/);
  assert.match(errorClaro(132001, 'template name does not exist'), /plantilla de WhatsApp no existe/);
  assert.match(errorClaro(190, ''), /token de acceso de WhatsApp venció/);
  // Lo que no es un código conocido queda igual
  assert.equal(aclararError('El conductor no ha autorizado recibir mensajes por WhatsApp'), 'El conductor no ha autorizado recibir mensajes por WhatsApp');
  assert.equal(aclararError('99999: Algo raro'), '99999: Algo raro');
  assert.equal(errorClaro(99999, 'Algo raro'), '99999: Algo raro');
  assert.equal(aclararError(''), '');
});
