// Cambios en vivo: cada modificación exitosa (POST/PUT/PATCH/DELETE) se avisa a los usuarios conectados
// de la misma empresa por Server-Sent Events, para que sus pantallas se actualicen sin recargar.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publicar(empresaId, cambio) {
  if (!empresaId) return;
  bus.emit(String(empresaId), { ...cambio, fecha: Date.now() });
}

export function suscribir(empresaId, fn) {
  const canal = String(empresaId);
  bus.on(canal, fn);
  return () => bus.off(canal, fn);
}

// Middleware: al terminar una petición que modifica datos, avisa qué recurso cambió (viajes, rndc, maestros…)
const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IGNORAR = new Set(['auth', 'eventos']);
export function avisarCambios(req, res, next) {
  if (!METODOS.has(req.method)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.empresaId) return;
    const partes = req.originalUrl.split('?')[0].split('/').filter(Boolean);   // ['api', 'viajes', ...]
    const recurso = partes[1] || '';
    if (!recurso || IGNORAR.has(recurso)) return;
    publicar(req.empresaId, { recurso, ruta: '/' + partes.slice(1).join('/'), metodo: req.method,
      origen: String(req.get('x-cliente-id') || '').slice(0, 40) });
  });
  next();
}
