// Fase 10: firma de la asistencia a capacitaciones desde el celular (reglas puras, sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FR = await import('../src/services/sst/firmaRemota.js');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('Plazo y bloqueos del enlace de firma', () => {
  const cap = { estado: 'ejecutada', fecha: new Date('2026-11-13T00:00:00Z') };
  const a = { remota: { token: 'x', intentos: 0 } };
  assert.equal(FR.motivoNoFirma(cap, a, new Date('2026-11-20T12:00:00Z')), '');
  assert.match(FR.motivoNoFirma(cap, a, new Date('2026-12-05T12:00:00Z')), /venció/);
  assert.match(FR.motivoNoFirma({ ...cap, estado: 'cancelada' }, a, new Date('2026-11-14T12:00:00Z')), /cancelada/);
  assert.match(FR.motivoNoFirma(cap, { remota: { intentos: FR.INTENTOS_MAX } }, new Date('2026-11-14T12:00:00Z')), /bloqueó/);
  assert.equal(FR.motivoNoFirma(cap, { remota: { firmado: new Date() } }, new Date('2027-01-01')), '', 'ya firmado: se muestra la constancia');
});

test('La huella cambia si cambia lo firmado', () => {
  const base = { empresa: 'e1', capacitacion: 'c1', tema: 'Manejo defensivo', fecha: '2026-11-13T00:00:00Z', horas: 8, documento: '1083752972', nombre: 'Mario', firmado: '2026-11-13T20:00:00Z', imagen: PNG };
  const h = FR.huellaFirma(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(FR.huellaFirma(base), h);
  assert.notEqual(FR.huellaFirma({ ...base, tema: 'Otro tema' }), h);
  assert.notEqual(FR.huellaFirma({ ...base, imagen: PNG + 'A' }), h);
});

test('Guardar desde la pantalla no borra las firmas que llegaron por el enlace', () => {
  const antes = [{ persona: { id: 'p1' }, documento: '1', firma: { imagen: PNG }, remota: { token: 't1', firmado: new Date('2026-11-13') } },
    { persona: { id: 'p2' }, documento: '2', firma: null, remota: { token: 't2', enviado: new Date('2026-11-12') } }];
  const nuevos = [{ persona: { id: 'p1' }, documento: '1', asistio: false, firma: null }, { persona: { id: 'p2' }, documento: '2', firma: null }, { persona: { id: 'p3' }, documento: '3' }];
  const r = FR.conservarRemotas(antes, nuevos);
  assert.deepEqual([r[0].asistio, r[0].firma.imagen, r[0].remota.token], [true, PNG, 't1']);
  assert.equal(r[1].remota.token, 't2');
  assert.equal(r[2].remota, undefined);
});

test('Mensaje de WhatsApp y evidencia en la planilla', () => {
  const t = FR.mensajeFirma({ nombre: 'MARIO FERNANDO CHAÑAG RODRIGUEZ', tema: 'Manejo defensivo', fecha: '2026-11-13T00:00:00Z', horas: 8, empresa: 'COOESPATRANS' }, 'https://x.co/f/abc', new Date('2026-11-13T19:00:00Z'));
  assert.match(t, /^Buenas tardes, Mario\.\n\nPor favor firme su asistencia a la capacitación:\n\*Manejo defensivo\*\n\*Fecha:\* 13\/11\/2026 · 8 h/);
  const e = FR.evidenciaFirmas([{ nombre: 'Mario', documento: '1083752972', remota: { firmado: '2026-11-13T20:05:00Z', ip: '181.1.2.3', huella: 'abcdef0123456789', ubicacion: { lat: 1.2, lng: -77.3 } } },
    { nombre: 'Ana', documento: '1', firma: { imagen: PNG }, remota: {} }]);
  assert.equal(e, 'Mario (doc. …2972): firmó desde su celular el 13/11/2026 15:05 · IP 181.1.2.3 · con ubicación · código ABCDEF012345');
});
