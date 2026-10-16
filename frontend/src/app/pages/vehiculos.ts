import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { P, TIPOS_ID, nombreTercero } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { FORMATOS, isoDia } from '../shared/formato';
import { ImportarExcel } from '../shared/importar-excel';
import { TraerRndc } from '../shared/traer-rndc';
import { CargarMas } from '../shared/cargar-mas';
import { BuscarTercero } from '../shared/buscar-tercero';

const vacio = () => ({
  placa: '', clase: 'vehiculo', configuracion: '', configuracionNombre: '', marca: '', marcaNombre: '', linea: '', ejes: null, modelo: null,
  color: '', carroceria: '', combustible: '', pesoVacio: null, capacidad: null, pbv: null, unidadMedida: '1',
  soat: { numero: '', vence: '', aseguradoraNit: '' }, aseguradoraSoat: '', venceTecnomecanica: '',
  propietario: { tipoId: 'C', numId: '' }, tenedor: { tipoId: 'C', numId: '' }, conductorHabitual: '', titularHabitual: '', activo: true,
});

@Component({
  selector: 'app-vehiculos',
  imports: [FormsModule, Modal, Icono, ImportarExcel, TraerRndc, CargarMas, BuscarTercero, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Vehículos</h1><p class="sutil">Vehículos y remolques con sus documentos. Los códigos (configuración, marca, línea…) son los de las tablas del RNDC.</p></div>
      <div class="acciones">
        @if (puedeEditar) {
          <button (click)="importar.set(true)"><app-icono nombre="descargar" />Importar Excel</button>
          @if (puedeRndc) { <button (click)="traer.set(true)"><app-icono nombre="buscar" />Traer del RNDC</button> }
          <button class="primario" (click)="nuevo()"><app-icono nombre="mas" />Nuevo vehículo</button>
        }
      </div>
    </div>
    <app-importar-excel tipo="vehiculos" titulo="vehículos" [abierto]="importar()" (cerrar)="importar.set(false)" (importado)="cargar()" />
    <app-traer-rndc tipo="vehiculos" [abierto]="traer()" (cerrar)="traer.set(false)" (traidos)="cargar()" />
    <div class="barra"><div class="campo crece"><label for="v-q">Buscar placa</label>
      <input id="v-q" type="search" placeholder="ABC123" [(ngModel)]="q" (input)="buscarDiferido()" style="text-transform:uppercase" /></div></div>
    <div class="tabla-caja">
      <table>
        <thead><tr><th>Placa</th><th>Clase</th><th>Config.</th><th>Conductor habitual</th><th>SOAT vence</th><th>Tecnomecánica</th><th>RNDC</th><th></th></tr></thead>
        <tbody>
          @for (v of lista(); track v._id) {
            <tr [class.sutil]="!v.activo">
              <td><span class="placa">{{ v.placa }}</span></td><td>{{ v.clase === 'remolque' ? 'Remolque' : 'Vehículo' }}</td><td>{{ v.configuracionNombre || v.configuracion }}</td>
              <td>{{ nombre(v.conductorHabitual) }}</td>
              <td><span [class.chip]="vencida(v.soat?.vence)" [class.error]="vencida(v.soat?.vence)">{{ v.soat?.vence | dia }}</span></td>
              <td><span [class.chip]="vencida(v.venceTecnomecanica)" [class.error]="vencida(v.venceTecnomecanica)">{{ v.venceTecnomecanica | dia }}</span></td>
              <td><span class="chip" [class]="chip(v.rndc?.estado)" [title]="v.rndc?.mensaje || ''">{{ estadoRndc(v.rndc?.estado) }}</span></td>
              <td><div class="acciones" style="justify-content:flex-end">
                <button class="pequeno" (click)="editar(v)">{{ puedeEditar ? 'Editar' : 'Ver' }}</button>
                @if (puedeRndc) { <button class="pequeno" (click)="enviar(v)" [disabled]="trabajando()"><app-icono nombre="enviar" [tam]="15" />RNDC</button> }
              </div></td>
            </tr>
          } @empty {
            @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="8"><span class="esqueleto"></span></td></tr> } }
            @else { <tr><td colspan="8" class="vacio"><strong>Sin vehículos</strong>Registre uno nuevo, impórtelos desde Excel o tráigalos del RNDC.</td></tr> }
          }
        </tbody>
      </table>
      @if (lista().length) { <app-cargar-mas [mostrados]="lista().length" [total]="total()" [cargando]="cargandoMas()" unidad="vehículos" (mas)="cargarMas()" /> }
    </div>

    <app-modal [titulo]="editando() ? 'Vehículo ' + form().placa : 'Nuevo vehículo'" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @let f = form();
      <form id="form-veh" (ngSubmit)="guardar()">
        <div class="formulario">
          <div class="campo"><label for="vp">Placa</label><input id="vp" name="placa" [(ngModel)]="f.placa" [disabled]="editando()" required style="text-transform:uppercase" /></div>
          <div class="campo"><label for="vc">Clase</label><select id="vc" name="clase" [(ngModel)]="f.clase"><option value="vehiculo">Vehículo (camión / tractocamión)</option><option value="remolque">Remolque / semirremolque</option></select></div>
          <div class="campo"><label for="vcn">Configuración (para el QR)</label><input id="vcn" name="confN" maxlength="4" placeholder="2, 3, 2S2, 3S3…" [(ngModel)]="f.configuracionNombre" /></div>
          <div class="campo"><label for="vcc">Código configuración RNDC</label><input id="vcc" name="conf" maxlength="2" [(ngModel)]="f.configuracion" /></div>
          <div class="campo"><label for="vm">Código marca RNDC</label><input id="vm" name="marca" [(ngModel)]="f.marca" /></div>
          <div class="campo"><label for="vmn">Marca (nombre)</label><input id="vmn" name="marcaN" [(ngModel)]="f.marcaNombre" /></div>
          <div class="campo"><label for="vl">Código línea RNDC</label><input id="vl" name="linea" [(ngModel)]="f.linea" /></div>
          <div class="campo"><label for="vmo">Modelo (año)</label><input id="vmo" type="number" name="modelo" [(ngModel)]="f.modelo" /></div>
          <div class="campo"><label for="vco">Código color RNDC</label><input id="vco" name="color" [(ngModel)]="f.color" /></div>
          <div class="campo"><label for="vca">Código carrocería RNDC</label><input id="vca" name="carroceria" [(ngModel)]="f.carroceria" /></div>
          <div class="campo"><label for="vcb">Código combustible RNDC</label><input id="vcb" name="comb" [(ngModel)]="f.combustible" /></div>
          <div class="campo"><label for="vej">Ejes</label><input id="vej" type="number" name="ejes" [(ngModel)]="f.ejes" /></div>
          <div class="campo"><label for="vpv">Peso vacío (kg)</label><input id="vpv" type="number" name="pv" [(ngModel)]="f.pesoVacio" /></div>
          <div class="campo"><label for="vpb">Peso bruto vehicular (kg)</label><input id="vpb" type="number" name="pbv" [(ngModel)]="f.pbv" /></div>
          <div class="campo"><label for="vcp">Capacidad (kg)</label><input id="vcp" type="number" name="cap" [(ngModel)]="f.capacidad" /></div>
          <app-buscar-tercero etiqueta="Conductor habitual" rol="conductor" [(valor)]="f.conductorHabitual" />
          <app-buscar-tercero etiqueta="Titular habitual del manifiesto" [(valor)]="f.titularHabitual" placeholder="Vacío = el conductor" />
        </div>
        <fieldset style="margin-top:14px"><legend>Documentos</legend><div class="formulario">
          <div class="campo"><label for="sn">N° póliza SOAT</label><input id="sn" name="soatN" [(ngModel)]="f.soat.numero" /></div>
          <div class="campo"><label for="sv">SOAT vence</label><input id="sv" type="date" name="soatV" [(ngModel)]="f.soat.vence" /></div>
          <div class="campo"><label for="sa">NIT aseguradora SOAT</label><input id="sa" name="soatA" [(ngModel)]="f.soat.aseguradoraNit" /></div>
          <div class="campo"><label for="san">Aseguradora (nombre)</label><input id="san" name="soatAN" [(ngModel)]="f.aseguradoraSoat" /></div>
          <div class="campo"><label for="tv">Tecnomecánica vence</label><input id="tv" type="date" name="tecno" [(ngModel)]="f.venceTecnomecanica" /></div>
        </div></fieldset>
        <fieldset style="margin-top:14px"><legend>Propietario y tenedor (deben existir como terceros en el RNDC)</legend><div class="formulario">
          <div class="campo"><label for="pt">Tipo doc. propietario</label><select id="pt" name="pt" [(ngModel)]="f.propietario.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo"><label for="pn">Documento propietario</label><input id="pn" name="pn" [(ngModel)]="f.propietario.numId" /></div>
          <div class="campo"><label for="tt">Tipo doc. tenedor</label><select id="tt" name="tt" [(ngModel)]="f.tenedor.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo"><label for="tn">Documento tenedor</label><input id="tn" name="tn" [(ngModel)]="f.tenedor.numId" /></div>
        </div></fieldset>
        @if (editando()) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
      </form>
      <ng-container pie>
        <button type="button" (click)="abierto.set(false)">Cancelar</button>
        @if (puedeEditar) { <button class="primario" type="submit" form="form-veh" [disabled]="trabajando()">Guardar</button> }
      </ng-container>
    </app-modal>`,
})
export class Vehiculos {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly puedeEditar = this.auth.tiene(P.MAESTROS_EDITAR);
  readonly puedeRndc = this.auth.tiene(P.RNDC_OPERAR);
  readonly tipos = Object.entries(TIPOS_ID);
  readonly lista = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly abierto = signal(false);
  readonly importar = signal(false);
  readonly traer = signal(false);
  readonly form = signal<any>(vacio());
  readonly editando = computed(() => !!this.form()._id);
  q = '';
  nombre = nombreTercero;

  constructor() {
    this.cargar();
  }


  // ── Paginación con carga progresiva ──
  private pagina = 1;
  readonly total = signal(0);
  readonly cargandoMas = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  buscarDiferido() { clearTimeout(this.temporizador); this.temporizador = setTimeout(() => this.cargar(), 300); }

  async cargar() {
    this.cargando.set(true);
    this.pagina = 1;
    try {
      const r = await this.api.get<any>('/maestros/vehiculos', { q: this.q, pagina: 1, limite: 50 });
      this.lista.set(r.items); this.total.set(r.total);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async cargarMas() {
    if (this.cargandoMas() || this.lista().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/maestros/vehiculos', { q: this.q, pagina: this.pagina + 1, limite: 50 });
      this.pagina += 1;
      this.lista.update(l => [...l, ...r.items]);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoMas.set(false); }
  }

  vencida(f: string) { return !!f && new Date(f) < new Date(); }
  chip(e: string) { return ({ enviado: 'ok', error: 'error' } as Record<string, string>)[e] || 'alerta'; }
  estadoRndc(e: string) { return ({ enviado: 'Sincronizado', error: 'Con error' } as Record<string, string>)[e] || 'Pendiente'; }

  nuevo() { this.form.set(vacio()); this.abierto.set(true); }
  editar(v: any) {
    const b = vacio();
    this.form.set({ ...b, ...v, soat: { ...b.soat, ...v.soat, vence: isoDia(v.soat?.vence) }, venceTecnomecanica: isoDia(v.venceTecnomecanica),
      propietario: { ...b.propietario, ...v.propietario }, tenedor: { ...b.tenedor, ...v.tenedor }, conductorHabitual: v.conductorHabitual?._id || '', titularHabitual: v.titularHabitual?._id || v.titularHabitual || '' });
    this.abierto.set(true);
  }

  async guardar() {
    const f = this.form();
    const campos = ['placa', 'clase', 'configuracion', 'configuracionNombre', 'marca', 'marcaNombre', 'linea', 'ejes', 'modelo', 'color',
      'carroceria', 'combustible', 'pesoVacio', 'capacidad', 'pbv', 'unidadMedida', 'aseguradoraSoat', 'propietario', 'tenedor', 'activo'];
    const cuerpo: any = Object.fromEntries(campos.map(k => [k, f[k]]));
    cuerpo.placa = String(f.placa).toUpperCase();
    cuerpo.soat = { ...f.soat, vence: f.soat.vence || null };
    cuerpo.venceTecnomecanica = f.venceTecnomecanica || null;
    cuerpo.conductorHabitual = f.conductorHabitual || null;
    cuerpo.titularHabitual = f.titularHabitual || null;
    this.trabajando.set(true);
    try {
      if (f._id) await this.api.put(`/maestros/vehiculos/${f._id}`, cuerpo); else await this.api.post('/maestros/vehiculos', cuerpo);
      this.avisos.ok('Vehículo guardado');
      this.abierto.set(false); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async enviar(v: any) {
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/rndc/vehiculos/${v._id}/enviar`, { clave: c });
      if (r.sinCambios) this.avisos.mostrar(r.mensaje, 'info');
      else if (r.ok) this.avisos.ok(`Vehículo ${v.placa} registrado en el RNDC`);
      else this.avisos.mostrar(`El RNDC rechazó el registro: ${r.mensaje}`, 'error');
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
