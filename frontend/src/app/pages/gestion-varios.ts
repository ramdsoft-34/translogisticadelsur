import { Paginador } from '../shared/paginador';
import { PaginaLocal } from '../shared/pagina-local';
import { Component, inject, input, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';

// ── Cierre de mes ──
@Component({
  selector: 'app-cierre-mes',
  imports: [FormsModule, Icono, Confirmar, ...FORMATOS, Paginador],
  template: `
    <div class="pagina-cab" [class.embebida]="embebido()"><div>@if (!embebido()) { <h1>Cierre de mes</h1> }
      <p class="sutil">Al cerrar un mes ya no se pueden registrar, modificar ni anular viajes, liquidaciones, préstamos ni asientos con fecha de ese mes.
        Los datos se conservan. Antes de cerrar se guardan en el servidor la copia completa de los datos, los informes de viajes por empresa
        y los PDF de los manifiestos del mes. Solo el administrador cierra y reabre meses.</p></div>
      @if (puedeCerrar) {
        <div class="acciones"><button (click)="descargarRespaldo()" [disabled]="trabajando()"><app-icono nombre="descargar" />Descargar respaldo completo</button></div>
      }</div>
    <div class="tarjeta">
      <div class="filtros" style="margin:0">
        <div class="campo"><label for="cm-m">Mes</label><input id="cm-m" type="month" [(ngModel)]="mes" (change)="revisar()" /></div>
        <button (click)="revisar()">Revisar el mes</button>
        @if (puedeCerrar && resumen()) {
          <button (click)="archivar()" [disabled]="trabajando()" title="Guarda ahora los PDF de manifiestos y los informes del mes, sin cerrarlo">Guardar PDF e informes</button>
          <button class="primario" confirmar="Clic otra vez para cerrar el mes" (confirmado)="cerrar()" [disabled]="trabajando()"><app-icono nombre="candado" />Cerrar {{ mes }}</button> }
      </div>
      @if (resumen(); as r) {
        <div class="resumen-mes">
          <div><span>Viajes</span><strong>{{ r.viajes }}</strong></div>
          <div><span>Sin manifiesto RNDC</span><strong>{{ r.pendientesRndc }}</strong></div>
          <div><span>Sin facturar</span><strong>{{ r.sinFacturar }}</strong></div>
          <div><span>Sin liquidar al conductor</span><strong>{{ r.sinLiquidarConductor }}</strong></div>
          <div><span>Facturas</span><strong>{{ r.facturas }}</strong></div>
          <div><span>Liquidaciones de conductores</span><strong>{{ r.liqConductores }}</strong></div>
        </div>
        @if (r.avisos.length) { <div class="mensaje alerta"><strong>Antes de cerrar revise:</strong><ul>@for (a of r.avisos; track a) { <li>{{ a }}</li> }</ul></div> }
        @else { <div class="mensaje ok">El mes está completo.</div> }
      }
      @if (puedeCerrar && archivos().length) {
        <h3 class="sub">Archivo guardado de {{ mes }}</h3>
        <div class="tabla-caja" style="box-shadow:none;max-height:260px;overflow:auto"><table>
          <thead><tr><th>Archivo</th><th class="num">Tamaño</th><th></th></tr></thead>
          <tbody>@for (a of pagArchivos.items(); track a.ruta) {
            <tr><td>{{ a.ruta.split('/').slice(1).join(' / ') }}</td><td class="num">{{ (a.bytes / 1024) | miles }} KB</td>
              <td><button class="pequeno" (click)="bajar(a.ruta)">Descargar</button></td></tr>
          }</tbody></table>
          <app-paginador [total]="pagArchivos.total()" [pagina]="pagArchivos.pagina()" [porPagina]="pagArchivos.porPagina()" unidad="archivos" (cambio)="pagArchivos.ir($event)" /></div>
      }
    </div>
    <div class="tarjeta"><h2>Meses cerrados</h2>
      <div class="tabla-caja" style="box-shadow:none"><table class="tabla-movil">
        <thead><tr><th>Mes</th><th>Cerrado el</th><th>Por</th><th class="num">Viajes</th><th></th></tr></thead>
        <tbody>@for (c of pagCerrados.items(); track c.mes) {
          <tr><td data-etiqueta="Mes"><strong>{{ c.mes }}</strong></td><td data-etiqueta="Cerrado el">{{ c.fecha | fechaHora }}</td><td data-etiqueta="Por">{{ c.usuario?.nombre }}</td>
            <td data-etiqueta="Viajes" class="num">{{ c.resumen?.viajes }}</td>
            <td>@if (puedeCerrar) { <button class="pequeno" confirmar="Clic otra vez para reabrir" (confirmado)="reabrir(c.mes)">Reabrir</button> }</td></tr>
        } @empty { <tr><td colspan="5" class="vacio">Ningún mes cerrado</td></tr> }</tbody></table>
        <app-paginador [total]="pagCerrados.total()" [pagina]="pagCerrados.pagina()" [porPagina]="pagCerrados.porPagina()" unidad="meses" (cambio)="pagCerrados.ir($event)" /></div>
    </div>`,
  styles: [`.sub { font-size: 14px; margin: 16px 0 8px; } .pagina-cab .acciones { display: flex; gap: 8px; }
    .resumen-mes { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 14px 0; }
    .resumen-mes div { padding: 10px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); display: flex; flex-direction: column; }
    .resumen-mes span { font-size: 12.5px; color: var(--gris-5); } .resumen-mes strong { font-size: 20px; }`],
})
export class CierreMes {
  // Dentro de Contabilidad (pestaña) no repite el título de página
  readonly embebido = input(false);
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeCerrar = this.auth.tiene(P.CONFIG_GESTIONAR);
  mes = (() => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  readonly resumen = signal<any>(null);
  readonly cerrados = signal<any[]>([]);
  readonly trabajando = signal(false);
  readonly archivos = signal<any[]>([]);
  readonly pagArchivos = new PaginaLocal<any>(() => this.archivos());
  readonly pagCerrados = new PaginaLocal<any>(() => this.cerrados());
  private enVivo = inject(EnVivo).al(['gestion', 'viajes', 'liquidaciones'], () => this.revisar());
  constructor() { this.revisar(); }
  async revisar() {
    try { const r = await this.api.get<any>('/gestion/cierres', { mes: this.mes }); this.cerrados.set(r.cerrados); this.resumen.set(r.resumen); }
    catch (e) { this.avisos.error(e); }
    if (this.puedeCerrar) this.api.get<any[]>('/gestion/archivo', { mes: this.mes }).then(a => this.archivos.set(a)).catch(() => this.archivos.set([]));
  }
  async cerrar() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/gestion/cierres', { mes: this.mes });
      this.avisos.ok(`Mes ${this.mes} cerrado. Se guardaron ${r.archivos?.length || 0} archivo(s): copia de los datos, informes y manifiestos`);
      if (r.erroresArchivo?.length) this.avisos.mostrar(`${r.erroresArchivo.length} manifiesto(s) no se pudieron guardar en PDF`, 'error');
      this.revisar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async archivar() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/gestion/archivo/${this.mes}`, {});
      this.avisos.ok(`Guardados: ${r.manifiestos} PDF de manifiestos y ${r.informes} informe(s)`);
      if (r.errores?.length) this.avisos.mostrar(`No se pudieron guardar: ${r.errores.slice(0, 3).join('; ')}`, 'error');
      this.revisar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async bajar(ruta: string) { try { await this.api.descargar('/gestion/archivo/descargar', { ruta }, ruta.split('/').pop() || 'archivo'); } catch (e) { this.avisos.error(e); } }
  async descargarRespaldo() {
    this.trabajando.set(true);
    try { await this.api.descargar('/gestion/respaldo', {}, `respaldo-${hoyIso()}.json.gz`); this.avisos.ok('Respaldo descargado'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async reabrir(mes: string) {
    try { await this.api.post(`/gestion/cierres/${mes}/reabrir`, {}); this.avisos.ok(`Mes ${mes} reabierto`); this.revisar(); } catch (e) { this.avisos.error(e); }
  }
}
