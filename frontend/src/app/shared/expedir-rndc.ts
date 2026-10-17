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
    <app-modal [titulo]="'Expedir viaje N° ' + (viaje()?.numero || '')" [abierto]="!!viajeId()" (cerrar)="cerrar.emit()" [ancho]="true">
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
        @if (faltan().length) {
          <div class="mensaje error"><strong>Faltan datos según el diccionario del RNDC:</strong><ul>@for (x of faltan(); track x) { <li>{{ x }}</li> }</ul></div>
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
                  <li><button type="button" class="primario pequeno" (click)="traerSedesCliente()" [disabled]="trabajando()">
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
        @if (p.avisos.length) { <div class="mensaje alerta"><strong>Revise:</strong><ul>@for (a of p.avisos; track a) { <li>{{ a }}</li> }</ul></div> }

        <!-- Vehículo y personas: deben existir en el RNDC -->
        <h3>Vehículo y personas en el RNDC</h3>
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

        <!-- Datos del envío: solo los que van en la remesa y el manifiesto -->
        <form id="form-expedir" (ngSubmit)="enviar()">
          @let f = form();
          <fieldset><legend>Viaje</legend><div class="formulario">
            <div class="campo"><label for="ex-fecha">Fecha</label><input id="ex-fecha" type="date" name="fecha" [(ngModel)]="f.fecha" [disabled]="p.remesaAceptada" required />
              @if (p.remesaAceptada) { <small>Fijada por la remesa aceptada.</small> }</div>
            <app-municipio etiqueta="Origen" [(codigo)]="f.codOrigen" />
            <app-municipio etiqueta="Destino" [(codigo)]="f.codDestino" />
            <div class="campo"><label for="ex-placa">Placa</label><input id="ex-placa" name="placa" [(ngModel)]="f.placa" required maxlength="7" style="text-transform:uppercase" /></div>
            @if (conRemolque()) {
              <div class="campo"><label for="ex-rem">Remolque</label><input id="ex-rem" name="remolque" [(ngModel)]="f.remolque" maxlength="7" style="text-transform:uppercase" /></div>
            } @else {
              <div class="campo"><span class="etiqueta">Remolque</span><button type="button" class="pequeno" (click)="mostrarRemolque.set(true)">Agregar remolque</button></div>
            }
            <app-buscar-tercero etiqueta="Conductor" rol="conductor" [(valor)]="f.conductor" />
            <app-buscar-tercero etiqueta="Titular del manifiesto" [(valor)]="f.titular" placeholder="Vacío = el conductor" />
          </div>
          <p class="sutil" style="margin:10px 0 0;font-size:12.5px">Por defecto el titular es el del vehículo; si no tiene, el conductor. Puede cambiarlo aquí si el RNDC lo rechaza.
            @if (p.destinoManifiesto && p.destinatario?.municipio && p.destinatario.municipio !== f.codDestino) {
              <br />El manifiesto irá al municipio <strong>{{ p.destinoManifiesto }}</strong>, el de la sede del destinatario{{ p.destinatario.nombreSede ? ' (' + p.destinatario.nombreSede + ')' : '' }}, como lo exige el RNDC.
            }</p></fieldset>

          @if (p.documentos.manifiesto.estado !== 'aceptado') {
            <fieldset [class.resaltar]="duplicado()"><legend>Números en el RNDC</legend><div class="formulario">
              <div class="campo"><label for="ex-nr">N° de remesa</label>
                <input id="ex-nr" name="nr" maxlength="15" [(ngModel)]="f.numeroRemesa" [disabled]="p.remesaAceptada" style="text-transform:uppercase"
                  [placeholder]="p.remesaAceptada ? p.documentos.remesa.numero : 'Automático: ' + p.numeros?.remesa" />
                @if (p.remesaAceptada) { <small>Aceptada con este número.</small> }</div>
              <div class="campo"><label for="ex-nm">N° de manifiesto</label>
                <input id="ex-nm" name="nm" maxlength="15" [(ngModel)]="f.numeroManifiesto" style="text-transform:uppercase"
                  [placeholder]="'Automático: ' + p.numeros?.manifiesto" /></div>
            </div>
            <p class="sutil nota-num">Déjelos vacíos para usar la numeración automática. Escríbalos solo si el RNDC respondió que el número ya fue radicado (DUPLICADO).</p>
            </fieldset>
          }

          @if (!p.remesaAceptada) {
            <fieldset><legend>Carga (remesa)</legend><div class="formulario">
              <div class="campo"><label for="ex-peso">Cantidad cargada (kg)</label><input id="ex-peso" type="number" min="0" name="peso" [(ngModel)]="f.pesoKg" required /></div>
              @if (p.sedesCliente?.length) {
                <div class="campo"><label for="ex-sede">Sede del cliente que recibe</label>
                  <select id="ex-sede" name="sedeCli" [ngModel]="sedeElegida()" (ngModelChange)="elegirSede($event)">
                    <option value="">Automático / otro destinatario</option>
                    @for (x of p.sedesCliente; track x.sede) { <option [value]="x.sede">Sede {{ x.sede }} · {{ x.nombre }} ({{ x.codMunicipio }})</option> }
                  </select></div>
              }
              <div class="campo"><label for="ex-dt">Otro destinatario</label>
                <select id="ex-dt" name="dtipo" [(ngModel)]="f.destinatario.tipoId"><option value="">Automático (tarifa o sede del cliente en destino)</option>@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
              @if (f.destinatario.tipoId) {
                <div class="campo"><label for="ex-dn">Documento del destinatario</label><input id="ex-dn" name="dnum" [(ngModel)]="f.destinatario.numId" maxlength="15" /></div>
                <div class="campo"><label for="ex-ds">Sede del destinatario</label><input id="ex-ds" name="dsede" [(ngModel)]="f.destinatario.sede" maxlength="6" /></div>
              }
            </div>
            @if (p.destinatario; as d) {
              <p class="dest" [class.mal]="d.origen === 'cliente'">
                Se enviará como destinatario: <strong>{{ d.tipoId }} {{ d.numId }} · sede {{ d.sede || '(sin sede)' }}{{ d.nombreSede ? ' ' + d.nombreSede : '' }}</strong>
                — {{ origenDestinatario(d.origen) }}
              </p>
            }
            </fieldset>
          }

          <fieldset><legend>Valores (manifiesto)</legend><div class="formulario">
            @if (puedeValores) {
              <div class="campo"><label for="ex-fl">Flete pactado</label><div class="moneda"><input id="ex-fl" moneda name="flete" [(ngModel)]="f.flete" required /></div></div>
              <div class="campo"><label for="ex-an">Anticipo</label><div class="moneda"><input id="ex-an" moneda name="anticipo" [(ngModel)]="f.anticipo" /></div></div>
            } @else {
              <div class="campo"><span class="etiqueta">Flete pactado</span><strong>{{ f.flete | pesos }}</strong></div>
              <div class="campo"><span class="etiqueta">Anticipo</span><strong>{{ f.anticipo | pesos }}</strong></div>
            }
            <div class="campo ancho"><label for="ex-obs">Observaciones</label><input id="ex-obs" name="obs" maxlength="200" [(ngModel)]="f.observaciones" /></div>
          </div>
          @if (p.valores; as val) {
            <table class="valores" aria-label="Valores del viaje como los calcula el RNDC">
              <tbody>
                <tr><td>Valor a pagar por el viaje</td><td class="num">{{ val.flete | pesos }}</td></tr>
                <tr><td>Retención en la fuente</td><td class="num">{{ val.retefuente | pesos }}</td></tr>
                <tr><td>Retención ICA</td><td class="num">{{ val.ica | pesos }}</td></tr>
                <tr><td>Retención FOPAT (0,1 %){{ val.fopatAplica ? '' : ' · no aplica' }}</td><td class="num">{{ val.fopat | pesos }}</td></tr>
                <tr class="total"><td>Neto a pagar</td><td class="num">{{ val.neto | pesos }}</td></tr>
                <tr><td>Valor anticipo</td><td class="num">{{ val.anticipo | pesos }}</td></tr>
                <tr class="total"><td>Saldo por pagar</td><td class="num">{{ val.saldo | pesos }}</td></tr>
              </tbody>
            </table>
            @if (val.anticipoAjustado) {
              <p class="nota-valores">El anticipo registrado ({{ val.anticipoRegistrado | pesos }}) supera el neto a pagar: se enviará y guardará como {{ val.anticipo | pesos }}, como lo exige el RNDC.</p>
            }
          }
          </fieldset>
        </form>

        <details class="variables"><summary>Ver lo que se enviará al RNDC</summary>
          @for (doc of [['Remesa', p.remesa], ['Manifiesto', p.manifiesto]]; track doc[0]) {
            <h4>{{ doc[0] }}</h4>
            <table><tbody>@for (x of doc[1].variables; track x[0]) { <tr><td class="sutil">{{ x[0] }}</td><td>{{ x[1] }}</td></tr> }</tbody></table>
          }
        </details>
      } @else {
        <span class="esqueleto"></span>
      }
      <ng-container pie>
        @if (previa()?.estado === 'registrado') {
          <button type="button" confirmar="Clic otra vez: sin manifiesto" (confirmado)="sinManifiesto()" [disabled]="trabajando()" style="margin-right:auto" title="Quitar este viaje de la lista de manifiestos">No requiere manifiesto</button>
        }
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        <button type="button" (click)="guardar()" [disabled]="trabajando() || !previa()">Guardar cambios</button>
        <button class="primario" type="submit" form="form-expedir" [disabled]="trabajando() || !previa()">
          <app-icono nombre="enviar" [tam]="16" />{{ trabajando() ? 'Enviando…' : (previa()?.ultimoError || previa()?.documentos?.remesa?.estado === 'rechazado' ? 'Corregir y reenviar' : 'Enviar al RNDC') }}</button>
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
    .resolver .opciones { display: flex; flex-wrap: wrap; gap: 8px; }
    .resolver ol { margin: 0; padding-left: 20px; display: grid; gap: 10px; }
    .resolver li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .resolver li small { flex-basis: 100%; color: var(--gris-6); }
    .resolver select { max-width: 380px; }
    fieldset.resaltar { border-color: var(--ambar); box-shadow: 0 0 0 1px var(--ambar); }
    .nota-num { margin: 8px 0 0; font-size: 12.5px; }
    .que-hacer { margin-top: 6px; padding: 8px 10px; border-radius: 8px; background: var(--gris-0); color: var(--gris-8); font-size: 13.5px; }
    h3 { margin: 6px 0 8px; font-size: 14px; }
    .maestros { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; }
    .maestros li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .rol { font-size: 12px; font-weight: 700; color: var(--gris-5); text-transform: uppercase; letter-spacing: .04em; min-width: 76px; }
    .ref { font-weight: 600; }
    .falta { color: var(--rojo-texto); flex-basis: 100%; }
    fieldset + fieldset { margin-top: 12px; }
    .dest { margin: 10px 0 0; font-size: 13px; color: var(--gris-7); }
    .dest.mal { color: var(--rojo-texto); }
    .variables { margin-top: 14px; }
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
  readonly cerrar = output<void>();
  readonly actualizado = output<void>();
  readonly puedeValores = this.auth.tiene(P.VIAJES_EDITAR_TODOS);
  readonly tipos = Object.entries(TIPOS_ID);
  readonly viaje = signal<any>(null);
  readonly previa = signal<any>(null);
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
    effect(() => { const id = this.viajeId(); if (id) this.cargar(id); else { this.previa.set(null); this.viaje.set(null); } });
  }

  private async cargar(id: string) {
    this.resultado.set(null); this.detalles.set([]); this.mostrarRemolque.set(false);
    try {
      const [v, p] = await Promise.all([this.api.get<any>(`/viajes/${id}`), this.api.get<any>(`/rndc/viajes/${id}/vista-previa`)]);
      this.viaje.set(v);
      this.form.set({
        fecha: isoDia(v.fecha), codOrigen: v.codOrigen || '', codDestino: v.codDestino || v.tarifaRef?.codMunicipio || '',
        placa: v.placa, remolque: v.remolque || '', conductor: v.conductor?._id || '', titular: v.titular?._id || '', titularInicial: v.titular?._id || '',
        pesoKg: v.pesoKg, destinatario: { tipoId: v.destinatario?.tipoId || '', numId: v.destinatario?.numId || '', sede: v.destinatario?.sede || '' },
        flete: v.flete, anticipo: v.anticipo, observaciones: v.observaciones || '',
        numeroRemesa: p.numeros?.manualRemesa || '', numeroManifiesto: p.numeros?.manualManifiesto || '',
      });
      // Si el viaje no tiene origen propio se muestra el que se enviará (el de la empresa)
      const origen = p.manifiesto.variables.find((x: string[]) => x[0] === 'CODMUNICIPIOORIGENMANIFIESTO')?.[1];
      if (!this.form().codOrigen && origen) this.form.update(f => ({ ...f, codOrigen: origen }));
      this.previa.set(p);
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
    if (/MAN130|titular no existe/i.test(t)) return 'El titular no está registrado en el RNDC. Use «Registrar de nuevo» junto al TITULAR (arriba) o cambie el titular en «Viaje» y presione «Corregir y reenviar».';
    if (/conductor.*no existe|MAN12\d/i.test(t)) return 'El conductor no está registrado en el RNDC. Use «Registrar de nuevo» junto al CONDUCTOR o elija otro conductor y reenvíe.';
    if (/MAN353|municipio origen/i.test(t)) return 'El origen del manifiesto debe ser el municipio de la remesa (el de la sede del remitente). La plataforma ya lo toma así: presione «Corregir y reenviar».';
    if (/MAN275|FOPAT/i.test(t)) return 'El RNDC exige la retención FOPAT (0,1 % del flete) para este vehículo. La plataforma ya la calcula: presione «Corregir y reenviar».';
    if (/MAN270|anticipo supera/i.test(t)) return 'El anticipo no puede ser mayor que el neto a pagar (flete menos retenciones). La plataforma lo ajusta al neto: presione «Corregir y reenviar».';
    if (/REM060|REM380|REM382|cantidad/i.test(t)) return 'Falta la cantidad cargada. Escriba el peso de la carga en kg en «Carga (remesa)» y presione «Corregir y reenviar».';
    if (/MAN354|municipio destino/i.test(t)) return 'El destino del manifiesto debe ser el mismo municipio de la remesa (el de la sede del destinatario). La plataforma ya lo toma así: presione «Corregir y reenviar».';
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
  async traerSedesCliente() {
    const cli = this.previa()?.cliente; const id = this.viajeId();
    if (!cli || !id) return;
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      const [r] = await this.api.post<any[]>('/rndc/importar/terceros', { clave: c, roles: ['destinatario'], documentos: [{ tipoId: cli.tipoId, numId: cli.numId }] });
      if (!r?.ok) { this.avisos.mostrar(r?.mensaje || 'El RNDC no devolvió sedes', 'error'); if (/usuario|contrase|clave/i.test(r?.mensaje || '')) this.clave.olvidar(); return; }
      const antes = this.previa()?.sedesCliente?.length || 0;
      const p = await this.api.get<any>(`/rndc/viajes/${id}/vista-previa`);
      this.previa.set(p);
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
    return ({ viaje: 'definido en este viaje', tarifa: 'definido en la tarifa del destino', municipio: 'sede del cliente en el municipio de destino',
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
    if (!p.remesaAceptada) c.numeroRemesa = String(f.numeroRemesa || '').trim().toUpperCase();
    if (p.documentos.manifiesto.estado !== 'aceptado') c.numeroManifiesto = String(f.numeroManifiesto || '').trim().toUpperCase();
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

  async enviar() {
    const id = this.viajeId();
    if (!id || !(await this.guardar(true))) return;
    const c = await this.clave.obtener();
    if (!c) return;
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
