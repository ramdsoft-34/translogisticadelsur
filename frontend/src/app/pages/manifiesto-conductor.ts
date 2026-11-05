import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { environment } from '../../environments/environment';

// Fase 9: página pública (sin sesión) del enlace que recibe el conductor por WhatsApp o en Sur Track.
// Muestra si el manifiesto está vigente y abre el mismo PDF que se descarga del RNDC.
@Component({
  selector: 'app-manifiesto-conductor',
  imports: [DatePipe],
  template: `
    <main class="verificar">
      <div class="tarjeta">
        <p class="marca">Manifiesto de carga</p>
        @if (cargando()) {
          <p class="sutil">Consultando…</p>
        } @else if (d(); as s) {
          <p class="empresa">{{ s.empresa }}<br /><span class="sutil">NIT {{ s.nit }}</span></p>
          <div class="sello" [class.ok]="s.valido" [class.alerta]="!s.valido">
            <span class="icono">{{ s.valido ? '✓' : '!' }}</span>
            <div><strong>{{ s.valido ? 'Manifiesto vigente · aceptado en el RNDC' : 'Este enlace ya no está disponible' }}</strong>
              @if (!s.valido) { <small>{{ s.motivo }}</small> }</div>
          </div>
          <dl>
            <dt>Manifiesto</dt><dd><strong>{{ s.manifiesto }}</strong></dd>
            <dt>Autorización</dt><dd>{{ s.autorizacion || '—' }}</dd>
            <dt>Remesa</dt><dd>{{ s.remesa || '—' }}</dd>
            <dt>Placa</dt><dd><strong>{{ s.placa }}</strong></dd>
            <dt>Conductor</dt><dd>{{ s.conductor || '—' }}</dd>
            <dt>Destino</dt><dd>{{ s.destino || '—' }}</dd>
            <dt>Fecha del viaje</dt><dd>{{ s.fecha | date: 'dd/MM/yyyy' : 'UTC' }}</dd>
          </dl>
          @if (s.valido) {
            <a class="bt p" [href]="pdf" target="_blank" rel="noopener">Ver el manifiesto (PDF)</a>
            <a class="bt s" [href]="pdf + '?descargar=1'">Descargar al celular</a>
          }
          <p class="nota">Es el manifiesto expedido en el RNDC, con su código QR. El enlace deja de funcionar cuando se cumple el viaje o si el manifiesto se anula.</p>
        } @else {
          <div class="sello error"><span class="icono">×</span>
            <div><strong>Enlace no encontrado</strong><small>{{ error() }}</small></div></div>
        }
      </div>
    </main>`,
  styles: [`
    .verificar { min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; background: var(--fondo, #f6f6f4); }
    .tarjeta { width: min(480px, 100%); background: var(--gris-0, #fff); border: 1px solid var(--gris-2, #e5e5e5); border-radius: 16px; padding: 24px; box-shadow: var(--sombra-2); }
    .marca { margin: 0 0 14px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--gris-5); }
    .empresa { margin: 0 0 14px; font-weight: 700; }
    .sello { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; margin-bottom: 16px; }
    .sello div { display: flex; flex-direction: column; gap: 2px; } .sello small { color: var(--gris-6); }
    .sello .icono { width: 34px; height: 34px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; }
    .sello.ok { background: #e8f6ee; } .sello.ok .icono { background: #1e8e4f; }
    .sello.alerta { background: #fff4e0; } .sello.alerta .icono { background: #c77700; }
    .sello.error { background: #fdecec; } .sello.error .icono { background: #b42318; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0 0 18px; font-size: 14px; } dt { color: var(--gris-5); } dd { margin: 0; }
    .bt { display: block; text-align: center; padding: 13px; border-radius: 12px; font-weight: 800; font-size: 15px; text-decoration: none; margin-top: 10px; }
    .bt.p { background: var(--primario, #f6b80f); color: #111; } .bt.s { background: #fff; border: 1px solid var(--gris-3, #d0d5dd); color: #222; }
    .nota { margin: 16px 0 0; font-size: 12px; color: var(--gris-5); }
  `],
})
export class ManifiestoConductor {
  readonly d = signal<any>(null);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') || '';
  readonly pdf = `${environment.apiUrl}/publico/manifiestos/${encodeURIComponent(this.token)}/pdf`;

  constructor() {
    fetch(`${environment.apiUrl}/publico/manifiestos/${encodeURIComponent(this.token)}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (r.ok) this.d.set(j); else this.error.set(j.error || j.mensaje || 'El enlace no existe.'); })
      .catch(() => this.error.set('No se pudo consultar. Intente de nuevo.'))
      .finally(() => this.cargando.set(false));
  }
}
