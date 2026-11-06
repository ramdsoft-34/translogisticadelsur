// Tablero de SG-SST y PESV: todo calculado con datos reales. Lo que no tiene datos sale vacío, nunca con números de ejemplo.
// Los porcentajes de estándares mínimos y PESV son los de la última autoevaluación del responsable (no se calculan).
import { SstColaborador, SstFormato } from '../../models/sst.js';
import { datosEmpresa } from './datos.js';
import { vencimientosSst } from './vencimientos.js';
import * as insp from './inspecciones.js';
import * as cap from './capacitaciones.js';
import { incidentes, sincronizarFirmas } from './app.js';
import { hoyColombia } from './comun.js';

export async function tablero(empresaId, ahora = new Date()) {
  await sincronizarFirmas(empresaId).catch(() => 0);
  const anio = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric' }).format(ahora));
  const inicioMes = new Date(hoyColombia(ahora)); inicioMes.setUTCDate(1);
  const ultimos = await insp.ultimosPorPlaca(empresaId);
  const [d, venc, hoy, mes, programa, proximas, colaboradores, formatosMes, reportes] = await Promise.all([
    datosEmpresa(empresaId),
    vencimientosSst(empresaId, { dias: 30, kmPreoperacional: ultimos, ahora }),
    insp.hoy(empresaId).catch(() => ({ usaApp: false, aptos: 0, noAptos: [], sinPreoperacional: [], total: 0, hechos: 0 })),
    insp.delMes(empresaId).catch(() => null),
    cap.listar(empresaId, anio, ahora),
    cap.proximas(empresaId, 3, ahora),
    SstColaborador.find({ empresa: empresaId, activo: { $ne: false } }).select('tipo').lean(),
    SstFormato.countDocuments({ empresa: empresaId, estado: 'final', updatedAt: { $gte: inicioMes } }),
    incidentes(empresaId, 'recibido').catch(() => ({ usaApp: false, items: [] })),
  ]);
  return {
    empresa: { nombre: d.empresa.nombre, arl: d.riesgo.arl, claseRiesgo: d.riesgo.claseRiesgo, nivelPesv: d.riesgo.nivelPesv },
    indicadores: { vencidos: venc.resumen.vencidos, preoperacionalesHoy: hoy.usaApp ? { hechos: hoy.hechos, total: hoy.total } : null, noAptosHoy: hoy.usaApp ? hoy.noAptos.length : null },
    autoevaluacion: d.autoevaluacion,
    flota: d.flota,
    capacitaciones: programa.indicadores,
    colaboradores: { total: colaboradores.length, conductores: colaboradores.filter((c) => c.tipo === 'conductor').length,
      directos: colaboradores.filter((c) => c.tipo === 'directo').length, formatosMes },
    vencimientos: { resumen: venc.resumen, items: venc.items.slice(0, 12), total: venc.items.length },
    preoperacional: { ...hoy, mes },
    proximasCapacitaciones: proximas,
    incidentesSinRevisar: reportes.items.length,
    datosCompletos: !!(d.responsables.responsableSst && d.riesgo.arl),
  };
}
