import { Component, ElementRef, HostListener, inject, input, model, output, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { nombreTercero } from '../core/modelos';

// Selector con búsqueda de terceros (conductor, titular…). Busca en el servidor
// a medida que se escribe, en vez de cargar miles de registros en una lista.
@Component({
  selector: 'app-buscar-tercero',
  template: `
    <div class="campo combo">
      @if (etiqueta()) { <label [for]="idCampo">{{ etiqueta() }}</label> }
      <input [id]="idCampo" role="combobox" [attr.aria-expanded]="abierto()" [attr.aria-controls]="idCampo + '-lista'"
        [value]="texto()" (input)="escribir($any($event.target).value)" (focus)="enfocar()" (keydown)="teclado($event)"
        [placeholder]="placeholder()" [disabled]="deshabilitado()" autocomplete="off" />
      @if (valor() && !deshabilitado()) { <button type="button" class="texto limpiar" (click)="limpiar()" aria-label="Quitar selección">×</button> }
      @if (abierto()) {
        <ul class="lista" [id]="idCampo + '-lista'" role="listbox">
          @for (t of opciones(); track t._id; let i = $index) {
            <li role="option" [class.activa]="i === indice()" [attr.aria-selected]="i === indice()" (mousedown)="elegir(t)">
              <span class="nom">{{ nombre(t) }}<small>{{ t.tipoId }} {{ t.numId }}</small></span>
              @if (t.placas?.length) { <span class="placas">@for (p of t.placas; track p) { <span class="placa">{{ p }}</span> }</span> }</li>
          } @empty { <li class="nada">{{ buscando() ? 'Buscando…' : 'Sin resultados' }}</li> }
        </ul>
      }
    </div>`,
  styles: [`
    .combo { position: relative; }
    .limpiar { position: absolute; right: 6px; bottom: 6px; font-size: 18px; line-height: 1; color: var(--gris-5); }
    .lista { position: absolute; top: 100%; left: 0; right: 0; z-index: 30; margin: 4px 0 0; padding: 4px; list-style: none; background: var(--gris-0);
      border: 1px solid var(--gris-2); border-radius: 10px; box-shadow: var(--sombra-2); max-height: 260px; overflow: auto; }
    li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 7px; cursor: pointer; }
    li small { color: var(--gris-5); white-space: nowrap; }
    li .nom { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    li .placas { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; align-items: center; }
    li .placa { font-size: 12px; font-weight: 650; padding: 1px 6px; border-radius: 5px; background: var(--primario-claro, #fff3c4); border: 1px solid var(--gris-2); }
    li.activa, li:hover { background: var(--primario-claro); }
    li.nada { color: var(--gris-5); cursor: default; }
  `],
})
export class BuscarTercero {
  private api = inject(Api);
  private el = inject(ElementRef);
  private static n = 0;
  readonly idCampo = `bt-${++BuscarTercero.n}`;
  readonly etiqueta = input('');
  readonly rol = input('');
  readonly placeholder = input('Escriba nombre o documento');
  readonly deshabilitado = input(false);
  readonly valor = model<string>('');
  // Con placas: trae la placa de cada conductor y, sin texto, primero los de viajes recientes
  readonly conPlacas = input(false);
  readonly elegido = output<any>();
  readonly opciones = signal<any[]>([]);
  readonly abierto = signal(false);
  readonly buscando = signal(false);
  readonly indice = signal(0);
  readonly texto = signal('');
  nombre = nombreTercero;
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private cargado = '';

  ngOnInit() { this.cargarActual(); }
  ngDoCheck() { if (this.valor() !== this.cargado) this.cargarActual(); }

  private async cargarActual() {
    const id = this.valor();
    this.cargado = id;
    if (!id) { this.texto.set(''); return; }
    try { const t = await this.api.get<any>(`/maestros/terceros/${id}`); this.texto.set(`${nombreTercero(t)} · ${t.numId}`); } catch { this.texto.set(''); }
  }

  enfocar() { this.buscar(this.valor() ? '' : this.texto()); this.abierto.set(true); }

  escribir(v: string) {
    this.texto.set(v);
    this.abierto.set(true);
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.buscar(v), 220);
  }

  private async buscar(q: string) {
    this.buscando.set(true);
    try {
      this.opciones.set(await this.api.get<any[]>('/maestros/terceros', { q, rol: this.rol(), activos: 1, limite: 20, ...(this.conPlacas() ? { conPlacas: 1 } : {}) }));
      this.indice.set(0);
    } catch { this.opciones.set([]); } finally { this.buscando.set(false); }
  }

  elegir(t: any) {
    this.cargado = t._id;
    this.valor.set(t._id);
    this.texto.set(`${nombreTercero(t)} · ${t.numId}`);
    this.abierto.set(false);
    this.elegido.emit(t);
  }

  limpiar() { this.cargado = ''; this.valor.set(''); this.texto.set(''); }

  teclado(e: KeyboardEvent) {
    const n = this.opciones().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.abierto.set(true); this.indice.set(Math.min(this.indice() + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.indice.set(Math.max(this.indice() - 1, 0)); }
    else if (e.key === 'Enter' && this.abierto() && n) { e.preventDefault(); this.elegir(this.opciones()[this.indice()]); }
    else if (e.key === 'Escape') this.abierto.set(false);
  }

  @HostListener('document:mousedown', ['$event'])
  fuera(e: MouseEvent) { if (!this.el.nativeElement.contains(e.target)) this.abierto.set(false); }
}
