import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from '../shared/icono';

const NIVEL: Record<string, string> = { basico: 'Básico', estandar: 'Estándar', avanzado: 'Avanzado' };
const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V'];

// SuperAdmin: cómo va el SG-SST y el PESV de cada empresa (solo cifras; los datos de las personas son de cada empresa)
@Component({
  selector: 'app-admin-sst',
  imports: [FormsModule, Icono],
  template: `
    <div class="pagina-cab">
      <div><h1>SST y PESV de las empresas</h1><p class="sutil">Cumplimiento y vencimientos de cada empresa. El detalle lo trabaja el responsable del SG-SST dentro de su empresa.</p></div>
      <div class="acciones"><div class="campo"><label for="a-e">Empresa</label>
        <select id="a-e" [(ngModel)]="seleccion"><option value="">Todas</option>@for (e of lista(); track e._id) { <option [value]="e._id">{{ e.nombre }}</option> }</select></div></div>
    </div>
    <div class="tarjetas">
      @for (e of filtradas(); track e._id) {
        <article class="tarjeta" [class.mal]="e.vencidos > 0 || (e.puntaje0312 != null && e.puntaje0312 < 60)">
          <header><strong>{{ e.nombre }}</strong><span class="sutil">NIT {{ e.nit }}</span></header>
          <div class="metas">
            <div><span>Res. 0312</span><b [class]="clase(e.puntaje0312)">{{ e.puntaje0312 != null ? e.puntaje0312 + ' %' : '—' }}</b></div>
            <div><span>PESV</span><b [class]="clase(e.puntajePesv)">{{ e.puntajePesv != null ? e.puntajePesv + ' %' : '—' }}</b></div>
            <div><span>Riesgo</span><b>{{ romano(e.claseRiesgo) || '—' }}</b></div>
            <div><span>Nivel PESV</span><b>{{ nivel(e.nivelPesv) || '—' }}</b></div>
          </div>
          <ul>
            <li><app-icono nombre="personas" [tam]="15" />{{ e.colaboradores }} colaboradores · {{ e.vehiculos }} vehículos</li>
            <li><app-icono nombre="check" [tam]="15" />{{ e.inspecciones30 }} preoperacionales en 30 días @if (e.noAptos30) { · <span class="rojo">{{ e.noAptos30 }} no aptos</span> }</li>
            <li><app-icono nombre="alerta" [tam]="15" /><span [class.rojo]="e.vencidos">{{ e.vencidos }} vencidos</span> · {{ e.porVencer }} por vencer</li>
          </ul>
        </article>
      } @empty { <p class="sutil">{{ cargando() ? 'Cargando…' : 'No hay empresas activas.' }}</p> }
    </div>`,
  styles: [`
    .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
    .tarjeta { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 16px; border-top: 3px solid var(--verde); display: flex; flex-direction: column; gap: 12px; }
    .tarjeta.mal { border-top-color: var(--rojo); } .tarjeta header { display: flex; flex-direction: column; }
    .metas { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; } .metas div { display: flex; flex-direction: column; background: var(--gris-1); border-radius: 10px; padding: 8px; }
    .metas span { font-size: 11px; color: var(--gris-5); } .metas b { font-size: 16px; } b.critico { color: var(--rojo); } b.moderado { color: var(--ambar); } b.aceptable { color: var(--verde); }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; } li { display: flex; gap: 8px; align-items: center; }
    .rojo { color: var(--rojo); font-weight: 700; }
  `],
})
export class AdminSst {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly lista = signal<any[]>([]);
  readonly cargando = signal(true);
  seleccion = '';
  romano = (n: number) => ROMANOS[n] || '';
  nivel = (n: string) => NIVEL[n] || '';
  clase = (n: number | null) => (n == null ? '' : n < 60 ? 'critico' : n <= 85 ? 'moderado' : 'aceptable');
  constructor() { this.cargar(); }
  async cargar() { try { this.lista.set(await this.api.get<any[]>('/admin/sst-resumen')); } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); } }
  filtradas() { return this.seleccion ? this.lista().filter(e => e._id === this.seleccion) : this.lista(); }
}
