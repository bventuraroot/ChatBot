const { dbAsync } = require('../../database/database');
const crypto = require('crypto');

class ApiKey {
  static async create(name) {
    const rawKey = 'cb_live_' + crypto.randomBytes(24).toString('hex');
    const keyPrefix = rawKey.substring(0, 12);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const result = await dbAsync.run(
      'INSERT INTO api_keys (name, key_hash, key_prefix) VALUES (?, ?, ?)',
      [name, keyHash, keyPrefix]
    );

    return {
      id: result.lastID,
      name,
      rawKey, // Solo se devuelve una vez al crear
      keyPrefix,
      created_at: new Date().toISOString()
    };
  }

  static async verify(rawKey) {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const apiKey = await dbAsync.get('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1', [keyHash]);
    if (apiKey) {
      await dbAsync.run('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [apiKey.id]);
      return apiKey;
    }
    return null;
  }

  static async getAll() {
    return await dbAsync.all('SELECT id, name, key_prefix, is_active, last_used_at, created_at FROM api_keys ORDER BY id DESC');
  }

  static async revoke(id) {
    return await dbAsync.run('UPDATE api_keys SET is_active = 0 WHERE id = ?', [id]);
  }
}

module.exports = ApiKey;
