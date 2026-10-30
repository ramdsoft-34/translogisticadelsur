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

type Pestana = 'resumen' | 'diario' | 'facturas' | 'pagos' | 'informes' | 'plan' | 'saldos' | 'parametros' | 'cierre';
const INFORMES: [string, string][] = [['balance', 'Balance general'], ['resultados', 'Estado de resultados'], ['mayor', 'Libro mayor'], ['auxiliar', 'Auxiliar por cuenta'],
  ['cxc', 'Cuentas por cobrar'], ['cartera', 'Cartera por edades'], ['cxp', 'Cuentas por pagar'], ['retenciones', 'Retenciones'], ['diario', 'Libro diario']];
// Orígenes de asiento que se pueden anular desde el libro diario (los de documentos se anulan desde su documento)
const ANULABLES = ['MAN', 'GAS', 'COB', 'PAG', 'SI'];

// Contabilidad simplificada (apoyo administrativo; un contador debe revisarla).
// Los asientos de liquidaciones, préstamos y abonos se hacen solos; aquí se facturan, cobran y pagan y se registran gastos.
import { CierreMes } from './gestion-varios';
// Valor de una celda pegada de Excel: «1.234.567», «1234567,00» o «$ 1.234.567» → 1234567
const aNumero = (v: string | undefined) => { const t = String(v || '').replace(/[$\s]/g, '').replace(/,\d{1,2}$/, '').replace(/[.,]/g, ''); return Number(t) || 0; };
@Component({
  selector: 'app-contabilidad',
  imports: [FormsModule, Icono, MenuAcciones, Modal, Moneda, Confirmar, CierreMes, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Contabilidad</h1>
      <p class="sutil">Partida doble: facturas a clientes, cobros, pagos a conductores, gastos, libros e informes.
        @if (parametros().modeloIngresos === 'terceros') { Modelo de <strong>ingresos para terceros</strong> (2815 + comisión 4145). } Debe revisarla un contador.</p></div>
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
      @if (pestana() === 'informes' && tipoInforme() === 'auxiliar') {
        <div class="campo"><label for="c-cta">Cuenta</label><select id="c-cta" [(ngModel)]="cuentaAux" (change)="cargar()">
          @for (c of cuentas(); track c.codigo) { <option [value]="c.codigo">{{ c.codigo }} {{ c.nombre }}</option> }</select></div>
        <div class="campo"><label for="c-ter">NIT / cédula (opcional)</label><input id="c-ter" inputmode="numeric" [(ngModel)]="terceroAux" (change)="cargar()" placeholder="Todos los terceros" /></div>
      }
      @if (pestana() === 'informes' && tipoInforme() === 'mayor') {
        <div class="campo"><label for="c-niv">Nivel</label><select id="c-niv" [(ngModel)]="nivelMayor" (change)="cargar()">
          <option value="1">Clase</option><option value="2">Grupo</option><option value="4">Cuenta</option><option value="6">Subcuenta</option></select></div>
      }
      <div class="campo crece"><label for="c-q">Buscar</label><input id="c-q" type="search" placeholder="Número, tercero, cuenta o concepto" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
    </section>

    @switch (pestana()) {
      @case ('resumen') {
        @if (resumen(); as r) {
          <div class="panel-resumen">
            <div><span>Por cobrar</span><strong>{{ r.porCobrar | pesos }}</strong><small>{{ r.facturasPendientes }} factura(s) pendientes</small></div>
            <div><span>Por pagar a conductores</span><strong>{{ r.porPagar | pesos }}</strong><small>{{ r.liquidacionesPendientes }} liquidación(es)</small></div>
            <div><span>Facturado en el periodo</span><strong>{{ r.facturado | pesos }}</strong><small>{{ r.facturas }} factura(s)</small></div>
            <div><span>Cobrado en el periodo</span><strong>{{ r.cobrado | pesos }}</strong></div>
            <div><span>Pagado a conductores</span><strong>{{ r.pagadoConductores | pesos }}</strong></div>
            <div><span>Gastos</span><strong>{{ r.gastos | pesos }}</strong><small>Costos {{ r.costos | pesos }}</small></div>
            <div><span>{{ parametros().tipoSociedad === 'COOPERATIVA' ? 'Excedente' : 'Utilidad' }} del periodo</span><strong [class.negativo]="r.excedente < 0">{{ r.excedente | pesos }}</strong><small>Ingresos {{ r.ingresos | pesos }}</small></div>
            <div><span>Cartera vencida (+30 días)</span><strong [class.negativo]="r.carteraVencida > 0">{{ r.carteraVencida | pesos }}</strong>
              <small><button class="texto pequeno" (click)="tipoInforme.set('cartera'); ir('informes')">Ver cartera por edades</button></small></div>
          </div>
        }
      }
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
                <td>@if (i === 0 && puedeGestionar && a.estado === 'ACTIVO' && anulables.includes(a.origen)) {
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
              <td data-etiqueta="Periodo">{{ f.desde | dia }} – {{ f.hasta | dia }} ({{ f.viajes }} viajes)</td><td data-etiqueta="Total" class="num">{{ f.total | pesos }}
                @if (f.modeloIngresos === 'terceros') { <small class="sutil" style="display:block">Terceros {{ f.terceros | pesos }} · propio {{ f.propio | pesos }}</small> }</td>
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
      @case ('saldos') {
        <p class="sutil">Saldos de la contabilidad anterior a la fecha de corte: bancos, cartera por factura y cliente, cuentas por pagar por tercero, activos y patrimonio.
          Copie de Excel las columnas <strong>Cuenta · NIT/cédula · Nombre del tercero · Documento · Débito · Crédito</strong> (una fila por cuenta, tercero y documento) y péguelas aquí.
          Se registra un asiento por tercero y documento; la cuenta puente 3910 queda en cero.</p>
        <div class="formulario" style="grid-template-columns:200px 1fr;align-items:start">
          <div class="campo"><label for="si-f">Fecha de corte</label><input id="si-f" type="date" [(ngModel)]="saldosFecha" /></div>
          <div class="campo"><label for="si-t">Filas pegadas desde Excel</label><textarea id="si-t" rows="6" [ngModel]="saldosTexto()" (ngModelChange)="saldosTexto.set($event)"
            placeholder="1110&#9;&#9;&#9;&#9;5000000&#9;0"></textarea></div>
        </div>
        @if (saldosFilas().length) {
          <div class="tabla-caja" style="margin-top:10px"><table class="tabla-movil">
            <thead><tr><th>Cuenta</th><th>Nombre</th><th>NIT / cédula</th><th>Tercero</th><th>Documento</th><th class="num">Débito</th><th class="num">Crédito</th></tr></thead>
            <tbody>@for (f of saldosFilas(); track $index) {
              <tr><td data-etiqueta="Cuenta">{{ f.cuenta }}</td><td data-etiqueta="Nombre" [class.negativo]="!nombreCuenta(f.cuenta)">{{ nombreCuenta(f.cuenta) || 'No existe en el plan de cuentas' }}</td>
                <td data-etiqueta="NIT">{{ f.terceroDoc }}</td><td data-etiqueta="Tercero">{{ f.tercero }}</td><td data-etiqueta="Documento">{{ f.documento }}</td>
                <td data-etiqueta="Débito" class="num">{{ f.debito ? (f.debito | pesos) : '' }}</td><td data-etiqueta="Crédito" class="num">{{ f.credito ? (f.credito | pesos) : '' }}</td></tr>
            }
            <tr class="total"><td></td><td>Sumas</td><td></td><td></td><td></td><td class="num">{{ saldosTotales().d | pesos }}</td><td class="num">{{ saldosTotales().c | pesos }}</td></tr></tbody></table></div>
          <div class="acciones" style="margin-top:10px">
            @if (saldosTotales().d !== saldosTotales().c) { <span class="chip error">Diferencia {{ saldosTotales().d - saldosTotales().c | pesos }}</span> }
            @if (puedeGestionar) { <button class="primario" [disabled]="trabajando() || saldosTotales().d !== saldosTotales().c" (click)="registrarSaldos()">Registrar saldos iniciales</button> }
          </div>
        }
      }
      @case ('parametros') {
        <div class="formulario" style="max-width:720px;grid-template-columns:1fr">
          <div class="campo"><label for="pa-m">Modelo de ingresos</label>
            <select id="pa-m" [ngModel]="parametros().modeloIngresos" (ngModelChange)="parametros.set({ ...parametros(), modeloIngresos: $event })" [disabled]="!puedeGestionar">
              <option value="bruto">Ingreso bruto: todo lo facturado es ingreso (4135) y el flete del conductor es costo (6155)</option>
              <option value="terceros">Ingresos para terceros: flete y auxiliar del conductor al pasivo 2815; la comisión es ingreso propio (4145)</option>
            </select>
            <small>Ingresos para terceros (art. 102-2 del Estatuto Tributario): la factura lleva el valor total del servicio, pero solo la comisión es ingreso de la empresa.
              La liquidación del conductor cancela el pasivo 2815. El cambio aplica a las facturas y liquidaciones nuevas; confírmelo con el contador.</small></div>
          <div class="campo"><label for="pa-s">Tipo de sociedad</label>
            <select id="pa-s" [ngModel]="parametros().tipoSociedad" (ngModelChange)="parametros.set({ ...parametros(), tipoSociedad: $event })" [disabled]="!puedeGestionar">
              <option value="SAS">S.A.S.</option><option value="LTDA">Limitada</option><option value="SA">Sociedad anónima</option><option value="COOPERATIVA">Cooperativa</option><option value="OTRA">Otra</option></select></div>
          @if (puedeGestionar) { <div class="acciones"><button class="primario" [disabled]="trabajando()" (click)="guardarParametros()">Guardar parámetros</button></div> }
        </div>
      }
      @case ('cierre') { <app-cierre-mes [embebido]="true" /> }
    }

    <app-modal [titulo]="tituloForm()" [abierto]="!!form()" (cerrar)="form.set(null)">
      @if (form(); as fm) {
        <form id="form-cont" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="guardar()">
          @switch (fm.tipo) {
            @case ('factura') {
              <div class="campo"><label for="ff-c">Cliente</label><select id="ff-c" name="c" [(ngModel)]="fm.cliente" (change)="revisarCruces()" required><option value="">Seleccione…</option>
                @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
              <div class="campo"><label for="ff-d">Desde</label><input id="ff-d" type="date" name="d" [(ngModel)]="fm.desde" (change)="revisarCruces()" required /></div>
              <div class="campo"><label for="ff-h">Hasta</label><input id="ff-h" type="date" name="h" [(ngModel)]="fm.hasta" (change)="revisarCruces()" required /></div>
              @if (cruces().length) {
                <div class="mensaje alerta"><strong>El periodo se cruza con otras facturas de este cliente:</strong>
                  <ul>@for (x of cruces(); track x.numero) { <li>{{ x.numero }}: {{ x.desde | dia }} a {{ x.hasta | dia }} ({{ x.neto | pesos }})</li> }</ul>
                  <label class="casilla"><input type="checkbox" name="pc" [(ngModel)]="fm.permitirCruce" />Facturar de todos modos</label></div>
              }
              <div class="acciones"><button type="button" class="pequeno" (click)="cargarViajesFactura()" [disabled]="!fm.cliente">Escoger los viajes uno a uno</button>
                @if (viajesFactura().length) { <span class="sutil">{{ seleccionados().length }} de {{ viajesFactura().length }} viajes · {{ totalSeleccion().cobro | pesos }}</span> }</div>
              @if (viajesFactura().length) {
                <div class="tabla-caja" style="max-height:260px;overflow:auto"><table>
                  <thead><tr><th><input type="checkbox" aria-label="Todos" [checked]="seleccionados().length === viajesFactura().length" (change)="marcarTodos($any($event.target).checked)" /></th>
                    <th>N°</th><th>Fecha</th><th>Placa</th><th>Destino</th><th class="num">Cobro</th><th class="num">Terceros</th><th class="num">Propio</th></tr></thead>
                  <tbody>@for (v of viajesFactura(); track v._id) {
                    <tr><td><input type="checkbox" [attr.aria-label]="'Viaje ' + v.numero" [checked]="marcados().has(v._id)" (change)="marcar(v._id, $any($event.target).checked)" /></td>
                      <td>{{ v.numero }}</td><td>{{ v.fecha | dia }}</td><td>{{ v.placa }}</td><td>{{ v.destino }}</td>
                      <td class="num">{{ v.cobro | pesos }}</td><td class="num">{{ v.terceros | pesos }}</td><td class="num">{{ v.propio | pesos }}</td></tr>
                  }</tbody></table></div>
                <p class="sutil">Total escogido {{ totalSeleccion().cobro | pesos }}@if (modeloViajes() === 'terceros') { · para terceros {{ totalSeleccion().terceros | pesos }} · comisión propia {{ totalSeleccion().propio | pesos }} }.</p>
              }
              <div class="campo"><label for="ff-r">% Retefuente</label><input id="ff-r" type="number" step="0.01" name="r" [(ngModel)]="fm.retefuentePct" /><small>1 = lo normal; aplica a todos los viajes.</small></div>
              <div class="campo"><label for="ff-i">% ReteICA (opcional)</label><input id="ff-i" type="number" step="0.001" name="i" [(ngModel)]="fm.icaPct" /></div>
              <p class="sutil">Suma la tarifa y el auxiliar de los viajes del cliente en el rango (o de los escogidos), según su política de auxiliar. No entran los viajes con «[NO FACTURAR]» ni los ya facturados. Sin IVA.</p>
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
    .panel-resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    .panel-resumen > div { padding: 14px 16px; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-0); display: flex; flex-direction: column; gap: 4px; }
    .panel-resumen span { font-size: 12.5px; color: var(--gris-5); } .panel-resumen strong { font-size: 22px; font-variant-numeric: tabular-nums; }
    .panel-resumen small { color: var(--gris-5); } .negativo { color: var(--rojo); }
  `],
})
export class Contabilidad {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeGestionar = this.auth.tiene(P.CONTABILIDAD_GESTIONAR);
  readonly anulables = ANULABLES;
  readonly pestanas: [Pestana, string][] = [['resumen', 'Resumen'], ['diario', 'Libro diario'], ['facturas', 'Facturas y cobros'], ['pagos', 'Cuentas por pagar'], ['informes', 'Informes'], ['plan', 'Plan de cuentas'], ['saldos', 'Saldos iniciales'], ['parametros', 'Parámetros'], ['cierre', 'Cierre de mes']];
  readonly informes = INFORMES;
  readonly pestana = signal<Pestana>('resumen');
  readonly resumen = signal<any>(null);
  readonly cruces = signal<any[]>([]);
  private retefuenteFactura = 1;
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
  // Parámetros contables, auxiliar y libro mayor
  readonly parametros = signal<{ modeloIngresos: string; tipoSociedad: string }>({ modeloIngresos: 'bruto', tipoSociedad: 'SAS' });
  cuentaAux = '1305'; terceroAux = ''; nivelMayor = '4';
  // Facturar escogiendo viajes
  readonly viajesFactura = signal<any[]>([]);
  readonly marcados = signal<Set<string>>(new Set());
  readonly modeloViajes = signal('bruto');
  readonly seleccionados = computed(() => this.viajesFactura().filter(v => this.marcados().has(v._id)));
  readonly totalSeleccion = computed(() => this.seleccionados().reduce((a, v) => ({ cobro: a.cobro + v.cobro, terceros: a.terceros + v.terceros, propio: a.propio + v.propio }), { cobro: 0, terceros: 0, propio: 0 }));
  // Saldos iniciales pegados desde Excel (tabuladores)
  saldosFecha = `${new Date().getFullYear() - 1}-12-31`;
  readonly saldosTexto = signal('');
  readonly saldosFilas = computed(() => this.saldosTexto().split(/\r?\n/).map(l => l.split('\t')).filter(c => /^\d{4,10}$/.test((c[0] || '').trim()))
    .map(c => ({ cuenta: c[0].trim(), terceroDoc: (c[1] || '').replace(/\D/g, ''), tercero: (c[2] || '').trim(), documento: (c[3] || '').trim(), debito: aNumero(c[4]), credito: aNumero(c[5]) })));
  readonly saldosTotales = computed(() => this.saldosFilas().reduce((a, f) => ({ d: a.d + f.debito, c: a.c + f.credito }), { d: 0, c: 0 }));

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['gestion', 'liquidaciones'], () => this.cargar());

  // Pestaña inicial desde la ruta (p. ej. /cierre-mes abre «Cierre de mes»)
  readonly tab = input<Pestana | ''>('');
  ngOnInit() { if (this.tab()) this.pestana.set(this.tab() as Pestana); this.cargar(); }

  constructor() {
    this.api.get<any[]>('/gestion/contabilidad/cuentas').then(c => this.cuentas.set(c)).catch(() => {});
    this.api.get<any[]>('/maestros/clientes').then(c => this.clientes.set(c)).catch(() => {});
    this.api.get<any>('/gestion/reglas').then(r => { this.retefuenteFactura = r.reglas.retefuenteFacturaPct; }).catch(() => {});
    this.api.get<any>('/gestion/contabilidad/parametros').then(p => this.parametros.set(p)).catch(() => {});
  }
  ir(p: Pestana) { this.pestana.set(p); this.cargar(); }
  async cargar() {
    const per = { desde: this.desde, hasta: this.hasta };
    try {
      if (this.pestana() === 'resumen') this.resumen.set(await this.api.get('/gestion/contabilidad/resumen', per));
      if (this.pestana() === 'diario') this.asientos.set(await this.api.get('/gestion/contabilidad/asientos', per));
      if (this.pestana() === 'facturas') this.facturas.set(await this.api.get('/gestion/contabilidad/facturas'));
      if (this.pestana() === 'pagos') this.informe.set(await this.api.get('/gestion/contabilidad/informes/cxp'));
      if (this.pestana() === 'informes') this.informe.set(await this.api.get(`/gestion/contabilidad/informes/${this.tipoInforme()}`, { ...per, ...this.filtrosInforme() }));
      if (this.pestana() === 'plan') this.cuentas.set(await this.api.get('/gestion/contabilidad/cuentas'));
    } catch (e) { this.avisos.error(e); }
  }
  private filtrosInforme(): Record<string, string> {
    if (this.tipoInforme() === 'auxiliar') return { cuenta: this.cuentaAux, ...(this.terceroAux ? { tercero: this.terceroAux } : {}) };
    if (this.tipoInforme() === 'mayor') return { nivel: this.nivelMayor };
    return {};
  }
  nombreCuenta(c: string) { return this.cuentas().find(x => x.codigo === c)?.nombre || ''; }
  esNumero(v: unknown) { return typeof v === 'number'; }
  esFecha(v: unknown) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v); }
  async excelInforme() {
    try { await this.api.descargar(`/gestion/contabilidad/informes/${this.tipoInforme()}`, { desde: this.desde, hasta: this.hasta, ...this.filtrosInforme(), formato: 'xlsx' }, `${this.tipoInforme()}.xlsx`); }
    catch (e) { this.avisos.error(e); }
  }
  tituloForm() {
    return ({ factura: 'Facturar a un cliente', cobro: 'Registrar cobro', pago: 'Registrar pago al conductor', gasto: 'Registrar gasto', manual: 'Asiento manual', cuenta: 'Agregar cuenta' } as Record<string, string>)[this.form()?.tipo] || '';
  }
  abrir(tipo: string, extra: any = {}) {
    this.cruces.set([]); this.viajesFactura.set([]); this.marcados.set(new Set());
    this.form.set({ tipo, fecha: hoyIso(), desde: this.desde, hasta: this.hasta, retefuentePct: this.retefuenteFactura, icaPct: 0, permitirCruce: false, cuenta: tipo === 'gasto' ? '5195' : '1110',
      formaPago: '1110', debito: '', credito: '', valor: null, concepto: '', tercero: '', centroCosto: '', cliente: '', tipoCuenta: 'GASTO', naturaleza: 'D', ...extra });
  }
  async guardar() {
    const f = this.form();
    const rutas: Record<string, [string, any]> = {
      factura: ['/gestion/contabilidad/facturas', { cliente: f.cliente, desde: f.desde, hasta: f.hasta, retefuentePct: f.retefuentePct, icaPct: f.icaPct, permitirCruce: !!f.permitirCruce,
        ...(this.viajesFactura().length ? { viajes: this.seleccionados().map(v => v._id) } : {}) }],
      cobro: ['/gestion/contabilidad/cobros', { factura: f.factura, valor: f.valor, fecha: f.fecha, cuenta: f.cuenta }],
      pago: ['/gestion/contabilidad/pagos', { liquidacion: f.liquidacion, valor: f.valor, fecha: f.fecha, cuenta: f.cuenta }],
      gasto: ['/gestion/contabilidad/gastos', { fecha: f.fecha, cuenta: f.cuenta, concepto: f.concepto, valor: f.valor, tercero: f.tercero, formaPago: f.formaPago }],
      manual: ['/gestion/contabilidad/asientos', { fecha: f.fecha, debito: f.debito, credito: f.credito, valor: f.valor, concepto: f.concepto, centroCosto: f.centroCosto }],
      cuenta: ['/gestion/contabilidad/cuentas', { codigo: f.codigo, nombre: f.nombre, tipo: f.tipoCuenta, naturaleza: f.naturaleza }],
    };
    const [ruta, cuerpo] = rutas[f.tipo];
    if (f.tipo === 'factura' && this.viajesFactura().length && !this.seleccionados().length) { this.avisos.error('Escoja al menos un viaje'); return; }
    this.trabajando.set(true);
    try {
      await this.api.post(ruta, cuerpo);
      this.avisos.ok('Registrado'); this.form.set(null);
      if (f.tipo === 'cuenta') this.cuentas.set(await this.api.get('/gestion/contabilidad/cuentas'));
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  // Aviso antes de facturar: otras facturas del cliente con fechas que se cruzan
  async revisarCruces() {
    const f = this.form();
    if (!f?.cliente || !f.desde || !f.hasta) { this.cruces.set([]); return; }
    try { this.cruces.set(await this.api.get('/gestion/contabilidad/facturas/cruces', { cliente: f.cliente, desde: f.desde, hasta: f.hasta })); } catch { this.cruces.set([]); }
  }
  // Facturar escogiendo viajes: lista de viajes por facturar del cliente en el rango
  async cargarViajesFactura() {
    const f = this.form(); if (!f?.cliente || !f.desde || !f.hasta) return;
    try {
      const r = await this.api.get<any>('/gestion/contabilidad/facturas/viajes', { cliente: f.cliente, desde: f.desde, hasta: f.hasta });
      this.viajesFactura.set(r.filas); this.modeloViajes.set(r.modelo); this.marcados.set(new Set(r.filas.map((v: any) => v._id)));
      if (!r.filas.length) this.avisos.error('No hay viajes por facturar de ese cliente en el rango');
    } catch (e) { this.avisos.error(e); }
  }
  marcar(id: string, si: boolean) { const m = new Set(this.marcados()); if (si) m.add(id); else m.delete(id); this.marcados.set(m); }
  marcarTodos(si: boolean) { this.marcados.set(new Set(si ? this.viajesFactura().map(v => v._id) : [])); }
  async guardarParametros() {
    this.trabajando.set(true);
    try { this.parametros.set(await this.api.put<any>('/gestion/contabilidad/parametros', this.parametros())); this.avisos.ok('Parámetros guardados'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async registrarSaldos() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/gestion/contabilidad/saldos-iniciales', { fecha: this.saldosFecha, filas: this.saldosFilas() });
      this.avisos.ok(`Saldos iniciales registrados en ${r.asientos.length} asiento(s)`); this.saldosTexto.set('');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularAsiento(a: any) { try { await this.api.post(`/gestion/contabilidad/asientos/${a.numero}/anular`, {}); this.avisos.ok(`Asiento ${a.numero} anulado`); this.cargar(); } catch (e) { this.avisos.error(e); } }
  async anularFactura(f: any) { try { await this.api.post(`/gestion/contabilidad/facturas/${f.numero}/anular`, {}); this.avisos.ok(`Factura ${f.numero} anulada`); this.cargar(); } catch (e) { this.avisos.error(e); } }
}
