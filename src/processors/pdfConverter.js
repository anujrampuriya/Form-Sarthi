// =============================================================
// src/processors/pdfConverter.js
// Converts PDF pages into images so Tesseract OCR can read them.
//
// FLOW: PDF Buffer → temp file → pdf2pic → image Buffers[]
// =============================================================

const { fromPath }  = require("pdf2pic");
const fs            = require("fs");
const path          = require("path");
const os            = require("os");
const { v4: uuidv4 } = require("uuid");

async function convertPdfToImages(pdfBuffer) {
  const tempId      = uuidv4();
  const tempPdfPath = path.join(os.tmpdir(), `sff_${tempId}.pdf`);
  const tempOutDir  = path.join(os.tmpdir(), `sff_${tempId}_pages`);

  fs.writeFileSync(tempPdfPath, pdfBuffer);
  fs.mkdirSync(tempOutDir, { recursive: true });

  const imageBuffers = [];

  try {
    const converter = fromPath(tempPdfPath, {
      density:     300,
      saveFilename: "page",
      savePath:     tempOutDir,
      format:       "png",
      width:        2480,
      height:       3508,
    });

    const results = await converter.bulk(-1);

    for (const result of results) {
      if (result.path && fs.existsSync(result.path)) {
        const imgBuffer = fs.readFileSync(result.path);
        imageBuffers.push(imgBuffer);
      }
    }

  } finally {
    try {
      fs.unlinkSync(tempPdfPath);
      fs.rmSync(tempOutDir, { recursive: true, force: true });
    } catch {
      // Non-fatal cleanup
    }
  }

  if (imageBuffers.length === 0) {
    throw new Error("PDF conversion produced no images. The PDF may be empty or corrupted.");
  }

  return imageBuffers;
}

module.exports = { convertPdfToImages };
