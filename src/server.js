// =============================================================
// src/server.js
// Entry point for the FormSarthi backend.
//
// WHAT THIS FILE DOES:
//   1. Loads environment variables from .env
//   2. Connects to SQLite and creates tables (via database.js)
//   3. Mounts all route files under /api/...
//   4. Serves the frontend HTML from the /public folder
//   5. Starts listening on the configured PORT
//
// HOW FRONTEND + BACKEND LIVE TOGETHER:
//   express.static('public') tells Express to serve any file
//   in the /public folder as if it were a normal website.
//   So /public/index.html becomes http://localhost:3000/
//   This means ONE server, ONE port — no CORS issues.
// =============================================================

// Load environment variables
require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const path    = require("path");

// ── Initialize database ────────
require("./db/database");

// ── Import route files ────────────────────────────────────────
const authRoutes       = require("./routes/auth");
const profileRoutes    = require("./routes/profile");
const documentRoutes   = require("./routes/documents");
const autofillRoutes   = require("./routes/autofill");
const extensionRoutes  = require("./routes/extension");
const processRoutes    = require("./routes/process");
const toolRoutes       = require("./routes/tools");
const syncRoutes       = require("./routes/sync");

const app  = express();
const PORT = process.env.PORT || 3000;

// =============================================================
// MIDDLEWARE (runs on every request before routes)
// =============================================================

// Allow cross-origin requests from the frontend dev server
// (only needed if frontend runs on a different port, e.g. Vite)
app.use(cors());

// Parse JSON request bodies: { "email": "...", "pin": "..." }
app.use(express.json());

// Parse URL-encoded form data (standard HTML form POST)
app.use(express.urlencoded({ extended: true }));

// =============================================================
// SERVE FRONTEND FILES
//
// Put your index.html (and any CSS/JS files) inside /public/
// Express will automatically serve them.
//
// Visiting http://localhost:3000/        → serves /public/index.html
// Visiting http://localhost:3000/app.js  → serves /public/app.js
//
// Your frontend JS then calls the API like:
//   fetch('/api/auth/login', { method: 'POST', ... })
//   ↑ No full URL needed — same server, same port.
// =============================================================
app.use(express.static(path.join(__dirname, "../public")));

// =============================================================
// API ROUTES
// All backend endpoints live under /api/
// =============================================================
app.use("/api/auth",       authRoutes);      // signup, login, logout
app.use("/api/profile",    profileRoutes);   // get/update encrypted profile
app.use("/api/documents",  documentRoutes);  // upload/list/download/delete
app.use("/api/autofill",   autofillRoutes);  // get decrypted profile for filling
app.use("/api/extension",  extensionRoutes); // Chrome extension endpoints
app.use("/api/process",    processRoutes);   // stateless document processing
app.use("/api/tools",      toolRoutes);      // stateless document tools (resize, etc.)
app.use("/api/sync",       syncRoutes);      // zero-knowledge sync endpoints

// =============================================================
// CATCH-ALL: serve index.html for any unknown route
//
// This handles "deep links" — if someone visits
// http://localhost:3000/dashboard directly, Express serves
// index.html and the frontend JS handles the routing.
// =============================================================
app.get("*", (req, res) => {
  // Only do this for non-API routes (API 404s should stay as JSON)
  if (!req.path.startsWith("/api")) {
    return res.sendFile(path.join(__dirname, "../public/index.html"));
  }
  return res.status(404).json({ error: "API endpoint not found." });
});

// =============================================================
// START SERVER
// =============================================================
app.listen(PORT, () => {
  console.log("");
  console.log("🚀 FormSarthi is running!");
  console.log(`   Frontend: http://localhost:${PORT}`);
  console.log(`   API:      http://localhost:${PORT}/api`);
  console.log("");
});
