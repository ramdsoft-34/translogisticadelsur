import { WritableSignal, signal } from '@angular/core';
import { Turno } from '../core/turno';
import type { CambioPagina } from './paginador';

// Lo que se le pide al servidor por cada página
export interface PeticionPagina {
  pagina: number;
  limite: number;
  contar?: 1;          // pedir el total aunque no sea la primera página
  despuesDe?: string;  // cursor: _id del último registro de la página que se estaba viendo (ir a la siguiente)
  antesDe?: string;    // cursor: _id del primero (ir a la anterior)
}

export interface OpcionesLista<T, R> {
  pedir: (p: PeticionPagina) => Promise<R>;
  // Registros y total de la respuesta (por defecto r.items y r.total)
  items?: (r: R) => T[];
  total?: (r: R) => number | null | undefined;
  // Otros datos de la respuesta (sumas, cifras…): solo se llama si la respuesta sigue siendo la vigente
  alCargar?: (r: R, p: PeticionPagina) => void;
  alError?: (e: unknown) => void;
  porPagina?: number;
}

// Lista que llega por páginas desde el servidor. Reúne en un solo lugar lo que antes repetía cada pantalla:
//  - página y tamaño actuales, y el total (el servidor solo lo cuenta en la primera página; aquí se conserva);
//  - cursor para la página contigua (el servidor no recorre lo que salta; ver backend/src/utils/paginacion.js);
//  - respuestas tardías: si se pidió otra página o se cambió un filtro, la respuesta anterior se descarta;
//  - estado de carga: «cargando» al recargar con filtros nuevos y «cambiando» al pasar de página.
export class ListaServidor<T = any, R = any> {
  readonly items = signal<T[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(1);
  readonly porPagina: WritableSignal<number>;
  readonly cargando = signal(false);
  readonly cambiando = signal(false);
  private turno = new Turno();

  constructor(private op: OpcionesLista<T, R>) {
    this.porPagina = signal(op.porPagina ?? 50);
  }

  // Primera página (filtros nuevos o datos que cambiaron). Devuelve false si la respuesta llegó tarde o falló.
  recargar(): Promise<boolean> { return this.cargar(1, this.porPagina(), true); }

  // Misma página con los datos al día (p. ej. después de editar un registro), sin volver al inicio
  refrescar(): Promise<boolean> { return this.cargar(this.pagina(), this.porPagina(), true, true); }

  // Cambio pedido desde el paginador
  ir(c: CambioPagina): Promise<boolean> { return this.cargar(c.pagina, c.porPagina, false); }

  // Vacía la lista (p. ej. al cambiar de pestaña) y descarta lo que esté en camino
  limpiar() { this.turno.tomar(); this.items.set([]); this.total.set(0); this.pagina.set(1); this.cargando.set(false); this.cambiando.set(false); }

  private async cargar(pagina: number, limite: number, nueva: boolean, contar = false): Promise<boolean> {
    const vigente = this.turno.tomar();
    const p: PeticionPagina = { pagina, limite };
    // El cursor usa el _id de los registros (las listas calculadas, que usan «id», se paginan sin cursor)
    const vistos = this.items() as { _id?: string }[];
    // A la página contigua con el mismo tamaño se va con cursor
    if (!nueva && limite === this.porPagina() && vistos.length) {
      if (pagina === this.pagina() + 1 && vistos.at(-1)?._id) p.despuesDe = vistos.at(-1)!._id;
      else if (pagina === this.pagina() - 1 && pagina > 1 && vistos[0]?._id) p.antesDe = vistos[0]._id;   // a la primera no hace falta
    }
    if (pagina > 1 && (contar || !this.total())) p.contar = 1;
    const estado = nueva ? this.cargando : this.cambiando;
    estado.set(true);
    try {
      const r = await this.op.pedir(p);
      if (!vigente()) return false;
      this.items.set(this.op.items ? this.op.items(r) : (r as any).items);
      const total = this.op.total ? this.op.total(r) : (r as any).total;
      if (typeof total === 'number') this.total.set(total);
      this.pagina.set(pagina); this.porPagina.set(limite);
      this.op.alCargar?.(r, p);
      return true;
    } catch (e) {
      if (vigente()) this.op.alError?.(e);
      return false;
    } finally {
      if (vigente()) estado.set(false);
    }
  }
}

// Espera a que se deje de escribir antes de buscar (evita una consulta por cada tecla)
export function conPausa(fn: () => void, ms = 350) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const llamar = () => { clearTimeout(t); t = setTimeout(fn, ms); };
  llamar.cancelar = () => clearTimeout(t);
  return llamar;
}
