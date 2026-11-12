import { Paginador } from '../shared/paginador';
import { ListaServidor } from '../shared/lista-servidor';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { FORMATOS } from '../shared/formato';

type Pestana = 'historial' | 'nuevo' | 'automaticos';
type Modo = 'todos' | 'conductores' | 'planilla';
interface Destino { modo: Modo; conductores: string[]; estadosPlanilla: string[] }
interface Notificacion {
  id: string; titulo: string; texto: string; destino: Destino; estado: 'borrador' | 'programada' | 'enviando' | 'enviada' | 'cancelada';
  programadaPara: string | null; enviadaEn: string | null; creada: string; por: string; enviadaPor: string; copiaDe: string | null;
  total: number; entregados: number; leidos: number; fallidos: number;
  destinatarios?: { nombre: string; cedula: string; push: string; entregadoEn: string | null; leidoEn: string | null }[];
}
interface Conductor { id: string; nombre: string; cedula: string }
interface Turno { dia: number; hora: string; titulo: string; texto: string }
interface Regla { clave: string; nombre: string; descripcion: string; activa: boolean; turnos?: Turno[] }

const ESTADO: Record<string, { t: string; c: string }> = {
  borrador: { t: 'Borrador', c: '' }, programada: { t: 'Programado', c: 'info' }, enviando: { t: 'Enviando', c: 'alerta' },
  enviada: { t: 'Enviado', c: 'ok' }, cancelada: { t: 'Cancelado', c: 'error' },
};
const PLANILLA: [string, string][] = [['pendiente', 'Pendiente'], ['vencida', 'Vencida'], ['tardia_habilitada', 'Carga tardía'], ['recibida', 'Recibida']];
const ahoraLocal = (min = 0) => {
  const d = new Date(Date.now() + min * 60000 - 5 * 3600000);   // hora de Colombia
  return d.toISOString().slice(0, 16);
};

// Avisos a los conductores que tienen la app (solo administradores).
// La oficina ve cuántos lo reciben antes de enviar; los envíos a muchos piden confirmar el número,
// y no se manda dos veces lo mismo por error. Lo enviado no se cambia: se reenvía como copia.
@Component({
  selector: 'app-avisos-conductores',
  imports: [FormsModule, Icono, Modal, Confirmar, ...FORMATOS, Paginador],
  template: `
    <div class="pagina-cab">
      <div><h1>Avisos a conductores</h1>
        <p class="sutil">Mensajes que llegan al celular de los conductores que tienen la app. Cada uno queda también en la bandeja de la app.</p></div>
    </div>
    <div class="pestanas" role="tablist" aria-label="Secciones">
      <button type="button" role="tab" [class.activa]="pestana() === 'historial'" [attr.aria-selected]="pestana() === 'historial'" (click)="ir('historial')">Historial</button>
      <button type="button" role="tab" [class.activa]="pestana() === 'nuevo'" [attr.aria-selected]="pestana() === 'nuevo'" (click)="ir('nuevo')">{{ editando() ? 'Editar aviso' : 'Nuevo aviso' }}</button>
      <button type="button" role="tab" [class.activa]="pestana() === 'automaticos'" [attr.aria-selected]="pestana() === 'automaticos'" (click)="ir('automaticos')">Automáticos</button>
    </div>

    @switch (pestana()) {
      @case ('historial') {
        <div class="tabla-caja">
          <table>
            <thead><tr><th>Aviso</th><th>Para</th><th>Estado</th><th class="num">Recibieron</th><th class="num">Leyeron</th><th class="celda-acciones">Acciones</th></tr></thead>
            <tbody>
              @for (n of lista(); track n.id) {
                <tr>
                  <td><div class="celda-doble"><strong>{{ n.titulo }}</strong><small>{{ n.texto }}</small></div></td>
                  <td>{{ textoDestino(n.destino) }}</td>
                  <td><div class="celda-doble"><span class="chip" [class]="ESTADO[n.estado].c">{{ ESTADO[n.estado].t }}</span>
                    <small>@switch (n.estado) {
                      @case ('enviada') { {{ n.enviadaEn | fechaHora }}{{ n.copiaDe ? ' · copia' : '' }} }
                      @case ('programada') { Sale {{ n.programadaPara | fechaHora }} }
                      @default { Creado {{ n.creada | fechaHora }} }
                    }</small></div></td>
                  <td class="num">{{ n.estado === 'enviada' ? (n.entregados + ' de ' + n.total) : '—' }}@if (n.fallidos) { <small class="d-bloque aviso-fallo">{{ n.fallidos }} sin celular registrado o con error</small> }</td>
                  <td class="num">{{ n.estado === 'enviada' ? n.leidos : '—' }}</td>
                  <td class="celda-acciones"><div class="acciones">
                    @if (n.estado === 'enviada') { <button class="pequeno" (click)="verDetalle(n)">Detalle</button><button class="pequeno" (click)="abrirReenvio(n)">Reenviar</button> }
                    @if (n.estado === 'borrador' || n.estado === 'programada') {
                      <button class="pequeno" (click)="editar(n)">Editar</button>
                      <button class="pequeno" (click)="enviarYa(n)">Enviar ya</button>
                      <button class="pequeno" confirmar="Clic otra vez para cancelarlo" (confirmado)="cancelar(n)">Cancelar</button>
                    }
                  </div></td>
                </tr>
              } @empty {
                @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="6"><span class="esqueleto"></span></td></tr> } }
                @else { <tr><td colspan="6" class="vacio"><strong>Todavía no hay avisos</strong>Escriba el primero en «Nuevo aviso».</td></tr> }
              }
            </tbody>
          </table>
          <!-- Sur Track entrega el historial de a 25 avisos: el tamaño de página es fijo -->
          <app-paginador [total]="historial.total()" [pagina]="historial.pagina()" [porPagina]="historial.porPagina()" [tamanos]="[25]" [cargando]="historial.cambiando()" unidad="avisos" (cambio)="historial.ir($event)" />
        </div>
        @if (automaticos().length) {
          <h2 class="subtitulo">Automáticos de los últimos 30 días</h2>
          <div class="tabla-caja"><table>
            <thead><tr><th>Tipo</th><th class="num">Enviados</th><th class="num">Recibieron</th><th class="num">Leyeron</th><th>Último</th></tr></thead>
            <tbody>@for (a of automaticos(); track a.tipo) {
              <tr><td>{{ a.nombre }}</td><td class="num">{{ a.total }}</td><td class="num">{{ a.entregados }}</td><td class="num">{{ a.leidos }}</td><td>{{ a.ultimo | fechaHora }}</td></tr>
            }</tbody></table></div>
        }
      }

      @case ('nuevo') {
        <form class="formulario nuevo" (ngSubmit)="guardar('enviar')">
          <div class="campo ancho"><label for="av-titulo">Título</label>
            <input id="av-titulo" name="titulo" [(ngModel)]="f.titulo" maxlength="80" required placeholder="Ej.: Reunión de seguridad vial" />
            <small>{{ f.titulo.length }}/80</small></div>
          <div class="campo ancho"><label for="av-texto">Mensaje</label>
            <textarea id="av-texto" name="texto" rows="3" [(ngModel)]="f.texto" maxlength="500" required placeholder="Lo que verá el conductor en el celular"></textarea>
            <small>{{ f.texto.length }}/500</small></div>

          <fieldset class="ancho"><legend>Para</legend>
            <div class="segmentos" role="group" aria-label="Destinatarios">
              <button type="button" [class.activo]="f.destino.modo === 'todos'" (click)="modo('todos')">Todos los conductores con la app</button>
              <button type="button" [class.activo]="f.destino.modo === 'conductores'" (click)="modo('conductores')">Elegir conductores</button>
              <button type="button" [class.activo]="f.destino.modo === 'planilla'" (click)="modo('planilla')">Según su planilla del mes</button>
            </div>
            @if (f.destino.modo === 'conductores') {
              <div class="campo"><label for="av-buscar">Buscar</label><input id="av-buscar" name="buscar" type="search" [(ngModel)]="buscar" placeholder="Nombre o cédula" /></div>
              <ul class="lista-conductores">
                @for (c of conductoresVisibles(); track c.id) {
                  <li><label class="casilla"><input type="checkbox" [checked]="f.destino.conductores.includes(c.id)" (change)="alternar(c.id)" />{{ c.nombre }} <small class="sutil">C.C. {{ c.cedula }}</small></label></li>
                } @empty { <li class="sutil">{{ conductores().length ? 'Nadie con ese nombre.' : 'Ningún conductor tiene la app activada todavía.' }}</li> }
              </ul>
            }
            @if (f.destino.modo === 'planilla') {
              <div class="estados">@for (e of PLANILLA; track e[0]) {
                <label class="casilla"><input type="checkbox" [checked]="f.destino.estadosPlanilla.includes(e[0])" (change)="alternarEstado(e[0])" />{{ e[1] }}</label>
              }</div>
            }
            <p class="previa" role="status">
              @if (previa(); as p) { Lo recibirán <strong>{{ p.total }}</strong> conductor(es)@if (p.nombres.length) {: {{ p.nombres.join(', ') }}{{ p.total > p.nombres.length ? '…' : '' }} } }
              @else { Calculando a quién le llega… }
            </p>
          </fieldset>

          <fieldset class="ancho"><legend>Cuándo</legend>
            <label class="casilla"><input type="checkbox" name="programar" [(ngModel)]="programar" />Programar para una fecha y hora (hora de Colombia)</label>
            @if (programar) { <div class="campo"><label for="av-cuando">Fecha y hora</label><input id="av-cuando" name="cuando" type="datetime-local" [(ngModel)]="f.programadaPara" [min]="minProgramar" /></div> }
          </fieldset>
        </form>
        <div class="acciones pie-nuevo">
          @if (editando()) { <button type="button" (click)="limpiar()">Descartar cambios</button> }
          <button type="button" (click)="guardar('borrador')" [disabled]="trabajando() || !valido()">Guardar borrador</button>
          <button type="button" class="primario" (click)="guardar(programar ? 'programar' : 'enviar')" [disabled]="trabajando() || !valido() || !previa()?.total || (programar && !f.programadaPara)">
            <app-icono nombre="enviar" [tam]="16" />{{ programar ? 'Programar' : 'Enviar ahora' }}</button>
        </div>
      }

      @case ('automaticos') {
        <p class="sutil">Avisos que la plataforma manda sola. Apague los que no quiera que lleguen a los conductores.</p>
        <div class="reglas">
          @for (g of reglas(); track g.clave) {
            <section class="regla">
              <label class="casilla interruptor"><input type="checkbox" [checked]="g.activa" (change)="activar(g, $any($event.target).checked)" [disabled]="trabajando()" />
                <span><strong>{{ g.nombre }}</strong><small class="d-bloque sutil">{{ g.descripcion }}</small></span></label>
              @if (g.turnos) {
                <div class="tabla-caja"><table class="turnos">
                  <thead><tr><th>Día</th><th>Hora</th><th>Título</th><th>Mensaje</th><th></th></tr></thead>
                  <tbody>@for (t of turnos; track $index) {
                    <tr>
                      <td><select [(ngModel)]="t.dia" [name]="'dia' + $index" aria-label="Día">@for (d of [1, 2, 3, 4, 5]; track d) { <option [ngValue]="d">{{ d }}</option> }</select></td>
                      <td><input type="time" [(ngModel)]="t.hora" [name]="'hora' + $index" aria-label="Hora" /></td>
                      <td><input [(ngModel)]="t.titulo" [name]="'titulo' + $index" maxlength="80" aria-label="Título" /></td>
                      <td><input [(ngModel)]="t.texto" [name]="'texto' + $index" maxlength="300" aria-label="Mensaje" /></td>
                      <td><button type="button" class="pequeno" (click)="turnos.splice($index, 1)" aria-label="Quitar este recordatorio"><app-icono nombre="x" [tam]="14" /></button></td>
                    </tr>
                  }</tbody></table></div>
                <p class="sutil">Puede usar {{ '{' }}mes{{ '}' }}, {{ '{' }}dias{{ '}' }} (días que faltan) y {{ '{' }}nombre{{ '}' }}. Solo se manda a quien no ha subido la planilla, y nunca a excluidos.</p>
                <div class="acciones">
                  <button type="button" class="pequeno" (click)="turnos.push({ dia: 5, hora: '10:00', titulo: 'Planilla de seguridad social', texto: 'Suba la planilla de {mes}.' })" [disabled]="turnos.length >= 15"><app-icono nombre="mas" [tam]="14" />Agregar</button>
                  <button type="button" class="pequeno primario" (click)="guardarTurnos(g)" [disabled]="trabajando()">Guardar horarios y textos</button>
                </div>
              }
            </section>
          }
        </div>
      }
    }

    <!-- Detalle de un aviso enviado -->
    <app-modal [titulo]="detalle()?.titulo || 'Aviso'" [abierto]="!!detalle()" (cerrar)="detalle.set(null)">
      @if (detalle(); as d) {
        <p>{{ d.texto }}</p>
        <p class="sutil">Enviado {{ d.enviadaEn | fechaHora }} por {{ d.enviadaPor }} · recibieron {{ d.entregados }} de {{ d.total }} · leyeron {{ d.leidos }}</p>
        <div class="tabla-caja"><table>
          <thead><tr><th>Conductor</th><th>Celular</th><th>Recibido</th><th>Leído</th></tr></thead>
          <tbody>@for (x of d.destinatarios ?? []; track $index) {
            <tr><td><div class="celda-doble"><strong>{{ x.nombre }}</strong><small>C.C. {{ x.cedula }}</small></div></td>
              <td>{{ PUSH[x.push] || x.push }}</td><td>{{ x.entregadoEn ? (x.entregadoEn | fechaHora) : '—' }}</td><td>{{ x.leidoEn ? (x.leidoEn | fechaHora) : '—' }}</td></tr>
          }</tbody></table></div>
      }
      <ng-container pie><button type="button" (click)="detalle.set(null)">Cerrar</button></ng-container>
    </app-modal>

    <!-- Reenviar como copia -->
    <app-modal [titulo]="'Reenviar · ' + (reenvio()?.titulo || '')" [abierto]="!!reenvio()" (cerrar)="reenvio.set(null)">
      <p>Se manda una copia nueva; el aviso original no cambia.</p>
      <div class="segmentos" role="group" aria-label="A quién">
        <button type="button" [class.activo]="!reenvioA" (click)="reenvioA = ''">A los mismos destinatarios</button>
        <button type="button" [class.activo]="!!reenvioA" (click)="reenvioA = conductores()[0]?.id || ''" [disabled]="!conductores().length">A un conductor</button>
      </div>
      @if (reenvioA) {
        <div class="campo"><label for="av-reenvio">Conductor</label><select id="av-reenvio" [(ngModel)]="reenvioA">@for (c of conductores(); track c.id) { <option [value]="c.id">{{ c.nombre }} · {{ c.cedula }}</option> }</select></div>
      }
      <ng-container pie><button type="button" (click)="reenvio.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="reenviar()" [disabled]="trabajando()">Reenviar</button></ng-container>
    </app-modal>

    <!-- Confirmación de envíos a muchos -->
    <app-modal titulo="Confirmar envío" [abierto]="!!confirmar()" (cerrar)="confirmar.set(null)">
      @if (confirmar(); as c) {
        <div class="mensaje alerta"><strong>{{ c.mensaje }}</strong></div>
        @if (c.total) { <p>Escriba el número de conductores para confirmar: <strong>{{ c.total }}</strong></p>
          <div class="campo"><label for="av-total">Número de conductores</label><input id="av-total" type="number" inputmode="numeric" [(ngModel)]="totalEscrito" /></div> }
      }
      <ng-container pie><button type="button" (click)="confirmar.set(null)">No enviar</button>
        <button type="button" class="primario" (click)="confirmar()?.seguir()" [disabled]="trabajando() || (!!confirmar()?.total && totalEscrito !== confirmar()?.total)">Sí, enviar</button></ng-container>
    </app-modal>
  `,
  styles: [`
    .subtitulo { font-size: 15px; margin: 22px 0 10px; }
    .nuevo { max-width: 860px; }
    fieldset { border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 12px 14px; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    legend { font-weight: 650; padding: 0 6px; }
    .lista-conductores { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; border: 1px solid var(--gris-2); border-radius: var(--radio); }
    .lista-conductores li { padding: 6px 10px; border-bottom: 1px solid var(--gris-15, var(--gris-1)); }
    .estados { display: flex; gap: 16px; flex-wrap: wrap; }
    .previa { margin: 0; padding: 10px 12px; border-radius: var(--radio); background: var(--primario-claro); }
    .pie-nuevo { max-width: 860px; justify-content: flex-end; margin-top: 14px; }
    .reglas { display: flex; flex-direction: column; gap: 12px; max-width: 980px; }
    .regla { border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 12px 14px; background: var(--gris-0); display: flex; flex-direction: column; gap: 10px; }
    .interruptor { align-items: flex-start; }
    .turnos input, .turnos select { width: 100%; min-width: 0; }
    .turnos td:nth-child(1) { width: 70px; } .turnos td:nth-child(2) { width: 120px; } .turnos td:last-child { width: 44px; }
    .aviso-fallo { color: var(--ambar); }
    .d-bloque { display: block; }
    th.celda-acciones { text-align: right; } .celda-acciones .acciones { justify-content: flex-end; flex-wrap: wrap; }
  `],
})
export class AvisosConductores {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly ESTADO = ESTADO; readonly PLANILLA = PLANILLA;
  readonly PUSH: Record<string, string> = { enviado: 'Enviado', fallido: 'Falló el envío', sin_dispositivo: 'Sin celular registrado', pendiente: 'Pendiente' };
  readonly pestana = signal<Pestana>('historial');
  // Historial por páginas (antes solo se veía la primera página de Sur Track: los 25 más recientes)
  readonly historial = new ListaServidor<Notificacion>({
    pedir: (p) => this.api.get<any>('/avisos-conductores', { pagina: p.pagina }),
    alCargar: (r) => this.automaticos.set(r.automaticos || []),
    alError: (e) => this.avisos.error(e),
    porPagina: 25,
  });
  readonly lista = this.historial.items;
  readonly automaticos = signal<{ tipo: string; nombre: string; total: number; entregados: number; leidos: number; ultimo: string }[]>([]);
  readonly cargando = this.historial.cargando;
  readonly trabajando = signal(false);
  readonly conductores = signal<Conductor[]>([]);
  readonly reglas = signal<Regla[]>([]);
  readonly previa = signal<{ total: number; nombres: string[] } | null>(null);
  readonly detalle = signal<Notificacion | null>(null);
  readonly reenvio = signal<Notificacion | null>(null);
  readonly confirmar = signal<{ mensaje: string; total?: number; seguir: () => void } | null>(null);
  readonly editando = signal<string | null>(null);
  readonly minProgramar = ahoraLocal(2);
  f = this.vacio();
  programar = false; buscar = ''; reenvioA = ''; totalEscrito: number | null = null;
  turnos: Turno[] = [];
  private clave = crypto.randomUUID();
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  constructor() { this.cargar(); this.api.get<Conductor[]>('/avisos-conductores/conductores').then(c => this.conductores.set(c)).catch(e => this.avisos.error(e)); }

  private vacio() { return { titulo: '', texto: '', destino: { modo: 'todos' as Modo, conductores: [] as string[], estadosPlanilla: ['pendiente'] as string[] }, programadaPara: '' }; }
  ir(p: Pestana) {
    this.pestana.set(p);
    if (p === 'historial') this.cargar();
    if (p === 'nuevo') this.calcularPrevia();
    if (p === 'automaticos') this.cargarReglas();
  }
  cargar() { return this.historial.recargar(); }
  textoDestino(d: Destino) {
    if (d.modo === 'todos') return 'Todos con la app';
    if (d.modo === 'conductores') return d.conductores.length === 1 ? (this.conductores().find(c => c.id === d.conductores[0])?.nombre || '1 conductor') : `${d.conductores.length} conductores`;
    return 'Planilla: ' + d.estadosPlanilla.map(e => PLANILLA.find(x => x[0] === e)?.[1] || e).join(', ').toLowerCase();
  }

  // ── Nuevo / editar ──
  conductoresVisibles() { const q = this.buscar.trim().toLowerCase(); return this.conductores().filter(c => !q || c.nombre.toLowerCase().includes(q) || c.cedula.includes(q)); }
  modo(m: Modo) { this.f.destino.modo = m; this.calcularPrevia(); }
  alternar(id: string) { const l = this.f.destino.conductores; this.f.destino.conductores = l.includes(id) ? l.filter(x => x !== id) : [...l, id]; this.calcularPrevia(); }
  alternarEstado(e: string) { const l = this.f.destino.estadosPlanilla; this.f.destino.estadosPlanilla = l.includes(e) ? l.filter(x => x !== e) : [...l, e]; this.calcularPrevia(); }
  valido() { return this.f.titulo.trim().length >= 3 && this.f.texto.trim().length >= 3; }
  calcularPrevia() {
    clearTimeout(this.temporizador);
    const d = this.f.destino;
    if ((d.modo === 'conductores' && !d.conductores.length) || (d.modo === 'planilla' && !d.estadosPlanilla.length)) { this.previa.set({ total: 0, nombres: [] }); return; }
    this.previa.set(null);
    this.temporizador = setTimeout(async () => {
      try { this.previa.set(await this.api.post('/avisos-conductores/vista-previa', { destino: d })); } catch { this.previa.set({ total: 0, nombres: [] }); }
    }, 250);
  }
  limpiar() { this.f = this.vacio(); this.programar = false; this.editando.set(null); this.clave = crypto.randomUUID(); this.calcularPrevia(); }
  editar(n: Notificacion) {
    this.f = { titulo: n.titulo, texto: n.texto, destino: { modo: n.destino.modo, conductores: [...n.destino.conductores], estadosPlanilla: [...n.destino.estadosPlanilla] },
      programadaPara: n.programadaPara ? new Date(new Date(n.programadaPara).getTime() - 5 * 3600000).toISOString().slice(0, 16) : '' };
    this.programar = n.estado === 'programada';
    this.editando.set(n.id); this.ir('nuevo');
  }

  async guardar(accion: 'borrador' | 'programar' | 'enviar', extra: { confirmarTotal?: number; forzar?: boolean } = {}) {
    if (this.trabajando()) return;
    this.trabajando.set(true);
    const cuerpo = { titulo: this.f.titulo.trim(), texto: this.f.texto.trim(), destino: this.f.destino, ...(accion === 'programar' ? { programadaPara: this.f.programadaPara } : {}) };
    try {
      const id = this.editando();
      if (id) {
        await this.api.put(`/avisos-conductores/${id}`, { ...cuerpo, programadaPara: accion === 'programar' ? this.f.programadaPara : null });
        if (accion === 'enviar') await this.api.post(`/avisos-conductores/${id}/enviar`, extra);
      } else {
        await this.api.post('/avisos-conductores', { ...cuerpo, accion, claveIdempotencia: this.clave, ...extra });
      }
      this.avisos.ok(accion === 'enviar' ? 'Aviso enviado' : accion === 'programar' ? 'Aviso programado' : 'Borrador guardado');
      this.confirmar.set(null); this.limpiar(); this.ir('historial');
    } catch (e: any) { this.manejarControl(e, x => this.guardar(accion, { ...extra, ...x })); }
    finally { this.trabajando.set(false); }
  }

  /** Masivo: pide escribir el número. Duplicado: pregunta si se manda igual. */
  private manejarControl(e: any, seguir: (x: { confirmarTotal?: number; forzar?: boolean }) => void) {
    const codigo = e?.error?.codigo;
    if (codigo === 'confirmar_masivo') {
      const total = Number(/(\d+)/.exec(e.error.error || '')?.[1]) || this.previa()?.total || 0;
      this.totalEscrito = null;
      this.confirmar.set({ mensaje: e.error.error, total, seguir: () => seguir({ confirmarTotal: total }) });
    } else if (codigo === 'duplicado') {
      this.confirmar.set({ mensaje: `${e.error.error} ¿Lo envía de todos modos?`, seguir: () => seguir({ forzar: true }) });
    } else this.avisos.error(e);
  }

  async enviarYa(n: Notificacion, extra: { confirmarTotal?: number; forzar?: boolean } = {}) {
    this.trabajando.set(true);
    try { await this.api.post(`/avisos-conductores/${n.id}/enviar`, extra); this.avisos.ok('Aviso enviado'); this.confirmar.set(null); await this.historial.refrescar(); }
    catch (e: any) { this.manejarControl(e, x => this.enviarYa(n, { ...extra, ...x })); }
    finally { this.trabajando.set(false); }
  }
  async cancelar(n: Notificacion) {
    try { await this.api.post(`/avisos-conductores/${n.id}/cancelar`, {}); this.avisos.ok('Aviso cancelado'); await this.historial.refrescar(); } catch (e) { this.avisos.error(e); }
  }
  async verDetalle(n: Notificacion) { try { this.detalle.set(await this.api.get<Notificacion>(`/avisos-conductores/${n.id}`)); } catch (e) { this.avisos.error(e); } }
  abrirReenvio(n: Notificacion) { this.reenvioA = ''; this.reenvio.set(n); }
  async reenviar(extra: { confirmarTotal?: number } = {}) {
    const n = this.reenvio(); if (!n) return;
    this.trabajando.set(true);
    try {
      await this.api.post(`/avisos-conductores/${n.id}/reenviar`, { ...(this.reenvioA ? { conductor: this.reenvioA } : {}), ...extra });
      this.avisos.ok('Copia enviada'); this.reenvio.set(null); this.confirmar.set(null); await this.cargar();
    } catch (e: any) { this.manejarControl(e, x => this.reenviar({ ...extra, ...x })); }
    finally { this.trabajando.set(false); }
  }

  // ── Automáticos ──
  async cargarReglas() {
    try { const r = await this.api.get<Regla[]>('/avisos-conductores/automaticos'); this.reglas.set(r); this.turnos = (r.find(g => g.turnos)?.turnos || []).map(t => ({ ...t })); }
    catch (e) { this.avisos.error(e); }
  }
  async activar(g: Regla, activa: boolean) {
    this.trabajando.set(true);
    try { await this.api.put(`/avisos-conductores/automaticos/${g.clave}`, { activa, ...(g.turnos ? { turnos: this.turnos } : {}) }); this.avisos.ok(activa ? `«${g.nombre}» activado` : `«${g.nombre}» desactivado`); await this.cargarReglas(); }
    catch (e) { this.avisos.error(e); await this.cargarReglas(); }
    finally { this.trabajando.set(false); }
  }
  async guardarTurnos(g: Regla) {
    if (this.turnos.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.hora) || t.titulo.trim().length < 3 || t.texto.trim().length < 3)) { this.avisos.mostrar('Revise las horas y que cada recordatorio tenga título y mensaje', 'error'); return; }
    this.trabajando.set(true);
    try { await this.api.put(`/avisos-conductores/automaticos/${g.clave}`, { activa: g.activa, turnos: this.turnos }); this.avisos.ok('Recordatorios guardados'); await this.cargarReglas(); }
    catch (e) { this.avisos.error(e); }
    finally { this.trabajando.set(false); }
  }
}
