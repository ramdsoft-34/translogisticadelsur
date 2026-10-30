# Translogística del Sur

Plataforma web para empresas de transporte de carga. Registra viajes y mantiene conductores, vehículos y clientes. Expide remesas y manifiestos ante el **RNDC** del Ministerio de Transporte y liquida fletes. Reemplaza la plantilla de Excel `PLANTILLA_DE_VIAJES_FORMULARIO.xlsm`.

**Multiempresa:**

- Cada empresa trabaja con sus propios datos, usuarios y configuración del RNDC.
- El **SuperAdmin** es el único usuario global: crea empresas y a sus administradores, y no ve la operación de ninguna empresa.

```
translogisticadelsur/
├── backend/    API REST: Node.js 20+, Express 5, MongoDB (Mongoose 8)
├── frontend/   Angular 21 (componentes standalone, signals, sin zone.js)
├── docs/RNDC.md        Qué se verificó del RNDC, qué está implementado y qué falta probar
└── docs/SEGURIDAD.md   Controles de ISO/IEC 27001:2022 aplicados y responsabilidades de operación
```

## Funciones

| Sección | Qué hace |
|---|---|
| Inicio | Resumen del día y del mes, pendientes por manifestar y documentos por vencer (licencias, SOAT, tecnomecánica) |
| Viajes | Bitácora con filtros. Al escoger cliente y destino se llenan tarifa, flete, anticipo, peso y municipio. La placa sugiere el conductor habitual. Exporta a Excel y PDF. **Reporte de vehículos por WhatsApp** con la misma estructura de la plantilla (un mensaje por cliente, valores en COP, marca de reportado). |
| Manifiestos RNDC | **Por enviar**: revisión previa, envío individual o por lote. **Manifestados**: PDF con QR, cumplir y anular. **Cumplidos**. **Historial** de cada envío. |
| Liquidación de fletes | Relación por cliente y periodo con cobro, flete, auxiliares y utilidad. Un viaje liquidado no se vuelve a cobrar. El auxiliar se cobra según la **política de auxiliar del cliente** (lo registrado, sin auxiliar, incluido en la tarifa o un valor fijo si el viaje no tiene anticipo) y los viajes con «[NO FACTURAR]» no entran. Exporta a Excel y PDF. |
| Pago a conductores | Liquidación por conductor o por **placa y empresa**, por quincena, **semana (lunes a domingo)** o mes. Neto = flete + auxiliar − anticipo reconocido − retefuente − FOPAT − préstamos. El anticipo es 0 si es igual o mayor al flete en Pasto, Mayorista o Popayán. Numeración con las **siglas del cliente** (COR-0001). Descuento de préstamos escogido (máximo lo pendiente). **Dos liquidaciones por hoja** al imprimir. |
| Contabilidad | Resumen del periodo (por cobrar, por pagar, facturado, cobrado, gastos y excedente), facturas con aviso de **periodos que se cruzan**, cobros, pagos, gastos, informes y **cartera por edades** (0–30, 31–60, 61–90, más de 90 días). |
| Cierre de mes | Antes de cerrar guarda en el servidor la **copia completa** de los datos, los **informes de viajes por empresa** y los **PDF de manifiestos** del mes (carpeta `ARCHIVO_DIR`). El administrador descarga el respaldo completo desde la plataforma. |
| Conductores y terceros, Vehículos | Datos que exige el RNDC, con su estado de sincronización (solo se reenvía lo que cambió). **Importar Excel** (plantilla descargable, revisión previa con errores por fila) y **Traer del RNDC** (consulta oficial del web service). |
| Clientes y tarifas | Generadores de carga y sus destinos, con tarifa, flete, anticipo, auxiliar, destinatario y número de WhatsApp. Importación desde Excel. |
| Consultas RNDC | Consultas oficiales de manifiestos, remesas, cumplidos, vehículos y terceros |
| Configuración | Conexión RNDC y valores por defecto, **reglas** (retenciones, PBV del FOPAT, destinos del anticipo reconocido, días de aviso de documentos, siglas y pesos por capacidad), correo (relaciones por cliente, manifiestos en un solo PDF), usuarios, **autorizaciones del administrador**, **importación de la plantilla de viajes completa** y auditoría (filtros, verificación de integridad y exportación) |
| Empresas / Auditoría | Solo el SuperAdmin |

## Roles

| Rol | Permisos |
|---|---|
| **SuperAdmin** | Crea, edita y desactiva empresas; crea administradores y restablece sus claves; ve la auditoría global |
| **Administrador** | Todo dentro de su empresa: usuarios, configuración RNDC y auditoría |
| **Reportero de viajes** | Registra viajes (solo puede editar los suyos) y consulta los maestros |
| **Responsable de manifiestos** | Viajes, maestros y toda la operación RNDC: expedir, cumplir, anular y consultar |
| **Contabilidad** | Tarifas, liquidación de fletes, reportes y consultas RNDC |
| **Consulta** | Solo lectura |

## Seguridad aplicada

**Aislamiento entre empresas**

- Toda la información operativa tiene `empresa`.
- Las rutas filtran siempre por la empresa del usuario autenticado, nunca por un dato enviado por el cliente.
- Además, el plugin `tenantPlugin` **rechaza cualquier consulta de Mongo que no filtre por empresa**, incluidos los `populate`. Es una defensa en profundidad contra olvidos.
- Las referencias (cliente, conductor, tarifa…) se validan contra la empresa del usuario.

**Sesiones**

- Contraseñas con bcrypt (12 rondas).
- JWT HS256 con versión de token: desactivar un usuario, cambiar su rol o su clave cierra sus sesiones.
- Bloqueo de 15 minutos tras 5 intentos fallidos.
- Límite de peticiones por IP en el login y en la API.
- Cambio de clave obligatorio en el primer ingreso.
- **Doble factor** con app autenticadora (TOTP), recomendado para administradores: se activa en «Mi cuenta». Si el administrador pierde el celular, el SuperAdmin se lo quita.

**Documentos vencidos**

- Un viaje con licencia, SOAT o tecnomecánica vencidos solo se guarda si el **Administrador** lo autoriza con su correo, su contraseña (y su código de doble factor) y un motivo.
- Cada autorización queda en el historial (Configuración → Autorizaciones) y en la auditoría.

**Validación**

- Validación de entrada con zod.
- Helmet, CORS restringido a los orígenes configurados y errores sin trazas internas.

**Contraseña del RNDC**

- Se pide al enviar y nunca se guarda.
- Los registros de envío ocultan la contraseña.

**Auditoría**

- Las acciones globales y las de cada empresa se registran por separado.

## Puesta en marcha (desarrollo)

Requisitos: Node.js 20 o superior y MongoDB en ejecución.

```bash
cd backend
cp .env.example .env        # defina JWT_SECRET (mínimo 32 caracteres)
npm install
npm run municipios          # carga el catálogo DIVIPOLA (1.105 códigos RNDC)
SEED_SUPERADMIN_EMAIL=correo@dominio SEED_SUPERADMIN_PASSWORD=ClaveSegura123 npm run seed
npm run simulador           # en otra terminal: simulador local del RNDC (puerto 4010)
npm run dev                 # API en http://localhost:4000/api
```

```bash
cd frontend
npm install
npm start                   # http://localhost:4200
```

Al ingresar con el SuperAdmin:

1. Cambie la contraseña.
2. Cree la empresa con su administrador.
3. Con el administrador, complete **Configuración → Conexión RNDC y valores**.

## Pruebas

```bash
cd backend
npm test
```

Son 20 pruebas integrales contra una base `translogisticadelsur_test` (se crea y se borra sola) y el simulador del RNDC. Cubren:

- creación de empresas y usuarios;
- aislamiento entre empresas y permisos por rol;
- registro de viajes con valores de la tarifa;
- validación previa del RNDC;
- despacho de remesa y manifiesto;
- reintento con el mismo consecutivo;
- anulación con reemplazo y cumplidos;
- PDF con QR (formato del manual 8.6.6);
- consulta tipo 3;
- sincronización de terceros sin duplicados;
- liquidación sin doble cobro y descargas;
- bloqueo de sesión y auditoría.

Las pruebas **nunca** contactan el RNDC real: los ambientes oficiales quedan deshabilitados en el proceso de prueba.

## Producción

**Variables de entorno del backend**

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Cadena de conexión de MongoDB |
| `JWT_SECRET` | Aleatoria y larga |
| `CORS_ORIGINS` | Dominio del frontend |
| `RNDC_PERMITIR_PRUEBAS` | `true` mientras se valida con el ambiente de pruebas |
| `RNDC_PERMITIR_PRODUCCION` | `true` solo cuando se haya validado el flujo completo en pruebas (ver `docs/RNDC.md`) |

**Frontend:** `npm run build` genera `frontend/dist/frontend/browser`. Por defecto la API se sirve en el mismo dominio bajo `/api` (`src/environments/environment.ts`).

**Servidor:** sirva el frontend y redirija `/api` al backend detrás de HTTPS (nginx o similar). Ejecute el backend con un gestor de procesos, como pm2.
