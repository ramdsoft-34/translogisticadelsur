import { Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { environment } from '../../environments/environment';
import { Avisos } from '../core/avisos.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { Auth } from '../core/auth.service';
import { RndcClave } from '../core/rndc-clave.service';
import { Icono } from '../shared/icono';
import { TemaService } from '../core/tema.service';
import { MODULOS, OTRAS, Pagina } from '../core/navegacion';

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Contenedor de la aplicación:
// - Menú lateral oscuro con los MÓDULOS (Operación, Documentos, Finanzas…) y sus PÁGINAS; abajo, el usuario.
// - En el celular el menú lateral se abre desde una barra con el botón de menú.
// - Buscador de páginas (Ctrl + K).
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono],
  template: `
    <a class="saltar" href="#contenido">Saltar al contenido</a>

    <!-- Barra superior solo en el celular: abre el menú lateral -->
    <header class="barra-movil">
      <button type="button" class="ico-btn" (click)="menuMovil.set(true)" aria-label="Abrir menú"><app-icono nombre="menu" [tam]="20" /></button>
      <a routerLink="/inicio" class="marca" aria-label="Ir al inicio"><img class="nombre" src="nombre.webp" alt="Translogística del Sur" width="400" height="60"></a>
      <button type="button" class="ico-btn" (click)="abrirBuscador()" aria-label="Buscar una página"><app-icono nombre="buscar" [tam]="18" /></button>
    </header>
    @if (menuMovil()) { <div class="velo velo-lateral" (click)="menuMovil.set(false)"></div> }

    <!-- Menú lateral: módulos y sus páginas -->
    <aside class="lateral" [class.abierto]="menuMovil()" aria-label="Menú principal">
      <div class="lat-cab">
        <a routerLink="/inicio" class="marca" aria-label="Ir al inicio"><img class="nombre" src="nombre.webp" alt="Translogística del Sur" width="400" height="60"></a>
        <button type="button" class="ico-btn solo-movil" (click)="menuMovil.set(false)" aria-label="Cerrar menú"><app-icono nombre="x" [tam]="20" /></button>
      </div>
      <button type="button" class="buscador" (click)="abrirBuscador()" aria-label="Buscar una página (Ctrl + K)">
        <app-icono nombre="buscar" [tam]="16" /><span class="txt-buscar">Ir a…</span><kbd>Ctrl K</kbd>
      </button>
      <nav class="lat-nav" aria-label="Módulos">
        @for (m of modulos(); track m.id) {
          <section [class.actual]="moduloActivo()?.id === m.id">
            <h3>{{ m.nombre }}</h3>
            @for (p of m.paginas; track p.ruta) {
              <a [routerLink]="p.ruta" routerLinkActive="activa" [title]="p.descripcion"><app-icono [nombre]="p.icono" [tam]="17" /><span>{{ p.texto }}</span></a>
            }
          </section>
        }
      </nav>
      <div class="lat-pie">
        @if (u()?.empresa; as e) {
          <span class="ambiente" [class.prod]="e.ambienteRndc === 'PRODUCCION'" [title]="'Ambiente del RNDC: ' + ambiente(e.ambienteRndc)"><i></i><span>RNDC {{ ambiente(e.ambienteRndc) }}</span></span>
        }
        <div class="usuario">
          <button type="button" class="disparador" aria-label="Menú de usuario" (click)="menuUsuario.set(!menuUsuario())" [attr.aria-expanded]="menuUsuario()" aria-haspopup="menu">
            <span class="avatar">{{ iniciales(u()?.nombre || '') }}</span>
            <span class="quien"><strong>{{ u()?.nombre }}</strong><small>{{ u()?.empresa?.nombre || u()?.rolNombre }}</small></span>
            <app-icono nombre="chevron" [tam]="14" class="flecha" [class.girada]="menuUsuario()" />
          </button>
          @if (menuUsuario()) {
            <div class="desplegable" role="menu">
              <div class="cabeza">
                <span class="avatar grande">{{ iniciales(u()?.nombre || '') }}</span>
                <span class="txt"><strong>{{ u()?.nombre }}</strong><small>{{ u()?.rolNombre }}</small><small>{{ u()?.email }}</small></span>
              </div>
              @if (u()?.empresa; as e) { <div class="empresa-u"><app-icono nombre="edificio" [tam]="15" />{{ e.nombre }}</div> }
              <a role="menuitem" routerLink="/mi-cuenta" (click)="menuUsuario.set(false)"><app-icono nombre="usuario" [tam]="17" />Mi perfil y seguridad</a>
              <button type="button" role="menuitem" (click)="tema.alternar()"><app-icono [nombre]="tema.tema() === 'oscuro' ? 'sol' : 'luna'" [tam]="17" />{{ tema.tema() === 'oscuro' ? 'Tema claro' : 'Tema oscuro' }}</button>
              <a role="menuitem" routerLink="/privacidad" (click)="menuUsuario.set(false)"><app-icono nombre="escudo" [tam]="17" />Política y privacidad</a>
              <hr />
              <button type="button" role="menuitem" class="cerrar" (click)="salir()"><app-icono nombre="salir" [tam]="17" />Cerrar sesión</button>
            </div>
          }
        </div>
      </div>
    </aside>

    <main id="contenido"><router-outlet /></main>

    <!-- Buscador de páginas (Ctrl + K) -->
    @if (buscador()) {
      <div class="velo velo-buscador" (click)="buscador.set(false)"></div>
      <div class="paleta" role="dialog" aria-modal="true" aria-label="Ir a una página">
        <div class="paleta-entrada">
          <app-icono nombre="buscar" [tam]="18" />
          <input #entrada type="text" placeholder="¿A dónde quiere ir? Ej.: manifiestos, placas, préstamos…" [value]="consulta()"
            (input)="consulta.set($any($event.target).value); indice.set(0)" (keydown)="teclaBuscador($event)" aria-label="Buscar página" autocomplete="off" />
          <kbd>Esc</kbd>
        </div>
        <ul class="resultados" role="listbox">
          @for (r of resultados(); track r.ruta; let i = $index) {
            <li role="option" [attr.aria-selected]="i === indice()" [class.sel]="i === indice()" (mouseenter)="indice.set(i)" (click)="ir(r.ruta)">
              <span class="ico"><app-icono [nombre]="r.icono" [tam]="17" /></span>
              <span class="txt"><strong>{{ r.texto }}</strong><small>{{ r.modulo }} · {{ r.descripcion }}</small></span>
              <app-icono nombre="chevron" [tam]="14" class="ir" />
            </li>
          } @empty { <li class="nada">No hay páginas que coincidan con «{{ consulta() }}».</li> }
        </ul>
        <div class="paleta-pie"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span></div>
      </div>
    }`,
  styles: [`
    :host { display: block; min-height: 100dvh; }
    .saltar { position: absolute; left: -999px; top: 8px; z-index: 100; background: var(--tinta); color: #fff; padding: 8px 12px; border-radius: 8px; }
    .saltar:focus { left: 8px; }
    /* ── Menú lateral ── */
    :host { --ancho-lateral: 252px; --alto-barra: 0px; }
    .lateral { position: fixed; top: 0; left: 0; bottom: 0; width: var(--ancho-lateral); z-index: var(--z-cabecera); display: flex; flex-direction: column;
      background: var(--tinta); color: var(--tinta-texto); border-right: 1px solid rgba(255,255,255,.06); }
    .lat-cab { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px 14px 20px; }
    .marca { display: flex; align-items: center; flex: none; }
    .marca .nombre { width: 150px; height: auto; display: block; }
    .buscador { margin: 0 14px 10px; min-height: 38px; height: 38px; padding: 0 8px 0 12px; gap: 8px; justify-content: flex-start; background: var(--tinta-2);
      border: 1px solid var(--tinta-3); color: var(--tinta-tenue); font-weight: 500; box-shadow: none; border-radius: 10px; }
    .buscador:hover:not(:disabled) { background: var(--tinta-3); border-color: #343c4a; color: #fff; }
    .txt-buscar { flex: 1; text-align: left; }
    kbd { font: 600 11px var(--fuente); padding: 2px 6px; border-radius: 5px; border: 1px solid currentColor; opacity: .7; white-space: nowrap; }
    .lat-nav { flex: 1; overflow-y: auto; padding: 4px 12px 16px; scrollbar-width: thin; scrollbar-color: var(--tinta-3) transparent; }
    .lat-nav section { margin-top: 12px; }
    .lat-nav h3 { margin: 0 0 4px; padding: 0 10px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6f7a8a; }
    .lat-nav section.actual h3 { color: var(--primario); }
    .lat-nav a { display: flex; align-items: center; gap: 11px; padding: 8px 10px; margin: 1px 0; border-radius: 9px; color: var(--tinta-tenue); text-decoration: none;
      font-weight: 600; font-size: 14px; transition: background var(--transicion), color var(--transicion); }
    .lat-nav a:hover { background: var(--tinta-2); color: #fff; }
    .lat-nav a.activa { background: var(--primario); color: var(--sobre-primario); }
    .lat-nav a:focus-visible { box-shadow: inset 0 0 0 2px var(--primario); }
    .lat-pie { border-top: 1px solid rgba(255,255,255,.07); padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .ambiente { display: inline-flex; align-items: center; gap: 7px; padding: 0 8px; font-size: 12px; color: var(--tinta-tenue); white-space: nowrap; }
    .ambiente i { width: 8px; height: 8px; border-radius: 50%; background: #ffa04d; box-shadow: 0 0 0 3px rgba(255,160,77,.18); }
    .ambiente.prod i { background: #4fd18b; box-shadow: 0 0 0 3px rgba(79,209,139,.18); }
    .ico-btn { min-height: 0; width: 38px; height: 38px; padding: 0; border-radius: 10px; border: 0; background: transparent; color: inherit; box-shadow: none; }
    .ico-btn:hover:not(:disabled) { background: var(--tinta-3); }
    .solo-movil { display: none; }
    .barra-movil { display: none; }

    /* Usuario (al pie del menú) */
    .usuario { position: relative; }
    .disparador { display: flex; gap: 10px; align-items: center; width: 100%; min-height: 0; padding: 6px 10px 6px 6px; border-radius: 12px; border: 1px solid var(--tinta-3);
      background: var(--tinta-2); color: var(--tinta-tenue); box-shadow: none; justify-content: flex-start; }
    .disparador:hover:not(:disabled) { background: var(--tinta-3); border-color: #343c4a; }
    .quien { display: flex; flex-direction: column; min-width: 0; flex: 1; text-align: left; line-height: 1.25; }
    .quien strong { color: #fff; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .quien small { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .avatar { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--primario); color: var(--sobre-primario);
      font-weight: 750; font-size: 12px; }
    .avatar.grande { width: 42px; height: 42px; font-size: 14px; border-radius: 12px; }
    .flecha { transition: transform var(--transicion); transform: rotate(180deg); }
    .flecha.girada { transform: none; }
    .desplegable { position: absolute; left: 0; bottom: calc(100% + 10px); width: 270px; background: var(--gris-0); color: var(--gris-8); border: 1px solid var(--gris-2);
      border-radius: 14px; box-shadow: var(--sombra-menu); padding: 6px; animation: abrir .14s ease-out; z-index: var(--z-menu); }
    @keyframes abrir { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .cabeza { display: flex; gap: 11px; align-items: center; padding: 10px 10px 12px; }
    .txt { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
    .txt strong { font-weight: 700; font-size: 14px; }
    .txt small { color: var(--gris-5); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .empresa-u { display: flex; align-items: center; gap: 8px; margin: 0 4px 6px; padding: 8px 10px; border-radius: 9px; background: var(--gris-1);
      font-size: 12.5px; font-weight: 600; color: var(--gris-6); }
    .desplegable a, .desplegable button { display: flex; gap: 10px; align-items: center; width: 100%; padding: 9px 10px; border-radius: 9px; border: 0;
      background: none; color: var(--gris-7); font-weight: 550; font-size: 14px; text-decoration: none; min-height: 0; justify-content: flex-start; box-shadow: none; }
    .desplegable a:hover, .desplegable button:hover:not(:disabled) { background: var(--gris-1); color: var(--gris-8); }
    .desplegable app-icono { color: var(--gris-5); }
    .desplegable hr { border: 0; border-top: 1px solid var(--gris-15); margin: 4px 0; }
    .desplegable .cerrar, .desplegable .cerrar app-icono { color: var(--rojo); }
    .desplegable .cerrar:hover:not(:disabled) { background: var(--rojo-claro); }

    main { margin-left: var(--ancho-lateral); padding: 28px 32px 56px; animation: entrar .22s ease-out; }
    main > :not(router-outlet) { display: block; max-width: var(--ancho-pagina); margin-left: auto; margin-right: auto; }
    @keyframes entrar { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

    .velo { position: fixed; inset: 0; background: var(--velo); z-index: var(--z-modal); animation: fundir .15s ease-out; }
    .velo-lateral { z-index: calc(var(--z-cabecera) + 1); }
    @keyframes fundir { from { opacity: 0; } to { opacity: 1; } }

    /* ── Buscador (Ctrl + K) ── */
    .velo-buscador { backdrop-filter: blur(3px); }
    .paleta { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%); width: min(620px, calc(100vw - 24px)); z-index: calc(var(--z-modal) + 1);
      background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: 16px; box-shadow: var(--sombra-menu); overflow: hidden; animation: abrir .14s ease-out; }
    .paleta-entrada { display: flex; align-items: center; gap: 12px; padding: 4px 16px; border-bottom: 1px solid var(--gris-15); color: var(--gris-5); }
    .paleta-entrada input { border: 0; box-shadow: none; min-height: 54px; padding: 0; font-size: 16px; background: transparent; }
    .paleta-entrada input:focus { box-shadow: none; }
    .resultados { list-style: none; margin: 0; padding: 6px; max-height: 52vh; overflow-y: auto; }
    .resultados li { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 10px; cursor: pointer; }
    .resultados li.sel { background: var(--gris-15); }
    .resultados .ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--gris-1); color: var(--gris-6); flex: none; }
    .resultados li.sel .ico { background: var(--primario); color: var(--sobre-primario); }
    .resultados .txt { flex: 1; }
    .resultados .ir { transform: rotate(-90deg); color: var(--gris-4); }
    .resultados .nada { padding: 22px; color: var(--gris-5); cursor: default; }
    .paleta-pie { display: flex; gap: 16px; padding: 9px 16px; border-top: 1px solid var(--gris-15); font-size: 12px; color: var(--gris-5); background: var(--gris-1); }
    .paleta-pie kbd { margin-right: 3px; }

    @media (max-width: 960px) {
      :host { --alto-barra: 56px; }
      .barra-movil { position: sticky; top: 0; z-index: var(--z-cabecera); display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 10px;
        background: var(--tinta); color: var(--tinta-texto); }
      .barra-movil .marca { margin-right: auto; } .barra-movil .marca .nombre { width: 132px; }
      .lateral { z-index: calc(var(--z-cabecera) + 2); width: min(300px, 86vw); transform: translateX(-100%); transition: transform .22s ease-out; box-shadow: var(--sombra-menu); }
      .lateral.abierto { transform: none; }
      .solo-movil { display: inline-flex; }
      main { margin-left: 0; padding: 18px 14px 40px; }
    }
    @media (prefers-reduced-motion: reduce) { .lateral { transition: none; } }
  `],
})
export class Layout {
  private auth = inject(Auth);
  private clave = inject(RndcClave);
  private router = inject(Router);
  readonly u = this.auth.usuario;
  readonly tema = inject(TemaService);
  readonly menuUsuario = signal(false);
  readonly menuMovil = signal(false);
  readonly buscador = signal(false);
  readonly consulta = signal('');
  readonly indice = signal(0);
  private entrada = viewChild<ElementRef<HTMLInputElement>>('entrada');
  private readonly url = signal(this.router.url);

  // Módulos y páginas que el rol puede ver
  readonly modulos = computed(() => {
    this.u();
    return MODULOS.map(m => ({ ...m, paginas: m.paginas.filter(p => this.auth.tiene(...p.permisos)) })).filter(m => m.paginas.length);
  });
  readonly moduloActivo = computed(() => {
    const ruta = this.url().split(/[?#]/)[0];
    const porPagina = this.modulos().find(m => m.paginas.some(p => ruta === p.ruta || ruta.startsWith(p.ruta + '/')));
    if (porPagina) return porPagina;
    const id = OTRAS[ruta];
    return id ? this.modulos().find(m => m.id === id) || null : null;
  });
  readonly resultados = computed(() => {
    const q = sinTildes(this.consulta().trim());
    const todas: (Pagina & { modulo: string })[] = this.modulos().flatMap(m => m.paginas.map(p => ({ ...p, modulo: m.nombre })));
    if (!q) return todas;
    const palabras = q.split(/\s+/);
    return todas.filter(p => { const t = sinTildes(`${p.texto} ${p.modulo} ${p.descripcion} ${p.claves || ''}`); return palabras.every(w => t.includes(w)); });
  });

  abrirBuscador() { this.consulta.set(''); this.indice.set(0); this.buscador.set(true); setTimeout(() => this.entrada()?.nativeElement.focus()); }
  ir(ruta: string) { this.buscador.set(false); this.router.navigateByUrl(ruta); }
  teclaBuscador(e: KeyboardEvent) {
    const n = this.resultados().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.indice.set(Math.min(this.indice() + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.indice.set(Math.max(this.indice() - 1, 0)); }
    else if (e.key === 'Enter' && n) { e.preventDefault(); this.ir(this.resultados()[this.indice()].ruta); }
  }

  @HostListener('document:keydown', ['$event'])
  atajos(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.buscador() ? this.buscador.set(false) : this.abrirBuscador(); }
    if (e.key === 'Escape') { this.menuUsuario.set(false); this.buscador.set(false); this.menuMovil.set(false); }
  }
  // Cierra el menú de usuario al hacer clic fuera
  @HostListener('document:click', ['$event'])
  clicFuera(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (this.menuUsuario() && t?.isConnected && !t.closest('.usuario')) this.menuUsuario.set(false);
  }

  private enVivoSrv = inject(EnVivo);
  constructor() {
    this.enVivoSrv.iniciar();
    inject(DestroyRef).onDestroy(() => this.enVivoSrv.detener());
    this.router.events.pipe(takeUntilDestroyed()).subscribe(ev => {
      if (!(ev instanceof NavigationEnd)) return;
      this.url.set(ev.urlAfterRedirects);
      this.menuMovil.set(false);
      // Si debe cambiar la contraseña, no puede usar otras secciones
      if (this.u()?.debeCambiarClave && !ev.urlAfterRedirects.startsWith('/mi-cuenta')) this.router.navigateByUrl('/mi-cuenta');
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
