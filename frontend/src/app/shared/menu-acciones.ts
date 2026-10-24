import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { Icono } from './icono';

// Menú «Más acciones»: agrupa las acciones secundarias de una pantalla para que
// en el encabezado quede a la vista solo la acción principal.
// Uso: <app-menu-acciones><button (click)="…"><app-icono …/>Texto<small>Explicación</small></button></app-menu-acciones>
@Component({
  selector: 'app-menu-acciones',
  imports: [Icono],
  template: `
    <button type="button" class="disparador" (click)="abierto.set(!abierto())" [attr.aria-expanded]="abierto()" aria-haspopup="menu">
      <app-icono nombre="menu" [tam]="16" />{{ texto() }}<app-icono nombre="chevron" [tam]="14" class="flecha" [class.girada]="abierto()" />
    </button>
    @if (abierto()) {
      <div class="lista" role="menu" (click)="alElegir($event)"><ng-content /></div>
    }`,
  styles: [`
    :host { position: relative; display: inline-block; }
    .flecha { transition: transform var(--transicion); opacity: .7; }
    .flecha.girada { transform: rotate(180deg); }
    .lista { position: absolute; right: 0; top: calc(100% + 6px); z-index: var(--z-menu); min-width: 280px; max-width: min(360px, calc(100vw - 24px));
      padding: 6px; background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: 14px; box-shadow: var(--sombra-menu); animation: abrir .14s ease-out; }
    @keyframes abrir { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .lista ::ng-deep > button, .lista ::ng-deep > a { display: grid; grid-template-columns: 20px 1fr; column-gap: 10px; align-items: start; justify-items: start;
      width: 100%; text-align: left; padding: 9px 10px; border: 0; border-radius: 10px; background: none; box-shadow: none; min-height: 0;
      color: var(--gris-8); font-weight: 650; white-space: normal; text-decoration: none; }
    .lista ::ng-deep > button:hover:not(:disabled), .lista ::ng-deep > a:hover { background: var(--gris-1); }
    .lista ::ng-deep > button app-icono, .lista ::ng-deep > a app-icono { grid-row: span 2; margin-top: 2px; color: var(--gris-5); }
    .lista ::ng-deep small { grid-column: 2; font-weight: 450; font-size: 12.5px; color: var(--gris-5); line-height: 1.35; }
    .lista ::ng-deep hr { border: 0; border-top: 1px solid var(--gris-15); margin: 4px 6px; }
    @media (max-width: 640px) { .lista { right: auto; left: 0; } }
  `],
})
export class MenuAcciones {
  readonly texto = input('Más acciones');
  readonly abierto = signal(false);
  private el = inject(ElementRef);

  // Se cierra al elegir una opción (no al hacer clic en un separador)
  alElegir(e: MouseEvent) { if ((e.target as HTMLElement).closest('button, a')) this.abierto.set(false); }
  @HostListener('document:click', ['$event'])
  fuera(e: MouseEvent) { if (this.abierto() && !this.el.nativeElement.contains(e.target)) this.abierto.set(false); }
  @HostListener('document:keydown.escape')
  esc() { this.abierto.set(false); }
}
