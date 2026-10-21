// Préstamos y descuentos a conductores (averías, faltantes…), como en la plantilla:
// cuotas QUINCENALES (día 15 y último día del mes) con interés mensual y cuota fija.
import { Prestamo, Tercero, siguiente } from '../../models/index.js';
import { ErrorHttp } from '../../middleware/auth.js';
import { postear } from './contabilidad.js';
import { asegurarMesAbierto } from './cierre.js';

const dia = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const tasaQuincenal = (tasaMensualPct) => (1 + tasaMensualPct / 100) ** 0.5 - 1;
export function cuotaFija(capital, r, n) {
  if (n < 1) return 0;
  return Math.round(r <= 0 ? capital / n : capital * r / (1 - (1 + r) ** -n));
}
// Siguiente quincena: el 15 o el último día del mes
export function siguienteQuincena(d) {
  const y = d.getUTCFullYear(); const m = d.getUTCMonth(); const fin = new Date(Date.UTC(y, m + 1, 0));
  if (d.getUTCDate() < 15) return new Date(Date.UTC(y, m, 15));
  if (d < fin) return fin;
  return new Date(Date.UTC(y, m + 1, 15));
}

export function planCuotas(capital, tasaMensual, n, primera) {
  const r = tasaQuincenal(tasaMensual);
  const valor = cuotaFija(capital, r, n);
  const cuotas = [];
  let saldo = capital; let fecha = dia(primera);
  for (let i = 1; i <= n; i += 1) {
    const interes = Math.round(saldo * r);
    let cap = valor - interes;
    if (i === n) cap = saldo;                    // la última cuota ajusta el redondeo
    saldo -= cap;
    cuotas.push({ n: i, fecha, valor: cap + interes, capital: cap, interes, saldoCapital: Math.max(0, saldo), abonado: 0 });
    fecha = siguienteQuincena(new Date(fecha.getTime() + 86400000));
  }
  return { valorCuota: valor, cuotas };
}

export function resumenPrestamo(p) {
  const pagado = p.cuotas.reduce((a, c) => a + c.abonado, 0);
  const pendiente = Math.max(0, p.cuotas.reduce((a, c) => a + c.valor - c.abonado, 0));
  const proxima = p.cuotas.find(c => c.valor - c.abonado > 0.5);
  return { pagado, pendiente, interes: p.cuotas.reduce((a, c) => a + c.interes, 0), cuotasPendientes: p.cuotas.filter(c => c.valor - c.abonado > 0.5).length,
    proxima: proxima?.fecha || null, fin: p.cuotas.at(-1)?.fecha || null };
}

export const estadoCuota = (c, hoy = new Date()) => (c.abonado >= c.valor - 0.5 ? 'PAGADA' : c.abonado > 0.5 ? 'PARCIAL' : new Date(c.fecha) < hoy ? 'VENCIDA' : 'PENDIENTE');

export async function crearPrestamo(empresaId, { conductor, placa = '', concepto, capital, tasaMensual = 0, nCuotas, primeraCuota, fecha = new Date(), observacion = '', usuario }) {
  const t = await Tercero.findOne({ empresa: empresaId, _id: conductor }).lean();
  if (!t) throw new ErrorHttp(400, 'Conductor no encontrado');
  await asegurarMesAbierto(empresaId, fecha);
  const primera = primeraCuota ? new Date(primeraCuota) : siguienteQuincena(dia(new Date(fecha)));
  const plan = planCuotas(capital, tasaMensual, nCuotas, primera);
  const numero = `PR-${String(await siguiente(empresaId, 'prestamo')).padStart(4, '0')}`;
  const nombre = [t.nombres, t.apellido1, t.apellido2].filter(Boolean).join(' ');
  const p = await Prestamo.create({ empresa: empresaId, numero, fecha, conductor: t._id, cedula: t.numId, conductorNombre: nombre, placa,
    concepto, capital, tasaMensual, nCuotas, valorCuota: plan.valorCuota, primeraCuota: primera, cuotas: plan.cuotas, observacion, creadoPor: usuario });
  // Desembolso: préstamos a conductores contra bancos
  await postear(empresaId, { fecha, documento: numero, concepto: `Desembolso de prestamo ${numero} - ${nombre}`, origen: 'PRE',
    terceroDoc: t.numId, tercero: nombre, centroCosto: 'PRESTAMOS', usuario, lineas: [['1385', capital], ['1110', -capital]] });
  return p;
}

// Aplica un abono a las cuotas pendientes en orden. Devuelve { aplicado, interes }.
export async function abonar(empresaId, numero, valor, { fecha = new Date(), origen = 'CAJA', liquidacion = '', nota = '', usuario = null, contabilizar = true } = {}) {
  const p = await Prestamo.findOne({ empresa: empresaId, numero });
  if (!p) throw new ErrorHttp(404, 'Préstamo no encontrado');
  if (p.estado !== 'VIGENTE') throw new ErrorHttp(409, `El préstamo está ${p.estado}`);
  let resto = Math.round(valor); let interes = 0;
  for (const c of p.cuotas) {
    if (resto <= 0) break;
    const falta = c.valor - c.abonado;
    if (falta <= 0.5) continue;
    const aplica = Math.min(resto, falta);
    if (c.abonado < c.interes) interes += Math.min(aplica, c.interes - c.abonado);
    c.abonado += aplica; c.fechaAbono = fecha;
    if (liquidacion) c.liquidacion = liquidacion;
    resto -= aplica;
  }
  const aplicado = Math.round(valor) - resto;
  if (aplicado > 0) {
    p.abonos.push({ fecha, valor: aplicado, interes, origen, liquidacion, nota });
    if (resumenPrestamo(p).pendiente <= 0) p.estado = 'PAGADO';
    p.markModified('cuotas');
    await p.save();
    // Los abonos directos (no por liquidación) se contabilizan aquí; los de liquidación van en su asiento
    if (contabilizar) await postear(empresaId, { fecha, documento: numero, concepto: `Abono prestamo ${numero} - ${p.conductorNombre}`, origen: 'ABO',
      terceroDoc: p.cedula, tercero: p.conductorNombre, centroCosto: 'PRESTAMOS', usuario, lineas: [['1110', aplicado], ['1385', -(aplicado - interes)], ['4210', -interes]] });
  }
  return { aplicado, interes, prestamo: p };
}

export async function anularPrestamo(empresaId, numero, motivo) {
  const p = await Prestamo.findOne({ empresa: empresaId, numero });
  if (!p) throw new ErrorHttp(404, 'Préstamo no encontrado');
  if (p.abonos.length) throw new ErrorHttp(409, 'El préstamo ya tiene abonos: no se puede anular');
  p.estado = 'ANULADO';
  p.observacion = `${p.observacion} | ANULADO ${new Date().toISOString().slice(0, 10)}: ${motivo}`.trim();
  await p.save();
  return p;
}

// Cuotas vencidas al corte y sin pagar de los préstamos vigentes de esa cédula
export async function cuotaPendiente(empresaId, cedula, corte) {
  const prestamos = await Prestamo.find({ empresa: empresaId, cedula, estado: 'VIGENTE' }).lean();
  let total = 0; const detalle = [];
  for (const p of prestamos) {
    const sub = p.cuotas.filter(c => new Date(c.fecha) <= corte).reduce((a, c) => a + Math.max(0, c.valor - c.abonado), 0);
    if (sub > 0) { total += sub; detalle.push(`${p.numero}: ${sub}`); }
  }
  return { total, detalle };
}

// Descuenta en una liquidación hasta `valor`, en orden de préstamo. Devuelve { aplicado, interes }.
export async function descontar(empresaId, cedula, valor, numeroLiq, usuario) {
  let resto = valor; let aplicado = 0; let interes = 0;
  for (const p of await Prestamo.find({ empresa: empresaId, cedula, estado: 'VIGENTE' }).sort({ fecha: 1 })) {
    if (resto <= 0) break;
    const r = await abonar(empresaId, p.numero, resto, { origen: 'LIQUIDACION', liquidacion: numeroLiq, nota: 'Descuento en liquidacion', usuario, contabilizar: false });
    resto -= r.aplicado; aplicado += r.aplicado; interes += r.interes;
  }
  return { aplicado, interes };
}

// Revierte los descuentos aplicados por una liquidación anulada
export async function revertirDescuentos(empresaId, numeroLiq) {
  for (const p of await Prestamo.find({ empresa: empresaId, 'abonos.liquidacion': numeroLiq })) {
    let quitar = p.abonos.filter(a => a.liquidacion === numeroLiq).reduce((a, x) => a + x.valor, 0);
    for (const c of [...p.cuotas].reverse()) {
      if (quitar <= 0) break;
      if (c.liquidacion !== numeroLiq) continue;
      const q = Math.min(quitar, c.abonado); c.abonado -= q; quitar -= q;
      if (!c.abonado) c.liquidacion = '';
    }
    p.abonos = p.abonos.filter(a => a.liquidacion !== numeroLiq);
    if (p.estado === 'PAGADO') p.estado = 'VIGENTE';
    p.markModified('cuotas');
    await p.save();
  }
}
