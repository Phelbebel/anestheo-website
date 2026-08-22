#!/usr/bin/env node
/* public-clinician-and-cta.test.js
 *
 * Two things on the public homepage: the For Clinicians section, and the
 * "Going for surgery?" block at the foot of the page.
 *
 * THE RULE THIS SUITE ENFORCES is that nothing may look clickable and do
 * nothing. The four For Clinicians rows already had a hover state — a
 * background and a border lit up under the cursor — and were plain <li>. That
 * is a promise the page could not keep, and section 1 is written so it cannot
 * come back: every row must contain an anchor, every anchor must point at a
 * file that exists, and any row that lights up on hover must be a link.
 *
 * Section 3 is the one worth reading twice. It does not assume how the four
 * destinations route; it signs in as a patient, a doctor and an admin, opens
 * all four, and records where each actually lands. Twelve navigations, because
 * "a patient must not enter the clinician workspace" is a claim about
 * behaviour and the only honest way to check it is to try.
 *
 * None of that routing is new. This branch adds no guard, changes no guard,
 * and touches no SQL — section 5 asserts that too.
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
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};

const ID = {
  patient: { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' },
  doctor:  { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' },
  admin:   { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' }
};

const HTML = fs.readFileSync(REPO + '/index.html', 'utf8');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });

/* The four destinations, as audited. Written here so the test states the
   expectation rather than reading it back out of the page it is testing. */
const CLIN = [
  { name:'Live Tools',          href:'/engine.html' },
  { name:'Calculators',         href:'/scores.html' },
  { name:'References',          href:'/references.html' },
  { name:'Clinician workspace', href:'/dashboard.html' }
];

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
  await pg.goto(BASE + path, { waitUntil:'networkidle' }).catch(() => {});
  await pg.waitForTimeout(1600);
  return { ctx, pg, errs };
}

/* WCAG ratio for one solid pair — used on the CTA, whose whole point is that
   the ink changed when the teal got brighter. */
function ratio(fg, bg) {
  const px = s => s.match(/\d+/g).map(Number);
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
    return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]); };
  const a = lum(px(fg)), c = lum(px(bg));
  return +(((Math.max(a,c) + .05) / (Math.min(a,c) + .05)).toFixed(2));
}

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · nothing looks clickable and does nothing ───────────────────── */
  console.log('\n1 · For Clinicians — four claims, four destinations');
  const g = await open(b, '/index.html', null);
  t('no page error', g.errs.length === 0, g.errs);
  const rows = await g.pg.evaluate(`(() => [...document.querySelectorAll('.clin-list li')].map(li => {
    const a = li.querySelector(':scope > a');
    const r = li.getBoundingClientRect();
    return { name:((li.querySelector('b')||{}).textContent||'').replace(/\\s*→\\s*$/,'').trim(),
             href: a ? a.getAttribute('href') : null,
             linkH: a ? Math.round(a.getBoundingClientRect().height) : 0,
             liPad: getComputedStyle(li).padding,
             aPad:  a ? getComputedStyle(a).padding : null,
             visible: r.width > 0 && r.height > 0 }; }))()`);
  t('four rows render',                    rows.length === 4, rows.length);
  t('every row is visible',                rows.every(r => r.visible));
  t('every row contains a link',           rows.every(r => r.href), rows.map(r => r.name + '=' + r.href));
  for (const want of CLIN) {
    const got = rows.find(r => r.name === want.name);
    t(want.name + ' → ' + want.href, !!got && got.href === want.href, got && got.href);
    t('...and ' + want.href + ' exists', fs.existsSync(REPO + '/' + want.href.replace(/^\//,'')));
  }
  t('the whole row is the hit area, not just the words',
    rows.every(r => r.liPad === '0px' && r.aPad === '16px 18px'), rows[0]);
  t('every link clears the 44px tap target',
    rows.every(r => r.linkH >= 44), rows.map(r => r.linkH));
  /* The defect in one assertion: a row that lights up under the cursor and
     is not a link. */
  t('no row has a hover affordance without a destination',
    rows.every(r => !!r.href),
    rows.filter(r => !r.href).map(r => r.name));
  t('the section CTA still opens Live Tools',
    await g.pg.evaluate(`(() => [...document.querySelectorAll('#clinicians a')]
      .some(a => /Open Live Tools/i.test(a.textContent) && a.getAttribute('href') === '/engine.html'))()`));

  /* ── 2 · logged out asks for a sign-in, it does not bounce ──────────── */
  console.log('\n2 · Logged out → sign-in, not a round trip');
  t('the gated list covers all four destinations',
    CLIN.every(c => new RegExp("GATED = \\[[^\\]]*" + c.href.replace(/^\//,'').replace('.', '\\.')).test(HTML)),
    (HTML.match(/var GATED = \[[^\]]*\]/) || [''])[0]);
  for (const c of CLIN) {
    const before = g.pg.url();
    await g.pg.click('.clin-list a[href="' + c.href + '"]');
    await g.pg.waitForTimeout(500);
    const stayed = g.pg.url() === before;
    const modal = await g.pg.evaluate(`(() => { const m = document.getElementById('nb-modal');
      return !!m && m.classList.contains('open'); })()`);
    t(c.name + ': stays on the page and opens sign-in', stayed && modal, { stayed, modal });
    await g.pg.evaluate(`window.nbCloseModal && window.nbCloseModal()`);
    await g.pg.waitForTimeout(200);
  }
  await g.ctx.close();

  /* ── 3 · where each role actually lands ─────────────────────────────── */
  console.log('\n3 · Twelve navigations, measured not assumed');
  const landed = {};
  for (const who of ['patient', 'doctor', 'admin']) {
    landed[who] = {};
    for (const c of CLIN) {
      const s = await open(b, c.href, ID[who]);
      landed[who][c.href] = new URL(s.pg.url()).pathname;
      await s.ctx.close();
    }
  }
  t('a patient is turned away from every clinician destination',
    CLIN.every(c => landed.patient[c.href] !== c.href), landed.patient);
  t('...and lands in their own space, never the workspace',
    CLIN.every(c => landed.patient[c.href] === '/patient-dashboard.html'), landed.patient);
  t('a doctor opens Live Tools',            landed.doctor['/engine.html'] === '/engine.html');
  t('a doctor opens Calculators',           landed.doctor['/scores.html'] === '/scores.html');
  t('a doctor opens References',            landed.doctor['/references.html'] === '/references.html');
  t('a doctor opens the workspace',         landed.doctor['/dashboard.html'] === '/dashboard.html');
  t('an admin opens all four',
    CLIN.every(c => landed.admin[c.href] === c.href), landed.admin);

  /* ── 4 · the "Going for surgery?" block ─────────────────────────────── */
  console.log('\n4 · Going for surgery? — graphite, one teal');
  const v = await open(b, '/index.html', null);
  const cta = await v.pg.evaluate(`(() => {
    const fin = document.querySelector('.final-in'), btn = document.querySelector('.final-in .btn-teal');
    const cs = getComputedStyle(fin), bs = getComputedStyle(btn);
    return { bg:cs.backgroundColor, img:cs.backgroundImage, border:cs.borderTopColor,
             btnText:btn.textContent.trim(), btnBg:bs.backgroundColor, btnImg:bs.backgroundImage,
             btnInk:bs.color, btnH:Math.round(btn.getBoundingClientRect().height),
             heroText:(document.querySelector('.hero a.btn-teal')||{}).textContent,
             heroHref:(document.querySelector('.hero a.btn-teal')||{}).getAttribute
               ? document.querySelector('.hero a.btn-teal').getAttribute('href') : null,
             href:btn.getAttribute('href') }; })()`);
  t('the block is a graphite card, not a teal slab',
    cta.bg === 'rgba(255, 255, 255, 0.035)', cta.bg);
  t('no gradient is painted behind it',    cta.img === 'none', cta.img);
  t('its border is the cool hairline',     cta.border === 'rgba(255, 255, 255, 0.09)', cta.border);
  t('no green remains in the block',
    !/27,\s*107,\s*90|1B6B5A|47,\s*168,\s*140/.test(cta.bg + cta.img + cta.border), [cta.bg, cta.border]);
  t('the CTA is one flat teal',            cta.btnBg === 'rgb(47, 168, 140)' && cta.btnImg === 'none',
    [cta.btnBg, cta.btnImg]);
  t('its ink is dark, not white',          cta.btnInk === 'rgb(6, 18, 28)', cta.btnInk);
  const cr = ratio(cta.btnInk, cta.btnBg);
  t('and that pairing clears WCAG AA',     cr >= 4.5, cr + ':1');
  t('the CTA still goes to /patients.html', cta.href === '/patients.html', cta.href);
  t('it is a comfortable tap target',      cta.btnH >= 44, cta.btnH + 'px');
  t('its wording matches the hero button for the same page',
    cta.btnText === (cta.heroText || '').trim() && cta.heroHref === cta.href,
    [cta.btnText, cta.heroText, cta.heroHref]);
  /* Checked on the RENDERED page, not on the source. The comment above the
     CTA quotes the old label to explain why it changed, and a source-level
     match would fail on the explanation rather than on the button. */
  t('no button on the page still says "Start preparation"',
    await v.pg.evaluate(`(() => [...document.querySelectorAll('a.btn, button')]
      .filter(n => n.getBoundingClientRect().height > 0)
      .every(n => n.textContent.trim() !== 'Start preparation'))()`));
  t('the heading is unchanged',
    /Going for surgery\? Start preparing now\./.test(HTML));

  /* ── 5 · nothing structural moved ───────────────────────────────────── */
  console.log('\n5 · Security, SQL and the rest of the page');
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean);
  t('no SQL file changed',      changed.filter(f => /\.sql$/.test(f)).length === 0, changed);
  t('auth.js is untouched',     !changed.includes('auth.js'));
  t('navbar.js is untouched',   !changed.includes('navbar.js'));
  t('supabase.js is untouched', !changed.includes('supabase.js'));
  t('patients.html is untouched', !changed.includes('patients.html'));
  t('only index.html changed among pages',
    changed.filter(f => /\.html$/.test(f)).every(f => f === 'index.html'), changed);
  /* No guard on any destination page was edited to make a link work. */
  for (const f of ['engine.html','scores.html','references.html','dashboard.html']) {
    t(f + ' is byte-identical to main',
      fs.readFileSync(REPO + '/' + f, 'utf8') === onMain(f));
  }
  t('requireRole is still what guards the workspace',
    /requireRole\(['"]staff['"]\)/.test(fs.readFileSync(REPO + '/dashboard.html','utf8')));
  /* The signed-in homes are built by JS this branch did not touch. */
  const fn = (src, name, end) => {
    const i = src.indexOf(name); if (i < 0) return null;
    const j = src.indexOf(end, i); return j < 0 ? null : src.slice(i, j);
  };
  const MAIN_HTML = onMain('index.html');
  t('buildDoctor() is identical to main',
    fn(HTML,'function buildDoctor','function buildPatient') === fn(MAIN_HTML,'function buildDoctor','function buildPatient'));
  t('buildPatient() is identical to main',
    fn(HTML,'function buildPatient','async function renderAppHome') === fn(MAIN_HTML,'function buildPatient','async function renderAppHome'));
  t('renderAppHome() is identical to main',
    fn(HTML,'async function renderAppHome','if(typeof getSession') === fn(MAIN_HTML,'async function renderAppHome','if(typeof getSession'));
  t('the scoped role palettes are untouched',
    (HTML.match(/html\.(doctor|patient)-home[^{]*\{/g) || []).length ===
    (MAIN_HTML.match(/html\.(doctor|patient)-home[^{]*\{/g) || []).length);

  /* Live: the signed-in homes still render and are not the public markup. */
  for (const who of ['doctor', 'patient']) {
    const s = await open(b, '/index.html', ID[who]);
    const st = await s.pg.evaluate(`(() => ({
      cls: document.documentElement.className,
      publicHidden: getComputedStyle(document.querySelector('main#main')).display === 'none',
      ah: !!document.querySelector('#ah .ah-wrap, #ah .pt-hero, #ah .ah-hero') }))()`);
    await s.ctx.close();
    t(who + ' still gets the application home', st.ah === true, st);
    t(who + ' never sees the public clinician section', st.publicHidden === true);
  }

  /* ── 6 · phone, tablet, desktop ─────────────────────────────────────── */
  console.log('\n6 · 390px, 820px, 1440px');
  for (const w of [390, 820, 1440]) {
    const s = await open(b, '/index.html', null, w, w < 500 ? 844 : 1000);
    const m = await s.pg.evaluate(`(() => {
      const de = document.documentElement;
      const links = [...document.querySelectorAll('.clin-list li > a')].map(a => a.getBoundingClientRect());
      const btn = document.querySelector('.final-in .btn-teal').getBoundingClientRect();
      return { overflow: de.scrollWidth - de.clientWidth,
               minLink: links.length ? Math.min(...links.map(r => Math.round(r.height))) : 0,
               btnH: Math.round(btn.height),
               stacked: new Set(links.map(r => Math.round(r.top))).size }; })()`);
    await s.ctx.close();
    t(w + 'px: no horizontal overflow',   m.overflow <= 0, m.overflow + 'px');
    t(w + 'px: clinician rows stay tappable', m.minLink >= 44, m.minLink + 'px');
    t(w + 'px: the CTA stays tappable',    m.btnH >= 44, m.btnH + 'px');
    t(w + 'px: the four rows stack',       m.stacked === 4, m.stacked + ' rows');
  }
  await v.ctx.close();

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
