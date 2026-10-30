// Soporte interno (MC / RC): documento con el formato del manifiesto para los viajes que NO se
// expiden en el RNDC. Numeración propia (MC100000, RC100000…), código de verificación y QR interno.
// No es un documento del RNDC: no se envía al Ministerio ni por correo.
import crypto from 'node:crypto';
import { Empresa, Viaje, Vehiculo, Tercero, Municipio, siguiente, pob } from '../../models/index.js';
import { env } from '../../config/env.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { fmtFecha, txt, soloDigitos } from '../../utils/texto.js';
import { lugarRndc } from '../../utils/lugares.js';
import { idCliente } from '../rndc/documentos.js';
import { fopat, retefuente } from './liquidacionConductor.js';
import { reglasDe } from './reglas.js';

const NUMERO_INICIAL = 100000;          // la plantilla empezó en MC100000
const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
const aaaa = (d) => { const f = new Date(d); return `${f.getUTCFullYear()}/${String(f.getUTCMonth() + 1).padStart(2, '0')}/${String(f.getUTCDate()).padStart(2, '0')}`; };

export const codigoVerificacion = (texto) => crypto.createHash('sha256').update(texto).digest('hex').slice(0, 16).toUpperCase();

async function lugar(codigo) {
  if (!txt(codigo)) return '';
  const m = await Municipio.findOne({ codigo }).lean();
  return m ? lugarRndc(m) : '';
}

// Asigna MC/RC al viaje (una sola vez) y devuelve los datos para el PDF
export async function soporteInterno(empresa, viajeId, { asignar = true } = {}) {
  const v = await Viaje.findOne({ empresa: empresa._id, _id: viajeId })
    .populate([pob(empresa._id, 'cliente'), pob(empresa._id, 'conductor'), pob(empresa._id, 'titular')]).lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.manifiesto?.estado === 'aceptado') throw new ErrorHttp(409, 'El viaje tiene manifiesto del RNDC: use ese documento');
  let s = v.soporteInterno;
  if (!s?.mc) {
    if (!asignar) throw new ErrorHttp(409, 'El viaje aún no tiene soporte interno');
    const n = await siguiente(empresa._id, 'soporteInterno', NUMERO_INICIAL - 1);
    const mc = `MC${n}`; const rc = `RC${n}`;
    const codigo = codigoVerificacion(`${empresa._id}|SI|${mc}|${rc}|${aaaa(v.fecha)}|${v.placa}|${v.conductor?.numId || ''}|${Math.round(v.flete || 0)}`);
    s = { mc, rc, codigo, fecha: new Date() };
    await Viaje.updateOne({ empresa: empresa._id, _id: v._id }, { $set: { soporteInterno: s } });
  }
  const veh = await Vehiculo.findOne({ empresa: empresa._id, placa: v.placa }).lean();
  const tit = v.titular || (veh?.tenedor?.numId ? await Tercero.findOne({ empresa: empresa._id, numId: veh.tenedor.numId }).lean() : null) || v.conductor;
  const cond = v.conductor;
  const flete = Math.round(v.flete || 0); const anticipo = Math.round(v.anticipo || 0);
  const reglas = await reglasDe(empresa._id);
  const rete = retefuente(flete, reglas); const fp = fopat(flete, veh?.pbv, v.destino, reglas);
  const neto = flete - rete - fp;
  const origen = (await lugar(v.codOrigen || empresa.rndc?.codOrigen)) || 'PASTO NARINO';
  const destino = (await lugar(v.codDestino)) || txt(v.destino).replace(/\s+\d+([.,]\d+)?$/, '').toUpperCase();
  const fin = new Date(Date.UTC(new Date(v.fecha).getUTCFullYear(), new Date(v.fecha).getUTCMonth() + 1, 0));
  const nota = [`Soporte interno - Viaje N ${v.numero}`, v.conAuxiliar ? 'Con auxiliar' : '', txt(v.observaciones)].filter(Boolean).join(' · ');
  const lic = cond?.licencia || {};
  const conLogo = await Empresa.findById(empresa._id).select('+logo').lean();
  return {
    interno: true, logoEmpresa: conLogo?.logo || '', logoAjuste: conLogo?.logoAjuste,
    soporte: s,
    empresa: txt(empresa.rndc?.razonSocial) || empresa.nombre.toUpperCase(), empNit: `${empresa.nit}${empresa.dv || ''}`,
    empDir: txt(empresa.direccion), empTel: txt(empresa.telefono), empCiudad: 'PASTO NARINO',
    numero: s.mc, radicado: s.codigo.slice(0, 8), seguro: s.codigo, qrObs: '',
    // El QR abre la página pública de verificación del soporte
    qrTexto: `${env.urlPublica}/verificar/${s.codigo}`,
    fechaRad: `${aaaa(s.fecha)}`, fechaExp: aaaa(v.fecha), tipo: 'Urbano', origen, destino,
    titular: nombre(tit).toUpperCase(), titDoc: txt(tit?.numId), titDir: txt(tit?.direccion).toUpperCase(), titTel: soloDigitos(tit?.telefono || tit?.celular) || '0',
    titCiudad: await lugar(tit?.codMunicipio),
    placa: v.placa, marca: txt(veh?.marcaNombre).toUpperCase(), remolque: txt(v.remolque), config: txt(veh?.configuracionNombre || veh?.configuracion),
    pesoVacio: txt(veh?.pesoVacio ?? ''), pesoVacioRemolque: '0',
    soatAseg: `${txt(veh?.soat?.aseguradoraNit)} ${txt(veh?.aseguradoraSoat)}`.trim(), soatNum: txt(veh?.soat?.numero), soatVence: veh?.soat?.vence ? aaaa(veh.soat.vence) : '',
    condNom: nombre(cond).toUpperCase(), condDoc: txt(cond?.numId), condDir: txt(cond?.direccion).toUpperCase(),
    condTel: `${soloDigitos(cond?.telefono) || '0'} ${soloDigitos(cond?.celular) || '0'}`,
    condLic: lic.numero ? `${txt(lic.categoria)}-${txt(lic.numero)}` : '', condCiudad: await lugar(cond?.codMunicipio),
    remesa: s.rc, unidad: 'Kilogramos', cantidad: Number(v.pesoKg) || 0, naturaleza: 'Carga Normal', empaque: 'Varios',
    mercanciaCod: '', mercancia: 'CARGA GENERAL SEGUN REMISION',
    remNit: v.cliente ? idCliente(v.cliente) : '', remNom: txt(v.cliente?.razonSocial || v.cliente?.nombre).toUpperCase(), remDir: '', remLugar: origen,
    desNit: '', desNom: '', desDir: txt(v.destino).toUpperCase(), desLugar: destino, dueno: 'Empresa de Transporte',
    flete, rete, ica: 0, fopat: fp, neto, anticipo, saldo: neto - anticipo,
    lugarPago: 'PASTO NARINO', fechaPago: aaaa(fin), carguePor: 'REMITENTE', descarguePor: 'DESTINATARIO', observaciones: nota,
    fechaTexto: fmtFecha(v.fecha),
  };
}

// Todo viaje sin manifiesto del RNDC lleva soporte interno: se numera al guardarlo
export async function asegurarSoporte(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('requiereManifiesto soporteInterno manifiesto').lean();
  if (!v || v.requiereManifiesto !== false || v.soporteInterno?.mc || v.manifiesto?.estado === 'aceptado') return v?.soporteInterno || null;
  const empresa = await Empresa.findById(empresaId).lean();
  return (await soporteInterno(empresa, viajeId)).soporte;
}

// Consulta pública (QR): confirma que el soporte existe y muestra lo mínimo para validarlo
export async function verificarSoporte(codigo) {
  const c = String(codigo || '').toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(c)) return null;
  const v = await Viaje.findOne({ empresa: { $exists: true }, 'soporteInterno.codigo': c })
    .select('empresa numero fecha placa remolque destino codDestino codOrigen conductorNombre soporteInterno requiereManifiesto manifiesto pesoKg').lean();
  if (!v) return null;
  const empresa = await Empresa.findById(v.empresa).select('nombre nit dv rndc.razonSocial rndc.codOrigen').lean();
  const vigente = v.requiereManifiesto === false && v.manifiesto?.estado !== 'aceptado';
  const oculto = (n) => String(n || '').split(' ').filter(Boolean).map((p, i) => (i < 2 ? p : p[0] + '.')).join(' ');
  return {
    valido: vigente,
    motivo: vigente ? '' : 'El viaje se expidió luego con manifiesto del RNDC: este soporte interno ya no es el documento vigente',
    empresa: txt(empresa?.rndc?.razonSocial) || empresa?.nombre || '', nit: `${empresa?.nit || ''}${empresa?.dv ? '-' + empresa.dv : ''}`,
    mc: v.soporteInterno.mc, rc: v.soporteInterno.rc, codigo: c, expedido: v.soporteInterno.fecha,
    viaje: v.numero, fecha: v.fecha, placa: v.placa, remolque: v.remolque || '', conductor: oculto(v.conductorNombre),
    origen: (await lugar(v.codOrigen || empresa?.rndc?.codOrigen)) || '', destino: (await lugar(v.codDestino)) || txt(v.destino),
  };
}

// Vista previa del soporte interno con datos de ejemplo (para revisar el logo antes de guardarlo)
export function soporteDeEjemplo(empresa, logo, logoAjuste = null) {
  const hoy = new Date();
  const f = `${hoy.getFullYear()}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${String(hoy.getDate()).padStart(2, '0')}`;
  return {
    interno: true, logoEmpresa: logo || '', logoAjuste, soporte: { mc: 'MC000000', rc: 'RC000000', codigo: 'EJEMPLO0EJEMPLO0' },
    empresa: txt(empresa.rndc?.razonSocial) || empresa.nombre.toUpperCase(), empNit: `${empresa.nit}${empresa.dv || ''}`,
    empDir: txt(empresa.direccion), empTel: txt(empresa.telefono), empCiudad: 'PASTO NARINO',
    numero: 'MC000000', radicado: 'EJEMPLO0', seguro: 'EJEMPLO0EJEMPLO0', qrObs: '', qrTexto: `${env.urlPublica || 'https://translogisticadelsur.com'}/verificar/EJEMPLO`,
    fechaRad: f, fechaExp: f, tipo: 'Urbano', origen: 'PASTO NARINO', destino: 'IPIALES NARINO',
    titular: 'NOMBRE DEL TITULAR', titDoc: '0000000000', titDir: 'DIRECCION DEL TITULAR', titTel: '0', titCiudad: 'PASTO NARINO',
    placa: 'ABC123', marca: 'MARCA', remolque: '', config: '2', pesoVacio: '0', pesoVacioRemolque: '0',
    soatAseg: '', soatNum: '', soatVence: '', condNom: 'NOMBRE DEL CONDUCTOR', condDoc: '0000000000', condDir: 'DIRECCION', condTel: '0 0',
    condLic: 'C2-0000000000', condCiudad: 'PASTO NARINO', remesa: 'RC000000', unidad: 'Kilogramos', cantidad: 1000, naturaleza: 'Carga Normal', empaque: 'Varios',
    mercanciaCod: '', mercancia: 'CARGA GENERAL SEGUN REMISION', remNit: '', remNom: 'CLIENTE DE EJEMPLO', remDir: '', remLugar: 'PASTO NARINO',
    desNit: '', desNom: '', desDir: 'DESTINO DE EJEMPLO', desLugar: 'IPIALES NARINO', dueno: 'Empresa de Transporte',
    flete: 1000000, rete: 10000, ica: 0, fopat: 0, neto: 990000, anticipo: 500000, saldo: 490000,
    lugarPago: 'PASTO NARINO', fechaPago: f, carguePor: 'REMITENTE', descarguePor: 'DESTINATARIO', observaciones: 'Vista previa: así se verá el soporte interno',
    fechaTexto: f,
  };
}
