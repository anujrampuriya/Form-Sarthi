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
    { 
      key: 'name',          
      hints: ['name', 'fullname', 'full_name', 'applicant', 'candidate'],
      exclude: ['father', 'mother', 'parent', 'guardian', 'nominee', 'college', 'school', 'institute', 'university', 'bank', 'branch', 'file', 'doc', 'caste', 'category', 'husband', 'wife', 'spouse', 'sign'] 
    },
    { 
      key: 'dob',           
      hints: ['dob', 'birth', 'dateofbirth', 'date_of_birth', 'born'],
      exclude: ['place', 'city', 'state', 'country'] 
    },
    { 
      key: 'gender',        
      hints: ['gender', 'sex', 'gender_type'],
      exclude: [] 
    },
    { 
      key: 'caste',         
      hints: ['caste', 'category', 'social_status', 'community', 'reservation'],
      exclude: ['subcaste', 'sub-caste'] 
    },
    { 
      key: 'nationality',   
      hints: ['nationality', 'citizenship', 'citizen'],
      exclude: [] 
    },
    { 
      key: 'religion',      
      hints: ['religion', 'faith'],
      exclude: [] 
    },
    { 
      key: 'blood_group',   
      hints: ['blood', 'bloodgroup', 'blood_group', 'bg'],
      exclude: [] 
    },
    { 
      key: 'marital_status',
      hints: ['marital', 'marriage', 'married', 'marital_status'],
      exclude: [] 
    },
    { 
      key: 'phone',         
      hints: ['phone', 'mobile', 'contact', 'cell', 'telephone'],
      exclude: ['email', 'fax', 'aadhaar', 'aadhar', 'pan', 'card', 'account', 'roll', 'license', 'pincode', 'pin', 'zip', 'pf', 'uan', 'alt', 'alternate', 'emergency'] 
    },
    { 
      key: 'alt_phone',     
      hints: ['alt_phone', 'altphone', 'alternate', 'emergency_contact', 'alt_mobile', 'emergency phone', 'emergency mobile'],
      exclude: ['email'] 
    },
    { 
      key: 'email',         
      hints: ['email', 'mail', 'emailid', 'e-mail'],
      exclude: ['alternate', 'alt', 'recovery'] 
    },
    { 
      key: 'address',       
      hints: ['address', 'addr', 'residence', 'location', 'permanent_address', 'corr_address', 'correspondence'],
      exclude: ['email', 'city', 'state', 'pincode', 'pin', 'zip', 'ip'] 
    },
    { 
      key: 'city',          
      hints: ['city', 'town', 'district', 'tehsil'],
      exclude: ['state', 'country', 'pincode', 'pin', 'zip'] 
    },
    { 
      key: 'state',         
      hints: ['state', 'province', 'region'],
      exclude: ['city', 'town', 'country', 'pincode', 'pin', 'zip'] 
    },
    { 
      key: 'pincode',       
      hints: ['pincode', 'pin', 'zip', 'postal', 'zipcode'],
      exclude: ['personal', 'pan', 'card'] 
    },
    { 
      key: 'roll_10',       
      hints: ['roll_10', 'roll10', 'class_10_roll', 'ssc_roll', 'roll_no_10', 'matric_roll', '10th roll'],
      exclude: ['12', '12th', 'hsc', 'grad', 'college', 'univ'] 
    },
    { 
      key: 'board_10',      
      hints: ['board_10', 'board10', 'ssc_board', 'class_10_board', 'matric_board', '10th board'],
      exclude: ['12', '12th', 'hsc', 'grad', 'college', 'univ'] 
    },
    { 
      key: 'marks_10',      
      hints: ['marks_10', 'marks10', 'ssc_marks', 'class_10_marks', 'ssc_percent', 'matric_percent', 'percentage_10', '10th percent', '10th marks'],
      exclude: ['12', '12th', 'hsc', 'grad', 'college', 'univ'] 
    },
    { 
      key: 'roll_12',       
      hints: ['roll_12', 'roll12', 'class_12_roll', 'hsc_roll', 'roll_no_12', 'inter_roll', '12th roll'],
      exclude: ['10', '10th', 'ssc', 'matric', 'grad', 'college', 'univ'] 
    },
    { 
      key: 'board_12',      
      hints: ['board_12', 'board12', 'hsc_board', 'class_12_board', 'inter_board', '12th board'],
      exclude: ['10', '10th', 'ssc', 'matric', 'grad', 'college', 'univ'] 
    },
    { 
      key: 'marks_12',      
      hints: ['marks_12', 'marks12', 'hsc_marks', 'class_12_marks', 'hsc_percent', 'inter_percent', 'percentage_12', '12th percent', '12th marks'],
      exclude: ['10', '10th', 'ssc', 'matric', 'grad', 'college', 'univ'] 
    },
    { 
      key: 'college',       
      hints: ['college', 'institute', 'university', 'school', 'inst_name'],
      exclude: ['10th', 'ssc', 'matric', '12th', 'hsc', 'intermediate'] 
    },
    { 
      key: 'degree',        
      hints: ['degree', 'course', 'qualification', 'program', 'stream', 'graduation'],
      exclude: ['10th', '12th'] 
    },
    { 
      key: 'grad_year',     
      hints: ['grad_year', 'gradyear', 'year_of_passing', 'passing_year', 'grad_date'],
      exclude: ['10th', '12th'] 
    },
    { 
      key: 'aadhaar',       
      hints: ['aadhaar', 'aadhar', 'uid', 'uidai'],
      exclude: ['pan', 'dl', 'passport'] 
    },
    { 
      key: 'pan',           
      hints: ['pan', 'panno', 'pan_number', 'permanent_account'],
      exclude: ['aadhar', 'aadhaar', 'dl', 'passport'] 
    },
    { 
      key: 'dl',            
      hints: ['driving', 'licence', 'license', 'dl'],
      exclude: ['aadhar', 'aadhaar', 'pan', 'passport'] 
    },
    { 
      key: 'bank_name',     
      hints: ['bank_name', 'bankname', 'bank_title', 'bankname'],
      exclude: ['holder', 'account'] 
    },
    { 
      key: 'account_no',    
      hints: ['account_no', 'accountno', 'account_number', 'acc_no', 'ac_no', 'ac_num', 'bank_account'],
      exclude: ['ifsc', 'branch', 'aadhaar', 'pan'] 
    },
    { 
      key: 'ifsc',          
      hints: ['ifsc', 'ifsccode', 'ifsc_code', 'bank_ifsc'],
      exclude: ['account'] 
    }
  ];

  let filled = 0;

  // 1. Process standard input, textarea, and select elements (explicitly excluding type=file)
  const textInputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select');
  
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
      const siblingInputs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select');
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

      // Skip match if exclusion pattern triggers
      if (field.exclude && field.exclude.some(ex => combinedHint.includes(ex))) {
        continue;
      }

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
          let finalVal = value;
          if (input.type === 'date') {
            finalVal = formatDateForInput(value);
          }
          input.value = finalVal;
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

      // Skip match if exclusion pattern triggers
      if (field.exclude && field.exclude.some(ex => cleanQuestion.includes(ex))) {
        continue;
      }

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

  // Helper date formatter scoped inside fillFormPageDirect (for browser tab execution scope)
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

  return filled;
}
