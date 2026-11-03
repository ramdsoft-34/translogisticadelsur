// Fase 7B: remesa con el formato del RNDC como soporte interno para el cumplido (no se envía por correo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { remesaPdf, nombreRemesa, OPERACION_REMESA, CONSOLIDACION } = await import('../src/services/reportes/remesa.js');
const plantilla = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../src/assets/remesa-rndc.json', import.meta.url)), 'utf8'));

const base = { empresa: 'COOPERATIVA DE TRANSPORTES ESPANA', empNit: '9001099592', numero: 'R10062847', radicado: '169528474', operacion: 'General',
  remNom: 'DISTRUIDORA DULCES Y DULCES', remCita: '2026/10/10', remHora: '12:00', desCita: '2026/10/10', desHora: '20:00', pesoKg: 1360 };

test('Plantilla de la remesa: hoja carta, cajas y rótulos del RNDC, sin datos de una remesa en particular', () => {
  assert.deepEqual(plantilla.pagina, [612, 792]);
  assert.ok(plantilla.dibujos.length > 40);
  const rotulos = plantilla.textos.map(t => t.texto);
  for (const r of ['REMESA de CARGA  - RNDC', 'Remitente / Lugar de Cargue:', 'Destinatario / Lugar de Descargue:', 'Fecha Hora Cita', 'Tiempo Pactado'])
    assert.ok(rotulos.includes(r), r);
  assert.ok(!rotulos.some(r => /R10062847|169528474|COOPERATIVA/.test(r)), 'consecutivo, autorización y empresa van como datos');
});

test('PDF de la remesa: con propuesta, con cumplido enviado y sin propuesta', async () => {
  const propuesta = { cargueMonitoreado: true, descargueMonitoreado: false, entradaCargue: { fecha: '2026-10-10', hora: '12:00' }, salidaCargue: { fecha: '2026-10-10', hora: '13:00' },
    llegada: { fecha: '2026-10-10', hora: '19:45' }, entrada: { fecha: '2026-10-10', hora: '20:00' }, salida: { fecha: '2026-10-10', hora: '21:00' },
    fuente: { descargue: 'cita de descargue' }, fechaLimiteManifiesto: { fecha: '2026-10-16' }, revision: { bloqueantes: ['prueba'], avisos: [] } };
  for (const d of [{ ...base, propuesta }, { ...base, cumplido: { tipo: 'C', cantidad: '1360', entradaCargue: '2026/10/10 12:00', entrada: '2026/10/10 20:20' } }, base]) {
    const pdf = await remesaPdf(d);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 5000);
  }
  assert.equal(nombreRemesa(base), 'Remesa_R10062847.pdf');
  assert.equal(OPERACION_REMESA.P, 'Mercancía Consolidada');
  assert.equal(CONSOLIDACION.D, 'Distribución a varios puntos');
});
