#!/usr/bin/env node
/* founder-page.test.js
 *
 * /about.html stays the company story; /founder.html is the person behind it.
 *
 * THE ASSERTION THAT MATTERS MOST HERE IS A NEGATIVE ONE. A founder page is
 * the easiest place in a product to write something that is not true — a
 * board certification, a hospital, a number of years, a university — because
 * the sentences read so naturally. This repository names the founder in
 * exactly one place, the archived v1 site, and supports exactly four facts:
 * the name, the title "Anesthesiologist and ICU Doctor", the voice ("clear,
 * calm, honest language. No jargon.") and that he created Anestheo for
 * patients and doctors. Section 4 enforces that nothing else was invented,
 * against the RENDERED text, so a comment explaining the rule cannot satisfy
 * the rule.
 *
 * Section 1 protects the page that already worked: every sentence of the
 * existing About copy must survive, because the brief was to add to it, not
 * to replace it with a biography.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const MAIN = process.env.NB_MAIN || 'origin/main';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 150);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });

const ABOUT  = read('about.html');
const ABOUTC = code(ABOUT);
const FND    = read('founder.html');
const FNDC   = code(FND);

const PHOTO_PATH = '/images/founder-giga-nadiradze.jpg';

const PATIENT = { email:'p@e.com', role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana' };

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
  await pg.waitForTimeout(1400);
  return { ctx, pg, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ══ 1 · the About page that already worked is intact ════════════════════ */
  console.log('\n1 · /about.html keeps its content');
  const mainAbout = onMain('about.html');
  const SENTENCES = [
    'Anestheo is a platform of educational anesthesia resources and clinical reference tools',
    'built for patients preparing for surgery',
    'We help patients understand their anesthesia before surgery',
    'a simple pre-operative questionnaire that their clinician can review in advance',
    'Anestheo brings patient management, secure pre-operative questionnaires',
    'drug dosing, airway, regional, TIVA/TCI and sedation, emergency protocols and clinical scores',
    'All tools and content are provided for information and education only',
    'They support, but never replace, the professional judgement of a qualified clinician',
    'support@anestheo.com'
  ];
  for (const s of SENTENCES) {
    t('main had it: "' + s.slice(0, 40) + '…"', mainAbout.includes(s), s.slice(0, 30));
    t('...and it is still there',                ABOUT.includes(s));
  }
  for (const h of ['About Anestheo', 'Our mission', 'For patients', 'For clinicians', 'Reference, not advice'])
    t('heading kept: ' + h, ABOUT.includes('>' + h + '<'), h);

  const g = await open(b, '/about.html', null);
  t('no page error', g.errs.length === 0, g.errs);
  const order = await g.pg.evaluate(`(() => {
    const y = sel => { const n = document.querySelector(sel); return n ? Math.round(n.getBoundingClientRect().top + scrollY) : null; };
    const hs = [...document.querySelectorAll('.legal-wrap h1, .legal-wrap h2')].map(n => n.textContent.trim());
    return { headings: hs, mission: y('.legal-wrap h1'), founder: y('.ab-founder'), note: y('.legal-note'),
             lastH2: y('.legal-wrap h2:last-of-type') }; })()`);
  t('the mission still leads the page',   order.mission < order.founder, order);
  t('the founder teaser sits AFTER the mission sections',
    order.lastH2 < order.founder, { lastH2: order.lastH2, founder: order.founder });
  t('...and before the contact note',     order.founder < order.note, order);
  t('the four original headings are unchanged and in order',
    JSON.stringify(order.headings) ===
    JSON.stringify(['About Anestheo','For patients','For clinicians','Reference, not advice']),
    order.headings);

  /* ══ 2 · exactly one teaser, pointing at the founder page ════════════════ */
  console.log('\n2 · The teaser');
  const teaser = await g.pg.evaluate(`(() => {
    const els = [...document.querySelectorAll('.ab-founder')];
    if (els.length !== 1) return { count: els.length };
    const e = els[0];
    const a = e.querySelector('a');
    return { count:1,
      eyebrow: (e.querySelector('.ab-fd-eyebrow')||{}).textContent||'',
      name:    (e.querySelector('.ab-fd-name')||{}).textContent||'',
      role:    (e.querySelector('.ab-fd-role')||{}).textContent||'',
      body:    (e.querySelector('.ab-fd-d')||{}).textContent.trim()||'',
      href:    a && a.getAttribute('href'),
      label:   a && a.textContent.trim(),
      tap:     a ? Math.round(a.getBoundingClientRect().height) : 0,
      photo:   !!e.querySelector('.ab-fd-photo'),
      img:     !!e.querySelector('img'),
      links:   e.querySelectorAll('a').length }; })()`);
  t('exactly one founder teaser on the page', teaser.count === 1, teaser.count);
  t('labelled Meet the founder',   /meet the founder/i.test(teaser.eyebrow), teaser.eyebrow);
  t('it names the founder',        teaser.name.trim() === 'Dr. Giga Nadiradze', teaser.name);
  t('...and his title',            /Anesthesiologist and ICU Doctor/.test(teaser.role), teaser.role);
  t('the summary is short — two or three sentences',
    (teaser.body.match(/\.\s|\.$/g) || []).length <= 3 && teaser.body.length < 340,
    (teaser.body.match(/\.\s|\.$/g) || []).length + ' sentences, ' + teaser.body.length + ' chars');
  t('it is not the whole biography',
    teaser.body.length < FNDC.replace(/<[^>]+>/g,'').length / 4, teaser.body.length);
  t('the CTA points at /founder.html', teaser.href === '/founder.html', teaser.href);
  t('...labelled About the founder',   /about the founder/i.test(teaser.label || ''), teaser.label);
  t('...and is a comfortable tap target', teaser.tap >= 44, teaser.tap + 'px');
  t('exactly one link out of the teaser', teaser.links === 1, teaser.links);
  t('a photo slot is present',            teaser.photo === true);
  await g.ctx.close();

  /* ══ 3 · the founder page is public ═════════════════════════════════════ */
  console.log('\n3 · /founder.html is public');
  const f = await open(b, '/founder.html', null);
  t('no page error', f.errs.length === 0, f.errs);
  const landed = await f.pg.evaluate('location.pathname');
  t('a logged-out visitor is not redirected', landed === '/founder.html', landed);
  t('no requireAuth / requireRole guard', !/requireAuth|requireRole/.test(FNDC));
  const pageScript = (FNDC.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('');
  t('no page script of its own', pageScript.trim() === '', pageScript.slice(0, 60));
  for (const call of ['.from(', '.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', 'sb.auth', 'getSession'])
    t('no Supabase ' + call, !FNDC.includes(call));
  t('no form to submit', !/<form[\s>]/i.test(FNDC));

  const p = await open(b, '/founder.html', PATIENT);
  const pPath = await p.pg.evaluate('location.pathname');
  await p.ctx.close();
  t('a signed-in patient sees the same page', pPath === '/founder.html', pPath);

  /* ══ 4 · identity, and nothing invented ═════════════════════════════════ */
  console.log('\n4 · Content — sourced, and no fabricated credentials');
  const shape = await f.pg.evaluate(`(() => ({
    title: document.title,
    h1: (document.querySelector('.fd-name')||{}).textContent||'',
    role: (document.querySelector('.fd-role')||{}).textContent||'',
    role2: (document.querySelector('.fd-role-2')||{}).textContent||'',
    sections: [...document.querySelectorAll('.fd-h')].map(n => n.textContent.trim()),
    crumb: (document.querySelector('.fd-crumb')||{}).textContent.replace(/\\s+/g,' ').trim(),
    crumbHref: (document.querySelector('.fd-crumb a')||{}).getAttribute('href'),
    text: document.body.innerText }))()`);
  t('the name is the h1',        shape.h1.trim() === 'Dr. Giga Nadiradze', shape.h1);
  t('the title is present',      /Anesthesiologist and ICU Doctor/.test(shape.role), shape.role);
  t('...and it is the one the archive supports',
    onMain('v1-source/videos.html').includes('Anesthesiologist and ICU Doctor'), 'v1-source');
  t('...as is the name',
    onMain('v1-source/videos.html').includes('Dr. Giga Nadiradze'), 'v1-source');
  t('he is identified as the founder', /Founder of Anestheo/.test(shape.role2), shape.role2);
  t('the page title names the founder', /founder/i.test(shape.title), shape.title);

  const WANT = ['About me','Clinical background','Why I created Anestheo',
                'How I think about anesthesia care','Back to Anestheo'];
  for (const s of WANT) t('section present: ' + s, shape.sections.includes(s), shape.sections);

  /* THE NEGATIVE ASSERTIONS. Rendered text, not source. */
  const BANNED = [
    'board certified','board-certified','fellowship','residency at','MD, PhD','PhD',
    'university of','professor','associate professor','head of department','chief of',
    'consultant at','years of experience','years of practice','over 1','thousands of patients',
    'award','prize','fellow of','diplomate','licensed in','certified by','graduated from',
    'barzilai','harvard','oxford','johns hopkins'
  ];
  const low = shape.text.toLowerCase();
  for (const phrase of BANNED)
    t('never claims "' + phrase + '"', !low.includes(phrase), phrase);

  const MARKETING = ['revolutionary','world-class','world class','the best','leading','guaranteed',
                     'safer outcomes','proven results','cutting-edge','game-changing','trusted by'];
  for (const phrase of MARKETING)
    t('no over-marketing: "' + phrase + '"', !low.includes(phrase), phrase);

  t('it keeps the reference-not-advice line',
    /supports, but never replaces, the professional judgement of a qualified clinician/i.test(shape.text));
  t('it does not claim to decide anything clinical',
    /your anesthesiologist decides that with you/i.test(shape.text));

  /* Prior copy actually reused, quoted from the archived v1 site. */
  const V1 = read('v1-source/videos.html');
  t('the archive is the only prior source, and it is still in the repo', V1.length > 0);
  t('reuses the v1 voice: "clear, calm" and "no jargon"',
    /clear, calm/i.test(shape.text) && /no jargon/i.test(shape.text) &&
    /clear, calm, honest language/i.test(V1) && /No jargon/i.test(V1));
  t('reuses the v1 line "explained in simple words"',
    /in simple words/i.test(shape.text) && /in simple words/i.test(V1));
  t('reuses about.html\'s own framing of reference vs instruction',
    /reference rather than as instruction|reference rather than instruction/i.test(shape.text));

  /* Nobody invented a founder photo either. */
  const photo = await f.pg.evaluate(`(() => {
    const box = document.querySelector('.fd-photo');
    const img = box && box.querySelector('img');
    const ph  = box && box.querySelector('.fd-ph');
    return { box: !!box, img: img ? img.getAttribute('src') : null,
             placeholder: !!ph,
             aria: ph ? ph.getAttribute('aria-label') : null,
             w: box ? Math.round(box.getBoundingClientRect().width) : 0,
             h: box ? Math.round(box.getBoundingClientRect().height) : 0,
             radius: box ? getComputedStyle(box).borderTopLeftRadius : null }; })()`);
  t('a portrait slot exists', photo.box === true);
  t('either a real photo or an explicit placeholder',
    (photo.img !== null) !== photo.placeholder, photo);
  t('no image file is referenced that does not exist',
    photo.img === null || fs.existsSync(REPO + photo.img.split('?')[0]), photo.img);
  t('the placeholder says what it is', /photograph/i.test(photo.aria || ''), photo.aria);
  t('the portrait is moderate, not a hero', photo.w <= 240 && photo.h <= 300, photo);
  t('...and rounded, not a circular avatar',
    parseFloat(photo.radius) > 0 && parseFloat(photo.radius) < photo.w / 2, photo.radius);
  t('the exact upload path is documented in both files',
    ABOUT.includes(PHOTO_PATH) && FND.includes(PHOTO_PATH), PHOTO_PATH);
  t('no emoji anywhere on the founder page',
    !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(shape.text), 'clean');

  /* Breadcrumb back to About. */
  t('a breadcrumb returns to About Anestheo',
    /About Anestheo\s*›\s*Founder/.test(shape.crumb) && shape.crumbHref === '/about.html', shape.crumb);

  /* ══ 5 · layout at both widths ══════════════════════════════════════════ */
  console.log('\n5 · Layout');
  await f.ctx.close();
  for (const [w, h, lbl] of [[390, 844, 'mobile 390'], [768, 1024, 'tablet 768'], [1440, 1200, 'desktop 1440']]) {
    for (const path of ['/founder.html', '/about.html']) {
      const s = await open(b, path, null, w, h);
      const m = await s.pg.evaluate(`(() => {
        const de = document.documentElement;
        const wide = [...document.querySelectorAll('body *')]
          .filter(n => n.getBoundingClientRect().right > de.clientWidth + 1)
          .slice(0, 4).map(n => n.className || n.tagName);
        const hero = document.querySelector('.fd-hero');
        const ph   = document.querySelector('.fd-photo');
        const tx   = document.querySelector('.fd-intro');
        return { overflow: de.scrollWidth - de.clientWidth, wide: wide,
                 stacked: (hero && ph && tx) ? (ph.getBoundingClientRect().bottom <= tx.getBoundingClientRect().top + 2) : null };
      })()`);
      await s.ctx.close();
      t(lbl + ' ' + path + ': no horizontal overflow', m.overflow <= 0, m);
      t(lbl + ' ' + path + ': nothing spills past the viewport', m.wide.length === 0, m.wide);
      if (path === '/founder.html') {
        if (w === 390) t('mobile: the photo sits ABOVE the text', m.stacked === true, m.stacked);
        if (w === 1440) t('desktop: photo and intro sit side by side', m.stacked === false, m.stacked);
      }
    }
  }

  /* ══ 6 · navigation is unchanged ════════════════════════════════════════ */
  console.log('\n6 · Navigation untouched');
  t('navbar.js is byte-identical to main', read('navbar.js') === onMain('navbar.js'));
  t('index.html is byte-identical to main', read('index.html') === onMain('index.html'));
  t('About is still reached from the public footer',
    onMain('index.html').includes('<a href="/about.html">About</a>') &&
    read('index.html').includes('<a href="/about.html">About</a>'));
  t('Founder is NOT added to the navbar',
    !/founder\.html/.test(read('navbar.js')), 'navbar clean');
  const linksToFounder = execSync(
    'grep -rl "founder.html" ' + REPO + ' --include="*.html" --include="*.js" 2>/dev/null || true',
    { encoding:'utf8' }).split('\n').filter(Boolean).map(x => x.replace(REPO + '/', ''));
  t('only about.html, the founder page and its test reference it',
    linksToFounder.every(x => ['about.html','founder.html','tools/founder-page.test.js'].includes(x)),
    linksToFounder);
  const dest = await (async () => {
    const s = await open(b, '/founder.html', null);
    const hrefs = await s.pg.evaluate(`(() => [...new Set(
      [...document.querySelectorAll('.page-wrap a[href^="/"], footer.site-footer a[href^="/"]')]
        .map(a => a.getAttribute('href').split('#')[0]))])()`);
    await s.ctx.close();
    return hrefs;
  })();
  for (const h of dest) t('destination exists: ' + h, fs.existsSync(REPO + h), h);

  /* ══ 7 · nothing security-related moved ═════════════════════════════════ */
  console.log('\n7 · No SQL, auth or RLS change');
  const modifiedSql = execSync('git -C ' + REPO + ' diff --name-only --diff-filter=M ' + MAIN + ' -- "*.sql"',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  t('no already-applied migration was rewritten', modifiedSql.length === 0, modifiedSql);
  const newSql = execSync('git -C ' + REPO + ' diff --name-only --diff-filter=A ' + MAIN + ' -- "*.sql"',
    { encoding:'utf8' }).split('\n').filter(Boolean);
  t('this branch adds no SQL at all', newSql.length === 0, newSql);
  for (const file of ['auth.js','supabase.js','navbar.js','clinical-open.js','patient-lifecycle.js',
                      'dashboard.html','ask.html','questions.html','patients.html'])
    t('untouched: ' + file, read(file) === onMain(file), file);
  for (const src of [ABOUTC, FNDC]) {
    t('page carries no GRANT/REVOKE/policy text',
      !/\b(GRANT|REVOKE|CREATE POLICY|ALTER TABLE|row-level security)\b/i.test(src));
    t('...and no auth guard', !/requireAuth|requireRole|is_admin|verification_status/.test(src));
  }
  const VERSION = read('VERSION').trim();
  const stamps = [...FND.matchAll(/(?:src|href)="\/[^"]+\?v=([^"]+)"/g)].map(m => m[1]);
  t('every local asset on the founder page is stamped', stamps.length >= 5, stamps.length);
  t('...at the current VERSION', stamps.every(s => s === VERSION), [...new Set(stamps)]);

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
