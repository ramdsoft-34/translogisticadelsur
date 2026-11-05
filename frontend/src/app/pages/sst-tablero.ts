import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { FORMATOS } from '../shared/formato';
import { PerfilSst } from '../shared/perfil-sst';
import { HojaVidaPesv } from '../shared/hoja-vida-pesv';

const NIVEL_PESV: Record<string, string> = { basico: 'Básico', estandar: 'Estándar', avanzado: 'Avanzado' };
const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];

// Tablero del SG-SST y del PESV: lo que vence, lo que pasó hoy en la vía y cómo va el cumplimiento.
@Component({
  selector: 'app-sst-tablero',
  imports: [RouterLink, Icono, PerfilSst, HojaVidaPesv, ...FORMATOS],
  template: `
    <section class="hero">
      <div class="hero-txt">
        <p class="fecha">{{ hoy }}</p>
        <h1>Seguridad y salud en el trabajo y seguridad vial</h1>
        <p class="empresa">{{ r()?.empresa?.nombre }}
          @if (r()?.empresa?.arl) { · ARL {{ r()!.empresa.arl }} } @if (r()?.empresa?.claseRiesgo) { · Riesgo {{ romano(r()!.empresa.claseRiesgo) }} }
          @if (r()?.empresa?.nivelPesv) { · PESV {{ nivelPesv(r()!.empresa.nivelPesv) }} }</p>
      </div>
      <div class="hero-datos">
        <a class="dato" [class.rojo]="(r()?.alertas?.vencido || 0) > 0" href="#vencimientos"><span class="n">{{ r()?.alertas?.vencido ?? '—' }}</span><span class="t">vencidos</span></a>
        <a class="dato" routerLink="/sst/preoperacionales"><span class="n">{{ r()?.preoperacional?.hoy ?? '—' }}<small>/{{ r()?.preoperacional?.conViaje ?? 0 }}</small></span><span class="t">checklists hoy / vehículos con viaje</span></a>
        <a class="dato" [class.rojo]="(r()?.preoperacional?.noAptos?.length || 0) > 0" routerLink="/sst/preoperacionales"><span class="n">{{ r()?.preoperacional?.noAptos?.length ?? '—' }}</span><span class="t">no aptos hoy</span></a>
      </div>
      <div class="hero-acciones">
        <a routerLink="/sst/formatos" class="boton primario"><app-icono nombre="documento" [tam]="16" />Diligenciar un formato</a>
        <a routerLink="/sst/preoperacionales" class="boton"><app-icono nombre="check" [tam]="16" />Preoperacionales</a>
        <a routerLink="/sst/personas" class="boton"><app-icono nombre="personas" [tam]="16" />Personas</a>
        @if (auth.tiene(P.SST_GESTIONAR)) { <a routerLink="/sst/empresa" class="boton"><app-icono nombre="edificio" [tam]="16" />Datos y membrete</a> }
      </div>
    </section>

    <section class="kpis" aria-label="Cumplimiento">
      <article class="kpi">
        <header><span>Estándares mínimos (Res. 0312)</span><app-icono nombre="escudo" [tam]="18" /></header>
        <strong>{{ pct(r()?.empresa?.puntaje0312) }}</strong>
        <span class="prog"><span [style.width.%]="r()?.empresa?.puntaje0312 || 0" [class]="clasePuntaje(r()?.empresa?.puntaje0312)"></span></span>
        <footer>{{ valoracion(r()?.empresa?.puntaje0312) }} @if (r()?.empresa?.fechaEvaluacion0312) { · {{ r()!.empresa.fechaEvaluacion0312 | dia }} }</footer>
      </article>
      <article class="kpi">
        <header><span>PESV (Res. 40595)</span><app-icono nombre="camion" [tam]="18" /></header>
        <strong>{{ pct(r()?.empresa?.puntajePesv) }}</strong>
        <span class="prog"><span [style.width.%]="r()?.empresa?.puntajePesv || 0" [class]="clasePuntaje(r()?.empresa?.puntajePesv)"></span></span>
        <footer>Nivel {{ nivelPesv(r()?.empresa?.nivelPesv) || 'sin definir' }} · {{ r()?.vehiculos ?? 0 }} vehículos</footer>
      </article>
      <article class="kpi">
        <header><span>Capacitaciones del año</span><app-icono nombre="lista" [tam]="18" /></header>
        <strong>{{ r()?.capacitaciones?.cumplimiento ?? '—' }}{{ r()?.capacitaciones?.cumplimiento != null ? ' %' : '' }}</strong>
        <span class="prog"><span [style.width.%]="r()?.capacitaciones?.cumplimiento || 0"></span></span>
        <footer>{{ r()?.capacitaciones?.ejecutadas ?? 0 }} de {{ r()?.capacitaciones?.programadas ?? 0 }} ejecutadas</footer>
      </article>
      <article class="kpi destacado">
        <header><span>Colaboradores</span><app-icono nombre="personas" [tam]="18" /></header>
        <strong>{{ r()?.colaboradores?.total ?? 0 }}</strong>
        <footer>{{ r()?.colaboradores?.conductores ?? 0 }} conductores · {{ r()?.colaboradores?.directos ?? 0 }} directos · {{ r()?.registrosMes ?? 0 }} formatos este mes</footer>
      </article>
    </section>

    <app-perfil-sst #perfil />
    <app-hoja-vida-pesv #pesv />
    <div class="rejilla">
      <section class="panel vencimientos" id="vencimientos">
        <header class="cab"><div><h2>Vencimientos</h2><p>Documentos del vehículo, licencias, exámenes, EPP y mantenimiento</p></div>
          <div class="leyenda"><span class="chip error sin-punto">{{ r()?.alertas?.vencido ?? 0 }} vencidos</span><span class="chip alerta sin-punto">{{ r()?.alertas?.semana ?? 0 }} esta semana</span><span class="chip sin-punto">{{ r()?.alertas?.mes ?? 0 }} en 30 días</span></div></header>
        @if (r()?.alertas?.lista?.length) {
          <div class="docs">
            @for (a of r()!.alertas.lista.slice(0, todos() ? 40 : 12); track $index) {
              <button type="button" class="doc" [class.vencido]="a.nivel === 'vencido'" [class.mes]="a.nivel === 'mes'" (click)="abrirAlerta(a)" [title]="a.placa ? 'Abrir mantenimiento y PESV del vehículo' : 'Abrir SST y PESV de la persona'">
                <span class="tipo">{{ a.tipo }}</span>
                <strong>@if (a.placa) { <span class="placa">{{ a.placa }}</span> } @else { {{ a.quien }} }</strong>
                @if (a.detalle) { <small>{{ a.detalle }}</small> }
                <span class="fecha-doc">{{ textoDias(a) }}</span>
              </button>
            }
          </div>
          @if (r()!.alertas.lista.length > 12) { <button type="button" class="pequeno" style="margin-top:10px" (click)="todos.set(!todos())">{{ todos() ? 'Ver menos' : 'Ver los ' + r()!.alertas.lista.length }}</button> }
        } @else if (cargando()) { <span class="esqueleto"></span> } @else { <p class="vacio-p">Nada vence en los próximos 30 días.</p> }
      </section>

      <section class="panel hoy-panel">
        <header class="cab"><div><h2>Checklist de hoy</h2><p>Lo que hicieron los conductores en Sur Track</p></div><a routerLink="/sst/preoperacionales" class="ver">Ver todos</a></header>
        <ul class="tareas">
          @for (n of r()?.preoperacional?.noAptos || []; track n._id) {
            <li><a routerLink="/sst/preoperacionales"><span class="ico rojo"><app-icono nombre="alerta" [tam]="16" /></span>
              <span class="tx"><strong><span class="placa">{{ n.placa }}</span> no apto</strong><small>{{ n.conductor }} · {{ n.fecha | fechaHora }}</small></span></a></li>
          }
          <li [class.vacia]="!r()?.preoperacional?.aptos"><a routerLink="/sst/preoperacionales"><span class="ico verde"><app-icono nombre="check" [tam]="16" /></span>
            <span class="tx"><strong>Aptos para salir</strong><small>Con el checklist completo</small></span><span class="num">{{ r()?.preoperacional?.aptos || 0 }}</span></a></li>
          <li [class.vacia]="!r()?.preoperacional?.sinReporte?.length"><a routerLink="/sst/preoperacionales"><span class="ico ambar"><app-icono nombre="reloj" [tam]="16" /></span>
            <span class="tx"><strong>Con viaje hoy y sin checklist</strong><small>{{ sinReporte() }}</small></span><span class="num">{{ r()?.preoperacional?.sinReporte?.length || 0 }}</span></a></li>
        </ul>
        <p class="pie-mes">Este mes: {{ r()?.preoperacional?.mes?.aptos || 0 }} aptos y {{ r()?.preoperacional?.mes?.noAptos || 0 }} no aptos.</p>
      </section>

      <section class="panel pesv">
        <header class="cab"><div><h2>Indicadores del PESV con Sur Track</h2><p>Velocidad, manejo seguido, checklist y kilómetros del mes</p></div>
          <input type="month" [value]="mes()" (change)="cambiarMes($any($event.target).value)" aria-label="Mes" /></header>
        @if (ind(); as i) {
          <div class="indic">
            <div><span>Viajes con checklist del día</span><b [class.malo]="(i.checklist.pct ?? 100) < 90">{{ i.checklist.pct ?? '—' }}{{ i.checklist.pct != null ? ' %' : '' }}</b><small>{{ i.checklist.conChecklist }} de {{ i.viajes }} viajes</small></div>
            <div><span>Excesos de velocidad (más de {{ i.limite }} km/h)</span><b [class.malo]="i.excesos.total > 0">{{ i.excesos.total }}</b><small>{{ i.excesos.por100 ?? 0 }} por cada 100 viajes con rastreo</small></div>
            <div><span>Manejo seguido de más de {{ i.horasConduccion }} h</span><b [class.malo]="i.fatiga.total > 0">{{ i.fatiga.total }}</b><small>viajes sin pausa suficiente</small></div>
            <div><span>Kilómetros con Sur Track</span><b>{{ i.kmTotal | miles }}</b><small>{{ i.km.length }} vehículos · {{ i.incidentes }} incidente(s) reportado(s)</small></div>
          </div>
          <div class="dos-listas">
            <div><h3>Más excesos</h3>
              <ul class="mini">@for (e of i.excesos.lista.slice(0, 6); track e.numero) { <li><span class="chip error sin-punto">{{ e.velocidad }} km/h</span><span>{{ e.conductor }} · <span class="placa">{{ e.placa }}</span> · {{ e.fecha | dia }}</span></li> }
                @empty { <li class="sutil">Sin excesos este mes.</li> }</ul></div>
            <div><h3>Manejo seguido más largo</h3>
              <ul class="mini">@for (f of i.fatiga.lista.slice(0, 6); track f.numero) { <li><span class="chip alerta sin-punto">{{ horas(f.minutos) }}</span><span>{{ f.conductor }} · <span class="placa">{{ f.placa }}</span> · {{ f.fecha | dia }}</span></li> }
                @empty { <li class="sutil">Ningún viaje pasó el límite.</li> }</ul></div>
          </div>
        } @else { <span class="esqueleto"></span> }
      </section>

      <section class="panel proximas">
        <header class="cab"><div><h2>Próximas capacitaciones</h2><p>Programa anual SST y PESV</p></div><a routerLink="/sst/capacitaciones" class="ver">Programa</a></header>
        @if (r()?.capacitaciones?.proximas?.length) {
          <ul class="lista-cap">
            @for (c of r()!.capacitaciones.proximas; track c._id) {
              <li><span class="dia"><b>{{ diaNum(c.fecha) }}</b><small>{{ mesCorto(c.fecha) }}</small></span>
                <span class="tx"><strong>{{ c.tema }}</strong><small>{{ c.horas }} h · {{ c.eje === 'pesv' ? 'Seguridad vial' : c.eje === 'ambos' ? 'SST y vial' : 'SST' }}</small></span></li>
            }
          </ul>
        } @else { <p class="vacio-p">No hay capacitaciones programadas.</p> }
      </section>

      <section class="panel ciclo">
        <header class="cab"><div><h2>Ciclo PHVA</h2><p>Dónde está cada parte del sistema en la plataforma</p></div></header>
        <ol class="phva">
          <li><b>Planear</b><span>Datos de la empresa, política, objetivos, matriz legal y plan anual</span><a routerLink="/sst/formatos">Formatos</a></li>
          <li><b>Hacer</b><span>Capacitaciones, EPP, exámenes, checklists de Sur Track y mantenimiento</span><a routerLink="/sst/personas">Personas</a></li>
          <li><b>Verificar</b><span>Preoperacionales, indicadores del PESV y autoevaluación de estándares</span><a routerLink="/sst/preoperacionales">Preoperacionales</a></li>
          <li><b>Actuar</b><span>Hallazgos, planes de acción y compromisos de las actas</span><a routerLink="/sst/formatos">Actas</a></li>
        </ol>
      </section>
    </div>`,
  styles: [`
    :host { display: block; }
    .hero { display: grid; grid-template-columns: 1fr auto; gap: 18px 28px; align-items: end; padding: 4px 0 24px; margin-bottom: 22px; border-bottom: 1px solid var(--gris-2); }
    .fecha { margin: 0; color: var(--primario-texto); font-size: 13px; font-weight: 700; } .fecha::first-letter { text-transform: uppercase; }
    .hero h1 { margin: 6px 0 4px; font-size: clamp(26px, 3vw, 36px); letter-spacing: -.035em; font-weight: 800; max-width: 760px; }
    .empresa { margin: 0; color: var(--gris-5); font-weight: 500; }
    .hero-datos { display: flex; background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: 14px; overflow: hidden; }
    .dato { display: flex; flex-direction: column; min-width: 120px; padding: 12px 18px; color: inherit; text-decoration: none; }
    .dato + .dato { border-left: 1px solid var(--gris-2); } .dato:hover { background: var(--gris-1); }
    .dato .n { font-size: 26px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; } .dato .n small { font-size: 15px; color: var(--gris-4); font-weight: 600; }
    .dato .t { font-size: 12.5px; color: var(--gris-5); font-weight: 500; } .dato.rojo .n { color: var(--rojo); }
    .hero-acciones { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .kpi { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); }
    .kpi header { display: flex; justify-content: space-between; color: var(--gris-5); font-size: 13px; font-weight: 600; }
    .kpi strong { font-size: 26px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .kpi footer { font-size: 12px; color: var(--gris-5); } .kpi.destacado { background: var(--primario-claro); border-color: var(--primario-borde); }
    .prog { display: block; height: 7px; border-radius: 99px; background: var(--gris-15); overflow: hidden; }
    .prog span { display: block; height: 100%; border-radius: 99px; background: var(--primario); transition: width .5s ease; }
    .prog span.critico { background: var(--rojo); } .prog span.moderado { background: var(--ambar); } .prog span.aceptable { background: var(--verde); }
    .rejilla { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
    .panel { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 18px; min-width: 0; }
    .vencimientos { grid-column: span 8; } .hoy-panel { grid-column: span 4; } .pesv { grid-column: 1 / -1; } .proximas { grid-column: span 5; } .ciclo { grid-column: span 7; }
    button.doc { text-align: left; cursor: pointer; font: inherit; color: inherit; box-shadow: none; min-height: 0; align-items: stretch; } button.doc:hover { filter: brightness(.97); }
    .indic { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .indic div { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: 12px; background: var(--gris-1); }
    .indic span { font-size: 12.5px; color: var(--gris-5); } .indic b { font-size: 24px; } .indic b.malo { color: var(--rojo); } .indic small { font-size: 12px; color: var(--gris-5); }
    .dos-listas { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; } .dos-listas h3 { font-size: 13.5px; margin: 0 0 6px; }
    .mini { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; } .mini li { display: flex; gap: 8px; align-items: center; font-size: 13px; flex-wrap: wrap; }
    @media (max-width: 900px) { .indic { grid-template-columns: 1fr 1fr; } .dos-listas { grid-template-columns: 1fr; } }
    @media (max-width: 1100px) { .kpis { grid-template-columns: 1fr 1fr; } .vencimientos, .hoy-panel, .proximas, .ciclo { grid-column: 1 / -1; } }
    @media (max-width: 700px) { .hero { grid-template-columns: 1fr; } .hero-datos { overflow-x: auto; } .kpis { grid-template-columns: 1fr; } }
    .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .cab h2 { margin: 0; font-size: 16px; } .cab p { margin: 2px 0 0; font-size: 12.5px; color: var(--gris-5); }
    .ver { font-size: 13px; font-weight: 600; color: var(--primario-texto); } .leyenda { display: flex; gap: 6px; flex-wrap: wrap; }
    .docs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
    .doc { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--ambar-borde); background: var(--ambar-claro); min-width: 0; }
    .doc.vencido { border-color: var(--rojo-borde); background: var(--rojo-claro); } .doc.mes { border-color: var(--gris-2); background: var(--gris-1); }
    .doc .tipo { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--gris-5); }
    .doc strong { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .doc small { color: var(--gris-5); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fecha-doc { font-size: 12px; font-weight: 600; color: var(--ambar-texto); } .doc.vencido .fecha-doc { color: var(--rojo-texto); } .doc.mes .fecha-doc { color: var(--gris-6); }
    .placa { font-size: 12px; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: var(--primario); color: #0f0e0c; letter-spacing: .03em; }
    .tareas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .tareas a { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 12px; color: inherit; text-decoration: none; } .tareas a:hover { background: var(--gris-1); }
    .tareas li.vacia { opacity: .5; }
    .ico { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; flex: none; }
    .ico.rojo { background: var(--rojo-claro); color: var(--rojo); } .ico.ambar { background: var(--ambar-claro); color: var(--ambar); } .ico.verde { background: var(--verde-claro); color: var(--verde); }
    .tx { display: flex; flex-direction: column; flex: 1; min-width: 0; } .tx strong { font-size: 14px; } .tx small { color: var(--gris-5); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .num { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .pie-mes { margin: 12px 0 0; font-size: 12.5px; color: var(--gris-5); }
    .lista-cap { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .lista-cap li { display: flex; gap: 12px; align-items: center; }
    .dia { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 12px; background: var(--tinta); color: #fff; flex: none; }
    .dia b { font-size: 17px; line-height: 1; } .dia small { font-size: 10.5px; text-transform: uppercase; color: var(--primario); font-weight: 700; }
    .phva { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 700px) { .phva { grid-template-columns: 1fr 1fr; } }
    .phva li { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; background: var(--gris-1); border-top: 3px solid var(--primario); }
    .phva b { font-size: 14px; } .phva span { font-size: 12.5px; color: var(--gris-6); flex: 1; } .phva a { font-size: 12.5px; font-weight: 600; color: var(--primario-texto); }
    .vacio-p { color: var(--gris-5); margin: 8px 0; }
  `],
})
export class SstTablero {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly auth = inject(Auth);
  readonly P = P;
  readonly r = signal<any>(null);
  readonly cargando = signal(true);
  readonly todos = signal(false);
  readonly hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  readonly sinReporte = computed(() => { const l: string[] = this.r()?.preoperacional?.sinReporte || []; return l.length ? l.slice(0, 6).join(', ') + (l.length > 6 ? ` y ${l.length - 6} más` : '') : 'Todos reportaron'; });

  private perfil = viewChild.required(PerfilSst);
  private pesv = viewChild.required(HojaVidaPesv);
  readonly ind = signal<any>(null);
  readonly mes = signal(new Date().toISOString().slice(0, 7));
  constructor() { this.cargar(); this.cargarIndicadores(); }
  async cargar() {
    try { this.r.set(await this.api.get('/sst/resumen')); } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  async cargarIndicadores() { try { this.ind.set(await this.api.get('/sst/indicadores', { mes: this.mes() })); } catch (e) { this.avisos.error(e); } }
  cambiarMes(m: string) { if (m) { this.mes.set(m); this.ind.set(null); this.cargarIndicadores(); } }
  horas = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
  abrirAlerta(a: any) { if (a.persona?.id) this.perfil().abrir(a.persona.tipo, a.persona.id); else if (a.ref) this.pesv().abrir(a.ref); }
  romano = (n: number) => ROMANOS[n] || '';
  nivelPesv = (n: string) => NIVEL_PESV[n] || '';
  pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 10) / 10} %`);
  // Res. 0312: menos de 60 % crítico, 60 a 85 % moderadamente aceptable, más de 85 % aceptable
  clasePuntaje = (n: number | null | undefined) => (n == null ? '' : n < 60 ? 'critico' : n <= 85 ? 'moderado' : 'aceptable');
  valoracion = (n: number | null | undefined) => (n == null ? 'Sin autoevaluación registrada' : n < 60 ? 'Crítico: plan de mejoramiento inmediato' : n <= 85 ? 'Moderadamente aceptable' : 'Aceptable');
  textoDias(a: any) {
    if (a.dias == null) return a.nivel === 'vencido' ? 'Pasado de kilómetros' : 'Cerca del kilometraje';
    return a.dias < 0 ? `Venció hace ${-a.dias} día${a.dias === -1 ? '' : 's'}` : a.dias === 0 ? 'Vence hoy' : `Vence en ${a.dias} día${a.dias === 1 ? '' : 's'}`;
  }
  diaNum = (f: string) => new Date(f).getUTCDate();
  mesCorto = (f: string) => ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][new Date(f).getUTCMonth()];
}
