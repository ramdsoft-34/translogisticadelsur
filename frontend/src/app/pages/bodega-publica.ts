import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

type Tipo = 'urbano' | 'correria';
interface Tarjeta {
  clave: string; tipo: Tipo; placa: string; conductor: string | null; conductorNombre: string; cargues: number; frecuente: boolean;
  cargo: boolean | null; destino: string; planilla: string; viajes: number; auxiliar: number; otro: boolean; conductorTexto: string; registrado: boolean; quitado?: boolean;
}
const TITULO: Record<Tipo, string> = { urbano: 'Urbanos', correria: 'Correrías' };
const RE_PLACA = /^[A-Z0-9]{5,6}$/;

// Página pública del jefe de bodega (/b/<enlace del día>): entra con su cédula y marca los vehículos que cargaron.
// La sesión (2 horas) se guarda solo en esta pestaña del navegador.
@Component({
  selector: 'app-bodega-publica',
  imports: [FormsModule],
  template: `
    <main class="pag">
      <header class="marca"><span class="logo">{{ portada()?.empresa || 'Transportadora' }}</span><span class="sutil">Cargues del día</span></header>

      @if (estado() === 'cargando') { <section class="caja centro"><p class="sutil">Cargando…</p></section> }

      @if (estado() === 'error') {
        <section class="caja centro"><div class="icono-error" aria-hidden="true">!</div><h1>{{ error() }}</h1>
          <p class="sutil">Si necesita ayuda, comuníquese con la transportadora.</p></section>
      }

      @if (estado() === 'ingreso' && portada(); as p) {
        <section class="caja">
          <h1>Cargues de {{ p.cliente }}</h1>
          <p class="sutil">{{ p.fechaTexto }}</p>
          <form (ngSubmit)="ingresar()" class="ingreso">
            <label for="bp-ced">Escriba su número de cédula para continuar</label>
            <input id="bp-ced" name="cedula" inputmode="numeric" autocomplete="off" maxlength="15" [(ngModel)]="cedula" placeholder="Cédula" [attr.aria-invalid]="!!errorIngreso()" />
            @if (errorIngreso()) { <p class="msj-error" role="alert">{{ errorIngreso() }}</p> }
            <button class="primario grande" type="submit" [disabled]="trabajando()">{{ trabajando() ? 'Verificando…' : 'Ingresar' }}</button>
          </form>
          <p class="nota">Solo pueden ingresar los jefes de bodega registrados por la transportadora.</p>
        </section>
      }

      @if (estado() === 'formulario' && datos(); as d) {
        <section class="caja cab">
          <h1>Cargues de {{ d.cliente }}</h1>
          <p class="sutil">Hola, {{ d.jefe }}. Marque <strong>Sí</strong> en los vehículos que cargaron.</p>
          <div class="segmentos dias" role="tablist" aria-label="Día del cargue">
            <button type="button" role="tab" [class.activo]="cual() === 'hoy'" [attr.aria-selected]="cual() === 'hoy'" (click)="cambiarDia('hoy')">Hoy</button>
            <button type="button" role="tab" [class.activo]="cual() === 'ayer'" [attr.aria-selected]="cual() === 'ayer'" (click)="cambiarDia('ayer')">Ayer</button>
          </div>
          <p class="fecha">{{ d.fechaTexto }}</p>
        </section>

        <div class="pestanas-bp" role="tablist" aria-label="Tipo de viaje">
          @for (t of TIPOS; track t) {
            <button type="button" role="tab" [class.activa]="tipo() === t" [attr.aria-selected]="tipo() === t" (click)="tipo.set(t)">
              {{ TITULO[t] }} @if (marcados(t)) { <span class="cuenta">{{ marcados(t) }}</span> }</button>
          }
        </div>

          <h2 class="seccion">Vehículos</h2>
          @for (c of visibles(); track c.clave) {
            <article class="veh" [class.si]="c.cargo === true" [class.no]="c.cargo === false" [class.bloq]="c.registrado">
              <div class="fila1">
                <span class="placa">{{ c.placa }}</span>
                <div class="quien"><strong>{{ c.conductorNombre || 'Conductor por confirmar' }}</strong>
                  <small>@if (c.registrado) { {{ c.quitado ? 'Revisado por la transportadora' : 'Ya registrado por la transportadora' }} } @else if (c.frecuente) { {{ c.cargues ? c.cargues + ' cargue' + (c.cargues === 1 ? '' : 's') + ' con ustedes' : 'Vehículo habitual' }} } @else { Placa agregada }</small></div>
                @if (c.registrado) {
                  <button type="button" class="otro-viaje" (click)="otroViaje(c)">+ Otro viaje</button>
                }
                @if (!c.registrado) {
                  <div class="sino" role="group" [attr.aria-label]="'¿' + c.placa + ' cargó?'">
                    <button type="button" class="si-b" [class.on]="c.cargo === true" [attr.aria-pressed]="c.cargo === true" (click)="marcar(c, true)">Sí</button>
                    <button type="button" class="no-b" [class.on]="c.cargo === false" [attr.aria-pressed]="c.cargo === false" (click)="marcar(c, false)">No</button>
                  </div>
                }
              </div>
              @if (c.cargo === true) {
                <div class="detalle-veh">
                  <label class="campo-bp ancho"><span>Destino</span>
                    <input maxlength="80" [ngModel]="c.destino" (ngModelChange)="poner(c, 'destino', $event)" [disabled]="c.registrado" placeholder="¿A dónde va? Ej. Pasto centro" [attr.aria-invalid]="!c.destino.trim()" /></label>
                  <label class="campo-bp"><span>Planilla</span>
                    <input inputmode="numeric" maxlength="30" [ngModel]="c.planilla" (ngModelChange)="poner(c, 'planilla', $event)" [disabled]="c.registrado" placeholder="Opcional" /></label>
                  <div class="campo-bp"><span>Viajes</span>
                    <div class="pasos" role="group" [attr.aria-label]="'Viajes de ' + c.placa">
                      <button type="button" aria-label="Menos" (click)="poner(c, 'viajes', c.viajes - 1)" [disabled]="c.registrado || c.viajes <= 1">−</button>
                      <output aria-live="polite">{{ c.viajes }}</output>
                      <button type="button" aria-label="Más" (click)="poner(c, 'viajes', c.viajes + 1)" [disabled]="c.registrado || c.viajes >= 5">+</button>
                    </div></div>
                  <label class="campo-bp"><span>Auxiliares</span>
                    <select [ngModel]="c.auxiliar" (ngModelChange)="poner(c, 'auxiliar', $event)" [disabled]="c.registrado">
                      <option [ngValue]="0">Ninguno</option>@for (n of [1, 2, 3, 4, 5]; track n) { <option [ngValue]="n">{{ n }}</option> }
                    </select></label>
                  @if (!c.registrado) {
                    @if (c.otro) {
                      <label class="campo-bp ancho"><span>¿Quién maneja?</span>
                        <input maxlength="80" [ngModel]="c.conductorTexto" (ngModelChange)="poner(c, 'conductorTexto', $event)" placeholder="Nombre del conductor" /></label>
                    } @else { <button type="button" class="enlace" (click)="poner(c, 'otro', true)">¿Lo maneja otro conductor?</button> }
                  }
                </div>
              }
            </article>
          } @empty { <p class="sutil vacio">No hay vehículos frecuentes en {{ TITULO[tipo()].toLowerCase() }}. Agregue la placa abajo.</p> }

          <h2 class="seccion">Otra placa</h2>
          <div class="otra">
            <input [ngModel]="buscar()" (ngModelChange)="escribirPlaca($event)" maxlength="7" placeholder="Escriba la placa, ej. ABC123" autocapitalize="characters" aria-label="Otra placa" (keydown.enter)="agregar(buscar())" />
            <button type="button" (click)="agregar(buscar())" [disabled]="!placaValida()">Agregar</button>
          </div>
          @if (sugeridas().length) {
            <ul class="sug" aria-label="Placas que han cargado con este cliente">
              @for (p of sugeridas(); track p) { <li><button type="button" (click)="agregar(p)">{{ p }}</button></li> }
            </ul>
          }
        <div class="espacio"></div>
        <footer class="pie">
          @if (errorEnvio()) { <p class="msj-error" role="alert">{{ errorEnvio() }}</p> }
          <button class="primario grande" type="button" (click)="enviar()" [disabled]="trabajando()">
            {{ trabajando() ? 'Enviando…' : totalMarcados() ? 'Enviar reporte · ' + totalMarcados() + ' vehículo' + (totalMarcados() === 1 ? '' : 's') : 'Enviar reporte (ninguno cargó)' }}</button>
        </footer>
      }

      @if (estado() === 'listo' && datos(); as d) {
        <section class="caja centro">
          <div class="icono-ok" aria-hidden="true">✓</div>
          <h1>¡Gracias, {{ d.jefe }}!</h1>
          <p>La transportadora recibió los cargues de {{ cual() === 'hoy' ? 'hoy' : 'ayer' }} de <strong>{{ d.cliente }}</strong>.</p>
          <div class="resumen">
            @for (t of TIPOS; track t) {
              <h3>{{ TITULO[t] }} ({{ marcados(t) }})</h3>
              @for (c of marcadosDe(t); track c.clave) { <p><span class="placa chica">{{ c.placa }}</span> {{ c.destino }}{{ c.viajes > 1 ? ' · ' + c.viajes + ' viajes' : '' }}{{ c.planilla ? ' · planilla ' + c.planilla : '' }}{{ c.auxiliar ? ' · ' + c.auxiliar + ' auxiliar' + (c.auxiliar > 1 ? 'es' : '') : '' }}</p> }
              @empty { <p class="sutil">Ninguno</p> }
            }
          </div>
          <p class="nota">Puede corregirlo hasta las 11:59 p. m. abriendo el mismo enlace.</p>
          <button type="button" class="grande" (click)="estado.set('formulario')">Corregir</button>
        </section>
      }
    </main>`,
  styles: [`
    :host { display: block; background: var(--fondo, #f4f4f2); min-height: 100dvh; }
    .pag { max-width: 560px; margin: 0 auto; padding: 14px 14px 0; }
    .marca { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 4px 2px 12px; }
    .logo { background: var(--tinta, #111); color: var(--primario, #f6b80f); font-weight: 800; letter-spacing: .03em; padding: 5px 10px; border-radius: 8px; font-size: 13px; max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .caja { background: var(--gris-0, #fff); border: 1px solid var(--gris-2, #e5e5e5); border-radius: 16px; padding: 18px; margin-bottom: 12px; }
    .caja.cab { border-top: 4px solid var(--primario, #f6b80f); }
    .centro { text-align: center; padding: 28px 18px; }
    h1 { font-size: 21px; line-height: 1.25; margin: 0 0 4px; overflow-wrap: anywhere; }
    .sutil { color: var(--gris-5, #6b6b6b); margin: 0; }
    .fecha { margin: 8px 0 0; font-size: 13px; color: var(--gris-5); text-transform: capitalize; }
    .dias { margin-top: 12px; }
    .ingreso { display: grid; gap: 10px; margin-top: 18px; } .ingreso label { font-weight: 650; font-size: 14px; }
    .ingreso input { font-size: 20px; letter-spacing: .06em; padding: 12px 14px; border-radius: 12px; min-height: 52px; }
    .nota { font-size: 12.5px; color: var(--gris-5); margin: 14px 0 0; }
    .grande { width: 100%; min-height: 52px; font-size: 16px; border-radius: 14px; }
    .msj-error { color: var(--rojo, #c62828); font-size: 13.5px; margin: 0; }
    .pestanas-bp { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: var(--gris-15, #ececec); padding: 4px; border-radius: 14px; margin-bottom: 4px; position: sticky; top: 0; z-index: 3; }
    .pestanas-bp button { border: 0; background: transparent; min-height: 44px; border-radius: 10px; font-weight: 700; color: var(--gris-5); display: inline-flex; justify-content: center; align-items: center; gap: 8px; box-shadow: none; }
    .pestanas-bp button.activa { background: var(--gris-0, #fff); color: var(--gris-8, #111); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    .cuenta { background: var(--primario, #f6b80f); color: var(--tinta, #111); border-radius: 999px; font-size: 12px; padding: 1px 8px; }
    .seccion { font-size: 12px; letter-spacing: .07em; text-transform: uppercase; color: var(--gris-5); margin: 16px 2px 8px; }
    .veh { background: var(--gris-0, #fff); border: 1px solid var(--gris-2, #e5e5e5); border-radius: 14px; padding: 12px; margin-bottom: 8px; }
    .veh.si { border: 2px solid var(--verde, #2e7d32); padding: 11px; } .veh.no { opacity: .7; } .veh.bloq { background: var(--gris-1, #f7f7f7); }
    .fila1 { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .placa { font-weight: 800; letter-spacing: .07em; background: var(--primario, #f6b80f); color: #111; border: 1.5px solid #111; border-radius: 7px; padding: 4px 8px; font-size: 14px; white-space: nowrap; }
    .placa.chica { font-size: 12px; padding: 1px 6px; }
    .quien { min-width: 0; } .quien strong { display: block; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .quien small { color: var(--gris-5); font-size: 12.5px; }
    .sino { display: flex; gap: 6px; } .sino button { min-width: 52px; min-height: 44px; border-radius: 999px; font-weight: 750; padding: 0 12px; }
    .si-b.on { background: var(--verde, #2e7d32); border-color: var(--verde, #2e7d32); color: #fff; }
    .no-b.on { background: var(--gris-8, #333); border-color: var(--gris-8, #333); color: #fff; }
    .detalle-veh { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; margin-top: 12px; }
    .campo-bp { display: grid; gap: 4px; min-width: 0; } .campo-bp > span { font-size: 12px; color: var(--gris-5); font-weight: 600; }
    .campo-bp.ancho { grid-column: 1 / -1; }
    .campo-bp select, .campo-bp input { width: 100%; min-height: 44px; font-size: 15px; border-radius: 10px; }
    .pasos { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; border: 1px solid var(--gris-2); border-radius: 10px; min-height: 44px; overflow: hidden; }
    .pasos button { border: 0; border-radius: 0; min-height: 44px; font-size: 20px; padding: 0; box-shadow: none; } .pasos output { text-align: center; font-weight: 750; font-size: 16px; }
    .check { display: flex; align-items: center; gap: 8px; font-size: 14.5px; min-height: 44px; } .check input { width: 22px; height: 22px; }
    .otro-viaje { margin-left: auto; border: 1px solid var(--borde, #d9d9d9); background: #fff; border-radius: 999px; padding: 6px 12px; font-weight: 600; min-height: 36px; }
    .enlace { grid-column: 1 / -1; justify-self: start; border: 0; background: none; color: var(--primario-texto, #8a6100); text-decoration: underline; padding: 4px 0; min-height: 0; box-shadow: none; font-weight: 600; }
    .vacio { padding: 6px 2px 4px; }
    .otra { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; } .otra input { min-height: 48px; font-size: 16px; text-transform: uppercase; border-radius: 12px; }
    .otra button { min-height: 48px; border-radius: 12px; padding: 0 16px; }
    .sug { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .sug button { min-height: 40px; border-radius: 999px; font-weight: 700; letter-spacing: .05em; padding: 0 14px; }
    .espacio { height: 110px; }
    .pie { position: fixed; left: 0; right: 0; bottom: 0; background: var(--gris-0, #fff); border-top: 1px solid var(--gris-2); padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); display: grid; gap: 6px; z-index: 5; }
    .pie > * { max-width: 532px; width: 100%; margin: 0 auto; }
    .icono-ok, .icono-error { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; margin: 0 auto 14px; font-size: 32px; font-weight: 800; color: #fff; }
    .icono-ok { background: var(--verde, #2e7d32); } .icono-error { background: var(--rojo, #c62828); }
    .resumen { text-align: left; background: var(--gris-1, #f7f7f7); border-radius: 12px; padding: 12px 14px; margin: 16px 0 0; }
    .resumen h3 { font-size: 14px; margin: 8px 0 6px; } .resumen h3:first-child { margin-top: 0; } .resumen p { margin: 0 0 6px; font-size: 14px; overflow-wrap: anywhere; }
    @media (max-width: 380px) { .fila1 { grid-template-columns: auto minmax(0, 1fr); } .sino { grid-column: 1 / -1; } .sino button { flex: 1; } }
  `],
})
export class BodegaPublica {
  private http = inject(HttpClient);
  private token = inject(ActivatedRoute).snapshot.paramMap.get('token') || '';
  private base = `${environment.apiUrl}/b/${encodeURIComponent(this.token)}`;
  readonly TIPOS: Tipo[] = ['urbano', 'correria'];
  readonly TITULO = TITULO;
  readonly estado = signal<'cargando' | 'error' | 'ingreso' | 'formulario' | 'listo'>('cargando');
  readonly error = signal('');
  readonly portada = signal<any>(null);
  readonly datos = signal<any>(null);
  readonly cual = signal<'hoy' | 'ayer'>('hoy');
  readonly tipo = signal<Tipo>('urbano');
  readonly tarjetas = signal<Tarjeta[]>([]);
  readonly trabajando = signal(false);
  readonly errorIngreso = signal('');
  readonly errorEnvio = signal('');
  readonly buscar = signal('');
  readonly sugeridas = signal<string[]>([]);
  cedula = '';
  private sesion = '';
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  readonly visibles = computed(() => this.tarjetas().filter(c => c.tipo === this.tipo()));
  readonly totalMarcados = computed(() => this.tarjetas().filter(c => c.cargo).length);
  readonly placaValida = computed(() => RE_PLACA.test(this.limpiar(this.buscar())));

  constructor() {
    try { this.sesion = sessionStorage.getItem(`bodega:${this.token}`) || ''; } catch { this.sesion = ''; }
    this.iniciar();
  }

  private cabeceras() { return { headers: new HttpHeaders({ 'X-Sesion-Bodega': this.sesion }) }; }
  private mensaje(e: unknown, defecto: string) { return e instanceof HttpErrorResponse && e.error?.error ? String(e.error.error) : defecto; }
  private limpiar(p: string) { return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  private async iniciar() {
    try {
      this.portada.set(await firstValueFrom(this.http.get<any>(this.base)));
      if (this.sesion && await this.cargarDatos()) return;
      this.estado.set('ingreso');
    } catch (e) { this.error.set(this.mensaje(e, 'No se pudo abrir el enlace. Revise su conexión.')); this.estado.set('error'); }
  }

  async ingresar() {
    if (this.trabajando()) return;
    const ced = this.cedula.replace(/\D/g, '');
    if (ced.length < 5) { this.errorIngreso.set('Escriba su número de cédula completo'); return; }
    this.trabajando.set(true); this.errorIngreso.set('');
    try {
      const r = await firstValueFrom(this.http.post<any>(`${this.base}/ingresar`, { cedula: ced }));
      this.sesion = r.sesion;
      try { sessionStorage.setItem(`bodega:${this.token}`, this.sesion); } catch { /* sin almacenamiento: se pide la cédula al recargar */ }
      this.cedula = '';
      await this.cargarDatos(true);
    } catch (e) { this.errorIngreso.set(this.mensaje(e, 'No se pudo verificar la cédula')); }
    finally { this.trabajando.set(false); }
  }

  // Devuelve false si la sesión ya no sirve (vuelve a pedir la cédula)
  private async cargarDatos(conservar = false): Promise<boolean> {
    try {
      const d = await firstValueFrom(this.http.get<any>(`${this.base}/datos`, { ...this.cabeceras(), params: { cual: this.cual() } }));
      const seguir = conservar && this.tarjetas().length && d.cual === this.cual();
      this.datos.set(d);
      if (!seguir) { this.armar(d); if (!d.vehiculos.urbano.length && d.vehiculos.correria.length) this.tipo.set('correria'); }
      this.estado.set('formulario');
      return true;
    } catch (e) {
      if (e instanceof HttpErrorResponse && (e.status === 401 || e.status === 403)) {
        this.sesion = ''; try { sessionStorage.removeItem(`bodega:${this.token}`); } catch { /* nada */ }
        this.estado.set('ingreso'); return false;
      }
      this.error.set(this.mensaje(e, 'No se pudieron cargar los datos')); this.estado.set('error'); return false;
    }
  }

  // Tarjetas: los vehículos frecuentes de cada pestaña más lo que ya reportó (lo reportado manda)
  private armar(d: any) {
    const l: Tarjeta[] = [];
    const nueva = (tipo: Tipo, v: any): Tarjeta => ({ clave: `${tipo}|${v.placa}|${l.length}`, tipo, placa: v.placa, conductor: v.conductor || null, conductorNombre: v.conductorNombre || '',
      cargues: v.cargues || 0, frecuente: !!v.frecuente, cargo: null, destino: '', planilla: '', viajes: 1, auxiliar: 0, otro: false, conductorTexto: '', registrado: false });
    for (const t of this.TIPOS) for (const v of d.vehiculos[t]) l.push(nueva(t, { ...v, frecuente: true }));
    for (const it of d.reporte.items) {
      let c = l.find(x => x.tipo === it.tipo && x.placa === it.placa && x.cargo === null);
      if (!c) { c = nueva(it.tipo, { placa: it.placa, conductor: it.conductor }); l.push(c); }
      Object.assign(c, { cargo: true, destino: it.destino || '', planilla: it.planilla || '', viajes: it.viajes || 1, auxiliar: Number(it.auxiliar) || 0,
        otro: !!it.conductorTexto, conductorTexto: it.conductorTexto || '', registrado: !!it.registrado, quitado: !!it.quitado });
    }
    this.tarjetas.set(l);
  }

  marcados(t: Tipo) { return this.tarjetas().filter(c => c.tipo === t && c.cargo).length; }
  marcadosDe(t: Tipo) { return this.tarjetas().filter(c => c.tipo === t && c.cargo); }
  private actualizar(c: Tarjeta, cambios: Partial<Tarjeta>) { this.errorEnvio.set(''); this.tarjetas.update(l => l.map(x => (x.clave === c.clave ? { ...x, ...cambios } : x))); }
  marcar(c: Tarjeta, si: boolean) { this.actualizar(c, { cargo: si }); }
  poner(c: Tarjeta, k: keyof Tarjeta, v: any) {
    if (k === 'viajes') v = Math.min(5, Math.max(1, Number(v) || 1));
    this.actualizar(c, { [k]: v } as Partial<Tarjeta>);
  }

  escribirPlaca(v: string) {
    this.buscar.set(v);
    clearTimeout(this.temporizador);
    const q = this.limpiar(v);
    if (q.length < 2) { this.sugeridas.set([]); return; }
    this.temporizador = setTimeout(async () => {
      try {
        const yaEstan = new Set(this.visibles().map(c => c.placa));
        const r = await firstValueFrom(this.http.get<string[]>(`${this.base}/placas`, { ...this.cabeceras(), params: { q } }));
        this.sugeridas.set(r.filter(p => !yaEstan.has(p)));
      } catch { this.sugeridas.set([]); }
    }, 300);
  }
  agregar(p: string) {
    const placa = this.limpiar(p);
    if (!RE_PLACA.test(placa)) return;
    const existe = this.visibles().find(c => c.placa === placa && !c.registrado);
    const registrada = this.visibles().find(c => c.placa === placa && c.registrado);
    if (existe) this.marcar(existe, true);
    else if (registrada) this.otroViaje(registrada);
    else this.tarjetas.update(l => [...l, { clave: `${this.tipo()}|${placa}|${Date.now()}`, tipo: this.tipo(), placa, conductor: null, conductorNombre: '', cargues: 0, frecuente: false,
      cargo: true, destino: '', planilla: '', viajes: 1, auxiliar: 0, otro: true, conductorTexto: '', registrado: false }]);
    this.buscar.set(''); this.sugeridas.set([]);
  }

  // Un vehículo puede hacer varios viajes en el día: el registrado queda igual y se agrega otro (mismos valores u otros)
  otroViaje(c: Tarjeta) {
    const nueva: Tarjeta = { ...c, clave: `${c.tipo}|${c.placa}|${Date.now()}`, cargo: true, destino: '', planilla: '', viajes: 1, auxiliar: c.auxiliar,
      registrado: false, quitado: false, frecuente: c.frecuente };
    this.tarjetas.update(l => { const i = l.findIndex(x => x.clave === c.clave); const n = [...l]; n.splice(i + 1, 0, nueva); return n; });
  }

  async cambiarDia(c: 'hoy' | 'ayer') {
    if (c === this.cual()) return;
    this.cual.set(c); this.estado.set('cargando');
    await this.cargarDatos();
  }

  async enviar() {
    if (this.trabajando()) return;
    // Validación antes de enviar: cada vehículo que cargó necesita destino; el que no tiene conductor conocido, su nombre
    for (const c of this.tarjetas().filter(x => x.cargo && !x.registrado)) {
      if (c.destino.trim().length < 2) { this.tipo.set(c.tipo); this.errorEnvio.set(`Escriba el destino de ${c.placa} (${TITULO[c.tipo]})`); return; }
      if (!c.conductor && !c.conductorTexto.trim()) { this.tipo.set(c.tipo); this.errorEnvio.set(`Escriba quién maneja ${c.placa} (${TITULO[c.tipo]})`); return; }
    }
    this.trabajando.set(true); this.errorEnvio.set('');
    try {
      for (const t of this.TIPOS) {
        const items = this.tarjetas().filter(c => c.tipo === t && c.cargo && !c.registrado).map(c => ({ placa: c.placa, destino: c.destino.trim(), planilla: c.planilla.trim(), viajes: c.viajes,
          auxiliar: c.auxiliar, conductor: c.otro ? null : c.conductor, conductorTexto: c.otro ? c.conductorTexto.trim() : '' }));
        await firstValueFrom(this.http.put(`${this.base}/reporte`, { cual: this.cual(), tipo: t, items, soloNuevos: true }, this.cabeceras()));
      }
      for (const c of this.tarjetas()) if (c.cargo === null) this.actualizar(c, { cargo: false });
      this.estado.set('listo');
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 401) { this.estado.set('ingreso'); this.errorIngreso.set('Su sesión terminó. Ingrese de nuevo con su cédula; lo marcado no se perdió.'); }
      else this.errorEnvio.set(this.mensaje(e, 'No se pudo enviar. Revise su conexión e intente de nuevo.'));
    } finally { this.trabajando.set(false); }
  }
}
