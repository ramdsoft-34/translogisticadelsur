// Modelos de datos. Todo lo operativo pertenece a una empresa (tenantPlugin).
// Solo Empresa, Municipio (catálogo oficial DIVIPOLA), el SuperAdmin y la
// auditoría de acciones globales existen sin empresa.
import mongoose from 'mongoose';
import { tenantPlugin } from './tenantPlugin.js';
import { ROLES } from '../config/permisos.js';

const { Schema } = mongoose;
const modelo = (n, s) => mongoose.models[n] || mongoose.model(n, s);
const str = (extra = {}) => ({ type: String, trim: true, default: '', ...extra });
const fecha = { type: Date, default: null };
const idTercero = () => ({ tipoId: str({ uppercase: true }), numId: str() });

// Estado de sincronización de un maestro (tercero o vehículo) con el RNDC.
// `hash` es la huella de los datos enviados: si no cambian, no se reenvían
// (el manual indica registrar solo cuando hay cambios; si no, responde DUPLICADO).
const sincronizacion = new Schema({
  hash: str(), radicado: str(), fecha,
  estado: { type: String, enum: ['sin_enviar', 'enviado', 'error'], default: 'sin_enviar' },
  mensaje: str(),
}, { _id: false });

// ── Empresa (transportadora usuaria de la plataforma) ──────────────────────
const empresaSchema = new Schema({
  nombre: str({ required: true }),
  nit: str({ required: true }),          // sin dígito de verificación
  dv: str(),
  direccion: str(), telefono: str(), ciudad: str(), correo: str({ lowercase: true }),
  activa: { type: Boolean, default: true },
  rndc: {
    ambiente: { type: String, enum: ['SIMULADO', 'PRUEBAS', 'PRODUCCION'], default: 'SIMULADO' },
    usuario: str(),                       // usuario web service asignado por el Ministerio
    prefijoRemesa: str(), prefijoManifiesto: str(),
    codOrigen: str(),                     // DIVIPOLA (8 dígitos) del origen habitual
    poliza: { numero: str(), vence: fecha, aseguradoraNit: str(), dueno: str({ default: 'E' }) },
    mercancia: { codigo: str(), descripcion: str() },
    naturalezaCarga: str({ default: '1' }), tipoEmpaque: str({ default: '0' }), unidadMedida: str({ default: '1' }),
    operacion: str({ default: 'G' }),
    retefuentePct: { type: Number, default: 1 },
    reteIca: { type: Number, default: 0 },
    responsablePagoCargue: str({ default: 'E' }), responsablePagoDescargue: str({ default: 'E' }),
    horaCitaCargue: str({ default: '08:00' }), horaCitaDescargue: str({ default: '18:00' }),
    horasPactoCargue: { type: Number, default: 1 }, horasPactoDescargue: { type: Number, default: 1 },
    aceptacionElectronica: { type: Boolean, default: false },
    pagoSaldo: { type: String, enum: ['fin_de_mes', 'dias'], default: 'fin_de_mes' },
    diasPagoSaldo: { type: Number, default: 15 },
    codMunicipioPagoSaldo: str(),
    nitMonitoreoFlota: str(),
    aplicarFopat: { type: Boolean, default: false },  // RETENCIONFOPAT 0,1 % si el PBV supera 10.500 kg
    // Variables adicionales por proceso que exija el RNDC a esta empresa
    // (ej. RETENCIONFUENTEMANIFIESTO, TIPOCONSOLIDADA). Admiten marcadores {..}.
    extras: { type: [{ proceso: Number, variable: String, valor: String, _id: false }], default: [] },
  },
  // Cuenta de correo para enviar documentos (la contraseña se guarda cifrada con AES-256-GCM)
  smtp: {
    activo: { type: Boolean, default: false },
    host: str(), puerto: { type: Number, default: 587 },
    seguridad: { type: String, enum: ['starttls', 'tls'], default: 'starttls' },   // 587 STARTTLS | 465 TLS directo
    usuario: str(), claveCifrada: { type: String, default: '', select: false },
    remitenteNombre: str(), remitenteCorreo: str({ lowercase: true }), responderA: str({ lowercase: true }),
    // Minutos sin manifiestos nuevos de un cliente antes de enviarle todos juntos en un solo correo
    agruparMinutos: { type: Number, default: 15 },
  },
}, { timestamps: true });
empresaSchema.index({ nit: 1 }, { unique: true });

// ── Usuario ─────────────────────────────────────────────────────────────────
const usuarioSchema = new Schema({
  nombre: str({ required: true }),
  email: str({ required: true, lowercase: true }),
  passwordHash: { type: String, required: true, select: false },
  rol: { type: String, enum: Object.keys(ROLES), required: true },
  empresa: { type: Schema.Types.ObjectId, ref: 'Empresa', default: null, index: true },
  activo: { type: Boolean, default: true },
  tokenVersion: { type: Number, default: 0 },
  intentosFallidos: { type: Number, default: 0 },
  bloqueadoHasta: fecha,
  ultimoAcceso: fecha,
  debeCambiarClave: { type: Boolean, default: false },
}, { timestamps: true });
usuarioSchema.index({ email: 1 }, { unique: true });
// Un único SuperAdmin y un único Administrador por empresa (lo garantiza la base de datos).
usuarioSchema.index({ rol: 1 }, { unique: true, name: 'un_superadmin', partialFilterExpression: { rol: 'superadmin' } });
usuarioSchema.index({ empresa: 1, rol: 1 }, { unique: true, name: 'un_admin_por_empresa', partialFilterExpression: { rol: 'admin' } });
usuarioSchema.pre('validate', function () {
  if (this.rol === 'superadmin' && this.empresa) this.invalidate('empresa', 'El SuperAdmin no pertenece a una empresa');
  if (this.rol !== 'superadmin' && !this.empresa) this.invalidate('empresa', 'El usuario debe pertenecer a una empresa');
});

// ── Municipios DIVIPOLA (catálogo oficial, global) ─────────────────────────
const municipioSchema = new Schema({
  codigo: str({ required: true }),       // 8 dígitos (código RNDC)
  nombre: str({ required: true }),
  departamento: str(),
  busqueda: str(),                       // nombre normalizado para buscar
});
municipioSchema.index({ codigo: 1 }, { unique: true });
municipioSchema.index({ busqueda: 1 });

// ── Cliente (generador de carga / remitente) ────────────────────────────────
const clienteSchema = new Schema({
  nombre: str({ required: true }),
  tipoId: str({ default: 'N', uppercase: true }),
  nit: str(), dv: str(), razonSocial: str(),
  sedeRemitente: str(),
  correos: { type: [String], default: [] },
  whatsapp: str(),                       // número para el reporte de vehículos (opcional)
  activo: { type: Boolean, default: true },
  // Envío de documentos por correo cuando el RNDC acepta remesa y manifiesto
  envios: {
    activo: { type: Boolean, default: false },
    destinatarios: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    documentos: {
      manifiesto: { type: Boolean, default: true },      // PDF del manifiesto adjunto
      salida: { type: Boolean, default: false },         // correo de autorización de salida
    },
    salida: { asunto: str(), cuerpo: str({ maxlength: 3000 }) },
  },
}, { timestamps: true });
clienteSchema.plugin(tenantPlugin);
clienteSchema.index({ empresa: 1, nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });

// ── Destino / tarifa de un cliente ──────────────────────────────────────────
const tarifaSchema = new Schema({
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  destino: str({ required: true }),
  codMunicipio: str(),                   // DIVIPOLA del destino
  tipoCobro: { type: String, enum: ['viaje', 'unidad'], default: 'viaje' },
  tarifaCliente: { type: Number, default: 0, min: 0 },
  tarifaAuxiliar: { type: Number, default: 0, min: 0 },
  fleteConductor: { type: Number, default: 0, min: 0 },
  auxiliarPagado: { type: Number, default: 0, min: 0 },
  anticipoHabitual: { type: Number, default: 0, min: 0 },
  pesoKg: { type: Number, default: 0, min: 0 },
  operacion: str(),                      // vacío = la de la empresa (ej. U = urbano)
  destinatario: { tipoId: str({ uppercase: true }), numId: str(), sede: str() },
  activo: { type: Boolean, default: true },
}, { timestamps: true });
tarifaSchema.plugin(tenantPlugin);
tarifaSchema.index({ empresa: 1, cliente: 1, destino: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });

// ── Tercero (conductores, propietarios, tenedores, titulares, destinatarios) ─
const terceroSchema = new Schema({
  tipoId: str({ required: true, uppercase: true }),   // C N P E T U
  numId: str({ required: true }),
  nombres: str({ required: true }),                   // o razón social
  apellido1: str(), apellido2: str(),
  sede: { codigo: str(), nombre: str() },
  telefono: str(), celular: str(), direccion: str(), codMunicipio: str(),
  correo: str({ lowercase: true }),
  licencia: { categoria: str(), numero: str(), vence: fecha },
  fechaNacimiento: fecha,
  banco: { entidad: str(), tipoCuenta: str(), cuenta: str() },
  roles: { type: [String], default: [] },
  activo: { type: Boolean, default: true },
  rndc: { type: sincronizacion, default: () => ({}) },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });
terceroSchema.plugin(tenantPlugin);
terceroSchema.index({ empresa: 1, tipoId: 1, numId: 1, 'sede.codigo': 1 }, { unique: true });
terceroSchema.index({ empresa: 1, nombres: 1, apellido1: 1 });
terceroSchema.virtual('nombreCompleto').get(function () {
  return [this.nombres, this.apellido1, this.apellido2].filter(Boolean).join(' ');
});

// ── Vehículo / remolque ─────────────────────────────────────────────────────
const vehiculoSchema = new Schema({
  placa: str({ required: true, uppercase: true }),
  clase: { type: String, enum: ['vehiculo', 'remolque'], default: 'vehiculo' },
  configuracion: str(),                               // código RNDC de configuración
  configuracionNombre: str(),                         // ej. 2, 3, 2S2, 3S3 (va en el QR del manifiesto)
  marcaNombre: str(), aseguradoraSoat: str(),
  marca: str(), linea: str(), ejes: { type: Number, default: null },
  modelo: { type: Number, default: null }, color: str(), carroceria: str(), combustible: str(),
  pesoVacio: { type: Number, default: null }, capacidad: { type: Number, default: null },
  pbv: { type: Number, default: null }, unidadMedida: str({ default: '1' }),
  // true si el RNDC exige la retención FOPAT para este vehículo (se aprende del rechazo MAN275)
  aplicaFopat: { type: Boolean, default: null },
  soat: { numero: str(), vence: fecha, aseguradoraNit: str() },
  venceTecnomecanica: fecha,
  propietario: idTercero(), tenedor: idTercero(),
  conductorHabitual: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },
  titularHabitual: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },
  activo: { type: Boolean, default: true },
  rndc: { type: sincronizacion, default: () => ({}) },
}, { timestamps: true });
vehiculoSchema.plugin(tenantPlugin);
vehiculoSchema.index({ empresa: 1, placa: 1 }, { unique: true });

// ── Viaje (bitácora + documentos RNDC del viaje) ────────────────────────────
const documentoRndc = new Schema({
  numero: str(), radicado: str(), qr: str(), qrObs: str(), fecha,
  estado: { type: String, enum: ['', 'aceptado', 'rechazado', 'anulado'], default: '' },
  mensaje: str(),
}, { _id: false });
const nuevoDoc = () => ({});

const viajeSchema = new Schema({
  numero: { type: Number, required: true },
  fecha: { type: Date, required: true },
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  tarifaRef: { type: Schema.Types.ObjectId, ref: 'Tarifa', default: null },
  destino: str({ required: true }),
  codOrigen: str(), codDestino: str(),
  placa: str({ required: true, uppercase: true }),
  remolque: str({ uppercase: true }),
  conductor: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },   // obligatorio al registrar (lo exige la API)
  conductorNombre: str(),                             // nombre tal como se registró (respaldo de viajes históricos)
  titular: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },  // vacío = el conductor
  destinatario: { tipoId: str({ uppercase: true }), numId: str(), sede: str() },
  pesoKg: { type: Number, default: 0, min: 0 },
  cantidad: { type: Number, default: 1, min: 0 },     // viajes o unidades (tarifa por unidad)
  conAuxiliar: { type: Boolean, default: false },
  tarifa: { type: Number, default: 0, min: 0 },
  flete: { type: Number, default: 0, min: 0 },
  anticipo: { type: Number, default: 0, min: 0 },
  observaciones: str({ maxlength: 500 }),
  // registrado → remesa (remesa aceptada) → manifestado → cumplido | anulado
  estado: { type: String, enum: ['registrado', 'remesa', 'manifestado', 'cumplido', 'anulado'], default: 'registrado' },
  remesa: { type: documentoRndc, default: nuevoDoc },
  manifiesto: { type: documentoRndc, default: nuevoDoc },
  cumplidoRemesa: { type: documentoRndc, default: nuevoDoc },
  cumplidoManifiesto: { type: documentoRndc, default: nuevoDoc },
  liquidacion: { type: Schema.Types.ObjectId, ref: 'Liquidacion', default: null },
  manifiestoReemplazado: str(),
  // No todos los viajes generan remesa y manifiesto (p. ej. carga propia o urbana).
  requiereManifiesto: { type: Boolean, default: true },
  // Dónde se creó: en Viajes (bitácora) o directamente en Manifiestos RNDC
  origen: { type: String, enum: ['viajes', 'manifiesto'], default: 'viajes' },
  // Importado de la plantilla de Excel: sus documentos RNDC se gestionaron fuera de la
  // plataforma, por eso no aparece en «Por enviar» hasta que un usuario lo habilite.
  historico: { type: Boolean, default: false },
  reporteWhatsapp: { fecha, usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null } },                      // manifiesto anulado que reemplaza el nuevo
  enviandoRndc: fecha,                                // bloqueo para no enviar dos veces a la vez
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
  actualizadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
viajeSchema.plugin(tenantPlugin);
viajeSchema.index({ empresa: 1, numero: 1 }, { unique: true });
viajeSchema.index({ empresa: 1, fecha: -1 });
viajeSchema.index({ empresa: 1, estado: 1 });
viajeSchema.index({ empresa: 1, 'manifiesto.numero': 1 });

// ── Plantillas del reporte de WhatsApp ──────────────────────────────────────
// Texto con marcadores {conductor}, {placa}, {flete}… (ver services/whatsapp.js).
const plantillaWhatsappSchema = new Schema({
  nombre: str({ required: true, maxlength: 60 }),
  encabezado: str({ maxlength: 1000 }),       // una vez por mensaje (saludo, fecha, cliente)
  linea: str({ required: true, maxlength: 1000 }),  // una vez por viaje
  separador: { type: String, enum: ['blanco', 'linea', 'guiones'], default: 'blanco' },
  pie: str({ maxlength: 1000 }),              // al final del mensaje (totales, firma)
  predeterminada: { type: Boolean, default: false },
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
plantillaWhatsappSchema.plugin(tenantPlugin);
plantillaWhatsappSchema.index({ empresa: 1, nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });

// ── Envíos de documentos por correo (trazabilidad y reintentos) ─────────────
const envioCorreoSchema = new Schema({
  viaje: { type: Schema.Types.ObjectId, ref: 'Viaje', required: true },
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', default: null },
  tipo: { type: String, enum: ['manifiesto', 'salida'], required: true },
  documento: str(),                         // n.° del manifiesto
  destinatarios: { type: [String], default: [] }, cc: { type: [String], default: [] },
  asunto: str(),
  estado: { type: String, enum: ['pendiente', 'enviando', 'enviado', 'error'], default: 'pendiente' },
  intentos: { type: Number, default: 0 },
  error: str(), idMensaje: str(), respuesta: str(),
  enviadoEn: fecha,
  origen: { type: String, enum: ['automatico', 'manual'], default: 'automatico' },
  grupo: { type: Schema.Types.ObjectId, default: null },   // manifiestos que salieron en el mismo correo
  usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
envioCorreoSchema.plugin(tenantPlugin);
envioCorreoSchema.index({ empresa: 1, viaje: 1, createdAt: -1 });
envioCorreoSchema.index({ empresa: 1, estado: 1 });

// ── Liquidación de fletes (relación para facturar y pagar) ──────────────────
const liquidacionSchema = new Schema({
  numero: { type: Number, required: true },
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  desde: { type: Date, required: true }, hasta: { type: Date, required: true },
  titulo: str(),
  viajes: [{ type: Schema.Types.ObjectId, ref: 'Viaje' }],
  lineas: { type: Array, default: [] },   // copia calculada al generar
  totales: { type: Object, default: {} },
  estado: { type: String, enum: ['borrador', 'facturada', 'anulada'], default: 'borrador' },
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
liquidacionSchema.plugin(tenantPlugin);
liquidacionSchema.index({ empresa: 1, numero: 1 }, { unique: true });

// ── Transacciones con el RNDC (la clave nunca se guarda) ────────────────────
const transaccionSchema = new Schema({
  usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
  ambiente: str(), url: str(),
  tipo: Number, proceso: Number,
  referencia: str(),                     // ej. "Viaje 15" o "Placa ABC123"
  viaje: { type: Schema.Types.ObjectId, ref: 'Viaje', default: null },
  solicitud: str(),                      // XML con la clave oculta
  respuesta: str(),
  ok: { type: Boolean, default: false },
  radicado: str(), mensaje: str(),
  duracionMs: { type: Number, default: 0 },
}, { timestamps: true });
transaccionSchema.plugin(tenantPlugin);
transaccionSchema.index({ empresa: 1, createdAt: -1 });

// ── Contadores atómicos por empresa (viajes, remesas, manifiestos…) ─────────
const contadorSchema = new Schema({ clave: str({ required: true }), valor: { type: Number, default: 0 } });
contadorSchema.plugin(tenantPlugin);
contadorSchema.index({ empresa: 1, clave: 1 }, { unique: true });

// ── Auditoría ───────────────────────────────────────────────────────────────
const auditoriaSchema = new Schema({
  empresa: { type: Schema.Types.ObjectId, ref: 'Empresa', default: null, index: true }, // null = acción global
  usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
  usuarioNombre: str(),
  accion: str({ required: true }),
  entidad: str(), entidadId: str(),
  detalle: { type: Object, default: {} },
  ip: str(),
  resultado: { type: String, enum: ['exito', 'fallo', 'denegado'], default: 'exito' },
  // Cadena de integridad (una por empresa y otra para las acciones globales):
  // hash = SHA-256(hash anterior + contenido). Alterar o borrar un registro rompe la cadena.
  cadena: str({ required: true }),
  seq: { type: Number, required: true },
  hashPrevio: str(),
  hash: str({ required: true }),
}, { timestamps: { createdAt: true, updatedAt: false } });
auditoriaSchema.index({ empresa: 1, createdAt: -1 });
auditoriaSchema.index({ cadena: 1, seq: 1 }, { unique: true });
// Registro de solo inserción: se bloquea cualquier modificación o borrado desde la aplicación.
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditoriaSchema.pre(op, function () { throw new Error('La auditoría no se puede modificar ni borrar'); });
}
auditoriaSchema.pre('save', function () { if (!this.isNew) throw new Error('La auditoría no se puede modificar'); });

export const Empresa = modelo('Empresa', empresaSchema);
export const Usuario = modelo('Usuario', usuarioSchema);
export const Municipio = modelo('Municipio', municipioSchema);
export const Cliente = modelo('Cliente', clienteSchema);
export const Tarifa = modelo('Tarifa', tarifaSchema);
export const Tercero = modelo('Tercero', terceroSchema);
export const Vehiculo = modelo('Vehiculo', vehiculoSchema);
export const Viaje = modelo('Viaje', viajeSchema);
export const Liquidacion = modelo('Liquidacion', liquidacionSchema);
export const TransaccionRndc = modelo('TransaccionRndc', transaccionSchema);
export const Contador = modelo('Contador', contadorSchema);
export const Auditoria = modelo('Auditoria', auditoriaSchema);
export const PlantillaWhatsapp = modelo('PlantillaWhatsapp', plantillaWhatsappSchema);
export const EnvioCorreo = modelo('EnvioCorreo', envioCorreoSchema);

// Siguiente valor de un contador de la empresa (atómico). `minimo` permite
// continuar una numeración existente (ej. último manifiesto expedido).
export async function siguiente(empresa, clave, minimo = 0) {
  if (minimo > 0) {
    // Si el contador ya es mayor, el upsert choca con el índice único y se ignora.
    await Contador.updateOne({ empresa, clave, valor: { $lt: minimo } }, { $set: { valor: minimo } }, { upsert: true })
      .catch(e => { if (e.code !== 11000) throw e; });
  }
  const c = await Contador.findOneAndUpdate({ empresa, clave }, { $inc: { valor: 1 } }, { new: true, upsert: true });
  return c.valor;
}

// Consulta el próximo valor sin consumirlo.
export async function proximo(empresa, clave) {
  const c = await Contador.findOne({ empresa, clave }).lean();
  return (c?.valor || 0) + 1;
}

// populate filtrado por empresa: el tenantPlugin rechaza consultas sin empresa,
// incluidas las que hace Mongoose para poblar referencias.
export const pob = (empresa, path, select) => ({ path, ...(select ? { select } : {}), match: { empresa } });
