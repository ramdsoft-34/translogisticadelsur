// Nombres sin apellidos repetidos, detección de duplicados y causas de errores de WhatsApp (sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreCompleto, nombresSinApellidos, apellidosRepetidos } from '../src/utils/nombres.js';
import { gruposDePersonas, distancia, mismaPersona } from '../src/services/duplicados.js';
import { causaDeTexto, causaDeCodigo, CAUSAS } from '../src/services/erroresWhatsapp.js';
import { nombreCorto } from '../src/services/whatsapp.js';

test('nombre completo: no repite los apellidos que vienen dentro de «nombres»', () => {
  const henry = { nombres: 'NARVAEZ GALLARDO HENRY ARMANDO', apellido1: 'NARVAEZ', apellido2: 'GALLARDO' };
  assert.equal(nombreCompleto(henry), 'HENRY ARMANDO NARVAEZ GALLARDO');
  assert.equal(nombreCompleto({ nombres: 'HENRY ARMANDO NARVAEZ GALLARDO', apellido1: 'NARVAEZ', apellido2: 'GALLARDO' }), 'HENRY ARMANDO NARVAEZ GALLARDO', 'apellidos al final');
  assert.equal(nombreCompleto({ nombres: 'ARTURO ALDEMAR', apellido1: 'NARVAEZ', apellido2: 'CHINGAL' }), 'ARTURO ALDEMAR NARVAEZ CHINGAL', 'lo correcto no cambia');
  assert.equal(nombreCompleto({ nombres: 'Peña Ruiz Ana', apellido1: 'PENA', apellido2: 'ruiz' }), 'Ana PENA ruiz', 'sin tildes ni mayúsculas');
  assert.equal(nombreCompleto({ nombres: 'NARVAEZ', apellido1: 'NARVAEZ', apellido2: '' }), 'NARVAEZ NARVAEZ', 'si solo queda el apellido, se deja como está');
  assert.equal(nombreCompleto({ nombres: 'DISTRIBUIDORA SUR SAS' }), 'DISTRIBUIDORA SUR SAS', 'empresas');
  assert.equal(nombreCompleto(null), '');
  assert.equal(apellidosRepetidos(henry), true);
  assert.equal(nombresSinApellidos('JUAN CARLOS', 'PEREZ', ''), 'JUAN CARLOS');
  assert.equal(nombreCorto(henry), 'Henry Narvaez Gallardo', 'el saludo de WhatsApp usa el primer nombre real');
});

test('duplicados: dígitos cambiados o intercambiados y personas distintas', () => {
  assert.equal(distancia('1085278424', '1085278442'), 1, 'dos vecinos intercambiados');
  assert.equal(distancia('12748409', '1248409'), 1, 'un dígito de menos');
  assert.equal(distancia('1086360629', '1086360329'), 1);
  assert.ok(distancia('98398084', '87215202') > 2);
  const p = (id, numId, nombres, a1, a2) => ({ _id: id, tipoId: 'C', numId, nombres, apellido1: a1, apellido2: a2 });
  const g = gruposDePersonas([
    p('1', '1085278424', 'ALBA LUCIA', 'IPIALES', 'ALPALA'), p('2', '1085278242', 'ALBA LUCIA', 'IPIALES', 'ALPALA'),
    p('3', '98398084', 'ALEXANDER', 'PORTILLA', ''), p('4', '87215202', 'ALEXANDER', 'PORTILLA', ''),   // nombre corto: no se agrupa
    p('5', '27220410', 'AURICIA LUCIA', 'BENAVIDES', ''), p('6', '27.220.410', 'JORMAN', 'PATIÑO', ''),   // mismo documento, distintas personas
    p('7', '00012970603', 'HENRY ARMANDO', 'NARVAEZ', 'GALLARDO'), p('8', '12970603', 'NARVAEZ GALLARDO HENRY ARMANDO', 'NARVAEZ', 'GALLARDO'),
    p('9', '55001234', 'CARLOS', 'RUIZ', 'MORA'), p('10', '99887766', 'CARLOS', 'RUIZ', 'MORA'),   // mismo nombre, documentos muy distintos
  ]);
  const de = (id) => g.find((x) => x.registros.some((r) => r._id === id));
  assert.deepEqual([de('1').motivo, de('1').certeza], ['mismo_nombre', 'media'], 'dos dígitos distintos');
  assert.equal(de('3'), undefined);
  assert.deepEqual([de('5').motivo, de('5').certeza], ['documento_compartido', 'revisar']);
  assert.deepEqual([de('7').motivo, de('7').certeza], ['mismo_documento', 'alta'], 'ceros a la izquierda y apellidos repetidos');
  assert.equal(de('9').certeza, 'baja');
  assert.equal(mismaPersona({ nombres: 'LUISA', apellido1: 'ORTIZ' }, { nombres: 'MAYRA', apellido1: 'ORTIZ' }), false, 'solo los apellidos no bastan');
});

test('WhatsApp: cada error tiene una causa con su explicación y solo sus correcciones', () => {
  assert.equal(causaDeTexto('El conductor no ha autorizado recibir mensajes por WhatsApp (Conductores y terceros)'), 'sin_autorizacion');
  assert.equal(causaDeTexto('El conductor no tiene un celular válido de 10 dígitos (Conductores y terceros)'), 'celular_invalido');
  assert.equal(causaDeTexto('No se pudo entregar: … (código 131026 · Message Undeliverable.)'), 'no_entregado');
  assert.equal(causaDeTexto('La aplicación de Meta no tiene permiso para enviar con este número (código 10 · (#10) Viewer cannot access)'), 'cuenta');
  assert.equal(causaDeTexto('131047: Re-engagement message'), 'meta');
  assert.equal(causaDeCodigo(132001), 'plantilla');
  assert.equal(causaDeTexto(''), '');
  for (const [id, c] of Object.entries(CAUSAS)) {
    assert.ok(c.titulo && c.explicacion && c.pasos.length, id);
    if (['cuenta', 'plantilla'].includes(id)) assert.ok(!c.acciones.includes('celular'), `${id}: no propone cambiar el celular`);
  }
  assert.ok(!CAUSAS.sin_autorizacion.acciones.includes('config'));
});
