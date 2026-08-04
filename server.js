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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del panel admin y widget con headers CORS explícitos
app.use(express.static(path.join(__dirname, 'public'), {
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

    socket.join(`visitor_${data.visitor_id}`);
    socket.userContext = {
      visitor_id: data.visitor_id,
      name: data.name,
      email: data.email,
      role: data.role,
      system: data.system
    };
    console.log(`👤 Visitante registrado: ${data.name || data.visitor_id} [${data.system || 'web'}]`);

    // Enviar historial de mensajes al widget para que el usuario vea su conversación anterior
    try {
      let contact = null;
      if (data.visitor_id) contact = await Contact.findByPhone(data.visitor_id);
      if (!contact && data.email) contact = await Contact.findByEmail(data.email);

      if (contact) {
        const conversation = await Conversation.findOrCreateForContact(contact.id, 'webchat');
        const messages = await Message.getByConversation(conversation.id, { limit: 100 });
        socket.emit('conversation_history', {
          conversation_id: conversation.id,
          status: conversation.status,
          messages
        });
      }
    } catch (err) {
      console.error('Error enviando historial al widget:', err);
    }
  });

  // Mensaje recibido del visitante vía WebSocket
  socket.on('webchat_message', async (data) => {
    try {
      const ctx = socket.userContext || {};
      const { text } = data;

      const name = data.name || ctx.name;
      const email = data.email || ctx.email;
      const visitorId = data.visitor_id || ctx.visitor_id;
      const system = data.system || ctx.system;
      const role = data.role || ctx.role;

      const notes = system
        ? `Origen: ${system}${role ? ' | Rol: ' + role : ''}`
        : null;

      await MessageService.handleIncomingMessage({
        phone: visitorId,
        name: name || 'Visitante Web',
        email: email || null,
        channel: 'webchat',
        text,
        notes,
        metadata: { system, role }
      });
    } catch (err) {
      console.error('❌ Error procesando mensaje de webchat:', err);
    }
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
