import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
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
