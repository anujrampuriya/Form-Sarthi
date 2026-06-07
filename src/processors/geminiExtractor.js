// =============================================================
// src/processors/geminiExtractor.js
// Extracts structured fields from OCR text using the Gemini API.
// =============================================================

const https = require("https");

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    docType: {
      type: "STRING",
      enum: [
        "aadhaar",
        "pan",
        "dl",
        "marksheet_10",
        "marksheet_12",
        "passport",
        "bank_passbook",
        "resume",
        "college_id",
        "certificate",
        "other"
      ],
      description: "The classified type of the document."
    },
    fields: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", description: "Full name of the individual." },
        dob: { type: "STRING", description: "Date of birth (DD/MM/YYYY or YYYY-MM-DD)." },
        gender: { type: "STRING", description: "Gender (Male, Female, Transgender)." },
        caste: { type: "STRING", description: "Category/Caste (General, OBC, SC, ST, EWS)." },
        nationality: { type: "STRING", description: "Nationality (e.g., Indian)." },
        religion: { type: "STRING", description: "Religion." },
        blood_group: { type: "STRING", description: "Blood group (e.g., A+, O-, B+)." },
        marital_status: { type: "STRING", description: "Marital status." },
        phone: { type: "STRING", description: "Primary 10-digit mobile number." },
        alt_phone: { type: "STRING", description: "Secondary mobile number." },
        email: { type: "STRING", description: "Email address." },
        address: { type: "STRING", description: "Complete address." },
        city: { type: "STRING", description: "City from the address." },
        state: { type: "STRING", description: "State from the address." },
        pincode: { type: "STRING", description: "6-digit postal pincode." },
        roll_10: { type: "STRING", description: "Class 10 roll number." },
        roll_12: { type: "STRING", description: "Class 12 roll number." },
        board_10: { type: "STRING", description: "Class 10 board name (e.g., CBSE, State Board)." },
        board_12: { type: "STRING", description: "Class 12 board name (e.g., CBSE, State Board)." },
        marks_10: { type: "STRING", description: "Class 10 marks/percentage/CGPA (e.g., 92.4% or 9.5 CGPA)." },
        marks_12: { type: "STRING", description: "Class 12 marks/percentage/CGPA (e.g., 90.2% or 450/500)." },
        college: { type: "STRING", description: "College/University name." },
        degree: { type: "STRING", description: "Degree/Course name." },
        grad_year: { type: "STRING", description: "Year of graduation/passing (YYYY)." },
        aadhaar: { type: "STRING", description: "12-digit Aadhaar number without spaces or hyphens." },
        pan: { type: "STRING", description: "10-character alphanumeric PAN card number." },
        dl: { type: "STRING", description: "Driving license number without spaces." },
        bank_name: { type: "STRING", description: "Bank name (e.g., State Bank of India)." },
        account_no: { type: "STRING", description: "Bank account number." },
        ifsc: { type: "STRING", description: "11-character bank IFSC code." }
      },
      description: "Extracted fields. Leave field as null if not found in text."
    }
  },
  required: ["docType", "fields"]
};

/**
 * Sends OCR text to Gemini API to perform document classification and field extraction.
 * @param {string} rawText Raw text extracted from the document
 * @param {string|null} docTypeInput Optional expected document type hint
 * @returns {Promise<{docType: string, fields: Object}>}
 */
function extractFieldsWithGemini(rawText, docTypeInput = null) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return reject(new Error("GEMINI_API_KEY environment variable is not set."));
    }

    const prompt = `You are an expert document parser. Your task is to analyze the OCR text extracted from a document, classify its type, and extract relevant fields.

Available document types:
- "aadhaar": Indian Aadhaar Card
- "pan": Indian PAN Card
- "dl": Indian Driving License
- "marksheet_10": Class 10 Marksheet/Certificate
- "marksheet_12": Class 12 Marksheet/Certificate
- "passport": Passport
- "bank_passbook": Bank Passbook or Statement Header
- "resume": Resume / CV
- "college_id": Student/College ID Card
- "certificate": Course or Achievement Certificate
- "other": Any other document type

User-specified expected document type (optional hint): ${docTypeInput || "none"}

Instructions:
1. Identify the document type ("docType"). If user-specified hint is provided, prioritize it unless it is clearly incorrect.
2. Extract values for the 30 fields in the "fields" object.
3. Clean and normalize the values:
   - Names: clean up formatting and OCR errors (e.g., restore spacing, remove odd characters).
   - Dates: format as DD/MM/YYYY or YYYY-MM-DD if possible.
   - Aadhaar: 12 digits (remove spaces/dashes).
   - PAN: 10 chars uppercase.
   - Driving License (dl): remove spaces/dashes.
   - Phone numbers: 10 digits.
   - Bank Account Number / IFSC: extract digits and standard code format.
4. DO NOT hallucinate. If a field is not present in the document, keep it as null.

Raw OCR text to analyze:
---------------------------------------------
${rawText}
---------------------------------------------`;

    const requestBody = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_SCHEMA,
        temperature: 0.1
      }
    });

    const options = {
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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
          if (res.statusCode !== 200) {
            return reject(new Error(`Gemini API returned status ${res.statusCode}: ${data}`));
          }

          const parsed = JSON.parse(data);
          const responseText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!responseText) {
            return reject(new Error("Empty or invalid response structure from Gemini API"));
          }

          const result = JSON.parse(responseText.trim());
          
          // Ensure all 30 fields are present in the response
          const blueprint = {
            name: null, dob: null, gender: null, caste: null, nationality: null, religion: null, blood_group: null, marital_status: null,
            phone: null, alt_phone: null, email: null, address: null, city: null, state: null, pincode: null,
            roll_10: null, roll_12: null, board_10: null, board_12: null, marks_10: null, marks_12: null, college: null, degree: null, grad_year: null,
            aadhaar: null, pan: null, dl: null, bank_name: null, account_no: null, ifsc: null
          };
          const mergedFields = Object.assign({}, blueprint, result.fields);
          
          resolve({
            docType: result.docType || "other",
            fields: mergedFields
          });
        } catch (e) {
          reject(new Error(`Failed to parse Gemini response: ${e.message}. Raw: ${data}`));
        }
      });
    });

    req.on("error", (e) => {
      reject(new Error(`Gemini request failed: ${e.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

module.exports = { extractFieldsWithGemini };
