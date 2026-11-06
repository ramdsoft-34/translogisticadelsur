# Remesas de los clientes (fase 12)

Menú **Documentos → Remesas**. Reemplaza el formulario «REMESAS DULCES» de la plantilla y sirve para cualquier cliente.

## 1. Cargar base
- Se elige la empresa (cliente) y el Excel que manda el cliente (p. ej. «Relación de planillas del 29 al 31 de octubre»).
- Lee **todas las tablas de la hoja** (la normal y la de ECOM): reconoce las columnas por su nombre (FECHA DE PLANILLA,
  VPL/PLANILLA, ZONA o RUTA, PESO, MANIFIESTO, CONDUCTOR, PLACA, REMESA, COSTO/VALOR/FLETE) y salta títulos, filas vacías,
  subtotales y totales.
- Vista previa antes de guardar, con casillas (Marcar todos, Solo nuevos, Quitar todos), estado de cada viaje
  (Nuevo, Ya existe, Cambió) y la opción **Omitir** o **Reemplazar** los que ya existen. No hay que borrar la base anterior.
- Revisión automática:
  - viajes que **coinciden con la bitácora** de la plataforma (misma placa y mismo día), con el N° del viaje;
  - remesas sin viaje (salto en el consecutivo), números faltantes, remesas repetidas o que ya tiene otro VPL;
  - **SUBTOTAL o TOTAL del Excel que no cuadra** con la suma de los viajes;
  - conductores sin cédula.

## 2. Base de remesas
- Filtros por empresa, mes y estado (Pendientes / Impresas) y búsqueda.
- **Seleccionar todo**, Solo pendientes, Quitar selección, **PDF de las marcadas** y **🖨 Imprimir marcadas**.
- Por fila: Editar, Ver, PDF (esa remesa sola) y 🖨 (con 2 por hoja imprime esa remesa y la siguiente pendiente).
- La cédula y la dirección del conductor salen del registro de conductores (por nombre o por el conductor habitual
  de la placa). Si falta, se escribe en «Editar» una sola vez y sirve para las próximas remesas de ese conductor.

## 3. Imprimir
- Qué: las marcadas, un rango de remesas, todas las pendientes de la lista o una sola.
- Hoja carta: **2 remesas distintas por hoja** con línea «cortar aquí», o **1 por hoja** en la mitad de arriba.
- 🖨 Imprimir abre la ventana de impresión (impresora y copias); también Ver PDF y Un PDF por remesa (.zip).
- Al imprimir o descargar quedan **Impresas** (fecha, usuario y cuántas veces). Si ya estaban impresas, pregunta antes.

## Consecutivo
- El **N° de remesa** es el consecutivo interno de la empresa (uno solo para todos los clientes). Si el Excel lo trae,
  se respeta; si viene vacío se asigna. El próximo número sigue después de la remesa más alta cargada y el administrador
  lo puede ajustar (nunca por debajo de uno ya usado).

## ⚙ Configuración de la remesa
- **Encabezado de la empresa** (administrador): logo, nombre en dos líneas, NIT, lema, resolución, próximo N° de remesa
  y hoja por defecto.
- **Datos fijos de cada cliente**: logo del cliente, remitente, ciudad origen, dirección, sector, destinatario,
  cantidad, clase y contenido. Vista previa al lado.

## API (dentro de /api/gestion)
`GET /remesas` · `POST /remesas/previa?cliente=` · `POST /remesas/importar?cliente=&modo=` (cabecera `X-Seleccion`) ·
`PUT|DELETE /remesas/:id` · `POST /remesas/pdf` · `POST /remesas/zip` · `GET /remesas/formato?cliente=` ·
`PUT /remesas/formato/empresa` · `PUT /remesas/formato/cliente/:id`.
