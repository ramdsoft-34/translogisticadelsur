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
    { ruta: '/remesas-dulces', texto: 'Remesas', icono: 'documento', permisos: [P.VIAJES_REGISTRAR], descripcion: 'Remesas desde la base de viajes en Excel (VPL), dos por hoja', claves: 'vpl remesas imprimir' },
  ] },
  { id: 'finanzas', nombre: 'Finanzas', icono: 'dinero', paginas: [
    { ruta: '/liquidaciones', texto: 'Facturación a clientes', icono: 'dinero', permisos: [P.LIQUIDACION_VER], descripcion: 'Liquidar los viajes de cada cliente para facturar', claves: 'liquidacion fletes cobro' },
    { ruta: '/pago-conductores', texto: 'Pago a conductores', icono: 'personas', permisos: [P.LIQUIDACION_VER], descripcion: 'Liquidaciones, préstamos, descuentos y relación de pago', claves: 'prestamo descuento abono' },
    { ruta: '/contabilidad', texto: 'Contabilidad', icono: 'lista', permisos: [P.CONTABILIDAD_VER], descripcion: 'Facturas, cobros, pagos, libros, auxiliares, saldos iniciales y cierre de mes', claves: 'factura asiento cierre balance' },
  ] },
  { id: 'datos', nombre: 'Datos', icono: 'edificio', paginas: [
    { ruta: '/clientes', texto: 'Clientes y tarifas', icono: 'edificio', permisos: [P.MAESTROS_VER], descripcion: 'Clientes, destinos, tarifas y sedes de descargue', claves: 'destino tarifa sede' },
    { ruta: '/conductores', texto: 'Conductores y terceros', icono: 'personas', permisos: [P.MAESTROS_VER], descripcion: 'Conductores, titulares, tenedores y empresas', claves: 'cedula licencia tercero' },
    { ruta: '/vehiculos', texto: 'Vehículos', icono: 'camion', permisos: [P.MAESTROS_VER], descripcion: 'Placas, SOAT, tecnomecánica y propietarios', claves: 'placa soat tecnomecanica' },
    { ruta: '/revision', texto: 'Revisión de datos', icono: 'alerta', permisos: [P.MAESTROS_VER], descripcion: 'Datos por corregir antes de expedir' },
    { ruta: '/importar', texto: 'Importar datos', icono: 'descargar', permisos: [P.MAESTROS_EDITAR, P.TARIFAS_EDITAR, P.CONFIG_GESTIONAR], descripcion: 'Cargas desde Excel: terceros, vehículos, tarifas y plantilla de viajes', claves: 'excel plantilla cargar' },
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
