// Retira índices que quedaron sobrando al reemplazarlos por uno compuesto más completo (el viejo es prefijo del
// nuevo, así que ya no lo usa ninguna consulta y solo hace más lentas las escrituras).
// Seguro por diseño: solo borra el índice viejo cuando el nuevo ya existe en la colección, y solo los de esta lista.
import { Tercero, Viaje, EnvioCorreo, EnvioWhatsapp, MensajeWhatsapp, Liquidacion, TransaccionRndc, Auditoria, Prestamo, LiquidacionConductor } from '../models/index.js';

const REEMPLAZOS = [
  [Tercero, 'empresa_1_nombres_1_apellido1_1', 'empresa_1_nombres_1_apellido1_1__id_1'],
  [Viaje, 'empresa_1_fecha_-1', 'empresa_1_fecha_-1_numero_-1'],
  [Viaje, 'empresa_1_estado_1', 'empresa_1_estado_1_fecha_-1_numero_-1'],
  [EnvioCorreo, 'empresa_1_estado_1', 'empresa_1_estado_1_createdAt_-1__id_-1'],
  [EnvioCorreo, 'empresa_1_createdAt_-1', 'empresa_1_createdAt_-1__id_-1'],
  [EnvioWhatsapp, 'empresa_1_updatedAt_-1', 'empresa_1_updatedAt_-1__id_-1'],
  [MensajeWhatsapp, 'empresa_1_fecha_-1', 'empresa_1_fecha_-1__id_-1'],
  [Liquidacion, 'empresa_1_numero_-1', 'empresa_1_numero_1'],          // el único (empresa, numero) sirve en ambos sentidos
  [TransaccionRndc, 'empresa_1_createdAt_-1', 'empresa_1_createdAt_-1__id_-1'],
  [Auditoria, 'empresa_1_createdAt_-1', 'empresa_1_createdAt_-1_seq_-1'],
  [Prestamo, 'empresa_1_createdAt_-1', 'empresa_1_createdAt_-1__id_-1'],
  [LiquidacionConductor, 'empresa_1_createdAt_-1', 'empresa_1_createdAt_-1__id_-1'],
];

export async function retirarIndicesViejos(log = console) {
  let retirados = 0;
  for (const [Modelo, viejo, nuevo] of REEMPLAZOS) {
    try {
      // Espera a que Mongoose termine de crear los índices del esquema. Si otro índice de la colección falla (datos
      // antiguos), igual se revisa: el viejo solo se borra si el nuevo existe.
      await Modelo.init().catch(() => null);
      const nombres = (await Modelo.collection.indexes()).map((i) => i.name);
      if (nombres.includes(viejo) && nombres.includes(nuevo)) {
        await Modelo.collection.dropIndex(viejo);
        retirados += 1;
      }
    } catch (e) {
      log.warn?.(`Índice ${Modelo.modelName}.${viejo}: no se pudo revisar (${e.message})`);
    }
  }
  if (retirados) log.log?.(`Índices: ${retirados} índice(s) reemplazado(s) retirado(s)`);
  return retirados;
}
