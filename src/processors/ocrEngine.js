// =============================================================
// src/processors/ocrEngine.js
// OCR engine with PaddleOCR (primary), Google Vision (secondary),
// and Tesseract.js (fallback).
//
// STRATEGY:
//  1. PaddleOCR (free, unlimited, high accuracy)  — always available
//  2. Google Vision API (if GOOGLE_VISION_API_KEY set) — cloud backup
//  3. Tesseract.js (built-in) — last resort fallback
// =============================================================

const Tesseract = require("tesseract.js");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");

let worker = null;
let workerReady = false;
let paddleAvailable = null; // null = not checked, true/false = checked

// ── PaddleOCR (via Python subprocess) ──────────────────────────

const PADDLE_SCRIPT = path.join(__dirname, "paddle_ocr.py");

/**
 * Check if PaddleOCR is available (Python + paddleocr installed)
 */
async function checkPaddleAvailable() {
  if (paddleAvailable !== null) return paddleAvailable;

  return new Promise((resolve) => {
    const proc = spawn("python", ["-c", "from paddleocr import PaddleOCR; print('ok')"], {
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });

    proc.on("close", (code) => {
      paddleAvailable = (code === 0);
      if (paddleAvailable) {
        console.log("✅ PaddleOCR is available");
      } else {
        console.log("⚠️  PaddleOCR not available — will use fallback OCR");
      }
      resolve(paddleAvailable);
    });

    proc.on("error", () => {
      paddleAvailable = false;
      console.log("⚠️  PaddleOCR not available — Python not found or paddleocr not installed");
      resolve(false);
    });
  });
}

/**
 * Run PaddleOCR on an image buffer by writing to a temp file
 */
async function runPaddleOCR(imageBuffer) {
  // Write buffer to a temp file
  const tmpFile = path.join(os.tmpdir(), `formsarthi_ocr_${Date.now()}.png`);

  try {
    fs.writeFileSync(tmpFile, imageBuffer);

    return await new Promise((resolve, reject) => {
      const proc = spawn("python", [PADDLE_SCRIPT, tmpFile], {
        timeout: 120000, // 2 minutes max
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

        if (code !== 0) {
          return reject(new Error(`PaddleOCR exited with code ${code}: ${stderr.slice(-500)}`));
        }

        try {
          // Find the last valid JSON line in stdout (PaddleOCR may print warnings)
          const lines = stdout.trim().split("\n");
          let result = null;
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              result = JSON.parse(lines[i]);
              break;
            } catch (e) { continue; }
          }

          if (!result) {
            return reject(new Error("No valid JSON output from PaddleOCR"));
          }

          if (result.error) {
            return reject(new Error(`PaddleOCR error: ${result.error}`));
          }

          resolve({
            text: result.text || "",
            confidence: result.confidence || 0
          });
        } catch (e) {
          reject(new Error(`Failed to parse PaddleOCR output: ${e.message}`));
        }
      });

      proc.on("error", (e) => {
        try { fs.unlinkSync(tmpFile); } catch (err) { /* ignore */ }
        reject(new Error(`Failed to start PaddleOCR: ${e.message}`));
      });
    });
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    throw err;
  }
}

// ── Google Vision API ──────────────────────────────────────────

function callGoogleVision(imageBuffer) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return reject(new Error("GOOGLE_VISION_API_KEY not set"));
    }

    const base64Image = imageBuffer.toString("base64");
    const requestBody = JSON.stringify({
      requests: [{
        image: { content: base64Image },
        features: [
          { type: "TEXT_DETECTION", maxResults: 1 },
          { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }
        ]
      }]
    });

    const options = {
      hostname: "vision.googleapis.com",
      path: `/v1/images:annotate?key=${apiKey}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`Vision API: ${parsed.error.message}`));
          const response = parsed.responses?.[0];
          if (!response) return reject(new Error("Empty Vision API response"));
          if (response.error) return reject(new Error(`Vision API: ${response.error.message}`));

          let text = "";
          let confidence = 90;
          if (response.fullTextAnnotation) {
            text = response.fullTextAnnotation.text || "";
            confidence = 95;
          } else if (response.textAnnotations?.[0]) {
            text = response.textAnnotations[0].description || "";
          }
          resolve({ text, confidence });
        } catch (e) {
          reject(new Error(`Vision parse error: ${e.message}`));
        }
      });
    });

    req.on("error", (e) => reject(new Error(`Vision request failed: ${e.message}`)));
    req.write(requestBody);
    req.end();
  });
}

// ── Tesseract Fallback ─────────────────────────────────────────

let workerPromise = null;
let tesseractChain = Promise.resolve();

async function getTesseractWorker() {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    console.log("⏳ Initializing Tesseract OCR worker (eng + hin)...");
    const w = await Tesseract.createWorker(["eng", "hin"], 1, {
      logger: process.env.NODE_ENV === "development"
        ? (m) => { if (m.status === "recognizing text") process.stdout.write("."); }
        : () => {},
    });
    await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
    workerReady = true;
    console.log("✅ Tesseract OCR worker ready (eng + hin)");
    return w;
  })();

  return workerPromise;
}

async function runTesseractOCR(imageBuffer) {
  // Use a global queue to serialize Tesseract recognition tasks,
  // preventing concurrent/busy worker crashes.
  return new Promise((resolve, reject) => {
    tesseractChain = tesseractChain
      .then(async () => {
        const w = await getTesseractWorker();
        const { data } = await w.recognize(imageBuffer);
        resolve({ text: data.text || "", confidence: data.confidence || 0 });
      })
      .catch((err) => {
        reject(err);
      });
  });
}

// ── Main OCR Function (Priority: Paddle → Google Vision → Tesseract) ──

async function runOCR(imageBuffer, mode = "default") {
  // 0. Fast mode (force Tesseract for quick classification)
  if (mode === "fast") {
    return runTesseractOCR(imageBuffer);
  }

  // 1. Try PaddleOCR first
  const hasPaddle = await checkPaddleAvailable();
  if (hasPaddle) {
    try {
      const result = await runPaddleOCR(imageBuffer);
      console.log(`  🐉 PaddleOCR: ${result.text.length} chars, ${result.confidence}% confidence`);
      if (process.env.NODE_ENV === "development") {
        console.log("\n📝 PADDLE OCR TEXT (first 800 chars):\n" + result.text.substring(0, 800));
      }
      return result;
    } catch (err) {
      console.warn(`  ⚠️  PaddleOCR failed: ${err.message}`);
    }
  }

  // 2. Try Google Vision
  if (process.env.GOOGLE_VISION_API_KEY) {
    try {
      const result = await callGoogleVision(imageBuffer);
      console.log(`  ☁️  Google Vision: ${result.text.length} chars, ${result.confidence}% confidence`);
      return result;
    } catch (err) {
      console.warn(`  ⚠️  Google Vision failed: ${err.message}`);
    }
  }

  // 3. Fall back to Tesseract
  console.log("  🔄 Falling back to Tesseract...");
  return runTesseractOCR(imageBuffer);
}

async function runOCROnAll(imageBuffers, mode = "default") {
  const textParts = [];
  let totalConfidence = 0;

  for (let i = 0; i < imageBuffers.length; i++) {
    console.log(`  📖 OCR: reading page ${i + 1}/${imageBuffers.length}...`);
    const result = await runOCR(imageBuffers[i], mode);
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
