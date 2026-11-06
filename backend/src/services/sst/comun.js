// Reglas comunes de SG-SST: fechas en hora de Colombia y estados de vencimiento.
const DIA = 86400000;
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });

/** Inicio del día de hoy en Colombia (00:00 -05:00). */
export function hoyColombia(ahora = new Date()) {
  return new Date(`${fmtDia.format(ahora)}T00:00:00-05:00`);
}

export const diaColombia = (f) => (f ? fmtDia.format(new Date(f)) : '');

/** Días enteros desde hoy hasta la fecha (negativo: ya pasó). */
export function diasHasta(fecha, ahora = new Date()) {
  if (!fecha) return null;
  const d = new Date(`${fmtDia.format(new Date(fecha))}T00:00:00-05:00`);
  return Math.round((d - hoyColombia(ahora)) / DIA);
}

/**
 * Estado de una fecha de vencimiento: vencido, esta semana (7 días), próximos 30 días o al día.
 * Mismos grupos del tablero.
 */
export function estadoVence(fecha, ahora = new Date()) {
  const d = diasHasta(fecha, ahora);
  if (d === null) return 'sin_dato';
  if (d < 0) return 'vencido';
  if (d <= 7) return 'semana';
  if (d <= 30) return 'mes';
  return 'ok';
}

export function textoVence(fecha, ahora = new Date()) {
  const d = diasHasta(fecha, ahora);
  if (d === null) return 'Sin fecha';
  if (d < -1) return `Venció hace ${-d} días`;
  if (d === -1) return 'Venció ayer';
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  return `Vence en ${d} días`;
}

export const nombreTercero = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ').trim() : '');

/** Fecha que no puede estar en el futuro (último mantenimiento, examen hecho, entrega de EPP…). */
export function noFutura(fecha, ahora = new Date()) {
  return !fecha || diasHasta(fecha, ahora) <= 0;
}
