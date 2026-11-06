import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, mensajeError } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from '../shared/icono';
import { FORMATOS } from '../shared/formato';
import { ESTILOS_SST, EstadoVence, NIVELES_PESV, TEXTO_GRUPO, EJES } from './sst-comun';

interface Item { tipo: string; titulo: string; placa: string; detalle: string; vence: string | null; estado: EstadoVence; texto: string }
interface Tablero {
  empresa: { nombre: string; arl: string; claseRiesgo: string; nivelPesv: string };
  indicadores: { vencidos: number; preoperacionalesHoy: { hechos: number; total: number } | null; noAptosHoy: number | null };
  autoevaluacion: { estandares: { valor: number | null; fecha: string | null }; pesv: { valor: number | null; fecha: string | null } };
  flota: { vehiculos: number; conductores: number };
  capacitaciones: { programadas: number; ejecutadas: number; aLaFecha: number; cumplimiento: number | null; horas: number };
  colaboradores: { total: number; conductores: number; directos: number; formatosMes: number };
  vencimientos: { resumen: { vencidos: number; semana: number; mes: number }; items: Item[]; total: number };
  preoperacional: { usaApp: boolean; aptos: number; noAptos: { placa: string; conductor: string; fecha: string; checklistId: string; autorizado: boolean }[];
    sinPreoperacional: string[]; mes: { aptos: number; noAptos: number } | null };
  proximasCapacitaciones: { id: string; fecha: string; tema: string; horas: number; eje: string }[];
  incidentesSinRevisar: number;
  datosCompletos: boolean;
}
const fechaLarga = () => { const t = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); return t.charAt(0).toUpperCase() + t.slice(1); };
const MES = (f: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', month: 'short' }).format(new Date(f)).replace('.', '').toUpperCase();
const DIA = (f: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric' }).format(new Date(f));

// Tablero de SG-SST y PESV. Todo sale de datos reales: lo que no tiene datos se ve vacío, sin números de ejemplo.
// La plataforma organiza y guarda evidencia; no certifica el cumplimiento de la norma.
@Component({
  selector: 'app-sst-tablero',
  imports: [RouterLink, Icono, ...FORMATOS],
  template: `
    @if (t(); as d) {
      <div class="cab-tablero">
        <div>
          <p class="fecha">{{ hoy }}</p>
          <h1>Seguridad y salud en el trabajo y seguridad vial</h1>
          <p class="sutil">{{ d.empresa.nombre }}@if (d.empresa.arl) { · ARL {{ d.empresa.arl }} }@if (d.empresa.claseRiesgo) { · Riesgo {{ d.empresa.claseRiesgo }} }@if (d.empresa.nivelPesv) { · PESV {{ NIVELES[d.empresa.nivelPesv] }} }</p>
        </div>
        <div class="contadores" aria-label="Hoy">
          <a routerLink="/sst/tablero" fragment="vencimientos"><strong [class.rojo]="d.indicadores.vencidos > 0">{{ d.indicadores.vencidos }}</strong><span>vencidos</span></a>
          <a routerLink="/sst/flota" [queryParams]="{ vista: 'inspecciones' }"><strong>@if (d.indicadores.preoperacionalesHoy; as p) { {{ p.hechos }}<small>/{{ p.total }}</small> } @else { — }</strong><span>preoperacionales hoy</span></a>
          <a routerLink="/sst/flota" [queryParams]="{ vista: 'inspecciones', resultado: 'no_apto' }"><strong [class.rojo]="(d.indicadores.noAptosHoy ?? 0) > 0">{{ d.indicadores.noAptosHoy ?? '—' }}</strong><span>no aptos hoy</span></a>
        </div>
      </div>

      <nav class="accesos" aria-label="Accesos">
        <a class="boton primario" routerLink="/sst/formatos"><app-icono nombre="documento" [tam]="16" />Diligenciar un formato</a>
        <a class="boton" routerLink="/sst/flota" [queryParams]="{ vista: 'inspecciones' }"><app-icono nombre="check" [tam]="16" />Preoperacional</a>
        <a class="boton" routerLink="/sst/colaboradores"><app-icono nombre="personas" [tam]="16" />Colaboradores</a>
        <a class="boton" routerLink="/sst/datos"><app-icono nombre="edificio" [tam]="16" />Datos y membrete</a>
      </nav>

      @if (!d.datosCompletos) { <div class="mensaje alerta" role="status"><strong>Complete los datos de SG-SST.</strong> Falta el responsable del SG-SST o la ARL: los formatos salen sin esos datos. <a routerLink="/sst/datos">Ir a Datos y membrete</a></div> }
      @if (d.incidentesSinRevisar) { <div class="mensaje alerta" role="status"><strong>{{ d.incidentesSinRevisar }} reporte(s) de incidente sin revisar</strong> desde la app de conductores. <a routerLink="/sst/formatos" [queryParams]="{ vista: 'reportes' }">Revisar</a></div> }

      <section class="kpis" aria-label="Indicadores">
        <article class="kpi"><header><span>Estándares mínimos</span><app-icono nombre="escudo" [tam]="18" /></header>
          @if (d.autoevaluacion.estandares.valor !== null) { <strong>{{ d.autoevaluacion.estandares.valor }} %</strong>
            <div class="barra-avance"><span [style.width.%]="d.autoevaluacion.estandares.valor"></span></div>
            <footer>Autoevaluación del {{ d.autoevaluacion.estandares.fecha | dia }}</footer> }
          @else { <span class="vacio-kpi">Sin autoevaluación registrada. <a routerLink="/sst/datos">Registrarla</a></span> }</article>
        <article class="kpi"><header><span>PESV</span><app-icono nombre="camion" [tam]="18" /></header>
          @if (d.autoevaluacion.pesv.valor !== null) { <strong>{{ d.autoevaluacion.pesv.valor }} %</strong>
            <div class="barra-avance"><span [style.width.%]="d.autoevaluacion.pesv.valor"></span></div>
            <footer>@if (d.empresa.nivelPesv) { Nivel {{ NIVELES[d.empresa.nivelPesv] }} · }{{ d.flota.vehiculos }} vehículo(s)</footer> }
          @else { <span class="vacio-kpi">Sin autoevaluación registrada. {{ d.flota.vehiculos }} vehículo(s) en la plataforma.</span> }</article>
        <article class="kpi"><header><span>Capacitaciones del año</span><app-icono nombre="lista" [tam]="18" /></header>
          @if (d.capacitaciones.programadas) { <strong>{{ d.capacitaciones.cumplimiento ?? '—' }}{{ d.capacitaciones.cumplimiento !== null ? ' %' : '' }}</strong>
            <div class="barra-avance"><span [style.width.%]="d.capacitaciones.cumplimiento ?? 0"></span></div>
            <footer>{{ d.capacitaciones.ejecutadas }} de {{ d.capacitaciones.aLaFecha }} ejecutadas a la fecha · {{ d.capacitaciones.programadas }} en el programa</footer> }
          @else { <span class="vacio-kpi">Sin programa de capacitación. <a routerLink="/sst/capacitaciones">Programar</a></span> }</article>
        <article class="kpi destacado"><header><span>Colaboradores</span><app-icono nombre="personas" [tam]="18" /></header>
          <strong>{{ d.colaboradores.total }}</strong>
          <footer>{{ d.colaboradores.conductores }} conductores · {{ d.colaboradores.directos }} directos · {{ d.colaboradores.formatosMes }} formato(s) este mes</footer></article>
      </section>

      <div class="dos">
        <section class="tarjeta" id="vencimientos">
          <div class="seccion-cab"><h2>Vencimientos</h2>
            <span class="nota">Documentos del vehículo, licencias, exámenes, EPP y mantenimiento</span></div>
          <div class="acciones resumen">
            <span class="chip error sin-punto">{{ d.vencimientos.resumen.vencidos }} vencidos</span>
            <span class="chip alerta sin-punto">{{ d.vencimientos.resumen.semana }} esta semana</span>
            <span class="chip info sin-punto">{{ d.vencimientos.resumen.mes }} en 30 días</span>
          </div>
          <div class="venc">
            @for (v of (todos() ? d.vencimientos.items : d.vencimientos.items.slice(0, 9)); track $index) {
              <article [class]="'v ' + v.estado">
                <span class="tipo">{{ v.tipo }}</span>
                <strong>@if (v.placa) { <span class="placa">{{ v.placa }}</span> } @else { {{ v.titulo }} }</strong>
                @if (v.detalle) { <span class="det">{{ v.detalle }}</span> }
                <span class="cuando">{{ v.texto }}</span>
              </article>
            } @empty { <p class="sutil">Nada vence en los próximos 30 días.</p> }
          </div>
          @if (d.vencimientos.items.length > 9 && !todos()) { <button class="pequeno" (click)="cargarTodos()">Ver los {{ d.vencimientos.total }}</button> }
        </section>

        <section class="tarjeta">
          <div class="seccion-cab"><h2>Preoperacional de hoy</h2><a routerLink="/sst/flota" [queryParams]="{ vista: 'inspecciones' }">Ver inspecciones</a></div>
          @if (!d.preoperacional.usaApp) { <p class="sutil">Los preoperacionales los hacen los conductores en la app Sur Track. Esta empresa todavía no usa la app.</p> }
          @else {
            <ul class="preo">
              @for (n of d.preoperacional.noAptos; track n.checklistId) {
                <li class="mal"><app-icono nombre="alerta" [tam]="18" /><div><strong><span class="placa">{{ n.placa }}</span> no apto</strong>
                  <small>{{ n.conductor }} · {{ n.fecha | fechaHora }}{{ n.autorizado ? ' · salida autorizada' : '' }}</small></div></li>
              }
              <li class="bien"><app-icono nombre="check" [tam]="18" /><div><strong>Aptos para salir</strong><small>Con el checklist completo</small></div><span class="n">{{ d.preoperacional.aptos }}</span></li>
              <li class="pendiente"><app-icono nombre="reloj" [tam]="18" /><div><strong>Sin preoperacional</strong><small>{{ d.preoperacional.sinPreoperacional.join(', ') || 'Ninguno' }}</small></div><span class="n">{{ d.preoperacional.sinPreoperacional.length }}</span></li>
            </ul>
            @if (d.preoperacional.mes; as m) { <p class="nota">Este mes: {{ m.aptos }} aptos y {{ m.noAptos }} no aptos.</p> }
          }
        </section>
      </div>

      <div class="dos">
        <section class="tarjeta">
          <div class="seccion-cab"><h2>Próximas capacitaciones</h2><a routerLink="/sst/capacitaciones">Programa</a></div>
          <ul class="proximas">
            @for (k of d.proximasCapacitaciones; track k.id) {
              <li><span class="calendario"><b>{{ DIA(k.fecha) }}</b><small>{{ MES(k.fecha) }}</small></span><div><strong>{{ k.tema }}</strong><small>{{ k.horas }} h · {{ EJES[k.eje] }}</small></div></li>
            } @empty { <li class="sutil">Sin capacitaciones programadas.</li> }
          </ul>
        </section>
        <section class="tarjeta">
          <h2>Ciclo PHVA</h2>
          <p class="nota">Dónde está cada parte del sistema en la plataforma.</p>
          <div class="phva">
            <article><h3>Planear</h3><p>Datos de la empresa, responsables y programa de capacitación.</p><a routerLink="/sst/datos">Datos y membrete</a></article>
            <article><h3>Hacer</h3><p>Capacitaciones, EPP, exámenes, preoperacionales y mantenimiento.</p><a routerLink="/sst/colaboradores">Colaboradores</a></article>
            <article><h3>Verificar</h3><p>Inspecciones, vencimientos y autoevaluación.</p><a routerLink="/sst/flota" [queryParams]="{ vista: 'inspecciones' }">Inspecciones</a></article>
            <article><h3>Actuar</h3><p>Hallazgos, actas, reportes de incidentes y compromisos.</p><a routerLink="/sst/formatos" [queryParams]="{ vista: 'diligenciados' }">Formatos y actas</a></article>
          </div>
        </section>
      </div>
      <p class="nota pie">La plataforma organiza y guarda la evidencia del SG-SST y del PESV; no certifica el cumplimiento de la norma.</p>
    } @else if (error()) {
      <div class="mensaje error" role="alert">{{ error() }} <button class="pequeno" (click)="cargar()">Reintentar</button></div>
    } @else { <p class="sutil">Cargando…</p> }
  `,
  styles: [ESTILOS_SST, `
    .cab-tablero { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 14px; }
    .cab-tablero h1 { margin: 2px 0 4px; max-width: 640px; }
    .fecha { margin: 0; color: var(--primario-texto); font-weight: 650; font-size: 13px; }
    .contadores { display: flex; border: 1px solid var(--gris-2); border-radius: var(--radio-l); background: var(--gris-0); overflow: hidden; }
    .contadores a { display: flex; flex-direction: column; padding: 12px 18px; text-decoration: none; color: inherit; min-width: 110px; }
    .contadores a + a { border-left: 1px solid var(--gris-2); }
    .contadores strong { font-size: 24px; } .contadores small { font-size: 14px; color: var(--gris-5); } .contadores span { font-size: 12px; color: var(--gris-5); }
    .rojo { color: var(--rojo); }
    .accesos { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--gris-2); }
    .accesos .boton { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--gris-3); border-radius: 10px; background: var(--gris-0); text-decoration: none; color: inherit; font-weight: 650; }
    .accesos .boton.primario { background: var(--primario); border-color: var(--primario-borde); color: var(--sobre-primario); }
    .mensaje { margin-bottom: 12px; }
    .dos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 14px; margin-bottom: 14px; }
    .resumen { margin-bottom: 10px; }
    .venc { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .v { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: var(--radio); border: 1px solid; min-width: 0; }
    .v.vencido { background: var(--rojo-claro); border-color: var(--rojo-borde); } .v.semana, .v.mes { background: var(--ambar-claro); border-color: var(--primario-borde); }
    .v .tipo { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--gris-6); }
    .v .det { font-size: 12.5px; color: var(--gris-6); overflow-wrap: anywhere; }
    .v .cuando { font-size: 12.5px; font-weight: 650; } .v.vencido .cuando { color: var(--rojo); } .v.semana .cuando, .v.mes .cuando { color: var(--ambar); }
    .preo, .proximas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .preo li, .proximas li { display: flex; gap: 12px; align-items: center; }
    .preo li > div, .proximas li > div { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .preo small, .proximas small { color: var(--gris-5); font-size: 12.5px; overflow-wrap: anywhere; }
    .preo .mal app-icono { color: var(--rojo); } .preo .bien app-icono { color: var(--verde); } .preo .pendiente app-icono { color: var(--ambar); }
    .preo .n { font-size: 20px; font-weight: 700; }
    .calendario { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 10px; background: var(--tinta); color: #fff; flex: none; }
    .calendario b { font-size: 17px; line-height: 1; } .calendario small { color: var(--primario) !important; font-size: 10px !important; font-weight: 700; }
    .phva { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 10px; }
    .phva article { border-top: 3px solid var(--primario); background: var(--gris-1); border-radius: var(--radio); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
    .phva h3 { margin: 0; font-size: 14px; } .phva p { margin: 0; font-size: 12.5px; color: var(--gris-6); flex: 1; } .phva a { overflow-wrap: anywhere; }
    .pie { text-align: center; margin-top: 8px; }
    @media (max-width: 600px) { .contadores { width: 100%; } .contadores a { flex: 1; min-width: 0; padding: 10px; } }
  `],
})
export class SstTablero {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly NIVELES = NIVELES_PESV; readonly TEXTO_GRUPO = TEXTO_GRUPO; readonly EJES = EJES; readonly MES = MES; readonly DIA = DIA;
  readonly hoy = fechaLarga();
  readonly t = signal<Tablero | null>(null);
  readonly error = signal('');
  readonly todos = signal(false);

  constructor() { this.cargar(); }

  async cargar() {
    this.error.set('');
    try { this.t.set(await this.api.get<Tablero>('/sst/tablero')); }
    catch (e) { this.error.set(await mensajeError(e)); }
  }

  async cargarTodos() {
    try {
      const v = await this.api.get<Tablero['vencimientos']>('/sst/vencimientos');
      this.t.update((x) => (x ? { ...x, vencimientos: { ...v, total: v.items.length } } : x));
      this.todos.set(true);
    } catch (e) { this.avisos.error(e); }
  }
}
