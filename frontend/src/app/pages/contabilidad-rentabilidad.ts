// Contabilidad fase 6: rentabilidad por viaje, vehículo, cliente o ruta (pestaña «Rentabilidad» de Contabilidad).
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from '../shared/icono';
import { FORMATOS, hoyIso } from '../shared/formato';
import { VisorPdf } from '../shared/visor-pdf';

type Agrupar = 'placa' | 'cliente' | 'ruta' | 'viaje';
const inicioMes = () => `${hoyIso().slice(0, 7)}-01`;

@Component({
  selector: 'app-cont-rentabilidad',
  imports: [FormsModule, Icono, VisorPdf, ...FORMATOS],
  template: `
    <app-visor-pdf #visor />
    <div class="barra-mini">
      <div class="campo"><label for="rn-d">Desde</label><input id="rn-d" type="date" [(ngModel)]="desde" /></div>
      <div class="campo"><label for="rn-h">Hasta</label><input id="rn-h" type="date" [(ngModel)]="hasta" /></div>
      <div class="campo"><label for="rn-p">Placa (opcional)</label><input id="rn-p" [(ngModel)]="placa" maxlength="7" style="width:110px;text-transform:uppercase" /></div>
      <button class="primario" (click)="cargar()" [disabled]="cargando()">Consultar</button>
      <button (click)="excel()"><app-icono nombre="descargar" [tam]="14" />Excel</button>
      <button (click)="visor.ver('/gestion/contabilidad/rentabilidad', titulo(), { ...params(), formato: 'pdf', ver: 1 })"><app-icono nombre="ojo" [tam]="14" />PDF</button>
    </div>
    <div class="segmentos" style="margin-bottom:12px">
      @for (a of agrupaciones; track a[0]) { <button type="button" [class.activo]="agrupar() === a[0]" (click)="cambiar(a[0])">{{ a[1] }}</button> }
    </div>

    @if (datos(); as d) {
      <div class="panel-mini">
        <div><span>Viajes</span><strong>{{ d.totales.viajes | miles }}</strong></div>
        <div><span>Ingreso</span><strong>{{ d.totales.ingreso | pesos }}</strong></div>
        <div><span>Fletes y auxiliares</span><strong>{{ d.totales.flete + d.totales.auxiliar | pesos }}</strong></div>
        <div><span>Costos de los vehículos</span><strong>{{ d.totales.costosVehiculo | pesos }}</strong></div>
        <div><span>Utilidad de la operación</span><strong [class.negativo]="d.totales.utilidad < 0">{{ d.totales.utilidad | pesos }} · {{ d.totales.margen }} %</strong></div>
      </div>
      @for (a of d.avisos; track a) { <div class="mensaje alerta">{{ a }}</div> }
      @if (grafica().length) {
        <div class="grafica" role="img" [attr.aria-label]="'Utilidad por ' + nombreAgrupar()">
          @for (g of grafica(); track g.clave) {
            <div class="barra-fila"><span class="etq" [title]="g.nombre">{{ g.nombre }}</span>
              <span class="pista"><span class="valor" [class.neg]="g.utilidad < 0" [style.width.%]="g.ancho"></span></span>
              <span class="num">{{ g.utilidad | pesos }}</span></div>
          }
        </div>
      }
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>{{ nombreAgrupar() }}</th><th class="num">Viajes</th><th class="num">Ingreso</th><th class="num">Flete conductor</th><th class="num">Auxiliar pagado</th>
          <th class="num">Costos del vehículo</th><th class="num">Utilidad</th><th class="num">Margen</th></tr></thead>
        <tbody>@for (f of d.filas; track f.clave) {
          <tr><td [attr.data-etiqueta]="nombreAgrupar()">{{ f.nombre }}</td><td data-etiqueta="Viajes" class="num">{{ f.viajes }}</td>
            <td data-etiqueta="Ingreso" class="num">{{ f.ingreso | pesos }}</td><td data-etiqueta="Flete" class="num">{{ f.flete | pesos }}</td>
            <td data-etiqueta="Auxiliar" class="num">{{ f.auxiliar | pesos }}</td><td data-etiqueta="Costos" class="num">{{ f.costosVehiculo | pesos }}</td>
            <td data-etiqueta="Utilidad" class="num" [class.negativo]="f.utilidad < 0"><strong>{{ f.utilidad | pesos }}</strong></td>
            <td data-etiqueta="Margen" class="num" [class.negativo]="f.margen < 0">{{ f.margen }} %</td></tr>
        } @empty { <tr><td colspan="8" class="vacio">Sin viajes en el periodo</td></tr> }
        <tr class="total"><td>Total</td><td class="num">{{ d.totales.viajes }}</td><td class="num">{{ d.totales.ingreso | pesos }}</td><td class="num">{{ d.totales.flete | pesos }}</td>
          <td class="num">{{ d.totales.auxiliar | pesos }}</td><td class="num">{{ d.totales.costosVehiculo | pesos }}</td><td class="num">{{ d.totales.utilidad | pesos }}</td><td class="num">{{ d.totales.margen }} %</td></tr>
        </tbody></table></div>
      <p class="sutil">Ingreso y fletes como en la liquidación de cada viaje. Los costos del vehículo son los gastos y compras registrados con su placa más la depreciación
        del activo con esa placa; se reparten entre sus viajes según lo cobrado. No incluye gastos generales sin vehículo (están en el estado de resultados).</p>
    }
  `,
  styles: [`
    .barra-mini { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-bottom: 12px; }
    .panel-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 10px 0; }
    .panel-mini > div { padding: 8px 10px; border: 1px solid var(--gris-2); border-radius: var(--radio); display: flex; flex-direction: column; gap: 2px; }
    .panel-mini span { font-size: 12px; color: var(--gris-5); } .panel-mini strong { font-variant-numeric: tabular-nums; }
    tr.total td { font-weight: 700; background: var(--gris-1); } .negativo { color: var(--rojo); }
    .grafica { display: flex; flex-direction: column; gap: 4px; margin: 10px 0 14px; max-width: 760px; }
    .barra-fila { display: grid; grid-template-columns: minmax(90px, 220px) 1fr 120px; gap: 8px; align-items: center; font-size: 13px; }
    .etq { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .num { text-align: right; font-variant-numeric: tabular-nums; }
    .pista { background: var(--gris-1); border-radius: 4px; height: 14px; overflow: hidden; }
    .valor { display: block; height: 100%; background: var(--verde); border-radius: 4px; } .valor.neg { background: var(--rojo); }
  `],
})
export class RentabilidadCont {
  private api = inject(Api); private avisos = inject(Avisos);
  readonly agrupaciones: [Agrupar, string][] = [['placa', 'Por vehículo'], ['cliente', 'Por cliente'], ['ruta', 'Por ruta'], ['viaje', 'Por viaje']];
  readonly agrupar = signal<Agrupar>('placa');
  readonly datos = signal<any>(null);
  readonly cargando = signal(false);
  desde = inicioMes(); hasta = hoyIso(); placa = '';
  // Las 12 filas con más utilidad (o pérdida), en barras proporcionales
  readonly grafica = computed(() => {
    const filas = (this.datos()?.filas || []).filter((f: any) => f.clave !== '-').slice().sort((a: any, b: any) => Math.abs(b.utilidad) - Math.abs(a.utilidad)).slice(0, 12);
    const max = Math.max(1, ...filas.map((f: any) => Math.abs(f.utilidad)));
    return filas.map((f: any) => ({ ...f, ancho: Math.round(Math.abs(f.utilidad) / max * 100) }));
  });

  constructor() { this.cargar(); }
  nombreAgrupar() { return ({ placa: 'Vehículo', cliente: 'Cliente', ruta: 'Ruta', viaje: 'Viaje' } as Record<Agrupar, string>)[this.agrupar()]; }
  titulo() { return `Rentabilidad por ${this.nombreAgrupar().toLowerCase()}`; }
  params() { return { desde: this.desde, hasta: this.hasta, agrupar: this.agrupar(), placa: this.placa.trim().toUpperCase() }; }
  cambiar(a: Agrupar) { this.agrupar.set(a); this.cargar(); }
  async cargar() {
    this.cargando.set(true);
    try { this.datos.set(await this.api.get('/gestion/contabilidad/rentabilidad', this.params())); }
    catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  async excel() {
    try { await this.api.descargar('/gestion/contabilidad/rentabilidad', { ...this.params(), formato: 'xlsx' }, 'Rentabilidad.xlsx'); } catch (e) { this.avisos.error(e); }
  }
}
