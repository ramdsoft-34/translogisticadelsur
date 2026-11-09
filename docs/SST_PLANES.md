# Autoevaluación, plan de mejora, plan anual y alertas (SG-SST y PESV)

Traído de la rama de Cristian (fases 13 y 13b) y adaptado al SG-SST de producción (Datos y membrete, Colaboradores, Flota, Capacitaciones y Formatos).

Pantalla: **SG-SST y PESV › Autoevaluación y planes** (`/sst/planes`). Permisos: `sst.ver` para ver, `sst.gestionar` para calificar, cerrar y editar.

## Autoevaluación de estándares mínimos (Res. 0312 de 2019)
- Los 60 ítems del capítulo III (riesgo IV y V) con su peso, la evidencia (con su nombre, a partir del código del listado de documentos del SG-SST) y la acción de mejora (`backend/src/services/sst/estandares.js`).
- El responsable califica cada ítem: cumple, no cumple o no aplica (con justificación obligatoria). El puntaje, el avance por ciclo PHVA y el nivel (crítico < 60, moderado 60–85, aceptable > 85) se calculan solos.
- Una evaluación anterior de la que solo se conoce el puntaje (por ejemplo la de 2022 en ALISSTA) se registra como «solo puntaje».
- Datos del reporte a la ARL: fecha de envío, consecutivo del acuse y fecha y resumen de las recomendaciones.
- «Informe para la ARL (Excel)»: los 60 ítems con calificación, justificación, evidencia y la acción del plan de mejora.

## Plan de mejora automático
Al **cerrar** una autoevaluación:
1. Cada ítem que no cumple crea su acción (plazo según el peso: ≥ 2,5 → 60 días, ≥ 1 → 90 días, < 1 → 120 días; responsable: el del SG-SST).
2. Las acciones abiertas de ítems que ahora cumplen se cierran solas con la nota «Cumple en la autoevaluación de la vigencia N».
3. Se agenda el informe de avances a la ARL que exige el art. 28 (crítico: 3 meses; moderado: 6 meses).
4. El puntaje queda también en Datos y membrete (`SstEmpresa.autoevaluacion.estandares`) y en el tablero SST, si es la vigencia más reciente. Lo mismo al registrar «solo puntaje».

## Plan anual de trabajo y calendario de obligaciones
«Cargar calendario» agrega las fechas de `backend/src/services/sst/obligaciones.js`:
- Ministerio del Trabajo y ARL: autoevaluación anual, registro en sgrl.mintrabajo.gov.co y copia a la ARL (Circular 0027 de 2026), informe de avance de julio, plan anual de diciembre, matriz legal, matriz de peligros, exámenes, simulacro, auditoría, revisión por la dirección, rendición de cuentas, reunión mensual del Vigía y del Comité de Convivencia (Res. 3461 de 2025), indicadores mensuales.
- Ministerio de Transporte y Supertransporte (PESV, Res. 40595 de 2022): Comité de Seguridad Vial e indicadores trimestrales, reporte a la Supertransporte, diagnóstico y matriz de riesgos viales, auditoría del PESV y evaluación de propietarios vinculados.
Las fechas son sugeridas y se ajustan en cada actividad. Si el plan se carga con el año empezado, las fechas que ya pasaron no se agregan. También se pueden crear actividades propias.

## Sugerencia de cumple / no cumple
En una autoevaluación en borrador, «Sugerir desde la plataforma» propone la calificación de los ítems que se pueden comprobar con los datos de la vigencia (`backend/src/services/sst/evidencias.js`), cada uno con su motivo y su fuente:
1.1.1 responsable y licencia · 1.1.4 planillas del último mes (si la empresa usa la app) · 1.1.6 actas de reunión · 1.2.1 capacitaciones ejecutadas · 1.2.2 inducciones · 3.1.4 exámenes vigentes · 4.2.4 inspecciones y preoperacionales · 4.2.5 mantenimiento preventivo · 4.2.6 EPP firmados · 5.1.2 simulacro · 2.6.1, 2.7.1, 4.1.2, 6.1.2, 6.1.3, 3.3.1, 3.3.2, 3.3.6 según lo hecho en el plan anual (solo cuenta lo que ya debía estar hecho a la fecha) · 7.1.1 acciones de mejora vencidas.
«Aplicar» solo marca en pantalla: el responsable revisa, guarda y cierra. Lo que la plataforma no puede saber (política firmada, curso de 50 horas…) no se sugiere.

## Proyección automática del año
Si el año no tiene calendario se carga solo (sin las fechas que ya pasaron), y desde el 1 de diciembre se carga también el del año siguiente; sale un aviso en Alertas. Lo que quedó pendiente de años anteriores aparece al comienzo del plan del año nuevo («Pendientes de años anteriores») y sigue en las alertas hasta que se marque hecho o cancelado.

## Alertas
Actividades pendientes vencidas, de esta semana o de los próximos 30 días, más avisos (falta el plan del año, falta o está sin cerrar la autoevaluación). Salen en la pestaña Alertas, en el contador del menú y en el tablero, con un botón para enviar el resumen por WhatsApp.

## API (`/api/sst`)
`GET /estandares` · `GET|POST /autoevaluaciones` · `GET /autoevaluaciones/:id/sugerencias` · `GET|PUT|DELETE /autoevaluaciones/:id` · `POST /autoevaluaciones/:id/cerrar|reabrir` · `GET /autoevaluaciones/:id/excel` · `GET|POST /actividades` · `PUT|DELETE /actividades/:id` · `POST /plan-anual/:anio/generar` · `GET /plan-anual/:anio/excel` · `GET /alertas`.

Código: `backend/src/models/sstPlanes.js`, `backend/src/services/sst/{estandares,obligaciones,planes}.js`, `backend/src/routes/sstPlanes.js` (montado en `routes/sst.js`) y `frontend/src/app/pages/sst-planes.ts`. El tablero lee `GET /api/sst/planes/resumen`.

Pruebas: `backend/test/sstPlanes.test.js` (reglas puras; la autoevaluación 2025 de ALISSTA da 8,5 %) y el flujo completo en `backend/test/sst.test.js`.

La pantalla avisa si hay calificaciones sin guardar (barra fija abajo y aviso al cambiar de vigencia, de pestaña o salir), muestra cuántos de los 60 ítems van calificados y permite buscar por numeral, ítem o evidencia.
