# Arquitectura de MiApp

Este proyecto usa Next.js con App Router. La idea es mantener el enrutado de la aplicación en `app/`, mientras todo el código reutilizable y la lógica de negocio vive bajo `src/` para facilitar crecimiento y mantenimiento.

## Organización recomendada

```text
mi-app/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx
│   ├── (auth)/
│   ├── (dashboard)/
│   └── api/
├── src/
│   ├── components/
│   │   ├── ui/
│   │   └── layout/
│   ├── features/
│   │   ├── auth/
│   │   └── dashboard/
│   ├── hooks/
│   ├── lib/
│   │   ├── api/
│   │   ├── constants/
│   │   ├── utils/
│   │   └── validations/
│   ├── services/
│   ├── types/
│   └── styles/
├── public/
├── backend/
│   ├── src/
│   │   ├── domain/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   └── scripts/
│   └── openapi.yaml
├── docs/
│   └── architecture.md
├── .env.example
├── package.json
├── README.md
├── tsconfig.json
└── next.config.ts
```

## Principios

- `app/`: solo rutas, layouts y páginas.
- `src/components/`: componentes visuales puros.
- `src/features/`: módulos funcionales por dominio.
- `src/lib/`: utilidades, validaciones, API helpers y constantes.
- `src/services/`: acceso a backend, APIs externas y comercio de datos.
- `src/types/`: tipos compartidos.
- `docs/`: decisiones de arquitectura y referencias internas.

## Recomendación de trabajo

1. Crear cada feature con su carpeta propia dentro de `src/features`.
2. Mantener componentes reutilizables en `src/components/ui`.
3. Evitar lógica de negocio dentro de páginas; centralizarla en features o services.
4. Usar rutas con grupos de Next: `(auth)`, `(dashboard)` para separar secciones.
5. Añadir `@/` como alias para importar de forma consistente.

## Siguiente paso

Con esta estructura, se puede empezar a desarrollar cada feature en un módulo independiente sin mezclar UI, lógica y datos.

## Separación de Cliente y Usuario

La aplicación tiene dos experiencias funcionales:

| Rol | Acceso |
| --- | --- |
| Cliente | Portal `/cliente`: consulta únicamente tickets asociados a su empresa, ve su historial y puede responder en la conversación del ticket. |
| Asesor | Panel `/dashboard`: consulta sus tickets, crea tickets y agrega actualizaciones al historial. |
| Admin | Conserva las funciones administrativas actuales, incluida la gestión de organizaciones y cuentas internas. |
| Super admin | Tiene los permisos de Admin y queda reservado para funciones adicionales de métricas. |

El rol se define en `src/features/auth/types.ts`; el estado de sesión viene de la API mediante cookie `HttpOnly`. Los componentes de sesión y guards están agrupados en `src/features/auth/`; el portal del cliente vive en `src/features/clients/`, y el detalle/conversación del ticket está en `src/features/tickets/`.

### Backend independiente

`backend/` es un proyecto Node.js + Express + MongoDB separado del frontend, con su propia instalación y compilación. La API valida cookie de sesión y carga el usuario activo desde MongoDB en cada ruta protegida. Los tickets se consultan por `organizationId` para los clientes; las reglas de negocio deben seguir aplicándose en la API, nunca solo en componentes cliente.

El backend ofrece inicio por contraseña para clientes invitados, verificación de ID tokens de Google para personal habilitado, administración de organizaciones/cuentas, persistencia de tickets y mensajes, filtros/paginación y estadísticas. El contrato de rutas está en [api-ready-contract.md](./api-ready-contract.md) y el esquema OpenAPI en `backend/openapi.yaml`.

### Estado y límites

El frontend ya usa las rutas de la API, pero conectar datos y login reales requiere configurar MongoDB, el client ID de Google y `JWT_SECRET`. Las invitaciones generan un enlace para compartir manualmente: todavía no hay proveedor SMTP ni recuperación de contraseña. El historial actual guarda mensajes visibles al cliente; notas internas requieren separar `visibility` en UI y reglas de lectura/escritura.

Antes de producción, revisar TLS/orígenes, dominio y `SameSite` de cookies, almacenamiento de secretos, entrega segura de invitaciones, auditoría, backups, monitorización y pruebas HTTP con MongoDB de test.
