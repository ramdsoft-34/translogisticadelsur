import { Paginador } from '../shared/paginador';
import { ListaServidor } from '../shared/lista-servidor';
import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
import { ChecklistConductor } from '../shared/checklist-conductor';

const COLORES: Record<string, string> = { en_ruta: '#1f9d55', detenido: '#d48806', sin_senal: '#d63939', esperando: '#3b82f6', llego: '#111111' };
const PASTO: L.LatLngTuple = [1.2136, -77.2811];
const hace = (h: string | Date | null | undefined) => {
  if (!h) return '—';
  const s = Math.max(0, (Date.now() - new Date(h).getTime()) / 1000);
  return s < 60 ? 'hace segundos' : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} d`;
};
// Distancia en línea recta (km): para «faltan ~X km» hasta el destino
const kmEntre = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const duracion = (desde: string | Date | null | undefined) => {
  if (!desde) return '—';
  const m = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// Monitoreo en vivo de los viajes rastreados con Sur Track. Tres zonas: la lista (qué está pasando, con lo urgente
// primero), el mapa (dónde) y el panel del viaje elegido (todo su detalle sin tapar el mapa).
@Component({
  selector: 'app-monitoreo',
  imports: [FormsModule, RouterLink, Icono, Modal, Confirmar, ChecklistConductor, ...FORMATOS, Paginador],
  template: `
    <div class="pagina-cab">
      <div><h1>Monitoreo</h1>
        <p class="sutil">Viajes rastreados con Sur Track en tiempo real.</p></div>
      <div class="acciones">
        @if (puedeConfigurar) { <a class="boton" routerLink="/configuracion" [queryParams]="{ tab: 'rastreo' }"><app-icono nombre="ajustes" [tam]="16" />Configurar</a> }
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
            @for (x of hist.items(); track x._id) {
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
            } @empty { <tr><td colspan="9" class="vacio">{{ hist.cargando() ? 'Cargando…' : 'No hay viajes terminados con estos filtros' }}</td></tr> }
          </tbody>
        </table>
        <app-paginador [total]="hist.total()" [pagina]="hist.pagina()" [porPagina]="hist.porPagina()" [cargando]="hist.cambiando()" unidad="viajes" (cambio)="hist.ir($event)" />
      </div>
    } @else if (estado() && !estado()!.habilitado) {
      <div class="tarjeta vacio-grande">
        <app-icono nombre="camion" [tam]="32" />
        <h2>El rastreo no está habilitado</h2>
        @if (!estado()!.configuradoServidor) { <p class="sutil">El servidor aún no tiene la conexión con Sur Track configurada.</p> }
        @else if (puedeConfigurar) { <p class="sutil">Actívelo en <strong>Configuración → Rastreo GPS</strong> para rastrear viajes con la app Sur Track.</p> }
        @else { <p class="sutil">Pida al administrador de su empresa que lo active.</p> }
      </div>
    } @else if (estado()) {
      <div class="torre" [class.con-detalle]="!!recorrido()" [class.flota-cerrada]="!panelFlota()">
        <div #mapa class="mapa" role="application" aria-label="Mapa de la flota"></div>

        <!-- Resumen arriba, al centro: lo que pasa en un vistazo -->
        <div class="resumen" aria-live="polite">
          <span class="en-vivo"><span class="latido" [class.cargando]="cargando()"></span>EN VIVO</span>
          <span class="mo-dato"><strong>{{ datos()?.viajes?.length || 0 }}</strong> vehículos</span>
          <span class="mo-dato verde"><strong>{{ conteo()['en_ruta'] || 0 }}</strong> en ruta</span>
          @if (conAlertas()) { <button type="button" class="mo-dato rojo" (click)="verAlertas()"><strong>{{ conAlertas() }}</strong> con alertas</button> }
          <span class="sutil-claro">{{ actualizado() ? hace(actualizado()) : 'conectando…' }}</span>
        </div>

        <!-- Controles del mapa -->
        <div class="controles">
          <button type="button" class="ctl" (click)="verTodos()" title="Ver toda la flota" aria-label="Ver toda la flota"><app-icono nombre="lista" [tam]="17" /></button>
          <button type="button" class="ctl" [class.activo]="satelite()" (click)="cambiarBase()" [attr.aria-pressed]="satelite()" title="Vista satélite"><app-icono nombre="sol" [tam]="17" /></button>
          <button type="button" class="ctl" (click)="cargar()" [disabled]="cargando()" title="Actualizar ahora" aria-label="Actualizar ahora"><app-icono nombre="reloj" [tam]="17" /></button>
        </div>

        <!-- Flota (izquierda) -->
        <aside class="flota" aria-label="Flota en seguimiento">
          <header class="flota-cab">
            <div><h2>Flota</h2><small>{{ visibles().length }} de {{ datos()?.viajes?.length || 0 }}</small></div>
            <button type="button" class="ctl" (click)="panelFlota.set(!panelFlota())" [attr.aria-label]="panelFlota() ? 'Ocultar la lista' : 'Mostrar la lista'">
              <app-icono [nombre]="panelFlota() ? 'x' : 'menu'" [tam]="16" /></button>
          </header>
          @if (panelFlota()) {
            <div class="buscar"><app-icono nombre="buscar" [tam]="16" />
              <input type="search" placeholder="Placa, conductor, cliente o N°" [ngModel]="q()" (ngModelChange)="q.set($event)" aria-label="Buscar en la flota" /></div>
            <div class="mo-filtros" role="group" aria-label="Filtrar por estado">
              <button type="button" [class.activo]="!filtroEstado()" (click)="filtroEstado.set('')">Todos</button>
              @for (c of CONTADORES; track c.v) {
                <button type="button" [class.activo]="filtroEstado() === c.v" [attr.aria-pressed]="filtroEstado() === c.v" (click)="filtroEstado.set(filtroEstado() === c.v ? '' : c.v)">
                  <span class="punto" [style.background]="COLORES[c.v]"></span>{{ c.t }} <b>{{ conteo()[c.v] || 0 }}</b></button>
              }
              <button type="button" class="f-alerta" [class.activo]="filtroEstado() === 'alertas'" (click)="filtroEstado.set(filtroEstado() === 'alertas' ? '' : 'alertas')">
                <app-icono nombre="alerta" [tam]="13" />Alertas <b>{{ conAlertas() }}</b></button>
            </div>
            <div class="lista">
              @for (v of visibles(); track v._id) {
                <button type="button" class="fila" [class.elegida]="elegido() === v._id" [style.--c]="COLORES[v.estado] || '#9ca3af'" (click)="elegir(v._id)"
                  [attr.aria-label]="v.placa + ', ' + textoEstado(v.estado) + ', ' + v.conductor">
                  <span class="f-izq">
                    <span class="placa-grande">{{ v.placa }}</span>
                    <span class="f-estado">{{ textoEstado(v.estado) }}</span>
                  </span>
                  <span class="f-centro">
                    <span class="f-conductor">{{ v.conductor }}</span>
                    <span class="f-destino">→ {{ v.modalidad === 'clientes' ? (v.entregados + '/' + v.clientes + ' entregas') : v.destino }}</span>
                    @if (v.alertas.length) { <span class="f-alertas">@for (a of v.alertas; track a) { <span>{{ a }}</span> }</span> }
                  </span>
                  <span class="f-der">
                    @if (v.ultima) { <span class="vel"><strong>{{ v.ultima.velocidad }}</strong><small>km/h</small></span><small class="hace">{{ hace(v.ultima.hora) }}</small> }
                    @else { <small class="hace">sin posición</small> }
                    @if (faltan(v) !== null) { <small class="faltan">faltan {{ faltan(v) }} km</small> }
                  </span>
                </button>
              } @empty {
                <div class="vacio-flota"><app-icono nombre="camion" [tam]="30" />
                  <p>{{ datos()?.viajes?.length ? 'Ningún vehículo con este filtro' : 'No hay viajes con rastreo activo' }}</p>
                  @if (!datos()?.viajes?.length) { <small>Actívelo al registrar el viaje o desde su ficha en Viajes.</small> }
                </div>
              }
              @if (datos()?.externos?.length) {
                <h3 class="seccion">Iniciados en Cooespatrans</h3>
                @for (x of datos()!.externos; track x.externoId) {
                  <div class="fila externa">
                    <span class="f-izq"><span class="placa-grande">{{ x.placa || '—' }}</span><span class="f-estado">{{ x.codigo }}</span></span>
                    <span class="f-centro"><span class="f-conductor">{{ x.conductor }}</span><span class="f-destino">{{ hace(x.ultima?.hora) }}</span></span>
                    @if (puedeRegistrar) { <button type="button" class="pequeno" (click)="abrirEnlace(x)">Enlazar</button> }
                  </div>
                }
              }
            </div>
          }
        </aside>

        <!-- Vehículo elegido (derecha) -->
        @if (recorrido(); as r) {
          <aside class="detalle-vh" aria-label="Vehículo elegido" [style.--c]="COLORES[vivoElegido()?.estado] || '#9ca3af'">
            <header>
              <div class="dv-titulo">
                <span class="placa-grande">{{ r.viaje.placa }}</span>
                <span class="dv-estado"><span class="punto" [style.background]="COLORES[vivoElegido()?.estado] || '#9ca3af'"></span>{{ textoEstado(vivoElegido()?.estado || '') }}</span>
              </div>
              <button type="button" class="ctl" (click)="cerrarRecorrido()" aria-label="Cerrar"><app-icono nombre="x" [tam]="16" /></button>
            </header>
            <p class="dv-sub">Viaje N° {{ r.viaje.numero }} · {{ r.viaje.conductor }}</p>

            <div class="velocimetro">
              <div><strong>{{ vivoElegido()?.ultima?.velocidad ?? '—' }}</strong><span>km/h ahora</span></div>
              <div><strong [class.rojo]="r.resumen.excesos > 0">{{ r.resumen.velocidadMaxima }}</strong><span>km/h máx.</span></div>
              <div><strong>{{ r.resumen.km }}</strong><span>km recorridos</span></div>
            </div>

            <div class="destino-vh">
              <span class="dv-et">{{ r.modalidad === 'clientes' ? 'ENTREGAS' : 'DESTINO' }}</span>
              <strong>{{ r.modalidad === 'clientes' ? entregadosDe(r) + ' de ' + r.clientes.length + ' clientes' : (r.destino?.nombre || r.viaje.destino) }}</strong>
              @if (progreso(r); as pr) {
                <div class="mo-barra" role="progressbar" [attr.aria-valuenow]="pr" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="pr"></span></div>
                <small>{{ pr }} % · {{ r.modalidad === 'clientes' ? 'entregado' : 'faltan ' + faltan(vivoElegido()) + ' km en línea recta' }}</small>
              }
            </div>

            <div class="mini">
              <div><span>Última señal</span><strong>{{ vivoElegido()?.ultima ? hace(vivoElegido().ultima.hora) : '—' }}</strong></div>
              <div><span>En ruta hace</span><strong>{{ duracion(r.resumen.inicio) }}</strong></div>
            </div>

            @if ((vivoElegido()?.alertas?.length || 0) > 0 || r.resumen.excesos > 0) {
              <div class="alerta-vh" role="alert">
                @for (a of vivoElegido()?.alertas || []; track a) { <p><app-icono nombre="alerta" [tam]="15" />{{ a }}</p> }
                @if (r.resumen.excesos > 0) { <p><app-icono nombre="alerta" [tam]="15" />{{ r.resumen.excesos }} tramo(s) sobre {{ r.resumen.limiteVelocidad || 80 }} km/h · en rojo en el mapa</p> }
              </div>
            }

            @if (r.clientes?.length) {
              <h3 class="seccion">Clientes</h3>
              <ul class="clientes-vh">
                @for (c of r.clientes; track $index; let i = $index) {
                  <li><span class="num-entrega" [style.background]="colorEntrega(c.estadoEntrega)">{{ i + 1 }}</span>
                    <span class="crece">{{ c.nombre }}<small>{{ c.fechaEntrega && c.estadoEntrega !== 'pendiente' ? (c.fechaEntrega | fechaHora) : c.direccion }}</small></span>
                    <span class="chip sin-punto" [class]="claseEntrega(c.estadoEntrega)">{{ textoEntrega(c.estadoEntrega) }}</span>
                    @if (c.entrega?.lat !== undefined && c.entrega?.lat !== null) { <button type="button" class="ctl" (click)="verEntrega(c, i)" [attr.aria-label]="'Ver en el mapa la entrega de ' + c.nombre"><app-icono nombre="ubicacion" [tam]="14" /></button> }</li>
                }
              </ul>
            }

            <h3 class="seccion">Actividad</h3>
            <ol class="actividad">
              @for (e of ultimosEventos(r); track $index) { <li [class.malo]="['exceso', 'sin_senal'].includes(e.tipo)"><strong>{{ textoEvento(e.tipo) }}</strong><small>{{ hace(e.fecha) }}{{ e.detalle ? ' · ' + e.detalle : '' }}</small></li> }
              @empty { <li><small>Sin actividad todavía</small></li> }
            </ol>

            <div class="dv-acciones">
              <button type="button" [class.primario]="!seguir()" (click)="seguir.set(!seguir())" [attr.aria-pressed]="seguir()"><app-icono nombre="ubicacion" [tam]="15" />{{ seguir() ? 'Siguiendo' : 'Seguir' }}</button>
              <button type="button" (click)="verDetalle({ _id: elegido() })">Seguimiento</button>
              <button type="button" (click)="checklist().abrir(elegido()!)">Checklist</button>
              @if (puedeRegistrar) { <button type="button" class="peligro" confirmar="Clic otra vez para terminar el rastreo" (confirmado)="finalizar(elegido()!)">Terminar</button> }
            </div>
          </aside>
        }
      </div>
    }

    <app-modal [titulo]="detalle() ? 'Seguimiento del viaje N° ' + detalle()!.viaje.numero : ''" [abierto]="!!detalle()" (cerrar)="cerrarDetalle()" [ancho]="true">
      @if (detalle(); as d) {
        <div class="detalle">
          <div>
            <div #mapaDetalle class="mapa-detalle" role="application" aria-label="Recorrido del viaje"></div>
            <p class="sutil nota">Amarillo: recorrido real · Rojo: exceso de velocidad · Punteado: ruta {{ d.modalidad === 'clientes' ? 'de entrega · Círculos numerados: lugar de cada entrega' : 'sugerida · Marcador rojo: destino' }}.</p>
          </div>
          <div>
            <div class="mo-datos-detalle">
              <div><span>Vehículo</span><strong class="placa">{{ d.viaje.placa }}</strong></div>
              <div><span>Conductor</span>{{ d.viaje.conductor }}</div>
              <div><span>Fecha del viaje</span>{{ d.viaje.fecha | dia }}</div>
              @if (d.modalidad === 'clientes') { <div><span>Clientes</span>{{ d.clientes.length }} ({{ entregadosDe(d) }} entregados)</div> }
              @else { <div><span>Destino</span>{{ d.destino?.nombre || d.viaje.destino }}</div> }
              <div><span>Rastreo</span>{{ d.viaje.activado | fechaHora }}{{ d.viaje.finalizado ? ' → ' : '' }}{{ d.viaje.finalizado ? (d.viaje.finalizado | fechaHora) : '' }}</div>
              <div><span>Sur Track</span>{{ d.viaje.codigoExterno }}</div>
              <div><span>Recorrido</span><strong>{{ d.resumen.km }} km</strong></div>
              <div><span>Velocidad máxima</span>{{ d.resumen.velocidadMaxima }} km/h{{ d.resumen.excesos ? ' · ' + d.resumen.excesos + ' exceso(s)' : '' }}</div>
            </div>
            @if (d.clientes?.length) {
              <h3 class="sub">Clientes ({{ entregadosDe(d) }}/{{ d.clientes.length }} entregados)</h3>
              <ul class="lista-clientes">
                @for (c of d.clientes; track $index; let i = $index) {
                  <li class="entrega-detalle"><span class="num-entrega" [style.background]="colorEntrega(c.estadoEntrega)">{{ i + 1 }}</span>
                    <span class="crece"><strong>{{ c.nombre }}</strong><small class="sutil d-bloque">{{ c.direccion }}</small>
                      @if (c.estadoEntrega !== 'pendiente') {
                        <small class="d-bloque">{{ c.fechaEntrega ? (c.fechaEntrega | fechaHora) + ' · ' : '' }}Recibido {{ c.valorRecibido | pesos }}{{ c.valor ? ' de ' : '' }}{{ c.valor ? (c.valor | pesos) : '' }}</small>
                        @if (c.entrega?.observacion) { <small class="d-bloque">Observación: {{ c.entrega.observacion }}</small> }
                        @if (c.entrega?.lat !== undefined && c.entrega?.lat !== null) {
                          <button type="button" class="texto pequeno enlace-mapa" (click)="verEntrega(c, i)"><app-icono nombre="ubicacion" [tam]="14" />{{ c.entrega.aproximada ? 'Lugar aproximado' : 'Lugar de la entrega' }}</button>
                        } @else { <small class="sutil d-bloque">Sin ubicación registrada</small> }
                        @if (c.entrega?.fotos?.length) {
                          <span class="fotos">@for (f of c.entrega.fotos; track f) { <a [href]="urlFoto(f)" target="_blank" rel="noopener"><img [src]="urlFoto(f)" alt="Foto de la entrega" loading="lazy" /></a> }</span>
                        }
                      }
                    </span>
                    <span class="chip sin-punto" [class]="claseEntrega(c.estadoEntrega)">{{ textoEntrega(c.estadoEntrega) }}</span></li>
                }
              </ul>
            }
            <h3 class="sub">Registro de seguimiento</h3>
            <ol class="eventos">
              @for (e of d.eventos; track $index) { <li [class.malo]="['exceso', 'sin_senal'].includes(e.tipo)"><strong>{{ textoEvento(e.tipo) }}</strong> · <span class="sutil">{{ e.fecha | fechaHora }}</span>@if (e.detalle) { <small class="d-bloque">{{ e.detalle }}</small> }</li> }
              @empty { <li class="sutil">Sin registros</li> }
            </ol>
          </div>
        </div>
      }
      <ng-container pie>
        <button type="button" (click)="checklist().abrir(detalleId)">Checklist del conductor</button>
        <button type="button" (click)="cerrarDetalle()">Cerrar</button></ng-container>
    </app-modal>

    <app-checklist-conductor />
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
    </app-modal>`,
  styles: [`
    :host { display: block; }
    .acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .vacio-grande { text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .vacio-grande h2 { margin: 6px 0 0; font-size: 18px; }
    .punto { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }

    /* ── Torre de control: el mapa ocupa todo y los paneles flotan encima ── */
    .torre { position: relative; height: calc(100dvh - 190px); min-height: 560px; border-radius: 18px; overflow: hidden; border: 1px solid var(--gris-2); background: #e9edf2; }
    .mapa { position: absolute; inset: 0; z-index: 0; }
    .resumen, .controles, .flota, .detalle-vh { position: absolute; z-index: 600; }
    .vidrio, .resumen, .flota, .detalle-vh, .ctl { background: rgba(255,255,255,.94); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .resumen { top: 14px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; padding: 8px 16px; border-radius: 999px;
      box-shadow: 0 6px 24px rgba(15,23,42,.14); font-size: 13px; white-space: nowrap; color: #1f2937; }
    .en-vivo { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 11px; letter-spacing: .08em; color: #1f9d55; }
    .latido { width: 9px; height: 9px; border-radius: 50%; background: #1f9d55; animation: latido 2s infinite; }
    .latido.cargando { background: #e0ad00; }
    @keyframes latido { 0% { box-shadow: 0 0 0 0 rgba(31,157,85,.5); } 70% { box-shadow: 0 0 0 9px rgba(31,157,85,0); } 100% { box-shadow: 0 0 0 0 rgba(31,157,85,0); } }
    @media (prefers-reduced-motion: reduce) { .latido { animation: none; } }
    .mo-dato { display: inline-flex; align-items: baseline; gap: 4px; }
    .mo-dato strong { font-size: 16px; font-variant-numeric: tabular-nums; display: inline; }
    /* Mapa base un poco más claro: los vehículos y las rutas resaltan */
    :host ::ng-deep .mapa-suave { filter: saturate(.75) brightness(1.04); }
    .mo-dato.verde strong { color: #1f9d55; }
    button.mo-dato { border: 0; background: #fde8e8; color: #b42318; border-radius: 999px; padding: 3px 10px; height: auto; font-weight: 600; }
    .sutil-claro { color: #6b7280; font-size: 12px; }

    .controles { top: 14px; right: 14px; display: flex; flex-direction: column; gap: 6px; }
    .torre.con-detalle .controles { right: 410px; }
    .ctl { width: 38px; height: 38px; min-height: 0; padding: 0; display: grid; place-items: center; border-radius: 12px; border: 1px solid rgba(0,0,0,.08);
      box-shadow: 0 2px 10px rgba(15,23,42,.12); color: #1f2937; }
    .ctl.activo { background: #111827; color: #fff; }

    /* Flota */
    .flota { top: 14px; left: 14px; bottom: 14px; width: 370px; display: flex; flex-direction: column; border-radius: 18px; box-shadow: 0 10px 30px rgba(15,23,42,.18); overflow: hidden; color: #111827; }
    .torre.flota-cerrada .flota { bottom: auto; width: auto; }
    .flota-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 12px 8px 16px; }
    .flota-cab h2 { margin: 0; font-size: 17px; } .flota-cab small { color: #6b7280; }
    .buscar { margin: 0 12px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 12px; background: #f1f4f8; color: #6b7280; }
    .buscar input { border: 0; background: transparent; box-shadow: none; flex: 1; height: 40px; padding: 0; min-width: 0; color: #111827; }
    .buscar input:focus { outline: none; }
    .mo-filtros { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; }
    .mo-filtros button { flex: none; height: 32px; min-height: 0; padding: 0 11px; border-radius: 999px; font-size: 12.5px; font-weight: 600; border: 1px solid #e5e7eb; background: #fff; color: #374151; display: inline-flex; align-items: center; gap: 6px; }
    .mo-filtros button b { font-variant-numeric: tabular-nums; color: #6b7280; }
    .mo-filtros button.activo { background: #111827; border-color: #111827; color: #fff; } .mo-filtros button.activo b { color: #d1d5db; }
    .mo-filtros .f-alerta { color: #b42318; }
    .lista { flex: 1; overflow-y: auto; padding: 2px 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    .fila { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; text-align: left; width: 100%;
      padding: 11px 12px 11px 15px; border-radius: 14px; border: 1px solid transparent; background: #fff; height: auto; font-weight: 400; white-space: normal;
      box-shadow: 0 1px 2px rgba(15,23,42,.06); transition: transform .12s, box-shadow .12s; color: #111827; }
    .fila::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 4px; border-radius: 0 4px 4px 0; background: var(--c); }
    .fila:hover { box-shadow: 0 4px 14px rgba(15,23,42,.12); }
    .fila.elegida { border-color: var(--c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 35%, transparent); }
    .fila.externa { grid-template-columns: auto minmax(0, 1fr) auto; background: #f8fafc; }
    .f-izq { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
    .placa-grande { font: 800 14px/1 system-ui; letter-spacing: .06em; background: #f5c400; color: #111; padding: 6px 8px; border-radius: 7px; border: 1.5px solid #111; }
    .f-estado { font-size: 11.5px; font-weight: 700; color: var(--c); }
    .f-centro { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .f-conductor { font-weight: 650; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .f-destino { font-size: 12.5px; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .f-alertas { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    .f-alertas span { font-size: 11px; font-weight: 700; color: #b42318; background: #fde8e8; padding: 2px 7px; border-radius: 999px; }
    .f-der { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
    .vel strong { font-size: 20px; font-variant-numeric: tabular-nums; } .vel small { font-size: 10.5px; color: #6b7280; margin-left: 2px; }
    .hace, .faltan { font-size: 11px; color: #6b7280; white-space: nowrap; }
    .faltan { color: #1f6feb; font-weight: 600; }
    .vacio-flota { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding: 34px 16px; color: #6b7280; }
    .vacio-flota p { margin: 6px 0 0; font-weight: 650; color: #374151; }
    .seccion { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin: 10px 4px 2px; }

    /* Vehículo elegido */
    .detalle-vh { top: 14px; right: 14px; bottom: 14px; width: 380px; overflow-y: auto; border-radius: 18px; box-shadow: 0 10px 30px rgba(15,23,42,.18); padding: 14px 16px 16px; color: #111827;
      display: flex; flex-direction: column; gap: 12px; border-top: 5px solid var(--c); }
    .detalle-vh header { display: flex; justify-content: space-between; align-items: flex-start; }
    .dv-titulo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .dv-estado { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: var(--c); }
    .dv-sub { margin: -4px 0 0; color: #4b5563; font-size: 13px; }
    .velocimetro { display: grid; grid-template-columns: repeat(3, 1fr); background: #111827; color: #fff; border-radius: 14px; padding: 12px 8px; text-align: center; }
    .velocimetro div { display: flex; flex-direction: column; } .velocimetro div + div { border-left: 1px solid rgba(255,255,255,.12); }
    .velocimetro strong { font-size: 24px; font-variant-numeric: tabular-nums; line-height: 1.1; } .velocimetro span { font-size: 11px; color: #9ca3af; }
    .velocimetro .rojo { color: #ff6b6b; }
    .destino-vh { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 14px; background: #f1f4f8; }
    .dv-et { font-size: 10.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280; }
    .destino-vh strong { font-size: 16px; } .destino-vh small { color: #4b5563; font-size: 12px; }
    .mo-barra { height: 8px; border-radius: 999px; background: #dfe4ea; overflow: hidden; } .mo-barra span { display: block; height: 100%; background: var(--c); border-radius: inherit; }
    .mini { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .mini div { padding: 10px 12px; border-radius: 12px; border: 1px solid #e5e7eb; display: flex; flex-direction: column; }
    .mini span { font-size: 11px; color: #6b7280; } .mini strong { font-size: 14px; }
    .alerta-vh { background: #fde8e8; color: #b42318; border-radius: 12px; padding: 8px 12px; }
    .alerta-vh p { display: flex; align-items: center; gap: 6px; margin: 3px 0; font-weight: 650; font-size: 13px; }
    .clientes-vh { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .clientes-vh li { display: flex; align-items: center; gap: 8px; font-size: 13px; } .clientes-vh small { display: block; color: #6b7280; font-size: 11.5px; }
    .crece { flex: 1; min-width: 0; }
    .num-entrega { flex: none; width: 24px; height: 24px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
    .actividad { list-style: none; margin: 0; padding: 0 0 0 4px; border-left: 2px solid #e5e7eb; }
    .actividad li { position: relative; padding: 0 0 10px 14px; font-size: 13px; display: flex; flex-direction: column; }
    .actividad li::before { content: ''; position: absolute; left: -7px; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: #f5c400; border: 2px solid #fff; }
    .actividad li.malo::before { background: #d63939; } .actividad li.malo strong { color: #b42318; }
    .actividad small { color: #6b7280; font-size: 11.5px; }
    .dv-acciones { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: auto; }
    .dv-acciones button { height: 38px; min-height: 0; font-size: 13px; }

    /* Seguimiento completo (ventana) */
    .detalle { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
    .mapa-detalle { height: 420px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .nota { margin: 0 0 4px; font-size: 12.5px; }
    .sub { font-size: 12px; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: .05em; color: var(--gris-6); }
    .lista-clientes { list-style: none; padding: 0; margin: 4px 0; display: flex; flex-direction: column; gap: 6px; }
    .lista-clientes li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .lista-clientes li.entrega-detalle { align-items: flex-start; padding-bottom: 8px; border-bottom: 1px solid var(--gris-15); }
    .enlace-mapa { padding: 2px 0; height: auto; gap: 4px; }
    .fotos { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .fotos img { width: 54px; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid var(--gris-2); }
    .d-bloque { display: block; }
    .eventos { list-style: none; padding: 0; margin: 0; border-left: 2px solid var(--gris-2); }
    .eventos li { position: relative; padding: 0 0 10px 14px; font-size: 13px; }
    .eventos li::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--primario-borde); }
    .eventos li.malo::before { background: var(--rojo); } .eventos li.malo strong { color: var(--rojo); }
    .datos-detalle { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0 0 12px; font-size: 13px; }
    .datos-detalle span { color: var(--gris-5); font-size: 12px; display: block; }
    .opcion-viaje { padding: 8px 0; border-bottom: 1px solid var(--gris-15); }

    /* Pantallas medianas: el detalle baja y la flota se angosta */
    @media (max-width: 1200px) {
      .flota { width: 320px; }
      .detalle-vh { width: 340px; } .torre.con-detalle .controles { right: 370px; }
      .resumen { left: auto; right: 64px; transform: none; } .torre.con-detalle .resumen { display: none; }
    }
    /* Celular y tabletas: mapa arriba y los paneles debajo, sin flotar */
    @media (max-width: 860px) {
      .torre { height: auto; min-height: 0; border: 0; border-radius: 0; background: transparent; overflow: visible; display: flex; flex-direction: column; gap: 10px; }
      .mapa { position: relative; height: 52dvh; border-radius: 16px; overflow: hidden; border: 1px solid var(--gris-2); }
      .resumen { position: static; transform: none; order: -1; justify-content: space-between; flex-wrap: wrap; white-space: normal; box-shadow: none; border: 1px solid var(--gris-2); }
      .controles { top: calc(52dvh - 140px); right: 10px; } .torre.con-detalle .controles { right: 10px; }
      .flota, .detalle-vh { position: static; width: auto; box-shadow: none; border: 1px solid var(--gris-2); }
      .detalle-vh { order: 1; } .flota { order: 2; } .lista { max-height: none; overflow: visible; }
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
  readonly duracion = duracion;
  readonly estado = this.rastreo.estado;
  readonly datos = signal<any>(null);
  readonly cargando = signal(false);
  readonly actualizado = signal<Date | null>(null);
  readonly q = signal('');
  readonly filtroEstado = signal('');
  readonly elegido = signal<string | null>(null);
  readonly seguir = signal(false);
  readonly panelFlota = signal(true);
  readonly satelite = signal(false);
  private base: L.TileLayer | null = null;
  readonly recorrido = signal<any>(null);
  readonly conteo = computed(() => (this.datos()?.viajes || []).reduce((a: any, v: any) => { a[v.estado] = (a[v.estado] || 0) + 1; return a; }, {}));
  readonly totalAlertas = computed(() => (this.datos()?.viajes || []).reduce((a: number, v: any) => a + v.alertas.length, 0));
  readonly conAlertas = computed(() => (this.datos()?.viajes || []).filter((v: any) => v.alertas.length).length);
  readonly vivoElegido = computed(() => (this.datos()?.viajes || []).find((v: any) => v._id === this.elegido()) || null);
  // Lo urgente primero: alertas, sin señal, detenidos; luego en ruta, esperando y los que llegaron
  private orden: Record<string, number> = { sin_senal: 1, detenido: 2, en_ruta: 3, esperando: 4, llego: 5 };
  readonly visibles = computed(() => {
    const q = this.q().toLowerCase().trim();
    const f = this.filtroEstado();
    return (this.datos()?.viajes || []).filter((v: any) => (!f || (f === 'alertas' ? v.alertas.length > 0 : v.estado === f))
      && (!q || `${v.placa} ${v.conductor} ${v.cliente} ${v.numero} ${v.destino}`.toLowerCase().includes(q)))
      .sort((a: any, b: any) => (b.alertas.length > 0 ? 1 : 0) - (a.alertas.length > 0 ? 1 : 0) || (this.orden[a.estado] || 9) - (this.orden[b.estado] || 9) || a.numero - b.numero);
  });

  private contenedor = viewChild<ElementRef<HTMLDivElement>>('mapa');
  private mapa: L.Map | null = null;
  private marcadores = new Map<string, L.Marker>();
  private lineas: L.Layer[] = [];
  private observador: ResizeObserver | null = null;
  private temporizador: ReturnType<typeof setInterval> | undefined;
  private primeraVez = true;
  private viajeInicial = inject(ActivatedRoute).snapshot.queryParamMap.get('viaje');

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['rastreo', 'viajes', 'rndc'], () => (this.pestana() === 'historial' ? this.hist.refrescar() : this.estado()?.habilitado && this.cargar()));

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
    // Si la caja cambia de tamaño (pantalla angosta, panel abierto), el mapa se vuelve a dibujar
    this.observador?.disconnect();
    this.observador = new ResizeObserver(() => this.mapa?.invalidateSize());
    this.observador.observe(el);
    this.mapa.zoomControl.setPosition('bottomright');
    this.ponerBase();
    this.mapa.on('dragstart', () => this.seguir.set(false));
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
      if (this.elegido()) {
        this.cargarRecorrido(this.elegido()!, false);
        if (this.seguir()) { const m = this.marcadores.get(this.elegido()!); if (m) this.mapa?.panTo(m.getLatLng()); }
      }
    } catch (e) { this.avisos.error(e); }
    finally { this.cargando.set(false); }
  }

  // Mapa base: claro y limpio (los vehículos resaltan) o satélite
  private ponerBase() {
    if (!this.mapa) return;
    this.base?.remove();
    this.base = this.satelite()
      ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imágenes © Esri' })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap', className: 'mapa-suave' });
    this.base.addTo(this.mapa);
    this.base.bringToBack();
  }
  cambiarBase() { this.satelite.set(!this.satelite()); this.ponerBase(); }
  verAlertas() { this.panelFlota.set(true); this.filtroEstado.set('alertas'); }
  // Avance hacia el destino: lo recorrido frente a lo que falta (en línea recta); con clientes, las entregas hechas
  progreso(r: any): number | null {
    if (r.modalidad === 'clientes') return r.clientes?.length ? Math.round(100 * this.entregadosDe(r) / r.clientes.length) : null;
    const f = this.faltan(this.vivoElegido());
    if (f === null || !(r.resumen?.km >= 0)) return null;
    return Math.max(0, Math.min(100, Math.round(100 * r.resumen.km / Math.max(0.1, r.resumen.km + f))));
  }

  faltan(v: any): number | null {
    if (!v?.ultima || !v.puntoDestino || v.puntoDestino.lat === undefined || v.puntoDestino.lat === null || v.estado === 'llego') return null;
    const km = kmEntre(v.ultima, v.puntoDestino);
    return km < 0.3 ? 0 : Math.round(km * 10) / 10;
  }

  private icono(v: any, elegido: boolean) {
    const color = COLORES[v.estado] || '#999';
    const tam = elegido ? 28 : 22;
    const flecha = v.ultima && v.estado === 'en_ruta' ? `<span style="position:absolute;inset:-8px;transform:rotate(${v.ultima.rumbo || 0}deg)"><span style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:8px solid ${color}"></span></span>` : '';
    const alerta = v.alertas?.length ? `<span style="position:absolute;right:-5px;top:-5px;width:12px;height:12px;border-radius:50%;background:#d63939;border:2px solid #fff"></span>` : '';
    return L.divIcon({ className: '', iconSize: [120, 48], iconAnchor: [tam / 2, tam / 2],
      html: `<div style="position:relative;width:${tam}px;height:${tam}px">${flecha}<span style="position:absolute;inset:0;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45)"></span>${alerta}</div>`
        + `<div style="margin-top:4px;display:inline-flex;align-items:center;gap:5px;background:#fff;color:#111;font:800 11.5px/1 system-ui;letter-spacing:.04em;padding:5px 8px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);border:2px solid ${elegido ? color : '#fff'}">`
        + `<span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>${this.esc(v.placa)}${v.ultima && v.estado === 'en_ruta' ? `<span style="font-weight:600;color:#555">${v.ultima.velocidad} km/h</span>` : ''}</div>` });
  }

  private pintar(viajes: any[]) {
    if (!this.mapa) return;
    const vivos = new Set<string>();
    for (const v of viajes) {
      if (!v.ultima) continue;
      vivos.add(v._id);
      const pos: L.LatLngTuple = [v.ultima.lat, v.ultima.lng];
      const titulo = `${v.placa} · ${this.textoEstado(v.estado)}`;
      const m = this.marcadores.get(v._id);
      const icono = this.icono(v, this.elegido() === v._id);
      if (m) { m.setLatLng(pos); m.setIcon(icono); m.setZIndexOffset(this.elegido() === v._id ? 1000 : 0); }
      else this.marcadores.set(v._id, L.marker(pos, { icon: icono, title: titulo, keyboard: true }).on('click', () => this.elegir(v._id)).addTo(this.mapa));
    }
    for (const [id, m] of this.marcadores) if (!vivos.has(id)) { m.remove(); this.marcadores.delete(id); }
  }

  private encuadrar(viajes: any[]) {
    const pts = viajes.filter(v => v.ultima).map(v => [v.ultima.lat, v.ultima.lng] as L.LatLngTuple);
    if (pts.length === 1) this.mapa?.setView(pts[0], 13);
    else if (pts.length > 1) this.mapa?.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
  }
  verTodos() { this.seguir.set(false); this.encuadrar(this.datos()?.viajes || []); }

  elegir(id: string) {
    this.elegido.set(id);
    this.seguir.set(true);
    this.pintar(this.datos()?.viajes || []);
    const m = this.marcadores.get(id);
    if (m && this.mapa) this.mapa.setView(m.getLatLng(), Math.max(this.mapa.getZoom(), 12));
    this.cargarRecorrido(id, true);
  }

  private async cargarRecorrido(id: string, encuadrar: boolean) {
    try {
      const r = await this.api.get<any>(`/rastreo/viajes/${id}/recorrido`);
      if (this.elegido() !== id) return;
      this.recorrido.set(r);
      this.lineas.forEach(c => c.remove()); this.lineas = [];
      this.capas.forEach(c => c.remove()); this.capas = []; this.marcadoresEntrega.clear();
      if (!this.mapa) return;
      this.pintarParadas(this.mapa, r, this.capas);
      const grupo = this.pintarRecorrido(this.mapa, r, this.lineas);
      if (encuadrar && grupo) this.mapa.fitBounds(grupo.getBounds(), { padding: [50, 50], maxZoom: 15 });
    } catch (e) { if (encuadrar) this.avisos.error(e); }
  }

  // Recorrido real en amarillo y los tramos por encima del límite en rojo encima
  private pintarRecorrido(m: L.Map, r: any, capas: L.Layer[]) {
    const pts: any[] = r.puntos || [];
    if (pts.length < 2) return null;
    const linea = L.polyline(pts.map((p) => [p.lat, p.lng] as L.LatLngTuple), { color: '#e0ad00', weight: 5, opacity: .9 }).addTo(m);
    capas.push(linea);
    const limite = r.resumen?.limiteVelocidad || this.datos()?.configuracion?.velocidadMaxima || 80;
    let tramo: L.LatLngTuple[] = [];
    const cerrar = () => { if (tramo.length > 1) capas.push(L.polyline(tramo, { color: '#d63939', weight: 6, opacity: .95 }).bindTooltip('Exceso de velocidad').addTo(m)); tramo = []; };
    for (const p of pts) { if ((p.velocidad || 0) > limite) tramo.push([p.lat, p.lng]); else cerrar(); }
    cerrar();
    capas.push(L.circleMarker([pts[0].lat, pts[0].lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1 }).bindTooltip('Inicio').addTo(m));
    return linea;
  }

  cerrarRecorrido() {
    this.elegido.set(null); this.recorrido.set(null); this.seguir.set(false);
    this.lineas.forEach(c => c.remove()); this.lineas = []; this.capas.forEach(c => c.remove()); this.capas = [];
    this.pintar(this.datos()?.viajes || []);
  }

  async finalizar(id: string) {
    try { await this.rastreo.finalizar(id); this.avisos.ok('Rastreo terminado'); this.cerrarRecorrido(); this.cargar(); }
    catch (e) { this.avisos.error(e); }
  }

  ultimosEventos(r: any) { return [...(r.eventos || [])].reverse().slice(0, 6); }

  // ── Destino, clientes y ruta sugerida en el mapa ──
  private capas: L.Layer[] = [];
  private pintarParadas(m: L.Map, r: any, capas: L.Layer[]) {
    if (r.ruta?.length > 1) capas.push(L.polyline(r.ruta.map((c: any) => [c.lat, c.lng]), { color: '#3b82f6', weight: 4, opacity: .7, dashArray: '8 8' }).addTo(m));
    if (r.modalidad !== 'clientes' && r.destino?.lat !== undefined && r.destino?.lat !== null) capas.push(L.marker([r.destino.lat, r.destino.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 26],
      html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#d63939;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' }), title: 'Destino' })
      .bindPopup(`<strong>Destino</strong><br>${this.esc(r.destino.nombre || '')}`).addTo(m));
    (r.clientes || []).forEach((c: any, i: number) => {
      const e = c.entrega;
      const lat = e?.lat ?? c.lat; const lng = e?.lng ?? c.lng;
      if (lat === undefined || lat === null || lng === undefined || lng === null) return;
      const color = this.colorEntrega(c.estadoEntrega);
      const icono = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:grid;place-items:center;font:700 11px system-ui">${i + 1}</div>` });
      const marcador = L.marker([lat, lng], { icon: icono, title: c.nombre }).bindPopup(this.popupEntrega(c), { maxWidth: 260 }).addTo(m);
      this.marcadoresEntrega.set(c.nombre + '|' + i, marcador);
      capas.push(marcador);
    });
  }
  private marcadoresEntrega = new Map<string, L.Marker>();
  private esc(t: any) { return String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch]); }
  // Fotos privadas de la app nueva: las sirve la API de la plataforma con la sesión del usuario
  urlFoto(f: string) { return String(f || '').startsWith('/api/') ? this.api.base + String(f).slice(4) : f; }

  private popupEntrega(c: any) {
    const e = c.entrega || {};
    const hora = c.fechaEntrega ? new Date(c.fechaEntrega).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const pesos = (v: number) => '$ ' + Math.round(v || 0).toLocaleString('es-CO');
    const fotos = (e.fotos || []).slice(0, 5).map((f: string) => this.urlFoto(f)).map((u: string) => `<a href="${this.esc(u)}" target="_blank" rel="noopener"><img src="${this.esc(u)}" alt="Foto de la entrega" style="width:52px;height:52px;object-fit:cover;border-radius:6px;margin:4px 4px 0 0"></a>`).join('');
    return `<strong>${this.esc(c.nombre)}</strong><br><span style="color:#666">${this.esc(c.direccion || '')}</span><br>`
      + `<b>${this.textoEntrega(c.estadoEntrega)}</b>${hora ? ' · ' + hora : ''}`
      + (c.estadoEntrega !== 'pendiente' ? `<br>Recibido: ${pesos(c.valorRecibido)}${c.valor ? ' de ' + pesos(c.valor) : ''}` : '')
      + (e.observacion ? `<br>Observación: ${this.esc(e.observacion)}` : '')
      + (e.conductor ? `<br>Conductor: ${this.esc(e.conductor)}` : '')
      + (e.lat !== undefined && e.lat !== null ? `<br><small style="color:#666">${e.aproximada ? 'Lugar aproximado (según el recorrido)' : 'Lugar registrado por el GPS del conductor'}</small>` : '')
      + (fotos ? `<div>${fotos}</div>` : '');
  }
  // Centra el mapa en la entrega elegida en la lista y abre su detalle
  verEntrega(c: any, i: number) {
    const mk = this.marcadoresEntrega.get(c.nombre + '|' + i);
    if (!mk) { this.avisos.mostrar('Esta entrega no tiene ubicación registrada', 'info'); return; }
    const mapa = this.detalle() ? this.mapaDetalle : this.mapa;
    this.seguir.set(false);
    mapa?.setView(mk.getLatLng(), Math.max(mapa.getZoom(), 15)); mk.openPopup();
  }
  colorEntrega(e: string) { return ({ completa: '#1f9d55', parcial: '#d48806', devolucion: '#d63939', redespacho: '#7c3aed' } as Record<string, string>)[e] || '#9ca3af'; }
  textoEntrega(e: string) { return ({ completa: 'Entregado', parcial: 'Parcial', devolucion: 'Devolución', redespacho: 'Redespacho' } as Record<string, string>)[e] || 'Pendiente'; }
  claseEntrega(e: string) { return 'chip sin-punto ' + (({ completa: 'ok', parcial: 'alerta', devolucion: 'error', redespacho: 'info' } as Record<string, string>)[e] || ''); }
  textoEvento(t: string) { return ({ activado: 'Rastreo activado', enlazado: 'Enlazado desde Cooespatrans', paradas: 'Destino o clientes actualizados', inicio: 'Inicio del viaje',
    en_ruta: 'En ruta', detenido: 'Detenido', sin_senal: 'Sin señal', entrega: 'Entrega', exceso: 'Exceso de velocidad', finalizado: 'Rastreo terminado' } as Record<string, string>)[t] || t; }
  entregadosDe(d: any) { return (d.clientes || []).filter((c: any) => c.estadoEntrega && c.estadoEntrega !== 'pendiente').length; }

  // ── Pestañas e historial ──
  readonly pestana = signal<'vivo' | 'historial'>('vivo');
  irA(p: 'vivo' | 'historial') {
    if (this.pestana() === p) return;
    this.pestana.set(p);
    if (p === 'historial') { this.mapa?.remove(); this.mapa = null; this.marcadores.clear(); this.lineas = []; this.capas = []; this.recorrido.set(null); this.elegido.set(null); this.cargarHistorial(); }
    else if (this.estado()?.habilitado) { this.primeraVez = true; setTimeout(() => this.iniciarMapa(), 0); }
  }
  h = { desde: '', hasta: '', placa: '', modalidad: '' };
  // Historial por páginas desde el servidor; los filtros se conservan al cambiar de página
  readonly hist = new ListaServidor<any>({
    pedir: (p) => this.api.get<any>('/rastreo/historial', { ...this.h, placa: this.h.placa.toUpperCase(), pagina: p.pagina, limite: p.limite, ...(p.contar ? { contar: 1 } : {}) }),
    alError: (e) => this.avisos.error(e),
  });
  cargarHistorial() { return this.hist.recargar(); }

  readonly detalle = signal<any>(null);
  detalleId = '';
  readonly checklist = viewChild.required(ChecklistConductor);
  private contDetalle = viewChild<ElementRef<HTMLDivElement>>('mapaDetalle');
  private mapaDetalle: L.Map | null = null;
  async verDetalle(x: any) {
    this.detalleId = x._id;
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
        this.marcadoresEntrega.clear();
        this.pintarParadas(m, d, capas);
        this.pintarRecorrido(m, d, capas);
        const grupo = L.featureGroup(capas);
        if (capas.length) m.fitBounds(grupo.getBounds(), { padding: [30, 30], maxZoom: 14 });
      }, 60);
    } catch (e) { this.avisos.error(e); }
  }
  cerrarDetalle() { this.detalle.set(null); this.mapaDetalle?.remove(); this.mapaDetalle = null; }

  claseEstado(e: string) { return 'chip sin-punto ' + (ESTADOS_RASTREO[e]?.clase || ''); }
  textoEstado(e: string) { return ESTADOS_RASTREO[e]?.texto || e || '—'; }

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
}
