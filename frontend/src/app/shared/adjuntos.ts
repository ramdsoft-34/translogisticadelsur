import { Avisos } from '../core/avisos.service';

export interface Adjunto { nombre: string; tipo: string; base64: string }
const MAX_ARCHIVOS = 5;
const MAX_BYTES = 8 * 1024 * 1024;

// Lee los archivos elegidos en un <input type="file"> como base64 para adjuntarlos a un correo
export async function leerArchivos(ev: Event, avisos: Avisos): Promise<Adjunto[]> {
  const archivos = [...((ev.target as HTMLInputElement).files || [])];
  if (archivos.length > MAX_ARCHIVOS) { avisos.mostrar(`Máximo ${MAX_ARCHIVOS} archivos`, 'error'); return []; }
  if (archivos.reduce((a, f) => a + f.size, 0) > MAX_BYTES) { avisos.mostrar('Los archivos superan 8 MB en total', 'error'); return []; }
  return Promise.all(archivos.map(f => new Promise<Adjunto>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ nombre: f.name, tipo: f.type, base64: String(r.result).split(',')[1] || '' });
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  })));
}
