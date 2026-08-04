# Guía de Instalación y Despliegue — ChatBot Hub

## Requisitos Previos
- **Node.js**: v18.0.0 o superior (verificado con Node v26)
- **NPM**: v9.0.0 o superior

## Instalación Rápida en Servidor / VPS

```bash
# 1. Entrar al directorio
cd /Volumes/ExternalHelp/Outside/htdocs/ChatBot

# 2. Instalar dependencias
npm install

# 3. Inicializar base de datos y usuario administrador por defecto
npm run seed

# 4. Iniciar el servidor
npm start
```

El servidor estará corriendo en `http://localhost:3000`.

## Configuración de Canales de WhatsApp

### 1. WhatsApp Cloud API (Oficial de Meta)
1. Ve a [Meta Developers](https://developers.facebook.com/) y crea un tipo de app **Business**.
2. Añade el producto **WhatsApp**.
3. En la sección **Configuración de WhatsApp > Webhook**:
   - URL del Webhook: `https://tu-dominio.com/webhook/whatsapp-cloud`
   - Verify Token: `chatbot_meta_verify_token_2026` (o el valor que configures en `.env`)
   - Suscríbete al campo `messages`.
4. Copia tu **Phone Number ID** y genera un **Permanent Access Token** en la configuración de Business Manager de Meta.
5. Ingrese estos datos en el Panel Admin en **Configuración > WhatsApp (Meta & QR)**.

### 2. Evolution API (Alternativa QR No Oficial)
1. Despliega una instancia de Evolution API (vía Docker o VPS).
2. Ingresa la URL y API Key en **Configuración > WhatsApp (Meta & QR)**.
3. Escanea el código QR desde WhatsApp en tu teléfono.

## Configuración de Inteligencia Artificial
1. Ve a **Configuración > Motor de IA** en el Panel Admin.
2. Selecciona **OpenAI** o **Google Gemini**.
3. Ingresa tu API Key.
4. Define la personalidad y prompt base del sistema.
