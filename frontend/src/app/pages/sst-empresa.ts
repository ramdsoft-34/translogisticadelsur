import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';
import { Auth } from '../core/auth.service';
import { P } from '../core/modelos';
import { Icono } from '../shared/icono';
import { VisorPdf } from '../shared/visor-pdf';
import { LogoEmpresa } from '../shared/logo-empresa';
import { isoDia } from '../shared/formato';

const MAX_CARACTERES = 380_000;
// Reduce la franja al ancho que se ve bien en carta (2000 px) y la deja en PNG o, si pesa mucho, en JPG
function comprimirFranja(img: HTMLImageElement): string {
  let ancho = Math.min(2000, img.width); let datos = '';
  for (let i = 0; i < 8; i += 1) {
    const f = ancho / img.width; const c = document.createElement('canvas');
    c.width = Math.round(img.width * f); c.height = Math.max(1, Math.round(img.height * f));
    const g = c.getContext('2d')!; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    datos = i === 0 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
    if (datos.length <= MAX_CARACTERES) return datos;
    if (i > 0) ancho = Math.round(ancho * 0.82);
  }
  return datos;
}

// Datos del SG-SST y del PESV que van en los formatos, y el membrete con el que salen todos los informes.
@Component({
  selector: 'app-sst-empresa',
  imports: [FormsModule, Icono, VisorPdf, LogoEmpresa],
  template: `
    <div class="pagina-cab">
      <div><h1>Datos y membrete</h1><p class="sutil">Lo que se escribe aquí llena solo los formatos (representante legal, responsable del SG-SST, ARL, clase de riesgo…). El membrete se pone en todos los PDF y en los Word propios.</p></div>
      <div class="acciones"><button (click)="visor.ver('/sst/plantillas/SST-FOR-06/pdf', 'Vista previa con el membrete')"><app-icono nombre="ojo" />Ver cómo queda</button></div>
    </div>
    @if (d(); as e) {
      <div class="dos">
        <form id="form-emp" (ngSubmit)="guardar()" class="panel">
          <h2>{{ e.rndc?.razonSocial || e.nombre }} · NIT {{ e.nit }}{{ e.dv ? '-' + e.dv : '' }}</h2>
          <p class="sutil">Razón social, NIT, dirección y teléfono se toman de la configuración de la empresa.</p>
          <fieldset><legend>Responsables</legend><div class="formulario">
            <div class="campo"><label>Representante legal</label><input name="rl" [(ngModel)]="e.sst.representanteLegal" /></div>
            <div class="campo"><label>Documento del representante</label><input name="drl" [(ngModel)]="e.sst.documentoRepresentante" /></div>
            <div class="campo"><label>Responsable del SG-SST</label><input name="rs" [(ngModel)]="e.sst.responsableSst" /></div>
            <div class="campo"><label>Licencia en SST</label><input name="ls" [(ngModel)]="e.sst.licenciaSst" placeholder="Resolución y fecha" /></div>
            <div class="campo"><label>Líder del PESV</label><input name="lp" [(ngModel)]="e.sst.liderPesv" /></div>
          </div></fieldset>
          <fieldset><legend>Riesgo y tamaño</legend><div class="formulario">
            <div class="campo"><label>ARL</label><input name="arl" [(ngModel)]="e.sst.arl" /></div>
            <div class="campo"><label>Clase de riesgo</label><select name="cr" [(ngModel)]="e.sst.claseRiesgo"><option [ngValue]="null">—</option>
              @for (n of [1, 2, 3, 4, 5]; track n) { <option [ngValue]="n">{{ ['I', 'II', 'III', 'IV', 'V'][n - 1] }}</option> }</select></div>
            <div class="campo"><label>Actividad económica</label><input name="act" [(ngModel)]="e.sst.actividad" /></div>
            <div class="campo"><label>Número de trabajadores</label><input type="number" min="0" name="nt" [(ngModel)]="e.sst.numTrabajadores" /><small>{{ estandaresAplicables(e.sst.numTrabajadores, e.sst.claseRiesgo) }}</small></div>
            <div class="campo"><label>Horas de manejo seguido (aviso de fatiga)</label><input type="number" min="1" max="12" step="0.5" name="hc" [(ngModel)]="e.sst.horasConduccionContinua" /><small>Con los tiempos de Sur Track. Lo confirma el líder del PESV.</small></div>
            <div class="campo"><label>Minutos detenido que cuentan como pausa</label><input type="number" min="5" max="120" name="mp" [(ngModel)]="e.sst.minutosPausa" /></div>
            <div class="campo"><label>Nivel del PESV</label><select name="np" [(ngModel)]="e.sst.nivelPesv"><option value="">Sin definir</option><option value="basico">Básico</option><option value="estandar">Estándar</option><option value="avanzado">Avanzado</option></select>
              @if (e.nivelSugerido) { <small>Por el tamaño de la flota: {{ nivelTexto(e.nivelSugerido) }}</small> }</div>
          </div></fieldset>
          <fieldset><legend>Última autoevaluación</legend><div class="formulario">
            <div class="campo"><label>Estándares mínimos (%)</label><input type="number" min="0" max="100" step="0.5" name="p1" [(ngModel)]="e.sst.puntaje0312" /></div>
            <div class="campo"><label>Fecha</label><input type="date" name="f1" [(ngModel)]="e.sst.fechaEvaluacion0312" /></div>
            <div class="campo"><label>PESV (%)</label><input type="number" min="0" max="100" step="0.5" name="p2" [(ngModel)]="e.sst.puntajePesv" /></div>
            <div class="campo"><label>Fecha</label><input type="date" name="f2" [(ngModel)]="e.sst.fechaEvaluacionPesv" /></div>
          </div></fieldset>
          <fieldset><legend>Colores y pie</legend><div class="formulario">
            <div class="campo"><label>Color principal</label><input type="color" name="c1" [(ngModel)]="e.membrete.colorPrimario" /></div>
            <div class="campo"><label>Color de acento</label><input type="color" name="c2" [(ngModel)]="e.membrete.colorSecundario" /></div>
            <div class="campo ancho"><label>Texto del pie</label><input name="tp" [(ngModel)]="e.membrete.textoPie" maxlength="300" placeholder="Dirección · teléfono · correo · sitio web" /></div>
          </div></fieldset>
          <div class="acciones"><button type="submit" class="primario" [disabled]="trabajando()">Guardar datos</button></div>
        </form>

        <section class="panel">
          <h2>Membrete</h2>
          <p class="sutil">Suba la franja de encabezado y la de pie tal como salen en su papelería (PNG o JPG, horizontal). Si no sube franja, los formatos usan el encabezado clásico con el logo.</p>
          @for (parte of ['encabezado', 'pie']; track parte) {
            <div class="franja">
              <div class="cab-f"><strong>{{ parte === 'encabezado' ? 'Encabezado' : 'Pie de página' }}</strong>
                <label class="boton pequeno"><input type="file" accept="image/png,image/jpeg" hidden (change)="subir(parte, $event)" />{{ e.membrete[parte] ? 'Cambiar' : 'Subir imagen' }}</label>
                @if (e.membrete[parte]) { <button type="button" class="pequeno texto" (click)="quitar(parte)">Quitar</button> }</div>
              @if (e.membrete[parte]) { <img [src]="e.membrete[parte]" [alt]="parte" /> } @else { <div class="vacia">Sin {{ parte === 'encabezado' ? 'encabezado' : 'pie' }}</div> }
            </div>
          }
          <h2 style="margin-top:18px">Logo</h2>
          <p class="sutil">El mismo logo del soporte interno; va en el encabezado clásico y en los Excel con <code>{{ '{{' }}empresa.logo{{ '}}' }}</code>.</p>
          @if (auth.tiene(P.CONFIG_GESTIONAR)) { <app-logo-empresa /> } @else { <p class="mensaje info">El logo lo sube el administrador de la empresa en Empresa → Configuración.</p> }
        </section>
      </div>
    }
    <app-visor-pdf #visor />`,
  styles: [`
    .dos { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 14px; align-items: start; }
    @media (max-width: 1000px) { .dos { grid-template-columns: 1fr; } }
    .panel { background: var(--gris-0); border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 18px; min-width: 0; }
    .panel h2 { margin: 0 0 4px; font-size: 16px; } .formulario .ancho { grid-column: 1 / -1; }
    .franja { border: 1px solid var(--gris-2); border-radius: var(--radio); padding: 10px; margin-top: 10px; }
    .cab-f { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; } .cab-f strong { flex: 1; }
    .franja img { width: 100%; display: block; border: 1px dashed var(--gris-3); }
    .vacia { display: grid; place-items: center; height: 64px; border: 1px dashed var(--gris-3); border-radius: 8px; color: var(--gris-4); font-size: 13px; }
    input[type=color] { min-height: 40px; padding: 2px; }
    code { font-size: 12px; background: var(--gris-1); border: 1px solid var(--gris-2); border-radius: 6px; padding: 1px 5px; }
  `],
})
export class SstEmpresa {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly auth = inject(Auth);
  readonly P = P;
  readonly d = signal<any>(null);
  readonly trabajando = signal(false);

  constructor() { this.cargar(); }
  async cargar() {
    try {
      const e: any = await this.api.get('/sst/empresa');
      e.sst = { representanteLegal: '', documentoRepresentante: '', responsableSst: '', licenciaSst: '', liderPesv: '', arl: '', claseRiesgo: null, actividad: '', numTrabajadores: 0, nivelPesv: '', horasConduccionContinua: 4, minutosPausa: 15, ...(e.sst || {}) };
      e.sst.fechaEvaluacion0312 = isoDia(e.sst.fechaEvaluacion0312); e.sst.fechaEvaluacionPesv = isoDia(e.sst.fechaEvaluacionPesv);
      e.membrete = { colorPrimario: '#0d1117', colorSecundario: '#f6b80f', textoPie: '', encabezado: '', pie: '', ...(e.membrete || {}) };
      this.d.set(e);
    } catch (err) { this.avisos.error(err); }
  }
  // Res. 0312 de 2019: 7 estándares (≤ 10 trabajadores, riesgo I-III), 21 (11 a 50, riesgo I-III) o 60 (más de 50, o riesgo IV-V)
  estandaresAplicables(n: number, clase: number | null) {
    if (!n) return '';
    if ((clase || 0) >= 4 || n > 50) return 'Aplican los 60 estándares (Res. 0312, capítulo III)';
    return n <= 10 ? 'Aplican 7 estándares (Res. 0312, art. 3)' : 'Aplican 21 estándares (Res. 0312, art. 9)';
  }
  nivelTexto = (n: string) => ({ basico: 'básico', estandar: 'estándar', avanzado: 'avanzado' } as Record<string, string>)[n] || n;
  async guardar() {
    const e = this.d(); this.trabajando.set(true);
    try {
      await this.api.put('/sst/empresa', { sst: e.sst, membrete: { colorPrimario: e.membrete.colorPrimario, colorSecundario: e.membrete.colorSecundario, textoPie: e.membrete.textoPie } });
      this.avisos.ok('Datos guardados');
    } catch (err) { this.avisos.error(err); } finally { this.trabajando.set(false); }
  }
  subir(parte: string, ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const imagen = comprimirFranja(img);
        try { await this.api.put(`/sst/empresa/membrete/${parte}`, { imagen }); this.d.update(d => ({ ...d, membrete: { ...d.membrete, [parte]: imagen } })); this.avisos.ok('Membrete actualizado'); }
        catch (err) { this.avisos.error(err); }
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(f);
  }
  async quitar(parte: string) {
    try { await this.api.put(`/sst/empresa/membrete/${parte}`, { imagen: '' }); this.d.update(d => ({ ...d, membrete: { ...d.membrete, [parte]: '' } })); } catch (err) { this.avisos.error(err); }
  }
}
