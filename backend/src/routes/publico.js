// Rutas públicas (sin sesión): verificación del soporte interno desde su código QR y, desde la fase 9,
// el manifiesto del conductor por su enlace propio (/m/<token>).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verificarSoporte } from '../services/gestion/soporteInterno.js';
import { ErrorHttp } from '../middleware/auth.js';
import { Empresa } from '../models/index.js';
import { abrirEnlace } from '../services/manifiestoConductor.js';
import { z } from 'zod';
import * as FR from '../services/sst/firmaRemota.js';
import * as REL from '../services/gestion/relaciones.js';
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

// Fase 11: enlace de una relación de cobro (lo recibe la empresa por WhatsApp): resumen y descarga del PDF y el Excel
r.get('/relaciones/:token', async (req, res) => {
  const rel = await REL.porToken(req.params.token);
  if (!rel) throw new ErrorHttp(404, 'El enlace no existe');
  res.json(await REL.resumenPublico(rel));
});
r.get('/relaciones/:token/archivo', async (req, res) => {
  const rel = await REL.porToken(req.params.token, { anotar: false });
  if (!rel) throw new ErrorHttp(404, 'El enlace no existe');
  const a = await REL.archivos(rel.empresa, rel._id);
  const pdf = req.query.formato !== 'xlsx';
  res.setHeader('Content-Type', pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `${pdf && req.query.descargar !== '1' ? 'inline' : 'attachment'}; filename="${a.nombre}.${pdf ? 'pdf' : 'xlsx'}"`);
  res.send(pdf ? a.pdf : a.xlsx);
});

// Fase 10: firma de la asistencia a una capacitación desde el celular
r.get('/firmas/:token', async (req, res) => {
  const d = await FR.verEnlace(req.params.token);
  if (!d) throw new ErrorHttp(404, 'El enlace no existe');
  res.json(d);
});
r.post('/firmas/:token', async (req, res) => {
  const d = z.object({ ultimos4: z.string().max(8), imagen: z.string().max(200_000), acepto: z.boolean(),
    ubicacion: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional() }).parse(req.body || {});
  res.json(await FR.firmar(req.params.token, d, { ip: req.ip, agente: req.get('user-agent') }));
});

export default r;
