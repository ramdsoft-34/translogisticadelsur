// Canal de cambios en vivo (Server-Sent Events) para los usuarios de una empresa.
// El navegador lo abre con fetch y su token; recibe { recurso, ruta, metodo, origen } por cada cambio.
import { Router } from 'express';
import { autenticar, soloEmpresa } from '../middleware/auth.js';
import { suscribir } from '../services/eventos.js';

const r = Router();

r.get('/', autenticar, soloEmpresa, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',          // nginx: entregar cada evento sin acumular
  });
  res.write('retry: 3000\n\n');
  const enviar = (cambio) => res.write(`event: cambio\ndata: ${JSON.stringify(cambio)}\n\n`);
  const quitar = suscribir(req.empresaId, enviar);
  // Latido para que nginx y los proxies no cierren la conexión
  const latido = setInterval(() => res.write(': latido\n\n'), 25000);
  req.on('close', () => { clearInterval(latido); quitar(); });
});

export default r;
