// Word y Excel propios de SG-SST. Se guardan tal cual (carpeta privada de la empresa) y al descargarlos
// se llenan las variables {{empresa.nombre}}, {{sst.responsable}}… y las imágenes {{empresa.logo}},
// {{membrete.encabezado}} y {{membrete.pie}} (Word: imagen en línea; Excel: imagen sobre la celda).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import { SstArchivo } from '../../models/sst.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { rutaSegura } from '../gestion/archivo.js';

export const MAX_ARCHIVO = 10 * 1024 * 1024;
const IMAGENES = ['empresa.logo', 'membrete.encabezado', 'membrete.pie'];

/** Revisa que de verdad sea un .docx o .xlsx (un ZIP con su contenido típico). */
export async function tipoDe(datos) {
  if (datos.subarray(0, 2).toString('ascii') !== 'PK') throw new ErrorHttp(415, 'Suba un archivo de Word (.docx) o Excel (.xlsx)');
  let zip;
  try { zip = await JSZip.loadAsync(datos); } catch { throw new ErrorHttp(415, 'El archivo está dañado'); }
  if (zip.file('word/document.xml')) return 'docx';
  if (zip.file('xl/workbook.xml')) return 'xlsx';
  throw new ErrorHttp(415, 'Suba un archivo de Word (.docx) o Excel (.xlsx). Los .doc y .xls antiguos no se admiten: guárdelos en el formato nuevo.');
}

export async function listar(empresaId) {
  return (await SstArchivo.find({ empresa: empresaId }).sort({ createdAt: -1 }).lean())
    .map((a) => ({ id: String(a._id), nombre: a.nombre, descripcion: a.descripcion, tipo: a.tipo, tamano: a.tamano, subidoPor: a.subidoPorNombre, fecha: a.createdAt }));
}

export async function subir(empresaId, { nombre, descripcion, datos }, usuario) {
  if (!datos?.length) throw new ErrorHttp(400, 'Adjunte el archivo');
  if (datos.length > MAX_ARCHIVO) throw new ErrorHttp(413, 'El archivo pesa más de 10 MB');
  const tipo = await tipoDe(datos);
  const relativo = path.posix.join('sst', `${crypto.randomUUID()}.${tipo}`);
  const destino = rutaSegura(empresaId, relativo);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  await fs.promises.writeFile(destino, datos, { flag: 'wx' });
  const limpio = String(nombre || `documento.${tipo}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  const a = await SstArchivo.create({ empresa: empresaId, nombre: limpio.toLowerCase().endsWith(`.${tipo}`) ? limpio : `${limpio}.${tipo}`, descripcion, tipo,
    tamano: datos.length, archivo: relativo, subidoPor: usuario._id, subidoPorNombre: usuario.nombre || usuario.email });
  return { id: String(a._id), nombre: a.nombre, tipo };
}

async function cargar(empresaId, id) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(400, 'Identificador inválido');
  const a = await SstArchivo.findOne({ empresa: empresaId, _id: id }).lean();
  if (!a) throw new ErrorHttp(404, 'Archivo no encontrado');
  return a;
}

export async function eliminar(empresaId, id) {
  const a = await cargar(empresaId, id);
  await SstArchivo.deleteOne({ empresa: empresaId, _id: a._id });
  await fs.promises.rm(rutaSegura(empresaId, a.archivo), { force: true });
  return a;
}

const escaparXml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// {{ clave }} aunque Word lo haya partido en varios fragmentos con etiquetas en medio
const MARCA = /\{(?:<[^>]+>)*\{((?:<[^>]+>|[^{}])*?)\}(?:<[^>]+>)*\}/g;
const claveDe = (crudo) => crudo.replace(/<[^>]+>/g, '').trim();

function imagenDe(dataUrl) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(String(dataUrl || ''));
  return m ? { ext: m[1] === 'png' ? 'png' : 'jpeg', datos: Buffer.from(m[2], 'base64') } : null;
}

// Tamaño en EMU (Word) conservando la proporción. Ancho máximo: 6 cm el logo, 16 cm las franjas.
function tamanoImagen(datos, anchoCm) {
  let w = 300; let h = 100;
  if (datos[0] === 0x89) { w = datos.readUInt32BE(16); h = datos.readUInt32BE(20); } else {
    for (let i = 2; i < datos.length - 9;) {
      if (datos[i] !== 0xff) break;
      const marca = datos[i + 1]; const largo = datos.readUInt16BE(i + 2);
      if (marca >= 0xc0 && marca <= 0xc3) { h = datos.readUInt16BE(i + 5); w = datos.readUInt16BE(i + 7); break; }
      i += 2 + largo;
    }
  }
  const cx = Math.round(anchoCm * 360000); const cy = Math.round((cx * h) / Math.max(w, 1));
  return { cx, cy };
}

function dibujo(rid, id, nombre, { cx, cy }) {
  return '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${nombre}"/>`
    + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
}

/** Word: reemplaza variables en el cuerpo, encabezados y pies; las imágenes van en línea donde esté su marca. */
export async function llenarDocx(datos, vars, imagenes) {
  const zip = await JSZip.loadAsync(datos);
  const partes = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  let idImg = 9000;
  if (!zip.file('[Content_Types].xml')) throw new ErrorHttp(415, 'El archivo está dañado');
  let tipos = await zip.file('[Content_Types].xml').async('string');
  for (const ext of ['png', 'jpeg']) if (!tipos.includes(`Extension="${ext}"`)) tipos = tipos.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext}"/></Types>`);
  zip.file('[Content_Types].xml', tipos);
  for (const parte of partes) {
    let xml = await zip.file(parte).async('string');
    const relsRuta = parte.replace(/^word\//, 'word/_rels/') + '.rels';
    let rels = zip.file(relsRuta) ? await zip.file(relsRuta).async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    let usoRels = false;
    xml = xml.replace(MARCA, (todo, crudo) => {
      const clave = claveDe(crudo);
      if (IMAGENES.includes(clave)) {
        const img = imagenes[clave];
        if (!img) return '';
        idImg += 1;
        const nombre = `sst_${clave.replace('.', '_')}_${idImg}.${img.ext === 'png' ? 'png' : 'jpeg'}`;
        zip.file(`word/media/${nombre}`, img.datos);
        const rid = `rIdSst${idImg}`;
        rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombre}"/></Relationships>`);
        usoRels = true;
        // La marca queda dentro de un <w:t>: se cierra el texto, se pone la imagen y se vuelve a abrir
        return `</w:t></w:r><w:r>${dibujo(rid, idImg, nombre, tamanoImagen(img.datos, clave === 'empresa.logo' ? 6 : 16))}</w:r><w:r><w:t xml:space="preserve">`;
      }
      return clave in vars ? escaparXml(vars[clave]) : todo;
    });
    zip.file(parte, xml);
    if (usoRels) zip.file(relsRuta, rels);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Excel: reemplaza variables en todas las celdas de texto; las imágenes se ponen sobre la celda de su marca. */
export async function llenarXlsx(datos, vars, imagenes) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(datos);
  const ids = {};
  for (const [clave, img] of Object.entries(imagenes)) if (img) ids[clave] = wb.addImage({ buffer: img.datos, extension: img.ext });
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (fila) => {
      fila.eachCell({ includeEmpty: false }, (celda) => {
        if (typeof celda.value !== 'string') return;
        const solo = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/.exec(celda.value);
        if (solo && IMAGENES.includes(solo[1])) {
          celda.value = '';
          if (ids[solo[1]] !== undefined) {
            const ancho = solo[1] === 'empresa.logo' ? 160 : 520;
            ws.addImage(ids[solo[1]], { tl: { col: Number(celda.col) - 1, row: Number(celda.row) - 1 }, ext: { width: ancho, height: solo[1] === 'empresa.logo' ? 60 : 70 }, editAs: 'oneCell' });
          }
          return;
        }
        celda.value = celda.value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (todo, k) => (k in vars ? String(vars[k]) : todo));
      });
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function descargar(empresaId, id, vars, d) {
  const a = await cargar(empresaId, id);
  const datos = await fs.promises.readFile(rutaSegura(empresaId, a.archivo));
  const imagenes = { 'empresa.logo': imagenDe(d.empresa.logo), 'membrete.encabezado': imagenDe(d.membrete.encabezado), 'membrete.pie': imagenDe(d.membrete.pie) };
  const salida = a.tipo === 'docx' ? await llenarDocx(datos, vars, imagenes) : await llenarXlsx(datos, vars, imagenes);
  return { nombre: a.nombre, tipo: a.tipo, datos: salida };
}
