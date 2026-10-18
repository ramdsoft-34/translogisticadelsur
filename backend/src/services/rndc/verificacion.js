// Verificación contra el RNDC antes de enviar: trae del RNDC el vehículo, el remolque, el
// conductor, el titular, el remitente y el destinatario (con todas sus sedes) y actualiza la
// plataforma con lo que el RNDC tiene. Así se evitan rechazos como MAN130 (titular), MAN354
// (sede en otro municipio) o datos de SOAT y licencia desactualizados.
// Para no cargar el RNDC, lo verificado en los últimos días no se vuelve a consultar.
import { Viaje, Vehiculo, Tercero, proximo } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { txt, hoyColombia } from '../../utils/texto.js';
import { contextoViaje, idCliente } from './documentos.js';
import { cargarViaje, traerTercero, traerVehiculo, consultar, empresaConRndc } from './operaciones.js';

export const DIAS_VIGENCIA = 7;
const reciente = (rndc) => rndc?.verificadoEn && Date.now() - new Date(rndc.verificadoEn).getTime() < DIAS_VIGENCIA * 86400000;
const errorClave = (m) => /usuario|contrase|clave|password/i.test(m || '');
const fechaCorta = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// Diferencias que importan para el envío
function cambiosTercero(antes, despues) {
  const cambios = [];
  const porSede = new Map(antes.map(x => [txt(x.sede?.codigo), x]));
  for (const d of despues) {
    const a = porSede.get(txt(d.sede?.codigo));
    const sede = `sede ${txt(d.sede?.codigo)}${d.sede?.nombre ? ` ${d.sede.nombre}` : ''}`;
    if (!a) { cambios.push(`nueva ${sede}`); continue; }
    if (txt(a.codMunicipio) !== txt(d.codMunicipio)) cambios.push(`${sede}: municipio ${a.codMunicipio || '(vacío)'} → ${d.codMunicipio}`);
    if (txt(a.direccion) !== txt(d.direccion)) cambios.push(`${sede}: dirección actualizada`);
    if (fechaCorta(a.licencia?.vence) !== fechaCorta(d.licencia?.vence) && d.licencia?.vence) cambios.push(`licencia vence ${fechaCorta(d.licencia.vence)}`);
  }
  return cambios;
}
function cambiosVehiculo(a, d) {
  if (!a) return ['registrado en la plataforma con los datos del RNDC'];
  const c = [];
  if (txt(a.soat?.numero) !== txt(d.soat?.numero)) c.push(`SOAT ${d.soat?.numero || '(sin número)'}`);
  if (fechaCorta(a.soat?.vence) !== fechaCorta(d.soat?.vence)) c.push(`SOAT vence ${fechaCorta(d.soat?.vence) || '(sin fecha)'}`);
  if (txt(a.configuracion) !== txt(d.configuracion)) c.push(`configuración ${d.configuracion}`);
  if (Number(a.pesoVacio) !== Number(d.pesoVacio)) c.push(`peso vacío ${d.pesoVacio}`);
  return c;
}

async function verificarVehiculoRndc(empresaId, clave, usuarioId, placa, rol, forzar) {
  const antes = await Vehiculo.findOne({ empresa: empresaId, placa }).lean();
  if (!forzar && reciente(antes?.rndc)) return { rol, referencia: placa, estado: 'reciente' };
  const r = await traerVehiculo(empresaId, clave, usuarioId, { placa });
  if (!r.ok) return { rol, referencia: placa, estado: errorClave(r.mensaje) ? 'clave' : /no tiene registrado/i.test(r.mensaje || '') ? 'no_existe' : 'error', mensaje: r.mensaje };
  const despues = await Vehiculo.findOne({ empresa: empresaId, placa }).lean();
  return { rol, referencia: placa, estado: 'verificado', cambios: cambiosVehiculo(antes, despues) };
}

async function verificarTerceroRndc(empresaId, clave, usuarioId, tipoId, numId, rol, roles, forzar) {
  const f = { empresa: empresaId, tipoId, numId };
  const antes = await Tercero.find(f).lean();
  const referencia = `${antes[0] ? [antes[0].nombres, antes[0].apellido1].filter(Boolean).join(' ') : ''} (${tipoId} ${numId})`.trim();
  if (!forzar && antes.length && antes.every(x => reciente(x.rndc))) return { rol, referencia, estado: 'reciente' };
  const r = await traerTercero(empresaId, clave, usuarioId, { tipoId, numId, roles });
  if (!r.ok) return { rol, referencia, estado: errorClave(r.mensaje) ? 'clave' : /no tiene registrado/i.test(r.mensaje || '') ? 'no_existe' : 'error', mensaje: r.mensaje };
  return { rol, referencia, estado: 'verificado', cambios: cambiosTercero(antes, await Tercero.find(f).lean()) };
}

// Verifica todo lo que va en la remesa y el manifiesto de un viaje.
export async function verificarViaje(empresaId, viajeId, clave, usuarioId, { forzar = false } = {}) {
  const empresa = await empresaConRndc(empresaId);
  const { v, vehiculo } = await cargarViaje(empresaId, viajeId);
  const ctx = contextoViaje(empresa, v, vehiculo);
  const tareas = [
    () => verificarVehiculoRndc(empresaId, clave, usuarioId, v.placa, 'Vehículo', forzar),
    ...(v.remolque ? [() => verificarVehiculoRndc(empresaId, clave, usuarioId, v.remolque, 'Remolque', forzar)] : []),
    ...(v.conductor ? [() => verificarTerceroRndc(empresaId, clave, usuarioId, v.conductor.tipoId, v.conductor.numId, 'Conductor', ['conductor'], forzar)] : []),
    ...(v.titular && String(v.titular._id) !== String(v.conductor?._id)
      ? [() => verificarTerceroRndc(empresaId, clave, usuarioId, v.titular.tipoId, v.titular.numId, 'Titular', ['titular'], forzar)] : []),
    ...(v.cliente ? [() => verificarTerceroRndc(empresaId, clave, usuarioId, v.cliente.tipoId || 'N', idCliente(v.cliente), 'Remitente', ['remitente'], forzar)] : []),
  ];
  const destino = v.destinatarioRemesa || { tipoId: ctx.DEST_TIPO, numId: ctx.DEST_ID };
  if (destino.numId && !(destino.numId === ctx.NIT_CLIENTE && destino.tipoId === ctx.TIPO_CLIENTE)) {
    tareas.push(() => verificarTerceroRndc(empresaId, clave, usuarioId, destino.tipoId, destino.numId, 'Destinatario', ['destinatario'], forzar));
  }
  const resultados = [];
  for (const t of tareas) {
    const r = await t();
    resultados.push(r);
    if (r.estado === 'clave') throw new ErrorHttp(400, `El RNDC no aceptó el usuario o la contraseña: ${r.mensaje}`);
  }
  // Lo que el RNDC no tiene impide expedir (vehículo, conductor o titular sin registrar)
  const bloqueantes = resultados.filter(r => r.estado === 'no_existe' && ['Vehículo', 'Remolque', 'Conductor', 'Titular'].includes(r.rol));
  if (!bloqueantes.length && !resultados.some(r => r.estado === 'error')) await Viaje.updateOne({ empresa: empresaId, _id: v._id }, { $set: { verificadoRndc: new Date() } });
  return { resultados, bloqueantes: bloqueantes.map(r => `${r.rol} ${r.referencia}: no está registrado en el RNDC. Regístrelo antes de enviar.`) };
}

export const verificacionVigente = (v) => !!v?.verificadoRndc && Date.now() - new Date(v.verificadoRndc).getTime() < DIAS_VIGENCIA * 86400000;

// ── Consecutivos: último número radicado en el RNDC vs. el siguiente de la plataforma ──
const iso = (d) => d.toISOString().slice(0, 10);
export async function verificarConsecutivos(empresaId, clave, usuarioId, { dias = 20 } = {}) {
  const empresa = await empresaConRndc(empresaId);
  const hasta = hoyColombia();
  const desde = new Date(hasta.getTime() - dias * 86400000);
  const resultado = {};
  for (const [clave2, que, campo, prefijo] of [['remesa', 'remesa', 'consecutivoremesa', empresa.rndc?.prefijoRemesa || ''],
    ['manifiesto', 'manifiesto', 'nummanifiestocarga', empresa.rndc?.prefijoManifiesto || '']]) {
    const r = await consultar(empresaId, clave, usuarioId, { que, desde: iso(desde), hasta: iso(hasta) });
    if (!r.ok && errorClave(r.mensaje)) throw new ErrorHttp(400, `El RNDC no aceptó el usuario o la contraseña: ${r.mensaje}`);
    // Solo los números de la numeración de la empresa (sin reemplazos «A» o «.»)
    const patron = new RegExp(`^${prefijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    const numeros = (r.documentos || []).map(d => txt(d[campo]).match(patron)?.[1]).filter(Boolean).map(Number);
    const ultimo = numeros.length ? Math.max(...numeros) : null;
    const siguiente = await proximo(empresaId, clave2);
    resultado[clave2] = {
      consultados: (r.documentos || []).length, ok: r.ok, mensaje: r.ok ? '' : r.mensaje,
      ultimoRndc: ultimo === null ? '' : `${prefijo}${ultimo}`,
      siguientePlataforma: `${prefijo}${siguiente}`,
      // Si la plataforma va por detrás del RNDC, el siguiente debe ser el último radicado + 1
      sugerido: ultimo !== null && ultimo >= siguiente ? `${prefijo}${ultimo + 1}` : '',
    };
  }
  return { desde: iso(desde), hasta: iso(hasta), ...resultado };
}
