// Utilidades de texto, números y fechas (zona horaria de Colombia).

export const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
export const soloDigitos = (s) => String(s ?? '').replace(/[^0-9]/g, '');

export function quitarTildes(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Mayúsculas sin tildes y solo letras/dígitos/espacios simples (para buscar).
export function normalizar(s) {
  return quitarTildes(s).toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function nombrePropio(s) {
  return txt(s).toLowerCase().split(/\s+/).filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Fechas: se guardan como medianoche UTC del día en Colombia (UTC-5) ──────
const OFFSET_CO = -5 * 60 * 60 * 1000;
export const enColombia = (d = new Date()) => new Date(new Date(d).getTime() + OFFSET_CO);

export function hoyColombia() {
  const c = enColombia();
  return new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
}

// 'yyyy-mm-dd', 'dd/mm/yyyy' o Date → medianoche UTC. null si no es válida.
export function parseFecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return fechaValida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return fechaValida(+m[3], +m[2], +m[1]);
  return null;
}
function fechaValida(y, mo, d) {
  const f = new Date(Date.UTC(y, mo - 1, d));
  return (f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d) ? f : null;
}

const dd = (n) => String(n).padStart(2, '0');
export function fmtFecha(d) {            // dd/mm/yyyy (formato que exige el RNDC)
  if (!d) return '';
  const f = new Date(d);
  return `${dd(f.getUTCDate())}/${dd(f.getUTCMonth() + 1)}/${f.getUTCFullYear()}`;
}
export function fmtFechaIso(d) {         // yyyy-mm-dd
  if (!d) return '';
  const f = new Date(d);
  return `${f.getUTCFullYear()}-${dd(f.getUTCMonth() + 1)}-${dd(f.getUTCDate())}`;
}
export function fmtFechaHora(d = new Date()) {   // dd/mm/yyyy hh:mm (hora Colombia)
  const c = enColombia(d);
  return `${dd(c.getUTCDate())}/${dd(c.getUTCMonth() + 1)}/${c.getUTCFullYear()} ${dd(c.getUTCHours())}:${dd(c.getUTCMinutes())}`;
}
export function finDeMes(d) {
  const f = new Date(d);
  return new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0));
}
export function sumarDias(d, n) {
  return new Date(new Date(d).getTime() + n * 86400000);
}

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function fechaLarga(d) {
  const f = new Date(d);
  return `${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
}

// ── Números ─────────────────────────────────────────────────────────────────
export const fmtMiles = (n) => Math.round(Number(n) || 0).toLocaleString('es-CO');
export const fmtPesos = (n) => `$ ${fmtMiles(n)}`;

// 1750000 → "1,750,000.00" (formato del manifiesto oficial)
export function fmtMilManifiesto(x) {
  const neg = x < 0;
  const v = Math.abs(Math.round((Number(x) || 0) * 100) / 100);
  const ent = Math.trunc(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = String(Math.round((v - Math.trunc(v)) * 100)).padStart(2, '0');
  return `${neg ? '-' : ''}${ent}.${dec}`;
}

function centenas(n) {
  const u = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
    'VEINTE', 'VEINTIUN', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISEIS',
    'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const d = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const c = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
    'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  if (n === 100) return 'CIEN';
  let r = '';
  const k = Math.floor(n / 100);
  if (k > 0) r = c[k];
  n %= 100;
  if (n > 0) {
    if (r) r += ' ';
    if (n < 30) r += u[n];
    else {
      r += d[Math.floor(n / 10)];
      if (n % 10 > 0) r += ` Y ${u[n % 10]}`;
    }
  }
  return r;
}

// Valor en letras: 1750000 → "UN MILLON SETECIENTOS CINCUENTA MIL PESOS"
export function numeroALetras(valor) {
  let n = Math.trunc(Number(valor) || 0);
  const orig = n;
  if (n <= 0) return 'CERO PESOS';
  let r = '';
  if (n >= 1000000) {
    const m = Math.trunc(n / 1000000);
    r = m === 1 ? 'UN MILLON' : `${centenas(m)} MILLONES`;
    n -= m * 1000000;
    if (n > 0) r += ' ';
  }
  if (n >= 1000) {
    const m = Math.trunc(n / 1000);
    r += m === 1 ? 'MIL' : `${centenas(m)} MIL`;
    n -= m * 1000;
    if (n > 0) r += ' ';
  }
  if (n > 0) r += centenas(n);
  if (orig >= 1000000 && orig % 1000000 === 0) r += ' DE';
  return `${r} PESOS`;
}
