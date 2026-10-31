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

## Fase 2 (rama `csalcedo17`)

Pestañas nuevas en Contabilidad: **Proveedores**, **Compras**, **Egresos** y **Conciliación bancaria**, y la tabla de retenciones en **Parámetros**.

- **Proveedores con datos fiscales**: NIT y DV, régimen, responsable de IVA, declarante de renta, autorretenedor, gran contribuyente, ReteICA por mil, retención habitual, cuenta habitual del gasto y cuenta bancaria. Colección `ProveedorCont`.
- **Compras (causación)**: factura electrónica, documento soporte, cuenta de cobro u otro soporte. Una o varias líneas con su cuenta (gasto 5, costo 6/7, activo 15–19, anticipo 1330) y su IVA. Calcula retefuente, ReteIVA y ReteICA y registra el asiento `CMP`:
  - débito a la cuenta de cada línea (con el IVA como mayor valor; o IVA descontable `240810` si la empresa es responsable de IVA);
  - créditos a `2365` retefuente, `2367` ReteIVA, `2368` ReteICA y `2335` por el neto a pagar.
  - No deja causar dos veces la misma factura del proveedor ni el mismo CUFE. Una compra con pagos no se anula.
- **XML de la DIAN**: se carga el XML (factura sola o el `AttachedDocument` que llega por correo) y se llenan número, CUFE, fechas, proveedor (con gran contribuyente O-13 y autorretenedor O-15), líneas por tarifa de IVA y total. Si el proveedor no existe se crea con un clic. El XML queda guardado como soporte y se puede descargar.
- **Retenciones**: tabla del Decreto 572 de 2025 (compras 2,5 % / 3,5 % desde 10 UVT; servicios 4 % / 6 % desde 2 UVT; transporte de carga 1 %; honorarios 11 % / 10 %; arrendamientos; combustibles), UVT 2026 = $ 52.374. Al autorretenedor no se le retiene; al no declarante se le aplica la tarifa de no declarante; por debajo de la base mínima no hay retención. La empresa puede cambiar tarifas y bases en Parámetros y la contadora puede cambiar las de una compra a mano.
- **Comprobantes de egreso** (`CE-0001`, asiento `EGR`): pagan una o varias compras de un proveedor (pagos parciales) y otros conceptos (anticipos, etc.). Registra el 4x1000 (`530505`) si sale de bancos. PDF con valor en letras, contabilización y firmas; envío por correo con la cuenta de la empresa; WhatsApp con el mensaje listo y el PDF descargado para adjuntarlo. Anular el egreso devuelve el saldo a las compras.
- **Conciliación bancaria**: se pega el extracto desde Excel (fecha, descripción, valor o retiro/consignación) y se cruza con los movimientos de la cuenta (1110 u otra 11xx) por valor y fecha cercana. Muestra lo que está en libros y no en el banco (incluye lo pendiente del mes anterior), lo que está en el banco y no en libros (con botón para registrar el gasto bancario) y la diferencia. Se guarda como borrador o se cierra cuando la diferencia es cero.
- **Informes y resumen**: «Por pagar a proveedores» (`cxpProv`), retenciones con 2367, 2368 y 240810, y el saldo por pagar a proveedores en el resumen.
- Cuentas nuevas en el plan base: `2367`, `240810`, `5130`, `5140`, `5155`.

## Pruebas

`backend/test/contabilidad.test.js` y `backend/test/compras.test.js` (necesitan MongoDB local, como las demás pruebas; las reglas puras de retenciones, XML y conciliación no la necesitan):

```
cd backend && npm test
```

Antes de pasar la rama a `main`, correr todas las pruebas y revisar con el contador el modelo de ingresos y el plan de cuentas.

## Siguientes fases

3. Impuestos por pagar, borradores 350 e ICA con vencimientos, exógena y certificados, factura electrónica de transporte con remesas y envío al RNDC (procesoid 86).
4. Nómina y provisiones, activos y depreciación, cierre anual, documento soporte, notas crédito/débito y nómina electrónica.
