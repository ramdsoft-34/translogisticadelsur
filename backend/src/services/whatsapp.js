// Reporte de vehículos por WhatsApp (macro GenerarReporteWhatsApp de la plantilla).
// Estructura del Excel, un mensaje por cliente con los viajes de la fecha aún no reportados:
//
//   {Saludo},
//
//   Reporte de vehiculos - dd/mm/aaaa
//
//   {Cliente}
//
//   {Conductor}. {Destino}. Flete {valor}. Anticipo {valor}
//   Placa {placa}
//   {Observaciones, si hay}
//
// Los valores se expresan en pesos colombianos: "$ 1.500.000 COP".
//
// Envío: se usa el enlace oficial "clic para chatear" de WhatsApp
// (https://wa.me/<número>?text=<mensaje>). No requiere credenciales ni API; el
// usuario elige el contacto o grupo y presiona Enviar, igual que con la macro.
// (La API de WhatsApp Business exige cuenta de Meta, plantillas aprobadas y
// tokens; no se implementa sin esas credenciales.)
import { enColombia, fmtFecha, normalizar, soloDigitos, txt } from '../utils/texto.js';

const cop = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')} COP`;

export function saludo(fecha = new Date()) {
  const h = enColombia(fecha).getUTCHours();
  if (h < 12) return 'Buenos días';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

// Si el destino escrito es el mismo nombre del conductor (o parte de él), no se repite.
export function destinoRepiteConductor(destino, conductor) {
  const d = normalizar(destino).split(' ').filter(Boolean);
  const c = new Set(normalizar(conductor).split(' ').filter(Boolean));
  return d.length > 0 && d.every(p => c.has(p));
}

// Estados en los que el viaje aún puede expedir remesa y manifiesto en el RNDC.
const PENDIENTE_RNDC = new Set(['registrado', 'remesa']);

export function lineaViaje(v) {
  const partes = [txt(v.conductorNombre)];
  if (txt(v.destino) && !destinoRepiteConductor(v.destino, v.conductorNombre)) partes.push(txt(v.destino));
  let l = `${partes.filter(Boolean).join('. ')}. Flete ${cop(v.flete)}. Anticipo ${cop(v.anticipo)}\nPlaca ${txt(v.placa)}`;
  if (txt(v.observaciones)) l += `\n${txt(v.observaciones)}`;
  return l;
}

// viajes: con cliente poblado y conductorNombre resuelto. Agrupa por cliente en el orden de aparición.
export function mensajesPorCliente(viajes, fecha, ahora = new Date()) {
  const grupos = new Map();
  for (const v of viajes) {
    const id = String(v.cliente?._id || v.cliente || 'sin-cliente');
    if (!grupos.has(id)) grupos.set(id, { cliente: v.cliente?.nombre || '(sin cliente)', whatsapp: soloDigitos(v.cliente?.whatsapp), viajes: [] });
    grupos.get(id).viajes.push(v);
  }
  return [...grupos.values()].map(g => {
    const texto = `${saludo(ahora)},\n\nReporte de vehículos - ${fmtFecha(fecha)}\n\n${g.cliente}\n\n${g.viajes.map(lineaViaje).join('\n\n')}\n`;
    const numero = g.whatsapp ? (g.whatsapp.length === 10 ? `57${g.whatsapp}` : g.whatsapp) : '';
    return {
      cliente: g.cliente, texto, viajes: g.viajes.map(v => v._id), cantidad: g.viajes.length,
      // Viajes del mensaje que todavía no tienen manifiesto (no depende de si ya se reportaron)
      pendientesRndc: g.viajes.filter(v => PENDIENTE_RNDC.has(v.estado) && !v.historico).map(v => v._id),
      totalFlete: g.viajes.reduce((a, v) => a + (Number(v.flete) || 0), 0),
      totalAnticipo: g.viajes.reduce((a, v) => a + (Number(v.anticipo) || 0), 0),
      enlace: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,
    };
  });
}
