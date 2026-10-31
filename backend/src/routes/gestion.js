// Módulos de gestión de la plantilla de Excel: liquidación del conductor, préstamos,
// contabilidad, cierre de mes, relaciones, soporte interno MC/RC y remesas de Dulces & Dulces.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import express from 'express';
import { Empresa, Viaje, Tarifa, Cliente, LiquidacionConductor, Prestamo, CuentaContable, Asiento, FacturaCont, RemesaDulces, Tercero, Vehiculo, Autorizacion, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha, fmtFecha, txt, normalizar } from '../utils/texto.js';
import { libroExcel, nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../services/reportes/comun.js';
import { lineaLiquidacion, respaldosAuxiliar } from '../services/calculos.js';
import { reglasDe } from '../services/gestion/reglas.js';
import * as liq from '../services/gestion/liquidacionConductor.js';
import * as pre from '../services/gestion/prestamos.js';
import * as cont from '../services/gestion/contabilidad.js';
import * as cierre from '../services/gestion/cierre.js';
import { soporteInterno, asegurarSoporte, soporteDeEjemplo, cumplirSoporte as soporteCumplir, anularSoporte as soporteAnular } from '../services/gestion/soporteInterno.js';
import { manifiestoPdf, ajusteLogo } from '../services/reportes/manifiesto.js';
import { liquidacionPdf, liquidacionesMediaHoja } from '../services/reportes/liquidacion.js';
import * as dulces from '../services/gestion/remesasDulces.js';
import * as compras from '../services/gestion/compras.js';
import rutasCompras from './contabilidadCompras.js';
import rutasTributario from './tributario.js';

const r = Router();
r.use(autenticar, soloEmpresa);
// Contabilidad fase 2: proveedores, compras, egresos y conciliación bancaria
r.use(rutasCompras);
// Contabilidad fase 3: tributario y fiscal (350, ICA, pagos, vencimientos, exógena, certificados, relación de remesas)
r.use(rutasTributario);

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
const verCont = permitir(P.CONTABILIDAD_VER); const gestCont = permitir(P.CONTABILIDAD_GESTIONAR);
const rango = z.object({ desde: z.string(), hasta: z.string(), q: z.string().max(80).optional().default(''), placa: z.string().max(7).optional().default(''),
  incluirLiquidados: z.boolean().optional().default(false) });

r.post('/liq-conductores/calcular', verLiq, async (req, res) => {
  const d = rango.parse(req.body);
  const desde = parseFecha(d.desde); const hasta = parseFecha(d.hasta);
  if (!desde || !hasta) throw new ErrorHttp(400, 'Fechas inválidas');
  const c = await liq.calcular(req.empresaId, { ...d, desde, hasta: finDia(hasta) });
  // Cuotas de préstamos vencidas al corte, por cédula (se descuentan al liquidar) y todo lo pendiente (tope del descuento escogido)
  const prestamos = {};
  for (const ced of new Set(c.lineas.map(l => l.cedula).filter(Boolean))) {
    const p = await pre.cuotaPendiente(req.empresaId, ced, finDia(hasta));
    const pendiente = await pre.pendienteTotal(req.empresaId, ced);
    if (p.total || pendiente) prestamos[ced] = { ...p, pendiente };
  }
  res.json({ ...c, prestamos });
});

r.post('/liq-conductores', gestionar, async (req, res) => {
  const d = z.object({ viajes: z.array(id).min(1).max(500), desde: z.string(), hasta: z.string(), descontarPrestamos: z.boolean().optional().default(true),
    descuentoPrestamos: z.coerce.number().min(0).nullable().optional(), agrupacion: z.enum(['conductor', 'placa_empresa']).optional().default('conductor') }).parse(req.body);
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
  { titulo: 'Manifiesto', peso: 1 }, { titulo: 'Flete', peso: 1, alin: 'right' }, { titulo: 'Auxiliar', peso: 0.9, alin: 'right' }, { titulo: 'Anticipo', peso: 1, alin: 'right' },
  { titulo: 'Anticipo rec.', peso: 1, alin: 'right' }, { titulo: 'Retefuente', peso: 1, alin: 'right' }, { titulo: 'FOPAT', peso: 0.8, alin: 'right' }, { titulo: 'Saldo', peso: 1, alin: 'right' }];
// Líneas antiguas (antes del auxiliar y del anticipo reconocido) se muestran con sus valores originales
const filaLc = (x) => [fmtFecha(x.fecha), x.placa, x.empresa, x.destino, x.manifiesto, $(x.flete), $(x.auxiliar), $(x.anticipo),
  $(x.anticipoReconocido ?? x.anticipo), $(x.retefuente), $(x.fopat), $(x.saldo)];
const totalLc = (l) => ['TOTAL', '', '', '', '', $(l.flete), $(l.auxiliar), $(l.anticipo), $(l.anticipoReconocido ?? l.anticipo), $(l.retefuente), $(l.fopat),
  $(l.flete + (l.auxiliar || 0) - (l.anticipoReconocido ?? l.anticipo) - l.retefuente - l.fopat)];
r.get('/liq-conductores/:numero/:formato', verLiq, async (req, res) => {
  if (!['pdf', 'xlsx'].includes(req.params.formato)) throw new ErrorHttp(404, 'Formato no disponible');
  const l = await LiquidacionConductor.findOne(deEmpresa(req, { numero: req.params.numero })).lean();
  if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
  const filas = l.lineas.map(filaLc);
  const total = totalLc(l);
  const titulo = `Liquidación ${l.numero} - ${l.conductorNombre}`;
  const subtitulo = `C.C. ${l.cedula} · Placa ${l.placa} · Del ${fmtFecha(l.desde)} al ${fmtFecha(l.hasta)}${l.estado === 'ANULADA' ? ' · ANULADA' : ''}`;
  const vacio = Array(COL_LC.length - 1).fill('');
  if (req.params.formato === 'xlsx') {
    return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo,
      columnas: COL_LC.map((c, i) => ({ ...c, ancho: i > 4 ? 14 : 16, formato: i > 4 ? PESOS : undefined })),
      filas: [...filas, [], ['Descuento préstamos', ...vacio.slice(1), -$(l.descuentoPrestamos)], ['NETO A PAGAR', ...vacio.slice(1), $(l.neto)]], total }), `${l.numero}.xlsx`, XLSX);
  }
  const empresa = await Empresa.findById(req.empresaId).select('+logo').lean();
  const buf = await liquidacionPdf(empresa, l);
  archivo(res, buf, `${l.numero}.pdf`, 'application/pdf', req.query.ver === '1');
});

// Dos liquidaciones por hoja carta (media hoja cada una, con línea de corte). Una liquidación
// con muchos viajes ocupa la hoja completa.
r.get('/liq-conductores-lote/pdf', verLiq, async (req, res) => {
  const numeros = String(req.query.numeros || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 200);
  if (!numeros.length) throw new ErrorHttp(400, 'Elija al menos una liquidación');
  const lista = await LiquidacionConductor.find(deEmpresa(req, { numero: { $in: numeros } })).lean();
  if (!lista.length) throw new ErrorHttp(404, 'No se encontraron las liquidaciones');
  lista.sort((a, b) => numeros.indexOf(a.numero) - numeros.indexOf(b.numero));
  const empresa = await Empresa.findById(req.empresaId).select('+logo').lean();
  archivo(res, await liquidacionesMediaHoja(empresa, lista), 'liquidaciones.pdf', 'application/pdf', req.query.ver === '1');
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
r.get('/contabilidad/cuentas', verCont, async (req, res) => {
  await cont.asegurarPuc(req.empresaId);
  res.json(await CuentaContable.find(deEmpresa(req)).sort({ codigo: 1 }).lean());
});
r.post('/contabilidad/cuentas', gestCont, async (req, res) => {
  const d = z.object({ codigo: z.string().regex(/^\d{4,10}$/), nombre: z.string().trim().min(3).max(120),
    tipo: z.enum(['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO']), naturaleza: z.enum(['D', 'C']) }).parse(req.body);
  if (await CuentaContable.exists(deEmpresa(req, { codigo: d.codigo }))) throw new ErrorHttp(409, 'Ya existe una cuenta con ese código');
  res.status(201).json(await CuentaContable.create({ ...d, empresa: req.empresaId }));
});
r.get('/contabilidad/asientos', verCont, async (req, res) => {
  const desde = fechaQ(req.query.desde, inicioMes()); const hasta = finDia(fechaQ(req.query.hasta, hoy()));
  res.json(await cont.libroDiario(req.empresaId, desde, hasta));
});
r.post('/contabilidad/asientos', gestCont, async (req, res) => {
  const d = z.object({ fecha: z.string(), debito: z.string(), credito: z.string(), valor: z.coerce.number().positive(), concepto: z.string().trim().min(3).max(200),
    centroCosto: z.string().max(40).optional().default('') }).parse(req.body);
  const a = await cont.postear(req.empresaId, { fecha: parseFecha(d.fecha), concepto: d.concepto, centroCosto: d.centroCosto, origen: 'MAN', usuario: req.usuario._id,
    lineas: [[d.debito, d.valor], [d.credito, -d.valor]] });
  await auditar(req, 'asiento_manual', { entidad: 'Asiento', entidadId: a._id, detalle: { numero: a.numero } });
  res.status(201).json(a);
});
r.post('/contabilidad/asientos/:numero/anular', gestCont, async (req, res) => {
  const a = await cont.anularAsiento(req.empresaId, req.params.numero);
  await auditar(req, 'anular_asiento', { entidad: 'Asiento', entidadId: a._id, detalle: { numero: a.numero } });
  res.json(a);
});
r.get('/contabilidad/facturas', verCont, async (req, res) => res.json(await FacturaCont.find(deEmpresa(req)).populate(pob(req.empresaId, 'cliente', 'nombre nit')).sort({ createdAt: -1 }).limit(300).lean()));
r.post('/contabilidad/facturas', gestCont, async (req, res) => {
  const d = z.object({ cliente: id, desde: z.string().optional(), hasta: z.string().optional(), viajes: z.array(id).max(2000).optional(),
    retefuentePct: z.coerce.number().min(0).max(20).optional(),
    icaPct: z.coerce.number().min(0).max(5).default(0), permitirCruce: z.boolean().optional().default(false) }).parse(req.body);
  if (!d.viajes?.length && !(parseFecha(d.desde) && parseFecha(d.hasta))) throw new ErrorHttp(400, 'Indique el rango de fechas o escoja los viajes');
  if (d.retefuentePct === undefined) d.retefuentePct = (await reglasDe(req.empresaId)).retefuenteFacturaPct;
  const f = await cont.facturar(req.empresaId, { ...d, desde: parseFecha(d.desde), hasta: parseFecha(d.hasta) ? finDia(parseFecha(d.hasta)) : null, usuario: req.usuario._id });
  await auditar(req, 'factura_contable', { entidad: 'FacturaCont', entidadId: f._id, detalle: { numero: f.numero, neto: f.neto, cruces: f.cruces } });
  res.status(201).json(f);
});
// Aviso previo: facturas del mismo cliente que se cruzan con el periodo
r.get('/contabilidad/facturas/cruces', verCont, async (req, res) => {
  const desde = parseFecha(req.query.desde); const hasta = parseFecha(req.query.hasta);
  if (!mongoose.isValidObjectId(req.query.cliente) || !desde || !hasta) return res.json([]);
  res.json(await cont.facturasCruzadas(req.empresaId, { cliente: req.query.cliente, desde, hasta: finDia(hasta) }));
});
r.get('/contabilidad/resumen', verCont, async (req, res) => {
  const desde = fechaQ(req.query.desde, inicioMes()); const hasta = finDia(fechaQ(req.query.hasta, hoy()));
  res.json({ desde, hasta, ...(await cont.resumenContable(req.empresaId, desde, hasta)) });
});
r.post('/contabilidad/facturas/:numero/anular', gestCont, async (req, res) => {
  const f = await cont.anularFactura(req.empresaId, req.params.numero);
  await auditar(req, 'anular_factura', { entidad: 'FacturaCont', entidadId: f._id, detalle: { numero: f.numero } });
  res.json(f);
});
r.post('/contabilidad/cobros', gestCont, async (req, res) => {
  const d = z.object({ factura: z.string(), valor: z.coerce.number().min(0).optional(), fecha: z.string().optional(), cuenta: z.enum(['1110', '1105']).default('1110') }).parse(req.body);
  res.json(await cont.cobrar(req.empresaId, { ...d, fecha: parseFecha(d.fecha) || hoy(), usuario: req.usuario._id }));
});
r.post('/contabilidad/pagos', gestCont, async (req, res) => {
  const d = z.object({ liquidacion: z.string(), valor: z.coerce.number().min(0).optional(), fecha: z.string().optional(), cuenta: z.enum(['1110', '1105']).default('1110') }).parse(req.body);
  res.json(await cont.pagarLiquidacion(req.empresaId, { ...d, fecha: parseFecha(d.fecha) || hoy(), usuario: req.usuario._id }));
});
r.post('/contabilidad/gastos', gestCont, async (req, res) => {
  const d = z.object({ fecha: z.string(), cuenta: z.string(), concepto: z.string().trim().min(3).max(200), valor: z.coerce.number().positive(),
    tercero: z.string().max(120).optional().default(''), formaPago: z.enum(['1110', '1105', '2335']).default('1110') }).parse(req.body);
  res.status(201).json(await cont.gasto(req.empresaId, { ...d, fecha: parseFecha(d.fecha), usuario: req.usuario._id }));
});

// Viajes que se pueden facturar (para escogerlos uno a uno), con la división para terceros / propio
r.get('/contabilidad/facturas/viajes', verCont, async (req, res) => {
  const desde = parseFecha(req.query.desde); const hasta = parseFecha(req.query.hasta);
  if (!mongoose.isValidObjectId(req.query.cliente) || !desde || !hasta) throw new ErrorHttp(400, 'Indique cliente y rango de fechas');
  const { filas } = await cont.viajesPorFacturar(req.empresaId, { cliente: req.query.cliente, desde, hasta: finDia(hasta) });
  res.json({ filas, modelo: (await cont.parametros(req.empresaId)).modeloIngresos });
});
// Parámetros contables (modelo de ingresos y tipo de sociedad)
r.get('/contabilidad/parametros', verCont, async (req, res) => res.json(await cont.parametros(req.empresaId)));
r.put('/contabilidad/parametros', gestCont, async (req, res) => {
  const d = z.object({ modeloIngresos: z.enum(['bruto', 'terceros']).optional(), tipoSociedad: z.enum(['SAS', 'LTDA', 'SA', 'COOPERATIVA', 'OTRA']).optional(),
    uvt: z.coerce.number().int().min(10000).max(500000).optional(), ivaDescontable: z.boolean().optional(), agenteReteIva: z.boolean().optional(),
    reteIvaPct: z.coerce.number().min(0).max(100).optional(), gmf: z.boolean().optional(),
    retenciones: z.record(z.enum(Object.keys(compras.CONCEPTOS_RETENCION)), z.object({ pct: z.coerce.number().min(0).max(40), baseUvt: z.coerce.number().min(0).max(1000) })).optional(),
  }).parse(req.body);
  const p = await cont.guardarParametros(req.empresaId, d);
  await auditar(req, 'parametros_contables', { detalle: p });
  res.json(p);
});
// Saldos iniciales de la contabilidad anterior
r.post('/contabilidad/saldos-iniciales', gestCont, async (req, res) => {
  const fila = z.object({ cuenta: z.string().regex(/^\d{4,10}$/), terceroDoc: z.string().max(20).optional().default(''), tercero: z.string().max(120).optional().default(''),
    documento: z.string().max(40).optional().default(''), debito: z.coerce.number().min(0).default(0), credito: z.coerce.number().min(0).default(0) });
  const d = z.object({ fecha: z.string(), filas: z.array(fila).min(1).max(5000) }).parse(req.body);
  const fecha = parseFecha(d.fecha); if (!fecha) throw new ErrorHttp(400, 'Fecha de corte inválida');
  const r2 = await cont.saldosIniciales(req.empresaId, { fecha, filas: d.filas, usuario: req.usuario._id });
  await auditar(req, 'saldos_iniciales', { detalle: { asientos: r2.asientos.length, debitos: r2.debitos } });
  res.status(201).json(r2);
});

// Informes (JSON, o Excel con ?formato=xlsx)
r.get('/contabilidad/informes/:tipo', verCont, async (req, res) => {
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
  } else if (t === 'cxpProv') {
    datos = await compras.cuentasPorPagarProveedores(req.empresaId); titulo = 'Cuentas por pagar a proveedores';
    columnas = ['Compra', 'Fecha', 'Vence', 'Proveedor', 'NIT', 'Factura', 'Neto', 'Pagado', 'Saldo'];
    filas = datos.map(c => [c.numero, fmtFecha(c.fecha), c.vence ? fmtFecha(c.vence) : '', c.proveedor, c.nit, c.documento, c.neto, c.pagado, c.saldo]);
  } else if (t === 'cartera') {
    datos = await cont.carteraPorEdades(req.empresaId, hasta); titulo = `Cartera por edades al ${fmtFecha(hasta)}`;
    columnas = ['Cliente', 'Facturas', ...cont.EDADES.map(e => e[1]), 'Total'];
    filas = [...datos.filas.map(x => [x.cliente, String(x.facturas), x.d0_30, x.d31_60, x.d61_90, x.d90, x.total]),
      ['', '', datos.totales.d0_30, datos.totales.d31_60, datos.totales.d61_90, datos.totales.d90, datos.totales.total]];
  } else if (t === 'retenciones') {
    datos = await cont.retenciones(req.empresaId, desde, hasta); titulo = 'Retenciones';
    columnas = ['Cuenta', 'Nombre', 'Débitos', 'Créditos', 'Saldo'];
    filas = datos.map(c => [c.codigo, c.nombre, c.debito, c.credito, c.saldo]);
  } else if (t === 'mayor') {
    const nivel = [1, 2, 4, 6].includes(Number(req.query.nivel)) ? Number(req.query.nivel) : 4;
    datos = await cont.libroMayor(req.empresaId, desde, hasta, nivel); titulo = 'Libro mayor y balances';
    columnas = ['Cuenta', 'Nombre', 'Saldo anterior', 'Débitos', 'Créditos', 'Saldo final'];
    filas = [...datos.map(c => [c.codigo, c.nombre, c.anterior, c.debito, c.credito, c.final]),
      ['', '', '', datos.reduce((a, c) => a + c.debito, 0), datos.reduce((a, c) => a + c.credito, 0), '']];
  } else if (t === 'auxiliar') {
    datos = await cont.auxiliar(req.empresaId, { cuenta: req.query.cuenta, terceroDoc: String(req.query.tercero || '').replace(/\D/g, ''), desde, hasta });
    titulo = `Auxiliar ${datos.cuenta} ${datos.nombre}`.trim();
    columnas = ['Fecha', 'Asiento', 'Cuenta', 'Documento', 'NIT / cédula', 'Tercero', 'Concepto', 'Débito', 'Crédito', 'Saldo'];
    filas = [['', '', '', '', '', '', 'Saldo anterior', '', '', datos.anterior],
      ...datos.movimientos.map(x => [fmtFecha(x.fecha), x.numero, x.cuenta, x.documento, x.terceroDoc, x.tercero, x.concepto, x.debito, x.credito, x.saldo]),
      ['', '', '', '', '', '', 'Saldo final', '', '', datos.final]];
  } else if (t === 'plan') {
    datos = await CuentaContable.find(deEmpresa(req)).sort({ codigo: 1 }).lean(); titulo = 'Plan de cuentas';
    columnas = ['Código', 'Cuenta', 'Tipo', 'Naturaleza'];
    filas = datos.map(c => [c.codigo, c.nombre, c.tipo, c.naturaleza]);
  } else throw new ErrorHttp(404, 'Informe no disponible');
  if (req.query.formato === 'xlsx') {
    return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo: `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · información de apoyo; debe ser revisada por un contador`,
      columnas: columnas.map(c => ({ titulo: c, ancho: 18, formato: /Débito|Crédito|Saldo|Valor|Neto|Cobrado|Pagado|Débitos|Créditos|días|Total/.test(c) ? PESOS : undefined })), filas }), `${t}.xlsx`, XLSX);
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
// ═════════════ Archivo y respaldos (solo el administrador) ═════════════
// Respaldo completo de la empresa para descargar (líneas JSON comprimidas)
r.get('/respaldo', admin, async (req, res) => {
  const { respaldoComoFlujo } = await import('../services/gestion/archivo.js');
  await auditar(req, 'descargar_respaldo');
  const nombre = `respaldo-${new Date().toISOString().slice(0, 10)}.json.gz`;
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  respaldoComoFlujo(req.empresaId).on('error', () => res.destroy()).pipe(res);
});
r.get('/archivo', admin, async (req, res) => {
  const { listarArchivos } = await import('../services/gestion/archivo.js');
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : '';
  res.json(await listarArchivos(req.empresaId, mes));
});
r.get('/archivo/descargar', admin, async (req, res) => {
  const { leerArchivo } = await import('../services/gestion/archivo.js');
  const ruta = String(req.query.ruta || '');
  const flujo = await leerArchivo(req.empresaId, ruta);
  const nombre = ruta.split('/').pop();
  const tipo = /\.pdf$/i.test(nombre) ? 'application/pdf' : /\.xlsx$/i.test(nombre) ? XLSX : 'application/gzip';
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `${req.query.ver === '1' && tipo === 'application/pdf' ? 'inline' : 'attachment'}; filename="${nombre.replace(/[^\w.-]/g, '_')}"`);
  flujo.pipe(res);
});
// Guarda ahora los PDF de manifiestos e informes de un mes (sin cerrarlo)
r.post('/archivo/:mes', admin, async (req, res) => {
  if (!/^\d{4}-\d{2}$/.test(req.params.mes)) throw new ErrorHttp(400, 'Mes inválido (aaaa-mm)');
  const { archivarManifiestos, informesMes } = await import('../services/gestion/archivo.js');
  const m = await archivarManifiestos(req.empresaId, req.params.mes);
  const informes = await informesMes(req.empresaId, req.params.mes);
  await auditar(req, 'archivar_mes', { detalle: { mes: req.params.mes, manifiestos: m.archivos.length, informes: informes.length, errores: m.errores.length } });
  res.json({ manifiestos: m.archivos.length, informes: informes.length, errores: m.errores });
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
  const viajes = await Viaje.find(f).populate([pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId'),
    pob(req.empresaId, 'cliente', 'nombre politicaAuxiliar valorAuxiliarSinAnticipo')]).lean();
  const lista = await Tarifa.find(deEmpresa(req)).lean();
  const tarifas = new Map(lista.map(t => [String(t._id), t]));
  const respaldos = respaldosAuxiliar(lista);
  // Línea de liquidación del viaje con su tarifa, la tarifa de auxiliar de respaldo y la política de auxiliar del cliente
  const linea = (v) => lineaLiquidacion(v, tarifas.get(String(v.tarifaRef)), { respaldo: respaldos.get(String(v.cliente?._id)), cliente: v.cliente });
  return { desde, hasta, viajes, tarifas, linea };
}

r.get('/relaciones/pago-conductores', verRep, async (req, res) => {
  const { desde, hasta, viajes, linea } = await viajesPeriodo(req);
  const g = new Map();
  for (const v of viajes) {
    const l = linea(v);
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

// Listado de viajes para exportar: general, agrupado por empresa o por placa (ordenado por fecha), con subtotales
const AGRUPAR = { general: null, empresa: (x) => x.cliente, placa: (x) => x.placa };
r.get('/relaciones/viajes', verRep, async (req, res) => {
  const agrupar = Object.hasOwn(AGRUPAR, req.query.agrupar) ? req.query.agrupar : 'general';
  const extra = {};
  if (req.query.placa) extra.placa = txt(req.query.placa).toUpperCase().replace(/[\s-]/g, '');
  const { desde, hasta, viajes, linea } = await viajesPeriodo(req, extra);
  const filas = viajes.map(v => { const l = linea(v);
    return { _id: v._id, estado: v.estado, numero: v.numero, fecha: v.fecha, cliente: v.cliente?.nombre || '', utilidad: l.utilidad, placa: v.placa, conductor: nombreT(v.conductor) || v.conductorNombre, destino: v.destino,
      planilla: v.planilla || '', manifiesto: v.manifiesto?.numero || v.soporteInterno?.mc || '', cantidad: l.cantidad,
      auxiliar: v.conAuxiliar ? (v.diasAuxiliar || l.cantidad) : 0, tarifa: l.totalCobrado, flete: Number(v.flete) || 0, anticipo: Number(v.anticipo) || 0,
      facturado: !!v.liquidacion }; });
  const clave = AGRUPAR[agrupar];
  filas.sort((a, b) => (clave ? String(clave(a)).localeCompare(String(clave(b))) : 0) || (agrupar === 'empresa' ? a.placa.localeCompare(b.placa) : 0)
    || new Date(a.fecha) - new Date(b.fecha) || a.numero - b.numero);
  const suma = (l) => l.reduce((a, x) => ({ viajes: a.viajes + 1, tarifa: a.tarifa + x.tarifa, flete: a.flete + x.flete, anticipo: a.anticipo + x.anticipo }), { viajes: 0, tarifa: 0, flete: 0, anticipo: 0 });
  const grupos = clave ? [...filas.reduce((m, x) => m.set(clave(x), [...(m.get(clave(x)) || []), x]), new Map())].map(([nombre, l]) => ({ nombre, filas: l, totales: suma(l) })) : [];
  const totales = suma(filas);
  const cli = req.query.cliente ? await Cliente.findOne(deEmpresa(req, { _id: req.query.cliente })).select('nombre').lean() : null;
  const titulo = `Viajes${agrupar === 'empresa' ? ' por empresa' : agrupar === 'placa' ? ' por placa' : ''}${cli ? ` - ${cli.nombre}` : ''}${extra.placa ? ` - ${extra.placa}` : ''}`;
  const sub = `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · ${filas.length} viaje(s)`;
  const columnas = [{ titulo: 'N°', peso: 0.5 }, { titulo: 'Fecha', peso: 0.9 }, { titulo: 'Empresa', peso: 1.3 }, { titulo: 'Placa', peso: 0.8 },
    { titulo: 'Conductor', peso: 1.7 }, { titulo: 'Destino', peso: 1.6 }, { titulo: 'Planilla', peso: 0.8 }, { titulo: 'Manifiesto', peso: 1 },
    { titulo: 'Cant.', peso: 0.5, alin: 'right' }, { titulo: 'Aux.', peso: 0.5, alin: 'right' }, { titulo: 'Tarifa', peso: 1, alin: 'right' },
    { titulo: 'Flete', peso: 1, alin: 'right' }, { titulo: 'Anticipo', peso: 1, alin: 'right' }];
  const m = (v) => `$ ${$(v).toLocaleString('es-CO')}`;
  const fila = (x, fm) => [x.numero, fmtFecha(x.fecha), x.cliente, x.placa, x.conductor, x.destino, x.planilla, x.manifiesto, x.cantidad, x.auxiliar || '', fm(x.tarifa), fm(x.flete), fm(x.anticipo)];
  const filaTotal = (nombre, t, fm) => ['', '', '', '', nombre, '', '', '', '', '', fm(t.tarifa), fm(t.flete), fm(t.anticipo)];
  // Con grupos: título del grupo, sus viajes y el subtotal
  const armar = (fm) => (clave ? grupos.flatMap(g => [['', '', '', '', g.nombre, '', '', '', '', '', '', '', ''], ...g.filas.map(x => fila(x, fm)), filaTotal(`Subtotal (${g.totales.viajes} viajes)`, g.totales, fm)])
    : filas.map(x => fila(x, fm)));
  if (req.query.formato === 'xlsx') return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo: sub,
    columnas: columnas.map((c, i) => ({ ...c, ancho: [6, 12, 20, 10, 28, 26, 12, 14, 7, 7, 14, 14, 14][i], formato: i > 9 ? PESOS : undefined })),
    filas: armar(v => v), total: filaTotal('TOTAL', totales, v => v) }), 'viajes.xlsx', XLSX);
  if (req.query.formato === 'pdf') return archivo(res, await pdfTabla(req, { titulo, subtitulo: sub, columnas, filas: armar(m), total: filaTotal('TOTAL', totales, m) }),
    'viajes.pdf', 'application/pdf', req.query.ver === '1');
  res.json({ agrupar, filas, grupos: grupos.map(g => ({ nombre: g.nombre, totales: g.totales })), totales });
});

// Informe de utilidad por empresa (como el de la plantilla): cobrado, pagado y utilidad; retefuente y FOPAT
// del conductor se muestran aparte (informativo, no se restan de la utilidad de la empresa)
r.get('/relaciones/informe', verRep, async (req, res) => {
  const { desde, hasta, viajes, linea } = await viajesPeriodo(req);
  const reglas = await reglasDe(req.empresaId);
  const pbv = new Map((await Vehiculo.find(deEmpresa(req, { placa: { $in: [...new Set(viajes.map(v => v.placa))] } })).select('placa pbv').lean()).map(v => [v.placa, v.pbv]));
  const g = new Map();
  for (const v of viajes) {
    const l = linea(v);
    const k = v.cliente?.nombre || '(sin empresa)';
    const x = g.get(k) || { empresa: k, viajes: 0, cobrado: 0, flete: 0, auxiliarPagado: 0, utilidad: 0, retefuente: 0, fopat: 0 };
    x.viajes += 1; x.cobrado += l.totalCobrado; x.flete += l.totalFlete; x.auxiliarPagado += l.totalAuxiliarPagado; x.utilidad += l.utilidad;
    x.retefuente += liq.retefuente(l.totalFlete, reglas); x.fopat += liq.fopat(l.totalFlete, pbv.get(v.placa), v.destino, reglas);
    g.set(k, x);
  }
  const filas = [...g.values()].sort((a, b) => b.utilidad - a.utilidad).map(x => ({ ...x, margen: x.cobrado ? x.utilidad / x.cobrado : 0 }));
  const t = filas.reduce((a, x) => { for (const k of ['viajes', 'cobrado', 'flete', 'auxiliarPagado', 'utilidad', 'retefuente', 'fopat']) a[k] += x[k]; return a; },
    { viajes: 0, cobrado: 0, flete: 0, auxiliarPagado: 0, utilidad: 0, retefuente: 0, fopat: 0 });
  t.margen = t.cobrado ? t.utilidad / t.cobrado : 0;
  const titulo = 'Informe de utilidad por empresa'; const sub = `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)} · retefuente y FOPAT del conductor son informativos`;
  const columnas = [{ titulo: 'Empresa', peso: 1.8 }, { titulo: 'Viajes', peso: 0.6, alin: 'right' }, { titulo: 'Cobrado', peso: 1, alin: 'right' },
    { titulo: 'Flete', peso: 1, alin: 'right' }, { titulo: 'Aux. pagado', peso: 1, alin: 'right' }, { titulo: 'Utilidad', peso: 1, alin: 'right' },
    { titulo: 'Margen', peso: 0.7, alin: 'right' }, { titulo: 'Retefuente cond.', peso: 1, alin: 'right' }, { titulo: 'FOPAT cond.', peso: 0.9, alin: 'right' }];
  const m = (v) => `$ ${$(v).toLocaleString('es-CO')}`; const pct = (v) => `${(v * 100).toFixed(1)} %`;
  const fila = (x, fm, fp) => [x.empresa, x.viajes, fm(x.cobrado), fm(x.flete), fm(x.auxiliarPagado), fm(x.utilidad), fp(x.margen), fm(x.retefuente), fm(x.fopat)];
  if (req.query.formato === 'xlsx') return archivo(res, await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo: sub,
    columnas: columnas.map((c, i) => ({ ...c, ancho: i ? 15 : 26, formato: i === 6 ? '0.0%' : i > 1 ? PESOS : undefined })),
    filas: filas.map(x => fila(x, v => v, v => v)), total: fila({ ...t, empresa: 'TOTAL' }, v => v, v => v) }), 'informe_utilidad.xlsx', XLSX);
  if (req.query.formato === 'pdf') return archivo(res, await pdfTabla(req, { titulo, subtitulo: sub, columnas, filas: filas.map(x => fila(x, m, pct)), total: fila({ ...t, empresa: 'TOTAL' }, m, pct) }),
    'informe_utilidad.pdf', 'application/pdf', req.query.ver === '1');
  res.json({ filas, totales: t });
});

// ═════════════ Registro masivo (un vehículo para varios días, como en la plantilla) ═════════════
// Días laborales del rango: salta domingos, festivos de Colombia, sábados (si se pide) y los días en que la placa ya tiene viaje.
const masivoSchema = z.object({ cliente: id, tarifaRef: id.optional(), destino: z.string().trim().min(1).max(120), placa: z.string().trim().min(5).max(7),
  conductor: id, desde: z.string(), hasta: z.string(), incluirSabados: z.boolean().optional().default(true), cantidad: z.coerce.number().min(0).default(1),
  conAuxiliar: z.boolean().optional().default(false), diasAuxiliar: z.coerce.number().int().min(0).max(5, 'el auxiliar va de 1 a 5 días').optional().default(0), planilla: z.string().max(30).optional().default(''),
  requiereManifiesto: z.boolean().optional().default(false), dias: z.array(z.string()).optional() });
async function diasMasivo(req, d) {
  const desde = parseFecha(d.desde); const hasta = parseFecha(d.hasta);
  if (!desde || !hasta || hasta < desde) throw new ErrorHttp(400, 'Rango de fechas inválido');
  if ((hasta - desde) / 86400000 > 92) throw new ErrorHttp(400, 'El rango máximo es de 93 días');
  const placa = d.placa.toUpperCase().replace(/[\s-]/g, '');
  const existentes = new Set((await Viaje.find(deEmpresa(req, { placa, fecha: { $gte: desde, $lte: finDia(hasta) }, estado: { $ne: 'anulado' } })).select('fecha').lean())
    .map(v => new Date(v.fecha).toISOString().slice(0, 10)));
  const { festivo } = await import('../utils/festivos.js');
  const dias = [];
  for (let f = new Date(desde); f <= hasta; f = new Date(f.getTime() + 86400000)) {
    const iso = f.toISOString().slice(0, 10); const w = f.getUTCDay(); const fe = festivo(f);
    const motivo = w === 0 ? 'domingo' : fe ? `festivo: ${fe}` : (w === 6 && !d.incluirSabados) ? 'sábado excluido' : existentes.has(iso) ? 'ya tiene viaje' : '';
    dias.push({ fecha: iso, dia: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][w], motivo, registrar: !motivo });
  }
  return { placa, dias };
}
r.post('/relaciones/masivo/previa', permitir(P.VIAJES_REGISTRAR), async (req, res) => res.json(await diasMasivo(req, masivoSchema.parse(req.body))));
r.post('/relaciones/masivo', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = masivoSchema.parse(req.body);
  const { placa, dias } = await diasMasivo(req, d);
  const elegidos = new Set(d.dias || dias.filter(x => x.registrar).map(x => x.fecha));
  const aRegistrar = dias.filter(x => elegidos.has(x.fecha) && x.motivo !== 'ya tiene viaje');
  if (!aRegistrar.length) throw new ErrorHttp(400, 'No hay días para registrar');
  const { exigirDocumentosVigentes, registrarAutorizacion } = await import('../services/gestion/documentos.js');
  const { asegurarMesAbierto } = await import('../services/gestion/cierre.js');
  const { autorizacionSchema } = await import('./viajes.js');
  const { autorizado } = await exigirDocumentosVigentes(req.empresaId, { conductor: d.conductor, placa }, autorizacionSchema.parse(req.body?.autorizacion));
  if (d.conAuxiliar && !d.diasAuxiliar) d.diasAuxiliar = 1;
  await asegurarMesAbierto(req.empresaId, ...aRegistrar.map(x => parseFecha(x.fecha)));
  const t = d.tarifaRef ? await Tarifa.findOne(deEmpresa(req, { _id: d.tarifaRef })).lean() : null;
  const cond = await Tercero.findOne(deEmpresa(req, { _id: d.conductor })).select('nombres apellido1 apellido2').lean();
  if (!cond) throw new ErrorHttp(400, 'Conductor no encontrado');
  const { siguiente: sig } = await import('../models/index.js');
  const { valoresDesdeTarifa } = await import('../services/calculos.js');
  const { titularDePlaca } = await import('./viajes.js');
  const sug = t ? valoresDesdeTarifa(t) : {};
  const titular = await titularDePlaca(req.empresaId, placa);
  const creados = [];
  for (const x of aRegistrar) {
    const numero = await sig(req.empresaId, 'viaje');
    const v = await Viaje.create({ empresa: req.empresaId, numero, fecha: parseFecha(x.fecha), cliente: d.cliente, tarifaRef: t?._id || null, destino: d.destino,
      codDestino: sug.codDestino || '', destinatario: sug.destinatario, titular, placa, conductor: d.conductor, conductorNombre: nombreT(cond), cantidad: d.cantidad, conAuxiliar: d.conAuxiliar,
      diasAuxiliar: d.diasAuxiliar, planilla: d.planilla, tarifa: sug.tarifa || 0, flete: sug.flete || 0, anticipo: sug.anticipo || 0, pesoKg: sug.pesoKg || 0,
      requiereManifiesto: d.requiereManifiesto, creadoPor: req.usuario._id, actualizadoPor: req.usuario._id });
    await asegurarSoporte(req.empresaId, v._id);
    creados.push(v);
  }
  if (autorizado) {
    await registrarAutorizacion(req.empresaId, autorizado, creados, req.usuario);
    await auditar(req, 'autorizar_documentos_vencidos', { detalle: { viajes: creados.map(v => v.numero), administrador: autorizado.admin.email, motivo: autorizado.motivo } });
  }
  await auditar(req, 'registro_masivo', { detalle: { placa, viajes: creados.map(v => v.numero) } });
  res.status(201).json({ creados: creados.map(v => v.numero), omitidos: dias.length - creados.length });
});

// Copiar un viaje a otra fecha (mismos datos, sin documentos del RNDC)
r.post('/relaciones/copiar/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const { fecha } = z.object({ fecha: z.string() }).parse(req.body);
  const f = parseFecha(fecha); if (!f) throw new ErrorHttp(400, 'Fecha inválida');
  const v = await Viaje.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  const { asegurarMesAbierto } = await import('../services/gestion/cierre.js');
  await asegurarMesAbierto(req.empresaId, f);
  const { siguiente: sig } = await import('../models/index.js');
  const campos = ['cliente', 'tarifaRef', 'destino', 'codOrigen', 'codDestino', 'placa', 'remolque', 'conductor', 'conductorNombre', 'titular', 'destinatario',
    'pesoKg', 'cantidad', 'conAuxiliar', 'diasAuxiliar', 'planilla', 'tarifa', 'flete', 'anticipo', 'observaciones', 'requiereManifiesto'];
  const nuevo = await Viaje.create({ ...Object.fromEntries(campos.map(k => [k, v[k]])), empresa: req.empresaId, numero: await sig(req.empresaId, 'viaje'), fecha: f,
    creadoPor: req.usuario._id, actualizadoPor: req.usuario._id });
  await asegurarSoporte(req.empresaId, nuevo._id);
  await auditar(req, 'copiar_viaje', { entidad: 'Viaje', entidadId: nuevo._id, detalle: { de: v.numero, a: nuevo.numero } });
  res.status(201).json({ numero: nuevo.numero, _id: nuevo._id });
});

// ═════════════ Logo de la empresa (soporte interno) ═════════════
const LOGO_MAX = 900 * 1024;   // ~650 KB de imagen (la pantalla la comprime a menos de 400 mil caracteres)
const imagenLogo = z.string().max(LOGO_MAX).regex(/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/, 'El logo debe ser una imagen PNG o JPG');
const ajusteSchema = z.object({ dx: z.coerce.number(), dy: z.coerce.number(), escala: z.coerce.number() }).partial();
const logoSchema = z.object({ imagen: imagenLogo.optional(), ajuste: ajusteSchema.optional() });
r.get('/empresa/logo', permitir(P.VIAJES_VER), async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('+logo').lean();
  res.json({ logo: e?.logo || '', ajuste: ajusteLogo(e?.logoAjuste) });
});
r.put('/empresa/logo', permitir(P.CONFIG_GESTIONAR), express.json({ limit: '1mb' }), async (req, res) => {
  const { imagen, ajuste } = logoSchema.parse(req.body);
  if (!imagen && !ajuste) throw new ErrorHttp(400, 'Nada que guardar');
  const set = {};
  if (imagen) set.logo = imagen;
  if (ajuste) set.logoAjuste = ajusteLogo(ajuste);
  await Empresa.updateOne({ _id: req.empresaId }, { $set: set });
  await auditar(req, 'logo_empresa', { detalle: { accion: imagen ? 'cambiar' : 'ajustar', ...(imagen ? { bytes: imagen.length } : {}), ajuste: set.logoAjuste } });
  res.json({ ok: true });
});
r.delete('/empresa/logo', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  await Empresa.updateOne({ _id: req.empresaId }, { $set: { logo: '' } });
  await auditar(req, 'logo_empresa', { detalle: { accion: 'quitar' } });
  res.json({ ok: true });
});
// Vista previa del soporte interno con el logo indicado (o el guardado), sin guardar nada
r.post('/soportes/vista-previa', permitir(P.CONFIG_GESTIONAR), express.json({ limit: '1mb' }), async (req, res) => {
  const e = await Empresa.findById(req.empresaId).select('+logo').lean();
  const d = logoSchema.parse(req.body || {});
  archivo(res, await manifiestoPdf(soporteDeEjemplo(e, d.imagen || e?.logo, d.ajuste ? ajusteLogo(d.ajuste) : e?.logoAjuste)), 'vista-previa-soporte.pdf', 'application/pdf', true);
});

// ═════════════ Soporte interno MC / RC ═════════════
r.post('/soportes/viajes/:id', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const empresa = await empresaDe(req);
  const reemplazar = req.body?.reemplazar === true;
  const d = await soporteInterno(empresa, req.params.id, { reemplazar });
  await auditar(req, reemplazar ? 'soporte_interno_reemplazo' : 'soporte_interno', { entidad: 'Viaje', entidadId: req.params.id, detalle: { mc: d.soporte.mc, rc: d.soporte.rc, codigo: d.soporte.codigo } });
  res.json(d.soporte);
});
// Cumplido y anulación del soporte interno (no van al RNDC)
r.post('/soportes/viajes/:id/cumplir', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = z.object({ llegada: z.string().optional(), cantidad: z.number().nonnegative().nullable().optional(), observaciones: z.string().trim().max(300).optional().default('') }).parse(req.body || {});
  const llegada = d.llegada ? parseFecha(d.llegada) : null;
  if (d.llegada && !llegada) throw new ErrorHttp(400, 'Fecha de llegada inválida');
  const s = await soporteCumplir(req.empresaId, req.params.id, { llegada, cantidad: d.cantidad ?? null, observaciones: d.observaciones }, req.usuario._id);
  await auditar(req, 'cumplir_soporte_interno', { entidad: 'Viaje', entidadId: req.params.id, detalle: { mc: s.mc, llegada: d.llegada || '', cantidad: d.cantidad ?? null } });
  res.json(s);
});
r.post('/soportes/viajes/:id/anular', permitir(P.VIAJES_REGISTRAR), async (req, res) => {
  const d = z.object({ motivo: z.string().trim().min(3, 'Escriba el motivo').max(300), soloCumplido: z.boolean().optional().default(false) }).parse(req.body || {});
  const s = await soporteAnular(req.empresaId, req.params.id, d, req.usuario._id);
  await auditar(req, d.soloCumplido ? 'anular_cumplido_soporte' : 'anular_soporte_interno', { entidad: 'Viaje', entidadId: req.params.id, detalle: { mc: s.mc, motivo: d.motivo } });
  res.json(s);
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

// ═════════════ Reglas de negocio configurables ═════════════
const ciudades = z.array(z.string().trim().min(2).max(40)).max(30);
const reglasSchema = z.object({
  retefuenteConductorPct: z.coerce.number().min(0).max(10), fopatPct: z.coerce.number().min(0).max(5), pbvFopat: z.coerce.number().int().min(0).max(100000),
  ciudadesSinFopat: ciudades, ciudadesAnticipoCero: ciudades, diasAvisoDocumentos: z.coerce.number().int().min(1).max(90),
  retefuenteFacturaPct: z.coerce.number().min(0).max(20), siglasLiquidacion: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'siglas de 1 a 6 letras o números'),
  pesosPorTamano: z.array(z.object({ tamano: z.string().trim().regex(/^\d+([.,]\d+)?$/, 'tamaño como 1.0, 3.0').transform(v => v.replace(',', '.')),
    kg: z.coerce.number().min(0).max(100000) })).max(20),
}).partial();
r.get('/reglas', permitir(P.VIAJES_VER), async (req, res) => {
  const { reglasDe, REGLAS_BASE } = await import('../services/gestion/reglas.js');
  res.json({ reglas: await reglasDe(req.empresaId), base: REGLAS_BASE });
});
r.put('/reglas', admin, async (req, res) => {
  const d = reglasSchema.parse(req.body);
  const { reglasDe } = await import('../services/gestion/reglas.js');
  const antes = await reglasDe(req.empresaId);
  await Empresa.updateOne({ _id: req.empresaId }, { $set: Object.fromEntries(Object.entries(d).map(([k, v]) => [`reglas.${k}`, v])) });
  const despues = await reglasDe(req.empresaId);
  await auditar(req, 'editar_reglas', { detalle: { cambios: Object.keys(d).filter(k => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
    .map(k => ({ campo: k, antes: antes[k], despues: despues[k] })) } });
  res.json(despues);
});

// ═════════════ Autorizaciones del administrador (viajes con documentos vencidos) ═════════════
r.get('/autorizaciones', permitir(P.CONFIG_GESTIONAR), async (req, res) => {
  const f = deEmpresa(req);
  const desde = parseFecha(req.query.desde); const hasta = parseFecha(req.query.hasta);
  if (desde || hasta) f.createdAt = { ...(desde ? { $gte: desde } : {}), ...(hasta ? { $lte: finDia(hasta) } : {}) };
  res.json(await Autorizacion.find(f).sort({ createdAt: -1 }).limit(500).lean());
});

// ═════════════ Documentos vencidos (aviso al elegir el conductor y la placa) ═════════════
r.get('/documentos', permitir(P.VIAJES_VER), async (req, res) => {
  const { revisarDocumentos } = await import('../services/gestion/documentos.js');
  res.json(await revisarDocumentos(req.empresaId, { conductor: mongoose.isValidObjectId(req.query.conductor) ? req.query.conductor : null, placa: txt(req.query.placa).toUpperCase() }));
});

export default r;
