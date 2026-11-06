// Rastreo GPS con la app Sur Track. Hay dos servidores con la misma puerta de integración
// (/api/integracion, clave compartida):
//  - 'app': el servidor de la app nueva, para conductores que ya activaron su cuenta.
//  - 'cooespatrans': el de la app anterior, para los demás (hasta mayo de 2027).
// Cada viaje guarda en rastreo.servidor a cuál se envió. El viaje de Translogística es la única fuente.
import { env } from '../../config/env.js';
import { Empresa, Viaje, Vehiculo, Tercero, Cliente, RecorridoRastreo, LiquidacionConductor } from '../../models/index.js';
import { liquidacionPdf } from '../reportes/liquidacion.js';
import { ErrorHttp } from '../../middleware/auth.js';

const CONFIG = { cooespatrans: () => env.surTrack, app: () => env.surTrackApp };
/** Llamada al backend de la app nueva (planillas, avisos, versión). */
export const llamarApp = (ruta, opciones = {}) => llamar(ruta, { ...opciones, servidor: 'app' });
export const configuradoServidor = (servidor) => { const c = CONFIG[servidor](); return !!(c.url && c.clave); };
export const configurado = () => configuradoServidor('cooespatrans') || configuradoServidor('app');
export const servidorDe = (rastreo) => (rastreo?.servidor === 'app' ? 'app' : 'cooespatrans');
const SERVIDORES = ['app', 'cooespatrans'];

async function llamar(ruta, { metodo = 'GET', cuerpo, servidor = 'cooespatrans', binario = false, archivo = null } = {}) {
  if (!configuradoServidor(servidor)) throw new ErrorHttp(503, 'El rastreo con Sur Track no está configurado en el servidor');
  const conf = CONFIG[servidor]();
  let r;
  try {
    r = await fetch(conf.url + ruta, {
      method: metodo,
      headers: { 'content-type': archivo ? archivo.tipo : 'application/json', 'x-integracion-clave': conf.clave },
      body: archivo ? archivo.datos : cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(conf.timeoutMs),
    });
  } catch {
    throw new ErrorHttp(502, 'No se pudo conectar con Sur Track. Intente de nuevo en unos minutos.');
  }
  if (r.status === 204) return {};
  if (binario && r.ok) return { tipo: r.headers.get('content-type') || 'application/octet-stream', datos: Buffer.from(await r.arrayBuffer()) };
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new ErrorHttp(r.status === 409 || r.status === 404 || r.status === 400 ? r.status : 502, datos.mensaje || datos.error || `Sur Track respondió ${r.status}`);
    e.codigo = datos.codigo || '';
    throw e;
  }
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
// Registro de seguimiento del viaje (historial de monitoreo)
const evento = (tipo, detalle = '') => ({ fecha: new Date(), tipo, detalle });

// Paradas del viaje: «destino» (un punto final) o «clientes» (lista que el conductor ve en Sur Track)
export function normalizarParadas(opciones = {}, viaje) {
  const modalidad = opciones.modalidad === 'clientes' ? 'clientes' : 'destino';
  const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const t = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const destino = opciones.destino || {};
  const clientes = modalidad === 'clientes' ? (opciones.clientes || []).slice(0, 200).map(c => ({
    nombre: t(c.nombre, 120), direccion: t(c.direccion), ciudad: t(c.ciudad, 80), telefono: t(c.telefono, 30), documento: t(c.documento, 20),
    factura: t(c.factura, 40), valor: Math.max(0, Number(c.valor) || 0), lat: num(c.lat), lng: num(c.lng),
    estadoEntrega: 'pendiente', valorRecibido: 0 })).filter(c => c.nombre) : [];
  if (modalidad === 'clientes' && !clientes.length) throw new ErrorHttp(400, 'Agregue al menos un cliente');
  // Con clientes las paradas son los clientes: no se guarda destino
  return { modalidad, clientes,
    destino: modalidad === 'clientes' ? { nombre: '', lat: undefined, lng: undefined } : { nombre: t(destino.nombre || viaje?.destino, 120), lat: num(destino.lat), lng: num(destino.lng) } };
}

// Cuerpo para Sur Track: clientes (la ruta la arma Cooespatrans) o la ruta sugerida hasta el destino
async function paradasParaSurTrack(paradas) {
  if (paradas.modalidad === 'clientes') {
    return { clientes: paradas.clientes.map((c, i) => ({ nombre: c.nombre, direccion: [c.direccion, c.ciudad].filter(Boolean).join(', '), ciudad: c.ciudad,
      telefono: c.telefono, documento: c.documento, factura: c.factura, valor: c.valor, referencia: String(i) })) };
  }
  return { clientes: [], rutaSugerida: null };
}

export async function activar(empresaId, viajeId, usuarioId, opciones = {}) {
  await exigirHabilitado(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId });
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  if (v.estado === 'anulado') throw new ErrorHttp(400, 'Un viaje anulado no se puede rastrear');
  if (v.rastreo?.activo) return v.rastreo;
  const paradas = normalizarParadas(opciones, v);
  if (paradas.modalidad === 'destino' && (paradas.destino.lat === undefined || paradas.destino.lng === undefined)) {
    const g = await geocodificar(paradas.destino.nombre).catch(() => []);
    if (g[0]) Object.assign(paradas.destino, { lat: g[0].lat, lng: g[0].lng });
  }
  const [cond, cli] = await Promise.all([
    v.conductor ? Tercero.findOne({ empresa: empresaId, _id: v.conductor }).select('numId').lean() : null,
    Cliente.findOne({ empresa: empresaId, _id: v.cliente }).select('nombre').lean(),
  ]);
  const cuerpo = {
    referencia: `tls:${empresaId}:${v._id}`, codigo: v.manifiesto?.numero || `V-${v.numero}`, placa: v.placa, cedula: cond?.numId || '',
    valorFlete: Math.max(1, Number(v.flete) || 0), anticipo: Number(v.anticipo) || 0, empresa: cli?.nombre || '',
    ...(await paradasParaSurTrack(paradas)),
  };
  // Conductor con la app nueva activada → servidor nuevo. Si no tiene cuenta, sigue con la app anterior.
  let servidor = 'cooespatrans'; let r = null;
  if (configuradoServidor('app') && cuerpo.cedula) {
    try { r = await llamar('/viajes', { metodo: 'POST', cuerpo, servidor: 'app' }); servidor = 'app'; }
    catch (e) { if (e.codigo !== 'sin_conductor' || !configuradoServidor('cooespatrans')) throw e; }
  }
  r ??= await llamar('/viajes', { metodo: 'POST', cuerpo });
  (r.clientes || []).forEach(x => { const c = paradas.clientes[Number(x.referencia)]; if (c) c.externoId = x.clienteId; });
  v.rastreo = { activo: true, estado: 'esperando', origen: 'translogistica', servidor: servidor === 'app' ? 'app' : '', externoId: r.viajeId, codigoExterno: r.codigo,
    activado: new Date(), activadoPor: usuarioId, finalizado: null, error: '', ...paradas,
    eventos: [evento('activado', paradas.modalidad === 'clientes' ? `Con ${paradas.clientes.length} cliente(s)` : `Destino: ${paradas.destino.nombre || v.destino}`)] };
  await v.save();
  limpiarCache();
  // App nueva: el conductor recibe el manifiesto y la remesa (o el soporte interno) que ya tenga el viaje
  if (servidor === 'app') import('./documentosApp.js').then((m) => m.avisarDocumentosApp(empresaId, v._id)).catch(() => {});
  return v.rastreo;
}

export async function actualizarParadas(empresaId, viajeId, opciones) {
  await exigirHabilitado(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId });
  if (!v?.rastreo?.activo) throw new ErrorHttp(404, 'Este viaje no tiene rastreo activo');
  const paradas = normalizarParadas(opciones, v);
  if (v.rastreo.origen === 'translogistica') {
    const r = await llamar(`/viajes/${v.rastreo.externoId}/clientes`, { metodo: 'PUT', cuerpo: await paradasParaSurTrack(paradas), servidor: servidorDe(v.rastreo) });
    (r.clientes || []).forEach(x => { const c = paradas.clientes[Number(x.referencia)]; if (c) c.externoId = x.clienteId; });
  } else if (paradas.modalidad === 'clientes') {
    throw new ErrorHttp(409, 'Este rastreo viene de Cooespatrans: sus clientes se manejan allá');
  }
  Object.assign(v.rastreo, paradas);
  v.rastreo.eventos.push(evento('paradas', paradas.modalidad === 'clientes' ? `Clientes actualizados (${paradas.clientes.length})` : `Destino: ${paradas.destino.nombre}`));
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
    try { await llamar(`/viajes/${v.rastreo.externoId}/finalizar`, { metodo: 'POST', servidor: servidorDe(v.rastreo) }); }
    catch (e) { if (e.status !== 404) throw e; }
  }
  await guardarRecorrido(empresaId, v).catch(() => { /* si Sur Track no responde, el historial queda con lo último conocido */ });
  v.rastreo.activo = false; v.rastreo.estado = 'finalizado'; v.rastreo.finalizado = new Date();
  v.rastreo.eventos.push(evento('finalizado'));
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
  if (await Viaje.exists({ empresa: empresaId, 'rastreo.externoId': String(externoId), 'rastreo.activo': true, 'rastreo.servidor': { $ne: 'app' } })) {
    throw new ErrorHttp(409, 'Ese rastreo ya está enlazado con otro viaje');
  }
  const r = await llamar(`/rastreo/${encodeURIComponent(externoId)}`);
  v.rastreo = { activo: true, estado: r.viaje.estado === 'completado' ? 'finalizado' : 'en_ruta', origen: 'cooespatrans',
    externoId: String(externoId), codigoExterno: r.viaje.codigo, activado: new Date(), finalizado: null, error: '',
    modalidad: r.clientes?.length ? 'clientes' : 'destino', destino: { nombre: r.clientes?.length ? '' : v.destino },
    clientes: (r.clientes || []).map(c => ({ nombre: c.nombre, direccion: c.direccion, ciudad: c.ciudad, telefono: c.telefono, factura: c.factura,
      valor: c.valor, externoId: c.clienteId, estadoEntrega: c.estadoEntrega, valorRecibido: c.valorRecibido, fechaEntrega: c.fechaEntrega })),
    eventos: [evento('enlazado', `Rastreo ${r.viaje.codigo} de Cooespatrans`)] };
  await v.save();
  limpiarCache();
  return v.rastreo;
}

// ── Estado en vivo de la flota de la empresa ──
const kmh = (ms) => Math.round((Number(ms) || 0) * 3.6);   // Sur Track envía la velocidad en m/s

export async function enVivo(empresaId) {
  const conf = await exigirHabilitado(empresaId);
  const desde = new Date(Date.now() - 3 * 86400000).toISOString();
  const posicion = new Map(); const estadoExt = new Map(); const sinRespuesta = new Set();
  let activos = [];   // los de Cooespatrans sirven para proponer enlaces
  const usados = SERVIDORES.filter(configuradoServidor);
  await Promise.all(usados.map(async (s) => {
    try {
      const [act, ext] = await Promise.all([
        enCache(`activos:${s}`, 10000, () => llamar('/rastreo/activos', { servidor: s })),
        enCache(`viajes:${s}`, 30000, () => llamar(`/viajes?desde=${desde}`, { servidor: s })),
      ]);
      act.forEach(a => posicion.set(`${s}:${a.viajeId}`, a));
      ext.forEach(x => estadoExt.set(`${s}:${x.viajeId}`, x));
      if (s === 'cooespatrans') activos = act;
    } catch (e) {
      if (usados.length === 1) throw e;   // un solo servidor: el error se muestra como antes
      sinRespuesta.add(s);                // con dos, el otro sigue funcionando
    }
  }));
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
    const clave = `${servidorDe(v.rastreo)}:${v.rastreo.externoId}`;
    const p = posicion.get(clave);
    const ext = estadoExt.get(clave);
    let estado = v.rastreo.estado;
    if (sinRespuesta.has(servidorDe(v.rastreo))) { /* sin datos nuevos: queda el último estado guardado */ }
    else if (ext?.estado === 'completado') estado = 'llego';
    else if (p) estado = Date.now() - new Date(p.hora) > limiteSenal ? 'sin_senal' : kmh(p.velocidad) < 3 ? 'detenido' : 'en_ruta';
    else if (ext?.estado === 'aceptado') estado = 'sin_senal';
    else estado = 'esperando';
    const ultima = p ? { lat: p.lat, lng: p.lng, velocidad: kmh(p.velocidad), rumbo: p.rumbo, hora: p.hora } : v.rastreo.ultima?.lat ? v.rastreo.ultima : null;
    const entregados = (v.rastreo.clientes || []).filter(c => c.estadoEntrega && c.estadoEntrega !== 'pendiente').length;
    // Se guarda la última posición y el estado en el viaje (sirve de respaldo si Sur Track no responde)
    const guardado = estado === 'llego' ? 'finalizado' : estado;
    if (p || guardado !== v.rastreo.estado) {
      const nuevos = [];
      if (guardado !== v.rastreo.estado) {
        if (v.rastreo.estado === 'esperando' && guardado !== 'esperando') nuevos.push(evento('inicio', 'El conductor inició el viaje en Sur Track'));
        if (['sin_senal', 'detenido', 'finalizado'].includes(guardado)) nuevos.push(evento(guardado, guardado === 'finalizado' ? 'Viaje completado en Sur Track' : ''));
        else if (guardado === 'en_ruta' && ['sin_senal', 'detenido'].includes(v.rastreo.estado)) nuevos.push(evento('en_ruta', 'Recuperó señal / reanudó la marcha'));
      }
      await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { 'rastreo.estado': guardado, ...(p ? { 'rastreo.ultima': ultima } : {}) },
        ...(nuevos.length ? { $push: { 'rastreo.eventos': { $each: nuevos } } } : {}) });
    }
    const alertas = [];
    if (estado === 'sin_senal') alertas.push('Sin señal');
    if (ultima && ultima.velocidad > (conf.velocidadMaxima || 80) && estado === 'en_ruta') alertas.push(`Exceso de velocidad: ${ultima.velocidad} km/h`);
    salida.push({ _id: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre, destino: v.destino,
      cliente: v.cliente?.nombre || '', estadoViaje: v.estado, estado, origen: v.rastreo.origen, codigoExterno: v.rastreo.codigoExterno,
      activado: v.rastreo.activado, ultima, alertas, aceptado: ext?.fechaAceptacion || null,
      modalidad: v.rastreo.modalidad || 'destino', puntoDestino: v.rastreo.modalidad !== 'clientes' && v.rastreo.destino?.lat ? v.rastreo.destino : null,
      clientes: (v.rastreo.clientes || []).length, entregados });
  }
  // Rastreos de Cooespatrans con señal reciente que aún no están enlazados a un viaje de esta empresa
  const enlazados = new Set(viajes.filter(v => servidorDe(v.rastreo) === 'cooespatrans').map(v => v.rastreo.externoId));
  const placasEmpresa = new Set((await Vehiculo.find({ empresa: empresaId }).select('placa').lean()).map(v => v.placa));
  const externos = activos
    .filter(a => !enlazados.has(String(a.viajeId)) && Date.now() - new Date(a.hora) < 2 * 3600000)
    .map(a => { const ext = estadoExt.get(`cooespatrans:${a.viajeId}`); return { externoId: String(a.viajeId), codigo: a.codigo || ext?.codigo || '',
      conductor: a.chofer || ext?.chofer?.nombre || '', placa: ext?.chofer?.placa || '', estado: ext?.estado || '',
      ultima: { lat: a.lat, lng: a.lng, velocidad: kmh(a.velocidad), rumbo: a.rumbo, hora: a.hora } }; })
    .filter(x => !x.placa || placasEmpresa.has(x.placa));
  return { viajes: salida, externos, configuracion: { velocidadMaxima: conf.velocidadMaxima || 80, minutosSinSenal: conf.minutosSinSenal || 10 } };
}

export async function recorrido(empresaId, viajeId) {
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('numero fecha placa conductorNombre destino estado rastreo').lean();
  if (!v?.rastreo?.externoId) throw new ErrorHttp(404, 'Este viaje no tiene rastreo');
  // Rastreo terminado: se lee lo guardado en Translogística (no depende de Sur Track)
  if (!v.rastreo.activo) {
    const g = await RecorridoRastreo.findOne({ empresa: empresaId, viaje: v._id }).lean();
    const puntos = (g?.puntos || []).map(([lat, lng, velocidad, t]) => ({ lat, lng, velocidad, hora: new Date(t) }));
    return { viaje: datosViaje(v), estadoExterno: 'completado', ultima: null, puntos, clientes: v.rastreo.clientes || [],
      ruta: (g?.ruta || []).map(([lat, lng]) => ({ lat, lng })), destino: v.rastreo.modalidad !== 'clientes' && v.rastreo.destino?.lat ? v.rastreo.destino : null,
      resumen: v.rastreo.resumen?.puntos !== undefined ? v.rastreo.resumen : resumenDe(puntos), eventos: v.rastreo.eventos || [], modalidad: v.rastreo.modalidad || 'destino' };
  }
  await exigirHabilitado(empresaId);
  const servidor = servidorDe(v.rastreo);
  const r = await enCache(`rec:${servidor}:${v.rastreo.externoId}`, 10000, () => llamar(`/rastreo/${encodeURIComponent(v.rastreo.externoId)}`, { servidor }));
  const puntos = r.puntos.map(p => ({ ...p, velocidad: kmh(p.velocidad) }));
  const clientes = await sincronizarEntregas(empresaId, v, r.clientes || []);
  const ultima = r.ultima ? { ...r.ultima, velocidad: kmh(r.ultima.velocidad) } : null;
  // Ruta: la de Sur Track (con clientes la arma Cooespatrans); solo destino → ruta sugerida desde la posición actual
  let ruta = r.ruta?.coordenadas || [];
  const destino = v.rastreo.modalidad !== 'clientes' && v.rastreo.destino?.lat ? v.rastreo.destino : null;
  if ((v.rastreo.modalidad || 'destino') === 'destino' && destino) {
    const desde = ultima || puntos[puntos.length - 1] || null;
    if (desde) ruta = (await rutaSugerida([desde, destino]).catch(() => null))?.coordenadas || ruta;
  }
  return { viaje: datosViaje(v), estadoExterno: r.viaje.estado, ultima, puntos, clientes, ruta, destino,
    resumen: resumenDe(puntos), eventos: v.rastreo.eventos || [], modalidad: v.rastreo.modalidad || 'destino' };
}

const datosViaje = (v) => ({ numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre, destino: v.destino,
  codigoExterno: v.rastreo.codigoExterno, estado: v.estado, rastreo: v.rastreo.estado, activado: v.rastreo.activado, finalizado: v.rastreo.finalizado });

// Kilómetros recorridos (Haversine) y velocidad máxima
function resumenDe(puntos) {
  let km = 0;
  for (let i = 1; i < puntos.length; i++) if (!puntos[i].nuevoSegmento) km += distanciaKm(puntos[i - 1], puntos[i]);
  return { km: Math.round(km * 10) / 10, velocidadMaxima: Math.max(0, ...puntos.map(p => p.velocidad || 0)), puntos: puntos.length,
    inicio: puntos[0]?.hora || null, fin: puntos[puntos.length - 1]?.hora || null };
}

// Estado de entrega que marca el conductor en Sur Track → clientes del viaje (y su registro de seguimiento)
async function sincronizarEntregas(empresaId, v, externos) {
  const actuales = v.rastreo.clientes || [];
  if (!externos.length) return actuales;
  const nuevos = []; let cambio = false;
  const lista = actuales.length ? actuales.map(c => ({ ...c })) : externos.map(e => ({ nombre: e.nombre, direccion: e.direccion, ciudad: e.ciudad,
    telefono: e.telefono, factura: e.factura, valor: e.valor, externoId: e.clienteId, estadoEntrega: 'pendiente', valorRecibido: 0 }));
  if (!actuales.length) cambio = true;
  for (const c of lista) {
    const e = externos.find(x => x.clienteId === c.externoId) || externos.find(x => x.nombre === c.nombre);
    if (!e) continue;
    const det = e.entrega ? { lat: e.entrega.lugar?.lat, lng: e.entrega.lugar?.lng, aproximada: !!e.entrega.lugar?.aproximada,
      observacion: e.entrega.observacion || '', fotos: (e.entrega.fotos || []).map(rutaFoto), conductor: e.entrega.conductor || '' } : null;
    const nuevoEstado = e.estadoEntrega !== c.estadoEntrega;
    if (!nuevoEstado && JSON.stringify(det || null) === JSON.stringify(c.entrega || null)) continue;
    Object.assign(c, { estadoEntrega: e.estadoEntrega, valorRecibido: e.valorRecibido || 0, fechaEntrega: e.fechaEntrega || c.fechaEntrega || new Date(), ...(det ? { entrega: det } : {}) });
    if (nuevoEstado) nuevos.push(evento('entrega', `${c.nombre}: ${e.estadoEntrega}${det?.observacion ? ` — ${det.observacion}` : ''}`));
    cambio = true;
  }
  if (cambio) await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { 'rastreo.clientes': lista }, ...(nuevos.length ? { $push: { 'rastreo.eventos': { $each: nuevos } } } : {}) });
  if (nuevos.length && !v.save) v.rastreo.eventos = [...(v.rastreo.eventos || []), ...nuevos];   // objeto plano: se refleja en la respuesta
  return lista;
}

// Las fotos de la app nueva son privadas: se guardan como ruta de Translogística, que las trae con la clave.
// Las de Cooespatrans son enlaces públicos y quedan igual.
export const RUTA_FOTOS = '/api/rastreo/fotos/';
const rutaFoto = (url) => {
  const m = String(url || '').match(/\/api\/integracion\/fotos\/([a-f0-9]{24})$/i);
  return m ? RUTA_FOTOS + m[1] : url;
};

export async function foto(empresaId, fotoId) {
  if (!/^[a-f0-9]{24}$/i.test(String(fotoId))) throw new ErrorHttp(400, 'Foto no válida');
  if (!await Viaje.exists({ empresa: empresaId, 'rastreo.clientes.entrega.fotos': RUTA_FOTOS + fotoId })) throw new ErrorHttp(404, 'Foto no encontrada');
  return llamar(`/fotos/${fotoId}`, { servidor: 'app', binario: true });
}

// Guarda el recorrido y el resumen en Translogística al terminar el rastreo
async function guardarRecorrido(empresaId, v) {
  if (!v.rastreo?.externoId || !configuradoServidor(servidorDe(v.rastreo))) return;
  const r = await llamar(`/rastreo/${encodeURIComponent(v.rastreo.externoId)}`, { servidor: servidorDe(v.rastreo) });
  const puntos = r.puntos.map(p => ({ ...p, velocidad: kmh(p.velocidad) }));
  await sincronizarEntregas(empresaId, v.toObject ? v.toObject() : v, r.clientes || []);
  const fresco = await Viaje.findOne({ empresa: empresaId, _id: v._id }).select('rastreo.clientes').lean();
  if (fresco?.rastreo?.clientes) v.rastreo.clientes = fresco.rastreo.clientes;
  await RecorridoRastreo.updateOne({ empresa: empresaId, viaje: v._id }, { $set: {
    puntos: puntos.map(p => [p.lat, p.lng, p.velocidad, new Date(p.hora).getTime()]),
    ruta: (r.ruta?.coordenadas || []).map(c => [c.lat, c.lng]) } }, { upsert: true });
  v.rastreo.resumen = resumenDe(puntos);
}

// ── Mapas: ruta sugerida (OSRM del servidor) y búsqueda de direcciones (Nominatim de OpenStreetMap) ──
export async function rutaSugerida(puntos) {
  const validos = puntos.filter(p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)));
  if (validos.length < 2) return null;
  const coords = validos.slice(0, 25).map(p => `${Number(p.lng)},${Number(p.lat)}`).join(';');
  return enCache(`ruta:${coords.replace(/(\.\d{3})\d+/g, '$1')}`, 120000, async () => {
    const r = await fetch(`${env.mapas.osrmUrl}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    if (d.code !== 'Ok' || !d.routes?.[0]) return null;
    return { coordenadas: d.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distancia: Math.round(d.routes[0].distance), duracion: Math.round(d.routes[0].duration) };
  });
}

let ultimaBusqueda = 0;
export async function geocodificar(texto) {
  const q = String(texto || '').trim().slice(0, 200);
  if (q.length < 3) return [];
  return enCache(`geo:${q.toLowerCase()}`, 24 * 3600000, async () => {
    // Política de uso de Nominatim: máximo una consulta por segundo e identificación de la aplicación
    const espera = 1100 - (Date.now() - ultimaBusqueda);
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimaBusqueda = Date.now();
    const url = `${env.mapas.nominatimUrl}/search?format=jsonv2&limit=5&countrycodes=co&accept-language=es&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'Translogistica del Sur (translogisticadelsur.com)' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    return (await r.json()).map(x => ({ nombre: x.display_name, lat: Number(x.lat), lng: Number(x.lon) }));
  });
}

// ── Historial de monitoreo: viajes rastreados con sus datos y registro de seguimiento ──
// Solo viajes con el rastreo ya terminado (los activos se ven en «En vivo»)
export async function historial(empresaId, f = {}) {
  const filtro = { empresa: empresaId, 'rastreo.activado': { $ne: null }, 'rastreo.activo': false };
  if (f.desde || f.hasta) filtro['rastreo.finalizado'] = { ...(f.desde ? { $gte: f.desde } : {}), ...(f.hasta ? { $lte: f.hasta } : {}) };
  if (f.placa) filtro.placa = String(f.placa).toUpperCase().replace(/[\s-]/g, '');
  if (f.conductor) filtro.conductor = f.conductor;
  if (f.modalidad) filtro['rastreo.modalidad'] = f.modalidad;
  const limite = Math.min(Math.max(Number(f.limite) || 50, 1), 200);
  const pagina = Math.max(Number(f.pagina) || 1, 1);
  const [total, viajes] = await Promise.all([
    Viaje.countDocuments(filtro),
    Viaje.find(filtro).sort({ 'rastreo.finalizado': -1, 'rastreo.activado': -1 }).skip((pagina - 1) * limite).limit(limite)
      .select('numero fecha placa conductor conductorNombre destino estado cliente rastreo.activo rastreo.estado rastreo.origen rastreo.modalidad rastreo.activado rastreo.finalizado rastreo.codigoExterno rastreo.resumen rastreo.clientes rastreo.destino')
      .populate({ path: 'cliente', select: 'nombre', match: { empresa: empresaId } }).lean(),
  ]);
  return { total, pagina, limite, items: viajes.map(v => ({ _id: v._id, numero: v.numero, fecha: v.fecha, placa: v.placa, conductor: v.conductorNombre,
    cliente: v.cliente?.nombre || '', destino: v.rastreo.modalidad === 'clientes' ? '' : (v.rastreo.destino?.nombre || v.destino), estadoViaje: v.estado, activo: v.rastreo.activo,
    estado: v.rastreo.estado, origen: v.rastreo.origen, modalidad: v.rastreo.modalidad || 'destino', activado: v.rastreo.activado,
    finalizado: v.rastreo.finalizado, codigoExterno: v.rastreo.codigoExterno, km: v.rastreo.resumen?.km ?? null,
    clientes: (v.rastreo.clientes || []).length, entregados: (v.rastreo.clientes || []).filter(c => c.estadoEntrega && c.estadoEntrega !== 'pendiente').length })) };
}

function distanciaKm(a, b) {
  const R = 6371; const rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Checklist preoperacional diario del conductor (lo diligencia en Sur Track) ──
// La asignación del viaje no lo exige; Sur Track no deja iniciar el viaje sin el checklist del día.
// Se busca en el servidor del viaje; si el viaje aún no tiene rastreo, primero en la app nueva y luego en la anterior.
export async function checklistDelViaje(empresaId, viajeId, { conFirma = false } = {}) {
  await exigirHabilitado(empresaId);
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId }).select('numero placa conductor conductorNombre rastreo.servidor rastreo.externoId').lean();
  if (!v) throw new ErrorHttp(404, 'Viaje no encontrado');
  const cond = v.conductor ? await Tercero.findOne({ empresa: empresaId, _id: v.conductor }).select('numId').lean() : null;
  const orden = v.rastreo?.externoId ? [servidorDe(v.rastreo)] : SERVIDORES.filter(configuradoServidor);
  let r = null; let servidor = orden[0]; let error = null;
  for (const s of orden) {
    try {
      const x = await llamar(`/checklist?cedula=${encodeURIComponent(cond?.numId || '')}&placa=${encodeURIComponent(v.placa || '')}`, { servidor: s });
      r = x; servidor = s; error = null;
      if (x.checklist) break;   // sin checklist aquí: se prueba en el otro servidor
    } catch (e) { if (e.status !== 404) throw e; error ??= e; }
  }
  if (!r) throw error || new ErrorHttp(404, 'El conductor no está registrado en Sur Track');
  let checklist = r.checklist;
  if (checklist && conFirma) checklist = (await llamar(`/checklist/${checklist.checklistId}`, { servidor })).checklist;
  return { viaje: { numero: v.numero, placa: v.placa, conductor: v.conductorNombre }, conductor: r.chofer, checklist, servidor };
}

// La oficina autoriza la salida con un preoperacional No apto (solo app nueva). Queda quién y por qué.
export async function autorizarNoApto(empresaId, viajeId, usuario, motivo) {
  const d = await checklistDelViaje(empresaId, viajeId);
  if (d.servidor !== 'app' || !d.checklist) throw new ErrorHttp(409, 'Este preoperacional no se puede autorizar desde aquí');
  if (d.checklist.resultado !== 'no_apto') throw new ErrorHttp(409, 'Solo se autoriza un preoperacional No apto');
  const checklist = await llamar(`/checklist/${d.checklist.checklistId}/autorizar`, { metodo: 'POST', servidor: 'app',
    cuerpo: { por: String(usuario.nombre || usuario.email).slice(0, 120), motivo } });
  return { ...d, checklist };
}

// ── Cuentas de conductores en la app nueva (invitar con un código que la oficina le entrega) ──
async function conductorDe(empresaId, terceroId) {
  if (!configuradoServidor('app')) throw new ErrorHttp(503, 'La app de conductores no está configurada en el servidor');
  const t = await Tercero.findOne({ empresa: empresaId, _id: terceroId });
  if (!t) throw new ErrorHttp(404, 'Tercero no encontrado');
  if (!(t.roles || []).includes('conductor')) throw new ErrorHttp(400, 'Solo los conductores usan la app');
  if (digitos(t.numId).length < 5) throw new ErrorHttp(400, 'El conductor no tiene un número de documento válido');
  return t;
}

export async function cuentaApp(empresaId, terceroId) {
  const t = await conductorDe(empresaId, terceroId);
  const [c] = await llamar(`/conductores?empresaId=${empresaId}&cedulas=${digitos(t.numId)}`, { servidor: 'app' });
  return { estado: c?.estado || 'sin_cuenta', correo: c?.email || '', invitacionVence: c?.invitacionVence || null, correoTercero: t.correo || '' };
}

export async function invitarApp(empresaId, terceroId, correo) {
  const t = await conductorDe(empresaId, terceroId);
  const email = String(correo || t.correo || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorHttp(400, 'Escriba el correo del conductor');
  const empresa = await Empresa.findById(empresaId).select('nombre').lean();
  const nombre = [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ').trim();
  const r = await llamar('/conductores/invitar', { metodo: 'POST', servidor: 'app', cuerpo: {
    empresaId: String(empresaId), empresaNombre: empresa?.nombre || 'Empresa', terceroId: String(t._id),
    cedula: digitos(t.numId), nombre: nombre.length >= 3 ? nombre : `Conductor ${digitos(t.numId)}`, email } });
  if (!t.correo) { t.correo = email; await t.save(); }   // se guarda si el tercero no tenía correo
  // Sus liquidaciones del último año quedan en la app desde el primer día
  await enviarPendientesConductor(empresaId, digitos(t.numId), { desdeMeses: 12 }).catch(() => undefined);
  return { estado: r.estado, codigo: r.codigo, vence: r.vence, correo: email };
}

export async function desvincularApp(empresaId, terceroId) {
  const t = await conductorDe(empresaId, terceroId);
  try { await llamar('/conductores/desvincular', { metodo: 'POST', servidor: 'app', cuerpo: { empresaId: String(empresaId), cedula: digitos(t.numId) } }); }
  catch (e) { if (e.status !== 404) throw e; }
  return { estado: 'sin_cuenta' };
}

// ── Pago a conductores en la app nueva ──
// Cada liquidación de un solo conductor se envía con su PDF al crearla, al pagarla (abonos) y al anularla.
// Si la app no responde, queda pendiente y se reenvía con el siguiente envío del mismo conductor.
// Nunca bloquea la operación de la oficina.
async function appHabilitada(empresaId) {
  if (!configuradoServidor('app')) return false;
  const e = await Empresa.findById(empresaId).select('rastreo').lean();
  return !!e?.rastreo?.surTrack;
}

const valor = (n) => Math.round(Number(n) || 0);

async function enviarUna(empresaId, l, empresa) {
  const cuerpo = {
    cedula: l.cedula, fecha: l.fecha, desde: l.desde || null, hasta: l.hasta || null, placa: l.placa || '', estado: l.estado,
    flete: valor(l.flete), auxiliar: valor(l.auxiliar), anticipo: valor(l.anticipoReconocido ?? l.anticipo), retefuente: valor(l.retefuente),
    fopat: valor(l.fopat), descuentoPrestamos: valor(l.descuentoPrestamos), neto: valor(l.neto), pagado: valor(l.pagado),
    lineas: (l.lineas || []).slice(0, 500).map(x => ({ fecha: x.fecha || null, placa: x.placa || '', empresa: x.empresa || '', destino: x.destino || '',
      manifiesto: x.manifiesto || '', flete: valor(x.flete), auxiliar: valor(x.auxiliar), anticipo: valor(x.anticipoReconocido ?? x.anticipo),
      retefuente: valor(x.retefuente), fopat: valor(x.fopat),
      // Igual que el PDF: saldo de cada viaje = flete + auxiliar - anticipo reconocido (las retenciones van en el resumen)
      saldo: valor(x.flete) + valor(x.auxiliar) - valor(x.anticipoReconocido ?? x.anticipo) })),
  };
  const ruta = `/pagos/${empresaId}/${encodeURIComponent(l.numero)}`;
  try {
    await llamar(ruta, { metodo: 'PUT', cuerpo, servidor: 'app' });
  } catch (e) {
    if (e.codigo === 'sin_conductor') return 'sin_cuenta';   // el conductor no usa la app nueva: no hay nada que reenviar
    throw e;
  }
  await llamar(`${ruta}/pdf`, { metodo: 'PUT', servidor: 'app', archivo: { tipo: 'application/pdf', datos: await liquidacionPdf(empresa, l) } });
  await LiquidacionConductor.updateOne({ empresa: empresaId, _id: l._id }, { $set: { appEnviada: new Date() } }, { timestamps: false });
  return 'enviada';
}

// Pendientes de un conductor: nunca enviadas o cambiadas después del último envío
export async function enviarPendientesConductor(empresaId, cedula, { desdeMeses = 12, limite = 50 } = {}) {
  if (!cedula || !await appHabilitada(empresaId)) return { enviadas: 0 };
  const lista = await LiquidacionConductor.find({ empresa: empresaId, cedula, fecha: { $gte: new Date(Date.now() - desdeMeses * 31 * 86400000) },
    $or: [{ appEnviada: null }, { $expr: { $gt: ['$updatedAt', '$appEnviada'] } }] }).sort({ fecha: 1 }).limit(limite).lean();
  if (!lista.length) return { enviadas: 0 };
  const empresa = await Empresa.findById(empresaId).select('+logo').lean();
  let enviadas = 0;
  for (const l of lista) {
    if (await enviarUna(empresaId, l, empresa) === 'sin_cuenta') break;
    enviadas += 1;
  }
  return { enviadas };
}

// Llamada después de liquidar, pagar o anular. Los errores solo quedan en el registro del servidor.
export async function avisarLiquidacion(empresaId, numero) {
  try {
    const l = await LiquidacionConductor.findOne({ empresa: empresaId, numero }).select('cedula').lean();
    if (l?.cedula) await enviarPendientesConductor(empresaId, l.cedula);
  } catch (e) {
    console.warn(`No se pudo enviar la liquidación ${numero} a la app de conductores: ${e.message}`);
  }
}
