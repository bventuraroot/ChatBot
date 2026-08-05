const { dbAsync } = require('../../database/database');

class KnowledgeItem {
  static async findById(id) {
    return await dbAsync.get('SELECT * FROM knowledge_items WHERE id = ?', [id]);
  }

  static async getAll({ category = null, activeOnly = true, clientId = null } = {}) {
    let sql = 'SELECT * FROM knowledge_items WHERE 1=1';
    const params = [];
    if (activeOnly) sql += ' AND is_active = 1';
    if (clientId) {
      sql += ' AND (client_id = ? OR client_id IS NULL)';
      params.push(clientId);
    } else if (clientId === null) {
      // null = todos, 0 = solo globales
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY priority DESC, category ASC, id DESC';
    return await dbAsync.all(sql, params);
  }

  static async searchKeywords(text, clientId = null) {
    let sql, params;
    if (clientId) {
      sql = 'SELECT * FROM knowledge_items WHERE is_active = 1 AND (client_id = ? OR client_id IS NULL) ORDER BY priority DESC';
      params = [clientId];
    } else {
      sql = 'SELECT * FROM knowledge_items WHERE is_active = 1 AND client_id IS NULL ORDER BY priority DESC';
      params = [];
    }
    const activeFaqs = await dbAsync.all(sql, params);
    const normalizedQuery = text.toLowerCase().trim();

    for (const faq of activeFaqs) {
      if (faq.keywords) {
        const keywords = faq.keywords.split(',').map((k) => k.trim().toLowerCase());
        for (const kw of keywords) {
          if (kw && normalizedQuery.includes(kw)) {
            return faq;
          }
        }
      }
      if (normalizedQuery.includes(faq.question.toLowerCase())) {
        return faq;
      }
    }
    return null;
  }

  static async create({ client_id = null, category = 'General', question, answer, keywords = '', match_type = 'keyword', priority = 0 }) {
    const result = await dbAsync.run(
      'INSERT INTO knowledge_items (client_id, category, question, answer, keywords, match_type, priority) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [client_id, category, question, answer, keywords, match_type, priority]
    );
    return await KnowledgeItem.findById(result.lastID);
  }

  static async update(id, { client_id, category, question, answer, keywords, is_active, match_type, priority }) {
    await dbAsync.run(
      `UPDATE knowledge_items
       SET client_id = COALESCE(?, client_id),
           category = COALESCE(?, category),
           question = COALESCE(?, question),
           answer = COALESCE(?, answer),
           keywords = COALESCE(?, keywords),
           is_active = COALESCE(?, is_active),
           match_type = COALESCE(?, match_type),
           priority = COALESCE(?, priority),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [client_id, category, question, answer, keywords, is_active, match_type, priority, id]
    );
    return await KnowledgeItem.findById(id);
  }

  static async delete(id) {
    return await dbAsync.run('DELETE FROM knowledge_items WHERE id = ?', [id]);
  }
}

module.exports = KnowledgeItem;
