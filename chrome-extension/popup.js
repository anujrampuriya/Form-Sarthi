// =============================================================
// chrome-extension/popup.js
// Controls the extension popup UI by querying the background service.
// Supports multiple domains & ports.
// =============================================================

const lockedView       = document.getElementById("lockedView");
const mainView         = document.getElementById("mainView");
const fillBtn          = document.getElementById("fillBtn");
const refreshBtn       = document.getElementById("refreshBtn");
const openDashboardBtn = document.getElementById("openDashboardBtn");
const fillMsg          = document.getElementById("fillMsg");
const profileGrid      = document.getElementById("profileGrid");
const progressFill     = document.getElementById("progressFill");
const pctText          = document.getElementById("pctText");

function showLocked(errMsg) {
  lockedView.classList.add("active");
  mainView.classList.remove("active");
  
  let errText = document.getElementById("lockedErrorText");
  if (!errText) {
    errText = document.createElement("p");
    errText.id = "lockedErrorText";
    errText.style.color = "#f87171";
    errText.style.fontSize = "11px";
    errText.style.marginTop = "10px";
    errText.style.lineHeight = "1.4";
    lockedView.querySelector(".section").appendChild(errText);
  }
  errText.textContent = errMsg ? `Reason: ${errMsg}` : "";
}
function showMain()   { mainView.classList.add("active");   lockedView.classList.remove("active"); }

function showMsg(el, text, type) {
  el.textContent   = text;
  el.className     = `msg ${type}`;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}

// Check session on popup open
window.addEventListener("DOMContentLoaded", async () => {
  await loadSession();
});

async function loadSession() {
  profileGrid.innerHTML = "";
  
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_PROFILE" });
    
    if (!response || !response.success) {
      showLocked(response?.error || "Failed to retrieve profile");
      return;
    }

    const { profile, status } = response;
    showMain();

    const pct = status?.percent || 0;
    progressFill.style.width = `${pct}%`;
    pctText.textContent      = `${pct}%`;

    // Display primary summary fields in the popup grid
    const fields = [
      "name", "father_name", "dob", "email", "phone", "gender", "caste",
      "roll_10", "roll_12", "aadhaar", "pan", "account_no"
    ];
    const labels = {
      name: "Full Name", father_name: "Father's Name", dob: "Date of Birth",
      email: "Email", phone: "Mobile",
      gender: "Gender", caste: "Category", roll_10: "Class 10 Roll",
      roll_12: "Class 12 Roll", aadhaar: "Aadhaar No", pan: "PAN Card",
      account_no: "Bank Account"
    };

    let chipsHtml = fields.map(f => {
      const val   = profile?.[f];
      const empty = !val;
      return `
        <div class="field-chip ${empty ? "empty" : ""}">
          <div class="key">${labels[f]}</div>
          <div class="val">${val || "—"}</div>
        </div>
      `;
    }).join("");

    // Append custom fields if any exist
    if (profile && profile.customFields && profile.customFields.length > 0) {
      const customChips = profile.customFields.map(f => {
        const val = profile[f.key];
        const empty = !val;
        return `
          <div class="field-chip ${empty ? "empty" : ""}">
            <div class="key">${f.label}</div>
            <div class="val">${val || "—"}</div>
          </div>
        `;
      }).join("");
      chipsHtml += customChips;
    }

    profileGrid.innerHTML = chipsHtml;

  } catch (err) {
    showLocked(err.message || err);
  }
}

// Open dashboard tab
openDashboardBtn.addEventListener("click", () => {
  // Open port 4000 (default for user) or port 3000
  chrome.tabs.create({ url: "http://localhost:4000/" });
});

// Refresh session manually
refreshBtn.addEventListener("click", async () => {
  await loadSession();
});

// Trigger Auto Fill
fillBtn.addEventListener("click", async () => {
  fillBtn.textContent = "Filling...";
  fillBtn.disabled    = true;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = activeTab ? activeTab.id : null;

    const result = await chrome.runtime.sendMessage({ type: "FILL_FORM", tabId });
    if (result && result.success) {
      showMsg(fillMsg, `✅ Filled ${result.fielledCount} field(s) on this page!`, "success");
    } else {
      showMsg(fillMsg, result?.error || "Autofill failed.", "error");
    }
  } catch (err) {
    showMsg(fillMsg, err.message, "error");
  } finally {
    fillBtn.textContent = "⚡ Auto Fill This Page";
    fillBtn.disabled    = false;
  }
});
