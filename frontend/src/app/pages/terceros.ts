import { Component, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { RndcClave } from '../core/rndc-clave.service';
import { P, TIPOS_ID, nombreTercero } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { MenuAcciones } from '../shared/menu-acciones';
import { SelectorMunicipio } from '../shared/municipio';
import { FORMATOS, isoDia } from '../shared/formato';
import { ImportarExcel } from '../shared/importar-excel';
import { TraerRndc } from '../shared/traer-rndc';
import { ActualizarVehiculos } from '../shared/actualizar-vehiculos';
import { CargarMas } from '../shared/cargar-mas';
import { mensajeError } from '../core/api.service';
import { VistaRndc } from '../shared/vista-rndc';

type TipoNuevo = 'conductor' | 'persona' | 'empresa' | 'sede' | 'vehiculo' | 'remolque';

const ROLES: [string, string][] = [['conductor', 'Conductor'], ['titular', 'Titular de manifiesto'], ['propietario', 'Propietario'],
  ['tenedor', 'Tenedor'], ['remitente', 'Remitente'], ['destinatario', 'Destinatario']];

const vacio = () => ({
  tipoId: 'C', numId: '', nombres: '', apellido1: '', apellido2: '', sede: { codigo: '', nombre: '' }, telefono: '', celular: '',
  direccion: '', codMunicipio: '', correo: '', licencia: { categoria: '', numero: '', vence: '' }, fechaNacimiento: '',
  banco: { entidad: '', tipoCuenta: '', cuenta: '' }, roles: ['conductor'] as string[], activo: true, placasTexto: '', placaPrincipal: '',
});
// Años cumplidos a hoy
export function edadDe(nacimiento: string | null | undefined): number | null {
  if (!nacimiento) return null;
  const n = new Date(`${String(nacimiento).slice(0, 10)}T12:00:00`); const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) a -= 1;
  return a;
}
const placasDe = (t: string) => [...new Set(String(t || '').toUpperCase().split(/[,;\s]+/).map(x => x.replace(/-/g, '')).filter(Boolean))];

@Component({
  selector: 'app-terceros',
  imports: [FormsModule, Modal, Icono, MenuAcciones, SelectorMunicipio, ImportarExcel, TraerRndc, ActualizarVehiculos, CargarMas, VistaRndc, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Conductores y terceros</h1><p class="sutil">Conductores, titulares, propietarios, tenedores y destinatarios que se registran en el RNDC.</p></div>
      <div class="acciones">
        @if (puedeEditar) {
          <app-menu-acciones>
            @if (puedeConsultar) { <button (click)="actualizar.set(true)"><app-icono nombre="reloj" />Actualizar desde el RNDC<small>Confirma los datos con el RNDC, uno, por lotes o todos</small></button> }
            @if (puedeRndc) { <button (click)="traer.set(true)"><app-icono nombre="buscar" />Traer del RNDC<small>Crea en la plataforma terceros que ya existen en el RNDC</small></button> }
            <button (click)="importar.set(true)"><app-icono nombre="descargar" />Importar Excel<small>Carga masiva desde una plantilla</small></button>
          </app-menu-acciones>
          <button class="primario" (click)="nuevo()"><app-icono nombre="mas" />{{ textoNuevo() }}</button>
        }
      </div>
    </div>
    <app-importar-excel tipo="terceros" titulo="conductores y terceros" [abierto]="importar()" (cerrar)="importar.set(false)" (importado)="cargar()" />
    <app-actualizar-vehiculos tipo="terceros" [abierto]="actualizar()" (cerrar)="actualizar.set(false); cargar()" (actualizados)="cargar()" />
    <app-traer-rndc tipo="terceros" [abierto]="traer()" (cerrar)="traer.set(false)" (traidos)="cargar()" />
    <div class="pestanas" role="tablist" aria-label="Tipo de tercero">
      @for (p of PESTANAS_LISTA; track p[0]) {
        <button type="button" role="tab" [class.activa]="rol === p[0]" [attr.aria-selected]="rol === p[0]" (click)="rol = p[0]; cargar()">{{ p[1] }}</button>
      }
    </div>
    <div class="barra">
      <div class="campo crece"><label for="t-q">Buscar</label><input id="t-q" type="search" placeholder="Nombre o número de documento" [(ngModel)]="q" (input)="buscarDiferido()" /></div>
      <div class="campo"><label for="t-rndc">En el RNDC</label><select id="t-rndc" [(ngModel)]="rndc" (change)="cargar()"><option value="">Todos</option>
        <option value="enviado">Registrados</option><option value="importado">Importados sin confirmar</option><option value="error">Con error</option><option value="sin_enviar">Sin registrar</option></select></div>
      <div class="campo"><label for="t-act">Estado</label><select id="t-act" [(ngModel)]="activos" (change)="cargar()"><option value="">Todos</option>
        <option value="1">Activos</option><option value="0">Inactivos</option></select></div>
    </div>
    <div class="tabla-caja">
      <table>
        <thead><tr><th>Documento</th><th>Nombre</th>@if (verSede()) { <th>Sede RNDC</th> }<th>Roles</th><th>Celular</th>@if (verLicencia()) { <th>Licencia vence</th> }<th>RNDC</th><th></th></tr></thead>
        <tbody>
          @for (t of lista(); track t._id) {
            <tr [class.sutil]="!t.activo">
              <td>{{ t.tipoId }} {{ t.numId }}</td><td><strong>{{ nombre(t) }}</strong>@if (!t.activo) { <span class="chip">inactivo</span> }
                @if (t.edad !== null && t.edad !== undefined) { <small class="sutil"> · {{ t.edad }} años</small> }
                @if (t.placaPrincipal) { <small class="sutil"> · {{ t.placaPrincipal }}</small> }</td>
              @if (verSede()) {
                <td>@if (t.sede?.codigo || t.sede?.nombre) { <div class="celda-doble"><span><span class="cod-sede">{{ t.sede.codigo || '—' }}</span> {{ t.sede.nombre || '(sin nombre)' }}</span>
                  @if (t.codMunicipio) { <small>Municipio {{ t.codMunicipio }}</small> }</div> } @else { <span class="sutil">—</span> }</td>
              }
              <td>{{ t.roles.join(', ') }}</td><td>{{ t.celular }}</td>
              @if (verLicencia()) {
                <td>@if (t.licencia?.vence) { <span [class.chip]="vencida(t.licencia.vence)" [class.error]="vencida(t.licencia.vence)">{{ t.licencia.vence | dia }}</span> }</td>
              }
              <td><span class="chip" [class]="chip(t.rndc?.estado)" [title]="t.rndc?.mensaje || ''">{{ estadoRndc(t.rndc?.estado) }}</span></td>
              <td><div class="acciones" style="justify-content:flex-end">
                <button class="pequeno" (click)="editar(t)">{{ puedeEditar ? 'Editar' : 'Ver' }}</button>
                @if (puedeRndc) { <button class="pequeno" (click)="enviar(t)" [disabled]="trabajando()" title="Registrar o actualizar en el RNDC"><app-icono nombre="enviar" [tam]="15" />RNDC</button> }
              </div></td>
            </tr>
          } @empty {
            @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="8"><span class="esqueleto"></span></td></tr> } }
            @else { <tr><td colspan="8" class="vacio"><strong>Sin resultados</strong>Pruebe con otro nombre o documento.</td></tr> }
          }
        </tbody>
      </table>
      @if (lista().length) { <app-cargar-mas [mostrados]="lista().length" [total]="total()" [cargando]="cargandoMas()" unidad="terceros" (mas)="cargarMas()" /> }
    </div>

    <!-- Paso 1: verificar el documento en la empresa y en el RNDC -->
    <app-modal titulo="Crear" [abierto]="verificando()" (cerrar)="verificando.set(false)">
      <div class="pestanas" role="tablist" aria-label="Qué va a crear">
        @for (o of TIPOS_NUEVO; track o.v) {
          <button type="button" role="tab" [class.activa]="tipoNuevo() === o.v" [attr.aria-selected]="tipoNuevo() === o.v" (click)="elegirTipo(o.v)">
            <app-icono [nombre]="o.icono" [tam]="16" />{{ o.t }}</button>
        }
      </div>
      <p class="que-es">{{ descripcionTipo() }}</p>
      <form id="form-verificar-t" class="formulario" (ngSubmit)="verificar()">
        @if (tipoNuevo() === 'sede') {
          <p class="sutil ancho" style="margin:0">Escriba el NIT de la empresa: se muestran sus sedes y se asigna el código de la próxima. La sede queda lista como destinatario de las remesas.</p>
          <div class="campo"><label for="vt-num">NIT</label><input id="vt-num" name="num" [(ngModel)]="buscar.numId" required inputmode="numeric" autofocus />
            <small>Con dígito de verificación, sin guion.</small></div>
        } @else {
          <div class="mensaje info ancho">Escriba el documento y presione «Buscar». Primero se busca en la plataforma{{ puedeConsultar ? ' y luego en lo que su empresa ya tiene registrado en el RNDC' : '' }}:
            si existe, se traen todos sus datos (nombres, licencia, dirección, municipio y sedes) y solo completa lo que falte.</div>
          <div class="campo"><label for="vt-tipo">Tipo de documento</label><select id="vt-tipo" name="tipo" [(ngModel)]="buscar.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo"><label for="vt-num">Número</label><input id="vt-num" name="num" [(ngModel)]="buscar.numId" required inputmode="numeric" autofocus />
            @if (buscar.tipoId === 'N') { <small>NIT con dígito de verificación, sin guion.</small> }</div>
          <div class="campo"><label for="vt-rol">Rol</label><select id="vt-rol" name="rol" [(ngModel)]="buscar.rol">@for (r of roles; track r[0]) { <option [value]="r[0]">{{ r[1] }}</option> }</select></div>
        }
        @if (puedeConsultar && tipoNuevo() !== 'sede') { <label class="casilla ancho"><input type="checkbox" name="rndc" [(ngModel)]="consultarRndc" />Traer los datos que su empresa tiene en el RNDC (pide la contraseña del web service una vez)</label> }
      </form>
      <ng-container pie>
        <button type="button" (click)="verificando.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-verificar-t" [disabled]="trabajando() || digitos(buscar.numId).length < 5"><app-icono nombre="buscar" [tam]="16" />{{ trabajando() ? 'Buscando…' : 'Buscar' }}</button>
      </ng-container>
    </app-modal>

    <app-modal [titulo]="editando() ? 'Editar tercero' : sedesEmpresa().length ? 'Nueva sede' : 'Nuevo tercero'" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @let f = form();
      @if (sedesEmpresa().length) {
        <div class="mensaje info" style="margin-bottom:12px"><strong>Sedes que ya tiene:</strong>
          @for (s of sedesEmpresa(); track s._id) { <span class="chip sin-punto" style="margin:2px 4px">{{ s.sede?.codigo || '0' }} · {{ s.sede?.nombre || s.nombres }}</span> }</div>
      }
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
            <div class="campo" [hidden]="soloFaltantes()"><label for="fn">Fecha de nacimiento</label><input id="fn" type="date" name="fnac" [(ngModel)]="f.fechaNacimiento" />
              @if (edad(f.fechaNacimiento) !== null) { <small>{{ edad(f.fechaNacimiento) }} años</small> }</div>
          </div></fieldset>
          @if (!soloFaltantes()) {
            <fieldset style="margin-top:14px"><legend>Placas que maneja</legend><div class="formulario">
              <div class="campo"><label for="tpl">Placas</label><input id="tpl" name="placas" [(ngModel)]="f.placasTexto" placeholder="ABC123, DEF456" style="text-transform:uppercase" />
                <small>Separadas por coma. La principal se propone al registrar sus viajes.</small></div>
              <div class="campo"><label for="tpp">Placa principal</label>
                <select id="tpp" name="principal" [(ngModel)]="f.placaPrincipal"><option value="">Sin principal</option>
                  @for (p of placasForm(f.placasTexto); track p) { <option [value]="p">{{ p }}</option> }</select></div>
            </div></fieldset>
          }
          @if (!soloFaltantes()) {
            <fieldset style="margin-top:14px"><legend>Cuenta para pagos</legend><div class="formulario">
              <div class="campo"><label for="be">Banco</label><input id="be" name="banco" [(ngModel)]="f.banco.entidad" /></div>
              <div class="campo"><label for="bt">Tipo</label><select id="bt" name="btipo" [(ngModel)]="f.banco.tipoCuenta"><option value=""></option><option>Ahorros</option><option>Corriente</option></select></div>
              <div class="campo"><label for="bc">Número de cuenta</label><input id="bc" name="bcta" [(ngModel)]="f.banco.cuenta" /></div>
            </div></fieldset>
          }
        }
        @if (editando() && !soloFaltantes()) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
        @if (puedeRndc && puedeEditar) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="sinc" [(ngModel)]="sincronizar" />Crear o actualizar también en el RNDC al guardar</label> }
      </form>
      <app-vista-rndc [variables]="vistaRndc()" (cerrar)="vistaRndc.set(null)" />
      <ng-container pie>
        <button type="button" class="texto" style="margin-right:auto" (click)="verVista()" title="Solo muestra las variables del RNDC; no guarda ni envía nada">Solo mostrar lo que se enviaría</button>
        <button type="button" (click)="abierto.set(false)">Cancelar</button>
        @if (puedeEditar) { <button class="primario" type="submit" form="form-tercero" [disabled]="trabajando()">{{ sincronizar && puedeRndc ? 'Guardar y registrar en el RNDC' : 'Guardar' }}</button> }
      </ng-container>
    </app-modal>`,
  styles: [`
    .cod-sede { display: inline-block; min-width: 26px; text-align: center; font-weight: 750; font-size: 12px; padding: 1px 7px; margin-right: 4px;
      border-radius: 6px; background: var(--gris-15); color: var(--gris-7); font-variant-numeric: tabular-nums; }
    .que-es { margin: -6px 0 16px; color: var(--gris-5); }
    .que { border: 0; padding: 0; margin: 0 0 16px; min-width: 0; }
    .que legend { font-weight: 650; font-size: 13px; color: var(--gris-6); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .04em; background: none; padding: 0; margin-left: 0; border-radius: 0; }
    .opciones-nuevo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .opcion { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 10px 12px; height: auto; white-space: normal; text-align: left;
      border: 1.5px solid var(--gris-2); border-radius: 12px; background: var(--gris-0); }
    .opcion span { font-size: 12px; color: var(--gris-6); font-weight: 400; line-height: 1.3; }
    .opcion.activo { border-color: var(--primario-borde); background: var(--primario-claro); box-shadow: 0 0 0 1px var(--primario-borde); }
    @media (max-width: 560px) { .opciones-nuevo { grid-template-columns: 1fr 1fr; } }
  `],
})
export class Terceros {
  private router = inject(Router);
  readonly TIPOS_NUEVO: { v: TipoNuevo; t: string; d: string; icono: string }[] = [
    { v: 'conductor', t: 'Conductor', d: 'Persona con licencia de conducción que maneja los vehículos.', icono: 'usuario' },
    { v: 'persona', t: 'Titular o tenedor', d: 'Persona propietaria, tenedora o titular de manifiestos (sin licencia).', icono: 'personas' },
    { v: 'empresa', t: 'Empresa', d: 'Empresa con NIT (cliente, remitente o destinatario) con su primera sede.', icono: 'edificio' },
    { v: 'sede', t: 'Sede', d: 'Otra sede de una empresa ya registrada: se asigna el código de la próxima sede.', icono: 'edificio' },
    { v: 'vehiculo', t: 'Vehículo', d: 'Camión o tractocamión: se crea en Vehículos.', icono: 'camion' },
    { v: 'remolque', t: 'Remolque', d: 'Remolque o semirremolque: se crea en Vehículos.', icono: 'camion' },
  ];
  // Pestañas de la lista: agrupan por el papel que cumple cada tercero
  readonly PESTANAS_LISTA: [string, string][] = [['', 'Todos'], ['conductor', 'Conductores'], ['titular', 'Titulares'], ['propietario', 'Propietarios'],
    ['tenedor', 'Tenedores'], ['remitente', 'Remitentes'], ['destinatario', 'Destinatarios y sedes']];
  descripcionTipo() { return this.TIPOS_NUEVO.find(o => o.v === this.tipoNuevo())?.d || ''; }
  readonly tipoNuevo = signal<TipoNuevo>('conductor');
  readonly sedesEmpresa = signal<any[]>([]);
  readonly vistaRndc = signal<[string, string][] | null>(null);
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
  readonly actualizar = signal(false);
  readonly form = signal<any>(vacio());
  readonly editando = computed(() => !!this.form()._id);
  q = ''; rol = '';
  nombre = nombreTercero;

  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['maestros', 'rndc', 'rastreo'], () => this.cargar());

  constructor() { this.cargar(); }


  // ── Paginación con carga progresiva ──
  private pagina = 1;
  readonly total = signal(0);
  readonly cargandoMas = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  buscarDiferido() { clearTimeout(this.temporizador); this.temporizador = setTimeout(() => this.cargar(), 300); }

  rndc = '';
  activos = '';
  async cargar() {
    this.cargando.set(true);
    this.pagina = 1;
    try {
      const r = await this.api.get<any>('/maestros/terceros', { q: this.q, rol: this.rol, rndc: this.rndc, activos: this.activos, pagina: 1, limite: 50 });
      this.lista.set(r.items); this.total.set(r.total);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async cargarMas() {
    if (this.cargandoMas() || this.lista().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/maestros/terceros', { q: this.q, rol: this.rol, rndc: this.rndc, activos: this.activos, pagina: this.pagina + 1, limite: 50 });
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

  // Lo que se crea depende de la pestaña: conductor, persona (titular, propietario, tenedor) o empresa/sede (remitente, destinatario)
  private static readonly EMPRESA = ['remitente', 'destinatario'];
  textoNuevo() {
    return ({ '': 'Nuevo tercero', conductor: 'Nuevo conductor', titular: 'Nuevo titular', propietario: 'Nuevo propietario', tenedor: 'Nuevo tenedor',
      remitente: 'Nueva empresa o sede', destinatario: 'Nueva empresa o sede' } as Record<string, string>)[this.rol] || 'Nuevo tercero';
  }
  verSede() { return !this.rol || Terceros.EMPRESA.includes(this.rol); }
  verLicencia() { return !this.rol || this.rol === 'conductor'; }
  nuevo() {
    const empresa = Terceros.EMPRESA.includes(this.rol);
    this.buscar = { tipoId: empresa ? 'N' : 'C', numId: '', rol: this.rol || 'conductor' }; this.consultarRndc = this.puedeConsultar;
    this.tipoNuevo.set(empresa ? 'empresa' : this.rol && this.rol !== 'conductor' ? 'persona' : 'conductor');
    this.verificando.set(true);
  }
  elegirTipo(t: TipoNuevo) {
    if (t === 'vehiculo' || t === 'remolque') { this.verificando.set(false); this.router.navigate(['/vehiculos'], { queryParams: { nuevo: t } }); return; }
    this.tipoNuevo.set(t);
    const conf = ({ conductor: ['C', 'conductor'], persona: ['C', 'titular'], empresa: ['N', 'destinatario'], sede: ['N', 'destinatario'] } as Record<string, string[]>)[t];
    // Conserva el rol de la pestaña cuando corresponde al tipo elegido (p. ej. «Tenedores» → persona tenedor)
    const rolPestana = t === 'persona' && ['titular', 'propietario', 'tenedor'].includes(this.rol) ? this.rol
      : (t === 'empresa' || t === 'sede') && Terceros.EMPRESA.includes(this.rol) ? this.rol : conf[1];
    this.buscar = { ...this.buscar, tipoId: conf[0], rol: rolPestana };
  }

  // Sede de una empresa existente: toma sus datos y el código de la próxima sede
  async nuevaSede() {
    const numId = this.digitos(this.buscar.numId);
    this.trabajando.set(true);
    try {
      const r = await this.api.get<any>('/maestros/terceros/sedes', { numId });
      if (!r.sedes.length) { this.avisos.mostrar('Esa empresa no está registrada: elija «Empresa nueva».', 'error'); return; }
      const base = r.sedes[0];
      this.verificando.set(false);
      this.editar({ tipoId: base.tipoId, numId: base.numId, nombres: base.nombres, apellido1: base.apellido1 || '', apellido2: base.apellido2 || '',
        sede: { codigo: r.siguiente, nombre: '' }, roles: ['destinatario'] }, []);
      this.sedesEmpresa.set(r.sedes);
      this.sincronizar = this.puedeRndc;
      this.origen.set({ tipo: 'info', texto: `Nueva sede N° ${r.siguiente} de ${base.nombres}. Escriba el nombre de la sede, la dirección y el municipio.` });
      setTimeout(() => document.getElementById('tsn')?.focus(), 50);
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  // «Solo mostrar lo que se enviaría»: variables del RNDC sin guardar ni enviar
  async verVista() {
    try { this.vistaRndc.set((await this.api.post<any>('/maestros/terceros/vista-rndc', this.cuerpo())).variables); }
    catch (e) { this.avisos.mostrar(await mensajeError(e), 'error'); }
  }

  // Busca el documento en la empresa y (si se pide) en el RNDC antes de crear el registro.
  async verificar() {
    if (this.tipoNuevo() === 'sede') return this.nuevaSede();
    this.sedesEmpresa.set([]);
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
        this.form.set({ ...vacio(), tipoId, numId, roles: [rol], ...(this.tipoNuevo() === 'empresa' ? { sede: { codigo: '1', nombre: 'PRINCIPAL' } } : {}) });
        this.vistaRndc.set(null);
        this.faltantes.set([]); this.soloFaltantes.set(false); this.sincronizar = this.puedeRndc;
        this.origen.set(r.consultado
          ? { tipo: 'alerta', texto: `No está en el RNDC (respuesta: ${r.mensaje}). Es un registro nuevo: complete sus datos.` }
          : { tipo: 'info', texto: 'Registro nuevo en su empresa. No se consultó el RNDC.' });
        this.abierto.set(true);
      }
      if (clave && r.mensaje && /contrase|clave|password|autentic|usuario (no |inv|o |y )/i.test(r.mensaje)) this.clave.olvidar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  editar(t: any, faltantes?: any[]) {
    this.origen.set(null); this.vistaRndc.set(null); this.sedesEmpresa.set([]);
    this.faltantes.set(faltantes || []);
    this.soloFaltantes.set(!!faltantes?.length);
    this.sincronizar = false;
    if (!faltantes && this.puedeRndc && t._id) {
      this.api.get<any>(`/rndc/faltantes/tercero/${t._id}`).then(r => this.faltantes.set(r.faltantes)).catch(() => {});
    }
    const b = vacio();
    this.form.set({ ...b, ...t, sede: { ...b.sede, ...t.sede }, banco: { ...b.banco, ...t.banco },
      licencia: { ...b.licencia, ...t.licencia, vence: isoDia(t.licencia?.vence) }, fechaNacimiento: isoDia(t.fechaNacimiento),
      placasTexto: (t.placas || []).join(', '), placaPrincipal: t.placaPrincipal || '' });
    this.abierto.set(true);
  }
  alternarRol(r: string) {
    this.form.update(f => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x: string) => x !== r) : [...f.roles, r] }));
  }

  private cuerpo() {
    const f = this.form();
    return { tipoId: f.tipoId, numId: f.numId, nombres: f.nombres, apellido1: f.apellido1, apellido2: f.apellido2, sede: f.sede,
      telefono: f.telefono, celular: f.celular, direccion: f.direccion, codMunicipio: f.codMunicipio, correo: f.correo,
      licencia: { ...f.licencia, vence: f.licencia.vence || null }, fechaNacimiento: f.fechaNacimiento || null, banco: f.banco,
      roles: f.roles, activo: f.activo, placas: placasDe(f.placasTexto), placaPrincipal: placasDe(f.placasTexto).includes(f.placaPrincipal) ? f.placaPrincipal : '' };
  }
  edad(n: string) { return edadDe(n); }
  placasForm(t: string) { return placasDe(t); }

  async guardar() {
    const f = this.form();
    const cuerpo = this.cuerpo();
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
