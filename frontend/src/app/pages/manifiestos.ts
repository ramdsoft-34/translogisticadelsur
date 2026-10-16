import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { Viaje } from '../core/modelos';
import { Moneda } from '../shared/moneda';
import { CargarMas } from '../shared/cargar-mas';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { FORMATOS, hoyIso, isoDia } from '../shared/formato';

type Pestana = 'pendientes' | 'manifestados' | 'cumplidos' | 'historial';
const ESTADOS: Record<Exclude<Pestana, 'historial'>, string> = {
  pendientes: 'registrado,remesa', manifestados: 'manifestado', cumplidos: 'cumplido',
};

@Component({
  selector: 'app-manifiestos',
  imports: [FormsModule, Modal, Icono, Moneda, CargarMas, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Manifiestos RNDC</h1><p class="sutil">Expida remesa y manifiesto, registre cumplidos y anulaciones ante el Ministerio de Transporte.</p></div>
      @if (pestana() === 'pendientes' && seleccion().size) {
        <button class="primario" (click)="enviarLote()" [disabled]="trabajando()"><app-icono nombre="enviar" />Enviar {{ seleccion().size }} seleccionado(s)</button>
      }
    </div>

    @if (ambiente() && ambiente() !== 'PRODUCCION') {
      <div class="mensaje alerta" style="margin-bottom:14px">
        Ambiente RNDC: <strong>{{ ambiente() === 'SIMULADO' ? 'simulador local' : 'pruebas del Ministerio' }}</strong>.
        Los documentos expedidos aquí no tienen validez legal. El administrador lo cambia en Configuración.
      </div>
    }

    <div class="pestanas">
      <button [class.activa]="pestana() === 'pendientes'" (click)="ir('pendientes')">Por enviar</button>
      <button [class.activa]="pestana() === 'manifestados'" (click)="ir('manifestados')">Manifestados</button>
      <button [class.activa]="pestana() === 'cumplidos'" (click)="ir('cumplidos')">Cumplidos</button>
      <button [class.activa]="pestana() === 'historial'" (click)="ir('historial')">Historial de envíos</button>
    </div>

    @if (pestana() !== 'historial') {
      <div class="tabla-caja">
        <table>
          <thead><tr>
            @if (pestana() === 'pendientes') { <th><input type="checkbox" aria-label="Seleccionar todos" [checked]="todos()" (change)="alternarTodos()" /></th> }
            <th>N°</th><th>Fecha</th><th>Cliente / destino</th><th>Placa</th><th>Conductor</th><th class="num">Flete</th>
            <th>Remesa</th><th>Manifiesto</th><th></th></tr></thead>
          <tbody>
            @for (v of viajes(); track v._id) {
              <tr>
                @if (pestana() === 'pendientes') { <td><input type="checkbox" [attr.aria-label]="'Seleccionar viaje ' + v.numero" [checked]="seleccion().has(v._id)" (change)="alternar(v._id)" /></td> }
                <td>{{ v.numero }}</td><td>{{ v.fecha | dia }}</td>
                <td>{{ v.cliente?.nombre }}<br /><span class="sutil">{{ v.destino }}</span></td>
                <td><strong>{{ v.placa }}</strong></td><td>{{ v.conductorNombre }}</td><td class="num">{{ v.flete | pesos }}</td>
                <td>@if (v.remesa.numero) { {{ v.remesa.numero }}<br /><span class="chip" [class]="chip(v.remesa.estado)">{{ v.remesa.estado || 'sin enviar' }}</span> }</td>
                <td>@if (v.manifiesto.numero) { {{ v.manifiesto.numero }}<br /><span class="chip" [class]="chip(v.manifiesto.estado)">{{ v.manifiesto.estado || 'sin enviar' }}</span> }
                  @if (v.manifiesto.radicado && v.manifiesto.estado === 'aceptado') { <br /><span class="sutil">Rad. {{ v.manifiesto.radicado }}</span> }</td>
                <td>
                  <div class="acciones" style="justify-content:flex-end">
                    @switch (pestana()) {
                      @case ('pendientes') {
                        <button class="pequeno" (click)="revisar(v)">Revisar</button>
                        <button class="pequeno primario" (click)="despachar(v)" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="15" />Enviar</button>
                        @if (v.estado === 'remesa') { <button class="pequeno peligro" (click)="abrirAnular(v)" title="Anular la remesa aceptada">Anular remesa</button> }
                      }
                      @case ('manifestados') {
                        <button class="pequeno" (click)="pdf(v)"><app-icono nombre="descargar" [tam]="15" />PDF</button>
                        <button class="pequeno primario" (click)="abrirCumplido(v)">Cumplir</button>
                        <button class="pequeno peligro" (click)="abrirAnular(v)">Anular</button>
                      }
                      @case ('cumplidos') {
                        <button class="pequeno" (click)="pdf(v)"><app-icono nombre="descargar" [tam]="15" />PDF</button>
                        <button class="pequeno peligro" (click)="abrirAnular(v)">Anular cumplido</button>
                      }
                    }
                  </div>
                </td>
              </tr>
              @if (mensajeError(v); as m) {
                <tr><td [attr.colspan]="pestana() === 'pendientes' ? 10 : 9" style="padding-top:0"><div class="mensaje error">{{ m }}</div></td></tr>
              }
            } @empty {
              @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="10"><span class="esqueleto"></span></td></tr> } }
              @else { <tr><td colspan="10" class="vacio"><strong>Nada pendiente en esta lista</strong>Los viajes aparecen aquí según su estado en el RNDC.</td></tr> }
            }
          </tbody>
        </table>
        @if (viajes().length) { <app-cargar-mas [mostrados]="viajes().length" [total]="total()" [cargando]="cargandoMas()" unidad="viajes" (mas)="cargarMas()" /> }
      </div>
    } @else {
      <div class="tabla-caja">
        <table>
          <thead><tr><th>Fecha</th><th>Proceso</th><th>Referencia</th><th>Usuario</th><th>Resultado</th><th>Ambiente</th></tr></thead>
          <tbody>
            @for (t of transacciones(); track t._id) {
              <tr><td>{{ t.createdAt | fechaHora }}</td><td>{{ procesos()[t.proceso] || t.proceso }}{{ t.tipo !== 1 ? ' (consulta)' : '' }}</td>
                <td>{{ t.referencia }}</td><td>{{ t.usuario?.nombre }}</td>
                <td>@if (t.ok) { <span class="chip ok">Aceptado {{ t.radicado ? '· ' + t.radicado : '' }}</span> } @else { <span class="chip error" [title]="t.mensaje">Rechazado</span><div class="sutil">{{ t.mensaje }}</div> }</td>
                <td>{{ t.ambiente }}</td></tr>
            } @empty { <tr><td colspan="6" class="vacio">Sin envíos registrados</td></tr> }
          </tbody>
        </table>
      </div>
    }

    <!-- Revisión previa -->
    <app-modal titulo="Revisión antes de enviar" [abierto]="!!previa()" (cerrar)="previa.set(null)" [ancho]="true">
      @if (previa(); as p) {
        @if (p.avisos.length) { <div class="mensaje alerta" style="margin-bottom:12px"><strong>Revise:</strong><ul>@for (a of p.avisos; track a) { <li>{{ a }}</li> }</ul></div> }
        @for (doc of [['Remesa', p.remesa], ['Manifiesto', p.manifiesto]]; track doc[0]) {
          <h3>{{ doc[0] }}</h3>
          @if (doc[1].problemas.length) { <div class="mensaje error" style="margin-bottom:8px"><strong>Faltan datos:</strong><ul>@for (x of doc[1].problemas; track x) { <li>{{ x }}</li> }</ul></div> }
          @else { <div class="mensaje ok" style="margin-bottom:8px">Completa según el diccionario de datos del RNDC.</div> }
          <details style="margin-bottom:14px"><summary>Ver variables que se enviarán</summary>
            <table><tbody>@for (x of doc[1].variables; track x[0]) { <tr><td class="sutil">{{ x[0] }}</td><td>{{ x[1] }}</td></tr> }</tbody></table>
          </details>
        }
      }
      <ng-container pie>
        <button type="button" (click)="previa.set(null)">Cerrar</button>
        @if (previaViaje(); as v) { <button class="primario" (click)="previa.set(null); despachar(v)">Enviar al RNDC</button> }
      </ng-container>
    </app-modal>

    <!-- Cumplido -->
    <app-modal [titulo]="'Cumplir viaje N° ' + (cumplirViaje()?.numero || '')" [abierto]="!!cumplirViaje()" (cerrar)="cumplirViaje.set(null)" [ancho]="true">
      @if (cumplido(); as c) {
      <form id="form-cumplido" (ngSubmit)="cumplir()">
        <fieldset><legend>Cumplido de la remesa {{ cumplirViaje()?.remesa?.numero }}</legend>
          <div class="formulario">
            <div class="campo"><label for="c-tipo">Tipo</label><select id="c-tipo" name="rtipo" [(ngModel)]="c.remesa.tipo"><option value="C">Cumplido normal</option><option value="S">Suspensión</option></select></div>
            @if (c.remesa.tipo === 'S') {
              <div class="campo"><label for="c-mot">Motivo de suspensión</label><select id="c-mot" name="rmot" [(ngModel)]="c.remesa.motivoSuspension">
                @for (m of entradas(catalogos()?.motivoSuspensionRemesa); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }</select></div>
            }
            <div class="campo"><label for="c-cant">Cantidad entregada (kg)</label><input id="c-cant" type="number" min="0" name="rcant" [(ngModel)]="c.remesa.cantidadEntregada" /></div>
            @for (m of momentos; track m[0]) {
              <div class="campo"><label [for]="'c-' + m[0]">{{ m[1] }} al descargue</label>
                <div class="acciones" style="flex-wrap:nowrap"><input [id]="'c-' + m[0]" type="date" [name]="m[0] + 'f'" [(ngModel)]="c.remesa[m[0]].fecha" required />
                <input type="time" [name]="m[0] + 'h'" [(ngModel)]="c.remesa[m[0]].hora" required [attr.aria-label]="'Hora ' + m[1]" style="max-width:120px" /></div></div>
            }
          </div>
        </fieldset>
        <fieldset style="margin-top:14px"><legend>Cumplido del manifiesto {{ cumplirViaje()?.manifiesto?.numero }}</legend>
          <div class="formulario">
            <div class="campo"><label for="m-tipo">Tipo</label><select id="m-tipo" name="mtipo" [(ngModel)]="c.manifiesto.tipo"><option value="C">Cumplido normal</option><option value="S">Suspensión</option></select></div>
            <div class="campo"><label for="m-ent">Entrega de documentos</label><input id="m-ent" type="date" name="ment" [(ngModel)]="c.manifiesto.fechaEntregaDocumentos" required /></div>
            <div class="campo"><label for="m-add">Valor adicional al flete</label><div class="moneda"><input id="m-add" moneda name="madd" [(ngModel)]="c.manifiesto.adicionalFlete" /></div></div>
            <div class="campo"><label for="m-desc">Descuento al flete</label><div class="moneda"><input id="m-desc" moneda name="mdesc" [(ngModel)]="c.manifiesto.descuento" /></div></div>
            <div class="campo"><label for="m-sob">Sobreanticipo</label><div class="moneda"><input id="m-sob" moneda name="msob" [(ngModel)]="c.manifiesto.sobreanticipo" /></div></div>
            <div class="campo ancho"><label for="m-obs">Observaciones</label><input id="m-obs" name="mobs" maxlength="200" [(ngModel)]="c.manifiesto.observaciones" /></div>
          </div>
        </fieldset>
      </form>
      }
      <ng-container pie>
        <button type="button" (click)="cumplirViaje.set(null)">Cancelar</button>
        <button class="primario" type="submit" form="form-cumplido" [disabled]="trabajando()">Enviar cumplidos</button>
      </ng-container>
    </app-modal>

    <!-- Anulación -->
    <app-modal titulo="Anular en el RNDC" [abierto]="!!anularViaje()" (cerrar)="anularViaje.set(null)">
      @let a = anulacion();
      <form id="form-anular" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="anular()">
        <div class="campo"><label for="a-doc">Documento</label>
          <select id="a-doc" name="doc" [(ngModel)]="a.documento" (ngModelChange)="a.motivo = ''">
            @for (d of documentosAnulables(); track d[0]) { <option [value]="d[0]">{{ d[1] }}</option> }
          </select></div>
        <div class="campo"><label for="a-mot">Motivo</label>
          <select id="a-mot" name="mot" [(ngModel)]="a.motivo" required><option value="">Seleccione…</option>
            @for (m of motivos(a.documento); track m[0]) { <option [value]="m[0]">{{ m[1] }}</option> }</select>
          @if (a.documento === 'manifiesto' && catalogos()?.motivosReemplazo.includes(a.motivo)) {
            <small>Se marcará como reemplazo: al volver a enviar, el nuevo manifiesto indicará cuál reemplaza y reutilizará la remesa (manual RNDC 8.9.2).</small>
          }</div>
        <div class="campo"><label for="a-obs">Observaciones</label><textarea id="a-obs" name="obs" maxlength="200" [(ngModel)]="a.observaciones" required></textarea></div>
        <div class="mensaje alerta">La anulación queda registrada en el RNDC y no se puede deshacer. El RNDC limita las anulaciones de manifiestos al 6 % mensual (sin contar reemplazos).</div>
      </form>
      <ng-container pie>
        <button type="button" (click)="anularViaje.set(null)">Cancelar</button>
        <button class="peligro" type="submit" form="form-anular" [disabled]="trabajando() || !a.motivo || !a.observaciones">Anular</button>
      </ng-container>
    </app-modal>`,
})
export class Manifiestos {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly pestana = signal<Pestana>('pendientes');
  readonly viajes = signal<Viaje[]>([]);
  readonly transacciones = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly seleccion = signal(new Set<string>());
  readonly todos = computed(() => this.viajes().length > 0 && this.seleccion().size === this.viajes().length);
  readonly catalogos = signal<any>(null);
  readonly procesos = computed(() => this.catalogos()?.procesos || {});
  readonly ambiente = signal('');
  readonly previa = signal<any>(null);
  readonly previaViaje = signal<Viaje | null>(null);
  readonly cumplirViaje = signal<Viaje | null>(null);
  readonly cumplido = signal<any>(null);
  readonly anularViaje = signal<Viaje | null>(null);
  readonly anulacion = signal<any>({ documento: 'manifiesto', motivo: '', observaciones: '' });
  readonly momentos: [string, string][] = [['llegada', 'Llegada'], ['entrada', 'Entrada'], ['salida', 'Salida']];

  constructor() {
    this.cargar();
    this.api.get('/rndc/catalogos').then(c => this.catalogos.set(c)).catch(() => {});
    this.api.get<any>('/rndc/config').then(c => this.ambiente.set(c.ambiente)).catch(() => {});
  }

  ir(p: Pestana) { this.pestana.set(p); this.seleccion.set(new Set()); this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    try {
      if (this.pestana() === 'historial') this.transacciones.set(await this.api.get<any[]>('/rndc/transacciones', { limite: 200 }));
      else {
        this.pagina = 1;
        const r = await this.api.get<any>('/viajes', { estado: ESTADOS[this.pestana() as Exclude<Pestana, 'historial'>], pagina: 1, limite: 50, historico: 0 });
        this.viajes.set(r.viajes); this.total.set(r.total);
      }
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  // Carga progresiva de la lista de la pestaña
  private pagina = 1;
  readonly total = signal(0);
  readonly cargandoMas = signal(false);
  async cargarMas() {
    if (this.pestana() === 'historial' || this.cargandoMas() || this.viajes().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/viajes', { estado: ESTADOS[this.pestana() as Exclude<Pestana, 'historial'>], pagina: this.pagina + 1, limite: 50, historico: 0 });
      this.pagina += 1;
      this.viajes.update(l => [...l, ...r.viajes]);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoMas.set(false); }
  }

  entradas(o: Record<string, string> | undefined) { return Object.entries(o || {}); }
  chip(e: string) { return ({ aceptado: 'ok', rechazado: 'error', anulado: 'alerta' } as Record<string, string>)[e] || ''; }
  mensajeError(v: Viaje) {
    if (v.manifiesto?.estado === 'rechazado') return `Manifiesto rechazado: ${v.manifiesto.mensaje}`;
    if (v.remesa?.estado === 'rechazado') return `Remesa rechazada: ${v.remesa.mensaje}`;
    return '';
  }
  alternar(id: string) { this.seleccion.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  alternarTodos() { this.seleccion.set(this.todos() ? new Set() : new Set(this.viajes().map(v => v._id))); }

  async revisar(v: Viaje) {
    try { this.previaViaje.set(v); this.previa.set(await this.api.get(`/rndc/viajes/${v._id}/vista-previa`)); } catch (e) { this.avisos.error(e); }
  }

  // Ejecuta una operación que requiere la contraseña del RNDC.
  private async conClave<T>(fn: (clave: string) => Promise<T>): Promise<T | null> {
    const clave = await this.clave.obtener();
    if (!clave) return null;
    this.trabajando.set(true);
    try {
      return await fn(clave);
    } catch (e) {
      this.avisos.error(e);
      return null;
    } finally {
      this.trabajando.set(false);
    }
  }

  private revisarClave(mensajes: string[]) {
    if (mensajes.some(m => /usuario|contrase|clave|password/i.test(m || ''))) this.clave.olvidar();
  }

  async despachar(v: Viaje) {
    const r = await this.conClave(c => this.api.post<any>(`/rndc/viajes/${v._id}/despachar`, { clave: c }));
    if (!r) return;
    if (r.manifiesto?.estado === 'aceptado') this.avisos.ok(`Viaje ${v.numero}: manifiesto ${r.manifiesto.numero} aceptado (radicado ${r.manifiesto.radicado})`);
    else {
      const m = r.manifiesto?.mensaje || r.remesa?.mensaje || 'El RNDC rechazó el envío';
      this.revisarClave([m]);
      this.avisos.mostrar(`Viaje ${v.numero}: ${m}`, 'error');
    }
    this.cargar();
  }

  async enviarLote() {
    const ids = [...this.seleccion()];
    const r = await this.conClave(c => this.api.post<any[]>('/rndc/despachar-lote', { clave: c, viajes: ids }));
    if (!r) return;
    const ok = r.filter(x => x.manifiesto?.estado === 'aceptado').length;
    this.revisarClave(r.map(x => x.error || x.remesa?.mensaje || x.manifiesto?.mensaje));
    this.avisos.mostrar(`${ok} de ${ids.length} viaje(s) manifestados. Los rechazados muestran el motivo en la lista.`, ok === ids.length ? 'ok' : 'error');
    this.seleccion.set(new Set());
    this.cargar();
  }

  async pdf(v: Viaje) {
    try { await this.api.descargar(`/reportes/manifiesto/${v._id}`, {}, `Manifiesto_${v.manifiesto.numero}.pdf`); } catch (e) { this.avisos.error(e); }
  }

  abrirCumplido(v: Viaje) {
    const dia = isoDia(v.fecha);
    this.cumplido.set({
      remesa: { tipo: 'C', motivoSuspension: 'A', cantidadEntregada: v.pesoKg,
        llegada: { fecha: dia, hora: '' }, entrada: { fecha: dia, hora: '' }, salida: { fecha: dia, hora: '' } },
      manifiesto: { tipo: 'C', fechaEntregaDocumentos: hoyIso(), adicionalFlete: null, descuento: null, sobreanticipo: null, observaciones: '' },
    });
    this.cumplirViaje.set(v);
  }

  async cumplir() {
    const v = this.cumplirViaje();
    if (!v) return;
    const c = this.cumplido();
    const limpio = (o: any) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== ''));
    const r = await this.conClave(cl => this.api.post<any>(`/rndc/viajes/${v._id}/cumplir`, { clave: cl, remesa: limpio(c.remesa), manifiesto: limpio(c.manifiesto) }));
    if (!r) return;
    if (r.cumplidoManifiesto?.estado === 'aceptado') { this.avisos.ok(`Viaje ${v.numero} cumplido en el RNDC`); this.cumplirViaje.set(null); }
    else this.avisos.mostrar(r.cumplidoManifiesto?.mensaje || r.cumplidoRemesa?.mensaje || 'El RNDC rechazó el cumplido', 'error');
    this.cargar();
  }

  documentosAnulables(): [string, string][] {
    const v = this.anularViaje();
    if (!v) return [];
    if (v.estado === 'cumplido') return [['cumplidoManifiesto', 'Cumplido del manifiesto'], ...(v.cumplidoRemesa?.estado === 'aceptado' ? [['cumplidoRemesa', 'Cumplido de la remesa'] as [string, string]] : [])];
    if (v.estado === 'remesa') return [['remesa', `Remesa ${v.remesa.numero}`]];
    return [['manifiesto', `Manifiesto ${v.manifiesto.numero}`]];
  }

  motivos(doc: string): [string, string][] {
    const c = this.catalogos();
    if (!c) return [];
    return Object.entries(doc === 'manifiesto' ? c.motivoAnulacionManifiesto : doc === 'remesa' ? c.motivoAnulacionRemesa : c.motivoAnulacionCumplido);
  }

  abrirAnular(v: Viaje) {
    this.anularViaje.set(v);
    this.anulacion.set({ documento: this.documentosAnulables()[0]?.[0] || 'manifiesto', motivo: '', observaciones: '' });
  }

  async anular() {
    const v = this.anularViaje();
    if (!v) return;
    const r = await this.conClave(c => this.api.post<any>(`/rndc/viajes/${v._id}/anular`, { clave: c, ...this.anulacion() }));
    if (!r) return;
    if (r.ok) { this.avisos.ok(`Anulación aceptada (radicado ${r.radicado})`); this.anularViaje.set(null); }
    else { this.revisarClave([r.mensaje]); this.avisos.mostrar(`El RNDC rechazó la anulación: ${r.mensaje}`, 'error'); }
    this.cargar();
  }
}
