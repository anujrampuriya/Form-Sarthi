// =============================================================
// src/routes/tools.js
// Stateless route to resize images and convert formats using sharp.
// =============================================================

const express = require("express");
const multer  = require("multer");
const sharp   = require("sharp");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for resizing
});

// No auth required for local stateless processing

// POST /api/tools/resize
// Receives an image, resizes it and/or changes its format, and returns the binary file.
router.post("/resize", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use field name 'file'." });
    }

    const { width, height, format, quality } = req.body;
    
    let pipeline = sharp(req.file.buffer);

    // Apply resizing if width or height is provided
    if (width || height) {
      const resizeOptions = {
        fit: "inside",
        withoutEnlargement: true
      };
      if (width) resizeOptions.width = parseInt(width, 10);
      if (height) resizeOptions.height = parseInt(height, 10);
      pipeline = pipeline.resize(resizeOptions);
    }

    // Apply format conversion and quality
    const q = quality ? parseInt(quality, 10) : 80;
    const targetFormat = (format || "").toLowerCase();

    let contentType = req.file.mimetype;
    let extension = req.file.originalname.split(".").pop();

    if (targetFormat === "jpeg" || targetFormat === "jpg") {
      pipeline = pipeline.jpeg({ quality: q });
      contentType = "image/jpeg";
      extension = "jpg";
    } else if (targetFormat === "png") {
      pipeline = pipeline.png({ quality: q });
      contentType = "image/png";
      extension = "png";
    } else if (targetFormat === "webp") {
      pipeline = pipeline.webp({ quality: q });
      contentType = "image/webp";
      extension = "webp";
    } else if (targetFormat === "pdf") {
      // If they want PDF, we can use sharp's PDF output support if available, or fallback
      // Note: sharp supports pdf output in newer versions if built with libvips having pdf support
      try {
        pipeline = pipeline.toFormat("pdf", { quality: q });
        contentType = "application/pdf";
        extension = "pdf";
      } catch (e) {
        return res.status(400).json({ error: "PDF conversion is not supported on this server setup." });
      }
    }

    const outputBuffer = await pipeline.toBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resized_${Date.now()}.${extension}"`
    );

    return res.send(outputBuffer);

  } catch (err) {
    console.error("Resize tool error:", err.message);
    return res.status(500).json({ error: err.message || "Failed to resize/convert document." });
  }
});

module.exports = router;
