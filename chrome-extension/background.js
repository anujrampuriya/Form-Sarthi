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
          "name", "dob", "gender", "caste", "nationality", "religion", "blood_group", "marital_status",
          "phone", "alt_phone", "email", "address", "city", "state", "pincode",
          "roll_10", "roll_12", "board_10", "board_12", "marks_10", "marks_12", "college", "degree", "grad_year",
          "aadhaar", "pan", "dl", "bank_name", "account_no", "ifsc"
        ];
        const filled = allFields.filter(f => profile[f]);
        const percent = Math.round((filled.length / allFields.length) * 100);
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
        
        // Execute fillFormPageDirect directly in the target page context
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: fillFormPageDirect,
          args: [profile]
        });
        
        const filledCount = results && results[0] ? results[0].result : 0;
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

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

function fillFormPageDirect(profile) {
  if (!profile) return 0;

  const fieldMap = [
    { key: 'name',          hints: ['name', 'fullname', 'full_name', 'applicant', 'candidate'] },
    { key: 'dob',           hints: ['dob', 'birth', 'dateofbirth', 'date_of_birth', 'born'] },
    { key: 'gender',        hints: ['gender', 'sex', 'gender_type'] },
    { key: 'caste',         hints: ['caste', 'category', 'social_status', 'community', 'reservation'] },
    { key: 'nationality',   hints: ['nationality', 'citizenship', 'citizen'] },
    { key: 'religion',      hints: ['religion', 'faith'] },
    { key: 'blood_group',   hints: ['blood', 'bloodgroup', 'blood_group', 'bg'] },
    { key: 'marital_status',hints: ['marital', 'marriage', 'married', 'marital_status'] },
    { key: 'phone',         hints: ['phone', 'mobile', 'contact', 'cell', 'number', 'telephone'] },
    { key: 'alt_phone',     hints: ['alt_phone', 'altphone', 'alternate', 'emergency_contact', 'alt_mobile'] },
    { key: 'email',         hints: ['email', 'mail', 'emailid', 'e-mail'] },
    { key: 'address',       hints: ['address', 'addr', 'residence', 'location', 'permanent_address', 'corr_address'] },
    { key: 'city',          hints: ['city', 'town', 'district'] },
    { key: 'state',         hints: ['state', 'province', 'region'] },
    { key: 'pincode',       hints: ['pincode', 'pin', 'zip', 'postal', 'zipcode'] },
    { key: 'roll_10',       hints: ['roll_10', 'roll10', 'class_10_roll', 'ssc_roll', 'roll_no_10', 'matric_roll'] },
    { key: 'board_10',      hints: ['board_10', 'board10', 'ssc_board', 'class_10_board', 'matric_board'] },
    { key: 'marks_10',      hints: ['marks_10', 'marks10', 'ssc_marks', 'class_10_marks', 'ssc_percent', 'matric_percent', 'percentage_10'] },
    { key: 'roll_12',       hints: ['roll_12', 'roll12', 'class_12_roll', 'hsc_roll', 'roll_no_12', 'inter_roll'] },
    { key: 'board_12',      hints: ['board_12', 'board12', 'hsc_board', 'class_12_board', 'inter_board'] },
    { key: 'marks_12',      hints: ['marks_12', 'marks12', 'hsc_marks', 'class_12_marks', 'hsc_percent', 'inter_percent', 'percentage_12'] },
    { key: 'college',       hints: ['college', 'institute', 'university', 'school', 'inst_name'] },
    { key: 'degree',        hints: ['degree', 'course', 'qualification', 'program', 'stream', 'graduation'] },
    { key: 'grad_year',     hints: ['grad_year', 'gradyear', 'year_of_passing', 'passing_year', 'grad_date'] },
    { key: 'aadhaar',       hints: ['aadhaar', 'aadhar', 'uid', 'uidai'] },
    { key: 'pan',           hints: ['pan', 'panno', 'pan_number', 'permanent_account'] },
    { key: 'dl',            hints: ['driving', 'licence', 'license', 'dl', 'passport', 'passport_no', 'passport_number'] },
    { key: 'bank_name',     hints: ['bank_name', 'bankname', 'bank_title', 'bankname'] },
    { key: 'account_no',    hints: ['account_no', 'accountno', 'account_number', 'acc_no', 'ac_no', 'ac_num', 'bank_account'] },
    { key: 'ifsc',          hints: ['ifsc', 'ifsccode', 'ifsc_code', 'bank_ifsc'] }
  ];

  let filled = 0;

  // 1. Process standard input, textarea, and select elements
  const textInputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea, select');
  
  textInputs.forEach(input => {
    // Collect direct attributes
    const hintAttr = (
      (input.name || '') + ' ' +
      (input.id || '') + ' ' +
      (input.placeholder || '') + ' ' +
      (input.getAttribute('aria-label') || '') + ' ' +
      (input.getAttribute('placeholder') || '')
    ).toLowerCase();

    let labelText = '';

    // A. Check aria-labelledby (Crucial for Google Forms)
    const ariaLabelledby = input.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      ariaLabelledby.split(/\s+/).forEach(id => {
        const el = document.getElementById(id);
        if (el && el.textContent) {
          labelText += ' ' + el.textContent;
        }
      });
    }

    // B. Check standard labels
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label && label.textContent) labelText += ' ' + label.textContent;
    }
    const parentLabel = input.closest('label');
    if (parentLabel && parentLabel.textContent) labelText += ' ' + parentLabel.textContent;

    // C. Parent Traversal with Bleeding Prevention
    let parent = input.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      if (parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
      
      // If parent element has other text/number fields, stop to avoid matching siblings
      const siblingInputs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea, select');
      if (siblingInputs.length > 1) break;

      if (parent.textContent) {
        labelText += ' ' + parent.textContent;
      }
      parent = parent.parentElement;
    }

    const combinedHint = (hintAttr + labelText).toLowerCase().replace(/\s+/g, ' ');
    console.log("[FormSarthi Debug] Text Element:", input, "Combined Hint:", combinedHint);

    for (const field of fieldMap) {
      const value = profile[field.key];
      if (!value) continue;

      const matched = field.hints.some(h => combinedHint.includes(h));
      if (matched) {
        console.log(`[FormSarthi Match] Text Field: ${field.key} -> Value: ${value}`);
        
        if (input.tagName === 'SELECT') {
          // Select option matching value
          const option = Array.from(input.options).find(opt => 
            opt.value.toLowerCase() === value.toLowerCase() || 
            opt.text.toLowerCase().includes(value.toLowerCase())
          );
          if (option) {
            input.value = option.value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }
        } else {
          // Standard text inputs
          input.value = value;
          input.dispatchEvent(new Event('input',  { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          // Focus and blur to trigger floating label transitions on Google Forms
          input.dispatchEvent(new Event('focus',  { bubbles: true }));
          input.dispatchEvent(new Event('blur',   { bubbles: true }));
          filled++;
        }
        break;
      }
    }
  });

  // 2. Process Radio Button Groups (Google Forms role="radio" and standard input[type=radio])
  const radioButtons = document.querySelectorAll('[role="radio"], input[type="radio"]');
  radioButtons.forEach(radio => {
    // Find the closest question block/card to match field hints
    const questionCard = radio.closest('[role="listitem"], .Qr7Oae, .form-group');
    if (!questionCard) return;

    let questionText = '';
    // Look for heading or title inside the card
    const headingEl = questionCard.querySelector('[role="heading"], .Ho3o3e, .z12as, .vR13fe, label');
    if (headingEl) {
      questionText = headingEl.textContent;
    } else {
      questionText = questionCard.textContent || '';
    }

    // Get the radio option label
    const optionText = (radio.getAttribute('aria-label') || radio.getAttribute('value') || radio.textContent || '').trim().toLowerCase();
    const cleanQuestion = questionText.toLowerCase().replace(/\s+/g, ' ');

    for (const field of fieldMap) {
      const value = profile[field.key];
      if (!value) continue;

      const matched = field.hints.some(h => cleanQuestion.includes(h));
      if (matched) {
        // Check if this option corresponds to the profile value (e.g. profile gender is "Male" and option is "male")
        if (optionText === value.toLowerCase() || optionText.includes(value.toLowerCase()) || value.toLowerCase().includes(optionText)) {
          console.log(`[FormSarthi Match] Radio Group matched: ${field.key} -> Option: ${optionText}`);
          if (radio.getAttribute('aria-checked') !== 'true' && !radio.checked) {
            radio.click();
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }
          break;
        }
      }
    }
  });

  return filled;
}
