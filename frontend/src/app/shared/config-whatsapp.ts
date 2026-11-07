import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';

// Texto de la plantilla que se crea en Meta (categoría Utilidad, encabezado Documento): las variables van en este orden
export const CUERPO_PLANTILLA = `Hola, {{1}}. {{2}} le envía su manifiesto de carga.

Manifiesto: {{3}}
Placa: {{4}}
Ruta: {{5}} a {{6}}
Remesa: {{7}}

Este número solo envía documentos. Para cualquier novedad, comuníquese con {{8}}. Gracias.`;
// Meta no acepta una variable al final del texto: por eso cierra con «Gracias.»

// WhatsApp de la empresa: sale del número de Translogística o de una cuenta propia en Meta.
@Component({
  selector: 'app-config-whatsapp',
  imports: [FormsModule],
  template: `
    @if (cfg(); as c) {
      <form class="tarjeta" (ngSubmit)="guardar()">
        <h2>WhatsApp Business</h2>
        <p class="sutil">Envía el PDF del manifiesto al celular del conductor. Igual que los correos, sale solo cuando alguien lo aprueba en Manifiestos.</p>
        @if (c.activo) { <div class="mensaje ok">Activo: los manifiestos aprobados se envían {{ c.modo === 'propia' ? 'desde el número de la empresa' : 'desde el número de Translogística' }}.</div> }

        <label class="casilla" style="margin:12px 0"><input type="checkbox" name="activo" [(ngModel)]="c.activo" />Enviar manifiestos por WhatsApp</label>
        <div class="segmentos" role="group" aria-label="Número desde el que se envía" style="margin-bottom:12px">
          <button type="button" [class.activo]="c.modo !== 'propia'" (click)="c.modo = 'plataforma'">Número de Translogística</button>
          <button type="button" [class.activo]="c.modo === 'propia'" (click)="c.modo = 'propia'">Número propio de la empresa</button>
        </div>

        @if (c.modo !== 'propia') {
          @if (c.plataformaLista) {
            <p class="sutil">No requiere nada más. El conductor ve que escribe Translogística, y el mensaje dice el nombre de su empresa.</p>
          } @else {
            <div class="mensaje alerta">La cuenta de WhatsApp de Translogística todavía no está disponible. Podrá activarla cuando esté lista, o registrar un número propio.</div>
          }
        } @else {
          <p class="sutil">La empresa crea su cuenta de Meta, registra su número y paga sus mensajes.</p>
          <div class="formulario">
            <div class="campo"><label for="wa-num">Identificador del número (Phone number ID)</label><input id="wa-num" name="num" inputmode="numeric" [(ngModel)]="c.phoneNumberId" /></div>
            <div class="campo"><label for="wa-waba">Identificador de la cuenta (WABA ID)</label><input id="wa-waba" name="waba" inputmode="numeric" [(ngModel)]="c.wabaId" /></div>
            <div class="campo"><label for="wa-token">Token permanente</label>
              <input id="wa-token" name="token" type="password" autocomplete="new-password" [(ngModel)]="token" [placeholder]="c.tieneToken ? 'Guardado. Escriba solo para cambiarlo' : ''" /></div>
            <div class="campo"><label for="wa-sec">Secreto de la app (App secret)</label>
              <input id="wa-sec" name="sec" type="password" autocomplete="new-password" [(ngModel)]="secreto" [placeholder]="c.tieneSecreto ? 'Guardado. Escriba solo para cambiarlo' : ''" /></div>
            <div class="campo"><label for="wa-pla">Nombre de la plantilla aprobada</label><input id="wa-pla" name="pla" [(ngModel)]="c.plantilla" /></div>
            <div class="campo"><label for="wa-idi">Idioma de la plantilla</label><input id="wa-idi" name="idi" maxlength="5" [(ngModel)]="c.idioma" /><small>El mismo con el que se aprobó, por ejemplo es o es_CO.</small></div>
          </div>
        }
        <div class="acciones" style="margin-top:14px">
          <button class="primario" type="submit" [disabled]="trabajando()">Guardar</button>
          <button type="button" (click)="probar()" [disabled]="trabajando() || !c.activo">Probar conexión</button>
        </div>
        @if (prueba(); as p) { <div class="mensaje" [class.ok]="p.ok" [class.error]="!p.ok" style="margin-top:12px" role="status">
          {{ p.ok ? 'Conectado: ' + p.nombre + ' · ' + p.numero : p.error }}</div> }
      </form>

      @if (c.modo === 'propia') {
        <div class="tarjeta" style="margin-top:16px">
          <h2>Datos para configurar en Meta</h2>
          <h3>Avisos de entrega (Webhook)</h3>
          <p class="sutil">En la app de Meta: WhatsApp → Configuración → Webhook. Suscriba el campo <strong>messages</strong>.</p>
          <div class="formulario">
            <div class="campo ancho"><label for="wa-url">Dirección de devolución de llamada</label><input id="wa-url" readonly [value]="c.webhookUrl" /></div>
            <div class="campo ancho"><label for="wa-ver">Token de verificación</label><input id="wa-ver" readonly [value]="c.webhookToken || 'Se genera al guardar'" /></div>
          </div>
          <h3>Plantilla</h3>
          <p class="sutil">Categoría <strong>Utilidad</strong>, encabezado <strong>Documento</strong> y este cuerpo. Meta debe aprobarla antes del primer envío.</p>
          <pre class="plantilla">{{ cuerpo }}</pre>
        </div>
      }
      <p class="sutil" style="margin-top:12px">Antes de enviar: cada conductor debe tener su celular y la casilla de autorización marcada en Conductores y terceros.</p>
    }`,
  styles: [`h3 { margin: 16px 0 4px; font-size: 14.5px; }
    .plantilla { background: var(--gris-1); border: 1px solid var(--gris-2); border-radius: 10px; padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; margin: 8px 0 0; }`],
})
export class ConfigWhatsapp {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly cuerpo = CUERPO_PLANTILLA;
  readonly cfg = signal<any>(null);
  readonly trabajando = signal(false);
  readonly prueba = signal<any>(null);
  token = '';
  secreto = '';

  constructor() { this.cargar(); }

  async cargar() {
    try { this.cfg.set(await this.api.get<any>('/whatsapp/config')); } catch (e) { this.avisos.error(e); }
  }

  async guardar() {
    const c = this.cfg();
    this.trabajando.set(true); this.prueba.set(null);
    try {
      await this.api.put('/whatsapp/config', { activo: !!c.activo, modo: c.modo || 'plataforma', phoneNumberId: c.phoneNumberId || '', wabaId: c.wabaId || '', plantilla: c.plantilla, idioma: c.idioma,
        ...(this.token ? { token: this.token } : {}), ...(this.secreto ? { appSecret: this.secreto } : {}) });
      this.token = ''; this.secreto = '';
      this.avisos.ok('Configuración de WhatsApp guardada');
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async probar() {
    this.trabajando.set(true);
    try { this.prueba.set(await this.api.post('/whatsapp/config/probar')); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
