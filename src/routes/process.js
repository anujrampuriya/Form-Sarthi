// =============================================================
// src/routes/process.js
// Stateless route to handle document upload and OCR processing.
// =============================================================

const express = require("express");
const multer  = require("multer");
const { processDocument } = require("../processors/documentPipeline");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth);

// Multer setup
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

// No auth required for local stateless processing

// POST /api/process
// Accepts a document via multipart upload (under the key "document" or "file").
// Extracts data and returns it statelessly without database storage.
router.post("/", upload.single("document"), async (req, res) => {
  try {
    let file = req.file;
    if (!file && req.body.file) {
      // Fallback if sent in different format
      return res.status(400).json({ error: "No file uploaded. Use field name 'document'." });
    }
    
    // Support either field name "document" or "file"
    if (!file) {
      // Try fetching "file" as fallback
      const uploadHandler = upload.single("file");
      await new Promise((resolve, reject) => {
        uploadHandler(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      file = req.file;
    }

    if (!file) {
      return res.status(400).json({ error: "No file uploaded. Use field name 'document' or 'file'." });
    }

    const docTypeInput = req.body.document_type || null;
    let currentProfileInput = null;
    try {
      if (req.body.current_profile) {
        currentProfileInput = JSON.parse(req.body.current_profile);
      }
    } catch (e) {
      console.warn("Could not parse current_profile JSON");
    }

    const result = await processDocument(file.buffer, file.mimetype, docTypeInput, currentProfileInput);

    return res.status(200).json({
      success: true,
      message: "Document processed successfully.",
      docType: result.docType,
      fields: result.fields,
      confidence: result.confidence,
      text: result.text
    });

  } catch (err) {
    console.error("Document processing error:", err.message);
    return res.status(500).json({ error: err.message || "Failed to process document." });
  }
});

module.exports = router;
