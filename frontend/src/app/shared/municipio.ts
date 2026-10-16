import { Component, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';

interface Municipio { codigo: string; nombre: string; departamento: string }

// Selector de municipio (código DIVIPOLA de 8 dígitos que exige el RNDC).
@Component({
  selector: 'app-municipio',
  imports: [FormsModule],
  template: `
    <div class="campo">
      @if (etiqueta()) { <label [for]="idCampo">{{ etiqueta() }}</label> }
      <input [id]="idCampo" [attr.list]="idCampo + '-lista'" [ngModel]="texto()" (ngModelChange)="escribir($event)"
        [placeholder]="codigo() ? '' : 'Escriba el municipio o el código'" autocomplete="off" />
      <datalist [id]="idCampo + '-lista'">
        @for (m of opciones(); track m.codigo) { <option [value]="m.codigo + ' · ' + m.nombre + ' (' + m.departamento + ')'"></option> }
      </datalist>
      @if (codigo()) { <small>Código RNDC: {{ codigo() }}</small> }
    </div>`,
})
export class SelectorMunicipio {
  private api = inject(Api);
  private static n = 0;
  readonly idCampo = `mun-${++SelectorMunicipio.n}`;
  readonly etiqueta = input('');
  readonly codigo = model<string>('');
  readonly opciones = signal<Municipio[]>([]);
  private escrito = signal<string | null>(null);
  private nombreConocido = signal('');
  readonly texto = computed(() => this.escrito() ?? (this.codigo() ? `${this.codigo()}${this.nombreConocido() ? ' · ' + this.nombreConocido() : ''}` : ''));
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  async ngOnInit() {
    if (this.codigo()) {
      const r = await this.api.get<Municipio[]>('/maestros/municipios', { q: this.codigo() }).catch(() => []);
      const m = r.find(x => x.codigo === this.codigo());
      if (m) this.nombreConocido.set(`${m.nombre} (${m.departamento})`);
    }
  }

  escribir(v: string) {
    this.escrito.set(v);
    const cod = /^(\d{8})\b/.exec(v.trim())?.[1];
    if (cod) {
      this.codigo.set(cod);
      const m = this.opciones().find(x => x.codigo === cod);
      if (m) { this.nombreConocido.set(`${m.nombre} (${m.departamento})`); this.escrito.set(null); }
      return;
    }
    if (!v.trim()) { this.codigo.set(''); this.escrito.set(null); return; }
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(async () => {
      this.opciones.set(await this.api.get<Municipio[]>('/maestros/municipios', { q: v }).catch(() => []));
    }, 250);
  }
}
