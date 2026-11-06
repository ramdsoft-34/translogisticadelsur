import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from './icono';
import { Confirmar } from './confirmar';

// Logo de la empresa: el que va en el encabezado de la remesa de los clientes (y otros documentos de la empresa).
// El logo del soporte interno (MC/RC) es aparte, en la pestaña «Soporte interno».
@Component({
  selector: 'app-logo-principal',
  imports: [Icono, Confirmar],
  template: `
    <section class="tarjeta logo-principal">
      <h2>Logo de la empresa</h2>
      <p class="sutil">Va en el encabezado de las remesas de los clientes. Use una imagen PNG o JPG con fondo blanco o transparente (máximo 650 KB).
        El logo del soporte interno se cambia aparte, en la pestaña «Soporte interno».</p>
      <div class="muestra" [class.vacia]="!visible()">
        @if (visible(); as l) { <img [src]="l" alt="Logo de la empresa" /> } @else { <span>Sin logo</span> }
      </div>
      @if (nuevo()) { <div class="mensaje alerta">Logo nuevo sin guardar. Presione «Guardar logo».</div> }
      <div class="acciones">
        <label class="boton"><app-icono nombre="subir" [tam]="16" />{{ visible() ? 'Cambiar imagen' : 'Subir imagen' }}
          <input type="file" accept="image/png,image/jpeg" (change)="elegir($event)" hidden /></label>
        @if (nuevo()) {
          <button type="button" (click)="nuevo.set('')">Descartar</button>
          <button type="button" class="primario" (click)="guardar()" [disabled]="trabajando()"><app-icono nombre="check" [tam]="16" />Guardar logo</button>
        } @else if (guardado()) {
          <button type="button" class="peligro" confirmar="Clic otra vez para quitarlo" (confirmado)="quitar()" [disabled]="trabajando()">Quitar logo</button>
        }
      </div>
    </section>`,
  styles: [`
    .logo-principal { max-width: 560px; }
    .logo-principal h2 { margin: 0 0 6px; }
    .muestra { margin: 14px 0; height: 160px; border: 1px dashed var(--gris-3, #d0d5dd); border-radius: var(--radio-l, 12px); display: grid; place-items: center; background: #fff; padding: 12px; }
    .muestra img { max-width: 100%; max-height: 136px; object-fit: contain; }
    .muestra.vacia { color: var(--gris-5); font-size: 13px; }
    .acciones { display: flex; flex-wrap: wrap; gap: 8px; }
    label.boton { cursor: pointer; }
    .mensaje { margin-bottom: 12px; }
  `],
})
export class LogoPrincipal {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly guardado = signal('');
  readonly nuevo = signal('');
  readonly trabajando = signal(false);
  visible() { return this.nuevo() || this.guardado(); }

  constructor() {
    this.api.get<{ logo: string }>('/gestion/empresa/logo-principal').then(r => this.guardado.set(r.logo || '')).catch(e => this.avisos.error(e));
  }

  elegir(ev: Event) {
    const input = ev.target as HTMLInputElement; const a = input.files?.[0]; input.value = '';
    if (!a) return;
    if (!/^image\/(png|jpe?g)$/.test(a.type)) { this.avisos.mostrar('El logo debe ser PNG o JPG', 'error'); return; }
    if (a.size > 650_000) { this.avisos.mostrar('El logo es muy pesado (máximo 650 KB). Redúzcalo antes de subirlo.', 'error'); return; }
    const r = new FileReader(); r.onload = () => this.nuevo.set(String(r.result)); r.readAsDataURL(a);
  }

  async guardar() {
    this.trabajando.set(true);
    try { await this.api.put('/gestion/empresa/logo-principal', { imagen: this.nuevo() }); this.guardado.set(this.nuevo()); this.nuevo.set(''); this.avisos.ok('Logo de la empresa guardado'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async quitar() {
    this.trabajando.set(true);
    try { await this.api.delete('/gestion/empresa/logo-principal'); this.guardado.set(''); this.avisos.ok('Logo quitado'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
