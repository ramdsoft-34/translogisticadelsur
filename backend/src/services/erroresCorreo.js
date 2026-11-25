// Errores del servidor de correo (SMTP) explicados en palabras claras, y cuáles son temporales.
// Un error temporal (servidor ocupado, conexión caída) se reintenta solo; uno permanente (contraseña,
// dirección inexistente) queda como error para que alguien lo corrija.
const CONEXION = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'EDNS', 'ECONNRESET'];

// Código SMTP de 3 cifras: el de nodemailer o el que viene en el texto («421 4.4.5 Server busy»)
function codigoSmtp(e) {
  if (Number(e?.responseCode)) return Number(e.responseCode);
  const m = /\b([245]\d{2})[ -](?:\d\.\d\.\d+)?/.exec(String(e?.response || e?.message || e || ''));
  return m ? Number(m[1]) : 0;
}

// Límite diario de Gmail: es un 550/421 pero no se arregla en minutos
const limiteDiario = (t) => /daily (user )?sending (quota|limit)|limit exceeded|5\.4\.5/i.test(t);

/** ¿Se puede reintentar solo? (servidor ocupado, conexión caída o código 4xx) */
export function esTemporal(e) {
  const t = String(e?.response || e?.message || '');
  if (limiteDiario(t) && !/4\.4\.5/.test(t)) return false;
  if (CONEXION.includes(e?.code)) return true;
  const c = codigoSmtp(e);
  return c >= 400 && c < 500;
}

/** Explicación clara de un error de correo (con el detalle técnico al final). Acepta el error o el texto guardado. */
export function errorCorreoClaro(e) {
  const t = String(e?.message || e || '').trim();
  if (!t) return '';
  if (/^(El servidor de correo|No hubo conexión|La contraseña|Una dirección|Los adjuntos|El servidor marcó|Gmail llegó|La cuenta de correo)/.test(t)) return t;   // ya aclarado
  const c = codigoSmtp(e?.responseCode ? e : t);
  const detalle = ` (detalle: ${t.replace(/\s+/g, ' ').slice(0, 220)})`;
  let claro = '';
  if (limiteDiario(t) && !/4\.4\.5/.test(t)) claro = 'Gmail llegó a su límite diario de envíos de esta cuenta. Los correos podrán salir mañana; presione «Reintentar» entonces';
  else if (c === 421 || /server busy|try again later|too many (connections|messages)/i.test(t)) claro = 'El servidor de correo (Gmail) estaba ocupado y no recibió el correo. Es temporal: la plataforma lo reintenta sola';
  else if (CONEXION.includes(e?.code) || /ECONNECTION|ETIMEDOUT|ESOCKET|ECONNREFUSED|EDNS|ECONNRESET|timeout/i.test(t)) claro = 'No hubo conexión con el servidor de correo. Es temporal: la plataforma lo reintenta sola';
  else if (c === 535 || c === 534 || /EAUTH|Invalid login|Username and Password not accepted|authentication/i.test(t)) claro = 'La contraseña de la cuenta de correo no es válida o venció (Configuración → Correo). Para Gmail se usa una contraseña de aplicación';
  else if (c === 550 || c === 553 || /recipient|no such user|does not exist|address rejected/i.test(t)) claro = 'Una dirección de destino no existe o el servidor la rechazó. Revise los destinatarios del cliente (Configuración → Correo)';
  else if (c === 552 || /size|too large/i.test(t)) claro = 'Los adjuntos superan el tamaño que permite el servidor de correo';
  else if (c === 554 || /spam|blocked|policy/i.test(t)) claro = 'El servidor marcó el correo como no deseado o lo bloqueó por sus políticas';
  else if (c >= 400 && c < 500) claro = 'El servidor de correo rechazó el envío por un momento. Es temporal: la plataforma lo reintenta sola';
  return claro ? `${claro}${detalle}`.slice(0, 500) : t.slice(0, 500);
}

// Esperas antes de cada reintento automático (después del 1.°, 2.° y 3.° intento fallido)
export const ESPERAS_MIN = [2, 5, 15];
/** Fecha del próximo reintento según los intentos ya hechos, o null si ya no se reintenta solo */
export function proximoReintento(intentos, ahora = Date.now()) {
  const espera = ESPERAS_MIN[intentos - 1];
  return espera ? new Date(ahora + espera * 60000) : null;
}
export const horaColombia = (d) => new Date(d).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
