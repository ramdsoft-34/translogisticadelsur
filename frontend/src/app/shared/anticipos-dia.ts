import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from './modal';
import { FORMATOS, hoyIso } from './formato';
import { comprimirFoto } from './imagen-soporte';

type Filtro = 'todos' | 'porPagar' | 'sinLeer' | 'efectivo';
const DOS_HORAS = 2 * 3600e3;

// Fase 15: pestaña «Soportes de anticipos» dentro de Viajes. Lista los viajes con anticipo de la fecha de cargue,
// el soporte que subió el mensajero y el estado del WhatsApp al conductor (enviado, entregado, leído).
@Component({
  selector: 'app-anticipos-dia',
  imports: [FormsModule, Modal, ...FORMATOS],
  template: `
    <section class="barra" aria-label="Filtros de anticipos">
      <div class="campo"><label for="an-f">Fecha de cargue</label><input id="an-f" type="date" [(ngModel)]="fecha" (change)="cargar()" /></div>
      <div class="campo"><span class="etiqueta">Ver</span><div class="segmentos" role="group" aria-label="Ver">
        @for (o of opciones; track o[0]) { <button type="button" [class.activo]="filtro() === o[0]" (click)="filtro.set(o[0])">{{ o[1] }}</button> }
      </div></div>
      <div class="campo crece"></div>
      @if (puedeRegistrar) { <button class="wa-b" type="button" (click)="abrirEnlace()">Enviar enlace al mensajero</button> }
    </section>
    @if (d() && !d().whatsappApi) {
      <div class="mensaje info compacto">WhatsApp Business aún no está conectado: el mensajero comparte la foto desde su celular y aquí se confirma a mano. Cuando el administrador lo conecte, el envío y los chulitos de leído serán automáticos.</div>
    }
    @if (d(); as x) {
      <div class="resumen">
        <div><span>Anticipos del día</span><strong>{{ x.resumen.total | pesos }}</strong></div>
        <div><span>Pagados con soporte</span><strong class="verde">{{ x.resumen.pagados }} de {{ x.resumen.viajes }}</strong></div>
        <div><span>Por pagar</span><strong class="ambar">{{ x.resumen.porPagar }} · {{ x.resumen.valorPorPagar | pesos }}</strong></div>
        <div><span>Leídos o confirmados</span><strong class="azul">{{ x.resumen.leidos }}</strong></div>
        <div><span>Sin leer +2 h</span><strong class="rojo">{{ x.resumen.sinLeer }}</strong></div>
      </div>
      @if (x.enlaces?.length) {
        <p class="sutil enlaces">Enlaces de hoy: @for (e of x.enlaces; track e.id) { <span class="chip sin-punto" [class.error]="e.bloqueado">{{ e.nombre }} {{ e.documento }}{{ e.ultimoIngreso ? ' · entró' : '' }}
          @if (puedeRegistrar) { <button type="button" class="x" title="Cerrar este enlace" (click)="anularEnlace(e.id)">×</button> }</span> } </p>
      }
    }
    <div class="tabla-caja">
      <table class="tabla-movil">
        <thead><tr><th>N°</th><th>Fecha de cargue</th><th>Cliente / destino</th><th>Placa</th><th>Conductor</th><th class="num">Anticipo</th>
          <th>Forma de pago</th><th>Soporte</th><th>Pagó</th><th>WhatsApp al conductor</th></tr></thead>
        <tbody>
          @for (f of filas(); track f.id) {
            <tr [class.fila-roja]="sinLeer(f)">
              <td data-etiqueta="N°" class="sutil">{{ f.numero }}</td><td data-etiqueta="Fecha de cargue">{{ f.fecha | dia }}</td>
              <td data-etiqueta="Cliente"><span class="celda-doble"><span>{{ f.cliente }}</span><small>{{ f.destino }}</small></span></td>
              <td data-etiqueta="Placa"><span class="placa">{{ f.placa }}</span></td><td data-etiqueta="Conductor">{{ f.conductor }}</td>
              <td data-etiqueta="Anticipo" class="num"><strong>{{ f.anticipo | pesos }}</strong></td>
              <td data-etiqueta="Forma de pago">@if (f.soporte?.forma === 'efectivo') { 💵 Efectivo } @else if (f.pago.cuenta) {
                <span class="celda-doble"><span>{{ f.pago.entidad }} {{ cuenta(f.pago.cuenta) }}</span>@if (f.pago.a === 'titular') { <small>a {{ f.pago.nombre }}</small> }</span> } @else { <span class="sutil">Sin cuenta</span> }</td>
              <td data-etiqueta="Soporte">@if (f.soporte) { <button type="button" class="enlace" (click)="ver(f)">🖼️ {{ f.soporte.forma === 'efectivo' ? 'Recibo firmado' : hora(f.soporte.subido) }}</button> }
                @else if (puedeRegistrar) { <label class="enlace">📎 Subir<input type="file" accept="image/*" hidden (change)="subir(f, $event)" /></label> } @else { — }</td>
              <td data-etiqueta="Pagó">{{ f.soporte?.por || '—' }}</td>
              <td data-etiqueta="WhatsApp"><span class="estados">
                <span class="chip sin-punto" [class]="claseWa(f)">{{ textoWa(f) }}</span>
                @if (f.soporte && !f.soporte.confirmado && f.soporte.whatsapp !== 'leido' && puedeRegistrar) {
                  <button type="button" class="pequeno" (click)="confirmar(f)">Confirmar a mano</button> }
                @if (f.soporte?.error) { <small class="sutil" [title]="f.soporte.error">⚠ {{ f.soporte.error }}</small> }
                @if (!f.tieneCelular) { <small class="sutil">Sin celular</small> }
              </span></td>
            </tr>
          } @empty {
            <tr><td colspan="10" class="vacio">@if (cargando()) { Cargando… } @else { <strong>No hay anticipos</strong> No hay viajes con anticipo en esta fecha o con este filtro. }</td></tr>
          }
        </tbody>
      </table>
    </div>

    <app-modal titulo="Enlace del mensajero" [abierto]="enlaceAbierto()" (cerrar)="enlaceAbierto.set(false)">
      @if (!enlace()) {
        <p class="sutil">El mensajero entra con este enlace y su cédula, sin usuario ni contraseña. Sirve solo para los viajes del {{ fecha }} y vence al día siguiente.</p>
        <form class="form-enlace" (ngSubmit)="crearEnlace()">
          <label>Nombre<input name="n" [(ngModel)]="m.nombre" required maxlength="80" /></label>
          <label>Cédula<input name="d" [(ngModel)]="m.documento" inputmode="numeric" required maxlength="15" /></label>
          <label>Celular (WhatsApp)<input name="c" [(ngModel)]="m.celular" inputmode="numeric" maxlength="15" /></label>
          <button class="primario" type="submit" [disabled]="guardando() || m.nombre.length < 2 || m.documento.length < 5">Crear enlace</button>
        </form>
      } @else {
        <p>Enlace listo para <strong>{{ m.nombre }}</strong>:</p>
        <p class="url">{{ enlace().url }}</p>
        <div class="acciones-enlace">
          @if (enlace().whatsapp) { <a class="boton wa" [href]="enlace().whatsapp" target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a> }
          <button type="button" (click)="copiarEnlace()">Copiar mensaje</button></div>
      }
    </app-modal>

    <app-modal [titulo]="'Soporte · ' + (visto()?.placa || '')" [abierto]="!!imagenUrl()" (cerrar)="cerrarImagen()">
      @if (imagenUrl()) { <img class="soporte-img" [src]="imagenUrl()" alt="Soporte del anticipo" /> }
    </app-modal>`,
  styles: [`
    .wa-b { background: var(--whatsapp, #25d366); border-color: var(--whatsapp, #25d366); color: #fff; align-self: flex-end; }
    .resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 1px; background: var(--gris-2); border: 1px solid var(--gris-2);
      border-radius: var(--radio-l); overflow: hidden; margin-bottom: 14px; }
    .resumen > div { background: var(--gris-0); padding: 12px 16px; display: flex; flex-direction: column; gap: 2px; }
    .resumen span { font-size: 12.5px; color: var(--gris-5); }
    .resumen strong { font-size: 20px; font-weight: 650; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    @media (max-width: 760px) { .resumen { grid-template-columns: repeat(2, 1fr); } }
    .resumen .verde { color: var(--verde); } .resumen .ambar { color: var(--ambar); } .resumen .azul { color: var(--azul); } .resumen .rojo { color: var(--rojo); }
    .compacto { margin-bottom: 12px; } .enlaces { margin: -4px 0 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .x { border: 0; background: none; padding: 0 0 0 4px; min-height: 0; font-weight: 800; cursor: pointer; color: inherit; }
    tr.fila-roja td { background: var(--rojo-claro); }
    .enlace { border: 0; background: none; padding: 0; min-height: 0; color: var(--azul); cursor: pointer; font-weight: 600; white-space: nowrap; }
    .form-enlace { display: flex; flex-direction: column; gap: 10px; } .form-enlace label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; font-size: 13px; }
    .url { word-break: break-all; background: var(--gris-15); padding: 8px 10px; border-radius: 8px; font-family: monospace; font-size: 13px; }
    .acciones-enlace { display: flex; gap: 8px; } .boton.wa { background: var(--whatsapp, #25d366); color: #fff; border-color: var(--whatsapp, #25d366); }
    .soporte-img { width: 100%; max-height: 70vh; object-fit: contain; }
  `],
})
export class AnticiposDia {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly puedeRegistrar = inject(Auth).tiene(P.VIAJES_REGISTRAR);
  readonly opciones: [Filtro, string][] = [['todos', 'Todos'], ['porPagar', 'Por pagar'], ['sinLeer', 'Sin leer'], ['efectivo', 'Efectivo']];
  readonly filtro = signal<Filtro>('todos');
  readonly d = signal<any>(null);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly enlaceAbierto = signal(false);
  readonly enlace = signal<any>(null);
  readonly imagenUrl = signal('');
  readonly visto = signal<any>(null);
  fecha = hoyIso();
  m = { nombre: '', documento: '', celular: '' };

  readonly filas = computed(() => {
    const l = this.d()?.filas || []; const f = this.filtro();
    if (f === 'porPagar') return l.filter((x: any) => !x.soporte);
    if (f === 'sinLeer') return l.filter((x: any) => x.soporte && !x.soporte.confirmado && x.soporte.whatsapp !== 'leido');
    if (f === 'efectivo') return l.filter((x: any) => x.soporte?.forma === 'efectivo');
    return l;
  });

  constructor() { this.cargar(); }

  async cargar() {
    this.cargando.set(true);
    try { this.d.set(await this.api.get('/anticipos', { fecha: this.fecha })); }
    catch (e: any) { this.avisos.error(e?.error?.error || 'No se pudieron cargar los anticipos'); }
    finally { this.cargando.set(false); }
  }

  sinLeer(f: any) { return !!f.soporte && !f.soporte.confirmado && f.soporte.whatsapp !== 'leido' && Date.now() - new Date(f.soporte.subido).getTime() > DOS_HORAS; }
  claseWa(f: any) {
    const s = f.soporte; if (!s) return 'chip sin-punto alerta';
    if (s.whatsapp === 'leido' || s.confirmado) return 'chip sin-punto info';
    if (s.whatsapp === 'error' || this.sinLeer(f)) return 'chip sin-punto error';
    return 'chip sin-punto';
  }
  textoWa(f: any) {
    const s = f.soporte; if (!s) return 'Por pagar';
    const h = (x: any) => new Date(x).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    if (s.whatsapp === 'leido') return `✓✓ Leído ${h(s.leido)}`;
    if (s.confirmado) return `✓ Confirmado a mano ${h(s.confirmado)}`;
    if (s.whatsapp === 'error') return 'No se pudo enviar';
    if (this.sinLeer(f)) return s.whatsapp === 'manual' ? 'Enviado a mano · confirmar' : '✓ Sin leer hace +2 h';
    return ({ entregado: '✓✓ Entregado', enviado: '✓ Enviado', manual: 'Enviado a mano', pendiente: 'Enviando…' } as any)[s.whatsapp] || '—';
  }
  hora(x: any) { return new Date(x).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); }
  cuenta(c: string) { const d = String(c || ''); return d.length > 4 ? `****${d.slice(-4)}` : d; }

  abrirEnlace() { this.enlace.set(null); this.m = { nombre: '', documento: '', celular: '' }; this.enlaceAbierto.set(true); }
  async crearEnlace() {
    this.guardando.set(true);
    try { this.enlace.set(await this.api.post('/anticipos/enlace', { ...this.m, fecha: this.fecha })); this.cargar(); }
    catch (e: any) { this.avisos.error(e?.error?.error || 'No se pudo crear el enlace'); }
    finally { this.guardando.set(false); }
  }
  async copiarEnlace() { try { await navigator.clipboard.writeText(this.enlace().texto); this.avisos.ok('Mensaje copiado'); } catch { /* sin portapapeles */ } }
  async anularEnlace(id: string) { await this.api.delete(`/anticipos/enlace/${id}`); this.cargar(); }

  async subir(f: any, ev: Event) {
    const a = (ev.target as HTMLInputElement).files?.[0]; if (!a) return;
    try {
      const r: any = await this.api.post(`/anticipos/${f.id}/soporte`, { forma: 'transferencia', imagen: await comprimirFoto(a) });
      this.avisos.ok(r.whatsapp === 'enviado' ? 'Soporte enviado al conductor por WhatsApp' : 'Soporte guardado. Envíelo por WhatsApp y confírmelo a mano');
      this.cargar();
    } catch (e: any) { this.avisos.error(e?.error?.error || 'No se pudo subir el soporte'); }
  }
  async confirmar(f: any) {
    try { await this.api.post(`/anticipos/${f.id}/confirmar`, {}); this.cargar(); }
    catch (e: any) { this.avisos.error(e?.error?.error || 'No se pudo confirmar'); }
  }
  async ver(f: any) {
    try { const b = await this.api.archivo(`/anticipos/${f.id}/imagen`); this.visto.set(f); this.imagenUrl.set(URL.createObjectURL(b)); }
    catch { this.avisos.error('No se pudo abrir el soporte'); }
  }
  cerrarImagen() { const u = this.imagenUrl(); if (u) URL.revokeObjectURL(u); this.imagenUrl.set(''); this.visto.set(null); }
}
