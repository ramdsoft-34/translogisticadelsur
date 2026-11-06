// PDF permanentes: cada documento expedido (manifiesto, remesa, soporte interno, liquidaciones, relaciones de cobro,
// formatos SG-SST…) se genera UNA vez, se guarda en la carpeta privada del servidor (ARCHIVO_DIR) y desde ahí se muestra,
// se envía por correo, a la app y por WhatsApp. Nunca se reemplaza: un cambio permitido (p. ej. cumplido o anulado)
// crea otra versión y la anterior se conserva. La huella SHA-256 permite comprobar que el archivo no se alteró.
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';

const { Schema } = mongoose;
const modelo = (n, s) => mongoose.models[n] || mongoose.model(n, s);

const documentoPdfSchema = new Schema({
  tipo: { type: String, required: true },          // manifiesto, remesa, soporte, liquidacion, liquidacion-conductor…
  ref: { type: String, required: true },           // identificador del registro (viaje, liquidación…) como texto
  clave: { type: String, required: true },         // qué representa (número + estado): la misma clave = el mismo archivo
  version: { type: Number, required: true },       // 1, 2, 3… dentro del mismo tipo y registro
  nombre: { type: String, default: '' },           // nombre del archivo para descargar
  archivo: { type: String, required: true },       // ruta relativa dentro de ARCHIVO_DIR/<empresa>/
  sha256: { type: String, required: true },
  tamano: { type: Number, default: 0 },
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: { createdAt: 'creado', updatedAt: false } });
documentoPdfSchema.plugin(tenantPlugin);
documentoPdfSchema.index({ empresa: 1, tipo: 1, ref: 1, clave: 1 }, { unique: true });
documentoPdfSchema.index({ empresa: 1, tipo: 1, ref: 1, version: 1 }, { unique: true });

export const DocumentoPdf = modelo('DocumentoPdf', documentoPdfSchema);
