// =============================================================
// src/utils/keyStore.js
// In-memory encryption key store.
//
// WHAT THIS FILE DOES:
//   Stores each logged-in user's AES encryption key in RAM.
//   Keys are NEVER written to disk — they live only while the
//   server process is running and the user is logged in.
//
// WHY IN-MEMORY?
//   The database stores only ciphertext. To decrypt it, you need
//   the key. We derive the key from the user's PIN at login time
//   and keep it in RAM for the session. On logout (or server restart),
//   the key is gone — database contents become unreadable without
//   re-login.
//
// STRUCTURE: Map<userId, Buffer>
// =============================================================

const keyStore = new Map(); // userId → 32-byte AES key Buffer

// Store a key (called at login/signup)
function setKey(userId, key) {
  keyStore.set(userId, key);
}

// Get the key for a user (called by every protected route)
function getKey(userId) {
  return keyStore.get(userId) || null;
}

// Check if a key exists (used by authMiddleware)
function hasKey(userId) {
  return keyStore.has(userId);
}

// Remove the key (called at logout)
function removeKey(userId) {
  keyStore.delete(userId);
}

module.exports = { setKey, getKey, hasKey, removeKey };
