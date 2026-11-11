// Completa los datos que les faltan a los viajes (sobre todo los importados del Excel, que solo traen el nombre
// corto del conductor y el destino escrito a mano). Solo llena lo que está vacío: nunca cambia un dato ya puesto.
//   · Conductor: la cédula enviada al RNDC en el manifiesto; si no, el nombre escrito entre los conductores de esa
//     placa (otros viajes, conductor habitual, placas del tercero) y, si no, entre todos los conductores. Primero la
//     coincidencia exacta de todas las palabras y después con una letra de diferencia (Sanches → Sánchez). Solo si hay uno.
//   · Titular: el titular enviado en el manifiesto o el titular habitual del vehículo.
//   · Tarifa: la del mismo cliente con el mismo destino (una sola); de ella, el DIVIPOLA del destino si falta.
// Los viajes de una relación de cobro ya facturada no cambian de tarifa.
import mongoose from 'mongoose';
import { Tarifa, Tercero, TransaccionRndc, Vehiculo, Viaje } from '../../models/index.js';
import { variablesEnviadas } from '../rndc/operaciones.js';
import { bloqueadosPorRelacion } from '../gestion/relaciones.js';
import { normalizar, txt } from '../../utils/texto.js';

const palabras = (s) => normalizar(s).split(' ').filter((p) => p.length > 1);
const nombreDe = (t) => [t?.nombres, t?.apellido1, t?.apellido2].filter(Boolean).join(' ');

function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
// La palabra está en el nombre: igual o, si tiene 4 letras o más, con una letra de diferencia
const estaEn = (p, nombre, flexible) => nombre.has(p) || (flexible && p.length >= 4 && [...nombre].some((q) => q.length >= 4 && distancia(p, q) <= 1));

/** El único conductor cuyo nombre contiene todas las palabras escritas (exacto primero, luego flexible). */
export function buscarPorNombre(nombre, candidatos) {
  const buscadas = palabras(nombre);
  if (!buscadas.length) return { elegido: null, opciones: [] };
  const lista = [...new Map(candidatos.filter((t) => t?._id).map((t) => [String(t._id), t])).values()]
    .map((t) => ({ t, s: t._s || new Set(palabras(nombreDe(t))) }));
  let ultimas = [];
  for (const flexible of [false, true]) {
    // En la búsqueda flexible al menos una palabra debe ser exacta (evita cruces al azar y es más rápido)
    const ok = lista.filter((x) => (!flexible || buscadas.some((p) => x.s.has(p))) && buscadas.every((p) => estaEn(p, x.s, flexible))).map((x) => x.t);
    if (ok.length === 1) return { elegido: ok[0], opciones: ok };
    if (ok.length > 1) return { elegido: null, opciones: ok };
    ultimas = ok;
  }
  return { elegido: null, opciones: ultimas };
}

export async function completarViajes(empresaId, { aplicar = false } = {}) {
  const viajes = await Viaje.find({ empresa: empresaId, estado: { $ne: 'anulado' },
    $or: [{ conductor: null }, { titular: null }, { tarifaRef: null }, { codDestino: { $in: ['', null] } }] })
    .select('numero fecha placa cliente destino conductor conductorNombre titular tarifaRef codDestino estado').sort({ numero: 1 }).lean();
  const conductores = (await Tercero.find({ empresa: empresaId, roles: 'conductor' }).select('nombres apellido1 apellido2 numId tipoId placas placaPrincipal').lean())
    .map((t) => Object.assign(t, { _s: new Set(palabras(nombreDe(t))) }));
  const porId = new Map(conductores.map((t) => [String(t._id), t]));
  const placas = [...new Set(viajes.map((v) => v.placa))];
  const vehiculos = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: placas } }).select('placa conductorHabitual titularHabitual').lean()).map((v) => [v.placa, v]));
  const usados = await Viaje.aggregate([{ $match: { empresa: new mongoose.Types.ObjectId(String(empresaId)), placa: { $in: placas }, conductor: { $ne: null } } }, { $group: { _id: '$placa', c: { $addToSet: '$conductor' } } }]);
  const dePlaca = new Map(usados.map((x) => [x._id, x.c.map(String)]));
  const tarifas = await Tarifa.find({ empresa: empresaId }).select('cliente destino codMunicipio').lean();
  const facturados = await bloqueadosPorRelacion(empresaId, viajes.map((v) => v._id));
  const conRndc = new Set((await TransaccionRndc.distinct('viaje', { empresa: empresaId, viaje: { $in: viajes.map((v) => v._id) }, tipo: 1, proceso: 4, ok: true })).map(String));

  const cambios = []; const pendientes = [];
  const cuenta = { conductor: 0, titular: 0, tarifa: 0, codDestino: 0 };
  for (const v of viajes) {
    const set = {}; const falta = [];
    const M = conRndc.has(String(v._id)) ? await variablesEnviadas(empresaId, v._id, 4) : null;
    const veh = vehiculos.get(v.placa);
    let opciones = [];

    if (!v.conductor) {
      const cedula = txt(M?.NUMIDCONDUCTOR);
      let elegido = cedula ? conductores.find((t) => txt(t.numId) === cedula) : null;
      if (!elegido && txt(v.conductorNombre)) {
        const ids = new Set([...(dePlaca.get(v.placa) || []), ...(veh?.conductorHabitual ? [String(veh.conductorHabitual)] : [])]);
        const deLaPlaca = [...[...ids].map((i) => porId.get(i)), ...conductores.filter((t) => (t.placas || []).includes(v.placa) || t.placaPrincipal === v.placa)].filter(Boolean);
        const r1 = buscarPorNombre(v.conductorNombre, deLaPlaca);
        elegido = r1.elegido;
        if (!elegido) { const r2 = buscarPorNombre(v.conductorNombre, conductores); elegido = r2.elegido; opciones = r2.opciones.length ? r2.opciones : r1.opciones; }
      }
      if (elegido) { set.conductor = elegido._id; set.conductorNombre = nombreDe(elegido); cuenta.conductor++; } else falta.push('conductor');
    }

    if (!v.titular) {
      const ced = txt(M?.NUMIDTITULARMANIFIESTO);
      const t = ced ? await Tercero.findOne({ empresa: empresaId, numId: ced }).select('_id').lean() : null;
      const titular = t?._id || veh?.titularHabitual || null;
      if (titular) { set.titular = titular; cuenta.titular++; }
    }

    let tarifa = null;
    if (!v.tarifaRef && !facturados.has(String(v._id))) {
      const destino = normalizar(v.destino);
      const iguales = tarifas.filter((t) => String(t.cliente) === String(v.cliente) && normalizar(t.destino) === destino);
      // Tarifas repetidas con el mismo DIVIPOLA cuentan como una
      if (iguales.length && new Set(iguales.map((t) => t.codMunicipio || '')).size === 1) { tarifa = iguales[0]; set.tarifaRef = tarifa._id; cuenta.tarifa++; }
      else falta.push('tarifa');
    }
    if (!txt(v.codDestino)) {
      const t = tarifa || (v.tarifaRef ? tarifas.find((x) => String(x._id) === String(v.tarifaRef)) : null);
      if (t?.codMunicipio) { set.codDestino = t.codMunicipio; cuenta.codDestino++; } else if (!falta.includes('tarifa')) falta.push('destino');
    }

    if (Object.keys(set).length) cambios.push({ _id: v._id, set });
    if (falta.includes('conductor') || falta.includes('tarifa')) {
      pendientes.push({ _id: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, destino: v.destino, estado: v.estado, conductorNombre: v.conductorNombre || '',
        falta, opciones: opciones.slice(0, 4).map((t) => ({ _id: t._id, nombre: nombreDe(t), numId: t.numId })) });
    }
  }

  if (aplicar && cambios.length) {
    // Solo donde sigue vacío (si alguien lo llenó mientras tanto, se respeta)
    const ops = cambios.flatMap(({ _id, set }) => Object.entries(set).map(([k, val]) => ({
      updateOne: { filter: { empresa: empresaId, _id, ...(k === 'conductorNombre' ? {} : { [k]: k === 'codDestino' ? { $in: ['', null] } : null }) }, update: { $set: { [k]: val } } } })));
    await Viaje.bulkWrite(ops, { ordered: false });
  }
  return { revisados: viajes.length, viajesConCambios: cambios.length, cambios: cuenta, aplicado: !!aplicar, pendientes };
}

/** Pone a mano el conductor de un viaje que no lo tiene (también si ya tiene manifiesto). */
export async function ponerConductor(empresaId, viajeId, conductorId) {
  const t = await Tercero.findOne({ empresa: empresaId, _id: conductorId }).select('_id nombres apellido1 apellido2').lean();
  if (!t) return { ok: false, error: 'El conductor no existe en esta empresa' };
  const r = await Viaje.updateOne({ empresa: empresaId, _id: viajeId, conductor: null }, { $set: { conductor: t._id, conductorNombre: nombreDe(t) } });
  return r.modifiedCount ? { ok: true } : { ok: false, error: 'El viaje ya tiene conductor o no existe' };
}
