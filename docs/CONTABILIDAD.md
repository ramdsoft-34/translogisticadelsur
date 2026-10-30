# Contabilidad

Partida doble por empresa (con el aislamiento `tenantPlugin`). Los asientos de facturas, liquidaciones de conductores, préstamos y abonos se registran solos; en **Contabilidad** se facturan, cobran y pagan los documentos, se registran gastos y asientos manuales, y se consultan los libros. Es información de apoyo: un contador debe revisarla.

## Fase 1 (rama `csalcedo17`)

| Tema | Qué cambió |
|---|---|
| Permisos | Nuevos `contabilidad.ver` y `contabilidad.gestionar`. El rol **Contabilidad** los tiene ambos, **Consulta** solo el de ver y el **Administrador** todos. Las rutas `/api/gestion/contabilidad/*` ya no dependen de los permisos de liquidación. |
| Plan de cuentas | Plan base para S.A.S. con 54 cuentas: 2815/281505/281510 (ingresos para terceros), 4145 (comisión), 2368, 2408, nómina, depreciación, capital 3105, utilidad o pérdida 3605/3610, cuenta puente 3910, entre otras. Las cuentas que falten se agregan solas a cada empresa y las existentes no se tocan. Los gastos aceptan subcuentas de 6 dígitos (p. ej. 530505). |
| Modelo de ingresos | `Empresa.contabilidad.modeloIngresos`: **bruto** (por defecto, igual que antes: 4135 y costo 6155) o **terceros** (art. 102-2 E.T.). Con terceros la factura lleva `1305 neto · 1355/1356 retenciones · 281505 fletes · 281510 auxiliares · 4145 comisión`, y la liquidación del conductor debita 281505/281510 en vez de 6155. Se cambia en **Contabilidad → Parámetros**. |
| Facturar escogiendo viajes | `GET /contabilidad/facturas/viajes?cliente&desde&hasta` lista los viajes por facturar con su cobro, la parte para terceros y la propia. `POST /contabilidad/facturas` acepta `viajes: [ids]`. Cada viaje queda marcado con `facturaCont` y **no se puede facturar dos veces**. Al anular la factura se liberan. |
| Documentos sin asiento | El asiento se valida (mes abierto, cuentas, cuadre) **antes** de numerar y crear la factura o la liquidación. Si la factura no se puede guardar, su asiento se anula. |
| Anulaciones | Anular un asiento de **cobro** devuelve el saldo a la factura; uno de **pago**, a la liquidación. Los asientos de factura, liquidación, préstamo y abono solo se anulan desde su documento. |
| Informes | Saldos con agregaciones de MongoDB (no se cargan todos los asientos en memoria). Nuevos: **libro mayor** (`informes/mayor?nivel=1|2|4|6`) y **auxiliar** (`informes/auxiliar?cuenta=1305&tercero=NIT`), con Excel. Las cuentas correctoras (depreciación acumulada, pérdidas) restan dentro de su grupo en el balance. |
| Saldos iniciales | `POST /contabilidad/saldos-iniciales { fecha, filas: [{ cuenta, terceroDoc, tercero, documento, debito, credito }] }`. En pantalla se pegan las filas desde Excel. Se registra un asiento por tercero y documento contra la cuenta puente 3910, que queda en cero. Se cargan una sola vez; para corregir, se anulan en el libro diario. |

## Pruebas

`backend/test/contabilidad.test.js` (necesita MongoDB local, como las demás pruebas):

```
cd backend && npm test
```

Antes de pasar la rama a `main`, correr todas las pruebas y revisar con el contador el modelo de ingresos y el plan de cuentas.

## Siguientes fases

2. Cuentas de cobro con soportes, egresos por tercero con comprobante (WhatsApp/correo), compras desde el XML de la DIAN, conciliación bancaria y terceros con datos fiscales (DV, régimen, responsabilidades).
3. Impuestos por pagar, borradores 350 e ICA con vencimientos, exógena y certificados, factura electrónica de transporte con remesas y envío al RNDC (procesoid 86).
4. Nómina y provisiones, activos y depreciación, cierre anual, documento soporte, notas crédito/débito y nómina electrónica.
