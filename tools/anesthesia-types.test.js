#!/usr/bin/env node
/* anesthesia-types.test.js
 *
 * THE TYPE-FIRST DOOR. /patients.html has always had a procedure-first tool —
 * "what anesthesia might I have?", which starts from the operation. The
 * "Understand your anesthesia" section beside it promised the other axis and
 * then linked to /procedures.html, which is a procedure picker offering the
 * same eight families. Two routes, one question. This suite exists to keep
 * that from happening again.
 *
 * So the assertions come in three kinds:
 *
 *   1. The DISTINCTION. No procedure picker on the types page, no link to
 *      /procedures.html from the section that claims to be type-first, and a
 *      real link in both directions between the two doors.
 *
 *   2. The CLINICAL BOUNDARY. The page may say what is commonly used; it may
 *      not say what the reader should have. Prescriptive phrasing is checked
 *      against the rendered text, not the source, so a comment explaining the
 *      rule cannot satisfy the rule — a mistake this repo has made repeatedly.
 *
 *   3. The ACCESS MODEL, which must not have moved. Public, no guard, no
 *      Supabase call of the page's own, no write of any kind.
 *
 * Sourcing is asserted structurally rather than by prose match: every guide
 * this page links to must exist, and the five techniques must each be named
 * somewhere in the guides they cite. The page was written by condensing those
 * guides; if a guide is rewritten this should disagree out loud.
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
/* Comments are not the product. Strip them before asserting on source, so an
   assertion can never be satisfied by the note that explains it. */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const AT   = read('anesthesia-types.html');
const ATC  = code(AT);
const PATS = code(read('patients.html'));

const PATIENT = { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' };
const DOCTOR  = { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' };

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
  await pg.waitForTimeout(1500);
  return { ctx, pg, errs };
}

const TYPES = [
  { id:'at-general',  name:'General anesthesia',   guides:['general-surgery.html','ent.html','oncogynecology.html'] },
  { id:'at-sedation', name:'Sedation',             guides:['dental.html','urology.html','plastic.html'] },
  { id:'at-spinal',   name:'Spinal anesthesia',    guides:['csection.html','orthopedic.html','urology.html'] },
  { id:'at-epidural', name:'Epidural',             guides:['csection.html','oncogynecology.html'] },
  { id:'at-regional', name:'Regional anesthesia',  guides:['orthopedic.html','general-surgery.html'] },
];

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · the page exists, is public, and answers nobody's session ────── */
  console.log('\n1 · /anesthesia-types.html is a public page');
  const g = await open(b, '/anesthesia-types.html', null);
  t('no page error', g.errs.length === 0, g.errs);

  const landed = await g.pg.evaluate('location.pathname');
  t('a logged-out visitor is not redirected', landed === '/anesthesia-types.html', landed);

  const vis = await g.pg.evaluate(`(() => ({
    h1: (document.querySelector('.at-h1')||{}).textContent||'',
    cards: document.querySelectorAll('.at-card').length,
    body: document.body.innerText.length }))()`);
  t('the page renders its heading', /kinds of anesthesia/i.test(vis.h1), vis.h1.trim());
  t('five technique cards render', vis.cards === 5, vis.cards);
  t('substantial content is visible without an account', vis.body > 2500, vis.body);

  /* No guard, and no query of its own. navbar.js reads a session on every
     page in this repo; what must be absent is anything THIS page asks for. */
  const pageScript = (ATC.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n');
  t('no requireAuth / requireRole guard', !/requireAuth|requireRole/.test(ATC));
  t('no page script of its own at all',   pageScript.trim() === '', pageScript.slice(0, 80));
  for (const call of ['.from(', '.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', 'sb.auth'])
    t('no Supabase ' + call + ' anywhere on the page', !ATC.includes(call));
  t('no form element — nothing to submit', !/<form[\s>]/i.test(ATC));

  /* A signed-in patient gets the same page, not a redirect: it is education,
     not a gated feature. */
  const p = await open(b, '/anesthesia-types.html', PATIENT);
  const pPath = await p.pg.evaluate('location.pathname');
  const pCards = await p.pg.evaluate(`document.querySelectorAll('.at-card').length`);
  await p.ctx.close();
  t('a signed-in patient sees the same page', pPath === '/anesthesia-types.html' && pCards === 5, { pPath, pCards });

  const d = await open(b, '/anesthesia-types.html', DOCTOR);
  const dPath = await d.pg.evaluate('location.pathname');
  await d.ctx.close();
  t('a clinician is not bounced off it either', dPath === '/anesthesia-types.html', dPath);

  /* ── 2 · it is TYPE-first, and it is not a second procedure picker ───── */
  console.log('\n2 · Type-first, not a procedure picker');
  const shape = await g.pg.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.at-card')];
    return {
      ids: cards.map(c => c.id),
      titles: cards.map(c => ((c.querySelector('.at-t')||{}).textContent||'').trim()),
      order: cards.map(c => Math.round(c.getBoundingClientRect().top + scrollY)),
      procGrid: document.querySelectorAll('.proc-grid, .proc-card').length,
      procLinks: [...document.querySelectorAll('a[href*="procedures.html"]')].length };
  })()`);
  t('no procedure grid on the page', shape.procGrid === 0, shape.procGrid);
  t('the five cards are the five techniques',
    JSON.stringify(shape.ids) === JSON.stringify(TYPES.map(x => x.id)), shape.ids);
  t('they render in that order top to bottom',
    shape.order.every((v, i) => i === 0 || v > shape.order[i-1]), shape.order);
  for (const ty of TYPES)
    t('card titled for ' + ty.name,
      shape.titles.some(x => x.toLowerCase().includes(ty.name.split(' ')[0].toLowerCase())), shape.titles);

  /* The one link to /procedures.html a types page may legitimately carry is
     the footer's library link. What it must not do is send the reader to the
     picker as the answer to "understand your anesthesia". */
  const procCtx = await g.pg.evaluate(`(() => [...document.querySelectorAll('a[href*="procedures.html"]')]
    .map(a => ({ text: a.textContent.trim().slice(0,40), inFooter: !!a.closest('footer'), inCard: !!a.closest('.at-card') })))()`);
  t('no technique card routes back to the picker', procCtx.every(x => !x.inCard), procCtx);

  /* Each card answers the four orienting questions the brief named. */
  const cardShape = await g.pg.evaluate(`(() => [...document.querySelectorAll('.at-card')].map(c => ({
    id: c.id,
    icoSvg: c.querySelectorAll('.at-ico svg').length,
    facts: [...c.querySelectorAll('.at-fact dt')].map(x => x.textContent.trim()),
    blocks: [...c.querySelectorAll('.at-blk h3')].map(x => x.textContent.trim()),
    guideLinks: [...c.querySelectorAll('a[href$=".html"]')].map(a => a.getAttribute('href')) })))()`);
  for (const c of cardShape) {
    t(c.id + ': has an inline SVG icon', c.icoSvg === 1, c.icoSvg);
    t(c.id + ': states awake or asleep', c.facts.some(f => /awake or asleep/i.test(f)), c.facts);
    t(c.id + ': states what it affects', c.facts.some(f => /what it affects/i.test(f)), c.facts);
    t(c.id + ': lists where it is commonly used', c.blocks.some(x => /commonly used/i.test(x)), c.blocks);
    t(c.id + ': says what the patient may feel',  c.blocks.some(x => /may feel/i.test(x)), c.blocks);
    t(c.id + ': gives advantages',                c.blocks.some(x => /advantage/i.test(x)), c.blocks);
    t(c.id + ': gives limitations',               c.blocks.some(x => /keep in mind/i.test(x)), c.blocks);
    t(c.id + ': links to at least two guides',    c.guideLinks.length >= 2, c.guideLinks.length);
  }

  /* No emoji anywhere in the visible text. The icons are SVG, and the brief
     asked for that explicitly. */
  const emoji = await g.pg.evaluate(`(() => (document.body.innerText.match(
    /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]/gu) || []))()`);
  t('no emoji in the rendered page', emoji.length === 0, emoji);
  t('...and none in the markup either',
    !/&#1[23][0-9]{3};|&#9[0-9]{3};/.test(ATC.replace(/&#8212;|&#821[0-9];/g, '')));

  /* ── 3 · every source it cites is real, and says what it is cited for ── */
  console.log('\n3 · Sourced from guides that exist');
  /* The page's OWN links. navbar.js REPLACES #nb-placeholder with #nb-nav
     (ph.outerHTML = html), and renders every role's link group into the DOM
     with display:none — so an anonymous page still contains /dashboard.html
     and /settings.html. Those belong to the shared navbar, which every page in
     the repo carries; auditing them here would re-test navbar.js and fail on
     links it offers a signed-in visitor by design. It also mounts a mobile
     drawer (#nb-mob) and, for a signed-in visitor, its own footer
     (#nb-app-foot) — both siblings rather than children. So rather than chase
     navbar.js's containers, this reads only what this page authored. */
  const hrefs = await g.pg.evaluate(`(() => [...new Set(
    [...document.querySelectorAll('.page-wrap a[href^="/"], footer.site-footer a[href^="/"]')]
      .map(a => a.getAttribute('href').split('#')[0]))])()`);
  for (const h of hrefs)
    t('destination exists: ' + h, fs.existsSync(REPO + h), h);

  /* /regional.html is a CLINICIAN reference — local anesthetic mg/kg tables.
     A patient page must not send anyone there. */
  t('does not link patients to the clinician regional reference',
    !hrefs.includes('/regional.html'), hrefs.filter(h => /regional/.test(h)));
  for (const clin of ['/engine.html', '/scores.html', '/references.html', '/dashboard.html', '/questions.html'])
    t('no link to clinician surface ' + clin, !hrefs.includes(clin));

  /* Each technique must actually be discussed in the guides its card cites. */
  for (const ty of TYPES) {
    const word = ty.name.split(' ')[0].toLowerCase();
    for (const gd of ty.guides) {
      const src = read(gd).toLowerCase();
      t(ty.name + ' is named in ' + gd, src.includes(word), gd);
    }
  }

  /* ── 4 · educational, never prescriptive ────────────────────────────── */
  console.log('\n4 · Clinical boundary — educational, not a recommendation');
  const text = await g.pg.evaluate('document.body.innerText');
  const low = text.toLowerCase();
  const BANNED = [
    'you should have', 'you should choose', 'we recommend', 'recommended for you',
    'best for you', 'the best option for you', 'choose this if', 'you will have',
    'your anesthesia will be', 'is right for you', 'we suggest you'
  ];
  for (const phrase of BANNED)
    t('never says "' + phrase + '"', !low.includes(phrase));

  for (const hedge of ['commonly used', 'may be', 'often'])
    t('uses hedged language: "' + hedge + '"', low.includes(hedge));

  t('states who actually decides',
    /anesthesiologist decides/i.test(text) && /discuss it with you/i.test(text));
  t('says it is general education, not a plan for the reader',
    /not a plan for you/i.test(text), (text.match(/not a plan for you[^.]*/i)||[''])[0]);
  t('carries an educational-information-only disclaimer',
    /educational information only/i.test(text));

  /* ── 5 · the two doors are wired to each other ──────────────────────── */
  console.log('\n5 · The pair — procedure-first and type-first link both ways');
  const back = await g.pg.evaluate(`(() => {
    const a = document.querySelector('.at-pair-go');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null; })()`);
  t('the types page links back to the procedure-first tool',
    !!back && back.href === '/patients.html#pa-anes', back);
  await g.ctx.close();

  const feat = await (async () => {
    const s = await open(b, '/patients.html', null);
    const v = await s.pg.evaluate(`(() => {
      const sec = document.getElementById('pa-understand');
      const a = sec && sec.querySelector('.pa-feat-go');
      const tool = document.getElementById('pa-anes');
      const r = n => n ? n.getBoundingClientRect() : null;
      const rt = r(tool), rf = r(sec);
      return {
        href: a && a.getAttribute('href'),
        label: a && a.textContent.trim(),
        toolTop: rt && Math.round(rt.top + scrollY),
        featTop: rf && Math.round(rf.top + scrollY),
        toolH: rt && Math.round(rt.height),
        featH: rf && Math.round(rf.height),
        toolTitle: parseFloat(getComputedStyle(document.querySelector('.pa-tool-t')).fontSize),
        featTitle: parseFloat(getComputedStyle(document.querySelector('.pa-feat-t')).fontSize),
        toolIco: Math.round(document.querySelector('.pa-tool-ico').getBoundingClientRect().width),
        featIco: Math.round(document.querySelector('.pa-feat-ico').getBoundingClientRect().width),
        toolEyebrow: !!sec && !!document.querySelector('.pa-tool-eyebrow'),
        toolCta: !!document.querySelector('.pa-tool-cta'),
        featCta: !!document.querySelector('.pa-feat .pa-tool-cta'),
        toolBorder: getComputedStyle(tool).borderTopColor,
        featBorder: getComputedStyle(sec).borderTopColor }; })()`);
    await s.ctx.close();
    return v;
  })();
  t('"Understand your anesthesia" points at the types page',
    feat.href === '/anesthesia-types.html', feat.href);
  t('...and no longer at the procedure picker', feat.href !== '/procedures.html');
  t('its label describes the types, not the picker',
    /types of anesthesia/i.test(feat.label || ''), feat.label);
  t('the tool still comes first on the page', feat.toolTop < feat.featTop, feat);

  /* DOMINANCE IS NOT HEIGHT. An earlier version of this assertion compared
     the two blocks' pixel heights and failed — on the reviewed layout, before
     any change here: the collapsed tool is 151px and the feature row is 205px,
     because the row is two lines of description with nothing above them. The
     tool is the dominant block for the reasons a reader actually registers —
     a bigger title, a bigger icon, an eyebrow and a button-shaped call to
     action inside its own bordered panel — and it grows to several times the
     feature's height the moment it is opened. Those are what is asserted. */
  t('the tool carries the larger title',      feat.toolTitle > feat.featTitle, feat);
  t('the tool carries the larger icon',       feat.toolIco > feat.featIco, feat);
  t('only the tool has an eyebrow and a CTA', feat.toolEyebrow && feat.toolCta && !feat.featCta, feat);
  /* Both are bordered cards — the difference is the ink in the border. The
     tool's is teal-tinted (rgba(126,207,192,.22)); the feature row takes the
     neutral hairline every other card on the page uses. That is what "one
     step down, a flat card" means in the CSS. */
  t('only the tool gets the teal-tinted border',
    /126,\s*207,\s*192/.test(feat.toolBorder) && !/126,\s*207,\s*192/.test(feat.featBorder),
    { tool: feat.toolBorder, feat: feat.featBorder });

  /* The back-link must land somewhere useful. A collapsed panel would make it
     a dead end, so the hash opens the tool — and only the hash does. */
  const hashOpen = await (async () => {
    const s = await open(b, '/patients.html#pa-anes', null);
    const v = await s.pg.evaluate(`(() => ({
      open: !document.getElementById('pa-anes-body').hidden,
      aria: document.getElementById('pa-anes-open').getAttribute('aria-expanded'),
      chips: document.querySelectorAll('#pa-chips .pa-chip').length,
      toolH: Math.round(document.getElementById('pa-anes').getBoundingClientRect().height),
      featH: Math.round(document.getElementById('pa-understand').getBoundingClientRect().height) }))()`);
    await s.ctx.close();
    return v;
  })();
  t('#pa-anes opens the tool on arrival', hashOpen.open === true, hashOpen);
  t('...with aria-expanded kept in step', hashOpen.aria === 'true');
  t('...and the chips rendered', hashOpen.chips > 0, hashOpen.chips);
  t('...and open, the tool dwarfs the feature row',
    hashOpen.toolH > hashOpen.featH * 1.5, hashOpen);

  const plain = await (async () => {
    const s = await open(b, '/patients.html', null);
    const v = await s.pg.evaluate(`document.getElementById('pa-anes-body').hidden`);
    await s.ctx.close();
    return v;
  })();
  t('a plain visit still starts collapsed', plain === true, plain);

  /* ── 6 · mobile at 390, and no horizontal overflow anywhere ──────────── */
  console.log('\n6 · 390px and overflow');
  for (const [w, h, lbl] of [[390, 844, 'mobile 390'], [768, 1024, 'tablet 768'], [1440, 1200, 'desktop 1440']]) {
    const s = await open(b, '/anesthesia-types.html', null, w, h);
    const m = await s.pg.evaluate(`(() => {
      const de = document.documentElement;
      const wide = [...document.querySelectorAll('body *')]
        .filter(n => n.getBoundingClientRect().right > de.clientWidth + 1)
        .slice(0, 4).map(n => n.className || n.tagName);
      const tap = [...document.querySelectorAll('.at-jump a, .at-pair-go, .at-ask a')]
        .map(n => Math.round(n.getBoundingClientRect().height));
      return { overflow: de.scrollWidth - de.clientWidth, wide, tap, cards: document.querySelectorAll('.at-card').length };
    })()`);
    await s.ctx.close();
    t(lbl + ': no horizontal overflow', m.overflow <= 0, m);
    t(lbl + ': nothing spills past the viewport', m.wide.length === 0, m.wide);
    t(lbl + ': all five cards render', m.cards === 5, m.cards);
    t(lbl + ': tap targets are at least 40px', m.tap.every(x => x >= 40), m.tap);
  }

  /* The AA failure that .btn-primary carries on sixteen pages must not be
     shipped again on a page written this week. */
  const contrast = await (async () => {
    const s = await open(b, '/anesthesia-types.html', null);
    const v = await s.pg.evaluate(`(() => {
      const el = document.querySelector('.at-ask .btn-primary');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const num = s => s.match(/[\\d.]+/g).slice(0,3).map(Number);
      const lin = c => { c /= 255; return c <= .03928 ? c/12.92 : Math.pow((c+.055)/1.055, 2.4); };
      const L = ([r,g,b]) => .2126*lin(r) + .7152*lin(g) + .0722*lin(b);
      const fg = L(num(cs.color)), bg = L(num(cs.backgroundColor));
      return { ratio: +(((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)).toFixed(2)),
               bgImage: cs.backgroundImage, color: cs.color, bg: cs.backgroundColor }; })()`);
    await s.ctx.close();
    return v;
  })();
  t('the Ask button is a flat colour, not the broken gradient',
    contrast && contrast.bgImage === 'none', contrast && contrast.bgImage);
  t('...and clears AA at 4.5:1', contrast && contrast.ratio >= 4.5, contrast);

  /* ── 7 · shipping hygiene ───────────────────────────────────────────── */
  console.log('\n7 · Hygiene');
  const VERSION = read('VERSION').trim();
  const stamps = [...AT.matchAll(/(?:src|href)="\/[^"]+\?v=([^"]+)"/g)].map(m => m[1]);
  t('every local asset is version-stamped', stamps.length >= 5, stamps.length);
  t('...all at the current VERSION', stamps.every(s => s === VERSION), [...new Set(stamps)]);
  t('a title and a description are set',
    /<title>[^<]*anesthesia[^<]*<\/title>/i.test(AT) && /name="description"/.test(AT));
  t('lang and viewport are declared',
    /<html lang="en">/.test(AT) && /width=device-width/.test(AT));

  /* EM DASHES, and why this page keeps them. patient-experience.test.js bars
     visible em dashes on four surfaces — /index.html, /patient-dashboard.html,
     /patients.html and /procedures.html — because there they were decorative.
     Its own note keeps them where they are real punctuation in clinical prose,
     which is why preop-instructions.html and every procedure guide still use
     them. This page is that kind of prose: it condenses those guides, and
     csection.html's "spinal anesthesia — a single injection in the lower back"
     is the sentence shape it inherits. So dashes are deliberate HERE and
     barred THERE, and both halves are asserted rather than left to drift. */
  const dashHere = await (async () => {
    const s = await open(b, '/anesthesia-types.html', null);
    const v = await s.pg.evaluate(`(document.body.innerText.match(/—/g) || []).length`);
    await s.ctx.close();
    return v;
  })();
  t('prose dashes are used, as in the guides it condenses', dashHere > 0, dashHere);
  t('the guides really do use them', read('csection.html').includes('&mdash;') || /—/.test(read('csection.html')));
  const dashThere = await (async () => {
    const s = await open(b, '/patients.html', null);
    const v = await s.pg.evaluate(`(document.body.innerText.match(/—/g) || []).length`);
    await s.ctx.close();
    return v;
  })();
  t('/patients.html stays free of them, including the new copy', dashThere === 0, dashThere);

  /* This branch is presentation. Nothing it touched may be a security surface. */
  t('no SQL file is referenced', !/\.sql/.test(ATC));
  t('auth.js is loaded but never called by the page', /auth\.js/.test(AT) && !/window\.(requireAuth|getSession)\s*\(/.test(ATC));
  t('patients.html made no auth change either',
    !/requireAuth|requireRole/.test(PATS) || PATS.includes('ph-guest'));

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
