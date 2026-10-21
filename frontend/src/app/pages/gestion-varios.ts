import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { filtrar } from '../shared/filtro';

// ── Viajes por empresa: consulta e impresión ordenada por placa y fecha ──
@Component({
  selector: 'app-viajes-empresa',
  imports: [FormsModule, Icono, VisorPdf, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Viajes por empresa</h1>
      <p class="sutil">Los viajes de cada empresa (cliente) ordenados por placa y fecha, con totales, para revisar, imprimir o enviar.</p></div></div>
    <app-visor-pdf #visor />
    <section class="barra" aria-label="Filtros">
      <div class="campo"><label for="ve-c">Empresa</label><select id="ve-c" [(ngModel)]="f.cliente" (change)="cargar()"><option value="">Todas</option>
        @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
      <div class="campo"><label for="ve-d">Desde</label><input id="ve-d" type="date" [(ngModel)]="f.desde" (change)="cargar()" /></div>
      <div class="campo"><label for="ve-h">Hasta</label><input id="ve-h" type="date" [(ngModel)]="f.hasta" (change)="cargar()" /></div>
      <div class="campo crece"><label for="ve-q">Buscar</label><input id="ve-q" type="search" placeholder="Placa, conductor, destino o manifiesto" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
      <button (click)="visor.ver('/gestion/relaciones/viajes-empresa', 'Viajes por empresa', { ...f, formato: 'pdf', ver: 1 })"><app-icono nombre="ojo" />Ver PDF</button>
      <button (click)="excel()">Excel</button>
    </section>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>N°</th><th>Fecha</th><th>Empresa</th><th>Placa</th><th>Conductor</th><th>Destino</th><th>Manifiesto</th><th class="num">Tarifa</th><th class="num">Flete</th><th class="num">Anticipo</th></tr></thead>
      <tbody>@for (x of visibles(); track x.numero) {
        <tr><td data-etiqueta="N°">{{ x.numero }}</td><td data-etiqueta="Fecha">{{ x.fecha | dia }}</td><td data-etiqueta="Empresa">{{ x.cliente }}</td><td data-etiqueta="Placa"><strong>{{ x.placa }}</strong></td>
          <td data-etiqueta="Conductor">{{ x.conductor }}</td><td data-etiqueta="Destino">{{ x.destino }}</td><td data-etiqueta="Manifiesto">{{ x.manifiesto }}</td>
          <td data-etiqueta="Tarifa" class="num">{{ x.tarifa | pesos }}</td><td data-etiqueta="Flete" class="num">{{ x.flete | pesos }}</td><td data-etiqueta="Anticipo" class="num">{{ x.anticipo | pesos }}</td></tr>
      } @empty { <tr><td colspan="10" class="vacio">Sin viajes en el periodo</td></tr> }</tbody>
      @if (datos()?.totales; as t) { <tfoot><tr><td colspan="7">{{ visibles().length }} viaje(s)</td><td class="num">{{ t.tarifa | pesos }}</td><td class="num">{{ t.flete | pesos }}</td><td class="num">{{ t.anticipo | pesos }}</td></tr></tfoot> }
    </table></div>`,
})
export class ViajesEmpresa {
  private api = inject(Api);
  private avisos = inject(Avisos);
  f = { cliente: '', desde: inicioMesIso(), hasta: hoyIso() };
  readonly clientes = signal<any[]>([]);
  readonly datos = signal<any>(null);
  readonly q = signal('');
  readonly visibles = computed(() => filtrar<any>(this.datos()?.filas || [], this.q()));
  constructor() { this.api.get<any[]>('/maestros/clientes').then(c => this.clientes.set(c)).catch(() => {}); this.cargar(); }
  async cargar() { try { this.datos.set(await this.api.get('/gestion/relaciones/viajes-empresa', this.f)); } catch (e) { this.avisos.error(e); } }
  async excel() { try { await this.api.descargar('/gestion/relaciones/viajes-empresa', { ...this.f, formato: 'xlsx' }, 'viajes_empresa.xlsx'); } catch (e) { this.avisos.error(e); } }
}

// ── Cierre de mes ──
@Component({
  selector: 'app-cierre-mes',
  imports: [FormsModule, Icono, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Cierre de mes</h1>
      <p class="sutil">Al cerrar un mes ya no se pueden registrar, modificar ni anular viajes, liquidaciones, préstamos ni asientos con fecha de ese mes.
        Los datos se conservan. Solo el administrador cierra y reabre meses.</p></div></div>
    <div class="tarjeta">
      <div class="filtros" style="margin:0">
        <div class="campo"><label for="cm-m">Mes</label><input id="cm-m" type="month" [(ngModel)]="mes" (change)="revisar()" /></div>
        <button (click)="revisar()">Revisar el mes</button>
        @if (puedeCerrar && resumen()) { <button class="primario" confirmar="Clic otra vez para cerrar el mes" (confirmado)="cerrar()" [disabled]="trabajando()"><app-icono nombre="candado" />Cerrar {{ mes }}</button> }
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
    </div>
    <div class="tarjeta"><h2>Meses cerrados</h2>
      <div class="tabla-caja" style="box-shadow:none"><table class="tabla-movil">
        <thead><tr><th>Mes</th><th>Cerrado el</th><th>Por</th><th class="num">Viajes</th><th></th></tr></thead>
        <tbody>@for (c of cerrados(); track c.mes) {
          <tr><td data-etiqueta="Mes"><strong>{{ c.mes }}</strong></td><td data-etiqueta="Cerrado el">{{ c.fecha | fechaHora }}</td><td data-etiqueta="Por">{{ c.usuario?.nombre }}</td>
            <td data-etiqueta="Viajes" class="num">{{ c.resumen?.viajes }}</td>
            <td>@if (puedeCerrar) { <button class="pequeno" confirmar="Clic otra vez para reabrir" (confirmado)="reabrir(c.mes)">Reabrir</button> }</td></tr>
        } @empty { <tr><td colspan="5" class="vacio">Ningún mes cerrado</td></tr> }</tbody></table></div>
    </div>`,
  styles: [`.resumen-mes { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 14px 0; }
    .resumen-mes div { padding: 10px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); display: flex; flex-direction: column; }
    .resumen-mes span { font-size: 12.5px; color: var(--gris-5); } .resumen-mes strong { font-size: 20px; }`],
})
export class CierreMes {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeCerrar = this.auth.tiene(P.CONFIG_GESTIONAR);
  mes = (() => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  readonly resumen = signal<any>(null);
  readonly cerrados = signal<any[]>([]);
  readonly trabajando = signal(false);
  constructor() { this.revisar(); }
  async revisar() {
    try { const r = await this.api.get<any>('/gestion/cierres', { mes: this.mes }); this.cerrados.set(r.cerrados); this.resumen.set(r.resumen); }
    catch (e) { this.avisos.error(e); }
  }
  async cerrar() {
    this.trabajando.set(true);
    try { await this.api.post('/gestion/cierres', { mes: this.mes }); this.avisos.ok(`Mes ${this.mes} cerrado`); this.revisar(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async reabrir(mes: string) {
    try { await this.api.post(`/gestion/cierres/${mes}/reabrir`, {}); this.avisos.ok(`Mes ${mes} reabierto`); this.revisar(); } catch (e) { this.avisos.error(e); }
  }
}

// ── Remesas Dulces & Dulces ──
@Component({
  selector: 'app-remesas-dulces',
  imports: [FormsModule, Icono, VisorPdf, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Remesas Dulces & Dulces</h1>
      <p class="sutil">Cargue la base de viajes (Excel con las columnas VPL, FECHA, ZONA, PESO, MANIFIESTO, CONDUCTOR, PLACA, REMESA y COSTO),
        elija los VPL e imprima las remesas, dos por hoja. Las cédulas que falten se toman del registro de conductores.</p></div>
      <div class="acciones">
        <label class="boton"><app-icono nombre="descargar" />Cargar base de Excel<input type="file" accept=".xlsx,.xlsm,.xls" hidden (change)="importar($event)" /></label>
      </div>
    </div>
    <app-visor-pdf #visor />
    <section class="barra" aria-label="Filtros">
      <label class="casilla"><input type="checkbox" [(ngModel)]="soloPendientes" (change)="cargar()" />Solo sin imprimir</label>
      <div class="campo crece"><label for="rd-q">Buscar</label><input id="rd-q" type="search" placeholder="VPL, zona, conductor, placa o remesa" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
      <button class="primario" [disabled]="!sel().size" (click)="imprimir()"><app-icono nombre="ojo" />Ver remesas ({{ sel().size }})</button>
    </section>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th><input type="checkbox" aria-label="Seleccionar todas" [checked]="todas()" (change)="alternarTodas()" /></th>
        <th>VPL</th><th>Fecha</th><th>Zona</th><th class="num">Peso</th><th>Manifiesto</th><th>Conductor</th><th>Cédula</th><th>Placa</th><th>Remesa</th><th class="num">Costo</th><th>Impresa</th></tr></thead>
      <tbody>@for (x of visibles(); track x._id) {
        <tr><td data-etiqueta="Elegir"><input type="checkbox" [checked]="sel().has(x.vpl)" (change)="alternar(x.vpl)" [attr.aria-label]="'VPL ' + x.vpl" /></td>
          <td data-etiqueta="VPL"><strong>{{ x.vpl }}</strong></td><td data-etiqueta="Fecha">{{ x.fecha | dia }}</td><td data-etiqueta="Zona">{{ x.zona }}</td>
          <td data-etiqueta="Peso" class="num">{{ x.peso }}</td><td data-etiqueta="Manifiesto">{{ x.manifiesto }}</td><td data-etiqueta="Conductor">{{ x.conductor }}</td>
          <td data-etiqueta="Cédula">{{ x.cedula }}</td><td data-etiqueta="Placa">{{ x.placa }}</td><td data-etiqueta="Remesa">{{ x.remesa }}</td>
          <td data-etiqueta="Costo" class="num">{{ x.costo | pesos }}</td><td data-etiqueta="Impresa">{{ x.impreso ? (x.impreso | dia) : '—' }}</td></tr>
      } @empty { <tr><td colspan="12" class="vacio">Sin remesas. Cargue la base de Excel.</td></tr> }</tbody></table></div>`,
})
export class RemesasDulces {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly visor = viewChild.required(VisorPdf);
  soloPendientes = true;
  readonly lista = signal<any[]>([]);
  readonly q = signal('');
  readonly sel = signal(new Set<string>());
  readonly visibles = computed(() => filtrar<any>(this.lista(), this.q()));
  readonly todas = computed(() => this.visibles().length > 0 && this.visibles().every(x => this.sel().has(x.vpl)));
  constructor() { this.cargar(); }
  async cargar() { try { this.lista.set(await this.api.get('/gestion/remesas-dulces', this.soloPendientes ? { pendientes: 1 } : {})); this.sel.set(new Set()); } catch (e) { this.avisos.error(e); } }
  alternar(v: string) { const s = new Set(this.sel()); if (s.has(v)) s.delete(v); else s.add(v); this.sel.set(s); }
  alternarTodas() { this.sel.set(this.todas() ? new Set() : new Set(this.visibles().map(x => x.vpl))); }
  async importar(ev: Event) {
    const input = ev.target as HTMLInputElement; const archivo = input.files?.[0];
    if (!archivo) return;
    try { const r = await this.api.subir<any>('/gestion/remesas-dulces/importar', archivo); this.avisos.ok(`${r.leidos} fila(s): ${r.nuevos} nueva(s), ${r.actualizados} actualizada(s)`); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { input.value = ''; }
  }
  async imprimir() {
    await this.visor().ver('/gestion/remesas-dulces/pdf', 'Remesas Dulces & Dulces', undefined, { vpls: [...this.sel()] });
    this.cargar();
  }
}
