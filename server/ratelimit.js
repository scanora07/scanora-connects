"use strict";

// A small in-memory limiter: at most `max` requests per `windowMs` from one address.
// Enough to stop a script hammering the gift pages; it resets when the server restarts.
function rateLimit({ windowMs, max, message = "Too many requests. Please slow down." }) {
  const hits = new Map(); // ip -> { count, resetAt }
  let lastSweep = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [ip, rec] of hits) if (rec.resetAt <= now) hits.delete(ip);
      lastSweep = now;
    }
    let rec = hits.get(req.ip);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      res.set("Retry-After", String(Math.ceil((rec.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
