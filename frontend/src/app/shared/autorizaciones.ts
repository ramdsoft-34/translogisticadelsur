import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { FORMATOS } from './formato';
import { filtrar } from './filtro';

// Historial de autorizaciones del administrador: viajes registrados con documentos vencidos (CA-06)
@Component({
  selector: 'app-autorizaciones',
  imports: [FormsModule, ...FORMATOS],
  template: `
    <p class="sutil">Viajes que se registraron con licencia, SOAT o tecnomecánica vencidos porque el administrador los autorizó con su usuario y contraseña.</p>
    <div class="filtro-rapido"><input type="search" placeholder="Buscar placa, conductor, motivo o usuario" aria-label="Buscar autorizaciones" [value]="q()" (input)="q.set($any($event.target).value)" /></div>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>Fecha</th><th>Viaje</th><th>Placa</th><th>Conductor</th><th>Documentos vencidos</th><th>Motivo</th><th>Autorizó</th><th>Registró</th></tr></thead>
      <tbody>@for (a of visibles(); track a._id) {
        <tr><td data-etiqueta="Fecha">{{ a.createdAt | fechaHora }}</td><td data-etiqueta="Viaje">N° {{ a.viajeNumero }}</td><td data-etiqueta="Placa">{{ a.placa }}</td>
          <td data-etiqueta="Conductor">{{ a.conductorNombre }}</td><td data-etiqueta="Vencidos">{{ a.vencidos.join('; ') }}</td><td data-etiqueta="Motivo">{{ a.motivo }}</td>
          <td data-etiqueta="Autorizó">{{ a.adminNombre }}</td><td data-etiqueta="Registró">{{ a.solicitanteNombre }}</td></tr>
      } @empty { <tr><td colspan="8" class="vacio">No hay autorizaciones</td></tr> }</tbody></table></div>`,
})
export class Autorizaciones {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly lista = signal<any[]>([]);
  readonly q = signal('');
  readonly visibles = computed(() => filtrar<any>(this.lista(), this.q()));
  constructor() { this.api.get<any[]>('/gestion/autorizaciones').then(l => this.lista.set(l)).catch(e => this.avisos.error(e)); }
}
