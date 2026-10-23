import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { environment } from '../../environments/environment';

// Página pública (sin sesión) a la que lleva el QR del soporte interno: confirma que existe y es válido.
@Component({
  selector: 'app-verificar',
  imports: [DatePipe],
  template: `
    <main class="verificar">
      <div class="tarjeta">
        <p class="marca">Verificación de documento</p>
        @if (cargando()) {
          <p class="sutil">Consultando…</p>
        } @else if (d(); as s) {
          <div class="sello" [class.ok]="s.valido" [class.alerta]="!s.valido">
            <span class="icono">{{ s.valido ? '✓' : '!' }}</span>
            <div><strong>{{ s.valido ? 'Soporte interno válido' : 'Soporte interno no vigente' }}</strong>
              <small>{{ s.valido ? 'Este documento existe y fue expedido por la empresa.' : s.motivo }}</small></div>
          </div>
          <h1>{{ s.mc }} · {{ s.rc }}</h1>
          <p class="empresa">{{ s.empresa }}<br /><span class="sutil">NIT {{ s.nit }}</span></p>
          <dl>
            <dt>Fecha del viaje</dt><dd>{{ s.fecha | date: 'dd/MM/yyyy' : 'UTC' }}</dd>
            <dt>Expedido</dt><dd>{{ s.expedido | date: 'dd/MM/yyyy h:mm a' }}</dd>
            <dt>Placa</dt><dd><strong>{{ s.placa }}</strong>{{ s.remolque ? ' · remolque ' + s.remolque : '' }}</dd>
            <dt>Conductor</dt><dd>{{ s.conductor || '—' }}</dd>
            <dt>Origen</dt><dd>{{ s.origen || '—' }}</dd>
            <dt>Destino</dt><dd>{{ s.destino || '—' }}</dd>
            <dt>Código</dt><dd class="codigo">{{ s.codigo }}</dd>
          </dl>
          <p class="nota">Es un soporte interno de la empresa para viajes que no se expiden en el RNDC; no reemplaza un manifiesto del Ministerio de Transporte.</p>
        } @else {
          <div class="sello error"><span class="icono">×</span>
            <div><strong>Documento no encontrado</strong><small>{{ error() }}</small></div></div>
        }
      </div>
    </main>`,
  styles: [`
    .verificar { min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; background: var(--fondo, #f6f6f4); }
    .tarjeta { width: min(480px, 100%); background: var(--gris-0, #fff); border: 1px solid var(--gris-2, #e5e5e5); border-radius: 16px; padding: 24px; box-shadow: var(--sombra-2); }
    .marca { margin: 0 0 14px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--gris-5); }
    .sello { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; }
    .sello div { display: flex; flex-direction: column; gap: 2px; }
    .sello small { color: var(--gris-6); }
    .sello .icono { width: 34px; height: 34px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; }
    .sello.ok { background: #e8f6ee; } .sello.ok .icono { background: #1e8e4f; }
    .sello.alerta { background: #fff4e0; } .sello.alerta .icono { background: #c77700; }
    .sello.error { background: #fdecec; } .sello.error .icono { background: #b42318; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .empresa { margin: 0 0 14px; font-weight: 600; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 14px; }
    dt { color: var(--gris-5); }
    dd { margin: 0; }
    .codigo { font-family: ui-monospace, Consolas, monospace; }
    .nota { margin: 16px 0 0; font-size: 12px; color: var(--gris-5); }
  `],
})
export class Verificar {
  readonly d = signal<any>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  constructor() {
    const codigo = inject(ActivatedRoute).snapshot.paramMap.get('codigo') || '';
    fetch(`${environment.apiUrl}/publico/soportes/${encodeURIComponent(codigo)}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (r.ok) this.d.set(j); else this.error.set(j.error || j.mensaje || 'No existe un soporte interno con ese código.'); })
      .catch(() => this.error.set('No se pudo consultar. Intente de nuevo.'))
      .finally(() => this.cargando.set(false));
  }
}
