import { Paginador } from '../shared/paginador';
import { ListaServidor } from '../shared/lista-servidor';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { FirmaPad } from '../shared/firma-pad';
import { FORMATOS } from '../shared/formato';
import { EJES, ESTILOS_SST, aIso, hoyIso } from './sst-comun';

type Estado = 'programada' | 'ejecutada' | 'atrasada';
interface Asistente { id: string; colaborador: string | null; nombre: string; documento: string; cargo: string; firmado: boolean; firmadoEn: string | null; firmaOrigen: string; pendienteApp: boolean }
interface Capacitacion {
  id: string; fecha: string; tema: string; eje: 'sst' | 'vial' | 'ambos'; dirigidoA: string; horas: number; facilitador: string; lugar: string; observaciones: string;
  ejecutada: boolean; estado: Estado; asistentes: Asistente[]; firmados: number;
}
interface Programa { anio: number; items: Capacitacion[]; indicadores: { programadas: number; ejecutadas: number; atrasadas: number; horas: number; aLaFecha: number; cumplimiento: number | null } }
interface Colab { id: string; nombre: string; documento: string; cargo: string; tipo: string }
const CHIP: Record<Estado, string> = { programada: '', ejecutada: 'ok', atrasada: 'alerta' };

// Programa anual de capacitaciones, inducción y reinducción, con la asistencia firmada y el PDF con membrete.
@Component({
  selector: 'app-sst-capacitaciones',
  imports: [FormsModule, Icono, Modal, Confirmar, VisorPdf, FirmaPad, ...FORMATOS, Paginador],
  template: `
    <div class="pagina-cab">
      <div><h1>Capacitaciones</h1>
        <p class="sutil">Programa anual de capacitación, inducción y reinducción. Cada sesión guarda la asistencia con la firma de los asistentes (en la web o en la app del conductor) y sale en PDF con el membrete.</p></div>
      <div class="acciones">
        <label class="visualmente-oculto" for="k-anio">Año</label>
        <select id="k-anio" [(ngModel)]="anio" (change)="cargar()">@for (a of anios; track a) { <option [ngValue]="a">{{ a }}</option> }</select>
        @if (puede) { <button class="primario" (click)="abrirForm()"><app-icono nombre="mas" />Programar capacitación</button> }
      </div>
    </div>

    @if (programa(); as pr) {
      <section class="kpis" aria-label="Indicadores del programa">
        <article class="kpi"><header><span>Programadas</span></header><strong>{{ pr.indicadores.programadas }}</strong><footer>En {{ pr.anio }}</footer></article>
        <article class="kpi"><header><span>Ejecutadas</span></header><strong>{{ pr.indicadores.ejecutadas }}</strong><footer>{{ pr.indicadores.atrasadas }} atrasada(s)</footer></article>
        <article class="kpi"><header><span>Horas dictadas</span></header><strong>{{ pr.indicadores.horas }}</strong><footer>De las ejecutadas</footer></article>
        <article class="kpi destacado"><header><span>Cumplimiento a la fecha</span></header>
          <strong>{{ pr.indicadores.cumplimiento ?? '—' }}{{ pr.indicadores.cumplimiento !== null ? ' %' : '' }}</strong>
          <footer>{{ pr.indicadores.ejecutadas }} de {{ pr.indicadores.aLaFecha }} que ya debían hacerse</footer></article>
      </section>
    }

    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>Fecha</th><th>Tema</th><th>Facilitador</th><th class="num">Asistentes</th><th>Estado</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
      <tbody>
        @for (k of caps.items(); track k.id) {
          <tr>
            <td data-etiqueta="Fecha"><div class="celda-doble"><span>{{ k.fecha | dia }}</span><small>{{ k.horas }} h</small></div></td>
            <td data-etiqueta="Tema"><div class="celda-doble"><strong>{{ k.tema }}</strong><small>{{ EJES[k.eje] }}@if (k.dirigidoA) { · {{ k.dirigidoA }} }</small></div></td>
            <td data-etiqueta="Facilitador">{{ k.facilitador || '—' }}</td>
            <td data-etiqueta="Asistentes" class="num">{{ k.asistentes.length }}@if (k.asistentes.length) { <small class="d-bloque">{{ k.firmados }} firmaron</small> }</td>
            <td data-etiqueta="Estado"><span class="chip" [class]="CHIP[k.estado]">{{ k.estado }}</span></td>
            <td class="celda-acciones"><div class="acciones">
              <button class="pequeno" (click)="abrirAsistencia(k)">Asistencia</button>
              @if (k.asistentes.length) { <button class="pequeno" (click)="verPdf(k)" [attr.aria-label]="'PDF de asistencia de ' + k.tema"><app-icono nombre="ojo" [tam]="15" />PDF</button> }
              @if (puede) { <button class="pequeno texto" (click)="abrirForm(k)" [attr.aria-label]="'Editar ' + k.tema"><app-icono nombre="editar" [tam]="15" /></button> }
            </div></td>
          </tr>
        } @empty {
          @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="6"><span class="esqueleto"></span></td></tr> } }
          @else { <tr><td colspan="6" class="vacio"><strong>Sin capacitaciones en {{ anio }}</strong>Use «Programar capacitación» para armar el programa del año.</td></tr> }
        }
      </tbody>
    </table>
    <app-paginador [total]="caps.total()" [pagina]="caps.pagina()" [porPagina]="caps.porPagina()" [cargando]="caps.cambiando()" unidad="capacitaciones" (cambio)="caps.ir($event)" /></div>

    <!-- Programar o editar -->
    <app-modal [titulo]="editando() ? 'Editar capacitación' : 'Programar capacitación'" [abierto]="formAbierto()" (cerrar)="formAbierto.set(false)">
      <form id="form-cap" class="formulario" (ngSubmit)="guardar()">
        <div class="campo ancho"><label for="k-tema">Tema</label><input id="k-tema" name="tema" [(ngModel)]="f.tema" maxlength="200" required /></div>
        <div class="campo"><label for="k-fecha">Fecha</label><input id="k-fecha" name="fecha" type="date" [(ngModel)]="f.fecha" required /></div>
        <div class="campo"><label for="k-eje">Eje</label><select id="k-eje" name="eje" [(ngModel)]="f.eje"><option value="sst">SST</option><option value="vial">Seguridad vial</option><option value="ambos">SST y seguridad vial</option></select></div>
        <div class="campo"><label for="k-horas">Horas</label><input id="k-horas" name="horas" type="number" min="0.5" step="0.5" [(ngModel)]="f.horas" required /></div>
        <div class="campo"><label for="k-dir">Dirigido a</label><input id="k-dir" name="dir" [(ngModel)]="f.dirigidoA" maxlength="160" placeholder="Conductores contratistas" /></div>
        <div class="campo"><label for="k-fac">Facilitador</label><input id="k-fac" name="fac" [(ngModel)]="f.facilitador" maxlength="160" /></div>
        <div class="campo"><label for="k-lug">Lugar</label><input id="k-lug" name="lug" [(ngModel)]="f.lugar" maxlength="160" /></div>
        <div class="campo ancho"><label for="k-obs">Observaciones</label><textarea id="k-obs" name="obs" rows="2" [(ngModel)]="f.observaciones" maxlength="1000"></textarea></div>
      </form>
      <ng-container pie>
        @if (editando(); as e) { @if (!e.firmados) { <button type="button" class="peligro" confirmar="Clic otra vez para borrar" (confirmado)="eliminar(e)">Borrar</button> } }
        <button type="button" (click)="formAbierto.set(false)">Cancelar</button>
        <button type="submit" form="form-cap" class="primario" [disabled]="trabajando()">Guardar</button>
      </ng-container>
    </app-modal>

    <!-- Asistencia -->
    <app-modal [titulo]="'Asistencia · ' + (sel()?.tema || '')" [abierto]="!!sel()" [ancho]="true" (cerrar)="cerrarAsistencia()">
      @if (sel(); as k) {
        <p class="sutil">{{ k.fecha | dia }} · {{ k.horas }} h · {{ EJES[k.eje] }}@if (k.facilitador) { · {{ k.facilitador }} }</p>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Nombre</th><th>Documento</th><th>Cargo</th><th>Firma</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
          <tbody>
            @for (a of k.asistentes; track a.id) {
              <tr><td data-etiqueta="Nombre">{{ a.nombre }}</td><td data-etiqueta="Documento">{{ a.documento }}</td><td data-etiqueta="Cargo">{{ a.cargo || '—' }}</td>
                <td data-etiqueta="Firma">@if (a.firmado) { <span class="chip ok">{{ a.firmaOrigen === 'app' ? 'En la app' : 'En la web' }}</span> }
                  @else if (a.pendienteApp) { <span class="chip info">Pedida en la app</span> } @else { <span class="chip alerta">Sin firma</span> }</td>
                <td class="celda-acciones">@if (puede && !a.firmado) { <div class="acciones">
                  @if (puedeFirmarHoy(k)) { <button class="pequeno" (click)="firmar(a)">Firmar aquí</button> }
                  <button class="pequeno texto" confirmar="Clic otra vez para quitar" (confirmado)="quitarAsistente(a)">Quitar</button></div> }</td></tr>
            } @empty { <tr><td colspan="5" class="vacio">Sin asistentes. Agréguelos abajo.</td></tr> }
          </tbody>
        </table></div>
        @if (!puedeFirmarHoy(k)) { <p class="nota">La asistencia se firma el día de la capacitación. A los conductores con la app se les pide la firma allá.</p> }

        @if (puede) {
          <section class="agregar">
            <h3 class="sin-margen">Agregar asistentes</h3>
            <div class="barra">
              <div class="campo crece"><label for="a-q">Colaboradores</label><input id="a-q" type="search" placeholder="Buscar por nombre o documento" [(ngModel)]="qColab" /></div>
              <div class="campo"><label for="a-t">Tipo</label><select id="a-t" [(ngModel)]="tColab"><option value="">Todos</option><option value="conductor">Conductores</option><option value="directo">Directos</option></select></div>
            </div>
            <ul class="lista-colabs">
              @for (c of colabsFiltrados(k); track c.id) {
                <li><label class="casilla"><input type="checkbox" [checked]="elegidos.has(c.id)" (change)="alternar(c.id)" /> {{ c.nombre }} <span class="sutil">· {{ c.documento }} · {{ c.cargo || (c.tipo === 'conductor' ? 'Conductor' : '') }}</span></label></li>
              } @empty { <li class="sutil">Nadie con ese filtro (o ya están en la lista).</li> }
            </ul>
            <details><summary>Persona externa (sin perfil)</summary>
              <div class="formulario">
                <div class="campo"><label for="x-n">Nombre</label><input id="x-n" [(ngModel)]="ext.nombre" maxlength="120" /></div>
                <div class="campo"><label for="x-d">Documento</label><input id="x-d" [(ngModel)]="ext.documento" maxlength="15" /></div>
                <div class="campo"><label for="x-c">Cargo o empresa</label><input id="x-c" [(ngModel)]="ext.cargo" maxlength="120" /></div>
              </div>
            </details>
            <label class="casilla"><input type="checkbox" [(ngModel)]="pedirApp" /> Pedir la firma en la app a los conductores que la tienen</label>
            <div class="acciones"><button class="primario pequeno" (click)="agregar(k)" [disabled]="trabajando() || (!elegidos.size && !ext.nombre)"><app-icono nombre="mas" [tam]="15" />Agregar ({{ elegidos.size + (ext.nombre ? 1 : 0) }})</button></div>
          </section>
        }
      }
      <ng-container pie>
        @if (puede && sel(); as k) {
          @if (!k.ejecutada) { <button type="button" (click)="ejecutar(k, true)" [disabled]="trabajando() || !puedeFirmarHoy(k)">Marcar como ejecutada</button> }
          @else { <button type="button" confirmar="Clic otra vez para reabrirla" (confirmado)="ejecutar(k, false)">Reabrir</button> }
        }
        <button type="button" (click)="cerrarAsistencia()">Cerrar</button>
      </ng-container>
    </app-modal>

    <app-modal titulo="Firma del asistente" [abierto]="!!firmando()" (cerrar)="firmando.set(null)">
      <p>{{ firmando()?.nombre }} · {{ firmando()?.documento }}</p>
      <app-firma-pad (cambio)="firma = $event" />
      <ng-container pie><button type="button" (click)="firmando.set(null)">Cancelar</button>
        <button type="button" class="primario" [disabled]="!firma || trabajando()" (click)="guardarFirma()">Guardar firma</button></ng-container>
    </app-modal>

    <app-visor-pdf #visor />
  `,
  styles: [ESTILOS_SST, `
    .lista-colabs { list-style: none; margin: 8px 0; padding: 0; max-height: 220px; overflow: auto; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .lista-colabs li { padding: 6px 10px; border-bottom: 1px solid var(--gris-15); }
    .sin-margen { margin: 0 0 8px; font-size: 14px; }
    details { margin: 8px 0; } summary { cursor: pointer; font-weight: 600; font-size: 13px; }
    .pagina-cab .acciones { align-items: center; }
    .pagina-cab .acciones select { min-height: 38px; width: auto; min-width: 96px; flex: 0 0 auto; }
  `],
})
export class SstCapacitaciones {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private visor = viewChild.required<VisorPdf>('visor');
  readonly puede = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly EJES = EJES; readonly CHIP = CHIP;
  readonly anios = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + 1 - i);
  anio = new Date().getFullYear();
  // Indicadores del año (los calcula el servidor sobre todas las sesiones) y las sesiones por páginas
  readonly programa = signal<Programa | null>(null);
  readonly caps = new ListaServidor<Capacitacion>({
    pedir: (p) => this.api.get<any>('/sst/capacitaciones', { anio: String(this.anio), ...p }),
    alCargar: (r) => this.programa.set({ anio: r.anio, indicadores: r.indicadores, items: [] } as Programa),
    alError: (e) => this.avisos.error(e),
    porPagina: 25,
  });
  readonly cargando = this.caps.cargando;
  readonly trabajando = signal(false);
  readonly formAbierto = signal(false);
  readonly editando = signal<Capacitacion | null>(null);
  readonly sel = signal<Capacitacion | null>(null);
  readonly firmando = signal<Asistente | null>(null);
  colaboradores: Colab[] = [];
  f = this.vacio();
  qColab = ''; tColab = ''; elegidos = new Set<string>(); ext = { nombre: '', documento: '', cargo: '' }; pedirApp = true; firma = '';

  constructor() { this.cargar(); }

  private vacio() { return { tema: '', fecha: hoyIso(), eje: 'sst', horas: 1, dirigidoA: '', facilitador: '', lugar: '', observaciones: '' }; }

  // Otro año: primera página. Al guardar, borrar o cerrar la asistencia: la misma página al día.
  cargar() { return this.caps.recargar(); }
  actualizar() { return this.caps.refrescar(); }

  abrirForm(k?: Capacitacion) {
    this.editando.set(k || null);
    this.f = k ? { tema: k.tema, fecha: aIso(k.fecha), eje: k.eje, horas: k.horas, dirigidoA: k.dirigidoA, facilitador: k.facilitador, lugar: k.lugar, observaciones: k.observaciones } : this.vacio();
    this.formAbierto.set(true);
  }
  async guardar() {
    this.trabajando.set(true);
    try {
      const e = this.editando();
      if (e) await this.api.put(`/sst/capacitaciones/${e.id}`, this.f); else await this.api.post('/sst/capacitaciones', this.f);
      this.formAbierto.set(false); this.avisos.ok('Capacitación guardada.'); await this.actualizar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async eliminar(k: Capacitacion) {
    try { await this.api.delete(`/sst/capacitaciones/${k.id}`); this.formAbierto.set(false); this.avisos.ok('Capacitación borrada.'); await this.actualizar(); } catch (e) { this.avisos.error(e); }
  }

  async abrirAsistencia(k: Capacitacion) {
    this.elegidos = new Set(); this.ext = { nombre: '', documento: '', cargo: '' }; this.qColab = '';
    this.sel.set(k);
    if (this.puede && !this.colaboradores.length) {
      try { this.colaboradores = await this.api.get<Colab[]>('/sst/colaboradores'); } catch (e) { this.avisos.error(e); }
    }
  }
  cerrarAsistencia() { this.sel.set(null); this.actualizar(); }
  colabsFiltrados(k: Capacitacion) {
    const ya = new Set(k.asistentes.map((a) => a.documento)); const t = this.qColab.trim().toLowerCase();
    return this.colaboradores.filter((c) => !ya.has(c.documento) && (!this.tColab || c.tipo === this.tColab) && (!t || c.nombre.toLowerCase().includes(t) || c.documento.includes(t))).slice(0, 100);
  }
  alternar(id: string) { if (this.elegidos.has(id)) this.elegidos.delete(id); else this.elegidos.add(id); }
  puedeFirmarHoy(k: Capacitacion) { return aIso(k.fecha) <= hoyIso(); }

  async agregar(k: Capacitacion) {
    if (this.ext.nombre && !/^[0-9A-Za-z]{4,15}$/.test(this.ext.documento.trim())) { this.avisos.error('Escriba el documento de la persona externa.'); return; }
    this.trabajando.set(true);
    try {
      const r = await this.api.post<Capacitacion & { pedidasApp: number }>(`/sst/capacitaciones/${k.id}/asistentes`, {
        colaboradores: [...this.elegidos], externos: this.ext.nombre ? [{ ...this.ext, documento: this.ext.documento.trim() }] : [], pedirFirmaApp: this.pedirApp,
      });
      this.sel.set(r); this.elegidos = new Set(); this.ext = { nombre: '', documento: '', cargo: '' };
      this.avisos.ok(r.pedidasApp ? `Agregados. Se pidió la firma en la app a ${r.pedidasApp} conductor(es).` : 'Agregados.');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async quitarAsistente(a: Asistente) {
    const k = this.sel(); if (!k) return;
    try { this.sel.set(await this.api.delete<Capacitacion>(`/sst/capacitaciones/${k.id}/asistentes/${a.id}`)); } catch (e) { this.avisos.error(e); }
  }
  firmar(a: Asistente) { this.firma = ''; this.firmando.set(a); }
  async guardarFirma() {
    const k = this.sel(); const a = this.firmando(); if (!k || !a) return;
    this.trabajando.set(true);
    try { this.sel.set(await this.api.post<Capacitacion>(`/sst/capacitaciones/${k.id}/asistentes/${a.id}/firma`, { firma: this.firma })); this.firmando.set(null); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async ejecutar(k: Capacitacion, ejecutada: boolean) {
    this.trabajando.set(true);
    try { this.sel.set(await this.api.post<Capacitacion>(`/sst/capacitaciones/${k.id}/ejecutada`, { ejecutada })); this.avisos.ok(ejecutada ? 'Marcada como ejecutada.' : 'Reabierta.'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  verPdf(k: Capacitacion) { this.visor().ver(`/sst/capacitaciones/${k.id}/pdf`, `Asistencia · ${k.tema}`); }
}
