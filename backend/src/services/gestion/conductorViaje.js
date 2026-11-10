// Conductor de un viaje. Los viajes importados del Excel (30/10/2026) solo traen el nombre corto
// («Jairo Bolaños») sin el conductor vinculado. Se busca así:
//   1. El conductor del viaje, si lo tiene.
//   2. La cédula que se envió en el manifiesto al RNDC.
//   3. Entre los conductores de esa placa (otros viajes, conductor habitual, placas del tercero),
//      el único cuyo nombre completo contiene todas las palabras del nombre escrito.
// Si se encuentra, queda guardado en el viaje para no buscarlo de nuevo.
import { Tercero, Vehiculo, Viaje } from '../../models/index.js';
import { variablesEnviadas } from '../rndc/operaciones.js';
import { normalizar, txt } from '../../utils/texto.js';

const palabras = (s) => normalizar(s).split(' ').filter((p) => p.length > 1);

/** Busca el conductor por el nombre escrito entre los candidatos (único que coincida, o null). */
export function coincidePorNombre(nombre, candidatos) {
  const buscadas = palabras(nombre);
  if (!buscadas.length) return null;
  const vistos = new Map();
  for (const t of candidatos) {
    if (!t?._id || vistos.has(String(t._id))) continue;
    const completo = new Set(palabras([t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ')));
    if (buscadas.every((p) => completo.has(p))) vistos.set(String(t._id), t);
  }
  return vistos.size === 1 ? [...vistos.values()][0] : null;
}

export async function resolverConductor(empresaId, v) {
  if (!v) return null;
  if (v.conductor) return v.conductor?._id || v.conductor;
  let id = null;

  const M = await variablesEnviadas(empresaId, v._id, 4).catch(() => null);
  const cedula = txt(M?.NUMIDCONDUCTOR);
  if (cedula) {
    const t = await Tercero.findOne({ empresa: empresaId, numId: cedula, ...(M?.CODIDCONDUCTOR ? { tipoId: M.CODIDCONDUCTOR } : {}) }).select('_id').lean();
    id = t?._id || null;
  }

  if (!id && txt(v.conductorNombre) && txt(v.placa)) {
    const placa = txt(v.placa).toUpperCase();
    const [otros, veh] = await Promise.all([
      Viaje.distinct('conductor', { empresa: empresaId, placa, conductor: { $ne: null } }),
      Vehiculo.findOne({ empresa: empresaId, placa }).select('conductorHabitual').lean(),
    ]);
    const ids = [...otros, veh?.conductorHabitual].filter(Boolean);
    const candidatos = await Tercero.find({ empresa: empresaId, $or: [{ _id: { $in: ids } }, { placas: placa }, { placaPrincipal: placa }] })
      .select('nombres apellido1 apellido2').lean();
    id = coincidePorNombre(v.conductorNombre, candidatos)?._id || null;
  }

  if (id) await Viaje.updateOne({ empresa: empresaId, _id: v._id, conductor: null }, { $set: { conductor: id } });
  return id;
}
