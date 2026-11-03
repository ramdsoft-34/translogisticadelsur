# Integración con el RNDC

Este documento resume lo que se verificó en la documentación oficial del Ministerio de Transporte, cómo lo usa la plataforma y qué queda pendiente.

## Fuentes oficiales consultadas

| Documento | Uso |
|---|---|
| **Guía uso del Web Service en el RNDC**, versión 4 (PLC, 22/06/2023) | Endpoints, WSDL, tipos de solicitud, consultas y ejemplos de remesa y manifiesto |
| **Manual RNDC Web-Service** v3.0 (2020-06-01) | Seguridad y usuarios (cap. 7), procesos paso a paso (cap. 8), consultas (cap. 9), anulaciones (cap. 10) y diccionario de datos (cap. 12) |
| Herramienta oficial `https://rndc.mintransporte.gov.co/wstest/` | Lista de procesos del web service. Requiere usuario y contraseña. |

## Protocolo verificado

- **Servicio:** SOAP 1.1 rpc/encoded.
  - Método: `AtenderMensajeRNDC`, con un parámetro `Request` de tipo string.
  - SOAPAction: `urn:BPMServicesIntf-IBPMServices#AtenderMensajeRNDC`.
- **Endpoints:**
  - Producción: `http://rndcws.mintransporte.gov.co:8080/soap/IBPMServices`.
  - Contingencia: `http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices`.
  - Pruebas: `http://plc.mintransporte.gov.co:8080/soap/IBPMServices`.
- **Mensaje:** XML en ISO-8859-1.
  - Estructura: `<root><acceso/><solicitud><tipo/><procesoid/></solicitud><variables/>…</root>`.
  - Si se acepta, responde `<ingresoid>`, que es el radicado.
  - Si hay error, responde `<ErrorMSG>`.
  - El manifiesto devuelve además `<seguridadqr>` y, a veces, `<observacionesqr>`.
- **Tipos de solicitud:**
  - 1: registrar.
  - 2: consultar maestros.
  - 3: consultar documentos. En este tipo, `<variables>` lleva la lista de campos a devolver, `<documento>` lleva los filtros y `<documentorango>` permite un rango de `FECHAING`.

## Requisitos de acceso (los gestiona cada empresa)

1. La empresa debe estar **habilitada por el Ministerio de Transporte** como empresa de transporte de carga.
2. El **representante legal** tiene el usuario principal en el RNDC. Desde ahí crea los **usuarios delegados** que usan el web service (manual, 7.1).
3. **Ambiente de pruebas:** el manual v3.0 (7.2) dice que se entra con los mismos usuarios de producción, pero con la clave `PruebasRNDC`. La guía v4 dice que se usan "los mismos usuarios y contraseñas". Hay que confirmar con el Ministerio cuál aplica hoy.
4. **Antes de expedir documentos** deben existir en el RNDC:
   - los terceros: conductor, titular, propietario, tenedor, remitente y destinatario;
   - los vehículos.

## Procesos implementados

| Proceso | ID | Dónde se usa en la plataforma |
|---|---|---|
| Tercero | 11 | Conductores y terceros → «RNDC». Solo se envía si los datos cambiaron, porque el RNDC responde DUPLICADO a lo idéntico (manual 8.1). |
| Vehículo | 12 | Vehículos → «RNDC», con la misma regla de cambios. |
| Remesa terrestre de carga | 3 | Manifiestos → «Enviar». Expide la remesa y luego el manifiesto. |
| Manifiesto de carga | 4 | Incluye el bloque `REMESASMAN` (proceso 43) y, en un reemplazo, `MANNROMANIFIESTOTRANSBORDO` (manual 8.9.2). |
| Cumplido de remesa | 5 | Manifiestos → «Cumplir» (entradas al cargue y al descargue; llegada y salida si el punto no se monitoreó). |
| Cumplido de manifiesto | 6 | Manifiestos → «Cumplir». |
| Anular remesa | 9 | Por enviar → «Anular remesa». El RNDC solo lo permite dentro de la primera hora y si la remesa no tiene manifiesto vigente. |
| Anular manifiesto | 32 | Manifestados → «Anular». Los motivos R, T, G, C y V quedan marcados como reemplazo. |
| Anular cumplido de remesa | 28 | Cumplidos → «Anular cumplido». |
| Anular cumplido de manifiesto | 29 | Cumplidos → «Anular cumplido». |
| Consultas tipo 2 y 3 | 11, 12, 3, 4, 5, 6 | Consultas RNDC. Permite filtros y rango de fechas. |

**Validación previa al envío.** Las variables se validan contra el **diccionario de datos oficial** (`backend/src/services/rndc/diccionario.js`, generado del capítulo 12): obligatorios, tamaño máximo, formato numérico y fechas `dd/mm/aaaa`. Si falta algo, la plataforma no envía nada y muestra la lista de faltantes.

**Ajustes al diccionario.** Se hicieron estos ajustes, cada uno con su fuente:

- `CODMUNICIPIODESTMANIFIESTO` se usa como `CODMUNICIPIODESTINOMANIFIESTO`, que es el nombre de los ejemplos del manual y de la guía.
- El segundo conductor (`CODIDCONDUCTOR2` y `NUMIDCONDUCTOR2`) se trata como opcional.
- `NUMMANIFIESTOCARGA` del proceso 6 se trata como alfanumérico de 15 caracteres, igual que en el proceso 4.
- Se agregaron las variables de los ejemplos que el diccionario v3.0 no lista:
  - `CODMUNICIPIOPAGOSALDO`, `RETENCIONFUENTEMANIFIESTO` y `CODSEDEPROPIETARIO`;
  - las del propietario de la carga en la remesa.

**Valores por empresa.** Se configuran en Configuración → «Conexión RNDC y valores»: póliza, mercancía, tiempos pactados, responsables de pago, FOPAT, etc. Las variables adicionales que el RNDC exija a una empresa en particular se agregan en «Variables adicionales», sin tocar código.

**Código QR del manifiesto PDF.** Sigue el manual 8.6.6:

- Datos en este orden: MEC, Fecha, Placa, Remolque (solo si hay), Config, Orig, Dest, Mercancia, Conductor, Empresa, Obs (solo si el RNDC las entregó) y Seguro.
- Separados por CR+LF y sin tildes.

## Cumplidos con la guía de 2026 y tiempos logísticos (fase 7)

Fuentes: *Guía Cumplido de Remesa y Manifiesto V1* (Ministerio de Transporte, 2 de junio de 2026) y *Guía de registro de tiempos logísticos V2* (monitoreo de flota, Resolución 20243040058015).

- **Cumplido de remesa (5):** la empresa reporta la **entrada al cargue** y la **entrada al descargue**. La llegada y la salida de cada punto las reporta la empresa de monitoreo de flota (registro de monitoreo de manifiesto). Si un punto no se monitoreó (sede sin coordenadas, novedad RNMM o incumplimiento de la empresa de monitoreo), la empresa escribe también su llegada y salida (guía de tiempos, numeral 11). En la ventana de cumplido hay una casilla por punto: «La empresa de monitoreo reportó…».
- **Mercancía consolidada con recolección o distribución en varios puntos:** no aplica el monitoreo; el RNDC usa 1 h de cargue + 1 h de descargue. Solo van las dos entradas.
- **Horas propuestas** (`GET /api/rndc/viajes/:id/cumplido/propuesta`, servicio `services/rndc/tiemposCumplido.js`): GPS de Sur Track (inicio del viaje, llegada a menos de 1 km del destino, primera y última entrega) y, si no hay, los tiempos del destino: cita de cargue, tiempo pactado, tiempo de viaje de la ruta, espera y cita de descargue. Si llega antes de la cita, entra a la cita. Siempre las revisa una persona.
- **Revisión antes de enviar**, como el RNDC: llegada ≤ entrada ≤ salida, nada en el futuro y máximo 90 km/h (km de la ruta ÷ horas entre la salida del cargue y la llegada al descargue). Muestra el plazo del cumplido del manifiesto: 5 días hábiles desde la entrega (no descuenta festivos).
- **Cumplido en lote:** cada viaje con sus propias horas propuestas (`usarPropuesta`), en lugar de las mismas horas para todos.
- **Cumplido de manifiesto (6):** adicionales por tiempo de cargue y de descargue, y `RETENCIONFOPAT` (0,1 % del nuevo valor a pagar) solo si el vehículo lo lleva (peso bruto > 10,5 t y «Aplicar FOPAT» en Configuración).
- **Por destino (Clientes → destino):** tipo de operación de la remesa (G, P mercancía consolidada, C, V), tipo de consolidación (R recolección, D distribución, A ambas, N normal), empaque, citas, tiempos pactados (en minutos), tiempo de viaje, espera, km y si cada punto lo monitorea la empresa de monitoreo. Vacío = lo de la empresa. Lo del destino reemplaza las variables adicionales fijas de la empresa (`TIPOCONSOLIDADA`).
- **Por confirmar en el ambiente de pruebas del RNDC:** el código de «Mercancía consolidada» (se usa `P`) y los de consolidación R/A/N (la plantilla de la cooperativa usa `D` para distribución), y los códigos de motivo de los valores adicionales y descuentos del cumplido del manifiesto.

## Seguridad

- **Contraseña del usuario web service:** se pide en cada operación (o se recuerda solo en memoria mientras la pestaña está abierta). **Nunca se guarda**, ni en la base de datos ni en el navegador.
- **Registro de envíos:** cada envío queda en `TransaccionRndc` con la solicitud (contraseña reemplazada por `*****`), la respuesta, el radicado, el usuario y la duración.
- **Ambientes:** cada empresa elige SIMULADO, PRUEBAS o PRODUCCIÓN. El servidor bloquea los ambientes oficiales salvo que se habiliten con `RNDC_PERMITIR_PRUEBAS=true` y `RNDC_PERMITIR_PRODUCCION=true`. Así se evitan envíos reales desde equipos de desarrollo.
- **Doble envío:** un bloqueo por viaje evita que dos usuarios despachen el mismo viaje al mismo tiempo.

## Simulador local

`npm run simulador` (en `backend/`) levanta `tools/rndcSimulador.js` en el puerto 4010.

- **Qué reproduce:** el protocolo SOAP oficial, las validaciones de obligatorios del diccionario, DUPLICADO, el orden remesa → manifiesto → cumplidos y las anulaciones.
- **Para qué sirve:** las pruebas automáticas y la demostración.
- **Lo que no es:** **No es el RNDC.** Todas sus respuestas de error empiezan con «SIMULADOR:» y los documentos que "acepta" no tienen validez.

## Qué NO se ha verificado contra el RNDC real

No se tuvieron credenciales de una empresa habilitada, así que **ningún envío se probó contra el RNDC del Ministerio** (ni producción ni pruebas). Antes de usar producción:

1. Configure la empresa en ambiente **PRUEBAS**, con su usuario web service, en un servidor con `RNDC_PERMITIR_PRUEBAS=true`.
2. Registre en pruebas un tercero, un vehículo y un viaje completo (remesa, manifiesto, cumplidos), además de una anulación.
3. Revise en `TransaccionRndc` (Manifiestos → Historial) cualquier rechazo del RNDC. Ajuste los valores de la empresa o las «Variables adicionales» según el mensaje.
4. Confirme con el Ministerio los códigos propios de la empresa:
   - sedes;
   - código de mercancía;
   - aseguradora;
   - tipo de operación (`G`, `U`, …);
   - responsables de pago.

## No implementado (y por qué)

- **Información de carga (1), información de viaje (2) y cumplido inicial (45):** son opcionales en el flujo del manual. La plantilla de Excel tampoco los usaba.
- **Procesos municipales (81, 83 y siguientes), GPS/monitoreo (46, 60) y factura electrónica (86):** no estaban en la operación actual. Se pueden agregar con la misma arquitectura (`services/rndc/documentos.js` + `operaciones.js`).
- **Firma electrónica del manifiesto (8.6.7):** según el manual, se hace en el portal del RNDC y no por web service.

## Remesa como soporte interno para el cumplido (fase 7B)

En **Manifiestos**, el número de la remesa (aceptada o cumplida) abre su PDF con el formato que imprime el RNDC
(`GET /api/reportes/remesa/:id`, permiso de ver viajes). En la ventana de cumplido, **Ver remesa** la abre en otra pestaña
para consultarla sin cerrar el formulario. Es un soporte interno: no se envía por correo ni se adjunta a nada.

- El formato (cajas, líneas y rótulos) sale de `backend/src/assets/remesa-rndc.json`, generado con
  `python backend/tools/plantillaRemesa.py <remesa_del_RNDC.pdf> backend/src/assets/remesa-rndc.json`.
- Los datos son las variables de la remesa que el RNDC aceptó (proceso 3) y los maestros (remitente, destinatario y propietario por sede).
- Debajo va el recuadro **Para el cumplido**: viaje (manifiesto, placa, conductor, kilos), horas propuestas de cargue y descargue
  y de dónde salen (GPS de Sur Track, tarifa o citas), quién reporta cada punto (empresa de monitoreo o la empresa),
  plazo del cumplido del manifiesto y alertas de la revisión. Si la remesa ya se cumplió, muestra lo que se envió al RNDC.
- Las coordenadas de las sedes no están en la plataforma: la casilla sale vacía. Si el descargue no tiene coordenadas en el RNDC,
  desmarque «La empresa de monitoreo reporta el descargue» en la tarifa del destino.
