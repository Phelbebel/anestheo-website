/* Doctor registration must work on BOTH sides of v9_1.

   Production today: v9_1 is applied, v9 is not. set_own_role() refuses
   'doctor', so the live role-select.html cannot register a doctor at all.
   This proves the hotfix restores it WITHOUT claiming access the database has
   not granted — routing stays on /doctor-pending.html until v9 lands.

   And it proves the fallback: on a database that has NOT had v9_1 applied, the
   RPC is absent and the old two-step must still work, because this file gets
   deployed before anyone checks which side of the migration a database is on. */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');
const MOCK = fs.readFileSync('/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 110);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(58) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(58) + ' ' + fmt(d)); }
};

async function run(b, opts) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  let mock = MOCK;
  if (opts.legacy) {
    // A database WITHOUT v9_1: the RPC does not exist, set_own_role takes doctor.
    mock = mock.replace(
      "if(fn === 'submit_doctor_onboarding'){",
      "if(fn === 'submit_doctor_onboarding'){ record('rpc',{fn:fn,args:p}); " +
      "return Promise.resolve({data:null,error:{code:'42883'," +
      "message:'function public.submit_doctor_onboarding(text,text,text,text,text,text,text,text) does not exist'}}); }\n" +
      "  if(false){");
    mock = mock.replace(
      "if(fn === 'set_own_role' && String(p.p_role || '').toLowerCase() === 'doctor'){",
      "if(false && fn === 'set_own_role'){");
  }
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status:200, contentType:'text/javascript', body: mock });
    if (/googleapis|gstatic/.test(u)) return r.fulfill({ status:200, contentType:'text/css', body:'' });
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,150)); });
  await pg.addInitScript(
    "window.__TEST_PROFILE={id:'9e000000-0000-4000-8000-00000000cafe',email:'d@e.com'," +
    "role:'pending',verification_status:'not_required',is_admin:false};");
  await pg.goto('http://127.0.0.1:8890/role-select.html', { waitUntil:'networkidle' });
  await pg.waitForTimeout(1100);
  await pg.click('#ro-doctor'); await pg.waitForTimeout(350);
  await pg.fill('#d-name', 'Dana Levi'); await pg.click('#lvl-resident');
  await pg.selectOption('#d-country', 'Israel'); await pg.fill('#d-phone', '050-123 4567');
  await pg.fill('#d-license', 'IL-99231'); await pg.fill('#d-hospital', 'Central');
  await pg.fill('#d-university', 'Tbilisi State'); await pg.selectOption('#d-specialty', 'Anesthesiology');
  await pg.click('#d-submit'); await pg.waitForTimeout(1800);
  const s = await pg.evaluate(() => ({
    url: location.pathname,
    rpc: (window.__calls.rpc || []).map(c => c.fn),
    setRole: (window.__calls.rpc || []).some(c => c.fn === 'set_own_role' && c.args.p_role === 'doctor'),
    profile: JSON.parse(sessionStorage.getItem('__anestheo_mock_profile') || '{}'),
    err: ((document.getElementById('doctor-err') || {}).textContent || '').trim()
  }));
  await ctx.close();
  return { s, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  console.log('\n── production TODAY: v9_1 applied, v9 NOT applied ──');
  {
    const { s, errs } = await run(b, { legacy:false });
    t('registration goes through submit_doctor_onboarding',
      s.rpc.indexOf('submit_doctor_onboarding') >= 0, s.rpc.join(','));
    t('...never calls the now-refused set_own_role("doctor")', s.setRole === false);
    t('...and SUCCEEDS — this is what is broken in production today',
      s.err === '', s.err || '(no error)');
    t('...the account really is a doctor now', s.profile.role === 'doctor', s.profile.role);
    t('...with the professional details stored',
      s.profile.medical_license_number === 'IL-99231', s.profile.medical_license_number);
    /* The important restraint: v9 is NOT applied, so the database still denies
       an unapproved doctor every clinical table. Sending them to the workspace
       would show an empty screen and call it access. */
    t('...routing UNCHANGED: still /doctor-pending.html', s.url === '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
  }

  console.log('\n── a database WITHOUT v9_1: the old path must still work ──');
  {
    const { s, errs } = await run(b, { legacy:true });
    t('falls back to set_own_role when the RPC is absent', s.setRole === true, s.rpc.join(','));
    t('...registration still succeeds', s.err === '', s.err || '(no error)');
    t('...and still lands on /doctor-pending.html', s.url === '/doctor-pending.html', s.url);
    t('no page error', errs.length === 0, errs);
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
