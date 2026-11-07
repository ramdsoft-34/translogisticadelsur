// PDF permanentes: se genera una sola vez por (tipo, registro, clave), se guarda y desde ahí se sirve.
//  - Si ya existe: se lee el archivo guardado y se comprueba su huella (no se vuelve a generar).
//  - Si no existe: se genera, se escribe sin poder sobrescribir nada (flag «wx») y se registra con la versión siguiente.
//  - Un cambio permitido usa otra clave (p. ej. «MC100:cumplido») y queda como versión nueva; la anterior se conserva.
//  - Los borradores y los informes NO pasan por aquí: se generan cada vez.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DocumentoPdf } from '../../models/documentos.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { carpetaBase } from './carpeta.js';

const limpio = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]/g, '_').slice(0, 60) || 'doc';
const huella = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const ruta = (empresaId, relativo) => path.join(carpetaBase(), String(empresaId), relativo);

async function leer(doc) {
  let buf;
  try { buf = await fs.promises.readFile(ruta(doc.empresa, doc.archivo)); } catch {
    throw new ErrorHttp(500, `No se encontró el archivo guardado de ${doc.nombre || doc.tipo} (versión ${doc.version}). Avise al administrador.`);
  }
  if (huella(buf) !== doc.sha256) {
    console.error(`[documentos] La huella no coincide: ${doc.tipo} ${doc.ref} v${doc.version} (${doc.archivo})`);
    throw new ErrorHttp(500, `El archivo guardado de ${doc.nombre || doc.tipo} no coincide con su huella: no se entrega. Avise al administrador.`);
  }
  return buf;
}

const respuesta = (doc, buffer, nuevo) => ({ buffer, nuevo, version: doc.version, creado: doc.creado, nombre: doc.nombre, clave: doc.clave });

/**
 * Devuelve el PDF permanente de (tipo, ref, clave); lo genera y guarda solo la primera vez.
 * @param generar función async que devuelve el Buffer del PDF (solo se llama si no está guardado)
 */
export async function pdfGuardado(empresaId, { tipo, ref, clave, nombre = '', generar, usuario = null, formato = 'pdf' }) {
  if (!tipo || !ref || !clave || typeof generar !== 'function') throw new Error('pdfGuardado: faltan datos');
  const filtro = { empresa: empresaId, tipo, ref: String(ref), clave: String(clave) };
  const existente = await DocumentoPdf.findOne(filtro).lean();
  if (existente) return respuesta(existente, await leer(existente), false);

  const buffer = await generar();
  // También guarda Excel (las relaciones de cobro van en PDF y Excel): se comprueba la cabecera de cada formato
  const cabecera = formato === 'xlsx' ? 'PK' : '%PDF';
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, cabecera.length).toString() !== cabecera) throw new Error(`pdfGuardado: ${tipo} no generó un ${formato.toUpperCase()}`);
  const sha256 = huella(buffer);
  for (let intento = 0; intento < 3; intento++) {
    const ultima = await DocumentoPdf.findOne({ empresa: empresaId, tipo, ref: String(ref) }).sort({ version: -1 }).select('version').lean();
    const version = (ultima?.version || 0) + 1;
    const relativo = path.join('documentos', limpio(tipo), limpio(ref), `v${version}-${sha256.slice(0, 12)}.${formato === 'xlsx' ? 'xlsx' : 'pdf'}`);
    const destino = ruta(empresaId, relativo);
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    try { await fs.promises.writeFile(destino, buffer, { flag: 'wx' }); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Otro proceso escribió esa versión al mismo tiempo: se busca lo que quedó registrado
      const ya = await DocumentoPdf.findOne(filtro).lean();
      if (ya) return respuesta(ya, await leer(ya), false);
      continue;
    }
    try {
      const doc = await DocumentoPdf.create({ ...filtro, version, nombre, archivo: relativo.split(path.sep).join('/'), sha256, tamano: buffer.length, creadoPor: usuario });
      return respuesta(doc.toObject(), buffer, true);
    } catch (e) {
      if (e.code !== 11000) throw e;
      // Carrera: otro pedido registró el mismo documento (o la misma versión). Se quita SOLO el archivo que este pedido
      // acaba de escribir y que no quedó registrado; nunca un archivo registrado.
      await fs.promises.unlink(destino).catch(() => {});
      const ya = await DocumentoPdf.findOne(filtro).lean();
      if (ya) return respuesta(ya, await leer(ya), false);
    }
  }
  throw new ErrorHttp(503, 'No se pudo guardar el documento. Intente de nuevo.');
}

// Último PDF guardado de un registro (para ver o reenviar lo que ya se expidió) o null si no hay ninguno
export async function ultimoGuardado(empresaId, tipo, ref) {
  const doc = await DocumentoPdf.findOne({ empresa: empresaId, tipo, ref: String(ref) }).sort({ version: -1 }).lean();
  return doc ? respuesta(doc, await leer(doc), false) : null;
}

// Versiones guardadas de un registro (sin el contenido)
export const versiones = (empresaId, tipo, ref) =>
  DocumentoPdf.find({ empresa: empresaId, tipo, ref: String(ref) }).sort({ version: 1 }).select('version clave nombre creado tamano sha256').lean();

// Una versión concreta
export async function versionGuardada(empresaId, tipo, ref, version) {
  const doc = await DocumentoPdf.findOne({ empresa: empresaId, tipo, ref: String(ref), version: Number(version) }).lean();
  if (!doc) throw new ErrorHttp(404, 'Esa versión no existe');
  return respuesta(doc, await leer(doc), false);
}

// Cabeceras para que la pantalla muestre «Documento guardado el … · versión N»
export function cabecerasDocumento(res, d) {
  if (!d) return;
  res.setHeader('X-Documento-Version', String(d.version));
  res.setHeader('X-Documento-Guardado', new Date(d.creado).toISOString());
  res.setHeader('Access-Control-Expose-Headers', 'X-Documento-Version, X-Documento-Guardado, Content-Disposition');
}
