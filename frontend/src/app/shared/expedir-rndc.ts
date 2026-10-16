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

// Expedición de remesa y manifiesto de un viaje: revisar y corregir los datos,
// enviar al RNDC y, si hay rechazo, ver la respuesta real del RNDC, corregir y reenviar.
@Component({
  selector: 'app-expedir-rndc',
  imports: [FormsModule, Modal, Icono, Moneda, SelectorMunicipio, BuscarTercero, ...FORMATOS],
  template: `
    <app-modal [titulo]="'Expedir viaje N° ' + (viaje()?.numero || '')" [abierto]="!!viajeId()" (cerrar)="cerrar.emit()" [ancho]="true">
      @if (previa(); as p) {
        <!-- Estado de los documentos -->
        <div class="estado">
          <span>Cliente: <strong>{{ viaje()?.cliente?.nombre }}</strong></span>
          <span>Remesa: <span class="chip" [class]="chip(p.documentos.remesa.estado)">{{ p.documentos.remesa.numero || 'nueva' }} · {{ p.documentos.remesa.estado || 'sin enviar' }}</span></span>
          <span>Manifiesto: <span class="chip" [class]="chip(p.documentos.manifiesto.estado)">{{ p.documentos.manifiesto.numero || 'nuevo' }} · {{ p.documentos.manifiesto.estado || 'sin enviar' }}</span></span>
          @if (p.ambiente !== 'PRODUCCION') { <span class="chip alerta sin-punto">Ambiente {{ p.ambiente === 'SIMULADO' ? 'simulador' : 'de pruebas' }}</span> }
        </div>

        @if (resultado(); as r) { <div class="mensaje" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.texto }}</div> }
        @if (p.ultimoError; as e) {
          <div class="mensaje error respuesta">
            <strong>El RNDC respondió ({{ e.proceso === 3 ? 'remesa' : e.proceso === 4 ? 'manifiesto' : 'proceso ' + e.proceso }}, {{ e.fecha | fechaHora }}):</strong>
            <span>{{ e.mensaje }}</span>
            <small>Corrija los datos abajo (o el vehículo / conductor) y vuelva a enviar.</small>
          </div>
        }
        @if (faltan().length) {
          <div class="mensaje error"><strong>Faltan datos según el diccionario del RNDC:</strong><ul>@for (x of faltan(); track x) { <li>{{ x }}</li> }</ul></div>
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
              @if (m.id && m.estado !== 'enviado' && !m.faltantes?.length) {
                <button type="button" class="pequeno" (click)="registrarMaestro(m)" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="14" />Registrar en el RNDC</button>
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
          </div>
          <p class="sutil" style="margin:10px 0 0;font-size:12.5px">El titular del manifiesto se toma del vehículo (titular habitual); si no tiene, es el conductor.</p></fieldset>

          @if (!p.remesaAceptada) {
            <fieldset><legend>Carga (remesa)</legend><div class="formulario">
              <div class="campo"><label for="ex-peso">Cantidad cargada (kg)</label><input id="ex-peso" type="number" min="0" name="peso" [(ngModel)]="f.pesoKg" required /></div>
              <div class="campo"><label for="ex-dt">Destinatario</label>
                <select id="ex-dt" name="dtipo" [(ngModel)]="f.destinatario.tipoId"><option value="">El mismo cliente</option>@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
              @if (f.destinatario.tipoId) {
                <div class="campo"><label for="ex-dn">Documento del destinatario</label><input id="ex-dn" name="dnum" [(ngModel)]="f.destinatario.numId" maxlength="15" /></div>
                <div class="campo"><label for="ex-ds">Sede del destinatario</label><input id="ex-ds" name="dsede" [(ngModel)]="f.destinatario.sede" maxlength="6" /></div>
              }
            </div></fieldset>
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
          </div></fieldset>
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
          <button type="button" (click)="sinManifiesto()" [disabled]="trabajando()" style="margin-right:auto" title="Quitar este viaje de la lista de manifiestos">No requiere manifiesto</button>
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
    h3 { margin: 6px 0 8px; font-size: 14px; }
    .maestros { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; }
    .maestros li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .rol { font-size: 12px; font-weight: 700; color: var(--gris-5); text-transform: uppercase; letter-spacing: .04em; min-width: 76px; }
    .ref { font-weight: 600; }
    .falta { color: var(--rojo-texto); flex-basis: 100%; }
    fieldset + fieldset { margin-top: 12px; }
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
        placa: v.placa, remolque: v.remolque || '', conductor: v.conductor?._id || '', titular: v.titular?._id || '',
        pesoKg: v.pesoKg, destinatario: { tipoId: v.destinatario?.tipoId || '', numId: v.destinatario?.numId || '', sede: v.destinatario?.sede || '' },
        flete: v.flete, anticipo: v.anticipo, observaciones: v.observaciones || '',
      });
      // Si el viaje no tiene origen propio se muestra el que se enviará (el de la empresa)
      const origen = p.manifiesto.variables.find((x: string[]) => x[0] === 'CODMUNICIPIOORIGENMANIFIESTO')?.[1];
      if (!this.form().codOrigen && origen) this.form.update(f => ({ ...f, codOrigen: origen }));
      this.previa.set(p);
    } catch (e) { this.avisos.error(e); this.cerrar.emit(); }
  }

  chip(e: string) { return ({ aceptado: 'ok', rechazado: 'error', anulado: 'alerta' } as Record<string, string>)[e] || ''; }
  chipMaestro(e: string) { return ({ enviado: 'ok', error: 'error', no_existe: 'error' } as Record<string, string>)[e] || 'alerta'; }
  estadoMaestro(e: string) { return ({ enviado: 'Registrado', error: 'Con error', no_existe: 'No está en Vehículos' } as Record<string, string>)[e] || 'Sin registrar'; }
  etiquetas(f: any[]) { return f.map(x => x.etiqueta).join(', '); }

  // Solo se envían los datos permitidos según el estado y el rol.
  private cuerpo() {
    const f = this.form(); const p = this.previa();
    const c: any = { codOrigen: f.codOrigen || '', codDestino: f.codDestino || '', placa: String(f.placa || '').toUpperCase(),
      remolque: String(f.remolque || '').toUpperCase(), observaciones: f.observaciones || '' };
    if (f.conductor) c.conductor = f.conductor;
    if (!p.remesaAceptada) { c.fecha = f.fecha; c.pesoKg = Number(f.pesoKg) || 0; c.destinatario = f.destinatario.tipoId ? f.destinatario : { tipoId: '', numId: '', sede: '' }; }
    if (this.puedeValores) { c.flete = Number(f.flete) || 0; c.anticipo = Number(f.anticipo) || 0; }
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
      const r = await this.api.post<any>(`/rndc/${m.tipo === 'vehiculo' ? 'vehiculos' : 'terceros'}/${m.id}/enviar`, { clave: c });
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
    if (!id || !confirm('¿Marcar este viaje como «no requiere manifiesto»? Saldrá de la lista de Manifiestos RNDC.')) return;
    this.trabajando.set(true);
    try {
      await this.api.put(`/rndc/viajes/${id}/datos`, { requiereManifiesto: false });
      this.avisos.ok('El viaje quedó marcado como sin manifiesto');
      this.actualizado.emit(); this.cerrar.emit();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
