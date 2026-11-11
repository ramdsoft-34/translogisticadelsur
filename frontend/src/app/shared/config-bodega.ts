import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from './icono';

interface Jefe { nombre: string; cedula: string; celular: string }
const DIAS = [{ n: 1, t: 'Lun' }, { n: 2, t: 'Mar' }, { n: 3, t: 'Mié' }, { n: 4, t: 'Jue' }, { n: 5, t: 'Vie' }, { n: 6, t: 'Sáb' }, { n: 0, t: 'Dom' }];

// Configuración de los cargues por WhatsApp de un cliente (pestaña de Clientes y tarifas)
@Component({
  selector: 'app-config-bodega',
  imports: [FormsModule, Icono],
  template: `
    @if (cargando()) { <p class="sutil">Cargando…</p> }
    @else if (c(); as b) {
      @if (vista() === 'config') {
      <section class="bloque">
        <div class="tit">
          <div><h3>Solicitud diaria de cargues por WhatsApp</h3>
            <p class="sutil">El jefe de bodega recibe un enlace del día, entra con su cédula y marca los vehículos que cargaron (urbanos y correrías). Se revisan en Viajes → Cargues de bodega antes de registrarlos.</p></div>
          <label class="casilla interruptor"><input type="checkbox" [(ngModel)]="b.activa" [disabled]="!puedeEditar" />Activa</label>
        </div>

        <h4>Jefes de bodega <small class="sutil">· solo ellos pueden entrar al enlace con su cédula</small></h4>
        <div class="jefes">
          @for (j of b.jefes; track $index; let i = $index) {
            <div class="jefe">
              <div class="campo"><label [for]="'jb-n' + i">Nombre</label><input [id]="'jb-n' + i" maxlength="80" [(ngModel)]="j.nombre" [disabled]="!puedeEditar" placeholder="Nombre completo" /></div>
              <div class="campo"><label [for]="'jb-c' + i">Cédula</label><input [id]="'jb-c' + i" inputmode="numeric" maxlength="15" [(ngModel)]="j.cedula" [disabled]="!puedeEditar" placeholder="Solo números" /></div>
              <div class="campo"><label [for]="'jb-t' + i">Celular de WhatsApp</label><input [id]="'jb-t' + i" inputmode="tel" maxlength="15" [(ngModel)]="j.celular" [disabled]="!puedeEditar" placeholder="3001234567" /></div>
              @if (puedeEditar) { <button type="button" class="pequeno peligro quitar" (click)="quitarJefe(i)" [attr.aria-label]="'Quitar a ' + (j.nombre || 'este jefe de bodega')"><app-icono nombre="x" [tam]="15" /></button> }
            </div>
          } @empty { <p class="sutil sin-jefes">Sin jefes de bodega. Agregue al menos uno para activar la solicitud.</p> }
          @if (puedeEditar && b.jefes.length < 10) { <button type="button" class="pequeno" (click)="agregarJefe()"><app-icono nombre="mas" [tam]="15" />Agregar jefe de bodega</button> }
        </div>

        <h4>Al revisar los viajes</h4>
        <div class="rejilla-b">
          <div class="campo"><label for="cb-mu">Urbanos</label>
            <select id="cb-mu" [(ngModel)]="b.manifiestoUrbanos" [disabled]="!puedeEditar"><option [ngValue]="false">Con soporte interno</option><option [ngValue]="true">Con manifiesto RNDC</option></select></div>
          <div class="campo"><label for="cb-mc">Correrías</label>
            <select id="cb-mc" [(ngModel)]="b.manifiestoCorrerias" [disabled]="!puedeEditar"><option [ngValue]="true">Con manifiesto RNDC</option><option [ngValue]="false">Con soporte interno</option></select></div>
          <div class="campo"><label for="cb-ax">Auxiliar</label>
            <select id="cb-ax" [(ngModel)]="b.auxiliarPagado" [disabled]="!puedeEditar"><option [ngValue]="true">Se paga el día del viaje</option><option [ngValue]="false">Queda pendiente de pago</option></select></div>
        </div>
        <p class="sutil nota">Son valores iniciales: en la revisión se pueden cambiar viaje por viaje.</p>

        <h4>Envío</h4>
        <div class="envio">
          <label class="casilla"><input type="checkbox" [(ngModel)]="b.envioAutomatico" [disabled]="!puedeEditar" />Enviar automáticamente</label>
          @if (b.envioAutomatico) {
            <div class="campo hora"><label for="cb-h">Hora</label><input id="cb-h" type="time" [(ngModel)]="b.hora" [disabled]="!puedeEditar" /></div>
            <div class="dias" role="group" aria-label="Días de envío">
              @for (d of DIAS; track d.n) { <button type="button" class="pequeno" [class.activo]="b.dias.includes(d.n)" [attr.aria-pressed]="b.dias.includes(d.n)" (click)="alternarDia(d.n)" [disabled]="!puedeEditar">{{ d.t }}</button> }
            </div>
          } @else { <span class="sutil">Se envía con el botón «Cargues de bodega» en Viajes.</span> }
        </div>

        @if (puedeEditar) {
          <div class="guardar">
            @if (error()) { <span class="error-texto" role="alert">{{ error() }}</span> }
            <button type="button" class="primario" (click)="guardar()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar configuración' }}</button>
          </div>
        }
      </section>
      } @else {
      <section class="bloque">
        <h3>Vehículos del formulario</h3>
        <p class="sutil ayuda-frec">El jefe de bodega ve en su formulario los vehículos de la pestaña <strong>«Los ve el jefe»</strong>: los que cargan seguido con este cliente (3 o más viajes en 60 días) y los que usted agregue.</p>

        @if (puedeEditar) {
          <div class="agregar-veh">
            <label for="cb-buscar" class="visualmente-oculto">Agregar vehículo por placa o conductor</label>
            <div class="buscar-frec"><app-icono nombre="mas" [tam]="16" />
              <input id="cb-buscar" type="search" autocomplete="off" [ngModel]="buscar()" (ngModelChange)="escribir($event)" (keydown.enter)="agregarEscrito()"
                placeholder="Agregar vehículo: escriba la placa o el nombre del conductor" role="combobox" [attr.aria-expanded]="resultados().length > 0" aria-controls="cb-resultados" /></div>
            @if (resultados().length) {
              <ul id="cb-resultados" class="resultados" role="listbox">
                @for (r of resultados(); track r.placa) {
                  <li role="option"><button type="button" (click)="cambiar(r.placa, 'agregar')">
                    <span class="placa">{{ r.placa }}</span><span class="res-nombre">{{ r.conductorNombre || 'Sin conductor habitual' }}</span>
                    <span class="res-estado">{{ estadoDe(r.placa) }}</span></button></li>
                }
              </ul>
            } @else if (buscando()) { <p class="sutil res-vacio">Buscando…</p> }
            @else if (buscar().trim().length >= 2) { <p class="sutil res-vacio">Ningún vehículo coincide. @if (placaEscrita()) { <button type="button" class="texto" (click)="agregarEscrito()">Agregar {{ placaEscrita() }}</button> }</p> }
          </div>
        }

        <div class="pestanas sub" role="tablist" aria-label="Vehículos">
          @for (o of VISTAS; track o.v) {
            <button type="button" role="tab" [class.activa]="lista() === o.v" [attr.aria-selected]="lista() === o.v" (click)="lista.set(o.v)">{{ o.t }}<span class="chip sin-punto">{{ cuenta(o.v) }}</span></button>
          }
        </div>
        <p class="sutil ayuda-lista">{{ AYUDA[lista()] }}</p>
        <div class="filtro-lista"><app-icono nombre="buscar" [tam]="15" /><input type="search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Filtrar por placa o conductor" aria-label="Filtrar la lista por placa o conductor" /></div>

        <ul class="lista-veh">
          @for (f of visibles(); track f.placa) {
            <li>
              <span class="placa">{{ f.placa }}</span>
              <div class="veh-datos"><strong>{{ f.conductorNombre || 'Sin conductor habitual' }}</strong>
                <small class="sutil">{{ f.cargues ? f.cargues + ' cargue' + (f.cargues === 1 ? '' : 's') + ' en 60 días' : 'Sin viajes recientes con este cliente' }}</small></div>
              @if (lista() === 'visibles') {
                @if (puedeEditar) {
                  <div class="segmentos tipo-veh" role="group" [attr.aria-label]="'Pestaña de ' + f.placa + ' en el formulario'">
                    @for (o of TIPOS; track o.v) { <button type="button" [class.activo]="tipoDe(f) === o.v" [attr.aria-pressed]="tipoDe(f) === o.v" (click)="ponerTipo(f, o.v)">{{ o.t }}</button> }
                  </div>
                }
                <span class="chip sin-punto" [class.ok]="f.origen === 'automatica'" [class.alerta]="f.origen === 'agregada'">{{ f.origen === 'automatica' ? 'Carga seguido' : 'Agregada' }}</span>
              }
              @if (puedeEditar) {
                @switch (lista()) {
                  @case ('visibles') { <button type="button" class="pequeno" (click)="cambiar(f.placa, 'quitar')">Quitar</button> }
                  @case ('sugeridas') { <button type="button" class="pequeno primario" (click)="cambiar(f.placa, 'agregar')">Mostrar al jefe</button> }
                  @case ('quitadas') { <button type="button" class="pequeno" (click)="cambiar(f.placa, 'agregar')">Volver a agregar</button> }
                }
              }
            </li>
          } @empty { <li class="vacio-lista">{{ q().trim() ? 'Ningún vehículo coincide con el filtro.' : VACIO[lista()] }}</li> }
        </ul>
      </section>
      }
    }`,
  styles: [`
    .bloque { border: 1px solid var(--gris-2); border-radius: var(--radio-l, 14px); padding: 16px 18px; margin-top: 14px; background: var(--gris-0); }
    .bloque:first-child { margin-top: 4px; }
    .tit { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
    .tit > div:first-child { flex: 1; min-width: 240px; }
    h3 { margin: 0 0 4px; font-size: 15.5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } h4 { margin: 16px 0 8px; font-size: 13.5px; }
    .tit .sutil { margin: 0; font-size: 13px; line-height: 1.45; }
    .interruptor { font-weight: 700; white-space: nowrap; }
    .jefes { display: grid; gap: 8px; } .jefes > button { justify-self: start; }
    .jefe { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    .quitar { min-height: 40px; }
    .rejilla-b { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
    .nota { font-size: 12.5px; margin: 6px 0 0; }
    .envio { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; min-height: 40px; } .envio .casilla { margin: 0; }
    .hora { width: 130px; } .dias { display: flex; gap: 4px; flex-wrap: wrap; padding-bottom: 2px; }
    .dias button.activo { background: var(--tinta, #111); border-color: var(--tinta, #111); color: #fff; }
    .guardar { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .error-texto { color: var(--rojo); font-size: 13px; }
    .sin-jefes { margin: 0 0 4px; font-size: 13px; }
    .ayuda-frec { margin: 0 0 12px; font-size: 13px; line-height: 1.45; }
    .agregar-veh { position: relative; margin-bottom: 14px; }
    .buscar-frec, .filtro-lista { display: flex; align-items: center; gap: 8px; border: 1px solid var(--gris-2); border-radius: 10px; padding: 0 10px; background: var(--gris-0); color: var(--gris-5); }
    .buscar-frec { border-color: var(--primario-borde); } .buscar-frec:focus-within, .filtro-lista:focus-within { box-shadow: var(--anillo); }
    .buscar-frec input, .filtro-lista input { border: 0; box-shadow: none; flex: 1; min-width: 0; min-height: 40px; padding: 0; background: transparent; outline: none; }
    .filtro-lista { max-width: 320px; margin-bottom: 8px; } .filtro-lista input { min-height: 34px; font-size: 13px; }
    .resultados { list-style: none; margin: 4px 0 0; padding: 4px; position: absolute; left: 0; right: 0; z-index: 5; background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: 12px; box-shadow: var(--sombra-2); max-height: 280px; overflow: auto; }
    .resultados button { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; text-align: left; border: 0; background: none; box-shadow: none; padding: 8px; min-height: 0; font-weight: 400; border-radius: 8px; }
    .resultados button:hover { background: var(--gris-1); }
    .res-nombre { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .res-estado { font-size: 12px; color: var(--gris-5); }
    .res-vacio { margin: 6px 2px 0; font-size: 13px; }
    .pestanas.sub { margin: 4px 0 6px; } .ayuda-lista { margin: 0 0 10px; font-size: 12.5px; }
    .lista-veh { list-style: none; padding: 0; margin: 0; border: 1px solid var(--gris-2); border-radius: 12px; }
    .lista-veh li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto auto; gap: 12px; align-items: center; padding: 10px 12px; border-top: 1px solid var(--gris-2); }
    .tipo-veh button { padding: 4px 10px; min-height: 28px; font-size: 12px; }
    .lista-veh li:first-child { border-top: 0; }
    .veh-datos { min-width: 0; display: grid; gap: 2px; } .veh-datos strong { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .veh-datos small { font-size: 12px; }
    .vacio-lista { display: block !important; text-align: center; color: var(--gris-5); padding: 18px 12px !important; font-size: 13px; }
    @media (max-width: 760px) { .lista-veh li { grid-template-columns: auto minmax(0, 1fr) auto; } .lista-veh li > .tipo-veh { grid-column: 2 / -1; justify-self: start; } }
    @media (max-width: 560px) { .lista-veh li { grid-template-columns: auto minmax(0, 1fr); } .lista-veh li > .chip, .lista-veh li > button { justify-self: start; } }
    @media (max-width: 720px) { .jefe { grid-template-columns: 1fr 1fr; } .jefe .campo:first-child { grid-column: 1 / -1; } }
  `],
})
export class ConfigBodega {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly cliente = input.required<string>();
  readonly vista = input<'config' | 'frecuentes'>('config');
  readonly VISTAS = [{ v: 'visibles', t: 'Los ve el jefe' }, { v: 'sugeridas', t: 'Sugeridas' }, { v: 'quitadas', t: 'Quitadas' }] as const;
  readonly AYUDA: Record<string, string> = {
    visibles: 'Salen en el formulario del jefe de bodega. «Carga seguido» entra solo; «Agregada» la agregó usted.',
    sugeridas: 'Han cargado pocas veces con este cliente y todavía no salen en el formulario.',
    quitadas: 'No salen en el formulario aunque carguen seguido.',
  };
  readonly VACIO: Record<string, string> = {
    visibles: 'El jefe todavía no tiene vehículos en su formulario. Agréguelos con el buscador de arriba.',
    sugeridas: 'No hay sugerencias por ahora.', quitadas: 'No ha quitado ningún vehículo.',
  };
  readonly lista = signal<'visibles' | 'sugeridas' | 'quitadas'>('visibles');
  readonly q = signal('');
  readonly buscar = signal('');
  readonly resultados = signal<{ placa: string; conductorNombre: string }[]>([]);
  readonly buscando = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private grupo = (f: any) => (f.visible ? 'visibles' : f.origen === 'quitada' ? 'quitadas' : 'sugeridas');
  cuenta(v: string) { return this.frecuentes().filter(f => this.grupo(f) === v).length; }
  // Filtro de la lista (sin tildes ni mayúsculas)
  readonly visibles = computed(() => {
    const n = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const palabras = n(this.q()).split(/\s+/).filter(Boolean);
    return this.frecuentes().filter(x => this.grupo(x) === this.lista() && palabras.every(p => n(`${x.placa} ${x.conductorNombre} ${x.destino}`).includes(p)));
  });
  readonly placaEscrita = computed(() => { const p = this.buscar().toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{3}[0-9]{2}[A-Z0-9]$/.test(p) ? p : ''; });
  readonly TIPOS = [{ v: 'urbano', t: 'Urbanos' }, { v: 'correria', t: 'Correrías' }, { v: 'ambos', t: 'Ambos' }];
  tipoDe(f: any) { return f.tipos?.length === 2 ? 'ambos' : f.tipos?.[0] || 'ambos'; }
  async ponerTipo(f: any, tipo: string) {
    if (this.tipoDe(f) === tipo) return;
    try {
      const r = await this.api.put<any>(`/bodega/config/${this.cliente()}/placas`, { placa: f.placa, accion: 'tipo', tipo });
      this.frecuentes.set(r.frecuentes || []);
    } catch (e) { this.avisos.error(e); }
  }
  tiposTexto(f: any) { return f.tipos?.length === 2 ? 'Urbanos y correrías' : f.tipos?.[0] === 'urbano' ? 'Urbanos' : 'Correrías'; }
  estadoDe(placa: string) {
    const f = this.frecuentes().find(x => x.placa === placa);
    return !f ? 'Agregar' : f.visible ? 'Ya la ve el jefe' : f.origen === 'quitada' ? 'Quitada · volver a agregar' : 'Sugerida · agregar';
  }
  readonly puedeEditar = inject(Auth).tiene(P.MAESTROS_EDITAR);
  readonly DIAS = DIAS;
  readonly c = signal<any>(null);
  readonly frecuentes = signal<any[]>([]);
  readonly cargando = signal(true);
  readonly guardando = signal(false);
  readonly error = signal('');

  constructor() { effect(() => { const id = this.cliente(); untracked(() => this.cargar(id)); }); }

  private aplicar(r: any) {
    const b = r.bodega || {};
    this.c.set({ activa: !!b.activa, jefes: (b.jefes || []).map((j: Jefe) => ({ ...j })), envioAutomatico: !!b.envioAutomatico, hora: b.hora || '06:30',
      dias: b.dias?.length ? [...b.dias] : [1, 2, 3, 4, 5, 6], manifiestoUrbanos: !!b.manifiestoUrbanos, manifiestoCorrerias: b.manifiestoCorrerias !== false, auxiliarPagado: b.auxiliarPagado !== false });
    this.frecuentes.set(r.frecuentes || []);
  }
  async cargar(id: string) {
    this.cargando.set(true); this.error.set('');
    try { this.aplicar(await this.api.get<any>(`/bodega/config/${id}`)); } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  agregarJefe() { this.c.update(b => ({ ...b, jefes: [...b.jefes, { nombre: '', cedula: '', celular: '' }] })); }
  quitarJefe(i: number) { this.c.update(b => ({ ...b, jefes: b.jefes.filter((_: Jefe, k: number) => k !== i) })); }
  alternarDia(n: number) { this.c.update(b => ({ ...b, dias: b.dias.includes(n) ? b.dias.filter((x: number) => x !== n) : [...b.dias, n] })); }

  async guardar() {
    const b = this.c(); this.error.set('');
    const jefes = b.jefes.filter((j: Jefe) => j.nombre.trim() || j.cedula.trim() || j.celular.trim());
    for (const j of jefes) {
      if (j.nombre.trim().length < 2) { this.error.set('Escriba el nombre de cada jefe de bodega'); return; }
      if (!/^\d{5,12}$/.test(j.cedula.replace(/\D/g, ''))) { this.error.set(`Cédula no válida para ${j.nombre}`); return; }
      if (!/^3\d{9}$/.test(j.celular.replace(/\D/g, '').slice(-10))) { this.error.set(`Celular no válido para ${j.nombre}: 10 dígitos que empiecen por 3`); return; }
    }
    if (b.activa && !jefes.length) { this.error.set('Para activarla registre al menos un jefe de bodega'); return; }
    if (b.envioAutomatico && !b.dias.length) { this.error.set('Elija al menos un día de envío'); return; }
    this.guardando.set(true);
    try {
      this.aplicar(await this.api.put<any>(`/bodega/config/${this.cliente()}`, { ...b, jefes }));
      this.avisos.ok('Configuración guardada');
    } catch (e: any) { this.error.set(e?.error?.error || 'No se pudo guardar'); } finally { this.guardando.set(false); }
  }

  // Búsqueda mientras se escribe (placa o conductor)
  escribir(v: string) {
    this.buscar.set(v);
    clearTimeout(this.temporizador);
    if (v.trim().length < 2) { this.resultados.set([]); this.buscando.set(false); return; }
    this.buscando.set(true);
    this.temporizador = setTimeout(async () => {
      try { this.resultados.set(await this.api.get<any[]>(`/bodega/config/${this.cliente()}/buscar`, { q: v.trim() })); }
      catch { this.resultados.set([]); } finally { this.buscando.set(false); }
    }, 250);
  }
  agregarEscrito() { const p = this.resultados()[0]?.placa || this.placaEscrita(); if (p) this.cambiar(p, 'agregar'); }

  async cambiar(placa: string, accion: 'agregar' | 'quitar') {
    try {
      const r = await this.api.put<any>(`/bodega/config/${this.cliente()}/placas`, { placa, accion });
      this.frecuentes.set(r.frecuentes || []);
      if (accion === 'agregar') { this.buscar.set(''); this.resultados.set([]); this.avisos.ok(`${placa} ya sale en el formulario del jefe de bodega`); }
      else this.avisos.ok(`${placa} quitada del formulario`);
    } catch (e) { this.avisos.error(e); }
  }
}
