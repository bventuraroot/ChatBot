class NotificationService {
  static io = null;

  static init(socketIoInstance) {
    NotificationService.io = socketIoInstance;
  }

  // Emite el mensaje SOLO al room del visitante correspondiente (el widget
  // del cliente que pertenece a esta conversación). El panel admin usa un
  // evento separado. Así los widgets de otros visitantes NUNCA reciben
  // mensajes de conversaciones ajenas.
  static notifyNewMessage(conversationId, message, contact) {
    if (!NotificationService.io) return;

    const payload = {
      conversation_id: conversationId,
      message,
      contact
    };

    // Al widget del cliente correcto (los widgets web se unen a visitor_<visitor_id>).
    // WhatsApp/otros canales no tienen room, así que solo aplica a webchat.
    if (contact && contact.phone) {
      NotificationService.io.to(`visitor_${contact.phone}`).emit('new_message', payload);
    }

    // Al panel admin (recibe todas las conversaciones)
    NotificationService.io.emit('admin_new_message', payload);
  }

  static notifyConversationUpdated(conversation) {
    if (!NotificationService.io) return;
    NotificationService.io.emit('conversation_updated', conversation);
  }

  // Notificación de alerta en vivo para el panel admin (sonido/visual)
  // cuando una conversación necesita atención humana.
  static notifyAlert(message) {
    if (!NotificationService.io) return;
    NotificationService.io.emit('admin_alert', message);
  }

  static notifyNewConversation(conversation) {
    if (!NotificationService.io) return;
    NotificationService.io.emit('new_conversation', conversation);
  }
}

module.exports = NotificationService;
