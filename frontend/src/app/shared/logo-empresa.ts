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

  constructor() {
    this.api.get<{ logo: string }>('/gestion/empresa/logo').then(r => { this.guardado.set(r.logo || ''); this.actualizarPrevia(); })
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
      const blob = await this.api.archivoPost('/gestion/soportes/vista-previa', this.pendiente() ? { imagen: this.pendiente() } : {});
      if (this.urlPrevia) URL.revokeObjectURL(this.urlPrevia);
      this.urlPrevia = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      this.previa.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.urlPrevia + '#toolbar=0&view=FitH'));
    } catch (e) { this.avisos.error(e); } finally { this.cargandoPrevia.set(false); }
  }

  descartar() { this.pendiente.set(''); this.actualizarPrevia(); }

  async guardar() {
    this.trabajando.set(true);
    try {
      await this.api.put('/gestion/empresa/logo', { imagen: this.pendiente() });
      this.guardado.set(this.pendiente()); this.pendiente.set('');
      this.avisos.ok('Logo guardado: los soportes internos ya salen con él');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async quitar() {
    this.trabajando.set(true);
    try { await this.api.delete('/gestion/empresa/logo'); this.guardado.set(''); this.actualizarPrevia(); this.avisos.ok('Logo quitado'); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
