const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const KnowledgeItem = require('../models/KnowledgeItem');
const Setting = require('../models/Setting');
const AIService = require('./aiService');
const NotificationService = require('./notificationService');
const WhatsAppCloudChannel = require('../channels/whatsapp-cloud');
const WhatsAppEvolutionChannel = require('../channels/whatsapp-evolution');

class MessageService {
  static async handleIncomingMessage({ phone, email, name, channel, text, mediaUrl, mediaType, metadata, notes }) {
    // 1. Buscar o crear contacto (con notas del sistema de origen)
    const contact = await Contact.findOrCreate({
      phone,
      email,
      name: name || phone || 'Visitante Web',
      channel,
      notes
    });

    // 2. Obtener/reabrir conversación persistente del contacto
    const conversation = await Conversation.findOrCreateForContact(contact.id, channel);
    const isReopened = conversation.status === 'open' && conversation.unread_count === 0;

    // Incrementar no leídos
    await Conversation.incrementUnread(conversation.id);

    // 3. Guardar el mensaje del cliente
    const customerMsg = await Message.create({
      conversation_id: conversation.id,
      sender_type: 'customer',
      text,
      media_url: mediaUrl,
      media_type: mediaType,
      metadata
    });

    // Notificar al admin por WebSocket
    NotificationService.notifyNewMessage(conversation.id, customerMsg, contact);
    NotificationService.notifyConversationUpdated(await Conversation.findById(conversation.id));

    // 4. Verificar si el bot está habilitado
    const botEnabled = (await Setting.get('BOT_ENABLED', 'true')) === 'true';

    // Si la conversación ya fue tomada por un humano, no responder automáticamente
    if (conversation.assigned_to && conversation.assigned_to > 0) {
      return customerMsg;
    }

    if (!botEnabled) return customerMsg;

    // 5. Verificar horario de atención
    const isWithinHours = await MessageService.checkBusinessHours();
    if (!isWithinHours) {
      const outOfHoursText = await Setting.get(
        'OUT_OF_HOURS_MESSAGE',
        'Gracias por escribirnos. Estamos fuera de nuestro horario de atención.'
      );
      await MessageService.sendBotResponse(conversation, contact, outOfHoursText);
      return customerMsg;
    }

    // 6. Intentar responder mediante FAQ
    const faqMatch = await KnowledgeItem.searchKeywords(text);
    if (faqMatch) {
      await MessageService.sendBotResponse(conversation, contact, faqMatch.answer);
      return customerMsg;
    }

    // 7. Intentar responder con IA
    const history = await Message.getByConversation(conversation.id, { limit: 10 });
    const aiResponse = await AIService.generateResponse(text, history);
    if (aiResponse) {
      await MessageService.sendBotResponse(conversation, contact, aiResponse);
    } else {
      // 8. Mensaje de bienvenida solo si es la primera vez que escribe (1 mensaje en historial)
      if (history.length <= 1) {
        const welcomeText = await Setting.get(
          'WELCOME_MESSAGE',
          '¡Hola! 👋 Bienvenido. Un agente te atenderá pronto.'
        );
        await MessageService.sendBotResponse(conversation, contact, welcomeText);
      }
    }

    return customerMsg;
  }

  static async sendBotResponse(conversation, contact, text) {
    const botMsg = await Message.create({
      conversation_id: conversation.id,
      sender_type: 'bot',
      text
    });

    // Enviar por canal externo si aplica
    if (conversation.channel === 'whatsapp_cloud') {
      await WhatsAppCloudChannel.sendMessage(contact.phone, text);
    } else if (conversation.channel === 'whatsapp_evolution') {
      await WhatsAppEvolutionChannel.sendMessage(contact.phone, text);
    }
    // Para webchat: el widget recibe el mensaje por Socket.IO vía NotificationService

    NotificationService.notifyNewMessage(conversation.id, botMsg, contact);
    NotificationService.notifyConversationUpdated(await Conversation.findById(conversation.id));

    return botMsg;
  }

  static async sendAgentMessage(conversationId, agentId, text, mediaUrl = null) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new Error('Conversación no encontrada');

    const contact = await Contact.findById(conversation.contact_id);

    const agentMsg = await Message.create({
      conversation_id: conversation.id,
      sender_type: 'agent',
      sender_id: agentId,
      text,
      media_url: mediaUrl
    });

    // Enviar por canal externo
    if (conversation.channel === 'whatsapp_cloud') {
      await WhatsAppCloudChannel.sendMessage(contact.phone, text, mediaUrl);
    } else if (conversation.channel === 'whatsapp_evolution') {
      await WhatsAppEvolutionChannel.sendMessage(contact.phone, text, mediaUrl);
    }
    // Para webchat el mensaje llega vía Socket.IO

    // Asignar agente si no tenía
    if (!conversation.assigned_to && agentId) {
      await Conversation.assignAgent(conversation.id, agentId);
    }

    await Conversation.resetUnread(conversation.id);
    NotificationService.notifyNewMessage(conversation.id, agentMsg, contact);
    NotificationService.notifyConversationUpdated(await Conversation.findById(conversation.id));

    return agentMsg;
  }

  static async checkBusinessHours() {
    const hoursStart = await Setting.get('BUSINESS_HOURS_START', '08:00');
    const hoursEnd = await Setting.get('BUSINESS_HOURS_END', '17:00');
    const hoursDays = (await Setting.get('BUSINESS_HOURS_DAYS', '1,2,3,4,5')).split(',').map(Number);

    const now = new Date();
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    if (!hoursDays.includes(currentDay)) return false;

    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return currentTimeStr >= hoursStart && currentTimeStr <= hoursEnd;
  }
}

module.exports = MessageService;
