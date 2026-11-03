// Remesa de Carga con el formato que imprime el RNDC (FastReport), como soporte interno para revisar
// la remesa y sacar los datos del cumplido de la remesa y del manifiesto. No se envía por correo.
// El dibujo (cajas, líneas y rótulos) sale de assets/remesa-rndc.json, extraído de una remesa oficial
// con tools/plantillaRemesa.py; cada dato va en la posición medida en esa remesa.
//
// Los datos son los que el RNDC aceptó (variables del XML de la remesa enviada) y los maestros.
// Debajo del formato va el recuadro «Para el cumplido»: citas, tiempos pactados, horas propuestas
// (GPS de Sur Track o tarifa), quién reporta cada punto, plazo del manifiesto y, si ya se cumplió, lo enviado.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { ErrorHttp } from '../../middleware/auth.js';
import { contextoViaje, variablesRemesa } from '../rndc/documentos.js';
import { cargarViaje, variablesEnviadas as enviadas } from '../rndc/operaciones.js';
import { propuestaViaje, CONSOLIDADA_VARIOS_PUNTOS } from '../rndc/tiemposCumplido.js';
import { txt, quitarTildes, soloDigitos, fmtMiles } from '../../utils/texto.js';
import { pdfABuffer } from './comun.js';
import { campo, fechaRndc, lugar, tercero, NATURALEZA_RNDC, DUENO_POLIZA_RNDC } from './manifiesto.js';

const recurso = (r) => fileURLToPath(new URL(`../../assets/${r}`, import.meta.url));
const PLANTILLA = JSON.parse(fs.readFileSync(recurso('remesa-rndc.json'), 'utf8'));
const LOGO_TRANSPORTE = recurso('logos/transporte.jpg');
const LOGO_SUPERTRANSPORTE = recurso('logos/supertransporte.jpg');

const sinTildes = (s) => quitarTildes(s).toUpperCase();
const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].map(txt).filter(Boolean).join(' ') : '');

export const OPERACION_REMESA = { G: 'General', P: 'Mercancía Consolidada', C: 'Contenedor Cargado', V: 'Contenedor Vacío' };
export const CONSOLIDACION = { R: 'Recolección en varios puntos', D: 'Distribución a varios puntos', A: 'Recolección y distribución', N: 'Un cargue y un descargue' };
const EMPAQUE = { 0: 'Paquetes. General Fraccionada en máximo 2 kgs por unidad de empaque' };
// Aseguradoras de la póliza de la carga como las nombra el RNDC (NIT sin dígito de verificación)
const ASEGURADORAS = {
  860028415: 'LA EQUIDAD SEGUROS GENERALES ORGANISMO COOPERATIVO', 860002400: 'LA PREVISORA S.A. COMPAÑIA DE SEGUROS',
  860009578: 'SEGUROS DEL ESTADO S.A.', 860524654: 'ASEGURADORA SOLIDARIA DE COLOMBIA', 891700037: 'MAPFRE SEGUROS GENERALES DE COLOMBIA',
  860002184: 'AXA COLPATRIA SEGUROS S.A.', 860037013: 'COMPAÑIA MUNDIAL DE SEGUROS S.A.', 890903407: 'SEGUROS GENERALES SURAMERICANA S.A.',
  860002180: 'SEGUROS COMERCIALES BOLIVAR S.A.',
};
function aseguradora(nit) {
  const n = soloDigitos(nit);
  if (!n) return '';
  const nombreAseg = ASEGURADORAS[n] || ASEGURADORAS[n.slice(0, 9)] || '';
  return `${nombreAseg} ${n}`.trim();
}
const pactado = (h, m) => (txt(h) || txt(m) ? `${Number(h) || 0} Horas ${Number(m) || 0} Minutos` : '');
const fh = (o) => (o?.fecha ? `${fechaRndc(o.fecha)} ${txt(o.hora)}`.trim() : '');
const fhRndc = (f, h) => (txt(f) ? `${fechaRndc(f)} ${txt(h)}`.trim() : '');

// Reúne los datos de la remesa de un viaje de la empresa.
export async function datosRemesa(empresa, viajeId) {
  const { v, vehiculo } = await cargarViaje(empresa._id, viajeId);
  if (!v.remesa?.numero || (v.remesa.estado !== 'aceptado' && v.estado !== 'cumplido')) throw new ErrorHttp(409, 'El viaje no tiene una remesa aceptada por el RNDC');
  const ctx = contextoViaje(empresa, v, vehiculo);
  const R = (await enviadas(empresa._id, v._id, 3)) || Object.fromEntries(variablesRemesa(empresa, v, ctx, v.remesa.numero));
  const remitente = await tercero(empresa._id, R.CODTIPOIDREMITENTE, R.NUMIDREMITENTE, R.CODSEDEREMITENTE);
  const destinatario = await tercero(empresa._id, R.CODTIPOIDDESTINATARIO, R.NUMIDDESTINATARIO, R.CODSEDEDESTINATARIO);
  const propietario = await tercero(empresa._id, R.CODTIPOIDPROPIETARIO, R.NUMIDPROPIETARIO, R.CODSEDEPROPIETARIO);
  const C5 = await enviadas(empresa._id, v._id, 5);
  let propuesta = null;
  try { propuesta = await propuestaViaje(empresa._id, v._id); } catch { /* sin propuesta: el formato sale igual */ }
  const sede = (t, cod) => sinTildes(t?.sede?.nombre || '') || txt(cod);
  const ident = (tipo, id) => (txt(id) ? `${tipo === 'C' ? 'CC' : 'NIT'}  ${txt(id)}` : '');
  const operacion = txt(R.CODOPERACIONTRANSPORTE) || 'G';
  const consolidacion = operacion === 'P' ? txt(R.TIPOCONSOLIDADA) : '';
  const cliente = sinTildes(v.cliente?.razonSocial || v.cliente?.nombre || '');
  return {
    empresa: txt(empresa.rndc?.razonSocial) || sinTildes(empresa.nombre), empNit: `${empresa.nit}${empresa.dv || ''}`,
    empDir: txt(empresa.direccion), empTel: txt(empresa.telefono), empCiudad: sinTildes(empresa.ciudad || ''),
    numero: v.remesa.numero, radicado: txt(v.remesa.radicado),
    operacion: OPERACION_REMESA[operacion] || operacion, consolidacion, consolidacionTexto: CONSOLIDACION[consolidacion] || '',
    empaque: EMPAQUE[txt(R.CODTIPOEMPAQUE) || '0'] ?? `Código ${txt(R.CODTIPOEMPAQUE)}`,
    generadorNit: txt(R.NUMIDPROPIETARIO), generador: nombre(propietario) || cliente, generadorDir: txt(propietario?.direccion),
    naturaleza: NATURALEZA_RNDC[R.CODNATURALEZACARGA] || '', producto: txt(R.MERCANCIAREMESA), kilos: txt(R.CANTIDADCARGADA),
    mercancia: txt(R.DESCRIPCIONCORTAPRODUCTO),
    remNom: nombre(remitente) || cliente, remId: ident(R.CODTIPOIDREMITENTE, R.NUMIDREMITENTE), remSede: sede(remitente, R.CODSEDEREMITENTE),
    remDir: txt(remitente?.direccion), remMun: await lugar(remitente?.codMunicipio),
    remCita: fechaRndc(R.FECHACITAPACTADACARGUE), remHora: txt(R.HORACITAPACTADACARGUE), remPacto: pactado(R.HORASPACTOCARGA, R.MINUTOSPACTOCARGA),
    desNom: nombre(destinatario), desId: ident(R.CODTIPOIDDESTINATARIO, R.NUMIDDESTINATARIO), desSede: sede(destinatario, R.CODSEDEDESTINATARIO),
    desDir: txt(destinatario?.direccion), desMun: await lugar(destinatario?.codMunicipio),
    desCita: fechaRndc(R.FECHACITAPACTADADESCARGUE), desHora: txt(R.HORACITAPACTADADESCARGUEREMESA), desPacto: pactado(R.HORASPACTODESCARGUE, R.MINUTOSPACTODESCARGUE),
    tomador: DUENO_POLIZA_RNDC[R.DUENOPOLIZA] || DUENO_POLIZA_RNDC.E, poliza: txt(R.NUMPOLIZATRANSPORTE),
    aseguradora: aseguradora(R.COMPANIASEGURO), polizaVence: fechaRndc(R.FECHAVENCIMIENTOPOLIZACARGA),
    observaciones: txt(R.OBSERVACIONES),
    // Para el cumplido
    manifiesto: txt(v.manifiesto?.numero), placa: txt(v.placa), conductor: nombre(v.conductor), pesoKg: v.pesoKg || 0,
    variosPuntos: CONSOLIDADA_VARIOS_PUNTOS.includes(consolidacion), propuesta,
    cumplido: C5 ? {
      cantidad: txt(C5.CANTIDADENTREGADA), tipo: txt(C5.TIPOCUMPLIDOREMESA),
      llegadaCargue: fhRndc(C5.FECHALLEGADACARGUE, C5.HORALLEGADACARGUEREMESA), entradaCargue: fhRndc(C5.FECHAENTRADACARGUE, C5.HORAENTRADACARGUEREMESA),
      salidaCargue: fhRndc(C5.FECHASALIDACARGUE, C5.HORASALIDACARGUEREMESA), llegada: fhRndc(C5.FECHALLEGADADESCARGUE, C5.HORALLEGADADESCARGUECUMPLIDO),
      entrada: fhRndc(C5.FECHAENTRADADESCARGUE, C5.HORAENTRADADESCARGUECUMPLIDO), salida: fhRndc(C5.FECHASALIDADESCARGUE, C5.HORASALIDADESCARGUECUMPLIDO),
      radicado: txt(v.cumplidoRemesa?.radicado),
    } : null,
  };
}

// ── Dibujo ──────────────────────────────────────────────────────────────────
// x a la izquierda (o centro con alin), y = línea base; ancho y líneas para no invadir la casilla vecina.
const C = {
  empresa: { x: 327.9, y: 60.2, tam: 10, negrita: true, alin: 'centro', ancho: 200 },
  nit: { x: 313, y: 72.4, tam: 8, negrita: true, alin: 'centro', ancho: 200 },
  dir: { x: 318, y: 93.8, tam: 8, alin: 'centro', ancho: 190 },
  tel: { x: 319.5, y: 103.3, tam: 8, alin: 'centro', ancho: 190 },
  ciudad: { x: 318.6, y: 112.9, tam: 8, alin: 'centro', ancho: 190 },
  numero: { x: 516, y: 79.5, tam: 10, negrita: true, alin: 'centro', ancho: 110 },
  radicado: { x: 517.3, y: 118.5, tam: 10, negrita: true, alin: 'centro', ancho: 110 },
  operacion: { x: 112.2, y: 155.5, tam: 10, alin: 'centro', ancho: 150, lineas: 2, paso: 9 },
  empaque: { x: 221.1, y: 153.2, tam: 7.5, ancho: 232, lineas: 2, paso: 7.2 },
  generadorNit: { x: 221.2, y: 176.1, tam: 10, ancho: 330 },
  generador: { x: 221.1, y: 196.2, tam: 10, ancho: 330 },
  generadorDir: { x: 221.1, y: 217.5, tam: 10, ancho: 330 },
  naturaleza: { x: 144.4, y: 252.2, tam: 10, ancho: 170 },
  producto: { x: 509.5, y: 252.2, tam: 10, ancho: 60 },
  kilos: { x: 144.6, y: 268.0, tam: 10, ancho: 70 },
  unidades: { x: 512, y: 269.3, tam: 10, ancho: 50 },
  mercancia: { x: 143.7, y: 304.0, tam: 9, ancho: 430 },
  remNom: { x: 141.4, y: 384.3, tam: 8, ancho: 175, lineas: 2, paso: 8 },
  remId: { x: 142.2, y: 405.3, tam: 8, ancho: 175 },
  remSede: { x: 141.4, y: 424.0, tam: 8, ancho: 175 },
  remDir: { x: 141.4, y: 442.4, tam: 8, ancho: 175 },
  remCoord: { x: 142.2, y: 463.8, tam: 8, ancho: 175 },
  remMun: { x: 141.6, y: 482.4, tam: 8, ancho: 175 },
  remCita: { x: 144.4, y: 504.8, tam: 8, ancho: 60 },
  remHora: { x: 209.1, y: 504.0, tam: 8, ancho: 60 },
  remPacto: { x: 224, y: 523.3, tam: 8, alin: 'centro', ancho: 170 },
  remTras: { x: 141.7, y: 543.1, tam: 8, ancho: 60 },
  desNom: { x: 402.4, y: 384.3, tam: 8, ancho: 175, lineas: 2, paso: 8 },
  desId: { x: 404.5, y: 406.3, tam: 8, ancho: 175 },
  desSede: { x: 403.0, y: 423.3, tam: 8, ancho: 175 },
  desDir: { x: 403.7, y: 441.7, tam: 8, ancho: 175 },
  desCoord: { x: 403.7, y: 463.0, tam: 8, ancho: 175 },
  desMun: { x: 403.7, y: 482.0, tam: 8, ancho: 175 },
  desCita: { x: 402.8, y: 501.7, tam: 8, ancho: 60 },
  desHora: { x: 466.3, y: 502.5, tam: 8, ancho: 60 },
  desPacto: { x: 488.3, y: 523.3, tam: 8, alin: 'centro', ancho: 170 },
  desTras: { x: 402.5, y: 543.1, tam: 8, ancho: 60 },
  tomador: { x: 132.9, y: 577.0, tam: 8, alin: 'centro', ancho: 48, lineas: 2, paso: 8.5 },
  poliza: { x: 183.3, y: 579.2, tam: 8, ancho: 60 },
  aseguradora: { x: 360, y: 578.2, tam: 7.5, alin: 'centro', ancho: 215, lineas: 2, paso: 8 },
  polizaVence: { x: 499.8, y: 579.2, tam: 8, ancho: 75 },
  observaciones: { x: 59.5, y: 630, tam: 8, ancho: 520, lineas: 2, paso: 9 },
};

const quien = (monitoreado) => (monitoreado ? 'lo reporta la empresa de monitoreo (RMM)' : 'la empresa reporta llegada y salida (sin monitoreo)');

// Recuadro «Para el cumplido» debajo del formato (hoja carta: de y=685 a y=772)
function paraElCumplido(doc, d) {
  const x = 54.36; const w = 524.4; let y = 684;
  doc.rect(x, y, w, 88).lineWidth(0.75).strokeColor('#000').stroke();
  doc.rect(x, y, w, 12).fillColor('#EDEDED').fill();
  doc.rect(x, y, w, 12).lineWidth(0.75).strokeColor('#000').stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('black')
    .text('PARA EL CUMPLIDO  ·  soporte interno de la empresa (no se envía)', x + 4, y + 9, { lineBreak: false, baseline: 'alphabetic' });
  const linea = (rotulo, texto) => {
    y += 10.5;
    doc.font('Helvetica-Bold').fontSize(7.5).text(rotulo, x + 4, y + 9, { lineBreak: false, baseline: 'alphabetic' });
    campo(doc, { x: x + 74, y: y + 9, tam: 7.5, ancho: w - 80 }, texto);
  };
  linea('Viaje', [d.manifiesto && `Manifiesto ${d.manifiesto}`, d.placa && `Placa ${d.placa}`, d.conductor, `Cargado ${fmtMiles(d.pesoKg)} kg`].filter(Boolean).join('  ·  '));
  const p = d.propuesta;
  if (d.cumplido) {
    const c = d.cumplido;
    linea('Cumplido enviado', `${c.tipo === 'S' ? 'Suspensión' : 'Cumplido normal'}  ·  Entregado ${c.cantidad} kg${c.radicado ? `  ·  Radicado ${c.radicado}` : ''}`);
    linea('Cargue', [c.llegadaCargue && `Llegada ${c.llegadaCargue}`, `Entrada ${c.entradaCargue}`, c.salidaCargue && `Salida ${c.salidaCargue}`].filter(Boolean).join('  ·  '));
    linea('Descargue', [c.llegada && `Llegada ${c.llegada}`, `Entrada ${c.entrada}`, c.salida && `Salida ${c.salida}`].filter(Boolean).join('  ·  '));
  } else if (p) {
    linea('Cargue', `Entrada ${fh(p.entradaCargue)}  ·  Salida ${fh(p.salidaCargue)}  ·  ${quien(p.cargueMonitoreado)}`);
    linea('Descargue', `${p.descargueMonitoreado ? '' : `Llegada ${fh(p.llegada)}  ·  `}Entrada ${fh(p.entrada)}${p.descargueMonitoreado ? '' : `  ·  Salida ${fh(p.salida)}`}  ·  ${quien(p.descargueMonitoreado)}`);
    const f = p.fuente || {};
    linea('Horas propuestas', `Cargue: ${f.salidaCargue || f.cargue || 'cita'}  ·  Descargue: ${f.descargue || 'cita'}${d.variosPuntos ? '  ·  Consolidada en varios puntos: solo entradas (1 h + 1 h)' : ''}`);
  } else linea('Horas', 'Sin propuesta: revise las citas y los tiempos pactados de arriba.');
  if (p?.fechaLimiteManifiesto?.fecha) linea('Plazo', `Cumplido del manifiesto hasta el ${fechaRndc(p.fechaLimiteManifiesto.fecha)} (5 días hábiles desde la entrega)${d.consolidacionTexto ? `  ·  Consolidación: ${d.consolidacionTexto}` : ''}`);
  const alertas = d.cumplido ? [] : [...(p?.revision?.bloqueantes || []), ...(p?.revision?.avisos || [])];
  if (alertas.length) linea('Revisar', alertas.join('  ·  '));
}

export async function remesaPdf(d) {
  const [ancho, alto] = PLANTILLA.pagina;
  const doc = new PDFDocument({ size: [ancho, alto], margin: 0, info: { Title: `Remesa ${d.numero}` } });
  for (const x of PLANTILLA.dibujos) {
    if (x.t === 'r') { if (x.relleno) doc.rect(x.x, x.y, x.w, x.h).fillColor(x.relleno).fill(); if (x.trazo) doc.rect(x.x, x.y, x.w, x.h).lineWidth(x.grosor).strokeColor(x.trazo).stroke(); }
    else doc.moveTo(x.x1, x.y1).lineTo(x.x2, x.y2).lineWidth(x.grosor).strokeColor(x.trazo).stroke();
  }
  for (const t of PLANTILLA.textos) {
    doc.font(t.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(t.tam).fillColor(t.color || 'black').text(t.texto, t.x, t.y, { lineBreak: false, baseline: 'alphabetic' });
  }
  const im = PLANTILLA.imagenes;
  doc.image(LOGO_TRANSPORTE, im.transporte[0], im.transporte[1], { width: im.transporte[2], height: im.transporte[3] });
  doc.image(LOGO_SUPERTRANSPORTE, im.supertransporte[0], im.supertransporte[1], { width: im.supertransporte[2], height: im.supertransporte[3] });
  const operacion = d.consolidacion ? `${d.operacion} (${d.consolidacion})` : d.operacion;
  const v = { ...d, dir: d.empDir, nit: `Nit: ${d.empNit}`, tel: d.empTel ? `Tel: ${d.empTel}` : '', ciudad: d.empCiudad, operacion,
    generadorNit: d.generadorNit ? `NIT - ${d.generadorNit}` : '', unidades: '0', remTras: '0', desTras: '0',
    remCoord: 'Latitud:     Longitud:', desCoord: 'Latitud:     Longitud:' };
  for (const [k, def] of Object.entries(C)) campo(doc, def, v[k]);
  paraElCumplido(doc, d);
  return pdfABuffer(doc, { marca: false });
}

export const nombreRemesa = (d) => `Remesa_${txt(d.numero) || 'sin_numero'}.pdf`;
