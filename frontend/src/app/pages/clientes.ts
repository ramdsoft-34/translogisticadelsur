import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P, TIPOS_ID } from '../core/modelos';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { SelectorMunicipio } from '../shared/municipio';
import { FORMATOS } from '../shared/formato';
import { ImportarExcel } from '../shared/importar-excel';
import { Moneda } from '../shared/moneda';

const clienteVacio = () => ({ nombre: '', tipoId: 'N', nit: '', dv: '', razonSocial: '', sedeRemitente: '', correos: '', whatsapp: '', activo: true });
const tarifaVacia = () => ({ destino: '', codMunicipio: '', tipoCobro: 'viaje', tarifaCliente: 0, tarifaAuxiliar: 0, fleteConductor: 0,
  auxiliarPagado: 0, anticipoHabitual: 0, pesoKg: 0, operacion: '', destinatario: { tipoId: '', numId: '', sede: '' }, activo: true });

@Component({
  selector: 'app-clientes',
  imports: [FormsModule, Modal, Icono, SelectorMunicipio, ImportarExcel, Moneda, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Clientes y tarifas</h1><p class="sutil">Generadores de carga y los destinos que atienden, con su tarifa, flete y anticipo habituales.</p></div>
      <div class="acciones">
        @if (puedeTarifas) { <button (click)="importar.set(true)"><app-icono nombre="descargar" />Importar Excel</button> }
        @if (puedeEditar) { <button class="primario" (click)="nuevoCliente()"><app-icono nombre="mas" />Nuevo cliente</button> }
      </div>
    </div>
    <app-importar-excel tipo="tarifas" titulo="clientes y tarifas" [abierto]="importar()" (cerrar)="importar.set(false)" (importado)="cargar()" />
    <div class="columnas">
      <div class="tabla-caja lista">
        <table><thead><tr><th>Cliente</th><th>NIT</th></tr></thead>
          <tbody>@for (c of clientes(); track c._id) {
            <tr class="seleccionable" [class.activo]="c._id === sel()?._id" (click)="sel.set(c)"><td><strong>{{ c.nombre }}</strong>@if (!c.activo) { <span class="chip">inactivo</span> }</td><td>{{ c.nit }}{{ c.dv ? '-' + c.dv : '' }}</td></tr>
          } @empty { <tr><td colspan="2" class="vacio">Sin clientes</td></tr> }</tbody></table>
      </div>
      <div>
        @if (sel(); as c) {
          <div class="tarjeta">
            <div class="pagina-cab" style="margin-bottom:8px"><div><h2 style="margin:0">{{ c.nombre }}</h2>
              <span class="sutil">{{ c.razonSocial }} · {{ c.tipoId }} {{ c.nit }}{{ c.dv ? '-' + c.dv : '' }} · Sede remitente RNDC: {{ c.sedeRemitente || '—' }}</span></div>
              <div class="acciones">@if (puedeEditar) { <button class="pequeno" (click)="editarCliente(c)">Editar cliente</button> }
                @if (puedeTarifas) { <button class="pequeno primario" (click)="nuevaTarifa()"><app-icono nombre="mas" [tam]="15" />Destino</button> }</div></div>
            <div class="tabla-caja" style="box-shadow:none">
              <table><thead><tr><th>Destino</th><th>Municipio</th><th class="num">Tarifa</th><th class="num">Flete</th><th class="num">Anticipo</th><th class="num">Aux. cobro / pago</th><th></th></tr></thead>
                <tbody>@for (t of tarifasSel(); track t._id) {
                  <tr [class.sutil]="!t.activo"><td><strong>{{ t.destino }}</strong>@if (t.tipoCobro === 'unidad') { <span class="chip info">por unidad</span> }</td>
                    <td>{{ t.codMunicipio }}</td><td class="num">{{ t.tarifaCliente | pesos }}</td><td class="num">{{ t.fleteConductor | pesos }}</td>
                    <td class="num">{{ t.anticipoHabitual | pesos }}</td><td class="num">{{ t.tarifaAuxiliar | pesos }} / {{ t.auxiliarPagado | pesos }}</td>
                    <td>@if (puedeTarifas) { <button class="pequeno" (click)="editarTarifa(t)">Editar</button> }</td></tr>
                } @empty { <tr><td colspan="7" class="vacio">Sin destinos. Agregue los destinos habituales con su tarifa.</td></tr> }</tbody></table>
            </div>
          </div>
        } @else { <div class="tarjeta vacio">Seleccione un cliente para ver sus destinos y tarifas.</div> }
      </div>
    </div>

    <app-modal [titulo]="clienteForm()._id ? 'Editar cliente' : 'Nuevo cliente'" [abierto]="abiertoCliente()" (cerrar)="abiertoCliente.set(false)">
      @let f = clienteForm();
      <form id="form-cliente" class="formulario" (ngSubmit)="guardarCliente()">
        <div class="campo ancho"><label for="cn">Nombre corto</label><input id="cn" name="nombre" [(ngModel)]="f.nombre" required /></div>
        <div class="campo ancho"><label for="crs">Razón social</label><input id="crs" name="rs" [(ngModel)]="f.razonSocial" /></div>
        <div class="campo"><label for="ct">Tipo de documento</label><select id="ct" name="tipo" [(ngModel)]="f.tipoId">@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
        <div class="campo"><label for="cnit">Número (sin DV)</label><input id="cnit" name="nit" [(ngModel)]="f.nit" /></div>
        <div class="campo"><label for="cdv">DV</label><input id="cdv" name="dv" maxlength="1" [(ngModel)]="f.dv" /></div>
        <div class="campo"><label for="cs">Sede remitente RNDC</label><input id="cs" name="sede" maxlength="6" [(ngModel)]="f.sedeRemitente" /><small>Código de la sede del cliente en el RNDC (lugar de cargue).</small></div>
        <div class="campo ancho"><label for="cc">Correos (separados por coma)</label><input id="cc" name="correos" [(ngModel)]="f.correos" /></div>
        <div class="campo ancho"><label for="cw">WhatsApp para el reporte de vehículos</label><input id="cw" name="wa" [(ngModel)]="f.whatsapp" placeholder="3001234567" />
          <small>Opcional. Vacío = al abrir WhatsApp se elige el contacto o grupo.</small></div>
        @if (f._id) { <label class="casilla"><input type="checkbox" name="activo" [(ngModel)]="f.activo" />Activo</label> }
      </form>
      <ng-container pie><button type="button" (click)="abiertoCliente.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-cliente">Guardar</button></ng-container>
    </app-modal>

    <app-modal [titulo]="tarifaForm()._id ? 'Editar destino' : 'Nuevo destino'" [abierto]="abiertoTarifa()" (cerrar)="abiertoTarifa.set(false)" [ancho]="true">
      @let t = tarifaForm();
      <form id="form-tarifa" class="formulario" (ngSubmit)="guardarTarifa()">
        <div class="campo"><label for="td">Destino</label><input id="td" name="destino" [(ngModel)]="t.destino" required /></div>
        <app-municipio etiqueta="Municipio de destino (RNDC)" [(codigo)]="t.codMunicipio" />
        <div class="campo"><label for="tc">Cobro</label><select id="tc" name="cobro" [(ngModel)]="t.tipoCobro"><option value="viaje">Por viaje</option><option value="unidad">Por unidad (× cantidad)</option></select></div>
        <div class="campo"><label for="tt">Tarifa al cliente</label><div class="moneda"><input id="tt" moneda name="tc2" [(ngModel)]="t.tarifaCliente" /></div></div>
        <div class="campo"><label for="tf">Flete al conductor</label><div class="moneda"><input id="tf" moneda name="tf" [(ngModel)]="t.fleteConductor" /></div></div>
        <div class="campo"><label for="ta">Anticipo habitual</label><div class="moneda"><input id="ta" moneda name="ta" [(ngModel)]="t.anticipoHabitual" /></div></div>
        <div class="campo"><label for="tac">Auxiliar: cobro al cliente</label><div class="moneda"><input id="tac" moneda name="tac" [(ngModel)]="t.tarifaAuxiliar" /></div></div>
        <div class="campo"><label for="tap">Auxiliar: pago</label><div class="moneda"><input id="tap" moneda name="tap" [(ngModel)]="t.auxiliarPagado" /></div></div>
        <div class="campo"><label for="tp">Peso habitual (kg)</label><input id="tp" type="number" min="0" name="tp" [(ngModel)]="t.pesoKg" /></div>
        <div class="campo"><label for="to">Tipo de manifiesto</label><select id="to" name="op" [(ngModel)]="t.operacion"><option value="">El de la empresa</option><option value="G">General</option><option value="U">Municipal o urbano</option></select></div>
        <fieldset class="ancho"><legend>Destinatario en el RNDC (vacío = el mismo cliente)</legend><div class="formulario">
          <div class="campo"><label for="dt">Tipo</label><select id="dt" name="dt" [(ngModel)]="t.destinatario.tipoId"><option value=""></option>@for (x of tipos; track x[0]) { <option [value]="x[0]">{{ x[1] }}</option> }</select></div>
          <div class="campo"><label for="dn">Documento</label><input id="dn" name="dn" [(ngModel)]="t.destinatario.numId" /></div>
          <div class="campo"><label for="ds">Sede</label><input id="ds" name="ds" maxlength="6" [(ngModel)]="t.destinatario.sede" /></div>
        </div></fieldset>
        @if (t._id) { <label class="casilla"><input type="checkbox" name="activo" [(ngModel)]="t.activo" />Activo</label> }
      </form>
      <ng-container pie><button type="button" (click)="abiertoTarifa.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-tarifa">Guardar</button></ng-container>
    </app-modal>`,
  styles: [`.columnas { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
    tr.activo { background: var(--primario-claro); box-shadow: inset 4px 0 0 var(--primario); }
    @media (max-width: 900px) { .columnas { grid-template-columns: 1fr; } }`],
})
export class Clientes {
  private api = inject(Api);
  private auth = inject(Auth);
  private avisos = inject(Avisos);
  readonly puedeEditar = this.auth.tiene(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);
  readonly puedeTarifas = this.auth.tiene(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);
  readonly tipos = Object.entries(TIPOS_ID);
  readonly clientes = signal<any[]>([]);
  readonly tarifas = signal<any[]>([]);
  readonly sel = signal<any>(null);
  readonly tarifasSel = computed(() => this.tarifas().filter(t => (t.cliente?._id || t.cliente) === this.sel()?._id));
  readonly abiertoCliente = signal(false);
  readonly importar = signal(false);
  readonly abiertoTarifa = signal(false);
  readonly clienteForm = signal<any>(clienteVacio());
  readonly tarifaForm = signal<any>(tarifaVacia());

  constructor() { this.cargar(); }

  async cargar() {
    try {
      const [c, t] = await Promise.all([this.api.get<any[]>('/maestros/clientes'), this.api.get<any[]>('/maestros/tarifas')]);
      this.clientes.set(c); this.tarifas.set(t);
      const actual = this.sel();
      this.sel.set(actual ? c.find(x => x._id === actual._id) || null : c[0] || null);
    } catch (e) { this.avisos.error(e); }
  }

  nuevoCliente() { this.clienteForm.set(clienteVacio()); this.abiertoCliente.set(true); }
  editarCliente(c: any) { this.clienteForm.set({ ...clienteVacio(), ...c, correos: (c.correos || []).join(', ') }); this.abiertoCliente.set(true); }

  async guardarCliente() {
    const f = this.clienteForm();
    const cuerpo = { nombre: f.nombre, tipoId: f.tipoId, nit: f.nit, dv: f.dv, razonSocial: f.razonSocial, sedeRemitente: f.sedeRemitente,
      correos: String(f.correos || '').split(',').map((s: string) => s.trim()).filter(Boolean), whatsapp: f.whatsapp || '', activo: f.activo };
    try {
      const r: any = f._id ? await this.api.put(`/maestros/clientes/${f._id}`, cuerpo) : await this.api.post('/maestros/clientes', cuerpo);
      this.avisos.ok('Cliente guardado'); this.abiertoCliente.set(false);
      this.sel.set(r); await this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  nuevaTarifa() { this.tarifaForm.set(tarifaVacia()); this.abiertoTarifa.set(true); }
  editarTarifa(t: any) {
    const b = tarifaVacia();
    this.tarifaForm.set({ ...b, ...t, destinatario: { ...b.destinatario, ...t.destinatario } });
    this.abiertoTarifa.set(true);
  }

  async guardarTarifa() {
    const t = this.tarifaForm();
    const campos = ['destino', 'codMunicipio', 'tipoCobro', 'tarifaCliente', 'tarifaAuxiliar', 'fleteConductor', 'auxiliarPagado',
      'anticipoHabitual', 'pesoKg', 'operacion', 'destinatario', 'activo'];
    const cuerpo: any = Object.fromEntries(campos.map(k => [k, t[k]]));
    cuerpo.cliente = this.sel()._id;
    try {
      if (t._id) await this.api.put(`/maestros/tarifas/${t._id}`, cuerpo); else await this.api.post('/maestros/tarifas', cuerpo);
      this.avisos.ok('Destino guardado'); this.abiertoTarifa.set(false); this.cargar();
    } catch (e) { this.avisos.error(e); }
  }
}
