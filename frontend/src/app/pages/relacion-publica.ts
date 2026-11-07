import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { environment } from '../../environments/environment';

// Fase 11: página pública (sin sesión) del enlace de una relación de cobro que recibe la empresa por WhatsApp o correo.
@Component({
  selector: 'app-relacion-publica',
  imports: [DatePipe, DecimalPipe],
  template: `
    <main class="verificar">
      <div class="tarjeta">
        <p class="marca">Relación de cobro</p>
        @if (cargando()) { <p class="sutil">Consultando…</p> }
        @else if (d(); as s) {
          <p class="empresa">{{ s.empresa }}<br /><span class="sutil">NIT {{ s.nit }}</span></p>
          <h1>{{ s.titulo }}</h1>
          <dl>
            <dt>Relación</dt><dd><strong>{{ s.numero }}</strong></dd>
            <dt>Empresa</dt><dd>{{ s.cliente }}</dd>
            <dt>Periodo</dt><dd>{{ s.periodo }}{{ s.grupo ? ' · ' + s.grupo : '' }}</dd>
            <dt>Viajes</dt><dd>{{ s.totales.viajes }} · {{ s.totales.vehiculos }} vehículos</dd>
            <dt>Total</dt><dd><strong>$ {{ s.totales.total | number: '1.0-0' : 'es-CO' }}</strong></dd>
            <dt>Generada</dt><dd>{{ s.generada | date: 'dd/MM/yyyy' }}</dd>
          </dl>
          <a class="bt p" [href]="base + '/archivo?formato=pdf'" target="_blank" rel="noopener">Ver la relación (PDF)</a>
          <a class="bt s" [href]="base + '/archivo?formato=xlsx'">Descargar en Excel</a>
          <a class="bt s" [href]="base + '/archivo?formato=pdf&descargar=1'">Descargar el PDF</a>
        } @else {
          <div class="sello"><span class="icono">×</span><div><strong>Enlace no encontrado</strong><small>{{ error() }}</small></div></div>
        }
      </div>
    </main>`,
  styles: [`
    .verificar { min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; background: var(--fondo, #f6f6f4); }
    .tarjeta { width: min(520px, 100%); background: var(--gris-0, #fff); border: 1px solid var(--gris-2, #e5e5e5); border-radius: 16px; padding: 24px; box-shadow: var(--sombra-2); }
    .marca { margin: 0 0 14px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--gris-5); }
    .empresa { margin: 0 0 10px; font-weight: 700; } h1 { font-size: 17px; line-height: 1.35; margin: 0 0 14px; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0 0 18px; font-size: 14px; } dt { color: var(--gris-5); } dd { margin: 0; }
    .bt { display: block; text-align: center; padding: 13px; border-radius: 12px; font-weight: 800; font-size: 15px; text-decoration: none; margin-top: 10px; }
    .bt.p { background: var(--primario); color: var(--sobre-primario); } .bt.s { background: var(--gris-0); border: 1px solid var(--gris-3); color: var(--tinta); }
    .sello { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; background: var(--rojo-claro); }
    .sello div { display: flex; flex-direction: column; gap: 2px; } .sello .icono { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; background: var(--rojo); }
  `],
})
export class RelacionPublica {
  readonly d = signal<any>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') || '';
  readonly base = `${environment.apiUrl}/publico/relaciones/${encodeURIComponent(this.token)}`;
  constructor() {
    fetch(this.base).then(async r => { const j = await r.json().catch(() => ({})); if (r.ok) this.d.set(j); else this.error.set(j.error || 'El enlace no existe.'); })
      .catch(() => this.error.set('No se pudo consultar. Intente de nuevo.')).finally(() => this.cargando.set(false));
  }
}
