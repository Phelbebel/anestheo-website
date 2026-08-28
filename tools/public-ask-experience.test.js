#!/usr/bin/env node
/* public-ask-experience.test.js
 *
 * Ask the Anesthesiologist: the page is public, sending a question is not.
 *
 * TWO DEFECTS MET ON THIS PAGE and this suite holds both closed.
 *
 * The first was a guard. /ask.html called requireAuth() on load, so the public
 * For Patients page offered "Ask a question", /ask.html took the visitor, and
 * requireAuth() sent them to the homepage. The Ask experience did not exist
 * for anyone without an account. Section 1 asserts a guest lands on
 * /ask.html and stays there, with the FAQ, the topics and the explanation
 * readable.
 *
 * The second was the insert. submitQuestion() posted
 * { name, role, topic, question, email } — the original contact-form columns.
 * v2_ask_migration.sql moved the canonical model to patient_id/subject/
 * message/status and added q_insert_own as `auth.uid() = patient_id`. With
 * patient_id null that check is false, so every question typed since the
 * migration was rejected by RLS. Section 4 captures the real payload at the
 * query-builder boundary and asserts the exact canonical shape, including
 * that patient_id IS the authenticated user id and not merely present.
 *
 * WHAT IS NOT DONE HERE, deliberately: no anonymous insert, no new policy, no
 * SQL. The boundary that rejected the old payload is the same boundary that
 * accepts the new one, untouched. Section 6 asserts that.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const MAIN = process.env.NB_MAIN || 'origin/main';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 130);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(60) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(60) + ' ' + fmt(d)); }
};

const ID = {
  patient: { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' },
  pending: { email:'new@gmail.com', role:'pending', verification_status:'not_required', is_admin:false },
  doctor:  { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' },
  admin:   { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' }
};

const ASK  = fs.readFileSync(REPO + '/ask.html', 'utf8');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });
/* Guards and payloads are read from CODE, never from the prose explaining
   them — this page's comments quote both the old field names and the guard
   they replaced. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

async function open(b, path, prof, w, h) {
  const ctx = await b.newContext({ viewport:{ width:w||1440, height:h||1000 } });
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
  await pg.waitForTimeout(1800);
  return { ctx, pg, errs };
}

/* The mock replaces window.sb in JS, so an insert never reaches the network.
   Wrapping the builder is the only place the real payload is visible. */
const PROBE = `(() => { window.__ins = [];
  const origFrom = window.sb.from.bind(window.sb);
  window.sb.from = function(tbl){ const q = origFrom(tbl);
    const oi = q.insert && q.insert.bind(q);
    if (oi) q.insert = function(p){ window.__ins.push({ table:tbl, payload:p }); return oi(p); };
    return q; };
  return true; })()`;

const STATE = `(() => ({
  url: location.pathname,
  gate: (() => { const g = document.getElementById('ask-gate'); return g ? !g.hidden : null; })(),
  form: (() => { const f = document.getElementById('ask-form'); return f ? !f.hidden : null; })(),
  faq: document.querySelectorAll('.faq-item').length,
  faqText: (document.querySelector('.faq-q') || {}).textContent || '',
  topics: [...document.querySelectorAll('.ask-topic')].map(n => n.textContent),
  hero: !!document.querySelector('.hero-h1'),
  legacy: ['ask-name','ask-role','ask-email'].filter(id => !!document.getElementById(id)),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}))()`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · a guest stays, and gets something ──────────────────────────── */
  console.log('\n1 · Logged out: /ask.html stays /ask.html');
  const g = await open(b, '/ask.html', null);
  const gs = await g.pg.evaluate(STATE);
  t('the guest is not redirected',          gs.url === '/ask.html', gs.url);
  t('no page error',                        g.errs.length === 0, g.errs);
  t('the hero renders',                     gs.hero === true);
  t('all ten FAQ entries render',           gs.faq === 10, gs.faq);
  t('the topics are readable without an account', gs.topics.length === 6, gs.topics);
  t('the guest gate is shown',              gs.gate === true);
  t('the real form is not',                 gs.form === false);
  /* The whole point of the fix: the page must not call the guard that was
     sending people away. */
  t('ask.html no longer calls requireAuth', !/requireAuth\s*\(/.test(code(ASK)));
  /* WAS "main did call it" — a comparison with the branch this fix came
     from. That branch is merged, so main now carries the fix and the
     assertion inverts. The durable claim is about the page itself. */
  t('nothing guards the READ any more',
    !/requireAuth\s*\(|requireRole\s*\(/.test(code(ASK)));

  console.log('\n2 · The FAQ works logged out');
  await g.pg.click('.faq-q');
  await g.pg.waitForTimeout(500);
  const faqOpen = await g.pg.evaluate(`(() => { const i = document.querySelector('.faq-item.open');
    return i ? (i.querySelector('.faq-a-inner')||{}).textContent.trim().length : 0; })()`);
  t('an answer opens and has content',      faqOpen > 80, faqOpen + ' chars');
  t('...still on /ask.html',                new URL(g.pg.url()).pathname === '/ask.html');

  /* ── 3 · a guest cannot insert, and is offered the real modal ───────── */
  console.log('\n3 · A guest cannot send, and is asked to sign in');
  await g.pg.evaluate(PROBE);
  await g.pg.click('#ask-gate-btn');
  await g.pg.waitForTimeout(800);
  const modal = await g.pg.evaluate(`(() => { const m = document.getElementById('nb-modal');
    return !!m && m.classList.contains('open'); })()`);
  t('the CTA opens the existing sign-in modal', modal === true);
  t('it is the shared modal, not a second one',
    /window\.nbOpenModal\s*\(\s*\)/.test(code(ASK)) && !/createClient|signInWithPassword/.test(code(ASK)));
  t('the guest never leaves the page',      new URL(g.pg.url()).pathname === '/ask.html');
  t('no insert was attempted',              (await g.pg.evaluate(`window.__ins.length`)) === 0);
  t('there is no submit control for a guest',
    (await g.pg.evaluate(`(() => { const btn = document.getElementById('ask-btn');
      return !btn || btn.getBoundingClientRect().height === 0; })()`)) === true);
  await g.ctx.close();

  /* ── 4 · the canonical insert ───────────────────────────────────────── */
  console.log('\n4 · An authenticated patient submits the canonical shape');
  const p = await open(b, '/ask.html', ID.patient);
  const ps = await p.pg.evaluate(STATE);
  t('the patient gets the real form',       ps.form === true && ps.gate === false, ps);
  t('the legacy fields are gone',           ps.legacy.length === 0, ps.legacy);
  await p.pg.evaluate(PROBE);
  await p.pg.fill('#ask-question', 'Will I be awake for a spinal?');
  await p.pg.selectOption('#ask-topic', 'Fasting and preparation');
  await p.pg.click('#ask-btn');
  await p.pg.waitForTimeout(1200);
  const ins = await p.pg.evaluate(`window.__ins`);
  const uid = await p.pg.evaluate(`(async () => { const s = await window.getSession();
    return s && s.user && s.user.id; })()`);
  t('exactly one insert, into questions',
    ins.length === 1 && ins[0].table === 'questions', ins.map(i => i.table));
  const pay = (ins[0] || {}).payload || {};
  t('patient_id IS the authenticated user',  pay.patient_id === uid, pay.patient_id + ' vs ' + uid);
  t('subject carries the topic as readable text', pay.subject === 'Fasting and preparation', pay.subject);
  t('message carries the question',          pay.message === 'Will I be awake for a spinal?', pay.message);
  /* status LEFT the payload. v9_7 grants INSERT on (patient_id, subject,
     message) only, so status is not the client's to set — the column takes
     DEFAULT 'new'. A patient therefore cannot submit a question pre-marked
     answered even by mistake, and the grant is what says so. */
  t('status is not sent by the client',      !('status' in pay), Object.keys(pay));
  t('the payload has exactly the three insertable columns',
    JSON.stringify(Object.keys(pay).sort()) === JSON.stringify(['message','patient_id','subject']),
    Object.keys(pay));
  t('no legacy column is posted',
    !['name','role','topic','question','email'].some(k => k in pay), Object.keys(pay));
  const okMsg = await p.pg.evaluate(`(() => { const o = document.getElementById('ask-ok');
    return o && o.style.display === 'block' ? o.textContent.trim() : null; })()`);
  t('a success state is shown',             !!okMsg, okMsg && okMsg.slice(0, 60));
  t('...and it points at where the reply will be',
    /My Space/i.test(okMsg || '') &&
    (await p.pg.evaluate(`!!document.querySelector('#ask-ok a[href="/patient-dashboard.html"]')`)));
  await p.ctx.close();

  /* Technical wording must never reach a patient. */
  console.log('\n5 · Failures stay readable');
  t('the raw Supabase message is not rendered',
    !/err\.textContent\s*=\s*r\.error\.message/.test(code(ASK)));
  t('no raw error text reaches the patient anywhere on the page',
    !/textContent\s*=\s*[^;]*\berror\.message/.test(code(ASK)));
  t('the error goes to the console instead',
    /console\.error\('questions insert failed:'/.test(ASK));
  t('the patient-facing text is plain',
    /could not be sent just now/.test(ASK));

  /* A roleless account reads freely, but chooses before it can own a row. */
  /* A ROLELESS ACCOUNT NO LONGER SEES THE FORM AT ALL. It used to, and was
     redirected on submit; showing a control that cannot work and correcting
     it afterwards is the weaker of the two designs. They get the gate, and
     the gate's CTA routes them to the chooser through the existing modal
     logic — nbOpenModal() reuses a live session rather than asking again. */
  const pend = await open(b, '/ask.html', ID.pending);
  const pendState = await pend.pg.evaluate(STATE);
  t('a roleless account may still READ the page', pendState.url === '/ask.html', pendState.url);
  t('...and is shown the gate, not the form',
    pendState.gate === true && pendState.form === false, pendState);
  await pend.pg.evaluate(PROBE);
  await pend.pg.click('#ask-gate-btn');
  await pend.pg.waitForTimeout(1600);
  t('...and asking sends them to the chooser',
    new URL(pend.pg.url()).pathname === '/role-select.html', new URL(pend.pg.url()).pathname);
  await pend.ctx.close();

  /* ── 6 · RLS, SQL and staff review untouched ────────────────────────── */
  console.log('\n6 · Nothing was weakened to make this work');
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean);
  /* v9_7 is merged into main, so this branch adds no SQL at all — which is
     the stronger statement and the one that stays true. */
  t('this branch changes no SQL',
    changed.filter(f => /\.sql$/.test(f)).length === 0, changed.filter(f => /\.sql$/.test(f)));
  /* auth.js DID change: it gained the return-to breadcrumb, which the Ask
     journey needs and which lives in the one destination resolver every door
     already calls. What must stay true is that no GUARD changed — that is the
     security-relevant part of this file. */
  t('auth.js changed no guard',
    (fs.readFileSync(REPO + '/auth.js','utf8').match(/require(Role|Auth)[\s\S]{0,400}?role-select\.html/g) || []).length ===
    (onMain('auth.js').match(/require(Role|Auth)[\s\S]{0,400}?role-select\.html/g) || []).length);
  t('the pending gate in requireAuth is intact',
    /role === 'pending' && !isAdmin && !opts\.allowPending/.test(fs.readFileSync(REPO + '/auth.js','utf8')));
  t('navbar.js is untouched',   !changed.includes('navbar.js'));
  t('supabase.js is untouched', !changed.includes('supabase.js'));
  /* dashboard.html changed one href: its Questions inbox used to send a
     clinician to the PATIENT's Ask page. Its guard and its queries did not. */
  t('the workspace guard is unchanged',
    /requireRole\('staff'\)/.test(fs.readFileSync(REPO + '/dashboard.html','utf8')));
  /* Three action labels changed — they promised destinations that do not
     exist. The data path did not. */
  const pdNow = fs.readFileSync(REPO + '/patient-dashboard.html','utf8');
  t('My Space still reads only the patient\'s own questions',
    /from\('questions'\)\.select\('\*'\)\.eq\('patient_id', _uid\)/.test(pdNow));
  t('My Space writes nothing new',
    (pdNow.match(/from\('question_replies'\)\.[a-z]+/g) || []).join() ===
    (onMain('patient-dashboard.html').match(/from\('question_replies'\)\.[a-z]+/g) || []).join());
  const mig = fs.readFileSync(REPO + '/v2_ask_migration.sql', 'utf8');
  t('q_insert_own is still auth.uid() = patient_id',
    /create policy q_insert_own on public\.questions\s*for insert with check \(\s*auth\.uid\(\) = patient_id\s*\)/.test(mig));
  t('no anonymous insert policy was added',
    !/to anon|for insert[\s\S]{0,80}true/.test(mig));
  t('the migration file is byte-identical to main',
    mig === onMain('v2_ask_migration.sql'));
  t('the page adds no service-role or bypass client',
    !/service_role|serviceRole|SUPABASE_SERVICE/.test(ASK));

  /* Staff review: the doctor workspace already read both shapes; the admin
     table read only the legacy one and would have shown blanks for every new
     row. Same query, same guard, one defensive fallback added. */
  console.log('\n7 · Staff review still works, for old rows and new');
  const dash = fs.readFileSync(REPO + '/dashboard.html', 'utf8');
  t('the doctor workspace question query is unchanged',
    (dash.match(/from\('questions'\)\.select\('\*'\)[^;]*/g) || []).join() ===
    (onMain('dashboard.html').match(/from\('questions'\)\.select\('\*'\)[^;]*/g) || []).join());
  t('it already tolerated both shapes',
    /q\.subject \|\| q\.topic/.test(dash) && /q\.message \|\| q\.question/.test(dash));
  /* REWRITTEN. questions.html was a four-column legacy admin table; it is now
     the clinician question-management surface, with the canonical columns and
     a real reply. Asserting its old admin guard and its old query would be
     asserting that the surface this product needs had not been built. What
     matters is what replaced them, and that is pinned here. */
  const qh = fs.readFileSync(REPO + '/questions.html', 'utf8');
  t('it renders the canonical model, not the legacy columns',
    /<th>Patient<\/th><th>Topic<\/th><th>Question<\/th><th>Status<\/th>/.test(qh));
  t('it still tolerates a legacy row',
    /q\.subject \|\| q\.topic/.test(qh) && /q\.message \|\| q\.question/.test(qh));
  t('it admits verified staff and refuses an unverified doctor',
    /requireRole\('staff'\)/.test(code(qh)) && /auth\.unverifiedDoctor/.test(code(qh)));
  t('it filters soft-deleted rows like every other question read',
    /from\('questions'\)\.select\('\*'\)\.is\('deleted_at', null\)/.test(qh));
  for (const who of ['doctor', 'admin']) {
    const s = await open(b, '/ask.html', ID[who]);
    const st = await s.pg.evaluate(STATE);
    await s.ctx.close();
    t(who + ' can read the Ask page', st.url === '/ask.html', st.url);
  }

  /* ── 8 · the patient's own questions, and only their own ────────────── */
  console.log('\n8 · Where the answer comes back');
  const pd = fs.readFileSync(REPO + '/patient-dashboard.html', 'utf8');
  t('My Space reads the patient\'s own questions',
    /from\('questions'\)\.select\('\*'\)\.eq\('patient_id', _uid\)/.test(pd));
  t('...scoped to their uid, never a broader read',
    !/from\('questions'\)\.select\('\*'\)\s*\.order/.test(pd));
  t('it renders the canonical subject',     /q\.subject \|\| q\.topic/.test(pd));
  t('replies are joined by question id',    /from\('question_replies'\)\.select\('\*'\)\.in\('question_id'/.test(pd));
  /* A patient reading another patient's question is prevented by
     q_select_own_or_staff, which this branch does not touch. The frontend
     agrees with it: no page asks for questions without a patient_id filter or
     a staff guard. */
  /* READS only. An earlier version of this line matched ask.html, because its
     insert opens with .from('questions').insert({ and the patient_id it sets
     is on the next line — a write counted as an unfiltered read. */
  const reads = execSync('git -C ' + REPO + ' grep -n "from(.questions.)\\.select" -- "*.html" || true',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  const unfiltered = reads.filter(l => !/patient_id/.test(l)).map(l => l.split(':')[0]);
  t('the reads found are the ones we know about', reads.length >= 4, reads.length + ' reads');
  t('every unfiltered questions READ is on a staff-guarded page',
    unfiltered.every(f => /^(dashboard|questions)\.html$/.test(f)), unfiltered);
  t('ask.html only ever writes, never reads questions',
    !/from\('questions'\)\.select/.test(ASK));

  /* ── 9 · phone ──────────────────────────────────────────────────────── */
  /* ── 8b · the new CTA must not ship a known contrast failure ────────── */
  console.log('\n8b · The buttons this page introduces');
  const lum = ([r,g,b]) => { const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
    return .2126*f(r) + .7152*f(g) + .0722*f(b); };
  const ratio = (a, c) => { const L1 = lum(a), L2 = lum(c);
    return +(((Math.max(L1,L2) + .05) / (Math.min(L1,L2) + .05)).toFixed(2)); };
  const rgb = x => (x.match(/\d+/g) || []).slice(0, 3).map(Number);
  for (const [who, prof, sel] of [['guest', null, '#ask-gate-btn'], ['patient', ID.patient, '#ask-btn']]) {
    const s = await open(b, '/ask.html', prof);
    const m = await s.pg.evaluate(`(() => { const n = document.querySelector('${sel}');
      if (!n) return null; const c = getComputedStyle(n);
      return { color:c.color, bg:c.backgroundColor, img:c.backgroundImage,
               size:parseFloat(c.fontSize), h:Math.round(n.getBoundingClientRect().height) }; })()`);
    await s.ctx.close();
    t(who + ': the CTA renders', !!m, m && m.bg);
    /* .btn-primary ships var(--brand-grad) with white text — the same
       #2FA88C→#1B6B5A pair, the same 2.96:1. This page overrides it for its
       own two buttons rather than repainting sixteen pages. */
    t(who + ': the CTA is flat, not the broken gradient', m.img === 'none', m.img);
    t(who + ': the CTA reaches AA', ratio(rgb(m.color), rgb(m.bg)) >= 4.5,
      ratio(rgb(m.color), rgb(m.bg)) + ':1');
    t(who + ': the override is page-scoped, not global',
      /\.ask-(gate|form) \.btn-primary/.test(ASK) &&
      !execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' }).includes('styles.css'));
  }

  console.log('\n9 · 390px — the viewport the bug was found on');
  for (const [who, prof] of [['guest', null], ['patient', ID.patient]]) {
    const s = await open(b, '/ask.html', prof, 390, 844);
    const st = await s.pg.evaluate(STATE);
    const tap = await s.pg.evaluate(`(() => [...document.querySelectorAll('#ask-gate-btn, #ask-btn, .faq-q')]
      .filter(n => n.getBoundingClientRect().height > 0)
      .map(n => Math.round(n.getBoundingClientRect().height)))()`);
    await s.ctx.close();
    t(who + ' at 390px stays on /ask.html', st.url === '/ask.html', st.url);
    t(who + ' at 390px: no horizontal overflow', st.overflow <= 0, st.overflow + 'px');
    t(who + ' at 390px: FAQ is there',      st.faq === 10, st.faq);
    t(who + ' at 390px: tap targets are 44px+', tap.every(h => h >= 44), tap);
  }

  /* The journey that was broken, end to end. */
  console.log('\n10 · For Patients → Ask, as a guest, on a phone');
  const j = await open(b, '/patients.html', null, 390, 844);
  const link = await j.pg.evaluate(`(() => { const a = [...document.querySelectorAll('#ph-guest a')]
    .find(x => /Ask a question/i.test(x.textContent)); return a ? a.getAttribute('href') : null; })()`);
  t('the public For Patients page offers Ask', link === '/ask.html', link);
  await j.pg.click('#ph-guest a[href="/ask.html"]');
  await j.pg.waitForTimeout(2000);
  t('...and it opens, with no bounce to Home',
    new URL(j.pg.url()).pathname === '/ask.html', new URL(j.pg.url()).pathname);
  t('...showing the FAQ',
    (await j.pg.evaluate(`document.querySelectorAll('.faq-item').length`)) === 10);
  await j.ctx.close();

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
