import { Component, computed, inject, input, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { Viaje } from '../core/modelos';
import { Moneda } from '../shared/moneda';
import { CargarMas } from '../shared/cargar-mas';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { FORMATOS, hoyIso, isoDia } from '../shared/formato';
import { ExpedirRndc } from '../shared/expedir-rndc';
import { Confirmar } from '../shared/confirmar';
import { filtrar } from '../shared/filtro';
import { SelectorMunicipio } from '../shared/municipio';
import { BuscarTercero } from '../shared/buscar-tercero';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { leerArchivos } from '../shared/adjuntos';

type Pestana = 'pendientes' | 'anulados' | 'manifestados' | 'cumplidos' | 'soporte' | 'correos' | 'historial';
type PestanaViajes = 'pendientes' | 'anulados' | 'manifestados' | 'cumplidos' | 'soporte';
// Filtro de cada pestaña. Con remesa o manifiesto anulados el viaje sale de «Por enviar» y queda en «Anulados».
const FILTROS: Record<PestanaViajes, Record<string, string | number>> = {
  pendientes: { estado: 'registrado,remesa', anulados: 0 }, anulados: { estado: 'registrado,remesa', anulados: 1 },
  manifestados: { estado: 'manifestado' }, cumplidos: { estado: 'cumplido' },
  soporte: { soporte: 1 },
};
const ESTADO_CORREO: Record<string, [string, string]> = {
  enviado: ['Enviado', 'ok'], error: ['Error', 'error'], pendiente: ['Pendiente', 'alerta'], enviando: ['Enviando', 'alerta'],
  por_aprobar: ['Por aprobar', 'alerta'], descartado: ['Descartado', ''],
};

@Component({
  selector: 'app-manifiestos',
  imports: [FormsModule, Modal, Icono, Moneda, CargarMas, ExpedirRndc, SelectorMunicipio, BuscarTercero, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>{{ titulo() }}</h1><p class="sutil">{{ descripcion() }}</p></div>
      <div class="acciones">
        @if (pestana() === 'pendientes' && seleccion().size) {
          <button (click)="enviarLote()" [disabled]="trabajando()"><app-icono nombre="enviar" />Enviar {{ seleccion().size }} seleccionado(s)</button>
        }
        @if (pestana() === 'manifestados' && seleccion().size) {
          <button type="button" class="peligro" (click)="abrirAnularLote()" [disabled]="trabajando()">Anular ({{ seleccion().size }})</button>
          <button type="button" class="primario" (click)="abrirCumplidoLote()" [disabled]="trabajando()">Cumplir ({{ seleccion().size }})</button>
          <button type="button" (click)="abrirCorreoManual()" [disabled]="trabajando()" title="Correo armado a mano con los manifiestos elegidos y archivos adjuntos">
            <app-icono nombre="correo" />Correo con estos manifiestos</button>
          @if (conCorreo()) {
            <button type="button" confirmar="Clic otra vez para descartar" (confirmado)="descartarCorreos([...seleccion()])" [disabled]="trabajando()">Descartar correos</button>
            <button type="button" confirmar="Clic otra vez para enviar" (confirmado)="aprobarCorreos([...seleccion()])" [disabled]="trabajando()">
              <app-icono nombre="correo" />Aprobar correos ({{ seleccion().size }})</button>
          }
        }
        @if (pestana() === 'soporte' && seleccion().size) {
          <button type="button" (click)="abrirCorreoManual(true)" [disabled]="trabajando()" title="Correo con los soportes internos elegidos y archivos adjuntos">
            <app-icono nombre="correo" />Correo con {{ seleccion().size }} soporte(s)</button>
        }
        @if (puedeCrear && !vista()) { <button class="primario" (click)="nuevoManifiesto()"><app-icono nombre="mas" />Nuevo manifiesto</button> }
      </div>
    </div>

    @if (ambiente() && ambiente() !== 'PRODUCCION') {
      <div class="mensaje alerta" style="margin-bottom:14px">
        Ambiente RNDC: <strong>{{ ambiente() === 'SIMULADO' ? 'simulador local' : 'pruebas del Ministerio' }}</strong>.
        Los documentos expedidos aquí no tienen validez legal. El administrador lo cambia en Configuración.
      </div>
    }

    @if (!vista()) {
    <div class="pestanas">
      <button [class.activa]="pestana() === 'pendientes'" (click)="ir('pendientes')">Por enviar</button>
      <button [class.activa]="pestana() === 'manifestados'" (click)="ir('manifestados')">Manifestados</button>
      <button [class.activa]="pestana() === 'cumplidos'" (click)="ir('cumplidos')">Cumplidos</button>
      <button [class.activa]="pestana() === 'anulados'" (click)="ir('anulados')" title="Viajes con la remesa o el manifiesto anulados en el RNDC">Anulados</button>
      <button [class.activa]="pestana() === 'soporte'" (click)="ir('soporte')" title="Viajes que no van al RNDC: soporte interno MC/RC">Soporte interno</button>
    </div>
    }
    <section class="barra" aria-label="Filtros">
      @if (pestana() !== 'correos' && pestana() !== 'historial') {
        <div class="campo"><label for="m-desde">Desde</label><input id="m-desde" type="date" [(ngModel)]="filtro.desde" (change)="cargar()" /></div>
        <div class="campo"><label for="m-hasta">Hasta</label><input id="m-hasta" type="date" [(ngModel)]="filtro.hasta" (change)="cargar()" /></div>
        <div class="campo"><label for="m-cli">Cliente</label>
          <select id="m-cli" [(ngModel)]="filtro.cliente" (change)="cargar()"><option value="">Todos</option>
            @for (c of clientesFiltro(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
        <div class="campo crece"><label for="m-q">Buscar</label>
          <input id="m-q" type="search" placeholder="Placa, destino, remesa o manifiesto (Enter)" [(ngModel)]="filtro.q" (keyup.enter)="cargar()" (search)="cargar()" /></div>
        @if (filtro.desde || filtro.hasta || filtro.cliente || filtro.q) { <button type="button" class="pequeno texto" (click)="limpiarFiltros()">Quitar filtros</button> }
      } @else {
        @if (pestana() === 'historial') {
          <div class="campo"><label for="m-res">Resultado</label>
            <select id="m-res" [ngModel]="resultadoHist()" (ngModelChange)="resultadoHist.set($event)">
              <option value="">Todos</option><option value="ok">Aceptados</option><option value="error">Rechazados</option></select></div>
        }
        <div class="campo crece"><label for="m-t">Buscar</label>
          <input id="m-t" type="search" [placeholder]="pestana() === 'correos' ? 'Manifiesto, destinatario, estado o error' : 'Referencia, proceso, usuario o mensaje'"
            [ngModel]="texto()" (ngModelChange)="texto.set($event)" /></div>
      }
    </section>

    @if (resultadoLote(); as rl) {
      <div class="mensaje resultado-lote" [class.ok]="!rl.fallos.length" [class.error]="rl.fallos.length">
        <div><strong>{{ rl.titulo }}: {{ rl.aceptados }} de {{ rl.total }} aceptados por el RNDC.</strong>
          @if (rl.fallos.length) { <ul>@for (f of rl.fallos; track f.viaje) { <li>Viaje N° {{ f.numero }}: {{ f.mensaje }}</li> }</ul> }</div>
        <button type="button" class="pequeno texto" (click)="resultadoLote.set(null)" aria-label="Cerrar resultado">Cerrar</button>
      </div>
    }
    @if (pestana() === 'manifestados' && porAprobar().length) {
      <div class="mensaje alerta pendientes-correo">
        <span><strong>{{ porAprobar().length }} viaje(s) con correos por aprobar.</strong>
          Los correos al cliente no salen solos: revíselos y apruébelos (un correo por cliente con sus manifiestos y la carta de salida de cada vehículo).</span>
        <button type="button" class="primario pequeno" confirmar="Clic otra vez para enviar" (confirmado)="aprobarCorreos(porAprobar())" [disabled]="trabajando()">
          <app-icono nombre="correo" [tam]="15" />Aprobar todos</button>
      </div>
    }
    @if (pestana() === 'soporte') {
      <div class="filtros soporte-filtros">
        <p class="sutil">Viajes que no van al RNDC. Cada uno lleva su soporte interno (MC/RC) con un código QR que cualquiera puede escanear para comprobar que es válido. Se cumplen, se anulan y se envían por correo igual que los manifiestos.</p>
        <div class="segmentos">
          @for (e of estadosSoporte; track e[0]) {
            <button type="button" [class.activo]="soporteEstado() === e[0]" (click)="soporteEstado.set(e[0]); cargar()">{{ e[1] }}</button>
          }
        </div>
      </div>
    }
    @if (pestana() === 'anulados') {
      <p class="sutil" style="margin:-6px 0 12px">Viajes con la remesa o el manifiesto anulados. Si el manifiesto se anuló para reemplazarlo, expida aquí el nuevo.</p>
    }

    @if (pestana() === 'correos') {
      @if (pendientesCorreo() > 0) {
        <div class="mensaje info pendientes-correo">
          <span><strong>{{ pendientesCorreo() }} manifiesto(s) esperando para enviarse agrupados.</strong>
            Cada cliente recibe un solo correo con todos sus manifiestos, unos minutos después del último que se expida.</span>
          <button type="button" class="primario pequeno" (click)="enviarPendientes()" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="15" />Enviar ahora</button>
        </div>
      }
      <div class="filtros">
        <div class="segmentos">
          @for (e of [['', 'Todos'], ['por_aprobar', 'Por aprobar'], ['error', 'Con error'], ['enviado', 'Enviados'], ['pendiente', 'Pendientes'], ['descartado', 'Descartados']]; track e[0]) {
            <button type="button" [class.activo]="filtroCorreo() === e[0]" (click)="filtroCorreo.set(e[0]); cargar()">{{ e[1] }}</button>
          }
        </div>
      </div>
      <div class="tabla-caja"><table>
        <thead><tr><th>Fecha</th><th>Manifiesto</th><th>Documento</th><th>Destinatarios</th><th>Estado</th><th>Intentos</th><th></th></tr></thead>
        <tbody>@for (e of enviosVisibles(); track e._id) {
          <tr><td data-etiqueta="Fecha">{{ e.createdAt | fechaHora }}</td><td data-etiqueta="Manifiesto">{{ e.documento }}</td>
            <td data-etiqueta="Documento">{{ e.tipo === 'salida' ? 'Carta de salida' : 'Manifiesto PDF' }}<br /><span class="sutil">{{ e.origen === 'manual' ? 'Manual' : 'Automático' }}{{ e.usuario?.nombre ? ' · ' + e.usuario.nombre : '' }}</span></td>
            <td class="destinos">
              @if (e.destinatarios.length + (e.cc?.length || 0) <= 2) { <span class="sutil">{{ listaDestinos(e) }}</span> }
              @else {
                <details><summary>{{ e.destinatarios.length }} destinatario(s){{ e.cc?.length ? ' + ' + e.cc.length + ' CC' : '' }}</summary>
                  <ul>@for (d of e.destinatarios; track d) { <li>{{ d }}</li> }@for (d of e.cc || []; track d) { <li>CC: {{ d }}</li> }</ul></details>
              }
            </td>
            <td><span class="chip" [class]="claseCorreo(e.estado)">{{ textoCorreo(e.estado) }}</span>
              @if (e.enviadoEn) { <br /><span class="sutil">{{ e.enviadoEn | fechaHora }}</span> }
              @if (e.error) { <div class="error-correo">{{ e.error }}</div> }</td>
            <td class="num">{{ e.intentos }}</td>
            <td>@if (e.estado === 'error') { <button class="pequeno" (click)="reintentar(e)" [disabled]="trabajando()">Reintentar</button> }</td></tr>
        } @empty { <tr><td colspan="7" class="vacio">Sin correos registrados</td></tr> }</tbody>
      </table></div>
    } @else if (pestana() !== 'historial') {
      <div class="tabla-caja">
        <table class="tabla-movil">
          <thead><tr>
            @if (conSeleccion()) { <th><input type="checkbox" aria-label="Seleccionar todos" [checked]="todos()" (change)="alternarTodos()" /></th> }
            <th>N°</th><th>Fecha</th><th>Cliente / destino</th><th>Placa</th><th>Conductor</th><th class="num">Flete</th>
            <th>Remesa</th><th>Manifiesto</th>@if (conCorreo()) { <th>Correo</th> }<th></th></tr></thead>
          <tbody>
            @for (v of viajes(); track v._id) {
              <tr>
                @if (conSeleccion()) { <td data-etiqueta="Elegir"><input type="checkbox" [attr.aria-label]="'Seleccionar viaje ' + v.numero" [checked]="seleccion().has(v._id)" (change)="alternar(v._id)" /></td> }
                <td data-etiqueta="N°">{{ v.numero }}</td><td data-etiqueta="Fecha">{{ v.fecha | dia }}</td>
                <td data-etiqueta="Cliente">{{ v.cliente?.nombre }}<br /><span class="sutil">{{ v.destino }}</span></td>
                <td data-etiqueta="Placa"><strong>{{ v.placa }}</strong></td><td data-etiqueta="Conductor">{{ v.conductorNombre }}</td><td data-etiqueta="Flete" class="num">{{ v.flete | pesos }}</td>
                @if (pestana() === 'soporte') {
                <td data-etiqueta="Remesa">@if ($any(v).soporteInterno?.rc) { {{ $any(v).soporteInterno.rc }}<br /><span class="chip ok sin-punto">interna</span> } @else { <span class="chip alerta sin-punto">sin soporte</span> }</td>
                <td data-etiqueta="Manifiesto">@if ($any(v).soporteInterno?.mc) { {{ $any(v).soporteInterno.mc }}<br /><span class="chip" [class]="chipSoporte($any(v))">{{ textoSoporte($any(v)) }}</span>
                  @if ($any(v).soporteInterno.estado === 'anulado' && $any(v).soporteInterno.anulado?.motivo) { <br /><span class="sutil" [title]="$any(v).soporteInterno.anulado.motivo">{{ $any(v).soporteInterno.anulado.motivo }}</span> }
                  @else { <br /><span class="sutil">Cód. {{ $any(v).soporteInterno.codigo }}</span> } }</td>
                } @else {
                <td data-etiqueta="Remesa">@if (v.remesa.numero) { {{ v.remesa.numero }}<br /><span class="chip" [class]="chip(v.remesa.estado)">{{ v.remesa.estado || 'sin enviar' }}</span> }</td>
                <td data-etiqueta="Manifiesto">@if (v.manifiesto.numero) { {{ v.manifiesto.numero }}<br /><span class="chip" [class]="chip(v.manifiesto.estado)">{{ v.manifiesto.estado || 'sin enviar' }}</span> }
                  @if (v.manifiesto.radicado && v.manifiesto.estado === 'aceptado') { <br /><span class="sutil">Rad. {{ v.manifiesto.radicado }}</span> }</td>
                }
                @if (conCorreo()) {
                  <td data-etiqueta="Correo">@if (resumenCorreo(v._id); as rc) { <button type="button" class="chip-boton" (click)="verCorreos(v)" [title]="rc.titulo"><span class="chip" [class]="rc.clase">{{ rc.texto }}</span></button> }
                    @else { <button type="button" class="pequeno texto" (click)="verCorreos(v)">Sin envío</button> }</td>
                }
                <td class="celda-acciones">
                  <div class="acciones" style="justify-content:flex-end">
                    @switch (pestana()) {
                      @case ('anulados') {
                        <button class="pequeno" (click)="ver(v._id)" title="Ver la remesa y el manifiesto por pestañas, sin enviar"><app-icono nombre="ojo" [tam]="15" />Ver</button>
                        <button class="pequeno primario" (click)="abrirExpedir(v._id)" [disabled]="trabajando()">
                          <app-icono nombre="enviar" [tam]="15" />{{ v.manifiesto.estado === 'anulado' ? 'Expedir reemplazo' : 'Expedir de nuevo' }}</button>
                        @if (v.remesa.estado === 'aceptado' && v.manifiesto.estado !== 'aceptado') {
                          <button class="pequeno peligro" (click)="abrirAnular(v)" title="La remesa sigue vigente en el RNDC">Anular remesa</button>
                        }
                      }
                      @case ('pendientes') {
                        <button class="pequeno" (click)="ver(v._id)" title="Ver la remesa y el manifiesto por pestañas, sin enviar"><app-icono nombre="ojo" [tam]="15" />Ver</button>
                        <button class="pequeno primario" (click)="abrirExpedir(v._id)" [disabled]="trabajando()">
                          <app-icono nombre="enviar" [tam]="15" />{{ mensajeError(v) ? 'Corregir y reenviar' : 'Expedir' }}</button>
                        @if (v.estado === 'remesa') { <button class="pequeno peligro" (click)="abrirAnular(v)" title="Anular la remesa aceptada">Anular remesa</button> }
                      }
                      @case ('manifestados') {
                        <!-- «Aprobar correo» va encima, ocupando el ancho de los otros tres botones -->
                        <div class="pila-acciones">
                          @if (tienePorAprobar(v._id)) {
                            <button class="pequeno primario" confirmar="Clic otra vez para enviar" (confirmado)="aprobarCorreos([v._id])" [disabled]="trabajando()"
                              title="Envía al cliente el manifiesto y la carta de salida de este viaje"><app-icono nombre="correo" [tam]="15" />Aprobar correo</button>
                          }
                          <div class="fila-acciones">
                            <button class="pequeno" (click)="verPdf(v)" title="Ver el manifiesto en pantalla"><app-icono nombre="ojo" [tam]="15" />Ver PDF</button>
                            <button class="pequeno primario" (click)="abrirCumplido(v)">Cumplir</button>
                            <button class="pequeno peligro" (click)="abrirAnular(v)">Anular</button>
                          </div>
                        </div>
                      }
                      @case ('soporte') {
                        @let si = $any(v).soporteInterno;
                        @if (!si?.mc) {
                          <button class="pequeno primario" (click)="verSoporte(v)" [disabled]="trabajando()" title="Numera el MC/RC y muestra el soporte"><app-icono nombre="documento" [tam]="15" />Generar soporte</button>
                        } @else if (si.estado === 'anulado') {
                          <button class="pequeno" (click)="verSoporte(v)" title="Ver el soporte anulado"><app-icono nombre="ojo" [tam]="15" />Ver</button>
                          <button class="pequeno primario" confirmar="Clic otra vez: se numera un MC/RC nuevo" (confirmado)="reemplazarSoporte(v)" [disabled]="trabajando()">Generar nuevo</button>
                        } @else {
                          <div class="pila-acciones">
                            <div class="fila-acciones">
                              <button class="pequeno" (click)="verSoporte(v)" title="Ver el soporte en pantalla"><app-icono nombre="ojo" [tam]="15" />Ver</button>
                              <button class="pequeno" (click)="correoSoporte(v)" title="Enviar el soporte por correo"><app-icono nombre="correo" [tam]="15" />Correo</button>
                            </div>
                            <div class="fila-acciones">
                              @if (si.estado === 'cumplido') {
                                <button class="pequeno peligro" (click)="abrirAnularSoporte(v, true)">Anular cumplido</button>
                              } @else {
                                <button class="pequeno primario" (click)="abrirCumplirSoporte(v)">Cumplir</button>
                                <button class="pequeno peligro" (click)="abrirAnularSoporte(v, false)">Anular</button>
                              }
                            </div>
                          </div>
                        }
                      }
                      @case ('cumplidos') {
                        <button class="pequeno" (click)="verPdf(v)" title="Ver el manifiesto en pantalla"><app-icono nombre="ojo" [tam]="15" />Ver PDF</button>
                        <button class="pequeno peligro" (click)="abrirAnular(v)">Anular cumplido</button>
                      }
                    }
                  </div>
                </td>
              </tr>
              @if (mensajeError(v); as m) {
                <tr><td [attr.colspan]="pestana() === 'pendientes' ? 10 : 9" style="padding-top:0"><div class="mensaje error">Respuesta del RNDC · {{ m }}</div></td></tr>
              }
            } @empty {
              @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="10"><span class="esqueleto"></span></td></tr> } }
              @else { <tr><td colspan="10" class="vacio"><strong>Nada pendiente en esta lista</strong>Los viajes aparecen aquí según su estado en el RNDC.</td></tr> }
            }
          </tbody>
        </table>
        @if (viajes().length) { <app-cargar-mas [mostrados]="viajes().length" [total]="total()" [cargando]="cargandoMas()" unidad="viajes" (mas)="cargarMas()" /> }
      </div>
    } @else {
      <div class="tabla-caja">
        <table>
          <thead><tr><th>Fecha</th><th>Proceso</th><th>Referencia</th><th>Usuario</th><th>Resultado</th><th>Ambiente</th></tr></thead>
          <tbody>
            @for (t of transaccionesVisibles(); track t._id) {
              <tr><td>{{ t.createdAt | fechaHora }}</td><td>{{ procesos()[t.proceso] || t.proceso }}{{ t.tipo !== 1 ? ' (consulta)' : '' }}</td>
                <td>{{ t.referencia }}</td><td>{{ t.usuario?.nombre }}</td>
                <td>@if (t.ok) { <span class="chip ok">Aceptado {{ t.radicado ? '· ' + t.radicado : '' }}</span> } @else { <span class="chip error" [title]="t.mensaje">Rechazado</span><div class="sutil">{{ t.mensaje }}</div> }</td>
                <td>{{ t.ambiente }}</td></tr>
            } @empty { <tr><td colspan="6" class="vacio">Sin envíos registrados</td></tr> }
          </tbody>
        </table>
      </div>
    }

    <!-- Cumplido y anulación del soporte interno -->
    <app-modal [titulo]="'Cumplir soporte interno ' + ($any(soporteCumplir()?.viaje)?.soporteInterno?.mc || '')" [abierto]="!!soporteCumplir()" (cerrar)="soporteCumplir.set(null)">
      @if (soporteCumplir(); as c) {
        <form id="form-cumplir-soporte" class="formulario" (ngSubmit)="cumplirSoporte()">
          <p class="sutil" style="grid-column:1/-1">Viaje N° {{ c.viaje.numero }} · {{ c.viaje.placa }} · {{ c.viaje.destino }}. El soporte queda como entregado (no va al RNDC).</p>
          <div class="campo"><label for="cs-lleg">Fecha de llegada</label><input id="cs-lleg" type="date" name="llegada" [(ngModel)]="c.llegada" required /></div>
          <div class="campo"><label for="cs-cant">Cantidad entregada (kg)</label><input id="cs-cant" type="number" min="0" name="cantidad" [(ngModel)]="c.cantidad" /></div>
          <div class="campo" style="grid-column:1/-1"><label for="cs-obs">Observaciones</label><input id="cs-obs" name="obs" maxlength="300" [(ngModel)]="c.observaciones" placeholder="Opcional" /></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="soporteCumplir.set(null)">Cancelar</button>
        <button class="primario" type="submit" form="form-cumplir-soporte" [disabled]="trabajando()">Cumplir</button></ng-container>
    </app-modal>
    <app-modal [titulo]="(soporteAnular()?.soloCumplido ? 'Anular el cumplido del soporte ' : 'Anular soporte interno ') + ($any(soporteAnular()?.viaje)?.soporteInterno?.mc || '')" [abierto]="!!soporteAnular()" (cerrar)="soporteAnular.set(null)">
      @if (soporteAnular(); as a) {
        <form id="form-anular-soporte" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="anularSoporte()">
          <p class="sutil">@if (a.soloCumplido) { El soporte vuelve a quedar por cumplir. } @else { El soporte queda anulado: su QR mostrará que ya no es válido. Después puede generar uno nuevo para el mismo viaje. }</p>
          <div class="campo"><label for="as-mot">Motivo</label><input id="as-mot" name="motivo" minlength="3" maxlength="300" required [(ngModel)]="a.motivo" placeholder="Ej.: placa equivocada, el viaje no se hizo…" /></div>
        </form>
      }
      <ng-container pie><button type="button" (click)="soporteAnular.set(null)">Cancelar</button>
        <button class="peligro" type="submit" form="form-anular-soporte" [disabled]="trabajando() || (soporteAnular()?.motivo || '').trim().length < 3">Anular</button></ng-container>
    </app-modal>

    <!-- Correo manual: manifiestos elegidos (sueltos o en un solo PDF) y adjuntos -->
    <app-modal [titulo]="correoManual()?.soportes ? 'Enviar soportes internos por correo' : 'Enviar manifiestos por correo'" [abierto]="!!correoManual()" (cerrar)="correoManual.set(null)">
      @if (correoManual(); as c) {
        <form id="form-correo-manual" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="enviarCorreoManual()">
          <p class="sutil">{{ c.viajes.length }} {{ c.soportes ? 'soporte(s) interno(s)' : 'manifiesto(s)' }} elegido(s).</p>
          <div class="campo"><label for="cm-para">Para</label><input id="cm-para" name="para" [(ngModel)]="c.para" placeholder="correo@cliente.com, otro@cliente.com" required /></div>
          <div class="campo"><label for="cm-cc">Copia</label><input id="cm-cc" name="cc" [(ngModel)]="c.cc" /></div>
          <div class="campo"><label for="cm-as">Asunto</label><input id="cm-as" name="asunto" [(ngModel)]="c.asunto" /></div>
          <div class="campo"><label for="cm-tx">Mensaje</label><textarea id="cm-tx" name="texto" rows="4" [(ngModel)]="c.texto" placeholder="Opcional: si lo deja vacío va un saludo con la firma de la empresa"></textarea></div>
          @if (c.viajes.length > 1) { <label class="casilla"><input type="checkbox" name="unir" [(ngModel)]="c.unir" />Unir {{ c.soportes ? 'los soportes' : 'los manifiestos' }} en un solo PDF</label> }
          <div class="campo"><label for="cm-adj">Adjuntar archivos (opcional)</label><input id="cm-adj" type="file" multiple (change)="leerAdjuntosManual($event, c)" />
            @if (c.adjuntos.length) { <small>{{ c.adjuntos.length }} archivo(s) adjunto(s)</small> }</div>
        </form>
      }
      <ng-container pie><button type="button" (click)="correoManual.set(null)">Cancelar</button>
        <button class="primario" type="submit" form="form-correo-manual" [disabled]="trabajando() || !correoManual()?.para">Enviar</button></ng-container>
    </app-modal>

    <!-- Correos de un viaje -->
    <app-modal [titulo]="'Correos del viaje N° ' + (correosViaje()?.numero || '')" [abierto]="!!correosViaje()" (cerrar)="correosViaje.set(null)" [ancho]="true">
      <div class="tabla-caja" style="box-shadow:none"><table>
        <thead><tr><th>Fecha</th><th>Documento</th><th>Destinatarios</th><th>Estado</th><th></th></tr></thead>
        <tbody>@for (e of enviosViaje(); track e._id) {
          <tr><td>{{ e.createdAt | fechaHora }}</td><td>{{ e.tipo === 'salida' ? 'Carta de salida' : 'Manifiesto PDF' }}</td>
            <td class="destinos">
              <details><summary>{{ e.destinatarios.length }} destinatario(s){{ e.cc?.length ? ' + ' + e.cc.length + ' CC' : '' }}</summary>
                <ul>@for (d of e.destinatarios; track d) { <li>{{ d }}</li> }@for (d of e.cc || []; track d) { <li>CC: {{ d }}</li> }</ul></details>
            </td>
            <td><span class="chip" [class]="claseCorreo(e.estado)">{{ textoCorreo(e.estado) }}</span> <span class="sutil">· {{ e.intentos }} intento(s)</span>
              @if (e.error) { <div class="error-correo">{{ e.error }}</div> }</td>
            <td>@if (e.estado === 'error') { <button class="pequeno" (click)="reintentar(e)" [disabled]="trabajando()">Reintentar</button> }</td></tr>
        } @empty { <tr><td colspan="5" class="vacio">Este viaje no tiene correos enviados. Revise que el cliente tenga destinatarios en Configuración → Correo.</td></tr> }</tbody>
      </table></div>
      <ng-container pie>
        <button type="button" (click)="correosViaje.set(null)" style="margin-right:auto">Cerrar</button>
        <button type="button" confirmar="Clic otra vez para enviar" (confirmado)="enviarDeNuevo(['manifiesto'])" [disabled]="trabajando()"
          title="Envía solo el PDF del manifiesto a los destinatarios del cliente"><app-icono nombre="enviar" [tam]="16" />Reenviar manifiesto</button>
        <button type="button" confirmar="Clic otra vez para enviar" (confirmado)="enviarDeNuevo(['salida'])" [disabled]="trabajando()"
          title="Envía solo la carta de salida a los destinatarios del cliente"><app-icono nombre="enviar" [tam]="16" />Reenviar carta de salida</button>
        <button type="button" class="primario" confirmar="Clic otra vez para enviar" (confirmado)="enviarDeNuevo()" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="16" />Reenviar ambos</button>
      </ng-container>
    </app-modal>

    <!-- Manifiesto y remesa sin registrar antes el viaje -->
    <app-modal titulo="Nuevo manifiesto y remesa" [abierto]="directoAbierto()" (cerrar)="directoAbierto.set(false)" [ancho]="true">
      @let d = directo();
      <p class="sutil" style="margin-top:0">Para cualquier vehículo y conductor, sin registrar antes el viaje. Al continuar podrá revisar todo y enviarlo al RNDC.</p>
      <form id="form-directo" class="secciones" (ngSubmit)="crearDirecto()">
        <fieldset><legend>Cliente y ruta</legend><div class="rejilla">
          <div class="campo"><label for="md-fecha">Fecha</label><input id="md-fecha" type="date" name="fecha" [(ngModel)]="d.fecha" required /></div>
          <div class="campo"><label for="md-cli">Cliente (remitente)</label>
            <select id="md-cli" name="cliente" [(ngModel)]="d.cliente" (ngModelChange)="d.tarifaRef = ''" required><option value="">Seleccione…</option>
              @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
          <div class="campo"><label for="md-dest">Destino</label>
            <select id="md-dest" name="tarifa" [(ngModel)]="d.tarifaRef" (ngModelChange)="elegirTarifa($event)" [disabled]="!d.cliente"><option value="">Otro destino (escribir)</option>
              @for (t of tarifasDe(d.cliente); track t._id) { <option [value]="t._id">{{ t.destino }}</option> }</select></div>
          @if (!d.tarifaRef) {
            <div class="campo"><label for="md-dn">Nombre del destino</label><input id="md-dn" name="destino" [(ngModel)]="d.destino" required /></div>
            <app-municipio etiqueta="Municipio de destino" [(codigo)]="d.codDestino" />
          }
        </div></fieldset>
        <fieldset><legend>Vehículo y conductor</legend><div class="rejilla">
          <div class="campo"><label for="md-placa">Placa</label><input id="md-placa" name="placa" [(ngModel)]="d.placa" required maxlength="7" placeholder="ABC123" style="text-transform:uppercase" /></div>
          <app-buscar-tercero etiqueta="Conductor" rol="conductor" [(valor)]="d.conductor" />
          <div class="campo"><label for="md-rem">Remolque</label><input id="md-rem" name="remolque" [(ngModel)]="d.remolque" maxlength="7" placeholder="Opcional" style="text-transform:uppercase" /></div>
        </div></fieldset>
        <fieldset><legend>Carga y valores (COP)</legend><div class="rejilla">
          <div class="campo"><label for="md-peso">Cantidad cargada (kg)</label><input id="md-peso" type="number" min="0" name="peso" [(ngModel)]="d.pesoKg" /></div>
          <div class="campo"><label for="md-fl">Flete pactado</label><div class="moneda"><input id="md-fl" moneda name="flete" [(ngModel)]="d.flete" /></div></div>
          <div class="campo"><label for="md-an">Anticipo</label><div class="moneda"><input id="md-an" moneda name="anticipo" [(ngModel)]="d.anticipo" /></div></div>
        </div>
        <div class="campo" style="margin-top:14px"><label for="md-obs">Observaciones (van en el manifiesto)</label><input id="md-obs" name="obs" maxlength="200" [(ngModel)]="d.observaciones" /></div></fieldset>
      </form>
      <ng-container pie>
        <button type="button" (click)="directoAbierto.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-directo" [disabled]="trabajando() || !d.cliente || !d.placa || !d.conductor">Continuar a revisión</button>
      </ng-container>
    </app-modal>

    <!-- Expedición: revisar, corregir y enviar -->
    <app-expedir-rndc [viajeId]="expedir()" [soloVer]="soloVer()" (cerrar)="expedir.set(null)" (actualizado)="cargar()" />

    <!-- Ver PDF del manifiesto -->
    <app-modal [titulo]="pdfVisto()?.titulo || ''" [abierto]="!!pdfVisto()" (cerrar)="cerrarPdf()" [ancho]="true">
      @if (pdfVisto(); as pv) { <iframe class="visor-pdf" [src]="pv.seguro" [title]="pv.titulo"></iframe> }
      <ng-container pie><button type="button" (click)="cerrarPdf()">Cerrar</button></ng-container>
    </app-modal>

    <!-- Cumplido -->
    <app-modal [titulo]="cumplirLote().length ? 'Cumplir ' + cumplirLote().length + ' viajes' : 'Cumplir viaje N° ' + (cumplirViaje()?.numero || '')" [abierto]="!!cumplirViaje()" (cerrar)="cerrarCumplido()" [ancho]="true">
      @if (cumplirLote().length) {
        <div class="mensaje info">Se cumplirán los viajes N° {{ numerosLote(cumplirLote()) }}. Cada remesa se cumple con su propia cantidad cargada.</div>
      }
      @if (cumplido(); as c) {
      <form id="form-cumplido" (ngSubmit)="cumplir()">
        <fieldset><legend>{{ cumplirLote().length ? 'Cumplido de las remesas' : 'Cumplido de la remesa ' + (cumplirViaje()?.remesa?.numero || '') }}</legend>
          <div class="formulario">
            <div class="campo"><label for="c-tipo">Tipo</label><select id="c-tipo" name="rtipo" [(ngModel)]="c.remesa.tipo"><option value="C">Cumplido normal</option><option value="S">Suspensión</option></select></div>
            @if (c.remesa.tipo === 'S') {
              <div class="campo"><label for="c-mot">Motivo de suspensión</label><select id="c-mot" name="rmot" [(ngModel)]="c.remesa.motivoSuspension">
                @for (m of entradas(catalogos()?.motivoSuspensionRemesa); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }</select></div>
            }
            @if (!cumplirLote().length) {
              <div class="campo"><label for="c-cant">Cantidad entregada (kg)</label><input id="c-cant" type="number" min="0" name="rcant" [(ngModel)]="c.remesa.cantidadEntregada" /></div>
            } @else {
              <label class="casilla ancho"><input type="checkbox" name="ufv" [(ngModel)]="c.usarFechaViaje" />Usar la fecha de cada viaje para la llegada, entrada y salida (solo se eligen las horas)</label>
            }
            @for (m of momentos; track m[0]) {
              <div class="campo"><label [for]="'c-' + m[0]">{{ m[1] }} al descargue</label>
                <div class="acciones" style="flex-wrap:nowrap">@if (!(cumplirLote().length && c.usarFechaViaje)) { <input [id]="'c-' + m[0]" type="date" [name]="m[0] + 'f'" [(ngModel)]="c.remesa[m[0]].fecha" required /> }
                <input type="time" [name]="m[0] + 'h'" [(ngModel)]="c.remesa[m[0]].hora" required [attr.aria-label]="'Hora ' + m[1]" style="max-width:120px" /></div></div>
            }
          </div>
        </fieldset>
        <fieldset style="margin-top:14px"><legend>{{ cumplirLote().length ? 'Cumplido de los manifiestos' : 'Cumplido del manifiesto ' + (cumplirViaje()?.manifiesto?.numero || '') }}</legend>
          <div class="formulario">
            <div class="campo"><label for="m-tipo">Tipo</label><select id="m-tipo" name="mtipo" [(ngModel)]="c.manifiesto.tipo"><option value="C">Cumplido normal</option><option value="S">Suspensión</option></select></div>
            <div class="campo"><label for="m-ent">Entrega de documentos</label><input id="m-ent" type="date" name="ment" [(ngModel)]="c.manifiesto.fechaEntregaDocumentos" required /></div>
            <div class="campo"><label for="m-add">Valor adicional al flete</label><div class="moneda"><input id="m-add" moneda name="madd" [(ngModel)]="c.manifiesto.adicionalFlete" /></div></div>
            <div class="campo"><label for="m-desc">Descuento al flete</label><div class="moneda"><input id="m-desc" moneda name="mdesc" [(ngModel)]="c.manifiesto.descuento" /></div></div>
            <div class="campo"><label for="m-sob">Sobreanticipo</label><div class="moneda"><input id="m-sob" moneda name="msob" [(ngModel)]="c.manifiesto.sobreanticipo" /></div></div>
            <div class="campo ancho"><label for="m-obs">Observaciones</label><input id="m-obs" name="mobs" maxlength="200" [(ngModel)]="c.manifiesto.observaciones" /></div>
          </div>
        </fieldset>
      </form>
      }
      <ng-container pie>
        <button type="button" (click)="cerrarCumplido()">Cancelar</button>
        <button class="primario" type="submit" form="form-cumplido" [disabled]="trabajando()">{{ trabajando() ? 'Enviando…' : cumplirLote().length ? 'Cumplir ' + cumplirLote().length + ' viajes' : 'Enviar cumplidos' }}</button>
      </ng-container>
    </app-modal>

    <!-- Anulación -->
    <app-modal [titulo]="anularLote().length ? 'Anular ' + anularLote().length + ' viajes en el RNDC' : 'Anular en el RNDC'" [abierto]="!!anularViaje()" (cerrar)="cerrarAnular()">
      @if (anularLote().length) { <div class="mensaje info">Viajes N° {{ numerosLote(anularLote()) }}. Se usan el mismo motivo y las mismas observaciones para todos.</div> }
      @let a = anulacion();
      <form id="form-anular" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="anular()">
        <div class="campo"><label for="a-doc">Documento</label>
          <select id="a-doc" name="doc" [(ngModel)]="a.documento" (ngModelChange)="a.motivo = ''">
            @for (d of documentosAnulables(); track d[0]) { <option [value]="d[0]">{{ d[1] }}</option> }
          </select></div>
        <div class="campo"><label for="a-mot">{{ a.documento === 'ambos' ? 'Motivo del manifiesto' : 'Motivo' }}</label>
          <select id="a-mot" name="mot" [(ngModel)]="a.motivo" required><option value="">Seleccione…</option>
            @for (m of motivos(a.documento); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }</select>
          @if (a.documento === 'ambos') {
            <label for="a-motr" class="sub">Motivo de la remesa</label>
            <select id="a-motr" name="motr" [(ngModel)]="a.motivoRemesa" required><option value="">Seleccione…</option>
              @for (m of motivos('remesa'); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }</select>
            <small>Se anula primero el manifiesto y luego la remesa, en el orden que exige el RNDC.</small>
          }
          @if ((a.documento === 'manifiesto' || a.documento === 'ambos') && catalogos()?.motivosReemplazo.includes(a.motivo)) {
            <small>Se marcará como reemplazo: al volver a enviar, el nuevo manifiesto conserva el número con un punto al final ({{ anularViaje()?.manifiesto?.numero }}.) e indica cuál reemplaza (manual RNDC 8.9.2).</small>
          }</div>
        <div class="campo"><label for="a-obs">Observaciones</label><textarea id="a-obs" name="obs" maxlength="200" [(ngModel)]="a.observaciones" required></textarea></div>
        <div class="mensaje alerta">La anulación queda registrada en el RNDC y no se puede deshacer. El RNDC limita las anulaciones de manifiestos al 6 % mensual (sin contar reemplazos).</div>
      </form>
      <ng-container pie>
        <button type="button" (click)="cerrarAnular()">Cancelar</button>
        <button class="peligro" type="submit" form="form-anular" [disabled]="trabajando() || !a.motivo || !a.observaciones || (a.documento === 'ambos' && !a.motivoRemesa)">{{ trabajando() ? 'Anulando…' : anularLote().length ? 'Anular ' + anularLote().length + ' viajes' : a.documento === 'ambos' ? 'Anular ambos' : 'Anular' }}</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .soporte-filtros { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 18px; margin: -6px 0 12px; }
    .soporte-filtros p { margin: 0; flex: 1 1 380px; }
    .pila-acciones { display: inline-flex; flex-direction: column; align-items: stretch; gap: 6px; }
    .fila-acciones { display: flex; gap: 8px; justify-content: flex-end; }
    label.sub { margin-top: 10px; }
    .visor-pdf { width: 100%; height: 70vh; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); }
    .resultado-lote { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
    .resultado-lote ul { margin: 4px 0 0; padding-left: 18px; }
    .secciones { display: flex; flex-direction: column; gap: 14px; }
    .pendientes-correo { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 12px; }
    .destinos { max-width: 240px; font-size: 13px; }
    .destinos summary { color: var(--gris-7); }
    .destinos ul { margin: 6px 0 0; padding-left: 16px; font-size: 12.5px; color: var(--gris-5); word-break: break-all; }
    .error-correo { margin-top: 4px; font-size: 12.5px; color: var(--rojo-texto); max-width: 360px; }
    .chip-boton { border: 0; background: none; padding: 0; min-height: 0; cursor: pointer; }
    .rejilla { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 16px; align-items: start; }
    .rejilla .campo > label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media (max-width: 760px) { .rejilla { grid-template-columns: 1fr; } }
  `],
})
export class Manifiestos {
  private sanitizer = inject(DomSanitizer);
  private api = inject(Api);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly pestana = signal<Pestana>('pendientes');
  readonly viajes = signal<Viaje[]>([]);
  readonly transacciones = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly seleccion = signal(new Set<string>());
  readonly todos = computed(() => this.viajes().length > 0 && this.seleccion().size === this.viajes().length);
  readonly catalogos = signal<any>(null);
  readonly procesos = computed(() => this.catalogos()?.procesos || {});
  readonly ambiente = signal('');
  readonly expedir = signal<string | null>(null);
  readonly soloVer = signal(false);
  ver(id: string) { this.soloVer.set(true); this.expedir.set(id); }
  abrirExpedir(id: string) { this.soloVer.set(false); this.expedir.set(id); }
  // Correos de documentos
  readonly envios = signal<any[]>([]);
  // Filtros: los de las listas de viajes van al servidor; los de Correos e Historial, sobre lo cargado
  filtro = { desde: '', hasta: '', cliente: '', q: '' };
  readonly texto = signal('');
  readonly resultadoHist = signal('');
  readonly clientesFiltro = signal<any[]>([]);
  readonly enviosVisibles = computed(() => filtrar(this.envios().map(e => ({ ...e, _estado: this.textoCorreo(e.estado) })), this.texto()));
  readonly transaccionesVisibles = computed(() => filtrar(this.transacciones()
    .filter(t => !this.resultadoHist() || (this.resultadoHist() === 'ok') === !!t.ok)
    .map(t => ({ ...t, _proceso: this.procesos()[t.proceso] || '' })), this.texto()));
  private filtrosViajes() {
    return Object.fromEntries(Object.entries(this.filtro).filter(([, v]) => v));
  }
  limpiarFiltros() { this.filtro = { desde: '', hasta: '', cliente: '', q: '' }; this.cargar(); }
  readonly enviosPorViaje = signal<Map<string, any[]>>(new Map());
  readonly filtroCorreo = signal('');
  readonly correosViaje = signal<Viaje | null>(null);
  readonly enviosViaje = computed(() => this.enviosPorViaje().get(this.correosViaje()?._id || '') || []);
  readonly conCorreo = computed(() => ['manifestados', 'cumplidos'].includes(this.pestana()));
  readonly pendientesCorreo = signal(0);
  // Manifiesto directo (sin registrar antes el viaje)
  private auth = inject(Auth);
  readonly puedeCrear = this.auth.tiene(P.VIAJES_REGISTRAR);
  readonly directoAbierto = signal(false);
  readonly directo = signal<any>({});
  readonly clientes = signal<any[]>([]);
  readonly tarifas = signal<any[]>([]);
  readonly cumplirViaje = signal<Viaje | null>(null);
  readonly cumplido = signal<any>(null);
  readonly anularViaje = signal<Viaje | null>(null);
  readonly anulacion = signal<any>({ documento: 'manifiesto', motivo: '', observaciones: '' });
  readonly momentos: [string, string][] = [['llegada', 'Llegada'], ['entrada', 'Entrada'], ['salida', 'Salida']];

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['viajes', 'rndc', 'correo'], () => this.cargar());

  // Vista fija desde el menú (Soporte interno, Envíos al RNDC, Correos); vacía = Manifiestos con sus pestañas
  readonly vista = input<'' | 'soporte' | 'historial' | 'correos'>('');
  private static readonly VISTAS: Record<string, [string, string]> = {
    '': ['Manifiestos', 'Expida las remesas y los manifiestos, cumpla y anule. Si el RNDC rechaza algo, corríjalo y reenvíe. Los viajes sin manifiesto están en la pestaña «Soporte interno».'],
    soporte: ['Soporte interno', 'Viajes que no van al RNDC. Cada uno lleva su soporte interno (MC/RC) con un código QR que cualquiera puede escanear para comprobar que es válido.'],
    historial: ['Envíos al RNDC', 'Todo lo que la plataforma ha enviado al RNDC y lo que respondió: útil para revisar rechazos y radicados.'],
    correos: ['Correos de manifiestos', 'Envío de manifiestos y cartas de salida a los clientes: por aprobar, enviados y con error.'],
  };
  readonly titulo = computed(() => Manifiestos.VISTAS[this.vista() || ''][0]);
  readonly descripcion = computed(() => Manifiestos.VISTAS[this.vista() || ''][1]);

  // Pestaña inicial por la dirección (?abrir=soporte)
  readonly abrir = input<string>('');
  ngOnInit() {
    if (this.vista()) this.pestana.set(this.vista() as Pestana);
    else if (['pendientes', 'manifestados', 'cumplidos', 'anulados', 'soporte'].includes(this.abrir())) this.pestana.set(this.abrir() as Pestana);
    this.cargar();
  }

  constructor() {
    this.api.get<any[]>('/maestros/clientes').then(c => this.clientesFiltro.set(c)).catch(() => {});
    this.api.get('/rndc/catalogos').then(c => this.catalogos.set(c)).catch(() => {});
    this.api.get<any>('/rndc/config').then(c => this.ambiente.set(c.ambiente)).catch(() => {});
  }

  ir(p: Pestana) { this.pestana.set(p); this.seleccion.set(new Set()); this.texto.set(''); this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    try {
      if (this.pestana() === 'historial') this.transacciones.set(await this.api.get<any[]>('/rndc/transacciones', { limite: 200 }));
      else if (this.pestana() === 'correos') {
        const [l, p] = await Promise.all([this.api.get<any[]>('/correo/envios', { limite: 300, ...(this.filtroCorreo() ? { estado: this.filtroCorreo() } : {}) }),
          this.api.get<any[]>('/correo/envios', { estado: 'pendiente', limite: 1000 })]);
        this.envios.set(l); this.pendientesCorreo.set(p.filter(x => x.tipo === 'manifiesto').length);
      }
      else {
        this.pagina = 1;
        const r = await this.api.get<any>('/viajes', { ...FILTROS[this.pestana() as PestanaViajes], ...this.filtrosViajes(), pagina: 1, limite: 50, historico: 0, ...this.filtroSoporte() });
        this.viajes.set(r.viajes); this.total.set(r.total);
        this.cargarCorreos(r.viajes);
      }
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  // Carga progresiva de la lista de la pestaña
  private pagina = 1;
  readonly total = signal(0);
  readonly cargandoMas = signal(false);
  async cargarMas() {
    if (['historial', 'correos'].includes(this.pestana()) || this.cargandoMas() || this.viajes().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/viajes', { ...FILTROS[this.pestana() as PestanaViajes], ...this.filtrosViajes(), pagina: this.pagina + 1, limite: 50, historico: 0, ...this.filtroSoporte() });
      this.pagina += 1;
      this.viajes.update(l => [...l, ...r.viajes]);
      this.cargarCorreos(this.viajes());
    } catch (e) { this.avisos.error(e); } finally { this.cargandoMas.set(false); }
  }

  async nuevoManifiesto() {
    this.directo.set({ fecha: hoyIso(), cliente: '', tarifaRef: '', destino: '', codDestino: '', placa: '', conductor: '', remolque: '',
      pesoKg: null, flete: null, anticipo: null, observaciones: '' });
    this.directoAbierto.set(true);
    if (!this.clientes().length) {
      try {
        const [c, t] = await Promise.all([this.api.get<any[]>('/maestros/clientes'), this.api.get<any[]>('/maestros/tarifas')]);
        this.clientes.set(c.filter(x => x.activo !== false)); this.tarifas.set(t.filter(x => x.activo !== false));
      } catch (e) { this.avisos.error(e); }
    }
  }
  tarifasDe(cliente: string) { return this.tarifas().filter(t => (t.cliente?._id || t.cliente) === cliente); }
  elegirTarifa(id: string) {
    const t = this.tarifas().find(x => x._id === id);
    if (t) this.directo.update(d => ({ ...d, destino: t.destino, codDestino: t.codMunicipio, flete: t.fleteConductor, anticipo: t.anticipoHabitual, pesoKg: t.pesoKg || d.pesoKg }));
  }

  // Crea el registro del despacho (origen «manifiesto») y abre la revisión para enviarlo al RNDC.
  async crearDirecto() {
    const d = this.directo();
    const cuerpo: any = { fecha: d.fecha, cliente: d.cliente, tarifaRef: d.tarifaRef || null, destino: d.destino, codDestino: d.codDestino || '',
      placa: String(d.placa).toUpperCase().replace(/[\s-]/g, ''), remolque: String(d.remolque || '').toUpperCase(), conductor: d.conductor,
      observaciones: d.observaciones || '', origen: 'manifiesto', requiereManifiesto: true };
    for (const k of ['pesoKg', 'flete', 'anticipo']) if (d[k] !== null && d[k] !== '') cuerpo[k] = Number(d[k]);
    this.trabajando.set(true);
    try {
      const v = await this.api.post<any>('/viajes', cuerpo);
      this.directoAbierto.set(false);
      this.avisos.ok(`Despacho N° ${v.numero} creado: revise y envíe al RNDC`);
      this.ir('pendientes');
      this.expedir.set(v._id);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // ── Correos de documentos ──
  textoCorreo(e: string) { return ESTADO_CORREO[e]?.[0] || e; }
  claseCorreo(e: string) { return ESTADO_CORREO[e]?.[1] || ''; }

  private async cargarCorreos(lista: Viaje[]) {
    if (!this.conCorreo() || !lista.length) return;
    try {
      const envios = await this.api.get<any[]>('/correo/envios', { viajes: lista.map(v => v._id).join(','), limite: 1000 });
      const m = new Map<string, any[]>();
      for (const e of envios) m.set(e.viaje, [...(m.get(e.viaje) || []), e]);
      this.enviosPorViaje.set(m);
    } catch { /* sin permiso para ver correos */ }
  }

  // Estado más reciente de cada documento enviado del viaje
  resumenCorreo(viajeId: string) {
    const l = this.enviosPorViaje().get(viajeId);
    if (!l?.length) return null;
    const ultimo = new Map<string, any>();
    for (const e of l) if (!ultimo.has(e.tipo)) ultimo.set(e.tipo, e);
    const estados = [...ultimo.values()];
    const error = estados.some(e => e.estado === 'error');
    const todos = estados.every(e => e.estado === 'enviado');
    const aprobar = estados.some(e => e.estado === 'por_aprobar');
    const descartado = estados.every(e => e.estado === 'descartado');
    return { texto: error ? 'Error' : aprobar ? 'Por aprobar' : todos ? 'Enviado' : descartado ? 'Descartado' : 'Pendiente',
      clase: error ? 'error' : todos ? 'ok' : descartado ? '' : 'alerta',
      titulo: estados.map(e => `${e.tipo === 'salida' ? 'Carta de salida' : 'Manifiesto'}: ${this.textoCorreo(e.estado)}`).join(' · ') };
  }

  verCorreos(v: Viaje) { this.correosViaje.set(v); }

  // ── Aprobación de correos: nada sale al cliente sin confirmación ──
  readonly conSeleccion = computed(() => ['pendientes', 'manifestados', 'soporte'].includes(this.pestana()));
  tienePorAprobar(viajeId: string) { return (this.enviosPorViaje().get(viajeId) || []).some(e => e.estado === 'por_aprobar'); }
  readonly porAprobar = computed(() => this.viajes().filter(v => (this.enviosPorViaje().get(v._id) || []).some(e => e.estado === 'por_aprobar')).map(v => v._id));
  // ── Correo manual ──
  readonly correoManual = signal<any>(null);
  abrirCorreoManual(soportes = false, ids = [...this.seleccion()]) {
    const elegidos = this.viajes().filter(v => ids.includes(v._id));
    if (soportes && elegidos.some(v => !(v as any).soporteInterno?.mc)) { this.avisos.mostrar('Genere primero el soporte de los viajes elegidos', 'error'); return; }
    const cli = elegidos[0]?.cliente as any;
    const para = (cli?.envios?.destinatarios || cli?.correos || []).join(', ');
    const cc = (cli?.envios?.cc || []).join(', ');
    const asunto = soportes ? `Soporte interno ${elegidos.map(v => (v as any).soporteInterno?.mc).filter(Boolean).join(', ')} - ${cli?.nombre || ''}`.trim() : '';
    this.correoManual.set({ viajes: ids, soportes, para, cc, asunto, texto: '', unir: true, adjuntos: [] });
  }
  correoSoporte(v: Viaje) { this.abrirCorreoManual(true, [v._id]); }
  async leerAdjuntosManual(ev: Event, c: any) { c.adjuntos = await leerArchivos(ev, this.avisos); }
  async enviarCorreoManual() {
    const c = this.correoManual(); const lista = (t: string) => String(t || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/correo/manual', { para: lista(c.para), cc: lista(c.cc), asunto: c.asunto, texto: c.texto, ...(c.soportes ? { soportes: c.viajes } : { viajes: c.viajes }), unir: c.unir, adjuntos: c.adjuntos });
      if (r.estado === 'enviado') { this.avisos.ok(`Correo enviado: ${r.adjuntos?.length || 0} archivo(s)`); this.correoManual.set(null); }
      else this.avisos.mostrar(`No se envió: ${r.error}`, 'error');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async aprobarCorreos(viajes: string[]) {
    if (!viajes.length) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/correo/aprobar', { viajes });
      const fallos = r.resultados.filter((x: any) => x.estado === 'error');
      if (!r.aprobados) this.avisos.mostrar('Los viajes elegidos no tienen correos por aprobar', 'info');
      else if (fallos.length) this.avisos.mostrar(`Se aprobaron ${r.aprobados} correo(s), pero ${fallos.length} falló: ${fallos[0].error}`, 'error');
      else this.avisos.ok(`${r.aprobados} correo(s) aprobados y enviados`);
      this.seleccion.set(new Set());
      await this.cargarCorreos(this.viajes());
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async descartarCorreos(viajes: string[]) {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/correo/descartar', { viajes });
      this.avisos.ok(`${r.descartados} correo(s) descartados; no se enviarán`);
      this.seleccion.set(new Set());
      await this.cargarCorreos(this.viajes());
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  listaDestinos(e: any) { return [...e.destinatarios, ...(e.cc || []).map((x: string) => `CC: ${x}`)].join(', '); }

  async reintentar(e: any) {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/correo/envios/${e._id}/reintentar`, {});
      if (r?.estado === 'enviado') this.avisos.ok('Correo enviado'); else this.avisos.mostrar(`No se pudo enviar: ${r?.error || 'error desconocido'}`, 'error');
      this.cargar();
    } catch (x) { this.avisos.error(x); } finally { this.trabajando.set(false); }
  }

  async enviarPendientes() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any[]>('/correo/pendientes/enviar', {});
      const fallos = r.filter(x => x.estado !== 'enviado');
      if (!r.length) this.avisos.mostrar('No había manifiestos pendientes', 'info');
      else if (!fallos.length) this.avisos.ok(`${r.length} correo(s) enviados con ${r.reduce((a, x) => a + x.cantidad, 0)} manifiesto(s)`);
      else this.avisos.mostrar(`No se pudo enviar: ${fallos[0].error}`, 'error');
      this.cargar();
    } catch (x) { this.avisos.error(x); } finally { this.trabajando.set(false); }
  }

  async enviarDeNuevo(tipos?: ('manifiesto' | 'salida')[]) {
    const v = this.correosViaje();
    if (!v) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any[]>(`/correo/viajes/${v._id}/enviar`, tipos ? { tipos } : {});
      const fallos = r.filter(x => x.estado !== 'enviado');
      const que = tipos?.length === 1 ? (tipos[0] === 'salida' ? 'Carta de salida enviada' : 'Manifiesto enviado') : `${r.length} correo(s) enviados`;
      if (!fallos.length) this.avisos.ok(que); else this.avisos.mostrar(`No se pudo enviar: ${fallos[0].error}`, 'error');
      await this.cargarCorreos(this.viajes());
    } catch (x) { this.avisos.error(x); } finally { this.trabajando.set(false); }
  }

  entradas(o: Record<string, string> | undefined) { return Object.entries(o || {}); }
  chip(e: string) { return ({ aceptado: 'ok', rechazado: 'error', anulado: 'alerta' } as Record<string, string>)[e] || ''; }
  mensajeError(v: Viaje) {
    if (v.manifiesto?.estado === 'rechazado') return `Manifiesto rechazado: ${v.manifiesto.mensaje}`;
    if (v.remesa?.estado === 'rechazado') return `Remesa rechazada: ${v.remesa.mensaje}`;
    return '';
  }
  alternar(id: string) { this.seleccion.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  alternarTodos() { this.seleccion.set(this.todos() ? new Set() : new Set(this.viajes().map(v => v._id))); }

  // Ejecuta una operación que requiere la contraseña del RNDC.
  private async conClave<T>(fn: (clave: string) => Promise<T>): Promise<T | null> {
    const clave = await this.clave.obtener();
    if (!clave) return null;
    this.trabajando.set(true);
    try {
      return await fn(clave);
    } catch (e) {
      this.avisos.error(e);
      return null;
    } finally {
      this.trabajando.set(false);
    }
  }

  private revisarClave(mensajes: string[]) {
    if (mensajes.some(m => /contrase|clave|password|autentic|usuario (no |inv|o |y )/i.test(m || ''))) this.clave.olvidar();
  }

  async enviarLote() {
    const ids = [...this.seleccion()];
    const r = await this.conClave(c => this.api.post<any[]>('/rndc/despachar-lote', { clave: c, viajes: ids }));
    if (!r) return;
    const ok = r.filter(x => x.manifiesto?.estado === 'aceptado').length;
    this.revisarClave(r.map(x => x.error || x.remesa?.mensaje || x.manifiesto?.mensaje));
    this.avisos.mostrar(`${ok} de ${ids.length} viaje(s) manifestados. Los rechazados muestran el motivo en la lista.`, ok === ids.length ? 'ok' : 'error');
    this.seleccion.set(new Set());
    this.cargar();
  }

  // Ver el PDF del manifiesto en pantalla (sin descargarlo). En el celular se abre en otra pestaña.
  readonly pdfVisto = signal<{ titulo: string; url: string; seguro: SafeResourceUrl } | null>(null);
  // ── Soporte interno: estado, cumplido, anulación y reemplazo ──
  readonly estadosSoporte: [string, string][] = [['', 'Todos'], ['vigente', 'Por cumplir'], ['cumplido', 'Cumplidos'], ['anulado', 'Anulados']];
  readonly soporteEstado = signal('');
  private filtroSoporte() {
    if (this.pestana() !== 'soporte') return { rndc: 1 };
    return this.soporteEstado() ? { soporteEstado: this.soporteEstado() } : {};
  }
  chipSoporte(v: any) { return ({ cumplido: 'ok', anulado: 'error' } as Record<string, string>)[v.soporteInterno?.estado] || 'alerta'; }
  textoSoporte(v: any) { return ({ cumplido: 'cumplido', anulado: 'anulado' } as Record<string, string>)[v.soporteInterno?.estado] || 'por cumplir'; }
  readonly soporteCumplir = signal<{ viaje: Viaje; llegada: string; cantidad: number | null; observaciones: string } | null>(null);
  readonly soporteAnular = signal<{ viaje: Viaje; motivo: string; soloCumplido: boolean } | null>(null);
  abrirCumplirSoporte(v: Viaje) { this.soporteCumplir.set({ viaje: v, llegada: hoyIso(), cantidad: (v as any).pesoKg ?? null, observaciones: '' }); }
  abrirAnularSoporte(v: Viaje, soloCumplido: boolean) { this.soporteAnular.set({ viaje: v, motivo: '', soloCumplido }); }
  async cumplirSoporte() {
    const c = this.soporteCumplir(); if (!c) return;
    this.trabajando.set(true);
    try {
      const s = await this.api.post<any>(`/gestion/soportes/viajes/${c.viaje._id}/cumplir`, { llegada: c.llegada, cantidad: c.cantidad, observaciones: c.observaciones });
      this.avisos.ok(`Soporte ${s.mc} cumplido`); this.soporteCumplir.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async anularSoporte() {
    const a = this.soporteAnular(); if (!a) return;
    this.trabajando.set(true);
    try {
      const s = await this.api.post<any>(`/gestion/soportes/viajes/${a.viaje._id}/anular`, { motivo: a.motivo, soloCumplido: a.soloCumplido });
      this.avisos.ok(a.soloCumplido ? `Cumplido del soporte ${s.mc} anulado` : `Soporte ${s.mc} anulado`); this.soporteAnular.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async reemplazarSoporte(v: Viaje) {
    this.trabajando.set(true);
    try {
      const s = await this.api.post<any>(`/gestion/soportes/viajes/${v._id}`, { reemplazar: true });
      this.avisos.ok(`Nuevo soporte ${s.mc} / ${s.rc}`); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // Soporte interno MC/RC: se numera si aún no lo tiene y se muestra en pantalla
  async verSoporte(v: Viaje) {
    this.trabajando.set(true);
    try {
      const s = await this.api.post<any>(`/gestion/soportes/viajes/${v._id}`, {});
      const blob = await this.api.archivo(`/gestion/soportes/viajes/${v._id}/pdf`);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      this.cerrarPdf();
      this.pdfVisto.set({ titulo: `Soporte interno ${s.mc} / ${s.rc}`, url, seguro: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
      if (!(v as any).soporteInterno?.mc) this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async verPdf(v: Viaje) {
    const movil = window.matchMedia('(max-width: 700px)').matches;
    const ventana = movil ? window.open('', '_blank') : null;      // se abre ya para que el navegador no la bloquee
    try {
      const blob = await this.api.archivo(`/reportes/manifiesto/${v._id}`);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (ventana) { ventana.location.href = url; return; }
      this.cerrarPdf();
      this.pdfVisto.set({ titulo: `Manifiesto ${v.manifiesto.numero}`, url, seguro: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
    } catch (e) { ventana?.close(); this.avisos.error(e); }
  }
  cerrarPdf() {
    const p = this.pdfVisto();
    if (p) URL.revokeObjectURL(p.url);
    this.pdfVisto.set(null);
  }

  abrirCumplido(v: Viaje) {
    const dia = isoDia(v.fecha);
    this.cumplido.set({
      remesa: { tipo: 'C', motivoSuspension: 'A', cantidadEntregada: v.pesoKg,
        llegada: { fecha: dia, hora: '' }, entrada: { fecha: dia, hora: '' }, salida: { fecha: dia, hora: '' } },
      manifiesto: { tipo: 'C', fechaEntregaDocumentos: hoyIso(), adicionalFlete: null, descuento: null, sobreanticipo: null, observaciones: '' },
    });
    this.cumplirViaje.set(v);
  }

  // ── Cumplido y anulación de varios viajes a la vez ──
  readonly cumplirLote = signal<Viaje[]>([]);
  readonly anularLote = signal<Viaje[]>([]);
  readonly resultadoLote = signal<{ titulo: string; total: number; aceptados: number; fallos: any[] } | null>(null);
  numerosLote(l: Viaje[]) { return l.map(v => v.numero).join(', '); }
  private seleccionados() { return this.viajes().filter(v => this.seleccion().has(v._id)); }
  abrirCumplidoLote() {
    const l = this.seleccionados();
    if (!l.length) return;
    this.abrirCumplido(l[0]);
    this.cumplido.update(c => ({ ...c, usarFechaViaje: true }));
    this.cumplirLote.set(l);
  }
  abrirAnularLote() {
    const l = this.seleccionados();
    if (!l.length) return;
    this.anularLote.set(l);
    this.abrirAnular(l[0]);
  }
  cerrarCumplido() { this.cumplirViaje.set(null); this.cumplirLote.set([]); }
  cerrarAnular() { this.anularViaje.set(null); this.anularLote.set([]); }
  private mostrarResultadoLote(titulo: string, r: any[]) {
    const fallos = r.filter(x => !x.ok);
    this.resultadoLote.set({ titulo, total: r.length, aceptados: r.length - fallos.length, fallos });
    if (fallos.some(x => /contrase|clave|password|autentic|usuario (no |inv|o |y )/i.test(x.mensaje || ''))) this.clave.olvidar();
    if (!fallos.length) this.avisos.ok(`${titulo}: ${r.length} aceptados`);
    this.seleccion.set(new Set());
  }

  async cumplir() {
    const v = this.cumplirViaje();
    if (!v) return;
    const c = this.cumplido();
    const limpio = (o: any) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== ''));
    if (this.cumplirLote().length) {
      const ids = this.cumplirLote().map(x => x._id);
      const r = await this.conClave(cl => this.api.post<any[]>('/rndc/cumplir-lote', { clave: cl, viajes: ids, usarFechaViaje: !!c.usarFechaViaje,
        remesa: limpio({ ...c.remesa, cantidadEntregada: null }), manifiesto: limpio(c.manifiesto) }));
      if (!r) return;
      this.cerrarCumplido();
      this.mostrarResultadoLote('Cumplidos', r);
      this.cargar();
      return;
    }
    const r = await this.conClave(cl => this.api.post<any>(`/rndc/viajes/${v._id}/cumplir`, { clave: cl, remesa: limpio(c.remesa), manifiesto: limpio(c.manifiesto) }));
    if (!r) return;
    if (r.cumplidoManifiesto?.estado === 'aceptado') { this.avisos.ok(`Viaje ${v.numero} cumplido en el RNDC`); this.cumplirViaje.set(null); }
    else this.avisos.mostrar(r.cumplidoManifiesto?.mensaje || r.cumplidoRemesa?.mensaje || 'El RNDC rechazó el cumplido', 'error');
    this.cargar();
  }

  documentosAnulables(): [string, string][] {
    const v = this.anularViaje();
    if (!v) return [];
    if (this.anularLote().length) return [['manifiesto', 'Solo los manifiestos'], ['ambos', 'Manifiestos y remesas']];
    if (v.estado === 'cumplido') return [['cumplidoManifiesto', 'Cumplido del manifiesto'], ...(v.cumplidoRemesa?.estado === 'aceptado' ? [['cumplidoRemesa', 'Cumplido de la remesa'] as [string, string]] : [])];
    if (v.estado === 'remesa') return [['remesa', `Remesa ${v.remesa.numero}`]];
    return [['manifiesto', `Solo el manifiesto ${v.manifiesto.numero}`],
      ...(v.remesa?.estado === 'aceptado' ? [['ambos', `Manifiesto ${v.manifiesto.numero} y remesa ${v.remesa.numero}`] as [string, string]] : [])];
  }

  motivos(doc: string): [string, string][] {
    const c = this.catalogos();
    if (!c) return [];
    return Object.entries(doc === 'manifiesto' || doc === 'ambos' ? c.motivoAnulacionManifiesto : doc === 'remesa' ? c.motivoAnulacionRemesa : c.motivoAnulacionCumplido);
  }

  abrirAnular(v: Viaje) {
    this.anularViaje.set(v);
    this.anulacion.set({ documento: this.documentosAnulables()[0]?.[0] || 'manifiesto', motivo: '', motivoRemesa: '', observaciones: '' });
  }

  async anular() {
    const v = this.anularViaje();
    if (!v) return;
    if (this.anularLote().length) {
      const ids = this.anularLote().map(x => x._id);
      const r = await this.conClave(c => this.api.post<any[]>('/rndc/anular-lote', { clave: c, viajes: ids, ...this.anulacion() }));
      if (!r) return;
      this.cerrarAnular();
      this.mostrarResultadoLote('Anulaciones', r);
      this.cargar();
      return;
    }
    const r = await this.conClave(c => this.api.post<any>(`/rndc/viajes/${v._id}/anular`, { clave: c, ...this.anulacion() }));
    if (!r) return;
    if (r.ok) { this.avisos.ok(`Anulación aceptada (radicado ${r.radicado})`); this.anularViaje.set(null); }
    else if (r.manifiesto?.ok) { this.anularViaje.set(null); this.avisos.mostrar(r.mensaje, 'error'); }
    else { this.revisarClave([r.mensaje]); this.avisos.mostrar(`El RNDC rechazó la anulación: ${r.mensaje}`, 'error'); }
    this.cargar();
  }
}
