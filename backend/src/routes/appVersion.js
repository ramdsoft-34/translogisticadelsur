// Versión de la app Sur Track (de toda la plataforma): solo el superadministrador.
// Se guarda en el backend de Sur Track, que avisa a la app y rechaza versiones por debajo del mínimo.
import { Router } from 'express';
import { z } from 'zod';
import { autenticar, permitir, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar } from '../services/auditoria.js';
import { configuradoServidor, llamarApp } from '../services/rastreo/surtrack.js';

const r = Router();
r.use(autenticar, permitir(P.EMPRESAS_GESTIONAR), (_req, _res, next) => {
  if (!configuradoServidor('app')) throw new ErrorHttp(503, 'La app de conductores no está configurada en el servidor');
  next();
});

r.get('/', async (_req, res) => res.json(await llamarApp('/app-version')));

r.put('/', async (req, res) => {
  const d = z.object({
    minimo: z.coerce.number().int().min(0).max(1000000),
    ultimaCodigo: z.coerce.number().int().min(0).max(1000000),
    ultimaNombre: z.string().trim().max(30).default(''),
    tipo: z.enum(['recomendada', 'obligatoria']),
    novedades: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    funciones: z.string().trim().max(300).default(''),
  }).parse(req.body);
  const v = await llamarApp('/app-version', { metodo: 'PUT', cuerpo: { ...d, por: String(req.usuario.nombre || req.usuario.email).slice(0, 120) } });
  await auditar(req, 'configurar_version_app', { empresa: null, detalle: d });
  res.json(v);
});

export default r;
