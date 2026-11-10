import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coincidePorNombre } from '../src/services/gestion/conductorViaje.js';

const jairoB = { _id: 'a', nombres: 'JAIRO FERNANDO', apellido1: 'BOLAÑOS', apellido2: 'PASUY' };
const jairoL = { _id: 'b', nombres: 'JAIRO', apellido1: 'LOPEZ', apellido2: '' };
const jairoB2 = { _id: 'c', nombres: 'JAIRO', apellido1: 'BOLAÑOS', apellido2: 'ERAZO' };

test('conductor de viaje importado: coincide por nombre corto entre los de la placa', () => {
  assert.equal(coincidePorNombre('Jairo Bolaños', [jairoB, jairoL])?._id, 'a');
  assert.equal(coincidePorNombre('jairo bolanos', [jairoB, jairoL, jairoB])?._id, 'a', 'sin tildes y sin repetir');
  assert.equal(coincidePorNombre('Jairo Bolaños', [jairoB, jairoB2]), null, 'dos posibles: no adivina');
  assert.equal(coincidePorNombre('Pedro Pérez', [jairoB]), null);
  assert.equal(coincidePorNombre('', [jairoB]), null);
});
