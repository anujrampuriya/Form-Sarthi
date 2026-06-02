// autofill.js — FormSarthi field mapper
// Maps user's extracted data to form field names
// Works by matching common field labels / input names
// Supports 30 custom fields across multiple domains

const FS_Autofill = {

  // All known field mappings — label shown to user → key in sessionData
  _fieldMap: [
    // Personal Info
    { label: 'Full Name',         key: 'name',          hints: ['name', 'fullname', 'full_name', 'applicant', 'candidate'] },
    { label: 'Date of Birth',     key: 'dob',           hints: ['dob', 'birth', 'dateofbirth', 'date_of_birth', 'born'] },
    { label: 'Gender',            key: 'gender',        hints: ['gender', 'sex', 'gender_type'] },
    { label: 'Caste / Category',  key: 'caste',         hints: ['caste', 'category', 'social_status', 'community', 'reservation'] },
    { label: 'Nationality',       key: 'nationality',   hints: ['nationality', 'citizenship', 'citizen'] },
    { label: 'Religion',          key: 'religion',      hints: ['religion', 'faith'] },
    { label: 'Blood Group',       key: 'blood_group',   hints: ['blood', 'bloodgroup', 'blood_group', 'bg'] },
    { label: 'Marital Status',    key: 'marital_status',hints: ['marital', 'marriage', 'married', 'marital_status'] },

    // Contact Details
    { label: 'Mobile Number',     key: 'phone',         hints: ['phone', 'mobile', 'contact', 'cell', 'number', 'telephone'] },
    { label: 'Alternate Mobile',  key: 'alt_phone',     hints: ['alt_phone', 'altphone', 'alternate', 'emergency_contact', 'alt_mobile'] },
    { label: 'Email Address',     key: 'email',         hints: ['email', 'mail', 'emailid', 'e-mail'] },
    { label: 'Address',           key: 'address',       hints: ['address', 'addr', 'residence', 'location', 'permanent_address', 'corr_address'] },
    { label: 'City',              key: 'city',          hints: ['city', 'town', 'district'] },
    { label: 'State',             key: 'state',         hints: ['state', 'province', 'region'] },
    { label: 'Pincode',           key: 'pincode',       hints: ['pincode', 'pin', 'zip', 'postal', 'zipcode'] },

    // Academic Records
    { label: 'Class 10 Roll No',  key: 'roll_10',       hints: ['roll_10', 'roll10', 'class_10_roll', 'ssc_roll', 'roll_no_10', 'matric_roll'] },
    { label: 'Class 10 Board',    key: 'board_10',      hints: ['board_10', 'board10', 'ssc_board', 'class_10_board', 'matric_board'] },
    { label: 'Class 10 Marks',    key: 'marks_10',      hints: ['marks_10', 'marks10', 'ssc_marks', 'class_10_marks', 'ssc_percent', 'matric_percent', 'percentage_10'] },
    { label: 'Class 12 Roll No',  key: 'roll_12',       hints: ['roll_12', 'roll12', 'class_12_roll', 'hsc_roll', 'roll_no_12', 'inter_roll'] },
    { label: 'Class 12 Board',    key: 'board_12',      hints: ['board_12', 'board12', 'hsc_board', 'class_12_board', 'inter_board'] },
    { label: 'Class 12 Marks',    key: 'marks_12',      hints: ['marks_12', 'marks12', 'hsc_marks', 'class_12_marks', 'hsc_percent', 'inter_percent', 'percentage_12'] },
    { label: 'College / Institute',key: 'college',      hints: ['college', 'institute', 'university', 'school', 'inst_name'] },
    { label: 'Degree',            key: 'degree',        hints: ['degree', 'course', 'qualification', 'program', 'stream', 'graduation'] },
    { label: 'Graduation Year',   key: 'grad_year',     hints: ['grad_year', 'gradyear', 'year_of_passing', 'passing_year', 'grad_date'] },

    // Identity & Finance
    { label: 'Aadhaar Number',    key: 'aadhaar',       hints: ['aadhaar', 'aadhar', 'uid', 'uidai'] },
    { label: 'PAN Number',        key: 'pan',           hints: ['pan', 'panno', 'pan_number', 'permanent_account'] },
    { label: 'DL / Passport',     key: 'dl',            hints: ['driving', 'licence', 'license', 'dl', 'passport', 'passport_no', 'passport_number'] },
    { label: 'Bank Name',         key: 'bank_name',     hints: ['bank_name', 'bankname', 'bank_title', 'bankname'] },
    { label: 'Bank Account No',   key: 'account_no',    hints: ['account_no', 'accountno', 'account_number', 'acc_no', 'ac_no', 'ac_num', 'bank_account'] },
    { label: 'IFSC Code',         key: 'ifsc',          hints: ['ifsc', 'ifsccode', 'ifsc_code', 'bank_ifsc'] }
  ],

  // Returns array of { label, key, value } for the completeness meter
  mapFields(sessionData) {
    return this._fieldMap.map(field => ({
      label: field.label,
      key:   field.key,
      value: sessionData[field.key] || null,
    }));
  },

  // When the extension is ready — inject values into a live form
  // This is called from the browser extension content script
  injectIntoForm(sessionData) {
    const inputs = document.querySelectorAll('input, textarea, select');
    let filled = 0;

    inputs.forEach(input => {
      const hint = (
        (input.name || '') +
        (input.id   || '') +
        (input.placeholder || '') +
        (input.getAttribute('aria-label') || '')
      ).toLowerCase();

      for (const field of this._fieldMap) {
        const matched = field.hints.some(h => hint.includes(h));
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
