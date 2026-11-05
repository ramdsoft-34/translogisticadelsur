import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { PerfilSst } from '../shared/perfil-sst';
import { FORMATOS } from '../shared/formato';

const ESTADO: Record<string, [string, string]> = { vencido: ['Vencido', 'error'], por_vencer: ['Por vencer', 'alerta'], al_dia: ['Al día', 'ok'], sin_datos: ['Sin datos', ''] };

// Vista del SG-SST sobre las personas que ya existen: conductores (Datos → Conductores) y empleados (Nómina).
// Aquí no se crean personas; se abre su perfil SST, que se guarda en su propia ficha.
@Component({
  selector: 'app-sst-personas',
  imports: [FormsModule, RouterLink, PerfilSst, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Personas</h1><p class="sutil">Conductores (de <a routerLink="/conductores">Conductores y terceros</a>) y empleados (de Nómina) con su estado en el SG-SST y el PESV. Para agregar a alguien, regístrelo allá.</p></div>
    </div>
    <div class="barra">
      <div class="campo crece"><label for="s-q">Buscar</label><input id="s-q" type="search" [(ngModel)]="q" placeholder="Nombre, documento o placa" /></div>
      <div class="campo"><label for="s-t">Tipo</label><select id="s-t" [(ngModel)]="tipo"><option value="">Todos</option><option value="tercero">Conductores</option><option value="empleado">Empleados</option></select></div>
      <div class="campo"><label for="s-e">Estado</label><select id="s-e" [(ngModel)]="estado"><option value="">Todos</option><option value="vencido">Con algo vencido</option><option value="por_vencer">Por vencer</option><option value="sin_datos">Sin datos</option></select></div>
    </div>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>Persona</th><th>Cargo</th><th>Licencia</th><th>Examen médico</th><th>EPP</th><th>Comparendos</th><th>Estado SST</th><th></th></tr></thead>
      <tbody>
        @for (x of filtrar(); track x._id) {
          <tr><td data-etiqueta="Persona"><strong>{{ x.nombre }}</strong><span class="sutil d-bloque">{{ x.documento }} @if (x.placa) { · <span class="placa">{{ x.placa }}</span> }</span></td>
            <td data-etiqueta="Cargo">{{ x.cargo }}</td>
            <td data-etiqueta="Licencia">@if (x.licencia?.vence) { {{ x.licencia.categoria }} · {{ x.licencia.vence | dia }} } @else if (x.tipo === 'tercero') { <span class="sutil">Sin licencia</span> }</td>
            <td data-etiqueta="Examen">{{ x.examen ? 'Registrado' : '—' }}</td><td data-etiqueta="EPP">{{ x.epp }}</td>
            <td data-etiqueta="Comparendos">@if (x.comparendos) { <span class="chip error sin-punto">{{ x.comparendos }} pendiente(s)</span> } @else { 0 }</td>
            <td data-etiqueta="Estado SST"><span class="chip sin-punto" [class]="claseEstado(x.estado)">{{ textoEstado(x.estado) }}</span></td>
            <td><button class="pequeno" (click)="perfil.abrir(x.tipo, x._id)">SST y PESV</button></td></tr>
        } @empty { <tr><td colspan="8" class="vacio"><strong>Sin personas</strong>Los conductores se registran en Datos → Conductores y los empleados en Nómina.</td></tr> }
      </tbody>
    </table></div>
    <app-perfil-sst #perfil />`,
  styles: [`.placa { font-size: 12px; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: var(--primario); color: #0f0e0c; }`],
})
export class SstPersonas {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly lista = signal<any[]>([]);
  q = ''; tipo = ''; estado = '';
  filtrar() {
    const q = this.q.trim().toLowerCase();
    return this.lista().filter(x => (!q || `${x.nombre} ${x.documento} ${x.placa || ''}`.toLowerCase().includes(q)) && (!this.tipo || x.tipo === this.tipo) && (!this.estado || x.estado === this.estado));
  }
  textoEstado = (e: string) => ESTADO[e]?.[0] || e;
  claseEstado = (e: string) => ESTADO[e]?.[1] || '';
  constructor() { this.cargar(); }
  async cargar() { try { this.lista.set(await this.api.get<any[]>('/sst/personas')); } catch (e) { this.avisos.error(e); } }
}
