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
    const inputs = document.querySelectorAll('input, textarea, select');
    let filled = 0;

    const activeMap = [...this._fieldMap];
    if (sessionData && sessionData.customFields) {
      sessionData.customFields.forEach(custom => {
        activeMap.push({
          label: custom.label,
          key:   custom.key,
          hints: [custom.label.toLowerCase(), custom.key.toLowerCase()]
        });
      });
    }

    // Pre-scan: count date inputs for single-date-field fallback
    const dateInputs = Array.from(inputs).filter(i => i.type === 'date');
    const onlyOneDateInput = dateInputs.length === 1;

    inputs.forEach(input => {
      const hint = this._getFullHint(input);

      // Guard rails based on input types
      if (input.type === 'email') {
        if (sessionData.email) {
          input.value = sessionData.email;
          input.dispatchEvent(new Event('input',  { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
        return;
      }
      
      if (input.type === 'date') {
        if (sessionData.dob) {
          // Match if hint contains date-of-birth keywords OR if it's the only date input
          const isDobField = hint.includes('dob') || hint.includes('birth') || hint.includes('date of birth') || hint.includes('dateofbirth') || hint.includes('born');
          if (isDobField || onlyOneDateInput) {
            input.value = this.formatDateForInput(sessionData.dob);
            input.dispatchEvent(new Event('input',  { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }
        }
        return;
      }

      for (const field of activeMap) {
        // 1. Exact matches (if provided)
        let matched = false;
        if (field.exact) {
          const rawName = (input.name || '').toLowerCase();
          const rawId = (input.id || '').toLowerCase();
          matched = field.exact.some(e => e === rawName || e === rawId || e === input.type);
        }

        // 2. Hint matches using word boundaries
        if (!matched) {
          matched = field.hints.some(h => new RegExp(`\\b${h}\\b`, 'i').test(hint));
        }

        if (matched && sessionData[field.key]) {
          input.value = sessionData[field.key];
          // Trigger React/Vue/Angular change detection
          input.dispatchEvent(new Event('input',  { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
          break;
        }
      }
    });

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
