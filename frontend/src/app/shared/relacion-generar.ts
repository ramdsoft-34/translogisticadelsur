import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UpperCasePipe } from '@angular/common';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { FORMATOS } from './formato';
import { rangoPeriodo } from './exportar-viajes';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Quincenas del mes actual y del anterior, y el mes completo (la relación se hace después de terminar el periodo)
function periodos(hoy = new Date()) {
  const y = hoy.getFullYear(); const m = hoy.getMonth();
  const mes = (yy: number, mm: number) => new Date(yy, mm, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  const l: { t: string; desde: string; hasta: string }[] = [];
  for (const k of [-1, 0]) {
    const a = new Date(y, m + k, 1); const fin = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    l.push({ t: `1–15 ${mes(a.getFullYear(), a.getMonth())}`, desde: iso(a), hasta: iso(new Date(a.getFullYear(), a.getMonth(), 15)) });
    l.push({ t: `16–${fin.getDate()} ${mes(a.getFullYear(), a.getMonth())}`, desde: iso(new Date(a.getFullYear(), a.getMonth(), 16)), hasta: iso(fin) });
  }
  const a = new Date(y, m - 1, 1);
  l.push({ t: `Mes ${mes(a.getFullYear(), a.getMonth())}`, desde: iso(a), hasta: iso(new Date(y, m, 0)) });
  return l;
}

// Fase 11: Generar relación. Empresa + periodo + grupo → revisión automática → vista previa con el formato del Excel
// (un bloque por conductor y placa, la franja después del último viaje y un solo total) → guardar con número.
@Component({
  selector: 'app-relacion-generar',
  imports: [FormsModule, UpperCasePipe, ...FORMATOS],
  template: `
    <section class="tarjeta filtros">
      <div class="campo"><label for="rg-cli">Empresa</label>
        <select id="rg-cli" [(ngModel)]="f.cliente" (change)="cambioEmpresa()"><option value="">Seleccione…</option>
          @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
      <div class="campo"><span class="etiqueta">Periodo</span><div class="segmentos">
        @for (p of PERIODOS; track p.t) { <button type="button" [class.activo]="f.desde === p.desde && f.hasta === p.hasta" (click)="elegir(p)">{{ p.t }}</button> }</div></div>
      <div class="campo"><label for="rg-d">Desde</label><input id="rg-d" type="date" [(ngModel)]="f.desde" (change)="limpiar()" /></div>
      <div class="campo"><label for="rg-h">Hasta</label><input id="rg-h" type="date" [(ngModel)]="f.hasta" (change)="limpiar()" /></div>
      <div class="campo"><label for="rg-g">Grupo</label>
        <select id="rg-g" [(ngModel)]="f.grupo" (change)="limpiar()"><option value="">Todos los destinos</option>
          @for (g of grupos(); track g) { <option [value]="g">{{ g }}</option> }</select>
        @if (f.cliente && !grupos().length) { <small>Para separar Viajeros y TAT, ponga el grupo en cada destino (Clientes y tarifas).</small> }</div>
      <div class="campo"><span class="etiqueta">&nbsp;</span><button type="button" class="primario" (click)="previa()" [disabled]="!f.cliente || !f.desde || !f.hasta || ocupado()">
        {{ ocupado() ? 'Revisando…' : 'Revisar y ver la relación' }}</button></div>
    </section>

    @if (d(); as r) {
      <section class="tarjeta">
        <label class="campo"><span class="etiqueta">Título de la relación (se propone solo y se puede editar)</span>
          <input [(ngModel)]="titulo" maxlength="250" /></label>
      </section>

      <section class="tarjeta">
        <h3 class="sub">Revisión antes de generar <span class="sutil">· la plataforma revisa sola los viajes del periodo</span></h3>
        @for (a of r.revision; track $index) {
          <div class="aviso" [class.ok]="a.nivel === 'ok'" [class.info]="a.nivel === 'info'">
            <span class="ic">{{ a.nivel === 'aviso' ? '!' : a.nivel === 'ok' ? '✓' : 'i' }}</span>
            <span class="txt">{{ a.texto }}</span>
            @if (a.tipo === 'fecha' && a.sugerencia && puedeRegistrar) {
              <button type="button" class="pequeno" (click)="corregirFecha(a)" [disabled]="ocupado()">Corregir a {{ a.sugerencia | dia }}</button>
            }
            @if (a.tipo === 'nombre') { <a class="boton pequeno" href="/terceros" target="_blank" rel="noopener">Ver conductores</a> }
          </div>
        }
      </section>

      <section class="tarjeta">
        <div class="cifras">
          <div><span>Viajes</span><strong>{{ r.totales.viajes }}</strong></div>
          <div><span>Vehículos</span><strong>{{ r.totales.vehiculos }}</strong></div>
          <div><span>Tarifa</span><strong>{{ r.totales.tarifa | pesos }}</strong></div>
          <div><span>Auxiliar</span><strong>{{ r.totales.auxiliar | pesos }}</strong></div>
          <div class="total"><span>Total a facturar</span><strong>{{ r.totales.total | pesos }}</strong></div>
        </div>
        @if (r.existente) {
          <p class="nota">Ya existe la relación <strong>{{ r.existente.numero }}</strong> de este periodo ({{ r.existente.estado }}). Al guardar se actualiza con los viajes de hoy.@if (r.existente.estado === 'enviada') { Como ya se envió, si cambia queda como una versión nueva para reenviar; lo enviado se conserva. }</p>
        }
        <p class="sutil" style="margin:12px 0 6px">Vista previa con el formato del Excel</p>
        <div class="tabla-caja">
          <table class="rel">
            @for (g of r.grupos; track g.conductor + g.placa) {
              <tr class="cab"><th>N°</th><th>Nombre</th><th>Placa</th><th>Fecha</th><th>Planilla</th><th>Manifiesto</th><th>Destino</th><th>Días aux.</th>
                <th class="num">Tarifa</th><th class="num">Auxiliar</th><th class="num">Total</th></tr>
              @for (x of g.filas; track x._id) {
                <tr><td>{{ x.n }}</td><td>{{ x.conductor }}</td><td>{{ x.placa }}</td><td>{{ x.fecha | dia }}</td><td>{{ x.planilla }}</td><td>{{ x.manifiesto }}</td>
                  <td>{{ x.destino }}</td><td class="c">{{ x.diasAux ?? 'Bodega' }}</td><td class="num">{{ x.tarifa | pesos }}</td><td class="num">{{ x.auxiliar | pesos }}</td><td class="num">{{ x.total | pesos }}</td></tr>
              }
              <tr class="franja"><td colspan="11">{{ g.conductor | uppercase }} · PLACA {{ g.placa }} · {{ g.filas.length }} viaje(s)</td></tr>
            } @empty { <tr><td class="vacio">No hay viajes de esta empresa en el periodo</td></tr> }
            @if (r.grupos.length) {
              <tr class="franja total"><td colspan="8" class="der">TOTAL GENERAL DE LA RELACIÓN</td><td class="num">{{ r.totales.tarifa | pesos }}</td>
                <td class="num">{{ r.totales.auxiliar | pesos }}</td><td class="num">{{ r.totales.total | pesos }}</td></tr>
            }
          </table>
        </div>
        <div class="pie">
          <span class="sutil">El logo, el membrete y el NIT salen de Configuración → Membrete. Los archivos se descargan desde «Relaciones generadas».</span>
          @if (puedeGuardar) { <button type="button" class="primario" (click)="guardar()" [disabled]="!r.totales.viajes || ocupado()">
            {{ r.existente ? 'Actualizar relación ' + r.existente.numero : 'Guardar relación' }}</button> }
        </div>
      </section>
    }`,
  styles: [`
    .tarjeta { background: var(--gris-0, #fff); border: 1px solid var(--gris-2); border-radius: var(--radio-l, 14px); padding: 14px 16px; margin-bottom: 14px; }
    .filtros { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; } .filtros .campo { margin: 0; }
    .campo { display: flex; flex-direction: column; gap: 5px; } .campo input { width: 100%; }
    .aviso { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-radius: 10px; margin-top: 8px; background: var(--ambar-claro); }
    .aviso.ok { background: var(--verde-claro); } .aviso.info { background: var(--info-claro); }
    .aviso .ic { width: 22px; height: 22px; flex: none; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 12px; background: #c77700; }
    .aviso.ok .ic { background: var(--verde); } .aviso.info .ic { background: var(--info); } .aviso .txt { flex: 1; }
    .cifras { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
    .cifras div { border: 1px solid var(--gris-2); border-radius: 10px; padding: 8px 12px; } .cifras span { display: block; font-size: 12px; color: var(--gris-5); }
    .cifras strong { font-size: 18px; } .cifras .total { background: var(--primario-suave, #fff8e1); }
    table.rel { width: 100%; border-collapse: collapse; font-size: 12.5px; } table.rel td, table.rel th { padding: 5px 8px; border-bottom: 1px solid var(--gris-15, #f0f1f3); text-align: left; white-space: nowrap; }
    table.rel tr.cab th { background: var(--gris-1, #f1f3f6); font-size: 11.5px; color: var(--gris-6); }
    table.rel tr.franja td { background: var(--tinta); color: var(--gris-0); font-weight: 700; } table.rel tr.total td { font-size: 13.5px; }
    table.rel .num { text-align: right; } table.rel .c { text-align: center; } table.rel .der { text-align: right; }
    .pie { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-top: 12px; flex-wrap: wrap; }
    .nota { background: var(--info-claro); border-radius: 10px; padding: 8px 12px; margin: 12px 0 0; }
    @media (max-width: 800px) { .cifras { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class RelacionGenerar {
  private api = inject(Api); private avisos = inject(Avisos); private auth = inject(Auth);
  readonly clientes = input<any[]>([]);
  readonly guardada = output<any>();
  readonly puedeGuardar = this.auth.tiene(P.LIQUIDACION_GESTIONAR);
  readonly puedeRegistrar = this.auth.tiene(P.VIAJES_REGISTRAR);
  readonly PERIODOS = periodos();
  readonly grupos = signal<string[]>([]);
  readonly d = signal<any>(null);
  readonly ocupado = signal(false);
  f = { cliente: '', grupo: '', ...(rangoPeriodo('quincena')!) };
  titulo = '';

  async cambioEmpresa() {
    this.limpiar(); this.f.grupo = '';
    try { this.grupos.set(this.f.cliente ? await this.api.get<string[]>('/gestion/relaciones-cobro/grupos', { cliente: this.f.cliente }) : []); }
    catch (e) { this.avisos.error(e); }
  }
  elegir(p: { desde: string; hasta: string }) { this.f.desde = p.desde; this.f.hasta = p.hasta; this.limpiar(); }
  limpiar() { this.d.set(null); }
  async previa() {
    this.ocupado.set(true);
    try { const r = await this.api.post<any>('/gestion/relaciones-cobro/previa', this.f); this.d.set(r); this.titulo = r.titulo; }
    catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
  async corregirFecha(a: any) {
    this.ocupado.set(true);
    try {
      const r = await this.api.put<any>(`/gestion/relaciones-cobro/viaje/${a.viaje}/fecha`, { fecha: a.sugerencia });
      this.avisos.ok(`Viaje N° ${r.numero}: fecha corregida`);
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
    await this.previa();
  }
  async guardar() {
    this.ocupado.set(true);
    try {
      const r = await this.api.post<any>('/gestion/relaciones-cobro', { ...this.f, titulo: this.titulo });
      this.avisos.ok(`Relación ${r.numero} guardada · ${r.totales.viajes} viajes`);
      if (r.nuevaVersion) this.avisos.mostrar(`La relación ${r.numero} ya se había enviado: quedó como versión ${r.version} en borrador. Reenvíela; la versión enviada se conserva.`, 'info', 10000);
      this.guardada.emit(r);
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
}
