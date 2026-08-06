const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const KnowledgeItem = require('../models/KnowledgeItem');
const Setting = require('../models/Setting');
const ApiKey = require('../models/ApiKey');
const Client = require('../models/Client');
const QrSession = require('../models/QrSession');
const MessageService = require('../services/messageService');
const { dbAsync } = require('../../database/database');

const loginLimiter = rateLimiter({ windowMs: 60 * 1000, max: 10 });

// Configuración de subida de archivos (capturas/imágenes del agente)
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato de archivo no permitido'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Login de usuario admin/agente
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });
  }

  const user = await User.findByEmail(email);
  if (!user || !(await User.verifyPassword(user, password))) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '7d'
  });

  delete user.password;
  res.json({ token, user });
});

// --- QR LOGIN ENDPOINTS ---

// POST /admin/api/qr/generate — Genera un token de sesión QR
router.post('/qr/generate', async (req, res) => {
  try {
    const session = await QrSession.create();
    res.json({ token: session.token, expiresAt: session.expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/api/qr/status/:token — Polling del estado del QR
router.get('/qr/status/:token', async (req, res) => {
  try {
    const status = await QrSession.getStatus(req.params.token);
    
    if (status.status === 'approved' && status.user_id) {
      const user = await User.findById(status.user_id);
      if (user) {
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        delete user.password;
        return res.json({ status: 'approved', token, user });
      }
    }
    
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/api/qr/info/:token — Info de sesión QR (para mostrar en página de escaneo)
router.get('/qr/info/:token', async (req, res) => {
  try {
    const session = await QrSession.findByToken(req.params.token);
    if (!session) return res.status(404).json({ error: 'Sesión QR no encontrada' });
    if (new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Sesión QR expirada' });
    }
    res.json({ token: session.token, status: session.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/api/qr/image/:token — Devuelve la imagen QR en SVG
router.get('/qr/image/:token', async (req, res) => {
  try {
    const session = await QrSession.findByToken(req.params.token);
    if (!session) return res.status(404).json({ error: 'Sesión no encontrada' });
    if (new Date(session.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Sesión expirada' });
    }

    const scanUrl = `${req.protocol}://${req.get('host')}/admin/qr-scan.html?token=${session.token}`;
    const qrSvg = await QRCode.toString(scanUrl, { type: 'svg', width: 256, margin: 2 });
    res.set('Content-Type', 'image/svg+xml');
    res.send(qrSvg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Todas las rutas siguientes requieren autenticación JWT
router.use(authenticateToken);

// POST /admin/api/qr/approve — Aprobar login por QR (requiere autenticación)
router.post('/qr/approve', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token QR requerido' });

    await QrSession.approve(token, req.user.id);
    res.json({ success: true, message: 'Login QR aprobado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/api/qr/reject — Rechazar login por QR (requiere autenticación)
router.post('/qr/reject', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token QR requerido' });

    await QrSession.reject(token);
    res.json({ success: true, message: 'Login QR rechazado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/me
router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

// PUT /admin/me — Actualizar perfil del agente (nombre, email, avatar)
router.put('/me', async (req, res) => {
  try {
    const { name, email, avatar } = req.body;
    const user = await User.update(req.user.id, { name, email, avatar });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/me/avatar — Subir foto de perfil del agente
router.post('/me/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    const user = await User.update(req.user.id, { avatar: avatarUrl });
    res.json({ user, avatar: avatarUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/upload — Subir captura/imagen para enviar en el chat
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    res.json({
      url: `/uploads/${req.file.filename}`,
      media_type: req.file.mimetype.startsWith('image/') ? 'image' : 'document'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/stats — Estadísticas para el Dashboard
router.get('/stats', async (req, res) => {
  try {
    const totalConversations = await dbAsync.get('SELECT COUNT(*) as count FROM conversations');
    const openConversations = await dbAsync.get('SELECT COUNT(*) as count FROM conversations WHERE status = "open"');
    const totalContacts = await dbAsync.get('SELECT COUNT(*) as count FROM contacts');
    const messagesToday = await dbAsync.get(
      'SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date("now")'
    );

    const channelStats = await dbAsync.all(
      'SELECT channel, COUNT(*) as count FROM conversations GROUP BY channel'
    );

    res.json({
      total_conversations: totalConversations.count,
      open_conversations: openConversations.count,
      total_contacts: totalContacts.count,
      messages_today: messagesToday.count,
      channel_stats: channelStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/conversations — Lista de conversaciones para la bandeja de entrada
router.get('/conversations', async (req, res) => {
  try {
    const { status, channel, assigned_to } = req.query;
    const conversations = await Conversation.getAll({ status, channel, assigned_to });
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/conversations/:id/messages
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });

    // Resetear no leídos al abrir la conversación
    await Conversation.resetUnread(req.params.id);

    const messages = await Message.getByConversation(req.params.id);
    res.json({ conversation, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/conversations/:id/messages — Responder desde la bandeja de entrada
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { text, media_url, media_type } = req.body;
    if (!text && !media_url) {
      return res.status(400).json({ error: 'Debes escribir un mensaje o adjuntar una imagen' });
    }

    const message = await MessageService.sendAgentMessage(req.params.id, req.user.id, text || '', media_url, media_type);
    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/conversations/:id/status
router.put('/conversations/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const conversation = await Conversation.updateStatus(req.params.id, status);

    // Notificar al widget del cliente si el canal es webchat
    const io = req.app.get('io');
    if (io && conversation.channel === 'webchat') {
      const contact = await Contact.findById(conversation.contact_id);
      if (contact && contact.phone) {
        if (status === 'closed') {
          io.to(`visitor_${contact.phone}`).emit('conversation_closed', {
            conversation_id: conversation.id,
            message: 'La conversación ha sido finalizada por el agente.'
          });
        } else if (status === 'open') {
          io.to(`visitor_${contact.phone}`).emit('conversation_reopened', {
            conversation_id: conversation.id
          });
        }
      }
    }

    // Notificar a la bandeja del admin
    const NotificationService = require('../services/notificationService');
    NotificationService.notifyConversationUpdated(conversation);

    res.json({ conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /admin/conversations/:id/assign
router.put('/conversations/:id/assign', async (req, res) => {
  try {
    const { userId } = req.body;
    const conversation = await Conversation.assignAgent(req.params.id, userId);
    res.json({ conversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/contacts/:id/history — Historial completo de conversaciones de un contacto
router.get('/contacts/:id/history', async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ error: 'Contacto no encontrado' });

    const conversations = await Conversation.getAllByContact(req.params.id);
    res.json({ contact, conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BASE DE CONOCIMIENTO (FAQ) ---
router.get('/knowledge', async (req, res) => {
  try {
    const items = await KnowledgeItem.getAll({ activeOnly: false });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/knowledge', async (req, res) => {
  try {
    const { category, question, answer, keywords, match_type, priority } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ error: 'Pregunta y respuesta son requeridas' });
    }
    const item = await KnowledgeItem.create({
      category,
      question,
      answer,
      keywords,
      match_type: match_type || 'keyword',
      priority: parseInt(priority, 10) || 0
    });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/knowledge/:id', async (req, res) => {
  try {
    const item = await KnowledgeItem.update(req.params.id, req.body);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/knowledge/:id', async (req, res) => {
  try {
    await KnowledgeItem.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CONFIGURACIONES ---
router.get('/settings', async (req, res) => {
  try {
    const settings = await Setting.getAll();
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    await Setting.setMultiple(req.body);
    res.json({ success: true, settings: await Setting.getAll() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API KEYS ---
router.get('/api-keys', async (req, res) => {
  try {
    const keys = await ApiKey.getAll();
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api-keys', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre para la API Key es requerido' });
    const keyData = await ApiKey.create(name);
    res.json({ key: keyData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api-keys/:id', async (req, res) => {
  try {
    await ApiKey.revoke(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USUARIOS ---
router.get('/users', async (req, res) => {
  try {
    const users = await User.getAll();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    }
    const user = await User.create({ name, email, password, role });
    delete user.password;
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const user = await User.update(req.params.id, { name, email, role });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await User.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CLIENTES (Multi-Tenant) ---
router.get('/clients', async (req, res) => {
  try {
    const clients = await Client.getAll({ activeOnly: false });
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre del cliente es requerido' });
    const client = await Client.create(req.body);
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/clients/:id', async (req, res) => {
  try {
    const client = await Client.update(req.params.id, req.body);
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/clients/:id', async (req, res) => {
  try {
    await Client.delete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /conversations/:id — Eliminar conversación y sus mensajes
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const Conversation = require('../models/Conversation');
    const conversation = await Conversation.findById(id);
    if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });

    await Conversation.delete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /activity — Últimos eventos de actividad (monitor)
router.get('/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const log = global.activityLog || [];
  res.json(log.slice(0, limit));
});

module.exports = router;
