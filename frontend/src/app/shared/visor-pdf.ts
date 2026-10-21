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
      @if (actual(); as a) { <iframe class="visor" [src]="a.seguro" [title]="a.titulo"></iframe> }
      <ng-container pie><button type="button" (click)="cerrar()">Cerrar</button></ng-container>
    </app-modal>`,
  styles: [`.visor { width: 100%; height: 72vh; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); }`],
})
export class VisorPdf {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private sanitizer = inject(DomSanitizer);
  readonly actual = signal<{ titulo: string; url: string; seguro: SafeResourceUrl } | null>(null);

  // Con `post` el PDF se pide por POST (p. ej. varias remesas a la vez)
  async ver(ruta: string, titulo: string, params?: Params, post?: unknown) {
    const movil = window.matchMedia('(max-width: 700px)').matches;
    const ventana = movil ? window.open('', '_blank') : null;      // se abre ya para que el navegador no la bloquee
    try {
      const blob = post !== undefined ? await this.api.archivoPost(ruta, post) : await this.api.archivo(ruta, params);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (ventana) { ventana.location.href = url; return; }
      this.cerrar();
      this.actual.set({ titulo, url, seguro: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
    } catch (e) { ventana?.close(); this.avisos.error(e); }
  }

  cerrar() {
    const a = this.actual();
    if (a) URL.revokeObjectURL(a.url);
    this.actual.set(null);
  }
}
