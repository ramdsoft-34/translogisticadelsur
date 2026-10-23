import { Routes } from '@angular/router';
import { conPermiso, conSesion, sinSesion } from './core/guards';
import { P } from './core/modelos';

const pagina = (permisos: string[], cargar: () => Promise<any>) => ({ canActivate: [conPermiso], data: { permisos }, loadComponent: cargar });

export const routes: Routes = [
  // Pública: el QR del soporte interno lleva aquí
  { path: 'verificar/:codigo', loadComponent: () => import('./pages/verificar').then(m => m.Verificar) },
  { path: 'ingresar', canActivate: [sinSesion], loadComponent: () => import('./pages/ingresar').then(m => m.Ingresar) },
  {
    path: '', canActivate: [conSesion], loadComponent: () => import('./pages/layout').then(m => m.Layout),
    children: [
      { path: 'inicio', ...pagina([P.VIAJES_VER], () => import('./pages/inicio').then(m => m.Inicio)) },
      { path: 'viajes', ...pagina([P.VIAJES_VER], () => import('./pages/viajes').then(m => m.Viajes)) },
      { path: 'manifiestos', ...pagina([P.RNDC_OPERAR], () => import('./pages/manifiestos').then(m => m.Manifiestos)) },
      { path: 'conductores', ...pagina([P.MAESTROS_VER], () => import('./pages/terceros').then(m => m.Terceros)) },
      { path: 'pago-conductores', ...pagina([P.LIQUIDACION_VER], () => import('./pages/pago-conductores').then(m => m.PagoConductores)) },
      { path: 'contabilidad', ...pagina([P.LIQUIDACION_VER], () => import('./pages/contabilidad').then(m => m.Contabilidad)) },
      { path: 'viajes-empresa', redirectTo: 'viajes' },
      { path: 'monitoreo', ...pagina([P.VIAJES_VER], () => import('./pages/monitoreo').then(m => m.Monitoreo)) },
      { path: 'relaciones', ...pagina([P.VIAJES_VER], () => import('./pages/relaciones').then(m => m.Relaciones)) },
      { path: 'cierre-mes', ...pagina([P.CONFIG_GESTIONAR, P.LIQUIDACION_VER], () => import('./pages/gestion-varios').then(m => m.CierreMes)) },
      { path: 'remesas-dulces', ...pagina([P.VIAJES_REGISTRAR], () => import('./pages/gestion-varios').then(m => m.RemesasDulces)) },
      { path: 'revision', ...pagina([P.MAESTROS_VER], () => import('./pages/revision').then(m => m.Revision)) },
      { path: 'vehiculos', ...pagina([P.MAESTROS_VER], () => import('./pages/vehiculos').then(m => m.Vehiculos)) },
      { path: 'clientes', ...pagina([P.MAESTROS_VER], () => import('./pages/clientes').then(m => m.Clientes)) },
      { path: 'liquidaciones', ...pagina([P.LIQUIDACION_VER], () => import('./pages/liquidaciones').then(m => m.Liquidaciones)) },
      { path: 'consultas-rndc', ...pagina([P.RNDC_CONSULTAR], () => import('./pages/consultas-rndc').then(m => m.ConsultasRndc)) },
      { path: 'configuracion', ...pagina([P.CONFIG_GESTIONAR, P.USUARIOS_GESTIONAR], () => import('./pages/configuracion').then(m => m.Configuracion)) },
      { path: 'admin/empresas', ...pagina([P.EMPRESAS_GESTIONAR], () => import('./pages/admin-empresas').then(m => m.AdminEmpresas)) },
      { path: 'admin/auditoria', ...pagina([P.EMPRESAS_GESTIONAR], () => import('./pages/admin-auditoria').then(m => m.AdminAuditoria)) },
      { path: 'mi-cuenta', loadComponent: () => import('./pages/mi-cuenta').then(m => m.MiCuenta) },
      { path: 'privacidad', loadComponent: () => import('./pages/privacidad').then(m => m.Privacidad) },
      { path: '', pathMatch: 'full', loadComponent: () => import('./pages/redirigir').then(m => m.Redirigir) },
    ],
  },
  { path: '**', redirectTo: '' },
];
