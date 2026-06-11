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
const http = require("http");

let worker = null;
let workerReady = false;
let paddleAvailable = null; // null = not checked, true/false = checked

// ── EasyOCR & PaddleOCR (via Python subprocess daemons) ──

const EASYOCR_DAEMON_SCRIPT = path.join(__dirname, "easy_ocr_server.py");
const PADDLEOCR_DAEMON_SCRIPT = path.join(__dirname, "paddle_ocr_server.py");

let easyOcrServerProc = null;
let easyOcrAvailable = null;

let paddleOcrServerProc = null;

/**
 * Check if PaddleOCR is available and start the daemon server
 */
async function checkPaddleAvailable() {
  if (paddleAvailable !== null) return paddleAvailable;

  return new Promise((resolve) => {
    console.log("⏳ Starting persistent PaddleOCR daemon...");
    paddleOcrServerProc = spawn("python", [PADDLEOCR_DAEMON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let isResolved = false;

    const onData = (d) => {
      const msg = d.toString();
      if (msg.includes("running on port")) {
        if (!isResolved) {
          paddleAvailable = true;
          isResolved = true;
          console.log("✅ PaddleOCR daemon started successfully");
          resolve(true);
        }
      }
    };

    paddleOcrServerProc.stdout.on("data", onData);
    paddleOcrServerProc.stderr.on("data", onData);

    paddleOcrServerProc.on("close", (code) => {
      if (!isResolved) {
        paddleAvailable = false;
        isResolved = true;
        console.log("⚠️  PaddleOCR daemon failed to start");
        resolve(false);
      }
    });

    paddleOcrServerProc.on("error", () => {
      if (!isResolved) {
        paddleAvailable = false;
        isResolved = true;
        console.log("⚠️  PaddleOCR daemon not available");
        resolve(false);
      }
    });
  });
}

/**
 * Check if EasyOCR is available and start the daemon server
 */
async function checkEasyOcrAvailable() {
  if (easyOcrAvailable !== null) return easyOcrAvailable;

  return new Promise((resolve) => {
    console.log("⏳ Starting persistent EasyOCR daemon...");
    easyOcrServerProc = spawn("python", [EASYOCR_DAEMON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let isResolved = false;

    easyOcrServerProc.stdout.on("data", (d) => {
      const msg = d.toString();
      if (msg.includes("running on port")) {
        if (!isResolved) {
          easyOcrAvailable = true;
          isResolved = true;
          console.log("✅ EasyOCR daemon started successfully");
          resolve(true);
        }
      }
    });

    easyOcrServerProc.stderr.on("data", (d) => {
      const msg = d.toString();
      if (msg.includes("running on port")) {
        if (!isResolved) {
          easyOcrAvailable = true;
          isResolved = true;
          console.log("✅ EasyOCR daemon started successfully");
          resolve(true);
        }
      }
    });

    easyOcrServerProc.on("close", (code) => {
      if (!isResolved) {
        easyOcrAvailable = false;
        isResolved = true;
        console.log("⚠️  EasyOCR daemon failed to start — will use fallback OCR");
        resolve(false);
      }
    });

    easyOcrServerProc.on("error", () => {
      if (!isResolved) {
        easyOcrAvailable = false;
        isResolved = true;
        console.log("⚠️  EasyOCR daemon not available — Python not found or easyocr not installed");
        resolve(false);
      }
    });
  });
}

/**
 * Run EasyOCR by querying the local HTTP daemon
 */
async function runEasyOCR(imageBuffer) {
  // Write buffer to a temp file since EasyOCR daemon expects a file path
  const tmpFile = path.join(os.tmpdir(), `formsarthi_ocr_${Date.now()}.png`);

  try {
    const sharp = require("sharp");
    // Resize the image to speed up EasyOCR massively while retaining readability
    const processedBuffer = await sharp(imageBuffer)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .toBuffer();

    fs.writeFileSync(tmpFile, processedBuffer);

    return await new Promise((resolve, reject) => {
      const postData = JSON.stringify({ image_path: tmpFile });

      const options = {
        hostname: '127.0.0.1',
        port: 8089,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
          try {
            const result = JSON.parse(rawData);
            if (result.error) {
              return reject(new Error(`EasyOCR daemon error: ${result.error}`));
            }
            resolve({
              text: result.text || "",
              confidence: result.confidence || 0
            });
          } catch (e) {
            reject(new Error(`Failed to parse EasyOCR output: ${e.message}`));
          }
        });
      });

      req.on('error', (e) => {
        try { fs.unlinkSync(tmpFile); } catch (err) { /* ignore */ }
        reject(new Error(`EasyOCR request failed: ${e.message}`));
      });

      req.write(postData);
      req.end();
    });
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
    throw err;
  }
}

// ── PaddleOCR (via Python subprocess) ──────────────────────────

async function runPaddleOCR(imageBuffer) {
  const hasPaddle = await checkPaddleAvailable();
  if (!hasPaddle) {
    throw new Error("PaddleOCR daemon not available");
  }

  const tmpFile = path.join(os.tmpdir(), `formsarthi_paddle_${Date.now()}.png`);

  try {
    const sharp = require("sharp");
    const processedBuffer = await sharp(imageBuffer)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .toBuffer();

    fs.writeFileSync(tmpFile, processedBuffer);

    return await new Promise((resolve, reject) => {
      const postData = JSON.stringify({ image_path: tmpFile });

      const options = {
        hostname: '127.0.0.1',
        port: 8090,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
          try {
            const result = JSON.parse(rawData);
            if (result.error) {
              return reject(new Error(`PaddleOCR daemon error: ${result.error}`));
            }
            resolve({
              text: result.text || "",
              confidence: result.confidence || 0
            });
          } catch (e) {
            reject(new Error(`Failed to parse PaddleOCR output: ${e.message}`));
          }
        });
      });

      req.on('error', (e) => {
        try { fs.unlinkSync(tmpFile); } catch (err) { /* ignore */ }
        reject(new Error(`PaddleOCR request failed: ${e.message}`));
      });

      req.write(postData);
      req.end();
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

let scheduler = null;
let schedulerPromise = null;

async function getTesseractScheduler() {
  if (schedulerPromise) return schedulerPromise;

  schedulerPromise = (async () => {
    console.log("⏳ Initializing Tesseract OCR Scheduler with 2 workers...");
    scheduler = Tesseract.createScheduler();
    
    for (let i = 0; i < 2; i++) {
      const w = await Tesseract.createWorker(["eng", "hin"], 1, {
        logger: process.env.NODE_ENV === "development"
          ? (m) => { if (m.status === "recognizing text") process.stdout.write("."); }
          : () => {},
      });
      await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
      scheduler.addWorker(w);
    }
    
    workerReady = true;
    console.log("✅ Tesseract OCR Scheduler ready (2 workers)");
    return scheduler;
  })();

  return schedulerPromise;
}

const sharp = require("sharp");

async function runTesseractOCR(imageBuffer) {
  let processedBuffer = imageBuffer;
  try {
    processedBuffer = await sharp(imageBuffer)
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();
    console.log("  ✨ Image optimized for Tesseract");
  } catch(e) {
    console.warn("  ⚠️  Sharp pre-processing failed, using original image", e.message);
  }

  // Add the job to the scheduler, which handles queueing and worker assignment
  const sched = await getTesseractScheduler();
  const { data } = await sched.addJob("recognize", processedBuffer);
  return { text: data.text || "", confidence: data.confidence || 0 };
}

// ── Main OCR Function (Priority: EasyOCR → PaddleOCR → Tesseract) ──

async function runOCR(imageBuffer, mode = "default") {
  // 0. Fast mode (force Tesseract for quick classification)
  if (mode === "fast") {
    return runTesseractOCR(imageBuffer);
  }

  // 1. Try EasyOCR first
  const hasEasyOCR = await checkEasyOcrAvailable();
  if (hasEasyOCR) {
    try {
      const result = await runEasyOCR(imageBuffer);
      console.log(`  🐉 EasyOCR: ${result.text.length} chars, ${result.confidence}% confidence`);
      if (process.env.NODE_ENV === "development") {
        console.log("\n📝 EASY OCR TEXT (first 800 chars):\n" + result.text.substring(0, 800));
      }
      return result;
    } catch (err) {
      console.warn(`  ⚠️  EasyOCR failed: ${err.message}`);
    }
  }

  // 2. Try PaddleOCR
  try {
    console.log("  🔄 Falling back to PaddleOCR...");
    const result = await runPaddleOCR(imageBuffer);
    console.log(`  🚣 PaddleOCR: ${result.text.length} chars, ${result.confidence}% confidence`);
    return result;
  } catch (err) {
    console.warn(`  ⚠️  PaddleOCR failed: ${err.message}`);
  }

  // 3. Try Google Vision (if key exists)
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
  if (scheduler && workerReady) {
    await scheduler.terminate();
    workerReady = false;
    scheduler = null;
  }
}

module.exports = { runOCR, runOCROnAll, terminateWorker };
