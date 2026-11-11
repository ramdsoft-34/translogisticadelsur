import { Component, inject, input, output, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { DiaPipe, FechaHoraPipe } from './formato';

// Deshacer una importación de viajes: se borran los viajes de ese archivo como si no se hubieran subido, con copia en Excel.
@Component({
  selector: 'app-deshacer-importacion',
  imports: [Modal, DiaPipe, FechaHoraPipe],
  template: `
    <app-modal titulo="Deshacer una importación de viajes" [abierto]="abierto()" (cerrar)="salir()" [ancho]="true">
      @if (hecho(); as h) {
        <div class="mensaje ok">Se borraron {{ h.borrados }} viaje(s). La copia quedó guardada.@if (h.omitidos.length) { {{ h.omitidos.length }} no se tocaron. }</div>
        <p><button type="button" class="primario" (click)="descargar(h.respaldo)">Descargar la copia en Excel</button></p>
        @if (h.omitidos.length) { <ul class="lista">@for (o of h.omitidos; track o._id) { <li>N° {{ o.numero }} · {{ o.placa }}: {{ o.motivo }}</li> }</ul> }
      } @else if (rev(); as r) {
        <p>Archivo <strong>{{ r.archivo || 'sin nombre' }}</strong> · subido {{ r.fecha | fechaHora }}</p>
        <div class="mensaje alerta">Se van a <strong>borrar {{ r.borrar }} viaje(s)</strong> como si no se hubieran subido. Antes se guarda una copia completa que puede descargar en Excel.
          Los números de viaje y de soporte interno no se vuelven a usar.</div>
        @if (r.omitidos.length) {
          <p class="sutil">{{ r.omitidos.length }} no se borran:</p>
          <ul class="lista">@for (o of r.omitidos; track o._id) { <li>N° {{ o.numero }} · {{ o.placa }}: {{ o.motivo }}</li> }</ul>
        }
        <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>N°</th><th>Fecha</th><th>Placa</th><th>Destino</th><th>Soporte</th></tr></thead>
          <tbody>@for (v of r.muestra; track v.numero) { <tr><td data-etiqueta="N°">{{ v.numero }}</td><td data-etiqueta="Fecha">{{ v.fecha | dia }}</td><td data-etiqueta="Placa">{{ v.placa }}</td><td data-etiqueta="Destino">{{ v.destino }}</td><td data-etiqueta="Soporte">{{ v.soporte || '—' }}</td></tr> }</tbody>
        </table></div>
      } @else {
        <p class="sutil">Importaciones hechas desde «Importar datos → Viajes». Elija la que quiere deshacer.</p>
        @if (cargando()) { <p class="sutil">Cargando…</p> }
        <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>Subida</th><th>Archivo</th><th>Viajes</th><th>Siguen en la plataforma</th><th></th></tr></thead>
          <tbody>@for (l of lotes(); track l._id) {
            <tr><td data-etiqueta="Subida">{{ l.fecha | fechaHora }}<br /><small class="sutil">{{ l.usuario }}</small></td>
              <td data-etiqueta="Archivo">{{ l.archivo || '—' }}</td>
              <td data-etiqueta="Viajes">{{ l.creados }} (N° {{ l.desde }} al {{ l.hasta }})</td>
              <td data-etiqueta="Siguen">{{ l.existentes }}</td>
              <td><button type="button" class="pequeno" [disabled]="!l.existentes" (click)="revisar(l._id)">Revisar</button></td></tr>
          } @empty { @if (!cargando()) { <tr><td colspan="5" class="vacio">No hay importaciones de viajes.</td></tr> } }</tbody>
        </table></div>
      }
      <ng-container pie>
        <button type="button" (click)="rev() && !hecho() ? volver() : salir()">{{ rev() && !hecho() ? 'Volver' : 'Cerrar' }}</button>
        @if (rev() && !hecho()) { <button type="button" class="peligro" (click)="deshacer()" [disabled]="!rev().borrar || trabajando()">{{ trabajando() ? 'Borrando…' : 'Guardar copia y borrar ' + rev().borrar + ' viaje(s)' }}</button> }
      </ng-container>
    </app-modal>`,
  styles: [`.lista { margin: 6px 0 10px; font-size: 13px; } .tabla-caja { max-height: 45vh; overflow: auto; box-shadow: none; margin-top: 10px; }`],
})
export class DeshacerImportacion {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly lotes = signal<any[]>([]);
  readonly rev = signal<any>(null);
  readonly hecho = signal<any>(null);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  private loteId = '';
  private iniciado = false;

  ngDoCheck() { if (this.abierto() && !this.iniciado) { this.iniciado = true; this.cargar(); } if (!this.abierto()) this.iniciado = false; }
  async cargar() {
    this.cargando.set(true); this.rev.set(null); this.hecho.set(null);
    try { this.lotes.set(await this.api.get<any[]>('/importaciones/viajes/lotes')); } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  async revisar(id: string) {
    this.loteId = id;
    try { this.rev.set(await this.api.get<any>(`/importaciones/viajes/lotes/${id}`)); } catch (e) { this.avisos.error(e); }
  }
  volver() { this.rev.set(null); }
  salir() { this.rev.set(null); this.hecho.set(null); this.cerrar.emit(); }
  async deshacer() {
    const n = this.rev()?.borrar; if (!n) return;
    if (!confirm(`¿Borrar ${n} viaje(s) de «${this.rev().archivo}»? Se guarda una copia antes de borrar.`)) return;
    this.trabajando.set(true);
    try { this.hecho.set(await this.api.post<any>(`/importaciones/viajes/lotes/${this.loteId}/deshacer`, {})); this.avisos.ok('Importación deshecha'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  descargar(id: string) { this.api.descargar(`/importaciones/respaldos/${id}/xlsx`, undefined, 'Viajes_borrados.xlsx').catch(e => this.avisos.error(e)); }
}
