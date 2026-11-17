// Aprendizaje desde el historial de envíos: cada rechazo de una remesa o un manifiesto que después se aceptó
// enseña qué se cambió para que pasara. Con eso:
//   - un rechazo nuevo muestra cómo se resolvió antes el mismo código;
//   - un viaje por enviar se avisa si se parece a uno rechazado (misma ruta, placa, conductor o destinatario)
//     y todavía tiene el valor que causó el rechazo.
// No guarda nada aparte: se calcula de las transacciones del RNDC y se conserva unos minutos en memoria.
import { TransaccionRndc, Viaje } from '../../models/index.js';
import { variablesDeSolicitud } from './operaciones.js';
import { codigosDe } from './conocimiento.js';

// Variables que cambian en todo reenvío y no explican nada (numeración, fechas, empresa, textos libres)
const IGNORAR = new Set(['NUMNITEMPRESATRANSPORTE', 'CONSECUTIVOREMESA', 'NUMMANIFIESTOCARGA', 'MANNROMANIFIESTOTRANSBORDO',
  'FECHAEXPEDICIONMANIFIESTO', 'FECHAPAGOSALDOMANIFIESTO', 'FECHACITAPACTADACARGUE', 'FECHACITAPACTADADESCARGUE', 'OBSERVACIONES']);
// Datos que identifican la ruta, el vehículo y las personas: sirven para decir que dos viajes se parecen
const CONTEXTO = ['CODMUNICIPIOORIGENMANIFIESTO', 'CODMUNICIPIODESTINOMANIFIESTO', 'NUMPLACA', 'NUMIDCONDUCTOR', 'NUMIDTITULARMANIFIESTO', 'NUMIDDESTINATARIO', 'CODSEDEDESTINATARIO'];
const MAX_CAMBIOS = 4;
// Para avisar a otro viaje, el cambio que arregló el rechazo debe ser el único del reenvío (si no, no se sabe cuál
// lo arregló) y el otro viaje debe compartir los datos de los que depende ese cambio.
const REQUIERE = {
  CODOPERACIONTRANSPORTE: ['CODMUNICIPIOORIGENMANIFIESTO', 'CODMUNICIPIODESTINOMANIFIESTO'],
  CODMUNICIPIODESTINOMANIFIESTO: ['NUMIDDESTINATARIO', 'CODSEDEDESTINATARIO'],
  CODSEDEDESTINATARIO: ['NUMIDDESTINATARIO'],
};
export const esPersonal = (variable) => /^(NUMID|NUMPLACA|NOMID|PRIMERAPELLIDO|SEGUNDOAPELLIDO)/.test(variable);   // un reenvío con muchos cambios no deja claro cuál lo arregló
export const documentoDe = (proceso) => (Number(proceso) === 3 ? 'remesa' : 'manifiesto');

// Diferencias entre lo rechazado y lo aceptado
export function diferencias(antes, despues) {
  const claves = new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})]);
  const out = [];
  for (const k of claves) {
    if (IGNORAR.has(k)) continue;
    const a = String(antes?.[k] ?? '').trim(); const d = String(despues?.[k] ?? '').trim();
    if (a !== d) out.push({ variable: k, antes: a, despues: d });
  }
  return out;
}

// Casos aprendidos a partir de transacciones (puro: recibe las listas ya leídas y ordenadas por fecha)
export function casosDesdeTransacciones(fallidas, aceptadas) {
  const porViaje = new Map();
  for (const a of aceptadas) {
    const k = `${a.viaje}|${a.proceso}`;
    if (!porViaje.has(k)) porViaje.set(k, []);
    porViaje.get(k).push(a);
  }
  const casos = []; const vistos = new Set();
  for (const f of fallidas) {
    const codigos = codigosDe(f.mensaje);
    if (!codigos.length) continue;
    const ok = (porViaje.get(`${f.viaje}|${f.proceso}`) || []).find((a) => new Date(a.createdAt) > new Date(f.createdAt));
    if (!ok) continue;
    const vf = variablesDeSolicitud(f.solicitud); const va = variablesDeSolicitud(ok.solicitud);
    if (!vf || !va) continue;
    const cambios = diferencias(vf, va);
    if (cambios.length > MAX_CAMBIOS) continue;
    const contexto = Object.fromEntries(CONTEXTO.filter((k) => vf[k]).map((k) => [k, vf[k]]));
    for (const codigo of codigos) {
      const clave = `${f.viaje}|${f.proceso}|${codigo}|${JSON.stringify(cambios)}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      casos.push({ codigo, proceso: f.proceso, documento: documentoDe(f.proceso), viaje: String(f.viaje), cambios, contexto, fecha: ok.createdAt });
    }
  }
  return casos;
}

// Cómo se resolvió antes un código: cambios agrupados, del más repetido al menos
export function resueltoAntes(casos, codigo) {
  const grupos = new Map(); let sinCambios = 0; const viajesSin = [];
  for (const c of casos.filter((x) => x.codigo === codigo)) {
    if (!c.cambios.length) { sinCambios++; viajesSin.push(c.numero ?? c.viaje); continue; }
    for (const m of c.cambios) {
      const k = `${c.documento}|${m.variable}|${m.antes}|${m.despues}`;
      const g = grupos.get(k) || { documento: c.documento, ...m, veces: 0, viajes: [] };
      g.veces++; if (g.viajes.length < 5) g.viajes.push(c.numero ?? c.viaje);
      grupos.set(k, g);
    }
  }
  return { cambios: [...grupos.values()].sort((a, b) => b.veces - a.veces).slice(0, 5), sinCambios, viajesSin: viajesSin.slice(0, 5) };
}

// Rechazos anteriores que se parecen a este viaje y cuyo valor problemático sigue igual.
// vars: { remesa: {NOMBRE: valor}, manifiesto: {…} } del viaje a revisar.
export function patronesQueAplican(casos, vars, viajeId) {
  const out = new Map();
  for (const c of casos) {
    if (c.viaje === String(viajeId) || c.cambios.length !== 1) continue;
    const actuales = vars[c.documento] || {};
    const todas = { ...(vars.remesa || {}), ...(vars.manifiesto || {}) };
    const coinciden = Object.entries(c.contexto).filter(([k, v]) => todas[k] && String(todas[k]) === String(v)).map(([k]) => k);
    for (const m of c.cambios) {
      if (!(m.variable in actuales) || String(actuales[m.variable] ?? '') !== m.antes || m.antes === m.despues) continue;
      // El dato mismo identifica (la misma placa, el mismo conductor); si no, el viaje comparte los datos de los que depende
      const requeridos = REQUIERE[m.variable];
      const parecido = requeridos ? requeridos.every((k) => c.contexto[k] && coinciden.includes(k))
        : CONTEXTO.includes(m.variable) || coinciden.length >= 3;
      if (!parecido) continue;
      const k = `${c.codigo}|${c.documento}|${m.variable}|${m.antes}|${m.despues}`;
      const p = out.get(k) || { codigo: c.codigo, documento: c.documento, ...m, veces: 0, viajes: [], coinciden };
      p.veces++; if (p.viajes.length < 5) p.viajes.push(c.numero ?? c.viaje);
      out.set(k, p);
    }
  }
  return [...out.values()].sort((a, b) => b.veces - a.veces);
}

// ── Lectura del historial (con memoria de unos minutos por empresa) ──
const memoria = new Map();
const VIGENCIA_MS = 10 * 60 * 1000;
export function olvidar(empresaId) { memoria.delete(String(empresaId)); }

export async function casosAprendidos(empresaId) {
  const k = String(empresaId);
  const m = memoria.get(k);
  if (m && Date.now() - m.t < VIGENCIA_MS) return m.casos;
  const desde = new Date(Date.now() - 400 * 86400000);
  const base = { empresa: empresaId, tipo: 1, proceso: { $in: [3, 4] }, viaje: { $ne: null }, createdAt: { $gte: desde } };
  const fallidas = await TransaccionRndc.find({ ...base, ok: false }).select('viaje proceso mensaje solicitud createdAt')
    .sort({ createdAt: -1 }).limit(3000).lean();
  fallidas.reverse();
  const ids = [...new Set(fallidas.map((f) => String(f.viaje)))];
  const aceptadas = ids.length ? await TransaccionRndc.find({ ...base, ok: true, viaje: { $in: ids } }).select('viaje proceso solicitud createdAt').sort({ createdAt: 1 }).lean() : [];
  const casos = casosDesdeTransacciones(fallidas, aceptadas);
  const numeros = new Map((await Viaje.find({ empresa: empresaId, _id: { $in: [...new Set(casos.map((c) => c.viaje))] } }).select('numero').lean())
    .map((v) => [String(v._id), v.numero]));
  for (const c of casos) c.numero = numeros.get(c.viaje) ?? null;
  memoria.set(k, { t: Date.now(), casos });
  return casos;
}
