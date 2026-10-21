// Migra a la plataforma los datos de gestión que lleva la plantilla de Excel:
// préstamos (con cuotas y abonos), asientos contables y las numeraciones (PR, A, FV, LC y MC/RC del soporte interno).
// No duplica: lo que ya existe (por número) se deja igual.
// Uso: node scripts/importarGestionPlantilla.js "<empresa>" <archivo.xlsm> [--aplicar]
import fs from 'node:fs';
import { conectar, desconectar } from '../src/db.js';
import { Empresa, Prestamo, Asiento, Tercero, Contador } from '../src/models/index.js';
import { escaparRegex } from '../src/utils/texto.js';
import { leerLibro, filas, txt, entero, num, fecha } from '../src/services/importacion/excel.js';
import { asegurarPuc } from '../src/services/gestion/contabilidad.js';

const [nombre, archivo] = process.argv.slice(2);
const aplicar = process.argv.includes('--aplicar');
await conectar();
try {
  const [empresa] = await Empresa.find({ nombre: new RegExp(escaparRegex(nombre), 'i') }).lean();
  if (!empresa) throw new Error('Empresa no encontrada');
  const E = empresa._id;
  const wb = await leerLibro(fs.readFileSync(archivo));
  const H = (n) => (wb.getWorksheet(n) ? filas(wb.getWorksheet(n)).slice(1) : []);
  const res = { prestamos: 0, asientos: 0, contadores: {} };

  // Préstamos con sus cuotas y abonos
  const cuotas = H('_PRESTAMOS_CUOTAS'); const abonos = H('_PRESTAMOS_ABONOS');
  for (const f of H('_PRESTAMOS').filter(x => txt(x[0]))) {
    const numero = txt(f[0]);
    if (await Prestamo.exists({ empresa: E, numero })) continue;
    const cedula = entero(f[2]);
    const t = await Tercero.findOne({ empresa: E, numId: cedula }).lean();
    const doc = {
      empresa: E, numero, fecha: fecha(f[1]), conductor: t?._id || null, cedula, conductorNombre: txt(f[3]), placa: txt(f[4]).toUpperCase(),
      concepto: txt(f[5]), capital: num(f[6]) || 0, tasaMensual: num(f[7]) || 0, nCuotas: num(f[8]) || 1, valorCuota: num(f[9]) || 0,
      primeraCuota: fecha(f[10]), estado: ['VIGENTE', 'PAGADO', 'ANULADO'].includes(txt(f[11]).toUpperCase()) ? txt(f[11]).toUpperCase() : 'VIGENTE', observacion: txt(f[12]),
      cuotas: cuotas.filter(c => txt(c[0]) === numero).map(c => ({ n: num(c[1]), fecha: fecha(c[2]), valor: num(c[3]) || 0, capital: num(c[4]) || 0, interes: num(c[5]) || 0,
        saldoCapital: num(c[6]) || 0, abonado: num(c[7]) || 0, fechaAbono: fecha(c[8]), liquidacion: txt(c[9]) })),
      abonos: abonos.filter(a => txt(a[0]) === numero).map(a => ({ fecha: fecha(a[1]), valor: num(a[2]) || 0, origen: txt(a[3]), liquidacion: txt(a[4]), nota: txt(a[5]) })),
    };
    if (aplicar) await Prestamo.create(doc);
    res.prestamos += 1;
  }

  // Asientos contables (una fila por línea; se agrupan por ID)
  if (aplicar) await asegurarPuc(E);
  const porId = new Map();
  for (const f of H('_CONT_ASIENTOS').filter(x => txt(x[0]))) {
    const id = txt(f[0]);
    if (!porId.has(id)) porId.set(id, { numero: id, fecha: fecha(f[1]), terceroDoc: entero(f[4]), tercero: txt(f[5]), documento: txt(f[6]), centroCosto: txt(f[7]),
      concepto: txt(f[10]), origen: txt(f[11]), estado: txt(f[12]).toUpperCase() === 'ANULADO' ? 'ANULADO' : 'ACTIVO', lineas: [] });
    porId.get(id).lineas.push({ cuenta: txt(f[2]), nombre: txt(f[3]), debito: num(f[8]) || 0, credito: num(f[9]) || 0 });
  }
  for (const a of porId.values()) {
    if (await Asiento.exists({ empresa: E, numero: a.numero })) continue;
    if (aplicar) await Asiento.create({ ...a, empresa: E });
    res.asientos += 1;
  }

  // Numeraciones: continúan después de lo último usado en la plantilla
  const ultimo = (lista, re) => Math.max(0, ...lista.map(x => Number(String(x).match(re)?.[1] || 0)));
  const contadores = {
    prestamo: ultimo(H('_PRESTAMOS').map(f => txt(f[0])), /^PR-(\d+)$/),
    asiento: ultimo([...porId.keys()], /^A-(\d+)$/),
    factura: ultimo(H('_CONT_FACTURAS').map(f => txt(f[0])), /^FV-(\d+)$/),
    soporteInterno: ultimo(H('_SOPORTES').map(f => txt(f[0])), /^MC(\d+)$/),
  };
  for (const [clave, valor] of Object.entries(contadores)) {
    if (!valor) continue;
    res.contadores[clave] = valor;
    if (aplicar) await Contador.updateOne({ empresa: E, clave }, { $max: { valor } }, { upsert: true });
  }
  console.log(JSON.stringify({ empresa: empresa.nombre, aplicado: aplicar, ...res }));
} finally {
  await desconectar();
}
