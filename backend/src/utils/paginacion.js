// Paginación de listas desde el servidor. Solo se activa cuando la petición trae «pagina»: así las pantallas y
// procesos que todavía piden la lista completa (con su tope) siguen funcionando igual.
export function paginacion(q = {}, { porDefecto = 50, maximo = 200 } = {}) {
  const activa = q.pagina !== undefined && q.pagina !== '';
  const pagina = Math.max(1, Math.floor(Number(q.pagina)) || 1);
  const limite = Math.min(maximo, Math.max(5, Math.floor(Number(q.limite)) || porDefecto));
  return { activa, pagina, limite, salto: (pagina - 1) * limite };
}

// Respuesta estándar de una página
export const pagina = (items, total, p, extra = {}) => ({ items, total, pagina: p.pagina, limite: p.limite, paginas: Math.max(1, Math.ceil(total / p.limite)), ...extra });

// Recorta una lista ya filtrada en memoria (cuando el filtro no se puede hacer en la base, p. ej. texto sobre datos poblados)
export const recortar = (lista, p) => lista.slice(p.salto, p.salto + p.limite);
