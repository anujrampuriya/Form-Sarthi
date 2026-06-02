// =============================================================
// src/routes/profile.js
// Profile read/write endpoints — protected by requireAuth.
//
// ENDPOINTS:
//   GET  /api/profile   → fetch and decrypt current profile
//   PUT  /api/profile   → update one or more profile fields
// =============================================================

const express = require("express");
const db      = require("../db/database");

const { requireAuth }          = require("../middleware/authMiddleware");
const { encryptProfileFields } = require("../utils/encrypt");
const { decryptProfileFields } = require("../utils/decrypt");
const { getKey }               = require("../utils/keyStore");

const router = express.Router();

router.use(requireAuth);

// GET /api/profile
router.get("/", (req, res) => {
  try {
    const { userId } = req.user;

    const encryptedProfile = db
      .prepare("SELECT * FROM UserProfile WHERE user_id = ?")
      .get(userId);

    if (!encryptedProfile) {
      return res.status(404).json({ error: "Profile not found." });
    }

    const encryptionKey = getKey(userId);
    const profile       = decryptProfileFields(encryptedProfile, encryptionKey);

    return res.status(200).json({ profile });

  } catch (err) {
    console.error("Get profile error:", err.message);
    return res.status(500).json({ error: "Failed to retrieve profile." });
  }
});

// PUT /api/profile
router.put("/", (req, res) => {
  try {
    const { userId } = req.user;

    const allowedFields = ["name", "dob", "address", "phone", "email", "college"];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error:   "No valid fields to update.",
        allowed: allowedFields,
      });
    }

    const encryptedProfile = db
      .prepare("SELECT * FROM UserProfile WHERE user_id = ?")
      .get(userId);

    if (!encryptedProfile) {
      return res.status(404).json({ error: "Profile not found." });
    }

    const encryptionKey = getKey(userId);
    const current       = decryptProfileFields(encryptedProfile, encryptionKey);
    const merged        = { ...current, ...updates };
    const newEncrypted  = encryptProfileFields(merged, encryptionKey);

    db.prepare(`
      UPDATE UserProfile
      SET
        encrypted_name    = ?,
        encrypted_dob     = ?,
        encrypted_address = ?,
        encrypted_phone   = ?,
        encrypted_email   = ?,
        encrypted_college = ?
      WHERE user_id = ?
    `).run(
      newEncrypted.encrypted_name,
      newEncrypted.encrypted_dob,
      newEncrypted.encrypted_address,
      newEncrypted.encrypted_phone,
      newEncrypted.encrypted_email,
      newEncrypted.encrypted_college,
      userId
    );

    return res.status(200).json({
      message: "Profile updated successfully.",
      profile: merged,
    });

  } catch (err) {
    console.error("Update profile error:", err.message);
    return res.status(500).json({ error: "Failed to update profile." });
  }
});

module.exports = router;
