// Maestros de la empresa: clientes y sus destinos/tarifas, terceros
// (conductores, propietarios, tenedores…), vehículos y el catálogo DIVIPOLA.
import { Router } from 'express';
import { paginacion } from '../utils/paginacion.js';
import { elegirSedeMunicipio } from '../services/gestion/sedeMunicipio.js';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Cliente, Tarifa, Tercero, Vehiculo, Municipio, Viaje, Empresa, Liquidacion, FacturaCont, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar, cambios } from '../services/auditoria.js';
import { normalizar, escaparRegex, quitarTildes } from '../utils/texto.js';
import { clienteSchema, tarifaSchema, terceroSchema, vehiculoSchema } from '../validaciones/maestros.js';
import { variablesTercero, variablesVehiculo, huella, idCliente } from '../services/rndc/documentos.js';
import { documentosPorVencer } from '../services/sst/vencimientos.js';
import { reglasDe, pesoPorTamano } from '../services/gestion/reglas.js';
import { sincronizarDestinoViajes } from '../services/gestion/sincronizarDestino.js';

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
  // El total solo se cuenta en la primera página: al pasar de página el navegador ya lo tiene
  const p = paginacion(req.query, { porDefecto: 50, maximo: 200, minimo: 1 });
  const [total, items] = await Promise.all([p.contar ? contar : null, consulta.skip(p.salto).limit(p.limite)]);
  res.json({ total, pagina: p.pagina, limite: p.limite, items: items.map(transformar) });
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
// El cliente es la empresa remitente: al crearlo se registra también su sede principal (lugar de cargue)
// como tercero del RNDC, si ese NIT aún no tiene sedes en la plataforma.
const sedeNueva = z.object({ nombre: z.string().trim().max(20).optional().default(''), direccion: z.string().trim().min(3, 'escriba la dirección').max(60),
  codMunicipio: z.string().trim().regex(/^\d{8}$/, 'elija el municipio') });
r.post('/clientes', editarTarifas, async (req, res) => {
  const d = clienteSchema.parse(req.body);
  const sede = req.body?.sede ? sedeNueva.parse(req.body.sede) : null;
  const numId = idCliente(d);
  if (sede && numId && !(await Tercero.exists(deEmpresa(req, { numId })))) {
    const codigo = d.sedeRemitente || '1';
    await Tercero.create({ empresa: req.empresaId, tipoId: d.tipoId, numId, nombres: d.razonSocial || d.nombre, sede: { codigo, nombre: (sede.nombre || 'PRINCIPAL').toUpperCase() },
      direccion: sede.direccion, codMunicipio: sede.codMunicipio, roles: ['remitente'] });
    d.sedeRemitente = codigo;
  }
  const c = await Cliente.create({ ...d, empresa: req.empresaId });
  await auditar(req, 'crear_cliente', { entidad: 'Cliente', entidadId: c._id, detalle: { nombre: c.nombre, sede: d.sedeRemitente } });
  res.status(201).json(c);
});

// Nueva sede de una empresa (del cliente o de un destinatario): el código es el siguiente libre de ese NIT
r.post('/sedes', editarTarifas, async (req, res) => {
  const d = z.object({ tipoId: z.string().trim().max(1).optional().default('N'), numId: z.string().trim().transform(v => v.replace(/\D/g, '')).pipe(z.string().min(5).max(15)),
    nombreEmpresa: z.string().trim().max(100).optional().default(''), rol: z.enum(['remitente', 'destinatario']).optional().default('destinatario') })
    .merge(sedeNueva).parse(req.body);
  const existentes = await Tercero.find(deEmpresa(req, { numId: d.numId })).select('nombres apellido1 tipoId sede').lean();
  const nombres = existentes[0]?.nombres || d.nombreEmpresa;
  if (!nombres) throw new ErrorHttp(400, 'Escriba el nombre de la empresa');
  const codigos = existentes.map(t => Number(t.sede?.codigo)).filter(Number.isFinite);
  const codigo = String(codigos.length ? Math.max(...codigos) + 1 : 1);
  const x = await Tercero.create({ empresa: req.empresaId, tipoId: existentes[0]?.tipoId || d.tipoId, numId: d.numId, nombres,
    sede: { codigo, nombre: (d.nombre || `SEDE ${codigo}`).toUpperCase() }, direccion: d.direccion, codMunicipio: d.codMunicipio, roles: [d.rol] });
  await auditar(req, 'crear_sede', { entidad: 'Tercero', entidadId: x._id, detalle: { numId: d.numId, sede: codigo } });
  res.status(201).json(x.toJSON());
});
r.put('/clientes/:id', editarTarifas, async (req, res) => {
  const d = clienteSchema.partial().parse(req.body);
  const antes = await Cliente.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!antes) throw new ErrorHttp(404, 'Cliente no encontrado');
  const c = await Cliente.findOneAndUpdate(deEmpresa(req, { _id: req.params.id }), { $set: d }, { new: true, runValidators: true });
  await auditar(req, 'editar_cliente', { entidad: 'Cliente', entidadId: c._id, detalle: { cambios: cambios(antes, c.toObject(), Object.keys(d)) } });
  res.json(c);
});

// Solo se elimina un cliente sin viajes, liquidaciones ni facturas (con historial se desactiva); sus destinos se eliminan con él.
r.delete('/clientes/:id', editarTarifas, async (req, res) => {
  const c = await Cliente.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!c) throw new ErrorHttp(404, 'Cliente no encontrado');
  const [viajes, liquidaciones, facturas] = await Promise.all([Viaje.countDocuments(deEmpresa(req, { cliente: c._id })),
    Liquidacion.countDocuments(deEmpresa(req, { cliente: c._id })), FacturaCont.countDocuments(deEmpresa(req, { cliente: c._id }))]);
  const usos = [viajes && `${viajes} viaje(s)`, liquidaciones && `${liquidaciones} liquidación(es)`, facturas && `${facturas} factura(s)`].filter(Boolean);
  if (usos.length) throw new ErrorHttp(409, `${c.nombre} tiene ${usos.join(', ')}: no se puede eliminar. Desactívelo en «Editar cliente».`);
  const { deletedCount: destinos } = await Tarifa.deleteMany(deEmpresa(req, { cliente: c._id }));
  await Cliente.deleteOne(deEmpresa(req, { _id: c._id }));
  await auditar(req, 'eliminar_cliente', { entidad: 'Cliente', entidadId: c._id, detalle: { nombre: c.nombre, nit: c.nit, destinos } });
  res.json({ ok: true, destinos });
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
  const tarifas = await Tarifa.find(filtro).sort({ destino: 1 }).populate(pob(req.empresaId, 'cliente', 'nombre nit dv tipoId sedeRemitente')).lean();
  // Nombre de la sede del destinatario (código y nombre, como en el RNDC); sin destinatario = el mismo cliente
  const docsDe = (t) => (t.destinatario?.numId ? [String(t.destinatario.numId).replace(/\D/g, '')]
    : t.cliente ? [idCliente(t.cliente), String(t.cliente.nit || '').replace(/\D/g, '')] : []).filter(Boolean);
  const docs = [...new Set(tarifas.filter(t => t.destinatario?.sede).flatMap(docsDe))];
  const sedes = new Map((docs.length ? await Tercero.find(deEmpresa(req, { numId: { $in: docs }, 'sede.codigo': { $ne: '' } })).select('numId nombres sede codMunicipio direccion').lean() : [])
    .map(s => [`${s.numId}|${s.sede.codigo}`, s]));
  // Sin sede fija: la sede del cliente en el municipio de destino (la misma regla con la que se envía al RNDC)
  const sinSede = tarifas.filter(t => !t.destinatario?.sede && !t.destinatario?.numId && t.cliente && t.codMunicipio);
  const docsAuto = [...new Set(sinSede.map(t => idCliente(t.cliente)))];
  const sedesCli = docsAuto.length ? await Tercero.find(deEmpresa(req, { numId: { $in: docsAuto }, 'sede.codigo': { $ne: '' } })).select('numId nombres sede codMunicipio direccion').lean() : [];
  res.json(tarifas.map(t => { const s = t.destinatario?.sede ? docsDe(t).map(d => sedes.get(`${d}|${t.destinatario.sede}`)).find(Boolean) : null;
    if (s) return { ...t, sedeNombre: s.sede.nombre, sedeMunicipio: s.codMunicipio, sedeDireccion: s.direccion, destinatarioNombre: s.nombres };
    if (!t.destinatario?.sede && !t.destinatario?.numId && t.cliente) {
      const a = elegirSedeMunicipio(sedesCli.filter(x => x.numId === idCliente(t.cliente)), t.codMunicipio, t.cliente.sedeRemitente);
      if (a) return { ...t, sedeAuto: { codigo: a.sede.codigo, nombre: a.sede.nombre, direccion: a.direccion, codMunicipio: a.codMunicipio } };
    }
    return t; }));
});
r.post('/tarifas', editarTarifas, async (req, res) => {
  const d = tarifaSchema.parse(req.body);
  await clienteDeEmpresa(req, d.cliente);
  // Sin peso: se toma de la capacidad escrita en el destino (1.0 → 800 kg, 3.0 → 1.500 kg…)
  if (!d.pesoKg) d.pesoKg = pesoPorTamano(d.destino, await reglasDe(req.empresaId));
  const x = await Tarifa.create({ ...d, empresa: req.empresaId });
  await auditar(req, 'crear_tarifa', { entidad: 'Tarifa', entidadId: x._id, detalle: { destino: x.destino } });
  res.status(201).json(x);
});
r.put('/tarifas/:id', editarTarifas, async (req, res) => {
  const d = tarifaSchema.partial().parse(req.body);
  if (d.cliente) await clienteDeEmpresa(req, d.cliente);
  const antes = await Tarifa.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!antes) throw new ErrorHttp(404, 'Tarifa no encontrada');
  // Sin peso: se toma de la capacidad escrita en el destino
  if (d.pesoKg === 0 || (d.destino && d.pesoKg === undefined && !antes.pesoKg)) {
    const kg = pesoPorTamano(d.destino || antes.destino, await reglasDe(req.empresaId));
    if (kg) d.pesoKg = kg;
  }
  const x = await Tarifa.findOneAndUpdate(deEmpresa(req, { _id: req.params.id }), { $set: d }, { new: true, runValidators: true });
  const viajesActualizados = ('destino' in d || 'codMunicipio' in d) ? await sincronizarDestinoViajes(req.empresaId, x) : 0;
  await auditar(req, 'editar_tarifa', { entidad: 'Tarifa', entidadId: x._id, detalle: { destino: x.destino, viajesActualizados, cambios: cambios(antes, x.toObject(), Object.keys(d)) } });
  res.json({ ...x.toJSON(), viajesActualizados });
});

// Solo se elimina un destino que ningún viaje usa (con viajes se desactiva, así el historial conserva su tarifa).
r.delete('/tarifas/:id', editarTarifas, async (req, res) => {
  const t = await Tarifa.findOne(deEmpresa(req, { _id: req.params.id })).lean();
  if (!t) throw new ErrorHttp(404, 'Destino no encontrado');
  const viajes = await Viaje.countDocuments(deEmpresa(req, { tarifaRef: t._id }));
  if (viajes) throw new ErrorHttp(409, `El destino ${t.destino} tiene ${viajes} viaje(s) registrados: no se puede eliminar. Desactívelo en «Editar».`);
  await Tarifa.deleteOne(deEmpresa(req, { _id: t._id }));
  await auditar(req, 'eliminar_tarifa', { entidad: 'Tarifa', entidadId: t._id, detalle: { destino: t.destino, cliente: String(t.cliente) } });
  res.json({ ok: true });
});

// Lo único que se exige al crear (lo demás lo trae el RNDC o es opcional)
function exigirDatosTercero(d) {
  const faltan = [!String(d.direccion || '').trim() && 'dirección', !d.codMunicipio && 'municipio'].filter(Boolean);
  if (faltan.length) throw new ErrorHttp(400, `Escriba ${faltan.join(' y ')} del tercero`);
}
function exigirDatosVehiculo(d) {
  if (!(Number(d.pesoVacio) > 0)) throw new ErrorHttp(400, 'Escriba el peso vacío del vehículo (kg)');
}

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
  // Orden con desempate por _id (dos terceros con el mismo nombre no se repiten ni se pierden entre páginas)
  await listar(req, res, Tercero.find(filtro).sort({ nombres: 1, apellido1: 1, _id: 1 }), Tercero.countDocuments(filtro), x => x.toJSON());
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
    // La placa principal primero, luego las suyas, la del vehículo habitual y la del último viaje
    const placas = [...new Set([t.placaPrincipal, ...(t.placas || []), ...habituales.filter(v => String(v.conductorHabitual) === id).map(v => v.placa),
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
  const d = terceroSchema.parse(req.body);
  exigirDatosTercero(d);
  const x = await Tercero.create({ ...d, empresa: req.empresaId });
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
  exigirDatosVehiculo(d);
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
  // Misma lógica que Vencimientos de SG-SST
  res.json(await documentosPorVencer(req.empresaId, limite));
});

// ── Revisión de datos: lo que puede causar rechazos del RNDC o un manifiesto incompleto ──
const nombreT = (t) => [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ');
r.get('/revision', ver, async (req, res) => {
  const dias = Number((await reglasDe(req.empresaId)).diasAvisoDocumentos) || 10;
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
