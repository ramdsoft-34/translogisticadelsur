import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { AutorizacionAdmin } from '../core/autorizacion.service';
import { Modal } from './modal';

// Avisos flotantes y diálogo de la contraseña del RNDC (uno para toda la app).
@Component({
  selector: 'app-globales',
  imports: [FormsModule, Modal],
  template: `
    <div class="avisos" role="status" aria-live="polite">
      @for (a of avisos.lista(); track a.id) {
        <div class="aviso" [class]="'aviso ' + a.tipo" (click)="avisos.cerrar(a.id)" title="Clic para cerrar">
          <span class="marca-aviso">{{ a.tipo === 'ok' ? '✓' : a.tipo === 'error' ? '!' : 'i' }}</span><span class="texto-aviso">{{ a.texto }}</span></div>
      }
    </div>
    <app-modal titulo="Contraseña del RNDC" [abierto]="clave.visible()" (cerrar)="cancelar()">
      <form (ngSubmit)="aceptar()" id="form-clave-rndc">
        <p class="sutil">Es la contraseña del usuario web service que el Ministerio de Transporte asignó a la empresa.
          No se guarda en la plataforma.</p>
        <div class="campo">
          <label for="clave-rndc">Contraseña</label>
          <input id="clave-rndc" type="password" name="clave" [(ngModel)]="valor" autocomplete="off" required />
        </div>
        <label class="casilla" style="margin-top:10px">
          <input type="checkbox" name="recordar" [(ngModel)]="recordar" /> Recordarla mientras esta pestaña esté abierta
        </label>
      </form>
      <ng-container pie>
        <button type="button" (click)="cancelar()">Cancelar</button>
        <button type="submit" form="form-clave-rndc" class="primario" [disabled]="!valor">Continuar</button>
      </ng-container>
    </app-modal>
    <app-modal titulo="Autorización del administrador" [abierto]="aut.visible()" (cerrar)="cancelarAut()">
      <form (ngSubmit)="autorizar()" id="form-aut-admin" class="formulario" style="grid-template-columns:1fr">
        <div class="mensaje error"><strong>Documentos vencidos:</strong><ul>@for (x of aut.vencidos(); track x) { <li>{{ x }}</li> }</ul></div>
        <p class="sutil">El viaje solo se guarda si el administrador de la empresa lo autoriza con su usuario y contraseña.
          Queda registrado quién autorizó, quién registró y el motivo.</p>
        <div class="campo"><label for="aut-email">Correo del administrador</label><input id="aut-email" type="email" name="email" [(ngModel)]="d.email" autocomplete="off" required /></div>
        <div class="campo"><label for="aut-clave">Contraseña del administrador</label><input id="aut-clave" type="password" name="clave" [(ngModel)]="d.clave" autocomplete="off" required /></div>
        <div class="campo"><label for="aut-cod">Código de la app autenticadora</label><input id="aut-cod" name="codigo" inputmode="numeric" maxlength="6" [(ngModel)]="d.codigo" autocomplete="off" placeholder="Solo si tiene doble factor" /></div>
        <div class="campo"><label for="aut-mot">Motivo</label><textarea id="aut-mot" name="motivo" rows="2" maxlength="300" [(ngModel)]="d.motivo" required placeholder="Ej.: SOAT renovado, el soporte llega mañana"></textarea></div>
      </form>
      <ng-container pie>
        <button type="button" (click)="cancelarAut()">Cancelar</button>
        <button type="submit" form="form-aut-admin" class="primario" [disabled]="!d.email || !d.clave || d.motivo.trim().length < 5">Autorizar y guardar</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .avisos { position: fixed; right: 20px; bottom: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 1000; width: min(400px, calc(100vw - 32px)); }
    .aviso { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; color: var(--gris-8); background: var(--gris-0);
      border: 1px solid var(--gris-2); box-shadow: var(--sombra-menu); cursor: pointer; font-size: 14px; line-height: 1.45; animation: subir .2s ease-out; }
    @keyframes subir { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .marca-aviso { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; font-weight: 800; font-size: 13px;
      background: var(--gris-15); color: var(--gris-6); }
    .aviso.ok .marca-aviso { background: var(--verde-claro); color: var(--verde); }
    .aviso.error { border-color: var(--rojo-borde); } .aviso.error .marca-aviso { background: var(--rojo); color: #fff; }
    .texto-aviso { padding-top: 2px; }
  `],
})
export class Globales {
  readonly avisos = inject(Avisos);
  readonly clave = inject(RndcClave);
  readonly aut = inject(AutorizacionAdmin);
  d = { email: '', clave: '', codigo: '', motivo: '' };
  autorizar() {
    if (!this.d.email || !this.d.clave) return;
    this.aut.responder({ ...this.d });
    this.d = { email: '', clave: '', codigo: '', motivo: '' };
  }
  cancelarAut() {
    if (!this.aut.visible()) return;
    this.aut.responder(null);
    this.d = { email: '', clave: '', codigo: '', motivo: '' };
  }
  valor = '';
  recordar = false;

  aceptar() {
    if (!this.valor) return;
    this.clave.responder(this.valor, this.recordar);
    this.valor = '';
  }
  cancelar() {
    if (!this.clave.visible()) return;
    this.clave.responder(null, false);
    this.valor = '';
  }
}
