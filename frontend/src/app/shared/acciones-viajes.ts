import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Moneda } from './moneda';
import { DiaPipe } from './formato';

export interface ViajeElegido { _id: string; numero: number; placa: string; fecha: string; destino: string }
type Accion = 'auxiliar_pagado' | 'auxiliar' | 'valores' | 'aplicar_tarifa' | 'observaciones' | 'no_facturar' | 'manifiesto' | 'eliminar';

const ACCIONES: { id: Accion; titulo: string; ayuda: string }[] = [
  { id: 'auxiliar_pagado', titulo: 'Auxiliar pagado', ayuda: 'Marcar o quitar «Pagado»: el pagado no se suma al saldo del conductor' },
  { id: 'auxiliar', titulo: 'Días de auxiliar', ayuda: 'Poner de 1 a 5 días o quitar el auxiliar' },
  { id: 'valores', titulo: 'Cambiar valores', ayuda: 'Tarifa, flete o anticipo con un mismo valor' },
  { id: 'aplicar_tarifa', titulo: 'Valores de su tarifa', ayuda: 'Tarifa, flete y anticipo de la base de tarifas y fletes' },
  { id: 'observaciones', titulo: 'Observaciones', ayuda: 'Agregar, reemplazar o quitar un texto' },
  { id: 'no_facturar', titulo: 'No facturar', ayuda: 'Marcar o quitar [NO FACTURAR] (no entran en la factura del cliente)' },
  { id: 'manifiesto', titulo: 'Manifiesto o soporte', ayuda: 'Con manifiesto del RNDC o con soporte interno (solo sin documentos)' },
  { id: 'eliminar', titulo: 'Eliminar', ayuda: 'Solo los que no tienen documentos ni soporte interno' },
];

// Acciones con varios viajes a la vez: elegir la acción → revisar a cuáles se aplica (y por qué se omiten otros) → aplicar.
@Component({
  selector: 'app-acciones-viajes',
  imports: [FormsModule, Modal, Moneda, DiaPipe],
  template: `
    <app-modal [titulo]="'Acciones con ' + seleccion().length + ' viaje' + (seleccion().length === 1 ? '' : 's')" [abierto]="abierto()" (cerrar)="salir()" [ancho]="true">
      <details class="lista-elegidos">
        <summary><strong>{{ seleccion().length }}</strong> viaje(s) seleccionado(s) · ver la lista</summary>
        <ul>@for (v of seleccion(); track v._id) {
          <li><span>N° {{ v.numero }} · {{ v.placa }} · {{ v.fecha | dia }} · {{ v.destino }}</span>
            <button type="button" class="pequeno" (click)="quitar.emit(v._id); limpiarRevision()" [attr.aria-label]="'Quitar el viaje ' + v.numero + ' de la selección'">Quitar</button></li>
        }</ul>
      </details>

      @if (!resultado()) {
        <h3>1. ¿Qué quiere hacer?</h3>
        <div class="acciones" role="radiogroup" aria-label="Acción">
          @for (a of ACCIONES; track a.id) {
            <label class="accion" [class.elegida]="accion() === a.id" [class.peligro]="a.id === 'eliminar'">
              <input type="radio" name="accion" [value]="a.id" [checked]="accion() === a.id" (change)="elegir(a.id)" />
              <strong>{{ a.titulo }}</strong><small>{{ a.ayuda }}</small></label>
          }
        </div>

        @if (accion(); as a) {
          <h3>2. Detalle</h3>
          <div class="detalle">
            @switch (a) {
              @case ('auxiliar_pagado') {
                <label class="casilla"><input type="radio" name="pag" [checked]="v.pagado === true" (change)="poner('pagado', true)" />Pagado (no suma al saldo del conductor)</label>
                <label class="casilla"><input type="radio" name="pag" [checked]="v.pagado === false" (change)="poner('pagado', false)" />Pendiente de pago</label>
              }
              @case ('auxiliar') {
                <div class="campo"><label for="am-dias">Auxiliar</label>
                  <select id="am-dias" [ngModel]="v.dias" (ngModelChange)="poner('dias', $event)"><option [ngValue]="undefined" disabled>Elegir…</option>
                    <option [ngValue]="0">Sin auxiliar</option>@for (d of [1, 2, 3, 4, 5]; track d) { <option [ngValue]="d">{{ d }} {{ d === 1 ? 'día' : 'días' }}</option> }</select></div>
              }
              @case ('valores') {
                <p class="sutil">Deje vacío lo que no quiere cambiar. En los viajes con manifiesto solo se cambia la tarifa del cliente.</p>
                <div class="rejilla3">
                  <div class="campo"><label for="am-tar">Tarifa</label><div class="moneda"><input id="am-tar" moneda name="tar" [ngModel]="v.tarifa" (ngModelChange)="poner('tarifa', $event)" /></div></div>
                  <div class="campo"><label for="am-fle">Flete</label><div class="moneda"><input id="am-fle" moneda name="fle" [ngModel]="v.flete" (ngModelChange)="poner('flete', $event)" /></div></div>
                  <div class="campo"><label for="am-ant">Anticipo</label><div class="moneda"><input id="am-ant" moneda name="ant" [ngModel]="v.anticipo" (ngModelChange)="poner('anticipo', $event)" /></div></div>
                </div>
              }
              @case ('aplicar_tarifa') { <p class="sutil">Cada viaje toma la tarifa, el flete y el anticipo de su destino en Clientes y tarifas. En los que ya tienen manifiesto solo se actualiza la tarifa del cliente.</p> }
              @case ('observaciones') {
                <div class="rejilla2">
                  <div class="campo"><label for="am-modo">Cómo</label>
                    <select id="am-modo" [ngModel]="v.modo" (ngModelChange)="poner('modo', $event)"><option value="agregar">Agregar al final</option><option value="reemplazar">Reemplazar todo</option><option value="quitar">Quitar este texto</option></select></div>
                  <div class="campo"><label for="am-txt">Texto</label><input id="am-txt" maxlength="200" [ngModel]="v.texto" (ngModelChange)="poner('texto', $event)" placeholder="Observación" /></div>
                </div>
              }
              @case ('no_facturar') {
                <label class="casilla"><input type="radio" name="nf" [checked]="v.marcar === true" (change)="poner('marcar', true)" />Marcar [NO FACTURAR]</label>
                <label class="casilla"><input type="radio" name="nf" [checked]="v.marcar === false" (change)="poner('marcar', false)" />Quitar la marca (vuelven a facturarse)</label>
              }
              @case ('manifiesto') {
                <label class="casilla"><input type="radio" name="man" [checked]="v.requiere === true" (change)="poner('requiere', true)" />Llevan manifiesto del RNDC</label>
                <label class="casilla"><input type="radio" name="man" [checked]="v.requiere === false" (change)="poner('requiere', false)" />Sin manifiesto: soporte interno (se numera al aplicar)</label>
              }
              @case ('eliminar') { <div class="mensaje alerta compacto">Los viajes se borran y no se pueden recuperar. Los que tienen documentos del RNDC o soporte interno se omiten.</div> }
            }
          </div>
        }

        @if (revision(); as r) {
          <h3>3. Lo que se va a hacer</h3>
          <div class="totales">
            <span class="chip ok sin-punto">Se aplica a {{ r.aplicables.length }}</span>
            @if (r.omitidos.length) { <span class="chip alerta sin-punto">Se omiten {{ r.omitidos.length }}</span> }
          </div>
          @if (r.aplicables.length) {
            <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>N°</th><th>Placa</th><th>Fecha</th><th>Cambio</th></tr></thead>
              <tbody>@for (x of r.aplicables; track x._id) { <tr><td data-etiqueta="N°">{{ x.numero }}</td><td data-etiqueta="Placa">{{ x.placa }}</td><td data-etiqueta="Fecha">{{ x.fecha | dia }}</td><td data-etiqueta="Cambio">{{ x.cambio }}</td></tr> }</tbody></table></div>
          }
          @if (r.omitidos.length) {
            <details class="omitidos" [open]="!r.aplicables.length"><summary>Ver por qué se omiten {{ r.omitidos.length }}</summary>
              <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>N°</th><th>Placa</th><th>Motivo</th></tr></thead>
                <tbody>@for (x of r.omitidos; track x._id) { <tr><td data-etiqueta="N°">{{ x.numero }}</td><td data-etiqueta="Placa">{{ x.placa }}</td><td data-etiqueta="Motivo">{{ x.motivo }}</td></tr> }</tbody></table></div>
            </details>
          }
        }
      } @else {
        @if (resultado(); as r) {
          <div class="mensaje" [class.ok]="!r.fallidos.length" [class.alerta]="r.fallidos.length">
            Listo: se {{ accion() === 'eliminar' ? 'eliminaron' : 'actualizaron' }} {{ r.aplicados.length }} viaje(s).
            @if (r.omitidos.length) { {{ r.omitidos.length }} se omitieron. } @if (r.fallidos.length) { {{ r.fallidos.length }} no se pudieron cambiar. }
          </div>
          @if (r.fallidos.length) { <ul>@for (x of r.fallidos; track x._id) { <li>N° {{ x.numero }}: {{ x.motivo }}</li> }</ul> }
        }
      }

      <ng-container pie>
        <button type="button" (click)="salir()">{{ resultado() ? 'Cerrar' : 'Cancelar' }}</button>
        @if (!resultado()) {
          <button type="button" (click)="revisar()" [disabled]="!listo() || trabajando()">{{ trabajando() && !revision() ? 'Revisando…' : 'Revisar cambios' }}</button>
          <button type="button" [class.primario]="accion() !== 'eliminar'" [class.peligro]="accion() === 'eliminar'" (click)="aplicar()"
            [disabled]="!revision()?.aplicables?.length || trabajando()">{{ accion() === 'eliminar' ? 'Eliminar' : 'Aplicar a' }} {{ revision()?.aplicables?.length || 0 }} viaje(s)</button>
        } @else { <button type="button" class="primario" (click)="otraAccion()">Otra acción</button> }
      </ng-container>
    </app-modal>`,
  styles: [`
    h3 { font-size: 14px; margin: 16px 0 8px; }
    .lista-elegidos summary { cursor: pointer; } .lista-elegidos ul { list-style: none; padding: 0; margin: 8px 0 0; max-height: 180px; overflow: auto; display: grid; gap: 4px; }
    .lista-elegidos li { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; padding: 4px 8px; border-radius: 8px; background: var(--gris-1); }
    .acciones { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .accion { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--gris-2); border-radius: 12px; cursor: pointer; position: relative; }
    .accion input { position: absolute; opacity: 0; pointer-events: none; }
    .accion small { color: var(--gris-5); font-size: 12px; line-height: 1.35; }
    .accion.elegida { border-color: var(--gris-8); box-shadow: inset 0 0 0 1px var(--gris-8); background: var(--gris-1); }
    .accion.peligro strong { color: var(--rojo); }
    .accion:has(input:focus-visible) { outline: 2px solid var(--primario, #F5B800); outline-offset: 2px; }
    .detalle { display: grid; gap: 8px; }
    .rejilla2, .rejilla3 { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .totales { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .tabla-caja { max-height: 280px; overflow: auto; box-shadow: none; }
    .omitidos { margin-top: 10px; } .omitidos summary { cursor: pointer; font-weight: 600; }
  `],
})
export class AccionesViajes {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly abierto = input(false);
  readonly seleccion = input<ViajeElegido[]>([]);
  readonly cerrar = output<void>();
  readonly quitar = output<string>();
  readonly aplicado = output<{ eliminados: string[] }>();
  readonly ACCIONES = ACCIONES;
  readonly accion = signal<Accion | null>(null);
  readonly revision = signal<{ aplicables: any[]; omitidos: any[] } | null>(null);
  readonly resultado = signal<{ aplicados: any[]; fallidos: any[]; omitidos: any[] } | null>(null);
  readonly trabajando = signal(false);
  private readonly valores = signal<Record<string, any>>({});
  get v(): any { return this.valores(); }

  readonly listo = computed(() => {
    const a = this.accion(); const x = this.valores();
    if (!a || !this.seleccion().length) return false;
    switch (a) {
      case 'auxiliar_pagado': return x['pagado'] !== undefined;
      case 'auxiliar': return x['dias'] !== undefined && x['dias'] !== null;
      case 'valores': return ['tarifa', 'flete', 'anticipo'].some(k => x[k] !== undefined && x[k] !== null && x[k] !== '');
      case 'observaciones': return !!x['modo'] && (x['modo'] === 'reemplazar' || !!String(x['texto'] || '').trim());
      case 'no_facturar': return x['marcar'] !== undefined;
      case 'manifiesto': return x['requiere'] !== undefined;
      default: return true;
    }
  });

  elegir(a: Accion) { this.accion.set(a); this.valores.set(a === 'observaciones' ? { modo: 'agregar' } : {}); this.revision.set(null); }
  poner(k: string, val: any) { this.valores.update(x => ({ ...x, [k]: val })); this.revision.set(null); }
  limpiarRevision() { this.revision.set(null); }
  otraAccion() { this.resultado.set(null); this.revision.set(null); this.accion.set(null); this.valores.set({}); }
  salir() { this.otraAccion(); this.cerrar.emit(); }

  private cuerpo(simular: boolean) {
    const x = { ...this.valores() };
    for (const k of ['tarifa', 'flete', 'anticipo']) if (x[k] === null || x[k] === '') delete x[k];
    return { ids: this.seleccion().map(s => s._id), accion: this.accion(), valores: x, simular };
  }
  async revisar() {
    this.trabajando.set(true);
    try { this.revision.set(await this.api.post<any>('/viajes/masivo', this.cuerpo(true))); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async aplicar() {
    const n = this.revision()?.aplicables?.length || 0; if (!n) return;
    if (this.accion() === 'eliminar' && !confirm(`¿Eliminar ${n} viaje(s)? No se puede deshacer.`)) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/viajes/masivo', this.cuerpo(false));
      this.resultado.set(r); this.revision.set(null);
      this.aplicado.emit({ eliminados: r.aplicados.filter((x: any) => x.eliminado).map((x: any) => x._id) });
      this.avisos.ok(`${r.aplicados.length} viaje(s) ${this.accion() === 'eliminar' ? 'eliminados' : 'actualizados'}`);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
