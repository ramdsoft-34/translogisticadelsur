// WhatsApp Business: cuenta de cada empresa, manifiestos al conductor y avisos de estado de Meta.
import crypto from 'node:crypto';
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { paginacion, pagina, listarPagina } from '../utils/paginacion.js';
import { escaparRegex } from '../utils/texto.js';
import { z } from 'zod';
import { Cliente, Empresa, EnvioWhatsapp, MensajeWhatsapp, Viaje, Tercero, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { env } from '../config/env.js';
import { auditar } from '../services/auditoria.js';
import { cifrar, descifrar } from '../utils/cifrado.js';
import { aprobarEnvios, celularWhatsapp, cuentaPlataforma, descartarEnvios, enviarVariosACliente, firmaValida, plataformaLista, prepararEnvio, prepararEnviosCliente, probarCuenta, procesarEnvio, registrarEstados, registrarEstadosPlataforma } from '../services/whatsappBusiness.js';
import { aclararError, explicacionDe, causaDeTexto } from '../services/erroresWhatsapp.js';
import { tienePermiso } from '../config/permisos.js';
import { nombreCompleto } from '../utils/nombres.js';

const r = Router();
const id = (v) => { if (!mongoose.isValidObjectId(v)) throw new ErrorHttp(400, 'Identificador inválido'); return v; };

// ── Avisos de Meta (públicos): cada cuenta tiene su dirección, su token y su firma ──
r.get('/webhook', async (req, res) => {
  const p = await cuentaPlataforma();
  if (req.query['hub.mode'] !== 'subscribe' || !p?.webhookToken || req.query['hub.verify_token'] !== p.webhookToken) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

r.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const p = await cuentaPlataforma();
  const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!firmaValida(cuerpo, req.get('x-hub-signature-256'), p?.appSecretCifrado ? descifrar(p.appSecretCifrado) : '')) return res.sendStatus(403);
  let datos;
  try { datos = JSON.parse(cuerpo.toString('utf8')); } catch { return res.sendStatus(400); }
  await registrarEstadosPlataforma(datos);
  res.sendStatus(200);
});

const cuentaWebhook = async (empresaId) => (mongoose.isValidObjectId(empresaId)
  ? Empresa.findById(empresaId).select('+whatsapp.webhookToken +whatsapp.appSecretCifrado').lean() : null);

r.get('/webhook/:empresa', async (req, res) => {
  const e = await cuentaWebhook(req.params.empresa);
  const token = e?.whatsapp?.webhookToken;
  if (req.query['hub.mode'] !== 'subscribe' || !token || req.query['hub.verify_token'] !== token) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

r.post('/webhook/:empresa', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const e = await cuentaWebhook(req.params.empresa);
  const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const secreto = e?.whatsapp?.appSecretCifrado ? descifrar(e.whatsapp.appSecretCifrado) : '';
  if (!firmaValida(cuerpo, req.get('x-hub-signature-256'), secreto)) return res.sendStatus(403);
  let datos;
  try { datos = JSON.parse(cuerpo.toString('utf8')); } catch { return res.sendStatus(400); }
  req.empresaId = e._id;      // la pantalla de Manifiestos se actualiza en vivo
  await registrarEstados(e._id, datos);
  res.sendStatus(200);
});

r.use(autenticar, soloEmpresa);
const gestionar = permitir(P.CONFIG_GESTIONAR);
const operar = permitir(P.RNDC_OPERAR, P.CONFIG_GESTIONAR);

export const datosCuenta = {
  phoneNumberId: z.string().trim().regex(/^\d*$/, 'el identificador del número solo lleva dígitos').max(30),
  wabaId: z.string().trim().regex(/^\d*$/, 'el identificador de la cuenta solo lleva dígitos').max(30).optional().default(''),
  plantilla: z.string().trim().regex(/^[a-z0-9_]+$/, 'la plantilla solo lleva minúsculas, números y guion bajo').max(100),
  idioma: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'idioma inválido').max(5),
  // Vacía = no se envía el manifiesto a los clientes (se escribe cuando Meta aprueba la plantilla)
  plantillaCliente: z.string().trim().regex(/^[a-z0-9_]*$/, 'la plantilla solo lleva minúsculas, números y guion bajo').max(100).optional(),
  token: z.string().trim().max(1000).optional(), appSecret: z.string().trim().max(200).optional(),
};

// Cuenta de una empresa: la usan su administrador y el SuperAdmin, cada una con sus datos aparte
export async function datosCuentaEmpresa(empresaId) {
  const e = await Empresa.findById(empresaId).select('+whatsapp.tokenCifrado +whatsapp.appSecretCifrado +whatsapp.webhookToken').lean();
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  const { tokenCifrado, appSecretCifrado, webhookToken, ...w } = e.whatsapp || {};
  return { modo: 'plataforma', plantilla: 'manifiesto_conductor', idioma: 'es', plantillaCliente: '', ...w, plataformaLista: plataformaLista(await cuentaPlataforma()), tieneToken: !!tokenCifrado, tieneSecreto: !!appSecretCifrado,
    webhookToken: webhookToken || '', webhookUrl: `${env.urlPublica}/api/whatsapp/webhook/${empresaId}` };
}

export const cuentaEmpresaSchema = z.object({ activo: z.boolean(), modo: z.enum(['plataforma', 'propia']).default('plataforma'), ...datosCuenta });

export async function guardarCuentaEmpresa(empresaId, d) {
  const antes = await Empresa.findById(empresaId).select('+whatsapp.tokenCifrado +whatsapp.appSecretCifrado +whatsapp.webhookToken').lean();
  if (!antes) throw new ErrorHttp(404, 'Empresa no encontrada');
  if (d.activo && d.modo === 'plataforma' && !plataformaLista(await cuentaPlataforma())) {
    throw new ErrorHttp(400, 'La cuenta de WhatsApp de Translogística todavía no está disponible. Puede registrar un número propio o activarlo más adelante.');
  }
  if (d.activo && d.modo === 'propia' && (!d.phoneNumberId || !(d.token || antes.whatsapp?.tokenCifrado) || !(d.appSecret || antes.whatsapp?.appSecretCifrado))) {
    throw new ErrorHttp(400, 'Para activar WhatsApp indique el identificador del número, el token y el secreto de la app');
  }
  const set = { 'whatsapp.activo': d.activo, 'whatsapp.modo': d.modo, 'whatsapp.phoneNumberId': d.phoneNumberId, 'whatsapp.wabaId': d.wabaId, 'whatsapp.plantilla': d.plantilla, 'whatsapp.idioma': d.idioma };
  if (d.plantillaCliente !== undefined) set['whatsapp.plantillaCliente'] = d.plantillaCliente;
  if (d.token) set['whatsapp.tokenCifrado'] = cifrar(d.token);           // vacío = conservar el actual
  if (d.appSecret) set['whatsapp.appSecretCifrado'] = cifrar(d.appSecret);
  if (!antes.whatsapp?.webhookToken) set['whatsapp.webhookToken'] = crypto.randomBytes(24).toString('hex');
  await Empresa.updateOne({ _id: empresaId }, { $set: set });
  return { activo: d.activo, modo: d.modo, phoneNumberId: d.phoneNumberId, plantilla: d.plantilla, plantillaCliente: d.plantillaCliente, tokenCambiado: !!d.token, secretoCambiado: !!d.appSecret };
}

// ── Cuenta de la empresa ─────────────────────────────────────────────────────
r.get('/config', gestionar, async (req, res) => res.json(await datosCuentaEmpresa(req.empresaId)));

r.put('/config', gestionar, async (req, res) => {
  const detalle = await guardarCuentaEmpresa(req.empresaId, cuentaEmpresaSchema.parse(req.body));
  await auditar(req, 'editar_config_whatsapp', { entidad: 'Empresa', entidadId: req.empresaId, detalle });
  res.json({ ok: true });
});

r.post('/config/probar', gestionar, async (req, res) => {
  try {
    const x = await probarCuenta(req.empresaId);
    await auditar(req, 'probar_whatsapp', { detalle: { numero: x.numero } });
    res.json(x);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Envíos ───────────────────────────────────────────────────────────────────
r.get('/estado', operar, async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('whatsapp.activo').lean();
  res.json({ activo: !!e?.whatsapp?.activo });
});

r.get('/envios', operar, async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.viajes) f.viaje = { $in: String(req.query.viajes).split(',').filter(x => mongoose.isValidObjectId(x)).slice(0, 1000) };
  if (req.query.estado) f.estado = String(req.query.estado);
  // Los errores guardados con el código de Meta se muestran explicados
  res.json((await EnvioWhatsapp.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limite) || 300, 1000)).lean())
    .map((x) => ({ ...x, error: aclararError(x.error), causa: x.estado === 'error' ? (x.causa || causaDeTexto(x.error)) : x.causa || '' })));
});

// Mensajes de WhatsApp de la empresa en un periodo: cada envío con su conductor, documento y horas
// (enviado, entregado, leído). Los estados los avisa Meta por el webhook, sin costo.
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha inválida');
const ENVIADOS = ['enviado', 'entregado', 'leido'];
r.get('/mensajes', operar, async (req, res) => {
  const q = z.object({ desde: fechaIso, hasta: fechaIso, estado: z.string().max(20).optional().default(''), texto: z.string().trim().max(60).optional().default('') }).parse(req.query);
  const desde = new Date(`${q.desde}T05:00:00.000Z`);             // medianoche en Colombia
  const hasta = new Date(`${q.hasta}T05:00:00.000Z`); hasta.setUTCDate(hasta.getUTCDate() + 1);
  if (!(hasta > desde)) throw new ErrorHttp(400, 'El rango de fechas no es válido');
  // Solo lo que alguien mandó a enviar: lo «por aprobar» (nadie pulsó Enviar) y lo descartado no aparece.
  // La fecha es la del envío (o la del último intento si falló antes de salir).
  const rango = { $gte: desde, $lt: hasta };
  const base = deEmpresa(req, { estado: { $nin: ['por_aprobar', 'descartado'] }, $or: [{ enviadoEn: rango }, { enviadoEn: null, updatedAt: rango }] });
  const p = paginacion(req.query, { porDefecto: 50, maximo: 200 });
  // Totales del periodo contados en la base (sin traer los mensajes); al pasar de página el navegador ya los tiene
  let totales = null;
  if (!p.activa || p.contar) {
    const porEstado = Object.fromEntries((await EnvioWhatsapp.aggregate([{ $match: { ...base, empresa: new mongoose.Types.ObjectId(String(req.empresaId)) } },
      { $group: { _id: '$estado', n: { $sum: 1 } } }])).map((x) => [x._id, x.n]));
    const suma = (l) => l.reduce((a, k) => a + (porEstado[k] || 0), 0);
    totales = { total: suma(Object.keys(porEstado)), enviados: suma(ENVIADOS), entregados: suma(['entregado', 'leido']), leidos: suma(['leido']), errores: suma(['error']) };
  }
  const filtroEstado = q.estado ? { estado: q.estado === 'enviados' ? { $in: ENVIADOS } : q.estado } : {};
  const poblar = [pob(req.empresaId, 'viaje', 'numero placa destino fecha'), pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId'), pob(req.empresaId, 'cliente', 'nombre')];
  // El texto se busca en la base: documento, teléfono, placa o N° del viaje, nombre o cédula del conductor,
  // y en las solicitudes a bodega el jefe de bodega o el cliente
  const f = { ...base, ...filtroEstado };
  if (q.texto) {
    const re = new RegExp(escaparRegex(q.texto), 'i');
    const [viajes, conductores, clientes] = await Promise.all([viajesQueCoinciden(req, q.texto), tercerosQueCoinciden(req, q.texto),
      Cliente.find(deEmpresa(req, { nombre: re })).select('_id').limit(200).lean().then((l) => l.map((c) => c._id))]);
    f.$and = [{ $or: [{ documento: re }, { telefono: re }, { destinatario: re }, ...(viajes.length ? [{ viaje: { $in: viajes } }] : []),
      ...(conductores.length ? [{ conductor: { $in: conductores } }] : []), ...(clientes.length ? [{ cliente: { $in: clientes } }] : [])] }];
  }
  let lista; let totalFiltrado = null;
  if (p.activa) ({ items: lista, total: totalFiltrado } = await listarPagina(EnvioWhatsapp, f, p, { orden: { updatedAt: -1 }, populate: poblar }));
  else lista = await EnvioWhatsapp.find(f).sort({ updatedAt: -1, _id: -1 }).limit(3000).populate(poblar).lean();
  const nombreDe = (t) => nombreCompleto(t);
  const mensajes = lista
    .map(x => ({ _id: x._id, fecha: x.enviadoEn || x.updatedAt, tipo: x.tipo || 'manifiesto', para: x.para || 'conductor', documento: x.documento, estado: x.estado, error: aclararError(x.error), telefono: x.telefono,
      origen: x.origen, cuenta: x.cuenta, intentos: x.intentos, enviadoEn: x.enviadoEn, entregadoEn: x.entregadoEn, leidoEn: x.leidoEn,
      viaje: x.viaje ? { _id: x.viaje._id, numero: x.viaje.numero, placa: x.viaje.placa, destino: x.viaje.destino } : null,
      conductor: x.conductor ? { nombre: nombreDe(x.conductor), numId: x.conductor.numId } : null,
      destinatario: x.destinatario || '', cliente: x.cliente ? { _id: x.cliente._id, nombre: x.cliente.nombre } : null }));
  if (!p.activa) return res.json({ totales, mensajes });
  res.json({ totales, ...pagina(mensajes, totalFiltrado, p), mensajes });
});

// Viajes y terceros cuyo número, placa, nombre o cédula coincide con lo escrito (para buscar mensajes en la base)
async function viajesQueCoinciden(req, texto) {
  const re = new RegExp(escaparRegex(texto.toUpperCase()));
  const o = [{ placa: re }, ...(/^\d+$/.test(texto) ? [{ numero: Number(texto) }] : [])];
  return (await Viaje.find(deEmpresa(req, { $or: o })).sort({ fecha: -1 }).select('_id').limit(1000).lean()).map((v) => v._id);
}
async function tercerosQueCoinciden(req, texto) {
  const palabras = texto.split(/\s+/).filter(Boolean).slice(0, 5).map((w) => new RegExp(escaparRegex(w), 'i'));
  if (!palabras.length) return [];
  return (await Tercero.find(deEmpresa(req, { $and: palabras.map((re) => ({ $or: [{ nombres: re }, { apellido1: re }, { apellido2: re }, { numId: re }] })) }))
    .select('_id').limit(300).lean()).map((t) => t._id);
}

// Mensajes que la gente le escribió al número (solo para leerlos)
r.get('/recibidos', operar, async (req, res) => {
  const q = z.object({ desde: fechaIso, hasta: fechaIso, texto: z.string().trim().max(60).optional().default('') }).parse(req.query);
  const desde = new Date(`${q.desde}T05:00:00.000Z`);
  const hasta = new Date(`${q.hasta}T05:00:00.000Z`); hasta.setUTCDate(hasta.getUTCDate() + 1);
  if (!(hasta > desde)) throw new ErrorHttp(400, 'El rango de fechas no es válido');
  const p = paginacion(req.query, { porDefecto: 50, maximo: 200 });
  const fRec = deEmpresa(req, { fecha: { $gte: desde, $lt: hasta } });
  // Texto buscado en la base: número, nombre de perfil, mensaje, o nombre / cédula del conductor
  if (q.texto) {
    const re = new RegExp(escaparRegex(q.texto), 'i');
    const conductores = await tercerosQueCoinciden(req, q.texto);
    fRec.$or = [{ de: re }, { nombre: re }, { texto: re }, ...(conductores.length ? [{ conductor: { $in: conductores } }] : [])];
  }
  const poblarRec = pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId');
  let lista; let totalRec = null;
  if (p.activa) ({ items: lista, total: totalRec } = await listarPagina(MensajeWhatsapp, fRec, p, { orden: { fecha: -1 }, populate: poblarRec }));
  else lista = await MensajeWhatsapp.find(fRec).sort({ fecha: -1, _id: -1 }).limit(2000).populate(poblarRec).lean();
  const mensajes = lista.map((x) => ({ _id: x._id, fecha: x.fecha, de: x.de, nombre: x.nombre, tipo: x.tipo, texto: x.texto,
    conductor: x.conductor ? { nombre: [x.conductor.nombres, x.conductor.apellido1, x.conductor.apellido2].filter(Boolean).join(' '), numId: x.conductor.numId } : null }));
  if (!p.activa) return res.json({ total: mensajes.length, mensajes });
  res.json({ ...pagina(mensajes, totalRec, p), mensajes });
});

const listaViajes = z.object({ viajes: z.array(z.string().refine(x => mongoose.isValidObjectId(x), 'viaje inválido')).min(1).max(200) });
r.post('/aprobar', operar, async (req, res) => {
  const { viajes } = listaViajes.parse(req.body);
  const x = await aprobarEnvios(req.empresaId, viajes, req.usuario._id);
  await auditar(req, 'aprobar_whatsapp', { detalle: { viajes: viajes.length, aprobados: x.aprobados } });
  res.json(x);
});
r.post('/descartar', operar, async (req, res) => {
  const { viajes } = listaViajes.parse(req.body);
  const x = await descartarEnvios(req.empresaId, viajes, req.usuario._id);
  await auditar(req, 'descartar_whatsapp', { detalle: { viajes: viajes.length, descartados: x.descartados } });
  res.json(x);
});

// Envío o reenvío manual del manifiesto vigente del viaje
r.post('/viajes/:id/enviar', operar, async (req, res) => {
  try {
    const x = await prepararEnvio(req.empresaId, id(req.params.id), { origen: 'manual', usuario: req.usuario._id });
    await auditar(req, 'enviar_whatsapp_manual', { entidad: 'Viaje', entidadId: req.params.id, detalle: { estado: x?.estado } });
    res.json(x);
  } catch (e) { throw e.status ? new ErrorHttp(e.status, e.message) : e; }
});

// Envío o reenvío manual del manifiesto vigente a los números activos del cliente del viaje
r.post('/viajes/:id/enviar-cliente', operar, async (req, res) => {
  try {
    const x = await prepararEnviosCliente(req.empresaId, id(req.params.id), { origen: 'manual', usuario: req.usuario._id });
    await auditar(req, 'enviar_whatsapp_cliente', { entidad: 'Viaje', entidadId: req.params.id, detalle: { numeros: x.length, estados: x.map((e) => e.estado) } });
    res.json(x.map((e) => ({ ...e, error: aclararError(e.error) })));
  } catch (e) { throw e.status ? new ErrorHttp(e.status, e.message) : e; }
});

// Datos del conductor para WhatsApp (celular y autorización), completados desde Manifiestos antes de enviar.
// Solo cambia lo que se manda; la autorización la confirma quien opera y queda en la auditoría con su usuario.
const datosConductorWa = z.object({ celular: z.string().trim().max(20).optional(), autorizado: z.boolean().optional() });
r.post('/viajes/:id/conductor', operar, async (req, res) => {
  const d = datosConductorWa.parse(req.body);
  const v = await Viaje.findOne(deEmpresa(req, { _id: id(req.params.id) })).select('conductor numero').lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (!v.conductor) throw new ErrorHttp(409, 'El viaje no tiene conductor: elíjalo primero en «Expedir» o en Viajes');
  const t = await Tercero.findOne(deEmpresa(req, { _id: v.conductor }));
  if (!t) throw new ErrorHttp(404, 'No se encontró el conductor del viaje');
  const antes = { celular: t.celular, whatsappAutorizado: !!t.whatsappAutorizado };
  if (d.celular !== undefined) {
    const diez = String(d.celular).replace(/\D/g, '').slice(-10);
    if (!celularWhatsapp(diez)) throw new ErrorHttp(400, 'Escriba un celular colombiano de 10 dígitos que empiece por 3');
    if (diez !== String(t.celular || '').replace(/\D/g, '').slice(-10)) t.celular = diez;
    if (t.whatsappFallo?.telefono && t.whatsappFallo.telefono !== celularWhatsapp(diez)) t.whatsappFallo = undefined;
  }
  // La autorización solo se marca (nunca se quita desde aquí)
  if (d.autorizado === true) t.whatsappAutorizado = true;
  if (t.isModified()) {
    await t.save();
    await auditar(req, 'corregir_conductor_whatsapp', { entidad: 'Tercero', entidadId: t._id, detalle: { viaje: v.numero, antes, despues: { celular: t.celular, whatsappAutorizado: t.whatsappAutorizado } } });
  }
  res.json({ conductor: { _id: t._id, nombre: nombreCompleto(t), celular: t.celular || '', whatsappAutorizado: !!t.whatsappAutorizado,
    listo: !!celularWhatsapp(t.celular) && !!t.whatsappAutorizado } });
});

// Envío manual al cliente de varios viajes en una tanda (cada manifiesto con su PDF, numerados 1 de N…)
r.post('/enviar-cliente', operar, async (req, res) => {
  const { viajes } = listaViajes.parse(req.body);
  const x = await enviarVariosACliente(req.empresaId, [...new Set(viajes)], { usuario: req.usuario._id });
  await auditar(req, 'enviar_whatsapp_cliente', { detalle: { viajes: viajes.length, envios: x.envios.length, estados: x.envios.map((e) => e.estado), omitidos: x.omitidos.length } });
  res.json({ envios: x.envios.map((e) => ({ ...e, error: aclararError(e.error) })), omitidos: x.omitidos });
});

r.post('/envios/:id/reintentar', operar, async (req, res) => {
  const e = await EnvioWhatsapp.findOne(deEmpresa(req, { _id: id(req.params.id) })).select('tipo').lean();
  if (e?.tipo === 'bodega') throw new ErrorHttp(409, 'La solicitud al jefe de bodega se vuelve a enviar desde Viajes → Cargues de bodega');
  const x = await procesarEnvio(req.empresaId, id(req.params.id));
  if (!x) throw new ErrorHttp(409, 'Este envío no se puede reintentar');
  await auditar(req, 'reintentar_whatsapp', { entidad: 'EnvioWhatsapp', entidadId: req.params.id, detalle: { estado: x.estado } });
  res.json(x);
});

// ── Ventana de errores: qué pasó, cómo corregirlo y corrección directa ──
// Se explica solo la causa que corresponde al error guardado; las correcciones posibles dependen de esa causa.
async function diagnostico(req, envio) {
  const causa = envio.estado === 'error' || envio.estado === 'descartado' ? (envio.causa || causaDeTexto(envio.error)) : '';
  const v = envio.viaje ? await Viaje.findOne(deEmpresa(req, { _id: envio.viaje })).select('numero placa conductor conductorNombre manifiesto.numero soporteInterno.mc').lean() : null;
  const alCliente = envio.para === 'cliente';
  // Al cliente: la corrección es del número en Clientes, nunca del conductor del viaje
  const idConductor = alCliente ? null : envio.conductor || v?.conductor;
  const t = idConductor ? await Tercero.findOne(deEmpresa(req, { _id: idConductor })).select('tipoId numId nombres apellido1 apellido2 celular whatsappAutorizado whatsappFallo').lean() : null;
  // Cómo se resolvió antes este mismo problema en la empresa
  const resueltos = causa ? await EnvioWhatsapp.aggregate([
    { $match: { empresa: new mongoose.Types.ObjectId(String(req.empresaId)), causa, 'solucion.accion': { $exists: true, $ne: '' }, estado: { $in: ['enviado', 'entregado', 'leido'] } } },
    { $group: { _id: '$solucion.accion', veces: { $sum: 1 }, ultima: { $max: '$solucion.en' } } }, { $sort: { veces: -1 } }, { $limit: 3 },
  ]) : [];
  // Otros envíos con error del mismo conductor (para corregirlos todos de una vez)
  const otros = t ? await EnvioWhatsapp.countDocuments(deEmpresa(req, { conductor: t._id, para: { $ne: 'cliente' }, estado: 'error', _id: { $ne: envio._id } })) : 0;
  // Al cliente: los manifiestos de la misma tanda que también fallaron (se reintentan juntos)
  const grupo = alCliente && envio.grupo ? await EnvioWhatsapp.find(deEmpresa(req, { grupo: envio.grupo, estado: { $in: ['error', 'pendiente'] } })).select('documento').sort({ documento: 1 }).lean() : [];
  const c = alCliente && envio.cliente ? await Cliente.findOne(deEmpresa(req, { _id: envio.cliente })).select('nombre').lean() : null;
  return {
    envio: { _id: envio._id, estado: envio.estado, error: aclararError(envio.error), causa, tipo: envio.tipo, documento: envio.documento, telefono: envio.telefono, intentos: envio.intentos,
      solucion: envio.solucion || null, para: envio.para || 'conductor' },
    viaje: v ? { _id: v._id, numero: v.numero, placa: v.placa } : null,
    explicacion: causa ? { id: causa, ...explicacionDe(causa, envio.para) } : null,
    cliente: alCliente ? { _id: envio.cliente, nombre: c?.nombre || '', destinatario: envio.destinatario || '', telefono: envio.telefono || '', documentos: grupo.map((x) => x.documento) } : null,
    conductor: t ? { _id: t._id, nombre: nombreCompleto(t), documento: `${t.tipoId} ${t.numId}`, celular: t.celular || '', celularValido: !!celularWhatsapp(t.celular),
      whatsappAutorizado: !!t.whatsappAutorizado, whatsappFallo: t.whatsappFallo?.telefono ? t.whatsappFallo : null } : null,
    resueltosAntes: resueltos.map((x) => ({ accion: x._id, veces: x.veces, ultima: x.ultima })),
    otrosConError: otros,
    puedeConfigurar: tienePermiso(req.usuario.rol, P.CONFIG_GESTIONAR),
  };
}
r.get('/envios/:id/diagnostico', operar, async (req, res) => {
  const e = await EnvioWhatsapp.findOne(deEmpresa(req, { _id: id(req.params.id) })).lean();
  if (!e) throw new ErrorHttp(404, 'Envío no encontrado');
  res.json(await diagnostico(req, e));
});

// Corrige desde la ventana (celular y/o autorización del conductor) y vuelve a enviar.
// La autorización la confirma quien opera: queda en la auditoría con su usuario.
const correccionEnvio = z.object({
  celular: z.string().trim().max(20).optional(),
  autorizado: z.literal(true).optional(),
  reintentar: z.boolean().default(true),
});
r.post('/envios/:id/corregir', operar, async (req, res) => {
  const d = correccionEnvio.parse(req.body);
  const e = await EnvioWhatsapp.findOne(deEmpresa(req, { _id: id(req.params.id) })).lean();
  if (!e) throw new ErrorHttp(404, 'Envío no encontrado');
  if (e.tipo === 'bodega') throw new ErrorHttp(409, 'La solicitud al jefe de bodega se corrige desde Viajes → Cargues de bodega');
  if (!['error', 'descartado'].includes(e.estado) && d.reintentar) throw new ErrorHttp(409, 'Este envío no tiene un error que corregir');
  // Al cliente no se corrigen datos del conductor: el número se corrige en Clientes y aquí solo se reintenta
  if (e.para === 'cliente' && (d.celular !== undefined || d.autorizado)) throw new ErrorHttp(400, 'El número del cliente se corrige en Clientes → WhatsApp de manifiestos');
  const v = e.viaje && e.para !== 'cliente' ? await Viaje.findOne(deEmpresa(req, { _id: e.viaje })).select('conductor').lean() : null;
  const t = e.para === 'cliente' ? null : await Tercero.findOne(deEmpresa(req, { _id: e.conductor || v?.conductor }));
  const acciones = [];
  if ((d.celular !== undefined || d.autorizado) && !t) throw new ErrorHttp(409, 'El viaje no tiene conductor: elíjalo primero');
  if (t) {
    const antes = { celular: t.celular, whatsappAutorizado: t.whatsappAutorizado };
    if (d.celular !== undefined) {
      const diez = String(d.celular).replace(/\D/g, '').slice(-10);
      if (!celularWhatsapp(diez)) throw new ErrorHttp(400, 'Escriba un celular colombiano de 10 dígitos que empiece por 3');
      if (diez !== String(t.celular || '').replace(/\D/g, '').slice(-10)) { t.celular = diez; acciones.push('celular'); }
      if (t.whatsappFallo?.telefono && t.whatsappFallo.telefono !== celularWhatsapp(diez)) t.whatsappFallo = undefined;
    }
    if (d.autorizado && !t.whatsappAutorizado) { t.whatsappAutorizado = true; acciones.push('autorizar'); }
    if (acciones.length) {
      await t.save();
      await auditar(req, 'corregir_conductor_whatsapp', { entidad: 'Tercero', entidadId: t._id, detalle: { envio: e._id, acciones, antes, despues: { celular: t.celular, whatsappAutorizado: t.whatsappAutorizado } } });
    }
  }
  let x = e;
  if (d.reintentar) {
    // Pasa a error para poder reintentar un descartado por error de datos (no uno reemplazado)
    if (e.estado === 'descartado') {
      if ((e.causa || causaDeTexto(e.error)) === 'no_vigente') throw new ErrorHttp(409, 'El documento ya no está vigente: envíe el nuevo desde su viaje');
      await EnvioWhatsapp.updateOne(deEmpresa(req, { _id: e._id }), { $set: { estado: 'error' } });
    }
    x = await procesarEnvio(req.empresaId, e._id, { forzar: true });
    if (!x) throw new ErrorHttp(409, 'Este envío no se puede reintentar');
    acciones.push('reintentar');
    if (['enviado', 'entregado', 'leido'].includes(x.estado)) {
      await EnvioWhatsapp.updateOne(deEmpresa(req, { _id: e._id }), { $set: { solucion: { accion: acciones.filter((a) => a !== 'reintentar').join('+') || 'reintentar', detalle: e.causa || causaDeTexto(e.error), usuario: req.usuario._id, en: new Date() } } });
    }
    await auditar(req, 'reintentar_whatsapp', { entidad: 'EnvioWhatsapp', entidadId: e._id, detalle: { estado: x.estado, acciones } });
  }
  res.json(await diagnostico(req, await EnvioWhatsapp.findOne(deEmpresa(req, { _id: e._id })).lean()));
});

export default r;
