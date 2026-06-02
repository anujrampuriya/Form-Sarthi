// =============================================================
// src/processors/ocrEngine.js
// Tesseract OCR wrapper — runs OCR on image Buffers.
//
// Uses a shared worker (initialized once) to avoid the overhead
// of loading the 10MB language model on every request.
// Supports English + Hindi for Aadhaar cards.
// =============================================================

const Tesseract = require("tesseract.js");

let worker      = null;
let workerReady = false;

async function getWorker() {
  if (workerReady) return worker;

  worker = await Tesseract.createWorker(
    ["eng", "hin"],
    1,
    {
      logger: process.env.NODE_ENV === "development"
        ? (m) => { if (m.status === "recognizing text") process.stdout.write("."); }
        : () => {},
    }
  );

  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
  });

  workerReady = true;
  console.log("✅ Tesseract OCR worker ready (eng + hin)");
  return worker;
}

async function runOCR(imageBuffer) {
  const w      = await getWorker();
  const { data } = await w.recognize(imageBuffer);
  return {
    text: data.text || "",
    confidence: data.confidence || 0
  };
}

async function runOCROnAll(imageBuffers) {
  const textParts = [];
  let totalConfidence = 0;

  for (let i = 0; i < imageBuffers.length; i++) {
    console.log(`  📖 OCR: reading page ${i + 1}/${imageBuffers.length}...`);
    const result = await runOCR(imageBuffers[i]);
    textParts.push(result.text);
    totalConfidence += result.confidence;
  }

  const averageConfidence = imageBuffers.length > 0 ? (totalConfidence / imageBuffers.length) : 0;

  return {
    text: textParts.join("\n\n--- PAGE BREAK ---\n\n"),
    confidence: averageConfidence
  };
}

async function terminateWorker() {
  if (worker && workerReady) {
    await worker.terminate();
    workerReady = false;
    worker = null;
  }
}

module.exports = { runOCR, runOCROnAll, terminateWorker };
