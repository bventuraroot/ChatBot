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
    // 1. Verificar si el canal está habilitado
    const channelKeys = {
      webchat: 'CHANNEL_WEB_ENABLED',
      whatsapp_cloud: 'CHANNEL_WHATSAPP_CLOUD_ENABLED',
      whatsapp_evolution: 'CHANNEL_WHATSAPP_EVOLUTION_ENABLED'
    };
    const channelKey = channelKeys[channel];
    if (channelKey) {
      const channelEnabled = await Setting.get(channelKey, 'true');
      if (channelEnabled !== 'true') {
        if (process.env.DEBUG_LOGS === 'true') {
          console.log(`🚫 Canal ${channel} deshabilitado — mensaje ignorado`);
        }
        return null;
      }
    }

    // 2. Determinar el cliente (multi-tenant)
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

    // 5. Detectar reporte de bug — no responde el bot, solo notifica al admin
    const isBugReport = (metadata && metadata.type === 'bug_report')
      || (text && text.includes('*REPORTE DE BUG*'));
    if (isBugReport) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🐛 Reporte de bug recibido de ${contact.name || contact.phone}`);
      }
      // Notificar al admin con alerta especial
      NotificationService.notifyAlert({
        type: 'bug_report',
        conversation_id: conversation.id,
        contact_name: contact.name || 'Visitante',
        message: text.substring(0, 120),
        channel: 'Web Chat',
        time: new Date().toISOString()
      });
      return customerMsg;
    }

    // 6. Verificar si la conversación fue tomada por un humano
    if (conversation.assigned_to && conversation.assigned_to > 0) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🚫 Bot no responde: conversación ${conversation.id} asignada a agente (${conversation.assigned_to})`);
      }
      return customerMsg;
    }

    // 7. Verificar si el bot está habilitado (global o por cliente)
    const botEnabled = client
      ? client.bot_enabled === 1
      : (await Setting.get('BOT_ENABLED', 'true')) === 'true';
    if (!botEnabled) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log('🚫 Bot no responde: BOT_ENABLED está en false');
      }
      return customerMsg;
    }

    // 7. Detección de petición de humano — SIEMPRE抢先 antes del horario.
    // Si el cliente pide un agente/asesor/persona real, escalar de inmediato
    // sin importar si estamos dentro o fuera de horario de atención.
    if (MessageService.wantsHumanIntent(text)) {
      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🔔 Detección de humano: "${text}"`);
      }
      const transferText = await Setting.get(
        'HUMAN_TRANSFER_MESSAGE',
        '¡Claro! Te conectaré con un agente humano. Un momento por favor.'
      );
      await MessageService.sendBotResponse(conversation, contact, transferText);
      await MessageService.escalateToHuman(conversation, contact, text);
      return customerMsg;
    }

    // 8. FAQ + IA (siempre, el chatbot responde preguntas 24/7)
    const history = await Message.getByConversation(conversation.id, { limit: 10 });

    if (process.env.DEBUG_LOGS === 'true') {
      console.log(`🤖 Buscando respuesta para: "${text}"`);
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
      // 9. Sin respuesta → verificar horario para elegir mensaje
      const isWithinHours = await MessageService.checkBusinessHours(client);
      if (!isWithinHours) {
        if (process.env.DEBUG_LOGS === 'true') {
          console.log('🕐 Sin respuesta y fuera de horario');
        }
        const outOfHoursText = client && client.out_of_hours_message
          ? client.out_of_hours_message
          : await Setting.get(
              'OUT_OF_HOURS_MESSAGE',
              'Gracias por escribirnos. Estamos fuera de nuestro horario de atención.'
            );
        await MessageService.sendBotResponse(conversation, contact, outOfHoursText);
      } else if (history.length <= 1) {
        // Bienvenida solo si es la primera interacción y estamos en horario
        const welcomeText = client && client.welcome_message
          ? DynamicResponseEngine.renderTemplate(client.welcome_message, contact)
          : await Setting.get('WELCOME_MESSAGE', '¡Hola! 👋 Bienvenido. Un agente te atenderá pronto.');
        await MessageService.sendBotResponse(conversation, contact, welcomeText);
      }
    }

    return customerMsg;
  }

  // Detecta si el mensaje del cliente pide atención humana (agente, asesor,
  // persona real, etc.) con frases y palabras clave.
  static wantsHumanIntent(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    const phrases = [
      'agente', 'asesor', 'humano', 'persona real', 'persona física',
      'alguien real', 'hablar con alguien', 'quiero hablar con',
      'necesito hablar con', 'me atiendas', 'me atienda',
      'atención personal', 'ayuda humana', 'un agente', 'con un asesor',
      'representante', 'ejecutivo', 'transferencia a un agente',
      'transferir', 'persona que', 'que me atienda', 'un humano',
      'atención de una persona', 'hablar con una persona'
    ];
    return phrases.some(p => t.includes(p));
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

    // Incluir avatar del admin en la notificación para el widget
    const User = require('../models/User');
    const users = await User.getAll();
    const admin = users.find(u => u.role === 'admin') || users[0];
    if (admin && admin.avatar) {
      botMsg.agent_avatar = admin.avatar;
    }

    NotificationService.notifyNewMessage(conversation.id, botMsg, contact);
    NotificationService.notifyConversationUpdated(await Conversation.findById(conversation.id));

    return botMsg;
  }

  // Escala la conversación a un humano: avisa al admin por WhatsApp y en el
  // panel, y asigna la conversación al primer usuario admin/agente.
  static async escalateToHuman(conversation, contact, customerText) {
    try {
      const Setting = require('../models/Setting');

      const channelName = conversation.channel === 'whatsapp_evolution'
        ? 'WhatsApp (QR)'
        : (conversation.channel === 'whatsapp_cloud' ? 'WhatsApp (Meta)' : 'Chat Web');
      const contactName = contact.name || 'Visitante';

      // 1. Aviso en el panel admin en tiempo real (siempre)
      NotificationService.notifyAlert({
        type: 'human_needed',
        conversation_id: conversation.id,
        contact_name: contactName,
        message: customerText || 'Solicitó atención humana',
        channel: channelName,
        time: new Date().toISOString()
      });

      // 2. Aviso por WhatsApp (si ALERT_PHONE está configurado)
      const alertPhone = await Setting.get('ALERT_PHONE');
      let whatsappAlertSent = false;
      if (alertPhone) {
        const alertText =
          `🔔 *Nuevo mensaje necesita atención humana*\n\n` +
          `👤 *${contactName}*\n` +
          `💬 "${customerText || ''}"\n` +
          `🌐 Canal: ${channelName}\n\n` +
          `Responde desde el panel admin o aquí mismo.`;

        // Usar el canal de WhatsApp que esté configurado
        if (conversation.channel === 'whatsapp_cloud') {
          const result = await WhatsAppCloudChannel.sendMessage(alertPhone, alertText);
          whatsappAlertSent = result && result.success;
        } else {
          const result = await WhatsAppEvolutionChannel.sendMessage(alertPhone, alertText);
          whatsappAlertSent = result && result.success;
        }
      } else if (process.env.DEBUG_LOGS === 'true') {
        console.log('⚠️ ALERT_PHONE no configurado: no se envió aviso por WhatsApp (solo panel).');
      }

      // 3. Asignar la conversación a un agente (el primer admin disponible)
      const User = require('../models/User');
      const users = await User.getAll();
      const agent = users.find(u => u.role === 'admin') || users[0];
      if (agent && !conversation.assigned_to) {
        await Conversation.assignAgent(conversation.id, agent.id);
        conversation = await Conversation.findById(conversation.id);
      }

      // 4. Notificar al panel admin
      NotificationService.notifyConversationUpdated(conversation);

      if (process.env.DEBUG_LOGS === 'true') {
        console.log(`🔔 Conversación ${conversation.id} escalada a humano (${agent ? agent.name : 'sin agente'}). Aviso WhatsApp: ${whatsappAlertSent} (ALERT_PHONE=${alertPhone ? 'configurado' : 'FALTA'})`);
      }
    } catch (err) {
      console.error('❌ Error escalando conversación a humano:', err);
    }
  }

  static async sendAgentMessage(conversationId, agentId, text, mediaUrl = null, mediaType = null) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw new Error('Conversación no encontrada');

    const contact = await Contact.findById(conversation.contact_id);
    const User = require('../models/User');
    const agentUser = await User.findById(agentId);

    const agentMsg = await Message.create({
      conversation_id: conversation.id,
      sender_type: 'agent',
      sender_id: agentId,
      text,
      media_url: mediaUrl,
      media_type: mediaType || (mediaUrl ? 'image' : null)
    });

    // Incluir avatar del agente para el widget
    if (agentUser && agentUser.avatar) {
      agentMsg.agent_avatar = agentUser.avatar;
      agentMsg.agent_name = agentUser.name;
    }

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
