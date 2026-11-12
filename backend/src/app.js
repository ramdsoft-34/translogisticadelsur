import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { manejarErrores, noEncontrado } from './middleware/errores.js';
import publico from './routes/publico.js';
import auth from './routes/auth.js';
import superadmin from './routes/superadmin.js';
import correo from './routes/correo.js';
import gmail from './routes/gmail.js';
import usuarios from './routes/usuarios.js';
import maestros from './routes/maestros.js';
import viajes from './routes/viajes.js';
import rndc from './routes/rndc.js';
import liquidaciones from './routes/liquidaciones.js';
import gestion from './routes/gestion.js';
import reportes from './routes/reportes.js';
import importaciones from './routes/importaciones.js';
import rastreo from './routes/rastreo.js';
import sst from './routes/sst.js';
import eventos from './routes/eventos.js';
import anticipos, { publico as anticiposPublico, webhook as webhookWhatsapp } from './routes/anticipos.js';
import { avisarCambios } from './services/eventos.js';

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
    // La sesión va en una cookie: solo los orígenes permitidos pueden enviarla
    credentials: true,
  }));
  // Los correos con archivos adjuntos traen su propio límite (12 MB) en la ruta
  // El webhook de WhatsApp necesita el cuerpo exacto para validar la firma de Meta (fase 15)
  const json = express.json({ limit: '1mb', verify: (req, _res, buf) => { if (req.originalUrl?.startsWith('/api/whatsapp/webhook')) req.cuerpoCrudo = buf; } });
  // Fase 15: la foto del soporte del anticipo (y la firma, si fue en efectivo)
  const jsonSoporte = express.json({ limit: '2mb' });
  const esSoporte = (p) => /^\/api\/a\/[A-Za-z0-9_-]+\/viajes\/[a-f0-9]{24}\/soporte$/.test(p) || /^\/api\/anticipos\/[a-f0-9]{24}\/soporte$/.test(p);
  // (también el correo de una relación de cobro, que trae sus archivos adjuntos: fase 11)
  const conLimitePropio = (p) => /^\/api\/correo\/(relaciones|manual)$/.test(p) || p === '/api/gmail/enviar' || /^\/api\/gestion\/relaciones-cobro\/[a-f0-9]{24}\/correo$/.test(p);
  app.use((req, res, next) => (conLimitePropio(req.path) ? next() : esSoporte(req.path) ? jsonSoporte(req, res, next) : json(req, res, next)));
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/api/salud', (_req, res) => res.json({ ok: true }));
  // Cambios en vivo: canal SSE y aviso de cada modificación a los usuarios de la empresa
  app.use('/api/eventos', eventos);
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', avisarCambios);
  app.use('/api/whatsapp/webhook', webhookWhatsapp);   // fase 15: avisos de Meta (enviado, entregado, leído)
  app.use('/api/publico', publico);
  app.use('/api/a', anticiposPublico);                  // fase 15: enlace del mensajero
  app.use('/api/auth', auth);
  app.use('/api/admin', superadmin);
  app.use('/api/usuarios', usuarios);
  app.use('/api/maestros', maestros);
  app.use('/api/viajes', viajes);
  app.use('/api/rndc', rndc);
  app.use('/api/correo', correo);
  app.use('/api/gmail', gmail);          // Fase 14: Gmail de cada usuario
  app.use('/api/liquidaciones', liquidaciones);
  app.use('/api/gestion', gestion);
  app.use('/api/reportes', reportes);
  app.use('/api/importaciones', importaciones);
  app.use('/api/rastreo', rastreo);
  app.use('/api/sst', sst);
  app.use('/api/anticipos', anticipos);                 // fase 15: soportes de anticipos

  app.use(noEncontrado);
  app.use(manejarErrores);
  return app;
}
