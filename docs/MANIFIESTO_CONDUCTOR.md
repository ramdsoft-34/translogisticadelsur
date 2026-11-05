# Manifiesto para el conductor (fase 9)

El conductor recibe el manifiesto real (el mismo PDF que se descarga del RNDC) por un enlace propio, sin usuario ni clave.

## Cómo funciona

- **Manifiestos → Manifestados**: columna «WhatsApp conductor» (Por enviar · Enviado · Abierto · Sin celular) y botón
  «WhatsApp» en cada fila. Con varias filas marcadas: «WhatsApp a los conductores (n)». Se abre WhatsApp con el mensaje
  listo (enlace `wa.me`, sin costo); el usuario oprime enviar. Sin celular válido en la ficha del conductor no se puede enviar.
- **Enlace** `/m/<token>`: página pública con el estado del manifiesto y los botones Ver PDF / Descargar. Deja de servir si
  el manifiesto se anula, cuando el viaje se cumple o a los 30 días. Registra cuándo lo abrió el conductor.
- **Sur Track**: con «Mandar a Sur Track el enlace del manifiesto» (Configuración → Rastreo GPS), al activar el rastreo se
  envía `manifiesto: { numero, url }` en el viaje. Activarlo solo cuando Sur Track muestre el botón «Ver manifiesto».
- **Monitoreo → Historial**: manifiesto del viaje (enviado a Sur Track / WhatsApp abierto o no), checklist guardado y
  velocidad máxima; botón «Ver manifiesto» y recuadro «Documentos del viaje» en el seguimiento.
- **Tablero**: «Manifiestos sin enviar al conductor» (últimos 7 días).

## API

`POST /api/viajes/:id/manifiesto-conductor`, `POST /api/viajes/manifiesto-conductor/lote` (`{ ids }`),
`PUT /api/viajes/:id/manifiesto-conductor/enviado`. Públicas: `GET /api/publico/manifiestos/:token` y `/pdf`.

## Pendiente

- WhatsApp automático (API de Meta): requiere la cuenta verificada, la plantilla aprobada y el token en Configuración.
- Botón «Ver manifiesto» en la app de Sur Track (lo programa Sur Track).
