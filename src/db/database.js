// =============================================================
// src/db/database.js
// SQLite database setup using better-sqlite3.
//
// WHAT THIS FILE DOES:
//   1. Opens (or creates) the SQLite database file at db/formsarthi.db
//   2. Creates all required tables if they don't exist
//   3. Exports the db instance for use in all route/controller files
//
// TABLE STRUCTURE:
//   Users        — accounts (id, email, name, pin_hash)
//   UserProfile  — encrypted profile fields (6 fields, AES-GCM)
//   Documents    — encrypted document blobs + metadata
// =============================================================

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

// Ensure the db directory exists
const dbDir = path.join(__dirname, "../../db");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "formsarthi.db");
const db     = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// =============================================================
// CREATE TABLES
// Using IF NOT EXISTS — safe to run on every startup.
// =============================================================

db.exec(`
  -- Users table: one row per registered account
  CREATE TABLE IF NOT EXISTS Users (
    id         TEXT PRIMARY KEY,              -- UUID
    email      TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    pin_hash   TEXT NOT NULL,                 -- bcrypt hash of 6-digit PIN
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- UserProfile: encrypted personal info extracted from documents
  -- All fields are stored as "iv:ciphertext" hex strings (AES-256-GCM)
  CREATE TABLE IF NOT EXISTS UserProfile (
    user_id            TEXT PRIMARY KEY REFERENCES Users(id) ON DELETE CASCADE,
    encrypted_name     TEXT,
    encrypted_dob      TEXT,
    encrypted_address  TEXT,
    encrypted_phone    TEXT,
    encrypted_email    TEXT,
    encrypted_college  TEXT,
    updated_at         TEXT DEFAULT (datetime('now'))
  );

  -- Documents: encrypted file blobs with metadata
  CREATE TABLE IF NOT EXISTS Documents (
    id                       TEXT PRIMARY KEY,   -- UUID
    user_id                  TEXT NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
    document_type            TEXT NOT NULL,       -- aadhaar | pan | resume | etc.
    encrypted_document_data  TEXT NOT NULL,       -- AES-encrypted file bytes as hex
    uploaded_at              TEXT DEFAULT (datetime('now'))
  );
`);

console.log(`✅ Database ready at: ${dbPath}`);

module.exports = db;
