#!/usr/bin/env node
/* new-patient-modal.test.js
 *
 * The New Patient dialog: its width, and what happens after Save.
 *
 * TWO DEFECTS ARE PINNED HERE.
 *
 * ONE — .ws-modal declared max-width twice, in two separate style blocks in
 * the same file, at equal specificity. The later rule always won, so the 460px
 * written earlier had never once taken effect. That is not a style question,
 * it is a lie in the source: anyone reading the first rule and adjusting it
 * would have watched nothing happen. Section 1 asserts the width now has one
 * source.
 *
 * TWO — wsSavePatient() closed the dialog on success. Creating the patient is
 * the middle of the job; the invitation still has to go out, and the doctor was
 * dropped back on the board to hunt for the row they had just made. Sections
 * 3-5 assert the dialog becomes the handover instead, and — the part that
 * matters clinically — that arriving at that screen does NOT record the
 * questionnaire as sent. "Sent" stays a claim only a real delivery may make.
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
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(66) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(66) + ' ' + fmt(d)); }
};

const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
/* Comments are not the product. This repo has repeatedly written an assertion
   that passed because it matched the note explaining it. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const DASH  = read('dashboard.html');
const DASHC = code(DASH);

const UID    = '9e000000-0000-4000-8000-00000000cafe';
const DOCTOR = { email:'d@e.com', role:'doctor', verification_status:'approved', is_admin:false, full_name:'Dr Dana Levi' };

/* The insert stub. It answers exactly the two tables wsSavePatient writes and
   hands nothing else back, so a passing test never rests on behaviour the stub
   invented. Every insert is recorded for inspection. */
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
        is: function(){ return q; },
        in: function(){ return q; },
        order: function(){ return q; },
        maybeSingle: function(){ return Promise.resolve({ data:q._rows[0]||null, error:null }); },
        then: function(res,rej){ return Promise.resolve({ data:q._rows, error:null }).then(res,rej); },
        insert: function(rec){
          window.__NP.inserts.push({ table:tbl, rec:JSON.parse(JSON.stringify(rec)) });
          var row = Object.assign({ id:'np-'+tbl+'-'+STORE[tbl].length,
                                    created_at:new Date().toISOString() }, rec);
          STORE[tbl].push(row);
          var ins = {
            select: function(){ return ins; },
            maybeSingle: function(){ return Promise.resolve({ data:row, error:null }); },
            then: function(res,rej){ return Promise.resolve({ data:[row], error:null }).then(res,rej); }
          };
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

async function openDash(b, viewport) {
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
  await pg.goto(BASE + '/dashboard.html', { waitUntil:'domcontentloaded' }).catch(() => {});
  await pg.addScriptTag({ content: STUB });
  await pg.waitForTimeout(900);
  return { ctx, pg, errs };
}

/* Fill the form and save. Returns everything the created view is showing. */
const CREATE = `(async () => {
  wsOpenAddModal();
  document.getElementById('wa-name').value     = 'Nino Beridze';
  document.getElementById('wa-phone').value    = '+995 555 11 22 33';
  document.getElementById('wa-email').value    = 'nino@example.com';
  document.getElementById('wa-proc').value     = 'Knee arthroscopy';
  document.getElementById('wa-hospital').value = 'Central Clinic';
  document.getElementById('wa-date').value     = '2026-12-01';
  await wsSavePatient(false);
  await new Promise(r => setTimeout(r, 500));
  const bg   = document.getElementById('ws-add-modal');
  const form = document.getElementById('wa-form-view');
  const made = document.getElementById('wa-created-view');
  const btn  = s => { const e = made.querySelector(s); return e ? { text:e.textContent.trim(), disabled:!!e.disabled, tag:e.tagName } : null; };
  return {
    open: bg.classList.contains('open'),
    formHidden: form.hidden,
    madeShown: !made.hidden,
    title: document.getElementById('wa-title').textContent.trim(),
    text: made.innerText.replace(/\\s+/g, ' ').trim(),
    facts: [...made.querySelectorAll('.wa-fact')].map(f => f.innerText.replace(/\\s+/g,' ').trim()),
    email: btn('#wa-c-email'), wa: btn('#wa-c-wa'), copy: btn('#wa-c-copy'),
    status: (made.querySelector('#wa-c-status')||{}).textContent || '',
    statusOn: !!made.querySelector('#wa-c-status .wa-dot.on'),
    actions: [...made.querySelectorAll('.wa-rule ~ .ws-modal-btns > *')].map(x => x.textContent.trim()),
    inserts: window.__NP.inserts.map(i => i.table),
    payload: (window.__NP.inserts.find(i => i.table === 'clinic_patients')||{}).rec || null,
    updates: window.__NP.updates.map(u => u.patch)
  };
})()`;

(async () => {
  console.log('\n=== NEW PATIENT DIALOG =====================================\n');

  /* ── 1. One source for the dialog width ───────────────────────────────── */
  console.log('1. WIDTH HAS ONE SOURCE');
  const wsModalRules = DASH.match(/^\.ws-modal\{[^}]*\}/gm) || [];
  const withMax = wsModalRules.filter(r => /max-width/.test(r));
  t('.ws-modal is still declared in two blocks (unchanged structure)', wsModalRules.length === 2, wsModalRules.length);
  t('...but only one of them sets max-width', withMax.length === 1,
    withMax.map(r => (r.match(/max-width:[^;]+/)||[''])[0]));
  t('the dead 460px declaration is gone', !/\.ws-modal\{[^}]*max-width:460px/.test(DASH));
  t('.ws-modal-xl is 820px', /\.ws-modal-xl\{max-width:820px;\}/.test(DASH));
  t('...and drops to full width on a narrow screen',
    /@media\(max-width:860px\)\{\s*\.ws-modal-xl\{max-width:100%;\}/.test(DASH));

  /* ── 2. Save no longer closes the dialog ──────────────────────────────── */
  console.log('\n2. THE SUCCESS PATH DOES NOT CLOSE');
  const save = DASHC.slice(DASHC.indexOf('async function wsSavePatient'),
                           DASHC.indexOf('function wsLink('));
  t('wsSavePatient renders the created view', /wsAddCreatedRender\(/.test(save));
  const flat = save.replace(/\s+/g, ' ');
  t('...and only closes when the insert returned no row',
    /if\(r\.data\)\{ wsAddCreatedRender\([^)]*\) ; \} else \{ wsCloseAddModal\(\);/.test(flat) ||
    /if\(r\.data\)\{ wsAddCreatedRender[^}]*\} else \{ wsCloseAddModal\(\);/.test(flat),
    (flat.match(/if\(r\.data\)[\s\S]{0,110}/) || [''])[0]);
  t('the created view never calls wsMarkSent', !/wsMarkSent/.test(
    DASHC.slice(DASHC.indexOf('function wsAddCreatedRender'), DASHC.indexOf('function wsAddCreatedRefresh'))));
  /* Three call sites, and each one is a delivery that actually launched:
     WhatsApp after the window opened, SMS after the handler was invoked, and
     the share modal's "I sent it". Creating a patient is not among them. */
  const markSites = (DASHC.match(/[\s\S]{90}wsMarkSent\(/g) || [])
    .filter(x => !/function wsMarkSent\($/.test(x));   /* the declaration is not a call */
  t('wsMarkSent has exactly three call sites', markSites.length === 3, markSites.length);
  t('...all inside a delivery path',
    markSites.every(x => /wsSendWhatsApp|wsSendSms|em-sent|win\)|location\.href/.test(x)),
    markSites.map(x => x.replace(/\s+/g,' ').slice(-64)));
  t('reopening the dialog resets it to the form',
    /function wsOpenAddModal\(\)\{[^}]*wsAddShowForm\(\)/.test(DASHC));
  t('closing the dialog tears the created view down',
    /function wsCloseAddModal\(\)\{[^}]*wsAddShowForm\(\)/.test(DASHC));

  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    const { ctx, pg, errs } = await openDash(b);

    /* ── 3. The created state ───────────────────────────────────────────── */
    console.log('\n3. WHAT THE DOCTOR SEES AFTER SAVE');
    const r = await pg.evaluate(CREATE);
    t('the dialog is still open', r.open === true, r.open);
    t('the form view is hidden', r.formHidden === true);
    t('the created view is shown', r.madeShown === true);
    t('the title becomes a confirmation', /Patient created/.test(r.title), r.title);
    t('the patient is named', /Nino Beridze/.test(r.text));
    t('the procedure is shown', r.facts.some(f => /Knee arthroscopy/.test(f)), r.facts);
    t('the surgery date is shown', r.facts.some(f => /2026-12-01/.test(f)));
    t('the hospital is shown', r.facts.some(f => /Central Clinic/.test(f)));

    /* ── 4. Sending is offered, never performed ─────────────────────────── */
    console.log('\n4. SENDING IS OFFERED, NOT ASSUMED');
    t('Email is offered', r.email && /Email/.test(r.email.text), r.email);
    t('...and is enabled, because a valid address was entered', r.email && !r.email.disabled);
    t('WhatsApp is offered', r.wa && /WhatsApp/.test(r.wa.text));
    t('...and is enabled, because a phone number was entered', r.wa && !r.wa.disabled);
    t('Copy link is offered', r.copy && /Copy link/.test(r.copy.text));
    t('the invitation reads as not sent', /not sent yet/i.test(r.status), r.status.trim());
    t('...and its dot is off', r.statusOn === false);
    t('NOTHING was written back to the row', r.updates.length === 0, r.updates);
    t('the record was inserted as not_sent', r.payload && r.payload.questionnaire_status === 'not_sent',
      r.payload && r.payload.questionnaire_status);
    t('both canonical rows were created', r.inserts.join(',') === 'clinic_patients,patient_surgeries', r.inserts);

    /* ── 5. Where the doctor goes next ──────────────────────────────────── */
    console.log('\n5. THE THREE EXITS');
    t('Open patient is offered', r.actions.some(a => /Open patient/.test(a)), r.actions);
    t('Live Tools is offered', r.actions.some(a => /Live Tools/.test(a)));
    t('Done is offered', r.actions.some(a => /^Done$/.test(a)));

    /* Reopening must not show the last patient. */
    const re = await pg.evaluate(`(() => {
      wsCloseAddModal(); wsOpenAddModal();
      return { form: !document.getElementById('wa-form-view').hidden,
               made: document.getElementById('wa-created-view').innerHTML.length,
               title: document.getElementById('wa-title').textContent.trim() };
    })()`);
    t('reopening shows the empty form', re.form === true, re);
    t('...and the previous patient is gone from the DOM', re.made === 0, re.made);
    t('...and the title is New Patient again', /New Patient/.test(re.title), re.title);

    /* ── 6. Missing contact details disable the channel ─────────────────── */
    console.log('\n6. A CHANNEL WITH NO ADDRESS IS DISABLED, NOT BROKEN');
    const bare = await pg.evaluate(`(async () => {
      wsCloseAddModal(); wsOpenAddModal();
      document.getElementById('wa-name').value = 'No Contact';
      await wsSavePatient(false);
      await new Promise(r => setTimeout(r, 400));
      const made = document.getElementById('wa-created-view');
      const b = s => { const e = made.querySelector(s); return e ? { disabled:!!e.disabled, title:e.getAttribute('title')||'' } : null; };
      return { email:b('#wa-c-email'), wa:b('#wa-c-wa'), copy:b('#wa-c-copy'),
               facts:[...made.querySelectorAll('.wa-fact')].map(f=>f.innerText.replace(/\\s+/g,' ').trim()) };
    })()`);
    t('Email is disabled with no address', bare.email && bare.email.disabled === true, bare.email);
    t('...and says why', /email/i.test((bare.email||{}).title||''), (bare.email||{}).title);
    t('WhatsApp is disabled with no phone number', bare.wa && bare.wa.disabled === true);
    t('...and says why', /phone/i.test((bare.wa||{}).title||''));
    t('Copy link still works — the link exists regardless', bare.copy && bare.copy.disabled === false);
    t('missing facts read as Not recorded, never blank',
      bare.facts.every(f => f.split('\n').length > 1 || /\S/.test(f)) &&
      bare.facts.some(f => /Not recorded/.test(f)), bare.facts);

    /* ── 7. Geometry ────────────────────────────────────────────────────── */
    console.log('\n7. THE DIALOG FITS');
    const geo = await pg.evaluate(`(() => {
      wsCloseAddModal(); wsOpenAddModal();
      const m = document.querySelector('#ws-add-modal .ws-modal');
      const r = m.getBoundingClientRect();
      const g = document.querySelector('#ws-add-modal .wa-grid');
      return { w: Math.round(r.width),
               cols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
               overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    })()`);
    t('the dialog is 820px on a desktop', geo.w === 820, geo.w);
    t('the form runs in two columns', geo.cols === 2, geo.cols);
    t('nothing overflows the page', geo.overflow <= 0, geo.overflow);
    t('no page errors during the whole flow', errs.length === 0, errs.slice(0, 3));
    await ctx.close();

    /* The two-column form survives to 700px, which a tablet clears and a phone
       does not. 768 is therefore expected to stay in two columns; the check
       there is that it fits, not that it collapses. */
    for (const vp of [{ width:768, height:1024, cols:2 }, { width:390, height:844, cols:1 }]) {
      const s = await openDash(b, vp);
      const g = await s.pg.evaluate(`(() => {
        wsOpenAddModal();
        const m = document.querySelector('#ws-add-modal .ws-modal');
        const gr = document.querySelector('#ws-add-modal .wa-grid');
        return { w: Math.round(m.getBoundingClientRect().width),
                 cols: getComputedStyle(gr).gridTemplateColumns.split(' ').length,
                 overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      t('at ' + vp.width + ' the dialog fits the viewport', g.w <= vp.width, g);
      t('at ' + vp.width + ' the form runs in ' + vp.cols + ' column(s)', g.cols === vp.cols, g.cols);
      t('at ' + vp.width + ' nothing overflows', g.overflow <= 0, g.overflow);
      await s.ctx.close();
    }
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
