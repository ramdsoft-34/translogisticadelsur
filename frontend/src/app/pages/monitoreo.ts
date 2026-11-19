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
        @if (estado()?.habilitado && pestana() === 'vivo') {
          <span class="vivo" aria-live="polite"><span class="latido" [class.cargando]="cargando()"></span>{{ actualizado() ? 'En vivo · ' + hace(actualizado()) : 'Conectando…' }}</span>
          <button (click)="cargar()" [disabled]="cargando()"><app-icono nombre="reloj" [tam]="16" />Actualizar</button>
        }
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
      <!-- Filtros por estado: cada cifra filtra la lista (otra vez para quitar el filtro) -->
      <div class="cifras" role="group" aria-label="Filtrar por estado">
        <button type="button" class="cifra" [class.activo]="!filtroEstado()" (click)="filtroEstado.set('')"><span>Todos</span><strong>{{ datos()?.viajes?.length || 0 }}</strong></button>
        @for (c of CONTADORES; track c.v) {
          <button type="button" class="cifra" [class.activo]="filtroEstado() === c.v" [attr.aria-pressed]="filtroEstado() === c.v" (click)="filtroEstado.set(filtroEstado() === c.v ? '' : c.v)">
            <span class="punto" [style.background]="COLORES[c.v]"></span><span>{{ c.t }}</span><strong>{{ conteo()[c.v] || 0 }}</strong></button>
        }
        <button type="button" class="cifra alertas" [class.hay]="totalAlertas() > 0" [class.activo]="filtroEstado() === 'alertas'" [attr.aria-pressed]="filtroEstado() === 'alertas'"
          (click)="filtroEstado.set(filtroEstado() === 'alertas' ? '' : 'alertas')"><app-icono nombre="alerta" [tam]="16" /><span>Con alertas</span><strong>{{ conAlertas() }}</strong></button>
      </div>

      <div class="monitor" [class.con-panel]="!!recorrido()">
        <aside class="lista" aria-label="Viajes rastreados">
          <div class="campo buscar"><label for="mo-q" class="oculto">Buscar</label>
            <input id="mo-q" type="search" placeholder="Buscar placa, conductor, cliente o N°" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
          @for (v of visibles(); track v._id) {
            <button type="button" class="viaje" [class.elegido]="elegido() === v._id" [style.--color]="COLORES[v.estado] || '#9ca3af'" (click)="elegir(v._id)"
              [attr.aria-label]="v.placa + ', ' + textoEstado(v.estado) + ', ' + v.conductor">
              <span class="v-cab"><span class="placa">{{ v.placa }}</span>
                <span class="estado"><span class="punto" [style.background]="COLORES[v.estado] || '#9ca3af'"></span>{{ textoEstado(v.estado) }}</span>
                <small class="sutil derecha">N° {{ v.numero }}</small></span>
              <span class="v-conductor">{{ v.conductor }}</span>
              <span class="v-ruta"><app-icono nombre="ubicacion" [tam]="14" />{{ v.cliente }} → {{ v.modalidad === 'clientes' ? v.clientes + ' cliente(s)' : v.destino }}</span>
              @if (v.modalidad === 'clientes' && v.clientes) {
                <span class="progreso" role="progressbar" [attr.aria-valuenow]="v.entregados" [attr.aria-valuemax]="v.clientes" [attr.aria-label]="'Entregas ' + v.entregados + ' de ' + v.clientes">
                  <span [style.width.%]="100 * v.entregados / v.clientes"></span></span>
                <span class="v-metricas"><strong>{{ v.entregados }}/{{ v.clientes }}</strong> entregas</span>
              }
              <span class="v-metricas">
                @if (v.ultima) {
                  <span><strong>{{ v.ultima.velocidad }}</strong> km/h</span>
                  @if (faltan(v); as f) { <span>Faltan <strong>~{{ f }}</strong> km</span> }
                  <span class="sutil">{{ hace(v.ultima.hora) }}</span>
                } @else { <span class="sutil">Esperando la primera posición</span> }
              </span>
              @if (v.alertas.length) { <span class="v-alertas">@for (a of v.alertas; track a) { <span class="chip error sin-punto">{{ a }}</span> }</span> }
            </button>
          } @empty {
            <div class="vacio-lista">
              <app-icono nombre="camion" [tam]="28" />
              <p>{{ datos()?.viajes?.length ? 'Ningún viaje con este filtro.' : 'No hay viajes con rastreo activo.' }}</p>
              @if (!datos()?.viajes?.length) { <small class="sutil">Actívelo al registrar el viaje o desde su ficha en Viajes.</small> }
            </div>
          }

          @if (datos()?.externos?.length) {
            <h3 class="sub">Rastreos iniciados en Cooespatrans</h3>
            <p class="sutil nota">Están en Sur Track pero aún no se enlazan a un viaje de Translogística.</p>
            @for (x of datos()!.externos; track x.externoId) {
              <div class="viaje externo">
                <span class="v-cab">@if (x.placa) { <span class="placa">{{ x.placa }}</span> } @else { <span class="chip sin-punto">Sin placa</span> }<small class="sutil">{{ x.codigo }}</small>
                  <small class="sutil derecha">{{ hace(x.ultima?.hora) }}</small></span>
                <span class="v-conductor">{{ x.conductor }}</span>
                @if (puedeRegistrar) { <button type="button" class="pequeno" (click)="abrirEnlace(x)">Enlazar a un viaje</button> }
              </div>
            }
          }
        </aside>

        <section class="mapa-caja">
          <div #mapa class="mapa" role="application" aria-label="Mapa de vehículos"></div>
          <div class="mapa-botones">
            <button type="button" class="pequeno" (click)="verTodos()" title="Ver todos los vehículos"><app-icono nombre="lista" [tam]="15" />Ver todos</button>
            @if (elegido()) { <button type="button" class="pequeno" [class.primario]="seguir()" [attr.aria-pressed]="seguir()" (click)="seguir.set(!seguir())" title="Mantener el vehículo en el centro"><app-icono nombre="ubicacion" [tam]="15" />{{ seguir() ? 'Siguiendo' : 'Seguir' }}</button> }
          </div>
          <div class="leyenda" aria-label="Leyenda del mapa">
            @for (c of CONTADORES; track c.v) { <span><span class="punto" [style.background]="COLORES[c.v]"></span>{{ c.t }}</span> }
            @if (recorrido()) { <span><span class="raya amarilla"></span>Recorrido</span><span><span class="raya roja"></span>Exceso de velocidad</span><span><span class="raya azul"></span>Ruta sugerida</span> }
          </div>
        </section>

        @if (recorrido(); as r) {
          <aside class="panel" aria-label="Detalle del viaje elegido">
            <header>
              <div><span class="placa">{{ r.viaje.placa }}</span> <span class="chip sin-punto" [class]="claseEstado(vivoElegido()?.estado || '')">{{ textoEstado(vivoElegido()?.estado || '') }}</span>
                <h2>Viaje N° {{ r.viaje.numero }}</h2>
                <p class="sutil">{{ r.viaje.conductor }}</p></div>
              <button type="button" class="texto" (click)="cerrarRecorrido()" aria-label="Cerrar el detalle"><app-icono nombre="x" [tam]="18" /></button>
            </header>
            <p class="ruta"><app-icono nombre="ubicacion" [tam]="15" />{{ r.modalidad === 'clientes' ? r.clientes.length + ' cliente(s) de entrega' : (r.destino?.nombre || r.viaje.destino) }}</p>

            <div class="kpis">
              <div><span>Velocidad</span><strong>{{ vivoElegido()?.ultima ? vivoElegido().ultima.velocidad + ' km/h' : '—' }}</strong></div>
              <div><span>Vel. máxima</span><strong [class.rojo]="r.resumen.excesos > 0">{{ r.resumen.velocidadMaxima }} km/h</strong></div>
              <div><span>Recorrido</span><strong>{{ r.resumen.km }} km</strong></div>
              @if (vivoElegido() && faltan(vivoElegido()); as f) { <div><span>Faltan aprox.</span><strong>{{ f }} km</strong></div> }
              <div><span>Última señal</span><strong>{{ vivoElegido()?.ultima ? hace(vivoElegido().ultima.hora) : '—' }}</strong></div>
              <div><span>En ruta hace</span><strong>{{ duracion(r.resumen.inicio) }}</strong></div>
            </div>

            @if ((vivoElegido()?.alertas?.length || 0) > 0 || r.resumen.excesos > 0) {
              <div class="alertas-panel" role="alert">
                @for (a of vivoElegido()?.alertas || []; track a) { <p><app-icono nombre="alerta" [tam]="15" />{{ a }}</p> }
                @if (r.resumen.excesos > 0) { <p><app-icono nombre="alerta" [tam]="15" />{{ r.resumen.excesos }} tramo(s) por encima de {{ r.resumen.limiteVelocidad || 80 }} km/h (en rojo en el mapa)</p> }
              </div>
            }

            @if (r.clientes?.length) {
              <h3 class="sub">Entregas {{ entregadosDe(r) }}/{{ r.clientes.length }}</h3>
              <ul class="lista-clientes">
                @for (c of r.clientes; track $index; let i = $index) {
                  <li><span class="num-entrega" [style.background]="colorEntrega(c.estadoEntrega)">{{ i + 1 }}</span>
                    <span class="crece">{{ c.nombre }}<small class="sutil d-bloque">{{ c.fechaEntrega && c.estadoEntrega !== 'pendiente' ? (c.fechaEntrega | fechaHora) + ' · ' + (c.valorRecibido | pesos) : c.direccion }}</small></span>
                    <span class="chip sin-punto" [class]="claseEntrega(c.estadoEntrega)">{{ textoEntrega(c.estadoEntrega) }}</span>
                    @if (c.entrega?.lat !== undefined && c.entrega?.lat !== null) { <button type="button" class="texto pequeno" (click)="verEntrega(c, i)" [attr.aria-label]="'Ver en el mapa la entrega de ' + c.nombre"><app-icono nombre="ubicacion" [tam]="15" /></button> }</li>
                }
              </ul>
            }

            <h3 class="sub">Lo último</h3>
            <ol class="eventos">
              @for (e of ultimosEventos(r); track $index) { <li [class.malo]="['exceso', 'sin_senal'].includes(e.tipo)"><strong>{{ textoEvento(e.tipo) }}</strong> · <span class="sutil">{{ hace(e.fecha) }}</span>@if (e.detalle) { <small class="d-bloque">{{ e.detalle }}</small> }</li> }
              @empty { <li class="sutil">Sin registros todavía</li> }
            </ol>

            <div class="panel-acciones">
              <button type="button" class="pequeno" (click)="verDetalle({ _id: elegido() })">Seguimiento completo</button>
              <button type="button" class="pequeno" (click)="checklist().abrir(elegido()!)">Checklist</button>
              @if (puedeRegistrar) {
                <button type="button" class="peligro pequeno" confirmar="Clic otra vez para terminar el rastreo" (confirmado)="finalizar(elegido()!)">Terminar rastreo</button>
              }
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
            <div class="datos-detalle">
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
    .acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .vivo { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--gris-6); }
    .latido { width: 9px; height: 9px; border-radius: 50%; background: #1f9d55; box-shadow: 0 0 0 0 rgba(31,157,85,.5); animation: latido 2s infinite; }
    .latido.cargando { background: var(--primario-borde); }
    @keyframes latido { 0% { box-shadow: 0 0 0 0 rgba(31,157,85,.45); } 70% { box-shadow: 0 0 0 8px rgba(31,157,85,0); } 100% { box-shadow: 0 0 0 0 rgba(31,157,85,0); } }
    @media (prefers-reduced-motion: reduce) { .latido { animation: none; } }
    .vacio-grande { text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .vacio-grande h2 { margin: 6px 0 0; font-size: 18px; }
    .cifras { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .cifra { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--gris-2); border-radius: 999px; background: var(--gris-0); height: auto; min-height: 40px; }
    .cifra strong { font-size: 16px; font-variant-numeric: tabular-nums; }
    .cifra.activo { border-color: var(--primario-borde); background: var(--primario-claro); box-shadow: 0 0 0 1px var(--primario-borde); }
    .cifra.alertas.hay { border-color: var(--rojo); color: var(--rojo); }
    .cifra.alertas.hay.activo { background: rgba(214,57,57,.08); }
    .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }

    /* Lista · mapa · panel: el panel ocupa su propia columna y no tapa el mapa */
    .monitor { display: grid; grid-template-columns: minmax(290px, 360px) minmax(0, 1fr); gap: 12px; height: calc(100dvh - 250px); min-height: 520px; }
    .monitor.con-panel { grid-template-columns: minmax(290px, 340px) minmax(0, 1fr) minmax(320px, 380px); }
    .lista { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding: 2px 4px 2px 2px; min-width: 0; }
    .lista > * { flex-shrink: 0; }
    .buscar { position: sticky; top: 0; z-index: 1; background: var(--fondo, var(--gris-1)); padding-bottom: 4px; }
    .buscar input { width: 100%; }
    .viaje { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 5px; text-align: left; padding: 12px 12px 12px 16px;
      border: 1px solid var(--gris-2); border-radius: 14px; background: var(--gris-0); height: auto; white-space: normal; font-weight: 400; overflow: hidden;
      transition: border-color .15s, box-shadow .15s, transform .15s; }
    .viaje::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--color); }
    .viaje:hover { border-color: var(--gris-4); }
    .viaje.elegido { border-color: var(--primario-borde); box-shadow: 0 0 0 2px var(--primario-borde); }
    .viaje.externo { cursor: default; background: var(--gris-1); }
    .v-cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; } .derecha { margin-left: auto; }
    .estado { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 650; }
    .v-conductor { font-weight: 650; font-size: 14px; }
    .v-ruta { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--gris-6); }
    .v-metricas { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12.5px; color: var(--gris-6); }
    .v-metricas strong { color: var(--texto, inherit); font-variant-numeric: tabular-nums; }
    .v-alertas { display: flex; flex-wrap: wrap; gap: 4px; }
    .progreso { height: 6px; border-radius: 999px; background: var(--gris-15, var(--gris-2)); overflow: hidden; }
    .progreso span { display: block; height: 100%; background: #1f9d55; border-radius: inherit; }
    .vacio-lista { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding: 28px 12px; color: var(--gris-6); }
    .vacio-lista p { margin: 4px 0 0; font-weight: 600; }

    .mapa-caja { position: relative; border: 1px solid var(--gris-2); border-radius: 14px; overflow: hidden; min-height: 360px; }
    .mapa { position: absolute; inset: 0; }
    .mapa-botones { position: absolute; z-index: 500; top: 10px; right: 10px; display: flex; gap: 6px; }
    .mapa-botones button { box-shadow: var(--sombra-menu); }
    .leyenda { position: absolute; z-index: 500; left: 10px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px 10px; max-width: calc(100% - 20px);
      background: color-mix(in srgb, var(--gris-0) 92%, transparent); border: 1px solid var(--gris-2); border-radius: 10px; padding: 6px 10px; font-size: 11.5px; }
    .leyenda > span { display: inline-flex; align-items: center; gap: 5px; }
    .raya { width: 16px; height: 4px; border-radius: 2px; display: inline-block; } .raya.amarilla { background: #e0ad00; } .raya.roja { background: #d63939; }
    .raya.azul { background: repeating-linear-gradient(90deg, #3b82f6 0 4px, transparent 4px 7px); }

    .panel { overflow-y: auto; border: 1px solid var(--gris-2); border-radius: 14px; background: var(--gris-0); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .panel header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .panel h2 { margin: 6px 0 0; font-size: 18px; } .panel header p { margin: 2px 0 0; }
    .ruta { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; }
    .kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .kpis div { background: var(--gris-1); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; min-width: 0; }
    .kpis span { font-size: 11.5px; color: var(--gris-6); } .kpis strong { font-size: 15px; font-variant-numeric: tabular-nums; }
    .rojo { color: var(--rojo); }
    .alertas-panel { border: 1px solid var(--rojo); background: rgba(214,57,57,.06); color: var(--rojo); border-radius: 10px; padding: 8px 10px; }
    .alertas-panel p { display: flex; align-items: center; gap: 6px; margin: 2px 0; font-size: 13px; font-weight: 600; }
    .panel-acciones { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }

    .sub { font-size: 12px; margin: 6px 0 0; text-transform: uppercase; letter-spacing: .05em; color: var(--gris-6); }
    .nota { margin: 0 0 4px; font-size: 12.5px; }
    .oculto { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .lista-clientes { list-style: none; padding: 0; margin: 4px 0; display: flex; flex-direction: column; gap: 6px; }
    .lista-clientes li { display: flex; align-items: center; gap: 8px; font-size: 13px; } .crece { flex: 1; min-width: 0; }
    .lista-clientes li.entrega-detalle { align-items: flex-start; padding-bottom: 8px; border-bottom: 1px solid var(--gris-15); }
    .num-entrega { flex: none; width: 22px; height: 22px; border-radius: 50%; color: #fff; display: grid; place-items: center; font-size: 11px; font-weight: 700; }
    .enlace-mapa { padding: 2px 0; height: auto; gap: 4px; }
    .fotos { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
    .fotos img { width: 54px; height: 54px; object-fit: cover; border-radius: 6px; border: 1px solid var(--gris-2); }
    .d-bloque { display: block; }
    .detalle { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
    .mapa-detalle { height: 400px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .eventos { list-style: none; padding: 0; margin: 0; border-left: 2px solid var(--gris-2); }
    .eventos li { position: relative; padding: 0 0 10px 14px; font-size: 13px; }
    .eventos li::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--primario-borde); }
    .eventos li.malo::before { background: var(--rojo); } .eventos li.malo strong { color: var(--rojo); }
    .datos-detalle { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 0 0 12px; font-size: 13px; }
    .datos-detalle span { color: var(--gris-5); font-size: 12px; display: block; }
    .opcion-viaje { padding: 8px 0; border-bottom: 1px solid var(--gris-15); }
    @media (max-width: 1280px) {
      .monitor.con-panel { grid-template-columns: minmax(280px, 330px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; height: auto; }
      .monitor.con-panel .lista { grid-row: 1 / span 2; max-height: calc(100dvh - 250px); }
      .monitor.con-panel .mapa-caja { min-height: 52dvh; }
      .monitor.con-panel .panel { grid-column: 2; }
    }
    @media (max-width: 900px) {
      .monitor, .monitor.con-panel { display: flex; flex-direction: column; height: auto; }
      .mapa-caja { order: -1; min-height: 55dvh; }
      .panel { order: 0; } .lista { order: 1; max-height: none; overflow: visible; }
      .monitor.con-panel .lista { max-height: none; }
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(this.mapa);
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
    return L.divIcon({ className: '', iconSize: [110, 44], iconAnchor: [tam / 2, tam / 2],
      html: `<div style="position:relative;width:${tam}px;height:${tam}px">${flecha}<span style="position:absolute;inset:0;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></span>${alerta}</div>`
        + `<div style="margin-top:3px;display:inline-block;background:${elegido ? color : '#111'};color:#fff;font:700 11px/1.7 system-ui;padding:0 7px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">${this.esc(v.placa)}</div>` });
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
