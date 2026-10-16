// Maestros de la empresa: clientes y sus destinos/tarifas, terceros
// (conductores, propietarios, tenedores…), vehículos y el catálogo DIVIPOLA.
import { Router } from 'express';
import { Cliente, Tarifa, Tercero, Vehiculo, Municipio, Viaje, Empresa, pob } from '../models/index.js';
import { autenticar, permitir, soloEmpresa, deEmpresa, ErrorHttp } from '../middleware/auth.js';
import { P } from '../config/permisos.js';
import { auditar, cambios } from '../services/auditoria.js';
import { normalizar, escaparRegex } from '../utils/texto.js';
import { clienteSchema, tarifaSchema, terceroSchema, vehiculoSchema } from '../validaciones/maestros.js';
import { variablesTercero, variablesVehiculo, huella } from '../services/rndc/documentos.js';

const r = Router();
r.use(autenticar, soloEmpresa);

const ver = permitir(P.MAESTROS_VER);
const editar = permitir(P.MAESTROS_EDITAR);
const editarTarifas = permitir(P.MAESTROS_EDITAR, P.TARIFAS_EDITAR);

const buscar = (q) => new RegExp(escaparRegex(String(q || '').trim()), 'i');

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
  res.json(await Tarifa.find(filtro).sort({ destino: 1 }).populate(pob(req.empresaId, 'cliente', 'nombre')).lean());
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
  if (req.query.q) {
    const re = buscar(req.query.q);
    filtro.$or = [{ nombres: re }, { apellido1: re }, { apellido2: re }, { numId: re }];
  }
  await listar(req, res, Tercero.find(filtro).sort({ nombres: 1, apellido1: 1 }), Tercero.countDocuments(filtro), x => x.toJSON());
});
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

// Placas usadas en viajes que aún no están en el maestro de vehículos.
r.get('/vehiculos-faltantes', ver, async (req, res) => {
  const placas = await Viaje.distinct('placa', deEmpresa(req));
  const existentes = new Set((await Vehiculo.find(deEmpresa(req)).select('placa').lean()).map(v => v.placa));
  res.json(placas.filter(p => !existentes.has(p)));
});

export default r;
