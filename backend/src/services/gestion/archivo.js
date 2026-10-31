// Archivo de la empresa en el servidor: respaldos completos, copia e informes de cada mes cerrado
// y los PDF de manifiestos por empresa (cliente) y mes. Carpeta: ARCHIVO_DIR/<empresa>/<aaaa-mm>/
//   respaldo-<aaaa-mm>.json.gz      copia completa de los datos de la empresa al cerrar
//   informes/Viajes <cliente>.xlsx  viajes del mes de cada cliente
//   informes/Utilidad por empresa.xlsx
//   manifiestos/<cliente>/Manifiesto_<n>.pdf (y soportes internos MC)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import * as M from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { fmtFecha } from '../../utils/texto.js';
import { libroExcel } from '../reportes/comun.js';
import { lineaLiquidacion, respaldosAuxiliar } from '../calculos.js';
import { datosManifiesto, manifiestoPdf, nombreArchivo } from '../reportes/manifiesto.js';
import { soporteInterno } from './soporteInterno.js';

const BASE_POR_DEFECTO = process.env.NODE_ENV === 'test'
  ? path.join(os.tmpdir(), `translogistica-archivo-${process.pid}`)
  : fileURLToPath(new URL('../../../archivo', import.meta.url));
export const carpetaBase = () => path.resolve(process.env.ARCHIVO_DIR || BASE_POR_DEFECTO);
const carpetaEmpresa = (empresaId) => path.join(carpetaBase(), String(empresaId));
const limpio = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sin_nombre';
const rangoMes = (mes) => { const [a, m] = mes.split('-').map(Number); return { desde: new Date(Date.UTC(a, m - 1, 1)), hasta: new Date(Date.UTC(a, m, 0, 23, 59, 59)) }; };

// Colecciones de la empresa que entran en el respaldo (sin claves ni secretos)
const COLECCIONES = [['clientes', 'Cliente'], ['tarifas', 'Tarifa'], ['terceros', 'Tercero'], ['vehiculos', 'Vehiculo'], ['viajes', 'Viaje'],
  ['liquidaciones', 'Liquidacion'], ['liquidacionesConductor', 'LiquidacionConductor'], ['prestamos', 'Prestamo'], ['cuentas', 'CuentaContable'],
  ['asientos', 'Asiento'], ['facturas', 'FacturaCont'], ['proveedores', 'ProveedorCont'], ['compras', 'CompraCont'], ['egresos', 'EgresoCont'],
  ['conciliaciones', 'ConciliacionCont'], ['empleados', 'Empleado'], ['nominas', 'Nomina'], ['activos', 'ActivoFijo'], ['remesasDulces', 'RemesaDulces'], ['plantillasWhatsapp', 'PlantillaWhatsapp'],
  ['enviosCorreo', 'EnvioCorreo'], ['contadores', 'Contador'], ['autorizaciones', 'Autorizacion'], ['recorridos', 'RecorridoRastreo'],
  ['transaccionesRndc', 'TransaccionRndc'], ['auditoria', 'Auditoria']];

// Respaldo completo como líneas JSON (EJSON canónico: conserva identificadores y fechas), comprimido con gzip
export async function escribirRespaldo(empresaId, destino) {
  const { EJSON } = mongoose.mongo.BSON;
  const gz = zlib.createGzip();
  const salida = pipeline(gz, destino);
  const linea = (coleccion, doc) => new Promise(res => { if (gz.write(`${EJSON.stringify({ coleccion, doc }, { relaxed: false })}\n`)) res(); else gz.once('drain', res); });
  const empresa = await M.Empresa.findById(empresaId).lean();
  await linea('respaldo', { version: 1, fecha: new Date(), empresa: empresa?.nombre, nit: empresa?.nit });
  await linea('empresa', empresa);
  for (const u of await M.Usuario.find({ empresa: empresaId }).lean()) await linea('usuarios', u);   // sin passwordHash ni secretos (select: false)
  for (const [nombre, modelo] of COLECCIONES) {
    for await (const doc of M[modelo].find({ empresa: empresaId }).lean().cursor()) await linea(nombre, doc);
  }
  gz.end();
  await salida;
}

async function guardar(empresaId, relativo, contenido) {
  const destino = path.join(carpetaEmpresa(empresaId), relativo);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  await fs.promises.writeFile(destino, contenido);
  return relativo.split(path.sep).join('/');
}

export async function guardarRespaldo(empresaId, nombre) {
  const relativo = path.join(nombre.includes('/') ? '' : 'respaldos', nombre);
  const destino = path.join(carpetaEmpresa(empresaId), relativo);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  await escribirRespaldo(empresaId, fs.createWriteStream(destino));
  return relativo.split(path.sep).join('/');
}

// Informes del mes por empresa (cliente): viajes de cada cliente y la utilidad por empresa
export async function informesMes(empresaId, mes) {
  const { desde, hasta } = rangoMes(mes);
  const empresa = await M.Empresa.findById(empresaId).lean();
  const viajes = await M.Viaje.find({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta }, estado: { $ne: 'anulado' } }).sort({ fecha: 1, numero: 1 })
    .populate(M.pob(empresaId, 'cliente', 'nombre politicaAuxiliar valorAuxiliarSinAnticipo')).lean();
  const tarifas = await M.Tarifa.find({ empresa: empresaId }).lean();
  const porId = new Map(tarifas.map(t => [String(t._id), t])); const respaldo = respaldosAuxiliar(tarifas);
  const grupos = new Map();
  for (const v of viajes) {
    const k = v.cliente?.nombre || '(sin cliente)';
    const l = lineaLiquidacion(v, porId.get(String(v.tarifaRef)), { respaldo: respaldo.get(String(v.cliente?._id)), cliente: v.cliente });
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push({ v, l });
  }
  const archivos = [];
  const PESOS = '#,##0';
  const columnas = [['N°', 6], ['Fecha', 12], ['Placa', 10], ['Conductor', 30], ['Destino', 26], ['Manifiesto', 14], ['Cobrado', 14, PESOS], ['Auxiliar cobrado', 14, PESOS],
    ['Flete', 14, PESOS], ['Auxiliar pagado', 14, PESOS], ['Anticipo', 14, PESOS], ['Utilidad', 14, PESOS]].map(([titulo, ancho, formato]) => ({ titulo, ancho, formato }));
  const resumen = [];
  for (const [cliente, lista] of grupos) {
    const suma = (f) => lista.reduce((a, x) => a + f(x), 0);
    const filas = lista.map(({ v, l }) => [v.numero, fmtFecha(v.fecha), v.placa, v.conductorNombre, v.destino, v.manifiesto?.numero || v.soporteInterno?.mc || '',
      l.totalCobrado, l.totalAuxiliar, l.totalFlete, l.totalAuxiliarPagado, Number(v.anticipo) || 0, l.utilidad]);
    const t = { cobrado: suma(x => x.l.totalCobrado), aux: suma(x => x.l.totalAuxiliar), flete: suma(x => x.l.totalFlete), auxPag: suma(x => x.l.totalAuxiliarPagado),
      anticipo: suma(x => Number(x.v.anticipo) || 0), utilidad: suma(x => x.l.utilidad) };
    resumen.push([cliente, lista.length, t.cobrado, t.flete, t.auxPag, t.utilidad]);
    const buf = await libroExcel({ empresa, titulo: `Viajes ${cliente}`, subtitulo: `Mes ${mes} · ${lista.length} viaje(s)`, columnas, filas,
      total: ['TOTAL', '', '', '', '', '', t.cobrado, t.aux, t.flete, t.auxPag, t.anticipo, t.utilidad] });
    archivos.push(await guardar(empresaId, path.join(mes, 'informes', `Viajes ${limpio(cliente)}.xlsx`), buf));
  }
  const tot = (i) => resumen.reduce((a, r) => a + r[i], 0);
  archivos.push(await guardar(empresaId, path.join(mes, 'informes', 'Utilidad por empresa.xlsx'), await libroExcel({ empresa, titulo: 'Utilidad por empresa', subtitulo: `Mes ${mes}`,
    columnas: [['Empresa', 30], ['Viajes', 8], ['Cobrado', 15, PESOS], ['Flete', 15, PESOS], ['Aux. pagado', 15, PESOS], ['Utilidad', 15, PESOS]].map(([titulo, ancho, formato]) => ({ titulo, ancho, formato })),
    filas: resumen.sort((a, b) => b[5] - a[5]), total: ['TOTAL', tot(1), tot(2), tot(3), tot(4), tot(5)] })));
  return archivos;
}

// PDF de los manifiestos aceptados (y soportes internos) del mes, en una carpeta por cliente
export async function archivarManifiestos(empresaId, mes) {
  const { desde, hasta } = rangoMes(mes);
  const empresa = await M.Empresa.findById(empresaId).select('+logo').lean();
  const viajes = await M.Viaje.find({ empresa: empresaId, fecha: { $gte: desde, $lte: hasta },
    $or: [{ 'manifiesto.estado': 'aceptado' }, { estado: 'cumplido' }, { 'soporteInterno.mc': { $nin: ['', null] } }] })
    .select('cliente manifiesto estado soporteInterno').populate(M.pob(empresaId, 'cliente', 'nombre')).lean();
  const archivos = []; const errores = [];
  for (const v of viajes) {
    try {
      const rndc = v.manifiesto?.estado === 'aceptado' || v.estado === 'cumplido';
      const d = rndc ? await datosManifiesto(empresa, v._id) : await soporteInterno(empresa, v._id, { asignar: false });
      const nombre = rndc ? nombreArchivo(d) : `Soporte_${limpio(d.numero)}.pdf`;
      archivos.push(await guardar(empresaId, path.join(mes, 'manifiestos', limpio(v.cliente?.nombre || 'sin cliente'), nombre), await manifiestoPdf(d)));
    } catch (e) { errores.push(`${v.manifiesto?.numero || v.soporteInterno?.mc || v._id}: ${e.message}`); }
  }
  return { archivos, errores };
}

// Lo que se guarda antes de cerrar el mes: la copia completa, los informes por empresa y los PDF de manifiestos
export async function archivarMes(empresaId, mes) {
  const respaldo = await guardarRespaldo(empresaId, `${mes}/respaldo-${mes}.json.gz`);
  const informes = await informesMes(empresaId, mes);
  const manifiestos = await archivarManifiestos(empresaId, mes);
  return { archivos: [respaldo, ...informes, ...manifiestos.archivos], errores: manifiestos.errores };
}

// Archivos guardados de la empresa (opcionalmente de un mes o carpeta)
export async function listarArchivos(empresaId, carpeta = '') {
  const raiz = carpetaEmpresa(empresaId);
  const inicio = rutaSegura(empresaId, carpeta);
  const lista = [];
  const recorrer = async (dir) => {
    let entradas = [];
    try { entradas = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await recorrer(p);
      else { const st = await fs.promises.stat(p); lista.push({ ruta: path.relative(raiz, p).split(path.sep).join('/'), bytes: st.size, fecha: st.mtime }); }
    }
  };
  await recorrer(inicio);
  return lista.sort((a, b) => a.ruta.localeCompare(b.ruta));
}

// Ruta dentro de la carpeta de la empresa (nunca fuera de ella)
export function rutaSegura(empresaId, relativo = '') {
  const raiz = carpetaEmpresa(empresaId);
  const p = path.resolve(raiz, String(relativo || '').replace(/^\/+/, ''));
  if (p !== raiz && !p.startsWith(raiz + path.sep)) throw new ErrorHttp(400, 'Ruta inválida');
  return p;
}

export async function leerArchivo(empresaId, relativo) {
  const p = rutaSegura(empresaId, relativo);
  try { const st = await fs.promises.stat(p); if (!st.isFile()) throw new Error(); } catch { throw new ErrorHttp(404, 'Archivo no encontrado'); }
  return fs.createReadStream(p);
}

// Respaldo completo al vuelo (descarga desde la plataforma)
export function respaldoComoFlujo(empresaId) {
  const salida = new PassThrough();
  escribirRespaldo(empresaId, salida).catch(e => salida.destroy(e));
  return salida;
}
