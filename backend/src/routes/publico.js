// Rutas públicas (sin sesión): verificación del soporte interno desde su código QR y, desde la fase 9,
// el manifiesto del conductor por su enlace propio (/m/<token>).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verificarSoporte } from '../services/gestion/soporteInterno.js';
import { ErrorHttp } from '../middleware/auth.js';
import { Empresa } from '../models/index.js';
import { abrirEnlace } from '../services/manifiestoConductor.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from '../services/reportes/manifiesto.js';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

r.get('/soportes/:codigo', async (req, res) => {
  const d = await verificarSoporte(req.params.codigo);
  if (!d) throw new ErrorHttp(404, 'No existe un soporte interno con ese código');
  res.json(d);
});

// Manifiesto del conductor: datos para la página y el PDF (el mismo que se descarga del RNDC)
r.get('/manifiestos/:token', async (req, res) => {
  const d = await abrirEnlace(req.params.token);
  if (!d) throw new ErrorHttp(404, 'El enlace no existe');
  res.json(d.publico);
});
r.get('/manifiestos/:token/pdf', async (req, res) => {
  const d = await abrirEnlace(req.params.token, { anotar: false });
  if (!d) throw new ErrorHttp(404, 'El enlace no existe');
  if (d.motivo) throw new ErrorHttp(410, d.motivo);
  const empresa = await Empresa.findById(d.v.empresa).lean();
  const m = await datosManifiesto(empresa, d.v._id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.descargar === '1' ? 'attachment' : 'inline'}; filename="${nombreArchivo(m).replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(await manifiestoPdf(m));
});

export default r;
