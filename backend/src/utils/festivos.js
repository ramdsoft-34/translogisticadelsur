// Festivos de Colombia (Ley 51 de 1983, «Ley Emiliani»): fijos, trasladables al lunes siguiente
// y los que dependen de la Pascua. Se usan en el registro masivo (días laborales).
const d = (y, m, dia) => new Date(Date.UTC(y, m - 1, dia));
const sumar = (f, n) => new Date(f.getTime() + n * 86400000);
const lunesSiguiente = (f) => { const w = f.getUTCDay(); return w === 1 ? f : sumar(f, (8 - w) % 7); };

function pascua(y) {                                    // algoritmo de Butcher (domingo de Pascua)
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100; const e = Math.floor(b / 4); const f = b % 4;
  const g = Math.floor((b + 8) / 25); const h = Math.floor((b - g + 1) / 3); const i = (19 * a + b - e - h + 15) % 30;
  const k = Math.floor(c / 4); const l = c % 4; const m = (32 + 2 * f + 2 * k - i - l) % 7; const n = Math.floor((a + 11 * i + 22 * m) / 451);
  const mes = Math.floor((i + m - 7 * n + 114) / 31); const dia = ((i + m - 7 * n + 114) % 31) + 1;
  return d(y, mes, dia);
}

const cache = new Map();
export function festivosDe(y) {
  if (cache.has(y)) return cache.get(y);
  const p = pascua(y);
  const lista = [
    [d(y, 1, 1), 'Año Nuevo'], [lunesSiguiente(d(y, 1, 6)), 'Reyes Magos'], [lunesSiguiente(d(y, 3, 19)), 'San José'],
    [sumar(p, -3), 'Jueves Santo'], [sumar(p, -2), 'Viernes Santo'], [d(y, 5, 1), 'Día del Trabajo'],
    [lunesSiguiente(sumar(p, 39)), 'Ascensión del Señor'], [lunesSiguiente(sumar(p, 60)), 'Corpus Christi'],
    [lunesSiguiente(sumar(p, 68)), 'Sagrado Corazón'], [lunesSiguiente(d(y, 6, 29)), 'San Pedro y San Pablo'],
    [d(y, 7, 20), 'Independencia'], [d(y, 8, 7), 'Batalla de Boyacá'], [lunesSiguiente(d(y, 8, 15)), 'Asunción de la Virgen'],
    [lunesSiguiente(d(y, 10, 12)), 'Día de la Raza'], [lunesSiguiente(d(y, 11, 1)), 'Todos los Santos'],
    [lunesSiguiente(d(y, 11, 11)), 'Independencia de Cartagena'], [d(y, 12, 8), 'Inmaculada Concepción'], [d(y, 12, 25), 'Navidad'],
  ];
  const m = new Map(lista.map(([f, n]) => [f.toISOString().slice(0, 10), n]));
  cache.set(y, m);
  return m;
}
export const festivo = (fecha) => festivosDe(fecha.getUTCFullYear()).get(fecha.toISOString().slice(0, 10)) || '';
