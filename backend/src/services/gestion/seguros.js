// Viajes marcados como «seguro» (p. ej. Casa Andina): el manifiesto se expide normal, pero hay que anularlo
// el día siguiente antes de las 9:00 a. m. (hora de Colombia), contado desde que se expidió el manifiesto
// (o desde que se marcó, si aún no tiene manifiesto aceptado).
const HORA_LIMITE_UTC = 14;   // 9:00 a. m. en Colombia (UTC-5)

export function limiteSeguro(v) {
  if (!v?.seguro?.marcado) return null;
  const base = (v.manifiesto?.estado === 'aceptado' && v.manifiesto?.fecha) || v.seguro.fecha || v.createdAt;
  if (!base) return null;
  const col = new Date(new Date(base).getTime() - 5 * 3600000);   // fecha en Colombia
  return new Date(Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), col.getUTCDate() + 1, HORA_LIMITE_UTC, 0, 0));
}

// Pendiente de anular: marcado y con el manifiesto sin anular (ni el viaje anulado)
export const seguroPendiente = (v) => !!v?.seguro?.marcado && v.estado !== 'anulado' && v.manifiesto?.estado !== 'anulado';

export function datosSeguro(v, ahora = new Date()) {
  const limite = limiteSeguro(v);
  return { marcado: !!v?.seguro?.marcado, marcadoEn: v?.seguro?.fecha || null, limite, pendiente: seguroPendiente(v), vencido: !!(limite && seguroPendiente(v) && ahora > limite) };
}
