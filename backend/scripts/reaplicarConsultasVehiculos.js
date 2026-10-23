// Corrige los vehículos de una empresa con las respuestas del RNDC ya guardadas (sin volver a consultar):
// toma, de cada placa, la consulta más reciente y aplica el registro vigente (SOAT más reciente).
// Uso: node scripts/reaplicarConsultasVehiculos.js "<empresa>" [--aplicar]
import { conectar, desconectar } from '../src/db.js';
import { Empresa, TransaccionRndc } from '../src/models/index.js';
import { escaparRegex } from '../src/utils/texto.js';
import { reaplicarConsultaVehiculo } from '../src/services/rndc/operaciones.js';

const [nombre] = process.argv.slice(2);
const aplicar = process.argv.includes('--aplicar');
await conectar();
try {
  const [empresa] = await Empresa.find({ nombre: new RegExp(escaparRegex(nombre), 'i') }).lean();
  if (!empresa) throw new Error('Empresa no encontrada');
  const trans = await TransaccionRndc.find({ empresa: empresa._id, referencia: 'Consulta vehiculo', ok: true }).sort({ createdAt: -1 }).select('solicitud respuesta createdAt').lean();
  const vistas = new Set(); const res = { consultas: trans.length, placas: 0, actualizados: 0, sinCambios: 0, otros: 0, soatCorregidos: 0, tenedorCorregidos: 0, ejemplos: [] };
  for (const t of trans) {
    const placa = (t.solicitud.match(/<NUMPLACA>'?([A-Z0-9]+)'?<\/NUMPLACA>/) || [])[1];
    if (!placa || vistas.has(placa)) continue;
    vistas.add(placa); res.placas += 1;
    const r = await reaplicarConsultaVehiculo(empresa._id, placa, t.respuesta, { guardar: aplicar });
    if (r.estado === 'actualizado') {
      res.actualizados += 1;
      if (r.antes.soat !== r.despues.soat) res.soatCorregidos += 1;
      if (r.antes.tenedor !== r.despues.tenedor) res.tenedorCorregidos += 1;
      if (res.ejemplos.length < 8 && r.antes.soat !== r.despues.soat) res.ejemplos.push(`${placa}: SOAT ${r.antes.soat || '—'} → ${r.despues.soat}`);
    } else if (r.estado === 'sin_cambios') res.sinCambios += 1; else res.otros += 1;
  }
  console.log(JSON.stringify({ empresa: empresa.nombre, aplicado: aplicar, ...res }, null, 1));
} finally {
  await desconectar();
}
