// =============================================================
// chrome-extension/background.js  (MV3 Service Worker)  v3.0
//
// Session Architecture:
//  - chrome.storage.session  → vault session (auto-cleared on browser restart)
//  - chrome.storage.local    → profile metadata cache (persists)
//
// Lock Triggers (all handled here):
//  1. Popup closes          → port disconnect → clear session
//  2. Any tab reloads       → tabs.onUpdated → clear session
//  3. Browser restarts      → chrome.storage.session auto-cleared
//  4. Manual lock           → LOCK_VAULT message
//  5. Portal logout         → PORTAL_LOGOUT message
// =============================================================

const STORAGE_PROFILES_KEY = 'fs_ext_profiles';
const SESSION_KEY           = 'fs_vault_session';

// Port and Tab tracking logic has been simplified to allow persistent sessions.
// Vault is locked only on timeout, manual lock, portal logout, or browser restart.

// ────────────────────────────────────────────────────────────
// CLEAR VAULT SESSION
// ────────────────────────────────────────────────────────────
async function clearVaultSession() {
  const session = await getVaultSession();
  if (session) {
    console.log('[FormSarthi] Destroying unlocked vault session');
  }
  await chrome.storage.session.remove([
    SESSION_KEY,
    'vaultUnlocked',
    'activeProfile',
    'decryptedProfileData'
  ]);
}

async function getVaultSession() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    return result[SESSION_KEY] ?? null;
  } catch (_) {
    return null;
  }
}

async function setVaultSession(data) {
  await chrome.storage.session.set({
    [SESSION_KEY]: data,
    'vaultUnlocked': true,
    'activeProfile': data.profile,
    'decryptedProfileData': data.decryptedData
  });
  console.log('[FormSarthi] Vault unlocked');
}

// ────────────────────────────────────────────────────────────
// MESSAGE DISPATCHER
// ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    // ── Save vault session (called by popup after successful unlock) ──
    case 'SAVE_VAULT_SESSION': {
      let activeTabId = message.activeTabId;
      if (!activeTabId) {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          activeTabId = activeTab?.id || null;
        } catch (_) {}
      }
      await setVaultSession({
        profile:       message.profile,
        decryptedData: message.decryptedData,
        expiry:        Date.now() + (15 * 60 * 1000),
        activeTabId:   activeTabId,
      });
      return { success: true };
    }

    // ── Read vault session (called by popup on open) ──
    case 'GET_VAULT_SESSION': {
      const session = await getVaultSession();
      if (session && session.expiry > Date.now()) {
        return { success: true, session };
      }
      await clearVaultSession();
      return { success: false, reason: 'locked' };
    }

    // ── Manual lock (lock button or timeout) ──
    case 'LOCK_VAULT': {
      await clearVaultSession();
      return { success: true };
    }

    // ── Portal logout signal ──
    case 'PORTAL_LOGOUT': {
      await clearVaultSession();
      await chrome.storage.local.remove(STORAGE_PROFILES_KEY);
      return { success: true };
    }

    // ── Pull profile list from portal's IndexedDB ──
    case 'GET_PROFILES_FROM_PORTAL': {
      return await getProfilesFromPortal();
    }

    // ── FILL_FORM: profile data comes directly from popup ──
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

        let filledCount = 0;
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'FILL_PAGE', profile });
          if (response && response.success) {
            filledCount = response.count;
          } else {
            throw new Error('Content script response failed');
          }
        } catch (_) {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func:   fillFormPageDirect,
            args:   [profile],
          });
          filledCount = results?.[0]?.result ?? 0;
        }
        return { success: true, filledCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // ── Legacy GET_PROFILE (used by content.js floating tracker) ──
    case 'GET_PROFILE': {
      try {
        const session = await getVaultSession();
        if (session && session.decryptedData && session.expiry > Date.now()) {
          const profile   = session.decryptedData;
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
        return { success: false, error: 'Vault locked.' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'CHECK_DRAFT_RESTORE': {
      try {
        const dashTab  = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashTab.id, { type: 'GET_DRAFT_VALUES', url: message.url });
        return response || { success: false };
      } catch (err) { return { success: false, error: err.message }; }
    }

    case 'AUTO_SAVE_DRAFT': {
      try {
        const dashTab  = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashTab.id, { type: 'SAVE_DRAFT_DATA', draft: message.draft });
        return response || { success: false };
      } catch (err) { return { success: false, error: err.message }; }
    }

    case 'GET_FILE_DATA': {
      try {
        const dashTab  = await getDashboardTab();
        const response = await chrome.tabs.sendMessage(dashTab.id, { type: 'GET_DASHBOARD_FILE', docKey: message.docKey });
        return response || { success: false };
      } catch (err) { return { success: false, error: err.message }; }
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

    case 'PORTAL_PROFILES_UPDATED': {
      if (message.profiles) {
        await storageLocalSet(STORAGE_PROFILES_KEY, message.profiles);
        console.log('[FormSarthi BG] Profiles cache updated:', message.profiles.length, 'profile(s)');
      }
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

// ────────────────────────────────────────────────────────────
// PORTAL PROFILE SCRAPER
// ────────────────────────────────────────────────────────────
async function getProfilesFromPortal() {
  const portalTabs = await getPortalTabs();
  if (portalTabs.length === 0) return { success: true, profiles: [] };

  for (const tab of portalTabs) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ALL_PROFILES_IDB' });
      if (resp?.success && Array.isArray(resp.profiles)) {
        await storageLocalSet(STORAGE_PROFILES_KEY, resp.profiles);
        return { success: true, profiles: resp.profiles };
      }
    } catch (_) {}
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
      const u      = new URL(tab.url);
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

function storageLocalGet(key) {
  return new Promise(resolve => chrome.storage.local.get(key, r => resolve(r[key] ?? null)));
}
function storageLocalSet(key, value) {
  return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
}

// ────────────────────────────────────────────────────────────
// DIRECT AUTOFILL INJECTOR (fallback when content.js not loaded)
// Self-contained — runs inside the target page context.
// ────────────────────────────────────────────────────────────
function fillFormPageDirect(profile) {
  if (!profile) return 0;

  const DEBUG = true;
  const log = (...a) => { if (DEBUG) console.log('[FormSarthi AF]', ...a); };

  // ── Normalize label text ──
  function norm(t) {
    return (t || '').toLowerCase()
      .replace(/[*:\u2022\u2013\u2014]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Get label context for an element ──
  function getLabelText(el) {
    if (!el) return '';
    let text = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')].filter(Boolean).join(' ');

    // aria-labelledby
    const alb = el.getAttribute('aria-labelledby');
    if (alb) alb.split(/\s+/).forEach(id => {
      const t = document.getElementById(id); if (t) text += ' ' + t.textContent;
    });

    // label[for]
    if (el.id) {
      try { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) text += ' ' + l.textContent; } catch (_) {}
    }
    const pl = el.closest('label'); if (pl) text += ' ' + pl.textContent;

    // Google Forms: walk up to [role="listitem"] and grab heading
    const listitem = el.closest('[role="listitem"], .freebirdFormviewerViewItemsItemItem, .Qr7Oae');
    if (listitem) {
      const heading = listitem.querySelector('[role="heading"], .M7eMe, .freebirdFormviewerViewItemsTextTextItemTitle, .exportItemTitle');
      if (heading) text += ' ' + heading.textContent;
    } else {
      // General DOM traversal
      let parent = el.parentElement;
      for (let i = 0; i < 7 && parent; i++) {
        if (/^(FORM|BODY|HTML)$/.test(parent.tagName)) break;
        const sibs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]),textarea,select');
        if (sibs.length > 1) break;
        text += ' ' + parent.textContent;
        parent = parent.parentElement;
      }
    }
    return norm(text);
  }

  // ── Field matcher ──
  function matchField(t, p) {
    if (!t) return null;
    if (t.includes('father'))           return p.father_name || '';
    if (t.includes('mother'))           return p.mother_name || '';
    if (t.includes('guardian'))         return p.guardian_name || p.father_name || '';
    if (t.includes('husband'))          return p.husband_name || '';
    if (t.includes('date of birth') || t === 'dob' || t.includes('birth date') || t.includes('d.o.b') || t.includes('जन्म'))
                                        return p.dob || '';
    if (t === 'gender' || t === 'sex' || t.includes('gender of'))
                                        return p.gender || '';
    if (t.includes('caste') || t.includes('category') || t.includes('social category'))
                                        return p.caste || '';
    if (t.includes('marital'))          return p.marital_status || '';
    // Name — AFTER all relationship fields to avoid "father name" → name
    if (t === 'name' || t.includes('full name') || t.includes('full_name') ||
        t.includes('candidate name') || t.includes('applicant name') ||
        t.includes('student name') || t.includes('name of') || t.includes('your name'))
                                        return p.name || '';
    if (t.includes('alternate') && t.includes('mobile')) return p.alt_phone || '';
    if (t.includes('mobile') || t.includes('phone') || t.includes('contact no') || t.includes('cell') || t.includes('whatsapp'))
                                        return p.phone || '';
    if (t.includes('email') || t.includes('e-mail') || t.includes('ईमेल'))
                                        return p.email || '';
    if (t.includes('pincode') || t.includes('pin code') || t.includes('postal') || t.includes('zip'))
                                        return p.pincode || '';
    if (t.includes('district') || (t.includes('city') && !t.includes('address')))
                                        return p.city || '';
    if (t === 'state' || t.includes('state/ut') || t.includes('राज्य'))
                                        return p.state || '';
    if (t.includes('address') || t.includes('पता') || t.includes('residence'))
                                        return p.address || '';
    if (t.includes('country'))          return p.country || 'India';
    // Education — 10th
    if (t.includes('10th') || t.includes('class x') || t.includes('ssc') || t.includes('matriculation') || t.includes('class 10')) {
      if (t.includes('roll'))  return p.roll_10 || '';
      if (t.includes('board')) return p.board_10 || '';
      if (t.includes('year') || t.includes('passing')) return p.year_10 || '';
      if (t.includes('mark') || t.includes('percent') || t.includes('score') || t.includes('%')) return p.percentage_10 || p.marks_10 || '';
      return p.marks_10 || '';
    }
    // Education — 12th
    if (t.includes('12th') || t.includes('class xii') || t.includes('hsc') || t.includes('intermediate') || t.includes('class 12')) {
      if (t.includes('roll'))  return p.roll_12 || '';
      if (t.includes('board')) return p.board_12 || '';
      if (t.includes('year') || t.includes('passing')) return p.year_12 || '';
      if (t.includes('stream') || t.includes('subject')) return p.stream || '';
      if (t.includes('mark') || t.includes('percent') || t.includes('score') || t.includes('%')) return p.percentage_12 || p.marks_12 || '';
      return p.marks_12 || '';
    }
    if (t.includes('college name') || t.includes('name of college') || t.includes('institution')) return p.college || '';
    if (t.includes('school name') || t.includes('name of school')) return p.school || '';
    if (t.includes('university'))       return p.university || p.college || '';
    if (t.includes('degree') || t.includes('course') || t.includes('program'))
                                        return p.degree || '';
    if (t.includes('stream') || t.includes('branch')) return p.stream || '';
    if (t.includes('aadhaar') || t.includes('aadhar') || t.includes('uid'))
                                        return p.aadhaar || '';
    if (t.includes('pan card') || t.includes('pan no') || t.includes('permanent account'))
                                        return p.pan || '';
    if (t.includes('voter') || t.includes('epic'))  return p.voter_id || '';
    if (t.includes('ifsc'))             return p.ifsc || '';
    if (t.includes('account number') || t.includes('account no') || t.includes('a/c'))
                                        return p.account_no || '';
    if (t.includes('bank name') || t.includes('name of bank'))
                                        return p.bank_name || '';
    if (t.includes('nationality'))      return p.nationality || 'Indian';
    if (t.includes('religion'))         return p.religion || '';
    if (t.includes('blood group') || t.includes('blood type'))
                                        return p.blood_group || '';
    if (t.includes('income') || t.includes('annual income')) return p.income || '';
    if (t.includes('domicile'))         return p.domicile_state || p.state || '';
    return null;
  }

  // ── Format date for date inputs ──
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const clean  = dateStr.trim().replace(/[\s.\-]+/g, '/');
    const parts  = clean.split('/');
    if (parts.length === 3) {
      const n = parts.map(Number);
      if (n[0] > 1000) return `${n[0]}-${String(n[1]).padStart(2,'0')}-${String(n[2]).padStart(2,'0')}`;
      if (n[1] <= 12 && n[0] <= 31) {
        const y = n[2] < 100 ? (n[2] > 50 ? 1900 : 2000) + n[2] : n[2];
        return `${y}-${String(n[1]).padStart(2,'0')}-${String(n[0]).padStart(2,'0')}`;
      }
    }
    try { const d = new Date(dateStr); if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } catch (_) {}
    return dateStr;
  }

  // ── Native input setter (triggers React/Angular state) ──
  const inputSetter    = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,  'value')?.set;
  const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;

  function fillInput(input, value) {
    const finalVal = input.type === 'date' ? formatDate(value) : value;
    const setter   = input.tagName === 'TEXTAREA' ? textareaSetter : inputSetter;
    if (setter) setter.call(input, finalVal); else input.value = finalVal;
    // Dispatch full event chain for React / Google Forms
    input.dispatchEvent(new Event('focus',  { bubbles: true }));
    input.dispatchEvent(new InputEvent('input',  { bubbles: true, data: finalVal, inputType: 'insertText' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',  { bubbles: true }));
    input.dispatchEvent(new Event('blur',   { bubbles: true }));
    // Verify
    return input.value === finalVal || (input.value && input.value.length > 0);
  }

  let filled = 0;

  // ── PASS 1: Google Forms — container-based approach ──
  const gfContainers = document.querySelectorAll(
    '[role="listitem"], .freebirdFormviewerViewItemsItemItem, .Qr7Oae, [jsmodel][data-params]'
  );

  if (gfContainers.length > 0) {
    log(`Google Forms mode: ${gfContainers.length} question(s) found`);
    gfContainers.forEach(container => {
      const titleEl = container.querySelector(
        '[role="heading"], .M7eMe, .freebirdFormviewerViewItemsTextTextItemTitle, .exportItemTitle, h2, h3, h4'
      );
      if (!titleEl) return;
      const questionText = norm(titleEl.textContent);
      let value = matchField(questionText, profile);

      if (!value && profile.customFields) {
        for (const cf of profile.customFields) {
          if (questionText.includes(cf.label.toLowerCase()) || questionText.includes(cf.key.toLowerCase())) {
            value = profile[cf.key]; if (value) break;
          }
        }
      }

      if (!value) { log(`  ✗ "${questionText.slice(0,40)}" → no match`); return; }

      const input = container.querySelector(
        'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], textarea'
      );
      if (!input || input.disabled || input.readOnly) return;

      const ok = fillInput(input, value);
      if (ok) {
        log(`  ✓ "${questionText.slice(0,40)}" → "${value}"`);
        filled++;
      } else {
        log(`  ✗ "${questionText.slice(0,40)}" → fill failed`);
      }
    });
  }

  // ── PASS 2: Standard HTML inputs (non-Google-Forms) ──
  const standardInputs = document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]):not([type=image]):not([type=reset]),textarea'
  );
  const filledEls = new Set();

  standardInputs.forEach(input => {
    if (filledEls.has(input)) return;
    const typeStr = (input.type || '').toLowerCase();
    const combo   = `${input.name || ''} ${input.id || ''} ${input.placeholder || ''}`.toLowerCase();
    if (typeStr === 'search' || /search|query|^q$/.test(combo)) return;

    const labelText = getLabelText(input);
    let value = matchField(labelText, profile);

    if (!value && profile.customFields) {
      for (const cf of profile.customFields) {
        const hint = norm(cf.label + ' ' + cf.key);
        if (labelText.includes(hint) || labelText.includes(cf.key.toLowerCase())) {
          value = profile[cf.key]; if (value) break;
        }
      }
    }

    if (value) {
      const ok = fillInput(input, value);
      if (ok) {
        log(`  ✓ std "${labelText.slice(0,40)}" → "${value}"`);
        filledEls.add(input);
        filled++;
      }
    }
  });

  // ── PASS 3: Select dropdowns ──
  document.querySelectorAll('select').forEach(sel => {
    const label = getLabelText(sel);
    const value = matchField(label, profile);
    if (!value) return;
    Array.from(sel.options).forEach(opt => {
      const optLc  = opt.text.toLowerCase();
      const valLc  = value.toLowerCase();
      if (optLc.includes(valLc) || valLc.includes(optLc)) {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
          log(`  ✓ select "${label.slice(0,30)}" → "${opt.text}"`);
        }
      }
    });
  });

  // ── PASS 4: Google Forms ARIA radios ──
  document.querySelectorAll('[role="radio"]').forEach(radio => {
    const radioText = radio.getAttribute('data-value') || radio.innerText?.trim();
    const qDiv      = radio.closest('[role="listitem"]');
    if (!qDiv) return;
    const heading = qDiv.querySelector('[role="heading"], .M7eMe');
    if (!heading) return;
    const fieldLabel = norm(heading.innerText);
    const val        = matchField(fieldLabel, profile);
    if (val && radioText && norm(radioText).includes(val.toLowerCase())) {
      if (radio.getAttribute('aria-checked') !== 'true') { radio.click(); filled++; }
    }
  });

  // ── PASS 5: Native radio buttons ──
  document.querySelectorAll('input[type="radio"]').forEach(radio => {
    const fieldLabel = getLabelText(
      radio.closest('fieldset') || radio.closest('[role="group"]') ||
      radio.parentElement?.parentElement || radio.parentElement
    );
    const val = matchField(fieldLabel, profile);
    if (val && (radio.value.toLowerCase() === val.toLowerCase() || radio.value.toLowerCase().includes(val.toLowerCase()))) {
      if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); filled++; }
    }
  });

  log(`Autofill complete: ${filled} field(s) filled`);
  return filled;
}

// ────────────────────────────────────────────────────────────
// TAB LIFECYCLE MONITORING
// ────────────────────────────────────────────────────────────
console.log('[FormSarthi] Monitoring active form tab');

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const session = await getVaultSession();
  const isBoundTab = session && session.activeTabId === tabId;
  const isFormUrl = tab.url && (tab.url.includes('docs.google.com/forms') || tab.url.includes('forms.gle'));

  if (changeInfo.status === 'loading') {
    if (isBoundTab || isFormUrl) {
      console.log('[FormSarthi] Form page refresh detected');
      await clearVaultSession();
      try {
        chrome.runtime.sendMessage({ type: 'FORCE_LOCK_VAULT' });
      } catch (_) {}
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const session = await getVaultSession();
  if (session && session.activeTabId === tabId) {
    await clearVaultSession();
    try {
      chrome.runtime.sendMessage({ type: 'FORCE_LOCK_VAULT' });
    } catch (_) {}
  }
});

