// Contabilidad fase 3: tributario y fiscal. Borrador de retención en la fuente (350), ReteICA e ICA, pago de
// impuestos, calendario de vencimientos, información exógena, certificados de retención y factura electrónica de
// transporte (número y CUFE de la DIAN y relación de remesas para el RNDC). Pestaña «Tributario» de Contabilidad.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Moneda } from '../shared/moneda';
import { FORMATOS, hoyIso } from '../shared/formato';
import { VisorPdf } from '../shared/visor-pdf';

type Seccion = '350' | 'ica' | 'vencimientos' | 'exogena' | 'certificados' | 'fe';
const OBLIGACIONES: [string, string][] = [['retefuente', 'Retención en la fuente (350)'], ['reteiva', 'ReteIVA (350)'], ['reteica', 'ReteICA'], ['ica', 'Industria y comercio'],
  ['iva', 'IVA (300)'], ['renta', 'Renta (110)'], ['fopat', 'FOPAT y contribuciones']];
const mesAnterior = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

@Component({
  selector: 'app-cont-tributario',
  imports: [FormsModule, Icono, Modal, Moneda, VisorPdf, ...FORMATOS],
  template: `
    <app-visor-pdf #visor />
    <div class="segmentos" style="margin-bottom:12px">
      @for (s of secciones; track s[0]) { <button type="button" [class.activo]="seccion() === s[0]" (click)="ir(s[0])">{{ s[1] }}</button> }
    </div>
    @if (proximos().length && seccion() !== 'vencimientos') {
      <div class="mensaje alerta">@for (v of proximos(); track $index) { <div><strong>{{ v.estado === 'VENCIDO' ? 'Vencido' : 'Vence pronto' }}:</strong> {{ nombreObligacion(v.obligacion) }} {{ v.periodo }} · {{ v.fecha | dia }}</div> }</div>
    }

    @switch (seccion()) {
      @case ('350') {
        <div class="barra-mini"><div class="campo"><label for="t-mes">Mes</label><input id="t-mes" type="month" [(ngModel)]="mes" (change)="cargar()" /></div></div>
        @if (d350(); as b) {
          <div class="tabla-caja"><table class="tabla-movil">
            <thead><tr><th>Concepto</th><th class="num">Documentos</th><th class="num">Base</th><th class="num">Retención</th></tr></thead>
            <tbody>@for (c of b.conceptos; track c.concepto) {
              <tr><td data-etiqueta="Concepto">{{ c.concepto }}</td><td data-etiqueta="Documentos" class="num">{{ c.documentos }}</td><td data-etiqueta="Base" class="num">{{ c.base | pesos }}</td><td data-etiqueta="Retención" class="num">{{ c.retencion | pesos }}</td></tr>
            } @empty { <tr><td colspan="4" class="vacio">Sin retenciones en compras del mes</td></tr> }
            @if (b.otrasRetenciones.valor) { <tr><td>Otras retenciones registradas en 2365 (liquidaciones de conductores, asientos)</td><td></td><td class="num">{{ b.otrasRetenciones.baseConductores | pesos }}</td><td class="num">{{ b.otrasRetenciones.valor | pesos }}</td></tr> }
            <tr class="total"><td>Total retención en la fuente</td><td></td><td></td><td class="num">{{ b.totalRenta | pesos }}</td></tr>
            <tr><td>Retención de IVA (ReteIVA)</td><td></td><td></td><td class="num">{{ b.reteIva | pesos }}</td></tr>
            <tr class="total"><td>Total a pagar (sin intereses ni sanciones)</td><td></td><td></td><td class="num">{{ b.totalAPagar | pesos }}</td></tr></tbody></table></div>
          <p class="sutil">Saldos contables al cierre del mes: 2365 {{ b.saldosContables['2365'] | pesos }} · 2367 {{ b.saldosContables['2367'] | pesos }}.
            Borrador de apoyo: la declaración se presenta en los servicios en línea de la DIAN.</p>
          @for (p of b.pagos; track p.asiento) { <p><span class="chip ok">Pagado</span> {{ p.fecha | dia }} · {{ p.valor | pesos }} · asiento {{ p.asiento }}</p> }
          @if (puedeGestionar && !b.pagos.length && b.totalAPagar) {
            <button class="primario" (click)="abrirPago('350')"><app-icono nombre="dinero" />Registrar pago del 350</button>
          }
        }
      }
      @case ('ica') {
        <div class="barra-mini">
          <div class="campo"><label for="t-d">Desde</label><input id="t-d" type="date" [(ngModel)]="desde" (change)="cargar()" /></div>
          <div class="campo"><label for="t-h">Hasta</label><input id="t-h" type="date" [(ngModel)]="hasta" (change)="cargar()" /></div>
        </div>
        @if (ica(); as i) {
          <h3>ICA de la empresa</h3>
          <div class="formulario" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));max-width:720px">
            <div class="campo"><label for="ica-t">Tarifa (por mil)</label><input id="ica-t" type="number" step="0.01" [(ngModel)]="icaParam.icaTarifaPorMil" [disabled]="!puedeGestionar" /></div>
            <div class="campo"><label for="ica-a">Avisos y tableros %</label><input id="ica-a" type="number" [(ngModel)]="icaParam.avisosTablerosPct" [disabled]="!puedeGestionar" /></div>
            <div class="campo"><label for="ica-b">Sobretasa bomberil %</label><input id="ica-b" type="number" step="0.1" [(ngModel)]="icaParam.sobretasaBomberilPct" [disabled]="!puedeGestionar" /></div>
            @if (puedeGestionar) { <div class="campo" style="align-self:end"><button (click)="guardarIca()">Guardar tarifa</button></div> }
          </div>
          <div class="panel-mini">
            <div><span>Base (ingresos 41)</span><strong>{{ i.base | pesos }}</strong></div><div><span>Impuesto</span><strong>{{ i.impuesto | pesos }}</strong></div>
            <div><span>Avisos y tableros</span><strong>{{ i.avisos | pesos }}</strong></div><div><span>Sobretasa bomberil</span><strong>{{ i.bomberil | pesos }}</strong></div>
            <div><span>Retenido por clientes (1356)</span><strong>{{ i.retencionesPracticadas | pesos }}</strong></div><div><span>A pagar</span><strong>{{ i.aPagar | pesos }}</strong></div>
          </div>
          <p class="sutil">Con ingresos para terceros la base es solo la comisión (4145). La tarifa depende de la actividad y del municipio.</p>
        }
        @if (reteica(); as r) {
          <h3>ReteICA practicado a proveedores</h3>
          <div class="tabla-caja"><table class="tabla-movil"><thead><tr><th>NIT</th><th>Proveedor</th><th class="num">Base</th><th class="num">Por mil</th><th class="num">Retenido</th></tr></thead>
            <tbody>@for (x of r.filas; track x.nit) {
              <tr><td data-etiqueta="NIT">{{ x.nit }}</td><td data-etiqueta="Proveedor">{{ x.nombre }}</td><td data-etiqueta="Base" class="num">{{ x.base | pesos }}</td><td data-etiqueta="Por mil" class="num">{{ x.tarifaPorMil }}</td><td data-etiqueta="Retenido" class="num">{{ x.retencion | pesos }}</td></tr>
            } @empty { <tr><td colspan="5" class="vacio">Sin ReteICA en el periodo</td></tr> }
            <tr class="total"><td></td><td>Total</td><td></td><td></td><td class="num">{{ r.total | pesos }}</td></tr></tbody></table></div>
          @if (puedeGestionar) { <div class="acciones" style="margin-top:10px">
            @if (r.total) { <button (click)="abrirPago('reteica')">Registrar pago del ReteICA</button> }
            @if (ica()?.aPagar) { <button class="primario" (click)="abrirPago('ica')">Registrar pago del ICA</button> }</div> }
        }
      }
      @case ('vencimientos') {
        <p class="sutil">Cargue las fechas del calendario tributario de la DIAN (según el último dígito del NIT) y del municipio. Se marca «pagado» cuando se registra el pago con la misma obligación y periodo.</p>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Obligación</th><th>Periodo</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (v of venc(); track $index; let i = $index) {
            <tr><td data-etiqueta="Obligación">@if (puedeGestionar) { <select [(ngModel)]="v.obligacion" [attr.aria-label]="'Obligación ' + (i + 1)">@for (o of obligaciones; track o[0]) { <option [value]="o[0]">{{ o[1] }}</option> }</select> } @else { {{ nombreObligacion(v.obligacion) }} }</td>
              <td data-etiqueta="Periodo"><input [(ngModel)]="v.periodo" [disabled]="!puedeGestionar" placeholder="2026-10" [attr.aria-label]="'Periodo ' + (i + 1)" style="width:110px" /></td>
              <td data-etiqueta="Vence"><input type="date" [(ngModel)]="v.fechaIso" [disabled]="!puedeGestionar" [attr.aria-label]="'Fecha ' + (i + 1)" /></td>
              <td data-etiqueta="Estado">@if (v.estado) { <span class="chip" [class.ok]="v.estado === 'PAGADO'" [class.error]="v.estado === 'VENCIDO'" [class.alerta]="v.estado === 'PRÓXIMO'">{{ v.estado }}@if (v.estado !== 'PAGADO') { · {{ v.dias }} días }</span> }</td>
              <td>@if (puedeGestionar) { <button class="pequeno peligro" (click)="quitarVenc(i)">Quitar</button> }</td></tr>
          } @empty { <tr><td colspan="5" class="vacio">Sin fechas cargadas</td></tr> }</tbody></table></div>
        @if (puedeGestionar) { <div class="acciones" style="margin-top:10px">
          <button (click)="agregarVenc()"><app-icono nombre="mas" />Agregar fecha</button>
          <button class="primario" [disabled]="trabajando()" (click)="guardarVenc()">Guardar calendario</button></div> }
      }
      @case ('exogena') {
        <div class="barra-mini">
          <div class="campo"><label for="t-anio">Año gravable</label><input id="t-anio" type="number" [(ngModel)]="anio" (change)="cargar()" style="width:110px" /></div>
          <div class="segmentos">@for (f of formatos; track f[0]) { <button type="button" [class.activo]="formato() === f[0]" (click)="formato.set(f[0]); cargar()">{{ f[1] }}</button> }</div>
          <button class="pequeno" (click)="excelExogena()"><app-icono nombre="descargar" [tam]="14" />Excel</button>
        </div>
        @if (exo(); as x) {
          <h3>{{ x.titulo }}</h3>
          <div class="tabla-caja"><table><thead><tr>@for (c of x.columnas; track c) { <th>{{ c }}</th> }</tr></thead>
            <tbody>@for (f of x.filas; track $index) { <tr>@for (v of f; track $index) { <td [class.num]="esNumero(v)">{{ esNumero(v) ? (v | pesos) : v }}</td> }</tr> }
            @empty { <tr><td [attr.colspan]="x.columnas.length" class="vacio">Sin datos en el año</td></tr> }</tbody></table></div>
          <p class="sutil">Borrador para el prevalidador de la DIAN. Revise conceptos, direcciones y municipios de cada tercero antes de presentarlo.</p>
        }
      }
      @case ('certificados') {
        <div class="barra-mini"><div class="campo"><label for="t-anio2">Año gravable</label><input id="t-anio2" type="number" [(ngModel)]="anio" (change)="cargar()" style="width:110px" /></div></div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>NIT</th><th>Proveedor</th><th class="num">Base</th><th class="num">Retefuente</th><th class="num">ReteIVA</th><th class="num">ReteICA</th><th></th></tr></thead>
          <tbody>@for (c of certs(); track c.nit) {
            <tr><td data-etiqueta="NIT">{{ c.nit }}</td><td data-etiqueta="Proveedor">{{ c.nombre }}</td><td data-etiqueta="Base" class="num">{{ c.base | pesos }}</td>
              <td data-etiqueta="Retefuente" class="num">{{ c.retefuente | pesos }}</td><td data-etiqueta="ReteIVA" class="num">{{ c.reteIva | pesos }}</td><td data-etiqueta="ReteICA" class="num">{{ c.reteIca | pesos }}</td>
              <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
                @if (c.retefuente) { <button class="pequeno primario" (click)="visor.ver('/gestion/tributario/certificados/' + c.nit, 'Certificado fuente · ' + c.nombre, { anio: anio, tipo: 'fuente', ver: 1 })">Fuente</button> }
                @if (c.reteIva) { <button class="pequeno" (click)="visor.ver('/gestion/tributario/certificados/' + c.nit, 'Certificado iva · ' + c.nombre, { anio: anio, tipo: 'iva', ver: 1 })">IVA</button> }
                @if (c.reteIca) { <button class="pequeno" (click)="visor.ver('/gestion/tributario/certificados/' + c.nit, 'Certificado ica · ' + c.nombre, { anio: anio, tipo: 'ica', ver: 1 })">ICA</button> }</div></td></tr>
          } @empty { <tr><td colspan="7" class="vacio">No se practicaron retenciones en el año</td></tr> }</tbody></table></div>
      }
      @case ('fe') {
        <p class="sutil">Factura electrónica de transporte: descargue la relación de remesas (archivo plano del RNDC, Guía V11) para el proveedor tecnológico.
          Cuando la DIAN valide la factura, cargue el XML que le entrega el proveedor (AttachedDocument): la plataforma lo revisa contra la factura y sus remesas
          y lo registra en el RNDC (proceso 86).</p>
        @if (feRndc(); as e) {
          <div class="panel-mini">
            <div><span>RNDC</span><strong>{{ e.ambiente }}</strong></div>
            <div><span>Contraseña guardada</span><strong>{{ e.claveGuardada ? 'Sí' : e.claveInvalida ? 'Rechazada' : 'No' }}</strong></div>
            <div><span>Pendientes de enviar</span><strong>{{ e.pendientes }}</strong></div>
            <div><span>Envío automático</span><strong>{{ e.automatico ? 'Activo' : 'Apagado' }}</strong>
              @if (esAdmin) { <button class="pequeno" (click)="cambiarAutomatico(!e.automatico)">{{ e.automatico ? 'Apagar' : 'Activar' }}</button> }</div>
          </div>
          @if (e.automatico && !e.claveGuardada) { <p class="sutil">El envío automático necesita la contraseña del RNDC guardada (Configuración &gt; RNDC).</p> }
        }
        <input #archivoXml type="file" accept=".xml,text/xml,application/xml" hidden (change)="leerXml($event)" />
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th class="num">Total</th><th>Factura electrónica</th><th>RNDC</th><th></th></tr></thead>
          <tbody>@for (f of facturas(); track f._id) {
            <tr><td data-etiqueta="Factura">{{ f.numero }}</td><td data-etiqueta="Fecha">{{ f.fecha | dia }}</td><td data-etiqueta="Cliente">{{ f.cliente?.nombre }}</td>
              <td data-etiqueta="Total" class="num">{{ f.total | pesos }}</td>
              <td data-etiqueta="FE">@if (f.fe?.cufe) { <span class="chip ok">{{ f.fe.numero }}</span> } @else { <span class="chip alerta">Sin CUFE</span> }</td>
              <td data-etiqueta="RNDC">@if (f.fe?.rndc?.estado) { <span class="chip" [class.ok]="f.fe.rndc.estado === 'ACEPTADA'" [class.error]="f.fe.rndc.estado === 'RECHAZADA' || f.fe.rndc.estado === 'ERROR'"
                  [class.alerta]="f.fe.rndc.estado === 'PENDIENTE' || f.fe.rndc.estado === 'ERROR_CONEXION'">{{ nombreEstadoRndc(f.fe.rndc.estado) }}</span>
                @if (f.fe.rndc.radicado) { <small class="sutil" style="display:block">Radicado {{ f.fe.rndc.radicado }}</small> }
                @if (f.fe.rndc.mensaje) { <small class="sutil" style="display:block" [title]="f.fe.rndc.mensaje">{{ f.fe.rndc.mensaje.slice(0, 90) }}</small> } } @else { <span class="sutil">—</span> }</td>
              <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
                @if (puedeGestionar) { <button class="pequeno" (click)="abrirFe(f)">Datos DIAN</button> }
                @if (puedeGestionar && f.fe?.rndc?.estado !== 'ACEPTADA') { <button class="pequeno" (click)="escogerXml(f, archivoXml)" [disabled]="trabajando()">Cargar XML DIAN</button> }
                @if (puedeGestionar && enviable(f)) { <button class="pequeno primario" (click)="enviarRndc(f)" [disabled]="trabajando()">Enviar al RNDC</button> }
                <button class="pequeno primario" (click)="relacion(f, 'txt')">Relación .txt</button>
                <button class="pequeno" (click)="relacion(f, 'xlsx')">Excel</button></div></td></tr>
          } @empty { <tr><td colspan="7" class="vacio">Sin facturas</td></tr> }</tbody></table></div>
      }
    }

    <app-modal titulo="Registrar pago de impuestos" [abierto]="!!pago()" (cerrar)="pago.set(null)">
      @if (pago(); as p) {
        <form id="form-pago-imp" class="formulario" style="grid-template-columns:1fr 1fr" (ngSubmit)="guardarPago()">
          <div class="campo"><label for="pi-f">Fecha del pago</label><input id="pi-f" type="date" name="f" [(ngModel)]="p.fecha" required /></div>
          <div class="campo"><label for="pi-p">Periodo</label><input id="pi-p" name="p" [(ngModel)]="p.periodo" required /></div>
          <div class="campo"><label for="pi-n">N.° de formulario</label><input id="pi-n" name="n" [(ngModel)]="p.formulario" /></div>
          <div class="campo"><label for="pi-c">Sale de</label><select id="pi-c" name="c" [(ngModel)]="p.cuenta"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option></select></div>
          @for (i of p.items; track i.tipo) {
            <div class="campo"><label [attr.for]="'pi-' + i.tipo">{{ nombreObligacion(i.tipo) }}</label><div class="moneda"><input [id]="'pi-' + i.tipo" moneda [name]="'v' + i.tipo" [(ngModel)]="i.valor" /></div></div>
          }
          <div class="campo"><label for="pi-i">Intereses de mora</label><div class="moneda"><input id="pi-i" moneda name="i" [(ngModel)]="p.intereses" /></div></div>
          <div class="campo"><label for="pi-s">Sanción</label><div class="moneda"><input id="pi-s" moneda name="s" [(ngModel)]="p.sancion" /></div></div>
        </form>
        <p class="sutil">Asiento: débito a la cuenta por pagar de cada impuesto, intereses a 530520, sanción a 5315 y crédito a bancos o caja.</p>
      }
      <ng-container pie><button type="button" (click)="pago.set(null)">Cancelar</button><button class="primario" type="submit" form="form-pago-imp" [disabled]="trabajando()">Registrar pago</button></ng-container>
    </app-modal>

    <app-modal titulo="Enviar la factura al RNDC" [abierto]="!!envio()" (cerrar)="envio.set(null)">
      @if (envio(); as e) {
        <form id="form-env-rndc" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="confirmarEnvio()">
          <p class="sutil">La empresa no tiene guardada la contraseña del RNDC. Escriba la del usuario {{ feRndc()?.usuarioRndc }}: se usa solo para este envío y no se guarda.</p>
          <div class="campo"><label for="er-c">Contraseña del RNDC</label><input id="er-c" type="password" name="c" autocomplete="off" [(ngModel)]="e.clave" required /></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="envio.set(null)">Cancelar</button><button class="primario" type="submit" form="form-env-rndc" [disabled]="trabajando()">Enviar</button></ng-container>
    </app-modal>

    <app-modal titulo="Datos de la factura electrónica" [abierto]="!!fe()" (cerrar)="fe.set(null)">
      @if (fe(); as f) {
        <form id="form-fe" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="guardarFe()">
          <div class="campo"><label for="fe-n">Número de la factura en la DIAN ({{ f.factura }})</label><input id="fe-n" name="n" [(ngModel)]="f.numero" placeholder="FETR1234" /></div>
          <div class="campo"><label for="fe-c">CUFE (96 caracteres)</label><input id="fe-c" name="c" [(ngModel)]="f.cufe" maxlength="96" /></div>
          <div class="campo"><label for="fe-t">Tipo de operación</label><select id="fe-t" name="t" [(ngModel)]="f.tipoOperacion">
            <option value="12">12 · Servicio de transporte de carga</option><option value="13">13 · Mandato (facturación por cuenta de terceros)</option></select></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="fe.set(null)">Cancelar</button><button class="primario" type="submit" form="form-fe" [disabled]="trabajando()">Guardar</button></ng-container>
    </app-modal>`,
  styles: [`
    .barra-mini { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-bottom: 12px; }
    tr.total td { font-weight: 700; background: var(--gris-1); }
    h3 { margin: 14px 0 6px; }
    .panel-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 10px 0; }
    .panel-mini > div { padding: 8px 10px; border: 1px solid var(--gris-2); border-radius: var(--radio); display: flex; flex-direction: column; gap: 2px; }
    .panel-mini span { font-size: 12px; color: var(--gris-5); } .panel-mini strong { font-variant-numeric: tabular-nums; }
  `],
})
export class TributarioCont {
  private api = inject(Api); private avisos = inject(Avisos);
  private auth = inject(Auth);
  readonly puedeGestionar = this.auth.tiene(P.CONTABILIDAD_GESTIONAR);
  readonly esAdmin = this.auth.tiene(P.CONFIG_GESTIONAR);
  readonly secciones: [Seccion, string][] = [['350', 'Retención (350)'], ['ica', 'ICA y ReteICA'], ['vencimientos', 'Vencimientos'], ['exogena', 'Exógena'],
    ['certificados', 'Certificados'], ['fe', 'Factura electrónica · RNDC']];
  readonly formatos: [string, string][] = [['1001', '1001 Pagos'], ['1007', '1007 Ingresos'], ['1008', '1008 Por cobrar'], ['1009', '1009 Por pagar']];
  readonly obligaciones = OBLIGACIONES;
  readonly seccion = signal<Seccion>('350');
  readonly formato = signal('1001');
  readonly trabajando = signal(false);
  readonly d350 = signal<any>(null); readonly ica = signal<any>(null); readonly reteica = signal<any>(null);
  readonly venc = signal<any[]>([]); readonly exo = signal<any>(null); readonly certs = signal<any[]>([]); readonly facturas = signal<any[]>([]);
  readonly pago = signal<any>(null); readonly fe = signal<any>(null);
  readonly feRndc = signal<any>(null); readonly envio = signal<any>(null);
  private xmlPara: any = null;
  readonly proximos = computed(() => this.venc().filter(v => v.estado === 'VENCIDO' || v.estado === 'PRÓXIMO'));
  mes = mesAnterior(); anio = new Date().getFullYear() - 1;
  desde = `${new Date().getFullYear()}-01-01`; hasta = hoyIso();
  icaParam = { icaTarifaPorMil: 0, avisosTablerosPct: 15, sobretasaBomberilPct: 0 };

  constructor() {
    this.cargarVenc(); this.cargar();
    this.api.get<any>('/gestion/contabilidad/parametros').then(p => { this.icaParam = { icaTarifaPorMil: p.icaTarifaPorMil, avisosTablerosPct: p.avisosTablerosPct, sobretasaBomberilPct: p.sobretasaBomberilPct }; }).catch(() => {});
  }
  ir(s: Seccion) { this.seccion.set(s); this.cargar(); }
  nombreObligacion(k: string) { return OBLIGACIONES.find(o => o[0] === k)?.[1] || k; }
  esNumero(v: unknown) { return typeof v === 'number'; }
  async cargar() {
    try {
      const s = this.seccion();
      if (s === '350') this.d350.set(await this.api.get('/gestion/tributario/350', { mes: this.mes }));
      if (s === 'ica') {
        const r = { desde: this.desde, hasta: this.hasta };
        const [i, ri] = await Promise.all([this.api.get('/gestion/tributario/ica', r), this.api.get('/gestion/tributario/reteica', r)]);
        this.ica.set(i); this.reteica.set(ri);
      }
      if (s === 'exogena') this.exo.set(await this.api.get(`/gestion/tributario/exogena/${this.formato()}`, { anio: this.anio }));
      if (s === 'certificados') this.certs.set(await this.api.get('/gestion/tributario/certificados', { anio: this.anio }));
      if (s === 'fe') {
        const [fs, e] = await Promise.all([this.api.get<any[]>('/gestion/contabilidad/facturas'), this.api.get<any>('/gestion/tributario/fe/rndc')]);
        this.facturas.set(fs.filter(f => f.estado !== 'ANULADA')); this.feRndc.set(e);
      }
    } catch (e) { this.avisos.error(e); }
  }
  private conIso(l: any[]) { return l.map(v => ({ ...v, fechaIso: String(v.fecha || '').slice(0, 10) })); }
  async cargarVenc() { try { this.venc.set(this.conIso(await this.api.get<any[]>('/gestion/tributario/vencimientos'))); } catch { /* sin permiso */ } }
  agregarVenc() { this.venc.set([...this.venc(), { obligacion: 'retefuente', periodo: this.mes, fechaIso: '' }]); }
  quitarVenc(i: number) { const l = [...this.venc()]; l.splice(i, 1); this.venc.set(l); }
  async guardarVenc() {
    const lista = this.venc().filter(v => v.fechaIso && v.periodo).map(v => ({ obligacion: v.obligacion, periodo: v.periodo, fecha: v.fechaIso }));
    this.trabajando.set(true);
    try { this.venc.set(this.conIso(await this.api.put<any[]>('/gestion/tributario/vencimientos', { vencimientos: lista }))); this.avisos.ok('Calendario guardado'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async guardarIca() {
    try { await this.api.put('/gestion/tributario/ica/parametros', this.icaParam); this.avisos.ok('Tarifa de ICA guardada'); this.cargar(); } catch (e) { this.avisos.error(e); }
  }
  abrirPago(tipo: '350' | 'reteica' | 'ica') {
    const b = this.d350();
    const items = tipo === '350' ? [{ tipo: 'retefuente', valor: b?.totalRenta || 0 }, { tipo: 'reteiva', valor: b?.reteIva || 0 }]
      : tipo === 'reteica' ? [{ tipo: 'reteica', valor: this.reteica()?.total || 0 }] : [{ tipo: 'ica', valor: this.ica()?.aPagar || 0 }];
    const periodo = tipo === '350' ? this.mes : `${this.desde.slice(0, 7)}_${this.hasta.slice(0, 7)}`;
    this.pago.set({ fecha: hoyIso(), periodo, formulario: '', cuenta: '1110', intereses: 0, sancion: 0, items });
  }
  async guardarPago() {
    const p = this.pago(); this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/gestion/tributario/pagos', { ...p, items: p.items.filter((i: any) => Number(i.valor) > 0) });
      this.avisos.ok(`Pago registrado (asiento ${r.asiento})`); this.pago.set(null); this.cargar(); this.cargarVenc();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async excelExogena() {
    try { await this.api.descargar(`/gestion/tributario/exogena/${this.formato()}`, { anio: this.anio, formato: 'xlsx' }, `Exogena_${this.formato()}_${this.anio}.xlsx`); } catch (e) { this.avisos.error(e); }
  }
  abrirFe(f: any) { this.fe.set({ factura: f.numero, numero: f.fe?.numero || '', cufe: f.fe?.cufe || '', tipoOperacion: f.fe?.tipoOperacion || '12' }); }
  async guardarFe() {
    const f = this.fe(); this.trabajando.set(true);
    try { await this.api.put(`/gestion/tributario/facturas/${f.factura}/fe`, { numero: f.numero, cufe: f.cufe, tipoOperacion: f.tipoOperacion }); this.avisos.ok('Datos de la factura electrónica guardados'); this.fe.set(null); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  // ── Registro en el RNDC (proceso 86) ──
  nombreEstadoRndc(e: string) {
    return ({ PENDIENTE: 'Por enviar', ERROR_CONEXION: 'Sin conexión, se reintenta', ACEPTADA: 'Registrada', RECHAZADA: 'Rechazada', ERROR: 'No se pudo enviar' } as Record<string, string>)[e] || e;
  }
  enviable(f: any) { return ['PENDIENTE', 'ERROR_CONEXION', 'RECHAZADA', 'ERROR'].includes(f.fe?.rndc?.estado); }
  escogerXml(f: any, input: HTMLInputElement) { this.xmlPara = f; input.value = ''; input.click(); }
  async leerXml(ev: Event) {
    const archivo = (ev.target as HTMLInputElement).files?.[0]; const f = this.xmlPara;
    if (!archivo || !f) return;
    if (archivo.size > 800 * 1024) { this.avisos.error('El XML pesa más de 800 KB: no parece el AttachedDocument de una factura'); return; }
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/gestion/tributario/facturas/${f.numero}/fe/xml`, { xml: await archivo.text() });
      this.avisos.ok(`XML de la factura ${r.numeroFe} revisado (${r.remesas} remesas): listo para el RNDC`);
      for (const a of r.avisos || []) this.avisos.error(a);
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  enviarRndc(f: any) {
    if (this.feRndc()?.claveGuardada) this.mandar(f.numero, {});
    else this.envio.set({ numero: f.numero, clave: '' });
  }
  confirmarEnvio() { const e = this.envio(); this.envio.set(null); this.mandar(e.numero, { clave: e.clave }); }
  private async mandar(numero: string, cuerpo: any) {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/gestion/tributario/facturas/${numero}/fe/rndc`, cuerpo);
      if (r.estado === 'ACEPTADA') this.avisos.ok(`Factura ${r.numeroFe || numero} registrada en el RNDC (radicado ${r.radicado})`);
      else this.avisos.error(`${this.nombreEstadoRndc(r.estado)}: ${r.mensaje}`);
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async cambiarAutomatico(automatico: boolean) {
    try { this.feRndc.set(await this.api.put<any>('/gestion/tributario/fe/rndc', { automatico })); this.avisos.ok(automatico ? 'Envío automático activado' : 'Envío automático apagado'); }
    catch (e) { this.avisos.error(e); }
  }
  async relacion(f: any, formato: 'txt' | 'xlsx') {
    try {
      const x = await this.api.get<any>(`/gestion/tributario/facturas/${f.numero}/relacion-remesas`);
      for (const a of x.avisos) this.avisos.error(a);
      await this.api.descargar(`/gestion/tributario/facturas/${f.numero}/relacion-remesas`, { formato }, `RELACION_REMESAS_${f.fe?.numero || f.numero}.${formato}`);
    } catch (e) { this.avisos.error(e); }
  }
}
