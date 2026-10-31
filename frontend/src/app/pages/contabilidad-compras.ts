// Contabilidad fase 2: proveedores con datos fiscales, compras (causación) con retenciones y XML de la DIAN,
// comprobantes de egreso (PDF, correo, WhatsApp), conciliación bancaria y tabla de retenciones.
// Se muestran como pestañas dentro de Contabilidad.
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Moneda } from '../shared/moneda';
import { FORMATOS, hoyIso } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';
import { filtrar } from '../shared/filtro';
import { VisorPdf } from '../shared/visor-pdf';

const CONCEPTOS: [string, string][] = [['servicios', 'Servicios generales'], ['compras', 'Compras generales'], ['transporte_carga', 'Transporte de carga'],
  ['honorarios_pj', 'Honorarios (persona jurídica)'], ['honorarios_pn', 'Honorarios (persona natural)'], ['arrendamiento_inmuebles', 'Arrendamiento de inmuebles'],
  ['arrendamiento_muebles', 'Arrendamiento de muebles'], ['combustibles', 'Combustibles'], ['ninguna', 'Sin retención']];
const TIPOS_DOC: [string, string][] = [['factura', 'Factura electrónica'], ['documento_soporte', 'Documento soporte (no obligado a facturar)'], ['cuenta_cobro', 'Cuenta de cobro'], ['otro', 'Otro soporte']];
const vacioSiNulo = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

// ═════════════ Proveedores ═════════════
@Component({
  selector: 'app-cont-proveedores',
  imports: [FormsModule, Icono, Modal],
  template: `
    <div class="cab-filtro"><p class="sutil">Proveedores con sus datos fiscales: deciden las retenciones al causar sus facturas.</p>
      @if (puedeGestionar) { <button class="primario" (click)="abrir()"><app-icono nombre="mas" />Nuevo proveedor</button> }</div>
    <div class="campo" style="max-width:360px;margin-bottom:10px"><input type="search" placeholder="Buscar por NIT o nombre" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Buscar proveedor" /></div>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>NIT / cédula</th><th>Proveedor</th><th>Régimen</th><th>Retención habitual</th><th>Cuenta</th><th>Contacto</th><th></th></tr></thead>
      <tbody>@for (p of visibles(); track p._id) {
        <tr><td data-etiqueta="NIT">{{ p.nit }}{{ p.dv ? '-' + p.dv : '' }}</td><td data-etiqueta="Proveedor">{{ p.nombre }}</td>
          <td data-etiqueta="Régimen">{{ p.fiscal?.regimen }}@if (p.fiscal?.autorretenedor) { <span class="chip">Autorretenedor</span> }@if (p.fiscal?.granContribuyente) { <span class="chip">Gran contribuyente</span> }@if (p.fiscal?.declarante === false) { <span class="chip alerta">No declarante</span> }</td>
          <td data-etiqueta="Retención">{{ nombreConcepto(p.conceptoRetencion) }}</td><td data-etiqueta="Cuenta">{{ p.cuentaGasto }}</td>
          <td data-etiqueta="Contacto">{{ p.correo }} {{ p.whatsapp || p.telefono }}</td>
          <td>@if (puedeGestionar) { <button class="pequeno" (click)="abrir(p)"><app-icono nombre="editar" [tam]="14" />Editar</button> }</td></tr>
      } @empty { <tr><td colspan="7" class="vacio">Sin proveedores. También se crean solos al cargar el XML de una factura.</td></tr> }</tbody></table></div>

    <app-modal [titulo]="form()?._id ? 'Editar proveedor' : 'Nuevo proveedor'" [abierto]="!!form()" (cerrar)="form.set(null)">
      @if (form(); as f) {
        <form id="form-prov" class="formulario" (ngSubmit)="guardar()">
          <div class="campo"><label for="pv-t">Tipo</label><select id="pv-t" name="t" [(ngModel)]="f.tipoId"><option value="N">NIT</option><option value="C">Cédula</option><option value="E">Cédula de extranjería</option><option value="P">Pasaporte</option></select></div>
          <div class="campo"><label for="pv-n">Número</label><input id="pv-n" name="n" [(ngModel)]="f.nit" required inputmode="numeric" /></div>
          <div class="campo"><label for="pv-dv">DV</label><input id="pv-dv" name="dv" [(ngModel)]="f.dv" maxlength="1" /></div>
          <div class="campo"><label for="pv-r">Nombre o razón social</label><input id="pv-r" name="r" [(ngModel)]="f.nombre" required /></div>
          <div class="campo"><label for="pv-c">Correo</label><input id="pv-c" name="c" type="email" [(ngModel)]="f.correo" /></div>
          <div class="campo"><label for="pv-w">WhatsApp</label><input id="pv-w" name="w" [(ngModel)]="f.whatsapp" inputmode="tel" /></div>
          <div class="campo"><label for="pv-tel">Teléfono</label><input id="pv-tel" name="tel" [(ngModel)]="f.telefono" /></div>
          <div class="campo"><label for="pv-ci">Ciudad</label><input id="pv-ci" name="ci" [(ngModel)]="f.ciudad" /></div>
          <div class="campo"><label for="pv-reg">Régimen</label><select id="pv-reg" name="reg" [(ngModel)]="f.fiscal.regimen">
            <option value="ordinario">Ordinario</option><option value="simple">Régimen simple (RST)</option><option value="no_responsable_iva">No responsable de IVA</option><option value="especial">Régimen especial</option></select></div>
          <div class="campo"><label for="pv-ica">ReteICA (por mil)</label><input id="pv-ica" name="ica" type="number" step="0.01" [(ngModel)]="f.fiscal.reteIcaPorMil" /></div>
          <div class="campo"><label for="pv-k">Retención habitual</label><select id="pv-k" name="k" [(ngModel)]="f.conceptoRetencion">@for (c of conceptos; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
          <div class="campo"><label for="pv-cta">Cuenta habitual del gasto</label><select id="pv-cta" name="cta" [(ngModel)]="f.cuentaGasto">@for (c of cuentasCompra(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
          <div class="campo"><label class="casilla"><input type="checkbox" name="d" [(ngModel)]="f.fiscal.declarante" />Declara renta</label>
            <label class="casilla"><input type="checkbox" name="iv" [(ngModel)]="f.fiscal.responsableIva" />Responsable de IVA</label>
            <label class="casilla"><input type="checkbox" name="au" [(ngModel)]="f.fiscal.autorretenedor" />Autorretenedor (no se le retiene)</label>
            <label class="casilla"><input type="checkbox" name="gc" [(ngModel)]="f.fiscal.granContribuyente" />Gran contribuyente</label></div>
          <div class="campo"><label for="pv-b">Banco</label><input id="pv-b" name="b" [(ngModel)]="f.banco.entidad" /></div>
          <div class="campo"><label for="pv-bt">Tipo de cuenta</label><select id="pv-bt" name="bt" [(ngModel)]="f.banco.tipoCuenta"><option value="">—</option><option value="ahorros">Ahorros</option><option value="corriente">Corriente</option></select></div>
          <div class="campo"><label for="pv-bc">Número de cuenta</label><input id="pv-bc" name="bc" [(ngModel)]="f.banco.cuenta" /></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="form.set(null)">Cancelar</button><button class="primario" type="submit" form="form-prov" [disabled]="trabajando()">Guardar</button></ng-container>
    </app-modal>`,
})
export class ProveedoresCont {
  private api = inject(Api); private avisos = inject(Avisos);
  readonly puedeGestionar = inject(Auth).tiene(P.CONTABILIDAD_GESTIONAR);
  readonly conceptos = CONCEPTOS;
  readonly lista = signal<any[]>([]);
  readonly cuentas = signal<any[]>([]);
  readonly q = signal('');
  readonly form = signal<any>(null);
  readonly trabajando = signal(false);
  readonly visibles = computed(() => filtrar<any>(this.lista(), this.q()));
  readonly cuentasCompra = computed(() => this.cuentas().filter(c => /^(1330|14|1[5-9]|[5-7])/.test(c.codigo)));
  constructor() { this.cargar(); this.api.get<any[]>('/gestion/contabilidad/cuentas').then(c => this.cuentas.set(c)).catch(() => {}); }
  async cargar() { try { this.lista.set(await this.api.get('/gestion/contabilidad/proveedores')); } catch (e) { this.avisos.error(e); } }
  nombreConcepto(k: string) { return CONCEPTOS.find(c => c[0] === k)?.[1] || k; }
  abrir(p: any = null) {
    const base = { tipoId: 'N', nit: '', dv: '', nombre: '', correo: '', telefono: '', whatsapp: '', direccion: '', ciudad: '', conceptoRetencion: 'servicios', cuentaGasto: '5195',
      fiscal: { regimen: 'ordinario', responsableIva: true, declarante: true, autorretenedor: false, granContribuyente: false, ciiu: '', reteIcaPorMil: 0 },
      banco: { entidad: '', tipoCuenta: '', cuenta: '' }, activo: true };
    this.form.set(p ? { ...base, ...structuredClone(p), fiscal: { ...base.fiscal, ...p.fiscal }, banco: { ...base.banco, ...p.banco } } : base);
  }
  async guardar() {
    const f = this.form(); this.trabajando.set(true);
    const { _id, empresa, createdAt, updatedAt, __v, ...cuerpo } = f;
    try {
      if (_id) await this.api.put(`/gestion/contabilidad/proveedores/${_id}`, cuerpo); else await this.api.post('/gestion/contabilidad/proveedores', cuerpo);
      this.avisos.ok('Proveedor guardado'); this.form.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}

// ═════════════ Compras (causación) y comprobantes de egreso ═════════════
@Component({
  selector: 'app-cont-compras',
  imports: [FormsModule, Icono, Modal, Moneda, Confirmar, VisorPdf, ...FORMATOS],
  template: `
    <app-visor-pdf #visor />
    <div class="cab-filtro">
      @if (vista() === 'compras') {
        <p class="sutil">Facturas de proveedores causadas con sus retenciones. Cargue el XML de la factura electrónica y se llenan solos los datos.</p>
        <div class="acciones">
          <select [ngModel]="estado()" (ngModelChange)="estado.set($event)" aria-label="Estado"><option value="">Todas</option><option value="PENDIENTE">Pendientes de pago</option><option value="PAGADA">Pagadas</option><option value="ANULADA">Anuladas</option></select>
          @if (puedeGestionar) { <button class="primario" (click)="abrirCompra()"><app-icono nombre="documento" />Causar compra</button> }
        </div>
      } @else {
        <p class="sutil">Comprobantes de egreso: pagos a proveedores y otros pagos, con PDF para firmar, correo y WhatsApp.</p>
        @if (puedeGestionar) { <button class="primario" (click)="abrirEgreso()"><app-icono nombre="dinero" />Nuevo comprobante de egreso</button> }
      }
    </div>
    <div class="campo" style="max-width:360px;margin-bottom:10px"><input type="search" placeholder="Buscar" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Buscar" /></div>

    @if (vista() === 'compras') {
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>Compra</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th class="num">Total</th><th class="num">Retenciones</th><th class="num">Neto</th><th class="num">Pagado</th><th>Estado</th><th></th></tr></thead>
        <tbody>@for (c of comprasVisibles(); track c._id) {
          <tr><td data-etiqueta="Compra">{{ c.numero }}</td><td data-etiqueta="Fecha">{{ c.fecha | dia }}@if (c.vence) { <small class="sutil" style="display:block">vence {{ c.vence | dia }}</small> }</td>
            <td data-etiqueta="Proveedor">{{ c.proveedorNombre }}<small class="sutil" style="display:block">{{ c.proveedorNit }}</small></td>
            <td data-etiqueta="Factura">{{ c.documento }}@if (c.cufe) { <span class="chip ok" title="Con XML de la DIAN">DIAN</span> }</td>
            <td data-etiqueta="Total" class="num">{{ c.total | pesos }}</td><td data-etiqueta="Retenciones" class="num">{{ c.retefuente + c.reteIva + c.reteIca | pesos }}</td>
            <td data-etiqueta="Neto" class="num"><strong>{{ c.neto | pesos }}</strong></td><td data-etiqueta="Pagado" class="num">{{ c.pagado | pesos }}</td>
            <td data-etiqueta="Estado"><span class="chip" [class.ok]="c.estado === 'PAGADA'" [class.alerta]="c.estado === 'PENDIENTE'" [class.error]="c.estado === 'ANULADA'">{{ c.estado }}</span></td>
            <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
              @if (c.cufe) { <button class="pequeno" (click)="descargarXml(c)"><app-icono nombre="descargar" [tam]="14" />XML</button> }
              @if (puedeGestionar && c.estado === 'PENDIENTE') {
                <button class="pequeno primario" (click)="abrirEgreso(c)">Pagar</button>
                @if (!c.pagado) { <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularCompra(c)">Anular</button> }
              }</div></td></tr>
        } @empty { <tr><td colspan="10" class="vacio">Sin compras causadas</td></tr> }</tbody></table></div>
    } @else {
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>Egreso</th><th>Fecha</th><th>Pagado a</th><th>Detalle</th><th>Medio</th><th class="num">Total</th><th class="num">4x1000</th><th>Estado</th><th></th></tr></thead>
        <tbody>@for (e of egresosVisibles(); track e._id) {
          <tr [class.anulado]="e.estado === 'ANULADO'"><td data-etiqueta="Egreso">{{ e.numero }}</td><td data-etiqueta="Fecha">{{ e.fecha | dia }}</td>
            <td data-etiqueta="Pagado a">{{ e.beneficiario }}<small class="sutil" style="display:block">{{ e.beneficiarioDoc }}</small></td>
            <td data-etiqueta="Detalle">{{ detalleEgreso(e) }}</td><td data-etiqueta="Medio">{{ e.cuenta === '1105' ? 'Caja' : e.medio }}{{ e.referencia ? ' · ' + e.referencia : '' }}</td>
            <td data-etiqueta="Total" class="num"><strong>{{ e.total | pesos }}</strong></td><td data-etiqueta="4x1000" class="num">{{ e.gmf ? (e.gmf | pesos) : '' }}</td>
            <td data-etiqueta="Estado"><span class="chip" [class.error]="e.estado === 'ANULADO'">{{ e.estado }}</span></td>
            <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
              <button class="pequeno primario" (click)="visor.ver('/gestion/contabilidad/egresos/' + e.numero + '/pdf', 'Comprobante de egreso ' + e.numero, { ver: 1 })"><app-icono nombre="ojo" [tam]="14" />PDF</button>
              @if (puedeGestionar && e.estado === 'ACTIVO') {
                <button class="pequeno" (click)="abrirCorreo(e)"><app-icono nombre="correo" [tam]="14" />Correo</button>
                <button class="pequeno" (click)="whatsapp(e)"><app-icono nombre="enviar" [tam]="14" />WhatsApp</button>
                <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularEgreso(e)">Anular</button>
              }</div></td></tr>
        } @empty { <tr><td colspan="9" class="vacio">Sin comprobantes de egreso</td></tr> }</tbody></table></div>
    }

    <!-- Causar compra -->
    <app-modal titulo="Causar compra" [abierto]="!!compra()" [ancho]="true" (cerrar)="compra.set(null)">
      @if (compra(); as f) {
        <div class="acciones" style="margin-bottom:10px">
          <label class="boton pequeno"><input type="file" accept=".xml,text/xml,application/xml" hidden (change)="cargarXml($event)" /><app-icono nombre="documento" [tam]="14" />Cargar XML de la factura (DIAN)</label>
          @if (f.xml) { <span class="chip ok">XML cargado: {{ f.documento }}</span> }
        </div>
        @for (a of avisosXml(); track a) { <div class="mensaje alerta">{{ a }}</div> }
        @if (proveedorXml(); as px) {
          <div class="mensaje alerta">El proveedor {{ px.nombre }} (NIT {{ px.nit }}) no está creado.
            <button type="button" class="pequeno primario" (click)="crearProveedorXml()">Crear con los datos del XML</button></div>
        }
        <form id="form-compra" class="formulario" (ngSubmit)="guardarCompra()">
          <div class="campo"><label for="cp-p">Proveedor</label><select id="cp-p" name="p" [(ngModel)]="f.proveedor" (change)="alCambiarProveedor()" required><option value="">Seleccione…</option>
            @for (p of proveedores(); track p._id) { <option [value]="p._id">{{ p.nombre }} · {{ p.nit }}</option> }</select></div>
          <div class="campo"><label for="cp-td">Soporte</label><select id="cp-td" name="td" [(ngModel)]="f.tipoDocumento">@for (t of tiposDoc; track t[0]) { <option [value]="t[0]">{{ t[1] }}</option> }</select></div>
          <div class="campo"><label for="cp-d">N.° de factura</label><input id="cp-d" name="d" [(ngModel)]="f.documento" /></div>
          <div class="campo"><label for="cp-f">Fecha</label><input id="cp-f" type="date" name="f" [(ngModel)]="f.fecha" required /></div>
          <div class="campo"><label for="cp-v">Vence</label><input id="cp-v" type="date" name="v" [(ngModel)]="f.vence" /></div>
          <div class="campo"><label for="cp-k">Retención en la fuente</label><select id="cp-k" name="k" [(ngModel)]="f.conceptoRetencion" (change)="recalcular()">@for (c of conceptos; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
        </form>
        <div class="tabla-caja" style="margin-top:10px"><table>
          <thead><tr><th>Cuenta</th><th>Descripción</th><th class="num">Base</th><th class="num">% IVA</th><th></th></tr></thead>
          <tbody>@for (l of f.lineas; track $index; let i = $index) {
            <tr><td><select [(ngModel)]="l.cuenta" [attr.aria-label]="'Cuenta línea ' + (i + 1)">@for (c of cuentasCompra(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></td>
              <td><input [(ngModel)]="l.descripcion" [attr.aria-label]="'Descripción línea ' + (i + 1)" /></td>
              <td><div class="moneda"><input moneda [(ngModel)]="l.base" (change)="recalcular()" [attr.aria-label]="'Base línea ' + (i + 1)" /></div></td>
              <td><select [(ngModel)]="l.ivaPct" (change)="recalcular()" [attr.aria-label]="'IVA línea ' + (i + 1)">@for (t of tarifasIva(l.ivaPct); track t) { <option [ngValue]="t">{{ t }}</option> }</select></td>
              <td>@if (f.lineas.length > 1) { <button type="button" class="pequeno peligro" (click)="f.lineas.splice(i, 1); recalcular()">Quitar</button> }</td></tr>
          }</tbody></table></div>
        <button type="button" class="pequeno" style="margin-top:6px" (click)="f.lineas.push({ cuenta: f.lineas[0]?.cuenta || '5195', descripcion: '', base: null, ivaPct: 0 })"><app-icono nombre="mas" [tam]="14" />Agregar línea</button>
        <details style="margin-top:10px"><summary>Cambiar retenciones a mano</summary>
          <div class="formulario" style="margin-top:8px">
            <div class="campo"><label for="cp-rf">% Retefuente</label><input id="cp-rf" type="number" step="0.01" [(ngModel)]="f.manual.retefuentePct" (change)="recalcular()" placeholder="Automática" /></div>
            <div class="campo"><label for="cp-ri">% ReteIVA (sobre el IVA)</label><input id="cp-ri" type="number" step="1" [(ngModel)]="f.manual.reteIvaPct" (change)="recalcular()" placeholder="Automática" /></div>
            <div class="campo"><label for="cp-rc">ReteICA (por mil)</label><input id="cp-rc" type="number" step="0.01" [(ngModel)]="f.manual.reteIcaPorMil" (change)="recalcular()" placeholder="La del proveedor" /></div>
          </div></details>
        @if (previa(); as v) {
          <div class="panel-mini">
            <div><span>Subtotal</span><strong>{{ v.subtotal | pesos }}</strong></div><div><span>IVA</span><strong>{{ v.iva | pesos }}</strong></div>
            <div><span>Total factura</span><strong>{{ v.total | pesos }}</strong></div>
            <div><span>Retefuente {{ v.retefuentePct }} %</span><strong>{{ v.retefuente | pesos }}</strong>@if (!v.retefuente && v.baseMinima > v.subtotal) { <small>Base mínima {{ v.baseMinima | pesos }}</small> }</div>
            <div><span>ReteIVA {{ v.reteIvaPct }} %</span><strong>{{ v.reteIva | pesos }}</strong></div><div><span>ReteICA {{ v.reteIcaPorMil }} ‰</span><strong>{{ v.reteIca | pesos }}</strong></div>
            <div><span>Neto a pagar</span><strong>{{ v.neto | pesos }}</strong></div>
          </div>
          @if (f.totalXml && f.totalXml !== v.total) { <div class="mensaje alerta">El total no coincide con el de la factura electrónica ({{ f.totalXml | pesos }}). Revise las líneas.</div> }
        }
      }
      <ng-container pie><button type="button" (click)="compra.set(null)">Cancelar</button><button class="primario" type="submit" form="form-compra" [disabled]="trabajando()">Causar</button></ng-container>
    </app-modal>

    <!-- Comprobante de egreso -->
    <app-modal titulo="Comprobante de egreso" [abierto]="!!egreso()" [ancho]="true" (cerrar)="egreso.set(null)">
      @if (egreso(); as e) {
        <form id="form-egreso" class="formulario" (ngSubmit)="guardarEgreso()">
          <div class="campo"><label for="eg-p">Proveedor</label><select id="eg-p" name="p" [(ngModel)]="e.proveedor" (change)="cargarPendientes()"><option value="">Otro beneficiario (sin compras)</option>
            @for (p of proveedores(); track p._id) { <option [value]="p._id">{{ p.nombre }} · {{ p.nit }}</option> }</select></div>
          @if (!e.proveedor) {
            <div class="campo"><label for="eg-b">Beneficiario</label><input id="eg-b" name="b" [(ngModel)]="e.beneficiario" required /></div>
            <div class="campo"><label for="eg-bd">NIT / cédula</label><input id="eg-bd" name="bd" [(ngModel)]="e.beneficiarioDoc" inputmode="numeric" /></div>
          }
          <div class="campo"><label for="eg-f">Fecha</label><input id="eg-f" type="date" name="f" [(ngModel)]="e.fecha" required /></div>
          <div class="campo"><label for="eg-c">Sale de</label><select id="eg-c" name="c" [(ngModel)]="e.cuenta"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option></select></div>
          <div class="campo"><label for="eg-m">Medio</label><select id="eg-m" name="m" [(ngModel)]="e.medio"><option value="transferencia">Transferencia</option><option value="cheque">Cheque</option><option value="consignacion">Consignación</option><option value="efectivo">Efectivo</option></select></div>
          <div class="campo"><label for="eg-r">Referencia / n.° de cheque</label><input id="eg-r" name="r" [(ngModel)]="e.referencia" /></div>
          <div class="campo"><label for="eg-x">Concepto</label><input id="eg-x" name="x" [(ngModel)]="e.concepto" /></div>
          @if (e.cuenta === '1110') { <div class="campo"><label class="casilla"><input type="checkbox" name="g" [(ngModel)]="e.gmf" />Registrar el 4x1000 (GMF)</label></div> }
        </form>
        @if (pendientes().length) {
          <h3 style="margin:12px 0 6px">Compras pendientes del proveedor</h3>
          <div class="tabla-caja"><table>
            <thead><tr><th></th><th>Compra</th><th>Factura</th><th>Vence</th><th class="num">Saldo</th><th class="num">Valor a pagar</th></tr></thead>
            <tbody>@for (c of pendientes(); track c.numero) {
              <tr><td><input type="checkbox" [(ngModel)]="c.marcado" (change)="c.valor = c.marcado ? c.saldo : null" [attr.aria-label]="'Pagar ' + c.numero" /></td>
                <td>{{ c.numero }}</td><td>{{ c.documento }}</td><td>{{ c.vence | dia }}</td><td class="num">{{ c.saldo | pesos }}</td>
                <td><div class="moneda"><input moneda [(ngModel)]="c.valor" [disabled]="!c.marcado" [attr.aria-label]="'Valor ' + c.numero" /></div></td></tr>
            }</tbody></table></div>
        } @else if (e.proveedor) { <p class="sutil">El proveedor no tiene compras pendientes.</p> }
        <h3 style="margin:12px 0 6px">Otros conceptos (anticipos, gastos sin factura…)</h3>
        @for (o of e.otros; track $index; let i = $index) {
          <div class="formulario" style="grid-template-columns:2fr 2fr 1fr auto;align-items:end">
            <div class="campo"><label [attr.for]="'eo-c' + i">Cuenta</label><select [id]="'eo-c' + i" [(ngModel)]="o.cuenta">@for (c of cuentasOtros(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
            <div class="campo"><label [attr.for]="'eo-d' + i">Descripción</label><input [id]="'eo-d' + i" [(ngModel)]="o.descripcion" /></div>
            <div class="campo"><label [attr.for]="'eo-v' + i">Valor</label><div class="moneda"><input [id]="'eo-v' + i" moneda [(ngModel)]="o.valor" /></div></div>
            <button type="button" class="pequeno peligro" (click)="e.otros.splice(i, 1)">Quitar</button>
          </div>
        }
        <button type="button" class="pequeno" (click)="e.otros.push({ cuenta: '1330', descripcion: '', valor: null })"><app-icono nombre="mas" [tam]="14" />Agregar concepto</button>
        <p style="margin-top:10px"><strong>Total del egreso: {{ totalEgreso() | pesos }}</strong>@if (e.cuenta === '1110' && e.gmf) { <span class="sutil"> · 4x1000 {{ totalEgreso() * 0.004 | pesos }}</span> }</p>
      }
      <ng-container pie><button type="button" (click)="egreso.set(null)">Cancelar</button><button class="primario" type="submit" form="form-egreso" [disabled]="trabajando()">Registrar egreso</button></ng-container>
    </app-modal>

    <!-- Envío por correo -->
    <app-modal titulo="Enviar comprobante por correo" [abierto]="!!correo()" (cerrar)="correo.set(null)">
      @if (correo(); as c) {
        <form id="form-correo-eg" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="enviarCorreo()">
          <div class="campo"><label for="ce-p">Para (separe con comas)</label><input id="ce-p" name="p" [(ngModel)]="c.para" required /></div>
          <p class="sutil">Se envía el PDF del comprobante {{ c.numero }} con la cuenta de correo de la empresa (Configuración → Correo).</p>
        </form>
      }
      <ng-container pie><button type="button" (click)="correo.set(null)">Cancelar</button><button class="primario" type="submit" form="form-correo-eg" [disabled]="trabajando()">Enviar</button></ng-container>
    </app-modal>`,
  styles: [`
    tr.anulado td { color: var(--gris-5); text-decoration: line-through; }
    .panel-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 12px; }
    .panel-mini > div { padding: 8px 10px; border: 1px solid var(--gris-2); border-radius: var(--radio); display: flex; flex-direction: column; gap: 2px; }
    .panel-mini span, .panel-mini small { font-size: 12px; color: var(--gris-5); } .panel-mini strong { font-variant-numeric: tabular-nums; }
    label.boton { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--gris-3); border-radius: var(--radio); padding: 4px 10px; }
  `],
})
export class ComprasCont {
  private api = inject(Api); private avisos = inject(Avisos);
  readonly puedeGestionar = inject(Auth).tiene(P.CONTABILIDAD_GESTIONAR);
  readonly vista = input<'compras' | 'egresos'>('compras');
  readonly conceptos = CONCEPTOS; readonly tiposDoc = TIPOS_DOC;
  readonly compras = signal<any[]>([]); readonly egresos = signal<any[]>([]);
  readonly proveedores = signal<any[]>([]); readonly cuentas = signal<any[]>([]);
  readonly q = signal(''); readonly estado = signal('');
  readonly compra = signal<any>(null); readonly egreso = signal<any>(null); readonly correo = signal<any>(null);
  readonly previa = signal<any>(null); readonly avisosXml = signal<string[]>([]); readonly proveedorXml = signal<any>(null);
  readonly pendientes = signal<any[]>([]);
  readonly trabajando = signal(false);
  private gmfPorDefecto = true;
  readonly comprasVisibles = computed(() => filtrar<any>(this.compras().filter(c => !this.estado() || c.estado === this.estado()), this.q()));
  readonly egresosVisibles = computed(() => filtrar<any>(this.egresos(), this.q()));
  readonly cuentasCompra = computed(() => this.cuentas().filter(c => /^(1330|14|1[5-9]|[5-7])/.test(c.codigo)));
  tarifasIva(actual: number) { return [...new Set([0, 5, 19, Number(actual) || 0])].sort((a, b) => a - b); }
  readonly cuentasOtros = computed(() => this.cuentas().filter(c => /^(13|14|1[5-9]|2|[5-7])/.test(c.codigo)));

  ngOnInit() { this.cargar(); }
  constructor() {
    this.api.get<any[]>('/gestion/contabilidad/proveedores').then(p => this.proveedores.set(p)).catch(() => {});
    this.api.get<any[]>('/gestion/contabilidad/cuentas').then(c => this.cuentas.set(c)).catch(() => {});
    this.api.get<any>('/gestion/contabilidad/parametros').then(p => { this.gmfPorDefecto = p.gmf !== false; }).catch(() => {});
  }
  async cargar() {
    try {
      this.compras.set(await this.api.get('/gestion/contabilidad/compras'));
      if (this.vista() === 'egresos') this.egresos.set(await this.api.get('/gestion/contabilidad/egresos'));
    } catch (e) { this.avisos.error(e); }
  }
  detalleEgreso(e: any) {
    return [...e.pagos.map((x: any) => x.documento ? `Fact. ${x.documento}` : x.compra), ...e.otros.map((x: any) => x.descripcion || x.cuenta)].join(', ');
  }

  // ── Compra ──
  abrirCompra() {
    this.previa.set(null); this.avisosXml.set([]); this.proveedorXml.set(null);
    this.compra.set({ proveedor: '', tipoDocumento: 'factura', documento: '', cufe: '', fecha: hoyIso(), vence: '', conceptoRetencion: 'servicios',
      lineas: [{ cuenta: '5195', descripcion: '', base: null, ivaPct: 0 }], manual: {}, xml: '', totalXml: 0 });
  }
  alCambiarProveedor() {
    const f = this.compra(); const p = this.proveedores().find(x => x._id === f.proveedor);
    if (p) { f.conceptoRetencion = p.conceptoRetencion || 'servicios'; if (!f.xml) f.lineas.forEach((l: any) => { l.cuenta = p.cuentaGasto || l.cuenta; }); }
    this.recalcular();
  }
  async recalcular() {
    const f = this.compra();
    if (!f?.proveedor || !f.lineas.some((l: any) => Number(l.base) > 0)) { this.previa.set(null); return; }
    try {
      this.previa.set(await this.api.post('/gestion/contabilidad/compras/vista-previa', { proveedor: f.proveedor, conceptoRetencion: f.conceptoRetencion,
        lineas: f.lineas.filter((l: any) => Number(l.base) > 0), manual: this.manual(f) }));
    } catch (e) { this.previa.set(null); this.avisos.error(e); }
  }
  private manual(f: any) {
    return { retefuentePct: vacioSiNulo(f.manual.retefuentePct), reteIvaPct: vacioSiNulo(f.manual.reteIvaPct), reteIcaPorMil: vacioSiNulo(f.manual.reteIcaPorMil) };
  }
  async cargarXml(ev: Event) {
    const inp = ev.target as HTMLInputElement; const archivo = inp.files?.[0]; inp.value = '';
    if (!archivo) return;
    if (archivo.size > 850000) { this.avisos.error('El XML es demasiado grande'); return; }
    try {
      const xml = await archivo.text();
      const r = await this.api.post<any>('/gestion/contabilidad/compras/leer-xml', { xml });
      const f = this.compra(); const fx = r.factura;
      Object.assign(f, { xml, documento: fx.numero, cufe: fx.cufe, fecha: fx.fecha || f.fecha, vence: fx.vence || '', tipoDocumento: 'factura', lineas: r.lineas, totalXml: fx.total });
      this.avisosXml.set(r.avisos);
      if (r.proveedor) { f.proveedor = r.proveedor._id; f.conceptoRetencion = r.proveedor.conceptoRetencion || f.conceptoRetencion; this.proveedorXml.set(null); }
      else this.proveedorXml.set(fx.proveedor);
      this.compra.set({ ...f }); this.recalcular();
    } catch (e) { this.avisos.error(e); }
  }
  async crearProveedorXml() {
    const px = this.proveedorXml(); if (!px) return;
    try {
      const p = await this.api.post<any>('/gestion/contabilidad/proveedores', { tipoId: 'N', nit: px.nit, dv: px.dv, nombre: px.nombre, correo: px.correo, telefono: px.telefono,
        ciudad: px.ciudad, direccion: px.direccion, fiscal: { ...px.fiscal, declarante: true, ciiu: '', reteIcaPorMil: 0 }, conceptoRetencion: 'servicios',
        cuentaGasto: this.compra().lineas[0]?.cuenta || '5195' });
      this.proveedores.set([...this.proveedores(), p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      const f = this.compra(); f.proveedor = p._id; this.compra.set({ ...f }); this.proveedorXml.set(null);
      this.avisos.ok('Proveedor creado. Revise sus datos fiscales en la pestaña Proveedores.'); this.recalcular();
    } catch (e) { this.avisos.error(e); }
  }
  async guardarCompra() {
    const f = this.compra();
    this.trabajando.set(true);
    try {
      const c = await this.api.post<any>('/gestion/contabilidad/compras', { proveedor: f.proveedor, fecha: f.fecha, vence: f.vence, tipoDocumento: f.tipoDocumento, documento: f.documento,
        cufe: f.cufe, conceptoRetencion: f.conceptoRetencion, manual: this.manual(f), xml: f.xml, lineas: f.lineas.filter((l: any) => Number(l.base) > 0) });
      this.avisos.ok(`Compra ${c.numero} causada · neto a pagar ${c.neto.toLocaleString('es-CO')}`); this.compra.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularCompra(c: any) { try { await this.api.post(`/gestion/contabilidad/compras/${c.numero}/anular`, {}); this.avisos.ok(`Compra ${c.numero} anulada`); this.cargar(); } catch (e) { this.avisos.error(e); } }
  async descargarXml(c: any) { try { await this.api.descargar(`/gestion/contabilidad/compras/${c.numero}/xml`, {}, `${c.numero}.xml`); } catch (e) { this.avisos.error(e); } }

  // ── Egreso ──
  abrirEgreso(c: any = null) {
    this.egreso.set({ proveedor: c ? String(c.proveedor) : '', beneficiario: '', beneficiarioDoc: '', fecha: hoyIso(), cuenta: '1110', medio: 'transferencia', referencia: '', concepto: '',
      gmf: this.gmfPorDefecto, otros: [] });
    this.cargarPendientes(c?.numero);
  }
  cargarPendientes(marcar?: string) {
    const e = this.egreso();
    this.pendientes.set(!e?.proveedor ? [] : this.compras().filter(c => c.estado === 'PENDIENTE' && String(c.proveedor) === e.proveedor)
      .map(c => ({ numero: c.numero, documento: c.documento, vence: c.vence, saldo: c.neto - c.pagado, marcado: c.numero === marcar, valor: c.numero === marcar ? c.neto - c.pagado : null })));
  }
  totalEgreso() {
    const e = this.egreso(); if (!e) return 0;
    return this.pendientes().filter(c => c.marcado).reduce((a, c) => a + (Number(c.valor) || 0), 0) + e.otros.reduce((a: number, o: any) => a + (Number(o.valor) || 0), 0);
  }
  async guardarEgreso() {
    const e = this.egreso();
    if (!this.totalEgreso()) { this.avisos.error('Escoja las compras que paga o agregue un concepto'); return; }
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/gestion/contabilidad/egresos', { fecha: e.fecha, ...(e.proveedor ? { proveedor: e.proveedor } : { beneficiario: e.beneficiario, beneficiarioDoc: e.beneficiarioDoc }),
        cuenta: e.cuenta, medio: e.medio, referencia: e.referencia, concepto: e.concepto, gmf: e.cuenta === '1110' && !!e.gmf,
        pagos: this.pendientes().filter(c => c.marcado && Number(c.valor) > 0).map(c => ({ compra: c.numero, valor: c.valor })),
        otros: e.otros.filter((o: any) => Number(o.valor) > 0) });
      this.avisos.ok(`Comprobante ${r.numero} registrado`); this.egreso.set(null); this.cargar();
      if (this.vista() !== 'egresos') this.avisos.ok('Véalo, imprímalo o envíelo en la pestaña «Egresos»');
    } catch (err) { this.avisos.error(err); } finally { this.trabajando.set(false); }
  }
  async anularEgreso(e: any) { try { await this.api.post(`/gestion/contabilidad/egresos/${e.numero}/anular`, {}); this.avisos.ok(`Egreso ${e.numero} anulado`); this.cargar(); } catch (err) { this.avisos.error(err); } }
  abrirCorreo(e: any) {
    const p = this.proveedores().find(x => x._id === String(e.proveedor));
    this.correo.set({ numero: e.numero, para: p?.correo || '' });
  }
  async enviarCorreo() {
    const c = this.correo(); this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/gestion/contabilidad/egresos/${c.numero}/enviar`, { para: String(c.para).split(/[,;\s]+/).filter(Boolean) });
      if (r.estado === 'enviado') { this.avisos.ok('Comprobante enviado'); this.correo.set(null); } else this.avisos.error(r.error || 'No se pudo enviar');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  // WhatsApp: se descarga el PDF (para adjuntarlo) y se abre el chat con el mensaje listo
  async whatsapp(e: any) {
    const p = this.proveedores().find(x => x._id === String(e.proveedor));
    let numero = String(p?.whatsapp || p?.telefono || '').replace(/\D/g, '');
    if (numero.length === 10) numero = `57${numero}`;
    const texto = `Buen día, ${e.beneficiario}. Le enviamos el comprobante de egreso ${e.numero} del ${new Date(e.fecha).toLocaleDateString('es-CO', { timeZone: 'UTC' })} por $ ${e.total.toLocaleString('es-CO')}`
      + `${e.pagos.length ? ` (pago de ${e.pagos.map((x: any) => x.documento ? `factura ${x.documento}` : x.compra).join(', ')})` : ''}. Adjuntamos el PDF.`;
    try { await this.api.descargar(`/gestion/contabilidad/egresos/${e.numero}/pdf`, {}, `Egreso_${e.numero}.pdf`); } catch (err) { this.avisos.error(err); }
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  }
}

// ═════════════ Conciliación bancaria ═════════════
// Fecha de una celda del extracto: 31/10/2026, 31-10-2026 o 2026-10-31
const aIso = (v: string) => {
  const t = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(t); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};
// Valor con signo: «-1.234.567,89», «(1.234,00)», «$ 2.000.000»
const aValor = (v: string | undefined) => {
  const t = String(v || '').trim(); if (!t) return 0;
  const neg = /^-|^\(.*\)$|-$/.test(t.replace(/[$\s]/g, ''));
  const n = Number(t.replace(/[$\s()-]/g, '').replace(/[.,]\d{1,2}$/, '').replace(/[.,]/g, '')) || 0;
  return neg ? -n : n;
};

@Component({
  selector: 'app-cont-conciliacion',
  imports: [FormsModule, Icono, ...FORMATOS],
  template: `
    <p class="sutil">Pegue el extracto del banco desde Excel con las columnas <strong>Fecha · Descripción · Valor</strong> (negativo = salida) o
      <strong>Fecha · Descripción · Retiro · Consignación</strong>. Se cruzan con los movimientos de la cuenta por valor y fecha cercana.</p>
    <div class="formulario" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="campo"><label for="cb-c">Cuenta</label><select id="cb-c" [(ngModel)]="cuenta">@for (c of cuentasBanco(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
      <div class="campo"><label for="cb-m">Mes</label><input id="cb-m" type="month" [(ngModel)]="mes" /></div>
      <div class="campo"><label for="cb-s">Saldo final del extracto</label><input id="cb-s" type="number" [(ngModel)]="saldoExtracto" /></div>
      <div class="campo"><label for="cb-d">Días de diferencia permitidos</label><input id="cb-d" type="number" min="0" max="15" [(ngModel)]="dias" /></div>
    </div>
    <div class="campo"><label for="cb-t">Extracto pegado desde Excel</label><textarea id="cb-t" rows="5" [ngModel]="texto()" (ngModelChange)="texto.set($event)" placeholder="31/10/2026&#9;CUOTA DE MANEJO&#9;-15000"></textarea>
      <small>{{ filas().length }} movimiento(s) leído(s) · entradas {{ entradas() | pesos }} · salidas {{ salidas() | pesos }}</small></div>
    <div class="acciones" style="margin:10px 0">
      <button class="primario" [disabled]="trabajando()" (click)="calcular()">Conciliar</button>
      @if (puedeGestionar && r()) {
        <button [disabled]="trabajando()" (click)="guardar(false)">Guardar borrador</button>
        <button class="primario" [disabled]="trabajando() || r().diferencia !== 0" (click)="guardar(true)">Cerrar conciliación</button>
      }
    </div>
    @if (r(); as x) {
      <div class="panel-mini">
        <div><span>Saldo en libros</span><strong>{{ x.saldoLibros | pesos }}</strong></div>
        <div><span>Saldo del extracto</span><strong>{{ x.saldoExtracto | pesos }}</strong></div>
        <div><span>Cruzados</span><strong>{{ x.cruzados.length }}</strong><small>de {{ x.movimientosBanco }} del banco</small></div>
        <div><span>En libros, no en el banco</span><strong>{{ x.pendLibros | pesos }}</strong></div>
        <div><span>En el banco, no en libros</span><strong>{{ x.pendBanco | pesos }}</strong></div>
        <div><span>Diferencia</span><strong [class.negativo]="x.diferencia !== 0">{{ x.diferencia | pesos }}</strong>@if (x.diferencia === 0) { <small>Conciliada</small> }</div>
      </div>
      <h3 style="margin:14px 0 6px">En el banco y no en libros</h3>
      <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>Fecha</th><th>Descripción</th><th class="num">Valor</th><th></th></tr></thead>
        <tbody>@for (b of x.bancoSinLibros; track $index) {
          <tr><td data-etiqueta="Fecha">{{ b.fecha | dia }}</td><td data-etiqueta="Descripción">{{ b.descripcion }}</td><td data-etiqueta="Valor" class="num">{{ b.valor | pesos }}</td>
            <td>@if (puedeGestionar && b.valor < 0) { <button class="pequeno" (click)="registrarGasto(b)"><app-icono nombre="mas" [tam]="14" />Registrar gasto bancario</button> }</td></tr>
        } @empty { <tr><td colspan="4" class="vacio">Nada pendiente</td></tr> }</tbody></table></div>
      <h3 style="margin:14px 0 6px">En libros y no en el banco</h3>
      <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>Fecha</th><th>Asiento</th><th>Documento</th><th>Concepto</th><th class="num">Valor</th></tr></thead>
        <tbody>@for (l of x.librosSinBanco; track $index) {
          <tr><td data-etiqueta="Fecha">{{ l.fecha | dia }}@if (l.anterior) { <span class="chip">mes anterior</span> }</td><td data-etiqueta="Asiento">{{ l.numero }}</td><td data-etiqueta="Documento">{{ l.documento }}</td>
            <td data-etiqueta="Concepto">{{ l.concepto }}</td><td data-etiqueta="Valor" class="num">{{ l.valor | pesos }}</td></tr>
        } @empty { <tr><td colspan="5" class="vacio">Nada pendiente</td></tr> }</tbody></table></div>
    }
    @if (historial().length) {
      <h3 style="margin:14px 0 6px">Conciliaciones guardadas</h3>
      <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>Mes</th><th>Cuenta</th><th class="num">Saldo libros</th><th class="num">Saldo extracto</th><th class="num">Diferencia</th><th>Estado</th></tr></thead>
        <tbody>@for (h of historial(); track h._id) {
          <tr><td data-etiqueta="Mes">{{ h.mes }}</td><td data-etiqueta="Cuenta">{{ h.cuenta }}</td><td data-etiqueta="Libros" class="num">{{ h.saldoLibros | pesos }}</td>
            <td data-etiqueta="Extracto" class="num">{{ h.saldoExtracto | pesos }}</td><td data-etiqueta="Diferencia" class="num">{{ h.diferencia | pesos }}</td>
            <td data-etiqueta="Estado"><span class="chip" [class.ok]="h.estado === 'CERRADA'">{{ h.estado }}</span></td></tr>
        }</tbody></table></div>
    }`,
  styles: [`
    .panel-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    .panel-mini > div { padding: 8px 10px; border: 1px solid var(--gris-2); border-radius: var(--radio); display: flex; flex-direction: column; gap: 2px; }
    .panel-mini span, .panel-mini small { font-size: 12px; color: var(--gris-5); } .panel-mini strong { font-variant-numeric: tabular-nums; } .negativo { color: var(--rojo); }
  `],
})
export class ConciliacionCont {
  private api = inject(Api); private avisos = inject(Avisos);
  readonly puedeGestionar = inject(Auth).tiene(P.CONTABILIDAD_GESTIONAR);
  readonly cuentas = signal<any[]>([]);
  readonly cuentasBanco = computed(() => this.cuentas().filter(c => /^11/.test(c.codigo)));
  readonly texto = signal('');
  readonly r = signal<any>(null);
  readonly historial = signal<any[]>([]);
  readonly trabajando = signal(false);
  cuenta = '1110'; mes = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  saldoExtracto: number | null = null; dias = 5;
  readonly filas = computed(() => this.texto().split(/\r?\n/).map(l => l.split(/\t|;/)).map(c => {
    const fecha = aIso(c[0]); if (!fecha) return null;
    const valor = c.length >= 4 ? aValor(c[3]) - Math.abs(aValor(c[2])) : aValor(c[2]);
    return valor ? { fecha, descripcion: (c[1] || '').trim(), valor } : null;
  }).filter(Boolean) as { fecha: string; descripcion: string; valor: number }[]);
  readonly entradas = computed(() => this.filas().filter(f => f.valor > 0).reduce((a, f) => a + f.valor, 0));
  readonly salidas = computed(() => this.filas().filter(f => f.valor < 0).reduce((a, f) => a + f.valor, 0));
  constructor() {
    this.api.get<any[]>('/gestion/contabilidad/cuentas').then(c => this.cuentas.set(c)).catch(() => {});
    this.cargarHistorial();
  }
  async cargarHistorial() { try { this.historial.set(await this.api.get('/gestion/contabilidad/conciliaciones')); } catch { /* sin permiso o sin datos */ } }
  private cuerpo(cerrar = false) { return { cuenta: this.cuenta, mes: this.mes, saldoExtracto: Number(this.saldoExtracto) || 0, dias: this.dias, extracto: this.filas(), cerrar }; }
  async calcular() {
    if (this.saldoExtracto === null || this.saldoExtracto === undefined) { this.avisos.error('Escriba el saldo final del extracto'); return; }
    this.trabajando.set(true);
    try { this.r.set(await this.api.post('/gestion/contabilidad/conciliacion/calcular', this.cuerpo())); } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async guardar(cerrar: boolean) {
    this.trabajando.set(true);
    try {
      this.r.set(await this.api.post('/gestion/contabilidad/conciliaciones', this.cuerpo(cerrar)));
      this.avisos.ok(cerrar ? 'Conciliación cerrada' : 'Borrador guardado'); this.cargarHistorial();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  // Cobros del banco (cuota de manejo, comisiones, 4x1000) que aún no están en libros
  async registrarGasto(b: any) {
    try {
      await this.api.post('/gestion/contabilidad/gastos', { fecha: String(b.fecha).slice(0, 10), cuenta: '530505', concepto: b.descripcion || 'Gasto bancario', valor: Math.abs(b.valor), formaPago: this.cuenta === '1105' ? '1105' : '1110' });
      this.avisos.ok('Gasto bancario registrado'); this.calcular();
    } catch (e) { this.avisos.error(e); }
  }
}

// ═════════════ Tabla de retenciones y parámetros de compras ═════════════
@Component({
  selector: 'app-cont-retenciones',
  imports: [FormsModule, ...FORMATOS],
  template: `
    <h2 style="margin:18px 0 6px">Compras y retenciones</h2>
    <div class="formulario" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="campo"><label for="rt-u">Valor de la UVT</label><input id="rt-u" type="number" [(ngModel)]="p.uvt" [disabled]="!puedeGestionar" /><small>2026: $ 52.374</small></div>
      <div class="campo"><label for="rt-ri">% ReteIVA</label><input id="rt-ri" type="number" [(ngModel)]="p.reteIvaPct" [disabled]="!puedeGestionar" /></div>
      <div class="campo"><label class="casilla"><input type="checkbox" [(ngModel)]="p.ivaDescontable" [disabled]="!puedeGestionar" />La empresa es responsable de IVA (IVA descontable 240810)</label>
        <small>Si no, el IVA de las compras es mayor valor del gasto (el transporte de carga está excluido de IVA).</small></div>
      <div class="campo"><label class="casilla"><input type="checkbox" [(ngModel)]="p.agenteReteIva" [disabled]="!puedeGestionar" />Es agente de retención de IVA</label></div>
      <div class="campo"><label class="casilla"><input type="checkbox" [(ngModel)]="p.gmf" [disabled]="!puedeGestionar" />Registrar el 4x1000 en los egresos por bancos</label></div>
    </div>
    <div class="tabla-caja" style="margin-top:10px"><table>
      <thead><tr><th>Concepto</th><th class="num">Tarifa %</th><th class="num">Base mínima (UVT)</th><th class="num">Base en pesos</th></tr></thead>
      <tbody>@for (c of filas(); track c[0]) {
        <tr><td>{{ c[1].nombre }}</td>
          <td><input type="number" step="0.1" style="width:90px" [(ngModel)]="c[1].pct" [disabled]="!puedeGestionar" [attr.aria-label]="'Tarifa ' + c[1].nombre" /></td>
          <td><input type="number" step="1" style="width:90px" [(ngModel)]="c[1].baseUvt" [disabled]="!puedeGestionar" [attr.aria-label]="'Base ' + c[1].nombre" /></td>
          <td class="num">{{ c[1].baseUvt * p.uvt | pesos }}</td></tr>
      }</tbody></table></div>
    <p class="sutil">Bases y tarifas del Decreto 572 de 2025. Si la norma cambia, ajústelas aquí; confírmelas con la contadora.</p>
    @if (puedeGestionar) { <div class="acciones"><button class="primario" [disabled]="trabajando()" (click)="guardar()">Guardar retenciones</button></div> }`,
})
export class RetencionesCont {
  private api = inject(Api); private avisos = inject(Avisos);
  readonly puedeGestionar = inject(Auth).tiene(P.CONTABILIDAD_GESTIONAR);
  readonly trabajando = signal(false);
  readonly filas = signal<[string, any][]>([]);
  p: any = { uvt: 52374, reteIvaPct: 15, ivaDescontable: false, agenteReteIva: false, gmf: true };
  constructor() { this.cargar(); }
  async cargar() {
    try {
      const [par, tabla] = await Promise.all([this.api.get<any>('/gestion/contabilidad/parametros'), this.api.get<any>('/gestion/contabilidad/retenciones/tabla')]);
      this.p = { uvt: par.uvt, reteIvaPct: par.reteIvaPct, ivaDescontable: par.ivaDescontable, agenteReteIva: par.agenteReteIva, gmf: par.gmf };
      this.filas.set(Object.entries(tabla.conceptos).filter(([k]) => k !== 'ninguna') as [string, any][]);
    } catch (e) { this.avisos.error(e); }
  }
  async guardar() {
    this.trabajando.set(true);
    const retenciones = Object.fromEntries(this.filas().map(([k, v]) => [k, { pct: Number(v.pct) || 0, baseUvt: Number(v.baseUvt) || 0 }]));
    try { await this.api.put('/gestion/contabilidad/parametros', { ...this.p, uvt: Number(this.p.uvt), reteIvaPct: Number(this.p.reteIvaPct), retenciones }); this.avisos.ok('Retenciones guardadas'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
