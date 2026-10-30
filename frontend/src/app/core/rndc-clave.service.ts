import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Auth } from './auth.service';
import { Avisos } from './avisos.service';
import { P } from './modelos';

// Marcador que reemplaza a la contraseña: el servidor la cambia por la registrada (cifrada) de la empresa,
// así que la contraseña nunca llega al navegador.
export const CLAVE_GUARDADA = '__clave_rndc_guardada__';

export interface EstadoClaveRndc {
  disponible: boolean; guardada: boolean; invalida: boolean; invalidaEn: string | null;
  usuarioRndc: string; guardadaEn: string | null; guardadaPor: string; usos: number; ultimoUso: string | null;
}

// Contraseña del usuario web service del RNDC: la registra el administrador de la empresa (Configuración →
// Conexión RNDC) y queda en el servidor para todos los usuarios y equipos. Nadie la escribe al enviar: si la
// empresa no la tiene registrada (o el RNDC la rechazó), solo se muestra un aviso.
@Injectable({ providedIn: 'root' })
export class RndcClave {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly estado = signal<EstadoClaveRndc | null>(null);
  private consulta: Promise<EstadoClaveRndc | null> | null = null;

  // Estado de la contraseña registrada (se consulta una vez y al cambiar)
  cargarEstado(forzar = false): Promise<EstadoClaveRndc | null> {
    if (!this.auth.tiene(P.RNDC_OPERAR, P.RNDC_CONSULTAR, P.CONFIG_GESTIONAR)) return Promise.resolve(null);
    if (!this.consulta || forzar) {
      this.consulta = this.api.get<EstadoClaveRndc>('/rndc/clave-guardada').then(e => { this.estado.set(e); return e; }).catch(() => null);
    }
    return this.consulta;
  }

  // Devuelve el marcador de la contraseña registrada, o null (con un aviso) si la empresa no la tiene
  async obtener(): Promise<string | null> {
    const e = await this.cargarEstado(true);
    if (e?.guardada) return CLAVE_GUARDADA;
    const admin = this.auth.tiene(P.CONFIG_GESTIONAR);
    const motivo = e?.invalida ? 'El RNDC rechazó la contraseña registrada de la empresa' : 'La empresa no tiene registrada la contraseña del RNDC';
    this.avisos.mostrar(admin ? `${motivo}. Regístrela en Configuración → Conexión RNDC → «Guardar contraseña».`
      : `${motivo}. Pídale al administrador de la empresa que la registre.`, 'error', 9000);
    return null;
  }

  // Si el RNDC la rechaza, el servidor la marca como inválida: se vuelve a consultar su estado
  olvidar() { this.consulta = null; this.estado.set(null); }
  get recordada() { return !!this.estado()?.guardada; }
}
