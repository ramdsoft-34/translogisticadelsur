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

    @if (estado() && !estado()!.habilitado) {
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
              <span class="fila3 sutil">{{ v.cliente }} · {{ v.destino }}</span>
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
              <p class="sutil nota">{{ r.viaje.conductor }} → {{ r.viaje.destino }} · Sur Track {{ r.viaje.codigoExterno }}</p>
              @if (puedeRegistrar) {
                <button type="button" class="peligro pequeno" confirmar="Clic otra vez para terminar el rastreo" (confirmado)="finalizar(elegido()!)">Terminar rastreo</button>
              }
            </div>
          }
        </section>
      </div>
    }

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
    .panel-recorrido { position: absolute; z-index: 500; left: 12px; bottom: 12px; width: min(340px, calc(100% - 24px)); background: var(--gris-0);
      border: 1px solid var(--gris-2); border-radius: 14px; padding: 12px 14px; box-shadow: var(--sombra-menu); }
    .panel-recorrido header { display: flex; justify-content: space-between; align-items: center; }
    .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0 6px; }
    .datos div { display: flex; flex-direction: column; } .datos span { font-size: 12px; color: var(--gris-5); }
    .opcion-viaje { padding: 8px 0; border-bottom: 1px solid var(--gris-15); }
    .rejilla { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 1100px) {
      .monitor { grid-template-columns: 1fr; }
      .mapa-caja { order: -1; min-height: 55dvh; }
      .lista { max-height: none; }
      .rejilla { grid-template-columns: 1fr; }
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
  private temporizador: ReturnType<typeof setInterval> | undefined;
  private primeraVez = true;
  private viajeInicial = inject(ActivatedRoute).snapshot.queryParamMap.get('viaje');

  async ngAfterViewInit() {
    await this.rastreo.cargar(true);
    if (!this.estado()?.habilitado) return;
    setTimeout(() => this.iniciarMapa(), 0);
    this.temporizador = setInterval(() => { if (!document.hidden) this.cargar(); }, 15000);
  }
  ngOnDestroy() { clearInterval(this.temporizador); this.mapa?.remove(); }

  private iniciarMapa() {
    const el = this.contenedor()?.nativeElement;
    if (!el || this.mapa) return;
    this.mapa = L.map(el, { zoomControl: true }).setView(PASTO, 9);
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
      const pts = r.puntos.map((p: any) => [p.lat, p.lng] as L.LatLngTuple);
      if (pts.length > 1 && this.mapa) {
        this.linea = L.polyline(pts, { color: '#e0ad00', weight: 4, opacity: .9 }).addTo(this.mapa);
        if (encuadrar) this.mapa.fitBounds(this.linea.getBounds(), { padding: [50, 50] });
      }
    } catch (e) { if (encuadrar) this.avisos.error(e); }
  }

  cerrarRecorrido() { this.elegido.set(null); this.recorrido.set(null); this.linea?.remove(); this.linea = null; }

  async finalizar(id: string) {
    try { await this.rastreo.finalizar(id); this.avisos.ok('Rastreo terminado'); this.cerrarRecorrido(); this.cargar(); }
    catch (e) { this.avisos.error(e); }
  }

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
