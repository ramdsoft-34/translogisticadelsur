// Limitador de peticiones al web service del RNDC (ambientes oficiales).
// Todas las peticiones del servidor pasan por una cola: como máximo
// RNDC_MAX_CONCURRENTES a la vez (1 por defecto) y al menos RNDC_PAUSA_MS
// entre el inicio de una y la siguiente. Así ninguna empresa ni proceso masivo
// satura el servicio del Ministerio. El simulador local no se limita.
import { env } from '../../config/env.js';

const cola = [];
let activas = 0;
let ultimoInicio = 0;
let temporizador = null;

function siguiente() {
  if (activas >= env.rndc.maxConcurrentes || !cola.length || temporizador) return;
  const espera = Math.max(0, ultimoInicio + env.rndc.pausaMs - Date.now());
  if (espera > 0) { temporizador = setTimeout(() => { temporizador = null; siguiente(); }, espera); return; }
  const { tarea, resolver, rechazar } = cola.shift();
  activas += 1;
  ultimoInicio = Date.now();
  Promise.resolve().then(tarea).then(resolver, rechazar).finally(() => { activas -= 1; siguiente(); });
  siguiente();
}

// Ejecuta `tarea` respetando el límite. Devuelve su resultado.
export function enCola(tarea) {
  return new Promise((resolver, rechazar) => { cola.push({ tarea, resolver, rechazar }); siguiente(); });
}

export const estadoLimitador = () => ({ enCola: cola.length, activas, maxConcurrentes: env.rndc.maxConcurrentes, pausaMs: env.rndc.pausaMs });
