# Seguridad de la información

Este documento muestra cómo la plataforma aplica controles del **Anexo A de ISO/IEC 27001:2022**, que se desarrollan en ISO/IEC 27002:2022. Sirve como evidencia técnica para una auditoría.

**Alcance:** la plataforma *apoya* el cumplimiento, pero **no otorga una certificación**. La certificación es del sistema de gestión de cada empresa: políticas, riesgos, personas y proveedores. Esos aspectos están fuera del software.

## Controles implementados

| Control (ISO/IEC 27001:2022, Anexo A) | Cómo se aplica | Dónde |
|---|---|---|
| **5.15 Control de acceso** | Roles con permisos mínimos: SuperAdmin, Administrador, Reportero de viajes, Responsable de manifiestos, Contabilidad y Consulta. Cada ruta exige un permiso explícito. | `config/permisos.js`, `middleware/auth.js` |
| **5.18 Derechos de acceso** | El SuperAdmin crea empresas y administradores. Cada administrador crea los usuarios de su empresa. Al desactivar un usuario o cambiar su rol o su contraseña, sus sesiones se cierran de inmediato (versión del token). | `routes/usuarios.js`, `routes/superadmin.js` |
| **8.3 Restricción del acceso a la información** | **Aislamiento entre empresas.** Todo dato operativo lleva `empresa`, y el `tenantPlugin` rechaza cualquier consulta sin ese filtro (incluidos los `populate`). El SuperAdmin no ve la operación de las empresas. Las importaciones escriben solo en la empresa del usuario. | `models/tenantPlugin.js`, `models/index.js` |
| **8.5 Autenticación segura** | Contraseñas con bcrypt (12 rondas), con mínimo 8 caracteres que combinen letras y números. Cambio obligatorio en el primer ingreso. Bloqueo de 15 minutos tras 5 intentos fallidos. Límite de peticiones en el login. La respuesta es la misma tanto si el correo existe como si no. | `routes/auth.js` |
| **8.5 / 5.17 Sesiones** | JWT HS256 con caducidad (8 horas por defecto) guardado en `sessionStorage`, que se borra al cerrar la pestaña. Cierre automático tras 30 minutos sin actividad. | `core/auth.service.ts`, `pages/layout.ts` |
| **8.15 Registro de eventos (logging)** | Se registran inicios y cierres de sesión, **intentos fallidos**, bloqueos, **accesos denegados**, creación y cambios de datos (con el detalle de qué cambió), envíos y consultas al RNDC, importaciones (con la huella SHA-256 del archivo), descargas de reportes y exportaciones de la auditoría. | `services/auditoria.js` |
| **8.15 / 5.28 Protección de registros y recolección de evidencia** | La auditoría es de **solo inserción**: la aplicación bloquea modificarla o borrarla. Cada registro guarda un hash SHA-256 encadenado con el anterior, con una cadena por empresa y otra para las acciones globales. La opción **Verificar integridad** recorre la cadena y señala el primer registro alterado o faltante. | `services/auditoria.js`, Configuración → Auditoría |
| **5.33 Protección de registros / 8.16 Monitoreo** | Filtros por fecha, usuario, acción y resultado (éxito, fallo, denegado). Exportación a Excel con los hashes, para entregar a auditores. | `shared/auditoria.ts`, `/api/reportes/auditoria.xlsx` |
| **8.24 Uso de criptografía** | La contraseña del web service del RNDC **nunca se guarda**: se pide en cada operación y en los registros aparece como `*****`. Los secretos (`JWT_SECRET`) van en variables de entorno, nunca en el código. | `services/rndc/*`, `.env.example` |
| **8.26 / 8.28 Seguridad en aplicaciones y codificación segura** | Toda entrada se valida con esquemas (zod), con las mismas reglas para formularios e importaciones. Además: cabeceras de seguridad (Helmet), CORS restringido en producción y errores sin trazas internas. | `validaciones/maestros.js`, `app.js`, `middleware/errores.js` |
| **8.7 / 8.28 Archivos cargados** | Solo se aceptan Excel (.xlsx/.xlsm), comprobados por su firma ZIP. Límites: 15 MB y 10.000 filas. Las macros del archivo **no se ejecutan**. Antes de aplicar se hace una simulación con los errores por fila. | `services/importacion/excel.js` |
| **8.31 Separación de entornos** | El RNDC tiene tres ambientes: simulador, pruebas y producción. El servidor bloquea los oficiales salvo que se habiliten de forma explícita (`RNDC_PERMITIR_PRUEBAS`, `RNDC_PERMITIR_PRODUCCION`). Las pruebas automáticas usan bases de datos propias que se crean y se borran solas. | `config/env.js`, `test/` |
| **5.34 Privacidad y protección de datos personales** (Ley 1581 de 2012) | Datos mínimos de conductores y terceros. Los detalles de auditoría omiten campos de contraseñas o tokens. El acceso a datos personales está limitado por rol y por empresa. | `services/auditoria.js` |

## Responsabilidades de operación (fuera del código)

1. **HTTPS obligatorio.** Publique el frontend y `/api` detrás de un proxy con TLS (por ejemplo, nginx con Let's Encrypt).
2. **Copias de seguridad (8.13).** Programe `mongodump` diario y cifrado, con retención definida. Pruebe la restauración al menos cada trimestre.
3. **Base de datos.** Habilite la autenticación de MongoDB, use un usuario con permisos mínimos y no exponga el puerto 27017 a internet.
4. **Secretos.** Use un `JWT_SECRET` aleatorio de 48 bytes o más. Si se compromete, cámbielo: todas las sesiones se cierran.
5. **Revisión de accesos (5.18).** Una vez al mes, revise en Configuración → Usuarios quién tiene cada rol y desactive las cuentas que ya no se usan.
6. **Revisión de la auditoría.** Una vez al mes, ejecute «Verificar integridad», exporte la auditoría y archive el Excel en un repositorio controlado.
7. **Actualizaciones (8.8).** Ejecute `npm audit` y aplique las actualizaciones de seguridad de dependencias.
8. **Instancia única.** La cadena de auditoría se ordena dentro de cada proceso. Si se ejecutan varias instancias de la API, el índice único (`cadena`, `seq`) evita bifurcaciones mediante reintentos. Aun así, se recomienda una sola instancia o un balanceador con afinidad.

## Limitaciones conocidas

- **Auditoría y base de datos:** quien tenga acceso directo a la base de datos puede borrar la colección completa. La cadena detecta alteraciones y huecos, pero no impide ese borrado. Para mayor garantía, exporte periódicamente los hashes, o envíe los registros a un almacenamiento WORM o a un SIEM externo.
- **Doble factor (MFA):** no está implementado. Se recomienda agregarlo antes de exponer la plataforma a internet con roles administrativos.
