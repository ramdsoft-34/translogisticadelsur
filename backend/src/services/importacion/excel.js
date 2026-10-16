// Lectura segura de archivos Excel subidos por los usuarios.
// - Solo .xlsx / .xlsm (ZIP de Office Open XML); no se ejecutan macros.
// - Límite de tamaño y de filas para evitar abusos.
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar } from '../../utils/texto.js';

export const MAX_BYTES = 15 * 1024 * 1024;
export const MAX_FILAS = 10000;

export async function leerLibro(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ErrorHttp(400, 'No se recibió ningún archivo');
  if (buffer.length > MAX_BYTES) throw new ErrorHttp(413, 'El archivo supera 15 MB');
  if (buffer.subarray(0, 4).toString('binary') !== 'PK\x03\x04') throw new ErrorHttp(400, 'El archivo no es un Excel válido (.xlsx o .xlsm)');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new ErrorHttp(400, 'No se pudo leer el archivo de Excel');
  }
  return wb;
}

export const huellaArchivo = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// Valor plano de una celda: resultado de fórmulas, texto enriquecido, hipervínculos y fechas.
export function valorCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return valorCelda(v.result);
    if (v.richText) return v.richText.map(t => t.text).join('');
    if ('text' in v) return valorCelda(v.text);
    if (v.error) return null;
    return null;
  }
  return v;
}

// Filas de una hoja como arreglos (índice 0 = columna A).
export function filas(ws) {
  if (!ws) return [];
  const out = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > MAX_FILAS + 20) return;
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    out[n - 1] = vals.map(valorCelda);
  });
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
  return out;
}

export const txt = (v) => (v === null || v === undefined ? '' : (v instanceof Date ? v.toISOString() : String(v).trim()));
export const entero = (v) => (typeof v === 'number' ? String(Math.round(v)) : txt(v).replace(/\.0+$/, ''));
export const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = txt(v).replace(/[$\s]/g, '');
  if (!s) return null;
  const limpio = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
};

// Fecha de una celda: Date, serial de Excel o texto dd/mm/aaaa, aaaa/mm/dd, aaaa-mm-dd.
export function fecha(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  const s = txt(v);
  let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return valida(+m[3], +m[2], +m[1]);
  return null;
}
function valida(y, mo, d) {
  const f = new Date(Date.UTC(y, mo - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d ? f : null;
}

// "Aceptado 10/10/2026 13:14" o "Reportado 01/10/2026 08:01" → instante (hora de Colombia).
export function fechaHoraTexto(s) {
  const m = txt(s).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] + 5, +m[5])) : null;
}

// Índice de columnas por título normalizado (sin tildes, sin «*», en mayúsculas).
export function indiceEncabezados(fila) {
  const idx = new Map();
  (fila || []).forEach((v, i) => { const k = normalizar(txt(v).replace(/\*/g, '')); if (k && !idx.has(k)) idx.set(k, i); });
  return idx;
}

// Divide un nombre completo en nombres y apellidos.
// Las partículas (DE, DEL, LA…) se unen a la palabra siguiente. Con 3 palabras se
// asume 1 nombre y 2 apellidos; es una aproximación que el usuario debe revisar
// (o traer el tercero desde el RNDC) antes de reenviarlo al Ministerio.
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'Y', 'VDA', 'VIUDA']);
export function partirNombre(completo) {
  const palabras = txt(completo).replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const grupos = [];
  let pendiente = '';
  for (const p of palabras) {
    if (PARTICULAS.has(normalizar(p))) { pendiente = pendiente ? `${pendiente} ${p}` : p; continue; }
    grupos.push(pendiente ? `${pendiente} ${p}` : p);
    pendiente = '';
  }
  if (pendiente) grupos.push(pendiente);
  if (grupos.length >= 4) return { nombres: grupos.slice(0, 2).join(' '), apellido1: grupos[2], apellido2: grupos.slice(3).join(' ') };
  if (grupos.length === 3) return { nombres: grupos[0], apellido1: grupos[1], apellido2: grupos[2] };
  if (grupos.length === 2) return { nombres: grupos[0], apellido1: grupos[1], apellido2: '' };
  return { nombres: grupos[0] || '', apellido1: '', apellido2: '' };
}

// Buscador de municipios DIVIPOLA por texto ("PASTO NARIÑO", "EL ESPINO SAPUYES NARINO").
export function buscadorMunicipios(municipios) {
  const exacto = new Map();
  const porNombre = new Map();
  for (const m of municipios) {
    exacto.set(normalizar(`${m.nombre} ${m.departamento}`), m.codigo);
    const n = normalizar(m.nombre);
    if (!porNombre.has(n)) porNombre.set(n, []);
    porNombre.get(n).push(m);
  }
  return (texto, departamento = '') => {
    const t = normalizar(`${texto} ${departamento}`);
    if (!t) return '';
    if (/^\d{8}$/.test(t)) return t;
    if (exacto.has(t)) return exacto.get(t);
    // El texto termina en "MUNICIPIO DEPARTAMENTO" (p. ej. vereda + municipio + depto)
    let mejor = '';
    let largo = 0;
    for (const [k, cod] of exacto) {
      if ((t.endsWith(` ${k}`) || t === k) && k.length > largo) { mejor = cod; largo = k.length; }
    }
    if (mejor) return mejor;
    const lista = porNombre.get(normalizar(texto));
    return lista?.length === 1 ? lista[0].codigo : '';
  };
}

// Completa solo los campos vacíos de un documento existente (no sobrescribe datos).
export function camposFaltantes(existente, nuevo, prefijo = '') {
  const set = {};
  for (const [k, v] of Object.entries(nuevo)) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    const actual = existente?.[k];
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      Object.assign(set, camposFaltantes(actual || {}, v, ruta));
    } else if (Array.isArray(v)) {
      const faltan = v.filter(x => !(actual || []).includes(x));
      if (faltan.length) set[ruta] = [...(actual || []), ...faltan];
    } else if (v !== null && v !== undefined && v !== '' && (actual === null || actual === undefined || actual === '')) {
      set[ruta] = v;
    }
  }
  return set;
}
