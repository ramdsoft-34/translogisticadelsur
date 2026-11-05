import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Modal } from './modal';
import { Icono } from './icono';
import { FORMATOS } from './formato';

const GRUPOS: { clave: string; titulo: string; items: Record<string, string> }[] = [
  { clave: 'documentos', titulo: 'Documentos', items: { licenciaConduccion: 'Licencia de conducción', licenciaTransito: 'Licencia de tránsito',
    tarjetaOperacion: 'Tarjeta de operación', seguroSOAT: 'SOAT', revisionTecnica: 'Revisión técnico-mecánica', revisionPreventiva: 'Revisión preventiva',
    polizaResponsabilidad: 'Póliza de responsabilidad civil', formatoFUEC: 'Formato FUEC', soporteInspeccion: 'Soporte de inspección', soporteLimpieza: 'Soporte de limpieza' } },
  { clave: 'equipos', titulo: 'Equipos de seguridad', items: { cinturonesPito: 'Cinturones y pito', luces: 'Luces', cajaHerramientas: 'Caja de herramientas',
    gatoConos: 'Gato y conos', extintor: 'Extintor', sistemaElectrico: 'Sistema eléctrico', sistemasBaterias: 'Baterías' } },
  { clave: 'vehiculo', titulo: 'Estado del vehículo', items: { espejosRetrovisores: 'Espejos retrovisores', direccion: 'Dirección', inspeccionMotor: 'Motor',
    tanqueCombustible: 'Tanque de combustible', vidriosPanoramicos: 'Vidrios panorámicos', limpiaparabrisas: 'Limpiaparabrisas', frenosServicio: 'Frenos de servicio',
    llantasEstado: 'Estado de las llantas' } },
];

// Checklist preoperacional diario del conductor del viaje (lo diligencia en Sur Track): ver y descargar en PDF.
// Uso: <app-checklist-conductor #ck /> … ck.abrir(viajeId)
@Component({
  selector: 'app-checklist-conductor',
  imports: [FormsModule, Modal, Icono, ...FORMATOS],
  template: `
    <app-modal titulo="Checklist preoperacional" [abierto]="abierto()" (cerrar)="abierto.set(false)" [ancho]="true">
      @if (cargando()) { <p class="sutil">Consultando Sur Track…</p> }
      @else if (datos(); as d) {
        @if (!d.checklist) {
          <div class="mensaje alerta">El conductor de la placa <strong>{{ d.viaje.placa }}</strong> no tiene checklist registrado en Sur Track. No podrá iniciar el viaje hasta diligenciarlo.</div>
        } @else {
          @let c = d.checklist;
          <div class="cab">
            <div><strong>{{ c.firma?.nombre || d.conductor?.nombre || d.viaje.conductor }}</strong>
              <span class="sutil d-bloque"><span class="placa">{{ d.viaje.placa }}</span> · Diligenciado {{ c.fecha | fechaHora }}</span></div>
            <span class="chips">
              @if (c.resultado) { <span class="chip" [class.ok]="c.resultado === 'apto'" [class.error]="c.resultado !== 'apto'">{{ c.resultado === 'apto' ? 'Apto' : 'No apto' }}</span> }
              @if (c.vigente || !(c.resultado && esDeHoy(c))) {
                <span class="chip" [class.ok]="c.vigente" [class.error]="!c.vigente">{{ c.vigente ? 'Vigente hoy' : (c.completo ? 'No es de hoy' : 'Incompleto') }}</span>
              }
            </span>
          </div>
          @if (c.autorizacion?.fecha) {
            <div class="mensaje info">Salida autorizada por <strong>{{ c.autorizacion.por }}</strong> el {{ c.autorizacion.fecha | fechaHora }}. Motivo: {{ c.autorizacion.motivo }}</div>
          } @else if (c.resultado === 'no_apto') {
            <div class="mensaje alerta">Hay ítems críticos en «Mal»: el conductor no puede aceptar ni iniciar viajes con este vehículo hoy, salvo que el administrador autorice la salida.</div>
            @if (puedeAutorizar && d.servidor === 'app' && esDeHoy(c)) {
              <form id="form-autorizar-ck" class="formulario" (ngSubmit)="autorizar()">
                <div class="campo ancho"><label for="ck-motivo">Motivo de la autorización</label>
                  <textarea id="ck-motivo" name="motivo" rows="2" [(ngModel)]="motivo" maxlength="500" placeholder="Ej.: la direccional se cambia en el primer taller de la ruta"></textarea>
                  <small>Queda registrado quién autorizó, cuándo y por qué. Se avisa al conductor.</small></div>
              </form>
            }
          } @else if (!c.vigente) { <div class="mensaje alerta">El conductor debe hacer el checklist de hoy en Sur Track antes de iniciar el viaje.</div> }
          @if (c.kilometraje) { <p class="sutil">Kilometraje: {{ c.kilometraje | miles }}</p> }
          @else { <p class="sutil">Vencimiento de revisión técnico-mecánica declarado: {{ c.venceRevisionTecnica ? (c.venceRevisionTecnica | dia) : '—' }}</p> }
          @if (c.detalle?.length) {
            <div class="grupos">
              @for (g of GRUPOS; track g.clave) {
                <section><h3>{{ g.titulo }}</h3>
                  <ul>@for (it of detalleDe(c, g.clave); track it.clave) {
                    <li [class.no]="it.valor === 'mal'" [class.na]="it.valor === 'na'">
                      <span class="marca">{{ it.valor === 'mal' ? '✗' : it.valor === 'na' ? '–' : '✓' }}</span>
                      <span>{{ it.nombre }}@if (it.critico) { <small class="critico">crítico</small> }
                        @if (it.valor === 'mal' && it.observacion) { <small class="obs">{{ it.observacion }}</small> }</span>
                    </li>
                  }</ul></section>
              }
            </div>
          } @else {
          <div class="grupos">
            @for (g of GRUPOS; track g.clave) {
              <section><h3>{{ g.titulo }}</h3>
                <ul>@for (it of items(g.items); track it[0]) {
                  <li [class.no]="c[g.clave]?.[it[0]] !== true"><span class="marca">{{ c[g.clave]?.[it[0]] === true ? '✓' : '✗' }}</span>{{ it[1] }}</li>
                }</ul></section>
            }
          </div>
          }
          @if (c.firma?.imagenBase64) {
            <h3>Firma del conductor</h3>
            <img class="firma" [src]="'data:image/png;base64,' + limpiarFirma(c.firma.imagenBase64)" alt="Firma del conductor" />
            <p class="sutil">{{ c.firma.nombre }} · C.C. {{ c.firma.cedula }} · {{ c.firma.fecha | fechaHora }}</p>
          }
        }
      }
      <ng-container pie>
        <button type="button" (click)="abierto.set(false)">Cerrar</button>
        @if (datos()?.checklist) { <button type="button" [class.primario]="!puedeAutorizarEste()" (click)="descargar()"><app-icono nombre="descargar" [tam]="16" />Descargar PDF</button> }
        @if (puedeAutorizarEste()) {
          <button type="submit" class="primario" form="form-autorizar-ck" [disabled]="trabajando() || motivo.trim().length < 10">{{ trabajando() ? 'Autorizando…' : 'Autorizar salida' }}</button>
        }
      </ng-container>
    </app-modal>`,
  styles: [`
    .cab { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    .d-bloque { display: block; }
    .grupos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    h3 { font-size: 13px; margin: 10px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--gris-6); }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    li { display: flex; gap: 8px; align-items: center; padding: 4px 8px; border-radius: 8px; background: var(--verde-claro); }
    li.no { background: var(--rojo-claro); }
    li.na { background: var(--gris-1); } li.na .marca { color: var(--gris-6); }
    .chips { display: flex; gap: 6px; }
    .critico { margin-left: 6px; font-size: 11px; color: var(--gris-6); text-transform: uppercase; letter-spacing: .03em; }
    .obs { display: block; color: var(--gris-7, #444); }
    .marca { font-weight: 700; width: 14px; } li .marca { color: var(--verde); } li.no .marca { color: var(--rojo); }
    .firma { max-width: 260px; max-height: 110px; border: 1px solid var(--gris-2); border-radius: 8px; background: #fff; }
    @media (max-width: 760px) { .grupos { grid-template-columns: 1fr; } }
  `],
})
export class ChecklistConductor {
  private api = inject(Api);
  private avisos = inject(Avisos);
  // Autorizar un No apto es una decisión de seguridad: solo el administrador de la empresa
  readonly puedeAutorizar = inject(Auth).tiene(P.CONFIG_GESTIONAR);
  readonly trabajando = signal(false);
  motivo = '';
  readonly GRUPOS = GRUPOS;
  readonly abierto = signal(false);
  readonly cargando = signal(false);
  readonly datos = signal<any>(null);
  private viajeId = '';

  items(m: Record<string, string>) { return Object.entries(m); }
  detalleDe(c: any, grupo: string) { return (c.detalle || []).filter((i: any) => i.grupo === grupo); }
  // Solo el preoperacional de hoy (en hora de Colombia) se puede autorizar
  esDeHoy(c: any) {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    return (c.dia || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(c.fecha))) === hoy;
  }
  puedeAutorizarEste() {
    const d = this.datos(); const c = d?.checklist;
    return !!(this.puedeAutorizar && d?.servidor === 'app' && c?.resultado === 'no_apto' && !c.autorizacion?.fecha && this.esDeHoy(c));
  }
  async autorizar() {
    if (this.trabajando() || this.motivo.trim().length < 10) return;
    this.trabajando.set(true);
    try {
      const d = await this.api.post<any>(`/rastreo/viajes/${this.viajeId}/checklist/autorizar`, { motivo: this.motivo.trim() });
      this.datos.update(x => ({ ...x, checklist: { ...x.checklist, ...d.checklist, firma: x.checklist.firma } }));
      this.motivo = '';
      this.avisos.ok('Salida autorizada. Se avisó al conductor.');
    } catch (e) { this.avisos.error(e); }
    finally { this.trabajando.set(false); }
  }
  limpiarFirma(b: string) { return String(b || '').replace(/^data:image\/\w+;base64,/, ''); }

  async abrir(viajeId: string) {
    this.viajeId = viajeId; this.datos.set(null); this.motivo = ''; this.abierto.set(true); this.cargando.set(true);
    try { this.datos.set(await this.api.get(`/rastreo/viajes/${viajeId}/checklist`)); }
    catch (e) { this.avisos.error(e); this.abierto.set(false); }
    finally { this.cargando.set(false); }
  }
  descargar() { this.api.descargar(`/rastreo/viajes/${this.viajeId}/checklist/pdf`, {}, 'checklist.pdf').catch(e => this.avisos.error(e)); }
}
