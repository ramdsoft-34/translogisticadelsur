// Registros repetidos en Conductores y terceros, y en Vehículos.
//  - Detección: misma persona con el mismo documento escrito distinto (puntos, ceros a la izquierda), o el mismo nombre
//    completo con documentos muy parecidos (un dígito cambiado, uno de más o de menos: casi siempre un error al digitar).
//  - Para cada registro se cuentan sus relaciones (viajes, manifiestos radicados, vehículos, préstamos, liquidaciones…)
//    y se sugiere cuál conservar: el registrado en el RNDC y con más uso.
//  - Unión: solo cuando el usuario la confirma. Pasa todas las relaciones al registro que se conserva, completa los datos
//    que le falten y deja el otro archivado (no se borra) con la marca «unido a». Queda un registro de la unión.
//  Lo radicado en el RNDC no cambia: el PDF del manifiesto aceptado está guardado y lo enviado (XML) se conserva.
import mongoose from 'mongoose';
import { Tercero, Vehiculo, Viaje, Prestamo, LiquidacionConductor, EnvioWhatsapp, MensajeWhatsapp, ReporteBodega, UnionMaestro } from '../models/index.js';
import { SstColaborador } from '../models/sst.js';
import { ErrorHttp } from '../middleware/auth.js';
import { nombreCompleto, apellidosRepetidos, nombresSinApellidos } from '../utils/nombres.js';
import { alCambiarTercero } from './sincronizarMaestros.js';

const digitos = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const palabrasNombre = (t) => [...new Set(nombreCompleto(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 1))].sort();

// Misma persona por el nombre: el primer nombre y el primer apellido iguales (sin tildes ni mayúsculas).
// Compartir solo los apellidos no basta (hermanos, familiares).
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').trim();
const primerNombre = (t) => norm(nombresSinApellidos(t.nombres, t.apellido1, t.apellido2)).split(/\s+/)[0] || '';
export const mismaPersona = (a, b) => !!primerNombre(a) && primerNombre(a) === primerNombre(b) && !!norm(a.apellido1) && norm(a.apellido1) === norm(b.apellido1);

// Distancia de edición entre dos documentos (cuántos dígitos hay que cambiar, quitar o poner)
export function distancia(a, b) {
  const m = a.length; const n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  const d = prev[n];
  // Dos dígitos vecinos intercambiados (1234 → 1243) cuentan como un solo error
  if (m === n && d === 2) {
    const dif = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
    if (dif.length === 2 && dif[1] === dif[0] + 1 && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]]) return 1;
  }
  return d;
}

/** Grupos de posibles duplicados (puro: recibe las personas ya leídas). */
export function gruposDePersonas(personas) {
  const grupos = []; const usados = new Set();
  // 1) El mismo documento escrito distinto
  const porDoc = new Map();
  for (const t of personas) { const k = digitos(t.numId); if (!k) continue; if (!porDoc.has(k)) porDoc.set(k, []); porDoc.get(k).push(t); }
  for (const l of porDoc.values()) if (l.length > 1) {
    // Con nombres distintos no es la misma persona: a una de las dos le digitaron mal el documento (no se unen)
    grupos.push(l.slice(1).every((t) => mismaPersona(l[0], t)) ? { motivo: 'mismo_documento', certeza: 'alta', registros: l } : { motivo: 'documento_compartido', certeza: 'revisar', registros: l });
    l.forEach((t) => usados.add(String(t._id)));
  }
  // 2) El mismo nombre completo (al menos tres palabras) con documentos casi iguales
  const porNombre = new Map();
  for (const t of personas) {
    const p = palabrasNombre(t);
    if (p.length < 3) continue;
    const k = p.join(' ');
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push(t);
  }
  for (const l of porNombre.values()) {
    if (l.length < 2) continue;
    const resto = l.filter((t) => !usados.has(String(t._id)));
    if (resto.length < 2) continue;
    const docs = resto.map((t) => digitos(t.numId));
    const cerca = resto.length === 2 ? distancia(docs[0], docs[1]) : Math.min(...docs.flatMap((a, i) => docs.slice(i + 1).map((b) => distancia(a, b))));
    grupos.push({ motivo: 'mismo_nombre', certeza: cerca <= 1 ? 'alta' : cerca <= 2 ? 'media' : 'baja', registros: resto });
  }
  return grupos;
}

// Relaciones de cada tercero (conteos en lote: una consulta por tipo de relación)
async function relacionesDe(empresaId, terceros) {
  const ids = terceros.map((t) => t._id);
  const E = new mongoose.Types.ObjectId(String(empresaId));
  const contar = async (Modelo, campo, extra = {}) => new Map((await Modelo.aggregate([
    { $match: { empresa: E, [campo]: { $in: ids }, ...extra } }, { $group: { _id: `$${campo}`, n: { $sum: 1 } } },
  ])).map((x) => [String(x._id), x.n]));
  const docs = terceros.map((t) => t.numId);
  const vehDoc = async (campo) => {
    const m = new Map();
    for (const x of await Vehiculo.aggregate([{ $match: { empresa: E, [`${campo}.numId`]: { $in: docs } } }, { $group: { _id: `$${campo}.numId`, n: { $sum: 1 } } }])) m.set(x._id, x.n);
    return m;
  };
  const [viajes, radicados, titular, habitual, prestamos, liquidaciones, whatsapp, colaborador, propietario, tenedor] = await Promise.all([
    contar(Viaje, 'conductor'), contar(Viaje, 'conductor', { 'manifiesto.estado': 'aceptado' }), contar(Viaje, 'titular'),
    contar(Vehiculo, 'conductorHabitual'), contar(Prestamo, 'conductor'), contar(LiquidacionConductor, 'conductor'),
    contar(EnvioWhatsapp, 'conductor'), contar(SstColaborador, 'tercero'), vehDoc('propietario'), vehDoc('tenedor'),
  ]);
  const ultimo = new Map((await Viaje.aggregate([{ $match: { empresa: E, conductor: { $in: ids } } }, { $group: { _id: '$conductor', f: { $max: '$fecha' } } }])).map((x) => [String(x._id), x.f]));
  return (t) => {
    const k = String(t._id);
    return { viajes: viajes.get(k) || 0, radicados: radicados.get(k) || 0, titular: titular.get(k) || 0, conductorHabitual: habitual.get(k) || 0,
      propietario: propietario.get(t.numId) || 0, tenedor: tenedor.get(t.numId) || 0, prestamos: prestamos.get(k) || 0, liquidaciones: liquidaciones.get(k) || 0,
      whatsapp: whatsapp.get(k) || 0, sst: colaborador.get(k) || 0, ultimoViaje: ultimo.get(k) || null };
  };
}

const registradoRndc = (t) => t.rndc?.estado === 'enviado' && !/^Importado/i.test(t.rndc?.mensaje || '');
// Cuál conservar: registrado en el RNDC, luego más manifiestos radicados, más viajes y más relaciones
function puntaje(t) {
  const r = t.relaciones;
  return (registradoRndc(t) ? 1e9 : 0) + r.radicados * 1e5 + r.viajes * 100 + r.titular + r.conductorHabitual + r.propietario + r.tenedor + r.prestamos + r.liquidaciones + (t.licencia?.numero ? 1 : 0);
}

export async function buscarDuplicados(empresaId) {
  const personas = await Tercero.find({ empresa: empresaId, tipoId: { $ne: 'N' }, unidoA: null })
    .select('tipoId numId nombres apellido1 apellido2 celular licencia roles rndc activo createdAt').lean();
  const grupos = gruposDePersonas(personas);
  const enGrupos = grupos.flatMap((g) => g.registros);
  const rel = enGrupos.length ? await relacionesDe(empresaId, enGrupos) : () => ({});
  const salida = grupos.map((g) => {
    const registros = g.registros.map((t) => ({ ...t, relaciones: rel(t) }));
    registros.sort((a, b) => puntaje(b) - puntaje(a));
    return {
      motivo: g.motivo, certeza: g.certeza, sugerido: String(registros[0]._id),
      registros: registros.map((t) => ({ _id: t._id, tipoId: t.tipoId, numId: t.numId, nombre: nombreCompleto(t), celular: t.celular || '',
        licencia: t.licencia?.numero ? `${t.licencia.categoria || ''} ${t.licencia.numero}`.trim() : '', roles: t.roles || [], activo: t.activo !== false,
        rndc: registradoRndc(t) ? 'registrado' : /^Importado/i.test(t.rndc?.mensaje || '') ? 'importado' : (t.rndc?.estado || 'sin_enviar'), creado: t.createdAt, relaciones: t.relaciones })),
    };
  });
  const orden = { revisar: 0, alta: 1, media: 2, baja: 3 };
  salida.sort((a, b) => orden[a.certeza] - orden[b.certeza] || b.registros.reduce((s, x) => s + x.relaciones.viajes, 0) - a.registros.reduce((s, x) => s + x.relaciones.viajes, 0));
  // Vehículos: la misma placa escrita distinto (con guion o espacios)
  const vehiculos = await Vehiculo.find({ empresa: empresaId }).select('placa').lean();
  const porPlaca = new Map();
  for (const v of vehiculos) { const k = String(v.placa).replace(/[^A-Z0-9]/gi, '').toUpperCase(); if (!porPlaca.has(k)) porPlaca.set(k, []); porPlaca.get(k).push(v.placa); }
  const nombres = await Tercero.find({ empresa: empresaId, tipoId: { $ne: 'N' }, unidoA: null }).select('numId nombres apellido1 apellido2').lean();
  return {
    terceros: salida,
    vehiculos: [...porPlaca.values()].filter((l) => l.length > 1).map((placas) => ({ placas })),
    revisados: { personas: personas.length, vehiculos: vehiculos.length },
    nombresConApellidos: nombres.filter(apellidosRepetidos).map((t) => ({ _id: t._id, numId: t.numId, actual: t.nombres, sugerido: nombresSinApellidos(t.nombres, t.apellido1, t.apellido2), apellidos: [t.apellido1, t.apellido2].filter(Boolean).join(' ') })),
  };
}

// Datos que se completan en el registro conservado si le faltan
const CAMPOS = ['celular', 'telefono', 'direccion', 'codMunicipio', 'correo', 'fechaNacimiento', 'placaPrincipal', 'banco.entidad', 'banco.tipoCuenta', 'banco.cuenta', 'apellido2'];

/** Une `quitar` en `conservar`. Devuelve el resumen de lo movido. Solo personas (no empresas con NIT). */
export async function unirTerceros(empresaId, conservarId, quitarIds, usuarioId) {
  const ids = [...new Set(quitarIds.map(String))].filter((x) => x !== String(conservarId));
  if (!ids.length) throw new ErrorHttp(400, 'Elija al menos un registro para unir');
  const conservar = await Tercero.findOne({ empresa: empresaId, _id: conservarId, unidoA: null });
  if (!conservar) throw new ErrorHttp(404, 'No se encontró el registro que se conserva');
  const quitar = await Tercero.find({ empresa: empresaId, _id: { $in: ids }, unidoA: null });
  if (quitar.length !== ids.length) throw new ErrorHttp(404, 'Algún registro ya no existe o ya fue unido');
  if ([conservar, ...quitar].some((t) => t.tipoId === 'N')) throw new ErrorHttp(400, 'Solo se unen personas (cédula, pasaporte…); las empresas con NIT se manejan por sede');
  // Dos personas distintas con el mismo documento no se unen: se corrige el documento de la que esté mal
  for (const q of quitar) if (!mismaPersona(conservar, q)) {
    throw new ErrorHttp(409, `«${nombreCompleto(q)}» y «${nombreCompleto(conservar)}» no parecen la misma persona: no se unen. Corrija el documento o el nombre del que esté mal.`);
  }
  const antesConservar = conservar.toObject();
  const movidos = {};
  const anotar = (k, r) => { movidos[k] = (movidos[k] || 0) + (r.modifiedCount || 0); };
  for (const q of quitar) {
    // Completar datos que le falten al conservado
    for (const c of CAMPOS) if (!conservar.get(c) && q.get(c)) conservar.set(c, q.get(c));
    if (!conservar.licencia?.numero && q.licencia?.numero) conservar.licencia = q.licencia;
    else if (q.licencia?.vence && conservar.licencia?.numero === q.licencia?.numero && (!conservar.licencia.vence || q.licencia.vence > conservar.licencia.vence)) conservar.licencia.vence = q.licencia.vence;
    conservar.roles = [...new Set([...(conservar.roles || []), ...(q.roles || [])])];
    conservar.placas = [...new Set([...(conservar.placas || []), ...(q.placas || [])])];
    if (q.whatsappAutorizado) conservar.whatsappAutorizado = true;
    const de = { empresa: empresaId };
    anotar('viajes (conductor)', await Viaje.updateMany({ ...de, conductor: q._id }, { $set: { conductor: conservar._id } }));
    anotar('viajes (titular)', await Viaje.updateMany({ ...de, titular: q._id }, { $set: { titular: conservar._id } }));
    anotar('vehículos (conductor habitual)', await Vehiculo.updateMany({ ...de, conductorHabitual: q._id }, { $set: { conductorHabitual: conservar._id } }));
    anotar('vehículos (titular habitual)', await Vehiculo.updateMany({ ...de, titularHabitual: q._id }, { $set: { titularHabitual: conservar._id } }));
    anotar('vehículos (propietario)', await Vehiculo.updateMany({ ...de, 'propietario.numId': q.numId }, { $set: { 'propietario.numId': conservar.numId, 'propietario.tipoId': conservar.tipoId } }));
    anotar('vehículos (tenedor)', await Vehiculo.updateMany({ ...de, 'tenedor.numId': q.numId }, { $set: { 'tenedor.numId': conservar.numId, 'tenedor.tipoId': conservar.tipoId } }));
    anotar('préstamos', await Prestamo.updateMany({ ...de, conductor: q._id }, { $set: { conductor: conservar._id, cedula: conservar.numId } }));
    anotar('liquidaciones de conductor', await LiquidacionConductor.updateMany({ ...de, conductor: q._id }, { $set: { conductor: conservar._id } }));
    anotar('envíos de WhatsApp', await EnvioWhatsapp.updateMany({ ...de, conductor: q._id }, { $set: { conductor: conservar._id } }));
    anotar('mensajes de WhatsApp', await MensajeWhatsapp.updateMany({ ...de, conductor: q._id }, { $set: { conductor: conservar._id } }));
    anotar('cargues de bodega', await ReporteBodega.updateMany({ ...de, 'items.conductor': q._id }, { $set: { 'items.$[x].conductor': conservar._id } }, { arrayFilters: [{ 'x.conductor': q._id }] }));
    // SG-SST: una ficha por persona; si el conservado ya tiene la suya, la del otro queda como está (se informa)
    if (await SstColaborador.exists({ ...de, tercero: conservar._id })) {
      if (await SstColaborador.exists({ ...de, tercero: q._id })) movidos['fichas SG-SST sin unir (ya existe una)'] = (movidos['fichas SG-SST sin unir (ya existe una)'] || 0) + 1;
    } else anotar('fichas SG-SST', await SstColaborador.updateMany({ ...de, tercero: q._id }, { $set: { tercero: conservar._id } }));
  }
  await conservar.save();
  // Los unidos quedan archivados: no salen en listas ni buscadores, pero siguen existiendo (PDF y lo radicado los encuentran)
  await Tercero.updateMany({ empresa: empresaId, _id: { $in: quitar.map((q) => q._id) } }, { $set: { activo: false, unidoA: conservar._id, unidoEn: new Date() } });
  await alCambiarTercero(empresaId, antesConservar, conservar.toObject());
  await UnionMaestro.create({ empresa: empresaId, tipo: 'tercero', conservado: conservar._id, unidos: quitar.map((q) => q._id), usuario: usuarioId,
    antes: { conservado: antesConservar, unidos: quitar.map((q) => q.toObject()) }, movidos });
  return { conservado: { _id: conservar._id, nombre: nombreCompleto(conservar), numId: conservar.numId }, unidos: quitar.map((q) => ({ _id: q._id, numId: q.numId })), movidos };
}

/** Quita de «nombres» los apellidos repetidos (solo de los registros indicados). */
export async function corregirNombres(empresaId, ids) {
  const lista = await Tercero.find({ empresa: empresaId, _id: { $in: ids }, tipoId: { $ne: 'N' } });
  const corregidos = [];
  for (const t of lista) {
    if (!apellidosRepetidos(t)) continue;
    const antes = t.toObject();
    t.nombres = nombresSinApellidos(t.nombres, t.apellido1, t.apellido2);
    await t.save();
    await alCambiarTercero(empresaId, antes, t.toObject());
    corregidos.push({ _id: t._id, numId: t.numId, antes: antes.nombres, despues: t.nombres });
  }
  return corregidos;
}
