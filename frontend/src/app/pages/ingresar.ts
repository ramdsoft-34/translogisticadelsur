import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../core/auth.service';
import { mensajeError } from '../core/api.service';
import { TemaService } from '../core/tema.service';
import { Icono } from '../shared/icono';

// Inicio de sesión. Sigue la apariencia del sistema (claro/oscuro) y, al salir,
// devuelve el tema que el usuario eligió dentro de la plataforma.
@Component({
  selector: 'app-ingresar',
  imports: [FormsModule, Icono],
  template: `
    <main class="pantalla">
      <!-- Panel de marca -->
      <section class="marca" aria-label="Translogística del Sur">
        <img class="logo" src="logo.webp" alt="Translogística del Sur" width="640" height="332">
        <div class="mensaje-marca">
          <span class="eyebrow">Plataforma de operación de carga</span>
          <h1>Viajes, manifiestos y pagos, en orden y al día.</h1>
          <p>Registre la operación, expida ante el RNDC, siga los vehículos y liquide a clientes y conductores desde un mismo lugar.</p>
        </div>
        <ul class="beneficios">
          <li><span class="ico"><app-icono nombre="camion" [tam]="18" /></span><span><strong>Operación</strong><small>Viajes, programación y monitoreo GPS</small></span></li>
          <li><span class="ico"><app-icono nombre="documento" [tam]="18" /></span><span><strong>Documentos</strong><small>Remesas, manifiestos y soporte interno</small></span></li>
          <li><span class="ico"><app-icono nombre="dinero" [tam]="18" /></span><span><strong>Finanzas</strong><small>Facturación, pago a conductores y contabilidad</small></span></li>
        </ul>
        <small class="derechos">© {{ anio }} Translogística del Sur</small>
      </section>

      <!-- Formulario -->
      <section class="acceso">
        <form class="formulario-acceso" (ngSubmit)="ingresar()" novalidate>
          <header>
            <h2>Iniciar sesión</h2>
            <p>Ingrese con el correo y la contraseña asignados por su empresa.</p>
          </header>

          <div class="campo-acceso">
            <label for="email">Correo electrónico</label>
            <div class="control">
              <app-icono nombre="correo" [tam]="18" class="lead" />
              <input id="email" type="email" name="email" [(ngModel)]="email" autocomplete="username" inputmode="email"
                placeholder="nombre@empresa.com" required autofocus [attr.aria-invalid]="!!error()" />
            </div>
          </div>

          <div class="campo-acceso">
            <label for="clave">Contraseña</label>
            <div class="control">
              <app-icono nombre="candado" [tam]="18" class="lead" />
              <input id="clave" [type]="verClave() ? 'text' : 'password'" name="clave" [(ngModel)]="clave" autocomplete="current-password"
                placeholder="Su contraseña" required [attr.aria-invalid]="!!error()" />
              <button type="button" class="ver" (click)="verClave.set(!verClave())" [attr.aria-pressed]="verClave()"
                [attr.aria-label]="verClave() ? 'Ocultar contraseña' : 'Mostrar contraseña'" [title]="verClave() ? 'Ocultar contraseña' : 'Mostrar contraseña'">
                <app-icono [nombre]="verClave() ? 'ojo-oculto' : 'ojo'" [tam]="18" />
              </button>
            </div>
          </div>

          @if (pideCodigo()) {
            <div class="campo-acceso">
              <label for="codigo">Código de la app autenticadora</label>
              <div class="control">
                <app-icono nombre="escudo" [tam]="18" class="lead" />
                <input id="codigo" name="codigo" [(ngModel)]="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                  placeholder="6 dígitos" required [attr.aria-invalid]="!!error()" />
              </div>
            </div>
          }

          @if (error()) {
            <div class="error" role="alert"><app-icono nombre="alerta" [tam]="17" /><span>{{ error() }}</span></div>
          }

          <button class="entrar" type="submit" [disabled]="cargando() || !email || !clave || (pideCodigo() && codigo.length < 6)">
            @if (cargando()) { <span class="giro" aria-hidden="true"></span>Ingresando… } @else { Ingresar }
          </button>

          <p class="ayuda"><app-icono nombre="llave" [tam]="15" />¿Olvidó su contraseña? Pida al administrador de su empresa que la restablezca.</p>
        </form>
        <p class="pie"><app-icono nombre="escudo" [tam]="14" />Acceso exclusivo para usuarios autorizados</p>
      </section>
    </main>`,
  styles: [`
    :host { display: block; }
    /* Fondo tinta con una trama de puntos y un brillo ámbar: igual en los dos temas */
    .pantalla { min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(380px, 470px); gap: 48px; align-items: center;
      padding: 48px clamp(24px, 6vw, 96px); color: #e8ecf2; isolation: isolate; position: relative; overflow: hidden;
      background:
        radial-gradient(60% 55% at 85% 20%, rgba(246, 184, 15, .16), transparent 70%),
        radial-gradient(50% 60% at 0% 100%, rgba(37, 99, 201, .12), transparent 70%),
        radial-gradient(rgba(255, 255, 255, .07) 1px, transparent 1.2px) 0 0 / 22px 22px,
        #0d1117; }

    .marca { display: flex; flex-direction: column; gap: 36px; max-width: 600px; }
    .logo { width: 210px; height: auto; display: block; }
    .eyebrow { display: inline-block; font-size: 12.5px; font-weight: 700; color: #f6b80f; letter-spacing: .02em; margin-bottom: 12px; }
    h1 { font-size: clamp(30px, 3.4vw, 46px); line-height: 1.08; letter-spacing: -.035em; font-weight: 800; color: #fff; margin: 0; }
    .mensaje-marca p { margin: 16px 0 0; color: #a6afbd; font-size: 16px; max-width: 52ch; line-height: 1.6; }
    .beneficios { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-width: 460px; }
    .beneficios li { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 14px; background: rgba(255, 255, 255, .035);
      border: 1px solid rgba(255, 255, 255, .07); }
    .beneficios li span:last-child { display: flex; flex-direction: column; line-height: 1.3; }
    .beneficios strong { color: #fff; font-size: 14.5px; } .beneficios small { color: #8d97a8; font-size: 13px; }
    .ico { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: rgba(246, 184, 15, .14); color: #f6b80f; }
    .derechos { color: #6b7586; font-size: 12.5px; }

    /* Tarjeta de acceso */
    .acceso { display: flex; flex-direction: column; gap: 16px; }
    .formulario-acceso { display: flex; flex-direction: column; gap: 18px; padding: 34px 32px 28px; border-radius: 22px; background: var(--gris-0); color: var(--gris-8);
      box-shadow: 0 40px 80px -30px rgba(0, 0, 0, .65), 0 0 0 1px rgba(255, 255, 255, .06); animation: entrar .45s cubic-bezier(.2, .7, .2, 1); }
    @keyframes entrar { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    header h2 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -.025em; color: var(--gris-8); }
    header p { margin: 8px 0 0; color: var(--gris-5); font-size: 14px; }

    .campo-acceso { display: flex; flex-direction: column; gap: 7px; }
    .campo-acceso label { font-size: 13px; font-weight: 700; color: var(--gris-7); }
    .control { position: relative; display: flex; align-items: center; }
    .control .lead { position: absolute; left: 14px; color: var(--gris-4); pointer-events: none; transition: color var(--transicion); }
    .control input { min-height: 50px; padding-left: 44px; font-size: 15px; border-radius: 12px; background: var(--campo); }
    .control input[name=clave] { padding-right: 50px; }
    .control:focus-within .lead { color: var(--primario-texto); }
    .control input[aria-invalid=true] { border-color: var(--rojo); }
    .ver { position: absolute; right: 6px; min-height: 0; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--gris-5); box-shadow: none; }
    .ver:hover:not(:disabled) { background: var(--gris-15); color: var(--gris-8); }

    .error { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; font-size: 14px; line-height: 1.45;
      background: var(--rojo-claro); color: var(--rojo-texto); border: 1px solid var(--rojo-borde); }
    .error app-icono { color: var(--rojo); margin-top: 1px; }

    .entrar { min-height: 52px; border-radius: 12px; font-size: 16px; font-weight: 800; gap: 10px; margin-top: 4px;
      background: var(--primario); border: 1px solid var(--primario-borde); color: var(--sobre-primario); box-shadow: 0 12px 26px -14px rgba(220, 163, 0, .9); }
    .entrar:hover:not(:disabled) { background: var(--primario-hover); border-color: var(--primario-borde); transform: translateY(-1px); }
    .entrar:disabled { opacity: 1; background: var(--gris-15); border-color: var(--gris-2); color: var(--gris-4); box-shadow: none; }
    .giro { width: 17px; height: 17px; border-radius: 50%; border: 2.5px solid currentColor; border-right-color: transparent; animation: girar .7s linear infinite; }
    @keyframes girar { to { transform: rotate(360deg); } }

    .ayuda { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding-top: 16px; border-top: 1px solid var(--gris-15);
      color: var(--gris-5); font-size: 13px; line-height: 1.5; }
    .ayuda app-icono { color: var(--primario-texto); margin-top: 2px; flex: none; }
    .pie { display: flex; gap: 7px; align-items: center; justify-content: center; margin: 0; color: #8d97a8; font-size: 12.5px; }

    @media (max-width: 960px) {
      .pantalla { grid-template-columns: 1fr; gap: 26px; padding: 28px 18px 32px; align-content: start; }
      .marca { gap: 18px; }
      .logo { width: 150px; }
      .beneficios, .derechos { display: none; }
      h1 { font-size: 26px; }
      .mensaje-marca p { font-size: 14px; margin-top: 10px; }
      .acceso { width: min(470px, 100%); justify-self: center; }
    }
    @media (max-width: 520px) {
      .mensaje-marca p { display: none; }
      .formulario-acceso { padding: 26px 20px 22px; border-radius: 18px; }
    }
  `],
})
export class Ingresar {
  private tema = inject(TemaService);
  private auth = inject(Auth);
  private router = inject(Router);
  email = '';
  clave = '';
  codigo = '';
  readonly pideCodigo = signal(false);
  readonly anio = new Date().getFullYear();
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly verClave = signal(false);

  constructor() {
    // Apariencia del sistema mientras se muestra el login (y si cambia en vivo).
    const sistema = matchMedia('(prefers-color-scheme: dark)');
    const aplicar = () => this.tema.aplicar(sistema.matches ? 'oscuro' : 'claro');
    aplicar();
    sistema.addEventListener('change', aplicar);
    inject(DestroyRef).onDestroy(() => {
      sistema.removeEventListener('change', aplicar);
      this.tema.aplicar(this.tema.tema());
    });
  }

  async ingresar() {
    this.cargando.set(true); this.error.set('');
    try {
      const u = await this.auth.ingresar(this.email.trim(), this.clave, this.pideCodigo() ? this.codigo.trim() : undefined);
      if (!u) {
        // Doble factor: falta el código de la app
        this.pideCodigo.set(true);
        setTimeout(() => document.getElementById('codigo')?.focus(), 30);
        return;
      }
      this.clave = ''; this.codigo = '';
      this.router.navigateByUrl(u.debeCambiarClave ? '/mi-cuenta' : this.auth.inicio());
    } catch (e) {
      this.error.set(await mensajeError(e));
    } finally {
      this.cargando.set(false);
    }
  }
}
