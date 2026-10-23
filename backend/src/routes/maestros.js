// Maestros de la empresa: clientes y sus destinos/tarifas, terceros
// (conductores, propietarios, tenedores…), vehículos y el catálogo DIVIPOLA.
import { Router } from 'express';
import mongoose from 'mongoose';
import { Cliente, Tarifa, Tercero, Vehiculo, Municipio, Viaje, Empresa, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar, cambios } from '../services/auditoria.js';
import { normalizar, escaparRegex, quitarTildes } from '../utils/texto.js';
import { clienteSchema, tarifaSchema, terceroSchema, vehiculoSchema } from '../validaciones/maestros.js';
import { variablesTercero, variablesVehiculo, huella } from '../services/rndc/documentos.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const ver = permitir(P.MAESTROS_VER);
const editar = permitir(P.MAESTROS_EDITAR);
const editarTarifas = permitir(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);

const buscar = (q) => new RegExp(escaparRegex(String(q || '').trim()), 'i');
// Igual, pero sin importar tildes ni la eñe («gomez» encuentra «Gómez»)
const VOCALES = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' };
const buscarSinTildes = (q) => new RegExp(escaparRegex(quitarTildes(String(q || '').trim()).toLowerCase())
  .replace(/[aeioun]/g, c => VOCALES[c]), 'i');

// Paginación opcional: con ?pagina=N responde { total, pagina, limite, items };
// sin ella conserva la respuesta de arreglo (búsquedas y listas cortas).
async function listar(req, res, consulta, contar, transformar = (x) => x) {
  if (req.query.pagina === undefined) {
    const lista = await consulta.limit(Math.min(Number(req.query.limite) || 500, 10000));
    return res.json(lista.map(transformar));
  }
  const limite = Math.min(Math.max(Number(req.query.limite) || 50, 1), 200);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);
  const [total, items] = await Promise.all([contar, consulta.skip((pagina - 1) * limite).limit(limite)]);
  res.json({ total, pagina, limite, items: items.map(transformar) });
}

// ── Municipios (catálogo global, solo lectura) ─────────────────────────────
r.get('/municipios', ver, async (req, res) => {
  const q = normalizar(req.query.q || '');
  const filtro = /^\d+$/.test(q) ? { codigo: new RegExp(`^${q}`) } : (q ? { busqueda: new RegExp(escaparRegex(q)) } : {});
  res.json(await Municipio.find(filtro).sort({ nombre: 1 }).limit(30).lean());
});

// ── Clientes ────────────────────────────────────────────────────────────────

r.get('/clientes', ver, async (req, res) => {
  const filtro = deEmpresa(req);
  if (req.query.activos === '1') filtro.activo = true;
  res.json(await Cliente.find(filtro).sort({ nombre: 1 }).lean());
});
r.post('/clientes', editarTarifas, async (req, res) => {
  const c = await Cliente.create({ ...clienteSchema.parse(req.body), empresa: req.empresaId });
  await auditar(req, 'crear_cliente', { entidad: 'Cliente', entidadId: c._id, detalle: { nombre: c.nombre } });
  res.status(201).json(c);
});
r.put('/clientes/:id', editarTarifas, async (req, res) => {
  const d = clienteSchema.partial().parse(req.body);
  const antes = await Cliente.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!antes) throw new ErrorHttp(404, 'Cliente no encontrado');
  const c = await Cliente.findOneAndUpdate(deEmpresa(req, { _id: req.params.id }), { $set: d }, { new: true, runValidators: true });
  await auditar(req, 'editar_cliente', { entidad: 'Cliente', entidadId: c._id, detalle: { cambios: cambios(antes, c.toObject(), Object.keys(d)) } });
  res.json(c);
});

// ── Destinos y tarifas ──────────────────────────────────────────────────────

async function clienteDeEmpresa(req, id) {
  const c = await Cliente.exists(deEmpresa(req, { _id: id }));
  if (!c) throw new ErrorHttp(400, 'El cliente no pertenece a su empresa');
}

r.get('/tarifas', ver, async (req, res) => {
  const filtro = deEmpresa(req);
  if (req.query.cliente) filtro.cliente = req.query.cliente;
  if (req.query.activos === '1') filtro.activo = true;
  const tarifas = await Tarifa.find(filtro).sort({ destino: 1 }).populate(pob(req.empresaId, 'cliente', 'nombre nit')).lean();
  // Nombre de la sede del destinatario (código y nombre, como en el RNDC); sin destinatario = el mismo cliente
  const docDe = (t) => String(t.destinatario?.numId || t.cliente?.nit || '').replace(/\D/g, '');
  const docs = [...new Set(tarifas.filter(t => t.destinatario?.sede).map(docDe).filter(Boolean))];
  const sedes = new Map((docs.length ? await Tercero.find(deEmpresa(req, { numId: { $in: docs }, 'sede.codigo': { $ne: '' } })).select('numId sede codMunicipio').lean() : [])
    .map(s => [`${s.numId}|${s.sede.codigo}`, s]));
  res.json(tarifas.map(t => { const s = t.destinatario?.sede ? sedes.get(`${docDe(t)}|${t.destinatario.sede}`) : null;
    return s ? { ...t, sedeNombre: s.sede.nombre, sedeMunicipio: s.codMunicipio } : t; }));
});
r.post('/tarifas', editarTarifas, async (req, res) => {
  const d = tarifaSchema.parse(req.body);
  await clienteDeEmpresa(req, d.cliente);
  const x = await Tarifa.create({ ...d, empresa: req.empresaId });
  await auditar(req, 'crear_tarifa', { entidad: 'Tarifa', entidadId: x._id, detalle: { destino: x.destino } });
  res.status(201).json(x);
});
r.put('/tarifas/:id', editarTarifas, async (req, res) => {
  const d = tarifaSchema.partial().parse(req.body);
  if (d.cliente) await clienteDeEmpresa(req, d.cliente);
  const antes = await Tarifa.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!antes) throw new ErrorHttp(404, 'Tarifa no encontrada');
  const x = await Tarifa.findOneAndUpdate(deEmpresa(req, { _id: req.params.id }), { $set: d }, { new: true, runValidators: true });
  await auditar(req, 'editar_tarifa', { entidad: 'Tarifa', entidadId: x._id, detalle: { destino: x.destino, cambios: cambios(antes, x.toObject(), Object.keys(d)) } });
  res.json(x);
});

// ── Terceros ────────────────────────────────────────────────────────────────

r.get('/terceros', ver, async (req, res) => {
  const filtro = deEmpresa(req);
  if (req.query.rol) filtro.roles = req.query.rol;
  if (req.query.activos === '1') filtro.activo = true;
  if (req.query.activos === '0') filtro.activo = false;
  if (req.query.rndc === 'importado') filtro['rndc.mensaje'] = /^Importado/i;
  else if (req.query.rndc === 'enviado') { filtro['rndc.estado'] = 'enviado'; filtro['rndc.mensaje'] = { $not: /^Importado/i }; }
  else if (['error', 'sin_enviar'].includes(req.query.rndc)) filtro['rndc.estado'] = req.query.rndc;
  // Cada palabra escrita debe estar en el nombre, los apellidos o el documento («jose castellano»)
  const palabras = String(req.query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (palabras.length) filtro.$and = palabras.map(w => { const re = buscarSinTildes(w); return { $or: [{ nombres: re }, { apellido1: re }, { apellido2: re }, { numId: re }] }; });
  if (req.query.conPlacas === '1' && req.query.pagina === undefined) return res.json(await conductoresConPlacas(req, filtro, !palabras.length));
  await listar(req, res, Tercero.find(filtro).sort({ nombres: 1, apellido1: 1 }), Tercero.countDocuments(filtro), x => x.toJSON());
});
// Conductores con sus placas: la del vehículo donde es conductor habitual y la de su último viaje.
// Sin texto de búsqueda, primero los que manejaron más recientemente.
async function conductoresConPlacas(req, filtro, recientes) {
  const limite = Math.min(Number(req.query.limite) || 20, 50);
  let lista;
  if (recientes) {
    const ult = await Viaje.aggregate([{ $match: { empresa: new mongoose.Types.ObjectId(String(req.empresaId)), conductor: { $ne: null } } },
      { $sort: { fecha: -1, numero: -1 } }, { $group: { _id: '$conductor', fecha: { $first: '$fecha' } } }, { $sort: { fecha: -1 } }, { $limit: limite }]);
    const porId = new Map((await Tercero.find({ ...filtro, _id: { $in: ult.map(x => x._id) } })).map(t => [String(t._id), t]));
    lista = ult.map(x => porId.get(String(x._id))).filter(Boolean);
    if (lista.length < limite) {
      const mas = await Tercero.find({ ...filtro, _id: { $nin: lista.map(t => t._id) } }).sort({ nombres: 1, apellido1: 1 }).limit(limite - lista.length);
      lista = [...lista, ...mas];
    }
  } else {
    lista = await Tercero.find(filtro).sort({ nombres: 1, apellido1: 1 }).limit(limite);
  }
  const ids = lista.map(t => t._id);
  const [habituales, ultimos] = await Promise.all([
    Vehiculo.find(deEmpresa(req, { conductorHabitual: { $in: ids }, activo: { $ne: false } })).select('placa conductorHabitual').lean(),
    Viaje.aggregate([{ $match: { empresa: new mongoose.Types.ObjectId(String(req.empresaId)), conductor: { $in: ids } } },
      { $sort: { fecha: -1, numero: -1 } }, { $group: { _id: '$conductor', placa: { $first: '$placa' }, remolque: { $first: '$remolque' } } }]),
  ]);
  return lista.map(t => {
    const id = String(t._id);
    const placas = [...new Set([...habituales.filter(v => String(v.conductorHabitual) === id).map(v => v.placa),
      ...ultimos.filter(u => String(u._id) === id).map(u => u.placa)].filter(Boolean))];
    const ultimo = ultimos.find(u => String(u._id) === id);
    return { ...t.toJSON(), placas, remolque: ultimo?.remolque || '' };
  });
}

// Nuevo en el RNDC: sedes que ya tiene una empresa (por NIT/cédula) y el código de la próxima sede
r.get('/terceros/sedes', ver, async (req, res) => {
  const numId = String(req.query.numId || '').replace(/\D/g, '');
  if (!numId) throw new ErrorHttp(400, 'Escriba el NIT o la cédula');
  const lista = await Tercero.find(deEmpresa(req, { numId })).select('tipoId numId nombres apellido1 apellido2 sede codMunicipio direccion telefono celular rndc.estado').sort({ 'sede.codigo': 1 }).lean();
  const codigos = lista.filter(t => t.sede?.codigo).map(t => Number(t.sede.codigo)).filter(n => Number.isFinite(n));
  res.json({ sedes: lista, siguiente: String(codigos.length ? Math.max(...codigos) + 1 : 1) });
});
// «Solo mostrar lo que se enviaría»: variables del RNDC sin guardar ni enviar nada
r.get('/terceros/:id', ver, async (req, res) => {
  const x = await Tercero.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!x) throw new ErrorHttp(404, 'Tercero no encontrado');
  res.json(x.toJSON());
});

// Marca como pendiente de sincronizar si cambió lo que se envía al RNDC.
async function estadoSincronizacion(req, doc, armar) {
  const empresa = await Empresa.findById(req.empresaId).lean();
  const h = huella(armar(empresa, doc));
  if (doc.rndc?.hash && doc.rndc.hash !== h && doc.rndc.estado === 'enviado') doc.rndc.estado = 'sin_enviar';
}

r.post('/terceros/vista-rndc', ver, async (req, res) => {
  const d = terceroSchema.parse(req.body);
  res.json({ proceso: 11, variables: variablesTercero(await Empresa.findById(req.empresaId).lean(), d) });
});
r.post('/vehiculos/vista-rndc', ver, async (req, res) => {
  const d = vehiculoSchema.parse(req.body);
  res.json({ proceso: 12, variables: variablesVehiculo(await Empresa.findById(req.empresaId).lean(), d) });
});

r.post('/terceros', editar, async (req, res) => {
  const x = await Tercero.create({ ...terceroSchema.parse(req.body), empresa: req.empresaId });
  await auditar(req, 'crear_tercero', { entidad: 'Tercero', entidadId: x._id, detalle: { numId: x.numId } });
  res.status(201).json(x.toJSON());
});
r.put('/terceros/:id', editar, async (req, res) => {
  const x = await Tercero.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!x) throw new ErrorHttp(404, 'Tercero no encontrado');
  const antes = x.toObject();
  const d = terceroSchema.parse({ ...antes, ...req.body });
  x.set(d);
  await estadoSincronizacion(req, x, variablesTercero);
  await x.save();
  await auditar(req, 'editar_tercero', { entidad: 'Tercero', entidadId: x._id, detalle: { numId: x.numId, cambios: cambios(antes, x.toObject(), Object.keys(req.body)) } });
  res.json(x.toJSON());
});

// ── Vehículos ───────────────────────────────────────────────────────────────

async function validarConductor(req, id) {
  if (!id) return;
  if (!(await Tercero.exists(deEmpresa(req, { _id: id })))) throw new ErrorHttp(400, 'El tercero indicado no pertenece a su empresa');
}

r.get('/vehiculos', ver, async (req, res) => {
  const filtro = deEmpresa(req);
  if (req.query.activos === '1') filtro.activo = true;
  if (req.query.activos === '0') filtro.activo = false;
  if (['vehiculo', 'remolque'].includes(req.query.clase)) filtro.clase = req.query.clase;
  const hoy = new Date(); const pronto = new Date(Date.now() + 30 * 86400000);
  if (req.query.soat === 'vencido') filtro['soat.vence'] = { $ne: null, $lt: hoy };
  if (req.query.soat === 'por_vencer') filtro['soat.vence'] = { $gte: hoy, $lte: pronto };
  if (req.query.soat === 'sin') filtro.$or = [{ 'soat.numero': { $in: ['', null] } }, { 'soat.vence': null }];
  if (req.query.q) filtro.placa = buscar(String(req.query.q).replace(/[\s-]/g, ''));
  await listar(req, res, Vehiculo.find(filtro).sort({ placa: 1 }).populate(pob(req.empresaId, 'conductorHabitual', 'nombres apellido1 apellido2 numId')).lean(),
    Vehiculo.countDocuments(filtro));
});
r.post('/vehiculos', editar, async (req, res) => {
  const d = vehiculoSchema.parse(req.body);
  await validarConductor(req, d.conductorHabitual);
  await validarConductor(req, d.titularHabitual);
  const x = await Vehiculo.create({ ...d, empresa: req.empresaId });
  await auditar(req, 'crear_vehiculo', { entidad: 'Vehiculo', entidadId: x._id, detalle: { placa: x.placa } });
  res.status(201).json(x);
});
r.put('/vehiculos/:id', editar, async (req, res) => {
  const x = await Vehiculo.findOne(deEmpresa(req, { _id: req.params.id }));
  if (!x) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const antes = x.toObject();
  const ref = (k) => (req.body[k] !== undefined ? req.body[k] : (x[k] ? String(x[k]) : null));
  const d = vehiculoSchema.parse({ ...antes, ...req.body, conductorHabitual: ref('conductorHabitual'), titularHabitual: ref('titularHabitual') });
  await validarConductor(req, d.conductorHabitual);
  await validarConductor(req, d.titularHabitual);
  x.set(d);
  await estadoSincronizacion(req, x, variablesVehiculo);
  await x.save();
  await auditar(req, 'editar_vehiculo', { entidad: 'Vehiculo', entidadId: x._id, detalle: { placa: x.placa, cambios: cambios(antes, x.toObject(), Object.keys(req.body)) } });
  res.json(x);
});

// ── Alertas de documentos por vencer (licencias, SOAT, tecnomecánica) ──────
r.get('/alertas', ver, async (req, res) => {
  const limite = new Date(Date.now() + (Number(req.query.dias) || 30) * 86400000);
  const [terceros, vehiculos] = await Promise.all([
    Tercero.find(deEmpresa(req, { activo: true, roles: 'conductor', 'licencia.vence': { $ne: null, $lte: limite } }))
      .select('nombres apellido1 numId licencia').lean(),
    Vehiculo.find(deEmpresa(req, { activo: true, $or: [{ 'soat.vence': { $ne: null, $lte: limite } }, { venceTecnomecanica: { $ne: null, $lte: limite } }] }))
      .select('placa soat venceTecnomecanica').lean(),
  ]);
  const alertas = [];
  for (const x of terceros) alertas.push({ tipo: 'Licencia', referencia: `${x.nombres} ${x.apellido1}`.trim(), vence: x.licencia.vence });
  for (const v of vehiculos) {
    if (v.soat?.vence && v.soat.vence <= limite) alertas.push({ tipo: 'SOAT', referencia: v.placa, vence: v.soat.vence });
    if (v.venceTecnomecanica && v.venceTecnomecanica <= limite) alertas.push({ tipo: 'Tecnomecánica', referencia: v.placa, vence: v.venceTecnomecanica });
  }
  alertas.sort((a, b) => new Date(a.vence) - new Date(b.vence));
  res.json(alertas);
});

// ── Revisión de datos: lo que puede causar rechazos del RNDC o un manifiesto incompleto ──
const nombreT = (t) => [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ');
r.get('/revision', ver, async (req, res) => {
  const dias = 15;
  const pronto = new Date(Date.now() + dias * 86400000);
  const hoy = new Date();
  const items = [];
  // 1. Sedes guardadas con el municipio pero con nombre de un centro poblado de ese municipio
  const sedes = await Tercero.find(deEmpresa(req, { activo: { $ne: false }, codMunicipio: /000$/, 'sede.nombre': { $nin: ['', null] } }))
    .select('tipoId numId nombres apellido1 sede codMunicipio').limit(5000).lean();
  const prefijos = [...new Set(sedes.map(x => x.codMunicipio.slice(0, 5)))];
  const centros = prefijos.length ? await Municipio.find({ codigo: { $in: prefijos.map(p => new RegExp(`^${p}(?!000)`)) } }).select('codigo nombre departamento').lean() : [];
  const porPrefijo = new Map();
  for (const m of centros) {
    const p = m.codigo.slice(0, 5);
    if (!porPrefijo.has(p)) porPrefijo.set(p, []);
    porPrefijo.get(p).push(m);
  }
  for (const t of sedes) {
    const n = normalizar(t.sede.nombre);
    const cp = (porPrefijo.get(t.codMunicipio.slice(0, 5)) || []).find(m => normalizar(m.nombre).startsWith(`${n} `) || normalizar(m.nombre) === n);
    if (cp) items.push({ categoria: 'sede', tipo: 'tercero', id: t._id, tipoId: t.tipoId, numId: t.numId,
      referencia: `${nombreT(t)} · sede ${t.sede.codigo} ${t.sede.nombre}`, problema: `Guardada en el municipio ${t.codMunicipio}; el nombre corresponde al centro poblado ${cp.codigo}`,
      sugerencia: { codigo: cp.codigo, nombre: `${cp.nombre} (${cp.departamento})` } });
  }
  // 2. Terceros importados del Excel sin confirmar con el RNDC (uno por documento)
  const importados = await Tercero.find(deEmpresa(req, { activo: { $ne: false }, 'rndc.mensaje': /^Importado/i }))
    .select('tipoId numId nombres apellido1 apellido2 roles').limit(3000).lean();
  const vistos = new Set();
  for (const t of importados) {
    const k = `${t.tipoId}|${t.numId}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    items.push({ categoria: 'importado', tipo: 'tercero', id: t._id, tipoId: t.tipoId, numId: t.numId,
      referencia: `${nombreT(t)} (${t.tipoId} ${t.numId})`, problema: `Importado del Excel sin confirmar con el RNDC${t.roles?.length ? ` · ${t.roles.join(', ')}` : ''}` });
  }
  // 3. Conductores: licencia faltante, vencida o por vencer
  const conductores = await Tercero.find(deEmpresa(req, { activo: { $ne: false }, roles: 'conductor' }))
    .select('tipoId numId nombres apellido1 apellido2 licencia').limit(5000).lean();
  for (const t of conductores) {
    const l = t.licencia || {};
    const problema = !l.numero ? 'Sin número de licencia' : !l.vence ? 'Sin fecha de vencimiento de la licencia'
      : new Date(l.vence) < hoy ? `Licencia vencida (${new Date(l.vence).toISOString().slice(0, 10)})`
        : new Date(l.vence) <= pronto ? `Licencia vence el ${new Date(l.vence).toISOString().slice(0, 10)}` : '';
    if (problema) items.push({ categoria: 'licencia', tipo: 'tercero', id: t._id, tipoId: t.tipoId, numId: t.numId, referencia: `${nombreT(t)} (${t.tipoId} ${t.numId})`, problema });
  }
  // 4. Vehículos: SOAT faltante, vencido o por vencer y datos del formato del manifiesto
  const vehiculos = await Vehiculo.find(deEmpresa(req, { activo: { $ne: false } })).select('placa soat configuracion pesoVacio marca').limit(5000).lean();
  for (const v of vehiculos) {
    const s = v.soat || {};
    const faltan = [!s.numero && 'N° de póliza SOAT', !s.vence && 'vencimiento del SOAT', !s.aseguradoraNit && 'aseguradora del SOAT',
      !v.configuracion && 'configuración', !(Number(v.pesoVacio) > 0) && 'peso vacío', !v.marca && 'marca'].filter(Boolean);
    const problema = faltan.length ? `Falta: ${faltan.join(', ')}`
      : new Date(s.vence) < hoy ? `SOAT vencido (${new Date(s.vence).toISOString().slice(0, 10)})`
        : new Date(s.vence) <= pronto ? `SOAT vence el ${new Date(s.vence).toISOString().slice(0, 10)}` : '';
    if (problema) items.push({ categoria: 'vehiculo', tipo: 'vehiculo', id: v._id, placa: v.placa, referencia: v.placa, problema });
  }
  res.json({ dias, items });
});

// Corrige en lote el municipio de sedes (p. ej. al centro poblado sugerido en la revisión)
r.post('/revision/sedes', editar, async (req, res) => {
  const cambios = Array.isArray(req.body?.cambios) ? req.body.cambios.slice(0, 500) : [];
  let corregidas = 0;
  for (const c of cambios) {
    if (!/^[a-f0-9]{24}$/i.test(String(c.id)) || !/^\d{8}$/.test(String(c.codMunicipio))) continue;
    if (!(await Municipio.exists({ codigo: c.codMunicipio }))) continue;
    const x = await Tercero.findOne(deEmpresa(req, { _id: c.id })).select('codMunicipio sede').lean();
    if (!x) continue;
    const antes = x.codMunicipio;
    await Tercero.updateOne(deEmpresa(req, { _id: x._id }), { $set: { codMunicipio: c.codMunicipio } });
    corregidas += 1;
    await auditar(req, 'corregir_sede', { entidad: 'Tercero', entidadId: x._id, detalle: { sede: x.sede?.codigo, de: antes, a: c.codMunicipio } });
  }
  res.json({ corregidas });
});

// Placas usadas en viajes que aún no están en el maestro de vehículos.
r.get('/vehiculos-faltantes', ver, async (req, res) => {
  const placas = await Viaje.distinct('placa', deEmpresa(req));
  const existentes = new Set((await Vehiculo.find(deEmpresa(req)).select('placa').lean()).map(v => v.placa));
  res.json(placas.filter(p => !existentes.has(p)));
});

export default r;
