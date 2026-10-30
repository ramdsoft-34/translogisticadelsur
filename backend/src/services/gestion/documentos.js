// Documentos del viaje (alertas de la plantilla): licencia del conductor, SOAT y revisión
// tecnomecánica del vehículo. Vencido = no se registra el viaje, salvo que un administrador lo
// autorice con su usuario y clave (y el código de su app si tiene doble factor) y un motivo (CA-06).
// Por vencer = aviso, con los días configurados por la empresa (10 por defecto).
import bcrypt from 'bcryptjs';
import { Tercero, Vehiculo, Usuario, Autorizacion } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { reglasDe, REGLAS_BASE } from './reglas.js';
import { verificarTotp } from '../totp.js';
import { descifrar } from '../../utils/cifrado.js';

export const DIAS_AVISO = REGLAS_BASE.diasAvisoDocumentos;
const estado = (fecha, dias, hoy = new Date()) => {
  if (!fecha) return 0;                                 // sin fecha
  const d = new Date(fecha);
  if (d < hoy) return 3;                                // vencido
  if (d - hoy <= dias * 86400000) return 2;             // por vencer
  return 1;                                             // vigente
};
const f = (d) => new Date(d).toISOString().slice(0, 10);

export async function revisarDocumentos(empresaId, { conductor, placa }) {
  const dias = Number((await reglasDe(empresaId)).diasAvisoDocumentos) || DIAS_AVISO;
  const vencidos = []; const avisos = [];
  const revisar = (nombre, fecha) => {
    const e = estado(fecha, dias);
    if (e === 3) vencidos.push(`${nombre} vencido(a) desde ${f(fecha)}`);
    if (e === 2) avisos.push(`${nombre} vence el ${f(fecha)}`);
  };
  if (conductor) {
    const t = await Tercero.findOne({ empresa: empresaId, _id: conductor }).select('nombres apellido1 licencia').lean();
    if (t) revisar(`Licencia de ${[t.nombres, t.apellido1].filter(Boolean).join(' ')}`, t.licencia?.vence);
  }
  if (placa) {
    const v = await Vehiculo.findOne({ empresa: empresaId, placa }).select('soat venceTecnomecanica').lean();
    if (v) { revisar(`SOAT de ${placa}`, v.soat?.vence); revisar(`Revisión tecnomecánica de ${placa}`, v.venceTecnomecanica); }
  }
  return { vencidos, avisos, dias };
}

const MAX_INTENTOS = 5; const BLOQUEO_MIN = 15;
const HASH_FALSO = bcrypt.hashSync('no-existe-0000', 10);   // iguala el tiempo de respuesta si el correo no es del administrador
// Verifica el usuario y la clave del Administrador de la empresa (con los mismos bloqueos del ingreso)
export async function verificarAdministrador(empresaId, { email, clave, codigo }) {
  const malo = new ErrorHttp(403, 'Usuario o contraseña de administrador incorrectos');
  const u = await Usuario.findOne({ email: String(email || '').trim().toLowerCase(), empresa: empresaId, rol: 'admin', activo: true })
    .select('+passwordHash +totp.secreto +totp.ultimoPaso');
  if (!u) { await bcrypt.compare(String(clave || ''), HASH_FALSO); throw malo; }
  if (u.bloqueadoHasta && u.bloqueadoHasta > new Date()) throw new ErrorHttp(423, 'El administrador está bloqueado temporalmente por intentos fallidos');
  if (!(await bcrypt.compare(String(clave || ''), u.passwordHash))) {
    u.intentosFallidos += 1;
    if (u.intentosFallidos >= MAX_INTENTOS) { u.bloqueadoHasta = new Date(Date.now() + BLOQUEO_MIN * 60000); u.intentosFallidos = 0; }
    await u.save();
    throw malo;
  }
  if (u.totp?.activo) {
    const paso = verificarTotp(descifrar(u.totp.secreto), codigo, { ultimoPaso: u.totp.ultimoPaso || 0 });
    if (paso < 0) throw new ErrorHttp(403, 'Escriba el código de la app autenticadora del administrador');
    u.totp.ultimoPaso = paso;
  }
  u.intentosFallidos = 0;
  await u.save();
  return u;
}

// Se usa al guardar un viaje nuevo: con documentos vencidos no se registra, salvo autorización del administrador.
// Devuelve { avisos, autorizado } — `autorizado` se guarda con registrarAutorizacion() una vez creado el viaje.
export async function exigirDocumentosVigentes(empresaId, datos, autorizacion = null) {
  const r = await revisarDocumentos(empresaId, datos);
  if (!r.vencidos.length) return { avisos: r.avisos, autorizado: null };
  if (!autorizacion) throw new ErrorHttp(422, 'No se puede registrar el viaje: hay documentos vencidos. Un administrador puede autorizarlo.', r.vencidos);
  const motivo = String(autorizacion.motivo || '').trim();
  if (motivo.length < 5) throw new ErrorHttp(400, 'Escriba el motivo de la autorización (mínimo 5 caracteres)');
  const admin = await verificarAdministrador(empresaId, autorizacion);
  return { avisos: r.avisos, autorizado: { admin, vencidos: r.vencidos, motivo: motivo.slice(0, 300) } };
}

export async function registrarAutorizacion(empresaId, autorizado, viajes, solicitante) {
  if (!autorizado) return [];
  return Autorizacion.insertMany(viajes.map(v => ({ empresa: empresaId, viaje: v._id, viajeNumero: v.numero, placa: v.placa, conductorNombre: v.conductorNombre,
    vencidos: autorizado.vencidos, motivo: autorizado.motivo, admin: autorizado.admin._id, adminNombre: autorizado.admin.nombre,
    solicitante: solicitante?._id || null, solicitanteNombre: solicitante?.nombre || '' })));
}
