import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Confirmar } from './confirmar';

interface Relaciones { viajes: number; radicados: number; titular: number; conductorHabitual: number; propietario: number; tenedor: number; prestamos: number; liquidaciones: number; whatsapp: number; sst: number; ultimoViaje: string | null }
interface Registro { _id: string; tipoId: string; numId: string; nombre: string; celular: string; licencia: string; roles: string[]; activo: boolean; rndc: string; creado: string; relaciones: Relaciones }
interface Grupo { motivo: 'mismo_documento' | 'mismo_nombre' | 'documento_compartido'; certeza: 'alta' | 'media' | 'baja' | 'revisar'; sugerido: string; registros: Registro[] }
interface Resultado { terceros: Grupo[]; vehiculos: { placas: string[] }[]; revisados: { personas: number; vehiculos: number }; nombresConApellidos: { _id: string; numId: string; actual: string; sugerido: string; apellidos: string }[] }

const MOTIVO = { mismo_documento: 'Mismo documento escrito distinto', mismo_nombre: 'Mismo nombre, documento casi igual', documento_compartido: 'Dos personas con el mismo documento' };
const CERTEZA = { alta: 'Muy probable', media: 'Probable', baja: 'Revisar con cuidado', revisar: 'No unir: corregir' };

// Revisión de conductores y terceros repetidos. Solo muestra y, con confirmación del administrador, une:
// las relaciones pasan al registro que se conserva y el otro queda archivado (no se borra).
@Component({
  selector: 'app-duplicados-terceros',
  imports: [Modal, Confirmar, DatePipe, DecimalPipe],
  template: `
    <app-modal titulo="Registros repetidos" [abierto]="abierto()" (cerrar)="cerrar.emit()" [ancho]="true">
      @if (cargando()) { <p class="sutil">Revisando conductores, terceros y vehículos…</p> }
      @else if (r(); as x) {
        <p class="sutil">Se revisaron {{ x.revisados.personas | number }} personas y {{ x.revisados.vehiculos | number }} vehículos.
          Nada se une ni se borra sin su confirmación. Al unir, los viajes, vehículos, préstamos, liquidaciones y demás pasan al registro que se conserva;
          el otro queda archivado. Los manifiestos ya radicados en el RNDC no cambian (su PDF y lo enviado quedan como se radicaron).</p>

        <div class="pestanas">
          <button type="button" [class.activa]="vista() === 'personas'" (click)="vista.set('personas')">Personas repetidas ({{ pendientes().length }})</button>
          <button type="button" [class.activa]="vista() === 'nombres'" (click)="vista.set('nombres')">Nombres con apellidos repetidos ({{ x.nombresConApellidos.length }})</button>
          <button type="button" [class.activa]="vista() === 'vehiculos'" (click)="vista.set('vehiculos')">Vehículos ({{ x.vehiculos.length }})</button>
        </div>

        @switch (vista()) {
          @case ('personas') {
            @for (g of pendientes(); track g.registros[0]._id) {
              <section class="grupo" [class.revisar]="g.motivo === 'documento_compartido'">
                <header><strong>{{ motivo(g) }}</strong> <span class="chip sin-punto" [class]="claseCerteza(g)">{{ certeza(g) }}</span></header>
                @if (g.motivo === 'documento_compartido') {
                  <p class="sutil">Son personas distintas con el mismo documento: a una le digitaron mal el documento. Corríjalo en su ficha; no se unen.</p>
                }
                <div class="tabla-caja"><table>
                  <thead><tr>@if (g.motivo !== 'documento_compartido') { <th>Conservar</th> }<th>Documento</th><th>Nombre</th><th>RNDC</th>
                    <th class="num" title="Viajes como conductor (con manifiesto radicado)">Viajes</th><th class="num">Titular</th><th class="num" title="Vehículos como habitual, propietario o tenedor">Vehículos</th>
                    <th class="num" title="Préstamos y liquidaciones">Pagos</th><th>Último viaje</th></tr></thead>
                  <tbody>@for (t of g.registros; track t._id) {
                    <tr [class.elegido]="conservar(g) === t._id">
                      @if (g.motivo !== 'documento_compartido') { <td><input type="radio" [name]="'c' + g.registros[0]._id" [checked]="conservar(g) === t._id" (change)="elegir(g, t._id)" [attr.aria-label]="'Conservar ' + t.numId" /></td> }
                      <td>{{ t.tipoId }} {{ t.numId }}</td>
                      <td>{{ t.nombre }}@if (t.celular) { <br /><span class="sutil">{{ t.celular }}</span> }</td>
                      <td><span class="chip sin-punto" [class.ok]="t.rndc === 'registrado'">{{ t.rndc === 'registrado' ? 'registrado' : t.rndc === 'importado' ? 'importado' : 'sin registrar' }}</span></td>
                      <td class="num">{{ t.relaciones.viajes }}@if (t.relaciones.radicados) { <span class="sutil"> ({{ t.relaciones.radicados }})</span> }</td>
                      <td class="num">{{ t.relaciones.titular }}</td>
                      <td class="num">{{ t.relaciones.conductorHabitual + t.relaciones.propietario + t.relaciones.tenedor }}</td>
                      <td class="num">{{ t.relaciones.prestamos + t.relaciones.liquidaciones }}</td>
                      <td>{{ t.relaciones.ultimoViaje ? (t.relaciones.ultimoViaje | date: 'dd/MM/yyyy') : '—' }}</td>
                    </tr>
                  }</tbody>
                </table></div>
                @if (g.motivo !== 'documento_compartido') {
                  <div class="unir">
                    <span class="sutil">Se conserva <strong>{{ nombreDe(g, conservar(g)) }}</strong>; {{ g.registros.length - 1 === 1 ? 'el otro queda archivado' : 'los otros quedan archivados' }}.</span>
                    @if (puedeUnir()) {
                      <button type="button" class="primario pequeno" confirmar="Clic otra vez para unir" (confirmado)="unir(g)" [disabled]="trabajando()">Unir</button>
                    } @else { <span class="sutil">Solo el administrador puede unir.</span> }
                  </div>
                }
              </section>
            } @empty { <p class="mensaje ok">No hay personas repetidas.</p> }
          }
          @case ('nombres') {
            @if (x.nombresConApellidos.length) {
              <p class="sutil">Estos registros tienen los apellidos también dentro de «nombres». La plataforma ya los muestra sin repetir;
                corregirlos deja el dato limpio (se usará así la próxima vez que se registren en el RNDC). Los documentos ya radicados no cambian.</p>
              <div class="tabla-caja"><table>
                <thead><tr><th>Documento</th><th>Nombres ahora</th><th>Nombres corregidos</th><th>Apellidos</th></tr></thead>
                <tbody>@for (n of x.nombresConApellidos; track n._id) { <tr><td>{{ n.numId }}</td><td>{{ n.actual }}</td><td><strong>{{ n.sugerido }}</strong></td><td>{{ n.apellidos }}</td></tr> }</tbody>
              </table></div>
              @if (puedeUnir()) {
                <button type="button" class="primario" confirmar="Clic otra vez para corregir" (confirmado)="corregirNombres()" [disabled]="trabajando()">Corregir {{ x.nombresConApellidos.length }} nombre(s)</button>
              }
            } @else { <p class="mensaje ok">No hay nombres con apellidos repetidos.</p> }
          }
          @case ('vehiculos') {
            @for (v of x.vehiculos; track v.placas[0]) { <p>{{ v.placas.join(' · ') }}</p> }
            @empty { <p class="mensaje ok">No hay placas repetidas.</p> }
          }
        }
      }
    </app-modal>
  `,
  styles: [`
    .grupo { border: 1px solid var(--gris-2); border-radius: var(--radio); padding: 10px 12px; margin-bottom: 12px; }
    .grupo.revisar { border-color: var(--amarillo, #d4a017); }
    .grupo header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    tr.elegido td { background: var(--gris-1); }
    .unir { display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-wrap: wrap; margin-top: 8px; }
  `],
})
export class DuplicadosTerceros {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly abierto = input(false);
  readonly puedeUnir = input(false);
  readonly cerrar = output<void>();
  readonly unido = output<void>();

  readonly r = signal<Resultado | null>(null);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly vista = signal<'personas' | 'nombres' | 'vehiculos'>('personas');
  private elegidos = signal<Record<string, string>>({});
  private unidos = signal<Set<string>>(new Set());
  readonly pendientes = computed(() => (this.r()?.terceros || []).filter((g) => !this.unidos().has(g.registros[0]._id)));

  constructor() { effect(() => { if (this.abierto()) this.cargar(); }); }

  async cargar() {
    this.cargando.set(true);
    try { this.r.set(await this.api.get<Resultado>('/maestros/duplicados')); this.elegidos.set({}); this.unidos.set(new Set()); }
    catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  motivo(g: Grupo) { return MOTIVO[g.motivo]; }
  certeza(g: Grupo) { return CERTEZA[g.certeza]; }
  claseCerteza(g: Grupo) { return g.certeza === 'alta' ? 'ok' : g.certeza === 'revisar' ? 'error' : 'alerta'; }
  conservar(g: Grupo) { return this.elegidos()[g.registros[0]._id] || g.sugerido; }
  elegir(g: Grupo, id: string) { this.elegidos.update((m) => ({ ...m, [g.registros[0]._id]: id })); }
  nombreDe(g: Grupo, id: string) { const t = g.registros.find((x) => x._id === id); return t ? `${t.nombre} (${t.numId})` : ''; }

  async unir(g: Grupo) {
    const conservar = this.conservar(g);
    this.trabajando.set(true);
    try {
      const x = await this.api.post<any>('/maestros/duplicados/unir', { conservar, quitar: g.registros.map((t) => t._id).filter((id) => id !== conservar), confirmar: true });
      const movidos = Object.entries(x.movidos || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${n} ${k}`).join(', ');
      this.avisos.ok(`Unido en ${x.conservado.nombre}${movidos ? `: ${movidos}` : ''}`);
      this.unidos.update((s) => new Set(s).add(g.registros[0]._id));
      this.unido.emit();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async corregirNombres() {
    const ids = (this.r()?.nombresConApellidos || []).map((n) => n._id);
    this.trabajando.set(true);
    try {
      const x = await this.api.post<any>('/maestros/nombres/corregir', { ids, confirmar: true });
      this.avisos.ok(`${x.corregidos.length} nombre(s) corregidos`);
      await this.cargar(); this.vista.set('nombres'); this.unido.emit();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
