# FormSarthi 🇮🇳
### Smart AI Form Filler for Indian Students & Citizens

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm run dev

# 3. Open in browser
http://localhost:3000
```

---

## 📁 Project Structure

```
FormSarthi/
├── public/                    ← Frontend (served by Express)
│   ├── index.html             ← Main web app (FormSarthi UI)
│   └── app.js                 ← Frontend API client
│
├── src/                       ← Backend (Node.js / Express)
│   ├── server.js              ← Entry point
│   ├── db/
│   │   └── database.js        ← SQLite setup
│   ├── routes/
│   │   ├── auth.js            ← POST /api/auth/signup|login|logout
│   │   ├── profile.js         ← GET/PUT /api/profile
│   │   ├── documents.js       ← POST/GET/DELETE /api/documents
│   │   ├── autofill.js        ← GET /api/autofill
│   │   └── extension.js       ← GET/POST /api/extension/*
│   ├── middleware/
│   │   ├── authMiddleware.js  ← JWT verification
│   │   └── extensionMiddleware.js ← Chrome extension CORS + rate limit
│   ├── controllers/
│   │   └── autofillController.js ← Shared autofill business logic
│   ├── processors/
│   │   ├── documentPipeline.js ← Orchestrates OCR pipeline
│   │   ├── pdfConverter.js    ← PDF → images (pdf2pic)
│   │   ├── imageEnhancer.js   ← Image preprocessing (sharp)
│   │   ├── ocrEngine.js       ← Tesseract OCR (eng + hin)
│   │   └── fieldExtractor.js  ← Regex-based field extraction
│   └── utils/
│       ├── encrypt.js         ← AES-256-GCM encryption
│       ├── decrypt.js         ← AES-256-GCM decryption
│       └── keyStore.js        ← In-memory session key store
│
├── chrome-extension/          ← Chrome MV3 Extension
│   ├── manifest.json
│   ├── background.js          ← Service worker
│   ├── popup.html + popup.js  ← Extension UI
│   └── content.js             ← Page form filler
│
├── db/                        ← SQLite database (auto-created)
│   └── formsarthi.db
│
├── .env                       ← Environment variables
└── package.json
```

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signup` | ❌ | Create account |
| POST | `/api/auth/login` | ❌ | Login, get JWT |
| POST | `/api/auth/logout` | ✅ | Clear session key |
| GET | `/api/profile` | ✅ | Get decrypted profile |
| PUT | `/api/profile` | ✅ | Update profile fields |
| POST | `/api/documents/upload` | ✅ | Upload + encrypt document |
| GET | `/api/documents` | ✅ | List document metadata |
| GET | `/api/documents/:id` | ✅ | Download + decrypt document |
| DELETE | `/api/documents/:id` | ✅ | Delete document |
| GET | `/api/autofill` | ✅ | Get profile for form filling |
| GET | `/api/autofill/status` | ✅ | Profile completeness % |
| GET | `/api/extension/ping` | ❌ | Health check |
| POST | `/api/extension/autofill` | ✅ | Extension: get profile |
| GET | `/api/extension/status` | ✅ | Extension: completeness |

---

## 🔒 Security Architecture

- **PIN** hashed with bcrypt (12 rounds) — never stored in plain text
- **Profile data** encrypted with AES-256-GCM — keys only in RAM
- **Keys** derived via PBKDF2 from PIN — re-derived on each login
- **JWT** sessions expire in 24 hours
- **Logout** clears the in-memory key — data becomes unreadable

---

## 🧩 Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. Click the FormSarthi icon → sign in with your account
5. Visit any form → click **⚡ Auto Fill This Page**
