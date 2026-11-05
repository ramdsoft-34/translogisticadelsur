# Relaciones de cobro (fase 11)

La relación junta **todos los viajes de una empresa (cliente) en la quincena o el mes**, de todos los conductores, y se cobra
con el formato de la plantilla de Excel. Ya no hay bitácora aparte que cuadrar: la relación sale de los viajes registrados.

## Pantallas (Relaciones)

- **Programación por placa**: busca por placa **o por nombre del conductor**. Columnas nuevas «Cómo llegó» (RNDC, registro
  masivo, soporte interno) y «Reportado» (día en que se registró en la plataforma; avisa si fue más de 3 días después del viaje).
- **Registro masivo**: sábados desmarcados por defecto y **otro destino para algunos días** (✎ + «Aplicar a los marcados»).
  Los viajes quedan marcados como de registro masivo.
- **Generar relación**: empresa + periodo (quincenas y mes) + grupo (Viajeros, TAT… según el campo «Grupo de la relación» de
  cada destino en Clientes y tarifas). Revisión automática: fechas después del periodo registradas antes (¿quedó mal la fecha?,
  con botón para corregirla), viajes reportados tarde, mismo vehículo/día/destino dos veces, conductores con nombres casi
  iguales, municipio del manifiesto distinto al de la tarifa, viajes sin tarifa y viajes que ya están en otra relación.
  Vista previa con el formato del Excel y «Guardar relación» (número por empresa y año, p. ej. NP-2026-020).
- **Relaciones generadas**: Borrador → Enviada → Facturada (con N° de factura). Ver PDF, Excel, ✉ Correo, WhatsApp,
  Marcar facturada, Reabrir (administrador, con motivo) y Eliminar (solo borrador).

## Formato del Excel y el PDF

Encabezado con la franja del membrete o el logo + razón social + NIT; título; un bloque por conductor y placa con
N° · Nombre · Placa · Fecha · Planilla · Manifiesto · Destino · Días aux. · Tarifa · Auxiliar · Total; la franja con el nombre,
la placa y los viajes **después del último viaje**; un solo total general; firmas «Elaboró» y «Recibido». Sin subtotales ni
resumen por vehículo.

## Reglas

- Un viaje solo está en una relación guardada (no se cobra dos veces).
- **Facturada = cerrada**: sus viajes no se editan (salvo observaciones), no se eliminan ni se cobran en otra relación.
- Registrar un viaje en una placa que ya tiene viaje ese día pide confirmación (Viajes; no aplica a Manifiestos).

## Correo y WhatsApp

- Configuración → Correo → (empresa) → Relaciones: destinatarios, **asunto y mensaje propios** con datos
  `{saludo} {empresa} {periodo} {año} {grupo} {numero} {viajes} {total} {usuario} {transportadora} {enlace}` y **contactos de
  WhatsApp**. Plantilla general: «Relación de fletes {empresa} {periodo}».
- WhatsApp gratis (`wa.me`): el mensaje lleva el enlace `/r/<token>` para ver y descargar el PDF y el Excel; se anota cuándo lo abren.

## API

`/api/gestion/relaciones-cobro` (GET lista, POST guardar), `/previa`, `/grupos`, `/plantilla-general`, `/:id`, `/:id/archivo`,
`/:id/correo` (GET vista, POST enviar), `/:id/whatsapp`, `/:id/whatsapp/enviado`, `/:id/facturar`, `/:id/reabrir`, DELETE `/:id`,
`/viaje/:id/fecha`. Públicas: `/api/publico/relaciones/:token` y `/archivo`.
