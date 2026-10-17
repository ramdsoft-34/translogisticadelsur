import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, mensajeError } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { FORMATOS } from './formato';
import { Confirmar } from './confirmar';

type Modo = 'uno' | 'todos' | 'lotes';
const ETIQUETAS: Record<string, string> = {
  configuracion: 'Configuración', marca: 'Marca', linea: 'Línea', ejes: 'Ejes', modelo: 'Modelo', color: 'Color',
  pesoVacio: 'Peso vacío', capacidad: 'Capacidad', unidadMedida: 'Unidad de medida', carroceria: 'Carrocería', combustible: 'Combustible',
  'propietario.tipoId': 'Tipo doc. propietario', 'propietario.numId': 'Propietario', 'tenedor.tipoId': 'Tipo doc. tenedor', 'tenedor.numId': 'Tenedor',
  'soat.numero': 'Póliza SOAT', 'soat.vence': 'Vence SOAT', 'soat.aseguradoraNit': 'Aseguradora SOAT',
};
const ESTADOS: Record<string, [string, string]> = {
  actualizado: ['Actualizado', 'ok'], sin_cambios: ['Sin cambios', ''], no_encontrado: ['No está en el RNDC', 'alerta'],
  no_registrado: ['No registrado en la empresa', 'alerta'], error: ['Error', 'error'],
};

// Actualiza los vehículos de la empresa con la información del RNDC:
// uno por placa, todos o por lotes de 30. El servidor consulta de una placa a la vez.
@Component({
  selector: 'app-actualizar-vehiculos',
  imports: [FormsModule, Modal, Icono, Confirmar, ...FORMATOS],
  template: `
    <app-modal titulo="Actualizar vehículos desde el RNDC" [abierto]="abierto()" (cerrar)="cerrar.emit()" [ancho]="true">
      <div class="pestanas" role="tablist">
        <button type="button" [class.activa]="modo() === 'uno'" (click)="modo.set('uno')">Un vehículo</button>
        <button type="button" [class.activa]="modo() === 'lotes'" (click)="modo.set('lotes')">Por lotes de 30</button>
        <button type="button" [class.activa]="modo() === 'todos'" (click)="modo.set('todos')">Todos</button>
      </div>

      @if (modo() === 'uno') {
        <form class="fila" (ngSubmit)="actualizarUno()">
          <div class="campo crece"><label for="av-placa">Placa</label>
            <input id="av-placa" name="placa" [(ngModel)]="placa" (input)="buscarPlacas()" list="av-placas" placeholder="ABC123" maxlength="7" required style="text-transform:uppercase" autocomplete="off" />
            <datalist id="av-placas">@for (p of sugerencias(); track p) { <option [value]="p"></option> }</datalist></div>
          <button class="primario" type="submit" [disabled]="trabajando() || placa.trim().length < 5"><app-icono nombre="buscar" [tam]="16" />{{ trabajando() ? 'Consultando…' : 'Consultar y actualizar' }}</button>
        </form>
        @if (resultadoUno(); as r) {
          <div class="mensaje" [class.ok]="r.estado === 'actualizado'" [class.info]="r.estado === 'sin_cambios'" [class.alerta]="r.estado === 'no_encontrado' || r.estado === 'no_registrado'" [class.error]="r.estado === 'error'">
            <strong>{{ r.placa }} · {{ textoEstado(r.estado) }}</strong>
            @if (r.campos?.length) { <span> — campos actualizados: {{ campos(r.campos) }}</span> }
            @else if (r.estado !== 'actualizado') { <span> — {{ r.mensaje }}</span> }
          </div>
        }
        <p class="sutil">Solo se actualizan los vehículos ya registrados en su empresa. Los datos que el RNDC no tenga no borran los existentes.</p>
      } @else {
        @if (!proceso() || terminado()) {
          <div class="inicio">
            <p>{{ modo() === 'lotes'
              ? 'Se consultan 30 placas, el proceso se detiene para que revise los resultados y usted decide si continúa con el siguiente lote.'
              : 'Se consultan todas las placas seguidas, una a la vez. Puede detener el proceso en cualquier momento.' }}</p>
            <p class="sutil">Para no saturar el web service del RNDC las placas se consultan de una en una, con una pausa entre cada consulta.
              @if (info(); as i) { Con {{ i.total }} vehículos tardará aproximadamente {{ estimado(i.total) }}. }</p>
            <button class="primario" type="button" (click)="iniciar()" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="16" />
              {{ modo() === 'lotes' ? 'Iniciar por lotes de 30' : 'Actualizar todos' }}</button>
          </div>
        }
      }

      @if (proceso(); as p) {
        @if (modo() !== 'uno' || !terminado()) {
          <section class="progreso" aria-live="polite">
            <div class="cabeza">
              <strong>{{ p.modo === 'lotes' ? 'Por lotes de 30' : 'Todos' }} · {{ textoProceso(p.estado) }}</strong>
              <span class="sutil">{{ p.procesados }} de {{ p.total }} · lote {{ p.loteActual }} de {{ p.totalLotes }}</span>
            </div>
            <div class="barra-progreso" role="progressbar" [attr.aria-valuenow]="porcentaje()" aria-valuemin="0" aria-valuemax="100"><span [style.width.%]="porcentaje()"></span></div>
            <p class="estado-msg">{{ p.mensaje }}</p>
            <div class="contadores">
              <div><span>Actualizados</span><strong class="ok">{{ p.actualizados }}</strong></div>
              <div><span>Sin cambios</span><strong>{{ p.sinCambios }}</strong></div>
              <div><span>No están en el RNDC</span><strong class="alerta">{{ p.noEncontrados }}</strong></div>
              <div><span>Errores</span><strong class="error">{{ p.errores }}</strong></div>
              <div><span>Pendientes</span><strong>{{ p.total - p.procesados }}</strong></div>
            </div>
            <div class="acciones">
              @if (p.estado === 'esperando') { <button class="primario" type="button" (click)="continuar()" [disabled]="trabajando()">Continuar con el lote {{ p.loteActual + 1 }}</button> }
              @if (p.estado === 'pausado') { <button class="primario" type="button" (click)="continuar()" [disabled]="trabajando()">Reanudar</button> }
              @if (['ejecutando', 'esperando', 'pausado'].includes(p.estado)) { <button type="button" class="peligro" confirmar="Clic otra vez para detener" (confirmado)="detener()" [disabled]="trabajando()">Detener</button> }
            </div>

            @for (l of lotesRecientes(); track l.numero) {
              <details [open]="$first">
                <summary>Lote {{ l.numero }} · {{ resumenLote(l) }}</summary>
                <div class="tabla-caja"><table>
                  <thead><tr><th>Placa</th><th>Resultado</th><th>Detalle</th></tr></thead>
                  <tbody>@for (r of l.resultados; track r.placa) {
                    <tr><td><span class="placa">{{ r.placa }}</span></td>
                      <td><span class="chip" [class]="claseEstado(r.estado)">{{ textoEstado(r.estado) }}</span></td>
                      <td class="detalle">{{ r.campos?.length ? campos(r.campos) : r.mensaje }}</td></tr>
                  }</tbody>
                </table></div>
              </details>
            }
          </section>
        }
      }
      <ng-container pie><button type="button" (click)="cerrar.emit()">Cerrar</button></ng-container>
    </app-modal>`,
  styles: [`
    .pestanas { margin-bottom: 16px; }
    .fila { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
    .fila .crece { flex: 1 1 220px; }
    .inicio { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; margin-bottom: 14px; }
    .inicio p { margin: 0; }
    .progreso { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--gris-2); border-radius: var(--radio-l); }
    .cabeza { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .barra-progreso { height: 10px; border-radius: 999px; background: var(--gris-15); overflow: hidden; }
    .barra-progreso span { display: block; height: 100%; background: var(--primario); transition: width .4s ease; }
    .estado-msg { margin: 0; font-size: 13.5px; color: var(--gris-7); }
    .contadores { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
    .contadores div { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 10px; background: var(--gris-1); }
    .contadores span { font-size: 12px; color: var(--gris-5); }
    .contadores strong { font-size: 20px; font-variant-numeric: tabular-nums; }
    .contadores .ok { color: var(--verde); } .contadores .alerta { color: var(--ambar); } .contadores .error { color: var(--rojo); }
    details { border-top: 1px solid var(--gris-15); padding-top: 8px; }
    details .tabla-caja { margin-top: 8px; max-height: 320px; box-shadow: none; }
    .detalle { font-size: 12.5px; color: var(--gris-7); }
    @media (max-width: 760px) { .contadores { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class ActualizarVehiculos {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly abierto = input(false);
  readonly cerrar = output<void>();
  readonly actualizados = output<void>();
  readonly modo = signal<Modo>('lotes');
  readonly proceso = signal<any>(null);
  readonly info = signal<{ total: number } | null>(null);
  readonly trabajando = signal(false);
  readonly resultadoUno = signal<any>(null);
  readonly sugerencias = signal<string[]>([]);
  readonly terminado = computed(() => ['terminado', 'detenido', 'error'].includes(this.proceso()?.estado));
  readonly porcentaje = computed(() => { const p = this.proceso(); return p ? Math.round((p.procesados / Math.max(1, p.total)) * 100) : 0; });
  readonly lotesRecientes = computed(() => [...(this.proceso()?.lotes || [])].reverse().slice(0, 10));
  placa = '';
  private sondeo: ReturnType<typeof setInterval> | undefined;
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private ultimaMarca = '';

  constructor() {
    effect(() => { if (this.abierto()) { this.consultarEstado(); this.contar(); } else this.pararSondeo(); });
    inject(DestroyRef).onDestroy(() => this.pararSondeo());
  }

  textoEstado(e: string) { return ESTADOS[e]?.[0] || e; }
  claseEstado(e: string) { return ESTADOS[e]?.[1] || ''; }
  campos(c: string[]) { return c.map(x => ETIQUETAS[x] || x).join(', '); }
  textoProceso(e: string) {
    return ({ ejecutando: 'en curso', esperando: 'esperando para continuar', pausado: 'en pausa', terminado: 'terminado', detenido: 'detenido', error: 'con error' } as Record<string, string>)[e] || e;
  }
  resumenLote(l: any) {
    const n = (e: string) => l.resultados.filter((r: any) => r.estado === e).length;
    return `${l.resultados.length} de ${l.placas} · ${n('actualizado')} actualizados, ${n('sin_cambios')} sin cambios, ${n('no_encontrado') + n('no_registrado')} no encontrados, ${n('error')} errores`;
  }
  // ~1 s de respuesta del RNDC + la pausa de protección por placa
  estimado(total: number) {
    const min = Math.ceil((total * 2.5) / 60);
    return min < 60 ? `${min} minutos` : `${Math.floor(min / 60)} h ${min % 60} min`;
  }

  private async contar() {
    try { const r = await this.api.get<any>('/maestros/vehiculos', { pagina: 1, limite: 1 }); this.info.set({ total: r.total }); } catch { /* opcional */ }
  }

  buscarPlacas() {
    clearTimeout(this.temporizador);
    const q = this.placa.trim();
    if (q.length < 2) return;
    this.temporizador = setTimeout(async () => {
      const r = await this.api.get<any>('/maestros/vehiculos', { q, pagina: 1, limite: 10 }).catch(() => null);
      this.sugerencias.set((r?.items || []).map((v: any) => v.placa));
    }, 200);
  }

  async consultarEstado() {
    try {
      const r = await this.api.get<any>('/rndc/vehiculos/actualizacion');
      const p = r.proceso;
      this.proceso.set(p);
      if (p && this.modo() === 'uno' && !['terminado', 'detenido', 'error'].includes(p.estado)) this.modo.set(p.modo);
      // La lista de vehículos se refresca al cerrar cada lote, no en cada consulta
      const marca = p ? `${p.lotes.length}|${p.estado}` : '';
      if (p && marca !== this.ultimaMarca && p.actualizados) this.actualizados.emit();
      this.ultimaMarca = marca;
      if (p?.estado === 'ejecutando') this.iniciarSondeo(); else this.pararSondeo();
    } catch (e) { this.avisos.error(e); this.pararSondeo(); }
  }

  private iniciarSondeo() { if (!this.sondeo) this.sondeo = setInterval(() => this.consultarEstado(), 2000); }
  private pararSondeo() { clearInterval(this.sondeo); this.sondeo = undefined; }

  async actualizarUno() {
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true); this.resultadoUno.set(null);
    try {
      const r = await this.api.post<any>('/rndc/vehiculos/actualizar', { clave: c, placa: this.placa.trim().toUpperCase() });
      this.resultadoUno.set(r);
      if (r.estado === 'error' && /usuario|contrase|clave/i.test(r.mensaje || '')) this.clave.olvidar();
      if (r.estado === 'actualizado') this.actualizados.emit();
    } catch (e) { this.resultadoUno.set({ placa: this.placa.toUpperCase(), estado: 'error', mensaje: await mensajeError(e) }); }
    finally { this.trabajando.set(false); }
  }

  async iniciar() {
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      this.proceso.set(await this.api.post<any>('/rndc/vehiculos/actualizacion', { clave: c, modo: this.modo() }));
      this.iniciarSondeo();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async continuar() {
    this.trabajando.set(true);
    try {
      this.proceso.set(await this.api.post<any>('/rndc/vehiculos/actualizacion/continuar', {}));
      this.iniciarSondeo();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async detener() {
    this.trabajando.set(true);
    try { this.proceso.set(await this.api.post<any>('/rndc/vehiculos/actualizacion/detener', {})); this.iniciarSondeo(); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
