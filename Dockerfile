# ============================================
# ChatBot Hub — Dockerfile Multi-Stage
# ============================================
FROM node:20-alpine AS base

# Instalar dependencias nativas para sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar solo manifiestos primero para cachear dependencias
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ============================================
# Etapa de producción
# ============================================
FROM node:20-alpine AS production

# Instalar wget para healthcheck
RUN apk add --no-cache wget

# Crear usuario no-root para seguridad
RUN addgroup -S chatbot && adduser -S chatbot -G chatbot

WORKDIR /app

# Copiar dependencias compiladas desde la etapa base
COPY --from=base /app/node_modules ./node_modules

# Copiar código fuente de la aplicación
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY database/schema.sql ./database/schema.sql
COPY database/database.js ./database/database.js
COPY database/seed.js ./database/seed.js

# Crear directorio para la base de datos persistente y archivos subidos
RUN mkdir -p /app/data /app/uploads && \
    chown -R chatbot:chatbot /app

USER chatbot

# Puerto por defecto
EXPOSE 3000

# Health check para que Docker y orquestadores sepan si la app está viva
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Comando de inicio: inicializa la BD y arranca el servidor
CMD ["sh", "-c", "node database/seed.js && node server.js"]
