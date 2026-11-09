import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { EnVivo } from '../core/en-vivo.service';
import { FORMATOS, hoyIso, inicioMesIso } from '../shared/formato';
import { Icono } from '../shared/icono';
import { Confirmar } from '../shared/confirmar';

// Mensajes de WhatsApp al conductor (manifiesto o soporte interno): qué salió, a quién y si llegó o lo leyó.
// Los estados los avisa Meta por el webhook, sin costo adicional.
const ESTADOS: Record<string, [string, string]> = {
  por_aprobar: ['Por aprobar', 'alerta'], pendiente: ['Enviando', ''], enviando: ['Enviando', ''], enviado: ['Enviado', 'info'],
  entregado: ['Entregado', 'ok'], leido: ['Leído', 'ok'], error: ['Error', 'error'], descartado: ['Descartado', ''],
};

@Component({
  selector: 'app-mensajes-whatsapp',
  imports: [FormsModule, Icono, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Mensajes de WhatsApp</h1>
      <p class="sutil">Manifiestos y soportes internos que se mandaron a enviar al WhatsApp de los conductores: cuándo salieron, si llegaron al celular y si los leyeron. Los que aún no se han enviado no aparecen aquí.</p></div></div>

    <div class="filtros">
      <div class="campo"><label for="w-d">Desde</label><input id="w-d" type="date" [(ngModel)]="desde" (change)="cargar()" /></div>
      <div class="campo"><label for="w-h">Hasta</label><input id="w-h" type="date" [(ngModel)]="hasta" (change)="cargar()" /></div>
      <div class="campo"><label for="w-t">Buscar</label><input id="w-t" type="search" placeholder="Conductor, placa, documento o celular" [(ngModel)]="texto" (keyup.enter)="cargar()" (search)="cargar()" /></div>
      <button type="button" (click)="cargar()" [disabled]="cargando()">Buscar</button>
    </div>

    @if (totales(); as t) {
      <div class="cifras" role="group" aria-label="Filtrar por estado">
        @for (c of cifras; track c.v) {
          <button type="button" class="cifra" [class.activo]="estado() === c.v" [attr.aria-pressed]="estado() === c.v" (click)="filtrar(c.v)">
            <span>{{ c.t }}</span><strong>{{ $any(t)[c.k] }}</strong></button>
        }
      </div>
    }

    <div class="tabla-caja"><table class="tabla-movil">
      <thead><tr><th>Fecha</th><th>Conductor</th><th>Documento</th><th>Viaje</th><th>Estado</th><th>Entregado</th><th>Leído</th><th></th></tr></thead>
      <tbody>
        @for (m of mensajes(); track m._id) {
          <tr>
            <td data-etiqueta="Fecha">{{ m.fecha | fechaHora }}</td>
            <td data-etiqueta="Conductor">{{ m.conductor?.nombre || 'Sin conductor' }}<br /><span class="sutil">{{ celular(m.telefono) }}</span></td>
            <td data-etiqueta="Documento">{{ m.documento }}<br /><span class="sutil">{{ m.tipo === 'soporte' ? 'Soporte interno' : 'Manifiesto' }}</span></td>
            <td data-etiqueta="Viaje">@if (m.viaje) { N° {{ m.viaje.numero }} · <strong>{{ m.viaje.placa }}</strong><br /><span class="sutil">{{ m.viaje.destino }}</span> }</td>
            <td data-etiqueta="Estado"><span class="chip" [class]="clase(m.estado)">{{ texto_(m.estado) }}</span>
              @if (m.error) { <br /><span class="sutil error-texto">{{ m.error }}</span> }</td>
            <td data-etiqueta="Entregado">{{ m.entregadoEn ? (m.entregadoEn | fechaHora) : '—' }}</td>
            <td data-etiqueta="Leído">{{ m.leidoEn ? (m.leidoEn | fechaHora) : '—' }}</td>
            <td class="celda-acciones">
              @if (m.estado === 'error') {
                <button class="pequeno" confirmar="Clic otra vez para reenviar" (confirmado)="reintentar(m)" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="15" />Reintentar</button>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="8" class="vacio">{{ cargando() ? 'Cargando…' : 'No hay mensajes en este periodo' }}</td></tr>
        }
      </tbody>
    </table></div>
    <p class="sutil" style="margin-top:10px">Si el conductor desactivó la confirmación de lectura en WhatsApp, el mensaje queda en «Entregado» aunque lo haya visto.</p>`,
  styles: [`
    .cifras { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
    .cifra { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--gris-2); border-radius: 12px; background: var(--gris-0); height: auto; font-weight: 500; }
    .cifra strong { font-size: 18px; font-variant-numeric: tabular-nums; }
    .cifra.activo { border-color: var(--primario-borde); background: var(--primario-claro); }
    .error-texto { color: var(--rojo); display: inline-block; max-width: 280px; overflow-wrap: anywhere; }
  `],
})
export class MensajesWhatsapp {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly cifras = [
    { v: '', k: 'total', t: 'Todos' }, { v: 'enviados', k: 'enviados', t: 'Enviados' }, { v: 'entregado', k: 'entregados', t: 'Entregados' },
    { v: 'leido', k: 'leidos', t: 'Leídos' }, { v: 'error', k: 'errores', t: 'Con error' },
  ];
  desde = inicioMesIso();
  hasta = hoyIso();
  texto = '';
  readonly estado = signal('');
  readonly totales = signal<any>(null);
  readonly mensajes = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  private enVivo = inject(EnVivo).al(['whatsapp'], () => this.cargar());

  constructor() { this.cargar(); }

  async cargar() {
    if (!this.desde || !this.hasta) return;
    this.cargando.set(true);
    try {
      const r = await this.api.get<any>('/whatsapp/mensajes', { desde: this.desde, hasta: this.hasta, estado: this.estado(), texto: this.texto.trim() });
      this.totales.set(r.totales); this.mensajes.set(r.mensajes);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  filtrar(v: string) { this.estado.set(this.estado() === v ? '' : v); this.cargar(); }
  texto_(e: string) { return ESTADOS[e]?.[0] || e; }
  clase(e: string) { return ESTADOS[e]?.[1] || ''; }
  celular(t: string) { const d = String(t || ''); return d.startsWith('57') && d.length === 12 ? `${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : d; }

  async reintentar(m: any) {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/whatsapp/envios/${m._id}/reintentar`, {});
      if (r?.estado === 'error') this.avisos.mostrar(`No se envió: ${r.error}`, 'error', 9000);
      else this.avisos.ok('Mensaje reenviado por WhatsApp');
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
