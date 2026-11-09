// Fase 14: cuenta de Gmail conectada por cada usuario (solo el refresh token, cifrado). Es de una empresa (tenantPlugin).
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';

const { Schema } = mongoose;
const cuentaGmailSchema = new Schema({
  usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true },
  email: { type: String, trim: true, lowercase: true, default: '' },
  refreshToken: { type: String, default: '', select: false },    // cifrado con utils/cifrado.js
  alcances: { type: [String], default: [] },
  conectadoEn: { type: Date, default: null },
  error: { type: String, default: '' },                            // permiso_retirado: Google ya no acepta el token
  // Como en Gmail: nombre que ve el destinatario en «De» y firma (texto + logo opcional) que se pone al redactar
  nombre: { type: String, trim: true, maxlength: 80, default: '' },
  firma: {
    texto: { type: String, maxlength: 1500, default: '' },
    logo: { tipo: { type: String, default: '' }, datos: { type: String, default: '' } },   // PNG/JPEG en base64, máximo ~200 KB
    enRespuestas: { type: Boolean, default: true },
  },
}, { timestamps: true });
cuentaGmailSchema.plugin(tenantPlugin);
cuentaGmailSchema.index({ empresa: 1, usuario: 1 }, { unique: true });

export const CuentaGmail = mongoose.models.CuentaGmail || mongoose.model('CuentaGmail', cuentaGmailSchema);
