// =============================================================
// src/controllers/autofillController.js
// Business logic for the Auto Fill feature.
// Used by both /api/autofill and /api/extension/autofill routes.
// =============================================================

const db = require("../db/database");
const { decryptProfileFields } = require("../utils/decrypt");
const { getKey }               = require("../utils/keyStore");

// =============================================================
// getAutofillData(userId, fieldsRequested)
// Returns decrypted profile fields for the given user.
// fieldsRequested = null → return all fields
// fieldsRequested = ["name", "email"] → return only those fields
// =============================================================
async function getAutofillData(userId, fieldsRequested) {
  const encryptedProfile = db
    .prepare("SELECT * FROM UserProfile WHERE user_id = ?")
    .get(userId);

  if (!encryptedProfile) {
    return null;
  }

  const encryptionKey = getKey(userId);
  if (!encryptionKey) {
    throw new Error("Encryption key not available. Please log in again.");
  }

  const fullProfile = decryptProfileFields(encryptedProfile, encryptionKey);

  const allFields = ["name", "dob", "email", "phone", "address", "college"];

  if (fieldsRequested && fieldsRequested.length > 0) {
    const filtered = {};
    for (const field of fieldsRequested) {
      if (allFields.includes(field)) {
        filtered[field] = fullProfile[field] ?? null;
      }
    }
    return filtered;
  }

  return {
    name:    fullProfile.name    ?? null,
    dob:     fullProfile.dob     ?? null,
    email:   fullProfile.email   ?? null,
    phone:   fullProfile.phone   ?? null,
    address: fullProfile.address ?? null,
    college: fullProfile.college ?? null,
  };
}

// =============================================================
// getProfileCompleteness(userId)
// Returns { filled, missing, percent } for UI progress display.
// =============================================================
async function getProfileCompleteness(userId) {
  const profile = await getAutofillData(userId, null);
  if (!profile) return { filled: [], missing: [], percent: 0 };

  const all     = ["name", "dob", "email", "phone", "address", "college"];
  const filled  = all.filter(f => profile[f] !== null);
  const missing = all.filter(f => profile[f] === null);

  return {
    filled,
    missing,
    percent: Math.round((filled.length / all.length) * 100),
  };
}

module.exports = { getAutofillData, getProfileCompleteness };
