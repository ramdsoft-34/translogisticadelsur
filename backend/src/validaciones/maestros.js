// Reglas de validación de los maestros. Las usan los formularios (API) y la
// importación desde Excel, para que ambos caminos apliquen exactamente lo mismo.
import { z } from 'zod';
import { parseFecha, soloDigitos } from '../utils/texto.js';
import { TIPOS_ID, TIPOS_ID_CONDUCTOR } from '../services/rndc/catalogos.js';

export const t = (max = 200) => z.string().trim().max(max).optional().default('');
export const fechaOpc = z.union([z.string(), z.date(), z.null()]).optional().transform(v => (v ? parseFecha(v) : null));
export const numOpc = z.union([z.number(), z.string(), z.null()]).optional()
  .transform(v => (v === '' || v === null || v === undefined ? null : Number(v)))
  .refine(v => v === null || Number.isFinite(v), 'debe ser numérico');
export const dinero = z.coerce.number().min(0).optional().default(0);
export const digitos = (max) => z.string().trim().optional().default('').transform(soloDigitos).pipe(z.string().max(max, `máximo ${max} dígitos`));
export const tipoId = z.enum(Object.keys(TIPOS_ID));
export const divipola = z.string().trim().regex(/^(\d{8})?$/, 'código DIVIPOLA de 8 dígitos').optional().default('');

export const clienteSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  tipoId: tipoId.optional().default('N'),
  nit: z.string().trim().transform(soloDigitos).pipe(z.string().max(15)).optional().default(''),
  dv: t(1), razonSocial: t(150), sedeRemitente: t(6),
  correos: z.array(z.string().trim().toLowerCase().email()).max(20).optional().default([]),
  whatsapp: z.string().trim().optional().default('').transform(soloDigitos).pipe(z.string().max(13, 'número de WhatsApp inválido')),
  activo: z.boolean().optional(),
});

export const tarifaSchema = z.object({
  cliente: z.string().min(1),
  destino: z.string().trim().min(2).max(120),
  codMunicipio: divipola,
  tipoCobro: z.enum(['viaje', 'unidad']).optional().default('viaje'),
  tarifaCliente: dinero, tarifaAuxiliar: dinero, fleteConductor: dinero, auxiliarPagado: dinero,
  anticipoHabitual: dinero, pesoKg: dinero,
  operacion: z.string().trim().max(1).toUpperCase().optional().default(''),
  destinatario: z.object({ tipoId: z.union([tipoId, z.literal('')]).optional().default(''), numId: t(15), sede: t(6) }).optional(),
  activo: z.boolean().optional(),
});

export const ROLES_TERCERO = ['conductor', 'propietario', 'tenedor', 'titular', 'remitente', 'destinatario'];
export const terceroSchema = z.object({
  tipoId,
  numId: z.string().trim().transform(v => v.replace(/[.\s,-]/g, '')).pipe(z.string().min(5, 'mínimo 5 dígitos').max(15)),
  nombres: z.string().trim().min(2).max(100),
  apellido1: t(100), apellido2: t(100),
  sede: z.object({ codigo: t(6), nombre: t(20) }).optional(),
  telefono: digitos(7), celular: digitos(10),
  direccion: t(60), codMunicipio: divipola,
  correo: z.string().trim().toLowerCase().email().or(z.literal('')).optional().default(''),
  licencia: z.object({ categoria: t(3), numero: t(15), vence: fechaOpc }).optional(),
  fechaNacimiento: fechaOpc,
  banco: z.object({ entidad: t(60), tipoCuenta: t(20), cuenta: t(30) }).optional(),
  roles: z.array(z.enum(ROLES_TERCERO)).optional().default([]),
  activo: z.boolean().optional(),
}).superRefine((d, ctx) => {
  if (d.tipoId === 'N' && d.numId.length > 10) ctx.addIssue({ path: ['numId'], code: 'custom', message: 'NIT de máximo 10 dígitos (incluye dígito de verificación)' });
  if (d.tipoId !== 'N' && !d.apellido1) ctx.addIssue({ path: ['apellido1'], code: 'custom', message: 'obligatorio para personas naturales' });
  if (d.roles.includes('conductor') && !TIPOS_ID_CONDUCTOR.includes(d.tipoId)) {
    ctx.addIssue({ path: ['tipoId'], code: 'custom', message: 'un conductor debe tener cédula de ciudadanía, de extranjería o NUIP' });
  }
});

const idT = z.object({ tipoId: z.union([tipoId, z.literal('')]).optional().default(''), numId: t(15) });
export const placa = z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida'));
export const vehiculoSchema = z.object({
  placa,
  clase: z.enum(['vehiculo', 'remolque']).optional().default('vehiculo'),
  configuracion: t(2), configuracionNombre: t(4).transform(v => v.toUpperCase()), marcaNombre: t(40), aseguradoraSoat: t(60),
  marca: t(10), linea: t(10), ejes: numOpc, modelo: numOpc, color: t(5),
  carroceria: t(3), combustible: t(2), pesoVacio: numOpc, capacidad: numOpc, pbv: numOpc, unidadMedida: t(1),
  soat: z.object({ numero: t(20), vence: fechaOpc, aseguradoraNit: t(11) }).optional(),
  venceTecnomecanica: fechaOpc,
  propietario: idT.optional(), tenedor: idT.optional(),
  conductorHabitual: z.string().nullable().optional(),
  titularHabitual: z.string().nullable().optional(),
  activo: z.boolean().optional(),
});

// Dígito de verificación de un NIT (algoritmo de la DIAN, factores primos).
export function digitoVerificacion(nit) {
  const d = soloDigitos(nit);
  if (!d || d.length > 15) return '';
  const factores = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let suma = 0;
  for (let i = 0; i < d.length; i++) suma += Number(d[d.length - 1 - i]) * factores[i];
  const r = suma % 11;
  return String(r > 1 ? 11 - r : r);
}
