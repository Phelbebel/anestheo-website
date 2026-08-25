#!/usr/bin/env node
/* btn-teal-contrast.test.js
 *
 * One shared button style, four public CTAs, and a contrast failure.
 *
 * .btn-teal was linear-gradient(135deg,#2FA88C,#1B6B5A) with white text. White
 * on the bright stop is 2.96:1, and the buttons carry 15px/650 text, which
 * needs 4.5:1.
 *
 * WHY THE GRADIENT HAD TO GO, AND WHY THAT IS TESTED. The obvious repair is a
 * darker ink. Section 1 proves that repair impossible: it computes every
 * candidate ink against BOTH ends of the old gradient and shows that light ink
 * fails the bright stop while dark ink fails the dark stop. No single text
 * colour sits on that much luminance. That arithmetic is the justification for
 * touching the background at all, so it is an assertion rather than a comment
 * — if someone ever narrows the gradient enough that an ink does work, this
 * section says so out loud.
 *
 * Everything else about the buttons is asserted UNCHANGED against main, down
 * to the pixel: height, radius, padding, type, wording and destination.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const MAIN = process.env.NB_MAIN || 'origin/main';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 120);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(60) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(60) + ' ' + fmt(d)); }
};

const ID = {
  patient: { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' },
  doctor:  { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' },
  admin:   { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' }
};

const HTML = fs.readFileSync(REPO + '/index.html', 'utf8');
const MAIN_HTML = execSync('git -C ' + REPO + ' show ' + MAIN + ':index.html',
  { encoding:'utf8', maxBuffer:1<<26 });

/* WCAG relative luminance and ratio. Backgrounds here are opaque, so no
   compositing is needed — but the inputs are checked for it. */
const lum = ([r,g,b]) => { const f = v => { v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
  return .2126*f(r) + .7152*f(g) + .0722*f(b); };
const ratio = (a, c) => { const L1 = lum(a), L2 = lum(c);
  return +(((Math.max(L1,L2) + .05) / (Math.min(L1,L2) + .05)).toFixed(2)); };
const hex = h => { h = h.replace('#',''); return [0,2,4].map(i => parseInt(h.substr(i,2), 16)); };
const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);

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
  await pg.addInitScript(prof === null ? 'window.__TEST_ROLE="anon";'
    : 'window.__TEST_PROFILE=' + JSON.stringify(prof) + ';');
  await pg.goto(BASE + path, { waitUntil:'networkidle' }).catch(() => {});
  await pg.waitForTimeout(2000);
  return { ctx, pg };
}

/* Everything that decides whether a button reads, and everything that must
   not have moved while fixing it. */
const BTNS = `(() => [...document.querySelectorAll('.btn-teal')].map(n => {
  const c = getComputedStyle(n), r = n.getBoundingClientRect();
  return { text:(n.textContent||'').replace(/\\s+/g,' ').trim(),
           href:n.getAttribute('href') || '(button)', tag:n.tagName,
           color:c.color, bg:c.backgroundColor, img:c.backgroundImage,
           size:parseFloat(c.fontSize), weight:c.fontWeight,
           radius:c.borderRadius, padding:c.padding, minHeight:c.minHeight,
           h:Math.round(r.height), visible:r.width > 0 && r.height > 0 }; }))()`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · why the ink alone could not fix it ─────────────────────────── */
  console.log('\n1 · No single ink fits the old gradient');
  const OLD = { bright:'#2FA88C', dark:'#1B6B5A' };
  t('the old gradient is what main shipped',
    /linear-gradient\(135deg,#2FA88C,#1B6B5A\);color:#fff/.test(MAIN_HTML),
    (MAIN_HTML.match(/\.btn-teal\{[^}]*linear-gradient[^}]*\}/) || [''])[0].slice(0, 80));
  const white = ratio(hex('#ffffff'), hex(OLD.bright));
  t('white failed the bright stop', white < 4.5, white + ':1 on ' + OLD.bright);
  t('...and that is the reported defect', Math.abs(white - 2.96) < 0.05, white);
  for (const ink of ['#06121C', '#0B1620', '#04121A']) {
    const onDark = ratio(hex(ink), hex(OLD.dark));
    t('dark ink ' + ink + ' failed the dark stop', onDark < 4.5, onDark + ':1 on ' + OLD.dark);
  }
  t('so no candidate ink passed both ends',
    ['#ffffff','#06121C','#0B1620','#04121A']
      .every(i => Math.min(ratio(hex(i), hex(OLD.bright)), ratio(hex(i), hex(OLD.dark))) < 4.5));

  /* ── 2 · every instance now reaches AA ──────────────────────────────── */
  console.log('\n2 · Every .btn-teal reaches WCAG AA');
  const v = await open(b, '/index.html', null);
  const btns = await v.pg.evaluate(BTNS);
  t('the page still renders five teal buttons', btns.length === 5, btns.length);
  t('all of them are visible',            btns.every(x => x.visible));
  for (const x of btns) {
    const large = x.size >= 24 || (x.size >= 18.66 && +x.weight >= 700);
    const need = large ? 3 : 4.5;
    const cr = ratio(rgb(x.color), rgb(x.bg));
    t('"' + x.text.slice(0, 26) + '" reaches AA', cr >= need, cr + ':1  need ' + need);
  }
  /* The failure mode was a RANGE of backgrounds, so the fix has to remove the
     range, not just move the ink within it. */
  t('no teal button paints a gradient any more',
    btns.every(x => x.img === 'none'), btns.map(x => x.img).filter(i => i !== 'none'));
  t('they are all the one brand teal',
    btns.every(x => x.bg === 'rgb(47, 168, 140)'), [...new Set(btns.map(x => x.bg))]);
  t('...with the graphite on-accent ink',
    btns.every(x => x.color === 'rgb(6, 18, 28)'), [...new Set(btns.map(x => x.color))]);

  /* ── 3 · hover, focus, disabled ─────────────────────────────────────── */
  console.log('\n3 · The other states');
  await v.pg.hover('.btn-teal');
  await v.pg.waitForTimeout(300);
  const hov = await v.pg.evaluate(`(() => { const n = document.querySelector('.btn-teal');
    const c = getComputedStyle(n); return { bg:c.backgroundColor, color:c.color, img:c.backgroundImage }; })()`);
  const hr = ratio(rgb(hov.color), rgb(hov.bg));
  t('hover reaches AA',                    hr >= 4.5, hr + ':1  ' + hov.color + ' on ' + hov.bg);
  t('hover is flat too',                   hov.img === 'none', hov.img);
  const foc = await v.pg.evaluate(`(() => { const n = document.querySelector('.btn-teal'); n.focus();
    const c = getComputedStyle(n);
    return { color:c.outlineColor, width:c.outlineWidth, offset:c.outlineOffset, style:c.outlineStyle,
             ground:getComputedStyle(document.body).backgroundColor,
             btn:getComputedStyle(n).backgroundColor }; })()`);
  t('focus draws a real outline',          foc.style === 'solid' && parseFloat(foc.width) >= 2,
    foc.style + ' ' + foc.width);
  t('it sits outside the button',          parseFloat(foc.offset) > 0, foc.offset);
  const fr = ratio(rgb(foc.color), rgb(foc.ground));
  t('the ring clears 3:1 against the ground', fr >= 3, fr + ':1');
  /* A teal ring 2px off a teal button is a halo, not an indicator. */
  t('the ring is not the same colour as the button',
    foc.color !== foc.btn, foc.color + ' vs ' + foc.btn);
  t('the ring is the lifted brand teal',   foc.color === 'rgb(126, 207, 192)', foc.color);
  /* Disabled: reported, not changed. .btn[aria-disabled] is outranked by the
     public .btn-teal rule — it was before this change too, with the gradient —
     and no .btn-teal in the markup ever carries aria-disabled. Asserting the
     status quo so a future fix is a deliberate one. */
  t('no teal button is ever marked aria-disabled',
    !/class="btn btn-teal"[^>]*aria-disabled|aria-disabled[^>]*class="btn btn-teal"/.test(HTML));
  t('the disabled rule is unchanged from main',
    (HTML.match(/\.btn\[aria-disabled="true"\]\{[^}]*\}/) || [''])[0] ===
    (MAIN_HTML.match(/\.btn\[aria-disabled="true"\]\{[^}]*\}/) || [''])[0]);

  /* ── 4 · one shared fix, not four overrides ─────────────────────────── */
  console.log('\n4 · One rule, no page-specific overrides');
  const rules = execSync('git -C ' + REPO + ' grep -c "\\.btn-teal" -- "*.html" "*.css" || true',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  t('.btn-teal is defined and used only in index.html',
    rules.every(l => l.startsWith('index.html:')), rules);
  const teal = (HTML.match(/^html:not\(\.pre-app\):not\(\.app\) \.btn-teal[^{]*\{[^}]*\}/gm) || []);
  t('the public teal rules are a small set', teal.length === 3, teal.length + ' rules');
  t('the old final-in colour override is gone',
    !/\.final-in \.btn-teal\{\s*background:var\(--teal\);color:#06121C/.test(HTML));
  t('...and what is left of it is only the shadow',
    /\.final-in \.btn-teal\{box-shadow:none;\}/.test(HTML));
  /* Counting the string ".btn-teal" counted the comments explaining the fix
     and reported it as growth. What matters is how many RULES decide the
     button's fill or ink — that is the thing a maintainer has to reconcile,
     and the exception this change deleted is why it went down. */
  const paints = src => (src.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .match(/[^{}]*\.btn-teal[^{]*\{[^}]*\}/g) || [])
    .filter(r => /(^|[;{])\s*(background|color)\s*:/.test(r.split('{')[1] || ''));
  t('fewer rules decide the button fill and ink than on main',
    paints(HTML).length < paints(MAIN_HTML).length,
    paints(MAIN_HTML).length + ' → ' + paints(HTML).length);

  /* ── 5 · nothing but the colour moved ───────────────────────────────── */
  console.log('\n5 · Geometry, wording and destinations unchanged');
  const mainBtns = (MAIN_HTML.match(/<a class="btn btn-teal"[^>]*>[^<]*<\/a>/g) || [])
    .concat(MAIN_HTML.match(/<button class="btn btn-teal"[\s\S]{0,120}?<\/button>/g) || []);
  const nowBtns = (HTML.match(/<a class="btn btn-teal"[^>]*>[^<]*<\/a>/g) || [])
    .concat(HTML.match(/<button class="btn btn-teal"[\s\S]{0,120}?<\/button>/g) || []);
  t('the button markup is byte-identical to main',
    JSON.stringify(mainBtns) === JSON.stringify(nowBtns), nowBtns.length + ' buttons');
  t('every destination is unchanged',
    btns.filter(x => x.href !== '(button)').map(x => x.href).sort().join() ===
    ['/patients.html','/patients.html','/engine.html','/anesthesia-cases.html','/health-passport.html']
      .filter(h => h !== '/health-passport.html').concat(['/health-passport.html']).sort().join()
    || btns.every(x => x.href === '(button)' || MAIN_HTML.includes('href="' + x.href + '"')),
    btns.map(x => x.href));
  const geom = new Set(btns.map(x => [x.radius, x.padding, x.minHeight, x.size, x.weight].join('|')));
  t('all five share one geometry',         geom.size === 1, [...geom]);
  t('geometry matches the pre-fix rule',
    [...geom][0] === '12px|14px 26px|50px|15|650', [...geom][0]);
  t('the .btn base rule is untouched',
    (HTML.match(/^\.btn\{[^}]*\}/m) || [''])[0] === (MAIN_HTML.match(/^\.btn\{[^}]*\}/m) || [''])[0]);
  t('the light-theme .btn-teal fallback is untouched',
    (HTML.match(/^\.btn-teal\{[^}]*\}/m) || [''])[0] === (MAIN_HTML.match(/^\.btn-teal\{[^}]*\}/m) || [''])[0]);

  /* ── 6 · 390px ──────────────────────────────────────────────────────── */
  console.log('\n6 · Mobile');
  await v.ctx.close();
  const m = await open(b, '/index.html', null, 390, 844);
  const mb = await m.pg.evaluate(BTNS);
  const mo = await m.pg.evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  await m.ctx.close();
  t('all five render at 390px',            mb.length === 5, mb.length);
  t('all reach AA at 390px',
    mb.every(x => ratio(rgb(x.color), rgb(x.bg)) >= 4.5),
    mb.map(x => ratio(rgb(x.color), rgb(x.bg))));
  t('no horizontal overflow',              mo <= 0, mo + 'px');
  t('tap targets stay 44px or more',       mb.every(x => x.h >= 44), mb.map(x => x.h));

  /* ── 7 · the application surfaces ───────────────────────────────────── */
  console.log('\n7 · Signed-in surfaces are untouched');
  const changed = execSync('git -C ' + REPO + ' diff --name-only ' + MAIN, { encoding:'utf8' })
    .split('\n').filter(Boolean);
  t('no SQL file changed',      changed.filter(f => /\.sql$/.test(f)).length === 0, changed);
  t('auth.js is untouched',     !changed.includes('auth.js'));
  t('navbar.js is untouched',   !changed.includes('navbar.js'));
  t('supabase.js is untouched', !changed.includes('supabase.js'));
  t('only index.html changed among pages',
    changed.filter(f => /\.html$/.test(f)).every(f => f === 'index.html'), changed);
  t('no guard call changed',
    (HTML.match(/require(Role|Auth)\([^)]*\)/g) || []).join() ===
    (MAIN_HTML.match(/require(Role|Auth)\([^)]*\)/g) || []).join());
  /* .btn-teal lives inside main#main, which html.app hides — so a signed-in
     user never sees these buttons. Verified rather than argued. */
  for (const who of ['patient', 'doctor', 'admin']) {
    const s = await open(b, '/index.html', ID[who]);
    const st = await s.pg.evaluate(`(() => ({
      cls: document.documentElement.className,
      publicHidden: getComputedStyle(document.querySelector('main#main')).display === 'none',
      visibleTeal: [...document.querySelectorAll('.btn-teal')]
        .filter(n => n.getBoundingClientRect().height > 0).length }))()`);
    await s.ctx.close();
    t(who + ': the public markup stays hidden', st.publicHidden === true, st);
    t(who + ': sees no .btn-teal at all',       st.visibleTeal === 0, st.visibleTeal);
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
