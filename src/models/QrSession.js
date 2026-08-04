const { dbAsync } = require('../../database/database');
const crypto = require('crypto');

class QrSession {
  static async create() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const result = await dbAsync.run(
      'INSERT INTO qr_sessions (token, expires_at) VALUES (?, ?)',
      [token, expiresAt]
    );

    await QrSession.cleanupExpired();

    return { id: result.lastID, token, expiresAt };
  }

  static async findByToken(token) {
    return await dbAsync.get('SELECT * FROM qr_sessions WHERE token = ?', [token]);
  }

  static async getStatus(token) {
    const session = await QrSession.findByToken(token);
    if (!session) return { status: 'not_found' };

    if (new Date(session.expires_at) < new Date()) {
      await dbAsync.run('UPDATE qr_sessions SET status = ? WHERE token = ?', ['expired', token]);
      return { status: 'expired' };
    }

    if (session.status === 'approved') {
      return { status: 'approved', user_id: session.user_id };
    }

    return { status: session.status };
  }

  static async markScanned(token) {
    await dbAsync.run(
      'UPDATE qr_sessions SET status = ? WHERE token = ? AND status = ?',
      ['scanned', token, 'pending']
    );
  }

  static async approve(token, userId) {
    await dbAsync.run(
      'UPDATE qr_sessions SET status = ?, user_id = ? WHERE token = ? AND status IN (?, ?)',
      ['approved', userId, token, 'pending', 'scanned']
    );
  }

  static async reject(token) {
    await dbAsync.run(
      'UPDATE qr_sessions SET status = ? WHERE token = ?',
      ['rejected', token]
    );
  }

  static async cleanupExpired() {
    await dbAsync.run(
      "UPDATE qr_sessions SET status = 'expired' WHERE status IN ('pending', 'scanned') AND expires_at < datetime('now')"
    );
  }
}

module.exports = QrSession;
