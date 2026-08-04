const { dbAsync } = require('../../database/database');
const bcrypt = require('bcryptjs');

class User {
  static async findById(id) {
    return await dbAsync.get('SELECT id, name, email, role, avatar, created_at FROM users WHERE id = ?', [id]);
  }

  static async findByEmail(email) {
    return await dbAsync.get('SELECT * FROM users WHERE email = ?', [email]);
  }

  static async getAll() {
    return await dbAsync.all('SELECT id, name, email, role, avatar, created_at FROM users ORDER BY name ASC');
  }

  static async create({ name, email, password, role = 'agent', avatar = null }) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbAsync.run(
      'INSERT INTO users (name, email, password, role, avatar) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, role, avatar]
    );
    return await User.findById(result.lastID);
  }

  static async update(id, { name, email, role, avatar }) {
    await dbAsync.run(
      'UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), role = COALESCE(?, role), avatar = COALESCE(?, avatar), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, email, role, avatar, id]
    );
    return await User.findById(id);
  }

  static async verifyPassword(user, password) {
    return await bcrypt.compare(password, user.password);
  }
}

module.exports = User;
