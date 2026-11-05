// Fase 10: firma de la asistencia a una capacitación desde el celular del asistente.
// Cada asistente recibe por WhatsApp un enlace propio (/f/<token>). Para firmar confirma los 4 últimos dígitos de su
// documento, marca que asistió y firma con el dedo. Queda la evidencia de la firma electrónica (Ley 527 de 1999,
// Decreto 2364 de 2012): fecha y hora, IP, navegador, ubicación si la autoriza y una huella SHA-256 de lo firmado.
import crypto from 'node:crypto';
import { CapacitacionSst, Empresa, Tercero, Empleado } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import { soloDigitos, txt } from '../../utils/texto.js';
import { nombreCorto, saludo } from '../whatsapp.js';
import { numeroWhatsapp, nuevoToken } from '../manifiestoConductor.js';
import { firmaValida } from './catalogo.js';

export const DIAS_PARA_FIRMAR = 15;       // después de la fecha de la capacitación
export const INTENTOS_MAX = 5;            // intentos con el documento equivocado antes de bloquear el enlace
const RE_TOKEN = /^[A-Za-z0-9_-]{12,32}$/;

export const enlaceFirma = (token) => `${env.urlPublica}/f/${token}`;
const dmy = (d) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/') : '');

// Huella de lo que se firmó: si alguien cambia el tema, la fecha o el documento después, ya no coincide
export function huellaFirma({ empresa, capacitacion, tema, fecha, horas, documento, nombre, firmado, imagen }) {
  const texto = [empresa, capacitacion, txt(tema), dmy(fecha), String(horas ?? ''), soloDigitos(documento), txt(nombre), new Date(firmado).toISOString(),
    crypto.createHash('sha256').update(String(imagen || '')).digest('hex')].join('|');
  return crypto.createHash('sha256').update(texto).digest('hex');
}

// Por qué ya no se puede firmar ('' = se puede)
export function motivoNoFirma(cap, asistente, hoy = new Date()) {
  if (!cap || !asistente) return 'El enlace no existe';
  if (asistente.remota?.firmado) return '';                       // ya firmó: se muestra la constancia
  if (cap.estado === 'cancelada') return 'La capacitación fue cancelada';
  if ((asistente.remota?.intentos || 0) >= INTENTOS_MAX) return 'El enlace se bloqueó por intentos con un documento equivocado. Pida uno nuevo.';
  const limite = new Date(cap.fecha).getTime() + (DIAS_PARA_FIRMAR + 1) * 864e5;
  if (hoy.getTime() > limite) return `El plazo para firmar venció (${DIAS_PARA_FIRMAR} días después de la capacitación)`;
  return '';
}

export function mensajeFirma({ persona, nombre, tema, fecha, horas, empresa }, enlace, ahora = new Date()) {
  const primero = nombreCorto(persona, nombre).split(' ')[0] || '';
  return [
    `${saludo(ahora)}${primero ? `, ${primero}` : ''}.`, '',
    'Por favor firme su asistencia a la capacitación:',
    `*${tema}*`, `*Fecha:* ${dmy(fecha)} · ${horas} h`, '',
    'Firme desde su celular aquí (le pedirá los 4 últimos números de su documento):', enlace, '',
    `Gracias. ${empresa}`,
  ].join('\n');
}

// Celular del asistente: el conductor (Conductores y terceros) o el empleado (Nómina)
async function celularDe(empresaId, persona) {
  if (!persona?.id) return '';
  if (persona.tipo === 'empleado') return txt((await Empleado.findOne({ empresa: empresaId, _id: persona.id }).select('telefono').lean())?.telefono);
  const t = await Tercero.findOne({ empresa: empresaId, _id: persona.id }).select('celular telefono').lean();
  return numeroWhatsapp(t?.celular) ? t.celular : txt(t?.telefono);
}

// Prepara (y crea si hace falta) el enlace de cada asistente elegido
export async function prepararEnvios(empresaId, capId, asistenteIds = null) {
  const cap = await CapacitacionSst.findOne({ empresa: empresaId, _id: capId });
  if (!cap) throw new ErrorHttp(404, 'Capacitación no encontrada');
  if (cap.estado === 'cancelada') throw new ErrorHttp(409, 'La capacitación está cancelada');
  const empresa = await Empresa.findById(empresaId).select('nombre').lean();
  const elegidos = cap.asistentes.filter(a => (asistenteIds ? asistenteIds.includes(String(a._id)) : !a.firma?.imagen));
  let cambio = false;
  for (const a of elegidos) {
    if (!a.remota?.token || (a.remota.intentos || 0) >= INTENTOS_MAX) {
      a.set('remota', { token: nuevoToken(), creado: new Date(), intentos: 0 });
      cambio = true;
    }
  }
  if (cambio) await cap.save();
  const salida = [];
  for (const a of elegidos) {
    const celular = await celularDe(empresaId, a.persona);
    const numero = numeroWhatsapp(celular);
    const enlace = enlaceFirma(a.remota.token);
    const texto = mensajeFirma({ nombre: a.nombre, tema: cap.tema, fecha: cap.fecha, horas: cap.horas, empresa: empresa?.nombre || '' }, enlace);
    salida.push({ _id: String(a._id), nombre: a.nombre, documento: a.documento, celular, enlace, texto,
      wa: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : '',
      error: a.firma?.imagen && !a.remota?.firmado ? 'Ya tiene una firma tomada en pantalla' : numero ? '' : 'No tiene un celular válido en su ficha',
      enviado: a.remota.enviado || null, abierto: a.remota.abierto || null, firmado: a.remota.firmado || null });
  }
  return salida;
}

async function buscar(token) {
  if (!RE_TOKEN.test(String(token || ''))) return null;
  const cap = await CapacitacionSst.findOne({ empresa: { $exists: true }, 'asistentes.remota.token': token });
  if (!cap) return null;
  const a = cap.asistentes.find(x => x.remota?.token === token);
  return a ? { cap, a } : null;
}
const oculto = (doc) => { const d = soloDigitos(doc); return d.length > 4 ? `${'•'.repeat(Math.min(6, d.length - 4))}${d.slice(-4)}` : '••••'; };

// Página pública: datos de la capacitación y estado de la firma (anota la primera apertura)
export async function verEnlace(token) {
  const r = await buscar(token);
  if (!r) return null;
  const { cap, a } = r;
  const motivo = motivoNoFirma(cap, a);
  if (!a.remota.abierto && !motivo) { a.remota.abierto = new Date(); await cap.save(); }
  const empresa = await Empresa.findById(cap.empresa).select('nombre nit dv rndc.razonSocial').lean();
  return {
    empresa: txt(empresa?.rndc?.razonSocial) || empresa?.nombre || '', nit: `${empresa?.nit || ''}${empresa?.dv ? `-${empresa.dv}` : ''}`,
    tema: cap.tema, fecha: cap.fecha, horas: cap.horas, facilitador: cap.facilitador, eje: cap.eje,
    nombre: a.nombre, documento: oculto(a.documento),
    estado: a.remota.firmado ? 'firmado' : motivo ? 'bloqueado' : 'pendiente', motivo,
    firmado: a.remota.firmado || null, huella: a.remota.firmado ? a.remota.huella : '',
  };
}

// Firma desde el celular
export async function firmar(token, { ultimos4, imagen, acepto, ubicacion = null }, { ip = '', agente = '' } = {}) {
  const r = await buscar(token);
  if (!r) throw new ErrorHttp(404, 'El enlace no existe');
  const { cap, a } = r;
  if (a.remota.firmado) throw new ErrorHttp(409, 'Esta asistencia ya está firmada');
  const motivo = motivoNoFirma(cap, a);
  if (motivo) throw new ErrorHttp(410, motivo);
  if (!acepto) throw new ErrorHttp(400, 'Confirme que asistió a la capacitación');
  if (soloDigitos(ultimos4).length !== 4 || soloDigitos(a.documento).slice(-4) !== soloDigitos(ultimos4)) {
    a.remota.intentos = (a.remota.intentos || 0) + 1;
    await cap.save();
    const quedan = INTENTOS_MAX - a.remota.intentos;
    throw new ErrorHttp(400, quedan > 0 ? `Los números no coinciden con su documento. Le quedan ${quedan} intento(s).` : 'El enlace se bloqueó. Pida uno nuevo.');
  }
  const img = firmaValida(imagen);
  if (!img) throw new ErrorHttp(400, 'Falta la firma');
  const firmado = new Date();
  const huella = huellaFirma({ empresa: String(cap.empresa), capacitacion: String(cap._id), tema: cap.tema, fecha: cap.fecha, horas: cap.horas,
    documento: a.documento, nombre: a.nombre, firmado, imagen: img });
  a.asistio = true;
  a.firma = { rol: 'asistente', nombre: a.nombre, documento: a.documento, imagen: img, fecha: firmado };
  Object.assign(a.remota, { firmado, ip: txt(ip).slice(0, 60), agente: txt(agente).slice(0, 200), huella,
    ubicacion: { lat: Number.isFinite(ubicacion?.lat) ? ubicacion.lat : null, lng: Number.isFinite(ubicacion?.lng) ? ubicacion.lng : null } });
  await cap.save();
  return { firmado, huella };
}

// Al guardar la capacitación desde la pantalla, no se pierde lo que llegó por los enlaces
export function conservarRemotas(anteriores = [], nuevos = []) {
  const clave = (x) => String(x.persona?.id || '') || soloDigitos(x.documento);
  const previos = new Map(anteriores.map(x => [clave(x), x]));
  return nuevos.map(n => {
    const p = previos.get(clave(n));
    if (!p?.remota?.token) return n;
    const remota = typeof p.remota.toObject === 'function' ? p.remota.toObject() : p.remota;
    const firma = typeof p.firma?.toObject === 'function' ? p.firma.toObject() : p.firma;
    if (remota.firmado) return { ...n, asistio: true, firma, remota };   // la firma electrónica no se reemplaza desde la pantalla
    return { ...n, remota };
  });
}

// Texto de evidencia para la planilla SST-FOR-07
export function evidenciaFirmas(asistentes = []) {
  const hora = (d) => { const c = new Date(new Date(d).getTime() - 5 * 3600e3); return `${dmy(c)} ${String(c.getUTCHours()).padStart(2, '0')}:${String(c.getUTCMinutes()).padStart(2, '0')}`; };
  return asistentes.filter(a => a.remota?.firmado)
    .map(a => `${a.nombre} (doc. …${soloDigitos(a.documento).slice(-4)}): firmó desde su celular el ${hora(a.remota.firmado)}${a.remota.ip ? ` · IP ${a.remota.ip}` : ''}${a.remota.ubicacion?.lat != null ? ' · con ubicación' : ''} · código ${String(a.remota.huella || '').slice(0, 12).toUpperCase()}`)
    .join('\n');
}
