// =============================================================
// chrome-extension/popup.js  — v2.2
// Fixes:
//  1. Numpad removed — alphanumeric password only
//  2. Lock → returns to SAME profile's unlock screen (not list)
//  3. CryptoJS loaded locally (CDN blocked by MV3)
//  4. Full masked debug logging
// =============================================================

/* ── Constants (MUST match portal index.html exactly) ── */
const SALT_SUFFIX    = 'FormSarthiSalt2026';
const PBKDF2_KEYSIZE = 256 / 32;
const PBKDF2_ITERS   = 1000;

/* ── Storage keys ── */
const STORAGE_PROFILES_KEY = 'fs_ext_profiles';
const STORAGE_SESSION_KEY  = 'fs_ext_session';
const SESSION_TIMEOUT_MS   = 15 * 60 * 1000; // 15 min

/* ── App state ── */
let _profiles        = [];
let _selectedProfile = null;
let _decryptedData   = null;
let _sessionTimer    = null;
let _theme           = 'dark';

/* ── DOM refs ── */
const screens = {
  profiles: document.getElementById('screen-profiles'),
  unlock:   document.getElementById('screen-unlock'),
  review:   document.getElementById('screen-review'),
};

// ────────────────────────────────────────────────────────────
// SAFE DEBUG LOGGER
// ────────────────────────────────────────────────────────────
const LOG = {
  info:  (...a) => console.log   ('[FormSarthi]', ...a),
  warn:  (...a) => console.warn  ('[FormSarthi]', ...a),
  error: (...a) => console.error ('[FormSarthi]', ...a),
  mask:  (v) => { const s = String(v||''); return s.length<=3?'***':'*'.repeat(s.length-3)+s.slice(-3); },
};

// ────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  LOG.info('Popup opened — checking CryptoJS');

  if (typeof CryptoJS === 'undefined') {
    showScreen('profiles');
    document.getElementById('profiles-loading').style.display = 'none';
    document.getElementById('profiles-empty').style.display   = 'flex';
    document.getElementById('profiles-empty').querySelector('p').textContent =
      '❌ CryptoJS not loaded. Re-install the extension (crypto-js.min.js missing).';
    return;
  }
  LOG.info('CryptoJS OK ✓');

  _theme = (await storageGet('fs_ext_theme')) || 'dark';
  applyTheme(_theme);

  // Wire up show/hide password toggle
  const toggleBtn = document.getElementById('btn-toggle-pass');
  const pwdInput  = document.getElementById('password-input');
  if (toggleBtn && pwdInput) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = pwdInput.type === 'password';
      pwdInput.type = isHidden ? 'text' : 'password';
      document.getElementById('eye-open').style.display   = isHidden ? 'none'  : 'block';
      document.getElementById('eye-closed').style.display = isHidden ? 'block' : 'none';
    });
  }

  await tryRestoreSession();
});

async function tryRestoreSession() {
  const liveSession = await storageGet(STORAGE_SESSION_KEY);
  if (liveSession && liveSession.decryptedData && liveSession.expiry > Date.now()) {
    LOG.info('Live session found — restoring review screen');
    _decryptedData   = liveSession.decryptedData;
    _selectedProfile = liveSession.profile;
    populateReviewScreen(_selectedProfile, _decryptedData);
    showScreen('review');
    startSessionTimer(Math.floor((liveSession.expiry - Date.now()) / 1000));
    return;
  }
  LOG.info('No live session — loading profile list');
  await loadProfiles();
}

// ────────────────────────────────────────────────────────────
// PROFILE LIST
// ────────────────────────────────────────────────────────────
async function loadProfiles() {
  showScreen('profiles');
  document.getElementById('profiles-loading').style.display = 'flex';
  document.getElementById('profiles-empty').style.display   = 'none';
  document.getElementById('profiles-list').style.display    = 'none';

  try {
    const stored = await storageGet(STORAGE_PROFILES_KEY);
    _profiles = Array.isArray(stored) ? stored : [];
    LOG.info(`Found ${_profiles.length} profile(s) in storage`);

    // Validate — needs encryptedProfile to be usable
    const valid = _profiles.filter(p => p && p.email && p.encryptedProfile);

    if (valid.length === 0) {
      LOG.info('No valid profiles — fetching from portal tab');
      try {
        const resp = await bgMessage({ type: 'GET_PROFILES_FROM_PORTAL' });
        if (resp?.success && Array.isArray(resp.profiles) && resp.profiles.length > 0) {
          _profiles = resp.profiles;
          LOG.info(`Got ${_profiles.length} profile(s) from portal`);
          await storageSet(STORAGE_PROFILES_KEY, _profiles);
        }
      } catch (e) {
        LOG.warn('Portal fallback failed:', e.message);
      }
    } else {
      _profiles = valid;
    }
  } catch (e) {
    LOG.error('Profile load error:', e.message);
  }

  document.getElementById('profiles-loading').style.display = 'none';

  if (_profiles.length === 0) {
    document.getElementById('profiles-empty').style.display = 'flex';
  } else {
    renderProfileList();
    document.getElementById('profiles-list').style.display = 'block';
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
      </div>
    `;
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
  avatarEl.textContent   = _selectedProfile.avatar || '🪪';
  avatarEl.style.background = COLOR_MAP[_selectedProfile.color] || COLOR_MAP.purple;

  document.getElementById('unlock-name').textContent  = _selectedProfile.name || _selectedProfile.email.split('@')[0];
  document.getElementById('unlock-email').textContent = _selectedProfile.email;
  document.getElementById('pin-error').textContent    = '';
  document.getElementById('password-input').value     = '';

  LOG.info(`Unlock screen for: ${LOG.mask(_selectedProfile.email)}`);
  LOG.info(`Has encryptedProfile: ${!!_selectedProfile.encryptedProfile} (len=${_selectedProfile.encryptedProfile?.length})`);

  showScreen('unlock');

  // Auto-focus the password field
  setTimeout(() => document.getElementById('password-input')?.focus(), 120);
}

/* ── Password unlock button ── */
document.getElementById('btn-unlock-pass').addEventListener('click', () => {
  const pwd = document.getElementById('password-input').value;
  if (!pwd) {
    showError('Please enter your password.');
    return;
  }
  attemptUnlock(pwd);
});

/* ── Enter key to unlock ── */
document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const pwd = document.getElementById('password-input').value;
    if (pwd) attemptUnlock(pwd);
  }
  // Clear error on typing
  if (e.key !== 'Enter') {
    document.getElementById('pin-error').textContent = '';
  }
});

function showError(msg) {
  document.getElementById('pin-error').textContent = msg;
}

// ────────────────────────────────────────────────────────────
// CORE DECRYPT — matches portal encryption exactly
// ────────────────────────────────────────────────────────────
async function attemptUnlock(passwordRaw) {
  if (!_selectedProfile?.encryptedProfile) {
    showError('No vault found. Open portal and save your data first.');
    return;
  }

  // Normalize: String(), preserve leading zeros, NO parseInt/trim manipulation
  const password = String(passwordRaw);

  LOG.info(`Unlock attempt — length:${password.length} masked:${LOG.mask(password)}`);
  LOG.info(`Blob prefix: ${_selectedProfile.encryptedProfile.slice(0,16)}…`);

  const btn = document.getElementById('btn-unlock-pass');
  btn.disabled    = true;
  btn.textContent = 'Unlocking…';

  try {
    // Key derivation — identical to portal line 4442-4443
    const salt       = CryptoJS.enc.Utf8.parse(_selectedProfile.email + SALT_SUFFIX);
    const derivedKey = CryptoJS.PBKDF2(password, salt, {
      keySize:    PBKDF2_KEYSIZE,
      iterations: PBKDF2_ITERS,
    });

    LOG.info(`Key prefix: ${derivedKey.toString().slice(0,8)}…`);

    // AES decrypt — identical to portal line 4468
    const decryptedBytes = CryptoJS.AES.decrypt(_selectedProfile.encryptedProfile, derivedKey.toString());
    const decryptedText  = decryptedBytes.toString(CryptoJS.enc.Utf8);

    LOG.info(`Decrypted length: ${decryptedText.length}`);

    if (!decryptedText || decryptedText.length < 2) {
      throw new Error('Empty decrypt — wrong password');
    }

    let vaultData;
    try {
      vaultData = JSON.parse(decryptedText);
    } catch (_) {
      throw new Error('Vault corrupted — re-save your profile in the portal');
    }

    LOG.info('✅ Unlock SUCCESS — vault keys:', Object.keys(vaultData).slice(0,5).join(', '));

    _decryptedData = vaultData;

    // Save session
    await storageSet(STORAGE_SESSION_KEY, {
      profile:       _selectedProfile,
      decryptedData: _decryptedData,
      expiry:        Date.now() + SESSION_TIMEOUT_MS,
    });

    populateReviewScreen(_selectedProfile, _decryptedData);
    showScreen('review');
    startSessionTimer(Math.floor(SESSION_TIMEOUT_MS / 1000));

  } catch (err) {
    LOG.error('Unlock failed:', err.message);
    showError('Wrong password. Try again.');
    document.getElementById('password-input').value = '';
    document.getElementById('password-input').focus();
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:16px;height:16px;flex-shrink:0"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Unlock`;
  }
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
  document.getElementById('ring-pct').textContent         = `${pct}%`;
  document.getElementById('readiness-fill').style.width   = `${pct}%`;
  document.getElementById('readiness-pct-text').textContent = `${pct}%`;

  const groupsEl     = document.getElementById('field-groups');
  groupsEl.innerHTML = '';
  const missingFields = [];

  FIELD_GROUPS.forEach(group => {
    const el  = document.createElement('div');
    el.className = 'field-group';
    const ok  = group.fields.filter(f => data[f.key] && String(data[f.key]).trim()).length;
    const cls = ok === group.fields.length ? 'good' : '';
    el.innerHTML = `<div class="field-group-header"><span class="group-icon">${group.icon}</span>${group.label}<span class="group-count ${cls}">${ok}/${group.fields.length}</span></div>`;

    const grid = document.createElement('div');
    grid.className = 'field-chips';
    group.fields.forEach(f => {
      const val  = data[f.key] ? String(data[f.key]).trim() : '';
      const chip = document.createElement('div');
      chip.className = 'field-chip';
      chip.innerHTML = `<div class="chip-key">${escHtml(f.label)}</div><div class="chip-val ${val?'has-val':'empty'}">${escHtml(val ? truncate(val,16) : '—')}</div>`;
      grid.appendChild(chip);
      if (!val) missingFields.push(f.label);
    });
    el.appendChild(grid);
    groupsEl.appendChild(el);
  });

  const missSec   = document.getElementById('missing-section');
  const missChips = document.getElementById('missing-chips');
  if (missingFields.length > 0) {
    missSec.style.display  = 'block';
    missChips.innerHTML = missingFields.slice(0,12).map(f=>`<span class="missing-chip">${escHtml(f)}</span>`).join('');
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

    LOG.info(`Autofill on tab ${activeTab.id}: ${activeTab.url?.slice(0,60)}`);

    const result = await chrome.runtime.sendMessage({
      type:    'FILL_FORM',
      tabId:   activeTab.id,
      profile: _decryptedData,
    });

    const count = result?.filledCount ?? result?.fielledCount ?? 0;

    if (result?.success && count > 0) {
      showFillMsg(`✅ Filled ${count} field(s) successfully!`, 'success');
    } else if (result?.success && count === 0) {
      showFillMsg(`ℹ️ No matching fields found on this page.`, 'info');
    } else {
      showFillMsg(result?.error || 'Autofill failed.', 'error');
    }
    LOG.info(`Autofill result: ${count} fields filled`);
  } catch (err) {
    LOG.error('Autofill error:', err.message);
    showFillMsg(err.message || 'Autofill error.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="width:16px;height:16px;flex-shrink:0"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Autofill This Page`;
  }
});

document.getElementById('btn-refresh').addEventListener('click', async () => {
  LOG.info('Manual refresh');
  _decryptedData   = null;
  _selectedProfile = null;
  await storageRemove(STORAGE_SESSION_KEY);
  await storageRemove(STORAGE_PROFILES_KEY);
  clearSessionTimer();
  await loadProfiles();
});

function showFillMsg(text, type) {
  const el = document.getElementById('fill-msg');
  el.textContent   = text;
  el.className     = `fill-msg ${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ────────────────────────────────────────────────────────────
// SESSION TIMER
// ────────────────────────────────────────────────────────────
function startSessionTimer(seconds) {
  clearSessionTimer();
  let remaining = seconds;
  _sessionTimer = setInterval(async () => {
    remaining--;
    if (remaining <= 0) {
      LOG.info('Session timeout — locking');
      clearSessionTimer();
      await lockSession();
    }
  }, 1000);
}

function clearSessionTimer() {
  if (_sessionTimer) { clearInterval(_sessionTimer); _sessionTimer = null; }
}

// ────────────────────────────────────────────────────────────
// LOCK — goes back to SAME profile's unlock screen
// ────────────────────────────────────────────────────────────
async function lockSession() {
  LOG.info('Locking session');
  _decryptedData = null;
  await storageRemove(STORAGE_SESSION_KEY);
  clearSessionTimer();

  // KEY BEHAVIOR: if we know which profile was unlocked,
  // go directly back to that profile's unlock screen
  if (_selectedProfile) {
    document.getElementById('password-input').value  = '';
    document.getElementById('pin-error').textContent = '';
    showScreen('unlock', true); // slide-back animation
    setTimeout(() => document.getElementById('password-input')?.focus(), 150);
  } else {
    await loadProfiles();
  }
}

// ────────────────────────────────────────────────────────────
// NAV BUTTONS
// ────────────────────────────────────────────────────────────
document.getElementById('btn-lock').addEventListener('click', lockSession);

document.getElementById('btn-back-from-unlock').addEventListener('click', () => {
  _selectedProfile = null; // Forget which profile — go to full list
  loadProfiles();
});

document.getElementById('btn-back-from-review').addEventListener('click', lockSession);

document.getElementById('btn-open-portal').addEventListener('click',   () => chrome.tabs.create({ url: 'http://localhost:4000/' }));
document.getElementById('btn-open-portal-2').addEventListener('click', () => chrome.tabs.create({ url: 'http://localhost:4000/' }));

// ────────────────────────────────────────────────────────────
// THEME TOGGLE
// ────────────────────────────────────────────────────────────
document.getElementById('btn-theme').addEventListener('click', async () => {
  _theme = _theme === 'dark' ? 'light' : 'dark';
  applyTheme(_theme);
  await storageSet('fs_ext_theme', _theme);
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-moon').style.display = theme === 'dark'  ? 'block' : 'none';
  document.getElementById('icon-sun').style.display  = theme === 'light' ? 'block' : 'none';
}

// ────────────────────────────────────────────────────────────
// SCREEN TRANSITIONS
// ────────────────────────────────────────────────────────────
function showScreen(id, isBack = false) {
  Object.values(screens).forEach(s => s.classList.remove('active','slide-back'));
  const t = screens[id];
  if (!t) return;
  t.classList.add('active');
  if (isBack) t.classList.add('slide-back');
}

// ────────────────────────────────────────────────────────────
// STORAGE HELPERS
// ────────────────────────────────────────────────────────────
function storageGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, r => {
      if (chrome.runtime.lastError) { LOG.warn(`storageGet(${key}):`, chrome.runtime.lastError.message); resolve(null); }
      else resolve(r[key] ?? null);
    });
  });
}
function storageSet(key, value) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) LOG.warn(`storageSet(${key}):`, chrome.runtime.lastError.message);
      resolve();
    });
  });
}
function storageRemove(key) {
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
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function truncate(str, max) {
  const s = String(str||'');
  return s.length > max ? s.slice(0, max)+'…' : s;
}
