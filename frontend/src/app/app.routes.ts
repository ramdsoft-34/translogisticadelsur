import { Routes } from '@angular/router';
import { conPermiso, conSesion, sinSesion } from './core/guards';
import { P } from './core/modelos';

const pagina = (permisos: string[], cargar: () => Promise<any>) => ({ canActivate: [conPermiso], data: { permisos }, loadComponent: cargar });

export const routes: Routes = [
  // Pública: el QR del soporte interno lleva aquí
  { path: 'verificar/:codigo', loadComponent: () => import('./pages/verificar').then(m => m.Verificar) },
  // Fase 11: enlace de la relación de cobro que recibe la empresa (sin sesión)
  // Pública: política de privacidad que se registra en Meta (WhatsApp Business)
  { path: 'politica-privacidad', data: { publica: true }, loadComponent: () => import('./pages/privacidad').then(m => m.Privacidad) },
  { path: 'r/:token', loadComponent: () => import('./pages/relacion-publica').then(m => m.RelacionPublica) },
  // Página pública de la empresa; con sesión iniciada lleva directo a la plataforma
  { path: '', pathMatch: 'full', canActivate: [sinSesion], loadComponent: () => import('./pages/landing').then(m => m.Landing) },
  { path: 'ingresar', canActivate: [sinSesion], loadComponent: () => import('./pages/ingresar').then(m => m.Ingresar) },
  {
    path: '', canActivate: [conSesion], loadComponent: () => import('./pages/layout').then(m => m.Layout),
    children: [
      { path: 'inicio', ...pagina([P.VIAJES_VER], () => import('./pages/inicio').then(m => m.Inicio)) },
      { path: 'viajes', ...pagina([P.VIAJES_VER], () => import('./pages/viajes').then(m => m.Viajes)) },
      { path: 'manifiestos', ...pagina([P.RNDC_OPERAR], () => import('./pages/manifiestos').then(m => m.Manifiestos)) },
      { path: 'soporte-interno', ...pagina([P.VIAJES_VER], () => import('./pages/manifiestos').then(m => m.Manifiestos)), data: { permisos: [P.VIAJES_VER], vista: 'soporte' } },
      { path: 'rndc/envios', ...pagina([P.RNDC_OPERAR], () => import('./pages/manifiestos').then(m => m.Manifiestos)), data: { permisos: [P.RNDC_OPERAR], vista: 'historial' } },
      { path: 'rndc/correos', ...pagina([P.RNDC_OPERAR], () => import('./pages/manifiestos').then(m => m.Manifiestos)), data: { permisos: [P.RNDC_OPERAR], vista: 'correos' } },
      { path: 'conductores', ...pagina([P.MAESTROS_VER], () => import('./pages/terceros').then(m => m.Terceros)) },
      { path: 'pago-conductores', ...pagina([P.LIQUIDACION_VER], () => import('./pages/pago-conductores').then(m => m.PagoConductores)) },
      { path: 'contabilidad', ...pagina([P.LIQUIDACION_VER], () => import('./pages/contabilidad').then(m => m.Contabilidad)) },
      { path: 'viajes-empresa', redirectTo: 'viajes' },
      { path: 'monitoreo', ...pagina([P.VIAJES_VER], () => import('./pages/monitoreo').then(m => m.Monitoreo)) },
      { path: 'relaciones', ...pagina([P.VIAJES_VER], () => import('./pages/relaciones').then(m => m.Relaciones)) },
      // El cierre de mes ahora es una pestaña de Contabilidad
      { path: 'cierre-mes', ...pagina([P.CONFIG_GESTIONAR, P.LIQUIDACION_VER], () => import('./pages/contabilidad').then(m => m.Contabilidad)), data: { permisos: [P.CONFIG_GESTIONAR, P.LIQUIDACION_VER], tab: 'cierre' } },
      { path: 'remesas-dulces', ...pagina([P.VIAJES_VER], () => import('./pages/remesas').then(m => m.Remesas)) },
      { path: 'importar', ...pagina([P.MAESTROS_EDITAR, P.TARIFAS_EDITAR, P.CONFIG_GESTIONAR], () => import('./pages/importar').then(m => m.Importar)) },
      { path: 'revision', ...pagina([P.MAESTROS_VER], () => import('./pages/revision').then(m => m.Revision)) },
      { path: 'avisos-conductores', ...pagina([P.NOTIFICACIONES_GESTIONAR], () => import('./pages/avisos-conductores').then(m => m.AvisosConductores)) },
      { path: 'sst/planillas', ...pagina([P.SST_VER], () => import('./pages/sst-planillas').then(m => m.SstPlanillas)) },
      { path: 'sst', redirectTo: 'sst/tablero', pathMatch: 'full' },
      { path: 'sst/tablero', ...pagina([P.SST_VER], () => import('./pages/sst-tablero').then(m => m.SstTablero)) },
      { path: 'sst/colaboradores', ...pagina([P.SST_VER], () => import('./pages/sst-colaboradores').then(m => m.SstColaboradores)) },
      { path: 'sst/flota', ...pagina([P.SST_VER], () => import('./pages/sst-flota').then(m => m.SstFlota)) },
      { path: 'sst/preoperacional', ...pagina([P.SST_VER], () => import('./pages/sst-flota').then(m => m.SstFlota)), data: { permisos: [P.SST_VER], vista: 'inspecciones' } },
      { path: 'sst/capacitaciones', ...pagina([P.SST_VER], () => import('./pages/sst-capacitaciones').then(m => m.SstCapacitaciones)) },
      { path: 'sst/formatos', ...pagina([P.SST_VER], () => import('./pages/sst-formatos').then(m => m.SstFormatos)) },
      { path: 'sst/datos', ...pagina([P.SST_VER], () => import('./pages/sst-datos').then(m => m.SstDatos)) },
      { path: 'vehiculos', ...pagina([P.MAESTROS_VER], () => import('./pages/vehiculos').then(m => m.Vehiculos)) },
      { path: 'clientes', ...pagina([P.MAESTROS_VER], () => import('./pages/clientes').then(m => m.Clientes)) },
      { path: 'liquidaciones', ...pagina([P.LIQUIDACION_VER], () => import('./pages/liquidaciones').then(m => m.Liquidaciones)) },
      { path: 'consultas-rndc', ...pagina([P.RNDC_CONSULTAR], () => import('./pages/consultas-rndc').then(m => m.ConsultasRndc)) },
      { path: 'configuracion', ...pagina([P.CONFIG_GESTIONAR, P.USUARIOS_GESTIONAR], () => import('./pages/configuracion').then(m => m.Configuracion)) },
      { path: 'admin/empresas', ...pagina([P.EMPRESAS_GESTIONAR], () => import('./pages/admin-empresas').then(m => m.AdminEmpresas)) },
      { path: 'admin/whatsapp', ...pagina([P.EMPRESAS_GESTIONAR], () => import('./pages/admin-whatsapp').then(m => m.AdminWhatsapp)) },
      { path: 'admin/app-version', ...pagina([P.EMPRESAS_GESTIONAR], () => import('./pages/admin-app-version').then(m => m.AdminAppVersion)) },
      { path: 'admin/auditoria', ...pagina([P.EMPRESAS_GESTIONAR], () => import('./pages/admin-auditoria').then(m => m.AdminAuditoria)) },
      { path: 'mi-cuenta', loadComponent: () => import('./pages/mi-cuenta').then(m => m.MiCuenta) },
      { path: 'privacidad', loadComponent: () => import('./pages/privacidad').then(m => m.Privacidad) },
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/redirigir').then(m => m.Redirigir) },
    ],
  },
  { path: '**', redirectTo: '' },
];
