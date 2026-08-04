class NotificationService {
  static io = null;

  static init(socketIoInstance) {
    NotificationService.io = socketIoInstance;
  }

  static notifyNewMessage(conversationId, message, contact) {
    if (!NotificationService.io) return;
    NotificationService.io.emit('new_message', {
      conversation_id: conversationId,
      message,
      contact
    });
  }

  static notifyConversationUpdated(conversation) {
    if (!NotificationService.io) return;
    NotificationService.io.emit('conversation_updated', conversation);
  }

  static notifyNewConversation(conversation) {
    if (!NotificationService.io) return;
    NotificationService.io.emit('new_conversation', conversation);
  }
}

module.exports = NotificationService;
