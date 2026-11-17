// Revisión de los viajes «Por enviar» antes de expedir: dice si la remesa y el manifiesto pasarían en el RNDC,
// qué falta y la corrección exacta cuando se conoce. Se arma en tres capas:
//   1. Reglas: lo que la vista previa ya valida (diccionario del RNDC, maestros, sedes, avisos) y los rechazos conocidos.
//   2. Historial: rechazos anteriores de la empresa y lo que se cambió para que el RNDC los aceptara.
//   3. IA: solo para un rechazo que ni las reglas ni el historial explican (ver ia.js).
// Nunca envía nada ni cambia datos: las correcciones se aplican solo si el usuario lo pide.
import crypto from 'node:crypto';
import { vistaPrevia } from './operaciones.js';
import { CONOCIDOS, conocido, codigosDe, esAplicable } from './conocimiento.js';
import { casosAprendidos, resueltoAntes, patronesQueAplican } from './aprendizaje.js';
import { diagnostico } from './ia.js';

export const NOMBRES = {
  CODOPERACIONTRANSPORTE: 'Tipo de manifiesto', CODMUNICIPIODESTINOMANIFIESTO: 'Municipio de destino', CODMUNICIPIOORIGENMANIFIESTO: 'Municipio de origen',
  CODSEDEDESTINATARIO: 'Sede del destinatario', CODSEDEREMITENTE: 'Sede del remitente', CODSEDEPROPIETARIO: 'Sede del propietario',
  NUMPLACA: 'Placa', NUMPLACAREMOLQUE: 'Remolque', NUMIDCONDUCTOR: 'Conductor', NUMIDTITULARMANIFIESTO: 'Titular', NUMIDDESTINATARIO: 'Destinatario',
  NUMIDREMITENTE: 'Remitente', VALORFLETEPACTADOVIAJE: 'Flete', VALORANTICIPOMANIFIESTO: 'Anticipo', RETENCIONFOPAT: 'Retención FOPAT', CANTIDADCARGADA: 'Cantidad cargada',
};
const TIPOS = { G: 'General', U: 'Municipal o urbano', I: 'Ida y regreso', D: 'Varios en el día', M: 'Multiparada', W: 'Vacío' };
const nombre = (v) => NOMBRES[v] || v;
const legible = (variable, valor) => (variable === 'CODOPERACIONTRANSPORTE' && TIPOS[valor] ? `${TIPOS[valor]} (${valor})` : valor || '(vacío)');
const mapa = (vars) => Object.fromEntries(vars || []);
const valor = (vars, n) => (vars || []).find(([k]) => k === n)?.[1] ?? '';

function correccionDe(documento, variable, nuevo, actual, texto) {
  return { documento, variable, valor: nuevo, antes: actual, aplicable: esAplicable(documento, variable),
    texto: texto || `Cambiar ${nombre(variable).toLowerCase()} de ${legible(variable, actual)} a ${legible(variable, nuevo)}` };
}

// Huella de lo que se enviaría: si cambia algo, la revisión de la IA se vuelve a pedir
export function huellaRevision(p) {
  return crypto.createHash('sha256').update(JSON.stringify([p.remesaAceptada ? [] : p.remesa.variables, p.manifiesto.variables,
    p.ultimoError ? [p.ultimoError.proceso, p.ultimoError.mensaje, p.ultimoError.fecha] : null])).digest('hex').slice(0, 32);
}

// Reglas sobre la vista previa (puro: sirve para probar sin base de datos)
export function hallazgosDeReglas(p) {
  const h = [];
  const add = (nivel, titulo, detalle, extra = {}) => h.push({ nivel, titulo, detalle, fuente: 'regla', ...extra });
  for (const x of p.remesa.problemas || []) add('error', 'Remesa: falta o está mal un dato', x);
  for (const x of p.manifiesto.problemas || []) if (!(p.remesa.problemas || []).includes(x)) add('error', 'Manifiesto: falta o está mal un dato', x);
  for (const m of p.maestros || []) {
    if (m.estado === 'no_existe') add('error', `${m.rol}: no está registrado`, `${m.referencia} no está en la plataforma. Regístrelo o tráigalo del RNDC antes de enviar.`);
    else if (m.faltantes?.length) add('error', `${m.rol}: faltan datos`, `${m.referencia}: ${m.faltantes.map((f) => f.etiqueta || f).join(', ')}.`);
    else if (m.estado === 'error') add('alerta', `${m.rol}: el RNDC lo rechazó al registrarlo`, `${m.referencia}: ${m.mensaje || 'revise sus datos'}`);
  }
  for (const a of p.avisos || []) add(/vencid/i.test(a) ? 'error' : 'alerta', 'Revise', a);
  // Tipo de manifiesto contra la ruta (MAN092 / MAN153), antes de que el RNDC lo rechace
  if (p.manifiesto?.variables && p.documentos?.manifiesto?.estado !== 'aceptado') {
    const m = p.manifiesto.variables; const tipo = valor(m, 'CODOPERACIONTRANSPORTE');
    for (const c of CONOCIDOS.filter((x) => x.id === 'MAN092' || x.id === 'MAN153')) {
      const corr = c.correccion(p);
      if (!corr) continue;
      // MAN153 solo aplica al tipo general; los demás tipos (ida y regreso, varios en el día) admiten el mismo municipio
      if (c.id === 'MAN153' && tipo !== 'G') continue;
      add('error', c.titulo, `${c.que}`, { codigo: c.id, correccion: correccionDe(corr.documento, corr.variable, corr.valor, tipo, corr.texto) });
    }
  }
  if (p.valores?.anticipoAjustado) {
    add('info', 'Anticipo ajustado', `El anticipo registrado ($${p.valores.anticipoRegistrado.toLocaleString('es-CO')}) supera el neto a pagar; se enviará $${p.valores.anticipo.toLocaleString('es-CO')} para evitar el rechazo MAN270.`);
  }
  return h;
}

const NIVEL = { error: 3, alerta: 2, info: 1 };
export const nivelDe = (hallazgos) => (hallazgos.some((x) => x.nivel === 'error') ? 'error' : hallazgos.some((x) => x.nivel === 'alerta') ? 'alerta' : 'ok');

// Revisión completa de un viaje
export async function revisarViaje(empresaId, viajeId, { previa = null, conIa = true } = {}) {
  const p = previa || await vistaPrevia(empresaId, viajeId);
  const hallazgos = hallazgosDeReglas(p);
  const casos = await casosAprendidos(empresaId);
  const vars = { remesa: p.remesaAceptada ? {} : mapa(p.remesa.variables), manifiesto: mapa(p.manifiesto.variables) };
  const huella = huellaRevision(p);
  let ia = null;

  // Último rechazo del RNDC: qué significa, cómo se resolvió antes y la corrección si es segura
  const e = p.ultimoError;
  if (e) {
    const doc = Number(e.proceso) === 3 ? 'remesa' : 'manifiesto';
    const c = conocido(e.mensaje);
    const codigos = codigosDe(e.mensaje);
    const antes = codigos.map((k) => ({ codigo: k, ...resueltoAntes(casos, k) })).find((x) => x.cambios.length || x.sinCambios) || null;
    const corr = c?.correccion?.(p);
    // La regla del tipo de manifiesto ya lo dice en este mismo hallazgo: no se repite
    if (c) for (let i = hallazgos.length - 1; i >= 0; i--) if (hallazgos[i].codigo === c.id) hallazgos.splice(i, 1);
    const correcciones = [];
    if (corr) correcciones.push(correccionDe(corr.documento, corr.variable, corr.valor, valor(p[corr.documento].variables, corr.variable), corr.texto));
    // Del historial: el cambio que más veces resolvió este código, si el viaje todavía tiene el valor rechazado
    for (const m of antes?.cambios || []) {
      const actual = vars[m.documento]?.[m.variable];
      if (actual === undefined || String(actual) !== m.antes || correcciones.some((x) => x.variable === m.variable)) continue;
      correcciones.push({ ...correccionDe(m.documento, m.variable, m.despues, m.antes), fuente: 'historial', veces: m.veces, viajes: m.viajes });
      break;
    }
    hallazgos.unshift({
      nivel: 'error', fuente: c ? 'regla' : antes ? 'historial' : 'rndc', codigo: codigos[0] || c?.id || '',
      titulo: `El RNDC rechazó ${doc === 'remesa' ? 'la remesa' : 'el manifiesto'}${c ? `: ${c.titulo.toLowerCase()}` : ''}`,
      detalle: c?.que || 'Este rechazo no está entre los conocidos.', mensajeRndc: e.mensaje,
      historial: antes ? { codigo: antes.codigo, cambios: antes.cambios.map((m) => ({ ...m, texto: `${nombre(m.variable)}: ${legible(m.variable, m.antes)} → ${legible(m.variable, m.despues)}` })), sinCambios: antes.sinCambios, viajesSin: antes.viajesSin } : null,
      correcciones,
    });
    // IA solo si nada lo explica
    if (conIa && !c && !antes) {
      ia = await diagnostico(empresaId, viajeId, huella, {
        documentos: { remesa: p.remesa.variables, manifiesto: p.manifiesto.variables }, proceso: e.proceso, mensaje: e.mensaje,
      }).catch(() => ({ estado: 'no_disponible', motivo: 'error' }));
    }
  }

  // Viajes parecidos que el RNDC rechazó antes, cuando este conserva el valor que causó el rechazo
  if (p.documentos?.manifiesto?.estado !== 'aceptado') {
    for (const pt of patronesQueAplican(casos, vars, viajeId).slice(0, 3)) {
      if (hallazgos.some((x) => x.correccion?.variable === pt.variable || x.correcciones?.some((y) => y.variable === pt.variable))) continue;
      const lista = pt.viajes.filter(Boolean).map((n) => `N° ${n}`).join(', ');
      hallazgos.push({ nivel: 'alerta', fuente: 'historial', codigo: pt.codigo,
        titulo: `Se parece a ${pt.veces === 1 ? 'un viaje rechazado' : `${pt.veces} viajes rechazados`} (${pt.codigo})`,
        detalle: `${lista ? `El viaje ${lista}` : 'Un viaje'} con ${pt.coinciden.length ? 'la misma ruta o los mismos datos' : `el mismo dato (${nombre(pt.variable).toLowerCase()})`} fue rechazado con ${pt.codigo} y el RNDC lo aceptó al cambiar ${nombre(pt.variable).toLowerCase()} de ${legible(pt.variable, pt.antes)} a ${legible(pt.variable, pt.despues)}.`,
        correccion: correccionDe(pt.documento, pt.variable, pt.despues, pt.antes) });
    }
  }
  hallazgos.sort((a, b) => NIVEL[b.nivel] - NIVEL[a.nivel]);
  return { viaje: String(viajeId), nivel: nivelDe(hallazgos), hallazgos, ia, huella, revisadoEn: new Date() };
}

// Varias a la vez, con pocas consultas simultáneas a la base de datos
export async function revisarViajes(empresaId, ids, simultaneas = 4) {
  const out = new Array(ids.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(simultaneas, ids.length) }, async () => {
    while (i < ids.length) {
      const k = i++;
      try { out[k] = await revisarViaje(empresaId, ids[k]); }
      catch (e) { out[k] = { viaje: String(ids[k]), nivel: 'desconocido', hallazgos: [], error: e?.status === 404 ? 'Viaje no encontrado' : 'No se pudo revisar' }; }
    }
  }));
  return out;
}
