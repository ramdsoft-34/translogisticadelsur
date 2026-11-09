// Fase 14: Gmail en la plataforma (reglas puras, sin Google ni base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const G = await import('../src/services/gmail.js');

test('Detecta placas y manifiestos en el asunto', () => {
  assert.deepEqual(G.detectar('MANIFIESTOS CORBETA - 09/11/2026 - Manifiesto M10063289'), { placas: [], manifiestos: ['10063289'] });
  assert.deepEqual(G.detectar('Autorización de salida THE081 - Corbeta'), { placas: ['THE081'], manifiestos: [] });
  assert.deepEqual(G.detectar('CAMBIO DE VEHICULO -QMO374 - OSCAR RAUL MELO; placa svr-489'), { placas: ['QMO374', 'SVR489'], manifiestos: [] });
  assert.deepEqual(G.detectar('Factura 891280005 del 2026'), { placas: [], manifiestos: [] });   // 9 dígitos: no es manifiesto
});

test('Remitente «Nombre <correo>»', () => {
  assert.deepEqual(G.persona('"COOESPATRANS" <despachos@ejemplo.co>'), { nombre: 'COOESPATRANS', correo: 'despachos@ejemplo.co' });
  assert.deepEqual(G.persona('ana@ejemplo.co'), { nombre: 'ana@ejemplo.co', correo: 'ana@ejemplo.co' });
});

test('Partes MIME: texto, HTML y adjuntos', () => {
  const b = (s) => Buffer.from(s).toString('base64url');
  const p = G.partes({ mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b('Hola ñandú') } }, { mimeType: 'text/html', body: { data: b('<p>Hola</p>') } }] },
    { mimeType: 'application/pdf', filename: 'Manifiesto_M10063289.pdf', body: { attachmentId: 'ANGjdJ8', size: 2048 } }] });
  assert.equal(p.texto, 'Hola ñandú');
  assert.equal(p.html, '<p>Hola</p>');
  assert.deepEqual(p.adjuntos, [{ id: 'ANGjdJ8', nombre: 'Manifiesto_M10063289.pdf', tipo: 'application/pdf', tamano: 2048 }]);
});

test('Correo MIME para enviar: respuesta en el mismo hilo, asunto con tildes y adjunto', () => {
  const raw = G.mime({ de: 'cristian@ejemplo.co', para: 'cliente@ejemplo.co', asunto: 'RE: Remesas y cumplidos', texto: 'Adjunto la remesa.\nSaludos',
    enRespuestaA: '<abc@mail.gmail.com>', adjuntos: [{ nombre: 'Remesa 24093.pdf', tipo: 'application/pdf', datos: Buffer.from('%PDF-1.4 prueba') }] });
  const t = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(t, /^From: cristian@ejemplo.co\r\nTo: cliente@ejemplo.co\r\n/);
  assert.match(t, /In-Reply-To: <abc@mail.gmail.com>\r\nReferences: <abc@mail.gmail.com>/);
  assert.match(t, /filename="Remesa 24093.pdf"/);
  assert.ok(t.includes(Buffer.from('%PDF-1.4 prueba').toString('base64')));
  const conTilde = Buffer.from(G.mime({ para: 'a@b.co', asunto: 'Autorización de salida', texto: '' }), 'base64url').toString('utf8');
  assert.match(conTilde, /Subject: =\?UTF-8\?B\?/);
});

test('El estado de OAuth va firmado y vence', () => {
  const e = G.firmarEstado('64b000000000000000000001', '64b000000000000000000002');
  assert.equal(G.leerEstado(e).u, '64b000000000000000000001');
  assert.throws(() => G.leerEstado(e + 'x'), /venció o no es válida/);
  assert.throws(() => G.leerEstado(''), /venció o no es válida/);
});

test('Resumen de un mensaje de la API', () => {
  const r = G.resumenMensaje({ id: 'm1', threadId: 'h1', snippet: 'Buenos días', internalDate: String(Date.UTC(2026, 10, 9, 15, 42)), labelIds: ['INBOX', 'UNREAD'],
    payload: { headers: [{ name: 'From', value: 'COOESPATRANS <d@e.co>' }, { name: 'Subject', value: 'MANIFIESTOS CORBETA' }], parts: [{ filename: 'a.pdf', body: { attachmentId: 'x' } }] } });
  assert.equal(r.asunto, 'MANIFIESTOS CORBETA');
  assert.equal(r.noLeido, true);
  assert.equal(r.conAdjuntos, true);
  assert.equal(r.de.correo, 'd@e.co');
});

test('Estilo Gmail: De con nombre, Cco, HTML con texto alterno y logo de la firma incrustado', () => {
  assert.equal(G.remitente('Cristian Salcedo', 'c@e.co'), 'Cristian Salcedo <c@e.co>');
  assert.match(G.remitente('José Peña', 'j@e.co'), /^=\?UTF-8\?B\?.+\?= <j@e.co>$/);
  const logo = { tipo: 'image/png', datos: Buffer.from('PNGFALSO').toString('base64') };
  const t = Buffer.from(G.mime({ de: 'Cristian Salcedo <c@e.co>', para: 'a@b.co', cco: 'oculto@b.co', asunto: 'Prueba', texto: 'Hola',
    html: '<p><b>Hola</b></p><img src="cid:logo-firma">', logo, adjuntos: [{ nombre: 'm.pdf', tipo: 'application/pdf', datos: Buffer.from('x') }] }), 'base64url').toString('utf8');
  assert.match(t, /\r\nBcc: oculto@b.co\r\n/);
  const orden = ['multipart/mixed', 'multipart/related', 'multipart/alternative', 'text/plain', 'text/html', 'Content-ID: <logo-firma>', 'filename="m.pdf"'].map((x) => t.indexOf(x));
  assert.ok(orden.every((i) => i > 0), 'faltan partes');
  assert.deepEqual([...orden].sort((x, y) => x - y), orden);
  // Sin logo en el HTML no se adjunta la imagen; sin HTML queda solo texto
  const sinLogo = Buffer.from(G.mime({ para: 'a@b.co', asunto: 'x', texto: 'y', html: '<p>y</p>', logo }), 'base64url').toString('utf8');
  assert.ok(!sinLogo.includes('multipart/related') && sinLogo.includes('multipart/alternative'));
  assert.match(Buffer.from(G.mime({ para: 'a@b.co', asunto: 'x', texto: 'y' }), 'base64url').toString('utf8'), /^To: a@b.co\r\nSubject: x\r\nMIME-Version: 1.0\r\nContent-Type: text\/plain/);
});
