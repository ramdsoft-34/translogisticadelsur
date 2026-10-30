// Reporte de vehículos por WhatsApp (macro GenerarReporteWhatsApp de la plantilla).
// Un mensaje por cliente con los viajes de la fecha. El texto sale de una
// plantilla editable por la empresa; la predeterminada reproduce el Excel:
//
//   {saludo},
//
//   Reporte de vehículos - {fecha}
//
//   {cliente}
//
//   {conductor}. {destino}. Flete {flete}. Anticipo {anticipo}
//   Placa {placa}
//   Licencia {licencia}            (solo si se guardó con el viaje)
//   Auxiliar {auxiliar}            (solo si el viaje lleva auxiliar; con «Unificar auxiliar»: «de N día(s) Unificado»)
//   {observaciones}
//
// Reglas de formato:
// - Los valores se expresan en pesos: "$ 1.500.000".
// - El conductor va con el primer nombre y los dos apellidos, con mayúscula inicial: "Wilson Montero Rivera".
// - Una línea de la plantilla cuyos datos quedan todos vacíos no se escribe
//   (p. ej. «{observaciones}» o «Remolque {remolque}» sin remolque).
// - Si el destino escrito es el nombre del conductor, no se repite.
//
// Envío: se usa el enlace oficial "clic para chatear" de WhatsApp
// (https://wa.me/<número>?text=<mensaje>). No requiere credenciales ni API; el
// usuario elige el contacto o grupo y presiona Enviar, igual que con la macro.
// (La API de WhatsApp Business exige cuenta de Meta, plantillas aprobadas y
// tokens; no se implementa sin esas credenciales.)
import { enColombia, fmtFecha, normalizar, soloDigitos, txt } from '../utils/texto.js';

export const cop = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

const capital = (p) => (p ? p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es') : '');
// Primer nombre y los dos apellidos del conductor. Con el tercero registrado se usan sus campos; si solo
// se tiene el nombre completo: con 4 o más palabras, la 1.ª y las dos últimas; con menos, todas.
export function nombreCorto(conductor, nombreCompleto = '') {
  const primera = (s) => txt(s).split(/\s+/)[0] || '';
  let partes;
  if (txt(conductor?.nombres) && txt(conductor?.apellido1)) partes = [primera(conductor.nombres), txt(conductor.apellido1), txt(conductor.apellido2)];
  else {
    const p = txt(nombreCompleto || [conductor?.nombres, conductor?.apellido1, conductor?.apellido2].filter(Boolean).join(' ')).split(/\s+/).filter(Boolean);
    partes = p.length >= 4 ? [p[0], ...p.slice(-2)] : p;
  }
  return partes.join(' ').split(/\s+/).filter(Boolean).map(capital).join(' ');
}

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

// Datos disponibles en las plantillas (nombre → descripción). El orden es el de la ayuda en pantalla.
export const MARCADORES = {
  mensaje: {
    saludo: 'Buenos días / tardes / noches', fecha: 'Fecha del reporte', cliente: 'Nombre del cliente',
    cantidad: 'Número de vehículos', total_flete: 'Suma de fletes', total_anticipo: 'Suma de anticipos', total_saldo: 'Suma de saldos',
  },
  viaje: {
    numero: 'N° del viaje', conductor: 'Nombre del conductor', cedula: 'Cédula del conductor', celular: 'Celular del conductor',
    destino: 'Destino', placa: 'Placa', remolque: 'Remolque', peso: 'Peso (kg)', flete: 'Flete (con el auxiliar si se unifica)', auxiliar: 'Auxiliar («Unificado» si se unifica)',
    anticipo: 'Anticipo (con el auxiliar si se unifica)', saldo: 'Saldo',
    licencia: 'Licencia del conductor (si se guardó con el viaje)', remesa: 'N° de remesa', manifiesto: 'N° de manifiesto', observaciones: 'Observaciones',
  },
};

// Plantilla de la plataforma (igual a la macro del Excel).
export const PLANTILLA_BASE = Object.freeze({
  nombre: 'Formato de la plantilla de Excel',
  encabezado: '{saludo},\n\nReporte de vehículos - {fecha}\n\n{cliente}',
  linea: '{conductor}. {destino}. Flete {flete}. Anticipo {anticipo}\nPlaca {placa}\nLicencia {licencia}\nAuxiliar {auxiliar}\n{observaciones}',
  separador: 'blanco',
  pie: '',
});
const SEPARADORES = { blanco: '\n\n', linea: '\n', guiones: '\n----------\n' };

const kg = (n) => (Number(n) ? `${Math.round(Number(n)).toLocaleString('es-CO')} kg` : '');

// «Unificar auxiliar» (solo para el mensaje; los valores del viaje no cambian): el auxiliar se suma al flete y
// al anticipo (si el viaje lleva anticipo) y en su línea se escribe «de N día(s) Unificado».
// Ej.: flete 100.000, anticipo 100.000 y auxiliar 50.000 → Flete 150.000. Anticipo 150.000. Auxiliar de 1 día Unificado
const auxDe = (v, unificar) => (unificar ? Number(v.auxiliar) || 0 : 0);
const fleteDe = (v, unificar) => (Number(v.flete) || 0) + auxDe(v, unificar);
const anticipoDe = (v, unificar) => (Number(v.anticipo) || 0) + (Number(v.anticipo) > 0 ? auxDe(v, unificar) : 0);
const dias = (v) => { const n = Number(v.diasAuxiliar) || 1; return `de ${n} día${n === 1 ? '' : 's'}`; };
function datosViaje(v, { unificarAuxiliar = false } = {}) {
  const flete = fleteDe(v, unificarAuxiliar); const anticipo = anticipoDe(v, unificarAuxiliar);
  const conAux = Number(v.auxiliar) > 0;
  return {
    auxiliar: !conAux ? '' : unificarAuxiliar ? `${dias(v)} Unificado` : cop(v.auxiliar),
    numero: txt(v.numero), conductor: nombreCorto(v.conductor, v.conductorNombre), cedula: txt(v.conductor?.numId), celular: txt(v.conductor?.celular),
    destino: destinoRepiteConductor(v.destino, v.conductorNombre) ? '' : txt(v.destino),
    placa: txt(v.placa), remolque: txt(v.remolque), peso: kg(v.pesoKg),
    flete: cop(flete), anticipo: cop(anticipo), saldo: cop(flete - anticipo),
    licencia: txt(v.licencia), remesa: txt(v.remesa?.numero), manifiesto: txt(v.manifiesto?.numero), observaciones: txt(v.observaciones),
  };
}

// Reemplaza los marcadores línea por línea; descarta las líneas cuyos datos están todos vacíos.
export function aplicarPlantilla(texto, datos) {
  const salida = [];
  for (const linea of String(texto ?? '').split('\n')) {
    const marcas = [...linea.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => k in datos);
    if (marcas.length && marcas.every(k => txt(datos[k]) === '')) continue;
    const l = linea.replace(/\{([a-z_]+)\}/g, (m, k) => (k in datos ? txt(datos[k]) : m))
      .replace(/\.\s+\./g, '.')            // «Juan. . Flete» cuando falta un dato intermedio
      .replace(/^\s*[.,;:]\s*/, '')        // separador sobrante al inicio
      .replace(/[ \t]+$/, '');
    salida.push(l);
  }
  return salida.join('\n');
}

// viajes: con cliente y conductor poblados. Agrupa por cliente en el orden de aparición.
export function mensajesPorCliente(viajes, fecha, ahora = new Date(), plantilla = PLANTILLA_BASE, opciones = {}) {
  const p = { ...PLANTILLA_BASE, ...(plantilla || {}) };
  const grupos = new Map();
  for (const v of viajes) {
    const id = String(v.cliente?._id || v.cliente || 'sin-cliente');
    if (!grupos.has(id)) grupos.set(id, { cliente: v.cliente?.nombre || '(sin cliente)', whatsapp: soloDigitos(v.cliente?.whatsapp), viajes: [] });
    grupos.get(id).viajes.push(v);
  }
  return [...grupos.values()].map(g => {
    const totalFlete = g.viajes.reduce((a, v) => a + fleteDe(v, opciones.unificarAuxiliar), 0);
    const totalAnticipo = g.viajes.reduce((a, v) => a + anticipoDe(v, opciones.unificarAuxiliar), 0);
    const general = {
      saludo: saludo(ahora), fecha: fmtFecha(fecha), cliente: g.cliente, cantidad: String(g.viajes.length),
      total_flete: cop(totalFlete), total_anticipo: cop(totalAnticipo), total_saldo: cop(totalFlete - totalAnticipo),
    };
    const lineas = g.viajes.map(v => aplicarPlantilla(p.linea, { ...general, ...datosViaje(v, opciones) })).filter(Boolean);
    const partes = [aplicarPlantilla(p.encabezado, general), lineas.join(SEPARADORES[p.separador] || SEPARADORES.blanco), aplicarPlantilla(p.pie, general)];
    const texto = `${partes.filter(x => x.trim()).join('\n\n')}\n`;
    const numero = g.whatsapp ? (g.whatsapp.length === 10 ? `57${g.whatsapp}` : g.whatsapp) : '';
    return {
      cliente: g.cliente, texto, viajes: g.viajes.map(v => v._id), cantidad: g.viajes.length, totalFlete, totalAnticipo,
      enlace: `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,
    };
  });
}
