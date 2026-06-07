require('dotenv').config();
const fs = require('fs');
const https = require('https');

function callGoogleVision(imageBuffer) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return reject(new Error("GOOGLE_VISION_API_KEY not set in .env"));
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
          if (parsed.error) return reject(new Error(`Vision API Error: ${parsed.error.message}`));
          const response = parsed.responses?.[0];
          if (!response) return reject(new Error("Empty Vision API response"));
          if (response.error) return reject(new Error(`Vision API Response Error: ${response.error.message}`));

          let text = "";
          let confidence = 90;
          if (response.fullTextAnnotation) {
            text = response.fullTextAnnotation.text || "";
            confidence = 95;
          } else if (response.textAnnotations?.[0]) {
            text = response.textAnnotations[0].description || "";
          }
          resolve({ text, confidence, fullResponse: response });
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

async function runTest() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Please provide an image path: node testVisionOCR.js <path-to-image>");
    process.exit(1);
  }

  try {
    console.log(`Reading image from ${imagePath}...`);
    const imageBuffer = fs.readFileSync(imagePath);
    console.log("Sending to Google Vision API...");
    
    const startTime = Date.now();
    const result = await callGoogleVision(imageBuffer);
    const timeTaken = Date.now() - startTime;
    
    console.log("\n==========================================");
    console.log(`⏱️  Time taken: ${timeTaken}ms`);
    console.log(`✅ Confidence: ${result.confidence}%`);
    console.log("==========================================\n");
    console.log("📄 EXTRACTED TEXT:\n");
    console.log(result.text);
    console.log("\n==========================================");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

runTest();
