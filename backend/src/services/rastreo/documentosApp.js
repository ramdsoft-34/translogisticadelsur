// Documentos del viaje en la app Sur Track nueva: manifiesto y remesa del RNDC, o el soporte interno.
// Se mandan como PDF al backend de la app, que se los muestra solo al conductor del viaje.
// Se llama después de cada cambio (activar el rastreo, despachar, cumplir, anular, soporte interno);
// cada llamada deja en la app exactamente lo vigente: sube lo que hay y quita lo anulado.
import { Empresa, Viaje } from '../../models/index.js';
import { datosManifiesto, manifiestoPdf } from '../reportes/manifiesto.js';
import { datosRemesa, remesaPdf } from '../reportes/remesa.js';
import { soporteInterno } from '../gestion/soporteInterno.js';
import { configuradoServidor, llamarApp } from './surtrack.js';

/** Qué documentos tiene vigentes el viaje (mismas reglas que «Ver PDF» de Manifiestos). */
export function documentosVigentes(v) {
  const manifiesto = !!v.manifiesto?.numero && (v.manifiesto.estado === 'aceptado' || v.estado === 'cumplido');
  const remesa = !!v.remesa?.numero && (v.remesa.estado === 'aceptado' || v.estado === 'cumplido');
  const soporte = !manifiesto && !!v.soporteInterno?.mc && v.soporteInterno.estado !== 'anulado';
  return { manifiesto, remesa, soporte };
}

export async function sincronizarDocumentosApp(empresaId, viajeId) {
  if (!configuradoServidor('app')) return { enviados: [], quitados: [] };
  const v = await Viaje.findOne({ empresa: empresaId, _id: viajeId })
    .select('estado manifiesto remesa soporteInterno rastreo.servidor rastreo.externoId rastreo.origen').lean();
  // Solo los viajes que van a la app nueva (los de la app anterior no reciben documentos)
  if (!v || v.rastreo?.servidor !== 'app' || !v.rastreo?.externoId) return { enviados: [], quitados: [] };
  const empresa = await Empresa.findById(empresaId).select('+logo').lean();
  const base = `/viajes/${encodeURIComponent(v.rastreo.externoId)}/documentos`;
  const vigentes = documentosVigentes(v);
  const enviados = []; const quitados = [];

  const generar = {
    manifiesto: async () => { const d = await datosManifiesto(empresa, v._id); return { numero: v.manifiesto.numero, pdf: await manifiestoPdf(d) }; },
    remesa: async () => { const d = await datosRemesa(empresa, v._id); return { numero: v.remesa.numero, pdf: await remesaPdf(d) }; },
    soporte: async () => {
      const d = await soporteInterno(empresa, v._id, { asignar: false });
      return { numero: v.soporteInterno.mc, pdf: await manifiestoPdf(d) };
    },
  };

  for (const tipo of ['manifiesto', 'remesa', 'soporte']) {
    if (vigentes[tipo]) {
      const { numero, pdf } = await generar[tipo]();
      await llamarApp(`${base}/${tipo}?numero=${encodeURIComponent(numero || '')}`, { metodo: 'PUT', archivo: { tipo: 'application/pdf', datos: pdf } });
      enviados.push(tipo);
    } else {
      await llamarApp(`${base}/${tipo}`, { metodo: 'DELETE' });
      quitados.push(tipo);
    }
  }
  return { enviados, quitados };
}

/** En segundo plano: un fallo de la app nunca detiene la operación de la oficina; queda en el registro. */
export function avisarDocumentosApp(empresaId, viajeId) {
  sincronizarDocumentosApp(empresaId, viajeId).catch((e) => {
    console.warn(`No se pudieron enviar los documentos del viaje ${viajeId} a la app de conductores: ${e.message}`);
  });
}
