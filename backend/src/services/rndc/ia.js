// Diagnóstico con IA (Gemini) de un rechazo del RNDC que las reglas y el historial no reconocen.
//  - Sin datos personales: documentos, placas, nombres, teléfonos, direcciones y textos libres se cambian por
//    marcas (ID_1, PLACA_1…) antes de salir del servidor. La misma persona o placa lleva siempre la misma marca,
//    así la IA puede ver, p. ej., que el titular y el conductor son el mismo.
//  - Una consulta a la vez, con pausa entre consultas y un tope diario: no agota el cupo gratuito.
//  - Si la IA no responde o no está disponible, la revisión sigue con las reglas (no se detiene nada).
//  - La IA solo sugiere: sus correcciones se validan aquí y el usuario decide si las aplica. Nunca envía.
import { env } from '../../config/env.js';
import { RevisionIaRndc } from '../../models/index.js';
import { resumenConocidos, esAplicable } from './conocimiento.js';

const PERSONALES = /^(NUMID|NOMID|PRIMERAPELLIDO|SEGUNDOAPELLIDO|NUMPLACA|NUMTELEFONO|NUMCELULAR|NOMENCLATURA|OBSERVACIONES|NUMLICENCIA|NUMSEGUROSOAT|NUMPOLIZA|NOMSEDE|DESCRIPCIONCORTA)/;
const prefijo = (n) => (/PLACA/.test(n) ? 'PLACA' : /^NUMID/.test(n) ? 'ID' : /TELEFONO|CELULAR/.test(n) ? 'TEL' : 'TEXTO');

// Cambia los datos personales por marcas. Devuelve las variables anónimas, el mensaje limpio y el mapa (solo en memoria).
export function anonimizar(documentos, mensaje = '') {
  const marcas = new Map(); const cuenta = {};
  const marca = (n, v) => {
    const k = `${prefijo(n)}|${v}`;
    if (!marcas.has(k)) { const p = prefijo(n); cuenta[p] = (cuenta[p] || 0) + 1; marcas.set(k, `${p}_${cuenta[p]}`); }
    return marcas.get(k);
  };
  const salida = {};
  for (const [doc, vars] of Object.entries(documentos)) {
    salida[doc] = (vars || []).map(([n, v]) => [n, PERSONALES.test(n) && String(v ?? '').trim() ? marca(n, String(v).trim()) : String(v ?? '')]);
  }
  let m = String(mensaje || '');
  // Primero los valores conocidos (los más largos antes), luego cualquier número largo o placa que quede
  for (const [k, reemplazo] of [...marcas.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const original = k.slice(k.indexOf('|') + 1);
    if (original.length >= 3) m = m.split(original).join(reemplazo);
  }
  m = m.replace(/\b\d{6,}\b/g, '[NUMERO]').replace(/\b[A-Z]{3}\s?-?\d{2,3}[A-Z]?\b/g, '[PLACA]');
  return { documentos: salida, mensaje: m.slice(0, 1500), marcas: marcas.size };
}

export const ESQUEMA = {
  type: 'object',
  properties: {
    causa: { type: 'string', description: 'Causa probable del rechazo, en español sencillo para un auxiliar de despachos (máx. 2 frases).' },
    queHacer: { type: 'string', description: 'Qué debe hacer el usuario, paso a paso y en lenguaje sencillo (máx. 3 frases).' },
    correcciones: {
      type: 'array', description: 'Cambios exactos en variables del documento rechazado. Vacío si no hay un cambio seguro.',
      items: { type: 'object', properties: {
        documento: { type: 'string', enum: ['remesa', 'manifiesto'] },
        variable: { type: 'string' }, valor: { type: 'string' }, explicacion: { type: 'string' },
      }, required: ['documento', 'variable', 'valor', 'explicacion'] },
    },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['causa', 'queHacer', 'correcciones', 'confianza'],
};

const INSTRUCCIONES = `Eres experto en el RNDC (Registro Nacional de Despachos de Carga del Ministerio de Transporte de Colombia): remesas terrestres de carga (proceso 3) y manifiestos de carga (proceso 4).
Recibes las variables enviadas al web service y el mensaje de rechazo. Los datos personales vienen cambiados por marcas (ID_1, PLACA_1, TEL_1, TEXTO_1): trátalos como valores válidos y nunca propongas cambiar una marca ni escribir una.
Explica la causa más probable y qué hacer, en español claro, sin tecnicismos ni nombres de variables en el texto para el usuario.
Propón correcciones solo si estás seguro, solo en variables que existan en el documento rechazado y con el valor exacto en el formato del RNDC. Si la solución está fuera del documento (registrar un vehículo o una persona, o esperar al RNDC), deja las correcciones vacías y explícalo en queHacer.
Si no estás seguro, dilo y usa confianza «baja». No inventes códigos ni normas.
Tipos de manifiesto (CODOPERACIONTRANSPORTE): G general, U municipal o urbano, I ida y regreso, D varios viajes en el día, M multiparada, W vacío. Los códigos de municipio son DIVIPOLA de 8 dígitos; los 5 primeros son el municipio.
Rechazos que la plataforma ya conoce (como referencia):
${resumenConocidos()}`;

// Texto del modelo en la respuesta de la API de Interactions (la forma puede variar: se busca de atrás hacia adelante)
export function textoDe(r) {
  if (typeof r?.output_text === 'string') return r.output_text;
  const pasos = r?.steps || r?.outputs || [];
  for (const s of [...pasos].reverse()) {
    const c = s?.content ?? s?.model_output?.content ?? [];
    const t = (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' ? x : x?.text)).filter(Boolean).join('');
    if (t) return t;
    if (typeof s?.text === 'string') return s.text;
  }
  return '';
}

// Respuesta de la IA validada: textos recortados y solo correcciones posibles sobre el documento rechazado
export function validarRespuesta(bruta, documentos) {
  let r = bruta;
  if (typeof r === 'string') { try { r = JSON.parse(r.replace(/^```(json)?|```$/g, '').trim()); } catch { return null; } }
  if (!r || typeof r !== 'object' || typeof r.causa !== 'string') return null;
  const corto = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const correcciones = (Array.isArray(r.correcciones) ? r.correcciones : []).flatMap((c) => {
    const doc = c?.documento === 'remesa' ? 'remesa' : c?.documento === 'manifiesto' ? 'manifiesto' : null;
    const variable = corto(c?.variable, 40).toUpperCase(); const valor = corto(c?.valor, 120);
    if (!doc || !/^[A-Z0-9]{2,40}$/.test(variable) || PERSONALES.test(variable) || /\b(ID|PLACA|TEL|TEXTO)_\d+\b/.test(valor)) return [];
    const actual = (documentos[doc] || []).find(([n]) => n === variable);
    if (!actual || String(actual[1]) === valor) return [];
    return [{ documento: doc, variable, valor, antes: String(actual[1] ?? ''), explicacion: corto(c.explicacion, 300), aplicable: esAplicable(doc, variable) }];
  }).slice(0, 3);
  return { causa: corto(r.causa, 400), queHacer: corto(r.queHacer, 600), correcciones, confianza: ['alta', 'media', 'baja'].includes(r.confianza) ? r.confianza : 'baja' };
}

// ── Estado del servicio y cola ──
const estado = { pausaHasta: 0, motivo: '', dia: '', usadas: 0 };
const cola = []; const enCola = new Set(); let ocupado = false;
const hoy = () => new Date().toISOString().slice(0, 10);

export function disponibilidad() {
  if (!env.gemini.clave) return { activa: false, motivo: 'sin_clave' };
  if (estado.dia === hoy() && estado.usadas >= env.gemini.maxDia) return { activa: false, motivo: 'tope_diario' };
  if (Date.now() < estado.pausaHasta) return { activa: false, motivo: estado.motivo || 'pausa' };
  return { activa: true, motivo: '' };
}

async function consultar(datos) {
  const r = await fetch(`${env.gemini.url}/interactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.gemini.clave, 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({
      model: env.gemini.modelo,
      system_instruction: INSTRUCCIONES,
      input: JSON.stringify(datos),
      response_format: { type: 'text', mime_type: 'application/json', schema: ESQUEMA },
    }),
    signal: AbortSignal.timeout(env.gemini.timeoutMs),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(cuerpo?.error?.message || `HTTP ${r.status}`); e.status = r.status; e.codigo = cuerpo?.error?.code || cuerpo?.error?.status || ''; throw e; }
  return textoDe(cuerpo);
}

async function trabajar() {
  if (ocupado) return;
  ocupado = true;
  try {
    while (cola.length) {
      if (!disponibilidad().activa) { for (const t of cola.splice(0)) { enCola.delete(t.clave); await RevisionIaRndc.deleteOne({ empresa: t.empresa, _id: t.id }).catch(() => {}); } break; }
      const t = cola.shift();
      if (estado.dia !== hoy()) { estado.dia = hoy(); estado.usadas = 0; }
      estado.usadas++;
      try {
        const resultado = validarRespuesta(await consultar(t.datos), t.documentos);
        if (resultado) await RevisionIaRndc.updateOne({ empresa: t.empresa, _id: t.id }, { estado: 'listo', resultado, modelo: env.gemini.modelo });
        else await RevisionIaRndc.updateOne({ empresa: t.empresa, _id: t.id }, { estado: 'error', error: 'La IA no dio una respuesta válida' });
      } catch (e) {
        // Cupo agotado o servicio no disponible: se pausa y se vuelve a intentar más tarde (sin guardar el fallo)
        if (e.status === 429) { estado.pausaHasta = Date.now() + 10 * 60000; estado.motivo = 'limite'; }
        else if (e.status === 401 || e.status === 403) { estado.pausaHasta = Date.now() + 60 * 60000; estado.motivo = /free tier|billing/i.test(e.message) ? 'sin_plan' : 'clave'; }
        else if (!e.status || e.status >= 500) { estado.pausaHasta = Date.now() + 2 * 60000; estado.motivo = 'no_responde'; }
        if (estado.pausaHasta > Date.now()) await RevisionIaRndc.deleteOne({ empresa: t.empresa, _id: t.id }).catch(() => {});
        else await RevisionIaRndc.updateOne({ empresa: t.empresa, _id: t.id }, { estado: 'error', error: 'La IA no pudo revisar este rechazo' }).catch(() => {});
        if (env.nodeEnv !== 'test') console.warn('[ia-rndc]', e.status || '', String(e.message).slice(0, 200));
      } finally { enCola.delete(t.clave); }
      if (cola.length) await new Promise((r) => setTimeout(r, env.gemini.pausaMs));
    }
  } finally { ocupado = false; }
}

// Diagnóstico de la IA para un viaje y unos datos (huella): el guardado, o lo pide en segundo plano.
// documentos: { remesa: [[n, v]…], manifiesto: [[n, v]…] } (sin anonimizar: se anonimiza aquí).
export async function diagnostico(empresaId, viajeId, huella, { documentos, proceso, mensaje }) {
  const guardado = await RevisionIaRndc.findOne({ empresa: empresaId, viaje: viajeId, huella }).lean();
  const clave = `${empresaId}|${viajeId}|${huella}`;
  // Pendiente huérfano (el servidor se reinició con la consulta en cola): se vuelve a pedir
  const huerfano = guardado?.estado === 'pendiente' && !enCola.has(clave) && Date.now() - new Date(guardado.updatedAt).getTime() > 5 * 60000;
  if (guardado && !huerfano) return { estado: guardado.estado, resultado: guardado.resultado, error: guardado.error };
  const d = disponibilidad();
  if (!d.activa) return { estado: 'no_disponible', motivo: d.motivo };
  const doc = Number(proceso) === 3 ? 'remesa' : 'manifiesto';
  const anon = anonimizar(documentos, mensaje);
  const datos = { documentoRechazado: doc, mensajeRndc: anon.mensaje, variables: Object.fromEntries(anon.documentos[doc]),
    ...(doc === 'manifiesto' ? { remesaDelViaje: Object.fromEntries(anon.documentos.remesa || []) } : {}) };
  let id;
  try {
    id = guardado?._id || (await RevisionIaRndc.create({ empresa: empresaId, viaje: viajeId, huella, estado: 'pendiente' }))._id;
    if (guardado) await RevisionIaRndc.updateOne({ empresa: empresaId, _id: id }, { $set: { estado: 'pendiente' } });
  } catch (e) {
    if (e?.code === 11000) return { estado: 'pendiente' };   // otra petición lo acaba de pedir
    throw e;
  }
  if (!enCola.has(clave)) { enCola.add(clave); cola.push({ id, empresa: empresaId, clave, datos, documentos: anon.documentos }); }
  trabajar().catch(() => {});
  return { estado: 'pendiente' };
}

// Solo para pruebas
export const _estado = estado;
