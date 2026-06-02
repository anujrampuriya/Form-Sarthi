// =============================================================
// src/routes/documents.js
// Document upload / list / download / delete endpoints.
// All routes are protected by requireAuth.
// =============================================================

const express = require("express");
const multer  = require("multer");
const { v4: uuidv4 } = require("uuid");

const db      = require("../db/database");
const { requireAuth }       = require("../middleware/authMiddleware");
const { encryptDocument }   = require("../utils/encrypt");
const { decryptDocument }   = require("../utils/decrypt");
const { getKey }            = require("../utils/keyStore");

const router = express.Router();

// ── Multer setup ──────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max
  },
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG, PNG, and WEBP files are allowed."));
    }
  },
});

const VALID_DOCUMENT_TYPES = [
  "aadhaar", "pan", "resume", "marksheet",
  "college_id", "certificate", "passport", "other",
];

// All routes require auth
router.use(requireAuth);

// =============================================================
// POST /api/documents/upload
// =============================================================
router.post("/upload", upload.single("file"), (req, res) => {
  try {
    const { userId } = req.user;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use field name 'file'." });
    }

    const { document_type } = req.body;
    if (!document_type || !VALID_DOCUMENT_TYPES.includes(document_type.toLowerCase())) {
      return res.status(400).json({
        error: "Invalid or missing document_type.",
        valid_types: VALID_DOCUMENT_TYPES,
      });
    }

    const encryptionKey = getKey(userId);
    const encryptedData = encryptDocument(req.file.buffer, encryptionKey);
    const docId         = uuidv4();

    db.prepare(`
      INSERT INTO Documents (id, user_id, document_type, encrypted_document_data)
      VALUES (?, ?, ?, ?)
    `).run(docId, userId, document_type.toLowerCase(), encryptedData);

    console.log(`📄 Document uploaded: ${document_type} for user ${userId}`);

    return res.status(201).json({
      message: "Document uploaded and encrypted successfully.",
      document: {
        id:            docId,
        document_type: document_type.toLowerCase(),
        uploaded_at:   new Date().toISOString(),
        size_bytes:    req.file.size,
      },
    });

  } catch (err) {
    console.error("Upload error:", err.message);
    return res.status(500).json({ error: "Failed to upload document." });
  }
});

// =============================================================
// GET /api/documents  — list metadata (no file data)
// =============================================================
router.get("/", (req, res) => {
  try {
    const { userId } = req.user;

    const docs = db.prepare(`
      SELECT id, document_type, uploaded_at
      FROM Documents
      WHERE user_id = ?
      ORDER BY uploaded_at DESC
    `).all(userId);

    return res.status(200).json({ count: docs.length, documents: docs });

  } catch (err) {
    console.error("List documents error:", err.message);
    return res.status(500).json({ error: "Failed to retrieve documents." });
  }
});

// =============================================================
// GET /api/documents/:id  — download and decrypt a document
// =============================================================
router.get("/:id", (req, res) => {
  try {
    const { userId } = req.user;
    const { id }     = req.params;

    const doc = db.prepare(`
      SELECT * FROM Documents WHERE id = ? AND user_id = ?
    `).get(id, userId);

    if (!doc) {
      return res.status(404).json({ error: "Document not found." });
    }

    const encryptionKey = getKey(userId);
    const fileBuffer    = decryptDocument(doc.encrypted_document_data, encryptionKey);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doc.document_type}_${id.slice(0, 8)}.bin"`
    );

    return res.send(fileBuffer);

  } catch (err) {
    console.error("Download error:", err.message);
    return res.status(500).json({ error: "Failed to decrypt document." });
  }
});

// =============================================================
// DELETE /api/documents/:id
// =============================================================
router.delete("/:id", (req, res) => {
  try {
    const { userId } = req.user;
    const { id }     = req.params;

    const doc = db.prepare(
      "SELECT id FROM Documents WHERE id = ? AND user_id = ?"
    ).get(id, userId);

    if (!doc) {
      return res.status(404).json({ error: "Document not found." });
    }

    db.prepare("DELETE FROM Documents WHERE id = ?").run(id);

    return res.status(200).json({ message: "Document deleted successfully." });

  } catch (err) {
    console.error("Delete document error:", err.message);
    return res.status(500).json({ error: "Failed to delete document." });
  }
});

module.exports = router;
