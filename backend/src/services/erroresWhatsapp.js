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

// ── Causa de cada error y cómo corregirla ──
// Cada envío fallido guarda su causa (un código estable), así la pantalla explica qué pasó, propone solo la corrección
// que corresponde y reconoce el mismo problema la próxima vez. Acciones posibles en la ventana de corrección:
//   celular: corregir el celular del conductor · autorizar: registrar que el conductor autorizó WhatsApp
//   reintentar: volver a enviar · viaje: cambiar el conductor del viaje · config: revisar la cuenta (administrador)
const C = (titulo, explicacion, pasos, acciones) => ({ titulo, explicacion, pasos, acciones });
export const CAUSAS = {
  sin_autorizacion: C('El conductor no ha autorizado WhatsApp',
    'Por la ley de protección de datos, solo se le envían documentos por WhatsApp a quien lo autorizó. Este conductor no tiene registrada esa autorización.',
    ['Confirme con el conductor que acepta recibir sus manifiestos por WhatsApp.', 'Marque la autorización y presione «Guardar y reenviar».'], ['autorizar', 'celular']),
  celular_invalido: C('El celular del conductor no es válido',
    'Para WhatsApp se necesita un celular colombiano de 10 dígitos que empiece por 3. El que está registrado falta o tiene otro formato.',
    ['Escriba el celular correcto del conductor (10 dígitos).', 'Presione «Guardar y reenviar».'], ['celular', 'autorizar']),
  sin_conductor: C('El viaje no tiene un conductor reconocido',
    'El documento se envía al conductor del viaje, y este viaje no tiene uno registrado en Conductores y terceros.',
    ['Abra el viaje en «Expedir» o en Viajes y elija el conductor.', 'Luego vuelva a enviar el WhatsApp.'], ['viaje']),
  no_entregado: C('WhatsApp no pudo entregar el mensaje a ese celular',
    'Meta no lo entregó: ese número no tiene WhatsApp activo, la persona no ha aceptado los términos nuevos de WhatsApp, usa una versión muy vieja de la aplicación o bloqueó el número de la empresa.',
    ['Confirme el número con el conductor y pídale que abra y actualice WhatsApp.', 'Si el número cambió, corríjalo y presione «Guardar y reenviar»; si es el mismo, presione «Reintentar» cuando el conductor lo confirme.'], ['celular', 'reintentar']),
  rechazo_conductor: C('El conductor pidió no recibir estos mensajes',
    'La persona bloqueó o pidió no recibir mensajes de este tipo de la empresa. No se le debe insistir.',
    ['Hable con el conductor. Si vuelve a aceptar, presione «Reintentar».'], ['reintentar']),
  limite: C('Se enviaron demasiados mensajes seguidos',
    'WhatsApp limitó los envíos por un momento (al mismo celular o a toda la cuenta).',
    ['Espere unos minutos y presione «Reintentar».'], ['reintentar']),
  archivo: C('No se pudo adjuntar el PDF',
    'WhatsApp no pudo subir o descargar el PDF del documento. Suele ser una falla momentánea.',
    ['Presione «Reintentar».'], ['reintentar']),
  plantilla: C('Problema con la plantilla de WhatsApp',
    'La plantilla aprobada en Meta no existe, está pausada o no coincide con los datos que se envían.',
    ['El administrador debe revisar la plantilla en Configuración → WhatsApp y en Meta.', 'Después, presione «Reintentar».'], ['config', 'reintentar']),
  cuenta: C('Problema con la cuenta de WhatsApp de la empresa',
    'Meta no dejó enviar con esta cuenta (permisos, token vencido, número no registrado, pago o bloqueo).',
    ['El administrador debe revisar Configuración → WhatsApp (y el administrador comercial de Meta).', 'Cuando esté resuelto, presione «Reintentar».'], ['config', 'reintentar']),
  no_vigente: C('El documento ya no está vigente',
    'El manifiesto o el soporte interno se anuló o se reemplazó, así que no se envió.',
    ['Si hay un documento nuevo, envíelo desde su viaje.'], []),
  meta: C('WhatsApp tuvo una falla al enviar',
    'Meta respondió con un error que no es de los datos del conductor.',
    ['Presione «Reintentar». Si se repite, avise al administrador con el detalle de abajo.'], ['reintentar']),
};
// Envíos del manifiesto a un número del cliente: la corrección no es del conductor sino del número en Clientes
//   cliente: corregir o apagar el número en Clientes → WhatsApp de manifiestos
CAUSAS.numero_inactivo = C('Ese número ya no está activo en el cliente',
  'El número se apagó o se quitó en Clientes mientras el envío esperaba, así que no se envió.',
  ['Si debe recibirlo, actívelo en Clientes → WhatsApp de manifiestos y envíe de nuevo desde el viaje.'], ['cliente']);
const CAUSAS_CLIENTE = {
  no_entregado: C('WhatsApp no pudo entregar el mensaje a ese número del cliente',
    'Meta no lo entregó: ese número no tiene WhatsApp activo, no ha aceptado los términos nuevos de WhatsApp o bloqueó el número de la empresa.',
    ['Confirme el número con el cliente.', 'Si cambió, corríjalo en Clientes → WhatsApp de manifiestos; si es el mismo, presione «Reintentar» cuando el cliente lo confirme.'], ['cliente', 'reintentar']),
  rechazo_conductor: C('El cliente pidió no recibir estos mensajes',
    'Ese número bloqueó o pidió no recibir mensajes de este tipo de la empresa. No se le debe insistir.',
    ['Hable con el cliente. Si vuelve a aceptar, presione «Reintentar»; si no, apague el número en Clientes.'], ['cliente', 'reintentar']),
  celular_invalido: C('El número del cliente no es válido',
    'Para WhatsApp se necesita un celular colombiano de 10 dígitos que empiece por 3.',
    ['Corrija el número en Clientes → WhatsApp de manifiestos y envíe de nuevo desde el viaje.'], ['cliente']),
  plantilla: C('Problema con la plantilla de WhatsApp para clientes',
    'La plantilla del manifiesto al cliente no existe, no está aprobada o no coincide con los datos que se envían.',
    ['El administrador debe revisar la plantilla para clientes en Configuración → WhatsApp y en Meta.', 'Después, presione «Reintentar».'], ['config', 'reintentar']),
};
/** Explicación de una causa según a quién iba el envío (conductor o cliente). */
export const explicacionDe = (causa, para = 'conductor') => (para === 'cliente' && CAUSAS_CLIENTE[causa]) || CAUSAS[causa] || CAUSAS.meta;

const POR_CODIGO = {
  131026: 'no_entregado', 131050: 'rechazo_conductor', 131049: 'limite', 131056: 'limite', 130429: 'limite', 131048: 'cuenta', 80007: 'limite',
  131052: 'archivo', 131053: 'archivo', 131009: 'celular_invalido',
  132000: 'plantilla', 132001: 'plantilla', 132005: 'plantilla', 132007: 'plantilla', 132012: 'plantilla', 132015: 'plantilla', 132016: 'plantilla',
  10: 'cuenta', 190: 'cuenta', 368: 'cuenta', 131005: 'cuenta', 131031: 'cuenta', 131042: 'cuenta', 131045: 'cuenta', 131057: 'cuenta', 133010: 'cuenta', 131021: 'cuenta',
};
export const causaDeCodigo = (codigo) => POR_CODIGO[Number(codigo)] || 'meta';

/** Causa de un error guardado como texto (envíos anteriores a guardar la causa). */
export function causaDeTexto(texto) {
  const t = String(texto || '');
  const codigo = /\(c[oó]digo (\d+)/i.exec(t)?.[1] || /^(\d{2,6}):/.exec(t)?.[1];
  if (codigo) return causaDeCodigo(codigo);
  if (/no ha autorizado/i.test(t)) return 'sin_autorizacion';
  if (/celular v[aá]lido|10 d[ií]gitos/i.test(t)) return 'celular_invalido';
  if (/no tiene conductor|No se encontr[oó] a/i.test(t)) return 'sin_conductor';
  if (/ya no est[aá] vigente|Reemplazado/i.test(t)) return 'no_vigente';
  return t ? 'meta' : '';
}
