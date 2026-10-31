// Roles y permisos. Los permisos se revisan en cada ruta con `permitir(...)`.
// El SuperAdmin es el único rol global (sin empresa): administra empresas y
// sus administradores, pero no opera los datos internos de ninguna empresa.

export const ROLES = {
  superadmin:  'SuperAdmin',
  admin:       'Administrador',
  reportero:   'Reportero de viajes',
  manifiestos: 'Responsable de manifiestos',
  contabilidad:'Contabilidad',
  consulta:    'Consulta',
};

export const P = {
  EMPRESAS_GESTIONAR: 'empresas.gestionar',       // solo SuperAdmin
  USUARIOS_GESTIONAR: 'usuarios.gestionar',
  CONFIG_GESTIONAR:   'config.gestionar',
  AUDITORIA_VER:      'auditoria.ver',
  VIAJES_VER:         'viajes.ver',
  VIAJES_REGISTRAR:   'viajes.registrar',
  VIAJES_EDITAR_TODOS:'viajes.editarTodos',
  MAESTROS_VER:       'maestros.ver',
  MAESTROS_EDITAR:    'maestros.editar',
  TARIFAS_EDITAR:     'tarifas.editar',
  RNDC_OPERAR:        'rndc.operar',              // remesas, manifiestos, cumplidos, anulaciones
  RNDC_CONSULTAR:     'rndc.consultar',
  LIQUIDACION_VER:    'liquidacion.ver',
  LIQUIDACION_GESTIONAR: 'liquidacion.gestionar',
  REPORTES_VER:       'reportes.ver',
  CONTABILIDAD_VER:   'contabilidad.ver',         // libros, informes y plan de cuentas
  CONTABILIDAD_GESTIONAR: 'contabilidad.gestionar', // facturar, cobrar, pagar, asientos, saldos iniciales y parámetros
  // Nómina: datos personales y salarios de los empleados (Ley 1581 de 2012). Aparte de la contabilidad para que
  // el rol de consulta, que ve los libros, no vea salarios, cuentas bancarias ni desprendibles.
  NOMINA_VER:         'nomina.ver',
  NOMINA_GESTIONAR:   'nomina.gestionar',
};

const TODOS_EMPRESA = Object.values(P).filter(p => p !== P.EMPRESAS_GESTIONAR);

export const PERMISOS_POR_ROL = {
  superadmin: [P.EMPRESAS_GESTIONAR, P.AUDITORIA_VER],
  admin: TODOS_EMPRESA,
  reportero: [P.VIAJES_VER, P.VIAJES_REGISTRAR, P.MAESTROS_VER],
  manifiestos: [P.VIAJES_VER, P.VIAJES_REGISTRAR, P.VIAJES_EDITAR_TODOS, P.MAESTROS_VER, P.MAESTROS_EDITAR,
    P.RNDC_OPERAR, P.RNDC_CONSULTAR, P.REPORTES_VER],
  contabilidad: [P.VIAJES_VER, P.MAESTROS_VER, P.TARIFAS_EDITAR, P.LIQUIDACION_VER, P.LIQUIDACION_GESTIONAR,
    P.REPORTES_VER, P.RNDC_CONSULTAR, P.CONTABILIDAD_VER, P.CONTABILIDAD_GESTIONAR, P.NOMINA_VER, P.NOMINA_GESTIONAR],
  consulta: [P.VIAJES_VER, P.MAESTROS_VER, P.LIQUIDACION_VER, P.REPORTES_VER, P.CONTABILIDAD_VER],
};

export const ROLES_EMPRESA = Object.keys(ROLES).filter(r => r !== 'superadmin');
// Solo hay un SuperAdmin en la plataforma y un Administrador por empresa (lo crea el SuperAdmin);
// el Administrador de la empresa asigna únicamente los demás roles.
export const ROLES_ASIGNABLES = ROLES_EMPRESA.filter(r => r !== 'admin');

export const permisosDe = (rol) => PERMISOS_POR_ROL[rol] || [];
export const tienePermiso = (rol, permiso) => permisosDe(rol).includes(permiso);
