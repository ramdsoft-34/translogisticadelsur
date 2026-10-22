import { Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { Moneda } from './moneda';
import { FORMATOS } from './formato';

type Modalidad = 'destino' | 'clientes';
interface ClienteParada { nombre: string; direccion: string; ciudad: string; telefono: string; documento: string; factura: string; valor: number | null; lat?: number | null; lng?: number | null; estadoEntrega?: string }
const vacioCliente = (): ClienteParada => ({ nombre: '', direccion: '', ciudad: '', telefono: '', documento: '', factura: '', valor: null });
const PASTO: L.LatLngTuple = [1.2136, -77.2811];

// Activar el rastreo de un viaje (o cambiar sus paradas antes de que el conductor acepte) con dos modalidades:
// solo destino (punto en el mapa y ruta sugerida) o con clientes (se envían a Sur Track; uno a uno o desde Excel).
// Uso: <app-activar-rastreo (listo)="..." /> … componente.abrir(viaje, rastreoActual?)
@Component({
  selector: 'app-activar-rastreo',
  imports: [FormsModule, Modal, Icono, Moneda, ...FORMATOS],
  template: `
    <app-modal [titulo]="editando() ? 'Cambiar destino o clientes' : 'Rastrear viaje N° ' + (viaje()?.numero || '')" [abierto]="abierto()" (cerrar)="cerrar()" [ancho]="true">
      @if (viaje(); as v) {
        <p class="sutil" style="margin-top:0"><span class="placa">{{ v.placa }}</span> · {{ v.conductorNombre }} · {{ v.cliente?.nombre }} → {{ v.destino }}</p>
        <fieldset class="bloque">
          <legend>Modalidad</legend>
          <div class="tarjetas">
            <button type="button" class="tarjeta" [class.activo]="modalidad() === 'destino'" [attr.aria-pressed]="modalidad() === 'destino'" (click)="cambiarModalidad('destino')">
              <app-icono nombre="ubicacion" [tam]="20" /><strong>Solo destino</strong><span>Ubique el destino en el mapa: se muestra con el vehículo y la ruta sugerida.</span></button>
            <button type="button" class="tarjeta" [class.activo]="modalidad() === 'clientes'" [attr.aria-pressed]="modalidad() === 'clientes'" (click)="cambiarModalidad('clientes')">
              <app-icono nombre="personas" [tam]="20" /><strong>Con clientes</strong><span>Paradas de entrega que el conductor ve en Sur Track, una a una o desde Excel.</span></button>
          </div>
        </fieldset>

        @if (modalidad() === 'destino') {
          <div class="buscar-destino">
            <div class="campo crece"><label for="ar-dest">Destino</label>
              <input id="ar-dest" [(ngModel)]="textoDestino" (keyup.enter)="buscarDestino()" placeholder="Municipio, dirección o lugar (ej. Ipiales, Nariño)" /></div>
            <button type="button" (click)="buscarDestino()" [disabled]="buscando()"><app-icono nombre="buscar" [tam]="16" />{{ buscando() ? 'Buscando…' : 'Buscar' }}</button>
          </div>
          @if (resultados().length) {
            <ul class="resultados">
              @for (r of resultados(); track $index) { <li><button type="button" class="texto" (click)="elegirResultado(r)">{{ r.nombre }}</button></li> }
            </ul>
          }
          <div #mapa class="mapa-destino" role="application" aria-label="Mapa para ubicar el destino"></div>
          <p class="sutil nota">{{ destino().lat !== undefined ? 'Destino: ' + destino().nombre + ' (' + destino().lat!.toFixed(5) + ', ' + destino().lng!.toFixed(5) + '). Puede tocar el mapa para ajustar el punto.' : 'Busque el destino o toque el mapa para marcarlo.' }}</p>
        } @else {
          <div class="acciones-clientes">
            <button type="button" (click)="archivo.click()" [disabled]="importando()"><app-icono nombre="descargar" [tam]="16" />{{ importando() ? 'Leyendo…' : 'Importar Excel' }}</button>
            <input #archivo type="file" accept=".xlsx" hidden (change)="importar($event)" />
            <button type="button" class="texto" (click)="plantilla()">Descargar plantilla</button>
            <span class="sutil derecha">{{ clientes().length }} cliente(s)</span>
          </div>
          <form class="nuevo-cliente" (ngSubmit)="agregar()">
            <div class="campo"><label for="ar-cn">Nombre</label><input id="ar-cn" name="cn" [(ngModel)]="nuevo.nombre" required /></div>
            <div class="campo"><label for="ar-cd">Dirección</label><input id="ar-cd" name="cd" [(ngModel)]="nuevo.direccion" /></div>
            <div class="campo"><label for="ar-cc">Ciudad</label><input id="ar-cc" name="cc" [(ngModel)]="nuevo.ciudad" /></div>
            <div class="campo"><label for="ar-ct">Teléfono</label><input id="ar-ct" name="ct" [(ngModel)]="nuevo.telefono" /></div>
            <div class="campo"><label for="ar-cf">Factura</label><input id="ar-cf" name="cf" [(ngModel)]="nuevo.factura" /></div>
            <div class="campo"><label for="ar-cv">Valor a recibir</label><div class="moneda"><input id="ar-cv" moneda name="cv" [(ngModel)]="nuevo.valor" /></div></div>
            <div class="campo"><span class="etiqueta">&nbsp;</span><button type="submit" [disabled]="!nuevo.nombre.trim()"><app-icono nombre="mas" [tam]="16" />Agregar</button></div>
          </form>
          <div class="tabla-caja">
            <table class="tabla-movil">
              <thead><tr><th>#</th><th>Nombre</th><th>Dirección</th><th>Ciudad</th><th>Teléfono</th><th>Factura</th><th class="num">Valor</th><th></th></tr></thead>
              <tbody>
                @for (c of clientes(); track $index; let i = $index) {
                  <tr><td data-etiqueta="#" class="sutil">{{ i + 1 }}</td><td data-etiqueta="Nombre"><strong>{{ c.nombre }}</strong></td><td data-etiqueta="Dirección">{{ c.direccion || '—' }}</td>
                    <td data-etiqueta="Ciudad">{{ c.ciudad || '—' }}</td><td data-etiqueta="Teléfono">{{ c.telefono || '—' }}</td><td data-etiqueta="Factura">{{ c.factura || 'Automática' }}</td>
                    <td data-etiqueta="Valor" class="num">{{ c.valor ? (c.valor | pesos) : '—' }}</td>
                    <td><button type="button" class="texto peligro pequeno" (click)="quitar(i)" [attr.aria-label]="'Quitar ' + c.nombre">Quitar</button></td></tr>
                } @empty { <tr><td colspan="8" class="vacio">Agregue clientes uno a uno o importe un Excel (columnas: Nombre, Dirección, Ciudad, Teléfono, Factura, Valor).</td></tr> }
              </tbody>
            </table>
          </div>
          <p class="sutil nota">Sur Track arma la ruta de entrega con las direcciones, como al crear un viaje en Cooespatrans. Puede cambiar los clientes hasta que el conductor acepte el viaje.</p>
        }
      }
      <ng-container pie>
        <button type="button" (click)="cerrar()">Cancelar</button>
        <button type="button" class="primario" (click)="guardar()" [disabled]="guardando() || !valido()">
          {{ guardando() ? 'Enviando…' : editando() ? 'Guardar cambios' : 'Activar rastreo' }}</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .bloque { border: 0; padding: 0; margin: 0 0 14px; min-width: 0; }
    legend { font-weight: 650; font-size: 13px; color: var(--gris-6); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .04em; }
    .tarjetas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: stretch; }
    .tarjeta { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border-radius: 14px; text-align: left;
      border: 1.5px solid var(--gris-2); background: var(--gris-0); height: auto; white-space: normal; margin: 0; justify-content: flex-start; }
    .tarjeta span { font-size: 12.5px; color: var(--gris-6); font-weight: 400; line-height: 1.35; }
    .tarjeta.activo { border-color: var(--primario-borde); background: var(--primario-claro); box-shadow: 0 0 0 1px var(--primario-borde); }
    .buscar-destino { display: flex; gap: 8px; align-items: flex-end; } .crece { flex: 1; }
    .resultados { list-style: none; margin: 6px 0; padding: 4px; border: 1px solid var(--gris-2); border-radius: 10px; max-height: 150px; overflow: auto; }
    .resultados button { text-align: left; white-space: normal; height: auto; padding: 6px 8px; font-weight: 400; }
    .mapa-destino { height: 300px; margin-top: 10px; border-radius: var(--radio); border: 1px solid var(--gris-2); }
    .nota { font-size: 12.5px; margin: 8px 0 0; }
    .acciones-clientes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; } .derecha { margin-left: auto; }
    .nuevo-cliente { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 10px; padding: 10px; background: var(--gris-1); border-radius: var(--radio); }
    @media (max-width: 560px) { .tarjetas { grid-template-columns: 1fr; } .buscar-destino { flex-direction: column; align-items: stretch; } }
  `],
})
export class ActivarRastreo {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly listo = output<any>();

  readonly abierto = signal(false);
  readonly viaje = signal<any>(null);
  readonly editando = signal(false);
  readonly modalidad = signal<Modalidad>('destino');
  readonly destino = signal<{ nombre: string; lat?: number; lng?: number }>({ nombre: '' });
  readonly clientes = signal<ClienteParada[]>([]);
  readonly resultados = signal<{ nombre: string; lat: number; lng: number }[]>([]);
  readonly buscando = signal(false);
  readonly importando = signal(false);
  readonly guardando = signal(false);
  readonly valido = computed(() => this.modalidad() === 'clientes' ? this.clientes().length > 0 : !!this.destino().nombre || this.destino().lat !== undefined);
  textoDestino = '';
  nuevo: ClienteParada = vacioCliente();

  private contenedor = viewChild<ElementRef<HTMLDivElement>>('mapa');
  private mapa: L.Map | null = null;
  private marcador: L.Marker | null = null;

  // rastreo: el actual del viaje si se van a cambiar sus paradas
  abrir(viaje: any, rastreo?: any) {
    this.viaje.set(viaje);
    this.editando.set(!!rastreo?.activo);
    this.modalidad.set(rastreo?.modalidad === 'clientes' ? 'clientes' : 'destino');
    const d = rastreo?.destino?.nombre ? rastreo.destino : { nombre: viaje.destino };
    this.destino.set({ nombre: d.nombre || '', lat: d.lat ?? undefined, lng: d.lng ?? undefined });
    this.textoDestino = d.nombre || '';
    this.clientes.set((rastreo?.clientes || []).map((c: any) => ({ ...vacioCliente(), ...c })));
    this.resultados.set([]); this.nuevo = vacioCliente();
    this.abierto.set(true);
    if (this.modalidad() === 'destino') {
      this.iniciarMapa();
      if (this.destino().lat === undefined && this.textoDestino) this.buscarDestino(true);
    }
  }
  cerrar() { this.abierto.set(false); this.mapa?.remove(); this.mapa = null; this.marcador = null; }

  cambiarModalidad(m: Modalidad) {
    this.modalidad.set(m);
    if (m === 'destino') this.iniciarMapa(); else { this.mapa?.remove(); this.mapa = null; this.marcador = null; }
  }

  private iniciarMapa() {
    setTimeout(() => {
      const el = this.contenedor()?.nativeElement;
      if (!el || this.mapa) return;
      this.mapa = L.map(el).setView(PASTO, 8);
      setTimeout(() => this.mapa?.invalidateSize(), 250);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(this.mapa);
      this.mapa.on('click', (e: L.LeafletMouseEvent) => {
        this.destino.update(d => ({ nombre: d.nombre || this.textoDestino || 'Punto en el mapa', lat: e.latlng.lat, lng: e.latlng.lng }));
        this.pintarDestino(false);
      });
      this.pintarDestino(true);
    }, 50);
  }

  private pintarDestino(centrar: boolean) {
    const d = this.destino();
    if (!this.mapa || d.lat === undefined || d.lng === undefined) return;
    const pos: L.LatLngTuple = [d.lat, d.lng];
    const icono = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 26],
      html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#d63939;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>' });
    if (this.marcador) this.marcador.setLatLng(pos);
    else this.marcador = L.marker(pos, { icon: icono, draggable: true }).addTo(this.mapa)
      .on('dragend', () => { const p = this.marcador!.getLatLng(); this.destino.update(x => ({ ...x, lat: p.lat, lng: p.lng })); });
    if (centrar) this.mapa.setView(pos, 12);
  }

  async buscarDestino(elegirPrimero = false) {
    const q = this.textoDestino.trim();
    if (q.length < 3) return;
    this.buscando.set(true);
    try {
      const r = await this.api.get<any[]>('/rastreo/geocodificar', { q });
      this.resultados.set(elegirPrimero ? [] : r);
      if (elegirPrimero && r[0]) this.elegirResultado(r[0], q);
      else if (!r.length) this.avisos.mostrar('No se encontró ese lugar: escriba otro nombre o toque el mapa', 'info');
    } catch (e) { this.avisos.error(e); }
    finally { this.buscando.set(false); }
  }
  elegirResultado(r: { nombre: string; lat: number; lng: number }, nombre?: string) {
    this.destino.set({ nombre: nombre || r.nombre.split(',').slice(0, 2).join(','), lat: r.lat, lng: r.lng });
    this.resultados.set([]);
    this.pintarDestino(true);
  }

  agregar() {
    if (!this.nuevo.nombre.trim()) return;
    this.clientes.update(l => [...l, { ...this.nuevo, nombre: this.nuevo.nombre.trim() }]);
    this.nuevo = vacioCliente();
    setTimeout(() => document.getElementById('ar-cn')?.focus(), 20);
  }
  quitar(i: number) { this.clientes.update(l => l.filter((_, j) => j !== i)); }

  async importar(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    this.importando.set(true);
    try {
      const r = await this.api.subir<any>('/rastreo/clientes/importar', archivo);
      this.clientes.update(l => [...l, ...r.clientes.map((c: any) => ({ ...vacioCliente(), ...c }))]);
      this.avisos.ok(`${r.clientes.length} cliente(s) importados${r.omitidas ? ` · ${r.omitidas} fila(s) vacías omitidas` : ''}`);
    } catch (e) { this.avisos.error(e); }
    finally { this.importando.set(false); }
  }
  plantilla() { this.api.descargar('/rastreo/clientes/plantilla', {}, 'plantilla_clientes_viaje.xlsx').catch(e => this.avisos.error(e)); }

  async guardar() {
    const v = this.viaje();
    const cuerpo = { modalidad: this.modalidad(), destino: this.destino(), clientes: this.modalidad() === 'clientes' ? this.clientes() : [] };
    this.guardando.set(true);
    try {
      const r = this.editando() ? await this.api.put<any>(`/rastreo/viajes/${v._id}/paradas`, cuerpo) : await this.api.post<any>(`/rastreo/viajes/${v._id}/activar`, cuerpo);
      this.avisos.ok(this.editando() ? 'Cambios enviados a Sur Track' : 'Rastreo activado: el conductor ya lo ve en Sur Track');
      this.cerrar();
      this.listo.emit(r);
    } catch (e) { this.avisos.error(e); }
    finally { this.guardando.set(false); }
  }
}
