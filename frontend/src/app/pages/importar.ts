import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from '../shared/modal';
import { BuscarTercero } from '../shared/buscar-tercero';
import { DiaPipe } from '../shared/formato';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { ImportarExcel } from '../shared/importar-excel';

type Tipo = 'terceros' | 'vehiculos' | 'tarifas';

// Un solo lugar para todas las cargas desde Excel. Cada opción usa la misma importación
// que antes estaba en su página (simular, ver errores por fila y aplicar).
@Component({
  selector: 'app-importar',
  imports: [RouterLink, Icono, ImportarExcel, Modal, BuscarTercero, DiaPipe],
  template: `
    <div class="pagina-cab">
      <div><h1>Importar datos</h1>
        <p>Cargue información en bloque desde Excel. Antes de guardar se muestra qué se va a crear o actualizar y los errores de cada fila.</p></div>
    </div>

    <div class="opciones">
      @if (puedeMaestros) {
        <button type="button" class="opcion" (click)="abierto.set('terceros')">
          <span class="ico"><app-icono nombre="personas" [tam]="20" /></span>
          <span class="txt"><strong>Conductores y terceros</strong><small>Conductores, titulares, propietarios, tenedores y empresas con sus sedes.</small></span>
          <span class="ir">Elegir archivo</span></button>
        <button type="button" class="opcion" (click)="abierto.set('vehiculos')">
          <span class="ico"><app-icono nombre="camion" [tam]="20" /></span>
          <span class="txt"><strong>Vehículos</strong><small>Placas, remolques, SOAT, tecnomecánica, propietario y tenedor.</small></span>
          <span class="ir">Elegir archivo</span></button>
      }
      @if (puedeTarifas) {
        <button type="button" class="opcion" (click)="abierto.set('tarifas')">
          <span class="ico"><app-icono nombre="edificio" [tam]="20" /></span>
          <span class="txt"><strong>Clientes y tarifas</strong><small>Clientes, destinos, tarifas, fletes y anticipos habituales.</small></span>
          <span class="ir">Elegir archivo</span></button>
      }
      @if (puedePlantilla) {
        <a class="opcion" routerLink="/configuracion" [queryParams]="{ tab: 'importar' }">
          <span class="ico"><app-icono nombre="lista" [tam]="20" /></span>
          <span class="txt"><strong>Plantilla completa de viajes</strong><small>El libro de Excel de la operación: viajes históricos, conductores y vehículos a la vez.</small></span>
          <span class="ir">Abrir</span></a>
        <button type="button" class="opcion" (click)="abrirCompletar()">
          <span class="ico"><app-icono nombre="lista" [tam]="20" /></span>
          <span class="txt"><strong>Completar viajes importados</strong><small>Vincula el conductor, el titular y la tarifa que les faltan a los viajes que vinieron del Excel. Solo llena lo vacío.</small></span>
          <span class="ir">Revisar</span></button>
      }
    </div>

    <app-modal titulo="Completar viajes importados" [abierto]="completarAbierto()" (cerrar)="completarAbierto.set(false)" [ancho]="true">
      @if (revisando()) { <p>Revisando los viajes…</p> }
      @else if (resultado(); as r) {
        <p class="sutil">Se revisaron <strong>{{ r.revisados }}</strong> viajes con algún dato vacío. Solo se llena lo que está vacío; lo que ya tiene cada viaje no se cambia.</p>
        <div class="resumen">
          <div><span>Conductor</span><strong>{{ r.cambios.conductor }}</strong></div>
          <div><span>Titular</span><strong>{{ r.cambios.titular }}</strong></div>
          <div><span>Tarifa</span><strong>{{ r.cambios.tarifa }}</strong></div>
          <div><span>DIVIPOLA destino</span><strong>{{ r.cambios.codDestino }}</strong></div>
        </div>
        @if (r.aplicado) { <div class="mensaje ok">Listo: se completaron {{ r.viajesConCambios }} viajes.</div> }
        @else if (r.viajesConCambios) { <p>{{ r.viajesConCambios }} viajes se pueden completar automáticamente.</p> }

        @if (pendientesConductor().length) {
          <h3>Sin conductor encontrado ({{ pendientesConductor().length }})</h3>
          <p class="sutil">El nombre escrito en el Excel no coincide con nadie de Conductores y terceros (o coincide con varios). Elíjalo una vez por viaje.</p>
          <div class="tabla-caja"><table class="tabla-movil">
            <thead><tr><th>N°</th><th>Fecha</th><th>Placa</th><th>Escrito en el Excel</th><th>Conductor</th></tr></thead>
            <tbody>@for (p of pendientesConductor(); track p._id) {
              <tr><td data-etiqueta="N°">{{ p.numero }}</td><td data-etiqueta="Fecha">{{ p.fecha | dia }}</td><td data-etiqueta="Placa">{{ p.placa }}</td>
                <td data-etiqueta="Escrito">{{ p.conductorNombre || '—' }}
                  @if (p.opciones?.length) { <br /><small class="sutil">Posibles: {{ nombresOpciones(p) }}</small> }</td>
                <td data-etiqueta="Conductor" class="elegir">
                  @if (hechos().has(p._id)) { <span class="chip ok sin-punto">Guardado</span> }
                  @else { <div class="fila-elegir"><app-buscar-tercero rol="conductor" [conPlacas]="true" (elegido)="elegir(p, $event)" />
                    <button type="button" class="primario" [disabled]="!elegidos()[p._id]" (click)="ponerConductor(p)">Guardar</button></div> }</td></tr>
            }</tbody>
          </table></div>
        }
        @if (pendientesTarifa().length) {
          <h3>Sin tarifa ({{ pendientesTarifa().length }})</h3>
          <p class="sutil">El destino escrito no está en Clientes y tarifas de ese cliente. Si se cobran con tarifa, cree el destino o corrija el viaje: {{ resumenTarifas() }}</p>
        }
      }
      <div pie>
        <button type="button" (click)="completarAbierto.set(false)">Cerrar</button>
        @if (resultado(); as r) { @if (!r.aplicado && r.viajesConCambios) {
          <button type="button" class="primario" [disabled]="revisando()" (click)="completar(true)">Completar {{ r.viajesConCambios }} viajes</button> } }
      </div>
    </app-modal>

    @if (abierto(); as t) {
      <app-importar-excel [tipo]="t" [titulo]="TITULOS[t]" [abierto]="true" (cerrar)="abierto.set(null)" (importado)="abierto.set(null)" />
    }`,
  styles: [`
    .opciones { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
    .opcion { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; gap: 4px 14px; align-items: start; text-align: left; white-space: normal;
      padding: 18px; min-height: 0; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); color: var(--gris-8); text-decoration: none;
      font-weight: 400; box-shadow: none; }
    .opcion:hover:not(:disabled) { border-color: var(--primario-borde); background: var(--gris-0); box-shadow: var(--sombra-2); }
    .ico { grid-row: span 2; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--primario-claro); color: var(--primario-texto); }
    .txt { display: flex; flex-direction: column; gap: 3px; } .txt strong { font-size: 15px; } .txt small { color: var(--gris-5); font-size: 13px; line-height: 1.45; }
    .resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 12px 0; }
    .resumen div { border: 1px solid var(--gris-2); border-radius: 12px; padding: 10px 12px; display: grid; gap: 2px; }
    .resumen span { font-size: 12px; color: var(--gris-5); } .resumen strong { font-size: 20px; font-variant-numeric: tabular-nums; }
    h3 { margin: 18px 0 4px; font-size: 15px; } td.elegir { min-width: 320px; } .fila-elegir { display: flex; gap: 8px; align-items: end; } .fila-elegir app-buscar-tercero { flex: 1; min-width: 0; }
    .ir { grid-column: 2; margin-top: 6px; font-size: 13px; font-weight: 700; color: var(--primario-texto); }
  `],
})
export class Importar {
  private auth = inject(Auth);
  readonly puedeMaestros = this.auth.tiene(P.MAESTROS_EDITAR);
  readonly puedeTarifas = this.auth.tiene(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);
  readonly puedePlantilla = this.auth.tiene(P.CONFIG_GESTIONAR);
  readonly abierto = signal<Tipo | null>(null);
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly completarAbierto = signal(false);
  readonly revisando = signal(false);
  readonly resultado = signal<any>(null);
  readonly hechos = signal(new Set<string>());
  readonly elegidos = signal<Record<string, any>>({});
  elegir(p: any, t: any) { this.elegidos.update(m => ({ ...m, [p._id]: t })); }
  pendientesConductor() { return (this.resultado()?.pendientes || []).filter((p: any) => p.falta.includes('conductor')); }
  pendientesTarifa() { return (this.resultado()?.pendientes || []).filter((p: any) => p.falta.includes('tarifa')); }
  nombresOpciones(p: any) { return p.opciones.map((o: any) => o.nombre).join(' · '); }
  resumenTarifas() {
    const c = new Map<string, number>();
    for (const p of this.pendientesTarifa()) c.set(p.destino || '(sin destino)', (c.get(p.destino || '(sin destino)') || 0) + 1);
    return [...c].map(([d, n]) => `${d}${n > 1 ? ` (${n})` : ''}`).join(', ');
  }
  abrirCompletar() { this.completarAbierto.set(true); this.hechos.set(new Set()); this.completar(false); }
  async completar(aplicar: boolean) {
    this.revisando.set(true);
    try { this.resultado.set(await this.api.post<any>(`/importaciones/completar-viajes${aplicar ? '?aplicar=1' : ''}`, {})); if (aplicar) this.avisos.ok('Viajes completados'); }
    catch (e) { this.avisos.error(e); } finally { this.revisando.set(false); }
  }
  async ponerConductor(p: any) {
    const t = this.elegidos()[p._id];
    if (!t?._id) return;
    if (!confirm(`¿El conductor del viaje ${p.numero} (${p.placa}) es ${[t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ')}?`)) return;
    try {
      await this.api.post(`/importaciones/completar-viajes/${p._id}/conductor`, { conductor: t._id });
      const s = new Set(this.hechos()); s.add(p._id); this.hechos.set(s);
    } catch (e) { this.avisos.error(e); }
  }
  readonly TITULOS: Record<Tipo, string> = { terceros: 'conductores y terceros', vehiculos: 'vehículos', tarifas: 'clientes y tarifas' };
}
