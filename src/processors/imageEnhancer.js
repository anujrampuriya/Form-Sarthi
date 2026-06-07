// =============================================================
// src/processors/imageEnhancer.js
// Improves image quality for OCR using sharp.
//
// TWO MODES:
//  1. Standard: for ID cards, PAN, DL (high-contrast docs)
//  2. Document: for marksheets, certificates (complex layouts
//     with watermarks, colored backgrounds, tables)
// =============================================================

const sharp = require("sharp");

/**
 * Standard enhancement — aggressive binarization for simple docs
 * (Aadhaar, PAN, DL etc.)
 */
async function enhanceStandard(imageBuffer) {
  return sharp(imageBuffer)
    .resize({
      width:              2500,
      height:             2500,
      fit:                "inside",
      withoutEnlargement: false,
    })
    .greyscale()
    .normalize()
    .clahe({ width: 200, height: 200 })
    .sharpen({ sigma: 1.5, m1: 0, m2: 2 })
    .png()
    .toBuffer();
}

/**
 * Document-mode enhancement — gentler processing that preserves
 * fine text details in marksheets, certificates, passbooks.
 * No harsh threshold; uses adaptive contrast instead.
 */
async function enhanceDocument(imageBuffer) {
  return sharp(imageBuffer)
    .resize({
      width:              3000,      // larger resolution for small printed text
      height:             3000,
      fit:                "inside",
      withoutEnlargement: false,
    })
    .greyscale()
    .normalise()                      // stretch histogram to full range
    .linear(1.6, -(1.6 * 128 - 128)) // boost contrast without clipping
    .sharpen({ sigma: 1.5, m1: 0.5, m2: 2 })  // gentler sharpen
    .median(3)                        // denoise while preserving edges
    .png()
    .toBuffer();
}

async function enhanceImage(imageBuffer, mode = "standard") {
  try {
    if (mode === "document") {
      return await enhanceDocument(imageBuffer);
    }
    return await enhanceStandard(imageBuffer);
  } catch (err) {
    console.warn("⚠️  Image enhancement failed, using original:", err.message);
    return imageBuffer;
  }
}

async function enhanceImages(imageBuffers, mode = "standard") {
  return Promise.all(imageBuffers.map(buf => enhanceImage(buf, mode)));
}

module.exports = { enhanceImage, enhanceImages };
