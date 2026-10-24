import { Component, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';
import { filtrar } from '../shared/filtro';

@Component({
  selector: 'app-liquidaciones',
  imports: [FormsModule, RouterLink, Icono, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Facturación a clientes</h1>
      <p class="sutil">Relación de viajes por cliente y periodo: lo que se cobra, lo que se paga al conductor y la utilidad. Un viaje liquidado no se vuelve a cobrar.
        Paso siguiente: la factura y su cobro, en Contabilidad.</p></div>
      <div class="acciones"><a class="boton" routerLink="/contabilidad" [queryParams]="{ tab: 'facturas' }"><app-icono nombre="documento" [tam]="16" />Facturas y cobros</a></div></div>

    <div class="tarjeta">
      <div class="filtros" style="margin:0">
        <div class="campo"><label for="l-cli">Cliente</label><select id="l-cli" [(ngModel)]="p.cliente"><option value="">Seleccione…</option>
          @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
        <div class="campo"><label for="l-d">Desde</label><input id="l-d" type="date" [(ngModel)]="p.desde" /></div>
        <div class="campo"><label for="l-h">Hasta</label><input id="l-h" type="date" [(ngModel)]="p.hasta" /></div>
        <button (click)="calcular()" [disabled]="!p.cliente">Calcular</button>
        @if (calculo()?.lineas?.length && puedeGestionar) { <button class="primario" (click)="guardar()" [disabled]="guardando()"><app-icono nombre="check" />Guardar liquidación</button> }
      </div>
      @if (calculo(); as c) {
        @if (c.lineas.length) {
          @if (sinTarifa(c) > 0) { <div class="mensaje alerta" style="margin-top:12px">{{ sinTarifa(c) }} viaje(s) sin tarifa registrada para su destino: se usó la tarifa y el flete del viaje, sin auxiliar.</div> }
          <div class="tabla-caja" style="margin-top:14px;box-shadow:none">
            <table><thead><tr><th>Fecha</th><th>Placa</th><th>Conductor</th><th>Destino</th><th>Manifiesto</th><th class="num">Cant.</th><th>Aux.</th>
              <th class="num">Cobrado</th><th class="num">Flete</th><th class="num">Aux. pagado</th><th class="num">Utilidad</th></tr></thead>
              <tbody>@for (l of c.lineas; track l.viaje) {
                <tr><td>{{ l.fecha | dia }}</td><td>{{ l.placa }}</td><td>{{ l.conductor }}</td><td>{{ l.destino }}</td><td>{{ l.manifiesto }}</td>
                  <td class="num">{{ l.cantidad }}</td><td>{{ l.conAuxiliar ? 'Sí' : 'No' }}</td><td class="num">{{ l.totalCobrado | pesos }}</td>
                  <td class="num">{{ l.totalFlete | pesos }}</td><td class="num">{{ l.totalAuxiliarPagado | pesos }}</td><td class="num">{{ l.utilidad | pesos }}</td></tr>
              }</tbody>
              <tfoot><tr><td colspan="5">{{ c.totales.viajes }} viaje(s)</td><td class="num">{{ c.totales.cantidad }}</td><td></td>
                <td class="num">{{ c.totales.totalCobrado | pesos }}</td><td class="num">{{ c.totales.totalFlete | pesos }}</td>
                <td class="num">{{ c.totales.totalAuxiliarPagado | pesos }}</td><td class="num">{{ c.totales.utilidad | pesos }} ({{ (c.totales.utilidadPct * 100).toFixed(1) }} %)</td></tr></tfoot>
            </table>
          </div>
        } @else { <p class="sutil" style="margin-top:12px">No hay viajes sin liquidar para ese cliente y periodo.</p> }
      }
    </div>

    <div class="tarjeta">
      <div class="cab-filtro"><h2>Liquidaciones guardadas</h2><div class="filtro-rapido"><input type="search" placeholder="Buscar N°, cliente o periodo" aria-label="Buscar N°, cliente o periodo" [value]="q()" (input)="q.set($any($event.target).value)" /></div>
        <select aria-label="Filtrar por estado" [value]="estadoLiq()" (change)="estadoLiq.set($any($event.target).value)">
          <option value="">Todos los estados</option><option value="borrador">Borrador</option><option value="facturada">Facturada</option><option value="anulada">Anulada</option></select></div>
      <div class="tabla-caja" style="box-shadow:none">
        <table><thead><tr><th>N°</th><th>Cliente</th><th>Periodo</th><th class="num">Viajes</th><th class="num">Total cobrado</th><th class="num">Utilidad</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (l of listaVisible(); track l._id) {
            <tr><td>{{ l.numero }}</td><td>{{ l.cliente?.nombre }}</td><td>{{ l.titulo }}</td><td class="num">{{ l.totales?.viajes }}</td>
              <td class="num">{{ l.totales?.totalCobrado | pesos }}</td><td class="num">{{ l.totales?.utilidad | pesos }}</td>
              <td><span class="chip" [class.ok]="l.estado === 'facturada'" [class.error]="l.estado === 'anulada'">{{ l.estado }}</span></td>
              <td><div class="acciones" style="justify-content:flex-end">
                <button class="pequeno" (click)="descargar(l, 'xlsx')">Excel</button><button class="pequeno" (click)="descargar(l, 'pdf')">PDF</button>
                @if (puedeGestionar && l.estado === 'borrador') { <button class="pequeno" (click)="estado(l, 'facturada')">Marcar facturada</button> }
                @if (puedeGestionar && l.estado !== 'anulada') { <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="estado(l, 'anulada')">Anular</button> }
              </div></td></tr>
          } @empty { <tr><td colspan="8" class="vacio">Aún no hay liquidaciones</td></tr> }</tbody></table>
      </div>
    </div>`,
})
export class Liquidaciones {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeGestionar = this.auth.tiene(P.LIQUIDACION_GESTIONAR);
  readonly clientes = signal<any[]>([]);
  readonly lista = signal<any[]>([]);
  readonly q = signal('');
  readonly estadoLiq = signal('');
  readonly listaVisible = computed(() => filtrar(this.lista().filter(l => !this.estadoLiq() || l.estado === this.estadoLiq()), this.q()));
  readonly calculo = signal<any>(null);
  readonly guardando = signal(false);
  p = { cliente: '', desde: inicioMesIso(), hasta: hoyIso() };

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['liquidaciones', 'viajes'], () => this.cargar());

  constructor() {
    this.api.get<any[]>('/maestros/clientes').then(c => this.clientes.set(c)).catch(e => this.avisos.error(e));
    this.cargar();
  }

  async cargar() { try { this.lista.set(await this.api.get<any[]>('/liquidaciones')); } catch (e) { this.avisos.error(e); } }
  sinTarifa(c: any) { return c.lineas.filter((l: any) => l.sinTarifa).length; }

  async calcular() {
    try { this.calculo.set(await this.api.post('/liquidaciones/calcular', this.p)); } catch (e) { this.avisos.error(e); }
  }

  async guardar() {
    this.guardando.set(true);
    try {
      const l = await this.api.post<any>('/liquidaciones', this.p);
      this.avisos.ok(`Liquidación N° ${l.numero} guardada`);
      this.calculo.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.guardando.set(false); }
  }

  async estado(l: any, estado: string) {
    try { await this.api.put(`/liquidaciones/${l._id}/estado`, { estado }); this.cargar(); } catch (e) { this.avisos.error(e); }
  }

  async descargar(l: any, tipo: string) {
    try { await this.api.descargar(`/reportes/liquidacion/${l._id}.${tipo}`, {}, `Liquidacion_${l.numero}.${tipo}`); } catch (e) { this.avisos.error(e); }
  }
}
