import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Avisos } from '../core/avisos.service';

const lista = (t: string) => String(t || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);

// Reglas de negocio de la empresa que se cambian sin programar: retenciones, FOPAT, anticipo reconocido,
// días de aviso de documentos, siglas de liquidación y peso por capacidad del destino.
@Component({
  selector: 'app-reglas-empresa',
  imports: [FormsModule],
  template: `
    @if (r(); as x) {
      <form class="tarjeta" (ngSubmit)="guardar()">
        <h2>Reglas de liquidación y avisos</h2>
        <p class="sutil">Se aplican en la liquidación del conductor, la facturación, el soporte interno y los avisos de documentos. Los cambios quedan en la auditoría.</p>
        <div class="formulario">
          <div class="campo"><label for="rg-rf">Retefuente al conductor (%)</label><input id="rg-rf" type="number" step="0.01" min="0" max="10" name="rf" [(ngModel)]="x.retefuenteConductorPct" /></div>
          <div class="campo"><label for="rg-fp">FOPAT (%)</label><input id="rg-fp" type="number" step="0.01" min="0" max="5" name="fp" [(ngModel)]="x.fopatPct" /></div>
          <div class="campo"><label for="rg-pbv">FOPAT si el PBV supera (kg)</label><input id="rg-pbv" type="number" min="0" name="pbv" [(ngModel)]="x.pbvFopat" /></div>
          <div class="campo"><label for="rg-sf">Destinos sin FOPAT</label><input id="rg-sf" name="sf" [(ngModel)]="sinFopat" placeholder="Pasto" /><small>Separados por coma</small></div>
          <div class="campo ancho"><label for="rg-ac">Anticipo reconocido en 0 (si el anticipo es igual o mayor al flete) en</label>
            <input id="rg-ac" name="ac" [(ngModel)]="anticipoCero" placeholder="Pasto, Mayorista, Popayán" /></div>
          <div class="campo"><label for="rg-rff">Retefuente de las facturas (%)</label><input id="rg-rff" type="number" step="0.01" min="0" max="20" name="rff" [(ngModel)]="x.retefuenteFacturaPct" /></div>
          <div class="campo"><label for="rg-dias">Avisar documentos que vencen en (días)</label><input id="rg-dias" type="number" min="1" max="90" name="dias" [(ngModel)]="x.diasAvisoDocumentos" /></div>
          <div class="campo"><label for="rg-sig">Siglas de liquidación por defecto</label><input id="rg-sig" name="sig" maxlength="6" [(ngModel)]="x.siglasLiquidacion" style="text-transform:uppercase" />
            <small>Cuando la liquidación mezcla empresas o la empresa no tiene siglas</small></div>
        </div>
        <h3>Peso según la capacidad escrita en el destino</h3>
        <p class="sutil">Al crear un destino sin peso: «IPIALES 1.0» → {{ x.pesosPorTamano[0]?.kg }} kg.</p>
        <div class="pesos">
          @for (p of x.pesosPorTamano; track $index; let i = $index) {
            <div class="campo"><label [for]="'rg-t' + i">Capacidad</label><input [id]="'rg-t' + i" [name]="'t' + i" [(ngModel)]="p.tamano" /></div>
            <div class="campo"><label [for]="'rg-k' + i">Peso (kg)</label><input [id]="'rg-k' + i" type="number" min="0" [name]="'k' + i" [(ngModel)]="p.kg" /></div>
            <button type="button" class="texto peligro" (click)="x.pesosPorTamano.splice(i, 1)" aria-label="Quitar">Quitar</button>
          }
        </div>
        <div class="acciones" style="margin-top:12px">
          <button type="button" (click)="x.pesosPorTamano.push({ tamano: '', kg: 0 })">Agregar capacidad</button>
          <button type="button" class="texto" (click)="restablecer()">Valores de la plantilla</button>
          <button class="primario" type="submit" style="margin-left:auto" [disabled]="guardando()">Guardar reglas</button>
        </div>
      </form>
    }`,
  styles: [`.pesos { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px 12px; align-items: end; max-width: 520px; }
    h3 { font-size: 14px; margin: 18px 0 4px; }`],
})
export class ReglasEmpresa {
  private api = inject(Api);
  private avisos = inject(Avisos);
  readonly r = signal<any>(null);
  readonly guardando = signal(false);
  private base: any = null;
  sinFopat = ''; anticipoCero = '';

  constructor() { this.cargar(); }
  async cargar() {
    try {
      const d = await this.api.get<any>('/gestion/reglas');
      this.base = d.base; this.poner(d.reglas);
    } catch (e) { this.avisos.error(e); }
  }
  private poner(x: any) {
    this.r.set(structuredClone(x));
    this.sinFopat = (x.ciudadesSinFopat || []).join(', ');
    this.anticipoCero = (x.ciudadesAnticipoCero || []).join(', ');
  }
  restablecer() { if (this.base) this.poner(this.base); }
  async guardar() {
    const x = this.r();
    this.guardando.set(true);
    try {
      const d = await this.api.put<any>('/gestion/reglas', { ...x, ciudadesSinFopat: lista(this.sinFopat), ciudadesAnticipoCero: lista(this.anticipoCero),
        siglasLiquidacion: String(x.siglasLiquidacion || 'LC').toUpperCase(), pesosPorTamano: x.pesosPorTamano.filter((p: any) => String(p.tamano).trim()) });
      this.poner(d);
      this.avisos.ok('Reglas guardadas');
    } catch (e) { this.avisos.error(e); } finally { this.guardando.set(false); }
  }
}
