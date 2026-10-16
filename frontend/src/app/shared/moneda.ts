import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const formatoCop = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '' : `$ ${fmt.format(n)}`);

// Campo de dinero en pesos colombianos. Mientras se escribe muestra "$ 1.500.000"
// y el modelo recibe el número (1500000). Úselo dentro de <div class="moneda">
// para ver el sufijo COP:  <div class="moneda"><input moneda [(ngModel)]="x" /></div>
@Directive({
  selector: 'input[moneda]',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => Moneda), multi: true }],
  host: { inputmode: 'numeric', autocomplete: 'off' },
})
export class Moneda implements ControlValueAccessor {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private cambio: (v: number | null) => void = () => {};
  private tocado: () => void = () => {};

  writeValue(v: number | null): void { this.el.value = formatoCop(v === null || v === undefined || (v as any) === '' ? null : Number(v)); }
  registerOnChange(fn: (v: number | null) => void): void { this.cambio = fn; }
  registerOnTouched(fn: () => void): void { this.tocado = fn; }
  setDisabledState(d: boolean): void { this.el.disabled = d; }

  @HostListener('input')
  alEscribir() {
    const el = this.el;
    // Cuántos dígitos había antes del cursor, para devolver el cursor a su sitio tras formatear
    const digitosAntes = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, '').length;
    const digitos = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);
    const valor = digitos ? Number(digitos) : null;
    el.value = formatoCop(valor);
    let pos = el.value.length;
    if (digitosAntes >= 0) {
      let vistos = 0;
      for (let i = 0; i < el.value.length; i++) {
        if (/\d/.test(el.value[i])) vistos++;
        if (vistos === digitosAntes) { pos = i + 1; break; }
      }
      if (digitosAntes === 0) pos = el.value.indexOf(' ') + 1 || 0;
    }
    el.setSelectionRange(pos, pos);
    this.cambio(valor);
  }

  @HostListener('blur') alSalir() { this.tocado(); }
}
