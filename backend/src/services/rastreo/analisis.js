// Análisis del recorrido para mostrarlo como lo que hizo el VEHÍCULO, no el celular:
//  · Parada: varios minutos en un área pequeña yendo y viniendo (el conductor a pie dentro de un local, con el GPS saltando
//    bajo techo). Esas vueltas se cambian por un solo punto «Parada · N min» y no suman kilómetros.
//  · Tráfico lento: avanza por la vía, en una dirección, pero muy despacio durante varios minutos (un trancón).
//    Se conserva todo el trazado y los kilómetros; solo se marca para que la oficina vea por qué se demoró.
// Los puntos originales no se borran: esto se calcula al mostrar el recorrido.

const R = 6371000;
const rad = (x) => (x * Math.PI) / 180;
export function metros(a, b) {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const t = (p) => new Date(p.hora).getTime();

export const REGLAS = {
  radioParada: 100,        // m: todo dentro de este radio
  minutosParada: 2,        // al menos este tiempo
  caminoMinParada: 40,     // m: deambuló al menos esto…
  zigzag: 2.5,             // …y 2,5 veces o más lo que avanzó (va y vuelve)
  quietoCliente: 30,       // m: o quieto (todo en 30 m) junto a un cliente
  kmhLento: 12,            // tráfico lento: por debajo de esta velocidad media…
  minutosLento: 5,         // …durante al menos este tiempo
  metrosLento: 100,        // …avanzando al menos esto (si no avanza, es una parada)
  radioCliente: 150,       // m: la parada se asocia al cliente entregado más cercano
};

function largo(pts, i, j) { let s = 0; for (let k = i + 1; k <= j; k++) if (!pts[k].nuevoSegmento) s += metros(pts[k - 1], pts[k]); return s; }
function mediana(xs) { const o = [...xs].sort((a, b) => a - b); return o[Math.floor(o.length / 2)]; }

/**
 * ¿Los puntos i..j son una parada? Sí si va y viene de verdad (a pie, con el GPS saltando: 40 m o más de vueltas y 2,5 veces
 * lo que avanzó) o si está quieto junto a un cliente. Un carro quieto en un trancón no deambula: el GPS apenas se mueve,
 * así que no cuenta como parada y su trazado se conserva.
 */
function deambula(pts, i, j, r) {
  if ((t(pts[j]) - t(pts[i])) / 60000 < r.minutosParada) return false;
  const camino = largo(pts, i, j);
  return camino >= r.caminoMinParada && camino >= r.zigzag * Math.max(metros(pts[i], pts[j]), 1);
}
const junto = (p, clientes, r) => clientes.some((c) => c?.entrega?.lat != null && metros(p, c.entrega) <= r.radioCliente);

/** Última posición de la ventana que empieza en i, con todo dentro de [radio] metros del punto de llegada. */
function ventana(pts, i, radio) { let j = i; while (j + 1 < pts.length && metros(pts[i], pts[j + 1]) <= radio) j++; return j; }

/**
 * @param puntos [{lat, lng, velocidad (km/h), hora, nuevoSegmento?}] en orden
 * @param clientes [{nombre, entrega: {lat, lng}}] para nombrar las paradas
 * @returns {{ puntos, paradas, lentos, km }}
 */
export function analizarRecorrido(puntos, { clientes = [], reglas = {} } = {}) {
  const r = { ...REGLAS, ...reglas };
  const pts = (puntos || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.hora).sort((a, b) => t(a) - t(b));
  const limpios = []; const paradas = [];
  let i = 0;
  while (i < pts.length) {
    // Parada: deambula en un área de 100 m, o está quieto (30 m) junto a un cliente por más de 2 minutos
    let j = ventana(pts, i, r.radioParada);
    let parada = j > i && deambula(pts, i, j, r);
    if (!parada) {
      const q = ventana(pts, i, r.quietoCliente);
      if (q > i && (t(pts[q]) - t(pts[i])) / 60000 >= r.minutosParada && junto(pts[i], clientes, r)) { j = q; parada = true; }
    }
    if (parada) {
      const lat = mediana(pts.slice(i, j + 1).map((p) => p.lat)); const lng = mediana(pts.slice(i, j + 1).map((p) => p.lng));
      const desde = pts[i].hora; const hasta = pts[j].hora;
      const minutos = Math.round((t(pts[j]) - t(pts[i])) / 60000);
      const cerca = clientes.map((c) => ({ c, d: c?.entrega?.lat != null ? metros({ lat, lng }, c.entrega) : Infinity }))
        .filter((x) => x.d <= r.radioCliente).sort((a, b) => a.d - b.d)[0];
      const previa = paradas[paradas.length - 1]; const ultimo = limpios[limpios.length - 1];
      // Seguida de otra parada en el mismo sitio (el GPS se fue un momento más lejos): es la misma parada
      if (previa && ultimo?.parada === paradas.length - 1 && (t(pts[i]) - new Date(previa.hasta).getTime()) <= 3 * 60000
        && metros(previa, { lat, lng }) <= r.radioParada) {
        previa.hasta = hasta; previa.minutos = Math.round((t(pts[j]) - new Date(previa.desde).getTime()) / 60000);
        if (!previa.cliente) previa.cliente = cerca?.c?.nombre || '';
        ultimo.hora = hasta;
      } else {
        paradas.push({ lat, lng, desde, hasta, minutos, cliente: cerca?.c?.nombre || '' });
        limpios.push({ lat, lng, velocidad: 0, hora: desde, nuevoSegmento: !!pts[i].nuevoSegmento, parada: paradas.length - 1 });
        if (j > i) limpios.push({ lat, lng, velocidad: 0, hora: hasta, parada: paradas.length - 1 });
      }
      i = j + 1;
    } else {
      limpios.push({ ...pts[i] });
      i++;
    }
  }

  // Tráfico lento: tramos seguidos (sin paradas) con velocidad media baja durante varios minutos
  const lentos = [];
  let a = null;
  const cerrar = (b) => {
    if (a === null || b <= a) { a = null; return; }
    const minutos = (t(limpios[b]) - t(limpios[a])) / 60000;
    const m = largo(limpios, a, b);
    if (minutos >= r.minutosLento && m >= r.metrosLento) {
      for (let k = a + 1; k <= b; k++) limpios[k].lento = true;
      lentos.push({ desde: limpios[a].hora, hasta: limpios[b].hora, minutos: Math.round(minutos), km: Math.round(m / 100) / 10 });
    }
    a = null;
  };
  for (let k = 1; k < limpios.length; k++) {
    const p = limpios[k]; const q = limpios[k - 1];
    const dt = (t(p) - t(q)) / 3600000;
    const kmh = dt > 0 ? metros(q, p) / 1000 / dt : 0;
    const lento = !p.nuevoSegmento && p.parada === undefined && q.parada === undefined && dt > 0 && kmh < r.kmhLento;
    if (lento) { if (a === null) a = k - 1; } else cerrar(k - 1);
  }
  cerrar(limpios.length - 1);

  return { puntos: limpios, paradas, lentos, km: Math.round(largo(limpios, 0, limpios.length - 1) / 100) / 10 };
}
