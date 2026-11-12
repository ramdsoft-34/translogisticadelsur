# Fase 15 · Soportes de anticipos

En **Viajes** hay dos pestañas: **🚚 Viajes** (la de siempre) y **💵 Soportes de anticipos**. El menú no cambia.

## Cómo funciona

1. La oficina abre **Viajes › Soportes de anticipos** y toca **Enviar enlace al mensajero** (nombre, cédula y celular).
   Al mensajero le llega por WhatsApp un enlace `/a/<token>` que sirve solo para los viajes de esa fecha de cargue y vence al día siguiente.
2. El mensajero entra con su cédula (sin usuario ni contraseña; 5 intentos y el enlace se bloquea), ve los anticipos del día,
   copia la cuenta (Nequi, Bancolombia… de la ficha del conductor, o del titular si tiene cuenta), paga y toca:
   - **📷 Subir soporte**: toma la foto del comprobante; la página la reduce antes de subirla.
   - **💵 Efectivo**: el conductor firma con el dedo y la página arma un recibo con la placa, el valor, la fecha y la firma.
3. Al conductor le llega **un solo mensaje**: la imagen y una descripción corta:

   > Hola Harold 👋, COOESPATRANS le consignó el anticipo de su viaje:
   > 🚚 WPU514 · DSierra → Tumaco 5.0
   > 📅 Fecha de cargue: 11/11/2026
   > 💵 Anticipo: $ 800.000
   > Soporte en la imagen. Buen viaje.

4. En **Viajes** cada viaje con anticipo muestra el chip 💵 (Sin soporte, ✓ Enviado, ✓✓ Entregado, ✓✓ Leído, Sin leer +2 h).
   En la pestaña de anticipos está el detalle: forma de pago, foto del soporte, quién pagó y el estado del WhatsApp.
   Si el conductor no lo lee en 2 horas, la fila se pone roja y la oficina puede **Confirmar a mano**.

La fecha de cargue es la fecha del viaje (la del reporte en la página).

## WhatsApp Business (Meta)

Sin configurar, la plataforma no envía sola: después de subir el soporte, el mensajero toca **Compartir por WhatsApp**
(su celular abre WhatsApp con la imagen y el texto) y la oficina confirma a mano.

Para el envío automático con chulitos de leído, el administrador configura en el servidor:

| Variable | Qué es |
|---|---|
| `WHATSAPP_TOKEN` | Token permanente del usuario del sistema (Meta Business) |
| `WHATSAPP_PHONE_NUMBER_ID` | Id del número que envía |
| `WHATSAPP_APP_SECRET` | Secreto de la app (valida la firma del webhook) |
| `WHATSAPP_VERIFY_TOKEN` | Palabra para registrar el webhook |
| `WHATSAPP_PLANTILLA_ANTICIPO` | Nombre de la plantilla (por defecto `soporte_anticipo`) |
| `WHATSAPP_IDIOMA` | Idioma de la plantilla (por defecto `es`) |

**Webhook:** `https://<dominio>/api/whatsapp/webhook`, suscrito al campo `messages` (trae los estados enviado, entregado y leído).

**Plantilla** (categoría Utilidad), encabezado **Imagen** y cuerpo:

```
Hola {{1}} 👋, {{2}} {{3}} el anticipo de su viaje:

🚚 {{4}} · {{5}}
📅 Fecha de cargue: {{6}}
💵 Anticipo: {{7}}

Soporte en la imagen. Buen viaje.
```

`{{1}}` nombre del conductor · `{{2}}` empresa · `{{3}}` «le consignó» o «le entregó en efectivo» · `{{4}}` placa ·
`{{5}}` cliente → destino · `{{6}}` fecha de cargue · `{{7}}` valor.

Si el conductor tiene apagada la confirmación de lectura, el estado queda en ✓✓ Entregado y se confirma a mano.

## Rutas

- `GET /api/anticipos?fecha=` lista del día, resumen y enlaces · `POST /api/anticipos/enlace` · `DELETE /api/anticipos/enlace/:id`
- `POST /api/anticipos/:viaje/soporte` (la oficina también puede subirlo) · `POST /api/anticipos/:viaje/confirmar` · `GET /api/anticipos/:viaje/imagen`
- Público del mensajero: `GET /api/a/:token` · `POST /api/a/:token/ingresar` · `GET /api/a/:token/viajes` · `POST /api/a/:token/viajes/:viaje/soporte` (encabezado `X-Sesion-Mensajero`)
- `GET|POST /api/whatsapp/webhook`

Código: `backend/src/models/anticipos.js`, `services/anticipos.js`, `services/whatsappMeta.js`, `routes/anticipos.js`,
`frontend/src/app/shared/anticipos-dia.ts`, `shared/imagen-soporte.ts`, `pages/mensajero-anticipos.ts`. Pruebas: `backend/test/anticipos.test.js`.
