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
    { ruta: '/contabilidad', texto: 'Contabilidad', icono: 'lista', permisos: [P.CONTABILIDAD_VER], descripcion: 'Facturas, cobros, pagos, libros, auxiliares, saldos iniciales y cierre de mes', claves: 'factura asiento cierre balance' },
  ] },
  { id: 'datos', nombre: 'Datos', icono: 'edificio', paginas: [
    { ruta: '/clientes', texto: 'Clientes y tarifas', icono: 'edificio', permisos: [P.MAESTROS_VER], descripcion: 'Clientes (remitentes), sus sedes y destinos con tarifa', claves: 'destino tarifa sede remitente destinatario' },
    { ruta: '/conductores', texto: 'Conductores y terceros', icono: 'personas', permisos: [P.MAESTROS_VER], descripcion: 'Conductores, titulares, tenedores y empresas', claves: 'cedula licencia tercero' },
    { ruta: '/vehiculos', texto: 'Vehículos', icono: 'camion', permisos: [P.MAESTROS_VER], descripcion: 'Placas, SOAT, tecnomecánica y propietarios', claves: 'placa soat tecnomecanica' },
    { ruta: '/revision', texto: 'Revisión de datos', icono: 'alerta', permisos: [P.MAESTROS_VER], descripcion: 'Datos por corregir antes de expedir' },
    { ruta: '/importar', texto: 'Importar datos', icono: 'descargar', permisos: [P.MAESTROS_EDITAR, P.TARIFAS_EDITAR, P.CONFIG_GESTIONAR], descripcion: 'Cargas desde Excel: terceros, vehículos, tarifas y plantilla de viajes', claves: 'excel plantilla cargar' },
  ] },
  { id: 'sst', nombre: 'SG-SST y PESV', icono: 'escudo', paginas: [
    { ruta: '/sst', texto: 'Tablero SST y PESV', icono: 'escudo', permisos: [P.SST_VER, P.SST_GESTIONAR], descripcion: 'Vencimientos, checklists del día, indicadores del PESV con Sur Track y capacitaciones', claves: 'sg-sst pesv seguridad vial salud trabajo 0312 40595 velocidad fatiga' },
    { ruta: '/sst/planes', texto: 'Autoevaluación y planes', icono: 'lista', permisos: [P.SST_VER, P.SST_GESTIONAR], descripcion: 'Estándares mínimos con puntaje, plan de mejora, plan anual y alertas del Ministerio y la ARL', claves: 'autoevaluacion estandares minimos 0312 plan de mejora plan anual alertas arl ministerio pesv' },
    { ruta: '/sst/preoperacionales', texto: 'Preoperacionales', icono: 'check', permisos: [P.SST_VER, P.SST_GESTIONAR], descripcion: 'Checklists de Sur Track guardados, no aptos y PDF para auditoría', claves: 'checklist sur track inspeccion apto' },
    { ruta: '/sst/planillas', texto: 'Planillas', icono: 'documento', permisos: [P.SST_VER], descripcion: 'Planilla de seguridad social de cada conductor, mes a mes', claves: 'seguridad social eps arl pila planilla' },
    { ruta: '/sst/personas', texto: 'Personas', icono: 'personas', permisos: [P.SST_VER, P.SST_GESTIONAR], descripcion: 'Conductores y empleados: exámenes, EPP, comparendos y checklists', claves: 'examen medico epp comparendo conductor trabajador' },
    { ruta: '/sst/capacitaciones', texto: 'Capacitaciones', icono: 'lista', permisos: [P.SST_VER, P.SST_GESTIONAR], descripcion: 'Programa anual y asistencia con firmas', claves: 'cronograma asistencia induccion' },
    { ruta: '/sst/formatos', texto: 'Formatos', icono: 'documento', permisos: [P.SST_VER, P.SST_GESTIONAR], descripcion: 'Formatos con auto-llenado, firmas y membrete; Word y Excel propios', claves: 'acta plantilla membrete word excel firma' },
    { ruta: '/sst/empresa', texto: 'Datos y membrete', icono: 'edificio', permisos: [P.SST_GESTIONAR], descripcion: 'Representante legal, ARL, clase de riesgo, nivel PESV, fatiga y membrete', claves: 'membrete logo encabezado pie arl riesgo' },
    { ruta: '/admin/sst', texto: 'SST de las empresas', icono: 'escudo', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Cumplimiento y vencimientos de cada empresa (cifras)' },
  ] },
  { id: 'rndc', nombre: 'RNDC', icono: 'enviar', paginas: [
    { ruta: '/consultas-rndc', texto: 'Consultas', icono: 'buscar', permisos: [P.RNDC_CONSULTAR], descripcion: 'Lo que el RNDC tiene registrado para la empresa' },
    { ruta: '/rndc/envios', texto: 'Envíos', icono: 'enviar', permisos: [P.RNDC_OPERAR], descripcion: 'Historial de envíos al RNDC y sus respuestas', claves: 'historial transacciones radicado' },
    { ruta: '/rndc/correos', texto: 'Correos', icono: 'correo', permisos: [P.RNDC_OPERAR], descripcion: 'Manifiestos y cartas de salida enviados a clientes' },
  ] },
  { id: 'empresa', nombre: 'Empresa', icono: 'ajustes', paginas: [
    { ruta: '/configuracion', texto: 'Configuración', icono: 'ajustes', permisos: [P.CONFIG_GESTIONAR, P.USUARIOS_GESTIONAR], descripcion: 'Conexión RNDC, correo, usuarios, importación y auditoría', claves: 'usuarios correo auditoria importar logo soporte' },
    { ruta: '/admin/empresas', texto: 'Empresas', icono: 'edificio', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Empresas de la plataforma' },
    { ruta: '/admin/auditoria', texto: 'Auditoría global', icono: 'escudo', permisos: [P.EMPRESAS_GESTIONAR], descripcion: 'Registro de actividad de toda la plataforma' },
  ] },
];

// Páginas que no están en el menú pero tienen un módulo (para marcar dónde está el usuario)
export const OTRAS: Record<string, string> = { '/cierre-mes': 'finanzas', '/mi-cuenta': '', '/privacidad': '' };
