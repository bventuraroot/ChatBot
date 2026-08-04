const { dbAsync } = require('../../database/database');

class KnowledgeItem {
  static async findById(id) {
    return await dbAsync.get('SELECT * FROM knowledge_items WHERE id = ?', [id]);
  }

  static async getAll({ category = null, activeOnly = true } = {}) {
    let sql = 'SELECT * FROM knowledge_items WHERE 1=1';
    const params = [];
    if (activeOnly) sql += ' AND is_active = 1';
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY category ASC, id DESC';
    return await dbAsync.all(sql, params);
  }

  static async searchKeywords(text) {
    const activeFaqs = await dbAsync.all('SELECT * FROM knowledge_items WHERE is_active = 1');
    const normalizedQuery = text.toLowerCase().trim();

    // 1. Coincidencia exacta o por keywords
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

  static async create({ category = 'General', question, answer, keywords = '' }) {
    const result = await dbAsync.run(
      'INSERT INTO knowledge_items (category, question, answer, keywords) VALUES (?, ?, ?, ?)',
      [category, question, answer, keywords]
    );
    return await KnowledgeItem.findById(result.lastID);
  }

  static async update(id, { category, question, answer, keywords, is_active }) {
    await dbAsync.run(
      `UPDATE knowledge_items 
       SET category = COALESCE(?, category), 
           question = COALESCE(?, question), 
           answer = COALESCE(?, answer), 
           keywords = COALESCE(?, keywords),
           is_active = COALESCE(?, is_active),
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [category, question, answer, keywords, is_active, id]
    );
    return await KnowledgeItem.findById(id);
  }

  static async delete(id) {
    return await dbAsync.run('DELETE FROM knowledge_items WHERE id = ?', [id]);
  }
}

module.exports = KnowledgeItem;
