// =============================================================
// chrome-extension/popup.js  v3.0
//
// Session Architecture:
//  - Uses chrome.storage.session via background (SAVE/GET_VAULT_SESSION)
//  - Connects port to background → popup close = instant lock
//  - Password: max 8 chars, alphanumeric only, auto-submits at 8 chars
//  - Enter key also submits at any length
//  - Wrong password → shake animation, clear input, re-focus
// =============================================================

/* ── Constants ── */
const SALT_SUFFIX    = 'FormSarthiSalt2026';
const PBKDF2_KEYSIZE = 256 / 32;
const PBKDF2_ITERS   = 1000;
const STORAGE_PROFILES_KEY = 'fs_ext_profiles';

/* ── State ── */
let _profiles        = [];
let _selectedProfile = null;
let _decryptedData   = null;
let _theme           = 'dark';
let _bgPort          = null;   // port to background (disconnect = lock)

/* ── Screens ── */
const screens = {
  profiles: document.getElementById('screen-profiles'),
  unlock:   document.getElementById('screen-unlock'),
  review:   document.getElementById('screen-review'),
};

/* ── Masked logger ── */
const LOG = {
  info:  (...a) => console.log   ('[FormSarthi]', ...a),
  warn:  (...a) => console.warn  ('[FormSarthi]', ...a),
  error: (...a) => console.error ('[FormSarthi]', ...a),
  mask:  (v)    => { const s = String(v||''); return s.length<=3?'***':'*'.repeat(s.length-3)+s.slice(-3); },
};

// ────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────
function showLoadingState() {
  showScreen('profiles');
  document.getElementById('profiles-loading').style.display = 'flex';
  document.getElementById('profiles-empty').style.display   = 'none';
  document.getElementById('profiles-list').style.display    = 'none';
}

function renderProfiles(profiles) {
  _profiles = profiles;
  const container = document.getElementById('profiles-container');
  if (container) container.innerHTML = '';
  renderProfileList();
  document.getElementById('profiles-loading').style.display = 'none';
  document.getElementById('profiles-list').style.display    = 'block';
}

function renderNoProfiles() {
  document.getElementById('profiles-loading').style.display = 'none';
  showEmptyState('Open the FormSarthi portal, create a profile, then come back here.');
}

async function initializePopup() {
  console.log('[FormSarthi] Popup mounted');
  console.log('[FormSarthi] Popup boot started');
  showLoadingState();

  // Sanity check CryptoJS
  if (typeof CryptoJS === 'undefined') {
    showScreen('profiles');
    document.getElementById('profiles-loading').style.display = 'none';
    showEmptyState('❌ CryptoJS missing — reinstall extension.');
    return;
  }

  _theme = (await localGet('fs_ext_theme')) || 'dark';
  applyTheme(_theme);

  wirePasswordField();
  await tryRestoreSession();
}

document.addEventListener('DOMContentLoaded', initializePopup);

// ────────────────────────────────────────────────────────────
// PASSWORD FIELD WIRING
// ────────────────────────────────────────────────────────────
function wirePasswordField() {
  const pwdInput  = document.getElementById('password-input');
  const toggleBtn = document.getElementById('btn-toggle-pass');

  // Show/hide toggle
  if (toggleBtn && pwdInput) {
    toggleBtn.addEventListener('click', () => {
      const hidden = pwdInput.type === 'password';
      pwdInput.type = hidden ? 'text' : 'password';
      document.getElementById('eye-open').style.display   = hidden ? 'none'  : 'block';
      document.getElementById('eye-closed').style.display = hidden ? 'block' : 'none';
    });
  }

  // Real-time: allow only alphanumeric, cap at 8 chars
  pwdInput.addEventListener('input', async (e) => {
    // Strip illegal chars inline
    const clean = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    if (e.target.value !== clean) e.target.value = clean;

    // Clear previous error when user starts typing
    setPasswordError('');

    // Auto-submit when exactly 8 chars entered
    if (clean.length === 8) {
      LOG.info('Auto-submit at 8 chars');
      await attemptUnlock(clean);
    }
  });

  // Enter key → submit at any length
  pwdInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = pwdInput.value;
      if (val.length > 0) await attemptUnlock(val);
    }
  });

  // Unlock button
  document.getElementById('btn-unlock-pass').addEventListener('click', async () => {
    const val = document.getElementById('password-input').value;
    if (val.length === 0) { setPasswordError('Enter your password.'); return; }
    await attemptUnlock(val);
  });
}

// ────────────────────────────────────────────────────────────
// SESSION RESTORE
// ────────────────────────────────────────────────────────────
async function tryRestoreSession() {
  // Ask background for live session (background reads chrome.storage.session)
  try {
    const resp = await bgMessage({ type: 'GET_VAULT_SESSION' });
    if (resp?.success && resp.session?.decryptedData) {
      const pName = resp.session.profile?.name || resp.session.profile?.email?.split('@')[0] || 'Unknown';
      LOG.info(`Session found: true`);
      LOG.info(`Active profile: ${pName}`);
      LOG.info(`Session valid: true`);
      LOG.info(`Rendering unlocked vault UI`);

      _decryptedData   = resp.session.decryptedData;
      _selectedProfile = resp.session.profile;
      populateReviewScreen(_selectedProfile, _decryptedData);
      showScreen('review');
      return;
    }
  } catch (e) {
    LOG.warn('Session restore failed:', e.message);
  }

  LOG.info(`Session found: false`);
  LOG.info(`Rendering locked profile selector`);
  await loadProfiles();
}

// ────────────────────────────────────────────────────────────
// PROFILE LIST
// ────────────────────────────────────────────────────────────
async function loadProfiles() {
  console.log('[FormSarthi] Fetching profiles');
  try {
    const result = await chrome.storage.local.get(null);
    console.log('[FormSarthi] Raw storage result:', result);
    console.log('[FormSarthi] Storage payload:', result);

    const possibleKeys = [
      'fs_ext_profiles',
      'formsarthiProfiles',
      'fs_profiles',
      'profiles',
      'userProfiles',
      'vaultProfiles'
    ];

    let profiles = [];
    for (const key of possibleKeys) {
      if (result[key]) {
        profiles = result[key];
        console.log(`[FormSarthi] Profiles detected under key: ${key}`, profiles);
        break;
      }
    }

    // Fallback: search the entire storage object for any key containing profile-like arrays or objects
    if (!profiles || (Array.isArray(profiles) && profiles.length === 0)) {
      for (const key in result) {
        const val = result[key];
        if (Array.isArray(val) && val.length > 0 && val[0].email) {
          profiles = val;
          console.log(`[FormSarthi] Auto-detected profiles under array key: ${key}`, profiles);
          break;
        }
        if (val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length > 0) {
          const firstVal = Object.values(val)[0];
          if (firstVal && typeof firstVal === 'object' && firstVal.email) {
            profiles = val;
            console.log(`[FormSarthi] Auto-detected profiles under object key: ${key}`, profiles);
            break;
          }
        }
      }
    }

    // Handle both array and object formats
    let profileList = [];
    if (Array.isArray(profiles)) {
      profileList = profiles;
    } else if (profiles && typeof profiles === 'object') {
      profileList = Object.values(profiles);
    }

    console.log('[FormSarthi] Parsed profiles:', profileList);
    console.log('[FormSarthi] Final parsed profiles:', profileList);

    if (profileList.length > 0) {
      console.log('[FormSarthi] Rendering profiles now');
      console.log('[FormSarthi] Rendering profiles UI');
      renderProfiles(profileList);
    } else {
      console.log('[FormSarthi] No profiles found');
      renderNoProfiles();
    }
  } catch (err) {
    console.error('[FormSarthi] Popup crash:', err);
    console.error('[FormSarthi] Popup init failed:', err);
    renderNoProfiles();
  }
}

const COLOR_MAP = {
  purple: 'linear-gradient(135deg,#8b5cf6,#a78bfa)',
  green:  'linear-gradient(135deg,#10b981,#34d399)',
  amber:  'linear-gradient(135deg,#f59e0b,#fbbf24)',
  red:    'linear-gradient(135deg,#ef4444,#f87171)',
  blue:   'linear-gradient(135deg,#3b82f6,#60a5fa)',
  slate:  'linear-gradient(135deg,#64748b,#94a3b8)',
};

function renderProfileList() {
  const container = document.getElementById('profiles-container');
  container.innerHTML = '';

  _profiles.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    const bg   = COLOR_MAP[p.color] || COLOR_MAP.purple;
    const name = p.name || p.email?.split('@')[0] || 'Profile';
    const pct  = p.completionPct || 0;

    card.innerHTML = `
      <div class="pc-avatar" style="background:${bg}">${escHtml(p.avatar || '🪪')}</div>
      <div class="pc-info">
        <div class="pc-name">${escHtml(name)}</div>
        <div class="pc-email">${escHtml(p.email)}</div>
        <div class="pc-pct">Vault <span>${pct}%</span> complete</div>
      </div>
      <div class="pc-locked-badge">🔒 Locked</div>
      <div class="pc-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>`;
    card.addEventListener('click', () => startUnlock(idx));
    container.appendChild(card);
  });
}

// ────────────────────────────────────────────────────────────
// UNLOCK SCREEN
// ────────────────────────────────────────────────────────────
function startUnlock(profileIdx) {
  _selectedProfile = _profiles[profileIdx];

  const avatarEl = document.getElementById('unlock-avatar');
  avatarEl.textContent      = _selectedProfile.avatar || '🪪';
  avatarEl.style.background = COLOR_MAP[_selectedProfile.color] || COLOR_MAP.purple;
  document.getElementById('unlock-name').textContent  = _selectedProfile.name || _selectedProfile.email.split('@')[0];
  document.getElementById('unlock-email').textContent = _selectedProfile.email;

  setPasswordError('');
  document.getElementById('password-input').value = '';

  showScreen('unlock');
  setTimeout(() => document.getElementById('password-input')?.focus(), 150);
}

// ────────────────────────────────────────────────────────────
// DECRYPT + UNLOCK
// ────────────────────────────────────────────────────────────
async function attemptUnlock(passwordRaw) {
  if (!_selectedProfile?.encryptedProfile) {
    setPasswordError('No vault found. Save your profile in the portal first.');
    return;
  }

  const password = String(passwordRaw); // no trim — preserve exact input
  const btn = document.getElementById('btn-unlock-pass');

  // Show unlocking state
  btn.disabled    = true;
  btn.textContent = 'Unlocking…';
  document.getElementById('password-input').disabled = true;
  setPasswordError('');

  LOG.info(`Unlock attempt — len:${password.length} masked:${LOG.mask(password)}`);

  try {
    const salt = CryptoJS.enc.Utf8.parse(_selectedProfile.email + SALT_SUFFIX);
    const key  = CryptoJS.PBKDF2(password, salt, { keySize: PBKDF2_KEYSIZE, iterations: PBKDF2_ITERS });

    const decryptedBytes = CryptoJS.AES.decrypt(_selectedProfile.encryptedProfile, key.toString());
    const decryptedText  = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedText || decryptedText.length < 2) {
      throw new Error('Empty decrypt — wrong password');
    }

    let vaultData;
    try { vaultData = JSON.parse(decryptedText); }
    catch (_) { throw new Error('Vault corrupted — re-save your profile in the portal'); }

    LOG.info('✅ Unlock SUCCESS — keys:', Object.keys(vaultData).slice(0,4).join(', '));

    _decryptedData = vaultData;

    // Query active tab to bind session
    let activeTabId = null;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabId = activeTab?.id || null;
    } catch (_) {}

    // Save session in background (stored in chrome.storage.session)
    await bgMessage({
      type:          'SAVE_VAULT_SESSION',
      profile:       _selectedProfile,
      decryptedData: _decryptedData,
      activeTabId:   activeTabId,
    });

    populateReviewScreen(_selectedProfile, _decryptedData);
    showScreen('review');

  } catch (err) {
    LOG.error('Unlock failed:', err.message);
    shakePasswordField();
    setPasswordError('Wrong password. Try again.');
    document.getElementById('password-input').value = '';
    setTimeout(() => document.getElementById('password-input')?.focus(), 100);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:16px;height:16px;flex-shrink:0"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Unlock`;
    document.getElementById('password-input').disabled = false;
  }
}

function setPasswordError(msg) {
  const el = document.getElementById('pin-error');
  el.textContent = msg;
}

function shakePasswordField() {
  const wrap = document.querySelector('.pass-field-group');
  if (!wrap) return;
  wrap.classList.remove('shake');
  void wrap.offsetWidth; // reflow to restart animation
  wrap.classList.add('shake');
  setTimeout(() => wrap.classList.remove('shake'), 500);
}

// ────────────────────────────────────────────────────────────
// REVIEW SCREEN
// ────────────────────────────────────────────────────────────
const FIELD_GROUPS = [
  { label:'Personal Info', icon:'👤', fields:[
    {key:'name',label:'Full Name'},{key:'father_name',label:"Father's Name"},
    {key:'mother_name',label:"Mother's Name"},{key:'dob',label:'Date of Birth'},
    {key:'gender',label:'Gender'},{key:'caste',label:'Category'},
    {key:'blood_group',label:'Blood Group'},{key:'nationality',label:'Nationality'},
    {key:'religion',label:'Religion'},{key:'marital_status',label:'Marital Status'},
  ]},
  { label:'Contact', icon:'📞', fields:[
    {key:'email',label:'Email'},{key:'phone',label:'Mobile'},
    {key:'address',label:'Address'},{key:'city',label:'City/District'},
    {key:'state',label:'State'},{key:'pincode',label:'PIN Code'},
  ]},
  { label:'Education', icon:'🎓', fields:[
    {key:'roll_10',label:'10th Roll'},{key:'board_10',label:'10th Board'},
    {key:'marks_10',label:'10th Marks'},{key:'roll_12',label:'12th Roll'},
    {key:'board_12',label:'12th Board'},{key:'marks_12',label:'12th Marks'},
    {key:'college',label:'College'},{key:'degree',label:'Degree'},{key:'grad_year',label:'Grad Year'},
  ]},
  { label:'Identity & Bank', icon:'🪪', fields:[
    {key:'aadhaar',label:'Aadhaar'},{key:'pan',label:'PAN Card'},
    {key:'bank_name',label:'Bank Name'},{key:'account_no',label:'Account No'},
    {key:'ifsc',label:'IFSC Code'},
  ]},
];

const ALL_KEYS = FIELD_GROUPS.flatMap(g => g.fields.map(f => f.key));

function populateReviewScreen(profile, data) {
  const avatarEl = document.getElementById('review-avatar');
  avatarEl.textContent      = profile.avatar || '🪪';
  avatarEl.style.background = COLOR_MAP[profile.color] || COLOR_MAP.purple;
  document.getElementById('review-name').textContent  = profile.name || profile.email.split('@')[0];
  document.getElementById('review-email').textContent = profile.email;

  const filled = ALL_KEYS.filter(k => data[k] && String(data[k]).trim()).length;
  const pct    = Math.round((filled / ALL_KEYS.length) * 100);
  const offset = 100.5 - (pct / 100) * 100.5;

  document.getElementById('ring-progress').setAttribute('stroke-dashoffset', offset.toFixed(1));
  document.getElementById('ring-pct').textContent          = `${pct}%`;
  document.getElementById('readiness-fill').style.width    = `${pct}%`;
  document.getElementById('readiness-pct-text').textContent = `${pct}%`;

  const groupsEl = document.getElementById('field-groups');
  groupsEl.innerHTML = '';
  const missingFields = [];

  FIELD_GROUPS.forEach(group => {
    const el = document.createElement('div');
    el.className = 'field-group';
    const ok = group.fields.filter(f => data[f.key] && String(data[f.key]).trim()).length;
    el.innerHTML = `<div class="field-group-header"><span class="group-icon">${group.icon}</span>${group.label}<span class="group-count ${ok === group.fields.length ? 'good' : ''}">${ok}/${group.fields.length}</span></div>`;

    const grid = document.createElement('div');
    grid.className = 'field-chips';
    group.fields.forEach(f => {
      const val  = data[f.key] ? String(data[f.key]).trim() : '';
      const chip = document.createElement('div');
      chip.className = 'field-chip';
      chip.innerHTML = `<div class="chip-key">${escHtml(f.label)}</div><div class="chip-val ${val?'has-val':'empty'}">${escHtml(val ? truncate(val, 16) : '—')}</div>`;
      grid.appendChild(chip);
      if (!val) missingFields.push(f.label);
    });
    el.appendChild(grid);
    groupsEl.appendChild(el);
  });

  const missSec   = document.getElementById('missing-section');
  const missChips = document.getElementById('missing-chips');
  if (missingFields.length > 0) {
    missSec.style.display = 'block';
    missChips.innerHTML   = missingFields.slice(0, 12).map(f => `<span class="missing-chip">${escHtml(f)}</span>`).join('');
  } else {
    missSec.style.display = 'none';
  }
}

// ────────────────────────────────────────────────────────────
// AUTOFILL
// ────────────────────────────────────────────────────────────
document.getElementById('btn-autofill').addEventListener('click', async () => {
  if (!_decryptedData) return;

  const btn = document.getElementById('btn-autofill');
  btn.disabled    = true;
  btn.textContent = 'Filling…';
  showFillMsg('⚡ Injecting fields…', 'info');

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('No active tab found');

    const result = await bgMessage({
      type:    'FILL_FORM',
      tabId:   activeTab.id,
      profile: _decryptedData,
    });

    const count = result?.filledCount ?? result?.fielledCount ?? 0;

    if (result?.success && count > 0) {
      showFillMsg(`✅ Filled ${count} field(s) successfully!`, 'success');
    } else if (result?.success) {
      showFillMsg('ℹ️ No matching fields found on this page.', 'info');
    } else {
      showFillMsg(result?.error || 'Autofill failed.', 'error');
    }
  } catch (err) {
    showFillMsg(err.message || 'Autofill error.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:16px;height:16px;flex-shrink:0"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Autofill This Page`;
  }
});

document.getElementById('btn-refresh').addEventListener('click', async () => {
  _decryptedData   = null;
  _selectedProfile = null;
  await bgMessage({ type: 'LOCK_VAULT' });
  await localRemove(STORAGE_PROFILES_KEY);

  // Clear other stale storage keys to clean up old mock profiles
  const staleKeys = [
    'formsarthiProfiles',
    'fs_profiles',
    'profiles',
    'userProfiles',
    'vaultProfiles'
  ];
  for (const key of staleKeys) {
    await localRemove(key);
  }

  // Ask portal to sync profiles (if portal tab is active)
  try {
    const resp = await bgMessage({ type: 'GET_PROFILES_FROM_PORTAL' });
    if (resp?.success && Array.isArray(resp.profiles) && resp.profiles.length > 0) {
      await localSet(STORAGE_PROFILES_KEY, resp.profiles);
    }
  } catch (e) {
    console.warn('[FormSarthi] Portal sync failed on refresh:', e.message);
  }

  await loadProfiles();
});

function showFillMsg(text, type) {
  const el = document.getElementById('fill-msg');
  el.textContent   = text;
  el.className     = `fill-msg ${type}`;
  el.style.display = 'block';
  setTimeout(() => { if (el) el.style.display = 'none'; }, 6000);
}

// ────────────────────────────────────────────────────────────
// LOCK — back to same profile's unlock screen (not list)
// ────────────────────────────────────────────────────────────
async function lockSession() {
  LOG.info('Locking vault');
  _decryptedData = null;
  await bgMessage({ type: 'LOCK_VAULT' });

  if (_selectedProfile) {
    // Return to unlock screen for same profile — no need to re-select
    document.getElementById('password-input').value  = '';
    document.getElementById('password-input').disabled = false;
    setPasswordError('');
    showScreen('unlock', true);
    setTimeout(() => document.getElementById('password-input')?.focus(), 150);
  } else {
    await loadProfiles();
  }
}

// ────────────────────────────────────────────────────────────
// NAV WIRING
// ────────────────────────────────────────────────────────────
document.getElementById('btn-lock').addEventListener('click', lockSession);
document.getElementById('btn-back-from-review').addEventListener('click', lockSession);
document.getElementById('btn-back-from-unlock').addEventListener('click', () => {
  _selectedProfile = null;
  loadProfiles();
});

document.getElementById('btn-open-portal').addEventListener('click',   () => chrome.tabs.create({ url: 'http://localhost:4000/' }));
document.getElementById('btn-open-portal-2').addEventListener('click', () => chrome.tabs.create({ url: 'http://localhost:4000/' }));

// ────────────────────────────────────────────────────────────
// THEME
// ────────────────────────────────────────────────────────────
document.getElementById('btn-theme').addEventListener('click', async () => {
  _theme = _theme === 'dark' ? 'light' : 'dark';
  applyTheme(_theme);
  await localSet('fs_ext_theme', _theme);
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-moon').style.display = theme === 'dark'  ? 'block' : 'none';
  document.getElementById('icon-sun').style.display  = theme === 'light' ? 'block' : 'none';
}

// ────────────────────────────────────────────────────────────
// EMPTY STATE HELPER
// ────────────────────────────────────────────────────────────
function showEmptyState(msg) {
  document.getElementById('profiles-empty').style.display = 'flex';
  const p = document.getElementById('profiles-empty').querySelector('p');
  if (p && msg) p.textContent = msg;
}

// ────────────────────────────────────────────────────────────
// SCREEN TRANSITIONS
// ────────────────────────────────────────────────────────────
function showScreen(id, isBack = false) {
  Object.values(screens).forEach(s => s.classList.remove('active', 'slide-back'));
  const t = screens[id];
  if (!t) return;
  t.classList.add('active');
  if (isBack) t.classList.add('slide-back');
}

// ────────────────────────────────────────────────────────────
// STORAGE HELPERS (chrome.storage.local for profiles/theme)
// ────────────────────────────────────────────────────────────
function localGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, r => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(r[key] ?? null);
    });
  });
}
function localSet(key, value) {
  return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
}
function localRemove(key) {
  return new Promise(resolve => chrome.storage.local.remove(key, resolve));
}

// ────────────────────────────────────────────────────────────
// BACKGROUND MESSAGING
// ────────────────────────────────────────────────────────────
function bgMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

// ────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function truncate(str, max) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ────────────────────────────────────────────────────────────
// RUNTIME MESSAGES
// ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FORCE_LOCK_VAULT') {
    console.log('[FormSarthi] Popup forced back to locked state');
    _decryptedData = null;
    _selectedProfile = null;

    // Reset password input
    const pwdInput = document.getElementById('password-input');
    if (pwdInput) {
      pwdInput.value = '';
      pwdInput.disabled = false;
    }
    setPasswordError('');

    // Clear sensitive DOM elements in review screen
    const reviewName = document.getElementById('review-name');
    if (reviewName) reviewName.textContent = '';
    const reviewEmail = document.getElementById('review-email');
    if (reviewEmail) reviewEmail.textContent = '';
    const groupsEl = document.getElementById('field-groups');
    if (groupsEl) groupsEl.innerHTML = '';
    const missChips = document.getElementById('missing-chips');
    if (missChips) missChips.innerHTML = '';

    // Load and render locked profile selector
    loadProfiles();
  }
});

