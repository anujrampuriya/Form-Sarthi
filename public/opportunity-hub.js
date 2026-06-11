// ════════════════════════════════════════════════════
// FORMSARTHI — OPPORTUNITY HUB MODULE
// ════════════════════════════════════════════════════

const OPP_MOCK_DATA = [
  // SCHOLARSHIPS
  { id:'opp1',  cat:'scholarship', title:'National Merit Scholarship (NMMS)',           org:'Ministry of Education',                   deadline:'2025-09-30', desc:'Merit-cum-means scholarship for Class 8 students. ₹12,000/year for continuation of education at secondary level.',            link:'https://scholarships.gov.in',          eligibility:{ qualification:['school'], ageMax:18 },                                             tags:['school','merit','government'] },
  { id:'opp2',  cat:'scholarship', title:'Post Matric Scholarship for SC Students',     org:'Ministry of Social Justice',              deadline:'2025-10-31', desc:'Full tuition fee reimbursement + maintenance allowance for SC students pursuing post-matric education.',                      link:'https://scholarships.gov.in',          eligibility:{ qualification:['college','postgrad'], caste:['sc'] },                              tags:['sc','scholarship','college'] },
  { id:'opp3',  cat:'scholarship', title:'Central Sector Scheme of Scholarship',        org:'Dept. of Higher Education',               deadline:'2025-11-15', desc:'For college students scoring above 80th percentile in Class 12. ₹10,000–₹20,000 per annum.',                                link:'https://scholarships.gov.in',          eligibility:{ qualification:['college'] },                                                       tags:['college','merit','all streams'] },
  { id:'opp4',  cat:'scholarship', title:'Pragati Scholarship for Girls (AICTE)',       org:'AICTE',                                   deadline:'2025-12-01', desc:'₹50,000/year for girl students pursuing technical education. One scholarship per family.',                                    link:'https://aicte-india.org',              eligibility:{ qualification:['college'], streams:['pcm','pcmb'] },                               tags:['girls','engineering','technical'] },
  { id:'opp5',  cat:'scholarship', title:'INSPIRE Scholarship (DST)',                   org:'Dept. of Science & Technology',           deadline:'2025-12-15', desc:'₹80,000/year for top 1% students in Class 12 pursuing natural sciences. 5-year scholarship.',                               link:'https://online-inspire.gov.in',        eligibility:{ qualification:['college'], streams:['pcm','pcb','pcmb'] },                         tags:['science','pcm','pcb'] },

  // INTERNSHIPS
  { id:'opp6',  cat:'internship',  title:'ISRO ICRB Summer Internship',                 org:'ISRO',                                    deadline:'2025-08-31', desc:'Paid internship for engineering and science students. Work on space mission projects. Stipend ₹10,000–₹14,000/month.',      link:'https://isro.gov.in',                  eligibility:{ qualification:['college'], streams:['pcm','pcmb'] },                               tags:['engineering','science','paid'] },
  { id:'opp7',  cat:'internship',  title:'DRDO Research Internship',                    org:'DRDO',                                    deadline:'2025-09-15', desc:'Technical internship for B.Tech/M.Tech students in electronics, CS, mechanical and related engineering streams.',            link:'https://drdo.gov.in',                  eligibility:{ qualification:['college','postgrad'], streams:['pcm','pcmb'] },                    tags:['defense','engineering','research'] },
  { id:'opp8',  cat:'internship',  title:'PM Internship Scheme 2025',                   org:'Ministry of Corporate Affairs',           deadline:'2025-10-15', desc:"Internship at India's top 500 companies. ₹5,000/month + ₹6,000 one-time grant. 12-month program for youth.",              link:'https://pminternship.mca.gov.in',      eligibility:{ qualification:['college'], ageMax:24, ageMin:21 },                                 tags:['government','all streams','paid'] },
  { id:'opp9',  cat:'internship',  title:'CA Articleship (ICAI)',                       org:'ICAI',                                    deadline:'2025-12-31', desc:'Mandatory 3-year paid articleship for CA Foundation/Intermediate qualified students under a practicing CA.',                link:'https://icai.org',                     eligibility:{ qualification:['college'], streams:['commerce_math','commerce_no_math'] },          tags:['commerce','ca','finance'] },
  { id:'opp10', cat:'internship',  title:'Teach For India Fellowship',                  org:'Teach For India',                         deadline:'2025-11-30', desc:'2-year paid fellowship teaching underprivileged children. Stipend ₹18,000/month + accommodation support.',                 link:'https://teachforindia.org',            eligibility:{ qualification:['college','postgrad'] },                                            tags:['humanities','arts','social work'] },

  // GOVERNMENT SCHEMES
  { id:'opp11', cat:'scheme',      title:'PM-YASASVI Scholarship Scheme',               org:'Ministry of Social Justice',              deadline:'2025-10-01', desc:'Scholarship for OBC/EBC/DNT students studying in Classes 9 & 11. ₹75,000–₹1,25,000 per year.',                              link:'https://yet.nta.ac.in',                eligibility:{ caste:['obc','ews'], qualification:['school'] },                                   tags:['obc','ews','school'] },
  { id:'opp12', cat:'scheme',      title:'Begum Hazrat Mahal National Scholarship',     org:'Maulana Azad Education Foundation',       deadline:'2025-09-30', desc:'Scholarship for meritorious minority girl students (Class 9–12). ₹5,000–₹6,000 per year.',                                 link:'https://maef.nic.in',                  eligibility:{ qualification:['school'] },                                                        tags:['girls','minority','school'] },
  { id:'opp13', cat:'scheme',      title:'Mukhyamantri Medhavi Vidyarthi Yojana (MP)', org:'Govt. of Madhya Pradesh',                 deadline:'2025-08-31', desc:'Free college education for students scoring above 70% in Class 12 from MP board. Covers full tuition fees.',                link:'https://scholarshipportal.mp.nic.in',  eligibility:{ qualification:['school','college'] },                                              tags:['mp','state scheme','all streams'] },
  { id:'opp14', cat:'scheme',      title:'Startup India Seed Fund Scheme',              org:'DPIIT, Ministry of Commerce',             deadline:'2025-12-31', desc:'Up to ₹20 lakh grant for early-stage startups. For young entrepreneurs with innovative business ideas.',                    link:'https://startupindia.gov.in',          eligibility:{ qualification:['college','postgrad'], ageMax:35 },                                 tags:['startup','business','government'] },

  // ADMISSIONS
  { id:'opp15', cat:'admission',   title:'JEE Advanced 2026 Registration',              org:'IIT Delhi (Organizing Institute)',         deadline:'2026-04-30', desc:'Admission to IIT B.Tech programs. Top 2.5 lakh JEE Main qualifiers are eligible to appear.',                               link:'https://jeeadv.ac.in',                 eligibility:{ qualification:['school','college'], streams:['pcm','pcmb'] },                      tags:['engineering','iit','pcm','jee'] },
  { id:'opp16', cat:'admission',   title:'CLAT 2026 — National Law Universities',       org:'Consortium of NLUs',                      deadline:'2026-01-15', desc:'Common Law Admission Test for 5-year integrated LLB programs at all National Law Universities.',                            link:'https://consortiumofnlus.ac.in',       eligibility:{ qualification:['school','college'] },                                              tags:['law','clat','nlu','all streams'] },
  { id:'opp17', cat:'admission',   title:'NIFT Entrance Test 2026',                     org:'National Institute of Fashion Technology', deadline:'2026-01-30', desc:'Design + management admission across 17 NIFT campuses. B.Des, B.FTech and M.Des programs.',                               link:'https://nift.ac.in',                   eligibility:{ qualification:['school','college'], streams:['arts','pcmb','pcm','pcb'] },          tags:['design','fashion','arts'] },
  { id:'opp18', cat:'admission',   title:'CUET UG 2026',                                org:'National Testing Agency (NTA)',            deadline:'2026-03-31', desc:'Common University Entrance Test for central university admissions. All streams eligible.',                                  link:'https://cuet.samarth.ac.in',           eligibility:{ qualification:['school'] },                                                        tags:['all streams','central university','ug'] },

  // COMPETITIONS
  { id:'opp19', cat:'competition', title:'Smart India Hackathon 2025',                  org:'Ministry of Education',                   deadline:'2025-09-30', desc:'National hackathon for students to solve real government problems. Cash prizes up to ₹1 lakh per team.',                    link:'https://sih.gov.in',                   eligibility:{ qualification:['college'], streams:['pcm','pcmb'] },                               tags:['engineering','coding','hackathon'] },
  { id:'opp20', cat:'competition', title:'Atal Tinkering Marathon',                     org:'Atal Innovation Mission (NITI Aayog)',    deadline:'2025-10-31', desc:'Innovation competition for school students (Class 6–12). Build real-world solutions. Prizes up to ₹10,000.',              link:'https://aim.gov.in',                   eligibility:{ qualification:['school'], ageMax:18 },                                             tags:['school','innovation','stem'] }
];

let currentOppFilter = 'all';
const OPP_CAT_ICONS  = { scholarship:'🎓', internship:'💼', scheme:'🏛️', admission:'🏫', competition:'🏆' };
const OPP_CAT_LABELS = { scholarship:'Scholarship', internship:'Internship', scheme:'Govt Scheme', admission:'Admission', competition:'Competition' };

function setOppFilter(cat, btnEl) {
  currentOppFilter = cat;
  document.querySelectorAll('[id^="opp-filter-"]').forEach(b => b.classList.remove('active-filter'));
  if (btnEl) btnEl.classList.add('active-filter');
  renderOpportunities();
}

function checkOppEligibility(opp, prefs) {
  if (!prefs) return 'unknown';
  const el = opp.eligibility;
  if (!el) return 'yes';
  const age = parseInt(prefs.age) || 0;
  if (el.ageMin && age > 0 && age < el.ageMin) return 'no';
  if (el.ageMax && age > 0 && age > el.ageMax) return 'no';
  if (el.caste && el.caste.length > 0 && !el.caste.includes(prefs.caste)) return 'no';
  if (el.streams && el.streams.length > 0 && !el.streams.includes(prefs.stream)) return 'no';
  if (el.qualification && el.qualification.length > 0 && !el.qualification.includes(prefs.qualification)) return 'no';
  return 'yes';
}

function getDeadlineInfo(ds) {
  const diff = new Date(ds) - new Date();
  const days = Math.ceil(diff / 86400000);
  if (days < 0) return { label:'Closed', urgent:false, closed:true };
  if (days === 0) return { label:'Closes Today!', urgent:true, closed:false };
  if (days <= 7)  return { label:`${days}d left`, urgent:true, closed:false };
  return { label: new Date(ds).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}), urgent:false, closed:false };
}

function renderOpportunities() {
  const grid   = document.getElementById('opp-grid');
  const empty  = document.getElementById('opp-empty');
  const notice = document.getElementById('opp-eligibility-notice');
  if (!grid) return;

  // activeProfile is global from main index.html
  const prefs   = (typeof activeProfile !== 'undefined' && activeProfile)
    ? JSON.parse(localStorage.getItem('fs_survey_prefs_' + activeProfile) || 'null')
    : null;
  const searchQ = (document.getElementById('opp-search')?.value || '').toLowerCase().trim();

  if (notice) notice.style.display = prefs ? 'block' : 'none';

  let filtered = OPP_MOCK_DATA.filter(o => {
    if (currentOppFilter !== 'all' && o.cat !== currentOppFilter) return false;
    if (searchQ) {
      const hay = (o.title + ' ' + o.desc + ' ' + o.org + ' ' + (o.tags || []).join(' ')).toLowerCase();
      if (!hay.includes(searchQ)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  // Sort: eligible → unknown → not eligible
  const order = { yes:0, unknown:1, no:2 };
  filtered.sort((a, b) => order[checkOppEligibility(a, prefs)] - order[checkOppEligibility(b, prefs)]);

  grid.innerHTML = filtered.map(o => {
    const elig = checkOppEligibility(o, prefs);
    const dl   = getDeadlineInfo(o.deadline);

    const eligBadge = elig === 'yes'
      ? '<span class="opp-eligible-badge yes">✅ Eligible</span>'
      : elig === 'no'
      ? '<span class="opp-eligible-badge no">✕ Not Eligible</span>'
      : '<span class="opp-eligible-badge unknown">? Check Eligibility</span>';

    const dlStyle  = dl.closed ? 'text-decoration:line-through;opacity:.5;' : '';
    const dlBadge  = '<span class="opp-deadline-badge ' + (dl.urgent ? 'urgent' : '') + '" style="' + dlStyle + '">⏰ ' + dl.label + '</span>';
    const overlay  = dl.closed
      ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,0.38);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#f87171;pointer-events:none;letter-spacing:1px;">APPLICATION CLOSED</div>'
      : '';
    const applyBtn = dl.closed
      ? '<button class="btn" style="font-size:11px;padding:6px 14px;opacity:0.45;cursor:not-allowed;" disabled>Apply Now →</button>'
      : '<button class="btn" style="font-size:11px;padding:6px 14px;" onclick="window.open(\'' + o.link + '\',\'_blank\')">Apply Now →</button>';

    return '<div class="opp-card" data-cat="' + o.cat + '">' +
        overlay +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;flex-wrap:wrap;">' +
          '<span class="opp-cat-pill ' + o.cat + '">' + OPP_CAT_ICONS[o.cat] + ' ' + OPP_CAT_LABELS[o.cat] + '</span>' +
          eligBadge +
        '</div>' +
        '<div>' +
          '<div style="font-size:14px;font-weight:700;line-height:1.4;margin-bottom:3px;">' + o.title + '</div>' +
          '<div style="font-size:11px;color:var(--muted);font-weight:600;">' + o.org + '</div>' +
        '</div>' +
        '<p style="font-size:12px;color:var(--muted);line-height:1.6;flex:1;">' + o.desc + '</p>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;flex-wrap:wrap;gap:8px;">' +
          dlBadge + applyBtn +
        '</div>' +
      '</div>';
  }).join('');

  // Update nav badge
  const badge = document.getElementById('opp-count-badge');
  if (badge) {
    const eligCount = filtered.filter(o => checkOppEligibility(o, prefs) === 'yes').length;
    badge.textContent = eligCount > 0 ? eligCount : filtered.length;
  }
}

function initOpportunityHub() {
  const allBtn = document.getElementById('opp-filter-all');
  if (allBtn) allBtn.classList.add('active-filter');
  renderOpportunities();

  // Notify once per session about matching opportunities
  const ap = (typeof activeProfile !== 'undefined') ? activeProfile : null;
  if (ap && !sessionStorage.getItem('fs_opp_notified')) {
    sessionStorage.setItem('fs_opp_notified', '1');
    const prefs = JSON.parse(localStorage.getItem('fs_survey_prefs_' + ap) || 'null');
    const count = OPP_MOCK_DATA.filter(o => checkOppEligibility(o, prefs) === 'yes').length;
    if (count > 0) {
      setTimeout(() => {
        if (typeof sendNotification === 'function') {
          sendNotification('🌟 Opportunity Hub', count + ' opportunities match your profile! Open FormSarthi to explore.');
        }
        if (typeof toast === 'function') {
          toast('✨ ' + count + ' opportunities match your profile — check Opportunity Hub!', 'success');
        }
      }, 3500);
    }
  }
}
