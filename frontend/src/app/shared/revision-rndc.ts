import { Component, computed, input, output } from '@angular/core';

export interface CorreccionRndc { documento: 'remesa' | 'manifiesto'; variable: string; valor: string; antes?: string; texto?: string; explicacion?: string; aplicable?: boolean; fuente?: string; veces?: number; viajes?: (number | string)[] }
export interface HallazgoRndc {
  nivel: 'error' | 'alerta' | 'info'; titulo: string; detalle: string; fuente: 'regla' | 'historial' | 'rndc' | 'ia'; codigo?: string;
  mensajeRndc?: string; correccion?: CorreccionRndc; correcciones?: CorreccionRndc[];
  historial?: { codigo: string; cambios: { texto: string; veces: number; viajes: (number | string)[] }[]; sinCambios: number; viajesSin: (number | string)[] } | null;
}
export interface RevisionRndc {
  viaje: string; nivel: 'ok' | 'alerta' | 'error' | 'desconocido'; hallazgos: HallazgoRndc[]; error?: string;
  ia?: { estado: 'pendiente' | 'listo' | 'error' | 'no_disponible'; motivo?: string; error?: string;
    resultado?: { causa: string; queHacer: string; confianza: 'alta' | 'media' | 'baja'; correcciones: CorreccionRndc[] } } | null;
}

const MOTIVOS_IA: Record<string, string> = {
  sin_plan: 'La revisión con IA no está disponible: Google pide activar la facturación del proyecto de la clave.',
  limite: 'La IA llegó a su límite de consultas por ahora; se intentará de nuevo en unos minutos.',
  tope_diario: 'Se alcanzó el tope diario de consultas a la IA; mañana vuelve a estar disponible.',
  clave: 'La clave de la IA no es válida.',
  no_responde: 'La IA no responde en este momento; se intentará de nuevo en unos minutos.',
};

// Resultado de la revisión de un viaje antes de enviarlo al RNDC (o de su último rechazo).
//  - modo «lista»: resumen plegable bajo el viaje en «Por enviar».
//  - modo «rechazo»: en la ventana Expedir, solo lo que ayuda a corregir el rechazo (historial, corrección e IA);
//    la explicación del rechazo ya está arriba en esa ventana.
@Component({
  selector: 'app-revision-rndc',
  template: `
    @let r = revision();
    @if (r && visibles().length || iaVisible()) {
      <details class="rev" [class.lista]="modo() === 'lista'" [open]="modo() === 'rechazo' || r?.nivel === 'error'">
        <summary>
          @if (modo() === 'lista') {
            <span class="chip sin-punto" [class]="r?.nivel === 'error' ? 'error' : r?.nivel === 'alerta' ? 'alerta' : 'ok'">{{ etiqueta() }}</span>
            <span class="primero">{{ visibles()[0]?.titulo }}@if (visibles().length > 1) { <span class="sutil"> · y {{ visibles().length - 1 }} más</span> }</span>
          } @else { <strong>Cómo corregirlo</strong> }
        </summary>
        <ul>
          @for (h of visibles(); track $index) {
            <li [class]="h.nivel">
              @if (modo() === 'lista') {
                <div class="tit"><strong>{{ h.titulo }}</strong><span class="fuente">{{ fuente(h.fuente) }}</span></div>
                <p>{{ h.detalle }}</p>
                @if (h.mensajeRndc) { <p class="sutil">Respuesta del RNDC: {{ h.mensajeRndc }}</p> }
              }
              @if (h.historial?.cambios?.length) {
                <p class="sutil">Antes se resolvió{{ h.historial!.codigo ? ' (' + h.historial!.codigo + ')' : '' }}:
                  @for (c of h.historial!.cambios; track $index) { {{ c.texto }} — {{ c.veces === 1 ? '1 vez' : c.veces + ' veces' }}@if (c.viajes.length) { (viaje {{ numeros(c.viajes) }}) }{{ $last ? '.' : ';' }} }
                </p>
              }
              @if (h.historial?.sinCambios) {
                <p class="sutil">En {{ h.historial!.sinCambios === 1 ? 'un caso anterior' : h.historial!.sinCambios + ' casos anteriores' }} se aceptó al reenviar sin cambiar el documento
                  (se registró el vehículo o la persona, o fue una falla del RNDC).</p>
              }
              @for (c of correcciones(h); track $index) {
                <div class="corr">
                  <span><strong>Corrección:</strong> {{ c.texto || textoCorreccion(c) }}@if (c.fuente === 'historial') { <span class="sutil"> (así se resolvió antes)</span> }</span>
                  @if (c.aplicable && editable()) {
                    <button type="button" class="pequeno primario" [disabled]="ocupado()" (click)="aplicar.emit(c)">Aplicar corrección</button>
                  }
                </div>
              }
            </li>
          }
          @if (r?.ia; as ia) {
            <li class="ia" [class.error]="ia.estado === 'error'">
              <div class="tit"><strong>Diagnóstico con IA</strong><span class="fuente">sin datos personales</span></div>
              @switch (ia.estado) {
                @case ('pendiente') { <p class="sutil">La IA está revisando este rechazo… (unos segundos)</p> }
                @case ('listo') {
                  <p>{{ ia.resultado?.causa }}</p>
                  <p><strong>Qué hacer:</strong> {{ ia.resultado?.queHacer }}</p>
                  @for (c of ia.resultado?.correcciones || []; track $index) {
                    <div class="corr">
                      <span><strong>Sugerencia:</strong> {{ textoCorreccion(c) }}@if (c.explicacion) { <span class="sutil"> — {{ c.explicacion }}</span> }</span>
                      @if (c.aplicable && editable()) { <button type="button" class="pequeno" [disabled]="ocupado()" (click)="aplicar.emit(c)">Aplicar sugerencia</button> }
                    </div>
                  }
                  <p class="sutil">Confianza {{ ia.resultado?.confianza }}. Es una sugerencia: revise antes de reenviar.</p>
                }
                @case ('error') { <p class="sutil">{{ ia.error || 'La IA no pudo revisar este rechazo.' }}</p> }
                @default { <p class="sutil">{{ motivoIa(ia.motivo) }}</p> }
              }
            </li>
          }
        </ul>
      </details>
    }
  `,
  styles: [`
    .rev { border: 1px solid var(--gris-2); border-radius: var(--radio); background: var(--gris-1); padding: 6px 10px; font-size: 13px; }
    .rev summary { cursor: pointer; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .rev .primero { color: var(--gris-7); }
    .rev ul { list-style: none; margin: 8px 0 2px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .rev li { border-left: 3px solid var(--gris-3); padding: 2px 0 2px 10px; }
    .rev li.error { border-left-color: var(--rojo, #c0392b); }
    .rev li.alerta { border-left-color: var(--amarillo, #d4a017); }
    .rev li.ia { border-left-color: var(--azul, #2f6fb5); }
    .rev p { margin: 3px 0; }
    .tit { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .fuente { font-size: 11.5px; color: var(--gris-5); text-transform: uppercase; letter-spacing: .03em; }
    .corr { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-top: 4px; }
  `],
})
export class RevisionRndcVista {
  readonly revision = input<RevisionRndc | null | undefined>(null);
  readonly modo = input<'lista' | 'rechazo'>('lista');
  readonly editable = input(true);
  readonly ocupado = input(false);
  readonly aplicar = output<CorreccionRndc>();

  // En «rechazo» solo el hallazgo del rechazo y solo si trae historial o una corrección
  readonly visibles = computed(() => {
    const h = this.revision()?.hallazgos || [];
    if (this.modo() === 'lista') return h;
    return h.filter((x) => x.mensajeRndc && (x.historial?.cambios?.length || x.historial?.sinCambios || this.correcciones(x).length));
  });
  readonly iaVisible = computed(() => { const ia = this.revision()?.ia; return !!ia && !(ia.estado === 'no_disponible' && ia.motivo === 'sin_clave'); });
  readonly etiqueta = computed(() => {
    const h = this.revision()?.hallazgos || [];
    const n = (x: string) => h.filter((y) => y.nivel === x).length;
    if (this.revision()?.nivel === 'error') return n('error') === 1 ? 'No pasaría: 1 problema' : `No pasaría: ${n('error')} problemas`;
    if (this.revision()?.nivel === 'alerta') return n('alerta') === 1 ? '1 aviso' : `${n('alerta')} avisos`;
    return 'Revisado';
  });

  correcciones(h: HallazgoRndc) { return h.correccion ? [h.correccion] : h.correcciones || []; }
  textoCorreccion(c: CorreccionRndc) { return `${c.variable}: ${c.antes || '(vacío)'} → ${c.valor}`; }
  numeros(l: (number | string)[]) { return l.map((x) => `N° ${x}`).join(', '); }
  fuente(f: string) { return ({ regla: 'regla', historial: 'historial de la empresa', rndc: 'RNDC', ia: 'IA' } as Record<string, string>)[f] || f; }
  motivoIa(m?: string) { return MOTIVOS_IA[m || ''] || 'La revisión con IA no está disponible en este momento.'; }
}
