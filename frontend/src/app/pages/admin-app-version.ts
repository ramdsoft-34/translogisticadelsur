import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from '../shared/icono';
import { FORMATOS } from '../shared/formato';

interface Version { minimo: number; ultimaCodigo: number; ultimaNombre: string; tipo: 'recomendada' | 'obligatoria'; novedades: string[]; funciones: string; por?: string; actualizado?: string }

// Versión de la app Sur Track para toda la plataforma (solo el superadministrador).
@Component({
  selector: 'app-admin-app-version',
  imports: [FormsModule, Icono, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Versión de la app</h1>
        <p class="sutil">Avisos de actualización de Sur Track para todos los conductores de la plataforma.</p></div>
    </div>

    @if (cargando()) { <p class="sutil">Cargando…</p> }
    @else {
      <form class="formulario hoja" (ngSubmit)="guardar()">
        <div class="mensaje info ancho">
          <strong>Cómo funciona.</strong> Si la versión instalada es menor que la <em>última</em>, la app avisa: «recomendada» se puede posponer;
          «obligatoria» bloquea la app al terminar el viaje en curso. Por debajo de la <em>mínima</em>, el servidor ya no atiende la app (nunca en medio de un viaje).
          Suba la mínima solo cuando la actualización esté al 100 % en Play Store.
        </div>
        <div class="campo"><label for="ver-codigo">Última versión: número (versionCode)</label>
          <input id="ver-codigo" name="ultimaCodigo" type="number" min="0" inputmode="numeric" [(ngModel)]="f.ultimaCodigo" required /></div>
        <div class="campo"><label for="ver-nombre">Última versión: nombre</label>
          <input id="ver-nombre" name="ultimaNombre" [(ngModel)]="f.ultimaNombre" maxlength="30" placeholder="Ej.: 3.0.1" /></div>
        <div class="campo"><label for="ver-tipo">Tipo de actualización</label>
          <select id="ver-tipo" name="tipo" [(ngModel)]="f.tipo"><option value="recomendada">Recomendada (se puede posponer)</option><option value="obligatoria">Obligatoria (bloquea al terminar el viaje)</option></select></div>
        <div class="campo"><label for="ver-min">Versión mínima que se admite (versionCode)</label>
          <input id="ver-min" name="minimo" type="number" min="0" inputmode="numeric" [(ngModel)]="f.minimo" required />
          <small>0 = no se rechaza ninguna. No puede ser mayor que la última.</small></div>
        <div class="campo ancho"><label for="ver-nov">Novedades (una por línea, máximo 10)</label>
          <textarea id="ver-nov" name="novedades" rows="4" [(ngModel)]="novedades" placeholder="Planilla de seguridad social en PDF&#10;Avisos de la oficina"></textarea></div>
        <div class="campo ancho"><label for="ver-fun">Funciones afectadas (opcional)</label>
          <input id="ver-fun" name="funciones" [(ngModel)]="f.funciones" maxlength="300" placeholder="Ej.: el preoperacional no funciona en versiones anteriores" /></div>
        @if (error()) { <div class="mensaje error ancho" role="alert">{{ error() }}</div> }
        <div class="acciones ancho">
          <button type="submit" class="primario" [disabled]="trabajando()"><app-icono nombre="check" [tam]="16" />{{ trabajando() ? 'Guardando…' : 'Guardar' }}</button>
          @if (f.por) { <span class="sutil">Último cambio: {{ f.por }} · {{ f.actualizado | fechaHora }}</span> }
        </div>
      </form>
    }
  `,
  styles: [`.hoja { max-width: 860px; }`],
})
export class AdminAppVersion {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly cargando = signal(true);
  readonly trabajando = signal(false);
  readonly error = signal('');
  f: Version = { minimo: 0, ultimaCodigo: 0, ultimaNombre: '', tipo: 'recomendada', novedades: [], funciones: '' };
  novedades = '';

  constructor() { this.cargar(); }

  async cargar() {
    try {
      const v = await this.api.get<Version | null>('/admin/app-version');
      if (v) { this.f = { ...v }; this.novedades = v.novedades.join('\n'); }
    } catch (e) { this.avisos.error(e); }
    finally { this.cargando.set(false); }
  }

  async guardar() {
    this.error.set('');
    const minimo = Number(this.f.minimo) || 0; const ultima = Number(this.f.ultimaCodigo) || 0;
    if (minimo > ultima) { this.error.set('La versión mínima no puede ser mayor que la última.'); return; }
    if (ultima && !this.f.ultimaNombre.trim()) { this.error.set('Escriba el nombre de la última versión (por ejemplo 3.0.1).'); return; }
    this.trabajando.set(true);
    try {
      const v = await this.api.put<Version>('/admin/app-version', {
        minimo, ultimaCodigo: ultima, ultimaNombre: this.f.ultimaNombre.trim(), tipo: this.f.tipo, funciones: this.f.funciones.trim(),
        novedades: this.novedades.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 10),
      });
      this.f = { ...v }; this.novedades = v.novedades.join('\n');
      this.avisos.ok('Versión guardada. La app la toma en minutos.');
    } catch (e) { this.avisos.error(e); }
    finally { this.trabajando.set(false); }
  }
}
