import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { Icono } from './icono';

// Panel lateral basado en <dialog> (accesible, cierra con Esc): se desliza desde la derecha,
// deja ver la pantalla de fondo y mantiene el título y los botones siempre a la vista.
// No se cierra al hacer clic afuera, para no perder lo que se está escribiendo.
@Component({
  selector: 'app-modal',
  imports: [Icono],
  template: `
    <dialog #dlg (close)="cerrar.emit()" [class.ancho]="ancho()">
      <div class="panel">
        <header>
          <h2>{{ titulo() }}</h2>
          <button class="cerrar" type="button" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="x" [tam]="18" /></button>
        </header>
        <div class="cuerpo"><ng-content /></div>
        <footer><ng-content select="[pie]" /></footer>
      </div>
    </dialog>`,
  styles: [`
    dialog { position: fixed; inset: 0 0 0 auto; margin: 0; height: 100dvh; max-height: 100dvh; width: min(620px, 100vw); max-width: 100vw;
      border: 0; padding: 0; color: var(--gris-8); background: transparent; overflow: visible; }
    dialog.ancho { width: min(1080px, 100vw); }
    dialog[open] .panel { animation: entrar .24s cubic-bezier(.2, .8, .2, 1); }
    @keyframes entrar { from { transform: translateX(32px); opacity: 0; } to { transform: none; opacity: 1; } }
    dialog::backdrop { background: var(--velo); backdrop-filter: blur(2px); }
    .panel { height: 100%; display: flex; flex-direction: column; background: var(--fondo); border-left: 1px solid var(--gris-2); box-shadow: var(--sombra-menu); }
    header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 22px; background: var(--gris-0);
      border-bottom: 1px solid var(--gris-2); flex: none; }
    header h2 { margin: 0; font-size: 18px; letter-spacing: -.015em; }
    .cerrar { min-height: 0; width: 36px; height: 36px; padding: 0; border-radius: 10px; box-shadow: none; flex: none; }
    .cuerpo { padding: 20px 22px 24px; overflow: auto; flex: 1 1 auto; }
    footer { padding: 12px 22px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; background: var(--gris-0); border-top: 1px solid var(--gris-2); flex: none; }
    footer:empty { display: none; }
    @media (max-width: 640px) { header { padding: 12px 16px; } .cuerpo { padding: 16px; } footer { padding: 10px 16px; } }
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
