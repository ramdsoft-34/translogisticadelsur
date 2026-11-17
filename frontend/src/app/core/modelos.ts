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
  SST_VER: 'sst.ver',
  SST_GESTIONAR: 'sst.gestionar',
  NOTIFICACIONES_GESTIONAR: 'notificaciones.gestionar',
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

// Nombre completo sin repetir los apellidos que algunos registros traen también dentro de «nombres»
// («NARVAEZ GALLARDO HENRY ARMANDO» + «NARVAEZ GALLARDO» → «HENRY ARMANDO NARVAEZ GALLARDO»). Igual que backend/src/utils/nombres.js.
const limpioNombre = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const claveNombre = (s: string) => limpioNombre(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
export function nombresSinApellidos(nombres: unknown, apellido1: unknown, apellido2: unknown) {
  const n = limpioNombre(nombres).split(' ').filter(Boolean);
  const ap = [apellido1, apellido2].map(limpioNombre).filter(Boolean).join(' ').split(' ').filter(Boolean);
  if (!ap.length || n.length <= ap.length) return limpioNombre(nombres);
  const igual = (desde: number) => ap.every((w, i) => claveNombre(n[desde + i]) === claveNombre(w));
  if (igual(0)) return n.slice(ap.length).join(' ');
  if (igual(n.length - ap.length)) return n.slice(0, n.length - ap.length).join(' ');
  return limpioNombre(nombres);
}
export const nombreTercero = (t: any) => (t ? [nombresSinApellidos(t.nombres, t.apellido1, t.apellido2), limpioNombre(t.apellido1), limpioNombre(t.apellido2)].filter(Boolean).join(' ') : '');
