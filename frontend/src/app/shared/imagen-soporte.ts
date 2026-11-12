// Fase 15: imágenes de los soportes de anticipos (se arman y se reducen en el celular antes de subirlas).

const cargar = (src: string) => new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la imagen')); i.src = src; });
const leer = (f: Blob) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => mal(r.error); r.readAsDataURL(f); });

// Foto del comprobante → JPEG de máximo 1280 px por lado (≈ 150 a 400 KB)
export async function comprimirFoto(archivo: File, lado = 1280, calidad = 0.72): Promise<string> {
  const img = await cargar(await leer(archivo));
  const k = Math.min(1, lado / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  let q = calidad; let url = c.toDataURL('image/jpeg', q);
  while (url.length > 850_000 && q > 0.35) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
  return url;
}

export interface DatosRecibo { empresa: string; placa: string; conductor: string; ruta: string; fecha: string; valor: string; mensajero: string }

// Recibo de anticipo en efectivo con la firma del conductor (es la imagen que le llega por WhatsApp)
export async function reciboEfectivo(d: DatosRecibo, firma: string): Promise<string> {
  const c = document.createElement('canvas'); c.width = 720; c.height = 900;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#15171c'; g.fillRect(0, 0, c.width, 110);
  g.fillStyle = '#f5b400'; g.font = '800 34px Arial'; g.fillText(d.empresa.slice(0, 32), 36, 52);
  g.fillStyle = '#fff'; g.font = '600 24px Arial'; g.fillText('RECIBO DE ANTICIPO EN EFECTIVO', 36, 90);
  g.fillStyle = '#15171c'; let y = 170;
  const fila = (k: string, v: string, grande = false) => {
    g.font = '500 22px Arial'; g.fillStyle = '#6b7280'; g.fillText(k, 36, y);
    g.font = `${grande ? '800 40px' : '700 26px'} Arial`; g.fillStyle = '#15171c'; g.fillText(v.slice(0, 40), 260, y); y += grande ? 70 : 52;
  };
  fila('Valor', d.valor, true); fila('Placa', d.placa); fila('Conductor', d.conductor); fila('Ruta', d.ruta); fila('Fecha de cargue', d.fecha);
  const ahora = new Date();
  fila('Entregado', `${ahora.toLocaleDateString('es-CO')} ${ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`);
  fila('Entregó', d.mensajero);
  const f = await cargar(firma);
  const ancho = 460; const alto = Math.min(180, f.height * (ancho / f.width));
  g.drawImage(f, (c.width - ancho) / 2, 640, ancho, alto);
  g.strokeStyle = '#15171c'; g.lineWidth = 2; g.beginPath(); g.moveTo(130, 835); g.lineTo(590, 835); g.stroke();
  g.font = '600 20px Arial'; g.fillStyle = '#15171c'; g.textAlign = 'center'; g.fillText(`Recibí · ${d.conductor}`.slice(0, 48), c.width / 2, 865);
  return c.toDataURL('image/jpeg', 0.85);
}

export function dataUrlArchivo(url: string, nombre: string): File {
  const [cab, datos] = url.split(','); const tipo = /data:([^;]+)/.exec(cab)?.[1] || 'image/jpeg';
  const b = atob(datos); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return new File([u], nombre, { type: tipo });
}

// Sin la API de WhatsApp Business: abre «Compartir» del celular con la imagen y el texto (WhatsApp lo recibe así)
export async function compartirWhatsapp(imagen: string, texto: string, celular = ''): Promise<boolean> {
  const archivo = dataUrlArchivo(imagen, 'soporte-anticipo.jpg');
  const nav = navigator as any;
  if (nav.canShare?.({ files: [archivo] })) {
    try { await nav.share({ files: [archivo], text: texto }); return true; } catch { return false; }
  }
  const num = celular.replace(/\D/g, '');
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  return true;
}
