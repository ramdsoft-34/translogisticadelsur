import { WritableSignal, computed, linkedSignal, signal } from '@angular/core';
import type { CambioPagina } from './paginador';

// Página de una lista que ya está completa en el navegador (listas cortas, o donde los filtros, la selección o
// los totales deben seguir sobre todos los registros). Se dibujan solo las filas de la página.
//  - fuente: la lista ya filtrada.
//  - reiniciarCon: si cambia (p. ej. el texto buscado o un filtro), se vuelve a la primera página.
//    Si la lista solo se actualiza (guardar, cambios de otros usuarios) se conserva la página.
export class PaginaLocal<T> {
  readonly porPagina: WritableSignal<number>;
  readonly pagina: WritableSignal<number>;
  readonly total = computed(() => this.fuente().length);
  readonly items = computed(() => enPagina(this.fuente(), this.pagina(), this.porPagina()));

  constructor(private fuente: () => T[], op: { porPagina?: number; reiniciarCon?: () => unknown } = {}) {
    this.porPagina = signal(op.porPagina ?? 25);
    this.pagina = op.reiniciarCon ? linkedSignal({ source: op.reiniciarCon, computation: () => 1 }) : signal(1);
  }

  ir(c: CambioPagina) { this.pagina.set(c.pagina); this.porPagina.set(c.porPagina); }
}

// Página de una lista (si la página quedó fuera de rango, la última que existe)
export function enPagina<T>(lista: T[], pagina: number, porPagina: number): T[] {
  const n = Math.max(1, Math.ceil(lista.length / porPagina));
  const p = Math.min(Math.max(1, pagina), n);
  return lista.slice((p - 1) * porPagina, p * porPagina);
}
