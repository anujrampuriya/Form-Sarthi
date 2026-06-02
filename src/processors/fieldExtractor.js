// =============================================================
// src/processors/fieldExtractor.js
// Takes raw OCR text and extracts structured fields using
// document-specific regex patterns.
// Supports 30 fields across multiple domains (JEE, NEET, Bank, Hospital).
// =============================================================

function cleanText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[""]/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

function tryPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return (match[1] || match[0]).trim();
    }
  }
  return null;
}

// ── Generic extractors (fallback) ────────────────────────────
const genericExtractors = {
  email(text) {
    return tryPatterns(text, [
      /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/,
    ]);
  },
  phone(text) {
    return tryPatterns(text, [
      /(?:\+91[-\s]?|0)?([6-9]\d{9})\b/,
      /(?:Mobile|Phone|Ph|Mob|Contact)[:\s]+([6-9]\d{9})/i,
    ]);
  },
  dob(text) {
    return tryPatterns(text, [
      /(?:DOB|Date of Birth|D\.O\.B|Birth Date|Date of Birth)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
      /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i,
    ]);
  },
  aadhaar(text) {
    const match = tryPatterns(text, [
      /\b(\d{4}\s\d{4}\s\d{4})\b/,
      /\b(\d{4}-\d{4}-\d{4})\b/,
      /\b(\d{12})\b/
    ]);
    return match ? match.replace(/[-\s]/g, "") : null;
  },
  pan(text) {
    return tryPatterns(text, [
      /\b([A-Z]{5}\d{4}[A-Z])\b/i
    ]);
  },
  dl(text) {
    const match = tryPatterns(text, [
      /\b([A-Z]{2}[-\s]?\d{2}[-\s]?(?:19|20)\d{2}[-\s]?\d{7})\b/i
    ]);
    return match ? match.replace(/[-\s]/g, "").toUpperCase() : null;
  },
  pincode(text) {
    return tryPatterns(text, [
      /(?:pincode|pin|postal code|zip)[:\s]*([1-9]\d{5})\b/i,
      /\b([1-9]\d{5})\b/
    ]);
  },
  gender(text) {
    const t = text.toUpperCase();
    if (t.includes("FEMALE")) return "Female";
    if (t.includes("MALE")) return "Male";
    if (t.includes("TRANSGENDER")) return "Transgender";
    return null;
  },
  caste(text) {
    const t = text.toUpperCase();
    if (t.includes("OBC") || t.includes("OTHER BACKWARD")) return "OBC";
    if (t.includes("SC") || t.includes("SCHEDULED CASTE")) return "SC";
    if (t.includes("ST") || t.includes("SCHEDULED TRIBE")) return "ST";
    if (t.includes("EWS") || t.includes("ECONOMICALLY WEAKER")) return "EWS";
    if (t.includes("GENERAL") || t.includes("GEN") || t.includes("UR")) return "General";
    return null;
  },
  bloodGroup(text) {
    return tryPatterns(text, [
      /\b(A|B|AB|O)[\s]?[\+\-](?:ve|pos|neg)?\b/i
    ]);
  },
  ifsc(text) {
    return tryPatterns(text, [
      /\b([A-Z]{4}0[A-Z0-9]{6})\b/i
    ]);
  },
  accountNo(text) {
    return tryPatterns(text, [
      /(?:account no|a\/c no|ac number|account number|a\/c|acc)[:\s]*(\d{9,18})\b/i,
      /\b(\d{9,18})\b/
    ]);
  }
};

// ── Document Classification ─────────────────────────────────
function classifyDocument(text) {
  const t = text.toUpperCase();
  if (t.includes("UNIQUE IDENTIFICATION") || t.includes("UIDAI") || t.includes("GOVERNMENT OF INDIA") && (t.includes("AADHAAR") || t.includes("AADHAR"))) {
    return "aadhaar";
  }
  if (t.includes("INCOME TAX") || t.includes("TAX DEPARTMENT") || t.includes("PERMANENT ACCOUNT NUMBER") || t.includes("PAN CARD")) {
    return "pan";
  }
  if (t.includes("DRIVING LICENSE") || t.includes("DRIVING LICENCE") || t.includes("UNION OF INDIA DRIVING") || t.includes("LICENCE TO DRIVE") || t.includes("TRANSPORT DEPARTMENT")) {
    return "dl";
  }
  if (t.includes("PASSPORT") || t.includes("REPUBLIC OF INDIA") && t.includes("PASSPORT NO")) {
    return "passport";
  }
  if (t.includes("MARKSHEET") || t.includes("MARKS STATEMENT") || t.includes("ROLL NO") && (t.includes("BOARD") || t.includes("MARKS OBTAINED") || t.includes("CBSE") || t.includes("ICSE") || t.includes("SECONDARY"))) {
    return "marksheet";
  }
  if (t.includes("BANK PASSBOOK") || t.includes("ACCOUNT NUMBER") && (t.includes("IFSC") || t.includes("BRANCH") || t.includes("BANK NAME"))) {
    return "bank_passbook";
  }
  if (t.includes("RESUME") || t.includes("CURRICULUM VITAE") || t.includes("EXPERIENCE") || t.includes("EDUCATION") || t.includes("SKILLS") || t.includes("PROJECTS")) {
    return "resume";
  }
  if (t.includes("COLLEGE ID") || t.includes("STUDENT ID") || t.includes("IDENTITY CARD") || t.includes("STUDENT CARD") || t.includes("ROLL NO")) {
    return "college_id";
  }
  if (t.includes("CERTIFICATE") || t.includes("CERTIFY THAT") || t.includes("HAS COMPLETED")) {
    return "certificate";
  }

  // Fallbacks
  if (genericExtractors.aadhaar(text)) return "aadhaar";
  if (genericExtractors.pan(text)) return "pan";
  if (genericExtractors.dl(text)) return "dl";
  if (genericExtractors.ifsc(text) && genericExtractors.accountNo(text)) return "bank_passbook";

  return "other";
}

// ── Document Specific Parsers ─────────────────────────────────

// 1. Aadhaar Card
function parseAadhaar(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  let name = null;
  const dobLineIdx = lines.findIndex(l => /DOB|Date of Birth|Birth/i.test(l));
  if (dobLineIdx > 0) {
    for (let i = dobLineIdx - 1; i >= 0; i--) {
      const l = lines[i];
      if (!/[\u0900-\u097F]/.test(l) && /^[A-Za-z\s.]{4,}$/.test(l)) {
        name = l.trim();
        break;
      }
    }
  }

  const dob = genericExtractors.dob(t);
  const gender = genericExtractors.gender(t);
  let address = null;
  const addrMatch = t.match(/(?:Address|S\/O|W\/O|D\/O)[:\s]+([\s\S]{10,200}?)(?=\d{4}\s\d{4}|\n\n|$)/i);
  if (addrMatch) {
    address = addrMatch[1].replace(/\n/g, ", ").trim();
  }
  const pincode = address ? genericExtractors.pincode(address) : genericExtractors.pincode(t);
  const aadhaar = genericExtractors.aadhaar(t);
  const phone = genericExtractors.phone(t);

  return { name, dob, gender, address, pincode, aadhaar, phone, nationality: "Indian" };
}

// 2. PAN Card
function parsePAN(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  let name = null;
  const itdIdx = lines.findIndex(l => /income tax/i.test(l));
  if (itdIdx >= 0) {
    for (let i = itdIdx + 1; i < Math.min(itdIdx + 5, lines.length); i++) {
      if (/^[A-Z\s.]{4,}$/.test(lines[i]) && !/DEPARTMENT|GOVERNMENT|INDIA/i.test(lines[i])) {
        name = lines[i];
        break;
      }
    }
  }
  const dob = genericExtractors.dob(t);
  const pan = genericExtractors.pan(t);
  return { name, dob, pan, nationality: "Indian" };
}

// 3. Driving Licence (DL)
function parseDL(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  let name = null;
  const nameIdx = lines.findIndex(l => /\bName\b/i.test(l));
  if (nameIdx >= 0) {
    const match = lines[nameIdx].match(/(?:Name|NAME)[:\s]+([A-Za-z\s.]{4,50})/i);
    if (match) name = match[1].trim();
    else if (nameIdx + 1 < lines.length) name = lines[nameIdx + 1].trim();
  }
  const dob = genericExtractors.dob(t);
  const dl = genericExtractors.dl(t);
  let address = null;
  const addrMatch = t.match(/(?:Address|Add)[:\s]+([\s\S]{10,200}?)(?=\n\n|\n[A-Z]{3,}|$)/i);
  if (addrMatch) {
    address = addrMatch[1].replace(/\n/g, ", ").trim();
  }
  const pincode = address ? genericExtractors.pincode(address) : genericExtractors.pincode(t);
  const gender = genericExtractors.gender(t);
  return { name, dob, dl, address, pincode, gender };
}

// 4. Marksheet (Class 10/12)
function parseMarksheet(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  const rollNo = tryPatterns(t, [
    /(?:roll no|roll number|seat no|roll_no)[:\s]+([A-Z0-9\s.]{4,15})\b/i,
    /\b(\d{7,10})\b/
  ]);
  
  let board = "State Board";
  if (t.includes("CENTRAL BOARD OF SECONDARY") || t.includes("CBSE")) board = "CBSE";
  else if (t.includes("COUNCIL FOR THE INDIAN SCHOOL") || t.includes("ICSE") || t.includes("ISC")) board = "CISCE";

  const is12th = t.includes("SENIOR") || t.includes("HIGHER SECONDARY") || t.includes("XII") || t.includes("10+2");

  const marks = tryPatterns(t, [
    /(?:cgpa|percentage|gpa|percent)[:\s]+([\d\.]{2,5}%?)/i,
    /(?:marks obtained|total marks)[:\s]+(\d{3}\/\d{3})/i,
    /\b(\d{2}\.\d{1,2}%)\b/,
    /\b(\d{1}\.\d{1,2})\b/
  ]);

  const year = tryPatterns(t, [
    /(?:year|session|passing year)[:\s]+(20\d{2})\b/i,
    /\b(20\d{2})\b/
  ]);

  let name = null;
  const nameIdx = lines.findIndex(l => /name of candidate|candidate name|student's name/i.test(l));
  if (nameIdx >= 0) {
    const match = lines[nameIdx].match(/(?:name)[:\s]+([A-Za-z\s.]{4,40})/i);
    if (match) name = match[1].trim();
  }

  const result = {};
  if (is12th) {
    result.roll_12 = rollNo;
    result.board_12 = board;
    result.marks_12 = marks;
  } else {
    result.roll_10 = rollNo;
    result.board_10 = board;
    result.marks_10 = marks;
  }
  if (name) result.name = name;
  return result;
}

// 5. Passport
function parsePassport(t) {
  const passportNo = tryPatterns(t, [
    /\b([A-Z]\d{7})\b/i
  ]);
  const expiry = tryPatterns(t, [
    /(?:date of expiry|expiry date|valid upto)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/
  ]);
  const nationality = tryPatterns(t, [
    /nationality[:\s]+([A-Za-z]{3,20})/i,
    /\bINDIAN\b/i
  ]) || "Indian";

  return { dl: passportNo, dob: genericExtractors.dob(t), nationality }; // we map passport to DL or store it locally
}

// 6. Bank Passbook
function parseBank(t) {
  const accountNo = genericExtractors.accountNo(t);
  const ifsc = genericExtractors.ifsc(t);
  let bankName = tryPatterns(t, [
    /(?:state bank of india|sbi|hdfc|icici|punjab national bank|pnb|axis bank|canara bank)/i,
    /(?:bank of [A-Za-z]+)/i,
    /([A-Za-z]{3,20} Bank)/i
  ]);
  if (!bankName) {
    if (ifsc && ifsc.startsWith("SBIN")) bankName = "State Bank of India";
    else if (ifsc && ifsc.startsWith("HDFC")) bankName = "HDFC Bank";
    else if (ifsc && ifsc.startsWith("ICIC")) bankName = "ICICI Bank";
  }
  return { account_no: accountNo, ifsc, bank_name: bankName };
}

// 7. Resume
function parseResume(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let name = null;
  for (const line of lines.slice(0, 5)) {
    if (/^[A-Za-z\s.]{4,50}$/.test(line) && !/resume|curriculum|vitae|cv\b/i.test(line)) {
      name = line;
      break;
    }
  }
  const email = genericExtractors.email(t);
  const phone = genericExtractors.phone(t);
  const dob = genericExtractors.dob(t);
  const address = tryPatterns(t, [
    /(?:address|location)[:\s]+([^\n]{10,100})/i
  ]);
  const pincode = address ? genericExtractors.pincode(address) : genericExtractors.pincode(t);
  let college = tryPatterns(t, [
    /(?:university|institute|college|school)[^\n]{0,60}/i
  ]);
  return { name, email, phone, dob, address, pincode, college };
}

// ── Main Entry Point ──────────────────────────────────────────
function extractFields(rawText, docTypeInput = null) {
  const t = rawText || "";
  const docType = docTypeInput || classifyDocument(t);
  console.log(`🏷️ Auto-detected document type: ${docType}`);

  // Base 30-field blueprint
  const parsedFields = {
    name: null, dob: null, gender: null, caste: null, nationality: null, religion: null, blood_group: null, marital_status: null,
    phone: null, alt_phone: null, email: null, address: null, city: null, state: null, pincode: null,
    roll_10: null, roll_12: null, board_10: null, board_12: null, marks_10: null, marks_12: null, college: null, degree: null, grad_year: null,
    aadhaar: null, pan: null, dl: null, bank_name: null, account_no: null, ifsc: null
  };

  let result = {};
  switch (docType) {
    case "aadhaar":       result = parseAadhaar(t); break;
    case "pan":           result = parsePAN(t); break;
    case "dl":            result = parseDL(t); break;
    case "marksheet":     result = parseMarksheet(t); break;
    case "passport":      result = parsePassport(t); break;
    case "bank_passbook": result = parseBank(t); break;
    case "resume":        result = parseResume(t); break;
    default:
      result = {
        name: null,
        dob: genericExtractors.dob(t),
        phone: genericExtractors.phone(t),
        email: genericExtractors.email(t),
        aadhaar: genericExtractors.aadhaar(t),
        pan: genericExtractors.pan(t),
        dl: genericExtractors.dl(t),
        pincode: genericExtractors.pincode(t)
      };
  }

  // Merge into output structure
  for (const key of Object.keys(parsedFields)) {
    if (result[key] !== undefined && result[key] !== null) {
      parsedFields[key] = result[key];
    }
  }

  return {
    docType,
    fields: parsedFields
  };
}

module.exports = { extractFields, classifyDocument };
