import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { Confirmar } from './confirmar';

type Campo = 'encabezado' | 'linea' | 'pie';
const nueva = () => ({ _id: '', nombre: '', encabezado: '{saludo},\n\nReporte de vehículos - {fecha}\n\n{cliente}',
  linea: '{conductor}. {destino}. Flete {flete}. Anticipo {anticipo}\nPlaca {placa}\n{observaciones}', separador: 'blanco', pie: '', predeterminada: false });

// Crear, editar y guardar plantillas del reporte de WhatsApp: texto, datos incluidos
// (marcadores) y formato (separación entre viajes). Vista previa con los viajes reales.
@Component({
  selector: 'app-plantillas-whatsapp',
  imports: [FormsModule, Modal, Icono, Confirmar],
  template: `
    <app-modal titulo="Plantillas del reporte de WhatsApp" [abierto]="abierto()" (cerrar)="cerrar.emit()" [ancho]="true">
      <div class="disposicion">
        <nav class="lista" aria-label="Plantillas">
          @for (p of plantillas(); track p._id) {
            <button type="button" [class.activa]="p._id === form()._id" (click)="elegir(p)">
              <span>{{ p.nombre }}</span>
              @if (p.predeterminada) { <span class="chip marca sin-punto">Predeterminada</span> }
              @if (p.base) { <small>De la plataforma</small> }
            </button>
          }
          <button type="button" class="nueva" (click)="crear()"><app-icono nombre="mas" [tam]="15" />Nueva plantilla</button>
        </nav>

        <div class="editor">
          @let f = form();
          @if (esBase()) {
            <div class="mensaje info">Esta es la plantilla de la plataforma (formato del Excel). No se modifica: <button type="button" class="texto" (click)="duplicar()">cree una copia</button> para personalizarla.</div>
          }
          <form id="form-plantilla" (ngSubmit)="guardar()">
            <div class="formulario">
              <div class="campo"><label for="pl-nom">Nombre</label><input id="pl-nom" name="nombre" maxlength="60" [(ngModel)]="f.nombre" (ngModelChange)="previa()" [disabled]="esBase()" required /></div>
              <div class="campo"><label for="pl-sep">Separación entre viajes</label>
                <select id="pl-sep" name="sep" [(ngModel)]="f.separador" (ngModelChange)="previa()" [disabled]="esBase()">
                  <option value="blanco">Línea en blanco</option><option value="linea">Seguidos (sin espacio)</option><option value="guiones">Línea de guiones</option></select></div>
            </div>
            <div class="campo"><label for="pl-enc">Encabezado del mensaje (una vez por cliente)</label>
              <textarea id="pl-enc" name="enc" rows="4" [(ngModel)]="f.encabezado" (ngModelChange)="previa()" (focus)="foco = 'encabezado'" [disabled]="esBase()"></textarea></div>
            <div class="campo"><label for="pl-lin">Texto de cada viaje</label>
              <textarea id="pl-lin" name="lin" rows="4" [(ngModel)]="f.linea" (ngModelChange)="previa()" (focus)="foco = 'linea'" [disabled]="esBase()" required></textarea>
              <small>Una línea cuyos datos quedan vacíos no se escribe (p. ej. «Remolque {{ '{' }}remolque{{ '}' }}» si no hay remolque).</small></div>
            <div class="campo"><label for="pl-pie">Pie del mensaje (totales, firma…)</label>
              <textarea id="pl-pie" name="pie" rows="2" [(ngModel)]="f.pie" (ngModelChange)="previa()" (focus)="foco = 'pie'" [disabled]="esBase()"></textarea></div>
            @if (!esBase()) { <label class="casilla"><input type="checkbox" name="pred" [(ngModel)]="f.predeterminada" />Usar por defecto en el reporte</label> }
          </form>

          @if (!esBase()) {
            <div class="marcadores">
              <span class="etiqueta">Insertar dato en «{{ etiquetaFoco() }}»:</span>
              @for (g of grupos(); track g[0]) {
                <div class="grupo"><small>{{ g[0] }}</small>
                  @for (m of g[1]; track m[0]) { <button type="button" class="pequeno" [title]="m[1]" (click)="insertar(m[0])">{{ m[1] }}</button> }</div>
              }
              <small>Para negrita en WhatsApp escriba el texto entre asteriscos: *texto*.</small>
            </div>
          }

          <h3>Vista previa ({{ fechaTexto() }})</h3>
          @if (vista(); as v) { <pre class="wa-texto">{{ v }}</pre> } @else { <p class="sutil">No hay viajes en esa fecha para mostrar la vista previa.</p> }
        </div>
      </div>
      <ng-container pie>
        @if (form()._id && !esBase()) { <button type="button" class="peligro" confirmar="Clic otra vez para eliminar" (confirmado)="eliminar()" style="margin-right:auto">Eliminar</button> }
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        @if (!esBase()) { <button class="primario" type="submit" form="form-plantilla" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar plantilla' }}</button> }
      </ng-container>
    </app-modal>`,
  styles: [`
    .disposicion { display: grid; grid-template-columns: 220px 1fr; gap: 18px; }
    .lista { display: flex; flex-direction: column; gap: 6px; }
    .lista button { flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; white-space: normal; min-height: 0; padding: 10px 12px; }
    .lista button.activa { border-color: var(--primario-borde); background: var(--primario-claro); }
    .lista small { color: var(--gris-5); font-size: 11.5px; }
    .lista .nueva { flex-direction: row; align-items: center; border-style: dashed; }
    .editor { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    textarea { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
    .marcadores { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px dashed var(--gris-3); border-radius: var(--radio); }
    .grupo { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .grupo small { min-width: 58px; color: var(--gris-5); font-weight: 600; }
    h3 { margin: 4px 0 0; font-size: 14px; }
    .wa-texto { white-space: pre-wrap; font-family: inherit; background: var(--gris-1); border-radius: 10px; padding: 12px; margin: 0; font-size: 13.5px; }
    @media (max-width: 760px) { .disposicion { grid-template-columns: 1fr; } }
  `],
})
export class PlantillasWhatsapp {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly abierto = input(false);
  readonly fecha = input('');
  readonly cerrar = output<void>();
  readonly cambiadas = output<void>();
  readonly plantillas = signal<any[]>([]);
  readonly marcadores = signal<any>({ mensaje: {}, viaje: {} });
  readonly form = signal<any>(nueva());
  readonly vista = signal('');
  readonly guardando = signal(false);
  readonly esBase = computed(() => this.form()._id === 'base');
  foco: Campo = 'linea';
  readonly grupos = computed<[string, [string, string][]][]>(() => [
    ['Mensaje', Object.entries(this.marcadores().mensaje) as [string, string][]],
    ['Viaje', Object.entries(this.marcadores().viaje) as [string, string][]],
  ]);
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => { if (this.abierto()) this.cargar(); });
  }

  fechaTexto() { const f = this.fecha(); return f ? f.split('-').reverse().join('/') : 'hoy'; }
  etiquetaFoco() { return ({ encabezado: 'Encabezado', linea: 'Texto de cada viaje', pie: 'Pie' } as Record<Campo, string>)[this.foco]; }

  private async cargar(elegirId?: string) {
    try {
      const r = await this.api.get<any>('/viajes/plantillas-whatsapp');
      this.plantillas.set(r.plantillas); this.marcadores.set(r.marcadores);
      const p = r.plantillas.find((x: any) => x._id === (elegirId || this.form()._id)) || r.plantillas.find((x: any) => x.predeterminada) || r.plantillas[0];
      this.elegir(p);
    } catch (e) { this.avisos.error(e); }
  }

  elegir(p: any) { this.form.set({ ...nueva(), ...p }); this.previa(); }
  crear() { this.form.set({ ...nueva(), nombre: 'Nueva plantilla' }); this.foco = 'linea'; this.previa(); }
  duplicar() { const f = this.form(); this.form.set({ ...f, _id: '', nombre: `${f.nombre} (copia)`.slice(0, 60), predeterminada: false, base: false }); this.previa(); }

  // Inserta el marcador en el campo que tuvo el foco por última vez
  insertar(clave: string) {
    const marca = `{${clave}}`;
    const el = document.querySelector<HTMLTextAreaElement>(this.foco === 'encabezado' ? '#pl-enc' : this.foco === 'pie' ? '#pl-pie' : '#pl-lin');
    this.form.update(f => {
      const actual: string = f[this.foco] || '';
      const i = el && document.activeElement === el ? el.selectionStart : actual.length;
      return { ...f, [this.foco]: actual.slice(0, i) + marca + actual.slice(i) };
    });
    this.previa();
  }

  previa() {
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(async () => {
      const f = this.form();
      try {
        const r = await this.api.post<any>('/viajes/reporte-whatsapp/vista-previa', { fecha: this.fecha() || undefined,
          plantilla: { encabezado: f.encabezado, linea: f.linea || ' ', separador: f.separador, pie: f.pie } });
        this.vista.set(r.mensajes[0]?.texto || '');
      } catch { this.vista.set(''); }
    }, 250);
  }

  async guardar() {
    const f = this.form();
    const cuerpo = { nombre: f.nombre, encabezado: f.encabezado, linea: f.linea, separador: f.separador, pie: f.pie, predeterminada: !!f.predeterminada };
    this.guardando.set(true);
    try {
      const p = f._id ? await this.api.put<any>(`/viajes/plantillas-whatsapp/${f._id}`, cuerpo) : await this.api.post<any>('/viajes/plantillas-whatsapp', cuerpo);
      this.avisos.ok(`Plantilla «${p.nombre}» guardada`);
      await this.cargar(p._id);
      this.cambiadas.emit();
    } catch (e) { this.avisos.error(e); } finally { this.guardando.set(false); }
  }

  async eliminar() {
    const f = this.form();
    try {
      await this.api.delete(`/viajes/plantillas-whatsapp/${f._id}`);
      this.avisos.ok('Plantilla eliminada');
      this.form.set(nueva());
      await this.cargar();
      this.cambiadas.emit();
    } catch (e) { this.avisos.error(e); }
  }
}
