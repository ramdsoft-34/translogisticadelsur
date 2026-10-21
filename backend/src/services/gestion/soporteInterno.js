// Soporte interno (MC / RC): documento con el formato del manifiesto para los viajes que NO se
// expiden en el RNDC. Numeración propia (MC100000, RC100000…), código de verificación y QR interno.
// No es un documento del RNDC: no se envía al Ministerio ni por correo.
import crypto from 'node:crypto';
import { Viaje, Vehiculo, Tercero, Municipio, siguiente, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { fmtFecha, txt, soloDigitos } from '../../utils/texto.js';
import { lugarRndc } from '../../utils/lugares.js';
import { idCliente } from '../rndc/documentos.js';
import { fopat, retefuente } from './liquidacionConductor.js';

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
  const rete = retefuente(flete); const fp = fopat(flete, veh?.pbv, v.destino);
  const neto = flete - rete - fp;
  const origen = (await lugar(v.codOrigen || empresa.rndc?.codOrigen)) || 'PASTO NARINO';
  const destino = (await lugar(v.codDestino)) || txt(v.destino).replace(/\s+\d+([.,]\d+)?$/, '').toUpperCase();
  const fin = new Date(Date.UTC(new Date(v.fecha).getUTCFullYear(), new Date(v.fecha).getUTCMonth() + 1, 0));
  const nota = [`Soporte interno - Viaje N ${v.numero}`, v.conAuxiliar ? 'Con auxiliar' : '', txt(v.observaciones)].filter(Boolean).join(' · ');
  const lic = cond?.licencia || {};
  return {
    soporte: s,
    empresa: txt(empresa.rndc?.razonSocial) || empresa.nombre.toUpperCase(), empNit: `${empresa.nit}${empresa.dv || ''}`,
    empDir: txt(empresa.direccion), empTel: txt(empresa.telefono), empCiudad: 'PASTO NARINO',
    numero: s.mc, radicado: s.codigo.slice(0, 8), seguro: s.codigo, qrObs: '',
    qrTexto: `${empresa.nombre.toUpperCase()}|SOPORTE INTERNO|${s.mc}|${s.rc}|${aaaa(v.fecha)}|${v.placa}|${cond?.numId || ''}|${flete}|${s.codigo}`,
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
