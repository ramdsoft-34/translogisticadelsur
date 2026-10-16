import { Component, inject, input, output, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Icono } from './icono';

interface Resultado { total: number; nuevos: number; actualizados: number; sinCambios: number; clientesNuevos?: number;
  errores: { fila: number; errores: string[] }[]; simulado: boolean }

// Importación de maestros desde Excel: descargar plantilla → revisar (simulación) → aplicar.
@Component({
  selector: 'app-importar-excel',
  imports: [Modal, Icono],
  template: `
    <app-modal [titulo]="'Importar ' + titulo() + ' desde Excel'" [abierto]="abierto()" (cerrar)="cerrar.emit()" [ancho]="true">
      <ol class="pasos">
        <li>Descargue la plantilla, llénela desde la fila 2 (las columnas con * son obligatorias).
          <button class="pequeno" type="button" (click)="plantilla()"><app-icono nombre="descargar" [tam]="15" />Plantilla</button></li>
        <li>Seleccione el archivo y revise el resultado. <strong>Revisar no guarda nada.</strong>
          <input type="file" accept=".xlsx,.xlsm" (change)="elegir($event)" aria-label="Archivo de Excel" /></li>
        <li>Si todo está bien, aplique la importación. Los registros que ya existen solo se actualizan con las celdas que traen valor.</li>
      </ol>
      @if (resultado(); as r) {
        <div class="mensaje" [class.ok]="!r.errores.length" [class.alerta]="r.errores.length">
          {{ r.simulado ? 'Revisión' : 'Importación terminada' }}: {{ r.total }} fila(s) — {{ r.nuevos }} nueva(s), {{ r.actualizados }} actualizada(s),
          {{ r.sinCambios }} sin cambios{{ r.clientesNuevos ? ', ' + r.clientesNuevos + ' cliente(s) nuevo(s)' : '' }}, {{ r.errores.length }} con error.
        </div>
        @if (r.errores.length) {
          <div class="tabla-caja" style="margin-top:10px;max-height:260px;overflow:auto;box-shadow:none">
            <table><thead><tr><th>Fila</th><th>Problema</th></tr></thead>
              <tbody>@for (e of r.errores; track e.fila) { <tr><td>{{ e.fila }}</td><td>{{ e.errores.join('; ') }}</td></tr> }</tbody></table>
          </div>
          <p class="sutil">Las filas con error no se importan. Corríjalas en el archivo y vuelva a revisar.</p>
        }
      }
      <ng-container pie>
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        <button type="button" (click)="enviar(true)" [disabled]="!archivo() || trabajando()">Revisar</button>
        <button type="button" class="primario" (click)="enviar(false)" [disabled]="!puedeAplicar() || trabajando()">Aplicar importación</button>
      </ng-container>
    </app-modal>`,
  styles: ['.pasos { padding-left: 18px; display: flex; flex-direction: column; gap: 12px; margin: 0 0 14px; } .pasos li > button, .pasos li > input { margin-top: 6px; display: flex; }'],
})
export class ImportarExcel {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly tipo = input.required<'vehiculos' | 'terceros' | 'tarifas'>();
  readonly titulo = input('');
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly importado = output<void>();
  readonly archivo = signal<File | null>(null);
  readonly resultado = signal<Resultado | null>(null);
  readonly trabajando = signal(false);

  puedeAplicar() { const r = this.resultado(); return !!this.archivo() && !!r && r.simulado && (r.nuevos + r.actualizados) > 0; }

  elegir(ev: Event) {
    this.archivo.set((ev.target as HTMLInputElement).files?.[0] || null);
    this.resultado.set(null);
  }

  async plantilla() {
    try { await this.api.descargar(`/importaciones/plantillas/${this.tipo()}`, {}, `Plantilla_${this.tipo()}.xlsx`); } catch (e) { this.avisos.error(e); }
  }

  async enviar(simular: boolean) {
    const f = this.archivo();
    if (!f) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.subir<Resultado>(`/importaciones/maestros/${this.tipo()}`, f, { simular: simular ? 1 : 0 });
      this.resultado.set(r);
      if (!simular) { this.avisos.ok(`Importación aplicada: ${r.nuevos} nuevo(s), ${r.actualizados} actualizado(s)`); this.importado.emit(); }
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
