import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { P, TIPOS_ID, nombreTercero } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { SelectorMunicipio } from '../shared/municipio';
import { FORMATOS, isoDia } from '../shared/formato';
import { ImportarExcel } from '../shared/importar-excel';
import { TraerRndc } from '../shared/traer-rndc';
import { CargarMas } from '../shared/cargar-mas';

const ROLES: [string, string][] = [['conductor', 'Conductor'], ['titular', 'Titular de manifiesto'], ['propietario', 'Propietario'],
  ['tenedor', 'Tenedor'], ['remitente', 'Remitente'], ['destinatario', 'Destinatario']];

const vacio = () => ({
  tipoId: 'C', numId: '', nombres: '', apellido1: '', apellido2: '', sede: { codigo: '', nombre: '' }, telefono: '', celular: '',
  direccion: '', codMunicipio: '', correo: '', licencia: { categoria: '', numero: '', vence: '' }, fechaNacimiento: '',
  banco: { entidad: '', tipoCuenta: '', cuenta: '' }, roles: ['conductor'] as string[], activo: true,
});

@Component({
  selector: 'app-terceros',
  imports: [FormsModule, Modal, Icono, SelectorMunicipio, ImportarExcel, TraerRndc, CargarMas, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Conductores y terceros</h1><p class="sutil">Conductores, titulares, propietarios, tenedores y destinatarios que se registran en el RNDC.</p></div>
      <div class="acciones">
        @if (puedeEditar) {
          <button (click)="importar.set(true)"><app-icono nombre="descargar" />Importar Excel</button>
          @if (puedeRndc) { <button (click)="traer.set(true)"><app-icono nombre="buscar" />Traer del RNDC</button> }
          <button class="primario" (click)="nuevo()"><app-icono nombre="mas" />Nuevo tercero</button>
        }
      </div>
    </div>
    <app-importar-excel tipo="terceros" titulo="conductores y terceros" [abierto]="importar()" (cerrar)="importar.set(false)" (importado)="cargar()" />
    <app-traer-rndc tipo="terceros" [abierto]="traer()" (cerrar)="traer.set(false)" (traidos)="cargar()" />
    <div class="barra">
      <div class="campo crece"><label for="t-q">Buscar</label><input id="t-q" type="search" placeholder="Nombre o número de documento" [(ngModel)]="q" (input)="buscarDiferido()" /></div>
      <div class="campo"><label for="t-rol">Rol</label><select id="t-rol" [(ngModel)]="rol" (change)="cargar()"><option value="">Todos</option>
        @for (r of roles; track r[0]) { <option [value]="r[0]">{{ r[1] }}</option> }</select></div>
    </div>
    <div class="tabla-caja">
      <table>
        <thead><tr><th>Documento</th><th>Nombre</th><th>Roles</th><th>Celular</th><th>Licencia vence</th><th>RNDC</th><th></th></tr></thead>
        <tbody>
          @for (t of lista(); track t._id) {
            <tr [class.sutil]="!t.activo">
              <td>{{ t.tipoId }} {{ t.numId }}</td><td><strong>{{ nombre(t) }}</strong>@if (!t.activo) { <span class="chip">inactivo</span> }</td>
              <td>{{ t.roles.join(', ') }}</td><td>{{ t.celular }}</td>
              <td>@if (t.licencia?.vence) { <span [class.chip]="vencida(t.licencia.vence)" [class.error]="vencida(t.licencia.vence)">{{ t.licencia.vence | dia }}</span> }</td>
              <td><span class="chip" [class]="chip(t.rndc?.estado)" [title]="t.rndc?.mensaje || ''">{{ estadoRndc(t.rndc?.estado) }}</span></td>
              <td><div class="acciones" style="justify-content:flex-end">
                <button class="pequeno" (click)="editar(t)">{{ puedeEditar ? 'Editar' : 'Ver' }}</button>
                @if (puedeRndc) { <button class="pequeno" (click)="enviar(t)" [disabled]="trabajando()" title="Registrar o actualizar en el RNDC"><app-icono nombre="enviar" [tam]="15" />RNDC</button> }
              </div></td>
            </tr>
          } @empty {
            @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="7"><span class="esqueleto"></span></td></tr> } }
            @else { <tr><td colspan="7" class="vacio"><strong>Sin resultados</strong>Pruebe con otro nombre o documento.</td></tr> }
          }
        </tbody>
      </table>
      @if (lista().length) { <app-cargar-mas [mostrados]="lista().length" [total]="total()" [cargando]="cargandoMas()" unidad="terceros" (mas)="cargarMas()" /> }
    </div>

    <app-modal [titulo]="editando() ? 'Editar tercero' : 'Nuevo tercero'" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @let f = form();
      <form id="form-tercero" (ngSubmit)="guardar()">
        <div class="formulario">
          <div class="campo"><label for="tt">Tipo de documento</label><select id="tt" name="tipoId" [(ngModel)]="f.tipoId" [disabled]="editando()">
            @for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo"><label for="tn">Número</label><input id="tn" name="numId" [(ngModel)]="f.numId" [disabled]="editando()" required />
            @if (f.tipoId === 'N') { <small>NIT con dígito de verificación, sin guion.</small> }</div>
          <div class="campo"><label for="tno">{{ f.tipoId === 'N' ? 'Razón social' : 'Nombres' }}</label><input id="tno" name="nombres" [(ngModel)]="f.nombres" required /></div>
          @if (f.tipoId !== 'N') {
            <div class="campo"><label for="ta1">Primer apellido</label><input id="ta1" name="ap1" [(ngModel)]="f.apellido1" required /></div>
            <div class="campo"><label for="ta2">Segundo apellido</label><input id="ta2" name="ap2" [(ngModel)]="f.apellido2" /></div>
          } @else {
            <div class="campo"><label for="ts">Código de sede</label><input id="ts" name="sede" maxlength="6" [(ngModel)]="f.sede.codigo" /></div>
            <div class="campo"><label for="tsn">Nombre de sede</label><input id="tsn" name="sedeN" maxlength="20" [(ngModel)]="f.sede.nombre" /></div>
          }
          <div class="campo"><label for="tcel">Celular</label><input id="tcel" name="cel" maxlength="10" [(ngModel)]="f.celular" /></div>
          <div class="campo"><label for="ttel">Teléfono fijo</label><input id="ttel" name="tel" maxlength="7" [(ngModel)]="f.telefono" /></div>
          <div class="campo"><label for="tdir">Dirección</label><input id="tdir" name="dir" maxlength="60" [(ngModel)]="f.direccion" /></div>
          <app-municipio etiqueta="Municipio" [(codigo)]="f.codMunicipio" />
          <div class="campo ancho"><span class="etiqueta">Roles</span><div class="acciones">
            @for (r of roles; track r[0]) { <label class="casilla"><input type="checkbox" [checked]="f.roles.includes(r[0])" (change)="alternarRol(r[0])" />{{ r[1] }}</label> }
          </div></div>
        </div>
        @if (f.roles.includes('conductor')) {
          <fieldset style="margin-top:14px"><legend>Licencia de conducción</legend><div class="formulario">
            <div class="campo"><label for="lc">Categoría</label><input id="lc" name="lcat" maxlength="3" [(ngModel)]="f.licencia.categoria" /></div>
            <div class="campo"><label for="ln">Número</label><input id="ln" name="lnum" [(ngModel)]="f.licencia.numero" /></div>
            <div class="campo"><label for="lv">Vence</label><input id="lv" type="date" name="lven" [(ngModel)]="f.licencia.vence" /></div>
            <div class="campo"><label for="fn">Fecha de nacimiento</label><input id="fn" type="date" name="fnac" [(ngModel)]="f.fechaNacimiento" /></div>
          </div></fieldset>
          <fieldset style="margin-top:14px"><legend>Cuenta para pagos</legend><div class="formulario">
            <div class="campo"><label for="be">Banco</label><input id="be" name="banco" [(ngModel)]="f.banco.entidad" /></div>
            <div class="campo"><label for="bt">Tipo</label><select id="bt" name="btipo" [(ngModel)]="f.banco.tipoCuenta"><option value=""></option><option>Ahorros</option><option>Corriente</option></select></div>
            <div class="campo"><label for="bc">Número de cuenta</label><input id="bc" name="bcta" [(ngModel)]="f.banco.cuenta" /></div>
          </div></fieldset>
        }
        @if (editando()) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
      </form>
      <ng-container pie>
        <button type="button" (click)="abierto.set(false)">Cancelar</button>
        @if (puedeEditar) { <button class="primario" type="submit" form="form-tercero" [disabled]="trabajando()">Guardar</button> }
      </ng-container>
    </app-modal>`,
})
export class Terceros {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly puedeEditar = this.auth.tiene(P.MAESTROS_EDITAR);
  readonly puedeRndc = this.auth.tiene(P.RNDC_OPERAR);
  readonly roles = ROLES;
  readonly tipos = Object.entries(TIPOS_ID);
  readonly lista = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly abierto = signal(false);
  readonly importar = signal(false);
  readonly traer = signal(false);
  readonly form = signal<any>(vacio());
  readonly editando = computed(() => !!this.form()._id);
  q = ''; rol = '';
  nombre = nombreTercero;

  constructor() { this.cargar(); }


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
      const r = await this.api.get<any>('/maestros/terceros', { q: this.q, rol: this.rol, pagina: 1, limite: 50 });
      this.lista.set(r.items); this.total.set(r.total);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async cargarMas() {
    if (this.cargandoMas() || this.lista().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/maestros/terceros', { q: this.q, rol: this.rol, pagina: this.pagina + 1, limite: 50 });
      this.pagina += 1;
      this.lista.update(l => [...l, ...r.items]);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoMas.set(false); }
  }

  vencida(f: string) { return new Date(f) < new Date(); }
  chip(e: string) { return ({ enviado: 'ok', error: 'error' } as Record<string, string>)[e] || 'alerta'; }
  estadoRndc(e: string) { return ({ enviado: 'Sincronizado', error: 'Con error' } as Record<string, string>)[e] || 'Pendiente'; }

  nuevo() { this.form.set(vacio()); this.abierto.set(true); }
  editar(t: any) {
    const b = vacio();
    this.form.set({ ...b, ...t, sede: { ...b.sede, ...t.sede }, banco: { ...b.banco, ...t.banco },
      licencia: { ...b.licencia, ...t.licencia, vence: isoDia(t.licencia?.vence) }, fechaNacimiento: isoDia(t.fechaNacimiento) });
    this.abierto.set(true);
  }
  alternarRol(r: string) {
    this.form.update(f => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x: string) => x !== r) : [...f.roles, r] }));
  }

  async guardar() {
    const f = this.form();
    const cuerpo = { tipoId: f.tipoId, numId: f.numId, nombres: f.nombres, apellido1: f.apellido1, apellido2: f.apellido2, sede: f.sede,
      telefono: f.telefono, celular: f.celular, direccion: f.direccion, codMunicipio: f.codMunicipio, correo: f.correo,
      licencia: { ...f.licencia, vence: f.licencia.vence || null }, fechaNacimiento: f.fechaNacimiento || null, banco: f.banco,
      roles: f.roles, activo: f.activo };
    this.trabajando.set(true);
    try {
      if (f._id) await this.api.put(`/maestros/terceros/${f._id}`, cuerpo); else await this.api.post('/maestros/terceros', cuerpo);
      this.avisos.ok('Tercero guardado');
      this.abierto.set(false); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async enviar(t: any) {
    const c = await this.clave.obtener();
    if (!c) return;
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>(`/rndc/terceros/${t._id}/enviar`, { clave: c });
      if (r.sinCambios) this.avisos.mostrar(r.mensaje, 'info');
      else if (r.ok) this.avisos.ok(`${nombreTercero(t)} registrado en el RNDC`);
      else this.avisos.mostrar(`El RNDC rechazó el registro: ${r.mensaje}`, 'error');
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
}
