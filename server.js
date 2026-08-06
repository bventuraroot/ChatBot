require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { dbAsync } = require('./database/database');
const NotificationService = require('./src/services/notificationService');

// Routers
const webhookRoutes = require('./src/routes/webhook');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');
const chatRoutes = require('./src/routes/chat');
const MessageService = require('./src/services/messageService');

const app = express();

// Confiar en proxies (Nginx/Caddy) para detectar HTTPS y IP real detrás de un reverse proxy
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Inicializar servicio de notificaciones con Socket.IO
NotificationService.init(io);

// Middlewares globales
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY', 'api_key']
}));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// Middleware explícito de headers CORS y Cross-Origin-Resource-Policy
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-KEY');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Capturar raw body para verificación de firmas de webhooks (Meta).
// El límite se sube a 10MB porque los webhooks de Evolution API pueden
// incluir media en base64 (imágenes, audio, video) que superan los 100KB
// por defecto de Express (causa PayloadTooLargeError).
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Manejo de errores de parsing del body (JSON inválido, payload demasiado grande)
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    console.error('❌ Payload demasiado grande rechazado:', err.message);
    return res.status(413).json({ error: 'Payload demasiado grande' });
  }
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    console.error('❌ JSON inválido en la petición:', err.message);
    return res.status(400).json({ error: 'JSON inválido en la petición' });
  }
  next(err);
});

// Servir archivos estáticos del panel admin y widget con headers CORS explícitos
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

// Servir archivos subidos (capturas/imágenes del chat y avatares de agentes)
const uploadsDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
}));

// Exponer io a los routers (para poder emitir desde admin.js)
app.set('io', io);

// Rutas API
app.use('/webhook', webhookRoutes);
app.use('/api/v1', apiRoutes);
app.use('/admin/api', adminRoutes);
app.use('/chat', chatRoutes);

// Redirección por defecto al panel de administración
app.get('/', (req, res) => {
  res.redirect('/admin/login.html');
});

// Manejo de conexiones WebSocket para el Chat Web de Visitantes y Admin Panel
io.on('connection', (socket) => {
  console.log('⚡ Nuevo cliente WebSocket conectado:', socket.id);

  // Registro de visitante de Chat Web: guarda contexto y envía historial
    socket.on('join_webchat', async (data) => {
    const Contact = require('./src/models/Contact');
    const Conversation = require('./src/models/Conversation');
    const Message = require('./src/models/Message');
    const Client = require('./src/models/Client');

    if (!data || !data.visitor_id) {
      return socket.emit('conversation_history', { conversation_id: null, status: 'open', messages: [] });
    }

    socket.join(`visitor_${data.visitor_id}`);
    socket.userContext = {
      visitor_id: data.visitor_id,
      name: data.name,
      email: data.email,
      role: data.role,
      system: data.system,
      client_id: data.client_id,
      page_url: data.page_url,
      page_title: data.page_title
    };
    console.log(`👤 Visitante registrado: ${data.name || data.visitor_id} [${data.system || 'web'}]${data.page_url ? ' desde ' + data.page_url : ''}`);

    // Enviar historial de mensajes al widget para que el usuario vea su conversación anterior
    try {
      let contact = null;
      if (data.visitor_id) contact = await Contact.findByPhone(data.visitor_id);
      if (!contact && data.email) contact = await Contact.findByEmail(data.email);

      // Resolver client_id desde el widget
      let clientId = null;
      if (data.client_id) {
        const client = await Client.findByWebchatIdentifier(data.client_id);
        if (client) clientId = client.id;
      }

      let conversation = null;
      if (contact) {
        conversation = await Conversation.findOrCreateForContact(contact.id, 'webchat', clientId);
      }

      const messages = conversation
        ? await Message.getByConversation(conversation.id, { limit: 100 })
        : [];

      socket.emit('conversation_history', {
        conversation_id: conversation ? conversation.id : null,
        status: conversation ? conversation.status : 'open',
        messages
      });
    } catch (err) {
      console.error('Error enviando historial al widget:', err);
      socket.emit('conversation_history', { conversation_id: null, status: 'open', messages: [] });
    }
  });

  // Mensaje recibido del visitante vía WebSocket
  socket.on('webchat_message', async (data) => {
    try {
      if (!data) return;
      const text = data.text ? String(data.text).trim() : '';
      const mediaUrl = data.media_url || null;
      const mediaType = data.media_type || null;
      if (!text && !mediaUrl) return;

      const ctx = socket.userContext || {};

      const name = data.name || ctx.name;
      const email = data.email || ctx.email;
      const visitorId = data.visitor_id || ctx.visitor_id;
      const system = data.system || ctx.system;
      const role = data.role || ctx.role;

      if (!visitorId) return;

      const notes = (() => {
        const parts = [];
        if (data.page_url) parts.push('Web: ' + data.page_url);
        if (system) parts.push('Origen: ' + system);
        if (role) parts.push('Rol: ' + role);
        return parts.length > 0 ? parts.join(' | ') : null;
      })();

      // Resolver client_id desde el contexto del socket
      let resolvedClientId = null;
      const clientIdFromCtx = data.client_id || ctx.client_id;
      if (clientIdFromCtx) {
        const Client = require('./src/models/Client');
        const client = await Client.findByWebchatIdentifier(clientIdFromCtx);
        if (client) resolvedClientId = client.id;
      }

      await MessageService.handleIncomingMessage({
        phone: visitorId,
        name: name || 'Visitante Web',
        email: email || null,
        channel: 'webchat',
        text,
        mediaUrl,
        mediaType,
        notes,
        metadata: data.metadata || { system, role },
        clientId: resolvedClientId
      });

      // Comunicar al widget cuál es SU conversación (para que filtre los
      // mensajes y no mezcle chats de otros visitantes).
      const Contact = require('./src/models/Contact');
      const Conversation = require('./src/models/Conversation');
      const contact = await Contact.findByPhone(visitorId);
      if (contact) {
        const conversation = await Conversation.findOrCreateForContact(contact.id, 'webchat', resolvedClientId);
        socket.emit('my_conversation', { conversation_id: conversation.id });
      }

      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`✅ Mensaje webchat procesado: "${text}" → ${name}`);
      }
    } catch (err) {
      console.error('❌ Error procesando mensaje de webchat:', err);
    }
  });

  // Actividad del visitante (para monitor en tiempo real)
  socket.on('visitor_activity', (data) => {
    if (!data) return;
    const ctx = socket.userContext || {};
    const activity = {
      visitor_id: ctx.visitor_id || data.visitor_id || socket.id,
      name: ctx.name || 'Visitante',
      system: ctx.system || 'web',
      page_url: ctx.page_url || data.page_url || 'unknown',
      page_title: ctx.page_title || data.page_title || '',
      type: data.type || 'unknown',
      choice: data.choice || null,
      time_on_page: data.time_on_page || null,
      time: new Date().toISOString(),
      socket_id: socket.id
    };

    // Guardar en memoria (últimos 200 eventos)
    if (!global.activityLog) global.activityLog = [];
    global.activityLog.unshift(activity);
    if (global.activityLog.length > 200) global.activityLog.length = 200;

    // Emitir al panel admin
    io.emit('admin_activity', activity);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Cliente WebSocket desconectado:', socket.id);
  });
});

// Inicialización del servidor
const PORT = process.env.PORT || 3000;

async function startServer() {
  await dbAsync.initDatabase();

  server.listen(PORT, () => {
    console.log(`
🚀 ==================================================== 🚀
   ChatBot Hub listo y escuchando en el puerto: ${PORT}
   
   📍 Panel Admin:         http://localhost:${PORT}/admin/login.html
   📱 Webhook WhatsApp:    http://localhost:${PORT}/webhook/whatsapp-cloud
   🔌 API REST Pública:    http://localhost:${PORT}/api/v1/
   🌐 Widget Web JS:       http://localhost:${PORT}/widget/chatbot-widget.js
🚀 ==================================================== 🚀
    `);
  });
}

startServer().catch((err) => {
  console.error('❌ Error al iniciar el servidor:', err);
});
