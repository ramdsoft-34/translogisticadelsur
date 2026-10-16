// Descargas: manifiesto con QR, bitácora y liquidación (Excel y PDF).
import { Router } from 'express';
import mongoose from 'mongoose';
import { Empresa, Viaje, Liquidacion, Auditoria, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from '../services/reportes/manifiesto.js';
import { libroExcel, nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../services/reportes/comun.js';
import { parseFecha, fmtFecha, fmtMiles } from '../utils/texto.js';
import { auditar, verificarCadena } from '../services/auditoria.js';
import { filtroAuditoria, excelAuditoria } from '../services/reportes/auditoriaExport.js';
import { saldoViaje, utilidadViaje } from '../services/calculos.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const nombre = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
const enviarArchivo = (res, buffer, archivo, tipo) => {
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${archivo.replace(/[^\w.-]/g, '_')}"`);
  res.send(buffer);
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const empresaDe = (req) => Empresa.findById(req.empresaId).lean();

r.get('/manifiesto/:id', permitir(P.VIAJES_VER), async (req, res) => {
  const empresa = await empresaDe(req);
  const d = await datosManifiesto(empresa, req.params.id);
  await auditar(req, 'descarga', { entidad: 'Viaje', entidadId: req.params.id, detalle: { archivo: nombreArchivo(d) } });
  enviarArchivo(res, await manifiestoPdf(d), nombreArchivo(d), 'application/pdf');
});

// ── Bitácora ────────────────────────────────────────────────────────────────
async function viajesPeriodo(req) {
  const desde = parseFecha(req.query.desde); const hasta = parseFecha(req.query.hasta);
  if (!desde || !hasta) throw new ErrorHttp(400, 'Indique el periodo (desde y hasta)');
  const f = deEmpresa(req, { fecha: { $gte: desde, $lte: hasta } });
  if (req.query.cliente && mongoose.isValidObjectId(req.query.cliente)) f.cliente = req.query.cliente;
  const viajes = await Viaje.find(f).sort({ fecha: 1, numero: 1 }).populate(pob(req.empresaId, 'cliente', 'nombre')).populate(pob(req.empresaId, 'conductor', 'nombres apellido1 apellido2 numId')).lean();
  return { viajes, desde, hasta };
}
const COL_BITACORA = [
  { titulo: 'N°', ancho: 7 }, { titulo: 'Fecha', ancho: 11, formato: 'dd/mm/yyyy' }, { titulo: 'Cliente', ancho: 20, peso: 2 },
  { titulo: 'Destino', ancho: 22, peso: 2 }, { titulo: 'Placa', ancho: 9 }, { titulo: 'Conductor', ancho: 26, peso: 2.5 },
  { titulo: 'Peso kg', ancho: 10, formato: '#,##0', alin: 'right' }, { titulo: 'Tarifa', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 },
  { titulo: 'Flete', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 }, { titulo: 'Anticipo', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 },
  { titulo: 'Saldo', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 }, { titulo: 'Utilidad', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 },
  { titulo: 'Manifiesto', ancho: 14, peso: 1.3 }, { titulo: 'Estado', ancho: 12 }, { titulo: 'Observaciones', ancho: 30, peso: 2 },
];
function filasBitacora(viajes, pdf) {
  const n = (x) => (pdf ? fmtMiles(x) : x);
  return viajes.map(v => [v.numero, pdf ? fmtFecha(v.fecha) : v.fecha, v.cliente?.nombre, v.destino, v.placa, nombre(v.conductor),
    n(v.pesoKg), n(v.tarifa), n(v.flete), n(v.anticipo), n(saldoViaje(v)), n(utilidadViaje(v)),
    v.manifiesto?.numero || '', v.estado, v.observaciones]);
}
function totalBitacora(viajes, pdf) {
  const s = (f) => viajes.reduce((a, v) => a + (Number(f(v)) || 0), 0);
  const n = (x) => (pdf ? fmtMiles(x) : x);
  return ['', '', `${viajes.length} viajes`, '', '', 'TOTAL', n(s(v => v.pesoKg)), n(s(v => v.tarifa)), n(s(v => v.flete)),
    n(s(v => v.anticipo)), n(s(saldoViaje)), n(s(v => utilidadViaje(v))), '', '', ''];
}

r.get('/bitacora.xlsx', permitir(P.REPORTES_VER, P.VIAJES_VER), async (req, res) => {
  const empresa = await empresaDe(req);
  const { viajes, desde, hasta } = await viajesPeriodo(req);
  const buf = await libroExcel({ empresa, titulo: 'Bitácora de viajes', subtitulo: `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}`,
    columnas: COL_BITACORA, filas: filasBitacora(viajes, false), total: totalBitacora(viajes, false) });
  await auditar(req, 'descarga', { detalle: { archivo: 'bitacora.xlsx', desde: fmtFecha(desde), hasta: fmtFecha(hasta), viajes: viajes.length } });
  enviarArchivo(res, buf, `Bitacora_${fmtFecha(desde)}_${fmtFecha(hasta)}.xlsx`, XLSX);
});

r.get('/bitacora.pdf', permitir(P.REPORTES_VER, P.VIAJES_VER), async (req, res) => {
  const empresa = await empresaDe(req);
  const { viajes, desde, hasta } = await viajesPeriodo(req);
  const doc = nuevoPdf('Bitácora de viajes');
  encabezadoPdf(doc, { empresa, titulo: 'Bitácora de viajes', subtitulo: `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}` });
  tablaPdf(doc, COL_BITACORA.slice(0, 14), filasBitacora(viajes, true).map(f => f.slice(0, 14)), { total: totalBitacora(viajes, true).slice(0, 14) });
  numerarPaginas(doc);
  await auditar(req, 'descarga', { detalle: { archivo: 'bitacora.pdf', desde: fmtFecha(desde), hasta: fmtFecha(hasta), viajes: viajes.length } });
  enviarArchivo(res, await pdfABuffer(doc), `Bitacora_${fmtFecha(desde)}.pdf`, 'application/pdf');
});

// ── Liquidación ─────────────────────────────────────────────────────────────
const COL_LIQ = [
  { titulo: 'Fecha', ancho: 11, formato: 'dd/mm/yyyy' }, { titulo: 'Placa', ancho: 9 }, { titulo: 'Conductor', ancho: 26, peso: 2.4 },
  { titulo: 'Manifiesto', ancho: 14, peso: 1.3 }, { titulo: 'Destino', ancho: 22, peso: 2 }, { titulo: 'Cant.', ancho: 7, alin: 'right', peso: 0.6 },
  { titulo: 'Aux.', ancho: 6, peso: 0.5 }, { titulo: 'Tarifa', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 },
  { titulo: 'Auxiliar', ancho: 12, formato: '#,##0', alin: 'right', peso: 1.1 }, { titulo: 'Total cobrado', ancho: 14, formato: '#,##0', alin: 'right', peso: 1.3 },
  { titulo: 'Flete conductor', ancho: 14, formato: '#,##0', alin: 'right', peso: 1.3 }, { titulo: 'Auxiliar pagado', ancho: 14, formato: '#,##0', alin: 'right', peso: 1.3 },
  { titulo: 'Utilidad', ancho: 13, formato: '#,##0', alin: 'right', peso: 1.2 }, { titulo: 'Util. %', ancho: 8, formato: '0.0%', alin: 'right', peso: 0.7 },
];
function filasLiq(l, pdf) {
  const n = (x) => (pdf ? fmtMiles(x) : x);
  const filas = l.lineas.map(x => [pdf ? fmtFecha(x.fecha) : new Date(x.fecha), x.placa, x.conductor, x.manifiesto, x.destino, x.cantidad,
    x.conAuxiliar ? 'Sí' : 'No', n(x.totalTarifa), n(x.totalAuxiliar), n(x.totalCobrado), n(x.totalFlete), n(x.totalAuxiliarPagado),
    n(x.utilidad), pdf ? `${(x.utilidadPct * 100).toFixed(1)} %` : x.utilidadPct]);
  const t = l.totales;
  const total = ['', '', `${t.viajes} viajes`, '', 'TOTAL', t.cantidad, '', n(t.totalTarifa), n(t.totalAuxiliar), n(t.totalCobrado),
    n(t.totalFlete), n(t.totalAuxiliarPagado), n(t.utilidad), pdf ? `${(t.utilidadPct * 100).toFixed(1)} %` : t.utilidadPct];
  return { filas, total };
}
async function liquidacionDe(req) {
  const l = await Liquidacion.findOne(deEmpresa(req, { _id: req.params.id })).populate(pob(req.empresaId, 'cliente', 'nombre nit dv razonSocial')).lean();
  if (!l) throw new ErrorHttp(404, 'Liquidación no encontrada');
  return l;
}

r.get('/liquidacion/:id.xlsx', permitir(P.LIQUIDACION_VER), async (req, res) => {
  const [empresa, l] = await Promise.all([empresaDe(req), liquidacionDe(req)]);
  const { filas, total } = filasLiq(l, false);
  const buf = await libroExcel({ empresa, titulo: `Liquidación ${l.numero} - ${l.cliente?.nombre}`, subtitulo: l.titulo, columnas: COL_LIQ, filas, total });
  await auditar(req, 'descarga', { entidad: 'Liquidacion', entidadId: l._id, detalle: { archivo: `Liquidacion_${l.numero}.xlsx` } });
  enviarArchivo(res, buf, `Liquidacion_${l.numero}.xlsx`, XLSX);
});

r.get('/liquidacion/:id.pdf', permitir(P.LIQUIDACION_VER), async (req, res) => {
  const [empresa, l] = await Promise.all([empresaDe(req), liquidacionDe(req)]);
  const doc = nuevoPdf(`Liquidación ${l.numero}`);
  encabezadoPdf(doc, { empresa, titulo: `Liquidación de fletes N° ${l.numero} — ${l.cliente?.razonSocial || l.cliente?.nombre}`, subtitulo: `${l.titulo} · Estado: ${l.estado}` });
  const { filas, total } = filasLiq(l, true);
  tablaPdf(doc, COL_LIQ, filas, { total });
  numerarPaginas(doc);
  await auditar(req, 'descarga', { entidad: 'Liquidacion', entidadId: l._id, detalle: { archivo: `Liquidacion_${l.numero}.pdf` } });
  enviarArchivo(res, await pdfABuffer(doc), `Liquidacion_${l.numero}.pdf`, 'application/pdf');
});

// ── Auditoría de la empresa ─────────────────────────────────────────────────
r.get('/auditoria', permitir(P.AUDITORIA_VER), async (req, res) => {
  const lista = await Auditoria.find(filtroAuditoria(req.query, { empresa: req.empresaId }))
    .sort({ createdAt: -1, seq: -1 }).limit(Math.min(Number(req.query.limite) || 300, 1000)).lean();
  res.json(lista);
});

r.get('/auditoria/verificar', permitir(P.AUDITORIA_VER), async (req, res) => {
  const v = await verificarCadena(req.empresaId);
  await auditar(req, 'verificar_auditoria', { detalle: { integra: v.integra, total: v.total } });
  res.json(v);
});

r.get('/auditoria.xlsx', permitir(P.AUDITORIA_VER), async (req, res) => {
  const empresa = await empresaDe(req);
  const buf = await excelAuditoria(empresa, filtroAuditoria(req.query, { empresa: req.empresaId }), 'Auditoría');
  await auditar(req, 'exportar_auditoria', { detalle: { desde: req.query.desde, hasta: req.query.hasta } });
  enviarArchivo(res, buf, 'Auditoria.xlsx', XLSX);
});

export default r;
