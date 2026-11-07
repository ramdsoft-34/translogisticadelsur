// Fase 13: autoevaluación de estándares mínimos y plan anual de trabajo (SG-SST y PESV). Todo es de una empresa (tenantPlugin).
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';

const { Schema } = mongoose;
const modelo = (n, s) => mongoose.models[n] || mongoose.model(n, s);
const str = (o = {}) => ({ type: String, trim: true, default: '', ...o });
const fecha = { type: Date, default: null };
const num = { type: Number, default: null };
const usuario = { type: Schema.Types.ObjectId, ref: 'Usuario', default: null };

// ── Fase 13: autoevaluación de estándares mínimos (Res. 0312) ──
// Una por vigencia. La plataforma calcula el puntaje con la calificación que da el responsable a cada ítem.
// soloTotal: una evaluación anterior de la que solo se conoce el puntaje (p. ej. la de 2022 en ALISSTA).
const autoevaluacionSchema = new Schema({
  vigencia: { type: Number, required: true },
  fecha: { type: Date, required: true },
  origen: str({ enum: ['plataforma', 'alissta', 'excel'], default: 'plataforma' }),
  soloTotal: { type: Boolean, default: false },
  totalRegistrado: num,
  items: [{ _id: false, numeral: str(), estado: str({ enum: ['', 'C', 'NC', 'NA'] }), justificacion: str() }],
  estado: str({ enum: ['borrador', 'cerrada'], default: 'borrador' }),
  cerradaEn: fecha, cerradaPor: usuario,
  resultado: { total: num, nivel: str() },           // se guarda al cerrar (el detalle se recalcula siempre)
  reporteArl: { fecha, consecutivo: str() },          // acuse de la ARL (en ALISSTA: «Reportar ARL»)
  recomendacionesArl: { fecha, resumen: str() },
  creadoPor: usuario, actualizadoPor: usuario,
}, { timestamps: true });
autoevaluacionSchema.plugin(tenantPlugin);
autoevaluacionSchema.index({ empresa: 1, vigencia: 1 }, { unique: true });

// ── Fase 13: actividades del plan anual de trabajo ──
// origen: norma (calendario del Ministerio del Trabajo, ARL, MinTransporte y Supertransporte), mejora (plan de
// mejoramiento que sale de la autoevaluación) o propia. clave evita repetir la misma obligación del mismo periodo.
const actividadSchema = new Schema({
  anio: { type: Number, required: true },
  origen: str({ enum: ['norma', 'mejora', 'propia'], required: true }),
  clave: str(),
  numeral: str(),                                      // ítem de la Res. 0312 (plan de mejora)
  titulo: str({ required: true }), detalle: str(),
  entidad: str({ enum: ['MinTrabajo', 'ARL', 'MinTransporte', 'Supertransporte', 'Interno'], default: 'Interno' }),
  norma: str(), ciclo: str({ enum: ['', 'P', 'H', 'V', 'A'] }),
  responsable: str(), recursos: str(), evidencia: str(),
  fecha: { type: Date, required: true },
  estado: str({ enum: ['pendiente', 'en_curso', 'hecha', 'cancelada'], default: 'pendiente' }),
  hechaEn: fecha, nota: str(),
  autoevaluacion: { type: Schema.Types.ObjectId, ref: 'SstAutoevaluacion', default: null },
  creadoPor: usuario, actualizadoPor: usuario,
}, { timestamps: true });
actividadSchema.plugin(tenantPlugin);
actividadSchema.index({ empresa: 1, anio: 1, fecha: 1 });
actividadSchema.index({ empresa: 1, clave: 1 }, { unique: true, partialFilterExpression: { clave: { $gt: '' } } });


export const SstAutoevaluacion = modelo('SstAutoevaluacion', autoevaluacionSchema);
export const SstActividad = modelo('SstActividad', actividadSchema);
