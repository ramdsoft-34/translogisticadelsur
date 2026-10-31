import { env, validarEnv } from './config/env.js';
import { conectar } from './db.js';
import { crearApp } from './app.js';
import { iniciarAgrupador } from './services/correo.js';
import { iniciarEnvioAutomatico } from './services/gestion/rndcFactura.js';

validarEnv();
await conectar();
const app = crearApp();
iniciarAgrupador();   // envía los manifiestos pendientes agrupados por cliente
iniciarEnvioAutomatico();   // registra en el RNDC las facturas electrónicas pendientes (empresas que lo activaron)
app.listen(env.port, env.host, () => {
  console.log(`API Translogística del Sur en http://${env.host}:${env.port}/api`);
  console.log(`RNDC: producción ${env.rndc.permitirProduccion ? 'HABILITADA' : 'deshabilitada'}, pruebas ${env.rndc.permitirPruebas ? 'habilitadas' : 'deshabilitadas'}`);
});
