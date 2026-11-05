// Fase 8: el checklist preoperacional que el conductor diligencia en Sur Track, como formato SST-FOR-06 de la empresa:
// con su membrete, código, versión y página; datos del viaje, SOAT, licencia y técnico-mecánica de la plataforma;
// resultado apto / no apto según los ítems críticos, y vigencia contra el día del viaje (no contra el día en que se descarga).
import { ETIQUETAS_CHECKLIST } from '../reportes/checklist.js';

// Si alguno de estos sale «no cumple», el vehículo no debe iniciar la jornada
export const CRITICOS_SURTRACK = ['licenciaConduccion', 'seguroSOAT', 'revisionTecnica', 'cinturonesPito', 'luces', 'direccion', 'frenosServicio', 'llantasEstado'];

const dd = (n) => String(n).padStart(2, '0');
// Día calendario en Colombia (UTC−5) de un instante
export function diaColombia(d) {
  if (!d) return '';
  const c = new Date(new Date(d).getTime() - 5 * 3600e3);
  return `${c.getUTCFullYear()}-${dd(c.getUTCMonth() + 1)}-${dd(c.getUTCDate())}`;
}
// Fechas de calendario guardadas a medianoche UTC (vencimientos, fecha del viaje): se toma el día tal cual
export const diaFecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export const horaColombia = (d) => { if (!d) return ''; const c = new Date(new Date(d).getTime() - 5 * 3600e3); return `${dd(c.getUTCHours())}:${dd(c.getUTCMinutes())}`; };

export function evaluarSurTrack(c = {}, fechaViaje = null) {
  const items = Object.entries(ETIQUETAS_CHECKLIST).flatMap(([g, def]) => Object.keys(def.items).map(k => ({ grupo: g, codigo: k, cumple: c[g]?.[k] === true })));
  const fallas = items.filter(i => !i.cumple).map(i => i.codigo);
  const fallasCriticas = fallas.filter(k => CRITICOS_SURTRACK.includes(k));
  const delDia = !!c.fecha && (fechaViaje ? diaColombia(c.fecha) === diaFecha(fechaViaje) : !!c.vigente);
  return { apto: !fallasCriticas.length, fallas, fallasCriticas, delDia };
}

// Esquema del formato (lo dibuja pdfFormato del motor de auto-llenado)
export function plantillaSurTrack() {
  const grupo = (g) => ({ titulo: ETIQUETAS_CHECKLIST[g].titulo, campos: [{ id: g, tipo: 'verificacion', etiqueta: 'Cumple / No cumple', opciones: ['cumple', 'no_cumple'],
    items: Object.entries(ETIQUETAS_CHECKLIST[g].items).map(([codigo, texto]) => ({ codigo, texto, critico: CRITICOS_SURTRACK.includes(codigo) })) }] });
  return {
    codigo: 'SST-FOR-06', version: 2, titulo: 'Checklist preoperacional diario (Sur Track)',
    secciones: [
      { titulo: 'Datos del viaje y del conductor', campos: [
        { id: 'placa', tipo: 'texto', etiqueta: 'Placa', ancho: 1 }, { id: 'conductor', tipo: 'texto', etiqueta: 'Conductor', ancho: 2 },
        { id: 'cedula', tipo: 'texto', etiqueta: 'Cédula', ancho: 1 },
        { id: 'viaje', tipo: 'texto', etiqueta: 'Viaje', ancho: 1 }, { id: 'fechaViaje', tipo: 'texto', etiqueta: 'Fecha del viaje', ancho: 1 },
        { id: 'ruta', tipo: 'texto', etiqueta: 'Cliente / destino', ancho: 2 },
        { id: 'diligenciado', tipo: 'texto', etiqueta: 'Diligenciado en Sur Track', ancho: 2 }, { id: 'km', tipo: 'texto', etiqueta: 'Kilometraje', ancho: 1 },
        { id: 'ubicacion', tipo: 'texto', etiqueta: 'Ubicación al firmar', ancho: 1 },
      ] },
      { titulo: 'Documentos registrados en la plataforma', campos: [
        { id: 'licencia', tipo: 'texto', etiqueta: 'Licencia (categoría y vence)', ancho: 2 }, { id: 'soat', tipo: 'texto', etiqueta: 'SOAT vence', ancho: 1 },
        { id: 'rtm', tipo: 'texto', etiqueta: 'Técnico-mecánica vence', ancho: 1 },
        { id: 'rtmDeclarada', tipo: 'texto', etiqueta: 'Técnico-mecánica declarada por el conductor', ancho: 2 }, { id: 'coincide', tipo: 'texto', etiqueta: 'Coincide', ancho: 2 },
      ] },
      grupo('documentos'), grupo('equipos'), grupo('vehiculo'),
      { titulo: 'Resultado', campos: [
        { id: 'resultado', tipo: 'texto', etiqueta: 'Resultado', ancho: 2 }, { id: 'vigencia', tipo: 'texto', etiqueta: 'Vigencia', ancho: 2 },
        { id: 'novedades', tipo: 'textoLargo', etiqueta: 'Ítems que no cumplen y acción tomada' },
        { id: 'revisado', tipo: 'texto', etiqueta: 'Revisado por (empresa)', ancho: 2 }, { id: 'fechaRevision', tipo: 'texto', etiqueta: 'Fecha de revisión', ancho: 2 },
        { id: 'firma_conductor', tipo: 'firma', etiqueta: 'Firma del conductor', firmante: 'conductor' },
      ] },
    ],
  };
}

const nombreTercero = (t) => (t ? [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ') : '');

// Datos del formato a partir del viaje, el checklist de Sur Track y lo que la plataforma ya sabe del vehículo y del conductor
export function datosSurTrack({ viaje = {}, conductor = null, vehiculo = null, checklist: c = {} }) {
  const ev = evaluarSurTrack(c, viaje.fecha);
  const etiqueta = (k) => Object.values(ETIQUETAS_CHECKLIST).map(d => d.items[k]).find(Boolean) || k;
  const verif = (g) => Object.fromEntries(Object.keys(ETIQUETAS_CHECKLIST[g].items).map(k => [k, { resultado: c[g]?.[k] === true ? 'cumple' : 'no_cumple', observacion: '' }]));
  const rtm = diaFecha(vehiculo?.venceTecnomecanica); const rtmDecl = diaFecha(c.venceRevisionTecnica);
  const lic = conductor?.licencia || {};
  const ub = c.ubicacion || c.firma?.ubicacion || (c.lat != null ? { lat: c.lat, lng: c.lng } : null);
  const firma = String(c.firma?.imagenBase64 || '').replace(/\s/g, '');
  return {
    placa: viaje.placa || '', conductor: c.firma?.nombre || nombreTercero(conductor) || viaje.conductor || '', cedula: c.firma?.cedula || conductor?.numId || '',
    viaje: viaje.numero ? `N.° ${viaje.numero}` : '', fechaViaje: dmy(diaFecha(viaje.fecha)),
    ruta: [viaje.cliente, viaje.destino].filter(Boolean).join(' · '),
    diligenciado: c.fecha ? `${dmy(diaColombia(c.fecha))} ${horaColombia(c.fecha)}` : '',
    km: viaje.km != null ? `${Math.round(viaje.km).toLocaleString('es-CO')} km` : (vehiculo?.sst?.kmActual != null ? `${vehiculo.sst.kmActual.toLocaleString('es-CO')} km` : 'Sin dato'),
    ubicacion: ub?.lat != null ? `${Number(ub.lat).toFixed(5)}, ${Number(ub.lng).toFixed(5)}` : 'Sin dato de Sur Track',
    licencia: lic.vence ? `${lic.categoria || ''} · vence ${dmy(diaFecha(lic.vence))}`.trim() : 'Sin dato',
    soat: dmy(diaFecha(vehiculo?.soat?.vence)) || 'Sin dato', rtm: dmy(rtm) || 'Sin dato', rtmDeclarada: dmy(rtmDecl) || 'Sin dato',
    coincide: !rtm || !rtmDecl ? 'No se puede comparar' : rtm === rtmDecl ? 'Sí' : 'No: revisar con el conductor',
    documentos: verif('documentos'), equipos: verif('equipos'), vehiculo: verif('vehiculo'),
    resultado: ev.apto ? 'APTO para iniciar la jornada' : 'NO APTO: requiere atención antes de salir',
    vigencia: !c.completo && c.completo !== undefined ? 'Incompleto' : ev.delDia ? 'Del día del viaje' : 'No es del día del viaje',
    novedades: ev.fallas.length ? ev.fallas.map(k => `${etiqueta(k)}${CRITICOS_SURTRACK.includes(k) ? ' (crítico)' : ''}`).join(', ') : 'Ninguno',
    revisado: '', fechaRevision: '',
    firma_conductor: firma ? (firma.startsWith('data:') ? firma : `data:image/png;base64,${firma}`) : '',
    _evaluacion: ev,
  };
}

// Nombre del archivo con el día en Colombia (no en hora internacional)
export const nombreChecklist = (placa, fecha) => `checklist_${placa}_${diaColombia(fecha)}.pdf`;
