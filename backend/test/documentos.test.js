import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextoViaje, variablesRemesa, valoresManifiesto } from '../src/services/rndc/documentos.js';
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

test('Manifiesto: el destino es el municipio de la sede del destinatario (MAN354)', () => {
  const v = { fecha: new Date(), cliente, conductor: {}, codDestino: '52835000', codDestinoSede: '52835031', destinatario: { tipoId: 'N', numId: '8909009431', sede: '131' } };
  assert.equal(contextoViaje(empresa, v, null).COD_DESTINO, '52835031');
  assert.equal(contextoViaje(empresa, { ...v, codDestinoSede: '' }, null).COD_DESTINO, '52835000');
});

test('Valores: anticipo igual al flete se ajusta al neto y FOPAT según el vehículo', () => {
  const emp = { ...empresa, rndc: { retefuentePct: 1, reteIca: 0, aplicarFopat: true } };
  // Como el RNDC: flete 1.130.000, retención 11.300 → neto 1.118.700; anticipo 1.130.000 → 1.118.700, saldo 0
  const a = valoresManifiesto(emp, { flete: 1130000, anticipo: 1130000 }, { pbv: 7500 });
  assert.deepEqual([a.retefuente, a.fopat, a.neto, a.anticipo, a.saldo, a.anticipoAjustado], [11300, 0, 1118700, 1118700, 0, true]);
  // Flete 2.150.000 con FOPAT (exigido por el RNDC): 21.500 + 2.150 → neto 2.126.350; anticipo 1.850.000 → saldo 276.350
  const b = valoresManifiesto(emp, { flete: 2150000, anticipo: 1850000 }, { pbv: null, aplicaFopat: true });
  assert.deepEqual([b.retefuente, b.fopat, b.neto, b.anticipo, b.saldo, b.anticipoAjustado], [21500, 2150, 2126350, 1850000, 276350, false]);
  assert.equal(valoresManifiesto(emp, { flete: 2150000, anticipo: 0 }, { pbv: 12700 }).fopat, 2150, 'PBV mayor a 10.500 kg');
});

test('Manifiesto: el origen es el municipio de la sede del remitente (MAN353)', () => {
  const v = { fecha: new Date(), cliente, conductor: {}, codOrigenSede: '52001001' };
  assert.equal(contextoViaje({ ...empresa, rndc: { codOrigen: '52001033' } }, v, null).COD_ORIGEN, '52001001');
});
