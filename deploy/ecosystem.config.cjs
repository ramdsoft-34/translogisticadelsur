// PM2: procesos de producción de Translogística del Sur.
// Las variables (secretos incluidos) se leen de backend/.env, que no está en el repositorio.
module.exports = {
  apps: [
    {
      name: 'tls-api',
      cwd: __dirname + '/../backend',
      script: 'src/server.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '400M',
      time: true,
    },
    {
      // Simulador RNDC local (solo 127.0.0.1) para el ambiente SIMULADO de cada empresa.
      name: 'tls-simulador',
      cwd: __dirname + '/../backend',
      // Se lanza con node directamente: el script solo escucha cuando es el programa principal.
      script: 'node',
      args: 'tools/rndcSimulador.js',
      interpreter: 'none',
      max_memory_restart: '150M',
      time: true,
    },
  ],
};
