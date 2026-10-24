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
import { asegurarSoporte } from '../services/gestion/soporteInterno.js';
import * as masiva from '../services/rndc/actualizacionVehiculos.js';
import { programarEnvios, enviarPendientes } from '../services/correo.js';
import { estadoLimitador } from '../services/rndc/limitador.js';
import { verificarViaje, verificarConsecutivos, verificacionVigente } from '../services/rndc/verificacion.js';

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
  usuario: t(60), razonSocial: t(120), prefijoRemesa: t(8), prefijoManifiesto: t(8), codOrigen: divipola,
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
  const bajados = [];
  for (const [claveC, texto, campoPrefijo] of [['remesa', consecutivoRemesa, 'prefijoRemesa'], ['manifiesto', consecutivoManifiesto, 'prefijoManifiesto']]) {
    if (!texto) continue;
    const nuevo = partirConsecutivo(texto);
    const actual = partirConsecutivo(`${empresaAntes.rndc?.[campoPrefijo] || ''}${await proximo(req.empresaId, claveC)}`);
    // Se puede bajar (p. ej. para corregir un número mal escrito) si ese número no está usado;
    // al expedir, la plataforma salta los que ya tengan documento.
    const usado = await op.numeroUsado(req.empresaId, claveC, `${nuevo.prefijo}${nuevo.numero}`);
    if (usado) throw new ErrorHttp(400, `El consecutivo ${nuevo.prefijo}${nuevo.numero} ya se usó en el viaje N° ${usado.numero}: escriba uno que no se haya expedido`);
    if (nuevo.prefijo === actual.prefijo && nuevo.numero < actual.numero) bajados.push(`${claveC}: ${actual.prefijo}${actual.numero} → ${nuevo.prefijo}${nuevo.numero}`);
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
    detalle: { ...d, siguienteRemesa, siguienteManifiesto, consecutivoRemesa, consecutivoManifiesto, ...(bajados.length ? { consecutivoBajado: bajados } : {}) } });
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
  codOrigen: divipola.optional(), codDestino: divipola.optional(), codDestinoManifiesto: divipola.optional(),
  placa: z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^[A-Z0-9]{5,6}$/, 'placa inválida')).optional(),
  remolque: z.string().trim().toUpperCase().transform(v => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^([A-Z0-9]{5,6})?$/, 'remolque inválido')).optional(),
  conductor: oid.optional(), titular: oid.nullable().optional(),
  pesoKg: z.coerce.number().min(0).optional(),
  destinatario: z.object({ tipoId: t(1), numId: t(15), sede: t(6) }).optional(),
  flete: z.coerce.number().min(0).optional(), anticipo: z.coerce.number().min(0).optional(),
  observaciones: t(500).optional(),
  requiereManifiesto: z.boolean().optional(),
  // Correcciones a mano del formulario del RNDC (variable → valor)
  ajustes: z.object({ remesa: z.record(z.string(), z.string().trim().max(250)).optional(), manifiesto: z.record(z.string(), z.string().trim().max(250)).optional() }).optional(),
  // Número escrito a mano (vacío = automático); letras, números, punto o guion
  numeroRemesa: z.string().trim().toUpperCase().regex(/^([A-Z0-9.-]{1,15})?$/, 'número de remesa inválido').optional(),
  numeroManifiesto: z.string().trim().toUpperCase().regex(/^([A-Z0-9.-]{1,15})?$/, 'número de manifiesto inválido').optional(),
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
  // Números a mano: solo para documentos aún no aceptados y que ningún otro viaje tenga
  for (const [clave, campo] of [['remesa', 'numeroRemesa'], ['manifiesto', 'numeroManifiesto']]) {
    if (!(campo in d)) continue;
    const numero = d[campo];
    delete d[campo];
    if (numero === (v.numerosManuales?.[clave] || '')) continue;
    if (numero && v[clave]?.estado === 'aceptado') throw new ErrorHttp(409, `La ${clave} ya fue aceptada con el número ${v[clave].numero}`);
    if (numero) {
      const usado = await op.numeroUsado(req.empresaId, clave, numero, v._id);
      if (usado) throw new ErrorHttp(400, `El número ${numero} ya lo tiene el viaje N° ${usado.numero}`);
    }
    d[`numerosManuales.${clave}`] = numero;
  }
  if (d.ajustes) {
    const limpio = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => /^[A-Z0-9]{2,40}$/.test(k) && !op.NO_AJUSTABLES.includes(k)));
    if (d.ajustes.remesa) {
      const nuevo = limpio(d.ajustes.remesa);
      if (v.remesa?.estado === 'aceptado' && JSON.stringify(nuevo) !== JSON.stringify(v.ajustesRndc?.remesa || {})) throw new ErrorHttp(409, 'La remesa ya fue aceptada: sus datos no se pueden cambiar');
      d['ajustesRndc.remesa'] = nuevo;
    }
    if (d.ajustes.manifiesto) d['ajustesRndc.manifiesto'] = limpio(d.ajustes.manifiesto);
    delete d.ajustes;
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
  if (d.requiereManifiesto === false) await asegurarSoporte(req.empresaId, v._id);
  await auditar(req, 'editar_viaje_rndc', { entidad: 'Viaje', entidadId: v._id, detalle: { numero: v.numero, cambios: cambios(antes, v.toObject(), Object.keys(d)) } });
  res.json(await op.vistaPrevia(req.empresaId, v._id));
});

// Verificación contra el RNDC antes de enviar (vehículo, personas y sedes)
r.post('/viajes/:id/verificar', operar, async (req, res) => {
  const d = z.object({ clave, forzar: z.boolean().optional() }).parse(req.body);
  const r1 = await verificarViaje(req.empresaId, req.params.id, d.clave, req.usuario._id, { forzar: !!d.forzar });
  await auditar(req, 'rndc_verificar_viaje', { entidad: 'Viaje', entidadId: req.params.id,
    detalle: { resultados: r1.resultados.map(x => ({ rol: x.rol, estado: x.estado })) } });
  res.json({ ...r1, previa: await op.vistaPrevia(req.empresaId, req.params.id) });
});

// Último consecutivo radicado en el RNDC frente al siguiente de la plataforma
r.post('/consecutivos/verificar', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const d = z.object({ clave, dias: z.coerce.number().int().min(1).max(60).optional() }).parse(req.body);
  res.json(await verificarConsecutivos(req.empresaId, d.clave, req.usuario._id, { dias: d.dias || 20 }));
});

r.post('/viajes/:id/despachar', operar, async (req, res) => {
  const { clave: c } = z.object({ clave }).parse(req.body);
  const resultado = await op.despachar(req.empresaId, req.params.id, c, req.usuario._id);
  await auditar(req, 'rndc_despachar', { entidad: 'Viaje', entidadId: req.params.id, detalle: resumen(resultado) });
  enviarCorreosSiAceptado(req, req.params.id, resultado);
  res.json(resultado);
});

// Despacho de varios viajes seguidos (como el envío por lote de la plantilla).
r.post('/despachar-lote', operar, async (req, res) => {
  const { clave: c, viajes } = z.object({ clave, viajes: z.array(z.string()).min(1).max(50) }).parse(req.body);
  const resultados = [];
  for (const id of viajes) {
    try {
      // Antes de enviar se verifica contra el RNDC lo que no se haya verificado en los últimos días
      const v0 = await Viaje.findOne(deEmpresa(req, { _id: id })).select('verificadoRndc').lean();
      if (v0 && !verificacionVigente(v0)) {
        const ver = await verificarViaje(req.empresaId, id, c, req.usuario._id);
        if (ver.bloqueantes.length) { resultados.push({ viaje: id, error: 'Verificación con el RNDC', detalles: ver.bloqueantes }); continue; }
      }
      const r1 = await op.despachar(req.empresaId, id, c, req.usuario._id);
      resultados.push({ viaje: id, ...r1 });
    } catch (e) {
      resultados.push({ viaje: id, error: e.message, detalles: e.detalles });
      if (e.status === 403) break;     // ambiente bloqueado: no tiene sentido seguir
    }
  }
  await auditar(req, 'rndc_despachar_lote', { detalle: { viajes: viajes.length } });
  // Correos del lote: quedan por aprobar en «Manifestados» (un solo correo por cliente al aprobarlos)
  const aceptados = resultados.filter(x => x.manifiesto?.estado === 'aceptado').map(x => x.viaje);
  (async () => {
    for (const id of aceptados) await programarEnvios(req.empresaId, id, { origen: 'automatico', usuario: req.usuario._id }).catch(() => {});
  })().catch(e => console.error('Correos del lote:', e.message));
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

const anulacionSchema = z.object({
  clave, documento: z.enum(['remesa', 'manifiesto', 'ambos', 'cumplidoRemesa', 'cumplidoManifiesto']),
  motivo: z.string().trim().length(1), motivoRemesa: z.string().trim().max(1).optional().default(''),
  observaciones: z.string().trim().min(3, 'explique el motivo').max(200),
  manifiestoNuevo: t(15),
});
function validarMotivos(d) {
  const validos = { remesa: cat.MOTIVO_ANULACION_REMESA, manifiesto: cat.MOTIVO_ANULACION_MANIFIESTO, ambos: cat.MOTIVO_ANULACION_MANIFIESTO,
    cumplidoRemesa: cat.MOTIVO_ANULACION_CUMPLIDO, cumplidoManifiesto: cat.MOTIVO_ANULACION_CUMPLIDO }[d.documento];
  if (!validos[d.motivo]) throw new ErrorHttp(400, 'Motivo de anulación no válido');
  if (d.documento === 'ambos' && !cat.MOTIVO_ANULACION_REMESA[d.motivoRemesa]) throw new ErrorHttp(400, 'Elija el motivo de anulación de la remesa');
}
const claveRechazada = (m) => /usuario|contrase|clave|password/i.test(m || '');
const listaLote = z.array(z.string().refine(x => mongoose.isValidObjectId(x), 'viaje inválido')).min(1).max(50);

// ── Cumplido y anulación de varios viajes (uno tras otro, al ritmo del limitador del RNDC) ──
r.post('/cumplir-lote', operar, async (req, res) => {
  const d = cumplidoSchema.extend({ viajes: listaLote, usarFechaViaje: z.boolean().optional().default(true) }).parse(req.body);
  const resultados = [];
  for (const id of d.viajes) {
    const v = await Viaje.findOne(deEmpresa(req, { _id: id })).select('numero fecha').lean();
    if (!v) { resultados.push({ viaje: id, ok: false, mensaje: 'Viaje no encontrado' }); continue; }
    // Cada viaje entrega su propia cantidad cargada; las fechas de descargue, la del viaje (si se pide)
    const remesa = { ...d.remesa };
    delete remesa.cantidadEntregada; delete remesa.cantidadCargada;
    if (d.usarFechaViaje) for (const k of ['llegada', 'entrada', 'salida']) remesa[k] = { ...(remesa[k] || {}), fecha: v.fecha };
    try {
      const r1 = await op.cumplir(req.empresaId, id, d.clave, req.usuario._id, { ...d, remesa });
      const ok = r1.cumplidoManifiesto?.estado === 'aceptado';
      const mensaje = ok ? '' : (r1.cumplidoManifiesto?.mensaje || r1.cumplidoRemesa?.mensaje || 'El RNDC rechazó el cumplido');
      resultados.push({ viaje: id, numero: v.numero, ok, mensaje });
      await auditar(req, 'rndc_cumplir', { entidad: 'Viaje', entidadId: id, detalle: { lote: true, ...resumen(r1) } });
      if (!ok && claveRechazada(mensaje)) break;
    } catch (e) { resultados.push({ viaje: id, numero: v.numero, ok: false, mensaje: e.message }); }
  }
  res.json(resultados);
});

r.post('/anular-lote', operar, async (req, res) => {
  const d = anulacionSchema.extend({ viajes: listaLote }).parse(req.body);
  validarMotivos(d);
  const resultados = [];
  for (const id of d.viajes) {
    const v = await Viaje.findOne(deEmpresa(req, { _id: id })).select('numero').lean();
    if (!v) { resultados.push({ viaje: id, ok: false, mensaje: 'Viaje no encontrado' }); continue; }
    try {
      const r1 = await op.anular(req.empresaId, id, d.clave, req.usuario._id, d);
      resultados.push({ viaje: id, numero: v.numero, ok: r1.ok, radicado: r1.radicado, mensaje: r1.mensaje || '' });
      await auditar(req, 'rndc_anular', { entidad: 'Viaje', entidadId: id, detalle: { lote: true, documento: d.documento, motivo: d.motivo, ok: r1.ok } });
      if (!r1.ok && claveRechazada(r1.mensaje)) break;
    } catch (e) { resultados.push({ viaje: id, numero: v.numero, ok: false, mensaje: e.message }); }
  }
  res.json(resultados);
});

r.post('/viajes/:id/anular', operar, async (req, res) => {
  const d = anulacionSchema.parse(req.body);
  validarMotivos(d);
  const resultado = await op.anular(req.empresaId, req.params.id, d.clave, req.usuario._id, d);
  await auditar(req, 'rndc_anular', { entidad: 'Viaje', entidadId: req.params.id, detalle: { documento: d.documento, motivo: d.motivo, ok: resultado.ok } });
  res.json(resultado);
});

// Correos a los destinatarios del cliente: solo cuando el RNDC aceptó el manifiesto
// (que exige la remesa aceptada). Se hace en segundo plano para no demorar la respuesta.
function enviarCorreosSiAceptado(req, viajeId, resultado) {
  if (resultado?.manifiesto?.estado !== 'aceptado') return;
  programarEnvios(req.empresaId, viajeId, { origen: 'automatico', usuario: req.usuario._id })
    .catch(e => console.error('No se pudieron programar los correos del viaje', String(viajeId), e.message));
}

function resumen(resultado) {
  return Object.fromEntries(Object.entries(resultado).filter(([, v]) => v).map(([k, v]) => [k, { numero: v.numero, estado: v.estado, radicado: v.radicado }]));
}

// ── Maestros ────────────────────────────────────────────────────────────────
r.post('/terceros/:id/enviar', operar, async (req, res) => {
  const { clave: c, forzar, titular } = z.object({ clave, forzar: z.boolean().optional(), titular: z.boolean().optional() }).parse(req.body);
  const doc = await Tercero.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!doc) throw new ErrorHttp(404, 'Tercero no encontrado');
  // Como titular de un viaje se registra sin licencia si la tiene incompleta
  const resultado = await op.registrarMaestro(req.empresaId, c, req.usuario._id, Tercero, titular ? op.comoTitular(doc) : doc, forzar);
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
  const d = z.object({ clave, modo: z.enum(['todos', 'lotes']), solo: z.enum(['pendientes', 'todos']).default('pendientes') }).parse(req.body);
  res.status(202).json(await masiva.iniciar({ empresaId: req.empresaId, usuario: req.usuario, clave: d.clave, modo: d.modo, solo: d.solo }));
});
r.post('/vehiculos/actualizacion/continuar', ...actualizarVeh, (req, res) => {
  const d = z.object({ clave: z.string().max(100).optional() }).parse(req.body);
  res.json(masiva.continuar(req.empresaId, d.clave));
});
r.post('/vehiculos/actualizacion/detener', ...actualizarVeh, (req, res) => {
  res.json(masiva.detener(req.empresaId));
});

// ── Actualización de terceros (conductores, titulares, clientes) desde el RNDC ──
const docTercero = z.object({ tipoId: z.string().trim().toUpperCase().regex(/^[A-Z]$/, 'tipo de documento inválido'),
  numId: z.string().trim().regex(/^[0-9A-Za-z]{3,20}$/, 'documento inválido') });
r.post('/terceros/actualizar', ...actualizarVeh, async (req, res) => {
  const d = z.object({ clave }).merge(docTercero).parse(req.body);
  const r1 = await op.actualizarTercero(req.empresaId, d.clave, req.usuario._id, d);
  const { conexion, ...resultado } = r1;
  await auditar(req, 'actualizar_tercero_rndc', { entidad: 'Tercero', detalle: { documento: `${d.tipoId} ${d.numId}`, estado: r1.estado, campos: r1.campos } });
  res.json(resultado);
});
r.get('/terceros/actualizacion', ...actualizarVeh, (req, res) => {
  res.json({ proceso: masiva.estadoProceso(req.empresaId, 'terceros'), tamLote: masiva.TAM_LOTE, limitador: estadoLimitador() });
});
r.post('/terceros/actualizacion', ...actualizarVeh, async (req, res) => {
  const d = z.object({ clave, modo: z.enum(['todos', 'lotes']), solo: z.enum(['pendientes', 'todos']).default('pendientes') }).parse(req.body);
  res.status(202).json(await masiva.iniciar({ empresaId: req.empresaId, usuario: req.usuario, clave: d.clave, modo: d.modo, tipo: 'terceros', solo: d.solo }));
});
r.post('/terceros/actualizacion/continuar', ...actualizarVeh, (req, res) => {
  const d = z.object({ clave: z.string().max(100).optional() }).parse(req.body);
  res.json(masiva.continuar(req.empresaId, d.clave, 'terceros'));
});
r.post('/terceros/actualizacion/detener', ...actualizarVeh, (req, res) => {
  res.json(masiva.detener(req.empresaId, 'terceros'));
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
