import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from './modal';
import { Icono } from './icono';
import { Firma } from './firma';
import { Confirmar } from './confirmar';
import { VisorPdf } from './visor-pdf';
import { FORMATOS, hoyIso } from './formato';

const CONCEPTO: Record<string, string> = { apto: 'Apto', apto_con_restricciones: 'Apto con restricciones', no_apto: 'No apto', aplazado: 'Aplazado' };

// SG-SST y PESV de una persona, dentro de su ficha: el conductor (Conductores y terceros) o el empleado (Nómina).
// Uso: <app-perfil-sst #sst /> … sst.abrir('tercero', id)
@Component({
  selector: 'app-perfil-sst',
  imports: [FormsModule, Modal, Icono, Firma, Confirmar, VisorPdf, ...FORMATOS],
  template: `
    <app-modal [titulo]="'SST y PESV · ' + (p()?.nombre || '')" [abierto]="!!p()" (cerrar)="p.set(null)" [ancho]="true">
      @if (p(); as x) {
        <div class="cab"><span class="sutil">{{ x.documento }} · {{ x.cargo }}</span>
          @if (x.licencia?.vence) { <span class="chip sin-punto" [class]="claseVence(x.licencia.vence)">Licencia {{ x.licencia.categoria }} · vence {{ x.licencia.vence | dia }}</span> }</div>
        <nav class="pestanas" role="tablist">
          @for (t of pestanas(); track t[0]) { <button type="button" role="tab" [class.activa]="pestana() === t[0]" (click)="pestana.set(t[0])">{{ t[1] }}</button> }
        </nav>
        @switch (pestana()) {
          @case ('vial') {
            <h3>Checklists preoperacionales (Sur Track)</h3>
            <div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Placa</th><th>Viaje</th><th>Resultado</th><th></th></tr></thead><tbody>
              @for (c of x.checklists; track c._id) {
                <tr><td>{{ c.fecha | fechaHora }}</td><td><span class="placa">{{ c.placa }}</span></td><td>{{ c.numeroViaje ? 'N.° ' + c.numeroViaje : '' }}</td>
                  <td><span class="chip sin-punto" [class.ok]="c.apto" [class.error]="!c.apto">{{ c.apto ? 'Apto' : 'No apto' }}</span> @if (!c.delDia) { <span class="chip alerta sin-punto">No es del día</span> }</td>
                  <td><button class="pequeno" (click)="visor.ver('/sst/preoperacionales/' + c._id + '/pdf', 'Checklist ' + c.placa, { ver: 1 })"><app-icono nombre="ojo" [tam]="14" />PDF</button></td></tr>
              } @empty { <tr><td colspan="5" class="vacio">{{ x.tipo === 'tercero' ? 'Sin checklists guardados de Sur Track.' : 'No es conductor.' }}</td></tr> }
            </tbody></table></div>
            <h3>Excesos de velocidad (Sur Track, límite {{ x.limiteVelocidad }} km/h)</h3>
            <ul class="lista">@for (e of x.excesos; track e.numero) { <li><span class="chip error sin-punto">{{ e.velocidad }} km/h</span><span>Viaje N.° {{ e.numero }} · <span class="placa">{{ e.placa }}</span> · {{ e.fecha | dia }}</span></li> }
              @empty { <li class="sutil">Sin excesos registrados.</li> }</ul>
            <h3>Capacitaciones</h3>
            <ul class="lista">@for (c of x.capacitaciones; track c._id) { <li><strong>{{ c.tema }}</strong><span class="sutil">{{ c.fecha | dia }} · {{ c.horas }} h · {{ c.estado }}</span></li> }
              @empty { <li class="sutil">No ha asistido a capacitaciones registradas.</li> }</ul>
            <h3>Comparendos</h3>
            <div class="tabla-caja"><table><thead><tr><th>Fecha</th><th>N.°</th><th>Infracción</th><th>Placa</th><th>Valor</th><th>Estado</th><th></th></tr></thead><tbody>
              @for (c of x.sst.comparendos || []; track c._id) {
                <tr><td>{{ c.fecha | dia }}</td><td>{{ c.numero }}</td><td>{{ c.codigo }} {{ c.descripcion }}</td><td>{{ c.placa }}</td><td>{{ c.valor | pesos }}</td>
                  <td><span class="chip sin-punto" [class.error]="c.estado === 'pendiente'" [class.ok]="c.estado === 'pagado'">{{ c.estado }}</span></td>
                  <td>@if (gestiona) { <button class="pequeno texto" confirmar="¿Borrar?" (confirmado)="borrar('comparendos', c._id)"><app-icono nombre="x" [tam]="14" /></button> }</td></tr>
              } @empty { <tr><td colspan="7" class="vacio">Sin comparendos. Consulte el SIMIT con el documento.</td></tr> }
            </tbody></table></div>
            @if (gestiona) {
              <form class="formulario agregar" (ngSubmit)="agregar('comparendos', comp); comp = nuevoComp()">
                <div class="campo"><label>Fecha</label><input type="date" name="cf" [(ngModel)]="comp.fecha" required /></div>
                <div class="campo"><label>N.° comparendo</label><input name="cn" [(ngModel)]="comp.numero" /></div>
                <div class="campo"><label>Código</label><input name="cc" [(ngModel)]="comp.codigo" placeholder="C29" /></div>
                <div class="campo"><label>Descripción</label><input name="cd" [(ngModel)]="comp.descripcion" /></div>
                <div class="campo"><label>Placa</label><input name="cp" [(ngModel)]="comp.placa" style="text-transform:uppercase" /></div>
                <div class="campo"><label>Valor</label><input type="number" name="cv" [(ngModel)]="comp.valor" /></div>
                <div class="campo"><button class="primario" type="submit"><app-icono nombre="mas" />Agregar comparendo</button></div>
              </form>
            }
          }
          @case ('examenes') {
            <div class="mensaje info">Historia clínica ocupacional: solo la ve quien gestiona el SG-SST.</div>
            <div class="tabla-caja"><table><thead><tr><th>Tipo</th><th>Fecha</th><th>IPS</th><th>Concepto</th><th>Restricciones</th><th>Próximo</th><th></th></tr></thead><tbody>
              @for (e of x.sst.examenes || []; track e._id) {
                <tr><td>{{ e.tipo }}</td><td>{{ e.fecha | dia }}</td><td>{{ e.ips }}</td>
                  <td><span class="chip sin-punto" [class.ok]="e.concepto === 'apto'" [class.alerta]="e.concepto === 'apto_con_restricciones'" [class.error]="e.concepto === 'no_apto'">{{ concepto(e.concepto) }}</span></td>
                  <td>{{ e.restricciones }}</td><td><span class="chip sin-punto" [class]="claseVence(e.vence)">{{ e.vence | dia }}</span></td>
                  <td><button class="pequeno texto" confirmar="¿Borrar?" (confirmado)="borrar('examenes', e._id)"><app-icono nombre="x" [tam]="14" /></button></td></tr>
              } @empty { <tr><td colspan="7" class="vacio">Sin exámenes registrados.</td></tr> }
            </tbody></table></div>
            <form class="formulario agregar" (ngSubmit)="agregar('examenes', ex)">
              <div class="campo"><label>Tipo</label><select name="et" [(ngModel)]="ex.tipo"><option value="ingreso">Ingreso</option><option value="periodico">Periódico</option><option value="retiro">Retiro</option><option value="post_incapacidad">Post incapacidad</option></select></div>
              <div class="campo"><label>Fecha</label><input type="date" name="ef" [(ngModel)]="ex.fecha" required /></div>
              <div class="campo"><label>IPS</label><input name="ei" [(ngModel)]="ex.ips" /></div>
              <div class="campo"><label>Concepto</label><select name="ec" [(ngModel)]="ex.concepto"><option value="apto">Apto</option><option value="apto_con_restricciones">Apto con restricciones</option><option value="no_apto">No apto</option><option value="aplazado">Aplazado</option></select></div>
              <div class="campo"><label>Restricciones</label><input name="er" [(ngModel)]="ex.restricciones" /></div>
              <div class="campo"><label>Próximo examen</label><input type="date" name="ev" [(ngModel)]="ex.vence" /></div>
              <div class="campo"><button class="primario" type="submit"><app-icono nombre="mas" />Agregar examen</button></div>
            </form>
          }
          @case ('epp') {
            <div class="tabla-caja"><table><thead><tr><th>Elemento</th><th>Cant.</th><th>Entrega</th><th>Reposición</th><th>Recibido</th><th></th></tr></thead><tbody>
              @for (e of x.sst.epp || []; track e._id) {
                <tr><td>{{ e.elemento }}</td><td>{{ e.cantidad }}</td><td>{{ e.entrega | dia }}</td><td><span class="chip sin-punto" [class]="claseVence(e.reposicion)">{{ e.reposicion | dia }}</span></td>
                  <td>@if (e.firma?.imagen) { <img [src]="e.firma.imagen" alt="Firma" class="mini-firma" /> } @else { <span class="sutil">Sin firma</span> }</td>
                  <td>@if (gestiona) { <button class="pequeno texto" confirmar="¿Borrar?" (confirmado)="borrar('epp', e._id)"><app-icono nombre="x" [tam]="14" /></button> }</td></tr>
              } @empty { <tr><td colspan="6" class="vacio">Sin entregas de EPP.</td></tr> }
            </tbody></table></div>
            @if (gestiona) {
              <form class="formulario agregar" (ngSubmit)="agregarEpp()">
                <div class="campo"><label>Elemento</label><input name="pe" [(ngModel)]="epp.elemento" list="lista-epp" required />
                  <datalist id="lista-epp">@for (e of EPP; track e) { <option [value]="e"></option> }</datalist></div>
                <div class="campo"><label>Cantidad</label><input type="number" min="1" name="pc" [(ngModel)]="epp.cantidad" /></div>
                <div class="campo"><label>Entrega</label><input type="date" name="pf" [(ngModel)]="epp.entrega" required /></div>
                <div class="campo"><label>Reposición</label><input type="date" name="pr" [(ngModel)]="epp.reposicion" /></div>
                <div class="campo ancho"><label>Firma de quien recibe</label><app-firma [valor]="epp.firma" (cambio)="epp.firma = $event" [etiqueta]="x.nombre" /></div>
                <div class="campo"><button class="primario" type="submit"><app-icono nombre="mas" />Registrar entrega</button></div>
              </form>
            }
          }
        }
      }
      <ng-container pie><button type="button" (click)="p.set(null)">Cerrar</button></ng-container>
    </app-modal>
    <app-visor-pdf #visor />`,
  styles: [`
    .cab { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: -8px 0 10px; }
    .pestanas { display: flex; gap: 4px; border-bottom: 1px solid var(--gris-2); margin: 0 0 16px; overflow-x: auto; }
    .pestanas button { border: 0; box-shadow: none; background: none; border-radius: 0; border-bottom: 2px solid transparent; padding: 10px 14px; font-weight: 600; color: var(--gris-5); white-space: nowrap; }
    .pestanas button.activa { color: var(--gris-8); border-bottom-color: var(--primario); }
    h3 { font-size: 14.5px; margin: 18px 0 8px; } h3:first-of-type { margin-top: 0; }
    .agregar { margin-top: 14px; padding: 14px; border: 1px dashed var(--gris-3); border-radius: var(--radio-l); align-items: end; } .agregar .ancho { grid-column: 1 / -1; }
    .lista { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; } .lista li { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
    .placa { font-size: 12px; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: var(--primario); color: #0f0e0c; } .mini-firma { height: 30px; }
  `],
})
export class PerfilSst {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly gestiona = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly p = signal<any>(null);
  readonly pestana = signal('vial');
  readonly EPP = ['Chaleco reflectivo', 'Guantes de vaqueta', 'Botas de seguridad', 'Casco', 'Gafas de seguridad', 'Tapabocas', 'Protector auditivo', 'Impermeable'];
  readonly pestanas = computed(() => [['vial', 'Seguridad vial y capacitaciones'], ...(this.gestiona ? [['examenes', 'Exámenes médicos']] : []), ['epp', 'EPP']]);
  private tipo = ''; private id = '';
  ex: any = { tipo: 'periodico', fecha: hoyIso(), ips: '', concepto: 'apto', restricciones: '', vence: '' };
  epp: any = { elemento: '', cantidad: 1, entrega: hoyIso(), reposicion: '', firma: '' };
  nuevoComp = () => ({ fecha: '', numero: '', codigo: '', descripcion: '', placa: '', valor: 0, estado: 'pendiente' });
  comp: any = this.nuevoComp();
  concepto = (c: string) => CONCEPTO[c] || c;
  claseVence(v: string) { if (!v) return ''; const d = (new Date(v).getTime() - Date.now()) / 864e5; return d < 0 ? 'error' : d <= 30 ? 'alerta' : 'ok'; }

  async abrir(tipo: 'tercero' | 'empleado', id: string, pestana = 'vial') {
    this.tipo = tipo; this.id = id;
    try { this.p.set(await this.api.get(`/sst/personas/${tipo}/${id}`)); this.pestana.set(pestana); } catch (e) { this.avisos.error(e); }
  }
  private async recargar() { const t = this.pestana(); await this.abrir(this.tipo as any, this.id, t); }
  async agregar(sub: string, d: any) {
    try { await this.api.post(`/sst/personas/${this.tipo}/${this.id}/${sub}`, d); this.avisos.ok('Agregado'); await this.recargar(); } catch (e) { this.avisos.error(e); }
  }
  async agregarEpp() {
    const x = this.p();
    await this.agregar('epp', { ...this.epp, firma: this.epp.firma ? { rol: 'recibe', nombre: x.nombre, documento: x.documento, imagen: this.epp.firma } : null });
    this.epp = { elemento: '', cantidad: 1, entrega: hoyIso(), reposicion: '', firma: '' };
  }
  async borrar(sub: string, item: string) {
    try { await this.api.delete(`/sst/personas/${this.tipo}/${this.id}/${sub}/${item}`); await this.recargar(); } catch (e) { this.avisos.error(e); }
  }
}
