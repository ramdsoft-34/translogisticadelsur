import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { FORMATOS } from './formato';
import { Icono } from './icono';

// Visor de auditoría para la empresa o para el SuperAdmin: filtros, verificación
// de la cadena de integridad y exportación a Excel (evidencias para auditores).
@Component({
  selector: 'app-auditoria',
  imports: [FormsModule, Icono, ...FORMATOS],
  template: `
    <div class="filtros">
      @if (global()) {
        <div class="campo"><label for="au-e">Ámbito</label>
          <select id="au-e" [(ngModel)]="f.empresa" (change)="cargar()"><option value="">Todo</option><option value="global">Acciones globales</option>
            @for (e of empresas(); track e._id) { <option [value]="e._id">{{ e.nombre }}</option> }</select></div>
      }
      <div class="campo"><label for="au-d">Desde</label><input id="au-d" type="date" [(ngModel)]="f.desde" (change)="cargar()" /></div>
      <div class="campo"><label for="au-h">Hasta</label><input id="au-h" type="date" [(ngModel)]="f.hasta" (change)="cargar()" /></div>
      <div class="campo"><label for="au-r">Resultado</label>
        <select id="au-r" [(ngModel)]="f.resultado" (change)="cargar()"><option value="">Todos</option><option value="exito">Éxito</option>
          <option value="fallo">Fallo</option><option value="denegado">Denegado</option></select></div>
      <div class="campo"><label for="au-a">Acción</label><input id="au-a" [(ngModel)]="f.accion" (keyup.enter)="cargar()" placeholder="p. ej. login_fallido" /></div>
      <div class="campo"><label for="au-u">Usuario</label><input id="au-u" [(ngModel)]="f.q" (keyup.enter)="cargar()" /></div>
      <button (click)="verificar()" [disabled]="verificando()"><app-icono nombre="escudo" />Verificar integridad</button>
      <button (click)="exportar()"><app-icono nombre="descargar" />Exportar Excel</button>
    </div>
    @for (v of verificacion(); track $index) {
      <div class="mensaje" [class.ok]="v.integra" [class.error]="!v.integra" style="margin-bottom:8px">
        {{ nombreCadena(v) }}: {{ v.integra ? 'cadena íntegra (' + v.total + ' registros)' : 'ALTERADA — ' + v.problema }}
      </div>
    }
    <div class="tabla-caja"><table>
      <thead><tr><th>Fecha</th>@if (global()) { <th>Empresa</th> }<th>Usuario</th><th>Acción</th><th>Resultado</th><th>Detalle</th><th>IP</th></tr></thead>
      <tbody>@for (a of lista(); track a._id) {
        <tr><td>{{ a.createdAt | fechaHora }}</td>@if (global()) { <td>{{ a.empresa?.nombre || 'Global' }}</td> }
          <td>{{ a.usuarioNombre }}</td><td>{{ a.accion }}</td>
          <td><span class="chip" [class.ok]="a.resultado === 'exito'" [class.error]="a.resultado === 'fallo'" [class.alerta]="a.resultado === 'denegado'">{{ a.resultado || 'exito' }}</span></td>
          <td class="sutil detalle">{{ detalle(a.detalle) }}</td><td class="sutil">{{ a.ip }}</td></tr>
      } @empty { <tr><td colspan="7" class="vacio">Sin registros</td></tr> }</tbody></table></div>`,
  styles: ['.detalle { max-width: 420px; word-break: break-word; }'],
})
export class VisorAuditoria {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly global = input(false);
  readonly lista = signal<any[]>([]);
  readonly empresas = signal<any[]>([]);
  readonly verificacion = signal<any[]>([]);
  readonly verificando = signal(false);
  f = { empresa: '', desde: '', hasta: '', resultado: '', accion: '', q: '' };

  private get base() { return this.global() ? '/admin/auditoria' : '/reportes/auditoria'; }

  ngOnInit() {
    this.cargar();
    if (this.global()) this.api.get<any[]>('/admin/empresas').then(e => this.empresas.set(e)).catch(() => {});
  }

  async cargar() {
    try { this.lista.set(await this.api.get<any[]>(this.base, this.f)); } catch (e) { this.avisos.error(e); }
  }

  async verificar() {
    this.verificando.set(true);
    try {
      const r = await this.api.get<any>(`${this.base}/verificar`, this.global() ? { empresa: this.f.empresa } : {});
      this.verificacion.set(Array.isArray(r) ? r : [{ ...r, empresa: 'propia' }]);
    } catch (e) { this.avisos.error(e); } finally { this.verificando.set(false); }
  }

  async exportar() {
    try { await this.api.descargar(`${this.base}.xlsx`, this.f, 'Auditoria.xlsx'); } catch (e) { this.avisos.error(e); }
  }

  nombreCadena(v: any) {
    if (v.empresa === 'propia') return 'Auditoría de la empresa';
    if (v.empresa === null) return 'Acciones globales';
    return this.empresas().find(e => e._id === v.empresa)?.nombre || 'Empresa';
  }
  detalle(d: any) { const s = JSON.stringify(d || {}); return s === '{}' ? '' : s.slice(0, 220); }
}
