const { dbAsync } = require('../../database/database');

class Conversation {
  static async findById(id) {
    return await dbAsync.get(
      `SELECT c.*,
              ct.name  as contact_name,  ct.phone  as contact_phone,
              ct.email as contact_email, ct.avatar as contact_avatar,
              ct.notes as contact_notes,
              u.name   as assigned_agent_name
       FROM conversations c
       JOIN contacts ct ON c.contact_id = ct.id
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE c.id = ?`,
      [id]
    );
  }

  // Devuelve la conversación más reciente del contacto (abierta o cerrada).
  // Si estaba cerrada, la reabre para mantener TODO el historial en un mismo hilo.
  static async findOrCreateForContact(contactId, channel) {
    // Buscar la conversación más reciente (sin importar estado)
    let conversation = await dbAsync.get(
      'SELECT * FROM conversations WHERE contact_id = ? ORDER BY id DESC LIMIT 1',
      [contactId]
    );

    if (!conversation) {
      // Primera vez que escribe → crear nueva
      const result = await dbAsync.run(
        'INSERT INTO conversations (contact_id, channel, status) VALUES (?, ?, "open")',
        [contactId, channel]
      );
      return await Conversation.findById(result.lastID);
    }

    if (conversation.status === 'closed') {
      // Reabrir la conversación existente para continuar el hilo
      await dbAsync.run(
        'UPDATE conversations SET status = "open", unread_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [conversation.id]
      );
    }

    return await Conversation.findById(conversation.id);
  }

  // Todas las conversaciones de un contacto (para historial completo en admin)
  static async getAllByContact(contactId) {
    return await dbAsync.all(
      `SELECT c.id, c.status, c.channel, c.created_at, c.last_message_at,
              (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
              (SELECT text FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message
       FROM conversations c
       WHERE c.contact_id = ?
       ORDER BY c.id DESC`,
      [contactId]
    );
  }

  static async getAll({ status = null, channel = null, assigned_to = null, limit = 50, offset = 0 } = {}) {
    let sql = `
      SELECT c.*, ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email,
             ct.notes as contact_notes, ct.avatar as contact_avatar,
             m.text as last_message_text, m.created_at as last_message_time, m.sender_type as last_sender_type,
             u.name as assigned_agent_name
      FROM conversations c
      JOIN contacts ct ON c.contact_id = ct.id
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN messages m ON m.id = (
        SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
      )
      WHERE 1=1
    `;
    const params = [];

    if (status) { sql += ' AND c.status = ?'; params.push(status); }
    if (channel) { sql += ' AND c.channel = ?'; params.push(channel); }
    if (assigned_to) { sql += ' AND c.assigned_to = ?'; params.push(assigned_to); }

    sql += ' ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return await dbAsync.all(sql, params);
  }

  static async updateStatus(id, status) {
    await dbAsync.run(
      'UPDATE conversations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id]
    );
    return await Conversation.findById(id);
  }

  static async assignAgent(id, userId) {
    await dbAsync.run(
      'UPDATE conversations SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId, id]
    );
    return await Conversation.findById(id);
  }

  static async incrementUnread(id) {
    await dbAsync.run(
      'UPDATE conversations SET unread_count = unread_count + 1, last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
  }

  static async resetUnread(id) {
    await dbAsync.run('UPDATE conversations SET unread_count = 0 WHERE id = ?', [id]);
  }
}

module.exports = Conversation;
