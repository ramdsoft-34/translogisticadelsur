# Firma de capacitaciones por WhatsApp (fase 10)

Cada asistente firma su asistencia desde el celular con un enlace propio, sin usuario ni clave.

## Cómo funciona

- **SST → Capacitaciones** (capacitación ya guardada): botón «Firmar por WhatsApp (n)» para los que no han firmado y botón
  por asistente («Firmar por WhatsApp» / «Reenviar enlace»). Se abre WhatsApp (`wa.me`, sin costo) con el mensaje listo.
  Chips por asistente: Enviado · Abierto · Firmó desde el celular. Sin celular válido en la ficha no se puede enviar.
- **Enlace** `/f/<token>`: el asistente confirma los 4 últimos dígitos de su documento (5 intentos; luego se bloquea y hay
  que reenviar), marca «Asistí», firma con el dedo y puede compartir la ubicación. Vale hasta 15 días después de la
  capacitación; no sirve si la capacitación está cancelada.
- **Evidencia (Ley 527 de 1999, Decreto 2364 de 2012)**: fecha y hora, IP, navegador, ubicación si la autorizó y huella
  SHA-256 de lo firmado. Sale en la planilla SST-FOR-07, recuadro «Firmas electrónicas desde el celular».
- Guardar la capacitación desde la pantalla no borra ni reemplaza las firmas hechas desde el celular.

## API

`POST /api/sst/capacitaciones/:id/firma-remota` (`{ asistentes?: [ids] }`), `PUT /api/sst/capacitaciones/:id/firma-remota/:aid/enviado`.
Públicas: `GET /api/publico/firmas/:token` y `POST /api/publico/firmas/:token`.
