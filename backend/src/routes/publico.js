// Rutas públicas (sin sesión): verificación del soporte interno desde su código QR y, desde la fase 11,
// el enlace de la relación de cobro que recibe la empresa (/r/<token>).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verificarSoporte } from '../services/gestion/soporteInterno.js';
import { ErrorHttp } from '../middleware/auth.js';
import * as REL from '../services/gestion/relaciones.js';
import { ultimoGuardado } from '../services/documentos/guardados.js';

const r = Router();
r.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

r.get('/soportes/:codigo', async (req, res) => {
  const d = await verificarSoporte(req.params.codigo);
  if (!d) throw new ErrorHttp(404, 'No existe un soporte interno con ese código');
  res.json(d);
});

// Fase 11: enlace de una relación de cobro (lo recibe la empresa por WhatsApp o correo): resumen y descarga del PDF y el Excel
r.get('/relaciones/:token', async (req, res) => {
  const rel = await REL.porToken(req.params.token, { agente: req.get('user-agent') });
  if (!rel) throw new ErrorHttp(404, 'El enlace no existe');
  res.setHeader('Cache-Control', 'no-store');
  res.json(await REL.resumenPublico(rel));
});
r.get('/relaciones/:token/archivo', async (req, res) => {
  const rel = await REL.porToken(req.params.token, { anotar: false });
  if (!rel) throw new ErrorHttp(404, 'El enlace no existe');
  const pdf = req.query.formato !== 'xlsx';
  // Lo que se le envió a la empresa: si la relación volvió a borrador con cambios sin reenviar, sigue viendo lo enviado
  let buffer; let nombre;
  if (rel.estado === 'borrador' && rel.envios?.length) {
    const g = await ultimoGuardado(rel.empresa, pdf ? 'relacion-cobro' : 'relacion-cobro-excel', rel._id);
    if (g) { buffer = g.buffer; nombre = g.nombre; }
  }
  if (!buffer) {
    const a = await REL.archivos(rel.empresa, rel._id);
    buffer = pdf ? a.pdf : a.xlsx; nombre = `${a.nombre}.${pdf ? 'pdf' : 'xlsx'}`;
  }
  res.setHeader('Content-Type', pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `${pdf && req.query.descargar !== '1' ? 'inline' : 'attachment'}; filename="${String(nombre).replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
});

export default r;
