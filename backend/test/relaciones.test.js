// Fase 11: relaciones de cobro (reglas puras, sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const R = await import('../src/services/gestion/relaciones.js');
const d = (s) => new Date(`${s}T00:00:00Z`);

test('Periodo y título como en la relación de la empresa', () => {
  assert.equal(R.periodoTexto(d('2026-10-16'), d('2026-10-31')), 'del 16-31 de octubre 2026');
  assert.equal(R.periodoTexto(d('2026-10-01'), d('2026-10-31')), 'del 1-31 de octubre 2026');
  assert.equal(R.periodoTexto(d('2026-10-25'), d('2026-11-05')), 'del 25 de octubre al 5 de noviembre 2026');
  assert.equal(R.tituloRelacion('Nutrisur Pasto', d('2026-10-16'), d('2026-10-31'), 'Viajeros'),
    'Relación de cargues Nutrisur Pasto para proceso de facturación del 16 al 31 de octubre de 2026 · VIAJEROS');
  assert.equal(R.siglasCliente({ nombre: 'Nutrisur Pasto' }), 'NP');
  assert.equal(R.siglasCliente({ nombre: 'Corbeta', siglas: 'cor' }), 'COR');
  assert.equal(R.siglasCliente({ nombre: 'Dulces & Dulces' }), 'DD');
});

test('Plantilla del correo con los datos de la relación', () => {
  const rel = { numero: 'NP-2026-020', desde: d('2026-10-16'), hasta: d('2026-10-31'), grupo: 'Viajeros', totales: { viajes: 57, total: 38161000 } };
  const datos = R.datosPlantilla(rel, { cliente: { nombre: 'Nutrisur Pasto' }, empresa: { nombre: 'COOESPATRANS' }, usuario: 'Cristian Salcedo', ahora: new Date('2026-11-05T20:00:00Z') });
  assert.equal(R.aplicarPlantilla(R.PLANTILLA_GENERAL.asunto, datos), 'Relación de fletes Nutrisur Pasto del 16-31 de octubre 2026');
  const cuerpo = R.aplicarPlantilla(R.PLANTILLA_GENERAL.cuerpo, datos);
  assert.match(cuerpo, /^Buenas tardes\.\n\nEnvío la respectiva relación de fletes de Nutrisur Pasto, correspondiente al periodo del 16-31 de octubre 2026\./);
  assert.match(cuerpo, /Quedo atento a sus comentarios\.\n\nGracias\.\n\nCristian Salcedo\nCOOESPATRANS$/);
  assert.equal(R.aplicarPlantilla('{total} · {numero} · {otro}', datos), '$ 38.161.000 · NP-2026-020 · {otro}');
});

test('Un bloque por conductor y placa, ordenado por fecha, con totales', () => {
  const f = (conductor, placa, fecha, tarifa, auxiliar, numero) => ({ conductor, placa, fecha: d(fecha), tarifa, auxiliar, numero, destino: 'X' });
  const g = R.agrupar([f('Jairo Bolaños', 'GIM654', '2026-10-31', 187000, 100000, 3), f('Alex Figueroa', 'SPV505', '2026-10-22', 844000, 0, 2),
    f('Jairo Bolaños', 'GIM626', '2026-10-17', 1014000, 0, 1), f('Alex Figueroa', 'SPV505', '2026-10-16', 187000, 100000, 4)]);
  assert.deepEqual(g.map(x => `${x.conductor}·${x.placa}`), ['Alex Figueroa·SPV505', 'Jairo Bolaños·GIM626', 'Jairo Bolaños·GIM654']);
  assert.deepEqual(g[0].filas.map(x => x.n), [1, 2]);
  assert.equal(g[0].filas[0].fecha.toISOString().slice(0, 10), '2026-10-16');
  assert.equal(g[0].totales.total, 1131000);
  const t = R.totalesDe(g.flatMap(x => x.filas));
  assert.deepEqual([t.viajes, t.vehiculos, t.total], [4, 3, 2432000]);
});

test('Revisión: fecha fuera del periodo, reportado tarde, repetido y nombres parecidos', () => {
  const filas = [
    { _id: 'a', numero: 1, conductor: 'Mauricio Cadena', placa: 'EQR425', fecha: d('2026-10-21'), destino: 'Pasto Mayorista 3.0', reportado: d('2026-10-21'), tarifa: 1 },
    { _id: 'b', numero: 2, conductor: 'Maurico Cadena', placa: 'VCR334', fecha: d('2026-10-23'), destino: 'Pasto Mayorista 3.0', reportado: d('2026-10-23'), tarifa: 1 },
    { _id: 'c', numero: 3, conductor: 'Alex Figueroa', placa: 'SPV505', fecha: d('2026-10-30'), destino: 'Pasto Mayorista 3.0', reportado: d('2026-11-05'), tarifa: 1 },
    { _id: 'd', numero: 4, conductor: 'Alex Figueroa', placa: 'SPV505', fecha: d('2026-10-30'), destino: 'Pasto mayorista 3.0', reportado: d('2026-10-30'), tarifa: 1 },
  ];
  const sospechosas = [{ _id: 'x', placa: 'EQR425', fecha: d('2026-11-23'), createdAt: d('2026-10-23') }];
  const a = R.revisar({ filas, desde: d('2026-10-16'), hasta: new Date('2026-10-31T23:59:59Z'), sospechosas, enOtras: new Map([['z', 'NP-2026-019']]) });
  const tipos = a.map(x => x.tipo);
  assert.ok(tipos.includes('fecha')); assert.equal(a.find(x => x.tipo === 'fecha').sugerencia, '2026-10-23');
  assert.ok(tipos.includes('tarde')); assert.match(a.find(x => x.tipo === 'tarde').texto, /6 días después/);
  assert.ok(tipos.includes('repetido'));
  assert.ok(tipos.includes('nombre'));
  assert.match(a.find(x => x.tipo === 'otra').texto, /NP-2026-019/);
  assert.ok(!tipos.includes('ok'));
  assert.equal(R.revisar({ filas: [filas[0]], desde: d('2026-10-16'), hasta: d('2026-10-31') }).at(-1).tipo, 'ok');
  assert.equal(R.nombresParecidos('Jairo Figueroa', 'Alex Figueroa'), false);
});

test('Mensaje de WhatsApp con el enlace de la relación', () => {
  const rel = { numero: 'NP-2026-020', token: 'k9X2mQ7aLp4vT1zB', desde: d('2026-10-16'), hasta: d('2026-10-31'), grupo: 'Viajeros', totales: { viajes: 57, total: 38161000 } };
  const t = R.mensajeWhatsapp(rel, { nombre: 'Ana María' }, { cliente: { nombre: 'Nutrisur Pasto' }, empresa: { nombre: 'COOESPATRANS' }, ahora: new Date('2026-11-05T20:00:00Z') });
  assert.match(t, /^Buenas tardes, Ana\./);
  assert.match(t, /\*Nutrisur Pasto · 16-31 de octubre 2026 · VIAJEROS\*/);
  assert.match(t, /\*Total:\* \$ 38\.161\.000/);
  assert.match(t, /\/r\/k9X2mQ7aLp4vT1zB\n\nGracias\. COOESPATRANS$/);
});
