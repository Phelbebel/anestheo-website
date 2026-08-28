#!/usr/bin/env node
/* doctor-lifecycle.test.js — Archive and Delete, proven by behaviour.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: hiding an error is not fixing it.
 *
 * Two previous rounds of work on this menu passed their suites while Archive
 * and Delete were dead in production, because those suites read source
 * strings. `grep patient_lifecycle_action` is satisfied by code that raises
 * 42703 on every record a doctor can act on. So sections 3-7 below never look
 * at source: they drive the real dashboard against a model of the real RPCs
 * (tools/lifecycle-server.js), click the real menu, and assert the record
 * MOVED — server state and rendered lists both.
 *
 * Section 2 runs the same journey against the BROKEN server, so the suite
 * proves two things at once: that the repair is what makes Archive work, and
 * that even when the server is broken the doctor never sees Postgres text.
 *
 * What this cannot do is prove the SQL. It has no database. The migration is
 * asserted as text in section 8, and the report says so.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const MAIN = process.env.NB_MAIN || 'origin/main';
const LCSRV = fs.readFileSync(REPO + '/tools/lifecycle-server.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 170);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(66) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(66) + ' ' + fmt(d)); }
};

const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const sqlOnly = s => s.replace(/^\s*--[^\n]*$/gm, ' ');

const MIG  = 'v4_5_lifecycle_questions_schema_repair.sql';
const SQL  = read(MIG);
const SQLC = sqlOnly(SQL);
const DASH = read('dashboard.html');
const DASHC = code(DASH);

const UID = '9e000000-0000-4000-8000-00000000cafe';
const DOCTOR = { email:'d@e.com', role:'doctor', verification_status:'approved', is_admin:false, full_name:'Dr Dana Levi' };

/* ── Fixtures ──────────────────────────────────────────────────────────────
   Six records covering every state the menu can be built for, plus a blocker.
   Ids are fixed so an assertion can name the record it means. */
const ID = {
  jActive:  '11111111-1111-4111-8111-000000000001',   // active journey, eligible
  jBlocked: '11111111-1111-4111-8111-000000000002',   // active journey, open consultation
  jArch:    '11111111-1111-4111-8111-000000000003',   // archived journey
  cActive:  '22222222-2222-4222-8222-000000000001',   // active clinic patient, eligible
  cArch:    '22222222-2222-4222-8222-000000000002',   // archived clinic patient
  cDeleted: '22222222-2222-4222-8222-000000000003',   // already in the bin
  patient:  '33333333-3333-4333-8333-000000000001'
};

function fixtures() {
  const base = { assigned_doctor_id: UID, archived_at:null, deleted_at:null, is_starred:false,
                 clinic_patient_id:null, patient_id:null, updated_at:'2026-08-01T00:00:00Z' };
  return {
    patient_surgeries: [
      Object.assign({}, base, { id:ID.jActive,  patient_name:'Alice Journey', patient_id:ID.patient,
                                procedure_type:'Knee replacement', surgery_date:'2026-12-01' }),
      Object.assign({}, base, { id:ID.jBlocked, patient_name:'Bob Blocked',   patient_id:null,
                                procedure_type:'Hernia', surgery_date:'2026-12-05' }),
      Object.assign({}, base, { id:ID.jArch,    patient_name:'Cara Archived', patient_id:null,
                                archived_at:'2026-07-01T00:00:00Z', procedure_type:'Cataract' })
    ],
    clinic_patients: [
      { id:ID.cActive, doctor_id:UID, patient_name:'Dina Clinic', email:'dina@example.com',
        phone_number:'+995555111222', token:'TOKACTIVE', procedure:'Gallbladder', hospital:'Central',
        questionnaire_status:'not_sent', consultation_status:'not_arrived', patient_status:'awaiting_questionnaire',
        archived_at:null, deleted_at:null, is_starred:false, created_at:'2026-08-01T00:00:00Z' },
      { id:ID.cArch,   doctor_id:UID, patient_name:'Ed Archived', email:null, token:'TOKARCH',
        questionnaire_status:'completed', consultation_status:'reviewed', patient_status:'ready_for_surgery',
        archived_at:'2026-07-01T00:00:00Z', deleted_at:null, is_starred:false, created_at:'2026-08-01T00:00:00Z' },
      { id:ID.cDeleted,doctor_id:UID, patient_name:'Fay Deleted', email:null, token:'TOKDEL',
        questionnaire_status:'not_sent', consultation_status:'not_arrived', patient_status:'awaiting_questionnaire',
        archived_at:null, deleted_at:'2026-07-15T00:00:00Z', delete_reason:'Duplicate',
        is_starred:false, created_at:'2026-08-01T00:00:00Z' }
    ],
    /* A JOURNEY ONLY BECOMES A CARD THROUGH AN ACCEPTED CARE REQUEST.
       wsLoadCases builds My Patients from surgicalReqs — care_requests with
       status 'accepted' — so a patient_surgeries row with no accepted request
       has no card and no menu. A first draft of these fixtures gave Bob and
       Cara only their blocking/no request and then asserted their cards
       existed; the board was right and the fixture was wrong.

       Bob carries BOTH: an accepted request that gives him a card, and a
       second, still-open one that is the archive blocker. That is a real
       shape — a patient can have an open consultation request while already
       being an accepted surgical patient — and it is the only shape in which
       the blocker is reachable from the UI at all. */
    care_requests: [
      { id:'cr1', doctor_id:UID, patient_id:ID.patient, surgery_id:ID.jActive, status:'accepted',
        patient_name:'Alice Journey', procedure:'Knee replacement', deleted_at:null,
        requested_at:'2026-08-01T00:00:00Z', responded_at:'2026-08-02T00:00:00Z' },
      { id:'cr2a', doctor_id:UID, patient_id:null, surgery_id:ID.jBlocked, status:'accepted',
        patient_name:'Bob Blocked', procedure:'Hernia', deleted_at:null,
        requested_at:'2026-08-03T00:00:00Z', responded_at:'2026-08-04T00:00:00Z' },
      { id:'cr2b', doctor_id:UID, patient_id:null, surgery_id:ID.jBlocked, status:'requested',
        patient_name:'Bob Blocked', deleted_at:null, requested_at:'2026-08-05T00:00:00Z' },
      { id:'cr3', doctor_id:UID, patient_id:null, surgery_id:ID.jArch, status:'accepted',
        patient_name:'Cara Archived', procedure:'Cataract', deleted_at:null,
        requested_at:'2026-08-01T00:00:00Z', responded_at:'2026-08-02T00:00:00Z' }
    ],
    questions: [
      { id:'q1', patient_id:ID.patient, status:'new', deleted_at:null }
    ],
    preop_questionnaires: [
      { patient_id:ID.patient, status:'submitted', completion:100, review_state:'submitted' }
    ]
  };
}

async function openDash(b, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{ width:1500, height:1100 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u))  return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  const logs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(DOCTOR) + ';' +
    'window.__LC_UID=' + JSON.stringify(UID) + ';' +
    'window.__LC_DB=' + JSON.stringify(opts.db || fixtures()) + ';' +
    'window.__LC_MODE=' + JSON.stringify(opts.mode || 'fixed') + ';' +
    (opts.pending ? 'window.__LC_PENDING_DOCTOR=true;' : ''));
  await pg.goto(BASE + '/dashboard.html', { waitUntil:'domcontentloaded' }).catch(() => {});
  // Injected after supabase.js has defined window.sb, so the wrapper wins.
  await pg.addScriptTag({ content: LCSRV });
  await pg.evaluate('window.LifecycleServer && window.LifecycleServer.install()');
  /* wsLoadPatients() only fills the clinic-patient CACHE (_wsPatients, used by
     wsFindP and the share buttons). The My Patients board — the cards, their
     menus and every counter — is built by wsLoadCases(). A first draft called
     only the former and got an empty board, which would have looked like a
     product bug and was a harness bug. Both, in the order the page uses them. */
  await pg.evaluate(`(async () => {
    if (typeof wsLoadPatients === 'function') await wsLoadPatients();
    if (typeof wsLoadCases    === 'function') await wsLoadCases();
  })()`).catch(() => {});
  await pg.waitForTimeout(1200);
  return { ctx, pg, errs, logs };
}

/* Open the three-dot menu for one record and read every item back. */
const MENU = id => `(async () => {
  const host = [...document.querySelectorAll('.ws-lc')].filter(h =>
    (h.querySelector('.ws-lc-btn')||{}).getAttribute &&
    h.querySelector('.ws-lc-btn').getAttribute('onclick').indexOf(${JSON.stringify(id)}) >= 0)[0];
  if (!host) return { found:false };
  host.querySelector('.ws-lc-btn').click();
  await new Promise(r => setTimeout(r, 700));
  const menu = host.querySelector('.ws-lc-menu');
  return { found:true, domId:host.id, open: menu.classList.contains('open'),
    items: [...menu.querySelectorAll('.ws-lc-item')].map(b => ({
      key: b.getAttribute('data-key'),
      label: b.textContent.trim(),
      disabled: b.disabled,
      hint: ((menu.querySelector('.ws-lc-hint[data-hint="'+b.getAttribute('data-key')+'"]')||{}).textContent||'').trim(),
      tone: ((menu.querySelector('.ws-lc-hint[data-hint="'+b.getAttribute('data-key')+'"]')||{}).className||'')
    })) };
})()`;

/* Click a menu item, confirm the dialog, wait for the lists to settle. */
const ACT = (id, key) => `(async () => {
  const host = [...document.querySelectorAll('.ws-lc')].filter(h =>
    h.querySelector('.ws-lc-btn').getAttribute('onclick').indexOf(${JSON.stringify(id)}) >= 0)[0];
  if (!host) return { found:false };
  host.querySelector('.ws-lc-btn').click();
  await new Promise(r => setTimeout(r, 700));
  const item = host.querySelector('.ws-lc-menu .ws-lc-item[data-key="' + ${JSON.stringify(key)} + '"]');
  if (!item) return { found:true, item:false };
  if (item.disabled) return { found:true, item:true, disabled:true };
  item.click();
  await new Promise(r => setTimeout(r, 400));
  const bg = document.getElementById('ws-confirm-bg');
  if (!bg) return { found:true, item:true, confirm:false };
  const btns = [...bg.querySelectorAll('button')];
  const go = btns.filter(x => !/cancel/i.test(x.textContent)).pop();
  const title = (bg.querySelector('.ws-confirm-title, h3, .ws-confirm-t') || {}).textContent || bg.textContent.slice(0,80);
  go.click();
  await new Promise(r => setTimeout(r, 1400));
  return { found:true, item:true, confirm:true, title:title.trim().slice(0,60) };
})()`;

const STATE = `(() => {
  const db = window.LifecycleServer.DB;
  const find = (t,id) => (db[t]||[]).filter(r => r.id === id)[0] || null;
  const counters = {};
  ['awaiting','review','approved','scheduled','completed'].forEach(s => {
    const el = document.getElementById('ws-mp-' + s + '-n'); counters[s] = el ? el.textContent : null; });
  ['archived','important','deleted'].forEach(s => {
    const el = document.getElementById('ws-mp-' + s + '-n'); counters[s] = el ? el.textContent : null; });
  return {
    counters: counters,
    listNames: [...document.querySelectorAll('#ws-mp-list .ws-mp-name, #ws-mp-list .ws-mp-nm')].map(n => n.textContent.trim()),
    listText: (document.getElementById('ws-mp-list')||{}).innerText || '',
    calls: window.__LC_CALLS.map(c => ({ fn:c.fn, kind:c.args.p_kind, id:c.args.p_id, action:c.args.p_action })),
    db: { jActive: find('patient_surgeries', ${JSON.stringify(ID.jActive)}),
          jArch:   find('patient_surgeries', ${JSON.stringify(ID.jArch)}),
          cActive: find('clinic_patients',   ${JSON.stringify(ID.cActive)}),
          cArch:   find('clinic_patients',   ${JSON.stringify(ID.cArch)}),
          cDeleted:find('clinic_patients',   ${JSON.stringify(ID.cDeleted)}) }
  };
})()`;

/* Switch the My Patients view. The board defaults to the 'awaiting' workflow
   stage, and an archived row renders ONLY under Archived — wsRenderMyPatients
   filters it out of every stage view on purpose. So a test that wants an
   archived record's menu has to open that view first; without this, MENU()
   correctly reported found:false and it looked like a missing menu. */
const showStage = stage => `(async () => {
  window.wsMpStage(${JSON.stringify(stage)});
  await new Promise(r => setTimeout(r, 700));
  return { stage: window._wsMpStage,
           text: (document.getElementById('ws-mp-list')||{}).innerText || '' };
})()`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ══ 1 · the card passes the right kind and id ═══════════════════════════ */
  console.log('\n1 · Record kind and id on the card');
  {
    const s = await openDash(b);
    t('the dashboard renders without a page error', s.errs.length === 0, s.errs);
    const refs = await s.pg.evaluate(`(() => (window._wsMyPatients||[]).map(p => ({
      name:p.name, origin:p.origin, kind:p.openKind, id:p.openId,
      archived:!!p.archived, stage:p.stage })))()`);
    t('all six fixtures are loaded, minus the deleted one', refs.length === 5, refs.map(r => r.name));
    const alice = refs.filter(r => r.name === 'Alice Journey')[0] || {};
    const dina  = refs.filter(r => r.name === 'Dina Clinic')[0] || {};
    t('a patient-requested row is kind=journey with the SURGERY id',
      alice.kind === 'journey' && alice.id === ID.jActive, alice);
    t('a clinic-created row is kind=clinic_patient with the CLINIC id',
      dina.kind === 'clinic_patient' && dina.id === ID.cActive, dina);
    t('a soft-deleted record never reaches the active list',
      !refs.some(r => r.name === 'Fay Deleted'), refs.map(r => r.name));
    t('an archived record stays in the model, flagged',
      refs.some(r => r.name === 'Cara Archived' && r.archived === true) &&
      refs.some(r => r.name === 'Ed Archived'   && r.archived === true), refs.filter(r=>r.archived));
    await s.ctx.close();
  }

  /* ══ 2 · THE BROKEN SERVER — the outage, and what the doctor sees ════════ */
  console.log('\n2 · Broken server (pre-v4_5): disabled, but never raw');
  {
    const s = await openDash(b, { mode:'broken' });
    const m = await s.pg.evaluate(MENU(ID.cActive));
    t('the menu still opens', m.found && m.open, m.found);
    const arch = m.items.filter(i => i.key === 'archive')[0] || {};
    const del  = m.items.filter(i => i.key === 'delete')[0] || {};
    t('Archive is present but disabled', arch.disabled === true, arch);
    t('Delete is present but disabled',  del.disabled === true, del);
    t('Archive shows the human retry sentence',
      /Could not check this action right now\. Please try again\./.test(arch.hint), arch.hint);
    t('Delete shows it too', /Could not check this action right now/.test(del.hint), del.hint);
    for (const i of m.items) {
      t('no Postgres text in "' + i.key + '"',
        !/surgery_id|does not exist|permission denied|column |relation |42703|42501/i.test(i.hint), i.hint);
    }
    const page = await s.pg.evaluate('document.body.innerText');
    t('the raw error appears nowhere on the page',
      !/q\.surgery_id|column .* does not exist|permission denied for function/i.test(page),
      (page.match(/.{0,40}does not exist.{0,40}/) || ['clean'])[0]);
    t('...but it IS logged to the console for debugging',
      s.logs.some(l => /surgery_id/.test(l)), s.logs.slice(0,2));
    await s.ctx.close();
  }

  /* ══ 3 · CASE A — ACTIVE JOURNEY: archive end to end ═════════════════════ */
  console.log('\n3 · CASE A — active journey');
  {
    const s = await openDash(b);
    const m = await s.pg.evaluate(MENU(ID.jActive));
    t('menu opens for the journey', m.found && m.open);
    t('it offers open, star, archive, delete',
      JSON.stringify(m.items.map(i => i.key)) === JSON.stringify(['open','star','archive','delete']),
      m.items.map(i => i.key));
    const arch = m.items.filter(i => i.key === 'archive')[0];
    const del  = m.items.filter(i => i.key === 'delete')[0];
    t('Archive is ENABLED', arch.disabled === false, arch);
    t('Delete is ENABLED',  del.disabled === false, del);
    t('Archive explains what it does',
      /Moves the patient to Archived/.test(arch.hint), arch.hint);
    t('the unanswered-question warning is shown, not swallowed',
      /unanswered question/.test(arch.hint), arch.hint);
    t('a warning is styled as a warning, not a block',
      /warn/.test(arch.tone), arch.tone);

    const r = await s.pg.evaluate(ACT(ID.jActive, 'archive'));
    t('clicking Archive opened a confirmation', r.confirm === true, r);
    const st = await s.pg.evaluate(STATE);
    const call = st.calls.filter(c => c.fn === 'patient_lifecycle_action').pop() || {};
    t('patient_lifecycle_action was called with kind=journey',   call.kind === 'journey', call);
    t('...with the surgery id',                                  call.id === ID.jActive, call);
    t('...and action=archive',                                   call.action === 'archive', call);
    t('the SERVER wrote archived_at',                            !!st.db.jActive.archived_at, st.db.jActive.archived_at);
    t('...and archived_by is the acting doctor',                 st.db.jActive.archived_by === UID);
    t('...and deleted_at was NOT touched',                       st.db.jActive.deleted_at === null);
    t('the row still exists — nothing was destroyed',            st.db.jActive !== null);
    t('the card left the active list',
      st.listText.indexOf('Alice Journey') < 0, st.listText.slice(0,80));
    t('the Archived counter went to 3',                          st.counters.archived === '3', st.counters);
    await s.ctx.close();
  }

  /* ══ 4 · CASE B — ACTIVE CLINIC PATIENT: delete to the bin ═══════════════ */
  console.log('\n4 · CASE B — active clinic patient');
  {
    const s = await openDash(b);
    const m = await s.pg.evaluate(MENU(ID.cActive));
    const arch = m.items.filter(i => i.key === 'archive')[0];
    const del  = m.items.filter(i => i.key === 'delete')[0];
    t('Archive is ENABLED for a clinic patient', arch.disabled === false, arch);
    t('Delete is ENABLED for a clinic patient',  del.disabled === false, del);
    t('no warning: the clinic patient has no linked journey, so none is invented',
      !/unanswered question/.test(arch.hint), arch.hint);

    const before = await s.pg.evaluate(STATE);
    const r = await s.pg.evaluate(ACT(ID.cActive, 'delete'));
    t('Delete opened a confirmation', r.confirm === true, r);
    t('...and it named the Recycle Bin', /Recycle Bin/i.test(r.title || ''), r.title);

    const st = await s.pg.evaluate(STATE);
    const call = st.calls.filter(c => c.fn === 'patient_lifecycle_action').pop() || {};
    t('patient_lifecycle_action kind=clinic_patient', call.kind === 'clinic_patient', call);
    t('...with the clinic id',                        call.id === ID.cActive, call);
    t('...and action=delete',                         call.action === 'delete', call);
    t('the SERVER wrote deleted_at',                  !!st.db.cActive.deleted_at, st.db.cActive.deleted_at);
    t('THE ROW WAS NOT DESTROYED — soft delete only', st.db.cActive !== null && !!st.db.cActive.patient_name,
      st.db.cActive && st.db.cActive.patient_name);
    t('archived_at was not touched',                  st.db.cActive.archived_at === null);
    t('the card left the active list',
      st.listText.indexOf('Dina Clinic') < 0, st.listText.slice(0,80));
    t('the Recycle Bin counter incremented',
      Number(st.counters.deleted) > Number(before.counters.deleted),
      { before: before.counters.deleted, after: st.counters.deleted });

    const bin = await s.pg.evaluate(`(async () => {
      await window.wsLoadRecycleBin();
      return (window._wsRecycle||[]).map(r => ({ kind:r.kind, id:r.id, name:r.name })); })()`);
    t('the record IS in the Recycle Bin',
      bin.some(r => r.id === ID.cActive), bin);
    await s.ctx.close();
  }

  /* ══ 5 · CASE C / D — archived and deleted states ═══════════════════════ */
  console.log('\n5 · CASE C — archived, CASE D — deleted');
  {
    const s = await openDash(b);
    const view = await s.pg.evaluate(showStage('archived'));
    t('the Archived view opens', view.stage === 'archived', view.stage);
    t('...and lists both archived records',
      /Cara Archived/.test(view.text) && /Ed Archived/.test(view.text), view.text.slice(0, 80));
    const m = await s.pg.evaluate(MENU(ID.cArch));
    t('an archived record offers Restore, not Archive',
      m.items.some(i => i.key === 'restore_archive') && !m.items.some(i => i.key === 'archive'),
      m.items.map(i => i.key));
    const rest = m.items.filter(i => i.key === 'restore_archive')[0];
    const del  = m.items.filter(i => i.key === 'delete')[0];
    t('Restore is ENABLED', rest.disabled === false, rest);
    t('Delete is ENABLED from archived too', del.disabled === false, del);

    const r = await s.pg.evaluate(ACT(ID.cArch, 'restore_archive'));
    t('Restore confirmed', r.confirm === true, r);
    const st = await s.pg.evaluate(STATE);
    t('the SERVER cleared archived_at',   st.db.cArch.archived_at === null, st.db.cArch.archived_at);
    t('...and recorded restored_by',      st.db.cArch.restored_by === UID);
    t('...and did not touch deleted_at',  st.db.cArch.deleted_at === null);
    /* The view is still Archived, so "back on the active list" is two claims:
       gone from HERE, and present in the workflow stage it belongs to. Ed is
       patient_status='ready_for_surgery', which is the Scheduled stage — the
       record returns to where it always was, not to a generic inbox. A first
       draft read the archived view and called the correct behaviour a failure. */
    t('the record left the Archived view',
      st.listText.indexOf('Ed Archived') < 0, st.listText.slice(0,60));
    const back = await s.pg.evaluate(showStage('scheduled'));
    t('...and reappeared under its own workflow stage',
      /Ed Archived/.test(back.text), back.text.slice(0,60));
    t('the Archived counter went down',   st.counters.archived === '1', st.counters);

    // CASE D — a deleted record has no ordinary menu at all.
    const gone = await s.pg.evaluate(MENU(ID.cDeleted));
    t('a deleted record renders no card and no menu', gone.found === false, gone);
    const dm = await s.pg.evaluate(`(() => window.PatientLifecycle.menuFor({state:'deleted'}).map(i=>i.key))()`);
    t('...and its state offers no archive or delete',
      dm.indexOf('archive') < 0 && dm.indexOf('delete') < 0, dm);
    await s.ctx.close();
  }

  /* ══ 6 · restore from the Recycle Bin ═══════════════════════════════════ */
  console.log('\n6 · Restore from the Recycle Bin');
  {
    const s = await openDash(b);
    const out = await s.pg.evaluate(`(async () => {
      await window.wsLoadRecycleBin();
      const before = (window._wsRecycle||[]).length;
      const r = await window.PatientLifecycle.act('clinic_patient', ${JSON.stringify(ID.cDeleted)}, 'restore_delete', null);
      // wsLoadCases() is what rebuilds the board; wsLoadPatients() only refills
      // the clinic cache. Omitting it left the list stale and looked like a
      // record that never came back.
      await window.wsLoadPatients(); await window.wsLoadCases(); await window.wsLoadRecycleBin();
      const db = window.LifecycleServer.DB.clinic_patients.filter(x => x.id === ${JSON.stringify(ID.cDeleted)})[0];
      return { ok:r.ok, code:r.code, before:before, after:(window._wsRecycle||[]).length,
               deleted_at:db.deleted_at, restored_by:db.restored_by,
               list:(document.getElementById('ws-mp-list')||{}).innerText||'' };
    })()`);
    t('restore_delete succeeded',            out.ok === true, out);
    t('the SERVER cleared deleted_at',       out.deleted_at === null, out.deleted_at);
    t('...and recorded restored_by',         out.restored_by === UID);
    t('the bin shrank',                      out.after === out.before - 1, { before:out.before, after:out.after });
    t('the record returned to the active list',
      out.list.indexOf('Fay Deleted') >= 0, out.list.slice(0,120));
    await s.ctx.close();
  }

  /* ══ 7 · CASE E — a real clinical blocker is shown, not hidden ═══════════ */
  console.log('\n7 · CASE E — real blocker, CASE F — technical failure');
  {
    const s = await openDash(b);
    const m = await s.pg.evaluate(MENU(ID.jBlocked));
    const arch = m.items.filter(i => i.key === 'archive')[0];
    const del  = m.items.filter(i => i.key === 'delete')[0];
    t('Archive is disabled by the blocker', arch.disabled === true, arch);
    t('...and the REAL reason is shown verbatim',
      /A consultation request is still open for this patient\. Resolve it first\./.test(arch.hint), arch.hint);
    t('...toned as a block, not a technical failure', /tone-block/.test(arch.tone), arch.tone);
    t('...and it is NOT the generic sentence',
      !/Could not check this action right now/.test(arch.hint), arch.hint);
    t('Delete is still allowed — the blocker is archive-only',
      del.disabled === false, del);

    // An archived JOURNEY, reached the same way — through the Archived view.
    await s.pg.evaluate(showStage('archived'));
    const am = await s.pg.evaluate(MENU(ID.jArch));
    t('the archived journey has a menu', am.found === true, am.found);
    const ar = (am.items || []).filter(i => i.key === 'restore_archive')[0];
    t('an archived journey can be restored', !!ar && ar.disabled === false, ar);
    t('...and offers Delete, not Archive',
      (am.items || []).some(i => i.key === 'delete') &&
      !(am.items || []).some(i => i.key === 'archive'), (am.items||[]).map(i => i.key));
    await s.ctx.close();
  }

  /* ══ 8 · the migration ══════════════════════════════════════════════════ */
  console.log('\n8 · Migration text');
  t('the repair migration exists', fs.existsSync(REPO + '/' + MIG), MIG);
  t('it is marked NOT APPLIED', /NOT APPLIED/.test(SQL));
  /* Scoped to the FUNCTION BODY. A blanket ban on the string failed the file
     for containing its own guard — the verifier does `IF v_def LIKE
     '%q.surgery_id%' THEN RAISE EXCEPTION` — and two RAISE NOTICEs that tell
     the operator whether the column exists on their database. Those are the
     migration doing its job. What must not survive is a QUERY against it. */
  const fnBody = (SQLC.match(/CREATE OR REPLACE FUNCTION public\.patient_lifecycle_eligibility[\s\S]*?\n\$\$;/) || [''])[0];
  t('the function body exists in the migration', fnBody.length > 500, fnBody.length);
  t('no questions.surgery_id query remains in the function body',
    !/surgery_id/.test(fnBody.replace(/cr\.surgery_id/g, '')),
    (fnBody.match(/[a-z_]*\.surgery_id/g) || []).join(','));
  t('...and the only surgery_id it reads is care_requests.surgery_id',
    (fnBody.match(/[a-z_]*\.surgery_id/g) || []).every(x => x === 'cr.surgery_id'),
    (fnBody.match(/[a-z_]*\.surgery_id/g) || []));
  t('the migration verifies the old reference is gone after installing',
    /v_def LIKE '%q\.surgery_id%'/.test(SQLC));
  t('the canonical questions.patient_id is used', /q\.patient_id\s*=\s*v_patient/.test(SQLC));
  t('care_requests.surgery_id is still used — that column is real',
    /cr\.surgery_id\s*=\s*p_id/.test(SQLC));
  t('journey resolves the patient from patient_surgeries.patient_id',
    /SELECT s\.patient_id INTO v_patient[\s\S]{0,120}WHERE s\.id = p_id/.test(SQLC));
  t('clinic_patient resolves ONLY through the explicit link',
    /s\.clinic_patient_id = p_id/.test(SQLC));
  t('...and only when exactly one journey carries it',
    /IF v_links = 1 THEN/.test(SQLC));
  t('it never matches a patient by name or email',
    !/full_name|\bemail\b/i.test(SQLC.replace(/RAISE NOTICE[^\n]*/g,'').replace(/RAISE EXCEPTION[^\n]*/g,'')));
  t('SECURITY DEFINER is kept',  /SECURITY DEFINER/.test(SQLC));
  t('search_path stays pinned',  /SET search_path = public, pg_temp/.test(SQLC));
  t('the signature is unchanged, so v4_4 grants carry over',
    /patient_lifecycle_eligibility\(\s*\n?\s*p_kind text, p_id uuid, p_action text DEFAULT 'archive'\)/.test(SQLC));
  t('authorization still precedes existence',
    SQLC.indexOf('patient_record_manageable') < SQLC.indexOf('record_not_found'));
  for (const c of ['clinical_blocker','already_archived','already_deleted','not_archived','not_deleted','not_authorized','invalid_input'])
    t('the ' + c + ' answer survives', SQLC.includes("'" + c + "'"), c);
  t('it issues no GRANT',  !/\bGRANT\b/.test(SQLC.replace(/has_function_privilege[^\n]*/g,'')));
  t('it issues no REVOKE', !/\bREVOKE\b/.test(SQLC));
  t('it does not redefine patient_lifecycle_action',
    !/CREATE OR REPLACE FUNCTION public\.patient_lifecycle_action/.test(SQLC));
  t('it touches no table or policy',
    !/ALTER TABLE|CREATE POLICY|DROP POLICY|CREATE TABLE|DELETE FROM|INSERT INTO/i.test(SQLC));
  t('it preflights every column it depends on',
    ['questions.patient_id','questions.status','questions.deleted_at',
     'patient_surgeries.patient_id','patient_surgeries.clinic_patient_id','care_requests.surgery_id']
      .every(c => SQL.includes(c)), 'preflight');
  t('it proves the predicate plans before installing it', /Plan proof OK/.test(SQL));
  t('it verifies the eligible path returns jsonb instead of raising',
    /did not return structured jsonb/.test(SQLC));
  t('it asserts patient_lifecycle_action has no physical DELETE',
    /patient_lifecycle_action[\s\S]{0,200}DELETE\\s\+FROM/.test(SQLC) || /contains a physical DELETE/.test(SQLC));
  t('it asserts the v4_4 grant state rather than setting it',
    /v4_4 grant state has regressed/.test(SQLC));
  t('it asserts direct DELETE stays revoked on both tables',
    /has_table_privilege\('authenticated','public\.clinic_patients','DELETE'\)/.test(SQLC) &&
    /has_table_privilege\('authenticated','public\.patient_surgeries','DELETE'\)/.test(SQLC));
  t('it asserts both restrictive delete policies',
    /cp_no_direct_delete/.test(SQLC) && /ps_no_direct_delete/.test(SQLC));
  t('permanent purge stays a separate path',
    !/patient_purge\s*\(/.test(SQLC.replace(/patient_purge_eligibility|patient_purge\(text,uuid,text\)/g,'')));
  t('it aborts rather than committing a wrong end state', /RAISE EXCEPTION 'VERIFY FAILED/.test(SQLC));
  t('it is transaction-wrapped', /^\s*BEGIN;/m.test(SQLC) && /^\s*COMMIT;/m.test(SQLC));

  const modifiedSql = execSync('git -C ' + REPO + ' diff --name-only --diff-filter=M ' + MAIN + ' -- "*.sql"',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  t('no already-applied migration was rewritten', modifiedSql.length === 0, modifiedSql);

  /* ══ 9 · Email — the modal, and what may mark Sent ═══════════════════════ */
  console.log('\n9 · Email share modal');
  {
    const s = await openDash(b);
    const before = await s.pg.evaluate(`(() => (window.LifecycleServer.DB.clinic_patients
      .filter(c => c.id === ${JSON.stringify(ID.cActive)})[0]||{}).questionnaire_status)()`);
    t('the patient starts not_sent', before === 'not_sent', before);

    const modal = await s.pg.evaluate(`(async () => {
      await window.wsSendEmail(${JSON.stringify(ID.cActive)});
      await new Promise(r => setTimeout(r, 400));
      const m = document.getElementById('ws-email-modal');
      if (!m) return { open:false };
      const v = id => (document.getElementById(id)||{}).value;
      return { open:true,
        to: v('ws-em-to'), subject: v('ws-em-subj'), body: v('ws-em-body'), link: v('ws-em-link'),
        openHref: (document.getElementById('ws-em-open')||{}).getAttribute('href'),
        buttons: [...m.querySelectorAll('button, a')].map(x => x.textContent.trim()) };
    })()`);
    t('clicking Email opens the share modal', modal.open === true, modal.open);
    t('it shows To',       modal.to === 'dina@example.com', modal.to);
    t('it shows Subject',  modal.subject === 'Your pre-anaesthesia questionnaire', modal.subject);
    t('it shows Message',  /Hello Dina/.test(modal.body), (modal.body||'').slice(0,30));
    t('it shows the patient link', /q\.html\?t=TOKACTIVE$/.test(modal.link), modal.link);
    t('the message contains that same link', (modal.body||'').indexOf(modal.link) >= 0);
    t('all five controls are present',
      ['Open in email app','Copy email text','Copy link','I sent it','Cancel']
        .every(x => modal.buttons.indexOf(x) >= 0), modal.buttons);
    t('"Open in email app" is a real mailto anchor',
      /^mailto:dina@example\.com\?subject=/.test(modal.openHref || ''), (modal.openHref||'').slice(0,60));
    t('the address is not percent-encoded', !/%40|%2B/.test((modal.openHref||'').split('?')[0]));
    t('subject and body are encoded once',
      /subject=Your%20pre-anaesthesia%20questionnaire/.test(modal.openHref||'') &&
      (modal.openHref||'').indexOf('%2520') < 0);

    const stillNotSent = await s.pg.evaluate(`(() => (window.LifecycleServer.DB.clinic_patients
      .filter(c => c.id === ${JSON.stringify(ID.cActive)})[0]||{}).questionnaire_status)()`);
    t('OPENING the modal marks nothing as sent', stillNotSent === 'not_sent', stillNotSent);

    const afterCancel = await s.pg.evaluate(`(async () => {
      document.getElementById('ws-em-cancel').click();
      await new Promise(r => setTimeout(r, 300));
      return { gone: !document.getElementById('ws-email-modal'),
        status: (window.LifecycleServer.DB.clinic_patients.filter(c => c.id === ${JSON.stringify(ID.cActive)})[0]||{}).questionnaire_status };
    })()`);
    t('Cancel closes the modal',      afterCancel.gone === true);
    t('...and marks nothing as sent', afterCancel.status === 'not_sent', afterCancel.status);

    const afterSent = await s.pg.evaluate(`(async () => {
      await window.wsSendEmail(${JSON.stringify(ID.cActive)});
      await new Promise(r => setTimeout(r, 300));
      document.getElementById('ws-em-sent').click();
      await new Promise(r => setTimeout(r, 1200));
      return { gone: !document.getElementById('ws-email-modal'),
        status: (window.LifecycleServer.DB.clinic_patients.filter(c => c.id === ${JSON.stringify(ID.cActive)})[0]||{}).questionnaire_status };
    })()`);
    t('"I sent it" closes the modal',           afterSent.gone === true);
    t('...and is the ONLY thing that marks Sent', afterSent.status === 'sent', afterSent.status);

    // A patient with no email never reaches the modal.
    /* Clear any toast still on screen first, and read the LAST one. Toasts
       linger ~1.6s, so querySelector('.ws-toast') returned the previous step's
       "Marked as sent" and this looked like the wrong message. */
    const noEmail = await s.pg.evaluate(`(async () => {
      [...document.querySelectorAll('.ws-toast')].forEach(n => n.remove());
      await window.wsSendEmail(${JSON.stringify(ID.cArch)});
      await new Promise(r => setTimeout(r, 300));
      const toasts = [...document.querySelectorAll('.ws-toast')];
      return { modal: !!document.getElementById('ws-email-modal'),
               toast: toasts.length ? toasts[toasts.length-1].textContent : '',
               status: (window.LifecycleServer.DB.clinic_patients.filter(c => c.id === ${JSON.stringify(ID.cArch)})[0]||{}).questionnaire_status };
    })()`);
    t('a patient with no email gets no modal', noEmail.modal === false);
    t('...and an explicit reason',
      /No email address is saved for this patient\./.test(noEmail.toast), noEmail.toast);
    t('...and is not marked sent',             noEmail.status !== 'sent', noEmail.status);
    await s.ctx.close();
  }

  /* ══ 10 · WhatsApp and Copy link unchanged ══════════════════════════════ */
  console.log('\n10 · WhatsApp and Copy link unchanged');
  {
    const mainDash = execSync('git -C ' + REPO + ' show ' + MAIN + ':dashboard.html', { encoding:'utf8', maxBuffer:1<<26 });
    const grab = (src, name) => (src.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}')) || [''])[0];
    for (const fn of ['wsSendWhatsApp','wsCopyLink','wsFallbackCopy','wsOpenLink','wsLink','wsMessage','wsMarkSent','wsValidEmail'])
      t(fn + ' is byte-identical to main', grab(DASH, fn) === grab(mainDash, fn) && grab(DASH, fn).length > 0, fn);
    t('WhatsApp still marks sent only when its window opened',
      /if\(win\)\{[\s\S]{0,120}wsMarkSent/.test(code(grab(DASH,'wsSendWhatsApp'))));
    t('the three share buttons still exist on the card',
      /WhatsApp<\/button>/.test(DASH) && /Email<\/button>/.test(DASH) && /Copy link<\/button>/.test(DASH));
    t('no client code performs a direct table DELETE on a patient table',
      !/from\('clinic_patients'\)\s*\.delete\(/.test(DASHC) &&
      !/from\('patient_surgeries'\)\s*\.delete\(/.test(DASHC));
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  NOTE: sections 3-7 drive the real dashboard against a MODEL of the RPCs');
  console.log('        (tools/lifecycle-server.js). The migration is asserted as text only;');
  console.log('        no SQL was applied and production privileges are not verified here.');
  process.exit(fail ? 1 : 0);
})();
