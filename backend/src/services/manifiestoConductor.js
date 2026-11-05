// Fase 9: el manifiesto que recibe el conductor.
// Cada viaje con manifiesto aceptado tiene un enlace propio (/m/<token>) que abre el mismo PDF que se descarga
// del RNDC, sin usuario ni clave. Se manda por WhatsApp (enlace wa.me con el mensaje listo) y, si la empresa lo
// activa, va también a Sur Track al activar el rastreo. El enlace deja de servir si el manifiesto se anula, cuando
// el viaje se cumple o a los 30 días.
import crypto from 'node:crypto';
import { Empresa, Viaje } from '../models/index.js';
import { ErrorHttp } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { soloDigitos, txt } from '../utils/texto.js';
import { nombreCorto, saludo } from './whatsapp.js';

export const VIGENCIA_DIAS = 30;
const RE_TOKEN = /^[A-Za-z0-9_-]{12,32}$/;

export const enlaceDe = (token) => `${env.urlPublica}/m/${token}`;
export const nuevoToken = () => crypto.randomBytes(12).toString('base64url');   // 16 caracteres, no adivinable

// Celular colombiano para wa.me (57 + 10 dígitos); '' si no hay uno válido
export function numeroWhatsapp(celular) {
  const d = soloDigitos(celular);
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  if (d.length === 12 && d.startsWith('573')) return d;
  return '';
}

// Por qué un manifiesto ya no se puede ver desde el enlace ('' = vigente)
export function motivoNoVigente(v, hoy = new Date()) {
  if (!v) return 'El enlace no existe';
  if (v.estado === 'anulado' || v.manifiesto?.estado === 'anulado') return 'Este manifiesto fue ANULADO';
  if (v.estado === 'cumplido') return 'El viaje ya se cumplió: el enlace del conductor terminó';
  if (v.manifiesto?.estado !== 'aceptado') return 'El manifiesto no está aceptado en el RNDC';
  const creado = v.envioConductor?.creado ? new Date(v.envioConductor.creado).getTime() : null;
  if (creado && hoy.getTime() - creado > VIGENCIA_DIAS * 864e5) return `El enlace venció (dura ${VIGENCIA_DIAS} días)`;
  return '';
}

// Mensaje de WhatsApp para el conductor
export function mensajeConductor({ conductor, conductorNombre, manifiesto, placa, origen, destino, remesa, empresa }, enlace, ahora = new Date()) {
  const nombre = nombreCorto(conductor, conductorNombre).split(' ')[0] || '';
  const ruta = [origen, destino].filter(Boolean).join(' → ');
  return [
    `${saludo(ahora)}${nombre ? `, ${nombre}` : ''}.`, '',
    'Su manifiesto de carga para el viaje:',
    `*Manifiesto:* ${manifiesto}`, `*Placa:* ${placa}`, ...(ruta ? [`*Ruta:* ${ruta}`] : []), ...(remesa ? [`*Remesa:* ${remesa}`] : []), '',
    'Véalo y descárguelo aquí:', enlace, '',
    `Feliz viaje. ${empresa}`,
  ].join('\n');
}

// Crea el enlace del viaje si aún no tiene (solo con manifiesto aceptado)
export async function asegurarToken(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('estado manifiesto envioConductor');
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.manifiesto?.estado !== 'aceptado' || v.estado === 'anulado') throw new ErrorHttp(409, 'El viaje no tiene un manifiesto aceptado por el RNDC');
  if (!v.envioConductor?.token) {
    v.set('envioConductor.token', nuevoToken());
    v.set('envioConductor.creado', new Date());
    await v.save();
  }
  return v.envioConductor.token;
}

// Para la página pública: busca el viaje por su enlace y anota la apertura
export async function abrirEnlace(token, { anotar = true } = {}) {
  if (!RE_TOKEN.test(String(token || ''))) return null;
  const v = await Viaje.findOne({ empresa: { $exists: true }, 'envioConductor.token': token })
    .select('empresa numero fecha placa destino conductorNombre estado manifiesto remesa envioConductor').lean();
  if (!v) return null;
  const motivo = motivoNoVigente(v);
  if (anotar && !motivo) {
    const ahora = new Date();
    await Viaje.updateOne({ _id: v._id, empresa: v.empresa }, { $set: { 'envioConductor.ultimaApertura': ahora, ...(v.envioConductor?.abierto ? {} : { 'envioConductor.abierto': ahora }) },
      $inc: { 'envioConductor.aperturas': 1 } });
  }
  const empresa = await Empresa.findById(v.empresa).select('nombre nit dv rndc.razonSocial').lean();
  const oculto = (n) => String(n || '').split(' ').filter(Boolean).map((p, i) => (i < 2 ? p : `${p[0]}.`)).join(' ');
  return {
    v, motivo,
    publico: { valido: !motivo, motivo, empresa: txt(empresa?.rndc?.razonSocial) || empresa?.nombre || '', nit: `${empresa?.nit || ''}${empresa?.dv ? `-${empresa.dv}` : ''}`,
      manifiesto: v.manifiesto?.numero, autorizacion: v.manifiesto?.radicado, remesa: v.remesa?.numero, placa: v.placa,
      conductor: oculto(v.conductorNombre), destino: v.destino, fecha: v.fecha, expedido: v.manifiesto?.fecha },
  };
}

// Resumen para las tablas (Manifiestos y Monitoreo)
export function estadoEnvio(v) {
  const e = v.envioConductor || {};
  return { whatsapp: e.whatsapp || null, abierto: e.abierto || null, aperturas: e.aperturas || 0, surtrack: e.surtrack || null };
}
