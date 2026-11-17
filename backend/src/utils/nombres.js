// Nombre completo de una persona o empresa (Tercero), en un solo lugar para todo el sistema.
// Algunos registros traen los apellidos también dentro de «nombres» (así vienen del RNDC o de una plantilla):
//   nombres «NARVAEZ GALLARDO HENRY ARMANDO», apellidos «NARVAEZ» «GALLARDO» → «HENRY ARMANDO NARVAEZ GALLARDO»
// Aquí se quitan de «nombres» los apellidos repetidos al principio o al final, para que no salgan dos veces.
const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clave = (s) => limpio(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Nombres sin los apellidos repetidos (no cambia nada si no están repetidos)
export function nombresSinApellidos(nombres, apellido1, apellido2) {
  const n = limpio(nombres).split(' ').filter(Boolean);
  const ap = [apellido1, apellido2].map(limpio).filter(Boolean).join(' ').split(' ').filter(Boolean);
  if (!ap.length || n.length <= ap.length) return limpio(nombres);
  const igual = (desde) => ap.every((w, i) => clave(n[desde + i]) === clave(w));
  if (igual(0)) return n.slice(ap.length).join(' ');
  if (igual(n.length - ap.length)) return n.slice(0, n.length - ap.length).join(' ');
  return limpio(nombres);
}

export function nombreCompleto(t) {
  if (!t) return '';
  return [nombresSinApellidos(t.nombres, t.apellido1, t.apellido2), limpio(t.apellido1), limpio(t.apellido2)].filter(Boolean).join(' ');
}

// El registro tiene los apellidos repetidos dentro de «nombres»
export const apellidosRepetidos = (t) => !!t && nombresSinApellidos(t.nombres, t.apellido1, t.apellido2) !== limpio(t.nombres);
