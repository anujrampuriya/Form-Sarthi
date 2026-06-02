// =============================================================
// src/processors/imageEnhancer.js
// Improves image quality for OCR using sharp.
//
// PIPELINE: Resize → Greyscale → Normalise → Sharpen → Threshold
// =============================================================

const sharp = require("sharp");

async function enhanceImage(imageBuffer) {
  try {
    const enhanced = await sharp(imageBuffer)
      .resize({
        width:              2000,
        height:             2000,
        fit:                "inside",
        withoutEnlargement: false,
      })
      .greyscale()
      .normalise()
      .linear(1.4, -(1.4 * 128 - 128))
      .sharpen({ sigma: 2, m1: 0, m2: 3 })
      .threshold(128)
      .png()
      .toBuffer();

    return enhanced;

  } catch (err) {
    console.warn("⚠️  Image enhancement failed, using original:", err.message);
    return imageBuffer;
  }
}

async function enhanceImages(imageBuffers) {
  return Promise.all(imageBuffers.map(enhanceImage));
}

module.exports = { enhanceImage, enhanceImages };
