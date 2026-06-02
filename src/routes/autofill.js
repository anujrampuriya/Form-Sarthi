// =============================================================
// src/routes/autofill.js
// Auto Fill API Routes
//
// ENDPOINTS:
//   GET  /api/autofill           → full decrypted profile as JSON
//   POST /api/autofill/fields    → only specific fields
//   GET  /api/autofill/status    → profile completeness summary
// =============================================================

const express = require("express");
const { requireAuth }             = require("../middleware/authMiddleware");
const { getAutofillData,
        getProfileCompleteness }  = require("../controllers/autofillController");

const router = express.Router();

router.use(requireAuth);

// GET /api/autofill
router.get("/", async (req, res) => {
  try {
    const profile = await getAutofillData(req.user.userId, null);

    if (!profile) {
      return res.status(404).json({
        error: "No profile data found.",
        hint:  "Upload at least one document first (Aadhaar, PAN, Resume, etc.)",
      });
    }

    return res.status(200).json({ profile });

  } catch (err) {
    console.error("Autofill error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/autofill/fields
router.post("/fields", async (req, res) => {
  try {
    const { fields } = req.body;

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({
        error: "Provide a 'fields' array in the request body.",
        example: { fields: ["name", "email", "phone"] },
        available_fields: ["name", "dob", "email", "phone", "address", "college"],
      });
    }

    const profile = await getAutofillData(req.user.userId, fields);

    if (!profile) {
      return res.status(404).json({ error: "No profile data found." });
    }

    return res.status(200).json({ profile });

  } catch (err) {
    console.error("Autofill fields error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/autofill/status
router.get("/status", async (req, res) => {
  try {
    const completeness = await getProfileCompleteness(req.user.userId);
    return res.status(200).json(completeness);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
