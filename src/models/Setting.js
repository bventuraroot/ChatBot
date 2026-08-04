const { dbAsync } = require('../../database/database');

class Setting {
  static async get(key, defaultValue = null) {
    const row = await dbAsync.get('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) {
      return process.env[key.toUpperCase()] !== undefined ? process.env[key.toUpperCase()] : defaultValue;
    }
    return row.value;
  }

  static async getAll() {
    const rows = await dbAsync.all('SELECT key, value FROM settings');
    const settingsMap = {};
    for (const row of rows) {
      settingsMap[row.key] = row.value;
    }
    return settingsMap;
  }

  static async set(key, value) {
    const existing = await dbAsync.get('SELECT key FROM settings WHERE key = ?', [key]);
    if (existing) {
      await dbAsync.run('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?', [
        String(value),
        key
      ]);
    } else {
      await dbAsync.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
  }

  static async setMultiple(settingsObj) {
    for (const [key, value] of Object.entries(settingsObj)) {
      if (value !== undefined && value !== null) {
        await Setting.set(key, value);
      }
    }
  }
}

module.exports = Setting;
