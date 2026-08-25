/* ═══════════════════════════════════════════════════════════════════════════
   accessnav.js — the deployment matrix.

   Five accounts × the eight surfaces, plus the Live Tools shape proof.

   The point is not that things open. It is WHICH things open for whom, now
   that v9 has separated two questions the product used to answer with one:
     · what someone does clinically  -> profiles.role
     · what someone may administer   -> is_platform_admin()
     · what someone has been checked for -> verification_status
   Verification no longer answers the first. It answers only the trust
   surfaces, and those are asserted here too.
   ═══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');
const MOCK = fs.readFileSync('/tmp/adm/mock.js', 'utf8');
const ADMINMOCK = fs.readFileSync('/tmp/adm/adminmock.js', 'utf8');
const BASE = 'http://127.0.0.1:8890';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 100);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('    ok   ' + n.padEnd(58) + ' ' + fmt(d)); }
  else    { fail++; console.log('    FAIL ' + n.padEnd(58) + ' ' + fmt(d)); }
};

const UID = '9e000000-0000-4000-8000-00000000cafe';
const P = o => Object.assign({ id: UID, email: 'x@t.test', full_name: 'Dana Levi',
  role: 'patient', is_admin: false, verification_status: 'not_required' }, o);

const ACCOUNTS = {
  'verified doctor'   : P({ role:'doctor', verification_status:'approved' }),
  'unverified doctor' : P({ role:'doctor', verification_status:'pending'  }),
  'doctor + admin'    : P({ role:'doctor', verification_status:'approved', is_admin:true }),
  'pure admin'        : P({ role:'admin',  is_admin:true }),
  'patient'           : P({})
};

async function open(b, url, profile, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport:{ width: opts.w || 1440, height: 950 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u))
      return r.fulfill({ status:200, contentType:'text/javascript', body: opts.admin ? ADMINMOCK : MOCK });
    if (/googleapis|gstatic/.test(u)) return r.fulfill({ status:200, contentType:'text/css', body:'' });
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,140)); });
  pg.on('console', m => { if (m.type() === 'error' &&
    !/ERR_TUNNEL|ERR_PROXY|Failed to load resource|recycle_bin_list/i.test(m.text()))
    errs.push('console: ' + m.text().slice(0,140)); });
  if (!opts.admin) await pg.addInitScript(`window.__TEST_PROFILE=${JSON.stringify(profile)};`);
  await pg.goto(BASE + url, { waitUntil:'networkidle' });
  await pg.waitForTimeout(opts.settle || 1500);
  return { ctx, pg, errs };
}
const where = pg => pg.evaluate(() => location.pathname);

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ══ 1. WHO REACHES WHICH SURFACE ═════════════════════════════════════════
  const SURFACES = [
    ['Doctor Workspace', '/dashboard.html'],
    ['Live Chart',       '/anesthesia-cases.html'],
    ['Live Tools',       '/engine.html'],
    ['Settings',         '/settings.html'],
    ['Health Passport',  '/health-passport.html']
  ];
  const CLINICAL = ['verified doctor','unverified doctor','doctor + admin'];

  for (const [who, profile] of Object.entries(ACCOUNTS)) {
    console.log('\n  ── ' + who + ' ──');
    for (const [label, url] of SURFACES) {
      const { ctx, pg, errs } = await open(b, url, profile);
      const at = await where(pg);
      /* Settings is requireAuth(), not requireRole('staff') — a patient needs
         it for their own name, password and photo. Classing it as staff-only
         was my matrix being wrong about the product, not the product being
         wrong. Health Passport is personal for the same reason. */
      const personal = (url === '/health-passport.html' || url === '/settings.html');
      /* LIVE TOOLS IS NOW PUBLIC, and this assertion changed with it.
         It used to read "Live Tools: patient is kept out", which was correct
         while /engine.html sat behind requireRole('staff'). That guard was
         removed deliberately: an audit found the page makes no Supabase read,
         no RPC and no fetch, stores no identifier, and its one backend call —
         get_evidence — is granted to `anon`. The gate protected nothing.

         Once the page opens for an anonymous visitor, keeping a SIGNED-IN
         patient out is theatre: it is the same person one sign-out apart, and
         the only thing the check would achieve is punishing them for having an
         account. What a patient is still kept out of is the workspace and the
         clinician reference library, and both are asserted — here for
         /dashboard.html, and in public-clinician-and-cta.test.js for the ten
         reference pages. */
      const publicTool = (url === '/engine.html');
      const staffSurface = !personal && !publicTool;
      if (personal) {
        /* THE HEALTH PASSPORT IS PERSONAL. Every account reaches their own,
           and a clinician must never be bounced to the Doctor Dashboard for
           opening it — that was the bug. */
        t(label + ': reachable by anyone signed in', at === url, at);
        t(label + ': not bounced to the workspace', at !== '/dashboard.html', at);
        if (url === '/health-passport.html')
          t(label + ': not bounced to My Space either', at !== '/patient-dashboard.html', at);
      } else if (publicTool) {
        t(label + ': open to every account, by design', at === url, at);
      } else if (CLINICAL.includes(who) || who === 'pure admin') {
        t(label + ': reachable', at === url, at);
      } else {
        t(label + ': patient is kept out', at !== url, at);
      }
      t(label + ': no page error', errs.length === 0, errs);
      await ctx.close();
    }
  }

  // ══ 2. VERIFICATION IS NOT THE ACCESS GATE ═══════════════════════════════
  console.log('\n  ── an UNVERIFIED doctor has the ordinary product ──');
  {
    const { ctx, pg } = await open(b, '/anesthesia-cases.html', ACCOUNTS['unverified doctor']);
    const s = await pg.evaluate(() => {
      const btn = document.getElementById('n-go'), m = document.getElementById('n-err');
      return { disabled: !!btn && btn.disabled, label: btn ? btn.textContent.trim() : null,
               note: m && getComputedStyle(m).display !== 'none' ? m.textContent.trim() : null };
    });
    t('Live Chart: may open a record', s.disabled === false, s.label);
    t('Live Chart: no verification restriction shown',
      !/verif/i.test((s.label || '') + ' ' + (s.note || '')), s);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/dashboard.html', ACCOUNTS['unverified doctor']);
    const s = await pg.evaluate(() => {
      const bn = document.querySelector('.verify-banner');
      return { text: bn ? bn.textContent.replace(/\s+/g,' ').trim() : null,
               sticky: !!document.getElementById('auth-pending-doctor-notice') };
    });
    /* REWRITTEN DELIBERATELY, because the sentence these assertions were
       holding is no longer true.

       The old banner said verification was an OFFER and that "your workspace,
       your patients and Live Chart are open as normal". Patients are not open
       as normal: v9_5_verification_boundary.sql keeps every patient-management
       table behind verification_status='approved', which is the whole point of
       this change. A test that insisted the banner call patient access open
       would now be enforcing the bug.

       What is asserted instead: the banner names the two things that ARE open,
       does not claim patients are, and offers the way forward. The detail —
       what verification unlocks, item by item — moved to the card in the
       welcome panel, which is checked in verification-boundary.test.js. */
    t('Dashboard: the prompt names what IS open',
      !!s.text && /Live Tools/i.test(s.text) && /Live Chart/i.test(s.text), (s.text||'').slice(0,90));
    t('...and does NOT claim patient access is open',
      !!s.text && !/your patients (are|stay) open/i.test(s.text), (s.text||'').slice(0,90));
    t('...and offers the way to verification',
      /Complete verification/i.test(s.text||''), (s.text||'').slice(0,90));
    t('...and does not claim patient records are closed in a dead-end way',
      !/records? (stay|are) closed/i.test(s.text||''), (s.text||'').slice(0,70));
    t('...no stale sticky restriction banner', s.sticky === false);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/dashboard.html', ACCOUNTS['verified doctor']);
    const bn = await pg.evaluate(() => !!document.querySelector('.verify-banner'));
    t('a VERIFIED doctor sees no prompt at all', bn === false);
    await ctx.close();
  }

  // ══ 3. TWO DIMENSIONS ════════════════════════════════════════════════════
  console.log('\n  ── doctor + admin is both; pure admin is not a clinician ──');
  {
    const { ctx, pg } = await open(b, '/settings.html', ACCOUNTS['doctor + admin']);
    const s = await pg.evaluate(() => {
      const g = id => document.getElementById(id), vis = e => !!e && getComputedStyle(e).display !== 'none';
      return { acct: (g('v-acctype')||{}).textContent || '',
               professional: vis(g('professional-section')), personal: vis(g('personal-section')) };
    });
    t('Settings: described as BOTH', /doctor/i.test(s.acct) && /admin/i.test(s.acct), s.acct);
    t('Settings: keeps the professional profile', s.professional === true, s);
    t('Settings: not shown the patient form', s.personal === false, s);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/dashboard.html', ACCOUNTS['doctor + admin']);
    const role = await pg.evaluate(() => {
      const el = document.getElementById('nb-menu-role');
      return el ? el.textContent.trim() : null;
    });
    t('Navbar: Anesthesiologist AND Administrator',
      /Anesthesiologist/.test(role||'') && /Administrator/.test(role||''), role);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/settings.html', ACCOUNTS['pure admin']);
    const s = await pg.evaluate(() => {
      const g = id => document.getElementById(id), vis = e => !!e && getComputedStyle(e).display !== 'none';
      return { professional: vis(g('professional-section')) };
    });
    /* A pure administrator is not a clinical author. The database agrees:
       is_doctor_account() is false, so anes_case_insert refuses them. */
    t('pure admin gets no professional/clinical profile', s.professional === false, s);
    await ctx.close();
  }

  // ══ 4. ADMIN CENTRE ══════════════════════════════════════════════════════
  console.log('\n  ── Admin Center ──');
  {
    const { ctx, pg, errs } = await open(b, '/admin.html#/accounts', null, { admin:true, settle:2400 });
    const at = await where(pg);
    t('an administrator reaches it', at === '/admin.html', at);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }
  for (const who of ['verified doctor','patient']) {
    const { ctx, pg } = await open(b, '/admin.html', ACCOUNTS[who]);
    t('Admin Center: ' + who + ' is kept out', (await where(pg)) !== '/admin.html', await where(pg));
    await ctx.close();
  }

  // ══ 5. HEALTH PASSPORT ═══════════════════════════════════════════════════
  console.log('\n  ── Health Passport ──');
  {
    const { ctx, pg } = await open(b, '/health-passport.html', ACCOUNTS['verified doctor']);
    const s = await pg.evaluate(() => ({
      path: location.pathname,
      second: !!Array.from(document.querySelectorAll('button'))
        .find(x => /^Create my Health Passport$/i.test(x.textContent.trim()))
    }));
    t('a doctor opens their OWN passport, no redirect', s.path === '/health-passport.html', s.path);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/health-passport.html?create=1', ACCOUNTS['patient'], { settle:1900 });
    const s = await pg.evaluate(() => ({
      asking: /do not have a Health Passport yet/i.test((document.getElementById('app')||{}).textContent || ''),
      editor: !!document.querySelector('button[onclick="startAdd()"]')
    }));
    t('?create=1 goes straight into creation, no second step', s.asking === false, s);
    t('...and lands in the editor', s.editor === true, s);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/patients.html', ACCOUNTS['patient']);
    const s = await pg.evaluate(() => {
      const a = document.querySelector('.hp-feat a.ph-cta');
      const txt = (document.querySelector('.hp-feat')||{}).textContent || '';
      return { href: a ? a.getAttribute('href') : null, emdash: /secure QR\s*code\s*—/.test(txt) };
    });
    t('the create CTA carries the create intent', /create=1/.test(s.href||''), s.href);
    t('the em-dash copy is gone', s.emdash === false);
    await ctx.close();
  }

  // ══ 6. LIVE TOOLS SHAPE ══════════════════════════════════════════════════
  console.log('\n  ── Live Tools: standalone, no embed ──');
  {
    const { ctx, pg, errs } = await open(b, '/engine.html', ACCOUNTS['unverified doctor']);
    const s = await pg.evaluate(() => ({
      path: location.pathname,
      iframes: document.querySelectorAll('iframe').length,
      navbars: document.querySelectorAll('nav.nb, header.nb, #nb-root nav').length,
      toolsbar: document.querySelectorAll('nav.nb-tools').length
    }));
    t('an unverified doctor may use Live Tools', s.path === '/engine.html', s.path);
    t('no iframe anywhere on the page', s.iframes === 0, s.iframes);
    t('no duplicated nested navbar', s.navbars <= 1, s.navbars);
    t('the two-link section strip is present, not a second navbar', s.toolsbar === 1, s.toolsbar);
    t('no page error', errs.length === 0, errs);
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, '/dashboard.html', ACCOUNTS['verified doctor']);
    const s = await pg.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="engine.html"]'));
      return { count: links.length,
               allDirect: links.every(a => a.getAttribute('href') === '/engine.html'),
               iframes: document.querySelectorAll('iframe').length };
    });
    t('every Live Tools launcher goes straight to /engine.html',
      s.count > 0 && s.allDirect === true, s);
    t('the dashboard embeds no miniature workspace', s.iframes === 0, s.iframes);
    await ctx.close();
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
