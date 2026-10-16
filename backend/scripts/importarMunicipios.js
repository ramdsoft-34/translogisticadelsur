// Carga (o actualiza) el catálogo DIVIPOLA de municipios usado por el RNDC.
// Fuente: data/municipios.json → [código RNDC de 8 dígitos, municipio, departamento].
// Idempotente: se puede ejecutar varias veces.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conectar, desconectar } from '../src/db.js';
import { Municipio } from '../src/models/index.js';
import { normalizar } from '../src/utils/texto.js';

const ruta = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'municipios.json');

export async function importarMunicipios() {
  const filas = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const ops = filas.map(([codigo, nombre, departamento]) => ({
    updateOne: {
      filter: { codigo },
      update: { $set: { codigo, nombre, departamento, busqueda: normalizar(`${nombre} ${departamento}`) } },
      upsert: true,
    },
  }));
  const r = await Municipio.bulkWrite(ops, { ordered: false });
  return { total: filas.length, nuevos: r.upsertedCount, actualizados: r.modifiedCount };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await conectar();
  try {
    console.log(await importarMunicipios());
  } finally {
    await desconectar();
  }
}
