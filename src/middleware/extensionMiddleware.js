// =============================================================
// src/middleware/extensionMiddleware.js
// Chrome Extension Security Layer — CORS, ID validation, rate limiting.
// =============================================================

const ALLOWED_EXTENSION_ID = process.env.CHROME_EXTENSION_ID || "your-extension-id-here";

const requestCounts = new Map();
const RATE_LIMIT     = 60;
const RATE_WINDOW_MS = 60 * 1000;

function extensionCors(req, res, next) {
  const origin = req.headers.origin || "";

  if (origin.startsWith("chrome-extension://") || origin.includes("localhost")) {
    res.setHeader("Access-Control-Allow-Origin",  origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Extension-ID");
    res.setHeader("Access-Control-Max-Age",       "86400");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
}

function validateExtensionID(req, res, next) {
  const extensionId = req.headers["x-extension-id"];

  if (!extensionId) {
    return res.status(403).json({
      error: "Missing X-Extension-ID header.",
      hint:  "Chrome extensions must send their ID in the X-Extension-ID header.",
    });
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`  🔑 Extension request from ID: ${extensionId} (dev mode — not validated)`);
    req.extensionId = extensionId;
    return next();
  }

  if (extensionId !== ALLOWED_EXTENSION_ID) {
    console.warn(`⛔ Blocked request from unknown extension ID: ${extensionId}`);
    return res.status(403).json({ error: "Extension not authorized." });
  }

  req.extensionId = extensionId;
  next();
}

function extensionRateLimit(req, res, next) {
  const key = req.extensionId || req.ip;
  const now  = Date.now();

  let record = requestCounts.get(key);

  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + RATE_WINDOW_MS };
  } else {
    record.count++;
  }

  requestCounts.set(key, record);

  res.setHeader("X-RateLimit-Limit",     RATE_LIMIT);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, RATE_LIMIT - record.count));
  res.setHeader("X-RateLimit-Reset",     Math.ceil(record.resetAt / 1000));

  if (record.count > RATE_LIMIT) {
    return res.status(429).json({
      error: "Rate limit exceeded. Max 60 requests per minute.",
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
    });
  }

  next();
}

function logExtensionAccess(req, res, next) {
  const userId = req.user?.userId || "unauthenticated";
  console.log(`📡 Extension API: ${req.method} ${req.path} | user=${userId} | ext=${req.extensionId}`);
  next();
}

module.exports = {
  extensionCors,
  validateExtensionID,
  extensionRateLimit,
  logExtensionAccess,
};
