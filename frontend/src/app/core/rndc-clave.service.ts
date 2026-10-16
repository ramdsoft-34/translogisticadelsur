import { Injectable, signal } from '@angular/core';

// Pide la contraseña del usuario web service del RNDC cuando se necesita.
// Solo vive en memoria mientras la pestaña está abierta (opcional) y nunca se
// guarda en el navegador ni en el servidor.
@Injectable({ providedIn: 'root' })
export class RndcClave {
  readonly visible = signal(false);
  private clave = '';
  private resolver: ((v: string | null) => void) | null = null;

  async obtener(): Promise<string | null> {
    if (this.clave) return this.clave;
    this.visible.set(true);
    return new Promise(res => { this.resolver = res; });
  }

  responder(valor: string | null, recordar: boolean) {
    if (valor && recordar) this.clave = valor;
    this.visible.set(false);
    this.resolver?.(valor);
    this.resolver = null;
  }

  // Se olvida si el RNDC la rechaza o al cerrar sesión.
  olvidar() { this.clave = ''; }
  get recordada() { return !!this.clave; }
}
