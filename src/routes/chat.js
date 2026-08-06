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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato de imagen no permitido'));
  }
});

// POST /chat/upload — Subir imagen desde el widget web
router.post('/upload', chatLimiter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      res.set('Access-Control-Allow-Origin', '*');
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'La imagen excede el límite de 50MB' });
      }
      return res.status(400).json({ error: err.message || 'Error al subir la imagen' });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
      res.json({
        url: `/uploads/${req.file.filename}`,
        media_type: 'image'
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// GET /chat/settings — Settings públicas para el widget (no requiere auth)
router.get('/settings', async (req, res) => {
  try {
    const { dbAsync } = require('../../database/database');
    const rows = await dbAsync.all("SELECT key, value FROM settings WHERE key IN ('BUG_REPORT_MESSAGE','WELCOME_MESSAGE','OUT_OF_HOURS_MESSAGE')");
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.json({});
  }
});
router.post('/message', chatLimiter, async (req, res) => {
  try {
    const { name, email, text, visitor_id, page_url, page_title } = req.body;
    if (!text) return res.status(400).json({ error: 'Texto es requerido' });

    const notes = page_url ? `Web: ${page_url}${page_title ? ' | Página: ' + page_title : ''}` : null;

    const message = await MessageService.handleIncomingMessage({
      phone: visitor_id || null,
      email,
      name: name || 'Visitante Web',
      channel: 'webchat',
      text,
      notes
    });

    if (!message) {
      return res.status(200).json({ success: false, reason: 'channel_disabled', message: 'Canal web desactivado' });
    }

    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
