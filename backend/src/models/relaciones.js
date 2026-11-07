// Fase 11: relación de cobro de una empresa (cliente) por periodo: borrador → enviada → facturada.
// Lo que se envía queda guardado (PDF y Excel permanentes, ver services/documentos/guardados.js): si la relación se
// vuelve a guardar después de enviada y cambia, sube de versión y vuelve a borrador; los archivos anteriores se conservan.
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';

const { Schema } = mongoose;
const modelo = (n, s) => mongoose.models[n] || mongoose.model(n, s);
const str = (extra = {}) => ({ type: String, trim: true, default: '', ...extra });
const fecha = { type: Date, default: null };
const usuario = { type: Schema.Types.ObjectId, ref: 'Usuario', default: null };

const relacionClienteSchema = new Schema({
  numero: str({ required: true }),                 // p. ej. NP-2026-020
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  desde: { type: Date, required: true }, hasta: { type: Date, required: true },
  grupo: str(),                                    // '' = todos los destinos; si no, el grupo de la tarifa (Viajeros, TAT…)
  titulo: str({ maxlength: 250 }),
  version: { type: Number, default: 1 },           // sube cuando cambia una relación ya enviada
  viajes: { type: [{ type: Schema.Types.ObjectId, ref: 'Viaje' }], default: [] },
  totales: { viajes: { type: Number, default: 0 }, vehiculos: { type: Number, default: 0 }, tarifa: { type: Number, default: 0 },
    auxiliar: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
  estado: { type: String, enum: ['borrador', 'enviada', 'facturada'], default: 'borrador' },
  factura: { numero: str(), fecha, usuario },
  envios: { type: [{ _id: false, canal: { type: String, enum: ['correo', 'whatsapp'] }, fecha: Date, para: [String], estado: String, error: String,
    version: { type: Number, default: 1 }, usuario }], default: [] },
  // Enlace público para ver y descargar la relación (va en el WhatsApp y en el correo)
  token: str(), abierto: fecha, ultimaApertura: fecha, aperturas: { type: Number, default: 0 },
  reaperturas: { type: [{ _id: false, fecha: Date, motivo: String, usuario }], default: [] },
  creadoPor: usuario,
  actualizadoPor: usuario,
}, { timestamps: true });
relacionClienteSchema.plugin(tenantPlugin);
relacionClienteSchema.index({ empresa: 1, numero: 1 }, { unique: true });
relacionClienteSchema.index({ empresa: 1, viajes: 1 });
relacionClienteSchema.index({ empresa: 1, cliente: 1, desde: 1, hasta: 1, grupo: 1 });
relacionClienteSchema.index({ token: 1 }, { partialFilterExpression: { token: { $gt: '' } } });

export const RelacionCliente = modelo('RelacionCliente', relacionClienteSchema);
