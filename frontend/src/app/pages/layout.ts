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
// - Barra superior oscura con los MÓDULOS (Operación, Documentos, Finanzas…).
// - Subnavegación con las PÁGINAS del módulo activo: siempre se ve dónde está y qué más hay ahí.
// - Buscador de páginas (Ctrl + K) y menú completo en el celular.
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono],
  template: `
    <a class="saltar" href="#contenido">Saltar al contenido</a>

    <header class="global">
      <div class="fila">
        <button type="button" class="ico-btn solo-movil" (click)="menuMovil.set(true)" aria-label="Abrir menú"><app-icono nombre="menu" [tam]="20" /></button>
        <a routerLink="/inicio" class="marca" aria-label="Ir al inicio">
          <img class="logo" src="icono.png" alt="" width="40" height="17">
          <img class="nombre" src="nombre.webp" alt="Translogística del Sur" width="400" height="60">
        </a>

        <nav class="modulos" aria-label="Módulos">
          @for (m of modulos(); track m.id) {
            <a [routerLink]="m.paginas[0].ruta" [class.activo]="moduloActivo()?.id === m.id" [attr.aria-current]="moduloActivo()?.id === m.id ? 'page' : null">{{ m.nombre }}</a>
          }
        </nav>

        <button type="button" class="buscador" (click)="abrirBuscador()" aria-label="Buscar una página (Ctrl + K)">
          <app-icono nombre="buscar" [tam]="16" /><span class="txt-buscar">Ir a…</span><kbd>Ctrl K</kbd>
        </button>

        @if (u()?.empresa; as e) {
          <span class="ambiente" [class.prod]="e.ambienteRndc === 'PRODUCCION'" [title]="'Ambiente del RNDC: ' + ambiente(e.ambienteRndc)"><i></i><span>RNDC {{ ambiente(e.ambienteRndc) }}</span></span>
        }

        <div class="usuario">
          <button type="button" class="disparador" aria-label="Menú de usuario" (click)="menuUsuario.set(!menuUsuario())" [attr.aria-expanded]="menuUsuario()" aria-haspopup="menu">
            <span class="avatar">{{ iniciales(u()?.nombre || '') }}</span>
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
    </header>

    <!-- Páginas del módulo activo -->
    @if (moduloActivo(); as m) {
      @if (m.paginas.length > 1) {
        <nav class="subnav" [attr.aria-label]="'Páginas de ' + m.nombre">
          <div class="fila">
            <span class="mod">{{ m.nombre }}</span>
            <div class="paginas">
              @for (p of m.paginas; track p.ruta) {
                <a [routerLink]="p.ruta" routerLinkActive="activa" [title]="p.descripcion"><app-icono [nombre]="p.icono" [tam]="16" />{{ p.texto }}</a>
              }
            </div>
          </div>
        </nav>
      }
    }

    <main id="contenido"><router-outlet /></main>

    <!-- Menú completo (celular) -->
    @if (menuMovil()) {
      <div class="velo" (click)="menuMovil.set(false)"></div>
      <aside class="hoja" aria-label="Menú">
        <div class="hoja-cab">
          <img src="nombre.webp" alt="Translogística del Sur" width="160" height="24">
          <button type="button" class="ico-btn" (click)="menuMovil.set(false)" aria-label="Cerrar menú"><app-icono nombre="x" [tam]="20" /></button>
        </div>
        <div class="hoja-cuerpo">
          @for (m of modulos(); track m.id) {
            <section>
              <h3>{{ m.nombre }}</h3>
              @for (p of m.paginas; track p.ruta) {
                <a [routerLink]="p.ruta" routerLinkActive="activa" (click)="menuMovil.set(false)">
                  <app-icono [nombre]="p.icono" [tam]="18" /><span><strong>{{ p.texto }}</strong><small>{{ p.descripcion }}</small></span></a>
              }
            </section>
          }
        </div>
      </aside>
    }

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
    .fila { max-width: var(--ancho-pagina); margin: 0 auto; padding: 0 28px; display: flex; align-items: center; gap: 14px; }

    /* ── Barra superior ── */
    .global { position: sticky; top: 0; z-index: var(--z-cabecera); background: var(--tinta); color: var(--tinta-texto);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .global .fila { height: 60px; }
    .marca { display: flex; align-items: center; flex: none; margin-right: 10px; }
    .marca .logo { display: none; width: 40px; height: auto; }
    .marca .nombre { width: 150px; height: auto; display: block; }
    .modulos { display: flex; gap: 2px; height: 100%; align-items: stretch; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }
    .modulos::-webkit-scrollbar { display: none; }
    .modulos a { position: relative; display: flex; align-items: center; padding: 0 13px; color: var(--tinta-tenue); text-decoration: none;
      font-weight: 600; font-size: 14px; white-space: nowrap; transition: color var(--transicion); }
    .modulos a:hover { color: #fff; }
    .modulos a.activo { color: #fff; }
    .modulos a.activo::after { content: ''; position: absolute; left: 13px; right: 13px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--primario); }
    .modulos a:focus-visible { box-shadow: inset 0 0 0 2px var(--primario); border-radius: 8px; }

    .buscador { min-height: 36px; height: 36px; padding: 0 8px 0 12px; gap: 8px; background: var(--tinta-2); border: 1px solid var(--tinta-3);
      color: var(--tinta-tenue); font-weight: 500; box-shadow: none; border-radius: 10px; flex: none; }
    .buscador:hover:not(:disabled) { background: var(--tinta-3); border-color: #343c4a; color: #fff; }
    kbd { font: 600 11px var(--fuente); padding: 2px 6px; border-radius: 5px; border: 1px solid currentColor; opacity: .7; white-space: nowrap; }
    .ambiente { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--tinta-tenue); white-space: nowrap; flex: none; }
    .ambiente i { width: 8px; height: 8px; border-radius: 50%; background: #ffa04d; box-shadow: 0 0 0 3px rgba(255,160,77,.18); }
    .ambiente.prod i { background: #4fd18b; box-shadow: 0 0 0 3px rgba(79,209,139,.18); }
    .ico-btn { min-height: 0; width: 38px; height: 38px; padding: 0; border-radius: 10px; border: 0; background: transparent; color: inherit; box-shadow: none; }
    .ico-btn:hover:not(:disabled) { background: var(--tinta-3); }
    .solo-movil { display: none; }

    /* Usuario */
    .usuario { position: relative; flex: none; }
    .disparador { display: flex; gap: 6px; align-items: center; min-height: 0; padding: 3px 8px 3px 3px; border-radius: 999px; border: 1px solid var(--tinta-3);
      background: var(--tinta-2); color: var(--tinta-tenue); box-shadow: none; }
    .disparador:hover:not(:disabled) { background: var(--tinta-3); border-color: #343c4a; }
    .avatar { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--primario); color: var(--sobre-primario);
      font-weight: 750; font-size: 12px; }
    .avatar.grande { width: 42px; height: 42px; font-size: 14px; border-radius: 12px; }
    .flecha { transition: transform var(--transicion); }
    .flecha.girada { transform: rotate(180deg); }
    .desplegable { position: absolute; right: 0; top: calc(100% + 10px); width: 270px; background: var(--gris-0); color: var(--gris-8); border: 1px solid var(--gris-2);
      border-radius: 14px; box-shadow: var(--sombra-menu); padding: 6px; animation: abrir .14s ease-out; z-index: var(--z-menu); }
    @keyframes abrir { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
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

    /* ── Subnavegación ── */
    .subnav { position: sticky; top: 60px; z-index: calc(var(--z-cabecera) - 1); background: var(--cabecera); backdrop-filter: saturate(1.4) blur(10px);
      border-bottom: 1px solid var(--gris-2); }
    .subnav .fila { height: 50px; }
    .mod { font-size: 12px; font-weight: 700; color: var(--gris-4); letter-spacing: .02em; padding-right: 14px; margin-right: 2px; border-right: 1px solid var(--gris-2); flex: none; }
    .paginas { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; min-width: 0; }
    .paginas::-webkit-scrollbar { display: none; }
    .paginas a { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 8px; color: var(--gris-5); text-decoration: none;
      font-weight: 600; font-size: 13.5px; white-space: nowrap; transition: background var(--transicion), color var(--transicion); }
    .paginas a:hover { background: var(--gris-15); color: var(--gris-8); }
    .paginas a.activa { background: var(--gris-8); color: var(--gris-0); }
    .paginas a.activa app-icono { color: var(--primario); }

    main { padding: 28px 28px 56px; max-width: var(--ancho-pagina); width: 100%; margin: 0 auto; animation: entrar .22s ease-out; }
    @keyframes entrar { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

    /* ── Menú del celular ── */
    .velo { position: fixed; inset: 0; background: var(--velo); z-index: var(--z-modal); animation: fundir .15s ease-out; }
    @keyframes fundir { from { opacity: 0; } to { opacity: 1; } }
    .hoja { position: fixed; top: 0; left: 0; bottom: 0; width: min(360px, 88vw); z-index: calc(var(--z-modal) + 1); background: var(--gris-0);
      display: flex; flex-direction: column; box-shadow: var(--sombra-menu); animation: deslizar .2s ease-out; }
    @keyframes deslizar { from { transform: translateX(-100%); } to { transform: none; } }
    .hoja-cab { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 12px 18px; background: var(--tinta); color: #fff; }
    .hoja-cuerpo { overflow-y: auto; padding: 8px 10px 24px; }
    .hoja h3 { margin: 16px 10px 6px; font-size: 12px; color: var(--gris-4); letter-spacing: .03em; }
    .hoja a { display: flex; gap: 12px; align-items: flex-start; padding: 10px; border-radius: 10px; color: var(--gris-7); text-decoration: none; }
    .hoja a span { display: flex; flex-direction: column; line-height: 1.3; }
    .hoja a strong { font-size: 14.5px; } .hoja a small { color: var(--gris-5); font-size: 12px; }
    .hoja a app-icono { margin-top: 2px; color: var(--gris-5); }
    .hoja a:hover { background: var(--gris-1); }
    .hoja a.activa { background: var(--primario-claro); } .hoja a.activa app-icono { color: var(--primario-texto); }

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

    @media (max-width: 1180px) {
      .ambiente span { display: none; }
      .txt-buscar, .buscador kbd { display: none; }
      .buscador { width: 38px; padding: 0; justify-content: center; }
    }
    @media (max-width: 960px) {
      .fila { padding: 0 14px; gap: 8px; }
      .solo-movil { display: inline-flex; }
      .modulos { display: none; }
      .marca { margin-right: auto; }
      .marca .nombre { width: 132px; }
      .subnav { top: 60px; } .subnav .fila { height: 46px; }
      .mod { display: none; }
      main { padding: 18px 14px 40px; }
    }
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
