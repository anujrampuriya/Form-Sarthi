// =============================================================
// src/routes/tools.js
// Stateless route to resize images and convert formats.
// Uses sharp for image processing, pdfkit for PDF conversion.
// =============================================================

const express = require("express");
const multer  = require("multer");
const sharp   = require("sharp");
const PDFDocument = require("pdfkit");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit for resizing
});

// No auth required — stateless image processing, no DB access

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

    // ── PDF conversion: process image with sharp, then embed into PDF via pdfkit ──
    if (targetFormat === "pdf") {
      // First convert the image to PNG buffer (best quality for embedding)
      const imgBuffer = await pipeline.png().toBuffer();
      const metadata  = await sharp(imgBuffer).metadata();

      const imgWidth  = metadata.width  || 595;
      const imgHeight = metadata.height || 842;

      // Create a PDF sized to the image dimensions (no margins)
      const doc = new PDFDocument({
        size: [imgWidth, imgHeight],
        margin: 0,
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));

      const pdfReady = new Promise((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });

      doc.image(imgBuffer, 0, 0, { width: imgWidth, height: imgHeight });
      doc.end();

      const pdfBuffer = await pdfReady;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="converted_${Date.now()}.pdf"`
      );
      return res.send(pdfBuffer);
    }

    // ── Standard image format conversions ──
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
