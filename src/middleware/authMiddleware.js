// =============================================================
// src/middleware/authMiddleware.js
// JWT authentication gatekeeper for all protected routes.
// =============================================================

const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const { hasKey } = require("../utils/keyStore");

// Generate a random secret on startup if not provided
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn("⚠️  WARNING: JWT_SECRET not set in .env. A random secret was generated for this session.");
  console.warn("⚠️  This means all logged-in users will be logged out if the server restarts.");
}

function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Access denied. No token provided.",
      hint:  "Add header: Authorization: Bearer <your_token>",
    });
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Session expired. Please log in again.",
      });
    }
    return res.status(401).json({
      error: "Invalid token. Please log in again.",
    });
  }

  if (!hasKey(decoded.userId)) {
    return res.status(401).json({
      error: "Session not active. Please log in again.",
      hint:  "Your session key was cleared (logout or server restart).",
    });
  }

  req.user = { userId: decoded.userId };
  next();
}

module.exports = { requireAuth };
