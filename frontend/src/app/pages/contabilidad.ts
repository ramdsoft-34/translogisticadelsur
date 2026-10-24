import { Component, computed, inject, input, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { MenuAcciones } from '../shared/menu-acciones';
import { Modal } from '../shared/modal';
import { Moneda } from '../shared/moneda';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';
import { filtrar } from '../shared/filtro';

type Pestana = 'diario' | 'facturas' | 'pagos' | 'informes' | 'plan' | 'cierre';
const INFORMES: [string, string][] = [['balance', 'Balance general'], ['resultados', 'Estado de resultados'], ['cxc', 'Cuentas por cobrar'],
  ['cxp', 'Cuentas por pagar'], ['retenciones', 'Retenciones'], ['diario', 'Libro diario']];

// Contabilidad simplificada (apoyo administrativo; un contador debe revisarla).
// Los asientos de liquidaciones, préstamos y abonos se hacen solos; aquí se facturan, cobran y pagan y se registran gastos.
import { CierreMes } from './gestion-varios';
@Component({
  selector: 'app-contabilidad',
  imports: [FormsModule, Icono, MenuAcciones, Modal, Moneda, Confirmar, CierreMes, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Contabilidad</h1>
      <p class="sutil">Partida doble simplificada: facturas a clientes, cobros, pagos a conductores, gastos e informes. Información de apoyo; debe revisarla un contador.</p></div>
      @if (puedeGestionar) {
        <div class="acciones">
          <app-menu-acciones texto="Registrar">
            <button (click)="abrir('gasto')"><app-icono nombre="dinero" />Gasto<small>Un pago de la empresa con su soporte</small></button>
            <button (click)="abrir('manual')"><app-icono nombre="editar" />Asiento manual<small>Débitos y créditos escritos a mano</small></button>
          </app-menu-acciones>
          <button class="primario" (click)="abrir('factura')"><app-icono nombre="documento" />Facturar a un cliente</button>
        </div>
      }
    </div>

    <div class="pestanas">
      @for (t of pestanas; track t[0]) { <button [class.activa]="pestana() === t[0]" (click)="ir(t[0])">{{ t[1] }}</button> }
    </div>
    <section class="barra" aria-label="Periodo">
      <div class="campo"><label for="c-d">Desde</label><input id="c-d" type="date" [(ngModel)]="desde" (change)="cargar()" /></div>
      <div class="campo"><label for="c-h">Hasta</label><input id="c-h" type="date" [(ngModel)]="hasta" (change)="cargar()" /></div>
      <div class="campo crece"><label for="c-q">Buscar</label><input id="c-q" type="search" placeholder="Número, tercero, cuenta o concepto" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
    </section>

    @switch (pestana()) {
      @case ('diario') {
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Asiento</th><th>Fecha</th><th>Documento</th><th>Concepto</th><th>Cuenta</th><th class="num">Débito</th><th class="num">Crédito</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (a of asientosVisibles(); track a._id) {
            @for (l of a.lineas; track $index; let i = $index) {
              <tr [class.anulado]="a.estado === 'ANULADO'">
                <td data-etiqueta="Asiento">{{ i === 0 ? a.numero : '' }}</td><td data-etiqueta="Fecha">{{ i === 0 ? (a.fecha | dia) : '' }}</td>
                <td data-etiqueta="Documento">{{ i === 0 ? a.documento : '' }}</td><td data-etiqueta="Concepto">{{ i === 0 ? a.concepto : '' }}</td>
                <td data-etiqueta="Cuenta">{{ l.cuenta }} {{ l.nombre }}</td>
                <td data-etiqueta="Débito" class="num">{{ l.debito ? (l.debito | pesos) : '' }}</td><td data-etiqueta="Crédito" class="num">{{ l.credito ? (l.credito | pesos) : '' }}</td>
                <td data-etiqueta="Estado">@if (i === 0) { <span class="chip" [class.error]="a.estado === 'ANULADO'">{{ a.estado }}</span> }</td>
                <td>@if (i === 0 && puedeGestionar && a.estado === 'ACTIVO' && a.origen === 'MAN' || i === 0 && puedeGestionar && a.estado === 'ACTIVO' && a.origen === 'GAS') {
                  <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularAsiento(a)">Anular</button> }</td>
              </tr>
            }
          } @empty { <tr><td colspan="9" class="vacio">Sin asientos en el periodo</td></tr> }</tbody></table></div>
      }
      @case ('facturas') {
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th>Periodo</th><th class="num">Total</th><th class="num">Retenciones</th><th class="num">Neto</th><th class="num">Cobrado</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (f of facturasVisibles(); track f._id) {
            <tr><td data-etiqueta="Factura">{{ f.numero }}</td><td data-etiqueta="Fecha">{{ f.fecha | dia }}</td><td data-etiqueta="Cliente">{{ f.cliente?.nombre }}</td>
              <td data-etiqueta="Periodo">{{ f.desde | dia }} – {{ f.hasta | dia }} ({{ f.viajes }} viajes)</td><td data-etiqueta="Total" class="num">{{ f.total | pesos }}</td>
              <td data-etiqueta="Retenciones" class="num">{{ f.retefuente + f.ica | pesos }}</td><td data-etiqueta="Neto" class="num"><strong>{{ f.neto | pesos }}</strong></td>
              <td data-etiqueta="Cobrado" class="num">{{ f.cobrado | pesos }}</td>
              <td data-etiqueta="Estado"><span class="chip" [class.ok]="f.estado === 'COBRADA'" [class.alerta]="f.estado === 'PENDIENTE'" [class.error]="f.estado === 'ANULADA'">{{ f.estado }}</span></td>
              <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">@if (puedeGestionar && f.estado === 'PENDIENTE') {
                <button class="pequeno primario" (click)="abrir('cobro', { factura: f.numero, valor: f.neto - f.cobrado })">Registrar cobro</button>
                @if (!f.cobrado) { <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularFactura(f)">Anular</button> }
              }</div></td></tr>
          } @empty { <tr><td colspan="10" class="vacio">Sin facturas</td></tr> }</tbody></table></div>
      }
      @case ('pagos') {
        <p class="sutil">Liquidaciones de conductores pendientes de pago (cuentas por pagar). Se liquidan en «Pago a conductores».</p>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Liquidación</th><th>Fecha</th><th>Conductor</th><th>Placa</th><th class="num">Neto</th><th class="num">Pagado</th><th class="num">Saldo</th><th></th></tr></thead>
          <tbody>@for (l of informe()?.datos || []; track l.numero) {
            <tr><td data-etiqueta="Liquidación">{{ l.numero }}</td><td data-etiqueta="Fecha">{{ l.fecha | dia }}</td><td data-etiqueta="Conductor">{{ l.conductor }}</td><td data-etiqueta="Placa">{{ l.placa }}</td>
              <td data-etiqueta="Neto" class="num">{{ l.neto | pesos }}</td><td data-etiqueta="Pagado" class="num">{{ l.pagado | pesos }}</td><td data-etiqueta="Saldo" class="num"><strong>{{ l.saldo | pesos }}</strong></td>
              <td>@if (puedeGestionar) { <button class="pequeno primario" (click)="abrir('pago', { liquidacion: l.numero, valor: l.saldo })">Registrar pago</button> }</td></tr>
          } @empty { <tr><td colspan="8" class="vacio">No hay pagos pendientes a conductores</td></tr> }</tbody></table></div>
      }
      @case ('informes') {
        <div class="segmentos" style="margin-bottom:12px">
          @for (i of informes; track i[0]) { <button type="button" [class.activo]="tipoInforme() === i[0]" (click)="tipoInforme.set(i[0]); cargar()">{{ i[1] }}</button> }
        </div>
        @if (informe(); as inf) {
          <div class="cab-filtro"><h2>{{ inf.titulo }}</h2>
            <button class="pequeno" (click)="excelInforme()">Excel</button></div>
          <div class="tabla-caja"><table>
            <thead><tr>@for (c of inf.columnas; track c) { <th>{{ c }}</th> }</tr></thead>
            <tbody>@for (f of filasInforme(); track $index) {
              <tr [class.total]="!f[0] && !f[1]">@for (v of f; track $index) { <td [class.num]="esNumero(v)">{{ esNumero(v) ? (v | pesos) : (esFecha(v) ? (v | dia) : v) }}</td> }</tr>
            } @empty { <tr><td [attr.colspan]="inf.columnas.length" class="vacio">Sin datos</td></tr> }</tbody></table></div>
        }
      }
      @case ('plan') {
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Código</th><th>Cuenta</th><th>Tipo</th><th>Naturaleza</th></tr></thead>
          <tbody>@for (c of cuentasVisibles(); track c._id) {
            <tr><td data-etiqueta="Código">{{ c.codigo }}</td><td data-etiqueta="Cuenta">{{ c.nombre }}</td><td data-etiqueta="Tipo">{{ c.tipo }}</td><td data-etiqueta="Naturaleza">{{ c.naturaleza === 'D' ? 'Débito' : 'Crédito' }}</td></tr>
          }</tbody></table></div>
        @if (puedeGestionar) { <button style="margin-top:10px" (click)="abrir('cuenta')"><app-icono nombre="mas" />Agregar cuenta</button> }
      }
      @case ('cierre') { <app-cierre-mes [embebido]="true" /> }
    }

    <app-modal [titulo]="tituloForm()" [abierto]="!!form()" (cerrar)="form.set(null)">
      @if (form(); as fm) {
        <form id="form-cont" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="guardar()">
          @switch (fm.tipo) {
            @case ('factura') {
              <div class="campo"><label for="ff-c">Cliente</label><select id="ff-c" name="c" [(ngModel)]="fm.cliente" required><option value="">Seleccione…</option>
                @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
              <div class="campo"><label for="ff-d">Desde</label><input id="ff-d" type="date" name="d" [(ngModel)]="fm.desde" required /></div>
              <div class="campo"><label for="ff-h">Hasta</label><input id="ff-h" type="date" name="h" [(ngModel)]="fm.hasta" required /></div>
              <div class="campo"><label for="ff-r">% Retefuente</label><input id="ff-r" type="number" step="0.01" name="r" [(ngModel)]="fm.retefuentePct" /><small>1 = lo normal; aplica a todos los viajes.</small></div>
              <div class="campo"><label for="ff-i">% ReteICA (opcional)</label><input id="ff-i" type="number" step="0.001" name="i" [(ngModel)]="fm.icaPct" /></div>
              <p class="sutil">Suma la tarifa (y auxiliares) de los viajes del cliente en el rango. Sin IVA.</p>
            }
            @case ('cobro') {
              <div class="campo"><label for="fc-v">Valor cobrado ({{ fm.factura }})</label><div class="moneda"><input id="fc-v" moneda name="v" [(ngModel)]="fm.valor" required /></div></div>
              <div class="campo"><label for="fc-f">Fecha</label><input id="fc-f" type="date" name="f" [(ngModel)]="fm.fecha" /></div>
              <div class="campo"><label for="fc-k">Recibe en</label><select id="fc-k" name="k" [(ngModel)]="fm.cuenta"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option></select></div>
            }
            @case ('pago') {
              <div class="campo"><label for="fp-v">Valor pagado ({{ fm.liquidacion }})</label><div class="moneda"><input id="fp-v" moneda name="v" [(ngModel)]="fm.valor" required /></div></div>
              <div class="campo"><label for="fp-f">Fecha</label><input id="fp-f" type="date" name="f" [(ngModel)]="fm.fecha" /></div>
              <div class="campo"><label for="fp-k">Paga desde</label><select id="fp-k" name="k" [(ngModel)]="fm.cuenta"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option></select></div>
            }
            @case ('gasto') {
              <div class="campo"><label for="fg-f">Fecha</label><input id="fg-f" type="date" name="f" [(ngModel)]="fm.fecha" required /></div>
              <div class="campo"><label for="fg-c">Cuenta del gasto</label><select id="fg-c" name="c" [(ngModel)]="fm.cuenta" required>
                @for (c of cuentasGasto(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
              <div class="campo"><label for="fg-x">Concepto</label><input id="fg-x" name="x" [(ngModel)]="fm.concepto" required /></div>
              <div class="campo"><label for="fg-v">Valor</label><div class="moneda"><input id="fg-v" moneda name="v" [(ngModel)]="fm.valor" required /></div></div>
              <div class="campo"><label for="fg-t">Proveedor / tercero</label><input id="fg-t" name="t" [(ngModel)]="fm.tercero" /></div>
              <div class="campo"><label for="fg-p">Pagado con</label><select id="fg-p" name="p" [(ngModel)]="fm.formaPago"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option><option value="2335">2335 Por pagar</option></select></div>
            }
            @case ('manual') {
              <div class="campo"><label for="fm-f">Fecha</label><input id="fm-f" type="date" name="f" [(ngModel)]="fm.fecha" required /></div>
              <div class="campo"><label for="fm-d">Cuenta que se debita</label><select id="fm-d" name="d" [(ngModel)]="fm.debito" required>@for (c of cuentas(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
              <div class="campo"><label for="fm-c">Cuenta que se acredita</label><select id="fm-c" name="c" [(ngModel)]="fm.credito" required>@for (c of cuentas(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
              <div class="campo"><label for="fm-v">Valor</label><div class="moneda"><input id="fm-v" moneda name="v" [(ngModel)]="fm.valor" required /></div></div>
              <div class="campo"><label for="fm-x">Concepto</label><input id="fm-x" name="x" [(ngModel)]="fm.concepto" required /></div>
              <div class="campo"><label for="fm-cc">Centro de costo (opcional)</label><input id="fm-cc" name="cc" [(ngModel)]="fm.centroCosto" /></div>
            }
            @case ('cuenta') {
              <div class="campo"><label for="fk-c">Código</label><input id="fk-c" name="c" [(ngModel)]="fm.codigo" required pattern="[0-9]{4,10}" /></div>
              <div class="campo"><label for="fk-n">Nombre</label><input id="fk-n" name="n" [(ngModel)]="fm.nombre" required /></div>
              <div class="campo"><label for="fk-t">Tipo</label><select id="fk-t" name="t" [(ngModel)]="fm.tipoCuenta">@for (t of ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO']; track t) { <option [value]="t">{{ t }}</option> }</select></div>
              <div class="campo"><label for="fk-z">Naturaleza</label><select id="fk-z" name="z" [(ngModel)]="fm.naturaleza"><option value="D">Débito</option><option value="C">Crédito</option></select></div>
            }
          }
        </form>
      }
      <ng-container pie><button type="button" (click)="form.set(null)">Cancelar</button><button class="primario" type="submit" form="form-cont" [disabled]="trabajando()">Guardar</button></ng-container>
    </app-modal>`,
  styles: [`
    tr.anulado td { color: var(--gris-5); text-decoration: line-through; }
    tr.total td { font-weight: 700; background: var(--gris-1); }
  `],
})
export class Contabilidad {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeGestionar = this.auth.tiene(P.LIQUIDACION_GESTIONAR);
  readonly pestanas: [Pestana, string][] = [['diario', 'Libro diario'], ['facturas', 'Facturas y cobros'], ['pagos', 'Cuentas por pagar'], ['informes', 'Informes'], ['plan', 'Plan de cuentas'], ['cierre', 'Cierre de mes']];
  readonly informes = INFORMES;
  readonly pestana = signal<Pestana>('diario');
  readonly trabajando = signal(false);
  desde = inicioMesIso(); hasta = hoyIso();
  readonly q = signal('');
  readonly asientos = signal<any[]>([]);
  readonly facturas = signal<any[]>([]);
  readonly cuentas = signal<any[]>([]);
  readonly clientes = signal<any[]>([]);
  readonly informe = signal<any>(null);
  readonly tipoInforme = signal('balance');
  readonly form = signal<any>(null);
  readonly asientosVisibles = computed(() => filtrar<any>(this.asientos(), this.q()));
  readonly facturasVisibles = computed(() => filtrar<any>(this.facturas(), this.q()));
  readonly cuentasVisibles = computed(() => filtrar<any>(this.cuentas(), this.q()));
  readonly cuentasGasto = computed(() => this.cuentas().filter(c => /^5/.test(c.codigo)));
  readonly filasInforme = computed(() => filtrar<any>(this.informe()?.filas || [], this.q()));

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['gestion', 'liquidaciones'], () => this.cargar());

  // Pestaña inicial desde la ruta (p. ej. /cierre-mes abre «Cierre de mes»)
  readonly tab = input<Pestana | ''>('');
  ngOnInit() { if (this.tab()) this.pestana.set(this.tab() as Pestana); this.cargar(); }

  constructor() {
    this.api.get<any[]>('/gestion/contabilidad/cuentas').then(c => this.cuentas.set(c)).catch(() => {});
    this.api.get<any[]>('/maestros/clientes').then(c => this.clientes.set(c)).catch(() => {});
  }
  ir(p: Pestana) { this.pestana.set(p); this.cargar(); }
  async cargar() {
    const per = { desde: this.desde, hasta: this.hasta };
    try {
      if (this.pestana() === 'diario') this.asientos.set(await this.api.get('/gestion/contabilidad/asientos', per));
      if (this.pestana() === 'facturas') this.facturas.set(await this.api.get('/gestion/contabilidad/facturas'));
      if (this.pestana() === 'pagos') this.informe.set(await this.api.get('/gestion/contabilidad/informes/cxp'));
      if (this.pestana() === 'informes') this.informe.set(await this.api.get(`/gestion/contabilidad/informes/${this.tipoInforme()}`, per));
      if (this.pestana() === 'plan') this.cuentas.set(await this.api.get('/gestion/contabilidad/cuentas'));
    } catch (e) { this.avisos.error(e); }
  }
  esNumero(v: unknown) { return typeof v === 'number'; }
  esFecha(v: unknown) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v); }
  async excelInforme() {
    try { await this.api.descargar(`/gestion/contabilidad/informes/${this.tipoInforme()}`, { desde: this.desde, hasta: this.hasta, formato: 'xlsx' }, `${this.tipoInforme()}.xlsx`); }
    catch (e) { this.avisos.error(e); }
  }
  tituloForm() {
    return ({ factura: 'Facturar a un cliente', cobro: 'Registrar cobro', pago: 'Registrar pago al conductor', gasto: 'Registrar gasto', manual: 'Asiento manual', cuenta: 'Agregar cuenta' } as Record<string, string>)[this.form()?.tipo] || '';
  }
  abrir(tipo: string, extra: any = {}) {
    this.form.set({ tipo, fecha: hoyIso(), desde: this.desde, hasta: this.hasta, retefuentePct: 1, icaPct: 0, cuenta: tipo === 'gasto' ? '5195' : '1110',
      formaPago: '1110', debito: '', credito: '', valor: null, concepto: '', tercero: '', centroCosto: '', cliente: '', tipoCuenta: 'GASTO', naturaleza: 'D', ...extra });
  }
  async guardar() {
    const f = this.form();
    const rutas: Record<string, [string, any]> = {
      factura: ['/gestion/contabilidad/facturas', { cliente: f.cliente, desde: f.desde, hasta: f.hasta, retefuentePct: f.retefuentePct, icaPct: f.icaPct }],
      cobro: ['/gestion/contabilidad/cobros', { factura: f.factura, valor: f.valor, fecha: f.fecha, cuenta: f.cuenta }],
      pago: ['/gestion/contabilidad/pagos', { liquidacion: f.liquidacion, valor: f.valor, fecha: f.fecha, cuenta: f.cuenta }],
      gasto: ['/gestion/contabilidad/gastos', { fecha: f.fecha, cuenta: f.cuenta, concepto: f.concepto, valor: f.valor, tercero: f.tercero, formaPago: f.formaPago }],
      manual: ['/gestion/contabilidad/asientos', { fecha: f.fecha, debito: f.debito, credito: f.credito, valor: f.valor, concepto: f.concepto, centroCosto: f.centroCosto }],
      cuenta: ['/gestion/contabilidad/cuentas', { codigo: f.codigo, nombre: f.nombre, tipo: f.tipoCuenta, naturaleza: f.naturaleza }],
    };
    const [ruta, cuerpo] = rutas[f.tipo];
    this.trabajando.set(true);
    try {
      await this.api.post(ruta, cuerpo);
      this.avisos.ok('Registrado'); this.form.set(null);
      if (f.tipo === 'cuenta') this.cuentas.set(await this.api.get('/gestion/contabilidad/cuentas'));
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularAsiento(a: any) { try { await this.api.post(`/gestion/contabilidad/asientos/${a.numero}/anular`, {}); this.avisos.ok(`Asiento ${a.numero} anulado`); this.cargar(); } catch (e) { this.avisos.error(e); } }
  async anularFactura(f: any) { try { await this.api.post(`/gestion/contabilidad/facturas/${f.numero}/anular`, {}); this.avisos.ok(`Factura ${f.numero} anulada`); this.cargar(); } catch (e) { this.avisos.error(e); } }
}
