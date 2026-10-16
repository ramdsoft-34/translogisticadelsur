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
          <h1>Gestión de viajes, manifiestos y RNDC en un solo lugar</h1>
          <p>La plataforma de operación para empresas de transporte de carga.</p>
        </div>
        <ul class="beneficios">
          <li><span class="ico"><app-icono nombre="camion" [tam]="18" /></span>Viajes, fletes y anticipos del día</li>
          <li><span class="ico"><app-icono nombre="documento" [tam]="18" /></span>Remesas y manifiestos ante el RNDC</li>
          <li><span class="ico"><app-icono nombre="dinero" [tam]="18" /></span>Liquidación y pagos a conductores</li>
        </ul>
        <!-- Carretera decorativa, como la del logotipo -->
        <svg class="via" viewBox="0 0 600 420" aria-hidden="true" preserveAspectRatio="xMaxYMax slice">
          <path class="via-borde" d="M600 40C430 60 300 140 250 260S210 420 210 420" />
          <path class="via-asfalto" d="M600 40C430 60 300 140 250 260S210 420 210 420" />
          <path class="via-linea" d="M600 40C430 60 300 140 250 260S210 420 210 420" />
        </svg>
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

          @if (error()) {
            <div class="error" role="alert"><app-icono nombre="alerta" [tam]="17" /><span>{{ error() }}</span></div>
          }

          <button class="entrar" type="submit" [disabled]="cargando() || !email || !clave">
            @if (cargando()) { <span class="giro" aria-hidden="true"></span>Ingresando… } @else { Ingresar }
          </button>

          <p class="ayuda"><app-icono nombre="llave" [tam]="15" />¿Olvidó su contraseña? Pida al administrador de su empresa que la restablezca.</p>
        </form>
        <p class="pie"><app-icono nombre="escudo" [tam]="14" />Acceso exclusivo para usuarios autorizados</p>
      </section>
    </main>`,
  styles: [`
    :host { display: block; }
    .pantalla { min-height: 100dvh; display: grid; grid-template-columns: minmax(420px, 1.05fr) 1fr; background: var(--gris-0); }

    /* ── Panel de marca (negro en los dos temas) ─────────────────────────── */
    .marca { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 34px; padding: 48px 56px;
      background: radial-gradient(120% 80% at 0% 0%, #1f1c14 0%, #0f0e0c 55%), #0f0e0c; color: #f3f0e8; isolation: isolate; }
    :host-context([data-tema="oscuro"]) .marca { background: radial-gradient(120% 80% at 0% 0%, #1a1710 0%, #050504 60%), #050504;
      border-right: 1px solid #24221d; }
    .logo { width: 220px; height: auto; display: block; }
    .mensaje-marca { max-width: 460px; }
    h1 { font-size: clamp(28px, 2.6vw, 38px); line-height: 1.12; letter-spacing: -.025em; font-weight: 700; color: #fff; }
    .mensaje-marca p { margin: 14px 0 0; color: #bdb8ab; font-size: 15.5px; }
    .beneficios { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; max-width: 340px; }
    .beneficios li { display: flex; align-items: center; gap: 12px; color: #e2ded4; font-weight: 500; }
    .ico { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: rgba(255, 194, 14, .12);
      color: var(--amarillo); box-shadow: inset 0 0 0 1px rgba(255, 194, 14, .28); }
    .derechos { margin-top: auto; color: #858072; font-size: 12.5px; }

    .via { position: absolute; right: 0; bottom: 0; width: 54%; height: 40%; z-index: -1; pointer-events: none; }
    .via path { fill: none; stroke-linecap: round; }
    .via-borde { stroke: var(--amarillo); stroke-width: 74; opacity: .9; }
    .via-asfalto { stroke: #26241f; stroke-width: 62; }
    .via-linea { stroke: #f3f0e8; stroke-width: 4; stroke-dasharray: 26 22; opacity: .85; animation: avanzar 2.4s linear infinite; }
    @keyframes avanzar { to { stroke-dashoffset: -96; } }

    /* ── Formulario ──────────────────────────────────────────────────────── */
    .acceso { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 48px 24px; background: var(--gris-0); }
    .formulario-acceso { width: min(400px, 100%); display: flex; flex-direction: column; gap: 20px; animation: entrar .45s cubic-bezier(.2, .7, .2, 1); }
    @keyframes entrar { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    header h2 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -.02em; color: var(--gris-8); }
    header h2::after { content: ""; display: block; width: 44px; height: 4px; margin-top: 12px; border-radius: 4px; background: var(--primario); }
    header p { margin: 12px 0 0; color: var(--gris-5); font-size: 14.5px; }

    .campo-acceso { display: flex; flex-direction: column; gap: 7px; }
    .campo-acceso label { font-size: 13.5px; font-weight: 600; color: var(--gris-7); }
    .control { position: relative; display: flex; align-items: center; }
    .control .lead { position: absolute; left: 14px; color: var(--gris-4); pointer-events: none; transition: color var(--transicion); }
    .control input { min-height: 50px; padding-left: 44px; font-size: 15px; border-width: 1.5px; border-radius: 12px; background: var(--campo); }
    .control input[name=clave] { padding-right: 50px; }
    .control:focus-within .lead { color: var(--gris-8); }
    .control input[aria-invalid=true] { border-color: var(--rojo); }
    .ver { position: absolute; right: 6px; min-height: 0; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--gris-5); }
    .ver:hover:not(:disabled) { background: var(--gris-15); color: var(--gris-8); }

    .error { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; font-size: 14px; line-height: 1.45;
      background: var(--rojo-claro); color: var(--rojo-texto); border: 1px solid var(--rojo-borde); }
    .error app-icono { color: var(--rojo); margin-top: 1px; }

    .entrar { min-height: 52px; border-radius: 12px; font-size: 16px; font-weight: 700; letter-spacing: .01em; gap: 10px;
      background: var(--primario); border: 1px solid var(--primario-borde); color: var(--sobre-primario);
      box-shadow: 0 10px 24px -12px rgba(224, 173, 0, .8); }
    .entrar:hover:not(:disabled) { background: var(--primario-hover); border-color: var(--primario-borde); transform: translateY(-1px); }
    .entrar:disabled { opacity: 1; background: var(--gris-15); border-color: var(--gris-2); color: var(--gris-4); box-shadow: none; }
    .giro { width: 17px; height: 17px; border-radius: 50%; border: 2.5px solid currentColor; border-right-color: transparent; animation: girar .7s linear infinite; }
    @keyframes girar { to { transform: rotate(360deg); } }

    .ayuda { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding-top: 16px; border-top: 1px solid var(--gris-15);
      color: var(--gris-5); font-size: 13px; line-height: 1.5; }
    .ayuda app-icono { color: var(--primario-texto); margin-top: 2px; flex: none; }
    .pie { display: flex; gap: 7px; align-items: center; margin: 0; color: var(--gris-4); font-size: 12.5px; }

    /* ── Tableta y móvil: la marca pasa a una franja superior ─────────────── */
    @media (max-width: 960px) {
      .pantalla { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
      .marca { padding: 28px 24px 30px; gap: 18px; }
      .logo { width: 150px; }
      .beneficios, .derechos { display: none; }
      .mensaje-marca { max-width: 46ch; }
      h1 { font-size: 22px; }
      .mensaje-marca p { margin-top: 8px; font-size: 14px; }
      .via { width: 60%; height: 100%; opacity: .55; }
      .acceso { justify-content: flex-start; padding: 32px 20px 28px; }
    }
    @media (max-width: 520px) {
      .marca { padding: 18px 20px; }
      .mensaje-marca { display: none; }
      .logo { width: 120px; }
      header h2 { font-size: 24px; }
    }
  `],
})
export class Ingresar {
  private tema = inject(TemaService);
  private auth = inject(Auth);
  private router = inject(Router);
  email = '';
  clave = '';
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
