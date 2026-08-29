#!/usr/bin/env node
/* founder-page.test.js
 *
 * /about.html stays the company story; /founder.html is the person behind it.
 *
 * THE ASSERTION THAT MATTERS MOST HERE IS A NEGATIVE ONE. A founder page is
 * the easiest place in a product to write something that is not true — a
 * board certification, a hospital, a number of years, a university — because
 * the sentences read so naturally. This repository names the founder in
 * exactly one place, the archived v1 site: the name, the voice ("clear, calm,
 * honest language. No jargon.") and that he created Anestheo for patients and
 * doctors. The subtitle is the one claim NOT from the archive -- the founder
 * supplied "Anesthesiologist and Pain Specialist" himself, and a person is the
 * authority on their own title. That distinction is asserted rather than
 * blurred, so the archive check below cannot quietly start passing for a
 * string the archive never contained. Section 4 enforces that nothing else was invented,
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

const PHOTO_MAIN = '/images/founder-giga-nadiradze.jpg';
const PHOTO_2ND  = '/images/founder-giga-nadiradze-2.jpg';

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
  t('...and his title',            teaser.role.trim() === 'Anesthesiologist and Pain Specialist', teaser.role);
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
  t('the subtitle is exactly the supplied title',
    shape.role.trim() === 'Anesthesiologist and Pain Specialist', shape.role);
  t('...and ICU Doctor is not reintroduced as a subtitle anywhere',
    !/class="fd-role"[^>]*>[^<]*ICU/i.test(FND) && !/class="ab-fd-role"[^>]*>[^<]*ICU/i.test(ABOUT),
    'no ICU subtitle');
  t('...nor in the founder page meta description',
    !/name="description"[^>]*ICU/i.test(FND));
  t('the About teaser carries the same subtitle, so one person has one title',
    /class="ab-fd-role">Anesthesiologist and Pain Specialist</.test(ABOUT));
  t('the name still comes from the archive',
    onMain('v1-source/videos.html').includes('Dr. Giga Nadiradze'), 'v1-source');
  t('...and the archive genuinely does NOT contain the new subtitle',
    !onMain('v1-source/videos.html').includes('Pain Specialist'),
    'title is founder-supplied, not archive-sourced');
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

  /* ── THE PHOTOGRAPHS ───────────────────────────────────────────────────
     Two real files, both tracked. The main portrait carries the hero and the
     About teaser; the second appears once, inside Clinical background, and
     nowhere else. The assertions below are mostly about that separation and
     about the second image staying subordinate, because "founder page" turns
     into "portfolio" exactly when a supporting picture stops supporting. */
  for (const [label, path] of [['main', PHOTO_MAIN], ['secondary', PHOTO_2ND]]) {
    const abs = REPO + path;
    t(label + ' image exists on disk', fs.existsSync(abs), path);
    const buf = fs.readFileSync(abs);
    t(label + ' image is a real JPEG', buf[0] === 0xFF && buf[1] === 0xD8 &&
      buf[buf.length-2] === 0xFF && buf[buf.length-1] === 0xD9, 'SOI/EOI intact');
    t(label + ' image is nontrivial', buf.length > 50000, buf.length + ' bytes');
    const tracked = execSync('git -C ' + REPO + ' ls-files -- "' + path.slice(1) + '"',
      { encoding:'utf8' }).trim();
    t(label + ' image is tracked in git', tracked === path.slice(1), tracked || '(untracked)');
  }
  t('the two photographs are different files',
    fs.readFileSync(REPO + PHOTO_MAIN).length !== fs.readFileSync(REPO + PHOTO_2ND).length &&
    !fs.readFileSync(REPO + PHOTO_MAIN).equals(fs.readFileSync(REPO + PHOTO_2ND)), 'distinct');

  const shot = await (async () => {
    const s = await open(b, '/founder.html', null);
    const v = await s.pg.evaluate(`(() => {
      const hero = document.querySelector('.fd-photo img');
      const fig  = document.querySelector('.fd-banner img');
      const box  = n => { const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      return {
        heroSrc: hero.getAttribute('src'), heroAlt: hero.getAttribute('alt'),
        heroBox: box(hero), heroFrame: box(hero.parentNode),
        heroLoaded: hero.complete && hero.naturalWidth > 0,
        heroNat: [hero.naturalWidth, hero.naturalHeight],
        heroFit: getComputedStyle(hero).objectFit,
        heroRadius: getComputedStyle(hero.parentNode).borderTopLeftRadius,
        figSrc: fig.getAttribute('src'), figAlt: fig.getAttribute('alt'),
        figBox: box(fig), figLoaded: fig.complete && fig.naturalWidth > 0,
        figNat: [fig.naturalWidth, fig.naturalHeight],
        heroTop: Math.round(hero.getBoundingClientRect().top + scrollY),
        figTop: Math.round(fig.getBoundingClientRect().top + scrollY),
        allImgs: [...document.querySelectorAll('.page-wrap img')].map(i => i.getAttribute('src').split('?')[0]),
        broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length };
    })()`);
    await s.ctx.close();
    return v;
  })();

  t('the hero uses the MAIN photograph', shot.heroSrc.split('?')[0] === PHOTO_MAIN, shot.heroSrc);
  t('...and it actually decoded in the browser', shot.heroLoaded === true, shot.heroNat);
  t('...at its real intrinsic size', shot.heroNat[0] === 2000 && shot.heroNat[1] === 1334, shot.heroNat);
  t('...with the required alt text', shot.heroAlt === 'Dr. Giga Nadiradze', shot.heroAlt);
  t('...object-fit cover', shot.heroFit === 'cover', shot.heroFit);
  t('...rounded, not circular',
    parseFloat(shot.heroRadius) > 0 && parseFloat(shot.heroRadius) < shot.heroBox.w / 2, shot.heroRadius);
  t('...roughly a 4:5 portrait',
    Math.abs((shot.heroBox.w / shot.heroBox.h) - 0.8) < 0.06, shot.heroBox);
  t('...and not oversized', shot.heroBox.w <= 240 && shot.heroBox.h <= 300, shot.heroBox);

  t('the secondary photograph appears once', shot.figSrc.split('?')[0] === PHOTO_2ND, shot.figSrc);
  t('...and it decoded', shot.figLoaded === true, shot.figNat);
  t('...with truthful alt text',
    shot.figAlt === 'Dr. Giga Nadiradze at work in the operating room', shot.figAlt);

  /* ── THE BANNER ────────────────────────────────────────────────────────
     It used to sit beside the Clinical background paragraphs. It now sits
     BETWEEN Clinical background and Why I created Anestheo, as a quiet break
     rather than an illustration, so the assertions are about position and
     proportion rather than about which section owns it. */
  const banner = await (async () => {
    const s = await open(b, '/founder.html', null);
    const v = await s.pg.evaluate(`(() => {
      const el = document.querySelector('.fd-banner');
      const img = el && el.querySelector('img');
      const y = n => Math.round(n.getBoundingClientRect().top + scrollY);
      const secTop = label => {
        const h = [...document.querySelectorAll('.fd-h')].filter(x => x.textContent.trim() === label)[0];
        return h ? y(h.closest('section')) : null; };
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      const wrap = document.querySelector('.page-wrap').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
               top: y(img), clinical: secTop('Clinical background'), why: secTop('Why I created Anestheo'),
               radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, outline: cs.outlineWidth,
               fit: cs.objectFit, pos: cs.objectPosition,
               colW: (n => Math.round(n.clientWidth - parseFloat(getComputedStyle(n).paddingLeft)
                                                        - parseFloat(getComputedStyle(n).paddingRight)))(document.querySelector('.page-wrap')),
               inSplit: !!el.closest('.fd-split'), split: document.querySelectorAll('.fd-split, .fd-figure').length,
               caption: document.querySelectorAll('.fd-banner figcaption').length,
               docW: document.documentElement.clientWidth }; })()`);
    await s.ctx.close();
    return v;
  })();
  t('the banner is NOT beside Clinical background any more',
    banner.inSplit === false && banner.split === 0, { inSplit: banner.inSplit, leftovers: banner.split });
  t('it sits AFTER Clinical background',        banner.top > banner.clinical, banner);
  t('...and BEFORE Why I created Anestheo',     banner.top < banner.why, banner);
  t('it spans the content column',              Math.abs(banner.w - banner.colW) <= 2, { img: banner.w, col: banner.colW });
  t('...and not edge to edge',                  banner.w < banner.docW - 40, { img: banner.w, doc: banner.docW });
  t('desktop: wider than it is tall',           banner.w > banner.h, banner);
  t('...at roughly 3:1 to 4:1',
    (banner.w / banner.h) >= 3 && (banner.w / banner.h) <= 4.2, (banner.w / banner.h).toFixed(2));
  t('object-fit cover',                         banner.fit === 'cover', banner.fit);
  t('...cropped above centre so the face survives', /20%|25%/.test(banner.pos), banner.pos);
  t('restrained rounded corners',               parseFloat(banner.radius) > 0 && parseFloat(banner.radius) <= 26, banner.radius);
  t('no decorative border',                     parseFloat(banner.border) === 0, banner.border);
  t('no teal outline',                          !/px/.test(banner.outline) || parseFloat(banner.outline) === 0, banner.outline);
  t('no caption',                               banner.caption === 0, banner.caption);
  t('no gradient anywhere in the banner rules', !/fd-banner[^}]*gradient/.test(FND));

  const bmob = await (async () => {
    const s = await open(b, '/founder.html', null, 390, 844);
    const v = await s.pg.evaluate(`(() => {
      const img = document.querySelector('.fd-banner img');
      const r = img.getBoundingClientRect();
      const de = document.documentElement;
      return { w: Math.round(r.width), h: Math.round(r.height),
               ratio: +(r.width / r.height).toFixed(2),
               overflow: de.scrollWidth - de.clientWidth,
               colW: (n => Math.round(n.clientWidth - parseFloat(getComputedStyle(n).paddingLeft)
                                                        - parseFloat(getComputedStyle(n).paddingRight)))(document.querySelector('.page-wrap')) }; })()`);
    await s.ctx.close();
    return v;
  })();
  t('mobile: the banner uses a gentler crop',   bmob.ratio > 1.5 && bmob.ratio < 2.1, bmob.ratio);
  t('...full content-column width',             Math.abs(bmob.w - bmob.colW) <= 2, bmob);
  t('...and no horizontal overflow',            bmob.overflow <= 0, bmob.overflow);

  t('the founder page shows exactly these two images', 
    JSON.stringify(shot.allImgs) === JSON.stringify([PHOTO_MAIN, PHOTO_2ND]), shot.allImgs);
  t('no image on the page is broken', shot.broken === 0, shot.broken);
  t('the hero portrait is unchanged: a 190x238 frame at the top of the page',
    shot.heroFrame.w === 190 && shot.heroFrame.h === 238 && shot.heroTop < 400,
    { frame: shot.heroFrame, img: shot.heroBox });

  /* The four principles, kept verbatim. "Individual care" especially. */
  const vals = await (async () => {
    const s = await open(b, '/founder.html', null);
    const v = await s.pg.evaluate(`[...document.querySelectorAll('.fd-val-t')].map(n => n.textContent.trim())`);
    await s.ctx.close();
    return v;
  })();
  t('the four care principles are unchanged',
    JSON.stringify(vals) === JSON.stringify(['Clarity','Preparation','Individual care','Communication']), vals);

  /* The About teaser: the main photo, smaller, and NOT the secondary one. */
  const tshot = await (async () => {
    const s = await open(b, '/about.html', null);
    const v = await s.pg.evaluate(`(() => {
      const img = document.querySelector('.ab-fd-photo img');
      const r = img.getBoundingClientRect();
      return { src: img.getAttribute('src'), alt: img.getAttribute('alt'),
               w: Math.round(r.width), h: Math.round(r.height),
               loaded: img.complete && img.naturalWidth > 0,
               fit: getComputedStyle(img).objectFit,
               all: [...document.querySelectorAll('.legal-wrap img')].map(i => i.getAttribute('src').split('?')[0]),
               broken: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length }; })()`);
    await s.ctx.close();
    return v;
  })();
  t('the teaser uses the MAIN photograph', tshot.src.split('?')[0] === PHOTO_MAIN, tshot.src);
  t('...and it decoded',                   tshot.loaded === true);
  t('...with the required alt text',       tshot.alt === 'Dr. Giga Nadiradze', tshot.alt);
  t('...object-fit cover',                 tshot.fit === 'cover', tshot.fit);
  t('...smaller than the founder hero',    tshot.w < shot.heroBox.w, { teaser: tshot.w, hero: shot.heroBox.w });
  t('the secondary photo is NOT on About',
    tshot.all.indexOf(PHOTO_2ND) < 0 && JSON.stringify(tshot.all) === JSON.stringify([PHOTO_MAIN]), tshot.all);
  t('no broken image on About',            tshot.broken === 0, tshot.broken);

  /* No scaffolding survived. */
  for (const [file, src] of [['founder.html', FND], ['about.html', ABOUT]]) {
    t(file + ': no onerror fallback',      !/onerror/.test(src));
    t(file + ': no pending-frame class',   !/fd-photo-pending|ab-fd-pending/.test(src));
    t(file + ': no initials placeholder',  !/fd-ph-mono|ab-fd-mono|fd-ph-lbl/.test(src));
    t(file + ': no missing-photo comment',
      !/not yet in this repository|photograph to be added|Photograph<|drop the real photograph/i.test(src));
    t(file + ': no /doctor.jpg fallback',  !/doctor\.jpg/.test(src));
  }

  t('no emoji anywhere on the founder page',
    !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(shape.text), 'clean');

  /* ── HOUSE STYLE: NO EM DASHES IN THIS BRANCH'S BODY COPY ───────────────
     An em dash every other sentence is a rhythm tic, and it is the single
     clearest tell that prose was machine-written. Periods, commas, colons and
     parentheses do the same work and read as a person wrote them.

     NO EXCEPTIONS ON THIS PAGE. An earlier version of this suite kept two:
     the <title>, which followed the site-wide "Page - Anestheo" pattern, and
     the shared footer line quoted from the procedure guides. Both were
     defensible as house style and both were still an em dash on the page, so
     both are gone: the title now uses a pipe, and the footer says "Educational
     information only. Not a substitute for medical advice." Those two changes
     are scoped to founder.html; the other eleven pages that carry the footer
     string are untouched, which does leave this page slightly out of step with
     them and is a deliberate, instructed trade. */
  const proseDashes = await (async () => {
    const s = await open(b, '/founder.html', null);
    const v = await s.pg.evaluate(`(() => {
      const sel = '.fd-lede, .fd-sec p, .fd-val-t, .fd-val-d, .fd-quote p, .fd-note, .fd-role, .fd-role-2, .fd-name';
      return [...document.querySelectorAll(sel)]
        .map(n => n.textContent).filter(x => x.indexOf('\u2014') >= 0)
        .map(x => x.slice(0, 90)); })()`);
    await s.ctx.close();
    return v.map(x => x.replace(/\s+/g, ' ').trim());
  })();
  t('no em dash in any founder body copy', proseDashes.length === 0, proseDashes);

  const teaserDashes = await (async () => {
    const s = await open(b, '/about.html', null);
    const v = await s.pg.evaluate(`(() => [...document.querySelectorAll('.ab-founder *')]
      .map(n => n.childNodes.length === 1 ? n.textContent : '')
      .filter(x => x.indexOf('\u2014') >= 0).map(x => x.slice(0, 90)))()`);
    await s.ctx.close();
    return v.map(x => x.replace(/\s+/g, ' ').trim());
  })();
  t('no em dash in the About teaser', teaserDashes.length === 0, teaserDashes);

  t('none in the new source comments or styles either',
    (FND.match(/<!--[\s\S]*?-->|<style[\s\S]*?<\/style>/g) || []).join('').indexOf('\u2014') < 0 &&
    (ABOUT.match(/<!--[\s\S]*?-->|<style[\s\S]*?<\/style>/g) || []).join('').indexOf('\u2014') < 0,
    'comments clean');

  /* Zero, page-wide, in source and in what a reader sees. */
  t('not one em dash anywhere in founder.html source',
    !/—|&mdash;/.test(FND), (FND.match(/.{0,30}(—|&mdash;).{0,30}/) || ['clean'])[0]);
  t('the page title uses a pipe, not a dash',
    /<title>About the founder \| Anestheo<\/title>/.test(FND), (FND.match(/<title>[^<]*/) || [''])[0]);
  const flat = x => x.replace(/\s+/g, ' ');
  t('the footer line on THIS page is dash-free',
    flat(FND).includes('Educational information only. Not a substitute for medical advice'), 'rewritten here');
  t('...and the other pages that share it were left alone',
    flat(read('recovery.html')).includes('Educational information only — not a substitute for medical advice') &&
    flat(read('preop-instructions.html')).includes('Educational information only — not a substitute for medical advice'),
    'unchanged elsewhere');
  const rendered = await (async () => {
    const s = await open(b, '/founder.html', null);
    const v = await s.pg.evaluate(`document.body.innerText`);
    await s.ctx.close();
    return v;
  })();
  t('and none in the rendered page a visitor reads',
    rendered.indexOf('\u2014') < 0, (rendered.match(/.{0,30}—.{0,30}/) || ['clean'])[0]);

  /* The hero paragraph, exactly as specified. */
  const hero = await (async () => {
    const s = await open(b, '/founder.html', null);
    const v = await s.pg.evaluate(`(document.querySelector('.fd-lede')||{}).textContent`);
    await s.ctx.close();
    return (v || '').replace(/\s+/g, ' ').trim();
  })();
  t('the hero paragraph is the supplied text',
    hero === 'Anesthesia is the part of surgery patients understand least and worry about most. ' +
             'I started Anestheo to explain it in simple words: clear, calm and honest, with no jargon. ' +
             'I also wanted to give clinicians a practical place to work from when they explain anesthesia to patients.',
    hero.slice(0, 90));
  t('...and it uses a colon where the dash used to be', /simple words: clear, calm and honest/.test(hero));
  t('...in three sentences', (hero.match(/\. /g) || []).length === 2, (hero.match(/\. /g)||[]).length + ' breaks');

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
