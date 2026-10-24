// Actualización masiva de vehículos o de terceros (conductores, titulares, clientes) desde el RNDC (todos o por lotes de 30).
//
// Cuidado del web service del Ministerio:
// - Un solo proceso por empresa a la vez y las placas se consultan de una en una.
// - Pausa entre placas (RNDC_PAUSA_MASIVA_MS) además del limitador global de cliente.js.
// - Sin conexión: reintenta con espera creciente; tras varias fallas seguidas se pausa solo.
// - Contraseña rechazada: se detiene de inmediato.
//
// La contraseña del RNDC se conserva solo en la memoria del proceso mientras dura
// (nunca en la base de datos) y se descarta al terminar o detenerse.
import { Vehiculo, Tercero, Empresa } from '../../models/index.js';
import { env } from '../../config/env.js';
import { actualizarVehiculo, actualizarTercero } from './operaciones.js';
import { auditar } from '../auditoria.js';

export const TAM_LOTE = 30;
const REINTENTOS = [5000, 15000];          // esperas ante fallas de conexión
const MAX_FALLAS_SEGUIDAS = 3;              // luego se pausa el proceso
const procesos = new Map();                 // «tipo|empresaId» → proceso
const llave = (empresaId, tipo = 'vehiculos') => `${tipo}|${empresaId}`;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));
// «Solo pendientes»: lo no consultado en estos días; así, si el proceso se corta, al iniciarlo de nuevo sigue donde quedó
const DIAS_RECIENTE = 7;
const reciente = () => new Date(Date.now() - DIAS_RECIENTE * 86400000);
const sinConsultaReciente = () => ({ $or: [{ 'rndc.consultadoEn': null }, { 'rndc.consultadoEn': { $lt: reciente() } }] });
const esClave = (m) => /usuario|contrase|clave|password|autentic/i.test(m || '');

// Vista pública del proceso (sin la clave).
function vista(p) {
  if (!p) return null;
  const { clave, cancelar, placas, ...resto } = p;
  return { ...resto, lotes: p.lotes.map(l => ({ ...l })) };
}
export const estadoProceso = (empresaId, tipo = 'vehiculos') => vista(procesos.get(llave(empresaId, tipo)));

const CONTADOR = { actualizado: 'actualizados', sin_cambios: 'sinCambios', no_encontrado: 'noEncontrados', no_registrado: 'noEncontrados' };
function contar(p, r) {
  p.procesados += 1;
  p[CONTADOR[r.estado] || 'errores'] += 1;
}

async function consultarPlaca(p, placa) {
  let r;
  for (let intento = 0; intento <= REINTENTOS.length; intento += 1) {
    try {
      r = p.tipo === 'terceros'
        ? await actualizarTercero(p.empresa, p.clave, p.usuario, placa)
        : await actualizarVehiculo(p.empresa, p.clave, p.usuario, placa);
    } catch (e) {
      r = { placa, estado: 'error', mensaje: e.message, conexion: false };
    }
    if (!r.conexion || intento === REINTENTOS.length || p.cancelar) break;
    p.mensaje = `Sin conexión con el RNDC en ${placa}; reintento en ${REINTENTOS[intento] / 1000} s`;
    await dormir(REINTENTOS[intento]);
  }
  return r;
}

// Procesa un lote; devuelve false si el proceso debe parar.
async function procesarLote(p, numero) {
  const placas = p.placas.slice((numero - 1) * TAM_LOTE, numero * TAM_LOTE);
  const lote = { numero, placas: placas.length, inicio: new Date(), fin: null, resultados: [] };
  p.lotes.push(lote);
  p.loteActual = numero;
  p.estado = 'ejecutando';
  let fallasSeguidas = 0;
  for (const placa of placas) {
    if (p.cancelar) return false;
    p.placaActual = p.tipo === 'terceros' ? placa.etiqueta : placa;
    p.mensaje = `Lote ${numero} de ${p.totalLotes}: consultando ${p.placaActual}`;
    const r = await consultarPlaca(p, placa);
    const { conexion, ...res } = r;
    // Se marca como consultado (salvo error de conexión o del servicio) para poder retomar sin repetirlo
    if (r.estado !== 'error') {
      const f = p.tipo === 'terceros' ? { empresa: p.empresa, tipoId: placa.tipoId, numId: placa.numId } : { empresa: p.empresa, placa };
      await (p.tipo === 'terceros' ? Tercero : Vehiculo).updateMany(f, { $set: { 'rndc.consultadoEn': new Date() } }).catch(() => {});
    }
    if (p.tipo !== 'terceros') res.ref = res.placa;
    lote.resultados.push(res);
    contar(p, r);
    if (r.estado === 'error' && esClave(r.mensaje)) {
      p.estado = 'detenido'; p.mensaje = `El RNDC rechazó la contraseña: ${r.mensaje}`; lote.fin = new Date();
      return false;
    }
    fallasSeguidas = r.conexion ? fallasSeguidas + 1 : 0;
    if (fallasSeguidas >= MAX_FALLAS_SEGUIDAS) {
      p.estado = 'pausado'; p.mensaje = `El RNDC no responde (${fallasSeguidas} fallas seguidas). Proceso en pausa para no saturar el servicio; continúe más tarde.`;
      lote.fin = new Date();
      return false;
    }
    await dormir(p.pausaMs);
  }
  lote.fin = new Date();
  p.placaActual = '';
  return true;
}

async function ejecutar(p, desdeLote) {
  try {
    for (let n = desdeLote; n <= p.totalLotes; n += 1) {
      const sigue = await procesarLote(p, n);
      if (!sigue) break;
      if (p.modo === 'lotes' && n < p.totalLotes) {
        p.estado = 'esperando';
        p.mensaje = `Lote ${n} terminado. Revise los resultados y continúe con el lote ${n + 1}.`;
        return;
      }
    }
    if (p.cancelar) { p.estado = 'detenido'; p.mensaje = 'Proceso detenido por el usuario'; }
    else if (p.estado === 'ejecutando') { p.estado = 'terminado'; p.mensaje = 'Proceso terminado'; }
  } catch (e) {
    p.estado = 'error'; p.mensaje = e.message;
  }
  if (['terminado', 'detenido', 'error'].includes(p.estado)) await cerrar(p);
}

async function cerrar(p) {
  p.fin = new Date();
  p.clave = null;                 // la contraseña no se conserva
  await auditar(null, p.tipo === 'terceros' ? 'actualizar_terceros_rndc' : 'actualizar_vehiculos_rndc', {
    empresa: p.empresa, usuario: p.usuario, entidad: p.tipo === 'terceros' ? 'Tercero' : 'Vehiculo',
    detalle: { modo: p.modo, estado: p.estado, total: p.total, procesados: p.procesados, actualizados: p.actualizados,
      sinCambios: p.sinCambios, noEncontrados: p.noEncontrados, errores: p.errores },
  });
}

// Inicia un proceso. modo: 'todos' (sigue sin parar) | 'lotes' (espera confirmación entre lotes de 30).
// Terceros: un documento por consulta (el RNDC devuelve todas sus sedes).
// solo = 'pendientes': importados del Excel sin confirmar, sin enviar o con error.
async function documentosTerceros(empresaId, solo) {
  const f = { empresa: empresaId };
  if (solo === 'pendientes') f.$and = [{ $or: [{ 'rndc.mensaje': /^Importado/i }, { 'rndc.estado': { $in: ['sin_enviar', 'error', '', null] } }] }, sinConsultaReciente()];
  const ts = await Tercero.find(f).select('tipoId numId nombres apellido1 apellido2 razonSocial').sort({ nombres: 1 }).lean();
  const vistos = new Map();
  for (const t of ts) {
    const k = `${t.tipoId}|${t.numId}`;
    const nombre = [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') || t.razonSocial || '';
    if (!vistos.has(k)) vistos.set(k, { tipoId: t.tipoId, numId: t.numId, etiqueta: `${t.tipoId} ${t.numId} · ${nombre}` });
  }
  return [...vistos.values()];
}

export async function iniciar({ empresaId, usuario, clave, modo, tipo = 'vehiculos', solo = 'todos' }) {
  const clavePro = String(empresaId);
  const actual = procesos.get(llave(empresaId, tipo));
  if (actual && ['ejecutando', 'esperando', 'pausado'].includes(actual.estado)) {
    const e = new Error(`Ya hay una actualización de ${tipo === 'terceros' ? 'terceros' : 'vehículos'} en curso para la empresa. Continúela o deténgala.`); e.status = 409; throw e;
  }
  const empresa = await Empresa.findById(empresaId).select('rndc.ambiente').lean();
  const placas = tipo === 'terceros' ? await documentosTerceros(empresaId, solo)
    : (await Vehiculo.find({ empresa: empresaId, ...(solo === 'pendientes' ? sinConsultaReciente() : {}) }).select('placa').sort({ placa: 1 }).lean()).map(v => v.placa);
  if (!placas.length) {
    const e = new Error(solo === 'pendientes' ? `No queda nada pendiente: todo se consultó en los últimos ${DIAS_RECIENTE} días` : tipo !== 'terceros' ? 'La empresa no tiene vehículos registrados' : 'La empresa no tiene terceros registrados');
    e.status = 400; throw e;
  }
  const p = {
    tipo, solo,
    empresa: clavePro, usuario: usuario._id, usuarioNombre: usuario.nombre, modo, ambiente: empresa?.rndc?.ambiente || 'SIMULADO',
    placas, total: placas.length, totalLotes: Math.ceil(placas.length / TAM_LOTE), tamLote: TAM_LOTE,
    procesados: 0, actualizados: 0, sinCambios: 0, noEncontrados: 0, errores: 0,
    loteActual: 0, placaActual: '', estado: 'ejecutando', mensaje: 'Iniciando…', lotes: [],
    inicio: new Date(), fin: null, clave, cancelar: false,
    // El simulador local no necesita la pausa de protección del web service
    pausaMs: (empresa?.rndc?.ambiente || 'SIMULADO') === 'SIMULADO' ? Math.min(100, env.rndc.pausaMasivaMs) : env.rndc.pausaMasivaMs,
  };
  procesos.set(llave(empresaId, tipo), p);
  ejecutar(p, 1);
  return vista(p);
}

// Continúa con el siguiente lote (modo por lotes) o reanuda un proceso pausado.
export function continuar(empresaId, clave, tipo = 'vehiculos') {
  const p = procesos.get(llave(empresaId, tipo));
  if (!p || !['esperando', 'pausado'].includes(p.estado)) { const e = new Error('No hay un proceso esperando para continuar'); e.status = 409; throw e; }
  if (clave) p.clave = clave;
  if (!p.clave) { const e = new Error('Escriba la contraseña del RNDC'); e.status = 400; throw e; }
  let desde = p.loteActual + 1;
  // Si quedó pausado a mitad de un lote, ese lote se repite completo (actualizar dos veces no duplica nada)
  if (p.estado === 'pausado') {
    const ult = p.lotes.pop();
    for (const r of ult.resultados) { p.procesados -= 1; p[CONTADOR[r.estado] || 'errores'] -= 1; }
    desde = ult.numero;
  }
  p.estado = 'ejecutando';
  ejecutar(p, desde);
  return vista(p);
}

export function detener(empresaId, tipo = 'vehiculos') {
  const p = procesos.get(llave(empresaId, tipo));
  if (!p) { const e = new Error('No hay un proceso en curso'); e.status = 404; throw e; }
  if (p.estado === 'ejecutando') { p.cancelar = true; p.mensaje = 'Deteniendo después de la placa actual…'; }
  else if (['esperando', 'pausado'].includes(p.estado)) { p.estado = 'detenido'; p.mensaje = 'Proceso detenido por el usuario'; cerrar(p); }
  return vista(p);
}

// Solo para pruebas
export function _reiniciar() { procesos.clear(); }
