// Formatos de la plataforma (SG-SST y PESV). Cada uno se ve en blanco, se diligencia, se guarda como
// borrador o como versión final y sale en PDF con el membrete. Los campos «auto» se llenan con los
// datos de la empresa. Las referencias normativas no se muestran hasta que el responsable las valide.
import { listarPagina, pagina, recortar } from '../../utils/paginacion.js';
import mongoose from 'mongoose';
import { SstFormato } from '../../models/sst.js';
import { siguiente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { diaColombia } from './comun.js';

const C = (clave, etiqueta, tipo = 'texto', extra = {}) => ({ clave, etiqueta, tipo, ...extra });
const items = (lista) => lista.map((texto, i) => ({ clave: `i${i + 1}`, texto }));

export const FORMATOS = [
  {
    codigo: 'SST-FOR-06', titulo: 'Checklist preoperacional diario de vehículos', alcance: 'PESV',
    descripcion: 'Lo diligencia el conductor en la app antes de cada jornada. Un ítem crítico en «Mal» deja el vehículo No apto.',
    soloApp: true,
  },
  {
    codigo: 'SST-FOR-01', titulo: 'Inspección de vehículos de carga y EPP', alcance: 'SG-SST y PESV',
    descripcion: 'Inspección mensual a cargo de la empresa, complementaria al checklist diario.',
    secciones: [
      { tipo: 'campos', titulo: 'Datos de la inspección', campos: [
        C('placa', 'Placa del vehículo', 'placa', { requerido: true }), C('conductor', 'Conductor'), C('fecha', 'Fecha', 'fecha', { auto: 'hoy', requerido: true }),
        C('kilometraje', 'Kilometraje', 'numero'), C('propietario', 'Propietario o contratista'), C('inspector', 'Inspector', 'texto', { auto: 'sst.responsable' }),
      ] },
      { tipo: 'items', titulo: 'Ítems a verificar', items: items([
        'SOAT vigente', 'Revisión técnico-mecánica y de gases vigente', 'Licencia de tránsito y tarjeta de propiedad al día', 'Licencia de conducción vigente y categoría acorde',
        'Afiliación vigente a ARL del conductor', 'Extintor cargado, vigente y asegurado', 'Botiquín completo', 'Equipo de carretera (gato, cruceta, conos, tacos, señales)',
        'Llantas en buen estado (incluida la de repuesto)', 'Luces delanteras, traseras, direccionales y de freno', 'Frenos de servicio y de parqueo', 'Espejos retrovisores',
        'Cinturones de seguridad', 'Pito', 'Limpiaparabrisas', 'Carpas, amarres y sujeción de la carga', 'Casco', 'Botas de seguridad', 'Chaleco reflectivo', 'Guantes', 'Gafas de seguridad',
      ]) },
      { tipo: 'texto', clave: 'observaciones', titulo: 'Observaciones y acciones' },
      { tipo: 'firmas', firmas: [C('inspector', 'Firma del inspector'), C('conductor', 'Firma del conductor')] },
    ],
  },
  {
    codigo: 'SST-FOR-02', titulo: 'Entrega y reposición de elementos de protección personal (EPP)', alcance: 'SG-SST',
    descripcion: 'Cada fila con la firma de quien recibe. Las entregas del perfil del colaborador salen en este formato.',
    secciones: [
      { tipo: 'campos', titulo: 'Trabajador', campos: [C('trabajador', 'Nombre', 'texto', { requerido: true }), C('documento', 'Documento'), C('cargo', 'Cargo'), C('fecha', 'Fecha', 'fecha', { auto: 'hoy' })] },
      { tipo: 'tabla', clave: 'elementos', titulo: 'Elementos entregados', firma: true, columnas: [C('elemento', 'Elemento'), C('cantidad', 'Cantidad', 'numero'), C('motivo', 'Motivo', 'seleccion', { opciones: ['Entrega', 'Reposición'] }), C('fecha', 'Fecha', 'fecha')] },
      { tipo: 'texto', clave: 'compromiso', titulo: 'Compromiso', valorInicial: 'Recibo los elementos en buen estado, me comprometo a usarlos durante la jornada, cuidarlos e informar cuando requieran reposición.' },
    ],
  },
  {
    codigo: 'SST-FOR-07', titulo: 'Registro de asistencia a capacitaciones', alcance: 'SG-SST y PESV',
    descripcion: 'Evidencia de la ejecución del programa anual. Las capacitaciones del programa salen en este formato con sus firmas.',
    secciones: [
      { tipo: 'campos', titulo: 'Capacitación', campos: [C('tema', 'Tema', 'texto', { requerido: true }), C('fecha', 'Fecha', 'fecha', { auto: 'hoy' }), C('horas', 'Horas', 'numero'),
        C('facilitador', 'Facilitador'), C('lugar', 'Lugar'), C('eje', 'Eje', 'seleccion', { opciones: ['SST', 'Seguridad vial', 'SST y seguridad vial'] })] },
      { tipo: 'tabla', clave: 'asistentes', titulo: 'Asistentes', firma: true, columnas: [C('nombre', 'Nombre'), C('documento', 'Documento'), C('cargo', 'Cargo')] },
    ],
  },
  {
    codigo: 'SST-FOR-03', titulo: 'Acta de simulacro de emergencia', alcance: 'SG-SST',
    descripcion: 'Registro del simulacro del plan de emergencias.',
    secciones: [
      { tipo: 'campos', titulo: 'Datos del simulacro', campos: [C('fecha', 'Fecha', 'fecha', { auto: 'hoy', requerido: true }), C('horaInicio', 'Hora de inicio', 'hora'), C('horaFin', 'Hora de fin', 'hora'),
        C('emergencia', 'Tipo de emergencia', 'seleccion', { opciones: ['Sismo', 'Incendio', 'Evacuación', 'Accidente vial', 'Derrame', 'Otra'] }), C('lugar', 'Lugar'),
        C('participantes', 'Número de participantes', 'numero'), C('coordinador', 'Coordinador', 'texto', { auto: 'sst.responsable' })] },
      { tipo: 'items', titulo: 'Evaluación', items: items(['Se activó la alarma', 'La evacuación fue ordenada', 'Se llegó al punto de encuentro', 'La brigada actuó según el plan', 'Se hizo el conteo de personas', 'Se cumplió el tiempo esperado']) },
      { tipo: 'texto', clave: 'desarrollo', titulo: 'Desarrollo y tiempos de respuesta' },
      { tipo: 'texto', clave: 'fortalezas', titulo: 'Fortalezas' },
      { tipo: 'texto', clave: 'mejoras', titulo: 'Oportunidades de mejora' },
      { tipo: 'tabla', clave: 'compromisos', titulo: 'Compromisos', columnas: [C('compromiso', 'Compromiso'), C('responsable', 'Responsable'), C('fecha', 'Fecha límite', 'fecha')] },
      { tipo: 'firmas', firmas: [C('coordinador', 'Firma del coordinador')] },
    ],
  },
  {
    codigo: 'SST-ACT-01', titulo: 'Acta de reunión (Vigía, COPASST, Comité de Convivencia o Comité de Seguridad Vial)', alcance: 'SG-SST y PESV',
    descripcion: 'Acta general de reunión con asistentes, temas y compromisos.',
    secciones: [
      { tipo: 'campos', titulo: 'Reunión', campos: [C('instancia', 'Instancia', 'seleccion', { requerido: true, opciones: ['Vigía de SST', 'COPASST', 'Comité de Convivencia Laboral', 'Comité de Seguridad Vial', 'Otra'] }),
        C('fecha', 'Fecha', 'fecha', { auto: 'hoy', requerido: true }), C('hora', 'Hora', 'hora'), C('lugar', 'Lugar'), C('numeroActa', 'Acta n.º')] },
      { tipo: 'tabla', clave: 'asistentes', titulo: 'Asistentes', firma: true, columnas: [C('nombre', 'Nombre'), C('cargo', 'Cargo')] },
      { tipo: 'texto', clave: 'orden', titulo: 'Orden del día' },
      { tipo: 'texto', clave: 'desarrollo', titulo: 'Desarrollo' },
      { tipo: 'tabla', clave: 'compromisos', titulo: 'Compromisos', columnas: [C('compromiso', 'Compromiso'), C('responsable', 'Responsable'), C('fecha', 'Fecha límite', 'fecha')] },
    ],
  },
  {
    codigo: 'PESV-FOR-01', titulo: 'Reporte de incidente, accidente vial o condición insegura', alcance: 'PESV',
    descripcion: 'Reporte inicial desde el campo (también desde la app del conductor). La investigación se hace después.',
    secciones: [
      { tipo: 'campos', titulo: 'Lo que pasó', campos: [
        C('tipo', 'Tipo', 'seleccion', { requerido: true, opciones: ['Incidente', 'Accidente vial', 'Condición insegura'] }), C('fecha', 'Fecha', 'fecha', { requerido: true }), C('hora', 'Hora', 'hora'),
        C('lugar', 'Lugar'), C('placa', 'Placa', 'placa'), C('conductor', 'Conductor o quien reporta'), C('lesionados', '¿Hubo personas lesionadas?', 'seleccion', { opciones: ['No', 'Sí'] }),
        C('cuantos', 'Cuántas personas', 'numero'),
      ] },
      { tipo: 'texto', clave: 'descripcion', titulo: 'Descripción', requerido: true },
      { tipo: 'texto', clave: 'danos', titulo: 'Daños al vehículo, la carga o terceros' },
      { tipo: 'texto', clave: 'acciones', titulo: 'Acciones inmediatas' },
      { tipo: 'nota', texto: 'Este es el reporte inicial. La investigación del evento se hace después y queda en su propio registro.' },
    ],
  },
];

export const formatoDe = (codigo) => {
  const f = FORMATOS.find((x) => x.codigo === codigo);
  if (!f) throw new ErrorHttp(404, 'Formato no encontrado');
  return f;
};

export const catalogo = () => FORMATOS.map(({ secciones, ...f }) => ({ ...f, editable: !f.soloApp }));

/** Valores «auto» con los datos de la empresa. */
export function autoValores(f, d) {
  const v = { hoy: diaColombia(new Date()), 'sst.responsable': d.responsables.responsableSst, 'pesv.lider': d.responsables.liderPesv };
  const datos = {};
  for (const s of f.secciones || []) {
    if (s.tipo === 'campos') for (const c of s.campos) if (c.auto && v[c.auto]) datos[c.clave] = v[c.auto];
    if (s.tipo === 'texto' && s.valorInicial) datos[s.clave] = s.valorInicial;
  }
  return datos;
}

const presentar = (x) => ({
  id: String(x._id), codigo: x.codigo, consecutivo: x.consecutivo, numero: `${x.codigo}-${String(x.consecutivo).padStart(4, '0')}`, titulo: x.titulo,
  estado: x.estado, datos: x.datos || {}, items: x.items || [], filas: x.filas || [], version: x.version, versiones: x.versiones || [],
  origen: x.origen, referencia: x.referencia, autorNombre: x.autorNombre, creado: x.createdAt, actualizado: x.updatedAt,
  firmados: Object.keys(x.firmas || {}),
});

export async function listarDiligenciados(empresaId, { codigo = '', q = '' } = {}) {
  const f = { empresa: empresaId, ...(codigo ? { codigo } : {}) };
  let l = (await SstFormato.find(f).sort({ updatedAt: -1 }).limit(500).lean()).map(presentar);
  if (q) { const t = q.toLowerCase(); l = l.filter((x) => x.numero.toLowerCase().includes(t) || JSON.stringify(x.datos).toLowerCase().includes(t)); }
  return l;
}

/**
 * Página de formatos diligenciados. Sin texto la página sale de la base (con cursor y total solo en la primera);
 * con texto se busca en el número y en los datos escritos del formato (hasta 2.000 recientes) y se envía solo la página.
 */
export async function paginaDiligenciados(empresaId, { codigo = '', q = '' } = {}, p) {
  const f = { empresa: empresaId, ...(codigo ? { codigo } : {}) };
  if (!q) {
    const { items, total } = await listarPagina(SstFormato, f, p, { orden: { updatedAt: -1 } });
    return pagina(items.map(presentar), total, p);
  }
  const t = q.toLowerCase();
  const l = (await SstFormato.find(f).sort({ updatedAt: -1, _id: -1 }).limit(2000).lean()).map(presentar)
    .filter((x) => x.numero.toLowerCase().includes(t) || JSON.stringify(x.datos).toLowerCase().includes(t));
  return pagina(recortar(l, p), l.length, p);
}

async function cargar(empresaId, id, { conFirmas = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new ErrorHttp(400, 'Identificador inválido');
  const q = SstFormato.findOne({ empresa: empresaId, _id: id });
  if (conFirmas) q.select('+firmas');
  const x = await q;
  if (!x) throw new ErrorHttp(404, 'Formato diligenciado no encontrado');
  return x;
}

export async function obtener(empresaId, id, { conFirmas = false } = {}) {
  // Las firmas siempre se leen para saber cuáles hay; las imágenes solo salen si se piden (PDF)
  const x = await cargar(empresaId, id, { conFirmas: true });
  return { ...presentar(x.toObject()), ...(conFirmas ? { firmas: x.firmas || {} } : {}) };
}

/** Revisa lo obligatorio solo al guardar como final (el borrador puede quedar incompleto). */
export function validar(f, d) {
  const faltan = [];
  for (const s of f.secciones || []) {
    if (s.tipo === 'campos') for (const c of s.campos) if (c.requerido && !String(d.datos?.[c.clave] ?? '').trim()) faltan.push(c.etiqueta);
    if (s.tipo === 'texto' && s.requerido && !String(d.datos?.[s.clave] ?? '').trim()) faltan.push(s.titulo);
    if (s.tipo === 'items') {
      const sin = s.items.filter((i) => !d.items?.find((x) => x.clave === i.clave)?.valor).length;
      if (sin) faltan.push(`${sin} ítem(s) sin calificar`);
      const nc = s.items.filter((i) => d.items?.find((x) => x.clave === i.clave)?.valor === 'no_cumple' && !d.items.find((x) => x.clave === i.clave).observacion).length;
      if (nc) faltan.push(`observación en ${nc} ítem(s) que no cumplen`);
    }
  }
  if (faltan.length) throw new ErrorHttp(400, `Falta: ${faltan.join(', ')}`);
}

/** Normaliza lo que manda la web contra la definición (no se guardan claves inventadas). */
export function limpiar(f, d) {
  const datos = {}; const tablas = {};
  const corto = (v, n = 300) => String(v ?? '').slice(0, n);
  for (const s of f.secciones || []) {
    if (s.tipo === 'campos') for (const c of s.campos) datos[c.clave] = corto(d.datos?.[c.clave], 160);
    if (s.tipo === 'texto') datos[s.clave] = corto(d.datos?.[s.clave], 4000);
    if (s.tipo === 'tabla') {
      tablas[s.clave] = (Array.isArray(d.tablas?.[s.clave]) ? d.tablas[s.clave] : []).slice(0, 60)
        .map((fila) => Object.fromEntries(s.columnas.map((c) => [c.clave, corto(fila?.[c.clave], 160)])))
        .filter((fila) => Object.values(fila).some((v) => v.trim()));
    }
  }
  const claves = new Set((f.secciones || []).filter((s) => s.tipo === 'items').flatMap((s) => s.items.map((i) => i.clave)));
  const textos = Object.fromEntries((f.secciones || []).filter((s) => s.tipo === 'items').flatMap((s) => s.items.map((i) => [i.clave, i.texto])));
  const it = (d.items || []).filter((x) => claves.has(x.clave))
    .map((x) => ({ clave: x.clave, texto: textos[x.clave], valor: ['cumple', 'no_cumple', 'na'].includes(x.valor) ? x.valor : '', observacion: corto(x.observacion, 300) }));
  return { datos: { ...datos, tablas }, items: it };
}

export async function guardar(empresaId, codigo, d, { id = null, final = false, usuario, origen = 'web', referencia = '' }) {
  const f = formatoDe(codigo);
  if (f.soloApp) throw new ErrorHttp(409, 'Este formato lo diligencia el conductor en la app');
  const limpio = limpiar(f, d);
  if (final) validar(f, { ...limpio, datos: limpio.datos });
  const firmas = Object.fromEntries(Object.entries(d.firmas || {}).filter(([, v]) => typeof v === 'string' && /^data:image\/png;base64,/.test(v) && v.length < 400_000));
  const x = id ? await cargar(empresaId, id, { conFirmas: true }) : new SstFormato({ empresa: empresaId, codigo, consecutivo: await siguiente(empresaId, `sst:${codigo}`),
    titulo: f.titulo, autor: usuario._id, autorNombre: usuario.nombre || usuario.email, origen, referencia });
  if (x.codigo !== codigo) throw new ErrorHttp(400, 'El formato no corresponde');
  x.datos = limpio.datos; x.items = limpio.items; x.firmas = { ...(x.firmas || {}), ...firmas }; x.markModified('datos'); x.markModified('firmas');
  x.actualizadoPor = usuario._id;
  if (final) {
    // Cada guardado final es una versión nueva (la anterior queda en el historial)
    if (x.estado === 'final') x.version += 1;
    x.estado = 'final';
    x.versiones.push({ version: x.version, guardadoEn: new Date(), guardadoPor: usuario.nombre || usuario.email });
  }
  await x.save();
  return obtener(empresaId, x._id);
}

export async function eliminarBorrador(empresaId, id) {
  const x = await cargar(empresaId, id);
  if (x.estado !== 'borrador') throw new ErrorHttp(409, 'Un formato guardado como final no se borra: es evidencia');
  await x.deleteOne();
}
