import { Component, ElementRef, afterNextRender, output, viewChild } from '@angular/core';

// Recuadro para firmar con el dedo o el mouse. Entrega la firma como PNG (data URL).
@Component({
  selector: 'app-firma-pad',
  template: `
    <div class="pad">
      <canvas #lienzo width="560" height="180" aria-label="Recuadro para firmar" role="img"
        (pointerdown)="empezar($event)" (pointermove)="mover($event)" (pointerup)="terminar()" (pointerleave)="terminar()" (pointercancel)="terminar()"></canvas>
      <div class="linea"><span>Firme dentro del recuadro</span><button type="button" class="texto pequeno" (click)="limpiar()">Borrar</button></div>
    </div>
  `,
  styles: [`
    .pad { display: flex; flex-direction: column; gap: 6px; }
    canvas { width: 100%; max-width: 560px; aspect-ratio: 560 / 180; background: #fff; border: 1px dashed var(--gris-3); border-radius: var(--radio); touch-action: none; cursor: crosshair; }
    .linea { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--gris-5); max-width: 560px; }
  `],
})
export class FirmaPad {
  readonly cambio = output<string>();
  private lienzo = viewChild.required<ElementRef<HTMLCanvasElement>>('lienzo');
  private ctx: CanvasRenderingContext2D | null = null;
  private dibujando = false;
  private trazos = 0;

  constructor() {
    afterNextRender(() => {
      this.ctx = this.lienzo().nativeElement.getContext('2d');
      if (this.ctx) { this.ctx.lineWidth = 2.4; this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round'; this.ctx.strokeStyle = '#111'; }
    });
  }

  private punto(e: PointerEvent) {
    const c = this.lienzo().nativeElement; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  }
  empezar(e: PointerEvent) {
    if (!this.ctx) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.dibujando = true; const p = this.punto(e);
    this.ctx.beginPath(); this.ctx.moveTo(p.x, p.y);
  }
  mover(e: PointerEvent) {
    if (!this.dibujando || !this.ctx) return;
    const p = this.punto(e); this.ctx.lineTo(p.x, p.y); this.ctx.stroke(); this.trazos += 1;
  }
  terminar() {
    if (!this.dibujando) return;
    this.dibujando = false;
    // Un toque suelto no es una firma
    this.cambio.emit(this.trazos > 8 ? this.lienzo().nativeElement.toDataURL('image/png') : '');
  }
  limpiar() {
    const c = this.lienzo().nativeElement;
    this.ctx?.clearRect(0, 0, c.width, c.height); this.trazos = 0; this.cambio.emit('');
  }
}
