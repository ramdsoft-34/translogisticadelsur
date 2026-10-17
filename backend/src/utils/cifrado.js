// Cifrado simétrico (AES-256-GCM) para secretos que la plataforma debe poder usar,
// como la contraseña SMTP de la empresa. La llave sale de CLAVE_CIFRADO (o, si no
// está definida, se deriva de JWT_SECRET); nunca se guarda en la base de datos.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

function llave() {
  const base = process.env.CLAVE_CIFRADO || `${env.jwtSecret}|translogistica-cifrado`;
  return crypto.createHash('sha256').update(base).digest();
}

export function cifrar(texto) {
  if (!texto) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join(':');
}

export function descifrar(valor) {
  if (!valor) return '';
  const [v, iv, tag, datos] = String(valor).split(':');
  if (v !== 'v1') throw new Error('Formato de secreto desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}
