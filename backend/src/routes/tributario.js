// Contabilidad fase 3 (tributario y fiscal). Se monta dentro de /api/gestion (ya autenticado).
import { Router } from 'express';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { permitir, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { parseFecha, fmtFecha } from '../utils/texto.js';
import { libroExcel } from '../services/reportes/comun.js';
import * as trib from '../services/gestion/tributario.js';
import { guardarParametros } from '../services/gestion/contabilidad.js';

const r = Router();
const ver = permitir(P.CONTABILIDAD_VER); const gestionar = permitir(P.CONTABILIDAD_GESTIONAR);
const empresaDe = (req) => Empresa.findById(req.empresaId).lean();
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const mesQ = (v) => { if (!/^\d{4}-\d{2}$/.test(String(v || ''))) throw new ErrorHttp(400, 'Mes inválido (aaaa-mm)'); return String(v); };
const rangoQ = (req) => {
  const desde = parseFecha(req.query.desde); const hasta = parseFecha(req.query.hasta);
  if (!desde || !hasta) throw new ErrorHttp(400, 'Indique desde y hasta');
  return { desde, hasta: new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate(), 23, 59, 59)) };
};
async function excel(req, res, { titulo, subtitulo, columnas, filas, nombre }) {
  const buf = await libroExcel({ empresa: await empresaDe(req), titulo, subtitulo,
    columnas: columnas.map(c => ({ titulo: c, ancho: /Nombre/.test(c) ? 36 : 16, formato: /Pago|Retención|ReteIVA|IVA|Ingresos|Devoluciones|Saldo|Base|Valor|Recibido/.test(c) ? '#,##0' : undefined })), filas });
  res.setHeader('Content-Type', XLSX); res.setHeader('Content-Disposition', `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}"`);
  res.send(buf);
}

// Retención en la fuente (350) del mes
r.get('/tributario/350', ver, async (req, res) => res.json(await trib.borrador350(req.empresaId, mesQ(req.query.mes))));
// ReteICA practicado e ICA propio del periodo
r.get('/tributario/reteica', ver, async (req, res) => { const { desde, hasta } = rangoQ(req); res.json(await trib.borradorReteIca(req.empresaId, desde, hasta)); });
r.get('/tributario/ica', ver, async (req, res) => { const { desde, hasta } = rangoQ(req); res.json(await trib.borradorIca(req.empresaId, desde, hasta)); });

// Pago de impuestos
r.post('/tributario/pagos', gestionar, async (req, res) => {
  const d = z.object({ fecha: z.string(), periodo: z.string().trim().min(4).max(20), formulario: z.string().max(30).optional().default(''),
    cuenta: z.enum(['1110', '1105']).default('1110'), intereses: z.coerce.number().min(0).default(0), sancion: z.coerce.number().min(0).default(0),
    items: z.array(z.object({ tipo: z.enum(Object.keys(trib.IMPUESTOS)), valor: z.coerce.number().min(0) })).min(1).max(7) }).parse(req.body);
  const fecha = parseFecha(d.fecha); if (!fecha) throw new ErrorHttp(400, 'Fecha inválida');
  const p = await trib.pagarImpuestos(req.empresaId, { ...d, fecha, usuario: req.usuario._id });
  await auditar(req, 'pago_impuestos', { detalle: p });
  res.status(201).json(p);
});

// Calendario de vencimientos
r.get('/tributario/vencimientos', ver, async (req, res) => res.json(await trib.vencimientos(req.empresaId)));
r.put('/tributario/vencimientos', gestionar, async (req, res) => {
  const d = z.object({ vencimientos: z.array(z.object({ obligacion: z.enum(Object.keys(trib.IMPUESTOS)), periodo: z.string().trim().min(4).max(20), fecha: z.string() })).max(200) }).parse(req.body);
  const lista = d.vencimientos.map(v => ({ ...v, fecha: parseFecha(v.fecha) }));
  if (lista.some(v => !v.fecha)) throw new ErrorHttp(400, 'Hay fechas inválidas en el calendario');
  await guardarParametros(req.empresaId, { vencimientos: lista });
  await auditar(req, 'calendario_tributario', { detalle: { vencimientos: lista.length } });
  res.json(await trib.vencimientos(req.empresaId));
});
// Parámetros del ICA (tarifa del municipio)
r.put('/tributario/ica/parametros', gestionar, async (req, res) => {
  const d = z.object({ icaTarifaPorMil: z.coerce.number().min(0).max(30), avisosTablerosPct: z.coerce.number().min(0).max(100), sobretasaBomberilPct: z.coerce.number().min(0).max(100) }).parse(req.body);
  await guardarParametros(req.empresaId, d);
  res.json(d);
});

// Información exógena (JSON o Excel)
r.get('/tributario/exogena/:formato', ver, async (req, res) => {
  const anio = Number(req.query.anio) || new Date().getUTCFullYear() - 1;
  const x = await trib.exogena(req.empresaId, anio, req.params.formato);
  if (req.query.formato === 'xlsx') return excel(req, res, { ...x, subtitulo: `Año gravable ${anio} · borrador para el prevalidador de la DIAN; debe revisarlo la contadora`, nombre: `Exogena_${x.formato}_${anio}.xlsx` });
  res.json({ ...x, anio });
});

// Certificados de retención
r.get('/tributario/certificados', ver, async (req, res) => res.json(await trib.retencionesPorProveedor(req.empresaId, Number(req.query.anio) || new Date().getUTCFullYear() - 1)));
r.get('/tributario/certificados/:nit', ver, async (req, res) => {
  const anio = Number(req.query.anio) || new Date().getUTCFullYear() - 1; const tipo = String(req.query.tipo || 'fuente');
  const buf = await trib.certificadoPdf(await empresaDe(req), req.empresaId, { nit: req.params.nit, anio, tipo });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.ver === '1' ? 'inline' : 'attachment'}; filename="Certificado_${tipo}_${req.params.nit.replace(/\D/g, '')}_${anio}.pdf"`);
  res.send(buf);
});

// Factura electrónica de transporte: número y CUFE de la DIAN y relación de remesas
r.put('/tributario/facturas/:numero/fe', gestionar, async (req, res) => {
  const d = z.object({ numero: z.string().max(40).default(''), cufe: z.string().max(120).default(''), tipoOperacion: z.enum(['12', '13']).default('12') }).parse(req.body);
  const f = await trib.guardarDatosFe(req.empresaId, req.params.numero, d);
  await auditar(req, 'factura_electronica', { entidad: 'FacturaCont', entidadId: f._id, detalle: { numero: f.numero, fe: f.fe } });
  res.json({ numero: f.numero, fe: f.fe });
});
r.get('/tributario/facturas/:numero/relacion-remesas', ver, async (req, res) => {
  const x = await trib.relacionRemesas(req.empresaId, req.params.numero);
  const nombre = `RELACION_REMESAS_${x.fe.numero || x.factura}`;
  if (req.query.formato === 'txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}.txt"`);
    return res.send([x.columnas, ...x.filas].map(f => f.join('\t')).join('\r\n'));
  }
  if (req.query.formato === 'xlsx') return excel(req, res, { titulo: `Relación de remesas · factura ${x.fe.numero || x.factura}`, subtitulo: `Generada el ${fmtFecha(new Date())}`,
    columnas: x.columnas, filas: x.filas, nombre: `${nombre}.xlsx` });
  res.json(x);
});

export default r;
