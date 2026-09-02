/* shell.js — the mobile application shell.
 *
 * Five accounts x four widths. The point is not that a bar appears: it is that
 * the RIGHT bar appears for each role, that every destination in it is a route
 * the account could already reach, that nothing is listed twice, and that the
 * bar never covers the page it sits on.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const BASE = 'http://127.0.0.1:8890';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};

const UID = '9e000000-0000-4000-8000-00000000cafe';
const P = o => Object.assign({ id: UID, email: 'x@t.test', full_name: 'Dana Levi',
  role: 'patient', is_admin: false, verification_status: 'not_required' }, o);

const ACCOUNTS = {
  'verified doctor'  : P({ role:'doctor', verification_status:'approved' }),
  'unverified doctor': P({ role:'doctor', verification_status:'pending'  }),
  'doctor + admin'   : P({ role:'doctor', verification_status:'approved', is_admin:true }),
  'pure admin'       : P({ role:'admin',  is_admin:true }),
  'patient'          : P({}),
  'logged out'       : null
};

const WIDTHS = [['iPhone 390', 390, 844], ['iPhone 430', 430, 932],
                ['iPad portrait', 834, 1112], ['desktop', 1440, 900]];

async function open(b, w, h, profile, url) {
  const ctx = await b.newContext({ viewport:{ width:w, height:h } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status:200, contentType:'text/javascript', body:MOCK });
    if (/googleapis|gstatic/.test(u))  return r.fulfill({ status:200, contentType:'text/css', body:'' });
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { const m = (e && e.message) || String(e); if (m !== 'Object') errs.push(m.slice(0,140)); });
  await pg.addInitScript('window.__TEST_PROFILE=' + JSON.stringify(profile) +
    ';window.__TEST_ROLE="' + (profile ? 'session' : 'anon') + '"' +
    ';window.__TEST_HARDENED=true;window.__TEST_ONBOARD=true;');
  await pg.goto(BASE + (url || '/index.html'), { waitUntil:'networkidle' });
  await pg.waitForTimeout(1500);
  return { ctx, pg, errs };
}

/* offsetParent is null for anything position:fixed, so it cannot be used to
   ask whether the bar is on screen. Measure it instead. */
const readBar = pg => pg.evaluate(() => {
  const bar = document.getElementById('nb-tabbar');
  const vis = el => { if(!el) return false; const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' &&
           el.getBoundingClientRect().height > 0; };
  const visible = !!bar && bar.classList.contains('on') && vis(bar);
  const tabs = bar ? [...bar.children].map(el => ({
    label: (el.querySelector('.nb-tab-lb') || {}).textContent || '',
    href: el.getAttribute('href'),
    on: el.classList.contains('on'),
    sig: el.classList.contains('sig'),
    svg: !!el.querySelector('svg'),
    h: Math.round(el.getBoundingClientRect().height)
  })) : [];
  return { visible, tabs, hasClass: document.documentElement.classList.contains('nb-has-tabs') };
});

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · role → tab mapping, at 390 ─────────────────────────────────── */
  const EXPECT = {
    'verified doctor'  : ['Home','Patients','Live Tools','Live Chart','More'],
    /* CHANGED DELIBERATELY. The tab used to read "Patients" for every doctor.
       An unverified doctor has none and cannot have any until they are
       approved, so the word was the navigation promising something the
       database refuses. The DESTINATION is identical — /dashboard.html either
       way — and so is what they are allowed to do there. Only the label moved.
       See v9_5_verification_boundary.sql for the boundary itself. */
    'unverified doctor': ['Home','Workspace','Live Tools','Live Chart','More'],
    /* An administrator is never a pending doctor: is_pending_doctor() excludes
       them by is_admin, and so does the flag the shell is rendered from. */
    'doctor + admin'   : ['Home','Patients','Live Tools','Live Chart','More'],
    'pure admin'       : ['Home','Admin','Live Tools','Live Chart','More'],
    'patient'          : ['Home','Journey','Passport','Ask','More'],
    'logged out'       : null
  };
  console.log('\n── role → tabs @390 ──');
  for (const [name, profile] of Object.entries(ACCOUNTS)) {
    const { ctx, pg, errs } = await open(b, 390, 844, profile);
    const bar = await readBar(pg);
    const want = EXPECT[name];
    if (want === null) {
      t(name + ': no application shell', !bar.visible && !bar.hasClass, bar.tabs.length);
      /* index.html hides the whole bar for visitors by design, so the
         hamburger is checked on an ordinary public page. */
      const g = await open(b, 390, 844, null, '/patients.html');
      t(name + ': keeps the hamburger',
        await g.pg.evaluate(() => { const x = document.getElementById('nb-burger');
          return !!x && getComputedStyle(x).display !== 'none'; }));
      await g.ctx.close();
    } else {
      t(name + ': five tabs', bar.tabs.length === 5, bar.tabs.length);
      t(name + ': ' + want.join(' · '),
        JSON.stringify(bar.tabs.map(x => x.label)) === JSON.stringify(want),
        bar.tabs.map(x => x.label));
      t(name + ': every icon is an SVG, none an emoji', bar.tabs.every(x => x.svg));
      t(name + ': targets >= 44px', bar.tabs.every(x => x.h >= 44), bar.tabs.map(x => x.h));
      t(name + ': hamburger replaced by More',
        await pg.evaluate(() => { const x = document.getElementById('nb-burger');
                                  return !x || x.offsetParent === null; }));
    }
    t(name + ': no page error', errs.length === 0, errs);
    await ctx.close();
  }

  /* ── 2 · Live Tools is the signature item ───────────────────────────── */
  console.log('\n── Live Tools treatment ──');
  {
    const { ctx, pg } = await open(b, 390, 844, ACCOUNTS['verified doctor']);
    const bar = await readBar(pg);
    const lt = bar.tabs[2];
    t('Live Tools is the centre tab', lt.label === 'Live Tools', lt.label);
    t('...and carries the signature treatment', lt.sig === true);
    t('...and only it does', bar.tabs.filter(x => x.sig).length === 1);
    t('...pointing at the existing route', lt.href === '/engine.html', lt.href);
    const anim = await pg.evaluate(() => {
      const el = document.querySelector('.nb-tab.sig .nb-tab-ic');
      const cs = getComputedStyle(el);
      return { animation: cs.animationName, box: cs.boxShadow };
    });
    t('...with no animation — never a status claim', anim.animation === 'none', anim.animation);
    await ctx.close();
  }

  /* ── 3 · destinations resolve, and nothing is listed twice ──────────── */
  console.log('\n── destinations ──');
  for (const [name, profile] of [['verified doctor', ACCOUNTS['verified doctor']],
                                 ['patient', ACCOUNTS['patient']],
                                 ['doctor + admin', ACCOUNTS['doctor + admin']]]) {
    const { ctx, pg } = await open(b, 390, 844, profile);
    const bar = await readBar(pg);
    await pg.click('#nb-tab-more');
    await pg.waitForTimeout(350);
    const more = await pg.evaluate(() => {
      const l = document.getElementById('nb-more-list');
      return { open: document.getElementById('nb-mob').classList.contains('open'),
               items: [...l.querySelectorAll('a')].map(a => ({ label:a.textContent.trim(), href:a.getAttribute('href') })),
               legacyHidden: getComputedStyle(document.getElementById('nb-mob-navgrp')).display === 'none' };
    });
    t(name + ': More opens the sheet', more.open === true);
    t(name + ': legacy drawer nav stood down', more.legacyHidden === true);
    const barHrefs = bar.tabs.map(x => x.href).filter(Boolean);
    const dupes = more.items.filter(m => barHrefs.includes(m.href));
    t(name + ': nothing appears in both bar and More', dupes.length === 0, dupes.map(d => d.href));
    t(name + ': More has Sign out available',
      await pg.evaluate(() => !!document.querySelector('.nb-mob-signout')));
    if (name === 'doctor + admin')
      t('doctor + admin: Admin Center is in More, not the bar',
        more.items.some(m => m.href === '/admin.html'), more.items.map(m => m.href));
    if (name === 'verified doctor')
      t('verified doctor: no Verification entry when approved',
        !more.items.some(m => m.href === '/doctor-pending.html'));
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(b, 390, 844, ACCOUNTS['unverified doctor']);
    await pg.click('#nb-tab-more'); await pg.waitForTimeout(350);
    const items = await pg.evaluate(() => [...document.querySelectorAll('#nb-more-list a')].map(a => a.getAttribute('href')));
    t('unverified doctor: Verification offered in More', items.includes('/doctor-pending.html'), items);
    await ctx.close();
  }

  /* ── 4 · every tab destination actually opens ───────────────────────── */
  console.log('\n── every destination opens ──');
  {
    const routes = [['/index.html','Home'], ['/dashboard.html','Patients'],
                    ['/engine.html','Live Tools'], ['/anesthesia-cases.html','Live Chart']];
    for (const [url, label] of routes) {
      const { ctx, pg, errs } = await open(b, 390, 844, ACCOUNTS['verified doctor'], url);
      const bar = await readBar(pg);
      const active = bar.tabs.filter(x => x.on).map(x => x.label);
      t('doctor · ' + label + ' opens and marks itself active',
        active.length === 1 && active[0] === label, active);
      t('doctor · ' + label + ': no page error', errs.length === 0, errs);
      await ctx.close();
    }
    const proutes = [['/patient-dashboard.html','Journey'], ['/health-passport.html','Passport'],
                     ['/ask.html','Ask']];
    for (const [url, label] of proutes) {
      const { ctx, pg, errs } = await open(b, 390, 844, ACCOUNTS['patient'], url);
      const bar = await readBar(pg);
      const active = bar.tabs.filter(x => x.on).map(x => x.label);
      t('patient · ' + label + ' opens and marks itself active',
        active.length === 1 && active[0] === label, active);
      t('patient · ' + label + ': no page error', errs.length === 0, errs);
      await ctx.close();
    }
  }

  /* ── 5 · the bar never covers the page ──────────────────────────────── */
  console.log('\n── content clearance ──');
  for (const [url, who] of [['/dashboard.html','verified doctor'], ['/patient-dashboard.html','patient'],
                            ['/engine.html','verified doctor'], ['/settings.html','patient']]) {
    const { ctx, pg } = await open(b, 390, 844, ACCOUNTS[who], url);
    const geo = await pg.evaluate(() => {
      const el = document.getElementById('nb-tabbar');
      const bar = el.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(document.body).paddingBottom);
      window.scrollTo(0, document.body.scrollHeight);
      return { barTop: bar.top, barH: Math.round(bar.height), pad: Math.round(pad),
               shown: getComputedStyle(el).display !== 'none',
               immersive: document.documentElement.classList.contains('lt-immersive'),
               exit: !!document.querySelector('.ws-id-home'),
               vh: window.innerHeight, docW: document.documentElement.scrollWidth,
               winW: window.innerWidth };
    });
    await pg.waitForTimeout(200);
    t(url + ': body clears the bar', geo.pad >= geo.barH, { pad:geo.pad, bar:geo.barH });
    /* LIVE TOOLS SUPPRESSES THE BAR ON PURPOSE. It is a full-screen clinical
       instrument, and a site tab bar there both eats permanent clinical space
       and puts a navigation row beside the emergency control. So the claim on
       that page is not "the bar sits on the floor" — it is that the bar is
       gone COMPLETELY (no strip, no reserved padding) and that a way out of
       the tool still exists. Every other page keeps the original assertion,
       because navbar.js itself is untouched. */
    if (geo.immersive) {
      t(url + ': the site tab bar is suppressed for the workstation',
        geo.shown === false && geo.barH === 0 && geo.pad === 0,
        { shown:geo.shown, h:geo.barH, pad:geo.pad });
      t(url + ': ...and there is still a way back out of Live Tools',
        geo.exit === true);
    } else {
      t(url + ': bar sits on the viewport floor', Math.round(geo.barTop + geo.barH) === geo.vh,
        { top:Math.round(geo.barTop), h:geo.barH, vh:geo.vh });
    }
    t(url + ': no horizontal overflow', geo.docW <= geo.winW, { doc:geo.docW, win:geo.winW });
    await ctx.close();
  }

  /* ── 6 · stacking: modal and drawer stay above the bar ──────────────── */
  console.log('\n── stacking ──');
  {
    const { ctx, pg } = await open(b, 390, 844, ACCOUNTS['patient']);
    const z = await pg.evaluate(() => {
      const zi = s => parseInt(getComputedStyle(document.querySelector(s)).zIndex, 10);
      return { bar: zi('#nb-tabbar'), drawer: zi('#nb-mob'), backdrop: zi('#nb-mob-bg'),
               modal: zi('#nb-modal'), header: zi('#nb-nav') };
    });
    t('drawer above the bar', z.drawer > z.bar, z);
    t('backdrop above the bar', z.backdrop > z.bar, z);
    t('modal above everything', z.modal > z.drawer && z.modal > z.bar, z);
    t('header above the bar (both chrome)', z.header > z.bar, z);
    await ctx.close();
  }

  /* ── 7 · keyboard ───────────────────────────────────────────────────── */
  console.log('\n── keyboard ──');
  {
    const { ctx, pg } = await open(b, 390, 844, ACCOUNTS['verified doctor'], '/dashboard.html');
    const before = await pg.evaluate(() => document.getElementById('nb-tabbar').getBoundingClientRect().height > 0);
    const focused = await pg.evaluate(() => {
      /* The first match in the DOM may be inside a section that is not the
         active one, and an element in a display:none subtree cannot take
         focus. Pick the first field a person could actually reach. */
      const i = [...document.querySelectorAll('input[type=text],input:not([type]),textarea')]
        .find(el => el.getClientRects().length && !el.disabled && !el.readOnly);
      if (!i) return 'no visible field on page';
      i.focus();
      return document.activeElement === i ? 'ok' : 'focus refused';
    });
    t('a text field exists and takes focus', focused === 'ok', focused);
    await pg.waitForTimeout(250);
    const during = await pg.evaluate(() => document.getElementById('nb-tabbar').getBoundingClientRect().height > 0);
    await pg.evaluate(() => document.activeElement.blur());
    await pg.waitForTimeout(200);
    const after = await pg.evaluate(() => document.getElementById('nb-tabbar').getBoundingClientRect().height > 0);
    t('bar is up before typing', before === true);
    t('bar stands down while a field has focus', during === false);
    t('bar returns when focus leaves', after === true);
    await ctx.close();
  }

  /* ── 8 · widths: the shell is a phone shell ─────────────────────────── */
  console.log('\n── widths ──');
  for (const [label, w, h] of WIDTHS) {
    const { ctx, pg } = await open(b, w, h, ACCOUNTS['verified doctor']);
    const bar = await readBar(pg);
    const ws = await pg.evaluate(() => {
      const el = document.getElementById('nb-ws');
      return !!el && el.offsetParent !== null;
    });
    const phone = w <= 740;
    t(label + ': bar ' + (phone ? 'shown' : 'hidden'), bar.visible === phone, bar.visible);
    t(label + ': workspace switcher ' + (phone ? 'hidden' : 'shown'), ws === !phone, ws);
    await ctx.close();
  }

  /* ── 9 · the logo goes to the right Home ────────────────────────────── */
  console.log('\n── logo ──');
  for (const [name, profile] of Object.entries(ACCOUNTS)) {
    const { ctx, pg } = await open(b, 390, 844, profile);
    const href = await pg.evaluate(() => document.querySelector('.nb-logo').getAttribute('href'));
    t(name + ': logo → the role-aware root', href === '/index.html', href);
    await ctx.close();
  }

  /* ── 10 · back navigation ───────────────────────────────────────────── */
  console.log('\n── back navigation ──');
  {
    const { ctx, pg } = await open(b, 390, 844, ACCOUNTS['verified doctor']);
    await pg.click('.nb-tab[href="/engine.html"]');
    await pg.waitForTimeout(1200);
    const at = await pg.evaluate(() => location.pathname);
    await pg.goBack({ waitUntil:'networkidle' });
    await pg.waitForTimeout(1200);
    const back = await pg.evaluate(() => location.pathname);
    const bar = await readBar(pg);
    t('tapping Live Tools navigates', at === '/engine.html', at);
    t('browser back returns', back === '/index.html', back);
    t('...and the bar is still correct', bar.visible && bar.tabs.length === 5,
      bar.tabs.map(x => x.label));
    await ctx.close();
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
