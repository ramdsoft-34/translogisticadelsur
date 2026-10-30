// Reglas de negocio de viajes y liquidación de fletes (tomadas de las fórmulas
// de la plantilla de Excel y generalizadas para cualquier empresa).

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

// SALDO = flete - anticipo (solo si hay flete)
export function saldoViaje(v) {
  const flete = num(v.flete);
  return flete > 0 ? flete - num(v.anticipo) : 0;
}

// UTILIDAD = tarifa - 1 % de la tarifa - flete (columna de las hojas por empresa)
export function utilidadViaje(v, pctRetencion = 1) {
  const tarifa = num(v.tarifa);
  return tarifa - tarifa * (pctRetencion / 100) - num(v.flete);
}

export const retencionFuente = (flete, pct = 1) => Math.round(num(flete) * (num(pct) / 100));

// Valores sugeridos al escoger cliente y destino (tarifa).
export function valoresDesdeTarifa(tarifa) {
  if (!tarifa) return {};
  return {
    tarifa: num(tarifa.tarifaCliente),
    flete: num(tarifa.fleteConductor),
    anticipo: num(tarifa.anticipoHabitual),
    pesoKg: num(tarifa.pesoKg),
    codDestino: tarifa.codMunicipio || '',
    destinatario: tarifa.destinatario || {},
  };
}

// Viajes marcados «[NO FACTURAR]» en las observaciones no se cobran al cliente
export const NO_FACTURAR = /\[\s*NO\s+FACTURAR\s*\]/i;
export const noFacturar = (v) => NO_FACTURAR.test(String(v?.observaciones || ''));

// Tarifa de auxiliar de respaldo por cliente: la primera de sus destinos que tenga auxiliar
// (se usa cuando el destino del viaje no tiene tarifa de auxiliar).
export function respaldosAuxiliar(tarifas) {
  const m = new Map();
  const orden = [...tarifas].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a._id).localeCompare(String(b._id)));
  for (const t of orden) {
    const k = String(t.cliente?._id || t.cliente);
    if (!m.has(k) && (num(t.tarifaAuxiliar) > 0 || num(t.auxiliarPagado) > 0)) m.set(k, t);
  }
  return m;
}

// Línea de la liquidación de fletes (fórmulas de la hoja RELACION).
//   - tarifa por viaje: se cobra una vez por fila; por unidad: × cantidad
//   - el auxiliar se paga por los días indicados (1 a 5; sin días, uno por unidad); sin tarifa de auxiliar
//     en el destino se usa la primera tarifa de auxiliar del cliente (`respaldo`)
//   - lo que se cobra de auxiliar depende de la política del cliente (RN-15)
export function lineaLiquidacion(viaje, tarifa, { respaldo = null, cliente = null } = {}) {
  const cantidad = num(viaje.cantidad) || 1;
  const porUnidad = tarifa?.tipoCobro === 'unidad';
  const tarifaUnit = tarifa ? num(tarifa.tarifaCliente) : num(viaje.tarifa);
  const fleteUnit = tarifa ? num(tarifa.fleteConductor) : num(viaje.flete);
  const aux = viaje.conAuxiliar;
  const valorAux = (k) => (num(tarifa?.[k]) > 0 ? num(tarifa[k]) : num(respaldo?.[k]));
  const auxCobro = aux ? valorAux('tarifaAuxiliar') : 0;
  const auxPago = aux ? valorAux('auxiliarPagado') : 0;
  const politica = cliente?.politicaAuxiliar || 'registrado';

  const totalTarifa = porUnidad ? tarifaUnit * cantidad : tarifaUnit;
  const unidadesAux = num(viaje.diasAuxiliar) > 0 ? num(viaje.diasAuxiliar) : cantidad;
  let totalAuxiliar = auxCobro * unidadesAux;
  if (politica === 'sin' || politica === 'incluido') totalAuxiliar = 0;
  if (politica === 'sin_anticipo') totalAuxiliar = num(viaje.anticipo) > 0 ? 0 : num(cliente?.valorAuxiliarSinAnticipo ?? 30000);
  const totalCobrado = totalTarifa + totalAuxiliar;
  const totalFlete = porUnidad ? fleteUnit * cantidad : fleteUnit;
  const totalAuxiliarPagado = auxPago * unidadesAux;
  const utilidad = totalCobrado - (totalFlete + totalAuxiliarPagado);
  return {
    viaje: viaje._id, numero: viaje.numero, fecha: viaje.fecha, placa: viaje.placa,
    conductor: viaje.conductorNombre || '', destino: viaje.destino,
    manifiesto: viaje.manifiesto?.numero || '', cantidad, conAuxiliar: !!aux,
    tarifa: tarifaUnit, totalTarifa, auxiliarUnidad: auxCobro, totalAuxiliar, totalCobrado,
    fleteConductor: fleteUnit, totalFlete, auxiliarPagado: auxPago, totalAuxiliarPagado,
    utilidad, utilidadPct: totalCobrado ? utilidad / totalCobrado : 0,
    politicaAuxiliar: politica, sinTarifa: !tarifa,
  };
}

export function totalesLiquidacion(lineas) {
  const t = { viajes: lineas.length, cantidad: 0, totalCobrado: 0, totalTarifa: 0, totalAuxiliar: 0,
    totalFlete: 0, totalAuxiliarPagado: 0, utilidad: 0 };
  for (const l of lineas) {
    for (const k of ['cantidad', 'totalCobrado', 'totalTarifa', 'totalAuxiliar', 'totalFlete', 'totalAuxiliarPagado', 'utilidad']) {
      t[k] += num(l[k]);
    }
  }
  t.utilidadPct = t.totalCobrado ? t.utilidad / t.totalCobrado : 0;
  return t;
}
