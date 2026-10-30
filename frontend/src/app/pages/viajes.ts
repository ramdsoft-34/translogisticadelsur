import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { ESTADOS_VIAJE, P, Viaje } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { MenuAcciones } from '../shared/menu-acciones';
import { FORMATOS, hoyIso, inicioMesIso, isoDia } from '../shared/formato';
import { SelectorMunicipio } from '../shared/municipio';
import { Moneda } from '../shared/moneda';
import { CargarMas } from '../shared/cargar-mas';
import { BuscarTercero } from '../shared/buscar-tercero';
import { PlantillasWhatsapp } from '../shared/plantillas-whatsapp';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { ExportarViajes } from '../shared/exportar-viajes';
import { ESTADOS_RASTREO, Rastreo } from '../core/rastreo.service';
import { ActivarRastreo } from '../shared/activar-rastreo';
import { ChecklistConductor } from '../shared/checklist-conductor';
import { RouterLink } from '@angular/router';
import { AutorizacionAdmin } from '../core/autorizacion.service';

interface Formulario {
  _id?: string; fecha: string; cliente: string; tarifaRef: string; destino: string; codDestino: string;
  placa: string; remolque: string; conductor: string; titular: string;
  pesoKg: number | null; cantidad: number | null; conAuxiliar: boolean; diasAuxiliar: number | null; planilla: string;
  tarifa: number | null; flete: number | null; anticipo: number | null; observaciones: string; estado?: string; historico?: boolean;
  requiereManifiesto: boolean;
}

const vacio = (): Formulario => ({
  fecha: hoyIso(), cliente: '', tarifaRef: '', destino: '', codDestino: '', placa: '', remolque: '', conductor: '', titular: '',
  pesoKg: null, cantidad: 1, conAuxiliar: false, diasAuxiliar: null, planilla: '', tarifa: null, flete: null, anticipo: null, observaciones: '', requiereManifiesto: true,
});

type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango';
const POR_PAGINA = 50;
const leerSeguir = () => { try { return localStorage.getItem('tls_seguir_registrando') !== '0'; } catch { return true; } };
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

@Component({
  selector: 'app-viajes',
  imports: [FormsModule, Modal, Icono, MenuAcciones, SelectorMunicipio, Moneda, CargarMas, BuscarTercero, PlantillasWhatsapp, Confirmar, VisorPdf, ExportarViajes, RouterLink, ActivarRastreo, ChecklistConductor, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Viajes</h1><p class="sutil">{{ descripcionPeriodo() }}</p></div>
      <div class="acciones">
        <app-menu-acciones texto="Reportes">
          <button (click)="abrirWhatsapp()"><app-icono nombre="enviar" [tam]="16" />Reporte por WhatsApp<small>Mensaje por cliente con los viajes seleccionados</small></button>
          <button (click)="descargar()"><app-icono nombre="descargar" [tam]="16" />Exportar Excel o PDF<small>General, por empresa o por placa</small></button>
        </app-menu-acciones>
        @if (puedeRegistrar) { <button class="primario" (click)="nuevo()"><app-icono nombre="mas" [tam]="16" />Registrar viaje</button> }
      </div>
    </div>

    <section class="barra" aria-label="Filtros">
      <div class="campo"><span class="etiqueta">Periodo</span>
        <div class="segmentos" role="group" aria-label="Periodo">
          @for (p of periodos; track p[0]) {
            <button type="button" [class.activo]="periodo() === p[0]" (click)="elegirPeriodo(p[0])">{{ p[1] }}</button>
          }
        </div></div>
      @if (periodo() === 'rango') {
        <div class="campo"><label for="f-desde">Desde</label><input id="f-desde" type="date" [(ngModel)]="filtro.desde" (change)="cargar()" /></div>
        <div class="campo"><label for="f-hasta">Hasta</label><input id="f-hasta" type="date" [(ngModel)]="filtro.hasta" (change)="cargar()" /></div>
      }
      <div class="campo"><label for="f-cli">Cliente</label>
        <select id="f-cli" [(ngModel)]="filtro.cliente" (change)="cargar()"><option value="">Todos</option>
          @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
      <div class="campo"><label for="f-est">Estado</label>
        <select id="f-est" [(ngModel)]="filtro.estado" (change)="cargar()"><option value="">Todos</option>
          @for (e of estados; track e[0]) { <option [value]="e[0]">{{ e[1] }}</option> }</select></div>
      <div class="campo crece"><label for="f-q">Buscar</label>
        <input id="f-q" type="search" placeholder="Placa, destino o manifiesto" [(ngModel)]="filtro.q" (keyup.enter)="cargar()" (search)="cargar()" /></div>
    </section>

    <div class="resumen">
      <div><span>Viajes</span><strong>{{ total() }}</strong></div>
      <div><span>Fletes</span><strong>{{ sumas().flete | pesos }}</strong></div>
      <div><span>Anticipos</span><strong>{{ sumas().anticipo | pesos }}</strong></div>
      <div><span>Saldo por pagar</span><strong>{{ sumas().saldo | pesos }}</strong></div>
      <div><span>Auxiliar</span><strong>{{ sumas().auxiliar | pesos }}</strong></div>
      <div><span>Retefuente</span><strong>{{ sumas().retefuente | pesos }}</strong></div>
      <div><span>FOPAT</span><strong>{{ sumas().fopat | pesos }}</strong></div>
    </div>

    <div class="tabla-caja">
      <table class="tabla-movil">
        <thead><tr><th>N°</th><th>Fecha</th><th>Cliente / destino</th><th>Placa</th><th>Conductor</th>
          <th class="num">Flete</th><th class="num">Anticipo</th><th class="num">Saldo</th><th>Estado</th></tr></thead>
        <tbody>
          @for (v of viajes(); track v._id) {
            <tr class="seleccionable" (click)="editar(v)" tabindex="0" (keydown.enter)="editar(v)">
              <td data-etiqueta="N°" class="sutil">{{ v.numero }}</td><td data-etiqueta="Fecha">{{ v.fecha | dia }}</td>
              <td data-etiqueta="Cliente"><span class="celda-doble"><span>{{ v.cliente?.nombre }}</span><small>{{ v.destino }}</small></span></td>
              <td data-etiqueta="Placa"><span class="placa">{{ v.placa }}</span></td><td data-etiqueta="Conductor">{{ v.conductorNombre }}</td>
              <td data-etiqueta="Flete" class="num">{{ v.flete | pesos }}</td><td data-etiqueta="Anticipo" class="num">{{ v.anticipo | pesos }}</td><td data-etiqueta="Saldo" class="num"><strong>{{ v.saldo | pesos }}</strong></td>
              <td data-etiqueta="Estado"><span class="estados">
                <span class="chip" [class]="claseEstado(v.estado)">{{ estadoTexto(v.estado) }}</span>
                @if (v.manifiesto.estado === 'aceptado') { <small class="sutil">{{ v.manifiesto.numero }}</small> }
                @if (v.historico) { <span class="chip sin-punto" title="Importado del Excel: sus documentos RNDC se gestionaron fuera de la plataforma">Histórico</span> }
                @if (v.origen === 'manifiesto') { <span class="chip sin-punto" title="Creado directamente en Manifiestos RNDC">Desde Manifiestos</span> }
                @if (v.requiereManifiesto === false) { <span class="chip sin-punto" title="No genera remesa ni manifiesto en el RNDC">Sin manifiesto</span> }
                @if (v.rastreo?.activo) { <a class="chip sin-punto gps" [class]="claseRastreo(v.rastreo!.estado)" [routerLink]="['/monitoreo']" [queryParams]="{ viaje: v._id }"
                  (click)="$event.stopPropagation()" title="Ver en el mapa de Monitoreo">GPS · {{ textoRastreo(v.rastreo!.estado) }}</a> }
                @if (v.reporteWhatsapp?.fecha) { <span class="chip ok sin-punto" title="Reportado por WhatsApp">WA</span> }
              </span></td>
            </tr>
          } @empty {
            @if (cargando()) {
              @for (i of [1, 2, 3, 4]; track i) { <tr><td colspan="9"><span class="esqueleto"></span></td></tr> }
            } @else {
              <tr><td colspan="9" class="vacio"><strong>{{ periodo() === 'hoy' ? 'Aún no hay viajes hoy' : 'No hay viajes con estos filtros' }}</strong>
                {{ periodo() === 'hoy' ? 'Registre el primer despacho del día o revise otro periodo.' : 'Cambie el periodo o los filtros.' }}
                @if (puedeRegistrar && periodo() === 'hoy') { <div style="margin-top:12px"><button class="primario" (click)="nuevo()"><app-icono nombre="mas" [tam]="16" />Registrar viaje</button></div> }
              </td></tr>
            }
          }
        </tbody>
      </table>
      @if (viajes().length) { <app-cargar-mas [mostrados]="viajes().length" [total]="total()" [cargando]="cargandoMas()" unidad="viajes" (mas)="cargarMas()" /> }
    </div>

    <app-modal [titulo]="form()._id ? 'Viaje N° ' + numeroEditado() : (registradosTanda().length ? 'Registrar otro viaje' : 'Registrar viaje')" [abierto]="abierto()" (cerrar)="cerrarFormulario()" [ancho]="true">
      @let f = form();
      @if (!f._id && registradosTanda().length) {
        <div class="tanda" role="status">
          <strong>{{ registradosTanda().length }} registrado(s):</strong>
          @for (r of registradosTanda(); track r.numero) { <span class="chip ok sin-punto">N° {{ r.numero }} · {{ r.placa }}{{ r.sinManifiesto ? ' · sin manifiesto' : '' }}</span> }
          <small class="sutil">Se conservan el cliente y la fecha; escriba el destino, la placa y el conductor del siguiente.</small>
        </div>
      }
      @if (bloqueado()) {
        <div class="mensaje info" style="margin-bottom:14px">Este viaje ya tiene documentos en el RNDC: solo puede cambiar observaciones, cantidad, auxiliar y tarifa.</div>
      }
      <form id="form-viaje" (ngSubmit)="guardar()" class="secciones">
        @if (f._id) {
        <label class="casilla requiere">
          <input type="checkbox" name="requiere" [(ngModel)]="f.requiereManifiesto" [disabled]="bloqueado() || !!f.historico" />
          <span><strong>Requiere manifiesto de carga</strong><small>Desmárquelo si este viaje no debe expedir remesa ni manifiesto en el RNDC; no aparecerá en «Manifiestos RNDC».</small></span>
        </label>
        }
        @if (f.historico) {
          <div class="mensaje info">Viaje histórico importado del Excel: no aparece en «Manifiestos RNDC».
            @if (puedeEditarTodos) { <label class="casilla" style="margin-top:6px"><input type="checkbox" name="habilitar" [(ngModel)]="habilitarRndc" />Habilitarlo para expedir sus documentos en el RNDC</label> }</div>
        }

        <fieldset><legend>Cliente y ruta</legend>
          <div class="rejilla">
            <div class="campo"><label for="v-fecha">Fecha</label><input id="v-fecha" type="date" name="fecha" [(ngModel)]="f.fecha" [disabled]="bloqueado()" required /></div>
            <div class="campo"><label for="v-cli">Cliente</label>
              <select id="v-cli" name="cliente" [(ngModel)]="f.cliente" (ngModelChange)="cambiarCliente($event)" [disabled]="bloqueado()" required>
                <option value="">Seleccione…</option>
                @for (c of clientesActivos(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }
              </select></div>
            <div class="campo"><label for="v-dest">Destino</label>
              <input id="v-dest" name="destino" list="lista-destinos" [ngModel]="f.destino" (ngModelChange)="escribirDestino($event)"
                [disabled]="bloqueado() || !f.cliente" [placeholder]="f.cliente ? 'Escriba para buscar el destino' : 'Primero elija el cliente'" autocomplete="off" required />
              <datalist id="lista-destinos">@for (t of tarifasCliente(); track t._id) { <option [value]="t.destino"></option> }</datalist></div>
            @if (f.destino && !f.tarifaRef) {
              <app-municipio etiqueta="Municipio de destino (destino nuevo)" [(codigo)]="f.codDestino" />
            }
          </div>
          <p class="nota">Escriba y elija un destino de la lista: se llenan la tarifa, el flete y el anticipo. Si no está, escriba el nombre y elija el municipio.</p>
        </fieldset>

        <fieldset><legend>Vehículo y conductor</legend>
          <div class="rejilla">
            <app-buscar-tercero etiqueta="Conductor" rol="conductor" [conPlacas]="true" [(valor)]="f.conductor" (elegido)="elegirConductor($event)"
              [deshabilitado]="bloqueado()" placeholder="Nombre, apellido o cédula" />
            <div class="campo"><label for="v-placa">Placa</label>
              <input id="v-placa" name="placa" list="lista-placas" [(ngModel)]="f.placa" (input)="buscarPlacas(f.placa)" (change)="sugerirPorPlaca(); revisarDocumentos()"
                [disabled]="bloqueado()" required autocomplete="off" style="text-transform:uppercase" placeholder="ABC123" />
              <datalist id="lista-placas">@for (x of placas(); track x._id) { <option [value]="x.placa"></option> }</datalist>
              @if (placasConductor().length > 1 && !bloqueado()) {
                <div class="placas-conductor" role="group" aria-label="Placas del conductor">
                  @for (p of placasConductor(); track p) { <button type="button" class="pequeno" [class.primario]="f.placa === p" (click)="usarPlaca(p)">{{ p }}</button> }
                </div>
              }</div>
            <div class="campo"><label for="v-rem">Remolque</label><input id="v-rem" name="remolque" [(ngModel)]="f.remolque" [disabled]="bloqueado()" style="text-transform:uppercase" placeholder="Opcional" /></div>
            <div class="campo"><label for="v-peso">Peso (kg)</label><input id="v-peso" type="number" min="0" name="pesoKg" [(ngModel)]="f.pesoKg" [disabled]="bloqueado()" /></div>
            <div class="campo"><label for="v-cant">Cantidad</label><input id="v-cant" type="number" min="0" name="cantidad" [(ngModel)]="f.cantidad" title="Viajes o unidades (tarifa por unidad)" /></div>
          </div>
          @if (documentos(); as dc) {
            @if (dc.vencidos.length) { <div class="mensaje error"><strong>Documentos vencidos:</strong><ul>@for (x of dc.vencidos; track x) { <li>{{ x }}</li> }</ul>
              Al guardar se pedirá la autorización del administrador.</div> }
            @if (dc.avisos.length) { <div class="mensaje alerta"><strong>Por vencer:</strong><ul>@for (x of dc.avisos; track x) { <li>{{ x }}</li> }</ul></div> }
          }
          <p class="nota">Elija primero el conductor: se pone sola la placa de su vehículo habitual o la de su último viaje (si tiene varias, elija una). El titular del manifiesto se toma del vehículo; si no tiene, es el conductor.</p>
        </fieldset>

        <fieldset><legend>Valores en pesos colombianos (COP)</legend>
          <div class="rejilla">
            <div class="campo"><label for="v-tar">Tarifa al cliente</label><div class="moneda"><input id="v-tar" moneda name="tarifa" [(ngModel)]="f.tarifa" /></div></div>
            <div class="campo"><label for="v-flete">Flete al conductor</label><div class="moneda"><input id="v-flete" moneda name="flete" [(ngModel)]="f.flete" [disabled]="bloqueado()" /></div></div>
            <div class="campo"><label for="v-ant">Anticipo</label><div class="moneda"><input id="v-ant" moneda name="anticipo" [(ngModel)]="f.anticipo" [disabled]="bloqueado()" /></div></div>
            <div class="campo"><span class="etiqueta">Saldo al conductor</span><div class="lectura">{{ ((f.flete || 0) - (f.anticipo || 0)) | pesos }} <small>COP</small></div></div>
            <div class="campo"><span class="etiqueta">Auxiliar</span><label class="casilla caja"><input type="checkbox" name="aux" [(ngModel)]="f.conAuxiliar" />El viaje lleva auxiliar</label></div>
            @if (f.conAuxiliar) { <div class="campo"><label for="v-diasaux">Días de auxiliar</label><input id="v-diasaux" type="number" min="1" max="5" step="1" name="diasAux" placeholder="1 a 5" [(ngModel)]="f.diasAuxiliar" />
              <small>De 1 a 5. Si el destino no tiene tarifa de auxiliar se usa la primera del cliente.</small></div> }
            <div class="campo"><label for="v-planilla">N° de planilla</label><input id="v-planilla" name="planilla" maxlength="30" placeholder="Opcional" [(ngModel)]="f.planilla" /></div>
          </div>
        </fieldset>

        @if (rastreoHabilitado()) {
          @if (!f._id) {
            <label class="casilla requiere">
              <input type="checkbox" name="rastrear" [checked]="rastrear()" (change)="rastrear.set(!rastrear())" />
              <span><strong>Rastrear este viaje con Sur Track</strong><small>Al guardar elige la modalidad (solo destino o con clientes); el conductor lo ve en Sur Track y se sigue en Monitoreo.</small></span>
            </label>
          } @else {
            <div class="rastreo-viaje">
              <app-icono nombre="ubicacion" [tam]="18" />
              @if (rastreoForm()?.activo) {
                <span><strong>Rastreo activo</strong> · {{ textoRastreo(rastreoForm().estado) }} · {{ rastreoForm().modalidad === 'clientes' ? 'Con ' + (rastreoForm().clientes?.length || 0) + ' cliente(s)' : 'Destino: ' + (rastreoForm().destino?.nombre || f.destino) }} · Sur Track {{ rastreoForm().codigoExterno }}</span>
                <a class="boton pequeno" [routerLink]="['/monitoreo']" [queryParams]="{ viaje: f._id }">Ver en el mapa</a>
                <button type="button" class="pequeno" (click)="checklist().abrir(f._id!)">Checklist</button>
                @if (puedeRegistrar && rastreoForm().estado === 'esperando' && rastreoForm().origen === 'translogistica') {
                  <button type="button" class="pequeno" (click)="abrirActivar(true)">Cambiar destino o clientes</button> }
                @if (puedeRegistrar) { <button type="button" class="pequeno peligro" confirmar="Clic otra vez para terminar" (confirmado)="terminarRastreo()">Terminar rastreo</button> }
              } @else {
                <span>Este viaje no se está rastreando.</span>
                @if (puedeRegistrar && f.estado !== 'anulado') { <button type="button" class="pequeno" (click)="activarRastreo()" [disabled]="guardando()">Activar rastreo</button> }
              }
            </div>
          }
        }
        <div class="campo"><label for="v-obs">Observaciones (van en el manifiesto)</label><textarea id="v-obs" name="obs" maxlength="200" rows="3" [(ngModel)]="f.observaciones"></textarea></div>
      </form>
      <ng-container pie>
        @if (form()._id && !bloqueado() && puedeRegistrar) { <button class="peligro" type="button" confirmar="Clic otra vez para eliminar" (confirmado)="eliminar()" style="margin-right:auto">Eliminar</button> }
        @if (form()._id && form().requiereManifiesto === false && puedeRegistrar) {
          <button type="button" (click)="soporteInterno()" title="Manifiesto y remesa internos (MC/RC) para viajes que no van al RNDC"><app-icono nombre="ojo" [tam]="15" />Soporte interno</button>
        }
        @if (!form()._id && puedeRegistrar) {
          <label class="casilla seguir" title="Después de guardar, el formulario queda listo para el siguiente viaje del mismo cliente">
            <input type="checkbox" [checked]="seguirRegistrando()" (change)="alternarSeguir()" />Registrar otro del mismo cliente</label>
        }
        <button type="button" (click)="cerrarFormulario()">{{ registradosTanda().length ? 'Terminar' : 'Cancelar' }}</button>
        @if (puedeRegistrar) {
          @if (form()._id) {
            <button class="primario" type="submit" form="form-viaje" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar viaje' }}</button>
          } @else {
            <div class="pregunta-manifiesto" role="group" aria-label="¿Requiere manifiesto de carga?">
              <span>¿Requiere manifiesto?</span>
              <button type="button" class="primario" (click)="guardar(true)" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Sí, guardar' }}</button>
              <button type="button" (click)="guardar(false)" [disabled]="guardando()">No, guardar</button>
            </div>
          }
        }
      </ng-container>
    </app-modal>

    <app-modal titulo="Reporte de vehículos por WhatsApp" [abierto]="waAbierto()" (cerrar)="waAbierto.set(false)" [ancho]="true">
      <div class="wa-barra">
        <div class="campo"><label for="wa-fecha">Fecha</label><input id="wa-fecha" type="date" [(ngModel)]="waFecha" (change)="cargarWhatsapp(true)" /></div>
        <button type="button" (click)="waAlternarTodos()" [disabled]="!waViajes().length">{{ waTodos() ? 'Desmarcar todos' : 'Marcar todos' }}</button>
        <button type="button" [class.activo-filtro]="!waIncluir" (click)="waIncluir = !waIncluir; cargarWhatsapp(true)"
          [title]="waIncluir ? 'Mostrar solo los que faltan por reportar' : 'Mostrar también los ya reportados'">{{ waIncluir ? 'Solo pendientes' : 'Ver todos' }}</button>
        <div class="campo"><label for="wa-pl">Plantilla</label>
          <select id="wa-pl" [(ngModel)]="waPlantilla" (change)="cargarWhatsapp()">
            @for (p of waPlantillas(); track p._id) { <option [value]="p._id">{{ p.nombre }}{{ p.predeterminada ? ' (predeterminada)' : '' }}</option> }</select></div>
        <button type="button" (click)="plantillasAbierto.set(true)" style="margin-left:auto"><app-icono nombre="editar" [tam]="16" />Plantillas</button>
      </div>
      <label class="casilla wa-unificar" title="Solo cambia el mensaje de WhatsApp: los valores guardados del viaje no se modifican">
        <input type="checkbox" [(ngModel)]="waUnificar" (change)="cargarWhatsapp()" />
        <span><strong>Unificar auxiliar</strong> <small class="sutil">— en el mensaje, el auxiliar se suma al flete y al anticipo y se escribe «Unificado». Los valores del viaje no cambian.</small></span>
      </label>

      <div class="wa-columnas">
        <!-- Izquierda: los viajes de la fecha -->
        <section class="wa-viajes" aria-label="Viajes de la fecha">
          <p class="sutil wa-conteo">{{ waViajes().length }} viaje(s) · {{ waPendientes() }} pendiente(s) · {{ waSeleccion().size }} elegido(s)</p>
          @for (x of waViajes(); track x._id) {
            <article class="wa-tarjeta" [class.elegida]="waSeleccion().has(x._id)" (click)="waAlternar(x._id)">
              <input type="checkbox" [checked]="waSeleccion().has(x._id)" (click)="$event.stopPropagation()" (change)="waAlternar(x._id)" [attr.aria-label]="'Reportar viaje ' + x.numero" />
              <div class="wa-cuerpo">
                <div class="wa-fila1"><strong>N° {{ x.numero }}</strong> <span class="sutil">{{ x.cliente }}</span>
                  <span class="chip sin-punto" [class.ok]="x.reportado" [class.alerta]="!x.reportado">{{ x.reportado ? 'Reportado' : 'Pendiente' }}</span></div>
                <div>{{ x.conductor }} · <strong>{{ x.placa }}</strong></div>
                <div class="sutil wa-destino">{{ x.destino }}</div>
                <div class="wa-valores">
                  <span>Flete <strong>{{ x.flete | pesos }}</strong></span>
                  <span>Anticipo <strong>{{ x.anticipo | pesos }}</strong></span>
                  @if (x.auxiliar) { <span>Aux. {{ x.diasAuxiliar }}d <strong>{{ x.auxiliar | pesos }}</strong></span> } @else { <span class="sutil">Sin auxiliar</span> }
                </div>
                @if (waUnificar && x.auxiliar && waSeleccion().has(x._id)) {
                  <div class="wa-unificado">En el mensaje: Flete {{ (x.flete + x.auxiliar) | pesos }} · Anticipo {{ (x.anticipo > 0 ? x.anticipo + x.auxiliar : 0) | pesos }} · Auxiliar unificado</div>
                }
              </div>
              @if (puedeRegistrar) { <button type="button" class="pequeno" (click)="$event.stopPropagation(); editarDesdeWa(x._id)">Editar</button> }
            </article>
          } @empty { <p class="vacio">No hay vehículos {{ waIncluir ? '' : 'pendientes ' }}por reportar en esa fecha.</p> }
        </section>

        <!-- Derecha: un mensaje por cliente -->
        <section class="wa-mensajes" aria-label="Mensajes">
          @for (m of waMensajes(); track m.cliente; let k = $index) {
            <div class="wa-mensaje">
              <div class="wa-mcab"><strong>{{ k + 1 }}/{{ waMensajes().length }} · {{ m.cliente }}</strong>
                <span class="sutil">{{ m.cantidad }} vehículo(s) · Flete {{ m.totalFlete | pesos }} · Anticipo {{ m.totalAnticipo | pesos }}</span></div>
              <pre class="wa-texto">{{ m.texto }}</pre>
              <div class="acciones">
                <button class="pequeno" (click)="copiar(m.texto)">Copiar</button>
                <a class="boton pequeno wa" [href]="m.enlace" target="_blank" rel="noopener noreferrer"><app-icono nombre="enviar" [tam]="15" />Abrir en WhatsApp</a>
                @if (puedeRegistrar) { <button class="pequeno" (click)="marcarReportado(m)">Marcar como reportado</button> }
              </div>
            </div>
          } @empty {
            <p class="vacio">{{ waViajes().length ? 'Marque los viajes que va a reportar: aquí se arma un mensaje por cliente.' : 'Sin mensajes.' }}</p>
          }
        </section>
      </div>
      <ng-container pie><button type="button" (click)="waAbierto.set(false)">Cerrar</button></ng-container>
    </app-modal>
    <app-visor-pdf />
    <app-activar-rastreo (listo)="rastreoListo($event)" />
    <app-checklist-conductor />
    <app-exportar-viajes [clientes]="clientes()" />
    <app-plantillas-whatsapp [abierto]="plantillasAbierto()" [fecha]="waFecha" (cerrar)="plantillasAbierto.set(false)" (cambiadas)="cargarPlantillas()" />`,
  styles: [`
    .resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1px; background: var(--gris-2); border: 1px solid var(--gris-2);
      border-radius: var(--radio-l); overflow: hidden; margin-bottom: 14px; }
    .resumen > div { background: var(--gris-0); padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
    .resumen span { font-size: 12.5px; color: var(--gris-5); }
    .resumen strong { font-size: 20px; font-weight: 650; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .estados { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .secciones { display: flex; flex-direction: column; gap: 14px; }
    .rastreo-viaje { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); }
    a.chip.gps { text-decoration: none; }
    .placas-conductor { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .wa-barra { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .wa-barra .activo-filtro { background: var(--gris-8); color: var(--gris-0); border-color: var(--gris-8); }
    .wa-unificar { display: flex; align-items: flex-start; gap: 10px; margin: 12px 0; padding: 10px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-0); }
    .wa-columnas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .wa-conteo { margin: 0 0 8px; }
    .wa-viajes { display: flex; flex-direction: column; gap: 10px; }
    .wa-tarjeta { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); background: var(--gris-0); cursor: pointer;
      transition: border-color var(--transicion), box-shadow var(--transicion); }
    .wa-tarjeta:hover { border-color: var(--gris-4); }
    .wa-tarjeta.elegida { border-color: var(--azul, #2f6bff); box-shadow: 0 0 0 3px rgba(47, 107, 255, .12); }
    .wa-tarjeta > input { margin-top: 3px; }
    .wa-cuerpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .wa-fila1 { display: flex; align-items: center; gap: 8px; } .wa-fila1 .chip { margin-left: auto; }
    .wa-destino { font-size: 12.5px; }
    .wa-valores { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 6px; font-size: 14px; font-variant-numeric: tabular-nums; }
    .wa-unificado { margin-top: 4px; font-size: 12.5px; color: var(--verde); font-weight: 600; }
    .wa-mensajes { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; }
    .wa-mensaje { padding: 12px 14px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); background: var(--gris-0); display: flex; flex-direction: column; gap: 8px; }
    .wa-mcab { display: flex; flex-direction: column; gap: 2px; }
    @media (max-width: 900px) { .wa-columnas { grid-template-columns: 1fr; } .wa-mensajes { position: static; } }
    /* Formulario del viaje: rejilla fija de 3 columnas, etiquetas en una línea e inputs de igual alto */
    .rejilla { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 16px; align-items: start; }
    .rejilla .campo > label, .rejilla .campo > .etiqueta { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lectura { height: 42px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 0 12px; border-radius: 10px;
      border: 1px dashed var(--gris-3); background: var(--gris-1); font-weight: 700; font-variant-numeric: tabular-nums; }
    .lectura small { font-size: 11px; color: var(--gris-5); font-weight: 600; }
    .caja { height: 42px; padding: 0 12px; border: 1px solid var(--gris-3); border-radius: 10px; background: var(--campo); }
    .nota { margin: 12px 0 0; font-size: 12.5px; color: var(--gris-5); }
    @media (max-width: 760px) { .rejilla { grid-template-columns: 1fr; } }
    .wa-texto { white-space: pre-wrap; font-family: inherit; background: var(--gris-1); border-radius: 10px; padding: 12px; margin: 0; font-size: 13.5px; }
    .boton.wa { background: var(--whatsapp); border-color: var(--whatsapp); color: #fff; }
    .tanda { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin-bottom: 14px; padding: 10px 12px; border-radius: var(--radio);
      background: var(--verde-claro); border: 1px solid var(--verde-borde); font-size: 13.5px; }
    .tanda small { flex-basis: 100%; }
    .seguir { margin-right: auto; font-size: 13.5px; }
    .pregunta-manifiesto { display: flex; align-items: center; gap: 8px; padding-left: 10px; border-left: 1px solid var(--gris-2); }
    .pregunta-manifiesto span { font-weight: 600; font-size: 13.5px; white-space: nowrap; }
    .requiere { align-items: flex-start; padding: 12px 14px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .requiere span { display: flex; flex-direction: column; gap: 2px; }
    .requiere small { color: var(--gris-5); font-size: 12.5px; }
    @media (max-width: 760px) { .resumen { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class Viajes {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeRegistrar = this.auth.tiene(P.VIAJES_REGISTRAR);
  readonly puedeEditarTodos = this.auth.tiene(P.VIAJES_EDITAR_TODOS);
  readonly plantillasAbierto = signal(false);
  readonly waPlantillas = signal<any[]>([]);
  waPlantilla = '';
  readonly periodos: [Periodo, string][] = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', '7 días'], ['mes', 'Este mes'], ['rango', 'Rango']];
  readonly periodo = signal<Periodo>('hoy');
  readonly waAbierto = signal(false);
  readonly waMensajes = signal<any[]>([]);
  waFecha = hoyIso();
  waIncluir = false;
  waUnificar = false;
  // Viajes de la fecha para elegir cuáles se reportan (ninguno marcado al abrir)
  readonly waViajes = signal<any[]>([]);
  readonly waSeleccion = signal(new Set<string>());
  readonly waTodos = computed(() => this.waViajes().length > 0 && this.waViajes().every(x => this.waSeleccion().has(x._id)));
  readonly waPendientes = computed(() => this.waViajes().filter(x => !x.reportado).length);
  // Editar un viaje desde el reporte; al cerrar el formulario, el reporte se actualiza con los valores nuevos
  async editarDesdeWa(id: string) {
    try { this.editar(await this.api.get<Viaje>(`/viajes/${id}`)); this.waRefrescarAlCerrar = true; } catch (e) { this.avisos.error(e); }
  }
  private waRefrescarAlCerrar = false;
  private waRefresco = effect(() => {
    if (!this.abierto() && untracked(() => this.waAbierto()) && this.waRefrescarAlCerrar) { this.waRefrescarAlCerrar = false; untracked(() => this.cargarWhatsapp()); }
  });
  waAlternar(id: string) {
    const s = new Set(this.waSeleccion());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.waSeleccion.set(s); this.cargarWhatsapp();
  }
  waAlternarTodos() { this.waSeleccion.set(this.waTodos() ? new Set() : new Set(this.waViajes().map(x => x._id))); this.cargarWhatsapp(); }
  waLimpiar() { this.waSeleccion.set(new Set()); this.cargarWhatsapp(); }
  habilitarRndc = false;
  readonly estados = Object.entries(ESTADOS_VIAJE);
  readonly viajes = signal<Viaje[]>([]);
  readonly total = signal(0);
  readonly sumas = signal({ flete: 0, anticipo: 0, saldo: 0, auxiliar: 0, retefuente: 0, fopat: 0 });
  private autorizacion = inject(AutorizacionAdmin);
  readonly cargando = signal(false);
  readonly cargandoMas = signal(false);
  private pagina = 1;
  readonly clientes = signal<any[]>([]);
  readonly clientesActivos = computed(() => this.clientes().filter(c => c.activo !== false));
  readonly tarifas = signal<any[]>([]);
  readonly placas = signal<any[]>([]);
  readonly form = signal<Formulario>(vacio());
  readonly tarifasCliente = computed(() => this.tarifas().filter(t => (t.cliente?._id || t.cliente) === this.form().cliente && t.activo !== false));
  readonly abierto = signal(false);
  readonly guardando = signal(false);
  readonly bloqueado = signal(false);
  readonly numeroEditado = signal(0);
  // Por defecto solo los viajes de HOY (no todo el histórico)
  filtro = { desde: hoyIso(), hasta: hoyIso(), cliente: '', estado: '', q: '' };
  private temporizadorPlacas: ReturnType<typeof setTimeout> | undefined;

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['viajes', 'rndc', 'rastreo', 'liquidaciones', 'gestion', 'maestros'], () => this.cargar());

  constructor() {
    this.cargar();
    this.cargarMaestros();
    this.rastreoSrv.cargar();
  }

  descripcionPeriodo() {
    const p = this.periodo();
    if (p === 'hoy') return `Despachos de hoy, ${new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    if (p === 'ayer') return 'Despachos de ayer';
    if (p === 'semana') return 'Despachos de los últimos 7 días';
    if (p === 'mes') return 'Despachos del mes en curso';
    return 'Despachos del rango seleccionado';
  }

  elegirPeriodo(p: Periodo) {
    this.periodo.set(p);
    const hoy = hoyIso();
    if (p === 'hoy') this.filtro = { ...this.filtro, desde: hoy, hasta: hoy };
    if (p === 'ayer') { const a = diasAtras(1); this.filtro = { ...this.filtro, desde: a, hasta: a }; }
    if (p === 'semana') this.filtro = { ...this.filtro, desde: diasAtras(6), hasta: hoy };
    if (p === 'mes') this.filtro = { ...this.filtro, desde: inicioMesIso(), hasta: hoy };
    if (p !== 'rango') this.cargar();
  }

  async cargarMaestros() {
    try {
      const [c, t] = await Promise.all([this.api.get<any[]>('/maestros/clientes'), this.api.get<any[]>('/maestros/tarifas')]);
      this.clientes.set(c); this.tarifas.set(t);
    } catch (e) { this.avisos.error(e); }
  }

  // Primera página (reinicia la lista)
  async cargar() {
    this.cargando.set(true);
    this.pagina = 1;
    try {
      const r = await this.api.get<any>('/viajes', { ...this.filtro, pagina: 1, limite: POR_PAGINA });
      this.viajes.set(r.viajes); this.total.set(r.total);
      if (r.sumas) this.sumas.set(r.sumas);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  // Páginas siguientes (carga progresiva)
  async cargarMas() {
    if (this.cargandoMas() || this.viajes().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/viajes', { ...this.filtro, pagina: this.pagina + 1, limite: POR_PAGINA });
      this.pagina += 1;
      this.viajes.update(l => [...l, ...r.viajes]);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoMas.set(false); }
  }

  estadoTexto(e: string) { return ESTADOS_VIAJE[e] || e; }
  claseEstado(e: string) { return ({ manifestado: 'marca', cumplido: 'ok', anulado: 'error', remesa: 'alerta' } as Record<string, string>)[e] || ''; }

  nuevo() { this.rastreoSrv.cargar(); this.rastreoForm.set(null); this.viajeRastreo = null; this.rastrear.set(false); this.form.set(vacio()); this.bloqueado.set(false); this.registradosTanda.set([]); this.placasConductor.set([]); this.abierto.set(true); }

  editar(v: Viaje) {
    this.numeroEditado.set(v.numero);
    this.form.set({
      _id: v._id, fecha: isoDia(v.fecha), cliente: v.cliente?._id || '', tarifaRef: v.tarifaRef?._id || v.tarifaRef || '',
      destino: v.destino, codDestino: v.codDestino, placa: v.placa, remolque: v.remolque, conductor: v.conductor?._id || '',
      titular: v.titular?._id || '', pesoKg: v.pesoKg, cantidad: v.cantidad, conAuxiliar: v.conAuxiliar, diasAuxiliar: v.diasAuxiliar || null, planilla: v.planilla || '', tarifa: v.tarifa,
      flete: v.flete, anticipo: v.anticipo, observaciones: v.observaciones, estado: v.estado, historico: !!v.historico,
      requiereManifiesto: v.requiereManifiesto !== false,
    });
    this.habilitarRndc = false;
    this.rastreoForm.set((v as any).rastreo || null);
    this.viajeRastreo = v;
    this.bloqueado.set(v.estado !== 'registrado' || !!v.liquidacion);
    this.abierto.set(true);
  }

  cambiarCliente(_: string) { this.form.update(f => ({ ...f, tarifaRef: '', destino: '', codDestino: '' })); }

  // Destino con sugerencias: si coincide con un destino del cliente se toman su tarifa y valores;
  // si no, es un destino nuevo (se pide el municipio).
  escribirDestino(texto: string) {
    const clave = (x: string) => String(x || '').trim().toLocaleLowerCase('es');
    const t = this.tarifasCliente().find(x => clave(x.destino) === clave(texto));
    if (t) { this.form.update(f => ({ ...f, tarifaRef: t._id, destino: t.destino })); this.cambiarDestino(t._id); return; }
    this.form.update(f => ({ ...f, destino: texto, ...(f.tarifaRef ? { tarifaRef: '', codDestino: '' } : {}) }));
  }

  // Al escoger un destino con tarifa se sugieren sus valores.
  cambiarDestino(id: string) {
    const t = this.tarifas().find(x => x._id === id);
    if (!t) return;
    this.form.update(f => ({ ...f, destino: t.destino, codDestino: t.codMunicipio, tarifa: t.tarifaCliente, flete: t.fleteConductor,
      anticipo: t.anticipoHabitual, pesoKg: t.pesoKg || f.pesoKg }));
  }

  buscarPlacas(q: string) {
    clearTimeout(this.temporizadorPlacas);
    if (!q || q.length < 2) return;
    this.temporizadorPlacas = setTimeout(async () => {
      this.placas.set(await this.api.get<any[]>('/maestros/vehiculos', { q, activos: 1, limite: 15 }).catch(() => []));
    }, 200);
  }

  // Al elegir el conductor se pone su placa (vehículo habitual o último viaje) y su remolque
  readonly placasConductor = signal<string[]>([]);
  elegirConductor(t: any) {
    const placas: string[] = t?.placas || [];
    this.placasConductor.set(placas);
    if (!placas.length) return;
    // La primera es la placa principal del conductor (si la tiene)
    this.form.update(f => ({ ...f, placa: placas[0], remolque: f.remolque || t.remolque || '' }));
    setTimeout(() => document.getElementById('v-peso')?.focus(), 30);
    this.revisarDocumentos();
  }

  // Licencia del conductor, SOAT y tecnomecánica: vencidos no dejan registrar; por vencer, aviso
  readonly documentos = signal<{ vencidos: string[]; avisos: string[] } | null>(null);
  async revisarDocumentos() {
    const f = this.form();
    if (!f.conductor && !f.placa) { this.documentos.set(null); return; }
    try { this.documentos.set(await this.api.get('/gestion/documentos', { conductor: f.conductor, placa: String(f.placa || '').toUpperCase() })); }
    catch { this.documentos.set(null); }
  }

  // Soporte interno MC/RC del viaje (se numera la primera vez) y se muestra en pantalla
  readonly visor = viewChild.required(VisorPdf);
  async soporteInterno() {
    const id = this.form()._id;
    try {
      const s = await this.api.post<any>(`/gestion/soportes/viajes/${id}`, {});
      await this.visor().ver(`/gestion/soportes/viajes/${id}/pdf`, `Soporte interno ${s.mc} / ${s.rc}`);
    } catch (e) { this.avisos.error(e); }
  }
  usarPlaca(p: string) { this.form.update(f => ({ ...f, placa: p })); this.revisarDocumentos(); }

  async sugerirPorPlaca() {
    const placa = this.form().placa.trim().toUpperCase();
    if (placa.length < 5 || this.form().conductor) return;
    try {
      const s = await this.api.get<any>(`/viajes/sugerencias/placa/${encodeURIComponent(placa)}`);
      this.form.update(f => ({ ...f, conductor: s.conductor || f.conductor, remolque: f.remolque || s.remolque || '' }));
    } catch { /* sin sugerencia */ }
  }

  // Viajes registrados seguidos del mismo cliente (sin cerrar el formulario)
  readonly registradosTanda = signal<{ numero: number; placa: string; sinManifiesto: boolean }[]>([]);
  readonly seguirRegistrando = signal(leerSeguir());
  alternarSeguir() {
    this.seguirRegistrando.set(!this.seguirRegistrando());
    try { localStorage.setItem('tls_seguir_registrando', this.seguirRegistrando() ? '1' : '0'); } catch { /* sin almacenamiento */ }
  }
  cerrarFormulario() { this.abierto.set(false); if (this.registradosTanda().length) this.cargar(); this.registradosTanda.set([]); }

  // Al crear, la respuesta «¿Requiere manifiesto?» (Sí / No) define cómo se guarda el viaje.
  async guardar(requiere?: boolean) {
    const f = this.form();
    if (!f._id && requiere === undefined) { this.avisos.mostrar('Elija «Sí, guardar» o «No, guardar» según si el viaje requiere manifiesto', 'info'); return; }
    if (!f._id) f.requiereManifiesto = !!requiere;
    if (!f.conductor && !this.bloqueado()) { this.avisos.mostrar('Seleccione el conductor', 'error'); return; }
    const cuerpo: any = { ...f, placa: f.placa.toUpperCase(), remolque: (f.remolque || '').toUpperCase(), tarifaRef: f.tarifaRef || null };
    delete cuerpo._id; delete cuerpo.estado; delete cuerpo.titular;
    for (const k of ['pesoKg', 'cantidad', 'diasAuxiliar', 'tarifa', 'flete', 'anticipo']) if (cuerpo[k] === null || cuerpo[k] === '') delete cuerpo[k];
    delete cuerpo.historico;
    if (this.bloqueado()) {
      for (const k of Object.keys(cuerpo)) if (!['observaciones', 'cantidad', 'conAuxiliar', 'diasAuxiliar', 'planilla', 'tarifa'].includes(k)) delete cuerpo[k];
    }
    if (f.historico && this.habilitarRndc) cuerpo.historico = false;
    this.guardando.set(true);
    try {
      if (f._id) await this.api.put(`/viajes/${f._id}`, cuerpo);
      else {
        let v: Viaje;
        try { v = await this.api.post<Viaje>('/viajes', cuerpo); }
        catch (e) {
          // Documentos vencidos: solo con la autorización del administrador (CA-06)
          const vencidos = AutorizacionAdmin.vencidosDe(e);
          if (!vencidos) throw e;
          const aut = await this.autorizacion.pedir(vencidos);
          if (!aut) return;
          v = await this.api.post<Viaje>('/viajes', { ...cuerpo, autorizacion: aut });
          this.avisos.ok('Viaje autorizado por el administrador');
        }
        this.avisos.ok(`Viaje N° ${v.numero} registrado${requiere ? '' : ' (sin manifiesto)'}`);
        const avisosDoc: string[] = (v as any).avisosDocumentos || [];
        if (avisosDoc.length) this.avisos.mostrar(`Por vencer: ${avisosDoc.join('; ')}`, 'info');
        // «Rastrear este viaje»: se abre el asistente para elegir destino o clientes
        if (this.rastreoHabilitado() && this.rastrear()) { this.viajeRastreo = v; setTimeout(() => this.activador().abrir(v), 0); }
        this.documentos.set(null);
        if (this.seguirRegistrando()) {
          // Listo para el siguiente: mismo cliente, destino, fecha y valores; vehículo y conductor nuevos
          this.registradosTanda.update(l => [...l, { numero: v.numero, placa: v.placa, sinManifiesto: !requiere }]);
          // El destino (y sus valores) cambian en cada viaje: se dejan vacíos
          this.form.set({ ...f, tarifaRef: '', destino: '', codDestino: '', tarifa: null, flete: null, anticipo: null, pesoKg: null, cantidad: 1,
            conAuxiliar: false, diasAuxiliar: null, planilla: '', placa: '', remolque: '', conductor: '', titular: '', observaciones: '', requiereManifiesto: true });
          this.placasConductor.set([]);
          setTimeout(() => document.getElementById('v-dest')?.focus(), 50);
          return;
        }
      }
      this.abierto.set(false);
      this.registradosTanda.set([]);
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.guardando.set(false); }
  }

  async eliminar() {
    try {
      await this.api.delete(`/viajes/${this.form()._id}`);
      this.avisos.ok('Viaje eliminado');
      this.abierto.set(false);
      this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  // ── Reporte WhatsApp ──
  async abrirWhatsapp() { this.waFecha = this.filtro.hasta || hoyIso(); this.waAbierto.set(true); await this.cargarPlantillas(); this.cargarWhatsapp(true); }

  async cargarPlantillas() {
    try {
      const r = await this.api.get<any>('/viajes/plantillas-whatsapp');
      this.waPlantillas.set(r.plantillas);
      if (!r.plantillas.some((p: any) => p._id === this.waPlantilla)) this.waPlantilla = (r.plantillas.find((p: any) => p.predeterminada) || r.plantillas[0])._id;
      if (this.waAbierto()) this.cargarWhatsapp();
    } catch (e) { this.avisos.error(e); }
  }

  // reiniciar: al cambiar la fecha o el filtro se quita la selección
  async cargarWhatsapp(reiniciar = false) {
    if (reiniciar) this.waSeleccion.set(new Set());
    try {
      const r = await this.api.get<{ mensajes: any[]; viajes: any[] }>('/viajes/reporte-whatsapp', { fecha: this.waFecha, incluirReportados: this.waIncluir ? 1 : 0,
        plantilla: this.waPlantilla, seleccion: 1, viajes: [...this.waSeleccion()].join(','), unificarAuxiliar: this.waUnificar ? 1 : 0 });
      this.waViajes.set(r.viajes);
      // Lo elegido que ya no está en la lista (p. ej. marcado como reportado) se quita de la selección
      const ids = new Set(r.viajes.map(x => x._id));
      if ([...this.waSeleccion()].some(id => !ids.has(id))) this.waSeleccion.set(new Set([...this.waSeleccion()].filter(id => ids.has(id))));
      this.waMensajes.set(r.mensajes);
    } catch (e) { this.avisos.error(e); }
  }

  async copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); this.avisos.ok('Mensaje copiado'); } catch { this.avisos.mostrar('No se pudo copiar; seleccione el texto manualmente', 'error'); }
  }

  async marcarReportado(m: any) {
    try {
      await this.api.post('/viajes/reporte-whatsapp/marcar', { viajes: m.viajes });
      this.avisos.ok(`${m.cliente}: ${m.cantidad} vehículo(s) marcados como reportados`);
      this.cargarWhatsapp(); this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  // ── Rastreo GPS con Sur Track ──
  private rastreoSrv = inject(Rastreo);
  readonly rastreoHabilitado = computed(() => !!this.rastreoSrv.estado()?.habilitado);
  readonly rastrear = signal(false);
  readonly rastreoForm = signal<any>(null);
  textoRastreo(e: string) { return ESTADOS_RASTREO[e]?.texto || 'Activo'; }
  claseRastreo(e: string) { return 'chip sin-punto gps ' + (ESTADOS_RASTREO[e]?.clase || ''); }
  // Asistente de rastreo: modalidad solo destino o con clientes
  private activador = viewChild.required(ActivarRastreo);
  readonly checklist = viewChild.required(ChecklistConductor);
  private viajeRastreo: any = null;
  activarRastreo() { this.abrirActivar(false); }
  abrirActivar(cambiar: boolean) {
    const v = this.viajeRastreo || { ...this.form(), conductorNombre: '', cliente: this.clientes().find(c => c._id === this.form().cliente) };
    this.activador().abrir(v, cambiar ? this.rastreoForm() : undefined);
  }
  rastreoListo(r: any) { this.rastreoForm.set(r); this.cargar(); }
  async terminarRastreo() {
    try { this.rastreoForm.set(await this.rastreoSrv.finalizar(this.form()._id!)); this.avisos.ok('Rastreo terminado'); this.cargar(); }
    catch (e) { this.avisos.error(e); }
  }

  // Excel y PDF: general, por empresa o por placa, con el periodo a elegir
  readonly exportador = viewChild.required(ExportarViajes);
  descargar() { this.exportador().abrir({ cliente: this.filtro.cliente }); }

}
