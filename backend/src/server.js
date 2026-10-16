import { env, validarEnv } from './config/env.js';
import { conectar } from './db.js';
import { crearApp } from './app.js';

validarEnv();
await conectar();
const app = crearApp();
app.listen(env.port, () => {
  console.log(`API Translogística del Sur en http://localhost:${env.port}/api`);
  console.log(`RNDC: producción ${env.rndc.permitirProduccion ? 'HABILITADA' : 'deshabilitada'}, pruebas ${env.rndc.permitirPruebas ? 'habilitadas' : 'deshabilitadas'}`);
});
