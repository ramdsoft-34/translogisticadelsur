import { Component, ElementRef, effect, inject, input, output, OnDestroy } from '@angular/core';

// Pie de lista con carga progresiva: pide la siguiente página al acercarse al
// final (scroll infinito) y deja un botón como alternativa accesible.
@Component({
  selector: 'app-cargar-mas',
  template: `
    <div class="pie-lista">
      <span>{{ mostrados() }} de {{ total() }} {{ unidad() }}</span>
      @if (mostrados() < total()) {
        <button class="pequeno" type="button" (click)="mas.emit()" [disabled]="cargando()">{{ cargando() ? 'Cargando…' : 'Cargar más' }}</button>
      }
    </div>`,
})
export class CargarMas implements OnDestroy {
  readonly mostrados = input(0);
  readonly total = input(0);
  readonly cargando = input(false);
  readonly unidad = input('registros');
  readonly mas = output<void>();
  private el = inject(ElementRef<HTMLElement>);
  private observador = new IntersectionObserver(e => {
    if (e[0]?.isIntersecting && !this.cargando() && this.mostrados() < this.total()) this.mas.emit();
  }, { rootMargin: '300px' });

  constructor() {
    effect(() => { this.mostrados(); queueMicrotask(() => { this.observador.disconnect(); this.observador.observe(this.el.nativeElement); }); });
  }
  ngOnDestroy() { this.observador.disconnect(); }
}
