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
        <div class="aviso" [class]="a.tipo" (click)="avisos.cerrar(a.id)">{{ a.texto }}</div>
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
    .avisos { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 1000; max-width: min(420px, calc(100vw - 32px)); }
    .aviso { padding: 12px 16px; border-radius: 10px; color: #fff; background: var(--negro); box-shadow: 0 8px 24px rgba(0,0,0,.18); cursor: pointer; font-size: 14px; }
    .aviso.ok { background: var(--negro); } .aviso.ok::before { content: "✓ "; color: #86efac; } .aviso.error { background: #7f1d1d; }
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
