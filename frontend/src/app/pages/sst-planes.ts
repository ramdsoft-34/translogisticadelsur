import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Confirmar } from '../shared/confirmar';
import { FORMATOS } from '../shared/formato';

type EstadoVence = 'vencido' | 'semana' | 'mes' | 'ok' | 'sin_dato';
const CHIP_VENCE: Record<EstadoVence, string> = { vencido: 'error', semana: 'alerta', mes: 'alerta', ok: 'ok', sin_dato: '' };
/** AAAA-MM-DD de hoy en Colombia. */
const hoyIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
/** Fecha guardada → AAAA-MM-DD para un <input type="date">. */
const aIso = (v: string | null | undefined) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(v)) : '');
const ESTILOS_SST = `
  .barra-avance { height: 6px; border-radius: 999px; background: var(--gris-15); overflow: hidden; }
  .barra-avance > span { display: block; height: 100%; background: var(--primario); border-radius: inherit; }
  .seccion-cab { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .seccion-cab h2 { margin: 0; font-size: 16px; }
  th.celda-acciones { text-align: right; }
  .celda-acciones .acciones { justify-content: flex-end; }
  .nota { font-size: 12px; color: var(--gris-5); }
`;

type Calif = '' | 'C' | 'NC' | 'NA';
interface Estandar { numeral: string; item: string; peso: number; formato: string; accion: string; grupo: string }
interface Ciclo { ciclo: string; nombre: string; peso: number; grupos: [string, string, number][] }
interface Catalogo { estandares: Estandar[]; ciclos: Ciclo[]; entidades: Record<string, string> }
interface Nivel { clave: string; texto: string; mesesAvance: number | null; acciones: string[] }
interface Resumen { id: string; vigencia: number; fecha: string; origen: string; estado: string; soloTotal: boolean; total: number; nivel: Nivel;
  conteos: { C: number; NC: number; NA: number; sinCalificar: number } | null; reporteArl?: { fecha: string | null; consecutivo: string } }
interface Actividad { _id: string; anio: number; origen: 'norma' | 'mejora' | 'propia'; numeral: string; titulo: string; detalle: string; entidad: string; norma: string;
  ciclo: string; responsable: string; recursos: string; evidencia: string; fecha: string; estado: 'pendiente' | 'en_curso' | 'hecha' | 'cancelada'; nota: string;
  vence: { estado: EstadoVence; texto: string } | null }
interface Autoevaluacion { _id: string; vigencia: number; fecha: string; origen: string; estado: string; soloTotal: boolean; totalRegistrado: number | null;
  items: { numeral: string; estado: Calif; justificacion: string }[];
  reporteArl?: { fecha: string | null; consecutivo: string }; recomendacionesArl?: { fecha: string | null; resumen: string };
  calculo: { total: number; nivel: Nivel }; meta: { total: number; necesarias: number; llega: number } | null; acciones: Actividad[] }
interface Alerta { id: string; titulo: string; origen: string; entidad: string; norma: string; evidencia: string; responsable: string; fecha: string; estado: EstadoVence; texto: string }
interface Alertas { resumen: { vencidas: number; semana: number; mes: number }; items: Alerta[]; avisos: { clave: string; texto: string }[] }

const ORIGENES: Record<string, string> = { plataforma: 'Plataforma', alissta: 'ALISSTA (Positiva)', excel: 'Excel' };
const ESTADOS_ACT: Record<string, string> = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', cancelada: 'Cancelada' };
const CHIP_NIVEL: Record<string, string> = { critico: 'error', moderado: 'alerta', aceptable: 'ok' };
const r2 = (n: number) => Math.round(n * 100) / 100;
const NUM = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const anioHoy = () => Number(hoyIso().slice(0, 4));

// Fase 13: autoevaluación de estándares mínimos (Res. 0312) con puntaje calculado, plan de mejora automático,
// plan anual de trabajo con el calendario del Ministerio del Trabajo, la ARL, MinTransporte y la Supertransporte, y alertas.
@Component({
  selector: 'app-sst-planes',
  imports: [FormsModule, NgTemplateOutlet, Icono, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Autoevaluación y planes</h1>
        <p class="sutil">Estándares mínimos con el puntaje calculado, plan de mejora que sale solo de lo que no cumple, plan anual de trabajo con las fechas del Ministerio del Trabajo, la ARL y el PESV, y alertas de lo que hay que presentar.</p></div>
    </div>

    <div class="pestanas" role="tablist">
      @for (t of vistas; track t[0]) {
        <button type="button" role="tab" [class.activa]="vista() === t[0]" (click)="cambiar(t[0])">{{ t[1] }}
          @if (t[0] === 'alertas' && alertas(); as a) { @if (a.resumen.vencidas + a.resumen.semana) { <span class="chip error sin-punto">{{ a.resumen.vencidas + a.resumen.semana }}</span> } }
          @if (t[0] === 'mejora' && abiertasMejora()) { <span class="chip alerta sin-punto">{{ abiertasMejora() }}</span> }
        </button>
      }
    </div>

    @switch (vista()) {
      <!-- ═════════════ Autoevaluación ═════════════ -->
      @case ('autoevaluacion') {
        <div class="vigencias">
          @for (a of lista(); track a.id) {
            <button type="button" class="vig" [class.sel]="sel()?._id === a.id" (click)="abrir(a.id)">
              <span class="anio">{{ a.vigencia }}</span>
              <strong>{{ n(a.total) }} %</strong>
              <span [class]="'chip sin-punto ' + chipNivel(a.nivel.clave)">{{ a.nivel.texto }}</span>
              <small>{{ a.estado === 'borrador' ? 'Borrador' : (a.soloTotal ? 'Solo puntaje' : 'Cerrada') }} · {{ origenes[a.origen] }}</small>
            </button>
          } @empty { <p class="sutil">No hay autoevaluaciones registradas.</p> }
          @if (puede) { <button type="button" class="vig nueva" (click)="nueva.set(!nueva())"><app-icono nombre="mas" [tam]="18" />Nueva</button> }
        </div>

        @if (nueva()) {
          <form class="tarjeta agregar-eval" (ngSubmit)="crear()">
            <h2>Nueva autoevaluación</h2>
            <div class="formulario">
              <div class="campo"><label for="n-vig">Vigencia</label><input id="n-vig" name="vig" type="number" min="2017" [(ngModel)]="form.vigencia" /></div>
              <div class="campo"><label for="n-fecha">Fecha</label><input id="n-fecha" name="fecha" type="date" [max]="hoy" [(ngModel)]="form.fecha" /></div>
              <div class="campo"><label for="n-origen">Dónde se hizo</label>
                <select id="n-origen" name="origen" [(ngModel)]="form.origen">@for (o of origenesLista; track o[0]) { <option [value]="o[0]">{{ o[1] }}</option> }</select></div>
              <div class="campo"><label for="n-tipo">Qué se registra</label>
                <select id="n-tipo" name="tipo" [(ngModel)]="form.tipo">
                  <option value="items">Los 60 ítems (calcula el puntaje y el plan de mejora)</option>
                  <option value="total">Solo el puntaje de una evaluación anterior</option>
                </select></div>
              @if (form.tipo === 'items') {
                <div class="campo"><label for="n-copia">Partir de</label>
                  <select id="n-copia" name="copia" [(ngModel)]="form.copiarDe"><option value="">Todo sin calificar</option>
                    @for (a of conItems(); track a.id) { <option [value]="a.id">La calificación de {{ a.vigencia }}</option> }</select></div>
              } @else {
                <div class="campo"><label for="n-total">Puntaje (%)</label><input id="n-total" name="total" type="number" min="0" max="100" step="0.5" [(ngModel)]="form.total" /></div>
              }
            </div>
            <div class="acciones"><button type="submit" class="primario" [disabled]="trabajando()">Crear</button><button type="button" (click)="nueva.set(false)">Cancelar</button></div>
          </form>
        }

        @if (sel(); as a) {
          <div class="resumen-eval">
            <section class="tarjeta puntaje">
              <div class="anillo" [style.--p]="calc().total" [class]="'anillo ' + calc().nivel.clave">
                <div><strong>{{ n(calc().total) }} %</strong><small>de 100 puntos</small></div>
              </div>
              <div class="datos">
                <h2>Vigencia {{ a.vigencia }} <span [class]="'chip sin-punto ' + chipNivel(calc().nivel.clave)">{{ calc().nivel.texto }}</span></h2>
                <p class="sutil">{{ a.fecha | dia }} · {{ origenes[a.origen] }} · {{ a.estado === 'borrador' ? 'En borrador: el plan de mejora sale al cerrarla' : 'Cerrada' }}</p>
                @if (!a.soloTotal) {
                  <div class="conteos"><span><b>{{ calc().C }}</b> cumplen</span><span><b>{{ calc().NC }}</b> no cumplen</span><span><b>{{ calc().NA }}</b> no aplican</span>
                    @if (calc().sin) { <span class="falta"><b>{{ calc().sin }}</b> sin calificar</span> }</div>
                }
                <ul class="exige">@for (t of calc().nivel.acciones; track t) { <li>{{ t }}</li> }</ul>
                @if (meta(); as m) { @if (m.necesarias) { <p class="meta">Cumpliendo las <b>{{ m.necesarias }}</b> acciones de más peso se pasa de <b>{{ n(m.total) }} %</b> a <b>{{ n(m.llega) }} %</b> y se sale del nivel crítico.</p> } }
                <div class="acciones">
                  @if (puede && a.estado === 'borrador' && !a.soloTotal) {
                    <button type="button" (click)="guardarItems()" [disabled]="!cambios() || trabajando()"><app-icono nombre="check" [tam]="16" />Guardar calificación</button>
                    <button type="button" class="primario" confirmar="Clic otra vez: se cierra y se arma el plan de mejora" (confirmado)="cerrar()" [disabled]="trabajando()">Cerrar y generar plan de mejora</button>
                  }
                  @if (puede && a.estado === 'cerrada' && !a.soloTotal) { <button type="button" confirmar="Clic otra vez para reabrir" (confirmado)="reabrir()">Reabrir</button> }
                  @if (!a.soloTotal) { <button type="button" (click)="excel()"><app-icono nombre="descargar" [tam]="16" />Informe para la ARL (Excel)</button> }
                  @if (puede && (a.estado === 'borrador' || a.soloTotal)) { <button type="button" class="peligro" confirmar="Clic otra vez para borrar" (confirmado)="borrar()">Borrar</button> }
                </div>
              </div>
            </section>
            <section class="tarjeta arl">
              <h2>Reporte a la ARL</h2>
              <p class="nota">Datos del acuse de recibido y de las recomendaciones (en ALISSTA: Estándares mínimos › Reportar ARL).</p>
              <fieldset [disabled]="!puede" class="formulario">
                <div class="campo"><label for="a-env">Enviada a la ARL</label><input id="a-env" type="date" [(ngModel)]="arl.envio" /></div>
                <div class="campo"><label for="a-cons">Consecutivo del acuse</label><input id="a-cons" [(ngModel)]="arl.consecutivo" maxlength="40" /></div>
                <div class="campo"><label for="a-rec">Recomendaciones de la ARL</label><input id="a-rec" type="date" [(ngModel)]="arl.recomendaciones" /></div>
                <div class="campo ancho"><label for="a-res">Resumen de las recomendaciones</label><textarea id="a-res" rows="3" [(ngModel)]="arl.resumen" maxlength="2000"></textarea></div>
              </fieldset>
              @if (puede) { <button type="button" (click)="guardarArl()" [disabled]="trabajando()">Guardar datos de la ARL</button> }
            </section>
          </div>

          @if (!a.soloTotal) {
            <section class="tarjeta">
              <div class="seccion-cab"><h2>Avance por ciclo PHVA</h2><span class="nota">Pesos de la Resolución 0312</span></div>
              <div class="ciclos">
                @for (c of calc().ciclos; track c.ciclo) {
                  <article class="ciclo">
                    <header><h3><span class="letra">{{ c.ciclo }}</span>{{ c.nombre }}</h3><span class="pts">{{ n(c.obtenido) }} / {{ c.peso }}</span></header>
                    <div class="barra-avance"><span [style.width.%]="c.obtenido / c.peso * 100"></span></div>
                    @for (g of c.grupos; track g.grupo) {
                      <div class="sub"><span>{{ g.nombre }}</span><span class="pts">{{ n(g.obtenido) }} / {{ g.peso }}</span></div>
                      <div class="barra-avance fina"><span [style.width.%]="g.obtenido / g.peso * 100"></span></div>
                    }
                  </article>
                }
              </div>
            </section>

            <section class="tarjeta">
              <div class="seccion-cab"><h2>Los 60 ítems</h2>
                <div class="filtros">
                  @for (f of filtrosItems; track f[0]) { <button type="button" class="pequeno" [class.activo]="filtro() === f[0]" (click)="filtro.set(f[0])">{{ f[1] }}</button> }
                </div></div>
              <div class="tabla-caja"><table>
                <thead><tr><th>Num.</th><th>Ítem</th><th>Peso</th><th>Calificación</th><th>Justificación</th><th>Evidencia</th></tr></thead>
                <tbody>
                  @for (e of visibles(); track e.numeral) {
                    @if (e.primero) { <tr class="grupo"><td colspan="6">Estándar {{ e.grupo }} · {{ nombreGrupo(e.grupo) }}</td></tr> }
                    <tr>
                      <td class="num">{{ e.numeral }}</td>
                      <td>{{ e.item }}@if (estado(e.numeral) === 'NC') { <small class="accion">Plan: {{ e.accion }}</small> }</td>
                      <td class="num">{{ n(e.peso) }}</td>
                      <td><div class="seg" role="group" [attr.aria-label]="'Calificación ' + e.numeral">
                        @for (k of ['C', 'NC', 'NA']; track k) {
                          <button type="button" [class]="k + (estado(e.numeral) === k ? ' on' : '')" [attr.aria-pressed]="estado(e.numeral) === k"
                            [disabled]="!editable()" (click)="calificar(e.numeral, $any(k))">{{ k }}</button>
                        }</div></td>
                      <td><input class="just" [attr.aria-label]="'Justificación ' + e.numeral" [disabled]="!editable()" [ngModel]="justif(e.numeral)" (ngModelChange)="justificar(e.numeral, $event)"
                        [placeholder]="estado(e.numeral) === 'NA' ? 'Obligatoria si no aplica' : ''" [class.falta]="estado(e.numeral) === 'NA' && !justif(e.numeral)" maxlength="600" /></td>
                      <td><span class="codigo">{{ e.formato }}</span></td>
                    </tr>
                  }
                </tbody>
              </table></div>
            </section>
          }
        }
      }

      <!-- ═════════════ Plan de mejora ═════════════ -->
      @case ('mejora') {
        <p class="sutil">Sale solo al cerrar cada autoevaluación: una acción por ítem que no cumple, con plazo según su peso (lo que más pesa, primero). Cuando el ítem cumple en la siguiente autoevaluación, la acción se cierra sola.</p>
        <ng-container *ngTemplateOutlet="tablaActividades; context: { $implicit: mejora(), vacia: 'No hay acciones de mejora. Cierre una autoevaluación para generarlas.' }" />
      }

      <!-- ═════════════ Plan anual ═════════════ -->
      @case ('anual') {
        <div class="barra-plan">
          <div class="campo-anio"><label for="p-anio">Año</label>
            <select id="p-anio" [ngModel]="anio()" (ngModelChange)="cambiarAnio($event)">@for (y of anios; track y) { <option [ngValue]="y">{{ y }}</option> }</select></div>
          @if (resumenAnual(); as r) {
            <div class="kpis-mini"><span><b>{{ r.total }}</b> actividades</span><span><b>{{ r.hechas }}</b> hechas</span><span [class.rojo]="r.vencidas"><b>{{ r.vencidas }}</b> vencidas</span>
              <span><b>{{ r.cumplimiento ?? '—' }}{{ r.cumplimiento !== null ? ' %' : '' }}</b> cumplimiento a la fecha</span></div>
          }
          <div class="acciones">
            @if (puede) { <button type="button" class="primario" (click)="generar()" [disabled]="trabajando()"><app-icono nombre="lista" [tam]="16" />Cargar calendario {{ anio() }}</button>
              <button type="button" (click)="nuevaAct.set(!nuevaAct())"><app-icono nombre="mas" [tam]="16" />Actividad propia</button> }
            <button type="button" (click)="excelPlan()"><app-icono nombre="descargar" [tam]="16" />Excel</button>
          </div>
        </div>
        @if (nuevaAct()) {
          <form class="tarjeta" (ngSubmit)="crearActividad()">
            <div class="formulario">
              <div class="campo ancho"><label for="na-t">Actividad</label><input id="na-t" name="t" [(ngModel)]="act.titulo" maxlength="300" /></div>
              <div class="campo"><label for="na-f">Fecha límite</label><input id="na-f" name="f" type="date" [(ngModel)]="act.fecha" /></div>
              <div class="campo"><label for="na-r">Responsable</label><input id="na-r" name="r" [(ngModel)]="act.responsable" maxlength="160" /></div>
              <div class="campo"><label for="na-c">Ciclo</label><select id="na-c" name="c" [(ngModel)]="act.ciclo"><option value="">—</option><option value="P">Planear</option><option value="H">Hacer</option><option value="V">Verificar</option><option value="A">Actuar</option></select></div>
            </div>
            <div class="acciones"><button type="submit" class="primario">Agregar</button><button type="button" (click)="nuevaAct.set(false)">Cancelar</button></div>
          </form>
        }
        @for (m of porMes(); track m.mes) {
          <h3 class="mes">{{ m.nombre }}</h3>
          <ng-container *ngTemplateOutlet="tablaActividades; context: { $implicit: m.items, vacia: '' }" />
        } @empty { <p class="sutil">El plan de {{ anio() }} está vacío. Use «Cargar calendario {{ anio() }}» para traer las fechas de la norma.</p> }
      }

      <!-- ═════════════ Alertas ═════════════ -->
      @case ('alertas') {
        @if (alertas(); as a) {
          @for (v of a.avisos; track v.clave) { <div class="mensaje alerta" role="status">{{ v.texto }}</div> }
          <div class="barra-alertas">
            <div class="filtros">
              @for (f of filtrosAlertas; track f[0]) {
                <button type="button" class="pequeno" [class.activo]="filtroAlerta() === f[0]" (click)="filtroAlerta.set(f[0])">{{ f[1] }} <span class="cuenta">{{ cuentaAlerta(f[0]) }}</span></button>
              }
              <select [ngModel]="origenAlerta()" (ngModelChange)="origenAlerta.set($event)" aria-label="Origen de la alerta">
                <option value="">Todo origen</option><option value="norma">Norma (calendario)</option><option value="mejora">Plan de mejora</option><option value="propia">Propias</option>
              </select>
            </div>
            @if (a.items.length) { <a class="boton-wa" [href]="enlaceWhatsapp()" target="_blank" rel="noopener"><app-icono nombre="enviar" [tam]="16" />Enviar resumen por WhatsApp</a> }
          </div>
          @if (alertasVisibles().length) {
            <div class="tabla-caja"><table class="tabla-act">
              <colgroup><col style="width: 14%" /><col style="width: 10%" /><col /><col style="width: 14%" /><col style="width: 11%" /><col style="width: 15%" /><col style="width: 15%" /></colgroup>
              <thead><tr><th>Vence</th><th>Fecha</th><th>Obligación o acción</th><th>Entidad</th><th>Origen</th><th>Responsable</th><th class="celda-acciones">Acciones</th></tr></thead>
              <tbody>
                @for (x of alertasVisibles(); track x.id) {
                  <tr>
                    <td><span [class]="'chip sin-punto ' + chipDe(x.estado)">{{ x.texto }}</span></td>
                    <td class="num">{{ x.fecha | dia }}</td>
                    <td><strong>{{ x.titulo }}</strong>
                      <small>@if (x.norma) { {{ x.norma }} }@if (x.evidencia) { · Evidencia: {{ x.evidencia }} }</small></td>
                    <td>{{ entidades[x.entidad] || x.entidad }}</td>
                    <td><span [class]="'chip sin-punto ' + (x.origen === 'mejora' ? 'alerta' : x.origen === 'norma' ? 'info' : '')">{{ textoOrigen[x.origen] }}</span></td>
                    <td>{{ x.responsable || '—' }}</td>
                    <td class="celda-acciones"><div class="acciones">
                      @if (puede) { <button type="button" class="pequeno" (click)="marcar(x.id, 'hecha')"><app-icono nombre="check" [tam]="14" />Hecha</button>
                        <button type="button" class="pequeno" (click)="marcar(x.id, 'en_curso')">En curso</button> }
                    </div></td>
                  </tr>
                }
              </tbody>
            </table></div>
          } @else { <p class="sutil">Nada vencido ni por vencer en los próximos 30 días con ese filtro.</p> }
        } @else { <p class="sutil">Cargando…</p> }
      }
    }

    <ng-template #tablaActividades let-items let-vacia="vacia">
      @if (items.length) {
        <div class="tabla-caja"><table class="tabla-act">
          <colgroup><col style="width: 15%" /><col /><col style="width: 11%" /><col style="width: 17%" /><col style="width: 13%" /><col style="width: 13%" /></colgroup>
          <thead><tr><th>Fecha</th><th>Actividad</th><th>Origen</th><th>Responsable</th><th>Estado</th><th class="celda-acciones">Acciones</th></tr></thead>
          <tbody>
            @for (x of items; track x._id) {
              <tr [class.hecha]="x.estado === 'hecha'" [class.cancelada]="x.estado === 'cancelada'">
                <td class="num">@if (editando() === x._id) { <input type="date" [(ngModel)]="edicion.fecha" /> } @else { {{ x.fecha | dia }} }
                  @if (x.vence; as v) { <span [class]="'chip sin-punto ' + chipDe(v.estado)">{{ v.texto }}</span> }</td>
                <td><strong>@if (x.numeral) { <span class="codigo">{{ x.numeral }}</span> }{{ x.titulo }}</strong>
                  <small>{{ entidades[x.entidad] || x.entidad }}@if (x.norma) { · {{ x.norma }} }@if (x.evidencia) { · Evidencia: {{ x.evidencia }} }</small>
                  @if (x.nota) { <small class="nota-act">{{ x.nota }}</small> }
                  @if (editando() === x._id) { <input class="nota-ed" [(ngModel)]="edicion.nota" maxlength="1000" placeholder="Nota (obligatoria para cancelar)" [attr.aria-label]="'Nota de ' + x.titulo" /> }</td>
                <td><span [class]="'chip sin-punto ' + (x.origen === 'mejora' ? 'alerta' : x.origen === 'norma' ? 'info' : '')">{{ textoOrigen[x.origen] }}</span></td>
                <td>@if (editando() === x._id) { <input [(ngModel)]="edicion.responsable" maxlength="160" /> } @else { {{ x.responsable || '—' }} }</td>
                <td>@if (puede && editando() !== x._id && x.estado !== 'cancelada') {
                    <select [ngModel]="x.estado" (ngModelChange)="cambiarEstado(x, $event)" [attr.aria-label]="'Estado de ' + x.titulo">
                      @for (s of estadosAct; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }</select>
                  } @else { {{ estadosTexto[x.estado] }} }</td>
                <td class="celda-acciones"><div class="acciones">
                  @if (puede) {
                    @if (editando() === x._id) { <button type="button" class="pequeno primario" (click)="guardarEdicion(x)">Guardar</button>
                      <button type="button" class="pequeno peligro" [disabled]="!edicion.nota.trim()" (click)="cancelarActividad(x)">Cancelar actividad</button>
                      <button type="button" class="pequeno" (click)="editando.set('')">Cerrar</button> }
                    @else { <button type="button" class="pequeno" (click)="editar(x)"><app-icono nombre="editar" [tam]="14" />Editar</button> }
                  }
                </div></td>
              </tr>
            }
          </tbody>
        </table></div>
      } @else if (vacia) { <p class="sutil">{{ vacia }}</p> }
    </ng-template>
  `,
  styles: [ESTILOS_SST, `
    .vigencias { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
    .vig { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 14px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); background: var(--gris-0); min-width: 150px; text-align: left; }
    .vig.sel { border-color: var(--primario-borde); box-shadow: 0 0 0 2px var(--primario-claro); }
    .vig .anio { font-size: 12px; font-weight: 700; color: var(--gris-5); } .vig strong { font-size: 22px; font-variant-numeric: tabular-nums; } .vig small { font-size: 11.5px; color: var(--gris-5); }
    .vig.nueva { flex-direction: row; align-items: center; justify-content: center; border-style: dashed; font-weight: 650; min-width: 110px; }
    .agregar-eval { margin-bottom: 14px; }
    .resumen-eval { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 14px; margin-bottom: 14px; }
    .puntaje { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
    .anillo { --p: 0; width: 132px; height: 132px; border-radius: 50%; flex: none; display: grid; place-items: center;
      background: conic-gradient(var(--c, var(--rojo)) calc(var(--p) * 1%), var(--gris-15) 0); }
    .anillo.moderado { --c: var(--ambar); } .anillo.aceptable { --c: var(--verde); }
    .anillo > div { width: 104px; height: 104px; border-radius: 50%; background: var(--gris-0); display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .anillo strong { font-size: 24px; font-variant-numeric: tabular-nums; } .anillo small { font-size: 11px; color: var(--gris-5); }
    .datos { flex: 1; min-width: 240px; } .datos h2 { margin: 0 0 4px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .conteos { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; margin: 8px 0; } .conteos b { font-size: 16px; } .conteos .falta { color: var(--ambar); }
    .exige { margin: 6px 0; padding-left: 18px; font-size: 12.5px; color: var(--gris-6); }
    .meta { background: var(--ambar-claro); border-radius: var(--radio); padding: 8px 10px; font-size: 13px; }
    .arl textarea { width: 100%; }
    .ciclos { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .ciclo { border: 1px solid var(--gris-2); border-radius: var(--radio); padding: 12px; display: flex; flex-direction: column; gap: 6px; }
    .ciclo header { display: flex; justify-content: space-between; gap: 8px; } .ciclo h3 { margin: 0; font-size: 14px; }
    .letra { background: var(--primario); color: var(--sobre-primario); border-radius: 5px; padding: 0 6px; margin-right: 6px; font-size: 12px; }
    .pts { font-variant-numeric: tabular-nums; color: var(--gris-6); font-size: 12.5px; white-space: nowrap; }
    .sub { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-top: 4px; }
    .barra-avance.fina { height: 4px; }
    .filtros { display: flex; gap: 6px; flex-wrap: wrap; } .filtros .activo { background: var(--tinta); color: #fff; border-color: var(--tinta); }
    tr.grupo td { background: var(--gris-1); font-weight: 700; font-size: 12px; color: var(--gris-6); }
    .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    td small { display: block; color: var(--gris-5); font-size: 12px; margin-top: 2px; }
    .accion { color: var(--ambar) !important; }
    .seg { display: inline-flex; border: 1px solid var(--gris-3); border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; border-radius: 0; min-height: 0; padding: 4px 9px; font-size: 12px; font-weight: 700; background: var(--gris-0); color: var(--gris-5); }
    .seg button + button { border-left: 1px solid var(--gris-3); }
    .seg button.C.on { background: var(--verde-claro, #e3f4ea); color: var(--verde); } .seg button.NC.on { background: var(--rojo-claro); color: var(--rojo); } .seg button.NA.on { background: var(--gris-15); color: var(--gris-8); }
    .just { width: 100%; min-width: 160px; font-size: 12.5px; } .just.falta { border-color: var(--ambar); }
    .codigo { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; border: 1px solid var(--gris-2); border-radius: 5px; padding: 1px 5px; margin-right: 6px; white-space: nowrap; }
    .barra-plan { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; justify-content: space-between; margin-bottom: 12px; }
    .campo-anio { display: flex; flex-direction: column; gap: 4px; } .campo-anio label { font-size: 12px; color: var(--gris-5); }
    .kpis-mini { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--gris-6); } .kpis-mini b { color: var(--gris-8); font-size: 16px; }
    .rojo, .rojo b { color: var(--rojo) !important; }
    h3.mes { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--gris-6); }
    tr.hecha td { opacity: .6; } tr.cancelada td { opacity: .45; text-decoration: line-through; }
    .tabla-act { table-layout: fixed; width: 100%; } .tabla-act select { max-width: 100%; } .tabla-act .acciones { flex-wrap: nowrap; }
    .nota-act { font-style: italic; } .nota-ed { width: 100%; margin-top: 4px; font-size: 12.5px; }
    .barra-alertas { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .barra-alertas select { width: auto; } .cuenta { font-variant-numeric: tabular-nums; opacity: .75; margin-left: 4px; }
    .boton-wa { display: inline-flex; gap: 6px; align-items: center; padding: 6px 12px; border: 1px solid var(--gris-3); border-radius: 10px; text-decoration: none; color: inherit; font-weight: 650; }
    @media (max-width: 1000px) { .ciclos { grid-template-columns: repeat(2, minmax(0, 1fr)); } .resumen-eval { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 560px) { .ciclos { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class SstPlanes {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);
  readonly puede = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly vistas: [string, string][] = [['autoevaluacion', 'Autoevaluación'], ['mejora', 'Plan de mejora'], ['anual', 'Plan anual'], ['alertas', 'Alertas']];
  readonly origenes = ORIGENES; readonly origenesLista = Object.entries(ORIGENES);
  readonly estadosAct = Object.entries(ESTADOS_ACT).filter((e) => e[0] !== 'cancelada'); readonly estadosTexto = ESTADOS_ACT;
  readonly textoOrigen: Record<string, string> = { norma: 'Norma', mejora: 'Plan de mejora', propia: 'Propia' };
  readonly chipVence = CHIP_VENCE;
  readonly filtrosItems: [string, string][] = [['todos', 'Todos'], ['NC', 'No cumplen'], ['C', 'Cumplen'], ['NA', 'No aplican'], ['', 'Sin calificar']];
  readonly hoy = hoyIso();
  readonly anios = [anioHoy() - 1, anioHoy(), anioHoy() + 1];
  entidades: Record<string, string> = {};

  readonly vista = signal('autoevaluacion');
  readonly catalogo = signal<Catalogo | null>(null);
  readonly lista = signal<Resumen[]>([]);
  readonly sel = signal<Autoevaluacion | null>(null);
  readonly calif = signal<Record<string, Calif>>({});
  readonly justificaciones = signal<Record<string, string>>({});
  readonly cambios = signal(false);
  readonly filtro = signal('todos');
  readonly nueva = signal(false);
  readonly trabajando = signal(false);
  readonly mejora = signal<Actividad[]>([]);
  readonly anual = signal<Actividad[]>([]);
  readonly resumenAnual = signal<{ total: number; hechas: number; vencidas: number; cumplimiento: number | null } | null>(null);
  readonly anio = signal(anioHoy());
  readonly alertas = signal<Alertas | null>(null);
  readonly nuevaAct = signal(false);
  readonly filtrosAlertas: [string, string][] = [['', 'Todas'], ['vencido', 'Vencidas'], ['semana', 'Esta semana'], ['mes', 'Próximos 30 días']];
  readonly filtroAlerta = signal('');
  readonly origenAlerta = signal('');
  readonly alertasVisibles = computed(() => (this.alertas()?.items || [])
    .filter((x) => (!this.filtroAlerta() || x.estado === this.filtroAlerta()) && (!this.origenAlerta() || x.origen === this.origenAlerta())));
  readonly editando = signal('');
  edicion = { fecha: '', responsable: '', nota: '' };
  form = { vigencia: anioHoy(), fecha: hoyIso(), origen: 'plataforma', tipo: 'items', copiarDe: '', total: null as number | null };
  arl = { envio: '', consecutivo: '', recomendaciones: '', resumen: '' };
  act = { titulo: '', fecha: hoyIso(), responsable: '', ciclo: '' };

  readonly conItems = computed(() => this.lista().filter((a) => !a.soloTotal));
  readonly abiertasMejora = computed(() => this.mejora().filter((x) => ['pendiente', 'en_curso'].includes(x.estado)).length);
  readonly editable = computed(() => this.puede && this.sel()?.estado === 'borrador' && !this.sel()?.soloTotal);

  // Puntaje calculado en pantalla con la calificación que se está marcando (el servidor lo vuelve a calcular al guardar)
  readonly calc = computed(() => {
    const cat = this.catalogo(); const a = this.sel();
    const vacio = { total: 0, nivel: { clave: 'critico', texto: 'Crítico', mesesAvance: 3, acciones: [] } as Nivel, C: 0, NC: 0, NA: 0, sin: 0, ciclos: [] as { ciclo: string; nombre: string; peso: number; obtenido: number; grupos: { grupo: string; nombre: string; peso: number; obtenido: number }[] }[] };
    if (!cat || !a) return vacio;
    if (a.soloTotal) return { ...vacio, total: a.calculo.total, nivel: a.calculo.nivel };
    const c = this.calif();
    const vale = (e: Estandar) => (c[e.numeral] === 'C' || c[e.numeral] === 'NA' ? e.peso : 0);
    const ciclos = cat.ciclos.map((ci) => {
      const grupos = ci.grupos.map(([g, nombre, peso]) => ({ grupo: g, nombre, peso, obtenido: r2(cat.estandares.filter((e) => e.grupo === g).reduce((s, e) => s + vale(e), 0)) }));
      return { ciclo: ci.ciclo, nombre: ci.nombre, peso: ci.peso, obtenido: r2(grupos.reduce((s, g) => s + g.obtenido, 0)), grupos };
    });
    const total = r2(ciclos.reduce((s, x) => s + x.obtenido, 0));
    const cuenta = (k: Calif) => cat.estandares.filter((e) => (c[e.numeral] || '') === k).length;
    return { total, nivel: this.nivel(total), C: cuenta('C'), NC: cuenta('NC'), NA: cuenta('NA'), sin: cuenta(''), ciclos };
  });

  readonly meta = computed(() => {
    const cat = this.catalogo(); const c = this.calif(); const t = this.calc().total;
    if (!cat || !this.sel() || this.sel()!.soloTotal) return null;
    if (t >= 60) return { total: t, necesarias: 0, llega: t };
    let suma = t, n = 0;
    for (const e of [...cat.estandares].filter((x) => c[x.numeral] === 'NC').sort((a, b) => b.peso - a.peso)) { if (suma >= 60) break; suma += e.peso; n += 1; }
    return { total: t, necesarias: n, llega: r2(suma) };
  });

  readonly visibles = computed(() => {
    const cat = this.catalogo(); if (!cat) return [];
    const f = this.filtro(); const c = this.calif();
    const l = cat.estandares.filter((e) => f === 'todos' || (c[e.numeral] || '') === f);
    return l.map((e, i) => ({ ...e, primero: i === 0 || l[i - 1].grupo !== e.grupo }));
  });

  readonly porMes = computed(() => {
    const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const grupos = new Map<number, Actividad[]>();
    for (const x of this.anual()) { const m = Number(aIso(x.fecha).slice(5, 7)); grupos.set(m, [...(grupos.get(m) || []), x]); }
    return [...grupos.entries()].sort((a, b) => a[0] - b[0]).map(([m, items]) => ({ mes: m, nombre: nombres[m - 1], items }));
  });

  constructor() {
    const v = this.ruta.snapshot.queryParamMap.get('vista');
    if (v && this.vistas.some((t) => t[0] === v)) this.vista.set(v);
    this.iniciar();
  }

  private async iniciar() {
    try {
      const cat = await this.api.get<Catalogo>('/sst/estandares');
      this.catalogo.set(cat); this.entidades = cat.entidades;
      await Promise.all([this.cargarLista(true), this.cargarMejora(), this.cargarAnual(), this.cargarAlertas()]);
    } catch (e) { this.avisos.error(e); }
  }

  cambiar(v: string) { this.vista.set(v); this.router.navigate([], { queryParams: { vista: v }, replaceUrl: true }); }
  n(v: number | null | undefined) { return v === null || v === undefined ? '—' : NUM.format(v); }
  cuentaAlerta(f: string) { return (this.alertas()?.items || []).filter((x) => (!f || x.estado === f) && (!this.origenAlerta() || x.origen === this.origenAlerta())).length; }
  chipNivel(k: string) { return CHIP_NIVEL[k] || ''; }
  chipDe(e: string) { return (CHIP_VENCE as Record<string, string>)[e] || ''; }
  nombreGrupo(g: string) { for (const c of this.catalogo()?.ciclos || []) for (const x of c.grupos) if (x[0] === g) return x[1]; return ''; }
  nivel(t: number): Nivel {
    if (t < 60) return { clave: 'critico', texto: 'Crítico', mesesAvance: 3, acciones: ['Plan de mejoramiento de inmediato, a disposición del Ministerio del Trabajo', 'Informe de avances a la ARL en máximo 3 meses', 'Seguimiento anual y plan de visita del Ministerio del Trabajo'] };
    if (t <= 85) return { clave: 'moderado', texto: 'Moderadamente aceptable', mesesAvance: 6, acciones: ['Plan de mejoramiento a disposición del Ministerio del Trabajo', 'Informe de avances a la ARL en máximo 6 meses', 'Plan de visita del Ministerio del Trabajo'] };
    return { clave: 'aceptable', texto: 'Aceptable', mesesAvance: null, acciones: ['Mantener la calificación y las evidencias a disposición del Ministerio del Trabajo', 'Incluir en el plan anual las mejoras detectadas'] };
  }

  estado(n: string): Calif { return this.calif()[n] || ''; }
  justif(n: string) { return this.justificaciones()[n] || ''; }
  calificar(n: string, k: Calif) { this.calif.update((c) => ({ ...c, [n]: c[n] === k ? '' : k })); this.cambios.set(true); }
  justificar(n: string, v: string) { this.justificaciones.update((j) => ({ ...j, [n]: v })); this.cambios.set(true); }

  async cargarLista(abrirUltima = false) {
    this.lista.set(await this.api.get<Resumen[]>('/sst/autoevaluaciones'));
    if (abrirUltima && this.lista().length) await this.abrir(this.lista()[0].id);
  }

  async abrir(id: string) {
    try { this.poner(await this.api.get<Autoevaluacion>(`/sst/autoevaluaciones/${id}`)); }
    catch (e) { this.avisos.error(e); }
  }

  private poner(a: Autoevaluacion) {
    this.sel.set(a);
    this.calif.set(Object.fromEntries(a.items.map((i) => [i.numeral, i.estado])));
    this.justificaciones.set(Object.fromEntries(a.items.map((i) => [i.numeral, i.justificacion])));
    this.cambios.set(false);
    this.arl = { envio: aIso(a.reporteArl?.fecha), consecutivo: a.reporteArl?.consecutivo || '', recomendaciones: aIso(a.recomendacionesArl?.fecha), resumen: a.recomendacionesArl?.resumen || '' };
  }

  private items() { return Object.keys(this.calif()).map((numeral) => ({ numeral, estado: this.calif()[numeral] || '', justificacion: this.justificaciones()[numeral] || '' })); }

  async crear() {
    this.trabajando.set(true);
    try {
      const cuerpo = this.form.tipo === 'total'
        ? { vigencia: this.form.vigencia, fecha: this.form.fecha, origen: this.form.origen, soloTotal: true, total: this.form.total }
        : { vigencia: this.form.vigencia, fecha: this.form.fecha, origen: this.form.origen, ...(this.form.copiarDe ? { copiarDe: this.form.copiarDe } : {}) };
      const a = await this.api.post<Autoevaluacion>('/sst/autoevaluaciones', cuerpo);
      this.nueva.set(false); this.poner(a); await this.cargarLista();
      this.avisos.ok(`Autoevaluación ${a.vigencia} creada`);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async guardarItems() {
    const a = this.sel(); if (!a) return;
    this.trabajando.set(true);
    try { this.poner(await this.api.put<Autoevaluacion>(`/sst/autoevaluaciones/${a._id}`, { items: this.items() })); await this.cargarLista(); this.avisos.ok('Calificación guardada'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async cerrar() {
    const a = this.sel(); if (!a) return;
    this.trabajando.set(true);
    try {
      if (this.cambios()) await this.api.put(`/sst/autoevaluaciones/${a._id}`, { items: this.items() });
      const r = await this.api.post<Autoevaluacion & { plan: { creadas: number; cerradas: number } }>(`/sst/autoevaluaciones/${a._id}/cerrar`);
      this.poner(r); await Promise.all([this.cargarLista(), this.cargarMejora(), this.cargarAnual(), this.cargarAlertas()]);
      this.avisos.ok(`Cerrada: ${r.plan.creadas} acción(es) nuevas en el plan de mejora y ${r.plan.cerradas} cerrada(s) porque ya cumplen`);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async reabrir() {
    const a = this.sel(); if (!a) return;
    try { this.poner(await this.api.post<Autoevaluacion>(`/sst/autoevaluaciones/${a._id}/reabrir`)); await this.cargarLista(); }
    catch (e) { this.avisos.error(e); }
  }

  async borrar() {
    const a = this.sel(); if (!a) return;
    try { await this.api.delete(`/sst/autoevaluaciones/${a._id}`); this.sel.set(null); await this.cargarLista(true); await this.cargarMejora(); this.avisos.ok('Autoevaluación borrada'); }
    catch (e) { this.avisos.error(e); }
  }

  async guardarArl() {
    const a = this.sel(); if (!a) return;
    try {
      this.poner(await this.api.put<Autoevaluacion>(`/sst/autoevaluaciones/${a._id}`, {
        reporteArl: { fecha: this.arl.envio || null, consecutivo: this.arl.consecutivo },
        recomendacionesArl: { fecha: this.arl.recomendaciones || null, resumen: this.arl.resumen },
      }));
      this.avisos.ok('Datos de la ARL guardados');
    } catch (e) { this.avisos.error(e); }
  }

  excel() { const a = this.sel(); if (a) this.api.descargar(`/sst/autoevaluaciones/${a._id}/excel`, {}, `autoevaluacion_${a.vigencia}.xlsx`).catch((e) => this.avisos.error(e)); }
  excelPlan() { this.api.descargar(`/sst/plan-anual/${this.anio()}/excel`, {}, `plan_anual_${this.anio()}.xlsx`).catch((e) => this.avisos.error(e)); }

  // ── Plan de mejora y plan anual ──
  async cargarMejora() { this.mejora.set((await this.api.get<{ items: Actividad[] }>('/sst/actividades', { origen: 'mejora' })).items); }
  async cargarAnual() {
    const r = await this.api.get<{ items: Actividad[]; resumen: { total: number; hechas: number; vencidas: number; cumplimiento: number | null } }>('/sst/actividades', { anio: this.anio() });
    this.anual.set(r.items); this.resumenAnual.set(r.resumen);
  }
  async cargarAlertas() { this.alertas.set(await this.api.get<Alertas>('/sst/alertas')); }
  async cambiarAnio(y: number) { this.anio.set(y); await this.cargarAnual().catch((e) => this.avisos.error(e)); }

  async generar() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<{ nuevas: number; anteriores: number }>(`/sst/plan-anual/${this.anio()}/generar`);
      await Promise.all([this.cargarAnual(), this.cargarAlertas()]);
      const pasadas = r.anteriores ? ` (${r.anteriores} fecha(s) que ya pasaron no se agregan)` : '';
      this.avisos.ok(r.nuevas ? `${r.nuevas} actividad(es) del calendario agregadas al plan ${this.anio()}${pasadas}` : `El plan ${this.anio()} ya tenía todo el calendario${pasadas}`);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async crearActividad() {
    try {
      await this.api.post('/sst/actividades', { titulo: this.act.titulo, fecha: this.act.fecha, responsable: this.act.responsable, ciclo: this.act.ciclo });
      this.nuevaAct.set(false); this.act = { titulo: '', fecha: hoyIso(), responsable: '', ciclo: '' };
      await Promise.all([this.cargarAnual(), this.cargarAlertas()]);
    } catch (e) { this.avisos.error(e); }
  }

  editar(x: Actividad) { this.editando.set(x._id); this.edicion = { fecha: aIso(x.fecha), responsable: x.responsable, nota: x.nota }; }
  async guardarEdicion(x: Actividad) {
    try { await this.api.put(`/sst/actividades/${x._id}`, { fecha: this.edicion.fecha, responsable: this.edicion.responsable, nota: this.edicion.nota }); this.editando.set(''); await this.recargarPlanes(); }
    catch (e) { this.avisos.error(e); }
  }

  async cancelarActividad(x: Actividad) {
    try { await this.api.put(`/sst/actividades/${x._id}`, { estado: 'cancelada', nota: this.edicion.nota.trim() }); this.editando.set(''); await this.recargarPlanes(); }
    catch (e) { this.avisos.error(e); }
  }

  async cambiarEstado(x: Actividad, estado: string) {
    try { await this.api.put(`/sst/actividades/${x._id}`, { estado }); await this.recargarPlanes(); }
    catch (e) { this.avisos.error(e); await this.recargarPlanes(); }
  }

  async marcar(id: string, estado: string) {
    try { await this.api.put(`/sst/actividades/${id}`, { estado }); await this.recargarPlanes(); this.avisos.ok(estado === 'hecha' ? 'Marcada como hecha' : 'Marcada en curso'); }
    catch (e) { this.avisos.error(e); }
  }

  private async recargarPlanes() { await Promise.all([this.cargarMejora(), this.cargarAnual(), this.cargarAlertas()]); }

  enlaceWhatsapp() {
    const a = this.alertas(); if (!a) return '';
    const lineas = a.items.slice(0, 15).map((x) => `• ${x.titulo} — ${x.texto} (${new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' }).format(new Date(x.fecha))})`);
    const texto = `SG-SST y PESV: ${a.resumen.vencidas} vencida(s), ${a.resumen.semana} esta semana, ${a.resumen.mes} en 30 días.\n${lineas.join('\n')}`;
    return `https://wa.me/?text=${encodeURIComponent(texto)}`;
  }
}
