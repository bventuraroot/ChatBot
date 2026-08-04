const jwt = require('jsonwebtoken');
const ApiKey = require('../models/ApiKey');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_chatbot_hub_2026';

// Auth para usuarios admin/agentes (JWT)
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Usuario no válido' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
}

// Auth para API Key externa (Sistema de Contabilidad / Terceros)
async function authenticateApiKey(req, res, next) {
  const apiKeyHeader = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKeyHeader) {
    return res.status(401).json({ error: 'Se requiere X-API-KEY header o api_key parámetro' });
  }

  const validKey = await ApiKey.verify(apiKeyHeader);
  if (!validKey) {
    return res.status(403).json({ error: 'API Key inválida o revocada' });
  }

  req.apiKey = validKey;
  next();
}

module.exports = { authenticateToken, authenticateApiKey, JWT_SECRET };
