import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';

export interface EstadoRastreo { habilitado: boolean; configuradoServidor: boolean; surTrack: boolean; velocidadMaxima: number; minutosSinSenal: number }

export const ESTADOS_RASTREO: Record<string, { texto: string; clase: string }> = {
  esperando: { texto: 'Esperando inicio', clase: 'info' },
  en_ruta: { texto: 'En ruta', clase: 'ok' },
  detenido: { texto: 'Detenido', clase: 'alerta' },
  sin_senal: { texto: 'Sin señal', clase: 'error' },
  llego: { texto: 'Llegó', clase: 'marca' },
  finalizado: { texto: 'Finalizado', clase: '' },
  error: { texto: 'Error', clase: 'error' },
};

// Rastreo GPS con Sur Track: si está habilitado para la empresa (se consulta una vez por sesión)
@Injectable({ providedIn: 'root' })
export class Rastreo {
  private api = inject(Api);
  readonly estado = signal<EstadoRastreo | null>(null);
  private cargando: Promise<EstadoRastreo | null> | null = null;

  cargar(forzar = false) {
    if (!forzar && this.cargando) return this.cargando;
    this.cargando = this.api.get<EstadoRastreo>('/rastreo/estado')
      .then(e => { this.estado.set(e); return e; })
      .catch(() => { this.estado.set(null); return null; });
    return this.cargando;
  }
  habilitado() { return !!this.estado()?.habilitado; }

  activar(viajeId: string) { return this.api.post<any>(`/rastreo/viajes/${viajeId}/activar`, {}); }
  finalizar(viajeId: string) { return this.api.post<any>(`/rastreo/viajes/${viajeId}/finalizar`, {}); }
}
