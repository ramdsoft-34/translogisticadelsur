// Fase 13: los 60 estándares mínimos de la Resolución 0312 de 2019 (capítulo III: riesgo IV y V) con su peso,
// el formato que sirve de evidencia y la acción del plan de mejora. Reglas puras: puntaje por ciclo PHVA,
// nivel de la calificación y acciones que salen de los ítems que no cumplen. Sin base de datos.
//
// Cada ítem vale su peso si cumple o no aplica (con justificación) y 0 si no cumple (Res. 0312, art. 27).
// La plataforma calcula; la calificación de cada ítem la decide el responsable del SG-SST.

// [numeral, ítem, peso, formato de evidencia, acción del plan de mejora]
const FILAS = [
  ['1.1.1', "Asignación de una persona que diseñe e implemente el Sistema de Gestión de SST", 0.5, 'SST-01', "Designar por escrito al responsable del SG-SST con licencia y curso de 50 horas vigentes"],
  ['1.1.2', "Asignación de responsabilidades en SST", 0.5, 'SST-02', "Asignar, documentar y comunicar las responsabilidades en SST a todos los niveles, incluida la gerencia"],
  ['1.1.3', "Asignación de recursos para el Sistema de Gestión en SST", 0.5, 'SST-03', "Definir y aprobar el presupuesto del SG-SST (recursos financieros, técnicos, físicos y humanos)"],
  ['1.1.4', "Afiliación al Sistema de Seguridad Social Integral", 0.5, 'SST-04', "Verificar cada mes la afiliación y el pago de seguridad social de trabajadores y conductores vinculados (clase de riesgo de la conducción)"],
  ['1.1.5', "Identificación de trabajadores que se dediquen en forma permanente a actividades de alto riesgo y cotización de pensión especial", 0.5, 'SST-05', "Identificar si algún cargo es de alto riesgo para pensión especial (Decreto 2090 de 2003) y dejar el análisis firmado"],
  ['1.1.6', "Conformación y funcionamiento COPASST", 0.5, 'SST-06', "Designar el Vigía de SST (o conformar el COPASST) con acta de elección y reuniones mensuales"],
  ['1.1.7', "Capacitación de los integrantes del COPASST", 0.5, 'SST-09', "Capacitar al Vigía de SST en sus funciones y guardar el soporte"],
  ['1.1.8', "Conformación y funcionamiento del Comité de Convivencia Laboral", 0.5, 'SST-08', "Conformar el Comité de Convivencia Laboral según la Resolución 3461 de 2025 (reuniones mensuales y política de prevención del acoso)"],
  ['1.2.1', "Programa de capacitación anual", 2, 'SST-09', "Elaborar y ejecutar el programa anual de capacitación en SST y seguridad vial con registro de asistencia"],
  ['1.2.2', "Inducción y reinducción en SST", 2, 'SST-11', "Hacer inducción y reinducción en SST a trabajadores y conductores vinculados antes de iniciar labores"],
  ['1.2.3', "Curso Virtual de capacitación de cincuenta (50) horas en SST", 2, 'SST-01', "Mantener vigente el certificado del curso virtual de 50 horas del responsable del SG-SST"],
  ['2.1.1', "Política de Seguridad y Salud en el Trabajo", 1, 'SST-12', "Firmar, publicar y divulgar la política de SST, y revisarla una vez al año"],
  ['2.2.1', "Objetivos de SST", 1, 'SST-13', "Definir objetivos y metas medibles del SG-SST, firmados por la gerencia"],
  ['2.3.1', "Evaluación Inicial del Sistema de Gestión", 1, 'SST-38', "Hacer la evaluación inicial / autoevaluación anual con el responsable y dejarla firmada"],
  ['2.4.1', "Plan Anual de Trabajo", 2, 'SST-14', "Formular el plan anual de trabajo con objetivos, metas, responsables, recursos y cronograma, firmado"],
  ['2.5.1', "Archivo y retención documental del Sistema de Gestión de SST", 2, 'SST-15', "Definir el archivo y la retención documental del SG-SST (mínimo 20 años para los registros de salud)"],
  ['2.6.1', "Rendición de cuentas", 1, 'SST-16', "Hacer la rendición de cuentas anual de todos los que tienen responsabilidades en SST"],
  ['2.7.1', "Matriz legal", 2, 'SST-17', "Actualizar la matriz legal con las normas vigentes (Res. 3461/2025, Decreto 728/2025, Ley 2460/2025, Circular 0027/2026, circular de transporte de carga 2026)"],
  ['2.8.1', "Mecanismos de comunicación", 1, 'SST-18', "Implementar mecanismos de comunicación y autorreporte de condiciones de trabajo y salud"],
  ['2.9.1', "Identificación y evaluación para la adquisición de bienes y servicios", 1, 'SST-19', "Establecer el procedimiento de adquisición de bienes y servicios con requisitos de SST"],
  ['2.10.1', "Evaluación y selección de proveedores y contratistas", 2, 'SST-19', "Evaluar y seleccionar proveedores, contratistas y propietarios vinculados con criterios de SST (incluye la relación laboral del conductor)"],
  ['2.11.1', "Gestión del cambio", 1, 'SST-20', "Documentar la gestión del cambio (nuevas rutas, vehículos, clientes o normas) y su evaluación de riesgos"],
  ['3.1.1', "Descripción sociodemográfica y Diagnóstico de condiciones de salud de los trabajadores", 1, 'SST-21', "Levantar el perfil sociodemográfico y el diagnóstico de condiciones de salud de trabajadores y conductores"],
  ['3.1.2', "Actividades de medicina del trabajo y de prevención y promoción de la Salud", 1, 'SST-24', "Ejecutar actividades de promoción y prevención en salud según el diagnóstico"],
  ['3.1.3', "Perfiles de cargos", 1, 'SST-22', "Remitir al médico laboral los perfiles de cargo (profesiograma)"],
  ['3.1.4', "Evaluaciones médicas ocupacionales", 1, 'SST-23', "Realizar las evaluaciones médicas ocupacionales según la Resolución 1843 de 2025 y comunicar los resultados"],
  ['3.1.5', "Custodia de historias clínicas", 1, 'SST-23', "Obtener la constancia de custodia de las historias clínicas por la IPS"],
  ['3.1.6', "Restricciones y recomendaciones médico laborales", 1, 'SST-23', "Hacer seguimiento a las restricciones y recomendaciones médico-laborales"],
  ['3.1.7', "Estilos de vida y entorno saludable", 1, 'SST-24', "Implementar el programa de estilos de vida saludable, salud mental y prevención del consumo de alcohol y drogas (Decreto 728/2025, Ley 2460/2025)"],
  ['3.1.8', "Servicios de higiene", 1, 'SST-31', "Garantizar agua potable, servicios sanitarios y disposición de basuras"],
  ['3.1.9', "Manejo de residuos", 1, 'SST-31', "Documentar el manejo y la eliminación de residuos sólidos, líquidos y gaseosos (punto ecológico y registros)"],
  ['3.2.1', "Reporte de accidentes de trabajo y enfermedades laborales", 2, 'SST-25', "Reportar a la ARL y a la EPS los accidentes y enfermedades laborales dentro de los 2 días hábiles"],
  ['3.2.2', "Investigación de incidentes, accidentes de trabajo y las enfermedades cuando sean diagnosticadas como laborales", 2, 'SST-26', "Investigar los incidentes y accidentes dentro de los 15 días con el Vigía y el responsable"],
  ['3.2.3', "Registro y análisis estadístico de accidentes de trabajo y enfermedades laborales", 1, 'SST-27', "Llevar el registro y análisis estadístico de incidentes, accidentes y enfermedades laborales"],
  ['3.3.1', "Frecuencia de accidentalidad", 1, 'SST-27', "Medir cada mes la frecuencia de accidentalidad"],
  ['3.3.2', "Severidad de accidentalidad", 1, 'SST-27', "Medir cada mes la severidad de accidentalidad"],
  ['3.3.3', "Proporción de accidentes de trabajo mortales", 1, 'SST-27', "Medir cada año la proporción de accidentes mortales"],
  ['3.3.4', "Prevalencia de la enfermedad laboral.", 1, 'SST-27', "Medir cada año la prevalencia de enfermedad laboral"],
  ['3.3.5', "Incidencia de la enfermedad laboral", 1, 'SST-27', "Medir cada año la incidencia de enfermedad laboral"],
  ['3.3.6', "Ausentismo por causa médica", 1, 'SST-28', "Medir cada mes el ausentismo por causa médica"],
  ['4.1.1', "Metodología para identificación de peligros, evaluación y valoración de riesgos", 4, 'SST-29', "Definir la metodología de identificación de peligros y valoración de riesgos (GTC 45)"],
  ['4.1.2', "Identificación de peligros y evaluación y valoración de riesgos con participación de todos los niveles de la empresa", 4, 'SST-29', "Elaborar la matriz de peligros con participación de todos los niveles, incluido el riesgo vial y psicosocial"],
  ['4.1.3', "Identificación de sustancias catalogadas como carcinógenas o con toxicidad aguda.", 3, 'SST-29', "Hacer el inventario de sustancias químicas (combustibles, aceites) con sus fichas de seguridad, o justificar por escrito que no aplica"],
  ['4.1.4', "Mediciones ambientales", 4, 'SST-29', "Realizar las mediciones ambientales que indique la matriz (ruido, iluminación, vibración) con apoyo de la ARL"],
  ['4.2.1', "Medidas de prevención y control frente a peligros/riesgos identificados", 2.5, 'SST-29', "Implementar las medidas de prevención y control de los riesgos de la matriz"],
  ['4.2.2', "Aplicación de medidas de prevención y control por parte de los trabajadores", 2.5, 'SST-29', "Verificar que los trabajadores y conductores aplican las medidas de control (inspecciones y observaciones)"],
  ['4.2.3', "Procedimientos e instructivos internos de seguridad y salud en el trabajo", 2.5, 'SST-30', "Elaborar y entregar los procedimientos e instructivos de trabajo seguro (cargue, descargue, amarre, conducción)"],
  ['4.2.4', "Inspecciones a instalaciones, maquinaria o equipos", 2.5, 'SST-31', "Inspeccionar instalaciones, equipos, extintores y botiquines con el Vigía"],
  ['4.2.5', "Mantenimiento periódico de las instalaciones, equipos, máquinas y herramientas", 2.5, 'PESV-15', "Ejecutar y registrar el mantenimiento preventivo de instalaciones y vehículos"],
  ['4.2.6', "Entrega de los Elementos de Protección Personal (EPP) y capacitación en uso adecuado", 2.5, 'SST-32', "Entregar los elementos de protección personal con registro firmado y capacitación en su uso"],
  ['5.1.1', "Plan de prevención, preparación y respuesta ante emergencias", 5, 'SST-33', "Elaborar el plan de prevención, preparación y respuesta ante emergencias, incluido el siniestro vial"],
  ['5.1.2', "Brigada de prevención, preparación y respuesta ante emergencias", 5, 'SST-34', "Conformar, capacitar y dotar la brigada de emergencias y hacer el simulacro anual"],
  ['6.1.1', "Definición de indicadores del Sistema de Gestión de Seguridad y Salud en el Trabajo", 1.25, 'SST-27', "Definir las fichas de los indicadores de estructura, proceso y resultado del SG-SST"],
  ['6.1.2', "Auditoría anual", 1.25, 'SST-36', "Realizar la auditoría interna anual del SG-SST"],
  ['6.1.3', "Revisión por la alta dirección. Alcance de la auditoría del Sistema de Gestión", 1.25, 'SST-37', "Hacer la revisión anual por la alta dirección con sus resultados"],
  ['6.1.4', "Planificación de la auditoría con el COPASST", 1.25, 'SST-36', "Planificar la auditoría con el Vigía de SST"],
  ['7.1.1', "Acciones preventivas y/o correctivas", 2.5, 'SST-38', "Definir las acciones preventivas y correctivas con base en los resultados del SG-SST"],
  ['7.1.2', "Acciones de mejora conforme a revisión de la Alta Dirección", 2.5, 'SST-38', "Ejecutar las acciones de mejora que salgan de la revisión por la dirección"],
  ['7.1.3', "Acciones de mejora con base en investigaciones de accidentes de trabajo y enfermedades laborales", 2.5, 'SST-38', "Ejecutar las acciones de mejora que salgan de las investigaciones de accidentes"],
  ['7.1.4', "Plan de mejoramiento", 2.5, 'SST-38', "Implementar el plan de mejoramiento y las medidas que pidan las autoridades y la ARL"],];

export const ESTANDARES = FILAS.map(([numeral, item, peso, formato, accion]) => ({ numeral, item, peso, formato, accion, grupo: numeral.split('.')[0] }));
const POR_NUMERAL = new Map(ESTANDARES.map((e) => [e.numeral, e]));
export const estandar = (numeral) => POR_NUMERAL.get(numeral) || null;

export const CICLOS = [
  { ciclo: 'P', nombre: 'Planear', peso: 25, grupos: [['1', 'Recursos', 10], ['2', 'Gestión integral del SG-SST', 15]] },
  { ciclo: 'H', nombre: 'Hacer', peso: 60, grupos: [['3', 'Gestión de la salud', 20], ['4', 'Gestión de peligros y riesgos', 30], ['5', 'Gestión de amenazas', 10]] },
  { ciclo: 'V', nombre: 'Verificar', peso: 5, grupos: [['6', 'Verificación del SG-SST', 5]] },
  { ciclo: 'A', nombre: 'Actuar', peso: 10, grupos: [['7', 'Mejoramiento', 10]] },
];
export const cicloDe = (numeral) => CICLOS.find((c) => c.grupos.some((g) => g[0] === String(numeral).split('.')[0]))?.ciclo || '';

export const ESTADOS = ['C', 'NC', 'NA'];
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Nivel de la calificación y lo que exige el artículo 28 de la Resolución 0312.
 * mesesAvance: plazo del informe de avances a la ARL (crítico 3 meses, moderado 6 meses).
 */
export function nivelDe(total) {
  if (total < 60) return { clave: 'critico', texto: 'Crítico', mesesAvance: 3,
    acciones: ['Plan de mejoramiento de inmediato, a disposición del Ministerio del Trabajo', 'Informe de avances a la ARL en máximo 3 meses', 'Seguimiento anual y plan de visita del Ministerio del Trabajo'] };
  if (total <= 85) return { clave: 'moderado', texto: 'Moderadamente aceptable', mesesAvance: 6,
    acciones: ['Plan de mejoramiento a disposición del Ministerio del Trabajo', 'Informe de avances a la ARL en máximo 6 meses', 'Plan de visita del Ministerio del Trabajo'] };
  return { clave: 'aceptable', texto: 'Aceptable', mesesAvance: null,
    acciones: ['Mantener la calificación y las evidencias a disposición del Ministerio del Trabajo', 'Incluir en el plan anual las mejoras detectadas'] };
}

/** items: [{ numeral, estado }] o { numeral: estado }. Devuelve total, nivel, conteos y avance por ciclo y estándar. */
export function calcular(items) {
  const est = new Map(Array.isArray(items) ? items.map((i) => [i.numeral, i.estado]) : Object.entries(items || {}));
  const vale = (e) => (['C', 'NA'].includes(est.get(e.numeral)) ? e.peso : 0);
  const conteos = { C: 0, NC: 0, NA: 0, sinCalificar: 0 };
  for (const e of ESTANDARES) { const s = est.get(e.numeral); if (ESTADOS.includes(s)) conteos[s] += 1; else conteos.sinCalificar += 1; }
  const ciclos = CICLOS.map((c) => {
    const grupos = c.grupos.map(([g, nombre, peso]) => ({ grupo: g, nombre, peso, obtenido: r2(ESTANDARES.filter((e) => e.grupo === g).reduce((s, e) => s + vale(e), 0)) }));
    const obtenido = r2(grupos.reduce((s, g) => s + g.obtenido, 0));
    return { ciclo: c.ciclo, nombre: c.nombre, peso: c.peso, obtenido, porcentaje: r2(obtenido / c.peso * 100), grupos };
  });
  const total = r2(ciclos.reduce((s, c) => s + c.obtenido, 0));
  return { total, nivel: nivelDe(total), conteos, completa: conteos.sinCalificar === 0, ciclos };
}

const DIA = 86400000;
/** Plazo de cada acción según su peso: lo que más pesa va primero (Res. 0312: el plan del nivel crítico es inmediato). */
export function plazoDias(peso) { return peso >= 2.5 ? 60 : peso >= 1 ? 90 : 120; }

/**
 * Acciones del plan de mejora para los ítems que no cumplen, ordenadas por lo que suben el puntaje.
 * desde: fecha de la autoevaluación. responsable: nombre del responsable del SG-SST.
 */
export function accionesDeMejora(items, { desde = new Date(), responsable = '' } = {}) {
  const est = new Map(Array.isArray(items) ? items.map((i) => [i.numeral, i.estado]) : Object.entries(items || {}));
  return ESTANDARES.filter((e) => est.get(e.numeral) === 'NC')
    .sort((a, b) => b.peso - a.peso || a.numeral.localeCompare(b.numeral, 'es', { numeric: true }))
    .map((e) => ({
      numeral: e.numeral, titulo: e.accion, detalle: e.item, evidencia: e.formato, peso: e.peso, ciclo: cicloDe(e.numeral),
      responsable, fecha: new Date(new Date(desde).getTime() + plazoDias(e.peso) * DIA),
    }));
}

/** Cuánto sube el puntaje cumpliendo las acciones en orden, hasta salir del nivel crítico (60 %). */
export function metaSalida(items) {
  const { total } = calcular(items);
  if (total >= 60) return { total, necesarias: 0, llega: total };
  let suma = total, n = 0;
  for (const a of accionesDeMejora(items)) { if (suma >= 60) break; suma += a.peso; n += 1; }
  return { total, necesarias: n, llega: r2(suma) };
}
