// Contabilidad fase 2: proveedores, compras (causación) con retenciones y XML de la DIAN, comprobantes de
// egreso (PDF, correo y WhatsApp) y conciliación bancaria. Se monta dentro de /api/gestion (ya autenticado).
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa, ProveedorCont, CompraCont, EgresoCont, ConciliacionCont } from '../models/index.js';
import { permitir, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha, fmtFecha } from '../utils/texto.js';
import * as compras from '../services/gestion/compras.js';
import { parametros } from '../services/gestion/contabilidad.js';
import { enviarManual } from '../services/correo.js';

const r = Router();
const ver = permitir(P.CONTABILIDAD_VER); const gestionar = permitir(P.CONTABILIDAD_GESTIONAR);
const id = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const fechaObligatoria = (v) => { const f = parseFecha(v); if (!f) throw new ErrorHttp(400, 'Fecha inválida'); return f; };
const empresaDe = (req) => Empresa.findById(req.empresaId).lean();

// ── Proveedores ─────────────────────────────────────────────────────────────
const proveedor = z.object({
  tipoId: z.enum(['N', 'C', 'E', 'P']).default('N'), nit: z.string().trim().min(3).max(20), dv: z.string().max(1).optional().default(''),
  nombre: z.string().trim().min(2).max(160), correo: z.string().trim().max(120).optional().default(''), telefono: z.string().max(30).optional().default(''),
  whatsapp: z.string().max(20).optional().default(''), direccion: z.string().max(160).optional().default(''), ciudad: z.string().max(80).optional().default(''),
  fiscal: z.object({ regimen: z.enum(['ordinario', 'simple', 'no_responsable_iva', 'especial']).default('ordinario'), responsableIva: z.boolean().default(true),
    declarante: z.boolean().default(true), autorretenedor: z.boolean().default(false), granContribuyente: z.boolean().default(false),
    ciiu: z.string().max(6).optional().default(''), reteIcaPorMil: z.coerce.number().min(0).max(30).default(0) }).default({}),
  conceptoRetencion: z.enum(Object.keys(compras.CONCEPTOS_RETENCION)).default('servicios'),
  cuentaGasto: z.string().regex(/^\d{4,10}$/).default('5195'),
  banco: z.object({ entidad: z.string().max(60).optional().default(''), tipoCuenta: z.string().max(20).optional().default(''), cuenta: z.string().max(30).optional().default('') }).default({}),
  activo: z.boolean().default(true),
});
r.get('/contabilidad/proveedores', ver, async (req, res) => res.json(await ProveedorCont.find(deEmpresa(req)).sort({ nombre: 1 }).lean()));
r.post('/contabilidad/proveedores', gestionar, async (req, res) => {
  const p = await compras.guardarProveedor(req.empresaId, proveedor.parse(req.body));
  await auditar(req, 'crear_proveedor', { entidad: 'ProveedorCont', entidadId: p._id, detalle: { nit: p.nit, nombre: p.nombre } });
  res.status(201).json(p);
});
r.put('/contabilidad/proveedores/:id', gestionar, async (req, res) => {
  const p = await compras.guardarProveedor(req.empresaId, proveedor.parse(req.body), id.parse(req.params.id));
  await auditar(req, 'editar_proveedor', { entidad: 'ProveedorCont', entidadId: p._id, detalle: { nit: p.nit } });
  res.json(p);
});

// ── Retenciones (tabla de la empresa) ───────────────────────────────────────
r.get('/contabilidad/retenciones/tabla', ver, async (req, res) => {
  const p = await parametros(req.empresaId);
  res.json({ uvt: p.uvt, conceptos: compras.tablaRetenciones(p) });
});

// ── Compras ─────────────────────────────────────────────────────────────────
const linea = z.object({ cuenta: z.string().regex(/^\d{4,10}$/), descripcion: z.string().max(200).optional().default(''),
  base: z.coerce.number().min(0), ivaPct: z.coerce.number().min(0).max(100).default(0) });
const manual = z.object({ retefuentePct: z.coerce.number().min(0).max(20).optional(), reteIvaPct: z.coerce.number().min(0).max(100).optional(),
  reteIcaPorMil: z.coerce.number().min(0).max(30).optional() }).default({});
const compra = z.object({ proveedor: id, fecha: z.string(), vence: z.string().optional().default(''),
  tipoDocumento: z.enum(['factura', 'documento_soporte', 'cuenta_cobro', 'otro']).default('factura'), documento: z.string().max(40).optional().default(''),
  cufe: z.string().max(120).optional().default(''), lineas: z.array(linea).min(1).max(100),
  conceptoRetencion: z.enum(Object.keys(compras.CONCEPTOS_RETENCION)).optional(), manual,
  observaciones: z.string().max(300).optional().default(''), xml: z.string().max(900000).optional().default('') });

r.get('/contabilidad/compras', ver, async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.estado) f.estado = String(req.query.estado);
  if (mongoose.isValidObjectId(req.query.proveedor)) f.proveedor = req.query.proveedor;
  res.json(await CompraCont.find(f).sort({ fecha: -1, numero: -1 }).limit(500).lean());
});
r.post('/contabilidad/compras/vista-previa', ver, async (req, res) => {
  const d = compra.pick({ proveedor: true, lineas: true, conceptoRetencion: true, manual: true }).parse(req.body);
  res.json(await compras.vistaPreviaCompra(req.empresaId, d));
});
r.post('/contabilidad/compras/leer-xml', gestionar, async (req, res) => {
  const { xml } = z.object({ xml: z.string().min(20).max(900000) }).parse(req.body);
  res.json(await compras.leerXmlEmpresa(req.empresaId, await empresaDe(req), xml));
});
r.post('/contabilidad/compras', gestionar, async (req, res) => {
  const d = compra.parse(req.body);
  const c = await compras.causarCompra(req.empresaId, { ...d, fecha: fechaObligatoria(d.fecha), vence: parseFecha(d.vence) }, req.usuario._id);
  await auditar(req, 'causar_compra', { entidad: 'CompraCont', entidadId: c._id, detalle: { numero: c.numero, proveedor: c.proveedorNit, documento: c.documento, neto: c.neto } });
  const { xml, ...sinXml } = c.toObject();
  res.status(201).json(sinXml);
});
r.post('/contabilidad/compras/:numero/anular', gestionar, async (req, res) => {
  const c = await compras.anularCompra(req.empresaId, req.params.numero);
  await auditar(req, 'anular_compra', { entidad: 'CompraCont', entidadId: c._id, detalle: { numero: c.numero } });
  res.json({ numero: c.numero, estado: c.estado });
});
// XML guardado como soporte de la compra
r.get('/contabilidad/compras/:numero/xml', ver, async (req, res) => {
  const c = await CompraCont.findOne(deEmpresa(req, { numero: req.params.numero })).select('+xml').lean();
  if (!c?.xml) throw new ErrorHttp(404, 'La compra no tiene XML');
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${`${c.numero}_${c.documento || 'factura'}`.replace(/[^\w.-]/g, '_')}.xml"`);
  res.send(c.xml);
});

// ── Comprobantes de egreso ──────────────────────────────────────────────────
const egreso = z.object({ fecha: z.string(), proveedor: id.optional(), beneficiario: z.string().max(160).optional().default(''),
  beneficiarioDoc: z.string().max(20).optional().default(''), cuenta: z.enum(['1110', '1105']).default('1110'),
  medio: z.enum(['transferencia', 'cheque', 'efectivo', 'consignacion']).default('transferencia'), referencia: z.string().max(60).optional().default(''),
  concepto: z.string().max(200).optional().default(''), gmf: z.boolean().optional(),
  pagos: z.array(z.object({ compra: z.string().max(20), valor: z.coerce.number().min(0) })).max(200).default([]),
  otros: z.array(z.object({ cuenta: z.string().regex(/^\d{4,10}$/), descripcion: z.string().max(200).optional().default(''), valor: z.coerce.number().min(0) })).max(50).default([]) });

r.get('/contabilidad/egresos', ver, async (req, res) => res.json(await EgresoCont.find(deEmpresa(req)).sort({ fecha: -1, numero: -1 }).limit(500).lean()));
r.post('/contabilidad/egresos', gestionar, async (req, res) => {
  const d = egreso.parse(req.body);
  const e = await compras.crearEgreso(req.empresaId, { ...d, fecha: fechaObligatoria(d.fecha) }, req.usuario._id);
  await auditar(req, 'comprobante_egreso', { entidad: 'EgresoCont', entidadId: e._id, detalle: { numero: e.numero, total: e.total, beneficiario: e.beneficiarioDoc } });
  res.status(201).json(e);
});
r.post('/contabilidad/egresos/:numero/anular', gestionar, async (req, res) => {
  const e = await compras.anularEgreso(req.empresaId, req.params.numero);
  await auditar(req, 'anular_egreso', { entidad: 'EgresoCont', entidadId: e._id, detalle: { numero: e.numero } });
  res.json(e);
});
r.get('/contabilidad/egresos/:numero/pdf', ver, async (req, res) => {
  const buf = await compras.egresoPdf(await empresaDe(req), req.empresaId, req.params.numero);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.ver === '1' ? 'inline' : 'attachment'}; filename="Egreso_${req.params.numero.replace(/[^\w-]/g, '_')}.pdf"`);
  res.send(buf);
});
// Envía el comprobante por correo (con la cuenta de correo de la empresa)
r.post('/contabilidad/egresos/:numero/enviar', gestionar, async (req, res) => {
  const { para } = z.object({ para: z.array(z.string().email()).min(1).max(5) }).parse(req.body);
  const e = await EgresoCont.findOne(deEmpresa(req, { numero: req.params.numero })).lean();
  if (!e) throw new ErrorHttp(404, 'Comprobante de egreso no encontrado');
  const empresa = await empresaDe(req);
  const pdf = await compras.egresoPdf(empresa, req.empresaId, e.numero);
  const texto = [`Buen día, ${e.beneficiario}:`, '', `Adjuntamos el comprobante de egreso ${e.numero} del ${fmtFecha(e.fecha)} por $ ${e.total.toLocaleString('es-CO')}.`,
    ...(e.pagos.length ? [`Corresponde al pago de: ${e.pagos.map(x => x.documento ? `factura ${x.documento}` : x.compra).join(', ')}.`] : []), '', 'Cordialmente,', String(empresa.nombre).toUpperCase()].join('\n');
  const r1 = await enviarManual(req.empresaId, { para, asunto: `Comprobante de egreso ${e.numero} - ${empresa.nombre}`, texto, usuario: req.usuario._id,
    adjuntos: [{ nombre: `Egreso_${e.numero}.pdf`, tipo: 'application/pdf', base64: pdf.toString('base64') }] });
  await auditar(req, 'enviar_egreso', { entidad: 'EgresoCont', entidadId: e._id, detalle: { numero: e.numero, para, estado: r1.estado } });
  res.json(r1);
});

// ── Conciliación bancaria ───────────────────────────────────────────────────
const conciliacion = z.object({ cuenta: z.string().regex(/^\d{4,10}$/).default('1110'), mes: z.string().regex(/^\d{4}-\d{2}$/),
  saldoExtracto: z.coerce.number(), dias: z.coerce.number().int().min(0).max(15).default(5), cerrar: z.boolean().optional().default(false),
  extracto: z.array(z.object({ fecha: z.string(), descripcion: z.string().max(200).optional().default(''), valor: z.coerce.number() })).max(3000).default([]) });
const conFechas = (d) => ({ ...d, extracto: d.extracto.map(x => ({ ...x, fecha: parseFecha(x.fecha) })).filter(x => x.fecha) });

r.get('/contabilidad/conciliaciones', ver, async (req, res) => res.json(await ConciliacionCont.find(deEmpresa(req)).select('-extracto').sort({ mes: -1 }).limit(60).lean()));
r.get('/contabilidad/conciliaciones/:mes', ver, async (req, res) => {
  const c = await ConciliacionCont.findOne(deEmpresa(req, { mes: req.params.mes, cuenta: String(req.query.cuenta || '1110') })).lean();
  if (!c) throw new ErrorHttp(404, 'No hay conciliación guardada de ese mes');
  res.json(c);
});
r.post('/contabilidad/conciliacion/calcular', ver, async (req, res) => res.json(await compras.calcularConciliacion(req.empresaId, conFechas(conciliacion.parse(req.body)))));
r.post('/contabilidad/conciliaciones', gestionar, async (req, res) => {
  const d = conFechas(conciliacion.parse(req.body));
  const c = await compras.guardarConciliacion(req.empresaId, d, req.usuario._id);
  await auditar(req, d.cerrar ? 'cerrar_conciliacion' : 'guardar_conciliacion', { detalle: { cuenta: c.cuenta, mes: c.mes, diferencia: c.diferencia } });
  res.json(c);
});

export default r;
