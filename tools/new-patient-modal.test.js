#!/usr/bin/env node
/* new-patient-modal.test.js
 *
 * THE SHARED NEW PATIENT WORKFLOW, from both hosts.
 *
 * The dialog used to live inside dashboard.html, which meant Live Tools could
 * not offer it without a second copy — and the half that drifted would have
 * been the half that decides whether an invitation counts as sent. It is now
 * new-patient.js, opened by the dashboard board and by the Live Tools case
 * bar, and this file drives BOTH so that "shared" is a measured fact rather
 * than an architectural intention.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT: creating a patient sends nothing.
 * Opening the dialog sends nothing. Showing the link sends nothing. Copying
 * the link sends nothing. questionnaire_status becomes 'sent' only after a
 * delivery actually launched. Every section below counts writes to prove it.
 *
 * A DEFECT THIS FILE ONCE MISSED: Copy link interpolated a JSON string into a
 * double-quoted onclick, so the URL's own quote closed the attribute and the
 * button threw on every press. The assertion covering it checked only that
 * the button was not disabled. It is now clicked, and a raised error fails.
 *
 * WHAT THIS FILE CANNOT DO: it has no database. The insert is served by a stub
 * that records what was written, so the assertions are about the dialog's
 * behaviour and about the payload the page builds, never about production.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 170);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(68) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(68) + ' ' + fmt(d)); }
};

const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
/* Comments are not the product. This repo has repeatedly written an assertion
   that passed because it matched the note explaining it. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const NP    = read('new-patient.js');
const NPC   = code(NP);
const DASH  = read('dashboard.html');
const DASHC = code(DASH);
const ENG   = read('engine.html');
const ENGC  = code(ENG);

const UID    = '9e000000-0000-4000-8000-00000000cafe';
const DOCTOR = { email:'d@e.com', role:'doctor', verification_status:'approved', is_admin:false, full_name:'Dr Dana Levi' };

/* The insert stub. It answers exactly the two tables the workflow writes and
   hands nothing else back, so a passing test never rests on behaviour the stub
   invented. Every insert and every update is recorded for inspection. */
const STUB = `
window.__NP = { inserts: [], updates: [] };
(function(){
  function install(){
    if(!window.sb || !window.sb.from) return false;
    var prior = window.sb.from.bind(window.sb);
    var STORE = { clinic_patients: [], patient_surgeries: [] };
    window.sb.from = function(tbl){
      if(!STORE[tbl]) return prior(tbl);
      var q = {
        _rows: STORE[tbl].slice(),
        select: function(){ return q; },
        eq: function(c,v){ q._rows = q._rows.filter(function(r){ return r[c]===v; }); return q; },
        is: function(){ return q; }, in: function(){ return q; }, order: function(){ return q; },
        maybeSingle: function(){ return Promise.resolve({ data:q._rows[0]||null, error:null }); },
        then: function(res,rej){ return Promise.resolve({ data:q._rows, error:null }).then(res,rej); },
        insert: function(rec){
          window.__NP.inserts.push({ table:tbl, rec:JSON.parse(JSON.stringify(rec)) });
          var row = Object.assign({ id:'row-'+tbl+'-'+STORE[tbl].length,
                                    created_at:new Date().toISOString() }, rec);
          STORE[tbl].push(row);
          var ins = { select: function(){ return ins; },
            maybeSingle: function(){ return Promise.resolve({ data:row, error:null }); },
            then: function(res,rej){ return Promise.resolve({ data:[row], error:null }).then(res,rej); } };
          return ins;
        },
        update: function(patch){
          return { eq: function(c,v){
            window.__NP.updates.push({ table:tbl, patch:patch, on:{ col:c, val:v } });
            STORE[tbl].forEach(function(r){ if(r[c]===v) Object.assign(r, patch); });
            return Promise.resolve({ data:null, error:null });
          } };
        }
      };
      return q;
    };
    return true;
  }
  if(!install()) document.addEventListener('DOMContentLoaded', install);
})();
`;

async function openPage(b, path, viewport) {
  const ctx = await b.newContext({ viewport: viewport || { width:1500, height:1100 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u))  return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(DOCTOR) + ';' +
                         'window.__LC_UID=' + JSON.stringify(UID) + ';');
  await pg.goto(BASE + path, { waitUntil:'domcontentloaded' }).catch(() => {});
  await pg.addScriptTag({ content: STUB });
  await pg.waitForTimeout(1200);
  return { ctx, pg, errs };
}

/* Fill the shared form and create. Same ids from either host, which is the
   point. */
const CREATE = (opts = {}) => `(async () => {
  ${opts.launch || 'wsOpenAddModal();'}
  await new Promise(r => setTimeout(r, 220));
  const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
  set('np-fname', ${JSON.stringify(opts.fname ?? 'Nino')});
  set('np-lname', ${JSON.stringify(opts.lname ?? 'Beridze')});
  set('np-phone', ${JSON.stringify(opts.phone ?? '+995 555 11 22 33')});
  set('np-email', ${JSON.stringify(opts.email ?? 'nino@example.com')});
  set('np-proc',  ${JSON.stringify(opts.proc  ?? 'Knee arthroscopy')});
  set('np-hospital', 'Central Clinic');
  set('np-date', '2026-12-01');
  document.getElementById('np-create').click();
  await new Promise(r => setTimeout(r, 650));
  const modal = document.getElementById('np-modal');
  const btn = id => { const e = document.getElementById(id);
    return e ? { text:e.textContent.trim(), disabled:!!e.disabled, title:e.getAttribute('title')||'' } : null; };
  return {
    sharedDom: !!modal,
    open: modal.classList.contains('open'),
    path: location.pathname,
    title: document.getElementById('np-title').textContent.trim(),
    facts: [...document.querySelectorAll('.np-fact')].map(f => f.innerText.replace(/\\s+/g,' ').trim()),
    email: btn('np-email'), wa: btn('np-wa'), copy: btn('np-copy'),
    use: btn('np-use'), openPatient: btn('np-open'), tools: btn('np-tools'), done: btn('np-done'),
    status: (document.getElementById('np-status')||{}).innerText || '',
    statusOn: !!document.querySelector('#np-status .np-dot.on'),
    inserts: window.__NP.inserts.map(i => i.table),
    payload: (window.__NP.inserts.find(i => i.table === 'clinic_patients')||{}).rec || null,
    updates: window.__NP.updates.length
  };
})()`;

(async () => {
  console.log('\n=== SHARED NEW PATIENT WORKFLOW ============================\n');

  /* ── 1. ONE implementation ────────────────────────────────────────────── */
  console.log('1. ONE IMPLEMENTATION, TWO HOSTS');
  t('new-patient.js exists and exports the workflow',
    /root\.NewPatient\s*=\s*\{/.test(NPC));
  t('both pages load it',
    /new-patient\.js/.test(DASH) && /new-patient\.js/.test(ENG));
  t('both pages load its stylesheet',
    /new-patient\.css/.test(DASH) && /new-patient\.css/.test(ENG));
  t('the dashboard delegates rather than keeping its own dialog',
    /function wsOpenAddModal\(\)\{[\s\S]{0,200}NewPatient\.open\(/.test(DASHC));
  t('...and its old dialog markup is gone', !/id="ws-add-modal"/.test(DASH));
  t('...and its old form ids are gone', !/wa-fname|wa-c-copy|wa-created-view/.test(DASHC));
  t('Live Tools opens the same module',
    /function ltNewPatient\(\)\{[\s\S]{0,200}NewPatient\.open\(/.test(ENGC));
  t('neither page defines a second create path',
    !/function wsSavePatient/.test(DASHC) && !/function wsCollectAdd/.test(DASHC));
  /* One module, one write that can record a delivery. */
  const markSites = (NPC.match(/markSent\(/g) || []).length;
  t('markSent has one definition and two callers', markSites === 3, markSites);
  t('...and neither is the create path',
    !/insert\([\s\S]{0,400}markSent/.test(NPC));

  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    /* ── 2. FROM THE DASHBOARD ──────────────────────────────────────────── */
    console.log('\n2. FROM THE DASHBOARD');
    let s = await openPage(b, '/dashboard.html');
    let r = await s.pg.evaluate(CREATE());
    t('the shared dialog opened', r.sharedDom === true);
    t('it stays open after create', r.open === true);
    t('and does not navigate away', r.path === '/dashboard.html', r.path);
    t('the title confirms', /Patient created/.test(r.title), r.title);
    t('first and last name are joined into patient_name',
      r.payload && r.payload.patient_name === 'Nino Beridze', r.payload && r.payload.patient_name);
    t('both canonical rows are inserted',
      r.inserts.join(',') === 'clinic_patients,patient_surgeries', r.inserts);
    t('the record is inserted not_sent',
      r.payload && r.payload.questionnaire_status === 'not_sent');
    t('creating writes nothing back to the row', r.updates === 0, r.updates);
    t('the invitation reads as not sent', /not sent yet/i.test(r.status), r.status.trim());
    t('the dashboard exits are Open patient / Live Tools / Done',
      !!r.openPatient && !!r.tools && !!r.done && !r.use,
      [r.openPatient && r.openPatient.text, r.tools && r.tools.text, r.done && r.done.text]);
    t('no page errors', s.errs.length === 0, s.errs.slice(0, 3));
    await s.ctx.close();

    /* ── 3. FROM LIVE TOOLS ─────────────────────────────────────────────── */
    console.log('\n3. FROM LIVE TOOLS');
    s = await openPage(b, '/engine.html');
    const btn = await s.pg.evaluate(`(() => {
      const e = document.querySelector('.case-np');
      return e ? { present:true, visible:e.offsetParent !== null,
                   label:e.textContent.trim(),
                   h:Math.round(e.getBoundingClientRect().height) } : { present:false };
    })()`);
    t('New Patient is present in the case bar at 1500', btn.present === true, btn);
    t('...and visible', btn.visible === true);
    t('...and labelled', /new patient/i.test(btn.label || ''), btn.label);

    r = await s.pg.evaluate(CREATE({ launch: "document.querySelector('.case-np').click();" }));
    t('the case-bar button launches the SHARED dialog', r.sharedDom === true);
    t('it stays open after create', r.open === true);
    t('and Live Tools is not navigated away from', r.path === '/engine.html', r.path);
    t('Email is offered immediately', r.email && !r.email.disabled, r.email);
    t('WhatsApp is offered immediately', r.wa && !r.wa.disabled, r.wa);
    t('Copy link is offered', !!r.copy);
    t('the Live Tools exits include Use this patient',
      !!r.use && !!r.openPatient && !!r.done && !r.tools,
      [r.use && r.use.text, r.openPatient && r.openPatient.text, r.done && r.done.text]);
    t('creating writes nothing back to the row', r.updates === 0, r.updates);

    /* Copy link must actually work, and must not claim a delivery. */
    const copied = await s.pg.evaluate(`(() => {
      const errs = []; const prior = window.onerror;
      window.onerror = function(m){ errs.push(String(m)); return true; };
      document.getElementById('np-copy').click();
      window.onerror = prior;
      return { errs, status:(document.getElementById('np-status')||{}).innerText||'',
               updates: window.__NP.updates.length };
    })()`);
    t('Copy link raises nothing when clicked', copied.errs.length === 0, copied.errs);
    t('...and says copied, not sent',
      /copied/i.test(copied.status) && /not sent/i.test(copied.status),
      copied.status.replace(/\s+/g, ' ').trim());
    t('...and still writes nothing to the row', copied.updates === 0, copied.updates);

    /* Use this patient loads the record here, without leaving. */
    const used = await s.pg.evaluate(`(() => {
      document.getElementById('np-use').click();
      return { closed: !document.getElementById('np-modal').classList.contains('open'),
               path: location.pathname,
               proc: document.getElementById('i-proc').value,
               ctxProc: (window.patientContext.procedure||{}).label || null };
    })()`);
    t('Use this patient closes the dialog', used.closed === true);
    t('...without leaving Live Tools', used.path === '/engine.html', used.path);
    t('...and loads the procedure into the workspace',
      used.proc === 'Knee arthroscopy', used.proc);
    t('...which the context resolves', used.ctxProc === 'Knee arthroscopy', used.ctxProc);
    t('no page errors across the whole Live Tools flow', s.errs.length === 0, s.errs.slice(0, 3));
    await s.ctx.close();

    /* ── 4. A CASE IN PROGRESS IS NOT OVERWRITTEN ───────────────────────── */
    console.log('\n4. A CASE IN PROGRESS IS NOT SILENTLY REPLACED');
    s = await openPage(b, '/engine.html');
    const guard = await s.pg.evaluate(`(async () => {
      /* a real case is on screen */
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','45'); set('i-sex','M'); set('i-height','178'); set('i-weight','82');
      set('i-proc','Colectomy'); compute();
      const before = { proc: document.getElementById('i-proc').value,
                       weight: document.getElementById('i-weight').value };
      document.querySelector('.case-np').click();
      await new Promise(r => setTimeout(r, 200));
      const s2 = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      s2('np-fname','Other'); s2('np-lname','Patient'); s2('np-proc','Cataract surgery');
      document.getElementById('np-create').click();
      await new Promise(r => setTimeout(r, 650));
      document.getElementById('np-use').click();
      await new Promise(r => setTimeout(r, 250));
      const asked = !!document.getElementById('lt-use-confirm');
      const during = { proc: document.getElementById('i-proc').value,
                       weight: document.getElementById('i-weight').value };
      /* decline, and nothing may have moved */
      if (asked) document.getElementById('lt-uc-no').click();
      const after = { proc: document.getElementById('i-proc').value,
                      weight: document.getElementById('i-weight').value };
      return { before, asked, during, after };
    })()`);
    t('Use this patient asks before replacing a live case', guard.asked === true);
    t('...and changes nothing while asking',
      guard.during.proc === 'Colectomy' && guard.during.weight === '82', guard.during);
    t('...and declining leaves the case exactly as it was',
      guard.after.proc === guard.before.proc && guard.after.weight === guard.before.weight,
      guard.after);
    await s.ctx.close();

    /* ── 5. MISSING CONTACT DETAILS ─────────────────────────────────────── */
    console.log('\n5. A CHANNEL WITH NO ADDRESS IS DISABLED, NOT BROKEN');
    s = await openPage(b, '/dashboard.html');
    r = await s.pg.evaluate(CREATE({ email:'', phone:'', proc:'' }));
    t('Email is disabled with no address', r.email && r.email.disabled === true, r.email);
    t('...and says why', /email/i.test((r.email||{}).title || ''), (r.email||{}).title);
    t('WhatsApp is disabled with no number', r.wa && r.wa.disabled === true);
    t('...and says why', /phone/i.test((r.wa||{}).title || ''));
    t('Copy link still works — the link exists regardless', r.copy && r.copy.disabled === false);
    t('missing facts read as Not recorded, never blank',
      r.facts.some(f => /Not recorded/.test(f)), r.facts);
    await s.ctx.close();

    /* ── 6. GEOMETRY, BOTH HOSTS ────────────────────────────────────────── */
    console.log('\n6. THE DIALOG FITS');
    for (const [path, w, h, cols] of [['/dashboard.html',1500,1100,2],
                                      ['/engine.html',1440,1200,2],
                                      ['/engine.html',390,844,1]]) {
      s = await openPage(b, path, { width:w, height:h });
      const g = await s.pg.evaluate(`(() => {
        ${path === '/engine.html' ? "document.querySelector('.case-np').click();" : 'wsOpenAddModal();'}
        const box = document.querySelector('#np-modal .np-box');
        const grid = document.querySelector('#np-modal .np-grid');
        return { w: Math.round(box.getBoundingClientRect().width),
                 cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
                 secs: [...document.querySelectorAll('#np-modal .np-sec')].map(x => x.textContent),
                 overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      const label = path.replace(/[/.]|html/g, '') + '@' + w;
      t(label + ': fits the viewport', g.w <= w, g.w);
      t(label + ': ' + cols + '-column form', g.cols === cols, g.cols);
      t(label + ': sections are Patient / Surgery / Contact',
        g.secs.join('|') === 'Patient|Surgery|Contact', g.secs);
      t(label + ': nothing overflows', g.overflow <= 0, g.overflow);
      await s.ctx.close();
    }
    t('820px on a desktop', /\.np-box\{[^}]*max-width:820px/.test(read('new-patient.css')));
    t('a full-height sheet on a phone',
      /@media\(max-width:600px\)[\s\S]{0,300}min-height:100dvh/.test(read('new-patient.css')));

    /* ── 7. NO SCHEMA CHANGE ────────────────────────────────────────────── */
    console.log('\n7. NOTHING NEW IS ASKED OF THE DATABASE');
    /* Some fields are set in the object literal and some are assigned onto it
       afterwards; both forms count, and neither may name a column that does
       not exist. This list is what the workflow has always written. */
    const WRITES = ['doctor_id','patient_name','phone_number','email','procedure',
                    'hospital','surgery_date','notes','token','questionnaire_status',
                    'consultation_status','patient_status'];
    const namesCol = c => new RegExp('(^|[^a-z_])' + c + '\\s*[:=]').test(NPC);
    const missing = WRITES.filter(c => !namesCol(c));
    t('the insert names every clinic_patients column it always did',
      missing.length === 0, missing);
    /* And nothing beyond them, or the schema changed wearing a form field's
       clothes. The second list is patient_surgeries, written in the same file. */
    const SURG = ['patient_id','assigned_doctor_id','clinic_patient_id','procedure_type',
                  'contact_email','care_state','sent_at','created_at','id'];
    /* Scan the two insert payloads only — the module's own export object also
       has keys, and they are not columns. */
    const payloads =
      NPC.slice(NPC.indexOf('function collect()'), NPC.indexOf('if (!name)')) +
      NPC.slice(NPC.indexOf('return {', NPC.indexOf('function collect()')),
                NPC.indexOf('async function create')) +
      NPC.slice(NPC.indexOf("from('patient_surgeries')"),
                NPC.indexOf('care_state', NPC.indexOf("from('patient_surgeries')")) + 24);
    const litKeys = [...payloads.matchAll(/([a-z_]+)\s*:/g)].map(m => m[1]);
    const extra = [...new Set(litKeys)].filter(k => !WRITES.includes(k) && !SURG.includes(k));
    t('...and no column the workflow did not write before', extra.length === 0, extra);
    t('no age or sex column is written',
      !/\bage\s*:/.test(NPC) && !/\bsex\s*:/.test(NPC));
    t('...and the form says where they come from instead',
      /Age and sex come from the questionnaire/.test(NP));
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
