#!/usr/bin/env node
/* doctor-card-actions.test.js
 *
 * Two unrelated bugs on the doctor's patient card, and the invariants that
 * keep them fixed.
 *
 * ONE — the three-dot menu printed
 *
 *     permission denied for function patient_lifecycle_eligibility
 *
 * straight into the UI, and Mark as Important, Archive and Delete were dead.
 * The cause was a GRANT drift in production, not a bug in this code: five
 * browser RPCs had lost EXECUTE for authenticated. That is repaired by a
 * migration (asserted here as text, since nothing in this repo may apply SQL),
 * but the UI half is a real defect in its own right — a doctor should never
 * read a Postgres error, whatever the database is doing. Section 3 proves the
 * raw string cannot reach the screen through EITHER of the two routes it used.
 *
 * TWO — Email did nothing while WhatsApp worked. Section 5 pins the mechanism
 * rather than the symptom: window.open() is only reliable for http(s), and for
 * a mailto: it returns a TRUTHY window pointed at about:blank, which is why the
 * `if(!win) location.href = url` fallback was unreachable dead code. The test
 * measures that in the same browser the product runs in, so if a future
 * Chromium changes the behaviour this says so instead of quietly passing.
 *
 * What this file may NOT do is prove the production grant state. It has no
 * database. Everything about grants is asserted against the migration TEXT,
 * and the report says so plainly.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 150);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
/* Comments are not the product. This repo has repeatedly written an assertion
   that passed because it matched the note explaining it. */
const code   = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const sqlOnly = s => s.replace(/^\s*--[^\n]*$/gm, ' ');

const MIG  = 'v4_4_lifecycle_browser_grants_repair.sql';
const SQL  = read(MIG);
const SQLC = sqlOnly(SQL);
const LC   = read('patient-lifecycle.js');
const LCC  = code(LC);
const DASH = read('dashboard.html');
const DASHC = code(DASH);

/* v4_3 section 5 is the documented statement of what the browser may invoke.
   These lists are read FROM v4_3 rather than retyped, so if that file's intent
   ever changes this suite disagrees instead of enforcing a stale copy. */
const V43 = read('v4_3_function_hardening.sql');
/* Pull the QUOTED entries out, rather than splitting on commas: every
   signature in these arrays contains commas of its own —
   'patient_lifecycle_eligibility(text,uuid,text)' — and a naive split turned
   eight functions into nineteen fragments. */
function arrayAfter(src, marker) {
  const i = src.indexOf(marker);
  const m = src.slice(i).match(/ARRAY\s*\[([\s\S]*?)\]\s*LOOP/);
  return m ? (m[1].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, '')) : [];
}
const INTENDED_GRANT  = arrayAfter(V43, 'The browser genuinely calls these');
const INTENDED_REVOKE = arrayAfter(V43, 'Internal only.');

const DOCTOR = { email:'d@e.com', role:'doctor', verification_status:'approved', is_admin:false, full_name:'Dr Dana Levi' };

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

/* The modules under test, loaded standalone. patient-lifecycle.js is a plain
   IIFE over a global, so it can be exercised directly against a stub client
   without the dashboard around it. */
async function lifecyclePage(b, stub) {
  const ctx = await b.newContext();
  const pg = await ctx.newPage();
  await pg.goto('about:blank');
  await pg.evaluate(stub || 'window.sb = null;');
  await pg.addScriptTag({ content: LC });
  return { ctx, pg };
}

const RAW_PG = 'permission denied for function patient_lifecycle_eligibility';

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ══ 1 · the migration grants exactly the intended set ═══════════════════ */
  console.log('\n1 · Migration — only the documented browser RPCs');
  t('the repair migration exists', fs.existsSync(REPO + '/' + MIG), MIG);
  t('v4_3 names 8 browser-facing RPCs', INTENDED_GRANT.length === 8, INTENDED_GRANT);
  t('v4_3 names 6 internal helpers',    INTENDED_REVOKE.length === 6, INTENDED_REVOKE);

  /* Every function the migration hands to authenticated, read out of the SQL
     rather than assumed from the prose above it. */
  const grantBlock = (SQLC.match(/\$grants\$[\s\S]*?\$grants\$/g) || []).join('\n');
  const granted = (grantBlock.match(/'([a-z_]+\([^)]*\))'/g) || []).map(s => s.replace(/'/g, ''));
  t('the migration grants exactly v4_3\'s keep list',
    JSON.stringify(granted.slice().sort()) === JSON.stringify(INTENDED_GRANT.slice().sort()), granted);
  for (const fn of ['patient_lifecycle_eligibility(text,uuid,text)',
                    'patient_lifecycle_action(text,uuid,text,text)',
                    'patient_set_starred(text,uuid,boolean)',
                    'patient_purge_eligibility(text,uuid)',
                    'patient_purge(text,uuid,text)'])
    t('the five broken RPCs include ' + fn.split('(')[0], granted.includes(fn), fn);
  t('recycle_bin_list is kept, not dropped', granted.includes('recycle_bin_list()'));

  /* 2. anon stays revoked. Every GRANT in the file is to authenticated only. */
  /* The grantee is what matters, not the whole line: every line here contains
     the literal "public." as part of the function's schema-qualified name, so
     a blanket /PUBLIC/i test on the line flagged its own subject. Read the
     text AFTER "TO" instead. */
  const grantLines = SQLC.split('\n').filter(l => /GRANT\s+EXECUTE/i.test(l));
  const grantees = grantLines.map(l => (l.match(/\bTO\s+([a-z_, ]+)/i) || [,''])[1].trim().replace(/'.*$/, '').trim());
  t('every GRANT EXECUTE targets authenticated only',
    grantLines.length > 0 && grantees.every(g => g === 'authenticated'), grantees);
  t('anon is revoked alongside every grant',
    /REVOKE ALL ON FUNCTION[^\n]*FROM PUBLIC, anon/i.test(grantBlock));
  t('the migration verifies anon cannot execute them',
    /has_function_privilege\('anon'/.test(SQLC) && /anon can execute/i.test(SQL));

  /* 3. internal helpers stay revoked — and are never granted anywhere. */
  const internalBlock = (SQLC.match(/\$internal\$[\s\S]*?\$internal\$/g) || []).join('\n');
  const revoked = (internalBlock.match(/'([a-z_]+\([^)]*\))'/g) || []).map(s => s.replace(/'/g, ''));
  t('the migration re-revokes exactly v4_3\'s internal list',
    JSON.stringify(revoked.slice().sort()) === JSON.stringify(INTENDED_REVOKE.slice().sort()), revoked);
  for (const fn of INTENDED_REVOKE) {
    t('never granted: ' + fn.split('(')[0], !granted.includes(fn), fn);
    t('kept internal: ' + fn.split('(')[0],
      new RegExp("'" + fn.replace(/[()]/g, '\\$&') + "'").test(internalBlock), fn);
  }
  t('patient_record_readable is not handed to the browser',   !granted.includes('patient_record_readable(text,uuid)'));
  t('patient_purge_dependencies is not handed to the browser',!granted.includes('patient_purge_dependencies(text,uuid)'));
  t('care_request_visible stays internal',                    !granted.includes('care_request_visible(uuid)'));

  /* 4. it changes privileges and nothing else. */
  t('no function body is redefined', !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(SQLC), 'no CREATE FUNCTION');
  for (const kw of ['DROP FUNCTION', 'CREATE POLICY', 'DROP POLICY', 'ALTER POLICY',
                    'ALTER TABLE', 'CREATE TABLE', 'DELETE FROM', 'UPDATE public.', 'INSERT INTO'])
    t('no ' + kw, !new RegExp(kw.replace(/[.]/g,'\\.'), 'i').test(SQLC));
  t('no table-level grant', !/GRANT[^\n]*ON\s+(TABLE\s+)?public\.[a-z_]+\s+TO/i.test(SQLC));
  t('it is transaction-wrapped', /^\s*BEGIN;/m.test(SQLC) && /^\s*COMMIT;/m.test(SQLC));
  t('it aborts rather than committing a wrong end state',
    /RAISE EXCEPTION 'VERIFY FAILED/.test(SQLC));
  t('it proves the soft-delete lockdown still holds',
    /has_table_privilege\('authenticated','public\.clinic_patients','DELETE'\)/.test(SQLC));
  t('it is marked NOT APPLIED', /NOT APPLIED/.test(SQL));
  t('it does not edit a historical migration',
    ['v4_patient_lifecycle.sql','v4_1_purge_safety.sql','v4_2_delete_lockdown.sql','v4_3_function_hardening.sql']
      .every(f => fs.existsSync(REPO + '/' + f)));

  /* ══ 2 · the client calls what the migration grants ══════════════════════ */
  console.log('\n2 · Client RPC surface matches the grant list');
  const clientRpcs = new Set();
  for (const f of ['patient-lifecycle.js', 'clinical-open.js', 'dashboard.html', 'admin.html']) {
    const src = code(read(f));
    (src.match(/rpc\(\s*['"]([a-z_]+)['"]/g) || []).forEach(m => clientRpcs.add(m.replace(/.*['"]([a-z_]+)['"]/, '$1')));
    (src.match(/visible:\s*['"]([a-z_]+)['"]/g) || []).forEach(m => clientRpcs.add(m.replace(/.*['"]([a-z_]+)['"]/, '$1')));
  }
  const grantedNames = granted.map(g => g.split('(')[0]);
  for (const name of ['patient_lifecycle_eligibility','patient_lifecycle_action','patient_set_starred',
                      'patient_purge_eligibility','patient_purge','recycle_bin_list',
                      'journey_visible','clinic_patient_visible'])
    t('client calls ' + name + ', and it is granted',
      clientRpcs.has(name) && grantedNames.includes(name), { called:clientRpcs.has(name) });
  for (const name of INTENDED_REVOKE.map(f => f.split('(')[0]))
    t('client never calls internal ' + name, !clientRpcs.has(name));

  /* ══ 3 · a raw Postgres error can never reach the doctor ═════════════════ */
  console.log('\n3 · Raw server errors never render');

  /* Route A — the RPC resolves with {code:'rpc_error', reason:<raw>}, which is
     what patient-lifecycle.js's own .catch() produces for a missing GRANT. */
  {
    const { ctx, pg } = await lifecyclePage(b, `window.sb = { rpc: function(){
      return Promise.resolve({ data:null, error:{ message: ${JSON.stringify(RAW_PG)} } }); } };`);
    const out = await pg.evaluate(`(async () => {
      const e = await window.PatientLifecycle.eligibility('clinic_patient','11111111-1111-4111-8111-111111111111','archive');
      const r = window.PatientLifecycle.refusal(e, 'That action was refused.');
      return { code:e.code, rawReason:e.reason, text:r.text, technical:r.technical, tone:r.tone };
    })()`);
    await ctx.close();
    t('the transport failure is still classified rpc_error', out.code === 'rpc_error', out.code);
    t('the raw message still reaches the module', out.rawReason === RAW_PG);
    t('refusal() does NOT put it on screen', out.text.indexOf('permission denied') < 0, out.text);
    t('...it shows one human sentence', /try again/i.test(out.text), out.text);
    t('...and never says "refused" about a technical failure',
      !/refus/i.test(out.text), out.text);
    t('the raw text is preserved for debugging as .technical', out.technical === RAW_PG);
  }

  /* Route B — the same defence, for every message shape a broken RPC produces. */
  {
    const { ctx, pg } = await lifecyclePage(b, 'window.sb = null;');
    const out = await pg.evaluate(`(() => {
      const raws = [
        'permission denied for function patient_lifecycle_eligibility',
        'permission denied for function patient_set_starred',
        'function public.patient_purge(text,uuid,text) does not exist',
        'new row violates row-level security policy for table "clinic_patients"',
        'JWT expired', 'TypeError: Failed to fetch', 'PGRST202'
      ];
      return raws.map(r => window.PatientLifecycle.refusal({ok:false, code:'rpc_error', reason:r}).text);
    })()`);
    await ctx.close();
    const leaked = out.filter(x => /permission denied|does not exist|row-level security|PGRST|JWT|TypeError/i.test(x));
    t('no transport message of any shape is rendered', leaked.length === 0, leaked);
    t('all collapse to the same human sentence', new Set(out).size === 1, out[0]);
  }

  /* Route C — the dashboard's own catch(), which printed err.message directly.
     Asserted on stripped source: the old string must be gone from the CODE,
     not merely absent from a comment about it. */
  /* Scoped to the eligibility catch block. A first draft banned "+ why"
     anywhere in the file and failed on the Recycle Bin, which has its own
     unrelated `why` holding a delete reason — a real human reason that SHOULD
     be rendered. Ban the leak, not the variable name. */
  const catchBlock = (DASHC.match(/\}\s*catch\(err\)\{[\s\S]*?\n\s*return;\s*\n\s*\}/) || [''])[0];
  t('the eligibility catch block exists', catchBlock.length > 0);
  t('it no longer concatenates the server message into the menu',
    !/\+\s*(why|err|e)\b/.test(catchBlock) && !/err\.(message|hint|details)/.test(catchBlock.replace(/console\.error[^\n]*/g,'')),
    (catchBlock.match(/textContent[^\n]*/) || [''])[0].trim());
  t('it shows the one human sentence instead',
    /Could not check this action right now\. Please try again\./.test(catchBlock));
  t('the Recycle Bin still shows its real delete reason',
    /ws-bin-why[\s\S]{0,80}wsEsc\(r\.delete_reason\)/.test(DASHC), 'clinical reasons untouched');
  t('dashboard logs the technical detail to the console instead',
    /console\.error\('\[dashboard\] eligibility failed'/.test(DASHC));
  t('no UI string in dashboard interpolates err.message',
    !/textContent\s*=\s*[^;]*\b(err|e)\.(message|hint|details)/.test(DASHC));

  /* ══ 4 · genuine clinical refusals are NOT collapsed ═════════════════════ */
  console.log('\n4 · Real reasons survive');
  {
    const { ctx, pg } = await lifecyclePage(b, 'window.sb = null;');
    const out = await pg.evaluate(`(() => {
      const cases = [
        ['clinical_blocker','A consultation request is still open for this patient. Resolve it first.'],
        ['already_archived','This record is already archived.'],
        ['already_deleted','This record is already in the Recycle Bin.'],
        ['not_authorized','This record is not available to you. It may belong to another clinician, or it may no longer exist.'],
        ['record_not_found','That record no longer exists.'],
        ['retained_clinical_record','A signed anesthesia record is retained for this patient.'],
        ['not_archived','This record is not archived.']
      ];
      return cases.map(([code, reason]) => {
        const r = window.PatientLifecycle.refusal({ok:false, eligible:false, code:code, reason:reason},
                                                  'That action was refused.');
        return { code:code, kept: r.text === reason, tone:r.tone, technical:r.technical, text:r.text };
      });
    })()`);
    await ctx.close();
    for (const c of out) {
      t(c.code + ': the server\'s own sentence is shown verbatim', c.kept === true, c.text);
      t(c.code + ': not tagged as a technical failure', c.technical === null);
    }
    t('a clinical blocker is toned as a block',
      (out.find(x => x.code === 'clinical_blocker') || {}).tone === 'block');
    t('"already archived" is a state, not an error',
      (out.find(x => x.code === 'already_archived') || {}).tone === 'state');
    t('authorization keeps its own tone',
      (out.find(x => x.code === 'not_authorized') || {}).tone === 'auth');
  }

  /* ══ 5 · Email — the measured root cause, and the fix ════════════════════ */
  console.log('\n5 · Email');

  /* THE MECHANISM. Not asserted from documentation — run in the browser the
     product actually ships against. */
  {
    const ctx = await b.newContext();
    const pg = await ctx.newPage();
    const opened = [];
    ctx.on('page', p => opened.push(p.url()));
    await pg.goto('data:text/html,<body></body>');
    const probe = await pg.evaluate(`(() => {
      const w = window.open('mailto:a@b.com?subject=x','_blank');
      let href = null; try { href = w ? w.location.href : null; } catch(e){ href = 'cross-origin'; }
      return { truthy: !!w, href: href };
    })()`);
    await pg.waitForTimeout(600);
    await ctx.close();
    t('window.open(mailto) returns a TRUTHY window', probe.truthy === true, probe);
    t('...pointed at about:blank, not the mail handler', probe.href === 'about:blank', probe.href);
    t('...so "if(!win) location.href=url" was unreachable', probe.truthy === true);
  }

  /* THE FIX, read from the shipped source. */
  const emailFn = (DASH.match(/async function wsSendEmail\(id\)\{[\s\S]*?\n\}/) || [''])[0];
  const emailFnC = code(emailFn);
  t('wsSendEmail exists', emailFn.length > 0);
  t('it no longer uses window.open', !/window\.open/.test(emailFnC), emailFnC.match(/window\.open[^\n]*/) || 'none');
  t('it hands the mailto to the OS via location.href',
    /window\.location\.href\s*=\s*url/.test(emailFnC));
  t('the address is NOT percent-encoded',
    !/encodeURIComponent\(\s*(p\.email|to)/.test(emailFnC) && /'mailto:'\s*\+\s*to/.test(emailFnC));
  t('the subject is encoded', /encodeURIComponent\('Your pre-anaesthesia questionnaire'\)/.test(emailFnC));
  t('the body is encoded',    /'&body='\s*\+\s*encodeURIComponent\(wsMessage\(p\)\)/.test(emailFnC));
  t('the body is plain text, not HTML', !/<[a-z]+>/i.test(code(DASH.match(/function wsMessage\(p\)\{[\s\S]*?\n\}/)[0])));
  t('it makes no Supabase read or write of its own beyond the existing lookup',
    (emailFnC.match(/window\.sb\./g) || []).length === 1, (emailFnC.match(/window\.sb\.[a-z]+/g) || []));
  t('it never navigates the dashboard to a page',
    !/location\.href\s*=\s*['"]\//.test(emailFnC) && !/location\.assign|location\.replace/.test(emailFnC));

  /* The constructed URL, built by the page's own functions. */
  {
    const s = await open(b, '/dashboard.html', DOCTOR);
    const built = await s.pg.evaluate(`(() => {
      const p = { patient_name:'Ana Petrova', email:'ana.p+test@example.com', token:'TOK123' };
      const to = window.wsValidEmail ? window.wsValidEmail(p.email) : null;
      const url = 'mailto:' + to +
        '?subject=' + encodeURIComponent('Your pre-anaesthesia questionnaire') +
        '&body='    + encodeURIComponent(window.wsMessage ? window.wsMessage(p) : '');
      return { to: to, url: url, link: window.wsLink ? window.wsLink(p) : null,
               valid: {
                 plain:   window.wsValidEmail('a@b.com'),
                 plus:    window.wsValidEmail('ana.p+test@example.com'),
                 blank:   window.wsValidEmail(''),
                 nullish: window.wsValidEmail(null),
                 spaces:  window.wsValidEmail('  a@b.com  '),
                 junk:    window.wsValidEmail('not-an-email'),
                 comma:   window.wsValidEmail('a@b.com,c@d.com')
               } };
    })()`);
    await s.ctx.close();
    t('the recipient is the patient email, unmangled',
      built.to === 'ana.p+test@example.com', built.to);
    t('...so no %40 or %2B in the address', !/%40|%2B/.test(built.url.split('?')[0]), built.url.split('?')[0]);
    t('the body carries the patient-specific link',
      decodeURIComponent(built.url.split('&body=')[1]).indexOf(built.link) >= 0, built.link);
    t('the link is the patient\'s own token', /q\.html\?t=TOK123$/.test(built.link), built.link);
    t('subject and body are single-encoded, not double',
      built.url.indexOf('%2520') < 0 && /subject=Your%20pre-anaesthesia%20questionnaire/.test(built.url));
    t('the encoded body round-trips exactly',
      decodeURIComponent(built.url.split('&body=')[1]).indexOf('Hello Ana,') === 0);
    t('no unrelated patient data is in the message',
      !/procedure|hospital|surgery_date|doctor_notes|phone/i.test(decodeURIComponent(built.url)),
      decodeURIComponent(built.url).slice(0, 60));

    t('a valid address passes',            built.valid.plain === 'a@b.com');
    t('a plus-addressed address passes',   built.valid.plus === 'ana.p+test@example.com');
    t('whitespace is trimmed',             built.valid.spaces === 'a@b.com');
    t('a missing address is rejected',     built.valid.blank === '' && built.valid.nullish === '');
    t('nonsense is rejected',              built.valid.junk === '');
    t('a comma-injected list is rejected', built.valid.comma === '', built.valid.comma);
  }

  /* The missing-email UX, and the delivery-status rule it protects. */
  t('a missing address produces an explicit message, not a blank draft',
    /No email address is saved for this patient\./.test(emailFn));
  t('...and returns before building any mailto',
    /if\(!to\)\{[\s\S]*?return;/.test(emailFnC));
  t('nothing is marked sent when there is no address',
    emailFnC.indexOf('return;') < emailFnC.indexOf('wsMarkSent'), 'guard precedes wsMarkSent');
  t('the old unconditional mark-sent is gone',
    !/await wsMarkSent\(id\); wsToast\('Email draft opened/.test(DASHC));

  /* ══ 6 · WhatsApp and Copy link are untouched ════════════════════════════ */
  console.log('\n6 · WhatsApp and Copy link unchanged');
  const { execSync } = require('child_process');
  const mainDash = execSync('git -C ' + REPO + ' show origin/main:dashboard.html', { encoding:'utf8', maxBuffer:1<<26 });
  const grab = (src, name) => (src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}')) || [''])[0];
  for (const fn of ['wsSendWhatsApp', 'wsCopyLink', 'wsFallbackCopy', 'wsOpenLink', 'wsLink', 'wsMessage', 'wsMarkSent'])
    t(fn + ' is byte-identical to main',
      grab(DASH, fn) === grab(mainDash, fn) && grab(DASH, fn).length > 0, fn);
  t('WhatsApp still opens via window.open on https',
    /window\.open\(wa,\s*'_blank'\)/.test(code(grab(DASH,'wsSendWhatsApp'))) &&
    /https:\/\/wa\.me\//.test(grab(DASH,'wsSendWhatsApp')));
  t('WhatsApp still only marks sent when the window opened',
    /if\(win\)\{[\s\S]*?wsMarkSent/.test(code(grab(DASH,'wsSendWhatsApp'))));
  t('Copy link still uses the clipboard with a fallback',
    /navigator\.clipboard/.test(grab(DASH,'wsCopyLink')) && /wsFallbackCopy/.test(grab(DASH,'wsCopyLink')));
  t('the shared URL builder is unchanged, so all three share the same link',
    grab(DASH,'wsLink') === grab(mainDash,'wsLink'));

  /* ══ 7 · the three actions still gate on the server ══════════════════════ */
  console.log('\n7 · Star / Archive / Delete');
  t('Mark Important calls patient_set_starred with kind and id',
    /rpc\('patient_set_starred',\s*\{\s*p_kind:kind,\s*p_id:id,\s*p_starred:!!starred\s*\}\)/.test(LCC));
  t('setStarred guards kind and id before calling',
    /function setStarred\(kind, id, starred\)\{\s*var bad = guard\(kind, id\);/.test(LCC));
  t('the star write is awaited before any UI change',
    /var r=await window\.PatientLifecycle\.setStarred\(kind, id, starred\);[\s\S]{0,220}?if\(!r \|\| r\.ok!==true\)\{[\s\S]{0,200}?return;\s*\}/.test(DASHC),
    'server-first');
  t('a failed star changes no local state',
    DASHC.indexOf('wsLcApplyLocalStar') > DASHC.indexOf('wsToast(f.text); return;'), 'apply is after the guard');
  t('a successful star updates the list model and re-renders',
    /wsLcApplyLocalStar\(kind, id, starred\);\s*wsRenderMyPatients\(\);/.test(DASHC));
  t('the open detail modal follows the star', /_wsDetailId===id/.test(DASHC));
  t('the Important counter is derived from that model',
    /_wsMyPatients\.filter\(function\(p\)\{return p\.starred && !p\.archived;\}\)\.length/.test(DASHC));

  t('Archive is disabled until the server answers',
    /it\.needsEligibility\?' disabled':''/.test(DASHC));
  t('eligibility is prefetched for exactly the state\'s actions',
    /actionsForState\(state\)/.test(DASHC) && /eligibilityFor\(kind, id, need\)/.test(DASHC));
  t('active offers archive and delete',
    /if \(state === 'active'\)\s*return \[ACT\.ARCHIVE, ACT\.DELETE\]/.test(LCC));
  t('an ineligible action stays visible but disabled with its reason',
    /b\.disabled=true; h\.textContent=r\.text/.test(DASHC));
  t('only an eligible action gets a click handler',
    /if\(e\.eligible\)\{[\s\S]*?b\.onclick=function/.test(DASHC));
  t('acting goes through patient_lifecycle_action',
    /rpc\('patient_lifecycle_action',\s*\n?\s*\{ p_kind:kind, p_id:id, p_action:action, p_reason:reason \|\| null \}\)/.test(LCC));

  /* Delete means the Recycle Bin. Proven three ways. */
  t('Delete is described as a move to the Recycle Bin',
    /'delete':\s*'Move this patient to the Recycle Bin\?'/.test(LCC));
  t('...its copy says nothing is destroyed',
    /Nothing is destroyed — it moves to the Recycle Bin/.test(LC));
  t('...and it requires confirmation',
    /key:'delete'[\s\S]{0,120}needsConfirm:true/.test(LCC));
  t('the client has no hard-delete path on patient tables',
    !/from\('clinic_patients'\)\.delete\(\)/.test(DASHC) && !/from\('patient_surgeries'\)\.delete\(\)/.test(DASHC));
  t('permanent deletion needs a typed confirmation word',
    /CONFIRM_WORD = 'PERMANENTLY DELETE'/.test(LCC) &&
    /if \(confirm !== CONFIRM_WORD\)/.test(LCC));
  t('the bin is refreshed after any lifecycle action',
    /if\(_wsRecycleLoaded\) await wsLoadRecycleBin\(\)/.test(DASHC));

  /* ══ 8 · live regression on the doctor dashboard ═════════════════════════ */
  console.log('\n8 · Live regression');
  {
    const s = await open(b, '/dashboard.html', DOCTOR);
    t('the dashboard renders without a page error', s.errs.length === 0, s.errs);
    const api = await s.pg.evaluate(`(() => ({
      lifecycle: typeof window.PatientLifecycle,
      open: typeof window.coOpen,
      menuFor: typeof window.PatientLifecycle.menuFor,
      toggle: typeof window.wsLcToggle,
      closeAll: typeof window.wsLcCloseAll,
      email: typeof window.wsSendEmail,
      wa: typeof window.wsSendWhatsApp,
      copy: typeof window.wsCopyLink,
      validEmail: typeof window.wsValidEmail,
      bin: typeof window.PatientLifecycle.recycleBin }))()`);
    for (const k of Object.keys(api)) t('still exposed: ' + k, api[k] === 'function' || api[k] === 'object', api[k]);

    /* The menu the module describes, for each state. */
    const menus = await s.pg.evaluate(`(() => ({
      active:   window.PatientLifecycle.menuFor({state:'active',   starred:false}).map(i=>i.key),
      archived: window.PatientLifecycle.menuFor({state:'archived', starred:false}).map(i=>i.key),
      deleted:  window.PatientLifecycle.menuFor({state:'deleted',  starred:false}).map(i=>i.key),
      starOn:   window.PatientLifecycle.menuFor({state:'active', starred:true}).filter(i=>i.key==='star')[0].label,
      starOff:  window.PatientLifecycle.menuFor({state:'active', starred:false}).filter(i=>i.key==='star')[0].label,
      bin:      window.PatientLifecycle.binMenuFor({purge_eligible:false}).map(i=>i.key) }))()`);
    await s.ctx.close();
    t('an active patient offers open, star, archive, delete',
      JSON.stringify(menus.active) === JSON.stringify(['open','star','archive','delete']), menus.active);
    t('an archived patient offers restore, not archive',
      menus.archived.indexOf('restore_archive') >= 0 && menus.archived.indexOf('archive') < 0, menus.archived);
    t('a deleted patient offers no ordinary action',
      JSON.stringify(menus.deleted) === JSON.stringify(['open','star']), menus.deleted);
    t('the star label reflects state', menus.starOff === 'Mark as Important' && menus.starOn === 'Remove from Important',
      [menus.starOff, menus.starOn]);
    t('the bin offers restore, and no purge until the server allows it',
      JSON.stringify(menus.bin) === JSON.stringify(['restore_delete']), menus.bin);
    t('the three-dot menu is still a real disclosure widget',
      /aria-haspopup="menu" aria-expanded="false"/.test(DASH) && /role="menu"/.test(DASH));
    t('it closes on outside click and on Escape',
      /addEventListener\('click', function\(\)\{ if\(_wsLcOpen\) wsLcCloseAll\(\); \}\)/.test(DASHC) &&
      /e\.key==='Escape' && _wsLcOpen/.test(DASHC));
  }

  /* ══ 9 · nothing was weakened ════════════════════════════════════════════ */
  console.log('\n9 · No privilege or auth change');
  const changed = execSync('git -C ' + REPO + ' diff --name-only origin/main', { encoding:'utf8' })
    .split('\n').filter(Boolean)
    .concat(execSync('git -C ' + REPO + ' ls-files --others --exclude-standard', { encoding:'utf8' })
      .split('\n').filter(Boolean));
  t('only the repair migration is new among SQL',
    changed.filter(f => /\.sql$/.test(f)).every(f => f === MIG), changed.filter(f => /\.sql$/.test(f)));
  for (const f of ['auth.js','navbar.js','supabase.js','clinical-open.js','ask.html','questions.html',
                   'role-select.html','doctor-pending.html','patients.html','anesthesia-types.html'])
    t('untouched: ' + f, !changed.includes(f));
  t('the pending-doctor gate is unchanged in the lifecycle module',
    !/is_pending_doctor|requireRole|requireAuth/.test(LCC));
  t('the migration does not mention a verification or role table',
    !/profiles|verification_status|is_admin|user_roles/i.test(SQLC));
  t('no client code grants itself anything',
    !/GRANT|REVOKE/i.test(DASHC) && !/GRANT|REVOKE/i.test(LCC));
  t('the version stamp is consistent',
    read('VERSION').trim().length > 0 && DASH.includes('patient-lifecycle.js?v=' + read('VERSION').trim()));

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  NOTE: grant assertions are against the migration TEXT. No SQL was applied,');
  console.log('        and this suite cannot and does not verify production privileges.');
  process.exit(fail ? 1 : 0);
})();
