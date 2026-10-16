import { Component, inject, signal } from '@angular/core';
import { Api } from '../core/api.service';

// Política de tratamiento de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013).
// Es un texto base de la plataforma: cada empresa debe revisarlo con su asesor legal.
@Component({
  selector: 'app-privacidad',
  template: `
    <article class="documento">
      <h1>Política de privacidad y tratamiento de datos</h1>
      <p class="sutil">Aplica a la información registrada en Translogística del Sur por {{ empresa()?.nombre || 'cada empresa usuaria' }}.</p>

      <h2>1. Responsable del tratamiento</h2>
      @if (empresa(); as e) {
        <p>El responsable de los datos registrados en esta cuenta es <strong>{{ e.nombre }}</strong>, NIT {{ e.nit }}{{ e.dv ? '-' + e.dv : '' }}{{ e.ciudad ? ', ' + e.ciudad : '' }}.{{ contacto(e) }}</p>
      } @else {
        <p>Cada empresa de transporte usuaria de la plataforma es responsable de los datos que registra. La plataforma actúa como encargada del tratamiento.</p>
      }

      <h2>2. Datos que se tratan</h2>
      <ul>
        <li>Usuarios de la plataforma: nombre, correo, rol y registros de acceso (fecha, hora y dirección IP).</li>
        <li>Conductores, titulares, propietarios y tenedores: identificación, nombres, teléfono, dirección, licencia de conducción y, si se registra, cuenta bancaria para pagos.</li>
        <li>Vehículos: placa, características, SOAT y revisión técnico-mecánica.</li>
        <li>Operación: viajes, fletes, anticipos, remesas, manifiestos y cumplidos.</li>
      </ul>

      <h2>3. Finalidades</h2>
      <ul>
        <li>Registrar y gestionar los despachos de carga de la empresa.</li>
        <li>Reportar la información exigida al Registro Nacional de Despachos de Carga (RNDC) del Ministerio de Transporte.</li>
        <li>Liquidar fletes, pagos a conductores y facturación a clientes.</li>
        <li>Controlar el acceso, mantener la trazabilidad de las operaciones y atender auditorías.</li>
      </ul>

      <h2>4. Derechos de los titulares</h2>
      <p>De acuerdo con la Ley 1581 de 2012, los titulares pueden conocer, actualizar y rectificar sus datos, solicitar prueba de la autorización,
        ser informados sobre el uso de sus datos, revocar la autorización o pedir su supresión cuando no exista un deber legal o contractual de conservarlos,
        y presentar quejas ante la Superintendencia de Industria y Comercio. Las solicitudes se dirigen al responsable indicado en el punto 1.</p>

      <h2>5. Seguridad de la información</h2>
      <ul>
        <li>Cada empresa solo accede a sus propios datos; los permisos dependen del rol de cada usuario.</li>
        <li>Las contraseñas se guardan cifradas de forma irreversible; la contraseña del RNDC nunca se almacena.</li>
        <li>Las sesiones se cierran por inactividad y tras varios intentos fallidos la cuenta se bloquea temporalmente.</li>
        <li>Las acciones quedan en un registro de auditoría protegido contra alteraciones.</li>
      </ul>

      <h2>6. Conservación</h2>
      <p>Los datos se conservan mientras sean necesarios para las finalidades descritas y para cumplir las obligaciones legales de la empresa de transporte
        (contables, tributarias y de reporte al Ministerio de Transporte).</p>

      <p class="nota">Este es un texto base de la plataforma. Cada empresa debe revisarlo y ajustarlo con su asesor legal antes de adoptarlo como su política oficial.</p>
    </article>`,
  styles: [`
    .documento { max-width: 760px; background: #fff; border: 1px solid var(--gris-2); border-radius: var(--radio-l); padding: 28px 32px; }
    h1 { margin-bottom: 6px; }
    h2 { margin: 26px 0 8px; font-size: 16px; }
    p, li { color: var(--gris-7); line-height: 1.65; }
    ul { padding-left: 20px; margin: 0; display: grid; gap: 4px; }
    .nota { margin-top: 28px; padding: 12px 14px; border-radius: var(--radio); background: var(--gris-1); font-size: 13px; }
    @media (max-width: 640px) { .documento { padding: 20px; } }
  `],
})
export class Privacidad {
  private api = inject(Api);
  readonly empresa = signal<any>(null);
  contacto(e: any) { const c = [e.correo, e.telefono].filter(Boolean).join(' · '); return c ? ` Contacto: ${c}.` : ''; }
  constructor() { this.api.get<any>('/auth/mi-cuenta').then(d => this.empresa.set(d.empresa)).catch(() => {}); }
}
