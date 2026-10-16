import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../core/auth.service';
import { Api, mensajeError } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { FORMATOS } from '../shared/formato';
import { environment } from '../../environments/environment';

// Permisos explicados en lenguaje sencillo
const PERMISOS: Record<string, string> = {
  'empresas.gestionar': 'Crear y administrar empresas',
  'usuarios.gestionar': 'Crear y administrar usuarios de la empresa',
  'config.gestionar': 'Configurar la conexión con el RNDC',
  'auditoria.ver': 'Consultar la auditoría',
  'viajes.ver': 'Ver viajes',
  'viajes.registrar': 'Registrar viajes',
  'viajes.editarTodos': 'Editar viajes de otros usuarios',
  'maestros.ver': 'Ver conductores, vehículos y clientes',
  'maestros.editar': 'Editar conductores, vehículos y clientes',
  'tarifas.editar': 'Editar tarifas',
  'rndc.operar': 'Expedir, cumplir y anular en el RNDC',
  'rndc.consultar': 'Consultar el RNDC',
  'liquidacion.ver': 'Ver liquidaciones de fletes',
  'liquidacion.gestionar': 'Crear y facturar liquidaciones',
  'reportes.ver': 'Descargar reportes',
};
const ACCIONES: Record<string, string> = {
  login: 'Inicio de sesión', logout: 'Cierre de sesión', login_fallido: 'Intento de ingreso fallido', cambiar_clave: 'Cambio de contraseña',
  editar_mi_cuenta: 'Actualizó su perfil', crear_viaje: 'Registró un viaje', editar_viaje: 'Editó un viaje', eliminar_viaje: 'Eliminó un viaje',
  rndc_despachar: 'Envió remesa y manifiesto', rndc_cumplir: 'Registró cumplido', rndc_anular: 'Anuló en el RNDC', descarga: 'Descargó un reporte',
  acceso_denegado: 'Acceso denegado', reporte_whatsapp: 'Reportó vehículos por WhatsApp', importar_excel: 'Importó desde Excel',
  importar_plantilla_viajes: 'Importó la plantilla de viajes', editar_config_rndc: 'Cambió la configuración RNDC',
};

@Component({
  selector: 'app-mi-cuenta',
  imports: [FormsModule, ...FORMATOS],
  template: `
    @if (datos(); as d) {
      <div class="cabecera">
        <span class="avatar">{{ iniciales(d.usuario.nombre) }}</span>
        <div><h1>{{ d.usuario.nombre }}</h1><p class="sutil">{{ d.usuario.email }} · {{ d.usuario.rolNombre }}</p></div>
      </div>

      @if (auth.usuario()?.debeCambiarClave) {
        <div class="mensaje alerta" style="margin-bottom:16px">Por seguridad, cambie la contraseña asignada antes de continuar.</div>
      }

      <div class="columnas">
        <div class="col">
          <section class="tarjeta">
            <h2>Perfil</h2>
            <form (ngSubmit)="guardarNombre()" class="formulario" style="grid-template-columns:1fr">
              <div class="campo"><label for="mc-nombre">Nombre</label><input id="mc-nombre" name="nombre" [(ngModel)]="nombre" required minlength="2" /></div>
              <dl class="datos">
                <div><dt>Correo</dt><dd>{{ d.usuario.email }}</dd></div>
                <div><dt>Rol</dt><dd>{{ d.usuario.rolNombre }}</dd></div>
                <div><dt>Cuenta creada</dt><dd>{{ d.usuario.createdAt | fechaHora }}</dd></div>
              </dl>
              <small class="sutil">El correo y el rol los cambia el administrador.</small>
              <div><button type="submit" [disabled]="nombre === d.usuario.nombre || nombre.trim().length < 2">Guardar nombre</button></div>
            </form>
          </section>

          @if (d.empresa; as e) {
            <section class="tarjeta">
              <h2>Empresa</h2>
              <dl class="datos">
                <div><dt>Razón social</dt><dd>{{ e.nombre }}</dd></div>
                <div><dt>NIT</dt><dd>{{ e.nit }}{{ e.dv ? '-' + e.dv : '' }}</dd></div>
                @if (e.ciudad) { <div><dt>Ciudad</dt><dd>{{ e.ciudad }}</dd></div> }
                @if (e.direccion) { <div><dt>Dirección</dt><dd>{{ e.direccion }}</dd></div> }
                @if (e.telefono) { <div><dt>Teléfono</dt><dd>{{ e.telefono }}</dd></div> }
                <div><dt>Ambiente RNDC</dt><dd><span class="punto" [class.prod]="e.ambienteRndc === 'PRODUCCION'"></span>{{ ambiente(e.ambienteRndc) }}</dd></div>
                @if (e.usuarioRndc) { <div><dt>Usuario web service</dt><dd>{{ e.usuarioRndc }}</dd></div> }
              </dl>
            </section>
          }

          <section class="tarjeta">
            <h2>Lo que puede hacer</h2>
            <ul class="permisos">@for (p of d.usuario.permisos; track p) { <li>{{ permiso(p) }}</li> }</ul>
          </section>
        </div>

        <div class="col">
          <section class="tarjeta">
            <h2>Seguridad</h2>
            <dl class="datos">
              <div><dt>Último ingreso</dt><dd>{{ d.usuario.ultimoAcceso ? (d.usuario.ultimoAcceso | fechaHora) : '—' }}</dd></div>
              <div><dt>Último cambio de contraseña</dt><dd>{{ d.seguridad.ultimoCambioClave ? (d.seguridad.ultimoCambioClave | fechaHora) : 'Sin registro' }}</dd></div>
              <div><dt>Intentos fallidos (30 días)</dt><dd [class.alerta]="d.seguridad.intentosFallidos30Dias > 0">{{ d.seguridad.intentosFallidos30Dias }}</dd></div>
              <div><dt>Duración de la sesión</dt><dd>{{ duracion(d.seguridad.sesionExpira) }} · se cierra tras {{ inactividad }} min sin uso</dd></div>
            </dl>
          </section>

          <section class="tarjeta">
            <h2>Cambiar contraseña</h2>
            <form (ngSubmit)="guardarClave()" class="formulario" style="grid-template-columns:1fr">
              <div class="campo"><label for="actual">Contraseña actual</label>
                <input id="actual" type="password" name="actual" [(ngModel)]="actual" autocomplete="current-password" required /></div>
              <div class="campo"><label for="nueva">Nueva contraseña</label>
                <input id="nueva" type="password" name="nueva" [(ngModel)]="nueva" autocomplete="new-password" required minlength="8" />
                <small>Mínimo 8 caracteres, con letras y números.</small></div>
              <div class="campo"><label for="repetir">Repita la nueva contraseña</label>
                <input id="repetir" type="password" name="repetir" [(ngModel)]="repetir" autocomplete="new-password" required /></div>
              @if (error()) { <div class="mensaje error">{{ error() }}</div> }
              <div><button class="primario" type="submit" [disabled]="guardando()">Cambiar contraseña</button></div>
            </form>
          </section>

          <section class="tarjeta">
            <h2>Actividad reciente</h2>
            <ul class="actividad">
              @for (a of d.actividad; track $index) {
                <li [class.fallo]="a.resultado !== 'exito'"><span>{{ accion(a.accion) }}</span><small>{{ a.fecha | fechaHora }}{{ a.ip ? ' · ' + a.ip : '' }}</small></li>
              } @empty { <li class="sutil">Sin actividad registrada.</li> }
            </ul>
          </section>
        </div>
      </div>
    } @else {
      <span class="esqueleto" style="height:28px;width:240px"></span>
    }`,
  styles: [`
    .cabecera { display: flex; gap: 16px; align-items: center; margin-bottom: 22px; }
    .cabecera p { margin: 4px 0 0; }
    .avatar { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--negro); color: var(--primario);
      font-weight: 650; font-size: 18px; }
    .columnas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .col { display: flex; flex-direction: column; gap: 16px; }
    .col .tarjeta + .tarjeta { margin-top: 0; }
    .datos { margin: 0; display: grid; gap: 0; }
    .datos > div { display: flex; justify-content: space-between; gap: 16px; padding: 9px 0; border-bottom: 1px solid var(--gris-15); }
    .datos > div:last-child { border-bottom: 0; }
    dt { color: var(--gris-5); }
    dd { margin: 0; font-weight: 500; text-align: right; display: flex; align-items: center; gap: 6px; }
    dd.alerta { color: var(--ambar); }
    .punto { width: 7px; height: 7px; border-radius: 50%; background: var(--ambar); }
    .punto.prod { background: var(--verde); }
    .permisos { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .permisos li { padding-left: 18px; position: relative; color: var(--gris-7); }
    .permisos li::before { content: ""; position: absolute; left: 2px; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--primario); }
    .actividad { margin: 0; padding: 0; list-style: none; }
    .actividad li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--gris-15); }
    .actividad li:last-child { border-bottom: 0; }
    .actividad small { color: var(--gris-5); white-space: nowrap; }
    .actividad li.fallo span { color: var(--rojo); }
    @media (max-width: 900px) { .columnas { grid-template-columns: 1fr; } }
  `],
})
export class MiCuenta {
  readonly auth = inject(Auth);
  private api = inject(Api);
  private avisos = inject(Avisos);
  private router = inject(Router);
  readonly datos = signal<any>(null);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly inactividad = environment.inactividadMin;
  nombre = '';
  actual = ''; nueva = ''; repetir = '';

  constructor() { this.cargar(); }

  async cargar() {
    try {
      const d = await this.api.get<any>('/auth/mi-cuenta');
      this.datos.set(d);
      this.nombre = d.usuario.nombre;
    } catch (e) { this.avisos.error(e); }
  }

  iniciales(n: string) { return (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase(); }
  permiso(p: string) { return PERMISOS[p] || p; }
  accion(a: string) {
    if (ACCIONES[a]) return ACCIONES[a];
    const palabras: Record<string, string> = { vehiculo: 'vehículo', liquidacion: 'liquidación', configuracion: 'configuración' };
    const [verbo, ...resto] = a.split('_');
    const objeto = resto.map(w => palabras[w] || w).join(' ');
    const verbos: Record<string, string> = { crear: 'Creó', editar: 'Editó', eliminar: 'Eliminó', estado: 'Cambió estado de', importar: 'Importó', exportar: 'Exportó', verificar: 'Verificó' };
    return verbos[verbo] ? `${verbos[verbo]} ${objeto}` : a.replace(/_/g, ' ');
  }
  ambiente(a: string) { return ({ SIMULADO: 'Simulador local', PRUEBAS: 'Pruebas del Ministerio', PRODUCCION: 'Producción' } as Record<string, string>)[a] || a; }
  duracion(s: string) { const m = /^(\d+)h$/.exec(s || ''); return m ? `${m[1]} horas` : s; }

  async guardarNombre() {
    try {
      await this.api.put('/auth/mi-cuenta', { nombre: this.nombre.trim() });
      await this.auth.refrescar();
      this.avisos.ok('Nombre actualizado');
      this.cargar();
    } catch (e) { this.avisos.error(e); }
  }

  async guardarClave() {
    this.error.set('');
    if (this.nueva !== this.repetir) { this.error.set('Las contraseñas nuevas no coinciden'); return; }
    if (this.nueva.length < 8 || !/[A-Za-z]/.test(this.nueva) || !/\d/.test(this.nueva)) { this.error.set('La contraseña debe tener mínimo 8 caracteres con letras y números'); return; }
    this.guardando.set(true);
    try {
      const debiaCambiar = this.auth.usuario()?.debeCambiarClave;
      await this.auth.cambiarClave(this.actual, this.nueva);
      this.actual = this.nueva = this.repetir = '';
      this.avisos.ok('Contraseña actualizada');
      if (debiaCambiar) this.router.navigateByUrl(this.auth.inicio()); else this.cargar();
    } catch (e) {
      this.error.set(await mensajeError(e));
    } finally {
      this.guardando.set(false);
    }
  }
}
