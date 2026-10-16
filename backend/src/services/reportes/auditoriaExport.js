// Filtros y exportación de la auditoría (evidencias para auditorías internas o externas).
import mongoose from 'mongoose';
import { Auditoria } from '../../models/index.js';
import { libroExcel } from './comun.js';
import { parseFecha, escaparRegex } from '../../utils/texto.js';

export function filtroAuditoria(q, base = {}) {
  const f = { ...base };
  const desde = parseFecha(q.desde); const hasta = parseFecha(q.hasta);
  if (desde || hasta) f.createdAt = { ...(desde ? { $gte: desde } : {}), ...(hasta ? { $lt: new Date(hasta.getTime() + 86400000) } : {}) };
  if (q.accion) f.accion = String(q.accion);
  if (q.resultado) f.resultado = String(q.resultado);
  if (q.usuario && mongoose.isValidObjectId(q.usuario)) f.usuario = q.usuario;
  if (q.q) f.usuarioNombre = new RegExp(escaparRegex(String(q.q)), 'i');
  return f;
}

export async function excelAuditoria(empresa, filtro, titulo) {
  const lista = await Auditoria.find(filtro).sort({ cadena: 1, seq: 1 }).limit(50000).lean();
  return libroExcel({
    empresa, titulo, subtitulo: `${lista.length} registro(s). Cada registro incluye su hash SHA-256 encadenado.`,
    columnas: [
      { titulo: 'Seq', ancho: 7 }, { titulo: 'Fecha (UTC)', ancho: 20 }, { titulo: 'Usuario', ancho: 24 }, { titulo: 'Acción', ancho: 22 },
      { titulo: 'Resultado', ancho: 10 }, { titulo: 'Entidad', ancho: 12 }, { titulo: 'Id', ancho: 26 }, { titulo: 'Detalle', ancho: 60 },
      { titulo: 'IP', ancho: 16 }, { titulo: 'Hash', ancho: 66 },
    ],
    filas: lista.map(a => [a.seq, a.createdAt.toISOString().replace('T', ' ').slice(0, 19), a.usuarioNombre, a.accion, a.resultado,
      a.entidad, a.entidadId, JSON.stringify(a.detalle || {}), a.ip, a.hash]),
  });
}
