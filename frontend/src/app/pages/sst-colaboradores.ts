import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, mensajeError } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Avisos } from '../core/avisos.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { Modal } from '../shared/modal';
import { Confirmar } from '../shared/confirmar';
import { VisorPdf } from '../shared/visor-pdf';
import { FirmaPad } from '../shared/firma-pad';
import { FORMATOS } from '../shared/formato';
import { CHIP_VENCE, CONCEPTOS, ESTILOS_SST, EstadoVence, TIPOS_EXAMEN, VINCULOS, aIso, hoyIso } from './sst-comun';

interface Fila {
  id: string; terceroId: string; tipo: 'conductor' | 'directo'; cargo: string; vinculacion: string; activo: boolean; nombre: string; tipoId: string; documento: string; placa: string;
  licencia: { categoria: string; vence: string; estado: EstadoVence } | null; seguridadSocial: { eps?: string; afp?: string; arl?: string };
  epp: number; eppSinFirma: number; examen: { concepto: string; vence: string | null; estado: EstadoVence } | null; comparendosPendientes: number;
}
interface Perfil extends Fila {
  persona: { tipoId: string; numId: string; nombre: string; celular: string; correo: string; direccion: string; fechaNacimiento: string | null; licencia: { categoria?: string; vence?: string } | null; placas: string[] };
  ingreso: string | null; contactoEmergencia: { nombre?: string; parentesco?: string; telefono?: string };
  examenes: { id: string; tipo: string; fecha: string; vence: string | null; concepto: string; restricciones: string; entidad: string; estado: EstadoVence }[];
  eppEntregas: { id: string; fecha: string; motivo: string; elementos: { nombre: string; cantidad: number }[]; observacion: string; proximaReposicion: string | null; firmadoEn: string | null; firmaOrigen: string; pendienteApp: boolean }[];
  comparendosLista: { id: string; fecha: string; numero: string; codigo: string; descripcion: string; placa: string; valor: number; estado: string }[];
  capacitaciones: { id: string; fecha: string; tema: string; eje: string; horas: number; ejecutada: boolean; firmada: boolean }[];
  inspecciones: { id: string; fecha: string; placa: string; resultado: string }[];
}
interface PlanillaMes { id: string; nombrePeriodo: string; estado: string; recibida: { subidoEn: string } | null }

type Pestana = 'datos' | 'examenes' | 'epp' | 'vial' | 'planillas';
const ELEMENTOS_EPP = ['Casco', 'Botas de seguridad', 'Chaleco reflectivo', 'Guantes', 'Gafas de seguridad', 'Protector auditivo', 'Tapabocas', 'Overol', 'Impermeable'];

// Colaboradores de SG-SST: un solo perfil por persona, enlazado a Conductores y terceros.
@Component({
  selector: 'app-sst-colaboradores',
  imports: [FormsModule, Icono, Modal, Confirmar, VisorPdf, FirmaPad, ...FORMATOS],
  template: `
    <div class="pagina-cab">
      <div><h1>Colaboradores</h1>
        <p class="sutil">Un solo perfil por persona con su información de SST y de seguridad vial. Los conductores y empleados se traen de Conductores y terceros, sin escribirlos otra vez.</p></div>
      @if (puede) { <div class="acciones">
        <button (click)="traer()" [disabled]="trabajando()"><app-icono nombre="descargar" />Traer conductores y empleados</button>
        <button class="primario" (click)="abrirNuevo()"><app-icono nombre="mas" />Nuevo colaborador</button>
      </div> }
    </div>

    <div class="barra">
      <div class="campo crece"><label for="c-q">Buscar</label><input id="c-q" type="search" placeholder="Nombre, documento o placa" [(ngModel)]="q" (input)="buscarDiferido()" /></div>
      <div class="campo"><label for="c-tipo">Tipo</label>
        <select id="c-tipo" [(ngModel)]="tipo" (change)="cargar()"><option value="">Todos</option><option value="conductor">Conductores</option><option value="directo">Trabajadores directos</option></select></div>
    </div>

    <div class="tabla-caja">
      <table class="tabla-movil">
        <thead><tr><th>Colaborador</th><th>Cargo y vinculación</th><th>Licencia</th><th>Seguridad social</th><th class="num">EPP</th><th class="celda-acciones"><span class="visualmente-oculto">Acciones</span></th></tr></thead>
        <tbody>
          @for (c of lista(); track c.id) {
            <tr>
              <td data-etiqueta="Colaborador" class="col-nombre"><div class="celda-doble"><strong>{{ c.nombre }}</strong>
                <small>{{ c.tipoId === 'C' ? 'C.C.' : c.tipoId }} {{ c.documento }}@if (c.placa) { · <span class="placa">{{ c.placa }}</span> }</small></div></td>
              <td data-etiqueta="Cargo"><div class="celda-doble"><span>{{ c.cargo || (c.tipo === 'conductor' ? 'Conductor' : '—') }}</span>
                <small>{{ detalleCargo(c) }}</small></div></td>
              <td data-etiqueta="Licencia">@if (c.licencia; as l) { <div class="celda-doble"><span class="chip" [class]="CHIP_VENCE[l.estado]">{{ l.vence | dia }}</span><small>Categoría {{ l.categoria || '—' }}</small></div> } @else { <span class="sutil">—</span> }</td>
              <td data-etiqueta="Seguridad social">{{ seguridad(c) }}</td>
              <td data-etiqueta="EPP" class="num">{{ c.epp }}@if (c.eppSinFirma) { <small class="d-bloque aviso-texto">{{ c.eppSinFirma }} sin firma</small> }</td>
              <td class="celda-acciones"><div class="acciones"><button class="pequeno" (click)="abrir(c.id)" [attr.aria-label]="'Abrir el perfil de ' + c.nombre">Perfil</button></div></td>
            </tr>
          } @empty {
            @if (cargando()) { @for (i of [1, 2, 3]; track i) { <tr><td colspan="6"><span class="esqueleto"></span></td></tr> } }
            @else { <tr><td colspan="6" class="vacio"><strong>Sin colaboradores</strong>{{ q || tipo ? 'Nadie con ese filtro.' : 'Use «Traer conductores y empleados» para crear los perfiles de quienes ya están en Conductores y terceros.' }}</td></tr> }
          }
        </tbody>
      </table>
    </div>

    <!-- Perfil -->
    <app-modal [titulo]="perfil()?.nombre || 'Colaborador'" [abierto]="!!perfil()" [ancho]="true" (cerrar)="cerrar()">
      @if (perfil(); as p) {
        <div class="pestanas" role="tablist">
          @for (t of pestanas(); track t[0]) { <button type="button" role="tab" [class.activa]="pestana() === t[0]" [attr.aria-selected]="pestana() === t[0]" (click)="pestana.set(t[0])">{{ t[1] }}</button> }
        </div>

        @switch (pestana()) {
          @case ('datos') {
            <section class="bloque"><h3>Datos personales</h3>
              <dl class="datos">
                <div><dt>Documento</dt><dd>{{ p.persona.tipoId === 'C' ? 'C.C.' : p.persona.tipoId }} {{ p.persona.numId }}</dd></div>
                <div><dt>Celular</dt><dd>{{ p.persona.celular || '—' }}</dd></div>
                <div><dt>Correo</dt><dd>{{ p.persona.correo || '—' }}</dd></div>
                <div><dt>Licencia</dt><dd>@if (p.licencia; as l) { {{ l.categoria }} · vence {{ l.vence | dia }} } @else { — }</dd></div>
                <div><dt>Placas</dt><dd>{{ p.persona.placas.join(', ') || '—' }}</dd></div>
              </dl>
              <p class="nota">Nombre, documento, contacto y licencia se editan en Conductores y terceros.</p>
            </section>
            <form class="bloque" (ngSubmit)="guardarDatos()"><h3>Cargo, vinculación y seguridad social</h3>
              <fieldset [disabled]="!puede" class="formulario">
                <div class="campo"><label for="p-tipo">Tipo</label><select id="p-tipo" name="tipo" [(ngModel)]="f.tipo"><option value="conductor">Conductor</option><option value="directo">Trabajador directo</option></select></div>
                <div class="campo"><label for="p-cargo">Cargo</label><input id="p-cargo" name="cargo" [(ngModel)]="f.cargo" maxlength="120" /></div>
                <div class="campo"><label for="p-vin">Vinculación</label><select id="p-vin" name="vin" [(ngModel)]="f.vinculacion">@for (v of vinculos; track v[0]) { <option [value]="v[0]">{{ v[1] }}</option> }</select></div>
                <div class="campo"><label for="p-ing">Fecha de ingreso</label><input id="p-ing" name="ing" type="date" [max]="hoy" [(ngModel)]="f.ingreso" /></div>
                <div class="campo"><label for="p-eps">EPS</label><input id="p-eps" name="eps" [(ngModel)]="f.eps" maxlength="80" /></div>
                <div class="campo"><label for="p-afp">Fondo de pensiones</label><input id="p-afp" name="afp" [(ngModel)]="f.afp" maxlength="80" /></div>
                <div class="campo"><label for="p-arl">ARL</label><input id="p-arl" name="arl" [(ngModel)]="f.arl" maxlength="80" /></div>
                <div class="campo"><label for="p-cn">Contacto de emergencia</label><input id="p-cn" name="cn" [(ngModel)]="f.contactoNombre" maxlength="120" /></div>
                <div class="campo"><label for="p-cp">Parentesco</label><input id="p-cp" name="cp" [(ngModel)]="f.contactoParentesco" maxlength="40" /></div>
                <div class="campo"><label for="p-ct">Teléfono del contacto</label><input id="p-ct" name="ct" [(ngModel)]="f.contactoTelefono" maxlength="20" inputmode="tel" /></div>
                <div class="campo"><label class="casilla"><input type="checkbox" name="activo" [(ngModel)]="f.activo" /> Activo</label></div>
              </fieldset>
              @if (puede) { <div class="acciones"><button type="submit" class="primario pequeno" [disabled]="trabajando()">Guardar</button></div> }
            </form>
          }
          @case ('examenes') {
            <p class="nota">Solo se registra el concepto de aptitud, las fechas y las restricciones. No se guarda historia clínica ni diagnósticos.</p>
            <div class="tabla-caja"><table class="tabla-movil">
              <thead><tr><th>Tipo</th><th>Fecha</th><th>Concepto</th><th>Vigencia</th><th>Restricciones</th><th></th></tr></thead>
              <tbody>
                @for (x of p.examenes; track x.id) {
                  <tr><td data-etiqueta="Tipo">{{ TIPOS_EXAMEN[x.tipo] }}</td><td data-etiqueta="Fecha">{{ x.fecha | dia }}</td>
                    <td data-etiqueta="Concepto"><span class="chip" [class.ok]="x.concepto === 'apto'" [class.alerta]="x.concepto === 'apto_restricciones' || x.concepto === 'aplazado'" [class.error]="x.concepto === 'no_apto'">{{ CONCEPTOS[x.concepto] }}</span></td>
                    <td data-etiqueta="Vigencia">@if (x.vence) { <span class="chip" [class]="CHIP_VENCE[x.estado]">{{ x.vence | dia }}</span> } @else { — }</td>
                    <td data-etiqueta="Restricciones">{{ x.restricciones || '—' }}</td>
                    <td class="celda-acciones">@if (puede) { <button class="pequeno texto" confirmar="Clic otra vez para borrar" (confirmado)="quitar('examenes', x.id)">Borrar</button> }</td></tr>
                } @empty { <tr><td colspan="6" class="vacio">Sin exámenes registrados.</td></tr> }
              </tbody></table></div>
            @if (puede) {
              <form class="agregar formulario" (ngSubmit)="agregarExamen()">
                <div class="campo"><label for="e-tipo">Tipo</label><select id="e-tipo" name="tipo" [(ngModel)]="ex.tipo">@for (t of tiposExamen; track t[0]) { <option [value]="t[0]">{{ t[1] }}</option> }</select></div>
                <div class="campo"><label for="e-fecha">Fecha</label><input id="e-fecha" name="fecha" type="date" [max]="hoy" [(ngModel)]="ex.fecha" required /></div>
                <div class="campo"><label for="e-con">Concepto</label><select id="e-con" name="con" [(ngModel)]="ex.concepto">@for (c of conceptos; track c[0]) { <option [value]="c[0]">{{ c[1] }}</option> }</select></div>
                <div class="campo"><label for="e-vence">Vigente hasta</label><input id="e-vence" name="vence" type="date" [min]="ex.fecha" [(ngModel)]="ex.vence" /></div>
                <div class="campo"><label for="e-ent">IPS o médico</label><input id="e-ent" name="ent" [(ngModel)]="ex.entidad" maxlength="120" /></div>
                <div class="campo ancho"><label for="e-res">Restricciones laborales {{ ex.concepto === 'apto_restricciones' ? '(obligatorio)' : '' }}</label><input id="e-res" name="res" [(ngModel)]="ex.restricciones" maxlength="300" /></div>
                <div class="acciones ancho"><button type="submit" class="primario pequeno" [disabled]="trabajando()"><app-icono nombre="mas" [tam]="15" />Agregar examen</button></div>
              </form>
            }
          }
          @case ('epp') {
            <div class="seccion-cab"><span class="nota">Cada entrega con la firma de quien recibe (aquí o en la app del conductor).</span>
              <button class="pequeno" (click)="verPdfEpp()"><app-icono nombre="ojo" [tam]="15" />PDF SST-FOR-02</button></div>
            <div class="tabla-caja"><table class="tabla-movil">
              <thead><tr><th>Fecha</th><th>Elementos</th><th>Motivo</th><th>Reponer</th><th>Firma</th><th></th></tr></thead>
              <tbody>
                @for (e of p.eppEntregas; track e.id) {
                  <tr><td data-etiqueta="Fecha">{{ e.fecha | dia }}</td>
                    <td data-etiqueta="Elementos">@for (x of e.elementos; track $index) { <span class="d-bloque">{{ x.cantidad }} × {{ x.nombre }}</span> }</td>
                    <td data-etiqueta="Motivo">{{ e.motivo === 'reposicion' ? 'Reposición' : 'Entrega' }}</td>
                    <td data-etiqueta="Reponer">{{ (e.proximaReposicion | dia) || '—' }}</td>
                    <td data-etiqueta="Firma">@if (e.firmadoEn) { <span class="chip ok">{{ e.firmaOrigen === 'app' ? 'En la app' : 'En la web' }}</span> }
                      @else if (e.pendienteApp) { <span class="chip info">Pedida en la app</span> } @else { <span class="chip alerta">Sin firma</span> }</td>
                    <td class="celda-acciones">@if (puede && !e.firmadoEn) { <div class="acciones">
                      <button class="pequeno" (click)="firmarEpp(e.id)">Firmar aquí</button>
                      @if (p.tipo === 'conductor' && !e.pendienteApp) { <button class="pequeno" (click)="pedirApp(e.id)">Pedir en la app</button> }
                      <button class="pequeno texto" confirmar="Clic otra vez para borrar" (confirmado)="quitar('epp', e.id)">Borrar</button></div> }</td></tr>
                } @empty { <tr><td colspan="6" class="vacio">Sin entregas de EPP.</td></tr> }
              </tbody></table></div>
            @if (puede) {
              <form class="agregar" (ngSubmit)="agregarEpp()">
                <div class="formulario">
                  <div class="campo"><label for="epp-f">Fecha de entrega</label><input id="epp-f" name="f" type="date" [max]="hoy" [(ngModel)]="epp.fecha" required /></div>
                  <div class="campo"><label for="epp-m">Motivo</label><select id="epp-m" name="m" [(ngModel)]="epp.motivo"><option value="entrega">Entrega</option><option value="reposicion">Reposición</option></select></div>
                  <div class="campo"><label for="epp-r">Próxima reposición</label><input id="epp-r" name="r" type="date" [min]="epp.fecha" [(ngModel)]="epp.proximaReposicion" /></div>
                </div>
                <div class="elementos" role="group" aria-labelledby="epp-elementos"><span class="etiqueta" id="epp-elementos">Elementos entregados</span>
                  @for (x of epp.elementos; track $index) {
                    <div class="fila-elemento"><input [name]="'en' + $index" [(ngModel)]="x.nombre" list="lista-epp" placeholder="Elemento" maxlength="80" aria-label="Elemento" />
                      <input [name]="'ec' + $index" type="number" min="1" max="100" [(ngModel)]="x.cantidad" aria-label="Cantidad" />
                      <button type="button" class="pequeno texto" (click)="epp.elementos.splice($index, 1)" [disabled]="epp.elementos.length === 1" aria-label="Quitar elemento"><app-icono nombre="x" [tam]="14" /></button></div>
                  }
                  <datalist id="lista-epp">@for (n of ELEMENTOS_EPP; track n) { <option [value]="n"></option> }</datalist>
                  <button type="button" class="pequeno otro" (click)="epp.elementos.push({ nombre: '', cantidad: 1 })"><app-icono nombre="mas" [tam]="14" />Otro elemento</button>
                </div>
                <div class="campo"><label class="etiqueta">Firma de quien recibe</label>
                  <div class="segmentos" role="group" aria-label="Cómo firma">
                    <button type="button" [class.activo]="epp.como === 'aqui'" (click)="epp.como = 'aqui'">Firma aquí</button>
                    @if (p.tipo === 'conductor') { <button type="button" [class.activo]="epp.como === 'app'" (click)="epp.como = 'app'">Pedir en la app</button> }
                    <button type="button" [class.activo]="epp.como === 'despues'" (click)="epp.como = 'despues'">Después</button>
                  </div>
                  @if (epp.como === 'aqui') { <app-firma-pad (cambio)="epp.firma = $event" /> }
                </div>
                <div class="acciones"><button type="submit" class="primario pequeno" [disabled]="trabajando()"><app-icono nombre="check" [tam]="15" />Registrar entrega</button></div>
              </form>
            }
          }
          @case ('vial') {
            <div class="seccion-cab"><h2>Comparendos</h2><span class="nota">Registro manual (no hay conexión con el SIMIT).</span></div>
            <div class="tabla-caja"><table class="tabla-movil">
              <thead><tr><th>Fecha</th><th>N.º</th><th>Infracción</th><th>Placa</th><th class="num">Valor</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                @for (x of p.comparendosLista; track x.id) {
                  <tr><td data-etiqueta="Fecha">{{ x.fecha | dia }}</td><td data-etiqueta="N.º">{{ x.numero }}</td><td data-etiqueta="Infracción">{{ x.codigo }} {{ x.descripcion }}</td>
                    <td data-etiqueta="Placa">{{ x.placa || '—' }}</td><td data-etiqueta="Valor" class="num">{{ x.valor | pesos }}</td>
                    <td data-etiqueta="Estado">@if (puede) {
                      <select class="pequeno" [ngModel]="x.estado" (ngModelChange)="estadoComparendo(x.id, $event)" [attr.aria-label]="'Estado del comparendo ' + x.numero">
                        <option value="pendiente">Pendiente</option><option value="en_curso">En curso</option><option value="pagado">Pagado</option></select>
                    } @else { <span class="chip" [class.ok]="x.estado === 'pagado'" [class.error]="x.estado !== 'pagado'">{{ x.estado }}</span> }</td>
                    <td class="celda-acciones">@if (puede) { <button class="pequeno texto" confirmar="Clic otra vez para borrar" (confirmado)="quitar('comparendos', x.id)">Borrar</button> }</td></tr>
                } @empty { <tr><td colspan="7" class="vacio">Sin comparendos registrados.</td></tr> }
              </tbody></table></div>
            @if (puede) {
              <form class="agregar formulario" (ngSubmit)="agregarComparendo()">
                <div class="campo"><label for="cp-f">Fecha</label><input id="cp-f" name="f" type="date" [max]="hoy" [(ngModel)]="cmp.fecha" required /></div>
                <div class="campo"><label for="cp-n">N.º comparendo</label><input id="cp-n" name="n" [(ngModel)]="cmp.numero" maxlength="30" required /></div>
                <div class="campo"><label for="cp-c">Código</label><input id="cp-c" name="c" [(ngModel)]="cmp.codigo" maxlength="10" placeholder="C29" /></div>
                <div class="campo"><label for="cp-d">Descripción</label><input id="cp-d" name="d" [(ngModel)]="cmp.descripcion" maxlength="300" /></div>
                <div class="campo"><label for="cp-p">Placa</label><input id="cp-p" name="p" [(ngModel)]="cmp.placa" maxlength="7" /></div>
                <div class="campo"><label for="cp-v">Valor</label><input id="cp-v" name="v" type="number" min="0" [(ngModel)]="cmp.valor" /></div>
                <div class="campo"><label for="cp-e">Estado</label><select id="cp-e" name="e" [(ngModel)]="cmp.estado"><option value="pendiente">Pendiente</option><option value="en_curso">En curso</option><option value="pagado">Pagado</option></select></div>
                <div class="acciones"><button type="submit" class="primario pequeno" [disabled]="trabajando()"><app-icono nombre="mas" [tam]="15" />Agregar</button></div>
              </form>
            }
            <h2 class="subtitulo">Capacitaciones</h2>
            <ul class="lista-simple">
              @for (k of p.capacitaciones; track k.id) { <li><span><strong>{{ k.tema }}</strong> <span class="sutil">{{ k.fecha | dia }} · {{ k.horas }} h</span></span>
                <span class="chip" [class.ok]="k.firmada" [class.alerta]="!k.firmada">{{ k.firmada ? 'Asistencia firmada' : (k.ejecutada ? 'Sin firma' : 'Programada') }}</span></li> }
              @empty { <li class="sutil">No está inscrito en capacitaciones.</li> }
            </ul>
            @if (p.tipo === 'conductor') {
              <h2 class="subtitulo">Últimas inspecciones</h2>
              <ul class="lista-simple">
                @for (i of p.inspecciones; track i.id) { <li><span><span class="placa">{{ i.placa }}</span> <span class="sutil">{{ i.fecha | fechaHora }}</span></span>
                  <span class="chip" [class.ok]="i.resultado === 'apto'" [class.error]="i.resultado !== 'apto'">{{ i.resultado === 'apto' ? 'Apto' : 'No apto' }}</span></li> }
                @empty { <li class="sutil">Sin preoperacionales en la app.</li> }
              </ul>
            }
          }
          @case ('planillas') {
            <ul class="lista-simple">
              @for (m of planillas(); track m.id) { <li><strong class="mes">{{ m.nombrePeriodo }}</strong><span class="chip" [class.ok]="m.estado === 'recibida'" [class.error]="m.estado === 'vencida'" [class.alerta]="m.estado === 'pendiente'">{{ m.estado }}</span></li> }
              @empty { <li class="sutil">{{ errorPlanillas() || 'Sin planillas registradas.' }}</li> }
            </ul>
            <p class="nota">Las planillas se gestionan en SG-SST y PESV → Planillas.</p>
          }
        }
      }
      <ng-container pie><button type="button" (click)="cerrar()">Cerrar</button></ng-container>
    </app-modal>

    <!-- Firma de una entrega ya registrada -->
    <app-modal titulo="Firma de quien recibe" [abierto]="!!firmando()" (cerrar)="firmando.set(null)">
      <app-firma-pad (cambio)="firmaPendiente = $event" />
      <ng-container pie><button type="button" (click)="firmando.set(null)">Cancelar</button>
        <button type="button" class="primario" [disabled]="!firmaPendiente || trabajando()" (click)="guardarFirmaEpp()">Guardar firma</button></ng-container>
    </app-modal>

    <!-- Nuevo colaborador -->
    <app-modal titulo="Nuevo colaborador" [abierto]="nuevoAbierto()" (cerrar)="nuevoAbierto.set(false)">
      <form id="form-nuevo" class="formulario" (ngSubmit)="crear()">
        <div class="campo"><label for="n-tipo">Tipo</label><select id="n-tipo" name="tipo" [(ngModel)]="n.tipo"><option value="directo">Trabajador directo</option><option value="conductor">Conductor</option></select></div>
        <div class="campo"><label for="n-tid">Tipo de documento</label><select id="n-tid" name="tid" [(ngModel)]="n.tipoId"><option value="C">Cédula</option><option value="E">Cédula de extranjería</option><option value="P">Pasaporte</option><option value="T">Tarjeta de identidad</option></select></div>
        <div class="campo"><label for="n-doc">Documento</label><input id="n-doc" name="doc" [(ngModel)]="n.numId" maxlength="15" required inputmode="numeric" /></div>
        <div class="campo"><label for="n-nom">Nombres</label><input id="n-nom" name="nom" [(ngModel)]="n.nombres" maxlength="100" required /></div>
        <div class="campo"><label for="n-ap1">Primer apellido</label><input id="n-ap1" name="ap1" [(ngModel)]="n.apellido1" maxlength="100" required /></div>
        <div class="campo"><label for="n-ap2">Segundo apellido</label><input id="n-ap2" name="ap2" [(ngModel)]="n.apellido2" maxlength="100" /></div>
        <div class="campo"><label for="n-cel">Celular</label><input id="n-cel" name="cel" [(ngModel)]="n.celular" maxlength="10" inputmode="numeric" /></div>
        <div class="campo"><label for="n-cor">Correo</label><input id="n-cor" name="cor" type="email" [(ngModel)]="n.correo" maxlength="120" /></div>
        <div class="campo"><label for="n-car">Cargo</label><input id="n-car" name="car" [(ngModel)]="n.cargo" maxlength="120" /></div>
        <div class="campo"><label for="n-vin">Vinculación</label><select id="n-vin" name="vin" [(ngModel)]="n.vinculacion">@for (v of vinculos; track v[0]) { <option [value]="v[0]">{{ v[1] }}</option> }</select></div>
        <p class="nota ancho">Si la persona ya está en Conductores y terceros con ese documento, se enlaza (no se duplica).</p>
        @if (errorNuevo()) { <div class="mensaje error ancho" role="alert">{{ errorNuevo() }}</div> }
      </form>
      <ng-container pie><button type="button" (click)="nuevoAbierto.set(false)">Cancelar</button>
        <button type="submit" form="form-nuevo" class="primario" [disabled]="trabajando()">Crear</button></ng-container>
    </app-modal>

    <app-visor-pdf #visor />
  `,
  styles: [ESTILOS_SST, `
    .datos { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 16px; margin: 0; }
    .datos dt { font-size: 12px; color: var(--gris-5); } .datos dd { margin: 2px 0 0; font-weight: 600; }
    fieldset { border: 0; padding: 0; margin: 0 0 10px; min-width: 0; }
    .elementos { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
    .elementos .otro { align-self: flex-start; }
    .fila-elemento { display: grid; grid-template-columns: minmax(0, 1fr) 90px auto; gap: 8px; align-items: center; }
    .subtitulo { font-size: 16px; margin: 20px 0 10px; }
    .aviso-texto { color: var(--ambar); font-weight: 600; }
    .mes { text-transform: capitalize; }
    select.pequeno { min-height: 32px; padding: 2px 8px; }
    .col-nombre { min-width: 150px; }
  `],
})
export class SstColaboradores {
  private api = inject(Api);
  private avisos = inject(Avisos);
  private visor = viewChild.required<VisorPdf>('visor');
  readonly puede = inject(Auth).tiene(P.SST_GESTIONAR);
  readonly CHIP_VENCE = CHIP_VENCE; readonly CONCEPTOS = CONCEPTOS; readonly TIPOS_EXAMEN = TIPOS_EXAMEN; readonly VINCULOS = VINCULOS; readonly ELEMENTOS_EPP = ELEMENTOS_EPP;
  readonly vinculos = Object.entries(VINCULOS).filter(([k]) => k);
  readonly tiposExamen = Object.entries(TIPOS_EXAMEN);
  readonly conceptos = Object.entries(CONCEPTOS);
  readonly hoy = hoyIso();
  readonly lista = signal<Fila[]>([]);
  readonly cargando = signal(true);
  readonly trabajando = signal(false);
  readonly perfil = signal<Perfil | null>(null);
  readonly pestana = signal<Pestana>('datos');
  readonly planillas = signal<PlanillaMes[]>([]);
  readonly errorPlanillas = signal('');
  readonly firmando = signal<string | null>(null);
  readonly nuevoAbierto = signal(false);
  readonly errorNuevo = signal('');
  readonly pestanas = computed<[Pestana, string][]>(() => [['datos', 'Datos'], ['examenes', 'Exámenes médicos'], ['epp', 'EPP'], ['vial', 'Seguridad vial y capacitaciones'],
    ...(this.perfil()?.tipo === 'conductor' ? [['planillas', 'Planillas'] as [Pestana, string]] : [])]);
  q = ''; tipo = '';
  f = { tipo: 'directo', cargo: '', vinculacion: '', ingreso: '', eps: '', afp: '', arl: '', contactoNombre: '', contactoParentesco: '', contactoTelefono: '', activo: true };
  ex = { tipo: 'periodico', fecha: hoyIso(), concepto: 'apto', vence: '', entidad: '', restricciones: '' };
  epp = this.eppVacio();
  cmp = { fecha: hoyIso(), numero: '', codigo: '', descripcion: '', placa: '', valor: 0, estado: 'pendiente' };
  n = { tipo: 'directo', tipoId: 'C', numId: '', nombres: '', apellido1: '', apellido2: '', celular: '', correo: '', cargo: '', vinculacion: 'directo' };
  firmaPendiente = '';
  private espera: ReturnType<typeof setTimeout> | null = null;

  constructor() { this.cargar(); }

  detalleCargo(c: Fila) {
    const tipo = c.tipo === 'conductor' ? (c.cargo === 'Conductor' ? '' : 'Conductor') : 'Trabajador directo';
    return [tipo, VINCULOS[c.vinculacion] && c.vinculacion ? VINCULOS[c.vinculacion] : 'Sin vinculación'].filter(Boolean).join(' · ');
  }
  seguridad(c: Fila) { return [c.seguridadSocial.eps, c.seguridadSocial.afp, c.seguridadSocial.arl].filter(Boolean).join(' · ') || '—'; }

  private eppVacio() { return { fecha: hoyIso(), motivo: 'entrega', proximaReposicion: '', elementos: [{ nombre: '', cantidad: 1 }], firma: '', como: 'aqui' as 'aqui' | 'app' | 'despues' }; }

  async cargar() {
    this.cargando.set(true);
    try { this.lista.set(await this.api.get<Fila[]>('/sst/colaboradores', { q: this.q, tipo: this.tipo })); }
    catch (e) { this.avisos.error(e); } finally { this.cargando.set(false); }
  }
  buscarDiferido() { if (this.espera) clearTimeout(this.espera); this.espera = setTimeout(() => this.cargar(), 300); }

  async traer() {
    this.trabajando.set(true);
    try {
      const r = await this.api.post<{ nuevos: number; total: number }>('/sst/colaboradores/traer');
      this.avisos.ok(r.nuevos ? `${r.nuevos} perfil(es) nuevo(s). Total: ${r.total}.` : 'Ya estaban todos.');
      await this.cargar();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  async abrir(id: string) {
    try {
      this.pestana.set('datos');
      this.mostrar(await this.api.get<Perfil>(`/sst/colaboradores/${id}`));
    } catch (e) { this.avisos.error(e); }
  }

  private mostrar(p: Perfil) {
    this.perfil.set(p);
    this.f = { tipo: p.tipo, cargo: p.cargo, vinculacion: p.vinculacion, ingreso: aIso(p.ingreso), eps: p.seguridadSocial.eps || '', afp: p.seguridadSocial.afp || '', arl: p.seguridadSocial.arl || '',
      contactoNombre: p.contactoEmergencia.nombre || '', contactoParentesco: p.contactoEmergencia.parentesco || '', contactoTelefono: p.contactoEmergencia.telefono || '', activo: p.activo };
    if (p.tipo === 'conductor') this.cargarPlanillas(p.terceroId);
  }

  private async cargarPlanillas(terceroId: string) {
    this.planillas.set([]); this.errorPlanillas.set('');
    try { this.planillas.set(await this.api.get<PlanillaMes[]>(`/sst/conductores/${terceroId}/planillas`)); }
    catch { this.errorPlanillas.set('La empresa no usa la app de conductores o el conductor no la tiene.'); }
  }

  cerrar() { this.perfil.set(null); this.cargar(); }

  private async accion(fn: () => Promise<Perfil>, ok?: string) {
    this.trabajando.set(true);
    try { this.mostrar(await fn()); if (ok) this.avisos.ok(ok); return true; }
    catch (e) { this.avisos.error(e); return false; } finally { this.trabajando.set(false); }
  }

  guardarDatos() {
    const p = this.perfil(); if (!p) return;
    this.accion(() => this.api.put<Perfil>(`/sst/colaboradores/${p.id}`, {
      tipo: this.f.tipo, cargo: this.f.cargo, vinculacion: this.f.vinculacion, ingreso: this.f.ingreso || null, activo: this.f.activo,
      seguridadSocial: { eps: this.f.eps, afp: this.f.afp, arl: this.f.arl },
      contactoEmergencia: { nombre: this.f.contactoNombre, parentesco: this.f.contactoParentesco, telefono: this.f.contactoTelefono },
    }), 'Datos guardados.');
  }

  async agregarExamen() {
    const p = this.perfil(); if (!p) return;
    if (this.ex.concepto === 'apto_restricciones' && !this.ex.restricciones.trim()) { this.avisos.error('Escriba las restricciones laborales.'); return; }
    if (await this.accion(() => this.api.post<Perfil>(`/sst/colaboradores/${p.id}/examenes`, { ...this.ex, vence: this.ex.vence || null }), 'Examen registrado.')) {
      this.ex = { tipo: 'periodico', fecha: hoyIso(), concepto: 'apto', vence: '', entidad: '', restricciones: '' };
    }
  }

  async agregarEpp() {
    const p = this.perfil(); if (!p) return;
    const elementos = this.epp.elementos.filter((x) => x.nombre.trim()).map((x) => ({ nombre: x.nombre.trim(), cantidad: Number(x.cantidad) || 1 }));
    if (!elementos.length) { this.avisos.error('Agregue al menos un elemento.'); return; }
    if (this.epp.como === 'aqui' && !this.epp.firma) { this.avisos.error('Falta la firma de quien recibe (o elija «Después»).'); return; }
    const cuerpo = { fecha: this.epp.fecha, motivo: this.epp.motivo, proximaReposicion: this.epp.proximaReposicion || null, elementos,
      ...(this.epp.como === 'aqui' ? { firma: this.epp.firma } : {}), pedirFirmaApp: this.epp.como === 'app' };
    this.trabajando.set(true);
    try {
      const r = await this.api.post<Perfil & { pedidaApp: boolean }>(`/sst/colaboradores/${p.id}/epp`, cuerpo);
      this.mostrar(r);
      this.avisos.ok(this.epp.como === 'app' ? (r.pedidaApp ? 'Entrega registrada. Se le pidió la firma en la app.' : 'Entrega registrada. No tiene la app: tome la firma aquí.') : 'Entrega registrada.');
      this.epp = this.eppVacio();
    } catch (e) { this.avisos.error(e); } finally { this.trabajando.set(false); }
  }

  firmarEpp(id: string) { this.firmaPendiente = ''; this.firmando.set(id); }
  async guardarFirmaEpp() {
    const p = this.perfil(); const id = this.firmando(); if (!p || !id) return;
    if (await this.accion(() => this.api.post<Perfil>(`/sst/colaboradores/${p.id}/epp/${id}/firma`, { firma: this.firmaPendiente }), 'Firma guardada.')) this.firmando.set(null);
  }
  pedirApp(id: string) {
    const p = this.perfil(); if (!p) return;
    this.accion(() => this.api.post<Perfil>(`/sst/colaboradores/${p.id}/epp/${id}/pedir-firma`), 'Se le pidió la firma en la app.');
  }

  async agregarComparendo() {
    const p = this.perfil(); if (!p) return;
    if (await this.accion(() => this.api.post<Perfil>(`/sst/colaboradores/${p.id}/comparendos`, this.cmp), 'Comparendo registrado.')) {
      this.cmp = { fecha: hoyIso(), numero: '', codigo: '', descripcion: '', placa: '', valor: 0, estado: 'pendiente' };
    }
  }
  estadoComparendo(id: string, estado: string) {
    const p = this.perfil(); if (!p) return;
    this.accion(() => this.api.put<Perfil>(`/sst/colaboradores/${p.id}/comparendos/${id}`, { estado }));
  }

  quitar(que: 'examenes' | 'epp' | 'comparendos', id: string) {
    const p = this.perfil(); if (!p) return;
    this.accion(() => this.api.delete<Perfil>(`/sst/colaboradores/${p.id}/${que}/${id}`), 'Borrado.');
  }

  verPdfEpp() { const p = this.perfil(); if (p) this.visor().ver(`/sst/colaboradores/${p.id}/epp/pdf`, `EPP · ${p.nombre}`); }

  abrirNuevo() {
    this.n = { tipo: 'directo', tipoId: 'C', numId: '', nombres: '', apellido1: '', apellido2: '', celular: '', correo: '', cargo: '', vinculacion: 'directo' };
    this.errorNuevo.set(''); this.nuevoAbierto.set(true);
  }
  async crear() {
    this.errorNuevo.set('');
    const { tipo, cargo, vinculacion, ...persona } = this.n;
    this.trabajando.set(true);
    try {
      const p = await this.api.post<Perfil>('/sst/colaboradores', { tipo, cargo, vinculacion, persona });
      this.nuevoAbierto.set(false); this.avisos.ok('Colaborador creado.');
      await this.cargar(); this.pestana.set('datos'); this.mostrar({ ...p, inspecciones: [] });
    } catch (e) { this.errorNuevo.set(await mensajeError(e)); }
    finally { this.trabajando.set(false); }
  }
}
