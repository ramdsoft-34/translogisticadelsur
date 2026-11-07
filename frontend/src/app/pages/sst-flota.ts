import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api, mensajeError } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { FORMATOS } from '../shared/formato';
import { CHIP_VENCE, ESTILOS_SST, EstadoVence, aIso, hoyIso } from './sst-comun';

interface Vence { vence: string; estado: EstadoVence }
interface Vehiculo {
  id: string; placa: string; marca: string; modelo: number | null; conductor: string; soat: Vence | null; tecnomecanica: Vence | null; polizasRc: Vence | null;
  kilometraje: { valor: number | null; fecha: string | null; fuente: string; bajo: boolean };
  proximoMantenimiento: { actividad: string; estado: EstadoVence; texto: string } | null; tienePlan: boolean;
  ultimoPreoperacional: { fecha: string; resultado: string; id: string } | null;
}
interface Actividad { id?: string; actividad: string; cadaKm: number | null; cadaDias: number | null; ultimoKm: number | null; ultimaFecha: string | null; estado?: EstadoVence; texto?: string }
interface Hoja {
  vehiculo: { id: string; placa: string; marca: string; linea: string; modelo: number | null; soat: string | null; tecnomecanica: string | null };
  kilometraje: { valor: number | null; fecha: string | null; fuente: string; bajo: boolean; maximo?: number };
  rcContractual: { vence: string | null; numero: string }; rcExtracontractual: { vence: string | null; numero: string };
  plan: Actividad[];
  historial: { id: string; fecha: string; tipo: string; actividad: string; km: number | null; taller: string; costo: number }[];
}
interface Inspeccion {
  checklistId: string; fecha: string; dia: string; placa: string; kilometraje: number; resultado: 'apto' | 'no_apto'; criticosMal: string[]; noCumplen: string[];
  conductor: { nombre: string; cedula: string } | null; autorizacion: { por: string; motivo: string } | null; revision: { por: string; accion: string; fecha: string } | null;
  repeticion?: { por: string; motivo: string; fecha: string; usadaPor?: string } | null;
}
const FUENTES: Record<string, string> = { web: 'registrado en la web', preoperacional: 'del preoperacional', mantenimiento: 'del último mantenimiento' };

// Flota e inspecciones: documentos, pólizas y mantenimiento de cada vehículo, y los preoperacionales de la app.
@Component({
  selector: 'app-sst-flota',
  imports: [FormsModule, Icono, Modal, Confirmar, VisorPdf, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Flota e inspecciones</h1>
        <p class="sutil">Documentos, pólizas y mantenimiento preventivo de cada vehículo, con las inspecciones preoperacionales que hacen los conductores desde el celular.</p></div>
    </div>

    <div class="pestanas" role="tablist">
      <button type="button" role="tab" [class.activa]="vista() === 'vehiculos'" (click)="vista.set('vehiculos')">Vehículos ({{ flota().length }})</button>
      <button type="button" role="tab" [class.activa]="vista() === 'inspecciones'" (click)="verInspecciones()">Inspecciones</button>
    </div>

    @if (vista() === 'vehiculos') {
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>Vehículo</th><th>Documentos</th><th>Próximo mantenimiento</th><th>Último preoperacional</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
        <tbody>
          @for (v of flota(); track v.id) {
            <tr>
              <td data-etiqueta="Vehículo"><div class="celda-doble"><span><span class="placa">{{ v.placa }}</span> <small class="sutil">{{ v.marca }} {{ v.modelo || '' }}</small></span>
                <small>{{ v.conductor || 'Sin conductor habitual' }}</small>
                <small>@if (v.kilometraje.valor !== null) { {{ v.kilometraje.valor | miles }} km } @else { Sin kilometraje }</small></div></td>
              <td data-etiqueta="Documentos"><ul class="docs">
                <li><span>SOAT</span>@if (v.soat; as x) { <span class="chip" [class]="CHIP[x.estado]">{{ x.vence | dia }}</span> } @else { <span class="sutil">Sin dato</span> }</li>
                <li><span>Técnico-mecánica</span>@if (v.tecnomecanica; as x) { <span class="chip" [class]="CHIP[x.estado]">{{ x.vence | dia }}</span> } @else { <span class="sutil">Sin dato</span> }</li>
                <li><span>Pólizas RC</span>@if (v.polizasRc; as x) { <span class="chip" [class]="CHIP[x.estado]">{{ x.vence | dia }}</span> } @else { <span class="sutil">Sin dato</span> }</li>
              </ul></td>
              <td data-etiqueta="Próximo mantenimiento">@if (v.proximoMantenimiento; as m) { <div class="celda-doble"><span [class.texto-error]="m.estado === 'vencido'" [class.texto-alerta]="m.estado === 'semana' || m.estado === 'mes'">{{ m.actividad }}</span><small>{{ m.texto }}</small></div> }
                @else { <span class="sutil">{{ v.tienePlan ? 'Al día' : 'Sin plan' }}</span> }</td>
              <td data-etiqueta="Último preoperacional">@if (v.ultimoPreoperacional; as u) { <div class="celda-doble"><span class="chip" [class.ok]="u.resultado === 'apto'" [class.error]="u.resultado !== 'apto'">{{ u.resultado === 'apto' ? 'Apto' : 'No apto' }}</span><small>{{ u.fecha | fechaHora }}</small></div> }
                @else { <span class="sutil">Nunca</span> }</td>
              <td class="celda-acciones"><div class="acciones"><button class="pequeno" (click)="abrirHoja(v.id)">Hoja de vida</button></div></td>
            </tr>
          } @empty {
            @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="5"><span class="esqueleto"></span></td></tr> } }
            @else { <tr><td colspan="5" class="vacio"><strong>Sin vehículos</strong>Los vehículos se registran en Datos → Vehículos.</td></tr> }
          }
        </tbody>
      </table></div>
    } @else {
      <div class="barra">
        <div class="campo"><label for="i-d">Desde</label><input id="i-d" type="date" [(ngModel)]="fDesde" [max]="hoy" /></div>
        <div class="campo"><label for="i-h">Hasta</label><input id="i-h" type="date" [(ngModel)]="fHasta" [max]="hoy" /></div>
        <div class="campo"><label for="i-p">Placa</label><input id="i-p" [(ngModel)]="fPlaca" maxlength="7" /></div>
        <div class="campo"><label for="i-r">Resultado</label><select id="i-r" [(ngModel)]="fResultado"><option value="">Todos</option><option value="apto">Apto</option><option value="no_apto">No apto</option></select></div>
        <button (click)="cargarInspecciones()"><app-icono nombre="buscar" />Consultar</button>
      </div>
      @if (!usaApp()) { <div class="mensaje info" role="status">Las inspecciones las hacen los conductores en la app Sur Track. Esta empresa todavía no usa la app de conductores.</div> }
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>Fecha</th><th>Placa</th><th>Conductor</th><th>Resultado</th><th>Ítems que no cumplen</th><th>Revisión</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
        <tbody>
          @for (i of inspecciones(); track i.checklistId) {
            <tr>
              <td data-etiqueta="Fecha">{{ i.fecha | fechaHora }}</td>
              <td data-etiqueta="Placa"><span class="placa">{{ i.placa }}</span></td>
              <td data-etiqueta="Conductor">{{ i.conductor?.nombre || '—' }}</td>
              <td data-etiqueta="Resultado"><span class="chip" [class.ok]="i.resultado === 'apto'" [class.error]="i.resultado !== 'apto'">{{ i.resultado === 'apto' ? 'Apto' : 'No apto' }}</span>
                @if (i.autorizacion) { <small class="d-bloque">Salida autorizada</small> }
                @if (i.repeticion && !i.repeticion.usadaPor) { <small class="d-bloque">Otro preoperacional habilitado</small> }</td>
              <td data-etiqueta="No cumplen">{{ i.noCumplen.length ? i.noCumplen.length + ' ítem(s)' : '—' }}@if (i.criticosMal.length) { <small class="d-bloque texto-error">{{ i.criticosMal.length }} crítico(s)</small> }</td>
              <td data-etiqueta="Revisión">@if (i.revision; as r) { <div class="celda-doble"><span>{{ r.por }}</span><small>{{ r.accion }}</small></div> } @else { <span class="sutil">Sin revisar</span> }</td>
              <td class="celda-acciones"><div class="acciones">
                <button class="pequeno" (click)="verPdf(i)"><app-icono nombre="ojo" [tam]="15" />PDF</button>
                @if (puede && !i.revision) { <button class="pequeno" (click)="abrirRevision(i)">Cerrar revisión</button> }
                @if (puede && puedeRepetir(i)) { <button class="pequeno" (click)="abrirRepetir(i)" title="El conductor solo puede hacer un preoperacional por día">Habilitar otro hoy</button> }
              </div></td>
            </tr>
          } @empty {
            @if (cargandoInsp()) { @for (i of [1, 2]; track i) { <tr><td colspan="7"><span class="esqueleto"></span></td></tr> } }
            @else { <tr><td colspan="7" class="vacio">Sin inspecciones en ese periodo.</td></tr> }
          }
        </tbody>
      </table></div>
    }

    <!-- Hoja de vida -->
    <app-modal [titulo]="'Hoja de vida · ' + (hoja()?.vehiculo?.placa || '')" [abierto]="!!hoja()" [ancho]="true" (cerrar)="hoja.set(null)">
      @if (hoja(); as h) {
        <form id="form-hoja" (ngSubmit)="guardarHoja()">
          <fieldset [disabled]="!puede">
            <section class="bloque"><h3>Kilometraje y pólizas</h3>
              <div class="formulario">
                <div class="campo"><label for="h-km">Kilometraje actual</label><input id="h-km" name="km" type="number" min="0" inputmode="numeric" [(ngModel)]="km" />
                  @if (h.kilometraje.valor !== null) { <small class="nota">{{ h.kilometraje.valor | miles }} km {{ FUENTES[h.kilometraje.fuente] || '' }}, {{ h.kilometraje.fecha | fechaHora }}</small> }
                  @if (h.kilometraje.bajo) { <small class="texto-error">La última lectura es menor que una anterior ({{ h.kilometraje.maximo | miles }} km). Revise.</small> }</div>
                <div class="campo"><label for="h-rc1">RC contractual vence</label><input id="h-rc1" name="rc1" type="date" [(ngModel)]="rc1" /></div>
                <div class="campo"><label for="h-rc1n">N.º de póliza RC contractual</label><input id="h-rc1n" name="rc1n" [(ngModel)]="rc1n" maxlength="40" /></div>
                <div class="campo"><label for="h-rc2">RC extracontractual vence</label><input id="h-rc2" name="rc2" type="date" [(ngModel)]="rc2" /></div>
                <div class="campo"><label for="h-rc2n">N.º de póliza RC extracontractual</label><input id="h-rc2n" name="rc2n" [(ngModel)]="rc2n" maxlength="40" /></div>
                <div class="campo"><span class="etiqueta">SOAT · técnico-mecánica</span><span class="solo-lectura">{{ (h.vehiculo.soat | dia) || 'Sin dato' }} · {{ (h.vehiculo.tecnomecanica | dia) || 'Sin dato' }}</span>
                  <small class="nota">Se editan en Datos → Vehículos.</small></div>
              </div>
            </section>
            <section class="bloque"><h3>Plan de mantenimiento preventivo</h3>
              <p class="nota">Vence lo que llegue primero: los kilómetros o los días.</p>
              @for (a of plan; track $index) {
                <div class="actividad">
                  <div class="campo crece"><label [for]="'pa' + $index">Actividad</label><input [id]="'pa' + $index" [name]="'pa' + $index" [(ngModel)]="a.actividad" maxlength="120" /></div>
                  <div class="campo"><label [for]="'pk' + $index">Cada km</label><input [id]="'pk' + $index" [name]="'pk' + $index" type="number" min="1" [(ngModel)]="a.cadaKm" /></div>
                  <div class="campo"><label [for]="'pd' + $index">Cada días</label><input [id]="'pd' + $index" [name]="'pd' + $index" type="number" min="1" [(ngModel)]="a.cadaDias" /></div>
                  <div class="campo"><label [for]="'pu' + $index">Último km</label><input [id]="'pu' + $index" [name]="'pu' + $index" type="number" min="0" [(ngModel)]="a.ultimoKm" /></div>
                  <div class="campo"><label [for]="'pf' + $index">Última fecha</label><input [id]="'pf' + $index" [name]="'pf' + $index" type="date" [max]="hoy" [(ngModel)]="a.ultimaFecha" /></div>
                  @if (puede) { <button type="button" class="pequeno texto quitar" (click)="plan.splice($index, 1)" [attr.aria-label]="'Quitar ' + a.actividad"><app-icono nombre="x" [tam]="14" /></button> }
                  @if (a.texto) { <small class="estado-act" [class.texto-error]="a.estado === 'vencido'" [class.texto-alerta]="a.estado === 'semana' || a.estado === 'mes'">{{ a.actividad }}: {{ a.texto }}</small> }
                </div>
              } @empty { <p class="sutil">Sin actividades. Agregue, por ejemplo, «Cambio de aceite y filtros» cada 10.000 km o 180 días.</p> }
              @if (puede) { <button type="button" class="pequeno" (click)="plan.push({ actividad: '', cadaKm: null, cadaDias: null, ultimoKm: null, ultimaFecha: null })"><app-icono nombre="mas" [tam]="14" />Agregar actividad</button> }
            </section>
          </fieldset>
          @if (errorHoja()) { <div class="mensaje error" role="alert">{{ errorHoja() }}
            @if (pideConfirmar()) { <button type="button" class="pequeno" (click)="guardarHoja(true)">Sí, corregir el kilometraje</button> }</div> }
        </form>

        <section class="bloque"><h3>Historial de mantenimientos</h3>
          <div class="tabla-caja"><table class="tabla-movil">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th class="num">Km</th><th>Taller</th><th class="num">Costo</th><th></th></tr></thead>
            <tbody>
              @for (m of h.historial; track m.id) {
                <tr><td data-etiqueta="Fecha">{{ m.fecha | dia }}</td><td data-etiqueta="Tipo"><span class="chip sin-punto" [class.info]="m.tipo === 'preventivo'" [class.alerta]="m.tipo === 'correctivo'">{{ m.tipo }}</span></td>
                  <td data-etiqueta="Actividad">{{ m.actividad }}</td><td data-etiqueta="Km" class="num">{{ m.km !== null ? (m.km | miles) : '—' }}</td>
                  <td data-etiqueta="Taller">{{ m.taller || '—' }}</td><td data-etiqueta="Costo" class="num">{{ m.costo | pesos }}</td>
                  <td class="celda-acciones">@if (puede) { <button class="pequeno texto" confirmar="Clic otra vez para borrar" (confirmado)="quitarMant(m.id)">Borrar</button> }</td></tr>
              } @empty { <tr><td colspan="7" class="vacio">Sin mantenimientos registrados.</td></tr> }
            </tbody>
          </table></div>
          @if (puede) {
            <form class="agregar formulario" (ngSubmit)="agregarMant()">
              <div class="campo"><label for="m-t">Tipo</label><select id="m-t" name="t" [(ngModel)]="mant.tipo"><option value="preventivo">Preventivo</option><option value="correctivo">Correctivo</option></select></div>
              <div class="campo"><label for="m-a">Actividad</label><input id="m-a" name="a" [(ngModel)]="mant.actividad" maxlength="160" list="actividades-plan" required />
                <datalist id="actividades-plan">@for (a of plan; track $index) { <option [value]="a.actividad"></option> }</datalist></div>
              <div class="campo"><label for="m-f">Fecha</label><input id="m-f" name="f" type="date" [max]="hoy" [(ngModel)]="mant.fecha" required /></div>
              <div class="campo"><label for="m-k">Km</label><input id="m-k" name="k" type="number" min="0" [(ngModel)]="mant.km" /></div>
              <div class="campo"><label for="m-ta">Taller</label><input id="m-ta" name="ta" [(ngModel)]="mant.taller" maxlength="120" /></div>
              <div class="campo"><label for="m-c">Costo</label><input id="m-c" name="c" type="number" min="0" [(ngModel)]="mant.costo" /></div>
              <p class="nota ancho">Si la actividad es del plan, se actualizan su último km y su última fecha.</p>
              <div class="acciones ancho"><button type="submit" class="primario pequeno" [disabled]="trabajando()"><app-icono nombre="mas" [tam]="15" />Agregar mantenimiento</button></div>
            </form>
          }
        </section>
      }
      <ng-container pie><button type="button" (click)="hoja.set(null)">Cerrar</button>
        @if (puede) { <button type="submit" form="form-hoja" class="primario" [disabled]="trabajando()">Guardar hoja de vida</button> }</ng-container>
    </app-modal>

    <!-- Cerrar la revisión de una inspección -->
    <app-modal [titulo]="'Revisión · ' + (revisando()?.placa || '')" [abierto]="!!revisando()" (cerrar)="revisando.set(null)">
      <form id="form-rev" class="formulario" (ngSubmit)="revisar()">
        <p class="ancho">Queda como «Revisado por» su nombre, con la fecha de hoy.</p>
        <div class="campo ancho"><label for="r-acc">Acción tomada</label><textarea id="r-acc" name="acc" rows="3" [(ngModel)]="accion" maxlength="1000" required placeholder="Ej.: se cambiaron las luces antes de salir"></textarea></div>
      </form>
      <ng-container pie><button type="button" (click)="revisando.set(null)">Cancelar</button>
        <button type="submit" form="form-rev" class="primario" [disabled]="trabajando() || accion.trim().length < 3">Guardar</button></ng-container>
    </app-modal>

    <!-- Un preoperacional por día: habilitar que el conductor haga otro hoy -->
    <app-modal [titulo]="'Habilitar otro preoperacional · ' + (repitiendo()?.placa || '')" [abierto]="!!repitiendo()" (cerrar)="repitiendo.set(null)">
      <form id="form-rep" class="formulario" (ngSubmit)="permitirRepetir()">
        <p class="ancho">El conductor solo puede hacer un preoperacional por día y no puede cambiarlo. Con esto podrá hacer <b>uno nuevo hoy</b> (una sola vez). Le llega un aviso al celular y queda registrado quién lo habilitó.</p>
        <div class="campo ancho"><label for="rep-mot">Motivo</label><textarea id="rep-mot" name="mot" rows="3" [(ngModel)]="motivoRepetir" maxlength="500" required placeholder="Ej.: se cambió la llanta y debe revisarse de nuevo"></textarea></div>
      </form>
      <ng-container pie><button type="button" (click)="repitiendo.set(null)">Cancelar</button>
        <button type="submit" form="form-rep" class="primario" [disabled]="trabajando() || motivoRepetir.trim().length < 10">{{ trabajando() ? 'Habilitando…' : 'Habilitar' }}</button></ng-container>
    </app-modal>

    <app-visor-pdf #visor />
  `,
  styles: [ESTILOS_SST, `
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
    .docs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .docs li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px; align-items: center; font-size: 12.5px; color: var(--gris-6); }
    td .celda-doble small { overflow-wrap: anywhere; }
    .actividad { display: grid; grid-template-columns: minmax(150px, 2fr) repeat(3, minmax(80px, 1fr)) minmax(150px, 1.3fr) auto; gap: 8px; align-items: end; padding: 8px 0; border-bottom: 1px dashed var(--gris-2); }
    .actividad .estado-act { grid-column: 1 / -1; }
    .actividad .quitar { align-self: center; margin-top: 18px; }
    .solo-lectura { min-height: 40px; display: flex; align-items: center; padding: 0 12px; background: var(--gris-1); border: 1px solid var(--gris-2); border-radius: var(--radio); color: var(--gris-6); }
    .texto-error { color: var(--rojo); font-weight: 600; } .texto-alerta { color: var(--ambar); font-weight: 600; }
    @media (max-width: 800px) { .actividad { grid-template-columns: 1fr 1fr; } .actividad .campo.crece { grid-column: 1 / -1; } }
  `],
})
export class SstFlota {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private visor = viewChild.required<VisorPdf>('visor');
  readonly puede = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly CHIP = CHIP_VENCE; readonly FUENTES = FUENTES;
  readonly hoy = hoyIso();
  readonly vista = signal<'vehiculos' | 'inspecciones'>('vehiculos');
  readonly flota = signal<Vehiculo[]>([]);
  readonly cargando = signal(true);
  readonly inspecciones = signal<Inspeccion[]>([]);
  readonly cargandoInsp = signal(false);
  readonly usaApp = signal(true);
  readonly hoja = signal<Hoja | null>(null);
  readonly trabajando = signal(false);
  readonly errorHoja = signal('');
  readonly pideConfirmar = signal(false);
  readonly revisando = signal<Inspeccion | null>(null);
  readonly repitiendo = signal<Inspeccion | null>(null);
  motivoRepetir = '';
  km: number | null = null; rc1 = ''; rc1n = ''; rc2 = ''; rc2n = ''; plan: Actividad[] = []; accion = '';
  mant = { tipo: 'preventivo', actividad: '', fecha: hoyIso(), km: null as number | null, taller: '', costo: 0 };
  fDesde = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() - 7 * 86400000)); fHasta = hoyIso(); fPlaca = ''; fResultado = '';

  constructor() {
    this.cargar();
    // Desde el menú «Preoperacional» o el tablero se abre directo en Inspecciones
    const ruta = inject(ActivatedRoute).snapshot; const r = ruta.queryParamMap;
    if (r.get('vista') === 'inspecciones' || ruta.data['vista'] === 'inspecciones') { if (r.get('resultado')) this.fResultado = r.get('resultado')!; if (r.get('desde')) this.fDesde = r.get('desde')!; this.verInspecciones(); }
  }

  async cargar() {
    this.cargando.set(true);
    try { this.flota.set(await this.api.get<Vehiculo[]>('/sst/flota')); } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  verInspecciones() { this.vista.set('inspecciones'); this.cargarInspecciones(); }
  async cargarInspecciones() {
    this.cargandoInsp.set(true);
    try {
      const r = await this.api.get<{ usaApp: boolean; items: Inspeccion[] }>('/sst/inspecciones', { desde: this.fDesde, hasta: this.fHasta, placa: this.fPlaca.trim().toUpperCase(), resultado: this.fResultado });
      this.usaApp.set(r.usaApp); this.inspecciones.set(r.items);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoInsp.set(false); }
  }

  verPdf(i: Inspeccion) { this.visor().ver(`/sst/inspecciones/${i.checklistId}/pdf`, `Preoperacional ${i.placa}`); }
  abrirRevision(i: Inspeccion) { this.accion = ''; this.revisando.set(i); }
  // Solo el último preoperacional de hoy de cada conductor, y si no hay ya uno habilitado sin usar
  puedeRepetir(i: Inspeccion) {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    if (i.dia !== hoy || (i.repeticion && !i.repeticion.usadaPor)) return false;
    const delConductor = this.inspecciones().filter(x => x.dia === hoy && x.conductor?.cedula && x.conductor.cedula === i.conductor?.cedula);
    return !delConductor.length || delConductor[0].checklistId === i.checklistId;
  }
  abrirRepetir(i: Inspeccion) { this.motivoRepetir = ''; this.repitiendo.set(i); }
  async permitirRepetir() {
    const i = this.repitiendo(); if (!i || this.motivoRepetir.trim().length < 10) return;
    this.trabajando.set(true);
    try {
      await this.api.post(`/sst/inspecciones/${i.checklistId}/permitir-repetir`, { motivo: this.motivoRepetir.trim() });
      this.repitiendo.set(null); this.avisos.ok('Listo: el conductor puede hacer otro preoperacional hoy. Se le avisó al celular.');
      await this.cargarInspecciones();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async revisar() {
    const i = this.revisando(); if (!i) return;
    this.trabajando.set(true);
    try { await this.api.post(`/sst/inspecciones/${i.checklistId}/revisar`, { accion: this.accion }); this.revisando.set(null); this.avisos.ok('Revisión guardada.'); await this.cargarInspecciones(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async abrirHoja(id: string) {
    try { this.mostrar(await this.api.get<Hoja>(`/sst/flota/${id}`)); } catch (e) { this.avisos.error(e); }
  }
  private mostrar(h: Hoja) {
    this.hoja.set(h); this.errorHoja.set(''); this.pideConfirmar.set(false);
    this.km = h.kilometraje.valor; this.rc1 = aIso(h.rcContractual.vence); this.rc1n = h.rcContractual.numero || ''; this.rc2 = aIso(h.rcExtracontractual.vence); this.rc2n = h.rcExtracontractual.numero || '';
    this.plan = h.plan.map((a) => ({ ...a, ultimaFecha: aIso(a.ultimaFecha) }));
  }

  async guardarHoja(confirmarBaja = false) {
    const h = this.hoja(); if (!h) return;
    this.errorHoja.set(''); this.pideConfirmar.set(false);
    const plan = this.plan.filter((a) => a.actividad.trim());
    for (const a of plan) if (!a.cadaKm && !a.cadaDias) { this.errorHoja.set(`«${a.actividad}»: indique cada cuántos km o cada cuántos días.`); return; }
    this.trabajando.set(true);
    try {
      this.mostrar(await this.api.put<Hoja>(`/sst/flota/${h.vehiculo.id}`, {
        kilometraje: this.km ?? '', confirmarBaja, rcContractual: { vence: this.rc1 || null, numero: this.rc1n }, rcExtracontractual: { vence: this.rc2 || null, numero: this.rc2n },
        plan: plan.map((a) => ({ actividad: a.actividad, cadaKm: a.cadaKm ?? '', cadaDias: a.cadaDias ?? '', ultimoKm: a.ultimoKm ?? '', ultimaFecha: a.ultimaFecha || null })),
      }));
      this.avisos.ok('Hoja de vida guardada.'); this.cargar();
    } catch (e) {
      const m = await mensajeError(e);
      this.errorHoja.set(m); this.pideConfirmar.set(/no puede bajar/i.test(m));
    } finally { this.trabajando.set(false); }
  }

  async agregarMant() {
    const h = this.hoja(); if (!h) return;
    this.trabajando.set(true);
    try {
      this.mostrar(await this.api.post<Hoja>(`/sst/flota/${h.vehiculo.id}/mantenimientos`, { ...this.mant, km: this.mant.km ?? '' }));
      this.mant = { tipo: 'preventivo', actividad: '', fecha: hoyIso(), km: null, taller: '', costo: 0 };
      this.avisos.ok('Mantenimiento registrado.'); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async quitarMant(id: string) {
    const h = this.hoja(); if (!h) return;
    try { this.mostrar(await this.api.delete<Hoja>(`/sst/flota/${h.vehiculo.id}/mantenimientos/${id}`)); } catch (e) { this.avisos.error(e); }
  }
}
