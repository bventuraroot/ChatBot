const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const MessageService = require('../services/messageService');
const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const apiLimiter = rateLimiter({ windowMs: 60 * 1000, max: 60 });
router.use(apiLimiter);
router.use(authenticateApiKey);

// POST /api/v1/messages/send — Enviar un mensaje a un cliente
router.post('/messages/send', async (req, res) => {
  try {
    const { phone, name, channel = 'whatsapp_cloud', text, media_url = null } = req.body;

    if (!phone || !text) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos: phone, text' });
    }

    const contact = await Contact.findOrCreate({
      phone,
      name: name || phone,
      channel
    });

    const conversation = await Conversation.findOrCreateForContact(contact.id, channel);

    const message = await MessageService.sendAgentMessage(conversation.id, null, text, media_url);

    res.json({
      success: true,
      message_id: message.id,
      conversation_id: conversation.id,
      contact
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/conversations — Listar conversaciones
router.get('/conversations', async (req, res) => {
  try {
    const { status, channel, limit = 50, offset = 0 } = req.query;
    const conversations = await Conversation.getAll({
      status,
      channel,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/conversations/:id/messages — Obtener historial de una conversación
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const messages = await Message.getByConversation(req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/contacts — Listar o buscar contactos
router.get('/contacts', async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;
    const contacts = await Contact.getAll({ search, limit: parseInt(limit), offset: parseInt(offset) });
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
