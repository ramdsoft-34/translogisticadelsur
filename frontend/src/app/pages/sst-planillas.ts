import { Paginador } from '../shared/paginador';
import { ListaServidor } from '../shared/lista-servidor';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { FORMATOS } from '../shared/formato';

type Estado = 'pendiente' | 'recibida' | 'vencida' | 'excluida' | 'tardia_habilitada';
interface Version { numero: number; nombre: string; tamano: number; subidoEn: string; origen: 'app' | 'web'; subidoPor: string; vigente: boolean }
interface Planilla {
  id: string; periodo: string; nombrePeriodo: string; terceroId: string; cedula: string; nombre: string; estado: Estado; abierta: boolean;
  limite: string; cierra: string | null; diasRestantes: number | null; recibida: Version | null; cantidadVersiones: number; ingresoTardio: boolean;
  cargaTardia: { por: string; motivo: string; hasta: string; fecha: string } | null; exclusion: { por: string; motivo: string; fecha: string } | null;
  tieneApp?: boolean; versiones?: Version[]; eventos?: { fecha: string; tipo: string; por: string; detalle: string }[];
}
interface Respuesta { periodo: string; ahora: string; indicadores: { total: number; recibidas: number; pendientes: number; vencidas: number; excluidas: number; porDecidir: number; cumplimiento: number | null }; items: Planilla[] }

const ESTADOS: { v: '' | Estado; t: string }[] = [
  { v: '', t: 'Todas' }, { v: 'pendiente', t: 'Pendientes' }, { v: 'recibida', t: 'Recibidas' }, { v: 'vencida', t: 'Vencidas' },
  { v: 'tardia_habilitada', t: 'Carga tardía' }, { v: 'excluida', t: 'Excluidas' },
];
const CHIP: Record<Estado, { t: string; c: string }> = {
  pendiente: { t: 'Pendiente', c: 'alerta' }, recibida: { t: 'Recibida', c: 'ok' }, vencida: { t: 'Vencida', c: 'error' },
  excluida: { t: 'Excluida', c: '' }, tardia_habilitada: { t: 'Carga tardía', c: 'info' },
};
const EVENTOS: Record<string, string> = { subida: 'Subió la planilla', correccion: 'Corrigió la planilla', carga_tardia: 'Habilitó carga tardía', exclusion: 'Excluyó', inclusion: 'Volvió a incluir' };
const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()).slice(0, 7);
const enDias = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(Date.now() + n * 86400000));

// Planillas de seguridad social de los conductores (SG-SST y PESV).
// El conductor sube un PDF por mes desde la app, del día 1 al 5 (hora de Colombia). Después queda vencida
// y solo la oficina habilita una carga tardía. Nada de meses anteriores se reemplaza ni se borra.
@Component({
  selector: 'app-sst-planillas',
  imports: [FormsModule, Icono, Modal, Confirmar, VisorPdf, ...FORMATOS, Paginador],
  template: `
    <div class="pagina-cab">
      <div><h1>Planillas de seguridad social</h1>
        <p class="sutil">Se pide a los conductores que tienen la app: un PDF por mes, del día 1 al 5. Después queda vencida y solo la oficina habilita una carga tardía.</p></div>
      <div class="acciones"><button (click)="exportar()" [disabled]="!planillas.total()"><app-icono nombre="descargar" />Exportar a Excel</button></div>
    </div>

    <div class="filtros">
      <div class="campo"><label for="pl-mes">Mes</label><input id="pl-mes" type="month" [(ngModel)]="periodo" (change)="cargar()" [max]="mesActual" /></div>
      <div class="campo crece"><label for="pl-q">Buscar</label><input id="pl-q" type="search" placeholder="Nombre o cédula" [(ngModel)]="q" (input)="buscarDiferido()" /></div>
    </div>

    @if (datos(); as d) {
      <section class="kpis" aria-label="Resumen del mes">
        <article class="kpi destacado"><header><span>Cumplimiento</span><app-icono nombre="check" [tam]="18" /></header>
          <strong>{{ d.indicadores.cumplimiento ?? '—' }}{{ d.indicadores.cumplimiento !== null ? ' %' : '' }}</strong>
          <footer>{{ d.indicadores.recibidas }} de {{ d.indicadores.total - d.indicadores.excluidas }} conductores</footer></article>
        <article class="kpi"><header><span>Pendientes</span><app-icono nombre="reloj" [tam]="18" /></header><strong>{{ d.indicadores.pendientes }}</strong><footer>Aún pueden subirla</footer></article>
        <article class="kpi"><header><span>Vencidas</span><app-icono nombre="alerta" [tam]="18" /></header><strong>{{ d.indicadores.vencidas }}</strong><footer>No la subieron a tiempo</footer></article>
        <article class="kpi"><header><span>Excluidas</span><app-icono nombre="x" [tam]="18" /></header><strong>{{ d.indicadores.excluidas }}</strong><footer>Este mes no aplica</footer></article>
      </section>
      @if (d.indicadores.porDecidir) {
        <div class="mensaje alerta" role="status"><strong>{{ d.indicadores.porDecidir }} conductor(es) activaron la app después del día 5.</strong>
          Decida en cada uno si habilita la carga tardía o lo excluye este mes.</div>
      }
    }

    <div class="segmentos estados" role="group" aria-label="Filtrar por estado">
      @for (e of ESTADOS; track e.v) { <button type="button" [class.activo]="estado() === e.v" (click)="estado.set(e.v); cargar()">{{ e.t }}</button> }
    </div>

    <div class="tabla-caja">
      <table>
        <thead><tr><th>Conductor</th><th>Estado</th><th>Recibida</th><th class="celda-acciones">Acciones</th></tr></thead>
        <tbody>
          @for (p of planillas.items(); track p.id) {
            <tr>
              <td><div class="celda-doble"><strong>{{ p.nombre || '—' }}</strong>
                <small>C.C. {{ p.cedula }}@if (!p.tieneApp) { · <span class="sin-app">ya no tiene la app</span> }</small></div></td>
              <td><div class="celda-doble">
                <span class="chip" [class]="CHIP[p.estado].c">{{ CHIP[p.estado].t }}</span>
                @if (p.ingresoTardio) { <small class="decidir">Activó la app después del día 5: por decidir</small> }
                @else if (p.estado === 'pendiente' && p.diasRestantes !== null) { <small>{{ p.diasRestantes === 0 ? 'Último día' : 'Faltan ' + p.diasRestantes + ' día(s)' }}</small> }
                @else if (p.estado === 'tardia_habilitada' && p.cierra) { <small>Hasta {{ p.cierra | dia }}</small> }
                @else if (p.exclusion) { <small>{{ p.exclusion.motivo }}</small> }
              </div></td>
              <td>@if (p.recibida; as v) { <div class="celda-doble"><span>{{ v.subidoEn | fechaHora }}</span>
                <small>{{ v.origen === 'web' ? 'Desde la web · ' + v.subidoPor : 'Desde la app' }}@if (p.cantidadVersiones > 1) { · {{ p.cantidadVersiones }} versiones }</small></div> }
                @else { <span class="sutil">—</span> }</td>
              <td class="celda-acciones"><div class="acciones">
                @if (p.recibida) { <button class="pequeno" (click)="verPdf(p)"><app-icono nombre="ojo" [tam]="15" />Ver</button> }
                <button class="pequeno" (click)="abrirHistorial(p)">Historial</button>
                @if (puedeGestionar) {
                  @if (p.abierta) { <button class="pequeno" (click)="abrirSubir(p)"><app-icono nombre="mas" [tam]="15" />{{ p.recibida ? 'Corregir' : 'Subir' }}</button> }
                  @if (!p.recibida && !p.exclusion && !p.abierta) { <button class="pequeno" (click)="abrirTardia(p)">Habilitar carga tardía</button> }
                  @if (!p.recibida && !p.exclusion) { <button class="pequeno" (click)="abrirExcluir(p)">Excluir</button> }
                  @if (p.exclusion) { <button class="pequeno" confirmar="Clic otra vez para volver a incluir" (confirmado)="incluir(p)">Volver a incluir</button> }
                }
              </div></td>
            </tr>
          } @empty {
            @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="4"><span class="esqueleto"></span></td></tr> } }
            @else if (error()) { <tr><td colspan="4" class="vacio"><strong>No se pudo consultar</strong>{{ error() }} <button class="pequeno" (click)="cargar()">Reintentar</button></td></tr> }
            @else { <tr><td colspan="4" class="vacio"><strong>Sin planillas</strong>{{ estado() || q ? 'Ningún conductor con ese filtro.' : 'Ningún conductor tiene la app activada todavía. Invítelos desde Conductores y terceros → App.' }}</td></tr> }
          }
        </tbody>
      </table>
      <app-paginador [total]="planillas.total()" [pagina]="planillas.pagina()" [porPagina]="planillas.porPagina()" [cargando]="planillas.cambiando()" unidad="conductores" (cambio)="planillas.ir($event)" />
    </div>

    <app-visor-pdf />

    <!-- Historial de un conductor: todos los meses, versiones y decisiones -->
    <app-modal [titulo]="'Historial · ' + (sel()?.nombre || '')" [abierto]="modal() === 'historial'" (cerrar)="modal.set(null)">
      @if (historial(); as h) {
        @for (p of h; track p.id) {
          <section class="mes">
            <header><h3>{{ p.nombrePeriodo }}</h3><span class="chip" [class]="CHIP[p.estado].c">{{ CHIP[p.estado].t }}</span></header>
            @if (p.versiones?.length) {
              <ul class="versiones">@for (v of p.versiones; track v.numero) {
                <li><span><strong>Versión {{ v.numero }}</strong>@if (v.vigente) { <span class="chip ok sin-punto">vigente</span> }
                  <small class="d-bloque">{{ v.subidoEn | fechaHora }} · {{ v.origen === 'web' ? 'Web · ' + v.subidoPor : 'App' }} · {{ v.nombre }}</small></span>
                  <button class="pequeno" (click)="verPdf(p, v.numero)"><app-icono nombre="ojo" [tam]="15" />Ver</button></li>
              }</ul>
            } @else { <p class="sutil">Sin archivo.</p> }
            @if (p.eventos?.length) {
              <ul class="eventos">@for (e of p.eventos; track $index) {
                <li><small>{{ e.fecha | fechaHora }}</small> {{ EVENTOS[e.tipo] || e.tipo }}{{ e.por ? ' · ' + e.por : '' }}@if (e.detalle) { <span class="sutil"> — {{ e.detalle }}</span> }</li>
              }</ul>
            }
          </section>
        } @empty { <p class="sutil">Este conductor no tiene planillas registradas.</p> }
      } @else { <p class="sutil">Cargando…</p> }
      <ng-container pie><button type="button" (click)="modal.set(null)">Cerrar</button></ng-container>
    </app-modal>

    <!-- Carga tardía -->
    <app-modal [titulo]="'Habilitar carga tardía · ' + (sel()?.nombre || '')" [abierto]="modal() === 'tardia'" (cerrar)="modal.set(null)">
      <p>El conductor podrá subir la planilla de <strong>{{ sel()?.nombrePeriodo }}</strong> desde la app hasta el final del día que elija. Queda registrado quién la habilitó y por qué.</p>
      <form id="form-tardia" class="formulario" (ngSubmit)="habilitarTardia()">
        <div class="campo"><label for="pl-hasta">Hasta</label><input id="pl-hasta" name="hasta" type="date" [(ngModel)]="hasta" [min]="manana" [max]="maxTardia" required /></div>
        <div class="campo ancho"><label for="pl-motivo-t">Motivo</label><textarea id="pl-motivo-t" name="motivo" rows="2" maxlength="500" [(ngModel)]="motivo" required placeholder="Ej.: estuvo incapacitado del 1 al 6"></textarea></div>
      </form>
      <ng-container pie><button type="button" (click)="modal.set(null)">Cancelar</button>
        <button type="submit" class="primario" form="form-tardia" [disabled]="trabajando() || motivo.trim().length < 5 || !hasta">Habilitar</button></ng-container>
    </app-modal>

    <!-- Excluir -->
    <app-modal [titulo]="'Excluir de la planilla · ' + (sel()?.nombre || '')" [abierto]="modal() === 'excluir'" (cerrar)="modal.set(null)">
      <p>Este mes no se le pedirá la planilla ni recibirá recordatorios. Puede volver a incluirlo después.</p>
      <form id="form-excluir" class="formulario" (ngSubmit)="excluir()">
        <div class="campo ancho"><label for="pl-motivo-e">Motivo</label><textarea id="pl-motivo-e" name="motivo" rows="2" maxlength="500" [(ngModel)]="motivo" required placeholder="Ej.: vacaciones todo el mes, retiro"></textarea></div>
      </form>
      <ng-container pie><button type="button" (click)="modal.set(null)">Cancelar</button>
        <button type="submit" class="primario" form="form-excluir" [disabled]="trabajando() || motivo.trim().length < 5">Excluir</button></ng-container>
    </app-modal>

    <!-- Subir por el conductor -->
    <app-modal [titulo]="'Subir planilla · ' + (sel()?.nombre || '')" [abierto]="modal() === 'subir'" (cerrar)="modal.set(null)">
      <p>Suba el PDF de <strong>{{ sel()?.nombrePeriodo }}</strong> por el conductor (por ejemplo, si no tiene la app).
        @if (sel()?.recibida) { La versión actual queda en el historial. }</p>
      <div class="campo"><label for="pl-archivo">Archivo PDF (máximo 10 MB)</label>
        <input id="pl-archivo" type="file" accept="application/pdf,.pdf" (change)="elegirArchivo($event)" /></div>
      @if (archivo(); as a) { <p class="sutil">{{ a.name }} · {{ (a.size / 1024 / 1024) | miles }} MB</p> }
      <ng-container pie><button type="button" (click)="modal.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="subir()" [disabled]="trabajando() || !archivo()">{{ trabajando() ? 'Subiendo…' : 'Subir' }}</button></ng-container>
    </app-modal>
  `,
  styles: [`
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
    .kpi { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); }
    .kpi header { display: flex; justify-content: space-between; align-items: center; color: var(--gris-5); font-size: 13px; font-weight: 600; }
    .kpi strong { font-size: 26px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .kpi footer { font-size: 12px; color: var(--gris-5); }
    .kpi.destacado { background: var(--primario-claro); border-color: var(--primario-borde); }
    .estados { margin: 4px 0 12px; }
    .sin-app { color: var(--ambar); font-weight: 600; }
    .decidir { color: var(--ambar); font-weight: 600; }
    th.celda-acciones { text-align: right; }
    .celda-acciones .acciones { justify-content: flex-end; flex-wrap: wrap; }
    .mes { border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 12px 14px; margin-bottom: 12px; background: var(--gris-0); }
    .mes header { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .mes h3 { margin: 0; font-size: 15px; text-transform: capitalize; }
    .versiones, .eventos { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .versiones li { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .eventos { border-top: 1px dashed var(--gris-2); padding-top: 8px; font-size: 13px; }
    .d-bloque { display: block; }
    @media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 720px) { .kpis { gap: 10px; } .kpi strong { font-size: 20px; } }
  `],
})
export class SstPlanillas {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly puedeGestionar = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly ESTADOS = ESTADOS; readonly CHIP = CHIP; readonly EVENTOS = EVENTOS;
  readonly mesActual = mesActual();
  readonly manana = enDias(1); readonly maxTardia = enDias(31);
  // Indicadores del mes (sobre todos los conductores) y la lista por páginas desde el servidor;
  // mes, estado y búsqueda se conservan al cambiar de página
  readonly datos = signal<Respuesta | null>(null);
  readonly error = signal('');
  readonly planillas = new ListaServidor<Planilla>({
    pedir: (p) => { this.error.set(''); return this.api.get<any>('/sst/planillas', { periodo: this.periodo, estado: this.estado(), q: this.q.trim(), ...p }); },
    alCargar: (r) => this.datos.set({ indicadores: r.indicadores, items: [] } as unknown as Respuesta),
    alError: (e: any) => { this.datos.set(null); this.error.set(e?.error?.error || 'Intente de nuevo en unos minutos.'); },
  });
  readonly cargando = this.planillas.cargando;
  readonly estado = signal<'' | Estado>('');
  readonly modal = signal<'historial' | 'tardia' | 'excluir' | 'subir' | null>(null);
  readonly sel = signal<Planilla | null>(null);
  readonly historial = signal<Planilla[] | null>(null);
  readonly archivo = signal<File | null>(null);
  readonly trabajando = signal(false);
  readonly visor = viewChild.required(VisorPdf);
  periodo = mesActual(); q = ''; motivo = ''; hasta = enDias(3);
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  constructor() { this.cargar(); }

  // Filtros nuevos: primera página (una respuesta tardía no reemplaza la actual)
  cargar() { return this.planillas.recargar(); }
  buscarDiferido() { clearTimeout(this.temporizador); this.temporizador = setTimeout(() => this.cargar(), 300); }

  exportar() { this.api.descargar('/sst/planillas/exportar', { periodo: this.periodo, estado: this.estado(), q: this.q.trim() }, 'planillas.xlsx').catch(e => this.avisos.error(e)); }

  verPdf(p: Planilla, version?: number) {
    this.visor().ver(`/sst/planillas/${p.id}/archivo`, `Planilla ${p.nombrePeriodo} · ${p.nombre}`, version ? { version } : undefined);
  }

  async abrirHistorial(p: Planilla) {
    this.sel.set(p); this.historial.set(null); this.modal.set('historial');
    try { this.historial.set(await this.api.get<Planilla[]>(`/sst/conductores/${p.terceroId}/planillas`)); }
    catch (e) { this.avisos.error(e); this.modal.set(null); }
  }
  abrirTardia(p: Planilla) { this.sel.set(p); this.motivo = ''; this.hasta = enDias(3); this.modal.set('tardia'); }
  abrirExcluir(p: Planilla) { this.sel.set(p); this.motivo = ''; this.modal.set('excluir'); }
  abrirSubir(p: Planilla) { this.sel.set(p); this.archivo.set(null); this.modal.set('subir'); }

  elegirArchivo(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0] || null;
    if (f && f.size > 10 * 1024 * 1024) { this.avisos.mostrar('El PDF pesa más de 10 MB', 'error'); (ev.target as HTMLInputElement).value = ''; return; }
    if (f && !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { this.avisos.mostrar('Elija un archivo PDF', 'error'); (ev.target as HTMLInputElement).value = ''; return; }
    this.archivo.set(f);
  }

  private async accion(fn: () => Promise<unknown>, ok: string) {
    if (this.trabajando()) return;
    this.trabajando.set(true);
    try { await fn(); this.avisos.ok(ok); this.modal.set(null); await this.planillas.refrescar(); }
    catch (e) { this.avisos.error(e); }
    finally { this.trabajando.set(false); }
  }
  habilitarTardia() { const p = this.sel()!; return this.accion(() => this.api.post(`/sst/planillas/${p.id}/carga-tardia`, { motivo: this.motivo.trim(), hasta: this.hasta }), 'Carga tardía habilitada. El conductor ya puede subirla.'); }
  excluir() { const p = this.sel()!; return this.accion(() => this.api.post(`/sst/planillas/${p.id}/excluir`, { motivo: this.motivo.trim() }), 'Conductor excluido este mes'); }
  incluir(p: Planilla) { return this.accion(() => this.api.post(`/sst/planillas/${p.id}/incluir`, {}), 'Conductor incluido otra vez'); }
  subir() { const p = this.sel()!; const f = this.archivo()!; return this.accion(() => this.api.subir(`/sst/planillas/${p.id}/archivo`, f), 'Planilla recibida'); }
}
