import { Component, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from './modal';
import { VisorPdf } from './visor-pdf';
import { Confirmar } from './confirmar';
import { leerArchivos } from './adjuntos';
import { FORMATOS } from './formato';

const lista = (t: string) => String(t || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

// Fase 11: Relaciones generadas. Historial con su estado (Borrador → Enviada → Facturada), envío por correo con la
// plantilla de la empresa, envío por WhatsApp a sus contactos (enlace propio de la relación), facturar y reabrir.
@Component({
  selector: 'app-relaciones-generadas',
  imports: [FormsModule, Modal, VisorPdf, Confirmar, ...FORMATOS],
  template: `
    <app-visor-pdf />
    <section class="tarjeta filtros">
      <div class="campo"><label for="rh-cli">Empresa</label>
        <select id="rh-cli" [(ngModel)]="f.cliente" (change)="cargar()"><option value="">(Todas)</option>
          @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
      <div class="campo"><label for="rh-est">Estado</label>
        <select id="rh-est" [(ngModel)]="f.estado" (change)="cargar()"><option value="">(Todos)</option><option value="borrador">Borrador</option>
          <option value="enviada">Enviada</option><option value="facturada">Facturada</option></select></div>
      <div class="campo"><label for="rh-an">Año</label>
        <select id="rh-an" [(ngModel)]="f.anio" (change)="cargar()">@for (a of ANIOS; track a) { <option [ngValue]="a">{{ a }}</option> }</select></div>
      <div class="crece"></div>
      <button type="button" (click)="generar.emit()">+ Generar relación</button>
    </section>

    <section class="tarjeta">
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>N°</th><th>Empresa</th><th>Periodo</th><th>Grupo</th><th class="num">Viajes</th><th class="num">Total</th><th>Estado</th><th>Enviada</th><th></th></tr></thead>
        <tbody>
          @for (x of filas(); track x._id) {
            <tr>
              <td data-etiqueta="N°" class="nw"><strong>{{ x.numero }}</strong></td>
              <td data-etiqueta="Empresa">{{ x.cliente }}</td>
              <td data-etiqueta="Periodo">{{ x.desde | dia }} – {{ x.hasta | dia }}</td>
              <td data-etiqueta="Grupo">{{ x.grupo || 'Todos' }}</td>
              <td data-etiqueta="Viajes" class="num">{{ x.totales.viajes }}</td>
              <td data-etiqueta="Total" class="num">{{ x.totales.total | pesos }}</td>
              <td data-etiqueta="Estado">
                @if (x.estado === 'facturada') { <span class="chip ok sin-punto">🔒 Facturada {{ x.factura?.numero }}</span> }
                @else if (x.estado === 'enviada') { <span class="chip info sin-punto">Enviada</span> }
                @else { <span class="chip sin-punto">Borrador</span> }</td>
              <td data-etiqueta="Enviada" class="envios">
                @if (x.ultimoCorreo) { <span>✉ {{ x.ultimoCorreo.fecha | dia }}{{ x.ultimoCorreo.estado === 'error' ? ' · error' : '' }}</span> }
                @if (x.ultimoWhatsapp) { <span>WhatsApp {{ x.ultimoWhatsapp.fecha | dia }}</span> }
                @if (x.abierto) { <span class="abierta">Abierta {{ x.abierto | dia }}</span> }
                @if (!x.ultimoCorreo && !x.ultimoWhatsapp) { <span class="sutil">—</span> }</td>
              <td class="acciones-fila">
                <button type="button" class="pequeno" (click)="ver(x)">Ver</button>
                <button type="button" class="pequeno" (click)="excel(x)">Excel</button>
                @if (puedeGestionar) {
                  <button type="button" class="pequeno oscuro" (click)="abrirCorreo(x)">✉ Correo</button>
                  <button type="button" class="pequeno whatsapp" (click)="abrirWhatsapp(x)">WhatsApp</button>
                }
                @if (x.estado !== 'facturada' && puedeFacturar) { <button type="button" class="pequeno primario" (click)="abrirFactura(x)">Marcar facturada</button> }
                @if (x.estado === 'facturada' && esAdmin) { <button type="button" class="pequeno texto" (click)="abrirReabrir(x)">Reabrir</button> }
                @if (x.estado === 'borrador' && puedeGestionar) { <button type="button" class="pequeno texto peligro" confirmar="Clic otra vez para eliminar" (confirmado)="eliminar(x)">Eliminar</button> }
              </td>
            </tr>
          } @empty { <tr><td colspan="9" class="vacio">No hay relaciones guardadas con estos filtros. Genere una en «Generar relación».</td></tr> }
        </tbody>
      </table></div>
      <p class="sutil nota">Una relación <strong>facturada</strong> queda cerrada: sus viajes ya no se pueden editar, eliminar ni volver a cobrar.
        Si hay que corregir, el administrador la reabre con un motivo y queda en el historial.</p>
    </section>

    <!-- Correo con la plantilla de la empresa -->
    <app-modal [titulo]="'Enviar por correo · ' + (correo()?.numero || '')" [abierto]="!!correo()" (cerrar)="correo.set(null)" [ancho]="true">
      @if (correo(); as c) {
        <p class="sutil" style="margin-top:0">Los correos y el mensaje salen de la ficha de la empresa (Configuración → Correo → Relaciones){{ c.propia ? '' : ' · plantilla general' }}. Puede cambiarlos aquí solo para este envío.</p>
        <div class="formulario" style="grid-template-columns:1fr">
          <div class="campo"><label for="rc-para">Para</label><input id="rc-para" [(ngModel)]="c.paraTxt" placeholder="correo@empresa.com, otro@empresa.com" /></div>
          <div class="campo"><label for="rc-cc">Copia</label><input id="rc-cc" [(ngModel)]="c.ccTxt" /></div>
          <div class="campo"><label for="rc-as">Asunto</label><input id="rc-as" [(ngModel)]="c.asunto" maxlength="200" /></div>
          <div class="campo"><label for="rc-cu">Mensaje</label><textarea id="rc-cu" rows="10" [(ngModel)]="c.cuerpo" maxlength="4000"></textarea></div>
          <p style="margin:0"><strong>Adjuntos:</strong> {{ c.adjuntosBase.join(' · ') }}</p>
          <div class="campo"><label for="rc-adj">Otros archivos (opcional)</label><input id="rc-adj" type="file" multiple (change)="leerAdjuntos($event, c)" /></div>
        </div>
      }
      <ng-container pie><button type="button" (click)="correo.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="enviarCorreo()" [disabled]="ocupado() || !correo()?.paraTxt">{{ ocupado() ? 'Enviando…' : 'Enviar correo' }}</button></ng-container>
    </app-modal>

    <!-- WhatsApp a los contactos de la empresa -->
    <app-modal [titulo]="'Enviar por WhatsApp · ' + (wa()?.numero || '')" [abierto]="!!wa()" (cerrar)="cerrarWa()" [ancho]="true">
      @if (wa(); as w) {
        <p class="sutil" style="margin-top:0">Se abre WhatsApp con el mensaje listo; usted oprime enviar. El mensaje lleva el enlace de la relación para verla y descargar el PDF y el Excel.</p>
        @if (w.sinContactos) {
          <div class="aviso">La empresa no tiene contactos de WhatsApp. Agréguelos en Configuración → Correo → Relaciones, o copie el enlace y compártalo.</div>
        }
        @for (k of w.contactos; track $index) {
          <div class="contacto"><div class="crece"><strong>{{ k.nombre }}</strong>{{ k.cargo ? ' · ' + k.cargo : '' }}<small class="linea sutil">{{ k.celular }}{{ k.error ? ' · ' + k.error : '' }}</small></div>
            @if (k.wa) { <a class="boton whatsapp" [href]="k.wa" target="_blank" rel="noopener" (click)="marcarWa(k)">{{ k.enviado ? 'Enviar otra vez' : 'Enviar' }}</a> }</div>
        }
        <div class="enlace"><code>{{ w.enlace }}</code><button type="button" class="pequeno" (click)="copiar(w.enlace)">Copiar enlace</button></div>
        @if (w.contactos[0]?.texto) { <p class="sutil" style="margin:10px 0 4px">Mensaje</p><div class="msj">{{ w.contactos[0].texto }}</div> }
      }
      <ng-container pie><button type="button" class="primario" (click)="cerrarWa()">Listo</button></ng-container>
    </app-modal>

    <!-- Marcar facturada -->
    <app-modal [titulo]="'Marcar como facturada · ' + (fac()?.numero || '')" [abierto]="!!fac()" (cerrar)="fac.set(null)">
      @if (fac(); as x) {
        <div class="formulario">
          <div class="campo"><label for="rf-n">N° de factura</label><input id="rf-n" [(ngModel)]="x.factura" maxlength="40" placeholder="FE-1851" /></div>
          <div class="campo"><label for="rf-f">Fecha</label><input id="rf-f" type="date" [(ngModel)]="x.fecha" /></div>
        </div>
        <p class="sutil">Al facturarla, sus {{ x.totales.viajes }} viajes quedan cerrados: no se pueden editar, eliminar ni cobrar en otra relación.</p>
      }
      <ng-container pie><button type="button" (click)="fac.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="facturar()" [disabled]="ocupado() || !fac()?.factura">Marcar facturada</button></ng-container>
    </app-modal>

    <!-- Reabrir -->
    <app-modal [titulo]="'Reabrir · ' + (reab()?.numero || '')" [abierto]="!!reab()" (cerrar)="reab.set(null)">
      @if (reab(); as x) {
        <p class="sutil" style="margin-top:0">Solo el administrador. El motivo queda en el historial y la relación vuelve a «Enviada».</p>
        <div class="campo"><label for="rr-m">Motivo</label><textarea id="rr-m" rows="3" [(ngModel)]="x.motivo" maxlength="300"></textarea></div>
      }
      <ng-container pie><button type="button" (click)="reab.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="reabrir()" [disabled]="ocupado() || (reab()?.motivo || '').length < 10">Reabrir</button></ng-container>
    </app-modal>`,
  styles: [`
    .tarjeta { background: var(--gris-0, #fff); border: 1px solid var(--gris-2); border-radius: var(--radio-l, 14px); padding: 14px 16px; margin-bottom: 14px; }
    .filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; } .filtros .campo { margin: 0; display: flex; flex-direction: column; gap: 5px; } .crece { flex: 1; }
    .envios span { display: block; font-size: 12px; } .envios .abierta { color: #1e8e4f; font-weight: 600; }
    .acciones-fila { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    button.oscuro { background: #0d1117; color: #fff; border-color: #0d1117; }
    button.whatsapp, a.boton.whatsapp { background: var(--whatsapp, #1fa855); border-color: var(--whatsapp, #1fa855); color: #fff; }
    a.boton.whatsapp { display: inline-flex; align-items: center; padding: 8px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; }
    .contacto { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--gris-2); border-radius: 10px; margin-top: 8px; }
    .contacto .crece { flex: 1; } .linea { display: block; margin-top: 2px; } .nw { white-space: nowrap; }
    .enlace { display: flex; gap: 8px; align-items: center; margin-top: 12px; } .enlace code { font-size: 12px; color: var(--gris-6); word-break: break-all; }
    .msj { background: #e7f8dc; border-radius: 10px; padding: 10px 12px; white-space: pre-line; font-size: 12.5px; line-height: 1.45; }
    .aviso { background: #fff4e0; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
    .nota { margin: 10px 0 0; font-size: 12.5px; }
  `],
})
export class RelacionesGeneradas {
  private api = inject(Api); private avisos = inject(Avisos); private auth = inject(Auth);
  private visor = viewChild.required(VisorPdf);
  readonly clientes = input<any[]>([]);
  readonly generar = output<void>();
  readonly puedeGestionar = this.auth.tiene(P.LIQUIDACION_GESTIONAR, P.VIAJES_REGISTRAR, P.CONTABILIDAD_GESTIONAR);
  readonly puedeFacturar = this.auth.tiene(P.LIQUIDACION_GESTIONAR, P.CONTABILIDAD_GESTIONAR);
  readonly esAdmin = this.auth.tiene(P.CONFIG_GESTIONAR);
  readonly ANIOS = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2]; })();
  f = { cliente: '', estado: '', anio: new Date().getFullYear() };
  readonly filas = signal<any[]>([]);
  readonly ocupado = signal(false);
  readonly correo = signal<any>(null);
  readonly wa = signal<any>(null);
  readonly fac = signal<any>(null);
  readonly reab = signal<any>(null);

  constructor() { this.cargar(); }
  async cargar() {
    try { this.filas.set(await this.api.get<any[]>('/gestion/relaciones-cobro', { cliente: this.f.cliente, estado: this.f.estado, anio: String(this.f.anio) })); }
    catch (e) { this.avisos.error(e); }
  }
  ver(x: any) { this.visor().ver(`/gestion/relaciones-cobro/${x._id}/archivo`, `Relación ${x.numero}`, { formato: 'pdf', ver: '1' }); }
  excel(x: any) { this.api.descargar(`/gestion/relaciones-cobro/${x._id}/archivo`, { formato: 'xlsx' }, `Relacion_${x.numero}.xlsx`).catch(e => this.avisos.error(e)); }

  async abrirCorreo(x: any) {
    try {
      const p = await this.api.get<any>(`/gestion/relaciones-cobro/${x._id}/correo`);
      this.correo.set({ _id: x._id, numero: x.numero, paraTxt: p.para.join(', '), ccTxt: p.cc.join(', '), asunto: p.asunto, cuerpo: p.cuerpo,
        adjuntosBase: p.adjuntos, propia: p.propia, adjuntos: [] as any[] });
    } catch (e) { this.avisos.error(e); }
  }
  async leerAdjuntos(ev: Event, c: any) { c.adjuntos = await leerArchivos(ev, this.avisos); }
  async enviarCorreo() {
    const c = this.correo(); this.ocupado.set(true);
    try {
      await this.api.post(`/gestion/relaciones-cobro/${c._id}/correo`, { para: lista(c.paraTxt), cc: lista(c.ccTxt), asunto: c.asunto, cuerpo: c.cuerpo, adjuntos: c.adjuntos });
      this.avisos.ok(`Relación ${c.numero} enviada por correo`); this.correo.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }

  async abrirWhatsapp(x: any) {
    try { this.wa.set({ _id: x._id, numero: x.numero, ...(await this.api.post<any>(`/gestion/relaciones-cobro/${x._id}/whatsapp`, {})) }); }
    catch (e) { this.avisos.error(e); }
  }
  async marcarWa(k: any) {
    const w = this.wa();
    try { await this.api.put(`/gestion/relaciones-cobro/${w._id}/whatsapp/enviado`, { para: `${k.nombre} ${k.celular}`.trim() }); k.enviado = true; }
    catch (e) { this.avisos.error(e); }
  }
  cerrarWa() { this.wa.set(null); this.cargar(); }
  async copiar(t: string) { try { await navigator.clipboard.writeText(t); this.avisos.ok('Enlace copiado'); } catch { this.avisos.error('No se pudo copiar'); } }

  abrirFactura(x: any) { this.fac.set({ ...x, factura: '', fecha: new Date().toISOString().slice(0, 10) }); }
  async facturar() {
    const x = this.fac(); this.ocupado.set(true);
    try { await this.api.put(`/gestion/relaciones-cobro/${x._id}/facturar`, { factura: x.factura, fecha: x.fecha }); this.avisos.ok(`Relación ${x.numero} facturada`); this.fac.set(null); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
  abrirReabrir(x: any) { this.reab.set({ ...x, motivo: '' }); }
  async reabrir() {
    const x = this.reab(); this.ocupado.set(true);
    try { await this.api.put(`/gestion/relaciones-cobro/${x._id}/reabrir`, { motivo: x.motivo }); this.avisos.ok(`Relación ${x.numero} reabierta`); this.reab.set(null); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
  async eliminar(x: any) {
    try { await this.api.delete(`/gestion/relaciones-cobro/${x._id}`); this.avisos.ok(`Relación ${x.numero} eliminada`); this.cargar(); }
    catch (e) { this.avisos.error(e); }
  }
}
