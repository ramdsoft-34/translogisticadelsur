// Fase 12: remesas de los clientes (módulo REMESAS DULCES de la plantilla, generalizado por cliente).
// - Base: Excel del cliente con una o varias tablas (p. ej. la normal y la de ECOM) con FECHA, VPL, ZONA, PESO,
//   MANIFIESTO, CONDUCTOR, PLACA, REMESA y COSTO. Se saltan títulos, filas vacías, subtotales y totales.
// - VPL = número interno del cliente · REMESA = consecutivo interno de la cooperativa (si viene vacío se asigna).
// - Cédula y dirección del conductor: del registro de conductores, o de una remesa anterior del mismo conductor.
// - Revisión: viajes que coinciden con la bitácora (misma placa y día), saltos y repetidos en el consecutivo,
//   subtotales del Excel que no cuadran y conductores sin cédula.
// - PDF con el formato de la remesa de la cooperativa: 1 por hoja (mitad de arriba) o 2 por hoja con línea para cortar.
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import { RemesaDulces, Tercero, Vehiculo, Viaje, Municipio, Empresa, Cliente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { normalizar, parseFecha } from '../../utils/texto.js';
import { leerLibro, filas, txt, num } from '../importacion/excel.js';
import { pdfABuffer } from '../reportes/comun.js';
import { imagenDeDataUrl } from '../reportes/manifiesto.js';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CAMPOS = ['fecha', 'zona', 'peso', 'manifiesto', 'conductor', 'placa', 'remesa', 'costo'];

// ── Lectura del Excel ──────────────────────────────────────────────────────
// Columna por su encabezado (como RD_IdCol de la plantilla: FECHA antes que PLANILLA)
export function columnaDe(h) {
  const n = normalizar(h);
  if (!n) return null;
  if (n.includes('FECHA')) return 'fecha';
  if (n.includes('VPL') || n.includes('PLANILLA')) return 'vpl';
  if (n.includes('ZONA') || n.includes('RUTA')) return 'zona';
  if (n.includes('PESO')) return 'peso';
  if (n.includes('MANIFIESTO')) return 'manifiesto';
  if (n.includes('CONDUCTOR')) return 'conductor';
  if (n.includes('PLACA')) return 'placa';
  if (n.includes('REMESA')) return 'remesa';
  if (n.includes('COSTO') || n.includes('VALOR') || n.includes('FLETE')) return 'costo';
  return null;
}
const esEncabezado = (f) => { const c = f.map(columnaDe); return c.includes('vpl') && (c.includes('conductor') || c.includes('placa')); };
const numeroTexto = (v) => { if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? String(Math.round(v)) : ''; const s = txt(v).replace(/\.0+$/, ''); return /^\d+$/.test(s) ? s : ''; };
const grupoDe = (titulo) => (/\bECOM\b/.test(normalizar(titulo)) ? 'ECOM' : '');

// Filas de trabajo de todas las hojas: { filas, sinViaje, subtotales, total }
export function leerFilas(hojas) {
  const out = []; const sinViaje = []; const subtotales = []; let total = null;
  for (const fs of hojas) {
    let idx = null; let titulo = ''; let tabla = [];
    for (const f of fs) {
      // Las celdas combinadas (títulos) repiten su texto en cada columna: se cuenta una vez
      const textos = [...new Set(f.map(txt).filter(Boolean))];
      if (!textos.length) continue;
      if (esEncabezado(f)) { idx = {}; f.forEach((c, i) => { const k = columnaDe(c); if (k && idx[k] === undefined) idx[k] = i; }); tabla = []; continue; }
      const primera = normalizar(textos[0]);
      if (primera.startsWith('SUBTOTAL') || primera === 'TOTAL' || primera.startsWith('TOTAL ')) {
        const dice = idx && idx.costo !== undefined ? num(f[idx.costo]) : num(f.filter(v => typeof v === 'number').at(-1));
        if (primera.startsWith('SUBTOTAL')) subtotales.push({ titulo, dice, suma: tabla.reduce((a, x) => a + (x.costo || 0), 0), viajes: tabla.length });
        else total = { dice, suma: out.reduce((a, x) => a + (x.costo || 0), 0) };
        continue;
      }
      if (!idx) { titulo = textos.join(' '); continue; }
      const v = (k) => (idx[k] === undefined ? null : f[idx[k]]);
      const vpl = numeroTexto(v('vpl'));
      const conductor = txt(v('conductor')).replace(/\s+/g, ' ');
      const placa = txt(v('placa')).replace(/[\s-]/g, '').toUpperCase();
      if (!vpl) {
        // Un número de remesa sin viaje (consecutivo saltado o anulado), o el título de la tabla siguiente
        const rem = numeroTexto(v('remesa'));
        if (textos.length === 1 && !rem) titulo = textos[0];
        else if (rem && !conductor && !placa) sinViaje.push(rem);
        continue;
      }
      const x = { vpl, fecha: parseFecha(v('fecha')), zona: txt(v('zona')).replace(/\s+/g, ' '), peso: num(v('peso')) || 0,
        manifiesto: txt(v('manifiesto')).replace(/\s+/g, ' ').toUpperCase(), conductor: conductor.toUpperCase(), placa,
        remesa: numeroTexto(v('remesa')), costo: num(v('costo')) || 0, grupo: grupoDe(titulo), tabla: titulo };
      out.push(x); tabla.push(x);
    }
  }
  return { filas: out, sinViaje, subtotales, total };
}

export async function leerBase(buffer) {
  const wb = await leerLibro(buffer);
  const r = leerFilas(wb.worksheets.map(ws => filas(ws)));
  if (!r.filas.length) throw new ErrorHttp(400, 'No se encontraron viajes. El Excel debe tener una fila de encabezado con VPL, CONDUCTOR y PLACA (y FECHA, ZONA, PESO, MANIFIESTO, REMESA, COSTO).');
  return r;
}

// ── Revisión ───────────────────────────────────────────────────────────────
const $ = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const ddmm = (d) => (d ? `${dia(d).slice(8, 10)}/${dia(d).slice(5, 7)}` : '');

// Avisos puros (sin base de datos), a partir de lo leído y de lo que ya está guardado
export function revisarBase({ filas: fs, sinViaje = [], subtotales = [], total = null }, { usadas = new Map(), siguiente = null, enBase = new Set() } = {}) {
  const avisos = [];
  const vplRep = [...new Set(fs.map(x => x.vpl).filter((v, i, a) => a.indexOf(v) !== i))];
  if (vplRep.length) avisos.push({ tipo: 'vpl_repetido', nivel: 'aviso', texto: `VPL repetido en el archivo: ${vplRep.join(', ')}. Solo se guarda una vez cada VPL.` });
  const nums = fs.map(x => x.remesa).filter(Boolean);
  const remRep = [...new Set(nums.filter((v, i, a) => a.indexOf(v) !== i))];
  if (remRep.length) avisos.push({ tipo: 'remesa_repetida', nivel: 'aviso', texto: `Número de remesa repetido en el archivo: ${remRep.join(', ')}.` });
  const ocupadas = fs.filter(x => x.remesa && usadas.has(x.remesa) && usadas.get(x.remesa) !== x.vpl);
  if (ocupadas.length) avisos.push({ tipo: 'remesa_usada', nivel: 'aviso', texto: `Remesas que ya tiene otro VPL en la base: ${ocupadas.map(x => `${x.remesa} (VPL ${usadas.get(x.remesa)})`).join(', ')}. Esos viajes no se pasan: corrija el número en el Excel o déjelo vacío para asignarle uno nuevo.` });
  if (sinViaje.length) avisos.push({ tipo: 'sin_viaje', nivel: 'aviso', texto: `En el archivo ${sinViaje.length === 1 ? 'está la remesa' : 'están las remesas'} ${sinViaje.join(', ')} sin viaje (salto en el consecutivo). ¿Se anuló?` });
  // Saltos dentro del rango del archivo que no se explican con las filas sin viaje
  const ns = [...new Set(nums.map(Number))].sort((a, b) => a - b);
  const huecos = [];
  for (let i = 1; i < ns.length; i++) for (let k = ns[i - 1] + 1; k < ns[i] && huecos.length < 20; k++) if (!sinViaje.includes(String(k)) && !enBase.has(k)) huecos.push(k);
  if (huecos.length) avisos.push({ tipo: 'salto', nivel: 'aviso', texto: `Faltan en el consecutivo: ${huecos.join(', ')}.` });
  for (const s of subtotales) {
    if (s.dice !== null && s.dice !== undefined && Math.abs(s.dice - s.suma) > 1) {
      avisos.push({ tipo: 'subtotal', nivel: 'aviso', texto: `El SUBTOTAL${s.titulo ? ` de «${s.titulo}»` : ''} dice ${$(s.dice)}, pero sus ${s.viajes} viajes suman ${$(s.suma)}. Revise la fórmula en el Excel.` });
    }
  }
  if (total && total.dice !== null && total.dice !== undefined && Math.abs(total.dice - total.suma) > 1) {
    avisos.push({ tipo: 'total', nivel: 'aviso', texto: `El TOTAL del Excel dice ${$(total.dice)}; el total real de los viajes es ${$(total.suma)}.` });
  }
  const sinNumero = fs.filter(x => !x.remesa).length;
  if (sinNumero) avisos.push({ tipo: 'asignar', nivel: 'info', texto: `${sinNumero} viaje(s) sin número de remesa: se les asigna el consecutivo${siguiente ? ` desde la ${siguiente}` : ''}, sin repetir los números que ya se usaron.` });
  return avisos;
}

// ── Datos del conductor (cédula y dirección) ───────────────────────────────
const nombreTercero = (t) => normalizar(`${t.nombres || ''} ${t.apellido1 || ''} ${t.apellido2 || ''}`);
export function buscarPorNombre(nombre, terceros) {
  const n = normalizar(nombre);
  if (!n) return null;
  const exacto = terceros.filter(t => nombreTercero(t) === n);
  if (exacto.length === 1) return exacto[0];
  const palabras = n.split(' ').filter(p => p.length > 1);
  if (palabras.length < 2) return null;
  const parecidos = terceros.filter(t => { const tn = ` ${nombreTercero(t)} `; return palabras.every(p => tn.includes(` ${p} `)); });
  return parecidos.length === 1 ? parecidos[0] : null;
}

async function directorioConductores(empresaId, lista) {
  const terceros = await Tercero.find({ empresa: empresaId, roles: 'conductor' }).select('numId nombres apellido1 apellido2 direccion codMunicipio').lean();
  const placas = [...new Set(lista.map(x => x.placa).filter(Boolean))];
  const vehiculos = placas.length ? await Vehiculo.find({ empresa: empresaId, placa: { $in: placas } }).select('placa conductorHabitual').lean() : [];
  const porId = new Map(terceros.map(t => [String(t._id), t]));
  const habitual = new Map(vehiculos.filter(v => v.conductorHabitual).map(v => [v.placa, porId.get(String(v.conductorHabitual))]));
  // Remesas anteriores con cédula (la que se escribió una vez sirve para las próximas)
  const previas = await RemesaDulces.find({ empresa: empresaId, cedula: { $ne: '' } }).sort({ updatedAt: -1 }).limit(3000).select('conductor cedula direccion').lean();
  const anteriores = new Map();
  for (const p of previas) { const k = normalizar(p.conductor); if (k && !anteriores.has(k)) anteriores.set(k, p); }
  const codigos = [...new Set(terceros.map(t => t.codMunicipio).filter(Boolean))];
  const munis = codigos.length ? await Municipio.find({ codigo: { $in: codigos } }).select('codigo nombre departamento').lean() : [];
  const municipio = new Map(munis.map(m => [m.codigo, m]));
  const titulo = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (a, b, c) => b + c.toUpperCase());
  const direccionDe = (t) => { const m = municipio.get(t.codMunicipio); return m ? `${titulo(m.nombre)} - ${titulo(m.departamento)}` : (t.direccion || ''); };
  return (x) => {
    let t = buscarPorNombre(x.conductor, terceros);
    if (!t) { const h = habitual.get(x.placa); if (h && normalizar(x.conductor).split(' ').some(p => p.length > 2 && nombreTercero(h).includes(p))) t = h; }
    if (t) return { cedula: t.numId, direccion: direccionDe(t), fuente: 'registro' };
    const a = anteriores.get(normalizar(x.conductor));
    if (a) return { cedula: a.cedula, direccion: a.direccion || '', fuente: 'remesa' };
    return { cedula: '', direccion: '', fuente: '' };
  };
}

// Viajes de la bitácora con la misma placa y el mismo día
async function viajesQueCoinciden(empresaId, lista) {
  const fechas = lista.map(x => x.fecha).filter(Boolean).map(d => +d);
  const placas = [...new Set(lista.map(x => x.placa).filter(Boolean))];
  if (!fechas.length || !placas.length) return () => null;
  const desde = new Date(Math.min(...fechas)); const hasta = new Date(Math.max(...fechas) + 86400000);
  const vs = await Viaje.find({ empresa: empresaId, placa: { $in: placas }, fecha: { $gte: desde, $lt: hasta }, estado: { $ne: 'anulado' } })
    .select('numero placa fecha destino').sort({ numero: 1 }).lean();
  const mapa = new Map();
  for (const v of vs) { const k = `${v.placa}|${dia(v.fecha)}`; if (!mapa.has(k)) mapa.set(k, []); mapa.get(k).push(v); }
  return (x) => mapa.get(`${x.placa}|${dia(x.fecha)}`) || null;
}

async function empresaConFormato(empresaId) {
  // Solo «+»: trae todo el documento más los logos (pedir también «remesaFormato» choca en MongoDB)
  return Empresa.findById(empresaId).select('+remesaFormato.logo +logo').lean();
}

// Remesa más alta ya usada en la empresa (también las cargadas antes de la fase 12)
export async function maxUsado(empresaId) {
  const x = await RemesaDulces.findOne({ empresa: empresaId, remesaNum: { $ne: null } }).sort({ remesaNum: -1 }).select('remesaNum').lean();
  return x?.remesaNum || 0;
}

// ── Vista previa y guardado ────────────────────────────────────────────────
// Antes de la fase 12 el VPL era único por empresa; ahora es único por empresa y cliente (se quita el índice viejo una vez).
// Las remesas de antes no tenían remesaNum: se llena desde «remesa» para que el consecutivo las tenga en cuenta.
let indicesListos = null;
export function completarNumeros() {
  return RemesaDulces.collection.updateMany({ remesaNum: null, remesa: { $regex: /^\d{1,9}$/ } },
    [{ $set: { remesaNum: { $convert: { input: '$remesa', to: 'long', onError: null, onNull: null } } } }]).catch(() => null);
}
export function prepararIndices() {
  indicesListos ||= RemesaDulces.collection.dropIndex('empresa_1_vpl_1').catch(() => null)
    .then(() => RemesaDulces.syncIndexes().catch(() => null)).then(completarNumeros);
  return indicesListos;
}

export async function previa(empresaId, clienteId, buffer) {
  await prepararIndices();
  const base = await leerBase(buffer);
  // Los de antes de la fase 12 no tienen cliente: se reconocen por el VPL y se le asignan al cliente al guardar
  const existentes = await RemesaDulces.find({ empresa: empresaId, cliente: { $in: [clienteId || null, null] }, vpl: { $in: base.filas.map(x => x.vpl) } }).lean();
  const porVpl = new Map();
  for (const x of existentes) if (!porVpl.has(x.vpl) || x.cliente) porVpl.set(x.vpl, x);
  const nums = base.filas.map(x => x.remesa).filter(Boolean);
  const usadasDocs = nums.length ? await RemesaDulces.find({ empresa: empresaId, $or: [{ remesa: { $in: nums } }, { remesaNum: { $in: nums.map(Number) } }] }).select('remesa remesaNum vpl cliente').lean() : [];
  // Un número es del mismo viaje si es el mismo VPL del cliente (o el registro viejo sin cliente de ese VPL)
  const delMismo = (u, x) => u.vpl === x.vpl && (!u.cliente || String(u.cliente) === String(clienteId || ''));
  const usadas = new Map();
  for (const u of usadasDocs) {
    const k = u.remesa || String(u.remesaNum);
    usadas.set(k, !u.cliente || String(u.cliente) === String(clienteId || '') ? u.vpl : `${u.vpl} de otro cliente`);
  }
  const conflictoDe = (x, i) => {
    if (!x.remesa) return '';
    const otro = usadasDocs.find(u => (u.remesa === x.remesa || u.remesaNum === Number(x.remesa)) && !delMismo(u, x));
    if (otro) return `La remesa ${x.remesa} ya la tiene el VPL ${otro.vpl}${otro.cliente && String(otro.cliente) !== String(clienteId || '') ? ' de otro cliente' : ''}`;
    const antes = base.filas.findIndex(y => y.remesa === x.remesa);
    if (antes < i && base.filas[antes].vpl !== x.vpl) return `La remesa ${x.remesa} está repetida en el archivo (VPL ${base.filas[antes].vpl})`;
    return '';
  };
  const min = nums.length ? Math.min(...nums.map(Number)) : 0; const max = nums.length ? Math.max(...nums.map(Number)) : 0;
  const enBase = new Set(nums.length ? (await RemesaDulces.distinct('remesaNum', { empresa: empresaId, remesaNum: { $gte: min, $lte: max } })).map(Number) : []);
  const empresa = await empresaConFormato(empresaId);
  const siguiente = Math.max(empresa?.remesaFormato?.siguiente || 1, (await maxUsado(empresaId)) + 1);
  const conductor = await directorioConductores(empresaId, base.filas);
  const enBitacora = await viajesQueCoinciden(empresaId, base.filas);
  const filasOut = base.filas.map((x, i) => {
    const e = porVpl.get(x.vpl);
    const cambios = e ? CAMPOS.filter(k => (k === 'fecha' ? dia(e.fecha) !== dia(x.fecha) : String(e[k] ?? '') !== String(x[k] ?? ''))).filter(k => !(k === 'remesa' && !x.remesa)) : [];
    const c = conductor(x); const vs = enBitacora(x);
    const conflicto = conflictoDe(x, i);
    return { ...x, fecha: dia(x.fecha), estado: conflicto ? 'conflicto' : !e ? 'nuevo' : cambios.length ? 'cambio' : 'existe', cambios, conflicto,
      remesaActual: e?.remesa || '', impreso: !!e?.impreso, legado: !!e && !e.cliente,
      cedula: e?.cedula || c.cedula, direccion: e?.direccion || c.direccion, bitacora: vs ? vs.map(v => ({ _id: v._id, numero: v.numero, destino: v.destino })) : [] };
  });
  const avisos = revisarBase(base, { usadas, siguiente, enBase });
  const legado = filasOut.filter(x => x.legado).length;
  if (legado) avisos.push({ tipo: 'legado', nivel: 'info', texto: `${legado} viaje(s) ya estaban en la base de remesas anterior (sin cliente): al pasarlos quedan de este cliente y conservan su número.` });
  const impresas = filasOut.filter(x => x.impreso && x.estado === 'cambio').length;
  if (impresas) avisos.push({ tipo: 'impresas', nivel: 'aviso', texto: `${impresas} viaje(s) cambiaron en el Excel pero su remesa ya se imprimió: no se reemplazan. Si hace falta, corríjalos uno por uno en la base.` });
  const coinciden = filasOut.filter(x => x.bitacora.length);
  if (coinciden.length) {
    avisos.unshift({ tipo: 'bitacora', nivel: 'aviso', texto: `${coinciden.length} viaje(s) coinciden con la bitácora de la plataforma (misma placa y mismo día): ${coinciden.slice(0, 12).map(x => `${x.placa} ${ddmm(x.fecha)} (viaje N° ${x.bitacora.map(b => b.numero).join(', ')})`).join(' · ')}${coinciden.length > 12 ? '…' : ''}. Revise que no sea el mismo viaje registrado dos veces.` });
  }
  const fuera = filasOut.length - coinciden.length;
  if (fuera) avisos.push({ tipo: 'no_bitacora', nivel: 'info', texto: `${fuera} viaje(s) no están en la bitácora de la plataforma.` });
  const sinCed = [...new Set(filasOut.filter(x => !x.cedula).map(x => `${x.conductor} (${x.placa})`))];
  if (sinCed.length) avisos.push({ tipo: 'sin_cedula', nivel: 'aviso', texto: `Sin cédula en el registro: ${sinCed.join(', ')}. Escríbala en la base de remesas y queda guardada para las próximas.` });
  if (!avisos.some(a => a.nivel === 'aviso')) avisos.push({ tipo: 'ok', nivel: 'ok', texto: 'Sin problemas en el archivo' });
  const cuenta = (e) => filasOut.filter(x => x.estado === e).length;
  return { filas: filasOut, avisos, resumen: { viajes: filasOut.length, nuevos: cuenta('nuevo'), existen: cuenta('existe'), cambian: cuenta('cambio'), conflictos: cuenta('conflicto'),
    coinciden: coinciden.length, total: filasOut.reduce((a, x) => a + x.costo, 0) }, siguiente };
}

// Toma el siguiente número libre del consecutivo (atómico): salta los que ya están en la base o en el archivo
async function reservar(empresaId, ocupados) {
  const max = await maxUsado(empresaId);
  // El consecutivo nunca queda por debajo de una remesa ya usada (por ejemplo, las cargadas antes de la fase 12)
  await Empresa.updateOne({ _id: empresaId, $or: [{ 'remesaFormato.siguiente': { $lte: max } }, { 'remesaFormato.siguiente': null }] }, { $set: { 'remesaFormato.siguiente': max + 1 } });
  for (let intentos = 0; intentos < 100000; intentos++) {
    const e = await Empresa.findByIdAndUpdate(empresaId, { $inc: { 'remesaFormato.siguiente': 1 } }, { new: false }).select('remesaFormato.siguiente').lean();
    const n = e?.remesaFormato?.siguiente || 1;
    if (ocupados.has(n)) continue;
    if (await RemesaDulces.exists({ empresa: empresaId, $or: [{ remesaNum: n }, { remesa: String(n) }] })) continue;
    return n;
  }
  throw new ErrorHttp(500, 'No se pudo asignar el número de remesa');
}

// seleccion = { excluir: boolean, vpls: Set } (ver leerSeleccion)
export async function guardar(empresaId, clienteId, buffer, { modo = 'omitir', seleccion = null, archivo = '' } = {}) {
  const p = await previa(empresaId, clienteId, buffer);
  const vistos = new Set();
  let lista = p.filas.filter(x => { if (vistos.has(x.vpl)) return false; vistos.add(x.vpl); return true; });
  if (seleccion) lista = lista.filter(x => seleccion.vpls.has(x.vpl) !== seleccion.excluir);
  // No se pasan: los que tienen un número de remesa de otro viaje, ni se reemplazan los que ya se imprimieron
  const conflictos = lista.filter(x => x.estado === 'conflicto');
  const impresasSinCambio = lista.filter(x => x.estado !== 'nuevo' && x.estado !== 'conflicto' && x.impreso && modo === 'reemplazar');
  const aGuardar = lista.filter(x => x.estado !== 'conflicto' && (x.estado === 'nuevo' || (modo === 'reemplazar' && !x.impreso)));
  const omitidos = lista.length - aGuardar.length - conflictos.length;
  // Registro actual de cada VPL (del cliente o el de antes de la fase 12 sin cliente)
  const actuales = new Map();
  for (const x of await RemesaDulces.find({ empresa: empresaId, cliente: { $in: [clienteId || null, null] }, vpl: { $in: aGuardar.map(x => x.vpl) } }).select('vpl remesa cliente').lean()) {
    if (!actuales.has(x.vpl) || x.cliente) actuales.set(x.vpl, x);
  }
  // Consecutivo para los que llegan sin número (los que ya existen conservan el suyo)
  const ocupados = new Set(aGuardar.map(x => Number(x.remesa)).filter(Boolean));
  for (const x of aGuardar) if (!x.remesa && !actuales.get(x.vpl)?.remesa) x.remesa = String(await reservar(empresaId, ocupados));
  let nuevos = 0; let reemplazados = 0;
  for (const x of aGuardar) {
    const actual = actuales.get(x.vpl);
    const remesa = x.remesa || actual?.remesa || '';
    const d = { cliente: clienteId || null, fecha: parseFecha(x.fecha), zona: x.zona, peso: x.peso, manifiesto: x.manifiesto, conductor: x.conductor, placa: x.placa, remesa,
      remesaNum: remesa ? Number(remesa) : null, costo: x.costo, grupo: x.grupo, archivo: String(archivo || '').slice(0, 150), viaje: x.bitacora[0]?._id || null };
    if (x.cedula) { d.cedula = x.cedula; d.direccion = x.direccion; }
    if (actual) { await RemesaDulces.updateOne({ _id: actual._id, empresa: empresaId }, { $set: d }); reemplazados += 1; }
    else { await RemesaDulces.create({ empresa: empresaId, vpl: x.vpl, ...d }); nuevos += 1; }
  }
  // Los de antes de la fase 12 que no se reemplazan (omitidos o ya impresos) igual quedan de este cliente
  const adoptar = lista.filter(x => x.legado && x.estado !== 'conflicto' && !aGuardar.includes(x)).map(x => x.vpl);
  if (adoptar.length) await RemesaDulces.updateMany({ empresa: empresaId, cliente: null, vpl: { $in: adoptar } }, { $set: { cliente: clienteId } });
  // El consecutivo sigue después de la remesa más alta guardada
  const max = Math.max(0, ...aGuardar.map(x => Number(x.remesa) || 0));
  if (max) await Empresa.updateOne({ _id: empresaId, 'remesaFormato.siguiente': { $lte: max } }, { $set: { 'remesaFormato.siguiente': max + 1 } });
  const e = await Empresa.findById(empresaId).select('remesaFormato.siguiente').lean();
  return { leidos: p.filas.length, nuevos, reemplazados, omitidos, conflictos: conflictos.map(x => ({ vpl: x.vpl, motivo: x.conflicto })),
    impresasSinCambio: impresasSinCambio.map(x => x.vpl), sinCedula: [...new Set(aGuardar.filter(x => !x.cedula).map(x => x.conductor))], siguiente: e?.remesaFormato?.siguiente || 1 };
}

// Selección de viajes que manda la pantalla en la cabecera X-Seleccion, compacta para no pasar el límite de las cabeceras:
// «i:12400-12417,12430» (pasar solo esos) o «e:12431» (pasar todos menos esos). Un rango a-b son los VPL del archivo entre a y b.
export function leerSeleccion(texto, vplsArchivo) {
  const m = /^([ie]):([\d,-]*)$/.exec(String(texto || '').trim());
  if (!m) throw new ErrorHttp(400, 'Selección de viajes inválida');
  const vpls = new Set();
  for (const parte of m[2].split(',').filter(Boolean)) {
    const [a, b] = parte.split('-');
    if (!/^\d+$/.test(a) || (b !== undefined && !/^\d+$/.test(b))) throw new ErrorHttp(400, 'Selección de viajes inválida');
    if (b === undefined) { vpls.add(a); continue; }
    for (const v of vplsArchivo) if (Number(v) >= Number(a) && Number(v) <= Number(b)) vpls.add(v);
  }
  return { excluir: m[1] === 'e', vpls };
}

// ── Formato (encabezado de la empresa + datos fijos del cliente) ──────────
export function formatoPorDefecto(empresa, cliente) {
  const rf = empresa?.remesaFormato || {}; const cf = cliente?.remesaFormato || {};
  return {
    logo: rf.logo || empresa?.logo || '', nombre1: rf.nombre1 || (empresa?.nombre || '').toUpperCase(), nombre2: rf.nombre2 || '',
    nit: rf.nit || (empresa?.nit ? `NIT.${empresa.nit}${empresa.dv ? `-${empresa.dv}` : ''}` : ''), lema: rf.lema || '', resolucion: rf.resolucion || '',
    siguiente: rf.siguiente || 1, porHoja: rf.porHoja || 2, linea: rf.linea !== false,
    logoCliente: cf.logo || '', remitente: cf.remitente || cliente?.razonSocial || cliente?.nombre || '', ciudadOrigen: cf.ciudadOrigen || empresa?.ciudad || '',
    direccion: cf.direccion || '', sector: cf.sector || '', destinatario: cf.destinatario || 'Varios Clientes',
    cantidad: cf.cantidad || 'Lote', clase: cf.clase || 'Cajas', contenido: cf.contenido || 'Varios Productos',
  };
}
export async function formato(empresaId, clienteId) {
  await prepararIndices();
  const empresa = await empresaConFormato(empresaId);
  const cliente = clienteId ? await Cliente.findOne({ _id: clienteId, empresa: empresaId }).select('+remesaFormato.logo').lean() : null;
  const f = formatoPorDefecto(empresa, cliente);
  f.siguiente = Math.max(f.siguiente, (await maxUsado(empresaId)) + 1);
  return f;
}

// ── PDF con el formato de la remesa ────────────────────────────────────────
export function fechaLarga(d, ciudadOrigen = '') {
  if (!d) return '';
  const f = new Date(d); const ciudad = String(ciudadOrigen || '').split('-')[0].trim();
  return `${ciudad ? `${ciudad},  ` : ''}${f.getUTCDate()} de ${MESES[f.getUTCMonth()]} de ${f.getUTCFullYear()}`;
}
export const pesoTexto = (n) => Number(n || 0).toFixed(1).replace('.', ',');
export const fleteTexto = (n) => Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const AZUL = '#BDE3F7'; const CELESTE = '#EEF7FD'; const ROJO = '#C00000'; const TINTA = '#0B1A3A';

function imagenEn(doc, dataUrl, x, y, w, h) {
  if (!dataUrl) return;
  doc._logosRemesa ||= new Map();
  let img = doc._logosRemesa.get(dataUrl);
  if (img === undefined) {
    const buf = imagenDeDataUrl(dataUrl);
    try { img = buf ? doc.openImage(buf) : null; } catch { img = null; }   // imagen dañada: se omite
    doc._logosRemesa.set(dataUrl, img);
  }
  if (!img) return;
  try { doc.image(img, x, y, { fit: [w, h], align: 'center', valign: 'center' }); } catch { /* se omite */ }
}

// Dibuja una remesa en (ox, oy) con ancho W (556 pt en hoja carta con márgenes de 28 pt)
export function dibujarRemesa(doc, x, f, ox, oy, W = 556) {
  const s = W / 556; const X = (v) => ox + v * s; const Y = (v) => oy + v * s;
  const txtEn = (t, x0, y0, o = {}) => doc.text(String(t ?? ''), X(x0), Y(y0), { lineBreak: false, ...o, width: o.width ? o.width * s : undefined });
  doc.save(); doc.lineWidth(0.6).strokeColor('#333333').fillColor('#000000');
  // Encabezado
  imagenEn(doc, f.logo, X(0), Y(6), 150 * s, 58 * s);
  doc.font('Helvetica-Bold').fontSize(10.5 * s).fillColor(TINTA);
  txtEn(f.nombre1, 150, 4, { width: 290, align: 'center' });
  if (f.nombre2) txtEn(f.nombre2, 150, 17, { width: 290, align: 'center' });
  doc.font('Helvetica-BoldOblique').fontSize(8.5 * s).fillColor('#000000'); txtEn(f.nit, 150, 31, { width: 290, align: 'center' });
  if (f.lema) {
    doc.font('Times-BoldItalic').fontSize(9.5 * s); txtEn(f.lema, 150, 43, { width: 290, align: 'center' });
    const w = Math.min(doc.widthOfString(f.lema), 290 * s); const x0 = X(150) + (290 * s - w) / 2;
    doc.moveTo(x0, Y(52.5)).lineTo(x0 + w, Y(52.5)).lineWidth(0.5).strokeColor('#000000').stroke().lineWidth(0.6).strokeColor('#333333');
  }
  if (f.resolucion) { doc.font('Helvetica-Oblique').fontSize(6 * s); doc.text(f.resolucion, X(150), Y(56), { width: 290 * s, align: 'center', height: 18 * s }); }
  // Logo del cliente y recuadro de la remesa
  imagenEn(doc, f.logoCliente, X(446), Y(0), 110 * s, 34 * s);
  doc.rect(X(446), Y(38), 110 * s, 12 * s).fillAndStroke(AZUL, '#333333');
  doc.fillColor('#000000').font('Helvetica-BoldOblique').fontSize(8 * s); txtEn('REMESA', 446, 41, { width: 110, align: 'center' });
  doc.rect(X(446), Y(50), 110 * s, 14 * s).stroke();
  doc.fillColor(ROJO).font('Helvetica-BoldOblique').fontSize(8 * s); txtEn('VPL No:', 450, 54);
  doc.fillColor('#000000').fontSize(9.5 * s); txtEn(x.vpl, 486, 53);
  doc.rect(X(446), Y(64), 110 * s, 22 * s).stroke();
  doc.fillColor(ROJO).font('Helvetica-BoldOblique').fontSize(11 * s); txtEn('No:', 452, 70);
  doc.fontSize(14 * s); txtEn(x.remesa, 478, 68);
  // Fecha, remitente, destinatario
  const by = 96;
  doc.rect(X(0), Y(by), W, 42 * s).stroke();
  const etiqueta = (t, x0, y0, o) => { doc.font('Helvetica-Bold').fontSize(7.5 * s).fillColor('#000000'); txtEn(t, x0, y0, o); };
  const valor = (t, x0, y0, w, align = 'center', linea = true) => {
    doc.font('Helvetica-Oblique').fontSize(7.5 * s).fillColor('#000000'); txtEn(t, x0, y0, { width: w, align, ellipsis: true });
    if (linea) doc.moveTo(X(x0), Y(y0 + 10)).lineTo(X(x0 + w), Y(y0 + 10)).lineWidth(0.4).strokeColor('#777777').stroke().lineWidth(0.6).strokeColor('#333333');
  };
  etiqueta('FECHA DESPACHO', 4, by + 8); valor(fechaLarga(x.fecha, f.ciudadOrigen), 80, by + 7, 155);
  etiqueta('REMITENTE.', 250, by + 8); valor(f.remitente, 300, by + 7, 120);
  valor(f.direccion, 428, by + 7, 124, 'center', false);
  etiqueta('DESTINATARIO.', 4, by + 25); valor(f.destinatario, 80, by + 24, 150, 'left');
  etiqueta('CIUDAD. ORIGEN', 240, by + 25); valor(f.ciudadOrigen, 306, by + 24, 76);
  etiqueta('DIRECCIÓN.', 388, by + 25); valor(f.sector, 438, by + 24, 114);
  // Tabla de bultos y detalle
  const ty = 144; const col = [0, 75, 120, 260, 320, 410, 556];
  doc.rect(X(0), Y(ty), W, 24 * s).fillAndStroke(AZUL, '#333333');
  doc.fillColor('#000000').font('Helvetica-Bold').fontSize(7.5 * s);
  const centro = (t, a, b, y0) => txtEn(t, a, y0, { width: b - a, align: 'center' });
  centro('BULTOS', 0, 120, ty + 3); centro('S/G FACTURA VR. M/CIA.$', 120, 260, ty + 3); centro('DETALLE', 260, 410, ty + 3); centro('FLETE', 410, 556, ty + 9);
  centro('CANTIDAD', 0, 75, ty + 15); centro('CLASE', 75, 120, ty + 15); centro('CONTENIDO', 120, 260, ty + 15); centro('PESO', 260, 320, ty + 15); centro('MANIFIESTO', 320, 410, ty + 15);
  doc.moveTo(X(0), Y(ty + 12)).lineTo(X(410), Y(ty + 12)).stroke();
  for (const c of [120, 260, 410]) doc.moveTo(X(c), Y(ty)).lineTo(X(c), Y(ty + 24)).stroke();
  for (const c of [75, 320]) doc.moveTo(X(c), Y(ty + 12)).lineTo(X(c), Y(ty + 24)).stroke();
  const dy = ty + 24;
  for (let i = 0; i < 3; i++) doc.rect(X(0), Y(dy + 13 + i * 11), W, 11 * s).fill(CELESTE);
  doc.strokeColor('#BBBBBB').lineWidth(0.4);
  for (let i = 0; i <= 3; i++) doc.moveTo(X(0), Y(dy + 13 + i * 11)).lineTo(X(556), Y(dy + 13 + i * 11)).stroke();
  for (const c of col.slice(1, -1)) doc.moveTo(X(c), Y(dy)).lineTo(X(c), Y(dy + 46)).stroke();
  doc.strokeColor('#333333').lineWidth(0.6).rect(X(0), Y(ty), W, 70 * s).stroke();
  doc.fillColor('#000000').font('Helvetica-Oblique').fontSize(7.5 * s);
  txtEn(f.cantidad, 3, dy + 3, { width: 70, ellipsis: true }); txtEn(f.clase, 78, dy + 3, { width: 40, ellipsis: true }); txtEn(f.contenido, 123, dy + 3, { width: 135, ellipsis: true });
  txtEn(pesoTexto(x.peso), 262, dy + 3, { width: 55, align: 'right' }); txtEn(x.manifiesto, 322, dy + 3, { width: 86, align: 'center', ellipsis: true });
  txtEn('$', 414, dy + 3); txtEn(fleteTexto(x.costo), 425, dy + 3, { width: 128, align: 'right' });
  // Ruta y anexo
  const ry = ty + 70;
  doc.rect(X(0), Y(ry), W, 13 * s).stroke(); doc.rect(X(0), Y(ry + 13), W, 13 * s).stroke();
  doc.font('Helvetica-BoldOblique').fontSize(7.5 * s); txtEn('RUTA/ZONA:', 4, ry + 3);
  doc.font('Helvetica').fontSize(7.5 * s); txtEn(x.zona, 80, ry + 3, { width: 470, ellipsis: true });
  doc.font('Helvetica-BoldOblique'); txtEn('ANEXO:', 4, ry + 16);
  doc.font('Helvetica-Bold'); txtEn('Remision No:', 260, ry + 16); txtEn('Factura No:', 410, ry + 16);
  // Conductor
  const cy = ry + 31;
  doc.rect(X(0), Y(cy), W, 28 * s).stroke();
  etiqueta('CONDUCTOR', 4, cy + 4); etiqueta('C.C:', 225, cy + 4); etiqueta('DIRECCION:', 336, cy + 4); etiqueta('PLACA', 448, cy + 4);
  doc.font('Helvetica-Oblique').fontSize(7.5 * s);
  const cc = String(x.cedula || '').replace(/\D/g, '');
  txtEn(x.conductor, 4, cy + 17, { width: 218, ellipsis: true });
  txtEn(cc ? Number(cc).toLocaleString('es-CO') : '', 225, cy + 17, { width: 106, align: 'right' });
  txtEn(x.direccion, 336, cy + 17, { width: 108, ellipsis: true }); txtEn(x.placa, 448, cy + 17);
  // Pie
  const py = cy + 33;
  doc.rect(X(0), Y(py), W, 13 * s).stroke();
  doc.font('Helvetica-BoldOblique').fontSize(7.5 * s); txtEn('La Empresa', 4, py + 3); txtEn('Recibí Destinatario C.C. No.', 300, py + 3);
  doc.restore();
  return py + 13;   // alto usado (en unidades de diseño)
}

// items = [{ x: remesa, f: formato }] ya ordenados · porHoja 1 (mitad de arriba) o 2 (arriba y abajo) · linea = línea para cortar
export async function remesasPdfVarios(items, { porHoja = 2, linea = true } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, info: { Title: items.length === 1 ? `Remesa ${items[0].x.remesa}` : 'Remesas' } });
  const mitad = doc.page.height / 2;
  items.forEach(({ x, f }, i) => {
    const abajo = porHoja === 2 && i % 2 === 1;
    if (i > 0 && !abajo) doc.addPage();
    dibujarRemesa(doc, x, f, 28, abajo ? mitad + 20 : 22);
    if (linea && !abajo) {
      doc.save().dash(4, { space: 3 }).lineWidth(0.6).strokeColor('#555555').moveTo(10, mitad).lineTo(doc.page.width - 10, mitad).stroke().undash();
      doc.rect(doc.page.width / 2 - 34, mitad - 5, 68, 10).fill('#FFFFFF');
      doc.fillColor('#555555').font('Helvetica-Bold').fontSize(7).text('cortar aquí', doc.page.width / 2 - 34, mitad - 3.5, { width: 68, align: 'center', lineBreak: false });
      doc.restore();
    }
  });
  return pdfABuffer(doc, { marca: false });
}
export const remesasPdf = (f, lista, opciones) => remesasPdfVarios(lista.map(x => ({ x, f })), opciones);

// Un PDF por remesa (media hoja de arriba, sin línea) dentro de un .zip
export async function remesasZipVarios(items) {
  const zip = new JSZip();
  for (const it of items) zip.file(`Remesa_${it.x.remesa || 'sin_numero'}_VPL_${it.x.vpl}.pdf`, await remesasPdfVarios([it], { porHoja: 1, linea: false }));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export const fechaValida = (v) => parseFecha(v);

// Orden de impresión: por número de remesa y luego por VPL
export const ordenar = (lista) => [...lista].sort((a, b) => (Number(a.remesa) || Infinity) - (Number(b.remesa) || Infinity) || Number(a.vpl) - Number(b.vpl));
