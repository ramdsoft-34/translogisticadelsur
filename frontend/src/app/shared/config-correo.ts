import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';

const listaCorreos = (t: string) => [...new Set(String(t || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];

// Configuración del correo: cuenta remitente (SMTP) y, por cliente, destinatarios,
// documentos que recibe y formato de la carta de salida.
@Component({
  selector: 'app-config-correo',
  imports: [FormsModule, Modal],
  template: `
    @if (smtp(); as c) {
      <form class="tarjeta" (ngSubmit)="guardarCuenta()">
        <h2>Cuenta remitente</h2>
        <p class="sutil">Desde esta cuenta se envían los documentos a los clientes cuando el RNDC acepta la remesa y el manifiesto.
          Use un correo de la empresa; con Gmail u Outlook use una <strong>contraseña de aplicación</strong>, no la contraseña personal.</p>
        <div class="rejilla">
          <div class="campo"><label for="sm-host">Servidor SMTP</label><input id="sm-host" name="host" [(ngModel)]="c.host" placeholder="smtp.gmail.com" autocomplete="off" /></div>
          <div class="campo"><label for="sm-seg">Seguridad</label>
            <select id="sm-seg" name="seg" [(ngModel)]="c.seguridad" (ngModelChange)="c.puerto = $event === 'tls' ? 465 : 587">
              <option value="starttls">STARTTLS (puerto 587)</option><option value="tls">TLS directo (puerto 465)</option></select></div>
          <div class="campo"><label for="sm-pto">Puerto</label><input id="sm-pto" type="number" name="pto" [(ngModel)]="c.puerto" /></div>
          <div class="campo"><label for="sm-usu">Usuario</label><input id="sm-usu" name="usu" [(ngModel)]="c.usuario" autocomplete="off" /></div>
          <div class="campo"><label for="sm-cla">Contraseña</label>
            <input id="sm-cla" type="password" name="cla" [(ngModel)]="clave" autocomplete="new-password" [placeholder]="c.tieneClave ? 'Guardada (escriba para cambiarla)' : ''" />
            <small>Se guarda cifrada; no se vuelve a mostrar.</small></div>
          <div class="campo"><label for="sm-rem">Correo remitente</label><input id="sm-rem" type="email" name="rem" [(ngModel)]="c.remitenteCorreo" placeholder="despachos@empresa.com" /></div>
          <div class="campo"><label for="sm-nom">Nombre del remitente</label><input id="sm-nom" name="nom" [(ngModel)]="c.remitenteNombre" placeholder="COOESPATRANS" /></div>
          <div class="campo"><label for="sm-resp">Responder a (opcional)</label><input id="sm-resp" type="email" name="resp" [(ngModel)]="c.responderA" /></div>
        </div>
        <label class="casilla" style="margin-top:12px"><input type="checkbox" name="act" [(ngModel)]="c.activo" />Enviar documentos automáticamente por correo</label>
        <div class="acciones" style="margin-top:14px">
          <button class="primario" type="submit" [disabled]="trabajando()">Guardar cuenta</button>
          <input type="email" name="prueba" [(ngModel)]="paraPrueba" placeholder="Correo para la prueba" style="max-width:260px" aria-label="Correo para la prueba" />
          <button type="button" (click)="probar()" [disabled]="trabajando() || !paraPrueba">Enviar correo de prueba</button>
        </div>
        @if (resultadoPrueba(); as r) { <div class="mensaje" [class.ok]="r.ok" [class.error]="!r.ok" style="margin-top:12px">{{ r.ok ? 'Correo de prueba enviado. Revise la bandeja de entrada.' : 'No se pudo enviar: ' + r.error }}</div> }
      </form>

      <section class="tarjeta">
        <h2>Envío por cliente</h2>
        <p class="sutil">Cada cliente tiene sus propios destinatarios y documentos. Solo se envía cuando el RNDC acepta la remesa y el manifiesto.</p>
        <div class="tabla-caja" style="box-shadow:none"><table>
          <thead><tr><th>Cliente</th><th>Estado</th><th>Destinatarios</th><th>Documentos</th><th></th></tr></thead>
          <tbody>@for (cl of clientes(); track cl._id) {
            <tr>
              <td><strong>{{ cl.nombre }}</strong></td>
              <td><span class="chip" [class.ok]="cl.envios?.activo">{{ cl.envios?.activo ? 'Activo' : 'Sin envío' }}</span></td>
              <td class="sutil">{{ (cl.envios?.destinatarios || []).join(', ') || '—' }}</td>
              <td>{{ documentos(cl) }}</td>
              <td><button class="pequeno" type="button" (click)="editar(cl)">Configurar</button></td>
            </tr>
          } @empty { <tr><td colspan="5" class="vacio">Sin clientes</td></tr> }</tbody>
        </table></div>
      </section>
    }

    <app-modal [titulo]="'Envío de documentos · ' + (form()?.nombre || '')" [abierto]="!!form()" (cerrar)="form.set(null)" [ancho]="true">
      @if (form(); as f) {
        <form id="form-envio" (ngSubmit)="guardarCliente()">
          <label class="casilla"><input type="checkbox" name="act" [(ngModel)]="f.activo" /><strong>Enviar documentos a este cliente</strong></label>
          <div class="rejilla" style="margin-top:12px">
            <div class="campo ancho2"><label for="ec-para">Destinatarios</label>
              <textarea id="ec-para" name="para" rows="2" [(ngModel)]="f.destinatariosTexto" placeholder="logistica@cliente.com, despachos@cliente.com"></textarea>
              <small>Separe los correos con coma o en líneas distintas.</small></div>
            <div class="campo"><label for="ec-cc">Con copia (CC)</label><textarea id="ec-cc" name="cc" rows="2" [(ngModel)]="f.ccTexto"></textarea></div>
          </div>
          <fieldset style="margin-top:14px"><legend>Documentos</legend>
            <label class="casilla"><input type="checkbox" name="dman" [(ngModel)]="f.documentos.manifiesto" />PDF del manifiesto de carga</label>
            <label class="casilla" style="margin-top:8px"><input type="checkbox" name="dsal" [(ngModel)]="f.documentos.salida" />Correo de autorización de salida (carta)</label>
          </fieldset>
          @if (f.documentos.salida) {
            <fieldset style="margin-top:14px"><legend>Carta de autorización de salida</legend>
              <div class="campo"><label for="ec-as">Asunto</label><input id="ec-as" name="asunto" [(ngModel)]="f.salida.asunto" (ngModelChange)="previa()" /></div>
              <div class="campo" style="margin-top:10px"><label for="ec-cu">Texto</label>
                <textarea id="ec-cu" name="cuerpo" rows="14" [(ngModel)]="f.salida.cuerpo" (ngModelChange)="previa()" class="mono"></textarea></div>
              <div class="marcas"><span class="etiqueta">Insertar dato:</span>
                @for (m of marcadores(); track m[0]) { <button type="button" class="pequeno" [title]="m[1]" (click)="insertar(m[0])">{{ m[1] }}</button> }
                <button type="button" class="pequeno texto" (click)="restablecer()">Restablecer formato</button></div>
              <h3>Vista previa {{ vista()?.conViajeReal ? '(último viaje manifestado)' : '(datos de ejemplo)' }}</h3>
              @if (vista(); as v) { <div class="carta"><strong>Asunto: {{ v.asunto }}</strong><pre>{{ v.texto }}</pre></div> }
            </fieldset>
          }
        </form>
      }
      <ng-container pie>
        <button type="button" (click)="form.set(null)">Cancelar</button>
        <button class="primario" type="submit" form="form-envio" [disabled]="trabajando()">Guardar</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 16px; }
    h2 { margin-bottom: 4px; }
    .rejilla { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px 16px; align-items: start; margin-top: 12px; }
    .ancho2 { grid-column: span 2; }
    .mono { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
    .marcas { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
    h3 { margin: 14px 0 6px; font-size: 14px; }
    .carta { border: 1px solid var(--gris-2); border-radius: var(--radio); padding: 12px 14px; background: var(--gris-1); }
    .carta pre { white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 13.5px; margin: 8px 0 0; }
    @media (max-width: 760px) { .rejilla { grid-template-columns: 1fr; } .ancho2 { grid-column: auto; } }
  `],
})
export class ConfigCorreo {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly smtp = signal<any>(null);
  readonly clientes = signal<any[]>([]);
  readonly marcadores = signal<[string, string][]>([]);
  readonly form = signal<any>(null);
  readonly vista = signal<any>(null);
  readonly trabajando = signal(false);
  readonly resultadoPrueba = signal<{ ok: boolean; error?: string } | null>(null);
  private salidaBase: any = { asunto: '', cuerpo: '' };
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  clave = '';
  paraPrueba = '';

  constructor() { this.cargar(); }

  async cargar() {
    try {
      const [c, l] = await Promise.all([this.api.get<any>('/correo/config'), this.api.get<any>('/correo/clientes')]);
      this.smtp.set({ activo: false, host: '', puerto: 587, seguridad: 'starttls', usuario: '', remitenteNombre: '', remitenteCorreo: '', responderA: '', ...c });
      this.clientes.set(l.clientes); this.salidaBase = l.salidaBase; this.marcadores.set(Object.entries(l.marcadores) as [string, string][]);
    } catch (e) { this.avisos.error(e); }
  }

  documentos(c: any) {
    const d = c.envios?.documentos || {};
    return [d.manifiesto && 'Manifiesto PDF', d.salida && 'Carta de salida'].filter(Boolean).join(' + ') || '—';
  }

  async guardarCuenta() {
    const c = this.smtp();
    this.trabajando.set(true);
    try {
      await this.api.put('/correo/config', { activo: !!c.activo, host: c.host || '', puerto: Number(c.puerto) || 587, seguridad: c.seguridad,
        usuario: c.usuario || '', remitenteNombre: c.remitenteNombre || '', remitenteCorreo: c.remitenteCorreo || '', responderA: c.responderA || '',
        ...(this.clave ? { clave: this.clave } : {}) });
      this.clave = '';
      this.avisos.ok('Cuenta de correo guardada');
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async probar() {
    this.trabajando.set(true); this.resultadoPrueba.set(null);
    try { this.resultadoPrueba.set(await this.api.post<any>('/correo/config/probar', { para: this.paraPrueba.trim() })); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  editar(cl: any) {
    const e = cl.envios || {};
    this.form.set({ _id: cl._id, nombre: cl.nombre, activo: !!e.activo,
      destinatariosTexto: (e.destinatarios?.length ? e.destinatarios : cl.correos || []).join(', '), ccTexto: (e.cc || []).join(', '),
      documentos: { manifiesto: e.documentos?.manifiesto ?? true, salida: !!e.documentos?.salida },
      salida: { asunto: e.salida?.asunto || this.salidaBase.asunto, cuerpo: e.salida?.cuerpo || this.salidaBase.cuerpo } });
    this.vista.set(null); this.previa();
  }

  restablecer() { this.form.update(f => ({ ...f, salida: { ...this.salidaBase } })); this.previa(); }

  insertar(clave: string) {
    const el = document.getElementById('ec-cu') as HTMLTextAreaElement | null;
    this.form.update(f => {
      const t: string = f.salida.cuerpo || '';
      const i = el && document.activeElement === el ? el.selectionStart : t.length;
      return { ...f, salida: { ...f.salida, cuerpo: `${t.slice(0, i)}{${clave}}${t.slice(i)}` } };
    });
    this.previa();
  }

  previa() {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(async () => {
      const f = this.form();
      if (!f?.documentos.salida) return;
      try { this.vista.set(await this.api.post<any>(`/correo/clientes/${f._id}/vista-previa`, f.salida)); } catch { /* sin vista previa */ }
    }, 300);
  }

  async guardarCliente() {
    const f = this.form();
    this.trabajando.set(true);
    try {
      await this.api.put(`/correo/clientes/${f._id}`, { activo: f.activo, destinatarios: listaCorreos(f.destinatariosTexto), cc: listaCorreos(f.ccTexto),
        documentos: f.documentos, salida: f.salida });
      this.avisos.ok(`Envío de documentos de ${f.nombre} guardado`);
      this.form.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
