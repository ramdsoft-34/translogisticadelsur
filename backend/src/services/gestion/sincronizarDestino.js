// Destino editado en Clientes y tarifas: los viajes que aún no tienen documentos vigentes en el RNDC
// toman el nombre y el municipio nuevos. Lo ya aceptado por el RNDC o liquidado no se toca.
import { Viaje } from '../../models/index.js';

export async function sincronizarDestinoViajes(empresaId, tarifa) {
  const set = { destino: tarifa.destino };
  if (tarifa.codMunicipio) set.codDestino = tarifa.codMunicipio;
  const r = await Viaje.updateMany({ empresa: empresaId, tarifaRef: tarifa._id, estado: 'registrado', historico: { $ne: true },
    'remesa.estado': { $ne: 'aceptado' }, 'manifiesto.estado': { $ne: 'aceptado' }, liquidacion: null, liquidacionConductor: null,
    $or: [{ destino: { $ne: set.destino } }, ...(set.codDestino ? [{ codDestino: { $ne: set.codDestino } }] : [])] },
  { $set: { ...set, ...(set.codDestino ? { codDestinoManifiesto: '' } : {}) } });
  return r.modifiedCount;
}
