// Sincronización EXACTA de los maestros de una empresa con la plantilla de Excel:
// conductores, tenedores y titulares, vehículos, clientes y tarifas.
//
// 1. Lo que está en el Excel y falta en la plataforma se crea (importador de la plantilla, sin viajes).
// 2. Las tarifas toman los valores del Excel.
// 3. Lo que está en la plataforma y no en el Excel:
//    - se elimina si nada lo usa;
//    - se desactiva (activo = false) si lo usa un viaje, un manifiesto, una liquidación u otro maestro,
//      para no romper el historial (los viajes, manifiestos y liquidaciones no se tocan).
//    Las sedes de remitentes y destinatarios del RNDC no se tocan.
//
// Con `aplicar: false` solo calcula el plan (no escribe nada).
import { Cliente, Tarifa, Tercero, Vehiculo, Viaje, Liquidacion, EnvioCorreo } from '../../models/index.js';
import { normalizar, soloDigitos, nombrePropio } from '../../utils/texto.js';
import { leerLibro, filas, txt, entero, num } from './excel.js';
import { importarPlantillaViajes } from './plantilla.js';

const placaKey = (p) => txt(p).replace(/[\s-]/g, '').toUpperCase();
const cedula = (v) => { const s = entero(v).replace(/[.\s,]/g, ''); return s === '0' ? '' : s; };
const ROLES_PERSONA = ['conductor', 'tenedor', 'titular', 'propietario'];
const muestra = (l, n = 40) => l.slice(0, n);

// Lo que el Excel dice que debe existir
export async function contenidoPlantilla(buffer) {
  const wb = await leerLibro(buffer);
  const H = (n) => (wb.getWorksheet(n) ? filas(wb.getWorksheet(n)) : []);
  if (!wb.getWorksheet('Empresas') || !wb.getWorksheet('Fletes')) throw Object.assign(new Error('El archivo no tiene las hojas Empresas y Fletes de la plantilla'), { status: 400 });
  const fichas = H('RNDC_FICHAS').slice(5);
  const conductores = H('_CONDUCTORES').slice(1).filter(f => txt(f[0]) && txt(f[1]));
  const docs = new Map();          // documento → nombre (conductores, tenedores, titulares)
  const placas = new Map();        // placa → conductor
  for (const f of fichas) {
    if (cedula(f[9]) && txt(f[10])) docs.set(cedula(f[9]), txt(f[10]));
    if (cedula(f[15]) && txt(f[16])) docs.set(cedula(f[15]), txt(f[16]));
    const p = placaKey(f[0]);
    if (/^[A-Z0-9]{5,6}$/.test(p)) placas.set(p, placas.get(p) || '');
  }
  for (const f of conductores) {
    if (cedula(f[2])) docs.set(cedula(f[2]), docs.get(cedula(f[2])) || nombrePropio(txt(f[0])));
    if (cedula(f[9]) && txt(f[10])) docs.set(cedula(f[9]), docs.get(cedula(f[9])) || txt(f[10]));
    const p = placaKey(f[1]);
    if (/^[A-Z0-9]{5,6}$/.test(p)) placas.set(p, txt(f[0]));
  }
  const clientes = new Map();      // nombre normalizado → { nombre, nit }
  for (const f of H('Empresas').slice(1)) if (txt(f[0])) clientes.set(normalizar(f[0]), { nombre: txt(f[0]), nit: entero(f[2]) });
  const tarifas = new Map();       // cliente|destino → valores
  for (const f of H('Fletes').slice(1)) {
    if (!txt(f[0]) || !txt(f[1]) || !clientes.has(normalizar(f[0]))) continue;
    tarifas.set(`${normalizar(f[0])}|${normalizar(f[1])}`, { cliente: txt(f[0]), destino: txt(f[1]),
      tarifaCliente: num(f[2]) || 0, tarifaAuxiliar: num(f[3]) || 0, fleteConductor: num(f[4]) || 0, auxiliarPagado: num(f[5]) || 0, anticipoHabitual: num(f[7]) || 0 });
  }
  return { docs, placas, clientes, tarifas };
}

export async function sincronizarMaestros(empresaId, buffer, { aplicar = false, usuario = null } = {}) {
  const E = empresaId;
  const x = await contenidoPlantilla(buffer);
  const plan = { creados: null, tarifasActualizadas: [], eliminar: {}, desactivar: {}, faltan: {} };

  // ── Faltantes (para el plan) y creación con el importador de la plantilla ──
  const [tercerosBD, vehiculosBD, clientesBD] = await Promise.all([
    Tercero.find({ empresa: E }).select('tipoId numId sede nombres apellido1 apellido2 roles activo').lean(),
    Vehiculo.find({ empresa: E }).select('placa activo').lean(),
    Cliente.find({ empresa: E }).select('nombre activo').lean(),
  ]);
  const docsBD = new Set(tercerosBD.filter(t => !t.sede?.codigo).map(t => soloDigitos(t.numId)));
  plan.faltan = {
    terceros: [...x.docs.keys()].filter(d => !docsBD.has(d)).length,
    vehiculos: [...x.placas.keys()].filter(p => !vehiculosBD.some(v => v.placa === p)).length,
    clientes: [...x.clientes.keys()].filter(k => !clientesBD.some(c => normalizar(c.nombre) === k)).length,
  };
  if (aplicar) plan.creados = await importarPlantillaViajes(E, buffer, { usuario, soloMaestros: true });

  // ── Referencias que impiden borrar ─────────────────────────────────────────
  const [viajesRef, liqRef, vehRef, envRef] = await Promise.all([
    Viaje.find({ empresa: E }).select('cliente conductor titular tarifaRef placa remolque').lean(),
    Liquidacion.find({ empresa: E }).select('cliente').lean(),
    Vehiculo.find({ empresa: E }).select('conductorHabitual titularHabitual').lean(),
    EnvioCorreo.distinct('cliente', { empresa: E }),
  ]);
  const usados = (campo) => new Set(viajesRef.map(v => String(v[campo] || '')).filter(Boolean));
  const tercerosUsados = new Set([...usados('conductor'), ...usados('titular'),
    ...vehRef.flatMap(v => [String(v.conductorHabitual || ''), String(v.titularHabitual || '')]).filter(Boolean)]);
  const placasUsadas = new Set(viajesRef.flatMap(v => [v.placa, v.remolque]).filter(Boolean));
  const clientesUsados = new Set([...usados('cliente'), ...liqRef.map(l => String(l.cliente)), ...envRef.map(String)]);
  const tarifasUsadas = usados('tarifaRef');

  // ── Clientes y tarifas ───────────────────────────────────────────────────
  const clientes = await Cliente.find({ empresa: E }).lean();
  const nombreCliente = new Map(clientes.map(c => [String(c._id), normalizar(c.nombre)]));
  const sobranClientes = clientes.filter(c => !x.clientes.has(normalizar(c.nombre)));
  const tarifas = await Tarifa.find({ empresa: E }).lean();
  const sobranTarifas = [];
  for (const t of tarifas) {
    const k = `${nombreCliente.get(String(t.cliente))}|${normalizar(t.destino)}`;
    const e = x.tarifas.get(k);
    if (!e) { sobranTarifas.push(t); continue; }
    const set = {};
    for (const c of ['tarifaCliente', 'tarifaAuxiliar', 'fleteConductor', 'auxiliarPagado', 'anticipoHabitual']) if ((Number(t[c]) || 0) !== e[c]) set[c] = e[c];
    if (t.activo === false) set.activo = true;
    if (Object.keys(set).length) {
      plan.tarifasActualizadas.push(`${e.cliente} · ${e.destino}: ${Object.keys(set).join(', ')}`);
      if (aplicar) await Tarifa.updateOne({ empresa: E, _id: t._id }, { $set: set });
    }
  }

  // ── Vehículos ────────────────────────────────────────────────────────────
  const sobranVehiculos = (await Vehiculo.find({ empresa: E }).select('placa activo').lean()).filter(v => !x.placas.has(v.placa));

  // ── Terceros (personas: conductores, tenedores, titulares, propietarios) ──
  const sobranTerceros = (await Tercero.find({ empresa: E, 'sede.codigo': { $in: ['', null] } }).select('tipoId numId nombres apellido1 roles activo').lean())
    .filter(t => (t.roles || []).length && t.roles.every(r => ROLES_PERSONA.includes(r)) && !x.docs.has(soloDigitos(t.numId)));

  // ── Eliminar o desactivar lo que sobra ─────────────────────────────────────
  const repartir = (lista, usado) => ({ borrar: lista.filter(d => !usado(d)), desactivar: lista.filter(d => usado(d) && d.activo !== false) });
  const c = repartir(sobranClientes, d => clientesUsados.has(String(d._id)) || tarifas.some(t => String(t.cliente) === String(d._id) && tarifasUsadas.has(String(t._id))));
  const t = repartir(sobranTarifas, d => tarifasUsadas.has(String(d._id)));
  const v = repartir(sobranVehiculos, d => placasUsadas.has(d.placa));
  const p = repartir(sobranTerceros, d => tercerosUsados.has(String(d._id)));
  const nombreT = (d) => `${[d.nombres, d.apellido1].filter(Boolean).join(' ')} (${d.tipoId} ${d.numId})`;
  plan.eliminar = { clientes: c.borrar.map(d => d.nombre), tarifas: t.borrar.map(d => d.destino), vehiculos: v.borrar.map(d => d.placa), terceros: p.borrar.map(nombreT) };
  plan.desactivar = { clientes: c.desactivar.map(d => d.nombre), tarifas: t.desactivar.map(d => d.destino), vehiculos: v.desactivar.map(d => d.placa), terceros: p.desactivar.map(nombreT) };
  if (aplicar) {
    // Las tarifas de los clientes que se eliminan también salen
    const clientesBorrados = c.borrar.map(d => d._id);
    await Tarifa.deleteMany({ empresa: E, $or: [{ _id: { $in: t.borrar.map(d => d._id) } }, { cliente: { $in: clientesBorrados } }] });
    await Cliente.deleteMany({ empresa: E, _id: { $in: clientesBorrados } });
    await Vehiculo.deleteMany({ empresa: E, _id: { $in: v.borrar.map(d => d._id) } });
    await Tercero.deleteMany({ empresa: E, _id: { $in: p.borrar.map(d => d._id) } });
    await Promise.all([
      Cliente.updateMany({ empresa: E, _id: { $in: c.desactivar.map(d => d._id) } }, { $set: { activo: false } }),
      Tarifa.updateMany({ empresa: E, _id: { $in: t.desactivar.map(d => d._id) } }, { $set: { activo: false } }),
      Vehiculo.updateMany({ empresa: E, _id: { $in: v.desactivar.map(d => d._id) } }, { $set: { activo: false } }),
      Tercero.updateMany({ empresa: E, _id: { $in: p.desactivar.map(d => d._id) } }, { $set: { activo: false } }),
    ]);
    // Lo que el Excel trae y estaba inactivo vuelve a quedar activo
    await Promise.all([
      Cliente.updateMany({ empresa: E, activo: false, _id: { $in: clientes.filter(d => x.clientes.has(normalizar(d.nombre))).map(d => d._id) } }, { $set: { activo: true } }),
      Vehiculo.updateMany({ empresa: E, activo: false, placa: { $in: [...x.placas.keys()] } }, { $set: { activo: true } }),
    ]);
  }
  const resumen = (o) => Object.fromEntries(Object.entries(o).map(([k, l]) => [k, { total: l.length, ejemplos: muestra(l) }]));
  return {
    aplicado: aplicar,
    excel: { terceros: x.docs.size, vehiculos: x.placas.size, clientes: x.clientes.size, tarifas: x.tarifas.size },
    faltan: plan.faltan, creados: plan.creados,
    tarifasActualizadas: { total: plan.tarifasActualizadas.length, ejemplos: muestra(plan.tarifasActualizadas) },
    eliminar: resumen(plan.eliminar), desactivar: resumen(plan.desactivar),
  };
}
