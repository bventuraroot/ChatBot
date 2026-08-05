const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/rateLimiter');
const Setting = require('../models/Setting');
const WhatsAppCloudChannel = require('../channels/whatsapp-cloud');
const WhatsAppEvolutionChannel = require('../channels/whatsapp-evolution');
const MessageService = require('../services/messageService');

const webhookLimiter = rateLimiter({ windowMs: 60 * 1000, max: 120 });
router.use(webhookLimiter);

// Handshake de verificación de Webhook de Meta (WhatsApp Cloud API)
router.get('/whatsapp-cloud', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = await Setting.get('WA_CLOUD_VERIFY_TOKEN', 'chatbot_meta_verify_token_2026');

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('✅ Webhook de WhatsApp Cloud API verificado exitosamente con Meta.');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Forbidden: Token de verificación no coincide');
    }
  }
  return res.status(400).send('Bad Request');
});

// Recepción de mensajes de WhatsApp Cloud API
router.post('/whatsapp-cloud', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED'); // Responder inmediatamente HTTP 200 a Meta

  const parsed = WhatsAppCloudChannel.parseIncomingWebhook(req.body);
  if (parsed) {
    // Extraer phone_number_id para identificar al cliente
    const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    await MessageService.handleIncomingMessage({
      phone: parsed.phone,
      name: parsed.name,
      channel: 'whatsapp_cloud',
      text: parsed.text,
      mediaUrl: parsed.mediaUrl,
      mediaType: parsed.mediaType,
      metadata: { rawMessageId: parsed.rawMessageId },
      channelData: { phone_number_id: phoneNumberId }
    });
  }
});

// Recepción de mensajes de Evolution API
router.post('/whatsapp-evolution', async (req, res) => {
  res.status(200).json({ status: 'SUCCESS' });

  const parsed = WhatsAppEvolutionChannel.parseIncomingWebhook(req.body);
  if (parsed) {
    // Extraer instance name para identificar al cliente
    const instance = req.body?.instance;

    await MessageService.handleIncomingMessage({
      phone: parsed.phone,
      name: parsed.name,
      channel: 'whatsapp_evolution',
      text: parsed.text,
      mediaUrl: parsed.mediaUrl,
      mediaType: parsed.mediaType,
      metadata: { rawMessageId: parsed.rawMessageId },
      channelData: { instance }
    });
  }
});

module.exports = router;
