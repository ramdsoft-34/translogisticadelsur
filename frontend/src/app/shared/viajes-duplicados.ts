import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { DiaPipe, PesosPipe } from './formato';

// Viajes registrados dos veces: se conserva el primero (o el del manifiesto) y se anula el más reciente.
@Component({
  selector: 'app-viajes-duplicados',
  imports: [Modal, DiaPipe, PesosPipe],
  template: `
    <app-modal titulo="Viajes duplicados" [abierto]="abierto()" (cerrar)="cerrar.emit()" [ancho]="true">
      @if (cargando()) { <p class="sutil">Buscando viajes repetidos…</p> }
      @else if (resultado(); as r) {
        <div class="mensaje ok">Se anularon {{ r.anulados.length }} viaje(s) duplicado(s).@if (r.omitidos.length) { {{ r.omitidos.length }} no se tocaron. }</div>
        @if (r.omitidos.length) { <ul class="omit">@for (o of r.omitidos; track o._id) { <li>N° {{ o.numero || '—' }}: {{ o.motivo }}</li> }</ul> }
      } @else if (datos(); as d) {
        @if (!d.total) { <div class="vacio-dup"><strong>No hay viajes duplicados</strong>Ningún viaje se repite con el mismo cliente, placa y día.</div> }
        @else {
          <p class="explica">Son viajes del <strong>mismo cliente, misma placa y mismo día</strong> que quedaron registrados dos veces. Se conserva el que se registró primero
            (normalmente el que tiene manifiesto) y se <strong>anula el más reciente</strong>. Anular no borra: el viaje queda en el historial como anulado y ya no cuenta
            en la liquidación del conductor, las relaciones de cobro ni la contabilidad.</p>
          <div class="pestanas" role="tablist">
            <button type="button" role="tab" [class.activa]="vista() === 'seguro'" (click)="vista.set('seguro')">Mismo destino<span class="chip ok sin-punto">{{ d.seguros }}</span></button>
            <button type="button" role="tab" [class.activa]="vista() === 'revisar'" (click)="vista.set('revisar')">Para revisar<span class="chip alerta sin-punto">{{ d.revisar }}</span></button>
          </div>
          <p class="sutil ayuda">{{ vista() === 'seguro' ? 'El destino coincide: casi seguro es el mismo viaje. Vienen marcados.' : 'El destino está escrito distinto: confirme que sea el mismo viaje antes de marcarlo.' }}</p>
          <div class="tabla-caja"><table class="tabla-movil">
            <thead><tr><th><input type="checkbox" aria-label="Marcar todos" [checked]="todos()" (change)="marcarTodos($any($event.target).checked)" /></th>
              <th>Día · placa</th><th>Se conserva</th><th>Se anula (más reciente)</th></tr></thead>
            <tbody>@for (p of visibles(); track p.duplicado._id) {
              <tr [class.bloq]="!!p.bloqueo">
                <td data-etiqueta="Anular"><input type="checkbox" [disabled]="!!p.bloqueo" [checked]="marcados().has(p.duplicado._id)" (change)="alternar(p.duplicado._id, $any($event.target).checked)" [attr.aria-label]="'Anular el viaje ' + p.duplicado.numero" /></td>
                <td data-etiqueta="Día · placa"><strong>{{ p.fecha | dia }}</strong><br /><span class="placa">{{ p.placa }}</span><br /><small class="sutil">{{ p.cliente }}</small></td>
                <td data-etiqueta="Se conserva" class="lado ok-lado"><strong>N° {{ p.original.numero }}</strong> · {{ p.original.destino }}
                  <small>{{ p.original.manifiesto ? 'Manifiesto ' + p.original.manifiesto : p.original.soporte ? 'Soporte ' + p.original.soporte : 'Sin documento' }} · {{ p.original.flete | pesos }}</small>
                  <small>Registrado {{ p.original.registrado | dia }}</small></td>
                <td data-etiqueta="Se anula" class="lado">
                  <strong>N° {{ p.duplicado.numero }}</strong> · {{ p.duplicado.destino }}
                  <small>{{ p.duplicado.manifiesto ? 'Manifiesto ' + p.duplicado.manifiesto : p.duplicado.soporte ? 'Soporte ' + p.duplicado.soporte + ' (también se anula)' : 'Sin documento' }} · {{ p.duplicado.flete | pesos }}</small>
                  <small>Registrado {{ p.duplicado.registrado | dia }}{{ p.duplicado.historico ? ' · importación del Excel' : '' }}</small>
                  @if (p.nota) { <small class="aviso">{{ p.nota }}</small> }
                  @if (p.bloqueo) { <small class="error-texto">No se puede anular: {{ p.bloqueo }}</small> }</td>
              </tr>
            } @empty { <tr><td colspan="4" class="vacio">Nada en esta pestaña.</td></tr> }</tbody>
          </table></div>
        }
      }
      <ng-container pie>
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        @if (resultado()) { <button type="button" (click)="cargar()">Revisar de nuevo</button> }
        @else if (datos()?.total) { <button type="button" class="peligro" (click)="anular()" [disabled]="!marcados().size || trabajando()">{{ trabajando() ? 'Anulando…' : 'Anular ' + marcados().size + ' duplicado' + (marcados().size === 1 ? '' : 's') }}</button> }
      </ng-container>
    </app-modal>`,
  styles: [`
    .explica { margin: 0 0 12px; font-size: 13.5px; line-height: 1.5; } .ayuda { margin: 0 0 8px; font-size: 12.5px; }
    .tabla-caja { max-height: 55vh; overflow: auto; box-shadow: none; } td { vertical-align: top; font-size: 13px; }
    .lado small { display: block; margin-top: 3px; font-size: 12px; color: var(--gris-5); } .ok-lado strong { color: var(--verde, #2e7d32); }
    .aviso { color: #b26a00 !important; } .error-texto { color: var(--rojo) !important; } tr.bloq td { opacity: .7; }
    .vacio-dup { display: grid; gap: 4px; text-align: center; padding: 24px; color: var(--gris-5); } .omit { margin: 8px 0 0; font-size: 13px; }
  `],
})
export class ViajesDuplicados {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly datos = signal<any>(null);
  readonly resultado = signal<any>(null);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly vista = signal<'seguro' | 'revisar'>('seguro');
  readonly marcados = signal(new Set<string>());
  readonly visibles = computed(() => (this.datos()?.pares || []).filter((p: any) => p.certeza === this.vista()));
  private iniciado = false;

  ngDoCheck() { if (this.abierto() && !this.iniciado) { this.iniciado = true; this.cargar(); } if (!this.abierto()) this.iniciado = false; }

  async cargar() {
    this.cargando.set(true); this.resultado.set(null);
    try {
      const d = await this.api.get<any>('/importaciones/duplicados');
      this.datos.set(d);
      // Los de mismo destino vienen marcados; los de revisar, no
      this.marcados.set(new Set(d.pares.filter((p: any) => p.certeza === 'seguro' && !p.bloqueo).map((p: any) => p.duplicado._id)));
      this.vista.set(d.seguros || !d.revisar ? 'seguro' : 'revisar');
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  todos() { const l = this.visibles().filter((p: any) => !p.bloqueo); return !!l.length && l.every((p: any) => this.marcados().has(p.duplicado._id)); }
  marcarTodos(v: boolean) { this.marcados.update(m => { const n = new Set(m); for (const p of this.visibles()) if (!p.bloqueo) { if (v) n.add(p.duplicado._id); else n.delete(p.duplicado._id); } return n; }); }
  alternar(id: string, v: boolean) { this.marcados.update(m => { const n = new Set(m); if (v) n.add(id); else n.delete(id); return n; }); }

  async anular() {
    const n = this.marcados().size; if (!n) return;
    if (!confirm(`¿Anular ${n} viaje(s) duplicado(s)? Quedan en el historial como anulados y dejan de contar en liquidaciones y cobros.`)) return;
    this.trabajando.set(true);
    try {
      this.resultado.set(await this.api.post<any>('/importaciones/duplicados/anular', { ids: [...this.marcados()] }));
      this.avisos.ok(`${this.resultado().anulados.length} duplicado(s) anulados`);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
