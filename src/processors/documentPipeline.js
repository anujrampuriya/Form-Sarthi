// =============================================================
// src/processors/documentPipeline.js
// Orchestrates the full document processing flow.
// Stateless version: receives a file buffer, runs OCR,
// auto-classifies, extracts fields, and returns them.
// =============================================================

const { convertPdfToImages }   = require("./pdfConverter");
const { enhanceImages }        = require("./imageEnhancer");
const { runOCROnAll }          = require("./ocrEngine");
const { extractFields }        = require("./fieldExtractor");

const IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/tiff",
]);

async function processDocument(fileBuffer, mimeType, documentTypeInput = null) {
  console.log(`\n🔍 Processing document (${mimeType})`);

  // Step 1: Get image Buffers
  let imageBuffers;

  if (mimeType === "application/pdf") {
    console.log("  📄 Converting PDF to images...");
    imageBuffers = await convertPdfToImages(fileBuffer);
    console.log(`  ✅ ${imageBuffers.length} page(s) converted`);
  } else if (IMAGE_MIMES.has(mimeType)) {
    imageBuffers = [fileBuffer];
    console.log("  🖼️  Image input detected");
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  // Step 2: Enhance images
  console.log("  ✨ Enhancing image quality...");
  const enhanced = await enhanceImages(imageBuffers);

  // Step 3: Run OCR
  console.log("  🔤 Running OCR...");
  const ocrResult = await runOCROnAll(enhanced);
  console.log(`  ✅ OCR complete — ${ocrResult.text.length} chars extracted, confidence: ${ocrResult.confidence}%`);

  // Step 4: Extract structured fields
  console.log("  📊 Extracting fields...");
  const extraction = extractFields(ocrResult.text, documentTypeInput);
  console.log(`  ✅ Document classified as: ${extraction.docType}`);

  return {
    docType: extraction.docType,
    fields: extraction.fields,
    confidence: ocrResult.confidence,
    text: ocrResult.text
  };
}

module.exports = { processDocument };
