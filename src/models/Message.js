const { dbAsync } = require('../../database/database');

class Message {
  static async findById(id) {
    return await dbAsync.get('SELECT * FROM messages WHERE id = ?', [id]);
  }

  static async getByConversation(conversationId, { limit = 100, offset = 0 } = {}) {
    return await dbAsync.all(
      `SELECT m.*, u.name as agent_name 
       FROM messages m 
       LEFT JOIN users u ON m.sender_id = u.id 
       WHERE m.conversation_id = ? 
       ORDER BY m.id ASC LIMIT ? OFFSET ?`,
      [conversationId, limit, offset]
    );
  }

  static async create({ conversation_id, sender_type, sender_id = null, text = '', media_url = null, media_type = null, status = 'sent', metadata = null }) {
    const result = await dbAsync.run(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, text, media_url, media_type, status, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conversation_id,
        sender_type,
        sender_id,
        text,
        media_url,
        media_type,
        status,
        metadata ? JSON.stringify(metadata) : null
      ]
    );

    // Actualizar timestamp de la conversación
    await dbAsync.run(
      'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
      [conversation_id]
    );

    return await Message.findById(result.lastID);
  }
}

module.exports = Message;
