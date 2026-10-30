// Doble factor con app autenticadora (TOTP, RFC 6238: HMAC-SHA1, 6 dígitos, pasos de 30 s).
// Compatible con Google Authenticator, Microsoft Authenticator, Authy…
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0; let valor = 0; let salida = '';
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { salida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += B32[(valor << (5 - bits)) & 31];
  return salida;
}
function desdeBase32(s) {
  const limpio = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let valor = 0; const bytes = [];
  for (const c of limpio) {
    valor = (valor << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export const nuevoSecreto = () => base32(crypto.randomBytes(20));
export const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 30000);

export function codigoTotp(secreto, paso = pasoActual()) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', desdeBase32(secreto)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

// Devuelve el paso que coincide (tolera ±1 paso de desfase del reloj) o -1. `ultimoPaso` evita reutilizar un código.
export function verificarTotp(secreto, codigo, { ultimoPaso = 0, ahora = Date.now() } = {}) {
  const c = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secreto) return -1;
  const p = pasoActual(ahora);
  for (const paso of [p, p - 1, p + 1]) {
    if (paso <= ultimoPaso) continue;
    const esperado = codigoTotp(secreto, paso);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(c))) return paso;
  }
  return -1;
}

export const urlOtpauth = (secreto, cuenta, emisor = 'Translogística del Sur') =>
  `otpauth://totp/${encodeURIComponent(`${emisor}:${cuenta}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
