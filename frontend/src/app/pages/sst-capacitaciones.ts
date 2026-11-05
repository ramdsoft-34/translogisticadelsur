import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { Firma } from '../shared/firma';
import { VisorPdf } from '../shared/visor-pdf';
import { FORMATOS, isoDia, hoyIso } from '../shared/formato';

const EJE: Record<string, string> = { sst: 'SST', pesv: 'Seguridad vial', ambos: 'SST y vial' };

// Programa anual de capacitación (SST y PESV) y la asistencia firmada de cada sesión (SST-FOR-07)
@Component({
  selector: 'app-sst-capacitaciones',
  imports: [FormsModule, Modal, Icono, Firma, VisorPdf, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Capacitaciones</h1><p class="sutil">Programa anual de capacitación, inducción y reinducción. Cada sesión guarda la asistencia con la firma de los asistentes y sale en PDF con el membrete.</p></div>
      @if (gestiona) { <div class="acciones"><button class="primario" (click)="nueva()"><app-icono nombre="mas" />Programar capacitación</button></div> }
    </div>
    <section class="resumen">
      <div><strong>{{ lista().length }}</strong><span>programadas</span></div>
      <div><strong>{{ ejecutadas() }}</strong><span>ejecutadas</span></div>
      <div><strong>{{ horas() }}</strong><span>horas dictadas</span></div>
      <div><strong>{{ lista().length ? Math.round(ejecutadas() / lista().length * 100) : 0 }} %</strong><span>cumplimiento</span></div>
    </section>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>Fecha</th><th>Tema</th><th>Eje</th><th>Dirigido a</th><th>Horas</th><th>Facilitador</th><th>Asistentes</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        @for (c of lista(); track c._id) {
          <tr><td data-etiqueta="Fecha">{{ c.fecha | dia }}</td><td data-etiqueta="Tema"><strong>{{ c.tema }}</strong></td><td data-etiqueta="Eje">{{ eje(c.eje) }}</td>
            <td data-etiqueta="Dirigido a">{{ c.dirigidoA }}</td><td data-etiqueta="Horas">{{ c.horas }}</td><td data-etiqueta="Facilitador">{{ c.facilitador }}</td>
            <td data-etiqueta="Asistentes">{{ asistieron(c) }}</td>
            <td data-etiqueta="Estado"><span class="chip sin-punto" [class.ok]="c.estado === 'ejecutada'" [class.alerta]="c.estado === 'programada' && vencida(c)" [class.error]="c.estado === 'cancelada'">{{ c.estado === 'programada' && vencida(c) ? 'Atrasada' : c.estado }}</span></td>
            <td><div class="acciones" style="justify-content:flex-end">
              <button class="pequeno" (click)="abrir(c)">{{ gestiona ? 'Asistencia' : 'Ver' }}</button>
              @if (c.estado === 'ejecutada') { <button class="pequeno" (click)="visor.ver('/sst/capacitaciones/' + c._id + '/asistencia.pdf', 'Asistencia · ' + c.tema)"><app-icono nombre="ojo" [tam]="15" />PDF</button> }
            </div></td></tr>
        } @empty { <tr><td colspan="9" class="vacio"><strong>Sin capacitaciones</strong>Programe las del año: inducción, funciones del Vigía o COPASST, manejo defensivo, primeros auxilios…</td></tr> }
      </tbody>
    </table></div>
    <app-visor-pdf #visor />

    <app-modal [titulo]="actual()?._id ? actual().tema : 'Programar capacitación'" [abierto]="!!actual()" (cerrar)="actual.set(null)" [ancho]="true">
      @if (actual(); as c) {
        <form id="form-cap" (ngSubmit)="guardar()">
          <fieldset><legend>Sesión</legend><div class="formulario">
            <div class="campo ancho"><label>Tema</label><input name="tema" [(ngModel)]="c.tema" required [disabled]="!gestiona" /></div>
            <div class="campo"><label>Eje</label><select name="eje" [(ngModel)]="c.eje" [disabled]="!gestiona"><option value="sst">SST</option><option value="pesv">Seguridad vial (PESV)</option><option value="ambos">Ambos</option></select></div>
            <div class="campo"><label>Fecha</label><input type="date" name="fecha" [(ngModel)]="c.fecha" required [disabled]="!gestiona" /></div>
            <div class="campo"><label>Horas</label><input type="number" min="0.5" step="0.5" name="horas" [(ngModel)]="c.horas" [disabled]="!gestiona" /></div>
            <div class="campo"><label>Facilitador</label><input name="fac" [(ngModel)]="c.facilitador" [disabled]="!gestiona" /></div>
            <div class="campo"><label>Dirigido a</label><input name="dir" [(ngModel)]="c.dirigidoA" [disabled]="!gestiona" /></div>
            <div class="campo"><label>Estado</label><select name="est" [(ngModel)]="c.estado" [disabled]="!gestiona"><option value="programada">Programada</option><option value="ejecutada">Ejecutada</option><option value="cancelada">Cancelada</option></select></div>
          </div></fieldset>
          <fieldset><legend>Asistentes ({{ c.asistentes.length }})</legend>
            @if (gestiona) {
              <div class="barra"><div class="campo crece"><label>Agregar colaborador</label>
                <select name="sel" [(ngModel)]="seleccion"><option value="">Seleccione…</option>
                  @for (p of disponibles(); track p._id) { <option [value]="p._id">{{ p.nombre }} · {{ p.cargo }}</option> }</select></div>
                <button type="button" (click)="agregar()" [disabled]="!seleccion">Agregar</button>
                <button type="button" (click)="agregarTodos()">Agregar todos los conductores</button>
                @if (c._id) { <button type="button" class="whatsapp" (click)="enviarFirmas(null)" [disabled]="trabajando() || !sinFirma(c)" title="Cada asistente firma desde su celular con un enlace propio">Firmar por WhatsApp ({{ sinFirma(c) }})</button> }</div>
              @if (!c._id) { <p class="sutil" style="margin:6px 0 0">Guarde la capacitación para poder enviar los enlaces de firma por WhatsApp.</p> }
            }
            <div class="asistentes">
              @for (a of c.asistentes; track $index; let i = $index) {
                <div class="asis" [class.no]="!a.asistio">
                  <div class="cab-a"><strong>{{ a.nombre }}</strong><span class="sutil">{{ a.documento }}</span>
                    <label class="casilla"><input type="checkbox" [(ngModel)]="a.asistio" [name]="'as' + i" [disabled]="!gestiona" />Asistió</label>
                    @if (gestiona) { <button type="button" class="pequeno texto" (click)="c.asistentes.splice(i, 1)" aria-label="Quitar"><app-icono nombre="x" [tam]="14" /></button> }</div>
                  @if (a.remota?.firmado) {
                    <div class="firmada"><img [src]="a.firma?.imagen" alt="Firma" /><span class="chip ok sin-punto">Firmó desde el celular · {{ a.remota.firmado | fechaHora }}</span></div>
                  } @else if (a.asistio) {
                    <app-firma [valor]="a.firma?.imagen || ''" (cambio)="a.firma = $event ? { rol: 'asistente', nombre: a.nombre, documento: a.documento, imagen: $event } : null" [etiqueta]="a.nombre" />
                    @if (c._id && a._id && gestiona) {
                      <div class="remota">@if (a.remota?.enviado) { <span class="chip info sin-punto">Enlace enviado {{ a.remota.enviado | fechaHora }}</span> }
                        @if (a.remota?.abierto) { <span class="chip sin-punto">Lo abrió</span> }
                        <button type="button" class="pequeno whatsapp" (click)="enviarFirmas([a._id])" [disabled]="trabajando()">{{ a.remota?.enviado ? 'Reenviar enlace' : 'Firmar por WhatsApp' }}</button></div>
                    }
                  }
                </div>
              } @empty { <p class="sutil">Agregue a los asistentes; cada uno firma en la pantalla (celular o tableta) al terminar la sesión.</p> }
            </div>
          </fieldset>
        </form>
      }
      <ng-container pie><button type="button" (click)="actual.set(null)">Cerrar</button>
        @if (gestiona) { <button type="submit" form="form-cap" class="primario">Guardar</button> }</ng-container>
    </app-modal>

    <!-- Fase 10: enlaces de firma por WhatsApp (un clic por asistente: sin la API de WhatsApp no salen solos) -->
    <app-modal titulo="Firmar la asistencia por WhatsApp" [abierto]="!!waLista()" (cerrar)="cerrarWa()" [ancho]="true">
      @if (waLista(); as lista) {
        <p class="sutil" style="margin-top:0">Cada asistente recibe un enlace propio. Para firmar escribe los 4 últimos números de su documento, confirma que asistió y firma con el dedo. Queda la fecha, la hora y el celular desde donde firmó (Ley 527 de 1999).</p>
        <div class="lista-wa">
          @for (x of lista; track x._id) {
            <div class="dest-wa">
              <div class="crece"><strong>{{ x.nombre }}</strong><span class="sutil"> · {{ x.documento }}</span>
                @if (x.error) { <small class="linea-wa error-wa">{{ x.error }}</small> } @else { <small class="linea-wa sutil">Celular {{ x.celular }}</small> }
                <span class="estado-wa">
                  @if (x.firmado) { <span class="chip ok sin-punto">Firmó {{ x.firmado | fechaHora }}</span> }
                  @else if (x.enviado) { <span class="chip info sin-punto">Enviado {{ x.enviado | fechaHora }}</span> }
                  @if (x.abierto && !x.firmado) { <span class="chip sin-punto">Lo abrió</span> }
                </span>
                <span class="enlace-wa"><code>{{ x.enlace }}</code><button type="button" class="pequeno" (click)="copiar(x.enlace)">Copiar</button></span>
              </div>
              @if (x.wa && !x.firmado) { <a class="boton whatsapp" [href]="x.wa" target="_blank" rel="noopener" (click)="marcarEnviado(x)">{{ x.enviado ? 'Enviar otra vez' : 'Enviar por WhatsApp' }}</a> }
            </div>
          } @empty { <p class="sutil">Todos los asistentes ya firmaron.</p> }
        </div>
      }
      <ng-container pie><span class="sutil" style="margin-right:auto;font-size:12.5px">Se abre WhatsApp con el mensaje listo; usted oprime enviar.</span><button type="button" class="primario" (click)="cerrarWa()">Listo</button></ng-container>
    </app-modal>`,
  styles: [`
    .resumen { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .resumen div { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 12px 16px; display: flex; flex-direction: column; }
    .resumen strong { font-size: 24px; font-variant-numeric: tabular-nums; } .resumen span { font-size: 12.5px; color: var(--gris-5); }
    @media (max-width: 700px) { .resumen { grid-template-columns: 1fr 1fr; } }
    .formulario .ancho { grid-column: 1 / -1; }
    .asistentes { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; margin-top: 10px; }
    .asis { border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 10px; background: var(--gris-0); } .asis.no { opacity: .6; }
    .cab-a { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; } .cab-a .casilla { margin-left: auto; }
    .firmada { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; border: 1px solid var(--verde-borde); border-radius: var(--radio); padding: 8px; } .firmada img { max-height: 80px; max-width: 100%; }
    .remota { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; } .remota button { margin-left: auto; }
    button.whatsapp, a.boton.whatsapp { background: var(--whatsapp, #1fa855); border-color: var(--whatsapp, #1fa855); color: #fff; }
    a.boton.whatsapp { display: inline-flex; align-items: center; padding: 9px 14px; border-radius: 10px; font-weight: 700; text-decoration: none; white-space: nowrap; }
    .lista-wa { display: flex; flex-direction: column; gap: 10px; } .dest-wa { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); }
    .dest-wa .crece { flex: 1; min-width: 0; } .linea-wa { display: block; font-size: 12px; margin-top: 3px; } .error-wa { color: var(--rojo-texto); }
    .estado-wa { display: flex; gap: 6px; margin-top: 4px; } .enlace-wa { display: flex; gap: 8px; align-items: center; margin-top: 6px; } .enlace-wa code { font-size: 12px; color: var(--gris-6); }
  `],
})
export class SstCapacitaciones {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly gestiona = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly Math = Math;
  readonly lista = signal<any[]>([]);
  readonly colaboradores = signal<any[]>([]);
  readonly actual = signal<any>(null);
  seleccion = '';
  readonly trabajando = signal(false);
  readonly waLista = signal<any[] | null>(null);
  sinFirma = (c: any) => (c.asistentes || []).filter((a: any) => a._id && !a.firma?.imagen).length;
  // Fase 10: enlaces para firmar desde el celular
  async enviarFirmas(ids: string[] | null) {
    const c = this.actual(); if (!c?._id) return;
    this.trabajando.set(true);
    try {
      await this.api.put(`/sst/capacitaciones/${c._id}`, this.cuerpo(c));   // primero se guarda lo que haya cambiado en pantalla
      this.waLista.set(await this.api.post<any[]>(`/sst/capacitaciones/${c._id}/firma-remota`, ids ? { asistentes: ids } : {}));
    }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async marcarEnviado(x: any) {
    try { const r: any = await this.api.put(`/sst/capacitaciones/${this.actual()._id}/firma-remota/${x._id}/enviado`, {}); this.waLista.update(l => (l || []).map(y => (y._id === x._id ? { ...y, enviado: r.enviado } : y))); }
    catch (e) { this.avisos.error(e); }
  }
  async cerrarWa() { this.waLista.set(null); const c = this.actual(); if (c?._id) await this.abrir(c); }
  async copiar(t: string) { try { await navigator.clipboard.writeText(t); this.avisos.ok('Enlace copiado'); } catch { this.avisos.error('No se pudo copiar'); } }
  readonly ejecutadas = computed(() => this.lista().filter(c => c.estado === 'ejecutada').length);
  readonly horas = computed(() => this.lista().filter(c => c.estado === 'ejecutada').reduce((a, c) => a + (c.horas || 0), 0));
  readonly disponibles = computed(() => { const ya = new Set((this.actual()?.asistentes || []).map((a: any) => String(a.persona?.id))); return this.colaboradores().filter(c => !ya.has(String(c._id))); });
  eje = (e: string) => EJE[e] || e;
  vencida = (c: any) => new Date(c.fecha).getTime() < Date.now() - 864e5;
  asistieron = (c: any) => (c.asistentes || []).filter((a: any) => a.asistio).length;

  constructor() { this.cargar(); }
  async cargar() {
    try {
      this.lista.set(await this.api.get<any[]>('/sst/capacitaciones'));
      if (this.gestiona && !this.colaboradores().length) this.colaboradores.set(await this.api.get<any[]>('/sst/personas'));
    } catch (e) { this.avisos.error(e); }
  }
  nueva() { this.actual.set({ tema: '', eje: 'sst', fecha: hoyIso(), horas: 2, facilitador: '', dirigidoA: '', estado: 'programada', asistentes: [] }); }
  async abrir(c: any) {
    try { const d: any = await this.api.get(`/sst/capacitaciones/${c._id}`); d.fecha = isoDia(d.fecha); this.actual.set(d); } catch (e) { this.avisos.error(e); }
  }
  agregar() {
    const p = this.colaboradores().find(c => c._id === this.seleccion); if (!p) return;
    this.actual().asistentes.push({ persona: { tipo: p.tipo, id: p._id }, nombre: p.nombre, documento: p.documento.split(' ').pop(), asistio: true, firma: null });
    this.seleccion = ''; this.actual.set({ ...this.actual() });
  }
  agregarTodos() {
    for (const p of this.disponibles().filter(c => c.tipo === 'tercero')) this.actual().asistentes.push({ persona: { tipo: p.tipo, id: p._id }, nombre: p.nombre, documento: p.documento.split(' ').pop(), asistio: true, firma: null });
    this.actual.set({ ...this.actual() });
  }
  async guardar() {
    const c = this.actual();
    const cuerpo = this.cuerpo(c);
    try {
      if (c._id) await this.api.put(`/sst/capacitaciones/${c._id}`, cuerpo); else await this.api.post('/sst/capacitaciones', cuerpo);
      this.avisos.ok('Capacitación guardada'); this.actual.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
  private cuerpo(c: any) {
    return { tema: c.tema, eje: c.eje, fecha: c.fecha, horas: c.horas, facilitador: c.facilitador, dirigidoA: c.dirigidoA, estado: c.estado,
      asistentes: c.asistentes.map((a: any) => ({ ...(a._id ? { _id: a._id } : {}), persona: a.persona?.id ? { tipo: a.persona.tipo, id: a.persona.id } : { tipo: 'tercero', id: null }, nombre: a.nombre, documento: a.documento, asistio: a.asistio, firma: a.firma || null })) };
  }
}
