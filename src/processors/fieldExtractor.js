// =============================================================
// src/processors/fieldExtractor.js
// Takes raw OCR text and extracts structured fields using
// document-specific regex patterns.
// Supports 30 fields across multiple domains (JEE, NEET, Bank, Hospital).
// =============================================================

// ── Known junk words that OCR picks up from document labels ──
const NAME_JUNK_WORDS = [
  "DL", "PHOTO", "PHOTOGRAPH", "SIGNATURE", "SIGN", "THUMB",
  "IMPRESSION", "SPECIMEN", "HOLDER", "CARD", "FRONT", "BACK",
  "AADHAAR", "AADHAR", "PAN", "INCOME", "TAX", "DEPARTMENT",
  "GOVERNMENT", "INDIA", "UNION", "REPUBLIC", "DRIVING",
  "LICENSE", "LICENCE", "TRANSPORT", "AUTHORITY", "PASSPORT",
  "UIDAI", "UNIQUE", "IDENTIFICATION", "PERMANENT", "ACCOUNT",
  "NUMBER", "VALID", "VALIDITY", "ISSUE", "ISSUED", "DATE",
  "EXPIRY", "CLASS", "COV", "MCWG", "LMV", "HMV", "HGMV",
  "NON-TRANSPORT", "NONTRANSPORT", "NT", "TR", "BADGE",
  "BLOOD", "GROUP", "ADDRESS", "STATE", "COUNTRY", "DISTRICT",
  "TEHSIL", "PIN", "PINCODE", "MALE", "FEMALE", "DOB",
  "BIRTH", "FATHER", "MOTHER", "HUSBAND", "WIFE", "GUARDIAN",
  "S/O", "D/O", "W/O", "C/O", "SON", "DAUGHTER"
];
const NAME_JUNK_RE = new RegExp(
  '\\b(' + NAME_JUNK_WORDS.join('|') + ')\\b', 'gi'
);

/**
 * Sanitize an extracted name by removing document junk words,
 * non-name characters, and excessive whitespace.
 */
function sanitizeName(rawName) {
  if (!rawName) return null;
  let name = rawName
    .replace(NAME_JUNK_RE, '')      // strip junk words
    .replace(/[^A-Za-z\s.'\-]/g, '') // only letters, spaces, dots, apostrophes, hyphens
    .replace(/\s{2,}/g, ' ')         // collapse whitespace
    .trim();
  // If after cleaning, less than 3 meaningful chars remain, discard
  if (name.replace(/[\s.]/g, '').length < 3) return null;
  return name;
}

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
      /(?:DOB|Date of Birth|D\.O\.B|Birth Date|Year of Birth|YOB)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4})/i,
      /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,
      /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i,
      /\b(19\d{2}|20[0-2]\d)\b/ // Fallback to just year if YOB is present
    ]);
  },
  aadhaar(text) {
    const match = tryPatterns(text, [
      /(?:Aadhaar|VID|No\.)?[\s:]*\b(\d{4}[-\s]?\d{4}[-\s]?\d{4})\b/i
    ]);
    return match ? match.replace(/[-\s]/g, "") : null;
  },
  pan(text) {
    return tryPatterns(text, [
      /\b([A-Z]{3}[PCHABGJLFT][A-Z]\d{4}[A-Z])\b/i
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
  const dobLineIdx = lines.findIndex(l => /DOB|Date of Birth|Birth|YOB|Year of Birth/i.test(l));
  if (dobLineIdx > 0) {
    for (let i = dobLineIdx - 1; i >= 0; i--) {
      const l = lines[i];
      if (!/[\u0900-\u097F]/.test(l) && /^[A-Za-z\s.]{3,}$/.test(l) && !/Government|India|Aadhaar/i.test(l)) {
        name = sanitizeName(l);
        break;
      }
    }
  }

  const dob = genericExtractors.dob(t);
  const gender = genericExtractors.gender(t);
  let address = null;
  let state = null;
  let city = null;
  const addrMatch = t.match(/(?:Address|S\/O|W\/O|D\/O)[:\s]+([\s\S]{10,200}?)(?=\d{4}\s\d{4}|\n\n|$)/i);
  if (addrMatch) {
    // Clean up Devanagari (Hindi) characters and standardize formatting
    address = addrMatch[1]
      .replace(/[\u0900-\u097F]+/g, "")
      .replace(/[^\w\s\-,./]/gi, "")
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .trim();
    if (address.startsWith("/ ")) address = address.substring(2);
    if (address.startsWith(",")) address = address.substring(1).trim();
    
    // Extract state
    const states = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar", "Chandigarh", "Dadra and Nagar Haveli", "Daman and Diu", "Delhi", "Lakshadweep", "Puducherry"];
    for (const s of states) {
      if (address.toUpperCase().includes(s.toUpperCase())) {
        state = s;
        break;
      }
    }
  }
  const pincode = address ? genericExtractors.pincode(address) : genericExtractors.pincode(t);
  const aadhaar = genericExtractors.aadhaar(t);
  const phone = genericExtractors.phone(t);

  return { name, dob, gender, address, city, state, pincode, aadhaar, phone, nationality: "Indian" };
}

// 2. PAN Card
function parsePAN(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  let name = null;
  const itdIdx = lines.findIndex(l => /income|tax|permanent/i.test(l));
  if (itdIdx >= 0) {
    for (let i = itdIdx + 1; i < Math.min(itdIdx + 5, lines.length); i++) {
      if (/^[A-Z\s.]{4,}$/.test(lines[i]) && !/DEPARTMENT|GOVERNMENT|INDIA/i.test(lines[i])) {
        name = sanitizeName(lines[i]);
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
    if (match) name = sanitizeName(match[1]);
    else if (nameIdx + 1 < lines.length) name = sanitizeName(lines[nameIdx + 1]);
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
function parseMarksheet(t, forceType = null) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── Roll Number extraction (comprehensive Indian marksheet patterns) ──
  const rollNo = tryPatterns(t, [
    // Exact label matches (most reliable)
    /(?:roll\s*no\.?|roll\s*number|roll\s*#)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:regd\.?\s*no\.?|registration\s*no\.?|registration\s*number)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:reg\.?\s*no\.?|regn\.?\s*no\.?)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:exam\s*roll\s*no\.?|examination\s*roll)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:seat\s*no\.?|seat\s*number)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:enrolment\s*no\.?|enrollment\s*no\.?|enrol\s*no\.?)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:candidate\s*no\.?|cand\.?\s*no\.?)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:admit\s*card\s*no\.?|hall\s*ticket\s*no\.?)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    /(?:index\s*no\.?|index\s*number)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    // Common OCR misreads: "Roli No", "Roi! No", "Rot! No" etc.
    /(?:ro[li!1|][\s]*no\.?)[:\s]*([A-Z0-9 .\/-]{4,20})/i,
    // Format-based fallbacks (CBSE style: 8-digit, state boards: 6-10 digit)
    /\b(\d{5,10})\b/,
    // Alphanumeric roll (e.g., "AB/2024/12345")
    /\b([A-Z]{1,4}[\/-]\d{4}[\/-]\d{3,7})\b/i,
    // Alphanumeric roll (e.g., "21A12345")
    /\b(\d{2}[A-Z]\d{5,7})\b/i,
  ]);
  
  let board = "State Board";
  const tUp = t.toUpperCase();
  if (tUp.includes("CENTRAL BOARD OF SECONDARY") || tUp.includes("CBSE")) board = "CBSE";
  else if (tUp.includes("COUNCIL FOR THE INDIAN SCHOOL") || tUp.includes("ICSE") || tUp.includes("ISC")) board = "CISCE";
  else if (tUp.includes("UP BOARD") || tUp.includes("UTTAR PRADESH")) board = "UP Board";
  else if (tUp.includes("BIHAR BOARD") || tUp.includes("BSEB")) board = "Bihar Board";
  else if (tUp.includes("MAHARASHTRA") || tUp.includes("MSBSHSE")) board = "Maharashtra Board";
  else if (tUp.includes("WEST BENGAL") || tUp.includes("WBBSE") || tUp.includes("WBCHSE")) board = "West Bengal Board";
  else if (tUp.includes("RAJASTHAN") || tUp.includes("RBSE")) board = "Rajasthan Board";
  else if (tUp.includes("MADHYA PRADESH") || tUp.includes("MPBSE")) board = "MP Board";
  else if (tUp.includes("TAMIL NADU") || tUp.includes("TNBSE")) board = "Tamil Nadu Board";
  else if (tUp.includes("KARNATAKA") || tUp.includes("KSEEB")) board = "Karnataka Board";

  let is12th = false;
  if (forceType === 'marksheet_12') {
    is12th = true;
  } else if (forceType === 'marksheet_10') {
    is12th = false;
  } else {
    is12th = tUp.includes("SENIOR") || tUp.includes("HIGHER SECONDARY") || tUp.includes("XII") 
      || tUp.includes("10+2") || tUp.includes("CLASS 12") || tUp.includes("CLASS XII") || tUp.includes("XLL") || tUp.includes("X11")
      || tUp.includes("HSC") || tUp.includes("INTERMEDIATE") || tUp.includes("PLUS TWO");
  }

  const marks = tryPatterns(t, [
    /(?:cgpa|percentage|gpa|percent)[:\s]+([\d\.]{2,5}%?)/i,
    /(?:marks obtained|total marks|aggregate)[:\s]+(\d{3}\/\d{3})/i,
    /(?:total|grand total|aggregate marks)[:\s]+(\d{2,4})/i,
    /\b(\d{2}\.\d{1,2}%)\b/,
    /\b(\d{1}\.\d{1,2})\b/
  ]);

  const year = tryPatterns(t, [
    /(?:year|session|passing year|year of passing|exam year)[:\s]+(20\d{2})\b/i,
    /\b(20\d{2})\b/
  ]);

  let name = null;
  const nameIdx = lines.findIndex(l => /name of (?:the )?candidate|candidate(?:'s)? name|student(?:'s)? name|name of student/i.test(l));
  if (nameIdx >= 0) {
    const match = lines[nameIdx].match(/(?:name)[:\s]+([A-Za-z\s.]{4,40})/i);
    if (match) name = sanitizeName(match[1]);
    // If name is on the next line
    else if (nameIdx + 1 < lines.length && /^[A-Za-z\s.]{4,40}$/.test(lines[nameIdx + 1])) {
      name = sanitizeName(lines[nameIdx + 1]);
    }
  }

  // Also try father's name / mother's name for context
  const fatherName = tryPatterns(t, [
    /(?:father(?:'s)?\s*name|s\/o|son of|daughter of)[:\s]+([A-Za-z\s.]{4,40})/i,
  ]);

  // Extract DOB
  const dob = genericExtractors.dob(t);

  // Extract School/College
  let college = null;
  const schoolMatch = t.match(/(?:School|Vidyalaya|Institution|College|Institute)[:\s]+([A-Za-z0-9\s.,]{4,60})/i);
  if (schoolMatch) {
    college = schoolMatch[1].trim();
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
  if (year) result.grad_year = year;
  if (dob) result.dob = dob;
  if (college) result.college = college;
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

  let name = null;
  const givenNameMatch = t.match(/(?:Given Names|Given Name|Name)[:\s]+([A-Za-z\s.]{3,30})/i);
  const surnameMatch = t.match(/(?:Surname|Last Name)[:\s]+([A-Za-z\s.]{3,30})/i);
  if (givenNameMatch) {
    name = givenNameMatch[1].trim();
    if (surnameMatch) {
      name = name + ' ' + surnameMatch[1].trim();
    }
  }

  return { name, dl: passportNo, dob: genericExtractors.dob(t), nationality }; // we map passport to DL or store it locally
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

  let address = null;
  const addrMatch = t.match(/(?:Address)[:\s]+([\s\S]{10,200}?)(?=\n\n|\n[A-Z]{3,}|$)/i);
  if (addrMatch) {
    address = addrMatch[1].replace(/\n/g, ", ").trim();
  }

  return { account_no: accountNo, ifsc, bank_name: bankName, address };
}

// 7. Resume
function parseResume(t) {
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  let name = lines.length > 0 ? lines[0] : null; // Usually first line is name

  // If first line has email or phone, it's not the name, keep looking
  if (name && (name.includes("@") || /\d{10}/.test(name))) {
    name = lines.find(l => !l.includes("@") && !/\d{10}/.test(l) && /^[A-Za-z\s.]{3,30}$/.test(l));
  }
  name = sanitizeName(name);

  const phone = genericExtractors.phone(t);
  const email = genericExtractors.email(t);
  const dob = genericExtractors.dob(t);
  const address = tryPatterns(t, [
    /(?:address|location)[:\s]+([^\n]{10,100})/i
  ]);
  const pincode = address ? genericExtractors.pincode(address) : genericExtractors.pincode(t);
  let college = tryPatterns(t, [
    /(?:University|College|Institute)[:\s]+([A-Za-z\s.]{5,50})/i
  ]);
  
  if (!college) {
    // Try to find any line with University or College
    const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
    const colLine = lines.find(l => /University|College|Institute|Academy/i.test(l));
    if (colLine) college = colLine;
  }
  return { name, email, phone, dob, address, pincode, college };
}

const PINCODE_MAP = {
  // Metro Cities
  "mumbai": "400001", "delhi": "110001", "new delhi": "110001", "bangalore": "560001", "bengaluru": "560001",
  "chennai": "600001", "kolkata": "700001", "hyderabad": "500001", "pune": "411001", "ahmedabad": "380001",
  
  // Madhya Pradesh
  "jabalpur": "482001", "indore": "452001", "bhopal": "462001", "gwalior": "474001", "ujjain": "456001",

  // Uttar Pradesh
  "lucknow": "226001", "kanpur": "208001", "agra": "282001", "varanasi": "221001", "allahabad": "211001",
  "prayagraj": "211001", "meerut": "250001", "bareilly": "243001", "aligarh": "202001", "moradabad": "244001",
  "saharanpur": "247001", "gorakhpur": "273001", "jhansi": "284001", "noida": "201301", "ghaziabad": "201001",

  // Rajasthan
  "jaipur": "302001", "jodhpur": "342001", "udaipur": "313001", "kota": "324001", "ajmer": "305001", "bikaner": "334001",

  // Gujarat
  "surat": "395001", "vadodara": "390001", "rajkot": "360001", "bhavnagar": "364001", "jamnagar": "361001",

  // Maharashtra
  "nashik": "422001", "aurangabad": "431001", "solapur": "413001", "thane": "400601", "navi mumbai": "400703", "nagpur": "440001",

  // Punjab & Haryana
  "chandigarh": "160001", "ludhiana": "141001", "amritsar": "143001", "jalandhar": "144001", "patiala": "147001",
  "faridabad": "121001", "gurgaon": "122001", "gurugram": "122001", "panipat": "132103", "ambala": "133001", "rohtak": "124001",

  // Bihar & Jharkhand
  "patna": "800001", "ranchi": "834001", "jamshedpur": "831001", "dhanbad": "826001", "bokaro": "827001",

  // South India
  "kochi": "682001", "ernakulam": "682001", "thiruvananthapuram": "695001", "trivandrum": "695001", "kozhikode": "673001", "calicut": "673001",
  "thrissur": "680001", "madurai": "625001", "coimbatore": "641001", "tiruchirappalli": "620001", "trichy": "620001",
  "salem": "636001", "tirunelveli": "627001", "mysore": "570001", "mangalore": "575001", "hubli": "580020", "belgaum": "590001",
  "visakhapatnam": "530001", "vizag": "530001", "vijayawada": "520001", "guntur": "522001", "nellore": "524001", "tirupati": "517501",
  "warangal": "506001", "nizamabad": "503001", "karimnagar": "505001",

  // East & North East
  "bhubaneswar": "751001", "cuttack": "753001", "rourkela": "769001", "guwahati": "781001", "shillong": "793001",
  "imphal": "795001", "agartala": "799001", "kohima": "797001", "aizawl": "796001", "itanagar": "791111",

  // Central
  "raipur": "492001", "bhilai": "490006", "bilaspur": "495001",

  // North
  "dehradun": "248001", "haridwar": "249401", "roorkee": "247667", "shimla": "171001", "jammu": "180001", "srinagar": "190001"
};

function guessPincode(address, city, state) {
  const t = (address + " " + (city || "") + " " + (state || "")).toLowerCase();
  for (const [c, pin] of Object.entries(PINCODE_MAP)) {
    if (t.includes(c)) return pin;
  }
  return null;
}

function extractCityStatePinFromAddress(address) {
  let city = null;
  let state = null;
  let pincode = null;

  if (!address) return { city, state, pincode };

  // 1. Try to find pincode
  const pinMatch = address.match(/\b([1-9]\d{5})\b/);
  if (pinMatch) {
    pincode = pinMatch[1];
  }

  // 2. Try to find state
  const states = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar", "Chandigarh", "Dadra and Nagar Haveli", "Daman and Diu", "Delhi", "Lakshadweep", "Puducherry"];
  const stateCodes = {
    "MP": "Madhya Pradesh", "UP": "Uttar Pradesh", "MH": "Maharashtra", "DL": "Delhi",
    "KA": "Karnataka", "TN": "Tamil Nadu", "AP": "Andhra Pradesh", "GJ": "Gujarat",
    "RJ": "Rajasthan", "HR": "Haryana", "PB": "Punjab", "WB": "West Bengal",
    "JH": "Jharkhand", "BR": "Bihar", "CG": "Chhattisgarh", "KL": "Kerala",
    "OD": "Odisha", "TS": "Telangana", "UK": "Uttarakhand", "UA": "Uttarakhand",
    "AS": "Assam", "HP": "Himachal Pradesh"
  };

  const upperAddr = address.toUpperCase();
  for (const s of states) {
    if (upperAddr.includes(s.toUpperCase())) {
      state = s;
      break;
    }
  }

  if (!state) {
    for (const [code, name] of Object.entries(stateCodes)) {
      const regex = new RegExp(`\\b${code}\\b`, 'i');
      if (regex.test(address)) {
        state = name;
        break;
      }
    }
  }

  // 3. Try to extract city
  let cleanAddr = address;
  if (pincode) cleanAddr = cleanAddr.replace(pincode, "");
  if (state) {
    cleanAddr = cleanAddr.replace(new RegExp(state, "gi"), "");
  }
  for (const code of Object.keys(stateCodes)) {
    cleanAddr = cleanAddr.replace(new RegExp(`\\b${code}\\b`, "gi"), "");
  }

  // Split by comma and clean up
  const parts = cleanAddr.split(",").map(p => p.trim().replace(/[^\w\s]/g, "")).filter(Boolean);
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 2 && !/^\d+$/.test(lastPart)) {
      const words = lastPart.split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        city = words[words.length - 1];
        city = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
      }
    }
  }

  return { city, state, pincode };
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
    case "marksheet":
    case "marksheet_10":
    case "marksheet_12":  result = parseMarksheet(t, docType); break;
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

  // Global post-processing: Extract City, State, Pincode from Address if present
  if (parsedFields.address) {
    const geo = extractCityStatePinFromAddress(parsedFields.address);
    if (!parsedFields.city && geo.city) parsedFields.city = geo.city;
    if (!parsedFields.state && geo.state) parsedFields.state = geo.state;
    if (!parsedFields.pincode && geo.pincode) parsedFields.pincode = geo.pincode;
  }

  // Guess pincode if missing
  if (!parsedFields.pincode && (parsedFields.address || parsedFields.city || parsedFields.state)) {
    parsedFields.pincode = guessPincode(parsedFields.address || "", parsedFields.city, parsedFields.state);
  }

  return {
    docType,
    fields: parsedFields
  };
}

module.exports = { extractFields, classifyDocument };
