import { AfterViewInit, Component, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

// Página pública de Translogística del Sur. La información de la empresa sale del documento de constitución;
// las vistas de la plataforma son ilustrativas (datos de ejemplo).
// «Ingresar» lleva al login; «Ver demo» lleva, por ahora, a las funciones de la plataforma.
@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  template: `
    <a class="saltar" href="#principal">Saltar al contenido</a>

    <!-- ── Encabezado ── -->
    <header class="cab" [class.sombra]="desplazado()">
      <div class="contenedor fila-cab">
        <a class="marca" href="#inicio" aria-label="Translogística del Sur, inicio">
          <img src="icono.png" alt="" width="160" height="66" />
          <span>Translogística <b>del Sur</b></span>
        </a>
        <nav class="menu" [class.abierto]="menu()" aria-label="Secciones">
          <a href="#funciones" (click)="menu.set(false)">Plataforma</a>
          <a href="#flujo" (click)="menu.set(false)">Cómo funciona</a>
          <a href="#servicios" (click)="menu.set(false)">Servicios</a>
          <a href="#empresa" (click)="menu.set(false)">Empresa</a>
          <a class="solo-movil btn btn-blanco" href="#funciones" (click)="menu.set(false)">Ver demo</a>
        </nav>
        <div class="acciones-cab">
          <a class="btn btn-blanco ocultar-movil" href="#funciones">Ver demo</a>
          <a class="btn btn-tinta" routerLink="/ingresar">Ingresar</a>
          <button type="button" class="hamburguesa" (click)="menu.set(!menu())" [attr.aria-expanded]="menu()" aria-label="Abrir menú">
            <span></span><span></span>
          </button>
        </div>
      </div>
    </header>

    <main id="principal">
      <!-- ── Portada ── -->
      <section class="portada" id="inicio">
        <div class="contenedor portada-txt">
          <h1>La operación de carga, <span class="resalte">en una sola plataforma.</span></h1>
          <p class="bajada">Viajes, remesas y manifiestos, seguimiento GPS, pago a conductores y contabilidad.
            Desarrollada en Pasto por Translogística del Sur.</p>
          <div class="cta">
            <a class="btn btn-tinta grande" routerLink="/ingresar">Ingresar a la plataforma <span aria-hidden="true">→</span></a>
            <a class="btn btn-blanco grande" href="#funciones">Ver demo</a>
          </div>
          <p class="pronto">La demostración guiada estará disponible muy pronto.</p>
        </div>

        <!-- Vista ilustrativa de la plataforma -->
        <div class="contenedor">
          <figure class="pantalla" aria-label="Vista ilustrativa de la plataforma con datos de ejemplo">
            <div class="navegador"><i></i><i></i><i></i><span>translogisticadelsur.com/viajes</span></div>
            <div class="app">
              <div class="app-barra">
                <img src="nombre.webp" alt="" width="400" height="60" />
                <nav aria-hidden="true">@for (m of modulosApp; track m; let i = $index) { <span [class.activo]="i === 1">{{ m }}</span> }</nav>
                <span class="avatar">CO</span>
              </div>
              <div class="app-cuerpo">
                <div class="app-cab">
                  <div><b>Viajes</b><small>Octubre · datos de ejemplo</small></div>
                  <span class="app-boton">+ Nuevo viaje</span>
                </div>
                <div class="kpis">
                  @for (k of kpis; track k.t) {
                    <div class="kpi"><small>{{ k.t }}</small><b>{{ k.v }}</b><span [class]="'tendencia ' + k.c">{{ k.d }}</span></div>
                  }
                </div>
                <div class="tabla" role="presentation">
                  <div class="fila cabeza"><span>Viaje</span><span>Placa</span><span>Ruta</span><span class="ocultar-sm">Conductor</span><span>Estado</span></div>
                  @for (v of viajesDemo; track v.n) {
                    <div class="fila"><span class="mono">{{ v.n }}</span><span><em class="placa">{{ v.p }}</em></span><span>{{ v.r }}</span>
                      <span class="ocultar-sm">{{ v.c }}</span><span><em [class]="'estado ' + v.e">{{ v.t }}</em></span></div>
                  }
                </div>
              </div>
            </div>
            <div class="flotante f1" aria-hidden="true"><span class="ok">✓</span><div><b>Manifiesto aceptado</b><small>RNDC · radicado recibido</small></div></div>
            <div class="flotante f2" aria-hidden="true"><span class="gps"></span><div><b>En ruta</b><small>Última posición hace 2 min</small></div></div>
            <figcaption>Vista ilustrativa · datos de ejemplo</figcaption>
          </figure>
        </div>
      </section>

      <!-- ── Franja de capacidades ── -->
      <section class="franja" aria-label="Capacidades">
        <div class="contenedor franja-fila">
          @for (c of capacidades; track c.t) {
            <div class="capacidad"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos[c.i]" /></svg><span>{{ c.t }}</span></div>
          }
        </div>
      </section>

      <!-- ── Funciones ── -->
      <section class="seccion" id="funciones">
        <div class="contenedor">
          <div class="titulo-seccion revelar">
            <p class="etiqueta">Plataforma</p>
            <h2>Todo el despacho, sin hojas sueltas.</h2>
            <p>Cada módulo comparte la misma información: lo que se registra una vez llega al RNDC, al seguimiento, a la liquidación y a la contabilidad.</p>
          </div>

          <div class="bento">
            <!-- RNDC -->
            <article class="celda ancha revelar">
              <div class="celda-txt">
                <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['documento']" /></svg></span>
                <h3>Remesas y manifiestos ante el RNDC</h3>
                <p>Expedición, cumplido, anulación y reemplazo con verificación previa de los datos y el historial de cada envío.</p>
              </div>
              <div class="mini mini-rndc" aria-hidden="true">
                @for (p of pasosRndc; track p.t) {
                  <div [class]="'paso-rndc ' + p.e"><span class="marca-paso">{{ p.e === 'hecho' ? '✓' : '' }}</span><div><b>{{ p.t }}</b><small>{{ p.d }}</small></div></div>
                }
                <span class="app-boton ancho">Enviar al RNDC</span>
              </div>
            </article>

            <!-- GPS -->
            <article class="celda revelar">
              <div class="mini mini-mapa" aria-hidden="true">
                <svg viewBox="0 0 300 150"><path class="recorrido" d="M20 120 C 70 110 90 60 140 70 S 220 40 270 30" /><circle cx="20" cy="120" r="5" class="punto-ini" /><circle cx="200" cy="52" r="7" class="punto-act" /></svg>
              </div>
              <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['pin']" /></svg></span>
              <h3>Seguimiento GPS</h3>
              <p>Posición del vehículo en ruta y entregas registradas con lugar y evidencia.</p>
            </article>

            <!-- Pagos -->
            <article class="celda revelar">
              <div class="mini mini-liq" aria-hidden="true">
                @for (l of liquidacion; track l.t) { <div [class.total]="l.total"><span>{{ l.t }}</span><b>{{ l.v }}</b></div> }
              </div>
              <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['billetera']" /></svg></span>
              <h3>Pago a conductores</h3>
              <p>Liquidación con retenciones, anticipos y préstamos, lista para pagar.</p>
            </article>

            <!-- Contabilidad -->
            <article class="celda revelar">
              <div class="mini mini-barras" aria-hidden="true">
                @for (b of barrasDemo; track $index) { <i [style.height.%]="b"></i> }
              </div>
              <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['grafica']" /></svg></span>
              <h3>Contabilidad e informes</h3>
              <p>Libro diario, cuentas por cobrar y por pagar, y cierre de mes.</p>
            </article>

            <!-- QR -->
            <article class="celda revelar">
              <div class="mini mini-qr" aria-hidden="true">
                <div class="hoja"><i></i><i></i><i class="corta"></i></div>
                <div class="qr">@for (q of qr; track $index) { <i [class.lleno]="q"></i> }</div>
              </div>
              <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['qr']" /></svg></span>
              <h3>Soportes verificables</h3>
              <p>Documentos en PDF y Excel; el soporte interno trae un código QR que cualquiera puede verificar.</p>
            </article>

            <!-- Multiempresa -->
            <article class="celda ancha revelar">
              <div class="celda-txt">
                <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['usuarios']" /></svg></span>
                <h3>Varias empresas, cada una con lo suyo</h3>
                <p>Cada empresa trabaja con sus propios usuarios, permisos y datos separados, y ve en vivo lo que hace su equipo.</p>
              </div>
              <div class="mini mini-roles" aria-hidden="true">
                @for (r of roles; track r.n) {
                  <div class="rol"><span class="avatar chico">{{ r.n }}</span><div><b>{{ r.t }}</b><small>{{ r.d }}</small></div><em>{{ r.p }}</em></div>
                }
              </div>
            </article>
          </div>
        </div>
      </section>

      <!-- ── Flujo ── -->
      <section class="seccion gris" id="flujo">
        <div class="contenedor">
          <div class="titulo-seccion revelar">
            <p class="etiqueta">Cómo funciona</p>
            <h2>Del registro al cierre, paso a paso.</h2>
          </div>
          <!-- Línea de tiempo del despacho -->
          <div class="linea-tiempo revelar">
            <div class="riel" aria-hidden="true"><i [style.width.%]="paso() / (paradas.length - 1) * 100"></i></div>
            <div class="nodos" role="tablist" aria-label="Pasos del despacho">
              @for (p of paradas; track p.t; let i = $index) {
                <button type="button" role="tab" class="nodo" [class.activo]="paso() === i" [class.hecho]="i < paso()"
                  [attr.aria-selected]="paso() === i" aria-controls="panel-paso" (click)="elegir(i)">
                  <span class="bola">{{ i < paso() ? '✓' : '0' + (i + 1) }}</span><span class="nom">{{ p.t }}</span>
                </button>
              }
            </div>
          </div>

          <div class="panel-paso revelar" id="panel-paso" role="tabpanel" (mouseenter)="pausado = true" (mouseleave)="pausado = false">
            <span class="cifra" aria-hidden="true">0{{ paso() + 1 }}</span>
            <div class="panel-txt">
              <p class="paso-de">Paso {{ paso() + 1 }} de {{ paradas.length }}</p>
              <h3>{{ paradas[paso()].t }}</h3>
              <p>{{ paradas[paso()].d }}</p>
            </div>
            <ul class="lista-paso">
              @for (x of paradas[paso()].items; track x) { <li><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['check']" /></svg>{{ x }}</li> }
            </ul>
            <div class="panel-nav">
              <button type="button" (click)="elegir(paso() - 1)" [disabled]="paso() === 0" aria-label="Paso anterior">←</button>
              <button type="button" (click)="elegir(paso() + 1)" [disabled]="paso() === paradas.length - 1" aria-label="Paso siguiente">→</button>
            </div>
            @if (auto()) { @for (k of [paso()]; track k) { <span class="temporizador" aria-hidden="true"></span> } }
          </div>
        </div>
      </section>

      <!-- ── Servicios de la empresa ── -->
      <section class="seccion" id="servicios">
        <div class="contenedor">
          <div class="titulo-seccion revelar">
            <p class="etiqueta">Servicios</p>
            <h2>Más que software: gestión logística completa.</h2>
            <p>Translogística del Sur acompaña la operación de punta a punta, con servicios que se complementan con la plataforma.</p>
          </div>
          <div class="servicios">
            @for (s of servicios; track s.t) {
              <article class="servicio revelar">
                <span class="icono"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos[s.i]" /></svg></span>
                <h3>{{ s.t }}</h3>
                <p>{{ s.d }}</p>
              </article>
            }
          </div>
        </div>
      </section>

      <!-- ── Empresa ── -->
      <section class="seccion gris" id="empresa">
        <div class="contenedor empresa">
          <div class="revelar">
            <p class="etiqueta">Empresa</p>
            <h2>Hechos en Pasto, para el sur de Colombia.</h2>
            <p class="texto">Gestión Logística y de Transporte del Sur S.A.S. es una empresa de la Fundación del Sur para el Desarrollo de Nariño
              (FUNDESUR NARIÑO), con domicilio en San Juan de Pasto.</p>
            <ul class="principios">
              @for (c of principios; track c) { <li><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconos['check']" /></svg>{{ c }}</li> }
            </ul>
          </div>
          <aside class="ficha revelar">
            <dl>
              <div><dt>Razón social</dt><dd>Gestión Logística y de Transporte del Sur S.A.S.</dd></div>
              <div><dt>Sigla</dt><dd>Translogística del Sur S.A.S.</dd></div>
              <div><dt>Sede</dt><dd>Carrera 33A Calle 6 Casa 29, Barrio San Vicente · San Juan de Pasto, Nariño</dd></div>
            </dl>
          </aside>
        </div>
      </section>

      <!-- ── Llamado final ── -->
      <section class="seccion">
        <div class="contenedor">
          <div class="banda revelar">
            <div>
              <h2>¿Ya trabaja con nosotros?</h2>
              <p>Ingrese con su usuario. La demostración guiada de la plataforma llega pronto.</p>
            </div>
            <div class="cta">
              <a class="btn btn-ambar grande" routerLink="/ingresar">Ingresar a la plataforma <span aria-hidden="true">→</span></a>
              <a class="btn btn-oscuro grande" href="#funciones">Ver demo</a>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="pie">
      <div class="contenedor">
        <div class="pie-grid">
          <div class="pie-marca">
            <a class="marca" href="#inicio"><img src="icono.png" alt="" width="160" height="66" loading="lazy" /><span>Translogística <b>del Sur</b></span></a>
            <p>Gestión logística, coordinación del transporte y tecnología para la carga del sur de Colombia.</p>
          </div>
          <nav aria-label="Plataforma">
            <h3>Plataforma</h3>
            <a href="#funciones">Funciones</a><a href="#flujo">Cómo funciona</a><a routerLink="/ingresar">Ingresar</a>
          </nav>
          <nav aria-label="Empresa">
            <h3>Empresa</h3>
            <a href="#servicios">Servicios</a><a href="#empresa">Quiénes somos</a>
          </nav>
          <div>
            <h3>Sede</h3>
            <address>Carrera 33A Calle 6 Casa 29<br />Barrio San Vicente<br />San Juan de Pasto, Nariño</address>
          </div>
        </div>
        <div class="pie-base">
          <p>© {{ anio }} Gestión Logística y de Transporte del Sur S.A.S.</p>
          <p>Una empresa de FUNDESUR Nariño</p>
        </div>
      </div>
    </footer>`,
  styles: [`
    :host { display: block; --tinta: #0b0f15; --texto: #111827; --tenue: #5b6472; --borde: #e7e9ee; --fondo-2: #f6f7f9;
      --ambar: #f6b80f; --ambar-2: #ffc933; --ambar-txt: #9a6b00; --verde: #12a150;
      font-family: var(--fuente); color: var(--texto); background: #fff; overflow-x: clip; }
    * { box-sizing: border-box; }
    .contenedor { width: min(1200px, 100% - 48px); margin: 0 auto; }
    h1, h2, h3 { margin: 0; text-wrap: balance; color: var(--tinta); }
    p { text-wrap: pretty; }
    svg path { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .saltar { position: absolute; left: -999px; top: 10px; z-index: 100; background: var(--tinta); color: #fff; padding: 8px 12px; border-radius: 8px; }
    .saltar:focus { left: 12px; }

    /* Botones */
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; padding: 9px 18px; border-radius: 10px; font-weight: 700; font-size: 14.5px;
      text-decoration: none; border: 1px solid transparent; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease; white-space: nowrap; }
    .btn:active { transform: translateY(1px); }
    a:focus-visible, button:focus-visible { outline: 3px solid var(--ambar); outline-offset: 2px; border-radius: 8px; }
    .btn.grande { min-height: 50px; padding: 13px 22px; font-size: 15.5px; border-radius: 12px; }
    .btn-tinta { background: var(--tinta); color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2), inset 0 1px 0 rgba(255,255,255,.08); }
    .btn-tinta:hover { background: #222a36; }
    .btn-blanco { background: #fff; color: var(--tinta); border-color: var(--borde); box-shadow: 0 1px 2px rgba(16,24,40,.05); }
    .btn-blanco:hover { border-color: #cfd3db; background: #fafbfc; }
    .btn-ambar { background: var(--ambar); color: var(--tinta); } .btn-ambar:hover { background: var(--ambar-2); }
    .btn-oscuro { color: #fff; border-color: rgba(255,255,255,.2); } .btn-oscuro:hover { background: rgba(255,255,255,.08); }

    /* Encabezado */
    .cab { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.82); backdrop-filter: saturate(1.6) blur(14px); border-bottom: 1px solid transparent; transition: border-color .2s ease; }
    .cab.sombra { border-bottom-color: var(--borde); }
    .fila-cab { display: flex; align-items: center; gap: 32px; height: 68px; }
    .marca { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--tinta); font-weight: 800; font-size: 16.5px; letter-spacing: -.02em; }
    .marca img { width: 44px; height: auto; }
    .marca b { color: var(--ambar-txt); font-weight: 800; }
    .menu { display: flex; gap: 28px; }
    .menu a { color: var(--tenue); text-decoration: none; font-weight: 600; font-size: 14.5px; }
    .menu a:not(.btn):hover { color: var(--tinta); }
    .acciones-cab { display: flex; gap: 10px; margin-left: auto; align-items: center; }
    .solo-movil, .hamburguesa { display: none; }
    .hamburguesa { width: 42px; height: 42px; border-radius: 10px; border: 1px solid var(--borde); background: #fff; cursor: pointer; flex-direction: column; justify-content: center; gap: 5px; padding: 0 11px; }
    .hamburguesa { align-items: stretch; }
    .hamburguesa span { display: block; height: 2px; background: var(--tinta); border-radius: 2px; }

    /* Portada */
    .portada { position: relative; padding: 44px 0 0; isolation: isolate; }
    .portada::after { content: ''; position: absolute; left: 50%; top: 260px; translate: -50% 0; width: min(1100px, 90vw); height: 520px; z-index: -1;
      background: radial-gradient(closest-side, rgba(246,184,15,.28), transparent); filter: blur(30px); }
    .portada-txt { text-align: center; display: flex; flex-direction: column; align-items: center; }
    h1 { font-size: clamp(40px, 6vw, 76px); line-height: 1.3; letter-spacing: -.045em; font-weight: 800; max-width: 17ch; }
    .resalte { background: linear-gradient(180deg, transparent 62%, rgba(246,184,15,.45) 62%, rgba(246,184,15,.45) 92%, transparent 92%); padding: 0 .06em; }
    .bajada { max-width: 58ch; margin: 24px 0 32px; font-size: clamp(16.5px, 1.4vw, 19px); line-height: 1.6; color: var(--tenue); }
    .cta { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
    .pronto { margin: 16px 0 0; font-size: 13px; color: #8b93a1; }

    /* Pantalla ilustrativa */
    .pantalla { position: relative; margin: 64px 0 0; border-radius: 16px; background: #fff; border: 1px solid var(--borde);
      box-shadow: 0 2px 4px rgba(16,24,40,.04), 0 30px 80px -20px rgba(16,24,40,.28); overflow: visible; }
    .navegador { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 14px; border-bottom: 1px solid var(--borde); background: #fafbfc; border-radius: 16px 16px 0 0; }
    .navegador i { width: 10px; height: 10px; border-radius: 50%; background: #e1e4ea; }
    .navegador span { margin: 0 auto; padding: 4px 14px; border-radius: 7px; background: #fff; border: 1px solid var(--borde); font-size: 12px; color: #8b93a1; }
    .app { border-radius: 0 0 16px 16px; overflow: hidden; }
    .app-barra { display: flex; align-items: center; gap: 22px; height: 50px; padding: 0 18px; background: var(--tinta); }
    .app-barra img { width: 118px; height: auto; }
    .app-barra nav { display: flex; gap: 4px; flex: 1; overflow: hidden; }
    .app-barra nav span { padding: 6px 11px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: #9aa4b2; white-space: nowrap; }
    .app-barra nav span.activo { background: rgba(255,255,255,.09); color: #fff; }
    .avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--ambar); color: var(--tinta); font-size: 11px; font-weight: 800; flex: none; }
    .avatar.chico { width: 32px; height: 32px; font-size: 12px; }
    .app-cuerpo { padding: 22px 24px 26px; background: #fbfbfc; }
    .app-cab { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .app-cab b { display: block; font-size: 19px; letter-spacing: -.02em; } .app-cab small { color: #8b93a1; font-size: 12.5px; }
    .app-boton { display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px; border-radius: 9px; background: var(--ambar); color: var(--tinta); font-size: 12.5px; font-weight: 700; }
    .app-boton.ancho { width: 100%; margin-top: 6px; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi { background: #fff; border: 1px solid var(--borde); border-radius: 12px; padding: 13px 15px; display: flex; flex-direction: column; gap: 3px; }
    .kpi small { color: #8b93a1; font-size: 12px; font-weight: 600; } .kpi b { font-size: 22px; letter-spacing: -.03em; }
    .tendencia { font-size: 11.5px; font-weight: 700; } .tendencia.sube { color: var(--verde); } .tendencia.neutra { color: #8b93a1; }
    .tabla { background: #fff; border: 1px solid var(--borde); border-radius: 12px; overflow: hidden; font-size: 13px; }
    .fila { display: grid; grid-template-columns: .8fr .8fr 1.6fr 1.4fr 1.3fr; gap: 12px; align-items: center; padding: 11px 16px; border-top: 1px solid #f0f1f4; }
    .fila.cabeza { border-top: 0; background: #fafbfc; color: #8b93a1; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .fila span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-variant-numeric: tabular-nums; font-weight: 700; }
    .placa { font-style: normal; padding: 2px 7px; border-radius: 5px; background: #fff4cc; border: 1px solid #f2d36b; font-weight: 800; font-size: 11.5px; letter-spacing: .06em; }
    .estado { font-style: normal; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; }
    .estado::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .estado.aceptado { background: #e8f7ee; color: #0d7a3d; } .estado.ruta { background: #eaf1ff; color: #2456c7; }
    .estado.pend { background: #fff6dd; color: #946200; } .estado.cerrado { background: #f1f2f4; color: #5b6472; }
    .flotante { position: absolute; display: flex; align-items: center; gap: 10px; padding: 11px 15px 11px 11px; border-radius: 14px; background: #fff; border: 1px solid var(--borde);
      box-shadow: 0 20px 40px -14px rgba(16,24,40,.3); font-size: 13px; animation: flotar 6s ease-in-out infinite; }
    .flotante b { display: block; font-size: 13.5px; } .flotante small { color: #8b93a1; font-size: 12px; }
    .f1 { right: -26px; top: 118px; } .f2 { left: -30px; bottom: 70px; animation-delay: -3s; }
    .ok { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: #e8f7ee; color: var(--verde); font-weight: 800; }
    .gps { width: 30px; height: 30px; border-radius: 9px; background: #eaf1ff; position: relative; }
    .gps::after { content: ''; position: absolute; inset: 10px; border-radius: 50%; background: #2f6bff; box-shadow: 0 0 0 4px rgba(47,107,255,.2); }
    @keyframes flotar { 50% { transform: translateY(-8px); } }
    figcaption { position: absolute; right: 14px; bottom: -28px; font-size: 12px; color: #9aa1ad; }

    /* Franja */
    .franja { padding: 76px 0 28px; }
    .franja-fila { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 40px; padding: 22px 0; border-block: 1px solid var(--borde); }
    .capacidad { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 14.5px; color: #3a4250; }
    .capacidad svg { width: 20px; height: 20px; color: var(--ambar-txt); }

    /* Secciones */
    .seccion { padding: clamp(72px, 9vw, 120px) 0; }
    .seccion.gris { background: var(--fondo-2); border-block: 1px solid var(--borde); }
    .titulo-seccion { max-width: 680px; margin: 0 auto 52px; text-align: center; }
    .etiqueta { margin: 0 0 12px; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--ambar-txt); }
    h2 { font-size: clamp(30px, 3.8vw, 48px); line-height: 1.08; letter-spacing: -.035em; font-weight: 800; }
    .titulo-seccion p:not(.etiqueta) { margin: 18px 0 0; color: var(--tenue); font-size: 17.5px; line-height: 1.6; }
    .icono { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; background: #fff7dc; color: var(--ambar-txt); border: 1px solid #f6e2a3; margin-bottom: 16px; }
    .icono svg { width: 21px; height: 21px; }

    /* Bento */
    .bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
    .celda { display: flex; flex-direction: column; background: #fff; border: 1px solid var(--borde); border-radius: 18px; padding: 24px; overflow: hidden;
      transition: border-color .2s ease, box-shadow .2s ease; }
    .celda:hover { border-color: #d6dae1; box-shadow: 0 16px 40px -24px rgba(16,24,40,.3); }
    .celda.ancha { grid-column: span 2; flex-direction: row; gap: 28px; align-items: center; }
    .celda.ancha:last-child { grid-column: 1 / -1; }
    .celda-txt { flex: 1 1 0; min-width: 0; }
    .celda h3 { font-size: 18.5px; letter-spacing: -.02em; margin-bottom: 8px; }
    .celda p { margin: 0; color: var(--tenue); font-size: 15px; line-height: 1.55; }
    .mini { border-radius: 14px; background: var(--fondo-2); border: 1px solid #edeff2; }
    .celda:not(.ancha) .mini { height: 150px; margin-bottom: 20px; }
    .celda.ancha .mini { flex: 1 1 0; min-width: 0; padding: 16px; }
    .mini-rndc { display: flex; flex-direction: column; gap: 8px; }
    .paso-rndc { display: flex; gap: 11px; align-items: center; padding: 10px 12px; background: #fff; border: 1px solid var(--borde); border-radius: 10px; }
    .paso-rndc b { display: block; font-size: 13.5px; } .paso-rndc small { color: #8b93a1; font-size: 12px; }
    .marca-paso { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #d7dbe2; font-size: 12px; font-weight: 800; flex: none; }
    .paso-rndc.hecho .marca-paso { background: var(--verde); border-color: var(--verde); color: #fff; }
    .paso-rndc.actual .marca-paso { border-color: var(--ambar); box-shadow: 0 0 0 4px rgba(246,184,15,.2); }
    .mini-mapa { background-color: #eef1f4; background-image: linear-gradient(#e2e6eb 1px, transparent 1px), linear-gradient(90deg, #e2e6eb 1px, transparent 1px); background-size: 22px 22px; }
    .mini-mapa svg { width: 100%; height: 100%; }
    .recorrido { stroke: #2f6bff !important; stroke-width: 3 !important; stroke-dasharray: 2 7; }
    .punto-ini { fill: #fff; stroke: #2f6bff; stroke-width: 3; } .punto-act { fill: #2f6bff; stroke: #fff; stroke-width: 3; }
    .mini-liq { padding: 12px 14px; display: flex; flex-direction: column; justify-content: center; gap: 6px; font-size: 12.5px; }
    .mini-liq div { display: flex; justify-content: space-between; color: var(--tenue); }
    .mini-liq b { color: var(--tinta); font-variant-numeric: tabular-nums; }
    .mini-liq .total { margin-top: 4px; padding-top: 8px; border-top: 1px dashed #d4d8df; } .mini-liq .total span, .mini-liq .total b { color: var(--tinta); font-weight: 800; }
    .mini-barras { display: flex; align-items: flex-end; gap: 7px; padding: 18px 16px 0; }
    .mini-barras i { flex: 1; border-radius: 5px 5px 0 0; background: #e3e6eb; } .mini-barras i:last-child { background: var(--ambar); }
    .mini-qr { display: flex; align-items: center; justify-content: center; gap: 18px; }
    .hoja { width: 74px; height: 100px; background: #fff; border: 1px solid var(--borde); border-radius: 6px; padding: 12px 10px; display: flex; flex-direction: column; gap: 7px; box-shadow: 0 6px 14px -8px rgba(16,24,40,.25); }
    .hoja i { height: 5px; border-radius: 3px; background: #e3e6eb; } .hoja i.corta { width: 60%; }
    .qr { display: grid; grid-template-columns: repeat(7, 9px); gap: 2px; padding: 8px; background: #fff; border-radius: 8px; border: 1px solid var(--borde); }
    .qr i { width: 9px; height: 9px; border-radius: 1.5px; } .qr i.lleno { background: var(--tinta); }
    .mini-roles { display: flex; flex-direction: column; gap: 8px; }
    .rol { display: flex; align-items: center; gap: 11px; padding: 9px 12px; background: #fff; border: 1px solid var(--borde); border-radius: 10px; }
    .rol div { flex: 1; min-width: 0; } .rol b { display: block; font-size: 13.5px; } .rol small { color: #8b93a1; font-size: 12px; }
    .rol em { font-style: normal; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #f1f2f4; color: #4a5260; white-space: nowrap; }

    /* Flujo: línea de tiempo + panel amarillo */
    .linea-tiempo { position: relative; max-width: 1080px; margin: 0 auto 34px; }
    .riel { position: absolute; left: calc(100% / 12); right: calc(100% / 12); top: 27px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.12); }
    .riel i { display: block; height: 100%; border-radius: 4px; background: var(--ambar); transition: width .5s cubic-bezier(.2,.7,.2,1); }
    .nodos { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .nodo, .nodo:hover:not(:disabled) { display: flex; flex-direction: column; align-items: center; gap: 12px; min-height: 0; padding: 0; border: 0; background: none; box-shadow: none;
      color: #7d8796; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; }
    .bola { display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; background: var(--tinta); border: 3px solid #2c3442; color: #9aa4b2;
      font-size: 17px; font-weight: 800; transition: transform .25s ease, background .25s ease, border-color .25s ease, color .25s ease; }
    .nodo:hover:not(:disabled) .bola { border-color: var(--ambar); color: #fff; }
    .nodo:hover:not(:disabled), .nodo.hecho { color: #d5dae1; }
    .nodo.hecho .bola { background: var(--tinta); border-color: var(--ambar); color: var(--ambar); }
    .nodo.activo { color: var(--ambar); }
    .nodo.activo .bola { background: var(--ambar); border-color: var(--ambar); color: var(--tinta); transform: scale(1.12); box-shadow: 0 0 0 8px rgba(246,184,15,.16); }

    .panel-paso { position: relative; overflow: hidden; max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: auto minmax(0, 1.2fr) minmax(0, 1fr);
      gap: 36px; align-items: center; padding: 64px 44px 48px; border-radius: 24px; background: var(--ambar); color: var(--tinta); }
    .cifra { font-size: clamp(90px, 11vw, 150px); font-weight: 800; line-height: .8; letter-spacing: -.06em; color: transparent; -webkit-text-stroke: 2.5px var(--tinta); }
    .paso-de { margin: 0 0 8px; font-size: 12.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .panel-txt h3 { font-size: clamp(28px, 3vw, 38px); letter-spacing: -.035em; margin-bottom: 10px; }
    .panel-txt p:last-child { margin: 0; font-size: 16.5px; line-height: 1.6; color: #2e2608; }
    .lista-paso { list-style: none; margin: 0; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; border-radius: 16px; background: var(--tinta); color: #fff; }
    .lista-paso li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; font-weight: 600; line-height: 1.45; }
    .lista-paso li svg { width: 20px; height: 20px; padding: 3px; flex: none; border-radius: 50%; background: var(--ambar); color: var(--tinta); }
    .lista-paso li svg path { stroke-width: 3; }
    .panel-nav { position: absolute; right: 20px; top: 18px; display: flex; gap: 6px; }
    .panel-nav button { width: 36px; min-height: 36px; padding: 0; border-radius: 50%; border: 2px solid var(--tinta); background: transparent; color: var(--tinta); font-weight: 800; box-shadow: none; }
    .panel-nav button:hover:not(:disabled) { background: var(--tinta); color: var(--ambar); border-color: var(--tinta); }
    .panel-nav button:disabled { opacity: .3; }
    .temporizador { position: absolute; left: 0; bottom: 0; height: 5px; width: 100%; background: var(--tinta); transform-origin: left; animation: correr 6s linear forwards; }
    .panel-paso:hover .temporizador { animation-play-state: paused; }
    @keyframes correr { from { transform: scaleX(0); } to { transform: scaleX(1); } }

    .principios { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 11px; }
    .principios li { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; line-height: 1.5; color: #333b48; }
    .principios li svg { width: 18px; height: 18px; flex: none; margin-top: 2px; }
    .principios li svg path { stroke-width: 2.4; }

    /* Servicios */
    .servicios { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 18px; }
    .servicio { grid-column: span 2; padding: 26px; border: 1px solid var(--borde); border-radius: 18px; background: #fff; }
    .servicio:nth-child(4), .servicio:nth-child(5) { grid-column: span 3; }
    .servicio h3 { font-size: 18px; letter-spacing: -.02em; margin-bottom: 8px; }
    .servicio p { margin: 0; color: var(--tenue); font-size: 15px; line-height: 1.6; }

    /* Empresa */
    .empresa { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 56px; align-items: center; }
    .texto { margin: 18px 0 26px; color: var(--tenue); font-size: 17px; line-height: 1.65; max-width: 56ch; }
    .ficha { background: #fff; border: 1px solid var(--borde); border-radius: 18px; padding: 8px 26px; box-shadow: 0 20px 50px -30px rgba(16,24,40,.3); }
    .ficha dl { margin: 0; }
    .ficha div { padding: 18px 0; border-top: 1px solid #f0f1f4; } .ficha div:first-child { border-top: 0; }
    .ficha dt { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #8b93a1; margin-bottom: 5px; }
    .ficha dd { margin: 0; font-weight: 700; line-height: 1.5; }

    /* Banda final */
    .banda { position: relative; overflow: hidden; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 28px;
      padding: clamp(36px, 5vw, 60px); border-radius: 24px; background: var(--tinta); color: #fff; isolation: isolate; }
    .banda::before { content: ''; position: absolute; right: -10%; top: -60%; width: 60%; height: 220%; z-index: -1; background: radial-gradient(closest-side, rgba(246,184,15,.3), transparent); }
    .banda h2 { color: #fff; } .banda p { margin: 12px 0 0; color: #b9c1cc; font-size: 17px; }
    .banda .cta { justify-content: flex-start; }

    /* Pie */
    .pie { border-top: 1px solid var(--borde); padding: 64px 0 0; font-size: 14.5px; color: var(--tenue); }
    .pie-grid { display: grid; grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)); gap: 40px; padding-bottom: 48px; }
    .pie-marca p { margin: 16px 0 0; max-width: 34ch; line-height: 1.6; }
    .pie h3 { font-size: 13px; font-weight: 800; margin-bottom: 14px; }
    .pie nav { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
    .pie nav a { color: var(--tenue); text-decoration: none; } .pie nav a:hover { color: var(--tinta); }
    .pie address { font-style: normal; line-height: 1.65; }
    .pie-base { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 24px; padding: 22px 0 28px; border-top: 1px solid var(--borde); font-size: 13px; }
    .pie-base p { margin: 0; }

    /* Aparición suave */
    .revelar { opacity: 0; transform: translateY(18px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
    .revelar.visible { opacity: 1; transform: none; }

    @media (max-width: 1080px) {
      .f1 { right: 12px; top: auto; bottom: -24px; } .f2 { display: none; }
      .bento { grid-template-columns: 1fr 1fr; } .celda.ancha { grid-column: span 2; }
      .servicios { grid-template-columns: 1fr 1fr; } .servicio, .servicio:nth-child(4), .servicio:nth-child(5) { grid-column: span 1; }
      .empresa { grid-template-columns: 1fr; gap: 32px; }
      .pie-grid { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 860px) {
      .menu { position: fixed; inset: 68px 0 auto; flex-direction: column; gap: 2px; padding: 12px 24px 22px; background: #fff; border-bottom: 1px solid var(--borde);
        box-shadow: 0 20px 30px -20px rgba(16,24,40,.25); transform: translateY(-130%); transition: transform .25s ease; z-index: -1; }
      .menu.abierto { transform: none; }
      .menu a { padding: 12px 0; font-size: 16.5px; color: var(--tinta); } .menu .btn { margin-top: 8px; }
      .solo-movil { display: inline-flex; } .ocultar-movil { display: none; } .hamburguesa { display: flex; }
      .kpis { grid-template-columns: 1fr 1fr; }
      .app-barra nav span:nth-child(n+4) { display: none; }
    }
    @media (max-width: 640px) {
      .contenedor { width: calc(100% - 32px); }
      .portada { padding-top: 32px; }
      .cta { width: 100%; } .cta .btn { flex: 1 1 100%; }
      .marca { gap: 8px; } .marca img { width: 38px; } .marca span { font-size: 14px; white-space: nowrap; }
      .acciones-cab { gap: 8px; } .fila-cab { gap: 10px; } .acciones-cab .btn-tinta { padding: 8px 14px; }
      .estado { font-size: 10.5px; padding: 3px 7px; }
      .pantalla { margin-top: 44px; } .app-cuerpo { padding: 14px; } .app-barra img { display: none; }
      .fila { grid-template-columns: .9fr 1fr 1.7fr 1.5fr; padding: 10px 12px; font-size: 12px; } .ocultar-sm { display: none; }
      .fila span:nth-child(3) { display: none; } .fila { grid-template-columns: .7fr 1fr 2fr; gap: 8px; }
      .flotante { display: none; }
      .bento, .servicios { grid-template-columns: 1fr; } .celda.ancha { grid-column: span 1; flex-direction: column; align-items: stretch; }
      .pie-grid { grid-template-columns: 1fr; gap: 28px; }
      .nom { display: none; } .bola { width: 42px; height: 42px; font-size: 13px; border-width: 2px; } .riel { top: 19px; } .nodos { gap: 4px; }
    }

    /* ── Contraste amarillo y negro ── */
    .cab { background: rgba(11,15,21,.95); } .cab.sombra { border-bottom-color: rgba(255,255,255,.08); }
    .cab .marca, .pie .marca { color: #fff; } .cab .marca b, .pie .marca b { color: var(--ambar); }
    .menu a { color: #c9cfd8; } .menu a:not(.btn):hover { color: var(--ambar); }
    .cab .btn-tinta { background: var(--ambar); color: var(--tinta); box-shadow: none; } .cab .btn-tinta:hover { background: var(--ambar-2); }
    .cab .btn-blanco { background: transparent; color: #fff; border-color: rgba(255,255,255,.3); box-shadow: none; } .cab .btn-blanco:hover { border-color: #fff; background: transparent; }
    .hamburguesa, .hamburguesa:hover:not(:disabled) { background: transparent; border-color: rgba(255,255,255,.3); } .hamburguesa span { background: #fff; }

    .resalte { background: var(--ambar); padding: 0 .14em .02em; border-radius: 8px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .portada .btn-blanco { border: 2px solid var(--tinta); box-shadow: none; } .portada .btn-blanco:hover { background: var(--tinta); color: #fff; }
    .portada::after { background: radial-gradient(closest-side, rgba(246,184,15,.45), transparent); }

    .franja { background: var(--tinta); padding: 0; margin-top: 76px; }
    .franja-fila { border: 0; padding: 26px 0; } .capacidad { color: #fff; } .capacidad svg { color: var(--ambar); }

    .etiqueta { display: inline-block; padding: 5px 12px; border-radius: 999px; background: var(--ambar); color: var(--tinta); font-size: 12px; }
    .icono { background: var(--ambar); color: var(--tinta); border-color: var(--ambar); }
    .celda:hover, .servicio:hover { border-color: var(--tinta); box-shadow: 6px 6px 0 var(--tinta); }
    .servicio { transition: border-color .2s ease, box-shadow .2s ease; }
    .recorrido { stroke: var(--tinta) !important; } .punto-ini { stroke: var(--tinta); } .punto-act { fill: var(--ambar); stroke: var(--tinta); }

    #flujo { background: var(--tinta); border-color: transparent; } #flujo h2 { color: #fff; }

    .principios li svg { width: 20px; height: 20px; padding: 3px; border-radius: 50%; background: var(--tinta); color: var(--ambar); }
    #empresa { background: var(--ambar); border-color: transparent; }
    #empresa .etiqueta { background: var(--tinta); color: var(--ambar); }
    #empresa .texto { color: #2e2608; } #empresa .principios li { color: var(--tinta); font-weight: 600; }
    .ficha { border: 2px solid var(--tinta); box-shadow: 10px 10px 0 var(--tinta); }

    .banda { border: 2px solid var(--ambar); }
    .pie { background: var(--tinta); color: #9aa4b2; border-top: 4px solid var(--ambar); }
    .pie h3 { color: #fff; } .pie nav a { color: #9aa4b2; } .pie nav a:hover { color: var(--ambar); }
    .pie-base { border-top-color: rgba(255,255,255,.1); }
    @media (max-width: 860px) {
      .menu { background: var(--tinta); border-bottom-color: rgba(255,255,255,.08); }
      .menu a { color: #fff; } .menu .btn-blanco { background: transparent; color: #fff; border-color: rgba(255,255,255,.3); }
      .panel-paso { grid-template-columns: 1fr; gap: 18px; padding: 64px 22px 34px; } .cifra { font-size: 80px; }
    }

    @media (prefers-reduced-motion: reduce) {
      .revelar { opacity: 1; transform: none; transition: none; }
      .flotante { animation: none; }
    }
  `],
})
export class Landing implements AfterViewInit {
  private el = inject(ElementRef<HTMLElement>);
  private destruir = inject(DestroyRef);
  readonly anio = new Date().getFullYear();
  readonly menu = signal(false);
  readonly desplazado = signal(false);
  readonly paso = signal(0);
  // Los pasos avanzan solos hasta que la persona elige uno
  readonly auto = signal(true);
  pausado = false;

  // Íconos de trazo (24x24)
  readonly iconos: Record<string, string> = {
    documento: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15l2 2 4-4',
    pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z M12 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
    billetera: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1 M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
    grafica: 'M3 3v18h18 M7 16v-4 M12 16V8 M17 16v-7',
    qr: 'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h2v2h-2z M19 19h2v2h-2z M15 19h2 M19 15h2',
    usuarios: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    caja: 'M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
    camion: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2 M15 18H9 M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14 M7 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M17 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
    pantalla: 'M2 4h20v13H2z M8 21h8 M12 17v4',
    escudo: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
    check: 'M20 6 9 17l-5-5',
  };

  readonly modulosApp = ['Inicio', 'Viajes', 'RNDC', 'Monitoreo', 'Pagos', 'Contabilidad'];
  readonly kpis = [
    { t: 'Viajes del mes', v: '128', d: '+12 esta semana', c: 'sube' },
    { t: 'Manifiestos', v: '121', d: 'Todos aceptados', c: 'sube' },
    { t: 'En ruta', v: '7', d: 'Con GPS activo', c: 'neutra' },
    { t: 'Por liquidar', v: '15', d: 'Esta quincena', c: 'neutra' },
  ];
  readonly viajesDemo = [
    { n: '#1042', p: 'ABC123', r: 'Pasto → Ipiales', c: 'Conductor de ejemplo', e: 'ruta', t: 'En ruta' },
    { n: '#1041', p: 'XYZ789', r: 'Pasto → Tumaco', c: 'Conductor de ejemplo', e: 'aceptado', t: 'Manifiesto aceptado' },
    { n: '#1040', p: 'DEF456', r: 'Ipiales → Pasto', c: 'Conductor de ejemplo', e: 'pend', t: 'Remesa en revisión' },
    { n: '#1039', p: 'GHI321', r: 'Pasto → Túquerres', c: 'Conductor de ejemplo', e: 'cerrado', t: 'Cumplido' },
  ];
  readonly capacidades = [
    { i: 'documento', t: 'RNDC · Ministerio de Transporte' },
    { i: 'pin', t: 'Rastreo GPS' },
    { i: 'qr', t: 'Soportes con QR' },
    { i: 'billetera', t: 'Pagos y retenciones' },
    { i: 'grafica', t: 'Contabilidad' },
  ];
  readonly pasosRndc = [
    { t: 'Remesa', d: 'Aceptada · radicado recibido', e: 'hecho' },
    { t: 'Manifiesto', d: 'Aceptado · código de seguridad', e: 'hecho' },
    { t: 'Cumplido', d: 'Pendiente de la entrega', e: 'actual' },
  ];
  readonly liquidacion = [
    { t: 'Flete', v: '$ 2.400.000', total: false },
    { t: 'Retención en la fuente', v: '− $ 24.000', total: false },
    { t: 'Anticipo', v: '− $ 1.200.000', total: false },
    { t: 'Neto a pagar', v: '$ 1.176.000', total: true },
  ];
  readonly barrasDemo = [38, 52, 45, 66, 58, 74, 63, 88];
  readonly qr = Array.from({ length: 49 }, (_, i) => {
    const f = Math.floor(i / 7), c = i % 7;
    const esquina = (r: number, k: number) => (f >= r && f < r + 3 && c >= k && c < k + 3);
    if (esquina(0, 0) || esquina(0, 4) || esquina(4, 0)) return !(f % 4 === 1 && c % 4 === 1);
    return (i * 5 + 3) % 3 === 0;
  });
  readonly roles = [
    { n: 'AD', t: 'Administración', d: 'Configuración y usuarios', p: 'Todo' },
    { n: 'OP', t: 'Operaciones', d: 'Viajes y RNDC', p: 'Despacho' },
    { n: 'CO', t: 'Contabilidad', d: 'Pagos e informes', p: 'Finanzas' },
  ];

  // Funciones reales de la plataforma, en el orden de un despacho
  readonly paradas = [
    { t: 'Registro', d: 'El viaje se crea con cliente, ruta, tarifa, vehículo y conductor, uno a uno o por programación de varios días.',
      items: ['Clientes con sus sedes de cargue y descargue', 'Vehículos, remolques y conductores', 'Tarifas por ruta'] },
    { t: 'RNDC', d: 'La remesa y el manifiesto se expiden ante el Registro Nacional de Despachos de Carga desde el mismo viaje.',
      items: ['Verificación de datos antes de enviar', 'Historial de cada envío y respuesta', 'Anulaciones y reemplazos'] },
    { t: 'Seguimiento', d: 'El vehículo se sigue en ruta y cada entrega queda registrada.',
      items: ['Posición GPS en el mapa', 'Entregas con lugar y evidencia', 'Estado del viaje en vivo'] },
    { t: 'Cumplido', d: 'Al terminar, se cumplen la remesa y el manifiesto con su trazabilidad.',
      items: ['Cumplido de remesas y manifiestos', 'Soporte interno con QR verificable', 'Documentos en PDF'] },
    { t: 'Liquidación', d: 'Se factura al cliente y se liquida el pago del conductor.',
      items: ['Retenciones de ley', 'Anticipos y préstamos', 'Relación de pagos'] },
    { t: 'Contabilidad', d: 'Todo termina en la contabilidad de la empresa, lista para revisar.',
      items: ['Libro diario', 'Cuentas por cobrar y por pagar', 'Informes y cierre de mes'] },
  ];

  // Objeto social de la sociedad (documento de constitución)
  readonly servicios = [
    { i: 'caja', t: 'Operación logística', d: 'Planeación y control de la cadena de suministro: almacenamiento, bodegaje, cargue y descargue, embalaje, alistamiento, etiquetado, distribución e inventarios.' },
    { i: 'camion', t: 'Coordinación del transporte', d: 'Asesoría y coordinación de la carga, contratando el transporte solo con empresas habilitadas por el Ministerio de Transporte.' },
    { i: 'pantalla', t: 'Software de transporte (TMS)', d: 'Desarrollo, licenciamiento, implementación y soporte de plataformas de transporte, logística y administración documental.' },
    { i: 'pin', t: 'Rastreo y monitoreo de flotas', d: 'Telemática, rastreo satelital GPS y control digital de vehículos.' },
    { i: 'escudo', t: 'SG-SST y seguridad vial', d: 'Consultoría, implementación y auditoría del SG-SST y del Plan Estratégico de Seguridad Vial, con profesionales licenciados.' },
  ];

  // Forma de trabajo tomada de los estatutos
  readonly principios = [
    'El transporte se contrata solo con empresas habilitadas por el Ministerio de Transporte.',
    'Nuestro personal se vincula directamente por la empresa.',
    'La carga puede ampararse con pólizas de mercancías y de responsabilidad civil.',
  ];

  ngAfterViewInit() {
    const raiz = this.el.nativeElement;
    // Aparición de los bloques al entrar en pantalla
    const io = new IntersectionObserver(entradas => {
      for (const e of entradas) if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    raiz.querySelectorAll('.revelar').forEach((n: Element) => io.observe(n));
    // Borde del encabezado al desplazarse
    const alDesplazar = () => this.desplazado.set(window.scrollY > 10);
    alDesplazar();
    window.addEventListener('scroll', alDesplazar, { passive: true });
    // Avance automático de los pasos (6 s cada uno; se detiene con el cursor encima)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.auto.set(false);
    let transcurrido = 0;
    const reloj = setInterval(() => {
      if (!this.auto() || this.pausado || document.hidden) return;
      transcurrido += 100;
      if (transcurrido < 6000) return;
      transcurrido = 0;
      this.paso.set((this.paso() + 1) % this.paradas.length);
    }, 100);
    this.destruir.onDestroy(() => { io.disconnect(); window.removeEventListener('scroll', alDesplazar); clearInterval(reloj); });
  }

  // Elegir un paso a mano detiene el avance automático
  elegir(i: number) {
    if (i < 0 || i >= this.paradas.length) return;
    this.auto.set(false);
    this.paso.set(i);
  }
}
