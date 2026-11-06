import { Component, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { EnVivo } from '../core/en-vivo.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { FORMATOS } from '../shared/formato';
import { filtrar } from '../shared/filtro';

type Pestana = 'cargar' | 'base' | 'imprimir' | 'formato';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date()).slice(0, 7);
const leerImagen = (archivo: File) => new Promise<string>((ok, mal) => {
  if (!/^image\/(png|jpe?g)$/.test(archivo.type)) { mal(new Error('El logo debe ser PNG o JPG')); return; }
  if (archivo.size > 650_000) { mal(new Error('El logo es muy pesado (máximo 650 KB)')); return; }
  const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => mal(new Error('No se pudo leer la imagen')); r.readAsDataURL(archivo);
});

type Ajuste = { dx: number; dy: number; escala: number };
type Limites = { dx: readonly number[]; dy: readonly number[]; escala: readonly number[] };
const SIN_AJUSTE: Ajuste = { dx: 0, dy: 0, escala: 1 };
// Los mismos límites del servidor (LIMITES_LOGOS): el logo no sale del encabezado
const LIMITES_LOGOS: Record<'logo' | 'logoCliente', Limites> = {
  logo: { dx: [-10, 300], dy: [-10, 40], escala: [0.5, 2] },
  logoCliente: { dx: [-300, 10], dy: [-5, 55], escala: [0.5, 2] },
};

// Mover y escalar un logo de la remesa (queda debajo de líneas y textos). Cerrado hasta que se despliega.
@Component({
  selector: 'app-ajuste-logo-remesa',
  imports: [Icono],
  template: `
    <div class="ajuste" [class.abierto]="abierto()">
      <button type="button" class="desplegar" (click)="abierto.set(!abierto())" [attr.aria-expanded]="abierto()">
        <app-icono nombre="ajustes" [tam]="15" /><span class="tit">Ajustar posición y tamaño</span>
        <span class="resumen">{{ resumen() }}</span><app-icono class="flecha" nombre="chevron" [tam]="16" />
      </button>
      @if (abierto()) {
        <div class="panel" role="group" [attr.aria-label]="'Posición y tamaño del ' + nombre()">
          <div class="control"><span class="et">Horizontal</span>
            <button type="button" class="pequeno" (click)="mover('dx', -5)" [disabled]="deshabilitado()" aria-label="Mover a la izquierda">←</button>
            <input type="range" [min]="lim().dx[0]" [max]="lim().dx[1]" step="1" [value]="valor().dx" [disabled]="deshabilitado()" (input)="cambiar('dx', $any($event.target).value)" aria-label="Posición horizontal" />
            <button type="button" class="pequeno" (click)="mover('dx', 5)" [disabled]="deshabilitado()" aria-label="Mover a la derecha">→</button><span></span></div>
          <div class="control"><span class="et">Vertical</span>
            <button type="button" class="pequeno" (click)="mover('dy', -5)" [disabled]="deshabilitado()" aria-label="Subir">↑</button>
            <input type="range" [min]="lim().dy[0]" [max]="lim().dy[1]" step="1" [value]="valor().dy" [disabled]="deshabilitado()" (input)="cambiar('dy', $any($event.target).value)" aria-label="Posición vertical" />
            <button type="button" class="pequeno" (click)="mover('dy', 5)" [disabled]="deshabilitado()" aria-label="Bajar">↓</button><span></span></div>
          <div class="control"><span class="et">Tamaño</span>
            <button type="button" class="pequeno" (click)="mover('escala', -0.1)" [disabled]="deshabilitado()" aria-label="Más pequeño">−</button>
            <input type="range" [min]="lim().escala[0]" [max]="lim().escala[1]" step="0.05" [value]="valor().escala" [disabled]="deshabilitado()" (input)="cambiar('escala', $any($event.target).value)" aria-label="Tamaño" />
            <button type="button" class="pequeno" (click)="mover('escala', 0.1)" [disabled]="deshabilitado()" aria-label="Más grande">+</button>
            <span class="pct">{{ pct() }} %</span></div>
          <div class="pie">
            <small class="sutil">Mire la vista previa a la derecha. El logo queda debajo de líneas y textos y no sale del encabezado. Se guarda con «Guardar».</small>
            <button type="button" class="pequeno" (click)="valor.set(sinAjuste)" [disabled]="deshabilitado()">Restablecer</button>
          </div>
        </div>
      }
    </div>`,
  styles: [`
    .ajuste { margin-top: 10px; border: 1px solid var(--gris-2); border-radius: var(--radio-l, 12px); background: var(--gris-0); }
    .desplegar { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; border: 0; background: transparent; box-shadow: none; font-size: 13.5px; font-weight: 600; cursor: pointer; text-align: left; }
    .desplegar .tit { flex: 1; } .desplegar .resumen { font-size: 12px; font-weight: 500; color: var(--gris-5); }
    .desplegar .flecha { transition: transform .15s ease; } .abierto .desplegar .flecha { transform: rotate(180deg); }
    .panel { display: flex; flex-direction: column; gap: 8px; padding: 4px 12px 12px; border-top: 1px solid var(--gris-15); padding-top: 12px; }
    .control { display: grid; grid-template-columns: 70px 28px minmax(0, 240px) 28px 42px; gap: 6px; align-items: center; }
    .control .et { font-size: 13px; font-weight: 600; color: var(--gris-6); }
    .control input[type=range] { min-height: 0; height: 18px; padding: 0; border: 0; accent-color: var(--primario-borde); box-shadow: none; }
    .control .pequeno { min-height: 28px; height: 28px; padding: 0; font-size: 13px; }
    .pct { font-size: 12px; color: var(--gris-5); text-align: right; }
    .pie { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
    .pie small { max-width: 300px; line-height: 1.35; }
  `],
})
export class AjusteLogoRemesa {
  readonly lim = input.required<Limites>();
  readonly valor = model<Ajuste>(SIN_AJUSTE);
  readonly deshabilitado = input(false);
  readonly nombre = input('logo');
  readonly sinAjuste = SIN_AJUSTE;
  readonly abierto = signal(false);
  resumen() { const v = this.valor() || SIN_AJUSTE; return v.dx || v.dy || v.escala !== 1 ? `Ajustado · ${this.pct()} %` : 'Sin ajustar'; }
  pct() { return Math.round((this.valor()?.escala ?? 1) * 100); }
  cambiar(k: keyof Ajuste, v: string | number) {
    const [a, b] = this.lim()[k]; const n = Math.min(b, Math.max(a, Number(v)));
    if (!Number.isFinite(n)) return;
    this.valor.set({ ...(this.valor() || SIN_AJUSTE), [k]: k === 'escala' ? Math.round(n * 100) / 100 : Math.round(n) });
  }
  mover(k: keyof Ajuste, paso: number) { this.cambiar(k, (this.valor()?.[k] ?? SIN_AJUSTE[k]) + paso); }
}

// Fase 12: Remesas de los clientes (como el formulario REMESAS DULCES de la plantilla).
// Cargar base (Excel del cliente con VPL) → Base de remesas (consecutivo de la cooperativa, cédulas, imprimir una o varias)
// → Imprimir (1 o 2 por hoja carta con línea para cortar, PDF o un PDF por remesa) → Configuración del formato por empresa.
@Component({
  selector: 'app-remesas',
  imports: [FormsModule, RouterLink, DecimalPipe, Icono, Modal, Confirmar, VisorPdf, AjusteLogoRemesa, ...FORMATOS],
  template: `
    <div class="pagina-cab"><div><h1>Remesas</h1>
      <p class="sutil">Base de viajes del cliente (VPL), consecutivo de remesas de la empresa e impresión con el formato de la remesa.</p></div></div>
    <app-visor-pdf />

    <nav class="pestanas" role="tablist" aria-label="Remesas">
      @if (puedeGestionar) { <button type="button" role="tab" [class.activa]="pestana() === 'cargar'" [attr.aria-selected]="pestana() === 'cargar'" (click)="pestana.set('cargar')">1. Cargar base</button> }
      <button type="button" role="tab" [class.activa]="pestana() === 'base'" [attr.aria-selected]="pestana() === 'base'" (click)="pestana.set('base')">2. Base de remesas</button>
      @if (puedeGestionar) { <button type="button" role="tab" [class.activa]="pestana() === 'imprimir'" [attr.aria-selected]="pestana() === 'imprimir'" (click)="pestana.set('imprimir')">3. Imprimir</button>
        <button type="button" role="tab" [class.activa]="pestana() === 'formato'" [attr.aria-selected]="pestana() === 'formato'" (click)="abrirFormato()"><app-icono nombre="ajustes" [tam]="15" />Configuración de la remesa</button> }
    </nav>

    <!-- ═════ 1. Cargar base ═════ -->
    @if (pestana() === 'cargar') {
      <section class="tarjeta">
        <div class="fila">
          <div class="campo"><label for="rm-cli">Empresa (cliente)</label>
            <select id="rm-cli" [(ngModel)]="cargaCliente" (change)="previa.set(null); recordarCliente()"><option value="">Seleccione…</option>
              @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
          <div class="campo crece"><span class="etiqueta">Archivo Excel con los viajes</span>
            <label class="boton" [class.deshabilitado]="!cargaCliente"><app-icono nombre="subir" />{{ archivo()?.name || 'Elegir Excel…' }}
              <input type="file" accept=".xlsx,.xlsm" hidden [disabled]="!cargaCliente" (change)="elegirArchivo($event)" /></label></div>
        </div>
        <p class="sutil nota">Del Excel salen el VPL, la fecha, la ruta o zona, el peso, el manifiesto, el conductor, la placa y el flete. La <b>cédula y la dirección del conductor</b>
          salen del registro de conductores (o de una remesa anterior). El <b>N° de remesa</b> es el consecutivo de la empresa: si viene vacío se asigna.</p>
      </section>
      @if (ocupado()) { <p class="sutil">Leyendo el archivo…</p> }
      @if (previa(); as p) {
        <section class="tarjeta">
          <div class="fila centro">
            <strong>{{ p.resumen.viajes }} viajes en el archivo</strong>
            <span class="chip ok sin-punto">{{ p.resumen.nuevos }} nuevos</span>
            @if (p.resumen.existen) { <span class="chip sin-punto">{{ p.resumen.existen }} ya están en la base</span> }
            @if (p.resumen.cambian) { <span class="chip alerta sin-punto">{{ p.resumen.cambian }} cambiaron</span> }
            @if (p.resumen.conflictos) { <span class="chip error sin-punto">{{ p.resumen.conflictos }} con número de otro viaje</span> }
            @if (p.resumen.coinciden) { <span class="chip alerta sin-punto">{{ p.resumen.coinciden }} coinciden con la bitácora</span> }
            <span class="crece"></span><span class="sutil">Total del archivo: <b>{{ p.resumen.total | pesos }}</b></span>
          </div>
          @for (a of p.avisos; track $index) {
            <div class="aviso-rm" [class.ok]="a.nivel === 'ok'" [class.info]="a.nivel === 'info'"><span class="ic">{{ a.nivel === 'aviso' ? '!' : a.nivel === 'ok' ? '✓' : 'i' }}</span><span>{{ a.texto }}</span></div>
          }
          <div class="tabla-caja" style="margin-top:10px"><table class="tabla-movil">
            <thead><tr><th><input type="checkbox" aria-label="Marcar todos" [checked]="todosCarga()" (change)="marcarCarga(todosCarga() ? 'ninguno' : 'todos')" /></th>
              <th>VPL</th><th>Ruta / zona</th><th>Conductor</th><th>Remesa N°</th><th class="num">Flete</th><th>Estado</th></tr></thead>
            <tbody>
              @for (x of p.filas; track x.vpl + $index) {
                @if (x.tabla && ($index === 0 || p.filas[$index - 1].tabla !== x.tabla)) { <tr class="grupo-rm"><td colspan="7">{{ x.tabla }}</td></tr> }
                <tr [class.apagada]="x.estado === 'conflicto'">
                  <td data-etiqueta="Pasar"><input type="checkbox" [checked]="selCarga().has(x.vpl)" [disabled]="x.estado === 'conflicto'" (change)="alternarCarga(x.vpl)" [attr.aria-label]="'Pasar el VPL ' + x.vpl" /></td>
                  <td data-etiqueta="VPL"><div class="celda-doble"><strong>{{ x.vpl }}</strong><small>{{ x.fecha | dia }}</small></div></td>
                  <td data-etiqueta="Ruta / zona"><div class="celda-doble"><span>{{ x.zona }}</span><small>{{ x.peso | number: '1.0-1' : 'es-CO' }} kg@if (x.manifiesto) { · {{ x.manifiesto }} }</small></div></td>
                  <td data-etiqueta="Conductor"><div class="celda-doble"><span>{{ x.conductor }}</span>
                    <small>@if (x.cedula) { C.C. {{ x.cedula }} } @else { <span class="falta">sin cédula</span> } · <span class="placa">{{ x.placa }}</span></small></div></td>
                  <td data-etiqueta="Remesa N°" class="rem">{{ x.remesa || x.remesaActual || 'se asigna' }}</td>
                  <td data-etiqueta="Flete" class="num">{{ x.costo | pesos }}</td>
                  <td data-etiqueta="Estado"><div class="celda-doble">
                    <span>@if (x.estado === 'nuevo') { <span class="chip ok sin-punto">Nuevo</span> }
                      @else if (x.estado === 'conflicto') { <span class="chip error sin-punto">No se pasa</span> }
                      @else if (x.estado === 'cambio') { <span class="chip alerta sin-punto">Cambió</span> }
                      @else { <span class="chip sin-punto">Ya existe</span> }</span>
                    @if (x.estado === 'cambio') { <small>{{ x.cambios.join(', ') }}</small> }
                    @if (x.conflicto) { <small class="texto-error">{{ x.conflicto }}</small> }
                    @if (x.impreso && x.estado !== 'nuevo' && x.estado !== 'conflicto') { <small>Ya impresa: no se reemplaza</small> }
                    @if (x.legado) { <small>De la base anterior</small> }
                    @if (x.bitacora.length) { <small class="aviso-texto">En la bitácora: viaje N° {{ numeros(x.bitacora) }}</small> }
                  </div></td>
                </tr>
              }
            </tbody></table></div>
          <div class="fila centro" style="margin-top:12px">
            <label class="casilla"><input type="radio" name="rm-modo" value="omitir" [(ngModel)]="modo" />Omitir los que ya existen</label>
            <label class="casilla"><input type="radio" name="rm-modo" value="reemplazar" [(ngModel)]="modo" />Reemplazar los que ya existen</label>
            <span class="crece"></span>
            <button type="button" (click)="marcarCarga('todos')">Marcar todos</button>
            <button type="button" (click)="marcarCarga('nuevos')">Solo nuevos</button>
            <button type="button" (click)="marcarCarga('ninguno')">Quitar todos</button>
            <button type="button" class="primario" (click)="pasar()" [disabled]="!selCarga().size || ocupado()">Pasar a la base ({{ selCarga().size }})</button>
          </div>
          <p class="sutil nota">Cada carga queda guardada: no hace falta borrar la base anterior. Próxima remesa sin número: <b>{{ p.siguiente }}</b>.</p>
        </section>
      }
    }

    <!-- ═════ 2. Base de remesas ═════ -->
    @if (pestana() === 'base') {
      <section class="barra" aria-label="Filtros">
        <div class="campo"><label for="rb-cli">Empresa</label><select id="rb-cli" [(ngModel)]="f.cliente" (change)="cargar()"><option value="">(Todas)</option>
          @for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
        <div class="campo"><label for="rb-mes">Mes</label><input id="rb-mes" type="month" [(ngModel)]="f.mes" (change)="cargar()" /></div>
        <div class="campo"><label for="rb-est">Estado</label><select id="rb-est" [(ngModel)]="f.estado" (change)="cargar()">
          <option value="">Todas</option><option value="pendientes">Pendientes</option><option value="impresas">Impresas</option></select></div>
        <div class="campo crece"><label for="rb-q">Buscar</label><input id="rb-q" type="search" placeholder="Remesa, VPL, conductor, placa o ruta" [ngModel]="q()" (ngModelChange)="q.set($event)" /></div>
      </section>
      <section class="tarjeta">
        <div class="fila centro acciones-sel">
          <button type="button" (click)="seleccionar('todas')">Seleccionar todo</button>
          <button type="button" (click)="seleccionar('pendientes')">Solo pendientes</button>
          <button type="button" (click)="seleccionar('ninguna')">Quitar selección</button>
          <span class="sutil">{{ sel().size }} marcada(s) · {{ visibles().length }} en la lista</span>
          <span class="crece"></span>
          @if (puedeGestionar) {
            <button type="button" (click)="verPdf(marcadas())" [disabled]="!sel().size">PDF de las marcadas</button>
            <button type="button" class="primario" (click)="imprimir(marcadas())" [disabled]="!sel().size || ocupado()"><app-icono nombre="imprimir" [tam]="16" />Imprimir marcadas</button>
          }
        </div>
        <div class="tabla-caja"><table class="tabla-movil">
          <thead><tr><th><input type="checkbox" aria-label="Seleccionar todo" [checked]="todasSel()" (change)="seleccionar(todasSel() ? 'ninguna' : 'todas')" /></th>
            <th>Remesa N°</th><th>Ruta / zona</th><th>Conductor</th><th class="num">Flete</th><th>Estado</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
          <tbody>
            @for (x of visibles(); track x._id) {
              <tr [class.marcada]="sel().has(x._id)">
                <td data-etiqueta="Elegir"><input type="checkbox" [checked]="sel().has(x._id)" (change)="alternar(x._id)" [attr.aria-label]="'Remesa ' + x.remesa" /></td>
                <td data-etiqueta="Remesa N°"><div class="celda-doble"><strong class="rem">{{ x.remesa || '—' }}</strong><small>VPL {{ x.vpl }} · {{ x.fecha | dia }}</small></div></td>
                <td data-etiqueta="Ruta / zona"><div class="celda-doble"><span>{{ x.zona }}</span>
                  <small>{{ x.peso | number: '1.0-1' : 'es-CO' }} kg@if (x.viaje) { · <span class="aviso-texto">en la bitácora N° {{ x.viaje.numero }}</span> }</small></div></td>
                <td data-etiqueta="Conductor"><div class="celda-doble"><span>{{ x.conductor }}</span>
                  <small>@if (x.cedula) { C.C. {{ x.cedula }} } @else { <span class="chip alerta sin-punto">falta C.C.</span> } · <span class="placa">{{ x.placa }}</span></small></div></td>
                <td data-etiqueta="Flete" class="num">{{ x.costo | pesos }}</td>
                <td data-etiqueta="Estado">@if (x.impreso) { <div class="celda-doble"><span><span class="chip ok sin-punto">Impresa</span></span>
                    <small>{{ x.impreso | dia }}@if (x.impresiones > 1) { · {{ x.impresiones }} veces }@if (x.impresoPor) { · {{ x.impresoPor }} }</small></div> }
                  @else { <span class="chip info sin-punto">Pendiente</span> }</td>
                <td class="celda-acciones">
                  @if (puedeGestionar) { <div class="acciones rejilla">
                    <button type="button" class="pequeno" (click)="editar(x)" [attr.aria-label]="'Editar la remesa ' + x.remesa" title="Editar"><app-icono nombre="editar" [tam]="15" /></button>
                    <button type="button" class="pequeno" (click)="verPdf([x])" [attr.aria-label]="'Ver la remesa ' + x.remesa" title="Ver"><app-icono nombre="ojo" [tam]="15" /></button>
                    <button type="button" class="pequeno" (click)="descargarUna(x)" [attr.aria-label]="'Descargar el PDF de la remesa ' + x.remesa" title="Descargar PDF"><app-icono nombre="descargar" [tam]="15" /></button>
                    <button type="button" class="pequeno primario" (click)="imprimirUna(x)" [attr.aria-label]="'Imprimir la remesa ' + x.remesa" [title]="'Imprimir la remesa ' + x.remesa"><app-icono nombre="imprimir" [tam]="15" /></button>
                  </div> }
                </td>
              </tr>
            } @empty { <tr><td colspan="7" class="vacio">No hay remesas con estos filtros. Cárguelas en «Cargar base».</td></tr> }
          </tbody></table></div>
        <p class="sutil nota">Hoja: <b>{{ hojaTexto() }}</b> (se cambia en «Imprimir»). Con 2 por hoja, el botón de imprimir de una fila imprime esa remesa arriba y la siguiente pendiente abajo.</p>
      </section>
    }

    <!-- ═════ 3. Imprimir ═════ -->
    @if (pestana() === 'imprimir') {
      <div class="dos-col">
        <section class="tarjeta">
          <h3 class="sub">Qué imprimir</h3>
          <label class="casilla"><input type="radio" name="rp-que" value="marcadas" [(ngModel)]="imp.que" />Las marcadas en la base ({{ sel().size }})</label>
          <label class="casilla"><input type="radio" name="rp-que" value="rango" [(ngModel)]="imp.que" />Rango de remesas
            <input class="corto" inputmode="numeric" [(ngModel)]="imp.desde" placeholder="desde" aria-label="Desde la remesa" /> a <input class="corto" inputmode="numeric" [(ngModel)]="imp.hasta" placeholder="hasta" aria-label="Hasta la remesa" /></label>
          <label class="casilla"><input type="radio" name="rp-que" value="pendientes" [(ngModel)]="imp.que" />Todas las pendientes de la lista ({{ pendientesLista().length }})</label>
          <label class="casilla"><input type="radio" name="rp-que" value="una" [(ngModel)]="imp.que" />Una sola remesa <input class="corto" inputmode="numeric" [(ngModel)]="imp.una" placeholder="N°" aria-label="Número de la remesa" /></label>
          <h3 class="sub">Cómo va en la hoja carta</h3>
          <div class="hojas">
            <button type="button" [class.activa]="porHoja() === 2" (click)="porHoja.set(2)"><span class="mini"><i></i><s></s><i class="b"></i></span>2 remesas por hoja<small>distintas, con línea para cortar</small></button>
            <button type="button" [class.activa]="porHoja() === 1" (click)="porHoja.set(1)"><span class="mini"><i></i><s></s></span>1 remesa por hoja<small>en la mitad de arriba</small></button>
          </div>
          <label class="casilla" style="margin-top:10px"><input type="checkbox" [ngModel]="linea()" (ngModelChange)="linea.set($event)" />Imprimir la línea divisoria (cortar aquí)</label>
          <button type="button" class="primario grande" (click)="imprimir(aImprimir())" [disabled]="!aImprimir().length || ocupado()"><app-icono nombre="imprimir" [tam]="16" />Imprimir {{ aImprimir().length }} remesa(s) · {{ hojas(aImprimir().length) }} hoja(s)</button>
          <div class="fila" style="margin-top:8px">
            <button type="button" (click)="verPdf(aImprimir())" [disabled]="!aImprimir().length">Ver PDF</button>
            <button type="button" class="oscuro" (click)="zip(aImprimir())" [disabled]="!aImprimir().length || ocupado()">Un PDF por remesa (.zip)</button>
          </div>
          <p class="sutil nota">Se abre la ventana de impresión para escoger la impresora y las copias. Al imprimir o descargar, las remesas quedan marcadas como <b>Impresas</b>.
            Para guardar la hoja como predeterminada, cámbiela en «Configuración de la remesa».</p>
        </section>
        <section class="tarjeta">
          <h3 class="sub">Remesas que se van a imprimir</h3>
          @if (aImprimir().length) {
            <ol class="lista-imp">@for (x of aImprimir().slice(0, 40); track x._id) { <li><b>{{ x.remesa }}</b> · VPL {{ x.vpl }} · {{ x.conductor }} · {{ x.placa }} @if (x.impreso) { <span class="chip ok sin-punto">ya impresa</span> }</li> }</ol>
            @if (aImprimir().length > 40) { <p class="sutil">… y {{ aImprimir().length - 40 }} más</p> }
          } @else { <p class="sutil">Elija qué imprimir. Las remesas salen de la lista de «Base de remesas» (con sus filtros).</p> }
        </section>
      </div>
    }

    <!-- ═════ ⚙ Configuración ═════ -->
    @if (pestana() === 'formato' && fmt(); as k) {
      <div class="dos-col cfg">
        <div>
          <section class="tarjeta">
            <h3 class="sub">Encabezado · su empresa</h3>
            <div class="fila centro"><span class="logo-cfg">@if (k.logo) { <img [src]="k.logo" alt="Logo de la empresa" /> } @else { Sin logo }</span>
              <span class="sutil nota-logo">Es el logo de <b>Configuración → Logo de la empresa</b>.
                @if (esAdmin) { <a routerLink="/configuracion" [queryParams]="{ tab: 'logo-empresa' }">Cambiarlo</a> }</span></div>
            @if (k.logo) { <app-ajuste-logo-remesa nombre="logo de la empresa" [lim]="LIMITES_LOGOS.logo" [valor]="k.ajusteLogo || SIN_AJUSTE" (valorChange)="k.ajusteLogo = $event" [deshabilitado]="!esAdmin" /> }
            <div class="formulario">
              <div class="campo"><label for="kf-n1">Nombre (línea 1)</label><input id="kf-n1" [(ngModel)]="k.nombre1" maxlength="80" [disabled]="!esAdmin" /></div>
              <div class="campo"><label for="kf-n2">Nombre (línea 2)</label><input id="kf-n2" [(ngModel)]="k.nombre2" maxlength="80" [disabled]="!esAdmin" /></div>
              <div class="campo"><label for="kf-nit">NIT</label><input id="kf-nit" [(ngModel)]="k.nit" maxlength="40" [disabled]="!esAdmin" /></div>
              <div class="campo"><label for="kf-lema">Lema</label><input id="kf-lema" [(ngModel)]="k.lema" maxlength="120" [disabled]="!esAdmin" /></div>
              <div class="campo ancho"><label for="kf-res">Resolución</label><textarea id="kf-res" rows="2" [(ngModel)]="k.resolucion" maxlength="300" [disabled]="!esAdmin"></textarea></div>
              <div class="campo"><label for="kf-sig">Próxima remesa N°</label><input id="kf-sig" type="number" min="1" [(ngModel)]="k.siguiente" [disabled]="!esAdmin" />
                <small>Consecutivo único de la empresa. Sigue solo después de la remesa más alta cargada.</small></div>
              <div class="campo"><label for="kf-hoja">Hoja por defecto</label><select id="kf-hoja" [(ngModel)]="k.porHoja" [disabled]="!esAdmin"><option [ngValue]="2">2 remesas por hoja</option><option [ngValue]="1">1 remesa por hoja</option></select>
                <label class="casilla"><input type="checkbox" [(ngModel)]="k.linea" [disabled]="!esAdmin" />Línea para cortar</label></div>
            </div>
            @if (esAdmin) { <div class="pie-acc"><button type="button" class="primario" (click)="guardarEmpresa()" [disabled]="ocupado()">Guardar encabezado</button></div> }
            @else { <p class="sutil nota">Solo el administrador cambia el encabezado y el consecutivo.</p> }
          </section>
          <section class="tarjeta">
            <div class="fila centro"><h3 class="sub crece" style="margin:0">Datos fijos del cliente</h3>
              <select [(ngModel)]="fmtCliente" (change)="abrirFormato()" aria-label="Empresa (cliente)">@for (c of clientes(); track c._id) { <option [value]="c._id">{{ c.nombre }}</option> }</select></div>
            <div class="fila centro" style="margin-top:8px"><span class="logo-cfg">@if (k.logoCliente) { <img [src]="k.logoCliente" alt="Logo del cliente" /> } @else { Sin logo }</span>
              <label class="boton">Cambiar logo del cliente<input type="file" accept="image/png,image/jpeg" hidden (change)="logo($event, 'logoCliente')" /></label>
              @if (k.logoCliente) { <button type="button" class="texto" (click)="k.logoCliente = ''; logoQuitado = true">Quitar</button> }</div>
            @if (k.logoCliente) { <app-ajuste-logo-remesa nombre="logo del cliente" [lim]="LIMITES_LOGOS.logoCliente" [valor]="k.ajusteLogoCliente || SIN_AJUSTE" (valorChange)="k.ajusteLogoCliente = $event" /> }
            <div class="formulario tres">
              <div class="campo"><label for="kc-rem">Remitente</label><input id="kc-rem" [(ngModel)]="k.remitente" maxlength="80" /></div>
              <div class="campo"><label for="kc-ciu">Ciudad origen</label><input id="kc-ciu" [(ngModel)]="k.ciudadOrigen" maxlength="60" /></div>
              <div class="campo"><label for="kc-des">Destinatario</label><input id="kc-des" [(ngModel)]="k.destinatario" maxlength="80" /></div>
              <div class="campo"><label for="kc-dir">Dirección</label><input id="kc-dir" [(ngModel)]="k.direccion" maxlength="80" /></div>
              <div class="campo"><label for="kc-sec">Sector / barrio</label><input id="kc-sec" [(ngModel)]="k.sector" maxlength="60" /></div>
              <div class="campo"><label for="kc-can">Cantidad</label><input id="kc-can" [(ngModel)]="k.cantidad" maxlength="30" /></div>
              <div class="campo"><label for="kc-cla">Clase</label><input id="kc-cla" [(ngModel)]="k.clase" maxlength="30" /></div>
              <div class="campo"><label for="kc-con">Contenido</label><input id="kc-con" [(ngModel)]="k.contenido" maxlength="60" /></div>
            </div>
            <div class="pie-acc"><button type="button" class="primario" (click)="guardarCliente()" [disabled]="ocupado() || !fmtCliente">Guardar datos del cliente</button></div>
          </section>
        </div>
        <section class="tarjeta previa-cfg"><h3 class="sub">Vista previa</h3>
          <div class="rm">
            <div class="cab"><div class="l1">@if (k.logo) { <img [src]="k.logo" alt="" [style.transform]="transformar(k.ajusteLogo)" /> }</div>
              <div class="cen"><b>{{ k.nombre1 }}</b><b>{{ k.nombre2 }}</b><i class="nit">{{ k.nit }}</i><u class="lema">{{ k.lema }}</u><small>{{ k.resolucion }}</small></div>
              <div class="der"><div class="l2">@if (k.logoCliente) { <img [src]="k.logoCliente" alt="" [style.transform]="transformar(k.ajusteLogoCliente)" /> }</div>
                <div class="caja"><div class="t">REMESA</div><div class="v"><span>VPL No:</span> 12031</div><div class="no">No: {{ k.siguiente }}</div></div></div></div>
            <div class="b"><div class="g1"><b>FECHA DESPACHO</b><i class="u">{{ ciudad(k.ciudadOrigen) }} {{ hoyLargo() }}</i><b class="der">REMITENTE.</b><i class="u">{{ k.remitente }}</i><i class="c">{{ k.direccion }}</i></div>
              <div class="g1 b2"><b>DESTINATARIO.</b><i class="u izq">{{ k.destinatario }}</i><b class="der">CIUDAD. ORIGEN</b><i class="u">{{ k.ciudadOrigen }}</i><b>DIRECCIÓN.</b><i class="u">{{ k.sector }}</i></div></div>
            <table><tr><th colspan="2">BULTOS</th><th>S/G FACTURA VR. M/CIA.$</th><th colspan="2">DETALLE</th><th rowspan="2">FLETE</th></tr>
              <tr><th>CANTIDAD</th><th>CLASE</th><th>CONTENIDO</th><th>PESO</th><th>MANIFIESTO</th></tr>
              <tr><td>{{ k.cantidad }}</td><td>{{ k.clase }}</td><td>{{ k.contenido }}</td><td class="d">2584,0</td><td class="c">URBANO</td><td class="d">$ 229.000,0</td></tr>
              <tr class="v"><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>
            <div class="b g2"><b>RUTA/ZONA:</b><span>PASTO</span></div>
            <div class="b g3"><b>CONDUCTOR</b><b>C.C:</b><b>DIRECCION:</b><b>PLACA</b><i>(de la base)</i><i class="d">(registro)</i><i>(registro)</i><i>(de la base)</i></div>
            <div class="b g4"><b>La Empresa</b><b>Recibí Destinatario C.C. No.</b></div>
          </div>
          <p class="sutil nota">Ejemplo aproximado. Los datos del viaje salen de la base; los de arriba, de esta configuración.</p>
          <button type="button" (click)="verMuestra()"><app-icono nombre="ojo" [tam]="15" />Ver cómo queda (PDF)</button>
        </section>
      </div>
    }

    <!-- Corregir una remesa -->
    <app-modal [titulo]="'Remesa ' + (ed()?.remesa || '') + ' · VPL ' + (ed()?.vpl || '')" [abierto]="!!ed()" (cerrar)="ed.set(null)" [ancho]="true">
      @if (ed(); as e) {
        <div class="formulario tres">
          <div class="campo"><label for="re-rem">Remesa N°</label><input id="re-rem" inputmode="numeric" [(ngModel)]="e.remesa" maxlength="12" /></div>
          <div class="campo"><label for="re-fe">Fecha despacho</label><input id="re-fe" type="date" [(ngModel)]="e.fecha" /></div>
          <div class="campo"><label for="re-zo">Ruta / zona</label><input id="re-zo" [(ngModel)]="e.zona" maxlength="120" /></div>
          <div class="campo"><label for="re-pe">Peso (kg)</label><input id="re-pe" type="number" min="0" [(ngModel)]="e.peso" /></div>
          <div class="campo"><label for="re-ma">Manifiesto</label><input id="re-ma" [(ngModel)]="e.manifiesto" maxlength="40" /></div>
          <div class="campo"><label for="re-fl">Flete ($)</label><input id="re-fl" type="number" min="0" [(ngModel)]="e.costo" /></div>
          <div class="campo"><label for="re-co">Conductor</label><input id="re-co" [(ngModel)]="e.conductor" maxlength="80" /></div>
          <div class="campo"><label for="re-cc">C.C.</label><input id="re-cc" inputmode="numeric" [(ngModel)]="e.cedula" maxlength="15" />
            <small>Queda guardada para las próximas remesas de este conductor.</small></div>
          <div class="campo"><label for="re-di">Dirección del conductor</label><input id="re-di" [(ngModel)]="e.direccion" maxlength="80" /></div>
          <div class="campo"><label for="re-pl">Placa</label><input id="re-pl" [(ngModel)]="e.placa" maxlength="8" /></div>
        </div>
      }
      <ng-container pie>
        @if (ed() && !ed().impreso) { <button type="button" class="texto peligro" confirmar="Clic otra vez para eliminar" (confirmado)="eliminar()">Eliminar</button> }
        <span class="crece"></span>
        <button type="button" (click)="ed.set(null)">Cancelar</button>
        <button type="button" class="primario" (click)="guardarEdicion()" [disabled]="ocupado()">Guardar</button>
      </ng-container>
    </app-modal>`,
  styles: [`
    .tarjeta { background: var(--gris-0, #fff); border: 1px solid var(--gris-2); border-radius: var(--radio-l, 14px); padding: 14px 16px; margin-bottom: 14px; }
    .fila { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; } .fila.centro { align-items: center; } .crece { flex: 1; }
    .campo { display: flex; flex-direction: column; gap: 5px; } .nota { margin: 10px 0 0; font-size: 12.5px; }
    .deshabilitado { opacity: .5; pointer-events: none; }
    .aviso-rm { display: flex; gap: 10px; align-items: flex-start; padding: 8px 12px; border-radius: 10px; margin-top: 8px; background: #fff4e0; font-size: 13px; }
    .aviso-rm.ok { background: #e8f6ee; } .aviso-rm.info { background: #eef4ff; }
    .aviso-rm .ic { width: 20px; height: 20px; flex: none; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 12px; background: #c77700; }
    .aviso-rm.ok .ic { background: #1e8e4f; } .aviso-rm.info .ic { background: #2457c5; }
    .rem { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
    tr.apagada td { opacity: .7; } .falta { color: var(--ambar); font-weight: 600; }
    .texto-error { color: var(--rojo); } .aviso-texto { color: var(--ambar); font-weight: 600; }
    @media (min-width: 701px) { .tabla-caja th, .tabla-caja td { padding-left: 10px; padding-right: 10px; } }
    .acciones.rejilla { display: grid; grid-template-columns: repeat(2, auto); gap: 4px; justify-content: end; }
    tr.grupo-rm td { background: #0d1117; color: #fff; font-weight: 700; font-size: 12px; }
    tr.marcada td { background: var(--primario-suave, #fff8e1); }
    .acciones-sel { margin-bottom: 8px; } .acciones-fila { display: flex; gap: 4px; justify-content: flex-end; flex-wrap: nowrap; }
    button.oscuro { background: #0d1117; color: #fff; border-color: #0d1117; }
    .dos-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
    .dos-col.cfg { grid-template-columns: minmax(380px, 1fr) minmax(0, 560px); }
    .casilla { display: flex; align-items: center; gap: 8px; padding: 5px 0; flex-wrap: wrap; } input.corto { width: 90px; }
    .hojas { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .hojas button { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px; border: 2px solid var(--gris-2); border-radius: 12px; background: #fff; font-weight: 700; }
    .hojas button.activa { border-color: #0d1117; background: var(--primario-suave, #fff8e1); } .hojas small { font-weight: 500; color: var(--gris-5); }
    .mini { width: 54px; height: 70px; border: 1px solid #98a2b3; background: #fff; position: relative; display: block; }
    .mini i { position: absolute; left: 5px; right: 5px; top: 4px; height: 26px; background: #bde3f7; border: 1px solid #6b9fc4; } .mini i.b { top: 39px; }
    .mini s { position: absolute; left: 0; right: 0; top: 34px; border-top: 1px dashed #333; }
    button.grande { width: 100%; margin-top: 14px; padding: 12px; font-size: 15px; }
    .lista-imp { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8; }
    .formulario { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; margin-top: 10px; } .formulario.tres { grid-template-columns: repeat(3, 1fr); }
    .formulario .ancho { grid-column: 1 / -1; } .pie-acc { display: flex; justify-content: flex-end; margin-top: 12px; }
    .logo-cfg { width: 150px; height: 56px; border: 1px dashed var(--gris-3, #d0d5dd); border-radius: 8px; display: grid; place-items: center; font-size: 12px; color: var(--gris-5); background: #fff; }
    .logo-cfg img { max-width: 140px; max-height: 50px; }
    /* Vista previa del formato (a escala) */
    .rm { font-family: Arial, sans-serif; font-size: 9px; color: #000; background: #fff; border: 1px solid var(--gris-2); padding: 8px; }
    .rm .cab { display: grid; grid-template-columns: 150px 1fr 120px; gap: 6px; align-items: center; }
    .rm .cab { position: relative; overflow: hidden; } .rm .cen, .rm .caja { position: relative; z-index: 1; } .rm .l1, .rm .l2 { position: relative; z-index: 0; }
    .rm .l1 img, .rm .l2 img { transform-origin: center; }
    .rm .l1 img { max-width: 145px; max-height: 58px; }
    .nota-logo { font-size: 12.5px; max-width: 260px; line-height: 1.4; }
    .previa-cfg { position: sticky; top: 12px; align-self: start; } .rm .l2 { height: 34px; display: grid; place-items: center; } .rm .l2 img { max-height: 32px; max-width: 115px; }
    .rm .cen { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1px; } .rm .cen b { color: #0b1a3a; font-size: 10.5px; }
    .rm .nit { font-weight: 700; } .rm .lema { font-family: 'Times New Roman', serif; font-weight: 700; font-style: italic; font-size: 10px; } .rm .cen small { font-size: 7px; font-style: italic; }
    .rm .caja { border: 1px solid #333; } .rm .caja .t { background: #bde3f7; text-align: center; font-weight: 700; font-style: italic; border-bottom: 1px solid #333; }
    .rm .caja .v { padding: 2px 5px; font-weight: 700; font-style: italic; border-bottom: 1px solid #333; } .rm .caja .v span, .rm .caja .no { color: #c00000; }
    .rm .caja .no { padding: 3px 5px; font-size: 14px; font-weight: 800; font-style: italic; }
    .rm .b { border: 1px solid #333; margin-top: 6px; padding: 4px 6px; display: grid; gap: 4px 6px; align-items: end; }
    .rm .u { border-bottom: 1px solid #777; text-align: center; } .rm .u.izq { text-align: left; }
    .rm .g1 { display: grid; gap: 6px; align-items: end; grid-template-columns: 82px 1.5fr 62px 1.1fr 1.1fr; } .rm .g1.b2 { grid-template-columns: 82px 1.4fr 78px .9fr 56px 1fr; margin-top: 4px; } .rm .der { text-align: right; } .rm .g2 { grid-template-columns: 80px 1fr; } .rm .g3 { grid-template-columns: 2fr 1fr 1fr 1fr; } .rm .g4 { grid-template-columns: 1fr 1fr; font-style: italic; }
    .rm table { width: 100%; border-collapse: collapse; margin-top: 6px; } .rm th { background: #bde3f7; border: 1px solid #888; font-size: 8.5px; padding: 2px; text-align: center; color: #000; text-transform: none; letter-spacing: 0; }
    .rm td { border: 1px solid #bbb; padding: 2px 4px; font-style: italic; height: 13px; font-size: 9px; } .rm tr.v td { background: #eef7fd; } .rm .d { text-align: right; } .rm .c { text-align: center; }
    @media (max-width: 1100px) { .previa-cfg { position: static; } .dos-col, .dos-col.cfg { grid-template-columns: 1fr; } .formulario.tres { grid-template-columns: 1fr 1fr; } }
  `],
})
export class Remesas {
  private api = inject(Api); private avisos = inject(Avisos); private auth = inject(Auth);
  readonly visor = viewChild.required(VisorPdf);
  readonly puedeGestionar = this.auth.tiene(P.VIAJES_REGISTRAR);
  readonly esAdmin = this.auth.tiene(P.CONFIG_GESTIONAR);
  readonly pestana = signal<Pestana>(this.puedeGestionar ? 'cargar' : 'base');
  readonly clientes = signal<any[]>([]);
  readonly ocupado = signal(false);
  // Carga
  cargaCliente = '';
  modo: 'omitir' | 'reemplazar' = 'omitir';
  readonly archivo = signal<File | null>(null);
  readonly previa = signal<any>(null);
  readonly selCarga = signal(new Set<string>());
  readonly todosCarga = computed(() => !!this.previa()?.filas.length && this.previa().filas.every((x: any) => this.selCarga().has(x.vpl)));
  // Base
  f = { cliente: '', mes: mesActual(), estado: '' };
  readonly lista = signal<any[]>([]);
  readonly q = signal('');
  readonly sel = signal(new Set<string>());
  readonly visibles = computed(() => filtrar<any>(this.lista(), this.q()));
  readonly todasSel = computed(() => this.visibles().length > 0 && this.visibles().every(x => this.sel().has(x._id)));
  readonly marcadas = () => this.lista().filter(x => this.sel().has(x._id));
  readonly pendientesLista = computed(() => this.visibles().filter(x => !x.impreso));
  readonly ed = signal<any>(null);
  // Imprimir
  imp = { que: 'marcadas', desde: '', hasta: '', una: '' };
  readonly porHoja = signal<1 | 2>(2);
  readonly linea = signal(true);
  readonly hojaTexto = computed(() => (this.porHoja() === 2 ? '2 remesas por hoja' : '1 remesa por hoja'));
  // Configuración
  readonly fmt = signal<any>(null);
  readonly LIMITES_LOGOS = LIMITES_LOGOS; readonly SIN_AJUSTE = SIN_AJUSTE;
  fmtCliente = '';
  logoQuitado = false;
  private enVivo = inject(EnVivo).al(['gestion'], () => this.cargar());

  constructor() {
    this.api.get<any[]>('/maestros/clientes').then(c => {
      const activos = c.filter(x => x.activo !== false); this.clientes.set(activos);
      let ultimo = ''; try { ultimo = localStorage.getItem('remesas.cliente') || ''; } catch { /* sin almacenamiento */ }
      this.cargaCliente = activos.some(x => x._id === ultimo) ? ultimo : (activos.length === 1 ? activos[0]._id : '');
      this.fmtCliente = this.cargaCliente || activos[0]?._id || '';
    }).catch(e => this.avisos.error(e));
    this.api.get<any>('/gestion/remesas/formato').then(k => { this.porHoja.set(k.porHoja === 1 ? 1 : 2); this.linea.set(k.linea !== false); }).catch(() => {});
    this.cargar();
  }

  numeros = (b: any[]) => b.map(v => v.numero).join(', ');
  hojas = (n: number) => (this.porHoja() === 2 ? Math.ceil(n / 2) : n);
  ciudad = (c: string) => (String(c || '').split('-')[0].trim() ? `${String(c).split('-')[0].trim()},` : '');
  hoyLargo() { const h = new Date(); return `${h.getDate()} de ${MESES[h.getMonth()]} de ${h.getFullYear()}`; }

  // ── Carga ──
  async elegirArchivo(ev: Event) {
    const input = ev.target as HTMLInputElement; const a = input.files?.[0]; input.value = '';
    if (!a || !this.cargaCliente) return;
    this.archivo.set(a); this.previa.set(null); this.ocupado.set(true);
    try {
      const p = await this.api.subir<any>('/gestion/remesas/previa', a, { cliente: this.cargaCliente });
      this.previa.set(p);
      this.selCarga.set(new Set(p.filas.filter((x: any) => x.estado === 'nuevo' || (x.estado === 'cambio' && !x.impreso)).map((x: any) => x.vpl)));
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
  recordarCliente() { try { localStorage.setItem('remesas.cliente', this.cargaCliente); } catch { /* sin almacenamiento */ } }
  alternarCarga(v: string) { const s = new Set(this.selCarga()); if (s.has(v)) s.delete(v); else s.add(v); this.selCarga.set(s); }
  marcarCarga(que: 'todos' | 'nuevos' | 'ninguno') {
    const fs = this.previa()?.filas || [];
    this.selCarga.set(new Set(que === 'ninguno' ? [] : fs.filter((x: any) => x.estado !== 'conflicto' && (que === 'todos' || x.estado === 'nuevo')).map((x: any) => x.vpl)));
  }
  async pasar() {
    const a = this.archivo(); if (!a) return;
    this.ocupado.set(true);
    try {
      const r = await this.api.subirConCabeceras<any>(`/gestion/remesas/importar?cliente=${encodeURIComponent(this.cargaCliente)}&modo=${this.modo}`, a,
        { 'X-Seleccion': seleccionCompacta(this.previa().filas.map((x: any) => x.vpl), this.selCarga()) });
      this.avisos.ok(`${r.nuevos} nueva(s) · ${r.reemplazados} reemplazada(s) · ${r.omitidos} omitida(s) · próxima remesa: ${r.siguiente}`
        + (r.conflictos?.length ? ` · no se pasaron ${r.conflictos.length} con número de otro viaje (VPL ${r.conflictos.map((c: any) => c.vpl).join(', ')})` : '')
        + (r.impresasSinCambio?.length ? ` · ${r.impresasSinCambio.length} ya impresa(s) no se reemplazaron` : '')
        + (r.sinCedula.length ? ` · sin cédula: ${r.sinCedula.join(', ')}` : ''));
      this.previa.set(null); this.archivo.set(null);
      this.f.cliente = this.cargaCliente; this.f.estado = 'pendientes'; this.f.mes = '';
      await this.cargar(); this.pestana.set('base');
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }

  // ── Base ──
  async cargar() {
    try {
      this.lista.set(await this.api.get<any[]>('/gestion/remesas', { cliente: this.f.cliente, mes: this.f.mes, estado: this.f.estado }));
      const ids = new Set(this.lista().map(x => x._id)); this.sel.set(new Set([...this.sel()].filter(i => ids.has(i))));
    } catch (e) { this.avisos.error(e); }
  }
  alternar(i: string) { const s = new Set(this.sel()); if (s.has(i)) s.delete(i); else s.add(i); this.sel.set(s); }
  seleccionar(que: 'todas' | 'pendientes' | 'ninguna') {
    this.sel.set(new Set(que === 'ninguna' ? [] : this.visibles().filter(x => que === 'todas' || !x.impreso).map(x => x._id)));
  }
  editar(x: any) { this.ed.set({ ...x, fecha: x.fecha ? String(x.fecha).slice(0, 10) : '' }); }
  async guardarEdicion() {
    const e = this.ed(); this.ocupado.set(true);
    try {
      await this.api.put(`/gestion/remesas/${e._id}`, { remesa: String(e.remesa || ''), fecha: e.fecha, zona: e.zona, peso: e.peso, manifiesto: e.manifiesto, costo: e.costo,
        conductor: e.conductor, cedula: String(e.cedula || ''), direccion: e.direccion, placa: e.placa });
      this.avisos.ok(`Remesa ${e.remesa} guardada`); this.ed.set(null); this.cargar();
    } catch (er) { this.avisos.error(er); } finally { this.ocupado.set(false); }
  }
  async eliminar() {
    const e = this.ed();
    try { await this.api.delete(`/gestion/remesas/${e._id}`); this.avisos.ok('Remesa eliminada'); this.ed.set(null); this.cargar(); } catch (er) { this.avisos.error(er); }
  }

  // ── Imprimir ──
  // Lo que se va a imprimir según «Qué imprimir» (se recalcula en cada cambio de la pantalla)
  aImprimir() {
    const l = [...this.visibles()].sort((a, b) => (Number(a.remesa) || 1e12) - (Number(b.remesa) || 1e12));
    const que = this.imp.que;
    if (que === 'marcadas') return l.filter(x => this.sel().has(x._id));
    if (que === 'pendientes') return l.filter(x => !x.impreso);
    if (que === 'una') return l.filter(x => x.remesa && x.remesa === String(this.imp.una).trim());
    const d = Number(this.imp.desde); const h = Number(this.imp.hasta) || d;
    if (!d) return [];
    return l.filter(x => x.remesa && Number(x.remesa) >= d && Number(x.remesa) <= h);
  }
  private cuerpo(l: any[], marcar = true) { return { ids: l.map(x => x._id), porHoja: this.porHoja(), linea: this.linea(), marcar }; }
  async verPdf(l: any[]) {
    if (!l.length) return;
    // Ver no marca como impresa
    await this.visor().ver('/gestion/remesas/pdf', l.length === 1 ? `Remesa ${l[0].remesa}` : `Remesas (${l.length})`, undefined, this.cuerpo(l, false));
  }
  async descargarUna(x: any) {
    try {
      const b = await this.api.archivoPost('/gestion/remesas/pdf', { ids: [x._id], porHoja: 1, linea: false, marcar: false });
      bajar(b, `Remesa_${x.remesa}_VPL_${x.vpl}.pdf`);
    } catch (e) { this.avisos.error(e); }
  }
  async zip(l: any[]) {
    this.ocupado.set(true);
    try { bajar(await this.api.archivoPost('/gestion/remesas/zip', this.cuerpo(l)), `Remesas_${l.length}.zip`); this.avisos.ok(`${l.length} remesa(s) descargadas`); this.cargar(); }
    catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
  // Con 2 por hoja, la de la fila va arriba y la siguiente pendiente abajo
  imprimirUna(x: any) {
    if (this.porHoja() === 1) { this.imprimir([x]); return; }
    const orden = [...this.lista()].sort((a, b) => (Number(a.remesa) || 1e12) - (Number(b.remesa) || 1e12));
    const sig = orden.find(y => y._id !== x._id && !y.impreso && (Number(y.remesa) || 0) > (Number(x.remesa) || 0));
    this.imprimir(sig ? [x, sig] : [x]);
  }
  async imprimir(l: any[]) {
    if (!l.length) return;
    const ya = l.filter(x => x.impreso);
    if (ya.length && !confirm(`${ya.length === l.length ? (l.length === 1 ? 'Esta remesa ya se imprimió' : `Estas ${l.length} remesas ya se imprimieron`) : `${ya.length} de las ${l.length} remesas ya se imprimieron`} (${ya.slice(0, 6).map(x => x.remesa).join(', ')}${ya.length > 6 ? '…' : ''}).\n\n¿Imprimirlas otra vez?`)) return;
    this.ocupado.set(true);
    try {
      const b = await this.api.archivoPost('/gestion/remesas/pdf', this.cuerpo(l));
      imprimirPdf(b);
      this.avisos.ok(`${l.length} remesa(s) listas para imprimir · ${this.hojas(l.length)} hoja(s)`);
      this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }

  // ── Configuración ──
  async abrirFormato() {
    this.pestana.set('formato'); this.logoQuitado = false;
    try { this.fmt.set(await this.api.get<any>('/gestion/remesas/formato', { cliente: this.fmtCliente })); } catch (e) { this.avisos.error(e); }
  }
  async logo(ev: Event, campo: 'logo' | 'logoCliente') {
    const input = ev.target as HTMLInputElement; const a = input.files?.[0]; input.value = '';
    if (!a) return;
    try { const u = await leerImagen(a); this.fmt.set({ ...this.fmt(), [campo]: u, [`${campo}Nuevo`]: true }); } catch (e) { this.avisos.error(e); }
  }
  async guardarEmpresa() {
    const k = this.fmt(); this.ocupado.set(true);
    try {
      const r = await this.api.put<any>('/gestion/remesas/formato/empresa', { nombre1: k.nombre1, nombre2: k.nombre2, nit: k.nit, lema: k.lema, resolucion: k.resolucion,
        siguiente: Number(k.siguiente), porHoja: Number(k.porHoja), linea: !!k.linea, ajusteLogo: k.ajusteLogo || SIN_AJUSTE, ...(k.logoNuevo ? { logo: k.logo } : {}) });
      this.fmt.set({ ...r, ...this.datosCliente(k) }); this.porHoja.set(r.porHoja === 1 ? 1 : 2); this.linea.set(r.linea !== false);
      this.avisos.ok('Encabezado de la remesa guardado');
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
  private datosCliente(k: any) {
    return { logoCliente: k.logoCliente, remitente: k.remitente, ciudadOrigen: k.ciudadOrigen, direccion: k.direccion, sector: k.sector, destinatario: k.destinatario,
      cantidad: k.cantidad, clase: k.clase, contenido: k.contenido, ajusteLogoCliente: k.ajusteLogoCliente };
  }
  // Aproximación en pantalla: 1 unidad del diseño ≈ 1 px en la vista previa
  transformar(a?: Ajuste) { const x = a || SIN_AJUSTE; return `translate(${x.dx}px, ${x.dy}px) scale(${x.escala})`; }
  // Muestra exacta en PDF con lo que está en pantalla, sin guardar
  verMuestra() {
    const k = this.fmt(); if (!k) return;
    const { logoCliente, ajusteLogoCliente, ...textos } = this.datosCliente(k);
    this.visor().ver('/gestion/remesas/formato/muestra', 'Muestra de la remesa', undefined, {
      cliente: this.fmtCliente || undefined, ...textos, nombre1: k.nombre1, nombre2: k.nombre2, nit: k.nit, lema: k.lema, resolucion: k.resolucion,
      ajusteLogo: k.ajusteLogo || SIN_AJUSTE, ajusteLogoCliente: ajusteLogoCliente || SIN_AJUSTE,
      ...(k.logoNuevo ? { logo: k.logo } : {}), ...(k.logoClienteNuevo || this.logoQuitado ? { logoCliente: logoCliente || '' } : {}),
    }).catch((e: unknown) => this.avisos.error(e));
  }
  async guardarCliente() {
    const k = this.fmt(); this.ocupado.set(true);
    try {
      const { logoCliente, ajusteLogoCliente, ...resto } = this.datosCliente(k);
      const r = await this.api.put<any>(`/gestion/remesas/formato/cliente/${this.fmtCliente}`, { ...resto, ajusteLogo: ajusteLogoCliente || SIN_AJUSTE,
        ...(k.logoClienteNuevo || this.logoQuitado ? { logo: logoCliente || '' } : {}) });
      this.fmt.set(r); this.logoQuitado = false;
      this.avisos.ok('Datos de la remesa del cliente guardados');
    } catch (e) { this.avisos.error(e); } finally { this.ocupado.set(false); }
  }
}

// VPL elegidos como rangos de los VPL del archivo («i:» los que pasan o «e:» los que no, lo que sea más corto)
export function seleccionCompacta(todos: string[], elegidos: Set<string>) {
  const orden = [...new Set(todos)].sort((a, b) => Number(a) - Number(b));
  const rangos = (dentro: (v: string) => boolean) => {
    const out: string[] = []; let ini = -1;
    orden.forEach((v, i) => {
      if (dentro(v)) { if (ini < 0) ini = i; }
      if ((!dentro(v) || i === orden.length - 1) && ini >= 0) { const fin = dentro(v) ? i : i - 1; out.push(fin > ini ? `${orden[ini]}-${orden[fin]}` : orden[ini]); ini = -1; }
    });
    return out.join(',');
  };
  const incluir = `i:${rangos(v => elegidos.has(v))}`; const excluir = `e:${rangos(v => !elegidos.has(v))}`;
  return incluir.length <= excluir.length ? incluir : excluir;
}

function bajar(b: Blob, nombre: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
// Abre la ventana de impresión con el PDF (en el celular lo abre en otra pestaña para imprimir desde ahí)
function imprimirPdf(b: Blob) {
  const url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }));
  if (window.matchMedia('(max-width: 700px)').matches) { window.open(url, '_blank'); return; }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => { try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { window.open(url, '_blank'); } };
  document.body.appendChild(f);
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 120_000);
}
