// Datos y membrete de SG-SST. Razón social, NIT, dirección, teléfono y logo vienen de la empresa
// (Configuración): no se duplican aquí. Lo propio de SST se guarda en SstEmpresa.
import { Empresa, Tercero, Vehiculo } from '../../models/index.js';
import { SstEmpresa } from '../../models/sst.js';
import { ErrorHttp } from '../../middleware/auth.js';

export const MAX_IMAGEN = 1_500_000; // data URL de cada franja del membrete

export async function datosEmpresa(empresaId, { conImagenes = false } = {}) {
  const [e, s, vehiculos, conductores] = await Promise.all([
    Empresa.findById(empresaId).select(conImagenes ? '+logo' : '').lean(),
    SstEmpresa.findOne({ empresa: empresaId }).select(conImagenes ? '+membrete.encabezado +membrete.pie' : '').lean(),
    Vehiculo.countDocuments({ empresa: empresaId, activo: { $ne: false }, clase: { $ne: 'remolque' } }),
    Tercero.countDocuments({ empresa: empresaId, activo: { $ne: false }, roles: 'conductor' }),
  ]);
  if (!e) throw new ErrorHttp(404, 'Empresa no encontrada');
  const tieneMembrete = conImagenes
    ? { encabezado: !!s?.membrete?.encabezado, pie: !!s?.membrete?.pie }
    : await SstEmpresa.findOne({ empresa: empresaId }).select('+membrete.encabezado +membrete.pie').lean()
      .then((x) => ({ encabezado: !!x?.membrete?.encabezado, pie: !!x?.membrete?.pie }));
  return {
    empresa: { nombre: e.rndc?.razonSocial || e.nombre, nit: e.nit, dv: e.dv, direccion: e.direccion, telefono: e.telefono, ciudad: e.ciudad, correo: e.correo,
      ...(conImagenes ? { logo: e.logo || '' } : {}) },
    responsables: { representanteLegal: '', documentoRepresentante: '', responsableSst: '', licenciaSst: '', liderPesv: '', ...(s?.responsables || {}) },
    riesgo: { arl: '', claseRiesgo: '', actividadEconomica: '', trabajadores: null, nivelPesv: '', ...(s?.riesgo || {}) },
    autoevaluacion: {
      estandares: { valor: s?.autoevaluacion?.estandares?.valor ?? null, fecha: s?.autoevaluacion?.estandares?.fecha ?? null },
      pesv: { valor: s?.autoevaluacion?.pesv?.valor ?? null, fecha: s?.autoevaluacion?.pesv?.fecha ?? null },
    },
    colores: { principal: s?.colores?.principal || '#0B2A6B', acento: s?.colores?.acento || '#F5B400' },
    pieTexto: s?.pieTexto || '',
    membrete: conImagenes ? { encabezado: s?.membrete?.encabezado || '', pie: s?.membrete?.pie || '' } : tieneMembrete,
    // Para orientar al responsable (la plataforma no clasifica la empresa)
    flota: { vehiculos, conductores },
    actualizado: s?.updatedAt || null,
  };
}

export async function guardarDatos(empresaId, d, usuarioId) {
  await SstEmpresa.updateOne(
    { empresa: empresaId },
    { $set: { responsables: d.responsables, riesgo: d.riesgo, autoevaluacion: d.autoevaluacion, colores: d.colores, pieTexto: d.pieTexto, actualizadoPor: usuarioId } },
    { upsert: true },
  );
  return datosEmpresa(empresaId);
}

/** parte: 'encabezado' | 'pie'. Imagen vacía la quita. */
export async function guardarMembrete(empresaId, parte, imagen, usuarioId) {
  await SstEmpresa.updateOne({ empresa: empresaId }, { $set: { [`membrete.${parte}`]: imagen || '', actualizadoPor: usuarioId } }, { upsert: true });
  return datosEmpresa(empresaId);
}

/** Variables para los formatos y los Word/Excel propios: {{empresa.nombre}}, {{sst.responsable}}… */
export function variables(d, extra = {}) {
  const hoy = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long' }).format(new Date());
  return {
    'empresa.nombre': d.empresa.nombre, 'empresa.nit': `${d.empresa.nit}${d.empresa.dv ? `-${d.empresa.dv}` : ''}`,
    'empresa.direccion': d.empresa.direccion, 'empresa.telefono': d.empresa.telefono, 'empresa.ciudad': d.empresa.ciudad, 'empresa.correo': d.empresa.correo,
    'empresa.representante': d.responsables.representanteLegal, 'empresa.documentoRepresentante': d.responsables.documentoRepresentante,
    'sst.responsable': d.responsables.responsableSst, 'sst.licencia': d.responsables.licenciaSst, 'pesv.lider': d.responsables.liderPesv,
    'sst.arl': d.riesgo.arl, 'sst.claseRiesgo': d.riesgo.claseRiesgo, 'sst.actividad': d.riesgo.actividadEconomica,
    'sst.trabajadores': d.riesgo.trabajadores ?? '', 'pesv.nivel': { basico: 'Básico', estandar: 'Estándar', avanzado: 'Avanzado' }[d.riesgo.nivelPesv] || '',
    fecha: hoy,
    ...extra,
  };
}
