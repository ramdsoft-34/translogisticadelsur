import { Component, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { filtrar } from '../shared/filtro';

type Categoria = '' | 'sede' | 'importado' | 'licencia' | 'vehiculo';
const CATEGORIAS: [Categoria, string][] = [['', 'Todo'], ['sede', 'Sedes en centro poblado'], ['importado', 'Sin confirmar en el RNDC'],
  ['licencia', 'Licencias'], ['vehiculo', 'Vehículos y SOAT']];

// Datos que pueden causar rechazos del RNDC o un manifiesto incompleto, con corrección en lote.
@Component({
  selector: 'app-revision',
  imports: [FormsModule, Icono],
  template: `
    <div class="pagina-cab">
      <div><h1>Revisión de datos</h1>
        <p class="sutil">Sedes, conductores y vehículos que conviene corregir antes de expedir. Lo que se trae del RNDC queda igual a lo que el RNDC tiene registrado.</p></div>
      <div class="acciones"><button (click)="cargar()" [disabled]="cargando()"><app-icono nombre="reloj" [tam]="16" />Actualizar lista</button></div>
    </div>

    <section class="barra" aria-label="Filtros">
      <div class="campo"><span class="etiqueta">Mostrar</span>
        <div class="segmentos" role="group" aria-label="Categoría">
          @for (c of categorias; track c[0]) {
            <button type="button" [class.activo]="categoria() === c[0]" (click)="elegir(c[0])">{{ c[1] }} ({{ cuenta(c[0]) }})</button>
          }
        </div></div>
      <div class="campo crece"><label for="r-q">Buscar</label>
        <input id="r-q" type="search" placeholder="Nombre, documento, placa o problema" [ngModel]="texto()" (ngModelChange)="texto.set($event)" /></div>
    </section>

    @if (seleccion().size) {
      <div class="mensaje info acciones-lote">
        <strong>{{ seleccion().size }} seleccionado(s)</strong>
        @if (seleccionSedes().length && puedeEditar) {
          <button type="button" class="primario pequeno" (click)="aplicarSedes()" [disabled]="trabajando()">Usar el centro poblado sugerido ({{ seleccionSedes().length }})</button>
        }
        @if (puedeRndc) {
          <button type="button" class="pequeno" [class.primario]="!seleccionSedes().length" (click)="traerRndc()" [disabled]="trabajando()">
            <app-icono nombre="enviar" [tam]="14" />{{ trabajando() && progreso() ? progreso() : 'Actualizar desde el RNDC' }}</button>
        }
        <button type="button" class="pequeno texto" (click)="limpiarSeleccion()">Quitar selección</button>
      </div>
    }

    <div class="tabla-caja">
      <table class="tabla-movil">
        <thead><tr><th><input type="checkbox" aria-label="Seleccionar todo" [checked]="todos()" (change)="alternarTodos()" /></th>
          <th>Tipo</th><th>Registro</th><th>Problema</th><th>Sugerencia</th></tr></thead>
        <tbody>
          @for (x of visibles(); track x.categoria + x.id) {
            <tr>
              <td data-etiqueta="Elegir"><input type="checkbox" [attr.aria-label]="'Seleccionar ' + x.referencia" [checked]="seleccion().has(clave(x))" (change)="alternar(x)" /></td>
              <td data-etiqueta="Tipo"><span class="chip sin-punto">{{ nombreCategoria(x.categoria) }}</span></td>
              <td data-etiqueta="Registro"><strong>{{ x.referencia }}</strong></td>
              <td data-etiqueta="Problema">{{ x.problema }}</td>
              <td data-etiqueta="Sugerencia">{{ x.sugerencia ? x.sugerencia.codigo + ' · ' + x.sugerencia.nombre : '—' }}</td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="vacio">{{ cargando() ? 'Revisando…' : 'Nada pendiente en esta categoría' }}</td></tr>
          }
        </tbody>
      </table>
    </div>`,
  styles: [`
    .acciones-lote { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 12px; }
  `],
})
export class Revision {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private auth = inject(Auth);
  private claveRndc = inject(RndcClave);
  readonly puedeEditar = this.auth.tiene(P.MAESTROS_EDITAR);
  readonly puedeRndc = this.auth.tiene(P.MAESTROS_EDITAR) && (this.auth.tiene(P.RNDC_OPERAR) || this.auth.tiene(P.RNDC_CONSULTAR));
  readonly categorias = CATEGORIAS;
  readonly items = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly progreso = signal('');
  readonly categoria = signal<Categoria>('');
  readonly texto = signal('');
  readonly seleccion = signal(new Set<string>());
  readonly visibles = computed(() => filtrar(this.items().filter(x => !this.categoria() || x.categoria === this.categoria()), this.texto()));
  readonly seleccionados = computed(() => this.items().filter(x => this.seleccion().has(this.clave(x))));
  readonly seleccionSedes = computed(() => this.seleccionados().filter(x => x.categoria === 'sede' && x.sugerencia));
  readonly todos = computed(() => this.visibles().length > 0 && this.visibles().every(x => this.seleccion().has(this.clave(x))));

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['maestros', 'rndc'], () => this.cargar());

  constructor() { this.cargar(); }

  clave(x: any) { return `${x.categoria}|${x.id}`; }
  cuenta(c: Categoria) { return c ? this.items().filter(x => x.categoria === c).length : this.items().length; }
  nombreCategoria(c: Categoria) { return ({ sede: 'Sede', importado: 'Sin confirmar', licencia: 'Licencia', vehiculo: 'Vehículo' } as Record<string, string>)[c] || c; }
  elegir(c: Categoria) { this.categoria.set(c); this.limpiarSeleccion(); }
  limpiarSeleccion() { this.seleccion.set(new Set()); }
  alternar(x: any) { const s = new Set(this.seleccion()); const k = this.clave(x); if (s.has(k)) s.delete(k); else s.add(k); this.seleccion.set(s); }
  alternarTodos() {
    const s = new Set(this.seleccion());
    const todos = this.todos();
    for (const x of this.visibles()) { if (todos) s.delete(this.clave(x)); else s.add(this.clave(x)); }
    this.seleccion.set(s);
  }

  async cargar() {
    this.cargando.set(true);
    try { this.items.set((await this.api.get<any>('/maestros/revision')).items); this.limpiarSeleccion(); }
    catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async aplicarSedes() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/maestros/revision/sedes', { cambios: this.seleccionSedes().map(x => ({ id: x.id, codMunicipio: x.sugerencia.codigo })) });
      this.avisos.ok(`${r.corregidas} sede(s) corregida(s)`);
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // Trae del RNDC los terceros (todas sus sedes) y vehículos seleccionados, de a 30 por solicitud
  async traerRndc() {
    const c = await this.claveRndc.obtener();
    if (!c) return;
    const sel = this.seleccionados();
    const terceros = [...new Map(sel.filter(x => x.tipo === 'tercero').map(x => [`${x.tipoId}|${x.numId}`, { tipoId: x.tipoId, numId: x.numId }])).values()];
    const placas = [...new Set(sel.filter(x => x.tipo === 'vehiculo').map(x => x.placa as string))];
    const total = terceros.length + placas.length;
    this.trabajando.set(true);
    let ok = 0; let fallos = 0;
    try {
      for (let i = 0; i < terceros.length; i += 30) {
        this.progreso.set(`Consultando ${i + 1}–${Math.min(i + 30, terceros.length)} de ${total}…`);
        const r = await this.api.post<any[]>('/rndc/importar/terceros', { clave: c, documentos: terceros.slice(i, i + 30) });
        ok += r.filter(x => x.ok).length; fallos += r.filter(x => !x.ok).length;
        if (r.some(x => !x.ok && /contrase|clave|password|autentic|usuario (no |inv|o |y )/i.test(x.mensaje || ''))) { this.claveRndc.olvidar(); throw new Error('El RNDC no aceptó el usuario o la contraseña'); }
      }
      for (let i = 0; i < placas.length; i += 30) {
        this.progreso.set(`Consultando ${terceros.length + i + 1}–${terceros.length + Math.min(i + 30, placas.length)} de ${total}…`);
        const r = await this.api.post<any[]>('/rndc/importar/vehiculos', { clave: c, placas: placas.slice(i, i + 30) });
        ok += r.filter(x => x.ok).length; fallos += r.filter(x => !x.ok).length;
      }
      this.avisos.ok(`${ok} actualizado(s) desde el RNDC${fallos ? ` · ${fallos} sin datos en el RNDC` : ''}`);
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); this.progreso.set(''); }
  }
}
