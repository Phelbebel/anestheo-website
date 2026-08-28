#!/usr/bin/env node
/* patients-hierarchy.test.js
 *
 * The public For Patients page, reordered so that size means importance.
 *
 * WHAT WAS WRONG was not the content, it was that six cards of equal weight
 * said six equally important things. Two of them were not resources at all:
 * "Understand your anesthesia" opens a whole guided experience, and "What
 * anesthesia might I have?" was a small card that expanded a SECOND, better
 * copy of itself further down the page — the same name twice, and a click
 * that jumped the reader somewhere else.
 *
 * So this suite is mostly about ORDER and ABSENCE: the tool is one thing and
 * always present, the duplicate is gone, the two features have left the grid,
 * and the four that remain are the ones that really are supporting resources.
 * Section 2 measures the rendered vertical order rather than reading the
 * source, because that is what a visitor experiences.
 *
 * The inner tool is deliberately NOT re-specified here. Its categories,
 * option text, disclaimer and citation discipline are owned by
 * public-patient-value.test.js and were preserved rather than rewritten; this
 * file asserts they survived the move.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const MAIN = process.env.NB_MAIN || 'origin/main';

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 130);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};

const HTML = fs.readFileSync(REPO + '/patients.html', 'utf8');
const onMain = p => execSync('git -C ' + REPO + ' show ' + MAIN + ':' + p, { encoding:'utf8', maxBuffer:1<<26 });
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const PATIENT = { email:'p@e.com',  role:'patient', verification_status:'not_required', is_admin:false, full_name:'Ana Patient' };
const DOCTOR  = { email:'d2@e.com', role:'doctor',  verification_status:'approved',     is_admin:false, full_name:'Dana Levi' };
const ADMIN   = { email:'a@e.com',  role:'admin',   verification_status:'not_required', is_admin:true,  full_name:'Ada Admin' };

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
  await pg.waitForTimeout(1800);
  return { ctx, pg, errs };
}

const TILES = `(() => [...document.querySelectorAll('#ph-guest .ph-grid .ph-tile')].map(n => ({
  title: ((n.querySelector('.ph-tile-t')||{}).textContent||'').trim(),
  href: n.getAttribute('href'), tag: n.tagName })))()`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1 · the grid holds only supporting resources ───────────────────── */
  console.log('\n1 · How Anestheo helps — four resources, no features');
  const g = await open(b, '/patients.html', null);
  t('no page error', g.errs.length === 0, g.errs);
  const tiles = await g.pg.evaluate(TILES);
  const titles = tiles.map(x => x.title);
  t('exactly four cards remain', tiles.length === 4, titles);
  t('they are the four supporting resources',
    JSON.stringify(titles) === JSON.stringify([
      'Fasting and medications', 'Questions worth asking',
      'Recovery, and what is normal', 'Short explainer videos']), titles);
  t('"What anesthesia might I have?" is not a card any more',
    !titles.some(x => /what anesthesia/i.test(x)), titles);
  t('"Understand your anesthesia" is not a card any more',
    !titles.some(x => /understand your anesthesia/i.test(x)), titles);
  t('"Your surgery journey" has not come back',
    !titles.some(x => /your surgery journey/i.test(x)), titles);
  t('every remaining card still has its destination',
    tiles.every(x => x.href && x.tag === 'A'), tiles.map(x => x.href));
  for (const [name, href] of [
    ['Fasting and medications', '/preop-instructions.html'],
    ['Questions worth asking',  '/preop-instructions.html#what-to-tell'],
    ['Recovery, and what is normal', '/recovery.html'],
    ['Short explainer videos',  '/videos.html']]) {
    t(name + ' → ' + href, (tiles.find(x => x.title === name) || {}).href === href);
  }

  /* ── 2 · the order a visitor actually sees ──────────────────────────── */
  console.log('\n2 · Rendered order, measured not read');
  const order = await g.pg.evaluate(`(() => {
    const y = s => { const n = document.querySelector(s);
      return n ? Math.round(n.getBoundingClientRect().top + scrollY) : -1; };
    return { hero:y('.gh'), tool:y('#pa-anes'), understand:y('#pa-understand'),
             grid:y('#ph-guest .ph-grid'), checklist:y('#pa-chk'), passport:y('.hp-feat') }; })()`);
  t('every section is on the page', Object.values(order).every(v => v > 0), order);
  const seq = ['hero','tool','understand','grid','checklist','passport'];
  t('hero → tool → understand → grid → checklist → passport',
    seq.every((k, i) => i === 0 || order[k] > order[seq[i-1]]), order);
  t('the tool sits above everything but the hero', order.tool < order.understand && order.tool < order.grid);
  t('Health Passport stays lowest',  order.passport === Math.max(...Object.values(order)), order.passport);
  t('it is below the checklist too', order.passport > order.checklist);

  /* ── 3 · one tool, always present, collapsed ────────────────────────── */
  console.log('\n3 · The tool is one thing, and it is here');
  const before = await g.pg.evaluate(`(() => ({
    section: !!document.getElementById('pa-anes'),
    bodyHidden: document.getElementById('pa-anes-body').hidden,
    aria: document.getElementById('pa-anes-open').getAttribute('aria-expanded'),
    headTag: document.getElementById('pa-anes-open').tagName,
    controls: document.getElementById('pa-anes-open').getAttribute('aria-controls'),
    eyebrow: (document.querySelector('.pa-tool-eyebrow')||{}).textContent,
    title: (document.querySelector('.pa-tool-t')||{}).textContent,
    cta: (document.querySelector('.pa-tool-cta-lbl')||{}).textContent,
    headH: Math.round(document.getElementById('pa-anes-open').getBoundingClientRect().height) }))()`);
  t('the section is always rendered',       before.section === true);
  t('it is collapsed by default',           before.bodyHidden === true);
  t('aria-expanded starts false',           before.aria === 'false', before.aria);
  t('the control is a real button',         before.headTag === 'BUTTON');
  t('it points at the body it owns',        before.controls === 'pa-anes-body');
  t('the eyebrow names it a tool',          /interactive tool/i.test(before.eyebrow || ''), before.eyebrow);
  t('the collapsed CTA invites a click',    /explore options/i.test(before.cta || ''), before.cta);
  t('the header is a comfortable target',   before.headH >= 44, before.headH + 'px');
  /* THE DUPLICATE IS GONE. There must be exactly one thing on this page
     carrying this name, and exactly one chip group. */
  const dupes = await g.pg.evaluate(`(() => ({
    named: [...document.querySelectorAll('#ph-guest *')]
      .filter(n => n.children.length === 0 && /what anesthesia might i have/i.test(n.textContent||'')).length,
    chipGroups: document.querySelectorAll('#ph-guest .pa-chips').length,
    results: document.querySelectorAll('#ph-guest #pa-result').length }))()`);
  t('the name appears exactly once',        dupes.named === 1, dupes);
  t('there is one chip group, not two',     dupes.chipGroups === 1, dupes);
  t('and one result region',                dupes.results === 1, dupes);
  t('nothing anchors to a second copy',     !/href="#pa-anes/.test(HTML));

  /* ── 4 · expand and collapse, in place ──────────────────────────────── */
  console.log('\n4 · One click opens it where it stands');
  const yBefore = order.tool;
  await g.pg.click('#pa-anes-open');
  await g.pg.waitForTimeout(400);
  const opened = await g.pg.evaluate(`(() => ({
    bodyHidden: document.getElementById('pa-anes-body').hidden,
    aria: document.getElementById('pa-anes-open').getAttribute('aria-expanded'),
    cta: (document.querySelector('.pa-tool-cta-lbl')||{}).textContent,
    chips: document.querySelectorAll('.pa-chip').length,
    toolY: Math.round(document.getElementById('pa-anes').getBoundingClientRect().top + scrollY),
    url: location.href }))()`);
  t('the body is revealed',                 opened.bodyHidden === false);
  t('aria-expanded flips to true',          opened.aria === 'true', opened.aria);
  t('the CTA label changes',                /hide options/i.test(opened.cta || ''), opened.cta);
  t('it expands IN PLACE, not elsewhere',   opened.toolY === yBefore, [yBefore, opened.toolY]);
  t('nothing navigated',                    !/#/.test(opened.url.replace(BASE, '')), opened.url);
  t('the chips arrived',                    opened.chips >= 9, opened.chips);

  await g.pg.click('#pa-anes-close');
  await g.pg.waitForTimeout(400);
  const closed = await g.pg.evaluate(`(() => ({
    bodyHidden: document.getElementById('pa-anes-body').hidden,
    aria: document.getElementById('pa-anes-open').getAttribute('aria-expanded'),
    focused: document.activeElement && document.activeElement.id }))()`);
  t('one click collapses it again',         closed.bodyHidden === true);
  t('aria-expanded returns to false',       closed.aria === 'false', closed.aria);
  /* Focus must never be left inside a region that has just been hidden. */
  t('focus returns to the control',         closed.focused === 'pa-anes-open', closed.focused);

  /* Keyboard: the header is a button, so Enter must work like a click. */
  await g.pg.focus('#pa-anes-open');
  await g.pg.keyboard.press('Enter');
  await g.pg.waitForTimeout(350);
  t('Enter opens it from the keyboard',
    (await g.pg.evaluate(`document.getElementById('pa-anes-body').hidden`)) === false);
  await g.pg.keyboard.press('Enter');
  await g.pg.waitForTimeout(350);
  t('...and closes it again',
    (await g.pg.evaluate(`document.getElementById('pa-anes-body').hidden`)) === true);

  /* ── 5 · the inner tool survived the move ───────────────────────────── */
  console.log('\n5 · The result content is the one that already worked');
  await g.pg.click('#pa-anes-open');
  await g.pg.waitForTimeout(350);
  const cats = await g.pg.evaluate(`(() => [...document.querySelectorAll('.pa-chip')]
    .map(n => ({ k:n.getAttribute('data-k'), label:n.textContent.trim() })))()`);
  const EXPECT = ['C-section / childbirth','Orthopedic surgery','ENT surgery','Dental / oral surgery',
                  'General surgery','Urology','Plastic surgery','Oncogynecology','Something else'];
  t('all nine categories are still offered',
    JSON.stringify(cats.map(c => c.label)) === JSON.stringify(EXPECT), cats.map(c => c.label));
  /* NO CATEGORY WAS ADDED, and that is a finding rather than an omission:
     every option name in this tool is cited to a patient-facing guide in the
     repo, and there are exactly eight such guides. A tenth category would
     have to invent clinical content with no source, which is the one thing
     this tool has never done. */
  t('no category was added without a guide behind it',
    cats.filter(c => !c.other).every(c => c.k === 'other' ||
      fs.existsSync(REPO + '/' + ({ csection:'csection', ortho:'orthopedic', ent:'ent', dental:'dental',
        general:'general-surgery', urology:'urology', plastic:'plastic', oncogyn:'oncogynecology',
        other:'procedures' }[c.k] || 'nope') + '.html')), cats.map(c => c.k));
  const guides = execSync('ls ' + REPO, { encoding:'utf8' }).split('\n')
    .filter(f => /^(csection|orthopedic|ent|dental|general-surgery|urology|plastic|oncogynecology)\.html$/.test(f));
  t('there are exactly eight patient procedure guides', guides.length === 8, guides.length);

  for (const k of ['csection','ortho','plastic','other']) {
    await g.pg.click('.pa-chip[data-k="' + k + '"]');
    await g.pg.waitForTimeout(250);
    const out = await g.pg.evaluate(`document.getElementById('pa-result').innerText`);
    t(k + ': shows "Common anesthesia options"', /common anesthesia options/i.test(out));
    t(k + ': carries the disclaimer',
      /your anesthesiologist decides based on your health, your procedure/i.test(out));
    t(k + ': offers the full guide',            /read the full|browse all/i.test(out));
  }
  t('the pressed chip is announced',
    (await g.pg.evaluate(`document.querySelector('.pa-chip[data-k="other"]').getAttribute('aria-pressed')`)) === 'true');
  t('the disclaimer text is unchanged from main',
    (code(HTML).match(/var PA_DISCLAIMER =[\s\S]*?;/) || [''])[0] ===
    (code(onMain('patients.html')).match(/var PA_DISCLAIMER =[\s\S]*?;/) || [''])[0]);
  t('the category data is unchanged from main',
    (code(HTML).match(/var PA_CATS = \[[\s\S]*?\n\];/) || [''])[0] ===
    (code(onMain('patients.html')).match(/var PA_CATS = \[[\s\S]*?\n\];/) || [''])[0]);
  t('it still promises nothing personal',
    !/\byou will (have|receive|get)\b|\bwe recommend\b/i.test(
      await g.pg.evaluate(`document.getElementById('pa-anes').innerText`)));

  /* ── 6 · Understand your anesthesia, on its own ─────────────────────── */
  console.log('\n6 · The second feature has its own section');
  const feat = await g.pg.evaluate(`(() => { const s = document.getElementById('pa-understand');
    if (!s) return null; const a = s.querySelector('a');
    return { title:(s.querySelector('.pa-feat-t')||{}).textContent.trim(),
             body:(s.querySelector('.pa-feat-d')||{}).textContent.trim(),
             href:a && a.getAttribute('href'), label:a && a.textContent.trim(),
             linkH:a ? Math.round(a.getBoundingClientRect().height) : 0,
             svg:!!s.querySelector('svg'), emoji:/\\p{Extended_Pictographic}/u.test(s.textContent) }; })()`);
  t('the section exists',                  !!feat);
  t('it is titled Understand your anesthesia', feat.title === 'Understand your anesthesia', feat.title);
  /* WAS: href === '/procedures.html'. That was true when this suite was
     written and it was the defect — /procedures.html is a procedure picker
     offering the same eight families as the tool above, so "understand your
     anesthesia" and "what anesthesia might I have?" both ended in the same
     question. /anesthesia-types.html was built to be the other axis, and the
     assertion now names the property that mattered all along: this section
     must NOT route to the picker. */
  t('it does not route to the procedure picker', feat.href !== '/procedures.html', feat.href);
  t('it goes to a type-first destination',       feat.href === '/anesthesia-types.html', feat.href);
  t('its link is a comfortable target',    feat.linkH >= 44, feat.linkH + 'px');
  t('it uses an inline SVG, not an emoji', feat.svg === true && feat.emoji === false, feat);
  /* THE DISTINCTION IS IN THE COPY. One starts from the operation, the other
     from the techniques. Matched on the five technique names rather than one
     fixed sentence, so the copy can be edited without this going stale — what
     may not change is that the section is named by technique. */
  t('the copy starts from the techniques',
    ['general anesthesia', 'sedation', 'spinal', 'epidural', 'nerve block']
      .every(w => feat.body.toLowerCase().includes(w)), feat.body.slice(0, 70));
  t('...while the tool starts from the surgery',
    /for your type of\s+surgery/i.test(await g.pg.evaluate(`document.querySelector('.pa-tool-d').textContent`)));

  /* ── 7 · the primary tool has no emoji and is visually first ────────── */
  console.log('\n7 · Presentation');
  const look = await g.pg.evaluate(`(() => {
    const head = document.getElementById('pa-anes-open');
    const tile = document.querySelector('#ph-guest .ph-grid .ph-tile');
    const c = getComputedStyle(document.getElementById('pa-anes'));
    return { toolEmoji: /\\p{Extended_Pictographic}/u.test(head.textContent),
             toolSvg: !!head.querySelector('svg'),
             toolW: Math.round(head.getBoundingClientRect().width),
             tileW: Math.round(tile.getBoundingClientRect().width),
             bg: c.backgroundImage, border: c.borderTopColor,
             grid: /linear-gradient\\(90deg/.test(c.backgroundImage || '') }; })()`);
  t('the primary tool carries no emoji',   look.toolEmoji === false);
  t('...it carries an inline SVG',         look.toolSvg === true);
  t('it is visually wider than a resource card', look.toolW > look.tileW * 2, [look.toolW, look.tileW]);
  t('no repeating grid is painted',        look.grid === false);
  t('its glow is a soft radial, not a slab',
    /radial-gradient/.test(look.bg) && !/#1B6B5A|rgb\(27, 107, 90\)/.test(look.bg), look.bg.slice(0, 60));

  /* ── 8 · everything below is untouched ──────────────────────────────── */
  console.log('\n8 · Checklist, Passport, hero CTAs');
  const rest = await g.pg.evaluate(`(() => ({
    chkRows: document.querySelectorAll('.pa-chk-row').length,
    chkCta: [...document.querySelectorAll('.pa-chk-cta button')].some(x => /start my surgery journey/i.test(x.textContent)),
    hp: !!document.querySelector('.hp-feat'),
    hpRule: getComputedStyle(document.querySelector('.hp-feat-eyebrow'), '::before').content,
    heroStart: [...document.querySelectorAll('#ph-guest .gh button')].some(x => /start my surgery journey/i.test(x.textContent)),
    heroAsk: [...document.querySelectorAll('#ph-guest .gh a')].map(a => a.getAttribute('href')) }))()`);
  t('the checklist still renders five rows', rest.chkRows === 5, rest.chkRows);
  await g.pg.click('.pa-chk-row:nth-child(2) input');
  await g.pg.waitForTimeout(200);
  t('ticking still persists locally',
    (await g.pg.evaluate(`localStorage.getItem('anestheo.public.checklist.v1')`)) === '[false,true,false,false,false]');
  t('its account CTA is intact',            rest.chkCta === true);
  t('Health Passport still renders',        rest.hp === true);
  t('no decorative rule before HEALTH PASSPORT', rest.hpRule === 'none', rest.hpRule);
  t('the hero keeps Start my surgery journey', rest.heroStart === true);
  t('the hero keeps Ask a question → /ask.html', rest.heroAsk.includes('/ask.html'), rest.heroAsk);
  await g.ctx.close();

  /* ── 9 · viewports ──────────────────────────────────────────────────── */
  console.log('\n9 · 390px, 820px, 1440px');
  for (const w of [390, 820, 1440]) {
    const s = await open(b, '/patients.html', null, w, w < 500 ? 844 : 1000);
    const collapsed = await s.pg.evaluate(`(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headH: Math.round(document.getElementById('pa-anes-open').getBoundingClientRect().height) }))()`);
    t(w + 'px collapsed: no horizontal overflow', collapsed.overflow <= 0, collapsed.overflow + 'px');
    t(w + 'px collapsed: header tappable',        collapsed.headH >= 44, collapsed.headH + 'px');
    await s.pg.click('#pa-anes-open');
    await s.pg.waitForTimeout(400);
    await s.pg.click('.pa-chip[data-k="ortho"]');
    await s.pg.waitForTimeout(300);
    const m = await s.pg.evaluate(`(() => {
      const chips = [...document.querySelectorAll('.pa-chip')].map(n => n.getBoundingClientRect());
      const collapse = document.getElementById('pa-anes-close').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
               minChip: Math.min(...chips.map(r => Math.round(r.height))),
               rows: new Set(chips.map(r => Math.round(r.top))).size,
               collapseH: Math.round(collapse.height),
               resultLen: document.getElementById('pa-result').innerText.length }; })()`);
    await s.ctx.close();
    t(w + 'px expanded: no horizontal overflow', m.overflow <= 0, m.overflow + 'px');
    t(w + 'px: chips are 44px or more',          m.minChip >= 44, m.minChip + 'px');
    t(w + 'px: chips wrap onto rows',            m.rows >= 1, m.rows + ' rows');
    t(w + 'px: the collapse control is tappable', m.collapseH >= 44, m.collapseH + 'px');
    t(w + 'px: the result still reads',           m.resultLen > 150, m.resultLen + ' chars');
    if (w === 390) t('390px: chips stack generously', m.rows >= 5, m.rows + ' rows');
  }

  /* ── 10 · nothing outside this page moved ───────────────────────────── */
  console.log('\n10 · Scope');
  /* THIS BLOCK USED TO ASK `git diff --name-only origin/main`, and the answer
     went stale twice. First it said "only patients.html changed among pages",
     which failed when /anesthesia-types.html was added — exactly the work that
     had been asked for. Rewritten as an allow-list of patient surfaces, it
     then failed again on the very next branch, which repaired the DOCTOR
     dashboard: a diff against main sweeps up whatever else is in flight, so a
     feature suite reading it is really asserting "no other work exists".
     That is not an invariant, it is a scheduling accident.

     A feature suite can only speak for the files the feature owns. So the
     question changed from "which files did this branch touch?" to "are these
     two pages still presentation-only?" — which stays true forever, whatever
     else is happening in the tree. */
  const OWNED = { 'patients.html': HTML, 'anesthesia-types.html': fs.readFileSync(REPO + '/anesthesia-types.html','utf8') };
  for (const [name, src] of Object.entries(OWNED)) {
    const c = code(src);
    t(name + ': no SQL of any kind',
      !/\.sql\b/.test(c) && !/\b(GRANT|REVOKE|CREATE POLICY|ALTER TABLE)\b/i.test(c));
    t(name + ': no auth guard',        !/requireAuth|requireRole/.test(c));
    t(name + ': no privileged RPC',    !/\.rpc\(/.test(c), (c.match(/\.rpc\([^)]*/) || [''])[0]);
    t(name + ': no write to any table',
      !/\.(insert|update|upsert|delete)\(/.test(c), (c.match(/\.(insert|update|upsert|delete)\(/) || [''])[0]);
    /* Scoped to the GUEST section on patients.html. The page also carries
       #ph-clin — the view a signed-in clinician gets, whose whole purpose is
       the line "your clinical tools are in the workspace" and a link to
       /dashboard.html. That link is correct and predates this work; a blanket
       file-wide ban flagged it. What must stay true is that a LOGGED-OUT
       visitor is never pointed at a clinician surface. */
    const guest = name === 'patients.html'
      ? (src.match(/<section id="ph-guest"[\s\S]*?<!-- CLINICIAN view/) || [''])[0]
      : src;
    t(name + ': the public view links to no clinician surface',
      guest.length > 0 &&
      !/href="\/(engine|scores|references|dashboard|admin|questions|anesthesia-cases|anesthesia-record|regional|users|doctor-approvals)\.html/.test(guest),
      (guest.match(/href="\/(engine|scores|references|dashboard|admin|questions)\.html/) || ['clean'])[0]);
  }
  t('the page adds no Supabase call',
    (code(HTML).match(/window\.sb\.(from|rpc)/g) || []).join() ===
    (code(onMain('patients.html')).match(/window\.sb\.(from|rpc)/g) || []).join());
  t('the signed-in patient home markup is identical to main',
    (HTML.match(/<section id="ph-home"[\s\S]*?<section id="ph-clin"/) || [''])[0] ===
    (onMain('patients.html').match(/<section id="ph-home"[\s\S]*?<section id="ph-clin"/) || [''])[0]);

  /* And live: the other roles see what they saw. */
  const p = await open(b, '/patients.html', PATIENT);
  const pv = await p.pg.evaluate(`(() => ({
    home: getComputedStyle(document.getElementById('ph-home')).display !== 'none',
    guest: getComputedStyle(document.getElementById('ph-guest')).display !== 'none',
    tool: !!document.querySelector('#pa-anes-body:not([hidden])') }))()`);
  await p.ctx.close();
  t('a signed-in patient still gets the patient home', pv.home && !pv.guest, pv);
  t('...and is not shown the public tool',             pv.tool === false);
  for (const [who, prof] of [['doctor', DOCTOR], ['admin', ADMIN]]) {
    const s = await open(b, '/patients.html', prof);
    const st = await s.pg.evaluate(`(() => ({
      guest: getComputedStyle(document.getElementById('ph-guest')).display !== 'none',
      collapsed: document.getElementById('pa-anes-body').hidden }))()`);
    await s.ctx.close();
    t(who + ' still previews the guest view', st.guest === true, st);
    t(who + ' sees the tool collapsed too',   st.collapsed === true);
  }

  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
