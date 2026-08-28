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
/* Comment-free. This file explains every change by quoting what it replaced —
   the old CHECK, the old email fallback — so text assertions run against the
   statements, never against the prose describing them. */
const SQLONLY = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
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
    .replace(/\bauthor_role\b/g, "row.author_role")
    .replace(/\bstatus\b/g, "row.status")
    .replace(/char_length\(subject\)/gi, "String(row.subject == null ? '' : row.subject).length")
    .replace(/char_length\(message\)/gi, "String(row.message == null ? '' : row.message).length")
    .replace(/btrim\(subject\)/gi,  "String(row.subject == null ? '' : row.subject).trim()")
    .replace(/btrim\(message\)/gi,  "String(row.message == null ? '' : row.message).trim()")
    .replace(/\bsubject is not null\b/gi, "(row.subject != null)")
    .replace(/\bmessage is not null\b/gi, "(row.message != null)")
    .replace(/\bpatient_id is null\b/gi, "(row.patient_id == null)")
    .replace(/<>/g, "!==")
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
  /* author_role has to match the identity now that r_insert_clinician checks
     it. A fixed 'doctor' made the generic matrix fail an admin for the wrong
     reason; the forgery cases are covered explicitly further down. */
  const roleOf = who => who.admin ? 'admin' : (who.verifiedDoctor ? 'doctor' : 'patient');
  const rowFor = (who, uid) => ({ patient_id: uid, author_id: uid, parentOwner: uid,
                                  status: 'new', author_role: roleOf(who),
                                  subject: 'Medications', message: 'A real question.' });
  const results = {};
  for (const p of pol) {
    const usingFn = p.using ? compile(p.using) : null;
    const checkFn = p.check ? compile(p.check) : null;
    for (const [who, id] of Object.entries(WHO)) {
      /* A policy scoped `to authenticated` simply does not apply to anon. */
      const applies = id.authenticated || !/authenticated/.test(p.roles);
      const own   = rowFor(id, id.uid);
      const other = rowFor(id, UID.B === id.uid ? UID.A : UID.B);
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
      compile(p.using)(WHO.patientA, rowFor(WHO.patientA, UID.A))));
  t('may read replies on their own thread', R('r_select_participant', 'patientA'));
  t('cannot read replies on Patient B\'s thread', !R('r_select_participant', 'patientA', 'other'));
  /* NOT SHIPPED THIS RELEASE. r_insert_patient existed in an earlier draft;
     nothing in the patient product appends to a thread, so a permission with
     no caller is a permission nobody watches. Its absence is the assertion. */
  t('patients get no reply permission at all',
    !pol.some(p => p.name === 'r_insert_patient'), pol.map(p => p.name));
  t('...and the migration says why',
    /NO PATIENT REPLY POLICY IN THIS RELEASE/.test(SQL));

  console.log('\n   PATIENT B — the mirror');
  t('cannot see Patient A\'s question',    !R('q_select_own', 'patientB', 'other'));
  t('has no reply route to forge at all',
    !pol.some(p => p.table === 'question_replies' && p.cmd === 'insert' &&
      compile(p.check)(WHO.patientB, { author_id:UID.B, patient_id:UID.B, parentOwner:UID.B, author_role:'patient' })));

  console.log('\n   PENDING DOCTOR — no patient questions at all');
  t('not admitted by the clinician read',  !R('q_select_clinician', 'pendingDr'));
  t('not admitted by the clinician update',!R('q_update_clinician', 'pendingDr'));
  t('cannot reply as a clinician',         !R('r_insert_clinician', 'pendingDr'));
  t('is not somebody else\'s patient either', !R('q_select_own', 'pendingDr', 'other'));
  /* And the second, independent reason: the RESTRICTIVE gate. */
  const restr = pol.filter(p => p.restrictive);
  t('a restrictive gate exists on replies', restr.some(p => p.table === 'question_replies'), restr.map(p => p.name));
  t('...and it removes a pending doctor',
    restr.every(p => !compile(p.using)(WHO.pendingDr, rowFor(WHO.pendingDr, UID.PD))));
  t('...while leaving a verified doctor',
    restr.every(p => compile(p.using)(WHO.verifiedDr, rowFor(WHO.verifiedDr, UID.VD))));

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

  console.log('\n   GRANTS — column level, because RLS limits rows not columns');
  t('anon loses everything on questions',        /revoke all on public\.questions\s+from anon/i.test(SQL));
  t('anon loses everything on question_replies', /revoke all on public\.question_replies from anon/i.test(SQL));
  t('authenticated is reset before being granted anything',
    /revoke all on public\.questions from authenticated/i.test(SQL) &&
    /revoke all on public\.question_replies from authenticated/i.test(SQL));

  /* THE ASSERTION THIS ROUND EXISTS FOR. A table-wide UPDATE lets any
     clinician who passes q_update_clinician rewrite message, subject or
     patient_id — the policy cannot say "only this column", so the grant must. */
  const SQLC = SQL.replace(/--.*$/gm, ' ');
  t('NO table-wide UPDATE on questions',
    !/grant[^;(]*\bupdate\b[^;(]*on public\.questions\s+to/i.test(SQLC),
    (SQLC.match(/grant[^;]*update[^;]*questions[^;]*/i) || [''])[0].trim().slice(0,70));
  t('NO table-wide INSERT on questions',
    !/grant[^;(]*\binsert\b[^;(]*on public\.questions\s+to/i.test(SQLC));
  t('UPDATE is granted on (status) only',
    /grant update \(status\)\s+on public\.questions to authenticated/i.test(SQLC));
  t('INSERT is granted on (patient_id, subject, message)',
    /grant insert \(patient_id, subject, message\) on public\.questions to authenticated/i.test(SQLC));
  t('status is NOT insertable from a client',
    !/grant insert \([^)]*\bstatus\b[^)]*\) on public\.questions/i.test(SQLC));
  t('no legacy column is writable from a client',
    !/grant (insert|update) \([^)]*\b(name|topic|question|email|is_answered|is_published)\b/i.test(SQLC));
  t('soft-delete columns are not client-writable',
    !/grant (insert|update) \([^)]*\b(deleted_at|deleted_by|delete_reason)\b/i.test(SQLC));
  t('table SELECT is the only table-level grant on questions',
    /grant select on public\.questions to authenticated/i.test(SQLC));

  t('replies: INSERT is column-scoped',
    /grant insert \(question_id, author_id, author_role, message\)\s*on public\.question_replies to authenticated/i.test(SQLC));
  t('replies: created_at is server-owned',
    !/grant insert \([^)]*created_at/i.test(SQLC));
  t('replies: no UPDATE, no DELETE for anyone',
    /revoke update, delete on public\.question_replies from anon, authenticated/i.test(SQLC));
  t('questions: no DELETE for anyone',
    /revoke delete\s+on public\.questions\s+from anon, authenticated/i.test(SQLC));
  t('no grant to anon anywhere in the file',
    !/\bgrant\b[^;]*\bto\b[^;]*\banon\b/i.test(SQLC));

  console.log('\n   A PATIENT CANNOT PRE-ANSWER THEIR OWN QUESTION');
  const qip = pol.find(p => p.name === 'q_insert_patient');
  t('q_insert_patient requires status = new',   /status\s*=\s*'new'/.test(qip.check), qip.check.trim().slice(0,80));
  const chk = compile(qip.check);
  for (const bad of ['answered', 'closed', 'under_review']) {
    t('...so status=' + bad + ' is refused',
      !chk(WHO.patientA, { patient_id:UID.A, status:bad }), bad);
  }
  const good = { patient_id:UID.A, status:'new', subject:'Medications', message:'A real question.' };
  t('...and status=new is accepted',            chk(WHO.patientA, good));
  t('a null status is refused',                !chk(WHO.patientA, Object.assign({}, good, { status:null })));

  console.log('\n   AND IT MUST CONTAIN SOMETHING');
  for (const [label, row] of [
    ['a null subject',      { subject:null }],
    ['a blank subject',     { subject:'   ' }],
    ['an empty subject',    { subject:'' }],
    ['a null message',      { message:null }],
    ['a blank message',     { message:'\n\t  ' }],
    ['an empty message',    { message:'' }],
    ['a 201-char subject',  { subject:'x'.repeat(201) }],
    ['a 5001-char message', { message:'x'.repeat(5001) }]
  ]) {
    t('the policy refuses ' + label, !chk(WHO.patientA, Object.assign({}, good, row)), label);
  }
  t('a 200-char subject is still fine',  chk(WHO.patientA, Object.assign({}, good, { subject:'x'.repeat(200) })));
  t('a 5000-char message is still fine', chk(WHO.patientA, Object.assign({}, good, { message:'x'.repeat(5000) })));

  console.log('\n   STATUS IS A COLUMN INVARIANT, NOT A CONVENTION');
  t('status is NOT NULL',
    /alter table public\.questions alter column status set not null/i.test(SQL));
  t('...with DEFAULT new',
    /alter table public\.questions alter column status set default 'new'/i.test(SQL));
  t('...backfilled before the constraint, so the apply cannot fail',
    SQL.indexOf("update public.questions set status = 'new' where status is null") <
    SQL.indexOf('alter column status set not null'));
  t('the CHECK no longer permits NULL',
    /check \(status in \('new','under_review','answered','closed'\)\)/.test(SQLONLY) &&
    !/check \(status is null or status in/.test(SQLONLY));
  t('only the four canonical values are accepted',
    (SQLONLY.match(/check \(status in \('new','under_review','answered','closed'\)\)/g) || []).length === 1);
  /* A clinician cannot null it either: the column refuses, before any policy
     is consulted. That is stronger than a policy clause and needs no policy. */
  t('a clinician cannot update status to null — the column forbids it',
    /alter column status set not null/i.test(SQL));
  t('the content rule is a table constraint too, not only a policy',
    /constraint questions_content_check[\s\S]{0,400}char_length\(subject\) <= 200/i.test(SQL));
  t('...and it exempts legacy rows that have no owner',
    /patient_id is null\s*--/.test(SQL) || /patient_id is null/.test(SQL));

  console.log('\n   AUTHOR ROLE CANNOT BE FORGED');
  const ric = compile(pol.find(p => p.name === 'r_insert_clinician').check);
  const reply = (who, role) => ({ author_id: who.uid, author_role: role, parentOwner: UID.A });
  t('a verified doctor may sign as doctor',      ric(WHO.verifiedDr, reply(WHO.verifiedDr, 'doctor')));
  t('...but not as admin',                      !ric(WHO.verifiedDr, reply(WHO.verifiedDr, 'admin')));
  t('...and not as patient',                    !ric(WHO.verifiedDr, reply(WHO.verifiedDr, 'patient')));
  t('an admin may sign as admin',                ric(WHO.admin, reply(WHO.admin, 'admin')));
  t('...but not as doctor',                     !ric(WHO.admin, reply(WHO.admin, 'doctor')));
  t('a patient cannot sign as doctor',          !ric(WHO.patientA, reply(WHO.patientA, 'doctor')));
  t('a patient cannot sign as admin',           !ric(WHO.patientA, reply(WHO.patientA, 'admin')));
  t('a pending doctor cannot sign as anything',
    ['doctor','admin','patient'].every(r => !ric(WHO.pendingDr, reply(WHO.pendingDr, r))));
  t('a clinician cannot forge another author_id',
    !ric(WHO.verifiedDr, { author_id: UID.AD, author_role:'doctor', parentOwner:UID.A }));

  console.log('\n   THE SENDER-LABEL RPC');
  const fn = (SQLONLY.match(/create or replace function public\.get_question_sender_labels\(\)[\s\S]*?\$\$;/) || [''])[0];
  t('the function exists',                       fn.length > 200);
  t('it is SECURITY DEFINER',                    /security definer/i.test(fn));
  t('it pins search_path',                       /set search_path = public, pg_temp/i.test(fn));
  t('it takes no arguments',                     /get_question_sender_labels\(\)/.test(fn));
  t('it authorises itself, verified staff only',
    /if not \(public\.is_verified_doctor\(\) or public\.is_platform_admin\(\)\) then/i.test(fn));
  t('it raises rather than returning empty',     /raise exception[\s\S]{0,120}42501/i.test(fn));
  t('it returns two columns only',               /returns table \(patient_id uuid, label text\)/i.test(fn));
  t('it exposes no contact or clinical field',
    !/\b(email|phone|country|hospital|specialty|date_of_birth|dob|address|verification_status|is_admin|role)\b/i
      .test(fn.replace(/p\.role = 'patient'/g, ' ').replace(/split_part\(coalesce\(p\.email, ''\), '@', 1\)/g, ' ')),
    (fn.match(/\b(phone|country|hospital|specialty|address|dob)\b/i) || [])[0]);
  /* NO EMAIL IN ANY FORM. An earlier draft fell back to the local part when
     full_name was blank; a local part identifies a person as readily as the
     whole address, and this function's justification is that it returns no
     contact detail at all. */
  t('the email is not referenced anywhere in the body', !/p\.email/.test(fn));
  t('no split_part / local-part derivation survives', !/split_part/i.test(fn));
  t('a blank name yields a blank label',
    /coalesce\(nullif\(btrim\(p\.full_name\), ''\), ''\)/.test(fn));
  t('the inbox degrades to "Patient account"', /'Patient account'/.test(QP));
  t('it covers only patients who own a question',
    /where p\.role = 'patient'[\s\S]{0,200}exists \([\s\S]{0,200}q\.patient_id = p\.id/i.test(fn));
  t('it is revoked from PUBLIC and anon',
    /revoke all on function public\.get_question_sender_labels\(\) from public, anon/i.test(SQL));
  t('...and granted only to authenticated',
    /grant execute on function public\.get_question_sender_labels\(\) to authenticated/i.test(SQL));
  /* The three identities it must refuse, read off its own guard clause. */
  const rpcOk = who => who.verifiedDoctor || who.admin;
  t('a pending doctor is refused',              !rpcOk(WHO.pendingDr));
  t('a patient is refused',                     !rpcOk(WHO.patientA));
  t('anon is refused',                          !rpcOk(WHO.anon));
  t('a verified doctor is admitted',             rpcOk(WHO.verifiedDr));
  t('an admin is admitted',                      rpcOk(WHO.admin));

  console.log('\n   SHAPE');
  t('legacy `question` loses NOT NULL',
    /alter table public\.questions alter column question drop not null/i.test(SQL));
  t('no legacy column is dropped',        !/alter table public\.questions drop column/i.test(SQL));
  t('question_replies is created',        /create table if not exists public\.question_replies/i.test(SQL));
  t('the status CHECK lists the four values, and not NULL',
    /check \(status in \('new','under_review','answered','closed'\)\)/i.test(SQLONLY));
  t('updated_at has a trigger',           /create trigger trg_questions_updated_at/i.test(SQL));
  /* IT WRITES ONCE, AND ONLY ONCE. Making status NOT NULL requires that no
     row holds NULL, so the backfill runs first. It is idempotent, it touches
     only the column being constrained, and it is the single DML statement in
     the file — which is the assertion, rather than the weaker claim that
     there is none. */
  const dml = (SQLONLY.match(/\b(insert into|update public\.\w+ set|delete from)\b[^;]*/gi) || [])
    .map(x => x.replace(/\s+/g, ' ').trim());
  t('the only data written is the status backfill',
    dml.length === 1 && /^update public\.questions set status = 'new' where status is null$/i.test(dml[0]), dml);
  t('it runs before the NOT NULL it exists for',
    SQLONLY.indexOf("update public.questions set status") <
    SQLONLY.indexOf('alter column status set not null'));
  t('nothing is inserted or deleted',
    !/\binsert into\b|\bdelete from\b/i.test(SQLONLY));
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
  /* ONE ENTRY. The first draft listed seven plausible public pages; only
     /ask.html has a caller, and an entry with no caller is reachable only by
     something that should not be writing this key. */
  t('the allowlist contains exactly /ask.html',
    /var AUTH_RETURN_ALLOW = \['\/ask\.html'\];/.test(AUTH),
    (AUTH.match(/var AUTH_RETURN_ALLOW = \[[^\]]*\]/) || [''])[0]);
  t('...and /ask.html is the only page that calls setAuthReturnTo',
    execSync('git -C ' + REPO + ' grep -l "setAuthReturnTo(" -- "*.html" || true', { encoding:'utf8' })
      .split('\n').filter(Boolean).join() === 'ask.html');
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
  t('subject and message carry the question',
    pay.subject === 'Fasting and preparation' && pay.message === 'Will I be awake for a spinal?', pay);
  /* THREE KEYS, NOT FOUR. status is no longer insertable — v9_7 grants INSERT
     on (patient_id, subject, message) only, so the column takes DEFAULT 'new'
     and a patient cannot submit a question pre-marked answered. */
  t('exactly the three insertable columns',
    JSON.stringify(Object.keys(pay).sort()) === JSON.stringify(['message','patient_id','subject']), Object.keys(pay));
  t('status is not sent by the client',      !('status' in pay), Object.keys(pay));
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
        /* The mock's own SESSION_UID: getProfile() only resolves that id, and a
           mismatch made resolveAuthDestination() see no profile, read the role as
           'pending', and route to the chooser — a harness artefact that looked
           exactly like a broken return-to. */
        var E2E_USER = { id:'9e000000-0000-4000-8000-00000000cafe', email:'p@e.com' };
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

  /* ══ 5b · WHO SEES A FORM THE DATABASE WILL ACCEPT ══════════════════════ */
  /* askSetState() treated any session as eligible. q_insert_patient admits
     only role='patient', so a doctor or an administrator was being offered a
     form the database would refuse — the worst kind of control, because they
     write the question before finding out. */
  console.log('\n5b · The form appears only for a patient');
  for (const [who, prof, wantForm, wantGate, wantClin] of [
    ['guest',           null,  false, true,  false],
    ['patient',         PATIENT, true,  false, false],
    ['pending account', { email:'new@g.com', role:'pending', verification_status:'not_required', is_admin:false }, false, true, false],
    ['verified doctor', VDOC,  false, false, true],
    ['admin',           ADMIN, false, false, true]
  ]) {
    const s2 = await open(b, '/ask.html', prof === null ? 'window.__TEST_ROLE="anon";' : asProfile(prof));
    const st = await s2.pg.evaluate(`(() => {
      const h = id => { const n = document.getElementById(id); return n ? !n.hidden : null; };
      return { url:location.pathname, form:h('ask-form'), gate:h('ask-gate'), clin:h('ask-clin'),
               faq:document.querySelectorAll('.faq-item').length,
               submit:!!(document.getElementById('ask-btn') || {}).offsetParent }; })()`);
    await s2.ctx.close();
    t(who + ': stays on the public page',   st.url === '/ask.html' && st.faq === 10, st.url);
    t(who + ': submission form ' + (wantForm ? 'shown' : 'hidden'), st.form === wantForm, st);
    t(who + ': account gate ' + (wantGate ? 'shown' : 'hidden'),    st.gate === wantGate, st);
    t(who + ': clinician note ' + (wantClin ? 'shown' : 'hidden'),  st.clin === wantClin, st);
    if (!wantForm) t(who + ': no submit control at all', st.submit === false, st.submit);
  }
  {
    const s3 = await open(b, '/ask.html', asProfile(VDOC));
    const link = await s3.pg.evaluate(`(() => { const a = document.querySelector('#ask-clin a');
      return a ? { href:a.getAttribute('href'), text:a.textContent.trim() } : null; })()`);
    await s3.ctx.close();
    t('a clinician is pointed at their inbox instead',
      !!link && link.href === '/questions.html', link);
  }

  /* ══ 5c · A NEW DOCTOR DOES NOT INHERIT THE ASK BREADCRUMB ══════════════ */
  /* Ask stores anestheo.auth.returnTo=/ask.html before opening the modal. The
     patient path consumes it, because submitPatient() goes through
     resolveAuthDestination(). submitDoctor() navigates straight to the
     workspace, so without an explicit clear the key survived and the next
     thing to resolve a destination in that tab would have sent a brand-new
     doctor to the patient Ask form. */
  console.log('\n5c · Choosing Doctor clears the Ask breadcrumb');
  t('all three doctor exits clear it',
    (code(fs.readFileSync(REPO + '/role-select.html','utf8'))
      .match(/clearAuthReturnTo\(\)/g) || []).length === 3);
  t('the legacy fallback path clears it too',
    /clearAuthReturnTo\(\);\s*window\.location\.replace\('\/doctor-pending\.html'\)/.test(
      code(fs.readFileSync(REPO + '/role-select.html','utf8'))));
  t('the patient path still lets the resolver consume it',
    !/clearAuthReturnTo[\s\S]{0,200}submitPatient/.test(code(fs.readFileSync(REPO + '/role-select.html','utf8'))));
  {
    /* The journey, in a browser: a session with no role lands on the chooser
       carrying the breadcrumb, picks Doctor, and arrives at the workspace with
       the key gone. */
    const boot = `
      window.__TEST_PROFILE = ${JSON.stringify({ email:'new@g.com', role:'pending', verification_status:'not_required', is_admin:false })};
      /* SET ONCE. addInitScript runs on EVERY navigation, so seeding the
         breadcrumb unconditionally re-created it after the doctor path had
         correctly cleared it — the harness rewriting the very key it was
         checking. The flag makes it a starting condition rather than an
         invariant. */
      try { if(!sessionStorage.getItem('e2e.seeded')){
              sessionStorage.setItem('anestheo.auth.returnTo', '/ask.html');
              sessionStorage.setItem('e2e.seeded', '1'); } } catch(e){}
      /* create_doctor_account() is not modelled by the shared mock, so
         submitDoctor() otherwise takes its LEGACY branch and stops at the
         practice form — the direct exit never runs and the test reports a
         missing clear that is its own doing. Stubbed to the success the RPC
         returns in production; the legacy branch's two exits are asserted
         statically just above. */
      window.addEventListener('DOMContentLoaded', function(){
        window.createDoctorAccount = function(){
          return Promise.resolve({ ok:true, legacy:false, data:{ ok:true } });
        };
      });`;
    /* The mock profile stays role='pending', so /dashboard.html bounces this
       account back to the chooser via requireRole('staff'). That is correct
       product behaviour for a profile the mock never updates; what is being
       tested is the breadcrumb, and it must be gone either way. */
    const rs = await open(b, '/role-select.html', boot);
    const before = await rs.pg.evaluate(`sessionStorage.getItem('anestheo.auth.returnTo')`);
    t('the chooser opens still carrying it', before === '/ask.html', before);
    /* The real controls, in the real order: pick the Doctor card, give the
       name the step requires, submit. An earlier version clicked the first
       thing matching /doctor/i and never reached submitDoctor(), so the clear
       never ran and the test reported a bug that was its own. */
    await rs.pg.click('#ro-doctor');
    await rs.pg.waitForTimeout(500);
    await rs.pg.fill('#d-name', 'Dana Levi');
    await rs.pg.click('#d-submit');
    await rs.pg.waitForTimeout(2500);
    const after = await rs.pg.evaluate(`(() => { try { return sessionStorage.getItem('anestheo.auth.returnTo'); }
      catch(e){ return 'unreadable'; } })()`);
    const where = new URL(rs.pg.url()).pathname;
    await rs.ctx.close();
    t('choosing Doctor leaves no Ask breadcrumb', after === null, after);
    t('...and nothing sent them to the patient Ask form',
      where !== '/ask.html', where);
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
  t('names come from the keyhole RPC, not a profiles SELECT',
    /rpc\('get_question_sender_labels'\)/.test(QP) && !/from\('profiles'\)/.test(QP));
  t('a missing label degrades to "Patient account", not an error',
    /console\.warn\('sender labels unavailable/.test(QP) && /'Patient account'/.test(QP));
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
  /* It IS edited now — three labels that promised destinations which do not
     exist. Everything else about the file is unchanged, which is the claim. */
  /* Checked on CODE: each replacement is explained in a comment that quotes
     the label it replaced, so a raw match finds the explanation. */
  const PDC = code(PD);
  /* SCOPED TO renderQuestions(). A whole-file match for "View summary" hits an
     unrelated, working control: the questionnaire summary button at the top of
     My Space, which has a real pdSummary() handler. Only the consultations
     renderer changed, so only it is inspected. */
  const RQ = PDC.slice(PDC.indexOf('function renderQuestions'),
                       PDC.indexOf('function renderQuestions') + 2600);
  t('My Space no longer offers "Continue conversation"', !/Continue conversation/.test(RQ));
  t('...it says what the link does',        /Ask another question/.test(RQ));
  t('the phantom "View summary" is gone from consultations', !/View summary/.test(RQ));
  t('the questionnaire summary button is untouched',
    /onclick="pdSummary\(\)">View summary/.test(PDC));
  t('the phantom Edit/View pair is gone',   !/' Edit<\/a>/.test(RQ));
  t('the reply itself still renders',       /rep\[rep\.length-1\]\.message/.test(RQ));
  /* THE DIFF IS THREE `acts = …` ASSIGNMENTS AND NOTHING ELSE. A character
     window around renderQuestions() was the wrong instrument — comments shift
     offsets between the two versions, so it compared misaligned text. Blanking
     every acts assignment and requiring the rest to match says precisely what
     the change is: which action links are emitted, and only that. */
  t('the only change is which action links are emitted',
    (() => { const norm = x => code(x).replace(/acts = [^;]*;/g, 'ACTS;').replace(/\s+/g, ' ');
      return norm(PD) === norm(onMain('patient-dashboard.html')); })());
  t('...and there are exactly three of them',
    (code(PD).match(/acts = [^;]*;/g) || []).length ===
    (code(onMain('patient-dashboard.html')).match(/acts = [^;]*;/g) || []).length,
    (code(PD).match(/acts = [^;]*;/g) || []).length);

  /* ══ 8 · SCOPE ══════════════════════════════════════════════════════════ */
  console.log('\n8 · What else moved');
  /* Tracked changes AND untracked additions. The migration is a new file, so
     `git diff` alone reports it as nothing at all — which made "the migration
     is the only SQL added" pass vacuously against an empty list. */
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean)
    .concat(execSync('git -C ' + REPO + ' ls-files --others --exclude-standard', { encoding:'utf8' })
      .split('\n').filter(Boolean));
  /* THIS HAS NOW GONE STALE TWICE, and the second time is the instructive one.

     v1 said "the migration is the only SQL added" — vacuous once v9_7 merged.
     v2 said no SQL file may appear in the diff at all, which held right up
     until an unrelated branch added v4_4_lifecycle_browser_grants_repair.sql
     to fix the doctor's patient card. That is ordinary practice, and this
     suite has no standing to forbid it: a diff against main shows whatever
     else is in flight, so reading it turns a feature suite into a veto on the
     rest of the repository.

     The real rule is narrower and permanent. A migration that production has
     already run is history: editing it is the sin, because the database will
     never see the edit. Adding a NEW file is how corrections are made — v4_4
     exists precisely because it refused to rewrite v4_3. So this now asks
     git for MODIFIED migrations only (--diff-filter=M), which lets new ones
     through and still catches a rewrite of anything already applied. */
  const modifiedSql = execSync(
    'git -C ' + REPO + ' diff --name-only --diff-filter=M ' + MAIN + ' -- "*.sql"',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  t('no already-applied migration was rewritten', modifiedSql.length === 0, modifiedSql);
  t('the file it applied is still here',
    fs.existsSync(REPO + '/v9_7_questions_portal.sql'));
  t('...unchanged since it was applied',
    SQL === onMain('v9_7_questions_portal.sql'));
  t('...including its policy and grant blocks',
    !modifiedSql.includes('v9_7_questions_portal.sql'));
  t('v2_ask_migration.sql is untouched',  !changed.includes('v2_ask_migration.sql'));
  t('navbar.js is untouched',             !changed.includes('navbar.js'));
  t('supabase.js is untouched',           !changed.includes('supabase.js'));
  /* It changed — three labels. The invariant is that its DATA path did not. */
  t('My Space still reads only the patient\'s own questions',
    /from\('questions'\)\.select\('\*'\)\.eq\('patient_id', _uid\)/.test(PD));
  t('My Space adds no write of any kind',
    (PD.match(/from\('question_replies'\)\.[a-z]+/g) || []).join() ===
    (onMain('patient-dashboard.html').match(/from\('question_replies'\)\.[a-z]+/g) || []).join());
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
