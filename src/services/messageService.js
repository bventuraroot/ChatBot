const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Client = require('../models/Client');
const Setting = require('../models/Setting');
const DynamicResponseEngine = require('./dynamicResponseEngine');
const NotificationService = require('./notificationService');
const WhatsAppCloudChannel = require('../channels/whatsapp-cloud');
const WhatsAppEvolutionChannel = require('../channels/whatsapp-evolution');

class MessageService {
  static async handleIncomingMessage({ phone, email, name, channel, text, mediaUrl, mediaType, metadata, notes, clientId, channelData }) {
    // 1. Determinar el cliente (multi-tenant)
    let client = null;
    if (clientId) {
      client = await Client.findById(clientId);
    } else if (channelData) {
      client = await Client.findByChannel(channel, channelData);
    }
    const resolvedClientId = client ? client.id : null;

    // 2. Buscar o crear contacto
    const contact = await Contact.findOrCreate({
      phone,
      email,
      name: name || phone || 'Visitante Web',
      channel,
      notes,
      client_id: resolvedClientId
    });

    // 3. Obtener/reabrir conversación persistente del contacto
    const conversation = await Conversation.findOrCreateForContact(contact.id, channel, resolvedClientId);

    // Incrementar no leídos
    await Conversation.incrementUnread(conversation.id);

    // 4. Guardar el mensaje del cliente
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

    // 5. Verificar si la conversación fue tomada por un humano
    if (conversation.assigned_to && conversation.assigned_to > 0) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🚫 Bot no responde: conversación ${conversation.id} asignada a agente (${conversation.assigned_to})`);
      }
      return customerMsg;
    }

    // 6. Verificar si el bot está habilitado (global o por cliente)
    const botEnabled = client
      ? client.bot_enabled === 1
      : (await Setting.get('BOT_ENABLED', 'true')) === 'true';
    if (!botEnabled) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log('🚫 Bot no responde: BOT_ENABLED está en false');
      }
      return customerMsg;
    }

    // 7. Verificar horario de atención (global o por cliente)
    const isWithinHours = await MessageService.checkBusinessHours(client);
    if (!isWithinHours) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log('🕐 Fuera de horario: respondiendo mensaje de fuera de horas');
      }
      const outOfHoursText = client && client.out_of_hours_message
        ? client.out_of_hours_message
        : await Setting.get(
            'OUT_OF_HOURS_MESSAGE',
            'Gracias por escribirnos. Estamos fuera de nuestro horario de atención.'
          );
      await MessageService.sendBotResponse(conversation, contact, outOfHoursText);
      return customerMsg;
    }

    // 8. Buscar respuesta inteligente (FAQ mejorado + API externa)
    const history = await Message.getByConversation(conversation.id, { limit: 10 });
    if (process.env.DEBUG_LOGS === 'true') {
      console.log(`🤖 Dentro de horario, bot activo. Buscando respuesta para: "${text}"`);
    }
    const response = await DynamicResponseEngine.findResponse(text, resolvedClientId, contact, history);

    if (response) {
      await MessageService.sendBotResponse(conversation, contact, response.answer);

      // Si la IA decide que el cliente necesita un humano, avisar al admin
      // por WhatsApp y asignar la conversación para que la responda.
      if (response.wantsHuman) {
        await MessageService.escalateToHuman(conversation, contact, text);
      }
    } else {
      // 9. Sin respuesta → mensaje de bienvenida (solo primera interacción)
      if (history.length <= 1) {
        const welcomeText = client && client.welcome_message
          ? DynamicResponseEngine.renderTemplate(client.welcome_message, contact)
          : await Setting.get('WELCOME_MESSAGE', '¡Hola! 👋 Bienvenido. Un agente te atenderá pronto.');
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

  // Escala la conversación a un humano: avisa al admin por WhatsApp y
  // asigna la conversación al primer usuario admin/agente para que la tome.
  static async escalateToHuman(conversation, contact, customerText) {
    try {
      const Setting = require('./models/Setting');

      // 1. Buscar el número de WhatsApp del admin para enviarle el aviso.
      //    Se configura en Settings: ALERT_PHONE (con código de país, ej 5215512345678)
      const alertPhone = await Setting.get('ALERT_PHONE');
      if (alertPhone) {
        const channelName = conversation.channel === 'whatsapp_evolution' ? 'WhatsApp' : (conversation.channel === 'whatsapp_cloud' ? 'WhatsApp' : 'Chat Web');
        const contactName = contact.name || 'Visitante';
        const alertText =
          `🔔 *Nuevo mensaje necesita atención humana*\n\n` +
          `👤 *${contactName}*\n` +
          `💬 "${customerText || ''}"\n` +
          `🌐 Canal: ${channelName}\n\n` +
          `Responde desde el panel admin o aquí mismo.`;

        await WhatsAppEvolutionChannel.sendMessage(alertPhone, alertText);
      }

      // 2. Asignar la conversación a un agente (el primer admin disponible)
      const User = require('./models/User');
      const users = await User.getAll();
      const agent = users.find(u => u.role === 'admin') || users[0];
      if (agent && !conversation.assigned_to) {
        await Conversation.assignAgent(conversation.id, agent.id);
        conversation = await Conversation.findById(conversation.id);
      }

      // 3. Notificar al panel admin
      NotificationService.notifyConversationUpdated(conversation);

      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🔔 Conversación ${conversation.id} escalada a humano (${agent ? agent.name : 'sin agente'}). Aviso WhatsApp enviado: ${!!alertPhone}`);
      }
    } catch (err) {
      console.error('❌ Error escalando conversación a humano:', err);
    }
  }

  static async sendAgentMessage(conversationId, agentId, text, mediaUrl = null, mediaType = null) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new Error('Conversación no encontrada');

    const contact = await Contact.findById(conversation.contact_id);

    const agentMsg = await Message.create({
      conversation_id: conversation.id,
      sender_type: 'agent',
      sender_id: agentId,
      text,
      media_url: mediaUrl,
      media_type: mediaType || (mediaUrl ? 'image' : null)
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

  static async checkBusinessHours(client = null) {
    const hoursStart = client && client.business_hours_start
      ? client.business_hours_start
      : await Setting.get('BUSINESS_HOURS_START', '08:00');
    const hoursEnd = client && client.business_hours_end
      ? client.business_hours_end
      : await Setting.get('BUSINESS_HOURS_END', '17:00');
    const hoursDays = ((client && client.business_hours_days)
      ? client.business_hours_days
      : await Setting.get('BUSINESS_HOURS_DAYS', '1,2,3,4,5')
    ).split(',').map(Number);

    // Zona horaria configurable (por defecto la del servidor).
    // En Docker el servidor suele estar en UTC, por eso es importante
    // configurar TIMEZONE (ej: 'America/Mexico_City', 'Europe/Madrid').
    const timezone = await Setting.get('TIMEZONE', 'UTC');

    let currentDay;
    let currentTimeStr;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(new Date());

      const part = (type) => parts.find(p => p.type === type)?.value;
      const dayNames = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      currentDay = dayNames[part('weekday')];
      currentTimeStr = `${part('hour')}:${part('minute')}`;
    } catch (err) {
      // Zona horaria inválida: usar la hora del servidor
      console.error(`❌ Zona horaria inválida "${timezone}":`, err.message);
      const now = new Date();
      currentDay = now.getDay() === 0 ? 7 : now.getDay();
      currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }

    if (!hoursDays.includes(currentDay)) return false;

    return currentTimeStr >= hoursStart && currentTimeStr <= hoursEnd;
  }
}

module.exports = MessageService;
