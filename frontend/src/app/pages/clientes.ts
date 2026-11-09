import { Turno } from '../core/turno';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P, TIPOS_ID } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { SelectorMunicipio } from '../shared/municipio';
import { FORMATOS } from '../shared/formato';
import { ImportarExcel } from '../shared/importar-excel';
import { Moneda } from '../shared/moneda';
import { filtrar } from '../shared/filtro';
import { Confirmar } from '../shared/confirmar';
import { ListaBuscable, OpcionBuscable } from '../shared/lista-buscable';
import { RndcClave } from '../core/rndc-clave.service';

const clienteVacio = () => ({ nombre: '', tipoId: 'N', nit: '', dv: '', razonSocial: '', sedeRemitente: '', correos: '', whatsapp: '', activo: true,
  siglas: '', politicaAuxiliar: 'registrado', valorAuxiliarSinAnticipo: 30000, seguros: false });
// Cómo se le cobra el auxiliar al cliente (RN-15)
const POLITICAS: [string, string][] = [['registrado', 'Se cobra lo registrado en el viaje'], ['sin', 'Sin auxiliar (no se cobra)'],
  ['incluido', 'Incluido en la tarifa (no se cobra aparte)'], ['sin_anticipo', 'Valor fijo por viaje sin anticipo']];
const tarifaVacia = () => ({ destino: '', codMunicipio: '', tipoCobro: 'viaje', tarifaCliente: 0, tarifaAuxiliar: 0, fleteConductor: 0,
  auxiliarPagado: 0, anticipoHabitual: 0, pesoKg: 0, operacion: '', destinatario: { tipoId: '', numId: '', sede: '' }, activo: true, grupoRelacion: '' });
const sedeVacia = () => ({ nombre: '', direccion: '', codMunicipio: '' });
const NUEVA = '__nueva';
const CARGUE = '__cargue';
// Sedes en orden de número de código (1, 2, … 14, 15, … 140), no alfabético
const ordenarSedes = (l: any[]) => [...l].sort((a, b) => String(a.sede.codigo).localeCompare(String(b.sede.codigo), 'es', { numeric: true }));
const textoSede = (x: any): OpcionBuscable => ({ valor: String(x.sede.codigo), texto: `${x.sede.codigo} · ${x.sede.nombre || '(sin nombre)'}${x.direccion ? ' — ' + x.direccion : ''}` });
const digitos = (v: any) => String(v ?? '').replace(/\D/g, '');
// Documento con el que el cliente está registrado como tercero en el RNDC (NIT + DV)
const idCliente = (c: any) => c?.tipoId === 'N' ? digitos(c.nit) + digitos(c.dv) : digitos(c?.nit);

@Component({
  selector: 'app-clientes',
  imports: [FormsModule, Modal, Icono, SelectorMunicipio, ImportarExcel, Moneda, Confirmar, ListaBuscable, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Clientes y tarifas</h1><p class="sutil">Cada cliente es una empresa remitente con sus sedes; cada destino es la sede donde se descarga, con su tarifa, flete y anticipo.</p></div>
      <div class="acciones">
        @if (puedeTarifas) { <button (click)="importar.set(true)"><app-icono nombre="descargar" />Importar Excel</button> }
        @if (puedeEditar) { <button class="primario" (click)="nuevoCliente()"><app-icono nombre="mas" />Nuevo cliente</button> }
      </div>
    </div>
    <app-importar-excel tipo="tarifas" titulo="clientes y tarifas" [abierto]="importar()" (cerrar)="importar.set(false)" (importado)="cargar()" />
    <div class="columnas">
      <div class="tabla-caja lista">
        <div class="filtro-rapido"><input type="search" placeholder="Buscar cliente o NIT" aria-label="Buscar cliente o NIT" [value]="qCli()" (input)="qCli.set($any($event.target).value)" /></div>
        <ul class="clientes">@for (c of clientesVisibles(); track c._id) {
          <li><button type="button" [class.activo]="c._id === sel()?._id" (click)="elegir(c)">
            <strong>{{ c.nombre }}</strong>@if (!c.activo) { <span class="chip">inactivo</span> }
            <small>{{ c.tipoId }} {{ c.nit }}{{ c.dv ? '-' + c.dv : '' }} · {{ destinosDe(c) }} destino{{ destinosDe(c) === 1 ? '' : 's' }}</small>
          </button></li>
        } @empty { <li class="vacio">Sin clientes</li> }</ul>
      </div>
      <div class="detalle">
        @if (sel(); as c) {
          <div class="tarjeta">
            <div class="cab-cliente">
              <div class="min0"><h2>{{ c.nombre }}</h2>
                <span class="sutil">{{ c.razonSocial || c.nombre }} · {{ c.tipoId }} {{ c.nit }}{{ c.dv ? '-' + c.dv : '' }}</span>
                <div class="cargue"><app-icono nombre="ubicacion" [tam]="15" />Carga en:
                  @if (sedeCargue(); as s) { <strong>{{ s.sede.nombre || 'Sede ' + s.sede.codigo }}</strong> <span class="sutil">{{ s.direccion }}</span> }
                  @else if (c.sedeRemitente) { <strong>Sede {{ c.sedeRemitente }}</strong> }
                  @else { <span class="sutil">sin sede de cargue</span> }</div>
              </div>
              <div class="acciones">@if (puedeEditar) { <button class="pequeno" (click)="editarCliente(c)"><app-icono nombre="editar" [tam]="15" />Editar</button>
                  <button class="pequeno peligro" confirmar="Clic otra vez para eliminar" (confirmado)="eliminarCliente(c)" title="Eliminar el cliente y sus destinos (solo si no tiene viajes)">Eliminar</button> }</div>
            </div>

            <div class="pestanas">
              <button [class.activa]="pestana() === 'destinos'" (click)="pestana.set('destinos')">Destinos y tarifas<span class="chip sin-punto">{{ tarifasSel().length }}</span></button>
              <button [class.activa]="pestana() === 'sedes'" (click)="pestana.set('sedes')">Sedes<span class="chip sin-punto">{{ sedesCliente().length }}</span></button>
            </div>

            @if (pestana() === 'destinos') {
              <div class="barra-detalle">
                <div class="filtro-rapido"><input type="search" placeholder="Buscar destino, sede o municipio" aria-label="Buscar destino" [value]="qTar()" (input)="qTar.set($any($event.target).value)" /></div>
                @if (puedeTarifas) { <button class="primario pequeno" (click)="nuevaTarifa()"><app-icono nombre="mas" [tam]="15" />Nuevo destino</button> }
              </div>
              <table class="tabla-movil destinos"><thead><tr><th>Destino</th><th>Se descarga en</th><th class="num">Tarifa / flete</th><th class="num">Anticipo</th><th class="num">Auxiliar</th><th></th></tr></thead>
                <tbody>@for (t of tarifasVisibles(); track t._id) {
                  <tr [class.sutil]="!t.activo">
                    <td data-etiqueta="Destino"><strong>{{ t.destino }}</strong>@if (t.tipoCobro === 'unidad') { <span class="chip info">por unidad</span> }
                      @if (!t.activo) { <span class="chip">inactivo</span> }<small class="d-bloque sutil">Mpio. {{ t.codMunicipio || '—' }}</small></td>
                    <td data-etiqueta="Se descarga en">@if (t.destinatario?.sede) {
                        <span class="chip sin-punto">{{ t.sedeNombre || 'Sede ' + t.destinatario.sede }}</span>
                        <small class="d-bloque sutil">{{ esDelCliente(t) ? 'Sede del cliente' : (t.destinatarioNombre || t.destinatario.tipoId + ' ' + t.destinatario.numId) }}{{ t.sedeDireccion ? ' · ' + t.sedeDireccion : '' }}</small>
                      } @else if (t.sedeAuto) {
                        <span class="chip sin-punto">{{ t.sedeAuto.codigo }} · {{ t.sedeAuto.nombre || 'Sede ' + t.sedeAuto.codigo }}</span>
                        <small class="d-bloque sutil">Sede del municipio de destino{{ t.sedeAuto.direccion ? ' · ' + t.sedeAuto.direccion : '' }}</small>
                      } @else { <span class="sutil">Sede de cargue</span><small class="d-bloque sutil">{{ t.codMunicipio ? 'El cliente no tiene sede en el municipio de destino' : 'Sin municipio de destino' }}</small> }</td>
                    <td class="num" data-etiqueta="Tarifa / flete">{{ t.tarifaCliente | pesos }}<small class="d-bloque sutil">{{ t.fleteConductor | pesos }}</small></td>
                    <td class="num" data-etiqueta="Anticipo">{{ t.anticipoHabitual | pesos }}</td>
                    <td class="num" data-etiqueta="Auxiliar">{{ t.tarifaAuxiliar | pesos }}<small class="d-bloque sutil">paga {{ t.auxiliarPagado | pesos }}</small></td>
                    <td class="celda-acciones">@if (puedeTarifas) { <div class="acciones acciones-fila"><button class="pequeno" (click)="editarTarifa(t)">Editar</button>
                      <button class="pequeno peligro" confirmar="¿Eliminar?" (confirmado)="eliminarTarifa(t)" [title]="'Eliminar el destino ' + t.destino">Eliminar</button></div> }</td></tr>
                } @empty { <tr><td colspan="6" class="vacio">Sin destinos. Agregue los destinos habituales con su tarifa.</td></tr> }</tbody></table>
            } @else {
              <div class="barra-detalle">
                <p class="sutil">Sedes de {{ c.razonSocial || c.nombre }} registradas como tercero ({{ numIdCliente() || idCli(c) }}). La de cargue va en el manifiesto como remitente.</p>
                @if (puedeTarifas) { <button class="primario pequeno" (click)="nuevaSede()"><app-icono nombre="mas" [tam]="15" />Nueva sede</button> }
              </div>
              <table class="tabla-movil"><thead><tr><th>Sede</th><th>Dirección</th><th>Municipio</th><th>RNDC</th><th></th></tr></thead>
                <tbody>@for (s of sedesCliente(); track s._id) {
                  <tr><td data-etiqueta="Sede"><strong>{{ s.sede.codigo }} · {{ s.sede.nombre || '(sin nombre)' }}</strong>
                      @if (String(s.sede.codigo) === String(c.sedeRemitente)) { <span class="chip ok">cargue</span> }</td>
                    <td data-etiqueta="Dirección">{{ s.direccion || '—' }}</td>
                    <td data-etiqueta="Municipio">{{ s.codMunicipio || '—' }}</td>
                    <td data-etiqueta="RNDC">@switch (s.rndc?.estado) { @case ('enviado') { <span class="chip ok">registrada</span> } @case ('error') { <span class="chip error" [title]="s.rndc?.mensaje || ''">rechazada</span> } @default { <span class="chip">pendiente</span> } }</td>
                    <td class="celda-acciones"><div class="acciones acciones-fila">
                      @if (puedeRndc && s.rndc?.estado !== 'enviado') { <button class="pequeno primario" [disabled]="enviando()" (click)="enviarSedes([s])">Enviar al RNDC</button> }
                      @if (puedeEditar && String(s.sede.codigo) !== String(c.sedeRemitente)) { <button class="pequeno" (click)="usarDeCargue(c, s)">Usar de cargue</button> }</div></td></tr>
                } @empty { <tr><td colspan="5" class="vacio">El cliente aún no tiene sedes. Cree la sede donde se carga.</td></tr> }</tbody></table>
            }
          </div>
        } @else { <div class="tarjeta vacio">Seleccione un cliente para ver sus destinos y sedes.</div> }
      </div>
    </div>

    <app-modal [titulo]="clienteForm()._id ? 'Editar cliente' : 'Nuevo cliente'" [abierto]="abiertoCliente()" (cerrar)="abiertoCliente.set(false)">
      @let f = clienteForm();
      <form id="form-cliente" class="formulario" (ngSubmit)="guardarCliente()">
        <p class="ancho nota-rndc"><span class="marca-rndc">RNDC</span> Los campos marcados se envían al RNDC; los demás son internos de la empresa.</p>
        <div class="campo ancho"><label for="cn">Nombre corto</label><input id="cn" name="nombre" [(ngModel)]="f.nombre" required /></div>
        <div class="campo ancho va-rndc"><label for="crs">Razón social</label><input id="crs" name="rs" [(ngModel)]="f.razonSocial" /></div>
        <div class="campo va-rndc"><label for="ct">Tipo de documento</label><select id="ct" name="tipo" [(ngModel)]="f.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
        <div class="campo va-rndc"><label for="cnit">Número (sin DV)</label><input id="cnit" name="nit" [(ngModel)]="f.nit" /></div>
        <div class="campo va-rndc"><label for="cdv">DV</label><input id="cdv" name="dv" maxlength="1" [(ngModel)]="f.dv" /></div>
        @if (!f._id) {
          <fieldset class="ancho"><legend>Sede principal (donde se carga)</legend><div class="formulario">
            <div class="campo va-rndc"><label for="csn">Nombre de la sede</label><input id="csn" name="csn" maxlength="20" placeholder="PRINCIPAL" [(ngModel)]="sedeCliente().nombre" /></div>
            <div class="campo va-rndc"><label for="csd">Dirección</label><input id="csd" name="csd" maxlength="60" [(ngModel)]="sedeCliente().direccion" /></div>
            <app-municipio class="va-rndc" etiqueta="Municipio" [(codigo)]="sedeCliente().codMunicipio" />
            <small class="ancho sutil">Si el NIT ya está registrado como tercero se usan sus sedes; si no, se crea esta sede para el RNDC.</small>
          </div></fieldset>
        } @else {
          <div class="campo ancho"><label for="cs">Sede de cargue</label>
            @if (sedesCliente().length && f._id === sel()?._id) {
              <app-lista-buscable idCampo="cs" [opciones]="opcionesCargue(f.sedeRemitente)" [(valor)]="f.sedeRemitente" placeholder="Sin sede" />
            } @else {
              <input id="cs" name="sede" maxlength="6" [(ngModel)]="f.sedeRemitente" />
              <small>Código de la sede en el RNDC. Cree las sedes en la pestaña Sedes del cliente.</small>
            }</div>
        }
        <div class="campo"><label for="csig">Siglas</label><input id="csig" name="siglas" maxlength="6" [(ngModel)]="f.siglas" style="text-transform:uppercase" placeholder="COR" />
          <small>Numeran las liquidaciones de conductores de este cliente (COR-0001).</small></div>
        <div class="campo"><label for="cpol">Auxiliar en la factura</label>
          <select id="cpol" name="pol" [(ngModel)]="f.politicaAuxiliar">@for (x of politicas; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
        @if (f.politicaAuxiliar === 'sin_anticipo') {
          <div class="campo"><label for="cvaux">Valor por viaje sin anticipo</label><div class="moneda"><input id="cvaux" moneda name="vaux" [(ngModel)]="f.valorAuxiliarSinAnticipo" /></div></div>
        }
        <label class="casilla ancho"><input type="checkbox" name="seguros" [(ngModel)]="f.seguros" />Maneja seguros: sus viajes se pueden marcar como «seguro» y el manifiesto se anula al día siguiente antes de las 9:00 a. m.</label>
        @if (f._id) { <label class="casilla"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
      </form>
      <ng-container pie><button type="button" (click)="abiertoCliente.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-cliente">Guardar</button></ng-container>
    </app-modal>

    <app-modal [titulo]="tarifaForm()._id ? 'Editar destino' : 'Nuevo destino'" [abierto]="abiertoTarifa()" (cerrar)="abiertoTarifa.set(false)" [ancho]="true">
      @let t = tarifaForm();
      <form id="form-tarifa" class="formulario" (ngSubmit)="guardarTarifa()">
        <p class="ancho nota-rndc"><span class="marca-rndc">RNDC</span> Los campos marcados se envían al RNDC; los demás son internos de la empresa.</p>
        <fieldset class="ancho"><legend>¿Dónde se descarga?</legend><div class="formulario">
          <div class="campo ancho"><div class="segmentos" role="group" aria-label="Dónde se descarga">
            <button type="button" [class.activo]="modo() === 'cliente'" (click)="cambiarModo('cliente')">En una sede del cliente</button>
            <button type="button" [class.activo]="modo() === 'otra'" (click)="cambiarModo('otra')">En otra empresa</button>
          </div></div>
          @if (modo() === 'otra') {
            <div class="campo va-rndc"><label for="dt">Tipo</label><select id="dt" name="dt" [(ngModel)]="t.destinatario.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
            <div class="campo va-rndc"><label for="dn">NIT o cédula (con DV)</label><input id="dn" name="dn" [(ngModel)]="t.destinatario.numId" (change)="cargarSedes()" placeholder="900123456" /></div>
            @if (empresaDestino(); as e) { <div class="campo"><label>Empresa</label><div class="dato-fijo">{{ e }}</div></div> }
            @else if (digitos(t.destinatario.numId).length >= 5) {
              <div class="campo va-rndc"><label for="dne">Nombre de la empresa</label><input id="dne" name="dne" maxlength="100" [(ngModel)]="sedeForm().nombreEmpresa" /><small>No está registrada; se crea con esta sede.</small></div>
            }
          }
          @if (modo() === 'cliente' || digitos(t.destinatario.numId).length >= 5) {
            <div class="campo ancho va-rndc"><label for="ds">Sede de descargue</label>
              <app-lista-buscable idCampo="ds" [opciones]="opcionesDescargue()" [valor]="t.destinatario.sede" (cambio)="elegirSede($event)"
                [placeholder]="modo() === 'cliente' ? 'Sede del municipio de destino' : 'Elija la sede'" />
              @if (modo() === 'cliente' && !t.destinatario.sede) {
                @if (sedeAutoDe(t.codMunicipio); as a) { <small>Se usará la sede {{ a.sede.codigo }} · {{ a.sede.nombre || '(sin nombre)' }}{{ a.direccion ? ' — ' + a.direccion : '' }}. Si cambia el municipio de destino, cambia la sede.</small> }
                @else { <small>{{ t.codMunicipio ? 'El cliente no tiene sede en ese municipio: irá la sede de cargue. Cree la sede si la necesita.' : 'Elija el municipio de destino para tomar su sede.' }}</small> }
              }</div>
            @if (t.destinatario.sede === NUEVA) {
              <div class="campo va-rndc"><label for="nsn">Nombre de la sede</label><input id="nsn" name="nsn" maxlength="20" [(ngModel)]="sedeForm().nombre" placeholder="BODEGA NORTE" /></div>
              <div class="campo va-rndc"><label for="nsd">Dirección</label><input id="nsd" name="nsd" maxlength="60" [(ngModel)]="sedeForm().direccion" /></div>
              <app-municipio class="va-rndc" etiqueta="Municipio de la sede" [codigo]="sedeForm().codMunicipio" (codigoChange)="municipioSede($event)" />
            }
          }
        </div></fieldset>
        <div class="campo"><label for="td">Nombre del destino</label><input id="td" name="destino" [(ngModel)]="t.destino" required placeholder="Ej. PASTO - BODEGA NORTE" /></div>
        @if (abiertoTarifa()) { <app-municipio class="va-rndc" etiqueta="Municipio de destino" [(codigo)]="t.codMunicipio" /> }
        <div class="campo"><label for="tc">Cobro</label><select id="tc" name="cobro" [(ngModel)]="t.tipoCobro"><option value="viaje">Por viaje</option><option value="unidad">Por unidad (× cantidad)</option></select></div>
        <div class="campo"><label for="tt">Tarifa al cliente</label><div class="moneda"><input id="tt" moneda name="tc2" [(ngModel)]="t.tarifaCliente" /></div></div>
        <div class="campo"><label for="tf">Flete al conductor</label><div class="moneda"><input id="tf" moneda name="tf" [(ngModel)]="t.fleteConductor" /></div></div>
        <div class="campo"><label for="ta">Anticipo habitual</label><div class="moneda"><input id="ta" moneda name="ta" [(ngModel)]="t.anticipoHabitual" /></div></div>
        <div class="campo"><label for="tac">Auxiliar: cobro al cliente</label><div class="moneda"><input id="tac" moneda name="tac" [(ngModel)]="t.tarifaAuxiliar" /></div></div>
        <div class="campo"><label for="tap">Auxiliar: pago</label><div class="moneda"><input id="tap" moneda name="tap" [(ngModel)]="t.auxiliarPagado" /></div></div>
        <div class="campo"><label for="tp">Peso habitual (kg)</label><input id="tp" type="number" min="0" name="tp" [(ngModel)]="t.pesoKg" /></div>
        <div class="campo"><label for="to">Tipo de manifiesto</label><select id="to" name="op" [(ngModel)]="t.operacion"><option value="">El de la empresa</option><option value="G">General</option><option value="W">Viaje vacío</option><option value="D">Varios viajes en el día</option><option value="I">Viaje de ida y regreso</option><option value="M">Viaje multiparada</option><option value="U">Viaje municipal o urbano</option></select>
          <small>Con origen y destino en el mismo municipio sale como municipal o urbano.</small></div>
        <div class="campo"><label for="tgr">Grupo de la relación de cobro</label><input id="tgr" name="tgr" maxlength="30" list="grupos-rel" [(ngModel)]="t.grupoRelacion" placeholder="Ej.: Viajeros o TAT" />
          <datalist id="grupos-rel"><option value="Viajeros"></option><option value="TAT"></option></datalist>
          <small>Para sacar relaciones separadas por grupo. Vacío = sin grupo.</small></div>
        @if (t._id) { <label class="casilla"><input type="checkbox" name="activo" [(ngModel)]="t.activo" />Activo</label> }
      </form>
      <ng-container pie><button type="button" (click)="abiertoTarifa.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-tarifa">Guardar</button></ng-container>
    </app-modal>

    <app-modal titulo="Nueva sede del cliente" [abierto]="abiertoSede()" (cerrar)="abiertoSede.set(false)">
      <form id="form-sede" class="formulario" (ngSubmit)="guardarSede()">
        <p class="ancho nota-rndc"><span class="marca-rndc">RNDC</span> Los campos marcados se envían al RNDC; los demás son internos de la empresa.</p>
        <div class="campo va-rndc"><label for="ssn">Nombre de la sede</label><input id="ssn" name="ssn" maxlength="20" [(ngModel)]="sedeForm().nombre" placeholder="BODEGA NORTE" /></div>
        <div class="campo va-rndc"><label for="ssd">Dirección</label><input id="ssd" name="ssd" maxlength="60" [(ngModel)]="sedeForm().direccion" required /></div>
        @if (abiertoSede()) { <app-municipio class="va-rndc" etiqueta="Municipio" [(codigo)]="sedeForm().codMunicipio" /> }
      </form>
      <ng-container pie><button type="button" (click)="abiertoSede.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-sede">Crear sede</button></ng-container>
    </app-modal>`,
  styles: [`.nota-rndc { margin: 0; font-size: 13px; color: var(--gris-6); display: flex; gap: 8px; align-items: center; }
    .marca-rndc, :host ::ng-deep .va-rndc label::after { display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: .04em; line-height: 1;
      padding: 3px 6px; border-radius: 999px; background: var(--azul-claro); color: var(--azul); vertical-align: middle; }
    :host ::ng-deep .va-rndc label::after { content: 'RNDC'; margin-left: 6px; }
    .d-bloque { display: block; }
    .min0 { min-width: 0; }
    .columnas { display: grid; grid-template-columns: minmax(220px, 290px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .detalle { min-width: 0; }
    .lista { position: sticky; top: 12px; max-height: calc(100vh - 140px); overflow-y: auto; overflow-x: hidden; }
    .clientes { list-style: none; margin: 0; padding: 4px; }
    .clientes li.vacio { padding: 16px; text-align: center; color: var(--gris-5); }
    .clientes button { display: block; width: 100%; text-align: left; border: 0; background: none; border-radius: 8px; padding: 9px 12px; min-height: 0; font-weight: 400; }
    .clientes button:hover { background: var(--gris-15); }
    .clientes button.activo { background: var(--primario-claro); box-shadow: inset 4px 0 0 var(--primario); }
    .clientes strong { overflow-wrap: anywhere; }
    .clientes small { display: block; color: var(--gris-5); font-size: 12px; }
    .cab-cliente { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; margin-bottom: 12px; }
    .cab-cliente h2 { margin: 0 0 2px; overflow-wrap: anywhere; }
    .cargue { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; font-size: 13px; }
    .barra-detalle { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 10px; }
    .barra-detalle .filtro-rapido { flex: 1 1 220px; margin: 0; padding: 0; }
    .barra-detalle p { margin: 0; flex: 1 1 260px; font-size: 13px; }
    table { width: 100%; table-layout: auto; }
    td { overflow-wrap: anywhere; vertical-align: top; }
    .acciones-fila { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: nowrap; }
    .celda-acciones { width: 1%; white-space: nowrap; }
    .dato-fijo { padding: 9px 0; font-weight: 650; }
    @media (max-width: 1100px) { table.destinos th:nth-child(4), table.destinos td:nth-child(4) { display: none; } }
    @media (max-width: 900px) { .columnas { grid-template-columns: minmax(0, 1fr); } .lista { position: static; max-height: 260px; }
      table.destinos th:nth-child(4), table.destinos td:nth-child(4) { display: revert; } }`],
})
export class Clientes {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeEditar = this.auth.tiene(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);
  readonly puedeTarifas = this.auth.tiene(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);
  readonly puedeRndc = this.auth.tiene(P.RNDC_OPERAR);
  private clave = inject(RndcClave);
  readonly enviando = signal(false);
  readonly tipos = Object.entries(TIPOS_ID);
  readonly NUEVA = NUEVA;
  readonly String = String;
  readonly digitos = digitos;
  readonly idCli = idCliente;
  readonly clientes = signal<any[]>([]);
  readonly tarifas = signal<any[]>([]);
  readonly sel = signal<any>(null);
  readonly pestana = signal<'destinos' | 'sedes'>('destinos');
  readonly qCli = signal('');
  readonly qTar = signal('');
  readonly clientesVisibles = computed(() => filtrar(this.clientes(), this.qCli()));
  readonly tarifasVisibles = computed(() => filtrar(this.tarifasSel(), this.qTar()));
  readonly tarifasSel = computed(() => this.tarifas().filter(t => (t.cliente?._id || t.cliente) === this.sel()?._id));
  readonly abiertoCliente = signal(false);
  readonly importar = signal(false);
  readonly abiertoTarifa = signal(false);
  readonly abiertoSede = signal(false);
  readonly clienteForm = signal<any>(clienteVacio());
  readonly tarifaForm = signal<any>(tarifaVacia());
  readonly sedeCliente = signal<any>(sedeVacia());
  readonly sedeForm = signal<any>({ ...sedeVacia(), nombreEmpresa: '' });

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['maestros'], () => this.cargar());

  constructor() { this.cargar(); }

  async cargar() {
    try {
      const [c, t] = await Promise.all([this.api.get<any[]>('/maestros/clientes'), this.api.get<any[]>('/maestros/tarifas')]);
      this.clientes.set(c); this.tarifas.set(t);
      const actual = this.sel();
      this.sel.set(actual ? c.find(x => x._id === actual._id) || null : c[0] || null);
    } catch (e) { this.avisos.error(e); }
  }

  elegir(c: any) { if (c._id !== this.sel()?._id) { this.sedesCliente.set([]); this.numIdCliente.set(''); } this.sel.set(c); this.qTar.set(''); }
  destinosDe(c: any) { return this.tarifas().filter(t => (t.cliente?._id || t.cliente) === c._id).length; }

  readonly politicas = POLITICAS;
  nuevoCliente() { this.clienteForm.set(clienteVacio()); this.sedeCliente.set(sedeVacia()); this.abiertoCliente.set(true); }
  editarCliente(c: any) { this.clienteForm.set({ ...clienteVacio(), ...c, correos: (c.correos || []).join(', ') }); this.abiertoCliente.set(true); }

  // Sedes del cliente seleccionado: es el mismo remitente registrado como tercero (con NIT+DV o solo NIT)
  readonly sedesCliente = signal<any[]>([]);
  readonly numIdCliente = signal('');
  private sedesDe = effect(() => { this.cargarSedesCliente(this.sel()); });
  private turnoSedes = new Turno();
  async cargarSedesCliente(c: any) {
    const vigente = this.turnoSedes.tomar();
    const nit = digitos(c?.nit);
    if (!nit) { this.sedesCliente.set([]); this.numIdCliente.set(''); return; }
    for (const numId of [...new Set([idCliente(c), nit])]) {
      try {
        const l = (await this.api.get<any>('/maestros/terceros/sedes', { numId })).sedes.filter((x: any) => x.sede?.codigo);
        if (!vigente()) return;
        if (l.length) { this.sedesCliente.set(ordenarSedes(l)); this.numIdCliente.set(numId); return; }
      } catch { /* sin sedes */ }
    }
    if (!vigente()) return;
    this.sedesCliente.set([]); this.numIdCliente.set('');
  }
  // Opciones de las listas con búsqueda (ya ordenadas por código de sede)
  opcionesCargue(actual: string): OpcionBuscable[] {
    const l: OpcionBuscable[] = [{ valor: '', texto: 'Sin sede' }];
    if (actual && !this.existeSede(actual)) l.push({ valor: String(actual), texto: `${actual} · (no registrada en la plataforma)` });
    return [...l, ...this.sedesCliente().map(textoSede)];
  }
  readonly opcionesDescargue = computed<OpcionBuscable[]>(() => [
    ...(this.modo() === 'cliente' ? [{ valor: '', texto: 'Sede del municipio de destino (automática)' },
      ...(this.sel()?.sedeRemitente ? [{ valor: CARGUE, texto: `La misma sede de cargue (sede ${this.sel().sedeRemitente})` }] : [])] : []),
    ...this.sedesDestinatario().map(textoSede),
    ...(this.puedeTarifas ? [{ valor: NUEVA, texto: '+ Crear una sede nueva…', extra: true }] : []),
  ]);
  existeSede(cod: string) { return this.sedesCliente().some(x => x.sede.codigo === String(cod)); }
  readonly sedeCargue = computed(() => this.sedesCliente().find(x => String(x.sede.codigo) === String(this.sel()?.sedeRemitente || '')) || null);
  // El destino es una sede del mismo cliente (sin destinatario o con su mismo documento)
  esDelCliente(t: any) {
    const n = digitos(t.destinatario?.numId); const c = this.sel();
    return !n || n === idCliente(c) || n === digitos(c?.nit);
  }

  async guardarCliente() {
    const f = this.clienteForm();
    const cuerpo: any = { nombre: f.nombre, tipoId: f.tipoId, nit: f.nit, dv: f.dv, razonSocial: f.razonSocial, sedeRemitente: f.sedeRemitente,
      correos: String(f.correos || '').split(',').map((s: string) => s.trim()).filter(Boolean), whatsapp: f.whatsapp || '', activo: f.activo,
      siglas: String(f.siglas || '').toUpperCase(), politicaAuxiliar: f.politicaAuxiliar || 'registrado', valorAuxiliarSinAnticipo: Number(f.valorAuxiliarSinAnticipo) || 0, seguros: !!f.seguros };
    const s = this.sedeCliente();
    if (!f._id && (s.direccion || s.codMunicipio)) cuerpo.sede = s;
    try {
      const r: any = f._id ? await this.api.put(`/maestros/clientes/${f._id}`, cuerpo) : await this.api.post('/maestros/clientes', cuerpo);
      this.avisos.ok('Cliente guardado'); this.abiertoCliente.set(false);
      this.sel.set(r); await this.cargar();
      if (!f._id) { await this.cargarSedesCliente(this.sel()); await this.enviarPendientes(this.sedesCliente()); }
    } catch (e) { this.avisos.error(e); }
  }

  // Al RNDC solo van las sedes (empresa + sede, proceso 11); tarifas y demás datos del cliente son internos
  private async enviarPendientes(sedes: any[]) {
    const p = sedes.filter(s => s.rndc?.estado !== 'enviado');
    if (p.length && this.puedeRndc) await this.enviarSedes(p);
  }
  async enviarSedes(sedes: any[]) {
    const c = await this.clave.obtener();
    if (!c) return;
    this.enviando.set(true);
    try {
      for (const s of sedes) {
        const nombre = `sede ${s.sede?.codigo} · ${s.sede?.nombre || ''}`;
        try {
          const r = await this.api.post<any>(`/rndc/terceros/${s._id}/enviar`, { clave: c });
          if (r.sinCambios) this.avisos.mostrar(r.mensaje, 'info');
          else if (r.ok) this.avisos.ok(`La ${nombre} quedó registrada en el RNDC`);
          else this.avisos.mostrar(`El RNDC rechazó la ${nombre}: ${r.mensaje}`, 'error', 9000);
        } catch (e) { this.avisos.error(e); }
      }
    } finally { this.enviando.set(false); await this.cargarSedesCliente(this.sel()); }
  }

  // Solo se eliminan clientes y destinos sin viajes; con historial el servidor indica que se desactiven
  async eliminarCliente(c: any) {
    try {
      const r: any = await this.api.delete(`/maestros/clientes/${c._id}`);
      this.avisos.ok(`Cliente ${c.nombre} eliminado${r.destinos ? ` con ${r.destinos} destino(s)` : ''}`);
      this.sel.set(null); await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
  async eliminarTarifa(t: any) {
    try {
      await this.api.delete(`/maestros/tarifas/${t._id}`);
      this.avisos.ok(`Destino ${t.destino} eliminado`); await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  // Sedes del cliente: crear y elegir la de cargue
  nuevaSede() { this.sedeForm.set({ ...sedeVacia(), nombreEmpresa: '' }); this.abiertoSede.set(true); }
  async guardarSede() {
    const c = this.sel(); const s = this.sedeForm();
    try {
      const x: any = await this.api.post('/maestros/sedes', { tipoId: c.tipoId, numId: this.numIdCliente() || idCliente(c), nombreEmpresa: c.razonSocial || c.nombre,
        rol: 'remitente', nombre: s.nombre, direccion: s.direccion, codMunicipio: s.codMunicipio });
      if (!c.sedeRemitente) await this.api.put(`/maestros/clientes/${c._id}`, { sedeRemitente: x.sede.codigo });
      this.avisos.ok(`Sede ${x.sede.codigo} · ${x.sede.nombre} creada`); this.abiertoSede.set(false);
      await this.cargar(); await this.cargarSedesCliente(this.sel());
      await this.enviarPendientes([x]);
    } catch (e) { this.avisos.error(e); }
  }
  async usarDeCargue(c: any, s: any) {
    try {
      await this.api.put(`/maestros/clientes/${c._id}`, { sedeRemitente: s.sede.codigo });
      this.avisos.ok(`${c.nombre} carga en ${s.sede.nombre || 'la sede ' + s.sede.codigo}`); await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  // Destinos: el descargue es una sede del cliente o de otra empresa (destinatario)
  readonly modo = signal<'cliente' | 'otra'>('cliente');
  readonly sedesDestinatario = signal<any[]>([]);
  readonly empresaDestino = signal('');
  nuevaTarifa() {
    this.tarifaForm.set(tarifaVacia()); this.modo.set('cliente'); this.sedeForm.set({ ...sedeVacia(), nombreEmpresa: '' });
    this.cargarSedes(); this.abiertoTarifa.set(true);
  }
  editarTarifa(t: any) {
    const b = tarifaVacia();
    this.tarifaForm.set({ ...b, ...t, destinatario: { ...b.destinatario, ...t.destinatario } });
    this.modo.set(this.esDelCliente(t) ? 'cliente' : 'otra'); this.sedeForm.set({ ...sedeVacia(), nombreEmpresa: '' });
    this.cargarSedes(); this.abiertoTarifa.set(true);
  }
  cambiarModo(m: 'cliente' | 'otra') {
    if (this.modo() === m) return;
    this.modo.set(m);
    this.tarifaForm.update(t => ({ ...t, destinatario: { tipoId: m === 'otra' ? 'N' : '', numId: '', sede: '' } }));
    this.cargarSedes();
  }
  async cargarSedes() {
    const doc = this.modo() === 'cliente' ? (this.numIdCliente() || idCliente(this.sel())) : digitos(this.tarifaForm().destinatario?.numId);
    this.empresaDestino.set('');
    if (!doc) { this.sedesDestinatario.set([]); return; }
    try {
      const l = (await this.api.get<any>('/maestros/terceros/sedes', { numId: doc })).sedes;
      this.sedesDestinatario.set(ordenarSedes(l.filter((x: any) => x.sede?.codigo)));
      if (this.modo() === 'otra' && l[0]) this.empresaDestino.set([l[0].nombres, l[0].apellido1].filter(Boolean).join(' '));
    } catch { this.sedesDestinatario.set([]); }
  }
  // Al elegir la sede, el municipio del destino se toma de la sede si aún no tiene uno
  // Sede del cliente en el municipio de destino (la misma regla del servidor al enviar al RNDC)
  sedeAutoDe(codMunicipio: string) {
    const cod = String(codMunicipio || '');
    if (!/^\d{8}$/.test(cod)) return null;
    const rem = String(this.sel()?.sedeRemitente || '');
    return ordenarSedes(this.sedesDestinatario().filter(s => String(s.sede.codigo) !== rem && String(s.codMunicipio || '').startsWith(cod.slice(0, 5))))
      .sort((a, b) => (a.codMunicipio === cod ? 0 : 1) - (b.codMunicipio === cod ? 0 : 1))[0] || null;
  }
  elegirSede(cod: string) {
    if (cod === CARGUE) cod = String(this.sel()?.sedeRemitente || '');
    const s = this.sedesDestinatario().find(x => x.sede.codigo === cod);
    this.tarifaForm.update(t => ({ ...t, destinatario: { ...t.destinatario, sede: cod },
      codMunicipio: t.codMunicipio || s?.codMunicipio || '', destino: t.destino || (s ? s.sede.nombre : '') }));
  }
  municipioSede(cod: string) {
    this.sedeForm.update(s => ({ ...s, codMunicipio: cod }));
    this.tarifaForm.update(t => t.codMunicipio ? t : { ...t, codMunicipio: cod });
  }

  async guardarTarifa() {
    const t = this.tarifaForm(); const c = this.sel();
    const dest = { ...t.destinatario };
    let sedeNueva: any = null;
    try {
      if (this.modo() === 'otra' && (!digitos(dest.numId) || !dest.sede)) throw new Error('Escriba el documento de la empresa y elija la sede de descargue');
      if (dest.sede === NUEVA) {
        const s = this.sedeForm();
        const numId = this.modo() === 'cliente' ? (this.numIdCliente() || idCliente(c)) : digitos(dest.numId);
        const x: any = await this.api.post('/maestros/sedes', { tipoId: this.modo() === 'cliente' ? c.tipoId : (dest.tipoId || 'N'), numId,
          nombreEmpresa: this.modo() === 'cliente' ? (c.razonSocial || c.nombre) : s.nombreEmpresa, rol: 'destinatario',
          nombre: s.nombre, direccion: s.direccion, codMunicipio: s.codMunicipio });
        dest.sede = x.sede.codigo; sedeNueva = x;
      }
      // Sede del cliente: el destinatario es el mismo cliente, con su documento para que el RNDC tome esa sede
      if (this.modo() === 'cliente') Object.assign(dest, dest.sede ? { tipoId: c.tipoId, numId: this.numIdCliente() || idCliente(c) } : { tipoId: '', numId: '' });
      else dest.numId = digitos(dest.numId);
      const campos = ['destino', 'codMunicipio', 'tipoCobro', 'tarifaCliente', 'tarifaAuxiliar', 'fleteConductor', 'auxiliarPagado',
        'anticipoHabitual', 'pesoKg', 'operacion', 'activo', 'grupoRelacion'];
      const cuerpo: any = Object.fromEntries(campos.map(k => [k, t[k]]));
      cuerpo.destinatario = dest; cuerpo.cliente = c._id;
      const g: any = t._id ? await this.api.put(`/maestros/tarifas/${t._id}`, cuerpo) : await this.api.post('/maestros/tarifas', cuerpo);
      this.avisos.ok(g.viajesActualizados ? `Destino guardado: ${g.viajesActualizados} viaje(s) sin documentos vigentes se actualizaron` : 'Destino guardado'); this.abiertoTarifa.set(false);
      await this.cargar(); await this.cargarSedesCliente(this.sel());
      if (sedeNueva) await this.enviarPendientes([sedeNueva]);
    } catch (e) { this.avisos.error(e); }
  }
}
