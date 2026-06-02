// =============================================================
// src/routes/extension.js
// Chrome MV3 Extension API — dedicated endpoints with extra security.
//
// ENDPOINTS:
//   GET  /api/extension/ping      → health check (no auth needed)
//   POST /api/extension/autofill  → get profile for form filling
//   GET  /api/extension/status    → profile completeness
// =============================================================

const express = require("express");

const { requireAuth }          = require("../middleware/authMiddleware");
const {
  extensionCors,
  validateExtensionID,
  extensionRateLimit,
  logExtensionAccess,
} = require("../middleware/extensionMiddleware");

const {
  getAutofillData,
  getProfileCompleteness,
} = require("../controllers/autofillController");

const router = express.Router();

// Apply extension-specific middleware to ALL routes here
router.use(extensionCors);
router.use(validateExtensionID);
router.use(extensionRateLimit);

// GET /api/extension/ping  — no auth required
router.get("/ping", (req, res) => {
  return res.status(200).json({
    status:  "ok",
    service: "FormSarthi API",
    version: "1.0.0",
  });
});

// POST /api/extension/autofill  — main endpoint for the extension
router.post("/autofill", requireAuth, logExtensionAccess, async (req, res) => {
  try {
    const { userId } = req.user;

    const requestedFields = Array.isArray(req.body?.fields)
      ? req.body.fields
      : null;

    const profile = await getAutofillData(userId, requestedFields);

    if (!profile) {
      return res.status(404).json({
        error: "No profile data available.",
        hint:  "Open FormSarthi and upload at least one document first.",
      });
    }

    const filledCount = Object.values(profile).filter(v => v !== null).length;

    return res.status(200).json({
      profile,
      meta: {
        filledCount,
        totalFields:  6,
        requestedAt:  new Date().toISOString(),
      },
    });

  } catch (err) {
    console.error("Extension autofill error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/extension/status
router.get("/status", requireAuth, logExtensionAccess, async (req, res) => {
  try {
    const completeness = await getProfileCompleteness(req.user.userId);
    return res.status(200).json(completeness);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
