import { Injectable, signal } from '@angular/core';
import { mensajeError } from './api.service';

export interface Aviso { id: number; tipo: 'ok' | 'error' | 'info'; texto: string }

// Mensajes breves en la esquina de la pantalla.
@Injectable({ providedIn: 'root' })
export class Avisos {
  readonly lista = signal<Aviso[]>([]);
  private n = 0;

  mostrar(texto: string, tipo: Aviso['tipo'] = 'info', ms = 4500) {
    const id = ++this.n;
    this.lista.update(l => [...l, { id, tipo, texto }]);
    setTimeout(() => this.cerrar(id), tipo === 'error' ? Math.max(ms, 8000) : ms);
  }
  ok(texto: string) { this.mostrar(texto, 'ok'); }
  async error(e: unknown) { this.mostrar(await mensajeError(e), 'error'); }
  cerrar(id: number) { this.lista.update(l => l.filter(a => a.id !== id)); }
}
