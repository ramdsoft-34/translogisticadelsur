import { Component, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Firma } from './firma';
import { Icono } from './icono';

export interface CampoSst {
  id: string; tipo: 'texto' | 'textoLargo' | 'fecha' | 'hora' | 'numero' | 'seleccion' | 'casilla' | 'verificacion' | 'tabla' | 'firma';
  etiqueta: string; opciones?: string[]; items?: { codigo: string; texto: string; critico?: boolean }[];
  columnas?: { id: string; etiqueta: string; tipo: string }[]; auto?: string; requerido?: boolean; ancho?: number;
}
export interface PlantillaSst { codigo: string; version: number; titulo: string; descripcion: string; modulo: string; estandar: string;
  secciones: { titulo: string; campos: CampoSst[] }[]; prellenado?: Record<string, string> }

const NOMBRE_OPCION: Record<string, string> = { bien: 'Bien', mal: 'Mal', na: 'N/A', cumple: 'Cumple', no_cumple: 'No cumple' };

// Dibuja un formato del catálogo (secciones y campos) y edita `datos` en el lugar.
// Los campos que la empresa ya conoce (razón social, responsable SST, fecha…) llegan prellenados y se pueden cambiar.
@Component({
  selector: 'app-formulario-sst',
  imports: [FormsModule, Firma, Icono],
  template: `
    @for (s of plantilla().secciones; track s.titulo) {
      <fieldset class="seccion"><legend>{{ s.titulo }}</legend>
        <div class="rejilla">
          @for (c of s.campos; track c.id) {
            @switch (c.tipo) {
              @case ('textoLargo') { <div class="campo ancho4"><label [for]="'f-' + c.id">{{ c.etiqueta }}</label>
                <textarea [id]="'f-' + c.id" [name]="c.id" rows="3" [(ngModel)]="datos()[c.id]" [disabled]="soloLectura()"></textarea></div> }
              @case ('seleccion') { <div class="campo" [class]="'ancho' + (c.ancho || 2)"><label [for]="'f-' + c.id">{{ c.etiqueta }}</label>
                <select [id]="'f-' + c.id" [name]="c.id" [(ngModel)]="datos()[c.id]" [disabled]="soloLectura()"><option value="">Seleccione…</option>
                  @for (o of c.opciones; track o) { <option [value]="o">{{ o }}</option> }</select></div> }
              @case ('casilla') { <label class="casilla ancho4"><input type="checkbox" [name]="c.id" [(ngModel)]="datos()[c.id]" [disabled]="soloLectura()" />{{ c.etiqueta }}</label> }
              @case ('verificacion') {
                <div class="ancho4 verif">
                  <div class="verif-cab"><span>{{ c.etiqueta }}</span>
                    @if (!soloLectura()) { <button type="button" class="pequeno texto" (click)="todoBien(c)">Marcar todo «{{ nombre(c.opciones![0]) }}»</button> }</div>
                  @for (it of c.items; track it.codigo; let i = $index) {
                    <div class="item" [class.malo]="valor(c, it.codigo) === 'mal' || valor(c, it.codigo) === 'no_cumple'">
                      <span class="n">{{ i + 1 }}</span>
                      <span class="txt">{{ it.texto }} @if (it.critico) { <span class="chip error sin-punto" title="Si está mal, el vehículo no sale">Crítico</span> }</span>
                      <div class="opciones" role="radiogroup" [attr.aria-label]="it.texto">
                        @for (o of c.opciones; track o) {
                          <button type="button" class="op" [class]="'op ' + o" [class.sel]="valor(c, it.codigo) === o" [disabled]="soloLectura()"
                            role="radio" [attr.aria-checked]="valor(c, it.codigo) === o" (click)="marcar(c, it.codigo, o)">{{ nombre(o) }}</button>
                        }
                      </div>
                      @if (valor(c, it.codigo) === 'mal' || valor(c, it.codigo) === 'no_cumple' || obs(c, it.codigo)) {
                        <input class="obs" type="text" placeholder="Observación" [value]="obs(c, it.codigo)" [disabled]="soloLectura()" (input)="ponerObs(c, it.codigo, $any($event.target).value)" />
                      }
                    </div>
                  }
                </div>
              }
              @case ('tabla') {
                <div class="ancho4 tabla-caja"><table>
                  <thead><tr>@for (k of c.columnas; track k.id) { <th>{{ k.etiqueta }}</th> } @if (!soloLectura()) { <th></th> }</tr></thead>
                  <tbody>
                    @for (f of filas(c); track $index; let r = $index) {
                      <tr>
                        @for (k of c.columnas; track k.id) {
                          <td [attr.data-etiqueta]="k.etiqueta">
                            @if (k.tipo === 'firma') {
                              @if (abierta() === c.id + r) { <app-firma [valor]="f[k.id]" (cambio)="f[k.id] = $event" [etiqueta]="f['nombre'] || 'Firma'" /> }
                              @else if (f[k.id]) { <img class="mini-firma" [src]="f[k.id]" alt="Firma" (click)="!soloLectura() && abierta.set(c.id + r)" /> }
                              @else if (!soloLectura()) { <button type="button" class="pequeno" (click)="abierta.set(c.id + r)"><app-icono nombre="editar" [tam]="14" />Firmar</button> }
                            } @else {
                              <input [type]="k.tipo === 'fecha' ? 'date' : k.tipo === 'numero' ? 'number' : 'text'" [(ngModel)]="f[k.id]" [name]="c.id + r + k.id" [disabled]="soloLectura()" />
                            }
                          </td>
                        }
                        @if (!soloLectura()) { <td><button type="button" class="pequeno texto" (click)="quitarFila(c, r)" aria-label="Quitar fila"><app-icono nombre="x" [tam]="14" /></button></td> }
                      </tr>
                    }
                  </tbody>
                </table>
                @if (!soloLectura()) { <button type="button" class="pequeno" (click)="agregarFila(c)" style="margin-top:8px"><app-icono nombre="mas" [tam]="14" />Agregar fila</button> }
                </div>
              }
              @case ('firma') { <div class="campo ancho2"><label>{{ c.etiqueta }}</label>
                @if (soloLectura()) { @if (datos()[c.id]) { <img class="firma-img" [src]="datos()[c.id]" alt="Firma" /> } @else { <span class="sutil">Sin firma</span> } }
                @else { <app-firma [valor]="datos()[c.id] || ''" (cambio)="datos()[c.id] = $event" [etiqueta]="c.etiqueta" /> }</div> }
              @default { <div class="campo" [class]="'ancho' + (c.ancho || 2)"><label [for]="'f-' + c.id">{{ c.etiqueta }}@if (c.auto) { <span class="auto" title="Se llenó con los datos de la empresa">auto</span> }</label>
                <input [id]="'f-' + c.id" [name]="c.id" [type]="c.tipo === 'fecha' ? 'date' : c.tipo === 'hora' ? 'time' : c.tipo === 'numero' ? 'number' : 'text'"
                  [(ngModel)]="datos()[c.id]" [required]="!!c.requerido" [disabled]="soloLectura()" [style.text-transform]="c.id === 'placa' ? 'uppercase' : null" /></div> }
            }
          }
        </div>
      </fieldset>
    }`,
  styles: [`
    .seccion { margin: 0 0 16px; }
    .rejilla { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 14px; }
    .ancho1 { grid-column: span 1; } .ancho2 { grid-column: span 2; } .ancho3 { grid-column: span 3; } .ancho4 { grid-column: 1 / -1; }
    @media (max-width: 700px) { .rejilla { grid-template-columns: 1fr 1fr; } .ancho2, .ancho3 { grid-column: 1 / -1; } }
    .auto { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: var(--verde-texto); background: var(--verde-claro); border-radius: 5px; padding: 1px 5px; }
    .verif { display: flex; flex-direction: column; gap: 6px; }
    .verif-cab { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 600; color: var(--gris-5); }
    .item { display: grid; grid-template-columns: 26px 1fr auto; gap: 6px 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--gris-2); border-radius: 12px; background: var(--gris-0); }
    .item.malo { border-color: var(--rojo-borde); background: var(--rojo-claro); }
    .item .n { font-weight: 700; color: var(--gris-4); font-variant-numeric: tabular-nums; }
    .item .txt { font-size: 14px; line-height: 1.35; }
    .opciones { display: inline-flex; border: 1px solid var(--gris-3); border-radius: 10px; overflow: hidden; }
    .op { min-height: 40px; min-width: 58px; padding: 0 10px; border: 0; border-radius: 0; box-shadow: none; background: var(--gris-0); font-weight: 600; font-size: 13px; }
    .op + .op { border-left: 1px solid var(--gris-3); }
    .op.sel.bien, .op.sel.cumple { background: var(--verde); color: #fff; } .op.sel.mal, .op.sel.no_cumple { background: var(--rojo); color: #fff; } .op.sel.na { background: var(--gris-6); color: #fff; }
    .obs { grid-column: 2 / -1; min-height: 36px; }
    @media (max-width: 700px) { .item { grid-template-columns: 22px 1fr; } .opciones { grid-column: 1 / -1; width: 100%; } .op { flex: 1; } }
    .mini-firma { height: 34px; cursor: pointer; } .firma-img { max-height: 70px; display: block; }
    td input { min-height: 34px; }
  `],
})
export class FormularioSst {
  readonly plantilla = input.required<PlantillaSst>();
  readonly datos = input.required<Record<string, any>>();
  readonly soloLectura = input(false);
  readonly abierta = signal('');
  readonly nombre = (o: string) => NOMBRE_OPCION[o] || o;

  private mapa(c: CampoSst) { const d = this.datos(); d[c.id] ||= {}; return d[c.id] as Record<string, { resultado: string; observacion: string }>; }
  valor(c: CampoSst, codigo: string) { return this.datos()[c.id]?.[codigo]?.resultado || ''; }
  obs(c: CampoSst, codigo: string) { return this.datos()[c.id]?.[codigo]?.observacion || ''; }
  marcar(c: CampoSst, codigo: string, o: string) { const m = this.mapa(c); m[codigo] = { resultado: o, observacion: m[codigo]?.observacion || '' }; }
  ponerObs(c: CampoSst, codigo: string, t: string) { const m = this.mapa(c); m[codigo] = { resultado: m[codigo]?.resultado || '', observacion: t }; }
  todoBien(c: CampoSst) { for (const it of c.items || []) if (!this.valor(c, it.codigo)) this.marcar(c, it.codigo, c.opciones![0]); }
  filas(c: CampoSst) { const d = this.datos(); if (!Array.isArray(d[c.id])) d[c.id] = [{}]; return d[c.id] as Record<string, any>[]; }
  agregarFila(c: CampoSst) { this.filas(c).push({}); }
  quitarFila(c: CampoSst, i: number) { this.filas(c).splice(i, 1); }
}
