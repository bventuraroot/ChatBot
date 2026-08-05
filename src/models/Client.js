const { dbAsync } = require('../../database/database');

class Client {
  static async findById(id) {
    return await dbAsync.get('SELECT * FROM clients WHERE id = ?', [id]);
  }

  static async findByWhatsAppPhoneId(phoneId) {
    return await dbAsync.get(
      "SELECT * FROM clients WHERE whatsapp_phone_id = ? AND is_active = 1",
      [phoneId]
    );
  }

  static async findByWhatsAppInstance(instance) {
    return await dbAsync.get(
      "SELECT * FROM clients WHERE whatsapp_instance = ? AND is_active = 1",
      [instance]
    );
  }

  static async findByWebchatIdentifier(identifier) {
    return await dbAsync.get(
      "SELECT * FROM clients WHERE webchat_identifier = ? AND is_active = 1",
      [identifier]
    );
  }

  static async findByChannel(channel, channelData = {}) {
    if (channel === 'whatsapp_cloud' && channelData.phone_number_id) {
      return await Client.findByWhatsAppPhoneId(channelData.phone_number_id);
    }
    if (channel === 'whatsapp_evolution' && channelData.instance) {
      return await Client.findByWhatsAppInstance(channelData.instance);
    }
    if (channel === 'webchat' && channelData.client_id) {
      return await Client.findByWebchatIdentifier(channelData.client_id);
    }
    return null;
  }

  static async getAll({ activeOnly = true } = {}) {
    const sql = activeOnly
      ? 'SELECT * FROM clients WHERE is_active = 1 ORDER BY name ASC'
      : 'SELECT * FROM clients ORDER BY name ASC';
    return await dbAsync.all(sql);
  }

  static async create(data) {
    const result = await dbAsync.run(
      `INSERT INTO clients (
        name, description, whatsapp_phone_id, whatsapp_instance, webchat_identifier,
        external_api_url, external_api_key, external_api_timeout,
        welcome_message, out_of_hours_message, bot_enabled,
        business_hours_start, business_hours_end, business_hours_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.description || null,
        data.whatsapp_phone_id || null,
        data.whatsapp_instance || null,
        data.webchat_identifier || null,
        data.external_api_url || null,
        data.external_api_key || null,
        data.external_api_timeout || 5000,
        data.welcome_message || '¡Hola! ¿En qué puedo ayudarte?',
        data.out_of_hours_message || null,
        data.bot_enabled !== undefined ? data.bot_enabled : 1,
        data.business_hours_start || '08:00',
        data.business_hours_end || '17:00',
        data.business_hours_days || '1,2,3,4,5'
      ]
    );
    return await Client.findById(result.lastID);
  }

  static async update(id, data) {
    const fields = [];
    const params = [];

    const allowedFields = [
      'name', 'description', 'whatsapp_phone_id', 'whatsapp_instance',
      'webchat_identifier', 'external_api_url', 'external_api_key',
      'external_api_timeout', 'welcome_message', 'out_of_hours_message',
      'bot_enabled', 'business_hours_start', 'business_hours_end',
      'business_hours_days', 'is_active'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(data[field]);
      }
    }

    if (fields.length === 0) return await Client.findById(id);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await dbAsync.run(
      `UPDATE clients SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    return await Client.findById(id);
  }

  static async delete(id) {
    return await dbAsync.run('DELETE FROM clients WHERE id = ?', [id]);
  }
}

module.exports = Client;
