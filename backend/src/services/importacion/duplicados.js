// Viajes duplicados: el mismo viaje registrado dos veces (sobre todo los que repitió la importación del Excel del 30/10/2026).
// Se agrupan por cliente, placa y día. En cada grupo se conserva el «original» (el que tiene manifiesto del RNDC o, si
// ninguno lo tiene, el primero que se registró) y los demás son candidatos a duplicado cuando no tienen un manifiesto propio
// distinto. «Seguro»: mismo destino. «Revisar»: destino escrito distinto (podría ser otro viaje).
// Anular no borra: el viaje queda anulado con el motivo, y su soporte interno también (no cuenta en liquidaciones ni cobros).
import { EnvioWhatsapp, Viaje, pob } from '../../models/index.js';
import { bloqueadosPorRelacion } from '../gestion/relaciones.js';
import { normalizar, txt } from '../../utils/texto.js';

const dia = (f) => new Date(f).toISOString().slice(0, 10);
const manifiestoDe = (v) => txt(v.manifiesto?.numero).replace(/\.$/, '');
const resumen = (v) => ({ _id: v._id, numero: v.numero, destino: v.destino, flete: v.flete, manifiesto: manifiestoDe(v), soporte: v.soporteInterno?.mc || '',
  registrado: v.createdAt, historico: !!v.historico, estado: v.estado });

export async function detectarDuplicados(empresaId) {
  const viajes = await Viaje.find({ empresa: empresaId, estado: { $ne: 'anulado' } })
    .select('numero fecha placa cliente destino tarifaRef flete manifiesto.numero manifiesto.estado soporteInterno.mc historico estado createdAt liquidacion liquidacionConductor')
    .populate(pob(empresaId, 'cliente', 'nombre')).lean();
  const grupos = new Map();
  for (const v of viajes) {
    const k = `${v.cliente?._id || v.cliente}|${v.placa}|${dia(v.fecha)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(v);
  }
  const pares = [];
  for (const l of grupos.values()) {
    if (l.length < 2) continue;
    l.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    // Se conserva el que se registró primero y se anula el más reciente; solo si el primero no tiene manifiesto y uno
    // más reciente sí, se conserva el del manifiesto (anularlo dañaría el documento del RNDC) y el par queda «revisar».
    const conManifiesto = l.find((v) => manifiestoDe(v) && v.manifiesto?.estado === 'aceptado');
    const original = l[0].manifiesto?.estado === 'aceptado' || !conManifiesto ? l[0] : conManifiesto;
    for (const v of l) {
      if (v === original) continue;
      // Dos manifiestos distintos son dos viajes de verdad
      if (manifiestoDe(v) && manifiestoDe(v) !== manifiestoDe(original)) continue;
      const mismoDestino = (v.tarifaRef && original.tarifaRef && String(v.tarifaRef) === String(original.tarifaRef)) || normalizar(v.destino) === normalizar(original.destino);
      const alReves = new Date(v.createdAt) < new Date(original.createdAt);
      pares.push({ fecha: dia(v.fecha), placa: v.placa, cliente: v.cliente?.nombre || '', certeza: mismoDestino && !alReves ? 'seguro' : 'revisar',
        nota: alReves ? 'Se conserva el más reciente porque es el que tiene manifiesto' : '',
        original: resumen(original), duplicado: resumen(v),
        bloqueo: v.liquidacionConductor ? 'Ya está liquidado al conductor' : v.liquidacion ? 'Está en una liquidación de fletes' : '' });
    }
  }
  const facturados = await bloqueadosPorRelacion(empresaId, pares.map((p) => p.duplicado._id));
  for (const p of pares) if (!p.bloqueo && facturados.has(String(p.duplicado._id))) p.bloqueo = `Está en la relación ${facturados.get(String(p.duplicado._id))}, ya facturada`;
  pares.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.placa.localeCompare(b.placa));
  return { total: pares.length, seguros: pares.filter((p) => p.certeza === 'seguro').length, revisar: pares.filter((p) => p.certeza === 'revisar').length, pares };
}

/** Anula los duplicados elegidos (se vuelve a comprobar cada uno). */
export async function anularDuplicados(empresaId, usuario, ids) {
  const vigentes = new Map((await detectarDuplicados(empresaId)).pares.map((p) => [String(p.duplicado._id), p]));
  const anulados = []; const omitidos = [];
  for (const id of [...new Set(ids.map(String))]) {
    const p = vigentes.get(id);
    if (!p) { omitidos.push({ _id: id, motivo: 'Ya no aparece como duplicado' }); continue; }
    if (p.bloqueo) { omitidos.push({ _id: id, numero: p.duplicado.numero, motivo: p.bloqueo }); continue; }
    const motivo = `Duplicado del viaje N° ${p.original.numero}${p.duplicado.historico ? ' (importación del Excel)' : ''}`;
    const v = await Viaje.findOne({ empresa: empresaId, _id: id });
    v.estado = 'anulado';
    v.observaciones = `[ANULADO: ${motivo}] ${txt(v.observaciones)}`.trim().slice(0, 500);
    if (v.soporteInterno?.mc && v.soporteInterno.estado !== 'anulado') {
      v.soporteInterno.estado = 'anulado';
      v.soporteInterno.anulado = { fecha: new Date(), motivo, usuario };
    }
    v.actualizadoPor = usuario;
    await v.save();
    // Lo que estaba por enviar por WhatsApp de ese viaje ya no se envía
    await EnvioWhatsapp.updateMany({ empresa: empresaId, viaje: v._id, estado: { $in: ['por_aprobar', 'pendiente'] } }, { $set: { estado: 'descartado', error: motivo } });
    anulados.push({ _id: id, numero: p.duplicado.numero, original: p.original.numero, motivo });
  }
  return { anulados, omitidos };
}
