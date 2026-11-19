## Contrato de API MiApp

La API se ejecuta como proyecto Node.js independiente en `backend/`. Todas las rutas bajo `/auth`, `/tickets` y `/admin` (salvo `/health`) usan JSON. La sesión se mantiene con una cookie JWT `miapp_session` `HttpOnly`, `SameSite` configurable y `Secure` en producción. La cookie tiene vigencia de ocho horas.

### Roles

| Rol API | Flujo | Permisos principales |
| --- | --- | --- |
| `CLIENT` | Contraseña definida al aceptar una invitación | Listar y consultar tickets de su organización; enviar mensajes visibles al cliente. No crea ni cierra tickets. |
| `ADVISOR` | Google, correo verificado `@mrm.com.ve` | Consultar sus tickets, crear tickets, responder y cambiar estados. |
| `ADMIN` | Google, cuenta autorizada | Conserva las funciones administrativas actuales y puede gestionar organizaciones e invitaciones. |
| `SUPER_ADMIN` | Google, cuenta bootstrap | Incluye todos los permisos de Admin; queda reservado para funciones adicionales de métricas. |

Cada solicitud autenticada vuelve a consultar el usuario activo en MongoDB, de modo que rol y organización revocados no dependan del tiempo de vida del JWT. Los clientes se filtran por `organizationId` en la API. Un ticket que no pertenece a la organización responde como no encontrado.

### Endpoints implementados

#### Acceso

- `POST /auth/client/login` — `{ "username": "cliente@empresa.com", "password": "..." }`. Solo permite cuentas `CLIENT` activas.
- `POST /auth/client/accept-invitation` — `{ "token": "...", "password": "..." }`. Consume una invitación vigente una sola vez y establece la cookie.
- `POST /auth/google` — `{ "credential": "<Google ID token>" }`. Valida el ID token en el servidor y solo permite correos verificados con dominio exacto `@mrm.com.ve`. Si el correo aún no tiene cuenta, crea una cuenta interna activa con rol `ADVISOR`; las cuentas internas existentes conservan su rol. Las cuentas preexistentes inactivas o no internas siguen bloqueadas.
- `GET /auth/me` — perfil autenticado.
- `POST /auth/logout` — elimina la cookie.

#### Tickets

- `GET /tickets?page=1&limit=20&status=OPEN` — paginación y filtro de estado; para clientes aplica automáticamente su empresa.
- `GET /tickets/organizations` — organizaciones activas visibles al usuario; cliente solo ve la propia.
- `GET /tickets/summary` — resumen y serie mensual; solo roles internos.
- `POST /tickets` — solo roles internos. Campos: `organizationId`, `process`, `description`.
- `GET /tickets/:idOrCode` — detalle e historial de conversación visible al rol.
- `POST /tickets/:idOrCode/messages` — `{ "content": "..." }`, persiste mensaje visible en el historial.
- `PATCH /tickets/:idOrCode/status` — `{ "status": "OPEN|IN_PROGRESS|WAITING|CLOSED" }`, solo roles internos; registra el cambio en el historial.
- `POST /tickets/:idOrCode/sheets-sync` — solo roles internos; sincroniza un ticket cerrado con la hoja mensual activa del usuario que lo creó y la pestaña asignada a su empresa. Conserva el destino y la fila para que los reintentos actualicen la misma fila.

#### Administración

- `GET /admin/organizations` — listar organizaciones activas.
- `POST /admin/organizations` — `{ "name": "..." }`.
- `GET /admin/sheets/workbooks` — listar usuarios internos habilitados para generar tickets, empresas activas y archivos mensuales configurados.
- `GET /admin/sheets/tabs?spreadsheetId=...` — consultar pestañas existentes de un archivo accesible a la cuenta de servicio.
- `POST /admin/sheets/workbooks` — configurar y activar un archivo mensual para un usuario; incluye `userId`, `periodLabel`, `spreadsheetId` y el arreglo `organizationSheets` con `organizationId` y `sheetId`.
- `PUT /admin/sheets/workbooks/:workbookId/mappings` — actualizar la relación de empresas con pestañas existentes.
- `POST /admin/sheets/workbooks/:workbookId/activate` — activar un archivo histórico configurado y cerrar el activo anterior del usuario.
- `POST /admin/invitations/clients` — `{ "name": "...", "email": "...", "organizationId": "..." }`. Devuelve una URL de invitación de un solo uso; el token original no se persiste.

Todas las rutas `/admin` requieren `ADMIN` o `SUPER_ADMIN`. La cuenta `BOOTSTRAP_ADMIN_EMAIL` se crea o promueve a `SUPER_ADMIN` mediante `npm.cmd run bootstrap:admin`; las demás cuentas Admin conservan su rol. `POST /tickets` y el cambio de estado exigen rol interno. Los payloads se validan con Zod, hay límites de tamaño y tasa, CORS limitado a `FRONTEND_ORIGIN`, cookies seguras y protección por validación de `Origin` en operaciones mutables.

### Datos

MongoDB usa colecciones `users`, `organizations`, `tickets`, `ticketmessages` e `invitations`. Los tickets referencian organización/creador/asignado; los mensajes se guardan aparte para soportar crecimiento del historial. Los índices cubren correo único, código de ticket, empresa/fecha, estado e historial cronológico. Para una base existente, realiza una copia de seguridad y ejecuta `npm.cmd run bootstrap:admin` para establecer la cuenta Super admin.

La integración mensual agrega las colecciones `googlesheetworkbooks`, `googlesheetrowcursors` y `ticketsheetsyncs`. Al desplegar el cambio en una base existente, realiza primero una copia de seguridad y ejecuta `npm.cmd run migrate:ticket-process` desde el backend. La migración renombra `title` a `process` sin eliminar tickets. Configura `GOOGLE_APPLICATION_CREDENTIALS` en el entorno de la API; los IDs de archivos y pestañas se administran por usuario desde la pantalla de hojas Google.

### Configuración y puesta en marcha

Ver [README.md](../README.md) para arranque local, bootstrap de administrador, configuración Google y valores de entorno. Para producción, el frontend y la API deben usar HTTPS. Si están en sitios cross-site, habilita `COOKIE_SAME_SITE=none` junto con `COOKIE_SECURE=true`; no uses `*` en CORS.

La invitación no tiene proveedor SMTP: el administrador debe compartir el enlace devuelto en respuesta por un canal confiable. Antes de abrir el registro a usuarios reales, integrar correo y establecer expiración/revocación auditables.

### Pendiente antes de producción

- Añadir flujo de recuperación de contraseña y entrega de invitaciones por email con proveedor transaccional, comprobación de rebotes y reenvío seguro.
- Añadir auditoría (cambios de rol, tickets y estados), protección/retención de logs, backups/restores verificados y monitorización.
- Evaluar MFA para administradores, controles de sesión revocable, límites de abuso con store compartido para múltiples instancias y políticas de contraseña.
- Definir clasificación de comentarios internos vs. visibles al cliente, si se necesitan notas privadas. Actualmente todo mensaje de conversación es visible al cliente.
- Integrar suite de pruebas con MongoDB de test y pruebas HTTP autenticadas para aislamiento multiempresa y CSRF/CORS.