// Módulos de gestión de la plantilla de Excel: liquidación del conductor, préstamos,
// contabilidad, cierre de mes, relaciones, soporte interno MC/RC y remesas de Dulces & Dulces.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import express from 'express';
import { Empresa, Viaje, Tarifa, Cliente, LiquidacionConductor, Prestamo, CuentaContable, Asiento, FacturaCont, RemesaDulces, Tercero, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha, fmtFecha, txt, normalizar } from '../utils/texto.js';
import { libroExcel, nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../services/reportes/comun.js';
import { lineaLiquidacion } from '../services/calculos.js';
import * as liq from '../services/gestion/liquidacionConductor.js';
import * as pre from '../services/gestion/prestamos.js';
import * as cont from '../services/gestion/contabilidad.js';
import * as cierre from '../services/gestion/cierre.js';
import { soporteInterno } from '../services/gestion/soporteInterno.js';
import { manifiestoPdf } from '../services/reportes/manifiesto.js';
import * as dulces from '../services/gestion/remesasDulces.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const id = z.string().refine(v => mongoose.isValidObjectId(v), 'identificador inválido');
const fechaQ = (v, def) => parseFecha(v) || def;
const hoy = () => new Date();
const inicioMes = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
const finDia = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));
const empresaDe = (req) => Empresa.findById(req.empresaId).lean();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const $ = (n) => Math.round(Number(n) || 0);
function archivo(res, buf, nombre, tipo, ver = false) {
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `${ver ? 'inline' : 'attachment'}; filename="${nombre.replace(/[^\w.-]/g, '_')}"`);
  res.send(buf);
}
async function pdfTabla(req, { titulo, subtitulo, columnas, filas, total, extra }) {
  const empresa = await empresaDe(req);
  const doc = nuevoPdf(titulo);
  encabezadoPdf(doc, { empresa, titulo, subtitulo });
  tablaPdf(doc, columnas, filas, { total });
  if (extra) extra(doc);
  numerarPaginas(doc);
  return pdfABuffer(doc);
}
const PESOS = '#,##0';

// ═════════════ Liquidación del conductor ═════════════
const verLiq = permitir(P.LIQUIDACION_VER); const gestionar = permitir(P.LIQUIDACION_GESTIONAR);
const rango = z.object({ desde: z.string(), hasta: z.string(), q: z.string().max(80).optional().default(''), placa: z.string().max(7).optional().default(''),
  incluirLiquidados: z.boolean().optional().default(false) });

r.post('/liq-conductores/calcular', verLiq, async (req, res) => {
  const d = rango.parse(req.body);
  const desde = parseFecha(d.desde); const hasta = parseFecha(d.hasta);
  if (!desde || !hasta) throw new ErrorHttp(400, 'Fechas inválidas');
  const c = await liq.calcular(req.empresaId, { ...d, desde, hasta: finDia(hasta) });
  // Cuotas de préstamos vencidas al corte, por cédula (se descuentan al liquidar)
  const prestamos = {};
  for (const ced of new Set(c.lineas.map(l => l.cedula).filter(Boolean))) {
    const p = await pre.cuotaPendiente(req.empresaId, ced, finDia(hasta));
    if (p.total) prestamos[ced] = p;
  }
  res.json({ ...c, prestamos });
});

r.post('/liq-conductores', gestionar, async (req, res) => {
  const d = z.object({ viajes: z.array(id).min(1).max(500), desde: z.string(), hasta: z.string(), descontarPrestamos: z.boolean().optional().default(true) }).parse(req.body);
  const r1 = await liq.liquidar(req.empresaId, { ...d, desde: parseFecha(d.desde), hasta: finDia(parseFecha(d.hasta)), usuario: req.usuario._id });
  await auditar(req, 'liquidar_conductor', { entidad: 'LiquidacionConductor', entidadId: r1.liquidacion._id, detalle: { numero: r1.liquidacion.numero, neto: r1.liquidacion.neto } });
  res.status(201).json(r1);
});

r.get('/liq-conductores', verLiq, async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.q) { const re = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); f.$or = [{ numero: re }, { conductorNombre: re }, { placa: re }, { cedula: re }]; }
  res.json(await LiquidacionConductor.find(f).select('-lineas').sort({ createdAt: -1 }).limit(300).lean());
});

r.post('/liq-conductores/:numero/anular', gestionar, async (req, res) => {
  const l = await liq.anularLiquidacion(req.empresaId, req.params.numero);
  await auditar(req, 'anular_liquidacion_conductor', { entidad: 'LiquidacionConductor', entidadId: l._id, detalle: { numero: l.numero } });
  res.json(l);
});

const COL_LC = [{ titulo: 'Fecha', peso: 1 }, { titulo: 'Placa', peso: 0.8 }, { titulo: 'Empresa', peso: 1.4 }, { titulo: 'Destino', peso: 1.6 },
  { titulo: 'Manifiesto', peso: 1 }, { titulo: 'Flete', peso: 1, alin: 'right' }, { titulo: 'Anticipo', peso: 1, alin: 'right' },
  { titulo: 'Retefuente', peso: 1, alin: 'right' }, { titulo: 'FOPAT', peso: 0.8, alin: 'right' }, { titulo: 'Saldo', peso: 1, alin: 'right' }];
r.get('/liq-conductores/:numero/:formato', verLiq, async (req, res) => {
  if (!['pdf', 'xlsx'].includes(req.params.formato)) throw new ErrorHttp(404, 'Formato no disponible');
  const l = await LiquidacionConductor.findOne(deEmpresa(req, { numero: req.params.numero })).lean();
  if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
  const filas = l.lineas.map(x => [fmtFecha(x.fecha), x.placa, x.empresa, x.destino, x.manifiesto, $(x.flete), $(x.anticipo), $(x.retefuente), $(x.fopat), $(x.saldo)]);
  const total = ['TOTAL', '', '', '', '', $(l.flete), $(l.anticipo), $(l.retefuente), $(l.fopat), $(l.flete - l.anticipo - l.retefuente - l.fopat)];
  const titulo = `Liquidación ${l.numero} - ${l.conductorNombre}`;
  const subtitulo = `C.C. ${l.cedula} · Placa ${l.placa} · Del ${fmtFecha(l.desde)} al ${fmtFecha(l.hasta)}${l.estado === 'ANULADA' ? ' · ANULADA' : ''}`;
  if (req.params.formato === 'xlsx') {
    const fmt = (x) => x.toLocaleString('es-CO');
    return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo,
      columnas: COL_LC.map((c, i) => ({ ...c, ancho: i > 4 ? 14 : 16, formato: i > 4 ? PESOS : undefined })),
      filas: [...filas, [], ['Descuento préstamos', '', '', '', '', '', '', '', '', -$(l.descuentoPrestamos)], ['NETO A PAGAR', '', '', '', '', '', '', '', '', $(l.neto)]], total }), `${l.numero}.xlsx`, XLSX);
  }
  const buf = await pdfTabla(req, { titulo, subtitulo, columnas: COL_LC, filas: filas.map(f => f.map((v, i) => (i > 4 ? `$ ${v.toLocaleString('es-CO')}` : v))),
    total: total.map((v, i) => (i > 4 ? `$ ${v.toLocaleString('es-CO')}` : v)),
    extra: (doc) => {
      doc.font('Helvetica-Bold').fontSize(9).text(`Descuento préstamos: $ ${$(l.descuentoPrestamos).toLocaleString('es-CO')}`, { align: 'right' });
      doc.fontSize(11).text(`NETO A PAGAR: $ ${$(l.neto).toLocaleString('es-CO')}`, { align: 'right' });
      doc.moveDown(2).font('Helvetica').fontSize(9).text('_____________________________            _____________________________');
      doc.text('Firma conductor                                                  Firma empresa');
    } });
  archivo(res, buf, `${l.numero}.pdf`, 'application/pdf', req.query.ver === '1');
});

// ═════════════ Préstamos ═════════════
r.get('/prestamos', verLiq, async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.estado) f.estado = req.query.estado;
  const l = await Prestamo.find(f).sort({ createdAt: -1 }).limit(500).lean();
  res.json(l.map(p => ({ ...p, resumen: pre.resumenPrestamo(p), cuotas: p.cuotas.map(c => ({ ...c, estado: pre.estadoCuota(c) })) })));
});

r.post('/prestamos/simular', verLiq, async (req, res) => {
  const d = z.object({ capital: z.coerce.number().positive(), tasaMensual: z.coerce.number().min(0).max(20), nCuotas: z.coerce.number().int().min(1).max(120),
    primeraCuota: z.string().optional() }).parse(req.body);
  res.json(pre.planCuotas(d.capital, d.tasaMensual, d.nCuotas, parseFecha(d.primeraCuota) || pre.siguienteQuincena(new Date())));
});

r.post('/prestamos', gestionar, async (req, res) => {
  const d = z.object({ conductor: id, placa: z.string().max(7).optional().default(''), concepto: z.string().trim().min(3).max(200),
    capital: z.coerce.number().positive(), tasaMensual: z.coerce.number().min(0).max(20).default(0), nCuotas: z.coerce.number().int().min(1).max(120),
    primeraCuota: z.string().optional(), observacion: z.string().max(300).optional().default('') }).parse(req.body);
  const p = await pre.crearPrestamo(req.empresaId, { ...d, primeraCuota: parseFecha(d.primeraCuota), usuario: req.usuario._id });
  await auditar(req, 'crear_prestamo', { entidad: 'Prestamo', entidadId: p._id, detalle: { numero: p.numero, capital: p.capital } });
  res.status(201).json(p);
});

r.post('/prestamos/:numero/abonar', gestionar, async (req, res) => {
  const d = z.object({ valor: z.coerce.number().positive(), nota: z.string().max(200).optional().default('') }).parse(req.body);
  const r1 = await pre.abonar(req.empresaId, req.params.numero, d.valor, { origen: 'CAJA', nota: d.nota, usuario: req.usuario._id });
  await auditar(req, 'abono_prestamo', { entidad: 'Prestamo', detalle: { numero: req.params.numero, valor: r1.aplicado } });
  res.json({ aplicado: r1.aplicado, interes: r1.interes });
});

r.post('/prestamos/:numero/anular', gestionar, async (req, res) => {
  const d = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
  const p = await pre.anularPrestamo(req.empresaId, req.params.numero, d.motivo);
  await auditar(req, 'anular_prestamo', { entidad: 'Prestamo', entidadId: p._id, detalle: { numero: p.numero } });
  res.json(p);
});

r.get('/prestamos/:numero/pdf', verLiq, async (req, res) => {
  const p = await Prestamo.findOne(deEmpresa(req, { numero: req.params.numero })).lean();
  if (!p) throw new ErrorHttp(404, 'Préstamo no encontrado');
  const s = pre.resumenPrestamo(p);
  const m = (v) => `$ ${$(v).toLocaleString('es-CO')}`;
  const buf = await pdfTabla(req, { titulo: `Estado de cuenta ${p.numero} - ${p.conductorNombre}`,
    subtitulo: `C.C. ${p.cedula} · ${p.concepto} · Capital ${m(p.capital)} · ${p.tasaMensual}% mensual · ${p.nCuotas} cuotas quincenales de ${m(p.valorCuota)} · ${p.estado}`,
    columnas: [{ titulo: 'N°', peso: 0.4 }, { titulo: 'Fecha', peso: 1 }, { titulo: 'Cuota', peso: 1, alin: 'right' }, { titulo: 'Capital', peso: 1, alin: 'right' },
      { titulo: 'Interés', peso: 1, alin: 'right' }, { titulo: 'Abonado', peso: 1, alin: 'right' }, { titulo: 'Saldo capital', peso: 1, alin: 'right' },
      { titulo: 'Estado', peso: 0.9 }, { titulo: 'Liquidación', peso: 0.9 }],
    filas: p.cuotas.map(c => [c.n, fmtFecha(c.fecha), m(c.valor), m(c.capital), m(c.interes), m(c.abonado), m(c.saldoCapital), pre.estadoCuota(c), c.liquidacion || '']),
    total: ['', 'TOTAL', m(p.cuotas.reduce((a, c) => a + c.valor, 0)), m(p.capital), m(s.interes), m(s.pagado), '', `Pendiente ${m(s.pendiente)}`, ''] });
  archivo(res, buf, `${p.numero}.pdf`, 'application/pdf', req.query.ver === '1');
});

// ═════════════ Contabilidad ═════════════
r.get('/contabilidad/cuentas', verLiq, async (req, res) => {
  await cont.asegurarPuc(req.empresaId);
  res.json(await CuentaContable.find(deEmpresa(req)).sort({ codigo: 1 }).lean());
});
r.post('/contabilidad/cuentas', gestionar, async (req, res) => {
  const d = z.object({ codigo: z.string().regex(/^\d{4,10}$/), nombre: z.string().trim().min(3).max(120),
    tipo: z.enum(['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO']), naturaleza: z.enum(['D', 'C']) }).parse(req.body);
  if (await CuentaContable.exists(deEmpresa(req, { codigo: d.codigo }))) throw new ErrorHttp(409, 'Ya existe una cuenta con ese código');
  res.status(201).json(await CuentaContable.create({ ...d, empresa: req.empresaId }));
});
r.get('/contabilidad/asientos', verLiq, async (req, res) => {
  const desde = fechaQ(req.query.desde, inicioMes()); const hasta = finDia(fechaQ(req.query.hasta, hoy()));
  res.json(await cont.libroDiario(req.empresaId, desde, hasta));
});
r.post('/contabilidad/asientos', gestionar, async (req, res) => {
  const d = z.object({ fecha: z.string(), debito: z.string(), credito: z.string(), valor: z.coerce.number().positive(), concepto: z.string().trim().min(3).max(200),
    centroCosto: z.string().max(40).optional().default('') }).parse(req.body);
  const a = await cont.postear(req.empresaId, { fecha: parseFecha(d.fecha), concepto: d.concepto, centroCosto: d.centroCosto, origen: 'MAN', usuario: req.usuario._id,
    lineas: [[d.debito, d.valor], [d.credito, -d.valor]] });
  await auditar(req, 'asiento_manual', { entidad: 'Asiento', entidadId: a._id, detalle: { numero: a.numero } });
  res.status(201).json(a);
});
r.post('/contabilidad/asientos/:numero/anular', gestionar, async (req, res) => {
  const a = await cont.anularAsiento(req.empresaId, req.params.numero);
  await auditar(req, 'anular_asiento', { entidad: 'Asiento', entidadId: a._id, detalle: { numero: a.numero } });
  res.json(a);
});
r.get('/contabilidad/facturas', verLiq, async (req, res) => res.json(await FacturaCont.find(deEmpresa(req)).populate(pob(req.empresaId, 'cliente', 'nombre nit')).sort({ createdAt: -1 }).limit(300).lean()));
r.post('/contabilidad/facturas', gestionar, async (req, res) => {
  const d = z.object({ cliente: id, desde: z.string(), hasta: z.string(), retefuentePct: z.coerce.number().min(0).max(20).default(1), icaPct: z.coerce.number().min(0).max(5).default(0) }).parse(req.body);
  const f = await cont.facturar(req.empresaId, { ...d, desde: parseFecha(d.desde), hasta: finDia(parseFecha(d.hasta)), usuario: req.usuario._id });
  await auditar(req, 'factura_contable', { entidad: 'FacturaCont', entidadId: f._id, detalle: { numero: f.numero, neto: f.neto } });
  res.status(201).json(f);
});
r.post('/contabilidad/facturas/:numero/anular', gestionar, async (req, res) => {
  const f = await FacturaCont.findOne(deEmpresa(req, { numero: req.params.numero }));
  if (!f) throw new ErrorHttp(404, 'Factura no encontrada');
  if (f.cobrado > 0) throw new ErrorHttp(409, 'La factura ya tiene cobros: no se puede anular');
  await cont.anularAsiento(req.empresaId, f.asiento);
  f.estado = 'ANULADA'; await f.save();
  res.json(f);
});
r.post('/contabilidad/cobros', gestionar, async (req, res) => {
  const d = z.object({ factura: z.string(), valor: z.coerce.number().min(0).optional(), fecha: z.string().optional(), cuenta: z.enum(['1110', '1105']).default('1110') }).parse(req.body);
  res.json(await cont.cobrar(req.empresaId, { ...d, fecha: parseFecha(d.fecha) || hoy(), usuario: req.usuario._id }));
});
r.post('/contabilidad/pagos', gestionar, async (req, res) => {
  const d = z.object({ liquidacion: z.string(), valor: z.coerce.number().min(0).optional(), fecha: z.string().optional(), cuenta: z.enum(['1110', '1105']).default('1110') }).parse(req.body);
  res.json(await cont.pagarLiquidacion(req.empresaId, { ...d, fecha: parseFecha(d.fecha) || hoy(), usuario: req.usuario._id }));
});
r.post('/contabilidad/gastos', gestionar, async (req, res) => {
  const d = z.object({ fecha: z.string(), cuenta: z.string(), concepto: z.string().trim().min(3).max(200), valor: z.coerce.number().positive(),
    tercero: z.string().max(120).optional().default(''), formaPago: z.enum(['1110', '1105', '2335']).default('1110') }).parse(req.body);
  res.status(201).json(await cont.gasto(req.empresaId, { ...d, fecha: parseFecha(d.fecha), usuario: req.usuario._id }));
});

// Informes (JSON, o Excel con ?formato=xlsx)
r.get('/contabilidad/informes/:tipo', verLiq, async (req, res) => {
  const desde = fechaQ(req.query.desde, inicioMes()); const hasta = finDia(fechaQ(req.query.hasta, hoy()));
  const t = req.params.tipo;
  let datos; let columnas; let filas; let titulo;
  if (t === 'diario') {
    datos = await cont.libroDiario(req.empresaId, desde, hasta);
    titulo = 'Libro diario';
    columnas = ['Asiento', 'Fecha', 'Documento', 'Cuenta', 'Nombre', 'Tercero', 'Débito', 'Crédito', 'Concepto', 'Estado'];
    filas = datos.flatMap(a => a.lineas.map(l => [a.numero, fmtFecha(a.fecha), a.documento, l.cuenta, l.nombre, a.tercero, l.debito, l.credito, a.concepto, a.estado]));
  } else if (t === 'balance') {
    datos = await cont.balance(req.empresaId, hasta);
    titulo = `Balance general al ${fmtFecha(hasta)}`;
    columnas = ['Grupo', 'Cuenta', 'Nombre', 'Saldo'];
    filas = [...datos.activos.map(c => ['ACTIVO', c.codigo, c.nombre, c.saldo]), ['', '', 'TOTAL ACTIVOS', datos.totalActivos],
      ...datos.pasivos.map(c => ['PASIVO', c.codigo, c.nombre, c.saldo]), ['', '', 'TOTAL PASIVOS', datos.totalPasivos],
      ...datos.patrimonio.map(c => ['PATRIMONIO', c.codigo, c.nombre, c.saldo]), ['', '', 'RESULTADO DEL EJERCICIO', datos.resultadoEjercicio],
      ['', '', 'TOTAL PATRIMONIO', datos.totalPatrimonio + datos.resultadoEjercicio]];
  } else if (t === 'resultados') {
    datos = await cont.resultados(req.empresaId, desde, hasta);
    titulo = 'Estado de resultados';
    columnas = ['Grupo', 'Cuenta', 'Nombre', 'Valor'];
    filas = [...datos.ingresos.map(c => ['INGRESOS', c.codigo, c.nombre, c.saldo]), ['', '', 'TOTAL INGRESOS', datos.totalIngresos],
      ...datos.costos.map(c => ['COSTOS', c.codigo, c.nombre, c.saldo]), ...datos.gastos.map(c => ['GASTOS', c.codigo, c.nombre, c.saldo]),
      ['', '', 'UTILIDAD', datos.utilidad]];
  } else if (t === 'cxc') {
    datos = await cont.cuentasPorCobrar(req.empresaId); titulo = 'Cuentas por cobrar';
    columnas = ['Factura', 'Fecha', 'Cliente', 'Neto', 'Cobrado', 'Saldo'];
    filas = datos.map(f => [f.numero, fmtFecha(f.fecha), f.cliente, f.neto, f.cobrado, f.saldo]);
  } else if (t === 'cxp') {
    datos = await cont.cuentasPorPagar(req.empresaId); titulo = 'Cuentas por pagar a conductores';
    columnas = ['Liquidación', 'Fecha', 'Conductor', 'Placa', 'Neto', 'Pagado', 'Saldo'];
    filas = datos.map(l => [l.numero, fmtFecha(l.fecha), l.conductor, l.placa, l.neto, l.pagado, l.saldo]);
  } else if (t === 'retenciones') {
    datos = await cont.retenciones(req.empresaId, desde, hasta); titulo = 'Retenciones';
    columnas = ['Cuenta', 'Nombre', 'Débitos', 'Créditos', 'Saldo'];
    filas = datos.map(c => [c.codigo, c.nombre, c.debito, c.credito, c.saldo]);
  } else if (t === 'plan') {
    datos = await CuentaContable.find(deEmpresa(req)).sort({ codigo: 1 }).lean(); titulo = 'Plan de cuentas';
    columnas = ['Código', 'Cuenta', 'Tipo', 'Naturaleza'];
    filas = datos.map(c => [c.codigo, c.nombre, c.tipo, c.naturaleza]);
  } else throw new ErrorHttp(404, 'Informe no disponible');
  if (req.query.formato === 'xlsx') {
    return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo: `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · información de apoyo; debe ser revisada por un contador`,
      columnas: columnas.map(c => ({ titulo: c, ancho: 18, formato: /Débito|Crédito|Saldo|Valor|Neto|Cobrado|Pagado|Débitos|Créditos/.test(c) ? PESOS : undefined })), filas }), `${t}.xlsx`, XLSX);
  }
  res.json({ titulo, columnas, filas, datos });
});

// ═════════════ Cierre de mes ═════════════
const admin = permitir(P.CONFIG_GESTIONAR);
r.get('/cierres', verLiq, async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('cierres').populate('cierres.usuario', 'nombre').lean();
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : null;
  res.json({ cerrados: (e.cierres || []).sort((a, b) => b.mes.localeCompare(a.mes)), resumen: mes ? await cierre.resumenMes(req.empresaId, mes) : null });
});
r.post('/cierres', admin, async (req, res) => {
  const { mes } = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body);
  const resumen = await cierre.cerrarMes(req.empresaId, mes, req.usuario._id);
  await auditar(req, 'cerrar_mes', { detalle: { mes, resumen } });
  res.status(201).json(resumen);
});
r.post('/cierres/:mes/reabrir', admin, async (req, res) => {
  await cierre.reabrirMes(req.empresaId, req.params.mes);
  await auditar(req, 'reabrir_mes', { detalle: { mes: req.params.mes } });
  res.json({ ok: true });
});

// ═════════════ Relaciones: pago a conductores y viajes por empresa ═════════════
const verRep = permitir(P.REPORTES_VER, P.LIQUIDACION_VER);
const nombreT = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
async function viajesPeriodo(req, extra = {}) {
  const desde = fechaQ(req.query.desde, inicioMes()); const hasta = finDia(fechaQ(req.query.hasta, hoy()));
  const f = deEmpresa(req, { fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' }, ...extra });
  if (req.query.cliente && mongoose.isValidObjectId(req.query.cliente)) f.cliente = req.query.cliente;
  const viajes = await Viaje.find(f).populate([pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId'), pob(req.empresaId, 'cliente', 'nombre')]).lean();
  const tarifas = new Map((await Tarifa.find(deEmpresa(req)).lean()).map(t => [String(t._id), t]));
  return { desde, hasta, viajes, tarifas };
}

r.get('/relaciones/pago-conductores', verRep, async (req, res) => {
  const { desde, hasta, viajes, tarifas } = await viajesPeriodo(req);
  const g = new Map();
  for (const v of viajes) {
    const l = lineaLiquidacion(v, tarifas.get(String(v.tarifaRef)));
    const k = nombreT(v.conductor) || v.conductorNombre || '(sin conductor)';
    const x = g.get(k) || { conductor: k, cedula: v.conductor?.numId || '', viajes: 0, flete: 0, auxiliar: 0 };
    x.viajes += 1; x.flete += Number(v.flete) || l.totalFlete; x.auxiliar += l.totalAuxiliarPagado; g.set(k, x);
  }
  const filas = [...g.values()].sort((a, b) => a.conductor.localeCompare(b.conductor)).map(x => ({ ...x, total: x.flete + x.auxiliar }));
  const t = filas.reduce((a, x) => ({ viajes: a.viajes + x.viajes, flete: a.flete + x.flete, auxiliar: a.auxiliar + x.auxiliar, total: a.total + x.total }), { viajes: 0, flete: 0, auxiliar: 0, total: 0 });
  const titulo = 'Relación de pago a conductores'; const sub = `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}`;
  const columnas = [{ titulo: 'Conductor', peso: 2.2 }, { titulo: 'Cédula', peso: 1 }, { titulo: 'Viajes', peso: 0.6, alin: 'right' },
    { titulo: 'Total flete', peso: 1, alin: 'right' }, { titulo: 'Total auxiliar pagado', peso: 1.2, alin: 'right' }, { titulo: 'Total pagado', peso: 1, alin: 'right' }];
  const m = (v) => `$ ${$(v).toLocaleString('es-CO')}`;
  if (req.query.formato === 'xlsx') return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo: sub,
    columnas: columnas.map((c, i) => ({ ...c, ancho: i ? 16 : 34, formato: i > 2 ? PESOS : undefined })),
    filas: filas.map(x => [x.conductor, x.cedula, x.viajes, x.flete, x.auxiliar, x.total]), total: ['TOTAL', '', t.viajes, t.flete, t.auxiliar, t.total] }), 'pago_conductores.xlsx', XLSX);
  if (req.query.formato === 'pdf') return archivo(res, await pdfTabla(req, { titulo, subtitulo: sub, columnas,
    filas: filas.map(x => [x.conductor, x.cedula, x.viajes, m(x.flete), m(x.auxiliar), m(x.total)]), total: ['TOTAL', '', t.viajes, m(t.flete), m(t.auxiliar), m(t.total)] }),
    'pago_conductores.pdf', 'application/pdf', req.query.ver === '1');
  res.json({ filas, totales: t });
});

// Viajes por empresa: ordenados por placa y, dentro de cada placa, del más antiguo al más reciente, con totales
r.get('/relaciones/viajes-empresa', verRep, async (req, res) => {
  const { desde, hasta, viajes, tarifas } = await viajesPeriodo(req);
  viajes.sort((a, b) => a.placa.localeCompare(b.placa) || new Date(a.fecha) - new Date(b.fecha) || a.numero - b.numero);
  const filas = viajes.map(v => { const l = lineaLiquidacion(v, tarifas.get(String(v.tarifaRef)));
    return { numero: v.numero, fecha: v.fecha, cliente: v.cliente?.nombre || '', placa: v.placa, conductor: nombreT(v.conductor) || v.conductorNombre, destino: v.destino,
      manifiesto: v.manifiesto?.numero || v.soporteInterno?.mc || '', tarifa: l.totalCobrado, flete: Number(v.flete) || 0, anticipo: Number(v.anticipo) || 0 }; });
  const t = filas.reduce((a, x) => ({ tarifa: a.tarifa + x.tarifa, flete: a.flete + x.flete, anticipo: a.anticipo + x.anticipo }), { tarifa: 0, flete: 0, anticipo: 0 });
  const cli = req.query.cliente ? await Cliente.findOne(deEmpresa(req, { _id: req.query.cliente })).select('nombre').lean() : null;
  const titulo = `Viajes por empresa${cli ? ` - ${cli.nombre}` : ''}`; const sub = `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · ${filas.length} viaje(s)`;
  const columnas = [{ titulo: 'N°', peso: 0.5 }, { titulo: 'Fecha', peso: 0.9 }, { titulo: 'Empresa', peso: 1.3 }, { titulo: 'Placa', peso: 0.8 },
    { titulo: 'Conductor', peso: 1.8 }, { titulo: 'Destino', peso: 1.6 }, { titulo: 'Manifiesto', peso: 1 }, { titulo: 'Tarifa', peso: 1, alin: 'right' },
    { titulo: 'Flete', peso: 1, alin: 'right' }, { titulo: 'Anticipo', peso: 1, alin: 'right' }];
  const fila = (x, fm) => [x.numero, fmtFecha(x.fecha), x.cliente, x.placa, x.conductor, x.destino, x.manifiesto, fm(x.tarifa), fm(x.flete), fm(x.anticipo)];
  const m = (v) => `$ ${$(v).toLocaleString('es-CO')}`;
  if (req.query.formato === 'xlsx') return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo: sub,
    columnas: columnas.map((c, i) => ({ ...c, ancho: [6, 12, 20, 10, 30, 26, 14, 14, 14, 14][i], formato: i > 6 ? PESOS : undefined })),
    filas: filas.map(x => fila(x, v => v)), total: ['', 'TOTAL', '', '', '', '', '', t.tarifa, t.flete, t.anticipo] }), 'viajes_empresa.xlsx', XLSX);
  if (req.query.formato === 'pdf') return archivo(res, await pdfTabla(req, { titulo, subtitulo: sub, columnas, filas: filas.map(x => fila(x, m)),
    total: ['', 'TOTAL', '', '', '', '', '', m(t.tarifa), m(t.flete), m(t.anticipo)] }), 'viajes_empresa.pdf', 'application/pdf', req.query.ver === '1');
  res.json({ filas, totales: t });
});

// ═════════════ Soporte interno MC / RC ═════════════
r.post('/soportes/viajes/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const empresa = await empresaDe(req);
  const d = await soporteInterno(empresa, req.params.id);
  await auditar(req, 'soporte_interno', { entidad: 'Viaje', entidadId: req.params.id, detalle: d.soporte });
  res.json(d.soporte);
});
r.get('/soportes/viajes/:id/pdf', permitir(P.VIAJES_VER), async (req, res) => {
  const empresa = await empresaDe(req);
  const d = await soporteInterno(empresa, req.params.id, { asignar: false });
  archivo(res, await manifiestoPdf(d), `${d.numero}.pdf`, 'application/pdf', true);
});

// ═════════════ Remesas Dulces & Dulces ═════════════
const remDulces = permitir(P.VIAJES_REGISTRAR);
r.get('/remesas-dulces', permitir(P.VIAJES_VER), async (req, res) => {
  const f = deEmpresa(req);
  if (req.query.pendientes === '1') f.impreso = null;
  res.json(await RemesaDulces.find(f).sort({ fecha: -1, vpl: -1 }).limit(1000).lean());
});
r.post('/remesas-dulces/importar', remDulces, express.raw({ type: '*/*', limit: '15mb' }), async (req, res) => {
  const r1 = await dulces.importarBase(req.empresaId, req.body);
  await auditar(req, 'importar_remesas_dulces', { detalle: r1 });
  res.json(r1);
});
r.put('/remesas-dulces/:vpl', remDulces, async (req, res) => {
  const d = z.object({ cedula: z.string().max(15).optional(), conductor: z.string().max(80).optional(), placa: z.string().max(7).optional(), remesa: z.string().max(20).optional() }).parse(req.body);
  const x = await RemesaDulces.findOneAndUpdate(deEmpresa(req, { vpl: req.params.vpl }), { $set: d }, { new: true });
  if (!x) throw new ErrorHttp(404, 'VPL no encontrado');
  res.json(x);
});
r.post('/remesas-dulces/pdf', remDulces, async (req, res) => {
  const { vpls, marcar } = z.object({ vpls: z.array(z.string()).min(1).max(200), marcar: z.boolean().optional().default(true) }).parse(req.body);
  const empresa = await empresaDe(req);
  const lista = await RemesaDulces.find(deEmpresa(req, { vpl: { $in: vpls } })).sort({ vpl: 1 }).lean();
  if (!lista.length) throw new ErrorHttp(404, 'No se encontraron los VPL elegidos');
  // Cédulas: las que falten se toman del maestro de conductores (por placa o por nombre)
  for (const x of lista) if (!x.cedula) x.cedula = await dulces.cedulaDe(req.empresaId, x);
  const buf = await dulces.remesasPdf(empresa, lista);
  if (marcar) await RemesaDulces.updateMany(deEmpresa(req, { vpl: { $in: lista.map(x => x.vpl) } }), { $set: { impreso: new Date() } });
  archivo(res, buf, 'remesas_dulces.pdf', 'application/pdf', true);
});

// ═════════════ Documentos vencidos (aviso al elegir el conductor y la placa) ═════════════
r.get('/documentos', permitir(P.VIAJES_VER), async (req, res) => {
  const { revisarDocumentos } = await import('../services/gestion/documentos.js');
  res.json(await revisarDocumentos(req.empresaId, { conductor: mongoose.isValidObjectId(req.query.conductor) ? req.query.conductor : null, placa: txt(req.query.placa).toUpperCase() }));
});

export default r;
