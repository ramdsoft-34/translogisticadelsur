// Registro de auditoría a prueba de alteraciones (ISO/IEC 27001:2022, A.8.15 y A.5.28).
// Cada empresa tiene su propia cadena y las acciones globales del SuperAdmin otra:
//   hash = SHA-256(hash del registro anterior + contenido del registro)
// Si alguien modifica o borra un registro directamente en la base de datos, la
// verificación (`verificarCadena`) señala el primer punto donde se rompe.
import crypto from 'node:crypto';
import { Auditoria } from '../models/index.js';

const claveCadena = (empresa) => (empresa ? String(empresa) : 'global');

// Serialización estable (claves ordenadas) para que el hash no dependa del orden.
function estable(v) {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  if (typeof v === 'object') {
    if (typeof v.toHexString === 'function') return JSON.stringify(v.toHexString());
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${estable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function calcularHash(r, hashPrevio) {
  const contenido = estable({
    cadena: r.cadena, seq: r.seq, empresa: r.empresa ? String(r.empresa) : null, usuario: r.usuario ? String(r.usuario) : null,
    usuarioNombre: r.usuarioNombre || '', accion: r.accion, entidad: r.entidad || '', entidadId: r.entidadId || '',
    detalle: r.detalle || {}, ip: r.ip || '', resultado: r.resultado || 'exito', fecha: new Date(r.createdAt).toISOString(),
  });
  return crypto.createHash('sha256').update(`${hashPrevio}|${contenido}`).digest('hex');
}

// Las inserciones de una misma cadena se hacen en orden dentro del proceso; si
// hay varios procesos, el índice único (cadena, seq) obliga a reintentar.
const colas = new Map();
function enCola(clave, tarea) {
  const previa = colas.get(clave) || Promise.resolve();
  const actual = previa.catch(() => {}).then(tarea);
  colas.set(clave, actual);
  actual.finally(() => { if (colas.get(clave) === actual) colas.delete(clave); }).catch(() => {});
  return actual;
}

async function insertar(datos) {
  const cadena = claveCadena(datos.empresa);
  return enCola(cadena, async () => {
    for (let intento = 0; intento < 5; intento++) {
      const ultimo = await Auditoria.findOne({ cadena }).sort({ seq: -1 }).select('seq hash').lean();
      const r = {
        ...datos, cadena, seq: (ultimo?.seq || 0) + 1, hashPrevio: ultimo?.hash || '',
        createdAt: new Date(Math.floor(Date.now() / 1000) * 1000), // al segundo: estable al serializar
      };
      r.hash = calcularHash(r, r.hashPrevio);
      try {
        return await Auditoria.create(r);
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
    }
    throw new Error('No se pudo encadenar el registro de auditoría');
  });
}

// Quita datos sensibles antes de guardar (claves, tokens).
function limpiarDetalle(d) {
  if (!d || typeof d !== 'object') return d ?? {};
  if (Array.isArray(d)) return d.map(limpiarDetalle);
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (/pass|clave|token|secret/i.test(k)) continue;
    out[k] = v && typeof v === 'object' && !(v instanceof Date) && typeof v.toHexString !== 'function' ? limpiarDetalle(v) : v;
  }
  return out;
}

// Registra una acción. `empresa` null solo para acciones globales del SuperAdmin.
export async function auditar(req, accion, { entidad = '', entidadId = '', detalle = {}, empresa, resultado = 'exito', usuario } = {}) {
  try {
    await insertar({
      empresa: empresa !== undefined ? empresa : (req?.empresaId || null),
      usuario: usuario !== undefined ? usuario : (req?.usuario?._id || null),
      usuarioNombre: req?.usuario?.nombre || detalle?.email || '',
      // JSON plano: sin undefined, fechas como texto e ids como cadena (hash reproducible)
      accion, entidad, entidadId: String(entidadId || ''), detalle: JSON.parse(JSON.stringify(limpiarDetalle(detalle) ?? {})),
      ip: req?.ip || '', resultado,
    });
  } catch (e) {
    console.error('No se pudo auditar:', e.message);
  }
}

// Diferencias entre dos versiones de un documento (para "qué cambió").
export function cambios(antes, despues, campos) {
  const r = {};
  for (const k of campos) {
    const a = antes?.[k]; const b = despues?.[k];
    if (estable(a ?? null) !== estable(b ?? null)) r[k] = { antes: a ?? null, despues: b ?? null };
  }
  return r;
}

// Recorre la cadena y devuelve el primer registro alterado o faltante.
export async function verificarCadena(empresa) {
  const cadena = claveCadena(empresa);
  let previo = ''; let esperado = 1; let total = 0;
  const cursor = Auditoria.find({ cadena }).sort({ seq: 1 }).lean().cursor();
  for await (const r of cursor) {
    total += 1;
    if (r.seq !== esperado) return { integra: false, total, problema: `Falta el registro ${esperado} (sigue el ${r.seq})`, seq: esperado };
    if (r.hashPrevio !== previo || calcularHash(r, previo) !== r.hash) {
      return { integra: false, total, problema: `El registro ${r.seq} (${r.accion}) fue alterado`, seq: r.seq };
    }
    previo = r.hash; esperado += 1;
  }
  return { integra: true, total, ultimoHash: previo };
}
