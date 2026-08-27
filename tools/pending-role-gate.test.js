#!/usr/bin/env node
/* pending-role-gate.test.js
 *
 * An account with no role chosen must never end up inside the product.
 *
 * WHAT THIS IS GUARDING AGAINST, CONCRETELY
 * -----------------------------------------
 * handle_new_user() creates every account at role='pending'. The chooser was
 * only ever OFFERED: auth-callback.html routed to it correctly, and
 * index.html had one inline check. Nothing REQUIRED it. Measured before this
 * change, a Google sign-in with role='pending' loading each URL directly:
 *
 *     /index.html            → /role-select.html     (the one guarded page)
 *     /patient-dashboard.html  STAYED — "Good morning, …"
 *     /health-passport.html    STAYED
 *     /settings.html           STAYED
 *     /questionnaire.html      STAYED
 *     /patients.html           STAYED — "Welcome back"
 *     /dashboard.html        → /patient-dashboard.html → STAYED
 *
 * That last line is the sharp one: requireRole() denied the clinical page by
 * sending the caller to /patient-dashboard.html, which had no role check of
 * its own. The guard performed the bypass.
 *
 * And it was not cosmetic. Every patient-side RLS policy keys on ownership —
 * auth.uid() = patient_id — with no role predicate anywhere, so a 'pending'
 * account is a working patient as far as the database is concerned.
 *
 * The tests below hold the rule at the door for every entry point and every
 * protected page, and — just as importantly — prove the roles that ARE chosen
 * still land exactly where they did.
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

/* Identities, exactly as public.profiles would hold them. */
const NEW_GOOGLE   = { email:'new@gmail.com',  role:'pending', verification_status:'not_required', is_admin:false };
const NEW_FACEBOOK = { email:'new@fb.com',     role:'pending', verification_status:'not_required', is_admin:false };
const NEW_EMAIL    = { email:'new@mail.com',   role:'pending', verification_status:'not_required', is_admin:false };
const PATIENT      = { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' };
const DOCTOR_PEND  = { email:'d@e.com',  role:'doctor',  verification_status:'pending',  is_admin:false, full_name:'Dana Levi' };
const DOCTOR_OK    = { email:'d2@e.com', role:'doctor',  verification_status:'approved', is_admin:false, full_name:'Dana Levi' };
const ADMIN        = { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' };
const ADMIN_NOROLE = { email:'a2@e.com', role:'pending', verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' };

async function land(b, path, profile, identities) {
  const ctx = await b.newContext({ viewport:{ width:1440, height:900 } });
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
  let init = 'window.__TEST_PROFILE=' + JSON.stringify(profile) + ';';
  if (identities) init += 'window.__TEST_IDENTITIES=' + JSON.stringify(identities) + ';';
  if (profile === null) init = 'window.__TEST_ROLE="anon";';
  await pg.addInitScript(init);
  try { await pg.goto(BASE + path, { waitUntil:'networkidle' }); } catch(e) { /* report where it landed */ }
  await pg.waitForTimeout(1300);
  const s = await pg.evaluate(() => ({
    url: location.pathname,
    /* Trimmed for the log line. `probe` below reads the DOM instead, so an
       assertion never depends on where this happens to be cut. */
    text: (document.body.innerText || '').replace(/\s+/g,' ').trim().slice(0, 80),
    roleButtons: [...document.querySelectorAll('.role-opt .ro-name')].map(n => n.textContent.trim()),
    /* index.html swaps between the marketing hero and the signed-in home by
       class rather than by navigation, and the greeting sits below the fold of
       innerText's first line. The class is the fact; the text is a preview. */
    appMode: document.documentElement.classList.contains('app') ? 'app'
           : (document.documentElement.classList.contains('pre-app') ? 'pre-app' : 'public')
  }));
  await ctx.close();
  return { url: s.url, text: s.text, roleButtons: s.roleButtons, appMode: s.appMode, errs };
}

/* Everything a signed-in account can reach that is not the chooser itself.
   /videos.html and /patients.html are marketing pages and stay public; they
   are listed so the split is stated rather than assumed.

   /engine.html MOVED OUT OF THE CLINICAL AREA and into PUBLIC_AREA. It was
   listed here because it sat behind requireRole('staff'); that guard was
   removed after an audit found the page makes no Supabase read, no RPC and no
   fetch, stores no identifier, and that its one backend call — get_evidence —
   is already granted to `anon`. A page an anonymous visitor can open cannot
   also be a page that forces a roleless account to choose a role first: those
   are the same person, one sign-out apart.

   /ask.html MOVED THE SAME WAY, for a different reason. It reads no data
   either, but it can WRITE one: a question. So the split is between the two
   verbs rather than between two pages — a roleless account reads the FAQ like
   anybody else, and is sent to the chooser the moment it tries to send a
   question, which is the only moment a row with an owner could exist. Both
   halves are asserted at the end of this file, in a browser.

   The rule this suite exists for is untouched. A roleless account is still
   sent to the chooser by every surface that holds data, is still never
   delivered into the patient application by a clinical denial — the original
   bug — and still cannot own a row anywhere. What changed is that reading a
   public page is no longer treated as entering the product. */
const PATIENT_AREA = ['/patient-dashboard.html','/health-passport.html','/settings.html',
                      '/questionnaire.html'];
const CLINICAL_AREA = ['/dashboard.html','/anesthesia-cases.html',
                       '/questionnaires.html','/admin.html','/users.html'];
const PUBLIC_AREA   = ['/index.html','/patients.html','/videos.html',
                       '/engine.html','/scores.html','/references.html','/ask.html'];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1 · THE FIVE CASES, NAMED ───────────────────────────────────────────
  console.log('\n── the five required cases ──');
  {
    const r = await land(b, '/index.html', NEW_GOOGLE, [{provider:'google'}]);
    t('new Google user with pending role → role-select',
      r.url === '/role-select.html', r.url);
  }
  {
    const r = await land(b, '/patient-dashboard.html', NEW_GOOGLE, [{provider:'google'}]);
    t('pending user opening patient-dashboard → role-select',
      r.url === '/role-select.html', r.url);
  }
  {
    const r = await land(b, '/dashboard.html', NEW_GOOGLE, [{provider:'google'}]);
    t('pending user opening doctor dashboard → role-select',
      r.url === '/role-select.html', r.url);
    t('...and NOT via /patient-dashboard.html, the old deny target',
      r.url !== '/patient-dashboard.html', r.url);
  }
  {
    const r = await land(b, '/patient-dashboard.html', PATIENT);
    t('patient role → patient dashboard', r.url === '/patient-dashboard.html', r.url);
    t('...and the page really rendered', /welcome|good (morning|afternoon|evening)|space/i.test(r.text), r.text);
  }
  {
    const r = await land(b, '/dashboard.html', DOCTOR_OK);
    t('doctor role → doctor dashboard', r.url === '/dashboard.html', r.url);
    t('...and the page really rendered', r.text.length > 20, r.text);
  }

  // ── 2 · EVERY ENTRY POINT ───────────────────────────────────────────────
  console.log('\n── every signup path reaches the chooser, not the product ──');
  for (const [label, profile, ident] of [
    ['Google OAuth',   NEW_GOOGLE,   [{provider:'google'}]],
    ['Facebook OAuth', NEW_FACEBOOK, [{provider:'facebook'}]],
    ['Email signup',   NEW_EMAIL,    [{provider:'email'}]]
  ]) {
    const cb = await land(b, '/auth-callback.html', profile, ident);
    t(label + ': the callback routes to the chooser', cb.url === '/role-select.html', cb.url);
    const direct = await land(b, '/patient-dashboard.html', profile, ident);
    t(label + ': ...and so does landing straight on a product page',
      direct.url === '/role-select.html', direct.url);
  }

  // ── 3 · NO PROTECTED PAGE LETS A ROLELESS ACCOUNT IN ────────────────────
  console.log('\n── the whole patient area ──');
  for (const path of PATIENT_AREA) {
    const r = await land(b, path, NEW_GOOGLE, [{provider:'google'}]);
    t(path.padEnd(26) + '→ role-select', r.url === '/role-select.html', r.url);
  }
  console.log('\n── the whole clinical area ──');
  for (const path of CLINICAL_AREA) {
    const r = await land(b, path, NEW_GOOGLE, [{provider:'google'}]);
    t(path.padEnd(26) + '→ role-select', r.url === '/role-select.html', r.url);
  }

  // ── 3b · THE TWO PAGES THAT ARE BOTH PUBLIC AND NOT ─────────────────────
  /* /patients.html and /index.html serve a marketing page to a visitor and an
     application home to someone signed in, so neither can use requireAuth()
     without taking the public page away from everybody logged out. Each asks
     the question itself. Both directions are held here. */
  console.log('\n── the pages that are public to a visitor and an app to a user ──');
  for (const path of ['/index.html','/patients.html']) {
    const pend = await land(b, path, NEW_GOOGLE, [{provider:'google'}]);
    t(path.padEnd(18) + ' signed in, no role  → role-select', pend.url === '/role-select.html', pend.url);
    const out = await land(b, path, null);
    t(path.padEnd(18) + ' signed out          → stays public', out.url === path, out.url);
    const pat = await land(b, path, PATIENT);
    const rendered = path === '/index.html'
      ? pat.appMode === 'app'                       // homepage: the signed-in home is a class swap
      : /welcome|good (morning|afternoon|evening)/i.test(pat.text);
    t(path.padEnd(18) + ' patient             → stays, renders the home',
      pat.url === path && rendered, [pat.appMode, pat.text.slice(0,50)]);
  }

  // ── 4 · THE CHOOSER IS REACHABLE AND IS NOT A LOOP ──────────────────────
  console.log('\n── the chooser itself ──');
  {
    const r = await land(b, '/role-select.html', NEW_GOOGLE, [{provider:'google'}]);
    t('role-select opens for a pending account', r.url === '/role-select.html', r.url);
    t('...and offers both roles, and only those two',
      r.roleButtons.length === 2 &&
      r.roleButtons.some(x => /patient/i.test(x)) &&
      r.roleButtons.some(x => /doctor/i.test(x)), r.roleButtons);
    t('no page error', r.errs.length === 0, r.errs);
  }

  // ── 5 · CHOSEN ROLES ARE UNTOUCHED ──────────────────────────────────────
  console.log('\n── nothing changes for an account that has a role ──');
  const KEEP = [
    ['patient',                   PATIENT,     '/patient-dashboard.html', '/patient-dashboard.html'],
    ['patient',                   PATIENT,     '/health-passport.html',   '/health-passport.html'],
    ['patient',                   PATIENT,     '/settings.html',          '/settings.html'],
    ['doctor, pending verif.',    DOCTOR_PEND, '/dashboard.html',         '/dashboard.html'],
    ['doctor, pending verif.',    DOCTOR_PEND, '/engine.html',            '/engine.html'],
    ['doctor, pending verif.',    DOCTOR_PEND, '/anesthesia-cases.html',  '/anesthesia-cases.html'],
    ['doctor, APPROVED',          DOCTOR_OK,   '/dashboard.html',         '/dashboard.html'],
    ['doctor, APPROVED',          DOCTOR_OK,   '/engine.html',            '/engine.html'],
    ['doctor, APPROVED',          DOCTOR_OK,   '/anesthesia-cases.html',  '/anesthesia-cases.html'],
    ['doctor, APPROVED',          DOCTOR_OK,   '/questionnaires.html',    '/questionnaires.html'],
    ['administrator',             ADMIN,       '/dashboard.html',         '/dashboard.html'],
    ['administrator',             ADMIN,       '/admin.html',             '/admin.html'],
    ['administrator',             ADMIN,       '/users.html',             '/users.html']
  ];
  for (const [label, profile, path, expect] of KEEP) {
    const r = await land(b, path, profile);
    t((label + ' on ' + path).padEnd(52) + '→ unchanged', r.url === expect, r.url);
  }

  // ── 6 · A PATIENT IS STILL DENIED THE CLINICAL AREA ─────────────────────
  console.log('\n── the deny path still denies ──');
  for (const path of ['/dashboard.html','/anesthesia-cases.html']) {
    const r = await land(b, path, PATIENT);
    t('patient on ' + path.padEnd(24) + '→ patient space, as before',
      r.url === '/patient-dashboard.html', r.url);
  }
  /* And the other half of the same rule, stated rather than left implied: the
     pages that hold no data stay open to them. Denying a signed-in patient a
     page an anonymous visitor can read would punish them for having an
     account, not protect anything. */
  for (const path of ['/engine.html','/scores.html','/references.html']) {
    const r = await land(b, path, PATIENT);
    const expected = path === '/references.html' ? '/patient-dashboard.html' : path;
    t('patient on ' + path.padEnd(24) +
      (path === '/references.html' ? '→ patient space (clinician reference)' : '→ opens, it is public'),
      r.url === expected, r.url);
  }
  {
    const r = await land(b, '/admin.html', DOCTOR_OK);
    t('non-admin doctor on /admin.html → staff dashboard, as before',
      r.url === '/dashboard.html', r.url);
  }

  // ── 7 · AN ADMINISTRATOR IS NOT LOCKED OUT BY THE NEW GATE ──────────────
  console.log('\n── is_admin is a privilege, not a clinical role ──');
  {
    const r = await land(b, '/dashboard.html', ADMIN_NOROLE);
    t('an administrator whose role column is pending still reaches the workspace',
      r.url === '/dashboard.html', r.url);
    const a = await land(b, '/admin.html', ADMIN_NOROLE);
    t('...and the Admin Center', a.url === '/admin.html', a.url);
  }

  // ── 8 · SIGNED OUT BEHAVES EXACTLY AS BEFORE ────────────────────────────
  console.log('\n── a signed-out visitor is unaffected ──');
  for (const path of ['/patient-dashboard.html','/dashboard.html']) {
    const r = await land(b, path, null);
    t('signed out on ' + path.padEnd(24) + '→ homepage, not the chooser',
      r.url === '/index.html', r.url);
  }
  for (const path of PUBLIC_AREA) {
    const r = await land(b, path, null);
    t('public page ' + path.padEnd(20) + ' still public', r.url === path, r.url);
  }

  // ── 9 · THE RULE LIVES IN ONE PLACE ─────────────────────────────────────
  console.log('\n── one copy of the rule ──');
  {
    const authSrc = fs.readFileSync('/home/user/anestheo-website/auth.js', 'utf8');
    t('requireAuth() carries the gate', /role === 'pending' && !isAdmin && !opts\.allowPending/.test(authSrc));
    t('requireRole() no longer sends a roleless account to the patient space',
      /role === 'pending' && !isAdmin[\s\S]{0,120}role-select\.html/.test(authSrc));
    t('the deny target for a WRONG role is unchanged',
      /opts\.deny \|\| \(isStaff \? '\/dashboard\.html' : '\/patient-dashboard\.html'\)/.test(authSrc));
    /* ASK MOVED FROM PATIENT_AREA TO PUBLIC_AREA, and this assertion moved
       with it. It read "ask.html now calls requireAuth()", which was the fix
       for a page that had no guard at all — but requireAuth() answers "may
       this person be here?", and the answer for a page of anesthesiologist-
       written FAQ is yes. Guarding the READ made the public "Ask a question"
       link bounce every visitor to the homepage.

       The rule this suite defends is not weakened, it is aimed at the thing
       that actually creates a row. A roleless account may read the page and is
       sent to the chooser the moment it tries to send a question — asserted
       live below, because a claim about behaviour deserves a browser. */
    const ask = fs.readFileSync('/home/user/anestheo-website/ask.html', 'utf8');
    t('ask.html does not guard the READ',
      !/requireAuth\s*\(/.test(ask.replace(/\/\*[\s\S]*?\*\//g, ' ')));
    t('ask.html shows a roleless account no submission form',
      /gate\.hidden = !!session && \(isPatient \|\| isClinician\)/.test(ask) &&
      /form\.hidden = !isPatient/.test(ask));
    {
      const r = await land(b, '/ask.html', NEW_GOOGLE, [{provider:'google'}]);
      t('pending on /ask.html   → reads it, no bounce', r.url === '/ask.html', r.url);
      const pg2 = await (async () => {
        const ctx = await b.newContext({ viewport:{ width:1440, height:900 } });
        await ctx.route('**/*', rq => { const u = rq.request().url();
          if (/cdn\.jsdelivr|unpkg/.test(u)) return rq.fulfill({status:200,contentType:'text/javascript',body:MOCK});
          if (/googleapis|gstatic/.test(u)) return rq.fulfill({status:200,contentType:'text/css',body:''});
          if (/youtube|ytimg|supabase\.co/.test(u)) return rq.fulfill({status:200,contentType:'application/json',body:'[]'});
          return rq.continue(); });
        const p = await ctx.newPage();
        await p.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(NEW_GOOGLE) + ';');
        await p.goto(BASE + '/ask.html', { waitUntil:'networkidle' });
        await p.waitForTimeout(1500);
        /* The gate, not the form: a roleless account is no longer shown a
           submission control the database would refuse. */
        await p.click('#ask-gate-btn');
        await p.waitForTimeout(1800);
        const url = new URL(p.url()).pathname;
        await ctx.close();
        return url;
      })();
      t('pending ASKING on /ask.html   → role-select', pg2 === '/role-select.html', pg2);
    }
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
