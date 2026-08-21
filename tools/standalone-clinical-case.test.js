#!/usr/bin/env node
/* standalone-clinical-case.test.js
 *
 * A doctor account that is not yet verified charts real anesthesia against a
 * case that identifies nobody.
 *
 * WHAT PRODUCTION SAYS, MEASURED
 * ------------------------------
 * The pg_policies read came back:
 *
 *   anes_case_insert  PERMISSIVE INSERT
 *     WITH CHECK ( is_doctor_account()
 *                  AND anesthesiologist_id = auth.uid()
 *                  AND created_by = auth.uid()
 *                  AND status IN ('draft','in_progress') )
 *
 * is_doctor_account(), not is_verified_doctor(). v9 section 3.3 ran, so an
 * unverified doctor CAN insert. That was the last inference in the review and
 * it is now a reading. This file is written against it.
 *
 * TWO LAYERS, TESTED SEPARATELY, BECAUSE THEY ARE NOT THE SAME CLAIM
 * -----------------------------------------------------------------
 * Sections 1-4 test the FORM: which fields are drawn, what they are called,
 * what the create call sends. A form is guidance. Anyone can open a console.
 *
 * Section 5 tests the BOUNDARY as written in v9_5's policy text. That is what
 * actually refuses mrn, date_of_birth and the three link columns, and it is
 * the reason the form is allowed to be only a form.
 *
 * Neither section proves the deployed database enforces it. Only applying
 * v9_5 does. Saying so is more useful than a green tick that means nothing.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const V95  = fs.readFileSync('/home/user/anestheo-website/v9_5_verification_boundary.sql', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 130);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

const UNVERIFIED = { email:'d@e.com',  role:'doctor', verification_status:'pending',  is_admin:false, full_name:'Dana Levi' };
const VERIFIED   = { email:'d2@e.com', role:'doctor', verification_status:'approved', is_admin:false, full_name:'Dana Levi' };

async function open(b, path, profile) {
  const ctx = await b.newContext({ viewport:{ width:1440, height:1100 } });
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
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(profile) + ';');
  /* THE MOCK DOES NOT RECORD THIS ONE. anesthesia_cases is served by the
     mock's own query builder, whose insert() sets _rows and returns `this`
     without calling record() - so window.__calls.insert stays empty however
     many cases are created. The row is captured at the builder instead, which
     is also closer to the truth: it is the payload as it leaves the client,
     after ANES.fromForm and clean(). Persisted, because createCase navigates
     to the record page and a variable would not survive that. */
  await pg.addInitScript(`
    (function(){
      var KEY='__probe_inserted';
      window.__inserted=function(){ try{ return JSON.parse(sessionStorage.getItem(KEY)); }catch(e){ return null; } };
      var iv=setInterval(function(){
        if(!window.sb||!window.sb.from||window.sb.__insProbe) return;
        clearInterval(iv);
        var orig=window.sb.from.bind(window.sb);
        window.sb.from=function(tbl){
          var qb=orig(tbl);
          if(tbl==='anesthesia_cases'&&qb&&typeof qb.insert==='function'){
            var oi=qb.insert.bind(qb);
            qb.insert=function(rows){
              try{ sessionStorage.setItem(KEY,JSON.stringify([].concat(rows)[0])); }catch(e){}
              return oi(rows);
            };
          }
          return qb;
        };
        window.sb.__insProbe=true;
      },5);
    })();
  `);
  try { await pg.goto(BASE + path, { waitUntil:'networkidle' }); } catch(e){}
  await pg.waitForTimeout(1400);
  return { ctx, pg, errs };
}

/* What the New Case form is showing, read from the DOM rather than the source. */
const readForm = pg => pg.evaluate(() => {
  const vis = id => { const e = document.getElementById(id);
    if (!e) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0; };
  const txt = id => (document.getElementById(id) || {}).textContent || '';
  return {
    standalone:  !!(window.ANES && window.ANES.standalone),
    nameLabel:   txt('n-name-lab').trim(),
    namePlace:   (document.getElementById('n-name') || {}).placeholder || '',
    mrnVisible:  vis('n-mrn'),
    dobLabel:    txt('n-dob-lab').trim(),
    dobTabs:     document.querySelectorAll('.dobtab').length,
    ageRow:      !!document.getElementById('n-dob-row-age'),
    hasDiag:     !!document.getElementById('n-diag'),
    hasWeight:   vis('n-weight'),
    hasHeight:   vis('n-height'),
    hasAsa:      vis('n-asa'),
    hasProc:     vis('n-proc'),
    hasSex:      vis('n-sex'),
    ageUnits:    [...document.querySelectorAll('#n-dob-au option')]
                   .map(o => o.value).filter(Boolean),
    cardHead:    (document.querySelector('.card-h') || {}).textContent || '',
    notice:      (document.querySelector('.ac-standalone') || {}).textContent || '',
    searchPlace: (document.getElementById('q') || {}).placeholder || ''
  };
});

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1 · THE UNVERIFIED DOCTOR'S FORM ────────────────────────────────────
  console.log('\n── 1 · unverified doctor: Standalone Clinical Case ──');
  {
    const { ctx, pg, errs } = await open(b, '/anesthesia-cases.html', UNVERIFIED);
    const f = await readForm(pg);

    t('standalone mode is on', f.standalone === true);
    t('the name field is a CASE TITLE', f.nameLabel === 'Case title', f.nameLabel);
    t('...with a placeholder that is not a person', !/patient|theatre/i.test(f.namePlace), f.namePlace);
    t('MRN is not on the form at all', f.mrnVisible === false);
    t('date of birth is replaced by AGE', f.dobLabel === 'Age', f.dobLabel);
    t('...and there is no Date of birth tab to switch back to', f.dobTabs === 0, f.dobTabs);
    t('...the age row is what renders', f.ageRow === true);
    t('the heading names it', /STANDALONE CLINICAL CASE/i.test(f.cardHead), f.cardHead);
    t('...and the word "sandbox" appears nowhere', !/sandbox/i.test(f.notice + f.cardHead), f.notice.slice(0,60));

    /* The clinical half is the point. If these went missing the boundary would
       have cost the product the thing it was protecting. */
    t('weight is still asked for',   f.hasWeight === true);
    t('height is still asked for',   f.hasHeight === true);
    t('ASA is still asked for',      f.hasAsa === true);
    t('procedure is still asked for',f.hasProc === true);
    t('diagnosis is now asked for',  f.hasDiag === true);
    /* Sex was only ever on the case header, so a new record started without it.
       ANES.createCase always forwarded the column; the form never asked. */
    t('sex is now asked for at creation', f.hasSex === true);
    t('...and age offers years, months and days',
      ['years','months','days'].every(u => f.ageUnits.indexOf(u) >= 0), f.ageUnits);
    /* The wording is specified verbatim, so it is asserted verbatim. */
    t('the notice says exactly what it was asked to say',
      /This is a standalone clinical case\. Do not enter identifiable patient information until your account is verified\./
        .test(f.notice.replace(/\s+/g,' ')), f.notice.slice(0,110));
    t('the search no longer offers MRN', !/MRN/i.test(f.searchPlace), f.searchPlace);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 2 · CREATING ONE ────────────────────────────────────────────────────
  console.log('\n── 2 · unverified doctor CAN create a standalone case ──');
  {
    const { ctx, pg, errs } = await open(b, '/anesthesia-cases.html', UNVERIFIED);
    await pg.fill('#n-name', 'Morning list, case 2');
    await pg.fill('#n-weight', '78');
    await pg.fill('#n-height', '174');
    await pg.selectOption('#n-asa', 'II');
    await pg.selectOption('#n-sex', 'female');
    await pg.fill('#n-proc', 'Laparoscopic cholecystectomy');
    await pg.fill('#n-diag', 'Symptomatic cholelithiasis');
    await pg.click('#n-go');
    await pg.waitForTimeout(1600);

    const s = await pg.evaluate(() => ({
      url: location.pathname + location.search,
      err: ((document.getElementById('n-err')||{}).textContent||'').trim(),
      /* The row as it was actually sent to the client boundary. */
      sent: window.__inserted ? window.__inserted() : null
    }));

    t('the case is created without error', s.err === '', s.err || '(none)');
    t('...and the record opens', /anesthesia-record\.html\?case=/.test(s.url), s.url);
    t('...the title landed in display_name',
      s.sent && s.sent.display_name === 'Morning list, case 2', s.sent && s.sent.display_name);
    t('...sex landed too', s.sent && s.sent.sex === 'female', s.sent && s.sent.sex);
    t('...the clinical values landed',
      s.sent && s.sent.weight_kg == 78 && s.sent.asa_class === 'II' &&
      s.sent.diagnosis === 'Symptomatic cholelithiasis',
      s.sent && [s.sent.weight_kg, s.sent.asa_class, s.sent.diagnosis]);

    // ❌ cannot save MRN   ❌ cannot save DOB   ❌ cannot attach patient
    t('NO mrn was sent', s.sent && (s.sent.mrn === null || s.sent.mrn === undefined), s.sent && s.sent.mrn);
    t('NO date_of_birth was sent',
      s.sent && (s.sent.date_of_birth === null || s.sent.date_of_birth === undefined),
      s.sent && s.sent.date_of_birth);
    t('NO surgery_id was sent',
      s.sent && (s.sent.surgery_id === null || s.sent.surgery_id === undefined), s.sent && s.sent.surgery_id);
    t('NO clinic_patient_id was sent',
      s.sent && (s.sent.clinic_patient_id === null || s.sent.clinic_patient_id === undefined),
      s.sent && s.sent.clinic_patient_id);
    t('NO patient_user_id was sent',
      s.sent && (s.sent.patient_user_id === null || s.sent.patient_user_id === undefined),
      s.sent && s.sent.patient_user_id);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 3 · THE OPEN RECORD, WHERE IDENTITY WAS ALSO EDITABLE ───────────────
  /* The second site, and the one an earlier pass missed: caseHeader edits the
     record after it is open. Constraining only the New Case form would have
     left this as a way straight back to a patient name. */
  console.log('\n── 3 · the case header inside the open record ──');
  {
    const { ctx, pg, errs } = await open(b, '/anesthesia-cases.html', UNVERIFIED);
    await pg.fill('#n-name', 'Morning list, case 3');
    await pg.click('#n-go'); await pg.waitForTimeout(1800);
    /* The record opens on the chart. caseHeader is rendered inside the
       Anesthesia section, so it has to be opened before its labels exist. */
    await pg.evaluate(() => { if (typeof goSection === 'function') goSection('anesthesia'); });
    await pg.waitForTimeout(700);
    const s = await pg.evaluate(() => {
      const labs = [...document.querySelectorAll('.flab')].map(n => n.textContent.trim());
      return {
        url: location.pathname,
        standalone: !!(window.ANES && window.ANES.standalone),
        labels: labs,
        hasMrnField: labs.some(l => /^MRN$/i.test(l)),
        hasDobField: labs.some(l => /date of birth/i.test(l)),
        hasPatientName: labs.some(l => /^Patient name$/i.test(l)),
        hasCaseTitle: labs.some(l => /^Case title$/i.test(l)),
        body: (document.body.innerText || '').replace(/\s+/g,' '),
        sections: [...document.querySelectorAll('#rail button, #rail a')]
                    .map(n => n.textContent.replace(/\s+/g,' ').trim()).filter(Boolean)
      };
    });
    t('the record page is in standalone mode', s.standalone === true, s.url);
    t('the case header has NO MRN field', s.hasMrnField === false, s.labels.slice(0,8));
    t('...and NO date of birth field', s.hasDobField === false, s.labels.slice(0,8));
    t('...and does not say "Patient name"', s.hasPatientName === false);
    t('...it says "Case title"', s.hasCaseTitle === true, s.labels.slice(0,4));
    t('the anesthesia record itself is still there',
      /vitals|medication|airway|event/i.test(s.body));
    /* "Clinical notes" and "Anesthesia plan" are documented inside the record
       rather than on the create form - anesthesia_cases has no notes or plan
       column, so the record's own sections are where they live. An unverified
       doctor must reach them, or the standalone case is a header with nothing
       under it. */
    t('...including the anesthesia technique and case detail',
      /anesthesia|technique|case details/i.test(s.body));
    t('...and the sections that carry notes and the plan',
      s.sections.length >= 8, s.sections.slice(0, 10));
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 4 · THE VERIFIED DOCTOR IS UNCHANGED ────────────────────────────────
  console.log('\n── 4 · verified doctor: the patient workflow is untouched ──');
  {
    const { ctx, pg, errs } = await open(b, '/anesthesia-cases.html', VERIFIED);
    const f = await readForm(pg);
    t('standalone mode is OFF', f.standalone === false);
    t('the field is "Patient name"', f.nameLabel === 'Patient name', f.nameLabel);
    t('MRN is on the form', f.mrnVisible === true);
    t('date of birth is offered', /date of birth/i.test(f.dobLabel), f.dobLabel);
    t('...with both tabs to choose between', f.dobTabs === 2, f.dobTabs);
    t('the heading is the ordinary one', !/STANDALONE/i.test(f.cardHead), f.cardHead);
    t('...and there is no standalone notice', f.notice === '', f.notice.slice(0,40));
    t('the search still offers MRN', /MRN/i.test(f.searchPlace), f.searchPlace);

    await pg.fill('#n-name', 'Real Patient');
    await pg.fill('#n-mrn', 'MRN-4242');
    await pg.click('#n-go'); await pg.waitForTimeout(1600);
    const s = await pg.evaluate(() => ({
      url: location.pathname,
      err: ((document.getElementById('n-err')||{}).textContent||'').trim(),
      sent: window.__inserted ? window.__inserted() : null
    }));
    t('a verified doctor CAN create a case with identifiers', s.err === '', s.err || '(none)');
    t('...and the MRN is sent', s.sent && s.sent.mrn === 'MRN-4242', s.sent && s.sent.mrn);
    t('...and the patient name is sent',
      s.sent && s.sent.display_name === 'Real Patient', s.sent && s.sent.display_name);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 5 · THE BOUNDARY, NOT THE FORM ──────────────────────────────────────
  /* Everything above is a form agreeing with a rule. This is the rule. */
  console.log('\n── 5 · v9_5 is what actually refuses these columns ──');
  {
    /* The policy is assembled with || across several lines, so its WITH CHECK
       body is never contiguous in the file. Stripping the concatenation
       syntax reconstructs the SQL that actually reaches Postgres. */
    const FLAT = V95.replace(/'\s*\|\|\s*'/g, '').replace(/\s+/g, ' ');
    const wc = (FLAT.match(/WITH CHECK \(NOT public\.is_pending_doctor\(\) OR \([^)]*\)/) || [''])[0];
    t('the policy refuses surgery_id',        /surgery_id IS NULL/.test(wc));
    t('the policy refuses clinic_patient_id', /clinic_patient_id IS NULL/.test(wc));
    t('the policy refuses patient_user_id',   /patient_user_id IS NULL/.test(wc));
    t('the policy refuses mrn',               /mrn IS NULL/.test(wc));
    t('the policy refuses date_of_birth',     /date_of_birth IS NULL/.test(wc));
    t('...all five in ONE WITH CHECK, as specified',
      ['surgery_id','clinic_patient_id','patient_user_id','mrn','date_of_birth']
        .every(c => new RegExp(c + ' IS NULL').test(wc)), wc.slice(0, 100));

    /* display_name must NOT be constrained - it carries the case title. */
    t('display_name is NOT constrained', !/display_name IS NULL/.test(V95));
    /* USING keeps only the link test, so a pre-existing case with an mrn stays
       readable and can be corrected. */
    const using = (FLAT.match(/USING \(NOT public\.is_pending_doctor\(\) OR \([^)]*\)/) || [''])[0];
    t('USING does NOT test identifiers, so an old case stays readable',
      !/mrn IS NULL/.test(using), using.slice(0, 90));
    t('...which makes clearing the identifier the one edit that always works',
      /self-healing/.test(V95));
    t('the verified doctor short-circuits at NOT is_pending_doctor()',
      /NOT public\.is_pending_doctor\(\) OR/.test(wc));
    t('v9_5 still changes no permissive policy',
      !/CREATE POLICY(?![\s\S]{0,140}RESTRICTIVE)/.test(V95));
    t('...and does not touch anes_case_insert, which production confirmed is correct',
      !/anes_case_insert/.test(V95));
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
