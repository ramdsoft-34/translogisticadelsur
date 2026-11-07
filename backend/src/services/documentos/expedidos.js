// Documentos expedidos de un viaje y de los pagos a conductores, guardados una sola vez (ver guardados.js).
// Reglas:
//  - Manifiesto y remesa del RNDC: permanentes desde que el RNDC los acepta (clave = su número; si se anula y se
//    expide otro, el nuevo número es otro documento y el anterior se conserva).
//  - Soporte interno (MC/RC): permanente al expedirse; como el documento imprime su estado (cumplido o anulado), cada
//    estado es una versión nueva y las anteriores se conservan.
//  - Liquidación del conductor: permanente al crearse; si se anula, la versión «ANULADA» es otra y la original queda.
import { Viaje } from '../../models/index.js';
import { DocumentoPdf } from '../../models/documentos.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { pdfGuardado } from './guardados.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from '../reportes/manifiesto.js';
import { datosRemesa, remesaPdf, nombreRemesa } from '../reportes/remesa.js';
import { soporteInterno } from '../gestion/soporteInterno.js';
import { liquidacionPdf, liquidacionesMediaHoja, MAX_MEDIA_HOJA } from '../reportes/liquidacion.js';
import { componerMediasHojas } from './componer.js';

async function viajeDe(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('numero estado manifiesto.numero manifiesto.estado remesa.numero remesa.estado soporteInterno').lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  return v;
}

// PDF de manifiestos guardados entre el 6 y el 7 de noviembre de 2026 pudieron quedar con las observaciones repetidas
// (el RNDC las guarda sin tildes). Esos tienen una versión corregida; la guardada antes se conserva.
const REPETIDAS_DESDE = new Date('2026-11-06T20:00:00Z');
const REPETIDAS_HASTA = new Date('2026-11-08T05:00:00Z');

export async function manifiestoExpedido(empresa, viajeId, usuario = null) {
  const v = await viajeDe(empresa._id, viajeId);
  if (!v.manifiesto?.numero || (v.manifiesto.estado !== 'aceptado' && v.estado !== 'cumplido')) throw new ErrorHttp(409, 'El viaje no tiene un manifiesto aceptado por el RNDC');
  const nombre = `Manifiesto_${v.manifiesto.numero}.pdf`;
  let clave = v.manifiesto.numero;
  let datos = null;
  const previo = await DocumentoPdf.findOne({ empresa: empresa._id, tipo: 'manifiesto', ref: String(v._id), clave }).select('creado').lean();
  if (previo && previo.creado >= REPETIDAS_DESDE && previo.creado < REPETIDAS_HASTA) {
    datos = await datosManifiesto(empresa, viajeId);
    if (datos.observacionesAnterior !== datos.observaciones) clave = `${v.manifiesto.numero}:observaciones`;
  }
  return pdfGuardado(empresa._id, { tipo: 'manifiesto', ref: v._id, clave, nombre, usuario,
    generar: async () => manifiestoPdf(datos ?? await datosManifiesto(empresa, viajeId)) });
}

export async function remesaExpedida(empresa, viajeId, usuario = null) {
  const v = await viajeDe(empresa._id, viajeId);
  if (!v.remesa?.numero || (v.remesa.estado !== 'aceptado' && v.estado !== 'cumplido')) throw new ErrorHttp(409, 'El viaje no tiene una remesa aceptada por el RNDC');
  const nombre = `Remesa_${v.remesa.numero}.pdf`;
  return pdfGuardado(empresa._id, { tipo: 'remesa', ref: v._id, clave: v.remesa.numero, nombre, usuario,
    generar: async () => remesaPdf(await datosRemesa(empresa, viajeId)) });
}

export async function soporteExpedido(empresa, viajeId, usuario = null) {
  const v = await viajeDe(empresa._id, viajeId);
  const s = v.soporteInterno;
  if (!s?.mc) throw new ErrorHttp(409, 'El viaje no tiene soporte interno expedido');
  const estado = s.estado || 'vigente';
  return pdfGuardado(empresa._id, { tipo: 'soporte', ref: v._id, clave: `${s.mc}:${estado}`, nombre: `Soporte_${s.mc}${estado === 'vigente' ? '' : `_${estado}`}.pdf`, usuario,
    generar: async () => manifiestoPdf(await soporteInterno(empresa, viajeId, { asignar: false })) });
}

// Liquidación del conductor (la que se le envía a la app): una versión por estado (VIGENTE / ANULADA)
export function liquidacionConductorExpedida(empresa, l, usuario = null) {
  return pdfGuardado(empresa._id, { tipo: 'liquidacion-conductor', ref: l._id, clave: `${l.numero}:${l.estado}`,
    nombre: `${l.numero}${l.estado === 'ANULADA' ? '_ANULADA' : ''}.pdf`, usuario, generar: () => liquidacionPdf(empresa, l) });
}

// Varias liquidaciones de conductor, 2 por hoja: cada una se guarda una vez en su forma de media hoja y la hoja se
// arma con esas copias (las de muchos viajes van en hoja completa)
export async function liquidacionesConductorLote(empresa, lista, usuario = null) {
  const items = [];
  for (const l of lista) {
    const d = await pdfGuardado(empresa._id, { tipo: 'liquidacion-conductor-media', ref: l._id, clave: `${l.numero}:${l.estado}`,
      nombre: `${l.numero}_media_hoja.pdf`, usuario, generar: () => liquidacionesMediaHoja(empresa, [l]) });
    items.push({ buffer: d.buffer, completa: (l.lineas?.length || 0) > MAX_MEDIA_HOJA });
  }
  return componerMediasHojas(items, { desplazamiento: 792 / 2 - 6, linea: true });
}

// Nombres compatibles con los de antes (para los correos y la app)
export { nombreArchivo, nombreRemesa };
