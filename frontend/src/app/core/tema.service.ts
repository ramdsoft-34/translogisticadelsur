import { Injectable, signal } from '@angular/core';

export type Tema = 'claro' | 'oscuro';
const CLAVE = 'tls_tema';

// Tema claro u oscuro. Se aplica como data-tema en <html>; public/tema.js lo
// aplica antes de que cargue Angular para que la página no parpadee.
@Injectable({ providedIn: 'root' })
export class TemaService {
  readonly tema = signal<Tema>(this.inicial());

  constructor() { this.aplicar(this.tema()); }

  alternar() {
    const nuevo: Tema = this.tema() === 'oscuro' ? 'claro' : 'oscuro';
    this.tema.set(nuevo);
    this.aplicar(nuevo);
    try { localStorage.setItem(CLAVE, nuevo); } catch { /* sin almacenamiento */ }
  }

  private inicial(): Tema {
    try {
      const guardado = localStorage.getItem(CLAVE);
      if (guardado === 'claro' || guardado === 'oscuro') return guardado;
    } catch { /* sin almacenamiento */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  }

  private aplicar(t: Tema) {
    document.documentElement.dataset['tema'] = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'oscuro' ? '#0a0908' : '#0f0e0c');
  }
}
