# SG-SST y PESV (fase 8)

Módulo de seguridad y salud en el trabajo (Decreto 1072 de 2015, Res. 0312 de 2019) y de seguridad vial (Res. 40595 de 2022)
dentro de la plataforma, con los mismos datos de la empresa: conductores, vehículos y empleados no se escriben dos veces.

## Roles

| Rol | Ve | Puede |
| --- | --- | --- |
| Administrador | Todo | Todo |
| Responsable SG-SST y PESV (`sst`) | Módulo SG-SST, datos maestros | Gestionar el perfil SST de conductores y empleados (incluidos exámenes médicos), mantenimiento, capacitaciones, formatos y membrete |
| Consulta | Tablero y listados del SG-SST, sin exámenes médicos | Solo ver |
| SuperAdmin | «SST de las empresas»: solo cifras por empresa | Nada dentro de las empresas |

## Pantallas (menú «SG-SST y PESV»)

- **Tablero**: vencimientos (SOAT, técnico-mecánica, pólizas RC, licencias, exámenes, EPP, mantenimiento), preoperacionales del día,
  cumplimiento de estándares mínimos y PESV, capacitaciones.
- **Preoperacionales**: copia en la plataforma de los checklists que los conductores hacen en Sur Track (se traen solos al abrir el
  tablero, cada 15 minutos como mucho, o con «Traer de Sur Track»). Apto / no apto por ítems críticos, aviso si no es del día del viaje,
  acción de la empresa con los no aptos y PDF (uno o todos los del periodo) con el membrete.
- **Personas**: vista de los conductores (Datos → Conductores y terceros) y empleados (Nómina) con su estado SST. No se crean personas
  aquí: el perfil SST (exámenes reservados, EPP con firma, comparendos, capacitaciones, checklists y excesos de velocidad) se guarda en
  la ficha de cada uno (`tercero.sst` / `empleado.sst`). También se abre con el botón «SST» en Conductores y en Nómina.
- **Mantenimiento y PESV del vehículo**: botón «PESV» en Datos → Vehículos. Km = última lectura del odómetro + km de Sur Track desde
  esa lectura; plan preventivo por km o días (lo que llegue primero), pólizas RC, historial y checklists del vehículo.
- **Indicadores del PESV con Sur Track** (tablero): viajes con checklist del día, excesos de velocidad (límite de la empresa),
  manejo seguido sin pausa (horas y minutos de pausa configurables en Datos y membrete) y km recorridos.
- **Capacitaciones**: programa anual y asistencia firmada en pantalla; la planilla SST-FOR-07 sale en PDF.
- **Formatos**: catálogo listo (SST-FOR-01/02/03/07, SST-ACT-01, PESV-FOR-01) que se diligencia con casillas y firmas;
  formatos propios en Word/Excel con marcadores; conversión de un Word ya diligenciado en plantilla.
- **Datos y membrete**: representante legal, responsable SST, ARL, clase de riesgo, nivel PESV, autoevaluaciones, colores,
  franjas de encabezado y pie.

## Auto-llenado y membrete (`backend/src/services/sst/autollenado.js`)

- `contexto(empresa)` arma los datos: `{{empresa.razonSocial}}`, `{{empresa.nitCompleto}}`, `{{empresa.representanteLegal}}`,
  `{{empresa.responsableSst}}`, `{{empresa.arl}}`, `{{empresa.claseRiesgo}}`, `{{fecha.larga}}`, `{{fecha.ciudadFecha}}`… (lista en `MARCADORES`).
- `llenarDocx` reemplaza los marcadores aunque Word los parta en varios fragmentos y, si hay membrete, cambia encabezado y pie.
- `llenarXlsx` reemplaza en celdas; `{{empresa.logo}}` pone el logo.
- `plantillaDesdeDocumento` convierte un formato viejo (con la razón social y el NIT escritos) en plantilla.
- `pdfFormato` dibuja cualquier formato del catálogo con la franja del membrete o el encabezado clásico (logo | título | código,
  versión, fecha, página) y numera las páginas.

## API (`/api/sst`)

`GET /resumen`, `GET /indicadores?mes`, `GET /alertas`, `GET|PUT /empresa`, `PUT /empresa/membrete/:parte`, `GET /plantillas`,
`GET /plantillas/:codigo/pdf`, `GET|POST /registros`, `PUT /registros/:id`, `POST /registros/:id/anular`, `GET /registros/:id/pdf`,
`GET|POST /formatos`, `GET /formatos/:id/generar`, `GET /formatos/:id/plantilla`, `DELETE /formatos/:id`, `GET /personas`,
`GET /personas/:tipo/:id`, `POST /personas/:tipo/:id/(examenes|epp|comparendos|ssi)`, `DELETE /personas/:tipo/:id/:sub/:item`,
`GET|PUT /flota/:id`, `POST /flota/:id/mantenimientos`, `GET|POST /capacitaciones`, `GET|PUT /capacitaciones/:id`,
`GET /capacitaciones/:id/asistencia.pdf`, `GET /preoperacionales`, `POST /preoperacionales/sincronizar`,
`PUT /preoperacionales/:id/revision`, `GET /preoperacionales/:id/pdf`, `GET /preoperacionales.pdf?placa&desde&hasta`.
El PDF del checklist en Viajes (`/api/rastreo/viajes/:id/checklist/pdf`) usa el mismo formato SST-FOR-06 v2 con membrete.
SuperAdmin: `GET /api/admin/sst-resumen`.

## Por confirmar

- Nivel del PESV por tamaño de flota (11-19 básico, 20-50 estándar, más de 50 avanzado) con la versión vigente de la Res. 40595.
- Consulta de comparendos en el SIMIT y de licencias en el RUNT: hoy se registran a mano.
- Horas de manejo seguido y minutos de pausa para el indicador de fatiga (hoy 4 h y 15 min): los fija el líder del PESV.
- Ítems críticos del checklist de Sur Track (`CRITICOS_SURTRACK` en `services/sst/checklistSurTrack.js`).
