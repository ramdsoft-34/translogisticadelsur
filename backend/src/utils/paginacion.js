import mongoose from 'mongoose';

// Paginación de listas desde el servidor. Solo se activa cuando la petición trae «pagina»: así las pantallas y
// procesos que todavía piden la lista completa (con su tope) siguen funcionando igual.
//
// Tres decisiones tomadas de la documentación de MongoDB:
//  - El total se cuenta solo en la primera página (o si se pide con contar=1): al pasar de página el navegador ya
//    lo tiene y countDocuments recorre todo lo que cumple el filtro.
//  - skip() recorre desde el inicio todo lo que salta («As the offset increases, skip() will become slower»).
//    Para ir a la página siguiente o anterior se usa un cursor (despuesDe / antesDe = _id del último / primer
//    registro que se estaba viendo) y una consulta por rango sobre el mismo índice del orden: no salta nada.
//    Saltar a una página lejana (p. ej. de la 1 a la 9) sigue usando skip.
//  - El orden siempre termina en un campo único (_id) para que dos páginas no repitan ni pierdan registros.
const esId = (x) => typeof x === 'string' && mongoose.isValidObjectId(x) && /^[a-f0-9]{24}$/i.test(x);

export function paginacion(q = {}, { porDefecto = 50, maximo = 200, minimo = 5 } = {}) {
  const activa = q.pagina !== undefined && q.pagina !== '';
  const pagina = Math.max(1, Math.floor(Number(q.pagina)) || 1);
  const limite = Math.min(maximo, Math.max(minimo, Math.floor(Number(q.limite)) || porDefecto));
  return {
    activa, pagina, limite, salto: (pagina - 1) * limite,
    contar: pagina === 1 || q.contar === '1',
    despuesDe: esId(q.despuesDe) ? q.despuesDe : null,
    antesDe: esId(q.antesDe) ? q.antesDe : null,
  };
}

// Respuesta estándar de una página. Sin total (páginas siguientes) se devuelve null y el navegador conserva el que tenía.
export const pagina = (items, total, p, extra = {}) => ({
  items, total: total ?? null, pagina: p.pagina, limite: p.limite,
  paginas: total == null ? null : Math.max(1, Math.ceil(total / p.limite)), ...extra,
});

// Recorta una lista ya filtrada en memoria
export const recortar = (lista, p) => lista.slice(p.salto, p.salto + p.limite);

// Agrega el desempate por _id al orden si no lo trae. Con «unico» (la combinación de campos ya es única, p. ej. el
// número del documento) no se agrega: así el orden coincide exactamente con el índice y MongoDB no ordena en memoria.
export function ordenEstable(orden, unico = false) {
  return unico || '_id' in orden ? orden : { ...orden, _id: Object.values(orden).at(-1) ?? -1 };
}

// Condición «viene después de este registro» para un orden de varios campos:
// (a < va) o (a = va y b < vb) o (a = va y b = vb y _id < vid) … con < o > según la dirección de cada campo.
export function rangoDespues(orden, ancla, haciaAtras = false) {
  const campos = Object.entries(orden);
  const valor = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), ancla);
  if (campos.some(([k]) => valor(k) == null)) return null;    // con valores vacíos el rango no es seguro: se usa skip
  const o = [];
  campos.forEach(([k, dir], i) => {
    const op = (dir === -1) !== haciaAtras ? '$lt' : '$gt';
    const c = {};
    campos.slice(0, i).forEach(([k2]) => { c[k2] = valor(k2); });
    c[k] = { [op]: valor(k) };
    o.push(c);
  });
  return { $or: o };
}

const invertir = (orden) => Object.fromEntries(Object.entries(orden).map(([k, d]) => [k, -d]));

// Lista una página de un modelo con el filtro y el orden dados.
//   opciones: orden (obligatorio; debe coincidir con un índice), unico (el orden ya es único), select, populate
// Devuelve { items, total } (total null si no se contó).
export async function listarPagina(Modelo, filtro, p, { orden, unico = false, select, populate } = {}) {
  const sort = ordenEstable(orden, unico);
  const consulta = (f, s) => {
    let c = Modelo.find(f).sort(s);
    if (select) c = c.select(select);
    if (populate) c = c.populate(populate);
    return c;
  };
  const total = p.contar ? Modelo.countDocuments(filtro) : null;
  let items = null;
  const id = p.despuesDe || p.antesDe;
  if (id && p.pagina > 1) {
    // El registro ancla debe seguir cumpliendo el filtro; si no (se borró o cambió), se usa skip
    const ancla = await Modelo.findOne({ ...filtro, _id: id }).select(Object.keys(sort).join(' ')).lean();
    const atras = !p.despuesDe;
    const rango = ancla && rangoDespues(sort, ancla, atras);
    if (rango) {
      const f = { ...filtro, $and: [...(filtro.$and || []), rango] };
      items = await consulta(f, atras ? invertir(sort) : sort).limit(p.limite).lean();
      if (atras) items.reverse();
      // Si hacia atrás no se completa la página (se borraron registros), se recalcula con skip
      if (atras && items.length < p.limite) items = null;
    }
  }
  if (!items) items = await consulta(filtro, sort).skip(p.salto).limit(p.limite).lean();
  return { items, total: await total };
}
