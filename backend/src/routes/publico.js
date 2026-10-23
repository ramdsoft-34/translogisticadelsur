// Rutas públicas (sin sesión): verificación del soporte interno desde su código QR.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verificarSoporte } from '../services/gestion/soporteInterno.js';
import { ErrorHttp } from '../middleware/auth.js';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

r.get('/soportes/:codigo', async (req, res) => {
  const d = await verificarSoporte(req.params.codigo);
  if (!d) throw new ErrorHttp(404, 'No existe un soporte interno con ese código');
  res.json(d);
});

export default r;
