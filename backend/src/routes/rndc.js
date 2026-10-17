// Integración con el RNDC (Registro Nacional de Despachos de Carga).
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Empresa, Tercero, Vehiculo, Viaje, TransaccionRndc, proximo, Contador } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P, tienePermiso } from '../config/permisos.js';
import { auditar, cambios } from '../services/auditoria.js';
import * as op from '../services/rndc/operaciones.js';
import * as cat from '../services/rndc/catalogos.js';
import { env } from '../config/env.js';
import { parseFecha } from '../utils/texto.js';
import { titularDePlaca } from './viajes.js';
import * as masiva from '../services/rndc/actualizacionVehiculos.js';
import { estadoLimitador } from '../services/rndc/limitador.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const operar = permitir(P.RNDC_OPERAR);
const clave = z.string().min(1, 'Escriba la contraseña del RNDC').max(100);
const t = (max) => z.string().trim().max(max).optional().default('');
const divipola = z.string().trim().regex(/^(\d{8})?$/, 'DIVIPOLA de 8 dígitos').optional().default('');
const consecutivo = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9]{1,15}$/, 'Solo letras y números (máximo 15)')
  .regex(/\d$/, 'Debe terminar en número para poder continuar la numeración');

// «R0045» → { prefijo: 'R00', numero: 45 }: los ceros a la izquierda quedan en el prefijo
// para conservar el formato; el número que sigue se incrementa.
export function partirConsecutivo(texto) {
  const m = String(texto).match(/^(.*?)(0*)([1-9]\d*|0)$/);
  return { prefijo: `${m[1]}${m[2]}`, numero: Number(m[3]) };
}

// ── Catálogos y estado ──────────────────────────────────────────────────────
r.get('/catalogos', (_req, res) => {
  res.json({
    procesos: cat.PROCESOS, tiposId: cat.TIPOS_ID, naturaleza: cat.NATURALEZA_CARGA,
    tipoCumplidoRemesa: cat.TIPO_CUMPLIDO_REMESA, motivoSuspensionRemesa: cat.MOTIVO_SUSPENSION_REMESA,
    tipoCumplidoManifiesto: cat.TIPO_CUMPLIDO_MANIFIESTO, motivoAnulacionRemesa: cat.MOTIVO_ANULACION_REMESA,
    motivoAnulacionManifiesto: cat.MOTIVO_ANULACION_MANIFIESTO, motivosReemplazo: cat.MOTIVOS_REEMPLAZO,
    motivoAnulacionCumplido: cat.MOTIVO_ANULACION_CUMPLIDO, responsablePago: cat.RESPONSABLE_PAGO,
    consultas: op.TIPOS_CONSULTA,
  });
});

// ── Configuración RNDC de la empresa ────────────────────────────────────────
const configSchema = z.object({
  ambiente: z.enum(['SIMULADO', 'PRUEBAS', 'PRODUCCION']).optional(),
  usuario: t(60), prefijoRemesa: t(8), prefijoManifiesto: t(8), codOrigen: divipola,
  poliza: z.object({ numero: t(20), vence: z.union([z.string(), z.null()]).optional().transform(v => (v ? parseFecha(v) : null)),
    aseguradoraNit: t(11), dueno: z.enum(['E', 'G', 'N']).optional().default('E') }).optional(),
  mercancia: z.object({ codigo: t(6), descripcion: t(60) }).optional(),
  naturalezaCarga: t(1), tipoEmpaque: t(2), unidadMedida: t(1), operacion: t(1),
  retefuentePct: z.coerce.number().min(0).max(10).optional(), reteIca: z.coerce.number().min(0).max(100).optional(),
  responsablePagoCargue: z.enum(['E', 'R', 'D']).optional(), responsablePagoDescargue: z.enum(['E', 'R', 'D']).optional(),
  horaCitaCargue: z.string().regex(/^\d{1,2}:\d{2}$/).optional(), horaCitaDescargue: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  horasPactoCargue: z.coerce.number().int().min(0).max(999).optional(), horasPactoDescargue: z.coerce.number().int().min(0).max(999).optional(),
  aceptacionElectronica: z.boolean().optional(),
  pagoSaldo: z.enum(['fin_de_mes', 'dias']).optional(), diasPagoSaldo: z.coerce.number().int().min(0).max(120).optional(),
  codMunicipioPagoSaldo: divipola, nitMonitoreoFlota: t(11), aplicarFopat: z.boolean().optional(),
  extras: z.array(z.object({ proceso: z.coerce.number().int(), variable: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,40}$/), valor: t(200) })).max(40).optional(),
  // Próximos consecutivos (solo para continuar una numeración existente; no se pueden bajar)
  siguienteRemesa: z.coerce.number().int().min(1).optional(),
  siguienteManifiesto: z.coerce.number().int().min(1).optional(),
  // Consecutivo completo con letras y números (ej. R10063903); debe terminar en número
  consecutivoRemesa: consecutivo.optional(),
  consecutivoManifiesto: consecutivo.optional(),
});

r.get('/config', permitir(P.CONFIG_GESTIONAR, P.RNDC_OPERAR), async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('nombre nit dv rndc').lean();
  const [sr, sm] = [await proximo(req.empresaId, 'remesa'), await proximo(req.empresaId, 'manifiesto')];
  res.json({
    ...e.rndc,
    siguienteRemesa: sr,
    siguienteManifiesto: sm,
    consecutivoRemesa: `${e.rndc?.prefijoRemesa || ''}${sr}`,
    consecutivoManifiesto: `${e.rndc?.prefijoManifiesto || ''}${sm}`,
    ambientesHabilitados: { SIMULADO: true, PRUEBAS: env.rndc.permitirPruebas, PRODUCCION: env.rndc.permitirProduccion },
    endpoints: cat.ENDPOINTS,
  });
});

r.put('/config', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const { siguienteRemesa, siguienteManifiesto, consecutivoRemesa, consecutivoManifiesto, ...d } = configSchema.partial().parse(req.body);
  // El consecutivo completo define el prefijo y el próximo número
  const empresaAntes = await Empresa.findById(req.empresaId).select('rndc').lean();
  const nuevos = {};
  for (const [claveC, texto, campoPrefijo] of [['remesa', consecutivoRemesa, 'prefijoRemesa'], ['manifiesto', consecutivoManifiesto, 'prefijoManifiesto']]) {
    if (!texto) continue;
    const nuevo = partirConsecutivo(texto);
    const actual = partirConsecutivo(`${empresaAntes.rndc?.[campoPrefijo] || ''}${await proximo(req.empresaId, claveC)}`);
    if (nuevo.prefijo === actual.prefijo && nuevo.numero < actual.numero) {
      throw new ErrorHttp(400, `El próximo consecutivo de ${claveC} no puede ser menor que ${actual.prefijo}${actual.numero}: esos números ya pudieron usarse`);
    }
    d[campoPrefijo] = nuevo.prefijo;
    nuevos[claveC] = nuevo.numero;
  }
  if (d.ambiente === 'PRODUCCION' && !env.rndc.permitirProduccion) {
    throw new ErrorHttp(400, 'Este servidor no tiene habilitado el ambiente de producción del RNDC (RNDC_PERMITIR_PRODUCCION)');
  }
  if (d.ambiente === 'PRUEBAS' && !env.rndc.permitirPruebas) throw new ErrorHttp(400, 'Este servidor no tiene habilitado el ambiente de pruebas del RNDC');
  const set = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => [`rndc.${k}`, v]));
  if (Object.keys(set).length) await Empresa.updateOne({ _id: req.empresaId }, { $set: set }, { runValidators: true });
  for (const [claveC, n] of Object.entries(nuevos)) await Contador.updateOne({ empresa: req.empresaId, clave: claveC }, { $set: { valor: n - 1 } }, { upsert: true });
  for (const [claveC, n] of [['remesa', siguienteRemesa], ['manifiesto', siguienteManifiesto]]) {
    if (!n || nuevos[claveC]) continue;
    const actual = await proximo(req.empresaId, claveC);
    if (n < actual) throw new ErrorHttp(400, `El próximo consecutivo de ${claveC} no puede ser menor que ${actual}`);
    await Contador.updateOne({ empresa: req.empresaId, clave: claveC }, { $set: { valor: n - 1 } }, { upsert: true });
  }
  await auditar(req, 'editar_config_rndc', { entidad: 'Empresa', entidadId: req.empresaId,
    detalle: { ...d, siguienteRemesa, siguienteManifiesto, consecutivoRemesa, consecutivoManifiesto } });
  res.json({ ok: true });
});

// ── Viajes ──────────────────────────────────────────────────────────────────
r.get('/viajes/:id/vista-previa', operar, async (req, res) => {
  res.json(await op.vistaPrevia(req.empresaId, req.params.id));
});

// Corrección de los datos del viaje antes de enviarlo (o después de un rechazo).
// Solo los campos que van en la remesa y el manifiesto; los de la remesa se bloquean
// cuando ya fue aceptada, y los valores (flete/anticipo) exigen permiso para editarlos.
const oid = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const datosExpedicion = z.object({
  fecha: z.string().optional().transform(v => (v ? parseFecha(v) : undefined)),
  codOrigen: divipola.optional(), codDestino: divipola.optional(),
  placa: z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida')).optional(),
  remolque: z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^([A-Z0-9]{5,6})?$/, 'remolque inválido')).optional(),
  conductor: oid.optional(), titular: oid.nullable().optional(),
  pesoKg: z.coerce.number().min(0).optional(),
  destinatario: z.object({ tipoId: t(1), numId: t(15), sede: t(6) }).optional(),
  flete: z.coerce.number().min(0).optional(), anticipo: z.coerce.number().min(0).optional(),
  observaciones: t(500).optional(),
  requiereManifiesto: z.boolean().optional(),
});
const CAMPOS_REMESA = ['fecha', 'pesoKg', 'destinatario'];

r.put('/viajes/:id/datos', operar, async (req, res) => {
  const d = Object.fromEntries(Object.entries(datosExpedicion.parse(req.body)).filter(([, v]) => v !== undefined));
  const v = await Viaje.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (!['registrado', 'remesa'].includes(v.estado)) throw new ErrorHttp(409, `El viaje ya está ${v.estado}: corrija con una anulación o un reemplazo`);
  if (v.estado === 'remesa') {
    const bloqueados = CAMPOS_REMESA.filter(k => k in d && JSON.stringify(d[k]) !== JSON.stringify(v[k]?.toObject?.() ?? v[k]));
    if (bloqueados.length) throw new ErrorHttp(409, `La remesa ${v.remesa.numero} ya fue aceptada; no se puede cambiar: ${bloqueados.join(', ')}. Anule la remesa si debe corregirlos.`);
    if (d.requiereManifiesto === false) throw new ErrorHttp(409, 'El viaje ya tiene remesa aceptada en el RNDC');
  }
  if (('flete' in d || 'anticipo' in d) && !tienePermiso(req.usuario.rol, P.VIAJES_EDITAR_TODOS)) {
    throw new ErrorHttp(403, 'Su rol no puede cambiar el flete ni el anticipo');
  }
  if (('flete' in d || 'anticipo' in d) && v.liquidacion) throw new ErrorHttp(409, 'El viaje ya está en una liquidación de fletes: no se cambian sus valores');
  for (const k of ['conductor', 'titular']) {
    if (d[k] && !(await Tercero.exists(deEmpresa(req, { _id: d[k] })))) throw new ErrorHttp(400, `El ${k} indicado no pertenece a su empresa`);
  }
  const antes = v.toObject();
  if (d.conductor) {
    const c = await Tercero.findOne(deEmpresa(req, { _id: d.conductor })).select('nombres apellido1 apellido2').lean();
    d.conductorNombre = [c.nombres, c.apellido1, c.apellido2].filter(Boolean).join(' ');
  }
  // Al cambiar la placa, el titular vuelve a tomarse del vehículo (o el conductor)
  if (d.placa && d.placa !== v.placa && d.titular === undefined) d.titular = await titularDePlaca(req.empresaId, d.placa);
  v.set({ ...d, actualizadoPor: req.usuario._id });
  await v.save();
  await auditar(req, 'editar_viaje_rndc', { entidad: 'Viaje', entidadId: v._id, detalle: { numero: v.numero, cambios: cambios(antes, v.toObject(), Object.keys(d)) } });
  res.json(await op.vistaPrevia(req.empresaId, v._id));
});

r.post('/viajes/:id/despachar', operar, async (req, res) => {
  const { clave: c } = z.object({ clave }).parse(req.body);
  const resultado = await op.despachar(req.empresaId, req.params.id, c, req.usuario._id);
  await auditar(req, 'rndc_despachar', { entidad: 'Viaje', entidadId: req.params.id, detalle: resumen(resultado) });
  res.json(resultado);
});

// Despacho de varios viajes seguidos (como el envío por lote de la plantilla).
r.post('/despachar-lote', operar, async (req, res) => {
  const { clave: c, viajes } = z.object({ clave, viajes: z.array(z.string()).min(1).max(50) }).parse(req.body);
  const resultados = [];
  for (const id of viajes) {
    try {
      resultados.push({ viaje: id, ...(await op.despachar(req.empresaId, id, c, req.usuario._id)) });
    } catch (e) {
      resultados.push({ viaje: id, error: e.message, detalles: e.detalles });
      if (e.status === 403) break;     // ambiente bloqueado: no tiene sentido seguir
    }
  }
  await auditar(req, 'rndc_despachar_lote', { detalle: { viajes: viajes.length } });
  res.json(resultados);
});

const fechaHora = z.object({ fecha: z.string().optional().transform(v => (v ? parseFecha(v) : null)), hora: z.string().regex(/^(\d{1,2}:\d{2})?$/).optional().default('') }).optional();
const cumplidoSchema = z.object({
  clave,
  remesa: z.object({
    tipo: z.enum(['C', 'S']).default('C'), motivoSuspension: t(1),
    cantidadCargada: z.coerce.number().min(0).optional(), cantidadEntregada: z.coerce.number().min(0).optional(),
    llegada: fechaHora, entrada: fechaHora, salida: fechaHora, observaciones: t(200),
  }).optional().default({}),
  manifiesto: z.object({
    tipo: z.enum(['C', 'S']).default('C'), motivoSuspension: t(2),
    fechaEntregaDocumentos: z.string().optional().transform(v => (v ? parseFecha(v) : null)),
    adicionalCargue: z.coerce.number().min(0).optional(), adicionalDescargue: z.coerce.number().min(0).optional(),
    adicionalFlete: z.coerce.number().min(0).optional(), motivoAdicional: t(1),
    descuento: z.coerce.number().min(0).optional(), motivoDescuento: t(1),
    sobreanticipo: z.coerce.number().min(0).optional(), observaciones: t(200),
  }).optional().default({}),
});

r.post('/viajes/:id/cumplir', operar, async (req, res) => {
  const d = cumplidoSchema.parse(req.body);
  const resultado = await op.cumplir(req.empresaId, req.params.id, d.clave, req.usuario._id, d);
  await auditar(req, 'rndc_cumplir', { entidad: 'Viaje', entidadId: req.params.id, detalle: resumen(resultado) });
  res.json(resultado);
});

r.post('/viajes/:id/anular', operar, async (req, res) => {
  const d = z.object({
    clave, documento: z.enum(['remesa', 'manifiesto', 'cumplidoRemesa', 'cumplidoManifiesto']),
    motivo: z.string().trim().length(1), observaciones: z.string().trim().min(3, 'explique el motivo').max(200),
    manifiestoNuevo: t(15),
  }).parse(req.body);
  const validos = { remesa: cat.MOTIVO_ANULACION_REMESA, manifiesto: cat.MOTIVO_ANULACION_MANIFIESTO,
    cumplidoRemesa: cat.MOTIVO_ANULACION_CUMPLIDO, cumplidoManifiesto: cat.MOTIVO_ANULACION_CUMPLIDO }[d.documento];
  if (!validos[d.motivo]) throw new ErrorHttp(400, 'Motivo de anulación no válido');
  const resultado = await op.anular(req.empresaId, req.params.id, d.clave, req.usuario._id, d);
  await auditar(req, 'rndc_anular', { entidad: 'Viaje', entidadId: req.params.id, detalle: { documento: d.documento, motivo: d.motivo, ok: resultado.ok } });
  res.json(resultado);
});

function resumen(resultado) {
  return Object.fromEntries(Object.entries(resultado).filter(([, v]) => v).map(([k, v]) => [k, { numero: v.numero, estado: v.estado, radicado: v.radicado }]));
}

// ── Maestros ────────────────────────────────────────────────────────────────
r.post('/terceros/:id/enviar', operar, async (req, res) => {
  const { clave: c, forzar } = z.object({ clave, forzar: z.boolean().optional() }).parse(req.body);
  const doc = await Tercero.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!doc) throw new ErrorHttp(404, 'Tercero no encontrado');
  const resultado = await op.registrarMaestro(req.empresaId, c, req.usuario._id, Tercero, doc, forzar);
  await auditar(req, 'rndc_tercero', { entidad: 'Tercero', entidadId: doc._id, detalle: { ok: resultado.ok, sinCambios: resultado.sinCambios } });
  res.json(resultado);
});

r.post('/vehiculos/:id/enviar', operar, async (req, res) => {
  const { clave: c, forzar } = z.object({ clave, forzar: z.boolean().optional() }).parse(req.body);
  const doc = await Vehiculo.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!doc) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const resultado = await op.registrarMaestro(req.empresaId, c, req.usuario._id, Vehiculo, doc, forzar);
  await auditar(req, 'rndc_vehiculo', { entidad: 'Vehiculo', entidadId: doc._id, detalle: { ok: resultado.ok, sinCambios: resultado.sinCambios } });
  res.json(resultado);
});

// ── Actualizar vehículos registrados con la información del RNDC ───────────
// Individual (una placa), todos o por lotes de 30. Las consultas van de una en una.
const actualizarVeh = [permitir(P.MAESTROS_EDITAR), permitir(P.RNDC_CONSULTAR, P.RNDC_OPERAR)];
const placaSchema = z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida'));

r.post('/vehiculos/actualizar', ...actualizarVeh, async (req, res) => {
  const d = z.object({ clave, placa: placaSchema }).parse(req.body);
  const r1 = await op.actualizarVehiculo(req.empresaId, d.clave, req.usuario._id, d.placa);
  const { conexion, ...resultado } = r1;
  await auditar(req, 'actualizar_vehiculo_rndc', { entidad: 'Vehiculo', entidadId: r1.id || '', detalle: { placa: d.placa, estado: r1.estado, campos: r1.campos } });
  res.json(resultado);
});

r.get('/vehiculos/actualizacion', ...actualizarVeh, (req, res) => {
  res.json({ proceso: masiva.estadoProceso(req.empresaId), tamLote: masiva.TAM_LOTE, limitador: estadoLimitador() });
});
r.post('/vehiculos/actualizacion', ...actualizarVeh, async (req, res) => {
  const d = z.object({ clave, modo: z.enum(['todos', 'lotes']) }).parse(req.body);
  res.status(202).json(await masiva.iniciar({ empresaId: req.empresaId, usuario: req.usuario, clave: d.clave, modo: d.modo }));
});
r.post('/vehiculos/actualizacion/continuar', ...actualizarVeh, (req, res) => {
  const d = z.object({ clave: z.string().max(100).optional() }).parse(req.body);
  res.json(masiva.continuar(req.empresaId, d.clave));
});
r.post('/vehiculos/actualizacion/detener', ...actualizarVeh, (req, res) => {
  res.json(masiva.detener(req.empresaId));
});

// ── Verificar antes de crear (evita duplicados y trae los datos del RNDC) ───
// Sin contraseña solo revisa la base de la empresa; con contraseña consulta el RNDC.
function exigirConsulta(req, c) {
  if (c && !tienePermiso(req.usuario.rol, P.RNDC_CONSULTAR) && !tienePermiso(req.usuario.rol, P.RNDC_OPERAR)) {
    throw new ErrorHttp(403, 'Su rol no puede consultar el RNDC');
  }
}
r.post('/verificar/vehiculo', permitir(P.MAESTROS_EDITAR), async (req, res) => {
  const d = z.object({ placa: z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida')),
    clave: z.string().max(100).optional() }).parse(req.body);
  exigirConsulta(req, d.clave);
  const r1 = await op.verificarVehiculo(req.empresaId, req.usuario._id, d);
  if (r1.origen === 'rndc') await auditar(req, 'importar_rndc', { entidad: 'Vehiculo', entidadId: r1.registro._id, detalle: { placa: d.placa } });
  res.json(r1);
});
r.post('/verificar/tercero', permitir(P.MAESTROS_EDITAR), async (req, res) => {
  const d = z.object({ tipoId: z.enum(Object.keys(cat.TIPOS_ID)), numId: z.string().trim().regex(/^\d{5,15}$/, 'documento inválido'),
    clave: z.string().max(100).optional(),
    roles: z.array(z.enum(['conductor', 'propietario', 'tenedor', 'titular', 'remitente', 'destinatario'])).optional().default([]) }).parse(req.body);
  exigirConsulta(req, d.clave);
  const r1 = await op.verificarTercero(req.empresaId, req.usuario._id, d);
  if (r1.origen === 'rndc') await auditar(req, 'importar_rndc', { entidad: 'Tercero', entidadId: r1.registro._id, detalle: { numId: d.numId } });
  res.json(r1);
});

// Campos que le faltan a un vehículo o tercero para registrarse en el RNDC.
r.get('/faltantes/:tipo/:id', permitir(P.MAESTROS_VER), async (req, res) => {
  const tipo = req.params.tipo === 'vehiculo' ? 'vehiculo' : 'tercero';
  if (!mongoose.isValidObjectId(req.params.id)) throw new ErrorHttp(400, 'Identificador inválido');
  const doc = await (tipo === 'vehiculo' ? Vehiculo : Tercero).findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!doc) throw new ErrorHttp(404, 'No encontrado');
  const empresa = await Empresa.findById(req.empresaId).lean();
  res.json({ faltantes: op.faltantesMaestro(empresa, tipo, doc), rndc: doc.rndc || {} });
});

// ── Consultas ───────────────────────────────────────────────────────────────
r.post('/consultar', permitir(P.RNDC_CONSULTAR), async (req, res) => {
  const d = z.object({
    clave, que: z.enum(op.TIPOS_CONSULTA),
    filtros: z.record(z.string().max(30)).optional().default({}),
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(req.body);
  res.json(await op.consultar(req.empresaId, d.clave, req.usuario._id, d));
});

// ── Traer maestros desde el RNDC (consulta oficial → crea o actualiza) ─────
r.post('/importar/terceros', permitir(P.MAESTROS_EDITAR), permitir(P.RNDC_CONSULTAR, P.RNDC_OPERAR), async (req, res) => {
  const d = z.object({
    clave, roles: z.array(z.enum(['conductor', 'propietario', 'tenedor', 'titular', 'remitente', 'destinatario'])).optional().default([]),
    documentos: z.array(z.object({ tipoId: z.enum(Object.keys(cat.TIPOS_ID)), numId: z.string().trim().regex(/^\d{5,15}$/, 'documento inválido') })).min(1).max(30),
  }).parse(req.body);
  const resultados = [];
  for (const x of d.documentos) {
    const r1 = await op.traerTercero(req.empresaId, d.clave, req.usuario._id, { ...x, roles: d.roles });
    resultados.push({ ...x, ...r1 });
    if (!r1.ok && /usuario|contrase|clave/i.test(r1.mensaje || '')) break;
  }
  await auditar(req, 'importar_rndc', { entidad: 'Tercero', detalle: { solicitados: d.documentos.length, traidos: resultados.filter(x => x.ok).length } });
  res.json(resultados);
});

r.post('/importar/vehiculos', permitir(P.MAESTROS_EDITAR), permitir(P.RNDC_CONSULTAR, P.RNDC_OPERAR), async (req, res) => {
  const d = z.object({ clave, placas: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida')).min(1).max(30) }).parse(req.body);
  const resultados = [];
  for (const placa of d.placas) {
    const r1 = await op.traerVehiculo(req.empresaId, d.clave, req.usuario._id, { placa });
    resultados.push({ placa, ...r1 });
    if (!r1.ok && /usuario|contrase|clave/i.test(r1.mensaje || '')) break;
  }
  await auditar(req, 'importar_rndc', { entidad: 'Vehiculo', detalle: { solicitados: d.placas.length, traidos: resultados.filter(x => x.ok).length } });
  res.json(resultados);
});

// ── Historial de transacciones ─────────────────────────────────────────────
r.get('/transacciones', permitir(P.RNDC_OPERAR, P.RNDC_CONSULTAR, P.AUDITORIA_VER), async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.viaje) f.viaje = req.query.viaje;
  if (req.query.ok === '0') f.ok = false;
  const lista = await TransaccionRndc.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limite) || 100, 500))
    .populate('usuario', 'nombre').lean();
  res.json(lista);
});

export default r;
