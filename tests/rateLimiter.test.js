const test = require('node:test');
const assert = require('node:assert/strict');
const rateLimiter = require('../src/middleware/rateLimiter');

test('rateLimiter middleware limita solicitudes en exceso', () => {
  const limiter = rateLimiter({ windowMs: 1000, max: 2 });

  const req = { ip: '127.0.0.1' };
  let statusSent = null;
  let jsonSent = null;

  const res = {
    status(code) {
      statusSent = code;
      return {
        json(data) {
          jsonSent = data;
        }
      };
    }
  };

  let nextCalled = 0;
  const next = () => { nextCalled++; };

  // Petición 1 - Pasa
  limiter(req, res, next);
  assert.equal(nextCalled, 1);

  // Petición 2 - Pasa
  limiter(req, res, next);
  assert.equal(nextCalled, 2);

  // Petición 3 - Bloqueada con 429
  limiter(req, res, next);
  assert.equal(nextCalled, 2); // No llamó a next()
  assert.equal(statusSent, 429);
  assert.ok(jsonSent.error.includes('Demasiadas solicitudes'));
});
