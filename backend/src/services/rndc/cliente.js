// Cliente SOAP del RNDC. Envía el XML, reintenta con el otro formato de sobre
// si el RNDC no entiende el contenido (RNDC72), usa el servidor de
// contingencia en producción si el principal no responde y deja trazabilidad
// en TransaccionRndc sin la clave.
import { env } from '../../config/env.js';
import { TransaccionRndc } from '../../models/index.js';
import { ENDPOINTS, SOAP_ACTION } from './catalogos.js';
import { sobreSoap, ocultarClave } from './xml.js';

export class ErrorRndc extends Error {
  constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
}

// URLs del ambiente configurado para la empresa. Bloquea los ambientes
// oficiales si el servidor no los tiene habilitados (protege contra envíos
// reales desde equipos de desarrollo o pruebas).
export function urlsAmbiente(ambiente) {
  if (ambiente === 'PRODUCCION') {
    if (!env.rndc.permitirProduccion) {
      throw new ErrorRndc('El envío al RNDC de producción está deshabilitado en este servidor (RNDC_PERMITIR_PRODUCCION).', 403);
    }
    return ENDPOINTS.PRODUCCION;
  }
  if (ambiente === 'PRUEBAS') {
    if (!env.rndc.permitirPruebas) throw new ErrorRndc('El ambiente de pruebas del RNDC está deshabilitado en este servidor.', 403);
    return ENDPOINTS.PRUEBAS;
  }
  return [env.rndc.simuladorUrl];
}

// El RNDC trabaja en ISO-8859-1: si la respuesta no es UTF-8 válido se lee como latin1.
function decodificar(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('latin1').decode(buf); }
}

async function post(url, cuerpo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), env.rndc.timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST', body: cuerpo, signal: ctrl.signal,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: SOAP_ACTION },
    });
    return { conectado: true, status: r.status, texto: decodificar(await r.arrayBuffer()) };
  } catch (e) {
    return { conectado: false, status: 0, texto: `ERROR_CONEXION: ${e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message}` };
  } finally {
    clearTimeout(t);
  }
}

// Envía un XML interno y devuelve { texto, url, duracionMs }.
// meta: { empresa, usuario, ambiente, tipo, proceso, referencia, viaje }
export async function enviar(xmlInterno, meta) {
  const urls = urlsAmbiente(meta.ambiente);
  const inicio = Date.now();
  let resp = { texto: '', status: 0, conectado: false };
  let urlUsada = urls[0];
  for (const url of urls) {
    urlUsada = url;
    for (const modo of [1, 2]) {
      resp = await post(url, sobreSoap(xmlInterno, modo));
      if (!resp.conectado || !resp.texto.includes('RNDC72')) break;
    }
    if (resp.conectado) break;      // solo pasa a contingencia si no hubo conexión
  }
  return { ...resp, url: urlUsada, duracionMs: Date.now() - inicio };
}

export async function registrarTransaccion(meta, xmlInterno, resp, resultado) {
  try {
    await TransaccionRndc.create({
      empresa: meta.empresa, usuario: meta.usuario, ambiente: meta.ambiente, url: resp.url,
      tipo: meta.tipo, proceso: meta.proceso, referencia: meta.referencia || '', viaje: meta.viaje || null,
      solicitud: ocultarClave(xmlInterno).slice(0, 20000), respuesta: String(resp.texto).slice(0, 20000),
      ok: !!resultado.ok, radicado: resultado.radicado || '', mensaje: String(resultado.mensaje || '').slice(0, 2000),
      duracionMs: resp.duracionMs,
    });
  } catch (e) {
    console.error('No se pudo registrar la transacción RNDC:', e.message);
  }
}
