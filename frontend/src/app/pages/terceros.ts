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
import { mensajeError } from '../core/api.service';

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

    <!-- Paso 1: verificar el documento en la empresa y en el RNDC -->
    <app-modal titulo="Nuevo conductor o tercero" [abierto]="verificando()" (cerrar)="verificando.set(false)">
      <form id="form-verificar-t" class="formulario" (ngSubmit)="verificar()">
        <p class="sutil ancho" style="margin:0">Primero se busca el documento en su empresa{{ puedeConsultar ? ' y en el RNDC' : '' }}, para no duplicarlo y traer los datos que ya existan.</p>
        <div class="campo"><label for="vt-tipo">Tipo de documento</label><select id="vt-tipo" name="tipo" [(ngModel)]="buscar.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
        <div class="campo"><label for="vt-num">Número</label><input id="vt-num" name="num" [(ngModel)]="buscar.numId" required inputmode="numeric" autofocus />
          @if (buscar.tipoId === 'N') { <small>NIT con dígito de verificación, sin guion.</small> }</div>
        <div class="campo"><label for="vt-rol">Rol</label><select id="vt-rol" name="rol" [(ngModel)]="buscar.rol">@for (r of roles; track r[0]) { <option [value]="r[0]">{{ r[1] }}</option> }</select></div>
        @if (puedeConsultar) { <label class="casilla ancho"><input type="checkbox" name="rndc" [(ngModel)]="consultarRndc" />Consultar en el RNDC (pide la contraseña del web service)</label> }
      </form>
      <ng-container pie>
        <button type="button" (click)="verificando.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-verificar-t" [disabled]="trabajando() || digitos(buscar.numId).length < 5">{{ trabajando() ? 'Buscando…' : 'Continuar' }}</button>
      </ng-container>
    </app-modal>

    <app-modal [titulo]="editando() ? 'Editar tercero' : 'Nuevo tercero'" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @let f = form();
      @if (origen(); as o) { <div class="mensaje" [class.ok]="o.tipo === 'ok'" [class.info]="o.tipo === 'info'" [class.alerta]="o.tipo === 'alerta'" style="margin-bottom:12px">{{ o.texto }}</div> }
      @if (faltantes().length) {
        <div class="mensaje alerta" style="margin-bottom:12px">
          <strong>Para registrarlo en el RNDC falta:</strong> {{ etiquetasFaltantes() }}.
          <label class="casilla" style="margin-top:6px"><input type="checkbox" [checked]="soloFaltantes()" (change)="soloFaltantes.set(!soloFaltantes())" />Mostrar solo lo que falta</label>
        </div>
      }
      <form id="form-tercero" (ngSubmit)="guardar()">
        <div class="formulario">
          <div class="campo" [hidden]="soloFaltantes()"><label for="tt">Tipo de documento</label><select id="tt" name="tipoId" [(ngModel)]="f.tipoId" [disabled]="editando() || !!origen()">
            @for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="tn">Número</label><input id="tn" name="numId" [(ngModel)]="f.numId" [disabled]="editando() || !!origen()" required />
            @if (f.tipoId === 'N') { <small>NIT con dígito de verificación, sin guion.</small> }</div>
          <div class="campo" [hidden]="!ver('nombres')" [class.falta]="falta('nombres')"><label for="tno">{{ f.tipoId === 'N' ? 'Razón social' : 'Nombres' }}</label><input id="tno" name="nombres" [(ngModel)]="f.nombres" required /></div>
          @if (f.tipoId !== 'N') {
            <div class="campo" [hidden]="!ver('apellido1')" [class.falta]="falta('apellido1')"><label for="ta1">Primer apellido</label><input id="ta1" name="ap1" [(ngModel)]="f.apellido1" required /></div>
            <div class="campo" [hidden]="soloFaltantes()"><label for="ta2">Segundo apellido</label><input id="ta2" name="ap2" [(ngModel)]="f.apellido2" /></div>
          } @else {
            <div class="campo" [hidden]="!ver('sede.codigo')" [class.falta]="falta('sede.codigo')"><label for="ts">Código de sede</label><input id="ts" name="sede" maxlength="6" [(ngModel)]="f.sede.codigo" /></div>
            <div class="campo" [hidden]="!ver('sede.nombre')" [class.falta]="falta('sede.nombre')"><label for="tsn">Nombre de sede</label><input id="tsn" name="sedeN" maxlength="20" [(ngModel)]="f.sede.nombre" /></div>
          }
          <div class="campo" [hidden]="!ver('celular')" [class.falta]="falta('celular')"><label for="tcel">Celular</label><input id="tcel" name="cel" maxlength="10" [(ngModel)]="f.celular" /></div>
          <div class="campo" [hidden]="!ver('telefono')" [class.falta]="falta('telefono')"><label for="ttel">Teléfono fijo</label><input id="ttel" name="tel" maxlength="7" [(ngModel)]="f.telefono" /></div>
          <div class="campo" [hidden]="!ver('direccion')" [class.falta]="falta('direccion')"><label for="tdir">Dirección</label><input id="tdir" name="dir" maxlength="60" [(ngModel)]="f.direccion" /></div>
          @if (ver('codMunicipio')) { <app-municipio etiqueta="Municipio" [(codigo)]="f.codMunicipio" [class.falta]="falta('codMunicipio')" /> }
          <div class="campo ancho" [hidden]="soloFaltantes()"><span class="etiqueta">Roles</span><div class="acciones">
            @for (r of roles; track r[0]) { <label class="casilla"><input type="checkbox" [checked]="f.roles.includes(r[0])" (change)="alternarRol(r[0])" />{{ r[1] }}</label> }
          </div></div>
        </div>
        @if (f.roles.includes('conductor') || falta('licencia.vence')) {
          <fieldset style="margin-top:14px" [hidden]="!verAlguno(['licencia.categoria', 'licencia.numero', 'licencia.vence'])"><legend>Licencia de conducción</legend><div class="formulario">
            <div class="campo" [hidden]="!ver('licencia.categoria')" [class.falta]="falta('licencia.categoria')"><label for="lc">Categoría</label><input id="lc" name="lcat" maxlength="3" [(ngModel)]="f.licencia.categoria" /></div>
            <div class="campo" [hidden]="!ver('licencia.numero')" [class.falta]="falta('licencia.numero')"><label for="ln">Número</label><input id="ln" name="lnum" [(ngModel)]="f.licencia.numero" /></div>
            <div class="campo" [hidden]="!ver('licencia.vence')" [class.falta]="falta('licencia.vence')"><label for="lv">Vence</label><input id="lv" type="date" name="lven" [(ngModel)]="f.licencia.vence" /></div>
            <div class="campo" [hidden]="soloFaltantes()"><label for="fn">Fecha de nacimiento</label><input id="fn" type="date" name="fnac" [(ngModel)]="f.fechaNacimiento" /></div>
          </div></fieldset>
          @if (!soloFaltantes()) {
            <fieldset style="margin-top:14px"><legend>Cuenta para pagos</legend><div class="formulario">
              <div class="campo"><label for="be">Banco</label><input id="be" name="banco" [(ngModel)]="f.banco.entidad" /></div>
              <div class="campo"><label for="bt">Tipo</label><select id="bt" name="btipo" [(ngModel)]="f.banco.tipoCuenta"><option value=""></option><option>Ahorros</option><option>Corriente</option></select></div>
              <div class="campo"><label for="bc">Número de cuenta</label><input id="bc" name="bcta" [(ngModel)]="f.banco.cuenta" /></div>
            </div></fieldset>
          }
        }
        @if (editando() && !soloFaltantes()) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
        @if (puedeRndc && puedeEditar) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="sinc" [(ngModel)]="sincronizar" />Registrar o actualizar en el RNDC al guardar</label> }
      </form>
      <ng-container pie>
        <button type="button" (click)="abierto.set(false)">Cancelar</button>
        @if (puedeEditar) { <button class="primario" type="submit" form="form-tercero" [disabled]="trabajando()">{{ sincronizar && puedeRndc ? 'Guardar y registrar en el RNDC' : 'Guardar' }}</button> }
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
  readonly puedeConsultar = this.auth.tiene(P.RNDC_OPERAR) || this.auth.tiene(P.RNDC_CONSULTAR);
  readonly roles = ROLES;
  // Verificación previa y datos que faltan para el RNDC
  readonly verificando = signal(false);
  readonly origen = signal<{ tipo: 'ok' | 'info' | 'alerta'; texto: string } | null>(null);
  readonly faltantes = signal<{ campo: string; etiqueta: string }[]>([]);
  readonly soloFaltantes = signal(false);
  readonly etiquetasFaltantes = computed(() => this.faltantes().map(f => f.etiqueta).join(', '));
  buscar = { tipoId: 'C', numId: '', rol: 'conductor' };
  consultarRndc = true;
  sincronizar = false;
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

  digitos(v: string) { return String(v || '').replace(/\D/g, ''); }
  falta(campo: string) { return this.faltantes().some(f => f.campo === campo); }
  ver(campo: string) { return !this.soloFaltantes() || this.falta(campo); }
  verAlguno(campos: string[]) { return campos.some(c => this.ver(c)); }

  nuevo() { this.buscar = { tipoId: 'C', numId: '', rol: this.rol || 'conductor' }; this.consultarRndc = this.puedeConsultar; this.verificando.set(true); }

  // Busca el documento en la empresa y (si se pide) en el RNDC antes de crear el registro.
  async verificar() {
    const numId = this.digitos(this.buscar.numId);
    const { tipoId, rol } = this.buscar;
    let clave: string | null = null;
    if (this.consultarRndc && this.puedeConsultar) clave = await this.clave.obtener();
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/rndc/verificar/tercero', { tipoId, numId, roles: [rol], ...(clave ? { clave } : {}) });
      this.verificando.set(false);
      if (r.origen === 'local') {
        this.editar(r.registro, r.faltantes);
        this.origen.set({ tipo: 'info', texto: `El documento ${tipoId} ${numId} ya está registrado en su empresa: revise o complete sus datos.` });
      } else if (r.origen === 'rndc') {
        this.editar(r.registro, r.faltantes);
        this.origen.set({ tipo: 'ok', texto: `Datos recuperados del RNDC y guardados en su empresa${r.sedes > 1 ? ` (${r.sedes} sedes)` : ''}.${r.faltantes.length ? ' Complete solo lo que falta.' : ' Está completo.'}` });
        this.cargar();
      } else {
        this.form.set({ ...vacio(), tipoId, numId, roles: [rol] });
        this.faltantes.set([]); this.soloFaltantes.set(false); this.sincronizar = this.puedeRndc;
        this.origen.set(r.consultado
          ? { tipo: 'alerta', texto: `No está en el RNDC (respuesta: ${r.mensaje}). Es un registro nuevo: complete sus datos.` }
          : { tipo: 'info', texto: 'Registro nuevo en su empresa. No se consultó el RNDC.' });
        this.abierto.set(true);
      }
      if (clave && r.mensaje && /usuario|contrase|clave/i.test(r.mensaje)) this.clave.olvidar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  editar(t: any, faltantes?: any[]) {
    this.origen.set(null);
    this.faltantes.set(faltantes || []);
    this.soloFaltantes.set(!!faltantes?.length);
    this.sincronizar = false;
    if (!faltantes && this.puedeRndc && t._id) {
      this.api.get<any>(`/rndc/faltantes/tercero/${t._id}`).then(r => this.faltantes.set(r.faltantes)).catch(() => {});
    }
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
      const guardado = f._id ? await this.api.put<any>(`/maestros/terceros/${f._id}`, cuerpo) : await this.api.post<any>('/maestros/terceros', cuerpo);
      this.avisos.ok('Tercero guardado');
      this.abierto.set(false); this.cargar();
      if (this.sincronizar && this.puedeRndc) await this.enviar(guardado);
    } catch (e) { this.avisos.mostrar(await mensajeError(e), 'error'); } finally { this.trabajando.set(false); }
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
