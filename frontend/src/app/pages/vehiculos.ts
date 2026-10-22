import { Component, computed, inject, signal } from '@angular/core';
import { EnVivo } from '../core/en-vivo.service';
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
import { ActualizarVehiculos } from '../shared/actualizar-vehiculos';
import { CargarMas } from '../shared/cargar-mas';
import { mensajeError } from '../core/api.service';
import { BuscarTercero } from '../shared/buscar-tercero';
import { VistaRndc } from '../shared/vista-rndc';
import { Rastreo } from '../core/rastreo.service';
import { ActivatedRoute } from '@angular/router';

const vacio = () => ({
  placa: '', clase: 'vehiculo', configuracion: '', configuracionNombre: '', marca: '', marcaNombre: '', linea: '', ejes: null, modelo: null,
  color: '', carroceria: '', combustible: '', pesoVacio: null, capacidad: null, pbv: null, unidadMedida: '1',
  soat: { numero: '', vence: '', aseguradoraNit: '' }, aseguradoraSoat: '', venceTecnomecanica: '',
  propietario: { tipoId: 'C', numId: '' }, tenedor: { tipoId: 'C', numId: '' }, conductorHabitual: '', titularHabitual: '', activo: true,
});

@Component({
  selector: 'app-vehiculos',
  imports: [FormsModule, Modal, Icono, ImportarExcel, TraerRndc, ActualizarVehiculos, CargarMas, BuscarTercero, VistaRndc, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Vehículos</h1><p class="sutil">Vehículos y remolques con sus documentos. Los códigos (configuración, marca, línea…) son los de las tablas del RNDC.</p></div>
      <div class="acciones">
        @if (puedeEditar) {
          <button (click)="importar.set(true)"><app-icono nombre="descargar" />Importar Excel</button>
          @if (puedeRndc) { <button (click)="traer.set(true)"><app-icono nombre="buscar" />Traer del RNDC</button> }
          @if (puedeConsultar) { <button (click)="actualizar.set(true)"><app-icono nombre="reloj" />Actualizar desde el RNDC</button> }
          @if (rastreoHabilitado()) { <button (click)="abrirSurTrack()"><app-icono nombre="ubicacion" />Traer de Sur Track</button> }
          <button class="primario" (click)="nuevo()"><app-icono nombre="mas" />Nuevo vehículo</button>
        }
      </div>
    </div>
    <app-importar-excel tipo="vehiculos" titulo="vehículos" [abierto]="importar()" (cerrar)="importar.set(false)" (importado)="cargar()" />
    <app-traer-rndc tipo="vehiculos" [abierto]="traer()" (cerrar)="traer.set(false)" (traidos)="cargar()" />
    <app-actualizar-vehiculos [abierto]="actualizar()" (cerrar)="actualizar.set(false); cargar()" (actualizados)="cargar()" />
    <div class="barra"><div class="campo crece"><label for="v-q">Buscar placa</label>
      <input id="v-q" type="search" placeholder="ABC123" [(ngModel)]="q" (input)="buscarDiferido()" style="text-transform:uppercase" /></div>
      <div class="campo"><label for="v-cl">Tipo</label><select id="v-cl" [(ngModel)]="clase" (change)="cargar()"><option value="">Todos</option>
        <option value="vehiculo">Vehículos</option><option value="remolque">Remolques</option></select></div>
      <div class="campo"><label for="v-so">SOAT</label><select id="v-so" [(ngModel)]="soat" (change)="cargar()"><option value="">Todos</option>
        <option value="vencido">Vencido</option><option value="por_vencer">Vence en 30 días</option><option value="sin">Sin datos</option></select></div>
      <div class="campo"><label for="v-act">Estado</label><select id="v-act" [(ngModel)]="activos" (change)="cargar()"><option value="">Todos</option>
        <option value="1">Activos</option><option value="0">Inactivos</option></select></div></div>
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

    <app-modal titulo="Vehículos de Sur Track" [abierto]="!!planSt()" (cerrar)="planSt.set(null)" [ancho]="true">
      @if (planSt(); as pl) {
        <p class="sutil" style="margin-top:0">Se unen por <strong>placa</strong> y los conductores por <strong>cédula</strong>: lo que ya existe solo se vincula y no se duplica ni se modifica.</p>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th>Placa</th><th>Conductor en Sur Track</th><th>Cédula</th><th>Vehículo</th><th>Conductor</th></tr></thead>
          <tbody>
            @for (x of pl.items; track x.choferId) {
              <tr><td data-etiqueta="Placa"><span class="placa">{{ x.placa }}</span></td><td data-etiqueta="Conductor">{{ x.nombre }}</td><td data-etiqueta="Cédula">{{ x.cedula || '—' }}</td>
                <td data-etiqueta="Vehículo"><span class="chip sin-punto" [class.ok]="x.vehiculo === 'vinculado'" [class.info]="x.vehiculo === 'vincular'" [class.alerta]="x.vehiculo === 'crear'">{{ ESTADO_ST[x.vehiculo] }}</span></td>
                <td data-etiqueta="Conductor"><span class="chip sin-punto" [class.ok]="x.conductor === 'existe'" [class.alerta]="x.conductor === 'crear'">{{ ESTADO_ST[x.conductor] }}</span></td></tr>
            }
          </tbody>
        </table></div>
        @if (pl.sinPlaca.length) { <p class="sutil">Sin placa en Sur Track (se omiten): {{ pl.sinPlaca.join(', ') }}</p> }
      }
      <ng-container pie>
        <button type="button" (click)="planSt.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="aplicarSurTrack()" [disabled]="trabajando() || !pendientesSt()">{{ pendientesSt() ? 'Aplicar ' + pendientesSt() + ' cambio(s)' : 'Todo está al día' }}</button>
      </ng-container>
    </app-modal>

    <!-- Paso 1: verificar la placa en la empresa y en el RNDC -->
    <app-modal titulo="Nuevo vehículo" [abierto]="verificando()" (cerrar)="verificando.set(false)">
      <form id="form-verificar" (ngSubmit)="verificar()">
        <p class="sutil" style="margin-top:0">Primero se busca la placa en su empresa{{ puedeConsultar ? ' y en el RNDC' : '' }}, para no duplicarla y traer los datos que ya existan.</p>
        <div class="campo"><label for="vv-placa">Placa</label><input id="vv-placa" name="placa" [(ngModel)]="placaBuscar" required maxlength="7" style="text-transform:uppercase" placeholder="ABC123" autofocus /></div>
        @if (puedeConsultar) { <label class="casilla" style="margin-top:12px"><input type="checkbox" name="rndc" [(ngModel)]="consultarRndc" />Consultar en el RNDC (pide la contraseña del web service)</label> }
      </form>
      <ng-container pie>
        <button type="button" (click)="verificando.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-verificar" [disabled]="trabajando() || placaBuscar.trim().length < 5">{{ trabajando() ? 'Buscando…' : 'Continuar' }}</button>
      </ng-container>
    </app-modal>

    <app-modal [titulo]="editando() ? 'Vehículo ' + form().placa : 'Nuevo vehículo ' + (form().placa || '')" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @let f = form();
      @if (origen(); as o) { <div class="mensaje" [class.ok]="o.tipo === 'ok'" [class.info]="o.tipo === 'info'" [class.alerta]="o.tipo === 'alerta'" style="margin-bottom:12px">{{ o.texto }}</div> }
      @if (faltantes().length) {
        <div class="mensaje alerta" style="margin-bottom:12px">
          <strong>Para registrarlo en el RNDC falta:</strong> {{ etiquetasFaltantes() }}.
          <label class="casilla" style="margin-top:6px"><input type="checkbox" [checked]="soloFaltantes()" (change)="soloFaltantes.set(!soloFaltantes())" />Mostrar solo lo que falta</label>
        </div>
      }
      <form id="form-veh" (ngSubmit)="guardar()">
        <div class="formulario">
          <div class="campo" [hidden]="soloFaltantes()"><label for="vp">Placa</label><input id="vp" name="placa" [(ngModel)]="f.placa" [disabled]="editando() || !!origen()" required style="text-transform:uppercase" /></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="vc">Clase</label><select id="vc" name="clase" [(ngModel)]="f.clase"><option value="vehiculo">Vehículo (camión / tractocamión)</option><option value="remolque">Remolque / semirremolque</option></select></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="vcn">Configuración (para el QR)</label><input id="vcn" name="confN" maxlength="4" placeholder="2, 3, 2S2, 3S3…" [(ngModel)]="f.configuracionNombre" /></div>
          <div class="campo" [hidden]="!ver('configuracion')" [class.falta]="falta('configuracion')"><label for="vcc">Código configuración RNDC</label><input id="vcc" name="conf" maxlength="2" [(ngModel)]="f.configuracion" /></div>
          <div class="campo" [hidden]="!ver('marca')" [class.falta]="falta('marca')"><label for="vm">Código marca RNDC</label><input id="vm" name="marca" [(ngModel)]="f.marca" /></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="vmn">Marca (nombre)</label><input id="vmn" name="marcaN" [(ngModel)]="f.marcaNombre" /></div>
          <div class="campo" [hidden]="!ver('linea')" [class.falta]="falta('linea')"><label for="vl">Código línea RNDC</label><input id="vl" name="linea" [(ngModel)]="f.linea" /></div>
          <div class="campo" [hidden]="!ver('modelo')" [class.falta]="falta('modelo')"><label for="vmo">Modelo (año)</label><input id="vmo" type="number" name="modelo" [(ngModel)]="f.modelo" /></div>
          <div class="campo" [hidden]="!ver('color')" [class.falta]="falta('color')"><label for="vco">Código color RNDC</label><input id="vco" name="color" [(ngModel)]="f.color" /></div>
          <div class="campo" [hidden]="!ver('carroceria')" [class.falta]="falta('carroceria')"><label for="vca">Código carrocería RNDC</label><input id="vca" name="carroceria" [(ngModel)]="f.carroceria" /></div>
          <div class="campo" [hidden]="!ver('combustible')" [class.falta]="falta('combustible')"><label for="vcb">Código combustible RNDC</label><input id="vcb" name="comb" [(ngModel)]="f.combustible" /></div>
          <div class="campo" [hidden]="!ver('ejes')" [class.falta]="falta('ejes')"><label for="vej">Ejes</label><input id="vej" type="number" name="ejes" [(ngModel)]="f.ejes" /></div>
          <div class="campo" [hidden]="!ver('pesoVacio')" [class.falta]="falta('pesoVacio')"><label for="vpv">Peso vacío (kg)</label><input id="vpv" type="number" name="pv" [(ngModel)]="f.pesoVacio" /></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="vpb">Peso bruto vehicular (kg)</label><input id="vpb" type="number" name="pbv" [(ngModel)]="f.pbv" /></div>
          <div class="campo" [hidden]="!ver('capacidad')" [class.falta]="falta('capacidad')"><label for="vcp">Capacidad (kg)</label><input id="vcp" type="number" name="cap" [(ngModel)]="f.capacidad" /></div>
          @if (!soloFaltantes()) {
            <app-buscar-tercero etiqueta="Conductor habitual" rol="conductor" [(valor)]="f.conductorHabitual" />
            <app-buscar-tercero etiqueta="Titular habitual del manifiesto" [(valor)]="f.titularHabitual" placeholder="Vacío = el conductor" />
          }
        </div>
        <fieldset style="margin-top:14px" [hidden]="!verAlguno(['soat.numero', 'soat.vence', 'soat.aseguradoraNit'])"><legend>Documentos</legend><div class="formulario">
          <div class="campo" [hidden]="!ver('soat.numero')" [class.falta]="falta('soat.numero')"><label for="sn">N° póliza SOAT</label><input id="sn" name="soatN" [(ngModel)]="f.soat.numero" /></div>
          <div class="campo" [hidden]="!ver('soat.vence')" [class.falta]="falta('soat.vence')"><label for="sv">SOAT vence</label><input id="sv" type="date" name="soatV" [(ngModel)]="f.soat.vence" /></div>
          <div class="campo" [hidden]="!ver('soat.aseguradoraNit')" [class.falta]="falta('soat.aseguradoraNit')"><label for="sa">NIT aseguradora SOAT</label><input id="sa" name="soatA" [(ngModel)]="f.soat.aseguradoraNit" /></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="san">Aseguradora (nombre)</label><input id="san" name="soatAN" [(ngModel)]="f.aseguradoraSoat" /></div>
          <div class="campo" [hidden]="soloFaltantes()"><label for="tv">Tecnomecánica vence</label><input id="tv" type="date" name="tecno" [(ngModel)]="f.venceTecnomecanica" /></div>
        </div></fieldset>
        <fieldset style="margin-top:14px" [hidden]="!verAlguno(['propietario.tipoId', 'propietario.numId', 'tenedor.tipoId', 'tenedor.numId'])"><legend>Propietario y tenedor (deben existir como terceros en el RNDC)</legend><div class="formulario">
          <div class="campo" [hidden]="!verAlguno(['propietario.tipoId', 'propietario.numId'])"><label for="pt">Tipo doc. propietario</label><select id="pt" name="pt" [(ngModel)]="f.propietario.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo" [hidden]="!verAlguno(['propietario.tipoId', 'propietario.numId'])" [class.falta]="falta('propietario.numId')"><label for="pn">Documento propietario</label><input id="pn" name="pn" [(ngModel)]="f.propietario.numId" /></div>
          <div class="campo" [hidden]="!verAlguno(['tenedor.tipoId', 'tenedor.numId'])"><label for="tt">Tipo doc. tenedor</label><select id="tt" name="tt" [(ngModel)]="f.tenedor.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo" [hidden]="!verAlguno(['tenedor.tipoId', 'tenedor.numId'])" [class.falta]="falta('tenedor.numId')"><label for="tn">Documento tenedor</label><input id="tn" name="tn" [(ngModel)]="f.tenedor.numId" /></div>
        </div></fieldset>
        @if (editando() && !soloFaltantes()) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
        @if (puedeRndc && puedeEditar) { <label class="casilla" style="margin-top:14px"><input type="checkbox" name="sinc" [(ngModel)]="sincronizar" />Crear o actualizar también en el RNDC al guardar</label> }
      </form>
      <app-vista-rndc [variables]="vistaRndc()" (cerrar)="vistaRndc.set(null)" />
      <ng-container pie>
        <button type="button" class="texto" style="margin-right:auto" (click)="verVista()" title="Solo muestra las variables del RNDC; no guarda ni envía nada">Solo mostrar lo que se enviaría</button>
        <button type="button" (click)="abierto.set(false)">Cancelar</button>
        @if (puedeEditar) { <button class="primario" type="submit" form="form-veh" [disabled]="trabajando()">{{ sincronizar && puedeRndc ? 'Guardar y registrar en el RNDC' : 'Guardar' }}</button> }
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
  readonly puedeConsultar = this.auth.tiene(P.RNDC_OPERAR) || this.auth.tiene(P.RNDC_CONSULTAR);
  readonly tipos = Object.entries(TIPOS_ID);
  // Verificación previa y datos que faltan para el RNDC
  readonly verificando = signal(false);
  readonly origen = signal<{ tipo: 'ok' | 'info' | 'alerta'; texto: string } | null>(null);
  readonly faltantes = signal<{ campo: string; etiqueta: string }[]>([]);
  readonly soloFaltantes = signal(false);
  readonly etiquetasFaltantes = computed(() => this.faltantes().map(f => f.etiqueta).join(', '));
  placaBuscar = '';
  consultarRndc = true;
  sincronizar = false;
  readonly lista = signal<any[]>([]);
  readonly cargando = signal(false);
  readonly trabajando = signal(false);
  readonly abierto = signal(false);
  readonly importar = signal(false);
  readonly traer = signal(false);
  // ── Vehículos de Sur Track (rastreo GPS) ──
  private rastreoSrv = inject(Rastreo);
  readonly rastreoHabilitado = computed(() => !!this.rastreoSrv.estado()?.habilitado);
  readonly planSt = signal<any>(null);
  readonly ESTADO_ST: Record<string, string> = { crear: 'Se crea', vincular: 'Se vincula', vinculado: 'Ya vinculado', existe: 'Ya existe', sin_cedula: 'Sin cédula' };
  readonly pendientesSt = computed(() => (this.planSt()?.items || []).filter((x: any) => x.vehiculo !== 'vinculado' || x.conductor === 'crear').length);
  async abrirSurTrack() {
    this.trabajando.set(true);
    try { this.planSt.set(await this.api.get('/rastreo/vehiculos/plan')); }
    catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  async aplicarSurTrack() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/rastreo/vehiculos/sincronizar', {});
      this.avisos.ok(`Sur Track: ${r.vehiculosCreados} vehículo(s) creados, ${r.vehiculosVinculados} vinculados, ${r.conductoresCreados} conductor(es) creados`);
      this.planSt.set(null); this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }
  readonly actualizar = signal(false);
  readonly form = signal<any>(vacio());
  readonly editando = computed(() => !!this.form()._id);
  q = '';
  nombre = nombreTercero;

  private claseNueva = 'vehiculo';
  readonly vistaRndc = signal<[string, string][] | null>(null);
  // Cambios de otros usuarios: la pantalla se actualiza sola
  private enVivo = inject(EnVivo).al(['maestros', 'rndc', 'rastreo'], () => this.cargar());

  constructor() {
    this.cargar();
    this.rastreoSrv.cargar();
    const n = inject(ActivatedRoute).snapshot.queryParamMap.get('nuevo');
    if (n === 'vehiculo' || n === 'remolque') { this.claseNueva = n; setTimeout(() => this.nuevo(), 0); }
  }

  // «Solo mostrar lo que se enviaría»: variables del RNDC sin guardar ni enviar
  async verVista() {
    try { this.vistaRndc.set((await this.api.post<any>('/maestros/vehiculos/vista-rndc', this.cuerpo())).variables); }
    catch (e) { this.avisos.mostrar(await mensajeError(e), 'error'); }
  }


  // ── Paginación con carga progresiva ──
  private pagina = 1;
  readonly total = signal(0);
  readonly cargandoMas = signal(false);
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  buscarDiferido() { clearTimeout(this.temporizador); this.temporizador = setTimeout(() => this.cargar(), 300); }

  clase = '';
  soat = '';
  activos = '';
  async cargar() {
    this.cargando.set(true);
    this.pagina = 1;
    try {
      const r = await this.api.get<any>('/maestros/vehiculos', { q: this.q, clase: this.clase, soat: this.soat, activos: this.activos, pagina: 1, limite: 50 });
      this.lista.set(r.items); this.total.set(r.total);
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async cargarMas() {
    if (this.cargandoMas() || this.lista().length >= this.total()) return;
    this.cargandoMas.set(true);
    try {
      const r = await this.api.get<any>('/maestros/vehiculos', { q: this.q, clase: this.clase, soat: this.soat, activos: this.activos, pagina: this.pagina + 1, limite: 50 });
      this.pagina += 1;
      this.lista.update(l => [...l, ...r.items]);
    } catch (e) { this.avisos.error(e); } finally { this.cargandoMas.set(false); }
  }

  vencida(f: string) { return !!f && new Date(f) < new Date(); }
  chip(e: string) { return ({ enviado: 'ok', error: 'error' } as Record<string, string>)[e] || 'alerta'; }
  estadoRndc(e: string) { return ({ enviado: 'Sincronizado', error: 'Con error' } as Record<string, string>)[e] || 'Pendiente'; }

  falta(campo: string) { return this.faltantes().some(f => f.campo === campo); }
  ver(campo: string) { return !this.soloFaltantes() || this.falta(campo); }
  verAlguno(campos: string[]) { return campos.some(c => this.ver(c)); }

  nuevo() { this.placaBuscar = ''; this.consultarRndc = this.puedeConsultar; this.verificando.set(true); }

  // Busca la placa en la empresa y (si se pide) en el RNDC antes de crear el registro.
  async verificar() {
    const placa = this.placaBuscar.trim().toUpperCase().replace(/[\s-]/g, '');
    let clave: string | null = null;
    if (this.consultarRndc && this.puedeConsultar) clave = await this.clave.obtener();
    this.trabajando.set(true);
    try {
      const r = await this.api.post<any>('/rndc/verificar/vehiculo', { placa, ...(clave ? { clave } : {}) });
      this.verificando.set(false);
      if (r.origen === 'local') {
        this.editar(r.registro, r.faltantes);
        this.origen.set({ tipo: 'info', texto: `La placa ${placa} ya está registrada en su empresa: revise o complete sus datos.` });
      } else if (r.origen === 'rndc') {
        this.editar(r.registro, r.faltantes);
        this.origen.set({ tipo: 'ok', texto: `Datos recuperados del RNDC y guardados en su empresa.${r.faltantes.length ? ' Complete solo lo que falta.' : ' Está completo.'}` });
        this.cargar();
      } else {
        this.form.set({ ...vacio(), placa, clase: this.claseNueva });
        this.vistaRndc.set(null);
        this.faltantes.set([]); this.soloFaltantes.set(false); this.sincronizar = this.puedeRndc;
        this.origen.set(r.consultado
          ? { tipo: 'alerta', texto: `No está en el RNDC (respuesta: ${r.mensaje}). Es un vehículo nuevo: complete sus datos.` }
          : { tipo: 'info', texto: 'Vehículo nuevo en su empresa. No se consultó el RNDC.' });
        this.abierto.set(true);
      }
      if (clave && r.mensaje && /usuario|contrase|clave/i.test(r.mensaje)) this.clave.olvidar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  editar(v: any, faltantes?: any[]) {
    this.origen.set(null); this.vistaRndc.set(null);
    this.faltantes.set(faltantes || []);
    this.soloFaltantes.set(!!faltantes?.length);
    this.sincronizar = false;
    if (!faltantes && this.puedeRndc && v._id) {
      this.api.get<any>(`/rndc/faltantes/vehiculo/${v._id}`).then(r => this.faltantes.set(r.faltantes)).catch(() => {});
    }
    const b = vacio();
    this.form.set({ ...b, ...v, soat: { ...b.soat, ...v.soat, vence: isoDia(v.soat?.vence) }, venceTecnomecanica: isoDia(v.venceTecnomecanica),
      propietario: { ...b.propietario, ...v.propietario }, tenedor: { ...b.tenedor, ...v.tenedor }, conductorHabitual: v.conductorHabitual?._id || '', titularHabitual: v.titularHabitual?._id || v.titularHabitual || '' });
    this.abierto.set(true);
  }

  private cuerpo() {
    const f = this.form();
    const campos = ['placa', 'clase', 'configuracion', 'configuracionNombre', 'marca', 'marcaNombre', 'linea', 'ejes', 'modelo', 'color',
      'carroceria', 'combustible', 'pesoVacio', 'capacidad', 'pbv', 'unidadMedida', 'aseguradoraSoat', 'propietario', 'tenedor', 'activo'];
    const cuerpo: any = Object.fromEntries(campos.map(k => [k, f[k]]));
    cuerpo.placa = String(f.placa).toUpperCase();
    cuerpo.soat = { ...f.soat, vence: f.soat.vence || null };
    cuerpo.venceTecnomecanica = f.venceTecnomecanica || null;
    cuerpo.conductorHabitual = f.conductorHabitual || null;
    cuerpo.titularHabitual = f.titularHabitual || null;
    return cuerpo;
  }

  async guardar() {
    const f = this.form();
    const cuerpo = this.cuerpo();
    this.trabajando.set(true);
    try {
      const guardado = f._id ? await this.api.put<any>(`/maestros/vehiculos/${f._id}`, cuerpo) : await this.api.post<any>('/maestros/vehiculos', cuerpo);
      this.avisos.ok('Vehículo guardado');
      this.abierto.set(false); this.cargar();
      if (this.sincronizar && this.puedeRndc) await this.enviar(guardado);
    } catch (e) { this.avisos.mostrar(await mensajeError(e), 'error'); } finally { this.trabajando.set(false); }
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
