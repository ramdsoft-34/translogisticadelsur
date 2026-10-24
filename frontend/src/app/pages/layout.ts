import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { environment } from '../../environments/environment';
import { Avisos } from '../core/avisos.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { Auth } from '../core/auth.service';
import { RndcClave } from '../core/rndc-clave.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { TemaService } from '../core/tema.service';

interface Opcion { ruta: string; texto: string; icono: string; permisos: string[]; grupo?: string }

const MENU: Opcion[] = [
  { ruta: '/inicio', texto: 'Inicio', icono: 'inicio', permisos: [P.VIAJES_VER] },
  // Operación diaria
  { ruta: '/viajes', texto: 'Viajes', icono: 'camion', permisos: [P.VIAJES_VER], grupo: 'Operación' },
  { ruta: '/relaciones', texto: 'Programación por placa', icono: 'lista', permisos: [P.VIAJES_VER], grupo: 'Operación' },
  { ruta: '/monitoreo', texto: 'Monitoreo', icono: 'ubicacion', permisos: [P.VIAJES_VER], grupo: 'Operación' },

  { ruta: '/manifiestos', texto: 'Manifiestos', icono: 'documento', permisos: [P.RNDC_OPERAR], grupo: 'Documentos' },
  { ruta: '/soporte-interno', texto: 'Soporte interno', icono: 'documento', permisos: [P.VIAJES_VER], grupo: 'Documentos' },
  { ruta: '/remesas-dulces', texto: 'Remesas Dulces', icono: 'documento', permisos: [P.VIAJES_REGISTRAR], grupo: 'Documentos' },
  // Dinero
  { ruta: '/liquidaciones', texto: 'Facturación a clientes', icono: 'dinero', permisos: [P.LIQUIDACION_VER], grupo: 'Finanzas' },
  { ruta: '/pago-conductores', texto: 'Pago a conductores', icono: 'personas', permisos: [P.LIQUIDACION_VER], grupo: 'Finanzas' },
  { ruta: '/contabilidad', texto: 'Contabilidad y cierre', icono: 'lista', permisos: [P.LIQUIDACION_VER], grupo: 'Finanzas' },
  // Datos maestros
  { ruta: '/clientes', texto: 'Clientes y tarifas', icono: 'edificio', permisos: [P.MAESTROS_VER], grupo: 'Datos' },
  { ruta: '/conductores', texto: 'Conductores y terceros', icono: 'personas', permisos: [P.MAESTROS_VER], grupo: 'Datos' },
  { ruta: '/vehiculos', texto: 'Vehículos', icono: 'camion', permisos: [P.MAESTROS_VER], grupo: 'Datos' },
  { ruta: '/revision', texto: 'Revisión de datos', icono: 'alerta', permisos: [P.MAESTROS_VER], grupo: 'Datos' },

  { ruta: '/consultas-rndc', texto: 'Consultas al RNDC', icono: 'buscar', permisos: [P.RNDC_CONSULTAR], grupo: 'RNDC' },
  { ruta: '/rndc/envios', texto: 'Envíos al RNDC', icono: 'enviar', permisos: [P.RNDC_OPERAR], grupo: 'RNDC' },
  { ruta: '/rndc/correos', texto: 'Correos de manifiestos', icono: 'correo', permisos: [P.RNDC_OPERAR], grupo: 'RNDC' },
  // Administración
  { ruta: '/configuracion', texto: 'Configuración', icono: 'ajustes', permisos: [P.CONFIG_GESTIONAR, P.USUARIOS_GESTIONAR], grupo: 'Empresa' },
  { ruta: '/admin/empresas', texto: 'Empresas', icono: 'edificio', permisos: [P.EMPRESAS_GESTIONAR], grupo: 'Plataforma' },
  { ruta: '/admin/auditoria', texto: 'Auditoría', icono: 'escudo', permisos: [P.EMPRESAS_GESTIONAR], grupo: 'Plataforma' },
];

function leerFijo() {
  try { return localStorage.getItem('tls_menu_fijo') === '1'; } catch { return false; }
}

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono],
  template: `
    <a class="saltar" href="#contenido">Saltar al contenido</a>
    <div class="app" [class.fijo]="fijo()" [class.menu-abierto]="menuAbierto()">
      <!-- Barra lateral: solo íconos; se despliega al pasar el mouse o queda fija -->
      <aside aria-label="Navegación principal" [class.desplegado]="fijo()">
        <div class="marca">
          <!-- Contraído: solo el ícono. Desplegado: el nombre de la empresa -->
          <span class="logos">
            <img class="logo" src="icono.png" alt="Translogística del Sur" width="40" height="17">
            <img class="etq nombre" src="nombre.webp" alt="" width="400" height="60">
          </span>
          <button type="button" class="fijar etq" (click)="alternarFijo()" [attr.aria-pressed]="fijo()"
            [title]="fijo() ? 'No fijar el menú (mostrar solo íconos)' : 'Fijar el menú abierto'">
            <app-icono [nombre]="fijo() ? 'desfijar' : 'fijar'" [tam]="15" />
          </button>
        </div>
        <nav>
          @for (g of grupos(); track g.nombre) {
            @if (g.nombre) { <div class="grupo"><span class="etq">{{ g.nombre }}</span></div> }
            @for (o of g.opciones; track o.ruta) {
              <a [routerLink]="o.ruta" routerLinkActive="activa" (click)="alNavegar($event)" [attr.aria-label]="o.texto" [title]="fijo() ? '' : o.texto">
                <app-icono [nombre]="o.icono" [tam]="18" /><span class="etq">{{ o.texto }}</span></a>
            }
          }
        </nav>
      </aside>

      <div class="principal">
        <header>
          <button class="texto menu" (click)="menuAbierto.set(!menuAbierto())" aria-label="Abrir menú"><app-icono nombre="menu" /></button>
          <div class="contexto">
            <strong>{{ u()?.empresa?.nombre || 'Administración global' }}</strong>
            @if (u()?.empresa; as e) {
              <span class="ambiente" [class.prod]="e.ambienteRndc === 'PRODUCCION'" title="Ambiente del RNDC de la empresa"><i></i>RNDC {{ ambiente(e.ambienteRndc) }}</span>
            }
          </div>

          <button type="button" class="tema" (click)="tema.alternar()" [attr.aria-pressed]="tema.tema() === 'oscuro'"
            [attr.aria-label]="tema.tema() === 'oscuro' ? 'Activar modo claro' : 'Activar modo oscuro'"
            [title]="tema.tema() === 'oscuro' ? 'Modo claro' : 'Modo oscuro'">
            <app-icono [nombre]="tema.tema() === 'oscuro' ? 'sol' : 'luna'" [tam]="18" />
          </button>

          <!-- Menú de usuario -->
          <div class="usuario">
            <button type="button" class="disparador" aria-label="Menú de usuario" (click)="menuUsuario.set(!menuUsuario())" [attr.aria-expanded]="menuUsuario()" aria-haspopup="menu">
              <span class="avatar">{{ iniciales(u()?.nombre || '') }}</span>
              <span class="txt"><strong>{{ u()?.nombre }}</strong><small>{{ u()?.rolNombre }}</small></span>
              <app-icono nombre="chevron" [tam]="16" class="flecha" [class.girada]="menuUsuario()" />
            </button>
            @if (menuUsuario()) {
              <div class="desplegable" role="menu">
                <div class="cabeza">
                  <span class="avatar grande">{{ iniciales(u()?.nombre || '') }}</span>
                  <span class="txt"><strong>{{ u()?.nombre }}</strong><small>{{ u()?.rolNombre }}</small><small>{{ u()?.email }}</small></span>
                </div>
                <a role="menuitem" routerLink="/mi-cuenta" (click)="menuUsuario.set(false)"><app-icono nombre="usuario" [tam]="17" />Mi perfil</a>
                <a role="menuitem" routerLink="/privacidad" (click)="menuUsuario.set(false)"><app-icono nombre="escudo" [tam]="17" />Política y privacidad</a>
                <button type="button" role="menuitem" (click)="tema.alternar()"><app-icono [nombre]="tema.tema() === 'oscuro' ? 'sol' : 'luna'" [tam]="17" />{{ tema.tema() === 'oscuro' ? 'Modo claro' : 'Modo oscuro' }}</button>
                <hr />
                <button type="button" role="menuitem" class="cerrar" (click)="salir()"><app-icono nombre="salir" [tam]="17" />Cerrar sesión</button>
              </div>
            }
          </div>
        </header>
        <main id="contenido"><router-outlet /></main>
      </div>
      <div class="velo" (click)="menuAbierto.set(false)"></div>
    </div>`,
  styles: [`
    .saltar { position: absolute; left: -999px; top: 8px; z-index: 100; background: var(--negro); color: #fff; padding: 8px 12px; border-radius: 8px; }
    .saltar:focus { left: 8px; }
    .app { --ancho-min: 64px; --ancho-max: 232px; display: grid; grid-template-columns: var(--ancho-min) 1fr; min-height: 100dvh; transition: grid-template-columns .2s ease; }
    .app.fijo { grid-template-columns: var(--ancho-max) 1fr; }

    /* Barra lateral: ocupa el ancho mínimo y se superpone al desplegarse con el mouse */
    aside { position: sticky; top: 0; height: 100dvh; z-index: var(--z-menu); width: var(--ancho-min); background: var(--lateral);
      border-right: 1px solid var(--lateral-borde); color: var(--lateral-texto); display: flex; flex-direction: column; overflow: hidden;
      transition: width .2s ease, box-shadow .2s ease; }
    /* Se despliega solo mientras el cursor está encima, con foco de teclado (Tab) o si el usuario lo fijó.
       No se usa :focus-within: el clic deja el foco en el enlace y el menú quedaba abierto al navegar. */
    aside:hover, aside:has(:focus-visible), aside.desplegado { width: var(--ancho-max); }
    .app:not(.fijo) aside:hover, .app:not(.fijo) aside:has(:focus-visible) { box-shadow: 14px 0 36px -14px rgba(0,0,0,.45); }
    .etq { opacity: 0; white-space: nowrap; transition: opacity .12s ease; pointer-events: none; }
    aside:hover .etq, aside:has(:focus-visible) .etq, aside.desplegado .etq { opacity: 1; pointer-events: auto; transition-delay: .06s; }

    .marca { display: flex; gap: 10px; align-items: center; padding: 16px 12px 12px; min-height: 62px; }
    .logos { position: relative; flex: 1; min-width: 0; height: 30px; display: flex; align-items: center; }
    .logo { flex: none; width: 40px; height: auto; display: block; transition: opacity .12s ease; }
    .nombre { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 168px; height: auto; display: block; }
    aside:hover .logo, aside:has(:focus-visible) .logo, aside.desplegado .logo { opacity: 0; }
    .marca { border-bottom: 1px solid var(--lateral-linea); margin-bottom: 6px; }
    .fijar { min-height: 0; width: 28px; height: 28px; padding: 0; border-radius: 7px; border-color: transparent; background: transparent; color: var(--lateral-tenue); flex: none; }
    .fijar:hover:not(:disabled) { background: var(--lateral-hover); color: #fff; border-color: transparent; }
    .fijo .fijar { color: var(--primario); }

    /* El menú se desplaza cuando no cabe en la pantalla (la marca queda fija arriba) */
    nav { display: flex; flex-direction: column; padding: 4px 12px 16px; gap: 2px; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
      overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--lateral-linea) transparent; }
    nav::-webkit-scrollbar { width: 6px; } nav::-webkit-scrollbar-thumb { background: var(--lateral-linea); border-radius: 3px; }
    .grupo { height: 26px; margin-top: 10px; padding: 0 9px; display: flex; align-items: center; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--lateral-tenue); border-top: 1px solid var(--lateral-linea); }
    aside:hover .grupo, aside.desplegado .grupo { border-top-color: transparent; }
    nav a { position: relative; display: flex; gap: 12px; align-items: center; height: 38px; padding: 0 10px; border-radius: 9px; color: var(--lateral-texto);
      text-decoration: none; font-weight: 500; transition: background var(--transicion), color var(--transicion); }
    nav a app-icono { flex: none; }
    nav a:hover { background: var(--lateral-hover); color: #fff; }
    nav a.activa { background: var(--primario); color: var(--sobre-primario); font-weight: 650; }
    nav a.activa::before { content: ""; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--primario); }
    nav a:focus-visible { box-shadow: 0 0 0 2px var(--primario); }

    .principal { min-width: 0; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; gap: 12px; padding: 10px 28px; background: var(--cabecera); backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--gris-2); box-shadow: inset 0 -3px 0 var(--primario); position: sticky; top: 0; z-index: var(--z-cabecera); }
    .contexto { flex: 1; display: flex; gap: 10px; align-items: center; min-width: 0; }
    .contexto strong { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ambiente { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--gris-5); white-space: nowrap; }
    .ambiente i { width: 7px; height: 7px; border-radius: 50%; background: var(--ambar); }
    .ambiente.prod i { background: var(--verde); }

    .tema { min-height: 0; width: 38px; height: 38px; padding: 0; border-radius: 50%; border: 1px solid var(--gris-2); background: var(--gris-0); color: var(--gris-8); }
    .tema:hover:not(:disabled) { background: var(--negro); border-color: var(--negro); color: var(--primario); }

    /* Menú de usuario */
    .usuario { position: relative; }
    .disparador { display: flex; gap: 10px; align-items: center; min-height: 0; padding: 5px 10px 5px 5px; border-radius: 999px; border: 1px solid var(--gris-2); background: var(--gris-0); }
    .disparador:hover:not(:disabled) { background: var(--gris-1); border-color: var(--gris-3); }
    .avatar { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--primario); color: var(--sobre-primario);
      font-weight: 650; font-size: 12px; }
    .avatar.grande { width: 42px; height: 42px; font-size: 14px; }
    .txt { display: flex; flex-direction: column; line-height: 1.2; text-align: left; min-width: 0; }
    .txt strong { font-weight: 600; font-size: 13px; }
    .txt small { color: var(--gris-5); font-size: 11.5px; font-weight: 400; }
    .flecha { color: var(--gris-5); transition: transform var(--transicion); }
    .flecha.girada { transform: rotate(180deg); }
    .desplegable { position: absolute; right: 0; top: calc(100% + 8px); width: 248px; background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: 14px;
      box-shadow: var(--sombra-menu); padding: 6px; animation: abrir .14s ease-out; z-index: var(--z-menu); }
    @keyframes abrir { from { transform: translateY(-4px); } to { transform: none; } }
    .cabeza { display: flex; gap: 11px; align-items: center; padding: 10px 10px 12px; border-bottom: 1px solid var(--gris-15); margin-bottom: 4px; }
    .cabeza .txt strong { font-size: 14px; }
    .cabeza .txt small:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
    .desplegable a, .desplegable button { display: flex; gap: 10px; align-items: center; width: 100%; padding: 9px 10px; border-radius: 9px; border: 0;
      background: none; color: var(--gris-7); font-weight: 500; text-decoration: none; min-height: 0; justify-content: flex-start; }
    .desplegable a:hover, .desplegable button:hover:not(:disabled) { background: var(--gris-1); color: var(--gris-8); }
    .desplegable app-icono { color: var(--gris-5); }
    .desplegable hr { border: 0; border-top: 1px solid var(--gris-15); margin: 4px 0; }
    .desplegable .cerrar, .desplegable .cerrar app-icono { color: var(--rojo); }
    .desplegable .cerrar:hover:not(:disabled) { background: var(--rojo-claro); color: var(--rojo); }

    main { padding: 28px; max-width: 1400px; width: 100%; margin: 0 auto; }
    .menu { display: none; }
    .velo { display: none; }

    @media (max-width: 960px) {
      .app, .app.fijo { grid-template-columns: 1fr; }
      aside { position: fixed; left: 0; top: 0; bottom: 0; width: 248px; transform: translateX(-100%); transition: transform .22s ease; }
      aside .etq { opacity: 1; pointer-events: auto; }
      .fijar { display: none; }
      .menu-abierto aside { transform: none; box-shadow: var(--sombra-2); }
      .menu-abierto .velo { display: block; position: fixed; inset: 0; background: var(--velo); z-index: calc(var(--z-menu) - 1); }
      .menu { display: inline-flex; }
      .disparador .txt { display: none; }
      header { padding: 10px 14px; }
      main { padding: 18px 14px; }
    }
  `],
})
export class Layout {
  private auth = inject(Auth);
  private clave = inject(RndcClave);
  readonly u = this.auth.usuario;
  readonly tema = inject(TemaService);
  readonly menuAbierto = signal(false);
  readonly menuUsuario = signal(false);
  // Preferencia de este navegador: menú lateral fijo o solo íconos
  readonly fijo = signal(leerFijo());

  // Al elegir una opción con el mouse se quita el foco del enlace, para que el
  // menú se contraiga en cuanto el cursor salga (salvo que esté fijado).
  alNavegar(e: MouseEvent) {
    this.menuAbierto.set(false);
    if (e.detail > 0) (e.currentTarget as HTMLElement).blur();
  }

  alternarFijo() {
    this.fijo.set(!this.fijo());
    try { localStorage.setItem('tls_menu_fijo', this.fijo() ? '1' : '0'); } catch { /* sin almacenamiento */ }
  }

  // Cierra el menú de usuario al hacer clic fuera o con Escape
  @HostListener('document:click', ['$event'])
  clicFuera(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (this.menuUsuario() && t?.isConnected && !t.closest('.usuario')) this.menuUsuario.set(false);
  }
  @HostListener('document:keydown.escape')
  escape() { this.menuUsuario.set(false); }
  readonly grupos = computed(() => {
    this.u();
    const visibles = MENU.filter(o => this.auth.tiene(...o.permisos));
    const nombres = [...new Set(visibles.map(o => o.grupo || ''))];
    return nombres.map(nombre => ({ nombre, opciones: visibles.filter(o => (o.grupo || '') === nombre) }));
  });

  private enVivoSrv = inject(EnVivo);
  constructor() {
    this.enVivoSrv.iniciar();
    inject(DestroyRef).onDestroy(() => this.enVivoSrv.detener());
    // Si debe cambiar la contraseña, no puede usar otras secciones
    const router = inject(Router);
    router.events.pipe(takeUntilDestroyed()).subscribe(ev => {
      if (ev instanceof NavigationEnd && this.u()?.debeCambiarClave && !ev.urlAfterRedirects.startsWith('/mi-cuenta')) {
        router.navigateByUrl('/mi-cuenta');
      }
    });
    this.auth.refrescar().catch(() => { /* el interceptor maneja 401 */ });
    this.vigilarInactividad();
  }

  // Cierra la sesión tras N minutos sin actividad (control de sesiones desatendidas).
  private vigilarInactividad() {
    const avisos = inject(Avisos);
    let ultima = Date.now();
    const actividad = () => { ultima = Date.now(); };
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    eventos.forEach(e => window.addEventListener(e, actividad, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - ultima > environment.inactividadMin * 60000) {
        avisos.mostrar(`Sesión cerrada por ${environment.inactividadMin} minutos de inactividad`, 'info', 10000);
        this.salir();
      }
    }, 30000);
    inject(DestroyRef).onDestroy(() => { clearInterval(id); eventos.forEach(e => window.removeEventListener(e, actividad)); });
  }

  iniciales(n: string) { return n.split(/\s+/).filter(w => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }

  ambiente(a: string) { return ({ SIMULADO: 'simulador', PRUEBAS: 'pruebas', PRODUCCION: 'producción' } as Record<string, string>)[a] || a; }

  salir() {
    this.menuUsuario.set(false);
    this.clave.olvidar();
    this.auth.salir();
  }
}
