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

## Fase 3 (rama `csalcedo17`): tributario y fiscal

Pestaña **Tributario** en Contabilidad (rutas `/api/gestion/tributario/...`, servicio `services/gestion/tributario.js`):

- **Retención en la fuente (350, borrador)** del mes: retenciones de las compras agrupadas por concepto con su base (honorarios, servicios, transporte, arrendamientos, compras), otras retenciones registradas en 2365 (liquidaciones de conductores, asientos) y ReteIVA. Muestra el saldo contable de 2365 y 2367 para cuadrar.
- **ICA y ReteICA**: ICA de la empresa = ingresos de la clase 41 del periodo × tarifa por mil del municipio + avisos y tableros + sobretasa bomberil − ReteICA que practicaron los clientes (1356). Con ingresos para terceros la base es solo la comisión (4145). ReteICA practicado a proveedores, por proveedor.
- **Pago de impuestos** (asiento `IMP`, documento `IMP-<IMPUESTO>-<periodo>`): débito a 2365, 2367, 2368, 2412, 2408, 2404 o 2380; intereses a `530520`, sanción a `5315`; crédito a bancos o caja. Se anula desde el libro diario.
- **Calendario de vencimientos**: la contadora carga las fechas (DIAN según el último dígito del NIT y municipio). Avisa lo vencido y lo que vence en 7 días; queda «pagado» al registrar el pago de esa obligación y periodo.
- **Información exógena** (JSON o Excel para el prevalidador): 1001 pagos y retenciones (compras por concepto 5002/5004/5005/5007/5016 y fletes a conductores 5004), 1007 ingresos por cliente (con modelo de terceros: ingreso propio y lo recibido para terceros aparte), 1008 cuentas por cobrar y 1009 cuentas por pagar al 31 de diciembre. Calcula el DV del NIT.
- **Certificados de retención** en PDF por proveedor y año: fuente, IVA o ICA.
- **Factura electrónica de transporte**: se guarda el número y el CUFE (SHA-384, 96 caracteres) que da el proveedor tecnológico, y se descarga la **relación de remesas** (archivo plano del RNDC, Guía V11: facturador, adquirente, factura, CUFE, tipo de operación 12/13, radicado y consecutivo de la remesa, valor del flete, kilos) en .txt o Excel. El JSON trae también los ítems con las propiedades 01 (radicado), 02 (consecutivo) y 03 (flete) para el XML.
- Cuentas nuevas: `2412` ICA por pagar y `530520` intereses de mora.

## Fase 4 (rama `csalcedo17`): nómina, activos, cierre anual, documento soporte y notas

Pestaña **Nómina y activos** en Contabilidad (rutas `/api/gestion/nomina`, `/api/gestion/activos`, `/api/gestion/cierre-anual`; servicio `services/gestion/nomina.js`):

- **Empleados** (colección `Empleado`): salario ordinario o integral, contrato (indefinido, fijo, obra, aprendiz SENA), ingreso y retiro, nivel de riesgo ARL, EPS, pensión y caja.
- **Nómina** mensual (`2026-10`) o quincenal (`2026-10-Q1`): días proporcionales al ingreso o retiro y novedades (horas extras, bonificaciones, pagos no salariales, retención, otras deducciones).
  - Auxilio de transporte hasta 2 SMMLV; IBC entre 1 y 25 SMMLV (70 % en salario integral); salud y pensión del empleado 4 % + 4 %; fondo de solidaridad desde 4 SMMLV.
  - Aportes: pensión 12 %, ARL según nivel (0,522 % a 6,96 %), caja 4 %; salud 8,5 %, ICBF 3 % y SENA 2 % solo si no aplica la exoneración del art. 114-1 E.T. (menos de 10 SMMLV).
  - Provisiones: cesantías 8,33 %, intereses 1 %, prima 8,33 %, vacaciones 4,17 %.
  - Asiento `NOM` por concepto (5105xx) contra 2505, 237005, 237030, 237006, 237010, 2365, 1365 y 2510 a 2525. Pago del neto y de la planilla PILA (asientos `NPA`; si se anulan, la nómina vuelve a quedar pendiente).
  - Desprendible en PDF por empleado y Excel para la **nómina electrónica** (proveedor tecnológico).
  - SMMLV 2026 $ 1.750.905 (Decreto 1469 de 2025) y auxilio de transporte $ 249.095 (Decreto 1470 de 2025), editables cada año.
- **Activos fijos** (colección `ActivoFijo`): compra (opcionalmente contabilizada), depreciación en línea recta del mes para todos los activos (asiento `DEP-aaaa-mm`: 5160 contra 1592, una sola vez por mes, se puede anular) y venta o baja (utilidad 4245 o pérdida 5310).
- **Cierre del año** (asiento `CIERRE-aaaa`, origen `CIE`): lleva a cero las clases 4 a 7 del año contra 3605 (utilidad) o 3610 (pérdida). El estado de resultados no cuenta el asiento de cierre; se puede reabrir anulándolo.
- **Documento soporte**: al causar una compra con soporte «documento soporte» sin número, se numera con el consecutivo de la empresa (`DS-1`, prefijo editable).
- **Notas crédito y débito** a facturas de venta (`NC-0001`, `ND-0001`, asiento `NOT`): toman el asiento de la factura en proporción (sirven para el modelo bruto y el de terceros) y ajustan el saldo por cobrar (`ajusteNeto`). La factura con notas no se anula; las notas crédito van a «devoluciones» en la exógena 1007.

### Seguridad y protección de datos (fase 4)

- **Permiso propio de nómina** (`nomina.ver`, `nomina.gestionar`): solo el administrador y el rol de contabilidad ven empleados, salarios, cuentas bancarias, desprendibles y la nómina electrónica (Ley 1581 de 2012). El rol de consulta sigue viendo los libros, donde la nómina aparece solo en totales.
- El registro de auditoría de empleados no guarda el salario.
- El XML de las facturas de proveedores se lee en tiempo lineal y con límites: un archivo armado a propósito (etiquetas sin cerrar) no deja la API ocupada.
- Todo sigue filtrado por empresa (`tenantPlugin`) y validado con zod; los documentos se anulan desde su módulo para no descuadrar saldos.
- Ambiente de pruebas: `deploy/dev/copiar-datos.sh` (en `main`) copia la base de producción y quita las claves del RNDC y del correo. Esa copia trae cédulas, teléfonos y ahora salarios: conviene que solo la usen personas autorizadas o anonimizar esos campos.

## Pruebas

`backend/test/contabilidad.test.js`, `backend/test/compras.test.js`, `backend/test/tributario.test.js`, `backend/test/nomina.test.js` y `backend/test/rndcFactura.test.js` (necesitan MongoDB local, como las demás pruebas; las reglas puras de retenciones, XML y conciliación no la necesitan):

```
cd backend && npm test
```

Antes de pasar la rama a `main`, correr todas las pruebas y revisar con el contador el modelo de ingresos y el plan de cuentas.

## Fase 5 (rama `csalcedo17`): factura electrónica registrada en el RNDC (proceso 86)

En **Tributario → Factura electrónica · RNDC** (servicio `services/gestion/rndcFactura.js`, rutas `/api/gestion/tributario/fe/rndc` y `/api/gestion/tributario/facturas/:numero/fe/...`):

1. Se descarga la relación de remesas (fase 3) para el proveedor tecnológico.
2. Cuando la DIAN valida la factura, se carga el **AttachedDocument** que entrega el proveedor. La plataforma lo revisa antes de aceptarlo: respuesta de la DIAN «Documento validado» (código 02), CUFE de 96 caracteres, número y CUFE iguales a los registrados, tipo de operación 12, emisor = la empresa, adquirente = el cliente, y cada línea con **01 radicado, 02 consecutivo y 03 flete** de las remesas de la factura (las que faltan o sobran impiden el envío; un flete distinto queda como aviso). Con el XML aceptado se llenan el número y el CUFE de la factura.
3. **Enviar al RNDC**: mensaje tipo 1, `procesoid` 86, con `NUMNITEMPRESATRANSPORTE` y `ARCHIVOBASE64` (el XML de la DIAN tal cual, en base64), una factura por mensaje. Queda el radicado; si el RNDC la rechaza queda el motivo.
4. **Envío automático** (lo activa el administrador): cada 5 minutos el servidor envía las facturas con XML cargado de las empresas que lo activaron, con la contraseña del RNDC guardada de la empresa (hasta 10 por vuelta y empresa, de una en una y por el limitador del RNDC).

Estados: «Por enviar» (`PENDIENTE`), «Sin conexión, se reintenta» (`ERROR_CONEXION`, a los 10, 20, 40… minutos, hasta 6 intentos), «Registrada» (`ACEPTADA`), «Rechazada» (`RECHAZADA`, datos que corrige una persona: no se reintenta sola) y «No se pudo enviar» (`ERROR`, agotó los reintentos). Una factura registrada en el RNDC no se anula ni se le cambia el XML: se corrige con nota crédito. El simulador local (`npm run simulador`) responde el proceso 86 y rechaza la misma factura dos veces.

### Seguridad y protección de datos (fase 5)

- El XML se lee en tiempo lineal y con límites (800 KB, sin `DOCTYPE` ni `ENTITY`); se guarda aparte (`XmlFacturaRndc`, contenido con `select: false`) y no viaja en los listados.
- La contraseña del RNDC es la guardada cifrada de la empresa (AES-256-GCM con llave del servidor, ver `services/rndc/claveGuardada.js`) o, si no hay guardada, la que se escribe para ese envío; nunca se guarda en la factura y el registro de transacciones la oculta. Con contraseña registrada, solo el administrador puede escribir otra (igual que en las operaciones del RNDC).
- Si el RNDC rechaza la contraseña guardada, se marca inválida y el envío automático se detiene (el RNDC bloquea el usuario tras varios intentos). Hay límite de 20 envíos manuales cada 15 minutos por persona.
- Cargar y enviar: permiso `contabilidad.gestionar`; activar el envío automático: `config.gestionar` (administrador). Todo queda en la auditoría sin el XML ni la contraseña.
- El servidor de pruebas no envía al RNDC real mientras `RNDC_PERMITIR_PRODUCCION` esté apagado.

Pruebas: `backend/test/rndcFactura.test.js` (las reglas puras sin base de datos; la API con MongoDB local y el simulador del RNDC).

## Pendiente de confirmar con el Ministerio

- Si el RNDC exige un usuario del web service distinto para la factura electrónica, se configura ese usuario y su contraseña en Configuración > RNDC.
