export interface Usuario {
  id: string; nombre: string; email: string; rol: string; rolNombre: string;
  permisos: string[]; debeCambiarClave: boolean; dobleFactor?: boolean;
  empresa: { id: string; nombre: string; nit: string; dv: string; ambienteRndc: string } | null;
}

export const P = {
  EMPRESAS_GESTIONAR: 'empresas.gestionar',
  USUARIOS_GESTIONAR: 'usuarios.gestionar',
  CONFIG_GESTIONAR: 'config.gestionar',
  AUDITORIA_VER: 'auditoria.ver',
  VIAJES_VER: 'viajes.ver',
  VIAJES_REGISTRAR: 'viajes.registrar',
  VIAJES_EDITAR_TODOS: 'viajes.editarTodos',
  MAESTROS_VER: 'maestros.ver',
  MAESTROS_EDITAR: 'maestros.editar',
  TARIFAS_EDITAR: 'tarifas.editar',
  RNDC_OPERAR: 'rndc.operar',
  RNDC_CONSULTAR: 'rndc.consultar',
  LIQUIDACION_VER: 'liquidacion.ver',
  LIQUIDACION_GESTIONAR: 'liquidacion.gestionar',
  REPORTES_VER: 'reportes.ver',
  CONTABILIDAD_VER: 'contabilidad.ver',
  CONTABILIDAD_GESTIONAR: 'contabilidad.gestionar',
  NOMINA_VER: 'nomina.ver',
  NOMINA_GESTIONAR: 'nomina.gestionar',
} as const;

export interface DocRndc { numero: string; radicado: string; qr?: string; fecha: string | null; estado: '' | 'aceptado' | 'rechazado' | 'anulado'; mensaje: string }

export interface Viaje {
  _id: string; numero: number; fecha: string; destino: string; placa: string; remolque: string;
  cliente: { _id: string; nombre: string } | null; conductor: any; titular: any; tarifaRef: any;
  conductorNombre: string; titularNombre: string;
  codOrigen: string; codDestino: string; destinatario: { tipoId: string; numId: string; sede: string };
  pesoKg: number; cantidad: number; conAuxiliar: boolean; diasAuxiliar?: number; planilla?: string; rastreo?: { activo: boolean; estado: string; codigoExterno?: string; externoId?: string }; tarifa: number; flete: number; anticipo: number;
  saldo: number; utilidad: number; observaciones: string;
  estado: 'registrado' | 'remesa' | 'manifestado' | 'cumplido' | 'anulado';
  remesa: DocRndc; manifiesto: DocRndc; cumplidoRemesa: DocRndc; cumplidoManifiesto: DocRndc;
  liquidacion: string | null; manifiestoReemplazado?: string; creadoPor: string;
  historico?: boolean; reporteWhatsapp?: { fecha: string | null }; requiereManifiesto?: boolean; origen?: 'viajes' | 'manifiesto';
}

export const ESTADOS_VIAJE: Record<string, string> = {
  registrado: 'Registrado', remesa: 'Remesa expedida', manifestado: 'Manifestado', cumplido: 'Cumplido', anulado: 'Anulado',
};

export const TIPOS_ID: Record<string, string> = {
  C: 'Cédula de ciudadanía', N: 'NIT', P: 'Pasaporte', E: 'Cédula de extranjería', T: 'Tarjeta de identidad', U: 'NUIP',
};

export const nombreTercero = (t: any) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
