import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { VisorPdf } from './visor-pdf';

type Agrupar = 'general' | 'empresa' | 'placa';
type Periodo = 'hoy' | 'semana' | 'quincena' | 'mes' | 'otro';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Rango de cada periodo: semana de lunes a hoy, quincena (1–15 o 16–fin de mes) y mes en curso
export function rangoPeriodo(p: Periodo, hoy = new Date()): { desde: string; hasta: string } | null {
  const y = hoy.getFullYear(); const m = hoy.getMonth(); const d = hoy.getDate();
  if (p === 'hoy') return { desde: iso(hoy), hasta: iso(hoy) };
  if (p === 'semana') { const l = new Date(hoy); l.setDate(d - ((hoy.getDay() + 6) % 7)); return { desde: iso(l), hasta: iso(hoy) }; }
  if (p === 'quincena') return d <= 15 ? { desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m, 15)) } : { desde: iso(new Date(y, m, 16)), hasta: iso(new Date(y, m + 1, 0)) };
  if (p === 'mes') return { desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m + 1, 0)) };
  return null;
}

// Exportar viajes a Excel o PDF: general, por empresa o por placa, con periodos rápidos o fechas a elección.
// Uso: <app-exportar-viajes #exp [clientes]="clientes()" /> … exp.abrir('pdf')
@Component({
  selector: 'app-exportar-viajes',
  imports: [FormsModule, Modal, Icono, VisorPdf],
  template: `
    <app-modal titulo="Exportar viajes" [abierto]="abierto()" (cerrar)="abierto.set(false)">
      <fieldset class="bloque">
        <legend>¿Cómo los quiere?</legend>
        <div class="tarjetas">
          @for (o of AGRUPAR; track o.v) {
            <button type="button" class="tarjeta" [class.activo]="agrupar() === o.v" [attr.aria-pressed]="agrupar() === o.v" (click)="agrupar.set(o.v)">
              <app-icono [nombre]="o.icono" [tam]="20" /><strong>{{ o.t }}</strong><span>{{ o.d }}</span>
            </button>
          }
        </div>
      </fieldset>

      <fieldset class="bloque">
        <legend>Periodo</legend>
        <div class="segmentos">
          @for (o of PERIODOS; track o.v) {
            <button type="button" [class.activo]="periodo() === o.v" [attr.aria-pressed]="periodo() === o.v" (click)="elegirPeriodo(o.v)">{{ o.t }}</button>
          }
        </div>
        <div class="fechas">
          <div class="campo"><label for="ex-desde">Desde</label><input id="ex-desde" type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event); periodo.set('otro')" /></div>
          <div class="campo"><label for="ex-hasta">Hasta</label><input id="ex-hasta" type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event); periodo.set('otro')" /></div>
        </div>
      </fieldset>

      <fieldset class="bloque">
        <legend>Filtrar (opcional)</legend>
        <div class="fechas">
          <div class="campo"><label for="ex-cli">Empresa</label>
            <select id="ex-cli" [ngModel]="cliente()" (ngModelChange)="cliente.set($event)"><option value="">Todas</option>
              @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
          <div class="campo"><label for="ex-placa">Placa</label>
            <input id="ex-placa" placeholder="Todas" maxlength="7" [ngModel]="placa()" (ngModelChange)="placa.set(($event || '').toUpperCase())" /></div>
        </div>
      </fieldset>

      <p class="resumen" aria-live="polite">{{ resumen() }}</p>

      <ng-container pie>
        <button type="button" class="texto" (click)="abierto.set(false)">Cancelar</button>
        <button type="button" (click)="exportar('xlsx')" [disabled]="ocupado() || !valido()"><app-icono nombre="descargar" [tam]="16" />Excel</button>
        <button type="button" class="primario" (click)="exportar('pdf')" [disabled]="ocupado() || !valido()"><app-icono nombre="ojo" [tam]="16" />Ver PDF</button>
      </ng-container>
    </app-modal>
    <app-visor-pdf />`,
  styles: [`
    .bloque { border: 0; padding: 0; margin: 0 0 18px; min-width: 0; }
    legend { font-weight: 650; font-size: 13px; color: var(--gris-6); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .04em; }
    .tarjetas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tarjeta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border-radius: 14px; text-align: left;
      border: 1.5px solid var(--gris-2); background: var(--gris-0); height: auto; white-space: normal; cursor: pointer; transition: border-color .15s, background .15s; }
    .tarjeta span { font-size: 12px; color: var(--gris-6); font-weight: 400; line-height: 1.3; }
    .tarjeta.activo { border-color: var(--primario-borde); background: var(--primario-claro); box-shadow: 0 0 0 1px var(--primario-borde); }
    .tarjeta.activo app-icono { color: var(--primario-texto); }
    .segmentos { margin-bottom: 12px; }
    .fechas { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .resumen { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--gris-1); font-size: 13px; color: var(--gris-7); }
    @media (max-width: 560px) { .tarjetas { grid-template-columns: 1fr; } .fechas { grid-template-columns: 1fr; } }
  `],
})
export class ExportarViajes {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly clientes = input<any[]>([]);
  private visor = viewChild.required(VisorPdf);

  readonly AGRUPAR: { v: Agrupar; t: string; d: string; icono: string }[] = [
    { v: 'general', t: 'General', d: 'Todos los viajes por fecha', icono: 'lista' },
    { v: 'empresa', t: 'Por empresa', d: 'Agrupados por empresa y placa, con subtotales', icono: 'edificio' },
    { v: 'placa', t: 'Por placa', d: 'Agrupados por vehículo, con subtotales', icono: 'camion' },
  ];
  readonly PERIODOS: { v: Periodo; t: string }[] = [
    { v: 'hoy', t: 'Hoy' }, { v: 'semana', t: 'Esta semana' }, { v: 'quincena', t: 'Quincena' }, { v: 'mes', t: 'Mes' }, { v: 'otro', t: 'Elegir fechas' },
  ];

  readonly abierto = signal(false);
  readonly ocupado = signal(false);
  readonly agrupar = signal<Agrupar>('general');
  readonly periodo = signal<Periodo>('hoy');
  readonly desde = signal(iso(new Date()));
  readonly hasta = signal(iso(new Date()));
  readonly cliente = signal('');
  readonly placa = signal('');
  readonly valido = computed(() => !!this.desde() && !!this.hasta() && this.desde() <= this.hasta());
  readonly resumen = computed(() => {
    if (!this.valido()) return 'Revise las fechas: «Desde» debe ser anterior o igual a «Hasta».';
    const f = (s: string) => s.split('-').reverse().join('/');
    const a = { general: 'Todos los viajes', empresa: 'Viajes por empresa', placa: 'Viajes por placa' }[this.agrupar()];
    const cli = this.clientes().find(c => c._id === this.cliente())?.nombre;
    return `${a} del ${f(this.desde())} al ${f(this.hasta())}${cli ? ` de ${cli}` : ''}${this.placa() ? `, placa ${this.placa()}` : ''}.`;
  });

  // Abre con los filtros que tenga la pantalla de viajes
  abrir(previo: { cliente?: string } = {}) {
    try { const g = localStorage.getItem('tls_exportar'); if (g) { const x = JSON.parse(g); this.agrupar.set(x.agrupar || 'general'); this.periodo.set(x.periodo || 'hoy'); } } catch { /* sin almacenamiento */ }
    const r = rangoPeriodo(this.periodo());
    if (r) { this.desde.set(r.desde); this.hasta.set(r.hasta); }
    this.cliente.set(previo.cliente || '');
    this.placa.set('');
    this.abierto.set(true);
  }

  elegirPeriodo(p: Periodo) {
    this.periodo.set(p);
    const r = rangoPeriodo(p);
    if (r) { this.desde.set(r.desde); this.hasta.set(r.hasta); }
    else setTimeout(() => document.getElementById('ex-desde')?.focus(), 20);
  }

  async exportar(formato: 'xlsx' | 'pdf') {
    const params = { agrupar: this.agrupar(), desde: this.desde(), hasta: this.hasta(), cliente: this.cliente(), placa: this.placa(), formato };
    try { localStorage.setItem('tls_exportar', JSON.stringify({ agrupar: this.agrupar(), periodo: this.periodo() })); } catch { /* sin almacenamiento */ }
    this.ocupado.set(true);
    try {
      if (formato === 'pdf') { this.abierto.set(false); await this.visor().ver('/gestion/relaciones/viajes', this.resumen(), { ...params, ver: '1' }); }
      else { await this.api.descargar('/gestion/relaciones/viajes', params, `viajes_${this.agrupar()}_${this.desde()}_${this.hasta()}.xlsx`); this.abierto.set(false); }
    } catch (e) { this.avisos.error(e); }
    finally { this.ocupado.set(false); }
  }
}
