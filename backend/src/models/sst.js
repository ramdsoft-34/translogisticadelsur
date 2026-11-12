// SG-SST y PESV: lo que no existe en Terceros ni en Vehículos. Todo es de una empresa (tenantPlugin).
// La persona y el vehículo se enlazan; no se copian (nombre, documento, licencia, SOAT… viven allá).
// Exámenes médicos: solo concepto de aptitud, fechas y restricciones. Nunca historia clínica ni diagnósticos.
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';

const { Schema } = mongoose;
const modelo = (n, s) => mongoose.models[n] || mongoose.model(n, s);
const str = (o = {}) => ({ type: String, trim: true, default: '', ...o });
const fecha = { type: Date, default: null };
const num = { type: Number, default: null };
const usuario = { type: Schema.Types.ObjectId, ref: 'Usuario', default: null };

// ── Datos de la empresa para los formatos y membrete ──
const sstEmpresaSchema = new Schema({
  responsables: {
    representanteLegal: str(), documentoRepresentante: str(),
    responsableSst: str(), licenciaSst: str(), liderPesv: str(),
  },
  riesgo: {
    arl: str(), claseRiesgo: str({ enum: ['', 'I', 'II', 'III', 'IV', 'V'] }), actividadEconomica: str(),
    trabajadores: num, nivelPesv: str({ enum: ['', 'basico', 'estandar', 'avanzado'] }),
  },
  // Lo que da la autoevaluación del responsable: la plataforma no lo calcula
  autoevaluacion: {
    estandares: { valor: num, fecha },
    pesv: { valor: num, fecha },
  },
  colores: { principal: str({ default: '#0B2A6B' }), acento: str({ default: '#F5B400' }) },
  pieTexto: str(),
  // Franjas del membrete (PNG o JPG). Pesadas: no se traen salvo que se pidan
  membrete: {
    encabezado: { type: String, default: '', select: false },
    pie: { type: String, default: '', select: false },
  },
  // Última firma traída de la app del conductor (capacitaciones y EPP)
  firmasAppHasta: { type: Date, default: null },
  actualizadoPor: usuario,
}, { timestamps: true });
sstEmpresaSchema.plugin(tenantPlugin);
// Uno por empresa: el índice de empresa lo pone tenantPlugin; se guarda siempre con upsert por empresa.

// ── Colaborador: un perfil de SST por persona (enlazado al Tercero) ──
const examenSchema = new Schema({
  tipo: str({ enum: ['ingreso', 'periodico', 'retiro', 'post_incapacidad', 'cambio_cargo'] }),
  fecha, vence: fecha,
  concepto: str({ enum: ['apto', 'apto_restricciones', 'no_apto', 'aplazado'] }),
  restricciones: str(), entidad: str(),
  registradoPor: usuario,
}, { timestamps: true });

const eppSchema = new Schema({
  fecha, motivo: str({ enum: ['entrega', 'reposicion'], default: 'entrega' }),
  elementos: [{ _id: false, nombre: str(), cantidad: { type: Number, default: 1 } }],
  observacion: str(),
  proximaReposicion: fecha,                // cuándo hay que reponerlo (entra en Vencimientos)
  // Firma de quien recibe: en la web (dibujada) o en la app del conductor
  firma: { type: String, default: '', select: false },
  firmadoEn: fecha, firmaOrigen: str({ enum: ['', 'web', 'app'] }),
  solicitudApp: str(),                     // id de la solicitud de firma en la app (si se pidió allá)
  registradoPor: usuario,
}, { timestamps: true });

const comparendoSchema = new Schema({
  fecha, numero: str(), codigo: str(), descripcion: str(), placa: str({ uppercase: true }),
  valor: { type: Number, default: 0 }, estado: str({ enum: ['pendiente', 'pagado', 'en_curso'], default: 'pendiente' }),
  registradoPor: usuario,
}, { timestamps: true });

const colaboradorSchema = new Schema({
  tercero: { type: Schema.Types.ObjectId, ref: 'Tercero', required: true },
  tipo: str({ enum: ['conductor', 'directo'], required: true }),
  cargo: str(),
  vinculacion: str({ enum: ['', 'directo', 'contratista', 'temporal', 'aprendiz'] }),
  ingreso: fecha,
  seguridadSocial: { eps: str(), afp: str(), arl: str() },
  contactoEmergencia: { nombre: str(), parentesco: str(), telefono: str() },
  examenes: { type: [examenSchema], default: [] },
  epp: { type: [eppSchema], default: [] },
  comparendos: { type: [comparendoSchema], default: [] },
  activo: { type: Boolean, default: true },
}, { timestamps: true });
colaboradorSchema.plugin(tenantPlugin);
colaboradorSchema.index({ empresa: 1, tercero: 1 }, { unique: true });

// ── Hoja de vida del vehículo (lo de SST; SOAT y técnico-mecánica siguen en Vehículos) ──
const sstVehiculoSchema = new Schema({
  vehiculo: { type: Schema.Types.ObjectId, ref: 'Vehiculo', required: true },
  kilometraje: { valor: num, fecha, fuente: str({ enum: ['', 'web', 'preoperacional', 'mantenimiento'] }) },
  rcContractual: { vence: fecha, numero: str() },
  rcExtracontractual: { vence: fecha, numero: str() },
  plan: [{ actividad: str(), cadaKm: num, cadaDias: num, ultimoKm: num, ultimaFecha: fecha }],
  historial: [new Schema({
    fecha, tipo: str({ enum: ['preventivo', 'correctivo'] }), actividad: str(), km: num, taller: str(),
    costo: { type: Number, default: 0 }, registradoPor: usuario,
  }, { timestamps: true })],
}, { timestamps: true });
sstVehiculoSchema.plugin(tenantPlugin);
sstVehiculoSchema.index({ empresa: 1, vehiculo: 1 }, { unique: true });

// ── Capacitaciones (programa anual) ──
const asistenteSchema = new Schema({
  colaborador: { type: Schema.Types.ObjectId, ref: 'SstColaborador', default: null },
  nombre: str(), documento: str(), cargo: str(),
  firma: { type: String, default: '', select: false },
  firmadoEn: fecha, firmaOrigen: str({ enum: ['', 'web', 'app'] }),
  solicitudApp: str(),
}, { _id: true });

const capacitacionSchema = new Schema({
  fecha: { type: Date, required: true },
  tema: str({ required: true }),
  eje: str({ enum: ['sst', 'vial', 'ambos'], default: 'sst' }),
  dirigidoA: str(), horas: { type: Number, default: 1 }, facilitador: str(), lugar: str(),
  ejecutada: { type: Boolean, default: false }, ejecutadaEn: fecha,
  asistentes: { type: [asistenteSchema], default: [] },
  observaciones: str(),
  creadoPor: usuario, actualizadoPor: usuario,
}, { timestamps: true });
capacitacionSchema.plugin(tenantPlugin);
capacitacionSchema.index({ empresa: 1, fecha: 1 });

// ── Formatos diligenciados (cada guardado final queda como versión) ──
const formatoSchema = new Schema({
  codigo: str({ required: true }),
  consecutivo: { type: Number, required: true },
  titulo: str(),
  estado: str({ enum: ['borrador', 'final'], default: 'borrador' }),
  datos: { type: Schema.Types.Mixed, default: {} },
  items: [{ _id: false, clave: str(), texto: str(), valor: str({ enum: ['', 'cumple', 'no_cumple', 'na'] }), observacion: str() }],
  filas: { type: [Schema.Types.Mixed], default: [] },  // tablas (asistentes, elementos entregados…)
  firmas: { type: Schema.Types.Mixed, default: {}, select: false },
  version: { type: Number, default: 1 },
  versiones: [{ _id: false, version: Number, guardadoEn: Date, guardadoPor: String }],
  origen: str({ enum: ['web', 'app'], default: 'web' }),
  referencia: str(),                                   // p. ej. el incidente de la app que lo originó
  autor: usuario, autorNombre: str(), actualizadoPor: usuario,
}, { timestamps: true });
formatoSchema.plugin(tenantPlugin);
formatoSchema.index({ empresa: 1, codigo: 1, consecutivo: 1 }, { unique: true });
// Lista de diligenciados por páginas: mismo orden de la consulta (más recientes primero) para no ordenar en memoria
formatoSchema.index({ empresa: 1, updatedAt: -1, _id: -1 });
formatoSchema.index({ empresa: 1, codigo: 1, updatedAt: -1, _id: -1 });

// ── Word y Excel propios (se les pone el membrete y las variables al descargarlos) ──
const archivoSstSchema = new Schema({
  nombre: str({ required: true }), descripcion: str(),
  tipo: str({ enum: ['docx', 'xlsx'] }), tamano: Number,
  archivo: str({ required: true }),                    // ruta relativa en ARCHIVO_DIR
  subidoPor: usuario, subidoPorNombre: str(),
}, { timestamps: true });
archivoSstSchema.plugin(tenantPlugin);

export const SstEmpresa = modelo('SstEmpresa', sstEmpresaSchema);
export const SstColaborador = modelo('SstColaborador', colaboradorSchema);
export const SstVehiculo = modelo('SstVehiculo', sstVehiculoSchema);
export const SstCapacitacion = modelo('SstCapacitacion', capacitacionSchema);
export const SstFormato = modelo('SstFormato', formatoSchema);
export const SstArchivo = modelo('SstArchivo', archivoSstSchema);
