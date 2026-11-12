// Fase 15: soportes de anticipos.
// El mensajero entra con el enlace del día y su cédula (sin usuario ni clave), paga cada anticipo y sube la foto
// del comprobante (o el recibo firmado si fue en efectivo). Al conductor le llega por WhatsApp solo esa imagen con
// una descripción corta; el estado del mensaje (enviado, entregado, leído) queda en el viaje.
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';

const { Schema } = mongoose;
const modelo = (n, s) => mongoose.models[n] || mongoose.model(n, s);
const str = (extra = {}) => ({ type: String, trim: true, default: '', ...extra });
const fecha = { type: Date, default: null };

// Enlace del día para un mensajero. Sirve solo para los viajes de esa fecha de cargue.
const enlaceMensajeroSchema = new Schema({
  token: str({ required: true }),
  fecha: { type: Date, required: true },          // fecha de cargue (medianoche UTC del día en Colombia)
  nombre: str({ required: true }), documento: str({ required: true }), celular: str(),
  vence: { type: Date, required: true },
  intentos: { type: Number, default: 0 },        // cédulas equivocadas; al llegar al máximo se bloquea
  anulado: fecha,
  ultimoIngreso: fecha,
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
enlaceMensajeroSchema.plugin(tenantPlugin);
enlaceMensajeroSchema.index({ token: 1 }, { unique: true });
enlaceMensajeroSchema.index({ empresa: 1, fecha: -1 });

// Soporte del anticipo de un viaje (uno vigente por viaje; si se reemplaza, el anterior queda con «reemplazado»)
const soporteAnticipoSchema = new Schema({
  viaje: { type: Schema.Types.ObjectId, ref: 'Viaje', required: true },
  forma: { type: String, enum: ['transferencia', 'efectivo'], default: 'transferencia' },
  valor: { type: Number, default: 0 },
  imagen: str({ required: true }),               // data URL JPEG/PNG (comprobante o recibo firmado)
  firma: str(),                                  // efectivo: firma del conductor (data URL)
  subidoPor: { tipo: { type: String, enum: ['mensajero', 'usuario'], default: 'mensajero' }, nombre: str(), documento: str(),
    usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null }, enlace: { type: Schema.Types.ObjectId, ref: 'EnlaceMensajero', default: null } },
  whatsapp: {
    estado: { type: String, enum: ['', 'pendiente', 'enviado', 'entregado', 'leido', 'error', 'manual'], default: '' },
    para: str(), idMensaje: str(), error: str(),
    enviado: fecha, entregado: fecha, leido: fecha,
  },
  confirmado: { fecha, usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null }, nota: str() },
  reemplazado: fecha,
}, { timestamps: true });
soporteAnticipoSchema.plugin(tenantPlugin);
soporteAnticipoSchema.index({ empresa: 1, viaje: 1, reemplazado: 1 });
soporteAnticipoSchema.index({ empresa: 1, 'whatsapp.idMensaje': 1 });

export const EnlaceMensajero = modelo('EnlaceMensajero', enlaceMensajeroSchema);
export const SoporteAnticipo = modelo('SoporteAnticipo', soporteAnticipoSchema);
