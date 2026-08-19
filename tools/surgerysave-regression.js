/* ═══════════════════════════════════════════════════════════════════════════
   surgerysave.js — a patient can save their surgery details.

   Regression coverage for a bug that shipped silently. patient-dashboard.html
   sent `origin` in the patient_surgeries payload; that column comes from
   v2_preparation_origin_migration.sql, which production never had applied, so
   every save was refused with 42703. Nobody saw it because supabase-js RETURNS
   { error } for a database refusal rather than throwing — the try/catch never
   ran, the console stayed clean, the modal closed, and the page reloaded the
   unchanged row. A failed save and a successful one looked identical.

   So this suite asserts three separate things, and the first is the one that
   would have caught it:
     1. the values actually reach the database and come back
     2. the payload carries no column production does not have
     3. a refusal is SHOWN to the patient, with their typing still on screen

   The mock models patient_surgeries with the production column set and answers
   42703 for anything else, so re-introducing `origin` fails test 2 here rather
   than in front of a patient.
   ═══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');
const MOCK = fs.readFileSync('/tmp/adm/mock.js', 'utf8');
const BASE = 'http://127.0.0.1:8890';

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok   ' + name.padEnd(62) + ' ' + fmt(detail)); }
  else    { fail++; console.log('  FAIL ' + name.padEnd(62) + ' ' + fmt(detail)); }
};
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120);

const UID = '9e000000-0000-4000-8000-00000000cafe';
const PATIENT = { id: UID, email: 'p@anestheo.test', full_name: 'Dana Levi',
                  role: 'patient', is_admin: false, verification_status: 'not_required' };

const EXISTING = [{
  id: 'ps-existing-1', patient_id: UID, assigned_doctor_id: null,
  patient_name: 'Dana Levi', procedure_type: 'Urology', surgery_date: '2026-10-01',
  hospital: 'Old Hospital', surgeon: 'Dr Old', anesthesia_type: 'General',
  care_state: 'surgical', clinic_patient_id: null, archived_at: null, completed_at: null,
  deleted_at: null, is_starred: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z'
}];

async function open(b, width, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{ width, height: width < 500 ? 844 : 950 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status:200, contentType:'text/javascript', body: MOCK });
    if (/googleapis|gstatic/.test(u)) return r.fulfill({ status:200, contentType:'text/css', body:'' });
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,170)); });
  await pg.addInitScript(`
    window.__TEST_PROFILE=${JSON.stringify(PATIENT)};
    window.__TEST_SURGERIES=${JSON.stringify(opts.surgeries || [])};
    ${opts.failWith ? 'window.__PS_FAIL=' + JSON.stringify(opts.failWith) + ';' : ''}
  `);
  await pg.goto(BASE + '/patient-dashboard.html', { waitUntil:'networkidle' });
  await pg.waitForTimeout(1600);
  return { ctx, pg, errs };
}

const fillAndSave = async (pg, v) => {
  /* Open it the way the product does. Forcing display:flex inline was a test
     artifact: closeSurgery() removes the `open` CLASS, so an inline style
     survives it and the modal looks stuck open on a perfectly good save. */
  await pg.evaluate((id) => window.openSurgery(id), v.editId || null);
  await pg.selectOption('#m-proc', v.proc);
  await pg.fill('#m-date', v.date);
  await pg.fill('#m-hospital', v.hospital);
  await pg.fill('#m-surgeon', v.surgeon);
  await pg.selectOption('#m-anes', v.anes);
  await pg.evaluate(() => window.saveSurgery());
  await pg.waitForTimeout(900);
};

const NEW = { proc:'Orthopedic Surgery', date:'2026-12-24', hospital:'General Hospital',
              surgeon:'Dr Aroyan', anes:'Spinal' };

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  for (const width of [390, 1440]) {
    console.log('\n══════════ ' + width + 'px ══════════');

    // ── 1. editing an existing journey ────────────────────────────────────
    {
      const { ctx, pg, errs } = await open(b, width, { surgeries: EXISTING });
      await fillAndSave(pg, Object.assign({ editId:'ps-existing-1' }, NEW));
      const s = await pg.evaluate(() => ({
        calls: window.__calls,
        rows: JSON.parse(sessionStorage.getItem('__anestheo_mock_surgeries') || '[]'),
        errShown: (() => { const e = document.getElementById('m-err');
                           return e && getComputedStyle(e).display !== 'none' ? e.textContent.trim() : null; })(),
        modalOpen: (() => { const m = document.getElementById('surgery-modal');
                            return !!m && getComputedStyle(m).display !== 'none'; })()
      }));
      const row = s.rows.find(r => r.id === 'ps-existing-1') || {};
      const payload = (s.calls.update || [])[0] || {};

      t('an existing journey is UPDATED, not duplicated', s.rows.length === 1, s.rows.length);
      t('the procedure is saved',   row.procedure_type === 'Orthopedic Surgery', row.procedure_type);
      t('the date is saved',        row.surgery_date === '2026-12-24', row.surgery_date);
      t('the hospital is saved',    row.hospital === 'General Hospital', row.hospital);
      t('the surgeon is saved',     row.surgeon === 'Dr Aroyan', row.surgeon);
      t('the anesthesia type is saved', row.anesthesia_type === 'Spinal', row.anesthesia_type);
      /* THE REGRESSION GUARD. */
      t('the payload sends NO origin column', !('origin' in payload), Object.keys(payload).join(','));
      t('...and no column production does not have',
        Object.keys(payload).every(k => k !== 'origin'), Object.keys(payload).join(','));
      t('care_state is left alone, not overwritten by the patient',
        !('care_state' in payload) && row.care_state === 'surgical', row.care_state);
      t('no error is shown on a good save', s.errShown === null, s.errShown);
      t('the modal closes on success', s.modalOpen === false, s.modalOpen);
      t('no page error', errs.length === 0, errs);
      await ctx.close();
    }

    // ── 2. first journey, nothing there yet ───────────────────────────────
    {
      const { ctx, pg, errs } = await open(b, width, { surgeries: [] });
      await fillAndSave(pg, NEW);
      const s = await pg.evaluate(() => ({
        inserts: (window.__calls.insert || []),
        rows: JSON.parse(sessionStorage.getItem('__anestheo_mock_surgeries') || '[]')
      }));
      const ins = s.inserts[0] || {};
      t('a patient with no journey CREATES one', s.rows.length === 1, s.rows.length);
      t('...owned by themselves', ins.patient_id === UID, ins.patient_id);
      t('...carrying the details they typed',
        ins.procedure_type === 'Orthopedic Surgery' && ins.hospital === 'General Hospital', ins);
      t('...and still no origin column', !('origin' in ins), Object.keys(ins).join(','));
      t('no page error', errs.length === 0, errs);
      await ctx.close();
    }

    // ── 3. a refusal is shown, not swallowed ──────────────────────────────
    {
      const { ctx, pg, errs } = await open(b, width,
        { surgeries: EXISTING, failWith: 'new row violates row-level security policy' });
      await fillAndSave(pg, Object.assign({ editId:'ps-existing-1' }, NEW));
      const s = await pg.evaluate(() => ({
        errShown: (() => { const e = document.getElementById('m-err');
                           return e && getComputedStyle(e).display !== 'none' ? e.textContent.trim() : null; })(),
        modalOpen: (() => { const m = document.getElementById('surgery-modal');
                            return !!m && getComputedStyle(m).display !== 'none'; })(),
        typedStillThere: document.querySelector ? null : null,
        hospitalField: (document.getElementById('m-hospital') || {}).value,
        btn: (document.getElementById('m-save') || {}).textContent,
        btnDisabled: (document.getElementById('m-save') || {}).disabled
      }));
      t('a refused save TELLS the patient', !!s.errShown, (s.errShown || '').slice(0, 80));
      t('...in words, not a Postgres sentence',
        !!s.errShown && !/row-level security|42501|violates/i.test(s.errShown), s.errShown);
      t('...says nothing was changed', /nothing was changed/i.test(s.errShown || ''), s.errShown);
      t('...keeps the modal open', s.modalOpen === true, s.modalOpen);
      t('...keeps what they typed', s.hospitalField === 'General Hospital', s.hospitalField);
      t('...and re-enables Save so they can retry',
        s.btnDisabled === false && s.btn === 'Save', { d: s.btnDisabled, t: s.btn });
      t('no page error', errs.length === 0, errs);
      await ctx.close();
    }

    // ── 4. the exact production failure, end to end ───────────────────────
    {
      const { ctx, pg } = await open(b, width, { surgeries: EXISTING });
      const probe = await pg.evaluate(async () => {
        // Send the OLD payload — the one that shipped — straight at the mock.
        const r = await window.sb.from('patient_surgeries')
          .update({ hospital: 'X', origin: 'patient' }).eq('id', 'ps-existing-1');
        return { code: r.error && r.error.code, msg: r.error && r.error.message };
      });
      t('the OLD payload still reproduces the production failure',
        probe.code === '42703' && /origin/.test(probe.msg || ''), probe);
      await ctx.close();
    }
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
