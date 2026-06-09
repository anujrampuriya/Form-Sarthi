const express = require("express");
const db      = require("../db/database");
const { requireAuth } = require("../middleware/authMiddleware");
const router  = express.Router();

// Apply authentication middleware to all sync endpoints
router.use(requireAuth);

// GET /api/sync/profile?email=<email>
router.get("/profile", (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email parameter is required." });
    }

    const profile = db
      .prepare("SELECT * FROM SyncedProfiles WHERE email = ?")
      .get(email.toLowerCase().trim());

    if (!profile) {
      return res.status(404).json({ error: "Profile not found." });
    }

    // Map database column names to frontend camelCase properties
    return res.status(200).json({
      name: profile.name,
      email: profile.email,
      avatar: profile.avatar,
      color: profile.color,
      encryptedProfile: profile.encrypted_profile
    });
  } catch (err) {
    console.error("Sync get profile error:", err.message);
    return res.status(500).json({ error: "Server error retrieving synced profile." });
  }
});

// POST /api/sync/profile
router.post("/profile", (req, res) => {
  try {
    const { email, name, avatar, color, encryptedProfile } = req.body;

    if (!email || !name || !encryptedProfile) {
      return res.status(400).json({ error: "Email, name, and encryptedProfile are required." });
    }

    db.prepare(`
      INSERT INTO SyncedProfiles (email, name, avatar, color, encrypted_profile, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        avatar = excluded.avatar,
        color = excluded.color,
        encrypted_profile = excluded.encrypted_profile,
        updated_at = datetime('now')
    `).run(
      email.toLowerCase().trim(),
      name.trim(),
      avatar || "🪪",
      color || "purple",
      encryptedProfile
    );

    return res.status(200).json({ message: "Profile synchronized successfully." });
  } catch (err) {
    console.error("Sync post profile error:", err.message);
    return res.status(500).json({ error: "Server error synchronizing profile." });
  }
});

// DELETE /api/sync/profile
router.delete("/profile", (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Email parameter is required." });
    }

    const normalizedEmail = email.toLowerCase().trim();

    db.prepare("DELETE FROM SyncedProfiles WHERE email = ?").run(normalizedEmail);
    db.prepare("DELETE FROM SyncedFiles WHERE email = ?").run(normalizedEmail);

    return res.status(200).json({ message: "Profile and files deleted successfully from sync server." });
  } catch (err) {
    console.error("Sync delete profile error:", err.message);
    return res.status(500).json({ error: "Server error deleting synced profile." });
  }
});

// GET /api/sync/files?email=<email>&docKey=<docKey>
router.get("/files", (req, res) => {
  try {
    const { email, docKey } = req.query;
    if (!email || !docKey) {
      return res.status(400).json({ error: "Email and docKey parameters are required." });
    }

    const file = db
      .prepare("SELECT * FROM SyncedFiles WHERE email = ? AND doc_key = ?")
      .get(email.toLowerCase().trim(), docKey.trim());

    if (!file) {
      return res.status(404).json({ error: "File not found." });
    }

    return res.status(200).json({
      email: file.email,
      docKey: file.doc_key,
      fileData: file.file_data,
      fileType: file.file_type
    });
  } catch (err) {
    console.error("Sync get file error:", err.message);
    return res.status(500).json({ error: "Server error retrieving synced file." });
  }
});

// POST /api/sync/files
router.post("/files", (req, res) => {
  try {
    const { email, docKey, fileData, fileType } = req.body;

    if (!email || !docKey || !fileData || !fileType) {
      return res.status(400).json({ error: "Email, docKey, fileData, and fileType are required." });
    }

    db.prepare(`
      INSERT INTO SyncedFiles (email, doc_key, file_data, file_type, uploaded_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(email, doc_key) DO UPDATE SET
        file_data = excluded.file_data,
        file_type = excluded.file_type,
        uploaded_at = datetime('now')
    `).run(
      email.toLowerCase().trim(),
      docKey.trim(),
      fileData,
      fileType
    );

    return res.status(200).json({ message: "File synchronized successfully." });
  } catch (err) {
    console.error("Sync post file error:", err.message);
    return res.status(500).json({ error: "Server error synchronizing file." });
  }
});

// DELETE /api/sync/files
router.delete("/files", (req, res) => {
  try {
    const { email, docKey } = req.query;
    if (!email || !docKey) {
      return res.status(400).json({ error: "Email and docKey parameters are required." });
    }

    db.prepare("DELETE FROM SyncedFiles WHERE email = ? AND doc_key = ?")
      .run(email.toLowerCase().trim(), docKey.trim());

    return res.status(200).json({ message: "File deleted successfully from sync server." });
  } catch (err) {
    console.error("Sync delete file error:", err.message);
    return res.status(500).json({ error: "Server error deleting synced file." });
  }
});

module.exports = router;
