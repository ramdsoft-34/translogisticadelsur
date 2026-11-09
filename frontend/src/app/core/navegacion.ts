import { P } from './modelos';

// Mapa de la aplicación: módulos y sus páginas (menú lateral).
// Es la única fuente de la navegación: la usan el menú lateral y el buscador (Ctrl + K).
// `ocultarCon`: la página no se muestra a quien tiene ese permiso (la ve dentro de otra página)
export interface Pagina { ruta: string; texto: string; icono: string; permisos: string[]; descripcion: string; claves?: string; ocultarCon?: string }
export interface Modulo { id: string; nombre: string; icono: string; paginas: Pagina[] }

export const MODULOS: Modulo[] = [
  { id: 'inicio', nombre: 'Inicio', icono: 'inicio', paginas: [
    { ruta: '/inicio', texto: 'Tablero', icono: 'inicio', permisos: [P.VIAJES_VER], descripcion: 'Resumen del día, pendientes y cifras del mes' },
  ] },
  { id: 'operacion', nombre: 'Operación', icono: 'camion', paginas: [
    { ruta: '/viajes', texto: 'Viajes', icono: 'camion', permisos: [P.VIAJES_VER], descripcion: 'Registrar, consultar y exportar viajes', claves: 'registrar viaje whatsapp exportar' },
    { ruta: '/relaciones', texto: 'Programación por placa', icono: 'lista', permisos: [P.VIAJES_VER], descripcion: 'Registro masivo por días, copias y utilidad por placa', claves: 'relaciones masivo' },
    { ruta: '/avisos-conductores', texto: 'Avisos a conductores', icono: 'enviar', permisos: [P.NOTIFICACIONES_GESTIONAR], descripcion: 'Mensajes al celular de los conductores con la app y avisos automáticos', claves: 'notificacion push mensaje recordatorio app' },
    { ruta: '/monitoreo', texto: 'Monitoreo', icono: 'ubicacion', permisos: [P.VIAJES_VER], descripcion: 'Rastreo GPS en vivo e historial de recorridos', claves: 'rastreo gps sur track mapa' },
  ] },
  { id: 'documentos', nombre: 'Documentos', icono: 'documento', paginas: [
    { ruta: '/manifiestos', texto: 'Manifiestos', icono: 'documento', permisos: [P.RNDC_OPERAR], descripcion: 'Expedir, cumplir y anular remesas y manifiestos, y el soporte interno', claves: 'remesa expedir cumplido anular rndc soporte interno mc rc' },
    // Quien opera manifiestos lo tiene como pestaña dentro de «Manifiestos»
    { ruta: '/soporte-interno', texto: 'Soporte interno', icono: 'documento', permisos: [P.VIAJES_VER], descripcion: 'Viajes sin manifiesto con su soporte MC/RC y QR', claves: 'mc rc qr', ocultarCon: P.RNDC_OPERAR },
    { ruta: '/remesas-dulces', texto: 'Remesas', icono: 'documento', permisos: [P.VIAJES_VER], descripcion: 'Base de viajes del cliente (VPL), consecutivo de remesas e impresión con el formato de la empresa', claves: 'vpl remesas imprimir dulces consecutivo' },
  ] },
  { id: 'finanzas', nombre: 'Finanzas', icono: 'dinero', paginas: [
    { ruta: '/liquidaciones', texto: 'Facturación a clientes', icono: 'dinero', permisos: [P.LIQUIDACION_VER], descripcion: 'Liquidar los viajes de cada cliente para facturar', claves: 'liquidacion fletes cobro' },
    { ruta: '/pago-conductores', texto: 'Pago a conductores', icono: 'personas', permisos: [P.LIQUIDACION_VER], descripcion: 'Liquidaciones, préstamos, descuentos y relación de pago', claves: 'prestamo descuento abono' },
    { ruta: '/contabilidad', texto: 'Contabilidad', icono: 'lista', permisos: [P.LIQUIDACION_VER], descripcion: 'Libro diario, facturas, cuentas por pagar, informes y cierre de mes', claves: 'factura asiento cierre balance' },
  ] },
  { id: 'sst', nombre: 'SG-SST y PESV', icono: 'escudo', paginas: [
    { ruta: '/sst/tablero', texto: 'Tablero SST y PESV', icono: 'escudo', permisos: [P.SST_VER], descripcion: 'Vencimientos, preoperacional de hoy, capacitaciones e indicadores', claves: 'sst pesv tablero indicadores seguridad salud vial' },
    { ruta: '/sst/planes', texto: 'Autoevaluación y planes', icono: 'lista', permisos: [P.SST_VER], descripcion: 'Los 60 estándares mínimos con puntaje, plan de mejora, plan anual y alertas del Ministerio, la ARL y el PESV', claves: 'autoevaluacion estandares minimos 0312 plan de mejora plan anual alertas arl mintrabajo' },
    { ruta: '/sst/colaboradores', texto: 'Colaboradores', icono: 'personas', permisos: [P.SST_VER], descripcion: 'Perfil de SST de cada persona: exámenes, EPP, comparendos y capacitaciones', claves: 'colaborador empleado epp examen comparendo' },
    { ruta: '/sst/flota', texto: 'Flota e inspecciones', icono: 'camion', permisos: [P.SST_VER], descripcion: 'Hoja de vida, pólizas, mantenimiento y preoperacionales', claves: 'mantenimiento hoja de vida poliza kilometraje inspeccion' },
    { ruta: '/sst/capacitaciones', texto: 'Capacitaciones', icono: 'lista', permisos: [P.SST_VER], descripcion: 'Programa anual con asistencia firmada', claves: 'capacitacion induccion asistencia programa' },
    { ruta: '/sst/formatos', texto: 'Formatos', icono: 'documento', permisos: [P.SST_VER], descripcion: 'Formatos con membrete, actas, Word y Excel propios y reportes de incidentes', claves: 'formato acta simulacro incidente epp inspeccion' },
    { ruta: '/sst/datos', texto: 'Datos y membrete', icono: 'edificio', permisos: [P.SST_VER], descripcion: 'Responsables, ARL, clase de riesgo, autoevaluación y membrete', claves: 'membrete responsable arl riesgo autoevaluacion' },
    { ruta: '/sst/preoperacional', texto: 'Preoperacional', icono: 'check', permisos: [P.SST_VER], descripcion: 'Inspecciones preoperacionales de los conductores', claves: 'preoperacional checklist no apto' },
    { ruta: '/sst/planillas', texto: 'Planillas', icono: 'documento', permisos: [P.SST_VER], descripcion: 'Planilla de seguridad social de cada conductor, mes a mes', claves: 'seguridad social eps arl pila planilla' },
  ] },
  { id: 'datos', nombre: 'Datos', icono: 'edificio', paginas: [
    { ruta: '/clientes', texto: 'Clientes y tarifas', icono: 'edificio', permisos: [P.MAESTROS_VER], descripcion: 'Clientes (remitentes), sus sedes y destinos con tarifa', claves: 'destino tarifa sede remitente destinatario' },
    { ruta: '/conductores', texto: 'Conductores y terceros', icono: 'personas', permisos: [P.MAESTROS_VER], descripcion: 'Conductores, titulares, tenedores y empresas', claves: 'cedula licencia tercero' },
    { ruta: '/vehiculos', texto: 'Vehículos', icono: 'camion', permisos: [P.MAESTROS_VER], descripcion: 'Placas, SOAT, tecnomecánica y propietarios', claves: 'placa soat tecnomecanica' },
    { ruta: '/revision', texto: 'Revisión de datos', icono: 'alerta', permisos: [P.MAESTROS_VER], descripcion: 'Datos por corregir antes de expedir' },
    { ruta: '/importar', texto: 'Importar datos', icono: 'descargar', permisos: [P.MAESTROS_EDITAR, P.TARIFAS_EDITAR, P.CONFIG_GESTIONAR], descripcion: 'Cargas desde Excel: terceros, vehículos, tarifas y plantilla de viajes', claves: 'excel plantilla cargar' },
  ] },
  { id: 'rndc', nombre: 'RNDC', icono: 'enviar', paginas: [
    { ruta: '/consultas-rndc', texto: 'Consultas', icono: 'buscar', permisos: [P.RNDC_CONSULTAR], descripcion: 'Lo que el RNDC tiene registrado para la empresa' },
    { ruta: '/rndc/envios', texto: 'Envíos', icono: 'enviar', permisos: [P.RNDC_OPERAR], descripcion: 'Historial de envíos al RNDC y sus respuestas', claves: 'historial transacciones radicado' },
    { ruta: '/rndc/correos', texto: 'Correos', icono: 'correo', permisos: [P.RNDC_OPERAR], descripcion: 'Manifiestos y cartas de salida enviados a clientes' },
    { ruta: '/whatsapp/mensajes', texto: 'Mensajes de WhatsApp', icono: 'enviar', permisos: [P.RNDC_OPERAR, P.CONFIG_GESTIONAR], descripcion: 'Manifiestos y soportes enviados al WhatsApp de los conductores: entregados y leídos', claves: 'whatsapp conductor entregado leido visto mensajes' },
  ] },
  { id: 'empresa', nombre: 'Empresa', icono: 'ajustes', paginas: [
    { ruta: '/configuracion', texto: 'Configuración', icono: 'ajustes', permisos: [P.CONFIG_GESTIONAR, P.USUARIOS_GESTIONAR], descripcion: 'Conexión RNDC, correo, usuarios, importación y auditoría', claves: 'usuarios correo auditoria importar logo soporte' },
    { ruta: '/admin/empresas', texto: 'Empresas', icono: 'edificio', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Empresas de la plataforma' },
    { ruta: '/admin/whatsapp', texto: 'WhatsApp', icono: 'enviar', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Número de Translogística y mensajes enviados por empresa', claves: 'whatsapp meta consumo' },
    { ruta: '/admin/app-version', texto: 'Versión de la app', icono: 'enviar', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Avisos de actualización de Sur Track para toda la plataforma', claves: 'version actualizar play store app' },
    { ruta: '/admin/auditoria', texto: 'Auditoría global', icono: 'escudo', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Registro de actividad de toda la plataforma' },
  ] },
];

// Páginas que no están en el menú pero tienen un módulo (para marcar dónde está el usuario)
export const OTRAS: Record<string, string> = { '/cierre-mes': 'finanzas', '/mi-cuenta': '', '/privacidad': '' };
