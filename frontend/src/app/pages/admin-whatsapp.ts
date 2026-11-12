import { Paginador } from '../shared/paginador';
import { PaginaLocal } from '../shared/pagina-local';
import { Component, inject, signal } from '@angular/core';
import { Modal } from '../shared/modal';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { CUERPO_PLANTILLA } from '../shared/config-whatsapp';

// SuperAdmin: número de WhatsApp de Translogística, usado por las empresas sin número propio, y mensajes por empresa.
@Component({
  selector: 'app-admin-whatsapp',
  imports: [FormsModule, Modal, Paginador],
  template: `
    <div class="pagina-cab"><div><h1>WhatsApp Business</h1>
      <p class="sutil">Cuenta y número de cada empresa, administrados por separado. Los datos de una empresa no afectan a las demás.</p></div></div>

    <div class="tarjeta" style="margin-bottom:16px">
      <h2>Empresas</h2>
      <table class="tabla-movil"><thead><tr><th>Empresa</th><th>Número</th><th>Estado</th><th></th></tr></thead>
        <tbody>@for (e of pagEmpresas.items(); track e._id) {
          <tr><td data-etiqueta="Empresa"><strong>{{ e.nombre }}</strong> <small class="sutil">NIT {{ e.nit }}{{ e.dv ? '-' + e.dv : '' }}</small></td>
            <td data-etiqueta="Número">{{ e.modo === 'propia' ? 'Propio' : 'Translogística' }}</td>
            <td data-etiqueta="Estado"><span class="chip" [class.ok]="e.activo">{{ e.activo ? 'Activo' : 'Sin activar' }}</span></td>
            <td class="celda-acciones"><button class="pequeno" (click)="abrirEmpresa(e)">Configurar</button></td></tr>
        } @empty { <tr><td colspan="4" class="vacio">Sin empresas</td></tr> }</tbody></table>
        <app-paginador [total]="pagEmpresas.total()" [pagina]="pagEmpresas.pagina()" [porPagina]="pagEmpresas.porPagina()" unidad="empresas" (cambio)="pagEmpresas.ir($event)" />
    </div>

    <app-modal [titulo]="'WhatsApp · ' + (empresa()?.nombre || '')" [abierto]="!!empresa()" (cerrar)="empresa.set(null)" [ancho]="true">
      @if (cfgEmpresa(); as c) {
        <form id="form-wa-empresa" (ngSubmit)="guardarEmpresa()">
          <label class="casilla" style="margin-bottom:12px"><input type="checkbox" name="eact" [(ngModel)]="c.activo" />Enviar manifiestos por WhatsApp</label>
          <div class="segmentos" role="group" aria-label="Número" style="margin-bottom:12px">
            <button type="button" [class.activo]="c.modo === 'propia'" (click)="c.modo = 'propia'">Número propio</button>
            <button type="button" [class.activo]="c.modo !== 'propia'" (click)="c.modo = 'plataforma'">Número de Translogística</button>
          </div>
          @if (c.modo === 'propia') {
            <div class="formulario">
              <div class="campo"><label for="we-num">Identificador del número (Phone number ID)</label><input id="we-num" name="enum" inputmode="numeric" [(ngModel)]="c.phoneNumberId" /></div>
              <div class="campo"><label for="we-waba">Identificador de la cuenta (WABA ID)</label><input id="we-waba" name="ewaba" inputmode="numeric" [(ngModel)]="c.wabaId" /></div>
              <div class="campo"><label for="we-tok">Token permanente</label><input id="we-tok" name="etok" type="password" autocomplete="new-password" [(ngModel)]="tokenEmpresa" [placeholder]="c.tieneToken ? 'Guardado. Escriba solo para cambiarlo' : ''" /></div>
              <div class="campo"><label for="we-sec">Secreto de la app (App secret)</label><input id="we-sec" name="esec" type="password" autocomplete="new-password" [(ngModel)]="secretoEmpresa" [placeholder]="c.tieneSecreto ? 'Guardado. Escriba solo para cambiarlo' : ''" /></div>
              <div class="campo"><label for="we-pla">Nombre de la plantilla aprobada</label><input id="we-pla" name="epla" [(ngModel)]="c.plantilla" /></div>
              <div class="campo"><label for="we-idi">Idioma de la plantilla</label><input id="we-idi" name="eidi" maxlength="5" [(ngModel)]="c.idioma" /></div>
              <div class="campo ancho"><label for="we-url">Webhook: dirección de devolución de llamada</label><input id="we-url" readonly [value]="c.webhookUrl" /></div>
              <div class="campo ancho"><label for="we-ver">Webhook: token de verificación</label><input id="we-ver" readonly [value]="c.webhookToken || 'Se genera al guardar'" /></div>
            </div>
            <p class="sutil" style="margin-top:12px">Plantilla: categoría <strong>Utilidad</strong>, encabezado <strong>Documento</strong> y este cuerpo.</p>
            <pre class="plantilla">{{ cuerpo }}</pre>
          } @else if (!c.plataformaLista) {
            <div class="mensaje alerta">La cuenta de WhatsApp de Translogística todavía no está disponible.</div>
          }
          @if (pruebaEmpresa(); as p) { <div class="mensaje" [class.ok]="p.ok" [class.error]="!p.ok" style="margin-top:12px" role="status">
            {{ p.ok ? 'Conectado: ' + p.nombre + ' · ' + p.numero : p.error }}</div> }
        </form>
      }
      <ng-container pie>
        <button type="button" (click)="empresa.set(null)">Cerrar</button>
        <button type="button" (click)="probarEmpresa()" [disabled]="trabajando() || !cfgEmpresa()?.activo">Probar conexión</button>
        <button class="primario" type="submit" form="form-wa-empresa" [disabled]="trabajando()">Guardar</button>
      </ng-container>
    </app-modal>

    <h2>Número de Translogística</h2>
    <p class="sutil">Opcional. Lo usan las empresas que escojan «Número de Translogística».</p>
    @if (cfg(); as c) {
      <form class="tarjeta" (ngSubmit)="guardar()">
        @if (c.activo && c.tieneToken) { <div class="mensaje ok">Cuenta activa.</div> }
        <label class="casilla" style="margin:8px 0 12px"><input type="checkbox" name="activo" [(ngModel)]="c.activo" />Cuenta disponible para las empresas</label>
        <div class="formulario">
          <div class="campo"><label for="wp-num">Identificador del número (Phone number ID)</label><input id="wp-num" name="num" inputmode="numeric" [(ngModel)]="c.phoneNumberId" /></div>
          <div class="campo"><label for="wp-waba">Identificador de la cuenta (WABA ID)</label><input id="wp-waba" name="waba" inputmode="numeric" [(ngModel)]="c.wabaId" /></div>
          <div class="campo"><label for="wp-token">Token permanente</label>
            <input id="wp-token" name="token" type="password" autocomplete="new-password" [(ngModel)]="token" [placeholder]="c.tieneToken ? 'Guardado. Escriba solo para cambiarlo' : ''" /></div>
          <div class="campo"><label for="wp-sec">Secreto de la app (App secret)</label>
            <input id="wp-sec" name="sec" type="password" autocomplete="new-password" [(ngModel)]="secreto" [placeholder]="c.tieneSecreto ? 'Guardado. Escriba solo para cambiarlo' : ''" /></div>
          <div class="campo"><label for="wp-pla">Nombre de la plantilla aprobada</label><input id="wp-pla" name="pla" [(ngModel)]="c.plantilla" /></div>
          <div class="campo"><label for="wp-idi">Idioma de la plantilla</label><input id="wp-idi" name="idi" maxlength="5" [(ngModel)]="c.idioma" /><small>El mismo con el que se aprobó, por ejemplo es o es_CO.</small></div>
        </div>
        <div class="acciones" style="margin-top:14px">
          <button class="primario" type="submit" [disabled]="trabajando()">Guardar</button>
          <button type="button" (click)="probar()" [disabled]="trabajando() || !c.tieneToken">Probar conexión</button>
        </div>
        @if (prueba(); as p) { <div class="mensaje" [class.ok]="p.ok" [class.error]="!p.ok" style="margin-top:12px" role="status">
          {{ p.ok ? 'Conectado: ' + p.nombre + ' · ' + p.numero : p.error }}</div> }
      </form>

      <div class="tarjeta" style="margin-top:16px">
        <h2>Datos para configurar en Meta</h2>
        <p class="sutil">Webhook: en la app de Meta, WhatsApp → Configuración → Webhook. Suscriba el campo <strong>messages</strong>.</p>
        <div class="formulario">
          <div class="campo ancho"><label for="wp-url">Dirección de devolución de llamada</label><input id="wp-url" readonly [value]="c.webhookUrl" /></div>
          <div class="campo ancho"><label for="wp-ver">Token de verificación</label><input id="wp-ver" readonly [value]="c.webhookToken || 'Se genera al guardar'" /></div>
        </div>
        <p class="sutil" style="margin-top:12px">Plantilla: categoría <strong>Utilidad</strong>, encabezado <strong>Documento</strong> y este cuerpo.</p>
        <pre class="plantilla">{{ cuerpo }}</pre>
      </div>
    }

    <div class="tarjeta" style="margin-top:16px">
      <div class="barra-mes"><h2>Mensajes enviados por empresa</h2>
        <div class="campo"><label for="wp-mes">Mes</label><input id="wp-mes" type="month" [ngModel]="mes()" (ngModelChange)="cambiarMes($event)" /></div></div>
      <table class="tabla-movil"><thead><tr><th>Empresa</th><th>Número</th><th class="num">Mensajes</th></tr></thead>
        <tbody>@for (f of pagConsumo.items(); track f.empresa + f.cuenta) {
          <tr><td data-etiqueta="Empresa">{{ f.empresa }}</td><td data-etiqueta="Número">{{ f.cuenta === 'propia' ? 'Propio' : 'Translogística' }}</td><td class="num" data-etiqueta="Mensajes">{{ f.mensajes }}</td></tr>
        } @empty { <tr><td colspan="3" class="vacio">Sin mensajes enviados este mes.</td></tr> }</tbody></table>
        <app-paginador [total]="pagConsumo.total()" [pagina]="pagConsumo.pagina()" [porPagina]="pagConsumo.porPagina()" unidad="empresas" (cambio)="pagConsumo.ir($event)" />
    </div>`,
  styles: [`.plantilla { background: var(--gris-1); border: 1px solid var(--gris-2); border-radius: 10px; padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; margin: 8px 0 0; }
    .barra-mes { display: flex; gap: 12px; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
    .barra-mes h2 { margin: 0; }
    table { width: 100%; }`],
})
export class AdminWhatsapp {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly cuerpo = CUERPO_PLANTILLA;
  readonly cfg = signal<any>(null);
  readonly consumo = signal<any[]>([]);
  readonly mes = signal('');
  readonly trabajando = signal(false);
  readonly prueba = signal<any>(null);
  token = '';
  secreto = '';

  readonly empresas = signal<any[]>([]);
  readonly pagEmpresas = new PaginaLocal<any>(() => this.empresas());
  readonly pagConsumo = new PaginaLocal<any>(() => this.consumo());
  readonly empresa = signal<any>(null);
  readonly cfgEmpresa = signal<any>(null);
  readonly pruebaEmpresa = signal<any>(null);
  tokenEmpresa = '';
  secretoEmpresa = '';

  constructor() { this.cargar(); this.cargarConsumo(); this.cargarEmpresas(); }

  async cargarEmpresas() {
    try { this.empresas.set(await this.api.get<any[]>('/admin/whatsapp/empresas')); } catch (e) { this.avisos.error(e); }
  }
  async abrirEmpresa(e: any) {
    this.tokenEmpresa = ''; this.secretoEmpresa = ''; this.pruebaEmpresa.set(null); this.cfgEmpresa.set(null); this.empresa.set(e);
    try {
      const c = await this.api.get<any>(`/admin/whatsapp/empresas/${e._id}`);
      if (this.empresa()?._id === e._id) this.cfgEmpresa.set(c);
    } catch (x) { this.avisos.error(x); this.empresa.set(null); }
  }
  async guardarEmpresa() {
    const c = this.cfgEmpresa(); const e = this.empresa();
    this.trabajando.set(true); this.pruebaEmpresa.set(null);
    try {
      await this.api.put(`/admin/whatsapp/empresas/${e._id}`, { activo: !!c.activo, modo: c.modo || 'propia', phoneNumberId: c.phoneNumberId || '', wabaId: c.wabaId || '', plantilla: c.plantilla, idioma: c.idioma,
        ...(this.tokenEmpresa ? { token: this.tokenEmpresa } : {}), ...(this.secretoEmpresa ? { appSecret: this.secretoEmpresa } : {}) });
      this.avisos.ok(`WhatsApp de ${e.nombre} guardado`);
      await this.abrirEmpresa(e); await this.cargarEmpresas();
    } catch (x) { this.avisos.error(x); } finally { this.trabajando.set(false); }
  }
  async probarEmpresa() {
    this.trabajando.set(true);
    try { this.pruebaEmpresa.set(await this.api.post(`/admin/whatsapp/empresas/${this.empresa()._id}/probar`)); }
    catch (x) { this.avisos.error(x); } finally { this.trabajando.set(false); }
  }

  async cargar() {
    try { this.cfg.set(await this.api.get<any>('/admin/whatsapp')); } catch (e) { this.avisos.error(e); }
  }
  async cargarConsumo() {
    try {
      const r = await this.api.get<any>('/admin/whatsapp/consumo', { mes: this.mes() });
      this.mes.set(r.mes); this.consumo.set(r.filas);
    } catch (e) { this.avisos.error(e); }
  }
  cambiarMes(m: string) { this.mes.set(m); this.cargarConsumo(); }

  async guardar() {
    const c = this.cfg();
    this.trabajando.set(true); this.prueba.set(null);
    try {
      await this.api.put('/admin/whatsapp', { activo: !!c.activo, phoneNumberId: c.phoneNumberId || '', wabaId: c.wabaId || '', plantilla: c.plantilla, idioma: c.idioma,
        ...(this.token ? { token: this.token } : {}), ...(this.secreto ? { appSecret: this.secreto } : {}) });
      this.token = ''; this.secreto = '';
      this.avisos.ok('Cuenta de WhatsApp guardada');
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async probar() {
    this.trabajando.set(true);
    try { this.prueba.set(await this.api.post('/admin/whatsapp/probar')); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
