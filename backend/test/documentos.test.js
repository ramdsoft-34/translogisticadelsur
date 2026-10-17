import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextoViaje, variablesRemesa } from '../src/services/rndc/documentos.js';
import { problemasMaestro } from '../src/services/rndc/operaciones.js';
import { variablesTercero } from '../src/services/rndc/documentos.js';

const empresa = { nit: '900109959', dv: '2', rndc: {} };
const cliente = { tipoId: 'N', nit: '8909009431', dv: '', sedeRemitente: '1' };

test('Remesa: sin destinatario propio, el destinatario es el cliente con su sede', () => {
  const v = { fecha: new Date(), cliente, conductor: {}, destinatario: { tipoId: '', numId: '', sede: '' } };
  const vars = Object.fromEntries(variablesRemesa(empresa, v, contextoViaje(empresa, v, null), 'R1'));
  assert.equal(vars.NUMIDDESTINATARIO, '8909009431');
  assert.equal(vars.CODSEDEDESTINATARIO, '1');
  // Con destinatario propio se usa su sede
  const v2 = { ...v, destinatario: { tipoId: 'N', numId: '900555111', sede: '3' } };
  const vars2 = Object.fromEntries(variablesRemesa(empresa, v2, contextoViaje(empresa, v2, null), 'R1'));
  assert.equal(vars2.CODSEDEDESTINATARIO, '3');
});

test('Terceros: la licencia solo se exige a conductores', () => {
  const titular = { tipoId: 'C', numId: '52532526', nombres: 'LISBETH', apellido1: 'FUERTES', direccion: 'LA UNION', codMunicipio: '52399000', roles: ['titular'] };
  assert.deepEqual(problemasMaestro(11, variablesTercero(empresa, titular), titular), []);
  const conductor = { ...titular, roles: ['conductor'] };
  const p = problemasMaestro(11, variablesTercero(empresa, conductor), conductor);
  assert.ok(p.some(x => x.startsWith('NUMLICENCIACONDUCCION')));
});
