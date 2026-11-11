import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { AutorizacionAdmin } from '../core/autorizacion.service';
import { EnVivo } from '../core/en-vivo.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { Moneda } from './moneda';
import { BuscarTercero } from './buscar-tercero';
import { FechaHoraPipe, PesosPipe } from './formato';
import { hoyIso } from './formato';

type Tipo = 'urbano' | 'correria';
interface Fila {
  item: string; n: number; tipo: Tipo; placa: string; planilla: string; conductor: string | null; conductorNombre: string; avisoConductor: string;
  tarifaRef: string | null; destino: string; tarifa: number; flete: number; anticipo: number; requiereManifiesto: boolean; auxiliar: number; auxiliarPagado: boolean; destinoEscrito: string;
  registrado: string | null; repetidos: string[]; elegida: boolean; estadoEnvio?: 'ok' | 'error'; error?: string; numero?: number;
}
const TITULO: Record<Tipo, string> = { urbano: 'Urbanos', correria: 'Correrías' };

// Cargues del día que reportan los jefes de bodega: estado por cliente, envío del enlace y revisión antes de registrar.
// Cada viaje se registra con el mismo proceso de «Registrar viaje» (repetidos, documentos vencidos, mes cerrado, tarifa).
@Component({
  selector: 'app-cargues-bodega',
  imports: [FormsModule, Modal, Icono, Moneda, BuscarTercero, FechaHoraPipe, PesosPipe],
  template: `
    <app-modal [titulo]="rev() ? 'Revisar cargues · ' + rev().cliente.nombre : 'Cargues de bodega'" [abierto]="abierto()" (cerrar)="salir()" [ancho]="true">
      @if (!rev()) {
        <div class="cab-dia">
          <div class="segmentos" role="tablist" aria-label="Día">
            <button type="button" role="tab" [class.activo]="dia() === hoy" [attr.aria-selected]="dia() === hoy" (click)="verDia(hoy)">Hoy</button>
            <button type="button" role="tab" [class.activo]="dia() === ayer" [attr.aria-selected]="dia() === ayer" (click)="verDia(ayer)">Ayer</button>
          </div>
          <span class="sutil fecha">{{ resumen()?.fechaTexto }}</span>
          @if (dia() === hoy && sinEnviar().length) {
            <button type="button" class="primario" (click)="enviar(sinEnviar())" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="15" />Enviar a {{ sinEnviar().length }} sin enviar</button>
          }
        </div>
        <p class="sutil ayuda">El jefe de bodega recibe por WhatsApp un enlace del día, entra con su cédula y marca los vehículos que cargaron. Aquí se revisan antes de registrarlos.</p>

        @if (cargando()) { <p class="sutil">Cargando…</p> }
        @for (c of resumen()?.clientes || []; track c._id) {
          <div class="cli">
            <div class="cli-datos">
              <strong>{{ c.nombre }}</strong>
              <small class="sutil">{{ jefesTexto(c) }}{{ c.automatico ? ' · envío automático ' + c.automatico : '' }}</small>
              @if (c.reporte?.destinatarios?.length) {
                @for (d of c.reporte.destinatarios; track $index) { @if (!d.ok) { <small class="error-texto">No se envió a {{ d.nombre }}: {{ d.error }}</small> } }
              }
            </div>
            <div class="cli-estado">
              @if (!c.reporte?.enviadoEn && !c.reporte?.reportadoEn) { <span class="chip">Sin enviar</span> }
              @else if (!c.reporte?.reportadoEn && !algunoEnviado(c)) { <span class="chip error">No se pudo enviar</span> }
              @else if (!c.reporte?.reportadoEn) { <span class="chip alerta">Enviado {{ c.reporte.enviadoEn | fechaHora }} · sin respuesta</span> }
              @else {
                @for (t of TIPOS; track t) {
                  @if (c.reporte[t].viajes) {
                    <span class="chip" [class.ok]="c.reporte[t].registrados >= c.reporte[t].viajes" [class.info]="c.reporte[t].registrados < c.reporte[t].viajes">
                      {{ TITULO[t] }}: {{ c.reporte[t].registrados }}/{{ c.reporte[t].viajes }} registrados</span>
                  }
                }
                @if (!c.reporte.urbano.viajes && !c.reporte.correria.viajes) { <span class="chip">Reportó: ninguno cargó</span> }
              }
            </div>
            <div class="cli-acciones">
              @if (c.reporte?.reportadoEn) { <button type="button" class="pequeno primario" (click)="abrirRevision(c.reporte._id)">Revisar</button> }
              @if (dia() === hoy && c.activa) {
                <button type="button" class="pequeno" (click)="enviar([c])" [disabled]="trabajando()">{{ c.reporte?.enviadoEn ? 'Reenviar' : 'Enviar' }}</button>
                @if (c.reporte?.enviadoEn) { <button type="button" class="pequeno" (click)="copiarEnlace(c.reporte._id)" title="Para compartirlo por otro medio">Copiar enlace</button> }
              }
            </div>
          </div>
        } @empty {
          @if (!cargando()) { <div class="vacio"><strong>Ningún cliente tiene la solicitud activa</strong>Actívela en Clientes y tarifas → Cargues por WhatsApp.</div> }
        }
      } @else {
        @if (rev(); as r) {
          <div class="cab-rev">
            <button type="button" class="pequeno" (click)="volver()">← Clientes del día</button>
            <span class="sutil">Reportó {{ r.jefe || 'el jefe de bodega' }} · {{ r.reportadoEn | fechaHora }} · viajes del <strong>{{ r.fechaTexto }}</strong></span>
          </div>
          <div class="pestanas" role="tablist">
            @for (t of TIPOS; track t) {
              <button type="button" role="tab" [class.activa]="tipo() === t" [attr.aria-selected]="tipo() === t" (click)="tipo.set(t)">{{ TITULO[t] }}<span class="chip sin-punto">{{ filasDe(t).length }}</span></button>
            }
          </div>
          @if (!visibles().length) { <div class="vacio">La bodega no reportó {{ TITULO[tipo()].toLowerCase() }} ese día.</div> }
          @else {
            <div class="tabla-caja"><table class="tabla-movil rev">
              <thead><tr><th class="col-sel"><input type="checkbox" aria-label="Elegir todos los que se pueden registrar" [checked]="todasElegidas()" (change)="elegirTodas($any($event.target).checked)" /></th>
                <th>Vehículo</th><th>Destino y planilla</th><th>Valores</th><th>Documento y auxiliar</th><th>Estado</th></tr></thead>
              <tbody>@for (f of visibles(); track f.item + f.n) {
                <tr [class.apagada]="!!f.registrado">
                  <td class="col-sel" data-etiqueta="Registrar"><input type="checkbox" [checked]="f.elegida" [disabled]="!sePuede(f)" (change)="poner(f, { elegida: $any($event.target).checked })" [attr.aria-label]="'Registrar ' + f.placa" /></td>
                  <td data-etiqueta="Vehículo" class="col-veh">
                    <div class="placa-fila"><span class="placa">{{ f.placa }}</span>@if (f.n > 0) { <small class="sutil">viaje {{ f.n + 1 }}</small> }</div>
                    @if (f.registrado) { <span class="nombre">{{ f.conductorNombre }}</span> }
                    @else {
                      <app-buscar-tercero rol="conductor" [conPlacas]="true" [valor]="f.conductor || ''" (elegido)="ponerConductor(f, $event)" placeholder="Elegir conductor" />
                      @if (f.avisoConductor) { <small class="sutil d-bloque">{{ f.avisoConductor }}</small> }
                    }
                  </td>
                  <td data-etiqueta="Destino y planilla" class="col-dest">
                    @if (f.registrado) { <span>{{ f.destino }}</span><small class="sutil d-bloque">Planilla {{ f.planilla || '—' }}</small> }
                    @else {
                      <select [ngModel]="f.tarifaRef || ''" (ngModelChange)="ponerDestino(f, $event)" [attr.aria-label]="'Destino de ' + f.placa">
                        <option value="">Elegir destino…</option>@for (d of destinosDe(f.tipo); track d._id) { <option [value]="d._id">{{ d.destino }}</option> }</select>
                      @if (f.destinoEscrito) { <small class="sutil d-bloque">La bodega escribió: «{{ f.destinoEscrito }}»</small> }
                      <input class="planilla" maxlength="30" [ngModel]="f.planilla" (ngModelChange)="poner(f, { planilla: $event })" placeholder="Planilla" [attr.aria-label]="'Planilla de ' + f.placa" />
                    }
                  </td>
                  <td data-etiqueta="Valores" class="col-val">
                    @if (f.registrado) { <span class="val"><small>Tarifa</small>{{ f.tarifa | pesos }}</span><span class="val"><small>Flete</small>{{ f.flete | pesos }}</span><span class="val"><small>Anticipo</small>{{ f.anticipo | pesos }}</span> }
                    @else {
                      <label class="val"><small>Tarifa</small><span class="moneda"><input moneda [ngModel]="f.tarifa" (ngModelChange)="poner(f, { tarifa: $event || 0 })" /></span></label>
                      <label class="val"><small>Flete</small><span class="moneda"><input moneda [ngModel]="f.flete" (ngModelChange)="poner(f, { flete: $event || 0 })" /></span></label>
                      <label class="val"><small>Anticipo</small><span class="moneda"><input moneda [ngModel]="f.anticipo" (ngModelChange)="poner(f, { anticipo: $event || 0 })" /></span></label>
                    }
                  </td>
                  <td data-etiqueta="Documento y auxiliar" class="col-doc">
                    @if (f.registrado) { <span>{{ f.requiereManifiesto ? 'Manifiesto RNDC' : 'Soporte interno' }}</span><small class="sutil d-bloque">{{ f.auxiliar ? f.auxiliar + ' auxiliar' + (f.auxiliar > 1 ? 'es' : '') + (f.auxiliarPagado ? ' · pagado' : '') : 'Sin auxiliar' }}</small> }
                    @else {
                      <select [ngModel]="f.requiereManifiesto" (ngModelChange)="poner(f, { requiereManifiesto: $event })" [attr.aria-label]="'Documento de ' + f.placa">
                        <option [ngValue]="true">Manifiesto</option><option [ngValue]="false">Soporte interno</option></select>
                      <div class="aux">
                        <select class="sel-aux" [ngModel]="f.auxiliar" (ngModelChange)="poner(f, { auxiliar: $event })" [attr.aria-label]="'Auxiliares de ' + f.placa">
                          <option [ngValue]="0">Sin auxiliar</option>@for (n of [1, 2, 3, 4, 5]; track n) { <option [ngValue]="n">{{ n }} auxiliar{{ n > 1 ? 'es' : '' }}</option> }</select>
                        @if (f.auxiliar) { <label class="casilla"><input type="checkbox" [checked]="f.auxiliarPagado" (change)="poner(f, { auxiliarPagado: $any($event.target).checked })" />Pagado</label> }
                      </div>
                    }
                  </td>
                  <td data-etiqueta="Estado" class="col-estado">
                    @if (f.registrado) { <span class="chip ok sin-punto">Registrado{{ r.numeros[f.registrado] ? ' N° ' + r.numeros[f.registrado] : '' }}</span> }
                    @else if (f.estadoEnvio === 'error') { <span class="chip error sin-punto">No se registró</span><small class="error-texto d-bloque">{{ f.error }}</small> }
                    @else if (!f.conductor || !f.tarifaRef) { <span class="chip error sin-punto">Falta {{ !f.conductor ? 'conductor' : 'destino' }}</span> }
                    @else if (f.repetidos.length) { <span class="chip alerta sin-punto">Ya hay viaje ese día</span><small class="sutil d-bloque">{{ f.repetidos.join(', ') }}</small> }
                    @else { <span class="chip sin-punto">Listo</span> }
                  </td>
                </tr>
              }</tbody>
            </table></div>
          }
        }
      }
      <ng-container pie>
        <button type="button" (click)="rev() ? volver() : salir()">{{ rev() ? 'Volver' : 'Cerrar' }}</button>
        @if (rev()) {
          <button type="button" class="primario" (click)="registrar()" [disabled]="!elegidas().length || trabajando()">
            {{ trabajando() ? 'Registrando ' + progreso() + '…' : 'Registrar ' + elegidas().length + ' viaje' + (elegidas().length === 1 ? '' : 's') }}</button>
        }
      </ng-container>
    </app-modal>`,
  styles: [`
    .cab-dia { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; } .cab-dia .fecha { text-transform: capitalize; flex: 1; min-width: 140px; }
    .ayuda { margin: 10px 0 12px; font-size: 13px; }
    .cli { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.3fr) auto; gap: 8px 14px; align-items: center; padding: 12px 2px; border-top: 1px solid var(--gris-2); }
    .cli-datos { display: grid; gap: 2px; min-width: 0; } .cli-datos strong { font-size: 14.5px; } .cli-datos small { overflow-wrap: anywhere; }
    .cli-estado { display: flex; flex-wrap: wrap; gap: 6px; } .cli-acciones { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .error-texto { color: var(--rojo); font-size: 12px; }
    .vacio { padding: 22px 8px; text-align: center; display: grid; gap: 4px; color: var(--gris-5); }
    .cab-rev { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 10px; font-size: 13px; }
    .tabla-caja { max-height: 58vh; overflow: auto; box-shadow: none; }
    table.rev { font-size: 13px; width: 100%; } table.rev td { vertical-align: top; padding-top: 10px; padding-bottom: 10px; }
    .col-sel { width: 34px; } .col-sel input { width: 18px; height: 18px; min-height: 0; }
    .col-veh { min-width: 200px; } .placa-fila { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; } .nombre { display: block; }
    .col-dest { min-width: 160px; } .col-dest select, .col-doc select { width: 100%; } .planilla { width: 100%; margin-top: 6px; }
    .col-val { min-width: 230px; } .val { display: grid; grid-template-columns: 56px minmax(0, 1fr); align-items: center; gap: 6px; margin-bottom: 4px; }
    .val small { color: var(--gris-5); font-size: 11.5px; } .val .moneda { width: 100%; } .val .moneda input { width: 100%; min-width: 0; min-height: 32px; font-size: 13px; }
    .col-doc { min-width: 175px; } .sel-aux { width: auto; min-height: 30px; font-size: 12.5px; } .aux { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 6px; } .aux .casilla { margin: 0; font-size: 12.5px; }
    .col-estado { width: 1%; min-width: 110px; } .d-bloque { display: block; margin-top: 4px; font-size: 11.5px; }
    tr.apagada td { background: var(--gris-1); }
    @media (max-width: 760px) { .cli { grid-template-columns: 1fr; } .cli-acciones { justify-content: flex-start; } }
  `],
})
export class CarguesBodega {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private autorizacion = inject(AutorizacionAdmin);
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly registrados = output<void>();
  readonly TIPOS: Tipo[] = ['urbano', 'correria'];
  readonly TITULO = TITULO;
  readonly hoy = hoyIso();
  readonly ayer = new Date(new Date(`${hoyIso()}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  readonly dia = signal(this.hoy);
  readonly resumen = signal<any>(null);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly progreso = signal('');
  readonly rev = signal<any>(null);
  readonly filas = signal<Fila[]>([]);
  readonly tipo = signal<Tipo>('urbano');
  private abiertoAntes = false;

  // Lo que reporta la bodega llega en vivo
  private enVivo = inject(EnVivo).al(['bodega'], () => { if (this.abierto()) this.refrescar(); });

  readonly sinEnviar = computed(() => (this.resumen()?.clientes || []).filter((c: any) => c.activa && !c.reporte?.enviadoEn));
  readonly visibles = computed(() => this.filas().filter(f => f.tipo === this.tipo()));
  readonly elegidas = computed(() => this.filas().filter(f => f.elegida && this.sePuede(f)));

  ngDoCheck() {
    if (this.abierto() && !this.abiertoAntes) { this.abiertoAntes = true; this.dia.set(this.hoy); this.rev.set(null); this.cargar(); }
    if (!this.abierto()) this.abiertoAntes = false;
  }

  algunoEnviado(c: any) { return (c.reporte?.destinatarios || []).some((d: any) => d.ok); }
  jefesTexto(c: any) { return c.jefes.length ? c.jefes.map((j: any) => j.nombre).join(', ') : 'Sin jefe de bodega'; }
  filasDe(t: Tipo) { return this.filas().filter(f => f.tipo === t); }
  destinosDe(t: Tipo) { return (this.rev()?.destinos || []).filter((d: any) => d.tipo === t); }
  sePuede(f: Fila) { return !f.registrado && !!f.conductor && !!f.tarifaRef; }
  todasElegidas() { const l = this.visibles().filter(f => this.sePuede(f)); return !!l.length && l.every(f => f.elegida); }
  elegirTodas(v: boolean) { const ids = new Set(this.visibles().filter(f => this.sePuede(f)).map(f => f.item + f.n)); this.filas.update(l => l.map(f => (ids.has(f.item + f.n) ? { ...f, elegida: v } : f))); }
  poner(f: Fila, cambios: Partial<Fila>) { this.filas.update(l => l.map(x => (x.item === f.item && x.n === f.n ? { ...x, estadoEnvio: undefined, error: undefined, ...cambios } : x))); }
  ponerConductor(f: Fila, t: any) { if (t?._id) this.poner(f, { conductor: t._id, conductorNombre: [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') }); }
  ponerDestino(f: Fila, id: string) {
    const d = this.destinosDe(f.tipo).find((x: any) => x._id === id);
    this.poner(f, d ? { tarifaRef: d._id, destino: d.destino, tarifa: d.tarifa, flete: d.flete, anticipo: d.anticipo } : { tarifaRef: null, destino: '' });
  }

  verDia(d: string) { if (d !== this.dia()) { this.dia.set(d); this.cargar(); } }
  async cargar() {
    this.cargando.set(true);
    try { this.resumen.set(await this.api.get<any>('/bodega/dia', { fecha: this.dia() })); }
    catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  // Actualización en vivo: en la revisión solo se agregan renglones nuevos (no se pierde lo que se está editando)
  private async refrescar() {
    if (!this.rev()) return this.cargar();
    try {
      const r = await this.api.get<any>(`/bodega/reportes/${this.rev()._id}`);
      const actuales = new Map(this.filas().map(f => [f.item + f.n, f]));
      this.rev.set(r);
      this.filas.set(r.filas.map((f: any) => { const a = actuales.get(f.item + f.n); return a && !f.registrado ? a : this.nueva(f); }));
    } catch { /* se intentará en el próximo cambio */ }
  }
  private nueva(f: any): Fila { return { ...f, elegida: !f.registrado && !!f.conductor && !!f.tarifaRef && !f.repetidos.length }; }

  async enviar(clientes: any[]) {
    const reenviar = clientes.filter(c => c.reporte?.enviadoEn).length;
    if (reenviar && !confirm(`Se enviará otra vez el mismo enlace de hoy a ${clientes.length === 1 ? clientes[0].nombre : clientes.length + ' clientes'}. ¿Continuar?`)) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/bodega/enviar', { clientes: clientes.map(c => c._id) });
      const ok = r.resultados.filter((x: any) => !x.error && x.enviados > 0).length;
      const malos = r.resultados.filter((x: any) => x.error || !x.enviados);
      if (ok) this.avisos.ok(`Enlace enviado a ${ok} cliente${ok === 1 ? '' : 's'}`);
      if (malos.length) this.avisos.mostrar(malos.map((x: any) => x.error || `${x.cliente}: no se pudo enviar por WhatsApp`).join(' · '), 'error', 9000);
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async copiarEnlace(id: string) {
    try {
      const r = await this.api.get<any>(`/bodega/reportes/${id}/enlace`);
      await navigator.clipboard.writeText(r.enlace);
      this.avisos.ok('Enlace copiado: vence hoy a las 11:59 p. m.');
    } catch (e) { this.avisos.error(e); }
  }

  async abrirRevision(id: string) {
    try {
      const r = await this.api.get<any>(`/bodega/reportes/${id}`);
      this.rev.set(r); this.filas.set(r.filas.map((f: any) => this.nueva(f)));
      this.tipo.set(this.filasDe('urbano').length || !this.filasDe('correria').length ? 'urbano' : 'correria');
    } catch (e) { this.avisos.error(e); }
  }
  volver() { this.rev.set(null); this.filas.set([]); this.cargar(); }
  salir() { this.rev.set(null); this.filas.set([]); this.cerrar.emit(); }

  // Igual que «Registrar viaje»: se confirma si la placa ya tiene viaje ese día y los documentos vencidos piden al administrador
  async registrar() {
    const l = this.elegidas(); const r = this.rev(); if (!l.length || !r) return;
    this.trabajando.set(true);
    let hechos = 0;
    try {
      for (const [i, f] of l.entries()) {
        this.progreso.set(`${i + 1} de ${l.length}`);
        const cuerpo: any = { fecha: r.fecha, cliente: r.cliente._id, tarifaRef: f.tarifaRef, destino: f.destino, placa: f.placa, conductor: f.conductor, cantidad: 1,
          planilla: f.planilla || '', tarifa: f.tarifa || 0, flete: f.flete || 0, anticipo: f.anticipo || 0, conAuxiliar: f.auxiliar > 0, diasAuxiliar: f.auxiliar || 0,
          auxiliarPagado: f.auxiliar > 0 ? f.auxiliarPagado : null, requiereManifiesto: f.requiereManifiesto, observaciones: `Reporte de bodega · ${r.jefe || 'jefe de bodega'}` };
        let viaje: any = null; let autorizacion: any = null; let error = '';
        for (let intento = 0; intento < 3 && !viaje && !error; intento++) {
          try { viaje = await this.api.post<any>('/viajes', autorizacion ? { ...cuerpo, autorizacion } : cuerpo); }
          catch (e) {
            if (e instanceof HttpErrorResponse && e.status === 428 && !cuerpo.confirmarRepetido) {
              const det = Array.isArray(e.error?.detalles) ? `\n\n${e.error.detalles.join('\n')}` : '';
              if (confirm(`${f.placa}: ${e.error?.error || 'ya tiene viaje ese día.'}${det}\n\n¿Es otro viaje distinto y lo registra de todas formas?`)) { cuerpo.confirmarRepetido = true; continue; }
              error = 'No se registró: ya tenía viaje ese día'; break;
            }
            const vencidos = AutorizacionAdmin.vencidosDe(e);
            if (vencidos && !autorizacion) { autorizacion = await this.autorizacion.pedir(vencidos); if (!autorizacion) { error = 'Documentos vencidos sin autorización'; break; } continue; }
            error = e instanceof HttpErrorResponse ? (e.error?.error || 'No se pudo registrar') : 'No se pudo registrar';
          }
        }
        if (viaje) {
          try { await this.api.post(`/bodega/reportes/${r._id}/vincular`, { item: f.item, viaje: viaje._id }); } catch { /* el viaje quedó registrado igual */ }
          this.poner(f, { registrado: viaje._id, elegida: false });
          this.rev.update(x => ({ ...x, numeros: { ...x.numeros, [viaje._id]: viaje.numero } }));
          hechos++;
        } else this.poner(f, { estadoEnvio: 'error', error, elegida: false });
      }
    } finally { this.trabajando.set(false); this.progreso.set(''); }
    if (hechos) { this.avisos.ok(`${hechos} viaje${hechos === 1 ? '' : 's'} registrado${hechos === 1 ? '' : 's'}`); this.registrados.emit(); }
  }
}
