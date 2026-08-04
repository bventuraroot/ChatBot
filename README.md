# ChatBot Hub

Centro de Mensajería Multicanal con WhatsApp, Web Chat, IA y API REST.

## Capacidades

- **WhatsApp** — Conexión oficial (Meta Cloud API) y no oficial (Evolution API con QR)
- **Web Chat** — Widget embebible en cualquier sitio web con Socket.IO en tiempo real
- **IA Auto-Respuestas** — OpenAI GPT-3.5 turbo y Google Gemini 1.5 Flash
- **API REST** — Integración con sistemas externos (Laravel, contabilidad, etc.)
- **Panel Admin** — Dashboard, bandeja de entrada live, base de conocimiento y configuración
- **Login por QR** — Inicia sesión en el panel escaneando un código QR desde un dispositivo ya autenticado

## Stack

| Tecnología | Uso |
|---|---|
| Node.js 20+ | Runtime |
| Express.js 4.x | Servidor HTTP |
| Socket.IO 4.x | WebSockets tiempo real |
| SQLite3 | Base de datos embebida |
| JWT | Autenticación admin |
| bcryptjs | Hashing de contraseñas |
| Docker | Contenedor multi-stage Alpine |

## Inicio Rápido

### Requisitos

- Node.js 18+
- npm

### Instalación Local

```bash
git clone <repo-url> chatbot-hub
cd chatbot-hub
cp .env.example .env
npm install
npm run seed    # Crea admin y FAQs iniciales
npm run dev     # Modo desarrollo con watch
```

El panel de administración estará en `http://localhost:3000/admin/login.html`

### Credenciales por Defecto

- Email: `admin@chatbot.local`
- Contraseña: `admin123456`

Modifica `.env` para cambiarlas antes del primer `seed`.

### Docker

```bash
# Solo la app
docker compose up -d

# App + Evolution API (WhatsApp no oficial con QR)
docker compose --profile whatsapp-qr up -d
```

Más detalles en [`docs/DOCKER-DEPLOY.md`](docs/DOCKER-DEPLOY.md)

## Autenticación

El proyecto tiene dos sistemas de autenticación separados:

### 1. Panel Admin (JWT)

- Login email/password en `/admin/login.html`
- Login por QR: escanea el código QR desde un dispositivo ya logueado
- Token JWT válido por 7 días
- Roles: `admin` y `agent`

### 2. API Pública (API Key)

- Header `X-API-KEY` o query `api_key`
- Formato: `cb_live_` + 48 caracteres hex
- Gestionado desde el panel admin

## Estructura del Proyecto

```
ChatBot/
├── server.js                  # Punto de entrada
├── package.json
├── Dockerfile                 # Multi-stage Alpine
├── docker-compose.yml
├── database/
│   ├── schema.sql             # Tablas
│   ├── database.js            # Conexión SQLite
│   └── seed.js                # Datos iniciales
├── src/
│   ├── channels/              # WhatsApp Cloud API y Evolution API
│   ├── middleware/            # JWT auth, API key auth, rate limiter
│   ├── models/                # SQLite models
│   ├── routes/                # Endpoints Express
│   └── services/              # Lógica de negocio
├── public/
│   ├── admin/                 # Panel de administración
│   └── widget/                # Widget de chat embebible
└── docs/                      # Documentación adicional
```

## Configuración de Canales

### WhatsApp Cloud API (Meta Oficial)

1. Crea una app en [Meta for Developers](https://developers.facebook.com/)
2. Configura un número de WhatsApp Business
3. En el panel admin `Settings > WhatsApp Meta`, ingresa:
   - Phone Number ID
   - Access Token
   - Verify Token
4. Configura el webhook en Meta apuntando a `https://tu-dominio.com/webhook/whatsapp-cloud`

### Evolution API (WhatsApp No Oficial - QR)

1. Levanta con `docker compose --profile whatsapp-qr up -d`
2. En `Settings > WhatsApp QR`, ingresa la API Key (default: `chatbot_evolution_key_2026`)
3. El webhook se configura automáticamente vía variables de entorno en docker-compose

## API REST (Sistemas Externos)

Todas las rutas bajo `/api/v1/*` requieren API Key.

### Enviar Mensaje

```bash
curl -X POST https://tu-dominio.com/api/v1/messages/send \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: cb_live_..." \
  -d '{"phone": "521234567890", "name": "Juan Pérez", "text": "Hola desde el sistema"}'
```

### Listar Conversaciones

```bash
curl https://tu-dominio.com/api/v1/conversations \
  -H "X-API-KEY: cb_live_..."
```

Ver [`docs/API.md`](docs/API.md) para la documentación completa.

## Widget Web

```html
<script src="https://tu-dominio.com/widget/chatbot-widget.js"
  data-server="https://tu-dominio.com"
  data-title="ChatBot Hub"
  data-color="#3b82f6"
  data-user-name="Usuario"
  data-user-email="usuario@ejemplo.com"
  data-system="mi-sistema">
</script>
```

## Licencia

MIT
