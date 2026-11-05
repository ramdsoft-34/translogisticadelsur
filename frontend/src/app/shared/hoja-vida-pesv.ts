import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from './modal';
import { Icono } from './icono';
import { VisorPdf } from './visor-pdf';
import { FORMATOS, isoDia, hoyIso, inicioMesIso } from './formato';

const PLAN_BASE = [
  { actividad: 'Cambio de aceite y filtros', cadaKm: 10000, cadaDias: 180 }, { actividad: 'Revisión de frenos', cadaKm: 20000, cadaDias: 180 },
  { actividad: 'Rotación y alineación de llantas', cadaKm: 15000, cadaDias: null }, { actividad: 'Revisión de suspensión y dirección', cadaKm: 30000, cadaDias: 365 },
  { actividad: 'Sistema eléctrico y luces', cadaKm: null, cadaDias: 90 },
];

// Hoja de vida del PESV dentro de la ficha del vehículo: kilometraje (odómetro + lo recorrido en Sur Track), pólizas,
// plan de mantenimiento preventivo, historial y checklists de Sur Track.
// Uso: <app-hoja-vida-pesv #pesv /> … pesv.abrir(vehiculoId)
@Component({
  selector: 'app-hoja-vida-pesv',
  imports: [FormsModule, Modal, Icono, VisorPdf, ...FORMATOS],
  template: `
    <app-modal [titulo]="'Mantenimiento y PESV · ' + (v()?.placa || '')" [abierto]="!!v()" (cerrar)="v.set(null)" [ancho]="true">
      @if (v(); as x) {
        <section class="km">
          <div><span>Odómetro (última lectura)</span><strong>{{ x.form.kmActual != null ? (x.form.kmActual | miles) + ' km' : '—' }}</strong></div>
          <div><span>Recorrido después con Sur Track</span><strong>{{ x.kmSurTrack | miles }} km</strong></div>
          <div class="destacado"><span>Kilometraje estimado hoy</span><strong>{{ x.kmEstimado != null ? (x.kmEstimado | miles) + ' km' : '—' }}</strong></div>
          <div><span>Recorrido este mes</span><strong>{{ x.kmMes | miles }} km</strong></div>
        </section>
        <form id="form-pesv" (ngSubmit)="guardar()">
          <fieldset><legend>Odómetro y pólizas</legend><div class="formulario">
            <div class="campo"><label>Lectura del odómetro</label><input type="number" name="km" [(ngModel)]="x.form.kmActual" [disabled]="!gestiona" /><small>Al cambiarla, la suma de Sur Track vuelve a cero</small></div>
            <div class="campo"><label>RC contractual vence</label><input type="date" name="rcc" [(ngModel)]="x.form.venceRcContractual" [disabled]="!gestiona" /></div>
            <div class="campo"><label>RC extracontractual vence</label><input type="date" name="rce" [(ngModel)]="x.form.venceRcExtracontractual" [disabled]="!gestiona" /></div>
            <div class="campo"><label>SOAT · técnico-mecánica</label><input [value]="(x.soat?.vence | dia) + ' · ' + (x.venceTecnomecanica | dia)" disabled /><small>Se editan en la ficha del vehículo</small></div>
          </div></fieldset>
          <fieldset><legend>Plan de mantenimiento preventivo (lo que llegue primero: kilómetros o días)</legend>
            <div class="tabla-caja"><table>
              <thead><tr><th>Actividad</th><th>Cada km</th><th>Cada días</th><th>Último km</th><th>Última fecha</th><th>Próximo</th><th></th></tr></thead>
              <tbody>@for (p of x.form.plan; track $index; let i = $index) {
                <tr><td><input [(ngModel)]="p.actividad" [name]="'a' + i" [disabled]="!gestiona" /></td><td><input type="number" [(ngModel)]="p.cadaKm" [name]="'k' + i" [disabled]="!gestiona" /></td>
                  <td><input type="number" [(ngModel)]="p.cadaDias" [name]="'d' + i" [disabled]="!gestiona" /></td><td><input type="number" [(ngModel)]="p.ultimoKm" [name]="'u' + i" [disabled]="!gestiona" /></td>
                  <td><input type="date" [(ngModel)]="p.ultimaFecha" [name]="'f' + i" [disabled]="!gestiona" /></td>
                  <td class="prox" [class.rojo]="p.urgente">{{ p.texto || '—' }}</td>
                  <td>@if (gestiona) { <button type="button" class="pequeno texto" (click)="x.form.plan.splice(i, 1)" aria-label="Quitar"><app-icono nombre="x" [tam]="14" /></button> }</td></tr>
              } @empty { <tr><td colspan="7" class="vacio">Sin plan. Use el plan base y ajústelo al manual del fabricante.</td></tr> }</tbody></table></div>
            @if (gestiona) { <div class="acciones" style="margin-top:8px">
              <button type="button" class="pequeno" (click)="x.form.plan.push({ actividad: '', cadaKm: null, cadaDias: null, ultimoKm: x.kmEstimado, ultimaFecha: hoy })"><app-icono nombre="mas" [tam]="14" />Agregar actividad</button>
              @if (!x.form.plan.length) { <button type="button" class="pequeno" (click)="planBase(x)">Usar plan base</button> }</div> }
          </fieldset>
        </form>
        <fieldset><legend>Historial de mantenimientos</legend>
          <div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Km</th><th>Taller</th><th>Costo</th></tr></thead><tbody>
            @for (m of x.mantenimientos; track m._id) {
              <tr><td>{{ m.fecha | dia }}</td><td><span class="chip sin-punto" [class.info]="m.tipo === 'preventivo'" [class.alerta]="m.tipo === 'correctivo'">{{ m.tipo }}</span></td><td>{{ m.actividad }}</td><td>{{ m.km | miles }}</td><td>{{ m.taller }}</td><td>{{ m.costo | pesos }}</td></tr>
            } @empty { <tr><td colspan="6" class="vacio">Sin mantenimientos registrados.</td></tr> }</tbody></table></div>
          @if (gestiona) {
            <form class="formulario agregar" (ngSubmit)="registrar()">
              <div class="campo"><label>Tipo</label><select name="mt" [(ngModel)]="m.tipo"><option value="preventivo">Preventivo</option><option value="correctivo">Correctivo</option></select></div>
              <div class="campo"><label>Actividad</label><input name="ma" [(ngModel)]="m.actividad" list="act-plan" required /><datalist id="act-plan">@for (p of x.form.plan; track $index) { <option [value]="p.actividad"></option> }</datalist></div>
              <div class="campo"><label>Fecha</label><input type="date" name="mf" [(ngModel)]="m.fecha" required /></div>
              <div class="campo"><label>Km del odómetro</label><input type="number" name="mk" [(ngModel)]="m.km" /></div>
              <div class="campo"><label>Taller</label><input name="mta" [(ngModel)]="m.taller" /></div>
              <div class="campo"><label>Costo</label><input type="number" name="mc" [(ngModel)]="m.costo" /></div>
              <div class="campo"><button class="primario" type="submit"><app-icono nombre="mas" />Registrar</button></div>
            </form>
          }
        </fieldset>
        <fieldset><legend>Checklists preoperacionales (Sur Track)</legend>
          <div class="acciones" style="margin-bottom:8px"><button type="button" class="pequeno" (click)="lote(x.placa)"><app-icono nombre="descargar" [tam]="14" />Todos los de este mes en un PDF</button></div>
          <div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Conductor</th><th>Viaje</th><th>Resultado</th><th></th></tr></thead><tbody>
            @for (c of x.checklists; track c._id) {
              <tr><td>{{ c.fecha | fechaHora }}</td><td>{{ c.conductor }}</td><td>{{ c.numeroViaje ? 'N.° ' + c.numeroViaje : '' }}</td>
                <td><span class="chip sin-punto" [class.ok]="c.apto" [class.error]="!c.apto">{{ c.apto ? 'Apto' : 'No apto' }}</span> @if (!c.delDia) { <span class="chip alerta sin-punto">No es del día</span> }</td>
                <td><button class="pequeno" (click)="visor.ver('/sst/preoperacionales/' + c._id + '/pdf', 'Checklist ' + x.placa, { ver: 1 })"><app-icono nombre="ojo" [tam]="14" />PDF</button></td></tr>
            } @empty { <tr><td colspan="5" class="vacio">Sin checklists guardados de Sur Track.</td></tr> }</tbody></table></div>
        </fieldset>
      }
      <ng-container pie><button type="button" (click)="v.set(null)">Cerrar</button>
        @if (gestiona) { <button type="submit" form="form-pesv" class="primario">Guardar</button> }</ng-container>
    </app-modal>
    <app-visor-pdf #visor />`,
  styles: [`
    .km { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
    .km div { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); }
    .km div.destacado { background: var(--primario-claro); border-color: var(--primario-borde); } .km span { font-size: 12px; color: var(--gris-5); } .km strong { font-size: 19px; }
    @media (max-width: 800px) { .km { grid-template-columns: 1fr 1fr; } }
    .agregar { margin-top: 14px; padding: 14px; border: 1px dashed var(--gris-3); border-radius: var(--radio-l); align-items: end; }
    td input { min-height: 34px; } .prox { font-size: 12.5px; min-width: 150px; } .rojo { color: var(--rojo); font-weight: 600; }
  `],
})
export class HojaVidaPesv {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly gestiona = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly v = signal<any>(null);
  readonly hoy = hoyIso();
  m: any = { tipo: 'preventivo', actividad: '', fecha: hoyIso(), km: null, taller: '', costo: 0 };

  async abrir(id: string) {
    try {
      const x: any = await this.api.get(`/sst/flota/${id}`);
      x.form = { kmActual: x.sst?.kmActual ?? null, venceRcContractual: isoDia(x.sst?.venceRcContractual), venceRcExtracontractual: isoDia(x.sst?.venceRcExtracontractual),
        plan: (x.plan || []).map((p: any) => ({ actividad: p.actividad, cadaKm: p.cadaKm, cadaDias: p.cadaDias, ultimoKm: p.ultimoKm, ultimaFecha: isoDia(p.ultimaFecha), ...this.proximo(p) })) };
      this.v.set(x);
    } catch (e) { this.avisos.error(e); }
  }
  proximo(p: any) {
    const dias = p.porFecha ? Math.round((new Date(p.porFecha).getTime() - Date.now()) / 864e5) : null; const km = p.kmFaltan;
    const partes = [km != null ? (km <= 0 ? `pasado ${(-km).toLocaleString('es-CO')} km` : `en ${km.toLocaleString('es-CO')} km`) : '', dias != null ? (dias < 0 ? `vencido hace ${-dias} d` : `en ${dias} d`) : ''].filter(Boolean);
    return { texto: partes.join(' o '), urgente: (km != null && km <= 1000) || (dias != null && dias <= 7) };
  }
  planBase(x: any) { x.form.plan = PLAN_BASE.map(p => ({ ...p, ultimoKm: x.kmEstimado, ultimaFecha: hoyIso() })); }
  async guardar() {
    const x = this.v();
    try {
      await this.api.put(`/sst/flota/${x._id}`, { kmActual: x.form.kmActual, venceRcContractual: x.form.venceRcContractual, venceRcExtracontractual: x.form.venceRcExtracontractual,
        plan: x.form.plan.filter((p: any) => p.actividad).map((p: any) => ({ actividad: p.actividad, cadaKm: p.cadaKm, cadaDias: p.cadaDias, ultimoKm: p.ultimoKm, ultimaFecha: p.ultimaFecha })) });
      this.avisos.ok('Guardado'); await this.abrir(x._id);
    } catch (e) { this.avisos.error(e); }
  }
  async registrar() {
    const x = this.v();
    try { await this.api.post(`/sst/flota/${x._id}/mantenimientos`, this.m); this.avisos.ok('Mantenimiento registrado'); this.m = { tipo: 'preventivo', actividad: '', fecha: hoyIso(), km: null, taller: '', costo: 0 }; await this.abrir(x._id); }
    catch (e) { this.avisos.error(e); }
  }
  lote(placa: string) { this.api.descargar('/sst/preoperacionales.pdf', { placa, desde: inicioMesIso(), hasta: hoyIso() }, `checklists_${placa}.pdf`).catch(e => this.avisos.error(e)); }
}
