// =============================================================
// chrome-extension/content.js
// Injected into every page.
// Listens for FILL_PAGE messages, and bridges sessionStorage on FormSarthi tab.
// Supports 30 fields across wide domains.
// =============================================================

console.log("[FormSarthi Content Script] Injected on: " + window.location.href);

// File-level state (accessible to all functions regardless of scope)
let fsMeterInjected = false;
let lastPercent = -1;
let lastFilledCount = -1;
let debouncedAutoSaveTimeout = null;

if (window.hasFormSarthiContentScript) {
  console.log("[FormSarthi] Content script already initialized on this tab.");
} else {
  window.hasFormSarthiContentScript = true;

  // isDashboard: true when running on the FormSarthi dashboard tab.
  // Check DOM element (static HTML) AND URL as fallback in case of SPA timing.
  const isDashboard = !!document.getElementById('screen-main') ||
    ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
     (window.location.port === '3000' || window.location.port === '4000') &&
     window.location.pathname === '/');



  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FILL_PAGE") {
      const count = fillForm(message.profile);
      setTimeout(checkProgressChange, 100);
      sendResponse({ success: true, count });
    } else if (message.type === "GET_DECRYPTED_SESSION") {
      try {
        const sessionStr = sessionStorage.getItem("fs_active_session") || document.body.getAttribute("data-fs-session");
        const profile = sessionStr ? JSON.parse(sessionStr) : null;
        sendResponse({ success: !!profile, profile });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (isDashboard && message.type === "SAVE_DRAFT_DATA") {
      try {
        const activeProfile = sessionStorage.getItem("fs_active_profile");
        if (!activeProfile) {
          sendResponse({ success: false, error: "No active profile session" });
          return true;
        }
        let drafts = JSON.parse(localStorage.getItem(`fs_drafts_${activeProfile}`) || '{}');
        drafts[message.draft.url] = message.draft;
        localStorage.setItem(`fs_drafts_${activeProfile}`, JSON.stringify(drafts));
        
        // Notify dashboard page context
        window.postMessage({ type: "FS_DRAFT_UPDATED", url: message.draft.url }, "*");
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (isDashboard && message.type === "GET_DRAFT_VALUES") {
      try {
        const activeProfile = sessionStorage.getItem("fs_active_profile");
        if (!activeProfile) {
          sendResponse({ success: true, values: null });
          return true;
        }
        let drafts = JSON.parse(localStorage.getItem(`fs_drafts_${activeProfile}`) || '{}');
        const draft = drafts[message.url];
        sendResponse({ success: true, values: draft ? draft.values : null });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (isDashboard && message.type === "GET_DASHBOARD_FILE") {
      try {
        const activeProfile = sessionStorage.getItem("fs_active_profile");
        if (!activeProfile) {
          sendResponse({ success: false, error: "No active profile session" });
          return true;
        }
        
        const fileId = activeProfile + "_" + message.docKey;
        const dbOpenReq = indexedDB.open("FormSarthiLocalDB", 2);
        
        dbOpenReq.onsuccess = (e) => {
          const db = e.target.result;
          try {
            const tx = db.transaction("files", "readonly");
            const store = tx.objectStore("files");
            const getReq = store.get(fileId);
            
            getReq.onsuccess = () => {
              const fileObj = getReq.result;
              if (fileObj && fileObj.fileData) {
                sendResponse({ 
                  success: true, 
                  fileData: fileObj.fileData, 
                  fileType: fileObj.fileType 
                });
              } else {
                sendResponse({ success: false, error: "File not found in vault" });
              }
            };
            getReq.onerror = () => {
              sendResponse({ success: false, error: "Failed to read file" });
            };
          } catch (err) {
            sendResponse({ success: false, error: err.message });
          }
        };
        dbOpenReq.onerror = () => {
          sendResponse({ success: false, error: "Failed to open DB" });
        };
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }
    return true;
  });

  // Target page logic (runs on non-dashboard form pages)
  if (!isDashboard) {
    injectCompletenessMeter();
    updateMeterUIForLockedState();

    chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (response) => {
      if (response && response.success && response.profile) {
        // Retrieve and restore draft values if any
        chrome.runtime.sendMessage({ type: "CHECK_DRAFT_RESTORE", url: window.location.href }, (restoreRes) => {
          if (restoreRes && restoreRes.success && restoreRes.values) {
            restoreDraftValues(restoreRes.values);
          }
        });
        // Start auto-save progress loop and setup completeness meter
        setupCompletenessMeter();
      } else {
        updateMeterUIForLockedState();
      }
    });
  }
}

function restoreDraftValues(values) {
  if (!values) return;
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea, select');
  inputs.forEach((input, index) => {
    const key = input.name || input.id || `input_idx_${index}`;
    if (values[key] !== undefined) {
      input.value = values[key];
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function injectCompletenessMeter() {
  if (document.getElementById('fs-completeness-container')) return;
  if (!document.body) return;

  const container = document.createElement('div');
  container.id = 'fs-completeness-container';
  container.style.cssText = `
    position: fixed !important;
    bottom: 24px !important;
    right: 24px !important;
    z-index: 2147483647 !important;
    font-family: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif !important;
    color: #ffffff !important;
    display: flex !important;
    align-items: center !important;
    pointer-events: auto !important;
  `;

  if (!document.querySelector('link[href*="Outfit"]')) {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap';
    document.head.appendChild(fontLink);
  }

  const style = document.createElement('style');
  style.id = 'fs-completeness-styles';
  style.textContent = `
    #fs-completeness-container * {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .fs-card {
      background: rgba(18, 14, 12, 0.95) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      border: 1px solid rgba(255, 255, 255, 0.1) !important;
      border-radius: 16px !important;
      padding: 12px 16px !important;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5) !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      width: 250px !important;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    .fs-card.fs-hidden {
      opacity: 0 !important;
      transform: translateY(20px) scale(0.9) !important;
      pointer-events: none !important;
      width: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      margin-left: 0 !important;
      border-color: transparent !important;
    }
    .fs-progress-container {
      position: relative !important;
      width: 44px !important;
      height: 44px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    .fs-pct-text {
      position: absolute !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      color: #5eead4 !important;
    }
    .fs-details {
      flex: 1 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      align-items: flex-start !important;
    }
    .fs-title {
      font-size: 10px !important;
      font-weight: 600 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.5px !important;
      color: rgba(255, 255, 255, 0.5) !important;
    }
    .fs-remaining {
      font-size: 13px !important;
      font-weight: 700 !important;
      color: #F7F2EC !important;
    }
    .fs-close-btn {
      background: none !important;
      border: none !important;
      color: rgba(255, 255, 255, 0.4) !important;
      cursor: pointer !important;
      font-size: 14px !important;
      padding: 4px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
      border-radius: 4px !important;
    }
    .fs-close-btn:hover {
      color: #f87171 !important;
      background: rgba(255, 255, 255, 0.05) !important;
    }
    .fs-fab {
      width: 48px !important;
      height: 48px !important;
      background: #5eead4 !important;
      border-radius: 50% !important;
      box-shadow: 0 8px 24px rgba(94, 234, 212, 0.3) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
      position: absolute !important;
      right: 0 !important;
      bottom: 0 !important;
      border: none !important;
    }
    .fs-fab.fs-hidden {
      opacity: 0 !important;
      transform: scale(0.5) rotate(-45deg) !important;
      pointer-events: none !important;
    }
    .fs-fab:hover {
      transform: scale(1.05) !important;
      background: #2dd4bf !important;
      box-shadow: 0 8px 30px rgba(45, 212, 191, 0.4) !important;
    }
    .fs-fab-icon {
      font-weight: 800 !important;
      font-size: 12px !important;
      color: #110e0b !important;
    }
  `;
  document.head.appendChild(style);

  // Programmatically create HTML elements to bypass Google's TrustedHTML policy
  const fsCard = document.createElement('div');
  fsCard.id = 'fs-card';
  fsCard.className = 'fs-card';

  const progressContainer = document.createElement('div');
  progressContainer.className = 'fs-progress-container';

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "44");
  svg.setAttribute("height", "44");
  svg.setAttribute("viewBox", "0 0 44 44");
  svg.style.display = "block";

  const circleBg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circleBg.setAttribute("cx", "22");
  circleBg.setAttribute("cy", "22");
  circleBg.setAttribute("r", "18");
  circleBg.setAttribute("fill", "transparent");
  circleBg.setAttribute("stroke", "rgba(255, 255, 255, 0.08)");
  circleBg.setAttribute("stroke-width", "3.5");

  const circleProgress = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circleProgress.id = 'fs-progress-circle';
  circleProgress.setAttribute("cx", "22");
  circleProgress.setAttribute("cy", "22");
  circleProgress.setAttribute("r", "18");
  circleProgress.setAttribute("fill", "transparent");
  circleProgress.setAttribute("stroke", "#5eead4");
  circleProgress.setAttribute("stroke-width", "3.5");
  circleProgress.setAttribute("stroke-dasharray", "113.1");
  circleProgress.setAttribute("stroke-dashoffset", "113.1");
  circleProgress.setAttribute("stroke-linecap", "round");
  circleProgress.setAttribute("transform", "rotate(-90 22 22)");
  circleProgress.style.cssText = "transition: stroke-dashoffset 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;";

  svg.appendChild(circleBg);
  svg.appendChild(circleProgress);

  const pctText = document.createElement('span');
  pctText.id = 'fs-pct-text';
  pctText.className = 'fs-pct-text';
  pctText.textContent = '0%';

  progressContainer.appendChild(svg);
  progressContainer.appendChild(pctText);

  const details = document.createElement('div');
  details.className = 'fs-details';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'fs-title';
  titleSpan.textContent = 'FormSarthi Tracker';

  const remainingText = document.createElement('span');
  remainingText.id = 'fs-remaining-text';
  remainingText.className = 'fs-remaining';
  remainingText.textContent = 'Calculating...';

  details.appendChild(titleSpan);
  details.appendChild(remainingText);

  const closeBtn = document.createElement('button');
  closeBtn.id = 'fs-close-btn';
  closeBtn.className = 'fs-close-btn';
  closeBtn.title = 'Minimize';
  closeBtn.textContent = '✕';

  fsCard.appendChild(progressContainer);
  fsCard.appendChild(details);
  fsCard.appendChild(closeBtn);

  const fsFab = document.createElement('button');
  fsFab.id = 'fs-fab';
  fsFab.className = 'fs-fab fs-hidden';
  fsFab.title = 'Show Tracker';

  const fabIcon = document.createElement('span');
  fabIcon.id = 'fs-fab-pct';
  fabIcon.className = 'fs-fab-icon';
  fabIcon.textContent = '0%';

  fsFab.appendChild(fabIcon);

  container.appendChild(fsCard);
  container.appendChild(fsFab);

  document.body.appendChild(container);

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fsCard.classList.add('fs-hidden');
    fsFab.classList.remove('fs-hidden');
    sessionStorage.setItem('fs_meter_collapsed', 'true');
  });

  fsFab.addEventListener('click', (e) => {
    e.stopPropagation();
    fsFab.classList.add('fs-hidden');
    fsCard.classList.remove('fs-hidden');
    sessionStorage.removeItem('fs_meter_collapsed');
  });

  if (sessionStorage.getItem('fs_meter_collapsed') === 'true') {
    fsCard.classList.add('fs-hidden');
    fsFab.classList.remove('fs-hidden');
  }
}

function calculateCompleteness() {
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea, select');
  if (inputs.length === 0) return { pct: 0, filled: 0, total: 0, remaining: 0 };
  
  let filledCount = 0;
  inputs.forEach((input) => {
    const val = input.value.trim();
    if (val) {
      filledCount++;
    }
  });
  
  const pct = Math.round((filledCount / inputs.length) * 100);
  return {
    pct,
    filled: filledCount,
    total: inputs.length,
    remaining: inputs.length - filledCount
  };
}

function checkProgressChange() {
  const progress = calculateCompleteness();
  if (progress.total === 0) return;
  
  if (progress.pct !== lastPercent || progress.filled !== lastFilledCount) {
    lastPercent = progress.pct;
    lastFilledCount = progress.filled;
    updateMeterUI(progress.pct, progress.remaining);
    triggerAutoSave();
  }
}

function triggerAutoSave() {
  if (debouncedAutoSaveTimeout) clearTimeout(debouncedAutoSaveTimeout);
  debouncedAutoSaveTimeout = setTimeout(() => {
    saveDraftData();
  }, 2000);
}

function saveDraftData() {
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]), textarea, select');
  if (inputs.length === 0) return;
  
  const values = {};
  let filledCount = 0;
  inputs.forEach((input, index) => {
    const val = input.value.trim();
    if (val) {
      filledCount++;
      const key = input.name || input.id || `input_idx_${index}`;
      values[key] = val;
    }
  });
  
  const pct = Math.round((filledCount / inputs.length) * 100);
  
  if (filledCount > 0) {
    const draft = {
      url: window.location.href,
      title: document.title || window.location.hostname,
      percent: pct,
      values: values,
      timestamp: Date.now()
    };
    chrome.runtime.sendMessage({
      type: "AUTO_SAVE_DRAFT",
      draft: draft
    });
  }
}

function updateMeterUI(pct, remaining) {
  injectCompletenessMeter();
  
  const circle = document.getElementById('fs-progress-circle');
  const pctText = document.getElementById('fs-pct-text');
  const remainingText = document.getElementById('fs-remaining-text');
  const fabPct = document.getElementById('fs-fab-pct');
  
  if (circle && pctText && remainingText && fabPct) {
    const circumference = 113.1;
    const offset = circumference - (pct / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    
    pctText.textContent = `${pct}%`;
    pctText.style.fontSize = "11px";
    fabPct.textContent = `${pct}%`;
    
    if (remaining === 0) {
      remainingText.textContent = "All fields filled! ✨";
      remainingText.style.color = "#34d399";
      pctText.style.color = "#34d399";
      circle.style.stroke = "#34d399";
    } else {
      remainingText.textContent = `${remaining} field${remaining !== 1 ? 's' : ''} left`;
      remainingText.style.color = "#F7F2EC";
      pctText.style.color = "#5eead4";
      circle.style.stroke = "#5eead4";
    }
  }
}

function updateMeterUIForLockedState() {
  injectCompletenessMeter();
  
  const circle = document.getElementById('fs-progress-circle');
  const pctText = document.getElementById('fs-pct-text');
  const remainingText = document.getElementById('fs-remaining-text');
  const fabPct = document.getElementById('fs-fab-pct');
  
  if (circle && pctText && remainingText && fabPct) {
    const circumference = 113.1;
    circle.style.strokeDashoffset = circumference;
    circle.style.stroke = "#f87171";
    
    pctText.textContent = "🔒";
    pctText.style.fontSize = "16px";
    fabPct.textContent = "🔒";
    
    remainingText.textContent = "Unlock Vault to Autofill";
    remainingText.style.color = "#f87171";
  }
}

function setupCompletenessMeter() {
  setTimeout(checkProgressChange, 500);
  
  document.addEventListener('input', checkProgressChange);
  document.addEventListener('change', checkProgressChange);
  
  setInterval(checkProgressChange, 3000);
}

function fillForm(profile) {
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

  // Autofill files
  fillFormFiles(profile);

  return filled;
}

/**
 * Format string dates of type DD/MM/YYYY, DD-MM-YYYY, or string-based formats into YYYY-MM-DD
 */
function formatDateForInput(dateStr) {
  if (!dateStr) return "";
  
  let cleanStr = dateStr.trim().replace(/[\s\.\-]+/g, '/');
  
  let parts = cleanStr.split('/');
  if (parts.length === 3) {
    let p0 = parseInt(parts[0], 10);
    let p1 = parseInt(parts[1], 10);
    let p2 = parseInt(parts[2], 10);
    
    // YYYY/MM/DD
    if (p0 > 1000) {
      let y = p0;
      let m = String(p1).padStart(2, '0');
      let d = String(p2).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    // DD/MM/YYYY or MM/DD/YYYY
    if (p1 <= 12 && p0 <= 31) {
      let d = String(p0).padStart(2, '0');
      let m = String(p1).padStart(2, '0');
      let y = p2;
      if (y < 100) y = (y > 50 ? 1900 : 2000) + y;
      return `${y}-${m}-${d}`;
    }
  }
  
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch (e) {}
  
  return dateStr;
}

function fillFormFiles(profile) {
  if (!profile || !profile.uploadedDocs) return;

  const docFieldMap = [
    { key: 'photo',         hints: ['photo', 'photograph', 'image', 'picture', 'passport size', 'pp size', 'profile pic', 'pic'] },
    { key: 'signature',     hints: ['signature', 'sign', 'specimen', 'sig'] },
    { key: 'aadhaar',       hints: ['aadhaar', 'aadhar', 'uid', 'id proof', 'id_proof', 'aadhaar card', 'aadhar card'] },
    { key: 'pan',           hints: ['pan', 'panno', 'pan card', 'permanent account'] },
    { key: 'dl',            hints: ['driving', 'license', 'licence', 'dl', 'driving license', 'driving licence'] },
    { key: 'resume',        hints: ['resume', 'cv', 'curriculum', 'curriculum vitae'] },
    { key: 'marksheet_10',  hints: ['10th', 'ssc', 'matric', 'class 10', 'marksheet_10', 'marksheet 10', 'class10', '10 mark', '10th mark', 'secondary', 'class x'] },
    { key: 'marksheet_12',  hints: ['12th', 'hsc', 'inter', 'class 12', 'marksheet_12', 'marksheet 12', 'class12', '12 mark', '12th mark', 'intermediate', 'senior secondary', 'class xii'] },
    { key: 'passport',      hints: ['passport'] },
    { key: 'bank_passbook', hints: ['bank passbook', 'passbook', 'statement', 'bank statement', 'cancelled cheque'] }
  ];

  if (profile.customDocs) {
    profile.customDocs.forEach(custom => {
      docFieldMap.push({
        key: custom.key,
        hints: [custom.label.toLowerCase(), custom.key]
      });
    });
  }

  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  if (fileInputs.length === 0) {
    console.log('[FormSarthi Files] No file inputs found on this page.');
    return;
  }

  console.log(`[FormSarthi Files] Found ${fileInputs.length} file input(s). Attempting autofill...`);

  const uploadedDocKeys = Object.entries(profile.uploadedDocs || {})
    .filter(([k, v]) => v === true)
    .map(([k]) => k);

  if (uploadedDocKeys.length === 0) {
    console.log('[FormSarthi Files] No uploaded docs in vault. Upload docs first on the dashboard.');
    return;
  }

  console.log('[FormSarthi Files] Uploaded docs available:', uploadedDocKeys);

  function extractFileLabelText(input) {
    let labelText = '';
    // 1. Direct input attributes
    labelText += ' ' + (input.name || '');
    labelText += ' ' + (input.id || '');
    labelText += ' ' + (input.getAttribute('aria-label') || '');
    labelText += ' ' + (input.getAttribute('placeholder') || '');
    labelText += ' ' + (input.getAttribute('title') || '');
    labelText += ' ' + (input.getAttribute('data-label') || '');
    // 2. aria-labelledby
    const ariaLabelledby = input.getAttribute('aria-labelledby');
    if (ariaLabelledby) {
      ariaLabelledby.split(/\s+/).forEach(id => {
        const el = document.getElementById(id);
        if (el) labelText += ' ' + el.textContent;
      });
    }
    // 3. <label for=""> element
    if (input.id) {
      try {
        const lbl = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
        if (lbl) labelText += ' ' + lbl.textContent;
      } catch(e) {}
    }
    // 4. Closest <label> ancestor
    const parentLabel = input.closest('label');
    if (parentLabel) labelText += ' ' + parentLabel.textContent;
    // 5. Walk up DOM tree collecting text from each ancestor (up to 10 levels)
    let parent = input.parentElement;
    for (let level = 0; level < 10 && parent; level++) {
      if (parent.tagName === 'FORM' || parent.tagName === 'BODY' || parent.tagName === 'HTML') break;
      const siblingInputs = parent.querySelectorAll('input, textarea, select');
      if (siblingInputs.length > 1 && level > 2) break;
      Array.from(parent.childNodes).forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          labelText += ' ' + node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE && !node.querySelector('input, textarea, select')) {
          labelText += ' ' + node.textContent;
        }
      });
      parent = parent.parentElement;
    }
    // 6. Previous sibling elements
    let prev = input.previousElementSibling;
    let prevCount = 0;
    while (prev && prevCount < 4) {
      if (['LABEL','SPAN','P','DIV','H1','H2','H3','H4','H5','LI','TD','TH'].includes(prev.tagName)) {
        labelText += ' ' + prev.textContent;
      }
      prev = prev.previousElementSibling;
      prevCount++;
    }
    return labelText.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  const matchedInputIndices = new Set();

  fileInputs.forEach((input, idx) => {
    const labelText = extractFileLabelText(input);
    console.log(`[FormSarthi Files] File input[${idx}] context: "${labelText.substring(0, 200)}"`);

    for (const field of docFieldMap) {
      if (!profile.uploadedDocs[field.key]) continue;
      if (matchedInputIndices.has(idx)) break;

      const matched = field.hints.some(hint => labelText.includes(hint));
      if (matched) {
        matchedInputIndices.add(idx);
        console.log(`[FormSarthi Files] Matched input[${idx}] -> doc: "${field.key}"`);
        chrome.runtime.sendMessage({ type: 'GET_FILE_DATA', docKey: field.key }, (fileRes) => {
          if (chrome.runtime.lastError) {
            console.warn('[FormSarthi Files] Runtime error:', chrome.runtime.lastError.message);
            return;
          }
          if (fileRes && fileRes.success && fileRes.fileData) {
            const mime = fileRes.fileType || 'application/pdf';
            const ext = mime.includes('png') ? 'png' : mime.includes('jpg') || mime.includes('jpeg') ? 'jpg' : 'pdf';
            uploadFileToInput(input, fileRes.fileData, mime, field.key + '.' + ext);
          } else {
            console.warn('[FormSarthi Files] No data for "' + field.key + '":', fileRes && fileRes.error);
          }
        });
        break;
      }
    }
  });

  // Fallback: single file input, no label match => try first uploaded doc
  if (fileInputs.length === 1 && matchedInputIndices.size === 0 && uploadedDocKeys.length > 0) {
    const fallbackKey = uploadedDocKeys[0];
    console.log('[FormSarthi Files] Fallback: single input, no match. Trying:', fallbackKey);
    chrome.runtime.sendMessage({ type: 'GET_FILE_DATA', docKey: fallbackKey }, (fileRes) => {
      if (chrome.runtime.lastError) {
        console.warn('[FormSarthi Files] Fallback runtime error:', chrome.runtime.lastError.message);
        return;
      }
      if (fileRes && fileRes.success && fileRes.fileData) {
        const mime = fileRes.fileType || 'application/pdf';
        const ext = mime.includes('png') ? 'png' : mime.includes('jpg') || mime.includes('jpeg') ? 'jpg' : 'pdf';
        uploadFileToInput(fileInputs[0], fileRes.fileData, mime, fallbackKey + '.' + ext);
      } else {
        console.warn('[FormSarthi Files] Fallback failed. Is vault unlocked?', fileRes && fileRes.error);
      }
    });
  }
}

function uploadFileToInput(input, base64Data, mimeType, fileName) {
  try {
    let base64Content = base64Data;
    if (base64Data.includes(',')) {
      base64Content = base64Data.split(',')[1];
    }
    // Decode base64 to byte array
    const byteCharacters = atob(base64Content);
    const byteArray = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Warn if accept attribute might reject the file type
    const accept = input.getAttribute('accept') || '';
    if (accept && accept !== '*' && accept !== '*/*') {
      const acceptedTypes = accept.split(',').map(s => s.trim().toLowerCase());
      const fileType = mimeType.toLowerCase();
      const fileExt = '.' + fileName.split('.').pop().toLowerCase();
      const isAccepted = acceptedTypes.some(a => {
        if (a.startsWith('.')) return a === fileExt;
        if (a.endsWith('/*')) return fileType.startsWith(a.replace('/*', '/'));
        return a === fileType;
      });
      if (!isAccepted) {
        console.warn('[FormSarthi Files] Type "' + mimeType + '" might not match accept="' + accept + '". Attempting anyway.');
      }
    }

    input.files = dataTransfer.files;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    if (input.files && input.files.length > 0) {
      console.log('[FormSarthi Files] Successfully set file:', fileName, '(' + mimeType + ')');
      return true;
    } else {
      console.warn('[FormSarthi Files] input.files assignment did not stick (browser security?).');
      return false;
    }
  } catch (err) {
    console.error('[FormSarthi Files] Exception in uploadFileToInput:', err);
    return false;
  }
}
