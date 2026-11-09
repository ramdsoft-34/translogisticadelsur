// Fase 13: calendario de obligaciones del SG-SST (Ministerio del Trabajo y ARL) y del PESV (Ministerio de
// Transporte y Superintendencia de Transporte). Reglas puras: de aquí sale el plan anual de cada empresa.
// Las fechas son sugeridas: cada empresa las ajusta en su plan (por ejemplo, la fecha de registro que fije la
// circular del Ministerio del Trabajo de ese año o el calendario de reporte de la Supertransporte).

import { evidenciaTexto } from './estandares.js';

// periodicidad: anual { mes, dia } · mensual { dia } · trimestral { meses, dia }
const LISTA = [
  // ── Ministerio del Trabajo y ARL (SG-SST) ──
  { clave: 'autoevaluacion', titulo: 'Hacer la autoevaluación de estándares mínimos del año', entidad: 'MinTrabajo', ciclo: 'V',
    norma: 'Res. 0312 de 2019, art. 27 · Circular 0027 de 2026', periodicidad: 'anual', mes: 12, dia: 15, evidencia: 'Autoevaluación' },
  { clave: 'registro-mintrabajo', titulo: 'Registrar la autoevaluación y el plan de mejoramiento en sgrl.mintrabajo.gov.co y enviar copia a la ARL', entidad: 'MinTrabajo',
    ciclo: 'V', norma: 'Res. 0312 de 2019, art. 28 · Circular 0027 de 2026 (la fecha la fija la circular de cada año)', periodicidad: 'anual', mes: 7, dia: 31, evidencia: 'Constancia del registro' },
  { clave: 'avance-arl', titulo: 'Enviar a la ARL el informe de avance del plan de mejoramiento', entidad: 'ARL', ciclo: 'A',
    norma: 'Res. 0312 de 2019, art. 28 · Circular 0027 de 2026', periodicidad: 'anual', mes: 7, dia: 31, evidencia: 'Plan de mejoramiento con avances' },
  { clave: 'plan-anual', titulo: 'Formular y firmar el plan anual de trabajo del año siguiente', entidad: 'MinTrabajo', ciclo: 'P',
    norma: 'Decreto 1072 de 2015, art. 2.2.4.6.8 · Circular 0027 de 2026', periodicidad: 'anual', mes: 12, dia: 20, evidencia: 'SST-14' },
  { clave: 'matriz-legal', titulo: 'Actualizar la matriz legal', entidad: 'MinTrabajo', ciclo: 'P', norma: 'Res. 0312 de 2019, ítem 2.7.1', periodicidad: 'anual', mes: 1, dia: 31, evidencia: 'SST-17' },
  { clave: 'matriz-peligros', titulo: 'Revisar la matriz de peligros (incluido riesgo vial y psicosocial)', entidad: 'MinTrabajo', ciclo: 'P',
    norma: 'Decreto 1072 de 2015, art. 2.2.4.6.15 · Decreto 728 de 2025', periodicidad: 'anual', mes: 2, dia: 28, evidencia: 'SST-29' },
  { clave: 'objetivos', titulo: 'Revisar la política y los objetivos del SG-SST', entidad: 'MinTrabajo', ciclo: 'P', norma: 'Res. 0312 de 2019, ítems 2.1.1 y 2.2.1',
    periodicidad: 'anual', mes: 1, dia: 31, evidencia: 'SST-12 · SST-13' },
  { clave: 'examenes', titulo: 'Programar los exámenes médicos periódicos', entidad: 'MinTrabajo', ciclo: 'H', norma: 'Res. 1843 de 2025', periodicidad: 'anual', mes: 3, dia: 31, evidencia: 'SST-23' },
  { clave: 'simulacro', titulo: 'Hacer el simulacro de emergencia', entidad: 'MinTrabajo', ciclo: 'H', norma: 'Decreto 1072 de 2015, art. 2.2.4.6.25', periodicidad: 'anual', mes: 10, dia: 31, evidencia: 'SST-35' },
  { clave: 'auditoria', titulo: 'Hacer la auditoría interna del SG-SST (planificada con el Vigía)', entidad: 'MinTrabajo', ciclo: 'V',
    norma: 'Decreto 1072 de 2015, art. 2.2.4.6.29', periodicidad: 'anual', mes: 11, dia: 15, evidencia: 'SST-36' },
  { clave: 'revision-direccion', titulo: 'Hacer la revisión por la alta dirección', entidad: 'MinTrabajo', ciclo: 'A', norma: 'Decreto 1072 de 2015, art. 2.2.4.6.31',
    periodicidad: 'anual', mes: 11, dia: 30, evidencia: 'SST-37' },
  { clave: 'rendicion', titulo: 'Hacer la rendición de cuentas en SST', entidad: 'MinTrabajo', ciclo: 'V', norma: 'Decreto 1072 de 2015, art. 2.2.4.6.8 num. 2',
    periodicidad: 'anual', mes: 12, dia: 10, evidencia: 'SST-16' },
  { clave: 'vigia', titulo: 'Reunión mensual del Vigía de SST', entidad: 'MinTrabajo', ciclo: 'H', norma: 'Res. 2013 de 1986', periodicidad: 'mensual', dia: 28, evidencia: 'SST-07' },
  { clave: 'convivencia', titulo: 'Reunión mensual del Comité de Convivencia Laboral', entidad: 'MinTrabajo', ciclo: 'H', norma: 'Res. 3461 de 2025',
    periodicidad: 'mensual', dia: 28, evidencia: 'SST-07' },
  { clave: 'indicadores', titulo: 'Medir los indicadores del mes (frecuencia, severidad, ausentismo)', entidad: 'MinTrabajo', ciclo: 'V',
    norma: 'Res. 0312 de 2019, art. 30', periodicidad: 'mensual', dia: 10, evidencia: 'SST-27' },
  // ── Ministerio de Transporte y Superintendencia de Transporte (PESV) ──
  { clave: 'comite-vial', titulo: 'Reunión del Comité de Seguridad Vial', entidad: 'MinTransporte', ciclo: 'H', norma: 'Res. 40595 de 2022, paso 2',
    periodicidad: 'trimestral', meses: [3, 6, 9, 12], dia: 28, evidencia: 'SST-07' },
  { clave: 'indicadores-pesv', titulo: 'Medir los indicadores del PESV del trimestre', entidad: 'MinTransporte', ciclo: 'V', norma: 'Res. 40595 de 2022, paso 20',
    periodicidad: 'trimestral', meses: [3, 6, 9, 12], dia: 30, evidencia: 'PESV-06' },
  { clave: 'reporte-pesv', titulo: 'Reportar el PESV a la Superintendencia de Transporte (ajuste la fecha a su calendario)', entidad: 'Supertransporte', ciclo: 'V',
    norma: 'Ley 1503 de 2011 · Res. 40595 de 2022', periodicidad: 'anual', mes: 12, dia: 15, evidencia: 'PESV-06' },
  { clave: 'diagnostico-pesv', titulo: 'Actualizar el diagnóstico y la matriz de riesgos viales', entidad: 'MinTransporte', ciclo: 'P', norma: 'Res. 40595 de 2022, pasos 5 y 6',
    periodicidad: 'anual', mes: 2, dia: 28, evidencia: 'PESV-04 · PESV-05' },
  { clave: 'auditoria-pesv', titulo: 'Hacer la auditoría anual del PESV', entidad: 'MinTransporte', ciclo: 'V', norma: 'Res. 40595 de 2022, paso 22',
    periodicidad: 'anual', mes: 11, dia: 15, evidencia: 'PESV-20' },
  { clave: 'evaluacion-vinculados', titulo: 'Evaluar a los propietarios vinculados y sus conductores (contrato, salario mínimo, ARL en la clase de la conducción)',
    entidad: 'MinTransporte', ciclo: 'V', norma: 'Res. 40595 de 2022, paso 18 · Circular conjunta MinTrabajo-MinTransporte 2026 (transporte de carga)',
    periodicidad: 'anual', mes: 6, dia: 30, evidencia: 'PESV-18 · SST-19' },
];
// La evidencia se muestra con su nombre (no solo el código del listado de documentos)
export const OBLIGACIONES = LISTA.map((o) => ({ ...o, evidencia: evidenciaTexto(o.evidencia) }));

export const ENTIDADES = { MinTrabajo: 'Ministerio del Trabajo', ARL: 'ARL', MinTransporte: 'Ministerio de Transporte', Supertransporte: 'Superintendencia de Transporte', Interno: 'Interno' };

const fechaCol = (anio, mes, dia) => {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes - 1, Math.min(dia, ultimo), 17));   // mediodía en Colombia, como las fechas que se escriben en el módulo
};
const pad = (n) => String(n).padStart(2, '0');

/** Todas las fechas de un año: una por obligación anual, 12 por mensual, 4 por trimestral. clave única por periodo. */
export function ocurrencias(anio) {
  const out = [];
  for (const o of OBLIGACIONES) {
    const meses = o.periodicidad === 'anual' ? [o.mes] : o.periodicidad === 'mensual' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : o.meses;
    for (const m of meses) {
      const periodo = o.periodicidad === 'anual' ? String(anio) : `${anio}-${pad(m)}`;
      out.push({ clave: `${o.clave}@${periodo}`, obligacion: o.clave, titulo: o.periodicidad === 'anual' ? o.titulo : `${o.titulo} (${MESES[m - 1]})`,
        entidad: o.entidad, norma: o.norma, ciclo: o.ciclo, evidencia: o.evidencia, fecha: fechaCol(anio, m, o.dia) });
    }
  }
  return out.sort((a, b) => a.fecha - b.fecha);
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Lo que exige el resultado de una autoevaluación (Res. 0312, art. 28): informe de avances a la ARL a 3 o 6 meses. */
export function obligacionesPorResultado({ vigencia, fecha, nivel }) {
  if (!nivel?.mesesAvance || !fecha) return [];
  const f = new Date(fecha);
  const vence = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + nivel.mesesAvance, f.getUTCDate(), 17));
  return [{ clave: `avance-resultado@${vigencia}`, obligacion: 'avance-resultado', entidad: 'ARL', ciclo: 'A', evidencia: 'Plan de mejoramiento con avances',
    titulo: `Informe de avances del plan de mejoramiento a la ARL (resultado ${nivel.texto.toLowerCase()} de la vigencia ${vigencia})`,
    norma: `Res. 0312 de 2019, art. 28: máximo ${nivel.mesesAvance} meses después de la autoevaluación`, fecha: vence }];
}
