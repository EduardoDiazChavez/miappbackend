# MiApp Backend

API independiente de MiApp construida con Node.js, Express, TypeScript y Mongoose. Expone autenticación, tickets y administración, y se conecta a MongoDB.

## Requisitos

- Node.js compatible con el proyecto.
- MongoDB local o MongoDB Atlas.

## Configuración local

Desde esta carpeta, en PowerShell:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Edita `.env` y configura:

- `MONGODB_URI`: URI obtenido de Atlas (`mongodb+srv://...`) o URI de MongoDB local. Crea un usuario de base de datos dedicado con el rol mínimo `readWrite` sobre la base de MiApp; no uses las credenciales de tu cuenta de Atlas.
- `JWT_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `FRONTEND_ORIGIN`: origen exacto del frontend, por ejemplo `http://localhost:3000`.
- `GOOGLE_CLIENT_ID`: Client ID de la aplicación OAuth.
- `GOOGLE_APPLICATION_CREDENTIALS`: ruta absoluta al JSON de la cuenta de servicio, guardado fuera del repositorio.
- `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_NAME`: cuenta inicial de Super admin.
- `DNS_SERVERS`: opcional solo en desarrollo, para redes donde Node no resuelve DNS correctamente. En producción, configura DNS en el host o contenedor.

En Atlas, limita la lista **Network Access** a las IPs públicas necesarias y no uses `0.0.0.0/0`. Protege el URI y no lo subas a Git. La conexión remota requiere TLS y valida los certificados; no agregues opciones que deshabiliten esa validación.

Para Google Sheets, habilita **Google Sheets API** en el proyecto de Google Cloud y comparte cada archivo mensual con el correo de la cuenta de servicio como editor. Desde **Administración → Hojas de tickets**, registra el archivo mensual de cada usuario y relaciona cada empresa con una pestaña existente. Al activar el siguiente archivo, el anterior se conserva como histórico.

La plantilla debe mantener las columnas A–M acordadas. La sincronización escribe A, C–E y G–L; deja intactas la fórmula de Cliente (B), la fórmula de Total Horas (F) y la aprobación (M). Las fechas y horas se escriben como valores numéricos en la zona horaria del archivo para conservar el formato de 24 horas y permitir que las fórmulas calculen. Las filas son asignadas por la API; evita insertar, eliminar o reordenar filas de datos manualmente.

Antes de ejecutar la nueva versión sobre una base existente, crea una copia de seguridad y migra el campo de ticket `title` a `process`:

```powershell
npm.cmd run migrate:ticket-process
```

La migración conserva los tickets y sus mensajes; no borra información.

## Crear el Super admin inicial

Con `.env` configurado:

```powershell
npm.cmd run bootstrap:admin
```

El comando crea o promueve la cuenta indicada a Super admin; las demás cuentas Admin no cambian. El correo debe estar autorizado para acceder con Google. El primer inicio de sesión Google verificado enlaza la identidad. En una base existente, vuelve a ejecutar este comando para promover la cuenta bootstrap.

## Ejecutar y validar

```powershell
npm.cmd run dev
npm.cmd run build
npm.cmd test
```

La API local escucha en `http://localhost:3001`; `GET /health` comprueba que está respondiendo.

## Producción

Configura `NODE_ENV=production`, `COOKIE_SECURE=true`, DNS en el entorno de ejecución y secretos mediante un gestor de secretos. Sirve frontend y API por HTTPS y configura `FRONTEND_ORIGIN` con el origen exacto.

El contrato de rutas, roles y modelos está en [docs/api-ready-contract.md](docs/api-ready-contract.md); la definición OpenAPI está en [openapi.yaml](openapi.yaml).
