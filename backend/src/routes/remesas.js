// Fase 12: remesas de los clientes (base de viajes VPL del cliente, consecutivo de la cooperativa e impresión con su formato).
// Se monta dentro de /api/gestion (ya autenticado).
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { permitir, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { RemesaDulces, Empresa, Cliente } from '../models/index.js';
import * as R from '../services/gestion/remesasDulces.js';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { pdfGuardado } from '../services/documentos/guardados.js';
import { componerMediasHojas } from '../services/documentos/componer.js';

const r = Router();
const ver = permitir(P.VIAJES_VER);
const gestionar = permitir(P.VIAJES_REGISTRAR);
const id = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const clienteDe = (v) => (v ? id.parse(String(v)) : null);
const nombreArchivo = (req) => { try { return decodeURIComponent(String(req.get('x-nombre-archivo') || '')).slice(0, 150); } catch { return ''; } };
const logoZ = z.string().max(900_000, 'El logo es muy pesado (máximo 650 KB)').refine(v => v === '' || /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(v), 'El logo debe ser PNG o JPG');
const texto = (n) => z.string().trim().max(n).optional();
const crudo = express.raw({ type: '*/*', limit: '15mb' });
const ajusteZ = z.object({ dx: z.coerce.number(), dy: z.coerce.number(), escala: z.coerce.number() }).partial();

async function clienteValido(req, cliente) {
  if (!cliente) return null;
  if (!(await Cliente.exists({ _id: cliente, empresa: req.empresaId }))) throw new ErrorHttp(404, 'Empresa (cliente) no encontrada');
  return cliente;
}

// Lista: por cliente, mes (AAAA-MM) y estado (pendientes | impresas)
r.get('/remesas', ver, async (req, res) => {
  await R.prepararIndices();   // las remesas de antes de la fase 12 quedan con su número para el consecutivo
  const f = { empresa: req.empresaId };
  if (req.query.cliente) f.cliente = clienteDe(req.query.cliente);
  if (/^\d{4}-\d{2}$/.test(String(req.query.mes || ''))) {
    const [y, m] = String(req.query.mes).split('-').map(Number);
    f.fecha = { $gte: new Date(Date.UTC(y, m - 1, 1)), $lt: new Date(Date.UTC(y, m, 1)) };
  }
  if (req.query.estado === 'pendientes') f.impreso = null;
  if (req.query.estado === 'impresas') f.impreso = { $ne: null };
  const lista = await RemesaDulces.find(f).sort({ remesaNum: 1, vpl: 1 }).limit(3000)
    .populate({ path: 'viaje', select: 'numero destino', match: { empresa: req.empresaId } }).lean();
  res.json(lista);
});

// Formato: encabezado de la empresa + datos fijos del cliente (con los logos, para la vista previa)
r.get('/remesas/formato', ver, async (req, res) => res.json(await R.formato(req.empresaId, await clienteValido(req, clienteDe(req.query.cliente)))));

r.put('/remesas/formato/empresa', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const d = z.object({ logo: logoZ.optional(), nombre1: texto(80), nombre2: texto(80), nit: texto(40), lema: texto(120), resolucion: texto(300),
    siguiente: z.coerce.number().int().min(1).max(99_999_999).optional(), porHoja: z.coerce.number().int().refine(v => v === 1 || v === 2).optional(), linea: z.boolean().optional(),
    ajusteLogo: ajusteZ.optional() }).parse(req.body || {});
  if (d.ajusteLogo) d.ajusteLogo = R.ajusteDe('logo', d.ajusteLogo);   // dentro de los límites
  const set = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => [`remesaFormato.${k}`, v]));
  if (d.siguiente !== undefined) {
    // No se puede volver a un número que ya se usó
    await R.prepararIndices();
    const max = await R.maxUsado(req.empresaId);
    if (max && d.siguiente <= max) throw new ErrorHttp(400, `La remesa ${max} ya se usó: el próximo número debe ser mayor`);
  }
  await Empresa.updateOne({ _id: req.empresaId }, { $set: set });
  await auditar(req, 'remesas_formato_empresa', { detalle: { ...d, logo: d.logo ? '(logo)' : undefined } });
  res.json(await R.formato(req.empresaId, null));
});

r.put('/remesas/formato/cliente/:id', gestionar, async (req, res) => {
  const cliente = await clienteValido(req, id.parse(req.params.id));
  const d = z.object({ logo: logoZ.optional(), remitente: texto(80), ciudadOrigen: texto(60), direccion: texto(80), sector: texto(60), destinatario: texto(80),
    cantidad: texto(30), clase: texto(30), contenido: texto(60), ajusteLogo: ajusteZ.optional() }).parse(req.body || {});
  if (d.ajusteLogo) d.ajusteLogo = R.ajusteDe('logoCliente', d.ajusteLogo);
  const set = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => [`remesaFormato.${k}`, v]));
  await Cliente.updateOne({ _id: cliente, empresa: req.empresaId }, { $set: set });
  await auditar(req, 'remesas_formato_cliente', { entidad: 'Cliente', entidadId: cliente, detalle: { ...d, logo: d.logo ? '(logo)' : undefined } });
  res.json(await R.formato(req.empresaId, cliente));
});

// Muestra en PDF de cómo queda la remesa con lo que está en pantalla (sin guardar): textos, logos nuevos y su posición
r.post('/remesas/formato/muestra', ver, async (req, res) => {
  const cliente = await clienteValido(req, clienteDe(req.body?.cliente));
  const d = z.object({ logo: logoZ.optional(), logoCliente: logoZ.optional(), nombre1: texto(80), nombre2: texto(80), nit: texto(40), lema: texto(120), resolucion: texto(300),
    remitente: texto(80), ciudadOrigen: texto(60), direccion: texto(80), sector: texto(60), destinatario: texto(80), cantidad: texto(30), clase: texto(30), contenido: texto(60),
    ajusteLogo: ajusteZ.optional(), ajusteLogoCliente: ajusteZ.optional() }).parse(req.body || {});
  const f = await R.formato(req.empresaId, cliente);
  for (const [k, v] of Object.entries(d)) if (v !== undefined) f[k] = v;
  f.ajusteLogo = R.ajusteDe('logo', d.ajusteLogo ?? f.ajusteLogo); f.ajusteLogoCliente = R.ajusteDe('logoCliente', d.ajusteLogoCliente ?? f.ajusteLogoCliente);
  const ejemplo = { vpl: '12031', remesa: String(f.siguiente), fecha: new Date(), zona: 'PASTO', peso: 2584, manifiesto: 'URBANO', conductor: 'NOMBRE DEL CONDUCTOR',
    cedula: '12345678', direccion: 'Pasto - Nariño', placa: 'ABC123', costo: 229000 };
  const buf = await R.remesasPdf(f, [ejemplo], { porHoja: 1, linea: false });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="Muestra_remesa.pdf"');
  res.send(buf);
});

// Carga del Excel: vista previa (no guarda) y guardado con los VPL elegidos
r.post('/remesas/previa', gestionar, crudo, async (req, res) => {
  const cliente = await clienteValido(req, clienteDe(req.query.cliente));
  if (!cliente) throw new ErrorHttp(400, 'Elija la empresa (cliente) de la base');
  res.json(await R.previa(req.empresaId, cliente, req.body));
});
r.post('/remesas/importar', gestionar, crudo, async (req, res) => {
  const cliente = await clienteValido(req, clienteDe(req.query.cliente));
  if (!cliente) throw new ErrorHttp(400, 'Elija la empresa (cliente) de la base');
  const modo = req.query.modo === 'reemplazar' ? 'reemplazar' : 'omitir';
  // Selección compacta (rangos de VPL): ver R.leerSeleccion
  const h = req.get('x-seleccion');
  if (h && h.length > 6000) throw new ErrorHttp(400, 'La selección de viajes es muy larga: use «Marcar todos» o «Solo nuevos» y quite los que no van');
  const seleccion = h ? R.leerSeleccion(h, (await R.leerBase(req.body)).filas.map(x => x.vpl)) : null;
  const x = await R.guardar(req.empresaId, cliente, req.body, { modo, seleccion, archivo: nombreArchivo(req) });
  await auditar(req, 'remesas_importar', { entidad: 'Cliente', entidadId: cliente, detalle: { ...x, archivo: nombreArchivo(req), modo } });
  res.json(x);
});

// Corregir una remesa (la cédula escrita aquí sirve para las próximas del mismo conductor)
r.put('/remesas/:id', gestionar, async (req, res) => {
  const d = z.object({ fecha: z.string().optional(), zona: texto(120), peso: z.coerce.number().min(0).max(1e7).optional(), manifiesto: texto(40),
    conductor: texto(80), cedula: z.string().trim().max(15).regex(/^[0-9.\s]*$/, 'La cédula solo lleva números').optional(), direccion: texto(80),
    placa: texto(8), remesa: z.string().trim().max(12).regex(/^\d*$/, 'El número de remesa solo lleva números').optional(), costo: z.coerce.number().min(0).max(1e10).optional() }).parse(req.body || {});
  const x = await RemesaDulces.findOne({ _id: id.parse(req.params.id), empresa: req.empresaId });
  if (!x) throw new ErrorHttp(404, 'Remesa no encontrada');
  if (d.remesa !== undefined && d.remesa !== (x.remesa || '') && x.impreso) throw new ErrorHttp(409, `La remesa ${x.remesa} ya se imprimió: su número no se cambia`);
  if (d.remesa && d.remesa !== x.remesa && await RemesaDulces.exists({ empresa: req.empresaId, _id: { $ne: x._id }, $or: [{ remesa: d.remesa }, { remesaNum: Number(d.remesa) }] })) throw new ErrorHttp(409, `La remesa ${d.remesa} ya la tiene otro viaje`);
  for (const [k, v] of Object.entries(d)) if (v !== undefined) x[k] = k === 'fecha' ? (R.fechaValida(v) || x.fecha) : k === 'cedula' ? v.replace(/\D/g, '') : k === 'placa' ? v.replace(/[\s-]/g, '').toUpperCase() : v;
  if (d.remesa !== undefined) x.remesaNum = d.remesa ? Number(d.remesa) : null;
  await x.save();
  if (d.remesa) await Empresa.updateOne({ _id: req.empresaId, 'remesaFormato.siguiente': { $lte: Number(d.remesa) } }, { $set: { 'remesaFormato.siguiente': Number(d.remesa) + 1 } });
  await auditar(req, 'remesa_editar', { entidad: 'RemesaDulces', entidadId: x._id, detalle: { vpl: x.vpl, ...d } });
  res.json(x);
});

r.delete('/remesas/:id', gestionar, async (req, res) => {
  const x = await RemesaDulces.findOne({ _id: id.parse(req.params.id), empresa: req.empresaId });
  if (!x) throw new ErrorHttp(404, 'Remesa no encontrada');
  if (x.impreso) throw new ErrorHttp(409, 'La remesa ya se imprimió; no se puede eliminar');
  await x.deleteOne();
  await auditar(req, 'remesa_eliminar', { entidad: 'RemesaDulces', entidadId: x._id, detalle: { vpl: x.vpl, remesa: x.remesa } });
  res.json({ ok: true });
});

// PDF (ver o imprimir) y .zip con un PDF por remesa
const salidaZ = z.object({ ids: z.array(id).min(1).max(1000), porHoja: z.coerce.number().int().refine(v => v === 1 || v === 2).optional(),
  linea: z.boolean().optional(), marcar: z.boolean().optional().default(true) });
async function paraSalida(req) {
  const d = salidaZ.parse(req.body || {});
  const lista = await RemesaDulces.find({ empresa: req.empresaId, _id: { $in: d.ids } }).lean();
  if (!lista.length) throw new ErrorHttp(404, 'No se encontraron las remesas elegidas');
  const clientes = [...new Set(lista.map(x => String(x.cliente || '')))];
  const formatos = new Map();
  for (const c of clientes) formatos.set(c, await R.formato(req.empresaId, c || null));
  const f0 = formatos.get(clientes[0]);
  return { d, lista: R.ordenar(lista), formatos, opciones: { porHoja: d.porHoja || f0.porHoja, linea: d.linea ?? f0.linea } };
}
async function marcarImpresas(req, lista) {
  await RemesaDulces.updateMany({ empresa: req.empresaId, _id: { $in: lista.map(x => x._id) } },
    { $set: { impreso: new Date(), impresoPor: String(req.usuario?.nombre || req.usuario?.email || '').slice(0, 120) }, $inc: { impresiones: 1 } });
}
// Cada remesa impresa se guarda una vez (su PDF de media hoja) y desde ahí se vuelve a imprimir, ver o descargar.
// Si después se corrige un dato de una remesa impresa (p. ej. la cédula), la siguiente impresión es otra versión y la
// anterior queda guardada. Una remesa sin imprimir (solo «Ver») se genera cada vez: todavía es borrador.
const huellaRemesa = (x) => crypto.createHash('sha1').update(JSON.stringify([x.vpl, x.remesa, x.fecha ? new Date(x.fecha).toISOString().slice(0, 10) : '', x.zona, x.peso,
  x.manifiesto, x.conductor, x.cedula, x.direccion, x.placa, x.costo, String(x.cliente || '')])).digest('hex').slice(0, 16);
async function pdfsDeRemesas(req, lista, formatos, guardarTodas) {
  const out = [];
  for (const x of lista) {
    const f = formatos.get(String(x.cliente || ''));
    const generar = () => R.remesasPdfVarios([{ x, f }], { porHoja: 1, linea: false });
    const nombre = `Remesa_${x.remesa || 'sin_numero'}_VPL_${x.vpl}.pdf`.replace(/[^\w.-]/g, '_');
    if (guardarTodas || x.impreso) {
      const g = await pdfGuardado(req.empresaId, { tipo: 'remesa-cliente', ref: x._id, clave: `${x.remesa}:${huellaRemesa(x)}`, nombre, generar, usuario: req.usuario._id });
      out.push({ x, nombre, buffer: g.buffer, guardada: true });
    } else out.push({ x, nombre, buffer: await generar(), guardada: false });
  }
  return out;
}
r.post('/remesas/pdf', gestionar, async (req, res) => {
  const { d, lista, formatos, opciones } = await paraSalida(req);
  // Al imprimir (marcar) se guardan; la hoja (1 o 2 por hoja) se arma con esos PDF sin volver a generarlos
  const pdfs = await pdfsDeRemesas(req, lista, formatos, d.marcar);
  const buf = await componerMediasHojas(pdfs.map(p => ({ buffer: p.buffer, completa: false })),
    { desplazamiento: 792 / 2 - 2, linea: opciones.linea, textoLinea: 'cortar aquí', porHoja: opciones.porHoja });
  if (d.marcar) await marcarImpresas(req, lista);
  await auditar(req, 'remesas_pdf', { detalle: { remesas: lista.map(x => x.remesa), ...opciones, marcar: d.marcar } });
  const nombre = (lista.length === 1 ? `Remesa_${lista[0].remesa}_VPL_${lista[0].vpl}.pdf` : 'Remesas.pdf').replace(/[^\w.-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
  res.send(buf);
});
r.post('/remesas/zip', gestionar, async (req, res) => {
  const { d, lista, formatos } = await paraSalida(req);
  // Cada PDF del .zip lleva sus logos: más de 100 lo vuelve muy pesado (para muchas, mejor un solo PDF)
  if (lista.length > 100) throw new ErrorHttp(400, 'El .zip va hasta 100 remesas. Para más, use «Ver PDF» o «Imprimir» (un solo PDF).');
  const z = new JSZip();
  for (const p of await pdfsDeRemesas(req, lista, formatos, d.marcar)) z.file(p.nombre, p.buffer);
  const zip = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (d.marcar) await marcarImpresas(req, lista);
  await auditar(req, 'remesas_zip', { detalle: { remesas: lista.map(x => x.remesa) } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Remesas.zip"');
  res.send(zip);
});

export default r;
