import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Icono } from './icono';
import { Confirmar } from './confirmar';

const MAX_LADO = 700;          // el logo se reduce a este tamaño para que el PDF quede liviano
const MAX_CARACTERES = 380_000; // límite seguro para guardarlo (data URL)

// Reduce la imagen hasta que quepa: primero PNG (conserva transparencia); si pesa mucho, JPG sobre fondo blanco
function comprimir(img: HTMLImageElement, esPng: boolean): string {
  let lado = MAX_LADO; let datos = '';
  for (let intento = 0; intento < 8; intento += 1) {
    const f = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * f)); c.height = Math.max(1, Math.round(img.height * f));
    const g = c.getContext('2d')!;
    if (esPng && intento === 0) { g.drawImage(img, 0, 0, c.width, c.height); datos = c.toDataURL('image/png'); }
    else { g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); datos = c.toDataURL('image/jpeg', 0.85); }
    if (datos.length <= MAX_CARACTERES) return datos;
    if (intento > 0) lado = Math.round(lado * 0.8);
  }
  return datos;
}

// Logo de la empresa para el soporte interno: subir, ver cómo queda el documento y guardar.
@Component({
  selector: 'app-logo-empresa',
  imports: [Icono, Confirmar],
  template: `
    <div class="logo-cfg">
      <section class="tarjeta lado">
        <h2>Logo de la empresa</h2>
        <p class="sutil">Va en el soporte interno (MC/RC) en lugar de los logos del Ministerio. Use una imagen PNG o JPG con fondo blanco o transparente.</p>
        <div class="muestra" [class.vacia]="!logoVisible()">
          @if (logoVisible(); as l) { <img [src]="l" alt="Logo de la empresa" /> } @else { <span>Sin logo: el soporte muestra el nombre de la empresa</span> }
        </div>
        @if (pendiente()) { <div class="mensaje alerta">Logo nuevo sin guardar. Revise la vista previa y presione «Guardar logo».</div> }
        <div class="acciones">
          <label class="boton"><app-icono nombre="descargar" [tam]="16" />{{ logoVisible() ? 'Cambiar imagen' : 'Subir imagen' }}
            <input type="file" accept="image/png,image/jpeg" (change)="elegir($event)" hidden /></label>
          @if (pendiente()) {
            <button type="button" (click)="descartar()">Descartar</button>
            <button type="button" class="primario" (click)="guardar()" [disabled]="trabajando()"><app-icono nombre="check" [tam]="16" />Guardar logo</button>
          } @else if (guardado()) {
            <button type="button" class="peligro" confirmar="Clic otra vez para quitarlo" (confirmado)="quitar()" [disabled]="trabajando()">Quitar logo</button>
          }
        </div>
        @if (logoVisible()) {
          <!-- Mover y escalar el logo dentro del encabezado (queda debajo de los textos) -->
          <div class="ajuste">
            <h3>Posición y tamaño</h3>
            <div class="control"><label for="lg-x">Horizontal</label>
              <button type="button" class="pequeno" (click)="mover('dx', -5)" aria-label="Mover a la izquierda">←</button>
              <input id="lg-x" type="range" [min]="LIM.dx[0]" [max]="LIM.dx[1]" step="1" [value]="ajuste().dx" (input)="cambiar('dx', $any($event.target).value)" />
              <button type="button" class="pequeno" (click)="mover('dx', 5)" aria-label="Mover a la derecha">→</button></div>
            <div class="control"><label for="lg-y">Vertical</label>
              <button type="button" class="pequeno" (click)="mover('dy', -5)" aria-label="Subir">↑</button>
              <input id="lg-y" type="range" [min]="LIM.dy[0]" [max]="LIM.dy[1]" step="1" [value]="ajuste().dy" (input)="cambiar('dy', $any($event.target).value)" />
              <button type="button" class="pequeno" (click)="mover('dy', 5)" aria-label="Bajar">↓</button></div>
            <div class="control"><label for="lg-t">Tamaño</label>
              <button type="button" class="pequeno" (click)="mover('escala', -0.1)" aria-label="Más pequeño">−</button>
              <input id="lg-t" type="range" [min]="LIM.escala[0]" [max]="LIM.escala[1]" step="0.05" [value]="ajuste().escala" (input)="cambiar('escala', $any($event.target).value)" />
              <button type="button" class="pequeno" (click)="mover('escala', 0.1)" aria-label="Más grande">+</button>
              <span class="pct">{{ pct() }} %</span></div>
            <small class="sutil">El logo queda debajo de líneas y textos y no sale del encabezado.</small>
            <div class="acciones">
              <button type="button" class="pequeno" (click)="restablecer()">Restablecer</button>
              @if (ajusteCambiado() && !pendiente()) { <button type="button" class="pequeno primario" (click)="guardarAjuste()" [disabled]="trabajando()">Guardar posición</button> }
            </div>
          </div>
        }
      </section>
      <section class="tarjeta previa">
        <div class="cab"><h2>Vista previa del soporte interno</h2>
          <button type="button" class="pequeno" (click)="actualizarPrevia()" [disabled]="cargandoPrevia()"><app-icono nombre="reloj" [tam]="15" />Actualizar</button></div>
        @if (previa(); as p) { <iframe [src]="p" title="Vista previa del soporte interno"></iframe> }
        @else { <span class="esqueleto alto"></span> }
        <small class="sutil">Datos de ejemplo. Así se verá cada soporte interno que se genere.</small>
      </section>
    </div>`,
  styles: [`
    .logo-cfg { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; gap: 16px; align-items: start; }
    .tarjeta + .tarjeta { margin-top: 0; }
    .muestra { display: grid; place-items: center; height: 170px; margin: 14px 0; border: 1px dashed var(--gris-3); border-radius: var(--radio-l); background: #fff; padding: 12px; }
    .muestra img { max-width: 100%; max-height: 140px; object-fit: contain; }
    .muestra.vacia span { color: var(--gris-5); font-size: 13px; text-align: center; padding: 0 10px; }
    .mensaje { margin-bottom: 12px; }
    label.boton { cursor: pointer; }
    .ajuste { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--gris-15); display: flex; flex-direction: column; gap: 10px; }
    .ajuste h3 { margin: 0; }
    .control { display: grid; grid-template-columns: 74px 32px 1fr 32px auto; gap: 6px; align-items: center; }
    .control label { font-size: 13px; font-weight: 600; color: var(--gris-6); }
    .control input[type=range] { min-height: 0; padding: 0; border: 0; accent-color: var(--primario-borde); box-shadow: none; }
    .control .pequeno { min-height: 30px; padding: 0; }
    .pct { font-size: 12px; color: var(--gris-5); min-width: 38px; text-align: right; }
    .cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; } .cab h2 { margin: 0; }
    iframe { width: 100%; height: 62vh; min-height: 420px; border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); }
    .esqueleto.alto { height: 420px; }
    @media (max-width: 900px) { .logo-cfg { grid-template-columns: 1fr; } }
  `],
})
export class LogoEmpresa {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private sanitizer = inject(DomSanitizer);
  readonly guardado = signal('');           // logo guardado (data URL)
  readonly pendiente = signal('');          // logo elegido sin guardar
  readonly previa = signal<SafeResourceUrl | null>(null);
  readonly cargandoPrevia = signal(false);
  readonly trabajando = signal(false);
  private urlPrevia = '';
  // Límites iguales a los del servidor
  readonly LIM = { dx: [-15, 150], dy: [-15, 45], escala: [0.5, 1.8] } as const;
  readonly ajuste = signal({ dx: 0, dy: 0, escala: 1 });
  private ajusteGuardado = { dx: 0, dy: 0, escala: 1 };
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  ajusteCambiado() { const a = this.ajuste(); const g = this.ajusteGuardado; return a.dx !== g.dx || a.dy !== g.dy || a.escala !== g.escala; }
  pct() { return Math.round(this.ajuste().escala * 100); }
  cambiar(k: 'dx' | 'dy' | 'escala', v: string | number) {
    const [a, b] = this.LIM[k];
    const n = Math.min(b, Math.max(a, Math.round(Number(v) * 100) / 100));
    this.ajuste.update(x => ({ ...x, [k]: n }));
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => this.actualizarPrevia(), 350);
  }
  mover(k: 'dx' | 'dy' | 'escala', paso: number) { this.cambiar(k, this.ajuste()[k] + paso); }
  restablecer() { this.ajuste.set({ dx: 0, dy: 0, escala: 1 }); this.actualizarPrevia(); }
  async guardarAjuste() {
    this.trabajando.set(true);
    try { await this.api.put('/gestion/empresa/logo', { ajuste: this.ajuste() }); this.ajusteGuardado = { ...this.ajuste() }; this.avisos.ok('Posición del logo guardada'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  constructor() {
    this.api.get<{ logo: string; ajuste: { dx: number; dy: number; escala: number } }>('/gestion/empresa/logo').then(r => {
      this.guardado.set(r.logo || '');
      if (r.ajuste) { this.ajuste.set({ ...r.ajuste }); this.ajusteGuardado = { ...r.ajuste }; }
      this.actualizarPrevia();
    })
      .catch(e => this.avisos.error(e));
    inject(DestroyRef).onDestroy(() => { if (this.urlPrevia) URL.revokeObjectURL(this.urlPrevia); });
  }

  logoVisible() { return this.pendiente() || this.guardado(); }

  // Reduce la imagen (máx. 800 px) y la deja lista para la vista previa
  async elegir(e: Event) {
    const archivo = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!archivo) return;
    if (!/^image\/(png|jpeg)$/.test(archivo.type)) { this.avisos.mostrar('El logo debe ser PNG o JPG', 'error'); return; }
    try {
      const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(archivo); });
      this.pendiente.set(comprimir(img, archivo.type === 'image/png'));
      URL.revokeObjectURL(img.src);
      this.actualizarPrevia();
    } catch { this.avisos.mostrar('No se pudo leer la imagen', 'error'); }
  }

  async actualizarPrevia() {
    this.cargandoPrevia.set(true);
    try {
      const blob = await this.api.archivoPost('/gestion/soportes/vista-previa', { ...(this.pendiente() ? { imagen: this.pendiente() } : {}), ajuste: this.ajuste() });
      if (this.urlPrevia) URL.revokeObjectURL(this.urlPrevia);
      this.urlPrevia = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      this.previa.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.urlPrevia + '#toolbar=0&navpanes=0&view=Fit'));
    } catch (e) { this.avisos.error(e); } finally { this.cargandoPrevia.set(false); }
  }

  descartar() { this.pendiente.set(''); this.actualizarPrevia(); }

  async guardar() {
    this.trabajando.set(true);
    try {
      await this.api.put('/gestion/empresa/logo', { imagen: this.pendiente(), ajuste: this.ajuste() });
      this.guardado.set(this.pendiente()); this.pendiente.set(''); this.ajusteGuardado = { ...this.ajuste() };
      this.avisos.ok('Logo guardado: los soportes internos ya salen con él');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async quitar() {
    this.trabajando.set(true);
    try { await this.api.delete('/gestion/empresa/logo'); this.guardado.set(''); this.actualizarPrevia(); this.avisos.ok('Logo quitado'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
