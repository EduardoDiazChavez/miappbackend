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
- `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_NAME`: administrador inicial.
- `DNS_SERVERS`: opcional solo en desarrollo, para redes donde Node no resuelve DNS correctamente. En producción, configura DNS en el host o contenedor.

En Atlas, limita la lista **Network Access** a las IPs públicas necesarias y no uses `0.0.0.0/0`. Protege el URI y no lo subas a Git. La conexión remota requiere TLS y valida los certificados; no agregues opciones que deshabiliten esa validación.

## Crear el administrador inicial

Con `.env` configurado:

```powershell
npm.cmd run bootstrap:admin
```

El correo debe estar autorizado para acceder con Google. El primer inicio de sesión Google verificado enlaza la identidad.

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
