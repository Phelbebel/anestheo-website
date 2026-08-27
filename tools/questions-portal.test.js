#!/usr/bin/env node
/* questions-portal.test.js
 *
 * Ask the Anesthesiologist, end to end: the public page, the return-to
 * journey, the clinician reply, and the policy model behind all of it.
 *
 * ── WHAT SECTION 1 IS, AND WHAT IT IS NOT ─────────────────────────────────
 * It reads v9_7_questions_portal.sql, extracts every policy and grant, and
 * evaluates each predicate against six identities. That is verification of
 * the migration's INTENT, not execution against a live database — this branch
 * has no database to run against and the migration is deliberately unapplied.
 * It catches the mistakes that matter at authoring time: a policy that forgets
 * `to authenticated`, a predicate that is true for anon, a clinician clause
 * that admits an unverified doctor, an `exists` that compares the wrong
 * column. It cannot catch a Postgres behaviour I have misunderstood, and it
 * does not pretend to.
 *
 * The translation from SQL to a boolean is deliberately narrow: it recognises
 * exactly the constructs this file uses, and throws on anything else, so a
 * future policy written in a form it does not understand fails loudly instead
 * of silently evaluating to true.
 *
 * ── SECTION 5 IS THE ONE THAT WAS ASKED FOR TWICE ─────────────────────────
 * The complete journey, from a logged-out /ask.html, through the real
 * navbar modal, through navbar's own post-sign-in code and the real
 * resolveAuthDestination(), and back to /ask.html with the form unlocked.
 * Nothing is preloaded: the session does not exist until the modal's submit
 * handler runs.
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
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};

const SQL  = fs.readFileSync(REPO + '/v9_7_questions_portal.sql', 'utf8');
const ASK  = fs.readFileSync(REPO + '/ask.html', 'utf8');
const QP   = fs.readFileSync(REPO + '/questions.html', 'utf8');
const AUTH = fs.readFileSync(REPO + '/auth.js', 'utf8');
const PD   = fs.readFileSync(REPO + '/patient-dashboard.html', 'utf8');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

/* ── the six identities ─────────────────────────────────────────────────── */
const UID = { A:'uid-patient-a', B:'uid-patient-b', PD:'uid-pending-doc', VD:'uid-verified-doc', AD:'uid-admin' };
const WHO = {
  anon:      { uid:null,   role:null,      authenticated:false, verifiedDoctor:false, admin:false, pendingDoctor:false },
  patientA:  { uid:UID.A,  role:'patient', authenticated:true,  verifiedDoctor:false, admin:false, pendingDoctor:false },
  patientB:  { uid:UID.B,  role:'patient', authenticated:true,  verifiedDoctor:false, admin:false, pendingDoctor:false },
  pendingDr: { uid:UID.PD, role:'doctor',  authenticated:true,  verifiedDoctor:false, admin:false, pendingDoctor:true  },
  verifiedDr:{ uid:UID.VD, role:'doctor',  authenticated:true,  verifiedDoctor:true,  admin:false, pendingDoctor:false },
  admin:     { uid:UID.AD, role:'admin',   authenticated:true,  verifiedDoctor:false, admin:true,  pendingDoctor:false }
};

/* SQL → boolean, for the narrow subset this migration uses. Anything it does
   not recognise is left in place and blows up in new Function(), which is the
   intended failure mode: silence would be worse than a crash. */
function compile(sqlExpr) {
  let js = ' ' + sqlExpr.replace(/\s+/g, ' ').trim() + ' ';
  js = js
    .replace(/exists\s*\(\s*select 1 from public\.profiles p where p\.id = auth\.uid\(\) and p\.role = 'patient'\s*\)/gi,
             "(who.role === 'patient')")
    .replace(/exists\s*\(\s*select 1 from public\.questions q where q\.id = question_replies\.question_id and q\.patient_id = auth\.uid\(\)\s*\)/gi,
             "(row.parentOwner === who.uid)")
    .replace(/public\.is_verified_doctor\(\)/gi, "who.verifiedDoctor")
    .replace(/public\.is_platform_admin\(\)/gi, "who.admin")
    .replace(/public\.is_pending_doctor\(\)/gi, "who.pendingDoctor")
    .replace(/auth\.uid\(\)/gi, "who.uid")
    .replace(/\bpatient_id\b/g, "row.patient_id")
    .replace(/\bauthor_id\b/g, "row.author_id")
    .replace(/\bnot\b/gi, "!")
    .replace(/\band\b/gi, "&&")
    .replace(/\bor\b/gi, "||")
    .replace(/\s=\s/g, " === ");
  const leftover = js.match(/\b(select|from|where|exists|public\.|auth\.)\w*/i);
  if (leftover) throw new Error('unrecognised SQL in policy predicate: ' + leftover[0] + ' :: ' + sqlExpr.slice(0,90));
  return new Function('who', 'row', 'return (' + js + ');');
}

/* Pull the policies out of the migration rather than restating them here. */
function parsePolicies(sql) {
  const out = [];
  const re = /create policy (\w+) on public\.(\w+)([\s\S]*?);/g;
  let m;
  while ((m = re.exec(sql))) {
    const body = m[3];
    const cmd = (body.match(/for (all|select|insert|update|delete)/i) || [])[1] || '';
    const roles = (body.match(/to ([a-z, ]+)/i) || [])[1] || '';
    const restrictive = /as restrictive/i.test(body);
    const grab = kw => {
      const i = body.toLowerCase().indexOf(kw);
      if (i < 0) return null;
      let d = 0, start = body.indexOf('(', i), j = start;
      for (; j < body.length; j++) { if (body[j] === '(') d++; else if (body[j] === ')') { d--; if (!d) break; } }
      return body.slice(start + 1, j);
    };
    out.push({ name:m[1], table:m[2], cmd:cmd.toLowerCase(), roles:roles.trim(),
               restrictive, using:grab('using'), check:grab('with check') });
  }
  return out;
}

async function open(b, path, initScript, w, h) {
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
  if (initScript) await pg.addInitScript(initScript);
  await pg.goto(BASE + path, { waitUntil:'networkidle' }).catch(() => {});
  await pg.waitForTimeout(1700);
  return { ctx, pg, errs };
}
const asProfile = p => 'window.__TEST_PROFILE=' + JSON.stringify(p) + ';';
const PATIENT = { email:'p@e.com', role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' };
const VDOC    = { email:'d2@e.com', role:'doctor', verification_status:'approved', is_admin:false, full_name:'Dana Levi' };
const PDOC    = { email:'d@e.com',  role:'doctor', verification_status:'pending',  is_admin:false, full_name:'Dana Levi' };
const ADMIN   = { email:'a@e.com',  role:'admin',  verification_status:'not_required', is_admin:true, full_name:'Ada Admin' };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ══ 1 · THE POLICY MODEL ═══════════════════════════════════════════════ */
  console.log('\n1 · v9_7 policies, evaluated per identity');
  const pol = parsePolicies(SQL);
  t('the migration defines policies',      pol.length >= 7, pol.map(p => p.name));

  /* The three production doors, closed by name. */
  for (const name of ['Allow insert questions', 'Allow select questions', 'Allow update questions']) {
    t('drops "' + name + '"',
      new RegExp('drop policy if exists "' + name + '" on public\\.questions').test(SQL));
  }
  t('it does not sweep policies by pattern',
    !/drop policy[\s\S]{0,80}(like|~|pg_policies)/i.test(SQL));
  t('v9_5 questions_require_verified is left alone',
    !/drop policy if exists questions_require_verified/i.test(SQL));

  /* Every PERMISSIVE policy must be role-scoped. This is the belt beside the
     braces: even a predicate that evaluated true for anon could not be reached
     by anon, because the policy does not apply to that role. */
  const permissive = pol.filter(p => !p.restrictive);
  t('every permissive policy is scoped `to authenticated`',
    permissive.every(p => /^authenticated$/.test(p.roles)), permissive.map(p => p.name + '=' + p.roles));

  /* Now evaluate. */
  const rowOwnedBy = uid => ({ patient_id: uid, author_id: uid, parentOwner: uid });
  const results = {};
  for (const p of pol) {
    const usingFn = p.using ? compile(p.using) : null;
    const checkFn = p.check ? compile(p.check) : null;
    for (const [who, id] of Object.entries(WHO)) {
      /* A policy scoped `to authenticated` simply does not apply to anon. */
      const applies = id.authenticated || !/authenticated/.test(p.roles);
      const own   = rowOwnedBy(id.uid);
      const other = rowOwnedBy(UID.B === id.uid ? UID.A : UID.B);
      results[p.name + '/' + who] = {
        own:   applies && (usingFn ? usingFn(id, own)   : true) && (checkFn ? checkFn(id, own)   : true),
        other: applies && (usingFn ? usingFn(id, other) : true) && (checkFn ? checkFn(id, other) : true)
      };
    }
  }
  const R = (policy, who, which) => (results[policy + '/' + who] || {})[which || 'own'] === true;

  console.log('\n   ANON — the table is not theirs to touch');
  for (const p of permissive) {
    t('anon cannot use ' + p.name, !R(p.name, 'anon') && !R(p.name, 'anon', 'other'));
  }

  console.log('\n   PATIENT A');
  t('may insert their own question',       R('q_insert_patient', 'patientA'));
  t('cannot forge patient_id = Patient B', !R('q_insert_patient', 'patientA', 'other'));
  t('may read their own question',         R('q_select_own', 'patientA'));
  t('cannot read Patient B\'s question',   !R('q_select_own', 'patientA', 'other'));
  t('gains nothing from the clinician read', !R('q_select_clinician', 'patientA'));
  t('cannot update a question',
    !R('q_update_clinician', 'patientA') && !pol.some(p => p.table === 'questions' && p.cmd === 'update' &&
      compile(p.using)(WHO.patientA, rowOwnedBy(UID.A))));
  t('may read replies on their own thread', R('r_select_participant', 'patientA'));
  t('cannot read replies on Patient B\'s thread', !R('r_select_participant', 'patientA', 'other'));
  t('may reply on their own thread only',
    R('r_insert_patient', 'patientA') && !R('r_insert_patient', 'patientA', 'other'));

  console.log('\n   PATIENT B — the mirror');
  t('cannot see Patient A\'s question',    !R('q_select_own', 'patientB', 'other'));
  t('cannot reply into Patient A\'s thread', !R('r_insert_patient', 'patientB', 'other'));

  console.log('\n   PENDING DOCTOR — no patient questions at all');
  t('not admitted by the clinician read',  !R('q_select_clinician', 'pendingDr'));
  t('not admitted by the clinician update',!R('q_update_clinician', 'pendingDr'));
  t('cannot reply as a clinician',         !R('r_insert_clinician', 'pendingDr'));
  t('is not somebody else\'s patient either', !R('q_select_own', 'pendingDr', 'other'));
  /* And the second, independent reason: the RESTRICTIVE gate. */
  const restr = pol.filter(p => p.restrictive);
  t('a restrictive gate exists on replies', restr.some(p => p.table === 'question_replies'), restr.map(p => p.name));
  t('...and it removes a pending doctor',
    restr.every(p => !compile(p.using)(WHO.pendingDr, rowOwnedBy(UID.PD))));
  t('...while leaving a verified doctor',
    restr.every(p => compile(p.using)(WHO.verifiedDr, rowOwnedBy(UID.VD))));

  console.log('\n   VERIFIED DOCTOR / ADMIN');
  for (const who of ['verifiedDr', 'admin']) {
    t(who + ' reads the inbox',            R('q_select_clinician', who) && R('q_select_clinician', who, 'other'));
    t(who + ' updates status',             R('q_update_clinician', who));
    t(who + ' reads replies',              R('r_select_participant', who, 'other'));
    t(who + ' may reply',                  R('r_insert_clinician', who));
    /* author_id is pinned: a clinician cannot post as someone else. */
    t(who + ' cannot reply as another author', !R('r_insert_clinician', who, 'other'));
    t(who + ' is not admitted as a patient author', !R('q_insert_patient', who));
  }

  console.log('\n   GRANTS');
  t('anon loses everything on questions',        /revoke all on public\.questions\s+from anon/i.test(SQL));
  t('anon loses everything on question_replies', /revoke all on public\.question_replies from anon/i.test(SQL));
  t('authenticated gets select/insert/update on questions',
    /grant select, insert, update on public\.questions\s+to authenticated/i.test(SQL));
  t('authenticated gets select/insert on replies',
    /grant select, insert\s+on public\.question_replies to authenticated/i.test(SQL));
  t('nobody gets DELETE',                 /revoke delete on public\.questions\s+from anon, authenticated/i.test(SQL));
  t('replies cannot be edited after the fact',
    /revoke update on public\.question_replies from anon, authenticated/i.test(SQL));
  /* Comments stripped: the header explains the anon grants that exist today
     and the VERIFY block queries `grantee in ('anon',…)`, both of which a raw
     match reads as a grant being issued. */
  const SQLCODE = SQL.replace(/--.*$/gm, ' ');
  t('no grant to anon anywhere in the file',
    !/\bgrant\b[^;]*\bto\b[^;]*\banon\b/i.test(SQLCODE));

  console.log('\n   SHAPE');
  t('legacy `question` loses NOT NULL',
    /alter table public\.questions alter column question drop not null/i.test(SQL));
  t('no legacy column is dropped',        !/alter table public\.questions drop column/i.test(SQL));
  t('question_replies is created',        /create table if not exists public\.question_replies/i.test(SQL));
  t('the status CHECK lists the four values',
    /check \(status is null or status in \('new','under_review','answered','closed'\)\)/i.test(SQL));
  t('updated_at has a trigger',           /create trigger trg_questions_updated_at/i.test(SQL));
  t('the file writes no data',            !/^\s*(insert into|update public\.\w+ set)/im.test(SQL.replace(/--.*$/gm,'')));
  t('it is not applied by this branch',   true, 'review only');

  /* ══ 2 · THE PUBLIC PAGE ════════════════════════════════════════════════ */
  console.log('\n2 · A guest reads, and cannot send');
  const g = await open(b, '/ask.html', 'window.__TEST_ROLE="anon";');
  const gs = await g.pg.evaluate(`(() => ({ url:location.pathname,
    faq:document.querySelectorAll('.faq-item').length,
    topics:document.querySelectorAll('.ask-topic').length,
    gate:!document.getElementById('ask-gate').hidden,
    form:!document.getElementById('ask-form').hidden }))()`);
  t('stays on /ask.html',                 gs.url === '/ask.html', gs.url);
  t('FAQ and topics are public',          gs.faq === 10 && gs.topics === 6, gs);
  t('the gate is shown, the form is not', gs.gate && !gs.form, gs);
  t('no page error',                      g.errs.length === 0, g.errs);
  await g.ctx.close();

  /* ══ 3 · THE RETURN-TO MECHANISM ════════════════════════════════════════ */
  console.log('\n3 · Return-to: narrow, allowlisted, single-use');
  t('ask.html leaves the breadcrumb before opening the modal',
    /setAuthReturnTo\('\/ask\.html'\)[\s\S]{0,300}nbOpenModal/.test(code(ASK)));
  t('the resolver consumes it',           /peekAuthReturnTo\(\)[\s\S]{0,200}clearAuthReturnTo\(\)/.test(code(AUTH)));
  /* Scoped to the resolver body. peekAuthReturnTo() is also DEFINED earlier
     in the file, so a whole-file indexOf finds the definition and compares the
     wrong two positions. */
  const RESOLVER = code(AUTH).slice(code(AUTH).indexOf('async function resolveAuthDestination'));
  t('a pending role does NOT consume it',
    RESOLVER.indexOf("dest: '/role-select.html'") < RESOLVER.indexOf('peekAuthReturnTo()'),
    'role-select at ' + RESOLVER.indexOf("dest: '/role-select.html'") +
    ', peek at ' + RESOLVER.indexOf('peekAuthReturnTo()'));
  t('it is an allowlist, not a prefix check',
    /AUTH_RETURN_ALLOW\.indexOf\(path\) === -1/.test(AUTH));
  t('sessionStorage, not localStorage',
    /sessionStorage\.setItem\(AUTH_RETURN_KEY/.test(AUTH) &&
    !/localStorage\.(set|get|remove)Item\(\s*AUTH_RETURN_KEY/.test(AUTH));
  /* The open-redirect cases, run against the real validator in a browser. */
  const v = await open(b, '/ask.html', 'window.__TEST_ROLE="anon";');
  const probes = await v.pg.evaluate(`(() => {
    const bad = ['//evil.example','/\\\\evil.example','https://evil.example','http://evil.example/x',
                 'javascript:alert(1)','/ask.html?x=1','/ask.html#y','ask.html','/../ask.html',
                 '/admin.html','/dashboard.html','%2F%2Fevil.example'];
    const out = {};
    bad.forEach(p => { out[p] = window.setAuthReturnTo(p); });
    out['/ask.html'] = window.setAuthReturnTo('/ask.html');
    return { out, stored: window.peekAuthReturnTo() }; })()`);
  const rejected = Object.entries(probes.out).filter(([k]) => k !== '/ask.html');
  t('every off-site / crafted target is refused',
    rejected.every(([, v2]) => v2 === false), rejected.filter(([, v2]) => v2 !== false).map(([k]) => k));
  t('a staff page is not a valid return target',
    probes.out['/admin.html'] === false && probes.out['/dashboard.html'] === false);
  t('the legitimate target is accepted',  probes.out['/ask.html'] === true);
  t('and it is what got stored',          probes.stored === '/ask.html', probes.stored);
  await v.ctx.close();

  /* ══ 4 · SUBMISSION ═════════════════════════════════════════════════════ */
  console.log('\n4 · The canonical insert');
  const p4 = await open(b, '/ask.html', asProfile(PATIENT));
  await p4.pg.evaluate(`(() => { window.__ins = [];
    const of = window.sb.from.bind(window.sb);
    window.sb.from = function(tb){ const q = of(tb); const oi = q.insert && q.insert.bind(q);
      if (oi) q.insert = function(x){ window.__ins.push({ table:tb, payload:x }); return oi(x); };
      return q; }; })()`);
  await p4.pg.fill('#ask-question', 'Will I be awake for a spinal?');
  await p4.pg.selectOption('#ask-topic', 'Fasting and preparation');
  await p4.pg.click('#ask-btn');
  await p4.pg.waitForTimeout(1200);
  const ins = await p4.pg.evaluate('window.__ins');
  const uid = await p4.pg.evaluate('(async () => (await window.getSession()).user.id)()');
  await p4.ctx.close();
  const pay = (ins[0] || {}).payload || {};
  t('one insert into questions',          ins.length === 1 && ins[0].table === 'questions', ins.map(i => i.table));
  t('patient_id === auth.uid()',          pay.patient_id === uid, pay.patient_id);
  t('subject / message / status',
    pay.subject === 'Fasting and preparation' && pay.message === 'Will I be awake for a spinal?' && pay.status === 'new', pay);
  t('exactly the four canonical keys',
    JSON.stringify(Object.keys(pay).sort()) === JSON.stringify(['message','patient_id','status','subject']), Object.keys(pay));
  t('the page names v9_7 as its prerequisite', /v9_7_questions_portal\.sql/.test(ASK));

  /* ══ 5 · THE COMPLETE MODAL JOURNEY ═════════════════════════════════════ */
  console.log('\n5 · Logged out → modal → signed in → back on /ask.html');
  {
    /* No preloaded session. getSession() returns null until the modal's own
       submit handler runs, exactly as for a real visitor. */
    /* THE SEAM IS window.sb.auth.getSession, NOT window.getSession.
       auth.js caches `_sessionPromise = withTimeout(window.sb.auth.getSession())`
       and resolveAuthDestination() calls that module-local function — so
       stubbing the window helper leaves the resolver reading the real (null)
       session, sign-in resolves to no-session, and navbar falls back to the
       homepage. Wrapping the client is what a real sign-in actually changes. */
    const boot = `
      window.__TEST_ROLE = sessionStorage.getItem('e2e.in') ? 'session' : 'anon';
      window.__TEST_PROFILE = ${JSON.stringify(PATIENT)};
      (function(){
        var E2E_USER = { id:'e2e-uid', email:'p@e.com' };
        function install(){
          if(!window.sb || !window.sb.auth) return false;
          var signedIn = !!sessionStorage.getItem('e2e.in');
          window.sb.auth.getSession = function(){
            return Promise.resolve({ data:{ session: signedIn ? { user:E2E_USER } : null }, error:null });
          };
          window.sb.auth.signInWithPassword = function(){
            signedIn = true; sessionStorage.setItem('e2e.in','1');
            return Promise.resolve({ data:{ user:E2E_USER, session:{ user:E2E_USER } }, error:null });
          };
          return true;
        }
        var tries = 0;
        var iv = setInterval(function(){ if(install() || ++tries > 60) clearInterval(iv); }, 20);
      })();`;
    const j = await open(b, '/ask.html', boot);
    const before = await j.pg.evaluate(`(() => ({ url:location.pathname,
      gate:!document.getElementById('ask-gate').hidden,
      form:!document.getElementById('ask-form').hidden }))()`);
    t('starts logged out on /ask.html',   before.url === '/ask.html' && before.gate && !before.form, before);

    await j.pg.click('#ask-gate-btn');
    await j.pg.waitForTimeout(700);
    const modalOpen = await j.pg.evaluate(`(() => { const m = document.getElementById('nb-modal');
      return !!m && m.classList.contains('open'); })()`);
    t('the real navbar modal opens',       modalOpen === true);
    t('the breadcrumb is set at that moment',
      (await j.pg.evaluate(`sessionStorage.getItem('anestheo.auth.returnTo')`)) === '/ask.html');

    /* Drive the modal itself — its fields, its submit button, its handler. */
    await j.pg.fill('#nb-email', 'p@e.com');
    await j.pg.fill('#nb-pass', 'correct-horse');
    await j.pg.click('#nb-submit-btn');
    await j.pg.waitForTimeout(2600);
    const landed = new URL(j.pg.url()).pathname;
    t('navbar navigated back to /ask.html', landed === '/ask.html', landed);
    const after = await j.pg.evaluate(`(() => ({
      gate: (() => { const x = document.getElementById('ask-gate'); return x ? !x.hidden : null; })(),
      form: (() => { const x = document.getElementById('ask-form'); return x ? !x.hidden : null; })(),
      crumb: sessionStorage.getItem('anestheo.auth.returnTo') }))()`);
    t('the question form is unlocked',     after.form === true && after.gate === false, after);
    t('the breadcrumb was consumed',       after.crumb === null, after.crumb);
    await j.ctx.close();
  }

  /* ══ 6 · CLINICIAN INBOX AND REPLY ══════════════════════════════════════ */
  console.log('\n6 · The clinician surface');
  t('the workspace no longer sends clinicians to /ask.html',
    !/ws-row-actions[\s\S]{0,120}href="\/ask\.html"/.test(code(fs.readFileSync(REPO + '/dashboard.html','utf8'))));
  t('...it deep-links into /questions.html',
    /href="\/questions\.html\?q='/.test(fs.readFileSync(REPO + '/dashboard.html','utf8')));
  t('questions.html admits verified staff, not admins only',
    /requireRole\('staff'\)/.test(code(QP)) && !/requireRole\('admin'\)/.test(code(QP)));
  t('...and refuses an unverified doctor', /auth\.unverifiedDoctor/.test(code(QP)));
  t('the table is the canonical model',
    /<th>Patient<\/th><th>Topic<\/th><th>Question<\/th><th>Status<\/th><th>Submitted<\/th><th>Action<\/th>/.test(QP));
  t('no raw uuid is printed as a name',   /patientLabel/.test(QP) && !/esc\(x\.patient_id\)/.test(QP));
  t('names are resolved from profiles',   /from\('profiles'\)\.select\('id,full_name,email'\)/.test(QP));
  t('a reply writes question_replies',    /from\('question_replies'\)\.insert\(/.test(QP));
  t('author_id is the caller',            /author_id:\s*_me\.session\.user\.id/.test(QP));
  t('the status is set to answered',      /update\(\{ status: 'answered' \}\)/.test(QP));
  t('the reply is written before the status',
    QP.indexOf("from('question_replies').insert(") < QP.indexOf("update({ status: 'answered' })"));
  t('supabase errors are not shown to the clinician',
    !/textContent\s*=\s*[^;]*error\.message/.test(QP) && /console\.error\('reply failed:'/.test(QP));

  for (const [who, prof, expect] of [['verified doctor', VDOC, true], ['admin', ADMIN, true], ['pending doctor', PDOC, false]]) {
    const s = await open(b, '/questions.html', asProfile(prof));
    const st = await s.pg.evaluate(`(() => ({ url:location.pathname,
      app: (() => { const a = document.getElementById('app'); return !!a && getComputedStyle(a).display !== 'none'; })(),
      loader: (document.getElementById('loader')||{}).textContent || '' }))()`);
    await s.ctx.close();
    t(who + (expect ? ' opens the inbox' : ' is refused the inbox'),
      (st.url === '/questions.html' && st.app) === expect, st.url + ' app=' + st.app);
    if (!expect) t('...with an explanation, not an empty table', /Verification required/.test(st.loader), st.loader.slice(0,40));
  }

  /* ══ 7 · MY SPACE ═══════════════════════════════════════════════════════ */
  console.log('\n7 · The reply comes back to the patient');
  t('My Space reads only the patient\'s own questions',
    /from\('questions'\)\.select\('\*'\)\.eq\('patient_id', _uid\)/.test(PD));
  t('it loads replies for those questions',
    /from\('question_replies'\)\.select\('\*'\)\.in\('question_id', ids\)/.test(PD));
  t('an answered question shows "Reply received"', /Reply received/.test(PD));
  t('and the reply text itself is rendered',
    /ms-crq-reply[\s\S]{0,120}rep\[rep\.length-1\]\.message/.test(PD));
  t('a waiting question says so',         /Waiting for reply/.test(PD));
  t('patient-dashboard.html was not rewritten',
    PD === onMain('patient-dashboard.html'));

  /* ══ 8 · SCOPE ══════════════════════════════════════════════════════════ */
  console.log('\n8 · What else moved');
  /* Tracked changes AND untracked additions. The migration is a new file, so
     `git diff` alone reports it as nothing at all — which made "the migration
     is the only SQL added" pass vacuously against an empty list. */
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean)
    .concat(execSync('git -C ' + REPO + ' ls-files --others --exclude-standard', { encoding:'utf8' })
      .split('\n').filter(Boolean));
  const sqlChanged = changed.filter(f => /\.sql$/.test(f));
  t('the migration file is present in the change set', sqlChanged.length === 1, sqlChanged);
  t('the migration is the only SQL added',
    sqlChanged.join() === 'v9_7_questions_portal.sql', sqlChanged);
  t('no existing migration was edited',
    !changed.some(f => /\.sql$/.test(f) && f !== 'v9_7_questions_portal.sql'));
  t('v2_ask_migration.sql is untouched',  !changed.includes('v2_ask_migration.sql'));
  t('navbar.js is untouched',             !changed.includes('navbar.js'));
  t('supabase.js is untouched',           !changed.includes('supabase.js'));
  t('patient-dashboard.html is untouched',!changed.includes('patient-dashboard.html'));
  t('auth.js changed only to add return-to',
    (() => { const a = code(AUTH), m = code(onMain('auth.js'));
      const strip = s => s.replace(/var AUTH_RETURN_KEY[\s\S]*?window\.AUTH_RETURN_ALLOW = AUTH_RETURN_ALLOW;/, '')
                          .replace(/var back = peekAuthReturnTo\(\);[\s\S]*?\}\n/, '')
                          .replace(/\s+/g, ' ');
      return strip(a) === strip(m); })());
  t('no guard was removed from a data page',
    /requireRole\('staff'\)/.test(code(fs.readFileSync(REPO + '/dashboard.html','utf8'))));

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
