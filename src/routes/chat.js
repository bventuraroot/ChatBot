const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimiter = require('../middleware/rateLimiter');
const MessageService = require('../services/messageService');
const Message = require('../models/Message');

const chatLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30 });

// Subida de imágenes para el widget web (el cliente puede adjuntar capturas)
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

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato de imagen no permitido'));
  }
});

// POST /chat/upload — Subir imagen desde el widget web
router.post('/upload', chatLimiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    res.json({
      url: `/uploads/${req.file.filename}`,
      media_type: 'image'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
