import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { VisorPdf } from '../shared/visor-pdf';
import { Confirmar } from '../shared/confirmar';
import { FormularioSst, PlantillaSst } from '../shared/formulario-sst';
import { FORMATOS } from '../shared/formato';

const MODULO: Record<string, string> = { sst: 'SG-SST', pesv: 'PESV', ambos: 'SG-SST y PESV' };
const ESTADO: Record<string, string> = { borrador: 'Borrador', diligenciado: 'Diligenciado', firmado: 'Firmado', anulado: 'Anulado' };

// Formatos: los de la plataforma (se diligencian en pantalla con firmas y salen en PDF con el membrete) y los
// propios de la empresa en Word o Excel con marcadores que se llenan solos con los datos de la empresa.
@Component({
  selector: 'app-sst-formatos',
  imports: [FormsModule, Modal, Icono, VisorPdf, Confirmar, FormularioSst, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Formatos</h1><p class="sutil">Los datos fijos (razón social, NIT, representante legal, responsable del SG-SST, fecha…) se llenan solos con los de la empresa y todos salen con su membrete.</p></div>
    </div>
    <nav class="pestanas" role="tablist">
      <button type="button" role="tab" [class.activa]="vista() === 'catalogo'" (click)="vista.set('catalogo')">Formatos de la plataforma</button>
      <button type="button" role="tab" [class.activa]="vista() === 'registros'" (click)="vista.set('registros'); cargarRegistros()">Diligenciados</button>
      <button type="button" role="tab" [class.activa]="vista() === 'propios'" (click)="vista.set('propios'); cargarPropios()">Word y Excel propios</button>
    </nav>

    @if (vista() === 'catalogo') {
      <div class="tarjetas">
        @for (p of plantillas(); track p.codigo) {
          <article class="tarjeta">
            <header><span class="codigo">{{ p.codigo }}</span><span class="chip sin-punto" [class.info]="p.modulo !== 'sst'">{{ modulo(p.modulo) }}</span></header>
            <h3>{{ p.titulo }}</h3>
            <p>{{ p.descripcion }}</p>
            <small class="sutil">Soporta: {{ p.estandar }}</small>
            <footer>
              <button class="pequeno" (click)="visor.ver('/sst/plantillas/' + p.codigo + '/pdf', p.codigo + ' en blanco')"><app-icono nombre="ojo" [tam]="15" />En blanco</button>
              <button class="pequeno primario" (click)="diligenciar(p)"><app-icono nombre="editar" [tam]="15" />Diligenciar</button>
            </footer>
          </article>
        }
      </div>
    }

    @if (vista() === 'registros') {
      <div class="barra"><div class="campo"><label for="r-c">Formato</label><select id="r-c" [(ngModel)]="filtroCodigo" (change)="cargarRegistros()"><option value="">Todos</option>
        @for (p of plantillas(); track p.codigo) { <option [value]="p.codigo">{{ p.codigo }} · {{ p.titulo }}</option> }</select></div></div>
      <div class="tabla-caja"><table class="tabla-movil">
        <thead><tr><th>Formato</th><th>N.°</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @for (r of registros(); track r._id) {
            <tr><td data-etiqueta="Formato"><strong>{{ r.codigo }}</strong><span class="sutil d-bloque">{{ r.titulo }}</span></td><td data-etiqueta="N.°">{{ r.consecutivo }}</td>
              <td data-etiqueta="Fecha">{{ r.createdAt | fechaHora }}</td>
              <td data-etiqueta="Estado"><span class="chip sin-punto" [class.ok]="r.estado === 'firmado'" [class.alerta]="r.estado === 'borrador'" [class.error]="r.estado === 'anulado'">{{ estado(r.estado) }}</span></td>
              <td><div class="acciones" style="justify-content:flex-end">
                @if (gestiona && r.estado !== 'anulado') { <button class="pequeno" (click)="editar(r)">Editar</button> }
                <button class="pequeno" (click)="visor.ver('/sst/registros/' + r._id + '/pdf', r.codigo + ' N.° ' + r.consecutivo, { ver: 1 })"><app-icono nombre="ojo" [tam]="15" />PDF</button>
                <button class="pequeno" (click)="api.descargar('/sst/registros/' + r._id + '/pdf', {}, r.codigo + '.pdf')"><app-icono nombre="descargar" [tam]="15" /></button>
              </div></td></tr>
          } @empty { <tr><td colspan="5" class="vacio"><strong>Sin formatos diligenciados</strong>Diligencie uno desde «Formatos de la plataforma».</td></tr> }
        </tbody>
      </table></div>
    }

    @if (vista() === 'propios') {
      <div class="dos">
        <section class="panel">
          <h2>Subir un formato propio</h2>
          <p class="sutil">Suba su formato en Word o Excel con marcadores como <code>{{ '{{' }}empresa.razonSocial{{ '}}' }}</code>. O suba un formato <strong>ya diligenciado</strong> en Word y la plataforma cambia la razón social, el NIT, la dirección y el responsable por sus marcadores.</p>
          @if (gestiona) {
            <form class="formulario" (ngSubmit)="subir()">
              <div class="campo"><label>Código</label><input name="cod" [(ngModel)]="nuevo.codigo" placeholder="SST-DOC-14" required /></div>
              <div class="campo"><label>Nombre</label><input name="nom" [(ngModel)]="nuevo.nombre" placeholder="Procedimiento de gestión del cambio" required /></div>
              <div class="campo"><label>Estándar que soporta</label><input name="est" [(ngModel)]="nuevo.estandar" placeholder="2.11.1" /></div>
              <div class="campo"><label>Archivo (.docx o .xlsx)</label><input type="file" accept=".docx,.xlsx" (change)="archivo = $any($event.target).files?.[0] || null" required /></div>
              <label class="casilla ancho"><input type="checkbox" name="conv" [(ngModel)]="nuevo.convertir" />Es un formato ya diligenciado: convertir los datos de la empresa en marcadores</label>
              @if (nuevo.convertir) {
                <div class="campo ancho"><label>Textos adicionales a cambiar (uno por línea: texto = marcador)</label>
                  <textarea name="eq" rows="3" [(ngModel)]="nuevo.equivalencias" placeholder="900.109.595-2 = empresa.nitCompleto"></textarea>
                  <small>Útil cuando el formato viejo tiene el NIT o el nombre escritos de otra forma.</small></div>
              }
              <div class="campo"><button class="primario" type="submit" [disabled]="!archivo || trabajando()"><app-icono nombre="mas" />Subir formato</button></div>
            </form>
            @if (resultado(); as r) {
              <div class="mensaje" [class.alerta]="r.desconocidos?.length" [class.info]="!r.desconocidos?.length">
                <strong>{{ r.codigo }} versión {{ r.version }}</strong>: {{ r.marcadores.length }} marcador(es).
                @if (r.cambios?.length) { Se convirtieron: @for (c of r.cambios; track c.texto) { «{{ c.texto }}» → {{ c.marcador }} ({{ c.veces }}) } }
                @if (r.desconocidos?.length) { <br />Marcadores que la plataforma no conoce (quedarán vacíos): {{ r.desconocidos.join(', ') }} }
              </div>
            }
          }
          <div class="tabla-caja" style="margin-top:14px"><table class="tabla-movil">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Versión</th><th>Marcadores</th><th></th></tr></thead>
            <tbody>
              @for (f of propios(); track f._id) {
                <tr><td data-etiqueta="Código"><strong>{{ f.codigo }}</strong></td><td data-etiqueta="Nombre">{{ f.nombre }}<span class="sutil d-bloque">{{ f.estandar }}</span></td>
                  <td data-etiqueta="Tipo"><span class="chip sin-punto info">{{ f.tipo === 'docx' ? 'Word' : 'Excel' }}</span></td><td data-etiqueta="Versión">{{ f.version }}</td>
                  <td data-etiqueta="Marcadores">{{ f.marcadores?.length || 0 }}</td>
                  <td><div class="acciones" style="justify-content:flex-end">
                    <button class="pequeno primario" (click)="api.descargar('/sst/formatos/' + f._id + '/generar', {}, f.codigo + '.' + f.tipo)"><app-icono nombre="descargar" [tam]="15" />Generar lleno</button>
                    @if (gestiona) { <button class="pequeno" (click)="api.descargar('/sst/formatos/' + f._id + '/plantilla', {}, f.codigo + '_plantilla.' + f.tipo)">Plantilla</button>
                      <button class="pequeno texto" confirmar="¿Borrar esta versión?" (confirmado)="borrar(f)"><app-icono nombre="x" [tam]="14" /></button> }
                  </div></td></tr>
              } @empty { <tr><td colspan="6" class="vacio">Aún no hay formatos propios.</td></tr> }
            </tbody>
          </table></div>
        </section>
        <aside class="panel ayuda">
          <h2>Marcadores disponibles</h2>
          <p class="sutil">Escríbalos tal cual en su Word o Excel. En Excel, una celda con <code>{{ '{{' }}empresa.logo{{ '}}' }}</code> recibe el logo.</p>
          <ul>@for (m of marcadores(); track m[0]) { <li><code>{{ '{{' }}{{ m[0] }}{{ '}}' }}</code><span>{{ m[1] }}</span></li> }</ul>
        </aside>
      </div>
    }
    <app-visor-pdf #visor />

    <app-modal [titulo]="(editando()?.codigo || '') + ' · ' + (editando()?.titulo || '')" [abierto]="!!editando()" (cerrar)="editando.set(null)" [ancho]="true">
      @if (editando(); as e) {
        <p class="sutil" style="margin-top:0">{{ e.plantilla.descripcion }} Los campos marcados <span class="auto">auto</span> se llenaron con los datos de la empresa.</p>
        <form id="form-reg" (ngSubmit)="guardar('diligenciado')"><app-formulario-sst [plantilla]="e.plantilla" [datos]="e.datos" /></form>
      }
      <ng-container pie>
        <button type="button" (click)="editando.set(null)">Cancelar</button>
        <button type="button" (click)="guardar('borrador')" [disabled]="trabajando()">Guardar borrador</button>
        <button type="submit" form="form-reg" class="primario" [disabled]="trabajando()">Guardar y ver PDF</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .pestanas { display: flex; gap: 4px; border-bottom: 1px solid var(--gris-2); margin: 0 0 16px; overflow-x: auto; }
    .pestanas button { border: 0; box-shadow: none; background: none; border-radius: 0; border-bottom: 2px solid transparent; padding: 10px 14px; font-weight: 600; color: var(--gris-5); white-space: nowrap; }
    .pestanas button.activa { color: var(--gris-8); border-bottom-color: var(--primario); }
    .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
    .tarjeta { display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); border-top: 3px solid var(--primario); }
    .tarjeta header { display: flex; justify-content: space-between; align-items: center; }
    .codigo { font-size: 12px; font-weight: 800; letter-spacing: .04em; color: var(--primario-texto); }
    .tarjeta h3 { margin: 0; font-size: 15.5px; line-height: 1.3; } .tarjeta p { margin: 0; font-size: 13px; color: var(--gris-6); flex: 1; }
    .tarjeta footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
    .dos { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; align-items: start; }
    @media (max-width: 1000px) { .dos { grid-template-columns: 1fr; } }
    .panel { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 18px; min-width: 0; }
    .panel h2 { margin: 0 0 6px; font-size: 16px; } .formulario .ancho { grid-column: 1 / -1; }
    .ayuda ul { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
    .ayuda li { display: flex; flex-direction: column; gap: 1px; } .ayuda li span { font-size: 12px; color: var(--gris-5); }
    code { font-size: 12px; background: var(--gris-1); border: 1px solid var(--gris-2); border-radius: 6px; padding: 1px 5px; }
    .auto { font-size: 10.5px; font-weight: 700; color: var(--verde-texto); background: var(--verde-claro); border-radius: 5px; padding: 1px 5px; }
  `],
})
export class SstFormatos {
  readonly api = inject(Api);
  private avisos = inject(Avisos);
  readonly gestiona = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly vista = signal<'catalogo' | 'registros' | 'propios'>('catalogo');
  readonly plantillas = signal<PlantillaSst[]>([]);
  readonly registros = signal<any[]>([]);
  readonly propios = signal<any[]>([]);
  readonly marcadores = signal<[string, string][]>([]);
  readonly editando = signal<{ id?: string; codigo: string; titulo: string; plantilla: PlantillaSst; datos: Record<string, any> } | null>(null);
  readonly trabajando = signal(false);
  private visor = viewChild.required(VisorPdf);
  readonly resultado = signal<any>(null);
  filtroCodigo = '';
  archivo: File | null = null;
  nuevo = { codigo: '', nombre: '', estandar: '', convertir: false, equivalencias: '' };
  modulo = (m: string) => MODULO[m] || m;
  estado = (e: string) => ESTADO[e] || e;

  constructor() { this.cargar(); }
  async cargar() {
    try { this.plantillas.set(await this.api.get<PlantillaSst[]>('/sst/plantillas')); } catch (e) { this.avisos.error(e); }
  }
  async cargarRegistros() { try { this.registros.set(await this.api.get<any[]>('/sst/registros', { codigo: this.filtroCodigo })); } catch (e) { this.avisos.error(e); } }
  async cargarPropios() {
    try {
      this.propios.set(await this.api.get<any[]>('/sst/formatos'));
      if (!this.marcadores().length) this.marcadores.set(((await this.api.get<any>('/sst/empresa')).marcadores) || []);
    } catch (e) { this.avisos.error(e); }
  }
  diligenciar(p: PlantillaSst) {
    this.editando.set({ codigo: p.codigo, titulo: p.titulo, plantilla: p, datos: JSON.parse(JSON.stringify(p.prellenado || {})) });
  }
  async editar(r: any) {
    try {
      const d: any = await this.api.get(`/sst/registros/${r._id}`);
      const p = this.plantillas().find(x => x.codigo === d.codigo)!;
      this.editando.set({ id: d._id, codigo: d.codigo, titulo: d.titulo, plantilla: p, datos: d.datos || {} });
    } catch (e) { this.avisos.error(e); }
  }
  async guardar(estado: 'borrador' | 'diligenciado') {
    const e = this.editando()!; this.trabajando.set(true);
    try {
      const r: any = e.id ? await this.api.put(`/sst/registros/${e.id}`, { datos: e.datos, estado }) : await this.api.post('/sst/registros', { codigo: e.codigo, datos: e.datos, estado });
      this.editando.set(null); this.avisos.ok(`${r.codigo} N.° ${r.consecutivo} guardado`);
      this.vista.set('registros'); this.cargarRegistros();
      if (estado === 'diligenciado') this.visor().ver(`/sst/registros/${r._id}/pdf`, `${r.codigo} N.° ${r.consecutivo}`, { ver: 1 });
    } catch (err) { this.avisos.error(err); } finally { this.trabajando.set(false); }
  }
  async subir() {
    if (!this.archivo) return;
    const equivalencias = this.nuevo.equivalencias.split('\n').map(l => l.split('=')).filter(p => p.length === 2 && p[0].trim() && p[1].trim())
      .map(([texto, marcador]) => ({ texto: texto.trim(), marcador: marcador.trim().replace(/[{}]/g, '') }));
    this.trabajando.set(true);
    try {
      const r = await this.api.subirConCabeceras<any>('/sst/formatos', this.archivo,
        { codigo: this.nuevo.codigo, nombre: this.nuevo.nombre, estandar: this.nuevo.estandar, convertir: this.nuevo.convertir ? '1' : '0' },
        { 'X-Equivalencias': encodeURIComponent(JSON.stringify(equivalencias)) });
      this.resultado.set(r); this.avisos.ok('Formato guardado'); this.cargarPropios();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async borrar(f: any) { try { await this.api.delete(`/sst/formatos/${f._id}`); this.cargarPropios(); } catch (e) { this.avisos.error(e); } }
}
