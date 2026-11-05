import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';

// Firma con el dedo o el mouse. Entrega un PNG pequeño (data URL) o '' si se borra.
// Uso: <app-firma [valor]="x" (cambio)="x = $event" etiqueta="Firma del conductor" />
@Component({
  selector: 'app-firma',
  template: `
    <div class="firma" [class.firmado]="!!valor()">
      <canvas #lienzo width="560" height="180" [attr.aria-label]="etiqueta() || 'Firma'" role="img"
        (pointerdown)="iniciar($event)" (pointermove)="mover($event)" (pointerup)="terminar()" (pointerleave)="terminar()" (pointercancel)="terminar()"></canvas>
      @if (!valor() && !trazando()) { <span class="guia">Firme aquí</span> }
      <div class="linea"></div>
      <div class="pie"><small>{{ etiqueta() }}</small>
        @if (valor()) { <button type="button" class="pequeno texto" (click)="borrar()">Borrar firma</button> }</div>
    </div>`,
  styles: [`
    .firma { position: relative; border: 1px dashed var(--gris-3); border-radius: var(--radio); background: var(--gris-0); padding: 6px 8px 4px; }
    .firma.firmado { border-style: solid; border-color: var(--verde-borde); }
    canvas { display: block; width: 100%; height: auto; aspect-ratio: 560 / 180; touch-action: none; cursor: crosshair; }
    .guia { position: absolute; inset: 0 0 34px; display: grid; place-items: center; color: var(--gris-4); font-size: 14px; pointer-events: none; }
    .linea { height: 1px; background: var(--gris-4); margin: -26px 18px 22px; pointer-events: none; }
    .pie { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: 28px; }
    .pie small { color: var(--gris-5); }
  `],
})
export class Firma {
  readonly valor = input<string>('');
  readonly etiqueta = input<string>('');
  readonly cambio = output<string>();
  readonly trazando = signal(false);
  private lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');
  private ultimo: { x: number; y: number } | null = null;
  private pinto = false;

  constructor() {
    // Si llega una firma guardada, se dibuja
    effect(() => {
      const v = this.valor(); const c = this.lienzo().nativeElement; const g = c.getContext('2d')!;
      if (this.pinto) return;
      g.clearRect(0, 0, c.width, c.height);
      if (v) { const img = new Image(); img.onload = () => g.drawImage(img, 0, 0, c.width, c.height); img.src = v; }
    });
  }

  private punto(e: PointerEvent) {
    const c = this.lienzo().nativeElement; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  iniciar(e: PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.trazando.set(true); this.pinto = true; this.ultimo = this.punto(e);
  }
  mover(e: PointerEvent) {
    if (!this.trazando() || !this.ultimo) return;
    const g = this.lienzo().nativeElement.getContext('2d')!; const p = this.punto(e);
    g.strokeStyle = '#1d3a8a'; g.lineWidth = 3.2; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(this.ultimo.x, this.ultimo.y); g.lineTo(p.x, p.y); g.stroke();
    this.ultimo = p;
  }
  terminar() {
    if (!this.trazando()) return;
    this.trazando.set(false); this.ultimo = null;
    this.cambio.emit(this.lienzo().nativeElement.toDataURL('image/png'));
    setTimeout(() => (this.pinto = false));
  }
  borrar() {
    const c = this.lienzo().nativeElement; c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    this.cambio.emit('');
  }
}
