// Rastreo GPS con la app Sur Track. Hasta mayo de 2027 el GPS llega al servidor de Cooespatrans
// y Translogística lo consulta por su puerta de integración (/api/integracion, clave compartida).
// El viaje de Translogística es la única fuente: el rastreo es una sección del mismo viaje.
import { env } from '../../config/env.js';
import { Empresa, Viaje, Vehiculo, Tercero, Cliente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';

export const configurado = () => !!(env.surTrack.url && env.surTrack.clave);

async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
  if (!configurado()) throw new ErrorHttp(503, 'El rastreo con Sur Track no está configurado en el servidor');
  let r;
  try {
    r = await fetch(env.surTrack.url + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-integracion-clave': env.surTrack.clave },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(env.surTrack.timeoutMs),
    });
  } catch {
    throw new ErrorHttp(502, 'No se pudo conectar con Sur Track. Intente de nuevo en unos minutos.');
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorHttp(r.status === 409 || r.status === 404 || r.status === 400 ? r.status : 502, datos.mensaje || `Sur Track respondió ${r.status}`);
  return datos;
}

// Caché corta para que varios usuarios mirando el mapa no multipliquen las consultas
const cache = new Map();
async function enCache(clave, ms, fn) {
  const c = cache.get(clave);
  if (c && Date.now() - c.t < ms) return c.v;
  const v = await fn();
  cache.set(clave, { t: Date.now(), v });
  return v;
}
export const limpiarCache = () => cache.clear();

export async function exigirHabilitado(empresaId) {
  const e = await Empresa.findById(empresaId).select('rastreo').lean();
  if (!e?.rastreo?.surTrack) throw new ErrorHttp(403, 'El rastreo con Sur Track no está habilitado para esta empresa');
  if (!configurado()) throw new ErrorHttp(503, 'El rastreo con Sur Track no está configurado en el servidor');
  return e.rastreo;
}

const placaKey = (p) => String(p || '').toUpperCase().replace(/[\s-]/g, '');
const digitos = (v) => String(v || '').replace(/\D/g, '');

// ── Vehículos y conductores de Sur Track → maestros, sin duplicar (placa y cédula) ──
export async function planVehiculos(empresaId) {
  const lista = await llamar('/vehiculos');
  const conPlaca = lista.filter(x => /^[A-Z0-9]{5,6}$/.test(placaKey(x.placa)));
  const placas = conPlaca.map(x => placaKey(x.placa));
  const existentes = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: placas } }).select('placa surTrack').lean()).map(v => [v.placa, v]));
  const cedulas = conPlaca.map(x => digitos(x.cedula)).filter(Boolean);
  const terceros = new Set((await Tercero.find({ empresa: empresaId, numId: { $in: cedulas } }).select('numId').lean()).map(t => t.numId));
  return {
    total: lista.length,
    sinPlaca: lista.filter(x => !conPlaca.includes(x)).map(x => x.nombre),
    items: conPlaca.map(x => {
      const placa = placaKey(x.placa); const v = existentes.get(placa);
      return { choferId: x.choferId, nombre: x.nombre, cedula: digitos(x.cedula), placa,
        vehiculo: !v ? 'crear' : v.surTrack?.choferId === x.choferId ? 'vinculado' : 'vincular',
        conductor: !digitos(x.cedula) ? 'sin_cedula' : terceros.has(digitos(x.cedula)) ? 'existe' : 'crear' };
    }),
  };
}

// Aplica el plan: vincula vehículos existentes, crea los que faltan y crea conductores nuevos por cédula.
// Nunca modifica otros datos de los registros que ya existen.
export async function sincronizarVehiculos(empresaId) {
  const plan = await planVehiculos(empresaId);
  const res = { vehiculosCreados: 0, vehiculosVinculados: 0, conductoresCreados: 0 };
  for (const x of plan.items) {
    let conductor = null;
    if (x.cedula) {
      conductor = await Tercero.findOne({ empresa: empresaId, numId: x.cedula }).select('_id').lean();
      if (!conductor && x.conductor === 'crear') {
        const partes = String(x.nombre || '').trim().split(/\s+/);
        const [nombres, apellido1, apellido2] = partes.length >= 4 ? [partes.slice(0, 2).join(' '), partes[2], partes.slice(3).join(' ')]
          : partes.length === 3 ? [partes[0], partes[1], partes[2]] : [partes[0] || x.nombre, partes[1] || '', ''];
        conductor = await Tercero.create({ empresa: empresaId, tipoId: 'C', numId: x.cedula, nombres: nombres.toUpperCase(),
          apellido1: apellido1.toUpperCase(), apellido2: apellido2.toUpperCase(), roles: ['conductor'] });
        res.conductoresCreados += 1;
      }
    }
    if (x.vehiculo === 'crear') {
      await Vehiculo.create({ empresa: empresaId, placa: x.placa, conductorHabitual: conductor?._id || null, surTrack: { choferId: x.choferId, vinculado: new Date() } });
      res.vehiculosCreados += 1;
    } else if (x.vehiculo === 'vincular') {
      await Vehiculo.updateOne({ empresa: empresaId, placa: x.placa }, { $set: { surTrack: { choferId: x.choferId, vinculado: new Date() } } });
      res.vehiculosVinculados += 1;
    }
  }
  return res;
}

// ── Activar / finalizar el rastreo de un viaje ──
export async function activar(empresaId, viajeId, usuarioId) {
  await exigirHabilitado(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId });
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.estado === 'anulado') throw new ErrorHttp(400, 'Un viaje anulado no se puede rastrear');
  if (v.rastreo?.activo) return v.rastreo;
  const [cond, cli] = await Promise.all([
    v.conductor ? Tercero.findOne({ empresa: empresaId, _id: v.conductor }).select('numId').lean() : null,
    Cliente.findOne({ empresa: empresaId, _id: v.cliente }).select('nombre').lean(),
  ]);
  const r = await llamar('/viajes', { metodo: 'POST', cuerpo: {
    referencia: `tls:${empresaId}:${v._id}`, codigo: `TLS-${v.numero}`, placa: v.placa, cedula: cond?.numId || '',
    valorFlete: Math.max(1, Number(v.flete) || 0), anticipo: Number(v.anticipo) || 0, empresa: cli?.nombre || '',
  } });
  v.rastreo = { activo: true, estado: 'esperando', origen: 'translogistica', externoId: r.viajeId, codigoExterno: r.codigo,
    activado: new Date(), activadoPor: usuarioId, finalizado: null, error: '' };
  await v.save();
  limpiarCache();
  return v.rastreo;
}

export async function finalizar(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId });
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (!v.rastreo?.activo) return v.rastreo;
  // Solo se finaliza en Sur Track lo que se creó desde aquí; lo enlazado desde Cooespatrans lo cierra Cooespatrans
  if (v.rastreo.origen === 'translogistica' && v.rastreo.externoId) {
    try { await llamar(`/viajes/${v.rastreo.externoId}/finalizar`, { metodo: 'POST' }); }
    catch (e) { if (e.status !== 404) throw e; }
  }
  v.rastreo.activo = false; v.rastreo.estado = 'finalizado'; v.rastreo.finalizado = new Date();
  await v.save();
  limpiarCache();
  return v.rastreo;
}

// Enlaza un viaje de Translogística con un viaje que ya se está rastreando en Cooespatrans
export async function enlazar(empresaId, viajeId, externoId) {
  await exigirHabilitado(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId });
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.rastreo?.activo) throw new ErrorHttp(409, 'Este viaje ya tiene rastreo');
  if (await Viaje.exists({ empresa: empresaId, 'rastreo.externoId': String(externoId), 'rastreo.activo': true })) {
    throw new ErrorHttp(409, 'Ese rastreo ya está enlazado con otro viaje');
  }
  const r = await llamar(`/rastreo/${encodeURIComponent(externoId)}`);
  v.rastreo = { activo: true, estado: r.viaje.estado === 'completado' ? 'finalizado' : 'en_ruta', origen: 'cooespatrans',
    externoId: String(externoId), codigoExterno: r.viaje.codigo, activado: new Date(), finalizado: null, error: '' };
  await v.save();
  limpiarCache();
  return v.rastreo;
}

// ── Estado en vivo de la flota de la empresa ──
const kmh = (ms) => Math.round((Number(ms) || 0) * 3.6);   // Sur Track envía la velocidad en m/s

export async function enVivo(empresaId) {
  const conf = await exigirHabilitado(empresaId);
  const [activos, viajesExt] = await Promise.all([
    enCache('activos', 10000, () => llamar('/rastreo/activos')),
    enCache('viajes', 30000, () => llamar(`/viajes?desde=${new Date(Date.now() - 3 * 86400000).toISOString()}`)),
  ]);
  const posicion = new Map(activos.map(a => [String(a.viajeId), a]));
  const estadoExt = new Map(viajesExt.map(x => [x.viajeId, x]));
  const viajes = await Viaje.find({ empresa: empresaId, 'rastreo.activo': true })
    .select('numero fecha placa conductorNombre destino estado cliente rastreo').populate({ path: 'cliente', select: 'nombre', match: { empresa: empresaId } }).lean();
  const limiteSenal = (conf.minutosSinSenal || 10) * 60000;
  const salida = [];
  for (const v of viajes) {
    // Viaje anulado o cumplido: el rastreo se cierra solo
    if (['anulado', 'cumplido'].includes(v.estado)) {
      try { await finalizar(empresaId, v._id); } catch { /* se reintenta en la próxima consulta */ }
      continue;
    }
    const p = posicion.get(v.rastreo.externoId);
    const ext = estadoExt.get(v.rastreo.externoId);
    let estado = v.rastreo.estado;
    if (ext?.estado === 'completado') estado = 'llego';
    else if (p) estado = Date.now() - new Date(p.hora) > limiteSenal ? 'sin_senal' : kmh(p.velocidad) < 3 ? 'detenido' : 'en_ruta';
    else if (ext?.estado === 'aceptado') estado = 'sin_senal';
    else estado = 'esperando';
    const ultima = p ? { lat: p.lat, lng: p.lng, velocidad: kmh(p.velocidad), rumbo: p.rumbo, hora: p.hora } : v.rastreo.ultima?.lat ? v.rastreo.ultima : null;
    // Se guarda la última posición y el estado en el viaje (sirve de respaldo si Sur Track no responde)
    if (p || estado !== v.rastreo.estado) {
      await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { 'rastreo.estado': estado === 'llego' ? 'finalizado' : estado === 'esperando' ? 'esperando' : 'en_ruta', ...(p ? { 'rastreo.ultima': ultima } : {}) } });
    }
    const alertas = [];
    if (estado === 'sin_senal') alertas.push('Sin señal');
    if (ultima && ultima.velocidad > (conf.velocidadMaxima || 80) && estado === 'en_ruta') alertas.push(`Exceso de velocidad: ${ultima.velocidad} km/h`);
    salida.push({ _id: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre, destino: v.destino,
      cliente: v.cliente?.nombre || '', estadoViaje: v.estado, estado, origen: v.rastreo.origen, codigoExterno: v.rastreo.codigoExterno,
      activado: v.rastreo.activado, ultima, alertas, aceptado: ext?.fechaAceptacion || null });
  }
  // Rastreos de Cooespatrans con señal reciente que aún no están enlazados a un viaje de esta empresa
  const enlazados = new Set(viajes.map(v => v.rastreo.externoId));
  const placasEmpresa = new Set((await Vehiculo.find({ empresa: empresaId }).select('placa').lean()).map(v => v.placa));
  const externos = activos
    .filter(a => !enlazados.has(String(a.viajeId)) && Date.now() - new Date(a.hora) < 2 * 3600000)
    .map(a => { const ext = estadoExt.get(String(a.viajeId)); return { externoId: String(a.viajeId), codigo: a.codigo || ext?.codigo || '',
      conductor: a.chofer || ext?.chofer?.nombre || '', placa: ext?.chofer?.placa || '', estado: ext?.estado || '',
      ultima: { lat: a.lat, lng: a.lng, velocidad: kmh(a.velocidad), rumbo: a.rumbo, hora: a.hora } }; })
    .filter(x => !x.placa || placasEmpresa.has(x.placa));
  return { viajes: salida, externos, configuracion: { velocidadMaxima: conf.velocidadMaxima || 80, minutosSinSenal: conf.minutosSinSenal || 10 } };
}

export async function recorrido(empresaId, viajeId) {
  await exigirHabilitado(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('numero placa conductorNombre destino rastreo').lean();
  if (!v?.rastreo?.externoId) throw new ErrorHttp(404, 'Este viaje no tiene rastreo');
  const r = await enCache(`rec:${v.rastreo.externoId}`, 10000, () => llamar(`/rastreo/${encodeURIComponent(v.rastreo.externoId)}`));
  const puntos = r.puntos.map(p => ({ ...p, velocidad: kmh(p.velocidad) }));
  // Kilómetros recorridos (Haversine) y velocidad máxima
  let km = 0;
  for (let i = 1; i < puntos.length; i++) if (!puntos[i].nuevoSegmento) km += distanciaKm(puntos[i - 1], puntos[i]);
  return { viaje: { numero: v.numero, placa: v.placa, conductor: v.conductorNombre, destino: v.destino, codigoExterno: v.rastreo.codigoExterno },
    estadoExterno: r.viaje.estado, ultima: r.ultima ? { ...r.ultima, velocidad: kmh(r.ultima.velocidad) } : null, puntos,
    resumen: { km: Math.round(km * 10) / 10, velocidadMaxima: Math.max(0, ...puntos.map(p => p.velocidad)), puntos: puntos.length,
      inicio: puntos[0]?.hora || null, fin: puntos[puntos.length - 1]?.hora || null } };
}

function distanciaKm(a, b) {
  const R = 6371; const rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
