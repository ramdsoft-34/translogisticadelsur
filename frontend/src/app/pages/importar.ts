import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { ImportarExcel } from '../shared/importar-excel';

type Tipo = 'terceros' | 'vehiculos' | 'tarifas';

// Un solo lugar para todas las cargas desde Excel. Cada opción usa la misma importación
// que antes estaba en su página (simular, ver errores por fila y aplicar).
@Component({
  selector: 'app-importar',
  imports: [RouterLink, Icono, ImportarExcel],
  template: `
    <div class="pagina-cab">
      <div><h1>Importar datos</h1>
        <p>Cargue información en bloque desde Excel. Antes de guardar se muestra qué se va a crear o actualizar y los errores de cada fila.</p></div>
    </div>

    <div class="opciones">
      @if (puedeMaestros) {
        <button type="button" class="opcion" (click)="abierto.set('terceros')">
          <span class="ico"><app-icono nombre="personas" [tam]="20" /></span>
          <span class="txt"><strong>Conductores y terceros</strong><small>Conductores, titulares, propietarios, tenedores y empresas con sus sedes.</small></span>
          <span class="ir">Elegir archivo</span></button>
        <button type="button" class="opcion" (click)="abierto.set('vehiculos')">
          <span class="ico"><app-icono nombre="camion" [tam]="20" /></span>
          <span class="txt"><strong>Vehículos</strong><small>Placas, remolques, SOAT, tecnomecánica, propietario y tenedor.</small></span>
          <span class="ir">Elegir archivo</span></button>
      }
      @if (puedeTarifas) {
        <button type="button" class="opcion" (click)="abierto.set('tarifas')">
          <span class="ico"><app-icono nombre="edificio" [tam]="20" /></span>
          <span class="txt"><strong>Clientes y tarifas</strong><small>Clientes, destinos, tarifas, fletes y anticipos habituales.</small></span>
          <span class="ir">Elegir archivo</span></button>
      }
      @if (puedePlantilla) {
        <a class="opcion" routerLink="/configuracion" [queryParams]="{ tab: 'importar' }">
          <span class="ico"><app-icono nombre="lista" [tam]="20" /></span>
          <span class="txt"><strong>Plantilla completa de viajes</strong><small>El libro de Excel de la operación: viajes históricos, conductores y vehículos a la vez.</small></span>
          <span class="ir">Abrir</span></a>
      }
    </div>

    @if (abierto(); as t) {
      <app-importar-excel [tipo]="t" [titulo]="TITULOS[t]" [abierto]="true" (cerrar)="abierto.set(null)" (importado)="abierto.set(null)" />
    }`,
  styles: [`
    .opciones { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
    .opcion { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; gap: 4px 14px; align-items: start; text-align: left; white-space: normal;
      padding: 18px; min-height: 0; border-radius: var(--radio-l); background: var(--gris-0); border: 1px solid var(--gris-2); color: var(--gris-8); text-decoration: none;
      font-weight: 400; box-shadow: none; }
    .opcion:hover:not(:disabled) { border-color: var(--primario-borde); background: var(--gris-0); box-shadow: var(--sombra-2); }
    .ico { grid-row: span 2; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--primario-claro); color: var(--primario-texto); }
    .txt { display: flex; flex-direction: column; gap: 3px; } .txt strong { font-size: 15px; } .txt small { color: var(--gris-5); font-size: 13px; line-height: 1.45; }
    .ir { grid-column: 2; margin-top: 6px; font-size: 13px; font-weight: 700; color: var(--primario-texto); }
  `],
})
export class Importar {
  private auth = inject(Auth);
  readonly puedeMaestros = this.auth.tiene(P.MAESTROS_EDITAR);
  readonly puedeTarifas = this.auth.tiene(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);
  readonly puedePlantilla = this.auth.tiene(P.CONFIG_GESTIONAR);
  readonly abierto = signal<Tipo | null>(null);
  readonly TITULOS: Record<Tipo, string> = { terceros: 'conductores y terceros', vehiculos: 'vehículos', tarifas: 'clientes y tarifas' };
}
