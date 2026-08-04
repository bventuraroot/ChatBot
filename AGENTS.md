# AGENTS.md — ChatBot Hub

## Project Overview

Multi-channel messaging hub: WhatsApp (official + unofficial QR), web chat widget, AI auto-responses, REST API for external systems.

## Commands

```bash
npm start           # Production
npm run dev         # Development with --watch
npm run seed        # Seed DB (admin user + default FAQs)

docker compose up -d                              # Only chatbot
docker compose --profile whatsapp-qr up -d         # + Evolution API
```

## Architecture

- **server.js** — Entry point, creates Express + Socket.IO, initializes DB
- **database/schema.sql** — All table definitions (auto-creates on startup)
- **database/seed.js** — First-run seeding (admin from .env, 4 default FAQs)
- **src/models/** — SQLite models using promisified `dbAsync`
- **src/routes/admin.js** — JWT-protected admin API
- **src/routes/api.js** — API Key-protected public API
- **src/routes/webhook.js** — WhatsApp webhook endpoints
- **src/routes/chat.js** — REST fallback for webchat
- **src/services/messageService.js** — Core message pipeline (FAQ → AI → fallback)
- **src/services/aiService.js** — OpenAI & Gemini integration
- **src/channels/** — WhatsApp Cloud API and Evolution API send/parse
- **public/admin/** — Vanilla JS admin panel (dashboard, inbox, knowledge, settings)
- **public/widget/** — Embeddable chat widget with Socket.IO

## Auth Systems

1. **Admin JWT** — `POST /admin/api/login`, middleware: `authenticateToken` in `src/middleware/auth.js`
2. **API Key** — Header `X-API-KEY`, middleware: `authenticateApiKey`
3. **QR Login** — `POST /admin/api/qr/generate` → poll status → approve from phone

## Database

- SQLite via `better-sqlite3`-style wrapper (`database/database.js`)
- Tables: users, contacts, conversations, messages, knowledge_items, settings, api_keys, qr_sessions
- Settings table used as key-value store with `.env` fallback

## Message Flow

1. Incoming message arrives via webhook or WebSocket
2. `MessageService.handleIncomingMessage()` — find/create contact, conversation, save message
3. If conversation assigned to human → no auto-response
4. Check BOT_ENABLED setting → check business hours → check FAQ keywords → try AI → fallback welcome

## Key Files to Know

- `.env.example` — All configurable environment variables
- `docker-compose.yml` — Services: chatbot-hub + evolution-api (whatsapp-qr profile)
- `Dockerfile` — Multi-stage Node 20 Alpine, non-root user, wget healthcheck

## Frontend

- No framework — vanilla HTML/CSS/JS
- Admin login: `/admin/login.html` (email/password + QR)
- Admin dashboard: `/admin/index.html`
- Admin inbox: `/admin/inbox.html` (Socket.IO real-time)
- Admin knowledge base: `/admin/knowledge.html`
- Admin settings: `/admin/settings.html`
- Widget: `/widget/chatbot-widget.js` + `.css`

## Testing

No test framework configured. Manual testing:
```bash
npm run seed && npm run dev
# Open http://localhost:3000/admin/login.html
```
