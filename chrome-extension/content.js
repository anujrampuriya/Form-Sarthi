// =============================================================
// chrome-extension/content.js
// Injected into every page.
// Listens for FILL_PAGE messages, and bridges sessionStorage on FormSarthi tab.
// Supports 30 fields across wide domains.
// =============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FILL_PAGE") {
    const count = fillForm(message.profile);
    sendResponse({ success: true, count });
  } else if (message.type === "GET_DECRYPTED_SESSION") {
    try {
      const sessionStr = sessionStorage.getItem("fs_active_session");
      const profile = sessionStr ? JSON.parse(sessionStr) : null;
      sendResponse({ success: !!profile, profile });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true;
});

function fillForm(profile) {
  if (!profile) return 0;

  const fieldSelectors = {
    name: [
      'input[name*="name" i]:not([name*="user" i])',
      'input[id*="fullname" i]',
      'input[placeholder*="full name" i]',
      'input[autocomplete="name"]',
      'input[name*="candidate" i]',
      'input[name*="applicant" i]'
    ],
    dob: [
      'input[name*="dob" i]',
      'input[name*="birth" i]',
      'input[type="date"]',
      'input[placeholder*="dd/mm/yyyy" i]',
      'input[placeholder*="dob" i]'
    ],
    gender: [
      'select[name*="gender" i]',
      'select[name*="sex" i]',
      'input[name*="gender" i]'
    ],
    caste: [
      'select[name*="caste" i]',
      'select[name*="category" i]',
      'input[name*="caste" i]',
      'input[name*="category" i]'
    ],
    nationality: [
      'input[name*="nationality" i]',
      'select[name*="nationality" i]',
      'input[name*="citizen" i]'
    ],
    religion: [
      'input[name*="religion" i]',
      'select[name*="religion" i]'
    ],
    blood_group: [
      'input[name*="blood" i]',
      'select[name*="blood" i]',
      'input[name*="bg" i]'
    ],
    marital_status: [
      'select[name*="marital" i]',
      'select[name*="marriage" i]',
      'input[name*="marital" i]'
    ],
    phone: [
      'input[type="tel"]',
      'input[name*="phone" i]:not([name*="alt" i])',
      'input[name*="mobile" i]:not([name*="alt" i])',
      'input[placeholder*="phone" i]',
      'input[placeholder*="mobile" i]'
    ],
    alt_phone: [
      'input[name*="alt_phone" i]',
      'input[name*="altphone" i]',
      'input[name*="alternate" i]',
      'input[placeholder*="alternate" i]'
    ],
    email: [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[autocomplete="email"]',
      'input[placeholder*="email" i]'
    ],
    address: [
      'textarea[name*="address" i]',
      'input[name*="address" i]',
      'input[autocomplete="street-address"]',
      'textarea[placeholder*="address" i]'
    ],
    city: [
      'input[name*="city" i]',
      'input[id*="city" i]',
      'input[placeholder*="city" i]'
    ],
    state: [
      'input[name*="state" i]',
      'select[name*="state" i]',
      'input[placeholder*="state" i]'
    ],
    pincode: [
      'input[name*="pincode" i]',
      'input[name*="pin" i]',
      'input[id*="pincode" i]',
      'input[placeholder*="pincode" i]',
      'input[placeholder*="pin code" i]',
      'input[autocomplete="postal-code"]'
    ],
    roll_10: [
      'input[name*="roll_10" i]',
      'input[name*="roll10" i]',
      'input[name*="ssc_roll" i]',
      'input[placeholder*="10th roll" i]',
      'input[placeholder*="class 10 roll" i]'
    ],
    board_10: [
      'input[name*="board_10" i]',
      'input[name*="board10" i]',
      'select[name*="ssc_board" i]',
      'input[placeholder*="10th board" i]'
    ],
    marks_10: [
      'input[name*="marks_10" i]',
      'input[name*="marks10" i]',
      'input[name*="ssc_percent" i]',
      'input[placeholder*="10th marks" i]',
      'input[placeholder*="10th percentage" i]'
    ],
    roll_12: [
      'input[name*="roll_12" i]',
      'input[name*="roll12" i]',
      'input[name*="hsc_roll" i]',
      'input[placeholder*="12th roll" i]',
      'input[placeholder*="class 12 roll" i]'
    ],
    board_12: [
      'input[name*="board_12" i]',
      'input[name*="board12" i]',
      'select[name*="hsc_board" i]',
      'input[placeholder*="12th board" i]'
    ],
    marks_12: [
      'input[name*="marks_12" i]',
      'input[name*="marks12" i]',
      'input[name*="hsc_percent" i]',
      'input[placeholder*="12th marks" i]',
      'input[placeholder*="12th percentage" i]'
    ],
    college: [
      'input[name*="college" i]',
      'input[name*="institute" i]',
      'input[name*="university" i]',
      'input[placeholder*="college" i]'
    ],
    degree: [
      'input[name*="degree" i]',
      'input[name*="course" i]',
      'select[name*="qualification" i]'
    ],
    grad_year: [
      'input[name*="grad_year" i]',
      'input[name*="gradyear" i]',
      'select[name*="passing_year" i]'
    ],
    aadhaar: [
      'input[name*="aadhaar" i]', 'input[name*="aadhar" i]',
      'input[id*="aadhaar" i]', 'input[id*="aadhar" i]',
      'input[placeholder*="aadhaar" i]', 'input[placeholder*="aadhar" i]'
    ],
    pan: [
      'input[name*="pan" i]', 'input[id*="pan" i]',
      'input[placeholder*="pan" i]', 'input[name*="permanent account" i]'
    ],
    dl: [
      'input[name*="dl" i]', 'input[name*="driving license" i]',
      'input[name*="driving licence" i]', 'input[id*="dl" i]',
      'input[name*="passport" i]', 'input[placeholder*="passport" i]'
    ],
    bank_name: [
      'input[name*="bank_name" i]', 'input[name*="bankname" i]',
      'input[placeholder*="bank name" i]'
    ],
    account_no: [
      'input[name*="account" i]', 'input[name*="acc_no" i]',
      'input[placeholder*="account number" i]'
    ],
    ifsc: [
      'input[name*="ifsc" i]', 'input[id*="ifsc" i]',
      'input[placeholder*="ifsc" i]'
    ]
  };

  let count = 0;
  for (const [field, selectors] of Object.entries(fieldSelectors)) {
    const value = profile[field];
    if (!value) continue;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && !el.value) {
        el.value = value;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        count++;
        break;
      }
    }
  }
  return count;
}
