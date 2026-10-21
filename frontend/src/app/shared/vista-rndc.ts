import { Component, input, output } from '@angular/core';

// «Solo mostrar lo que se enviaría»: las variables que irían al RNDC, sin guardar ni enviar nada.
@Component({
  selector: 'app-vista-rndc',
  template: `
    @if (variables(); as v) {
      <section class="vista" aria-label="Lo que se enviaría al RNDC">
        <header><strong>Lo que se enviaría al RNDC</strong><span class="sutil">Solo vista previa: no se ha guardado ni enviado nada.</span>
          <button type="button" class="texto" (click)="cerrar.emit()">Ocultar</button></header>
        <table>
          <tbody>
            @for (x of v; track x[0]) {
              <tr [class.vacia]="!x[1]"><th scope="row">{{ x[0] }}</th><td>{{ x[1] || '(vacío)' }}</td></tr>
            }
          </tbody>
        </table>
      </section>
    }`,
  styles: [`
    .vista { margin-top: 16px; border: 1px solid var(--gris-2); border-radius: var(--radio); overflow: hidden; }
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 10px 14px; background: var(--gris-1); border-bottom: 1px solid var(--gris-2); }
    header button { margin-left: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-family: ui-monospace, monospace; font-weight: 500; color: var(--gris-6); width: 45%; }
    th, td { padding: 6px 14px; border-bottom: 1px solid var(--gris-15); word-break: break-word; }
    tr.vacia td { color: var(--gris-5); font-style: italic; }
  `],
})
export class VistaRndc {
  readonly variables = input<[string, string][] | null>(null);
  readonly cerrar = output<void>();
}
