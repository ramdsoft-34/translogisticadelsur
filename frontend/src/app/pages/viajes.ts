import { textoLimite } from '../core/seguro';
import { Turno } from '../core/turno';
import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
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
import { Paginador } from '../shared/paginador';
import { ListaServidor } from '../shared/lista-servidor';
import { BuscarTercero } from '../shared/buscar-tercero';
import { PlantillasWhatsapp } from '../shared/plantillas-whatsapp';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { ExportarViajes } from '../shared/exportar-viajes';
import { AccionesViajes, ViajeElegido } from '../shared/acciones-viajes';
import { CarguesBodega } from '../shared/cargues-bodega';
import { ESTADOS_RASTREO, Rastreo } from '../core/rastreo.service';
import { ActivarRastreo } from '../shared/activar-rastreo';
import { ChecklistConductor } from '../shared/checklist-conductor';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AutorizacionAdmin } from '../core/autorizacion.service';

interface Formulario {
  licencia?: string; conLicencia?: boolean; numeroManifiesto?: string; seguro?: boolean;
  auxiliarPagado?: boolean | null;   // null = según la regla (reportado hoy → pagado)
  _id?: string; fecha: string; cliente: string; tarifaRef: string; destino: string; codDestino: string;
  // Origen / remitente: vacío = el predeterminado (la sede remitente del cliente)
  codOrigen?: string; remitente?: { tipoId: string; numId: string; sede: string };
  placa: string; remolque: string; conductor: string; titular: string;
  pesoKg: number | null; cantidad: number | null; conAuxiliar: boolean; diasAuxiliar: number | null; planilla: string;
  tarifa: number | null; flete: number | null; anticipo: number | null; observaciones: string; estado?: string; historico?: boolean;
  requiereManifiesto: boolean;
}

const vacio = (): Formulario => ({
  fecha: hoyIso(), cliente: '', tarifaRef: '', destino: '', codDestino: '', codOrigen: '', remitente: { tipoId: '', numId: '', sede: '' }, placa: '', remolque: '', conductor: '', titular: '',
  pesoKg: null, cantidad: 1, conAuxiliar: false, diasAuxiliar: null, planilla: '', tarifa: null, flete: null, anticipo: null, observaciones: '', requiereManifiesto: true,
});

type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango';
const POR_PAGINA = 50;
const leerSeguir = () => { try { return localStorage.getItem('tls_seguir_registrando') !== '0'; } catch { return true; } };
const n2 = (x: string) => String(x || '').trim().toLowerCase();
const digitosTxt = (v: any) => String(v ?? '').replace(/\D/g, '');
const idClienteTxt = (c: any) => c?.tipoId === 'N' ? digitosTxt(c.nit) + digitosTxt(c.dv) : digitosTxt(c?.nit);
const ordenarSedesTxt = (l: any[]) => [...l].sort((a, b) => String(a.sede.codigo).localeCompare(String(b.sede.codigo), 'es', { numeric: true }));
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

@Component({
  selector: 'app-viajes',
  imports: [FormsModule, NgTemplateOutlet, Modal, Icono, MenuAcciones, SelectorMunicipio, Moneda, Paginador, BuscarTercero, PlantillasWhatsapp, Confirmar, VisorPdf, ExportarViajes, AccionesViajes, CarguesBodega, RouterLink, ActivarRastreo, ChecklistConductor, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Viajes</h1><p class="sutil">{{ descripcionPeriodo() }}</p></div>
      <div class="acciones">
        <app-menu-acciones texto="Reportes">
          <button (click)="abrirWhatsapp()"><app-icono nombre="enviar" [tam]="16" />Reporte por WhatsApp<small>Mensaje por cliente con los viajes seleccionados</small></button>
          <button (click)="descargar()"><app-icono nombre="descargar" [tam]="16" />Exportar Excel o PDF<small>General, por empresa o por placa</small></button>
        </app-menu-acciones>
        @if (puedeRegistrar) { <button (click)="bodegaAbierto.set(true)" title="Lo que reportan los jefes de bodega por el enlace de WhatsApp"><app-icono nombre="enviar" [tam]="16" />Cargues de bodega</button> }
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
        <thead><tr>@if (puedeRegistrar) { <th class="col-sel"><input type="checkbox" title="Seleccionar los viajes que se ven" aria-label="Seleccionar los viajes que se ven"
            [checked]="visiblesElegidos()" [indeterminate]="algunoVisible() && !visiblesElegidos()" (change)="elegirVisibles($any($event.target).checked)" /></th> }
          <th>N°</th><th>Fecha</th><th>Cliente / destino</th><th>Placa</th><th>Conductor</th>
          <th class="num">Flete</th><th class="num">Anticipo</th><th class="num">Auxiliar</th><th class="num">Saldo</th><th>Estado</th></tr></thead>
        <tbody>
          @for (v of viajes(); track v._id) {
            <tr class="seleccionable" [class.elegido]="elegidos().has(v._id)" (click)="editar(v)" tabindex="0" (keydown.enter)="editar(v)">
              @if (puedeRegistrar) { <td class="col-sel" data-etiqueta="Elegir" (click)="$event.stopPropagation()"><input type="checkbox" [checked]="elegidos().has(v._id)"
                (change)="elegirViaje(v, $any($event.target).checked)" [attr.aria-label]="'Seleccionar el viaje ' + v.numero" /></td> }
              <td data-etiqueta="N°" class="sutil">{{ v.numero }}</td><td data-etiqueta="Fecha">{{ v.fecha | dia }}</td>
              <td data-etiqueta="Cliente"><span class="celda-doble"><span>{{ v.cliente?.nombre }}</span><small>{{ v.destino }}</small></span></td>
              <td data-etiqueta="Placa"><span class="placa">{{ v.placa }}</span></td><td data-etiqueta="Conductor">{{ v.conductorNombre }}</td>
              <td data-etiqueta="Flete" class="num">{{ v.flete | pesos }}</td><td data-etiqueta="Anticipo" class="num">{{ v.anticipo | pesos }}</td><td data-etiqueta="Auxiliar" class="num">{{ $any(v).auxiliar ? ($any(v).auxiliar | pesos) : '—' }}</td><td data-etiqueta="Saldo" class="num"><strong>{{ v.saldo | pesos }}</strong></td>
              <td data-etiqueta="Estado"><span class="estados">
                <span class="chip" [class]="claseEstado(v.estado)">{{ estadoTexto(v.estado) }}</span>
                @if (v.manifiesto.estado === 'aceptado') { <small class="sutil">{{ v.manifiesto.numero }}</small> }
                @if (v.historico) { <span class="chip sin-punto" title="Importado del Excel: sus documentos RNDC se gestionaron fuera de la plataforma">Histórico</span> }
                @if (v.origen === 'manifiesto') { <span class="chip sin-punto" title="Creado directamente en Manifiestos RNDC">Desde Manifiestos</span> }
                @if (v.requiereManifiesto === false) { <span class="chip sin-punto" title="No genera remesa ni manifiesto en el RNDC">Sin manifiesto</span> }
                @if (v.rastreo?.activo) { <a class="chip sin-punto gps" [class]="claseRastreo(v.rastreo!.estado)" [routerLink]="['/monitoreo']" [queryParams]="{ viaje: v._id }"
                  (click)="$event.stopPropagation()" title="Ver en el mapa de Monitoreo">GPS · {{ textoRastreo(v.rastreo!.estado) }}</a> }
                @if (v.reporteWhatsapp?.fecha) { <span class="chip ok sin-punto" title="Reportado por WhatsApp">WA</span> }
                @if ($any(v).seguro?.marcado) { <span class="chip sin-punto" [class.error]="v.manifiesto.estado !== 'anulado'" title="Seguro: el manifiesto se anula al día siguiente antes de las 9:00 a. m.">Seguro{{ v.manifiesto.estado === 'anulado' ? ' · anulado' : '' }}</span> }
              </span></td>
            </tr>
          } @empty {
            @if (cargando()) {
              @for (i of [1, 2, 3, 4]; track i) { <tr><td [attr.colspan]="puedeRegistrar ? 11 : 10"><span class="esqueleto"></span></td></tr> }
            } @else {
              <tr><td [attr.colspan]="puedeRegistrar ? 11 : 10" class="vacio"><strong>{{ periodo() === 'hoy' ? 'Aún no hay viajes hoy' : 'No hay viajes con estos filtros' }}</strong>
                {{ periodo() === 'hoy' ? 'Registre el primer despacho del día o revise otro periodo.' : 'Cambie el periodo o los filtros.' }}
                @if (puedeRegistrar && periodo() === 'hoy') { <div style="margin-top:12px"><button class="primario" (click)="nuevo()"><app-icono nombre="mas" [tam]="16" />Registrar viaje</button></div> }
              </td></tr>
            }
          }
        </tbody>
      </table>
      @if (elegidos().size) {
        <div class="barra-seleccion" role="status">
          <span><strong>{{ elegidos().size }}</strong> viaje{{ elegidos().size === 1 ? '' : 's' }} seleccionado{{ elegidos().size === 1 ? '' : 's' }}
            @if (fueraDeVista()) { <small class="sutil"> · {{ fueraDeVista() }} de otras búsquedas</small> }</span>
          <span class="acciones-barra">
            <button type="button" (click)="limpiarSeleccion()">Quitar selección</button>
            <button type="button" class="primario" (click)="accionesAbierto.set(true)">Acciones con la selección</button></span>
        </div>
      }
      <app-paginador [total]="total()" [pagina]="lista.pagina()" [porPagina]="lista.porPagina()" [cargando]="lista.cambiando()" unidad="viajes" (cambio)="lista.ir($event)" />
    </div>

    <app-modal [titulo]="form()._id ? 'Viaje N° ' + numeroEditado() : (registradosTanda().length ? 'Registrar otro viaje' : 'Registrar viaje')" [abierto]="abierto()" (cerrar)="cerrarFormulario()" [ancho]="true">
      <div class="registro-columnas">
      <div class="col-form">
      @let f = form();
      @if (bloqueado()) { <div class="mensaje info compacto-msj">Este viaje ya tiene documentos en el RNDC: solo puede cambiar observaciones, auxiliar, tarifa y licencia. Para cambiar el cliente, anule el manifiesto y la remesa.</div> }
      @if (f.historico && puedeEditarTodos) {
        <label class="casilla compacto-msj"><input type="checkbox" name="habilitar" [(ngModel)]="habilitarRndc" />Viaje histórico del Excel: habilitarlo para expedir en el RNDC</label>
      }
      <form id="form-viaje" (ngSubmit)="guardar()" class="registro" autocomplete="off">
        <label for="v-cli">Empresa:</label>
        <select id="v-cli" name="cliente" [(ngModel)]="f.cliente" (ngModelChange)="cambiarCliente($event)" [disabled]="bloqueado()" required>
          <option value="">Seleccione…</option>
          @for (c of clientesActivos(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }
        </select>
        @if (clienteConSeguros()) {
          <span class="etq">Seguro:</span>
          <div class="seguro-campo">
            <label class="casilla"><input type="checkbox" name="seguro" [(ngModel)]="f.seguro" />Es un seguro</label>
            @if (f.seguro) { <small class="sutil">Se anula al día siguiente antes de las 9:00 a. m.</small> }
          </div>
        }

        <span class="etq">Conductor:</span>
        <div>
          <app-buscar-tercero id="v-cond" etiqueta="" rol="conductor" [conPlacas]="true" [(valor)]="f.conductor" (elegido)="elegirConductor($event)"
            [deshabilitado]="bloqueado()" placeholder="Nombre, apellido o cédula" />
          @if (documentos(); as dc) {
            @if (dc.vencidos.length) { <span class="chip error sin-punto" [title]="dc.vencidos.join('; ')">Documentos vencidos: se pedirá autorización</span> }
            @else if (dc.avisos.length) { <span class="chip alerta sin-punto" [title]="dc.avisos.join('; ')">Documentos por vencer</span> }
            @else if (f.conductor) { <span class="chip ok sin-punto">Documentos al día</span> }
          }
        </div>

        <label for="v-lic">Licencia:</label>
        <div class="con-casilla">
          <input id="v-lic" name="licencia" [(ngModel)]="f.licencia" placeholder="Categoría-número" />
          <input type="checkbox" name="conLicencia" [(ngModel)]="f.conLicencia" title="Incluir la licencia en el reporte de WhatsApp" aria-label="Incluir la licencia en el reporte de WhatsApp" />
        </div>

        <label for="v-placa">Placa:</label>
        <div>
          <input id="v-placa" name="placa" list="lista-placas" [(ngModel)]="f.placa" (input)="buscarPlacas(f.placa)" (change)="sugerirPorPlaca(); revisarDocumentos()"
            [disabled]="bloqueado()" required style="text-transform:uppercase" placeholder="ABC123" />
          <datalist id="lista-placas">@for (x of placas(); track x._id) { <option [value]="x.placa"></option> }</datalist>
          @if (placasConductor().length > 1 && !bloqueado()) {
            <div class="placas-conductor" role="group" aria-label="Placas del conductor">
              @for (p of placasConductor(); track p) { <button type="button" class="pequeno" [class.primario]="f.placa === p" (click)="usarPlaca(p)">{{ p }}</button> }
            </div>
          }
        </div>

        <label for="v-orig">Origen:</label>
        <div>
          <input id="v-orig" name="origen" list="lista-origenes" [ngModel]="origenTexto() ?? textoOrigen()" (ngModelChange)="escribirOrigen($event)"
            (focus)="$any($event.target).select()" (blur)="cerrarOrigen()" (keydown.enter)="$event.preventDefault(); cerrarOrigen(); irADestino()" [disabled]="bloqueado() || !f.cliente"
            [placeholder]="f.cliente ? 'Escriba para buscar la sede o el municipio' : 'Primero elija la empresa'"
            title="Dónde se carga (remitente de la remesa). El predeterminado es la sede remitente del cliente" />
          <datalist id="lista-origenes">@for (o of opcionesOrigen(); track o.valor) { <option [value]="o.texto"></option> }</datalist>
          @if (valorOrigen() === 'otro') {
            <div class="otro-remitente">
              <input id="v-rem-num" name="remNum" [ngModel]="f.remitente?.numId" (change)="buscarRemitente($any($event.target).value)" maxlength="15" placeholder="NIT con DV o cédula del remitente" aria-label="Documento del remitente" />
              <select name="remSede" [ngModel]="f.remitente?.sede || ''" (ngModelChange)="elegirSedeOtro($event)" [disabled]="!sedesOtro().length" aria-label="Sede del remitente">
                <option value="">{{ sedesOtro().length ? 'Elija la sede…' : 'Sin sedes en la plataforma' }}</option>
                @for (x of sedesOtro(); track x.sede.codigo) { <option [value]="x.sede.codigo">Sede {{ x.sede.codigo }} · {{ x.sede.nombre }}</option> }
              </select>
            </div>
            @if (nombreOtro()) { <small class="sutil">{{ nombreOtro() }}. {{ nombreCliente() }} sigue como propietario de la carga.</small> }
            @else if (f.remitente?.numId && !sedesOtro().length) { <small class="sutil">No está en la plataforma: regístrelo o traiga sus sedes del RNDC en Clientes y tarifas.</small> }
          }
        </div>

        <label for="v-dest">Destino:</label>
        <div>
          <input id="v-dest" name="destino" list="lista-destinos" [ngModel]="f.destino" (ngModelChange)="escribirDestino($event)"
            [disabled]="bloqueado() || !f.cliente" [placeholder]="f.cliente ? 'Escriba para buscar el destino' : 'Primero elija la empresa'" required />
          <datalist id="lista-destinos">@for (t of tarifasCliente(); track t._id) { <option [value]="t.destino"></option> }</datalist>
          @if (f.destino && !f.tarifaRef) { <app-municipio etiqueta="Municipio del destino nuevo" [(codigo)]="f.codDestino" /> }
        </div>

        <label for="v-peso">Peso Kg:</label>
        <input id="v-peso" type="number" min="0" name="pesoKg" [(ngModel)]="f.pesoKg" [disabled]="bloqueado()" />

        <label for="v-tar">Tarifa:</label>
        <div class="moneda"><input id="v-tar" moneda name="tarifa" [(ngModel)]="f.tarifa" /></div>

        <label for="v-flete">Flete:</label>
        <div class="moneda"><input id="v-flete" moneda name="flete" [(ngModel)]="f.flete" [disabled]="bloqueado()" /></div>

        <label for="v-ant">Anticipo:</label>
        <div class="moneda"><input id="v-ant" moneda name="anticipo" [(ngModel)]="f.anticipo" [disabled]="bloqueado()" /></div>

        <label for="v-aux">Auxiliar:</label>
        <select id="v-aux" name="diasAux" class="corto" [ngModel]="f.conAuxiliar ? (f.diasAuxiliar || 1) : 0" (ngModelChange)="ponerAuxiliar($event)">
          <option [ngValue]="0">—</option>
          @for (d of [1, 2, 3, 4, 5]; track d) { <option [ngValue]="d">{{ d }} {{ d === 1 ? 'día' : 'días' }}</option> }
        </select>

        <span class="etq">Aux. Valor:</span>
        <div class="con-casilla">
          <div class="lectura-fila" style="flex:1">{{ f.conAuxiliar ? (valorAuxiliar() | pesos) : '' }}</div>
          @if (f.conAuxiliar) {
            <label class="casilla aux-pagado" title="Ya se le pagó al conductor (el viaje se reportó el día): en su liquidación no se suma al saldo">
              <input type="checkbox" name="auxPagado" [ngModel]="auxPagado()" (ngModelChange)="ponerAuxPagado($event)" />Pagado</label>
          }
        </div>

        <label for="v-obs">Observaciones:</label>
        <input id="v-obs" name="obs" maxlength="200" [(ngModel)]="f.observaciones" placeholder="Escribe [NO FACTURAR] para excluirlo de la factura" />

        <label for="v-man">Manifiesto:</label>
        <input id="v-man" name="manifiesto" maxlength="15" [(ngModel)]="f.numeroManifiesto" placeholder="Opcional" style="text-transform:uppercase" [disabled]="bloqueado()" />

        <div class="resumen-registro">
          <span><strong>N° de registro: {{ f._id ? numeroEditado() : (siguienteNumero() || '…') }}</strong></span>
          <span>Saldo <strong>{{ ((f.flete || 0) - (f.anticipo || 0)) | pesos }}</strong></span>
          <span>Utilidad <strong>{{ ((f.tarifa || 0) - (f.tarifa || 0) * 0.01 - (f.flete || 0)) | pesos }}</strong></span>
          <span>Retefuente 1% <strong>{{ ((f.flete || 0) * 0.01) | pesos }}</strong></span>
        </div>

        @if (rastreoHabilitado() && !f._id) {
          <span class="etq">Sur Track:</span>
          <label class="casilla sur-track"><input type="checkbox" name="rastrear" [ngModel]="rastrear()" (ngModelChange)="rastrear.set($event)" />Registrar este viaje en Sur Track (rastreo GPS)</label>
        }
        <label for="v-fecha">Fecha:</label>
        <input id="v-fecha" type="date" class="corto" name="fecha" [(ngModel)]="f.fecha" (ngModelChange)="fechaFormulario($event)" [disabled]="bloqueado()" required />
      </form>
      <!-- Botones debajo del formulario (no en el pie de la ventana) -->
      <div class="acciones-registro">
        @if (form()._id && !bloqueado() && puedeRegistrar) { <button class="peligro" type="button" confirmar="Clic otra vez para eliminar" (confirmado)="eliminar()">Eliminar</button> }
        @if (form()._id && rastreoHabilitado() && puedeRegistrar) {
          <button type="button" (click)="rastreoForm()?.activo ? null : activarRastreo()" [disabled]="guardando() || rastreoForm()?.activo"
            [title]="rastreoForm()?.activo ? 'El viaje ya se está rastreando' : 'Rastrear este viaje con Sur Track'"><app-icono nombre="ubicacion" [tam]="15" />{{ rastreoForm()?.activo ? 'Rastreo activo' : 'Rastrear' }}</button>
        }
        <button type="button" (click)="cerrarFormulario()">Cerrar</button>
        @if (puedeRegistrar) {
          @if (form()._id) {
            <button class="primario" type="submit" form="form-viaje" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          } @else if (!preguntarManifiesto()) {
            <button class="primario" type="button" (click)="preguntarManifiesto.set(true)" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
          } @else {
            <div class="pregunta-manifiesto" role="group" aria-label="¿Requiere manifiesto de carga?">
              <span>¿Requiere manifiesto?</span>
              <button type="button" class="primario" (click)="guardar(true)" [disabled]="guardando()">Sí</button>
              <button type="button" (click)="guardar(false)" [disabled]="guardando()">No</button>
            </div>
          }
        }
      </div>
      </div>
      <aside class="col-wa" aria-label="Reporte por WhatsApp">
        <h3>Reporte por WhatsApp</h3>
        <ng-container [ngTemplateOutlet]="panelWa" [ngTemplateOutletContext]="{ enFormulario: true }" />
      </aside>
      </div>
    </app-modal>

    <app-modal titulo="Reporte de vehículos por WhatsApp" [abierto]="waAbierto()" (cerrar)="waAbierto.set(false)" [ancho]="true">
      <ng-container [ngTemplateOutlet]="panelWa" [ngTemplateOutletContext]="{ enFormulario: false }" />
      <ng-container pie><button type="button" (click)="waAbierto.set(false)">Cerrar</button></ng-container>
    </app-modal>

    <!-- Reporte de WhatsApp: en su propia ventana y como columna derecha de «Registrar viaje» -->
    <ng-template #panelWa let-enFormulario="enFormulario">
      <div class="wa-barra">
        @if (!enFormulario) { <div class="campo"><label for="wa-fecha">Fecha</label><input id="wa-fecha" type="date" [(ngModel)]="waFecha" (change)="cargarWhatsapp(true)" /></div> }
        @else { <span class="wa-fecha-form">Viajes del {{ waFecha | dia }}</span> }
        <button type="button" (click)="waAlternarTodos()" [disabled]="!waViajes().length">{{ waTodos() ? 'Desmarcar todos' : 'Marcar todos' }}</button>
        <button type="button" [class.activo-filtro]="!waIncluir" (click)="waIncluir = !waIncluir; cargarWhatsapp(true)"
          [title]="waIncluir ? 'Mostrar solo los que faltan por reportar' : 'Mostrar también los ya reportados'">{{ waIncluir ? 'Solo pendientes' : 'Ver todos' }}</button>
        <div class="campo"><label for="wa-pl">Plantilla</label>
          <select id="wa-pl" [(ngModel)]="waPlantilla" (change)="cargarWhatsapp()">
            @for (p of waPlantillas(); track p._id) { <option [value]="p._id">{{ p.nombre }}{{ p.predeterminada ? ' (predeterminada)' : '' }}</option> }</select></div>
        <button type="button" (click)="plantillasAbierto.set(true)" style="margin-left:auto" [title]="'Editar las plantillas del mensaje'"><app-icono nombre="editar" [tam]="16" />Plantillas</button>
      </div>
      <p class="wa-unificar sutil"><span><strong>Reportar</strong> elige los viajes del mensaje. <strong>Unificar aux.</strong> suma el auxiliar al flete y al anticipo de ese viaje y escribe «Unificado» (solo en el mensaje; los valores del viaje no cambian).</span></p>

      <div class="wa-columnas" [class.apilado]="enFormulario">
        <!-- Izquierda: los viajes de la fecha -->
        <section class="wa-viajes" aria-label="Viajes de la fecha">
          <p class="sutil wa-conteo">{{ waViajes().length }} viaje(s) · {{ waPendientes() }} pendiente(s) · {{ waSeleccion().size }} elegido(s)</p>
          @for (x of waViajes(); track x._id) {
            <article class="wa-tarjeta" [class.elegida]="waSeleccion().has(x._id)" (click)="waAlternar(x._id)">
              <div class="wa-checks" (click)="$event.stopPropagation()">
                <label class="casilla" title="Incluir este viaje en el mensaje"><input type="checkbox" [checked]="waSeleccion().has(x._id)" (change)="waAlternar(x._id)" [attr.aria-label]="'Reportar viaje ' + x.numero" />Reportar</label>
                @if (x.auxiliar) {
                  <label class="casilla" title="Sumar el auxiliar al flete y al anticipo en el mensaje"><input type="checkbox" [checked]="waUnificados().has(x._id)" (change)="waAlternarUnificado(x._id)" [attr.aria-label]="'Unificar auxiliar del viaje ' + x.numero" />Unificar aux.</label>
                }
                @if (x.permiteSeguro && puedeRegistrar) {
                  <label class="casilla" title="El manifiesto se expide normal y hay que anularlo al día siguiente antes de las 9:00 a. m."><input type="checkbox" [checked]="x.seguro" (change)="marcarSeguro(x, $any($event.target).checked)" [attr.aria-label]="'Marcar como seguro el viaje ' + x.numero" />Seguro</label>
                }
              </div>
              <div class="wa-cuerpo">
                <div class="wa-fila1"><strong>N° {{ x.numero }}</strong> <span class="sutil">{{ x.cliente }}</span>
                  <span class="chip sin-punto" [class.ok]="x.reportado" [class.alerta]="!x.reportado">{{ x.reportado ? 'Reportado' : 'Pendiente' }}</span>
                  @if (x.seguro) { <span class="chip sin-punto error" title="Anular el manifiesto al día siguiente antes de las 9:00 a. m.">Seguro</span> }</div>
                <div>{{ x.conductor }} · <strong>{{ x.placa }}</strong></div>
                <div class="sutil wa-destino">{{ x.destino }}</div>
                <div class="wa-valores">
                  <span>Flete <strong>{{ x.flete | pesos }}</strong></span>
                  <span>Anticipo <strong>{{ x.anticipo | pesos }}</strong></span>
                  @if (x.auxiliar) { <span>Aux. {{ x.diasAuxiliar }}d <strong>{{ x.auxiliar | pesos }}</strong></span> } @else { <span class="sutil">Sin auxiliar</span> }
                </div>
                @if (waUnificados().has(x._id) && x.auxiliar && waSeleccion().has(x._id)) {
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
                <a class="boton pequeno wa" [href]="m.enlace" target="_blank" rel="noopener noreferrer" (click)="puedeRegistrar && marcarReportado(m)"><app-icono nombre="enviar" [tam]="15" />Reportar por WhatsApp</a>
                @if (puedeRegistrar) { <button class="pequeno" (click)="marcarReportado(m)" title="Lo marca como reportado sin abrir WhatsApp; pasa a Manifiestos">Marcar como reportado</button> }
              </div>
            </div>
          } @empty {
            <p class="vacio">{{ waViajes().length ? 'Marque los viajes que va a reportar: aquí se arma un mensaje por cliente.' : 'Sin mensajes.' }}</p>
          }
        </section>
      </div>
    </ng-template>
    <app-visor-pdf />
    <app-activar-rastreo (listo)="rastreoListo($event)" />
    <app-checklist-conductor />
    <app-exportar-viajes [clientes]="clientes()" />
    <app-cargues-bodega [abierto]="bodegaAbierto()" (cerrar)="bodegaAbierto.set(false)" (registrados)="cargar()" />
    <app-acciones-viajes [abierto]="accionesAbierto()" [seleccion]="listaElegidos()" (cerrar)="accionesAbierto.set(false)"
      (quitar)="quitarElegido($event)" (aplicado)="trasAccionMasiva($event)" />
    <app-plantillas-whatsapp [abierto]="plantillasAbierto()" [fecha]="waFecha" (cerrar)="plantillasAbierto.set(false)" (cambiadas)="cargarPlantillas()" />`,
  styles: [`
    .col-sel { width: 36px; } .col-sel input { width: 18px; height: 18px; min-height: 0; cursor: pointer; }
    tr.elegido td { background: var(--primario-claro, #FFF8E1); }
    .barra-seleccion { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 32px)); z-index: 40; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-radius: 14px; background: var(--gris-9, #111); color: #fff; box-shadow: var(--sombra-2); }
    .barra-seleccion .sutil { color: #ccc; } .acciones-barra { display: flex; gap: 8px; flex-wrap: wrap; }
    .barra-seleccion button:not(.primario) { background: transparent; color: #fff; border-color: #555; }
    .seguro-campo { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; }
    .seguro-campo .casilla { margin: 0; white-space: nowrap; }
    .seguro-campo small { min-width: 0; }

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
    .registro-columnas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 16px; align-items: start; }
    .acciones-registro { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--gris-2); }
    .col-form { padding: 12px 14px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); background: var(--gris-0); }
    .registro { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 6px 10px; align-items: center; font-size: 13.5px; }
    .registro > label, .registro > .etq { font-weight: 700; white-space: nowrap; }
    .otro-remitente { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 6px; margin-top: 6px; }
    .registro input, .registro select, .registro .moneda input { min-height: 34px; height: 34px; padding-top: 4px; padding-bottom: 4px; font-size: 13.5px; }
    .registro .corto { max-width: 170px; }
    .registro .con-casilla { display: flex; gap: 8px; align-items: center; } .registro .con-casilla input[type=text], .registro .con-casilla input:not([type]) { flex: 1; }
    .registro .con-casilla input[type=checkbox] { width: 20px; height: 20px; min-height: 0; flex: none; }
    .registro .aux-pagado { margin: 0; white-space: nowrap; flex: none; }
    .registro .lectura-fila { min-height: 34px; display: flex; align-items: center; padding: 0 12px; border-radius: 10px; border: 1px dashed var(--gris-3); background: var(--gris-1); font-weight: 700; font-variant-numeric: tabular-nums; }
    .registro .chip { margin-top: 4px; }
    .resumen-registro { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 6px 0 2px; font-size: 13px; font-variant-numeric: tabular-nums; }
    .compacto-msj { margin-bottom: 8px; font-size: 12.5px; }
    .col-wa { position: sticky; top: 0; padding: 12px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); background: var(--gris-1); max-height: calc(100dvh - 190px); overflow: auto; }
    .col-wa h3 { margin: 0 0 10px; font-size: 15px; }
    .wa-columnas.apilado { grid-template-columns: 1fr; }
    .wa-columnas.apilado .wa-mensajes { position: static; }
    .wa-fecha-form { align-self: center; font-weight: 700; font-size: 13.5px; }
    @media (max-width: 1100px) { .registro-columnas { grid-template-columns: 1fr; } .col-wa { position: static; max-height: none; } }
    .wa-barra { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .wa-barra .activo-filtro { background: var(--gris-8); color: var(--gris-0); border-color: var(--gris-8); }
    .wa-checks { display: flex; flex-direction: column; gap: 4px; flex: none; } .wa-checks .casilla { font-size: 12.5px; white-space: nowrap; margin: 0; }
    .sur-track { margin: 0; font-size: 13px; }
    .wa-unificar { display: flex; align-items: flex-start; gap: 10px; margin: 10px 0; padding: 8px 12px; font-size: 12.5px; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-0); }
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
  // Viajes cuyo auxiliar se unifica en el mensaje (independiente de los que se reportan)
  readonly waUnificados = signal<Set<string>>(new Set());
  waAlternarUnificado(id: string) {
    const u = new Set(this.waUnificados()); if (u.has(id)) u.delete(id); else u.add(id);
    this.waUnificados.set(u);
    // Unificar un viaje lo incluye en el reporte
    if (u.has(id) && !this.waSeleccion().has(id)) { this.waAlternar(id); return; }
    this.cargarWhatsapp();
  }
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
  // Seguro: el manifiesto se expide normal; queda la alerta para anularlo al día siguiente antes de las 9:00 a. m.
  async marcarSeguro(x: any, marcado: boolean) {
    try {
      const r = await this.api.post<any>(`/viajes/${x._id}/seguro`, { marcado });
      x.seguro = r.seguro.marcado;
      this.waViajes.update(l => [...l]);
      this.avisos.ok(marcado ? `Viaje ${x.numero} marcado como seguro: anule el manifiesto antes de ${textoLimite(r.seguro.limite)}` : `Viaje ${x.numero} ya no es seguro`);
    } catch (e) { this.avisos.error(e); this.waViajes.update(l => [...l]); }
  }
  waAlternarTodos() { this.waSeleccion.set(this.waTodos() ? new Set() : new Set(this.waViajes().map(x => x._id))); this.cargarWhatsapp(); }
  waLimpiar() { this.waSeleccion.set(new Set()); this.cargarWhatsapp(); }
  habilitarRndc = false;
  readonly estados = Object.entries(ESTADOS_VIAJE);
  // Lista por páginas desde el servidor (los filtros se conservan al cambiar de página; al filtrar se vuelve a la primera)
  readonly lista = new ListaServidor<Viaje>({
    pedir: (p) => this.api.get<any>('/viajes', { ...this.filtro, ...p }),
    items: (r) => r.viajes,
    alCargar: (r) => { if (r.sumas) this.sumas.set(r.sumas); },
    alError: (e) => this.avisos.error(e),
    porPagina: POR_PAGINA,
  });
  readonly viajes = this.lista.items;
  // Selección para acciones con varios viajes: se conserva al cambiar filtros, periodo o búsqueda
  readonly elegidos = signal(new Map<string, ViajeElegido>());
  readonly accionesAbierto = signal(false);
  readonly bodegaAbierto = signal(false);
  readonly listaElegidos = computed(() => [...this.elegidos().values()].sort((a, b) => a.numero - b.numero));
  readonly visiblesElegidos = computed(() => !!this.viajes().length && this.viajes().every(v => this.elegidos().has(v._id)));
  readonly algunoVisible = computed(() => this.viajes().some(v => this.elegidos().has(v._id)));
  readonly fueraDeVista = computed(() => { const ids = new Set(this.viajes().map(v => v._id)); return [...this.elegidos().keys()].filter(id => !ids.has(id)).length; });
  private elegido(v: Viaje): ViajeElegido { return { _id: v._id, numero: v.numero, placa: v.placa, fecha: String(v.fecha), destino: v.destino }; }
  elegirViaje(v: Viaje, si: boolean) { this.elegidos.update(m => { const n = new Map(m); if (si) n.set(v._id, this.elegido(v)); else n.delete(v._id); return n; }); }
  elegirVisibles(si: boolean) { this.elegidos.update(m => { const n = new Map(m); for (const v of this.viajes()) { if (si) n.set(v._id, this.elegido(v)); else n.delete(v._id); } return n; }); }
  quitarElegido(id: string) { this.elegidos.update(m => { const n = new Map(m); n.delete(id); if (!n.size) this.accionesAbierto.set(false); return n; }); }
  limpiarSeleccion() { this.elegidos.set(new Map()); }
  trasAccionMasiva(r: { eliminados: string[] }) { for (const id of r.eliminados) this.quitarElegido(id); this.actualizar(); }
  readonly total = this.lista.total;
  readonly sumas = signal({ flete: 0, anticipo: 0, saldo: 0, auxiliar: 0, retefuente: 0, fopat: 0 });
  private autorizacion = inject(AutorizacionAdmin);
  readonly cargando = this.lista.cargando;
  readonly clientes = signal<any[]>([]);
  readonly clientesActivos = computed(() => this.clientes().filter(c => c.activo !== false));
  readonly placas = signal<any[]>([]);
  readonly form = signal<Formulario>(vacio());
  // Destinos y tarifas: solo los del cliente elegido en el formulario, pedidos una vez por cliente (antes se
  // descargaban todas las tarifas de la empresa al abrir la pantalla: unos 300 KB)
  private readonly tarifasPorCliente = signal(new Map<string, any[]>());
  private readonly pidiendoTarifas = new Set<string>();
  readonly tarifasCliente = computed(() => (this.tarifasPorCliente().get(this.form().cliente) || []).filter(t => t.activo !== false));
  private readonly cargarTarifasDelCliente = effect(() => {
    const cliente = this.form().cliente;
    if (cliente) untracked(() => this.tarifasDe(cliente));
  });
  private async tarifasDe(cliente: string, forzar = false) {
    if ((!forzar && this.tarifasPorCliente().has(cliente)) || this.pidiendoTarifas.has(cliente)) return;
    this.pidiendoTarifas.add(cliente);
    try {
      const t = await this.api.get<any[]>('/maestros/tarifas', { cliente });
      this.tarifasPorCliente.update(m => new Map(m).set(cliente, t));
      // Si el destino ya estaba elegido (viaje abierto antes de que llegaran las tarifas), se completan sus datos
      const f = this.form();
      if (f.cliente === cliente && f.tarifaRef && !f.codDestino) this.cambiarDestino(f.tarifaRef);
    } catch (e) { this.avisos.error(e); } finally { this.pidiendoTarifas.delete(cliente); }
  }
  readonly abierto = signal(false);
  readonly guardando = signal(false);
  readonly bloqueado = signal(false);
  readonly numeroEditado = signal(0);
  // Por defecto solo los viajes de HOY (no todo el histórico)
  filtro = { desde: hoyIso(), hasta: hoyIso(), cliente: '', estado: '', q: '' };
  private temporizadorPlacas: ReturnType<typeof setTimeout> | undefined;

  // Cambios de otros usuarios: la pantalla se actualiza sola
  // (se queda en la página que se está viendo; si cambian los maestros se vuelven a pedir las tarifas)
  private enVivo = inject(EnVivo).al(['viajes', 'rndc', 'rastreo', 'liquidaciones', 'gestion', 'maestros'], () => this.actualizar());
  private enVivoTarifas = inject(EnVivo).al(['maestros'], () => {
    this.tarifasPorCliente.set(new Map());
    const cli = this.form().cliente; if (cli) this.tarifasDe(cli, true);
  }, 600, false);

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
      this.clientes.set(await this.api.get<any[]>('/maestros/clientes'));
    } catch (e) { this.avisos.error(e); }
  }

  // Filtros nuevos: primera página
  cargar() { return this.lista.recargar(); }
  // Datos que cambiaron (guardar, eliminar, cambios de otros usuarios): la misma página, al día
  actualizar() { return this.lista.refrescar(); }

  estadoTexto(e: string) { return ESTADOS_VIAJE[e] || e; }
  claseEstado(e: string) { return ({ manifestado: 'marca', cumplido: 'ok', anulado: 'error', remesa: 'alerta' } as Record<string, string>)[e] || ''; }

  nuevo() { this.rastreoSrv.cargar(); this.rastreoForm.set(null); this.viajeRastreo = null; this.rastrear.set(false); this.form.set(vacio()); this.otroRemitente.set(false); this.origenTexto.set(null); this.sedesOtro.set([]); this.bloqueado.set(false); this.registradosTanda.set([]); this.placasConductor.set([]); this.preguntarManifiesto.set(false); this.cargarSiguienteNumero(); this.reporteDelFormulario(this.form().fecha); this.abierto.set(true); }

  // El reporte de la columna derecha es el de la fecha del formulario
  // Valor del auxiliar: auxiliar pagado del destino × días (sin tarifa de auxiliar en el destino, la primera del cliente)
  readonly preguntarManifiesto = signal(false);
  readonly siguienteNumero = signal<number | null>(null);
  private cargarSiguienteNumero() { this.api.get<any>('/viajes/siguiente-numero').then(r => this.siguienteNumero.set(r.numero)).catch(() => {}); }
  valorAuxiliar() {
    const f = this.form(); if (!f.conAuxiliar) return 0;
    const ts = this.tarifasCliente();
    const t = ts.find(x => x._id === f.tarifaRef);
    const unidad = Number(t?.auxiliarPagado) || Number(ts.find(x => Number(x.auxiliarPagado) > 0)?.auxiliarPagado) || 0;
    return unidad * (Number(f.diasAuxiliar) || 1);
  }
  // Auxiliar pagado: si no se ha marcado a mano, el viaje reportado hoy ya está pagado y el registrado después queda pendiente
  auxPagado() { const f = this.form(); return f.auxiliarPagado ?? (f.fecha === hoyIso()); }
  ponerAuxPagado(v: boolean) { this.form.update(f => ({ ...f, auxiliarPagado: !!v })); }
  ponerAuxiliar(dias: number) { this.form.update(f => ({ ...f, conAuxiliar: dias > 0, diasAuxiliar: dias > 0 ? dias : null })); }
  fechaFormulario(fecha: string) { if (fecha && fecha !== this.waFecha) { this.waFecha = fecha; this.cargarWhatsapp(true); } }
  private reporteDelFormulario(fecha: string) { this.waFecha = fecha || hoyIso(); this.cargarPlantillas().then(() => this.cargarWhatsapp(true)); }

  editar(v: Viaje) {
    this.numeroEditado.set(v.numero);
    this.form.set({
      _id: v._id, fecha: isoDia(v.fecha), cliente: v.cliente?._id || '', tarifaRef: v.tarifaRef?._id || v.tarifaRef || '',
      destino: v.destino, codDestino: v.codDestino, codOrigen: (v as any).codOrigen || '',
      remitente: { tipoId: (v as any).remitente?.tipoId || '', numId: (v as any).remitente?.numId || '', sede: (v as any).remitente?.sede || '' },
      placa: v.placa, remolque: v.remolque, conductor: v.conductor?._id || '',
      titular: v.titular?._id || '', pesoKg: v.pesoKg, cantidad: v.cantidad, conAuxiliar: v.conAuxiliar, diasAuxiliar: v.diasAuxiliar || null, planilla: v.planilla || '', tarifa: v.tarifa,
      flete: v.flete, anticipo: v.anticipo, observaciones: v.observaciones, estado: v.estado, historico: !!v.historico,
      requiereManifiesto: v.requiereManifiesto !== false,
      licencia: (v as any).licencia || '', conLicencia: !!(v as any).licencia, numeroManifiesto: (v as any).numerosManuales?.manifiesto || '',
      seguro: !!(v as any).seguro?.marcado, auxiliarPagado: v.conAuxiliar ? !!(v as any).auxiliarPagado : null,
    });
    this.preguntarManifiesto.set(false);
    this.otroRemitente.set(false); this.sedesOtro.set([]); this.origenTexto.set(null);
    const rem = (v as any).remitente;
    if (rem?.numId && digitosTxt(rem.numId) !== idClienteTxt(v.cliente) && digitosTxt(rem.numId) !== digitosTxt((v.cliente as any)?.nit)) this.cargarSedesOtro(digitosTxt(rem.numId));
    this.habilitarRndc = false;
    this.rastreoForm.set((v as any).rastreo || null);
    this.viajeRastreo = v;
    this.bloqueado.set(v.estado !== 'registrado' || !!v.liquidacion);
    if (!this.waAbierto()) this.reporteDelFormulario(isoDia(v.fecha));
    this.abierto.set(true);
  }

  cambiarCliente(_: string) { this.otroRemitente.set(false); this.origenTexto.set(null); this.form.update(f => ({ ...f, tarifaRef: '', destino: '', codDestino: '', codOrigen: '', remitente: { tipoId: '', numId: '', sede: '' }, seguro: false })); }

  // ── Origen / remitente: el predeterminado es la sede remitente del cliente; se puede cambiar por otra sede
  // del cliente (otro municipio de cargue) o por otra empresa (el cliente sigue como propietario de la carga).
  readonly sedesCliente = signal<any[]>([]);
  private numIdSedes = '';
  private turnoSedesCliente = 0;
  private readonly clienteIdForm = computed(() => this.form().cliente);
  private sedesDelCliente = effect(() => {
    const id = this.clienteIdForm();
    const c = this.clientes().find(x => x._id === id);
    untracked(() => this.cargarSedesCliente(c));
  });
  private async cargarSedesCliente(c: any) {
    const turno = ++this.turnoSedesCliente;
    this.sedesCliente.set([]); this.numIdSedes = '';
    const nit = digitosTxt(c?.nit);
    if (!nit) return;
    for (const numId of [...new Set([idClienteTxt(c), nit])]) {
      try {
        const l = (await this.api.get<any>('/maestros/terceros/sedes', { numId })).sedes.filter((x: any) => x.sede?.codigo);
        if (turno !== this.turnoSedesCliente) return;
        if (l.length) { this.sedesCliente.set(ordenarSedesTxt(l)); this.numIdSedes = numId; return; }
      } catch { /* sin sedes */ }
    }
  }
  readonly clienteSel = computed(() => this.clientes().find(x => x._id === this.form().cliente) || null);
  nombreCliente() { return this.clienteSel()?.nombre || 'El cliente'; }
  readonly sedeFicha = computed(() => this.sedesCliente().find(x => String(x.sede.codigo) === String(this.clienteSel()?.sedeRemitente || '')) || null);
  readonly otroRemitente = signal(false);
  readonly valorOrigen = computed(() => {
    const f = this.form(); const r = f.remitente;
    const delCliente = (numId: string) => { const n = digitosTxt(numId); const c = this.clienteSel(); return !!c && (n === idClienteTxt(c) || n === digitosTxt(c.nit)); };
    if (r?.numId) return delCliente(r.numId) ? (String(r.sede) === String(this.sedeFicha()?.sede?.codigo ?? '') ? '' : 'c:' + r.sede) : 'otro';
    if (this.otroRemitente()) return 'otro';
    // Viaje con origen escrito (sin remitente): la sede del cliente en ese municipio
    const o = String(f.codOrigen || '');
    if (/^\d{8}$/.test(o)) {
      const ficha = this.sedeFicha();
      if (ficha && String(ficha.codMunicipio || '').slice(0, 5) === o.slice(0, 5)) return '';
      const s = this.sedesCliente().find(x => x.codMunicipio === o) || this.sedesCliente().find(x => String(x.codMunicipio || '').slice(0, 5) === o.slice(0, 5));
      if (s) return 'c:' + s.sede.codigo;
    }
    return '';
  });
  // Campo de texto con búsqueda: cada opción es una sede del cliente (la de la ficha es la predeterminada) u «otro remitente»
  readonly opcionesOrigen = computed(() => {
    const ficha = this.sedeFicha();
    return [
      { valor: '', texto: 'Predeterminado' + (ficha ? `: Sede ${ficha.sede.codigo} · ${ficha.sede.nombre || ''}` : ''), sede: ficha },
      ...this.sedesCliente().filter(x => x.sede.codigo !== ficha?.sede?.codigo).map(x => ({ valor: 'c:' + x.sede.codigo, texto: `Sede ${x.sede.codigo} · ${x.sede.nombre || ''}`, sede: x })),
      { valor: 'otro', texto: 'Otro remitente (otra empresa)', sede: null },
    ];
  });
  readonly textoOrigen = computed(() => this.opcionesOrigen().find(o => o.valor === this.valorOrigen())?.texto || '');
  // Lo que se va escribiendo (null = se muestra la opción elegida)
  readonly origenTexto = signal<string | null>(null);
  private buscarOpcionOrigen(texto: string, exacta: boolean) {
    const n = (x: string) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const q = n(texto);
    if (!q) return null;
    const ops = this.opcionesOrigen();
    const igual = ops.find(o => n(o.texto) === q || (o.sede && (n(o.sede.sede?.nombre) === q || String(o.sede.sede?.codigo) === q)));
    if (igual || exacta) return igual || null;
    const parecidas = ops.filter(o => n(o.texto).includes(q));
    return parecidas.length === 1 ? parecidas[0] : null;
  }
  escribirOrigen(texto: string) {
    const o = this.buscarOpcionOrigen(texto, true);
    if (o && n2(texto) === n2(o.texto)) { this.origenTexto.set(null); this.elegirOrigen(o.valor); return; }
    this.origenTexto.set(texto);
  }
  // Al salir del campo: lo escrito que coincide con una sola opción se toma; vacío = predeterminado; si no, queda lo anterior
  cerrarOrigen() {
    const t = this.origenTexto();
    if (t === null) return;
    this.origenTexto.set(null);
    if (!t.trim()) { this.elegirOrigen(''); return; }
    const o = this.buscarOpcionOrigen(t, false);
    if (o) this.elegirOrigen(o.valor);
  }
  // Enter en Origen no guarda el viaje: toma la opción y sigue en Destino
  irADestino() { setTimeout(() => document.getElementById(this.valorOrigen() === 'otro' ? 'v-rem-num' : 'v-dest')?.focus(), 30); }
  elegirOrigen(valor: string) {
    const vacioRem = { tipoId: '', numId: '', sede: '' };
    if (valor === 'otro') { this.otroRemitente.set(true); this.sedesOtro.set([]); this.form.update(f => ({ ...f, codOrigen: '', remitente: { tipoId: 'N', numId: '', sede: '' } })); return; }
    this.otroRemitente.set(false);
    const s = valor.startsWith('c:') ? this.sedesCliente().find(x => String(x.sede.codigo) === valor.slice(2)) : null;
    if (!s) { this.form.update(f => ({ ...f, codOrigen: '', remitente: vacioRem })); return; }
    this.form.update(f => ({ ...f, codOrigen: s.codMunicipio || '', remitente: { tipoId: s.tipoId || this.clienteSel()?.tipoId || 'N', numId: s.numId || this.numIdSedes, sede: String(s.sede.codigo) } }));
  }
  readonly sedesOtro = signal<any[]>([]);
  readonly nombreOtro = computed(() => { const t = this.sedesOtro()[0]; return t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : ''; });
  async buscarRemitente(texto: string) {
    const numId = digitosTxt(texto);
    this.form.update(f => ({ ...f, codOrigen: '', remitente: { tipoId: 'N', numId, sede: '' } }));
    this.sedesOtro.set([]);
    if (numId.length < 5) return;
    const l = await this.cargarSedesOtro(numId);
    if (l[0]) this.form.update(f => ({ ...f, remitente: { ...f.remitente!, tipoId: l[0].tipoId || 'N' } }));
    if (l.length === 1) this.elegirSedeOtro(String(l[0].sede.codigo));
  }
  private async cargarSedesOtro(numId: string): Promise<any[]> {
    try {
      const l = ordenarSedesTxt((await this.api.get<any>('/maestros/terceros/sedes', { numId })).sedes.filter((x: any) => x.sede?.codigo));
      if (digitosTxt(this.form().remitente?.numId) !== numId) return [];
      this.sedesOtro.set(l);
      return l;
    } catch { return []; }
  }
  elegirSedeOtro(sede: string) {
    const s = this.sedesOtro().find(x => String(x.sede.codigo) === String(sede));
    this.form.update(f => ({ ...f, codOrigen: s?.codMunicipio || '', remitente: { ...f.remitente!, sede: sede || '' } }));
  }
  // La casilla «Seguro» solo aparece con clientes que manejan seguros (Clientes y tarifas → Maneja seguros)
  clienteConSeguros() { const id = this.form().cliente; return !!id && !!this.clientes().find(c => c._id === id && (c as any).seguros); }
  // Guarda la marca de seguro si cambió (el viaje ya debe existir)
  private async guardarSeguro(id: string, numero: number | undefined, antes: boolean, ahora: boolean) {
    if (antes === ahora) return;
    try {
      const r = await this.api.post<any>(`/viajes/${id}/seguro`, { marcado: ahora });
      if (ahora) this.avisos.mostrar(`Viaje N° ${numero} marcado como seguro: anule el manifiesto antes de ${textoLimite(r.seguro.limite)}`, 'info', 9000);
    } catch (e) { this.avisos.error(e); }
  }

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
    const t = this.tarifasCliente().find(x => x._id === id);
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
    const lic = t?.licencia?.numero ? [t.licencia.categoria, t.licencia.numero].filter(Boolean).join('-') : '';
    if (lic) this.form.update(f => ({ ...f, licencia: lic }));
    const placas: string[] = t?.placas || [];
    this.placasConductor.set(placas);
    // Con Enter sobre el conductor se sigue en el destino (sin empresa elegida, en la empresa)
    setTimeout(() => document.getElementById(this.form().cliente ? 'v-dest' : 'v-cli')?.focus(), 30);
    if (!placas.length) return;
    // La primera es la placa principal del conductor (si la tiene)
    this.form.update(f => ({ ...f, placa: placas[0], remolque: f.remolque || t.remolque || '' }));
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
  cerrarFormulario() { this.abierto.set(false); if (this.registradosTanda().length) this.actualizar(); this.registradosTanda.set([]); }

  // Al crear, la respuesta «¿Requiere manifiesto?» (Sí / No) define cómo se guarda el viaje.
  async guardar(requiere?: boolean) {
    const f = this.form();
    if (!f._id && requiere === undefined) { this.avisos.mostrar('Elija «Sí, guardar» o «No, guardar» según si el viaje requiere manifiesto', 'info'); return; }
    if (!f._id) f.requiereManifiesto = !!requiere;
    if (!f.conductor && !this.bloqueado()) { this.avisos.mostrar('Seleccione el conductor', 'error'); return; }
    const cuerpo: any = { ...f, placa: f.placa.toUpperCase(), remolque: (f.remolque || '').toUpperCase(), tarifaRef: f.tarifaRef || null,
      licencia: f.conLicencia ? (f.licencia || '').trim() : '', numeroManifiesto: (f.numeroManifiesto || '').trim().toUpperCase() };
    delete cuerpo.conLicencia; delete cuerpo.seguro;
    cuerpo.auxiliarPagado = f.conAuxiliar ? this.auxPagado() : null;
    delete cuerpo._id; delete cuerpo.estado; delete cuerpo.titular;
    if (!cuerpo.numeroManifiesto && !f._id) delete cuerpo.numeroManifiesto;
    for (const k of ['pesoKg', 'cantidad', 'diasAuxiliar', 'tarifa', 'flete', 'anticipo']) if (cuerpo[k] === null || cuerpo[k] === '') delete cuerpo[k];
    delete cuerpo.historico;
    if (this.bloqueado()) {
      for (const k of Object.keys(cuerpo)) if (!['observaciones', 'cantidad', 'conAuxiliar', 'diasAuxiliar', 'auxiliarPagado', 'planilla', 'tarifa', 'licencia'].includes(k)) delete cuerpo[k];
    }
    if (f.historico && this.habilitarRndc) cuerpo.historico = false;
    this.guardando.set(true);
    try {
      if (f._id) {
        // Al editar, el viaje se actualiza y la ventana sigue abierta (se cierra con «Cerrar»)
        const r = await this.api.put<any>(`/viajes/${f._id}`, cuerpo);
        this.avisos.ok(`Viaje N° ${this.numeroEditado()} actualizado`);
        if ((this.viajeRastreo as any)?.reporteWhatsapp?.fecha && !r.reporteWhatsapp?.fecha) this.avisos.mostrar('El viaje vuelve a quedar por reportar: sale en el mensaje de WhatsApp del cliente corregido.', 'info', 9000);
        if (this.viajeRastreo) (this.viajeRastreo as any).reporteWhatsapp = r.reporteWhatsapp;
        const antesSeguro = !!(this.viajeRastreo as any)?.seguro?.marcado;
        await this.guardarSeguro(f._id, this.numeroEditado(), antesSeguro, !!f.seguro && this.clienteConSeguros());
        if (this.viajeRastreo) (this.viajeRastreo as any).seguro = { marcado: !!f.seguro && this.clienteConSeguros() };
        this.cargarWhatsapp();
        this.registradosTanda.update(l => l.length ? l : [{ numero: this.numeroEditado(), placa: f.placa, sinManifiesto: f.requiereManifiesto === false }]);
        return;
      }
      else {
        let v: Viaje | null = null;
        let autorizacion: any = null;
        for (let intento = 0; intento < 3 && !v; intento++) {
          try { v = await this.api.post<Viaje>('/viajes', autorizacion ? { ...cuerpo, autorizacion } : cuerpo); }
          catch (e) {
            // La placa ya tiene viaje ese día: se confirma para no registrar (ni cobrar) dos veces el mismo viaje
            if (e instanceof HttpErrorResponse && e.status === 428 && !cuerpo.confirmarRepetido) {
              const det = Array.isArray(e.error?.detalles) ? `\n\n${e.error.detalles.join('\n')}` : '';
              if (!confirm(`${e.error?.error || 'La placa ya tiene viaje ese día.'}${det}\n\n¿Es otro viaje distinto y lo registra de todas formas?`)) return;
              cuerpo.confirmarRepetido = true;
              continue;
            }
            // Documentos vencidos: solo con la autorización del administrador (CA-06)
            const vencidos = AutorizacionAdmin.vencidosDe(e);
            if (!vencidos || autorizacion) throw e;
            autorizacion = await this.autorizacion.pedir(vencidos);
            if (!autorizacion) return;
          }
        }
        if (!v) return;
        if (autorizacion) this.avisos.ok('Viaje autorizado por el administrador');
        this.avisos.ok(`Viaje N° ${v.numero} registrado${requiere ? '' : ' (sin manifiesto)'}`);
        if (f.seguro && this.clienteConSeguros()) await this.guardarSeguro(v._id, v.numero, false, true);
        const avisosDoc: string[] = (v as any).avisosDocumentos || [];
        if (avisosDoc.length) this.avisos.mostrar(`Por vencer: ${avisosDoc.join('; ')}`, 'info');
        // «Rastrear este viaje»: se abre el asistente para elegir destino o clientes
        if (this.rastreoHabilitado() && this.rastrear()) { this.viajeRastreo = v; setTimeout(() => this.activador().abrir(v), 0); }
        this.documentos.set(null);
        // El viaje queda elegido en el reporte de WhatsApp de la columna derecha
        this.waSeleccion.update(sel => new Set([...sel, v._id]));
        this.cargarWhatsapp();
        if (!this.seguirRegistrando()) {
          // La ventana sigue abierta con el reporte; el formulario queda vacío para el siguiente viaje de la fecha
          this.registradosTanda.update(l => [...l, { numero: v.numero, placa: v.placa, sinManifiesto: !requiere }]);
          this.form.set({ ...vacio(), fecha: f.fecha });
          this.placasConductor.set([]); this.rastrear.set(false); this.preguntarManifiesto.set(false); this.cargarSiguienteNumero();
          this.enfocarConductor();
          return;
        }
        if (this.seguirRegistrando()) {
          // Listo para el siguiente: mismo cliente, destino, fecha y valores; vehículo y conductor nuevos
          this.registradosTanda.update(l => [...l, { numero: v.numero, placa: v.placa, sinManifiesto: !requiere }]);
          // El destino (y sus valores) cambian en cada viaje: se dejan vacíos
          this.form.set({ ...f, tarifaRef: '', destino: '', codDestino: '', tarifa: null, flete: null, anticipo: null, pesoKg: null, cantidad: 1,
            conAuxiliar: false, diasAuxiliar: null, planilla: '', placa: '', remolque: '', conductor: '', titular: '', observaciones: '', requiereManifiesto: true, seguro: false });
          this.placasConductor.set([]); this.preguntarManifiesto.set(false); this.cargarSiguienteNumero();
          this.enfocarConductor();
          return;
        }
      }
      this.abierto.set(false);
      this.registradosTanda.set([]);
      this.actualizar();
    } catch (e) { this.avisos.error(e); } finally { this.guardando.set(false); }
  }

  // Después de guardar se sigue con el conductor del próximo viaje
  private enfocarConductor() { setTimeout(() => document.querySelector<HTMLInputElement>('#v-cond input')?.focus(), 50); }

  async eliminar() {
    try {
      await this.api.delete(`/viajes/${this.form()._id}`);
      this.avisos.ok('Viaje eliminado');
      this.abierto.set(false);
      this.actualizar();
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
  private turnoWa = new Turno();
  async cargarWhatsapp(reiniciar = false) {
    const vigente = this.turnoWa.tomar();
    if (reiniciar) { this.waSeleccion.set(new Set()); this.waUnificados.set(new Set()); }
    try {
      const r = await this.api.get<{ mensajes: any[]; viajes: any[] }>('/viajes/reporte-whatsapp', { fecha: this.waFecha, incluirReportados: this.waIncluir ? 1 : 0,
        plantilla: this.waPlantilla, seleccion: 1, viajes: [...this.waSeleccion()].join(','), unificar: [...this.waUnificados()].join(',') });
      if (!vigente()) return;
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
      this.cargarWhatsapp(); this.actualizar();
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
  rastreoListo(r: any) { this.rastreoForm.set(r); this.actualizar(); }
  async terminarRastreo() {
    try { this.rastreoForm.set(await this.rastreoSrv.finalizar(this.form()._id!)); this.avisos.ok('Rastreo terminado'); this.actualizar(); }
    catch (e) { this.avisos.error(e); }
  }

  // Excel y PDF: general, por empresa o por placa, con el periodo a elegir
  readonly exportador = viewChild.required(ExportarViajes);
  descargar() { this.exportador().abrir({ cliente: this.filtro.cliente }); }

}
