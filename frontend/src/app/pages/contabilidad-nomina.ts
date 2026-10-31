// Contabilidad fase 4: empleados y nómina (aportes, provisiones, pago, planilla PILA, desprendibles y nómina electrónica),
// activos fijos con depreciación y venta o baja, y cierre contable del año. Pestaña «Nómina y activos» de Contabilidad.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Moneda } from '../shared/moneda';
import { Confirmar } from '../shared/confirmar';
import { FORMATOS, hoyIso } from '../shared/formato';
import { VisorPdf } from '../shared/visor-pdf';

type Seccion = 'empleados' | 'nomina' | 'activos' | 'cierre';
const mesActual = () => new Date().toISOString().slice(0, 7);
const iso = (v: any) => (v ? String(v).slice(0, 10) : '');

@Component({
  selector: 'app-cont-nomina',
  imports: [FormsModule, Icono, Modal, Moneda, Confirmar, VisorPdf, ...FORMATOS],
  template: `
    <app-visor-pdf #visor />
    <div class="segmentos" style="margin-bottom:12px">
      @for (s of secciones; track s[0]) { <button type="button" [class.activo]="seccion() === s[0]" (click)="ir(s[0])">{{ s[1] }}</button> }
    </div>

    @switch (seccion()) {
      @case ('empleados') {
        <div class="cab-filtro"><p class="sutil">Empleados con contrato laboral (los conductores contratistas se liquidan en «Pago a conductores»).</p>
          @if (gestNomina) { <button class="primario" (click)="abrirEmpleado()"><app-icono nombre="mas" />Nuevo empleado</button> }</div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Documento</th><th>Nombre</th><th>Cargo</th><th class="num">Salario</th><th>Contrato</th><th>ARL</th><th>Ingreso</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (e of empleados(); track e._id) {
            <tr><td data-etiqueta="Documento">{{ e.tipoId }} {{ e.numId }}</td><td data-etiqueta="Nombre">{{ e.nombres }} {{ e.apellidos }}</td><td data-etiqueta="Cargo">{{ e.cargo }}</td>
              <td data-etiqueta="Salario" class="num">{{ e.salario | pesos }}@if (e.tipoSalario === 'integral') { <small class="sutil" style="display:block">integral</small> }</td>
              <td data-etiqueta="Contrato">{{ e.tipoContrato }}</td><td data-etiqueta="ARL">Nivel {{ e.nivelRiesgoArl }}</td><td data-etiqueta="Ingreso">{{ e.fechaIngreso | dia }}</td>
              <td data-etiqueta="Estado"><span class="chip" [class.ok]="e.activo" [class.error]="!e.activo">{{ e.activo ? 'Activo' : 'Retirado' }}</span></td>
              <td>@if (gestNomina) { <button class="pequeno" (click)="abrirEmpleado(e)"><app-icono nombre="editar" [tam]="14" />Editar</button> }</td></tr>
          } @empty { <tr><td colspan="9" class="vacio">Sin empleados</td></tr> }</tbody></table></div>
      }

      @case ('nomina') {
        <div class="barra-mini">
          <div class="campo"><label for="n-p">Periodo</label><input id="n-p" [(ngModel)]="periodo" placeholder="2026-10 o 2026-10-Q1" style="width:150px" /></div>
          <button (click)="calcular()" [disabled]="trabajando()">Calcular</button>
          @if (calculo() && gestNomina) { <button class="primario" (click)="liquidar()" [disabled]="trabajando()">Liquidar y contabilizar</button> }
        </div>
        @if (calculo(); as c) {
          <p class="sutil">Escriba las novedades del periodo y pulse «Calcular» de nuevo. SMMLV {{ c.parametros.smmlv | pesos }} · auxilio de transporte {{ c.parametros.auxilioTransporte | pesos }}
            · {{ c.parametros.exoneradaAportes ? 'exonerada de salud, ICBF y SENA (art. 114-1 E.T.) para salarios menores de 10 SMMLV' : 'sin exoneración de aportes' }}.</p>
          <div class="tabla-caja"><table>
            <thead><tr><th>Empleado</th><th class="num">Días</th><th class="num">Horas extras</th><th class="num">Bonificación</th><th class="num">No salarial</th><th class="num">Retención</th><th class="num">Otras deducc.</th>
              <th class="num">Devengado</th><th class="num">Deducciones</th><th class="num">Neto</th><th class="num">Aportes</th><th class="num">Provisiones</th></tr></thead>
            <tbody>@for (l of c.lineas; track l.empleado) {
              <tr><td>{{ l.nombre }}<small class="sutil" style="display:block">{{ l.numId }}</small></td>
                <td><input type="number" class="corto" [(ngModel)]="nov(l.empleado).dias" [placeholder]="l.dias" [attr.aria-label]="'Días ' + l.nombre" /></td>
                <td><div class="moneda"><input moneda [(ngModel)]="nov(l.empleado).horasExtras" [attr.aria-label]="'Horas extras ' + l.nombre" /></div></td>
                <td><div class="moneda"><input moneda [(ngModel)]="nov(l.empleado).bonificaciones" [attr.aria-label]="'Bonificación ' + l.nombre" /></div></td>
                <td><div class="moneda"><input moneda [(ngModel)]="nov(l.empleado).noSalariales" [attr.aria-label]="'No salarial ' + l.nombre" /></div></td>
                <td><div class="moneda"><input moneda [(ngModel)]="nov(l.empleado).retencion" [attr.aria-label]="'Retención ' + l.nombre" /></div></td>
                <td><div class="moneda"><input moneda [(ngModel)]="nov(l.empleado).otrasDeducciones" [attr.aria-label]="'Otras deducciones ' + l.nombre" /></div></td>
                <td class="num">{{ l.devengado | pesos }}</td><td class="num">{{ l.deducciones | pesos }}</td><td class="num"><strong>{{ l.neto | pesos }}</strong></td>
                <td class="num">{{ l.totalAportes | pesos }}</td><td class="num">{{ l.totalProvisiones | pesos }}</td></tr>
            }
            <tr class="total"><td>Total</td><td></td><td></td><td></td><td></td><td></td><td></td><td class="num">{{ c.totales.devengado | pesos }}</td><td class="num">{{ c.totales.deducciones | pesos }}</td>
              <td class="num">{{ c.totales.neto | pesos }}</td><td class="num">{{ sumaObj(c.totales.aportes) | pesos }}</td><td class="num">{{ sumaObj(c.totales.provisiones) | pesos }}</td></tr></tbody></table></div>
          <p class="sutil">La retención en la fuente laboral se escribe a mano (procedimiento 1 o 2, depuración con la contadora).</p>
        }
        <h3>Nóminas liquidadas</h3>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Nómina</th><th>Fecha</th><th class="num">Empleados</th><th class="num">Neto</th><th>Pagos</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (n of nominas(); track n._id) {
            <tr><td data-etiqueta="Nómina">{{ n.numero }}</td><td data-etiqueta="Fecha">{{ n.fecha | dia }}</td><td data-etiqueta="Empleados" class="num">{{ n.totales?.empleados }}</td>
              <td data-etiqueta="Neto" class="num">{{ n.totales?.neto | pesos }}</td>
              <td data-etiqueta="Pagos">@if (n.asientoPago) { <span class="chip ok">Neto</span> } @if (n.asientoAportes) { <span class="chip ok">PILA</span> }</td>
              <td data-etiqueta="Estado"><span class="chip" [class.ok]="n.estado === 'PAGADA'" [class.error]="n.estado === 'ANULADA'">{{ n.estado }}</span></td>
              <td class="celda-acciones"><div class="acciones" style="justify-content:flex-end">
                @if (n.estado !== 'ANULADA') {
                  <button class="pequeno" (click)="verNomina(n)">Desprendibles</button>
                  <button class="pequeno" (click)="excelNe(n)"><app-icono nombre="descargar" [tam]="14" />Nómina electrónica</button>
                  @if (gestNomina && !n.asientoPago) { <button class="pequeno primario" (click)="abrirPago(n, 'empleados')">Pagar neto</button> }
                  @if (gestNomina && !n.asientoAportes) { <button class="pequeno primario" (click)="abrirPago(n, 'aportes')">Pagar PILA</button> }
                  @if (gestNomina && !n.asientoPago && !n.asientoAportes) { <button class="pequeno peligro" confirmar="Clic otra vez para anular" (confirmado)="anularNomina(n)">Anular</button> }
                }</div></td></tr>
          } @empty { <tr><td colspan="7" class="vacio">Sin nóminas</td></tr> }</tbody></table></div>
        @if (detalle(); as d) {
          <h3>Desprendibles {{ d.numero }}</h3>
          <div class="acciones">@for (l of d.lineas; track l.numId) {
            <button class="pequeno" (click)="visor.ver('/gestion/nomina/' + d.numero + '/desprendible/' + l.numId, 'Desprendible ' + l.nombre, { ver: 1 })"><app-icono nombre="ojo" [tam]="14" />{{ l.nombre }}</button>
          }</div>
        }
        @if (gestNomina) {
          <details style="margin-top:14px"><summary>Valores de ley del año</summary>
            <div class="formulario" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:8px">
              <div class="campo"><label for="np-s">Salario mínimo</label><div class="moneda"><input id="np-s" moneda [(ngModel)]="pn.smmlv" /></div><small>2026: $ 1.750.905 (Decreto 1469 de 2025)</small></div>
              <div class="campo"><label for="np-a">Auxilio de transporte</label><div class="moneda"><input id="np-a" moneda [(ngModel)]="pn.auxilioTransporte" /></div><small>2026: $ 249.095 (Decreto 1470 de 2025)</small></div>
              <div class="campo"><label for="np-d">Prefijo del documento soporte</label><input id="np-d" [(ngModel)]="pn.prefijoDocumentoSoporte" maxlength="6" /></div>
              <div class="campo"><label class="casilla"><input type="checkbox" [(ngModel)]="pn.exoneradaAportes" />Exonerada de aportes (art. 114-1 E.T.)</label></div>
              <div class="campo" style="align-self:end"><button (click)="guardarParametros()">Guardar</button></div>
            </div></details>
        }
      }

      @case ('activos') {
        <div class="barra-mini">
          @if (puedeGestionar) {
            <button class="primario" (click)="abrirActivo()"><app-icono nombre="mas" />Nuevo activo</button>
            <div class="campo"><label for="a-m">Mes a depreciar</label><input id="a-m" type="month" [(ngModel)]="mesDep" /></div>
            <button (click)="depreciar()" [disabled]="trabajando()">Registrar depreciación</button>
            <button class="pequeno peligro" confirmar="Clic otra vez para anular la depreciación del mes" (confirmado)="anularDep()">Anular depreciación del mes</button>
          }
        </div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Código</th><th>Activo</th><th>Cuenta</th><th>Compra</th><th class="num">Costo</th><th class="num">Depreciación acum.</th><th class="num">Valor en libros</th><th class="num">Cuota mensual</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (a of activos(); track a._id) {
            <tr><td data-etiqueta="Código">{{ a.codigo }}</td><td data-etiqueta="Activo">{{ a.nombre }}@if (a.placa) { <small class="sutil" style="display:block">{{ a.placa }}</small> }</td>
              <td data-etiqueta="Cuenta">{{ a.cuenta }}</td><td data-etiqueta="Compra">{{ a.fechaCompra | dia }}</td><td data-etiqueta="Costo" class="num">{{ a.costo | pesos }}</td>
              <td data-etiqueta="Depreciación" class="num">{{ a.depreciacionAcumulada | pesos }}</td><td data-etiqueta="Valor en libros" class="num">{{ a.valorEnLibros | pesos }}</td>
              <td data-etiqueta="Cuota" class="num">{{ a.cuotaMensual | pesos }}</td>
              <td data-etiqueta="Estado"><span class="chip" [class.ok]="a.estado === 'ACTIVO'">{{ a.estado }}</span></td>
              <td>@if (puedeGestionar && a.estado === 'ACTIVO') { <button class="pequeno" (click)="abrirBaja(a)">Vender o dar de baja</button> }</td></tr>
          } @empty { <tr><td colspan="10" class="vacio">Sin activos fijos</td></tr> }</tbody></table></div>
        <p class="sutil">Línea recta: (costo − valor residual) ÷ vida útil. Asiento mensual 5160 contra 1592. Vida útil sugerida: vehículos 10 años, cómputo 5 años, muebles 10 años.</p>
      }

      @case ('cierre') {
        <p class="sutil">El cierre lleva a cero las cuentas de ingresos, costos y gastos del año contra 3605 (utilidad) o 3610 (pérdida), con fecha 31 de diciembre.
          El estado de resultados del año sigue mostrando sus cifras. Hágalo después de los ajustes de la contadora.</p>
        @if (puedeGestionar) { <div class="barra-mini">
          <div class="campo"><label for="c-a">Año</label><input id="c-a" type="number" [(ngModel)]="anioCierre" style="width:110px" /></div>
          <button class="primario" confirmar="Clic otra vez para cerrar el año" (confirmado)="cerrarAnio()">Cerrar el año</button></div> }
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Cierre</th><th>Fecha</th><th>Asiento</th><th class="num">Resultado</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (c of cierres(); track c.asiento) {
            <tr [class.anulado]="c.estado === 'ANULADO'"><td data-etiqueta="Cierre">{{ c.documento }}</td><td data-etiqueta="Fecha">{{ c.fecha | dia }}</td><td data-etiqueta="Asiento">{{ c.asiento }}</td>
              <td data-etiqueta="Resultado" class="num" [class.negativo]="c.resultado < 0">{{ c.resultado | pesos }}</td><td data-etiqueta="Estado"><span class="chip">{{ c.estado }}</span></td>
              <td>@if (puedeGestionar && c.estado === 'ACTIVO') { <button class="pequeno peligro" confirmar="Clic otra vez para reabrir el año" (confirmado)="anularCierre(c)">Reabrir</button> }</td></tr>
          } @empty { <tr><td colspan="6" class="vacio">Sin cierres anuales</td></tr> }</tbody></table></div>
      }
    }

    <app-modal [titulo]="emp()?._id ? 'Editar empleado' : 'Nuevo empleado'" [abierto]="!!emp()" (cerrar)="emp.set(null)">
      @if (emp(); as e) {
        <form id="form-emp" class="formulario" (ngSubmit)="guardarEmpleado()">
          <div class="campo"><label for="e-t">Tipo</label><select id="e-t" name="t" [(ngModel)]="e.tipoId"><option value="CC">Cédula</option><option value="CE">Cédula de extranjería</option><option value="PPT">PPT</option><option value="PA">Pasaporte</option></select></div>
          <div class="campo"><label for="e-n">Número</label><input id="e-n" name="n" [(ngModel)]="e.numId" required /></div>
          <div class="campo"><label for="e-no">Nombres</label><input id="e-no" name="no" [(ngModel)]="e.nombres" required /></div>
          <div class="campo"><label for="e-ap">Apellidos</label><input id="e-ap" name="ap" [(ngModel)]="e.apellidos" /></div>
          <div class="campo"><label for="e-c">Cargo</label><input id="e-c" name="c" [(ngModel)]="e.cargo" /></div>
          <div class="campo"><label for="e-s">Salario mensual</label><div class="moneda"><input id="e-s" moneda name="s" [(ngModel)]="e.salario" required /></div></div>
          <div class="campo"><label for="e-ts">Tipo de salario</label><select id="e-ts" name="ts" [(ngModel)]="e.tipoSalario"><option value="ordinario">Ordinario</option><option value="integral">Integral</option></select></div>
          <div class="campo"><label for="e-tc">Contrato</label><select id="e-tc" name="tc" [(ngModel)]="e.tipoContrato"><option value="indefinido">Indefinido</option><option value="fijo">Término fijo</option><option value="obra">Obra o labor</option><option value="aprendiz">Aprendiz SENA</option></select></div>
          <div class="campo"><label for="e-fi">Fecha de ingreso</label><input id="e-fi" type="date" name="fi" [(ngModel)]="e.fechaIngreso" required /></div>
          <div class="campo"><label for="e-fr">Fecha de retiro</label><input id="e-fr" type="date" name="fr" [(ngModel)]="e.fechaRetiro" /></div>
          <div class="campo"><label for="e-arl">Riesgo ARL</label><select id="e-arl" name="arl" [(ngModel)]="e.nivelRiesgoArl">@for (n of [1, 2, 3, 4, 5]; track n) { <option [ngValue]="n">Nivel {{ n }}</option> }</select></div>
          <div class="campo"><label for="e-eps">EPS</label><input id="e-eps" name="eps" [(ngModel)]="e.eps" /></div>
          <div class="campo"><label for="e-afp">Fondo de pensiones</label><input id="e-afp" name="afp" [(ngModel)]="e.afp" /></div>
          <div class="campo"><label for="e-caja">Caja de compensación</label><input id="e-caja" name="caja" [(ngModel)]="e.caja" /></div>
          <div class="campo"><label class="casilla"><input type="checkbox" name="ac" [(ngModel)]="e.activo" />Activo</label></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="emp.set(null)">Cancelar</button><button class="primario" type="submit" form="form-emp" [disabled]="trabajando()">Guardar</button></ng-container>
    </app-modal>

    <app-modal [titulo]="pago()?.que === 'empleados' ? 'Pagar el neto de la nómina' : 'Pagar la planilla PILA'" [abierto]="!!pago()" (cerrar)="pago.set(null)">
      @if (pago(); as p) {
        <form id="form-pago-nom" class="formulario" style="grid-template-columns:1fr 1fr" (ngSubmit)="guardarPago()">
          <div class="campo"><label for="pn-f">Fecha</label><input id="pn-f" type="date" name="f" [(ngModel)]="p.fecha" required /></div>
          <div class="campo"><label for="pn-c">Sale de</label><select id="pn-c" name="c" [(ngModel)]="p.cuenta"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option></select></div>
        </form>
        <p class="sutil">{{ p.que === 'empleados' ? 'Débito a 2505 salarios por pagar.' : 'Débito a 237005 EPS, 237030 pensiones, 237006 ARL y 237010 parafiscales.' }}</p>
      }
      <ng-container pie><button type="button" (click)="pago.set(null)">Cancelar</button><button class="primario" type="submit" form="form-pago-nom" [disabled]="trabajando()">Registrar pago</button></ng-container>
    </app-modal>

    <app-modal titulo="Nuevo activo fijo" [abierto]="!!act()" (cerrar)="act.set(null)">
      @if (act(); as a) {
        <form id="form-act" class="formulario" (ngSubmit)="guardarActivo()">
          <div class="campo"><label for="af-n">Nombre</label><input id="af-n" name="n" [(ngModel)]="a.nombre" required /></div>
          <div class="campo"><label for="af-c">Cuenta</label><select id="af-c" name="c" [(ngModel)]="a.cuenta" (change)="a.vidaUtilMeses = vida[a.cuenta] || a.vidaUtilMeses">
            <option value="1540">1540 Flota y equipo de transporte</option><option value="1528">1528 Equipo de cómputo</option><option value="1524">1524 Equipo de oficina</option></select></div>
          <div class="campo"><label for="af-p">Placa (si es vehículo)</label><input id="af-p" name="p" [(ngModel)]="a.placa" maxlength="7" /></div>
          <div class="campo"><label for="af-f">Fecha de compra</label><input id="af-f" type="date" name="f" [(ngModel)]="a.fechaCompra" required /></div>
          <div class="campo"><label for="af-co">Costo</label><div class="moneda"><input id="af-co" moneda name="co" [(ngModel)]="a.costo" required /></div></div>
          <div class="campo"><label for="af-r">Valor residual</label><div class="moneda"><input id="af-r" moneda name="r" [(ngModel)]="a.valorResidual" /></div></div>
          <div class="campo"><label for="af-v">Vida útil (meses)</label><input id="af-v" type="number" name="v" [(ngModel)]="a.vidaUtilMeses" required /></div>
          <div class="campo"><label for="af-d">Depreciación ya acumulada</label><div class="moneda"><input id="af-d" moneda name="d" [(ngModel)]="a.depreciacionAcumulada" /></div><small>Para activos que vienen de la contabilidad anterior</small></div>
          <div class="campo"><label for="af-pg">Contabilizar la compra</label><select id="af-pg" name="pg" [(ngModel)]="a.cuentaPago">
            <option value="">No (ya está en saldos iniciales o en una compra)</option><option value="1110">Pagado con bancos</option><option value="1105">Pagado con caja</option><option value="2335">A crédito (por pagar)</option></select></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="act.set(null)">Cancelar</button><button class="primario" type="submit" form="form-act" [disabled]="trabajando()">Guardar</button></ng-container>
    </app-modal>

    <app-modal [titulo]="'Vender o dar de baja ' + (baja()?.codigo || '')" [abierto]="!!baja()" (cerrar)="baja.set(null)">
      @if (baja(); as b) {
        <form id="form-baja" class="formulario" (ngSubmit)="guardarBaja()">
          <div class="campo"><label for="b-f">Fecha</label><input id="b-f" type="date" name="f" [(ngModel)]="b.fecha" required /></div>
          <div class="campo"><label for="b-p">Precio de venta (0 si es baja)</label><div class="moneda"><input id="b-p" moneda name="p" [(ngModel)]="b.precio" /></div></div>
          <div class="campo"><label for="b-c">Se recibe en</label><select id="b-c" name="c" [(ngModel)]="b.cuentaCobro"><option value="1110">1110 Bancos</option><option value="1105">1105 Caja</option><option value="1380">1380 Deudores varios</option></select></div>
          <div class="campo"><label for="b-m">Motivo</label><input id="b-m" name="m" [(ngModel)]="b.motivo" /></div>
        </form>
        <p class="sutil">Valor en libros {{ b.valorEnLibros | pesos }}. La diferencia con el precio va a 4245 (utilidad) o 5310 (pérdida).</p>
      }
      <ng-container pie><button type="button" (click)="baja.set(null)">Cancelar</button><button class="primario" type="submit" form="form-baja" [disabled]="trabajando()">Registrar</button></ng-container>
    </app-modal>`,
  styles: [`
    .barra-mini { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-bottom: 12px; }
    tr.total td { font-weight: 700; background: var(--gris-1); } tr.anulado td { color: var(--gris-5); text-decoration: line-through; }
    h3 { margin: 14px 0 6px; } input.corto { width: 64px; } .negativo { color: var(--rojo); }
    td .moneda input { min-width: 110px; }
  `],
})
export class NominaCont {
  private api = inject(Api); private avisos = inject(Avisos);
  private auth = inject(Auth);
  readonly puedeGestionar = this.auth.tiene(P.CONTABILIDAD_GESTIONAR);
  // La nómina (salarios, datos personales y bancarios) solo la ve quien tiene permiso de nómina
  readonly puedeVerNomina = this.auth.tiene(P.NOMINA_VER);
  readonly gestNomina = this.auth.tiene(P.NOMINA_GESTIONAR);
  readonly secciones: [Seccion, string][] = ([['empleados', 'Empleados'], ['nomina', 'Nómina'], ['activos', 'Activos fijos'], ['cierre', 'Cierre del año']] as [Seccion, string][])
    .filter(([k]) => this.puedeVerNomina || (k !== 'empleados' && k !== 'nomina'));
  readonly vida: Record<string, number> = { 1540: 120, 1524: 120, 1528: 60 };
  readonly seccion = signal<Seccion>(this.puedeVerNomina ? 'nomina' : 'activos');
  readonly trabajando = signal(false);
  readonly empleados = signal<any[]>([]); readonly nominas = signal<any[]>([]); readonly activos = signal<any[]>([]); readonly cierres = signal<any[]>([]);
  readonly calculo = signal<any>(null); readonly detalle = signal<any>(null);
  readonly emp = signal<any>(null); readonly pago = signal<any>(null); readonly act = signal<any>(null); readonly baja = signal<any>(null);
  readonly sumaObj = (o: any) => Object.values(o || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
  private novedades: Record<string, any> = {};
  periodo = mesActual(); mesDep = mesActual(); anioCierre = new Date().getFullYear() - 1;
  pn: any = { smmlv: 1750905, auxilioTransporte: 249095, exoneradaAportes: true, prefijoDocumentoSoporte: 'DS' };

  constructor() {
    this.cargar();
    this.api.get<any>('/gestion/contabilidad/parametros').then(p => { this.pn = { smmlv: p.smmlv, auxilioTransporte: p.auxilioTransporte, exoneradaAportes: p.exoneradaAportes, prefijoDocumentoSoporte: p.prefijoDocumentoSoporte }; }).catch(() => {});
  }
  ir(s: Seccion) { this.seccion.set(s); this.cargar(); }
  nov(id: string) { return this.novedades[id] ??= {}; }
  async cargar() {
    try {
      const s = this.seccion();
      if (s === 'empleados') this.empleados.set(await this.api.get('/gestion/nomina/empleados'));
      if (s === 'nomina') this.nominas.set(await this.api.get('/gestion/nomina'));
      if (s === 'activos') this.activos.set(await this.api.get('/gestion/activos'));
      if (s === 'cierre') this.cierres.set(await this.api.get('/gestion/cierre-anual'));
    } catch (e) { this.avisos.error(e); }
  }
  private limpiasNovedades() {
    const r: Record<string, any> = {};
    for (const [k, v] of Object.entries(this.novedades)) {
      const x = Object.fromEntries(Object.entries(v).filter(([, y]) => y !== null && y !== undefined && y !== ''));
      if (Object.keys(x).length) r[k] = x;
    }
    return r;
  }
  async calcular() {
    this.trabajando.set(true);
    try { this.calculo.set(await this.api.post('/gestion/nomina/calcular', { periodo: this.periodo, novedades: this.limpiasNovedades() })); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async liquidar() {
    this.trabajando.set(true);
    try {
      const n = await this.api.post<any>('/gestion/nomina', { periodo: this.periodo, novedades: this.limpiasNovedades() });
      this.avisos.ok(`Nómina ${n.numero} liquidada (asiento ${n.asiento})`); this.calculo.set(null); this.novedades = {}; this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async verNomina(n: any) { try { this.detalle.set(await this.api.get(`/gestion/nomina/${n.numero}`)); } catch (e) { this.avisos.error(e); } }
  async excelNe(n: any) { try { await this.api.descargar(`/gestion/nomina/${n.numero}/electronica`, { formato: 'xlsx' }, `Nomina_electronica_${n.numero}.xlsx`); } catch (e) { this.avisos.error(e); } }
  abrirPago(n: any, que: string) { this.pago.set({ numero: n.numero, que, fecha: hoyIso(), cuenta: '1110' }); }
  async guardarPago() {
    const p = this.pago(); this.trabajando.set(true);
    try { await this.api.post(`/gestion/nomina/${p.numero}/pagar`, { que: p.que, fecha: p.fecha, cuenta: p.cuenta }); this.avisos.ok('Pago registrado'); this.pago.set(null); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularNomina(n: any) { try { await this.api.post(`/gestion/nomina/${n.numero}/anular`, {}); this.avisos.ok(`Nómina ${n.numero} anulada`); this.cargar(); } catch (e) { this.avisos.error(e); } }
  async guardarParametros() { try { await this.api.put('/gestion/nomina/parametros', this.pn); this.avisos.ok('Valores guardados'); } catch (e) { this.avisos.error(e); } }

  abrirEmpleado(e: any = null) {
    const base = { tipoId: 'CC', numId: '', nombres: '', apellidos: '', cargo: '', salario: null, tipoSalario: 'ordinario', tipoContrato: 'indefinido', fechaIngreso: hoyIso(),
      fechaRetiro: '', nivelRiesgoArl: 1, eps: '', afp: '', caja: '', activo: true };
    this.emp.set(e ? { ...base, ...e, fechaIngreso: iso(e.fechaIngreso), fechaRetiro: iso(e.fechaRetiro) } : base);
  }
  async guardarEmpleado() {
    const { _id, empresa, createdAt, updatedAt, __v, conductor, banco, ...d } = this.emp();
    const cuerpo = { ...d, fechaRetiro: d.fechaRetiro || null };
    this.trabajando.set(true);
    try {
      if (_id) await this.api.put(`/gestion/nomina/empleados/${_id}`, cuerpo); else await this.api.post('/gestion/nomina/empleados', cuerpo);
      this.avisos.ok('Empleado guardado'); this.emp.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  abrirActivo() { this.act.set({ nombre: '', cuenta: '1540', placa: '', fechaCompra: hoyIso(), costo: null, valorResidual: 0, vidaUtilMeses: 120, depreciacionAcumulada: 0, cuentaPago: '' }); }
  async guardarActivo() {
    this.trabajando.set(true);
    try { const a = await this.api.post<any>('/gestion/activos', this.act()); this.avisos.ok(`Activo ${a.codigo} registrado`); this.act.set(null); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async depreciar() {
    this.trabajando.set(true);
    try { const r = await this.api.post<any>('/gestion/activos/depreciar', { mes: this.mesDep }); this.avisos.ok(`Depreciación ${r.mes}: ${r.total.toLocaleString('es-CO')} (${r.activos} activos)`); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularDep() { try { await this.api.post(`/gestion/activos/depreciar/${this.mesDep}/anular`, {}); this.avisos.ok('Depreciación anulada'); this.cargar(); } catch (e) { this.avisos.error(e); } }
  abrirBaja(a: any) { this.baja.set({ codigo: a.codigo, valorEnLibros: a.valorEnLibros, fecha: hoyIso(), precio: 0, cuentaCobro: '1110', motivo: '' }); }
  async guardarBaja() {
    const b = this.baja(); this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/gestion/activos/${b.codigo}/baja`, { fecha: b.fecha, precio: b.precio || 0, cuentaCobro: b.cuentaCobro, motivo: b.motivo });
      this.avisos.ok(`${r.estado === 'VENDIDO' ? 'Venta' : 'Baja'} registrada · ${r.resultado >= 0 ? 'utilidad' : 'pérdida'} ${Math.abs(r.resultado).toLocaleString('es-CO')}`); this.baja.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async cerrarAnio() {
    try { const r = await this.api.post<any>('/gestion/cierre-anual', { anio: this.anioCierre }); this.avisos.ok(`Año ${r.anio} cerrado (asiento ${r.asiento})`); this.cargar(); } catch (e) { this.avisos.error(e); }
  }
  async anularCierre(c: any) {
    try { await this.api.post(`/gestion/cierre-anual/${c.documento.replace('CIERRE-', '')}/anular`, {}); this.avisos.ok('Cierre anulado: el año quedó abierto'); this.cargar(); } catch (e) { this.avisos.error(e); }
  }
}
