// ============================================================
// practice-form.js — the professional file, in ONE place.
//
// "Tell us about your practice" — full name, level, country, telephone,
// licence number, hospital, university, specialty — used to live inside
// role-select.html, because stating it and becoming a doctor were the same
// act. They are two acts now: role-select.html opens the account, and this
// form is what somebody fills in when they ask to be verified.
//
// It is mounted in two places for one reason each:
//   · doctor-pending.html — the verification step. This is its real home.
//   · role-select.html    — ONLY as the fallback for a database that has not
//                           had v9_3 applied, where the eight fields are still
//                           required to create the account at all.
//
// So it is a file rather than a copy in each page. The country list, the dial
// codes, the hospital and university suggestions and the validation are the
// kind of data that drifts the moment there are two of it, and a doctor being
// offered a different list of countries depending on which page they are
// standing on is exactly the class of bug this avoids.
//
// IT MAKES NO AUTHORIZATION DECISION. Every value here is a claim a person
// makes about themselves. The single write goes through
// submit_doctor_onboarding(), which validates the same eight fields again
// server-side and derives verification_status itself. Nothing in this file is
// trusted by anything.
// ============================================================
(function(){

  /* ── Countries ──────────────────────────────────────────────────────────
     Dial code travels with the country so the phone field can show the right
     prefix without a second question. Deliberately small and ordinary rather
     than pretending to be an authoritative ISO dataset. */
  var COUNTRIES = [
    { name:'Israel',         iso:'IL', dial:'+972' },
    { name:'Georgia',        iso:'GE', dial:'+995' },
    { name:'United Kingdom', iso:'GB', dial:'+44'  },
    { name:'United States',  iso:'US', dial:'+1'   },
    { name:'Canada',         iso:'CA', dial:'+1'   },
    { name:'Germany',        iso:'DE', dial:'+49'  },
    { name:'France',         iso:'FR', dial:'+33'  },
    { name:'Italy',          iso:'IT', dial:'+39'  },
    { name:'Spain',          iso:'ES', dial:'+34'  },
    { name:'Netherlands',    iso:'NL', dial:'+31'  },
    { name:'Poland',         iso:'PL', dial:'+48'  },
    { name:'Turkey',         iso:'TR', dial:'+90'  },
    { name:'India',          iso:'IN', dial:'+91'  },
    { name:'Australia',      iso:'AU', dial:'+61'  },
    { name:'Other',          iso:'',   dial:''     }
  ];

  /* Time zone → country. Reliable enough to save a tap and wrong often enough
     that it must never be more than a default: the field stays editable, the
     hint says we guessed, and nothing downstream treats it as verified. It is
     a device setting, not evidence of where anyone practises. */
  var TZ_COUNTRY = {
    'Asia/Jerusalem':'Israel', 'Asia/Tel_Aviv':'Israel', 'Asia/Tbilisi':'Georgia',
    'Europe/London':'United Kingdom', 'Europe/Berlin':'Germany', 'Europe/Paris':'France',
    'Europe/Rome':'Italy', 'Europe/Madrid':'Spain', 'Europe/Amsterdam':'Netherlands',
    'Europe/Warsaw':'Poland', 'Europe/Istanbul':'Turkey', 'Asia/Kolkata':'India',
    'Asia/Calcutta':'India', 'Australia/Sydney':'Australia', 'Australia/Melbourne':'Australia',
    'America/Toronto':'Canada', 'America/Vancouver':'Canada',
    'America/New_York':'United States', 'America/Chicago':'United States',
    'America/Denver':'United States', 'America/Los_Angeles':'United States'
  };

  /* Institution suggestions, by country. A convenience only — the inputs are
     free text and a <datalist> never constrains what can be typed. There is no
     trustworthy global registry of hospitals or medical schools we could ship
     or call, and a closed list would lock out exactly the doctors least likely
     to be on it. So: help where we can, block nobody. */
  var HOSPITALS = {
    'Israel':['Sheba Medical Center','Ichilov (Sourasky)','Hadassah Ein Kerem','Rambam Health Care Campus','Shaare Zedek Medical Center','Rabin Medical Center (Beilinson)','Soroka Medical Center'],
    'Georgia':['Tbilisi State Medical University Hospital','Aversi Clinic','New Hospitals','Ingorokva High Medical Technology Center'],
    'United Kingdom':['Guy’s and St Thomas’','Royal Free Hospital','Addenbrooke’s Hospital','Manchester Royal Infirmary','John Radcliffe Hospital'],
    'United States':['Massachusetts General Hospital','Cleveland Clinic','Johns Hopkins Hospital','Mayo Clinic','Stanford Health Care'],
    'Germany':['Charité Berlin','Universitätsklinikum Heidelberg','LMU Klinikum München'],
    'India':['AIIMS New Delhi','Christian Medical College Vellore','Tata Memorial Hospital']
  };
  var UNIVERSITIES = {
    'Israel':['Tel Aviv University','Hebrew University of Jerusalem','Technion — Israel Institute of Technology','Ben-Gurion University of the Negev'],
    'Georgia':['Tbilisi State Medical University','Ivane Javakhishvili Tbilisi State University','David Tvildiani Medical University'],
    'United Kingdom':['University of Oxford','University of Cambridge','Imperial College London','University of Edinburgh'],
    'United States':['Harvard Medical School','Johns Hopkins University','Stanford University','University of Pennsylvania'],
    'Germany':['Charité — Universitätsmedizin Berlin','Heidelberg University','LMU Munich'],
    'India':['All India Institute of Medical Sciences','Christian Medical College Vellore','Maulana Azad Medical College']
  };

  var SPECIALTIES = ['Anesthesiology','Anesthesiology & Intensive Care','Intensive Care / ICU',
                     'Pain Medicine','Emergency Medicine','Surgery','Other'];

  /* The label each field is called by when we have to ask for it. Server and
     client use the same keys, so one map answers both. */
  var LABEL = {
    full_name:'your full name', professional_level:'your professional level',
    country:'your country', phone:'a telephone number',
    medical_license_number:'your licence number', hospital:'your hospital',
    medical_university:'your medical university', specialty:'your specialty'
  };

  var _host = null, _level = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function q(sel){ return _host ? _host.querySelector(sel) : null; }

  /* Styles ride with the component so both hosts render it identically, and
     every value is a token — this form has no palette of its own. */
  function injectCSS(){
    if(document.getElementById('pf-css')) return;
    var s = document.createElement('style'); s.id = 'pf-css';
    s.textContent = ''
      + '.pf-sec{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;'
      +   'color:var(--brand-read);margin:22px 0 11px;padding-bottom:8px;border-bottom:1px solid var(--line);}'
      + '.pf-sec:first-child{margin-top:0;}'
      + '.pf-f{margin-bottom:13px;}'
      + '.pf-f label{display:block;font-size:10px;color:var(--ink-faint);letter-spacing:.06em;'
      +   'text-transform:uppercase;font-weight:600;margin-bottom:6px;}'
      + '.pf-f input,.pf-f select{width:100%;background:var(--surface-2);border:1px solid var(--line-2);'
      +   'border-radius:var(--radius-sm);padding:11px 13px;color:var(--ink);font-size:14.5px;'
      +   'font-family:inherit;outline:none;transition:border-color var(--dur-2);min-height:44px;}'
      + '.pf-f select{appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath fill=\'%237ECFC0\' d=\'M0 0l5 6 5-6z\'/%3E%3C/svg%3E");'
      +   'background-repeat:no-repeat;background-position:right 13px center;padding-right:32px;}'
      + '.pf-f input:focus,.pf-f select:focus{border-color:var(--brand-mid);}'
      + '.pf-f select option{background:var(--ground-3);color:var(--ink);}'
      + '.pf-hint{font-size:11.5px;color:var(--ink-faint);margin-top:6px;line-height:1.5;}'
      + '.pf-phone{display:grid;grid-template-columns:96px 1fr;gap:8px;}'
      + '.pf-dial{display:flex;align-items:center;justify-content:center;background:var(--surface-2);'
      +   'border:1px solid var(--line-2);border-radius:var(--radius-sm);font-size:14.5px;'
      +   'color:var(--brand-read);min-height:44px;font-variant-numeric:tabular-nums;}'
      + '.pf-seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;}'
      + '.pf-seg button{background:var(--surface);border:1.5px solid var(--line-2);'
      +   'border-radius:var(--radius-sm);padding:12px 10px;color:var(--ink-2);font-family:inherit;'
      +   'font-size:13.5px;font-weight:600;cursor:pointer;min-height:46px;'
      +   'transition:border-color var(--dur-2),background var(--dur-2),color var(--dur-2);}'
      + '.pf-seg button:hover{border-color:var(--brand-tint-2);color:var(--ink);}'
      + '.pf-seg button.on{border-color:var(--brand-mid);background:var(--brand-tint);color:var(--ink);}'
      + '.pf-seg button:focus-visible{outline:2px solid var(--brand-lift);outline-offset:2px;}'
      + '@media(max-width:480px){.pf-seg{grid-template-columns:1fr;}}';
    document.head.appendChild(s);
  }

  /* ── mount ──────────────────────────────────────────────────────────────
     Renders the eight fields into `host`. opts.hideName omits the name field
     for a host that has already asked for it. */
  function mount(host, opts){
    opts = opts || {};
    if(!host) return;
    injectCSS();
    _host = host;
    _level = null;

    var nameBlock = opts.hideName ? '' :
      '<div class="pf-sec">You</div>' +
      '<div class="pf-f"><label for="pf-name">Full name *</label>' +
      '<input type="text" id="pf-name" autocomplete="name" placeholder="As it appears on your registration"></div>';

    host.innerHTML =
      nameBlock +
      (opts.hideName ? '<div class="pf-sec">You</div>' : '') +
      '<div class="pf-f"><label>Professional level *</label><div class="pf-seg">' +
        '<button type="button" id="pf-lvl-consultant" data-lvl="consultant">Consultant / Specialist</button>' +
        '<button type="button" id="pf-lvl-resident" data-lvl="resident">Resident</button>' +
      '</div></div>' +
      '<div class="pf-f"><label for="pf-country">Country *</label>' +
        '<select id="pf-country"></select>' +
        '<div class="pf-hint" id="pf-country-hint" style="display:none">' +
        'We guessed this from your device’s time zone — please correct it if it’s wrong.</div></div>' +
      '<div class="pf-f"><label for="pf-phone">Telephone *</label>' +
        '<div class="pf-phone"><div class="pf-dial" id="pf-dial">+—</div>' +
        '<input type="tel" id="pf-phone" autocomplete="tel-national" inputmode="tel" placeholder="Phone number"></div>' +
        '<div class="pf-hint">Used only to reach you about verification.</div></div>' +

      '<div class="pf-sec">Your practice</div>' +
      '<div class="pf-f"><label for="pf-license">Medical license / registration number *</label>' +
        '<input type="text" id="pf-license" placeholder="As issued by your medical council"></div>' +
      '<div class="pf-f"><label for="pf-hospital">Hospital / institution *</label>' +
        '<input type="text" id="pf-hospital" list="pf-dl-hospital" autocomplete="organization" placeholder="Where you practise">' +
        '<datalist id="pf-dl-hospital"></datalist>' +
        '<div class="pf-hint">Suggestions are a starting point — type any institution.</div></div>' +
      '<div class="pf-f"><label for="pf-university">Medical university *</label>' +
        '<input type="text" id="pf-university" list="pf-dl-university" placeholder="Where you qualified">' +
        '<datalist id="pf-dl-university"></datalist>' +
        '<div class="pf-hint">Suggestions are a starting point — type any university.</div></div>' +
      '<div class="pf-f"><label for="pf-specialty">Specialty *</label><select id="pf-specialty">' +
        '<option value="">Select…</option>' +
        SPECIALTIES.map(function(s){ return '<option>' + esc(s) + '</option>'; }).join('') +
      '</select></div>';

    var seg = host.querySelectorAll('.pf-seg button');
    for(var i=0;i<seg.length;i++){
      seg[i].addEventListener('click', function(){ pickLevel(this.getAttribute('data-lvl')); });
    }
    q('#pf-country').addEventListener('change', onCountryChange);
    buildCountries();
  }

  function pickLevel(v){
    _level = v;
    var seg = _host.querySelectorAll('.pf-seg button');
    for(var i=0;i<seg.length;i++){
      seg[i].classList.toggle('on', seg[i].getAttribute('data-lvl') === v);
    }
  }

  function buildCountries(){
    var sel = q('#pf-country');
    sel.innerHTML = '<option value="">Select…</option>' +
      COUNTRIES.map(function(c){ return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
    var guess = null;
    try { guess = TZ_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone] || null; }
    catch(e){ guess = null; }
    if(guess){ sel.value = guess; q('#pf-country-hint').style.display = 'block'; }
    onCountryChange();
  }

  function onCountryChange(){
    var name = q('#pf-country').value;
    var c = COUNTRIES.filter(function(x){ return x.name === name; })[0];
    q('#pf-dial').textContent = (c && c.dial) ? c.dial : '+—';
    fillList('#pf-dl-hospital',   HOSPITALS[name]    || []);
    fillList('#pf-dl-university', UNIVERSITIES[name] || []);
  }

  function fillList(sel, items){
    q(sel).innerHTML = items.map(function(v){
      return '<option value="' + esc(v) + '"></option>'; }).join('');
  }

  /* ── prefill ────────────────────────────────────────────────────────────
     Whatever is already on the profile row. Carrying it over is not a
     shortcut through verification: every field stays editable, the server
     revalidates all eight, and the outcome is still an administrator's
     decision. */
  function prefill(p){
    if(!p || !_host) return;
    function set(sel, v){ var e = q(sel); if(e && v) e.value = v; }
    set('#pf-name', p.full_name);
    if(p.professional_level) pickLevel(String(p.professional_level).toLowerCase());
    if(p.country){ q('#pf-country').value = p.country;
                   q('#pf-country-hint').style.display = 'none';
                   onCountryChange(); }
    set('#pf-phone', p.phone);
    set('#pf-license', p.medical_license_number);
    set('#pf-hospital', p.hospital);
    set('#pf-university', p.medical_university);
    set('#pf-specialty', p.specialty);
  }

  /* Store something closer to E.164 than free text, without pretending to be
     a full phone-number library: strip separators, drop a national trunk '0',
     and prefix the country's dial code unless one was already typed. */
  function normalizePhone(countryName, raw){
    var c = COUNTRIES.filter(function(x){ return x.name === countryName; })[0];
    var digits = String(raw || '').replace(/[^\d+]/g, '');
    if(digits.charAt(0) === '+') return digits;
    digits = digits.replace(/^0+/, '');
    return (c && c.dial) ? (c.dial + digits) : digits;
  }

  function val(sel){ var e = q(sel); return e ? e.value.trim() : ''; }

  /* ── read ───────────────────────────────────────────────────────────────
     Returns { fields, missing }. `missing` holds server field KEYS, not
     sentences, so the caller phrases the message and the two sides never
     disagree about what a field is called. opts.name supplies the full name
     when the host asked for it outside this form. */
  function read(opts){
    opts = opts || {};
    var country = val('#pf-country');
    var f = {
      full_name:              opts.name != null ? String(opts.name).trim() : val('#pf-name'),
      professional_level:     _level || '',
      country:                country,
      phone:                  val('#pf-phone'),
      medical_license_number: val('#pf-license'),
      hospital:               val('#pf-hospital'),
      medical_university:     val('#pf-university'),
      specialty:              val('#pf-specialty')
    };
    var missing = [];
    for(var k in f){
      if(Object.prototype.hasOwnProperty.call(f, k) && !f[k]) missing.push(k);
    }
    if(f.full_name && f.full_name.length < 2 && missing.indexOf('full_name') < 0) missing.push('full_name');
    f.phone = f.phone ? normalizePhone(country, f.phone) : '';
    return { fields: f, missing: missing };
  }

  /* Turn field keys into one sentence a person can act on. Three named, then
     a count — a list of eight reads as a wall and gets skipped. */
  function phrase(keys){
    var names = (keys || []).map(function(k){ return LABEL[k] || k; });
    if(!names.length) return '';
    return 'Please add ' + names.slice(0,3).join(', ') +
           (names.length > 3 ? ', and ' + (names.length - 3) + ' more.' : '.');
  }

  /* ── submit ─────────────────────────────────────────────────────────────
     One call, through the RPC that already exists. This function does not
     decide anything: submit_doctor_onboarding() revalidates all eight fields
     and derives verification_status server-side.

     Answers { ok:true } | { message } — a caller never has to know the
     difference between a transport error, a raised authorization error and a
     structured missing-fields reply. */
  async function submit(opts){
    var r = read(opts);
    if(r.missing.length) return { ok:false, message: phrase(r.missing) };
    if(typeof window.submitDoctorOnboarding !== 'function'){
      return { ok:false, message:'Verification is temporarily unavailable. Please try again shortly.' };
    }
    var res = await window.submitDoctorOnboarding(r.fields);
    if(res && res.error) return { ok:false, message: res.error.message };
    /* No submit_doctor_onboarding() on this database means v9_1 was never
       applied. The eight columns are all self-editable there, so an ordinary
       profile write still works — but WHICH write is right depends on whether
       the caller also has to become a doctor, and only the caller knows that.
       So the state is reported, with the validated fields attached, and the
       page decides. Swallowing it here would take doctor registration down on
       every pre-v9_1 database. */
    if(res && res.legacy){
      return { ok:false, legacy:true, fields:r.fields,
               message:'Verification is temporarily unavailable. Please try again shortly.' };
    }
    if(res && res.data && res.data.ok === false){
      if(res.data.code === 'invalid_field'){
        return { ok:false, message:'Please choose ' + (LABEL[res.data.field] || res.data.field) + ' from the list.' };
      }
      return { ok:false, message: phrase(res.data.missing || []) };
    }
    return { ok:true, verification: (res && res.data && res.data.verification_status) || 'pending' };
  }

  /* Is there already a complete professional file on this profile? Decides
     whether the verification page opens showing the form or showing what was
     submitted. */
  function isComplete(p){
    if(!p) return false;
    var need = ['full_name','professional_level','country','phone',
                'medical_license_number','hospital','medical_university','specialty'];
    for(var i=0;i<need.length;i++){
      if(!p[need[i]] || !String(p[need[i]]).trim()) return false;
    }
    return true;
  }

  window.AhPractice = {
    mount: mount, prefill: prefill, read: read, submit: submit,
    phrase: phrase, isComplete: isComplete, normalizePhone: normalizePhone,
    COUNTRIES: COUNTRIES, LABEL: LABEL
  };
})();
