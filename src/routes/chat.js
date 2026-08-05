const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/rateLimiter');
const MessageService = require('../services/messageService');
const Message = require('../models/Message');

const chatLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30 });

// POST /chat/message — Enviar mensaje desde el widget web vía REST (si no usa socket)
router.post('/message', chatLimiter, async (req, res) => {
  try {
    const { name, email, text, visitor_id } = req.body;
    if (!text) return res.status(400).json({ error: 'Texto es requerido' });

    const message = await MessageService.handleIncomingMessage({
      phone: visitor_id || null,
      email,
      name: name || 'Visitante Web',
      channel: 'webchat',
      text
    });

    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
