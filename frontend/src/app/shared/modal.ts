import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { Icono } from './icono';

// Ventana modal basada en <dialog> (accesible, cierra con Esc).
@Component({
  selector: 'app-modal',
  imports: [Icono],
  template: `
    <dialog #dlg (close)="cerrar.emit()" [class.ancho]="ancho()">
      <header>
        <h2>{{ titulo() }}</h2>
        <button class="texto" type="button" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="x" /></button>
      </header>
      <div class="cuerpo"><ng-content /></div>
      <footer><ng-content select="[pie]" /></footer>
    </dialog>`,
  styles: [`
    dialog { border: 1px solid var(--gris-2); border-radius: 18px; padding: 0; width: min(580px, calc(100vw - 24px)); color: var(--gris-8); background: var(--gris-0);
      box-shadow: var(--sombra-menu); overflow: hidden; }
    dialog[open] { animation: aparecer .2s cubic-bezier(.2, .7, .2, 1); }
    @keyframes aparecer { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
    dialog.ancho { width: min(1000px, calc(100vw - 24px)); }
    dialog::backdrop { background: var(--velo); backdrop-filter: blur(2px); }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 18px 22px 14px;
      border-bottom: 1px solid var(--gris-15); }
    header h2 { margin: 0; font-size: 18px; }
    .cuerpo { padding: 18px 22px; max-height: calc(100dvh - 200px); overflow: auto; }
    footer { padding: 12px 22px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; background: var(--gris-1); border-top: 1px solid var(--gris-15); }
    footer:empty { display: none; }
  `],
})
export class Modal {
  readonly titulo = input('');
  readonly abierto = input(false);
  readonly ancho = input(false);
  readonly cerrar = output<void>();
  private dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      if (this.abierto() && !d.open) d.showModal();
      if (!this.abierto() && d.open) d.close();
    });
  }
}
