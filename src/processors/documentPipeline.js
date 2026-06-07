// =============================================================
// src/processors/documentPipeline.js
// Orchestrates the full document processing flow.
// Stateless version: receives a file buffer, runs OCR,
// auto-classifies, extracts fields, and returns them.
//
// ENHANCED: Two-pass OCR strategy for marksheets/certificates.
// Pass 1: Enhanced image → OCR.
// Pass 2: If key fields are missing, retry with original image
//          (sometimes enhancement destroys faint text).
// =============================================================

const { convertPdfToImages }   = require("./pdfConverter");
const { enhanceImages }        = require("./imageEnhancer");
const { runOCROnAll }          = require("./ocrEngine");
const { extractFields, classifyDocument } = require("./fieldExtractor");
const { extractFieldsWithGemini } = require("./geminiExtractor");

const IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/tiff",
]);

// Document types that benefit from gentler enhancement + document OCR mode
const DOCUMENT_TYPES = new Set(["marksheet", "bank_passbook", "resume", "certificate", "passport"]);

async function processDocument(fileBuffer, mimeType, documentTypeInput = null, currentProfileInput = null) {
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

  // Step 2: Try Google Vision API first for OCR (better text extraction accuracy)
  if (process.env.GOOGLE_VISION_API_KEY) {
    console.log("  👁️ GOOGLE_VISION_API_KEY detected. Routing to Google Vision API...");
    try {
      const { extractWithVisionAPI } = require("./visionClient");
      const visionOcr = await extractWithVisionAPI(imageBuffers);
      
      console.log(`  ✅ Vision API complete — ${visionOcr.text.length} chars extracted`);
      require("fs").writeFileSync("latest_ocr_text.txt", visionOcr.text);
      
      let extraction;
      if (process.env.GEMINI_API_KEY) {
        console.log("  🤖 Routing Google Vision text to Gemini for structured extraction...");
        extraction = await extractFieldsWithGemini(visionOcr.text, documentTypeInput, currentProfileInput);
      } else {
        const { extractFields, classifyDocument } = require("./fieldExtractor");
        const quickType = documentTypeInput || classifyDocument(visionOcr.text);
        extraction = extractFields(visionOcr.text, quickType);
      }
      
      return {
        docType: extraction.docType,
        fields: extraction.fields,
        confidence: visionOcr.confidence,
        text: visionOcr.text
      };
    } catch (e) {
      console.warn("  ⚠️ Google Vision API failed:", e.message);
      console.warn("  ⚠️ Falling back to Gemini Multimodal / local OCR pipeline...");
    }
  }

  // Step 2.5: Try Gemini API fallback for Multimodal OCR
  if (process.env.GEMINI_API_KEY) {
    console.log("  🧠 Routing to Gemini Multimodal OCR...");
    try {
      const { extractWithGemini } = require("./geminiProcessor");
      const geminiResult = await extractWithGemini(imageBuffers, documentTypeInput, currentProfileInput);
      console.log(`  ✅ Gemini classification: ${geminiResult.docType}`);
      console.log(`  ✅ Gemini extracted ${Object.keys(geminiResult.fields).length} fields`);
      
      require("fs").writeFileSync("latest_ocr_text.txt", geminiResult.text);

      return {
        docType: geminiResult.docType,
        fields: geminiResult.fields,
        confidence: geminiResult.confidence,
        text: geminiResult.text
      };
    } catch (e) {
      console.warn("  ⚠️ Gemini API failed:", e.message);
      console.warn("  ⚠️ Falling back to local offline OCR pipeline...");
    }
  }

  // Step 3: Quick classification on lightly-enhanced image to pick the right mode
  let quickType = documentTypeInput;

  if (!quickType) {
    console.log("  🔤 Quick OCR pass for classification (First page only)...");
    const quickEnhanced = await enhanceImages([imageBuffers[0]], "standard");
    const quickOcr = await runOCROnAll(quickEnhanced, "fast");
    quickType = classifyDocument(quickOcr.text);
    console.log(`  🏷️  Quick classification: ${quickType}`);
  } else {
    console.log(`  🏷️  Using provided classification: ${quickType}`);
  }

  const isDocumentType = DOCUMENT_TYPES.has(quickType);

  // Step 4: Full OCR with appropriate mode
  let ocrResult;
  let enhancedBuffers;

  if (isDocumentType) {
    // Document mode: gentler enhancement + document OCR
    console.log("  ✨ Document-mode enhancement (preserving fine text)...");
    enhancedBuffers = await enhanceImages(imageBuffers, "document");
    console.log("  🔤 Running document-mode OCR...");
    ocrResult = await runOCROnAll(enhancedBuffers, "document");
  } else {
    // Standard mode: aggressive enhancement for ID cards
    console.log("  ✨ Standard enhancement...");
    enhancedBuffers = await enhanceImages(imageBuffers, "standard");
    console.log("  🔤 Running standard OCR...");
    ocrResult = await runOCROnAll(enhancedBuffers, "default");
  }

  console.log(`  ✅ OCR complete — ${ocrResult.text.length} chars extracted, confidence: ${ocrResult.confidence.toFixed(1)}%`);

  // Step 4: Extract fields
  console.log("  📊 Extracting fields...");
  
  // DEBUG: Save raw OCR text to a file so we can inspect it
  require("fs").writeFileSync("latest_ocr_text.txt", ocrResult.text);
  
  let extraction;
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log("  🤖 Running Gemini structured field extraction...");
      extraction = await extractFieldsWithGemini(ocrResult.text, documentTypeInput || quickType, currentProfileInput);
      console.log(`  ✅ Gemini classified document as: ${extraction.docType}`);
    } catch (err) {
      console.warn(`  ⚠️ Gemini extraction failed: ${err.message}. Falling back to regex extraction.`);
      extraction = extractFields(ocrResult.text, documentTypeInput || quickType);
      console.log(`  ✅ Regex classified document as: ${extraction.docType}`);
    }
  } else {
    extraction = extractFields(ocrResult.text, documentTypeInput || quickType);
    console.log(`  ✅ Regex classified document as: ${extraction.docType}`);
  }

  // Step 5: FALLBACK — if this is a marksheet and we're missing roll number,
  // retry OCR on the ORIGINAL unenhanced image (enhancement may have destroyed it)
  if (extraction.docType === "marksheet") {
    const hasRoll = extraction.fields.roll_10 || extraction.fields.roll_12;
    if (!hasRoll) {
      console.log("  ⚠️  Roll number not found! Retrying OCR on original image...");
      const fallbackOcr = await runOCROnAll(imageBuffers, "document");
      const fallbackExtraction = extractFields(fallbackOcr.text, "marksheet");
      
      const fallbackRoll = fallbackExtraction.fields.roll_10 || fallbackExtraction.fields.roll_12;
      if (fallbackRoll) {
        console.log(`  ✅ Fallback OCR found roll number: ${fallbackRoll}`);
        // Merge fallback results — prefer fallback for missing fields only
        for (const key of Object.keys(extraction.fields)) {
          if (!extraction.fields[key] && fallbackExtraction.fields[key]) {
            extraction.fields[key] = fallbackExtraction.fields[key];
          }
        }
        // Update confidence to the better of the two
        if (fallbackOcr.confidence > ocrResult.confidence) {
          ocrResult.confidence = fallbackOcr.confidence;
          ocrResult.text = fallbackOcr.text;
        }
      } else {
        console.log("  ⚠️  Fallback also failed to find roll number.");
      }
    }
  }

  return {
    docType: extraction.docType,
    fields: extraction.fields,
    confidence: ocrResult.confidence,
    text: ocrResult.text
  };
}

module.exports = { processDocument };
