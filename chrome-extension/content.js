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

function getRelevantFormInputs() {
  const allInputs = document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]):not([type=image]):not([type=reset]), textarea, select'
  );

  return Array.from(allInputs).filter(input => {
    // 1. Basic visibility check
    try {
      const style = window.getComputedStyle(input);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
    } catch (e) {}
    
    const width = input.offsetWidth || input.getBoundingClientRect().width;
    const height = input.offsetHeight || input.getBoundingClientRect().height;
    if (width === 0 || height === 0) {
      return false;
    }

    // 2. Search check
    const nameStr = (input.name || '').toLowerCase();
    const idStr = (input.id || '').toLowerCase();
    const placeholderStr = (input.placeholder || '').toLowerCase();
    const ariaStr = (input.getAttribute('aria-label') || '').toLowerCase();
    const typeStr = (input.type || '').toLowerCase();

    if (typeStr === 'search') {
      return false;
    }

    const isSearchPattern = /search|query|^q$/i.test(nameStr || idStr || placeholderStr || '');
    if (isSearchPattern) {
      return false;
    }

    // Check if inside a search form or container
    try {
      const closestForm = input.closest('form');
      if (closestForm) {
        const formId = (closestForm.id || '').toLowerCase();
        const formClass = (closestForm.className || '').toLowerCase();
        const formRole = (closestForm.getAttribute('role') || '').toLowerCase();
        const formAction = (closestForm.getAttribute('action') || '').toLowerCase();
        if (
          formId.includes('search') ||
          formClass.includes('search') ||
          formRole === 'search' ||
          formAction.includes('search')
        ) {
          return false;
        }
      }
    } catch (e) {}

    return true;
  });
}

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
        const sessionStr = localStorage.getItem("fs_active_session") || document.body.getAttribute("data-fs-session");
        const profile = sessionStr ? JSON.parse(sessionStr) : null;
        sendResponse({ success: !!profile, profile });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    } else if (isDashboard && message.type === "SAVE_DRAFT_DATA") {
      try {
        const activeProfile = localStorage.getItem("fs_active_profile");
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
        const activeProfile = localStorage.getItem("fs_active_profile");
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
        const activeProfile = localStorage.getItem("fs_active_profile");
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
    } else if (isDashboard && message.type === "GET_ALL_PROFILES_IDB") {
      getAllProfilesFromIDB()
        .then(profiles => sendResponse({ success: true, profiles }))
        .catch(err    => sendResponse({ success: false, error: err.message }));
      return true; // async
    }
    return true;
  });

  // ── NEW: Sync profiles to extension storage on portal startup (if unlocked) ──
  if (isDashboard) {
    // Listen for events from the portal website
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      
      // 1. Relays logout signal
      if (event.data && event.data.type === 'FS_PORTAL_LOGOUT') {
        console.log('[FormSarthi Content] Portal logout detected → notifying background');
        chrome.runtime.sendMessage({ type: 'PORTAL_LOGOUT' });
      }
      
      // 2. Relays profile sync request
      if (event.data && event.data.type === 'FS_SYNC_PROFILES_TO_EXT') {
        console.log('[FormSarthi Content] Portal requested profile sync → querying IndexedDB');
        setTimeout(async () => {
          try {
            const profiles = await getAllProfilesFromIDB();
            chrome.runtime.sendMessage({ type: 'PORTAL_PROFILES_UPDATED', profiles });
            console.log('[FormSarthi Content] Pushed', profiles?.length, 'profile(s) to background.');
          } catch (e) {
            console.warn('[FormSarthi Content] Profile sync failed:', e.message);
          }
        }, 100);
      }
    });

    // Run initial sync when page is ready (without missing the load event)
    const runInitialSync = () => {
      setTimeout(async () => {
        try {
          const profiles = await getAllProfilesFromIDB();
          if (profiles && profiles.length > 0) {
            chrome.runtime.sendMessage({ type: 'PORTAL_PROFILES_UPDATED', profiles });
            console.log('[FormSarthi Content] Pushed', profiles.length, 'profile(s) to extension storage on init.');
          }
        } catch (e) {
          console.warn('[FormSarthi Content] Initial profile push failed:', e.message);
        }
      }, 800);
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      runInitialSync();
    } else {
      window.addEventListener('load', runInitialSync);
    }
  }

  // Target page logic (runs on non-dashboard form pages)
  if (!isDashboard) {
    // Listen for postMessage from the parent portal to trigger autofill inside iframe
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FS_TRIGGER_AUTOFILL_IN_FRAME') {
        console.log('[FormSarthi Content] Received FS_TRIGGER_AUTOFILL_IN_FRAME signal.');
        chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (response) => {
          if (response && response.success && response.profile) {
            const count = fillForm(response.profile);
            console.log('[FormSarthi Content] Autofilled fields in frame:', count);
            setTimeout(checkProgressChange, 100);
          } else {
            console.warn('[FormSarthi Content] Could not autofill inside frame: Vault is locked.');
          }
        });
      }
    });

    const isAutofillablePage = () => {
      const inputs = getRelevantFormInputs();
      
      // We only show the floating tracker on forms with 3 or more visible, non-search inputs
      if (inputs.length < 3) return false;

      const autofillHints = [
        'name', 'fullname', 'full_name', 'applicant', 'candidate', 'first_name',
        'father', 'mother', 'dob', 'birth', 'dateofbirth', 'born',
        'gender', 'sex', 'caste', 'category', 'social_status',
        'nationality', 'religion', 'phone', 'mobile', 'contact', 'telephone',
        'email', 'mail', 'address', 'addr', 'residence', 'pincode', 'pin', 'zip',
        'roll', 'board', 'marks', 'college', 'degree', 'grad',
        'aadhaar', 'aadhar', 'pan', 'dl', 'passport',
        'bank', 'account', 'ifsc', 'insurance', 'password', 'pass', 'pwd'
      ];

      // Check if at least one input matches our hints to verify it's a profile/form page
      const hasMatchingField = inputs.some(input => {
        const nameStr = (input.name || '').toLowerCase();
        const idStr = (input.id || '').toLowerCase();
        const placeholderStr = (input.placeholder || '').toLowerCase();
        const ariaStr = (input.getAttribute('aria-label') || '').toLowerCase();
        const combined = `${nameStr} ${idStr} ${placeholderStr} ${ariaStr}`;
        return autofillHints.some(h => combined.includes(h));
      });

      return hasMatchingField;
    };

    const runCheck = () => {
      if (!isAutofillablePage()) {
        const container = document.getElementById('fs-completeness-container');
        if (container) {
          container.remove();
        }
        return;
      }

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
    };

    // Run checks on DOM load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runCheck);
    } else {
      runCheck();
    }
    // Periodic fallback checks for dynamic single-page application form loads
    setTimeout(runCheck, 1000);
    setTimeout(runCheck, 3000);
  }
}


// ── NEW: Read all profile metadata from IndexedDB for extension popup ──
// Returns safe metadata: name, email, avatar, color, completionPct, encryptedProfile
function getAllProfilesFromIDB() {
  const PROFILE_FIELD_KEYS = [
    'name','father_name','mother_name','dob','gender','caste',
    'nationality','religion','blood_group','marital_status',
    'phone','alt_phone','email','address','city','state','pincode',
    'roll_10','roll_12','board_10','board_12','marks_10','marks_12',
    'college','degree','grad_year','aadhaar','pan','bank_name',
    'account_no','ifsc',
  ];

  return new Promise((resolve, reject) => {
    const req = indexedDB.open('FormSarthiLocalDB', 2);
    req.onerror = () => reject(new Error('Cannot open FormSarthiLocalDB'));
    req.onsuccess = (e) => {
      const db = e.target.result;
      try {
        const tx    = db.transaction('profiles', 'readonly');
        const store = tx.objectStore('profiles');
        const getAllReq = store.getAll();

        getAllReq.onsuccess = () => {
          const rawProfiles = getAllReq.result || [];
          // Map to safe metadata (include encrypted blob for popup decryption)
          const profileMeta = rawProfiles.map(p => {
            // Attempt to compute completion pct from encryptedProfile if not stored
            return {
              email:            p.email,
              name:             p.name || p.email?.split('@')[0] || 'Profile',
              avatar:           p.avatar || '🪪',
              color:            p.color  || 'purple',
              encryptedProfile: p.encryptedProfile || null,
              completionPct:    p.completionPct || 0,
              lastUsed:         p.lastUsed || null,
            };
          });
          resolve(profileMeta);
        };
        getAllReq.onerror = () => reject(new Error('Failed to read profiles store'));
      } catch (err) {
        reject(err);
      }
    };
  });
}

function restoreDraftValues(values) {
  if (!values) return;
  const inputs = getRelevantFormInputs();
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
      cursor: pointer !important;
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

  fsCard.addEventListener('click', (e) => {
    if (e.target.closest('#fs-close-btn')) return;
    const remainingText = document.getElementById('fs-remaining-text');
    if (remainingText && remainingText.textContent.includes("Unlock")) {
      chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    }
  });

  fsFab.addEventListener('click', (e) => {
    const fabPct = document.getElementById('fs-fab-pct');
    if (fabPct && fabPct.textContent === "🔒") {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
      return;
    }
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
  const inputs = getRelevantFormInputs();
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
  const inputs = getRelevantFormInputs();
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

// PART 4 — Helper to get label text for field matching
function getLabelText(el) {
  if (!el) return "";
  let text = "";

  // 1. Direct attributes
  text += (el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-label") || "") + " ";

  // 2. Check aria-labelledby (Google Forms specific)
  const ariaLabelledby = el.getAttribute("aria-labelledby");
  if (ariaLabelledby) {
    ariaLabelledby.split(/\s+/).forEach(id => {
      const target = document.getElementById(id);
      if (target && target.textContent) {
        text += " " + target.textContent;
      }
    });
  }

  // 3. Check standard labels
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label && label.textContent) text += " " + label.textContent;
  }
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.textContent) text += " " + parentLabel.textContent;

  // 4. Parent Traversal with Bleeding Prevention
  let parent = el.parentElement;
  for (let i = 0; i < 6 && parent; i++) {
    if (parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
    
    // Stop traversal if we run into sibling fields to prevent bleeding labels
    const siblingInputs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select');
    if (siblingInputs.length > 1) break;

    if (parent.textContent) {
      text += " " + parent.textContent;
    }
    parent = parent.parentElement;
  }

  return text.trim();
}

// PART 4 — Autofill field matching (form pe)
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

  // ── CANDIDATE NAME — ONLY after ruling out all above ──
  if (t === "name" || t === "full name" || t.includes("student name") ||
      t.includes("candidate name") || t.includes("applicant name") ||
      t.includes("your name") || t.includes("name of student") ||
      t.includes("name of applicant") || t.includes("नाम")) return profile.name || '';

  // ── CONTACT ──
  if (t.includes("mobile") || t.includes("phone") || t.includes("contact no") || t.includes("cell")) return profile.phone || '';
  if (t.includes("whatsapp")) return profile.phone || '';
  if (t.includes("email") || t.includes("e-mail") || t.includes("ईमेल")) return profile.email || '';
  if (t.includes("alternate") && t.includes("mobile")) return profile.alt_phone || '';

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

  // ── DEGREE / COURSE ──
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

  // ── OTHER ──
  if (t.includes("nationality")) return profile.nationality || 'Indian';
  if (t.includes("religion")) return profile.religion || '';
  if (t.includes("blood group") || t.includes("blood type")) return profile.blood_group || '';
  if (t.includes("income") || t.includes("annual income")) return profile.income || '';
  if (t.includes("domicile") || t.includes("bonafide")) return profile.domicile_state || profile.state || '';

  return null;
}

// PART 5 — Radio buttons aur dropdowns bhi fill karo
function fillSelectAndRadio(profile) {
  let filled = 0;

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
          filled++;
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
        filled++;
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
        filled++;
      }
    }
  });

  return filled;
}

function fillForm(profile) {
  if (!profile) return 0;

  let filled = 0;

  // 1. Process standard input, textarea elements (excluding selects, radios, checkboxes, files)
  const textInputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea');
  
  textInputs.forEach(input => {
    // Skip if search input
    const typeStr = (input.type || '').toLowerCase();
    const nameStr = (input.name || '').toLowerCase();
    const idStr = (input.id || '').toLowerCase();
    const placeholderStr = (input.placeholder || '').toLowerCase();
    if (typeStr === 'search' || /search|query|^q$/i.test(nameStr || idStr || placeholderStr || '')) {
      return;
    }

    const labelText = getLabelText(input);
    let value = matchFieldToProfile(labelText, profile);

    // Support custom fields fallback
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

    if (value) {
      console.log(`[FormSarthi Match] Text Field: "${labelText.substring(0, 50)}" -> Value: ${value}`);
      let finalVal = value;
      if (input.type === 'date') {
        finalVal = formatDateForInput(value);
      }
      // Use native setter for frameworks that override .value (React, Angular, Google Forms)
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, finalVal);
      } else {
        input.value = finalVal;
      }
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // Focus and blur to trigger floating label transitions on Google Forms
      input.dispatchEvent(new Event('focus',  { bubbles: true }));
      input.dispatchEvent(new Event('blur',   { bubbles:   true }));
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

  // 2. Process Select and Radio inputs
  filled += fillSelectAndRadio(profile);

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
