import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { TIPOS_ID } from '../core/modelos';
import { Modal } from './modal';

// Trae terceros o vehículos desde el RNDC (consulta oficial del web service)
// y los crea o actualiza en la empresa.
@Component({
  selector: 'app-traer-rndc',
  imports: [FormsModule, Modal],
  template: `
    <app-modal [titulo]="tipo() === 'vehiculos' ? 'Traer vehículos desde el RNDC' : 'Traer terceros desde el RNDC'" [abierto]="abierto()" (cerrar)="cerrar.emit()">
      <p class="sutil">Consulta lo que el RNDC tiene registrado para su empresa y lo guarda aquí (máximo 30 por vez).
        Requiere la contraseña del usuario web service.</p>
      @if (tipo() === 'terceros') {
        <div class="formulario">
          <div class="campo"><label for="tr-tipo">Tipo de documento</label>
            <select id="tr-tipo" [(ngModel)]="tipoId">@for (t of tipos; track t[0]) { <option [value]="t[0]">{{ t[1] }}</option> }</select></div>
          <div class="campo"><label for="tr-rol">Rol en la empresa</label>
            <select id="tr-rol" [(ngModel)]="rol"><option value="">(según los datos)</option><option value="conductor">Conductor</option>
              <option value="titular">Titular</option><option value="propietario">Propietario</option><option value="tenedor">Tenedor</option>
              <option value="destinatario">Destinatario</option><option value="remitente">Remitente</option></select></div>
        </div>
      }
      <div class="campo" style="margin-top:12px">
        <label for="tr-lista">{{ tipo() === 'vehiculos' ? 'Placas' : 'Números de documento' }} (uno por línea o separados por coma)</label>
        <textarea id="tr-lista" rows="5" [(ngModel)]="lista"></textarea>
      </div>
      @if (resultados().length) {
        <div class="tabla-caja" style="margin-top:12px;box-shadow:none"><table>
          <tbody>@for (r of resultados(); track $index) {
            <tr><td>{{ r.placa || r.numId }}</td>
              <td>@if (r.ok) { <span class="chip ok">{{ r.nuevo || r.guardados?.[0]?.nuevo ? 'Creado' : 'Actualizado' }}</span> {{ r.guardados?.[0]?.nombre }} }
                @else { <span class="chip error">No traído</span> <span class="sutil">{{ r.mensaje }}</span> }</td></tr>
          }</tbody></table></div>
      }
      <ng-container pie>
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        <button type="button" class="primario" (click)="traer()" [disabled]="trabajando() || !lista.trim()">{{ trabajando() ? 'Consultando…' : 'Traer del RNDC' }}</button>
      </ng-container>
    </app-modal>`,
})
export class TraerRndc {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly tipo = input.required<'vehiculos' | 'terceros'>();
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly traidos = output<void>();
  readonly tipos = Object.entries(TIPOS_ID);
  readonly resultados = signal<any[]>([]);
  readonly trabajando = signal(false);
  tipoId = 'C'; rol = ''; lista = '';

  async traer() {
    const valores = [...new Set(this.lista.split(/[\s,;]+/).map(x => x.trim().toUpperCase().replace(/[.-]/g, '')).filter(Boolean))].slice(0, 30);
    if (!valores.length) return;
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      const r = this.tipo() === 'vehiculos'
        ? await this.api.post<any[]>('/rndc/importar/vehiculos', { clave: c, placas: valores })
        : await this.api.post<any[]>('/rndc/importar/terceros', { clave: c, roles: this.rol ? [this.rol] : [], documentos: valores.map(numId => ({ tipoId: this.tipoId, numId })) });
      this.resultados.set(r);
      if (r.some(x => !x.ok && /usuario|contrase|clave/i.test(x.mensaje || ''))) this.clave.olvidar();
      const ok = r.filter(x => x.ok).length;
      this.avisos.mostrar(`${ok} de ${r.length} traído(s) del RNDC`, ok ? 'ok' : 'error');
      if (ok) this.traidos.emit();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
