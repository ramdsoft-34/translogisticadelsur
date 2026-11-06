import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, mensajeError } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { FirmaPad } from '../shared/firma-pad';
import { FORMATOS } from '../shared/formato';
import { ESTILOS_SST } from './sst-comun';

interface Formato { codigo: string; titulo: string; alcance: string; descripcion: string; soloApp?: boolean; editable: boolean }
interface Campo { clave: string; etiqueta: string; tipo: string; opciones?: string[]; auto?: string; requerido?: boolean }
interface Seccion { tipo: 'campos' | 'items' | 'texto' | 'tabla' | 'firmas' | 'nota'; titulo?: string; clave?: string; campos?: Campo[]; items?: { clave: string; texto: string }[];
  columnas?: Campo[]; firma?: boolean; firmas?: Campo[]; texto?: string; requerido?: boolean }
interface Definicion extends Formato { secciones: Seccion[]; auto: Record<string, string> }
interface Diligenciado { id: string; codigo: string; numero: string; titulo: string; estado: 'borrador' | 'final'; datos: Record<string, any>; items: { clave: string; valor: string; observacion: string }[];
  version: number; versiones: { version: number; guardadoEn: string; guardadoPor: string }[]; origen: string; autorNombre: string; actualizado: string; firmados: string[] }
interface Archivo { id: string; nombre: string; descripcion: string; tipo: 'docx' | 'xlsx'; tamano: number; subidoPor: string; fecha: string }
interface Incidente { id: string; tipo: string; nombreTipo: string; fecha: string; lugar: string; placa: string; descripcion: string; estado: string; lesionados: boolean; cuantos: number;
  conductor: { nombre: string; cedula: string } | null; reportado: string }
type Vista = 'plataforma' | 'diligenciados' | 'propios' | 'reportes';
const ESTADOS_INC: Record<string, string> = { recibido: 'Sin revisar', en_investigacion: 'En investigación', cerrado: 'Cerrado' };

// Formatos de SG-SST y PESV: los de la plataforma (en blanco, diligenciar, borrador, versión final y PDF con membrete),
// los diligenciados, los Word y Excel propios con variables y los reportes de incidentes que llegan de la app.
@Component({
  selector: 'app-sst-formatos',
  imports: [FormsModule, RouterLink, Icono, Modal, Confirmar, VisorPdf, FirmaPad, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Formatos</h1>
        <p class="sutil">Los datos fijos (razón social, NIT, representante legal, responsable del SG-SST, fecha…) se llenan solos con los de la empresa y todos salen con su membrete.</p></div>
    </div>

    <div class="pestanas" role="tablist">
      @for (t of vistas; track t[0]) { <button type="button" role="tab" [class.activa]="vista() === t[0]" (click)="cambiar(t[0])">{{ t[1] }}
        @if (t[0] === 'reportes' && sinRevisar()) { <span class="chip alerta sin-punto">{{ sinRevisar() }}</span> }</button> }
    </div>

    @switch (vista()) {
      @case ('plataforma') {
        <div class="tarjetas">
          @for (f of catalogo(); track f.codigo) {
            <article class="formato">
              <header><span class="codigo">{{ f.codigo }}</span><span class="chip info sin-punto">{{ f.alcance }}</span></header>
              <h2>{{ f.titulo }}</h2>
              <p class="sutil">{{ f.descripcion }}</p>
              <footer class="acciones">
                <button class="pequeno" (click)="enBlanco(f)"><app-icono nombre="ojo" [tam]="15" />En blanco</button>
                @if (f.soloApp) { <a class="boton pequeno" routerLink="/sst/flota" [queryParams]="{ vista: 'inspecciones' }">Ver inspecciones</a> }
                @else if (puede) { <button class="pequeno primario" (click)="diligenciar(f.codigo)"><app-icono nombre="editar" [tam]="15" />Diligenciar</button> }
              </footer>
            </article>
          }
        </div>
        <p class="nota">Las referencias a la normativa se mostrarán cuando el responsable del SG-SST las valide.</p>
      }
      @case ('diligenciados') {
        <div class="barra">
          <div class="campo"><label for="d-cod">Formato</label><select id="d-cod" [(ngModel)]="fCodigo" (change)="cargarDiligenciados()"><option value="">Todos</option>
            @for (f of catalogo(); track f.codigo) { @if (!f.soloApp) { <option [value]="f.codigo">{{ f.codigo }}</option> } }</select></div>
          <div class="campo crece"><label for="d-q">Buscar</label><input id="d-q" type="search" [(ngModel)]="fQ" (change)="cargarDiligenciados()" placeholder="Número, placa, nombre…" /></div>
        </div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Número</th><th>Formato</th><th>Estado</th><th>Actualizado</th><th>Autor</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
          <tbody>
            @for (x of diligenciados(); track x.id) {
              <tr><td data-etiqueta="Número"><strong>{{ x.numero }}</strong>@if (x.origen === 'app') { <small class="d-bloque">Reporte de la app</small> }</td>
                <td data-etiqueta="Formato">{{ x.titulo }}</td>
                <td data-etiqueta="Estado"><span class="chip" [class.ok]="x.estado === 'final'" [class.alerta]="x.estado === 'borrador'">{{ x.estado === 'final' ? 'Versión ' + x.version : 'Borrador' }}</span></td>
                <td data-etiqueta="Actualizado">{{ x.actualizado | fechaHora }}</td><td data-etiqueta="Autor">{{ x.autorNombre }}</td>
                <td class="celda-acciones"><div class="acciones">
                  <button class="pequeno" (click)="verPdf(x)"><app-icono nombre="ojo" [tam]="15" />PDF</button>
                  @if (puede) { <button class="pequeno" (click)="editar(x)"><app-icono nombre="editar" [tam]="15" />{{ x.estado === 'final' ? 'Nueva versión' : 'Continuar' }}</button> }
                  @if (puede && x.estado === 'borrador') { <button class="pequeno texto" confirmar="Clic otra vez para borrar" (confirmado)="borrar(x)">Borrar</button> }
                </div></td></tr>
            } @empty { <tr><td colspan="6" class="vacio">Sin formatos diligenciados.</td></tr> }
          </tbody>
        </table></div>
      }
      @case ('propios') {
        <div class="tarjeta">
          <p>Suba sus Word (.docx) o Excel (.xlsx). Al descargarlos se llenan estas marcas con los datos de la empresa:</p>
          <ul class="variables">@for (v of variables(); track v[0]) { <li><code>{{ '{{' + v[0] + '}}' }}</code> <span class="sutil">{{ v[1] || '(vacío)' }}</span></li> }
            <li><code>{{ '{{empresa.logo}}' }}</code> <span class="sutil">el logo</span></li>
            <li><code>{{ '{{membrete.encabezado}}' }}</code> · <code>{{ '{{membrete.pie}}' }}</code> <span class="sutil">las franjas del membrete</span></li></ul>
          @if (puede) {
            <div class="barra">
              <div class="campo crece"><label for="a-desc">Descripción (opcional)</label><input id="a-desc" [(ngModel)]="descArchivo" maxlength="300" /></div>
              <label class="boton primario"><input type="file" class="visualmente-oculto" accept=".docx,.xlsx" (change)="subirArchivo($event)" /><app-icono nombre="mas" />Subir Word o Excel</label>
            </div>
          }
        </div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Archivo</th><th>Tipo</th><th>Subido</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
          <tbody>
            @for (a of archivos(); track a.id) {
              <tr><td data-etiqueta="Archivo"><div class="celda-doble"><strong>{{ a.nombre }}</strong>@if (a.descripcion) { <small>{{ a.descripcion }}</small> }</div></td>
                <td data-etiqueta="Tipo">{{ a.tipo === 'docx' ? 'Word' : 'Excel' }} · {{ (a.tamano / 1024) | miles }} KB</td>
                <td data-etiqueta="Subido">{{ a.fecha | dia }} · {{ a.subidoPor }}</td>
                <td class="celda-acciones"><div class="acciones"><button class="pequeno" (click)="descargarArchivo(a)"><app-icono nombre="descargar" [tam]="15" />Descargar con datos</button>
                  @if (puede) { <button class="pequeno texto" confirmar="Clic otra vez para borrar" (confirmado)="borrarArchivo(a)">Borrar</button> }</div></td></tr>
            } @empty { <tr><td colspan="4" class="vacio">Sin archivos propios.</td></tr> }
          </tbody>
        </table></div>
      }
      @case ('reportes') {
        <p class="sutil">Incidentes, accidentes viales y condiciones inseguras que reportan los conductores desde la app. Es el reporte inicial: la investigación se hace después.</p>
        @if (!usaApp()) { <div class="mensaje info" role="status">Esta empresa todavía no usa la app de conductores.</div> }
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Reportado</th><th>Tipo</th><th>Conductor</th><th>Qué pasó</th><th>Estado</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
          <tbody>
            @for (i of incidentes(); track i.id) {
              <tr><td data-etiqueta="Reportado"><div class="celda-doble"><span>{{ i.reportado | fechaHora }}</span><small>Ocurrió {{ i.fecha | fechaHora }}</small></div></td>
                <td data-etiqueta="Tipo"><span class="chip" [class.error]="i.tipo === 'accidente'" [class.alerta]="i.tipo !== 'accidente'">{{ i.nombreTipo }}</span>@if (i.lesionados) { <small class="d-bloque texto-error">{{ i.cuantos }} lesionado(s)</small> }</td>
                <td data-etiqueta="Conductor"><div class="celda-doble"><span>{{ i.conductor?.nombre || '—' }}</span>@if (i.placa) { <small><span class="placa">{{ i.placa }}</span></small> }</div></td>
                <td data-etiqueta="Qué pasó"><div class="celda-doble"><span>{{ i.descripcion }}</span>@if (i.lugar) { <small>{{ i.lugar }}</small> }</div></td>
                <td data-etiqueta="Estado">@if (puede) {
                  <select class="pequeno" [ngModel]="i.estado" (ngModelChange)="estadoIncidente(i, $event)" [attr.aria-label]="'Estado del reporte'"><option value="recibido">Sin revisar</option><option value="en_investigacion">En investigación</option><option value="cerrado">Cerrado</option></select>
                } @else { <span class="chip">{{ ESTADOS_INC[i.estado] }}</span> }</td>
                <td class="celda-acciones">@if (puede) { <button class="pequeno" (click)="comoFormato(i)">Registrar en PESV-FOR-01</button> }</td></tr>
            } @empty { <tr><td colspan="6" class="vacio">Sin reportes.</td></tr> }
          </tbody>
        </table></div>
      }
    }

    <!-- Diligenciar -->
    <app-modal [titulo]="def() ? def()!.codigo + ' · ' + def()!.titulo : ''" [abierto]="!!def()" [ancho]="true" (cerrar)="def.set(null)">
      @if (def(); as d) {
        <p class="sutil">{{ d.descripcion }} Los campos marcados <span class="chip ok sin-punto">auto</span> se llenaron con los datos de la empresa.</p>
        @if (actual(); as x) { <p class="nota">{{ x.numero }} · {{ x.estado === 'final' ? 'Al guardar como final queda la versión ' + (x.version + 1) + '; la anterior se conserva.' : 'Borrador' }}</p> }
        <form id="form-formato" (ngSubmit)="guardar(true)">
          @for (s of d.secciones; track $index) {
            @switch (s.tipo) {
              @case ('campos') {
                <section class="bloque"><h3>{{ s.titulo }}</h3><div class="formulario">
                  @for (c of s.campos; track c.clave) {
                    <div class="campo"><label [for]="'f-' + c.clave">{{ c.etiqueta }} @if (c.auto) { <span class="chip ok sin-punto">auto</span> } @if (c.requerido) { <span class="obligatorio">*</span> }</label>
                      @switch (c.tipo) {
                        @case ('fecha') { <input [id]="'f-' + c.clave" [name]="c.clave" type="date" [(ngModel)]="datos[c.clave]" /> }
                        @case ('hora') { <input [id]="'f-' + c.clave" [name]="c.clave" type="time" [(ngModel)]="datos[c.clave]" /> }
                        @case ('numero') { <input [id]="'f-' + c.clave" [name]="c.clave" type="number" min="0" [(ngModel)]="datos[c.clave]" /> }
                        @case ('seleccion') { <select [id]="'f-' + c.clave" [name]="c.clave" [(ngModel)]="datos[c.clave]"><option value="">—</option>@for (o of c.opciones; track o) { <option [value]="o">{{ o }}</option> }</select> }
                        @case ('placa') { <input [id]="'f-' + c.clave" [name]="c.clave" [(ngModel)]="datos[c.clave]" maxlength="7" class="mayus" /> }
                        @default { <input [id]="'f-' + c.clave" [name]="c.clave" [(ngModel)]="datos[c.clave]" maxlength="160" /> }
                      }</div>
                  }
                </div></section>
              }
              @case ('items') {
                <section class="bloque"><div class="seccion-cab"><h3>{{ s.titulo }}</h3><button type="button" class="texto pequeno" (click)="todoCumple(s)">Marcar todo «Cumple»</button></div>
                  <ol class="items">
                    @for (it of s.items; track it.clave) {
                      <li><span class="texto-item">{{ it.texto }}</span>
                        <div class="segmentos" role="group" [attr.aria-label]="it.texto">
                          @for (o of opcionesItem; track o[0]) { <button type="button" [class.activo]="items[it.clave].valor === o[0]" (click)="items[it.clave].valor = o[0]">{{ o[1] }}</button> }
                        </div>
                        @if (items[it.clave].valor === 'no_cumple') { <input class="obs" [name]="'obs-' + it.clave" [(ngModel)]="items[it.clave].observacion" placeholder="Observación (obligatoria)" maxlength="300" [attr.aria-label]="'Observación de ' + it.texto" /> }
                      </li>
                    }
                  </ol></section>
              }
              @case ('texto') {
                <section class="bloque"><h3>{{ s.titulo }} @if (s.requerido) { <span class="obligatorio">*</span> }</h3>
                  <textarea [name]="s.clave!" rows="3" [(ngModel)]="datos[s.clave!]" maxlength="4000" [attr.aria-label]="s.titulo"></textarea></section>
              }
              @case ('tabla') {
                <section class="bloque"><h3>{{ s.titulo }}</h3>
                  @for (f of tablas[s.clave!]; track $index; let i = $index) {
                    <div class="fila-tabla">
                      @for (c of s.columnas; track c.clave) {
                        @if (c.tipo === 'seleccion') { <select [name]="s.clave! + i + c.clave" [(ngModel)]="f[c.clave]" [attr.aria-label]="c.etiqueta"><option value="">{{ c.etiqueta }}</option>@for (o of c.opciones; track o) { <option [value]="o">{{ o }}</option> }</select> }
                        @else { <input [name]="s.clave! + i + c.clave" [type]="c.tipo === 'fecha' ? 'date' : c.tipo === 'numero' ? 'number' : 'text'" [(ngModel)]="f[c.clave]" [placeholder]="c.etiqueta" [attr.aria-label]="c.etiqueta" maxlength="160" /> }
                      }
                      @if (s.firma) { @if (firmaDe(s.clave! + '.' + i)) { <span class="chip ok">Firmado</span> } @else { <button type="button" class="pequeno" (click)="abrirFirma(s.clave! + '.' + i)">Firmar</button> } }
                      <button type="button" class="pequeno texto" (click)="quitarFila(s.clave!, i)" aria-label="Quitar fila"><app-icono nombre="x" [tam]="14" /></button>
                    </div>
                  }
                  <button type="button" class="pequeno" (click)="tablas[s.clave!].push({})"><app-icono nombre="mas" [tam]="14" />Agregar fila</button></section>
              }
              @case ('firmas') {
                <section class="bloque"><h3>Firmas</h3><div class="acciones">
                  @for (c of s.firmas; track c.clave) { @if (firmaDe(c.clave)) { <span class="chip ok">{{ c.etiqueta }}: firmado</span> } @else { <button type="button" class="pequeno" (click)="abrirFirma(c.clave)">{{ c.etiqueta }}</button> } }
                </div></section>
              }
              @case ('nota') { <p class="mensaje info">{{ s.texto }}</p> }
            }
          }
          @if (error()) { <div class="mensaje error" role="alert">{{ error() }}</div> }
        </form>
      }
      <ng-container pie>
        <button type="button" (click)="def.set(null)">Cancelar</button>
        <button type="button" (click)="guardar(false)" [disabled]="trabajando()">Guardar borrador</button>
        <button type="submit" form="form-formato" class="primario" [disabled]="trabajando()">Guardar y ver PDF</button>
      </ng-container>
    </app-modal>

    <app-modal titulo="Firma" [abierto]="!!firmaClave()" (cerrar)="firmaClave.set(null)">
      <app-firma-pad (cambio)="firmaTemp = $event" />
      <ng-container pie><button type="button" (click)="firmaClave.set(null)">Cancelar</button>
        <button type="button" class="primario" [disabled]="!firmaTemp" (click)="ponerFirma()">Usar esta firma</button></ng-container>
    </app-modal>

    <app-visor-pdf #visor />
  `,
  styles: [ESTILOS_SST, `
    .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .formato { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px; background: var(--gris-0); border: 1px solid var(--gris-2); border-top: 3px solid var(--primario); border-radius: var(--radio-l); }
    .formato header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .formato .codigo { font-weight: 750; font-size: 12px; letter-spacing: .06em; color: var(--primario-texto); }
    .formato h2 { font-size: 15.5px; margin: 0; } .formato p { margin: 0; flex: 1; }
    .formato footer { justify-content: flex-end; }
    a.boton, label.boton { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: 1px solid var(--gris-3); border-radius: 8px; background: var(--gris-0); font-weight: 600; text-decoration: none; color: inherit; padding: 6px 12px; }
    label.boton.primario { background: var(--primario); border-color: var(--primario-borde); color: var(--sobre-primario); }
    .variables { columns: 2; font-size: 13px; padding-left: 18px; } .variables li { break-inside: avoid; margin-bottom: 4px; }
    .bloque .seccion-cab h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--gris-6); }
    .items { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 8px; }
    .items li { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--gris-15); }
    .items .texto-item { flex: 1 1 260px; }
    .items .obs { flex: 1 1 100%; }
    .fila-tabla { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
    .fila-tabla > input, .fila-tabla > select { flex: 1 1 140px; min-width: 0; }
    textarea { width: 100%; }
    .mayus { text-transform: uppercase; }
    .texto-error { color: var(--rojo); font-weight: 600; }
    select.pequeno { min-height: 32px; padding: 2px 8px; }
    @media (max-width: 700px) { .variables { columns: 1; } }
  `],
})
export class SstFormatos {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private visor = viewChild.required<VisorPdf>('visor');
  readonly puede = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly ESTADOS_INC = ESTADOS_INC;
  readonly vistas: [Vista, string][] = [['plataforma', 'Formatos de la plataforma'], ['diligenciados', 'Diligenciados'], ['propios', 'Word y Excel propios'], ['reportes', 'Reportes desde la app']];
  readonly opcionesItem: [string, string][] = [['cumple', 'Cumple'], ['no_cumple', 'No cumple'], ['na', 'N/A']];
  readonly vista = signal<Vista>('plataforma');
  readonly catalogo = signal<Formato[]>([]);
  readonly diligenciados = signal<Diligenciado[]>([]);
  readonly archivos = signal<Archivo[]>([]);
  readonly variables = signal<[string, string][]>([]);
  readonly incidentes = signal<Incidente[]>([]);
  readonly usaApp = signal(true);
  readonly sinRevisar = signal(0);
  readonly def = signal<Definicion | null>(null);
  readonly actual = signal<Diligenciado | null>(null);
  readonly trabajando = signal(false);
  readonly error = signal('');
  readonly firmaClave = signal<string | null>(null);
  datos: Record<string, any> = {}; items: Record<string, { valor: string; observacion: string }> = {}; tablas: Record<string, Record<string, string>[]> = {};
  firmas: Record<string, string> = {}; firmaTemp = '';
  fCodigo = ''; fQ = ''; descArchivo = '';

  constructor() {
    this.api.get<Formato[]>('/sst/formatos').then((l) => this.catalogo.set(l)).catch((e) => this.avisos.error(e));
    this.cargarIncidentes(true);
    const v = inject(ActivatedRoute).snapshot.queryParamMap.get('vista') as Vista | null;
    if (v && this.vistas.some((x) => x[0] === v)) this.cambiar(v);
  }

  cambiar(v: Vista) {
    this.vista.set(v);
    if (v === 'diligenciados') this.cargarDiligenciados();
    if (v === 'propios') this.cargarArchivos();
    if (v === 'reportes') this.cargarIncidentes();
  }

  async cargarDiligenciados() {
    try { this.diligenciados.set(await this.api.get<Diligenciado[]>('/sst/diligenciados', { codigo: this.fCodigo, q: this.fQ })); } catch (e) { this.avisos.error(e); }
  }
  async cargarArchivos() {
    try {
      const [a, v] = await Promise.all([this.api.get<Archivo[]>('/sst/archivos'), this.api.get<Record<string, string>>('/sst/variables')]);
      this.archivos.set(a); this.variables.set(Object.entries(v).map(([k, x]) => [k, String(x ?? '')]));
    } catch (e) { this.avisos.error(e); }
  }
  async cargarIncidentes(soloContar = false) {
    try {
      const r = await this.api.get<{ usaApp: boolean; items: Incidente[] }>('/sst/incidentes');
      this.usaApp.set(r.usaApp); this.sinRevisar.set(r.items.filter((i) => i.estado === 'recibido').length);
      if (!soloContar) this.incidentes.set(r.items);
    } catch (e) { if (!soloContar) this.avisos.error(e); }
  }

  enBlanco(f: Formato) { this.visor().ver(`/sst/formatos/${f.codigo}/en-blanco`, `${f.codigo} en blanco`); }
  verPdf(x: Diligenciado) { this.visor().ver(`/sst/diligenciados/${x.id}/pdf`, x.numero); }

  async diligenciar(codigo: string, x: Diligenciado | null = null) {
    try {
      const d = await this.api.get<Definicion>(`/sst/formatos/${codigo}/definicion`);
      this.datos = { ...d.auto, ...(x?.datos || {}) }; delete this.datos['tablas'];
      this.items = {}; this.tablas = {}; this.firmas = {};
      for (const s of d.secciones) {
        if (s.tipo === 'items') for (const it of s.items!) { const v = x?.items.find((i) => i.clave === it.clave); this.items[it.clave] = { valor: v?.valor || '', observacion: v?.observacion || '' }; }
        if (s.tipo === 'tabla') this.tablas[s.clave!] = (x?.datos?.['tablas']?.[s.clave!] || []).map((f: Record<string, string>) => ({ ...f }));
      }
      for (const k of x?.firmados || []) this.firmas[k] = 'guardada';
      this.error.set(''); this.actual.set(x); this.def.set(d);
    } catch (e) { this.avisos.error(e); }
  }
  editar(x: Diligenciado) { this.diligenciar(x.codigo, x); }

  todoCumple(s: Seccion) { for (const it of s.items!) if (!this.items[it.clave].valor) this.items[it.clave].valor = 'cumple'; }
  quitarFila(clave: string, i: number) {
    // Una fila con firma ya guardada (o con filas firmadas debajo) no se quita: la firma quedaría en otra fila
    if (Object.entries(this.firmas).some(([k, v]) => v === 'guardada' && k.startsWith(`${clave}.`) && Number(k.split('.').pop()) >= i)) {
      this.avisos.error('Esa fila (o una de abajo) ya tiene firma guardada: no se puede quitar.');
      return;
    }
    this.tablas[clave].splice(i, 1);
    // Las firmas de las filas siguientes se corren una posición
    const nuevas: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.firmas)) {
      const m = new RegExp(`^${clave}\\.(\\d+)$`).exec(k);
      if (!m) { nuevas[k] = v; continue; }
      const n = Number(m[1]); if (n === i) continue; nuevas[`${clave}.${n > i ? n - 1 : n}`] = v;
    }
    this.firmas = nuevas;
  }
  firmaDe(clave: string) { return !!this.firmas[clave]; }
  abrirFirma(clave: string) { this.firmaTemp = ''; this.firmaClave.set(clave); }
  ponerFirma() { const k = this.firmaClave(); if (k) this.firmas[k] = this.firmaTemp; this.firmaClave.set(null); }

  async guardar(final: boolean) {
    const d = this.def(); if (!d) return;
    this.error.set('');
    const cuerpo = {
      datos: this.datos, tablas: this.tablas, final,
      items: Object.entries(this.items).map(([clave, v]) => ({ clave, valor: v.valor, observacion: v.observacion })),
      // Solo las firmas nuevas (las guardadas ya están en el servidor)
      firmas: Object.fromEntries(Object.entries(this.firmas).filter(([, v]) => v.startsWith('data:'))),
    };
    this.trabajando.set(true);
    try {
      const x = this.actual();
      const r = x ? await this.api.put<Diligenciado>(`/sst/diligenciados/${x.id}`, cuerpo) : await this.api.post<Diligenciado>(`/sst/formatos/${d.codigo}/diligenciados`, cuerpo);
      this.actual.set(r);
      for (const k of r.firmados) this.firmas[k] = 'guardada';
      if (final) { this.def.set(null); this.verPdf(r); this.avisos.ok(`${r.numero} guardado (versión ${r.version}).`); } else this.avisos.ok(`Borrador ${r.numero} guardado.`);
      if (this.vista() === 'diligenciados') this.cargarDiligenciados();
    } catch (e) { this.error.set(await mensajeError(e)); } finally { this.trabajando.set(false); }
  }
  async borrar(x: Diligenciado) {
    try { await this.api.delete(`/sst/diligenciados/${x.id}`); this.cargarDiligenciados(); } catch (e) { this.avisos.error(e); }
  }

  async subirArchivo(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = '';
    if (!f) return;
    if (!/\.(docx|xlsx)$/i.test(f.name)) { this.avisos.error('Suba un Word (.docx) o un Excel (.xlsx).'); return; }
    if (f.size > 10 * 1024 * 1024) { this.avisos.error('El archivo pesa más de 10 MB.'); return; }
    try {
      await this.api.subirConCabeceras('/sst/archivos', f, { 'X-Descripcion': encodeURIComponent(this.descArchivo).slice(0, 600) });
      this.descArchivo = ''; this.avisos.ok('Archivo subido.'); this.cargarArchivos();
    } catch (e) { this.avisos.error(e); }
  }
  descargarArchivo(a: Archivo) { this.api.descargar(`/sst/archivos/${a.id}`, undefined, a.nombre).catch((e) => this.avisos.error(e)); }
  async borrarArchivo(a: Archivo) { try { await this.api.delete(`/sst/archivos/${a.id}`); this.cargarArchivos(); } catch (e) { this.avisos.error(e); } }

  async estadoIncidente(i: Incidente, estado: string) {
    try { await this.api.put(`/sst/incidentes/${i.id}`, { estado, nota: '' }); this.avisos.ok('Estado actualizado.'); this.cargarIncidentes(); } catch (e) { this.avisos.error(e); }
  }
  async comoFormato(i: Incidente) {
    try {
      const x = await this.api.post<Diligenciado>(`/sst/incidentes/${i.id}/formato`);
      this.avisos.ok(`Quedó como ${x.numero}. Complete las acciones y guárdelo.`);
      this.editar(x);
    } catch (e) { this.avisos.error(e); }
  }
}
