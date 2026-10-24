import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, mensajeError } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { P, TIPOS_ID } from '../core/modelos';
import { Modal } from './modal';
import { Icono } from './icono';
import { Moneda } from './moneda';
import { SelectorMunicipio } from './municipio';
import { BuscarTercero } from './buscar-tercero';
import { FORMATOS, isoDia } from './formato';
import { Confirmar } from './confirmar';

// Expedición de remesa y manifiesto de un viaje: revisar y corregir los datos,
// enviar al RNDC y, si hay rechazo, ver la respuesta real del RNDC, corregir y reenviar.
@Component({
  selector: 'app-expedir-rndc',
  imports: [FormsModule, Modal, Icono, Moneda, SelectorMunicipio, BuscarTercero, Confirmar, ...FORMATOS],
  template: `
    <app-modal [titulo]="(soloVer() ? 'Viaje N° ' : 'Expedir viaje N° ') + (viaje()?.numero || '')" [abierto]="!!viajeId()" (cerrar)="cerrar.emit()" [ancho]="true">
      @if (previa(); as p) {
        <!-- Estado de los documentos -->
        <div class="estado">
          <span>Cliente: <strong>{{ viaje()?.cliente?.nombre }}</strong></span>
          <span>Remesa: <span class="chip" [class]="chip(p.documentos.remesa.estado)">{{ p.documentos.remesa.numero || 'nueva' }} · {{ p.documentos.remesa.estado || 'sin enviar' }}</span></span>
          <span>Manifiesto: <span class="chip" [class]="chip(p.documentos.manifiesto.estado)">{{ p.documentos.manifiesto.numero || 'nuevo' }} · {{ p.documentos.manifiesto.estado || 'sin enviar' }}</span></span>
          @if (p.reemplazo?.remesa || p.reemplazo?.manifiesto) {
            <span class="chip ok sin-punto" title="El reemplazo conserva el número anulado con «A» (remesa) o «.» (manifiesto)">Reemplazo:
              {{ p.reemplazo.remesa }}{{ p.reemplazo.remesa && p.reemplazo.manifiesto ? ' · ' : '' }}{{ p.reemplazo.manifiesto }}</span>
          }
          @if (p.ambiente !== 'PRODUCCION') { <span class="chip alerta sin-punto">Ambiente {{ p.ambiente === 'SIMULADO' ? 'simulador' : 'de pruebas' }}</span> }
        </div>

        @if (resultado(); as r) { <div class="mensaje" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.texto }}</div> }
        @if (p.ultimoError; as e) {
          <div class="mensaje error respuesta">
            <strong>El RNDC respondió ({{ e.proceso === 3 ? 'remesa' : e.proceso === 4 ? 'manifiesto' : 'proceso ' + e.proceso }}, {{ e.fecha | fechaHora }}):</strong>
            <span>{{ e.mensaje }}</span>
            @if (ayudaError(e.mensaje); as ay) { <div class="que-hacer"><strong>Qué hacer:</strong> {{ ay }}</div> }
            @else { <small>Corrija los datos abajo (o el vehículo / las personas) y vuelva a enviar.</small> }
          </div>
        }
        @if (faltan().length || p.avisos.length) {
          <!-- Un solo bloque con lo que falta y lo que conviene revisar: abierto solo si falta algo obligatorio -->
          <details class="revisar" [class.grave]="faltan().length" [open]="faltan().length > 0">
            <summary>
              @if (faltan().length) { <span class="chip error sin-punto">{{ faltan().length }} dato(s) obligatorio(s) por completar</span> }
              @if (p.avisos.length) { <span class="chip alerta sin-punto">{{ p.avisos.length }} aviso(s)</span> }
              <span class="ver-det">Ver detalle</span>
            </summary>
            @if (faltan().length) { <strong>Faltan según el diccionario del RNDC:</strong><ul>@for (x of faltan(); track x) { <li>{{ x }}</li> }</ul> }
            @if (p.avisos.length) { <strong>Revise:</strong><ul>@for (a of p.avisos; track a) { <li>{{ a }}</li> }</ul> }
          </details>
        }
        @let f = form();
        @if (destinoManifiestoMal()) {
          <!-- MAN354: el municipio de la sede del destinatario no coincide con el que tiene el RNDC -->
          <div class="resolver" role="group" aria-label="Corregir el destino del manifiesto">
            <strong>El destino del manifiesto debe ser el municipio que el RNDC tiene para la sede del destinatario.</strong>
            <span>Se enviará a <strong>{{ p.destinoManifiesto }}</strong>{{ p.destinatario?.nombreSede ? ' (sede ' + p.destinatario.sede + ' ' + p.destinatario.nombreSede + ')' : '' }}.
              Si el RNDC la tiene en otro lugar (por ejemplo un centro poblado como El Plateado), actualice la sede desde el RNDC y reenvíe.</span>
            <div class="opciones">
              @if (p.destinoSugerido; as s) {
                <button type="button" class="primario pequeno" (click)="fijarDestino(s.codigo)" [disabled]="trabajando()">Usar {{ s.codigo }} · {{ s.nombre }}</button>
              }
              <button type="button" class="pequeno" [class.primario]="!p.destinoSugerido" (click)="traerSedes(p.destinatario)" [disabled]="trabajando()">
                <app-icono nombre="enviar" [tam]="14" />Actualizar la sede del destinatario desde el RNDC</button>
            </div>
            <div class="fijar">
              <app-municipio etiqueta="O elija el municipio o centro poblado de destino del manifiesto" [(codigo)]="f.codDestinoManifiesto" />
              <button type="button" class="pequeno" (click)="fijarDestino(f.codDestinoManifiesto)" [disabled]="trabajando() || !f.codDestinoManifiesto">Usar este destino</button>
            </div>
          </div>
        }
        @if (problemaDestino()) {
          <!-- REM019: se resuelve aquí mismo eligiendo quién recibe -->
          <div class="resolver" role="group" aria-label="Elegir quién recibe">
            @if (!p.destinoViaje?.codigo) {
              <strong>El viaje no tiene municipio de destino.</strong>
              <span>Elíjalo en «Destino» (sección Viaje, abajo) y presione «Guardar cambios».</span>
            } @else {
              <strong>¿Quién recibe en {{ p.destinoViaje.nombre || p.destinoViaje.codigo }}?</strong>
              @if (sedesEnDestino().length) {
                <span>Elija la sede de {{ p.cliente?.nombre }} que recibe:</span>
                <div class="opciones">
                  @for (x of sedesEnDestino(); track x.sede) {
                    <button type="button" class="primario pequeno" (click)="usarSede(x.sede)" [disabled]="trabajando()">Sede {{ x.sede }} · {{ x.nombre }}</button>
                  }
                </div>
              } @else {
                <span>{{ p.cliente?.nombre }} no tiene una sede registrada en ese municipio (solo tiene {{ p.sedesCliente?.length || 0 }} sede(s) en la plataforma). Puede:</span>
                <ol>
                  <li><button type="button" class="primario pequeno" (click)="traerSedes(p.cliente)" [disabled]="trabajando()">
                    <app-icono nombre="enviar" [tam]="14" />Buscar las sedes de {{ p.cliente?.nombre }} en el RNDC</button>
                    <small>Trae las sedes que el cliente tenga registradas en el RNDC (pide la contraseña).</small></li>
                  @if (otrasSedes().length) {
                    <li><label for="ex-otra-sede">Usar otra sede del cliente</label>
                      <select id="ex-otra-sede" [ngModel]="''" (ngModelChange)="usarSede($event)" [disabled]="trabajando()">
                        <option value="">Elegir sede…</option>
                        @for (x of otrasSedes(); track x.sede) { <option [value]="x.sede">Sede {{ x.sede }} · {{ x.nombre }} ({{ x.codMunicipio }})</option> }
                      </select>
                      <small>El destino del manifiesto será el municipio de esa sede.</small></li>
                  }
                  <li>O escriba otro destinatario (documento y sede) en «Carga (remesa)», abajo.</li>
                </ol>
              }
            }
          </div>
        }

        <!-- Pestañas: vehículo y personas, remesa y manifiesto por separado; cada una separa lo que se ingresa de lo que va fijo -->
        <div class="pestanas" role="tablist" aria-label="Partes del despacho">
          <button type="button" role="tab" [class.activa]="pestana() === 'remesa'" [attr.aria-selected]="pestana() === 'remesa'" (click)="pestana.set('remesa')">
            Remesa <span class="chip sin-punto mini" [class]="chip(p.documentos.remesa.estado)">{{ p.documentos.remesa.estado || 'sin enviar' }}</span></button>
          <button type="button" role="tab" [class.activa]="pestana() === 'manifiesto'" [attr.aria-selected]="pestana() === 'manifiesto'" (click)="pestana.set('manifiesto')">
            Manifiesto <span class="chip sin-punto mini" [class]="chip(p.documentos.manifiesto.estado)">{{ p.documentos.manifiesto.estado || 'sin enviar' }}</span></button>
          <button type="button" role="tab" [class.activa]="pestana() === 'maestros'" [attr.aria-selected]="pestana() === 'maestros'" (click)="pestana.set('maestros')">
            Vehículo y personas @if (maestrosPendientes()) { <span class="punto-alerta" title="Hay datos por completar o registrar"></span> }</button>
        </div>

        @if (modoVer()) { <div class="mensaje info">Solo consulta: revise la información por pestañas. Para corregir o enviar, presione «Expedir».</div> }
        <form id="form-expedir" (ngSubmit)="enviar()"><fieldset class="sin-marco" [class.solo-ver]="modoVer()" (keydown)="soloLectura($event)" [attr.aria-readonly]="modoVer()">
          <!-- ── Vehículo y personas ── -->
          <section [hidden]="pestana() !== 'maestros'" role="tabpanel">
            <div class="cab-maestros">
              <h3>Deben existir en el RNDC</h3>
              @if (p.verificacionVigente) { <span class="chip ok sin-punto" [title]="'Verificado el ' + (p.verificadoRndc | fechaHora)">Verificado con el RNDC</span> }
              @else { <span class="chip alerta sin-punto">Se verificará con el RNDC al enviar</span> }
              <button type="button" class="pequeno" (click)="verificar(true)" [disabled]="trabajando()" title="Trae del RNDC el vehículo, el conductor, el titular y las sedes del remitente y del destinatario">
                <app-icono nombre="enviar" [tam]="14" />Verificar ahora</button>
            </div>
            @if (verificacion(); as ver) {
              <div class="mensaje verificacion" [class.error]="ver.bloqueantes.length" [class.ok]="!ver.bloqueantes.length && !conCambios(ver)" [class.alerta]="!ver.bloqueantes.length && conCambios(ver)">
                <strong>{{ ver.bloqueantes.length ? 'No se puede enviar todavía:' : conCambios(ver) ? 'Se actualizaron datos desde el RNDC; revíselos y presione enviar de nuevo:' : 'Todo coincide con el RNDC.' }}</strong>
                <ul>
                  @for (b of ver.bloqueantes; track b) { <li>{{ b }}</li> }
                  @for (x of ver.resultados; track x.rol + x.referencia) {
                    @if (x.cambios?.length) { <li>{{ x.rol }} {{ x.referencia }}: {{ x.cambios.join('; ') }}</li> }
                    @if (x.estado === 'error') { <li>{{ x.rol }} {{ x.referencia }}: no se pudo consultar ({{ x.mensaje }})</li> }
                  }
                </ul>
              </div>
            }
            <ul class="maestros">
              @for (m of p.maestros; track m.rol) {
                <li>
                  <span class="rol">{{ m.rol }}</span>
                  <span class="ref">{{ m.referencia }}</span>
                  <span class="chip" [class]="chipMaestro(m.estado)" [title]="m.mensaje || ''">{{ estadoMaestro(m.estado) }}</span>
                  @if (m.faltantes?.length) { <small class="falta">Falta: {{ etiquetas(m.faltantes) }}</small> }
                  @if (m.estado === 'error' && m.mensaje) { <small class="falta">{{ m.mensaje }}</small> }
                  @if (m.id && !m.faltantes?.length) {
                    <button type="button" class="pequeno" [class.primario]="m.estado !== 'enviado'" (click)="registrarMaestro(m)" [disabled]="trabajando()"
                      [title]="m.estado === 'enviado' ? 'Volver a enviarlo al RNDC (si el RNDC dice que no existe)' : 'Registrarlo en el RNDC'">
                      <app-icono nombre="enviar" [tam]="14" />{{ m.estado === 'enviado' ? 'Registrar de nuevo' : 'Registrar en el RNDC' }}</button>
                  }
                  @if (m.estado === 'no_existe' || m.faltantes?.length) { <small>Complételo en {{ m.tipo === 'vehiculo' ? 'Vehículos' : 'Conductores y terceros' }}.</small> }
                </li>
              }
            </ul>
            <fieldset><legend>Se ingresa o corrige</legend><div class="formulario">
              <div class="campo"><label for="ex-placa">Placa</label><input id="ex-placa" name="placa" [(ngModel)]="f.placa" required maxlength="7" style="text-transform:uppercase" /></div>
              @if (conRemolque()) {
                <div class="campo"><label for="ex-rem">Remolque</label><input id="ex-rem" name="remolque" [(ngModel)]="f.remolque" maxlength="7" style="text-transform:uppercase" /></div>
              } @else {
                <div class="campo"><span class="etiqueta">Remolque</span><button type="button" class="pequeno" (click)="mostrarRemolque.set(true)">Agregar remolque</button></div>
              }
              <app-buscar-tercero etiqueta="Conductor" rol="conductor" [(valor)]="f.conductor" />
              <app-buscar-tercero etiqueta="Titular del manifiesto" [(valor)]="f.titular" placeholder="Vacío = el conductor" />
            </div>
            <p class="sutil nota-num">Por defecto el titular es el del vehículo; si no tiene, el conductor. Cámbielo aquí si el RNDC lo rechaza.</p></fieldset>
          </section>

          <!-- ── Remesa ── -->
          <section [hidden]="pestana() !== 'remesa'" role="tabpanel">
            <div class="una-col">
                @if (p.destinatario; as d) {
                  <div class="destinatario" [class.mal]="d.origen === 'cliente'">
                    <span class="etiqueta">Quién recibe</span>
                    <strong>{{ tipoDoc(d.tipoId) }} {{ d.numId }}</strong>
                    <span><span class="chip sin-punto">Sede {{ d.sede || '—' }}</span> {{ d.nombreSede || p.descripciones?.CODSEDEDESTINATARIO || '(sin nombre registrado)' }}</span>
                    <small>{{ origenDestinatario(d.origen) }}{{ d.municipio ? ' · municipio ' + d.municipio : '' }}</small>
                  </div>
                }
                <h3 class="titulo-col">Datos principales</h3>
                <fieldset><legend>Viaje</legend><div class="formulario">
                  <div class="campo"><label for="ex-fecha">Fecha</label><input id="ex-fecha" type="date" name="fecha" [(ngModel)]="f.fecha" [disabled]="p.remesaAceptada" required />
                    @if (p.remesaAceptada) { <small>Fijada por la remesa aceptada.</small> }</div>
                  <app-municipio etiqueta="Origen (cargue)" [(codigo)]="f.codOrigen" />
                  <app-municipio etiqueta="Destino (descargue)" [(codigo)]="f.codDestino" />
                </div></fieldset>
                @if (p.documentos.manifiesto.estado !== 'aceptado') {
                  <fieldset [class.resaltar]="duplicado()"><legend>Número de remesa</legend><div class="formulario">
                    <div class="campo"><label for="ex-nr">N° de remesa</label>
                      <input id="ex-nr" name="nr" maxlength="15" [(ngModel)]="f.numeroRemesa" [disabled]="p.remesaAceptada" style="text-transform:uppercase"
                        [placeholder]="p.remesaAceptada ? p.documentos.remesa.numero : 'Automático: ' + p.numeros?.remesa" />
                      @if (p.remesaAceptada) { <small>Aceptada con este número.</small> }
                      @else { <small>Vacío = numeración automática. Escríbalo solo si el RNDC respondió DUPLICADO.</small> }</div>
                  </div></fieldset>
                }
                @if (!p.remesaAceptada) {
                  <fieldset><legend>Carga y quién recibe</legend><div class="formulario">
                    <div class="campo"><label for="ex-peso">Cantidad cargada (kg)</label><input id="ex-peso" type="number" min="0" name="peso" [(ngModel)]="f.pesoKg" required /></div>
                    @if (p.sedesCliente?.length) {
                      <div class="campo ancho"><label for="ex-sede">Sede del cliente que recibe</label>
                        <select id="ex-sede" name="sedeCli" [ngModel]="sedeElegida()" (ngModelChange)="elegirSede($event)">
                          <option value="">Automático / otro destinatario</option>
                          @for (x of p.sedesCliente; track x.sede) { <option [value]="x.sede">Sede {{ x.sede }} · {{ x.nombre }} ({{ x.codMunicipio }})</option> }
                        </select></div>
                    }
                    <div class="campo"><label for="ex-dt">Otro destinatario</label>
                      <select id="ex-dt" name="dtipo" [(ngModel)]="f.destinatario.tipoId"><option value="">Automático (destino o sede del cliente)</option>@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
                    @if (f.destinatario.tipoId) {
                      <div class="campo"><label for="ex-dn">Documento del destinatario</label><input id="ex-dn" name="dnum" [(ngModel)]="f.destinatario.numId" maxlength="15" /></div>
                      <div class="campo"><label for="ex-ds">Sede del destinatario</label><input id="ex-ds" name="dsede" [(ngModel)]="f.destinatario.sede" maxlength="6" /></div>
                    }
                  </div></fieldset>
                } @else {
                  <p class="mensaje info">La remesa ya fue aceptada por el RNDC: sus datos no se pueden cambiar.</p>
                }
                <div class="todos-datos">
                  <h3 class="titulo-col">Formulario del RNDC <small>· todo se puede corregir; lo cambiado se marca y se guarda con «Guardar cambios»</small></h3>
                  @for (sec of seccionesEdit('remesa'); track sec.titulo) {
                    <details class="seccion" [open]="sec.abierta">
                      <summary><span>{{ sec.titulo }}</span>
                        @if (sec.cambiados) { <span class="chip alerta sin-punto mini">{{ sec.cambiados }} corregido(s)</span> }
                        <small class="resumen">{{ sec.resumen }}</small></summary>
                      <div class="formulario">
                        @for (c of sec.campos; track c.clave) {
                          <div class="campo" [class.cambiado]="c.cambiado">
                            <label [for]="'aj-remesa-' + c.clave">{{ c.etiqueta }}</label>
                            @if (c.opciones) {
                              <select [id]="'aj-remesa-' + c.clave" [name]="'aj-remesa-' + c.clave" [ngModel]="c.valor" (ngModelChange)="ajustar('remesa', c.clave, $event)" [disabled]="p.remesaAceptada || modoVer()">
                                @if (!c.conocido) { <option [value]="c.valor">{{ c.valor || '(vacío)' }}</option> }
                                @for (o of c.opciones; track o[0]) { <option [value]="o[0]">{{ o[1] }}</option> }
                              </select>
                            } @else {
                              <input [id]="'aj-remesa-' + c.clave" [name]="'aj-remesa-' + c.clave" [ngModel]="c.valor" (ngModelChange)="ajustar('remesa', c.clave, $event)" maxlength="250" [disabled]="p.remesaAceptada || modoVer()" />
                            }
                            @if (c.ayuda) { <small class="ayuda">{{ c.ayuda }}</small> }
                            @if (c.cambiado) { <small class="corregido">Antes: {{ c.original || '(vacío)' }} · <button type="button" class="texto" (click)="ajustar('remesa', c.clave, c.original)" [disabled]="p.remesaAceptada || modoVer()">Restaurar</button></small> }
                          </div>
                        }
                      </div>
                    </details>
                  }
                </div>
            </div>
          </section>

          <!-- ── Manifiesto ── -->
          <section [hidden]="pestana() !== 'manifiesto'" role="tabpanel">
            <div class="una-col">
                <h3 class="titulo-col">Datos principales</h3>
                @if (p.documentos.manifiesto.estado !== 'aceptado') {
                  <fieldset [class.resaltar]="duplicado()"><legend>Número de manifiesto</legend><div class="formulario">
                    <div class="campo"><label for="ex-nm">N° de manifiesto</label>
                      <input id="ex-nm" name="nm" maxlength="15" [(ngModel)]="f.numeroManifiesto" style="text-transform:uppercase" [placeholder]="'Automático: ' + p.numeros?.manifiesto" />
                      <small>Vacío = numeración automática. Escríbalo solo si el RNDC respondió DUPLICADO.</small></div>
                  </div></fieldset>
                }
                <fieldset><legend>Valores</legend><div class="formulario">
                  @if (puedeValores) {
                    <div class="campo"><label for="ex-fl">Flete pactado</label><div class="moneda"><input id="ex-fl" moneda name="flete" [(ngModel)]="f.flete" required /></div></div>
                    <div class="campo"><label for="ex-an">Anticipo</label><div class="moneda"><input id="ex-an" moneda name="anticipo" [(ngModel)]="f.anticipo" /></div></div>
                  } @else {
                    <div class="campo"><span class="etiqueta">Flete pactado</span><strong>{{ f.flete | pesos }}</strong></div>
                    <div class="campo"><span class="etiqueta">Anticipo</span><strong>{{ f.anticipo | pesos }}</strong></div>
                  }
                  <div class="campo ancho"><label for="ex-obs">Observaciones</label><input id="ex-obs" name="obs" maxlength="200" [(ngModel)]="f.observaciones" /></div>
                </div></fieldset>
                @if (p.documentos.manifiesto.estado !== 'aceptado') {
                  <!-- Retenciones: las calcula la plataforma, pero se pueden escribir a mano (p. ej. si el RNDC exige otra FOPAT) -->
                  <fieldset><legend>Retenciones del manifiesto</legend><div class="formulario">
                    @for (r of RETENCIONES; track r[0]) {
                      <div class="campo" [class.cambiado]="r[0] in ajustes().manifiesto"><label [for]="'ex-' + r[0]">{{ r[1] }}</label>
                        <div class="moneda"><input [id]="'ex-' + r[0]" moneda [name]="'ret-' + r[0]" [ngModel]="retencion(r[0])" (ngModelChange)="fijarRetencion(r[0], $event)" /></div>
                        @if (r[0] in ajustes().manifiesto) {
                          <small class="corregido">Calculada: {{ retencionBase(r[0]) | pesos }} · <button type="button" class="texto" (click)="ajustar('manifiesto', r[0], baseTexto(r[0]))">Usar la calculada</button></small>
                        } @else { <small>Calculada por la plataforma.</small> }</div>
                    }
                  </div></fieldset>
                }
                @if (p.destinoManifiesto && p.destinatario?.municipio && p.destinatario.municipio !== f.codDestino) {
                  <p class="sutil nota-num">El manifiesto irá al municipio <strong>{{ p.destinoManifiesto }}</strong>, el de la sede del destinatario{{ p.destinatario.nombreSede ? ' (' + p.destinatario.nombreSede + ')' : '' }}, como lo exige el RNDC.</p>
                }
                <details class="seccion"><summary><span>Valores del viaje</span><small class="resumen">retenciones, neto y saldo como los calcula el RNDC</small></summary>
                @if (p.valores; as val) {
                  <table class="valores" aria-label="Valores del viaje como los calcula el RNDC">
                    <tbody>
                      <tr><td>Valor a pagar por el viaje</td><td class="num">{{ val.flete | pesos }}</td></tr>
                      <tr><td>Retención en la fuente</td><td class="num">{{ valoresVista().retefuente | pesos }}</td></tr>
                      <tr><td>Retención ICA</td><td class="num">{{ valoresVista().ica | pesos }}</td></tr>
                      <tr><td>Retención FOPAT (0,1 %){{ val.fopatAplica ? '' : ' · no aplica' }}</td><td class="num">{{ valoresVista().fopat | pesos }}</td></tr>
                      <tr class="total"><td>Neto a pagar</td><td class="num">{{ valoresVista().neto | pesos }}</td></tr>
                      <tr><td>Valor anticipo</td><td class="num">{{ val.anticipo | pesos }}</td></tr>
                      <tr class="total"><td>Saldo por pagar</td><td class="num">{{ valoresVista().saldo | pesos }}</td></tr>
                    </tbody>
                  </table>
                  @if (val.anticipoAjustado) {
                    <p class="nota-valores">El anticipo registrado ({{ val.anticipoRegistrado | pesos }}) supera el neto a pagar: se enviará y guardará como {{ val.anticipo | pesos }}, como lo exige el RNDC.</p>
                  }
                }
                </details>
                <div class="todos-datos">
                  <h3 class="titulo-col">Formulario del RNDC <small>· todo se puede corregir; lo cambiado se marca y se guarda con «Guardar cambios»</small></h3>
                  @for (sec of seccionesEdit('manifiesto'); track sec.titulo) {
                    <details class="seccion" [open]="sec.abierta">
                      <summary><span>{{ sec.titulo }}</span>
                        @if (sec.cambiados) { <span class="chip alerta sin-punto mini">{{ sec.cambiados }} corregido(s)</span> }
                        <small class="resumen">{{ sec.resumen }}</small></summary>
                      <div class="formulario">
                        @for (c of sec.campos; track c.clave) {
                          <div class="campo" [class.cambiado]="c.cambiado">
                            <label [for]="'aj-manifiesto-' + c.clave">{{ c.etiqueta }}</label>
                            @if (c.opciones) {
                              <select [id]="'aj-manifiesto-' + c.clave" [name]="'aj-manifiesto-' + c.clave" [ngModel]="c.valor" (ngModelChange)="ajustar('manifiesto', c.clave, $event)" [disabled]="p.documentos.manifiesto.estado === 'aceptado' || modoVer()">
                                @if (!c.conocido) { <option [value]="c.valor">{{ c.valor || '(vacío)' }}</option> }
                                @for (o of c.opciones; track o[0]) { <option [value]="o[0]">{{ o[1] }}</option> }
                              </select>
                            } @else {
                              <input [id]="'aj-manifiesto-' + c.clave" [name]="'aj-manifiesto-' + c.clave" [ngModel]="c.valor" (ngModelChange)="ajustar('manifiesto', c.clave, $event)" maxlength="250" [disabled]="p.documentos.manifiesto.estado === 'aceptado' || modoVer()" />
                            }
                            @if (c.ayuda) { <small class="ayuda">{{ c.ayuda }}</small> }
                            @if (c.cambiado) { <small class="corregido">Antes: {{ c.original || '(vacío)' }} · <button type="button" class="texto" (click)="ajustar('manifiesto', c.clave, c.original)" [disabled]="p.documentos.manifiesto.estado === 'aceptado' || modoVer()">Restaurar</button></small> }
                          </div>
                        }
                      </div>
                    </details>
                  }
                </div>
            </div>
          </section>

        </fieldset></form>
      } @else {
        <span class="esqueleto"></span>
      }
      <ng-container pie>
        @if (modoVer()) {
          <button type="button" (click)="cerrar.emit()">Cerrar</button>
          <button type="button" class="primario" (click)="modoVer.set(false)" [disabled]="!previa()"><app-icono nombre="enviar" [tam]="16" />Expedir</button>
        } @else {
        @if (previa()?.estado === 'registrado') {
          <button type="button" confirmar="Clic otra vez: sin manifiesto" (confirmado)="sinManifiesto()" [disabled]="trabajando()" style="margin-right:auto" title="Quitar este viaje de la lista de manifiestos">No requiere manifiesto</button>
        }
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        <button type="button" (click)="guardar()" [disabled]="trabajando() || !previa()">Guardar cambios</button>
        <button class="primario" type="submit" form="form-expedir" [disabled]="trabajando() || !previa()">
          <app-icono nombre="enviar" [tam]="16" />{{ trabajando() ? 'Enviando…' : (previa()?.ultimoError || previa()?.documentos?.remesa?.estado === 'rechazado' ? 'Corregir y reenviar' : 'Enviar al RNDC') }}</button>
        }
      </ng-container>
    </app-modal>`,
  styles: [`
    .estado { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin-bottom: 14px; font-size: 13.5px; }
    .mensaje { margin-bottom: 12px; }
    .respuesta { display: flex; flex-direction: column; gap: 4px; }
    .respuesta span { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
    .valores { width: min(420px, 100%); margin-top: 14px; border: 1px solid var(--gris-2); border-radius: var(--radio); border-collapse: separate; }
    .valores td { padding: 6px 12px; font-size: 13.5px; border-bottom: 1px solid var(--gris-15); }
    .valores tr:last-child td { border-bottom: 0; }
    .valores .total td { font-weight: 700; background: var(--gris-1); }
    .nota-valores { margin: 8px 0 0; font-size: 13px; color: var(--ambar-texto); }
    .resolver { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 12px 14px; border-radius: var(--radio);
      border: 1px solid var(--ambar-borde, var(--gris-2)); background: var(--ambar-claro, var(--gris-0)); font-size: 13.5px; }
    .resolver .fijar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
    .resolver .fijar app-municipio { flex: 1 1 320px; }
    .resolver .opciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .resolver ol { margin: 0; padding-left: 20px; display: grid; gap: 10px; }
    .resolver li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .resolver li small { flex-basis: 100%; color: var(--gris-6); }
    .resolver select { max-width: 380px; }
    fieldset.resaltar { border-color: var(--ambar); box-shadow: 0 0 0 1px var(--ambar); }
    .nota-num { margin: 8px 0 0; font-size: 12.5px; }
    .que-hacer { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: var(--gris-0); color: var(--gris-8); font-size: 13.5px; }
    h3 { margin: 6px 0 8px; font-size: 14px; }
    .cab-maestros { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 6px 0 8px; }
    .cab-maestros h3 { margin: 0; margin-right: auto; }
    .verificacion ul { margin: 4px 0 0; padding-left: 18px; }
    .maestros { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; }
    .maestros li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .rol { font-size: 12px; font-weight: 700; color: var(--gris-5); text-transform: uppercase; letter-spacing: .04em; min-width: 76px; }
    .ref { font-weight: 600; }
    .falta { color: var(--rojo-texto); flex-basis: 100%; }
    fieldset + fieldset { margin-top: 12px; }
    .dest { margin: 10px 0 0; font-size: 13px; color: var(--gris-7); }
    .dest.mal { color: var(--rojo-texto); }
    .revisar { margin-bottom: 12px; border: 1px solid var(--ambar-borde); background: var(--ambar-claro); border-radius: var(--radio); padding: 0 14px; font-size: 13.5px; }
    .revisar.grave { border-color: var(--rojo-borde); background: var(--rojo-claro); }
    .revisar > summary { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 0; }
    .revisar > summary::-webkit-details-marker { display: none; }
    .revisar .ver-det { margin-left: auto; font-size: 12.5px; color: var(--gris-6); text-decoration: underline; }
    .revisar[open] .ver-det { display: none; }
    .revisar ul { margin: 4px 0 10px; padding-left: 18px; }
    .una-col { display: flex; flex-direction: column; gap: 12px; }
    .todos-datos { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
    .titulo-col small { text-transform: none; letter-spacing: 0; font-weight: 400; }
    details.seccion { border: 1px solid var(--gris-2); border-radius: 10px; background: var(--gris-0); padding: 0; margin: 0; }
    details.seccion > summary { cursor: pointer; list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 10px 14px; font-weight: 650; font-size: 14px; }
    details.seccion > summary::-webkit-details-marker { display: none; }
    details.seccion > summary::before { content: '▸'; color: var(--gris-5); transition: transform .15s; }
    details.seccion[open] > summary::before { transform: rotate(90deg); }
    details.seccion .resumen { font-weight: 400; color: var(--gris-5); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }
    details.seccion > .formulario { padding: 2px 14px 14px; }
    details.seccion > .valores, details.seccion > .nota-valores { margin: 0 14px 14px; }
    .campo .ayuda { color: var(--gris-6); }
    .campo.cambiado input, .campo.cambiado select { border-color: var(--ambar); box-shadow: 0 0 0 1px var(--ambar); }
    .campo .corregido { color: var(--ambar-texto); }
    .campo .corregido button { padding: 0; min-height: 0; font-size: inherit; text-decoration: underline; }
    fieldset.sin-marco { border: 0; padding: 0; margin: 0; min-width: 0; }
    /* Solo consulta: se puede navegar y desplegar secciones, pero no escribir */
    .solo-ver :is(input, select, textarea, app-municipio, app-buscar-tercero, .maestros button, .cab-maestros button) { pointer-events: none; }
    .solo-ver :is(input, select, textarea) { background: var(--gris-1); color: var(--gris-7); }
    .pestanas { margin: 4px 0 14px; }
    .pestanas button { display: inline-flex; align-items: center; gap: 6px; }
    .chip.mini { font-size: 10.5px; padding: 1px 6px; }
    .punto-alerta { width: 8px; height: 8px; border-radius: 50%; background: var(--rojo); display: inline-block; }
    .dos-col { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; align-items: start; }
    .titulo-col { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--gris-6); }
    .titulo-col small { text-transform: none; letter-spacing: 0; font-weight: 400; }
    .col-fijo { background: var(--gris-1); border: 1px solid var(--gris-2); border-radius: var(--radio); padding: 12px 14px; }
    .seccion { background: var(--gris-0); border: 1px solid var(--gris-15); border-radius: 10px; padding: 8px 12px; margin-top: 8px; }
    .seccion h4 { margin: 0 0 4px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--primario-texto); }
    .fijos { display: grid; grid-template-columns: minmax(110px, auto) 1fr; gap: 3px 12px; margin: 0; font-size: 13px; }
    .fijos dt { color: var(--gris-6); } .fijos dd { margin: 0; font-weight: 600; word-break: break-word; }
    .destinatario { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--gris-0); border: 1px solid var(--gris-2); font-size: 13.5px; }
    .destinatario.mal { border-color: var(--rojo); }
    .destinatario .etiqueta { font-size: 12px; color: var(--gris-6); }
    @media (max-width: 820px) { .dos-col { grid-template-columns: 1fr; } }
    .variables table { font-size: 12.5px; }
    .variables td { padding: 4px 8px; }
  `],
})
export class ExpedirRndc {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  private auth = inject(Auth);
  readonly viajeId = input<string | null>(null);
  // «Ver»: abre en solo consulta; con «Expedir» se pasa a corregir y enviar
  readonly soloVer = input(false);
  // «Ver» abre la misma ventana con todo editable (se conserva la señal por si se necesita solo consulta)
  readonly modoVer = signal(false);
  readonly cerrar = output<void>();
  readonly actualizado = output<void>();
  readonly puedeValores = this.auth.tiene(P.VIAJES_EDITAR_TODOS);
  readonly tipos = Object.entries(TIPOS_ID);
  readonly viaje = signal<any>(null);
  readonly previa = signal<any>(null);
  readonly pestana = signal<'maestros' | 'remesa' | 'manifiesto'>('remesa');
  // Vehículo o personas sin registrar en el RNDC o con datos por completar
  readonly maestrosPendientes = computed(() => (this.previa()?.maestros || []).some((m: any) => m.faltantes?.length || ['no_existe', 'error', 'sin_enviar'].includes(m.estado)));

  // Datos que van fijos (no se editan en esta ventana), con nombres claros
  private static readonly NOMBRES: Record<string, string> = {
    CONSECUTIVOREMESA: 'N° de remesa', CODOPERACIONTRANSPORTE: 'Tipo de operación', NUMNITEMPRESAMONITOREO: 'NIT empresa de monitoreo', CODNATURALEZACARGA: 'Naturaleza de la carga',
    CANTIDADCARGADA: 'Cantidad cargada', UNIDADMEDIDACAPACIDAD: 'Unidad de medida', CODTIPOEMPAQUE: 'Código tipo de empaque',
    MERCANCIAREMESA: 'Código de mercancía', DESCRIPCIONCORTAPRODUCTO: 'Producto', CODTIPOIDREMITENTE: 'Tipo doc. remitente',
    NUMIDREMITENTE: 'Documento del remitente', CODSEDEREMITENTE: 'Sede del remitente (cargue)', CODTIPOIDDESTINATARIO: 'Tipo doc. destinatario',
    NUMIDDESTINATARIO: 'Documento del destinatario', CODSEDEDESTINATARIO: 'Sede del destinatario (descargue)', CODTIPOIDPROPIETARIO: 'Tipo doc. propietario',
    NUMIDPROPIETARIO: 'Documento del propietario', CODSEDEPROPIETARIO: 'Sede del propietario', DUENOPOLIZA: 'Tomador de la póliza (E = la empresa)',
    NUMPOLIZATRANSPORTE: 'N° de póliza', FECHAVENCIMIENTOPOLIZACARGA: 'Vence la póliza', COMPANIASEGURO: 'NIT de la aseguradora',
    HORASPACTOCARGA: 'Tiempo de cargue (horas)', MINUTOSPACTOCARGA: 'Tiempo de cargue (minutos)', HORASPACTODESCARGUE: 'Tiempo de descargue (horas)',
    MINUTOSPACTODESCARGUE: 'Tiempo de descargue (minutos)', FECHACITAPACTADACARGUE: 'Fecha cita de cargue', HORACITAPACTADACARGUE: 'Hora cita de cargue',
    FECHACITAPACTADADESCARGUE: 'Fecha cita de descargue', HORACITAPACTADADESCARGUEREMESA: 'Hora cita de descargue',
    CODRESPONSABLEPAGOCARGUE: 'Paga el cargue', CODRESPONSABLEPAGODESCARGUE: 'Paga el descargue',
    NUMMANIFIESTOCARGA: 'N° de manifiesto', FECHAEXPEDICIONMANIFIESTO: 'Fecha de expedición', CODMUNICIPIOORIGENMANIFIESTO: 'Origen (municipio)',
    CODMUNICIPIODESTINOMANIFIESTO: 'Destino (municipio)', CODIDTITULARMANIFIESTO: 'Tipo doc. titular', NUMIDTITULARMANIFIESTO: 'Documento del titular',
    NUMPLACA: 'Placa', NUMPLACAREMOLQUE: 'Remolque', CODIDCONDUCTOR: 'Tipo doc. conductor', NUMIDCONDUCTOR: 'Cédula del conductor',
    VALORFLETEPACTADOVIAJE: 'Flete pactado', RETENCIONFUENTEMANIFIESTO: 'Retención en la fuente', RETENCIONICAMANIFIESTOCARGA: 'Retención ICA',
    VALORANTICIPOMANIFIESTO: 'Anticipo', CODMUNICIPIOPAGOSALDO: 'Municipio de pago del saldo', FECHAPAGOSALDOMANIFIESTO: 'Fecha de pago del saldo',
    CODRESPONSABLEPAGOSALDO: 'Paga el saldo', OBSERVACIONES: 'Observaciones', RETENCIONFOPAT: 'Retención FOPAT', ACEPTACIONELECTRONICA: 'Aceptación electrónica',
  };
  // En cada pestaña no se repite en «fijo» lo que se edita a la izquierda ni el usuario/NIT de la empresa
  private static readonly EDITABLES: Record<string, string[]> = {
    remesa: ['CONSECUTIVOREMESA', 'CANTIDADCARGADA', 'CODTIPOIDDESTINATARIO', 'NUMIDDESTINATARIO', 'CODSEDEDESTINATARIO'],
    manifiesto: ['NUMMANIFIESTOCARGA', 'VALORFLETEPACTADOVIAJE', 'VALORANTICIPOMANIFIESTO', 'OBSERVACIONES', 'RETENCIONFUENTEMANIFIESTO', 'RETENCIONICAMANIFIESTOCARGA', 'RETENCIONFOPAT'],
  };
  // Secciones de la remesa y el manifiesto como en el formulario del RNDC; [etiqueta, variables que se unen en una línea]
  private static readonly SECCIONES: Record<string, { titulo: string; campos: [string, string[]][] }[]> = {
    remesa: [
      { titulo: 'Propietario de la carga', campos: [['Propietario', ['CODTIPOIDPROPIETARIO', 'NUMIDPROPIETARIO']], ['Sede', ['CODSEDEPROPIETARIO']]] },
      { titulo: 'Datos generales', campos: [['Tipo de operación', ['CODOPERACIONTRANSPORTE']], ['Tipo de empaque', ['CODTIPOEMPAQUE']]] },
      { titulo: 'Sitio de cargue', campos: [['Remitente', ['CODTIPOIDREMITENTE', 'NUMIDREMITENTE']], ['Sede', ['CODSEDEREMITENTE']],
        ['Cita', ['FECHACITAPACTADACARGUE', 'HORACITAPACTADACARGUE']], ['Tiempo pactado', ['HORASPACTOCARGA', 'MINUTOSPACTOCARGA']]] },
      { titulo: 'Sitio de descargue', campos: [['Cita', ['FECHACITAPACTADADESCARGUE', 'HORACITAPACTADADESCARGUEREMESA']], ['Tiempo pactado', ['HORASPACTODESCARGUE', 'MINUTOSPACTODESCARGUE']]] },
      { titulo: 'Producto', campos: [['Naturaleza', ['CODNATURALEZACARGA']], ['Código', ['MERCANCIAREMESA']], ['Descripción', ['DESCRIPCIONCORTAPRODUCTO']]] },
      { titulo: 'Cantidades', campos: [['Unidad de medida', ['UNIDADMEDIDACAPACIDAD']]] },
      { titulo: 'Seguro de la mercancía', campos: [['Tomador', ['DUENOPOLIZA']], ['Póliza', ['NUMPOLIZATRANSPORTE']], ['Vence', ['FECHAVENCIMIENTOPOLIZACARGA']], ['Aseguradora (NIT)', ['COMPANIASEGURO']]] },
      { titulo: 'Pagos', campos: [['Paga el cargue', ['CODRESPONSABLEPAGOCARGUE']], ['Paga el descargue', ['CODRESPONSABLEPAGODESCARGUE']]] },
    ],
    manifiesto: [
      { titulo: 'Características generales', campos: [['Tipo de manifiesto', ['CODOPERACIONTRANSPORTE']], ['Fecha de expedición', ['FECHAEXPEDICIONMANIFIESTO']],
        ['Origen', ['CODMUNICIPIOORIGENMANIFIESTO']], ['Destino', ['CODMUNICIPIODESTINOMANIFIESTO']]] },
      { titulo: 'Titular del manifiesto', campos: [['Titular', ['CODIDTITULARMANIFIESTO', 'NUMIDTITULARMANIFIESTO']]] },
      { titulo: 'Vehículo', campos: [['Placa', ['NUMPLACA']], ['Remolque', ['NUMPLACAREMOLQUE']]] },
      { titulo: 'Conductor', campos: [['Conductor', ['CODIDCONDUCTOR', 'NUMIDCONDUCTOR']]] },
      { titulo: 'Pago del saldo', campos: [['Lugar', ['CODMUNICIPIOPAGOSALDO']], ['Fecha', ['FECHAPAGOSALDOMANIFIESTO']], ['Responsable', ['CODRESPONSABLEPAGOSALDO']],
        ['Paga el cargue', ['CODRESPONSABLEPAGOCARGUE']], ['Paga el descargue', ['CODRESPONSABLEPAGODESCARGUE']]] },
      { titulo: 'Datos de control', campos: [['Aceptación electrónica', ['ACEPTACIONELECTRONICA']], ['Empresa de monitoreo', ['NUMNITEMPRESAMONITOREO']]] },
    ],
  };
  secciones(variables: string[][] | undefined, doc: 'remesa' | 'manifiesto') {
    const v = new Map((variables || []).map(([k, val]) => [k, val]));
    const usados = new Set<string>([...(ExpedirRndc.EDITABLES[doc] || []), 'NUMNITEMPRESATRANSPORTE', 'REMESA', 'REMESASMAN']);
    const salida = ExpedirRndc.SECCIONES[doc].map(sec => {
      const items = sec.campos.map(([etq, claves]) => { claves.forEach(k => usados.add(k));
        const TIPO: Record<string, string> = { N: 'NIT', C: 'C.C.', E: 'C.E.', P: 'Pasaporte', T: 'T.I.', U: 'NUIP' };
        const partes = claves.map(k => (/^COD(TIPO)?ID/.test(k) ? TIPO[v.get(k) || ''] || v.get(k) : v.get(k))).filter(x => x !== undefined && x !== '');
        return [etq, partes.join(claves.length > 1 && claves[0].startsWith('FECHA') ? ' ' : claves.length > 1 && claves[0].startsWith('HORAS') ? ' h ' : ' ')] as [string, string];
      }).filter(([, val], i) => val !== '' || sec.campos[i][1].some(k => v.has(k)));
      return { titulo: sec.titulo, items };
    }).filter(sec => sec.items.length);
    // Variables extra que exija el RNDC a la empresa y no estén en ninguna sección
    const otras = (variables || []).filter(([k]) => !usados.has(k)).map(([k, val]) => [ExpedirRndc.NOMBRES[k] || k, val] as [string, string]);
    if (otras.length) salida.push({ titulo: 'Otros datos', items: otras });
    return salida;
  }
  fijos(variables: string[][] | undefined, doc: 'remesa' | 'manifiesto'): string[][] {
    const ocultar = new Set([...(ExpedirRndc.EDITABLES[doc] || []), 'NUMNITEMPRESATRANSPORTE', 'REMESA', 'REMESASMAN']);
    return (variables || []).filter(([k]) => !ocultar.has(k)).map(([k, v]) => [k, ExpedirRndc.NOMBRES[k] || k, v]);
  }
  // Correcciones a mano del formulario del RNDC (variable → valor), por documento
  readonly ajustes = signal<{ remesa: Record<string, string>; manifiesto: Record<string, string> }>({ remesa: {}, manifiesto: {} });
  private static readonly TIPOS_DOC: [string, string][] = [['C', 'Cédula de ciudadanía'], ['N', 'NIT'], ['E', 'Cédula de extranjería'], ['P', 'Pasaporte'], ['T', 'Tarjeta de identidad'], ['U', 'NUIP']];
  private static readonly RESPONSABLE: [string, string][] = [['E', 'Empresa de transporte'], ['R', 'Remitente'], ['D', 'Destinatario']];
  // Listas para los códigos del RNDC: se elige por nombre, se envía el código
  private static readonly OPCIONES: Record<string, [string, string][]> = {
    CODOPERACIONTRANSPORTE: [['G', 'G · General'], ['P', 'P · Paqueteo'], ['C', 'C · Contenedor cargado'], ['V', 'V · Contenedor vacío']],
    CODNATURALEZACARGA: [['1', '1 · Carga normal'], ['2', '2 · Carga peligrosa'], ['3', '3 · Extradimensionada'], ['4', '4 · Extrapesada'], ['5', '5 · Desechos peligrosos'], ['6', '6 · Semovientes'], ['7', '7 · Refrigerada']],
    UNIDADMEDIDACAPACIDAD: [['1', '1 · Kilogramos'], ['2', '2 · Galones']],
    CODRESPONSABLEPAGOCARGUE: ExpedirRndc.RESPONSABLE, CODRESPONSABLEPAGODESCARGUE: ExpedirRndc.RESPONSABLE, CODRESPONSABLEPAGOSALDO: ExpedirRndc.RESPONSABLE,
    ACEPTACIONELECTRONICA: [['SI', 'Sí'], ['NO', 'No']],
  };
  private opcionesDe(k: string): [string, string][] | null {
    if (/^COD(TIPO)?ID/.test(k)) return ExpedirRndc.TIPOS_DOC.map(([c, n]) => [c, `${c} · ${n}`] as [string, string]);
    return ExpedirRndc.OPCIONES[k] || null;
  }
  // En «Ver» no se escribe en los campos (sí se navega con Tab)
  soloLectura(e: KeyboardEvent) {
    if (this.modoVer() && e.key !== 'Tab' && (e.target as HTMLElement).matches('input, select, textarea')) e.preventDefault();
  }
  tipoDoc(t: string) { return ({ N: 'NIT', C: 'C.C.', E: 'C.E.', P: 'Pasaporte', T: 'T.I.', U: 'NUIP' } as Record<string, string>)[t] || t; }
  ajustar(doc: 'remesa' | 'manifiesto', clave: string, valor: string) {
    const base = new Map<string, string>(this.previa()?.[doc]?.base || []);
    this.ajustes.update(a => {
      const d = { ...a[doc] };
      if ((valor ?? '') === (base.get(clave) ?? '')) delete d[clave]; else d[clave] = String(valor ?? '');
      return { ...a, [doc]: d };
    });
  }
  // Secciones editables: cada variable con nombre claro, su valor y qué significa el código
  seccionesEdit(doc: 'remesa' | 'manifiesto') {
    const p = this.previa(); if (!p) return [];
    const base = new Map<string, string>(p[doc].base || p[doc].variables);
    const aj = this.ajustes()[doc];
    const desc = p.descripciones || {};
    const usados = new Set<string>([...(ExpedirRndc.EDITABLES[doc] || []), ...(p.noAjustables || [])]);
    const campo = (k: string) => {
      usados.add(k);
      const original = base.get(k) ?? ''; const valor = k in aj ? aj[k] : original;
      const opciones = this.opcionesDe(k);
      const ayuda = desc[k] && valor === original ? desc[k] : '';
      return { clave: k, etiqueta: ExpedirRndc.NOMBRES[k] || k, valor, original, cambiado: k in aj, opciones, conocido: !!opciones?.some(o => o[0] === valor), ayuda };
    };
    const resumir = (cs: any[]) => cs.map(c => (c.opciones?.find((o: string[]) => o[0] === c.valor)?.[1]?.replace(/^\S+ · /, '') || c.ayuda || c.valor)).filter(Boolean).slice(0, 3).join(' · ');
    const salida = ExpedirRndc.SECCIONES[doc].map(sec => {
      const campos = sec.campos.flatMap(([, claves]) => claves).filter(k => base.has(k) && !usados.has(k)).map(campo);
      return { titulo: sec.titulo, campos, cambiados: campos.filter(c => c.cambiado).length, resumen: resumir(campos), abierta: false };
    }).filter(x => x.campos.length);
    const otras = [...base.keys()].filter(k => !usados.has(k)).map(campo);
    if (otras.length) salida.push({ titulo: 'Otros datos', campos: otras, cambiados: otras.filter(c => c.cambiado).length, resumen: resumir(otras), abierta: false });
    // Se abre la sección con correcciones o con datos vacíos
    for (const x of salida) x.abierta = x.cambiados > 0 || x.campos.some(c => !c.valor);
    return salida;
  }
  // Retenciones del manifiesto editables a mano (se guardan como corrección del formulario del RNDC)
  readonly RETENCIONES: [string, string][] = [['RETENCIONFUENTEMANIFIESTO', 'Retención en la fuente'], ['RETENCIONICAMANIFIESTOCARGA', 'Retención ICA'], ['RETENCIONFOPAT', 'Retención FOPAT (0,1 %)']];
  baseTexto(k: string) { return String(new Map<string, string>(this.previa()?.manifiesto?.base || []).get(k) ?? ''); }
  retencionBase(k: string) { return Number(this.baseTexto(k)) || 0; }
  retencion(k: string) { const a = this.ajustes().manifiesto; return k in a ? Number(a[k]) || 0 : this.retencionBase(k); }
  fijarRetencion(k: string, v: any) { this.ajustar('manifiesto', k, String(Math.max(0, Math.round(Number(v) || 0)))); }
  // Neto y saldo con las retenciones que se van a enviar (calculadas o escritas a mano)
  valoresVista() {
    const val = this.previa()?.valores || {};
    const rete = this.retencion('RETENCIONFUENTEMANIFIESTO'); const ica = this.retencion('RETENCIONICAMANIFIESTOCARGA'); const fopat = this.retencion('RETENCIONFOPAT');
    const neto = (Number(val.flete) || 0) - rete - ica - fopat;
    return { retefuente: rete, ica, fopat, neto, saldo: neto - (Number(val.anticipo) || 0) };
  }
  readonly form = signal<any>({});
  readonly trabajando = signal(false);
  readonly resultado = signal<{ ok: boolean; texto: string } | null>(null);
  readonly detalles = signal<string[]>([]);
  readonly mostrarRemolque = signal(false);
  readonly conRemolque = computed(() => this.mostrarRemolque() || !!this.form().remolque);
  // Problemas del diccionario (remesa solo si aún no fue aceptada) más los que devuelva el servidor
  readonly faltan = computed(() => {
    const p = this.previa();
    if (!p) return [];
    return [...new Set([...p.remesa.problemas.map((x: string) => `Remesa · ${x}`), ...p.manifiesto.problemas.map((x: string) => `Manifiesto · ${x}`), ...this.detalles()])];
  });

  constructor() {
    effect(() => { const p = this.previa(); if (p) this.ajustes.set({ remesa: { ...(p.remesa.ajustes || {}) }, manifiesto: { ...(p.manifiesto.ajustes || {}) } }); });
    effect(() => { const id = this.viajeId(); this.modoVer.set(false); if (id) this.cargar(id); else { this.previa.set(null); this.viaje.set(null); } });
  }

  private async cargar(id: string) {
    this.verificacion.set(null);
    this.resultado.set(null); this.detalles.set([]); this.mostrarRemolque.set(false);
    try {
      const [v, p] = await Promise.all([this.api.get<any>(`/viajes/${id}`), this.api.get<any>(`/rndc/viajes/${id}/vista-previa`)]);
      this.viaje.set(v);
      this.form.set({
        fecha: isoDia(v.fecha), codOrigen: v.codOrigen || '', codDestino: v.codDestino || v.tarifaRef?.codMunicipio || '',
        placa: v.placa, remolque: v.remolque || '', conductor: v.conductor?._id || '', titular: v.titular?._id || '', titularInicial: v.titular?._id || '',
        pesoKg: v.pesoKg, destinatario: { tipoId: v.destinatario?.tipoId || '', numId: v.destinatario?.numId || '', sede: v.destinatario?.sede || '' },
        flete: v.flete, anticipo: v.anticipo, observaciones: v.observaciones || '',
        codDestinoManifiesto: p.destinoManifiestoFijo || '', numeroRemesa: p.numeros?.manualRemesa || '', numeroManifiesto: p.numeros?.manualManifiesto || '',
      });
      // Si el viaje no tiene origen propio se muestra el que se enviará (el de la empresa)
      const origen = p.manifiesto.variables.find((x: string[]) => x[0] === 'CODMUNICIPIOORIGENMANIFIESTO')?.[1];
      if (!this.form().codOrigen && origen) this.form.update(f => ({ ...f, codOrigen: origen }));
      this.previa.set(p);
      // Abre la pestaña donde está el problema: rechazo de la remesa o del manifiesto, o datos de vehículo/personas
      const proceso = p.ultimoError?.proceso;
      this.pestana.set(proceso === 4 ? 'manifiesto' : proceso === 3 ? 'remesa' : this.maestrosPendientes() ? 'maestros' : p.remesaAceptada ? 'manifiesto' : 'remesa');
    } catch (e) { this.avisos.error(e); this.cerrar.emit(); }
  }

  chip(e: string) { return ({ aceptado: 'ok', rechazado: 'error', anulado: 'alerta' } as Record<string, string>)[e] || ''; }
  chipMaestro(e: string) { return ({ enviado: 'ok', error: 'error', no_existe: 'error' } as Record<string, string>)[e] || 'alerta'; }
  estadoMaestro(e: string) {
    return ({ enviado: 'Registrado', error: 'Con error', no_existe: 'No está en Vehículos', importado: 'Importado del Excel (sin confirmar)' } as Record<string, string>)[e] || 'Sin registrar';
  }

  // Explicación sencilla de los rechazos más comunes del RNDC
  ayudaError(m: string) {
    const t = String(m || '');
    if (/Paso\d+ Expidiendo/i.test(t)) return 'Es una falla interna del RNDC al procesar el documento, no un error de sus datos. Presione «Corregir y reenviar»: antes de enviar se verifica en el RNDC que no haya quedado registrado, así no se duplica.';
    if (/MAN130|titular no existe/i.test(t)) return 'El titular no está registrado en el RNDC. Use «Registrar de nuevo» junto al TITULAR (arriba) o cambie el titular en «Viaje» y presione «Corregir y reenviar».';
    if (/conductor.*no existe|MAN12\d/i.test(t)) return 'El conductor no está registrado en el RNDC. Use «Registrar de nuevo» junto al CONDUCTOR o elija otro conductor y reenvíe.';
    if (/MAN353|municipio origen/i.test(t)) return 'El origen del manifiesto debe ser el municipio de la remesa (el de la sede del remitente). La plataforma ya lo toma así: presione «Corregir y reenviar».';
    if (/MAN275|FOPAT/i.test(t)) return 'El RNDC exige la retención FOPAT (0,1 % del flete) para este vehículo. La plataforma ya la calcula: presione «Corregir y reenviar».';
    if (/MAN270|anticipo supera/i.test(t)) return 'El anticipo no puede ser mayor que el neto a pagar (flete menos retenciones). La plataforma lo ajusta al neto: presione «Corregir y reenviar».';
    if (/REM060|REM380|REM382|cantidad/i.test(t)) return 'Falta la cantidad cargada. Escriba el peso de la carga en kg en «Carga (remesa)» y presione «Corregir y reenviar».';
    if (/MAN354|municipio destino/i.test(t)) return 'El destino del manifiesto debe ser el municipio que el RNDC tiene para la sede del destinatario de la remesa. Use «Actualizar la sede del destinatario desde el RNDC» (abajo) y luego «Corregir y reenviar».';
    if (/DUPLICADO|REM030|ya fu[eé] radicado/i.test(t)) return 'Ese número ya está radicado en el RNDC (lo usó otro documento o un envío anterior). Escriba en «Números en el RNDC» un número que no se haya usado y presione «Corregir y reenviar».';
    if (/REM019|cargue y la direccion del punto de descargue/i.test(t)) return 'El destinatario no puede ser el mismo remitente en la misma sede. Elija en «Carga» la sede del cliente en el destino o quién recibe.';
    if (/REM180|REM200|destinatario/i.test(t)) return 'El destinatario o su sede no existen en el RNDC. Elija en «Carga» el destinatario y la sede correctos.';
    if (/placa|veh[ií]culo.*no existe/i.test(t)) return 'El vehículo no está registrado en el RNDC. Use «Registrar de nuevo» junto al VEHÍCULO y reenvíe.';
    if (/usuario|contrase/i.test(t)) return 'La contraseña del RNDC no es correcta. Vuelva a enviar y escríbala de nuevo.';
    return '';
  }
  etiquetas(f: any[]) { return f.map(x => x.etiqueta).join(', '); }

  // REM019: el destinatario quedó igual al remitente; se elige quién recibe aquí mismo
  readonly duplicado = computed(() => /DUPLICADO|REM030|ya fu[eé] radicado/i.test(this.previa()?.ultimoError?.mensaje || ''));
  readonly problemaDestino = computed(() => !!this.previa()?.remesa?.problemas?.some((x: string) => /REM019/.test(x)));
  readonly sedesEnDestino = computed(() => {
    const p = this.previa();
    return (p?.sedesCliente || []).filter((x: any) => x.codMunicipio === p?.destinoViaje?.codigo && x.sede !== p?.cliente?.sedeRemitente);
  });
  readonly otrasSedes = computed(() => (this.previa()?.sedesCliente || []).filter((x: any) => x.sede !== this.previa()?.cliente?.sedeRemitente));
  async usarSede(sede: string) {
    if (!sede) return;
    this.elegirSede(sede);
    if (await this.guardar(true)) this.avisos.ok(`Recibe la sede ${sede}`);
  }
  async fijarDestino(codigo: string) {
    if (!codigo) return;
    this.form.update(f => ({ ...f, codDestinoManifiesto: codigo }));
    if (await this.guardar(true)) this.avisos.ok(`El manifiesto irá a ${this.previa()?.destinoManifiesto}. Presione «Corregir y reenviar».`);
  }
  readonly destinoManifiestoMal = computed(() => /MAN354/.test(this.previa()?.ultimoError?.mensaje || '') && !!this.previa()?.destinatario?.numId);
  // Trae del RNDC las sedes de un tercero (cliente o destinatario) con su municipio real
  async traerSedes(cli: { tipoId: string; numId: string } | null | undefined) {
    const id = this.viajeId();
    if (!cli?.numId || !id) return;
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      const [r] = await this.api.post<any[]>('/rndc/importar/terceros', { clave: c, roles: ['destinatario'], documentos: [{ tipoId: cli.tipoId, numId: cli.numId }] });
      if (!r?.ok) { this.avisos.mostrar(r?.mensaje || 'El RNDC no devolvió sedes', 'error'); if (/usuario|contrase|clave/i.test(r?.mensaje || '')) this.clave.olvidar(); return; }
      const antes = this.previa()?.sedesCliente?.length || 0;
      const destinoAntes = this.previa()?.destinoManifiesto;
      const p = await this.api.get<any>(`/rndc/viajes/${id}/vista-previa`);
      this.previa.set(p);
      if (this.destinoManifiestoMal()) {
        this.avisos.ok(p.destinoManifiesto !== destinoAntes
          ? `Sede actualizada: el manifiesto irá a ${p.destinoManifiesto}. Presione «Corregir y reenviar».`
          : `Sedes actualizadas desde el RNDC; el destino sigue en ${p.destinoManifiesto}.`);
        return;
      }
      const nuevas = (p.sedesCliente?.length || 0) - antes;
      this.avisos.ok(nuevas > 0 ? `Se trajeron ${nuevas} sede(s) nueva(s) del RNDC` : 'El RNDC no tiene más sedes de este cliente');
      if (!this.sedesEnDestino().length && nuevas >= 0) this.avisos.mostrar('El cliente no tiene sede en el municipio de destino: elija otra sede u otro destinatario', 'info');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // Sede del cliente elegida como destinatario (si el destinatario es el mismo cliente)
  sedeElegida() {
    const f = this.form(); const p = this.previa();
    const s = p?.sedesCliente?.find((x: any) => x.numId === f.destinatario?.numId && x.sede === f.destinatario?.sede);
    return s ? s.sede : '';
  }
  elegirSede(sede: string) {
    const s = this.previa()?.sedesCliente?.find((x: any) => x.sede === sede);
    this.form.update(f => ({ ...f, destinatario: s ? { tipoId: s.tipoId, numId: s.numId, sede: s.sede } : { tipoId: '', numId: '', sede: '' } }));
  }
  origenDestinatario(o: string) {
    return ({ remesa: 'el de la remesa ya aceptada', viaje: 'definido en este viaje', tarifa: 'definido en la tarifa del destino', municipio: 'sede del cliente en el municipio de destino',
      cliente: 'el mismo cliente: no hay sede registrada en el municipio de destino; elija quién recibe' } as Record<string, string>)[o] || o;
  }

  // Solo se envían los datos permitidos según el estado y el rol.
  private cuerpo() {
    const f = this.form(); const p = this.previa();
    const c: any = { codOrigen: f.codOrigen || '', codDestino: f.codDestino || '', placa: String(f.placa || '').toUpperCase(),
      remolque: String(f.remolque || '').toUpperCase(), observaciones: f.observaciones || '' };
    if (f.conductor) c.conductor = f.conductor;
    // El titular solo se envía si se cambió aquí (si no, el servidor lo toma del vehículo)
    if ((f.titular || '') !== (f.titularInicial || '')) c.titular = f.titular || null;
    if (!p.remesaAceptada) { c.fecha = f.fecha; c.pesoKg = Number(f.pesoKg) || 0; c.destinatario = f.destinatario.tipoId ? f.destinatario : { tipoId: '', numId: '', sede: '' }; }
    if (this.puedeValores) { c.flete = Number(f.flete) || 0; c.anticipo = Number(f.anticipo) || 0; }
    if (f.codDestinoManifiesto !== undefined) c.codDestinoManifiesto = f.codDestinoManifiesto || '';
    if (!p.remesaAceptada) c.numeroRemesa = String(f.numeroRemesa || '').trim().toUpperCase();
    if (p.documentos.manifiesto.estado !== 'aceptado') c.numeroManifiesto = String(f.numeroManifiesto || '').trim().toUpperCase();
    c.ajustes = { ...(p.remesaAceptada ? {} : { remesa: this.ajustes().remesa }), ...(p.documentos.manifiesto.estado !== 'aceptado' ? { manifiesto: this.ajustes().manifiesto } : {}) };
    return c;
  }

  async guardar(silencioso = false): Promise<boolean> {
    const id = this.viajeId();
    if (!id) return false;
    this.trabajando.set(true); this.detalles.set([]);
    try {
      this.previa.set(await this.api.put<any>(`/rndc/viajes/${id}/datos`, this.cuerpo()));
      if (!silencioso) { this.avisos.ok('Datos del viaje guardados'); this.actualizado.emit(); }
      return true;
    } catch (e) {
      this.resultado.set({ ok: false, texto: await mensajeError(e) });
      return false;
    } finally { this.trabajando.set(false); }
  }

  // Verificación contra el RNDC: trae vehículo, personas y sedes y actualiza la plataforma.
  // Devuelve true si se puede enviar sin revisar nada más.
  readonly verificacion = signal<any>(null);
  conCambios(ver: any) { return ver.resultados.some((x: any) => x.cambios?.length && !/^registrado en la plataforma/.test(x.cambios[0])) ; }
  async verificar(forzar: boolean, claveDada?: string): Promise<boolean> {
    const id = this.viajeId();
    if (!id) return false;
    const c = claveDada || await this.clave.obtener();
    if (!c) return false;
    this.trabajando.set(true);
    try {
      const destinoAntes = this.previa()?.destinoManifiesto;
      const r = await this.api.post<any>(`/rndc/viajes/${id}/verificar`, { clave: c, forzar });
      this.verificacion.set(r);
      this.previa.set(r.previa);
      if (r.bloqueantes.length) return false;
      // Si cambió algo que va en los documentos, se muestra antes de enviar
      return !this.conCambios(r) && r.previa.destinoManifiesto === destinoAntes && !this.faltan().length;
    } catch (e: any) {
      this.resultado.set({ ok: false, texto: await mensajeError(e) });
      if (/usuario|contrase|clave/i.test(e?.error?.error || '')) this.clave.olvidar();
      return false;
    } finally { this.trabajando.set(false); }
  }

  async enviar() {
    const id = this.viajeId();
    if (!id || !(await this.guardar(true))) return;
    const c = await this.clave.obtener();
    if (!c) return;
    // Antes de enviar: verificación con el RNDC (si no se hizo en los últimos días)
    if (!this.previa()?.verificacionVigente && !(await this.verificar(false, c))) return;
    this.trabajando.set(true); this.resultado.set(null);
    try {
      const r = await this.api.post<any>(`/rndc/viajes/${id}/despachar`, { clave: c });
      if (r.manifiesto?.estado === 'aceptado') {
        this.avisos.ok(`Manifiesto ${r.manifiesto.numero} aceptado (radicado ${r.manifiesto.radicado})`);
        this.actualizado.emit(); this.cerrar.emit();
        return;
      }
      const m = r.manifiesto?.mensaje || r.remesa?.mensaje || 'El RNDC rechazó el envío';
      if (/usuario|contrase|clave|password/i.test(m)) this.clave.olvidar();
      this.resultado.set({ ok: false, texto: r.remesa?.estado === 'aceptado' ? `Remesa ${r.remesa.numero} aceptada; el manifiesto fue rechazado. Corrija y reenvíe.` : 'El envío fue rechazado. Corrija y reenvíe.' });
      this.actualizado.emit();
    } catch (e: any) {
      this.resultado.set({ ok: false, texto: await mensajeError(e) });
      if (Array.isArray(e?.error?.detalles)) this.detalles.set(e.error.detalles);
    } finally {
      this.trabajando.set(false);
      this.previa.set(await this.api.get<any>(`/rndc/viajes/${id}/vista-previa`).catch(() => this.previa()));
    }
  }

  async registrarMaestro(m: any) {
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/rndc/${m.tipo === 'vehiculo' ? 'vehiculos' : 'terceros'}/${m.id}/enviar`, { clave: c, forzar: true, ...(m.comoTitular ? { titular: true } : {}) });
      if (r.ok) this.avisos.ok(`${m.referencia}: ${r.sinCambios ? 'ya estaba registrado' : 'registrado en el RNDC'}`);
      else { this.avisos.mostrar(`El RNDC rechazó ${m.referencia}: ${r.mensaje}`, 'error'); if (/usuario|contrase|clave/i.test(r.mensaje || '')) this.clave.olvidar(); }
    } catch (e) { this.avisos.error(e); } finally {
      this.trabajando.set(false);
      const id = this.viajeId();
      if (id) this.previa.set(await this.api.get<any>(`/rndc/viajes/${id}/vista-previa`).catch(() => this.previa()));
    }
  }

  async sinManifiesto() {
    const id = this.viajeId();
    if (!id) return;
    this.trabajando.set(true);
    try {
      await this.api.put(`/rndc/viajes/${id}/datos`, { requiereManifiesto: false });
      this.avisos.ok('El viaje quedó marcado como sin manifiesto');
      this.actualizado.emit(); this.cerrar.emit();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
