// Nombres de lugares como los escribe el RNDC: "CENTRO POBLADO MUNICIPIO DEPARTAMENTO" en mayúsculas
// sin tildes (ej. CUJACAL PASTO NARINO). El catálogo guarda los centros poblados como "NOMBRE (MUNICIPIO)".
import { quitarTildes, txt } from './texto.js';

// Municipios y departamentos cuyo nombre en el RNDC difiere del catálogo DIVIPOLA vigente
const MUNICIPIO_RNDC = { 11001: 'BOGOTA', 52835: 'TUMACO', 86573: 'LEGUIZAMO' };
const DEPARTAMENTO_RNDC = { 11: 'BOGOTA D. C.' };

export function lugarRndc(m) {
  if (!m) return '';
  const p = txt(m.nombre).match(/^(.*?)\s*\((.+)\)$/);
  const centro = p ? p[1] : '';
  const municipio = MUNICIPIO_RNDC[m.codigo.slice(0, 5)] || (p ? p[2] : m.nombre);
  const depto = DEPARTAMENTO_RNDC[m.codigo.slice(0, 2)] || m.departamento;
  return quitarTildes([centro, municipio, depto].join(' ')).toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}
