// autofill.js — FormSarthi field mapper
// Maps user's extracted data to form field names
// Works by matching common field labels / input names
// Supports 30 custom fields across multiple domains

const FS_Autofill = {

  // All known field mappings — label shown to user → key in sessionData
  _fieldMap: [
    // Personal Info
    { label: 'Full Name',         key: 'name',          hints: ['fullname', 'full_name', 'applicant', 'candidate', 'first_name', 'student_name', 'your_name'], exact: ['name', 'fname'] },
    { label: 'Father\'s Name',    key: 'father_name',   hints: ['father', 'father_name', 'fathers_name', 'father name', 'fathers name', 'father\'s name'] },
    { label: 'Mother\'s Name',    key: 'mother_name',   hints: ['mother', 'mother_name', 'mothers_name', 'mother name', 'mothers name', 'mother\'s name'] },
    { label: 'Date of Birth',     key: 'dob',           hints: ['dob', 'birth', 'dateofbirth', 'date_of_birth', 'born'] },
    { label: 'Gender',            key: 'gender',        hints: ['gender', 'sex', 'gender_type'] },
    { label: 'Caste / Category',  key: 'caste',         hints: ['caste', 'category', 'social_status', 'community', 'reservation'] },
    { label: 'Nationality',       key: 'nationality',   hints: ['nationality', 'citizenship', 'citizen'] },
    { label: 'Religion',          key: 'religion',      hints: ['religion', 'faith'] },
    { label: 'Blood Group',       key: 'blood_group',   hints: ['blood', 'bloodgroup', 'blood_group', 'bg'] },
    { label: 'Marital Status',    key: 'marital_status',hints: ['marital', 'marriage', 'married', 'marital_status'] },
    { label: 'Allergies / Medical Conditions', key: 'allergies', hints: ['allergies', 'allergy', 'medical_conditions', 'pre_existing_conditions', 'medical_history'] },

    // Contact Details
    { label: 'Mobile Number',     key: 'phone',         hints: ['phone', 'mobile', 'contact', 'cell', 'telephone', 'mobileno', 'phoneno'], exact: ['tel', 'phone_no', 'mobile_no'] },
    { label: 'Alternate Mobile',  key: 'alt_phone',     hints: ['alt_phone', 'altphone', 'alternate', 'emergency_contact', 'alt_mobile'] },
    { label: 'Emergency Contact Name', key: 'emergency_contact_name', hints: ['emergency_contact_name', 'emergency contact name', 'emergency_name', 'contact_person'] },
    { label: 'Email Address',     key: 'email',         hints: ['email', 'mail', 'emailid', 'e-mail'] },
    { label: 'Address',           key: 'address',       hints: ['address', 'addr', 'residence', 'location', 'permanent_address', 'corr_address'] },
    { label: 'City',              key: 'city',          hints: ['city', 'town', 'district'] },
    { label: 'State',             key: 'state',         hints: ['state', 'province', 'region'] },
    { label: 'Pincode',           key: 'pincode',       hints: ['pincode', 'pin', 'zip', 'postal', 'zipcode', 'zip_code', 'postal_code'] },

    // Academic Records
    { label: 'Class 10 Roll No',  key: 'roll_10',       hints: ['roll_10', 'roll10', 'class_10_roll', 'ssc_roll', 'roll_no_10', 'matric_roll', '10th_roll'] },
    { label: 'Class 10 Board',    key: 'board_10',      hints: ['board_10', 'board10', 'ssc_board', 'class_10_board', 'matric_board', '10th_board'] },
    { label: 'Class 10 Marks',    key: 'marks_10',      hints: ['marks_10', 'marks10', 'ssc_marks', 'class_10_marks', 'ssc_percent', 'matric_percent', 'percentage_10'] },
    { label: 'Class 12 Roll No',  key: 'roll_12',       hints: ['roll_12', 'roll12', 'class_12_roll', 'hsc_roll', 'roll_no_12', 'inter_roll', '12th_roll'] },
    { label: 'Class 12 Board',    key: 'board_12',      hints: ['board_12', 'board12', 'hsc_board', 'class_12_board', 'inter_board', '12th_board'] },
    { label: 'Class 12 Marks',    key: 'marks_12',      hints: ['marks_12', 'marks12', 'hsc_marks', 'class_12_marks', 'hsc_percent', 'inter_percent', 'percentage_12'] },
    { label: 'College / Institute',key: 'college',      hints: ['college', 'institute', 'university', 'school', 'inst_name'] },
    { label: 'Degree',            key: 'degree',        hints: ['degree', 'course', 'qualification', 'program', 'stream', 'graduation'] },
    { label: 'Graduation Year',   key: 'grad_year',     hints: ['grad_year', 'gradyear', 'year_of_passing', 'passing_year', 'grad_date'] },

    // Identity & Finance
    { label: 'Aadhaar Number',    key: 'aadhaar',       hints: ['aadhaar', 'aadhar', 'uid', 'uidai', 'adhaar'] },
    { label: 'PAN Number',        key: 'pan',           hints: ['pan', 'panno', 'pan_number', 'permanent_account'] },
    { label: 'DL / Passport',     key: 'dl',            hints: ['driving', 'licence', 'license', 'dl', 'passport', 'passport_no', 'passport_number'] },
    { label: 'Bank Name',         key: 'bank_name',     hints: ['bank_name', 'bankname', 'bank_title'] },
    { label: 'Bank Account No',   key: 'account_no',    hints: ['account_no', 'accountno', 'account_number', 'acc_no', 'ac_no', 'ac_num', 'bank_account'] },
    { label: 'IFSC Code',         key: 'ifsc',          hints: ['ifsc', 'ifsccode', 'ifsc_code', 'bank_ifsc'] },
    { label: 'Health Insurance Policy No', key: 'insurance_policy', hints: ['insurance_policy', 'insurance_no', 'policy_no', 'insurance_number', 'policy_number', 'health_insurance'] }
  ],

  // Returns array of { label, key, value } for the completeness meter
  mapFields(sessionData) {
    const fields = this._fieldMap.map(field => ({
      label: field.label,
      key:   field.key,
      value: sessionData[field.key] || null,
    }));
    
    // Dynamically append custom fields if present
    if (sessionData && sessionData.customFields) {
      sessionData.customFields.forEach(custom => {
        fields.push({
          label: custom.label,
          key:   custom.key,
          value: sessionData[custom.key] || null,
        });
      });
    }
    
    return fields;
  },

  formatDateForInput(dateStr) {
    if (!dateStr) return "";
    let cleanStr = dateStr.trim().replace(/[\s\.\-]+/g, '/');
    let parts = cleanStr.split('/');
    if (parts.length === 3) {
      let p0 = parseInt(parts[0], 10);
      let p1 = parseInt(parts[1], 10);
      let p2 = parseInt(parts[2], 10);
      if (p0 > 1000) {
        return `${p0}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
      }
      if (p1 <= 12 && p0 <= 31) {
        let y = p2 < 100 ? (p2 > 50 ? 1900 : 2000) + p2 : p2;
        return `${y}-${String(p1).padStart(2, '0')}-${String(p0).padStart(2, '0')}`;
      }
    }
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
    } catch (e) {}
    return dateStr;
  },

  // When the extension is ready — inject values into a live form
  // This is called from the browser extension content script
  // Helper: build a rich hint string from multiple sources
  _getFullHint(input) {
    let hint = (
      (input.name || '') + ' ' +
      (input.id   || '') + ' ' +
      (input.placeholder || '') + ' ' +
      (input.getAttribute('aria-label') || '')
    ).toLowerCase();

    // 1. Check aria-labelledby (Google Forms uses this pattern)
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(id => {
        const el = document.getElementById(id);
        if (el) hint += ' ' + (el.textContent || '').toLowerCase();
      });
    }

    // 2. Check <label for="..."> elements
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) hint += ' ' + (label.textContent || '').toLowerCase();
    }

    // 3. Traverse parent containers for label text (Google Forms nests
    //    the label in a parent div several levels up from the input)
    let parent = input.parentElement;
    for (let depth = 0; parent && depth < 6; depth++) {
      // Look for common label elements: <label>, <legend>, heading-like spans
      const labelEl = parent.querySelector('label, legend, [data-label], [role="heading"]');
      if (labelEl && !labelEl.contains(input)) {
        hint += ' ' + (labelEl.textContent || '').toLowerCase();
        break;
      }
      // Google Forms uses divs with role="listitem" or class containing "freebirdFormview"
      const spanLabel = parent.querySelector('span[class*="Label"], span[class*="label"], div[class*="label"]');
      if (spanLabel && !spanLabel.contains(input)) {
        hint += ' ' + (spanLabel.textContent || '').toLowerCase();
        break;
      }
      parent = parent.parentElement;
    }

    // 4. Last resort: check the text content of the closest ancestor container
    //    (up to 5 levels) for any recognizable label text
    if (!hint.includes('birth') && !hint.includes('dob') && !hint.includes('father') && !hint.includes('mother')) {
      let ancestor = input.parentElement;
      for (let d = 0; ancestor && d < 5; d++) {
        const txt = (ancestor.textContent || '').toLowerCase();
        // Only grab short containers to avoid picking up the whole page
        if (txt.length < 200) {
          hint += ' ' + txt;
          break;
        }
        ancestor = ancestor.parentElement;
      }
    }

    return hint;
  },

  injectIntoForm(sessionData) {
    if (!sessionData) return 0;

    // 1. Define internal helpers
    function getLabelText(el) {
      if (!el) return "";
      let text = "";
      text += (el.name || "") + " " + (el.id || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-label") || "") + " ";
      const ariaLabelledby = el.getAttribute("aria-labelledby");
      if (ariaLabelledby) {
        ariaLabelledby.split(/\s+/).forEach(id => {
          const target = document.getElementById(id);
          if (target && target.textContent) {
            text += " " + target.textContent;
          }
        });
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label && label.textContent) text += " " + label.textContent;
      }
      const parentLabel = el.closest('label');
      if (parentLabel && parentLabel.textContent) text += " " + parentLabel.textContent;

      let parent = el.parentElement;
      for (let i = 0; i < 6 && parent; i++) {
        if (parent.tagName === 'FORM' || parent.tagName === 'BODY') break;
        const siblingInputs = parent.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea, select');
        if (siblingInputs.length > 1) break;
        if (parent.textContent) {
          text += " " + parent.textContent;
        }
        parent = parent.parentElement;
      }
      return text.trim();
    }

    function matchFieldToProfile(labelText, profile) {
      const t = labelText.toLowerCase().trim()
        .replace(/[*:]/g, '')  // asterisk aur colon hatao
        .trim();

      // ── RELATIONSHIP FIELDS — PEHLE CHECK KARO ──
      if (t.includes("father")) return profile.father_name || '';
      if (t.includes("mother")) return profile.mother_name || '';
      if (t.includes("guardian") || t.includes("parent/guardian")) return profile.guardian_name || profile.father_name || '';
      if (t.includes("husband")) return profile.husband_name || '';

      // ── DOB ──
      if (t.includes("date of birth") || t.includes("dob") || t.includes("d.o.b") || t.includes("birth date") || t.includes("जन्म तिथि")) return profile.dob || '';

      // ── GENDER ──
      if (t.includes("gender") || t.includes("sex") || t.includes("gender of")) return profile.gender || '';

      // ── CASTE / CATEGORY ──
      if (t.includes("caste") || t.includes("category") || t.includes("social category") || t.includes("जाति")) return profile.caste || '';

      // ── MARITAL STATUS ──
      if (t.includes("marital") || t.includes("marriage") || t.includes("married")) return profile.marital_status || '';

      // ── ALLERGIES ──
      if (t.includes("allergy") || t.includes("allergies") || t.includes("medical condition") || t.includes("medical history")) return profile.allergies || '';

      // ── CANDIDATE NAME — ONLY after ruling out all above ──
      if (
        t.includes("full name") || t.includes("full_name") ||
        t.includes("candidate name") || t.includes("applicant name") ||
        t.includes("student name") || t.includes("name of student") ||
        t.includes("name of applicant") || t.includes("your name") ||
        t.includes("नाम") ||
        (t.includes("name") &&
         !t.includes("college") && !t.includes("school") &&
         !t.includes("bank") && !t.includes("emergency") &&
         !t.includes("father") && !t.includes("mother") &&
         !t.includes("guardian") && !t.includes("husband"))
      ) return profile.name || '';

      // ── CONTACT ──
      if (t.includes("emergency contact name") || t.includes("emergency name") || t.includes("contact person") || t.includes("emergency_contact_name")) return profile.emergency_contact_name || '';
      if (t.includes("alternate") && (t.includes("mobile") || t.includes("phone") || t.includes("contact"))) return profile.alt_phone || '';
      if (t.includes("mobile") || t.includes("phone") || t.includes("contact no") || t.includes("cell")) return profile.phone || '';
      if (t.includes("whatsapp")) return profile.phone || '';
      if (t.includes("email") || t.includes("e-mail") || t.includes("ईमेल")) return profile.email || '';

      // ── ADDRESS ──
      if (t.includes("pincode") || t.includes("pin code") || t.includes("postal code") || t.includes("zip")) return profile.pincode || '';
      if (t.includes("district") || (t.includes("city") && !t.includes("address"))) return profile.city || '';
      if ((t.includes("state") && !t.includes("domicile")) || t.includes("state/ut") || t.includes("राज्य")) return profile.state || '';
      if (t.includes("address") || t.includes("पता") || t.includes("residence")) return profile.address || '';
      if (t.includes("country")) return profile.country || 'India';

      // ── 10TH MARKS ──
      if (t.includes("10th") || t.includes("class x") || t.includes("ssc") || t.includes("matriculation") || t.includes("class 10")) {
        if (t.includes("roll")) return profile.roll_10 || '';
        if (t.includes("board")) return profile.board_10 || '';
        if (t.includes("school")) return profile.school || '';
        if (t.includes("year") || t.includes("passing")) return profile.year_10 || '';
        if (t.includes("max") || t.includes("total mark")) return profile.max_marks_10 || '';
        if (t.includes("mark") || t.includes("percent") || t.includes("score") || t.includes("%")) return profile.percentage_10 || profile.marks_10 || '';
        return profile.marks_10 || '';
      }

      // ── 12TH MARKS ──
      if (t.includes("12th") || t.includes("class xii") || t.includes("hsc") || t.includes("intermediate") || t.includes("class 12")) {
        if (t.includes("roll")) return profile.roll_12 || '';
        if (t.includes("board")) return profile.board_12 || '';
        if (t.includes("college") || t.includes("school")) return profile.college || '';
        if (t.includes("year") || t.includes("passing")) return profile.year_12 || '';
        if (t.includes("stream") || t.includes("subject")) return profile.stream || '';
        if (t.includes("mark") || t.includes("percent") || t.includes("score") || t.includes("%")) return profile.percentage_12 || profile.marks_12 || '';
        return profile.marks_12 || '';
      }

      // ── COLLEGE / SCHOOL NAME ──
      if (t.includes("college name") || t.includes("name of college") || t.includes("institution")) return profile.college || '';
      if (t.includes("school name") || t.includes("name of school")) return profile.school || '';
      if (t.includes("university")) return profile.university || profile.college || '';

      // ── DEGREE / COURSE / GRADUATION YEAR ──
      if (t.includes("graduation year") || t.includes("passing year") || t.includes("year of passing") || t.includes("grad_year") || t.includes("grad year") || (t.includes("year") && t.includes("degree"))) return profile.grad_year || '';
      if (t.includes("degree") || t.includes("course") || t.includes("program")) return profile.degree || '';
      if (t.includes("stream") || t.includes("branch") || t.includes("specialization")) return profile.stream || '';
      if (t.includes("semester") || t.includes("year of study")) return profile.semester || '';

      // ── IDENTITY ──
      if (t.includes("aadhaar") || t.includes("aadhar") || t.includes("uid")) return profile.aadhaar || '';
      if (t.includes("pan card") || t.includes("pan no") || t.includes("permanent account")) return profile.pan || '';
      if (t.includes("voter") || t.includes("epic")) return profile.voter_id || '';

      // ── BANK ──
      if (t.includes("ifsc")) return profile.ifsc || '';
      if (t.includes("account number") || t.includes("account no") || t.includes("a/c")) return profile.account_no || '';
      if (t.includes("bank name") || t.includes("name of bank")) return profile.bank_name || '';

      // ── INSURANCE ──
      if (t.includes("insurance") || t.includes("policy no") || t.includes("policy number")) return profile.insurance_policy || '';

      // ── OTHER ──
      if (t.includes("nationality")) return profile.nationality || 'Indian';
      if (t.includes("religion")) return profile.religion || '';
      if (t.includes("blood group") || t.includes("blood type")) return profile.blood_group || '';
      if (t.includes("income") || t.includes("annual income")) return profile.income || '';
      if (t.includes("domicile") || t.includes("bonafide")) return profile.domicile_state || profile.state || '';

      return null;
    }

    function fillSelectAndRadio(profile) {
      let subFilled = 0;

      // Dropdowns (select elements)
      document.querySelectorAll('select').forEach(select => {
        const label = getLabelText(select);
        const value = matchFieldToProfile(label, profile);
        if (!value) return;

        // Option dhundho jo match kare
        Array.from(select.options).forEach(option => {
          if (option.text.toLowerCase().includes(value.toLowerCase()) ||
              value.toLowerCase().includes(option.text.toLowerCase())) {
            if (select.value !== option.value) {
              select.value = option.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              subFilled++;
            }
          }
        });
      });

      // Radio buttons
      document.querySelectorAll('input[type="radio"]').forEach(radio => {
        const label = getLabelText(radio) || radio.value;
        const fieldLabel = getLabelText(radio.closest('fieldset') || radio.closest('[role="group"]') || radio.parentElement.parentElement);
        const profileValue = matchFieldToProfile(fieldLabel, profile);

        if (profileValue && (
          radio.value.toLowerCase() === profileValue.toLowerCase() ||
          label.toLowerCase() === profileValue.toLowerCase() ||
          radio.value.toLowerCase().includes(profileValue.toLowerCase())
        )) {
          if (!radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            subFilled++;
          }
        }
      });

      // Google Forms specific radio (span buttons)
      document.querySelectorAll('[role="radio"]').forEach(radioBtn => {
        const radioText = radioBtn.getAttribute('data-value') || radioBtn.innerText?.trim();
        const questionDiv = radioBtn.closest('[role="listitem"]');
        if (!questionDiv) return;

        const heading = questionDiv.querySelector('[role="heading"]');
        if (!heading) return;

        const fieldLabel = heading.innerText.trim();
        const profileValue = matchFieldToProfile(fieldLabel, profile);

        if (profileValue && radioText &&
            radioText.toLowerCase().includes(profileValue.toLowerCase())) {
          if (radioBtn.getAttribute('aria-checked') !== 'true') {
            radioBtn.click();
            subFilled++;
          }
        }
      });

      return subFilled;
    }

    function formatDateForInput(dateStr) {
      if (!dateStr) return "";
      let cleanStr = dateStr.trim().replace(/[\s\.\-]+/g, '/');
      let parts = cleanStr.split('/');
      if (parts.length === 3) {
        let p0 = parseInt(parts[0], 10);
        let p1 = parseInt(parts[1], 10);
        let p2 = parseInt(parts[2], 10);
        if (p0 > 1000) {
          return `${p0}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
        }
        if (p1 <= 12 && p0 <= 31) {
          let y = p2 < 100 ? (p2 > 50 ? 1900 : 2000) + p2 : p2;
          return `${y}-${String(p1).padStart(2, '0')}-${String(p0).padStart(2, '0')}`;
        }
      }
      try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
      } catch (e) {}
      return dateStr;
    }

    // Perform Form Filling
    let filled = 0;
    const textInputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea');
    
    textInputs.forEach(input => {
      const typeStr = (input.type || '').toLowerCase();
      const nameStr = (input.name || '').toLowerCase();
      const idStr = (input.id || '').toLowerCase();
      const placeholderStr = (input.placeholder || '').toLowerCase();
      if (typeStr === 'search' || /search|query|^q$/i.test(nameStr || idStr || placeholderStr || '')) {
        return;
      }

      const labelText = getLabelText(input);
      let value = matchFieldToProfile(labelText, sessionData);

      if (!value && sessionData.customFields && sessionData.customFields.length > 0) {
        const combinedHint = labelText.toLowerCase().replace(/\s+/g, ' ');
        for (const custom of sessionData.customFields) {
          const label = custom.label.toLowerCase();
          const key = custom.key.toLowerCase();
          if (combinedHint.includes(label) || combinedHint.includes(key)) {
            value = sessionData[custom.key];
            if (value) break;
          }
        }
      }

      // Google Forms date-input fallback
      if (!value && input.type === 'date' && sessionData.dob) {
        const questionCard = input.closest('[role="listitem"], [data-params], .Qr7Oae, .freebirdFormviewItemStandardcontainer, .geS5n, fieldset');
        let foundDobText = false;
        if (questionCard) {
          const txt = (questionCard.textContent || '').toLowerCase();
          if (/\b(dob|birth|born|जन्म)\b/i.test(txt)) {
            foundDobText = true;
          }
        }
        if (!foundDobText) {
          let ancestor = input.parentElement;
          for (let d = 0; ancestor && d < 8; d++) {
            if (ancestor.tagName === 'FORM' || ancestor.tagName === 'BODY') break;
            const txt = (ancestor.textContent || '').toLowerCase();
            if (txt.length < 300 && /\b(birth|dob|born|जन्म)\b/i.test(txt)) {
              foundDobText = true;
              break;
            }
            ancestor = ancestor.parentElement;
          }
        }
        if (foundDobText) {
          value = sessionData.dob;
        }
      }

      if (value) {
        console.log(`[FormSarthi Match] Text Field: "${labelText.substring(0, 50)}" -> Value: ${value}`);
        let finalVal = value;
        if (input.type === 'date') {
          finalVal = formatDateForInput(value);
        }
        const prototype = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(input, finalVal);
        } else {
          input.value = finalVal;
        }
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('focus',  { bubbles: true }));
        input.dispatchEvent(new Event('blur',   { bubbles: true }));
        filled++;
      }
    });

    // Single-date fallback
    if (sessionData.dob) {
      const allDateInputs = document.querySelectorAll('input[type="date"]');
      const emptyDateInputs = Array.from(allDateInputs).filter(inp => !inp.value);
      if (allDateInputs.length === 1 && emptyDateInputs.length === 1) {
        const dateInput = emptyDateInputs[0];
        const formattedDate = formatDateForInput(sessionData.dob);
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(dateInput, formattedDate);
        } else {
          dateInput.value = formattedDate;
        }
        dateInput.dispatchEvent(new Event('input',  { bubbles: true }));
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        dateInput.dispatchEvent(new Event('focus',  { bubbles: true }));
        dateInput.dispatchEvent(new Event('blur',   { bubbles: true }));
        filled++;
        console.log(`[FormSarthi Match] Single-date fallback: dob -> ${formattedDate}`);
      }
    }

    filled += fillSelectAndRadio(sessionData);

    return filled;
  },

  // Count how many form fields on the current page are empty
  countEmptyFields() {
    const inputs = document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea'
    );
    let empty = 0;
    inputs.forEach(i => { if (!i.value.trim()) empty++; });
    return { total: inputs.length, empty, filled: inputs.length - empty };
  }
};
