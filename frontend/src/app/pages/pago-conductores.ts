import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Moneda } from '../shared/moneda';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';
import { BuscarTercero } from '../shared/buscar-tercero';
import { VisorPdf } from '../shared/visor-pdf';
import { filtrar } from '../shared/filtro';

type Pestana = 'liquidar' | 'liquidaciones' | 'prestamos' | 'relacion';
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Semana de lunes a domingo que contiene la fecha
const semanaDe = (d: Date) => { const l = new Date(d); l.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const dom = new Date(l); dom.setDate(l.getDate() + 6); return [isoLocal(l), isoLocal(dom)]; };
const quincena = () => {
  const h = new Date(); const y = h.getFullYear(); const m = h.getMonth();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return h.getDate() <= 15 ? [iso(new Date(y, m, 1)), iso(new Date(y, m, 15))] : [iso(new Date(y, m, 16)), iso(new Date(y, m + 1, 0))];
};

// Pago a conductores: liquidación por conductor o por placa y empresa, por quincena, semana (lunes a domingo) o mes.
// Neto = flete + auxiliar − anticipo reconocido − retefuente − FOPAT − préstamos (porcentajes en Configuración → Reglas).
// Descuento de préstamos: las cuotas vencidas o el valor que se escoja. Dos liquidaciones por hoja al imprimir.
@Component({
  selector: 'app-pago-conductores',
  imports: [FormsModule, Icono, Modal, Moneda, Confirmar, BuscarTercero, VisorPdf, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Pago a conductores</h1>
      <p class="sutil">Liquide lo que se le paga a cada conductor o placa: flete más auxiliar, menos el anticipo reconocido, la retefuente, el FOPAT y sus préstamos.</p></div></div>
    <app-visor-pdf #visor />

    <div class="pestanas">
      <button [class.activa]="pestana() === 'liquidar'" (click)="ir('liquidar')">Liquidar</button>
      <button [class.activa]="pestana() === 'liquidaciones'" (click)="ir('liquidaciones')">Liquidaciones</button>
      <button [class.activa]="pestana() === 'prestamos'" (click)="ir('prestamos')">Préstamos y descuentos</button>
      <button [class.activa]="pestana() === 'relacion'" (click)="ir('relacion')">Relación de pago</button>
    </div>

    @switch (pestana()) {
      @case ('liquidar') {
        <section class="barra" aria-label="Filtros">
          <div class="campo"><span class="etiqueta">Periodo</span><div class="segmentos">
            <button type="button" [class.activo]="tipoPeriodo === 'quincena'" (click)="periodo('quincena')">Quincena</button>
            <button type="button" [class.activo]="tipoPeriodo === 'semana'" (click)="periodo('semana')">Semana</button>
            <button type="button" [class.activo]="tipoPeriodo === 'mes'" (click)="periodo('mes')">Mes</button></div></div>
          @if (tipoPeriodo === 'semana') {
            <div class="campo"><span class="etiqueta">Lunes a domingo</span><div class="segmentos">
              <button type="button" (click)="moverSemana(-1)" aria-label="Semana anterior">‹</button><button type="button" (click)="moverSemana(1)" aria-label="Semana siguiente">›</button></div></div>
          }
          <div class="campo"><label for="lq-g">Agrupar por</label>
            <select id="lq-g" [(ngModel)]="agrupacion" (change)="cambiarAgrupacion()"><option value="conductor">Conductor</option><option value="placa_empresa">Placa y empresa</option></select></div>
          <div class="campo"><label for="lq-d">Desde</label><input id="lq-d" type="date" [(ngModel)]="f.desde" (change)="calcular()" /></div>
          <div class="campo"><label for="lq-h">Hasta</label><input id="lq-h" type="date" [(ngModel)]="f.hasta" (change)="calcular()" /></div>
          <div class="campo crece"><label for="lq-q">Buscar</label>
            <input id="lq-q" type="search" placeholder="Placa, conductor, empresa o destino (ej. UZC559 corbeta)" [(ngModel)]="f.q" (keyup.enter)="calcular()" (search)="calcular()" /></div>
        </section>
        @if (calc(); as c) {
          @if (grupos().length) {
            <div class="cifras" aria-label="Totales del periodo">
              <div><span>Viajes sin liquidar</span><strong>{{ c.totales.viajes ?? c.lineas.length }}</strong></div>
              <div><span>Flete</span><strong>{{ c.totales.flete | pesos }}</strong></div>
              <div><span>Auxiliar</span><strong>{{ c.totales.auxiliar | pesos }}</strong></div>
              <div><span>Anticipo reconocido</span><strong>{{ c.totales.anticipoReconocido | pesos }}</strong></div>
              <div><span>Retefuente + FOPAT</span><strong>{{ (c.totales.retefuente + c.totales.fopat) | pesos }}</strong></div>
              <div class="destacada"><span>Saldo a pagar</span><strong>{{ c.totales.saldo | pesos }}</strong></div>
            </div>
            @for (g of grupos(); track g.clave) {
              <div class="tarjeta grupo">
                <div class="cab-grupo">
                  <label class="casilla quien"><input type="checkbox" [checked]="todosGrupo(g)" (change)="alternarGrupo(g)" [attr.aria-label]="'Elegir todos los viajes de ' + g.titulo" />
                    <span class="avatar-grupo" aria-hidden="true">{{ iniciales(g.titulo) }}</span>
                    <span><strong>{{ g.titulo }}</strong><small class="sutil">{{ g.subtitulo }}</small></span></label>
                  <span class="chip sin-punto">{{ seleccionGrupo(g).length }} de {{ g.lineas.length }} viaje(s)</span>
                  @if (c.prestamos[g.cedula]; as pr) {
                    @if (pr.total) { <span class="chip alerta sin-punto" [title]="pr.detalle.join(', ')">Préstamo vencido {{ pr.total | pesos }}</span> }
                    @if (puedeGestionar && g.unConductor) {
                      <label class="descuento" title="Vacío = las cuotas vencidas. Máximo lo pendiente del préstamo.">Descontar
                        <span class="moneda"><input moneda [ngModel]="descuentos()[g.clave]" (ngModelChange)="ponerDescuento(g.clave, $event)" [placeholder]="(pr.total | pesos) || '0'" /></span>
                        <small class="sutil">de {{ pr.pendiente | pesos }}</small></label>
                    }
                  }
                  @if (puedeGestionar) {
                    <button class="primario pequeno" (click)="liquidar(g)" [disabled]="trabajando() || !seleccionGrupo(g).length">
                      <app-icono nombre="check" [tam]="15" />Liquidar {{ seleccionGrupo(g).length }} viaje(s)</button>
                  }
                </div>
                <div class="tabla-caja" style="box-shadow:none"><table class="tabla-movil">
                  <thead><tr><th></th><th>Fecha</th><th>Placa</th><th>Empresa</th><th>Destino</th><th>Manifiesto</th>
                    <th class="num">Flete</th><th class="num">Auxiliar</th><th class="num" title="Anticipo que se descuenta: 0 si es igual o mayor al flete en Pasto, Mayorista o Popayán">Anticipo</th>
                    <th class="num" title="Flete + auxiliar − anticipo reconocido">Saldo</th></tr></thead>
                  <tbody>@for (l of g.lineas; track l.viaje) {
                    <tr><td data-etiqueta="Elegir"><input type="checkbox" [checked]="sel().has(l.viaje)" (change)="alternar(l.viaje)" [attr.aria-label]="'Viaje ' + l.numero" /></td>
                      <td data-etiqueta="Fecha">{{ l.fecha | dia }}</td><td data-etiqueta="Placa">{{ l.placa }}</td><td data-etiqueta="Empresa">{{ l.empresa }}</td>
                      <td data-etiqueta="Destino">{{ l.destino }}</td><td data-etiqueta="Manifiesto">{{ l.manifiesto }}</td>
                      <td data-etiqueta="Flete" class="num">{{ l.flete | pesos }}</td><td data-etiqueta="Auxiliar" class="num">{{ l.auxiliar | pesos }}</td>
                      <td data-etiqueta="Anticipo" class="num">@if (l.anticipoReconocido !== l.anticipo) { <s class="sutil" title="No se descuenta: pago completo en Pasto, Mayorista o Popayán">{{ l.anticipo | pesos }}</s><br /> }{{ l.anticipoReconocido | pesos }}</td>
                      <td data-etiqueta="Saldo" class="num"><strong>{{ (l.flete + l.auxiliar - l.anticipoReconocido) | pesos }}</strong></td></tr>
                  }</tbody>
                  @if (totalesGrupo(g); as t) {
                    <tfoot><tr><td></td><td colspan="5">Elegidos ({{ t.viajes }})</td><td class="num">{{ t.flete | pesos }}</td><td class="num">{{ t.auxiliar | pesos }}</td>
                      <td class="num">{{ t.anticipo | pesos }}</td><td class="num">{{ t.saldos | pesos }}</td></tr></tfoot>
                  }</table></div>
                @if (totalesGrupo(g); as t) {
                  <dl class="resumen-liq">
                    <div><dt>(+) Saldos</dt><dd>{{ t.saldos | pesos }}</dd></div>
                    <div><dt>(−) Retefuente</dt><dd>{{ t.retefuente | pesos }}</dd></div>
                    <div><dt>(−) FOPAT</dt><dd>{{ t.fopat | pesos }}</dd></div>
                    @if (descuentoGrupo(g); as d) { <div><dt>(−) Préstamo</dt><dd>{{ d | pesos }}</dd></div> }
                    <div class="neto"><dt>Neto a pagar</dt><dd>{{ (t.saldos - t.retefuente - t.fopat - descuentoGrupo(g)) | pesos }}</dd></div>
                  </dl>
                }
              </div>
            }
          } @else { <p class="vacio">No hay viajes sin liquidar en ese periodo.</p> }
        }
      }

      @case ('liquidaciones') {
        @if (resumenLiq(); as r) {
          <div class="cifras" aria-label="Resumen de liquidaciones">
            <div><span>Liquidaciones vigentes</span><strong>{{ r.vigentes }}</strong></div>
            <div><span>Neto liquidado</span><strong>{{ r.neto | pesos }}</strong></div>
            <div><span>Pagado</span><strong>{{ r.pagado | pesos }}</strong></div>
            <div class="destacada"><span>Por pagar</span><strong>{{ r.porPagar | pesos }}</strong></div>
          </div>
        }
        <div class="acciones" style="margin-bottom:12px">
          <div class="filtro-rapido" style="margin:0"><input type="search" placeholder="Buscar N°, conductor, placa o cédula" [value]="q()" (input)="q.set($any($event.target).value)" aria-label="Buscar liquidaciones" /></div>
          <button style="margin-left:auto" [disabled]="!selLiq().size" (click)="imprimirLote()"><app-icono nombre="ojo" [tam]="15" />Imprimir {{ selLiq().size || '' }} (dos por hoja)</button>
        </div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th><input type="checkbox" aria-label="Elegir todas" [checked]="todasLiq()" (change)="alternarTodasLiq()" /></th><th>N°</th><th>Conductor</th><th>Placa</th><th>Periodo</th><th class="num">Flete + auxiliar</th><th class="num">Desc. préstamos</th>
            <th class="num">Neto</th><th class="num">Por pagar</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (l of liquidacionesVisibles(); track l._id) {
            <tr><td data-etiqueta="Elegir"><input type="checkbox" [checked]="selLiq().has(l.numero)" (change)="alternarLiq(l.numero)" [attr.aria-label]="'Liquidación ' + l.numero" /></td>
              <td data-etiqueta="N°"><strong class="num-liq">{{ l.numero }}</strong><br /><span class="sutil">{{ l.fecha | dia }}</span></td>
              <td data-etiqueta="Conductor">{{ l.conductorNombre }}@if (l.cedula) { <br /><span class="sutil">C.C. {{ l.cedula }}</span> }</td>
              <td data-etiqueta="Placa"><span class="placa">{{ l.placa }}</span></td>
              <td data-etiqueta="Periodo">{{ l.desde | dia }} – {{ l.hasta | dia }}<br /><span class="sutil">{{ l.viajes?.length || 0 }} viaje(s) · {{ l.empresas }}</span></td>
              <td data-etiqueta="Flete + auxiliar" class="num">{{ (l.flete + (l.auxiliar || 0)) | pesos }}</td><td data-etiqueta="Desc. préstamos" class="num">{{ l.descuentoPrestamos | pesos }}</td>
              <td data-etiqueta="Neto" class="num"><strong>{{ l.neto | pesos }}</strong></td>
              <td data-etiqueta="Por pagar" class="num">{{ (l.estado === 'ANULADA' ? 0 : l.neto - (l.pagado || 0)) | pesos }}</td>
              <td data-etiqueta="Estado"><span class="chip" [class]="estadoPago(l)[1]">{{ estadoPago(l)[0] }}</span></td>
              <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
                <button class="pequeno primario" (click)="visor.ver('/gestion/liq-conductores/' + l.numero + '/pdf', 'Liquidación ' + l.numero, { ver: 1 })"><app-icono nombre="ojo" [tam]="15" />Ver</button>
                <button class="pequeno" (click)="excel('/gestion/liq-conductores/' + l.numero + '/xlsx', l.numero + '.xlsx')">Excel</button>
                @if (puedeGestionar && l.estado === 'VIGENTE' && !l.pagado) { <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularLiq(l)">Anular</button> }
              </div></td></tr>
          } @empty { <tr><td colspan="11" class="vacio">Aún no hay liquidaciones de conductores</td></tr> }</tbody></table></div>
      }

      @case ('prestamos') {
        <div class="acciones" style="margin-bottom:12px">
          <div class="filtro-rapido" style="margin:0"><input type="search" placeholder="Buscar conductor, cédula o concepto" [value]="qp()" (input)="qp.set($any($event.target).value)" aria-label="Buscar préstamos" /></div>
          <select aria-label="Estado" [value]="estadoP()" (change)="estadoP.set($any($event.target).value)"><option value="">Todos</option><option value="VIGENTE">Vigentes</option><option value="PAGADO">Pagados</option><option value="ANULADO">Anulados</option></select>
          @if (puedeGestionar) { <button class="primario" style="margin-left:auto" (click)="nuevoPrestamo()"><app-icono nombre="mas" />Nuevo préstamo o descuento</button> }
        </div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>N°</th><th>Fecha</th><th>Conductor</th><th>Concepto</th><th class="num">Capital</th><th>Cuotas</th><th class="num">Pagado</th><th class="num">Pendiente</th><th>Próxima</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (p of prestamosVisibles(); track p._id) {
            <tr><td data-etiqueta="N°">{{ p.numero }}</td><td data-etiqueta="Fecha">{{ p.fecha | dia }}</td><td data-etiqueta="Conductor">{{ p.conductorNombre }}<br /><span class="sutil">{{ p.cedula }}</span></td>
              <td data-etiqueta="Concepto">{{ p.concepto }}</td><td data-etiqueta="Capital" class="num">{{ p.capital | pesos }}</td>
              <td data-etiqueta="Cuotas">{{ p.nCuotas }} × {{ p.valorCuota | pesos }} ({{ p.tasaMensual }} %)</td>
              <td data-etiqueta="Pagado" class="num">{{ p.resumen.pagado | pesos }}</td><td data-etiqueta="Pendiente" class="num"><strong>{{ p.resumen.pendiente | pesos }}</strong></td>
              <td data-etiqueta="Próxima">{{ p.resumen.proxima ? (p.resumen.proxima | dia) : '—' }}</td>
              <td data-etiqueta="Estado"><span class="chip" [class.ok]="p.estado === 'PAGADO'" [class.alerta]="p.estado === 'VIGENTE'" [class.error]="p.estado === 'ANULADO'">{{ p.estado }}</span></td>
              <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
                <button class="pequeno" (click)="visor.ver('/gestion/prestamos/' + p.numero + '/pdf', 'Estado de cuenta ' + p.numero, { ver: 1 })"><app-icono nombre="ojo" [tam]="15" />Estado de cuenta</button>
                @if (puedeGestionar && p.estado === 'VIGENTE') {
                  <button class="pequeno" (click)="abrirAbono(p)">Abonar</button>
                  @if (!p.abonos.length) { <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularPrestamo(p)">Anular</button> }
                }
              </div></td></tr>
          } @empty { <tr><td colspan="11" class="vacio">No hay préstamos</td></tr> }</tbody></table></div>
      }

      @case ('relacion') {
        <section class="barra" aria-label="Periodo">
          <div class="campo"><label for="rp-d">Desde</label><input id="rp-d" type="date" [(ngModel)]="f.desde" (change)="cargarRelacion()" /></div>
          <div class="campo"><label for="rp-h">Hasta</label><input id="rp-h" type="date" [(ngModel)]="f.hasta" (change)="cargarRelacion()" /></div>
          <button (click)="visor.ver('/gestion/relaciones/pago-conductores', 'Relación de pago a conductores', { desde: f.desde, hasta: f.hasta, formato: 'pdf', ver: 1 })"><app-icono nombre="ojo" />Ver PDF</button>
          <button (click)="excel('/gestion/relaciones/pago-conductores', 'pago_conductores.xlsx', { desde: f.desde, hasta: f.hasta, formato: 'xlsx' })">Excel</button>
        </section>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Conductor</th><th>Cédula</th><th class="num">Viajes</th><th class="num">Total flete</th><th class="num">Auxiliar pagado</th><th class="num">Total pagado</th></tr></thead>
          <tbody>@for (x of relacion()?.filas || []; track x.conductor) {
            <tr><td data-etiqueta="Conductor">{{ x.conductor }}</td><td data-etiqueta="Cédula">{{ x.cedula }}</td><td data-etiqueta="Viajes" class="num">{{ x.viajes }}</td>
              <td data-etiqueta="Total flete" class="num">{{ x.flete | pesos }}</td><td data-etiqueta="Auxiliar pagado" class="num">{{ x.auxiliar | pesos }}</td>
              <td data-etiqueta="Total pagado" class="num"><strong>{{ x.total | pesos }}</strong></td></tr>
          } @empty { <tr><td colspan="6" class="vacio">Sin viajes en el periodo</td></tr> }</tbody>
          @if (relacion()?.totales; as t) { <tfoot><tr><td colspan="2">TOTAL</td><td class="num">{{ t.viajes }}</td><td class="num">{{ t.flete | pesos }}</td><td class="num">{{ t.auxiliar | pesos }}</td><td class="num">{{ t.total | pesos }}</td></tr></tfoot> }
        </table></div>
      }
    }

    <app-modal titulo="Nuevo préstamo o descuento" [abierto]="!!np()" (cerrar)="np.set(null)" [ancho]="true">
      @if (np(); as n) {
        <form id="form-np" class="formulario" (ngSubmit)="crearPrestamo()">
          <app-buscar-tercero etiqueta="Conductor" rol="conductor" [conPlacas]="true" [(valor)]="n.conductor" (elegido)="n.placa = $event?.placas?.[0] || ''" />
          <div class="campo"><label for="np-c">Concepto</label><input id="np-c" name="c" [(ngModel)]="n.concepto" required placeholder="Avería, faltante de entregas…" /></div>
          <div class="campo"><label for="np-k">Capital</label><div class="moneda"><input id="np-k" moneda name="k" [(ngModel)]="n.capital" (ngModelChange)="simular()" required /></div></div>
          <div class="campo"><label for="np-t">Interés mensual (%)</label><input id="np-t" type="number" min="0" step="0.01" name="t" [(ngModel)]="n.tasaMensual" (ngModelChange)="simular()" /></div>
          <div class="campo"><label for="np-n">N° de cuotas quincenales</label><input id="np-n" type="number" min="1" max="120" name="n" [(ngModel)]="n.nCuotas" (ngModelChange)="simular()" required /></div>
          <div class="campo"><label for="np-p">Primera cuota</label><input id="np-p" type="date" name="p" [(ngModel)]="n.primeraCuota" (ngModelChange)="simular()" /><small>Las cuotas caen el 15 y el último día de cada mes.</small></div>
          <div class="campo ancho"><label for="np-o">Observación</label><input id="np-o" name="o" [(ngModel)]="n.observacion" /></div>
        </form>
        @if (plan(); as pl) {
          <p><strong>Cuota fija: {{ pl.valorCuota | pesos }}</strong> · Interés total {{ interesPlan(pl) | pesos }}</p>
          <div class="tabla-caja" style="box-shadow:none;max-height:220px;overflow:auto"><table>
            <thead><tr><th>N°</th><th>Fecha</th><th class="num">Cuota</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Saldo</th></tr></thead>
            <tbody>@for (c of pl.cuotas; track c.n) { <tr><td>{{ c.n }}</td><td>{{ c.fecha | dia }}</td><td class="num">{{ c.valor | pesos }}</td><td class="num">{{ c.capital | pesos }}</td><td class="num">{{ c.interes | pesos }}</td><td class="num">{{ c.saldoCapital | pesos }}</td></tr> }</tbody>
          </table></div>
        }
      }
      <ng-container pie><button type="button" (click)="np.set(null)">Cancelar</button>
        <button class="primario" type="submit" form="form-np" [disabled]="trabajando() || !np()?.conductor">Crear</button></ng-container>
    </app-modal>

    <app-modal [titulo]="'Abono a ' + (abono()?.numero || '')" [abierto]="!!abono()" (cerrar)="abono.set(null)">
      @if (abono(); as a) {
        <form id="form-ab" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="abonar()">
          <p class="sutil">Pendiente: {{ a.resumen.pendiente | pesos }}. El abono se aplica a las cuotas en orden.</p>
          <div class="campo"><label for="ab-v">Valor</label><div class="moneda"><input id="ab-v" moneda name="v" [(ngModel)]="a.valor" required /></div></div>
          <div class="campo"><label for="ab-n">Nota</label><input id="ab-n" name="n" [(ngModel)]="a.nota" /></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="abono.set(null)">Cancelar</button><button class="primario" type="submit" form="form-ab" [disabled]="trabajando()">Abonar</button></ng-container>
    </app-modal>`,
  styles: [`
    .cifras { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 14px; }
    .cifras > div { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 10px 14px; display: flex; flex-direction: column; gap: 2px; }
    .cifras span { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--gris-5); }
    .cifras strong { font-size: 18px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .cifras .destacada { background: var(--tinta); border-color: var(--tinta); color: #fff; } .cifras .destacada span { color: var(--primario); }
    .grupo { margin-bottom: 14px; padding: 14px 16px; }
    .cab-grupo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-bottom: 10px; }
    .quien { display: inline-flex; align-items: center; gap: 10px; } .quien > span:last-child { display: flex; flex-direction: column; line-height: 1.25; }
    .avatar-grupo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--primario); color: var(--sobre-primario); font-weight: 800; font-size: 12.5px; flex: none; }
    .resumen-liq { margin: 10px 0 0 auto; max-width: 340px; display: flex; flex-direction: column; gap: 3px; font-size: 13.5px; }
    .resumen-liq div { display: flex; justify-content: space-between; gap: 16px; } .resumen-liq dt { color: var(--gris-5); } .resumen-liq dd { margin: 0; font-variant-numeric: tabular-nums; }
    .resumen-liq .neto { margin-top: 4px; padding: 7px 10px; border-radius: 9px; background: var(--primario); color: var(--sobre-primario); font-weight: 800; }
    .resumen-liq .neto dt { color: inherit; }
    tfoot td { font-weight: 700; background: var(--gris-1); }
    .num-liq { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    .cab-grupo button { margin-left: auto; }
    .descuento { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; } .descuento input { width: 120px; }
    td.cero { color: var(--verde); font-weight: 600; }
  `],
})
export class PagoConductores {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeGestionar = this.auth.tiene(P.LIQUIDACION_GESTIONAR);
  readonly pestana = signal<Pestana>('liquidar');
  readonly trabajando = signal(false);
  f = { desde: quincena()[0], hasta: quincena()[1], q: '' };
  tipoPeriodo: 'quincena' | 'semana' | 'mes' | '' = 'quincena';
  agrupacion: 'conductor' | 'placa_empresa' = 'conductor';
  readonly agrupar = signal<'conductor' | 'placa_empresa'>('conductor');
  readonly descuentos = signal<Record<string, number | null>>({});
  readonly selLiq = signal(new Set<string>());
  readonly todasLiq = computed(() => this.liquidacionesVisibles().length > 0 && this.liquidacionesVisibles().every(l => this.selLiq().has(l.numero)));
  @ViewChild('visor') visorPdf?: VisorPdf;
  readonly calc = signal<any>(null);
  readonly sel = signal(new Set<string>());
  readonly liquidaciones = signal<any[]>([]);
  readonly q = signal('');
  readonly liquidacionesVisibles = computed(() => filtrar<any>(this.liquidaciones(), this.q()));
  readonly prestamos = signal<any[]>([]);
  readonly qp = signal(''); readonly estadoP = signal('');
  readonly prestamosVisibles = computed(() => filtrar<any>(this.prestamos().filter(p => !this.estadoP() || p.estado === this.estadoP()), this.qp()));
  readonly relacion = signal<any>(null);
  readonly np = signal<any>(null);
  readonly plan = signal<any>(null);
  readonly abono = signal<any>(null);

  // Viajes agrupados por conductor o por placa y empresa (se liquida un grupo a la vez)
  readonly grupos = computed(() => {
    const porPlaca = this.agrupar() === 'placa_empresa';
    const m = new Map<string, any>();
    for (const l of this.calc()?.lineas || []) {
      const k = porPlaca ? `${l.placa}|${l.clienteId}` : (l.cedula || l.conductor);
      const g = m.get(k) || { clave: k, titulo: porPlaca ? `${l.placa} · ${l.empresa}` : l.conductor, cedula: l.cedula, lineas: [], saldo: 0 };
      g.lineas.push(l); g.saldo += l.saldo; m.set(k, g);
    }
    for (const g of m.values()) {
      const cedulas = [...new Set(g.lineas.map((l: any) => l.cedula).filter(Boolean))];
      g.unConductor = cedulas.length === 1; g.cedula = g.unConductor ? cedulas[0] : '';
      const unicos = (k: string) => [...new Set(g.lineas.map((l: any) => l[k]))].join(', ');
      g.subtitulo = porPlaca ? `${unicos('conductor')}${g.cedula ? ` · C.C. ${g.cedula}` : ''}` : `C.C. ${g.cedula || '—'} · ${unicos('placa')}`;
    }
    return [...m.values()].sort((a, b) => a.titulo.localeCompare(b.titulo));
  });

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['gestion', 'viajes'], () => this.ir(this.pestana()));

  constructor() { this.calcular(); }

  ir(p: Pestana) {
    this.pestana.set(p);
    if (p === 'liquidar') this.calcular();
    if (p === 'liquidaciones') this.cargarLiquidaciones();
    if (p === 'prestamos') this.cargarPrestamos();
    if (p === 'relacion') this.cargarRelacion();
  }
  periodo(t: 'quincena' | 'semana' | 'mes') {
    this.tipoPeriodo = t;
    if (t === 'quincena') [this.f.desde, this.f.hasta] = quincena();
    if (t === 'mes') { this.f.desde = inicioMesIso(); this.f.hasta = hoyIso(); }
    if (t === 'semana') [this.f.desde, this.f.hasta] = semanaDe(new Date());
    this.calcular();
  }
  moverSemana(n: number) {
    const d = new Date(`${this.f.desde}T12:00:00`); d.setDate(d.getDate() + 7 * n);
    [this.f.desde, this.f.hasta] = semanaDe(d);
    this.calcular();
  }
  cambiarAgrupacion() { this.agrupar.set(this.agrupacion); this.sel.set(new Set()); this.descuentos.set({}); }
  ponerDescuento(clave: string, v: number | null) { this.descuentos.update(d => ({ ...d, [clave]: v })); }
  alternarLiq(n: string) { const s = new Set(this.selLiq()); if (s.has(n)) s.delete(n); else s.add(n); this.selLiq.set(s); }
  alternarTodasLiq() { this.selLiq.set(this.todasLiq() ? new Set() : new Set(this.liquidacionesVisibles().map(l => l.numero))); }
  imprimirLote() { this.visorPdf?.ver('/gestion/liq-conductores-lote/pdf', 'Liquidaciones (dos por hoja)', { numeros: [...this.selLiq()].join(','), ver: 1 }); }
  async calcular() {
    this.agrupar.set(this.agrupacion);
    // Como en la plantilla, se liquidan todos los viajes del periodo: quedan elegidos y se pueden quitar uno a uno
    try {
      const c = await this.api.post<any>('/gestion/liq-conductores/calcular', { desde: this.f.desde, hasta: this.f.hasta, q: this.f.q });
      this.calc.set(c); this.sel.set(new Set((c.lineas || []).map((l: any) => l.viaje))); this.descuentos.set({});
    }
    catch (e) { this.avisos.error(e); }
  }
  alternar(id: string) { const s = new Set(this.sel()); if (s.has(id)) s.delete(id); else s.add(id); this.sel.set(s); }
  seleccionGrupo(g: any) { return g.lineas.filter((l: any) => this.sel().has(l.viaje)); }
  // Totales de los viajes elegidos del grupo (como el resumen del documento de la liquidación)
  totalesGrupo(g: any) {
    const ls = this.seleccionGrupo(g); const s = (k: string) => ls.reduce((a: number, l: any) => a + (Number(l[k]) || 0), 0);
    const t = { viajes: ls.length, flete: s('flete'), auxiliar: s('auxiliar'), anticipo: s('anticipoReconocido'), retefuente: s('retefuente'), fopat: s('fopat'), saldos: 0 };
    t.saldos = t.flete + t.auxiliar - t.anticipo;
    return ls.length ? t : null;
  }
  // Préstamo que se descontará: el escrito a mano o, si no, las cuotas vencidas (sin pasar del saldo)
  descuentoGrupo(g: any) {
    const pr = this.calc()?.prestamos?.[g.cedula]; const t = this.totalesGrupo(g);
    if (!pr || !t || !g.unConductor) return 0;
    const escrito = this.descuentos()[g.clave];
    return Math.max(0, Math.min(escrito ?? pr.total ?? 0, t.saldos - t.retefuente - t.fopat));
  }
  iniciales(t: string) { return String(t || '').split(/[\s·]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase(); }
  estadoPago(l: any): [string, string] {
    if (l.estado === 'ANULADA') return ['Anulada', 'error'];
    const pagado = Number(l.pagado) || 0;
    return pagado >= l.neto - 0.5 ? ['Pagada', 'ok'] : pagado > 0 ? ['Pago parcial', 'alerta'] : ['Por pagar', 'alerta'];
  }
  readonly resumenLiq = computed(() => {
    const v = this.liquidaciones().filter(l => l.estado !== 'ANULADA');
    if (!v.length) return null;
    const neto = v.reduce((a, l) => a + (Number(l.neto) || 0), 0); const pagado = v.reduce((a, l) => a + Math.min(Number(l.pagado) || 0, Number(l.neto) || 0), 0);
    return { vigentes: v.length, neto, pagado, porPagar: neto - pagado };
  });
  todosGrupo(g: any) { return g.lineas.every((l: any) => this.sel().has(l.viaje)); }
  alternarGrupo(g: any) {
    const s = new Set(this.sel()); const todos = this.todosGrupo(g);
    for (const l of g.lineas) { if (todos) s.delete(l.viaje); else s.add(l.viaje); }
    this.sel.set(s);
  }
  async liquidar(g: any) {
    const viajes = this.seleccionGrupo(g).map((l: any) => l.viaje);
    this.trabajando.set(true);
    try {
      const d = this.descuentos()[g.clave];
      const r = await this.api.post<any>('/gestion/liq-conductores', { viajes, desde: this.f.desde, hasta: this.f.hasta, agrupacion: this.agrupar(),
        ...(d !== null && d !== undefined && String(d) !== '' ? { descuentoPrestamos: d } : {}) });
      const l = r.liquidacion;
      this.avisos.ok(`Liquidación ${l.numero}: neto ${l.neto.toLocaleString('es-CO')}${l.descuentoPrestamos ? ` (préstamos descontados ${l.descuentoPrestamos.toLocaleString('es-CO')})` : ''}`);
      await this.calcular();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async cargarLiquidaciones() { try { this.liquidaciones.set(await this.api.get('/gestion/liq-conductores')); } catch (e) { this.avisos.error(e); } }
  async anularLiq(l: any) {
    try { await this.api.post(`/gestion/liq-conductores/${l.numero}/anular`, {}); this.avisos.ok(`Liquidación ${l.numero} anulada; los viajes quedan sin liquidar`); this.cargarLiquidaciones(); }
    catch (e) { this.avisos.error(e); }
  }
  async excel(ruta: string, nombre: string, params: any = {}) { try { await this.api.descargar(ruta, params, nombre); } catch (e) { this.avisos.error(e); } }

  async cargarPrestamos() { try { this.prestamos.set(await this.api.get('/gestion/prestamos')); } catch (e) { this.avisos.error(e); } }
  nuevoPrestamo() {
    this.plan.set(null);
    this.np.set({ conductor: '', placa: '', concepto: '', capital: null, tasaMensual: 0, nCuotas: 1, primeraCuota: '', observacion: '' });
  }
  private tSim: ReturnType<typeof setTimeout> | undefined;
  simular() {
    clearTimeout(this.tSim);
    this.tSim = setTimeout(async () => {
      const n = this.np();
      if (!n || !(Number(n.capital) > 0) || !(Number(n.nCuotas) >= 1)) { this.plan.set(null); return; }
      try { this.plan.set(await this.api.post('/gestion/prestamos/simular', { capital: n.capital, tasaMensual: n.tasaMensual || 0, nCuotas: n.nCuotas, primeraCuota: n.primeraCuota || undefined })); } catch { this.plan.set(null); }
    }, 250);
  }
  interesPlan(pl: any) { return pl.cuotas.reduce((a: number, c: any) => a + c.interes, 0); }
  async crearPrestamo() {
    const n = this.np();
    this.trabajando.set(true);
    try {
      const p = await this.api.post<any>('/gestion/prestamos', { ...n, primeraCuota: n.primeraCuota || undefined });
      this.avisos.ok(`Préstamo ${p.numero} creado: ${p.nCuotas} cuota(s) de ${p.valorCuota.toLocaleString('es-CO')}`);
      this.np.set(null); this.cargarPrestamos();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  abrirAbono(p: any) { this.abono.set({ ...p, valor: null, nota: '' }); }
  async abonar() {
    const a = this.abono();
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/gestion/prestamos/${a.numero}/abonar`, { valor: a.valor, nota: a.nota });
      this.avisos.ok(`Abono aplicado: ${r.aplicado.toLocaleString('es-CO')}`); this.abono.set(null); this.cargarPrestamos();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularPrestamo(p: any) {
    try { await this.api.post(`/gestion/prestamos/${p.numero}/anular`, { motivo: 'Anulado desde la plataforma' }); this.avisos.ok(`Préstamo ${p.numero} anulado`); this.cargarPrestamos(); }
    catch (e) { this.avisos.error(e); }
  }
  async cargarRelacion() { try { this.relacion.set(await this.api.get('/gestion/relaciones/pago-conductores', { desde: this.f.desde, hasta: this.f.hasta })); } catch (e) { this.avisos.error(e); } }
}
