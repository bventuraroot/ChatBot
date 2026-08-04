const axios = require('axios');
const Setting = require('../models/Setting');

class WhatsAppCloudChannel {
  static async sendMessage(toPhone, text, mediaUrl = null) {
    const phoneNumberId = await Setting.get('WA_CLOUD_PHONE_NUMBER_ID');
    const accessToken = await Setting.get('WA_CLOUD_ACCESS_TOKEN');

    if (!phoneNumberId || !accessToken) {
      console.warn('⚠️ WhatsApp Cloud API no está configurado correctamente (faltan ID o Token).');
      return { success: false, error: 'WhatsApp Cloud API no configurado' };
    }

    try {
      const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace(/[^0-9]/g, ''), // Asegurar solo dígitos
        type: 'text',
        text: { preview_url: false, body: text }
      };

      if (mediaUrl) {
        payload.type = 'image';
        payload.image = { link: mediaUrl, caption: text };
        delete payload.text;
      }

      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return { success: true, messageId: response.data.messages[0]?.id };
    } catch (error) {
      console.error('❌ Error enviando mensaje por WhatsApp Cloud API:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  static parseIncomingWebhook(body) {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value || !value.messages || value.messages.length === 0) {
        return null; // Es una notificación de estado (entregado, leído, etc.)
      }

      const contact = value.contacts?.[0];
      const message = value.messages[0];

      let text = '';
      let mediaUrl = null;
      let mediaType = null;

      if (message.type === 'text') {
        text = message.text?.body || '';
      } else if (['image', 'document', 'audio', 'video'].includes(message.type)) {
        mediaType = message.type;
        text = message[message.type]?.caption || `[${message.type.toUpperCase()}]`;
      }

      return {
        phone: message.from,
        name: contact?.profile?.name || message.from,
        text,
        mediaUrl,
        mediaType,
        rawMessageId: message.id,
        timestamp: message.timestamp
      };
    } catch (err) {
      console.error('❌ Error parsing WhatsApp Cloud webhook:', err);
      return null;
    }
  }
}

module.exports = WhatsAppCloudChannel;
