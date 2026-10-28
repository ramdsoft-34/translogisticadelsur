import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { filtrar } from '../shared/filtro';

const OPCIONES: Record<string, { texto: string; filtros: [string, string][] ; rango: boolean }> = {
  manifiesto: { texto: 'Manifiestos', filtros: [['NUMMANIFIESTOCARGA', 'N° manifiesto'], ['NUMPLACA', 'Placa'], ['INGRESOID', 'Radicado']], rango: true },
  remesa: { texto: 'Remesas', filtros: [['CONSECUTIVOREMESA', 'N° remesa'], ['INGRESOID', 'Radicado']], rango: true },
  cumplidoManifiesto: { texto: 'Cumplidos de manifiesto', filtros: [['NUMMANIFIESTOCARGA', 'N° manifiesto'], ['INGRESOID', 'Radicado']], rango: true },
  cumplidoRemesa: { texto: 'Cumplidos de remesa', filtros: [['CONSECUTIVOREMESA', 'N° remesa'], ['INGRESOID', 'Radicado']], rango: true },
  vehiculo: { texto: 'Vehículo', filtros: [['NUMPLACA', 'Placa']], rango: false },
  tercero: { texto: 'Tercero', filtros: [['CODTIPOIDTERCERO', 'Tipo doc. (C, N, E…)'], ['NUMIDTERCERO', 'Documento']], rango: false },
};

@Component({
  selector: 'app-consultas-rndc',
  imports: [FormsModule],
  template: `
    <div class="pagina-cab"><div><h1>Consultas al RNDC</h1><p class="sutil">Consulte lo que el RNDC tiene registrado para su empresa: terceros, vehículos, remesas, manifiestos y cumplidos.</p></div></div>
    @if (ambiente() === 'SIMULADO') {
      <div class="mensaje alerta" style="margin-bottom:14px">Ambiente: <strong>simulador local</strong>. Estas consultas NO van al Ministerio, por eso no aparecen
        sus manifiestos ni vehículos reales. El administrador cambia el ambiente en Configuración → Conexión RNDC (y debe pulsar «Guardar configuración»).</div>
    } @else if (ambiente()) {
      <div class="mensaje info" style="margin-bottom:14px">Ambiente: <strong>{{ ambiente() === 'PRODUCCION' ? 'producción del Ministerio' : 'pruebas del Ministerio' }}</strong>.</div>
    }
    <div class="tarjeta">
      <div class="filtros" style="margin:0">
        <div class="campo"><label for="c-que">Consultar</label><select id="c-que" [(ngModel)]="que" (change)="filtros = {}; resultado.set(null)">
          @for (o of opciones; track o[0]) { <option [value]="o[0]">{{ o[1].texto }}</option> }</select></div>
        @for (f of actual().filtros; track f[0]) {
          <div class="campo"><label [for]="'c-' + f[0]">{{ f[1] }}</label><input [id]="'c-' + f[0]" [(ngModel)]="filtros[f[0]]" /></div>
        }
        @if (actual().rango) {
          <div class="campo"><label for="c-d">Registrado desde</label><input id="c-d" type="date" [(ngModel)]="desde" /></div>
          <div class="campo"><label for="c-h">Hasta</label><input id="c-h" type="date" [(ngModel)]="hasta" /></div>
        }
        <button class="primario" (click)="consultar()" [disabled]="cargando()">{{ cargando() ? 'Consultando…' : 'Consultar' }}</button>
      </div>
    </div>
    @if (resultado(); as r) {
      <div class="tarjeta">
        <p class="sutil" style="margin-top:0">Respondió: {{ r.url }}</p>
        @if (!r.ok) { <div class="mensaje error">{{ r.mensaje }}</div> }
        @else if (!r.documentos.length) { <p class="sutil">El RNDC no devolvió registros.</p> }
        @else {
          <div class="filtro-rapido"><input type="search" placeholder="Buscar en los resultados" aria-label="Buscar en los resultados" [value]="q()" (input)="q.set($any($event.target).value)" /></div>
          <div class="tabla-caja" style="box-shadow:none"><table>
            <thead><tr>@for (c of columnas(); track c) { <th>{{ c }}</th> }</tr></thead>
            <tbody>@for (d of documentosVisibles(); track $index) { <tr>@for (c of columnas(); track c) { <td>{{ d[c] }}</td> }</tr> }</tbody>
          </table></div>
        }
        <details style="margin-top:12px"><summary class="sutil">Ver solicitud enviada (sin contraseña)</summary><pre>{{ r.solicitud }}</pre></details>
      </div>
    }`,
  styles: ['pre { white-space: pre-wrap; word-break: break-all; font-size: 12px; background: var(--gris-1); padding: 10px; border-radius: 8px; }'],
})
export class ConsultasRndc {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly opciones = Object.entries(OPCIONES);
  que = 'manifiesto';
  filtros: Record<string, string> = {};
  desde = ''; hasta = '';
  readonly resultado = signal<any>(null);
  // El ambiente viene en el perfil de la sesión (no requiere permiso de configuración)
  private auth = inject(Auth);
  readonly ambiente = computed(() => this.auth.usuario()?.empresa?.ambienteRndc || '');
  readonly cargando = signal(false);
  readonly q = signal('');
  readonly documentosVisibles = computed(() => filtrar<any>(this.resultado()?.documentos || [], this.q()));
  readonly columnas = computed(() => Object.keys(this.resultado()?.documentos?.[0] || {}));
  actual() { return OPCIONES[this.que]; }

  async consultar() {
    const c = await this.clave.obtener();
    if (!c) return;
    this.cargando.set(true);
    try {
      const r = await this.api.post<any>('/rndc/consultar', { clave: c, que: this.que, filtros: this.filtros,
        ...(this.desde && this.hasta ? { desde: this.desde, hasta: this.hasta } : {}) });
      if (!r.ok && /contrase|clave|password|autentic|usuario (no |inv|o |y )/i.test(r.mensaje)) this.clave.olvidar();
      this.resultado.set(r);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
}
