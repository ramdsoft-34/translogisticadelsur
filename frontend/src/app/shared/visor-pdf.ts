import { Component, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Api, Params } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';

// Muestra un PDF de la API en pantalla, sin descargarlo. En el celular se abre en otra pestaña.
// Uso: <app-visor-pdf #visor /> … visor.ver('/ruta/del/pdf', 'Título')
@Component({
  selector: 'app-visor-pdf',
  imports: [Modal],
  template: `
    <app-modal [titulo]="actual()?.titulo || ''" [abierto]="!!actual()" (cerrar)="cerrar()" [ancho]="true">
      @if (actual(); as a) {
        @if (a.version) { <p class="guardado" role="status"><span class="sello" aria-hidden="true">✓</span>Documento guardado el {{ a.guardado }} · versión {{ a.version }}. Es el mismo archivo que se envió y no se modifica.</p> }
        <iframe class="visor" [src]="a.seguro" [title]="a.titulo"></iframe>
      }
      <ng-container pie><button type="button" (click)="cerrar()">Cerrar</button></ng-container>
    </app-modal>`,
  styles: [`.visor { width: 100%; height: 72vh; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); }
    .guardado { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13px; color: var(--gris-6); }
    .sello { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--verde, #1e8e4f); color: #fff; font-size: 11px; font-weight: 800; }`],
})
export class VisorPdf {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private sanitizer = inject(DomSanitizer);
  readonly actual = signal<{ titulo: string; url: string; seguro: SafeResourceUrl; version: number | null; guardado: string } | null>(null);

  // Con `post` el PDF se pide por POST (p. ej. varias remesas a la vez)
  async ver(ruta: string, titulo: string, params?: Params, post?: unknown) {
    const movil = window.matchMedia('(max-width: 700px)').matches;
    const ventana = movil ? window.open('', '_blank') : null;      // se abre ya para que el navegador no la bloquee
    try {
      const { blob, version, guardado } = await this.api.archivoConInfo(ruta, params, post);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (ventana) { ventana.location.href = url; return; }
      this.cerrar();
      const fecha = guardado ? new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(guardado)) : '';
      this.actual.set({ titulo, url, seguro: this.sanitizer.bypassSecurityTrustResourceUrl(url), version, guardado: fecha });
    } catch (e) { ventana?.close(); this.avisos.error(e); }
  }

  cerrar() {
    const a = this.actual();
    if (a) URL.revokeObjectURL(a.url);
    this.actual.set(null);
  }
}
