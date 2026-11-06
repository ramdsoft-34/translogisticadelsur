// Fase 12: remesas de los clientes (reglas puras, sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../src/services/gestion/remesasDulces.js');
const d = (s) => new Date(`${s}T00:00:00Z`);
const T1 = 'FACTURA COOESPATRANS DEL 29 AL 31 DE OCTUBRE DEL 2026';
const T2 = 'FACTURA COOESPATRANS ECOM DEL 29 AL 31 DE OCTUBRE DEL 2026';
const ENC = ['FECHA DE PLANILLA', 'VPL/PLANILLA', 'ZONA', 'PESO Kg', 'MANIFIESTO ', 'CONDUCTOR', 'PLACA', 'REMESA', 'COSTO DEL VIAJE'];
// Como llega del Excel de Dulces & Dulces: dos tablas, títulos combinados, una remesa sin viaje y un subtotal mal sumado
const HOJA = [
  Array(9).fill(T1), ENC,
  [d('2026-10-29'), 12407, 'PASTO', 2395, 'URBANO', 'OSCAR CALVACHI', 'LFX399', 24093, 229000],
  [d('2026-10-29'), 12411, 'CATAMBUCO', 924, 'URBANO', 'IVAN MEJIA ', 'WPU594', 24095, 135000],
  [null, null, null, null, null, null, null, 24094, null],
  ['SUBTOTAL', null, null, null, null, null, null, null, 364000],
  Array(9).fill(T2), ENC,
  [d('2026-10-29'), 684, 'TAT ECOM NESTLE ENTREGA JUEVES 291026', 100, 'URBANO', 'JUAN ESTRELLA ', 'SVR-489', 24096, 200000],
  ['SUBTOTAL', null, null, null, null, null, null, null, 764000],
  ['TOTAL', null, null, null, null, null, null, null, 1128000],
];

test('Columnas por su encabezado (FECHA DE PLANILLA es la fecha, VPL/PLANILLA el VPL)', () => {
  assert.deepEqual(ENC.map(R.columnaDe), ['fecha', 'vpl', 'zona', 'peso', 'manifiesto', 'conductor', 'placa', 'remesa', 'costo']);
  assert.equal(R.columnaDe('VALOR FLETE'), 'costo'); assert.equal(R.columnaDe('RUTA'), 'zona'); assert.equal(R.columnaDe('OTRA'), null);
});

test('Lee las dos tablas, salta títulos y subtotales, y separa ECOM', () => {
  const b = R.leerFilas([HOJA]);
  assert.deepEqual(b.filas.map(x => x.vpl), ['12407', '12411', '684']);
  assert.deepEqual(b.filas.map(x => x.grupo), ['', '', 'ECOM']);
  assert.equal(b.filas[1].conductor, 'IVAN MEJIA'); assert.equal(b.filas[2].placa, 'SVR489');
  assert.deepEqual(b.sinViaje, ['24094']);
  assert.deepEqual(b.subtotales.map(s => [s.dice, s.suma]), [[364000, 364000], [764000, 200000]]);
  assert.deepEqual([b.total.dice, b.total.suma], [1128000, 564000]);
});

test('Revisión: remesa sin viaje, subtotal y total que no cuadran, remesas usadas y consecutivo', () => {
  const b = R.leerFilas([HOJA]);
  const a = R.revisarBase(b, { usadas: new Map([['24096', '999']]) });
  const tipos = a.map(x => x.tipo);
  assert.ok(tipos.includes('sin_viaje')); assert.match(a.find(x => x.tipo === 'sin_viaje').texto, /24094/);
  assert.match(a.find(x => x.tipo === 'subtotal').texto, /\$ 764\.000.*\$ 200\.000/);
  assert.match(a.find(x => x.tipo === 'total').texto, /\$ 564\.000/);
  assert.match(a.find(x => x.tipo === 'remesa_usada').texto, /24096 \(VPL 999\)/);
  assert.ok(!tipos.includes('salto'));   // el 24094 se explica con la fila sin viaje
  const sinNum = R.revisarBase({ filas: [{ vpl: '1', remesa: '' }] }, { siguiente: 24108 });
  assert.match(sinNum.find(x => x.tipo === 'asignar').texto, /desde la 24108/);
});

test('Cédula del conductor por nombre (exacto o con todas las palabras, sin confundir)', () => {
  const ts = [{ numId: '98400608', nombres: 'Iván Darío', apellido1: 'Mejía', apellido2: 'Ortiz' }, { numId: '1', nombres: 'Juan', apellido1: 'Estrella' }, { numId: '2', nombres: 'Juan', apellido1: 'Estrella', apellido2: 'Paz' }];
  assert.equal(R.buscarPorNombre('IVAN MEJIA', ts).numId, '98400608');
  assert.equal(R.buscarPorNombre('JUAN ESTRELLA', ts).numId, '1');   // exacto gana
  assert.equal(R.buscarPorNombre('ESTRELLA', ts), null);
  assert.equal(R.buscarPorNombre('PEDRO PEREZ', ts), null);
});

test('Textos de la remesa como en el formato de la cooperativa', () => {
  assert.equal(R.fechaLarga(d('2026-09-16'), 'Pasto-Nariño'), 'Pasto,  16 de septiembre de 2026');
  assert.equal(R.pesoTexto(2584), '2584,0');
  assert.equal(R.fleteTexto(229000), '229.000,0');
  assert.deepEqual(R.ordenar([{ remesa: '24095', vpl: '2' }, { remesa: '', vpl: '1' }, { remesa: '24093', vpl: '3' }]).map(x => x.vpl), ['3', '2', '1']);
  const f = R.formatoPorDefecto({ nombre: 'Cooespatrans', nit: '900109959', dv: '2', ciudad: 'Pasto' }, { nombre: 'Dulces & Dulces' });
  assert.equal(f.nit, 'NIT.900109959-2'); assert.equal(f.remitente, 'Dulces & Dulces'); assert.equal(f.porHoja, 2); assert.equal(f.linea, true);
});

test('PDF de 1 y 2 remesas por hoja y .zip con un PDF por remesa', async () => {
  const f = R.formatoPorDefecto({ nombre: 'Cooespatrans', nit: '900109959' }, { nombre: 'Dulces & Dulces' });
  const lista = R.leerFilas([HOJA]).filas;
  const dos = await R.remesasPdf(f, lista, { porHoja: 2, linea: true });
  const una = await R.remesasPdf(f, lista, { porHoja: 1 });
  assert.equal(dos.subarray(0, 4).toString(), '%PDF');
  const paginas = (b) => (b.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.equal(paginas(dos), 2); assert.equal(paginas(una), 3);
  const zip = await R.remesasZipVarios(lista.slice(0, 2).map(x => ({ x, f })));
  assert.equal(zip.subarray(0, 2).toString(), 'PK');
});
