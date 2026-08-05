const axios = require('axios');
const Setting = require('../models/Setting');

class WhatsAppEvolutionChannel {
  static async sendMessage(toPhone, text, mediaUrl = null) {
    const apiUrl = await Setting.get('EVOLUTION_API_URL', 'http://localhost:8080');
    const apiKey = await Setting.get('EVOLUTION_API_KEY');
    const instance = await Setting.get('EVOLUTION_INSTANCE_NAME', 'chatbot_instance');

    if (!apiUrl || !apiKey) {
      console.warn('⚠️ Evolution API no está configurado (falta URL o API Key).');
      return { success: false, error: 'Evolution API no configurado' };
    }

    try {
      const endpoint = mediaUrl
        ? `${apiUrl}/message/sendMedia/${instance}`
        : `${apiUrl}/message/sendText/${instance}`;

      const payload = mediaUrl
        ? {
            number: toPhone.replace(/[^0-9]/g, ''),
            media: mediaUrl,
            caption: text,
            mediatype: 'image'
          }
        : {
            number: toPhone.replace(/[^0-9]/g, ''),
            options: { delay: 1200, presence: 'composing' },
            textMessage: { text }
          };

      const response = await axios.post(endpoint, payload, {
        headers: {
          apikey: apiKey,
          'Content-Type': 'application/json'
        }
      });

      return { success: true, response: response.data };
    } catch (error) {
      console.error('❌ Error enviando mensaje por Evolution API:', error.response?.data || error.message);
      return { success: false, error: error.response?.data || error.message };
    }
  }

  static parseIncomingWebhook(body) {
    try {
      if (body.event !== 'messages.upsert') return null;

      const data = body.data;
      if (!data || data.key?.fromMe) return null; // Ignorar mensajes enviados por nosotros

      const phone = data.key?.remoteJid?.split('@')[0];
      const name = data.pushName || phone;

      const msg = data.message || {};
      let text = '';
      let mediaType = null;
      let mediaUrl = null;

      // Texto plano
      if (msg.conversation) {
        text = msg.conversation;
      } else if (msg.extendedTextMessage?.text) {
        text = msg.extendedTextMessage.text;
      } else if (msg.imageMessage) {
        mediaType = 'image';
        text = msg.imageMessage.caption || '[IMAGEN]';
      } else if (msg.videoMessage) {
        mediaType = 'video';
        text = msg.videoMessage.caption || '[VIDEO]';
      } else if (msg.documentMessage) {
        mediaType = 'document';
        text = msg.documentMessage.caption || '[DOCUMENTO]';
      } else if (msg.audioMessage) {
        mediaType = 'audio';
        text = '[AUDIO]';
      } else if (msg.pttMessage) {
        mediaType = 'audio';
        text = '[NOTA DE VOZ]';
      } else if (msg.stickerMessage) {
        mediaType = 'sticker';
        text = '[STICKER]';
      } else if (msg.contactMessage) {
        text = '[CONTACTO]';
      } else if (msg.locationMessage) {
        text = '[UBICACIÓN]';
      } else if (msg.buttonsResponseMessage) {
        text = msg.buttonsResponseMessage.selectedButtonId || '[RESPUESTA]';
      } else if (msg.listResponseMessage) {
        text = msg.listResponseMessage.singleSelectReply?.selectedRowId || '[SELECCIÓN]';
      } else if (msg.viewOnceMessage) {
        // Mensajes con visualización única (imagen/video)
        const inner = msg.viewOnceMessage.message || {};
        if (inner.imageMessage) { mediaType = 'image'; text = '[IMAGEN]'; }
        else if (inner.videoMessage) { mediaType = 'video'; text = '[VIDEO]'; }
        else text = '[MENSAJE]';
      }

      // Intentar extraer URL de media si está disponible en el webhook
      if (mediaType) {
        const media = msg[`${mediaType}Message`];
        if (media?.url) mediaUrl = media.url;
      }

      return {
        phone,
        name,
        text,
        mediaUrl,
        mediaType,
        rawMessageId: data.key?.id
      };
    } catch (err) {
      console.error('❌ Error parsing Evolution API webhook:', err);
      return null;
    }
  }
}

module.exports = WhatsAppEvolutionChannel;
