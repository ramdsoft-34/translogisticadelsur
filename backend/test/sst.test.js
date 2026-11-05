// Fase 8: SG-SST y PESV. Reglas puras (sin base de datos): auto-llenado, membrete, preoperacional y vencimientos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

const A = await import('../src/services/sst/autollenado.js');
const C = await import('../src/services/sst/catalogo.js');
const V = await import('../src/services/sst/vencimientos.js');
const Ck = await import('../src/services/sst/checklistSurTrack.js');
const Pesv = await import('../src/services/sst/pesv.js');
const { nivelPesvSugerido } = await import('../src/routes/sst.js');

const empresa = { nombre: 'COOESPATRANS', nit: '900109959', dv: '2', direccion: 'Cra 67, Casa 4', ciudad: 'San Juan de Pasto', telefono: '3006173837',
  rndc: { razonSocial: 'COOPERATIVA DE TRANSPORTES ESPAÑA - COOESPATRANS' },
  sst: { representanteLegal: 'Miguel David López España', responsableSst: 'Cristian Rubén Salcedo Delgado', arl: 'Positiva', claseRiesgo: 4, nivelPesv: 'basico' } };
const hoy = new Date('2026-11-04T15:00:00Z');
const ctx = A.contexto(empresa, { hoy, numVehiculos: 12, formato: { codigo: 'SST-FOR-01', version: 1, consecutivo: 7 } });
// PNG 2×1 válido (sirve de membrete en las pruebas)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4XmMUCdZlYGAAAALZAJbyWsT2AAAAAElFTkSuQmCC';

async function docx(cuerpo, encabezado = '') {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  z.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:r="r"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="12240"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`);
  if (encabezado) z.file('word/header1.xml', `<?xml version="1.0"?><w:hdr xmlns:w="w">${encabezado}</w:hdr>`);
  return z.generateAsync({ type: 'nodebuffer' });
}
const texto = async (buf, parte = 'word/document.xml') => (await (await JSZip.loadAsync(buf)).file(parte).async('string')).replace(/<[^>]+>/g, '');

test('Contexto: NIT con puntos y DV, clase de riesgo en romanos, fecha de Colombia y ciudad', () => {
  assert.equal(ctx.empresa.nitCompleto, '900.109.959-2');
  assert.equal(ctx.empresa.razonSocial, 'COOPERATIVA DE TRANSPORTES ESPAÑA - COOESPATRANS', 'la razón social del RNDC manda sobre el nombre corto');
  assert.equal(ctx.empresa.claseRiesgo, 'IV');
  assert.equal(ctx.empresa.nivelPesv, 'Básico');
  assert.deepEqual([ctx.fecha.hoy, ctx.fecha.larga, ctx.fecha.ciudadFecha], ['04/11/2026', '4 de noviembre de 2026', 'San Juan de Pasto, 4 de noviembre de 2026']);
  const f = new Set();
  assert.equal(A.reemplazar('NIT {{ empresa.nitCompleto }} · {{empresa.licenciaSst}}', ctx, f), 'NIT 900.109.959-2 · ');
  assert.deepEqual([...f], ['empresa.licenciaSst'], 'un marcador sin dato queda vacío y se avisa');
});

test('Word: marcadores partidos en varios fragmentos de texto se llenan conservando el formato del primero', async () => {
  const p = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>La empresa {{empre</w:t></w:r><w:r><w:t>sa.razonSocial}}, NIT {{</w:t></w:r><w:r><w:t>empresa.nitCompleto}}</w:t></w:r></w:p>';
  const buf = await docx(p, '<w:p><w:r><w:t>{{fecha.hoy}}</w:t></w:r></w:p>');
  assert.deepEqual((await A.marcadoresDocx(buf)).sort(), ['empresa.nitCompleto', 'empresa.razonSocial', 'fecha.hoy']);
  const r = await A.llenarDocx(buf, ctx);
  assert.equal(await texto(r.buffer), 'La empresa COOPERATIVA DE TRANSPORTES ESPAÑA - COOESPATRANS, NIT 900.109.959-2');
  assert.equal(await texto(r.buffer, 'word/header1.xml'), '04/11/2026');
  assert.match((await (await JSZip.loadAsync(r.buffer)).file('word/document.xml').async('string')), /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">La empresa COOPERATIVA/);
});

test('Word: el membrete reemplaza el encabezado y el pie de cada sección', async () => {
  const r = await A.llenarDocx(await docx('<w:p><w:r><w:t>Hola</w:t></w:r></w:p>'), ctx, { membrete: { encabezado: PNG, pie: PNG } });
  const z = await JSZip.loadAsync(r.buffer);
  const doc = await z.file('word/document.xml').async('string');
  assert.match(doc, /<w:headerReference w:type="default" r:id="rIdMembreteheader"\/><w:footerReference w:type="default" r:id="rIdMembretefooter"\/>/);
  assert.ok(z.file('word/media/membrete_header.png') && z.file('word/header_membrete.xml'));
  assert.match(await z.file('[Content_Types].xml').async('string'), /header_membrete\.xml/);
  // Imagen al ancho útil (12240 − 2880 twips) y con su proporción 2:1
  assert.match(await z.file('word/header_membrete.xml').async('string'), /cx="5943600" cy="2971800"/);
});

test('Convertir un formato diligenciado en plantilla: razón social, NIT (también uno mal escrito) y dirección', async () => {
  const p = '<w:p><w:r><w:t>COOPERATIVA DE TRANSPORTES ESPAÑA - COOESPATRANS (NIT 900.109.595-2), en Cra 67, Casa 4. Cooespatrans y 900109959-2</w:t></w:r></w:p>';
  const r = await A.plantillaDesdeDocumento(await docx(p), ctx, [{ texto: '900.109.595-2', marcador: 'empresa.nitCompleto' }]);
  assert.equal(await texto(r.buffer), '{{empresa.razonSocial}} (NIT {{empresa.nitCompleto}}), en {{empresa.direccion}}. {{empresa.razonSocial}} y {{empresa.nitCompleto}}');
  const otra = A.contexto({ nombre: 'Transportes Ejemplo S.A.S.', nit: '901234567', dv: '8', direccion: 'Calle 18' }, { hoy });
  assert.equal(await texto((await A.llenarDocx(r.buffer, otra)).buffer), 'Transportes Ejemplo S.A.S. (NIT 901.234.567-8), en Calle 18. Transportes Ejemplo S.A.S. y 901.234.567-8');
});

test('Excel: marcadores en celdas y logo donde está {{empresa.logo}}', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Hoja');
  ws.getCell('A1').value = '{{empresa.logo}}'; ws.getCell('B1').value = 'CHECKLIST — {{empresa.razonSocial}} (NIT {{empresa.nitCompleto}})';
  ws.getCell('B2').value = { formula: '1+1' };
  const r = await A.llenarXlsx(Buffer.from(await wb.xlsx.writeBuffer()), ctx, { logo: PNG });
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(r.buffer);
  const h = wb2.getWorksheet('Hoja');
  assert.equal(h.getCell('B1').value, 'CHECKLIST — COOPERATIVA DE TRANSPORTES ESPAÑA - COOESPATRANS (NIT 900.109.959-2)');
  assert.equal(h.getImages().length, 1);
  assert.match(h.headerFooter.oddHeader, /900\.109\.959-2/);
});

test('Checklist de Sur Track: crítico en «no» = no apto; vigencia contra el día del viaje; fechas en hora de Colombia', () => {
  const todos = { documentos: { licenciaConduccion: true, seguroSOAT: true, revisionTecnica: true }, equipos: { cinturonesPito: true, luces: true, extintor: true },
    vehiculo: { direccion: true, frenosServicio: true, llantasEstado: true } };
  const c = { ...todos, checklistId: 'ck1', fecha: '2026-11-03T01:08:00Z', completo: true, venceRevisionTecnica: '2027-07-30T00:00:00Z' };
  assert.equal(Ck.diaColombia(c.fecha), '2026-11-02', 'las 8:08 p. m. del 2 de noviembre en Colombia');
  assert.equal(Ck.nombreChecklist('JSN110', c.fecha), 'checklist_JSN110_2026-11-02.pdf');
  assert.equal(Ck.evaluarSurTrack(c, '2026-11-02T00:00:00Z').delDia, true);
  assert.equal(Ck.evaluarSurTrack(c, '2026-11-03T00:00:00Z').delDia, false, 'del día anterior al viaje');
  const extintor = Ck.evaluarSurTrack({ ...c, equipos: { ...todos.equipos, extintor: false } });
  assert.deepEqual([extintor.apto, extintor.fallasCriticas], [true, []]);
  const frenos = Ck.evaluarSurTrack({ ...c, vehiculo: { ...todos.vehiculo, frenosServicio: false } });
  assert.deepEqual([frenos.apto, frenos.fallasCriticas], [false, ['frenosServicio']]);
  const d = Ck.datosSurTrack({ viaje: { numero: 52, fecha: '2026-11-02T00:00:00Z', placa: 'JSN110' }, vehiculo: { venceTecnomecanica: '2027-07-30T00:00:00Z' }, checklist: c });
  assert.deepEqual([d.rtmDeclarada, d.rtm, d.coincide, d.diligenciado], ['30/07/2027', '30/07/2027', 'Sí', '02/11/2026 20:08'], 'sin correrse un día');
  const copia = Pesv.copiaDeChecklist({ ...c, firma: { nombre: 'José Rodríguez', cedula: '1087046502', imagenBase64: 'iVBOR' } }, { viaje: { numero: 52, placa: 'JSN110', fecha: '2026-11-02T00:00:00Z' } });
  assert.deepEqual([copia.checklistId, copia.placa, copia.apto, copia.delDia, copia.items.length], ['ck1', 'JSN110', true, true, 25]);
  assert.equal(copia.items.filter(i => !i.cumple).length, 16, 'los ítems que Sur Track no marcó cuentan como «no cumple»');
  assert.equal(copia.firma.imagen, 'data:image/png;base64,iVBOR');
});

test('Conducción continua: una parada corta no es pausa; una de 15 minutos o más sí', () => {
  const t = (h, m) => new Date(Date.UTC(2026, 10, 4, h, m));
  const ev = [{ tipo: 'inicio', fecha: t(6, 0) }, { tipo: 'detenido', fecha: t(8, 0) }, { tipo: 'en_ruta', fecha: t(8, 5) }, { tipo: 'detenido', fecha: t(10, 30) },
    { tipo: 'en_ruta', fecha: t(11, 0) }, { tipo: 'entrega', fecha: t(12, 0) }, { tipo: 'finalizado', fecha: t(12, 10) }];
  assert.equal(Pesv.conduccionContinua(ev), 265, '2 h + 2 h 25 min seguidos (la parada de 5 min no cuenta)');
  assert.equal(Pesv.conduccionContinua(ev, { pausaMin: 5 }), 145);
  assert.equal(Pesv.conduccionContinua([{ tipo: 'inicio', fecha: t(6, 0) }], { fin: t(11, 0) }), 300, 'viaje sin terminar: hasta el fin indicado');
});

test('Registros: solo se guardan los campos del formato, con su tipo, y las firmas válidas', () => {
  const p = C.plantilla('SST-FOR-07');
  const d = C.limpiarDatos(p, { tema: 'Manejo defensivo', duracion: '8', evaluacion: 1, modalidad: 'Inventada', hackeo: 'x',
    asistentes: [{ nombre: 'Ana', documento: '1', firma: 'javascript:alert(1)' }, { nombre: 'Luis', firma: { imagen: PNG } }] });
  assert.deepEqual([d.tema, d.duracion, d.evaluacion, d.modalidad, d.hackeo], ['Manejo defensivo', 8, true, '', undefined]);
  assert.deepEqual(d.asistentes.map(a => a.firma), ['', PNG]);
});

test('PDF de un formato con y sin membrete', async () => {
  const p = Ck.plantillaSurTrack();
  const datos = { placa: 'SVR022', documentos: { seguroSOAT: { resultado: 'cumple' } }, firma_conductor: PNG };
  for (const membrete of [{}, { encabezado: PNG, pie: PNG, colorPrimario: '#14532d' }]) {
    const pdf = await A.pdfFormato({ plantilla: p, datos, ctx, membrete, logo: PNG });
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  }
  for (const pl of C.PLANTILLAS) assert.equal((await A.pdfFormato({ plantilla: pl, datos: {}, ctx })).subarray(0, 4).toString(), '%PDF', pl.codigo);
});

test('Vencimientos: vencido, en la semana, en el mes; mantenimiento por km o por fecha', () => {
  assert.deepEqual(V.clasificar(new Date('2026-11-03'), hoy), { nivel: 'vencido', dias: -1 });
  assert.deepEqual(V.clasificar(new Date('2026-11-04'), hoy), { nivel: 'semana', dias: 0 }, 'vence hoy: todavía sirve');
  assert.equal(V.clasificar(new Date('2026-11-25'), hoy).nivel, 'mes');
  assert.equal(V.clasificar(new Date('2027-01-30'), hoy), null);
  const m = V.proximoMantenimiento({ cadaKm: 10000, ultimoKm: 175000, cadaDias: 180, ultimaFecha: new Date('2026-06-01') }, 184520);
  assert.deepEqual([m.kmProximo, m.kmFaltan, m.cercaKm, m.porFecha.toISOString().slice(0, 10)], [185000, 480, true, '2026-11-28']);
  assert.equal(V.proximoMantenimiento({ cadaKm: 5000, ultimoKm: 175000 }, 181000).vencidoKm, true);
});

test('PESV: nivel sugerido por tamaño de flota (Res. 40595 de 2022)', () => {
  assert.deepEqual([5, 12, 20, 35, 51].map(nivelPesvSugerido), ['', 'basico', 'estandar', 'estandar', 'avanzado']);
});
