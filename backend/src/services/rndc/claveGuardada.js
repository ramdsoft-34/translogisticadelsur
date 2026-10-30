// Contraseña del web service del RNDC guardada en el servidor, para no escribirla en cada envío.
//
// Protección (solo para este secreto, separada del resto de la plataforma):
// - Llave maestra propia de 256 bits que NO está en la base de datos ni en el repositorio: un archivo del
//   servidor solo legible por el sistema (RNDC_LLAVE_ARCHIVO) o la variable RNDC_LLAVE_MAESTRA. Una copia de
//   la base de datos, sola, no sirve para descifrarla.
// - Cada vez que se guarda se deriva una llave nueva con HKDF-SHA512 (sal aleatoria de 32 bytes, ligada a la
//   empresa) y se cifra con AES-256-GCM (IV aleatorio, autenticado). Los datos adicionales autenticados atan
//   el cifrado a la empresa y al usuario del RNDC: copiado a otra empresa o con otro usuario, no se descifra.
// - Colección aparte (SecretoRndc), sin rutas que la devuelvan: la contraseña nunca sale del servidor ni se
//   muestra; solo se descifra en memoria en el momento de enviar al RNDC y el búfer se borra al terminar.
// - Guardarla exige la contraseña de la plataforma del administrador (y su código de doble factor si lo
//   tiene) y se comprueba con una consulta al RNDC antes de guardarla.
// - Si el RNDC la rechaza queda marcada como inválida y se deja de usar (no se insiste: el RNDC bloquea el
//   usuario tras varios intentos); hay que guardar la nueva.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { SecretoRndc } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';

export const CLAVE_GUARDADA = '__clave_rndc_guardada__';   // marcador que envía la interfaz para usar la guardada
const VERSION = 1;

let maestraCache = null;
function llaveMaestra() {
  if (maestraCache) return maestraCache;
  let base = '';
  const archivo = process.env.RNDC_LLAVE_ARCHIVO;
  if (archivo) {
    try { base = fs.readFileSync(archivo, 'utf8').trim(); } catch { base = ''; }
  }
  if (!base) base = String(process.env.RNDC_LLAVE_MAESTRA || '').trim();
  if (!base) return null;
  const llave = Buffer.from(base, 'base64');
  if (llave.length !== 32) throw new Error('La llave maestra del RNDC debe ser de 32 bytes en base64 (openssl rand -base64 32)');
  maestraCache = llave;
  return llave;
}
// Identificador de la llave maestra (no revela la llave): detecta si se cambió sin volver a cifrar
const idLlave = (m) => crypto.createHash('sha256').update(m).update('tls-rndc-kid').digest('hex').slice(0, 16);
export const disponible = () => { try { return !!llaveMaestra(); } catch { return false; } };

function llaveDerivada(maestra, sal, empresaId) {
  return Buffer.from(crypto.hkdfSync('sha512', maestra, sal, `tls-rndc-clave|v${VERSION}|${empresaId}`, 32));
}
const aad = (empresaId, usuarioRndc) => Buffer.from(`${empresaId}|${String(usuarioRndc || '').trim().toUpperCase()}|v${VERSION}`, 'utf8');

export function cifrarClave(empresaId, usuarioRndc, clave) {
  const maestra = llaveMaestra();
  if (!maestra) throw new ErrorHttp(503, 'El servidor no tiene configurada la llave para guardar la contraseña del RNDC');
  const sal = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
  const llave = llaveDerivada(maestra, sal, empresaId);
  try {
    const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
    c.setAAD(aad(empresaId, usuarioRndc));
    const datos = Buffer.concat([c.update(Buffer.from(String(clave), 'utf8')), c.final()]);
    return { version: VERSION, kid: idLlave(maestra), sal: sal.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), datos: datos.toString('base64') };
  } finally { llave.fill(0); }
}

function descifrarClave(empresaId, usuarioRndc, s) {
  const maestra = llaveMaestra();
  if (!maestra) throw new ErrorHttp(503, 'El servidor no tiene configurada la llave de la contraseña del RNDC: escríbala a mano');
  if (s.kid !== idLlave(maestra)) throw new ErrorHttp(409, 'La contraseña del RNDC se guardó con otra llave del servidor: guárdela de nuevo');
  const llave = llaveDerivada(maestra, Buffer.from(s.sal, 'base64'), empresaId);
  let plano = null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', llave, Buffer.from(s.iv, 'base64'));
    d.setAAD(aad(empresaId, usuarioRndc));
    d.setAuthTag(Buffer.from(s.tag, 'base64'));
    plano = Buffer.concat([d.update(Buffer.from(s.datos, 'base64')), d.final()]);
    return plano.toString('utf8');
  } catch {
    throw new ErrorHttp(409, 'La contraseña del RNDC guardada no corresponde a este usuario del RNDC: guárdela de nuevo');
  } finally { llave.fill(0); plano?.fill(0); }
}

// Estado visible (nunca la contraseña)
export async function estado(empresaId) {
  const s = await SecretoRndc.findOne({ empresa: empresaId }).select('usuarioRndc guardadaEn guardadaPor guardadaPorNombre invalida invalidaEn usos ultimoUso').lean();
  return {
    disponible: disponible(), guardada: !!s && !s.invalida, invalida: !!s?.invalida, invalidaEn: s?.invalidaEn || null,
    usuarioRndc: s?.usuarioRndc || '', guardadaEn: s?.guardadaEn || null, guardadaPor: s?.guardadaPorNombre || '', usos: s?.usos || 0, ultimoUso: s?.ultimoUso || null,
  };
}

export async function guardar(empresaId, usuarioRndc, clave, usuario) {
  const cifrado = cifrarClave(empresaId, usuarioRndc, clave);
  await SecretoRndc.updateOne({ empresa: empresaId }, { $set: { ...cifrado, usuarioRndc: String(usuarioRndc || '').trim(), guardadaEn: new Date(),
    guardadaPor: usuario._id, guardadaPorNombre: usuario.nombre, invalida: false, invalidaEn: null, usos: 0, ultimoUso: null } }, { upsert: true });
}

export const quitar = (empresaId) => SecretoRndc.deleteOne({ empresa: empresaId });

// Para un envío: la contraseña en claro, solo en memoria
export async function usar(empresaId, usuarioRndc) {
  const s = await SecretoRndc.findOne({ empresa: empresaId }).select('+version +kid +sal +iv +tag +datos usuarioRndc invalida').lean();
  if (!s) throw new ErrorHttp(400, 'No hay contraseña del RNDC guardada: escríbala');
  if (s.invalida) throw new ErrorHttp(400, 'El RNDC rechazó la contraseña guardada: escríbala de nuevo o guarde la nueva en Configuración');
  if (String(s.usuarioRndc).trim().toUpperCase() !== String(usuarioRndc || '').trim().toUpperCase()) {
    throw new ErrorHttp(409, 'Cambió el usuario del RNDC: guarde de nuevo la contraseña en Configuración');
  }
  const clave = descifrarClave(empresaId, usuarioRndc, s);
  await SecretoRndc.updateOne({ empresa: empresaId }, { $inc: { usos: 1 }, $set: { ultimoUso: new Date() } });
  return clave;
}

export const invalidar = (empresaId) => SecretoRndc.updateOne({ empresa: empresaId, invalida: false }, { $set: { invalida: true, invalidaEn: new Date() } });
