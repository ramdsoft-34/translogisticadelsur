import { Component, ElementRef, HostListener, computed, inject, input, model, output, signal } from '@angular/core';

export interface OpcionBuscable { valor: string; texto: string; extra?: boolean }

// Normaliza para buscar sin importar mayúsculas ni tildes
const normal = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Lista desplegable con búsqueda: se escribe parte del código, nombre o dirección y se filtra al instante.
// Las opciones se muestran en el orden recibido; las marcadas «extra» (p. ej. «Crear una sede nueva…») siempre se ven.
@Component({
  selector: 'app-lista-buscable',
  template: `
    <div class="combo">
      <input [id]="idCampo()" role="combobox" [attr.aria-expanded]="abierto()" [attr.aria-controls]="idCampo() + '-lista'"
        [value]="abierto() ? texto() : textoElegido()" (input)="escribir($any($event.target).value)" (focus)="enfocar($event)" (click)="abrir()"
        (blur)="salir()" (keydown)="teclado($event)" [placeholder]="abierto() && textoElegido() ? textoElegido() : placeholder()"
        [title]="textoElegido()" [disabled]="deshabilitado()" autocomplete="off" />
      <span class="flecha" aria-hidden="true">▾</span>
      @if (abierto()) {
        <ul class="lista" [id]="idCampo() + '-lista'" role="listbox">
          @for (o of filtradas(); track o.valor; let i = $index) {
            <li role="option" [class.activa]="i === indice()" [class.elegida]="o.valor === valor()" [class.extra]="o.extra"
              [attr.aria-selected]="o.valor === valor()" (mousedown)="$event.preventDefault(); elegir(o)">{{ o.texto }}</li>
          } @empty { <li class="nada">Sin resultados</li> }
        </ul>
      }
    </div>`,
  styles: [`
    .combo { position: relative; }
    input { width: 100%; padding-right: 32px; text-overflow: ellipsis; cursor: pointer; }
    input:focus { cursor: text; }
    .flecha { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--gris-5); font-size: 13px; }
    .lista { position: absolute; top: 100%; left: 0; right: 0; z-index: 30; margin: 4px 0 0; padding: 4px; list-style: none; background: var(--gris-0);
      border: 1px solid var(--gris-2); border-radius: 10px; box-shadow: var(--sombra-2); max-height: 300px; overflow: auto; }
    li { padding: 8px 10px; border-radius: 7px; cursor: pointer; }
    li.elegida { font-weight: 650; }
    li.extra { color: var(--primario-texto, inherit); border-top: 1px solid var(--gris-2); margin-top: 2px; }
    li.activa, li:hover { background: var(--primario-claro); }
    li.nada { color: var(--gris-5); cursor: default; }
  `],
})
export class ListaBuscable {
  private el = inject(ElementRef);
  readonly idCampo = input('lb');
  readonly opciones = input<OpcionBuscable[]>([]);
  readonly placeholder = input('Escriba para buscar');
  readonly deshabilitado = input(false);
  readonly valor = model<string>('');
  readonly cambio = output<string>();
  readonly abierto = signal(false);
  readonly texto = signal('');
  readonly indice = signal(0);

  readonly textoElegido = computed(() => this.opciones().find(o => o.valor === String(this.valor() ?? ''))?.texto || '');
  readonly filtradas = computed(() => {
    const palabras = normal(this.texto()).split(/\s+/).filter(Boolean);
    if (!palabras.length) return this.opciones();
    return this.opciones().filter(o => o.extra || palabras.every(p => normal(o.texto).includes(p)));
  });

  abrir() {
    if (this.abierto() || this.deshabilitado()) return;
    this.texto.set('');
    this.abierto.set(true);
    const i = this.filtradas().findIndex(o => o.valor === String(this.valor() ?? ''));
    this.indice.set(Math.max(i, 0));
    setTimeout(() => this.el.nativeElement.querySelector('li.activa')?.scrollIntoView({ block: 'nearest' }));
  }
  enfocar(e: FocusEvent) { this.abrir(); }

  escribir(v: string) { this.texto.set(v); this.abierto.set(true); this.indice.set(0); }

  elegir(o: OpcionBuscable) {
    this.valor.set(o.valor);
    this.cambio.emit(o.valor);
    this.texto.set('');
    this.abierto.set(false);
  }

  salir() { setTimeout(() => { if (!this.el.nativeElement.contains(document.activeElement)) this.abierto.set(false); }, 120); }

  teclado(e: KeyboardEvent) {
    const n = this.filtradas().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!this.abierto()) return this.abrir(); this.indice.set(Math.min(this.indice() + 1, n - 1)); this.verActiva(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.indice.set(Math.max(this.indice() - 1, 0)); this.verActiva(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (this.abierto() && n) this.elegir(this.filtradas()[this.indice()]); }
    else if (e.key === 'Escape') { this.abierto.set(false); this.texto.set(''); }
  }
  private verActiva() { setTimeout(() => this.el.nativeElement.querySelector('li.activa')?.scrollIntoView({ block: 'nearest' })); }

  @HostListener('document:mousedown', ['$event'])
  fuera(e: MouseEvent) { if (!this.el.nativeElement.contains(e.target)) { this.abierto.set(false); this.texto.set(''); } }
}
