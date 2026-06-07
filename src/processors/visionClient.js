const https = require('https');

async function extractWithVisionAPI(imageBuffers) {
  if (!process.env.GOOGLE_VISION_API_KEY) {
    throw new Error("GOOGLE_VISION_API_KEY is missing");
  }
  
  const requests = imageBuffers.map(buf => ({
    image: {
      content: buf.toString('base64')
    },
    features: [
      {
        type: "DOCUMENT_TEXT_DETECTION" // Optimized for dense text/documents
      }
    ]
  }));

  const payload = JSON.stringify({ requests });

  const options = {
    hostname: 'vision.googleapis.com',
    path: `/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            let fullText = '';
            
            if (parsed.responses) {
              parsed.responses.forEach(resp => {
                if (resp.fullTextAnnotation && resp.fullTextAnnotation.text) {
                  fullText += resp.fullTextAnnotation.text + "\n\n";
                }
              });
            }
            
            resolve({
              text: fullText.trim(),
              confidence: 95 // Vision API is generally highly confident
            });
          } catch (e) {
            reject(new Error("Failed to parse Vision API response: " + e.message));
          }
        } else {
          reject(new Error(`Vision API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { extractWithVisionAPI };
