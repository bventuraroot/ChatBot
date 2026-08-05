const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.DB_PATH = ':memory:';
const { dbAsync } = require('../database/database');
const User = require('../src/models/User');
const ApiKey = require('../src/models/ApiKey');
const { authenticateToken, authenticateApiKey, JWT_SECRET } = require('../src/middleware/auth');

test('Auth Middleware - verificación de JWT para usuarios admin', async () => {
  await dbAsync.initDatabase();

  const user = await User.create({
    name: 'Admin Test',
    email: 'admin@test.com',
    password: 'password123',
    role: 'admin'
  });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {};
  let nextCalled = false;

  await authenticateToken(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.email, 'admin@test.com');
});

test('Auth Middleware - verificación de API Key para integraciones', async () => {
  const newKey = await ApiKey.create('API Integración Test');

  const req = { headers: { 'x-api-key': newKey.rawKey } };
  const res = {};
  let nextCalled = false;

  await authenticateApiKey(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.apiKey.name, 'API Integración Test');
});
