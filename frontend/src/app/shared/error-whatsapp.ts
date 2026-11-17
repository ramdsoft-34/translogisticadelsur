import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';

interface Diagnostico {
  envio: { _id: string; estado: string; error: string; causa: string; tipo: string; documento: string; telefono: string; intentos: number; solucion: { accion: string } | null };
  viaje: { _id: string; numero: number; placa: string } | null;
  explicacion: { id: string; titulo: string; explicacion: string; pasos: string[]; acciones: string[] } | null;
  conductor: { _id: string; nombre: string; documento: string; celular: string; celularValido: boolean; whatsappAutorizado: boolean; whatsappFallo: { telefono: string; en: string } | null } | null;
  resueltosAntes: { accion: string; veces: number }[];
  otrosConError: number;
  puedeConfigurar: boolean;
}
const ACCION: Record<string, string> = { autorizar: 'registrando la autorización del conductor', celular: 'corrigiendo el celular', 'celular+autorizar': 'corrigiendo el celular y registrando la autorización', reintentar: 'reintentando' };
const ENVIADO = ['enviado', 'entregado', 'leido'];

// Ventana que explica un error de WhatsApp (manifiesto o soporte interno al conductor) y permite corregirlo ahí mismo.
// Recibe uno o varios envíos con error y los muestra uno por uno. Solo propone las correcciones de esa causa.
@Component({
  selector: 'app-error-whatsapp',
  imports: [FormsModule, RouterLink, DatePipe, Modal],
  template: `
    <app-modal [titulo]="titulo()" [abierto]="envios().length > 0" (cerrar)="cerrar.emit()">
      @if (d(); as x) {
        @if (x.explicacion; as c) {
          <div class="mensaje" [class.ok]="enviado()" [class.error]="!enviado()" role="status">
            @if (enviado()) { <strong>Listo: {{ x.envio.tipo === 'soporte' ? 'el soporte interno' : 'el manifiesto' }} {{ x.envio.documento }} se envió.</strong> }
            @else { <strong>{{ c.titulo }}</strong> }
          </div>
          @if (!enviado()) {
            <p>{{ c.explicacion }}</p>
            <ol class="pasos">@for (p of c.pasos; track $index) { <li>{{ p }}</li> }</ol>
          }
        } @else {
          <p class="mensaje ok">Este envío ya no tiene error ({{ x.envio.estado }}).</p>
        }

        <dl class="datos">
          @if (x.viaje) { <dt>Viaje</dt><dd>N° {{ x.viaje.numero }} · {{ x.viaje.placa }} · {{ x.envio.tipo === 'soporte' ? 'Soporte' : 'Manifiesto' }} {{ x.envio.documento }}</dd> }
          @if (x.conductor; as t) {
            <dt>Conductor</dt><dd>{{ t.nombre }} ({{ t.documento }})</dd>
            <dt>Celular</dt><dd>{{ t.celular || 'sin celular' }} @if (!t.celularValido) { <span class="chip error sin-punto">no válido</span> }</dd>
            <dt>Autorizó WhatsApp</dt><dd>{{ t.whatsappAutorizado ? 'Sí' : 'No' }}</dd>
            @if (t.whatsappFallo) { <dt>Último fallo</dt><dd>WhatsApp no pudo entregar a {{ t.whatsappFallo.telefono }} el {{ t.whatsappFallo.en | date: 'dd/MM/yyyy' }}</dd> }
          }
        </dl>

        @if (!enviado() && x.resueltosAntes.length) {
          <p class="sutil">Este mismo problema ya se resolvió antes en la empresa:
            @for (r of x.resueltosAntes; track r.accion) { {{ textoAccion(r.accion) }} ({{ r.veces === 1 ? '1 vez' : r.veces + ' veces' }}){{ $last ? '.' : ';' }} }</p>
        }

        @if (!enviado() && x.explicacion; as c) {
          <div class="acciones-error">
            @if (tiene('celular') && x.conductor) {
              <div class="campo"><label for="ew-cel">Celular del conductor (10 dígitos)</label>
                <input id="ew-cel" name="cel" inputmode="numeric" maxlength="13" [ngModel]="celular()" (ngModelChange)="celular.set($event)" placeholder="3001234567" /></div>
            }
            @if (tiene('autorizar') && x.conductor && !x.conductor.whatsappAutorizado) {
              <label class="casilla"><input type="checkbox" name="aut" [ngModel]="autorizo()" (ngModelChange)="autorizo.set($event)" />
                El conductor me confirmó que acepta recibir sus documentos por WhatsApp</label>
            }
            @if (tiene('viaje')) { <p class="sutil">Elija el conductor del viaje en «Expedir» o en Viajes, y vuelva a enviar.</p> }
            @if (tiene('config')) {
              @if (x.puedeConfigurar) { <p><a routerLink="/configuracion" (click)="cerrar.emit()">Abrir Configuración</a> (pestaña WhatsApp)</p> }
              @else { <p class="sutil">Esto lo corrige el administrador de la empresa: avísele con el detalle de abajo.</p> }
            }
            @if (puedeEnviar()) {
              <button type="button" class="primario" [disabled]="trabajando() || !listoParaEnviar()" (click)="corregir()">{{ textoBoton() }}</button>
            }
          </div>
        }
        <details class="detalle"><summary>Detalle técnico</summary><p>{{ x.envio.error || 'Sin detalle' }} · intentos: {{ x.envio.intentos }}</p></details>
        @if (x.otrosConError && !enviado()) { <p class="sutil">Este conductor tiene {{ x.otrosConError }} envío(s) más con error; al corregir sus datos, reintente esos también.</p> }
      } @else if (cargando()) { <p class="sutil">Revisando el error…</p> }

      <div class="pie">
        @if (envios().length > 1) { <span class="sutil">{{ indice() + 1 }} de {{ envios().length }}</span> }
        @if (indice() < envios().length - 1) { <button type="button" (click)="ir(indice() + 1)">Siguiente</button> }
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
      </div>
    </app-modal>
  `,
  styles: [`
    .pasos { margin: 6px 0 10px; padding-left: 20px; }
    .datos { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 10px 0; font-size: 13.5px; }
    .datos dt { color: var(--gris-5); } .datos dd { margin: 0; }
    .acciones-error { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; padding: 12px; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); }
    .casilla { display: flex; gap: 8px; align-items: flex-start; font-weight: 400; }
    .acciones-error button { align-self: flex-start; }
    .detalle { font-size: 12.5px; color: var(--gris-5); margin-top: 8px; }
    .pie { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 14px; }
  `],
})
export class ErrorWhatsapp {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly envios = input<string[]>([]);
  readonly cerrar = output<void>();
  readonly corregido = output<void>();

  readonly indice = signal(0);
  readonly d = signal<Diagnostico | null>(null);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly celular = signal('');
  readonly autorizo = signal(false);

  readonly enviado = computed(() => ENVIADO.includes(this.d()?.envio.estado || ''));
  readonly titulo = computed(() => this.enviado() ? 'WhatsApp enviado' : 'No se pudo enviar por WhatsApp');
  tiene(a: string) { return !!this.d()?.explicacion?.acciones.includes(a); }
  readonly puedeEnviar = computed(() => ['celular', 'autorizar', 'reintentar'].some((a) => this.d()?.explicacion?.acciones.includes(a)));
  listoParaEnviar() {
    const t = this.d()?.conductor;
    if (this.tiene('autorizar') && t && !t.whatsappAutorizado && !this.autorizo()) return false;
    if (this.tiene('celular') && t && !/^3\d{9}$/.test(this.celular().replace(/\D/g, '').slice(-10))) return false;
    return true;
  }
  textoBoton() {
    const t = this.d()?.conductor;
    const cambia = (this.tiene('celular') && t && this.celular().replace(/\D/g, '').slice(-10) !== (t.celular || '').replace(/\D/g, '').slice(-10)) || (this.tiene('autorizar') && t && !t.whatsappAutorizado);
    return cambia ? 'Guardar y reenviar' : 'Reintentar';
  }
  textoAccion(a: string) { return ACCION[a] || a; }

  constructor() {
    effect(() => { const l = this.envios(); this.indice.set(0); if (l.length) this.cargar(l[0]); else this.d.set(null); });
  }
  ir(i: number) { this.indice.set(i); this.cargar(this.envios()[i]); }

  private async cargar(id: string) {
    this.cargando.set(true); this.d.set(null);
    try {
      const x = await this.api.get<Diagnostico>(`/whatsapp/envios/${id}/diagnostico`);
      if (this.envios()[this.indice()] !== id) return;
      this.d.set(x); this.celular.set(x.conductor?.celular || ''); this.autorizo.set(false);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async corregir() {
    const x = this.d();
    if (!x) return;
    const cuerpo: Record<string, unknown> = {};
    if (this.tiene('celular') && x.conductor) cuerpo['celular'] = this.celular();
    if (this.tiene('autorizar') && x.conductor && !x.conductor.whatsappAutorizado && this.autorizo()) cuerpo['autorizado'] = true;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<Diagnostico>(`/whatsapp/envios/${x.envio._id}/corregir`, cuerpo);
      this.d.set(r);
      if (ENVIADO.includes(r.envio.estado)) this.avisos.ok('Enviado por WhatsApp');
      else this.avisos.mostrar('Sigue sin enviarse: revise la nueva explicación', 'error');
      this.corregido.emit();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
