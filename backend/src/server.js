import { env, validarEnv } from './config/env.js';
import { conectar } from './db.js';
import { crearApp } from './app.js';
import { iniciarAgrupador } from './services/correo.js';
import { iniciarProgramadorBodega } from './services/bodega.js';
import { retirarIndicesViejos } from './services/indices.js';
import { sincronizarNombresGuardados } from './services/sincronizarMaestros.js';
import { Empresa } from './models/index.js';

validarEnv();
await conectar();
const app = crearApp();
iniciarAgrupador();   // envía los manifiestos pendientes agrupados por cliente
iniciarProgramadorBodega();   // solicitud automática de cargues a los jefes de bodega
retirarIndicesViejos().catch(() => {});   // en segundo plano: no retrasa el arranque
// Nombres de conductor guardados en viajes, préstamos y liquidaciones: iguales al registro actual (en segundo plano)
(async () => {
  for (const e of await Empresa.find().select('_id').lean()) {
    const n = await sincronizarNombresGuardados(e._id);
    if (n) console.log(`Nombres de conductor actualizados (${e._id}): ${n}`);
  }
})().catch((e) => console.warn('[nombres]', e.message));
app.listen(env.port, env.host, () => {
  console.log(`API Translogística del Sur en http://${env.host}:${env.port}/api`);
  console.log(`RNDC: producción ${env.rndc.permitirProduccion ? 'HABILITADA' : 'deshabilitada'}, pruebas ${env.rndc.permitirPruebas ? 'habilitadas' : 'deshabilitadas'}`);
});
