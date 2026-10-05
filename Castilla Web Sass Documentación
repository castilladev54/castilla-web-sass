QUE ES CASTILLA WEB SASS. Voy a analizar el repositorio y ayudarte a implementar la facturación electrónica para el carrito de compras. Primero, comenzaré explorando la estructura del repositorio.

Información adicional recopilada

Obtención de datos de /repos/castilladev54/castilla-web-sass.

Ahora voy a obtener la estructura del repositorio y los archivos principales.

Consultas realizadas:

Obtención de datos de /repos/castilladev54/castilla-web-sass/contents.

Exploración de la estructura del backend para comprender la implementación actual de las ventas y planificar la funcionalidad de facturación.

Consulta de los modelos ubicados en apps/backend/models.

Búsqueda del esquema del modelo Sale.

Revisión del archivo apps/backend/server.ts.

Búsqueda del modelo Customer.

Ahora tengo una visión general del repositorio. A continuación, presento el análisis y el plan de implementación de la facturación electrónica.

¿Qué es CastillaWeb?

CastillaWeb es un sistema SaaS de punto de venta (POS) y gestión de inventario multiempresa, desarrollado con React 19, TypeScript, Express 5 y MongoDB. Está diseñado para comercios minoristas, particularmente en Venezuela, y permite gestionar transacciones de venta, inventario de múltiples sucursales, turnos de empleados y análisis financieros con información proporcionada por inteligencia artificial.

Tecnologías utilizadas

Lenguajes: TypeScript (67,3 %) y JavaScript (32,5 %), con una migración progresiva hacia TypeScript.

Frameworks y entorno: Node.js 20+, Express 5.2, React 19 y Vite.

Bibliotecas destacadas: Mongoose 9.2, Zustand 5.0, Tailwind CSS 4.2, React Router 7, Recharts, Big.js para operaciones decimales, Upstash Redis, Google Gemini AI y Zod para validaciones.

Estructura del proyecto
castilla-web-sass/
├── apps/
│   ├── backend/                   # API Express con Node.js
│   │   ├── server.ts              # Punto de entrada y middleware
│   │   ├── controllers/           # Controladores HTTP
│   │   ├── services/              # Lógica de negocio y transacciones
│   │   ├── models/                # Modelos de Mongoose
│   │   ├── middleware/            # Autenticación y seguridad
│   │   ├── routes/                # Rutas de la API
│   │   ├── validations/            # Esquemas de validación Zod
│   │   └── tests/                 # Pruebas con Vitest y Supertest
│   └── frontend/                  # Aplicación React + Vite
│       └── src/
│           ├── components/        # Componentes de interfaz
│           ├── pages/             # Páginas de la aplicación
│           ├── store/             # Estados globales con Zustand
│           └── hooks/             # Hooks personalizados
├── packages/
│   └── shared/                    # Tipos compartidos
└── pnpm-workspace.yaml

Cómo se integra: las solicitudes pasan del frontend React al backend Express mediante Axios. El backend valida los tokens JWT, aplica los permisos correspondientes y ejecuta operaciones en MongoDB. Las ventas y compras actualizan el inventario mediante transacciones. Redis almacena en caché los datos consultados frecuentemente, mientras que el asistente de IA utiliza información agregada y puede transmitir respuestas mediante SSE.

Cómo ejecutar el proyecto

Instalar las dependencias desde la raíz:

pnpm install

Iniciar el backend en modo desarrollo:

pnpm --filter @inventory/backend run dev

Iniciar el frontend en otra terminal:

pnpm --filter @inventory/frontend run dev

Ejecutar las pruebas del backend:

pnpm --filter @inventory/backend run test
Variables de entorno necesarias

Archivo .env dentro de apps/backend:

MONGO_URI=mongodb+srv://...
JWT_SECRET=your_secret
CLIENT_URL=http://localhost:5173
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
GEMINI_API_KEY=...
PORT=3000
