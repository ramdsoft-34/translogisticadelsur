// Fase 15: soportes de anticipos (reglas puras, sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const A = await import('../src/services/anticipos.js');
const WA = await import('../src/services/whatsappMeta.js');

test('Celular del conductor en formato de WhatsApp', () => {
  assert.equal(A.celularWhatsapp('312 821 0691'), '573128210691');
  assert.equal(A.celularWhatsapp('+57 312-821-0691'), '573128210691');
  assert.equal(A.celularWhatsapp('7212345'), '');
  assert.equal(A.celularWhatsapp(''), '');
});

test('Mensaje al conductor: nombre, placa, ruta, fecha de cargue y valor', () => {
  const v = { conductor: { nombres: 'HAROLD', apellido1: 'SALAZAR', apellido2: 'CIFUENTES' }, placa: 'WPU514', cliente: { nombre: 'DSierra' },
    destino: 'Tumaco 5.0', fecha: new Date('2026-11-11T00:00:00Z'), anticipo: 800000 };
  const p = A.datosMensaje(v, { nombre: 'COOESPATRANS' }, 'transferencia');
  assert.equal(p.length, 7);
  assert.equal(p[0], 'Harold');
  assert.equal(p[2], 'le consignó');
  assert.equal(p[4], 'DSierra → Tumaco 5.0');
  assert.equal(p[5], '11/11/2026');
  assert.match(p[6], /800\.000/);
  assert.equal(A.datosMensaje(v, { nombre: 'X' }, 'efectivo')[2], 'le entregó en efectivo');
  const t = A.textoMensaje(p);
  assert.match(t, /Fecha de cargue: \*11\/11\/2026\*/);
  assert.match(t, /WPU514/);
});

test('A quién se paga: titular con cuenta; si no, el conductor', () => {
  const c = { _id: 'c', nombres: 'Juan', banco: { entidad: 'Nequi', cuenta: '3166568899' } };
  const t = { _id: 't', nombres: 'Hernán', banco: { entidad: 'Bancolombia', tipoCuenta: 'ahorros', cuenta: '12345672231' } };
  assert.equal(A.datosPago({ conductor: c, titular: t }).a, 'titular');
  assert.equal(A.datosPago({ conductor: c, titular: { _id: 't', nombres: 'Sin cuenta' } }).a, 'conductor');
  assert.equal(A.datosPago({ conductor: c, titular: null }).cuenta, '3166568899');
  assert.equal(A.ocultarCuenta('12345672231'), '****2231');
});

test('Enlace del mensajero: vencido, anulado o bloqueado', () => {
  const ahora = new Date('2026-11-12T15:00:00Z');
  const e = { vence: new Date('2026-11-13T04:59:59Z'), intentos: 0 };
  assert.equal(A.motivoEnlace(e, ahora), '');
  assert.match(A.motivoEnlace({ ...e, vence: new Date('2026-11-11T00:00:00Z') }, ahora), /venció/);
  assert.match(A.motivoEnlace({ ...e, anulado: new Date() }, ahora), /cerró/);
  assert.match(A.motivoEnlace({ ...e, intentos: A.INTENTOS_MAX }, ahora), /bloqueó/);
  assert.match(A.motivoEnlace(null), /no existe/);
});

test('La sesión depende del enlace y de la cédula', () => {
  const s = A.sesionDe('tokenAAAAAAAAAAA', '1.087.046.522');
  assert.equal(s, A.sesionDe('tokenAAAAAAAAAAA', '1087046522'));
  assert.notEqual(s, A.sesionDe('tokenBBBBBBBBBBBB', '1087046522'));
  assert.notEqual(s, A.sesionDe('tokenAAAAAAAAAAA', '1087046523'));
});

test('Imagen del soporte: solo JPEG/PNG en data URL y con tope', () => {
  assert.ok(A.imagenValida('data:image/jpeg;base64,/9j/4AAQSkZJRg=='));
  assert.ok(!A.imagenValida('data:image/gif;base64,R0lGOD=='));
  assert.ok(!A.imagenValida('https://x.com/a.jpg'));
  assert.ok(!A.imagenValida('data:image/jpeg;base64,' + 'A'.repeat(A.IMAGEN_MAX)));
  assert.ok(A.imagenValida('', { requerida: false }));
});

test('Estados de WhatsApp: nunca retroceden', () => {
  assert.ok(WA.avanza('enviado', 'entregado'));
  assert.ok(WA.avanza('entregado', 'leido'));
  assert.ok(!WA.avanza('leido', 'entregado'));
  assert.ok(!WA.avanza('leido', 'error'));
  assert.ok(WA.avanza('enviado', 'error'));
});

test('Webhook de Meta: estados y firma', () => {
  const datos = { entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.1', status: 'read', timestamp: '1794500000' },
    { id: 'wamid.2', status: 'failed', timestamp: '1794500000', errors: [{ title: 'Número sin WhatsApp' }] },
    { id: 'wamid.3', status: 'raro' }] } }] }] };
  const e = WA.estadosDe(datos);
  assert.equal(e.length, 2);
  assert.equal(e[0].estado, 'leido');
  assert.equal(e[1].error, 'Número sin WhatsApp');
  const cuerpo = Buffer.from(JSON.stringify(datos));
  const firma = `sha256=${crypto.createHmac('sha256', 'secreto').update(cuerpo).digest('hex')}`;
  assert.ok(WA.firmaValida(cuerpo, firma, 'secreto'));
  assert.ok(!WA.firmaValida(cuerpo, firma, 'otro'));
  assert.ok(!WA.firmaValida(cuerpo, '', 'secreto'));
});
