# Fase 14: Correo — el Gmail de cada usuario dentro de la plataforma

Menú **Operación › Correo** (`/correo`, permiso `viajes.ver`). Cada usuario conecta **su propio** Gmail y solo él ve su buzón.

## Qué hace
- **Leer:** carpetas (Recibidos, Destacados, Enviados, Borradores, Spam, Papelera), etiquetas propias con sus no leídos, búsqueda con la sintaxis de Gmail, filtros (no leídos, con adjuntos), conversaciones completas y descarga de adjuntos. Al abrir una conversación se marca como leída en Gmail.
- **Enviar:** redactar, responder (en el mismo hilo), responder a todos y reenviar, en una ventana flotante abajo a la derecha como la de Gmail (minimizar, pantalla completa, cerrar o descartar; en el celular ocupa toda la pantalla). Los correos salen desde la cuenta del usuario y quedan en sus «Enviados» de Gmail.
- **Adjuntar:** archivos del computador (hasta 20 MB cada uno, 24 MB en total) y **documentos de la plataforma**: se busca el viaje por placa, número o manifiesto y se marca el manifiesto o la remesa; el PDF se genera al enviar.
- **Vínculos:** cada correo se une solo a placas (ABC123 / ABC-123), números de manifiesto (8 dígitos, con o sin M) y clientes (por su nombre o por el viaje). Al responder, la plataforma propone los documentos de ese viaje. Clic en un vínculo = buscar todos los correos de esa placa, manifiesto o cliente.

## Seguridad
- Conexión con OAuth 2.0 de Google: la contraseña de Gmail nunca pasa por la plataforma.
- Se pide un solo permiso: `https://www.googleapis.com/auth/gmail.modify` (leer, marcar leído y enviar; no borra correos para siempre).
- Se guarda solo el *refresh token*, cifrado con AES-256-GCM (`utils/cifrado.js`, llave `CLAVE_CIFRADO` o derivada de `JWT_SECRET`). El token de acceso vive en memoria ~1 hora.
- El regreso de Google (`/api/gmail/oauth/callback`) se valida con un estado firmado que vence en 10 minutos (evita que otro sitio conecte una cuenta a nombre del usuario).
- El HTML de los correos se muestra en un `iframe` con `sandbox` (sin scripts ni formularios).
- «Desconectar» revoca el permiso en Google y borra el token. Los envíos quedan en la auditoría (`gmail_enviar`).

## Configuración (una vez, la hace el administrador del servidor)
1. En https://console.cloud.google.com crear un proyecto a nombre de la empresa y activar **Gmail API**.
2. **Pantalla de consentimiento OAuth:** tipo *Externo*, nombre «Translogística del Sur», correo de soporte, dominio `translogisticadelsur.com`, y el alcance `gmail.modify`.
3. **Credenciales › ID de cliente de OAuth › Aplicación web**, con URI de redireccionamiento autorizado:
   `https://translogisticadelsur.com/api/gmail/oauth/callback`
4. En el `.env` del servidor:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxxxxxx
   # Opcional si la URL pública es otra (por defecto URL_PUBLICA + /api/gmail/oauth/callback)
   GOOGLE_REDIRECT_URI=https://translogisticadelsur.com/api/gmail/oauth/callback
   ```
5. **Modo de prueba vs. producción:** `gmail.modify` es un alcance *restringido*. En modo de prueba funciona para hasta 100 usuarios agregados como «usuarios de prueba», pero Google pide volver a autorizar cada 7 días. Para quitar ese límite hay que pedir la verificación de Google (incluye una evaluación de seguridad de terceros).

Sin `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` la pantalla avisa que falta la configuración; el resto de la plataforma no cambia.

## API (`/api/gmail`)
`GET /estado` · `POST /conectar` · `GET /oauth/callback` (Google) · `DELETE /cuenta` · `GET /etiquetas` · `GET /hilos?etiqueta&q&filtro&pagina` · `GET /hilos/:id` · `POST /hilos/:id/leido` · `GET /mensajes/:id/adjuntos/:adj` · `GET /documentos?q` · `POST /enviar`.

Código: `models/gmail.js`, `services/gmail.js`, `routes/gmail.js` (montado en `app.js`), `frontend/src/app/pages/correo.ts`. Pruebas: `backend/test/gmail.test.js`.
