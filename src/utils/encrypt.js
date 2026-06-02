// =============================================================
// src/utils/encrypt.js
// AES-256-GCM encryption helpers.
//
// WHAT THIS FILE DOES:
//   1. deriveKeyFromPIN(pin)        — PBKDF2 key derivation
//   2. encryptField(value, key)     — encrypt a single string
//   3. encryptProfileFields(obj, key) — encrypt all 6 profile fields
//   4. encryptDocument(buffer, key) — encrypt a file Buffer
//
// ALGORITHM: AES-256-GCM
//   - 256-bit key (32 bytes)
//   - GCM provides both confidentiality AND authentication (MAC)
//   - Fresh random 12-byte IV per encryption call
//   - Output format: "ivHex:ciphertextHex:authTagHex"
// =============================================================

const crypto = require("crypto");

// PBKDF2 parameters — tune upward for production
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN     = 32; // 256 bits
const PBKDF2_DIGEST     = "sha256";
// Fixed salt scoped to this app (not per-user salt — user's email acts as additional identity)
const PBKDF2_SALT       = Buffer.from("FormSarthiAppSalt2026", "utf8");

// =============================================================
// deriveKeyFromPIN(pin)
// Derives a deterministic 32-byte AES key from a 6-digit PIN.
// Same PIN always → same key (needed to re-derive on login).
// =============================================================
function deriveKeyFromPIN(pin) {
  return crypto.pbkdf2Sync(
    pin,
    PBKDF2_SALT,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  );
}

// =============================================================
// encryptField(value, key)
// Encrypts a single string value with AES-256-GCM.
// Returns "ivHex:ciphertextHex:authTagHex" or null if value is null.
// =============================================================
function encryptField(value, key) {
  if (value === null || value === undefined) return null;

  const iv     = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag(); // 16-byte GCM authentication tag

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

// =============================================================
// encryptProfileFields(profile, key)
// Encrypts all 6 profile fields at once.
// Returns an object with encrypted_* keys for direct DB insert.
// =============================================================
function encryptProfileFields(profile, key) {
  return {
    encrypted_name:    encryptField(profile.name,    key),
    encrypted_dob:     encryptField(profile.dob,     key),
    encrypted_address: encryptField(profile.address, key),
    encrypted_phone:   encryptField(profile.phone,   key),
    encrypted_email:   encryptField(profile.email,   key),
    encrypted_college: encryptField(profile.college, key),
  };
}

// =============================================================
// encryptDocument(buffer, key)
// Encrypts a raw file Buffer for storage in SQLite.
// Returns "ivHex:ciphertextHex:authTagHex".
// =============================================================
function encryptDocument(buffer, key) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag   = cipher.getAuthTag();

  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

module.exports = { deriveKeyFromPIN, encryptField, encryptProfileFields, encryptDocument };
