// Revisión de manifiestos antes de enviar: reglas, aprendizaje del historial y respuesta de la IA (sin base de datos ni red)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigosDe, conocido, esAplicable } from '../src/services/rndc/conocimiento.js';
import { casosDesdeTransacciones, resueltoAntes, patronesQueAplican, diferencias } from '../src/services/rndc/aprendizaje.js';
import { anonimizar, validarRespuesta, textoDe } from '../src/services/rndc/ia.js';
import { hallazgosDeReglas, nivelDe, huellaRevision } from '../src/services/rndc/revision.js';

const xml = (vars) => `<root><acceso><username>X</username><password>*****</password></acceso><variables>${Object.entries(vars).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</variables></root>`;
const PASTO = '52001000'; const CATAMBUCO = '52001001'; const IPIALES = '52356000';
const man = (o = {}) => ({ NUMNITEMPRESATRANSPORTE: '900', NUMMANIFIESTOCARGA: '100', CODOPERACIONTRANSPORTE: 'U', FECHAEXPEDICIONMANIFIESTO: '01/11/2026',
  CODMUNICIPIOORIGENMANIFIESTO: PASTO, CODMUNICIPIODESTINOMANIFIESTO: IPIALES, NUMPLACA: 'ABC123', NUMIDCONDUCTOR: '12345678', NUMIDTITULARMANIFIESTO: '12345678', ...o });

// Rechazos con el texto con que responde el RNDC
const MSG_MAN092 = 'Error MAN092: Para el tipo de operación Viaje Municipal o Urbano el municipio de origen y destino deben ser el mismo';
const MSG_MAN153 = 'Error MAN153: Para operación General los municipios de Origen y Destino diferentes';
const MSG_MAN354 = 'Error MAN354: El municipio destino del manifiesto no corresponde al municipio de la sede del destinatario de la remesa 1234';

test('códigos y rechazos conocidos', () => {
  assert.deepEqual(codigosDe(`${MSG_MAN092}. Error REM019 x`), ['MAN092', 'REM019']);
  assert.equal(conocido(MSG_MAN092).id, 'MAN092');
  assert.equal(conocido(MSG_MAN153).id, 'MAN153');
  assert.equal(conocido(MSG_MAN354).id, 'MAN354');
  assert.equal(conocido('Error XYZ999 algo raro'), null);
  assert.equal(esAplicable('manifiesto', 'CODOPERACIONTRANSPORTE'), true);
  assert.equal(esAplicable('manifiesto', 'NUMPLACA'), false, 'la placa nunca se cambia con un clic');
});

function previa({ tipo = 'U', origen = PASTO, destino = IPIALES, ...o } = {}) {
  return {
    remesaAceptada: false, documentos: { remesa: {}, manifiesto: {} },
    remesa: { variables: [['CONSECUTIVOREMESA', '1'], ['CODSEDEDESTINATARIO', '3']], problemas: [] },
    manifiesto: { variables: Object.entries(man({ CODOPERACIONTRANSPORTE: tipo, CODMUNICIPIOORIGENMANIFIESTO: origen, CODMUNICIPIODESTINOMANIFIESTO: destino })), problemas: [] },
    maestros: [], avisos: [], valores: {}, ultimoError: null, ...o,
  };
}

test('reglas: MAN092 (urbano entre municipios distintos) se detecta antes de enviar con su corrección', () => {
  const h = hallazgosDeReglas(previa({ tipo: 'U', destino: IPIALES }));
  const x = h.find((y) => y.codigo === 'MAN092');
  assert.ok(x, 'debe avisar MAN092');
  assert.equal(x.nivel, 'error');
  assert.deepEqual([x.correccion.variable, x.correccion.valor, x.correccion.antes, x.correccion.aplicable], ['CODOPERACIONTRANSPORTE', 'G', 'U', true]);
  assert.equal(nivelDe(h), 'error');
});

test('reglas: MAN153 (general dentro del mismo municipio) propone «U»; Pasto → Catambuco es el mismo municipio', () => {
  const x = hallazgosDeReglas(previa({ tipo: 'G', destino: CATAMBUCO })).find((y) => y.codigo === 'MAN153');
  assert.equal(x?.correccion.valor, 'U');
  // Ida y regreso dentro del municipio es válido: no se avisa
  assert.equal(hallazgosDeReglas(previa({ tipo: 'I', destino: CATAMBUCO })).length, 0);
  // Urbano dentro del municipio y general entre municipios: todo bien
  assert.equal(nivelDe(hallazgosDeReglas(previa({ tipo: 'U', destino: CATAMBUCO }))), 'ok');
  assert.equal(nivelDe(hallazgosDeReglas(previa({ tipo: 'G', destino: IPIALES }))), 'ok');
});

test('reglas: datos faltantes, maestros y avisos', () => {
  const h = hallazgosDeReglas(previa({ tipo: 'G', remesa: { variables: [], problemas: ['CANTIDADCARGADA: es obligatorio'] },
    maestros: [{ rol: 'Vehículo', referencia: 'ABC123', estado: 'no_existe', faltantes: [] }, { rol: 'Conductor', referencia: 'X', estado: 'enviado', faltantes: [{ etiqueta: 'Celular' }] }],
    avisos: ['El SOAT del vehículo está vencido', 'El flete está en cero'], valores: { anticipoAjustado: true, anticipoRegistrado: 900000, anticipo: 800000 } }));
  assert.equal(h.filter((x) => x.nivel === 'error').length, 4);
  assert.equal(h.find((x) => /flete/.test(x.detalle)).nivel, 'alerta');
  assert.equal(h.find((x) => x.titulo === 'Anticipo ajustado').nivel, 'info');
});

test('huella: cambia si cambia lo que se enviaría o el último rechazo', () => {
  const a = previa(); const b = previa({ tipo: 'G' }); const c = previa({ ultimoError: { proceso: 4, mensaje: 'x', fecha: 1 } });
  assert.notEqual(huellaRevision(a), huellaRevision(b));
  assert.notEqual(huellaRevision(a), huellaRevision(c));
  assert.equal(huellaRevision(a), huellaRevision(previa()));
});

// Historial: el viaje 1 se rechazó con MAN092 y se aceptó al pasar de U a G; el 2, con MAN354, al cambiar el destino
const T = (min) => new Date(Date.UTC(2026, 10, 1, 12, min));
const fallidas = [
  { viaje: 'v1', proceso: 4, mensaje: MSG_MAN092, solicitud: xml(man()), createdAt: T(0) },
  { viaje: 'v1', proceso: 4, mensaje: MSG_MAN092, solicitud: xml(man()), createdAt: T(1) },
  { viaje: 'v2', proceso: 4, mensaje: MSG_MAN354, solicitud: xml(man({ CODOPERACIONTRANSPORTE: 'G', NUMPLACA: 'XYZ987', CODMUNICIPIODESTINOMANIFIESTO: '86001000' })), createdAt: T(2) },
  { viaje: 'v3', proceso: 4, mensaje: 'Error MAN999 sin arreglo', solicitud: xml(man()), createdAt: T(3) },
  { viaje: 'v4', proceso: 4, mensaje: 'Paso4 Expidiendo', solicitud: xml(man()), createdAt: T(4) },
];
const aceptadas = [
  { viaje: 'v1', proceso: 4, solicitud: xml(man({ CODOPERACIONTRANSPORTE: 'G', NUMMANIFIESTOCARGA: '101', FECHAEXPEDICIONMANIFIESTO: '02/11/2026' })), createdAt: T(5) },
  { viaje: 'v2', proceso: 4, solicitud: xml(man({ CODOPERACIONTRANSPORTE: 'G', NUMPLACA: 'XYZ987', CODMUNICIPIODESTINOMANIFIESTO: '86885000' })), createdAt: T(6) },
  { viaje: 'v3', proceso: 3, solicitud: xml({ A: '1' }), createdAt: T(7) },   // otro proceso: no explica el manifiesto
];

test('aprendizaje: diferencias sin numeración ni fechas', () => {
  assert.deepEqual(diferencias(man(), man({ NUMMANIFIESTOCARGA: '9', FECHAEXPEDICIONMANIFIESTO: 'x', CODOPERACIONTRANSPORTE: 'G' })),
    [{ variable: 'CODOPERACIONTRANSPORTE', antes: 'U', despues: 'G' }]);
});

test('aprendizaje: casos desde rechazos que después se aceptaron', () => {
  const casos = casosDesdeTransacciones(fallidas, aceptadas);
  assert.equal(casos.length, 2, 'v1 una vez (dos rechazos iguales), v2; v3 y v4 no se aceptaron');
  const r = resueltoAntes(casos, 'MAN092');
  assert.deepEqual(r.cambios.map((m) => [m.variable, m.antes, m.despues, m.veces]), [['CODOPERACIONTRANSPORTE', 'U', 'G', 1]]);
  assert.equal(resueltoAntes(casos, 'MAN354').cambios[0].despues, '86885000');
  assert.equal(resueltoAntes(casos, 'MAN999').cambios.length, 0);
});

test('aprendizaje: avisa a un viaje parecido que conserva el valor rechazado, y no a uno distinto', () => {
  const casos = casosDesdeTransacciones(fallidas, aceptadas);
  // Misma ruta (origen y destino), mismo conductor, todavía «U»
  const p = patronesQueAplican(casos, { manifiesto: man({ NUMPLACA: 'OTR111' }) }, 'v9');
  assert.equal(p[0]?.codigo, 'MAN092');
  assert.deepEqual([p[0].variable, p[0].antes, p[0].despues], ['CODOPERACIONTRANSPORTE', 'U', 'G']);
  // Ya va como «G»: nada
  assert.equal(patronesQueAplican(casos, { manifiesto: man({ CODOPERACIONTRANSPORTE: 'G', NUMPLACA: 'OTR111' }) }, 'v9').filter((x) => x.codigo === 'MAN092').length, 0);
  // Otra ruta, otro vehículo y otro conductor: no se parece
  assert.equal(patronesQueAplican(casos, { manifiesto: man({ CODMUNICIPIOORIGENMANIFIESTO: '11001000', CODMUNICIPIODESTINOMANIFIESTO: '05001000', NUMPLACA: 'OTR111', NUMIDCONDUCTOR: '1', NUMIDTITULARMANIFIESTO: '1' }) }, 'v9').length, 0);
  // El mismo viaje no se compara consigo mismo
  assert.equal(patronesQueAplican(casos, { manifiesto: man() }, 'v1').filter((x) => x.codigo === 'MAN092').length, 0);
});

test('IA: anonimiza documentos, placas, nombres y teléfonos; conserva códigos y valores', () => {
  const docs = { manifiesto: [['NUMPLACA', 'ABC123'], ['NUMIDCONDUCTOR', '12345678'], ['NUMIDTITULARMANIFIESTO', '12345678'], ['CODMUNICIPIODESTINOMANIFIESTO', IPIALES],
    ['VALORFLETEPACTADOVIAJE', '1500000'], ['OBSERVACIONES', 'Juan Pérez cel 3001234567']], remesa: [['NOMIDTERCERO', 'JUAN PEREZ'], ['NUMCELULARPERSONA', '3001234567']] };
  const a = anonimizar(docs, 'El conductor 12345678 de la placa ABC123 no tiene licencia. Otro 98765432 y XYZ987');
  const m = Object.fromEntries(a.documentos.manifiesto);
  assert.equal(m.NUMPLACA, 'PLACA_1');
  assert.equal(m.NUMIDCONDUCTOR, 'ID_1');
  assert.equal(m.NUMIDTITULARMANIFIESTO, 'ID_1', 'la misma persona lleva la misma marca');
  assert.equal(m.CODMUNICIPIODESTINOMANIFIESTO, IPIALES);
  assert.equal(m.VALORFLETEPACTADOVIAJE, '1500000');
  assert.match(m.OBSERVACIONES, /^TEXTO_\d$/);
  const todo = JSON.stringify(a);
  for (const s of ['ABC123', '12345678', 'JUAN', 'Pérez', '3001234567', '98765432', 'XYZ987']) assert.ok(!todo.includes(s), `no debe salir ${s}`);
  assert.match(a.mensaje, /conductor ID_1 de la placa PLACA_1/);
});

test('IA: valida la respuesta y descarta correcciones imposibles', () => {
  const docs = { manifiesto: [['CODOPERACIONTRANSPORTE', 'U'], ['NUMPLACA', 'PLACA_1']], remesa: [] };
  const r = validarRespuesta(JSON.stringify({ causa: 'x', queHacer: 'y', confianza: 'media', correcciones: [
    { documento: 'manifiesto', variable: 'CODOPERACIONTRANSPORTE', valor: 'G', explicacion: 'ok' },
    { documento: 'manifiesto', variable: 'NUMPLACA', valor: 'ZZZ999', explicacion: 'dato personal: no' },
    { documento: 'manifiesto', variable: 'INVENTADA', valor: '1', explicacion: 'no existe' },
    { documento: 'remesa', variable: 'CODSEDEDESTINATARIO', valor: 'ID_2', explicacion: 'marca: no' },
  ] }), docs);
  assert.deepEqual(r.correcciones.map((c) => [c.variable, c.valor, c.antes, c.aplicable]), [['CODOPERACIONTRANSPORTE', 'G', 'U', true]]);
  assert.equal(validarRespuesta('no es json', docs), null);
  assert.equal(validarRespuesta({ causa: 'a', queHacer: 'b', correcciones: [], confianza: 'rara' }, docs).confianza, 'baja');
});

test('IA: texto de la respuesta de la API de Interactions', () => {
  assert.equal(textoDe({ output_text: '{"a":1}' }), '{"a":1}');
  assert.equal(textoDe({ steps: [{ type: 'thought', content: [] }, { type: 'model_output', content: [{ type: 'text', text: '{"b":2}' }] }] }), '{"b":2}');
  assert.equal(textoDe({}), '');
});
