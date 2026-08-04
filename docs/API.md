# Documentación de la API REST Pública — ChatBot Hub

La API REST permite enviar mensajes, consultar conversaciones y gestionar contactos desde sistemas externos (como tu sistema de contabilidad en Laravel).

## Autenticación
Todas las peticiones a la API REST deben incluir el header `X-API-KEY` con una clave válida creada desde el Panel Admin (**Configuración > API Keys Sistema**).

```http
X-API-KEY: cb_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Endpoints

### 1. Enviar Mensaje a un Cliente
Envía un mensaje por WhatsApp o WebChat a un número o cliente específico.

**POST** `/api/v1/messages/send`

**Headers:**
`Content-Type: application/json`  
`X-API-KEY: cb_live_...`

**Body (JSON):**
```json
{
  "phone": "50312345678",
  "name": "Juan Pérez",
  "channel": "whatsapp_cloud",
  "text": "Hola Juan, tu factura #F-1024 ha sido generada exitosamente.",
  "media_url": "https://tu-dominio.com/facturas/pdf/1024.pdf"
}
```

**Respuesta (200 OK):**
```json
{
  "success": true,
  "message_id": 42,
  "conversation_id": 8,
  "contact": {
    "id": 5,
    "name": "Juan Pérez",
    "phone": "50312345678",
    "channel": "whatsapp_cloud"
  }
}
```

---

### 2. Listar Conversaciones
Obtiene las conversaciones activas o históricas.

**GET** `/api/v1/conversations?status=open&limit=20`

**Headers:**
`X-API-KEY: cb_live_...`

**Respuesta (200 OK):**
```json
{
  "conversations": [
    {
      "id": 8,
      "contact_id": 5,
      "contact_name": "Juan Pérez",
      "contact_phone": "50312345678",
      "channel": "whatsapp_cloud",
      "status": "open",
      "unread_count": 0,
      "last_message_text": "Hola Juan, tu factura #F-1024 ha sido generada...",
      "last_message_at": "2026-08-04T00:30:00Z"
    }
  ]
}
```

---

### 3. Obtener Mensajes de una Conversación

**GET** `/api/v1/conversations/:id/messages`

**Headers:**
`X-API-KEY: cb_live_...`

**Respuesta (200 OK):**
```json
{
  "messages": [
    {
      "id": 101,
      "sender_type": "customer",
      "text": "Hola, ¿tienen mi factura?",
      "created_at": "2026-08-04T00:28:00Z"
    },
    {
      "id": 102,
      "sender_type": "agent",
      "text": "Hola Juan, tu factura #F-1024 ha sido generada...",
      "created_at": "2026-08-04T00:30:00Z"
    }
  ]
}
```
