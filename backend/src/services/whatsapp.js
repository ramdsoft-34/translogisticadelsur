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
import { enColombia, fmtFecha, soloDigitos, txt } from '../utils/texto.js';

const cop = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')} COP`;

export function saludo(fecha = new Date()) {
  const h = enColombia(fecha).getUTCHours();
  if (h < 12) return 'Buenos días';
  if (h < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

export function lineaViaje(v) {
  let l = `${txt(v.conductorNombre)}. ${txt(v.destino)}. Flete ${cop(v.flete)}. Anticipo ${cop(v.anticipo)}\nPlaca ${txt(v.placa)}`;
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
      totalFlete: g.viajes.reduce((a, v) => a + (Number(v.flete) || 0), 0),
      totalAnticipo: g.viajes.reduce((a, v) => a + (Number(v.anticipo) || 0), 0),
      enlace: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,
    };
  });
}
