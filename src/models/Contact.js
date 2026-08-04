const { dbAsync } = require('../../database/database');

class Contact {
  static async findById(id) {
    return await dbAsync.get('SELECT * FROM contacts WHERE id = ?', [id]);
  }

  static async findByPhone(phone) {
    return await dbAsync.get('SELECT * FROM contacts WHERE phone = ?', [phone]);
  }

  static async findByEmail(email) {
    return await dbAsync.get('SELECT * FROM contacts WHERE email = ?', [email]);
  }

  // Busca por phone, luego por email, y si no existe, crea
  static async findOrCreate({ phone, email = null, name, channel, avatar = null, notes = null }) {
    // 1. Buscar por phone (visitor_id estable)
    if (phone) {
      let contact = await Contact.findByPhone(phone);
      if (contact) {
        // Actualizar datos si hay nueva info del sistema externo
        const newName = name && name !== 'Visitante Web' && name !== contact.name ? name : null;
        const newEmail = email && !contact.email ? email : null;
        const newNotes = notes && notes !== contact.notes ? notes : null;
        if (newName || newEmail || newNotes) {
          await dbAsync.run(
            `UPDATE contacts SET
              name  = COALESCE(?, name),
              email = COALESCE(?, email),
              notes = COALESCE(?, notes),
              updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [newName, newEmail, newNotes, contact.id]
          );
          return await Contact.findById(contact.id);
        }
        return contact;
      }
    }

    // 2. Buscar por email (mismo usuario, cambió navegador/pestaña)
    if (email) {
      let contact = await Contact.findByEmail(email);
      if (contact) {
        // Guardar el nuevo phone (visitor_id) para reconocerlo la próxima vez
        const updates = [];
        const params = [];
        if (phone && !contact.phone) { updates.push('phone = ?'); params.push(phone); }
        if (notes && !contact.notes) { updates.push('notes = ?'); params.push(notes); }
        if (updates.length) {
          updates.push('updated_at = CURRENT_TIMESTAMP');
          params.push(contact.id);
          await dbAsync.run(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`, params);
          return await Contact.findById(contact.id);
        }
        return contact;
      }
    }

    // 3. Crear nuevo contacto
    const result = await dbAsync.run(
      'INSERT INTO contacts (phone, email, name, channel, avatar, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [phone, email, name, channel, avatar, notes]
    );
    return await Contact.findById(result.lastID);
  }

  static async getAll({ search = '', limit = 50, offset = 0 } = {}) {
    if (search) {
      const term = `%${search}%`;
      return await dbAsync.all(
        'SELECT * FROM contacts WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
        [term, term, term, limit, offset]
      );
    }
    return await dbAsync.all('SELECT * FROM contacts ORDER BY updated_at DESC LIMIT ? OFFSET ?', [limit, offset]);
  }

  static async update(id, { name, email, notes, avatar }) {
    await dbAsync.run(
      `UPDATE contacts SET
        name  = COALESCE(?, name),
        email = COALESCE(?, email),
        notes = COALESCE(?, notes),
        avatar= COALESCE(?, avatar),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, email, notes, avatar, id]
    );
    return await Contact.findById(id);
  }
}

module.exports = Contact;
