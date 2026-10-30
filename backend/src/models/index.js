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
// Años cumplidos a hoy (null sin fecha)
export function edad(nacimiento, hoy = new Date()) {
  if (!nacimiento) return null;
  const n = new Date(nacimiento);
  let a = hoy.getUTCFullYear() - n.getUTCFullYear();
  if (hoy.getUTCMonth() < n.getUTCMonth() || (hoy.getUTCMonth() === n.getUTCMonth() && hoy.getUTCDate() < n.getUTCDate())) a -= 1;
  return a;
}

// Estado de sincronización de un maestro (tercero o vehículo) con el RNDC.
// `hash` es la huella de los datos enviados: si no cambian, no se reenvían
// (el manual indica registrar solo cuando hay cambios; si no, responde DUPLICADO).
const sincronizacion = new Schema({
  hash: str(), radicado: str(), fecha,
  verificadoEn: fecha,                    // última vez que se trajeron sus datos del RNDC
  consultadoEn: fecha,                    // última consulta de la actualización masiva (aunque el RNDC no lo tenga): permite seguir donde quedó
  estado: { type: String, enum: ['sin_enviar', 'enviado', 'error'], default: 'sin_enviar' },
  mensaje: str(),
}, { _id: false });

// ── Empresa (transportadora usuaria de la plataforma) ──────────────────────
const empresaSchema = new Schema({
  nombre: str({ required: true }),
  nit: str({ required: true }),          // sin dígito de verificación
  dv: str(),
  direccion: str(), telefono: str(), ciudad: str(), correo: str({ lowercase: true }),
  // Logo propio (data URL PNG/JPEG) para el soporte interno; no se carga salvo que se pida (+logo)
  logo: { type: String, default: '', select: false },
  // Posición y tamaño del logo en el soporte interno (desplazamiento en puntos y escala), con límites
  logoAjuste: { dx: { type: Number, default: 0 }, dy: { type: Number, default: 0 }, escala: { type: Number, default: 1 } },
  activa: { type: Boolean, default: true },
  rndc: {
    ambiente: { type: String, enum: ['SIMULADO', 'PRUEBAS', 'PRODUCCION'], default: 'SIMULADO' },
    usuario: str(),                       // usuario web service asignado por el Ministerio
    razonSocial: str(),                   // nombre de la empresa tal como está registrada en el RNDC (encabezado del manifiesto)
    prefijoRemesa: str(), prefijoManifiesto: str(),
    // Marca que se agrega al número anulado para expedir el reemplazo (R100 → R100A, M100 → M100.)
    marcaReemplazoRemesa: str({ default: 'A' }), marcaReemplazoManifiesto: str({ default: '.' }),
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
  // Meses cerrados (aaaa-mm): no se registran ni modifican viajes, liquidaciones ni asientos de esos meses
  // Rastreo GPS con la app Sur Track (por ahora a través del servidor de Cooespatrans)
  rastreo: {
    surTrack: { type: Boolean, default: false },
    velocidadMaxima: { type: Number, default: 80 },     // km/h: por encima se marca alerta
    minutosSinSenal: { type: Number, default: 10 },     // sin posición nueva por más tiempo → «Sin señal»
  },
  cierres: { type: [{ mes: String, fecha: Date, usuario: { type: Schema.Types.ObjectId, ref: 'Usuario' }, resumen: Object, archivos: [String], _id: false }], default: [] },
  // Reglas de negocio configurables sin programar (liquidación, avisos y pesos)
  reglas: {
    retefuenteConductorPct: { type: Number, default: 1 },      // % del flete
    fopatPct: { type: Number, default: 0.1 },                   // % del flete
    pbvFopat: { type: Number, default: 10500 },                 // kg: el FOPAT aplica si el PBV supera este valor
    ciudadesSinFopat: { type: [String], default: ['Pasto'] },
    // RN-05: si el anticipo es mayor o igual al flete en estos destinos, el anticipo reconocido es 0
    ciudadesAnticipoCero: { type: [String], default: ['Pasto', 'Mayorista', 'Popayán'] },
    diasAvisoDocumentos: { type: Number, default: 10 },
    retefuenteFacturaPct: { type: Number, default: 1 },
    siglasLiquidacion: str({ default: 'LC', uppercase: true }),  // cuando la liquidación mezcla empresas o la empresa no tiene siglas
    // Peso por la capacidad escrita en el destino (1.0 → 800 kg…)
    pesosPorTamano: { type: [{ tamano: String, kg: Number, _id: false }],
      default: () => [{ tamano: '1.0', kg: 800 }, { tamano: '3.0', kg: 1500 }, { tamano: '5.0', kg: 2500 }, { tamano: '6.0', kg: 5000 }] },
  },
  smtp: {
    activo: { type: Boolean, default: false },
    host: str(), puerto: { type: Number, default: 587 },
    seguridad: { type: String, enum: ['starttls', 'tls'], default: 'starttls' },   // 587 STARTTLS | 465 TLS directo
    usuario: str(), claveCifrada: { type: String, default: '', select: false },
    remitenteNombre: str(), remitenteCorreo: str({ lowercase: true }), responderA: str({ lowercase: true }),
    // Minutos sin manifiestos nuevos de un cliente antes de enviarle todos juntos en un solo correo
    agruparMinutos: { type: Number, default: 15 },
    unirPdf: { type: Boolean, default: false },   // los manifiestos de un correo van en un solo PDF
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
  // Doble factor (TOTP, app autenticadora) — secreto cifrado con AES-256-GCM
  totp: { activo: { type: Boolean, default: false }, secreto: { type: String, default: '', select: false }, pendiente: { type: String, default: '', select: false },
    ultimoPaso: { type: Number, default: 0, select: false } },
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
  siglas: str({ uppercase: true, maxlength: 6 }),   // numeración de las liquidaciones de conductores (COR-0001)
  // RN-15: cómo se factura el auxiliar a este cliente
  //   registrado: lo registrado en el viaje · sin: nunca se cobra · incluido: va dentro de la tarifa
  //   sin_anticipo: se cobra un valor fijo por viaje sin anticipo
  politicaAuxiliar: { type: String, enum: ['registrado', 'sin', 'incluido', 'sin_anticipo'], default: 'registrado' },
  valorAuxiliarSinAnticipo: { type: Number, default: 30000, min: 0 },
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
  // Correos de relaciones de viajes (aparte de los de manifiestos)
  enviosRelaciones: { destinatarios: { type: [String], default: [] }, cc: { type: [String], default: [] } },
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
  // Placas que maneja el conductor; la principal se propone al registrar viajes
  placas: { type: [String], default: [] }, placaPrincipal: str({ uppercase: true }),
  banco: { entidad: str(), tipoCuenta: str(), cuenta: str() },
  roles: { type: [String], default: [] },
  activo: { type: Boolean, default: true },
  rndc: { type: sincronizacion, default: () => ({}) },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });
terceroSchema.plugin(tenantPlugin);
terceroSchema.index({ empresa: 1, tipoId: 1, numId: 1, 'sede.codigo': 1 }, { unique: true });
terceroSchema.index({ empresa: 1, nombres: 1, apellido1: 1 });
// Una persona (cédula, pasaporte…) no se repite en la empresa; con NIT sí, una por sede
terceroSchema.pre('save', async function () {
  if (this.tipoId === 'N' || (!this.isNew && !this.isModified('numId') && !this.isModified('tipoId'))) return;
  const otro = await this.constructor.findOne({ empresa: this.empresa, tipoId: { $ne: 'N' }, numId: this.numId, _id: { $ne: this._id } }).select('_id').lean();
  if (otro) { const e = new Error(`Ya existe una persona con el documento ${this.numId}`); e.status = 409; throw e; }
});
terceroSchema.virtual('nombreCompleto').get(function () {
  return [this.nombres, this.apellido1, this.apellido2].filter(Boolean).join(' ');
});
terceroSchema.virtual('edad').get(function () { return edad(this.fechaNacimiento); });

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
  surTrack: { choferId: str(), vinculado: fecha },   // conductor de Sur Track que usa este vehículo
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
  codDestinoManifiesto: str(),
  verificadoRndc: fecha,                // última verificación de vehículo y personas contra el RNDC antes de enviar          // fijado a mano cuando el RNDC tiene la sede del destinatario en otro lugar (MAN354)
  placa: str({ required: true, uppercase: true }),
  remolque: str({ uppercase: true }),
  conductor: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },   // obligatorio al registrar (lo exige la API)
  conductorNombre: str(),                             // nombre tal como se registró (respaldo de viajes históricos)
  titular: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },  // vacío = el conductor
  destinatario: { tipoId: str({ uppercase: true }), numId: str(), sede: str() },
  pesoKg: { type: Number, default: 0, min: 0 },
  cantidad: { type: Number, default: 1, min: 0 },     // viajes o unidades (tarifa por unidad)
  conAuxiliar: { type: Boolean, default: false },
  diasAuxiliar: { type: Number, default: 0, min: 0 },   // cantidad de auxiliares o días de auxiliar (0 = uno por unidad)
  planilla: str(),                                      // N° de planilla del cliente (si aplica)
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
  // Número anulado de cada documento: mientras el reemplazo no sea aceptado, se expide con ese número + la marca
  anuladoBase: { remesa: str(), manifiesto: str() },
  // Pago al conductor (liquidación del conductor) y soporte interno MC/RC para viajes sin RNDC
  liquidacionConductor: { type: Schema.Types.ObjectId, ref: 'LiquidacionConductor', default: null },
  // Estado del soporte: '' vigente, 'cumplido' (entregado) o 'anulado'. Al reemplazar uno anulado el anterior queda en «anteriores».
  soporteInterno: {
    mc: str(), rc: str(), codigo: str(), fecha,
    estado: { type: String, enum: ['', 'cumplido', 'anulado'], default: '' },
    cumplido: { fecha, llegada: fecha, cantidad: { type: Number, default: null }, observaciones: str(), usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null } },
    anulado: { fecha, motivo: str(), usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null } },
    anteriores: { type: [{ _id: false, mc: String, rc: String, codigo: String, fecha: Date, anuladoEn: Date, motivo: String }], default: [] },
  },
  // Valores del formulario del RNDC corregidos a mano en la expedición (variable → valor); se aplican al enviar
  ajustesRndc: { remesa: { type: Schema.Types.Mixed, default: {} }, manifiesto: { type: Schema.Types.Mixed, default: {} } },
  // Rastreo GPS con Sur Track: el viaje es la única fuente; el GPS lo envía la app del conductor
  rastreo: {
    activo: { type: Boolean, default: false },
    estado: { type: String, enum: ['', 'esperando', 'en_ruta', 'detenido', 'sin_senal', 'finalizado', 'error'], default: '' },
    origen: str(),                  // 'translogistica' (activado aquí) o 'cooespatrans' (enlazado desde allá)
    externoId: str(), codigoExterno: str(),
    activado: fecha, activadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
    finalizado: fecha, error: str(),
    ultima: { lat: Number, lng: Number, velocidad: Number, rumbo: Number, hora: Date },
    // Modalidad: solo destino (punto final y ruta sugerida) o con clientes (paradas que el conductor ve en Sur Track)
    modalidad: { type: String, enum: ['', 'destino', 'clientes'], default: '' },
    destino: { nombre: str(), lat: Number, lng: Number },
    clientes: { type: [{ _id: false, nombre: str(), direccion: str(), ciudad: str(), telefono: str(), documento: str(), factura: str(),
      valor: { type: Number, default: 0 }, lat: Number, lng: Number, externoId: str(),
      estadoEntrega: str({ default: 'pendiente' }), valorRecibido: { type: Number, default: 0 }, fechaEntrega: fecha,
      // Dónde y cómo se hizo la entrega (lo registra el conductor en Sur Track)
      entrega: { lat: Number, lng: Number, aproximada: Boolean, observacion: String, fotos: [String], conductor: String } }], default: [] },
    // Registro de seguimiento (historial de monitoreo) y resumen al terminar
    eventos: { type: [{ _id: false, fecha: Date, tipo: String, detalle: String }], default: [] },
    resumen: { km: Number, velocidadMaxima: Number, puntos: Number, inicio: Date, fin: Date },
  },
  // Números escritos a mano para el próximo envío (p. ej. tras un DUPLICADO del RNDC)
  numerosManuales: { remesa: str({ uppercase: true }), manifiesto: str({ uppercase: true }) },
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
viajeSchema.index({ empresa: 1, 'rastreo.activo': 1 });
viajeSchema.index({ empresa: 1, 'rastreo.activado': -1 });

// ── Recorrido GPS guardado al terminar el rastreo (el historial no depende de Sur Track) ──
const recorridoRastreoSchema = new Schema({
  viaje: { type: Schema.Types.ObjectId, ref: 'Viaje', required: true },
  puntos: { type: [[Number]], default: [] },          // [lat, lng, velocidad km/h, hora (ms)]
  ruta: { type: [[Number]], default: [] },            // ruta sugerida [lat, lng]
}, { timestamps: true });
recorridoRastreoSchema.plugin(tenantPlugin);
recorridoRastreoSchema.index({ empresa: 1, viaje: 1 }, { unique: true });

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
  viaje: { type: Schema.Types.ObjectId, ref: 'Viaje', default: null },   // vacío en las relaciones (varios viajes)
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', default: null },
  tipo: { type: String, enum: ['manifiesto', 'salida', 'relacion', 'manual'], required: true },
  adjuntos: { type: [String], default: [] },      // nombres de los archivos adjuntos (relaciones y envíos manuales)
  documento: str(),                         // n.° del manifiesto
  destinatarios: { type: [String], default: [] }, cc: { type: [String], default: [] },
  asunto: str(),
  // por_aprobar: creado al aceptarse el manifiesto; solo sale cuando alguien lo aprueba en «Manifestados»
  estado: { type: String, enum: ['por_aprobar', 'pendiente', 'enviando', 'enviado', 'error', 'descartado'], default: 'pendiente' },
  intentos: { type: Number, default: 0 },
  aprobadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null }, aprobadoEn: fecha,
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
  // minimize: false conserva los objetos vacíos del detalle tal como se calculó el hash
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });
auditoriaSchema.index({ empresa: 1, createdAt: -1 });
auditoriaSchema.index({ cadena: 1, seq: 1 }, { unique: true });
// Registro de solo inserción: se bloquea cualquier modificación o borrado desde la aplicación.
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditoriaSchema.pre(op, function () { throw new Error('La auditoría no se puede modificar ni borrar'); });
}
auditoriaSchema.pre('save', function () { if (!this.isNew) throw new Error('La auditoría no se puede modificar'); });

// ── Préstamos y descuentos a conductores (averías, faltantes…) ─────────────
// Plan de cuotas quincenales (día 15 y último día del mes) con interés mensual y cuota fija.
const cuotaSchema = new Schema({
  n: Number, fecha: Date, valor: Number, capital: Number, interes: Number, saldoCapital: Number,
  abonado: { type: Number, default: 0 }, fechaAbono: fecha, liquidacion: str(),
}, { _id: false });
const prestamoSchema = new Schema({
  numero: { type: String, required: true },            // PR-0001
  fecha: { type: Date, required: true },
  conductor: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },
  cedula: str(), conductorNombre: str(), placa: str({ uppercase: true }),
  concepto: str(), capital: { type: Number, required: true, min: 0 },
  tasaMensual: { type: Number, default: 0, min: 0 },  // % mensual
  nCuotas: { type: Number, required: true, min: 1 }, valorCuota: Number, primeraCuota: Date,
  estado: { type: String, enum: ['VIGENTE', 'PAGADO', 'ANULADO'], default: 'VIGENTE' },
  observacion: str(),
  cuotas: { type: [cuotaSchema], default: [] },
  abonos: { type: [{ fecha: Date, valor: Number, interes: Number, origen: String, liquidacion: String, nota: String, _id: false }], default: [] },
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
prestamoSchema.plugin(tenantPlugin);
prestamoSchema.index({ empresa: 1, numero: 1 }, { unique: true });

// ── Liquidación del conductor (pago por placa y periodo) ────────────────────
const liquidacionConductorSchema = new Schema({
  numero: { type: String, required: true },             // siglas del cliente: COR-0001 (LC-0001 si mezcla clientes)
  fecha: { type: Date, required: true },
  placa: str({ uppercase: true }), conductor: { type: Schema.Types.ObjectId, ref: 'Tercero', default: null },
  conductorNombre: str(), cedula: str(),
  desde: Date, hasta: Date,
  viajes: [{ type: Schema.Types.ObjectId, ref: 'Viaje' }],
  lineas: { type: Array, default: [] },
  flete: Number, auxiliar: { type: Number, default: 0 }, anticipo: Number, anticipoReconocido: Number,
  retefuente: Number, fopat: Number, descuentoPrestamos: Number, interesPrestamos: Number, neto: Number,
  empresas: str(), agrupacion: { type: String, enum: ['conductor', 'placa_empresa'], default: 'conductor' },
  pagado: { type: Number, default: 0 },
  estado: { type: String, enum: ['VIGENTE', 'ANULADA'], default: 'VIGENTE' },
  creadoPor: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
liquidacionConductorSchema.plugin(tenantPlugin);
liquidacionConductorSchema.index({ empresa: 1, numero: 1 }, { unique: true });

// ── Contabilidad simplificada (apoyo administrativo; un contador debe revisarla) ──
const cuentaSchema = new Schema({
  codigo: str({ required: true }), nombre: str({ required: true }),
  tipo: { type: String, enum: ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO'], required: true },
  naturaleza: { type: String, enum: ['D', 'C'], required: true },
}, { timestamps: true });
cuentaSchema.plugin(tenantPlugin);
cuentaSchema.index({ empresa: 1, codigo: 1 }, { unique: true });

const asientoSchema = new Schema({
  numero: { type: String, required: true },             // A-00001
  fecha: { type: Date, required: true },
  documento: str(), concepto: str(), origen: str(),     // FAC, COB, PAG, GAS, MAN, LIQ, PRE, ABO
  terceroDoc: str(), tercero: str(), centroCosto: str(),
  lineas: { type: [{ cuenta: String, nombre: String, debito: Number, credito: Number, _id: false }], default: [] },
  estado: { type: String, enum: ['ACTIVO', 'ANULADO'], default: 'ACTIVO' },
  usuario: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null },
}, { timestamps: true });
asientoSchema.plugin(tenantPlugin);
asientoSchema.index({ empresa: 1, numero: 1 }, { unique: true });
asientoSchema.index({ empresa: 1, fecha: 1 });

// ── Autorizaciones de administrador (viajes con documentos vencidos, CA-06) ──
const autorizacionSchema = new Schema({
  tipo: str({ default: 'documentos_vencidos' }),
  viaje: { type: Schema.Types.ObjectId, ref: 'Viaje', default: null }, viajeNumero: Number, placa: str(), conductorNombre: str(),
  vencidos: { type: [String], default: [] }, motivo: str({ required: true, maxlength: 300 }),
  admin: { type: Schema.Types.ObjectId, ref: 'Usuario', required: true }, adminNombre: str(),
  solicitante: { type: Schema.Types.ObjectId, ref: 'Usuario', default: null }, solicitanteNombre: str(),
}, { timestamps: true });
autorizacionSchema.plugin(tenantPlugin);
autorizacionSchema.index({ empresa: 1, createdAt: -1 });

const facturaContSchema = new Schema({
  numero: { type: String, required: true },             // FV-0001
  fecha: { type: Date, required: true },
  cliente: { type: Schema.Types.ObjectId, ref: 'Cliente', required: true },
  desde: Date, hasta: Date, viajes: { type: Number, default: 0 },
  total: Number, retefuentePct: Number, retefuente: Number, icaPct: Number, ica: Number, neto: Number,
  cobrado: { type: Number, default: 0 },
  estado: { type: String, enum: ['PENDIENTE', 'COBRADA', 'ANULADA'], default: 'PENDIENTE' },
  asiento: str(),
  observaciones: str(),   // p. ej. el número que tenía en la plantilla de Excel si se renumeró al importar
}, { timestamps: true });
facturaContSchema.plugin(tenantPlugin);
facturaContSchema.index({ empresa: 1, numero: 1 }, { unique: true });

// ── Remesas de Dulces & Dulces (base de viajes VPL y su remesa impresa) ────
const remesaDulcesSchema = new Schema({
  vpl: str({ required: true }), fecha, zona: str(), peso: Number, manifiesto: str(),
  conductor: str(), cedula: str(), placa: str({ uppercase: true }), remesa: str(), costo: Number,
  impreso: fecha,
}, { timestamps: true });
remesaDulcesSchema.plugin(tenantPlugin);
remesaDulcesSchema.index({ empresa: 1, vpl: 1 }, { unique: true });

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
export const Prestamo = modelo('Prestamo', prestamoSchema);
export const LiquidacionConductor = modelo('LiquidacionConductor', liquidacionConductorSchema);
export const CuentaContable = modelo('CuentaContable', cuentaSchema);
export const Asiento = modelo('Asiento', asientoSchema);
export const FacturaCont = modelo('FacturaCont', facturaContSchema);
export const RemesaDulces = modelo('RemesaDulces', remesaDulcesSchema);
export const RecorridoRastreo = modelo('RecorridoRastreo', recorridoRastreoSchema);
export const Autorizacion = modelo('Autorizacion', autorizacionSchema);

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
