// Fase 8: catálogo de formatos estándar del SG-SST y del PESV que la plataforma trae listos.
// Cada formato es un esquema: secciones con campos que la pantalla dibuja (texto, fecha, casillas, listas de
// verificación, tablas y firmas) y que el PDF reproduce con el membrete de la empresa.
// Los campos con `auto` se llenan solos con los datos de la empresa activa (ver autollenado.js → contexto()).
//
// Los ítems de la inspección mensual (SST-FOR-01) salen de los
// formatos de la Cooperativa de Transportes España (versión 1.0, 2026).

// El checklist preoperacional diario lo hace el conductor en Sur Track (ver checklistSurTrack.js); aquí queda la
// inspección mensual que hace la empresa.
export const ITEMS_INSPECCION_MENSUAL = [
  ['soat', 'SOAT vigente'], ['rtm', 'Revisión técnico-mecánica y de gases vigente'],
  ['tarjeta', 'Licencia de tránsito y tarjeta de propiedad al día'], ['licencia', 'Licencia de conducción vigente y categoría acorde'],
  ['arl', 'Afiliación vigente a ARL del conductor'], ['eps_afp', 'Afiliación vigente a EPS y pensión del conductor'],
  ['extintor', 'Extintor vehicular vigente y accesible'], ['botiquin', 'Botiquín de primeros auxilios completo'],
  ['kit', 'Kit de carretera (señales, tacos, chaleco reflectivo, linterna)'], ['cinturones', 'Cinturones de seguridad en buen estado'],
  ['frenos_luces', 'Sistema de frenos, luces y llantas en buen estado'], ['carroceria', 'Carrocería y sistema de amarre/estiba de la carga'],
  ['epp', 'EPP del conductor (chaleco, guantes, casco si aplica)'], ['identificacion', 'Documento de identificación del conductor'],
  ['polizas', 'Pólizas de responsabilidad civil (si aplica según carga)'], ['curso', 'Curso de manejo defensivo / PESV del conductor'],
  ['autorreporte', 'Sin reporte de fatiga, sueño o consumo de sustancias (autorreporte)'],
].map(([codigo, texto]) => ({ codigo, texto }));

const cabeceraVehiculo = [
  { id: 'placa', tipo: 'texto', etiqueta: 'Placa del vehículo', requerido: true, ancho: 1 },
  { id: 'conductor', tipo: 'texto', etiqueta: 'Conductor', requerido: true, ancho: 2 },
  { id: 'fecha', tipo: 'fecha', etiqueta: 'Fecha', auto: 'fecha.iso', requerido: true, ancho: 1 },
  { id: 'km', tipo: 'numero', etiqueta: 'Kilometraje', ancho: 1 },
];

export const PLANTILLAS = [
  {
    codigo: 'SST-FOR-01', version: 1, modulo: 'ambos', estandar: '4.2.4 · PESV paso 17', titulo: 'Inspección de vehículos de carga y EPP',
    descripcion: 'Inspección mensual a cargo de la empresa, complementaria al checklist diario.',
    secciones: [
      { titulo: 'Datos de la inspección', campos: [...cabeceraVehiculo,
        { id: 'propietario', tipo: 'texto', etiqueta: 'Propietario / contratista', ancho: 2 },
        { id: 'inspector', tipo: 'texto', etiqueta: 'Inspector', auto: 'empresa.responsableSst', ancho: 2 }] },
      { titulo: 'Ítems a verificar', campos: [
        { id: 'items', tipo: 'verificacion', etiqueta: 'Cumple / No cumple / No aplica', opciones: ['cumple', 'no_cumple', 'na'], items: ITEMS_INSPECCION_MENSUAL },
      ] },
      { titulo: 'Resultado', campos: [
        { id: 'hallazgos', tipo: 'textoLargo', etiqueta: 'Hallazgos, no conformidades y plan de acción' },
        { id: 'resultado', tipo: 'seleccion', etiqueta: 'Resultado', opciones: ['Apto para el servicio', 'Apto con observaciones', 'No apto'] },
        { id: 'firma_inspector', tipo: 'firma', etiqueta: 'Firma del inspector', firmante: 'inspector' },
        { id: 'firma_conductor', tipo: 'firma', etiqueta: 'Firma del conductor / propietario', firmante: 'conductor' },
      ] },
    ],
  },
  {
    codigo: 'SST-FOR-02', version: 1, modulo: 'sst', estandar: '4.2.6', titulo: 'Entrega y reposición de elementos de protección personal (EPP)',
    descripcion: 'Cada fila con la firma de quien recibe.',
    secciones: [
      { titulo: 'Entregas', campos: [
        { id: 'entregas', tipo: 'tabla', etiqueta: 'EPP entregado', columnas: [
          { id: 'nombre', etiqueta: 'Nombre del trabajador', tipo: 'texto' }, { id: 'cargo', etiqueta: 'Cargo', tipo: 'texto' },
          { id: 'elemento', etiqueta: 'EPP entregado', tipo: 'texto' }, { id: 'cantidad', etiqueta: 'Cant.', tipo: 'numero' },
          { id: 'entrega', etiqueta: 'Entrega', tipo: 'fecha' }, { id: 'reposicion', etiqueta: 'Reposición', tipo: 'fecha' },
          { id: 'firma', etiqueta: 'Firma de recibido', tipo: 'firma' }] },
      ] },
    ],
  },
  {
    codigo: 'SST-FOR-07', version: 1, modulo: 'ambos', estandar: '1.2.1 · PESV paso 11', titulo: 'Registro de asistencia a capacitaciones',
    descripcion: 'Evidencia de ejecución del programa anual de capacitación.',
    secciones: [
      { titulo: 'Sesión', campos: [
        { id: 'tema', tipo: 'texto', etiqueta: 'Tema', requerido: true, ancho: 3 },
        { id: 'fecha', tipo: 'fecha', etiqueta: 'Fecha', auto: 'fecha.iso', ancho: 1 },
        { id: 'duracion', tipo: 'numero', etiqueta: 'Duración (horas)', ancho: 1 },
        { id: 'facilitador', tipo: 'texto', etiqueta: 'Responsable / facilitador', auto: 'empresa.responsableSst', ancho: 2 },
        { id: 'dirigido', tipo: 'texto', etiqueta: 'Dirigido a', ancho: 1 },
        { id: 'temas', tipo: 'textoLargo', etiqueta: 'Temas tratados' },
        { id: 'modalidad', tipo: 'seleccion', etiqueta: 'Modalidad', opciones: ['Presencial', 'Virtual', 'Mixta'] },
        { id: 'evaluacion', tipo: 'casilla', etiqueta: 'Se aplicó evaluación de la capacitación' },
      ] },
      { titulo: 'Asistentes', campos: [
        { id: 'asistentes', tipo: 'tabla', etiqueta: 'Asistentes', columnas: [
          { id: 'nombre', etiqueta: 'Nombre completo', tipo: 'texto' }, { id: 'documento', etiqueta: 'Documento', tipo: 'texto' },
          { id: 'cargo', etiqueta: 'Cargo', tipo: 'texto' }, { id: 'firma', etiqueta: 'Firma', tipo: 'firma' }] },
        { id: 'firmasElectronicas', tipo: 'textoLargo', etiqueta: 'Firmas electrónicas desde el celular (Ley 527 de 1999)' },
      ] },
    ],
  },
  {
    codigo: 'SST-FOR-03', version: 1, modulo: 'sst', estandar: '5.1.2', titulo: 'Acta de simulacro de emergencia',
    descripcion: 'Registro anual del simulacro del plan de emergencias.',
    secciones: [
      { titulo: 'Simulacro', campos: [
        { id: 'fecha', tipo: 'fecha', etiqueta: 'Fecha', auto: 'fecha.iso', ancho: 1 }, { id: 'inicio', tipo: 'hora', etiqueta: 'Hora de inicio', ancho: 1 },
        { id: 'fin', tipo: 'hora', etiqueta: 'Hora de finalización', ancho: 1 }, { id: 'tiempo', tipo: 'texto', etiqueta: 'Tiempo total de evacuación', ancho: 1 },
        { id: 'amenaza', tipo: 'seleccion', etiqueta: 'Amenaza simulada', opciones: ['Sismo', 'Incendio', 'Inundación', 'Accidente de tránsito', 'Otra'], ancho: 2 },
        { id: 'punto', tipo: 'texto', etiqueta: 'Punto de encuentro', ancho: 2 },
        { id: 'participantes', tipo: 'textoLargo', etiqueta: 'Participantes' },
        { id: 'hallazgos', tipo: 'textoLargo', etiqueta: 'Observaciones y hallazgos' },
        { id: 'mejora', tipo: 'textoLargo', etiqueta: 'Plan de mejora / acciones correctivas' },
        { id: 'firma_responsable', tipo: 'firma', etiqueta: 'Elaborado por (Responsable SG-SST)', firmante: 'responsable' },
      ] },
    ],
  },
  {
    codigo: 'SST-ACT-01', version: 1, modulo: 'ambos', estandar: '1.1.6 · 1.1.8 · PESV paso 2', titulo: 'Acta de reunión (Vigía, COPASST, Comité de Convivencia o Comité de Seguridad Vial)',
    descripcion: 'Acta general de reunión con asistentes, temas y compromisos.',
    secciones: [
      { titulo: 'Reunión', campos: [
        { id: 'comite', tipo: 'seleccion', etiqueta: 'Instancia', opciones: ['Vigía en SST', 'COPASST', 'Comité de Convivencia Laboral', 'Comité de Seguridad Vial', 'Reunión con la gerencia'], ancho: 2 },
        { id: 'fecha', tipo: 'fecha', etiqueta: 'Fecha', auto: 'fecha.iso', ancho: 1 }, { id: 'hora', tipo: 'hora', etiqueta: 'Hora', ancho: 1 },
        { id: 'lugar', tipo: 'texto', etiqueta: 'Lugar', auto: 'empresa.direccion', ancho: 2 },
        { id: 'ciudad', tipo: 'texto', etiqueta: 'Ciudad', auto: 'empresa.ciudad', ancho: 2 },
        { id: 'orden', tipo: 'textoLargo', etiqueta: 'Orden del día' },
        { id: 'desarrollo', tipo: 'textoLargo', etiqueta: 'Desarrollo de la reunión' },
      ] },
      { titulo: 'Compromisos', campos: [
        { id: 'compromisos', tipo: 'tabla', etiqueta: 'Compromisos', columnas: [
          { id: 'compromiso', etiqueta: 'Compromiso', tipo: 'texto' }, { id: 'responsable', etiqueta: 'Responsable', tipo: 'texto' },
          { id: 'fecha', etiqueta: 'Fecha límite', tipo: 'fecha' }] },
      ] },
      { titulo: 'Asistentes', campos: [
        { id: 'asistentes', tipo: 'tabla', etiqueta: 'Asistentes', columnas: [
          { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto' }, { id: 'cargo', etiqueta: 'Cargo / rol', tipo: 'texto' }, { id: 'firma', etiqueta: 'Firma', tipo: 'firma' }] },
      ] },
    ],
  },
  {
    codigo: 'PESV-FOR-01', version: 1, modulo: 'pesv', estandar: 'PESV pasos 21-22 · 3.2.1', titulo: 'Reporte de incidente, accidente vial o condición insegura',
    descripcion: 'Reporte inicial desde el campo; la investigación se hace dentro de los 15 días siguientes.',
    secciones: [
      { titulo: 'Evento', campos: [
        { id: 'tipo', tipo: 'seleccion', etiqueta: 'Tipo de evento', opciones: ['Acto inseguro', 'Condición insegura', 'Incidente vial', 'Accidente de tránsito', 'Accidente de trabajo'], ancho: 2 },
        { id: 'fecha', tipo: 'fecha', etiqueta: 'Fecha', auto: 'fecha.iso', ancho: 1 }, { id: 'hora', tipo: 'hora', etiqueta: 'Hora', ancho: 1 },
        { id: 'placa', tipo: 'texto', etiqueta: 'Placa (si aplica)', ancho: 1 }, { id: 'conductor', tipo: 'texto', etiqueta: 'Persona involucrada', ancho: 2 },
        { id: 'lugar', tipo: 'texto', etiqueta: 'Lugar (vía, km, municipio)', ancho: 3 },
        { id: 'descripcion', tipo: 'textoLargo', etiqueta: 'Qué pasó', requerido: true },
        { id: 'lesionados', tipo: 'casilla', etiqueta: 'Hubo personas lesionadas' },
        { id: 'danos', tipo: 'casilla', etiqueta: 'Hubo daños a vehículos o a la carga' },
        { id: 'acciones', tipo: 'textoLargo', etiqueta: 'Acciones inmediatas tomadas' },
        { id: 'firma_reporta', tipo: 'firma', etiqueta: 'Firma de quien reporta', firmante: 'reporta' },
      ] },
    ],
  },
];

export const plantilla = (codigo) => PLANTILLAS.find(p => p.codigo === codigo) || null;

// Valida y limpia los datos de un registro contra su esquema (solo guarda los campos del formato)
export function limpiarDatos(p, datos = {}) {
  const res = {};
  for (const s of p.secciones) for (const c of s.campos) {
    const v = datos[c.id];
    if (v === undefined || v === null) continue;
    if (c.tipo === 'casilla') res[c.id] = !!v;
    else if (c.tipo === 'numero') res[c.id] = v === '' ? null : Number(v);
    else if (c.tipo === 'verificacion') res[c.id] = Object.fromEntries(c.items.filter(i => typeof v[i.codigo] === 'object' || typeof v[i.codigo] === 'string')
      .map(i => { const x = typeof v[i.codigo] === 'string' ? { resultado: v[i.codigo] } : v[i.codigo];
        return [i.codigo, { resultado: c.opciones.includes(x.resultado) ? x.resultado : '', observacion: String(x.observacion || '').slice(0, 300) }]; }));
    else if (c.tipo === 'tabla') res[c.id] = (Array.isArray(v) ? v : []).slice(0, 200).map(f => Object.fromEntries(c.columnas.map(col =>
      [col.id, col.tipo === 'numero' ? (f?.[col.id] === '' || f?.[col.id] == null ? null : Number(f[col.id])) : col.tipo === 'firma' ? firmaValida(f?.[col.id]) : String(f?.[col.id] ?? '').slice(0, 300)])));
    else if (c.tipo === 'firma') res[c.id] = firmaValida(v);
    else if (c.tipo === 'seleccion') res[c.id] = c.opciones.includes(v) ? v : '';
    else res[c.id] = String(v).slice(0, c.tipo === 'textoLargo' ? 4000 : 300);
  }
  return res;
}
// Firma = imagen PNG pequeña (trazo del dedo o del mouse)
export function firmaValida(v) {
  const s = typeof v === 'string' ? v : v?.imagen;
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s || '') && s.length < 200_000 ? s : '';
}
