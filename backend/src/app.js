import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { manejarErrores, noEncontrado } from './middleware/errores.js';
import auth from './routes/auth.js';
import superadmin from './routes/superadmin.js';
import correo from './routes/correo.js';
import usuarios from './routes/usuarios.js';
import maestros from './routes/maestros.js';
import viajes from './routes/viajes.js';
import rndc from './routes/rndc.js';
import liquidaciones from './routes/liquidaciones.js';
import reportes from './routes/reportes.js';
import importaciones from './routes/importaciones.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    // En desarrollo se acepta cualquier puerto local (ng serve puede cambiar de puerto).
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)
      || (env.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))),
    exposedHeaders: ['Content-Disposition'],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/salud', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth);
  app.use('/api/admin', superadmin);
  app.use('/api/usuarios', usuarios);
  app.use('/api/maestros', maestros);
  app.use('/api/viajes', viajes);
  app.use('/api/rndc', rndc);
  app.use('/api/correo', correo);
  app.use('/api/liquidaciones', liquidaciones);
  app.use('/api/reportes', reportes);
  app.use('/api/importaciones', importaciones);

  app.use(noEncontrado);
  app.use(manejarErrores);
  return app;
}
