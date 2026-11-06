# PDF permanentes

Los documentos expedidos se generan **una sola vez**, se guardan en la carpeta privada del servidor (`ARCHIVO_DIR`,
en producción `/var/lib/translogistica/archivo`) y desde ahí se muestran, se envían por correo, a la app de conductores y por
WhatsApp. No se vuelven a generar ni se duplican. Cada uno queda registrado (colección `documentopdfs`) con su versión,
fecha, quién lo generó y su huella SHA-256: si el archivo se altera, no se entrega y se avisa.

**Nunca se reemplaza un archivo.** Un cambio permitido crea otra versión y la anterior se conserva.

## Cuáles son permanentes y desde cuándo

| Documento | Se guarda | Versión nueva cuando |
|---|---|---|
| Manifiesto del RNDC | Al abrirlo o enviarlo por primera vez después de aceptado | Se anula y se expide otro (otro número) |
| Remesa del RNDC | Igual que el manifiesto | Otro número |
| Soporte interno (MC/RC) | Al expedirse | Cambia su estado (vigente → cumplido / anulado): el documento imprime el estado |
| Liquidación a cliente | Al facturarse | Se anula (versión «ANULADA») |
| Liquidación de conductor | Al crearse (es la que va a la app) | Se anula (versión «ANULADA») |
| Remesa de clientes (fase 12) | Al imprimirse o descargarse marcándola | Se corrige un dato después de impresa (el número no se cambia) |
| Formato SG-SST | Cada versión final | Cada nueva versión final |
| Asistencia a capacitación | Al quedar ejecutada | Llega otra firma (p. ej. desde la app) |
| Constancia de EPP | Cuando todas las entregas están firmadas | Hay otra entrega firmada |
| Preoperacional | Al verlo por primera vez | Se autoriza la salida de un «No apto» |

**No se guardan** (se generan cada vez porque son consultas o borradores): bitácora, informes, listados, el estado de
cuenta de los préstamos (cambia con cada abono), borradores, vistas previas y formatos en blanco.

Las hojas de 2 por hoja (remesas de clientes y liquidaciones de conductores) se arman con los PDF guardados de cada
documento (`services/documentos/componer.js`), sin volver a generarlos.

## Documentos de antes de este cambio

Se congelan la primera vez que se abren o envían después del cambio, con los datos de ese día (no hay copia de cómo
salieron antes).

## Respaldo

La carpeta `ARCHIVO_DIR` se respalda todos los días junto con la base (`/etc/cron.d/tls-backup`, 14 días):

```
35 3 * * * root tar -czf /var/backups/translogisticadelsur/archivo-$(date +\%F).tgz -C /var/lib/translogistica archivo && find /var/backups/translogisticadelsur -name "archivo-*.tgz" -mtime +14 -delete
```

## Código

`models/documentos.js` (registro), `services/documentos/guardados.js` (guardar, leer y verificar),
`services/documentos/expedidos.js` (manifiesto, remesa, soporte y liquidaciones), `services/documentos/componer.js`
(2 por hoja). La pantalla muestra «Documento guardado el … · versión N» en el visor de PDF.
