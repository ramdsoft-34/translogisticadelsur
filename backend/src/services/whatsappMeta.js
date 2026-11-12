// Fase 15: envío de imágenes al conductor con la API de WhatsApp Business (Cloud API de Meta).
// Se configura con variables de entorno. Sin ellas, la plataforma no envía nada sola: el mensajero comparte la
// imagen desde su celular (WhatsApp) y la oficina confirma a mano.
//   WHATSAPP_TOKEN               token permanente del usuario del sistema de Meta
//   WHATSAPP_PHONE_NUMBER_ID     identificador del número que envía
//   WHATSAPP_APP_SECRET          secreto de la app (para validar la firma del webhook)
//   WHATSAPP_VERIFY_TOKEN        palabra que se escribe en Meta al registrar el webhook
//   WHATSAPP_PLANTILLA_ANTICIPO  nombre de la plantilla aprobada (por defecto soporte_anticipo)
//   WHATSAPP_IDIOMA              idioma de la plantilla (por defecto es)
import crypto from 'node:crypto';

const cfg = () => ({
  token: process.env.WHATSAPP_TOKEN || '',
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  secreto: process.env.WHATSAPP_APP_SECRET || '',
  verificar: process.env.WHATSAPP_VERIFY_TOKEN || '',
  plantilla: process.env.WHATSAPP_PLANTILLA_ANTICIPO || 'soporte_anticipo',
  idioma: process.env.WHATSAPP_IDIOMA || 'es',
  url: (process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v23.0').replace(/\/$/, ''),
});

export const configurado = () => { const c = cfg(); return !!(c.token && c.phoneId); };
export const tokenVerificacion = () => cfg().verificar;

// Meta avisa en desorden: el estado nunca retrocede
export const ORDEN = { pendiente: 1, manual: 1, enviado: 2, entregado: 3, leido: 4 };
export const ESTADO_META = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'error' };
export function avanza(actual, nuevo) {
  if (nuevo === 'error') return actual !== 'entregado' && actual !== 'leido';
  return (ORDEN[nuevo] || 0) > (ORDEN[actual] || 0);
}

async function llamar(ruta, opciones) {
  const c = cfg();
  const r = await fetch(`${c.url}/${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${c.token}`, ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.error_data?.details || d?.error?.message || `Meta respondió ${r.status}`);
  return d;
}

// Imagen data URL → id de medio en Meta
async function subirImagen(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('La imagen del soporte no es válida');
  const f = new FormData();
  f.append('messaging_product', 'whatsapp');
  f.append('type', m[1]);
  f.append('file', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), m[1] === 'image/png' ? 'soporte.png' : 'soporte.jpg');
  return (await llamar(`${cfg().phoneId}/media`, { method: 'POST', body: f })).id;
}

// Los valores de una plantilla no admiten saltos de línea ni pueden ir vacíos
const valor = (v) => ({ type: 'text', text: String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || '-' });

// Plantilla con la imagen como encabezado y {{1}}…{{7}} en el cuerpo (ver docs/ANTICIPOS.md)
export async function enviarSoporte(para, imagen, parametros) {
  const c = cfg();
  const id = await subirImagen(imagen);
  const d = await llamar(`${c.phoneId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'template', template: {
      name: c.plantilla, language: { code: c.idioma },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { id } }] },
        { type: 'body', parameters: parametros.map(valor) },
      ] } }),
  });
  return d?.messages?.[0]?.id || '';
}

// Firma de Meta (X-Hub-Signature-256) sobre el cuerpo exacto recibido
export function firmaValida(cuerpo, firma, secreto = cfg().secreto) {
  if (!secreto || !firma || !cuerpo) return false;
  const esperada = Buffer.from(`sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`);
  const recibida = Buffer.from(String(firma));
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

// Estados que trae el webhook: [{ id, estado, fecha, error }]
export const estadosDe = (datos) => (datos?.entry || []).flatMap(x => x.changes || []).flatMap(c => c.value?.statuses || [])
  .map(s => ({ id: String(s.id || ''), estado: ESTADO_META[s.status] || '', fecha: new Date(Number(s.timestamp) * 1000 || Date.now()),
    error: s.status === 'failed' ? String(s.errors?.[0]?.error_data?.details || s.errors?.[0]?.title || 'Meta no pudo entregar el mensaje').slice(0, 300) : '' }))
  .filter(s => s.id && s.estado);
