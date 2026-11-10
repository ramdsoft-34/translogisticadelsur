// Importar viajes desde Excel (relación de fletes o plantilla de la plataforma), como si se hubieran registrado uno a uno.
//   1. analizar(): lee el archivo y propone cada viaje (cliente, conductor, destino/tarifa, valores) sin guardar nada.
//      Cada fila queda «lista», «revisar» (algo se corrigió o falta aprobar), «repetida» (ya hay un viaje igual) o «error».
//   2. registrar(): guarda solo las filas que el usuario incluyó y aprobó, con su fecha, el consecutivo de viajes,
//      la tarifa, el titular del vehículo y el soporte interno si no llevan manifiesto del RNDC.
// Acepta la plantilla y también la relación de fletes del cliente (Transportador, Placa, N° Planilla, Destino, Fecha,
// Cantidad, Tarifa, Auxiliar, Total), con varios bloques de encabezados en la misma hoja.
import ExcelJS from 'exceljs';
import { Cliente, Tarifa, Tercero, Vehiculo, Viaje, Empresa, siguiente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { marcarLibro } from '../reportes/comun.js';
import { leerLibro, filas, txt, num, fecha as fechaCelda } from './excel.js';
import { buscarPorNombre } from './completarViajes.js';
import { normalizar, soloDigitos, hoyColombia } from '../../utils/texto.js';
import { valoresDesdeTarifa } from '../calculos.js';
import { asegurarMesAbierto } from '../gestion/cierre.js';
import { soporteInterno } from '../gestion/soporteInterno.js';

// [título, campo, obligatoria, ayuda, otros títulos que se aceptan]
export const COLUMNAS_VIAJES = [
  ['Fecha', 'fecha', true, 'dd/mm/aaaa (fecha del viaje)', []],
  ['Cliente', 'cliente', false, 'Nombre, siglas o NIT. Vacío = el cliente elegido al importar', ['EMPRESA']],
  ['Placa', 'placa', true, 'ABC123', ['VEHICULO']],
  ['Conductor', 'conductor', true, 'Cédula o nombre (como en Conductores y terceros)', ['TRANSPORTADOR', 'CEDULA CONDUCTOR']],
  ['Destino', 'destino', true, 'Como está en Clientes y tarifas', []],
  ['Cantidad', 'cantidad', false, 'Viajes o unidades (vacío = 1)', []],
  ['N° Planilla', 'planilla', false, 'Planilla del cliente', ['PLANILLA', 'NO PLANILLA', 'N PLANILLA', 'NRO PLANILLA']],
  ['Tarifa', 'tarifa', false, 'Lo que se cobra al cliente por viaje. Vacío = la de la tarifa', ['TARIFA CLIENTE']],
  ['Flete', 'flete', false, 'Lo que se paga al conductor. Vacío = el de la tarifa', ['FLETE CONDUCTOR']],
  ['Anticipo', 'anticipo', false, 'Vacío = el habitual de la tarifa', []],
  ['Días auxiliar', 'diasAuxiliar', false, '1 a 5. Vacío = sin auxiliar (o se calcula de la columna Auxiliar)', ['DIAS AUX']],
  ['Auxiliar', 'auxiliar', false, 'Valor cobrado de auxiliar (si no se escriben los días)', ['VALOR AUXILIAR']],
  ['Auxiliar pagado', 'auxiliarPagado', false, 'Sí o No (vacío = lo elegido al importar; por defecto Sí, ya se pagó)', []],
  ['Manifiesto RNDC', 'manifiesto', false, 'Sí o No (vacío = lo elegido al importar)', ['LLEVA MANIFIESTO']],
  ['Observaciones', 'observaciones', false, '', []],
];

export async function plantillaViajes() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Viajes');
  const h = ws.addRow(COLUMNAS_VIAJES.map(([t, , obl]) => (obl ? `${t} *` : t)));
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFF5B800' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
    c.alignment = { wrapText: true, vertical: 'middle' };
  });
  ws.addRow([new Date(Date.UTC(2026, 9, 16)), 'Nutrisur Pasto', 'SLF645', 'Francisco Noguera', 'Pasto TAT 1.0', 1, 982, 140000, '', '', 1, '', 'Sí', 'No', 'Ejemplo: bórrelo']);
  ws.getColumn(1).numFmt = 'dd/mm/yyyy';
  ws.columns.forEach((c) => { c.width = 18; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const ayuda = wb.addWorksheet('Instrucciones');
  ayuda.addRow(['Columna', 'Obligatoria', 'Formato / ayuda']).font = { bold: true };
  for (const [t, , obl, a] of COLUMNAS_VIAJES) ayuda.addRow([t, obl ? 'Sí' : 'No', a]);
  ayuda.addRow([]);
  ayuda.addRow(['Un viaje por fila desde la fila 2. También se puede subir la relación de fletes del cliente tal como está (con sus encabezados).']);
  ayuda.addRow(['Antes de guardar se muestra cada viaje: los repetidos y las correcciones se aprueban uno por uno.']);
  ayuda.getColumn(1).width = 20; ayuda.getColumn(2).width = 12; ayuda.getColumn(3).width = 80;
  marcarLibro(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Lectura ──
const ALIAS = new Map(COLUMNAS_VIAJES.flatMap(([t, campo, , , otros]) => [[normalizar(t), campo], ...otros.map((o) => [normalizar(o), campo])]));
function encabezado(fila) {
  const idx = {};
  (fila || []).forEach((v, i) => { const c = ALIAS.get(normalizar(txt(v).replace(/\*/g, ''))); if (c && idx[c] === undefined) idx[c] = i; });
  return idx.placa !== undefined && idx.destino !== undefined && idx.fecha !== undefined ? idx : null;
}
const siNo = (v) => { const s = normalizar(v); return s ? ['SI', 'S', 'X', 'TRUE', '1'].includes(s) : null; };

function leerFilas(wb) {
  const out = [];
  for (const ws of wb.worksheets) {
    if (/instrucc/i.test(ws.name)) continue;
    let idx = null;
    filas(ws).forEach((f, i) => {
      const h = encabezado(f);
      if (h) { idx = h; return; }                    // bloque nuevo (la relación repite los encabezados por placa)
      if (!idx) return;
      const o = {}; for (const [campo, j] of Object.entries(idx)) o[campo] = f[j];
      if (!txt(o.placa) && !txt(o.destino)) return;  // filas vacías o de totales
      if (/^TOTAL/i.test(txt(f[0])) && !txt(o.placa)) return;
      out.push({ fila: i + 1, hoja: ws.name, crudo: o });
    });
  }
  if (!out.length) throw new ErrorHttp(400, 'No se encontraron viajes: el archivo debe tener columnas Fecha, Placa y Destino (use la plantilla)');
  if (out.length > 3000) throw new ErrorHttp(400, 'Máximo 3.000 viajes por archivo');
  return out;
}

// Destino escrito → tarifa del cliente: igual (sin tildes ni mayúsculas) o la única que lo contiene / está contenida
function buscarTarifa(destino, tarifas) {
  const d = normalizar(destino);
  if (!d) return { tarifa: null, opciones: [] };
  const iguales = tarifas.filter((t) => normalizar(t.destino) === d);
  if (iguales.length) return { tarifa: iguales[0], exacta: true, opciones: iguales };
  const sinNum = (s) => normalizar(s).replace(/\b\d+( \d+)?\b/g, '').replace(/\s+/g, ' ').trim();
  const parecidas = tarifas.filter((t) => { const a = normalizar(t.destino); return a.includes(d) || d.includes(a) || (sinNum(a) && sinNum(a) === sinNum(d) && a.match(/\d+ \d+|\d+/)?.[0] === d.match(/\d+ \d+|\d+/)?.[0]); });
  return parecidas.length === 1 ? { tarifa: parecidas[0], exacta: false, opciones: parecidas } : { tarifa: null, opciones: parecidas };
}

const nombreDe = (t) => [t?.nombres, t?.apellido1, t?.apellido2].filter(Boolean).join(' ');
const dia = (f) => f.toISOString().slice(0, 10);

/** Revisa el archivo y propone cada viaje. No guarda nada. */
export async function analizarViajes(empresaId, buffer, { cliente: clienteDefecto = '', manifiesto = true, auxiliarPagado = true } = {}) {
  const leidas = leerFilas(await leerLibro(buffer));
  const clientes = await Cliente.find({ empresa: empresaId }).select('nombre siglas nit razonSocial').lean();
  const tarifas = await Tarifa.find({ empresa: empresaId, activo: { $ne: false } }).select('cliente destino codMunicipio tarifaCliente fleteConductor anticipoHabitual tarifaAuxiliar auxiliarPagado pesoKg destinatario operacion').lean();
  const conductores = (await Tercero.find({ empresa: empresaId, roles: 'conductor' }).select('nombres apellido1 apellido2 numId placas placaPrincipal').lean())
    .map((t) => Object.assign(t, { _s: new Set(normalizar(nombreDe(t)).split(' ').filter((w) => w.length > 1)) }));
  const placas = [...new Set(leidas.map((x) => txt(x.crudo.placa).toUpperCase().replace(/[\s-]/g, '')))];
  const vehiculos = new Map((await Vehiculo.find({ empresa: empresaId, placa: { $in: placas } }).select('placa conductorHabitual').lean()).map((v) => [v.placa, v]));
  const defecto = clientes.find((c) => String(c._id) === String(clienteDefecto)) || null;
  const hoy = hoyColombia();

  // Viajes ya registrados en esas fechas y placas (para avisar repetidos)
  const fechas = leidas.map((x) => fechaCelda(x.crudo.fecha)).filter(Boolean);
  const existentes = fechas.length ? await Viaje.find({ empresa: empresaId, estado: { $ne: 'anulado' }, placa: { $in: placas },
    fecha: { $gte: new Date(Math.min(...fechas)), $lte: new Date(Math.max(...fechas)) } }).select('numero placa fecha destino planilla cliente').lean() : [];
  const vistos = new Map();
  // Meses cerrados en contabilidad: no se puede registrar en ellos
  const cerrados = new Map();
  for (const m of new Set(fechas.map((f) => dia(f).slice(0, 7)))) {
    try { await asegurarMesAbierto(empresaId, new Date(`${m}-15T00:00:00Z`)); cerrados.set(m, ''); } catch (e) { cerrados.set(m, e.message); }
  }

  const resultado = [];
  for (const { fila, hoja, crudo } of leidas) {
    const errores = []; const avisos = [];
    const p = { fila, hoja, escrito: { conductor: txt(crudo.conductor), destino: txt(crudo.destino), cliente: txt(crudo.cliente) } };

    // Fecha
    const f = fechaCelda(crudo.fecha);
    if (!f) errores.push(`Fecha no válida: «${txt(crudo.fecha)}»`);
    else if (f > hoy) errores.push('La fecha es posterior a hoy');
    else if (cerrados.get(dia(f).slice(0, 7))) errores.push(cerrados.get(dia(f).slice(0, 7)));
    p.fecha = f ? dia(f) : '';

    // Cliente
    let cli = defecto;
    if (txt(crudo.cliente)) {
      const n = normalizar(crudo.cliente); const nit = soloDigitos(crudo.cliente);
      cli = clientes.find((c) => normalizar(c.nombre) === n || (c.siglas && normalizar(c.siglas) === n) || (nit.length >= 6 && soloDigitos(c.nit) === nit))
        || clientes.find((c) => normalizar(c.nombre).includes(n) || n.includes(normalizar(c.nombre))) || null;
      if (!cli) errores.push(`Cliente «${txt(crudo.cliente)}» no existe`);
    } else if (!cli) errores.push('Falta el cliente: escríbalo en el archivo o elíjalo al importar');
    p.cliente = cli?._id || null; p.clienteNombre = cli?.nombre || '';

    // Placa
    p.placa = txt(crudo.placa).toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{5,6}$/.test(p.placa)) errores.push(`Placa no válida: «${txt(crudo.placa)}»`);
    else if (!vehiculos.has(p.placa)) avisos.push('El vehículo no está registrado en Vehículos');

    // Conductor: cédula o nombre (primero entre los de la placa)
    p.conductor = null; p.conductorNombre = ''; p.opcionesConductor = []; p.errorConductor = ''; p.errorDestino = '';
    const escrito = txt(crudo.conductor);
    const ced = soloDigitos(escrito);
    if (!escrito) p.errorConductor = 'Falta el conductor';
    else if (ced.length >= 5 && ced.length === escrito.replace(/[.\s]/g, '').length) {
      const t = conductores.find((x) => soloDigitos(x.numId) === ced);
      if (t) { p.conductor = t._id; p.conductorNombre = nombreDe(t); } else p.errorConductor = `No hay un conductor con cédula ${ced}`;
    } else {
      const veh = vehiculos.get(p.placa);
      const deLaPlaca = conductores.filter((t) => (t.placas || []).includes(p.placa) || t.placaPrincipal === p.placa || String(t._id) === String(veh?.conductorHabitual || ''));
      let r = buscarPorNombre(escrito, deLaPlaca);
      if (!r.elegido) r = buscarPorNombre(escrito, conductores);
      if (r.elegido) {
        p.conductor = r.elegido._id; p.conductorNombre = nombreDe(r.elegido);
        const exacto = normalizar(escrito).split(' ').every((w) => normalizar(nombreDe(r.elegido)).split(' ').includes(w));
        if (!exacto) avisos.push(`Conductor «${escrito}» se tomó como ${p.conductorNombre}`);
      } else {
        p.opcionesConductor = r.opciones.slice(0, 5).map((t) => ({ _id: t._id, nombre: nombreDe(t), numId: t.numId }));
        p.errorConductor = r.opciones.length > 1 ? `Conductor «${escrito}»: hay varios posibles, elija uno` : `Conductor «${escrito}» no está en Conductores y terceros`;
      }
    }

    // Destino → tarifa del cliente
    const deCliente = cli ? tarifas.filter((t) => String(t.cliente) === String(cli._id)) : [];
    p.tarifaRef = null; p.destino = txt(crudo.destino);
    let tar = null;
    if (!p.destino) p.errorDestino = 'Falta el destino';
    else if (cli) {
      const r = buscarTarifa(p.destino, deCliente);
      if (r.tarifa) {
        tar = r.tarifa; p.tarifaRef = tar._id;
        if (!r.exacta) avisos.push(`Destino «${p.destino}» se tomó como «${tar.destino}»`);
        p.destino = tar.destino;
      } else p.errorDestino = r.opciones.length > 1 ? `Destino «${p.destino}»: varias tarifas posibles, elija una` : `Destino «${p.destino}» no está en las tarifas de ${cli.nombre}`;
    }

    // Valores
    const sug = valoresDesdeTarifa(tar);
    p.cantidad = num(crudo.cantidad) || 1;
    p.planilla = txt(crudo.planilla).replace(/\.0+$/, '').slice(0, 30);
    const tarifaArchivo = num(crudo.tarifa);
    p.tarifa = tarifaArchivo ?? sug.tarifa ?? 0;
    if (tar && tarifaArchivo !== null && sug.tarifa && tarifaArchivo !== sug.tarifa) avisos.push(`Tarifa del archivo $${tarifaArchivo.toLocaleString('es-CO')} distinta a la registrada $${sug.tarifa.toLocaleString('es-CO')} (se guarda la del archivo)`);
    p.flete = num(crudo.flete) ?? sug.flete ?? 0;
    p.anticipo = num(crudo.anticipo) ?? sug.anticipo ?? 0;
    if (!p.flete) avisos.push('Sin flete para el conductor (la tarifa no lo tiene)');

    // Auxiliar: días escritos o calculados del valor
    const dias = num(crudo.diasAuxiliar); const valorAux = num(crudo.auxiliar);
    p.diasAuxiliar = 0;
    if (dias) p.diasAuxiliar = Math.round(dias);
    else if (valorAux) {
      const unidad = Number(tar?.tarifaAuxiliar) || 0;
      const calc = unidad ? valorAux / unidad : 1;
      p.diasAuxiliar = Math.max(1, Math.round(calc));
      if (!unidad) avisos.push(`Auxiliar $${valorAux.toLocaleString('es-CO')}: la tarifa no tiene valor de auxiliar, se registra 1 día`);
      else if (Math.abs(calc - p.diasAuxiliar) > 0.01) avisos.push(`Auxiliar $${valorAux.toLocaleString('es-CO')} no es un número exacto de días ($${unidad.toLocaleString('es-CO')} por día): se registran ${p.diasAuxiliar}`);
    }
    if (p.diasAuxiliar > 5) { errores.push('El auxiliar va de 1 a 5 días'); p.diasAuxiliar = 5; }
    p.auxiliarPagado = siNo(crudo.auxiliarPagado) ?? !!auxiliarPagado;
    p.requiereManifiesto = siNo(crudo.manifiesto) ?? !!manifiesto;
    p.observaciones = txt(crudo.observaciones).slice(0, 500);

    // Repetidos: en la plataforma (misma placa y fecha; con planilla, la misma planilla) y dentro del archivo
    p.repetidos = [];
    if (f && p.placa) {
      const mismos = existentes.filter((v) => v.placa === p.placa && dia(v.fecha) === p.fecha && (!p.planilla || !v.planilla || v.planilla === p.planilla));
      p.repetidos = mismos.map((v) => `N° ${v.numero} · ${v.destino}${v.planilla ? ` · planilla ${v.planilla}` : ''}`);
      const clave = `${p.placa}|${p.fecha}|${normalizar(p.destino)}|${p.planilla}`;
      if (vistos.has(clave)) p.repetidos.push(`Fila ${vistos.get(clave)} del mismo archivo`);
      else vistos.set(clave, fila);
    }

    p.errores = errores; p.avisos = avisos;
    p.estado = errores.length || p.errorConductor || p.errorDestino ? 'error' : p.repetidos.length ? 'repetida' : avisos.length ? 'revisar' : 'lista';
    resultado.push(p);
  }

  const tarifasPorCliente = {};
  for (const c of new Set(resultado.map((x) => String(x.cliente || '')).filter(Boolean))) {
    tarifasPorCliente[c] = tarifas.filter((t) => String(t.cliente) === c).map((t) => ({ _id: t._id, destino: t.destino })).sort((a, b) => a.destino.localeCompare(b.destino, 'es'));
  }
  const cuenta = (e) => resultado.filter((x) => x.estado === e).length;
  return { total: resultado.length, listas: cuenta('lista'), revisar: cuenta('revisar'), repetidas: cuenta('repetida'), errores: cuenta('error'), filas: resultado, tarifasPorCliente };
}

/** Registra los viajes elegidos. Cada uno se valida de nuevo; los repetidos solo con confirmación. */
export async function registrarViajes(empresaId, usuario, filasElegidas) {
  const empresa = await Empresa.findById(empresaId).lean();
  const creados = []; const fallidos = [];
  for (const x of filasElegidas) {
    try {
      const fechaV = new Date(`${x.fecha}T00:00:00Z`);
      if (Number.isNaN(fechaV.getTime())) throw new Error('Fecha no válida');
      await asegurarMesAbierto(empresaId, fechaV);
      const [cli, tar, cond] = await Promise.all([
        Cliente.findOne({ empresa: empresaId, _id: x.cliente }).select('_id').lean(),
        x.tarifaRef ? Tarifa.findOne({ empresa: empresaId, _id: x.tarifaRef, cliente: x.cliente }).lean() : null,
        Tercero.findOne({ empresa: empresaId, _id: x.conductor }).select('nombres apellido1 apellido2').lean(),
      ]);
      if (!cli) throw new Error('Cliente no válido');
      if (!cond) throw new Error('Falta el conductor');
      if (!tar) throw new Error('Falta el destino (tarifa)');
      const placa = String(x.placa || '').toUpperCase().replace(/[\s-]/g, '');
      if (!/^[A-Z0-9]{5,6}$/.test(placa)) throw new Error('Placa no válida');
      if (!x.confirmarRepetido) {
        const mismo = await Viaje.findOne({ empresa: empresaId, placa, fecha: fechaV, estado: { $ne: 'anulado' } }).select('numero').lean();
        if (mismo) throw new Error(`Ya existe el viaje N° ${mismo.numero} de ${placa} ese día (apruébelo como repetido para subirlo)`);
      }
      const sug = valoresDesdeTarifa(tar);
      const veh = await Vehiculo.findOne({ empresa: empresaId, placa }).select('titularHabitual').lean();
      const dias = Math.max(0, Math.min(5, Math.round(Number(x.diasAuxiliar) || 0)));
      const numero = await siguiente(empresaId, 'viaje');
      const v = await Viaje.create({
        empresa: empresaId, numero, fecha: fechaV, cliente: cli._id, tarifaRef: tar._id, destino: tar.destino,
        codDestino: sug.codDestino || '', destinatario: sug.destinatario?.numId ? sug.destinatario : undefined, pesoKg: sug.pesoKg || 0,
        placa, conductor: cond._id, conductorNombre: nombreDe(cond), titular: veh?.titularHabitual || null,
        cantidad: Number(x.cantidad) || 1, planilla: String(x.planilla || '').slice(0, 30),
        // Destino elegido a mano en la revisión: flete y anticipo de esa tarifa (y la tarifa, si el archivo no la traía)
        tarifa: Math.max(0, Number(x.tarifa) || (x.completarDeTarifa ? sug.tarifa : 0) || 0),
        flete: Math.max(0, x.completarDeTarifa ? (sug.flete || 0) : (Number(x.flete) || 0)),
        anticipo: Math.max(0, x.completarDeTarifa ? (sug.anticipo || 0) : (Number(x.anticipo) || 0)),
        conAuxiliar: dias > 0, diasAuxiliar: dias, auxiliarPagado: dias > 0 ? !!x.auxiliarPagado : null,
        requiereManifiesto: x.requiereManifiesto !== false, observaciones: String(x.observaciones || '').slice(0, 500),
        creadoPor: usuario, actualizadoPor: usuario,
      });
      // Sin manifiesto del RNDC: soporte interno numerado, como al registrar (sin enviarlo por WhatsApp: es un viaje pasado)
      if (v.requiereManifiesto === false) await soporteInterno(empresa, v._id);
      creados.push({ fila: x.fila, numero, _id: v._id });
    } catch (e) {
      fallidos.push({ fila: x.fila, error: e.message || String(e) });
    }
  }
  return { creados, fallidos };
}
