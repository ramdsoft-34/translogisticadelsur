import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import * as L from 'leaflet';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { ESTADOS_RASTREO, Rastreo } from '../core/rastreo.service';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { FORMATOS } from '../shared/formato';

const COLORES: Record<string, string> = { en_ruta: '#1f9d55', detenido: '#d48806', sin_senal: '#d63939', esperando: '#3b82f6', llego: '#111111' };
const PASTO: L.LatLngTuple = [1.2136, -77.2811];
const hace = (h: string | Date | null | undefined) => {
  if (!h) return '—';
  const s = Math.max(0, (Date.now() - new Date(h).getTime()) / 1000);
  return s < 60 ? 'hace segundos' : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};

// Monitoreo en vivo de los viajes rastreados con Sur Track: mapa de la flota, alertas, recorrido de cada viaje
// y enlace de los rastreos que se iniciaron desde Cooespatrans.
@Component({
  selector: 'app-monitoreo',
  imports: [FormsModule, Icono, Modal, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Monitoreo</h1>
        <p class="sutil">Viajes rastreados con Sur Track en tiempo real. Se actualiza solo cada 15 segundos.</p></div>
      <div class="acciones">
        @if (estado()?.habilitado) {
          <span class="sutil" aria-live="polite">{{ actualizado() ? 'Actualizado ' + hace(actualizado()) : 'Cargando…' }}</span>
          <button (click)="cargar()" [disabled]="cargando()"><app-icono nombre="reloj" [tam]="16" />Actualizar</button>
        }
        @if (puedeConfigurar) { <button (click)="abrirConfig()"><app-icono nombre="ajustes" [tam]="16" />Configurar</button> }
      </div>
    </div>

    <div class="pestanas">
      <button [class.activa]="pestana() === 'vivo'" (click)="irA('vivo')">En vivo</button>
      <button [class.activa]="pestana() === 'historial'" (click)="irA('historial')">Historial</button>
    </div>

    @if (pestana() === 'historial') {
      <p class="sutil" style="margin:0 0 10px">Viajes con el rastreo terminado. Los que están en curso se ven en «En vivo».</p>
      <section class="barra" aria-label="Filtros del historial">
        <div class="campo"><label for="hi-d">Desde</label><input id="hi-d" type="date" [(ngModel)]="h.desde" (change)="cargarHistorial()" /></div>
        <div class="campo"><label for="hi-h">Hasta</label><input id="hi-h" type="date" [(ngModel)]="h.hasta" (change)="cargarHistorial()" /></div>
        <div class="campo"><label for="hi-p">Placa</label><input id="hi-p" maxlength="7" placeholder="Todas" [(ngModel)]="h.placa" (keyup.enter)="cargarHistorial()" (change)="cargarHistorial()" /></div>
        <div class="campo"><label for="hi-m">Modalidad</label><select id="hi-m" [(ngModel)]="h.modalidad" (change)="cargarHistorial()">
          <option value="">Todas</option><option value="destino">Solo destino</option><option value="clientes">Con clientes</option></select></div>
      </section>
      <div class="tabla-caja">
        <table class="tabla-movil">
          <thead><tr><th>Viaje</th><th>Rastreo</th><th>Vehículo</th><th>Conductor</th><th>Cliente</th><th>Destino / clientes</th><th class="num">Km</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            @for (x of historialItems(); track x._id) {
              <tr>
                <td data-etiqueta="Viaje"><span class="celda-doble"><strong>N° {{ x.numero }}</strong><small class="sutil">{{ x.fecha | dia }} · {{ x.codigoExterno }}</small></span></td>
                <td data-etiqueta="Inicio">{{ x.activado | fechaHora }}@if (x.finalizado) { <small class="sutil d-bloque">Fin {{ x.finalizado | fechaHora }}</small> }</td>
                <td data-etiqueta="Vehículo"><span class="placa">{{ x.placa }}</span></td>
                <td data-etiqueta="Conductor">{{ x.conductor }}</td>
                <td data-etiqueta="Cliente">{{ x.cliente }}</td>
                <td data-etiqueta="Destino / clientes">{{ x.modalidad === 'clientes' ? x.clientes + ' cliente(s) · ' + x.entregados + ' entregado(s)' : x.destino }}</td>
                <td data-etiqueta="Km" class="num">{{ x.km ?? '—' }}</td>
                <td data-etiqueta="Estado"><span class="chip sin-punto" [class.ok]="x.estadoViaje === 'cumplido'">{{ x.estadoViaje === 'cumplido' ? 'Cumplido' : x.estadoViaje === 'anulado' ? 'Anulado' : 'Terminado' }}</span>
                  @if (x.origen === 'cooespatrans') { <small class="sutil d-bloque">Desde Cooespatrans</small> }</td>
                <td><button type="button" class="pequeno" (click)="verDetalle(x)">Ver seguimiento</button></td>
              </tr>
            } @empty { <tr><td colspan="9" class="vacio">{{ cargandoHistorial() ? 'Cargando…' : 'No hay viajes terminados con estos filtros' }}</td></tr> }
          </tbody>
        </table>
        @if (historialItems().length < historialTotal()) {
          <div class="mas"><button type="button" (click)="cargarHistorial(true)" [disabled]="cargandoHistorial()">Ver más ({{ historialItems().length }} de {{ historialTotal() }})</button></div>
        }
      </div>
    } @else if (estado() && !estado()!.habilitado) {
      <div class="tarjeta vacio-grande">
        <app-icono nombre="camion" [tam]="32" />
        <h2>El rastreo no está habilitado</h2>
        @if (!estado()!.configuradoServidor) { <p class="sutil">El servidor aún no tiene la conexión con Sur Track configurada.</p> }
        @else if (puedeConfigurar) { <p class="sutil">Actívelo en <strong>Configurar</strong> para rastrear viajes con la app Sur Track.</p> }
        @else { <p class="sutil">Pida al administrador de su empresa que lo active.</p> }
      </div>
    } @else if (estado()) {
      <div class="cifras">
        @for (c of CONTADORES; track c.v) {
          <button type="button" class="cifra" [class.activo]="filtroEstado() === c.v" (click)="filtroEstado.set(filtroEstado() === c.v ? '' : c.v)">
            <span class="punto" [style.background]="COLORES[c.v]"></span><span>{{ c.t }}</span><strong>{{ conteo()[c.v] || 0 }}</strong></button>
        }
        <div class="cifra alertas" [class.hay]="totalAlertas() > 0"><app-icono nombre="alerta" [tam]="16" /><span>Alertas</span><strong>{{ totalAlertas() }}</strong></div>
      </div>

      <div class="monitor">
        <aside class="lista" aria-label="Viajes rastreados">
          <div class="campo"><label for="mo-q" class="oculto">Buscar</label>
            <input id="mo-q" type="search" placeholder="Placa, conductor, cliente o N°" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
          @for (v of visibles(); track v._id) {
            <button type="button" class="item" [class.elegido]="elegido() === v._id" (click)="elegir(v._id)">
              <span class="fila1"><span class="punto" [style.background]="COLORES[v.estado] || '#999'"></span>
                <span class="placa">{{ v.placa }}</span><span class="chip sin-punto" [class]="claseEstado(v.estado)">{{ textoEstado(v.estado) }}</span>
                <small class="sutil derecha">N° {{ v.numero }}</small></span>
              <span class="fila2">{{ v.conductor }}</span>
              <span class="fila3 sutil">{{ v.cliente }} · {{ v.modalidad === 'clientes' ? v.clientes + ' cliente(s) · Entregas ' + v.entregados + '/' + v.clientes : v.destino }}</span>
              <span class="fila3 sutil">@if (v.ultima) { {{ v.ultima.velocidad }} km/h · {{ hace(v.ultima.hora) }} } @else { Sin posición todavía }</span>
              @for (a of v.alertas; track a) { <span class="chip error sin-punto alerta-item">{{ a }}</span> }
            </button>
          } @empty { <p class="vacio">{{ datos()?.viajes?.length ? 'Ningún viaje con este filtro' : 'No hay viajes con rastreo activo. Actívelo al registrar el viaje o desde su ficha en Viajes.' }}</p> }

          @if (datos()?.externos?.length) {
            <h3 class="sub">Rastreos iniciados en Cooespatrans</h3>
            <p class="sutil nota">Están en Sur Track pero aún no se enlazan a un viaje de Translogística.</p>
            @for (x of datos()!.externos; track x.externoId) {
              <div class="item externo">
                <span class="fila1">@if (x.placa) { <span class="placa">{{ x.placa }}</span> } @else { <span class="chip sin-punto">Sin placa</span> }<small class="sutil">{{ x.codigo }}</small>
                  <small class="sutil derecha">{{ hace(x.ultima?.hora) }}</small></span>
                <span class="fila2">{{ x.conductor }}</span>
                @if (puedeRegistrar) { <button type="button" class="pequeno" (click)="abrirEnlace(x)">Enlazar a un viaje</button> }
              </div>
            }
          }
        </aside>

        <section class="mapa-caja">
          <div #mapa class="mapa" role="application" aria-label="Mapa de vehículos"></div>
          @if (recorrido(); as r) {
            <div class="panel-recorrido">
              <header><strong>Viaje N° {{ r.viaje.numero }} · <span class="placa">{{ r.viaje.placa }}</span></strong>
                <button type="button" class="texto" (click)="cerrarRecorrido()" aria-label="Cerrar recorrido"><app-icono nombre="x" [tam]="16" /></button></header>
              <div class="datos">
                <div><span>Recorrido</span><strong>{{ r.resumen.km }} km</strong></div>
                <div><span>Vel. máxima</span><strong>{{ r.resumen.velocidadMaxima }} km/h</strong></div>
                <div><span>Inicio</span><strong>{{ r.resumen.inicio ? (r.resumen.inicio | fechaHora) : '—' }}</strong></div>
                <div><span>Último punto</span><strong>{{ r.resumen.fin ? hace(r.resumen.fin) : '—' }}</strong></div>
              </div>
              <p class="sutil nota">{{ r.viaje.conductor }}{{ r.modalidad === 'clientes' ? ' · ' + r.clientes.length + ' cliente(s)' : ' → ' + (r.destino?.nombre || r.viaje.destino) }} · Sur Track {{ r.viaje.codigoExterno }}</p>
              @if (r.clientes?.length) {
                <ul class="lista-clientes">
                  @for (c of r.clientes; track $index) {
                    <li><span class="punto" [style.background]="colorEntrega(c.estadoEntrega)"></span><span class="crece">{{ c.nombre }}<small class="sutil d-bloque">{{ c.direccion }}</small></span>
                      <span class="chip sin-punto" [class]="claseEntrega(c.estadoEntrega)">{{ textoEntrega(c.estadoEntrega) }}</span></li>
                  }
                </ul>
              }
              @if (puedeRegistrar) {
                <button type="button" class="peligro pequeno" confirmar="Clic otra vez para terminar el rastreo" (confirmado)="finalizar(elegido()!)">Terminar rastreo</button>
              }
            </div>
          }
        </section>
      </div>
    }

    <app-modal [titulo]="detalle() ? 'Seguimiento del viaje N° ' + detalle()!.viaje.numero : ''" [abierto]="!!detalle()" (cerrar)="cerrarDetalle()" [ancho]="true">
      @if (detalle(); as d) {
        <div class="detalle">
          <div>
            <div #mapaDetalle class="mapa-detalle" role="application" aria-label="Recorrido del viaje"></div>
            <p class="sutil nota">Línea amarilla: recorrido real · Línea punteada: ruta {{ d.modalidad === 'clientes' ? 'de entrega · Puntos: clientes por estado de entrega' : 'sugerida · Marcador rojo: destino' }}.</p>
          </div>
          <div>
            <div class="datos-detalle">
              <div><span>Vehículo</span><strong class="placa">{{ d.viaje.placa }}</strong></div>
              <div><span>Conductor</span>{{ d.viaje.conductor }}</div>
              <div><span>Fecha del viaje</span>{{ d.viaje.fecha | dia }}</div>
              @if (d.modalidad === 'clientes') { <div><span>Clientes</span>{{ d.clientes.length }} ({{ entregadosDe(d) }} entregados)</div> }
              @else { <div><span>Destino</span>{{ d.destino?.nombre || d.viaje.destino }}</div> }
              <div><span>Rastreo</span>{{ d.viaje.activado | fechaHora }}{{ d.viaje.finalizado ? ' → ' : '' }}{{ d.viaje.finalizado ? (d.viaje.finalizado | fechaHora) : '' }}</div>
              <div><span>Sur Track</span>{{ d.viaje.codigoExterno }}</div>
              <div><span>Recorrido</span><strong>{{ d.resumen.km }} km</strong></div>
              <div><span>Velocidad máxima</span>{{ d.resumen.velocidadMaxima }} km/h</div>
            </div>
            @if (d.clientes?.length) {
              <h3 class="sub">Clientes ({{ entregadosDe(d) }}/{{ d.clientes.length }} entregados)</h3>
              <ul class="lista-clientes">
                @for (c of d.clientes; track $index) {
                  <li><span class="punto" [style.background]="colorEntrega(c.estadoEntrega)"></span><span class="crece">{{ c.nombre }}<small class="sutil d-bloque">{{ c.direccion }}{{ c.fechaEntrega ? ' · ' : '' }}{{ c.fechaEntrega ? (c.fechaEntrega | fechaHora) : '' }}</small></span>
                    <span class="chip sin-punto" [class]="claseEntrega(c.estadoEntrega)">{{ textoEntrega(c.estadoEntrega) }}</span></li>
                }
              </ul>
            }
            <h3 class="sub">Registro de seguimiento</h3>
            <ul class="eventos">
              @for (e of d.eventos; track $index) { <li><strong>{{ textoEvento(e.tipo) }}</strong> · <span class="sutil">{{ e.fecha | fechaHora }}</span>@if (e.detalle) { <small class="d-bloque">{{ e.detalle }}</small> }</li> }
              @empty { <li class="sutil">Sin registros</li> }
            </ul>
          </div>
        </div>
      }
      <ng-container pie><button type="button" (click)="cerrarDetalle()">Cerrar</button></ng-container>
    </app-modal>

    <app-modal titulo="Enlazar rastreo a un viaje" [abierto]="!!enlace()" (cerrar)="enlace.set(null)">
      @if (enlace(); as e) {
        <p style="margin-top:0">Rastreo <strong>{{ e.x.codigo }}</strong> de {{ e.x.conductor }} ({{ e.x.placa || 'sin placa' }}). Elija el viaje de Translogística al que corresponde:</p>
        @for (v of e.viajes; track v._id) {
          <label class="casilla opcion-viaje"><input type="radio" name="enl" [value]="v._id" [(ngModel)]="enlaceViaje" />
            N° {{ v.numero }} · {{ v.fecha | dia }} · {{ v.placa }} · {{ v.cliente?.nombre }} → {{ v.destino }}</label>
        } @empty { <p class="sutil">No hay viajes de los últimos 3 días sin rastreo{{ e.x.placa ? ' con la placa ' + e.x.placa : '' }}.</p> }
      }
      <ng-container pie>
        <button type="button" (click)="enlace.set(null)">Cancelar</button>
        <button type="button" class="primario" [disabled]="!enlaceViaje" (click)="enlazar()">Enlazar</button>
      </ng-container>
    </app-modal>

    <app-modal titulo="Configurar rastreo" [abierto]="configAbierta()" (cerrar)="configAbierta.set(false)">
      <label class="casilla"><input type="checkbox" [(ngModel)]="conf.surTrack" />Rastrear viajes con la app Sur Track</label>
      <div class="rejilla" style="margin-top:14px">
        <div class="campo"><label for="mo-vel">Velocidad máxima (km/h)</label><input id="mo-vel" type="number" min="20" max="150" [(ngModel)]="conf.velocidadMaxima" />
          <small>Por encima se marca alerta de exceso de velocidad.</small></div>
        <div class="campo"><label for="mo-sen">Minutos sin señal</label><input id="mo-sen" type="number" min="2" max="240" [(ngModel)]="conf.minutosSinSenal" />
          <small>Sin posición nueva por más tiempo, el viaje pasa a «Sin señal».</small></div>
      </div>
      <ng-container pie>
        <button type="button" (click)="configAbierta.set(false)">Cancelar</button>
        <button type="button" class="primario" (click)="guardarConfig()">Guardar</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .vacio-grande { text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .vacio-grande h2 { margin: 6px 0 0; font-size: 18px; }
    .cifras { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .cifra { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--gris-2); border-radius: 12px; background: var(--gris-0); height: auto; }
    .cifra strong { font-size: 18px; font-variant-numeric: tabular-nums; }
    .cifra.activo { border-color: var(--primario-borde); background: var(--primario-claro); }
    .cifra.alertas.hay { border-color: var(--rojo); color: var(--rojo); }
    .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
    .monitor { display: grid; grid-template-columns: minmax(280px, 340px) minmax(0, 1fr); gap: 12px; min-height: calc(100dvh - 260px); }
    .lista { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: calc(100dvh - 260px); padding-right: 4px; min-width: 0; }
    .lista > * { flex-shrink: 0; }
    .item { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-height: max-content; overflow: hidden; text-align: left; padding: 10px 12px; border: 1px solid var(--gris-2);
      border-radius: 12px; background: var(--gris-0); height: auto; white-space: normal; font-weight: 400; }
    .item.elegido { border-color: var(--primario-borde); box-shadow: 0 0 0 1px var(--primario-borde); }
    .item.externo { cursor: default; background: var(--gris-1); }
    .fila1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; } .derecha { margin-left: auto; }
    .fila2 { font-weight: 600; } .fila3 { font-size: 12.5px; }
    .alerta-item { align-self: flex-start; }
    .sub { font-size: 13px; margin: 14px 0 0; text-transform: uppercase; letter-spacing: .04em; color: var(--gris-6); }
    .nota { margin: 0 0 4px; font-size: 12.5px; }
    .oculto { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .mapa-caja { position: relative; border: 1px solid var(--gris-2); border-radius: var(--radio); overflow: hidden; min-height: 420px; }
    .mapa { position: absolute; inset: 0; }
    .lista-clientes { list-style: none; padding: 0; margin: 8px 0; max-height: 170px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .lista-clientes li { display: flex; align-items: center; gap: 8px; font-size: 13px; } .crece { flex: 1; min-width: 0; }
    .d-bloque { display: block; }
    .mas { padding: 10px; text-align: center; }
    .detalle { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
    .mapa-detalle { height: 380px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .eventos { list-style: none; padding: 0; margin: 0; border-left: 2px solid var(--gris-2); }
    .eventos li { position: relative; padding: 0 0 10px 14px; font-size: 13px; }
    .eventos li::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--primario-borde); }
    .datos-detalle { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0 0 12px; font-size: 13px; }
    .datos-detalle span { color: var(--gris-5); font-size: 12px; display: block; }
    .panel-recorrido { position: absolute; z-index: 500; left: 12px; bottom: 12px; width: min(340px, calc(100% - 24px)); background: var(--gris-0);
      border: 1px solid var(--gris-2); border-radius: 14px; padding: 12px 14px; box-shadow: var(--sombra-menu); }
    .panel-recorrido header { display: flex; justify-content: space-between; align-items: center; }
    .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0 6px; }
    .datos div { display: flex; flex-direction: column; } .datos span { font-size: 12px; color: var(--gris-5); }
    .opcion-viaje { padding: 8px 0; border-bottom: 1px solid var(--gris-15); }
    .rejilla { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 1100px) {
      .monitor { grid-template-columns: 1fr; }
      .mapa-caja { order: -1; min-height: 0; overflow: visible; border: 0; }
      .mapa { position: relative; height: 55dvh; border: 1px solid var(--gris-2); border-radius: var(--radio); }
      .panel-recorrido { position: static; width: auto; margin-top: 10px; box-shadow: none; }
      .lista { max-height: none; }
      .rejilla { grid-template-columns: 1fr; }
      .detalle { grid-template-columns: 1fr; }
    }
  `],
})
export class Monitoreo implements AfterViewInit, OnDestroy {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private rastreo = inject(Rastreo);
  private auth = inject(Auth);
  readonly puedeConfigurar = this.auth.tiene(P.CONFIG_GESTIONAR);
  readonly puedeRegistrar = this.auth.tiene(P.VIAJES_REGISTRAR);
  readonly COLORES = COLORES;
  readonly CONTADORES = [{ v: 'en_ruta', t: 'En ruta' }, { v: 'detenido', t: 'Detenidos' }, { v: 'sin_senal', t: 'Sin señal' },
    { v: 'esperando', t: 'Esperando inicio' }, { v: 'llego', t: 'Llegaron' }];
  readonly hace = hace;
  readonly estado = this.rastreo.estado;
  readonly datos = signal<any>(null);
  readonly cargando = signal(false);
  readonly actualizado = signal<Date | null>(null);
  readonly q = signal('');
  readonly filtroEstado = signal('');
  readonly elegido = signal<string | null>(null);
  readonly recorrido = signal<any>(null);
  readonly conteo = computed(() => (this.datos()?.viajes || []).reduce((a: any, v: any) => { a[v.estado] = (a[v.estado] || 0) + 1; return a; }, {}));
  readonly totalAlertas = computed(() => (this.datos()?.viajes || []).reduce((a: number, v: any) => a + v.alertas.length, 0));
  readonly visibles = computed(() => {
    const q = this.q().toLowerCase().trim();
    return (this.datos()?.viajes || []).filter((v: any) => (!this.filtroEstado() || v.estado === this.filtroEstado())
      && (!q || `${v.placa} ${v.conductor} ${v.cliente} ${v.numero} ${v.destino}`.toLowerCase().includes(q)));
  });

  private contenedor = viewChild<ElementRef<HTMLDivElement>>('mapa');
  private mapa: L.Map | null = null;
  private marcadores = new Map<string, L.Marker>();
  private linea: L.Polyline | null = null;
  private observador: ResizeObserver | null = null;
  private temporizador: ReturnType<typeof setInterval> | undefined;
  private primeraVez = true;
  private viajeInicial = inject(ActivatedRoute).snapshot.queryParamMap.get('viaje');

  async ngAfterViewInit() {
    await this.rastreo.cargar(true);
    if (!this.estado()?.habilitado) return;
    setTimeout(() => this.iniciarMapa(), 0);
    this.temporizador = setInterval(() => { if (!document.hidden && this.pestana() === 'vivo') this.cargar(); }, 15000);
  }
  ngOnDestroy() { clearInterval(this.temporizador); this.observador?.disconnect(); this.mapa?.remove(); this.mapaDetalle?.remove(); }

  private iniciarMapa() {
    const el = this.contenedor()?.nativeElement;
    if (!el || this.mapa) return;
    this.mapa = L.map(el, { zoomControl: true }).setView(PASTO, 9);
    // Si la caja cambia de tamaño (pantalla angosta, panel), el mapa se vuelve a dibujar
    this.observador?.disconnect();
    this.observador = new ResizeObserver(() => this.mapa?.invalidateSize());
    this.observador.observe(el);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(this.mapa);
    this.cargar();
  }

  async cargar() {
    this.cargando.set(true);
    try {
      const d = await this.api.get<any>('/rastreo/en-vivo');
      this.datos.set(d); this.actualizado.set(new Date());
      this.pintar(d.viajes);
      if (this.primeraVez) {
        this.primeraVez = false;
        if (this.viajeInicial && d.viajes.some((v: any) => v._id === this.viajeInicial)) this.elegir(this.viajeInicial);
        else this.encuadrar(d.viajes);
      }
      if (this.elegido()) this.cargarRecorrido(this.elegido()!, false);
    } catch (e) { this.avisos.error(e); }
    finally { this.cargando.set(false); }
  }

  private icono(v: any) {
    const color = COLORES[v.estado] || '#999';
    const flecha = v.ultima && v.estado === 'en_ruta' ? `<span style="position:absolute;inset:-7px;transform:rotate(${v.ultima.rumbo || 0}deg)"><span style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid ${color}"></span></span>` : '';
    return L.divIcon({ className: '', iconSize: [96, 40], iconAnchor: [11, 11],
      html: `<div style="position:relative;width:22px;height:22px">${flecha}<span style="position:absolute;inset:0;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span></div>`
        + `<div style="margin-top:2px;display:inline-block;background:#111;color:#fff;font:600 11px/1.6 system-ui;padding:0 6px;border-radius:6px;white-space:nowrap">${v.placa}</div>` });
  }

  private pintar(viajes: any[]) {
    if (!this.mapa) return;
    const vivos = new Set<string>();
    for (const v of viajes) {
      if (!v.ultima) continue;
      vivos.add(v._id);
      const pos: L.LatLngTuple = [v.ultima.lat, v.ultima.lng];
      const popup = `<strong>${v.placa}</strong> · N° ${v.numero}<br>${v.conductor}<br>${v.cliente} → ${v.destino}<br>${v.ultima.velocidad} km/h · ${hace(v.ultima.hora)}`;
      const m = this.marcadores.get(v._id);
      if (m) { m.setLatLng(pos); m.setIcon(this.icono(v)); m.setPopupContent(popup); }
      else this.marcadores.set(v._id, L.marker(pos, { icon: this.icono(v), title: v.placa }).bindPopup(popup).on('click', () => this.elegir(v._id)).addTo(this.mapa));
    }
    for (const [id, m] of this.marcadores) if (!vivos.has(id)) { m.remove(); this.marcadores.delete(id); }
  }

  private encuadrar(viajes: any[]) {
    const pts = viajes.filter(v => v.ultima).map(v => [v.ultima.lat, v.ultima.lng] as L.LatLngTuple);
    if (pts.length === 1) this.mapa?.setView(pts[0], 13);
    else if (pts.length > 1) this.mapa?.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }

  elegir(id: string) {
    this.elegido.set(id);
    const m = this.marcadores.get(id);
    if (m && this.mapa) { this.mapa.setView(m.getLatLng(), Math.max(this.mapa.getZoom(), 13)); m.openPopup(); }
    this.cargarRecorrido(id, true);
  }

  private async cargarRecorrido(id: string, encuadrar: boolean) {
    try {
      const r = await this.api.get<any>(`/rastreo/viajes/${id}/recorrido`);
      if (this.elegido() !== id) return;
      this.recorrido.set(r);
      this.linea?.remove();
      this.capas.forEach(c => c.remove()); this.capas = [];
      if (this.mapa) this.pintarParadas(this.mapa, r, this.capas);
      const pts = r.puntos.map((p: any) => [p.lat, p.lng] as L.LatLngTuple);
      if (pts.length > 1 && this.mapa) {
        this.linea = L.polyline(pts, { color: '#e0ad00', weight: 4, opacity: .9 }).addTo(this.mapa);
        if (encuadrar) this.mapa.fitBounds(this.linea.getBounds(), { padding: [50, 50] });
      }
    } catch (e) { if (encuadrar) this.avisos.error(e); }
  }

  cerrarRecorrido() { this.elegido.set(null); this.recorrido.set(null); this.linea?.remove(); this.linea = null; this.capas.forEach(c => c.remove()); this.capas = []; }

  async finalizar(id: string) {
    try { await this.rastreo.finalizar(id); this.avisos.ok('Rastreo terminado'); this.cerrarRecorrido(); this.cargar(); }
    catch (e) { this.avisos.error(e); }
  }

  // ── Destino, clientes y ruta sugerida en el mapa en vivo ──
  private capas: L.Layer[] = [];
  private pintarParadas(m: L.Map, r: any, capas: L.Layer[]) {
    if (r.ruta?.length > 1) capas.push(L.polyline(r.ruta.map((c: any) => [c.lat, c.lng]), { color: '#3b82f6', weight: 4, opacity: .7, dashArray: '8 8' }).addTo(m));
    if (r.modalidad !== 'clientes' && r.destino?.lat !== undefined && r.destino?.lat !== null) capas.push(L.marker([r.destino.lat, r.destino.lng], { icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 24],
      html: '<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#d63939;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' }), title: 'Destino' })
      .bindPopup(`<strong>Destino</strong><br>${r.destino.nombre || ''}`).addTo(m));
    for (const c of r.clientes || []) {
      if (c.lat === undefined || c.lat === null || c.lng === undefined || c.lng === null) continue;
      capas.push(L.circleMarker([c.lat, c.lng], { radius: 7, color: '#fff', weight: 2, fillColor: this.colorEntrega(c.estadoEntrega), fillOpacity: 1 })
        .bindPopup(`<strong>${c.nombre}</strong><br>${c.direccion || ''}<br>${this.textoEntrega(c.estadoEntrega)}`).addTo(m));
    }
  }
  colorEntrega(e: string) { return ({ completa: '#1f9d55', parcial: '#d48806', devolucion: '#d63939', redespacho: '#7c3aed' } as Record<string, string>)[e] || '#9ca3af'; }
  textoEntrega(e: string) { return ({ completa: 'Entregado', parcial: 'Parcial', devolucion: 'Devolución', redespacho: 'Redespacho' } as Record<string, string>)[e] || 'Pendiente'; }
  claseEntrega(e: string) { return 'chip sin-punto ' + (({ completa: 'ok', parcial: 'alerta', devolucion: 'error', redespacho: 'info' } as Record<string, string>)[e] || ''); }
  textoEvento(t: string) { return ({ activado: 'Rastreo activado', enlazado: 'Enlazado desde Cooespatrans', paradas: 'Destino o clientes actualizados', inicio: 'Inicio del viaje',
    en_ruta: 'En ruta', detenido: 'Detenido', sin_senal: 'Sin señal', entrega: 'Entrega', finalizado: 'Rastreo terminado' } as Record<string, string>)[t] || t; }
  entregadosDe(d: any) { return (d.clientes || []).filter((c: any) => c.estadoEntrega && c.estadoEntrega !== 'pendiente').length; }

  // ── Pestañas e historial ──
  readonly pestana = signal<'vivo' | 'historial'>('vivo');
  irA(p: 'vivo' | 'historial') {
    if (this.pestana() === p) return;
    this.pestana.set(p);
    if (p === 'historial') { this.mapa?.remove(); this.mapa = null; this.marcadores.clear(); this.linea = null; this.capas = []; this.cargarHistorial(); }
    else if (this.estado()?.habilitado) { this.primeraVez = true; setTimeout(() => this.iniciarMapa(), 0); }
  }
  h = { desde: '', hasta: '', placa: '', modalidad: '' };
  readonly historialItems = signal<any[]>([]);
  readonly historialTotal = signal(0);
  readonly cargandoHistorial = signal(false);
  private paginaHistorial = 1;
  async cargarHistorial(mas = false) {
    this.cargandoHistorial.set(true);
    try {
      const pagina = mas ? this.paginaHistorial + 1 : 1;
      const r = await this.api.get<any>('/rastreo/historial', { ...this.h, placa: this.h.placa.toUpperCase(), pagina, limite: 30 });
      this.paginaHistorial = pagina;
      this.historialItems.set(mas ? [...this.historialItems(), ...r.items] : r.items);
      this.historialTotal.set(r.total);
    } catch (e) { this.avisos.error(e); }
    finally { this.cargandoHistorial.set(false); }
  }

  readonly detalle = signal<any>(null);
  private contDetalle = viewChild<ElementRef<HTMLDivElement>>('mapaDetalle');
  private mapaDetalle: L.Map | null = null;
  async verDetalle(x: any) {
    try {
      const d = await this.api.get<any>(`/rastreo/viajes/${x._id}/recorrido`);
      this.detalle.set(d);
      setTimeout(() => {
        const el = this.contDetalle()?.nativeElement;
        if (!el) return;
        this.mapaDetalle?.remove();
        const m = this.mapaDetalle = L.map(el).setView(PASTO, 9);
        setTimeout(() => m.invalidateSize(), 250);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
        const capas: L.Layer[] = [];
        this.pintarParadas(m, d, capas);
        const pts = d.puntos.map((p: any) => [p.lat, p.lng] as L.LatLngTuple);
        if (pts.length > 1) capas.push(L.polyline(pts, { color: '#e0ad00', weight: 4 }).addTo(m));
        if (pts.length) capas.push(L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1 }).bindTooltip('Inicio').addTo(m));
        const grupo = L.featureGroup(capas);
        if (capas.length) m.fitBounds(grupo.getBounds(), { padding: [30, 30], maxZoom: 14 });
      }, 60);
    } catch (e) { this.avisos.error(e); }
  }
  cerrarDetalle() { this.detalle.set(null); this.mapaDetalle?.remove(); this.mapaDetalle = null; }

  claseEstado(e: string) { return ESTADOS_RASTREO[e]?.clase || ''; }
  textoEstado(e: string) { return ESTADOS_RASTREO[e]?.texto || e; }

  // ── Enlazar un rastreo iniciado en Cooespatrans ──
  readonly enlace = signal<{ x: any; viajes: any[] } | null>(null);
  enlaceViaje = '';
  async abrirEnlace(x: any) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const r = await this.api.get<any>('/viajes', { q: x.placa || '', desde: iso(new Date(Date.now() - 3 * 86400000)), hasta: iso(new Date()), pagina: 1, limite: 50 });
      this.enlaceViaje = '';
      this.enlace.set({ x, viajes: (r.viajes || []).filter((v: any) => !v.rastreo?.activo && v.estado !== 'anulado') });
    } catch (e) { this.avisos.error(e); }
  }
  async enlazar() {
    const e = this.enlace();
    if (!e || !this.enlaceViaje) return;
    try {
      await this.api.post(`/rastreo/viajes/${this.enlaceViaje}/enlazar`, { externoId: e.x.externoId });
      this.avisos.ok('Rastreo enlazado al viaje'); this.enlace.set(null); this.cargar();
    } catch (err) { this.avisos.error(err); }
  }

  // ── Configuración ──
  readonly configAbierta = signal(false);
  conf = { surTrack: false, velocidadMaxima: 80, minutosSinSenal: 10 };
  abrirConfig() {
    const e = this.estado();
    this.conf = { surTrack: !!e?.surTrack, velocidadMaxima: e?.velocidadMaxima ?? 80, minutosSinSenal: e?.minutosSinSenal ?? 10 };
    this.configAbierta.set(true);
  }
  async guardarConfig() {
    try {
      await this.api.put('/rastreo/configuracion', this.conf);
      this.configAbierta.set(false); this.avisos.ok('Configuración guardada');
      const antes = !!this.estado()?.habilitado;
      await this.rastreo.cargar(true);
      if (!antes && this.estado()?.habilitado) {
        setTimeout(() => this.iniciarMapa(), 0);
        clearInterval(this.temporizador);
        this.temporizador = setInterval(() => { if (!document.hidden) this.cargar(); }, 15000);
      }
    } catch (e) { this.avisos.error(e); }
  }
}
