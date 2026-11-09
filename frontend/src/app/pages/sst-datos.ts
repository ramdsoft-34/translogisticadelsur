import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { VisorPdf } from '../shared/visor-pdf';
import { Confirmar } from '../shared/confirmar';
import { ESTILOS_SST, NIVELES_PESV, aIso } from './sst-comun';
import { viewChild } from '@angular/core';

interface Datos {
  empresa: { nombre: string; nit: string; dv: string; direccion: string; telefono: string };
  responsables: { representanteLegal: string; documentoRepresentante: string; responsableSst: string; licenciaSst: string; liderPesv: string };
  riesgo: { arl: string; claseRiesgo: string; actividadEconomica: string; trabajadores: number | null; nivelPesv: string };
  autoevaluacion: { estandares: { valor: number | null; fecha: string | null }; pesv: { valor: number | null; fecha: string | null } };
  colores: { principal: string; acento: string }; pieTexto: string;
  membrete: { encabezado: boolean; pie: boolean };
  flota: { vehiculos: number; conductores: number };
}

// Datos y membrete de SG-SST: lo que llena los formatos y el membrete que llevan los PDF y los Word propios.
@Component({
  selector: 'app-sst-datos',
  imports: [FormsModule, RouterLink, Icono, VisorPdf, Confirmar],
  template: `
    <div class="pagina-cab">
      <div><h1>Datos y membrete</h1>
        <p class="sutil">Lo que se escribe aquí llena los formatos (representante legal, responsable del SG-SST, ARL, clase de riesgo…). El membrete se pone en todos los PDF y en los Word y Excel propios.</p></div>
      <div class="acciones"><button (click)="verMuestra()"><app-icono nombre="ojo" />Ver cómo queda</button></div>
    </div>

    @if (cargando()) { <p class="sutil">Cargando…</p> }
    @else if (d) {
      <div class="dos-columnas">
        <form class="tarjeta" (ngSubmit)="guardar()">
          <h2 class="empresa">{{ d.empresa.nombre }} · NIT {{ d.empresa.nit }}{{ d.empresa.dv ? '-' + d.empresa.dv : '' }}</h2>
          <p class="sutil">Razón social, NIT, dirección y teléfono se toman de la configuración de la empresa.</p>
          <fieldset [disabled]="!puede">
            <section class="bloque"><h3>Responsables</h3>
              <div class="formulario">
                <div class="campo"><label for="d-rep">Representante legal</label><input id="d-rep" name="rep" [(ngModel)]="d.responsables.representanteLegal" maxlength="120" /></div>
                <div class="campo"><label for="d-docrep">Documento del representante</label><input id="d-docrep" name="docrep" [(ngModel)]="d.responsables.documentoRepresentante" maxlength="20" inputmode="numeric" /></div>
                <div class="campo"><label for="d-resp">Responsable del SG-SST</label><input id="d-resp" name="resp" [(ngModel)]="d.responsables.responsableSst" maxlength="120" /></div>
                <div class="campo"><label for="d-lic">Licencia en SST</label><input id="d-lic" name="lic" [(ngModel)]="d.responsables.licenciaSst" maxlength="120" placeholder="Resolución y fecha" /></div>
                <div class="campo"><label for="d-lider">Líder del PESV</label><input id="d-lider" name="lider" [(ngModel)]="d.responsables.liderPesv" maxlength="120" /></div>
              </div>
            </section>
            <section class="bloque"><h3>Riesgo y tamaño</h3>
              <div class="formulario">
                <div class="campo"><label for="d-arl">ARL</label><input id="d-arl" name="arl" [(ngModel)]="d.riesgo.arl" maxlength="80" /></div>
                <div class="campo"><label for="d-clase">Clase de riesgo</label>
                  <select id="d-clase" name="clase" [(ngModel)]="d.riesgo.claseRiesgo"><option value="">Sin definir</option>@for (c of ['I', 'II', 'III', 'IV', 'V']; track c) { <option [value]="c">{{ c }}</option> }</select></div>
                <div class="campo"><label for="d-act">Actividad económica</label><input id="d-act" name="act" [(ngModel)]="d.riesgo.actividadEconomica" maxlength="160" /></div>
                <div class="campo"><label for="d-trab">Número de trabajadores</label><input id="d-trab" name="trab" type="number" min="0" inputmode="numeric" [(ngModel)]="d.riesgo.trabajadores" /></div>
                <div class="campo"><label for="d-pesv">Nivel del PESV</label>
                  <select id="d-pesv" name="pesv" [(ngModel)]="d.riesgo.nivelPesv"><option value="">Sin definir</option>@for (n of niveles; track n[0]) { <option [value]="n[0]">{{ n[1] }}</option> }</select>
                  <small class="nota">En la plataforma: {{ d.flota.vehiculos }} vehículo(s) y {{ d.flota.conductores }} conductor(es). El nivel lo define el líder del PESV.</small></div>
              </div>
            </section>
            <section class="bloque"><h3>Última autoevaluación</h3>
              <p class="nota">Los porcentajes salen de la autoevaluación que hace el responsable; la plataforma no los calcula.</p>
              <div class="formulario">
                <div class="campo"><label for="d-est">Estándares mínimos (%)</label><input id="d-est" name="est" type="number" min="0" max="100" step="0.1" [(ngModel)]="d.autoevaluacion.estandares.valor" />
                  <small>Se actualiza solo al cerrar la autoevaluación en <a routerLink="/sst/planes">Autoevaluación y planes</a>.</small></div>
                <div class="campo"><label for="d-estf">Fecha</label><input id="d-estf" name="estf" type="date" [max]="hoy" [(ngModel)]="fechas.estandares" /></div>
                <div class="campo"><label for="d-pv">PESV (%)</label><input id="d-pv" name="pv" type="number" min="0" max="100" step="0.1" [(ngModel)]="d.autoevaluacion.pesv.valor" /></div>
                <div class="campo"><label for="d-pvf">Fecha</label><input id="d-pvf" name="pvf" type="date" [max]="hoy" [(ngModel)]="fechas.pesv" /></div>
              </div>
            </section>
            <section class="bloque"><h3>Colores y pie</h3>
              <div class="formulario">
                <div class="campo"><label for="d-c1">Color principal</label><input id="d-c1" name="c1" type="color" [(ngModel)]="d.colores.principal" /></div>
                <div class="campo"><label for="d-c2">Color de acento</label><input id="d-c2" name="c2" type="color" [(ngModel)]="d.colores.acento" /></div>
                <div class="campo ancho"><label for="d-pie">Texto del pie</label><input id="d-pie" name="pie" [(ngModel)]="d.pieTexto" maxlength="200" placeholder="Dirección · teléfono · correo · sitio web" /></div>
              </div>
            </section>
          </fieldset>
          @if (error()) { <div class="mensaje error" role="alert">{{ error() }}</div> }
          @if (puede) { <button type="submit" class="primario" [disabled]="trabajando()"><app-icono nombre="check" [tam]="16" />{{ trabajando() ? 'Guardando…' : 'Guardar datos' }}</button> }
        </form>

        <aside class="tarjeta">
          <h2>Membrete</h2>
          <p class="sutil">Suba la franja de encabezado y la de pie tal como salen en su papelería (PNG o JPG horizontal). Si no sube franja, los formatos usan el encabezado clásico con el logo.</p>
          @for (p of partes; track p[0]) {
            <section class="bloque">
              <div class="seccion-cab"><h3 class="sin-margen">{{ p[1] }}</h3>
                @if (puede) { <div class="acciones">
                  <label class="boton pequeno"><input type="file" accept="image/png,image/jpeg" class="visualmente-oculto" (change)="subir(p[0], $event)" />{{ d.membrete[p[0]] ? 'Cambiar' : 'Subir' }}</label>
                  @if (d.membrete[p[0]]) { <button type="button" class="pequeno texto" confirmar="Clic otra vez para quitar" (confirmado)="quitar(p[0])">Quitar</button> }
                </div> }
              </div>
              @if (imagenes()[p[0]]; as img) { <img [src]="img" [alt]="p[1]" class="franja" /> }
              @else { <p class="nota">Sin franja: se usa el {{ p[0] === 'encabezado' ? 'encabezado clásico con el logo' : 'pie con el texto de arriba' }}.</p> }
            </section>
          }
          <h2>Logo</h2>
          <p class="sutil">El mismo logo del soporte interno; va en el encabezado clásico y en los Word y Excel con <code>{{ '{{empresa.logo}}' }}</code>. Lo sube el administrador de la empresa en Empresa → Configuración.</p>
        </aside>
      </div>
    }
    <app-visor-pdf #visor />
  `,
  styles: [ESTILOS_SST, `
    .dos-columnas { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .empresa { font-size: 16px; margin: 0; }
    fieldset { border: 0; padding: 0; margin: 14px 0 0; min-width: 0; }
    .franja { width: 100%; max-height: 90px; object-fit: contain; border: 1px dashed var(--gris-3); border-radius: var(--radio); background: #fff; }
    .sin-margen { margin: 0 !important; }
    label.boton { cursor: pointer; display: inline-flex; align-items: center; border: 1px solid var(--gris-3); border-radius: 8px; background: var(--gris-0); font-weight: 600; }
    input[type="color"] { min-height: 40px; padding: 2px; }
    @media (max-width: 1000px) { .dos-columnas { grid-template-columns: 1fr; } }
  `],
})
export class SstDatos {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private visor = viewChild.required<VisorPdf>('visor');
  readonly puede = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly niveles = Object.entries(NIVELES_PESV);
  readonly partes: ['encabezado' | 'pie', string][] = [['encabezado', 'Encabezado'], ['pie', 'Pie de página']];
  readonly hoy = aIso(new Date().toISOString());
  readonly cargando = signal(true);
  readonly trabajando = signal(false);
  readonly error = signal('');
  readonly imagenes = signal<{ encabezado?: string; pie?: string }>({});
  d: Datos | null = null;
  fechas = { estandares: '', pesv: '' };

  constructor() { this.cargar(); }

  async cargar() {
    try {
      this.d = await this.api.get<Datos>('/sst/datos');
      this.fechas = { estandares: aIso(this.d.autoevaluacion.estandares.fecha), pesv: aIso(this.d.autoevaluacion.pesv.fecha) };
      this.imagenes.set(await this.api.get('/sst/datos/membrete'));
    } catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }

  async guardar() {
    if (!this.d) return;
    this.error.set('');
    const pct = (v: number | null) => (v === null || (v as unknown) === '' ? null : Number(v));
    for (const v of [pct(this.d.autoevaluacion.estandares.valor), pct(this.d.autoevaluacion.pesv.valor)]) {
      if (v !== null && (v < 0 || v > 100)) { this.error.set('Los porcentajes van de 0 a 100.'); return; }
    }
    this.trabajando.set(true);
    try {
      this.d = await this.api.put<Datos>('/sst/datos', {
        responsables: this.d.responsables, riesgo: { ...this.d.riesgo, trabajadores: this.d.riesgo.trabajadores ?? '' },
        autoevaluacion: { estandares: { valor: pct(this.d.autoevaluacion.estandares.valor), fecha: this.fechas.estandares || null },
          pesv: { valor: pct(this.d.autoevaluacion.pesv.valor), fecha: this.fechas.pesv || null } },
        colores: this.d.colores, pieTexto: this.d.pieTexto,
      });
      this.avisos.ok('Datos guardados.');
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  subir(parte: 'encabezado' | 'pie', ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { this.avisos.error('Suba una imagen PNG o JPG.'); return; }
    if (f.size > 1_000_000) { this.avisos.error('La imagen pesa más de 1 MB. Redúzcala antes de subirla.'); return; }
    const lector = new FileReader();
    lector.onload = async () => {
      try {
        this.d = await this.api.put<Datos>(`/sst/datos/membrete/${parte}`, { imagen: lector.result });
        this.imagenes.update((x) => ({ ...x, [parte]: String(lector.result) }));
        this.avisos.ok('Membrete actualizado.');
      } catch (e) { this.avisos.error(e); }
    };
    lector.readAsDataURL(f);
  }

  async quitar(parte: 'encabezado' | 'pie') {
    try {
      this.d = await this.api.put<Datos>(`/sst/datos/membrete/${parte}`, { imagen: '' });
      this.imagenes.update((x) => ({ ...x, [parte]: '' }));
    } catch (e) { this.avisos.error(e); }
  }

  verMuestra() { this.visor().ver('/sst/datos/membrete/muestra', 'Vista previa del membrete'); }
}
