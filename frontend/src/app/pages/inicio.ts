import { Component, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { FORMATOS } from '../shared/formato';
import { filtrar } from '../shared/filtro';

const ESTADOS: Record<string, [string, string]> = {
  registrado: ['Registrado', ''], remesa: ['Remesa', 'alerta'], manifestado: ['Manifestado', 'ok'], cumplido: ['Cumplido', 'ok'], anulado: ['Anulado', 'error'],
};

// Tablero de inicio: lo que pasa hoy, lo que requiere atención y cómo va el mes.
@Component({
  selector: 'app-inicio',
  imports: [RouterLink, Icono, ...FORMATOS],
  template: `
    <!-- Encabezado -->
    <section class="hero">
      <div class="hero-txt">
        <p class="fecha">{{ hoy }}</p>
        <h1>{{ saludo() }}, {{ primerNombre() }}</h1>
        <p class="empresa">{{ auth.usuario()?.empresa?.nombre }}</p>
      </div>
      <div class="hero-datos">
        <a class="dato" routerLink="/viajes"><span class="n">{{ r()?.hoy ?? '—' }}</span><span class="t">viajes hoy</span></a>
        <a class="dato" routerLink="/monitoreo"><span class="n">{{ r()?.enRuta ?? '—' }}</span><span class="t">en seguimiento</span></a>
        <a class="dato" [class.rojo]="(r()?.rechazos || 0) > 0" [routerLink]="rutaRndc()"><span class="n">{{ r()?.rechazos ?? '—' }}</span><span class="t">rechazos RNDC</span></a>
      </div>
      <div class="hero-acciones">
        @if (auth.tiene(P.VIAJES_REGISTRAR)) { <a routerLink="/viajes" class="boton primario"><app-icono nombre="mas" [tam]="16" />Registrar viaje</a> }
        @if (auth.tiene(P.RNDC_OPERAR)) { <a routerLink="/manifiestos" class="boton claro"><app-icono nombre="documento" [tam]="16" />Manifiestos</a> }
        <a routerLink="/monitoreo" class="boton claro"><app-icono nombre="ubicacion" [tam]="16" />Monitoreo</a>
      </div>
    </section>

    <!-- Indicadores del mes -->
    <section class="kpis" aria-label="Indicadores del mes">
      <article class="kpi">
        <header><span>Viajes del mes</span><app-icono nombre="camion" [tam]="18" /></header>
        <strong>{{ r()?.mes?.viajes ?? 0 }}</strong>
        <footer>@if (variacion('viajes'); as v) { <span class="tend" [class.sube]="v.n > 0" [class.baja]="v.n < 0">{{ v.n > 0 ? '▲' : v.n < 0 ? '▼' : '■' }} {{ abs(v.n) }} %</span> } vs. el mismo corte del mes anterior</footer>
      </article>
      <article class="kpi">
        <header><span>Facturable del mes</span><app-icono nombre="dinero" [tam]="18" /></header>
        <strong>{{ r()?.mes?.tarifa | pesos }}</strong>
        <footer>@if (variacion('tarifa'); as v) { <span class="tend" [class.sube]="v.n > 0" [class.baja]="v.n < 0">{{ v.n > 0 ? '▲' : v.n < 0 ? '▼' : '■' }} {{ abs(v.n) }} %</span> } tarifas a clientes</footer>
      </article>
      <article class="kpi">
        <header><span>Fletes a conductores</span><app-icono nombre="personas" [tam]="18" /></header>
        <strong>{{ r()?.mes?.flete | pesos }}</strong>
        <footer>Anticipos {{ r()?.mes?.anticipo | pesos }}</footer>
      </article>
      <article class="kpi destacado">
        <header><span>Margen del mes</span><app-icono nombre="lista" [tam]="18" /></header>
        <strong>{{ margen() | pesos }}</strong>
        <footer>{{ margenPct() }} % sobre lo facturable</footer>
      </article>
    </section>

    <div class="rejilla">
      <!-- Tendencia -->
      <section class="panel grafico">
        <header class="cab"><div><h2>Últimos 14 días</h2><p>Viajes registrados por día</p></div>
          <span class="total">{{ totalDias() }} viajes</span></header>
        <div class="barras" role="img" [attr.aria-label]="'Viajes por día en los últimos 14 días: ' + totalDias()">
          @for (d of dias(); track d.dia) {
            <div class="col" [title]="etiquetaDia(d.dia) + ': ' + d.viajes + ' viajes'">
              <span class="v">{{ d.viajes || '' }}</span>
              <span class="b" [class.hoy]="$last" [style.height.%]="altura(d.viajes)"></span>
              <span class="d">{{ etiquetaDia(d.dia) }}</span>
            </div>
          }
        </div>
      </section>

      <!-- Atención -->
      <section class="panel atencion">
        <header class="cab"><div><h2>Requiere atención</h2><p>Lo pendiente, en orden de prioridad</p></div></header>
        <ul class="tareas">
          <li [class.vacia]="!r()?.rechazos"><a [routerLink]="rutaRndc()"><span class="ico rojo"><app-icono nombre="alerta" [tam]="16" /></span>
            <span class="tx"><strong>Rechazos del RNDC</strong><small>Corregir y reenviar</small></span><span class="num">{{ r()?.rechazos || 0 }}</span></a></li>
          <li [class.vacia]="!pendientes()"><a [routerLink]="rutaRndc()"><span class="ico ambar"><app-icono nombre="enviar" [tam]="16" /></span>
            <span class="tx"><strong>Por manifestar</strong><small>Remesa y manifiesto sin enviar</small></span><span class="num">{{ pendientes() }}</span></a></li>
          <li [class.vacia]="!(r()?.estados?.manifestado)"><a [routerLink]="rutaRndc()"><span class="ico gris"><app-icono nombre="reloj" [tam]="16" /></span>
            <span class="tx"><strong>Manifestados sin cumplir</strong><small>Registrar el cumplido</small></span><span class="num">{{ r()?.estados?.manifestado || 0 }}</span></a></li>
          <li [class.vacia]="!vencidos()"><a href="#documentos" (click)="irDocumentos($event)"><span class="ico rojo"><app-icono nombre="candado" [tam]="16" /></span>
            <span class="tx"><strong>Documentos vencidos</strong><small>SOAT, tecnomecánica o licencia</small></span><span class="num">{{ vencidos() }}</span></a></li>
          <li [class.vacia]="!porVencer()"><a href="#documentos" (click)="irDocumentos($event)"><span class="ico ambar"><app-icono nombre="reloj" [tam]="16" /></span>
            <span class="tx"><strong>Vencen en 30 días</strong><small>Avisar a tiempo</small></span><span class="num">{{ porVencer() }}</span></a></li>
        </ul>
      </section>

      <!-- Flujo RNDC -->
      <section class="panel flujo">
        <header class="cab"><div><h2>Estado de los documentos</h2><p>Viajes activos según su avance en el RNDC</p></div></header>
        <ol class="etapas">
          @for (e of etapas(); track e.clave) {
            <li><a [routerLink]="rutaRndc()"><span class="n">{{ e.n }}</span><span class="t">{{ e.texto }}</span>
              <span class="prog"><span [style.width.%]="e.pct"></span></span></a></li>
          }
        </ol>
      </section>

      <!-- Clientes -->
      <section class="panel clientes">
        <header class="cab"><div><h2>Principales clientes</h2><p>Facturable del mes</p></div><a routerLink="/clientes" class="ver">Ver clientes</a></header>
        @if (r()?.clientes?.length) {
          <ul class="ranking">
            @for (c of r()!.clientes; track c.nombre; let i = $index) {
              <li><span class="pos">{{ i + 1 }}</span>
                <div class="info"><div class="fila"><strong>{{ c.nombre }}</strong><span>{{ c.tarifa | pesos }}</span></div>
                  <span class="prog"><span [style.width.%]="pctCliente(c.tarifa)"></span></span>
                  <small>{{ c.viajes }} viaje(s)</small></div></li>
            }
          </ul>
        } @else { <p class="vacio-p">Aún no hay viajes este mes.</p> }
      </section>

      <!-- Últimos viajes -->
      <section class="panel ultimos">
        <header class="cab"><div><h2>Últimos viajes</h2><p>Lo más reciente de la operación</p></div><a routerLink="/viajes" class="ver">Ver todos</a></header>
        <ul class="viajes">
          @for (v of r()?.ultimos || []; track v._id) {
            <li><span class="placa">{{ v.placa }}</span>
              <div class="info"><strong>{{ v.cliente || 'Sin cliente' }} · {{ v.destino }}</strong><small>N° {{ v.numero }} · {{ v.fecha | dia }} · {{ v.conductor || 'Sin conductor' }}</small></div>
              <span [class]="claseEstado(v)">{{ textoEstado(v) }}</span></li>
          } @empty { <li class="vacio-p">Sin viajes registrados.</li> }
        </ul>
      </section>

      <!-- Documentos -->
      <section class="panel documentos" id="documentos">
        <header class="cab"><div><h2>Documentos por vencer</h2><p>Licencias, SOAT y tecnomecánica · vencidos y próximos 30 días</p></div>
          @if (alertas().length) { <input type="search" class="buscar" placeholder="Placa, conductor o documento" aria-label="Buscar en documentos" [value]="q()" (input)="q.set($any($event.target).value)" /> }</header>
        @if (alertas().length) {
          <div class="docs">
            @for (a of alertasVisibles(); track $index) {
              <div class="doc" [class.vencido]="vencido(a.vence)">
                <span class="tipo">{{ a.tipo }}</span><strong>{{ a.referencia }}</strong>
                <span class="fecha-doc">{{ vencido(a.vence) ? 'Venció' : 'Vence' }} {{ a.vence | dia }}</span></div>
            }
          </div>
          @if (alertasFiltradas().length > alertasVisibles().length) {
            <div class="pie"><span>{{ alertasVisibles().length }} de {{ alertasFiltradas().length }}</span><button class="pequeno" (click)="limite.set(limite() + 24)">Ver más</button></div>
          }
        } @else { <p class="vacio-p"><strong>Todo al día.</strong> No hay documentos vencidos ni por vencer.</p> }
      </section>
    </div>`,
  styles: [`
    :host { display: block; }
    /* Encabezado oscuro con acento amarillo (igual en tema claro y oscuro) */
    .hero { position: relative; overflow: hidden; display: grid; grid-template-columns: 1fr auto; gap: 18px 28px; align-items: end;
      padding: 26px 28px; border-radius: 20px; background: #0f0e0c; color: #f4f1ea; margin-bottom: 18px; }
    .hero::after { content: ''; position: absolute; right: -80px; top: -120px; width: 340px; height: 340px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255,194,14,.28), rgba(255,194,14,0) 70%); pointer-events: none; }
    .hero-txt { position: relative; z-index: 1; }
    .fecha { margin: 0; color: #ffc20e; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .hero h1 { margin: 6px 0 2px; font-size: clamp(24px, 3vw, 34px); letter-spacing: -.02em; color: #fff; }
    .empresa { margin: 0; color: #b9b3a5; }
    .hero-datos { position: relative; z-index: 1; display: flex; gap: 10px; }
    .dato { display: flex; flex-direction: column; min-width: 104px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1); color: inherit; text-decoration: none; transition: background var(--transicion); }
    .dato:hover { background: rgba(255,255,255,.12); }
    .dato .n { font-size: 26px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; color: #fff; }
    .dato .t { font-size: 12px; color: #b9b3a5; }
    .dato.rojo { border-color: rgba(255,120,100,.55); } .dato.rojo .n { color: #ff8a75; }
    .hero-acciones { position: relative; z-index: 1; grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
    .boton.claro { background: rgba(255,255,255,.08); color: #f4f1ea; border-color: rgba(255,255,255,.18); }
    .boton.claro:hover { background: rgba(255,255,255,.16); }

    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .kpi { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); }
    .kpi header { display: flex; justify-content: space-between; align-items: center; color: var(--gris-5); font-size: 13px; font-weight: 600; }
    .kpi strong { font-size: 26px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .kpi footer { font-size: 12px; color: var(--gris-5); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .kpi.destacado { background: var(--primario-claro); border-color: var(--primario-borde); }
    .tend { font-weight: 700; padding: 1px 6px; border-radius: 6px; background: var(--gris-1); }
    .tend.sube { color: var(--verde); background: var(--verde-claro); } .tend.baja { color: var(--rojo); background: var(--rojo-claro); }

    .rejilla { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
    .panel { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 18px; min-width: 0; }
    .grafico { grid-column: span 8; } .atencion { grid-column: span 4; }
    .flujo, .clientes, .ultimos { grid-column: span 4; }
    .documentos { grid-column: 1 / -1; }
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .cab h2 { margin: 0; font-size: 16px; } .cab p { margin: 2px 0 0; font-size: 12.5px; color: var(--gris-5); }
    .cab .total { font-weight: 700; font-size: 14px; } .ver { font-size: 13px; font-weight: 600; color: var(--primario-texto); }

    .barras { display: grid; grid-template-columns: repeat(14, 1fr); gap: 6px; align-items: end; height: 200px; }
    .col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 4px; min-width: 0; }
    .col .v { font-size: 11px; color: var(--gris-5); font-variant-numeric: tabular-nums; min-height: 14px; }
    .col .b { width: 100%; max-width: 34px; min-height: 3px; border-radius: 6px 6px 2px 2px; background: var(--gris-2); transition: height .4s ease, background var(--transicion); }
    .col:hover .b { background: var(--primario-borde); } .col .b.hoy { background: var(--primario); }
    .col .d { font-size: 10.5px; color: var(--gris-4); white-space: nowrap; }

    .tareas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .tareas a { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 12px; color: inherit; text-decoration: none; transition: background var(--transicion); }
    .tareas a:hover { background: var(--gris-1); }
    .tareas li.vacia { opacity: .5; }
    .ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; flex: none; }
    .ico.rojo { background: var(--rojo-claro); color: var(--rojo); } .ico.ambar { background: var(--ambar-claro); color: var(--ambar); } .ico.gris { background: var(--gris-1); color: var(--gris-7); }
    .tx { display: flex; flex-direction: column; flex: 1; min-width: 0; } .tx strong { font-size: 14px; } .tx small { color: var(--gris-5); font-size: 12px; }
    .num { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }

    .etapas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
    .etapas a { display: grid; grid-template-columns: 56px 1fr; column-gap: 12px; align-items: center; color: inherit; text-decoration: none; }
    .etapas .n { grid-row: span 2; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .etapas .t { font-size: 13.5px; font-weight: 600; }
    .prog { display: block; height: 7px; border-radius: 99px; background: var(--gris-15); overflow: hidden; margin-top: 5px; }
    .prog span { display: block; height: 100%; border-radius: 99px; background: var(--primario); transition: width .5s ease; }

    .ranking { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .ranking li { display: flex; gap: 12px; align-items: flex-start; }
    .pos { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--gris-1); font-size: 12px; font-weight: 700; flex: none; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .info .fila { display: flex; justify-content: space-between; gap: 8px; font-size: 13.5px; }
    .info .fila strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .info small { color: var(--gris-5); font-size: 12px; }

    .viajes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .viajes li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--gris-15); }
    .viajes li:last-child { border-bottom: 0; }
    .placa { font-size: 12px; font-weight: 700; padding: 3px 7px; border-radius: 6px; background: var(--primario); color: #0f0e0c; letter-spacing: .03em; flex: none; }
    .viajes .info strong { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .buscar { max-width: 280px; min-height: 36px; }
    .docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
    .doc { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--ambar-borde); background: var(--ambar-claro); min-width: 0; }
    .doc.vencido { border-color: var(--rojo-borde); background: var(--rojo-claro); }
    .doc .tipo { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--gris-5); }
    .doc strong { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fecha-doc { font-size: 12px; color: var(--ambar-texto); } .doc.vencido .fecha-doc { color: var(--rojo-texto); }
    .pie { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 13px; color: var(--gris-5); }
    .vacio-p { margin: 0; color: var(--gris-5); font-size: 13.5px; }

    @media (max-width: 1180px) {
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grafico, .atencion, .ultimos { grid-column: 1 / -1; } .flujo, .clientes { grid-column: span 6; }
    }
    @media (max-width: 720px) {
      .hero { grid-template-columns: 1fr; padding: 20px 18px; } .hero-datos { flex-wrap: wrap; } .dato { min-width: 0; flex: 1 1 90px; }
      .kpis { gap: 10px; } .kpi strong { font-size: 20px; }
      .flujo, .clientes { grid-column: 1 / -1; }
      .barras { height: 160px; gap: 3px; } .col .d { font-size: 9px; writing-mode: vertical-rl; transform: rotate(180deg); } .col .v { display: none; }
    }
  `],
})
export class Inicio {
  private api = inject(Api);
  readonly auth = inject(Auth);
  readonly P = P;
  readonly r = signal<any>(null);
  readonly alertas = signal<any[]>([]);
  readonly limite = signal(12);
  readonly q = signal('');
  readonly alertasFiltradas = computed(() => filtrar(this.alertas(), this.q()));
  readonly alertasVisibles = computed(() => this.alertasFiltradas().slice(0, this.limite()));
  readonly vencidos = computed(() => this.alertas().filter(a => this.vencido(a.vence)).length);
  readonly porVencer = computed(() => this.alertas().length - this.vencidos());
  readonly dias = computed<any[]>(() => this.r()?.dias || []);
  readonly totalDias = computed(() => this.dias().reduce((s, d) => s + d.viajes, 0));
  private readonly maxDia = computed(() => Math.max(1, ...this.dias().map(d => d.viajes)));
  readonly margen = computed(() => (this.r()?.mes?.tarifa || 0) - (this.r()?.mes?.flete || 0));
  readonly margenPct = computed(() => { const t = this.r()?.mes?.tarifa || 0; return t ? Math.round((this.margen() / t) * 100) : 0; });
  readonly etapas = computed(() => {
    const e = this.r()?.estados || {};
    const lista = [['registrado', 'Registrados sin remesa'], ['remesa', 'Con remesa, sin manifiesto'], ['manifestado', 'Manifestados sin cumplir']]
      .map(([clave, texto]) => ({ clave, texto, n: e[clave] || 0 }));
    const max = Math.max(1, ...lista.map(x => x.n));
    return lista.map(x => ({ ...x, pct: Math.round((x.n / max) * 100) }));
  });
  readonly hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  constructor() { this.cargar(); }
  cargar() {
    this.api.get('/viajes/resumen').then(x => this.r.set(x)).catch(() => {});
    this.api.get<any[]>('/maestros/alertas').then(x => this.alertas.set([...x].sort((a, b) => +new Date(a.vence) - +new Date(b.vence)))).catch(() => {});
  }
  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['viajes', 'rndc', 'maestros'], () => this.cargar());
  primerNombre() { return (this.auth.usuario()?.nombre || '').split(' ')[0]; }
  saludo() { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches'; }
  pendientes() { const e = this.r()?.estados || {}; return (e.registrado || 0) + (e.remesa || 0); }
  rutaRndc() { return this.auth.tiene(P.RNDC_OPERAR) ? '/manifiestos' : '/viajes'; }
  vencido(f: string) { return new Date(f) < new Date(); }
  abs(n: number) { return Math.abs(n); }
  altura(n: number) { return Math.max(2, Math.round((n / this.maxDia()) * 100)); }
  etiquetaDia(d: string) { return new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', ''); }
  pctCliente(t: number) { const max = this.r()?.clientes?.[0]?.tarifa || 1; return Math.max(3, Math.round((t / max) * 100)); }
  // Variación porcentual frente al mismo corte del mes anterior (sin base, no se muestra)
  variacion(campo: 'viajes' | 'tarifa'): { n: number } | null {
    const a = this.r()?.mes?.[campo] || 0; const b = this.r()?.mesAnterior?.[campo] || 0;
    return b ? { n: Math.round(((a - b) / b) * 100) } : null;
  }
  textoEstado(v: any) { return v.sinManifiesto ? 'Sin manifiesto' : ESTADOS[v.estado]?.[0] || v.estado; }
  claseEstado(v: any) { return 'chip ' + (v.sinManifiesto ? '' : ESTADOS[v.estado]?.[1] || ''); }
  irDocumentos(e: Event) { e.preventDefault(); document.getElementById('documentos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
