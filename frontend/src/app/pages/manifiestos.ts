import { Component, computed, inject, signal } from '@angular/core';
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
import { SelectorMunicipio } from '../shared/municipio';
import { BuscarTercero } from '../shared/buscar-tercero';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';

type Pestana = 'pendientes' | 'anulados' | 'manifestados' | 'cumplidos' | 'correos' | 'historial';
type PestanaViajes = 'pendientes' | 'anulados' | 'manifestados' | 'cumplidos';
// Filtro de cada pestaña. Con remesa o manifiesto anulados el viaje sale de «Por enviar» y queda en «Anulados».
const FILTROS: Record<PestanaViajes, Record<string, string | number>> = {
  pendientes: { estado: 'registrado,remesa', anulados: 0 }, anulados: { estado: 'registrado,remesa', anulados: 1 },
  manifestados: { estado: 'manifestado' }, cumplidos: { estado: 'cumplido' },
};
const ESTADO_CORREO: Record<string, [string, string]> = {
  enviado: ['Enviado', 'ok'], error: ['Error', 'error'], pendiente: ['Pendiente', 'alerta'], enviando: ['Enviando', 'alerta'],
};

@Component({
  selector: 'app-manifiestos',
  imports: [FormsModule, Modal, Icono, Moneda, CargarMas, ExpedirRndc, SelectorMunicipio, BuscarTercero, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Manifiestos RNDC</h1><p class="sutil">Aquí se expiden las remesas y los manifiestos: revise los datos, envíelos al RNDC y, si hay un rechazo, corríjalos y reenvíe.
        Los viajes marcados como «no requiere manifiesto» no aparecen.</p></div>
      <div class="acciones">
        @if (pestana() === 'pendientes' && seleccion().size) {
          <button (click)="enviarLote()" [disabled]="trabajando()"><app-icono nombre="enviar" />Enviar {{ seleccion().size }} seleccionado(s)</button>
        }
        @if (puedeCrear) { <button class="primario" (click)="nuevoManifiesto()"><app-icono nombre="mas" />Nuevo manifiesto</button> }
      </div>
    </div>

    @if (ambiente() && ambiente() !== 'PRODUCCION') {
      <div class="mensaje alerta" style="margin-bottom:14px">
        Ambiente RNDC: <strong>{{ ambiente() === 'SIMULADO' ? 'simulador local' : 'pruebas del Ministerio' }}</strong>.
        Los documentos expedidos aquí no tienen validez legal. El administrador lo cambia en Configuración.
      </div>
    }

    <div class="pestanas">
      <button [class.activa]="pestana() === 'pendientes'" (click)="ir('pendientes')">Por enviar</button>
      <button [class.activa]="pestana() === 'manifestados'" (click)="ir('manifestados')">Manifestados</button>
      <button [class.activa]="pestana() === 'cumplidos'" (click)="ir('cumplidos')">Cumplidos</button>
      <button [class.activa]="pestana() === 'anulados'" (click)="ir('anulados')" title="Viajes con la remesa o el manifiesto anulados en el RNDC">Anulados</button>
      <button [class.activa]="pestana() === 'correos'" (click)="ir('correos')">Correos</button>
      <button [class.activa]="pestana() === 'historial'" (click)="ir('historial')">Historial RNDC</button>
    </div>
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
          @for (e of [['', 'Todos'], ['error', 'Con error'], ['enviado', 'Enviados'], ['pendiente', 'Pendientes']]; track e[0]) {
            <button type="button" [class.activo]="filtroCorreo() === e[0]" (click)="filtroCorreo.set(e[0]); cargar()">{{ e[1] }}</button>
          }
        </div>
      </div>
      <div class="tabla-caja"><table>
        <thead><tr><th>Fecha</th><th>Manifiesto</th><th>Documento</th><th>Destinatarios</th><th>Estado</th><th>Intentos</th><th></th></tr></thead>
        <tbody>@for (e of envios(); track e._id) {
          <tr><td>{{ e.createdAt | fechaHora }}</td><td>{{ e.documento }}</td>
            <td>{{ e.tipo === 'salida' ? 'Carta de salida' : 'Manifiesto PDF' }}<br /><span class="sutil">{{ e.origen === 'manual' ? 'Manual' : 'Automático' }}{{ e.usuario?.nombre ? ' · ' + e.usuario.nombre : '' }}</span></td>
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
        <table>
          <thead><tr>
            @if (pestana() === 'pendientes') { <th><input type="checkbox" aria-label="Seleccionar todos" [checked]="todos()" (change)="alternarTodos()" /></th> }
            <th>N°</th><th>Fecha</th><th>Cliente / destino</th><th>Placa</th><th>Conductor</th><th class="num">Flete</th>
            <th>Remesa</th><th>Manifiesto</th>@if (conCorreo()) { <th>Correo</th> }<th></th></tr></thead>
          <tbody>
            @for (v of viajes(); track v._id) {
              <tr>
                @if (pestana() === 'pendientes') { <td><input type="checkbox" [attr.aria-label]="'Seleccionar viaje ' + v.numero" [checked]="seleccion().has(v._id)" (change)="alternar(v._id)" /></td> }
                <td>{{ v.numero }}</td><td>{{ v.fecha | dia }}</td>
                <td>{{ v.cliente?.nombre }}<br /><span class="sutil">{{ v.destino }}</span></td>
                <td><strong>{{ v.placa }}</strong></td><td>{{ v.conductorNombre }}</td><td class="num">{{ v.flete | pesos }}</td>
                <td>@if (v.remesa.numero) { {{ v.remesa.numero }}<br /><span class="chip" [class]="chip(v.remesa.estado)">{{ v.remesa.estado || 'sin enviar' }}</span> }</td>
                <td>@if (v.manifiesto.numero) { {{ v.manifiesto.numero }}<br /><span class="chip" [class]="chip(v.manifiesto.estado)">{{ v.manifiesto.estado || 'sin enviar' }}</span> }
                  @if (v.manifiesto.radicado && v.manifiesto.estado === 'aceptado') { <br /><span class="sutil">Rad. {{ v.manifiesto.radicado }}</span> }</td>
                @if (conCorreo()) {
                  <td>@if (resumenCorreo(v._id); as rc) { <button type="button" class="chip-boton" (click)="verCorreos(v)" [title]="rc.titulo"><span class="chip" [class]="rc.clase">{{ rc.texto }}</span></button> }
                    @else { <button type="button" class="pequeno texto" (click)="verCorreos(v)">Sin envío</button> }</td>
                }
                <td>
                  <div class="acciones" style="justify-content:flex-end">
                    @switch (pestana()) {
                      @case ('anulados') {
                        <button class="pequeno primario" (click)="expedir.set(v._id)" [disabled]="trabajando()">
                          <app-icono nombre="enviar" [tam]="15" />{{ v.manifiesto.estado === 'anulado' ? 'Expedir reemplazo' : 'Expedir de nuevo' }}</button>
                        @if (v.remesa.estado === 'aceptado' && v.manifiesto.estado !== 'aceptado') {
                          <button class="pequeno peligro" (click)="abrirAnular(v)" title="La remesa sigue vigente en el RNDC">Anular remesa</button>
                        }
                      }
                      @case ('pendientes') {
                        <button class="pequeno primario" (click)="expedir.set(v._id)" [disabled]="trabajando()">
                          <app-icono nombre="enviar" [tam]="15" />{{ mensajeError(v) ? 'Corregir y reenviar' : 'Expedir' }}</button>
                        @if (v.estado === 'remesa') { <button class="pequeno peligro" (click)="abrirAnular(v)" title="Anular la remesa aceptada">Anular remesa</button> }
                      }
                      @case ('manifestados') {
                        <button class="pequeno" (click)="pdf(v)"><app-icono nombre="descargar" [tam]="15" />PDF</button>
                        <button class="pequeno primario" (click)="abrirCumplido(v)">Cumplir</button>
                        <button class="pequeno peligro" (click)="abrirAnular(v)">Anular</button>
                      }
                      @case ('cumplidos') {
                        <button class="pequeno" (click)="pdf(v)"><app-icono nombre="descargar" [tam]="15" />PDF</button>
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
            @for (t of transacciones(); track t._id) {
              <tr><td>{{ t.createdAt | fechaHora }}</td><td>{{ procesos()[t.proceso] || t.proceso }}{{ t.tipo !== 1 ? ' (consulta)' : '' }}</td>
                <td>{{ t.referencia }}</td><td>{{ t.usuario?.nombre }}</td>
                <td>@if (t.ok) { <span class="chip ok">Aceptado {{ t.radicado ? '· ' + t.radicado : '' }}</span> } @else { <span class="chip error" [title]="t.mensaje">Rechazado</span><div class="sutil">{{ t.mensaje }}</div> }</td>
                <td>{{ t.ambiente }}</td></tr>
            } @empty { <tr><td colspan="6" class="vacio">Sin envíos registrados</td></tr> }
          </tbody>
        </table>
      </div>
    }

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
    <app-expedir-rndc [viajeId]="expedir()" (cerrar)="expedir.set(null)" (actualizado)="cargar()" />

    <!-- Cumplido -->
    <app-modal [titulo]="'Cumplir viaje N° ' + (cumplirViaje()?.numero || '')" [abierto]="!!cumplirViaje()" (cerrar)="cumplirViaje.set(null)" [ancho]="true">
      @if (cumplido(); as c) {
      <form id="form-cumplido" (ngSubmit)="cumplir()">
        <fieldset><legend>Cumplido de la remesa {{ cumplirViaje()?.remesa?.numero }}</legend>
          <div class="formulario">
            <div class="campo"><label for="c-tipo">Tipo</label><select id="c-tipo" name="rtipo" [(ngModel)]="c.remesa.tipo"><option value="C">Cumplido normal</option><option value="S">Suspensión</option></select></div>
            @if (c.remesa.tipo === 'S') {
              <div class="campo"><label for="c-mot">Motivo de suspensión</label><select id="c-mot" name="rmot" [(ngModel)]="c.remesa.motivoSuspension">
                @for (m of entradas(catalogos()?.motivoSuspensionRemesa); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }</select></div>
            }
            <div class="campo"><label for="c-cant">Cantidad entregada (kg)</label><input id="c-cant" type="number" min="0" name="rcant" [(ngModel)]="c.remesa.cantidadEntregada" /></div>
            @for (m of momentos; track m[0]) {
              <div class="campo"><label [for]="'c-' + m[0]">{{ m[1] }} al descargue</label>
                <div class="acciones" style="flex-wrap:nowrap"><input [id]="'c-' + m[0]" type="date" [name]="m[0] + 'f'" [(ngModel)]="c.remesa[m[0]].fecha" required />
                <input type="time" [name]="m[0] + 'h'" [(ngModel)]="c.remesa[m[0]].hora" required [attr.aria-label]="'Hora ' + m[1]" style="max-width:120px" /></div></div>
            }
          </div>
        </fieldset>
        <fieldset style="margin-top:14px"><legend>Cumplido del manifiesto {{ cumplirViaje()?.manifiesto?.numero }}</legend>
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
        <button type="button" (click)="cumplirViaje.set(null)">Cancelar</button>
        <button class="primario" type="submit" form="form-cumplido" [disabled]="trabajando()">Enviar cumplidos</button>
      </ng-container>
    </app-modal>

    <!-- Anulación -->
    <app-modal titulo="Anular en el RNDC" [abierto]="!!anularViaje()" (cerrar)="anularViaje.set(null)">
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
        <button type="button" (click)="anularViaje.set(null)">Cancelar</button>
        <button class="peligro" type="submit" form="form-anular" [disabled]="trabajando() || !a.motivo || !a.observaciones || (a.documento === 'ambos' && !a.motivoRemesa)">{{ a.documento === 'ambos' ? 'Anular ambos' : 'Anular' }}</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    label.sub { margin-top: 10px; }
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
  // Correos de documentos
  readonly envios = signal<any[]>([]);
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

  constructor() {
    this.cargar();
    this.api.get('/rndc/catalogos').then(c => this.catalogos.set(c)).catch(() => {});
    this.api.get<any>('/rndc/config').then(c => this.ambiente.set(c.ambiente)).catch(() => {});
  }

  ir(p: Pestana) { this.pestana.set(p); this.seleccion.set(new Set()); this.cargar(); }

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
        const r = await this.api.get<any>('/viajes', { ...FILTROS[this.pestana() as PestanaViajes], pagina: 1, limite: 50, historico: 0, rndc: 1 });
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
      const r = await this.api.get<any>('/viajes', { ...FILTROS[this.pestana() as PestanaViajes], pagina: this.pagina + 1, limite: 50, historico: 0, rndc: 1 });
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
    return { texto: error ? 'Error' : todos ? 'Enviado' : 'Pendiente', clase: error ? 'error' : todos ? 'ok' : 'alerta',
      titulo: estados.map(e => `${e.tipo === 'salida' ? 'Carta de salida' : 'Manifiesto'}: ${this.textoCorreo(e.estado)}`).join(' · ') };
  }

  verCorreos(v: Viaje) { this.correosViaje.set(v); }
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
    if (mensajes.some(m => /usuario|contrase|clave|password/i.test(m || ''))) this.clave.olvidar();
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

  async pdf(v: Viaje) {
    try { await this.api.descargar(`/reportes/manifiesto/${v._id}`, {}, `Manifiesto_${v.manifiesto.numero}.pdf`); } catch (e) { this.avisos.error(e); }
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

  async cumplir() {
    const v = this.cumplirViaje();
    if (!v) return;
    const c = this.cumplido();
    const limpio = (o: any) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== ''));
    const r = await this.conClave(cl => this.api.post<any>(`/rndc/viajes/${v._id}/cumplir`, { clave: cl, remesa: limpio(c.remesa), manifiesto: limpio(c.manifiesto) }));
    if (!r) return;
    if (r.cumplidoManifiesto?.estado === 'aceptado') { this.avisos.ok(`Viaje ${v.numero} cumplido en el RNDC`); this.cumplirViaje.set(null); }
    else this.avisos.mostrar(r.cumplidoManifiesto?.mensaje || r.cumplidoRemesa?.mensaje || 'El RNDC rechazó el cumplido', 'error');
    this.cargar();
  }

  documentosAnulables(): [string, string][] {
    const v = this.anularViaje();
    if (!v) return [];
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
    const r = await this.conClave(c => this.api.post<any>(`/rndc/viajes/${v._id}/anular`, { clave: c, ...this.anulacion() }));
    if (!r) return;
    if (r.ok) { this.avisos.ok(`Anulación aceptada (radicado ${r.radicado})`); this.anularViaje.set(null); }
    else if (r.manifiesto?.ok) { this.anularViaje.set(null); this.avisos.mostrar(r.mensaje, 'error'); }
    else { this.revisarClave([r.mensaje]); this.avisos.mostrar(`El RNDC rechazó la anulación: ${r.mensaje}`, 'error'); }
    this.cargar();
  }
}
