// =============================================================
// src/utils/decrypt.js
// AES-256-GCM decryption helpers (mirror of encrypt.js).
//
// WHAT THIS FILE DOES:
//   1. decryptField(encrypted, key)       — decrypt a single field
//   2. decryptProfileFields(row, key)     — decrypt all 6 profile fields
//   3. decryptDocument(encrypted, key)    — decrypt a file Buffer
// =============================================================

const crypto = require("crypto");

// =============================================================
// decryptField(encrypted, key)
// Decrypts a "ivHex:ciphertextHex:authTagHex" string.
// Returns the original plain-text string, or null if input is null.
// =============================================================
function decryptField(encrypted, key) {
  if (!encrypted) return null;

  try {
    const [ivHex, ciphertextHex, authTagHex] = encrypted.split(":");

    const iv         = Buffer.from(ivHex,         "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");
    const authTag    = Buffer.from(authTagHex,     "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    // Wrong key or corrupted data — return null rather than crashing
    return null;
  }
}

// =============================================================
// decryptProfileFields(row, key)
// Decrypts the encrypted_* columns from a UserProfile DB row.
// Returns a plain object: { name, dob, address, phone, email, college }
// =============================================================
function decryptProfileFields(row, key) {
  return {
    name:    decryptField(row.encrypted_name,    key),
    dob:     decryptField(row.encrypted_dob,     key),
    address: decryptField(row.encrypted_address, key),
    phone:   decryptField(row.encrypted_phone,   key),
    email:   decryptField(row.encrypted_email,   key),
    college: decryptField(row.encrypted_college, key),
  };
}

// =============================================================
// decryptDocument(encrypted, key)
// Decrypts a "ivHex:ciphertextHex:authTagHex" string back into
// a Buffer containing the original file bytes.
// =============================================================
function decryptDocument(encrypted, key) {
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(":");

  const iv         = Buffer.from(ivHex,         "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag    = Buffer.from(authTagHex,     "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { decryptField, decryptProfileFields, decryptDocument };
