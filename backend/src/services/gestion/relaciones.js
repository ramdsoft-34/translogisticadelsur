// Fase 11: relación de cobro de una empresa (cliente) por periodo.
// Junta todos los viajes de la empresa en la quincena o el mes (de todos los conductores), los agrupa por conductor y
// placa, revisa lo que puede estar mal antes de cobrar, y se guarda con número: borrador → enviada → facturada.
// Una relación facturada queda cerrada: sus viajes no se editan, no se eliminan ni se cobran en otra relación.
// La relación se envía por correo (plantilla propia de cada empresa) y por WhatsApp (enlace propio para verla y descargarla).
// Lo enviado no se reemplaza: el PDF y el Excel se guardan al enviarse o facturarse (versión de la relación) y desde ahí se
// sirven. Si una relación enviada se vuelve a guardar con cambios, sube de versión y vuelve a borrador (hay que reenviarla).
import crypto from 'node:crypto';
import { Empresa, Cliente, Viaje, Tarifa, RelacionCliente, Usuario, siguiente, pob } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import { txt, soloDigitos, quitarTildes, fmtFecha } from '../../utils/texto.js';
import { lineaLiquidacion, respaldosAuxiliar, NO_FACTURAR } from '../calculos.js';
import { saludo } from '../whatsapp.js';
import { pdfGuardado } from '../documentos/guardados.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = 864e5;
const RE_TOKEN = /^[A-Za-z0-9_-]{12,32}$/;
export const DIAS_REPORTE_TARDE = 3;      // un viaje reportado más de 3 días después de su fecha se avisa
export const enlaceRelacion = (token) => `${env.urlPublica}/r/${token}`;
const nuevoToken = () => crypto.randomBytes(12).toString('base64url');
const $ = (n) => Math.round(Number(n) || 0);
const pesos = (n) => `$ ${$(n).toLocaleString('es-CO')}`;
const nombreT = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');
// Celular colombiano para wa.me: 3001234567 → 573001234567 ('' si no es un celular válido)
export function numeroWhatsapp(celular) {
  const d = soloDigitos(celular);
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  if (d.length === 12 && d.startsWith('573')) return d;
  return '';
}
// Vistas previas de enlaces (WhatsApp, Facebook, Telegram…) no cuentan como apertura de la empresa
export const esVistaPrevia = (agente) => /whatsapp|facebookexternalhit|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|bot\b|crawler|spider|preview/i.test(String(agente || ''));

// ── Textos ──────────────────────────────────────────────────────────────────
// «del 16-31 de octubre 2026» · «del 1-31 de octubre 2026» · «del 25 de octubre al 5 de noviembre 2026»
export function periodoTexto(desde, hasta) {
  const a = new Date(desde); const b = new Date(hasta);
  const [d1, m1, y1] = [a.getUTCDate(), a.getUTCMonth(), a.getUTCFullYear()];
  const [d2, m2, y2] = [b.getUTCDate(), b.getUTCMonth(), b.getUTCFullYear()];
  if (m1 === m2 && y1 === y2) return d1 === d2 ? `del ${d1} de ${MESES[m1]} ${y1}` : `del ${d1}-${d2} de ${MESES[m1]} ${y1}`;
  if (y1 === y2) return `del ${d1} de ${MESES[m1]} al ${d2} de ${MESES[m2]} ${y2}`;
  return `del ${d1} de ${MESES[m1]} ${y1} al ${d2} de ${MESES[m2]} ${y2}`;
}
export const grupoTexto = (g) => (txt(g) ? txt(g).toUpperCase() : '');
export function tituloRelacion(cliente, desde, hasta, grupo = '') {
  const p = periodoTexto(desde, hasta).replace(/^del (\d+)-(\d+) de (\w+) (\d{4})$/, 'del $1 al $2 de $3 de $4');
  return `Relación de cargues ${txt(cliente)} para proceso de facturación ${p}${grupoTexto(grupo) ? ` · ${grupoTexto(grupo)}` : ''}`;
}
// Siglas de la empresa para el número: las del cliente (COR) o las iniciales del nombre (Nutrisur Pasto → NP)
export function siglasCliente(c) {
  const s = txt(c?.siglas).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s) return s.slice(0, 6);
  const p = quitarTildes(txt(c?.nombre)).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SA', 'SAS'].includes(w));
  return (p.length >= 2 ? p.slice(0, 3).map(w => w[0]).join('') : (p[0] || 'REL').slice(0, 3)) || 'REL';
}

// Plantilla del correo. Datos: {saludo} {empresa} {periodo} {año} {grupo} {numero} {viajes} {total} {usuario} {transportadora} {enlace}
export const PLANTILLA_GENERAL = {
  asunto: 'Relación de fletes {empresa} {periodo}',
  cuerpo: '{saludo}.\n\nEnvío la respectiva relación de fletes de {empresa}, correspondiente al periodo {periodo}.\n\nQuedo atento a sus comentarios.\n\nGracias.\n\n{usuario}\n{transportadora}',
};
export function aplicarPlantilla(texto, datos) {
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(datos, k) ? String(datos[k] ?? '') : m))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function datosPlantilla(rel, { cliente, empresa, usuario = '', ahora = new Date() } = {}) {
  return {
    saludo: saludo(ahora), empresa: txt(cliente?.nombre), periodo: periodoTexto(rel.desde, rel.hasta), año: new Date(rel.hasta).getUTCFullYear(),
    grupo: grupoTexto(rel.grupo), numero: rel.numero, viajes: rel.totales?.viajes ?? '', total: pesos(rel.totales?.total),
    usuario: txt(usuario), transportadora: txt(empresa?.rndc?.razonSocial) || txt(empresa?.nombre), enlace: rel.token ? enlaceRelacion(rel.token) : '',
  };
}
export function mensajeWhatsapp(rel, contacto, { cliente, empresa, ahora = new Date() }) {
  const primero = txt(contacto?.nombre).split(/\s+/)[0] || '';
  return [
    `${saludo(ahora)}${primero ? `, ${primero}` : ''}.`, '',
    'Le compartimos la relación de cargues para facturación:',
    `*${txt(cliente?.nombre)} · ${periodoTexto(rel.desde, rel.hasta).replace(/^del /, '')}${grupoTexto(rel.grupo) ? ` · ${grupoTexto(rel.grupo)}` : ''}*`,
    `*Relación:* ${rel.numero} · ${rel.totales?.viajes || 0} viajes`, `*Total:* ${pesos(rel.totales?.total)}`, '',
    'Véala y descárguela (PDF y Excel) aquí:', enlaceRelacion(rel.token), '',
    `Gracias. ${txt(empresa?.rndc?.razonSocial) || txt(empresa?.nombre)}`,
  ].join('\n');
}

// ── Agrupar y revisar (reglas puras) ───────────────────────────────────────
// Columna «Manifiesto» de la relación: el del RNDC, o el soporte interno (MC)
export const documentoViaje = (v) => (v.manifiesto?.estado === 'aceptado' && v.manifiesto?.numero) ? v.manifiesto.numero
  : (v.soporteInterno?.mc || (v.manifiesto?.numero || 'Soporte interno'));

// Un bloque por conductor y placa (si un conductor manejó dos placas, son dos bloques), ordenado por nombre y por fecha
export function agrupar(filas) {
  const m = new Map();
  for (const f of filas) {
    const k = `${quitarTildes(f.conductor).toUpperCase()}|${f.placa}`;
    if (!m.has(k)) m.set(k, { conductor: f.conductor, placa: f.placa, filas: [] });
    m.get(k).filas.push(f);
  }
  const grupos = [...m.values()].sort((a, b) => a.conductor.localeCompare(b.conductor, 'es') || a.placa.localeCompare(b.placa));
  for (const g of grupos) {
    g.filas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.numero - b.numero);
    g.filas.forEach((f, i) => { f.n = i + 1; });
    g.totales = { viajes: g.filas.length, tarifa: g.filas.reduce((a, f) => a + f.tarifa, 0), auxiliar: g.filas.reduce((a, f) => a + f.auxiliar, 0) };
    g.totales.total = g.totales.tarifa + g.totales.auxiliar;
  }
  return grupos;
}
export function totalesDe(filas) {
  const t = { viajes: filas.length, vehiculos: new Set(filas.map(f => f.placa)).size, tarifa: 0, auxiliar: 0, total: 0 };
  for (const f of filas) { t.tarifa += f.tarifa; t.auxiliar += f.auxiliar; }
  t.total = t.tarifa + t.auxiliar;
  return t;
}

// Distancia de edición (para nombres casi iguales: «Maurico» / «Mauricio»)
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const normalNombre = (s) => quitarTildes(s).toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
export function nombresParecidos(a, b) {
  const x = normalNombre(a); const y = normalNombre(b);
  if (!x || !y || x === y) return false;
  const lim = Math.max(x.length, y.length) >= 10 ? 2 : 1;
  return distancia(x, y) <= lim;
}

// Avisos antes de generar. filas: las de la relación. sospechosas: viajes de la empresa con fecha posterior al periodo
// que se registraron antes de esa fecha (¿la fecha quedó mal?). enOtras: viaje → número de otra relación.
export function revisar({ filas, desde, hasta, sospechosas = [], enOtras = new Map() }) {
  const avisos = [];
  for (const v of sospechosas) {
    const f = new Date(v.fecha); const sug = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, f.getUTCDate()));
    const dentro = sug >= new Date(desde) && sug <= new Date(hasta);
    avisos.push({ tipo: 'fecha', nivel: 'aviso', viaje: String(v._id), placa: v.placa,
      texto: `${v.placa} tiene un viaje con fecha ${fmtFecha(v.fecha)}, después del periodo, registrado el ${fmtFecha(v.createdAt)}${dentro ? ` (¿era ${fmtFecha(sug)}?)` : ''}. No entra en la relación.`,
      sugerencia: dentro ? sug.toISOString().slice(0, 10) : '' });
  }
  for (const f of filas) {
    if (f.reportado && (new Date(f.reportado) - new Date(f.fecha)) / DIA > DIAS_REPORTE_TARDE + 1) {
      const dias = Math.floor((new Date(f.reportado) - new Date(f.fecha)) / DIA);
      avisos.push({ tipo: 'tarde', nivel: 'aviso', viaje: f._id, placa: f.placa,
        texto: `${f.placa} · ${fmtFecha(f.fecha)} se reportó en la plataforma el ${fmtFecha(f.reportado)}, ${dias} días después del viaje. Confirme que es real.` });
    }
  }
  // Mismo vehículo, mismo día y mismo destino dos veces
  const vistos = new Map();
  for (const f of filas) {
    const k = `${f.placa}|${new Date(f.fecha).toISOString().slice(0, 10)}|${normalNombre(f.destino)}`;
    if (vistos.has(k)) avisos.push({ tipo: 'repetido', nivel: 'aviso', viaje: f._id, placa: f.placa,
      texto: `${f.placa} tiene dos viajes el ${fmtFecha(f.fecha)} a ${f.destino} (N° ${vistos.get(k).numero} y N° ${f.numero}). ¿Es el mismo viaje?` });
    else vistos.set(k, f);
  }
  // Conductores con nombres casi iguales (dos fichas de la misma persona)
  const nombres = [...new Map(filas.map(f => [normalNombre(f.conductor), f])).values()];
  for (let i = 0; i < nombres.length; i++) for (let j = i + 1; j < nombres.length; j++) {
    if (nombresParecidos(nombres[i].conductor, nombres[j].conductor)) avisos.push({ tipo: 'nombre', nivel: 'aviso', placa: nombres[i].placa,
      texto: `«${nombres[i].conductor}» (${nombres[i].placa}) y «${nombres[j].conductor}» (${nombres[j].placa}) parecen la misma persona con dos fichas.` });
  }
  for (const f of filas) {
    if (f.municipioDistinto) avisos.push({ tipo: 'destino', nivel: 'aviso', viaje: f._id, placa: f.placa,
      texto: `${f.placa} · ${fmtFecha(f.fecha)}: se cobra ${f.destino}, pero el manifiesto va a otro municipio. Revise el destino o la tarifa.` });
    if (f.sinTarifa) avisos.push({ tipo: 'tarifa', nivel: 'aviso', viaje: f._id, placa: f.placa,
      texto: `${f.placa} · ${fmtFecha(f.fecha)} (${f.destino}) no tiene tarifa: se cobra el valor escrito en el viaje (${pesos(f.tarifa)}).` });
  }
  const otras = [...enOtras.entries()];
  if (otras.length) {
    const nums = [...new Set(otras.map(([, n]) => n))];
    avisos.push({ tipo: 'otra', nivel: 'info', texto: `${otras.length} viaje(s) del periodo ya están en ${nums.length === 1 ? 'la relación' : 'las relaciones'} ${nums.join(', ')} y no se vuelven a cobrar.` });
  }
  if (!avisos.some(a => a.nivel === 'aviso')) avisos.push({ tipo: 'ok', nivel: 'ok', texto: `${filas.length} viajes revisados: sin fechas raras, viajes repetidos ni cobros dobles.` });
  return avisos;
}

// ── Base de datos ──────────────────────────────────────────────────────────
// Viajes de la empresa en el periodo (sin anulados ni «[NO FACTURAR]»), del grupo pedido, con su línea de cobro
async function viajesDelPeriodo(empresaId, { cliente, desde, hasta, grupo = '', excluirRelacion = null }) {
  const cli = await Cliente.findOne({ empresa: empresaId, _id: cliente }).lean();
  if (!cli) throw new ErrorHttp(404, 'Empresa (cliente) no encontrada');
  const [viajes, tarifas] = await Promise.all([
    Viaje.find({ empresa: empresaId, cliente, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' }, observaciones: { $not: NO_FACTURAR } })
      .select('numero fecha placa conductor conductorNombre destino codDestino planilla manifiesto soporteInterno cantidad conAuxiliar diasAuxiliar tarifa flete anticipo tarifaRef createdAt registroMasivo facturaCont')
      .populate(pob(empresaId, 'conductor', 'nombres apellido1 apellido2')).lean(),
    Tarifa.find({ empresa: empresaId, cliente }).lean(),
  ]);
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldo = respaldosAuxiliar(tarifas).get(String(cliente));
  const g = txt(grupo).toLowerCase();
  const delGrupo = viajes.filter(v => !g || txt(porId.get(String(v.tarifaRef))?.grupoRelacion).toLowerCase() === g);
  // Viajes que ya están en otra relación guardada: no se cobran dos veces
  const otras = await RelacionCliente.find({ empresa: empresaId, viajes: { $in: delGrupo.map(v => v._id) }, ...(excluirRelacion ? { _id: { $ne: excluirRelacion } } : {}) })
    .select('numero viajes').lean();
  const enOtras = new Map();
  for (const o of otras) for (const id of o.viajes) enOtras.set(String(id), o.numero);
  const filas = delGrupo.filter(v => !enOtras.has(String(v._id))).map(v => {
    const t = porId.get(String(v.tarifaRef));
    const l = lineaLiquidacion(v, t, { respaldo, cliente: cli });
    return { _id: String(v._id), numero: v.numero, fecha: v.fecha, conductor: nombreT(v.conductor) || txt(v.conductorNombre) || '(sin conductor)', placa: v.placa,
      planilla: txt(v.planilla), manifiesto: documentoViaje(v), destino: v.destino, diasAux: v.conAuxiliar ? (Number(v.diasAuxiliar) || l.cantidad) : null,
      tarifa: $(l.totalTarifa), auxiliar: $(l.totalAuxiliar), total: $(l.totalCobrado), reportado: v.createdAt || null,
      origen: v.manifiesto?.estado === 'aceptado' ? 'RNDC' : v.registroMasivo ? 'Registro masivo' : v.soporteInterno?.mc ? 'Soporte interno' : 'Registrado',
      sinTarifa: l.sinTarifa, municipioDistinto: !!(t?.codMunicipio && v.codDestino && soloDigitos(t.codMunicipio) !== soloDigitos(v.codDestino)) };
  });
  // Fechas sospechosas: viajes con fecha hasta 45 días después del periodo, registrados antes de esa fecha
  const sospechosas = await Viaje.find({ empresa: empresaId, cliente, estado: { $ne: 'anulado' }, fecha: { $gt: hasta, $lte: new Date(new Date(hasta).getTime() + 45 * DIA) } })
    .select('placa fecha createdAt').lean();
  return { cliente: cli, filas, enOtras, sospechosas: sospechosas.filter(v => v.createdAt && new Date(v.fecha) - new Date(v.createdAt) > 2 * DIA) };
}

// Vista previa: grupos, totales, revisión y título (no guarda nada)
export async function armar(empresaId, { cliente, desde, hasta, grupo = '', relacion = null }) {
  if (!(desde instanceof Date) || !(hasta instanceof Date) || hasta < desde) throw new ErrorHttp(400, 'Periodo inválido');
  if ((hasta - desde) / DIA > 62) throw new ErrorHttp(400, 'El periodo de una relación es de máximo dos meses');
  const d = await viajesDelPeriodo(empresaId, { cliente, desde, hasta, grupo, excluirRelacion: relacion });
  const grupos = agrupar(d.filas);
  const totales = totalesDe(d.filas);
  const existente = await RelacionCliente.findOne({ empresa: empresaId, cliente, desde, hasta, grupo: txt(grupo) }).select('numero estado').lean();
  return { cliente: { _id: d.cliente._id, nombre: d.cliente.nombre }, desde, hasta, grupo: txt(grupo), titulo: tituloRelacion(d.cliente.nombre, desde, hasta, grupo),
    grupos, totales, revision: revisar({ filas: d.filas, desde, hasta, sospechosas: d.sospechosas, enOtras: d.enOtras }), existente };
}

// Grupos de relación que tiene la empresa en sus tarifas (para el selector)
export async function gruposDe(empresaId, cliente) {
  const l = await Tarifa.distinct('grupoRelacion', { empresa: empresaId, cliente });
  return l.map(txt).filter(Boolean).sort();
}

// Guarda (o actualiza) la relación del periodo. Si ya hay una del mismo periodo y grupo, se actualiza con los viajes de hoy.
export async function guardar(empresaId, { cliente, desde, hasta, grupo = '', titulo = '' }, usuario) {
  const previa = await RelacionCliente.findOne({ empresa: empresaId, cliente, desde, hasta, grupo: txt(grupo) });
  if (previa?.estado === 'facturada') throw new ErrorHttp(409, `La relación ${previa.numero} ya está facturada: reábrala para cambiarla`);
  const a = await armar(empresaId, { cliente, desde, hasta, grupo, relacion: previa?._id || null });
  const viajes = a.grupos.flatMap(g => g.filas.map(f => f._id));
  if (!viajes.length) throw new ErrorHttp(400, 'No hay viajes para relacionar en ese periodo');
  const datos = { viajes, totales: a.totales, titulo: txt(titulo) || a.titulo, actualizadoPor: usuario };
  if (previa) {
    // Ya enviada y cambió: versión nueva en borrador (lo enviado queda guardado y hay que reenviar la nueva)
    const mismos = (x, y) => x.length === y.length && x.map(String).sort().join() === y.map(String).sort().join();
    const cambio = !mismos(previa.viajes, viajes) || $(previa.totales?.total) !== $(a.totales.total) || txt(previa.titulo) !== datos.titulo;
    if (previa.estado === 'enviada' && cambio) { datos.version = (previa.version || 1) + 1; datos.estado = 'borrador'; }
    previa.set(datos); await previa.save();
    return { ...previa.toObject(), nuevaVersion: !!datos.version };
  }
  const cli = await Cliente.findOne({ empresa: empresaId, _id: cliente }).select('nombre siglas').lean();
  const anio = new Date(hasta).getUTCFullYear();
  const sig = siglasCliente(cli);
  const n = await siguiente(empresaId, `relacion:${sig}:${anio}`);
  const rel = await RelacionCliente.create({ empresa: empresaId, numero: `${sig}-${anio}-${String(n).padStart(3, '0')}`, cliente, desde, hasta, grupo: txt(grupo),
    ...datos, token: nuevoToken(), creadoPor: usuario });
  return rel.toObject();
}

export async function listar(empresaId, { cliente = null, estado = '', anio = null } = {}) {
  const f = { empresa: empresaId };
  if (cliente) f.cliente = cliente;
  if (['borrador', 'enviada', 'facturada'].includes(estado)) f.estado = estado;
  if (anio) f.hasta = { $gte: new Date(Date.UTC(anio, 0, 1)), $lt: new Date(Date.UTC(anio + 1, 0, 1)) };
  const l = await RelacionCliente.find(f).select('-viajes').sort({ hasta: -1, createdAt: -1 }).limit(300)
    .populate({ path: 'cliente', select: 'nombre', match: { empresa: empresaId } }).lean();
  return l.map(x => ({ ...x, cliente: x.cliente?.nombre || '', clienteId: x.cliente?._id || null, token: undefined,
    ultimoCorreo: [...(x.envios || [])].reverse().find(e => e.canal === 'correo') || null,
    ultimoWhatsapp: [...(x.envios || [])].reverse().find(e => e.canal === 'whatsapp') || null }));
}

async function cargar(empresaId, id) {
  const rel = await RelacionCliente.findOne({ empresa: empresaId, _id: id });
  if (!rel) throw new ErrorHttp(404, 'Relación no encontrada');
  return rel;
}

// Filas de una relación guardada (sus viajes de hoy, con los valores de hoy), para el detalle y los archivos
export async function contenido(empresaId, rel) {
  const cli = await Cliente.findOne({ empresa: empresaId, _id: rel.cliente }).lean();
  const [viajes, tarifas] = await Promise.all([
    Viaje.find({ empresa: empresaId, _id: { $in: rel.viajes } }).populate(pob(empresaId, 'conductor', 'nombres apellido1 apellido2')).lean(),
    Tarifa.find({ empresa: empresaId, cliente: rel.cliente }).lean(),
  ]);
  const porId = new Map(tarifas.map(t => [String(t._id), t]));
  const respaldo = respaldosAuxiliar(tarifas).get(String(rel.cliente));
  const filas = viajes.filter(v => v.estado !== 'anulado').map(v => { const l = lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo, cliente: cli });
    return { _id: String(v._id), numero: v.numero, fecha: v.fecha, conductor: nombreT(v.conductor) || txt(v.conductorNombre) || '(sin conductor)', placa: v.placa,
      planilla: txt(v.planilla), manifiesto: documentoViaje(v), destino: v.destino, diasAux: v.conAuxiliar ? (Number(v.diasAuxiliar) || l.cantidad) : null,
      tarifa: $(l.totalTarifa), auxiliar: $(l.totalAuxiliar), total: $(l.totalCobrado) }; });
  return { cliente: cli, grupos: agrupar(filas), totales: totalesDe(filas) };
}

export async function detalle(empresaId, id) {
  const rel = (await cargar(empresaId, id)).toObject();
  const c = await contenido(empresaId, rel);
  return { ...rel, cliente: c.cliente?.nombre || '', clienteId: rel.cliente, grupos: c.grupos, totalesHoy: c.totales,
    enlace: rel.token ? enlaceRelacion(rel.token) : '' };
}

// PDF y Excel de la relación. En borrador se generan cada vez; enviada o facturada (o al enviarla: congelar) se sirven
// los guardados de su versión, que se generan una sola vez y no se reemplazan.
export async function archivos(empresaId, relId, { congelar = false, usuario = null } = {}) {
  const rel = (await cargar(empresaId, relId)).toObject();
  const empresa = await Empresa.findById(empresaId).select('+logo +membrete.encabezado').lean();
  const cliente = await Cliente.findOne({ empresa: empresaId, _id: rel.cliente }).lean();
  const nombre = `Relacion_${rel.numero}${(rel.version || 1) > 1 ? `_v${rel.version}` : ''}`;
  let c = null;
  const generar = async (formato) => {
    c ||= await contenido(empresaId, rel);
    const { relacionExcel, relacionPdf } = await import('../reportes/relacionCobro.js');
    const base = { empresa, cliente: c.cliente, rel, grupos: c.grupos, totales: c.totales };
    return formato === 'xlsx' ? relacionExcel(base) : relacionPdf(base);
  };
  if (!congelar && rel.estado === 'borrador') {
    return { rel, cliente, empresa, nombre, guardado: null, xlsx: await generar('xlsx'), pdf: await generar('pdf') };
  }
  const clave = `v${rel.version || 1}`;
  const pdf = await pdfGuardado(empresaId, { tipo: 'relacion-cobro', ref: rel._id, clave, nombre: `${nombre}.pdf`, usuario, generar: () => generar('pdf') });
  const xlsx = await pdfGuardado(empresaId, { tipo: 'relacion-cobro-excel', ref: rel._id, clave, nombre: `${nombre}.xlsx`, usuario, formato: 'xlsx', generar: () => generar('xlsx') });
  return { rel, cliente, empresa, nombre, guardado: pdf, xlsx: xlsx.buffer, pdf: pdf.buffer };
}

const nombreUsuario = async (usuarioId) => txt((await Usuario.findById(usuarioId).select('nombre').lean())?.nombre);

// Correo con la plantilla de la empresa (o la general), con el Excel y el PDF adjuntos
export async function enviarCorreo(empresaId, relId, { para = [], cc = [], asunto = '', cuerpo = '', adjuntos = [] }, usuario) {
  const rel = await cargar(empresaId, relId);
  const a = await archivos(empresaId, relId, { congelar: true, usuario });
  const destinatarios = para.length ? para : a.cliente?.enviosRelaciones?.destinatarios || [];
  if (!destinatarios.length) throw new ErrorHttp(400, 'La empresa no tiene correos para relaciones (Configuración → Correo)');
  const plantilla = { asunto: txt(a.cliente?.enviosRelaciones?.plantilla?.asunto) || PLANTILLA_GENERAL.asunto,
    cuerpo: txt(a.cliente?.enviosRelaciones?.plantilla?.cuerpo) || PLANTILLA_GENERAL.cuerpo };
  const datos = datosPlantilla(rel, { cliente: a.cliente, empresa: a.empresa, usuario: await nombreUsuario(usuario) });
  const { enviarDocumentoRelacion } = await import('../correo.js');
  const r = await enviarDocumentoRelacion(empresaId, { cliente: rel.cliente, documento: rel.numero, usuario,
    para: destinatarios, cc: cc.length ? cc : a.cliente?.enviosRelaciones?.cc || [],
    asunto: txt(asunto) || aplicarPlantilla(plantilla.asunto, datos), cuerpo: txt(cuerpo) || aplicarPlantilla(plantilla.cuerpo, datos),
    archivos: [{ filename: `${a.nombre}.xlsx`, content: a.xlsx, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { filename: `${a.nombre}.pdf`, content: a.pdf, contentType: 'application/pdf' }], adjuntos });
  rel.envios.push({ canal: 'correo', fecha: new Date(), para: destinatarios, estado: r.estado, error: r.error || '', version: rel.version || 1, usuario });
  if (r.estado === 'enviado' && rel.estado === 'borrador') rel.estado = 'enviada';
  await rel.save();
  return { ...r, estado_relacion: rel.estado };
}

// Vista previa del correo (lo que le llega a la empresa) sin enviarlo
export async function previaCorreo(empresaId, relId, usuario) {
  const rel = await cargar(empresaId, relId);
  const cli = await Cliente.findOne({ empresa: empresaId, _id: rel.cliente }).lean();
  const empresa = await Empresa.findById(empresaId).select('nombre rndc.razonSocial').lean();
  const p = { asunto: txt(cli?.enviosRelaciones?.plantilla?.asunto) || PLANTILLA_GENERAL.asunto, cuerpo: txt(cli?.enviosRelaciones?.plantilla?.cuerpo) || PLANTILLA_GENERAL.cuerpo };
  const datos = datosPlantilla(rel, { cliente: cli, empresa, usuario: await nombreUsuario(usuario) });
  return { para: cli?.enviosRelaciones?.destinatarios || [], cc: cli?.enviosRelaciones?.cc || [], asunto: aplicarPlantilla(p.asunto, datos),
    cuerpo: aplicarPlantilla(p.cuerpo, datos), adjuntos: [`Relacion_${rel.numero}.xlsx`, `Relacion_${rel.numero}.pdf`], propia: !!txt(cli?.enviosRelaciones?.plantilla?.cuerpo) };
}

// WhatsApp: un enlace wa.me por contacto de la empresa, con el mensaje listo y el enlace de la relación
export async function prepararWhatsapp(empresaId, relId) {
  const rel = await cargar(empresaId, relId);
  if (!rel.token) { rel.token = nuevoToken(); await rel.save(); }
  const cli = await Cliente.findOne({ empresa: empresaId, _id: rel.cliente }).lean();
  const empresa = await Empresa.findById(empresaId).select('nombre rndc.razonSocial').lean();
  const contactos = (cli?.contactosWhatsapp || []).filter(c => txt(c.celular));
  return { enlace: enlaceRelacion(rel.token), contactos: contactos.map(c => { const numero = numeroWhatsapp(c.celular); const texto = mensajeWhatsapp(rel, c, { cliente: cli, empresa });
    return { nombre: c.nombre, cargo: c.cargo, celular: c.celular, texto, wa: numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : '', error: numero ? '' : 'Celular no válido' }; }),
    sinContactos: !contactos.length };
}
export async function marcarWhatsapp(empresaId, relId, { para = '' }, usuario) {
  // Lo que se compartió por WhatsApp queda guardado (el enlace sirve esa versión)
  await archivos(empresaId, relId, { congelar: true, usuario });
  const rel = await cargar(empresaId, relId);
  rel.envios.push({ canal: 'whatsapp', fecha: new Date(), para: [txt(para)].filter(Boolean), estado: 'enviado', version: rel.version || 1, usuario });
  if (rel.estado === 'borrador') rel.estado = 'enviada';
  await rel.save();
  return { estado: rel.estado, fecha: rel.envios.at(-1).fecha };
}

export async function facturar(empresaId, relId, { factura, fecha = new Date() }, usuario) {
  const rel = await cargar(empresaId, relId);
  if (rel.estado === 'facturada') throw new ErrorHttp(409, 'La relación ya está facturada');
  if (!txt(factura)) throw new ErrorHttp(400, 'Escriba el número de la factura');
  rel.estado = 'facturada'; rel.factura = { numero: txt(factura).toUpperCase(), fecha, usuario };
  await rel.save();
  // La relación facturada queda guardada tal cual (si ya se había enviado esta versión, es el mismo archivo)
  await archivos(empresaId, relId, { usuario });
  return rel.toObject();
}
export async function reabrir(empresaId, relId, { motivo }, usuario) {
  const rel = await cargar(empresaId, relId);
  if (rel.estado !== 'facturada') throw new ErrorHttp(409, 'Solo se reabre una relación facturada');
  if (txt(motivo).length < 10) throw new ErrorHttp(400, 'Escriba el motivo (mínimo 10 letras)');
  rel.reaperturas.push({ fecha: new Date(), motivo: txt(motivo), usuario });
  rel.estado = rel.envios.length ? 'enviada' : 'borrador';
  await rel.save();
  return rel.toObject();
}
export async function eliminar(empresaId, relId) {
  const rel = await cargar(empresaId, relId);
  if (rel.estado !== 'borrador' || rel.envios?.length) throw new ErrorHttp(409, 'Solo se elimina una relación que nunca se ha enviado');
  await RelacionCliente.deleteOne({ empresa: empresaId, _id: rel._id });
  return { numero: rel.numero };
}

// Viajes que están en una relación facturada (no se pueden editar ni eliminar)
export async function bloqueadosPorRelacion(empresaId, ids) {
  const l = await RelacionCliente.find({ empresa: empresaId, estado: 'facturada', viajes: { $in: ids } }).select('numero viajes').lean();
  const m = new Map();
  for (const r of l) for (const v of r.viajes) if (ids.map(String).includes(String(v))) m.set(String(v), r.numero);
  return m;
}
export async function exigirNoFacturado(empresaId, ids) {
  const m = await bloqueadosPorRelacion(empresaId, [].concat(ids));
  if (m.size) throw new ErrorHttp(409, `El viaje está en la relación ${[...new Set(m.values())].join(', ')}, que ya está facturada. Pida que la reabran para cambiarlo.`);
}

// Página pública del enlace: resumen y archivos (anota la apertura)
export async function porToken(token, { anotar = true, agente = '' } = {}) {
  if (!RE_TOKEN.test(String(token || ''))) return null;
  const rel = await RelacionCliente.findOne({ empresa: { $exists: true }, token });
  if (!rel) return null;
  if (anotar && !esVistaPrevia(agente)) { const ahora = new Date(); if (!rel.abierto) rel.abierto = ahora; rel.ultimaApertura = ahora; rel.aperturas = (rel.aperturas || 0) + 1; await rel.save(); }
  return rel;
}
export async function resumenPublico(rel) {
  const [cli, empresa] = await Promise.all([Cliente.findOne({ empresa: rel.empresa, _id: rel.cliente }).select('nombre').lean(),
    Empresa.findById(rel.empresa).select('nombre nit dv rndc.razonSocial').lean()]);
  return { numero: rel.numero, titulo: rel.titulo, cliente: cli?.nombre || '', periodo: periodoTexto(rel.desde, rel.hasta), grupo: grupoTexto(rel.grupo),
    totales: rel.totales, estado: rel.estado, empresa: txt(empresa?.rndc?.razonSocial) || empresa?.nombre || '',
    nit: `${txt(empresa?.nit).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${empresa?.dv ? `-${empresa.dv}` : ''}`, generada: rel.updatedAt, version: rel.version || 1 };
}

// Corrige la fecha de un viaje desde la revisión (solo sin documentos del RNDC aceptados y fuera de relaciones facturadas)
export async function corregirFecha(empresaId, viajeId, fecha) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId });
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.manifiesto?.estado === 'aceptado' || v.remesa?.estado === 'aceptado') throw new ErrorHttp(409, 'El viaje tiene documentos aceptados en el RNDC: corríjalo en Manifiestos');
  await exigirNoFacturado(empresaId, [v._id]);
  const { asegurarMesAbierto } = await import('./cierre.js');
  await asegurarMesAbierto(empresaId, fecha, v.fecha);
  const antes = v.fecha; v.fecha = fecha; await v.save();
  return { numero: v.numero, antes, fecha };
}


