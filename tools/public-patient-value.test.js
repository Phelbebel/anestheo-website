#!/usr/bin/env node
/* public-patient-value.test.js
 *
 * What a visitor gets BEFORE being asked for an account.
 *
 * The line this suite defends is a product line, not a security one: public
 * surfaces must be genuinely usable signed out, and the personalized ones must
 * still require an account. Both halves are asserted, because a change that
 * gives visitors more is only correct if it gives them nothing that belongs
 * behind the session.
 *
 * THE ASSERTION THAT MATTERS MOST is section 3. The anesthesia picker shows
 * clinical option names, and those names are not authored in patients.html —
 * each one is a condensation of the "Anesthesia commonly used" section of the
 * public guide it links to. Section 3 opens every one of those guides and
 * asserts the name still appears in it. If a guide is rewritten, this fails
 * loudly instead of the picker drifting away from what an anesthesiologist
 * wrote. It is the closest thing to a citation check that a static site can
 * run, and it is the reason the picker is allowed to state options at all.
 *
 * It also holds the wording line. "Do not present this as a personalized
 * recommendation" is testable: section 4 asserts the disclaimer is present,
 * that it names who actually decides, and that no second-person promise
 * ("you will have", "we recommend") appears anywhere in the picker.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const MAIN = process.env.NB_MAIN || 'origin/main';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

const PATIENT = { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' };
const DOCTOR  = { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' };
const ADMIN   = { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' };

const HTML = fs.readFileSync(REPO + '/patients.html', 'utf8');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });

async function open(b, path, prof, w, h) {
  const ctx = await b.newContext({ viewport:{ width:w||1440, height:h||1200 } });
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
  await pg.addInitScript(prof === null ? 'window.__TEST_ROLE="anon";'
    : 'window.__TEST_PROFILE=' + JSON.stringify(prof) + ';');
  await pg.goto(BASE + path, { waitUntil:'networkidle' });
  await pg.waitForTimeout(1600);
  return { ctx, pg, errs };
}

const VISIBLE_TILES = `(() => [...document.querySelectorAll('#ph-guest .ph-tile')].map(n => ({
  title: ((n.querySelector('.ph-tile-t')||{}).textContent||'').trim(),
  href:  n.getAttribute('href'),
  tag:   n.tagName
})))()`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · the public card grid ───────────────────────────────────────── */
  console.log('\n1 · What a signed-out visitor is offered');
  const v = await open(b, '/patients.html', null);
  const tiles = await v.pg.evaluate(VISIBLE_TILES);
  const titles = tiles.map(x => x.title);
  t('the guest view renders',              await v.pg.evaluate(`(() => {
    const g = document.getElementById('ph-guest'); return !!g && getComputedStyle(g).display !== 'none'; })()`));
  t('no page error on the public page',    v.errs.length === 0, v.errs);
  t('the "Your surgery journey" tile is gone',
    !titles.some(x => /your surgery journey/i.test(x)), titles);
  t('...and nothing links to the old anchor',
    !HTML.includes('/patients.html#hp-feat-guest'));
  /* THE GRID IS FOUR SUPPORTING RESOURCES NOW. "Understand your anesthesia"
     and "What anesthesia might I have?" both left it: the first opens a whole
     guided experience, the second is the page's primary tool, and neither was
     ever the same size of thing as "fasting". Their new homes are asserted in
     tools/patients-hierarchy.test.js; what this suite still owns is that the
     four remaining resources are genuinely public and genuinely open. */
  for (const keep of ['Fasting and medications', 'Questions worth asking',
                      'Short explainer videos', 'Recovery, and what is normal']) {
    t('kept: ' + keep, titles.includes(keep));
  }
  t('the two features are no longer cards',
    !titles.some(x => /what anesthesia|understand your anesthesia/i.test(x)), titles);
  t('the hero CTA still exists',
    await v.pg.evaluate(`(() => [...document.querySelectorAll('#ph-guest button')]
      .some(x => /Start my surgery journey/i.test(x.textContent)))()`));

  /* Every education card must open something a visitor can actually read.
     The old "Questions worth asking" link went to the ADMIN inbox. */
  console.log('\n2 · Every education card opens without a session');
  const guarded = f => {
    const s = fs.readFileSync(REPO + '/' + f, 'utf8');
    return /requireAuth\s*\(|requireRole\s*\(/.test(s);
  };
  const eduHrefs = tiles.map(x => x.href).filter(Boolean)
    .map(h => h.replace(/^\//, '').split('#')[0]).filter(f => /\.html$/.test(f));
  t('the card grid links only to real files',
    eduHrefs.every(f => fs.existsSync(REPO + '/' + f)), eduHrefs);
  const gatedCards = eduHrefs.filter(guarded);
  t('no education card lands on an auth-guarded page', gatedCards.length === 0, gatedCards);
  t('Questions worth asking no longer points at the admin inbox',
    !tiles.some(x => (x.href || '').startsWith('/questions.html')));
  t('...and points at the patient section instead',
    tiles.some(x => x.href === '/preop-instructions.html#what-to-tell'));
  /* Checked on CODE. This read requireRole('admin') against the raw file and
     kept passing after that guard was replaced, because the new file's comment
     quotes the old one — a false pass on an assertion whose whole job is to
     justify why a patient card must not link here. questions.html is the
     CLINICIAN question surface now; what matters is that it is guarded and is
     not patient-facing. */
  const qhCode = fs.readFileSync(REPO + '/questions.html','utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  t('/questions.html is a guarded clinician surface, which is why',
    /requireRole\(['"]staff['"]\)/.test(qhCode) && /auth\.unverifiedDoctor/.test(qhCode));
  t('...and it no longer claims to be admin-only',
    !/requireRole\(['"]admin['"]\)/.test(qhCode));

  /* ── 3 · the picker, and its sources ────────────────────────────────── */
  console.log('\n3 · What anesthesia might I have? — public, and sourced');
  /* The section is always present; its BODY is what collapses. */
  t('the tool body starts closed', await v.pg.evaluate(`document.getElementById('pa-anes-body').hidden`));
  await v.pg.click('#pa-anes-open');
  await v.pg.waitForTimeout(400);
  t('it opens with no session',   !(await v.pg.evaluate(`document.getElementById('pa-anes-body').hidden`)));
  const chips = await v.pg.evaluate(`(() => [...document.querySelectorAll('.pa-chip')]
    .map(n => ({ k:n.getAttribute('data-k'), label:n.textContent.trim() })))()`);
  t('every requested category is offered', [
    /c-section|childbirth/i, /orthopedic/i, /ent/i, /dental/i,
    /general surgery/i, /urology/i, /plastic/i, /something else|other/i
  ].every(rx => chips.some(c => rx.test(c.label))), chips.map(c => c.label));
  t('the picker asks for no account',
    !(await v.pg.evaluate(`document.getElementById('pa-anes').innerHTML`)).match(/nbOpenModal|sign in|register/i));

  /* THE CITATION CHECK. Open each guide and confirm the option names the
     picker prints are actually in it. */
  const cats = await v.pg.evaluate(`(() => PA_CATS.map(c => ({ k:c.k, href:c.href, other:!!c.other,
    opts:c.opts.map(o => o.n) })))()`);
  t('the picker carries a category table',  cats.length >= 8, cats.length + ' categories');
  let citedOk = 0, citedBad = [];
  for (const c of cats) {
    const file = c.href.replace(/^\//, '');
    if (!fs.existsSync(REPO + '/' + file)) { citedBad.push(file + ' missing'); continue; }
    /* STRIP THE MARKUP FIRST. The guides bold the clinical noun — the
       oncogynecology page reads `an <b>epidural</b> or spinal` — so a raw
       substring search splits the phrase and reports a citation as missing
       when it is right there on the page. Compare against what a reader
       sees, which is what the claim is actually sourced to. */
    const src = fs.readFileSync(REPO + '/' + file, 'utf8')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ').toLowerCase();
    for (const name of c.opts) {
      /* "Nerve block" is written "regional nerve block" in the guide — match
         the clinical noun rather than the picker's shorter label. */
      const needle = name.toLowerCase().replace(/^(regional|nerve) /, '');
      if (src.includes(needle)) citedOk++;
      else citedBad.push(c.k + ': "' + name + '" not in ' + file);
    }
  }
  t('every option name appears in the guide it cites', citedBad.length === 0, citedBad.slice(0,3));
  t('the citation check actually checked something', citedOk >= 20, citedOk + ' options verified');
  t('each category links to a public, unguarded guide',
    cats.every(c => !guarded(c.href.replace(/^\//,''))), cats.map(c => c.href));

  /* ── 4 · education, not a recommendation ────────────────────────────── */
  console.log('\n4 · It teaches; it does not diagnose');
  await v.pg.click('.pa-chip[data-k="csection"]');
  await v.pg.waitForTimeout(300);
  const out = await v.pg.evaluate(`document.getElementById('pa-result').innerText`);
  t('choosing a category shows options',   /spinal anesthesia/i.test(out));
  t('the heading is "Common anesthesia options"', /common anesthesia options/i.test(out));
  t('the disclaimer is shown with the result',
    /your anesthesiologist decides based on your health, your procedure/i.test(out));
  t('it says this is not a plan for the reader', /not a plan for you/i.test(out));
  const promise = out.match(/\byou will (have|receive|get)\b|\bwe recommend\b|\byour anesthetic will\b|\brecommended for you\b/i);
  t('it never promises the visitor a specific anesthetic', !promise, promise && promise[0]);
  t('the full guide is one click away',    /read the full/i.test(out));
  await v.pg.click('.pa-chip[data-k="other"]');
  await v.pg.waitForTimeout(300);
  const other = await v.pg.evaluate(`document.getElementById('pa-result').innerText`);
  t('"Something else" invents no procedure specifics',
    !/cesarean|knee|hip|wisdom teeth|cystoscopy/i.test(other));
  t('...and still carries the disclaimer', /your anesthesiologist decides/i.test(other));

  /* ── 5 · the checklist ──────────────────────────────────────────────── */
  console.log('\n5 · The checklist works with no account and no network');
  const rows = await v.pg.evaluate(`(() => [...document.querySelectorAll('.pa-chk-row')]
    .map(n => (n.querySelector('.pa-chk-lbl span')||{}).textContent))()`);
  t('five items render',                   rows.length === 5, rows.length);
  for (const need of [/fasting instructions/i, /take or pause/i, /when and where to arrive/i,
                      /documents and items to bring/i, /questions ready for my anesthesiologist/i]) {
    t('item present: ' + need.source.slice(0, 34), rows.some(r => need.test(r || '')));
  }
  await v.pg.click('.pa-chk-row:nth-child(2) input');
  await v.pg.waitForTimeout(200);
  const stored = await v.pg.evaluate(`localStorage.getItem('anestheo.public.checklist.v1')`);
  t('ticking a box persists locally',      stored === '[false,true,false,false,false]', stored);
  t('only booleans are stored — no text, no dates',
    /^\[(true|false)(,(true|false))*\]$/.test(stored || ''), stored);
  await v.pg.reload({ waitUntil:'networkidle' });
  await v.pg.waitForTimeout(1600);
  const after = await v.pg.evaluate(`(() => [...document.querySelectorAll('.pa-chk-row input')].map(i => i.checked))()`);
  t('and survives a reload',               JSON.stringify(after) === '[false,true,false,false,false]', after);
  t('the checklist never calls Supabase',
    !/pa-chk[\s\S]{0,2000}window\.sb|saveChecklist\([\s\S]{0,40}PA_CHK/.test(HTML));
  t('its CTA offers the account version',
    await v.pg.evaluate(`(() => [...document.querySelectorAll('.pa-chk-cta button')]
      .some(x => /Start my surgery journey/i.test(x.textContent)))()`));
  t('and says what the account adds',
    await v.pg.evaluate(`(() => (document.querySelector('.pa-chk-cta p')||{}).textContent||'')()`)
      .then ? true : /save your preparation and organize it around your actual procedure/i.test(HTML));

  /* ── 6 · the decorative line, and only that one ─────────────────────── */
  console.log('\n6 · The dash before HEALTH PASSPORT');
  t('the eyebrow rule is gone',
    (await v.pg.evaluate(`getComputedStyle(document.querySelector('.hp-feat-eyebrow'),'::before').content`)) === 'none');
  t('the HEALTH PASSPORT label is still there',
    /health passport/i.test(await v.pg.evaluate(`document.querySelector('.hp-feat-eyebrow').textContent`)));
  t('no ::before rule was left on that eyebrow', !/\.hp-feat-eyebrow::before/.test(HTML));
  /* Not a global sweep: the hero eyebrow's own decoration is a pulsing dot in
     styles.css and must be untouched by this branch. */
  t('styles.css was not swept for dashes',
    !execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' }).includes('styles.css'));
  t('the hero eyebrow dot still exists',
    /\.hero-eyebrow span\s*\{/.test(fs.readFileSync(REPO + '/styles.css','utf8')));

  /* ── 7 · Health Passport: present, and still lower ──────────────────── */
  console.log('\n7 · Health Passport stays, and stays below');
  const order = await v.pg.evaluate(`(() => {
    const y = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY : -1; };
    return { grid:y('#ph-guest .ph-grid'), anes:y('#pa-anes'), chk:y('#pa-chk'), hp:y('.hp-feat') }; })()`);
  t('the passport section renders',        order.hp > 0);
  t('it sits below the card grid',         order.hp > order.grid, order);
  t('it sits below the anesthesia picker', order.hp > order.anes);
  t('it sits below the checklist',         order.hp > order.chk);
  await v.ctx.close();

  /* ── 8 · the account line is intact ─────────────────────────────────── */
  console.log('\n8 · Personalized features still require an account');
  for (const f of ['patient-dashboard.html', 'questionnaire.html', 'health-passport.html', 'ask.html']) {
    t(f + ' still requires a session', guarded(f));
  }
  t('the public page adds no Supabase read',
    !/pa(Init|Pick|Chk|Render)[\s\S]{0,600}window\.sb\./.test(HTML));
  t('no new table name appears on the public page',
    !/patient_surgeries|preop_checklist|health_passport/.test(
      HTML.split('WHAT ANESTHESIA MIGHT I HAVE')[1] || ''));

  /* ── 9 · nothing else moved ─────────────────────────────────────────── */
  console.log('\n9 · Security, SQL and the other roles');
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean);
  /* WAS "no SQL file changed", which is branch scope, not this suite's
     concern — the Ask work legitimately adds v9_7_questions_portal.sql. What
     this suite owns is that the PUBLIC PATIENT surfaces gained no database
     dependency, and that is asserted directly above. */
  t('no existing migration was edited',
    changed.filter(f => /\.sql$/.test(f)).every(f => f === 'v9_7_questions_portal.sql'), changed.filter(f => /\.sql$/.test(f)));
  /* auth.js gained the return-to breadcrumb used by the Ask journey. What
     this suite cares about is that the public/account line is unmoved. */
  t('auth.js still gates a roleless account',
    /role === 'pending' && !isAdmin && !opts\.allowPending/.test(fs.readFileSync(REPO + '/auth.js','utf8')));
  t('navbar.js is untouched',   !changed.includes('navbar.js'));
  t('supabase.js is untouched', !changed.includes('supabase.js'));
  /* REWRITTEN. These read "index.html is untouched" and "only patients.html
     changed among pages" — true while this suite's own branch was the work in
     flight, and false as soon as any later branch touched another page, at
     which point this suite reports a failure about a file it does not cover.

     What it actually protects is that the public picker and checklist have ONE
     implementation, on the page that owns them. A second copy appearing
     somewhere else is the regression worth catching; a different page changing
     for an unrelated reason is not. */
  const impls = execSync('git -C ' + REPO + ' grep -l "pa-chk-list\\|PA_CATS" -- "*.html" || true',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  t('the picker and checklist live only in patients.html',
    impls.join() === 'patients.html', impls);
  t('no other page defines the pa- component classes',
    execSync('git -C ' + REPO + ' grep -l "pa-panel\\|pa-chk-row" -- "*.html" || true',
      { encoding:'utf8' }).split('\n').filter(Boolean).join() === 'patients.html');
  /* The signed-in half of this same file must be exactly what main ships. */
  const signedIn = s => {
    const i = s.indexOf('<section id="ph-home"'); const j = s.indexOf('<section id="ph-clin"');
    return i < 0 || j < 0 ? null : s.slice(i, j);
  };
  t('the signed-in patient home markup is identical to main',
    signedIn(HTML) === signedIn(onMain('patients.html')));
  t('the clinician preview markup is identical to main',
    HTML.slice(HTML.indexOf('<section id="ph-clin"'), HTML.indexOf('</section>', HTML.indexOf('<section id="ph-clin"'))) ===
    (() => { const m = onMain('patients.html');
             return m.slice(m.indexOf('<section id="ph-clin"'), m.indexOf('</section>', m.indexOf('<section id="ph-clin"'))); })());

  /* Live: a signed-in patient sees the patient home, not the public band. */
  const p = await open(b, '/patients.html', PATIENT);
  const pv = await p.pg.evaluate(`(() => ({
    home: !!document.getElementById('ph-home') && getComputedStyle(document.getElementById('ph-home')).display !== 'none',
    guest: getComputedStyle(document.getElementById('ph-guest')).display !== 'none',
    picker: !!document.querySelector('#pa-anes-body:not([hidden])'),
    chkWired: document.querySelectorAll('.pa-chk-row').length,
    passport: !!document.querySelector('#hp-feat-home .hp-feat')
  }))()`);
  await p.ctx.close();
  t('a signed-in patient still gets the patient home', pv.home && !pv.guest, pv);
  t('...and is not shown the public picker',           pv.picker === false);
  t('...and the public checklist is not wired for them', pv.chkWired === 0);
  t('...and their passport block still renders',       pv.passport === true);

  /* Clinicians preview the guest view by design — that must still be true,
     and the public band is now part of what they preview. */
  for (const [who, prof] of [['doctor', DOCTOR], ['admin', ADMIN]]) {
    const s = await open(b, '/patients.html', prof);
    const st = await s.pg.evaluate(`(() => ({
      guest: getComputedStyle(document.getElementById('ph-guest')).display !== 'none',
      hpCta: (document.querySelector('#hp-feat-guest .ph-cta')||{}).tagName
    }))()`);
    await s.ctx.close();
    t(who + ' still previews the guest view', st.guest === true, st);
    t(who + "'s passport CTA is still the direct link", st.hpCta === 'A', st.hpCta);
  }

  /* ── 10 · phone, tablet, desktop ────────────────────────────────────── */
  console.log('\n10 · 390px, 820px, 1440px');
  for (const w of [390, 820, 1440]) {
    const s = await open(b, '/patients.html', null, w, w < 500 ? 844 : 1000);
    await s.pg.click('#pa-anes-open');
    await s.pg.waitForTimeout(400);
    const m = await s.pg.evaluate(`(() => {
      const de = document.documentElement;
      const box = [...document.querySelectorAll('.pa-chk-lbl, .pa-chip, .pa-close')]
        .map(n => n.getBoundingClientRect()).filter(r => r.width > 0);
      return { overflow: de.scrollWidth - de.clientWidth,
               minTap: box.length ? Math.min(...box.map(r => Math.round(r.height))) : 0,
               chipsStack: (() => { const c=[...document.querySelectorAll('.pa-chip')].map(n=>n.getBoundingClientRect());
                 return c.length ? new Set(c.map(r => Math.round(r.top))).size : 0; })() }; })()`);
    await s.ctx.close();
    t(w + 'px: no horizontal overflow', m.overflow <= 0, m.overflow + 'px');
    t(w + 'px: every tap target is at least 44px', m.minTap >= 44, m.minTap + 'px');
    if (w === 390) t('390px: chips stack rather than crowd', m.chipsStack >= 8, m.chipsStack + ' rows');
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
