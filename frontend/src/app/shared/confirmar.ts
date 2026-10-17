import { Directive, ElementRef, HostListener, OnDestroy, inject, input, output } from '@angular/core';

// Confirmación en el mismo botón, sin ventanas emergentes: el primer clic cambia el
// botón a «¿Seguro? Clic otra vez» durante unos segundos y solo el segundo ejecuta.
// Uso: <button confirmar="Clic otra vez para eliminar" (confirmado)="eliminar()">Eliminar</button>
@Directive({ selector: '[confirmar]' })
export class Confirmar implements OnDestroy {
  readonly confirmar = input('¿Seguro? Clic otra vez');
  readonly confirmado = output<void>();
  private el = inject(ElementRef<HTMLElement>);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private armado = false;

  @HostListener('click', ['$event'])
  clic(e: Event) {
    e.preventDefault();
    if (!this.armado) {
      this.armado = true;
      const b = this.el.nativeElement;
      b.setAttribute('data-confirmar', this.confirmar() || '¿Seguro? Clic otra vez');
      b.classList.add('confirmando');
      b.setAttribute('aria-label', this.confirmar());
      this.temporizador = setTimeout(() => this.desarmar(), 4000);
      return;
    }
    this.desarmar();
    this.confirmado.emit();
  }

  // Salir del botón (teclado) cancela la confirmación
  @HostListener('blur') alSalir() { setTimeout(() => this.desarmar(), 150); }

  private desarmar() {
    clearTimeout(this.temporizador);
    this.armado = false;
    const b = this.el.nativeElement;
    b.classList.remove('confirmando');
    b.removeAttribute('data-confirmar');
    b.removeAttribute('aria-label');
  }

  ngOnDestroy() { clearTimeout(this.temporizador); }
}
