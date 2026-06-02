// =============================================================
// public/app.js
// Frontend JavaScript API client — connects index.html to the backend.
//
// HOW TOKENS WORK:
//   1. Login/signup returns a JWT token.
//   2. We store it in localStorage.
//   3. Every protected API call includes: Authorization: Bearer <token>
//   4. On logout we DELETE it from localStorage.
// =============================================================

// ── Token helpers ─────────────────────────────────────────────
function saveToken(token) { localStorage.setItem("fs_token", token); }
function getToken()       { return localStorage.getItem("fs_token"); }
function clearToken()     { localStorage.removeItem("fs_token"); }

function authHeader() {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function isLoggedIn() { return !!getToken(); }

// =============================================================
// signup(name, email, pin)
// =============================================================
async function signup(name, email, pin) {
  const res = await fetch("/api/auth/signup", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name, email, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Signup failed.");
  saveToken(data.token);
  return data;
}

// =============================================================
// login(email, pin)
// =============================================================
async function login(email, pin) {
  const res = await fetch("/api/auth/login", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed.");
  saveToken(data.token);
  return data;
}

// =============================================================
// logout()
// =============================================================
async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method:  "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
    });
  } catch { /* Always clear local token even if server call fails */ }
  clearToken();
}

// =============================================================
// getProfile()
// =============================================================
async function getProfile() {
  const res = await fetch("/api/profile", {
    method:  "GET",
    headers: { "Content-Type": "application/json", ...authHeader() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load profile.");
  return data.profile;
}

// =============================================================
// updateProfile(updates)
// =============================================================
async function updateProfile(updates) {
  // Remove undefined/empty values before sending
  const clean = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && v !== null && v !== "") clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return null;

  const res = await fetch("/api/profile", {
    method:  "PUT",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body:    JSON.stringify(clean),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update profile.");
  return data.profile;
}

// =============================================================
// getDocuments()
// =============================================================
async function getDocuments() {
  const res = await fetch("/api/documents", {
    method:  "GET",
    headers: { "Content-Type": "application/json", ...authHeader() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load documents.");
  return data.documents;
}

// =============================================================
// uploadDocument(file, documentType)
// =============================================================
async function uploadDocument(file, documentType) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("document_type", documentType);

  const res = await fetch("/api/documents/upload", {
    method:  "POST",
    headers: { ...authHeader() },
    body:    formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data.document;
}
