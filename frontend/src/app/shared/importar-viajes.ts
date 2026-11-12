import { Paginador } from './paginador';
import { PaginaLocal } from './pagina-local';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { BuscarTercero } from './buscar-tercero';
import { DiaPipe, PesosPipe } from './formato';

// Una fila del archivo tal como la propone el servidor, más lo que el usuario decide aquí
interface Fila {
  fila: number; hoja: string; estado: 'lista' | 'revisar' | 'repetida' | 'error';
  fecha: string; cliente: string | null; clienteNombre: string; placa: string; conductor: string | null; conductorNombre: string;
  tarifaRef: string | null; destino: string; cantidad: number; planilla: string; tarifa: number; flete: number; anticipo: number;
  diasAuxiliar: number; auxiliarPagado: boolean; requiereManifiesto: boolean; observaciones: string;
  escrito: { conductor: string; destino: string; cliente: string };
  errores: string[]; avisos: string[]; repetidos: string[]; errorConductor: string; errorDestino: string;
  opcionesConductor: { _id: string; nombre: string; numId: string }[];
  incluir: boolean; corregido?: boolean; completarDeTarifa?: boolean;
}

// Importar viajes desde Excel como si se hubieran registrado: revisar (sin guardar) → aprobar fila por fila → registrar.
@Component({
  selector: 'app-importar-viajes',
  imports: [FormsModule, Modal, Icono, BuscarTercero, DiaPipe, PesosPipe, Paginador],
  template: `
    <app-modal titulo="Importar viajes desde Excel" [abierto]="abierto()" (cerrar)="cerrar.emit()" [ancho]="true">
      @if (!filas().length && !resultado()) {
        <ol class="pasos">
          <li>Use la plantilla o suba la relación de fletes del cliente tal como está (con columnas Fecha, Placa, Transportador, Destino…).
            <button class="pequeno" type="button" (click)="plantilla()"><app-icono nombre="descargar" [tam]="15" />Plantilla de viajes</button></li>
          <li><div class="opciones">
            <div class="campo"><label for="iv-cli">Cliente (si el archivo no trae la columna Cliente)</label>
              <select id="iv-cli" [(ngModel)]="cliente"><option value="">— Elegir —</option>
                @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
            <div class="campo"><label for="iv-man">¿Llevan manifiesto del RNDC?</label>
              <select id="iv-man" [(ngModel)]="manifiesto"><option [ngValue]="true">Sí, se expide en el RNDC</option><option [ngValue]="false">No, con soporte interno (urbanos)</option></select></div>
            <div class="campo"><label for="iv-aux">Auxiliar de los viajes</label>
              <select id="iv-aux" [(ngModel)]="auxPagado"><option [ngValue]="true">Ya se pagó al conductor</option><option [ngValue]="false">Pendiente de pago</option></select></div>
          </div></li>
          <li>Elija el archivo y revíselo. <strong>Revisar no guarda nada.</strong>
            <input type="file" accept=".xlsx,.xlsm" (change)="elegir($event)" aria-label="Archivo de Excel con los viajes" /></li>
        </ol>
      }

      @if (filas().length && !resultado()) {
        <div class="resumen">
          <button type="button" [class.activo]="filtro() === ''" (click)="filtro.set('')"><span>Todas</span><strong>{{ filas().length }}</strong></button>
          <button type="button" class="ok" [class.activo]="filtro() === 'lista'" (click)="filtro.set('lista')"><span>Listas</span><strong>{{ cuenta('lista') }}</strong></button>
          <button type="button" class="alerta" [class.activo]="filtro() === 'revisar'" (click)="filtro.set('revisar')"><span>Para aprobar</span><strong>{{ cuenta('revisar') }}</strong></button>
          <button type="button" class="alerta" [class.activo]="filtro() === 'repetida'" (click)="filtro.set('repetida')"><span>Ya subidas</span><strong>{{ cuenta('repetida') }}</strong></button>
          <button type="button" class="error" [class.activo]="filtro() === 'error'" (click)="filtro.set('error')"><span>Con error</span><strong>{{ cuenta('error') }}</strong></button>
        </div>
        <div class="opciones-revision">
          <div class="campo"><label for="ivr-man">¿Llevan manifiesto del RNDC?</label>
            <select id="ivr-man" [ngModel]="manifiesto" (ngModelChange)="cambiarManifiesto($event)">
              <option [ngValue]="true">Sí, se expide en el RNDC</option><option [ngValue]="false">No, con soporte interno (urbanos)</option></select></div>
          <div class="campo"><label for="ivr-aux">Auxiliar de los viajes</label>
            <select id="ivr-aux" [ngModel]="auxPagado" (ngModelChange)="cambiarAuxiliar($event)">
              <option [ngValue]="true">Ya se pagó al conductor</option><option [ngValue]="false">Pendiente de pago</option></select></div>
        </div>
        <p class="sutil">Las <strong>listas</strong> ya van marcadas. Las que tienen <strong>correcciones</strong> o <strong>ya están subidas</strong> solo se suben si las marca.
          En las que tienen error elija el conductor o el destino; los demás errores se corrigen en el archivo.</p>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th><input type="checkbox" aria-label="Marcar todas las que se pueden subir" [checked]="todasMarcadas()" (change)="marcarTodas($any($event.target).checked)" /></th>
            <th>Fila</th><th>Fecha</th><th>Placa</th><th>Conductor</th><th>Destino</th><th>Planilla</th><th class="num">Tarifa</th><th class="num">Flete conductor</th><th class="num">Anticipo</th><th class="num">Aux.</th><th>Documento</th><th>Revisión</th></tr></thead>
          <tbody>@for (f of pagFilas.items(); track f.fila) {
            <tr [class.apagada]="!f.incluir">
              <td data-etiqueta="Subir"><input type="checkbox" [checked]="f.incluir" [disabled]="!sePuede(f)" (change)="alternar(f, $any($event.target).checked)" [attr.aria-label]="'Subir la fila ' + f.fila" /></td>
              <td data-etiqueta="Fila">{{ f.fila }}</td>
              <td data-etiqueta="Fecha">{{ f.fecha ? (f.fecha | dia) : '—' }}</td>
              <td data-etiqueta="Placa"><strong>{{ f.placa }}</strong></td>
              <td data-etiqueta="Conductor">
                @if (f.conductor) { {{ f.conductorNombre }} }
                @else { <div class="corregir"><small class="error-texto">{{ f.errorConductor }}</small>
                  @if (f.opcionesConductor.length) { <select [ngModel]="''" (ngModelChange)="ponerConductor(f, $event)" [attr.aria-label]="'Conductor de la fila ' + f.fila">
                    <option value="">Posibles…</option>@for (o of f.opcionesConductor; track o._id) { <option [value]="o._id">{{ o.nombre }} · {{ o.numId }}</option> }</select> }
                  <app-buscar-tercero rol="conductor" [conPlacas]="true" placeholder="Buscar conductor" (elegido)="ponerConductor(f, $event?._id, $event)" /></div> }
              </td>
              <td data-etiqueta="Destino">
                @if (f.tarifaRef) { {{ f.destino }} }
                @else if (f.cliente) { <div class="corregir"><small class="error-texto">{{ f.errorDestino }}</small>
                  <select [ngModel]="''" (ngModelChange)="ponerDestino(f, $event)" [attr.aria-label]="'Destino de la fila ' + f.fila"><option value="">Elegir destino…</option>
                    @for (t of tarifasDe(f.cliente); track t._id) { <option [value]="t._id">{{ t.destino }}</option> }</select></div> }
                @else { {{ f.escrito.destino }} }
              </td>
              <td data-etiqueta="Planilla">{{ f.planilla || '—' }}</td>
              <td data-etiqueta="Tarifa" class="num">{{ f.tarifa | pesos }}</td>
              <td data-etiqueta="Flete conductor" class="num"><strong>{{ f.flete | pesos }}</strong></td>
              <td data-etiqueta="Anticipo" class="num">{{ f.anticipo | pesos }}</td>
              <td data-etiqueta="Aux." class="num">{{ f.diasAuxiliar ? f.diasAuxiliar + ' d' : '—' }}@if (f.diasAuxiliar && f.auxiliarPagado) { <br /><small class="pagado">Pagado</small> }</td>
              <td data-etiqueta="Documento">{{ f.requiereManifiesto ? 'Manifiesto RNDC' : 'Soporte interno' }}</td>
              <td data-etiqueta="Revisión" class="revision">
                @switch (f.estado) {
                  @case ('lista') { <span class="chip ok sin-punto">Lista</span> }
                  @case ('revisar') { <span class="chip alerta sin-punto">Aprobar</span> }
                  @case ('repetida') { <span class="chip alerta sin-punto">Ya subida</span> }
                  @default { <span class="chip error sin-punto">{{ f.corregido ? 'Corregida' : 'Error' }}</span> }
                }
                @for (e of f.errores; track e) { <div class="error-texto">{{ e }}</div> }
                @for (r of f.repetidos; track r) { <div>Ya existe: {{ r }}</div> }
                @for (a of f.avisos; track a) { <div class="sutil">{{ a }}</div> }
              </td>
            </tr>
          }</tbody>
        </table>
        <app-paginador [total]="pagFilas.total()" [pagina]="pagFilas.pagina()" [porPagina]="pagFilas.porPagina()" unidad="filas" (cambio)="pagFilas.ir($event)" /></div>
      }

      @if (resultado(); as r) {
        <div class="mensaje" [class.ok]="!r.fallidos.length" [class.alerta]="r.fallidos.length">
          Se registraron {{ r.creados.length }} viaje(s){{ r.creados.length ? ' (N° ' + r.creados[0].numero + (r.creados.length > 1 ? ' al ' + r.creados[r.creados.length - 1].numero : '') + ')' : '' }}.
          @if (r.fallidos.length) { {{ r.fallidos.length }} no se pudieron registrar. }
        </div>
        @if (r.fallidos.length) {
          <div class="tabla-caja" style="margin-top:10px"><table><thead><tr><th>Fila</th><th>Motivo</th></tr></thead>
            <tbody>@for (x of r.fallidos; track x.fila) { <tr><td>{{ x.fila }}</td><td>{{ x.error }}</td></tr> }</tbody></table></div>
        }
      }

      <ng-container pie>
        <button type="button" (click)="cerrar.emit()">Cerrar</button>
        @if (!filas().length && !resultado()) { <button type="button" class="primario" (click)="revisar()" [disabled]="!archivo() || trabajando()">{{ trabajando() ? 'Revisando…' : 'Revisar' }}</button> }
        @if (filas().length && !resultado()) {
          <button type="button" (click)="reiniciar()" [disabled]="trabajando()">Otro archivo</button>
          <button type="button" class="primario" (click)="registrar()" [disabled]="!elegidas().length || trabajando()">{{ trabajando() ? 'Registrando…' : 'Registrar ' + elegidas().length + ' viaje(s)' }}</button>
        }
        @if (resultado()) { <button type="button" class="primario" (click)="reiniciar()">Importar otro archivo</button> }
      </ng-container>
    </app-modal>`,
  styles: [`
    .pasos { padding-left: 18px; display: flex; flex-direction: column; gap: 14px; margin: 0 0 6px; } .pasos li > button, .pasos li > input { margin-top: 6px; display: flex; }
    .opciones { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
    .resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-bottom: 10px; }
    .resumen button { display: grid; gap: 2px; text-align: left; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--gris-2); background: var(--gris-0); box-shadow: none; min-height: 0; font-weight: 400; }
    .resumen button.activo { border-color: var(--gris-8); box-shadow: inset 0 0 0 1px var(--gris-8); }
    .resumen span { font-size: 12px; color: var(--gris-5); } .resumen strong { font-size: 20px; font-variant-numeric: tabular-nums; }
    .resumen .ok strong { color: var(--verde, #2E7D32); } .resumen .alerta strong { color: #B26A00; } .resumen .error strong { color: var(--rojo); }
    .tabla-caja { max-height: 52vh; overflow: auto; box-shadow: none; }
    tr.apagada td { opacity: .62; } tr.apagada td:first-child, tr.apagada td.revision { opacity: 1; }
    .revision { min-width: 220px; font-size: 12.5px; } .revision > div { margin-top: 3px; line-height: 1.35; }
    .opciones-revision { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin-bottom: 8px; }
    .error-texto { color: var(--rojo); } .pagado { color: var(--verde, #2E7D32); font-weight: 650; }
    .corregir { display: grid; gap: 4px; min-width: 230px; } .corregir select { width: 100%; }
  `],
})
export class ImportarViajes {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly clientes = signal<any[]>([]);
  readonly archivo = signal<File | null>(null);
  readonly filas = signal<Fila[]>([]);
  readonly tarifas = signal<Record<string, { _id: string; destino: string; tarifa: number; flete: number; anticipo: number }[]>>({});
  readonly filtro = signal<'' | Fila['estado']>('');
  readonly trabajando = signal(false);
  readonly resultado = signal<{ creados: any[]; fallidos: any[] } | null>(null);
  cliente = '';
  manifiesto = true;
  auxPagado = true;

  readonly visibles = computed(() => (this.filtro() ? this.filas().filter(f => f.estado === this.filtro()) : this.filas()));
  // Filas del Excel por páginas en pantalla (cada fila tiene campos editables: dibujar cientos a la vez es lento)
  readonly pagFilas = new PaginaLocal<Fila>(() => this.visibles(), { reiniciarCon: () => this.filtro() });
  readonly elegidas = computed(() => this.filas().filter(f => f.incluir && this.sePuede(f)));

  async ngOnInit() {
    try { this.clientes.set((await this.api.get<any[]>('/maestros/clientes')).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))); } catch (e) { this.avisos.error(e); }
  }
  cuenta(e: Fila['estado']) { return this.filas().filter(f => f.estado === e).length; }
  tarifasDe(c: string) { return this.tarifas()[c] || []; }
  // Se puede subir si no le queda ningún error (los de conductor y destino se corrigen aquí)
  sePuede(f: Fila) { return !f.errores.length && !!f.conductor && !!f.tarifaRef && !!f.cliente && !!f.fecha; }
  todasMarcadas() { const v = this.visibles().filter(f => this.sePuede(f)); return !!v.length && v.every(f => f.incluir); }

  plantilla() { this.api.descargar('/importaciones/viajes/plantilla', undefined, 'Plantilla_viajes.xlsx').catch(e => this.avisos.error(e)); }
  elegir(ev: Event) { this.archivo.set((ev.target as HTMLInputElement).files?.[0] || null); }
  reiniciar() { this.filas.set([]); this.resultado.set(null); this.archivo.set(null); this.filtro.set(''); }

  async revisar() {
    const a = this.archivo(); if (!a) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.subir<any>('/importaciones/viajes/analizar', a, { cliente: this.cliente, manifiesto: this.manifiesto ? '1' : '0', auxiliarPagado: this.auxPagado ? '1' : '0' });
      this.tarifas.set(r.tarifasPorCliente || {});
      this.filas.set(r.filas.map((f: any) => ({ ...f, incluir: f.estado === 'lista' })));
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  private actualizar(f: Fila, cambios: Partial<Fila>) {
    this.filas.update(l => l.map(x => (x.fila === f.fila ? this.estadoDe({ ...x, ...cambios }) : x)));
  }
  // Tras corregir el conductor o el destino, la fila queda «para aprobar» (o «ya subida»), marcada porque la eligió el usuario
  private estadoDe(f: Fila): Fila {
    if (f.estado !== 'error' || !this.sePuede(f)) return f;
    return { ...f, estado: f.repetidos.length ? 'repetida' : 'revisar', corregido: true, incluir: !f.repetidos.length };
  }
  // Se cambian en la revisión para todos los viajes del archivo
  cambiarManifiesto(v: boolean) { this.manifiesto = v; this.filas.update(l => l.map(x => ({ ...x, requiereManifiesto: v }))); }
  cambiarAuxiliar(v: boolean) { this.auxPagado = v; this.filas.update(l => l.map(x => ({ ...x, auxiliarPagado: v }))); }
  alternar(f: Fila, v: boolean) { this.actualizar(f, { incluir: v }); }
  marcarTodas(v: boolean) {
    const ids = new Set(this.visibles().filter(f => this.sePuede(f)).map(f => f.fila));
    this.filas.update(l => l.map(x => (ids.has(x.fila) ? { ...x, incluir: v } : x)));
  }
  ponerConductor(f: Fila, id: string, t?: any) {
    if (!id) return;
    const nombre = t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : f.opcionesConductor.find(o => o._id === id)?.nombre || '';
    this.actualizar(f, { conductor: id, conductorNombre: nombre, avisos: [...f.avisos, `Conductor elegido a mano: ${nombre}`] });
  }
  ponerDestino(f: Fila, id: string) {
    const t = this.tarifasDe(f.cliente || '').find(x => x._id === id); if (!t) return;
    // Flete y anticipo de esa tarifa (la base de tarifas y fletes); la tarifa, la del archivo si la trae
    this.actualizar(f, { tarifaRef: id, destino: t.destino, flete: t.flete, anticipo: t.anticipo, tarifa: f.tarifa || t.tarifa, completarDeTarifa: true,
      avisos: [...f.avisos, `Destino elegido a mano: ${t.destino}`] });
  }

  async registrar() {
    const l = this.elegidas(); if (!l.length) return;
    const repetidas = l.filter(f => f.repetidos.length).length;
    if (!confirm(`¿Registrar ${l.length} viaje(s) con su fecha?${repetidas ? `\n${repetidas} ya estaban subidos y se subirán otra vez.` : ''}`)) return;
    this.trabajando.set(true);
    try {
      const filas = l.map(f => ({ fila: f.fila, fecha: f.fecha, cliente: f.cliente, tarifaRef: f.tarifaRef, conductor: f.conductor, placa: f.placa, cantidad: f.cantidad,
        planilla: f.planilla, tarifa: f.tarifa, flete: f.flete, anticipo: f.anticipo, diasAuxiliar: f.diasAuxiliar, auxiliarPagado: f.auxiliarPagado,
        requiereManifiesto: f.requiereManifiesto, observaciones: f.observaciones, confirmarRepetido: f.repetidos.length > 0, completarDeTarifa: !!f.completarDeTarifa }));
      this.resultado.set(await this.api.post<any>('/importaciones/viajes/registrar', { filas, archivo: this.archivo()?.name || '' }));
      if (this.resultado()!.creados.length) this.avisos.ok(`${this.resultado()!.creados.length} viaje(s) registrados`);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
