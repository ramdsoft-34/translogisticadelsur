import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { SelectorMunicipio } from '../shared/municipio';
import { FORMATOS, isoDia } from '../shared/formato';
import { VisorAuditoria } from '../shared/auditoria';
import { ConfigCorreo } from '../shared/config-correo';
import { Confirmar } from '../shared/confirmar';
import { filtrar } from '../shared/filtro';
import { RndcClave } from '../core/rndc-clave.service';

type Pestana = 'rndc' | 'correo' | 'usuarios' | 'importar' | 'auditoria';

@Component({
  selector: 'app-configuracion',
  imports: [FormsModule, Modal, Icono, SelectorMunicipio, VisorAuditoria, ConfigCorreo, Confirmar, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Configuración</h1><p class="sutil">{{ auth.usuario()?.empresa?.nombre }}</p></div></div>
    <div class="pestanas">
      @if (auth.tiene(P.CONFIG_GESTIONAR)) { <button [class.activa]="pestana() === 'rndc'" (click)="ir('rndc')">Conexión RNDC y valores</button> }
      @if (auth.tiene(P.CONFIG_GESTIONAR)) { <button [class.activa]="pestana() === 'correo'" (click)="ir('correo')">Correo</button> }
      @if (auth.tiene(P.USUARIOS_GESTIONAR)) { <button [class.activa]="pestana() === 'usuarios'" (click)="ir('usuarios')">Usuarios</button> }
      @if (auth.tiene(P.CONFIG_GESTIONAR)) { <button [class.activa]="pestana() === 'importar'" (click)="ir('importar')">Importar plantilla Excel</button> }
      @if (auth.tiene(P.AUDITORIA_VER)) { <button [class.activa]="pestana() === 'auditoria'" (click)="ir('auditoria')">Auditoría</button> }
    </div>

    @switch (pestana()) {
      @case ('rndc') {
        @if (cfg(); as c) {
          <form (ngSubmit)="guardarConfig()" (input)="sinGuardar.set(true)" (change)="sinGuardar.set(true)">
            <!-- Barra fija: ambiente vigente y aviso de cambios sin guardar -->
            <div class="barra-guardar" [class.pendiente]="sinGuardar()">
              <span>Ambiente vigente: <strong>{{ nombreAmbiente(ambienteGuardado()) }}</strong>
                @if (sinGuardar()) { · <strong>Hay cambios sin guardar</strong> }</span>
              <button class="primario" type="submit" [disabled]="guardando() || !sinGuardar()">{{ guardando() ? 'Guardando…' : 'Guardar configuración' }}</button>
            </div>
            <div class="tarjeta">
              <h2>Conexión</h2>
              <div class="formulario">
                <div class="campo"><label for="amb">Ambiente</label>
                  <select id="amb" name="amb" [(ngModel)]="c.ambiente">
                    <option value="SIMULADO">Simulador local (sin validez legal)</option>
                    <option value="PRUEBAS" [disabled]="!c.ambientesHabilitados?.PRUEBAS">Pruebas del Ministerio{{ c.ambientesHabilitados?.PRUEBAS ? '' : ' (deshabilitado en el servidor)' }}</option>
                    <option value="PRODUCCION" [disabled]="!c.ambientesHabilitados?.PRODUCCION">Producción{{ c.ambientesHabilitados?.PRODUCCION ? '' : ' (deshabilitado en el servidor)' }}</option>
                  </select></div>
                @if (c.ambiente === 'PRODUCCION' && ambienteGuardado() !== 'PRODUCCION') {
                  <div class="ancho mensaje alerta">
                    <strong>Va a activar el RNDC de PRODUCCIÓN:</strong> los documentos que se envíen serán reales ante el Ministerio de Transporte.
                    Próxima remesa <strong>{{ c.consecutivoRemesa }}</strong> · próximo manifiesto <strong>{{ c.consecutivoManifiesto }}</strong>.
                    <label class="casilla" style="margin-top:6px"><input type="checkbox" name="confProd" [(ngModel)]="confirmoProduccion" />Confirmo que esos números siguen al último expedido en el RNDC (incluido el Excel)</label>
                  </div>
                }
                <div class="campo"><label for="usu">Usuario web service RNDC</label><input id="usu" name="usu" [(ngModel)]="c.usuario" autocomplete="off" />
                  <small>Lo asigna el Ministerio de Transporte. La contraseña se pide al enviar y no se guarda.</small></div>
                <div class="campo"><label for="sr">Próximo consecutivo de remesa</label>
                  <input id="sr" name="sr" maxlength="15" [ngModel]="c.consecutivoRemesa" (ngModelChange)="c.consecutivoRemesa = limpiarConsecutivo($event)"
                    placeholder="R10063903" style="text-transform:uppercase" autocomplete="off" />
                  <small>Solo letras y números; debe terminar en número.</small></div>
                <div class="campo"><label for="sm">Próximo consecutivo de manifiesto</label>
                  <input id="sm" name="sm" maxlength="15" [ngModel]="c.consecutivoManifiesto" (ngModelChange)="c.consecutivoManifiesto = limpiarConsecutivo($event)"
                    placeholder="M10063903" style="text-transform:uppercase" autocomplete="off" />
                  <small>Solo letras y números; debe terminar en número.</small></div>
                <div class="ancho mensaje alerta">Los próximos consecutivos deben continuar después del <strong>último número expedido en el RNDC</strong>,
                  incluidos los que se hicieron con la plantilla de Excel o en el portal del Ministerio. Si se repite un número, el RNDC lo rechaza.
                  Se puede corregir hacia atrás si el número no se ha usado; al expedir, la plataforma salta los números que ya tengan documento.</div>
                <div class="ancho verificar-consec">
                  <button type="button" (click)="verificarConsecutivos()" [disabled]="verificandoConsec()" title="Consulta en el RNDC las remesas y manifiestos radicados en los últimos 20 días">
                    <app-icono nombre="enviar" [tam]="15" />{{ verificandoConsec() ? 'Consultando el RNDC…' : 'Verificar consecutivos con el RNDC' }}</button>
                  @if (consec(); as k) {
                    <div class="tabla-caja" style="box-shadow:none;margin-top:10px"><table>
                      <thead><tr><th>Documento</th><th>Último radicado en el RNDC</th><th>Siguiente en la plataforma</th><th></th></tr></thead>
                      <tbody>@for (d of [['remesa', 'Remesa'], ['manifiesto', 'Manifiesto']]; track d[0]) {
                        @let x = k[d[0]];
                        <tr><td>{{ d[1] }}</td><td>{{ x.ultimoRndc || (x.ok ? 'Ninguno en el periodo' : x.mensaje) }}</td><td>{{ x.siguientePlataforma }}</td>
                          <td>@if (x.sugerido) {
                                <button type="button" class="pequeno primario" confirmar="Clic otra vez para ajustar" (confirmado)="ajustarConsecutivo(d[0], x.sugerido)">Ajustar a {{ x.sugerido }}</button>
                              } @else if (x.ultimoRndc) { <span class="chip ok sin-punto">Correcto</span> }</td></tr>
                      }</tbody></table></div>
                    <small class="sutil">Consultado del {{ k.desde }} al {{ k.hasta }}.</small>
                  }
                </div>
              </div>
            </div>
            <div class="tarjeta">
              <h2>Viaje y pagos</h2>
              <div class="formulario">
                <app-municipio etiqueta="Municipio de origen habitual" [(codigo)]="c.codOrigen" />
                <app-municipio etiqueta="Municipio de pago del saldo" [(codigo)]="c.codMunicipioPagoSaldo" />
                <div class="campo"><label for="ps">Fecha de pago del saldo</label><select id="ps" name="ps" [(ngModel)]="c.pagoSaldo"><option value="fin_de_mes">Último día del mes</option><option value="dias">Días después del viaje</option></select></div>
                @if (c.pagoSaldo === 'dias') { <div class="campo"><label for="dps">Días</label><input id="dps" type="number" name="dps" [(ngModel)]="c.diasPagoSaldo" /></div> }
                <div class="campo"><label for="rf">Retención en la fuente (%)</label><input id="rf" type="number" step="0.1" name="rf" [(ngModel)]="c.retefuentePct" /></div>
                <div class="campo"><label for="ri">Retención ICA (por mil)</label><input id="ri" type="number" step="0.1" name="ri" [(ngModel)]="c.reteIca" /></div>
                <div class="campo"><label for="rc">Cargue pagado por</label><select id="rc" name="rc" [(ngModel)]="c.responsablePagoCargue">@for (r of responsables; track r[0]) { <option [value]="r[0]">{{ r[1] }}</option> }</select></div>
                <div class="campo"><label for="rd">Descargue pagado por</label><select id="rd" name="rd" [(ngModel)]="c.responsablePagoDescargue">@for (r of responsables; track r[0]) { <option [value]="r[0]">{{ r[1] }}</option> }</select></div>
                <div class="campo"><label for="op">Tipo de manifiesto por defecto</label><select id="op" name="op" [(ngModel)]="c.operacion"><option value="G">General</option><option value="U">Municipal o urbano</option></select></div>
                <div class="campo"><label for="nm">NIT empresa de monitoreo de flota</label><input id="nm" name="nm" [(ngModel)]="c.nitMonitoreoFlota" /></div>
                <label class="casilla"><input type="checkbox" name="ae" [(ngModel)]="c.aceptacionElectronica" />Aceptación electrónica del titular y conductor</label>
                <label class="casilla"><input type="checkbox" name="fo" [(ngModel)]="c.aplicarFopat" />Aplicar retención FOPAT (0,1 % si el PBV supera 10.500 kg)</label>
              </div>
            </div>
            <div class="tarjeta">
              <h2>Mercancía, póliza y tiempos de la remesa</h2>
              <div class="formulario">
                <div class="campo ancho"><label for="rs">Razón social registrada en el RNDC</label><input id="rs" name="rs" maxlength="120" [(ngModel)]="c.razonSocial" placeholder="Ej. COOPERATIVA DE TRANSPORTES ESPANA" />
                  <small>Tal como aparece en los manifiestos que imprime el RNDC; va en el encabezado del PDF.</small></div>
                <div class="campo"><label for="mc">Código de producto (RNDC)</label><input id="mc" name="mc" maxlength="6" [(ngModel)]="c.mercancia.codigo" /></div>
                <div class="campo"><label for="md">Descripción corta</label><input id="md" name="md" maxlength="60" [(ngModel)]="c.mercancia.descripcion" /></div>
                <div class="campo"><label for="nc">Naturaleza de la carga</label><select id="nc" name="nc" [(ngModel)]="c.naturalezaCarga">@for (n of naturaleza(); track n[0]) { <option [value]="n[0]">{{ n[1] }}</option> }</select></div>
                <div class="campo"><label for="te">Código tipo de empaque</label><input id="te" name="te" maxlength="2" [(ngModel)]="c.tipoEmpaque" /></div>
                <div class="campo"><label for="un">Unidad de medida</label><select id="un" name="un" [(ngModel)]="c.unidadMedida"><option value="1">Kilogramos</option><option value="2">Galones</option></select></div>
                <div class="campo"><label for="pn">N° póliza de la mercancía</label><input id="pn" name="pn" [(ngModel)]="c.poliza.numero" /></div>
                <div class="campo"><label for="pv">Vence</label><input id="pv" type="date" name="pv" [(ngModel)]="c.poliza.vence" /></div>
                <div class="campo"><label for="pa">NIT aseguradora</label><input id="pa" name="pa" [(ngModel)]="c.poliza.aseguradoraNit" /></div>
                <div class="campo"><label for="pd">Dueño de la póliza</label><select id="pd" name="pd" [(ngModel)]="c.poliza.dueno"><option value="E">Empresa de transporte</option><option value="G">Generador de carga</option><option value="N">Sin póliza</option></select></div>
                <div class="campo"><label for="hc">Hora cita de cargue</label><input id="hc" type="time" name="hc" [(ngModel)]="c.horaCitaCargue" /></div>
                <div class="campo"><label for="hd">Hora cita de descargue</label><input id="hd" type="time" name="hd" [(ngModel)]="c.horaCitaDescargue" /></div>
                <div class="campo"><label for="pc">Horas pactadas de cargue</label><input id="pc" type="number" min="0" name="pc" [(ngModel)]="c.horasPactoCargue" /></div>
                <div class="campo"><label for="pdd">Horas pactadas de descargue</label><input id="pdd" type="number" min="0" name="pdd" [(ngModel)]="c.horasPactoDescargue" /></div>
              </div>
            </div>
            <div class="tarjeta">
              <details><summary><strong>Variables adicionales del RNDC (avanzado)</strong></summary>
                <p class="sutil">Para variables que el RNDC exija a su empresa y no estén en el formulario. Reemplazan el valor calculado si tienen el mismo nombre.
                  Marcadores: {{ '{' }}NIT{{ '}' }}, {{ '{' }}PLACA{{ '}' }}, {{ '{' }}FECHA{{ '}' }}, {{ '{' }}CED{{ '}' }}, {{ '{' }}NIT_CLIENTE{{ '}' }}, {{ '{' }}FLETE{{ '}' }}…</p>
                @for (x of c.extras; track $index) {
                  <div class="acciones" style="margin-bottom:6px;flex-wrap:nowrap">
                    <select [name]="'ep' + $index" [(ngModel)]="x.proceso" style="max-width:170px" aria-label="Proceso"><option [ngValue]="3">Remesa (3)</option><option [ngValue]="4">Manifiesto (4)</option><option [ngValue]="5">Cumplido remesa (5)</option><option [ngValue]="6">Cumplido manifiesto (6)</option><option [ngValue]="11">Tercero (11)</option><option [ngValue]="12">Vehículo (12)</option></select>
                    <input [name]="'ev' + $index" [(ngModel)]="x.variable" placeholder="VARIABLE" aria-label="Variable" />
                    <input [name]="'ex' + $index" [(ngModel)]="x.valor" placeholder="Valor" aria-label="Valor" />
                    <button type="button" class="texto" (click)="c.extras.splice($index, 1)" aria-label="Quitar"><app-icono nombre="x" /></button>
                  </div>
                }
                <button type="button" class="pequeno" (click)="c.extras.push({ proceso: 4, variable: '', valor: '' })"><app-icono nombre="mas" [tam]="15" />Agregar variable</button>
              </details>
            </div>
            <div style="margin-top:16px"><button class="primario" type="submit" [disabled]="guardando() || !sinGuardar()">Guardar configuración</button></div>
          </form>
        }
      }
      @case ('correo') { <app-config-correo /> }
      @case ('usuarios') {
        <div class="acciones" style="margin-bottom:12px"><div class="filtro-rapido"><input type="search" placeholder="Buscar nombre, correo o rol" aria-label="Buscar nombre, correo o rol" [value]="qUsu()" (input)="qUsu.set($any($event.target).value)" /></div>
          <select aria-label="Filtrar por rol" [value]="rolUsu()" (change)="rolUsu.set($any($event.target).value)"><option value="">Todos los roles</option>
            @for (r of roles(); track r.clave) { <option [value]="r.clave">{{ r.nombre }}</option> }</select>
          <button class="primario" (click)="nuevoUsuario()" style="margin-left:auto"><app-icono nombre="mas" />Nuevo usuario</button></div>
        <div class="tabla-caja"><table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
          <tbody>@for (u of usuariosVisibles(); track u._id) {
            <tr><td>{{ u.nombre }}</td><td>{{ u.email }}</td><td>{{ rolNombre(u.rol) }}</td><td>{{ u.ultimoAcceso | fechaHora }}</td>
              <td><span class="chip" [class.ok]="u.activo">{{ u.activo ? 'Activo' : 'Inactivo' }}</span></td>
              <td><button class="pequeno" (click)="editarUsuario(u)">Editar</button></td></tr>
          }</tbody></table></div>
        <div class="tarjeta" style="margin-top:16px"><h3>¿Qué puede hacer cada rol?</h3><ul class="sutil" style="margin:0;padding-left:18px">
          <li><strong>Administrador:</strong> todo lo de la empresa, usuarios y configuración. Hay uno solo por empresa.</li>
          <li><strong>Reportero de viajes:</strong> registra viajes y consulta conductores, vehículos y clientes.</li>
          <li><strong>Responsable de manifiestos:</strong> expide, cumple y anula en el RNDC; mantiene conductores y vehículos.</li>
          <li><strong>Contabilidad:</strong> tarifas, liquidación de fletes, reportes y consultas al RNDC.</li>
          <li><strong>Consulta:</strong> solo lectura de viajes, maestros, liquidaciones y reportes.</li></ul></div>
      }
      @case ('importar') {
        <div class="tarjeta" style="max-width:820px">
          <h2>Importar la plantilla de viajes (Excel)</h2>
          <p class="sutil">Carga en <strong>{{ auth.usuario()?.empresa?.nombre }}</strong> la información de la plantilla
            <em>PLANTILLA_DE_VIAJES_FORMULARIO.xlsm</em>: clientes y correos, destinos y tarifas, conductores, titulares, vehículos,
            sedes de destinatarios del RNDC, la bitácora de viajes (con sus remesas y manifiestos expedidos) y la configuración RNDC.</p>
          <ul class="sutil">
            <li>Todo queda solo en esta empresa. No se borra ni se sobrescribe nada; puede importarse varias veces.</li>
            <li>La configuración RNDC solo se toma si la empresa aún no la tiene, y el ambiente sigue en <strong>simulador</strong>.</li>
            <li>Los viajes sin manifiesto registrado en la plantilla quedan como <strong>históricos</strong> y no aparecen en «Manifiestos RNDC».</li>
            <li>Las macros del archivo no se ejecutan.</li>
          </ul>
          <div class="acciones" style="margin-top:12px">
            <input type="file" accept=".xlsx,.xlsm" (change)="elegirPlantilla($event)" aria-label="Plantilla de Excel" />
            <button class="primario" confirmar="Clic otra vez para importar" (confirmado)="importarPlantilla()" [disabled]="!archivoPlantilla() || importando()">{{ importando() ? 'Importando…' : 'Importar' }}</button>
          </div>
          @if (resultadoPlantilla(); as r) {
            <div class="mensaje ok" style="margin-top:14px">
              Clientes: {{ r.clientes?.nuevos }} nuevos · Destinos y tarifas: {{ r.tarifas?.nuevas }} · Terceros: {{ r.terceros?.nuevos }} ·
              Vehículos: {{ r.vehiculos?.nuevos }} · Viajes: {{ r.viajes?.nuevos }} ({{ r.viajes?.conManifiestoRndc }} con manifiesto RNDC, {{ r.viajes?.historicos }} históricos)<br />
              Configuración RNDC: {{ r.configuracion }}
            </div>
            @if (r.avisos?.length) { <div class="mensaje alerta" style="margin-top:8px"><strong>Para revisar:</strong><ul>@for (a of r.avisos; track a) { <li>{{ a }}</li> }</ul></div> }
          }
        </div>
      }
      @case ('auditoria') {
        <app-auditoria />
      }
    }

    <app-modal [titulo]="usuarioForm()._id ? 'Editar usuario' : 'Nuevo usuario'" [abierto]="abiertoUsuario()" (cerrar)="abiertoUsuario.set(false)">
      @let u = usuarioForm();
      <form id="form-usuario" class="formulario" style="grid-template-columns:1fr" (ngSubmit)="guardarUsuario()">
        <div class="campo"><label for="un2">Nombre</label><input id="un2" name="nombre" [(ngModel)]="u.nombre" required /></div>
        <div class="campo"><label for="ue">Correo</label><input id="ue" type="email" name="email" [(ngModel)]="u.email" [disabled]="!!u._id" required /></div>
        <div class="campo"><label for="ur">Rol</label>
          @if (u.rol === 'admin') { <select id="ur" name="rol" disabled><option>Administrador</option></select>
            <small>La empresa tiene un único Administrador; lo gestiona el SuperAdmin.</small>
          } @else { <select id="ur" name="rol" [(ngModel)]="u.rol">@for (r of roles(); track r.clave) { @if (r.asignable) { <option [value]="r.clave">{{ r.nombre }}</option> } }</select> }</div>
        <div class="campo"><label for="up">{{ u._id ? 'Nueva contraseña (opcional)' : 'Contraseña inicial' }}</label><input id="up" type="password" name="password" [(ngModel)]="u.password" autocomplete="new-password" [required]="!u._id" />
          <small>Mínimo 8 caracteres con letras y números. El usuario deberá cambiarla al ingresar.</small></div>
        @if (u._id) { <label class="casilla"><input type="checkbox" name="activo" [(ngModel)]="u.activo" />Activo</label> }
      </form>
      <ng-container pie><button type="button" (click)="abiertoUsuario.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-usuario">Guardar</button></ng-container>
    </app-modal>`,
  styles: [`.barra-guardar { position: sticky; top: 64px; z-index: 4; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
      background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio); padding: 10px 14px; margin-bottom: 16px; box-shadow: var(--sombra); }
    .barra-guardar.pendiente { background: var(--primario-claro); border-color: var(--primario-borde); }`],
})
export class Configuracion {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private avisos = inject(Avisos);
  private clave = inject(RndcClave);
  readonly P = P;
  readonly pestana = signal<Pestana>(this.auth.tiene(P.CONFIG_GESTIONAR) ? 'rndc' : 'usuarios');
  readonly cfg = signal<any>(null);
  readonly naturaleza = signal<[string, string][]>([]);
  readonly usuarios = signal<any[]>([]);
  readonly qUsu = signal('');
  readonly rolUsu = signal('');
  readonly usuariosVisibles = computed(() => filtrar(this.usuarios().filter(u => !this.rolUsu() || u.rol === this.rolUsu())
    .map(u => ({ ...u, _rol: this.rolNombre(u.rol) })), this.qUsu()));
  readonly roles = signal<{ clave: string; nombre: string; asignable?: boolean }[]>([]);
  readonly archivoPlantilla = signal<File | null>(null);
  readonly resultadoPlantilla = signal<any>(null);
  readonly importando = signal(false);
  readonly guardando = signal(false);
  readonly sinGuardar = signal(false);
  readonly ambienteGuardado = signal('');
  readonly abiertoUsuario = signal(false);
  readonly usuarioForm = signal<any>({});
  readonly responsables: [string, string][] = [['E', 'Empresa de transporte'], ['R', 'Remitente'], ['D', 'Destinatario']];

  constructor() {
    this.ir(this.pestana());
    this.api.get<any>('/rndc/catalogos').then(c => this.naturaleza.set(Object.entries(c.naturaleza))).catch(() => {});
  }

  async ir(p: Pestana) {
    this.pestana.set(p);
    try {
      if (p === 'rndc') {
        const c = await this.api.get<any>('/rndc/config');
        this.ambienteGuardado.set(c.ambiente);
        this.sinGuardar.set(false);
        this.cfg.set({ ...c, mercancia: c.mercancia || {}, poliza: { ...(c.poliza || {}), vence: isoDia(c.poliza?.vence) }, extras: c.extras || [] });
      }
      if (p === 'usuarios') {
        const [u, r] = await Promise.all([this.api.get<any[]>('/usuarios'), this.api.get<any[]>('/usuarios/roles')]);
        this.usuarios.set(u); this.roles.set(r);
      }
    } catch (e) { this.avisos.error(e); }
  }

  confirmoProduccion = false;

  async guardarConfig() {
    const c = this.cfg();
    const campos = ['ambiente', 'usuario', 'razonSocial', 'codOrigen', 'poliza', 'mercancia', 'naturalezaCarga', 'tipoEmpaque',
      'unidadMedida', 'operacion', 'retefuentePct', 'reteIca', 'responsablePagoCargue', 'responsablePagoDescargue', 'horaCitaCargue',
      'horaCitaDescargue', 'horasPactoCargue', 'horasPactoDescargue', 'aceptacionElectronica', 'pagoSaldo', 'diasPagoSaldo',
      'codMunicipioPagoSaldo', 'nitMonitoreoFlota', 'aplicarFopat', 'extras', 'consecutivoRemesa', 'consecutivoManifiesto'];
    const cuerpo: any = Object.fromEntries(campos.map(k => [k, c[k]]));
    cuerpo.poliza = { ...c.poliza, vence: c.poliza.vence || null };
    cuerpo.extras = (c.extras || []).filter((x: any) => x.variable);
    for (const k of ['consecutivoRemesa', 'consecutivoManifiesto']) {
      if (!/^[A-Z0-9]*[0-9]$/.test(cuerpo[k] || '')) { this.avisos.mostrar('Los consecutivos solo llevan letras y números y deben terminar en número', 'error'); return; }
    }
    if (c.ambiente === 'PRODUCCION' && this.ambienteGuardado() !== 'PRODUCCION' && !this.confirmoProduccion) {
      this.avisos.mostrar('Marque la confirmación de producción que aparece debajo del ambiente', 'error'); return;
    }
    this.guardando.set(true);
    try {
      await this.api.put('/rndc/config', cuerpo);
      this.avisos.ok(`Configuración guardada. Ambiente: ${this.nombreAmbiente(c.ambiente)}`);
      await this.auth.refrescar();
      this.ir('rndc');
    } catch (e) { this.avisos.error(e); } finally { this.guardando.set(false); }
  }

  // Mayúsculas y solo letras o números (sin espacios, guiones ni símbolos)
  readonly consec = signal<any>(null);
  readonly verificandoConsec = signal(false);
  async verificarConsecutivos() {
    const c = await this.clave.obtener();
    if (!c) return;
    this.verificandoConsec.set(true);
    try {
      const k = await this.api.post<any>('/rndc/consecutivos/verificar', { clave: c });
      this.consec.set(k);
      if (k.remesa.sugerido || k.manifiesto.sugerido) this.avisos.mostrar('La plataforma va por detrás del RNDC: ajuste el consecutivo para evitar DUPLICADOS', 'error');
      else this.avisos.ok('Los consecutivos siguen al último número radicado en el RNDC');
    } catch (e: any) {
      if (/usuario|contrase|clave/i.test(e?.error?.error || '')) this.clave.olvidar();
      this.avisos.error(e);
    } finally { this.verificandoConsec.set(false); }
  }
  async ajustarConsecutivo(doc: string, numero: string) {
    try {
      await this.api.put('/rndc/config', doc === 'remesa' ? { consecutivoRemesa: numero } : { consecutivoManifiesto: numero });
      this.avisos.ok(`Próximo ${doc}: ${numero}`);
      this.consec.update(k => ({ ...k, [doc]: { ...k[doc], sugerido: '', siguientePlataforma: numero } }));
      this.cfg.update(c => ({ ...c, [doc === 'remesa' ? 'consecutivoRemesa' : 'consecutivoManifiesto']: numero }));
    } catch (e) { this.avisos.error(e); }
  }

  limpiarConsecutivo(v: string) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15); }

  nombreAmbiente(a: string) { return ({ SIMULADO: 'simulador local', PRUEBAS: 'pruebas del Ministerio', PRODUCCION: 'PRODUCCIÓN' } as Record<string, string>)[a] || a; }

  elegirPlantilla(ev: Event) { this.archivoPlantilla.set((ev.target as HTMLInputElement).files?.[0] || null); this.resultadoPlantilla.set(null); }

  async importarPlantilla() {
    const f = this.archivoPlantilla();
    if (!f) return;
    this.importando.set(true);
    try {
      this.resultadoPlantilla.set(await this.api.subir('/importaciones/plantilla-viajes', f));
      this.avisos.ok('Plantilla importada');
    } catch (e) { this.avisos.error(e); } finally { this.importando.set(false); }
  }

  rolNombre(r: string) { return this.roles().find(x => x.clave === r)?.nombre || r; }
  detalle(d: any) { const s = JSON.stringify(d || {}); return s === '{}' ? '' : s.slice(0, 160); }

  nuevoUsuario() { this.usuarioForm.set({ nombre: '', email: '', rol: 'reportero', password: '' }); this.abiertoUsuario.set(true); }
  editarUsuario(u: any) { this.usuarioForm.set({ ...u, password: '' }); this.abiertoUsuario.set(true); }

  async guardarUsuario() {
    const u = this.usuarioForm();
    try {
      if (u._id) {
        const cuerpo: any = { nombre: u.nombre, rol: u.rol, activo: u.activo };
        if (u.password) cuerpo.password = u.password;
        await this.api.put(`/usuarios/${u._id}`, cuerpo);
      } else await this.api.post('/usuarios', { nombre: u.nombre, email: u.email, rol: u.rol, password: u.password });
      this.avisos.ok('Usuario guardado'); this.abiertoUsuario.set(false); this.ir('usuarios');
    } catch (e) { this.avisos.error(e); }
  }
}
