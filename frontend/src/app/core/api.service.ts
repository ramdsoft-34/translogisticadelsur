import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type Params = Record<string, string | number | boolean | null | undefined>;

// Acceso a la API con promesas y mensajes de error legibles.
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  readonly base = environment.apiUrl;

  private params(p?: Params): HttpParams {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(p || {})) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v));
    return hp;
  }

  get<T>(url: string, params?: Params) {
    return firstValueFrom(this.http.get<T>(this.base + url, { params: this.params(params) }));
  }
  post<T>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(this.base + url, body));
  }
  put<T>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.put<T>(this.base + url, body));
  }
  delete<T>(url: string) {
    return firstValueFrom(this.http.delete<T>(this.base + url));
  }

  // Envía un archivo como cuerpo binario (importaciones de Excel).
  subir<T>(url: string, archivo: File, params?: Params) {
    return firstValueFrom(this.http.post<T>(this.base + url, archivo, {
      params: this.params(params),
      headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre-Archivo': encodeURIComponent(archivo.name).slice(0, 120) },
    }));
  }

  // Trae un archivo (p. ej. un PDF) para verlo en pantalla sin descargarlo.
  async archivo(url: string, params?: Params): Promise<Blob> {
    return firstValueFrom(this.http.get(this.base + url, { params: this.params(params), responseType: 'blob' }));
  }

  async archivoPost(url: string, cuerpo: unknown): Promise<Blob> {
    return firstValueFrom(this.http.post(this.base + url, cuerpo, { responseType: 'blob' }));
  }

  // Descarga un archivo (PDF/Excel) respetando el nombre que envía el servidor.
  async descargar(url: string, params?: Params, nombrePorDefecto = 'archivo') {
    const r = await firstValueFrom(this.http.get(this.base + url, { params: this.params(params), observe: 'response', responseType: 'blob' }));
    const disp = r.headers.get('Content-Disposition') || '';
    const nombre = /filename="?([^"]+)"?/.exec(disp)?.[1] || nombrePorDefecto;
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(r.body as Blob);
    enlace.download = nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 2000);
  }
}

// Texto de error para mostrar al usuario.
export async function mensajeError(e: unknown): Promise<string> {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'No hay conexión con el servidor';
    let cuerpo: any = e.error;
    if (cuerpo instanceof Blob) {
      try { cuerpo = JSON.parse(await cuerpo.text()); } catch { cuerpo = null; }
    }
    const det = Array.isArray(cuerpo?.detalles) ? `: ${cuerpo.detalles.join('; ')}` : '';
    return (cuerpo?.error || e.message) + det;
  }
  return e instanceof Error ? e.message : String(e);
}
