#!/usr/bin/env node
/* patient-experience.test.js
 *
 * The patient side, held to one design system and one vocabulary.
 *
 * WHAT WAS WRONG, MEASURED BEFORE THE CHANGE
 * ------------------------------------------
 * index.html renders two design generations depending on who is looking. Its
 * public half was repainted onto graphite; its signed-in half was deliberately
 * left behind (the scoping comment at index.html says so in as many words), so
 * a patient who signed in landed on:
 *
 *     body       #0A1A15   green-black, plus a 52px repeating grid
 *     headings   #14181A   near-black text ON that ground
 *     eyebrows   #1B6B5A   deep brand green as body text
 *
 * The second and third are contrast failures, not preferences.
 *
 * And patient-dashboard.html greeted an account that had done nothing with
 * FOUR "add surgery" buttons in four vocabularies, plus three zeros.
 *
 * WHAT THIS FILE HOLDS. Colour is asserted from getComputedStyle, not from the
 * source: this page declares a palette it does not use, so reading the file
 * would confirm the wrong thing. Counts are asserted from rendered text.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};

const PATIENT  = { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' };
const DOCTOR   = { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' };
const UNVERDOC = { email:'d@e.com',  role:'doctor',  verification_status:'pending',      is_admin:false, full_name:'Dana Levi' };
const ADMIN    = { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' };

/* The graphite ground the rest of the product renders. Measured, not declared. */
const GROUND = 'rgb(11, 22, 32)';   // #0B1620
const INK    = 'rgb(242, 246, 248)';// #F2F6F8

async function open(b, path, profile, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{ width: opts.width || 1440, height: opts.height || 1400 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u)) return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,130)); });
  await pg.addInitScript(profile === null
    ? 'window.__TEST_ROLE="anon";'
    : 'window.__TEST_PROFILE=' + JSON.stringify(profile) + ';');
  if (opts.quest) await pg.addInitScript('window.__TEST_QUEST=' + JSON.stringify(opts.quest) + ';');
  try { await pg.goto(BASE + path, { waitUntil:'networkidle' }); } catch(e){}
  await pg.waitForTimeout(opts.wait || 1600);
  return { ctx, pg, errs };
}

/* Everything visual this file cares about, read from the rendered page. */
const probe = pg => pg.evaluate(() => {
  const vis = n => { const r = n.getBoundingClientRect();
                     return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
  const body = getComputedStyle(document.body);
  const ah   = document.querySelector('.ah');
  const grids = [...document.querySelectorAll('*')].filter(n => {
    const c = getComputedStyle(n);
    return /linear-gradient\(90deg|repeating-linear/.test(c.backgroundImage || '') &&
           /\d+px \d+px/.test(c.backgroundSize || '');
  }).length;
  const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
  // Visible em dashes only: a text node inside a laid-out element.
  const dashes = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) {
    if (n.textContent.includes('—') && n.parentElement && vis(n.parentElement))
      dashes.push(n.textContent.replace(/\s+/g,' ').trim().slice(0,60));
  }
  return {
    url: location.pathname,
    bodyBg: body.backgroundColor, bodyInk: body.color,
    ahBg: ah ? getComputedStyle(ah).backgroundColor : null,
    ahFont: ah ? getComputedStyle(ah).fontFamily.split(',')[0].replace(/["']/g,'') : null,
    headColors: [...document.querySelectorAll('.ah h1, .ah h2, .ah-hello, .ah-sec-t, .ah-lab')]
                  .filter(vis).slice(0,6).map(x => getComputedStyle(x).color),
    grids,
    addCtas: [...document.querySelectorAll('button, a')].filter(vis)
               .map(x => x.textContent.replace(/\s+/g,' ').trim())
               .filter(s => /\badd\b|start my/i.test(s) && s.length < 44),
    zeros: (txt.match(/\b0\b/g) || []).length,
    dashes: [...new Set(dashes)],
    txt: txt,                 // full text: assertions read this
    preview: txt.slice(0, 110),// short: what the log line shows
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    tiles: [...document.querySelectorAll('.ph-tile')].filter(vis).length
  };
});

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1 · THE SIGNED-IN PATIENT HOME IS ON THE PRODUCT'S GROUND ───────────
  console.log('\n── 1 · authenticated patient home: one design system ──');
  {
    const { ctx, pg, errs } = await open(b, '/index.html', PATIENT);
    const s = await probe(pg);
    t('the app home paints the graphite ground', s.ahBg === GROUND, s.ahBg);
    t('...body agrees with it', s.bodyBg === GROUND, s.bodyBg);
    t('...no 52px grid anywhere on the page', s.grids === 0, s.grids);
    t('...type is the product typeface, not DM Sans', s.ahFont === 'Inter', s.ahFont);
    /* The contrast bug: #14181A near-black and #1B6B5A deep green were being
       used as text on a dark ground. Neither may reappear. */
    t('...no near-black heading text (#14181A)',
      !s.headColors.includes('rgb(20, 24, 26)'), s.headColors);
    t('...no deep-green body text (#1B6B5A)',
      !s.headColors.includes('rgb(27, 107, 90)'), s.headColors);
    /* Soft white #F2F6F8, muted #93A6B4, faint #6D8091 and the lifted accent
       #2FA88C are all legitimate here. Pure #FFF is not: the brief asks for a
       soft white rather than a glaring one, and several .ah rules hardcoded
       it past the variable. */
    t('...headings use the palette, and never pure white',
      s.headColors.every(c => ['rgb(242, 246, 248)','rgb(147, 166, 180)',
                               'rgb(109, 128, 145)','rgb(47, 168, 140)'].indexOf(c) >= 0),
      s.headColors);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 2 · THE PUBLIC HOMEPAGE IS UNTOUCHED ───────────────────────────────
  console.log('\n── 2 · the public homepage did not move ──');
  {
    const { ctx, pg, errs } = await open(b, '/index.html', null);
    const s = await probe(pg);
    t('visitor still gets the graphite ground', s.bodyBg === GROUND, s.bodyBg);
    t('...and the token ink', s.bodyInk === INK, s.bodyInk);
    t('...with no grid', s.grids === 0, s.grids);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 3 · ONE PRIMARY ACTION, AND NO ZEROS ───────────────────────────────
  console.log('\n── 3 · patient with no journey ──');
  {
    const { ctx, pg, errs } = await open(b, '/patient-dashboard.html', PATIENT);
    const s = await probe(pg);
    /* Four buttons in four vocabularies is what this replaces. One primary
       plus one subordinate section link is the target; more than two, or any
       second vocabulary, is the regression. */
    t('at most one primary CTA plus one section link', s.addCtas.length <= 2, s.addCtas);
    t('...all in ONE vocabulary ("procedure")',
      s.addCtas.every(c => /procedure/i.test(c)), s.addCtas);
    t('...none of the retired wordings survive',
      !s.addCtas.some(c => /add (my |your )?surgery|^add surgery$/i.test(c)), s.addCtas);
    /* A zero is a claim, and nothing had been counted. */
    t('NO zero counters for an account with no data', s.zeros === 0, s.zeros);
    t('...replaced by an empty state that explains',
      /No upcoming procedure yet/i.test(s.txt), s.preview);
    t('...which is human, not database language',
      !/no active surgery journey/i.test(s.txt));
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 3b · THE INDEX APP HOME, WHICH THE DASHBOARD SWEEP MISSED ──────────
  /* Caught by a screenshot, not by the source grep: index.html's own journey
     panel carried "You have no active surgery journey" and a FIFTH CTA
     wording. A row count read aloud is not an empty state. */
  console.log('\n── 3b · the index app home journey panel ──');
  {
    const { ctx, pg, errs } = await open(b, '/index.html', PATIENT);
    const s = await probe(pg);
    t('no database language on the patient home',
      !/no active surgery journey/i.test(s.txt), s.preview);
    t('...the empty state explains instead',
      /No upcoming procedure yet/i.test(s.txt));
    t('...and every CTA speaks one vocabulary',
      s.addCtas.every(c => /procedure|surgery journey/i.test(c)), s.addCtas);
    t('...with no "Start new surgery journey" competing wording',
      !/Start new surgery journey/i.test(s.txt), s.addCtas);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 4 · QUESTIONNAIRE WORDING, AGAINST THE REAL STATES ─────────────────
  /* The five in the CHECK constraint on preop_questionnaires.review_state
     (v2_bridge_foundation_migration.sql:45). No state is invented here. */
  console.log('\n── 4 · questionnaire states ──');
  {
    const src = fs.readFileSync('/home/user/anestheo-website/patient-dashboard.html','utf8');
    t('copy names WHICH questionnaire', /Preoperative questionnaire/.test(src));
    t('...the vague "your questionnaire is complete" is gone from live copy',
      !/text:'Your questionnaire is complete/.test(src));
    t('...the submitted state is keyed on review_state, not status',
      /rs === 'pending'[\s\S]{0,160}Preoperative questionnaire submitted/.test(src));
    for (const st of ['not_submitted','pending','in_review','changes_requested','approved']) {
      t('...branches on the real state ' + st, new RegExp("'" + st + "'").test(src));
    }
    /* SCOPED TO review_state COMPARISONS. An earlier version searched the
       whole file and matched journeyStatus 'completed' and document-review
       'reviewed' — different enums entirely. The code reads review_state as
       `rs === '...'`, so that is what gets checked. */
    const REAL = ['not_submitted','pending','in_review','changes_requested','approved'];
    const compared = [...src.matchAll(/\brs\s*===\s*'([a-z_]+)'/g)].map(m => m[1]);
    const invented = [...new Set(compared)].filter(v => REAL.indexOf(v) < 0);
    t('...compares review_state against nothing outside the CHECK constraint',
      invented.length === 0, invented.length ? invented : compared);
  }

  // ── 5 · THE LOGGED-OUT PROPOSITION ─────────────────────────────────────
  console.log('\n── 5 · logged-out patient landing ──');
  {
    const { ctx, pg, errs } = await open(b, '/patients.html', null);
    const s = await probe(pg);
    t('the value band renders', s.tiles >= 6, s.tiles);
    t('...covering anesthesia, fasting, questions, videos, recovery, journey',
      ['anesthesia','Fasting','Questions','videos','Recovery','journey']
        .every(k => new RegExp(k, 'i').test(s.txt)), s.preview);
    const band = await pg.evaluate(() => {
      const l = [...document.querySelectorAll('.ph-qa-label')]
        .find(n => /How Anestheo helps/i.test(n.textContent));
      if (!l) return null;
      const r = l.getBoundingClientRect(), c = getComputedStyle(l);
      const hp = document.getElementById('hp-feat-guest');
      return { shown: r.height > 0 && c.visibility === 'visible',
               beforePassport: hp ? (l.compareDocumentPosition(hp) & Node.DOCUMENT_POSITION_FOLLOWING) > 0 : null };
    });
    t('...labelled and visible', band && band.shown, band);
    t('...and placed before the Health Passport, not after it alone',
      band && band.beforePassport === true, band);
    t('...and still offers the start CTA', /Start my surgery journey/i.test(s.txt));
    t('no horizontal scroll', !s.overflow);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }

  // ── 6 · VISIBLE EM DASHES ──────────────────────────────────────────────
  /* Only the decorative ones. Parenthetical dashes in clinical prose on
     preop-instructions ("Allergies — especially to medications…") are real
     punctuation and are deliberately kept, so this checks the patient's own
     surfaces rather than every page. */
  console.log('\n── 6 · decorative punctuation ──');
  for (const [path, who] of [['/index.html', PATIENT], ['/patient-dashboard.html', PATIENT],
                             ['/patients.html', null], ['/procedures.html', PATIENT]]) {
    const { ctx, pg } = await open(b, path, who);
    const s = await probe(pg);
    t(('no visible em dash on ' + path).padEnd(62), s.dashes.length === 0, s.dashes);
    await ctx.close();
  }

  // ── 7 · MOBILE ─────────────────────────────────────────────────────────
  console.log('\n── 7 · 390px ──');
  for (const [path, who, label] of [['/index.html', PATIENT, 'patient home'],
                                    ['/patient-dashboard.html', PATIENT, 'My Space'],
                                    ['/patients.html', null, 'logged-out']]) {
    const { ctx, pg, errs } = await open(b, path, who, { width:390, height:844 });
    const s = await probe(pg);
    t((label + ' has no horizontal scroll').padEnd(62), !s.overflow, s.url);
    t((label + ' keeps the graphite ground').padEnd(62),
      s.bodyBg === GROUND || s.ahBg === GROUND, s.bodyBg);
    t((label + ' renders without error').padEnd(62), errs.length === 0, errs);
    await ctx.close();
  }

  // ── 8 · THE OTHER ROLES DID NOT MOVE ───────────────────────────────────
  /* index.html's .ah is the doctor's home too, so this change reaches them.
     It must improve their contrast and change nothing else. */
  console.log('\n── 8 · doctor and admin ──');
  {
    const { ctx, pg, errs } = await open(b, '/index.html', DOCTOR);
    const s = await probe(pg);
    t('a doctor\'s index home is on the same ground', s.ahBg === GROUND, s.ahBg);
    t('...with no grid', s.grids === 0, s.grids);
    t('...and no near-black text', !s.headColors.includes('rgb(20, 24, 26)'), s.headColors);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }
  for (const [who, prof, path] of [['verified doctor', DOCTOR, '/dashboard.html'],
                                   ['unverified doctor', UNVERDOC, '/dashboard.html'],
                                   ['administrator', ADMIN, '/admin.html']]) {
    const { ctx, pg, errs } = await open(b, path, prof);
    const s = await probe(pg);
    t((who + ' still reaches ' + path).padEnd(62), s.url === path, s.url);
    t((who + ': no page error').padEnd(62), errs.length === 0, errs);
    await ctx.close();
  }
  {
    /* The one that matters most: the workspace boundary is untouched. */
    const { ctx, pg } = await open(b, '/dashboard.html', UNVERDOC);
    const s = await probe(pg);
    t('unverified doctor still gets the welcome panel, not patients',
      /Welcome to your clinician workspace/i.test(s.txt), s.preview);
    await ctx.close();
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
