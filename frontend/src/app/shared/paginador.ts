import { Component, ElementRef, computed, inject, input, output } from '@angular/core';

export interface CambioPagina { pagina: number; porPagina: number }
const TAMANOS = [25, 50, 100];

// Paginación de listas que vienen por páginas desde el servidor: «Mostrando 51–100 de 1.209», tamaño de página,
// anterior / siguiente y números con saltos (1 … 4 5 6 … 25). Al cambiar de página sube al inicio de la lista.
@Component({
  selector: 'app-paginador',
  template: `
    @if (total() > 0) {
      <nav class="paginador" [attr.aria-label]="'Páginas de ' + unidad()">
        <span class="resumen" aria-live="polite">Mostrando <strong>{{ desde() }}–{{ hasta() }}</strong> de <strong>{{ totalTexto() }}</strong> {{ unidad() }}</span>
        @if (paginas() > 1 || total() > TAMANOS[0]) {
          <div class="controles">
            <label class="tamano">Ver
              <select [value]="porPagina()" (change)="cambiarTamano($any($event.target).value)" [disabled]="cargando()" aria-label="Registros por página">
                @for (t of TAMANOS; track t) { <option [value]="t" [selected]="t === porPagina()">{{ t }}</option> }
              </select></label>
            @if (paginas() > 1) {
              <button type="button" class="pag flecha" (click)="ir(actual() - 1)" [disabled]="actual() <= 1 || cargando()" aria-label="Página anterior">‹</button>
              @for (n of numeros(); track $index) {
                @if (n === 0) { <span class="salto" aria-hidden="true">…</span> }
                @else { <button type="button" class="pag" [class.actual]="n === actual()" [attr.aria-current]="n === actual() ? 'page' : null"
                  (click)="ir(n)" [disabled]="cargando()" [attr.aria-label]="'Página ' + n">{{ n }}</button> }
              }
              <button type="button" class="pag flecha" (click)="ir(actual() + 1)" [disabled]="actual() >= paginas() || cargando()" aria-label="Página siguiente">›</button>
            }
          </div>
        }
      </nav>
    }`,
  styles: [`
    .paginador { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 12px 14px; border-top: 1px solid var(--gris-2); font-size: 13px; color: var(--gris-6, #555); }
    .resumen strong { color: var(--gris-8, #111); font-variant-numeric: tabular-nums; }
    .controles { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .tamano { display: inline-flex; align-items: center; gap: 6px; margin-right: 8px; font-size: 13px; color: var(--gris-5); }
    .tamano select { min-height: 32px; padding: 2px 26px 2px 8px; font-size: 13px; width: auto; }
    .pag { min-width: 34px; min-height: 34px; padding: 0 8px; border-radius: 8px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; box-shadow: none; }
    .pag.actual { background: var(--tinta, #111); border-color: var(--tinta, #111); color: #fff; }
    .pag.flecha { font-size: 18px; line-height: 1; }
    .salto { min-width: 20px; text-align: center; color: var(--gris-5); }
    @media (max-width: 560px) { .paginador { justify-content: center; } .resumen { width: 100%; text-align: center; } }
  `],
})
export class Paginador {
  readonly total = input(0);
  readonly pagina = input(1);
  readonly porPagina = input(50);
  readonly cargando = input(false);
  readonly unidad = input('registros');
  readonly cambio = output<CambioPagina>();
  readonly TAMANOS = TAMANOS;
  private el = inject(ElementRef<HTMLElement>);
  private fmt = new Intl.NumberFormat('es-CO');

  readonly paginas = computed(() => Math.max(1, Math.ceil(this.total() / this.porPagina())));
  // Página que se muestra (si un filtro dejó menos registros, la última que existe)
  readonly actual = computed(() => Math.min(Math.max(1, this.pagina()), this.paginas()));
  readonly desde = computed(() => (this.total() ? (this.actual() - 1) * this.porPagina() + 1 : 0));
  readonly hasta = computed(() => Math.min(this.total(), this.actual() * this.porPagina()));
  readonly totalTexto = computed(() => this.fmt.format(this.total()));
  // 1 … p-1 p p+1 … n (0 = salto)
  readonly numeros = computed(() => {
    const n = this.paginas(); const p = this.actual();
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const l = new Set([1, n, p - 1, p, p + 1].filter((x) => x >= 1 && x <= n));
    if (p <= 3) [2, 3, 4].forEach((x) => l.add(x));
    if (p >= n - 2) [n - 3, n - 2, n - 1].forEach((x) => l.add(x));
    const orden = [...l].sort((a, b) => a - b); const out: number[] = [];
    orden.forEach((x, i) => { if (i && x - orden[i - 1] > 1) out.push(0); out.push(x); });
    return out;
  });

  ir(n: number) {
    if (n < 1 || n > this.paginas() || n === this.actual()) return;
    this.cambio.emit({ pagina: n, porPagina: this.porPagina() });
    this.subir();
  }
  cambiarTamano(v: string) {
    const t = Number(v) || 50;
    // Se mantiene a la vista el primer registro que se estaba viendo
    const primero = (this.actual() - 1) * this.porPagina();
    this.cambio.emit({ pagina: Math.floor(primero / t) + 1, porPagina: t });
  }
  private subir() {
    const caja = (this.el.nativeElement as HTMLElement).closest('.tabla-caja') || (this.el.nativeElement as HTMLElement).parentElement;
    const y = (caja?.getBoundingClientRect().top || 0) + window.scrollY - 90;
    if (y < window.scrollY) window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }
}

