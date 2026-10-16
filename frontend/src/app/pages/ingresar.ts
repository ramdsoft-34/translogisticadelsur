import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../core/auth.service';
import { mensajeError } from '../core/api.service';
import { TemaService } from '../core/tema.service';
import { Icono } from '../shared/icono';

@Component({
  selector: 'app-ingresar',
  imports: [FormsModule, Icono],
  template: `
    <main class="fondo">
      <button type="button" class="tema" (click)="tema.alternar()" [attr.aria-label]="tema.tema() === 'oscuro' ? 'Activar modo claro' : 'Activar modo oscuro'"
        [title]="tema.tema() === 'oscuro' ? 'Modo claro' : 'Modo oscuro'"><app-icono [nombre]="tema.tema() === 'oscuro' ? 'sol' : 'luna'" [tam]="18" /></button>
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
    .fondo { position: relative; min-height: 100dvh; display: grid; place-items: center; padding: 16px; background: var(--fondo);
      background-image: linear-gradient(180deg, var(--negro) 0 34%, transparent 34%); }
    .tema { position: absolute; top: 16px; right: 16px; min-height: 0; width: 40px; height: 40px; padding: 0; border-radius: 50%;
      background: transparent; border-color: #3a3832; color: var(--primario); }
    .tema:hover:not(:disabled) { background: #26241f; border-color: var(--primario); }
    .caja { width: min(380px, 100%); background: var(--gris-0); border-radius: 16px; border: 1px solid var(--gris-2); border-top: 4px solid var(--primario); padding: 30px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 12px 32px -16px rgba(20,18,15,.18); }
    .marca { display: flex; flex-direction: column; gap: 6px; align-items: center; margin-bottom: 6px; text-align: center; }
    .marca img { width: min(230px, 80%); height: auto; display: block; }
    .marca span { color: var(--gris-5); font-size: 13px; }
    button { padding: 10px; }
  `],
})
export class Ingresar {
  readonly tema = inject(TemaService);
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
