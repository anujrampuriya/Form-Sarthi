// =============================================================
// chrome-extension/background.js  (MV3 Service Worker)
//
// Responsibilities:
//  1. GET_PROFILES_FROM_PORTAL  — scrape IndexedDB via content script
//     on the portal tab and cache into chrome.storage.local
//  2. FILL_FORM                 — relay autofill to active tab's content.js
//                                 (profile data passed directly, not fetched from tab)
//  3. OPEN_DASHBOARD            — focus or create the portal tab
//  4. Legacy messages: CHECK_DRAFT_RESTORE, AUTO_SAVE_DRAFT, GET_FILE_DATA
//
// Security: raw decrypted profile data is passed at fill-time from popup.
//           Background never stores decrypted data.
// =============================================================

const STORAGE_PROFILES_KEY = 'fs_ext_profiles';

// ── Main message dispatcher ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true; // keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {

    // ── NEW: Pull profile list from portal's IndexedDB via content script ──
    case 'GET_PROFILES_FROM_PORTAL': {
      return await getProfilesFromPortal();
    }

    // ── FILL_FORM: profile data comes directly from popup (already decrypted) ──
    case 'FILL_FORM': {
      try {
        const profile = message.profile;
        if (!profile) throw new Error('No profile data provided.');

        let tabId = message.tabId;
        if (!tabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          tabId = activeTab?.id;
        }
        if (!tabId) throw new Error('No active tab found.');

        // Try messaging content.js first
        let filledCount = 0;
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'FILL_PAGE', profile });
          if (response && response.success) {
            filledCount = response.count;
          } else {
            throw new Error('Content script response failed');
          }
        } catch (msgErr) {
          // Fallback: inject the fill function directly into the page
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func:   fillFormPageDirect,
            args:   [profile],
          });
          filledCount = results?.[0]?.result ?? 0;
        }
        return { success: true, fielledCount: filledCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // ── Legacy GET_PROFILE (still used by old content.js floating tracker) ──
    case 'GET_PROFILE': {
      try {
        // Try reading live session from popup's storage slot
        const stored = await storageGet('fs_ext_session');
        if (stored && stored.decryptedData && stored.expiry > Date.now()) {
          const profile = stored.decryptedData;
          const allFields = [
            'name','father_name','mother_name','dob','gender','caste',
            'nationality','religion','blood_group','marital_status',
            'phone','alt_phone','email','address','city','state','pincode',
            'roll_10','roll_12','board_10','board_12','marks_10','marks_12',
            'college','degree','grad_year','aadhaar','pan','bank_name',
            'account_no','ifsc',
          ];
          const filled  = allFields.filter(f => profile[f]).length;
          const percent = Math.round((filled / allFields.length) * 100);
          return { success: true, profile, status: { percent } };
        }
        // No live session
        return { success: false, error: 'Vault locked. Open FormSarthi extension popup and unlock.' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // ── Draft save/restore (dashboard → content.js) ──
    case 'CHECK_DRAFT_RESTORE': {
      try {
        const dashTab = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashTab.id, {
          type: 'GET_DRAFT_VALUES',
          url:  message.url,
        });
        return response || { success: false };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'AUTO_SAVE_DRAFT': {
      try {
        const dashTab = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashTab.id, {
          type:  'SAVE_DRAFT_DATA',
          draft: message.draft,
        });
        return response || { success: false };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'GET_FILE_DATA': {
      try {
        const dashTab = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashTab.id, {
          type:   'GET_DASHBOARD_FILE',
          docKey: message.docKey,
        });
        return response || { success: false };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'OPEN_DASHBOARD': {
      try {
        const dashTab = await getDashboardTab();
        await chrome.tabs.update(dashTab.id, { active: true });
        await chrome.windows.update(dashTab.windowId, { focused: true });
      } catch (_) {
        chrome.tabs.create({ url: 'http://localhost:4000/' });
      }
      return { success: true };
    }

    // ── Portal notifies extension that profiles were updated ──
    case 'PORTAL_PROFILES_UPDATED': {
      if (message.profiles) {
        await storageSet(STORAGE_PROFILES_KEY, message.profiles);
        console.log('[FormSarthi BG] Profiles cache updated from portal:', message.profiles.length, 'profiles');
      }
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ────────────────────────────────────────────────────────────
// PORTAL PROFILE SCRAPER
// Asks the portal tab's content script to read IndexedDB
// and return profile metadata (NOT encrypted blobs — those
// are fetched when a specific profile is selected).
// ────────────────────────────────────────────────────────────
async function getProfilesFromPortal() {
  let portalTabs = await getPortalTabs();

  if (portalTabs.length === 0) {
    // No portal tab open — return empty so popup shows "Open Portal"
    return { success: true, profiles: [] };
  }

  for (const tab of portalTabs) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ALL_PROFILES_IDB' });
      if (resp && resp.success && Array.isArray(resp.profiles)) {
        // Cache for offline use
        await storageSet(STORAGE_PROFILES_KEY, resp.profiles);
        return { success: true, profiles: resp.profiles };
      }
    } catch (e) {
      // Content script not ready on this tab, try next
    }
  }

  return { success: true, profiles: [] };
}

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────
async function getPortalTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => {
    try {
      if (!tab.url) return false;
      const u = new URL(tab.url);
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      const isPort  = u.port === '3000' || u.port === '4000';
      return isLocal && isPort;
    } catch { return false; }
  });
}

async function getDashboardTab() {
  const tabs = await getPortalTabs();
  if (tabs.length === 0) throw new Error('FormSarthi portal tab not found.');
  return tabs[0];
}

function storageGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, result => resolve(result[key] ?? null));
  });
}

function storageSet(key, value) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ────────────────────────────────────────────────────────────
// DIRECT AUTOFILL INJECTOR (fallback when content.js not loaded)
// This function runs inside the target page's context.
// It is a complete, self-contained autofill engine.
// ────────────────────────────────────────────────────────────
function fillFormPageDirect(profile) {
  if (!profile) return 0;

  function getLabelText(el) {
    if (!el) return '';
    let text = '';
    text += (el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ';
    const ariaLB = el.getAttribute('aria-labelledby');
    if (ariaLB) {
      ariaLB.split(/\s+/).forEach(id => {
        const t = document.getElementById(id);
        if (t) text += ' ' + t.textContent;
      });
    }
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) text += ' ' + lbl.textContent;
    }
    const pLabel = el.closest('label');
    if (pLabel) text += ' ' + pLabel.textContent;
    let parent = el.parentElement;
    for (let i = 0; i < 6 && parent; i++) {
      if (parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
      const sibs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]),textarea,select');
      if (sibs.length > 1) break;
      if (parent.textContent) text += ' ' + parent.textContent;
      parent = parent.parentElement;
    }
    return text.trim();
  }

  function matchField(t, profile) {
    const lc = t.toLowerCase().replace(/[*:]/g, '').trim();
    if (lc.includes('father'))   return profile.father_name || '';
    if (lc.includes('mother'))   return profile.mother_name || '';
    if (lc.includes('guardian')) return profile.guardian_name || profile.father_name || '';
    if (lc.includes('date of birth') || lc === 'dob' || lc.includes('birth date') || lc.includes('d.o.b')) return profile.dob || '';
    if (lc === 'gender' || lc === 'sex') return profile.gender || '';
    if (lc.includes('caste') || lc.includes('category')) return profile.caste || '';
    if (lc.includes('marital')) return profile.marital_status || '';
    if (lc === 'name' || lc === 'full name' || lc.includes('candidate name') || lc.includes('applicant name') || lc.includes('student name') || lc.includes('your name')) return profile.name || '';
    if (lc.includes('alternate') && lc.includes('mobile')) return profile.alt_phone || '';
    if (lc.includes('mobile') || lc.includes('phone') || lc.includes('contact no') || lc.includes('cell')) return profile.phone || '';
    if (lc.includes('whatsapp')) return profile.phone || '';
    if (lc.includes('email') || lc.includes('e-mail')) return profile.email || '';
    if (lc.includes('pincode') || lc.includes('pin code') || lc.includes('postal') || lc.includes('zip')) return profile.pincode || '';
    if (lc.includes('district') || (lc.includes('city') && !lc.includes('address'))) return profile.city || '';
    if (lc === 'state' || lc.includes('state/ut')) return profile.state || '';
    if (lc.includes('address') || lc.includes('residence')) return profile.address || '';
    if (lc.includes('country')) return profile.country || 'India';
    if (lc.includes('10th') || lc.includes('class x') || lc.includes('ssc') || lc.includes('matriculation') || lc.includes('class 10')) {
      if (lc.includes('roll'))  return profile.roll_10 || '';
      if (lc.includes('board')) return profile.board_10 || '';
      if (lc.includes('mark') || lc.includes('percent') || lc.includes('score')) return profile.marks_10 || '';
      return profile.marks_10 || '';
    }
    if (lc.includes('12th') || lc.includes('class xii') || lc.includes('hsc') || lc.includes('intermediate') || lc.includes('class 12')) {
      if (lc.includes('roll'))  return profile.roll_12 || '';
      if (lc.includes('board')) return profile.board_12 || '';
      if (lc.includes('mark') || lc.includes('percent') || lc.includes('score')) return profile.marks_12 || '';
      return profile.marks_12 || '';
    }
    if (lc.includes('college') || lc.includes('institution')) return profile.college || '';
    if (lc.includes('degree') || lc.includes('course') || lc.includes('program')) return profile.degree || '';
    if (lc.includes('aadhaar') || lc.includes('aadhar') || lc.includes('uid')) return profile.aadhaar || '';
    if (lc.includes('pan card') || lc.includes('pan no') || lc.includes('permanent account')) return profile.pan || '';
    if (lc.includes('ifsc')) return profile.ifsc || '';
    if (lc.includes('account number') || lc.includes('account no') || lc.includes('a/c')) return profile.account_no || '';
    if (lc.includes('bank name') || lc.includes('name of bank')) return profile.bank_name || '';
    if (lc.includes('nationality')) return profile.nationality || 'Indian';
    if (lc.includes('religion')) return profile.religion || '';
    if (lc.includes('blood group') || lc.includes('blood type')) return profile.blood_group || '';
    return null;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.trim().replace(/[\s.\-]+/g, '/').split('/');
    if (parts.length === 3) {
      const p = parts.map(Number);
      if (p[0] > 1000) return `${p[0]}-${String(p[1]).padStart(2,'0')}-${String(p[2]).padStart(2,'0')}`;
      if (p[1] <= 12 && p[0] <= 31) {
        const y = p[2] < 100 ? (p[2] > 50 ? 1900 : 2000) + p[2] : p[2];
        return `${y}-${String(p[1]).padStart(2,'0')}-${String(p[0]).padStart(2,'0')}`;
      }
    }
    try { const d = new Date(dateStr); if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } catch(_){}
    return dateStr;
  }

  let filled = 0;
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]),textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;

  inputs.forEach(input => {
    const typeStr = (input.type||'').toLowerCase();
    const combo   = `${input.name||''} ${input.id||''} ${input.placeholder||''}`.toLowerCase();
    if (typeStr === 'search' || /search|query|^q$/.test(combo)) return;

    const label = getLabelText(input);
    let value   = matchField(label, profile);

    if (!value && profile.customFields) {
      const hint = label.toLowerCase();
      for (const cf of profile.customFields) {
        if (hint.includes(cf.label.toLowerCase()) || hint.includes(cf.key.toLowerCase())) {
          value = profile[cf.key];
          if (value) break;
        }
      }
    }

    if (value) {
      const final = input.type === 'date' ? formatDate(value) : value;
      if (setter) setter.call(input, final); else input.value = final;
      ['input','change','focus','blur'].forEach(ev => input.dispatchEvent(new Event(ev, { bubbles:true })));
      filled++;
    }
  });

  // Select dropdowns
  document.querySelectorAll('select').forEach(sel => {
    const label = getLabelText(sel);
    const value = matchField(label, profile);
    if (!value) return;
    Array.from(sel.options).forEach(opt => {
      if (opt.text.toLowerCase().includes(value.toLowerCase()) ||
          value.toLowerCase().includes(opt.text.toLowerCase())) {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles:true }));
          filled++;
        }
      }
    });
  });

  // Google Forms ARIA radios
  document.querySelectorAll('[role="radio"]').forEach(radio => {
    const radioText = radio.getAttribute('data-value') || radio.innerText?.trim();
    const qDiv = radio.closest('[role="listitem"]');
    if (!qDiv) return;
    const heading = qDiv.querySelector('[role="heading"]');
    if (!heading) return;
    const fieldLabel = heading.innerText.trim();
    const val = matchField(fieldLabel, profile);
    if (val && radioText && radioText.toLowerCase().includes(val.toLowerCase())) {
      if (radio.getAttribute('aria-checked') !== 'true') { radio.click(); filled++; }
    }
  });

  // Native radio buttons
  document.querySelectorAll('input[type="radio"]').forEach(radio => {
    const fieldLabel = getLabelText(radio.closest('fieldset') || radio.closest('[role="group"]') || radio.parentElement?.parentElement || radio.parentElement);
    const val = matchField(fieldLabel, profile);
    if (val && (radio.value.toLowerCase() === val.toLowerCase() || radio.value.toLowerCase().includes(val.toLowerCase()))) {
      if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles:true })); filled++; }
    }
  });

  return filled;
}
