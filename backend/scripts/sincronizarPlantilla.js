// Sincroniza los maestros de una empresa con la plantilla de Excel (ver services/importacion/sincronizar.js).
// Uso:  node scripts/sincronizarPlantilla.js "<nombre de la empresa>" <archivo.xlsm>            (solo plan)
//       node scripts/sincronizarPlantilla.js "<nombre de la empresa>" <archivo.xlsm> --aplicar  (aplica)
// Haga una copia de la base de datos (mongodump) antes de aplicar.
import fs from 'node:fs';
import { conectar, desconectar } from '../src/db.js';
import { Empresa } from '../src/models/index.js';
import { escaparRegex } from '../src/utils/texto.js';
import { sincronizarMaestros } from '../src/services/importacion/sincronizar.js';

const [nombre, archivo] = process.argv.slice(2);
const aplicar = process.argv.includes('--aplicar');
if (!nombre || !archivo) { console.error('Uso: node scripts/sincronizarPlantilla.js "<empresa>" <archivo.xlsm> [--aplicar]'); process.exit(1); }
await conectar();
try {
  const empresas = await Empresa.find({ nombre: new RegExp(escaparRegex(nombre), 'i') }).select('nombre').lean();
  if (empresas.length !== 1) throw new Error(`Se esperaba una empresa con «${nombre}» y hay ${empresas.length}`);
  const r = await sincronizarMaestros(empresas[0]._id, fs.readFileSync(archivo), { aplicar });
  console.log(JSON.stringify({ empresa: empresas[0].nombre, ...r }, null, 1));
} finally {
  await desconectar();
}
