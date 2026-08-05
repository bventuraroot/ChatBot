# AGENTS.md — ChatBot Hub

Multi-channel messaging hub: WhatsApp + web widget + AI + REST API.

## Quick commands

```bash
docker compose up -d                        # Start (bind-mounted source)
docker compose restart chatbot-hub          # After code changes
docker compose up -d --force-recreate chatbot-hub  # After .env/config changes
docker compose --profile whatsapp-qr up -d   # + Evolution API
npm run seed                                 # Seed DB
```

## Architecture

| Layer | Key files |
|-------|-----------|
| Entry | `server.js` (Express + Socket.IO) |
| Routes | `src/routes/admin.js` (JWT), `api.js` (API Key), `webhook.js`, `chat.js` |
| Services | `messageService.js` (pipeline), `aiService.js`, `notificationService.js`, `dynamicResponseEngine.js` |
| Models | `src/models/*.js` — SQLite via `dbAsync` from `database/database.js` |
| Channels | `src/channels/whatsapp-cloud.js`, `whatsapp-evolution.js` |
| Frontend | `public/admin/` (vanilla JS), `public/widget/chatbot-widget.js` (embeddable) |

## Message Flow

1. `handleIncomingMessage()` → assigned_to? → BOT_ENABLED? → wantsHumanIntent? → DynamicResponseEngine (FAQ→API→AI) → fallback (hours→welcome)
2. Human intent detection triggers escalation + WhatsApp alert + panel notification

## Auth

- **Admin**: JWT via `POST /admin/api/login`
- **API**: Header `X-API-KEY`
- **QR**: `POST /admin/api/qr/generate` → poll → approve

## Database

SQLite with `dbAsync.get/all/run/exec`. Settings table = key-value with `.env` fallback.

## AI Providers

OpenAI, Gemini, OpenCode Zen, Custom (OpenAI-compatible). Configured via settings or `.env`. Debug with `DEBUG_LOGS=true`.

## Available Skills

Use `skill` tool to load detailed instructions:
- `debug-chatbot` — Diagnostic commands and troubleshooting
- `new-feature` — How to add features (architecture, auth, message flow)
- `db-migration` — Database schema changes and SQLite patterns
