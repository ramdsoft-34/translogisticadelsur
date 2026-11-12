import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../../environments/environment';
import { Firma } from '../shared/firma';
import { comprimirFoto, compartirWhatsapp, reciboEfectivo } from '../shared/imagen-soporte';

// Fase 15: página pública del mensajero (/a/<token>). Entra con su cédula, ve los anticipos del día,
// copia la cuenta, paga y sube la foto del comprobante (o el recibo firmado si fue en efectivo).
// Al conductor le llega por WhatsApp solo esa imagen con una descripción corta.
@Component({
  selector: 'app-mensajero-anticipos',
  imports: [DatePipe, FormsModule, Firma],
  template: `
    <main class="mv">
      <header class="cab"><b>💵 Anticipos{{ info()?.fecha ? ' · ' + (info().fecha | date: 'dd/MM/yyyy' : 'UTC') : '' }}</b>
        <small>{{ datos()?.mensajero || info()?.mensajero }}{{ info()?.empresa ? ' · ' + info().empresa : '' }}</small></header>

      @if (cargando()) { <p class="nota c">Consultando…</p> }
      @else if (!info()?.valido) {
        <div class="sello error"><span class="icono">×</span><div><strong>No se puede abrir</strong><small>{{ info()?.motivo || error() }}</small></div></div>
      } @else if (!sesion()) {
        <form class="tarjeta" (ngSubmit)="ingresar()">
          <label class="campo">Escriba su número de cédula
            <input name="doc" [(ngModel)]="documento" inputmode="numeric" maxlength="15" autocomplete="off" required /></label>
          @if (error()) { <div class="sello error"><span class="icono">×</span><div><small>{{ error() }}</small></div></div> }
          <button class="bt p" type="submit" [disabled]="enviando() || documento.length < 5">{{ enviando() ? 'Entrando…' : 'Entrar' }}</button>
        </form>
      } @else if (datos(); as d) {
        <div class="res"><div>Por pagar<b>{{ d.resumen.porPagar }}</b></div><div>Con soporte<b class="v">{{ d.resumen.pagados }}</b></div>
          <div>Total<b>{{ pesos(d.resumen.total) }}</b></div></div>
        @if (error()) { <div class="sello error" style="margin:10px 12px"><span class="icono">×</span><div><small>{{ error() }}</small></div></div> }
        @for (f of ordenadas(); track f.id) {
          <article class="cd" [class.ok]="f.soporte">
            <div class="fx"><span class="pl">{{ f.placa }}</span>
              @if (f.soporte) { <span class="chip ok sin-punto">✓ {{ f.soporte.forma === 'efectivo' ? 'Efectivo' : 'Soporte' }} {{ f.soporte.subido | date: 'h:mm a' }}</span> }
              @else { <span class="chip alerta sin-punto">Por pagar</span> }</div>
            <div class="fx"><div><div class="nm">{{ f.conductor }}</div><div class="ds">{{ f.cliente }} → {{ f.destino }}</div></div><span class="val">{{ pesos(f.anticipo) }}</span></div>
            @if (f.soporte) {
              <p class="nota">{{ estadoWa(f.soporte.whatsapp) }}</p>
            } @else if (abierto() === f.id) {
              @if (modo() === 'foto') {
                @if (foto()) { <img class="prev" [src]="foto()" alt="Comprobante" /> }
                <label class="bt s">📷 {{ foto() ? 'Tomar otra foto' : 'Tomar o elegir la foto' }}
                  <input type="file" accept="image/*" capture="environment" (change)="elegirFoto($event)" hidden /></label>
                <button class="bt p" type="button" [disabled]="!foto() || enviando()" (click)="enviar(f, 'transferencia')">{{ enviando() ? 'Enviando…' : 'Enviar al conductor por WhatsApp' }}</button>
              } @else {
                <p class="nota">El conductor firma con el dedo que recibió {{ pesos(f.anticipo) }} en efectivo.</p>
                <app-firma [valor]="firma()" (cambio)="firma.set($event)" etiqueta="Firma del conductor" />
                <button class="bt p" type="button" [disabled]="!firma() || enviando()" (click)="enviar(f, 'efectivo')">{{ enviando() ? 'Enviando…' : 'Guardar y enviar el recibo' }}</button>
              }
              <button class="bt t" type="button" (click)="cerrar()">Cancelar</button>
            } @else {
              @if (f.pago.cuenta) {
                <div class="cta"><span>{{ f.pago.entidad || 'Cuenta' }} {{ f.pago.tipoCuenta }} <b>{{ f.pago.cuenta }}</b>@if (f.pago.a === 'titular') { <small> · a {{ f.pago.nombre }}</small> }</span>
                  <button type="button" class="mini" (click)="copiar(f.pago.cuenta)">{{ copiado() === f.pago.cuenta ? '✓ Copiado' : '📋 Copiar' }}</button></div>
              } @else { <div class="cta"><span class="nota">Sin cuenta registrada: pregunte a la oficina o entregue en efectivo</span></div> }
              <div class="dos"><button class="bt p" type="button" (click)="abrir(f, 'foto')">📷 Subir soporte</button>
                <button class="bt s" type="button" (click)="abrir(f, 'efectivo')">💵 Efectivo</button></div>
            }
            @if (compartir()?.id === f.id) {
              <div class="sello alerta"><span class="icono">!</span><div><strong>Envíelo usted por WhatsApp</strong><small>{{ compartir()!.motivo }}</small></div></div>
              <button class="bt w" type="button" (click)="compartirAhora()">Compartir por WhatsApp</button>
            }
          </article>
        } @empty { <p class="nota c">No hay viajes con anticipo en esta fecha.</p> }
      }
    </main>`,
  styles: [`
    .mv { min-height: 100dvh; background: #eef1f5; padding-bottom: 30px; max-width: 520px; margin: 0 auto; }
    .cab { background: #15171c; color: #fff; padding: 14px 16px; } .cab b { font-size: 18px; display: block; } .cab small { color: #aeb3bc; }
    .res { display: flex; gap: 8px; padding: 12px 12px 4px; } .res div { flex: 1; background: #fff; border-radius: 10px; text-align: center; padding: 7px; font-size: 12px; color: #555; }
    .res b { display: block; font-size: 17px; color: #111; } .res b.v { color: #15803d; }
    .cd { background: #fff; border-radius: 12px; margin: 10px 12px; padding: 12px 13px; border-left: 4px solid #f5b400; display: flex; flex-direction: column; gap: 8px; }
    .cd.ok { border-left-color: #16a34a; } .fx { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .pl { background: #f5b400; border-radius: 5px; padding: 2px 7px; font-weight: 800; font-size: 12.5px; }
    .nm { font-weight: 700; font-size: 15px; } .ds { color: #6b7280; font-size: 12.5px; } .val { font-weight: 800; font-size: 18px; white-space: nowrap; }
    .cta { background: #f6f7f9; border-radius: 8px; padding: 8px 10px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .mini { border: 1px solid #d5dbe3; background: #fff; border-radius: 7px; padding: 4px 9px; font-size: 12.5px; min-height: 0; white-space: nowrap; }
    .dos { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }
    .bt { display: block; width: 100%; text-align: center; padding: 12px; border-radius: 10px; font-weight: 800; font-size: 15px; border: 0; cursor: pointer; }
    .bt.p { background: #15171c; color: #fff; } .bt.s { background: #fff8e1; border: 1.5px solid #f5b400; color: #15171c; }
    .bt.t { background: none; color: #6b7280; font-weight: 600; padding: 6px; } .bt.w { background: #25d366; color: #fff; } .bt:disabled { opacity: .5; }
    .prev { width: 100%; max-height: 360px; object-fit: contain; border-radius: 8px; background: #f6f7f9; }
    .tarjeta { margin: 16px 12px; background: #fff; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
    .campo { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: 14px; }
    .campo input { font-size: 22px; letter-spacing: .15em; text-align: center; padding: 10px; border-radius: 12px; border: 1px solid #d0d5dd; }
    .sello { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 12px; margin: 0; }
    .sello div { display: flex; flex-direction: column; gap: 2px; } .sello small { color: #4b5563; }
    .sello .icono { width: 30px; height: 30px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 800; color: #fff; }
    .sello.alerta { background: #fff4e0; } .sello.alerta .icono { background: #c77700; } .sello.error { background: #fdecec; } .sello.error .icono { background: #b42318; }
    .nota { margin: 0; font-size: 12.5px; color: #6b7280; } .c { text-align: center; padding: 20px; }
  `],
})
export class MensajeroAnticipos {
  readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') || '';
  private readonly base = `${environment.apiUrl}/a/${encodeURIComponent(this.token)}`;
  private readonly clave = `tls-mensajero-${this.token}`;
  readonly info = signal<any>(null);
  readonly datos = signal<any>(null);
  readonly cargando = signal(true);
  readonly enviando = signal(false);
  readonly error = signal('');
  readonly sesion = signal('');
  readonly abierto = signal('');
  readonly modo = signal<'foto' | 'efectivo'>('foto');
  readonly foto = signal('');
  readonly firma = signal('');
  readonly copiado = signal('');
  readonly compartir = signal<{ id: string; imagen: string; texto: string; celular: string; motivo: string } | null>(null);
  documento = '';
  // Primero los que faltan por pagar
  readonly ordenadas = computed(() => [...(this.datos()?.filas || [])].sort((a: any, b: any) => Number(!!a.soporte) - Number(!!b.soporte)));

  constructor() {
    try { this.sesion.set(sessionStorage.getItem(this.clave) || ''); } catch { /* sin almacenamiento */ }
    this.iniciar();
  }

  private async pedir(ruta: string, opciones: RequestInit = {}) {
    const r = await fetch(this.base + ruta, { ...opciones, headers: { 'Content-Type': 'application/json', 'X-Sesion-Mensajero': this.sesion(), ...(opciones.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { this.salir(); }
    if (!r.ok) throw new Error(j.error || j.mensaje || 'No se pudo completar');
    return j;
  }

  private async iniciar() {
    try {
      this.info.set(await this.pedir(''));
      if (this.info()?.valido && this.sesion()) await this.cargar();
    } catch (e: any) { this.error.set(e.message); this.info.set({ valido: false, motivo: e.message }); }
    finally { this.cargando.set(false); }
  }

  async cargar() { try { this.datos.set(await this.pedir('/viajes')); } catch (e: any) { this.error.set(e.message); } }

  async ingresar() {
    this.enviando.set(true); this.error.set('');
    try {
      const r = await this.pedir('/ingresar', { method: 'POST', body: JSON.stringify({ documento: this.documento }) });
      this.sesion.set(r.sesion); try { sessionStorage.setItem(this.clave, r.sesion); } catch { /* sin almacenamiento */ }
      await this.cargar();
    } catch (e: any) { this.error.set(e.message); } finally { this.enviando.set(false); }
  }
  private salir() { this.sesion.set(''); try { sessionStorage.removeItem(this.clave); } catch { /* nada */ } }

  abrir(f: any, modo: 'foto' | 'efectivo') { this.abierto.set(f.id); this.modo.set(modo); this.foto.set(''); this.firma.set(''); this.error.set(''); }
  cerrar() { this.abierto.set(''); this.foto.set(''); this.firma.set(''); }

  async elegirFoto(ev: Event) {
    const a = (ev.target as HTMLInputElement).files?.[0]; if (!a) return;
    try { this.foto.set(await comprimirFoto(a)); } catch { this.error.set('No se pudo leer la foto. Intente de nuevo.'); }
  }

  async enviar(f: any, forma: 'transferencia' | 'efectivo') {
    this.enviando.set(true); this.error.set('');
    try {
      const fecha = new Date(f.fecha).toLocaleDateString('es-CO', { timeZone: 'UTC' });
      const imagen = forma === 'efectivo'
        ? await reciboEfectivo({ empresa: this.info()?.empresa || '', placa: f.placa, conductor: f.conductor, ruta: `${f.cliente} → ${f.destino}`, fecha,
          valor: this.pesos(f.anticipo), mensajero: this.datos()?.mensajero || '' }, this.firma())
        : this.foto();
      const r = await this.pedir(`/viajes/${f.id}/soporte`, { method: 'POST', body: JSON.stringify({ forma, imagen, firma: forma === 'efectivo' ? this.firma() : '' }) });
      if (r.whatsapp === 'manual' || r.whatsapp === 'error') {
        this.compartir.set({ id: f.id, imagen, texto: r.texto, celular: r.celular || '',
          motivo: r.error || 'La plataforma aún no envía sola por WhatsApp. Toque el botón y elija el chat del conductor.' });
      } else this.compartir.set(null);
      this.cerrar(); await this.cargar();
    } catch (e: any) { this.error.set(e.message); } finally { this.enviando.set(false); }
  }

  async compartirAhora() { const c = this.compartir(); if (c && await compartirWhatsapp(c.imagen, c.texto, c.celular)) this.compartir.set(null); }

  async copiar(t: string) { try { await navigator.clipboard.writeText(t); this.copiado.set(t); setTimeout(() => this.copiado.set(''), 2000); } catch { /* sin portapapeles */ } }

  estadoWa(e: string) {
    return ({ enviado: '✓ Enviado al conductor', entregado: '✓✓ Le llegó al conductor', leido: '✓✓ El conductor lo vio', manual: 'Se envía a mano por WhatsApp',
      error: '⚠ No se pudo enviar por WhatsApp: avise a la oficina', pendiente: 'Enviando…' } as any)[e] || '';
  }
  pesos(n: number) { return '$ ' + Math.round(n || 0).toLocaleString('es-CO'); }
}
