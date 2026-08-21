#!/usr/bin/env node
/* doctor-onboarding-split.test.js
 *
 * Creating a doctor account and being verified as a clinician are two things.
 *
 * They used to be one: registration collected a licence number, a hospital, a
 * medical university, a specialty, a professional level, a country and a
 * telephone number, and submit_doctor_onboarding() refused to make anyone a
 * doctor without all eight. This proves they have come apart, and — much more
 * importantly — that only the FIRST half got easier:
 *
 *   1. registration asks for a name, and writes verification_status='pending';
 *   2. the eight fields still exist, still go through the same unchanged RPC,
 *      and are now asked for on the verification step;
 *   3. nothing on either page can produce verification_status='approved';
 *   4. a database without v9_3 still registers doctors, by falling back to the
 *      eight-field form — because this frontend gets deployed before anyone
 *      checks which side of the migration a database is on.
 *
 * The RPCs are stubbed at the client boundary, mirroring v9_1 and v9_3. What
 * is under test is the pages' behaviour, not the database's.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK_SRC = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 130);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

/* v9_3's create_doctor_account, mirrored: a name, role='doctor',
   verification_status='pending', and NOTHING else written. An already-approved
   doctor keeps 'approved' — the real function is careful about that and a mock
   that is not would hide the regression it guards against. */
const V9_3 = `
  if(fn === 'create_doctor_account'){
    record('rpc', { fn:fn, args:p });
    var _pr = load(KEY_PROFILE) || {};
    if(_pr.is_admin === true || _pr.role === 'admin'){
      return Promise.resolve({ data:null, error:{ code:'42501',
        message:'Administrator accounts cannot change role here' } });
    }
    var _nm = (p.p_full_name == null) ? '' : String(p.p_full_name).trim();
    if(!_nm || _nm.length < 2){
      return Promise.resolve({ data:{ ok:false, code:'missing_fields',
        missing:['full_name'] }, error:null });
    }
    var _keep = (_pr.verification_status === 'approved' && _pr.role === 'doctor');
    var _nx = { role:'doctor', full_name:_nm,
                verification_status: _keep ? 'approved' : 'pending' };
    Object.keys(_nx).forEach(function(k){ profile[k] = _nx[k]; _pr[k] = _nx[k]; });
    saveProfileRow();
    record('upsert', _nx);
    return Promise.resolve({ data:{ ok:true, role:'doctor',
      verification_status:_nx.verification_status }, error:null });
  }
`;

/* A database that has NOT had v9_3 applied: PostgREST cannot find the function. */
const V9_3_ABSENT = `
  if(fn === 'create_doctor_account'){
    record('rpc', { fn:fn, args:p });
    return Promise.resolve({ data:null, error:{ code:'42883',
      message:'function public.create_doctor_account(text) does not exist' } });
  }
`;

const ANCHOR = "if(fn === 'submit_doctor_onboarding'){";

/* Source greps read CODE, not prose. Both pages carry notes naming the palette
   they used to declare and the invariant they uphold, and a grep that failed on
   a file's own documentation would only teach people to stop documenting. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const src  = f => code(fs.readFileSync('/home/user/anestheo-website/' + f, 'utf8'));

function buildMock(opts) {
  const inject = opts.v93 ? V9_3 : V9_3_ABSENT;
  if (MOCK_SRC.indexOf(ANCHOR) < 0) {
    throw new Error('mock.js no longer contains the submit_doctor_onboarding anchor');
  }
  let mock = MOCK_SRC.replace(ANCHOR, inject + '\n  ' + ANCHOR);

  /* opts.v91 === false — a database from before v9_1: the RPC is absent and
     set_own_role() still accepts 'doctor'. Both of the mock's v9_1 behaviours
     have to be switched off together; leaving either on would describe a
     database that never existed. */
  if (opts.v91 === false) {
    mock = mock.replace(ANCHOR,
      ANCHOR + " record('rpc',{fn:fn,args:p}); " +
      "return Promise.resolve({data:null,error:{code:'42883'," +
      "message:'function public.submit_doctor_onboarding(text,text,text,text,text,text,text,text) does not exist'}}); }\n" +
      '  if(false){');
    mock = mock.replace(
      "if(fn === 'set_own_role' && String(p.p_role || '').toLowerCase() === 'doctor'){",
      "if(false && fn === 'set_own_role'){");
  }
  return mock;
}

async function open(b, opts) {
  const width = opts.width || 1440;
  const ctx = await b.newContext({ viewport: { width, height: opts.height || 1000 } });
  const mock = buildMock(opts);
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status:200, contentType:'text/javascript', body: mock });
    if (/googleapis|gstatic/.test(u)) return r.fulfill({ status:200, contentType:'text/css', body:'' });
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,150)); });
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(opts.profile) + ';');
  await pg.goto(BASE + opts.path, { waitUntil:'networkidle' });
  await pg.waitForTimeout(1000);
  return { ctx, pg, errs };
}

const NEW_USER = { email:'d@e.com',
                   role:'pending', verification_status:'not_required', is_admin:false };

const PRACTICE_IDS = ['#pf-license','#pf-hospital','#pf-university','#pf-specialty',
                      '#pf-country','#pf-phone'];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1 · REGISTRATION ASKS FOR A NAME ────────────────────────────────────
  console.log('\n── registration: a doctor account is a name ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/role-select.html', profile: NEW_USER, v93:true });
    await pg.click('#ro-doctor'); await pg.waitForTimeout(300);

    const step = await pg.evaluate(ids => ({
      doctorStepOpen: document.getElementById('step-doctor').classList.contains('active'),
      nameField: !!document.getElementById('d-name'),
      practiceFieldsPresent: ids.filter(s => !!document.querySelector(s)),
      heading: (document.getElementById('rs-h')||{}).textContent.trim(),
      button: (document.getElementById('d-submit')||{}).textContent.trim(),
      requiredMarks: (document.getElementById('step-doctor')||{}).textContent.split('*').length - 1
    }), PRACTICE_IDS);

    t('choosing "I am a doctor" opens the doctor step', step.doctorStepOpen);
    t('...which asks for a name', step.nameField);
    t('...and asks for NOTHING else', step.practiceFieldsPresent.length === 0, step.practiceFieldsPresent);
    t('...exactly one required field on the step', step.requiredMarks === 1, step.requiredMarks);
    t('...heading is not "Tell us about your practice"',
      !/practice/i.test(step.heading), step.heading);
    t('...the action names what it does', /workspace/i.test(step.button), step.button);

    await pg.fill('#d-name', 'Dana Levi');
    await pg.click('#d-submit'); await pg.waitForTimeout(1500);

    const s = await pg.evaluate(() => ({
      url: location.pathname,
      rpc: (window.__calls.rpc || []).map(c => c.fn),
      profile: JSON.parse(sessionStorage.getItem('__anestheo_mock_profile') || '{}'),
      err: ((document.getElementById('doctor-err')||{}).textContent||'').trim()
    }));

    t('registration calls create_doctor_account',
      s.rpc.indexOf('create_doctor_account') >= 0, s.rpc.join(','));
    t('...and NOT submit_doctor_onboarding — no practice file is claimed',
      s.rpc.indexOf('submit_doctor_onboarding') < 0, s.rpc.join(','));
    t('...it succeeds with no error shown', s.err === '', s.err || '(none)');
    t('...the account is a doctor', s.profile.role === 'doctor', s.profile.role);
    t('...at verification_status=pending, never approved',
      s.profile.verification_status === 'pending', s.profile.verification_status);
    t('...with no licence number invented for them',
      !s.profile.medical_license_number, s.profile.medical_license_number || '(none)');
    t('...no hospital, university or specialty either',
      !s.profile.hospital && !s.profile.medical_university && !s.profile.specialty,
      [s.profile.hospital, s.profile.medical_university, s.profile.specialty]);
    t('...and lands in the clinical workspace', s.url === '/dashboard.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 2 · A NAME IS STILL REQUIRED ────────────────────────────────────────
  console.log('\n── registration: the one field is still a field ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/role-select.html', profile: NEW_USER, v93:true });
    await pg.click('#ro-doctor'); await pg.waitForTimeout(250);
    await pg.fill('#d-name', ' ');
    await pg.click('#d-submit'); await pg.waitForTimeout(700);
    const s = await pg.evaluate(() => ({
      url: location.pathname,
      err: ((document.getElementById('doctor-err')||{}).textContent||'').trim(),
      rpc: (window.__calls.rpc || []).map(c => c.fn)
    }));
    t('an empty name does not create an account',
      s.rpc.indexOf('create_doctor_account') < 0, s.rpc.join(','));
    t('...it says so in a sentence a person can act on', /name/i.test(s.err), s.err);
    t('...and stays on the page', s.url === '/role-select.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 3 · THE FALLBACK, on a database without v9_3 ────────────────────────
  console.log('\n── a database WITHOUT v9_3: registration must still work ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/role-select.html', profile: NEW_USER, v93:false });
    await pg.click('#ro-doctor'); await pg.waitForTimeout(250);
    await pg.fill('#d-name', 'Dana Levi');
    await pg.click('#d-submit'); await pg.waitForTimeout(900);

    const mid = await pg.evaluate(ids => ({
      practiceStep: document.getElementById('step-practice').classList.contains('active'),
      fieldsNow: ids.filter(s => !!document.querySelector(s)),
      said: (document.getElementById('step-practice')||{}).textContent.indexOf('few more details') >= 0
    }), PRACTICE_IDS);
    t('a missing create_doctor_account falls back to the practice form', mid.practiceStep);
    t('...with all six practice fields present', mid.fieldsNow.length === 6, mid.fieldsNow);
    t('...and says why the form got longer', mid.said);

    await pg.click('#pf-lvl-resident');
    await pg.selectOption('#pf-country', 'Israel');
    await pg.fill('#pf-phone', '050-123 4567');
    await pg.fill('#pf-license', 'IL-99231');
    await pg.fill('#pf-hospital', 'Central');
    await pg.fill('#pf-university', 'Tbilisi State');
    await pg.selectOption('#pf-specialty', 'Anesthesiology');
    await pg.click('#pr-submit'); await pg.waitForTimeout(1500);

    const s = await pg.evaluate(() => ({
      url: location.pathname,
      rpc: (window.__calls.rpc || []).map(c => c.fn),
      profile: JSON.parse(sessionStorage.getItem('__anestheo_mock_profile') || '{}'),
      err: ((document.getElementById('practice-err')||{}).textContent||'').trim()
    }));
    t('...the fallback registers through submit_doctor_onboarding',
      s.rpc.indexOf('submit_doctor_onboarding') >= 0, s.rpc.join(','));
    t('...it succeeds', s.err === '', s.err || '(none)');
    t('...the account is a doctor with the file attached',
      s.profile.role === 'doctor' && s.profile.medical_license_number === 'IL-99231',
      [s.profile.role, s.profile.medical_license_number]);
    t('...the name typed on the previous step is carried over',
      s.profile.full_name === 'Dana Levi', s.profile.full_name);
    t('...still pending, never approved', s.profile.verification_status === 'pending',
      s.profile.verification_status);
    t('...and lands in the workspace', s.url === '/dashboard.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 3b · NEITHER v9_3 NOR v9_1 ──────────────────────────────────────────
  /* Carried over from hotfix-doctor-onboarding.test.js, whose other
     assertions described the eight-field registration form that this change
     removes. This one still holds: on a database with neither migration,
     set_own_role() takes 'doctor' and the two-step is the only path that
     works — and the destination differs, because such a database also lacks
     v9 and really would show an unapproved doctor an empty workspace. */
  console.log('\n── a database with NEITHER migration: the old two-step ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/role-select.html', profile: NEW_USER,
                                             v93:false, v91:false });
    await pg.click('#ro-doctor'); await pg.waitForTimeout(250);
    await pg.fill('#d-name', 'Dana Levi');
    await pg.click('#d-submit'); await pg.waitForTimeout(900);
    await pg.click('#pf-lvl-resident');
    await pg.selectOption('#pf-country', 'Israel');
    await pg.fill('#pf-phone', '050-123 4567');
    await pg.fill('#pf-license', 'IL-77777');
    await pg.fill('#pf-hospital', 'Central');
    await pg.fill('#pf-university', 'Tbilisi State');
    await pg.selectOption('#pf-specialty', 'Anesthesiology');
    await pg.click('#pr-submit'); await pg.waitForTimeout(1600);

    const s = await pg.evaluate(() => ({
      url: location.pathname,
      setRole: (window.__calls.rpc || []).some(c => c.fn === 'set_own_role' && c.args.p_role === 'doctor'),
      profile: JSON.parse(sessionStorage.getItem('__anestheo_mock_profile') || '{}'),
      err: ((document.getElementById('practice-err')||{}).textContent||'').trim()
    }));
    t('falls all the way back to set_own_role when neither RPC exists', s.setRole === true);
    t('...registration still succeeds', s.err === '', s.err || '(none)');
    t('...the account is a doctor with the file attached',
      s.profile.role === 'doctor' && s.profile.medical_license_number === 'IL-77777',
      [s.profile.role, s.profile.medical_license_number]);
    t('...and lands on /doctor-pending.html, which is honest on that database',
      s.url === '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 4 · THE VERIFICATION STEP CARRIES THE FORM ──────────────────────────
  console.log('\n── doctor-pending.html is where the practice form lives now ──');
  const PENDING_EMPTY = { email:'d2@e.com',
                          role:'doctor', verification_status:'pending', is_admin:false,
                          full_name:'Dana Levi' };
  {
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: PENDING_EMPTY, v93:true });
    const s = await pg.evaluate(ids => ({
      url: location.pathname,
      formShown: !document.getElementById('dp-form-wrap').classList.contains('hidden'),
      receiptShown: !document.getElementById('dp-submitted-wrap').classList.contains('hidden'),
      fields: ids.filter(x => !!document.querySelector(x)),
      heading: (document.querySelector('#dp-form-wrap .form-h')||{}).textContent.trim(),
      submit: (document.getElementById('dp-submit')||{}).textContent.trim()
    }), PRACTICE_IDS);
    t('a pending doctor with an empty file stays on the page',
      s.url === '/doctor-pending.html', s.url);
    t('...and is shown the practice form', s.formShown && !s.receiptShown);
    t('...all six practice fields are here', s.fields.length === 6, s.fields);
    t('...under the heading that moved with it',
      /tell us about your practice/i.test(s.heading), s.heading);
    t('...and the action is verification, not registration',
      /verification/i.test(s.submit), s.submit);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 5 · AN INCOMPLETE SUBMISSION IS NAMED, NOT LEAKED ───────────────────
  console.log('\n── an incomplete verification says what is missing ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: PENDING_EMPTY, v93:true });
    await pg.fill('#pf-license', 'IL-11111');
    await pg.click('#dp-submit'); await pg.waitForTimeout(800);
    const s = await pg.evaluate(() => ({
      err: ((document.getElementById('dp-err')||{}).textContent||'').trim(),
      rpc: (window.__calls.rpc || []).map(c => c.fn),
      profile: JSON.parse(sessionStorage.getItem('__anestheo_mock_profile') || '{}')
    }));
    t('an incomplete file is not submitted', s.rpc.indexOf('submit_doctor_onboarding') < 0, s.rpc.join(','));
    t('...the message names fields in plain words', /Please add .*(level|country|telephone)/i.test(s.err), s.err);
    t('...and leaks no column name, code or SQL',
      !/[a-z]+_[a-z]+|PGRST|42\d\d|null|undefined/i.test(s.err), s.err);
    t('...verification_status is untouched', s.profile.verification_status === 'pending',
      s.profile.verification_status);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 6 · A COMPLETE SUBMISSION GOES THROUGH THE UNCHANGED RPC ────────────
  console.log('\n── a complete verification uses submit_doctor_onboarding ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: PENDING_EMPTY, v93:true });
    await pg.click('#pf-lvl-consultant');
    await pg.selectOption('#pf-country', 'Israel');
    await pg.fill('#pf-phone', '050-123 4567');
    await pg.fill('#pf-license', 'IL-99231');
    await pg.fill('#pf-hospital', 'Sheba Medical Center');
    await pg.fill('#pf-university', 'Tel Aviv University');
    await pg.selectOption('#pf-specialty', 'Anesthesiology');
    await pg.click('#dp-submit'); await pg.waitForTimeout(1500);

    const s = await pg.evaluate(() => ({
      url: location.pathname,
      rpc: (window.__calls.rpc || []).map(c => c.fn),
      profile: JSON.parse(sessionStorage.getItem('__anestheo_mock_profile') || '{}'),
      err: ((document.getElementById('dp-err')||{}).textContent||'').trim(),
      receiptShown: !document.getElementById('dp-submitted-wrap').classList.contains('hidden'),
      formShown: !document.getElementById('dp-form-wrap').classList.contains('hidden'),
      receipt: (document.getElementById('dp-kv')||{}).textContent || '',
      pill: (document.getElementById('dp-pill-t')||{}).textContent.trim()
    }));
    t('verification goes through the UNCHANGED submit_doctor_onboarding',
      s.rpc.indexOf('submit_doctor_onboarding') >= 0, s.rpc.join(','));
    t('...with no error', s.err === '', s.err || '(none)');
    t('...the professional file is stored',
      s.profile.medical_license_number === 'IL-99231' &&
      s.profile.hospital === 'Sheba Medical Center', s.profile.medical_license_number);
    t('...the phone was normalised to a dial code', /^\+972/.test(s.profile.phone||''), s.profile.phone);
    t('...verification_status is pending — the page cannot approve anybody',
      s.profile.verification_status === 'pending', s.profile.verification_status);
    t('...the form is replaced by what was submitted', s.receiptShown && !s.formShown);
    t('...and the receipt shows the licence number back', /IL-99231/.test(s.receipt));
    t('...the status reads as waiting', /awaiting/i.test(s.pill), s.pill);
    t('...no navigation away from the verification page',
      s.url === '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 7 · A COMPLETE FILE OPENS AS A RECEIPT ──────────────────────────────
  console.log('\n── a doctor who already submitted sees a receipt, not a form ──');
  const PENDING_FULL = Object.assign({}, PENDING_EMPTY, {
    professional_level:'consultant', country:'Israel', phone:'+972501234567',
    medical_license_number:'IL-4242', hospital:'Rambam', medical_university:'Technion',
    specialty:'Anesthesiology' });
  {
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: PENDING_FULL, v93:true });
    const before = await pg.evaluate(() => ({
      receiptShown: !document.getElementById('dp-submitted-wrap').classList.contains('hidden'),
      formShown: !document.getElementById('dp-form-wrap').classList.contains('hidden'),
      receipt: (document.getElementById('dp-kv')||{}).textContent || ''
    }));
    t('the receipt is what opens', before.receiptShown && !before.formShown);
    t('...showing the file on record', /IL-4242/.test(before.receipt) && /Rambam/.test(before.receipt));

    await pg.click('button[onclick="editDetails()"]'); await pg.waitForTimeout(400);
    const after = await pg.evaluate(() => ({
      formShown: !document.getElementById('dp-form-wrap').classList.contains('hidden'),
      license: (document.getElementById('pf-license')||{}).value,
      level: (document.querySelector('.pf-seg button.on')||{}).textContent.trim(),
      country: (document.getElementById('pf-country')||{}).value
    }));
    t('..."Update these details" reopens the form', after.formShown);
    t('...prefilled with what was submitted', after.license === 'IL-4242', after.license);
    t('...including the professional level', /consultant/i.test(after.level), after.level);
    t('...and the country', after.country === 'Israel', after.country);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 8 · VERIFICATION LOGIC IS STILL THERE AND STILL GATES ───────────────
  console.log('\n── verification still means something ──');
  {
    const APPROVED = Object.assign({}, PENDING_FULL, {
      verification_status:'approved' });
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: APPROVED, v93:true });
    const s = await pg.evaluate(() => ({ url: location.pathname }));
    t('an APPROVED doctor is not shown a verification form',
      s.url !== '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const PATIENT = { email:'p@e.com',
                      role:'patient', verification_status:'not_required', is_admin:false,
                      full_name:'Ana Patient' };
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: PATIENT, v93:true });
    const s = await pg.evaluate(() => ({ url: location.pathname }));
    t('a patient cannot open the verification form', s.url !== '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const ADMIN = { email:'a@e.com',
                    role:'doctor', verification_status:'pending', is_admin:true,
                    full_name:'Ada Admin' };
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: ADMIN, v93:true });
    const s = await pg.evaluate(() => ({ url: location.pathname }));
    t('an administrator is not shown a verification form', s.url !== '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }
  {
    /* The regression v9_1 was careful about, re-checked from this direction:
       re-running registration must not cost an approved doctor their status. */
    const APPROVED = Object.assign({}, PENDING_FULL, {
      role:'doctor', verification_status:'approved' });
    const { ctx, pg } = await open(b, { path:'/role-select.html', profile: APPROVED, v93:true });
    const s = await pg.evaluate(async () => {
      const r = await window.createDoctorAccount('Dana Levi');
      return { verification: r && r.data && r.data.verification_status };
    });
    t('re-registering an approved doctor does NOT demote them to pending',
      s.verification === 'approved', s.verification);
    await ctx.close();
  }

  // ── 9 · NO PAGE CAN GRANT VERIFICATION ──────────────────────────────────
  console.log('\n── nothing in the shipped frontend writes verification_status ──');
  {
    const files = ['role-select.html','doctor-pending.html','practice-form.js','auth.js'];
    /* An ASSIGNMENT, not a comparison. `verif === 'approved'` is how these
       pages ask the question and must keep matching nothing here; a single '='
       or an object-literal ':' is the thing that would actually grant it. */
    const GRANT = /verification_status\s*(?::|(?<![=!<>])=(?!=))\s*['"]approved['"]/;
    const offenders = files.filter(f => GRANT.test(src(f)));
    t('no file sets verification_status to approved', offenders.length === 0, offenders);

    const authSrc = src('auth.js');
    t('verification_status is still a protected profile field',
      /PROTECTED_PROFILE_FIELDS\s*=\s*\[[^\]]*'verification_status'/.test(authSrc));
    t('submit_doctor_onboarding is still called, unchanged',
      /rpc\('submit_doctor_onboarding'/.test(authSrc));
    /* setOwnRole('doctor') still exists, in the double-legacy branch and
       nowhere else. The assertion is about WHERE: the ordinary registration
       handler must not reach for it, because on any current database it
       raises 22023. */
    const rs = src('role-select.html');
    const submitDoctorBody = (rs.match(/async function submitDoctor\(\)\{?[\s\S]*?\n\}/) || [''])[0];
    const submitPracticeBody = (rs.match(/async function submitPractice\(\)[\s\S]*?\n\}/) || [''])[0];
    t('the ordinary doctor registration never calls setOwnRole("doctor")',
      submitDoctorBody.length > 0 && !/setOwnRole/.test(submitDoctorBody));
    t('...it calls createDoctorAccount instead',
      /createDoctorAccount/.test(submitDoctorBody));
    t('...setOwnRole("doctor") survives only in the double-legacy fallback',
      /res\.legacy[\s\S]*setOwnRole\('doctor'\)/.test(submitPracticeBody));
    t('...and appears exactly once in the whole page',
      (rs.match(/setOwnRole\('doctor'\)/g) || []).length === 1);
  }

  // ── 10 · THE DESIGN ─────────────────────────────────────────────────────
  console.log('\n── graphite, not green graph paper ──');
  {
    const files = ['role-select.html','doctor-pending.html','practice-form.js'];
    files.forEach(f => {
      const body = src(f);
      t(f + ': the green-black ground is gone', !/#0A1A15/i.test(body));
      t(f + ': the 52px grid is gone', !/background-size:\s*52px/i.test(body));
      t(f + ': no local teal override', !/--teal\s*:\s*#1B6B5A/i.test(body));
      t(f + ': no rgba green card fill', !/rgba\(10,\s*22,\s*15/i.test(body));
      t(f + ': no green hairline literal', !/rgba\(27,\s*107,\s*90/i.test(body));
    });
  }
  {
    /* Measured, not read: what these pages actually paint has to be the
       homepage's ground, because that is where the identity comes from. */
    for (const path of ['/role-select.html','/doctor-pending.html']) {
      const profile = path === '/role-select.html' ? NEW_USER : PENDING_EMPTY;
      const { ctx, pg } = await open(b, { path, profile, v93:true });
      const s = await pg.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return { bg: cs.backgroundColor, img: cs.backgroundImage, color: cs.color,
                 family: cs.fontFamily };
      });
      t(path + ': ground is the homepage graphite #0B1620',
        s.bg === 'rgb(11, 22, 32)', s.bg);
      t(path + ': the light behind it is the homepage glow, not a pattern',
        /radial-gradient/.test(s.img) && !/repeating|linear-gradient\(90deg/.test(s.img),
        s.img.slice(0, 70));
      t(path + ': ink is the token ink #F2F6F8', s.color === 'rgb(242, 246, 248)', s.color);
      t(path + ': type is Inter, the homepage voice', /Inter/.test(s.family), s.family);
      await ctx.close();
    }
  }

  // ── 11 · PHONE-WIDTH ────────────────────────────────────────────────────
  console.log('\n── it survives a phone ──');
  {
    const { ctx, pg, errs } = await open(b, { path:'/doctor-pending.html', profile: PENDING_EMPTY,
                                             v93:true, width:390, height:844 });
    const s = await pg.evaluate(() => {
      const bad = [];
      document.querySelectorAll('input,select,button,a.btn').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 44) bad.push(el.id || el.className);
      });
      return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
               scrollW: document.documentElement.scrollWidth, small: bad };
    });
    t('no horizontal scroll at 390px', !s.overflow, s.scrollW);
    t('every control is at least 44px tall', s.small.length === 0, s.small);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
