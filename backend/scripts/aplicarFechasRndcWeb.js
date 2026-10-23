// Aplica a los vehículos de una empresa el SOAT y la revisión tecnomecánica leídos de la ficha
// «Vehículo» del portal web del RNDC (archivo JSON { PLACA: { soat, rtm, poliza, nitAseg } }, fechas dd/mm/aaaa).
// Nunca reemplaza una fecha por otra más antigua. Sin --aplicar solo muestra lo que cambiaría.
// Uso: node scripts/aplicarFechasRndcWeb.js "<empresa>" <archivo.json> [--aplicar]
import fs from 'node:fs';
import { conectar, desconectar } from '../src/db.js';
import { Empresa, Vehiculo } from '../src/models/index.js';
import { escaparRegex } from '../src/utils/texto.js';
import { auditar } from '../src/services/auditoria.js';

const [nombre, archivo] = process.argv.slice(2);
const aplicar = process.argv.includes('--aplicar');
const fecha = (t) => { const m = String(t || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

await conectar();
try {
  const [empresa] = await Empresa.find({ nombre: new RegExp(escaparRegex(nombre), 'i') }).lean();
  if (!empresa) throw new Error('Empresa no encontrada');
  const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const res = { leidas: 0, sinDatosRndc: [], noRegistradas: [], soat: 0, tecno: 0, sinCambios: 0, cambios: [] };
  for (const [placa, d] of Object.entries(datos)) {
    res.leidas += 1;
    const soat = fecha(d.soat); const rtm = fecha(d.rtm);
    if (!soat && !rtm) { res.sinDatosRndc.push(placa); continue; }
    const v = await Vehiculo.findOne({ empresa: empresa._id, placa });
    if (!v) { res.noRegistradas.push(placa); continue; }
    const cambios = [];
    if (soat && (!v.soat?.vence || soat > v.soat.vence)) {
      cambios.push(`SOAT ${dia(v.soat?.vence)} → ${dia(soat)}`);
      v.set('soat.vence', soat);
      if (d.poliza) v.set('soat.numero', String(d.poliza));
      if (d.nitAseg && d.nitAseg !== '0') v.set('soat.aseguradoraNit', String(d.nitAseg));
      res.soat += 1;
    }
    if (rtm && (!v.venceTecnomecanica || rtm > v.venceTecnomecanica)) {
      cambios.push(`tecnomecánica ${dia(v.venceTecnomecanica)} → ${dia(rtm)}`);
      v.venceTecnomecanica = rtm;
      res.tecno += 1;
    }
    if (!cambios.length) { res.sinCambios += 1; continue; }
    res.cambios.push(`${placa}: ${cambios.join(' · ')}`);
    if (aplicar) await v.save();
  }
  if (aplicar) await auditar(null, 'fechas_vehiculos_rndc_web', { empresa: empresa._id, entidad: 'Vehiculo',
    detalle: { leidas: res.leidas, soat: res.soat, tecnomecanica: res.tecno, origen: 'Portal web RNDC (ficha Vehículo)' } });
  console.log(JSON.stringify({ empresa: empresa.nombre, aplicado: aplicar, ...res }, null, 1));
} finally {
  await desconectar();
}
