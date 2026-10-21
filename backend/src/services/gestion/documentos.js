// Documentos del viaje (alertas de la plantilla): licencia del conductor, SOAT y revisión
// tecnomecánica del vehículo. Vencido = no se registra el viaje; por vencer = aviso.
import { Tercero, Vehiculo } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';

export const DIAS_AVISO = 15;
const estado = (fecha, hoy = new Date()) => {
  if (!fecha) return 0;                                 // sin fecha
  const d = new Date(fecha);
  if (d < hoy) return 3;                                // vencido
  if (d - hoy <= DIAS_AVISO * 86400000) return 2;       // por vencer
  return 1;                                             // vigente
};
const f = (d) => new Date(d).toISOString().slice(0, 10);

export async function revisarDocumentos(empresaId, { conductor, placa }) {
  const vencidos = []; const avisos = [];
  const revisar = (nombre, fecha) => {
    const e = estado(fecha);
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
  return { vencidos, avisos };
}

// Se usa al guardar un viaje nuevo: con documentos vencidos no se registra
export async function exigirDocumentosVigentes(empresaId, datos) {
  const r = await revisarDocumentos(empresaId, datos);
  if (r.vencidos.length) throw new ErrorHttp(422, 'No se puede registrar el viaje: hay documentos vencidos', r.vencidos);
  return r.avisos;
}
