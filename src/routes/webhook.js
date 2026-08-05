const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const rateLimiter = require('../middleware/rateLimiter');
const Setting = require('../models/Setting');
const WhatsAppCloudChannel = require('../channels/whatsapp-cloud');
const WhatsAppEvolutionChannel = require('../channels/whatsapp-evolution');
const MessageService = require('../services/messageService');

const webhookLimiter = rateLimiter({ windowMs: 60 * 1000, max: 120 });
router.use(webhookLimiter);

// Verifica la firma X-Hub-Signature-256 de Meta (WhatsApp Cloud API)
// para evitar que terceros envíen mensajes falsos al webhook.
async function verifyMetaSignature(req, rawBody) {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = await Setting.get('WA_CLOUD_APP_SECRET');
  if (!appSecret || !signature) return true; // Si no está configurado, no bloquear (modo dev)

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (err) {
    return false;
  }
}

// Handshake de verificación de Webhook de Meta (WhatsApp Cloud API)
router.get('/whatsapp-cloud', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('❌ Error verificando webhook de Meta:', err);
    return res.status(500).send('Internal Server Error');
  }
});

// Recepción de mensajes de WhatsApp Cloud API
router.post('/whatsapp-cloud', (req, res) => {
  res.status(200).send('EVENT_RECEIVED'); // Responder inmediatamente HTTP 200 a Meta

  // Procesar de forma asíncrona sin bloquear la respuesta
  (async () => {
    if (!(await verifyMetaSignature(req, req.rawBody || JSON.stringify(req.body)))) {
      console.warn('⚠️ Firma de webhook de Meta inválida, mensaje ignorado.');
      return;
    }

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
  })().catch((err) => {
    console.error('❌ Error procesando webhook de WhatsApp Cloud:', err);
  });
});

// Recepción de mensajes de Evolution API
router.post('/whatsapp-evolution', (req, res) => {
  res.status(200).json({ status: 'SUCCESS' });

  (async () => {
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
  })().catch((err) => {
    console.error('❌ Error procesando webhook de Evolution:', err);
  });
});

module.exports = router;
