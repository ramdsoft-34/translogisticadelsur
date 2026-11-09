// Estándares mínimos, plan de mejora y calendario de obligaciones (reglas puras, sin base de datos)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const E = await import('../src/services/sst/estandares.js');
const O = await import('../src/services/sst/obligaciones.js');

// Autoevaluación de COOESPATRANS vigencia 2025 registrada en ALISSTA (Positiva): 8,5 %, crítico
const ALISSTA_2025 = Object.fromEntries(E.ESTANDARES.map((e) => [e.numeral, 'NC']));
for (const n of ['1.1.1', '1.1.4', '1.1.5', '1.2.3', '2.3.1', '2.5.1', '2.11.1', '3.1.8']) ALISSTA_2025[n] = 'C';

test('60 ítems que suman 100 y pesos de cada ciclo según la Res. 0312', () => {
  assert.equal(E.ESTANDARES.length, 60);
  assert.equal(Math.round(E.ESTANDARES.reduce((s, e) => s + e.peso, 0) * 100) / 100, 100);
  for (const c of E.CICLOS) {
    const suma = E.ESTANDARES.filter((e) => E.cicloDe(e.numeral) === c.ciclo).reduce((s, e) => s + e.peso, 0);
    assert.equal(Math.round(suma * 100) / 100, c.peso, c.nombre);
  }
});

test('ALISSTA 2025 da 8,5 % crítico, con el detalle por ciclo', () => {
  const r = E.calcular(ALISSTA_2025);
  assert.equal(r.total, 8.5);
  assert.equal(r.nivel.clave, 'critico');
  assert.equal(r.nivel.mesesAvance, 3);
  assert.deepEqual(r.conteos, { C: 8, NC: 52, NA: 0, sinCalificar: 0 });
  assert.deepEqual(r.ciclos.map((c) => c.obtenido), [7.5, 1, 0, 0]);
  assert.ok(r.completa);
});

test('No aplica vale el peso; sin calificar no cuenta y deja la evaluación incompleta', () => {
  const r = E.calcular([{ numeral: '1.1.6', estado: 'NA' }, { numeral: '5.1.1', estado: 'C' }]);
  assert.equal(r.total, 5.5);
  assert.equal(r.completa, false);
  assert.equal(r.conteos.sinCalificar, 58);
});

test('Niveles del artículo 28: crítico < 60, moderado hasta 85, aceptable > 85', () => {
  assert.equal(E.nivelDe(59.99).clave, 'critico');
  assert.equal(E.nivelDe(60).clave, 'moderado');
  assert.equal(E.nivelDe(85).clave, 'moderado');
  assert.equal(E.nivelDe(85.5).clave, 'aceptable');
  assert.equal(E.nivelDe(70).mesesAvance, 6);
  assert.equal(E.nivelDe(90).mesesAvance, null);
});

test('Plan de mejora: una acción por ítem que no cumple, lo de más peso primero y con plazo según el peso', () => {
  const desde = new Date('2026-04-27T17:00:00Z');
  const ac = E.accionesDeMejora(ALISSTA_2025, { desde, responsable: 'Cristian Salcedo' });
  assert.equal(ac.length, 52);
  assert.deepEqual(ac.slice(0, 2).map((a) => a.numeral), ['5.1.1', '5.1.2']);
  assert.equal(ac[0].evidencia, 'Plan de prevención y respuesta ante emergencias');
  assert.equal(ac[0].responsable, 'Cristian Salcedo');
  assert.equal(Math.round((ac[0].fecha - desde) / 864e5), 60);                       // peso 5 → 60 días
  assert.equal(Math.round((ac.find((a) => a.numeral === '1.1.2').fecha - desde) / 864e5), 120);  // peso 0,5 → 120 días
  assert.ok(ac.every((a) => a.titulo && a.ciclo));
});

test('Meta para salir del nivel crítico', () => {
  const m = E.metaSalida(ALISSTA_2025);
  assert.equal(m.total, 8.5);
  assert.ok(m.llega >= 60 && m.necesarias > 0 && m.necesarias < 52);
  assert.deepEqual(E.metaSalida(Object.fromEntries(E.ESTANDARES.map((e) => [e.numeral, 'C']))), { total: 100, necesarias: 0, llega: 100 });
});

test('Calendario del año: obligaciones anuales, mensuales y trimestrales sin repetir clave', () => {
  const l = O.ocurrencias(2027);
  const claves = new Set(l.map((o) => o.clave));
  assert.equal(claves.size, l.length);
  assert.equal(l.filter((o) => o.obligacion === 'vigia').length, 12);
  assert.equal(l.filter((o) => o.obligacion === 'comite-vial').length, 4);
  const reg = l.find((o) => o.clave === 'registro-mintrabajo@2027');
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(reg.fecha), '2027-07-31');
  assert.ok(l.every((o) => ['MinTrabajo', 'ARL', 'MinTransporte', 'Supertransporte'].includes(o.entidad) && o.norma));
  // Fin de mes que no existe: el 30 de febrero queda en el último día
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(l.find((o) => o.clave === 'vigia@2027-02').fecha), '2027-02-28');
});

test('El resultado crítico agenda el informe de avances a la ARL a 3 meses', () => {
  const r = O.obligacionesPorResultado({ vigencia: 2025, fecha: new Date('2026-04-27T17:00:00Z'), nivel: E.nivelDe(8.5) });
  assert.equal(r.length, 1);
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(r[0].fecha), '2026-07-27');
  assert.equal(O.obligacionesPorResultado({ vigencia: 2025, fecha: new Date(), nivel: E.nivelDe(90) }).length, 0);
});

// Sugerencias de cumple / no cumple con los datos de la plataforma
const V = await import('../src/services/sst/evidencias.js');
const base = {
  responsable: 'Cristian Salcedo', licencia: 'SST-27322-2025', planillas: { cumplimiento: 100 }, actas: 11,
  capacitaciones: { programadas: 9, vencidas: 8, ejecutadas: 7, induccion: 2 }, personas: { total: 22, conExamen: 22 },
  eppFirmados: 30, inspecciones: 290, mantenimiento: { vehiculos: 19, conPreventivo: 17 }, simulacros: 1,
  actividades: { 'matriz-legal': { total: 1, hechas: 1 }, auditoria: { total: 1, hechas: 0 }, indicadores: { total: 12, hechas: 11 } },
  mejora: { total: 51, abiertasVencidas: 0 },
};

test('Sugerencias: con todo al día sugiere cumple y explica de dónde sale', () => {
  const s = V.reglas(base);
  for (const n of ['1.1.1', '1.1.4', '1.1.6', '1.2.1', '1.2.2', '3.1.4', '4.2.4', '4.2.5', '4.2.6', '5.1.2', '2.7.1', '3.3.1', '7.1.1']) assert.equal(s[n].estado, 'C', n);
  assert.equal(s['6.1.2'].estado, 'NC');                    // auditoría pendiente en el plan anual
  assert.match(s['1.2.1'].motivo, /7 de 8/);
  assert.ok(Object.values(s).every((x) => x.motivo && x.fuente));
});

test('Sugerencias: lo que falta sale como no cumple y lo que no se puede saber no se sugiere', () => {
  const s = V.reglas({ ...base, licencia: '', planillas: null, actas: 3, capacitaciones: { programadas: 0, vencidas: 0, ejecutadas: 0, induccion: 0 },
    personas: { total: 22, conExamen: 15 }, mantenimiento: { vehiculos: 19, conPreventivo: 5 }, simulacros: 0, actividades: {}, mejora: { total: 51, abiertasVencidas: 40 } });
  assert.equal(s['1.1.1'].estado, 'NC');
  assert.equal(s['1.1.4'], undefined);                      // sin la app de conductores no se sugiere
  for (const n of ['1.1.6', '1.2.1', '1.2.2', '3.1.4', '4.2.5', '5.1.2', '7.1.1']) assert.equal(s[n].estado, 'NC', n);
  assert.equal(s['2.1.1'], undefined);                      // la política firmada la marca el responsable
  assert.equal(s['2.7.1'], undefined);
});

test('Cada ítem tiene evidencia con nombre (no solo el código) y las obligaciones también', () => {
  assert.ok(E.ESTANDARES.every((e) => e.evidencia && !/^(SST|PESV)-\d+$/.test(e.evidencia)), 'evidencia con nombre');
  assert.ok(O.OBLIGACIONES.every((o) => o.evidencia && !/(^|· )(SST|PESV)-\d+($| ·)/.test(o.evidencia)));
  assert.equal(E.evidenciaTexto('SST-12 · SST-13'), 'Política de SST firmada y divulgada · Objetivos y metas del SG-SST firmados');
});
