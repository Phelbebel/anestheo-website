#!/usr/bin/env node
/* verification-boundary.test.js
 *
 * Six identities, one boundary.
 *
 *   1 anonymous                         public pages only
 *   2 authenticated, role='pending'     the role chooser, and nothing else
 *   3 patient                           the patient experience
 *   4 doctor, verification pending      the clinician product, NO patient data
 *   5 doctor, verification approved     the above plus patient management
 *   6 administrator                     unchanged
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE
 * -----------------------------------
 * It proves the FRONTEND half: which pages open, which controls render, which
 * queries a page even attempts. It cannot prove RLS, because the Supabase
 * client is stubbed at the network boundary and a stub that enforces policies
 * would only be testing itself.
 *
 * That split is deliberate and it is the point of the architecture. The
 * boundary is v9_5_verification_boundary.sql; this file's job is to show that
 * the frontend AGREES with it, and — more usefully — that the frontend never
 * relies on being the boundary. Section 6 below is the one that matters most:
 * it records every patient-scoped table an unverified doctor's pages ask for,
 * and asserts the list is empty. If the frontend never asks, a mistake in the
 * policy layer has nothing to leak through; and if the frontend does ask, the
 * policy layer had better be right, which is why the SQL exists.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(66) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(66) + ' ' + fmt(d)); }
};

const ID = {
  anon:      null,
  pending:   { email:'new@gmail.com', role:'pending', verification_status:'not_required', is_admin:false },
  patient:   { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' },
  unverified:{ email:'d@e.com',  role:'doctor',  verification_status:'pending',  is_admin:false, full_name:'Dana Levi' },
  verified:  { email:'d2@e.com', role:'doctor',  verification_status:'approved', is_admin:false, full_name:'Dana Levi' },
  admin:     { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true, full_name:'Ada Admin' }
};

/* Tables that hold, or point at, a real person's clinical record. An
   unverified doctor's pages must not ask for any of them. */
const PATIENT_TABLES = [
  'patient_surgeries','clinic_patients','care_requests','preop_questionnaires',
  'preop_checklist','preparation_plans','patient_recommendations',
  'questionnaire_templates','requirement_documents','questions','question_replies',
  'hp_items','hp_passports','hp_contacts'
];
const PATIENT_RPCS = [
  'recycle_bin_list','hp_clinician_may_read','hp_verify_item',
  'patient_record_manageable','get_clinician_directory'
];

async function open(b, path, who, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{ width: opts.width || 1440, height: opts.height || 1000 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u)) return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,140)); });
  const profile = ID[who];
  await pg.addInitScript(profile === null
    ? 'window.__TEST_ROLE="anon";'
    : 'window.__TEST_PROFILE=' + JSON.stringify(profile) + ';');
  try { await pg.goto(BASE + path, { waitUntil:'networkidle' }); } catch(e) {}
  await pg.waitForTimeout(1400);
  const s = await pg.evaluate(() => ({
    url: location.pathname,
    text: (document.body.innerText || '').replace(/\s+/g,' ').trim(),
    /* Every table and RPC the page actually reached for, recorded by the stub
       rather than inferred from reading the source. */
    tables: [...new Set(((window.__calls && window.__calls.upsert) ? [] : []).concat(
      (window.__tablesTouched || [])))],
    rpcs: [...new Set(((window.__calls && window.__calls.rpc) || []).map(c => c.fn))],
    rail: [...document.querySelectorAll('.ws-tab-tx')].map(n => n.textContent.trim()),
    tabbar: [...document.querySelectorAll('#nb-tabbar .nb-tab-l')].map(n => n.textContent.trim())
  }));
  await ctx.close();
  return { ...s, errs };
}

/* window.__tablesTouched is not something mock.js records on its own, so the
   probe installs it: a thin wrapper around client.from() that notes the name
   and then does exactly what it did before. Recording the question is the
   whole measurement. */
const TABLE_PROBE = `
  (function(){
    window.__tablesTouched = [];
    var iv = setInterval(function(){
      if(!window.sb || !window.sb.from || window.sb.__probed) return;
      clearInterval(iv);
      var orig = window.sb.from.bind(window.sb);
      window.sb.from = function(t){ window.__tablesTouched.push(t); return orig(t); };
      window.sb.__probed = true;
    }, 5);
  })();
`;

async function openProbed(b, path, who) {
  const ctx = await b.newContext({ viewport:{ width:1440, height:1000 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u)) return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(ID[who]) + ';');
  await pg.addInitScript(TABLE_PROBE);
  try { await pg.goto(BASE + path, { waitUntil:'networkidle' }); } catch(e) {}
  await pg.waitForTimeout(1800);
  const s = await pg.evaluate(() => ({
    url: location.pathname,
    tables: [...new Set(window.__tablesTouched || [])],
    rpcs: [...new Set(((window.__calls && window.__calls.rpc) || []).map(c => c.fn))]
  }));
  await ctx.close();
  return s;
}

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1 · AUTH: the chooser cannot be bypassed ────────────────────────────
  console.log('\n── 1 · auth ──');
  /* /engine.html is NOT in this list any more. It lost requireRole('staff')
     after an audit found it makes no Supabase read, no RPC and no fetch,
     stores no identifier, and that its one backend call — get_evidence — is
     already granted to `anon`. A page an anonymous visitor can open cannot
     also be one that forces a roleless account to choose first, or that turns
     a patient away: that is the same person one sign-out apart. The surfaces
     below all hold data, and every one of them still redirects. */
  for (const p of ['/index.html','/dashboard.html','/patient-dashboard.html','/anesthesia-cases.html']) {
    const r = await open(b, p, 'pending');
    t(('pending on ' + p).padEnd(46) + '→ role-select', r.url === '/role-select.html', r.url);
  }
  {
    const r = await open(b, '/auth-callback.html', 'pending');
    t('pending through the OAuth callback → role-select', r.url === '/role-select.html', r.url);
  }
  for (const p of ['/index.html','/patients.html','/videos.html']) {
    const r = await open(b, p, 'anon');
    t(('anonymous on ' + p).padEnd(46) + '→ stays public', r.url === p, r.url);
  }
  for (const p of ['/dashboard.html','/anesthesia-cases.html','/patient-dashboard.html']) {
    const r = await open(b, p, 'anon');
    t(('anonymous on ' + p).padEnd(46) + '→ homepage', r.url === '/index.html', r.url);
  }

  // ── 2 · THE DOCTOR PRODUCT IS OPEN BEFORE VERIFICATION ──────────────────
  console.log('\n── 2 · unverified doctor: the clinician product ──');
  {
    const r = await open(b, '/dashboard.html', 'unverified');
    t('workspace opens', r.url === '/dashboard.html', r.url);
    t('...on a welcome panel, not a warning', /Welcome to your clinician workspace/i.test(r.text));
    t('...naming Live Tools, Live Chart, References and Videos',
      ['Live Tools','Live Chart','References','Videos'].every(x => r.text.includes(x)));
    t('...with the verification card', /Complete professional verification to work with patients/i.test(r.text));
    t('...listing what verification unlocks', /Preoperative questionnaires/i.test(r.text));
    t('...and NO patient sections in the rail',
      !r.rail.includes('Patients') && !r.rail.includes('Operating List') && !r.rail.includes('Questions'), r.rail);
    /* THE REGRESSION THIS CAUGHT. The first version left the patient sections
       in the DOM and only removed them from the rail. Both they and the
       welcome panel carry .active, so the workspace rendered the welcome card
       and then, directly beneath it, a full patient console reporting zero:
       "0 patients", zero Awaiting Questionnaire, zero Recycle Bin, and a New
       Patient button. Every one of those zeros is a claim about a thing the
       account cannot have. Hidden is not the same as absent. */
    t('...and no patient console underneath it either',
      !/\bpatients\b/i.test(r.text.replace(/work with patients|Patient management and your operating list/gi,'')) ||
      !/New Patient|Recycle Bin|Awaiting Questionnaire/i.test(r.text),
      (r.text.match(/New Patient|Recycle Bin|Awaiting Questionnaire|\d+ patients/gi) || []));
    t('...no zero counts anywhere on the page', !/\b0 patients\b/i.test(r.text));
    t('...the rail still offers the tools', r.rail.includes('References') && r.rail.includes('Resources'), r.rail);
    t('no page error', r.errs.length === 0, r.errs);
  }
  {
    const r = await open(b, '/engine.html', 'unverified');
    t('Live Tools opens', r.url === '/engine.html', r.url);
    t('...and rendered its content', r.text.length > 200, r.text.slice(0,60));
    t('no page error', r.errs.length === 0, r.errs);
  }
  for (const p of ['/references.html','/resources.html','/videos.html','/airway.html','/scores.html']) {
    const r = await open(b, p, 'unverified');
    t(('reference page ' + p).padEnd(46) + '→ open', r.url === p, r.url);
  }
  {
    const r = await open(b, '/doctor-pending.html', 'unverified');
    t('their own verification form opens', r.url === '/doctor-pending.html', r.url);
    const s = await open(b, '/settings.html', 'unverified');
    t('their own settings open', s.url === '/settings.html', s.url);
  }

  // ── 3 · LIVE CHART, STANDALONE ──────────────────────────────────────────
  console.log('\n── 3 · Live Chart before verification ──');
  {
    const r = await open(b, '/anesthesia-cases.html', 'unverified');
    t('Live Chart opens', r.url === '/anesthesia-cases.html', r.url);
    t('...and says the charts are not attached to a patient record',
      /not attached to a patient record/i.test(r.text));
    t('...and offers the way to change that', /professional verification/i.test(r.text));
    t('no page error', r.errs.length === 0, r.errs);
  }
  {
    /* The New Case form is the thing that would attach a patient if anything
       did. It passes none of the three link columns, and this is the assertion
       that keeps it that way. */
    const src = fs.readFileSync('/home/user/anestheo-website/anesthesia-cases.html','utf8');
    const call = (src.match(/ANES\.createCase\(\{[\s\S]*?\}\)/) || [''])[0];
    t('the New Case form sends no surgery_id',        !/surgery_id/.test(call));
    t('the New Case form sends no clinic_patient_id', !/clinic_patient_id/.test(call));
    t('the New Case form sends no patient_user_id',   !/patient_user_id/.test(call));
  }
  {
    const r = await open(b, '/anesthesia-cases.html', 'verified');
    t('a verified doctor gets Live Chart without the practice notice',
      r.url === '/anesthesia-cases.html' && !/not attached to a patient record/i.test(r.text), r.url);
  }
  {
    const r = await open(b, '/anesthesia-cases.html', 'patient');
    t('a patient cannot reach clinician Live Chart', r.url !== '/anesthesia-cases.html', r.url);
  }

  // ── 4 · VERIFIED DOCTOR IS UNCHANGED ────────────────────────────────────
  console.log('\n── 4 · verified doctor keeps everything ──');
  {
    const r = await open(b, '/dashboard.html', 'verified');
    t('workspace opens', r.url === '/dashboard.html', r.url);
    t('...with the patient sections back',
      r.rail.includes('Patients') && r.rail.includes('Operating List') && r.rail.includes('Questions'), r.rail);
    t('...and no welcome panel', !/Welcome to your clinician workspace/i.test(r.text));
    t('...and no verification card', !/Complete professional verification/i.test(r.text));
    t('no page error', r.errs.length === 0, r.errs);
  }
  for (const p of ['/engine.html','/anesthesia-cases.html','/questionnaires.html','/references.html']) {
    const r = await open(b, p, 'verified');
    t(('verified doctor on ' + p).padEnd(46) + '→ open', r.url === p, r.url);
  }

  // ── 5 · PATIENT AND ADMIN ARE UNCHANGED ─────────────────────────────────
  console.log('\n── 5 · patient and administrator ──');
  for (const [p, expect] of [['/patient-dashboard.html','/patient-dashboard.html'],
                             ['/health-passport.html','/health-passport.html'],
                             ['/dashboard.html','/patient-dashboard.html'],
                             ['/questionnaires.html','/patient-dashboard.html'],
                             /* Public now, and public means public. */
                             ['/engine.html','/engine.html']]) {
    const r = await open(b, p, 'patient');
    t(('patient on ' + p).padEnd(46) + '→ ' + expect, r.url === expect, r.url);
  }
  for (const p of ['/dashboard.html','/admin.html','/users.html','/engine.html']) {
    const r = await open(b, p, 'admin');
    t(('administrator on ' + p).padEnd(46) + '→ open', r.url === p, r.url);
  }
  {
    const r = await open(b, '/dashboard.html', 'admin');
    t('an administrator is never shown the unverified welcome panel',
      !/Welcome to your clinician workspace/i.test(r.text));
    t('...and keeps the patient sections', r.rail.includes('Patients'), r.rail);
  }

  // ── 6 · THE MEASUREMENT THAT MATTERS ────────────────────────────────────
  /* Not "is the button hidden" but "was the question asked". Every table an
     unverified doctor's pages reach for, recorded at the client boundary. */
  console.log('\n── 6 · what an unverified doctor\'s pages actually ask the database for ──');
  for (const path of ['/dashboard.html','/engine.html','/anesthesia-cases.html','/references.html']) {
    const s = await openProbed(b, path, 'unverified');
    const badT = s.tables.filter(x => PATIENT_TABLES.includes(x));
    const badR = s.rpcs.filter(x => PATIENT_RPCS.includes(x));
    t(('unverified on ' + path).padEnd(40) + 'touches no patient table', badT.length === 0, badT);
    t(('unverified on ' + path).padEnd(40) + 'calls no patient RPC', badR.length === 0, badR);
    console.log('       tables: ' + (s.tables.join(', ') || '(none)'));
  }
  {
    /* And the contrast: a VERIFIED doctor's workspace does ask, which is what
       makes the assertion above meaningful rather than vacuous. */
    const s = await openProbed(b, '/dashboard.html', 'verified');
    const asked = s.tables.filter(x => PATIENT_TABLES.includes(x));
    t('a verified doctor\'s workspace DOES query patient tables', asked.length > 0, asked);
  }

  // ── 7 · THE SQL SAYS THE SAME THING THE FRONTEND DOES ───────────────────
  console.log('\n── 7 · the migration and the frontend agree ──');
  {
    const sql = fs.readFileSync('/home/user/anestheo-website/v9_5_verification_boundary.sql','utf8');
    t('v9_5 gates every patient-management table',
      PATIENT_TABLES.slice(0,11).every(x => sql.includes("'" + x + "'")));
    t('v9_5 adds the unlinked-case rule', /anesthesia_case_unlinked/.test(sql));
    t('v9_5 guards writes as well as reads', /WITH CHECK.*is_pending_doctor/s.test(sql));
    t('v9_5 never drops a patient-management gate',
      !/DROP POLICY[\s\S]{0,200}patient_surgeries|DROP POLICY[\s\S]{0,200}clinic_patients/.test(sql));
    t('v9_5 creates no permissive policy', !/CREATE POLICY(?![\s\S]{0,120}RESTRICTIVE)/.test(sql));
    const v93 = fs.readFileSync('/home/user/anestheo-website/v9_3_doctor_account_separation.sql','utf8');
    t('v9_3 now requires v9_5 first', /anesthesia_case_unlinked[\s\S]{0,120}APPLY IT FIRST/.test(v93));
    t('v9_3 no longer claims a doctor account opens patient data',
      !/opens the clinical workspace — patients, charts/.test(v93));
    const inv = fs.readFileSync('/home/user/anestheo-website/v9_4_access_state_inventory.sql','utf8');
    t('the inventory is read only', !/\b(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE)\s+(POLICY|TABLE|FUNCTION|INTO)/i.test(inv));
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
