import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env.js';

export function noEncontrado(_req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

// Manejador central: nunca expone trazas internas al cliente.
export function manejarErrores(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos',
      detalles: err.issues.map(i => `${i.path.join('.') || 'dato'}: ${i.message}`),
    });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: Object.values(err.errors).map(e => e.message) });
  }
  if (err instanceof mongoose.Error.CastError) return res.status(400).json({ error: 'Identificador inválido' });
  if (err?.code === 11000) {
    if (err.keyPattern?.rol && err.keyPattern?.empresa) return res.status(409).json({ error: 'La empresa ya tiene un administrador' });
    if (err.keyPattern?.rol) return res.status(409).json({ error: 'Ya existe un SuperAdmin en la plataforma' });
    const campos = Object.keys(err.keyPattern || {}).filter(k => k !== 'empresa').join(', ');
    return res.status(409).json({ error: `Ya existe un registro con ese valor${campos ? ` (${campos})` : ''}` });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 && env.nodeEnv === 'production' ? 'Error interno del servidor' : err.message,
    ...(err.detalles ? { detalles: err.detalles } : {}),
  });
}
