import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../../environments/environment';
import { Firma } from '../shared/firma';

// Fase 10: página pública (sin sesión) donde el asistente firma su asistencia a una capacitación desde el celular.
@Component({
  selector: 'app-firma-capacitacion',
  imports: [DatePipe, FormsModule, Firma],
  template: `
    <main class="verificar">
      <div class="tarjeta">
        <p class="marca">Asistencia a capacitación</p>
        @if (cargando()) { <p class="sutil">Consultando…</p> }
        @else if (d(); as s) {
          <p class="empresa">{{ s.empresa }}<br /><span class="sutil">NIT {{ s.nit }}</span></p>
          <h1>{{ s.tema }}</h1>
          <dl>
            <dt>Fecha</dt><dd>{{ s.fecha | date: 'dd/MM/yyyy' : 'UTC' }} · {{ s.horas }} h</dd>
            @if (s.facilitador) { <dt>Facilitador</dt><dd>{{ s.facilitador }}</dd> }
            <dt>Asistente</dt><dd><strong>{{ s.nombre }}</strong><br /><span class="sutil">Documento {{ s.documento }}</span></dd>
          </dl>
          @if (s.estado === 'firmado') {
            <div class="sello ok"><span class="icono">✓</span><div><strong>Asistencia firmada</strong>
              <small>{{ s.firmado | date: 'dd/MM/yyyy h:mm a' }} · código {{ (s.huella || '').slice(0, 12).toUpperCase() }}</small></div></div>
            <p class="nota">Puede cerrar esta página. La empresa ya tiene su firma en la planilla de asistencia.</p>
          } @else if (s.estado === 'bloqueado') {
            <div class="sello alerta"><span class="icono">!</span><div><strong>No se puede firmar</strong><small>{{ s.motivo }}</small></div></div>
          } @else {
            <form (ngSubmit)="firmar()">
              <label class="campo">Escriba los 4 últimos números de su documento
                <input name="u4" [(ngModel)]="ultimos4" inputmode="numeric" maxlength="4" autocomplete="off" required placeholder="••••" /></label>
              <label class="casilla"><input type="checkbox" name="ac" [(ngModel)]="acepto" />Asistí a esta capacitación</label>
              <app-firma [valor]="imagen" (cambio)="imagen = $event" etiqueta="Firme con el dedo" />
              <label class="casilla"><input type="checkbox" name="ub" [(ngModel)]="conUbicacion" />Agregar mi ubicación (opcional)</label>
              @if (error()) { <div class="sello error"><span class="icono">×</span><div><small>{{ error() }}</small></div></div> }
              <button class="bt p" type="submit" [disabled]="enviando() || ultimos4.length !== 4 || !acepto || !imagen">{{ enviando() ? 'Enviando…' : 'Firmar asistencia' }}</button>
              <p class="nota">Al firmar acepta que esta firma electrónica tiene la misma validez que la firma en papel (Ley 527 de 1999). Se guarda la fecha, la hora y el celular desde donde firma.</p>
            </form>
          }
        } @else {
          <div class="sello error"><span class="icono">×</span><div><strong>Enlace no encontrado</strong><small>{{ error() }}</small></div></div>
        }
      </div>
    </main>`,
  styles: [`
    .verificar { min-height: 100dvh; display: grid; place-items: center; padding: 20px 14px; background: var(--fondo, #f6f6f4); }
    .tarjeta { width: min(480px, 100%); background: var(--gris-0, #fff); border: 1px solid var(--gris-2, #e5e5e5); border-radius: 16px; padding: 22px; box-shadow: var(--sombra-2); }
    .marca { margin: 0 0 12px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--gris-5); }
    .empresa { margin: 0 0 10px; font-weight: 700; } h1 { margin: 0 0 12px; font-size: 21px; line-height: 1.25; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0 0 16px; font-size: 14px; } dt { color: var(--gris-5); } dd { margin: 0; }
    form { display: flex; flex-direction: column; gap: 14px; }
    .campo { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: 14px; }
    .campo input { font-size: 22px; letter-spacing: .3em; text-align: center; padding: 10px; border-radius: 12px; border: 1px solid var(--gris-3, #d0d5dd); }
    .casilla { display: flex; gap: 10px; align-items: center; font-size: 15px; } .casilla input { width: 22px; height: 22px; }
    .sello { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; }
    .sello div { display: flex; flex-direction: column; gap: 2px; } .sello small { color: var(--gris-6); }
    .sello .icono { width: 34px; height: 34px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; }
    .sello.ok { background: #e8f6ee; } .sello.ok .icono { background: #1e8e4f; } .sello.alerta { background: #fff4e0; } .sello.alerta .icono { background: #c77700; }
    .sello.error { background: #fdecec; } .sello.error .icono { background: #b42318; }
    .bt { display: block; width: 100%; text-align: center; padding: 14px; border-radius: 12px; font-weight: 800; font-size: 16px; border: 0; }
    .bt.p { background: var(--primario, #f6b80f); color: #111; } .bt:disabled { opacity: .5; }
    .nota { margin: 4px 0 0; font-size: 12px; color: var(--gris-5); }
  `],
})
export class FirmaCapacitacion {
  readonly d = signal<any>(null);
  readonly cargando = signal(true);
  readonly enviando = signal(false);
  readonly error = signal('');
  readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') || '';
  private readonly url = `${environment.apiUrl}/publico/firmas/${encodeURIComponent(this.token)}`;
  ultimos4 = ''; acepto = false; imagen = ''; conUbicacion = false;

  constructor() { this.cargar(); }
  private cargar() {
    fetch(this.url).then(async r => { const j = await r.json().catch(() => ({})); if (r.ok) this.d.set(j); else this.error.set(j.error || j.mensaje || 'El enlace no existe.'); })
      .catch(() => this.error.set('No se pudo consultar. Intente de nuevo.')).finally(() => this.cargando.set(false));
  }
  private ubicacion(): Promise<{ lat: number; lng: number } | null> {
    if (!this.conUbicacion || !navigator.geolocation) return Promise.resolve(null);
    return new Promise(ok => navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { timeout: 8000 }));
  }
  async firmar() {
    this.enviando.set(true); this.error.set('');
    try {
      const r = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ultimos4: this.ultimos4, acepto: this.acepto, imagen: this.imagen, ubicacion: await this.ubicacion() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { this.error.set(j.error || j.mensaje || 'No se pudo firmar.'); if (r.status === 410) this.cargar(); return; }
      this.d.update(x => ({ ...x, estado: 'firmado', firmado: j.firmado, huella: j.huella }));
    } catch { this.error.set('No se pudo enviar. Revise la conexión e intente de nuevo.'); } finally { this.enviando.set(false); }
  }
}
