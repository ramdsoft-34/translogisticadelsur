// Migra a la plataforma los datos de gestión que lleva la plantilla de Excel (ver services/importacion/gestion.js):
// préstamos, contabilidad, liquidaciones, soportes internos, correos, autorizaciones, registro del RNDC y numeraciones.
// No duplica: lo que ya existe se deja igual. La importación de la plantilla completa (Configuración) ya lo incluye.
// Uso: node scripts/importarGestionPlantilla.js "<empresa>" <archivo.xlsm> [--aplicar]
import fs from 'node:fs';
import { conectar, desconectar } from '../src/db.js';
import { Empresa } from '../src/models/index.js';
import { escaparRegex } from '../src/utils/texto.js';
import { leerLibro } from '../src/services/importacion/excel.js';
import { importarGestion } from '../src/services/importacion/gestion.js';

const [nombre, archivo] = process.argv.slice(2);
const aplicar = process.argv.includes('--aplicar');
await conectar();
try {
  const empresas = await Empresa.find({ nombre: new RegExp(escaparRegex(nombre), 'i') }).select('nombre').lean();
  if (empresas.length !== 1) throw new Error(`Se esperaba una empresa con «${nombre}» y hay ${empresas.length}`);
  const r = await importarGestion(empresas[0]._id, await leerLibro(fs.readFileSync(archivo)), { aplicar });
  console.log(JSON.stringify({ empresa: empresas[0].nombre, aplicado: aplicar, ...r }, null, 1));
} finally {
  await desconectar();
}
