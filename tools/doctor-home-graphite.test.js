#!/usr/bin/env node
/* doctor-home-graphite.test.js
 *
 * The authenticated doctor index home — the "Good afternoon, Dr. …" screen
 * that renderAppHome() builds into #ah — moved from the first-generation
 * green-black ground onto the graphite the rest of the product already uses.
 *
 * WHAT THIS FILE IS GUARDING AGAINST
 * ----------------------------------
 * #ah is ONE element. buildDoctor() and buildPatient() render into the same
 * div, so anything written on `.ah` repaints both roles at once — which is
 * exactly the mistake this suite exists to catch. Every rule the change adds
 * is scoped under `html.doctor-home`, and sections 2 and 3 below prove it two
 * different ways: by reading the stylesheet, and by measuring what a patient's
 * browser actually computes.
 *
 * It also holds the line on scope. This is a VISUAL change: no auth, no
 * routing, no queries, no SQL. Section 5 diffs this branch against main and
 * asserts that the only thing that moved is presentation — same builders,
 * same isDoc test, same links, same destinations.
 *
 * Contrast is measured, not asserted from taste: section 4 walks every text
 * node that actually paints, composites the alpha stack down to an opaque
 * colour, and computes real WCAG ratios.
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
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(66) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(66) + ' ' + fmt(d)); }
};

const ID = {
  patient:  { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' },
  doctor:   { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' },
  pendingDr:{ email:'d@e.com',  role:'doctor',  verification_status:'pending',      is_admin:false, full_name:'Dana Levi' },
  admin:    { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' }
};

const HTML = fs.readFileSync(REPO + '/index.html', 'utf8');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });
const MAIN_HTML = onMain('index.html');

/* ── browser plumbing ──────────────────────────────────────────────────── */
async function open(b, prof, path, w, h) {
  const ctx = await b.newContext({ viewport:{ width:w||1440, height:h||1200 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u))  return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(prof) + ';');
  await pg.goto(BASE + (path || '/index.html'), { waitUntil:'networkidle' });
  await pg.waitForTimeout(1700);
  return { ctx, pg };
}

/* What a role's browser actually computes for the home surface. The grid is
   read off background-image because that is how it is drawn — a repeating
   linear-gradient — and a rule that merely stops SETTING it is not proof that
   nothing paints it. */
const SKIN = `(() => {
  const ah = document.querySelector('.ah'); if (!ah) return { none:true };
  const c = getComputedStyle(ah), v = n => c.getPropertyValue(n).trim();
  return {
    cls:  document.documentElement.className,
    bg:   c.backgroundColor,
    grid: /linear-gradient\\(90deg,\\s*rgba\\(255,\\s*255,\\s*255/.test(c.backgroundImage||''),
    font: c.fontFamily.split(',')[0].replace(/["']/g,''),
    vars: { bd:v('--bd'), tx:v('--tx'), mu:v('--mu'), hi:v('--hi'),
            tl:v('--tl'), tl2:v('--tl2'), ac:v('--ac') }
  };
})()`;

/* Every anchor the home renders, as destination + label. Two roles' worth of
   these compared across branches is what "links unchanged" has to mean. */
const LINKS = `(() => [...document.querySelectorAll('#ah a[href]')]
  .map(a => a.getAttribute('href') + ' :: ' + (a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40))
  .sort())()`;

/* WCAG, with the alpha stack composited onto the nearest opaque ancestor —
   without that every rgba() card reads as pure black and the numbers lie. */
const CONTRAST = `(() => {
  const px = s => (s.match(/[\\d.]+/g)||[]).map(Number);
  const lum = ([r,g,b]) => { const f = c => { c/=255; return c<=.03928 ? c/12.92 : Math.pow((c+.055)/1.055,2.4); };
    return .2126*f(r)+.7152*f(g)+.0722*f(b); };
  const over = (fg,bg) => { const a = fg.length>3 ? fg[3] : 1; return [0,1,2].map(i => fg[i]*a + bg[i]*(1-a)); };
  function bgOf(el){ let n=el, st=[];
    while (n && n.nodeType===1){ const b=px(getComputedStyle(n).backgroundColor);
      if (b.length){ const a=b.length>3?b[3]:1;
        if (a>=.999){ let o=[b[0],b[1],b[2]]; for(let i=st.length-1;i>=0;i--) o=over(st[i],o); return o; }
        if (a>0) st.push(b); }
      n=n.parentElement; }
    let o=[11,22,32]; for(let i=st.length-1;i>=0;i--) o=over(st[i],o); return o; }
  const out=[], ah=document.getElementById('ah'); if(!ah) return out;
  ah.querySelectorAll('*').forEach(el => {
    const tx=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim();
    if(!tx) return;
    const r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
    const c=getComputedStyle(el);
    if(c.display==='none'||c.visibility==='hidden'||+c.opacity===0) return;
    if(c.webkitTextFillColor==='rgba(0, 0, 0, 0)') return;
    const bg=bgOf(el), fg=over(px(c.color),bg);
    const L1=lum(fg), L2=lum(bg), ratio=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);
    const size=parseFloat(c.fontSize), large = size>=24 || (size>=18.66 && +c.fontWeight>=700);
    out.push({ t:tx.slice(0,40), cls:(el.className||'').toString().slice(0,30),
               ratio:+ratio.toFixed(2), need: large?3:4.5 });
  });
  return out;
})()`;

/* The pre-branch doctor skin, read off main rather than remembered. */
const MAIN_AH = (MAIN_HTML.match(/^\.ah\{--bd:[^\n]*\n[^\n]*\n[^\n]*$/m) || [''])[0];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · the doctor home is graphite ────────────────────────────────── */
  console.log('\n1 · The doctor index home renders on the graphite ground');
  const d = await open(b, ID.doctor);
  const dSkin = await d.pg.evaluate(SKIN);
  t('html carries doctor-home',            /\bdoctor-home\b/.test(dSkin.cls), dSkin.cls);
  t('ground is #0B1620 graphite',          dSkin.bg === 'rgb(11, 22, 32)', dSkin.bg);
  t('the 52px grid is gone',               dSkin.grid === false);
  t('type is Inter, not DM Sans',          dSkin.font === 'Inter', dSkin.font);
  t('heading ink is soft white #F2F6F8',   dSkin.vars.tx === '#F2F6F8', dSkin.vars.tx);
  t('secondary ink is cool gray #93A6B4',  dSkin.vars.mu === '#93A6B4', dSkin.vars.mu);
  t('faint ink is #6D8091',                dSkin.vars.hi === '#6D8091', dSkin.vars.hi);
  t('hairline is a cool white line',       dSkin.vars.bd === 'rgba(255,255,255,.09)', dSkin.vars.bd);
  t('teal is the brand mid #2FA88C',       dSkin.vars.tl === '#2FA88C', dSkin.vars.tl);
  t('teal reads as #7ECFC0 for text',      dSkin.vars.ac === '#7ECFC0', dSkin.vars.ac);
  t('no green remains in the .ah vars',
    !/1B6B5A|2A8A74|27,\s*107,\s*90/.test(JSON.stringify(dSkin.vars)), dSkin.vars.tl2);

  /* The greeting is gradient-clipped text. Overriding it with the `background`
     SHORTHAND resets background-clip and the doctor's name paints as a solid
     bar — it happened once during this change, so it is a test now. */
  const nm = await d.pg.evaluate(`(() => { const e=document.querySelector('.ah-greeting .nm');
    if(!e) return null; const c=getComputedStyle(e);
    return { clip:c.webkitBackgroundClip||c.backgroundClip, fill:c.webkitTextFillColor,
             img:/linear-gradient/.test(c.backgroundImage), txt:(e.textContent||'').trim() }; })()`);
  t('the doctor name still renders',       !!nm && nm.txt.length > 0, nm && nm.txt);
  t('its gradient is still clipped to text', !!nm && nm.clip === 'text', nm && nm.clip);
  t('its gradient image survived the override', !!nm && nm.img);
  const dLinks = await d.pg.evaluate(LINKS);
  const dContrast = await d.pg.evaluate(CONTRAST);
  await d.ctx.close();

  /* ── 2 · the patient home did not move ──────────────────────────────── */
  /* THESE ASSERTIONS WERE REWRITTEN, and the reason is not that the markup
     drifted. When this suite was first written, main's patient home was the
     original green-black and the honest test was "the patient is still on
     #0A1A15". claude/patient-experience-system then merged, and the patient
     home on main is graphite by its own decision, with its own scoped block.
     Asserting green here now would assert that a shipped, approved change had
     not shipped. What this section has to prove is unchanged: that the DOCTOR
     work does not reach the patient — so it compares against main, not against
     a remembered colour. */
  console.log('\n2 · The doctor work does not reach the patient home');
  const p = await open(b, ID.patient);
  const pSkin = await p.pg.evaluate(SKIN);
  await p.ctx.close();
  t('html carries patient-home',           /\bpatient-home\b/.test(pSkin.cls), pSkin.cls);
  t('html does NOT carry doctor-home',     !/\bdoctor-home\b/.test(pSkin.cls), pSkin.cls);
  t('the two classes are mutually exclusive',
    !(/\bpatient-home\b/.test(dSkin.cls)) && !(/\bdoctor-home\b/.test(pSkin.cls)));
  t('patient ground is the graphite main ships', pSkin.bg === 'rgb(11, 22, 32)', pSkin.bg);
  t('patient has no grid',                 pSkin.grid === false);
  t('patient type is Inter',               pSkin.font === 'Inter', pSkin.font);

  /* The patient block, byte for byte against main. This is the assertion that
     actually says "no accidental patient styling" — a live colour could match
     by coincidence, an identical rule cannot. */
  const patientBlock = s => {
    const i = s.indexOf('html.patient-home .ah{'); if (i < 0) return null;
    const j = s.indexOf('html.patient-home body', i); return j < 0 ? null : s.slice(i, s.indexOf('}', j) + 1);
  };
  t('the patient block exists',            patientBlock(HTML) !== null);
  t('the patient block is identical to main',
    patientBlock(HTML) === patientBlock(MAIN_HTML));
  t('this branch adds no rule scoped to patient-home',
    !/html\.doctor-home[^{]*patient-home|patient-home[^{]*html\.doctor-home/.test(HTML));

  /* Same ground and ink ramp — that agreement is the goal — but the doctor
     keeps a hover lift on the teal the patient home has no use for, so the two
     are provably still separate rulesets rather than one shared one. */
  t('patient and doctor share the ground',  pSkin.bg === dSkin.bg, pSkin.bg);
  t('patient and doctor share the ink ramp',
    pSkin.vars.tx === dSkin.vars.tx && pSkin.vars.mu === dSkin.vars.mu);
  t('but the hierarchies stay distinct',    pSkin.vars.tl2 !== dSkin.vars.tl2,
    pSkin.vars.tl2 + ' vs ' + dSkin.vars.tl2);

  /* ── 3 · the change is scoped in the stylesheet, not just at runtime ── */
  console.log('\n3 · Every added rule is scoped, and the base rule is untouched');
  t('the base .ah rule is byte-identical to main',
    MAIN_AH.length > 0 && HTML.includes(MAIN_AH));
  t('.ah still declares the green ground', /^\.ah\{[^}]*#0A1A15/m.test(HTML) || MAIN_AH.includes('#0A1A15'));

  /* Pull the block this change added and check every selector in it. */
  const added = HTML.split('THE DOCTOR HOME, MOVED ONTO THE GRAPHITE GROUND')[1] || '';
  const block = added.split('── Card sections')[0];
  t('the added block exists',              block.length > 400, block.length + ' chars');
  /* Strip comments first — the rationale above each rule is prose, and prose
     containing a "{" would otherwise be read as a selector. */
  const selectors = (block.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^@\s][^{]*\{/gm) || [])
    .map(s => s.replace(/\{$/,'').trim())
    .flatMap(s => s.split(',').map(x => x.trim()))
    .filter(Boolean);
  const unscoped = selectors.filter(s => !/^html\.doctor-home\b/.test(s));
  t('every added selector starts html.doctor-home', unscoped.length === 0, unscoped.slice(0,4));
  t('the added block touches many components',  selectors.length >= 30, selectors.length + ' selectors');
  t('no added rule targets a .pt- class outside the scope',
    !/(^|,)\s*\.pt-/m.test(block));

  /* No .pt-* rule anywhere in the file changed, scoped or not. */
  const ptRules = s => (s.match(/^\.pt-[^{]*\{[^}]*\}/gm) || []).join('\n');
  t('every .pt- rule is identical to main', ptRules(HTML) === ptRules(MAIN_HTML));
  const ahBase = s => (s.match(/^\.ah[-.][^{]*\{[^}]*\}/gm) || []).join('\n');
  t('every unscoped .ah- rule is identical to main', ahBase(HTML) === ahBase(MAIN_HTML));

  /* ── 4 · contrast is measured ───────────────────────────────────────── */
  console.log('\n4 · Readability, measured rather than asserted');
  const below = dContrast.filter(r => r.ratio < r.need);
  t('every painted text node meets WCAG AA', below.length === 0,
    below.slice(0,3).map(r => r.cls + ' ' + r.ratio + ':1'));
  t('the audit actually looked at the page', dContrast.length >= 40, dContrast.length + ' nodes');
  const worst = dContrast.slice().sort((a,c) => a.ratio - c.ratio)[0];
  t('the worst node still clears 4.5:1',   worst && worst.ratio >= 4.5,
    worst && worst.ratio + ':1 ' + worst.cls);

  /* The brighter teal is only safe because the ink on it went dark. White on
     #2FA88C is 3.0:1 — this is the assertion that stops it drifting back. */
  t('filled teal controls carry dark ink, not white',
    /html\.doctor-home \.ah-btn\.primary[\s\S]{0,220}color:var\(--dh-ink-on-teal\)/.test(block));
  t('that ink is the graphite on-accent #06121C', /--dh-ink-on-teal:#06121C/.test(block));

  /* ── 5 · nothing but presentation moved ─────────────────────────────── */
  console.log('\n5 · Behaviour, routing and security are untouched');
  /* Working tree against main, so this reads the same before and after the
     commit lands and cannot be satisfied by simply not having committed. */
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean);
  t('no SQL file changed',                 changed.filter(f => /\.sql$/.test(f)).length === 0, changed);
  t('navbar.js is not in the diff',        !changed.includes('navbar.js'));
  t('supabase.js is not in the diff',      !changed.includes('supabase.js'));

  /* auth.js IS in the diff: one stale comment that described the access model
     as it stood before v9_5 narrowed it. That is the whole change, and this is
     how it stays that way — strip every comment from both versions and the
     executable text has to be identical, character for character. */
  const decomment = src => {
    let out = '', i = 0, q = null;
    while (i < src.length) {
      const c = src[i], n = src[i+1];
      if (q) { out += c; if (c === '\\') { out += src[i+1] || ''; i += 2; continue; }
               if (c === q) q = null; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
      if (c === '/' && n === '*') { const e = src.indexOf('*/', i+2); i = e < 0 ? src.length : e+2; continue; }
      if (c === '/' && n === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
      out += c; i++;
    }
    return out.replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim();
  };
  const authNow = decomment(fs.readFileSync(REPO + '/auth.js','utf8'));
  const authMain = decomment(onMain('auth.js'));
  t('the comment stripper still sees real code', authNow.length > 4000, authNow.length + ' chars');
  /* WAS "comments only". That was true when this branch's whole auth.js
     change was one stale comment; the Ask work has since added the return-to
     breadcrumb, which is real code. What this suite protects is the doctor
     home, so the durable claim is narrower and sharper: nothing auth.js gained
     touches a guard, a role test, or the palette. */
  const authAdded = authNow.split('\n').filter(l => !authMain.includes(l.trim()) && l.trim());
  t('auth.js added no guard and no role test',
    !authAdded.some(l => /require(Role|Auth)|is_admin|role ===|verification_status/.test(l)),
    authAdded.filter(l => /require(Role|Auth)|role ===/.test(l)).slice(0,2));
  t('the pending gate is still there',
    /role === 'pending' && !isAdmin && !opts\.allowPending/.test(authNow));
  t('auth.js knows nothing about the doctor home',
    !/doctor-home|patient-home|--dh-/.test(authNow));
  t('the stale v9 claim is gone',
    !/v9_doctor_access_model\.sql, now deployed, removes those policies/.test(fs.readFileSync(REPO + '/auth.js','utf8')));
  t('the comment now names the v9_5 boundary',
    /v9_5_verification_boundary\.sql[\s\S]{0,200}RESTRICTIVE/.test(fs.readFileSync(REPO + '/auth.js','utf8')));
  /* REWRITTEN, because the original was scoped to one branch rather than to
     the thing it protects. It read "no page but index.html changed", which was
     true while this suite's own branch was the only work in flight and became
     false the moment any later branch touched a different page — reporting a
     failure about patients.html in a suite about the doctor home.

     What it has to guarantee is durable: the doctor index home lives in
     index.html, and no other page may grow a rule that reaches it. So every
     changed page except index.html must be free of the doctor-home class. */
  const otherPages = changed.filter(f => /\.html$/.test(f) && f !== 'index.html');
  const leaks = otherPages.filter(f => /doctor-home/.test(fs.readFileSync(REPO + '/' + f, 'utf8')));
  t('no other page defines or uses doctor-home', leaks.length === 0, leaks);
  t('the doctor home still lives only in index.html',
    execSync('git -C ' + REPO + ' grep -l "doctor-home" -- "*.html" || true', { encoding:'utf8' })
      .split('\n').filter(Boolean).join() === 'index.html');

  /* The builders and the role test are the behaviour. Compare the source. */
  const fn = (src, name, end) => {
    const i = src.indexOf(name); if (i < 0) return null;
    const j = src.indexOf(end, i); return j < 0 ? null : src.slice(i, j);
  };
  t('buildDoctor() is identical to main',
    fn(HTML,'function buildDoctor','function buildPatient') === fn(MAIN_HTML,'function buildDoctor','function buildPatient'));
  t('buildPatient() is identical to main',
    fn(HTML,'function buildPatient','async function renderAppHome') === fn(MAIN_HTML,'function buildPatient','async function renderAppHome'));
  t('the isDoc test is unchanged',
    /var isDoc = role==='doctor'\|\|role==='admin'\|\|\s*\(await window\.isPlatformAdmin\(\)\);/.test(HTML));
  t('the pending redirect is unchanged',
    /if\(!role \|\| role==='pending'\)\{ window\.location\.replace\('\/role-select\.html'\); return; \}/.test(HTML));
  t('doctor-home is set from isDoc and nothing else',
    /de\.classList\.toggle\('doctor-home', isDoc\);/.test(HTML));
  t('patient-home is still set from the same isDoc',
    /de\.classList\.toggle\('patient-home', !isDoc\);/.test(HTML));
  t('each class is toggled exactly once',
    (HTML.match(/classList\.toggle\('doctor-home'/g) || []).length === 1 &&
    (HTML.match(/classList\.toggle\('patient-home'/g) || []).length === 1);
  t('no other file mentions doctor-home',
    execSync('git -C ' + REPO + ' grep -l "doctor-home" -- . ":!tools" || true', { encoding:'utf8' })
      .split('\n').filter(Boolean).join() === 'index.html');

  /* Same destinations, same labels — a repaint may not quietly drop a link.
     buildDoctor() being byte-identical above is the real proof; this checks
     that the rendered result agrees, in case CSS hid something. */
  t('the doctor home still renders its full set of links', dLinks.length >= 15, dLinks.length + ' links');
  t('Live Workspace still points at the workspace',
    dLinks.some(l => /engine\.html|live|workspace/i.test(l)), dLinks.find(l => /Live Workspace/i.test(l)));
  /* Patient management on this page routes through dashboard.html — the
     Active Patients card, the Review Queue, Questions, and New patient all
     land there. There is no /patients.html link on the doctor home. */
  t('patient management is still reachable',
    dLinks.some(l => /^\/dashboard\.html :: .*Active Patients/.test(l)) &&
    dLinks.some(l => /^\/dashboard\.html :: .*New patient/.test(l)),
    dLinks.filter(l => l.startsWith('/dashboard.html')).length + ' dashboard links');
  t('clinical references are still linked',
    dLinks.filter(l => /airway|anticoag|icu|obstetric|pediatric|regional|last|anaphylaxis/i.test(l)).length >= 6);

  /* ── 6 · the other identities ───────────────────────────────────────── */
  console.log('\n6 · Administrators, unverified doctors, and the workspace');
  const a = await open(b, ID.admin);
  const aSkin = await a.pg.evaluate(SKIN);
  await a.ctx.close();
  /* An administrator has always rendered buildDoctor() into this same #ah, so
     they follow the doctor home rather than being a third look. */
  t('admin renders the doctor home',       /\bdoctor-home\b/.test(aSkin.cls), aSkin.cls);
  t('admin skin matches the doctor exactly',
    JSON.stringify(aSkin.vars) === JSON.stringify(dSkin.vars) && aSkin.bg === dSkin.bg);

  const u = await open(b, ID.pendingDr);
  const uSkin = await u.pg.evaluate(SKIN);
  const uVerify = await u.pg.evaluate(
    `(() => { const e=document.querySelector('.ah-verify'); return e ? (e.textContent||'').trim().slice(0,60) : null; })()`);
  await u.ctx.close();
  t('an unverified doctor gets the same ground', uSkin.bg === dSkin.bg, uSkin.bg);
  t('their verification notice still renders',   uVerify !== null, uVerify);

  /* NARROWED, for the third time and for the same reason each time: this read
     "dashboard.html and engine.html are identical to main", which is a claim
     about whole files rather than about the thing this suite owns. engine.html
     legitimately changed on a later branch — it lost a guard that protected no
     data — and this suite reported that as a doctor-home regression.

     What the doctor home actually needs from those two files is that its own
     repaint did not reach them. So: neither may carry the doctor-home class or
     the palette variables it defines, and the workspace keeps the guard that
     makes it the workspace. Whole-file identity is asserted where it belongs —
     public-clinician-and-cta.test.js pins dashboard.html byte for byte. */
  for (const f of ['dashboard.html', 'engine.html']) {
    const s = fs.readFileSync(REPO + '/' + f, 'utf8');
    t(f + ' does not carry the doctor-home class', !/doctor-home/.test(s));
    t(f + ' does not redefine the home palette',   !/--dh-wash|--dh-line|--dh-ink-on-teal/.test(s));
  }
  t('the workspace still guards itself',
    /requireRole\(['"]staff['"]\)/.test(fs.readFileSync(REPO + '/dashboard.html','utf8')));
  const w = await open(b, ID.doctor, '/dashboard.html');
  const wSkin = await w.pg.evaluate(
    `(() => { const c=getComputedStyle(document.body);
      return { bg:c.backgroundColor, cls:document.documentElement.className }; })()`);
  await w.ctx.close();
  t('the workspace still renders for a doctor', !!wSkin.bg, wSkin.bg);
  t('doctor-home does not leak onto the workspace', !/\bdoctor-home\b/.test(wSkin.cls), wSkin.cls);

  /* ── 7 · the phone ──────────────────────────────────────────────────── */
  console.log('\n7 · 390px');
  const m = await open(b, ID.doctor, '/index.html', 390, 844);
  const mob = await m.pg.evaluate(`(() => {
    const ah=document.querySelector('.ah'), c=getComputedStyle(ah);
    return { bg:c.backgroundColor, font:c.fontFamily.split(',')[0].replace(/["']/g,''),
             grid:/linear-gradient\\(90deg,\\s*rgba\\(255/.test(c.backgroundImage||''),
             overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             tabs: !!document.querySelector('.nb-mob, .nb-tabs, [class*="nb-mob"]'),
             greeting: (document.querySelector('.ah-greeting')||{}).textContent };
  })()`);
  await m.ctx.close();
  t('phone ground is graphite',            mob.bg === 'rgb(11, 22, 32)', mob.bg);
  t('phone type is Inter',                 mob.font === 'Inter', mob.font);
  t('no grid on the phone either',         mob.grid === false);
  t('no horizontal overflow at 390px',     mob.overflow <= 0, mob.overflow + 'px');
  t('the mobile tab bar still mounts',     mob.tabs === true);
  t('the greeting still renders on phone', !!mob.greeting && /Dana/.test(mob.greeting));

  /* The patient phone home, on the same build. A doctor-scoped block cannot
     reach it, but "cannot" is cheaper to assert than to assume. */
  const mp = await open(b, ID.patient, '/index.html', 390, 844);
  const mobP = await mp.pg.evaluate(`(() => {
    const ah=document.querySelector('.ah'), c=getComputedStyle(ah);
    return { cls:document.documentElement.className, bg:c.backgroundColor,
             font:c.fontFamily.split(',')[0].replace(/["']/g,''),
             grid:/linear-gradient\\(90deg,\\s*rgba\\(255/.test(c.backgroundImage||''),
             overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
             tabs: !!document.querySelector('.nb-mob, .nb-tabs, [class*="nb-mob"]') }; })()`);
  await mp.ctx.close();
  t('patient phone ground is graphite',    mobP.bg === 'rgb(11, 22, 32)', mobP.bg);
  t('patient phone type is Inter',         mobP.font === 'Inter', mobP.font);
  t('patient phone has no grid',           mobP.grid === false);
  t('no horizontal overflow for a patient at 390px', mobP.overflow <= 0, mobP.overflow + 'px');
  t('patient phone tab bar mounts',        mobP.tabs === true);
  t('patient phone is not styled as a doctor', !/\bdoctor-home\b/.test(mobP.cls), mobP.cls);

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
