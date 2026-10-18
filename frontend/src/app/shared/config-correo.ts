import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Confirmar } from './confirmar';
import { filtrar } from './filtro';

const listaCorreos = (t: string) => [...new Set(String(t || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];

// Configuración del correo: cuenta remitente (SMTP) y, por cliente, destinatarios,
// documentos que recibe y formato de la carta de salida.
@Component({
  selector: 'app-config-correo',
  imports: [FormsModule, Modal, Confirmar],
  template: `
    @if (smtp(); as c) {
      <form class="tarjeta" (ngSubmit)="guardarYProbar()">
        <div class="titulo-cuenta">
          <div><h2>Cuenta de correo</h2>
            <p class="sutil">Desde este correo se envían los documentos a sus clientes cuando el RNDC acepta el manifiesto.</p></div>
          <button type="button" class="ayuda" (click)="guia.set(true)"><span aria-hidden="true">?</span>¿Cómo lo configuro?</button>
        </div>
        @if (c.activo && c.tieneClave) { <div class="mensaje ok estado-cuenta">Activo: los documentos se envían desde <strong>{{ c.remitenteCorreo }}</strong>.</div> }

        <div class="paso"><span class="num">1</span><strong>¿Qué correo usa la empresa?</strong></div>
        <div class="proveedores" role="radiogroup" aria-label="Proveedor de correo">
          @for (p of proveedores; track p.id) {
            <button type="button" role="radio" [attr.aria-checked]="proveedor() === p.id" [class.activo]="proveedor() === p.id" (click)="elegirProveedor(p.id)">
              <strong>{{ p.nombre }}</strong><small>{{ p.ejemplo }}</small></button>
          }
        </div>

        <div class="paso"><span class="num">2</span><strong>Escriba el correo y su contraseña de aplicación</strong></div>
        <div class="rejilla">
          <div class="campo"><label for="sm-correo">Correo</label>
            <input id="sm-correo" type="email" name="correo" [(ngModel)]="c.remitenteCorreo" (ngModelChange)="alEscribirCorreo($event)" [placeholder]="proveedorActual().ejemplo" autocomplete="off" /></div>
          <div class="campo"><label for="sm-cla">{{ proveedor() === 'hostinger' || proveedor() === 'otro' ? 'Contraseña del correo' : 'Contraseña de aplicación' }}</label>
            <input id="sm-cla" type="password" name="cla" [(ngModel)]="clave" autocomplete="new-password" [placeholder]="c.tieneClave ? 'Guardada · escriba solo para cambiarla' : ''" />
            <small>Se guarda cifrada y no se vuelve a mostrar.</small></div>
          <div class="campo"><label for="sm-nom">Nombre que verán los clientes</label><input id="sm-nom" name="nom" [(ngModel)]="c.remitenteNombre" placeholder="COOESPATRANS" /></div>
        </div>

        <details class="avanzado" [open]="proveedor() === 'otro'">
          <summary>Opciones avanzadas (servidor, puerto, seguridad)</summary>
          <div class="rejilla">
            <div class="campo"><label for="sm-host">Servidor SMTP</label><input id="sm-host" name="host" [(ngModel)]="c.host" placeholder="smtp.empresa.com" autocomplete="off" /></div>
            <div class="campo"><label for="sm-seg">Seguridad</label>
              <select id="sm-seg" name="seg" [(ngModel)]="c.seguridad" (ngModelChange)="c.puerto = $event === 'tls' ? 465 : 587">
                <option value="starttls">STARTTLS (puerto 587)</option><option value="tls">SSL/TLS (puerto 465)</option></select></div>
            <div class="campo"><label for="sm-pto">Puerto</label><input id="sm-pto" type="number" name="pto" [(ngModel)]="c.puerto" /></div>
            <div class="campo"><label for="sm-usu">Usuario (si es distinto del correo)</label><input id="sm-usu" name="usu" [(ngModel)]="c.usuario" autocomplete="off" /></div>
            <div class="campo"><label for="sm-resp">Las respuestas llegan a (opcional)</label><input id="sm-resp" type="email" name="resp" [(ngModel)]="c.responderA" /></div>
          </div>
        </details>

        <div class="agrupar">
          <label for="sm-agr">Enviar los manifiestos de cada cliente juntos, en un solo correo, </label>
          <input id="sm-agr" type="number" min="0" max="240" name="agr" [(ngModel)]="c.agruparMinutos" />
          <span>minutos después del último manifiesto expedido (0 = en el siguiente minuto).</span>
        </div>

        <div class="paso"><span class="num">3</span><strong>Guarde y reciba un correo de prueba</strong></div>
        <div class="acciones">
          <button class="primario" type="submit" [disabled]="trabajando() || !c.remitenteCorreo || (!clave && !c.tieneClave)">{{ trabajando() ? 'Probando…' : 'Guardar y probar' }}</button>
          <button type="button" (click)="soloGuardar()" [disabled]="trabajando() || !c.remitenteCorreo">Guardar</button>
          @if (c.activo) { <button type="button" confirmar="Clic otra vez para pausar" (confirmado)="desactivar()" [disabled]="trabajando()">Pausar envíos</button> }
        </div>
        @if (resultadoPrueba(); as r) {
          <div class="mensaje" [class.ok]="r.ok" [class.error]="!r.ok" style="margin-top:12px">
            @if (r.ok) { Listo. Enviamos un correo de prueba a <strong>{{ c.remitenteCorreo }}</strong>: revise la bandeja de entrada (o la de spam). Los envíos quedaron activados. }
            @else { <strong>No se pudo enviar.</strong> {{ explicarError(r.error) }} <br /><small class="sutil">Detalle técnico: {{ r.error }}</small> }
          </div>
        }
      </form>

      <section class="tarjeta">
        <h2>Envío por cliente</h2>
        <p class="sutil">Cada cliente tiene sus propios destinatarios y documentos. Los correos se preparan cuando el RNDC acepta el manifiesto y salen solo cuando se aprueban en «Manifestados».</p>
        <div class="filtro-rapido"><input type="search" placeholder="Buscar cliente o destinatario" aria-label="Buscar cliente o destinatario" [value]="qCli()" (input)="qCli.set($any($event.target).value)" /></div>
        <div class="tabla-caja" style="box-shadow:none"><table>
          <thead><tr><th>Cliente</th><th>Estado</th><th>Destinatarios</th><th>Documentos</th><th></th></tr></thead>
          <tbody>@for (cl of clientesVisibles(); track cl._id) {
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

    <app-modal titulo="Cómo configurar el correo" [abierto]="guia()" (cerrar)="guia.set(false)" [ancho]="true">
      <div class="guia">
        <div class="pestanas">
          @for (p of proveedores; track p.id) { <button type="button" [class.activa]="guiaDe() === p.id" (click)="guiaDe.set(p.id)">{{ p.nombre }}</button> }
        </div>
        @switch (guiaDe()) {
          @case ('gmail') {
            <p>Gmail no deja usar la contraseña normal en otros programas: hay que crear una <strong>contraseña de aplicación</strong> (16 letras). Toma unos 3 minutos.</p>
            <ol>
              <li>Entre a <strong>myaccount.google.com</strong> con el correo de la empresa.</li>
              <li>Vaya a <strong>Seguridad</strong> y active la <strong>Verificación en dos pasos</strong> (si ya está activa, siga al paso 3).</li>
              <li>En el buscador de la cuenta escriba <strong>«Contraseñas de aplicaciones»</strong> y ábralo.</li>
              <li>En «Nombre de la app» escriba <strong>Translogistica</strong> y presione <strong>Crear</strong>.</li>
              <li>Copie las <strong>16 letras</strong> que aparecen (sin espacios).</li>
              <li>Vuelva aquí, elija <strong>Gmail</strong>, escriba el correo, pegue las 16 letras en «Contraseña de aplicación» y presione <strong>Guardar y probar</strong>.</li>
            </ol>
            <p class="sutil">Si no aparece la opción, la cuenta es de Google Workspace y el administrador debe permitirla.</p>
          }
          @case ('hostinger') {
            <p>Si el correo es de su propio dominio administrado en Hostinger (por ejemplo, despachos@suempresa.com):</p>
            <ol>
              <li>Elija <strong>Hostinger</strong> arriba: el servidor y el puerto se llenan solos.</li>
              <li>Escriba el correo completo y la <strong>contraseña de ese correo</strong> (la que usa para entrar al webmail).</li>
              <li>Si no la recuerda: en <strong>hPanel → Correos electrónicos → Cuentas de correo</strong>, junto al correo, use <strong>Cambiar contraseña</strong>.</li>
              <li>Presione <strong>Guardar y probar</strong>.</li>
            </ol>
          }
          @case ('microsoft') {
            <p>Para Outlook, Hotmail o Microsoft 365:</p>
            <ol>
              <li>Entre a <strong>account.microsoft.com</strong> → <strong>Seguridad</strong> y active la <strong>verificación en dos pasos</strong>.</li>
              <li>En <strong>Opciones de seguridad avanzadas</strong> busque <strong>Contraseñas de aplicación</strong> y cree una nueva.</li>
              <li>Vuelva aquí, elija <strong>Microsoft</strong>, escriba el correo, pegue la contraseña de aplicación y presione <strong>Guardar y probar</strong>.</li>
            </ol>
            <p class="sutil">En Microsoft 365 de empresa, el administrador puede tener bloqueado el envío por SMTP; si la prueba falla con un error de autenticación, pídale que lo habilite o use Gmail o el correo de Hostinger.</p>
          }
          @default {
            <ol>
              <li>Pida a quien administra el correo estos datos: <strong>servidor SMTP</strong>, <strong>puerto</strong> y tipo de <strong>seguridad</strong> (normalmente 587 STARTTLS o 465 SSL).</li>
              <li>Elija <strong>Otro</strong>, abra «Opciones avanzadas» y escríbalos.</li>
              <li>Escriba el correo y su contraseña y presione <strong>Guardar y probar</strong>.</li>
            </ol>
          }
        }
        <div class="mensaje info">Después de que la prueba funcione, configure abajo, en <strong>Envío por cliente</strong>, a quién se envía (por ejemplo Corbeta y DSierra, cada uno con sus correos).</div>
      </div>
      <ng-container pie><button type="button" class="primario" (click)="guia.set(false)">Entendido</button></ng-container>
    </app-modal>

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
    .titulo-cuenta { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .ayuda { gap: 8px; border-color: var(--primario-borde); }
    .ayuda span { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--primario); color: var(--sobre-primario); font-weight: 800; font-size: 13px; }
    .estado-cuenta { margin-top: 10px; }
    .paso { display: flex; align-items: center; gap: 10px; margin: 18px 0 10px; }
    .num { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--negro); color: var(--primario); font-weight: 700; font-size: 13px; }
    .proveedores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .proveedores button { flex-direction: column; align-items: flex-start; gap: 2px; min-height: 64px; padding: 10px 14px; white-space: normal; text-align: left; }
    .proveedores button small { color: var(--gris-5); font-weight: 400; font-size: 12px; }
    .proveedores button.activo { border: 2px solid var(--primario-borde); background: var(--primario-claro); }
    .avanzado { margin-top: 14px; }
    .agrupar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; color: var(--gris-7); }
    .agrupar input { width: 80px; text-align: center; }
    .guia ol { padding-left: 20px; display: grid; gap: 8px; line-height: 1.5; }
    @media (max-width: 760px) { .proveedores { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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
  readonly qCli = signal('');
  readonly clientesVisibles = computed(() => filtrar(this.clientes(), this.qCli()));
  readonly marcadores = signal<[string, string][]>([]);
  readonly form = signal<any>(null);
  readonly vista = signal<any>(null);
  readonly trabajando = signal(false);
  readonly resultadoPrueba = signal<{ ok: boolean; error?: string } | null>(null);
  private salidaBase: any = { asunto: '', cuerpo: '' };
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  clave = '';
  paraPrueba = '';
  readonly guia = signal(false);
  readonly guiaDe = signal('gmail');
  readonly proveedor = signal('gmail');
  // Datos de conexión de los proveedores más comunes
  readonly proveedores = [
    { id: 'gmail', nombre: 'Gmail', ejemplo: 'empresa@gmail.com', host: 'smtp.gmail.com', puerto: 587, seguridad: 'starttls' },
    { id: 'hostinger', nombre: 'Hostinger', ejemplo: 'despachos@suempresa.com', host: 'smtp.hostinger.com', puerto: 465, seguridad: 'tls' },
    { id: 'microsoft', nombre: 'Microsoft', ejemplo: 'empresa@outlook.com', host: 'smtp-mail.outlook.com', puerto: 587, seguridad: 'starttls' },
    { id: 'otro', nombre: 'Otro', ejemplo: 'correo@empresa.com', host: '', puerto: 587, seguridad: 'starttls' },
  ];
  proveedorActual() { return this.proveedores.find(p => p.id === this.proveedor()) || this.proveedores[0]; }

  elegirProveedor(id: string) {
    this.proveedor.set(id); this.guiaDe.set(id);
    const p = this.proveedorActual();
    if (id !== 'otro') this.smtp.update(c => ({ ...c, host: p.host, puerto: p.puerto, seguridad: p.seguridad }));
  }

  // Al escribir el correo se reconoce el proveedor
  alEscribirCorreo(correo: string) {
    const dominio = String(correo || '').split('@')[1]?.toLowerCase() || '';
    if (/^(gmail|googlemail)\.com$/.test(dominio)) this.elegirProveedor('gmail');
    else if (/^(outlook|hotmail|live)\.(com|es)$/.test(dominio)) this.elegirProveedor('microsoft');
  }

  private detectarProveedor(c: any) {
    const p = this.proveedores.find(x => x.host && x.host === c.host);
    this.proveedor.set(p?.id || (c.host ? 'otro' : 'gmail'));
    this.guiaDe.set(this.proveedor());
    if (!c.host) { const g = this.proveedores[0]; this.smtp.update(x => ({ ...x, host: g.host, puerto: g.puerto, seguridad: g.seguridad })); }
  }

  explicarError(e?: string) {
    const t = String(e || '');
    if (/EAUTH|535|534|Username and Password|authentication/i.test(t)) return 'El correo o la contraseña no son correctos. En Gmail y Microsoft use la contraseña de aplicación (vea «¿Cómo lo configuro?»).';
    if (/EDNS|ENOTFOUND/i.test(t)) return 'El servidor de correo no existe. Revise el proveedor elegido o el servidor en «Opciones avanzadas».';
    if (/ETIMEDOUT|ECONNECTION|ECONNREFUSED|ESOCKET|timeout/i.test(t)) return 'No se pudo conectar con el servidor de correo. Revise el puerto y la seguridad en «Opciones avanzadas».';
    if (/no está configurada/i.test(t)) return 'Falta completar la cuenta de correo.';
    return 'Revise los datos e intente de nuevo.';
  }

  constructor() { this.cargar(); }

  async cargar() {
    try {
      const [c, l] = await Promise.all([this.api.get<any>('/correo/config'), this.api.get<any>('/correo/clientes')]);
      this.smtp.set({ activo: false, host: '', puerto: 587, seguridad: 'starttls', usuario: '', remitenteNombre: '', remitenteCorreo: '', responderA: '', agruparMinutos: 15, ...c });
      this.detectarProveedor(this.smtp());
      this.clientes.set(l.clientes); this.salidaBase = l.salidaBase; this.marcadores.set(Object.entries(l.marcadores) as [string, string][]);
    } catch (e) { this.avisos.error(e); }
  }

  documentos(c: any) {
    const d = c.envios?.documentos || {};
    return [d.manifiesto && 'Manifiesto PDF', d.salida && 'Carta de salida'].filter(Boolean).join(' + ') || '—';
  }

  // Guarda la cuenta activada y envía un correo de prueba al mismo correo
  async guardarYProbar() {
    const c = this.smtp();
    this.resultadoPrueba.set(null);
    if (!(await this.guardarCuenta(true))) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/correo/config/probar', { para: c.remitenteCorreo.trim() });
      this.resultadoPrueba.set(r);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // Guarda los cambios sin enviar el correo de prueba (conserva si los envíos están activos)
  async soloGuardar() {
    if (await this.guardarCuenta(this.smtp().activo || undefined)) this.avisos.ok('Configuración del correo guardada');
  }

  async desactivar() {
    this.smtp.update(c => ({ ...c, activo: false }));
    await this.guardarCuenta(false);
  }

  async guardarCuenta(activar?: boolean): Promise<boolean> {
    const c = this.smtp();
    this.trabajando.set(true);
    try {
      const correo = String(c.remitenteCorreo || '').trim().toLowerCase();
      await this.api.put('/correo/config', { activo: activar ?? !!c.activo, host: c.host || '', puerto: Number(c.puerto) || 587, seguridad: c.seguridad,
        usuario: (c.usuario || '').trim() || correo, remitenteNombre: c.remitenteNombre || '', remitenteCorreo: correo, responderA: c.responderA || '',
        agruparMinutos: Math.max(0, Math.min(240, Number(c.agruparMinutos ?? 15) || 0)),
        // Las contraseñas de aplicación de Gmail/Microsoft se muestran con espacios: se quitan
        ...(this.clave ? { clave: ['gmail', 'microsoft'].includes(this.proveedor()) ? this.clave.replace(/\s+/g, '') : this.clave } : {}) });
      this.clave = '';
      await this.cargar();
      return true;
    } catch (e) { this.avisos.error(e); return false; } finally { this.trabajando.set(false); }
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
