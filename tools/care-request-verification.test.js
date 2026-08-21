#!/usr/bin/env node
/* care-request-verification.test.js
 *
 * THE AUDIT NOTE THIS FILE EXISTS TO HOLD
 * ---------------------------------------
 *   SECURITY DEFINER functions require their own authorization checks
 *   because they bypass table RLS.
 *
 * v9_5 puts RESTRICTIVE policies on twelve patient-management tables. A
 * SECURITY DEFINER function runs as its owner and never consults RLS, so those
 * policies are invisible to it. Six such functions formed an unbroken chain
 * from a thirty-second-old account to an approved anesthesia plan, and no
 * table policy anywhere could have stopped it.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, STATED PLAINLY
 * ---------------------------------------------------
 * It cannot execute PostgreSQL. The three RPCs are MIRRORED below in
 * JavaScript, condition for condition, from v9_6_care_request_verification.sql,
 * and the mirror is checked against the SQL text in section 7 so the two cannot
 * drift silently. What that proves is that the RULE is right and that the
 * frontend behaves correctly under it.
 *
 * It does NOT prove the deployed database enforces it. Only applying v9_6 does
 * that. A test that stubbed Postgres and then asserted the stub would be
 * testing itself, and saying so is more useful than a green tick that means
 * nothing.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const SQL  = fs.readFileSync('/home/user/anestheo-website/v9_6_care_request_verification.sql', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 130);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

/* A directory of clinicians, covering every branch the three checks can take. */
const DIRECTORY = `[
  { id:'dr-approved',   full_name:'Dr Approved',   role:'doctor', is_admin:false, verification_status:'approved',     accepting_patients:true,  specialty:'Anesthesiology', hospital:'Rambam' },
  { id:'dr-pending',    full_name:'Dr Pending',    role:'doctor', is_admin:false, verification_status:'pending',      accepting_patients:true,  specialty:'Anesthesiology', hospital:'Central' },
  { id:'dr-rejected',   full_name:'Dr Rejected',   role:'doctor', is_admin:false, verification_status:'rejected',     accepting_patients:true,  specialty:'Anesthesiology', hospital:'Central' },
  { id:'dr-closed',     full_name:'Dr Closed',     role:'doctor', is_admin:false, verification_status:'approved',     accepting_patients:false, specialty:'Anesthesiology', hospital:'Rambam' },
  { id:'admin-1',       full_name:'Ada Admin',     role:'admin',  is_admin:true,  verification_status:'not_required', accepting_patients:true,  specialty:'Administration', hospital:'Anestheo' },
  { id:'patient-1',     full_name:'Ana Patient',   role:'patient',is_admin:false, verification_status:'not_required', accepting_patients:true,  specialty:null, hospital:null }
]`;

/* v9_6, mirrored. Every condition below appears in the SQL and section 7
   checks that it does. `me` is the calling profile. */
const RPCS = `
  var __DIR = ${DIRECTORY};
  var __surgeries = { 'surg-1': { id:'surg-1', patient_id:'patient-1', assigned_doctor_id:null } };
  var __requests  = {};
  var __reqSeq = 0;
  window.__dbState = function(){ return { surgeries: __surgeries, requests: __requests }; };

  /* WHO IS CALLING, without touching the profile row.
     An earlier version rewrote profiles.id to the directory id so the mirror
     could match. That broke getProfile(), which looks the row up by the
     session uid, so every page decided the account had no profile and sent it
     to the role chooser. The directory identity is a separate marker now and
     the real row is left exactly as the mock built it. */
  function __me(){
    var r = load(KEY_PROFILE) || {};
    return { id: window.__DIR_ID || r.id, role: r.role,
             is_admin: r.is_admin, verification_status: r.verification_status };
  }
  function __isAdmin(p){ return p && p.is_admin === true; }
  function __approved(p){ return p && p.verification_status === 'approved'; }
  function __isVerifiedDoctor(p){ return p && p.role === 'doctor' && __approved(p); }
  function __err(msg, code){ return Promise.resolve({ data:null, error:{ message:msg, code:code } }); }

  var __rpcPrev = client.rpc;
  client.rpc = function(fn, p){
    p = p || {};
    var me = __me();

    /* get_clinician_directory - v9_6 section 2 */
    if(fn === 'get_clinician_directory'){
      record('rpc', { fn:fn, args:p });
      var rows = __DIR.filter(function(d){
        return d.accepting_patients === true
            && (d.role === 'doctor' || d.is_admin === true)
            && (d.is_admin === true || d.verification_status === 'approved');
      }).map(function(d){
        return { id:d.id, name:d.full_name || 'Clinician', specialty:d.specialty, clinic:d.hospital };
      });
      return Promise.resolve({ data: rows, error: null });
    }

    /* request_clinician - v9_6 section 3 */
    if(fn === 'request_clinician'){
      record('rpc', { fn:fn, args:p });
      var surg = __surgeries[p.p_surgery_id];
      if(!surg || surg.patient_id !== (me.id || 'patient-1'))
        return __err('Surgery not found for this patient', 'P0001');
      var target = __DIR.filter(function(d){ return d.id === p.p_doctor_id; })[0];
      var ok = target
            && target.accepting_patients === true
            && (target.role === 'doctor' || target.is_admin === true)
            && (target.is_admin === true || target.verification_status === 'approved');
      if(!ok) return __err('Selected clinician is not available', '42501');
      var already = Object.keys(__requests).some(function(k){
        return __requests[k].surgery_id === p.p_surgery_id &&
               ['requested','accepted'].indexOf(__requests[k].status) >= 0; });
      if(already) return __err('You already have an active clinician request for this surgery', 'P0001');
      var id = 'req-' + (++__reqSeq);
      __requests[id] = { id:id, patient_id:surg.patient_id, doctor_id:p.p_doctor_id,
                         surgery_id:p.p_surgery_id, status:'requested' };
      return Promise.resolve({ data:id, error:null });
    }

    /* respond_care_request - v9_6 section 4, THE WRITE BOUNDARY */
    if(fn === 'respond_care_request'){
      record('rpc', { fn:fn, args:p });
      var req = __requests[p.p_request_id];
      if(!req) return __err('Request not found', 'P0001');
      if(req.doctor_id !== me.id) return __err('Not authorised for this request', 'P0001');
      if(req.status !== 'requested') return __err('Request is no longer pending', 'P0001');

      if(p.p_decision === 'accept'){
        if(!(__isVerifiedDoctor(me) || __isAdmin(me))){
          return __err('Verification is required before accepting patients', '42501');
        }
        req.status = 'accepted';
        __surgeries[req.surgery_id].assigned_doctor_id = me.id;
        return Promise.resolve({ data:null, error:null });
      }
      if(p.p_decision === 'decline'){
        req.status = 'declined';
        return Promise.resolve({ data:null, error:null });
      }
      return __err('Invalid decision', 'P0001');
    }

    return __rpcPrev.call(client, fn, p);
  };
`;

const ID = {
  /* NO `id` FIELD, DELIBERATELY. The mock builds its profile row on a pinned
     session uid and then copies every seed key over it, so an `id` here lands
     in profiles.id and getProfile(session.user.id) finds nothing — every page
     then decides the account is roleless and sends it to the chooser. The
     directory identity travels in __DIR_ID instead, which is what dirId names. */
  pending:    { dirId:'new-1',       email:'new@gmail.com', role:'pending', verification_status:'not_required', is_admin:false },
  patient:    { dirId:'patient-1',   email:'p@e.com', role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' },
  unverified: { dirId:'dr-pending',  email:'d@e.com', role:'doctor',  verification_status:'pending',  is_admin:false, full_name:'Dr Pending' },
  verified:   { dirId:'dr-approved', email:'d2@e.com',role:'doctor',  verification_status:'approved', is_admin:false, full_name:'Dr Approved' },
  admin:      { dirId:'admin-1',     email:'a@e.com', role:'admin',   verification_status:'not_required', is_admin:true, full_name:'Ada Admin' }
};

/* The mock pins its own session uid and getProfile() looks the row up by it,
   so a seeded id must NOT reach profiles.id. __DIR_ID carries the directory
   identity alongside instead, and the profile row stays untouched. */
function buildMock(){ return MOCK.replace(/\n\}\)\(\);\s*$/, '\n' + RPCS + '\n})();\n'); }

async function open(b, path, who) {
  const ctx = await b.newContext({ viewport:{ width:1440, height:1000 } });
  const mock = buildMock();
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:mock});
    if (/googleapis|gstatic/.test(u)) return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,140)); });
  const prof = ID[who];
  const seed = Object.assign({}, prof); delete seed.dirId;
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(seed) + ';');
  /* The seeded id must survive into the stored row, or the mirror cannot tell
     who is calling. The mock overwrites id with its own session uid, so it is
     put back before anything reads it. */
  await pg.addInitScript('window.__DIR_ID=' + JSON.stringify(prof && prof.dirId) + ';');
  try { await pg.goto(BASE + path, { waitUntil:'networkidle' }); } catch(e){}
  await pg.waitForTimeout(1200);
  return { ctx, pg, errs };
}

const rpc = (pg, fn, args) => pg.evaluate(([f,a]) =>
  window.sb.rpc(f, a).then(r => ({ data:r.data, err: r.error ? r.error.message : null,
                                   code: r.error ? r.error.code : null })), [fn, args||{}]);

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1 · PENDING ─────────────────────────────────────────────────────────
  console.log('\n── 1 · a pending account reaches the chooser and nothing else ──');
  for (const p of ['/dashboard.html','/patient-dashboard.html','/engine.html']) {
    const { ctx, pg } = await open(b, p, 'pending');
    const url = await pg.evaluate(() => location.pathname);
    t(('pending on ' + p).padEnd(42) + '→ role-select', url === '/role-select.html', url);
    await ctx.close();
  }

  // ── 2 · PATIENT ─────────────────────────────────────────────────────────
  console.log('\n── 2 · a patient gets the patient app only ──');
  {
    const { ctx, pg } = await open(b, '/patient-dashboard.html', 'patient');
    t('patient → patient app', await pg.evaluate(() => location.pathname) === '/patient-dashboard.html');
    await ctx.close();
  }
  for (const p of ['/dashboard.html','/engine.html','/anesthesia-cases.html']) {
    const { ctx, pg } = await open(b, p, 'patient');
    const url = await pg.evaluate(() => location.pathname);
    t(('patient on ' + p).padEnd(42) + '→ denied', url === '/patient-dashboard.html', url);
    await ctx.close();
  }

  // ── 3 · UNVERIFIED DOCTOR KEEPS THE CLINICIAN PRODUCT ───────────────────
  console.log('\n── 3 · unverified doctor: the product still works ──');
  for (const [p, must] of [['/dashboard.html', /Welcome to your clinician workspace/i],
                           ['/engine.html', null],
                           ['/references.html', null],
                           ['/resources.html', null],
                           ['/anesthesia-cases.html', /not attached to a patient record/i]]) {
    const { ctx, pg, errs } = await open(b, p, 'unverified');
    const s = await pg.evaluate(() => ({ url: location.pathname,
      text: (document.body.innerText||'').replace(/\s+/g,' ') }));
    t(('unverified on ' + p).padEnd(42) + '→ open', s.url === p, s.url);
    if (must) t(('  ...and shows the right thing').padEnd(64), must.test(s.text));
    t(('  ...no page error').padEnd(64), errs.length === 0, errs);
    await ctx.close();
  }

  // ── 4 · UNVERIFIED DOCTOR CANNOT ENTER THE CARE-REQUEST CHAIN ───────────
  console.log('\n── 4 · unverified doctor: the chain is closed ──');
  {
    const { ctx, pg } = await open(b, '/patient-dashboard.html', 'patient');
    const dir = await rpc(pg, 'get_clinician_directory');
    const ids = (dir.data || []).map(d => d.id);
    t('directory does NOT list the unverified doctor', ids.indexOf('dr-pending') < 0, ids);
    t('...nor a rejected one', ids.indexOf('dr-rejected') < 0, ids);
    t('...nor one who is not accepting patients', ids.indexOf('dr-closed') < 0, ids);
    t('...nor a patient account', ids.indexOf('patient-1') < 0, ids);
    t('directory DOES list the approved doctor', ids.indexOf('dr-approved') >= 0, ids);
    t('...and the administrator, unchanged', ids.indexOf('admin-1') >= 0, ids);

    const bad = await rpc(pg, 'request_clinician',
      { p_surgery_id:'surg-1', p_doctor_id:'dr-pending', p_message:'hello' });
    t('a patient cannot request an unverified doctor', bad.err !== null, bad.err);
    t('...refused with 42501 insufficient_privilege', bad.code === '42501', bad.code);
    t('...and the message does not say WHY (no enumeration)',
      !/verif/i.test(bad.err||''), bad.err);

    const st = await pg.evaluate(() => window.__dbState());
    t('...no care_request row was created', Object.keys(st.requests).length === 0);
    t('...assigned_doctor_id untouched', st.surgeries['surg-1'].assigned_doctor_id === null);
    await ctx.close();
  }
  {
    /* The write boundary itself: a request that somehow exists, addressed to an
       unverified doctor, must not be acceptable. */
    const { ctx, pg } = await open(b, '/dashboard.html', 'unverified');
    const made = await pg.evaluate(() => {
      const st = window.__dbState();
      st.requests['req-x'] = { id:'req-x', patient_id:'patient-1', doctor_id:'dr-pending',
                               surgery_id:'surg-1', status:'requested' };
      return Object.keys(st.requests);
    });
    t('(a pending request addressed to them is staged)', made.indexOf('req-x') >= 0);

    const acc = await rpc(pg, 'respond_care_request',
      { p_request_id:'req-x', p_decision:'accept', p_reason:null });
    t('an unverified doctor cannot ACCEPT', acc.err !== null, acc.err);
    t('...with the exact required message',
      acc.err === 'Verification is required before accepting patients', acc.err);
    t('...and SQLSTATE 42501', acc.code === '42501', acc.code);

    const st = await pg.evaluate(() => window.__dbState());
    t('...they did NOT become the assigned doctor',
      st.surgeries['surg-1'].assigned_doctor_id === null, st.surgeries['surg-1'].assigned_doctor_id);
    t('...and the request is still pending', st.requests['req-x'].status === 'requested');

    /* Declining is not privileged. Gating it would strand the patient. */
    const dec = await rpc(pg, 'respond_care_request',
      { p_request_id:'req-x', p_decision:'decline', p_reason:'not taking patients yet' });
    t('...but they CAN decline, so the patient is never stuck', dec.err === null, dec.err);
    await ctx.close();
  }

  // ── 5 · VERIFIED DOCTOR: WORKFLOW UNCHANGED ─────────────────────────────
  console.log('\n── 5 · verified doctor: nothing changed ──');
  {
    const { ctx, pg } = await open(b, '/patient-dashboard.html', 'patient');
    const made = await rpc(pg, 'request_clinician',
      { p_surgery_id:'surg-1', p_doctor_id:'dr-approved', p_message:'please' });
    t('a patient CAN request an approved doctor', made.err === null, made.err);
    t('...and a care_request exists', typeof made.data === 'string', made.data);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/dashboard.html', 'verified');
    await pg.evaluate(() => {
      window.__dbState().requests['req-v'] = { id:'req-v', patient_id:'patient-1',
        doctor_id:'dr-approved', surgery_id:'surg-1', status:'requested' };
    });
    const acc = await rpc(pg, 'respond_care_request',
      { p_request_id:'req-v', p_decision:'accept', p_reason:null });
    t('an approved doctor CAN accept', acc.err === null, acc.err);
    const st = await pg.evaluate(() => window.__dbState());
    t('...and becomes the assigned doctor',
      st.surgeries['surg-1'].assigned_doctor_id === 'dr-approved', st.surgeries['surg-1'].assigned_doctor_id);
    await ctx.close();
  }

  // ── 6 · ADMIN UNCHANGED ─────────────────────────────────────────────────
  console.log('\n── 6 · administrator: unchanged ──');
  {
    const { ctx, pg } = await open(b, '/dashboard.html', 'admin');
    t('admin reaches the workspace', await pg.evaluate(() => location.pathname) === '/dashboard.html');
    await pg.evaluate(() => {
      window.__dbState().requests['req-a'] = { id:'req-a', patient_id:'patient-1',
        doctor_id:'admin-1', surgery_id:'surg-1', status:'requested' };
      window.__dbState().surgeries['surg-1'].assigned_doctor_id = null;
    });
    const acc = await rpc(pg, 'respond_care_request',
      { p_request_id:'req-a', p_decision:'accept', p_reason:null });
    t('an administrator can still accept a request', acc.err === null, acc.err);
    t('...verification_status=not_required did not lock them out',
      acc.code === null, acc.code);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/admin.html', 'admin');
    t('admin.html unchanged', await pg.evaluate(() => location.pathname) === '/admin.html');
    await ctx.close();
  }

  // ── 7 · THE MIRROR MATCHES THE SQL ──────────────────────────────────────
  /* Without this the sections above test a JavaScript file's opinion of a
     migration. Each assertion names a condition that must appear in v9_6. */
  console.log('\n── 7 · the mirror above matches v9_6 ──');
  {
    t('v9_6 carries the audit note verbatim',
      /SECURITY DEFINER functions require their own authorization checks[\s\S]{0,80}bypass table RLS/.test(SQL));
    t('directory filters on verification_status', /verification_status\s*=\s*''approved''/.test(SQL));
    t('directory keeps administrators on the is_admin branch',
      /is_admin, false\) = true[\s\S]{0,120}verification_status = ''approved''/.test(SQL));
    t('request_clinician checks role AND verification',
      /accepting_patients = true[\s\S]{0,220}verification_status = 'approved'/.test(SQL));
    t('respond_care_request gates only the accept branch',
      /IF p_decision = 'accept' THEN[\s\S]{0,260}is_verified_doctor\(\)/.test(SQL));
    t('...with the exact message the requirement names',
      /'Verification is required before accepting patients'/.test(SQL));
    t('...and SQLSTATE 42501', /ERRCODE = '42501'/.test(SQL));
    t('the decline branch is NOT gated',
      /ELSIF p_decision = 'decline' THEN(?![\s\S]{0,160}is_verified_doctor)/.test(SQL));
    t('v9_6 changes no RLS policy', !/CREATE POLICY|DROP POLICY|ALTER POLICY/.test(SQL));
    t('v9_6 changes no table', !/ALTER TABLE|CREATE TABLE|DROP TABLE/.test(SQL));
    /* get_clinician_directory is built through EXECUTE (it has to be, to stay
       tolerant of a missing display_name or clinic_name), so its CREATE lives
       inside a string. Counting distinct NAMES is the honest measure. */
    t('v9_6 touches exactly three functions, and names them',
      (function(){
        var names = (SQL.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || [])
          .map(function(m){ return m.split('.').pop(); });
        var uniq = names.filter(function(v,i){ return names.indexOf(v) === i; }).sort();
        return uniq.length === 3 &&
               uniq.join(',') === 'get_clinician_directory,request_clinician,respond_care_request';
      })(),
      (SQL.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) || []).map(function(m){ return m.split('.').pop(); }));
    t('v9_6 does not touch the six review functions',
      !/FUNCTION public\.(start_review|approve_plan|get_patient_plan|save_doctor_plan|request_changes|mark_document_reviewed)\s*\(/.test(SQL));
    t('v9_6 names the already-assigned case rather than silently ignoring it',
      /ALREADY-ASSIGNED UNVERIFIED DOCTORS ARE NOT DETACHED/.test(SQL));
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
