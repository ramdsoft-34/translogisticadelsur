import { Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

export interface DatosAutorizacion { email: string; clave: string; codigo: string; motivo: string }

// Autorización del administrador para registrar un viaje con documentos vencidos (CA-06):
// el administrador escribe su correo, su contraseña (y el código de su app si tiene doble factor) y el motivo.
// Nada de esto se guarda en el navegador.
@Injectable({ providedIn: 'root' })
export class AutorizacionAdmin {
  readonly visible = signal(false);
  readonly vencidos = signal<string[]>([]);
  private resolver: ((v: DatosAutorizacion | null) => void) | null = null;

  // ¿El error es el de documentos vencidos? Devuelve la lista para mostrarla
  static vencidosDe(e: unknown): string[] | null {
    return e instanceof HttpErrorResponse && e.status === 422 && Array.isArray(e.error?.detalles) ? e.error.detalles : null;
  }

  pedir(vencidos: string[]): Promise<DatosAutorizacion | null> {
    this.vencidos.set(vencidos);
    this.visible.set(true);
    return new Promise(res => { this.resolver = res; });
  }

  responder(datos: DatosAutorizacion | null) {
    this.visible.set(false);
    this.resolver?.(datos);
    this.resolver = null;
  }
}
