import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextoViaje, variablesRemesa, variablesManifiesto, tipoManifiesto, mismoMunicipio, destinoDistintoTarifa } from '../src/services/rndc/documentos.js';

const empresa = { nit: '900109959', dv: '2', rndc: {} };
const cliente = { tipoId: 'N', nit: '983958386', dv: '', sedeRemitente: '1' };
const viaje = (extra) => ({ fecha: new Date(), cliente, conductor: {}, destinatario: { tipoId: 'N', numId: '983958386', sede: '2' }, ...extra });
const valor = (vars, n) => Object.fromEntries(vars)[n];

test('Mismo municipio: los 5 primeros dígitos (Catambuco es Pasto)', () => {
  assert.equal(mismoMunicipio('52001001', '52001000'), true);
  assert.equal(mismoMunicipio('86001000', '86001000'), true);
  assert.equal(mismoMunicipio('52001000', '52838000'), false);
  assert.equal(mismoMunicipio('', '52838000'), false);
  assert.equal(mismoMunicipio('', ''), false);
});

test('Origen y destino en el mismo municipio: manifiesto municipal o urbano (U); la remesa sigue general', () => {
  const v = viaje({ codOrigen: '86001000', codDestinoSede: '86001000' });   // Mocoa → Mocoa
  const ctx = contextoViaje(empresa, v, null);
  assert.equal(ctx.OPERACION, 'U');
  assert.equal(valor(variablesManifiesto(empresa, v, ctx, 'M1'), 'CODOPERACIONTRANSPORTE'), 'U');
  assert.equal(valor(variablesRemesa(empresa, v, ctx, 'R1'), 'CODOPERACIONTRANSPORTE'), 'G');
  // Pasto → Catambuco (centro poblado de Pasto) también es municipal
  assert.equal(contextoViaje(empresa, viaje({ codOrigen: '52001000', codDestinoSede: '52001001' }), null).OPERACION, 'U');
  // Municipios distintos: general
  assert.equal(contextoViaje(empresa, viaje({ codOrigen: '52001000', codDestinoSede: '86749000' }), null).OPERACION, 'G');
  // El de la empresa vacío o G se cambia; un tipo elegido en la tarifa se respeta
  assert.equal(tipoManifiesto('', '86001000', '86001000'), 'U');
  assert.equal(tipoManifiesto('D', '86001000', '86001000'), 'D');
  assert.equal(contextoViaje(empresa, viaje({ codOrigen: '86001000', codDestinoSede: '86001000', tarifaRef: { operacion: 'I' } }), null).OPERACION, 'I');
});

test('Destino del manifiesto distinto al de la tarifa (caso viaje 986: Alto Putumayo con sede de Túquerres)', () => {
  const v = viaje({ codOrigen: '52001001', codDestino: '52838000', codDestinoSede: '52838000', tarifaRef: { codMunicipio: '86749000' } });
  const x = destinoDistintoTarifa(v, contextoViaje(empresa, v, null));
  assert.deepEqual(x, { tarifa: '86749000', destino: '52838000', otroDepartamento: true });
  // Mismo departamento, otro municipio: se avisa pero no es otro departamento
  const v2 = viaje({ codDestinoSede: '86755000', tarifaRef: { codMunicipio: '86749000' } });
  assert.equal(destinoDistintoTarifa(v2, contextoViaje(empresa, v2, null)).otroDepartamento, false);
  // Igual o sin tarifa: nada
  const v3 = viaje({ codDestinoSede: '86749000', tarifaRef: { codMunicipio: '86749000' } });
  assert.equal(destinoDistintoTarifa(v3, contextoViaje(empresa, v3, null)), null);
  const v4 = viaje({ codDestinoSede: '86749000' });
  assert.equal(destinoDistintoTarifa(v4, contextoViaje(empresa, v4, null)), null);
});
