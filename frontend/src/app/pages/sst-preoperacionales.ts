import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { VisorPdf } from '../shared/visor-pdf';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';

// Los checklists que los conductores hacen en Sur Track, guardados en la plataforma como evidencia del PESV:
// resultado apto / no apto, acción de la empresa con los no aptos y PDF (uno o todos los del periodo) con el membrete.
@Component({
  selector: 'app-sst-preoperacionales',
  imports: [FormsModule, Icono, Modal, VisorPdf, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Preoperacionales</h1><p class="sutil">Los conductores hacen el checklist en Sur Track antes de salir. Aquí queda la copia de cada uno, con su firma, aunque en Sur Track cambie algo.</p></div>
      <div class="acciones">
        <button (click)="sincronizar()" [disabled]="trabajando()"><app-icono nombre="reloj" />{{ trabajando() ? 'Trayendo…' : 'Traer de Sur Track' }}</button>
        <button class="primario" (click)="lote()"><app-icono nombre="descargar" />Todos en un PDF</button>
      </div>
    </div>
    <div class="barra">
      <div class="campo"><label for="p-d">Desde</label><input id="p-d" type="date" [(ngModel)]="f.desde" (change)="cargar()" /></div>
      <div class="campo"><label for="p-h">Hasta</label><input id="p-h" type="date" [(ngModel)]="f.hasta" (change)="cargar()" /></div>
      <div class="campo"><label for="p-p">Placa</label><input id="p-p" [(ngModel)]="f.placa" (change)="cargar()" style="text-transform:uppercase" placeholder="Todas" /></div>
      <label class="casilla"><input type="checkbox" [(ngModel)]="f.noAptos" (change)="cargar()" />Solo no aptos</label>
    </div>
    <section class="resumen">
      <div><strong>{{ lista().length }}</strong><span>checklists</span></div>
      <div class="ok"><strong>{{ aptos() }}</strong><span>aptos</span></div>
      <div class="mal"><strong>{{ lista().length - aptos() }}</strong><span>no aptos</span></div>
      <div><strong>{{ sinRevision() }}</strong><span>no aptos sin acción registrada</span></div>
    </section>
    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>Diligenciado</th><th>Placa</th><th>Conductor</th><th>Viaje</th><th>Resultado</th><th>No cumple</th><th>Acción de la empresa</th><th></th></tr></thead>
      <tbody>
        @for (i of lista(); track i._id) {
          <tr><td data-etiqueta="Diligenciado">{{ i.fecha | fechaHora }}</td><td data-etiqueta="Placa"><span class="placa">{{ i.placa }}</span></td>
            <td data-etiqueta="Conductor">{{ i.conductor }}</td><td data-etiqueta="Viaje">{{ i.numeroViaje ? 'N.° ' + i.numeroViaje : '' }}</td>
            <td data-etiqueta="Resultado"><span class="chip sin-punto" [class.ok]="i.apto" [class.error]="!i.apto">{{ i.apto ? 'Apto' : 'No apto' }}</span>
              @if (!i.delDia) { <span class="chip alerta sin-punto">No es del día</span> }</td>
            <td data-etiqueta="No cumple" class="nc">{{ noCumple(i) }}</td>
            <td data-etiqueta="Acción">@if (i.revision?.accion) { {{ i.revision.accion }}<span class="sutil d-bloque">{{ i.revision.por }}</span> }
              @else if (!i.apto && gestiona) { <button class="pequeno" (click)="revisar.set(i); accion = ''">Registrar acción</button> }</td>
            <td><button class="pequeno" (click)="visor.ver('/sst/preoperacionales/' + i._id + '/pdf', 'Checklist ' + i.placa, { ver: 1 })"><app-icono nombre="ojo" [tam]="15" />PDF</button></td></tr>
        } @empty {
          <tr><td colspan="8" class="vacio"><strong>Sin checklists en el periodo</strong>Se traen solos de Sur Track al abrir el tablero (cada 15 minutos como mucho) o con «Traer de Sur Track».</td></tr>
        }
      </tbody>
    </table></div>
    <app-visor-pdf #visor />
    <app-modal [titulo]="'Acción con el no apto · ' + (revisar()?.placa || '')" [abierto]="!!revisar()" (cerrar)="revisar.set(null)">
      @if (revisar(); as r) {
        <p class="sutil" style="margin-top:0">No cumple: {{ noCumple(r) }}. Queda en el PDF del checklist con su nombre y la fecha.</p>
        <div class="campo"><label for="ac">Qué se hizo</label><textarea id="ac" rows="3" [(ngModel)]="accion" placeholder="Ej.: se cambiaron las pastillas de freno en el taller antes de salir"></textarea></div>
      }
      <ng-container pie><button (click)="revisar.set(null)">Cancelar</button><button class="primario" (click)="guardarAccion()" [disabled]="accion.trim().length < 3">Guardar</button></ng-container>
    </app-modal>`,
  styles: [`
    .resumen { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .resumen div { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 12px 16px; display: flex; flex-direction: column; }
    .resumen strong { font-size: 24px; } .resumen span { font-size: 12.5px; color: var(--gris-5); } .resumen .ok strong { color: var(--verde); } .resumen .mal strong { color: var(--rojo); }
    @media (max-width: 700px) { .resumen { grid-template-columns: 1fr 1fr; } }
    .placa { font-size: 12px; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: var(--primario); color: #0f0e0c; } .nc { font-size: 12.5px; max-width: 260px; }
  `],
})
export class SstPreoperacionales {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly gestiona = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly lista = signal<any[]>([]);
  readonly trabajando = signal(false);
  readonly revisar = signal<any>(null);
  accion = '';
  f = { desde: inicioMesIso(), hasta: hoyIso(), placa: '', noAptos: false };
  readonly aptos = computed(() => this.lista().filter(i => i.apto).length);
  readonly sinRevision = computed(() => this.lista().filter(i => !i.apto && !i.revision?.accion).length);
  noCumple = (i: any) => (i.items || []).filter((x: any) => !x.cumple).map((x: any) => x.texto + (x.critico ? ' *' : '')).join(', ') || '—';

  constructor() { this.cargar(); }
  async cargar() {
    try { this.lista.set(await this.api.get<any[]>('/sst/preoperacionales', { ...this.f, noAptos: this.f.noAptos ? '1' : '0' })); } catch (e) { this.avisos.error(e); }
  }
  async sincronizar() {
    this.trabajando.set(true);
    try {
      const r: any = await this.api.post('/sst/preoperacionales/sincronizar');
      this.avisos.ok(r.omitido ? `Sur Track: ${r.omitido}` : `${r.nuevas} checklist(s) nuevos de ${r.revisados} conductor(es) revisados`); await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  lote() { this.api.descargar('/sst/preoperacionales.pdf', { placa: this.f.placa, desde: this.f.desde, hasta: this.f.hasta }, 'checklists.pdf').catch(e => this.avisos.error(e)); }
  async guardarAccion() {
    const r = this.revisar();
    try { await this.api.put(`/sst/preoperacionales/${r._id}/revision`, { accion: this.accion }); this.revisar.set(null); this.avisos.ok('Acción registrada'); this.cargar(); } catch (e) { this.avisos.error(e); }
  }
}
