// =============================================================
// chrome-extension/background.js (MV3 Service Worker)
//
// Bridges communication between popup.js, the FormSarthi tab,
// and target form pages. Complete local-first, zero DB calls!
// Supports multiple localhost ports (3000, 4000).
// =============================================================

async function getDecryptedSession() {
  // Query all localhost and 127.0.0.1 tabs (ports are not supported in query patterns in MV3)
  const tabs = await chrome.tabs.query({ 
    url: [
      "*://localhost/*",
      "*://127.0.0.1/*"
    ] 
  });
  
  // Filter for ports 3000 and 4000
  const validTabs = tabs.filter(tab => {
    try {
      const parsedUrl = new URL(tab.url);
      return parsedUrl.port === "3000" || parsedUrl.port === "4000";
    } catch (e) {
      return false;
    }
  });

  if (validTabs.length === 0) {
    throw new Error("Please open FormSarthi Dashboard (http://localhost:4000) and unlock your vault first.");
  }
  
  for (const tab of validTabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_DECRYPTED_SESSION" });
      if (response && response.success) {
        return response.profile;
      }
    } catch (e) {
      // Content script not loaded/ready on this tab
    }
  }
  
  throw new Error("FormSarthi vault is locked. Please unlock it on the dashboard first.");
}

async function getDashboardTab() {
  const tabs = await chrome.tabs.query({ 
    url: [
      "*://localhost/*",
      "*://127.0.0.1/*"
    ] 
  });
  
  const validTabs = tabs.filter(tab => {
    try {
      const parsedUrl = new URL(tab.url);
      return parsedUrl.port === "3000" || parsedUrl.port === "4000";
    } catch (e) {
      return false;
    }
  });

  if (validTabs.length === 0) {
    throw new Error("FormSarthi dashboard tab not found.");
  }
  return validTabs[0];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case "GET_PROFILE": {
      try {
        const profile = await getDecryptedSession();
        // Calculate completeness based on all 30 fields
        const allFields = [
          "name", "father_name", "mother_name", "dob", "gender", "caste", "nationality", "religion", "blood_group", "marital_status", "allergies",
          "phone", "alt_phone", "emergency_contact_name", "email", "address", "city", "state", "pincode",
          "roll_10", "roll_12", "board_10", "board_12", "marks_10", "marks_12", "college", "degree", "grad_year",
          "aadhaar", "pan", "dl", "bank_name", "account_no", "ifsc", "insurance_policy"
        ];
        let filledCount = allFields.filter(f => profile[f]).length;
        let totalCount = allFields.length;
        if (profile.customFields && profile.customFields.length > 0) {
          profile.customFields.forEach(custom => {
            totalCount++;
            if (profile[custom.key]) {
              filledCount++;
            }
          });
        }
        const percent = Math.round((filledCount / totalCount) * 100);
        return { 
          success: true, 
          profile, 
          status: { percent } 
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case "FILL_FORM": {
      try {
        const profile = await getDecryptedSession();
        let tabId = message.tabId;
        if (!tabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          tabId = activeTab ? activeTab.id : null;
        }
        if (!tabId) throw new Error("No active tab found.");
        
        let filledCount = 0;
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: "FILL_PAGE", profile });
          if (response && response.success) {
            filledCount = response.count;
          } else {
            throw new Error("Content script response failed");
          }
        } catch (msgErr) {
          // Fallback to executeScript directly in the target page context
          const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fillFormPageDirect,
            args: [profile]
          });
          filledCount = results && results[0] ? results[0].result : 0;
        }
        return { success: true, fielledCount: filledCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case "CHECK_DRAFT_RESTORE": {
      try {
        const dashboardTab = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashboardTab.id, { 
          type: "GET_DRAFT_VALUES", 
          url: message.url 
        });
        return response;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case "AUTO_SAVE_DRAFT": {
      try {
        const dashboardTab = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashboardTab.id, {
          type: "SAVE_DRAFT_DATA",
          draft: message.draft
        });
        return response;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case "GET_FILE_DATA": {
      try {
        const dashboardTab = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashboardTab.id, {
          type: "GET_DASHBOARD_FILE",
          docKey: message.docKey
        });
        return response;
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case "OPEN_DASHBOARD": {
      try {
        const dashboardTab = await getDashboardTab();
        await chrome.tabs.update(dashboardTab.id, { active: true });
        await chrome.windows.update(dashboardTab.windowId, { focused: true });
      } catch (err) {
        chrome.tabs.create({ url: "http://localhost:4000/" });
      }
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

function fillFormPageDirect(profile) {
  if (!profile) return 0;

  // 1. Define internal helpers
  function getLabelText(el) {
    if (!el) return "";
    let text = "";
    text += (el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-label") || "") + " ";
    const ariaLabelledby = el.getAttribute("aria-labelledby");
    if (ariaLabelledby) {
      ariaLabelledby.split(/\s+/).forEach(id => {
        const target = document.getElementById(id);
        if (target && target.textContent) {
          text += " " + target.textContent;
        }
      });
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label && label.textContent) text += " " + label.textContent;
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) text += " " + parentLabel.textContent;

    let parent = el.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      if (parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
      const siblingInputs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select');
      if (siblingInputs.length > 1) break;
      if (parent.textContent) {
        text += " " + parent.textContent;
      }
      parent = parent.parentElement;
    }
    return text.trim();
  }

  function matchFieldToProfile(labelText, profile) {
    const t = labelText.toLowerCase().trim()
      .replace(/[*:]/g, '')  // asterisk aur colon hatao
      .trim();

    // ── RELATIONSHIP FIELDS — PEHLE CHECK KARO ──
    if (t.includes("father")) return profile.father_name || '';
    if (t.includes("mother")) return profile.mother_name || '';
    if (t.includes("guardian") || t.includes("parent/guardian")) return profile.guardian_name || profile.father_name || '';
    if (t.includes("husband")) return profile.husband_name || '';

    // ── DOB ──
    if (t.includes("date of birth") || t === "dob" || t.includes("d.o.b") || t.includes("birth date") || t.includes("जन्म तिथि")) return profile.dob || '';

    // ── GENDER ──
    if (t === "gender" || t === "sex" || t.includes("gender of")) return profile.gender || '';

    // ── CASTE / CATEGORY ──
    if (t.includes("caste") || t.includes("category") || t.includes("social category") || t.includes("जाति")) return profile.caste || '';

    // ── MARITAL STATUS ──
    if (t.includes("marital") || t.includes("marriage") || t.includes("married")) return profile.marital_status || '';

    // ── ALLERGIES ──
    if (t.includes("allergy") || t.includes("allergies") || t.includes("medical condition") || t.includes("medical history")) return profile.allergies || '';

    // ── CANDIDATE NAME — ONLY after ruling out all above ──
    if (t === "name" || t === "full name" || t.includes("student name") ||
        t.includes("candidate name") || t.includes("applicant name") ||
        t.includes("your name") || t.includes("name of student") ||
        t.includes("name of applicant") || t.includes("नाम")) return profile.name || '';

    // ── CONTACT ──
    if (t.includes("emergency contact name") || t.includes("emergency name") || t.includes("contact person") || t.includes("emergency_contact_name")) return profile.emergency_contact_name || '';
    if (t.includes("alternate") && (t.includes("mobile") || t.includes("phone") || t.includes("contact"))) return profile.alt_phone || '';
    if (t.includes("mobile") || t.includes("phone") || t.includes("contact no") || t.includes("cell")) return profile.phone || '';
    if (t.includes("whatsapp")) return profile.phone || '';
    if (t.includes("email") || t.includes("e-mail") || t.includes("ईमेल")) return profile.email || '';

    // ── ADDRESS ──
    if (t.includes("pincode") || t.includes("pin code") || t.includes("postal code") || t.includes("zip")) return profile.pincode || '';
    if (t.includes("district") || (t.includes("city") && !t.includes("address"))) return profile.city || '';
    if (t === "state" || t.includes("state/ut") || t.includes("राज्य")) return profile.state || '';
    if (t.includes("address") || t.includes("पता") || t.includes("residence")) return profile.address || '';
    if (t.includes("country")) return profile.country || 'India';

    // ── 10TH MARKS ──
    if (t.includes("10th") || t.includes("class x") || t.includes("ssc") || t.includes("matriculation") || t.includes("class 10")) {
      if (t.includes("roll")) return profile.roll_10 || '';
      if (t.includes("board")) return profile.board_10 || '';
      if (t.includes("school")) return profile.school || '';
      if (t.includes("year") || t.includes("passing")) return profile.year_10 || '';
      if (t.includes("max") || t.includes("total mark")) return profile.max_marks_10 || '';
      if (t.includes("mark") || t.includes("percent") || t.includes("score") || t.includes("%")) return profile.percentage_10 || profile.marks_10 || '';
      return profile.marks_10 || '';
    }

    // ── 12TH MARKS ──
    if (t.includes("12th") || t.includes("class xii") || t.includes("hsc") || t.includes("intermediate") || t.includes("class 12")) {
      if (t.includes("roll")) return profile.roll_12 || '';
      if (t.includes("board")) return profile.board_12 || '';
      if (t.includes("college") || t.includes("school")) return profile.college || '';
      if (t.includes("year") || t.includes("passing")) return profile.year_12 || '';
      if (t.includes("stream") || t.includes("subject")) return profile.stream || '';
      if (t.includes("mark") || t.includes("percent") || t.includes("score") || t.includes("%")) return profile.percentage_12 || profile.marks_12 || '';
      return profile.marks_12 || '';
    }

    // ── COLLEGE / SCHOOL NAME ──
    if (t.includes("college name") || t.includes("name of college") || t.includes("institution")) return profile.college || '';
    if (t.includes("school name") || t.includes("name of school")) return profile.school || '';
    if (t.includes("university")) return profile.university || profile.college || '';

    // ── DEGREE / COURSE / GRADUATION YEAR ──
    if (t.includes("graduation year") || t.includes("passing year") || t.includes("year of passing") || t.includes("grad_year") || t.includes("grad year") || (t.includes("year") && t.includes("degree"))) return profile.grad_year || '';
    if (t.includes("degree") || t.includes("course") || t.includes("program")) return profile.degree || '';
    if (t.includes("stream") || t.includes("branch") || t.includes("specialization")) return profile.stream || '';
    if (t.includes("semester") || t.includes("year of study")) return profile.semester || '';

    // ── IDENTITY ──
    if (t.includes("aadhaar") || t.includes("aadhar") || t.includes("uid")) return profile.aadhaar || '';
    if (t.includes("pan card") || t.includes("pan no") || t.includes("permanent account")) return profile.pan || '';
    if (t.includes("voter") || t.includes("epic")) return profile.voter_id || '';

    // ── BANK ──
    if (t.includes("ifsc")) return profile.ifsc || '';
    if (t.includes("account number") || t.includes("account no") || t.includes("a/c")) return profile.account_no || '';
    if (t.includes("bank name") || t.includes("name of bank")) return profile.bank_name || '';

    // ── INSURANCE ──
    if (t.includes("insurance") || t.includes("policy no") || t.includes("policy number")) return profile.insurance_policy || '';

    // ── OTHER ──
    if (t.includes("nationality")) return profile.nationality || 'Indian';
    if (t.includes("religion")) return profile.religion || '';
    if (t.includes("blood group") || t.includes("blood type")) return profile.blood_group || '';
    if (t.includes("income") || t.includes("annual income")) return profile.income || '';
    if (t.includes("domicile") || t.includes("bonafide")) return profile.domicile_state || profile.state || '';

    return null;
  }

  function fillSelectAndRadio(profile) {
    let subFilled = 0;

    // Dropdowns (select elements)
    document.querySelectorAll('select').forEach(select => {
      const label = getLabelText(select);
      const value = matchFieldToProfile(label, profile);
      if (!value) return;

      // Option dhundho jo match kare
      Array.from(select.options).forEach(option => {
        if (option.text.toLowerCase().includes(value.toLowerCase()) ||
            value.toLowerCase().includes(option.text.toLowerCase())) {
          if (select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            subFilled++;
          }
        }
      });
    });

    // Radio buttons
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      const label = getLabelText(radio) || radio.value;
      const fieldLabel = getLabelText(radio.closest('fieldset') || radio.closest('[role="group"]') || radio.parentElement.parentElement);
      const profileValue = matchFieldToProfile(fieldLabel, profile);

      if (profileValue && (
        radio.value.toLowerCase() === profileValue.toLowerCase() ||
        label.toLowerCase() === profileValue.toLowerCase() ||
        radio.value.toLowerCase().includes(profileValue.toLowerCase())
      )) {
        if (!radio.checked) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          subFilled++;
        }
      }
    });

    // Google Forms specific radio (span buttons)
    document.querySelectorAll('[role="radio"]').forEach(radioBtn => {
      const radioText = radioBtn.getAttribute('data-value') || radioBtn.innerText?.trim();
      const questionDiv = radioBtn.closest('[role="listitem"]');
      if (!questionDiv) return;

      const heading = questionDiv.querySelector('[role="heading"]');
      if (!heading) return;

      const fieldLabel = heading.innerText.trim();
      const profileValue = matchFieldToProfile(fieldLabel, profile);

      if (profileValue && radioText &&
          radioText.toLowerCase().includes(profileValue.toLowerCase())) {
        if (radioBtn.getAttribute('aria-checked') !== 'true') {
          radioBtn.click();
          subFilled++;
        }
      }
    });

    return subFilled;
  }

  function formatDateForInput(dateStr) {
    if (!dateStr) return "";
    let cleanStr = dateStr.trim().replace(/[\s\.\-]+/g, '/');
    let parts = cleanStr.split('/');
    if (parts.length === 3) {
      let p0 = parseInt(parts[0], 10);
      let p1 = parseInt(parts[1], 10);
      let p2 = parseInt(parts[2], 10);
      if (p0 > 1000) {
        return `${p0}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      }
      if (p1 <= 12 && p0 <= 31) {
        let y = p2 < 100 ? (p2 > 50 ? 1900 : 2000) + p2 : p2;
        return `${y}-${String(p1).padStart(2, '0')}-${String(p0).padStart(2, '0')}`;
      }
    }
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    } catch (e) {}
    return dateStr;
  }

  // 2. Perform Form Filling
  let filled = 0;
  const textInputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea');
  
  textInputs.forEach(input => {
    const typeStr = (input.type || '').toLowerCase();
    const nameStr = (input.name || '').toLowerCase();
    const idStr = (input.id || '').toLowerCase();
    const placeholderStr = (input.placeholder || '').toLowerCase();
    if (typeStr === 'search' || /search|query|^q$/i.test(nameStr || idStr || placeholderStr || '')) {
      return;
    }

    const labelText = getLabelText(input);
    let value = matchFieldToProfile(labelText, profile);

    if (!value && profile.customFields && profile.customFields.length > 0) {
      const combinedHint = labelText.toLowerCase().replace(/\s+/g, ' ');
      for (const custom of profile.customFields) {
        const label = custom.label.toLowerCase();
        const key = custom.key.toLowerCase();
        if (combinedHint.includes(label) || combinedHint.includes(key)) {
          value = profile[custom.key];
          if (value) break;
        }
      }
    }

    // Google Forms date-input fallback
    if (!value && input.type === 'date' && profile.dob) {
      const questionCard = input.closest('[role="listitem"], [data-params], .Qr7Oae, .freebirdFormviewItemStandardcontainer, .geS5n, fieldset');
      let foundDobText = false;
      if (questionCard) {
        const txt = (questionCard.textContent || '').toLowerCase();
        if (/\b(dob|birth|born|जन्म)\b/i.test(txt)) {
          foundDobText = true;
        }
      }
      if (!foundDobText) {
        let ancestor = input.parentElement;
        for (let d = 0; ancestor && d < 8; d++) {
          if (ancestor.tagName === 'FORM' || ancestor.tagName === 'BODY') break;
          const txt = (ancestor.textContent || '').toLowerCase();
          if (txt.length < 300 && /\b(birth|dob|born|जन्म)\b/i.test(txt)) {
            foundDobText = true;
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }
      if (foundDobText) {
        value = profile.dob;
      }
    }

    if (value) {
      console.log(`[FormSarthi Match] Text Field: "${labelText.substring(0, 50)}" -> Value: ${value}`);
      let finalVal = value;
      if (input.type === 'date') {
        finalVal = formatDateForInput(value);
      }
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, finalVal);
      } else {
        input.value = finalVal;
      }
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('focus',  { bubbles: true }));
      input.dispatchEvent(new Event('blur',   { bubbles: true }));
      filled++;
    }
  });

  // 1b. Single-date-input fallback: if DOB wasn't filled and there's only one date field, fill it
  if (profile.dob) {
    const allDateInputs = document.querySelectorAll('input[type="date"]');
    const emptyDateInputs = Array.from(allDateInputs).filter(inp => !inp.value);
    if (allDateInputs.length === 1 && emptyDateInputs.length === 1) {
      const dateInput = emptyDateInputs[0];
      const formattedDate = formatDateForInput(profile.dob);
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(dateInput, formattedDate);
      } else {
        dateInput.value = formattedDate;
      }
      dateInput.dispatchEvent(new Event('input',  { bubbles: true }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      dateInput.dispatchEvent(new Event('focus',  { bubbles: true }));
      dateInput.dispatchEvent(new Event('blur',   { bubbles: true }));
      filled++;
      console.log(`[FormSarthi Match] Single-date fallback: dob -> ${formattedDate}`);
    }
  }

  filled += fillSelectAndRadio(profile);

  return filled;
}
