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

function showLocked() { lockedView.classList.add("active"); mainView.classList.remove("active"); }
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
      showLocked();
      return;
    }

    const { profile, status } = response;
    showMain();

    const pct = status?.percent || 0;
    progressFill.style.width = `${pct}%`;
    pctText.textContent      = `${pct}%`;

    // Display primary summary fields in the popup grid
    const fields = [
      "name", "email", "phone", "gender", "caste",
      "roll_10", "roll_12", "aadhaar", "pan", "account_no"
    ];
    const labels = {
      name: "Full Name", email: "Email", phone: "Mobile",
      gender: "Gender", caste: "Category", roll_10: "Class 10 Roll",
      roll_12: "Class 12 Roll", aadhaar: "Aadhaar No", pan: "PAN Card",
      account_no: "Bank Account"
    };

    profileGrid.innerHTML = fields.map(f => {
      const val   = profile?.[f];
      const empty = !val;
      return `
        <div class="field-chip ${empty ? "empty" : ""}">
          <div class="key">${labels[f]}</div>
          <div class="val">${val || "—"}</div>
        </div>
      `;
    }).join("");

  } catch (err) {
    showLocked();
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
    const result = await chrome.runtime.sendMessage({ type: "FILL_FORM" });
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
