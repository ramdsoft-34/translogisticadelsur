import { Component, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { FORMATOS } from '../shared/formato';
import { filtrar } from '../shared/filtro';

@Component({
  selector: 'app-inicio',
  imports: [RouterLink, Icono, ...FORMATOS],
  template: `
    <section class="bienvenida">
      <div>
        <p class="saludo">{{ saludo() }}, {{ primerNombre() }}</p>
        <h1>Operación de {{ auth.usuario()?.empresa?.nombre }}</h1>
        <p class="sub">{{ hoy }}</p>
      </div>
      <div class="acciones">
        @if (auth.tiene(P.VIAJES_REGISTRAR)) { <a routerLink="/viajes" class="boton primario"><app-icono nombre="mas" [tam]="16" />Registrar viaje</a> }
        @if (auth.tiene(P.RNDC_OPERAR)) { <a routerLink="/manifiestos" class="boton"><app-icono nombre="documento" [tam]="16" />Manifiestos RNDC</a> }
      </div>
    </section>

    <div class="indicadores">
      <a class="indicador" routerLink="/viajes">
        <span class="icono"><app-icono nombre="camion" /></span>
        <span class="etq">Viajes de hoy</span><span class="valor">{{ r()?.hoy ?? '—' }}</span>
      </a>
      <a class="indicador" [class.atencion]="pendientes() > 0" [routerLink]="auth.tiene(P.RNDC_OPERAR) ? '/manifiestos' : '/viajes'">
        <span class="icono"><app-icono nombre="enviar" /></span>
        <span class="etq">Por manifestar</span><span class="valor">{{ r() ? pendientes() : '—' }}</span>
        @if (pendientes() > 0) { <span class="nota">Pendientes de enviar al RNDC</span> }
      </a>
      <a class="indicador" [routerLink]="auth.tiene(P.RNDC_OPERAR) ? '/manifiestos' : '/viajes'">
        <span class="icono"><app-icono nombre="reloj" /></span>
        <span class="etq">Manifestados sin cumplir</span><span class="valor">{{ r()?.estados?.manifestado ?? 0 }}</span>
      </a>
      <div class="indicador mes">
        <span class="icono"><app-icono nombre="dinero" /></span>
        <span class="etq">Este mes · {{ r()?.mes?.viajes ?? 0 }} viajes</span>
        <span class="valor pequeno">{{ r()?.mes?.tarifa | pesos }}</span>
        <span class="nota">Tarifas facturables (COP) · Fletes {{ r()?.mes?.flete | pesos }}</span>
      </div>
    </div>

    <section class="tarjeta">
      <div class="cab"><h2><app-icono nombre="alerta" [tam]="18" />Documentos por vencer</h2><span class="sutil">Próximos 30 días</span></div>
      @if (alertas().length) {
        <div class="filtro-rapido"><input type="search" placeholder="Buscar placa, conductor o documento" aria-label="Buscar placa, conductor o documento" [value]="q()" (input)="q.set($any($event.target).value)" /></div>
        <div class="tabla-caja plana"><table><thead><tr><th>Documento</th><th>Referencia</th><th>Vence</th></tr></thead>
          <tbody>@for (a of alertasVisibles(); track $index) {
            <tr><td>{{ a.tipo }}</td><td>{{ a.referencia }}</td><td><span class="chip" [class.error]="vencido(a.vence)" [class.alerta]="!vencido(a.vence)">{{ vencido(a.vence) ? 'Vencido' : 'Vence' }} {{ a.vence | dia }}</span></td></tr>
          }</tbody></table>
          @if (alertas().length > alertasVisibles().length) {
            <div class="pie-lista"><span>{{ alertasVisibles().length }} de {{ alertas().length }} documentos</span>
              <button class="pequeno" (click)="limite.set(limite() + 15)">Ver más</button></div>
          }
        </div>
      } @else { <p class="vacio"><strong>Todo al día</strong>No hay licencias, SOAT ni revisiones tecnomecánicas por vencer.</p> }
    </section>`,
  styles: [`
    .bienvenida { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
    .saludo { margin: 0 0 4px; color: var(--gris-5); font-weight: 500; }
    .sub { margin: 6px 0 0; color: var(--gris-5); }
    .sub::first-letter { text-transform: uppercase; }

    .indicadores { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .indicador { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 18px; border-radius: var(--radio-l); background: var(--gris-0);
      border: 1px solid var(--gris-2); box-shadow: var(--sombra); text-decoration: none; color: inherit;
      transition: transform var(--transicion), box-shadow var(--transicion), border-color var(--transicion); }
    a.indicador:hover { border-color: var(--gris-4); }
    .icono { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--gris-1); color: var(--gris-7); margin-bottom: 8px; }
    .etq { color: var(--gris-5); font-size: 13px; }
    .valor { font-size: 32px; font-weight: 650; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .valor.pequeno { font-size: 22px; }
    .nota { font-size: 12px; color: var(--gris-5); }
    .indicador.atencion { box-shadow: inset 3px 0 0 var(--primario); }
    .indicador.atencion .icono { background: var(--primario-claro); color: var(--primario-texto); }
    .cab { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
    .cab h2 { display: flex; gap: 8px; align-items: center; margin: 0; }
    .tabla-caja.plana { box-shadow: none; }
  `],
})
export class Inicio {
  private api = inject(Api);
  readonly auth = inject(Auth);
  readonly P = P;
  readonly r = signal<any>(null);
  readonly alertas = signal<any[]>([]);
  readonly limite = signal(8);
  readonly q = signal('');
  readonly alertasVisibles = computed(() => filtrar(this.alertas(), this.q()).slice(0, this.limite()));
  readonly hoy = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  constructor() { this.cargar(); }
  cargar() {
    this.api.get('/viajes/resumen').then(x => this.r.set(x)).catch(() => {});
    this.api.get<any[]>('/maestros/alertas').then(x => this.alertas.set(x)).catch(() => {});
  }
  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['viajes', 'rndc', 'maestros'], () => this.cargar());
  primerNombre() { return (this.auth.usuario()?.nombre || '').split(' ')[0]; }
  saludo() { const h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches'; }
  pendientes() { const e = this.r()?.estados || {}; return (e.registrado || 0) + (e.remesa || 0); }
  vencido(f: string) { return new Date(f) < new Date(); }
}
