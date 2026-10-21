import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { FORMATOS } from '../shared/formato';
import { Confirmar } from '../shared/confirmar';
import { BuscarTercero } from '../shared/buscar-tercero';
import { VisorPdf } from '../shared/visor-pdf';
import { ExportarViajes, rangoPeriodo } from '../shared/exportar-viajes';

type Periodo = 'hoy' | 'semana' | 'quincena' | 'mes' | 'otro';
const finQuincena = () => rangoPeriodo('quincena')!.hasta;
const hoy = () => rangoPeriodo('hoy')!.desde;

// Relaciones (como la hoja de la plantilla): viajes de una empresa y placa en el periodo, copiar o eliminar,
// registro masivo de un vehículo para varios días, relación en Excel/PDF, pago a conductores e informe de utilidad.
@Component({
  selector: 'app-relaciones',
  imports: [FormsModule, RouterLink, Icono, Modal, Confirmar, BuscarTercero, VisorPdf, ExportarViajes, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Relaciones</h1>
        <p class="sutil">Revise los viajes por empresa y placa, regístrelos en bloque y saque la relación, el pago y la utilidad.</p></div>
      <div class="acciones">
        @if (puedeRegistrar) { <button class="primario" (click)="abrirMasivo()"><app-icono nombre="mas" [tam]="16" />Registro masivo</button> }
        <button (click)="exportador().abrir({ cliente: f.cliente })"><app-icono nombre="descargar" [tam]="16" />Relación Excel / PDF</button>
        <button (click)="informe('pdf')"><app-icono nombre="ojo" [tam]="16" />Informe de utilidad</button>
        <button (click)="informe('xlsx')" title="Informe de utilidad en Excel"><app-icono nombre="descargar" [tam]="16" />Utilidad Excel</button>
        <a class="boton" routerLink="/pago-conductores"><app-icono nombre="dinero" [tam]="16" />Pagos</a>
      </div>
    </div>
    <app-visor-pdf />
    <app-exportar-viajes [clientes]="clientes()" />

    <section class="barra" aria-label="Filtros">
      <div class="campo"><label for="rl-cli">Empresa</label>
        <select id="rl-cli" [(ngModel)]="f.cliente" (change)="cargar()"><option value="">Todas</option>
          @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
      <div class="campo"><label for="rl-placa">Placa</label>
        <input id="rl-placa" list="rl-placas" placeholder="Todas" maxlength="7" [(ngModel)]="f.placa" (change)="cargar()" (keyup.enter)="cargar()" />
        <datalist id="rl-placas">@for (p of placas(); track p) { <option [value]="p"></option> }</datalist></div>
      <div class="campo"><span class="etiqueta">Periodo</span><div class="segmentos">
        @for (o of PERIODOS; track o.v) { <button type="button" [class.activo]="periodo() === o.v" (click)="elegirPeriodo(o.v)">{{ o.t }}</button> }</div></div>
      <div class="campo"><label for="rl-d">Desde</label><input id="rl-d" type="date" [(ngModel)]="f.desde" (change)="periodo.set('otro'); cargar()" /></div>
      <div class="campo"><label for="rl-h">Hasta</label><input id="rl-h" type="date" [(ngModel)]="f.hasta" (change)="periodo.set('otro'); cargar()" /></div>
      @if (f.cliente || f.placa) { <div class="campo"><span class="etiqueta">&nbsp;</span><button type="button" class="texto" (click)="finalizar()" title="Limpiar empresa y placa para seguir con otra">Finalizar placa</button></div> }
    </section>

    @if (datos(); as d) {
      <div class="cifras">
        <div><span>Viajes</span><strong>{{ d.totales.viajes }}</strong></div>
        <div><span>Cobrado a la empresa</span><strong>{{ d.totales.tarifa | pesos }}</strong></div>
        <div><span>Flete conductores</span><strong>{{ d.totales.flete | pesos }}</strong></div>
        <div><span>Utilidad</span><strong [class.negativo]="utilidad() < 0">{{ utilidad() | pesos }}</strong></div>
      </div>

      <div class="tabla-caja">
        <table class="tabla-movil">
          <thead><tr><th>N°</th><th>Fecha</th><th>Empresa</th><th>Placa</th><th>Conductor</th><th>Destino</th><th>Planilla</th>
            <th class="num">Tarifa</th><th class="num">Flete</th><th>Fact.</th><th></th></tr></thead>
          <tbody>
            @for (x of d.filas; track x._id) {
              <tr>
                <td data-etiqueta="N°" class="sutil">{{ x.numero }}</td>
                <td data-etiqueta="Fecha">{{ x.fecha | dia }}</td>
                <td data-etiqueta="Empresa">{{ x.cliente }}</td>
                <td data-etiqueta="Placa"><span class="placa">{{ x.placa }}</span></td>
                <td data-etiqueta="Conductor">{{ x.conductor }}</td>
                <td data-etiqueta="Destino">{{ x.destino }}</td>
                <td data-etiqueta="Planilla">{{ x.planilla || '—' }}</td>
                <td data-etiqueta="Tarifa" class="num">{{ x.tarifa | pesos }}</td>
                <td data-etiqueta="Flete" class="num">{{ x.flete | pesos }}</td>
                <td data-etiqueta="Facturado">@if (x.facturado) { <span class="chip ok">Sí</span> } @else { <span class="chip sin-punto">No</span> }</td>
                <td class="acciones-fila">
                  @if (puedeRegistrar) {
                    @if (copiando() === x._id) {
                      <span class="copiar"><input type="date" [(ngModel)]="fechaCopia" [attr.aria-label]="'Fecha para la copia del viaje ' + x.numero" />
                        <button type="button" class="primario" (click)="copiar(x)">Copiar</button><button type="button" class="texto" (click)="copiando.set('')">Cancelar</button></span>
                    } @else {
                      <button type="button" class="texto" (click)="empezarCopia(x)" title="Copiar este viaje a otra fecha">Copiar</button>
                      @if (x.estado === 'registrado' && !x.facturado) {
                        <button type="button" class="texto peligro" confirmar="Clic otra vez para eliminar" (confirmado)="eliminar(x)">Eliminar</button>
                      }
                    }
                  }
                </td>
              </tr>
            } @empty { <tr><td colspan="11" class="vacio">No hay viajes con estos filtros</td></tr> }
          </tbody>
        </table>
      </div>
    }

    <!-- Registro masivo -->
    <app-modal titulo="Registro masivo de viajes" [abierto]="masivoAbierto()" (cerrar)="masivoAbierto.set(false)" [ancho]="true">
      <p class="sutil" style="margin-top:0">Registra un viaje por cada día hábil del rango para el mismo vehículo. Salta domingos, festivos de Colombia,
        los sábados si lo indica y los días en que la placa ya tiene viaje.</p>
      <div class="rejilla">
        <div class="campo"><label for="m-cli">Empresa</label>
          <select id="m-cli" [(ngModel)]="m.cliente" (change)="m.tarifaRef = ''; m.destino = ''; mCliente.set(m.cliente); previa.set(null)"><option value="">Seleccione…</option>
            @for (c of clientesActivos(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
        <div class="campo"><label for="m-dest">Destino</label>
          <select id="m-dest" [(ngModel)]="m.tarifaRef" (change)="elegirDestino()" [disabled]="!m.cliente"><option value="">Seleccione…</option>
            @for (t of tarifasCliente(); track t._id) { <option [value]="t._id">{{ t.destino }}</option> }</select></div>
        <app-buscar-tercero etiqueta="Conductor" rol="conductor" [conPlacas]="true" [(valor)]="m.conductor" (elegido)="elegirConductor($event)" placeholder="Nombre, apellido o cédula" />
        <div class="campo"><label for="m-placa">Placa</label>
          <input id="m-placa" maxlength="7" [(ngModel)]="m.placa" (ngModelChange)="m.placa = ($event || '').toUpperCase(); previa.set(null)" list="m-placas" />
          <datalist id="m-placas">@for (p of placasConductor(); track p) { <option [value]="p"></option> }</datalist></div>
        <div class="campo"><label for="m-d">Desde</label><input id="m-d" type="date" [(ngModel)]="m.desde" (change)="previa.set(null)" /></div>
        <div class="campo"><label for="m-h">Hasta</label><input id="m-h" type="date" [(ngModel)]="m.hasta" (change)="previa.set(null)" /></div>
        <div class="campo"><label for="m-cant">Cantidad por día</label><input id="m-cant" type="number" min="0" [(ngModel)]="m.cantidad" /></div>
        <div class="campo"><label for="m-pl">N° de planilla</label><input id="m-pl" maxlength="30" placeholder="Opcional" [(ngModel)]="m.planilla" /></div>
        <div class="campo"><span class="etiqueta">Opciones</span>
          <label class="casilla"><input type="checkbox" [(ngModel)]="m.incluirSabados" (change)="previa.set(null)" />Incluir sábados</label>
          <label class="casilla"><input type="checkbox" [(ngModel)]="m.conAuxiliar" />Lleva auxiliar</label>
          <label class="casilla"><input type="checkbox" [(ngModel)]="m.requiereManifiesto" />Requiere manifiesto RNDC</label></div>
        @if (m.conAuxiliar) { <div class="campo"><label for="m-da">Días / auxiliares</label><input id="m-da" type="number" min="0" placeholder="Igual a la cantidad" [(ngModel)]="m.diasAuxiliar" /></div> }
      </div>

      @if (previa(); as pv) {
        <h3 class="sub">Días del rango · {{ elegidos().size }} por registrar</h3>
        <div class="dias">
          @for (x of pv.dias; track x.fecha) {
            <label class="dia" [class.omitido]="!x.registrar" [class.elegido]="elegidos().has(x.fecha)">
              <input type="checkbox" [checked]="elegidos().has(x.fecha)" [disabled]="x.motivo === 'ya tiene viaje'" (change)="alternarDia(x.fecha)" />
              <span class="fecha"><strong>{{ x.fecha | dia }}</strong><small>{{ x.dia }}</small></span>
              @if (x.motivo) { <span class="chip sin-punto" [class.alerta]="x.motivo.startsWith('festivo')">{{ x.motivo }}</span> }
            </label>
          }
        </div>
      }

      <ng-container pie>
        <button type="button" class="texto" (click)="masivoAbierto.set(false)">Cancelar</button>
        <button type="button" (click)="verDias()" [disabled]="!masivoValido() || ocupado()">Ver días</button>
        <button type="button" class="primario" (click)="registrarMasivo()" [disabled]="!previa() || !elegidos().size || ocupado()">
          Registrar {{ elegidos().size }} viaje(s)</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .cifras { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--gris-2); border: 1px solid var(--gris-2);
      border-radius: var(--radio); overflow: hidden; margin: 14px 0; }
    .cifras > div { background: var(--gris-0); padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
    .cifras span { font-size: 12.5px; color: var(--gris-5); } .cifras strong { font-size: 20px; font-variant-numeric: tabular-nums; }
    .negativo { color: var(--rojo, #c62828); }
    .acciones-fila { white-space: nowrap; text-align: right; }
    .copiar { display: inline-flex; gap: 6px; align-items: center; } .copiar input { width: 150px; }
    .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .sub { font-size: 14px; margin: 18px 0 8px; }
    .dias { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; }
    .dia { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--gris-2); border-radius: 10px; cursor: pointer; }
    .dia.elegido { border-color: var(--primario-borde); background: var(--primario-claro); }
    .dia.omitido:not(.elegido) { opacity: .7; background: var(--gris-1); }
    .dia .fecha { display: flex; flex-direction: column; line-height: 1.15; } .dia small { color: var(--gris-5); text-transform: capitalize; }
    @media (max-width: 700px) { .cifras { grid-template-columns: 1fr 1fr; } }
  `],
})
export class Relaciones {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly puedeRegistrar = inject(Auth).tiene(P.VIAJES_REGISTRAR);
  readonly exportador = viewChild.required(ExportarViajes);
  private visor = viewChild.required(VisorPdf);

  readonly PERIODOS: { v: Periodo; t: string }[] = [{ v: 'hoy', t: 'Hoy' }, { v: 'semana', t: 'Semana' }, { v: 'quincena', t: 'Quincena' }, { v: 'mes', t: 'Mes' }];
  readonly periodo = signal<Periodo>('quincena');
  f = { cliente: '', placa: '', ...rangoPeriodo('quincena')! };

  readonly clientes = signal<any[]>([]);
  readonly clientesActivos = computed(() => this.clientes().filter(c => c.activo !== false));
  readonly tarifas = signal<any[]>([]);
  readonly datos = signal<any>(null);
  readonly placas = computed(() => [...new Set<string>((this.datos()?.filas || []).map((x: any) => x.placa))].sort());
  readonly utilidad = computed(() => (this.datos()?.filas || []).reduce((a: number, x: any) => a + (x.utilidad || 0), 0));
  readonly copiando = signal('');
  fechaCopia = hoy();

  constructor() { this.iniciar(); }

  private async iniciar() {
    try {
      const [c, t] = await Promise.all([this.api.get<any[]>('/maestros/clientes'), this.api.get<any[]>('/maestros/tarifas')]);
      this.clientes.set(c); this.tarifas.set(t);
    } catch (e) { this.avisos.error(e); }
    this.cargar();
  }

  async cargar() {
    try { this.datos.set(await this.api.get('/gestion/relaciones/viajes', { agrupar: 'empresa', ...this.f, placa: this.f.placa.toUpperCase() })); }
    catch (e) { this.avisos.error(e); }
  }

  elegirPeriodo(p: Periodo) { this.periodo.set(p); this.f = { ...this.f, ...rangoPeriodo(p)! }; this.cargar(); }
  finalizar() { this.f = { ...this.f, cliente: '', placa: '' }; this.cargar(); }

  empezarCopia(x: any) {
    const d = new Date(x.fecha); d.setUTCDate(d.getUTCDate() + 1);
    this.fechaCopia = d.toISOString().slice(0, 10);
    this.copiando.set(x._id);
  }
  async copiar(x: any) {
    try {
      const r = await this.api.post<any>(`/gestion/relaciones/copiar/${x._id}`, { fecha: this.fechaCopia });
      this.avisos.ok(`Viaje N° ${x.numero} copiado como N° ${r.numero}`);
      this.copiando.set(''); this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
  async eliminar(x: any) {
    try { await this.api.delete(`/viajes/${x._id}`); this.avisos.ok(`Viaje N° ${x.numero} eliminado`); this.cargar(); }
    catch (e) { this.avisos.error(e); }
  }

  informe(formato: 'pdf' | 'xlsx') {
    const p = { desde: this.f.desde, hasta: this.f.hasta, cliente: this.f.cliente, formato };
    if (formato === 'pdf') this.visor().ver('/gestion/relaciones/informe', 'Informe de utilidad por empresa', { ...p, ver: '1' });
    else this.api.descargar('/gestion/relaciones/informe', p, 'informe_utilidad.xlsx').catch(e => this.avisos.error(e));
  }

  // ── Registro masivo ──
  readonly masivoAbierto = signal(false);
  readonly ocupado = signal(false);
  readonly previa = signal<{ placa: string; dias: any[] } | null>(null);
  readonly elegidos = signal(new Set<string>());
  readonly placasConductor = signal<string[]>([]);
  m: any = {};
  readonly tarifasCliente = computed(() => this.tarifas().filter(t => (t.cliente?._id || t.cliente) === this.mCliente() && t.activo !== false));
  readonly mCliente = signal('');

  abrirMasivo() {
    this.m = { cliente: this.f.cliente, tarifaRef: '', destino: '', conductor: '', placa: this.f.placa.toUpperCase(), desde: hoy(), hasta: finQuincena(),
      cantidad: 1, planilla: '', incluirSabados: true, conAuxiliar: false, diasAuxiliar: null, requiereManifiesto: false };
    this.mCliente.set(this.m.cliente);
    this.previa.set(null); this.placasConductor.set([]);
    this.masivoAbierto.set(true);
  }
  elegirDestino() { this.m.destino = this.tarifasCliente().find(t => t._id === this.m.tarifaRef)?.destino || ''; }
  elegirConductor(t: any) {
    const placas: string[] = t?.placas || [];
    this.placasConductor.set(placas);
    if (placas.length && !this.m.placa) this.m.placa = placas[0];
    this.previa.set(null);
  }
  masivoValido() {
    return !!(this.m.cliente && this.m.destino && this.m.conductor && /^[A-Z0-9]{5,6}$/.test(this.m.placa || '') && this.m.desde && this.m.hasta && this.m.desde <= this.m.hasta);
  }
  private cuerpo() {
    const c: any = { ...this.m };
    if (!c.tarifaRef) delete c.tarifaRef;
    if (c.diasAuxiliar === null || c.diasAuxiliar === '') delete c.diasAuxiliar;
    return c;
  }
  async verDias() {
    this.ocupado.set(true);
    try {
      const pv = await this.api.post<any>('/gestion/relaciones/masivo/previa', this.cuerpo());
      this.previa.set(pv);
      this.elegidos.set(new Set(pv.dias.filter((x: any) => x.registrar).map((x: any) => x.fecha)));
    } catch (e) { this.avisos.error(e); }
    finally { this.ocupado.set(false); }
  }
  alternarDia(f: string) {
    const s = new Set(this.elegidos());
    if (s.has(f)) s.delete(f); else s.add(f);
    this.elegidos.set(s);
  }
  async registrarMasivo() {
    this.ocupado.set(true);
    try {
      const r = await this.api.post<any>('/gestion/relaciones/masivo', { ...this.cuerpo(), dias: [...this.elegidos()] });
      this.avisos.ok(`${r.creados.length} viaje(s) registrados: N° ${r.creados[0]}${r.creados.length > 1 ? ` a ${r.creados[r.creados.length - 1]}` : ''}`);
      this.masivoAbierto.set(false);
      this.f = { ...this.f, cliente: this.m.cliente, placa: this.m.placa };
      this.cargar();
    } catch (e) { this.avisos.error(e); }
    finally { this.ocupado.set(false); }
  }
}
