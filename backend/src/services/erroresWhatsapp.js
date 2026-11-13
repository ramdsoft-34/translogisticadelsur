// Errores de WhatsApp (Meta) explicados en palabras claras: qué pasó y qué hacer.
// Meta responde en inglés con un código («131026: Message Undeliverable.»); aquí se traduce y se conserva el código.
// Referencia: códigos de error de la API de WhatsApp Cloud (developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes).

const ERRORES = {
  // Destinatario
  131026: 'No se pudo entregar: ese celular no tiene WhatsApp activo, la persona no ha aceptado los términos nuevos de WhatsApp, usa una versión muy vieja de la aplicación o bloqueó el número de la empresa. Confirme el número con la persona (Conductores y terceros) y pídale que actualice WhatsApp',
  131021: 'El número de destino es el mismo número de WhatsApp de la empresa: no se puede enviar a sí mismo',
  131045: 'El número de WhatsApp de la empresa no está registrado o le falta el certificado en Meta. Revise la cuenta en Configuración → WhatsApp',
  131047: 'Pasaron más de 24 horas desde la última respuesta de esa persona: solo se le pueden enviar plantillas aprobadas',
  131049: 'Meta no lo entregó para cuidar la experiencia de esa persona (recibe muchos mensajes de empresas). Intente más tarde',
  131050: 'La persona pidió no recibir más mensajes de este tipo de la empresa',
  131051: 'Tipo de mensaje no admitido por WhatsApp',
  131052: 'WhatsApp no pudo descargar el archivo adjunto (PDF). Intente de nuevo',
  131053: 'No se pudo subir el archivo adjunto (PDF) a WhatsApp. Intente de nuevo',
  131056: 'Se enviaron demasiados mensajes seguidos a ese mismo celular. Espere unos minutos e intente de nuevo',
  131048: 'Meta limitó los envíos porque muchos mensajes fueron reportados o bloqueados. Revise la calidad del número en Meta',
  131031: 'La cuenta de WhatsApp de la empresa está bloqueada por Meta. Revise el administrador comercial de Meta',
  131042: 'Hay un problema con el método de pago de la cuenta de WhatsApp en Meta',
  131057: 'La cuenta de WhatsApp de la empresa está en mantenimiento en Meta. Intente más tarde',
  131000: 'WhatsApp tuvo una falla al enviar. Intente de nuevo',
  131005: 'Meta no dio permiso para enviar: revise el token y los permisos de la cuenta (Configuración → WhatsApp)',
  131008: 'Falta un dato obligatorio en el mensaje',
  131009: 'Un dato del mensaje no es válido (por ejemplo, el celular)',
  131016: 'El servicio de WhatsApp no está disponible en este momento. Intente más tarde',
  133010: 'El número de WhatsApp de la empresa no está registrado en Meta',
  130429: 'Se llegó al límite de mensajes por segundo de WhatsApp. Intente en unos minutos',
  // Plantillas
  132000: 'La plantilla de WhatsApp no tiene la misma cantidad de datos que se le enviaron. Revise la plantilla en Meta',
  132001: 'La plantilla de WhatsApp no existe o no está aprobada en ese idioma. Revise el nombre en Configuración → WhatsApp',
  132005: 'El texto de la plantilla quedó demasiado largo',
  132007: 'El contenido de la plantilla no cumple las políticas de WhatsApp',
  132012: 'Un dato de la plantilla no tiene el formato esperado',
  132015: 'La plantilla de WhatsApp está pausada por baja calidad. Revísela en Meta',
  132016: 'La plantilla de WhatsApp está desactivada. Revísela en Meta',
  // Cuenta y acceso
  368: 'Meta bloqueó temporalmente los envíos de la cuenta por incumplir políticas',
  190: 'El token de acceso de WhatsApp venció o no es válido. Actualícelo en Configuración → WhatsApp',
  10: 'La aplicación de Meta no tiene permiso para enviar con este número',
  100: 'Meta rechazó un dato del envío (parámetro no válido)',
  80007: 'Se llegó al límite de uso de la cuenta de WhatsApp. Intente más tarde',
};

/** Texto claro para un código de Meta (con el código y el detalle original al final). */
export function errorClaro(codigo, detalle = '') {
  const c = Number(codigo);
  const claro = ERRORES[c];
  if (!claro) return `${c ? `${c}: ` : ''}${detalle || 'Meta no pudo entregar el mensaje'}`.slice(0, 500);
  return `${claro} (código ${c}${detalle ? ` · ${detalle}` : ''})`.slice(0, 500);
}

/** Aclara un error ya guardado con la forma «131026: Message Undeliverable.». Lo demás queda igual. */
export function aclararError(texto) {
  const m = /^(\d{2,6}):\s*(.*)$/s.exec(String(texto || ''));
  return m && ERRORES[Number(m[1])] ? errorClaro(m[1], m[2].trim()) : String(texto || '');
}
