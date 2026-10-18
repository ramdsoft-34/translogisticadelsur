// Filtro rápido de tablas: busca el texto (sin tildes ni mayúsculas) en los valores de cada fila.
const normal = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function valores(x: unknown, nivel = 0): string {
  if (x === null || x === undefined) return '';
  if (typeof x !== 'object') return String(x);
  if (nivel > 2) return '';
  return Object.values(x as Record<string, unknown>).map(v => valores(v, nivel + 1)).join(' ');
}

// Todas las palabras escritas deben aparecer en la fila (en cualquier orden)
export function filtrar<T>(lista: T[], texto: string): T[] {
  const palabras = normal(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return lista;
  return lista.filter(f => { const t = normal(valores(f)); return palabras.every(p => t.includes(p)); });
}
