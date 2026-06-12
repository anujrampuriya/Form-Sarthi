const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

async function extractWithGemini(imageBuffers, documentTypeInput, currentProfileInput = null) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Using gemini-2.5-flash for the fastest, most cost-effective multimodal extraction
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const imageParts = imageBuffers.map(buffer => ({
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: "image/jpeg" // Using image/jpeg broadly for the API
    }
  }));

const prompt = `
You are a high-accuracy Indian document extraction AI.
Analyze the provided document image(s) and extract all the relevant details.
The document might be of type: ${documentTypeInput || "unknown"}.
Please extract the information strictly according to the provided JSON schema.

CRITICAL EXTRACTION RULES:
1. For 'dob': You MUST extract the Date of Birth. It is almost always present on Aadhaar/PAN/Marksheets. Format it exactly as DD/MM/YYYY.
2. For 'pincode': Extract the 6-digit postal code. IF it is missing from the text, but you know the City/State (e.g. "Jabalpur, MP"), you MUST use your world knowledge to infer and provide a valid 6-digit pincode for that region!
3. For 'address': Extract the FULL address. Combine house number, street, locality, village/town, city, and state into one complete string. Do not include Hindi text.
4. For 'confidence': Estimate an overall extraction confidence score between 0.0 and 100.0 based on readability, text clarity, and correctness of mapping fields from the document.

If a field is strictly not present in the document (and cannot be confidently inferred like the pincode), output null.

CROSS-CHECKING INSTRUCTIONS:
The user has previously extracted data from other documents. Their CURRENT profile is:
${currentProfileInput ? JSON.stringify(currentProfileInput, null, 2) : "{}"}

Your task is to extract the details from the NEW document and CROSS-CHECK them against the CURRENT profile.
If the NEW document provides a more accurate or authoritative version of a field (e.g. Passport/Aadhaar > College ID for Name and DOB), output the improved field.
If the CURRENT profile's field is already highly authoritative and the NEW document is lower quality, output the CURRENT profile's field to preserve it.
Basically, return the FINAL most accurate merged profile fields.

Also classify the document type strictly as one of:
"aadhaar", "pan", "marksheet_12", "marksheet_10", "college_id", "resume", "passport", "certificate", "bank_passbook", "dl", "other".
`;

  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      docType: { type: SchemaType.STRING, description: "The classified document type." },
      confidence: { type: SchemaType.NUMBER, description: "Estimated extraction confidence score (0.0 to 100.0) based on document readability, text clarity, and parsing accuracy." },
      fields: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING, nullable: true },
          father_name: { type: SchemaType.STRING, nullable: true },
          mother_name: { type: SchemaType.STRING, nullable: true },
          dob: { type: SchemaType.STRING, nullable: true },
          gender: { type: SchemaType.STRING, nullable: true },
          caste: { type: SchemaType.STRING, nullable: true },
          nationality: { type: SchemaType.STRING, nullable: true },
          religion: { type: SchemaType.STRING, nullable: true },
          blood_group: { type: SchemaType.STRING, nullable: true },
          marital_status: { type: SchemaType.STRING, nullable: true },
          allergies: { type: SchemaType.STRING, nullable: true },
          phone: { type: SchemaType.STRING, nullable: true },
          alt_phone: { type: SchemaType.STRING, nullable: true },
          emergency_contact_name: { type: SchemaType.STRING, nullable: true },
          email: { type: SchemaType.STRING, nullable: true },
          address: { type: SchemaType.STRING, nullable: true },
          city: { type: SchemaType.STRING, nullable: true },
          state: { type: SchemaType.STRING, nullable: true },
          pincode: { type: SchemaType.STRING, nullable: true },
          roll_10: { type: SchemaType.STRING, nullable: true },
          board_10: { type: SchemaType.STRING, nullable: true },
          marks_10: { type: SchemaType.STRING, nullable: true },
          roll_12: { type: SchemaType.STRING, nullable: true },
          board_12: { type: SchemaType.STRING, nullable: true },
          marks_12: { type: SchemaType.STRING, nullable: true },
          college: { type: SchemaType.STRING, nullable: true },
          degree: { type: SchemaType.STRING, nullable: true },
          grad_year: { type: SchemaType.STRING, nullable: true },
          aadhaar: { type: SchemaType.STRING, nullable: true },
          pan: { type: SchemaType.STRING, nullable: true },
          dl: { type: SchemaType.STRING, nullable: true },
          bank_name: { type: SchemaType.STRING, nullable: true },
          account_no: { type: SchemaType.STRING, nullable: true },
          ifsc: { type: SchemaType.STRING, nullable: true },
          insurance_policy: { type: SchemaType.STRING, nullable: true }
        }
      }
    },
    required: ["docType", "confidence", "fields"]
  };

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const responseText = result.response.text();
  const data = JSON.parse(responseText);

  // Fallback to input docType if the model failed to guess
  if (!data.docType || data.docType === "unknown" || data.docType === "other") {
    data.docType = documentTypeInput || data.docType || "other";
  }
  
  // Clean empty fields
  const cleanFields = {};
  if (data.fields) {
    for (const [key, value] of Object.entries(data.fields)) {
      if (value !== null && value !== "") {
        cleanFields[key] = value;
      }
    }
  }

  return {
    docType: data.docType,
    fields: cleanFields,
    confidence: data.confidence || 85.0, // Dynamic confidence from Gemini model
    text: "(Extracted efficiently via Gemini Multimodal API)"
  };
}

module.exports = { extractWithGemini };
