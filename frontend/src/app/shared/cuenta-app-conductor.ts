import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Auth } from '../core/auth.service';
import { P, nombreTercero } from '../core/modelos';
import { Modal } from './modal';
import { Icono } from './icono';
import { Confirmar } from './confirmar';
import { FORMATOS } from './formato';

const ESTADOS: Record<string, { texto: string; clase: string; ayuda: string }> = {
  sin_cuenta: { texto: 'Sin cuenta', clase: '', ayuda: 'Sus viajes siguen llegando a la app anterior.' },
  invitado: { texto: 'Invitado', clase: 'alerta', ayuda: 'Tiene un código pero aún no lo ha usado. Mientras tanto, sus viajes siguen llegando a la app anterior.' },
  activo: { texto: 'Activo', clase: 'ok', ayuda: 'Usa la app nueva: sus viajes, entregas, fotos y preoperacional llegan por ella.' },
  bloqueado: { texto: 'Bloqueado', clase: 'error', ayuda: 'La cuenta está bloqueada en la app.' },
};

// Cuenta del conductor en la app Sur Track nueva: estado, invitar con un código y quitar acceso.
// Uso: <app-cuenta-app-conductor #app /> … app.abrir(tercero)
@Component({
  selector: 'app-cuenta-app-conductor',
  imports: [FormsModule, Modal, Icono, Confirmar, ...FORMATOS],
  template: `
    <app-modal titulo="App de conductores" [abierto]="abierto()" (cerrar)="cerrar()">
      @if (tercero(); as t) {
        <p><strong>{{ nombre(t) }}</strong> <span class="sutil">· C.C. {{ t.numId }}</span></p>
        @if (cargando()) { <p class="sutil">Consultando la app…</p> }
        @else if (codigo(); as c) {
          <div class="mensaje ok">
            <p style="margin:0 0 6px">Entréguele este código al conductor. Sirve una sola vez y vence el {{ c.vence | fechaHora }}.</p>
            <p class="codigo" aria-label="Código de activación">{{ c.codigo }}</p>
            <p style="margin:6px 0 0">En la app: <strong>«Tengo un código»</strong>, con el correo <strong>{{ c.correo }}</strong>, el código y una contraseña nueva.</p>
          </div>
          <p class="sutil">El código no se vuelve a mostrar. Si se pierde, genere uno nuevo.</p>
        } @else if (cuenta(); as k) {
          <p><span class="chip" [class]="estado(k.estado).clase">{{ estado(k.estado).texto }}</span>
            @if (k.correo) { <span class="sutil"> · {{ k.correo }}</span> }</p>
          <p class="sutil">{{ estado(k.estado).ayuda }}</p>
          @if (k.estado === 'invitado' && k.invitacionVence) { <p class="sutil">El código actual vence el {{ k.invitacionVence | fechaHora }}.</p> }
          @if (puedeEditar && k.estado !== 'bloqueado') {
            <form id="form-app-conductor" class="formulario" (ngSubmit)="invitar()">
              <div class="campo ancho"><label for="app-correo">Correo del conductor</label>
                <input id="app-correo" name="correo" type="email" [(ngModel)]="correo" required [readonly]="k.estado === 'activo'" autocomplete="off" />
                <small>{{ k.estado === 'activo' ? 'Con este correo entra a la app. Un código nuevo le sirve para cambiar la contraseña.' : 'Con este correo entrará a la app.' }}</small></div>
            </form>
          }
        }
      }
      <ng-container pie>
        @if (codigo()) { <button type="button" class="primario" (click)="cerrar()">Listo</button> }
        @else {
          <button type="button" (click)="cerrar()">Cerrar</button>
          @if (puedeEditar && cuenta(); as k) {
            @if (k.estado === 'activo' || k.estado === 'invitado') {
              <button type="button" class="peligro" confirmar="Clic otra vez: no podrá entrar con esta empresa" (confirmado)="desvincular()" [disabled]="trabajando()">Quitar acceso</button>
            }
            @if (k.estado !== 'bloqueado') {
              <button type="submit" class="primario" form="form-app-conductor" [disabled]="trabajando() || !correo.trim()">
                <app-icono nombre="enviar" [tam]="16" />{{ k.estado === 'sin_cuenta' ? 'Invitar a la app' : 'Generar código nuevo' }}</button>
            }
          }
        }
      </ng-container>
    </app-modal>`,
  styles: [`
    .codigo { font: 700 30px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .18em; margin: 6px 0; user-select: all; }
  `],
})
export class CuentaAppConductor {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly puedeEditar = inject(Auth).tiene(P.MAESTROS_EDITAR);
  readonly abierto = signal(false);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly tercero = signal<any>(null);
  readonly cuenta = signal<{ estado: string; correo: string; invitacionVence: string | null; correoTercero: string } | null>(null);
  readonly codigo = signal<{ codigo: string; vence: string; correo: string } | null>(null);
  correo = '';
  nombre = nombreTercero;
  estado(e: string) { return ESTADOS[e] || ESTADOS['sin_cuenta']; }

  async abrir(t: any) {
    this.tercero.set(t); this.cuenta.set(null); this.codigo.set(null); this.abierto.set(true);
    await this.consultar();
  }
  cerrar() { this.abierto.set(false); this.codigo.set(null); }

  private async consultar() {
    this.cargando.set(true);
    try {
      const k = await this.api.get<any>(`/rastreo/conductores/${this.tercero()._id}/app`);
      this.cuenta.set(k); this.correo = k.correo || k.correoTercero || '';
    } catch (e) { this.avisos.error(e); this.abierto.set(false); }
    finally { this.cargando.set(false); }
  }

  async invitar() {
    if (this.trabajando()) return;
    this.trabajando.set(true);
    try { this.codigo.set(await this.api.post<any>(`/rastreo/conductores/${this.tercero()._id}/app/invitar`, { correo: this.correo.trim() })); }
    catch (e) { this.avisos.error(e); }
    finally { this.trabajando.set(false); }
  }

  async desvincular() {
    this.trabajando.set(true);
    try {
      await this.api.post(`/rastreo/conductores/${this.tercero()._id}/app/desvincular`, {});
      this.avisos.ok('El conductor ya no puede entrar a la app con esta empresa');
      await this.consultar();
    } catch (e) { this.avisos.error(e); }
    finally { this.trabajando.set(false); }
  }
}
