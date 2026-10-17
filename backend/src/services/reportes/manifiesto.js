// Copia impresa del Manifiesto Electrónico de Carga con código QR.
// El texto del QR sigue el manual RNDC v3.0, sección 8.6.6: datos en orden
// MEC, Fecha (AAAA/MM/DD), Placa, Remolque (si hay), Config, Orig (20), Dest (20),
// Mercancia (30), Conductor, Empresa (30), Obs (si el RNDC las entregó, 120) y
// Seguro; separados por CR+LF y sin CR+LF después del último.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Municipio, Vehiculo, Viaje, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { contextoViaje, nitEmpresa } from '../rndc/documentos.js';
import { fmtMilManifiesto, numeroALetras, quitarTildes, txt, enColombia, fmtFechaHora } from '../../utils/texto.js';
import { NATURALEZA_CARGA, RESPONSABLE_PAGO } from '../rndc/catalogos.js';
import { pdfABuffer } from './comun.js';
import { fileURLToPath } from 'node:url';

// Logos oficiales del formato del manifiesto (tomados de un manifiesto expedido por el RNDC)
const LOGO_TRANSPORTE = fileURLToPath(new URL('../../assets/logos/transporte.jpg', import.meta.url));
const LOGO_SUPERTRANSPORTE = fileURLToPath(new URL('../../assets/logos/supertransporte.jpg', import.meta.url));
// Margen de la hoja (el formato del RNDC deja unos 30 pt alrededor)
const MARGEN = 28;

const dd = (n) => String(n).padStart(2, '0');
const fechaRndc = (d) => { if (!d) return ''; const f = new Date(d); return `${f.getUTCFullYear()}/${dd(f.getUTCMonth() + 1)}/${dd(f.getUTCDate())}`; };
const sinTildes = (s) => quitarTildes(s).toUpperCase();
const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');

export function textoQR(d) {
  const p = (s, n) => sinTildes(s).slice(0, n);
  const datos = [`MEC:${d.radicado}`, `Fecha:${d.fechaExp}`, `Placa:${d.placa}`];
  if (d.remolque) datos.push(`Remolque:${d.remolque}`);
  datos.push(`Config:${d.config}`, `Orig:${p(d.origen, 20)}`, `Dest:${p(d.destino, 20)}`, `Mercancia:${p(d.mercancia, 30)}`,
    `Conductor:${d.condDoc}`, `Empresa:${p(d.empresa, 30)}`);
  if (d.qrObs) datos.push(`Obs:${p(d.qrObs, 120)}`);
  datos.push(`Seguro:${d.seguro}`);
  return datos.join('\r\n');
}

async function textoMunicipio(codigo) {
  if (!codigo) return '';
  const m = await Municipio.findOne({ codigo }).lean();
  return m ? sinTildes(`${m.nombre} ${m.departamento}`) : codigo;
}

// Reúne los datos del manifiesto de un viaje de la empresa.
export async function datosManifiesto(empresa, viajeId) {
  const v = await Viaje.findOne({ empresa: empresa._id, _id: viajeId })
    .populate(['cliente', 'conductor', 'titular', 'tarifaRef'].map(x => pob(empresa._id, x))).lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.manifiesto?.estado !== 'aceptado' && v.estado !== 'cumplido') throw new ErrorHttp(409, 'El viaje no tiene un manifiesto aceptado por el RNDC');
  const vehiculo = await Vehiculo.findOne({ empresa: empresa._id, placa: v.placa }).lean();
  const ctx = contextoViaje(empresa, v, vehiculo);
  const cfg = empresa.rndc || {};
  const titular = v.titular || v.conductor;
  const flete = Number(v.flete) || 0;
  const rete = Number(ctx.RETEFUENTE) || 0;
  const ica = Math.round(flete * (Number(cfg.reteIca) || 0) / 1000);
  const fopat = cfg.aplicarFopat ? Number(ctx.FOPAT) || 0 : 0;
  const neto = flete - rete - ica - fopat;
  return {
    empresa: empresa.nombre, empNit: `${empresa.nit}${empresa.dv ? `-${empresa.dv}` : ''}`, empDir: empresa.direccion,
    empTel: empresa.telefono, empCiudad: empresa.ciudad,
    numero: v.manifiesto.numero, radicado: v.manifiesto.radicado, seguro: v.manifiesto.qr, qrObs: v.manifiesto.qrObs,
    fechaRad: v.manifiesto.fecha ? fmtFechaHora(v.manifiesto.fecha) : '',
    fechaExp: fechaRndc(v.fecha), fechaPago: ctx.FECHA_PAGO,
    tipo: ctx.OPERACION === 'U' ? 'Municipal o urbano' : 'General',
    origen: await textoMunicipio(ctx.COD_ORIGEN), destino: await textoMunicipio(ctx.COD_DESTINO),
    placa: v.placa, remolque: v.remolque || '', config: vehiculo?.configuracionNombre || vehiculo?.configuracion || '',
    marca: vehiculo?.marcaNombre || vehiculo?.marca || '', pesoVacio: vehiculo?.pesoVacio ?? '',
    soatAseg: vehiculo?.aseguradoraSoat || vehiculo?.soat?.aseguradoraNit || '', soatNum: vehiculo?.soat?.numero || '',
    soatVence: fechaRndc(vehiculo?.soat?.vence),
    titular: nombre(titular), titDoc: titular?.numId || '', titDir: titular?.direccion || '', titTel: titular?.celular || titular?.telefono || '',
    titCiudad: await textoMunicipio(titular?.codMunicipio),
    condNom: nombre(v.conductor), condDoc: v.conductor?.numId || '', condDir: v.conductor?.direccion || '',
    condTel: v.conductor?.celular || v.conductor?.telefono || '', condLic: v.conductor?.licencia?.numero || '',
    condCiudad: await textoMunicipio(v.conductor?.codMunicipio),
    remesa: v.remesa?.numero || '', unidad: (cfg.unidadMedida || '1') === '1' ? 'Kilogramos' : 'Galones',
    cantidad: Number(v.pesoKg) || 0, naturaleza: NATURALEZA_CARGA[cfg.naturalezaCarga || '1'] || '',
    mercancia: cfg.mercancia?.descripcion || '', mercanciaCod: cfg.mercancia?.codigo || '',
    remNit: ctx.NIT_CLIENTE, remNom: v.cliente?.razonSocial || v.cliente?.nombre || '',
    desNit: ctx.DEST_ID, desSede: v.destino,
    dueno: (cfg.poliza?.dueno || 'E') === 'E' ? 'Empresa de transporte' : 'Generador de carga',
    flete, rete, ica, fopat, neto, anticipo: Number(v.anticipo) || 0, saldo: neto - (Number(v.anticipo) || 0),
    lugarPago: await textoMunicipio(cfg.codMunicipioPagoSaldo) || sinTildes(empresa.ciudad),
    carguePor: RESPONSABLE_PAGO[cfg.responsablePagoCargue || 'E'], descarguePor: RESPONSABLE_PAGO[cfg.responsablePagoDescargue || 'E'],
    observaciones: v.observaciones || '', nitEmpresa: nitEmpresa(empresa),
  };
}

const ALTURAS = [20, 20, 20, 20, 20, 20, 15, 15, 14, 16, 15, 15, 15, 15, 16, 15, 15, 15, 15, 15, 16,
  17, 17, 17, 17, 17, 17, 17, 17, 27, 17, 17, 17, 12];
const LEY = '"La impresión en soporte cartular (papel) de este acto administrativo producido por medios electrónicos en cumplimiento de la ley 527 de 1999 (artículos 6 al 13) y de la ley 962 de 2005 (artículo 6), es una reproducción del documento original que se encuentra en formato electrónico en la Base de Datos del RNDC en el Ministerio de Transporte, cuya representación digital goza de autenticidad, integridad y no repudio"';
const FRAUDE = 'Si es víctima de algún fraude o conoce de alguna irregularidad en el Registro Nacional de Despachos de Carga RNDC denúnciela a la Superintendencia de Transporte, línea gratuita nacional 018000 915615.';

export async function manifiestoPdf(d) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: MARGEN, info: { Title: `Manifiesto ${d.numero}` } });
  const anchoUtil = doc.page.width - 2 * MARGEN;
  const altoUtil = doc.page.height - 2 * MARGEN;
  const k = Math.min(1, altoUtil / ALTURAS.reduce((a, b) => a + b, 0));
  const colW = anchoUtil / 24;
  const filaY = [MARGEN];
  ALTURAS.forEach((h, i) => filaY.push(filaY[i] + h * k));
  const X = (c) => MARGEN + (c - 1) * colW;

  const caja = (r1, c1, r2, c2, etq, valor, { tam = 9, alin = 'left', borde = true, negr = false, fondo = null, vcentro = false } = {}) => {
    const x = X(c1); const y = filaY[r1 - 1]; const w = X(c2 + 1) - x; const h = filaY[r2] - y;
    if (fondo) doc.rect(x, y, w, h).fill(fondo);
    if (borde) doc.rect(x, y, w, h).lineWidth(0.7).strokeColor('black').stroke();
    let ty = y + 1.5;
    if (etq) {
      doc.fillColor('black').font('Helvetica-Bold').fontSize(6.5 * k);
      const hEtq = doc.heightOfString(etq, { width: w - 4 });
      doc.text(etq, x + 2, ty, { width: w - 4 });
      ty += Math.max(7.5 * k, hEtq + 1);
    }
    const fs = tam * k;
    const texto = String(valor ?? '');
    if (vcentro && !etq) {
      const hTxt = doc.font(negr ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs).heightOfString(texto, { width: w - 4 });
      ty = y + Math.max(1, (h - hTxt) / 2);
    }
    doc.fillColor('black').font(negr ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs)
      .text(texto, x + 2, ty, { width: w - 4, height: Math.max(1, y + h - ty), align: alin, ellipsis: true });
  };
  const titulo = (r, c1, c2, t) => caja(r, c1, r, c2, '', t, { tam: 10, alin: 'center', negr: true, fondo: '#D9D9D9', vcentro: true });

  // Logos: Ministerio de Transporte (arriba) y Superintendencia de Transporte (abajo), como el formato oficial
  const lx = X(1); const lw = X(4) - X(1) - 6;
  doc.image(LOGO_TRANSPORTE, lx, filaY[0], { fit: [lw, filaY[4] - filaY[0] - 2], align: 'left', valign: 'center' });
  doc.image(LOGO_SUPERTRANSPORTE, lx, filaY[4] + 1, { fit: [lw, filaY[6] - filaY[4] - 2], align: 'left', valign: 'center' });
  caja(1, 4, 1, 14, '', 'MANIFIESTO ELECTRÓNICO DE CARGA', { tam: 13, alin: 'center', borde: false, negr: true, vcentro: true });
  caja(2, 4, 2, 14, '', d.empresa, { tam: 11, alin: 'center', borde: false, negr: true, vcentro: true });
  caja(3, 4, 3, 14, '', `NIT: ${d.empNit}`, { tam: 10, alin: 'center', borde: false, negr: true, vcentro: true });
  caja(4, 4, 4, 14, '', [d.empDir, d.empTel ? `Tel: ${d.empTel}` : '', d.empCiudad].filter(Boolean).join('   '), { tam: 9, alin: 'center', borde: false, vcentro: true });
  caja(1, 15, 4, 20, '', LEY, { tam: 6, borde: false });
  caja(5, 15, 5, 20, '', `Manifiesto: ${d.numero}`, { tam: 12, borde: false, negr: true, fondo: '#E6E6E6', vcentro: true });
  caja(6, 15, 6, 20, '', `Autorización: ${d.radicado}`, { tam: 12, borde: false, negr: true, fondo: '#E6E6E6', vcentro: true });
  caja(5, 4, 6, 7, 'FECHA Y HORA DE RADICACIÓN', d.fechaRad, { tam: 10 });
  const qx = X(21); const qy = filaY[0]; const qw = X(25) - qx; const qh = filaY[6] - qy;
  if (d.seguro && d.radicado) {
    const png = await QRCode.toBuffer(textoQR(d), { errorCorrectionLevel: 'L', margin: 0, scale: 6 });
    const lado = Math.min(qw, qh) - 6;
    doc.image(png, qx + (qw - lado) / 2, qy + 3, { width: lado, height: lado });
  } else {
    caja(1, 21, 6, 24, '', 'SIN CÓDIGO QR (el RNDC no entregó el código de seguridad)', { tam: 7, alin: 'center', vcentro: true });
  }
  caja(7, 1, 8, 3, 'FECHA DE EXPEDICIÓN', d.fechaExp, { tam: 10 });
  caja(7, 4, 8, 6, 'TIPO DE MANIFIESTO', d.tipo, { tam: 8 });
  caja(7, 7, 8, 15, 'ORIGEN DEL VIAJE', d.origen, { tam: 10 });
  caja(7, 16, 8, 24, 'DESTINO DEL VIAJE', d.destino, { tam: 10 });
  titulo(9, 1, 24, 'INFORMACIÓN DEL TITULAR, VEHÍCULO Y CONDUCTOR');
  caja(10, 1, 11, 6, 'TITULAR DEL MANIFIESTO', d.titular);
  caja(10, 7, 11, 10, 'DOCUMENTO', d.titDoc);
  caja(10, 11, 11, 17, 'DIRECCIÓN', d.titDir);
  caja(10, 18, 11, 19, 'TELÉFONO', d.titTel);
  caja(10, 20, 11, 24, 'CIUDAD', d.titCiudad);
  caja(12, 1, 13, 2, 'PLACA', d.placa, { tam: 10 });
  caja(12, 3, 13, 5, 'MARCA', d.marca, { tam: 8 });
  caja(12, 6, 13, 7, 'PLACA REMOLQUE', d.remolque);
  caja(12, 8, 13, 9, 'CONFIGURACIÓN', d.config, { tam: 10 });
  caja(12, 10, 13, 11, 'PESO VACÍO', d.pesoVacio, { tam: 10 });
  caja(12, 12, 13, 17, 'ASEGURADORA SOAT', d.soatAseg, { tam: 8 });
  caja(12, 18, 13, 21, 'N° PÓLIZA SOAT', d.soatNum);
  caja(12, 22, 13, 24, 'VENCE SOAT', d.soatVence, { tam: 8 });
  caja(14, 1, 15, 6, 'CONDUCTOR', d.condNom);
  caja(14, 7, 15, 10, 'DOCUMENTO', d.condDoc);
  caja(14, 11, 15, 15, 'DIRECCIÓN', d.condDir);
  caja(14, 16, 15, 17, 'TELÉFONO', d.condTel);
  caja(14, 18, 15, 20, 'N° LICENCIA', d.condLic, { tam: 8 });
  caja(14, 21, 15, 24, 'CIUDAD', d.condCiudad);
  titulo(16, 1, 24, 'INFORMACIÓN DE LA MERCANCÍA TRANSPORTADA');
  caja(17, 1, 20, 2, 'N° REMESA', d.remesa);
  caja(17, 3, 20, 4, 'UNIDAD', d.unidad);
  caja(17, 5, 20, 6, 'CANTIDAD', fmtMilManifiesto(d.cantidad));
  caja(17, 7, 20, 8, 'NATURALEZA', d.naturaleza, { tam: 8 });
  caja(17, 9, 20, 12, 'PRODUCTO TRANSPORTADO', `${d.mercanciaCod}\n${d.mercancia}`, { tam: 8 });
  caja(17, 13, 20, 18, 'REMITENTE / LUGAR DE CARGUE', `${d.remNit}  ${d.remNom}\n${d.origen}`, { tam: 8 });
  caja(17, 19, 20, 22, 'DESTINATARIO / LUGAR DE DESCARGUE', `${d.desNit}\n${d.desSede}\n${d.destino}`, { tam: 8 });
  caja(17, 23, 20, 24, 'DUEÑO PÓLIZA', d.dueno, { tam: 8 });
  titulo(21, 1, 9, 'VALORES');
  titulo(21, 10, 16, 'PAGO DEL SALDO');
  titulo(21, 17, 24, 'OBSERVACIONES');
  const valores = [['VALOR TOTAL DEL VIAJE', d.flete], ['RETENCIÓN EN LA FUENTE', d.rete], ['RETENCIÓN ICA', d.ica],
    ['RETENCIÓN FOPAT', d.fopat], ['VALOR NETO A PAGAR', d.neto], ['VALOR ANTICIPO', d.anticipo], ['SALDO A PAGAR', d.saldo]];
  valores.forEach(([e, v], i) => {
    caja(22 + i, 1, 22 + i, 5, '', e, { tam: 8, alin: 'center', borde: false, vcentro: true });
    caja(22 + i, 6, 22 + i, 9, '', fmtMilManifiesto(v), { tam: 9, alin: 'right', vcentro: true });
  });
  caja(22, 10, 23, 11, '', 'LUGAR DE PAGO', { tam: 7, borde: false, vcentro: true });
  caja(22, 12, 23, 14, '', d.lugarPago, { tam: 8, alin: 'center', vcentro: true });
  caja(22, 15, 23, 16, '', d.fechaPago, { tam: 8, alin: 'center', vcentro: true });
  caja(24, 10, 24, 16, '', 'CARGUE PAGADO POR', { tam: 7, borde: false, vcentro: true });
  caja(25, 10, 25, 16, '', d.carguePor, { tam: 9, alin: 'center', vcentro: true });
  caja(26, 10, 26, 16, '', 'DESCARGUE PAGADO POR', { tam: 7, borde: false, vcentro: true });
  caja(27, 10, 27, 16, '', d.descarguePor, { tam: 9, alin: 'center', vcentro: true });
  caja(22, 17, 29, 24, '', d.observaciones, { tam: 8 });
  doc.rect(X(1), filaY[21], X(10) - X(1), filaY[29] - filaY[21]).lineWidth(0.7).stroke();
  doc.rect(X(10), filaY[21], X(17) - X(10), filaY[29] - filaY[21]).lineWidth(0.7).stroke();
  caja(30, 1, 30, 24, 'VALOR TOTAL DEL VIAJE EN LETRAS:', numeroALetras(d.flete), { tam: 8 });
  caja(31, 1, 33, 8, '', FRAUDE, { tam: 6 });
  caja(31, 9, 33, 16, '', 'Firma y huella del TITULAR DEL MANIFIESTO o ACEPTACIÓN DIGITAL', { tam: 8, negr: true });
  caja(31, 17, 33, 24, '', 'Firma y huella del CONDUCTOR o ACEPTACIÓN DIGITAL', { tam: 8, negr: true });
  const c = enColombia();
  caja(34, 1, 34, 24, '', `Copia impresa generada por ${d.empresa} el ${c.getUTCFullYear()}/${dd(c.getUTCMonth() + 1)}/${dd(c.getUTCDate())}. El documento oficial está en el RNDC del Ministerio de Transporte.`, { tam: 6, borde: false });
  return pdfABuffer(doc);
}

export const nombreArchivo = (d) => `Manifiesto_${txt(d.numero) || 'sin_numero'}.pdf`;
