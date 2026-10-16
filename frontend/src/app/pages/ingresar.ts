import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../core/auth.service';
import { mensajeError } from '../core/api.service';

@Component({
  selector: 'app-ingresar',
  imports: [FormsModule],
  template: `
    <main class="fondo">
      <form class="caja" (ngSubmit)="ingresar()">
        <div class="marca"><img src="logo.webp" alt="Translogística del Sur" width="640" height="332"><span>Viajes, manifiestos y RNDC</span></div>
        <div class="campo">
          <label for="email">Correo</label>
          <input id="email" type="email" name="email" [(ngModel)]="email" autocomplete="username" required autofocus />
        </div>
        <div class="campo">
          <label for="clave">Contraseña</label>
          <input id="clave" type="password" name="clave" [(ngModel)]="clave" autocomplete="current-password" required />
        </div>
        @if (error()) { <div class="mensaje error">{{ error() }}</div> }
        <button class="primario" type="submit" [disabled]="cargando() || !email || !clave">{{ cargando() ? 'Ingresando…' : 'Ingresar' }}</button>
      </form>
    </main>`,
  styles: [`
    .fondo { min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--gris-1); }
    .caja { width: min(380px, 100%); background: #fff; border-radius: 16px; border: 1px solid var(--gris-2); padding: 30px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 12px 32px -16px rgba(20,18,15,.18); }
    .marca { display: flex; flex-direction: column; gap: 6px; align-items: center; margin-bottom: 6px; text-align: center; }
    .marca img { width: min(230px, 80%); height: auto; display: block; }
    .marca span { color: var(--gris-5); font-size: 13px; }
    button { padding: 10px; }
  `],
})
export class Ingresar {
  private auth = inject(Auth);
  private router = inject(Router);
  email = '';
  clave = '';
  readonly cargando = signal(false);
  readonly error = signal('');

  async ingresar() {
    this.cargando.set(true); this.error.set('');
    try {
      const u = await this.auth.ingresar(this.email.trim(), this.clave);
      this.clave = '';
      this.router.navigateByUrl(u.debeCambiarClave ? '/mi-cuenta' : this.auth.inicio());
    } catch (e) {
      this.error.set(await mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }
}
