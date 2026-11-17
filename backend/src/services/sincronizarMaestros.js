// Sincronización de conductores, terceros y vehículos con los módulos que guardan una copia de sus datos.
// La mayoría de pantallas leen el registro vivo (viaje.conductor → Tercero), pero algunos módulos guardan el nombre,
// la cédula o la placa como texto (respaldo para históricos e informes). Al cambiar el maestro se actualizan aquí.
// Lo radicado en el RNDC no cambia: el PDF de un manifiesto aceptado se guarda una sola vez y no se vuelve a generar
// (services/documentos/guardados.js), y la placa de un viaje con manifiesto aceptado no se toca.
import { Viaje, Vehiculo, Prestamo, LiquidacionConductor, Tarifa, Cliente } from '../models/index.js';
import { nombreCompleto } from '../utils/nombres.js';
import { txt } from '../utils/texto.js';

const EDITABLES = { estado: { $in: ['registrado', 'remesa'] }, 'manifiesto.estado': { $nin: ['aceptado'] } };

// Nombre guardado como texto en los módulos que lo copian
async function ponerNombre(empresaId, terceroId, nombre) {
  const f = (extra = {}) => ({ empresa: empresaId, conductor: terceroId, conductorNombre: { $ne: nombre }, ...extra });
  const [v, p, l] = await Promise.all([
    Viaje.updateMany(f(), { $set: { conductorNombre: nombre } }),
    Prestamo.updateMany(f(), { $set: { conductorNombre: nombre } }),
    LiquidacionConductor.updateMany(f(), { $set: { conductorNombre: nombre } }),
  ]);
  return v.modifiedCount + p.modifiedCount + l.modifiedCount;
}

/** Después de guardar un tercero. `antes` es el objeto previo (o null si es nuevo). Devuelve cuántos registros se actualizaron. */
export async function alCambiarTercero(empresaId, antes, despues) {
  if (!antes || !despues) return 0;
  let n = await ponerNombre(empresaId, despues._id, nombreCompleto(despues));
  const docAntes = txt(antes.numId); const docNuevo = txt(despues.numId);
  if (docAntes && docNuevo && docAntes !== docNuevo) {
    const tipo = despues.tipoId;
    const cambiarDoc = async (Modelo, campo, extra = {}) => (await Modelo.updateMany(
      { empresa: empresaId, [`${campo}.numId`]: docAntes, ...(tipo ? { [`${campo}.tipoId`]: antes.tipoId || tipo } : {}), ...extra },
      { $set: { [`${campo}.numId`]: docNuevo, ...(tipo ? { [`${campo}.tipoId`]: tipo } : {}) } })).modifiedCount;
    n += await cambiarDoc(Vehiculo, 'propietario') + await cambiarDoc(Vehiculo, 'tenedor');
    n += await cambiarDoc(Tarifa, 'destinatario');
    // Remitente y destinatario de viajes cuya remesa todavía no está en el RNDC
    n += await cambiarDoc(Viaje, 'remitente', { 'remesa.estado': { $ne: 'aceptado' } }) + await cambiarDoc(Viaje, 'destinatario', { 'remesa.estado': { $ne: 'aceptado' } });
    n += (await Prestamo.updateMany({ empresa: empresaId, conductor: despues._id, cedula: docAntes }, { $set: { cedula: docNuevo } })).modifiedCount;
    n += (await LiquidacionConductor.updateMany({ empresa: empresaId, conductor: despues._id, cedula: docAntes, estado: 'VIGENTE' }, { $set: { cedula: docNuevo } })).modifiedCount;
  }
  return n;
}

/** Después de guardar un vehículo: si cambió la placa, la llevan los viajes aún no manifestados y las listas de bodega. */
export async function alCambiarVehiculo(empresaId, antes, despues) {
  const vieja = txt(antes?.placa).toUpperCase(); const nueva = txt(despues?.placa).toUpperCase();
  if (!vieja || !nueva || vieja === nueva) return 0;
  const [a, b, c] = await Promise.all([
    Viaje.updateMany({ empresa: empresaId, placa: vieja, ...EDITABLES }, { $set: { placa: nueva } }),
    Viaje.updateMany({ empresa: empresaId, remolque: vieja, ...EDITABLES }, { $set: { remolque: nueva } }),
    Cliente.updateMany({ empresa: empresaId, 'bodega.tiposPlaca.placa': vieja }, { $set: { 'bodega.tiposPlaca.$[x].placa': nueva } }, { arrayFilters: [{ 'x.placa': vieja }] }),
  ]);
  return a.modifiedCount + b.modifiedCount + c.modifiedCount;
}

/**
 * Corrige los nombres guardados que quedaron distintos del registro (p. ej. con los apellidos repetidos o de antes de
 * una edición). Se agrupa por conductor: una consulta por tipo de registro y solo se escriben los que difieren.
 */
export async function sincronizarNombresGuardados(empresaId) {
  const { Tercero } = await import('../models/index.js');
  let total = 0;
  for (const Modelo of [Viaje, Prestamo, LiquidacionConductor]) {
    const pares = await Modelo.aggregate([
      { $match: { empresa: empresaId, conductor: { $ne: null } } },
      { $group: { _id: { c: '$conductor', n: '$conductorNombre' } } },
    ]);
    if (!pares.length) continue;
    const ids = [...new Set(pares.map((x) => String(x._id.c)))];
    const terceros = new Map((await Tercero.find({ empresa: empresaId, _id: { $in: ids } }).select('nombres apellido1 apellido2').lean()).map((t) => [String(t._id), nombreCompleto(t)]));
    const ops = pares.filter((x) => terceros.has(String(x._id.c)) && terceros.get(String(x._id.c)) !== x._id.n)
      .map((x) => ({ updateMany: { filter: { empresa: empresaId, conductor: x._id.c, conductorNombre: x._id.n ?? null }, update: { $set: { conductorNombre: terceros.get(String(x._id.c)) } } } }));
    if (ops.length) total += (await Modelo.bulkWrite(ops, { ordered: false })).modifiedCount;
  }
  return total;
}
