// =============================================================
// chrome-extension/background.js (MV3 Service Worker)
//
// Bridges communication between popup.js, the FormSarthi tab,
// and target form pages. Complete local-first, zero DB calls!
// Supports multiple localhost ports (3000, 4000).
// =============================================================

async function getDecryptedSession() {
  // Query both port 3000 and port 4000
  const tabs = await chrome.tabs.query({ url: ["*://localhost:3000/*", "*://localhost:4000/*"] });
  if (tabs.length === 0) {
    throw new Error("Please open FormSarthi Dashboard (http://localhost:4000) and unlock your vault first.");
  }
  
  for (const tab of tabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_DECRYPTED_SESSION" });
      if (response && response.success) {
        return response.profile;
      }
    } catch (e) {
      // Content script not loaded/ready on this tab
    }
  }
  
  throw new Error("FormSarthi vault is locked. Please unlock it on the dashboard first.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {

    case "GET_PROFILE": {
      try {
        const profile = await getDecryptedSession();
        // Calculate completeness based on all 30 fields
        const allFields = [
          "name", "dob", "gender", "caste", "nationality", "religion", "blood_group", "marital_status",
          "phone", "alt_phone", "email", "address", "city", "state", "pincode",
          "roll_10", "roll_12", "board_10", "board_12", "marks_10", "marks_12", "college", "degree", "grad_year",
          "aadhaar", "pan", "dl", "bank_name", "account_no", "ifsc"
        ];
        const filled = allFields.filter(f => profile[f]);
        const percent = Math.round((filled.length / allFields.length) * 100);
        return { 
          success: true, 
          profile, 
          status: { percent } 
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case "FILL_FORM": {
      try {
        const profile = await getDecryptedSession();
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) throw new Error("No active tab found.");
        
        // Send message to active tab to fill form
        const fillResponse = await chrome.tabs.sendMessage(activeTab.id, { type: "FILL_PAGE", profile });
        const filledCount = fillResponse ? fillResponse.count : 0;
        
        return { success: true, fielledCount: filledCount };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}
