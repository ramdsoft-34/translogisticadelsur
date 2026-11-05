// Fase 9: el manifiesto que recibe el conductor (reglas puras, sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const MC = await import('../src/services/manifiestoConductor.js');

test('Celular para WhatsApp: 10 dígitos que empiezan por 3, con o sin 57', () => {
  assert.equal(MC.numeroWhatsapp('312 000 0002'), '573120000002');
  assert.equal(MC.numeroWhatsapp('+57 312-000-0002'), '573120000002');
  assert.equal(MC.numeroWhatsapp('0'), '', 'el «0» de los manifiestos sin teléfono no sirve');
  assert.equal(MC.numeroWhatsapp('6027201234'), '', 'un fijo no tiene WhatsApp');
});

test('Vigencia del enlace: anulado, cumplido, sin aceptar o vencido', () => {
  const hoy = new Date('2026-11-05T12:00:00Z');
  const base = { estado: 'manifestado', manifiesto: { estado: 'aceptado' }, envioConductor: { creado: new Date('2026-11-04T12:00:00Z') } };
  assert.equal(MC.motivoNoVigente(base, hoy), '');
  assert.match(MC.motivoNoVigente({ ...base, manifiesto: { estado: 'anulado' } }, hoy), /ANULADO/);
  assert.match(MC.motivoNoVigente({ ...base, estado: 'cumplido' }, hoy), /cumplió/);
  assert.match(MC.motivoNoVigente({ ...base, manifiesto: { estado: '' } }, hoy), /no está aceptado/);
  assert.match(MC.motivoNoVigente({ ...base, envioConductor: { creado: new Date('2026-10-01T12:00:00Z') } }, hoy), /venció/);
  assert.match(MC.motivoNoVigente(null, hoy), /no existe/);
});

test('Mensaje de WhatsApp con el primer nombre, la ruta y el enlace', () => {
  const t = MC.mensajeConductor({ conductor: { nombres: 'MARIO FERNANDO', apellido1: 'CHAÑAG' }, manifiesto: 'M10063242', placa: 'SOA217',
    origen: 'CATAMBUCO PASTO NARINO', destino: 'BARBACOAS NARINO', remesa: 'R10063242', empresa: 'COOESPATRANS' }, 'https://x.co/m/abc', new Date('2026-11-05T13:00:00Z'));
  assert.match(t, /^Buenos días, Mario\./);
  assert.match(t, /\*Manifiesto:\* M10063242\n\*Placa:\* SOA217\n\*Ruta:\* CATAMBUCO PASTO NARINO → BARBACOAS NARINO\n\*Remesa:\* R10063242/);
  assert.match(t, /https:\/\/x\.co\/m\/abc\n\nFeliz viaje\. COOESPATRANS$/);
});

test('El enlace no se puede adivinar y tiene la forma esperada', () => {
  const a = MC.nuevoToken(); const b = MC.nuevoToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{16}$/);
  assert.match(MC.enlaceDe(a), new RegExp(`/m/${a}$`));
});
