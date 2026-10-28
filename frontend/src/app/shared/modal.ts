import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { Icono } from './icono';

// Ventana a pantalla completa basada en <dialog> (accesible, cierra con Esc):
// título arriba, contenido centrado y botones siempre a la vista abajo.
// No se cierra al hacer clic afuera, para no perder lo que se está escribiendo.
@Component({
  selector: 'app-modal',
  imports: [Icono],
  template: `
    <dialog #dlg (close)="cerrar.emit()" [class.ancho]="ancho()">
      <div class="panel">
        <header>
          <h2>{{ titulo() }}</h2>
          <span class="esc" aria-hidden="true"><kbd>Esc</kbd> para cerrar</span>
          <button class="cerrar" type="button" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="x" [tam]="18" /></button>
        </header>
        <div class="cuerpo"><ng-content /></div>
        <footer><ng-content select="[pie]" /></footer>
      </div>
    </dialog>`,
  styles: [`
    /* Ocupa la zona de trabajo: el menú lateral (--modal-izq, lo define el contenedor) queda a la vista */
    dialog { position: fixed; inset: 0 0 0 var(--modal-izq, 0px); margin: 0; height: 100dvh; max-height: 100dvh;
      width: calc(100vw - var(--modal-izq, 0px)); max-width: none; border: 0; padding: 0; color: var(--gris-8); background: transparent; overflow: visible; }
    dialog { --ancho-m: 880px; --lado: max(24px, calc((100% - var(--ancho-m)) / 2)); } dialog.ancho { --ancho-m: 1240px; }
    dialog[open] .panel { animation: entrar .26s cubic-bezier(.2, .8, .2, 1); }
    @keyframes entrar { from { transform: translateX(18px); opacity: 0; } to { transform: none; opacity: 1; } }
    dialog::backdrop { background: rgba(8, 11, 16, .55); backdrop-filter: blur(3px); }
    .panel { height: 100%; display: flex; flex-direction: column; background: var(--fondo); box-shadow: -24px 0 60px -30px rgba(0,0,0,.5); }
    /* Barras de ancho completo y el contenido centrado (más angosto en formularios simples) */
    header { position: relative; display: flex; align-items: center; gap: 14px; min-height: 66px; padding: 12px var(--lado); background: var(--gris-0);
      border-bottom: 1px solid var(--gris-2); box-shadow: 0 8px 24px -20px rgba(15, 23, 42, .35); flex: none; z-index: 1; }
    header::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--primario); }
    header h2 { flex: 1; min-width: 0; margin: 0; font-size: 19px; font-weight: 750; letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .esc { font-size: 12px; color: var(--gris-4); white-space: nowrap; }
    .esc kbd { font: 600 11px var(--fuente); padding: 2px 6px; margin-right: 4px; border-radius: 5px; border: 1px solid var(--gris-3); color: var(--gris-5); background: var(--gris-1); }
    .cerrar { min-height: 0; width: 38px; height: 38px; padding: 0; border-radius: 11px; box-shadow: none; flex: none; }
    .cerrar:hover:not(:disabled) { background: var(--gris-8); border-color: var(--gris-8); color: var(--gris-0); }
    .cuerpo { padding: 26px var(--lado) 36px; overflow: auto; flex: 1 1 auto; }
    footer { padding: 12px var(--lado); display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--gris-0);
      border-top: 1px solid var(--gris-2); box-shadow: 0 -10px 28px -22px rgba(15, 23, 42, .4); flex: none; }
    footer:empty { display: none; }
    @media (max-width: 960px) { dialog { inset: 0; width: 100vw; } }
    @media (max-width: 640px) { header { padding: 10px 16px; min-height: 58px; } header h2 { font-size: 17px; } .esc { display: none; } .cuerpo { padding: 16px; } footer { padding: 10px 16px; } }
    @media (prefers-reduced-motion: reduce) { dialog[open] .panel { animation: none; } }
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
