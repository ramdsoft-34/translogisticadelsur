import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from '../shared/modal';
import { Icono } from '../shared/icono';
import { FORMATOS } from '../shared/formato';
import { filtrar } from '../shared/filtro';

const empresaVacia = () => ({ nombre: '', nit: '', dv: '', direccion: '', telefono: '', ciudad: '', correo: '', activa: true,
  administrador: { nombre: '', email: '', password: '' } });

@Component({
  selector: 'app-admin-empresas',
  imports: [FormsModule, Modal, Icono, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Empresas</h1><p class="sutil">Cada empresa trabaja con sus propios datos y usuarios. Aquí se crean las empresas y sus administradores.</p></div>
      <button class="primario" (click)="nueva()"><app-icono nombre="mas" />Nueva empresa</button>
    </div>
    <div class="filtro-rapido"><input type="search" placeholder="Buscar empresa, NIT o ciudad" aria-label="Buscar empresa, NIT o ciudad" [value]="q()" (input)="q.set($any($event.target).value)" /></div>
    <div class="tabla-caja"><table>
      <thead><tr><th>Empresa</th><th>NIT</th><th>Ciudad</th><th class="num">Usuarios</th><th>RNDC</th><th>Estado</th><th></th></tr></thead>
      <tbody>@for (e of empresasVisibles(); track e._id) {
        <tr><td><strong>{{ e.nombre }}</strong></td><td>{{ e.nit }}{{ e.dv ? '-' + e.dv : '' }}</td><td>{{ e.ciudad }}</td>
          <td class="num">{{ e.usuarios }}</td><td>{{ e.rndc?.ambiente }}</td>
          <td><span class="chip" [class.ok]="e.activa" [class.error]="!e.activa">{{ e.activa ? 'Activa' : 'Inactiva' }}</span></td>
          <td><div class="acciones" style="justify-content:flex-end">
            <button class="pequeno" (click)="administradores(e)">Administrador</button>
            <button class="pequeno" (click)="editar(e)">Editar</button></div></td></tr>
      } @empty { <tr><td colspan="7" class="vacio">Aún no hay empresas</td></tr> }</tbody></table></div>

    <app-modal [titulo]="form()._id ? 'Editar empresa' : 'Nueva empresa'" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @let f = form();
      <form id="form-empresa" (ngSubmit)="guardar()">
        <div class="formulario">
          <div class="campo"><label for="en">Nombre</label><input id="en" name="nombre" [(ngModel)]="f.nombre" required /></div>
          <div class="campo"><label for="enit">NIT (sin DV)</label><input id="enit" name="nit" [(ngModel)]="f.nit" required /></div>
          <div class="campo"><label for="edv">DV</label><input id="edv" name="dv" maxlength="1" [(ngModel)]="f.dv" /></div>
          <div class="campo"><label for="eci">Ciudad</label><input id="eci" name="ciudad" [(ngModel)]="f.ciudad" /></div>
          <div class="campo"><label for="edi">Dirección</label><input id="edi" name="dir" [(ngModel)]="f.direccion" /></div>
          <div class="campo"><label for="ete">Teléfono</label><input id="ete" name="tel" [(ngModel)]="f.telefono" /></div>
          <div class="campo"><label for="eco">Correo</label><input id="eco" type="email" name="correo" [(ngModel)]="f.correo" /></div>
          @if (f._id) { <label class="casilla"><input type="checkbox" name="activa" [(ngModel)]="f.activa" />Activa (si se desactiva, sus usuarios no pueden ingresar)</label> }
        </div>
        @if (!f._id) {
          <fieldset style="margin-top:14px"><legend>Administrador de la empresa</legend><div class="formulario">
            <div class="campo"><label for="an">Nombre</label><input id="an" name="an" [(ngModel)]="f.administrador.nombre" required /></div>
            <div class="campo"><label for="ae">Correo</label><input id="ae" type="email" name="ae" [(ngModel)]="f.administrador.email" required /></div>
            <div class="campo"><label for="ap">Contraseña inicial</label><input id="ap" type="password" name="ap" autocomplete="new-password" [(ngModel)]="f.administrador.password" required />
              <small>Mínimo 8 caracteres con letras y números; deberá cambiarla al ingresar.</small></div>
          </div></fieldset>
        }
      </form>
      <ng-container pie><button type="button" (click)="abierto.set(false)">Cancelar</button>
        <button class="primario" type="submit" form="form-empresa">Guardar</button></ng-container>
    </app-modal>

    <app-modal [titulo]="'Administrador · ' + (empresaAdmins()?.nombre || '')" [abierto]="!!empresaAdmins()" (cerrar)="empresaAdmins.set(null)" [ancho]="true">
      <p class="sutil" style="margin-top:0">Cada empresa tiene un único administrador. Si cambia la persona encargada, actualice su nombre y correo y restablezca la clave.</p>
      @if (admins()[0]; as a) {
        <form class="formulario" (ngSubmit)="guardarAdmin(a)">
          <div class="campo"><label for="ean">Nombre</label><input id="ean" name="ean" [(ngModel)]="edicionAdmin.nombre" required /></div>
          <div class="campo"><label for="eae">Correo</label><input id="eae" type="email" name="eae" [(ngModel)]="edicionAdmin.email" required /></div>
          <div class="campo"><label>Estado</label><span><span class="chip" [class.ok]="a.activo">{{ a.activo ? 'Activo' : 'Inactivo' }}</span>
            <small style="margin-left:8px">Último acceso: {{ (a.ultimoAcceso | fechaHora) || 'nunca' }}</small></span></div>
          <div class="campo" style="justify-content:flex-end"><div class="acciones">
            <button type="button" class="pequeno" (click)="alternarAdmin(a)">{{ a.activo ? 'Desactivar' : 'Activar' }}</button>
            <button type="button" class="pequeno" (click)="restableciendo.set(!restableciendo())">Restablecer clave</button>
            @if (a.totp?.activo) { <button type="button" class="pequeno" (click)="quitarDobleFactor(a)" title="Si perdió el celular: podrá activarlo de nuevo en Mi cuenta">Quitar doble factor</button> }
            <button class="primario pequeno" type="submit">Guardar</button></div></div>
        </form>
        @if (restableciendo()) {
          <form class="acciones" style="margin-top:12px" (ngSubmit)="restablecer(a)">
            <input type="password" name="nueva" [(ngModel)]="claveNueva" autocomplete="new-password" placeholder="Nueva contraseña temporal" aria-label="Nueva contraseña temporal" style="max-width:280px" />
            <button class="primario pequeno" type="submit" [disabled]="claveNueva.length < 8">Guardar clave</button>
            <small class="sutil">Mínimo 8 caracteres con letras y números; deberá cambiarla al ingresar.</small>
          </form>
        }
      } @else {
      <h3 style="margin-top:16px">Crear administrador</h3>
      <form class="formulario" (ngSubmit)="crearAdmin()">
        <div class="campo"><label for="nan">Nombre</label><input id="nan" name="nan" [(ngModel)]="nuevoAdmin.nombre" required /></div>
        <div class="campo"><label for="nae">Correo</label><input id="nae" type="email" name="nae" [(ngModel)]="nuevoAdmin.email" required /></div>
        <div class="campo"><label for="nap">Contraseña inicial</label><input id="nap" type="password" name="nap" autocomplete="new-password" [(ngModel)]="nuevoAdmin.password" required /></div>
        <div class="campo" style="justify-content:flex-end"><button class="primario" type="submit">Crear</button></div>
      </form>
      }
    </app-modal>`,
})
export class AdminEmpresas {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly empresas = signal<any[]>([]);
  readonly q = signal('');
  readonly empresasVisibles = computed(() => filtrar(this.empresas(), this.q()));
  readonly abierto = signal(false);
  readonly form = signal<any>(empresaVacia());
  readonly empresaAdmins = signal<any>(null);
  readonly admins = signal<any[]>([]);
  nuevoAdmin = { nombre: '', email: '', password: '' };
  edicionAdmin = { nombre: '', email: '' };

  constructor() { this.cargar(); }
  async cargar() { try { this.empresas.set(await this.api.get<any[]>('/admin/empresas')); } catch (e) { this.avisos.error(e); } }

  nueva() { this.form.set(empresaVacia()); this.abierto.set(true); }
  editar(e: any) { this.form.set({ ...empresaVacia(), ...e }); this.abierto.set(true); }

  async guardar() {
    const f = this.form();
    const base = { nombre: f.nombre, nit: f.nit, dv: f.dv, direccion: f.direccion, telefono: f.telefono, ciudad: f.ciudad, correo: f.correo };
    try {
      if (f._id) await this.api.put(`/admin/empresas/${f._id}`, { ...base, activa: f.activa });
      else await this.api.post('/admin/empresas', { ...base, administrador: f.administrador });
      this.avisos.ok('Empresa guardada'); this.abierto.set(false); this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async administradores(e: any) {
    this.empresaAdmins.set(e);
    this.nuevoAdmin = { nombre: '', email: '', password: '' };
    try {
      const lista = await this.api.get<any[]>(`/admin/empresas/${e._id}/administradores`);
      this.edicionAdmin = { nombre: lista[0]?.nombre || '', email: lista[0]?.email || '' };
      this.admins.set(lista);
    } catch (x) { this.avisos.error(x); }
  }

  async guardarAdmin(a: any) {
    try {
      await this.api.put(`/admin/administradores/${a._id}`, this.edicionAdmin);
      this.avisos.ok('Administrador actualizado'); this.administradores(this.empresaAdmins());
    } catch (x) { this.avisos.error(x); }
  }

  async crearAdmin() {
    const e = this.empresaAdmins();
    try {
      await this.api.post(`/admin/empresas/${e._id}/administradores`, this.nuevoAdmin);
      this.avisos.ok('Administrador creado'); this.administradores(e); this.cargar();
    } catch (x) { this.avisos.error(x); }
  }

  async alternarAdmin(a: any) {
    try { await this.api.put(`/admin/administradores/${a._id}`, { activo: !a.activo }); this.administradores(this.empresaAdmins()); } catch (x) { this.avisos.error(x); }
  }

  readonly restableciendo = signal(false);
  claveNueva = '';
  async quitarDobleFactor(a: any) {
    try {
      await this.api.put(`/admin/administradores/${a._id}`, { quitarDobleFactor: true });
      a.totp = { activo: false };
      this.avisos.ok('Doble factor quitado; el administrador puede activarlo de nuevo en Mi cuenta');
    } catch (x) { this.avisos.error(x); }
  }
  async restablecer(a: any) {
    try {
      await this.api.put(`/admin/administradores/${a._id}`, { password: this.claveNueva });
      this.avisos.ok('Contraseña restablecida; deberá cambiarla al ingresar');
      this.claveNueva = ''; this.restableciendo.set(false);
    } catch (x) { this.avisos.error(x); }
  }
}
