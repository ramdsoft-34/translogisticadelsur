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

// Línea de la liquidación de fletes (fórmulas de la hoja RELACION).
//   - tarifa por viaje: se cobra una vez por fila; por unidad: × cantidad
//   - el auxiliar se cobra y se paga por cada unidad cuando el viaje lleva auxiliar
export function lineaLiquidacion(viaje, tarifa) {
  const cantidad = num(viaje.cantidad) || 1;
  const porUnidad = tarifa?.tipoCobro === 'unidad';
  const tarifaUnit = tarifa ? num(tarifa.tarifaCliente) : num(viaje.tarifa);
  const fleteUnit = tarifa ? num(tarifa.fleteConductor) : num(viaje.flete);
  const aux = viaje.conAuxiliar;
  const auxCobro = aux && tarifa ? num(tarifa.tarifaAuxiliar) : 0;
  const auxPago = aux && tarifa ? num(tarifa.auxiliarPagado) : 0;

  const totalTarifa = porUnidad ? tarifaUnit * cantidad : tarifaUnit;
  const totalAuxiliar = auxCobro * cantidad;
  const totalCobrado = totalTarifa + totalAuxiliar;
  const totalFlete = porUnidad ? fleteUnit * cantidad : fleteUnit;
  const totalAuxiliarPagado = auxPago * cantidad;
  const utilidad = totalCobrado - (totalFlete + totalAuxiliarPagado);
  return {
    viaje: viaje._id, numero: viaje.numero, fecha: viaje.fecha, placa: viaje.placa,
    conductor: viaje.conductorNombre || '', destino: viaje.destino,
    manifiesto: viaje.manifiesto?.numero || '', cantidad, conAuxiliar: !!aux,
    tarifa: tarifaUnit, totalTarifa, auxiliarUnidad: auxCobro, totalAuxiliar, totalCobrado,
    fleteConductor: fleteUnit, totalFlete, auxiliarPagado: auxPago, totalAuxiliarPagado,
    utilidad, utilidadPct: totalCobrado ? utilidad / totalCobrado : 0,
    sinTarifa: !tarifa,
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
