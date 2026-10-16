import { Component } from '@angular/core';
import { VisorAuditoria } from '../shared/auditoria';

@Component({
  selector: 'app-admin-auditoria',
  imports: [VisorAuditoria],
  template: `
    <div class="pagina-cab"><div><h1>Auditoría</h1>
      <p class="sutil">Registro de seguridad de todas las empresas (accesos, cambios, envíos al RNDC, importaciones y descargas). Cada empresa tiene su cadena de integridad.</p></div></div>
    <app-auditoria [global]="true" />`,
})
export class AdminAuditoria {}
