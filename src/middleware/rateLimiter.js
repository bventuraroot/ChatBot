const requestCounts = new Map();

// Limpiar registros expirarados periódicamente para evitar memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

function rateLimiter(options = { windowMs: 60 * 1000, max: 100 }) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();

    if (!requestCounts.has(ip)) {
      requestCounts.set(ip, { count: 1, resetTime: now + options.windowMs });
      return next();
    }

    const clientData = requestCounts.get(ip);
    if (now > clientData.resetTime) {
      clientData.count = 1;
      clientData.resetTime = now + options.windowMs;
      return next();
    }

    clientData.count += 1;
    if (clientData.count > options.max) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Por favor intente más tarde.' });
    }

    next();
  };
}

module.exports = rateLimiter;
