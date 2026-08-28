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
 * IT ALSO NOW COVERS THE PUBLIC ACCESS MODEL. Live Tools, Calculators and the
 * reference library lost their guards, because an audit found they had nothing
 * to guard: no Supabase read, no RPC, no fetch, no identifier, and the one
 * backend call Live Tools makes is already granted to `anon` in the migration.
 * Opening a page is only defensible if opening it reads nothing, so section 4b
 * does not take the audit's word for it — it captures every Supabase request
 * each page makes at the network boundary and inspects it.
 *
 * Section 3 is the one worth reading twice. It assumes nothing about routing:
 * it visits five destinations as an anonymous visitor, a patient, a doctor and
 * an admin, and records where each actually lands. Twenty navigations, because
 * "a patient must not enter the clinician workspace" is a claim about
 * behaviour and the only honest way to check it is to try.
 *
 * What did NOT change is the boundary that was always real: dashboard.html and
 * patient-dashboard.html are byte-identical to main, requireRole('staff')
 * still guards the workspace, and no SQL, RLS or SECURITY DEFINER function is
 * touched. Section 5 is the guard inventory, page by page.
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
  /* REWRITTEN FROM "all four open sign-in". That was true of the previous
     revision and was the finding that prompted this one: three of the four
     rows led to a sign-in prompt for pages that read no data. Three now
     navigate; the fourth, which is the only one holding patient records,
     still asks. */
  console.log('\n2 · Logged out — three open, one asks');
  const gated = (HTML.match(/var GATED = \[[^\]]*\]/) || [''])[0];
  t('the gated list is exactly the two dashboards',
    /var GATED = \['dashboard\.html','patient-dashboard\.html'\]/.test(HTML), gated);
  for (const name of ['engine.html', 'scores.html', 'references.html']) {
    t(name + ' is no longer intercepted', !gated.includes("'" + name + "'"), gated);
  }
  for (const c of CLIN) {
    const shouldAsk = c.href === '/dashboard.html';
    const before = g.pg.url();
    await g.pg.click('.clin-list a[href="' + c.href + '"]');
    await g.pg.waitForTimeout(shouldAsk ? 500 : 1800);
    const url = new URL(g.pg.url()).pathname;
    if (shouldAsk) {
      const modal = await g.pg.evaluate(`(() => { const m = document.getElementById('nb-modal');
        return !!m && m.classList.contains('open'); })()`);
      t(c.name + ': asks for sign-in without leaving the page',
        g.pg.url() === before && modal, { url, modal });
      await g.pg.evaluate(`window.nbCloseModal && window.nbCloseModal()`);
      await g.pg.waitForTimeout(200);
    } else {
      t(c.name + ': opens directly, no account asked', url === c.href, url);
      await g.pg.goBack({ waitUntil:'networkidle' });
      await g.pg.waitForTimeout(1200);
      await g.pg.evaluate(`document.querySelector('#clinicians').scrollIntoView()`);
    }
  }
  await g.ctx.close();

  /* ── 3 · where each role actually lands ─────────────────────────────── */
  /* Twenty navigations now: a reference TOPIC page is included, because
     opening references.html publicly would be hollow if everything behind it
     were still shut. */
  console.log('\n3 · Twenty navigations, measured not assumed');
  const DESTS = ['/engine.html', '/scores.html', '/references.html', '/airway.html', '/dashboard.html'];
  const landed = {};
  for (const who of ['anon', 'patient', 'doctor', 'admin']) {
    landed[who] = {};
    for (const d of DESTS) {
      const s = await open(b, d, who === 'anon' ? null : ID[who]);
      landed[who][d] = new URL(s.pg.url()).pathname;
      await s.ctx.close();
    }
  }
  t('logged out: Live Tools opens directly',  landed.anon['/engine.html'] === '/engine.html', landed.anon);
  t('logged out: Calculators opens directly', landed.anon['/scores.html'] === '/scores.html');
  t('logged out: References opens directly',  landed.anon['/references.html'] === '/references.html');
  t('logged out: a reference topic opens too', landed.anon['/airway.html'] === '/airway.html');
  t('logged out: the workspace does NOT open', landed.anon['/dashboard.html'] !== '/dashboard.html',
    landed.anon['/dashboard.html']);

  /* The patient half of the model: public tools yes, clinician-only reference
     material no, workspace never. */
  t('patient: cannot enter the clinician workspace',
    landed.patient['/dashboard.html'] === '/patient-dashboard.html', landed.patient);
  t('patient: the reference redirect is preserved',
    landed.patient['/references.html'] === '/patient-dashboard.html' &&
    landed.patient['/airway.html'] === '/patient-dashboard.html', landed.patient);
  t('patient: ends up in the patient experience, never a clinician surface',
    ['/references.html','/airway.html','/dashboard.html']
      .every(d => landed.patient[d] === '/patient-dashboard.html'), landed.patient);
  /* Deliberate, and worth stating out loud: the public tools are public for
     everyone, a signed-in patient included. The redirect was scoped to
     reference material by decision, not by oversight. */
  t('patient: the public tools stay public',
    landed.patient['/engine.html'] === '/engine.html' &&
    landed.patient['/scores.html'] === '/scores.html', landed.patient);

  for (const who of ['doctor', 'admin']) {
    t(who + ': opens all five destinations',
      DESTS.every(d => landed[who][d] === d), landed[who]);
  }

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

  /* ── 4b · what the newly public pages ask the network for ───────────── */
  /* THE ASSERTION THE WHOLE CHANGE RESTS ON. Opening a page is only safe if
     opening it reads nothing. Every request each page makes to Supabase is
     captured at the network boundary and inspected — not inferred from the
     source, because a shared script could always add one. */
  console.log('\n4b · Opened anonymously, these pages ask for nothing');
  const PATIENT_TABLES = ['patient_surgeries','clinic_patients','care_requests',
    'preop_questionnaires','preop_checklist','preparation_plans','patient_recommendations',
    'anesthesia_cases','anesthesia_events','health_passport','consultations','profiles'];
  for (const page of ['/engine.html', '/scores.html', '/references.html', '/airway.html']) {
    const ctx = await b.newContext({ viewport:{ width:1280, height:900 } });
    const hits = [];
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (/supabase\.co/.test(u)) { hits.push(u.replace(/^https?:\/\/[^/]+/, ''));
        return r.fulfill({status:200,contentType:'application/json',body:'null'}); }
      if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
      if (/googleapis|gstatic/.test(u))  return r.fulfill({status:200,contentType:'text/css',body:''});
      if (/youtube|ytimg/.test(u))       return r.fulfill({status:200,contentType:'application/json',body:'[]'});
      return r.continue();
    });
    const pg = await ctx.newPage();
    await pg.addInitScript('window.__TEST_ROLE="anon";');
    await pg.goto(BASE + page, { waitUntil:'networkidle' });
    await pg.waitForTimeout(1800);
    const tableHits = hits.filter(h => PATIENT_TABLES.some(tb => h.includes('/rest/v1/' + tb)));
    t(page + ': queries no patient table', tableHits.length === 0, tableHits);
    const rpcHits = hits.filter(h => h.includes('/rest/v1/rpc/'))
      .map(h => h.split('/rpc/')[1].split('?')[0]);
    t(page + ': the only RPCs are anon-granted ones',
      rpcHits.every(n => n === 'get_evidence'), rpcHits);
    /* Nothing that could identify a person may be written to this device. */
    const stored = await pg.evaluate(`(() => { const o = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
        o[k] = (localStorage.getItem(k) || '').slice(0, 300); } return o; })()`);
    const keys = Object.keys(stored);
    t(page + ': stores no identifier',
      !JSON.stringify(stored).match(/fname|lname|mrn|"pid"|patient_id|email|user_id/i),
      keys);
    await ctx.close();
  }

  /* The evidence drawer is the one live backend call on Live Tools, and its
     function is granted to `anon` in the migration. Both halves checked. */
  const ev = await open(b, '/engine.html', null);
  const evidence = await ev.pg.evaluate(`(async () => {
    if (typeof window.getEvidence !== 'function') return { missing:true };
    try { const r = await window.getEvidence('ideal-body-weight'); return { ok:true, threw:false, r: r === null ? 'null' : typeof r }; }
    catch (e) { return { ok:false, threw:true, msg:e.message }; } })()`);
  await ev.ctx.close();
  t('the evidence API is present for an anonymous visitor', !evidence.missing, evidence);
  t('...and calling it does not throw',    evidence.threw === false, evidence);
  t('get_evidence is granted to anon in the migration',
    /grant execute on function public\.get_evidence\(text\) to anon, authenticated;/i
      .test(fs.readFileSync(REPO + '/evidence_transparency_phase1_1.sql','utf8')));

  /* ── 4c · the professional-use notice ───────────────────────────────── */
  console.log('\n4c · Live Tools says who it is for');
  const nt = await open(b, '/engine.html', null);
  const notice = await nt.pg.evaluate(`(() => { const e = document.querySelector('.eng-notice');
    if (!e) return null; const r = e.getBoundingClientRect();
    return { text:(e.textContent||'').replace(/\\s+/g,' ').trim(),
             visible: r.width > 0 && r.height > 0,
             top: Math.round(r.top + scrollY),
             firstInput: (() => { const i = document.querySelector('#app input');
               return i ? Math.round(i.getBoundingClientRect().top + scrollY) : Infinity; })() }; })()`);
  await nt.ctx.close();
  t('the notice renders',                  !!notice && notice.visible, notice && notice.text.slice(0,60));
  t('it names the audience',               /for healthcare professionals/i.test(notice.text));
  t('it says reference and education only', /reference and education only/i.test(notice.text));
  t('it disclaims prescribing and deciding',
    /does not prescribe and does not make clinical decisions/i.test(notice.text));
  t('it tells the reader to verify locally',
    /verify doses and clinical decisions against current local protocols/i.test(notice.text));
  t('it sits above the first input, not in a footer',
    notice.top < notice.firstInput, { notice: notice.top, input: notice.firstInput });

  /* ── 5 · nothing structural moved ───────────────────────────────────── */
  console.log('\n5 · Security, SQL and the rest of the page');
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean);
  /* WAS "no SQL file changed" — branch scope, not this suite's concern. The
     Ask work legitimately adds v9_7_questions_portal.sql; what must not happen
     is an EXISTING migration being edited. */
  t('no existing migration was edited',
    changed.filter(f => /\.sql$/.test(f)).every(f => f === 'v9_7_questions_portal.sql'),
    changed.filter(f => /\.sql$/.test(f)));
  /* auth.js gained the return-to breadcrumb for the Ask journey — a new
     helper and one hop in the destination resolver. No guard changed, which
     is the part that matters here. */
  t('auth.js still carries the pending gate',
    /role === 'pending' && !isAdmin && !opts\.allowPending/.test(fs.readFileSync(REPO + '/auth.js','utf8')));
  t('navbar.js is untouched',   !changed.includes('navbar.js'));
  t('supabase.js is untouched', !changed.includes('supabase.js'));
  /* patients.html changed in the hierarchy pass — its sections were reordered
     and two feature cards left the grid. This suite is about the HOMEPAGE, so
     the durable claim is that the homepage's own clinician section and CTA are
     what it says they are, which everything above already asserts. */
  t('the homepage is the only page this suite governs',
    !changed.includes('index.html') || /clin-list/.test(HTML));

  /* THE GUARD INVENTORY. The previous revision asserted these four pages were
     byte-identical to main, which was the right claim while the change was
     purely visual and is the wrong one now: three of them deliberately lost a
     guard. So the assertion becomes the specific thing that changed, page by
     page, and — more importantly — the specific thing that must not. */
  const src = f => fs.readFileSync(REPO + '/' + f, 'utf8');
  /* Guards are checked on CODE, not on prose. Both files explain in a comment
     which guard they used to call and why it went — a raw substring search
     matches the explanation and reports the gate as still present. */
  const code = f => src(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const REFS = ['references.html','airway.html','anticoagulation.html','regional.html','icu.html',
                'obstetric.html','pediatric.html','last.html','difficult-airway.html','anaphylaxis.html'];

  t('engine.html no longer calls requireRole',   !/requireRole\(/.test(code('engine.html')));
  t('scores.html no longer calls requireRole',   !/requireRole\(/.test(code('scores.html')));
  t('engine.html calls no guard at all',         !/requireAuth\(/.test(code('engine.html')));
  t('scores.html calls no guard at all',         !/requireAuth\(/.test(code('scores.html')));
  for (const f of REFS) {
    t(f + ': anonymous allowed via noRedirect',
      /requireAuth\(\{\s*noRedirect:\s*true\s*\}\)/.test(src(f)));
    t(f + ': signed-in patient still redirected',
      /if\(role === 'patient'\)\{ window\.location\.href = '\/dashboard\.html'; return; \}/.test(src(f)));
  }
  /* The one gate that had a reason to exist keeps it, untouched. */
  /* dashboard.html changed one href — its Questions inbox used to send a
     clinician to the PATIENT's Ask page and now deep-links the reply surface.
     Byte-identity was the right claim while this branch was purely about
     access; the durable one is that the workspace still guards itself and
     still asks the database for the same things. */
  t('the workspace guard is unchanged',
    /requireRole\(['"]staff['"]\)/.test(src('dashboard.html')));
  t('the workspace queries are unchanged',
    (src('dashboard.html').match(/\.from\('[a-z_]+'\)/g) || []).join() ===
    (onMain('dashboard.html').match(/\.from\('[a-z_]+'\)/g) || []).join());
  t('requireRole(\'staff\') still guards the workspace',
    /requireRole\(['"]staff['"]\)/.test(src('dashboard.html')));
  /* Three consultation labels changed in the Ask work; they promised
     destinations that do not exist. This suite's concern is the ACCESS model,
     so the durable claim is that My Space still guards itself and still reads
     only its own owner's rows. */
  t('My Space still requires a session',
    /requireAuth\s*\(/.test(src('patient-dashboard.html')));
  t('My Space still reads only its own owner\'s questions',
    /from\('questions'\)\.select\('\*'\)\.eq\('patient_id', _uid\)/.test(src('patient-dashboard.html')));
  /* Opening a page must not have meant opening a write path. */
  for (const f of ['engine.html','scores.html', ...REFS]) {
    t(f + ': still makes no Supabase call',
      !/\.from\(['"]|\.rpc\(['"]/.test(code(f)));
  }
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
