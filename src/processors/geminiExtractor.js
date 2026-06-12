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
        father_name: { type: "STRING", description: "Father's name." },
        mother_name: { type: "STRING", description: "Mother's name." },
        dob: { type: "STRING", description: "Date of birth (DD/MM/YYYY or YYYY-MM-DD)." },
        gender: { type: "STRING", description: "Gender (Male, Female, Transgender)." },
        caste: { type: "STRING", description: "Category/Caste (General, OBC, SC, ST, EWS)." },
        nationality: { type: "STRING", description: "Nationality (e.g., Indian)." },
        religion: { type: "STRING", description: "Religion." },
        blood_group: { type: "STRING", description: "Blood group (e.g., A+, O-, B+)." },
        marital_status: { type: "STRING", description: "Marital status." },
        allergies: { type: "STRING", description: "Allergies or medical conditions." },
        phone: { type: "STRING", description: "Primary 10-digit mobile number." },
        alt_phone: { type: "STRING", description: "Secondary mobile number." },
        emergency_contact_name: { type: "STRING", description: "Emergency contact person's name." },
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
        ifsc: { type: "STRING", description: "11-character bank IFSC code." },
        insurance_policy: { type: "STRING", description: "Health insurance policy number." }
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
function extractFieldsWithGemini(rawText, docTypeInput = null, currentProfileInput = null) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return reject(new Error("GEMINI_API_KEY environment variable is not set."));
    }

    const prompt = `You are an expert Indian document data extraction assistant.
I am providing you with raw OCR text extracted from an uploaded document.
The document type might be: ${docTypeInput || "unknown"}.

CRITICAL EXTRACTION RULES:
1. For 'dob': You MUST extract the Date of Birth. It is almost always present on Aadhaar/PAN/Marksheets. Format it exactly as DD/MM/YYYY.
2. For 'pincode': Extract the 6-digit postal code. IF it is missing from the text, but you know the City/State (e.g. "Jabalpur, MP"), you MUST use your world knowledge to infer and provide a valid 6-digit pincode for that region!
3. For 'address': Extract the FULL address. Combine house number, street, locality, village/town, city, and state into one complete string. Do not include Hindi text.

If a field is strictly not present in the OCR text (and cannot be confidently inferred like the pincode), output null.

CROSS-CHECKING INSTRUCTIONS:
The user has previously extracted data. Their CURRENT profile is:
${currentProfileInput ? JSON.stringify(currentProfileInput, null, 2) : "{}"}

Your task is to extract the details from the NEW OCR text and CROSS-CHECK them against the CURRENT profile.
If the NEW OCR text provides a more accurate version of a field, output the improved field.
If the CURRENT profile's field is highly authoritative and the NEW OCR text is lower quality, output the CURRENT profile's field to preserve it.
Return the FINAL most accurate merged profile fields.

Also classify the document type strictly as one of: "aadhaar", "pan", "marksheet_12", "marksheet_10", "college_id", "resume", "passport", "certificate", "bank_passbook", "dl", "other".

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
          
          // Ensure all 35 fields are present in the response
          const blueprint = {
            name: null, father_name: null, mother_name: null, dob: null, gender: null, caste: null, nationality: null, religion: null, blood_group: null, marital_status: null, allergies: null,
            phone: null, alt_phone: null, emergency_contact_name: null, email: null, address: null, city: null, state: null, pincode: null,
            roll_10: null, roll_12: null, board_10: null, board_12: null, marks_10: null, marks_12: null, college: null, degree: null, grad_year: null,
            aadhaar: null, pan: null, dl: null, bank_name: null, account_no: null, ifsc: null, insurance_policy: null
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
