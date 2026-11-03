// Contabilidad fase 6: rentabilidad por viaje, vehículo, cliente o ruta. Se monta dentro de /api/gestion (ya autenticado).
import { Router } from 'express';
import { z } from 'zod';
import { Empresa } from '../models/index.js';
import { permitir, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { parseFecha, fmtFecha } from '../utils/texto.js';
import { libroExcel, nuevoPdf, encabezadoPdf, tablaPdf, numerarPaginas, pdfABuffer } from '../services/reportes/comun.js';
import * as R from '../services/gestion/rentabilidad.js';

const r = Router();
const ver = permitir(P.CONTABILIDAD_VER);
const NOMBRES = { viaje: 'viaje', placa: 'vehículo', cliente: 'cliente', ruta: 'ruta' };
const pesos = (v) => `$ ${Math.round(v || 0).toLocaleString('es-CO')}`;

r.get('/contabilidad/rentabilidad', ver, async (req, res) => {
  const q = z.object({ desde: z.string(), hasta: z.string(), agrupar: z.enum(R.AGRUPACIONES).default('placa'),
    placa: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,7}$/).optional().default(''), cliente: z.string().max(30).optional().default(''),
    formato: z.enum(['json', 'xlsx', 'pdf']).default('json'), ver: z.string().optional() }).parse(req.query);
  const desde = parseFecha(q.desde); const h = parseFecha(q.hasta);
  if (!desde || !h) throw new ErrorHttp(400, 'Indique desde y hasta');
  const hasta = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate(), 23, 59, 59));
  const x = await R.rentabilidad(req.empresaId, { desde, hasta, agrupar: q.agrupar, placa: q.placa, cliente: q.cliente });
  if (q.formato === 'json') return res.json(x);
  const titulo = `Rentabilidad por ${NOMBRES[q.agrupar]}`;
  const subtitulo = `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}${q.placa ? ` · placa ${q.placa}` : ''} · utilidad de la operación (sin gastos generales)`;
  const empresa = await Empresa.findById(req.empresaId).lean();
  const nombre = `Rentabilidad_${q.agrupar}_${q.desde}_${q.hasta}`.replace(/[^\w.-]/g, '_');
  if (q.formato === 'xlsx') {
    const buf = await libroExcel({ empresa, titulo, subtitulo,
      columnas: R.COLUMNAS.map((c, i) => ({ titulo: c, ancho: i === 1 ? 40 : 15, formato: i >= 3 && i <= 7 ? '#,##0' : i === 8 ? '0.0' : undefined })),
      filas: [...x.filas.map(R.filaExcel), R.filaExcel(x.totales)] });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
    return res.send(buf);
  }
  const doc = nuevoPdf(titulo, 'landscape');
  encabezadoPdf(doc, { empresa, titulo: titulo.toUpperCase(), subtitulo });
  const T = x.totales;
  tablaPdf(doc, [{ titulo: NOMBRES[q.agrupar][0].toUpperCase() + NOMBRES[q.agrupar].slice(1), peso: 4 }, { titulo: 'Viajes', peso: 1, alin: 'right' },
    { titulo: 'Ingreso', peso: 2, alin: 'right' }, { titulo: 'Flete', peso: 2, alin: 'right' }, { titulo: 'Auxiliar', peso: 2, alin: 'right' },
    { titulo: 'Costos vehículo', peso: 2, alin: 'right' }, { titulo: 'Utilidad', peso: 2, alin: 'right' }, { titulo: 'Margen', peso: 1, alin: 'right' }],
  x.filas.map(f => [f.nombre, String(f.viajes), pesos(f.ingreso), pesos(f.flete), pesos(f.auxiliar), pesos(f.costosVehiculo), pesos(f.utilidad), `${f.margen} %`]),
  { total: ['Total', String(T.viajes), pesos(T.ingreso), pesos(T.flete), pesos(T.auxiliar), pesos(T.costosVehiculo), pesos(T.utilidad), `${T.margen} %`] });
  numerarPaginas(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${q.ver === '1' ? 'inline' : 'attachment'}; filename="${nombre}.pdf"`);
  res.send(await pdfABuffer(doc));
});

export default r;
