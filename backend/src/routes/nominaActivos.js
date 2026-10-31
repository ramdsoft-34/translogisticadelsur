// Contabilidad fase 4: empleados y nómina, activos fijos y depreciación, cierre anual y notas crédito/débito.
// Se monta dentro de /api/gestion (ya autenticado).
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Empresa, Empleado, Nomina, ActivoFijo, Asiento } from '../models/index.js';
import { permitir, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha } from '../utils/texto.js';
import { libroExcel } from '../services/reportes/comun.js';
import * as nom from '../services/gestion/nomina.js';
import { guardarParametros } from '../services/gestion/contabilidad.js';

const r = Router();
const ver = permitir(P.CONTABILIDAD_VER); const gestionar = permitir(P.CONTABILIDAD_GESTIONAR);
// La nómina tiene permiso propio: salarios y datos personales de los empleados solo para quien liquida la nómina
const verNom = permitir(P.NOMINA_VER); const gestNom = permitir(P.NOMINA_GESTIONAR);
const id = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const fechaQ = (v) => { const f = parseFecha(v); if (!f) throw new ErrorHttp(400, 'Fecha inválida'); return f; };
const empresaDe = (req) => Empresa.findById(req.empresaId).lean();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── Empleados ───────────────────────────────────────────────────────────────
const empleado = z.object({ tipoId: z.enum(['CC', 'CE', 'PA', 'TI', 'PEP', 'PPT']).default('CC'), numId: z.string().trim().regex(/^[0-9A-Za-z]{3,20}$/),
  nombres: z.string().trim().min(2).max(80), apellidos: z.string().trim().max(80).optional().default(''), cargo: z.string().max(80).optional().default(''),
  correo: z.string().max(120).optional().default(''), telefono: z.string().max(30).optional().default(''), salario: z.coerce.number().min(0),
  tipoSalario: z.enum(['ordinario', 'integral']).default('ordinario'), tipoContrato: z.enum(['indefinido', 'fijo', 'obra', 'aprendiz']).default('indefinido'),
  fechaIngreso: z.string(), fechaRetiro: z.string().optional().nullable(), nivelRiesgoArl: z.coerce.number().int().min(1).max(5).default(1),
  eps: z.string().max(60).optional().default(''), afp: z.string().max(60).optional().default(''), caja: z.string().max(60).optional().default(''),
  cesantiasFondo: z.string().max(60).optional().default(''),
  banco: z.object({ entidad: z.string().max(60).optional().default(''), tipoCuenta: z.string().max(20).optional().default(''), cuenta: z.string().max(30).optional().default('') }).default({}),
  activo: z.boolean().default(true) });
const conFechas = (d) => ({ ...d, fechaIngreso: fechaQ(d.fechaIngreso), fechaRetiro: d.fechaRetiro ? fechaQ(d.fechaRetiro) : null });

r.get('/nomina/empleados', verNom, async (req, res) => res.json(await Empleado.find(deEmpresa(req)).sort({ activo: -1, nombres: 1 }).lean()));
r.post('/nomina/empleados', gestNom, async (req, res) => {
  const d = conFechas(empleado.parse(req.body));
  if (await Empleado.exists(deEmpresa(req, { numId: d.numId }))) throw new ErrorHttp(409, `Ya existe un empleado con el documento ${d.numId}`);
  const e = await Empleado.create({ ...d, empresa: req.empresaId });
  await auditar(req, 'crear_empleado', { entidad: 'Empleado', entidadId: e._id, detalle: { numId: e.numId } });
  res.status(201).json(e);
});
r.put('/nomina/empleados/:id', gestNom, async (req, res) => {
  const d = conFechas(empleado.parse(req.body));
  const e = await Empleado.findOneAndUpdate(deEmpresa(req, { _id: id.parse(req.params.id) }), { $set: d }, { new: true, runValidators: true });
  if (!e) throw new ErrorHttp(404, 'Empleado no encontrado');
  await auditar(req, 'editar_empleado', { entidad: 'Empleado', entidadId: e._id, detalle: { numId: e.numId } });   // sin el salario: el registro de auditoría lo ven más personas
  res.json(e);
});
// Salario mínimo, auxilio de transporte y exoneración de aportes
r.put('/nomina/parametros', gestNom, async (req, res) => {
  const d = z.object({ smmlv: z.coerce.number().int().min(100000), auxilioTransporte: z.coerce.number().int().min(0), exoneradaAportes: z.boolean(),
    prefijoDocumentoSoporte: z.string().trim().max(6).optional() }).parse(req.body);
  res.json(await guardarParametros(req.empresaId, d));
});

// ── Nómina ──────────────────────────────────────────────────────────────────
const novedad = z.object({ dias: z.coerce.number().min(0).max(30).optional(), horasExtras: z.coerce.number().min(0).optional(), bonificaciones: z.coerce.number().min(0).optional(),
  noSalariales: z.coerce.number().min(0).optional(), retencion: z.coerce.number().min(0).optional(), otrasDeducciones: z.coerce.number().min(0).optional() });
const liquidacion = z.object({ periodo: z.string(), novedades: z.record(z.string(), novedad).optional().default({}) });

r.get('/nomina', verNom, async (req, res) => res.json(await Nomina.find(deEmpresa(req)).select('-lineas').sort({ fecha: -1 }).limit(60).lean()));
r.get('/nomina/:numero', verNom, async (req, res) => {
  const n = await Nomina.findOne(deEmpresa(req, { numero: req.params.numero })).lean();
  if (!n) throw new ErrorHttp(404, 'Nómina no encontrada');
  res.json(n);
});
r.post('/nomina/calcular', verNom, async (req, res) => res.json(await nom.calcularNomina(req.empresaId, liquidacion.parse(req.body))));
r.post('/nomina', gestNom, async (req, res) => {
  const n = await nom.liquidarNomina(req.empresaId, { ...liquidacion.parse(req.body), usuario: req.usuario._id });
  await auditar(req, 'liquidar_nomina', { entidad: 'Nomina', entidadId: n._id, detalle: { numero: n.numero, neto: n.totales.neto } });
  res.status(201).json(n);
});
r.post('/nomina/:numero/anular', gestNom, async (req, res) => {
  const n = await nom.anularNomina(req.empresaId, req.params.numero);
  await auditar(req, 'anular_nomina', { entidad: 'Nomina', entidadId: n._id, detalle: { numero: n.numero } });
  res.json({ numero: n.numero, estado: n.estado });
});
r.post('/nomina/:numero/pagar', gestNom, async (req, res) => {
  const d = z.object({ que: z.enum(['empleados', 'aportes']), fecha: z.string(), cuenta: z.enum(['1110', '1105']).default('1110') }).parse(req.body);
  const p = await nom.pagarNomina(req.empresaId, req.params.numero, { ...d, fecha: fechaQ(d.fecha), usuario: req.usuario._id });
  await auditar(req, d.que === 'empleados' ? 'pagar_nomina' : 'pagar_pila', { detalle: p });
  res.json(p);
});
r.get('/nomina/:numero/desprendible/:numId', verNom, async (req, res) => {
  const buf = await nom.desprendiblePdf(await empresaDe(req), req.empresaId, req.params.numero, req.params.numId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.ver === '1' ? 'inline' : 'attachment'}; filename="Desprendible_${req.params.numero}_${req.params.numId.replace(/\W/g, '')}.pdf"`);
  res.send(buf);
});
r.get('/nomina/:numero/electronica', verNom, async (req, res) => {
  const x = await nom.nominaElectronica(req.empresaId, req.params.numero);
  if (req.query.formato !== 'xlsx') return res.json(x);
  const buf = await libroExcel({ empresa: await empresaDe(req), titulo: x.titulo, subtitulo: 'Datos para el proveedor de nómina electrónica (DIAN)',
    columnas: x.columnas.map((c, i) => ({ titulo: c, ancho: i === 3 ? 32 : 14, formato: i >= 5 ? '#,##0' : undefined })), filas: x.filas });
  res.setHeader('Content-Type', XLSX); res.setHeader('Content-Disposition', `attachment; filename="Nomina_electronica_${req.params.numero}.xlsx"`);
  res.send(buf);
});

// ── Activos fijos ───────────────────────────────────────────────────────────
const activo = z.object({ codigo: z.string().trim().max(20).optional().default(''), nombre: z.string().trim().min(2).max(120), cuenta: z.string().regex(/^15\d{2,8}$/),
  placa: z.string().max(7).optional().default(''), fechaCompra: z.string(), costo: z.coerce.number().positive(), valorResidual: z.coerce.number().min(0).default(0),
  vidaUtilMeses: z.coerce.number().int().min(1).max(1200), depreciacionAcumulada: z.coerce.number().min(0).default(0),
  cuentaPago: z.enum(['', '1110', '1105', '2335']).optional().default('') });
r.get('/activos', ver, async (req, res) => res.json((await ActivoFijo.find(deEmpresa(req)).sort({ codigo: 1 }).lean())
  .map(a => ({ ...a, valorEnLibros: a.costo - a.depreciacionAcumulada, cuotaMensual: nom.cuotaDepreciacion(a) }))));
r.post('/activos', gestionar, async (req, res) => {
  const d = activo.parse(req.body);
  const a = await nom.crearActivo(req.empresaId, { ...d, fechaCompra: fechaQ(d.fechaCompra), cuentaPago: d.cuentaPago || null }, req.usuario._id);
  await auditar(req, 'crear_activo', { entidad: 'ActivoFijo', entidadId: a._id, detalle: { codigo: a.codigo, costo: a.costo } });
  res.status(201).json(a);
});
r.post('/activos/depreciar', gestionar, async (req, res) => {
  const { mes } = z.object({ mes: z.string() }).parse(req.body);
  const x = await nom.depreciarMes(req.empresaId, mes, req.usuario._id);
  await auditar(req, 'depreciacion', { detalle: x });
  res.json(x);
});
r.post('/activos/depreciar/:mes/anular', gestionar, async (req, res) => {
  const x = await nom.anularDepreciacion(req.empresaId, req.params.mes);
  await auditar(req, 'anular_depreciacion', { detalle: x });
  res.json(x);
});
r.post('/activos/:codigo/baja', gestionar, async (req, res) => {
  const d = z.object({ fecha: z.string(), precio: z.coerce.number().min(0).default(0), cuentaCobro: z.enum(['1110', '1105', '1380']).default('1110'),
    motivo: z.string().max(200).optional().default('') }).parse(req.body);
  const x = await nom.darDeBaja(req.empresaId, req.params.codigo, { ...d, fecha: fechaQ(d.fecha), usuario: req.usuario._id });
  await auditar(req, 'baja_activo', { detalle: x });
  res.json(x);
});

// ── Cierre anual ────────────────────────────────────────────────────────────
r.get('/cierre-anual', ver, async (req, res) => res.json((await Asiento.find(deEmpresa(req, { origen: 'CIE' })).sort({ fecha: -1 }).lean())
  .map(a => ({ documento: a.documento, fecha: a.fecha, asiento: a.numero, estado: a.estado, concepto: a.concepto,
    resultado: a.lineas.filter(l => l.cuenta === '3605').reduce((t, l) => t + l.credito, 0) - a.lineas.filter(l => l.cuenta === '3610').reduce((t, l) => t + l.debito, 0) }))));
r.post('/cierre-anual', gestionar, async (req, res) => {
  const { anio } = z.object({ anio: z.coerce.number().int().min(2000).max(2100) }).parse(req.body);
  const x = await nom.cierreAnual(req.empresaId, anio, req.usuario._id);
  await auditar(req, 'cierre_anual', { detalle: x });
  res.status(201).json(x);
});
r.post('/cierre-anual/:anio/anular', gestionar, async (req, res) => {
  const x = await nom.anularCierre(req.empresaId, req.params.anio);
  await auditar(req, 'anular_cierre_anual', { detalle: x });
  res.json(x);
});

// ── Notas crédito y débito ──────────────────────────────────────────────────
r.post('/contabilidad/facturas/:numero/notas', gestionar, async (req, res) => {
  const d = z.object({ tipo: z.enum(['CREDITO', 'DEBITO']), valor: z.coerce.number().positive(), motivo: z.string().trim().min(3).max(200),
    fecha: z.string().optional(), cude: z.string().max(120).optional().default('') }).parse(req.body);
  const x = await nom.crearNota(req.empresaId, req.params.numero, { ...d, fecha: d.fecha ? fechaQ(d.fecha) : new Date(), usuario: req.usuario._id });
  await auditar(req, 'nota_factura', { detalle: x });
  res.status(201).json(x);
});
r.post('/contabilidad/facturas/:numero/notas/:nota/anular', gestionar, async (req, res) => {
  const x = await nom.anularNota(req.empresaId, req.params.numero, req.params.nota);
  await auditar(req, 'anular_nota_factura', { detalle: x });
  res.json(x);
});

export default r;
