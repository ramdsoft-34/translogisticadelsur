// Seguros (p. ej. Casa Andina): el manifiesto se anula el día siguiente antes de las 9:00 a. m. (hora de Colombia).
export function textoLimite(limite: string | Date | null | undefined) {
  if (!limite) return '';
  const d = new Date(limite);
  return d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
}
export const vencido = (limite: string | Date | null | undefined) => !!limite && new Date(limite) < new Date();
