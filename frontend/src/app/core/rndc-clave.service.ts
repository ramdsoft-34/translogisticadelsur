import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Auth } from './auth.service';
import { P } from './modelos';

// Marcador que reemplaza a la contraseña cuando la empresa la tiene guardada: el servidor la cambia por la
// guardada (cifrada) y la contraseña nunca llega al navegador.
export const CLAVE_GUARDADA = '__clave_rndc_guardada__';

export interface EstadoClaveRndc {
  disponible: boolean; guardada: boolean; invalida: boolean; invalidaEn: string | null;
  usuarioRndc: string; guardadaEn: string | null; guardadaPor: string; usos: number; ultimoUso: string | null;
}

// Contraseña del usuario web service del RNDC.
// - Si la empresa la tiene guardada (Configuración → Conexión RNDC), se usa sola: no se pregunta.
// - Si no, se pide cuando se necesita y, si se quiere, se recuerda solo en memoria mientras la pestaña está abierta.
@Injectable({ providedIn: 'root' })
export class RndcClave {
  private api = inject(Api);
  private auth = inject(Auth);
  readonly visible = signal(false);
  readonly estado = signal<EstadoClaveRndc | null>(null);
  private clave = '';
  private resolver: ((v: string | null) => void) | null = null;
  private consulta: Promise<EstadoClaveRndc | null> | null = null;

  // Estado de la contraseña guardada (se consulta una vez y al cambiar)
  cargarEstado(forzar = false): Promise<EstadoClaveRndc | null> {
    if (!this.auth.tiene(P.RNDC_OPERAR, P.RNDC_CONSULTAR, P.CONFIG_GESTIONAR)) return Promise.resolve(null);
    if (!this.consulta || forzar) {
      this.consulta = this.api.get<EstadoClaveRndc>('/rndc/clave-guardada').then(e => { this.estado.set(e); return e; }).catch(() => null);
    }
    return this.consulta;
  }

  async obtener(): Promise<string | null> {
    if (this.clave) return this.clave;
    const e = await this.cargarEstado();
    if (e?.guardada) return CLAVE_GUARDADA;
    this.visible.set(true);
    return new Promise(res => { this.resolver = res; });
  }

  responder(valor: string | null, recordar: boolean) {
    if (valor && recordar) this.clave = valor;
    this.visible.set(false);
    this.resolver?.(valor);
    this.resolver = null;
  }

  // Se olvida si el RNDC la rechaza o al cerrar sesión; si era la guardada, el servidor la marcó como inválida
  // y se vuelve a consultar su estado la próxima vez.
  olvidar() { this.clave = ''; this.consulta = null; this.estado.set(null); }
  get recordada() { return !!this.clave || !!this.estado()?.guardada; }
}
