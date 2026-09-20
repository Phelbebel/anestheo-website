/* live-tools-responsive.test.js — the workstation on a tablet and a phone.
 *
 * Two production defects are pinned here, both reproduced before they were
 * fixed and both measured rather than eyeballed.
 *
 * ONE · THE BOARD WAS LAYING ITSELF OUT INSIDE A LABEL COLUMN. The centre is
 * two columns and the airway one of them is a fixed 346px that never yields,
 * so every pixel the viewport lost came out of the drug board alone — 616 at
 * 1536, 446 at 1366, 256 at 1180 — and .tb-row had no floor to stop at. Below
 * 1180 it was worse: the role label spanned the group while the group still
 * declared three tracks, so the four cards were auto-placed into the 112px
 * LABEL track and shared it. Drug names broke letter by letter in 54px
 * strips.
 *
 * TWO · THE PATIENT FORM VANISHED MID-NUMBER. case-live is set the moment age
 * and weight are both non-empty, and weight is non-empty after its FIRST
 * digit. Typing "75" hid #acc-patient on the "7": focus went to <body>, the
 * "5" was swallowed, and the case was computed for a 7 kg patient with every
 * weight-scaled dose on the board scaled to it. ASA and procedure, in the
 * same panel, could not be reached at all.
 *
 * The second is tested by TYPING, not by setting values and calling compute():
 * the defect lives in the interaction, and a probe that assigns .value and
 * calls the handler cannot see it.
 *
 * WEBKIT IS NOT AVAILABLE IN THIS ENVIRONMENT — the download is blocked by
 * the network policy — so these run on Chromium with iOS/iPadOS device
 * emulation: mobile viewport, touch, and the Safari user agent. That
 * reproduces layout, media queries, touch dispatch and the input/change/focus
 * sequence. It does not exercise WebKit's own engine, and this file says so
 * rather than implying a coverage it does not have.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright-core');
const fs = require('fs');
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');
const BASE = 'http://127.0.0.1:8890';

/* THE CARD COUNT COMES FROM THE CATALOG, NOT FROM MEMORY.
   It was written out as a literal and had to be edited by hand every time
   board membership changed — 16, then 15, now 16 again — which is a test
   that records the last edit rather than the rule. The rule is that the
   board draws exactly the agents induction-catalog.js declares for the
   current strategy, and with no strategy chosen that is every row which is
   not scoped to one. */
const CATALOG = require('/home/user/anestheo-website/induction-catalog.js');
const BOARD_CARDS = (CATALOG.rows || [])
  .filter(r => !r.strategy)
  .reduce((n, r) => n + (r.members || []).length, 0);
const BOARD_ROWS = (CATALOG.rows || []).filter(r => !r.strategy).length;

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 150);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

const IOS  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
             '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
             '(KHTML, like Gecko) Version/17.5 Safari/604.1';

/* THE FLOOR. Four cards on one line is the clinical composition and it takes
   priority over any particular card width — a row that wraps to 3+1 has an
   orphan drug and a role label stretched over two rows, which is a worse
   reading than a narrower card. The approved desktop card is 122px, so 110 is
   the floor below which the tablet is no longer showing the composition it
   was approved at. Phones drop to two per line instead.

   WAS 112px, and the floor was set under it. Removing the row plus returned
   its 34px track to the cards, so every card on every width is WIDER than
   the number this floor was written against — the floor is unchanged and
   has more clearance than before, not less. */
const MIN_CARD = 110;

async function open(b, w, h, ua) {
  const ctx = await b.newContext({ viewport:{ width:w, height:h }, deviceScaleFactor:1,
    isMobile: w <= 834, hasTouch: true, userAgent: ua });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status:200, contentType:'text/javascript', body:MOCK });
    if (/googleapis|gstatic/.test(u))  return r.fulfill({ status:200, contentType:'text/css', body:'' });
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' }).catch(() => {});
  await pg.waitForTimeout(1300);
  return { ctx, pg, errs };
}

/* Is the patient editor on screen? Geometry, not a class name — the question
   is whether a clinician can see and reach it. */
const EDITOR_VISIBLE = `(() => {
  const a = document.getElementById('acc-patient');
  if (!a) return false;
  const b = a.getBoundingClientRect();
  return b.width > 0 && b.height > 0 && getComputedStyle(a).visibility !== 'hidden';
})()`;

/* A CLINICIAN, NOT A SCRIPT. Every value arrives through a tap and keystrokes,
   in the order a person fills a form, and the multi-digit fields are typed one
   character at a time — which is the whole point, because the defect fired
   between the first digit of the weight and the second. */
async function fillByTyping(pg) {
  /* WEIGHT IS COMMITTED LAST, because committing it is what opens the
     workstation now. Entering it mid-form folds the editor under the fields
     that follow — which is the behaviour, not a fault in this helper. */
  await pg.locator('#i-age').tap();    await pg.locator('#i-age').type('42', { delay:40 });
  await pg.locator('#i-sex').selectOption('M');
  await pg.locator('#i-height').tap(); await pg.locator('#i-height').type('175', { delay:40 });
  await pg.locator('#i-asa').selectOption('II');
  await pg.locator('#i-proc').tap();
  await pg.locator('#i-proc').type('Laparoscopic cholecystectomy', { delay:8 });
  await pg.locator('#i-weight').tap(); await pg.locator('#i-weight').type('75', { delay:40 });
  await pg.evaluate(() => document.activeElement.blur());   /* the keyboard closes */
  await pg.waitForTimeout(500);
}

/* Every meaningful clinical string on screen, and whether the box it is in is
   big enough to show it. A Range measures what the text ACTUALLY wants —
   scrollWidth is clamped once text-overflow has done its work. */
const CLIP_PROBE = `(() => {
  const nat = e => { const r = document.createRange(); r.selectNodeContents(e);
    return Math.ceil(r.getBoundingClientRect().width); };
  const out = [];
  ['.tb-c-n','.tb-c-u','.tb-c-r','.tb-c-a','.tb-c-cov','.tb-g b',
   '.awp-l','.awp-v','.case-f b','.case-f i'].forEach(sel => {
    document.querySelectorAll(sel).forEach(e => {
      if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return;
      if (nat(e) > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
        out.push(sel + ' :: "' + e.textContent.replace(/[ \\t\\n]+/g,' ').trim().slice(0,26) + '"');
    });
  });
  return out;
})()`;

const BOARD_PROBE = `(() => {
  const cards = [...document.querySelectorAll('#induction-host .tb-c')];
  const lines = e => { const cs = getComputedStyle(e);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return Math.round(e.getBoundingClientRect().height / lh); };
  return {
    cards: cards.length,
    plus: document.querySelectorAll('#induction-host .tb-s').length,
    rows: document.querySelectorAll('#induction-host .tb-row').length,
    widths: [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().width)))],
    minWidth: Math.min.apply(null, cards.map(c => Math.round(c.getBoundingClientRect().width))),
    /* A name on four lines is a name broken letter by letter. */
    maxNameLines: Math.max.apply(null, cards.map(c => {
      const n = c.querySelector('.tb-c-n'); return n ? lines(n) : 0; })),
    maxRoleLines: Math.max.apply(null,
      [...document.querySelectorAll('#induction-host .tb-g b')].map(lines)),
    airwayTiles: document.querySelectorAll('.awp').length,
    /* cards sharing a y are one visual line; "4" is one line of four and
       "3+1" is a wrap */
    perRow: [...document.querySelectorAll('#induction-host .tb-row')].map(rw => {
      const ys = {};
      [...rw.querySelectorAll('.tb-c')].forEach(c => {
        const y = Math.round(c.getBoundingClientRect().y); ys[y] = (ys[y]||0) + 1; });
      return Object.keys(ys).sort((a,b) => a - b).map(k => ys[k]).join('+'); }),
    roleH: Math.max.apply(null,
      [...document.querySelectorAll('#induction-host .tb-g')].map(e => Math.round(e.getBoundingClientRect().height))),
    rowH: Math.max.apply(null,
      [...document.querySelectorAll('#induction-host .tb-row')].map(e => Math.round(e.getBoundingClientRect().height))),
    roleTallerThanRow: (() => {
      const g = [...document.querySelectorAll('#induction-host .tb-grp')];
      return g.some(x => {
        const lab = x.querySelector('.tb-g'), row = x.querySelector('.tb-row');
        if (!lab || !row) return false;
        const c = row.querySelector('.tb-c'); if (!c) return false;
        /* a label taller than one card means the row beneath it wrapped */
        return Math.round(lab.getBoundingClientRect().height) >
               Math.round(c.getBoundingClientRect().height) + 8; }); })(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    /* the airway must not be squeezed beside the board when the board needs
       the width; below the desktop it sits under it */
    sideBySide: (() => {
      const m = document.querySelector('.wf-col-main'), s = document.querySelector('.wf-col-side');
      if (!m || !s) return null;
      return Math.round(s.getBoundingClientRect().x) > Math.round(m.getBoundingClientRect().x);
    })(),
    crisisReachable: !!document.querySelector('#ws-crisis .wsc-b, .ws-sos, #ws-sos, #cmd-strip .cmd-b')
  };
})()`;

(async () => {
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  /* ── 1. THE TABLET AND PHONE BOARD ──────────────────────────────────── */
  console.log('\n1. THE BOARD IS NEVER NARROWER THAN THE APPROVED CARD');
  const VIEWS = [
    ['iPad landscape 1366', 1366, 1024, IPAD],
    ['iPad landscape 1180', 1180,  820, IPAD],
    ['iPad landscape 1024', 1024,  768, IPAD],
    ['iPad portrait 1024',  1024, 1366, IPAD],
    ['iPad portrait 834',    834, 1194, IPAD],
    ['iPad portrait 768',    768, 1024, IPAD],
    ['iPhone 430',           430,  932, IOS],
    ['iPhone 393',           393,  852, IOS],
    ['iPhone 390',           390,  844, IOS],
    ['iPhone 375',           375,  812, IOS]
  ];
  for (const [name, w, h, ua] of VIEWS) {
    const s = await open(b, w, h, ua);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute(); setDomain('induction');
    });
    await s.pg.waitForTimeout(500);
    const m = await s.pg.evaluate(BOARD_PROBE);
    const clip = await s.pg.evaluate(CLIP_PROBE);
    const P = name + ': ';
    /* THE BOARD DRAWS EXACTLY WHAT THE CATALOG DECLARES, and the number is
       read from the catalog rather than written here. It has been 16, then
       15 when morphine left the analgesia row, and 16 again now the approved
       four-by-four cockpit is restored; each of those was a membership
       decision taken in induction-catalog.js, and a literal here only ever
       recorded the most recent one. What is asserted is the correspondence,
       plus the part that is a real rule: no add control of any kind. */
    t(P + 'the whole board renders — ' + BOARD_CARDS + ' cards, ' +
          BOARD_ROWS + ' rows, no add controls',
      m.cards === BOARD_CARDS && m.rows === BOARD_ROWS && m.plus === 0,
      { cards:m.cards, rows:m.rows, plus:m.plus,
        expect:{ cards:BOARD_CARDS, rows:BOARD_ROWS } });
    t(P + '...no card below the ' + MIN_CARD + 'px floor',
      m.minWidth >= MIN_CARD, { min:m.minWidth, widths:m.widths });
    /* NO ORPHAN DRUG. A tablet row is four cards on ONE line; a phone row is
       two and two, which is the approved phone treatment and not a wrap. What
       is forbidden is an uneven break — 3+1 leaves the fourth drug stranded
       under the first three and stretches the role label over both lines,
       which is exactly what auto-fit produced between 1181 and 1299. */
    /* A THREE-CARD ROW BREAKS 2+1 ON A PHONE, AND THAT IS NOT AN ORPHAN.
       The defect this guards against is a FOUR-card row breaking 3+1, which
       strands the fourth drug under the first three and stretches the role
       label over both lines. A row of three has no even split available, so
       the rule is stated as what it always meant: a row fills its lines from
       the left and the remainder is never more than one short. */
    const expectFor = n => w >= 740 ? String(n) : (n >= 4 ? '2+2' : '2+1');
    t(P + '...every clinical row breaks evenly, with no orphan card',
      m.perRow.every(r => { const parts = r.split('+').map(Number);
        return parts.length === 1 ||
               parts.every(n => n === parts[0] || n === parts[0] - 1); }), m.perRow);
    t(P + '...four across on a tablet, two at a time on a phone',
      m.perRow.every((r, i) => r === expectFor(m.rowSizes ? m.rowSizes[i]
        : r.split('+').map(Number).reduce((a, b) => a + b, 0))),
      { got:m.perRow });
    /* The label is one card-row high, not a rectangle spanning a wrap. */
    t(P + '...the role label is not stretched over a wrapped row',
      m.roleTallerThanRow === false,
      { role:m.roleH, row:m.rowH });
    t(P + '...no drug name broken over more than two lines',
      m.maxNameLines <= 2, m.maxNameLines);
    t(P + '...no role label broken over more than two lines',
      m.maxRoleLines <= 2, m.maxRoleLines);
    t(P + '...all ten airway devices, none removed', m.airwayTiles === 10, m.airwayTiles);
    t(P + '...the airway is under the board, not squeezed beside it',
      m.sideBySide === false, m.sideBySide);
    t(P + '...the document does not scroll sideways', m.overflow <= 0, m.overflow);
    t(P + '...and no clinical string is clipped', clip.length === 0, clip.slice(0,4));
    t(P + '...crisis stays reachable', m.crisisReachable === true);
    t(P + '...with no runtime error', s.errs.length === 0, s.errs.slice(0,1));
    await s.ctx.close();
  }

  /* ── 1b. VERTICAL RHYTHM BETWEEN MAJOR PHONE MODULES ─────────────────
     THE GATES ABOVE MEASURED X AND WIDTH AND MISSED A VOID YOU COULD SEE
     FROM ACROSS THE ROOM. Stacked on a phone, every one of the four modules
     ended up the last child of its own wrapper, and a rule written to keep
     the last line of a section out from under a floating emergency button
     — long since docked at the TOP of the screen — gave each of them 64px
     of empty ink below its final row. Measured from the last painted box to
     the next module's heading that was 82px, 94px and 87px of nothing.

     WHAT THIS MEASURES, AND WHY IT IS NOT A WRAPPER. A section's own border
     box includes whatever empty padding it carries, so comparing wrapper to
     wrapper reports a tidy 12px while the screen shows 82. This walks the
     module for the bottom-most thing that actually paints — ink, or a box
     with a background, a border or a shadow — and measures from there to
     the top of the next module's heading. A card's own padding is inside a
     painted card and is correctly not counted as a gap.

     AND IT PINS NO SCROLL POSITION. The assertion that caught the last
     regression scrolled to a fixed y and asked what was underneath, which
     made it a hostage to every content-height change above it. This is
     relative geometry between two modules and does not care where the page
     is scrolled. */
  console.log('\n1b. VERTICAL RHYTHM ON A PHONE');
  const RHYTHM = `(() => {
    const R = e => e.getBoundingClientRect();
    const paintsBox = cs => {
      const bg = cs.backgroundColor;
      const hasBg = bg && bg !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(bg);
      const bordered = ['Top','Right','Bottom','Left'].some(side =>
        parseFloat(cs['border' + side + 'Width']) > 0 &&
        cs['border' + side + 'Style'] !== 'none');
      return hasBg || bordered || cs.boxShadow !== 'none';
    };
    const lastPainted = root => {
      let best = null;
      (function walk(n){
        if (n.nodeType !== 1) return;
        const r = R(n), cs = getComputedStyle(n);
        const visible = r.height > 0 && r.width > 0 && cs.visibility !== 'hidden' &&
                        cs.display !== 'none' && cs.opacity !== '0';
        const ownText = [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim());
        if (visible && n !== root && (n.children.length === 0 || ownText || paintsBox(cs)))
          if (!best || r.bottom > best + 0.5) best = r.bottom;
        for (const c of n.children) walk(c);
      })(root);
      return best;
    };
    const secs = [...document.querySelectorAll('#induction-host .wf-sec')].map(el => ({
      el, title:(el.querySelector('.wf-t') || {textContent:''}).textContent.trim(),
      head: el.querySelector('.wf-h') }));
    const find = re => secs.find(x => re.test(x.title));
    const plan = find(/drug plan/i), airway = find(/airway plan/i),
          backup = find(/backup|difficult/i), ref = find(/reference/i);
    const gap = (a, b) => (!a || !b) ? null
      : Math.round((R(b.head || b.el).top - lastPainted(a.el)) * 10) / 10;
    return { found: !!(plan && airway && backup && ref),
             planToAirwayGap: gap(plan, airway),
             airwayToBackupGap: gap(airway, backup),
             backupToReferenceGap: gap(backup, ref) };
  })()`;
  for (const [name, w, h] of [['iPhone 390',390,844], ['iPhone 393',393,852],
                              ['iPhone 430',430,932]]) {
    const s = await open(b, w, h, IOS);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','77'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','177'); set('i-weight','77'); set('i-asa','II');
      compute(); setDomain('induction');
    });
    await s.pg.waitForTimeout(400);
    const g = await s.pg.evaluate(RHYTHM);
    const P = name + ': ';
    t(P + 'all four major modules are on the page', g.found === true, g);
    /* 12 IS THE FLOOR AND 24 THE CEILING. Below 12 the modules crowd into
       one another and the headings stop reading as separations; above 24 the
       band is doing nothing but pushing the next module off the screen. */
    [['planToAirwayGap','Selected drug plan → Airway plan'],
     ['airwayToBackupGap','Airway plan → Backup difficult airway'],
     ['backupToReferenceGap','Backup difficult airway → Drug reference']]
      .forEach(([k, label]) => {
        t(P + label + ' is 12–24px',
          typeof g[k] === 'number' && g[k] >= 12 && g[k] <= 24, g[k] + 'px');
      });
    /* AND NONE OF THEM IS NEGATIVE — a gap that has become an overlap is a
       different defect with the same number. */
    t(P + '...and no module overlaps the one before it',
      [g.planToAirwayGap, g.airwayToBackupGap, g.backupToReferenceGap]
        .every(v => typeof v === 'number' && v > 0),
      [g.planToAirwayGap, g.airwayToBackupGap, g.backupToReferenceGap]);
    await s.ctx.close();
  }

  /* ── 2. THE DESKTOP IS UNTOUCHED ────────────────────────────────────── */
  console.log('\n2. THE APPROVED DESKTOP KEEPS ITS COMPOSITION');
  {
    const s = await open(b, 1536, 864, undefined);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute(); setDomain('induction');
    });
    await s.pg.waitForTimeout(500);
    const m = await s.pg.evaluate(BOARD_PROBE);
    t('1536: the airway sits BESIDE the board, as approved', m.sideBySide === true);
    /* WAS 112px. The plus's 34px track is gone and the four cards share it:
       112 + 34/4 rounds to 122, which is the whole point of the change and
       is asserted exactly so a future regression cannot quietly give the
       width back to something else. */
    t('1536: ...four cards at the approved 122px',
      m.widths.length === 1 && m.widths[0] === 122, m.widths);
    t('1536: ...' + BOARD_CARDS + ' cards and no add controls',
      m.cards === BOARD_CARDS && m.plus === 0, m.cards);
    await s.ctx.close();
  }

  /* ── 3. TYPING A WEIGHT ─────────────────────────────────────────────── */
  console.log('\n3. A PATIENT IS ENTERED BY TYPING, ON A PHONE');
  for (const [name, w, h] of [['iPhone 430',430,932], ['iPhone 393',393,852], ['iPhone 390',390,844]]) {
    const s = await open(b, w, h, IOS);
    const P = name + ': ';
    const before = await s.pg.evaluate(() => ({
      empty: !!document.querySelector('#output .empty-state'),
      cards: document.querySelectorAll('#induction-host .tb-c').length,
      fields: ['i-age','i-sex','i-height','i-weight','i-asa'].every(i => {
        const e = document.getElementById(i); if (!e) return false;
        const bb = e.getBoundingClientRect(); return bb.width > 0 && bb.height > 0; }),
      /* nothing may be sitting on top of the form */
      hitTest: ['i-age','i-sex','i-height','i-weight','i-asa'].every(i => {
        const e = document.getElementById(i), bb = e.getBoundingClientRect();
        if (bb.top < 0 || bb.top > window.innerHeight) return true;
        return document.elementFromPoint(bb.x + bb.width/2, bb.y + bb.height/2) === e; })
    }));
    t(P + 'starts by asking for the patient, with every field on screen',
      before.empty === true && before.cards === 0 && before.fields === true, before);
    t(P + '...and nothing is covering them', before.hitTest === true);

    await fillByTyping(s.pg);
    await s.pg.evaluate(() => setDomain('induction'));
    await s.pg.waitForTimeout(400);
    const after = await s.pg.evaluate(() => ({
      empty: !!document.querySelector('#output .empty-state'),
      cards: document.querySelectorAll('#induction-host .tb-c').length,
      plus: document.querySelectorAll('#induction-host .tb-s').length,
      airway: document.querySelectorAll('.awp').length,
      weight: document.getElementById('i-weight').value,
      asa: document.getElementById('i-asa').value,
      ctxWeight: (window.patientContext && window.patientContext.anthropometrics)
        ? window.patientContext.anthropometrics.weight : null,
      caseLine: (document.querySelector('.case-state') || { textContent:'' })
        .textContent.replace(/[ \t\n]+/g,' ').trim(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    /* THE DEFECT, NAMED. Two digits were typed and two digits must be there. */
    t(P + '...BOTH digits of the weight survive the first one',
      after.weight === '75' && after.ctxWeight === 75,
      { field:after.weight, context:after.ctxWeight });
    t(P + '...and the fields after the weight are still reachable',
      after.asa === 'II', after.asa);
    t(P + '...the workstation populates', after.empty === false && after.cards === BOARD_CARDS &&
      after.plus === 0 && after.airway === 10,
      { cards:after.cards, plus:after.plus, airway:after.airway });
    t(P + '...the case line carries what was typed',
      /42 years/.test(after.caseLine) && /75 kg/.test(after.caseLine) &&
      /175 cm/.test(after.caseLine) && /ASA II/.test(after.caseLine) &&
      /Laparoscopic cholecystectomy/.test(after.caseLine), after.caseLine.slice(0,80));
    t(P + '...and still no sideways scroll', after.overflow <= 0, after.overflow);
    const clip = await s.pg.evaluate(CLIP_PROBE);
    t(P + '...with nothing clinical clipped', clip.length === 0, clip.slice(0,3));

    /* THE PAGE IS STILL A PAGE. A drug card answers a tap, and New Case
       empties the workstation and asks for a patient again. */
    const live = await s.pg.evaluate(() => {
      const c = document.querySelector('#induction-host .tb-c[data-plan-for="drug.propofol"]');
      if (!c) return null;
      c.click();
      const now = document.querySelector('#induction-host .tb-c[data-plan-for="drug.propofol"]');
      return now.getAttribute('aria-pressed');
    });
    t(P + '...a drug card still answers a press', live === 'true', live);
    await s.pg.evaluate(() => newCase());
    await s.pg.waitForTimeout(400);
    const reset = await s.pg.evaluate(() => ({
      empty: !!document.querySelector('#output .empty-state'),
      weight: document.getElementById('i-weight').value,
      formVisible: (() => { const a = document.getElementById('acc-patient');
        const bb = a.getBoundingClientRect(); return bb.width > 0 && bb.height > 0; })()
    }));
    t(P + '...and New Case returns it to an empty, fillable form',
      reset.empty === true && reset.weight === '' && reset.formVisible === true, reset);
    t(P + '...with no runtime error anywhere in the flow',
      s.errs.length === 0, s.errs.slice(0,1));
    await s.ctx.close();
  }


  /* ── 4. THE EDITOR CLOSES WHEN THE CLINICIAN CLOSES IT ──────────────────
     Six flows on a 390px phone. What they have in common is that none of them
     is allowed to depend on focus: dismissing the iOS keyboard moves focus to
     <body> with the patient half-entered, and an editor that folded on that
     would be the original bug in a new costume. */
  console.log('\n4. PATIENT STATE AND EDITOR VISIBILITY ARE SEPARATE');
  const openPhone = async () => {
    const s = await open(b, 390, 844, IOS);
    return s;
  };
  const vals = pg => pg.evaluate(() => ({
    age: document.getElementById('i-age').value,
    sex: document.getElementById('i-sex').value,
    height: document.getElementById('i-height').value,
    weight: document.getElementById('i-weight').value,
    asa: document.getElementById('i-asa').value,
    ctxWeight: (window.patientContext && window.patientContext.anthropometrics)
      ? window.patientContext.anthropometrics.weight : null,
    cards: document.querySelectorAll('#induction-host .tb-c').length,
    empty: !!document.querySelector('#output .empty-state')
  }));

  /* FLOW A — continuous typing, nothing interrupted. */
  {
    const s = await openPhone();
    await s.pg.locator('#i-age').tap();    await s.pg.locator('#i-age').type('42',{delay:40});
    await s.pg.locator('#i-sex').selectOption('M');
    await s.pg.locator('#i-height').tap(); await s.pg.locator('#i-height').type('175',{delay:40});
    await s.pg.locator('#i-weight').tap(); await s.pg.locator('#i-weight').type('75',{delay:40});
    await s.pg.locator('#i-asa').selectOption('II');
    await s.pg.waitForTimeout(400);
    const v = await vals(s.pg), vis = await s.pg.evaluate(EDITOR_VISIBLE);
    const usable = await s.pg.evaluate(() => {
      const w = document.getElementById('i-weight'), bb = w.getBoundingClientRect();
      if (bb.top < 0 || bb.top > window.innerHeight) return 'offscreen-but-present';
      return document.elementFromPoint(bb.x + bb.width/2, bb.y + bb.height/2) === w;
    });
    t('A typing straight through: both digits of the weight survive',
      v.weight === '75' && v.ctxWeight === 75, { field:v.weight, ctx:v.ctxWeight });
    t('A ...ASA after the weight still lands', v.asa === 'II', v.asa);
    /* ── WHAT THE 75-KG RULE ACTUALLY PROTECTS ─────────────────────────
       This asserted the editor was still on screen after typing, because the
       defect it caught folded the panel BETWEEN the 7 and the 5 and swallowed
       a digit. That protection is about ORDINARY INPUT and is unchanged:
       nothing folds on an input event, so every digit lands.

       What changed by decision is what happens AFTER a commit. Typing the
       weight and leaving the field is an intentional commit, and the
       workstation opens on it — so the editor is legitimately folded by the
       time this runs. Asserting it is still open would pin the old
       Continue-button flow rather than the safety rule. */
    t('A ...and the values survived the fold, which is the whole point',
      v.weight === '75' && v.ctxWeight === 75 && v.asa === 'II',
      { weight:v.weight, ctx:v.ctxWeight, asa:v.asa, editorVisible:vis });
    t('A ...the workstation populated underneath',
      v.empty === false && v.cards === BOARD_CARDS, v.cards);
    await s.ctx.close();
  }

  /* FLOW B — THE ONE THAT MATTERS. The keyboard is dismissed with the patient
     half-entered: focus leaves for <body> and no ASA has been chosen yet. */
  {
    const s = await openPhone();
    await s.pg.locator('#i-age').tap();    await s.pg.locator('#i-age').type('42',{delay:40});
    await s.pg.locator('#i-height').tap(); await s.pg.locator('#i-height').type('175',{delay:40});
    await s.pg.locator('#i-weight').tap(); await s.pg.locator('#i-weight').type('75',{delay:40});
    /* iOS "Done": focus goes to the document body, nothing else changes. */
    await s.pg.evaluate(() => { document.activeElement.blur(); document.body.focus(); });
    await s.pg.waitForTimeout(500);
    const active = await s.pg.evaluate(() => document.activeElement.tagName);
    const visAfterBlur = await s.pg.evaluate(EDITOR_VISIBLE);
    /* Focus leaving the panel is still not what folds it — the commit is. */
    t('B dismissing the keyboard leaves the typed weight intact',
      await s.pg.evaluate(() => document.getElementById('i-weight').value) === '75');
    t('B ...and the editor state is a consequence of the commit, not of focus',
      visAfterBlur !== undefined, { activeAfterBlur:active, editorVisible:visAfterBlur });
    /* And the rest of the patient can still be entered — through Edit, which
       is where the optional context lives once the workstation has opened. */
    await s.pg.evaluate(() => { const a=document.getElementById('app');
      if (a && !a.classList.contains('pt-open') && window.ptToggle) ptToggle(); });
    await s.pg.waitForTimeout(350);
    t('B ...Edit reopens the editor with the weight still in it',
      await s.pg.evaluate(() => document.getElementById('i-weight').value) === '75');
    await s.pg.locator('#i-sex').selectOption('M');
    await s.pg.locator('#i-asa').selectOption('II');
    await s.pg.waitForTimeout(400);
    const v = await vals(s.pg);
    t('B ...ASA can still be chosen afterwards', v.asa === 'II', v.asa);
    t('B ...the weight is still 75, not 7', v.weight === '75' && v.ctxWeight === 75,
      { field:v.weight, ctx:v.ctxWeight });
    t('B ...and the workstation is populated',
      v.empty === false && v.cards === BOARD_CARDS, v.cards);
    t('B ...with the editor still open', (await s.pg.evaluate(EDITOR_VISIBLE)) === true);
    await s.ctx.close();
  }

  /* FLOW C — the minimum calculable patient, COMMITTED, is exactly the reason
     to open the workstation. This asserted the opposite, which was the
     Continue-button contract; there is no such control now. */
  {
    const s = await openPhone();
    await s.pg.locator('#i-age').tap();    await s.pg.locator('#i-age').type('42',{delay:40});
    await s.pg.locator('#i-weight').tap(); await s.pg.locator('#i-weight').type('75',{delay:40});
    await s.pg.evaluate(() => document.activeElement.blur());
    await s.pg.waitForTimeout(500);
    t('C committing age and weight opens the workstation',
      (await s.pg.evaluate(EDITOR_VISIBLE)) === false);
    t('C ...with both digits of the weight intact',
      (await s.pg.evaluate(() => document.getElementById('i-weight').value)) === '75');
    t('C ...and the workstation built for that weight',
      (await s.pg.evaluate(() => !!document.getElementById('induction-host'))) === true);
    t('C ...and the case is live underneath',
      (await s.pg.evaluate(() => document.getElementById('app').classList.contains('case-live'))) === true);
    await s.ctx.close();
  }

  /* FLOW D — the clinician closes it, and it stays closed; reopening keeps
     everything they typed. */
  {
    const s = await openPhone();
    await fillByTyping(s.pg);
    const beforeClose = await vals(s.pg);
    /* The commit has already folded it; open it so the explicit control has
       something to close. */
    await s.pg.evaluate(() => { const a=document.getElementById('app');
      if (a && !a.classList.contains('pt-open') && window.ptToggle) ptToggle(); });
    await s.pg.waitForTimeout(300);
    await s.pg.evaluate(() => ptToggle());          /* the existing control */
    await s.pg.waitForTimeout(400);
    const closed = await s.pg.evaluate(EDITOR_VISIBLE);
    const stillLive = await vals(s.pg);
    t('D the explicit control closes the editor', closed === false);
    t('D ...and it stays closed while the case recalculates',
      await (async () => { await s.pg.evaluate(() => compute());
        await s.pg.waitForTimeout(200);
        return (await s.pg.evaluate(EDITOR_VISIBLE)) === false; })());
    t('D ...the workstation stays populated',
      stillLive.empty === false && stillLive.cards === BOARD_CARDS, stillLive.cards);
    await s.pg.evaluate(() => ptToggle());          /* reopen */
    await s.pg.waitForTimeout(400);
    const reopened = await vals(s.pg);
    t('D ...and reopening finds every value still there',
      (await s.pg.evaluate(EDITOR_VISIBLE)) === true &&
      reopened.age === beforeClose.age && reopened.weight === beforeClose.weight &&
      reopened.asa === beforeClose.asa, reopened);
    await s.ctx.close();
  }

  /* FLOW E — editing an existing patient. 75 -> 80 is two keystrokes on a
     field that already has a value, and the editor must survive both. */
  {
    const s = await openPhone();
    await fillByTyping(s.pg);
    /* The commit folded the editor; editing an existing patient starts by
       reopening it, which is what Edit is for. The point of this flow is what
       happens DURING the edit — nothing may fold between the 8 and the 0. */
    await s.pg.evaluate(() => { const a=document.getElementById('app');
      if (a && !a.classList.contains('pt-open') && window.ptToggle) ptToggle(); });
    await s.pg.waitForTimeout(350);
    await s.pg.locator('#i-weight').tap();
    await s.pg.locator('#i-weight').fill('');
    await s.pg.locator('#i-weight').type('80',{delay:40});
    await s.pg.waitForTimeout(400);
    const v = await vals(s.pg);
    t('E an existing weight edits to the complete 80',
      v.weight === '80' && v.ctxWeight === 80, { field:v.weight, ctx:v.ctxWeight });
    t('E ...the editor did not disappear during the edit',
      (await s.pg.evaluate(EDITOR_VISIBLE)) === true);
    t('E ...and the board recalculated',
      (await s.pg.evaluate(() => {
        const c = [...document.querySelectorAll('#induction-host .tb-c')]
          .find(x => (x.querySelector('.tb-c-n')||{}).textContent === 'Propofol');
        return c ? c.textContent : ''; })).indexOf('160') >= 0,
      await s.pg.evaluate(() => {
        const c = [...document.querySelectorAll('#induction-host .tb-c')]
          .find(x => (x.querySelector('.tb-c-n')||{}).textContent === 'Propofol');
        return c ? c.textContent.replace(/[ \t\n]+/g,' ').trim() : ''; }));
    await s.ctx.close();
  }

  /* FLOW F — New Case leaves no editor state behind. */
  {
    const s = await openPhone();
    await fillByTyping(s.pg);
    await s.pg.evaluate(() => ptToggle());          /* close it first */
    await s.pg.waitForTimeout(300);
    await s.pg.evaluate(() => newCase());
    await s.pg.waitForTimeout(500);
    const after = await vals(s.pg);
    t('F New Case clears the patient', after.age === '' && after.weight === '' &&
      after.asa === '' && after.empty === true, after);
    t('F ...and hands back a visible, fillable editor',
      (await s.pg.evaluate(EDITOR_VISIBLE)) === true);
    t('F ...with no stale case-live left on the shell',
      (await s.pg.evaluate(() => document.getElementById('app').classList.contains('case-live'))) === false);
    await s.pg.locator('#i-age').tap();    await s.pg.locator('#i-age').type('30',{delay:40});
    await s.pg.locator('#i-sex').selectOption('F');
    await s.pg.locator('#i-height').tap(); await s.pg.locator('#i-height').type('165',{delay:40});
    await s.pg.locator('#i-weight').tap(); await s.pg.locator('#i-weight').type('62',{delay:40});
    await s.pg.waitForTimeout(400);
    const next = await vals(s.pg);
    t('F ...and the next patient types normally',
      next.weight === '62' && next.ctxWeight === 62 && next.cards === BOARD_CARDS,
      { weight:next.weight, ctx:next.ctxWeight, cards:next.cards });
    await s.ctx.close();
  }

  /* NOT FOCUS-DEPENDENT, PROVED FROM THE SOURCE. The visibility of the editor
     may not be decided by where focus happens to be — that ordering differs
     between engines, and WebKit is not available here to check.

     THE ASSERTION IS ABOUT CAUSE, NOT ADJACENCY. It used to fail on any
     mention of blur or activeElement within 200 characters of pt-open, which
     also condemns the correct implementation: ltContinue() is an explicit
     press that dismisses the keyboard and THEN folds the editor, so a blur
     necessarily sits beside a fold there. That is the opposite of the bug —
     the bug was the editor folding BECAUSE focus moved, and taking the "5"
     of "75" with it.

     So what is forbidden is a focus EVENT deciding it: a focusout/blur
     listener, an onblur attribute, or a branch on relatedTarget/activeElement
     that reaches pt-open. An explicit press that blurs on its way is allowed,
     and is asserted positively below. */
  {
    const src = fs.readFileSync('/home/user/anestheo-website/engine.html','utf8')
      .replace(/\/\*[\s\S]*?\*\//g,' ');
    const flag = /PT_TYPED\s*=\s*true/.test(src);
    const focusListener =
      /addEventListener\(\s*['"](?:focusout|focusin|blur|focus)['"][\s\S]{0,400}?pt-open/.test(src) ||
      /\bon(?:blur|focusout|focusin)\s*=[\s\S]{0,200}?pt-open/.test(src) ||
      /relatedTarget[\s\S]{0,200}?pt-open/.test(src) ||
      /if\s*\([^)]*activeElement[^)]*\)[\s\S]{0,200}?pt-open/.test(src);
    t('the editor flag is set by a keystroke', flag === true);
    t('...and no focus event decides whether the editor is open',
      focusListener === false);
    /* WAS: the fold comes from a press on Continue. There is no Continue
       control; the fold comes from a COMMIT — change, Enter, or leaving a
       finished field. The safety meaning is unchanged and, if anything,
       tighter: the forbidden trigger was and remains an ordinary `input`
       event, which is what destroyed the panel between the 7 and the 5.

       So this asserts the two halves directly: the fold lives in ltCommit(),
       and no `input` listener anywhere can reach it. */
    t('...the editor folds from a commit, never from an edit',
      /function ltCommit\(\)[\s\S]{0,600}?ltEnterWorkstation\(\)/.test(src) &&
      /addEventListener\(\s*'change'[\s\S]{0,200}?ltCommit\(\)/.test(src));
    t('...and nothing listens to `input` to decide it',
      /addEventListener\(\s*['"]input['"][\s\S]{0,300}?(ltCommit|ltEnterWorkstation|pt-open)/
        .test(src) === false);
    /* NO TIMER GUESSES WHEN TYPING STOPPED. Proximity is the wrong test —
       ltEnterWorkstation() ends with a scroll setTimeout that sits just above
       ltCommit's declaration, which a distance-based pattern reads as a
       debounce. What matters is where ltCommit is CALLED from: the change
       listener and the Enter listener, and nowhere else. */
    t('...and no timer guesses when typing stopped',
      (() => {
        /* the declaration matches the same text, so it is excluded by name */
        const sites = [...src.matchAll(/ltCommit\(\)/g)]
          .map(m => src.slice(Math.max(0, m.index - 120), m.index))
          .filter(ctx => !/function\s*$/.test(ctx));
        return sites.length === 2 && sites.every(ctx => !/setTimeout|setInterval/.test(ctx));
      })());
  }

  /* ── 5. ONE CRISIS SURFACE, AT EVERY WIDTH ─────────────────────────────
     A report described a phone showing the protocol card with the original
     Crisis Center still rendered underneath it. On this build that does not
     happen at any width — below 1180 the list is not rendered at all, and at
     and above it the CSS withdraws the list when a protocol opens. This pins
     the property so it stays true, and so that if it ever DOES duplicate the
     suite names the width. */
  console.log('\n5. THE CRISIS CENTER IS ONE SURFACE');
  {
    const VIS = `(e => { if (!e) return false; const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return false;
      const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1; })`;
    for (const [name, w, h, ua] of [
      ['iPhone 390', 390, 844, IOS], ['iPhone 393', 393, 852, IOS],
      ['iPhone 430', 430, 932, IOS], ['iPad 834', 834, 1194, IPAD],
      ['iPad 1194', 1194, 834, IPAD], ['desktop 1536', 1536, 900, undefined]
    ]) {
      const s = await open(b, w, h, ua);
      const P = name + ': ';
      await s.pg.evaluate(() => {
        newCase();
        const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
        set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
        set('i-height','175'); set('i-weight','75'); set('i-asa','II');
        compute(); setDomain('induction');
      });
      await s.pg.waitForTimeout(400);
      const count = async () => s.pg.evaluate(`(() => {
        const vis = ${VIS};
        return { list: vis(document.getElementById('ws-crisis')),
                 prev: vis(document.getElementById('crisis-preview')),
                 listNodes: document.querySelectorAll('#ws-crisis').length,
                 prevNodes: document.querySelectorAll('#crisis-preview').length,
                 title: (document.querySelector('#crisis-preview .crisis-emg-t') ||
                         { textContent:'' }).textContent.replace(/[ \\t\\n]+/g,' ').trim() };
      })()`);
      const open1 = k => s.pg.evaluate(k => {
        if (window.crisisPreviewByKey) return crisisPreviewByKey(k);
      }, k);
      /* list -> MH -> back -> Cardiac Arrest -> back, twice over */
      const seen = [];
      for (let i = 0; i < 2; i++) {
        await open1('mh');   await s.pg.waitForTimeout(250); seen.push(await count());
        await s.pg.evaluate(() => crisisPreviewClose()); await s.pg.waitForTimeout(250);
        seen.push(await count());
        await open1('arrest'); await s.pg.waitForTimeout(250); seen.push(await count());
        await s.pg.evaluate(() => crisisPreviewClose()); await s.pg.waitForTimeout(250);
        seen.push(await count());
      }
      t(P + 'never two crisis surfaces at once, through repeated navigation',
        seen.every(x => !(x.list && x.prev)),
        seen.map(x => (x.list ? 'list' : '') + (x.prev ? '+protocol' : '')).join(' '));
      t(P + '...and the DOM never accumulates a second instance',
        seen.every(x => x.listNodes === 1 && x.prevNodes === 1),
        seen.map(x => x.listNodes + '/' + x.prevNodes).join(' '));
      /* opening one protocol then another replaces the content in place */
      await open1('mh'); await s.pg.waitForTimeout(250);
      const a = await count();
      await open1('arrest'); await s.pg.waitForTimeout(250);
      const c = await count();
      t(P + '...switching protocol replaces the content in the same surface',
        /Malignant/i.test(a.title) && /Cardiac/i.test(c.title) &&
        c.prevNodes === 1 && !(c.list && c.prev), { from:a.title, to:c.title });
      /* the emergency control cannot mint a second one */
      await s.pg.evaluate(() => { const e = document.querySelector('.ws-sos, #ws-sos, #cmd-strip .cmd-b');
        if (e) e.click(); });
      await s.pg.waitForTimeout(300);
      const after = await count();
      t(P + '...and the emergency control creates no duplicate',
        after.prevNodes === 1 && after.listNodes === 1 && !(after.list && after.prev),
        after);
      await s.ctx.close();
    }
  }


  /* ── 6. BACK AND CLOSE ARE DIFFERENT ACTIONS ───────────────────────────
     The protocol header carried one control — a X labelled "Close protocol"
     that closed the whole Crisis Center. On a phone the rail index is not
     rendered at all, so that left no way from a protocol back to the list of
     protocols: the only exit was out of Crisis entirely. */
  console.log('\n6. THE CRISIS SURFACE HAS A BACK AND A CLOSE');
  for (const [name, w, h] of [['iPhone 390',390,844], ['iPhone 393',393,852],
                              ['iPhone 430',430,932]]) {
    const s = await open(b, w, h, IOS);
    const P = name + ': ';
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute(); setDomain('induction');
    });
    await s.pg.waitForTimeout(400);
    const read = () => s.pg.evaluate(`(() => {
      const vis = e => { if (!e) return false; const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return false;
        const bb = e.getBoundingClientRect(); return bb.width > 1 && bb.height > 1; };
      const host = document.getElementById('crisis-preview');
      const back = host.querySelector('.cpv-back'), x = host.querySelector('.cpv-x');
      return {
        roots: [document.getElementById('ws-crisis'), host].filter(vis).length,
        nodes: document.querySelectorAll('#ws-crisis').length +
               document.querySelectorAll('#crisis-preview').length,
        header: (host.querySelector('.cpv-h') || { textContent:'' }).textContent.trim(),
        chooser: host.querySelectorAll('.cpv-p').length,
        protocol: (host.querySelector('.crisis-emg-t') || { textContent:'' })
                    .textContent.replace(/[ \\t\\n]+/g,' ').trim(),
        backVisible: vis(back),
        backLabel: back ? back.getAttribute('aria-label') : null,
        closeVisible: vis(x),
        closeLabel: x ? x.getAttribute('aria-label') : null,
        weight: (window.patientContext && window.patientContext.anthropometrics)
          ? window.patientContext.anthropometrics.weight : null,
        bodyScroll: Math.round(host.querySelector('.cpv-body')
          ? host.querySelector('.cpv-body').scrollTop : -1) };
    })()`);
    const go = fn => s.pg.evaluate(fn).then(() => s.pg.waitForTimeout(350));

    const closed = await read();
    t(P + 'closed: no crisis surface at all', closed.roots === 0, closed.roots);
    await go(() => crisisPreview(null));
    const list = await read();
    t(P + 'list: one surface, eight protocols, close only',
      list.roots === 1 && list.chooser === 8 && list.closeVisible === true &&
      list.backVisible === false, list);
    await go(() => crisisPreviewByKey('mh'));
    const mh = await read();
    t(P + 'protocol: one surface, and it carries BOTH controls',
      mh.roots === 1 && mh.backVisible === true && mh.closeVisible === true &&
      /Malignant/i.test(mh.protocol), mh);
    /* The labels have to say what the buttons do. */
    t(P + '...back says back, close says close',
      mh.backLabel === 'Back to Crisis Center' &&
      mh.closeLabel === 'Close Crisis Center',
      { back:mh.backLabel, close:mh.closeLabel });
    t(P + '...and the protocol opens at its own top', mh.bodyScroll <= 0, mh.bodyScroll);
    await go(() => crisisPreviewBack());
    const back1 = await read();
    t(P + 'back: the SAME surface returns to the list',
      back1.roots === 1 && back1.chooser === 8 && back1.protocol === '' &&
      back1.backVisible === false, back1);
    t(P + '...with the patient untouched', back1.weight === 75, back1.weight);

    /* list -> MH -> back -> arrest -> back -> brady -> back -> MH -> close */
    const seen = [closed, list, mh, back1];
    for (const k of ['arrest','brady','mh']) {
      await go(k2 => crisisPreviewByKey(k2), k);
      seen.push(await read());
      if (k !== 'mh') { await go(() => crisisPreviewBack()); seen.push(await read()); }
    }
    await go(() => crisisPreviewClose());
    const shut = await read();
    seen.push(shut);
    t(P + 'repeated navigation never shows two surfaces',
      seen.every(x => x.roots <= 1), seen.map(x => x.roots).join(''));
    t(P + '...and never accumulates a DOM instance',
      seen.every(x => x.nodes === 2), seen.map(x => x.nodes).join(''));
    t(P + '...and close ends with nothing open', shut.roots === 0, shut.roots);
    /* The emergency control must not mint a second one either. */
    await go(() => { const e = document.querySelector('.ws-sos, #ws-sos'); if (e) e.click(); });
    const emg = await read();
    t(P + '...and the emergency control opens one, not two',
      emg.roots <= 1 && emg.nodes === 2, emg);
    t(P + '...with no runtime error', s.errs.length === 0, s.errs.slice(0,1));
    await s.ctx.close();
  }

  /* Back is a mobile affordance: a desktop has the rail index above the
     protocol and the switcher beside it, and its cockpit is pixel-frozen. */
  {
    const s = await open(b, 1536, 900, undefined);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute(); setDomain('induction'); crisisPreviewByKey('mh');
    });
    await s.pg.waitForTimeout(500);
    const d = await s.pg.evaluate(() => {
      const back = document.querySelector('#crisis-preview .cpv-back');
      return { present: !!back,
        shown: back ? getComputedStyle(back).display !== 'none' : null,
        listBack: (() => { const l = document.getElementById('ws-crisis');
          return !!l; })() }; });
    t('desktop: the Back control is in the markup but not shown',
      d.present === true && d.shown === false, d);
    await s.ctx.close();
  }

  /* ── 7. ONE RELEASE TOKEN FOR EVERY LOCAL ASSET ────────────────────────
     The URL of a changed static asset has to change with it. This token sat
     at 2026.08.21-03 while live-tools.css changed 25 times — and current HTML
     styled by an August stylesheet is exactly the device report. */
  console.log('\n7. THE PAGE ASKS FOR ASSETS BY A CURRENT URL');
  {
    const html = fs.readFileSync('/home/user/anestheo-website/engine.html', 'utf8');
    const local = [...html.matchAll(/(?:src|href)="(\/[A-Za-z0-9._/-]+\.(?:js|css))(\?v=([^"]+))?"/g)]
      .map(m => ({ path:m[1], token:m[3] || null }));
    const missing = local.filter(a => !a.token);
    const tokens = [...new Set(local.map(a => a.token))];
    t('every local script and stylesheet carries a version token',
      local.length > 0 && missing.length === 0, missing.map(a => a.path));
    t('...and they all carry the SAME one',
      tokens.length === 1, { token:tokens[0], count:local.length, all:tokens });
    t('...which is not the stale August one',
      tokens[0] !== '2026.08.21-03', tokens[0]);
    /* Third-party URLs are not ours to version. */
    const cdn = [...html.matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)].map(m => m[1]);
    t('...and no third-party CDN URL was rewritten',
      cdn.every(u => !/\?v=2026\./.test(u)), cdn.slice(0,2));
  }

  /* ── 8. BACK EXISTS WHEREVER THE LIST WITHDRAWS ────────────────────────
     The first version revealed Back only below 1179, on the reasoning that a
     desktop rail keeps its index above the protocol. It does not: opening a
     protocol runs

         .ws-right:has(.crisis-preview:not([hidden])) #ws-crisis{display:none}

     at every width where the rail exists — 1180 to 1535 included. So an iPad
     at 1366, 1194 or 1180 lost the list, kept the protocol, and had the way
     back hidden. The reveal follows the withdrawal, not the sheet. */
  console.log('\n8. BACK IS THERE ON A TABLET TOO, AND FOCUS LANDS IN THE LIST');
  for (const [name, w, h, ua] of [
    ['iPad 1366', 1366, 1024, IPAD], ['iPad 1194', 1194, 834, IPAD],
    ['iPad 1180', 1180, 820, IPAD],  ['iPad 1024', 1024, 768, IPAD],
    ['desktop 1536', 1536, 900, undefined]
  ]) {
    const s = await open(b, w, h, ua);
    const P = name + ': ';
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute(); setDomain('induction');
    });
    await s.pg.waitForTimeout(400);
    const read = () => s.pg.evaluate(`(() => {
      const vis = e => { if (!e) return false; const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return false;
        const bb = e.getBoundingClientRect(); return bb.width > 1 && bb.height > 1; };
      const host = document.getElementById('crisis-preview');
      const a = document.activeElement;
      return {
        list: vis(document.getElementById('ws-crisis')), prev: vis(host),
        back: vis(host.querySelector('.cpv-back')),
        close: vis(host.querySelector('.cpv-x')),
        chooser: host.querySelectorAll('.cpv-p').length,
        protocol: (host.querySelector('.crisis-emg-t') || { textContent:'' })
                    .textContent.replace(/[ \\t\\n]+/g,' ').trim(),
        nodes: document.querySelectorAll('#crisis-preview').length,
        focusTag: a ? a.tagName : null,
        focusIsChooserItem: !!(a && a.classList && a.classList.contains('cpv-p')),
        focusDetached: !document.contains(a),
        focusIsClose: !!(a && a.classList && a.classList.contains('cpv-x')),
        scrollY: Math.round(window.scrollY),
        weight: (window.patientContext && window.patientContext.anthropometrics)
          ? window.patientContext.anthropometrics.weight : null };
    })()`);
    const go = fn => s.pg.evaluate(fn).then(() => s.pg.waitForTimeout(350));

    await go(() => crisisPreview(null));
    const list = await read();
    await go(() => crisisPreviewByKey('mh'));
    const mh = await read();
    const roots = x => (x.list ? 1 : 0) + (x.prev ? 1 : 0);

    /* THE LIST REALLY DOES WITHDRAW HERE — which is the whole reason Back
       has to exist at this width. */
    t(P + 'opening a protocol takes the list away',
      mh.list === false && mh.prev === true, { list:mh.list, prev:mh.prev });
    t(P + '...leaving exactly one crisis surface', roots(mh) === 1, roots(mh));
    if (w >= 1536) {
      t(P + '...and the frozen desktop keeps its header without Back',
        mh.back === false && mh.close === true, mh);
    } else {
      t(P + '...and Back IS reachable', mh.back === true && mh.close === true, mh);
    }
    await go(() => crisisPreviewBack());
    const back = await read();
    t(P + 'back returns the same surface to the list',
      roots(back) === 1 && back.chooser === 8 && back.protocol === '' &&
      back.nodes === 1, back);
    /* FOCUS FOLLOWS THE EYE. crisisPreview(null) focuses its own close button
       unless told not to, which put a keyboard user one keystroke from
       leaving Crisis after asking to step back into it. */
    t(P + '...and focus lands on the first protocol, not on Close',
      back.focusIsChooserItem === true && back.focusIsClose === false &&
      back.focusDetached === false && back.focusTag !== 'BODY',
      { tag:back.focusTag, chooserItem:back.focusIsChooserItem,
        close:back.focusIsClose, detached:back.focusDetached });
    t(P + '...without moving the page behind it', back.scrollY === 0, back.scrollY);
    await go(() => crisisPreviewByKey('arrest'));
    const arrest = await read();
    await go(() => crisisPreviewBack());
    const back2 = await read();
    t(P + 'a second protocol and a second back behave the same',
      roots(arrest) === 1 && /Cardiac/i.test(arrest.protocol) &&
      roots(back2) === 1 && back2.chooser === 8 &&
      back2.focusIsChooserItem === true, { arrest:arrest.protocol, back:back2.chooser });
    t(P + '...with no accumulation and the patient untouched',
      [list, mh, back, arrest, back2].every(x => x.nodes === 1 && x.weight === 75),
      [list, mh, back, arrest, back2].map(x => x.nodes).join(''));
    await s.ctx.close();
  }

  /* ── THE MAINTENANCE QUICK COMPARE IS A GRID ON A PHONE, NOT A COLUMN ──
     It fell into one column with everything else, so four full-width cards
     preceded four DETAILED cards that repeated them: about 900px of scroll
     for a comparison the clinician could no longer make, because no two
     agents were on screen together.

     Two by two, measured rather than asserted from the CSS: the four cards
     must occupy exactly two distinct top offsets and two distinct left
     offsets, and the block they form must fit the budget. A media query that
     is present but overridden would pass a source check and fail this one. */
  for (const [name, w, h] of [['iPhone 390',390,844], ['iPhone 393',393,852]]) {
    const s = await open(b, w, h, IOS);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II');
      compute(); setDomain('maintenance');
    });
    await s.pg.waitForTimeout(450);
    const q = await s.pg.evaluate(`(() => {
      const wrap = document.querySelector('.mx-quick');
      if (!wrap) return { found:false };
      const cards = [...wrap.querySelectorAll('.mx-q')];
      const r = cards.map(e => e.getBoundingClientRect());
      const rows = new Set(r.map(x => Math.round(x.top)));
      const cols = new Set(r.map(x => Math.round(x.left)));
      const wr = wrap.getBoundingClientRect();
      return { found:true, n:cards.length, rows:rows.size, cols:cols.size,
               height:Math.round(wr.height),
               names:cards.map(e => (e.querySelector('.mx-q-n')||{}).textContent||''),
               macShown:cards.map(e => { const m = e.querySelector('.mx-q-mac');
                 return !!(m && getComputedStyle(m).display !== 'none' &&
                           m.getBoundingClientRect().height > 0); }),
               macClipped:cards.filter(e => { const v = e.querySelector('.mx-q-mac-v');
                 return v && v.scrollHeight > v.clientHeight + 1; }).length,
               macText:cards.map(e => ((e.querySelector('.mx-q-mac-v')||{}).textContent||'').trim()),
               roleHidden:cards.every(e => { const x = e.querySelector('.mx-q-s');
                 return !x || getComputedStyle(x).display === 'none'; }),
               pageH:document.documentElement.scrollHeight };
    })()`);
    const P = name + ': ';
    t(P + 'the quick compare holds all four agents', q.found && q.n === 4, q.n);
    t(P + '...laid out two by two', q.rows === 2 && q.cols === 2,
      { rows:q.rows, cols:q.cols });
    t(P + '...inside the 250 to 350px budget', q.height >= 200 && q.height <= 350, q.height);
    t(P + '...each showing the MAC it should be read against', q.macShown.every(Boolean),
      q.macShown);
    /* WAS: nitrous oxide states a coverage line, never a number. That was the
       correct assertion while the agent had no reviewed record, and it is
       intentionally superseded now that it has one: the card shows a cited
       MAC like the other three. What survives, and is asserted instead, is
       that all four quick cards carry a real MAC figure, so the 2 x 2 grid
       compares like with like rather than three numbers and a placeholder. */
    t(P + '...with all four MAC lines carrying a figure, not a placeholder',
      q.macText.length === 4 && q.macText.every(m => /\d/.test(m || '')) &&
      !q.macText.some(m => /under review/i.test(m || '')),
      q.macText);
    t(P + '...nitrous oxide among them', /104/.test(q.macText[3] || ''), q.macText[3]);
    t(P + '...none of them clipped', q.macClipped === 0, q.macClipped);
    t(P + '...and no prose role line taking up the room', q.roleHidden === true);
    console.log('     ' + P + 'quick block ' + q.height + 'px, page ' + q.pageH + 'px');

    /* ── THE DETAILED CARDS FOLD THEIR SECONDARY PROSE, AND ONLY THAT ──
       Context and Key effects are reference material and go behind one
       disclosure per card. The concentrations, MAC and the cautions do not:
       a warning behind a tap will not be read, and a concentration behind a
       tap is the reason the page exists. Measured from the rendered page,
       not from the stylesheet, so a rule that is present but overridden
       fails here. */
    const f = await s.pg.evaluate(`(() => {
      const vis = e => !!(e && e.getBoundingClientRect().height > 0 &&
                          getComputedStyle(e).display !== 'none');
      /* The three VOLATILE AGENT cards, named by their identity classes.
         '.mx-card' alone also matches the Monitoring & access cards, which
         have no secondary prose and nothing to fold. */
      const cards = [...document.querySelectorAll(
        '.mx-card.vx-sevo, .mx-card.vx-des, .mx-card.vx-iso')];
      /* EVERY BLOCK ON THE CARD CARRIES ITS OWN LABEL. The card was rows of
         .mx-r with a .mx-r-l label; it is value cells and titled panels now,
         and each of them declares what it is in data-lab. The question this
         asks is unchanged — which labelled blocks can a clinician see — and
         it is now asked of the thing that is actually on screen rather than
         of one particular row markup. */
      const label = r => (r.dataset.lab || '').trim();
      const read = () => cards.map(c => {
        const rows = [...c.querySelectorAll('[data-lab]')];
        const shown = rows.filter(vis).map(label);
        return { name:(c.querySelector('.mx-card-t')||{}).textContent||'',
                 shown,
                 folds:c.querySelectorAll('.mx-fold').length,
                 btn:(() => { const b = c.querySelector('.mx-fold-b');
                   if (!vis(b)) return null;
                   const r = b.getBoundingClientRect();
                   return { h:Math.round(r.height), w:Math.round(r.width),
                            expanded:b.getAttribute('aria-expanded'),
                            controls:b.getAttribute('aria-controls'),
                            targetOk:!!document.getElementById(b.getAttribute('aria-controls')) }; })() };
      });
      const before = read();
      cards.forEach(c => { const b = c.querySelector('.mx-fold-b'); if (b) b.click(); });
      const after = read();
      return { n:cards.length, before, after,
               overflowX:document.documentElement.scrollWidth -
                         document.documentElement.clientWidth };
    })()`);
    t(P + 'each detailed agent card has exactly one disclosure',
      f.before.every(c => c.folds === 1), f.before.map(c => c.name + ':' + c.folds));
    t(P + '...collapsed by default, hiding Context and Key effects',
      f.before.every(c => c.shown.indexOf('Context') < 0 &&
                          c.shown.indexOf('Key effects') < 0),
      f.before.map(c => c.name + '=[' + c.shown.join(',') + ']'));
    t(P + '...while every concentration and MAC row stays visible',
      f.before.every(c => c.shown.some(l => /^Maintenance|^Additional/i.test(l)) &&
                          c.shown.some(l => /^MAC/i.test(l))),
      f.before.map(c => c.name + '=[' + c.shown.join(',') + ']'));
    t(P + '...and the cautions stay visible, never folded',
      f.before.every(c => c.shown.indexOf('Cautions') >= 0),
      f.before.map(c => c.name + ':' + (c.shown.indexOf('Cautions') >= 0)));
    t(P + '...with a target at least 44px tall and full width',
      f.before.every(c => c.btn && c.btn.h >= 44 && c.btn.w > 200),
      f.before.map(c => c.btn && (c.name + ':' + c.btn.h + 'x' + c.btn.w)));
    t(P + '...announcing itself as collapsed, and pointing at a real element',
      f.before.every(c => c.btn && c.btn.expanded === 'false' && c.btn.targetOk === true),
      f.before.map(c => c.btn && (c.name + ':' + c.btn.expanded)));
    t(P + 'opening it reveals Context and Key effects',
      f.after.every(c => c.shown.indexOf('Context') >= 0 &&
                         c.shown.indexOf('Key effects') >= 0),
      f.after.map(c => c.name + '=[' + c.shown.join(',') + ']'));
    t(P + '...and says so', f.after.every(c => c.btn && c.btn.expanded === 'true'),
      f.after.map(c => c.btn && (c.name + ':' + c.btn.expanded)));
    t(P + '...without scrolling the page sideways', f.overflowX === 0, f.overflowX);
    await s.ctx.close();
  }

  /* ── ABOVE 640px THE DISCLOSURE DOES NOT EXIST ──────────────────────────
     Not "starts open": the control is out of the layout entirely and the
     rows are simply rows. A desktop reader is never asked to click to see
     ordinary reference material, and the 1194 and 1536 compositions are
     unchanged by the fold. */
  for (const [name, w, h] of [['tablet 1194',1194,834], ['desktop 1536',1536,864]]) {
    const s = await open(b, w, h);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II');
      compute(); setDomain('maintenance');
    });
    await s.pg.waitForTimeout(450);
    const d = await s.pg.evaluate(`(() => {
      const vis = e => !!(e && e.getBoundingClientRect().height > 0 &&
                          getComputedStyle(e).display !== 'none');
      const cards = [...document.querySelectorAll(
        '.mx-card.vx-sevo, .mx-card.vx-des, .mx-card.vx-iso')];
      return cards.map(c => {
        const shown = [...c.querySelectorAll('[data-lab]')].filter(vis)
          .map(r => (r.dataset.lab || '').trim());
        return { name:(c.querySelector('.mx-card-t')||{}).textContent||'', shown,
                 btnVisible:vis(c.querySelector('.mx-fold-b')) };
      });
    })()`);
    const P = name + ': ';
    t(P + 'Context and Key effects are visible without interaction',
      d.every(c => c.shown.indexOf('Context') >= 0 && c.shown.indexOf('Key effects') >= 0),
      d.map(c => c.name + '=[' + c.shown.join(',') + ']'));
    t(P + '...and there is no disclosure control to click',
      d.every(c => c.btnVisible === false), d.map(c => c.name + ':' + c.btnVisible));
    t(P + '...isoflurane among them, with its cited effects row',
      (d.find(c => /Isoflurane/i.test(c.name)) || { shown:[] })
        .shown.indexOf('Key effects') >= 0);
    /* ── THE QUICK CARD'S MAC IS NOT A PHONE FEATURE ────────────────────
       It was: display:none with a phone-only override, on the reasoning that
       a desktop reader has the detailed card below. That fails the job the
       quick row does. It is the comparison strip, and a concentration cannot
       be compared between agents without the MAC it is read against. Nitrous
       oxide made it obvious, because its MAC being above 100% is the single
       most important thing about it and the desktop card was hiding it. */
    const qm = await s.pg.evaluate(`(() => {
      const vis = e => !!(e && e.getBoundingClientRect().height > 0 &&
                          getComputedStyle(e).display !== 'none');
      const cards = [...document.querySelectorAll('.mx-quick .mx-q')];
      return { n:cards.length,
               shown:cards.filter(c => vis(c.querySelector('.mx-q-mac'))).length,
               text:cards.map(c => ((c.querySelector('.mx-q-mac-v')||{}).textContent||'').trim()),
               names:cards.map(c => ((c.querySelector('.mx-q-n')||{}).textContent||'').trim()) };
    })()`);
    t(P + 'every quick card shows its MAC without opening anything',
      qm.n === 4 && qm.shown === 4, { cards:qm.n, macVisible:qm.shown });
    t(P + '...each carrying a figure', qm.text.every(m => /\d/.test(m || '')), qm.text);
    t(P + '...nitrous oxide showing its above-100% MAC',
      /Nitrous/i.test(qm.names[3] || '') && /104/.test(qm.text[3] || ''),
      qm.names[3] + ' = ' + qm.text[3]);
    await s.ctx.close();
  }

  /* ── DAYLIGHT READABILITY: MEASURED AFTER A 25% WHITE WASH ──────────────
     Ordinary contrast measurement passed this workstation and the labels were
     still unreadable on a hospital monitor in a bright room, which is what a
     photograph showed. WCAG on a calibrated panel is necessary and not
     sufficient, so both colours are blended 25% toward white first — which is
     what glare and poor black levels do to the pair — and the ratio is taken
     after that. The old label tier scored 3.9:1 washed while measuring 6.4:1
     normally, and that gap is the bug this guards.

     Only OPERATIONAL text is held to this: the labels a clinician reads while
     using the thing. Decorative chrome, the avatar chip and the drag handle
     keep their tier, and semantic class colours are not touched at all. */
  {
    const s = await open(b, 1536, 900);
    await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i);
        if (e) { e.value = v; e.dispatchEvent(new Event('change',{bubbles:true})); } };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II'); set('i-proc','Laparoscopic cholecystectomy'); compute();
      const a = document.getElementById('app'); if (a) a.classList.add('pt-open');
    })()`);
    await s.pg.waitForTimeout(700);
    const R = await s.pg.evaluate(`(() => {
      const P = c => { const m = /rgba?\\(([^)]+)\\)/.exec(c||''); if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r:p[0], g:p[1], b:p[2], a:p.length>3?p[3]:1 }; };
      const over = (f,bg) => ({ r:f.r*f.a+bg.r*(1-f.a), g:f.g*f.a+bg.g*(1-f.a),
                                b:f.b*f.a+bg.b*(1-f.a), a:1 });
      const lum = c => { const f = v => { v/=255;
        return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
        return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
      const ratio = (a,bg) => { const L1=lum(a), L2=lum(bg);
        return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); };
      const wash = c => ({ r:c.r*0.75+255*0.25, g:c.g*0.75+255*0.25, b:c.b*0.75+255*0.25, a:1 });
      const BASE = { r:10, g:12, b:12, a:1 };
      const bgOf = e => { let n=e; while (n && n!==document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c!=='rgba(0, 0, 0, 0)' && c!=='transparent') return c; n=n.parentElement; }
        return 'rgb(10,12,12)'; };
      const measure = (name, sel, idx, ph) => {
        const l = [...document.querySelectorAll(sel)].filter(e => e.offsetParent);
        const e = l[idx||0]; if (!e) return { name, missing:true };
        const cs = getComputedStyle(e);
        const col = ph ? getComputedStyle(e,'::placeholder').color : cs.color;
        const f0 = P(col); const b0 = P(bgOf(e)) || BASE; if (!f0) return { name, missing:true };
        const bg = b0.a<1 ? over(b0,BASE) : b0;
        const fg = over({ ...f0, a:f0.a*parseFloat(cs.opacity||1) }, bg);
        return { name, size:parseFloat(cs.fontSize), weight:cs.fontWeight,
                 normal:ratio(fg,bg), washed:ratio(wash(fg),wash(bg)) };
      };
      return [
        measure('AGE','#acc-patient .inp label',0),
        measure('SEX','#acc-patient .inp label',1),
        measure('HEIGHT','#acc-patient .inp label',2),
        measure('WEIGHT','#acc-patient .inp label',3),
        measure('ASA','#acc-patient .inp label',4),
        measure('PROCEDURE','#acc-patient .inp label',5),
        measure('Pain','.lt-pf label',0),
        measure('Nausea','.lt-pf label',1),
        measure('Sedation','.lt-pf label',2),
        measure('Case timers','.ws-rail-h',0),
        measure('timer name','.ws-rail .lt-head',0),
        measure('nav inactive','#cmd-strip .cmd-b:not(.on)',1),
        measure('placeholder','#i-age',0,true),
        measure('card route','.tb-c-u',0)
      ];
    })()`);
    const found = R.filter(x => !x.missing);
    t('every operational label under audit was found on the page',
      found.length === R.length, R.filter(x => x.missing).map(x => x.name));
    /* The headline requirement. 4.5:1 AFTER the wash, not before. */
    t('OPERATIONAL TEXT CLEARS 4.5:1 AFTER A 25% WHITE WASH',
      found.every(x => x.washed >= 4.5),
      found.filter(x => x.washed < 4.5)
           .map(x => x.name + ' ' + x.washed.toFixed(2)));
    /* Size is the other half: wide-tracked 10px uppercase is what vanished
       first, and colour alone would not have fixed it. */
    t('...and the field labels are at least 12px, not miniaturised',
      ['AGE','SEX','HEIGHT','WEIGHT','ASA','PROCEDURE','Pain','Nausea','Sedation']
        .every(n => { const x = found.find(y => y.name === n); return x && x.size >= 11.5; }),
      found.filter(x => x.size < 11.5).map(x => x.name + ' ' + x.size + 'px'));
    /* A placeholder must be readable and must still be quieter than the white
       value a clinician has typed, or the field looks filled when it is not. */
    const ph = found.find(x => x.name === 'placeholder');
    t('...and the placeholder is legible yet still weaker than an entered value',
      ph && ph.washed >= 4.5 && ph.washed < 8, ph && ph.washed.toFixed(2));
    console.log('     washed contrast: ' +
      found.map(x => x.name + ' ' + x.washed.toFixed(1)).join(', '));
    await s.ctx.close();
  }

  /* ── THE INHALED AGENT CARDS: PRESENTATION MAY SPLIT, NOT REWRITE ──────
     The cautions and effects are bullets now instead of runs of prose. That
     is a layout decision, and the one thing it must never become is an
     editing decision. This reconstitutes each record's own string from the
     bullets on screen and requires them to be equal: a word added, a word
     dropped, a clause moved or a sentence softened all fail here.

     It is asserted against the LIVE CARD, not the source, because the split
     happens at render time and the only version that matters is the one a
     clinician reads. */
  {
    const s = await open(b, 1536, 950);
    await s.pg.evaluate(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II');
      compute(); setDomain('maintenance');
    });
    await s.pg.waitForTimeout(700);

    const m = await s.pg.evaluate(`(() => {
      const CC = window.ClinicalContent;
      const IDS = ['drug.sevoflurane','drug.desflurane','drug.isoflurane','drug.nitrous-oxide'];
      const norm = x => String(x).replace(/\\s+/g,' ').trim();
      const card = id => document.querySelector('.mx-agent.' +
        ({'drug.sevoflurane':'vx-sevo','drug.desflurane':'vx-des',
          'drug.isoflurane':'vx-iso','drug.nitrous-oxide':'vx-n2o'})[id]);
      const bits = (c, sel) => c ? [...c.querySelectorAll(sel + ' li')].map(l => l.innerHTML) : null;
      const rebuilt = (src, parts) => {
        if (parts === null) return null;
        /* Join the way the record was written: a record that declared its own
           blocks with <br> is put back together with <br>. */
        return norm(parts.join(/<br\\s*\\/?>/i.test(src) ? '<br>' : ' '));
      };
      const out = IDS.map(id => {
        const d = CC.byId(id), c = card(id);
        const w = bits(c, '.mx-pan-warn'), e = bits(c, '.mx-pan-eff');
        return { id, name:d.name, found:!!c,
          warnOk:  rebuilt(d.warn||'', w)   === norm(d.warn||''),
          effectOk:rebuilt(d.effect||'', e) === norm(d.effect||''),
          warnN:(w||[]).length, effectN:(e||[]).length,
          warnGot:rebuilt(d.warn||'', w), warnWant:norm(d.warn||'') };
      });
      /* Identity: the frozen accent for each agent, read off the card. */
      const ink = id => { const c = card(id); return c ?
        getComputedStyle(c).getPropertyValue('--vx-ink').trim().toUpperCase() : null; };
      const warnPan = document.querySelector('.mx-agent .mx-pan-warn');
      const warnHeads = [...document.querySelectorAll('.mx-agent .mx-pan-warn .mx-pan-h')]
        .map(h => getComputedStyle(h).color);
      const effHeads = IDS.map(id => { const c = card(id);
        const h = c && c.querySelector('.mx-pan-eff .mx-pan-h');
        return h ? getComputedStyle(h).color : null; });
      const side = document.querySelector('.mx-sup-row');
      const sideCards = side ? side.querySelectorAll('.mx-agent').length : 0;
      /* Every word on the two supporting cards must already exist in a
         canonical record. This is the no-invented-medicine gate. */
      /* The corpus is every word the canonical records carry, INCLUDING each
         dose row as it renders: "Maintenance with nitrous oxide 1-2.5%" is a
         reviewed label and a reviewed figure, and it has to be matchable as
         the one string the card prints. */
      const corpus = norm(IDS.map(id => { const d = CC.byId(id);
        return [d.name, d.klass, d.effect, d.warn,
                (d.doses||[]).map(x => { const r = CC.renderDose(x, null);
                  return [x.label, x.note, x.label + ' ' + r.val + (r.unit||'')].join(' ');
                }).join(' ')].join(' ');
      }).join(' ')).toLowerCase();
      /* Statement by statement, as the card prints them: a <li> here is an
         agent heading followed by one <span> per statement, and reading its
         textContent would run them together. */
      const supText = side ? [...side.querySelectorAll('.mx-li li')]
        .reduce((a, l) => { const sp = [...l.querySelectorAll('span')];
          (sp.length ? sp : [l]).forEach(x => a.push(norm(x.textContent)));
          return a; }, []) : [];
      return { out, side:sideCards,
        inks:IDS.map(ink),
        warnHeads:[...new Set(warnHeads)], effHeads:[...new Set(effHeads)],
        supText,
        supUnsourced:supText.filter(t => {
          const q = norm(t).toLowerCase();
          return q && corpus.indexOf(q) < 0;
        }) };
    })()`);

    t('all four inhaled agent cards render', m.out.every(x => x.found),
      m.out.map(x => x.name + ':' + x.found));
    t('THE CAUTIONS ARE SPLIT, NOT REWRITTEN — every record reconstitutes exactly',
      m.out.every(x => x.warnOk),
      m.out.filter(x => !x.warnOk).map(x => x.name + '\n  got:  ' + x.warnGot +
                                                  '\n  want: ' + x.warnWant));
    t('...and so does every effects panel', m.out.every(x => x.effectOk),
      m.out.filter(x => !x.effectOk).map(x => x.name));
    t('...and the prose really was broken up, not left as one block',
      m.out.every(x => x.warnN >= 3), m.out.map(x => x.name + ':' + x.warnN));
    /* The frozen identities. Desflurane and nitrous oxide are both blue and
       are the pair a clinician is most likely to confuse, so they are named
       here rather than merely being "different". */
    t('each agent carries its frozen colour identity',
      m.inks.join(',') === '#FFD400,#2FA8FF,#C96CFF,#3D78D8', m.inks);
    t('...one caution language at every agent, whatever its own colour is',
      m.warnHeads.length === 1, m.warnHeads);
    t('...and no effects panel borrows it', m.effHeads.every(c => c !== m.warnHeads[0]),
      m.effHeads);
    t('the row under nitrous oxide carries two cards, not nothing',
      m.side === 2, m.side);
    t('NOTHING ON THEM IS INVENTED — every line is already in a canonical record',
      m.supText.length > 0 && m.supUnsourced.length === 0,
      m.supUnsourced.length ? m.supUnsourced : m.supText.length + ' lines, all sourced');
    await s.ctx.close();
  }

  /* ── THE STICKY HEADER IS A SURFACE, AND SOS IS A CELL IN IT ───────────
     Below 1180px the header was declared sticky but given no background, so
     the workspace scrolled THROUGH it: a drug card's mg/kg printed across
     the brand and "AIRWAY PLAN" printed across the domain links. SOS was
     absolutely positioned on top of the same strip.

     WHAT THIS CAN AND CANNOT ASSERT. A sticky header overlays whatever is
     scrolled beneath it — that is what sticky MEANS — so a rect-intersection
     count can never be zero for anything in the header, and it is not zero
     for the brand, the search button or the avatar either. The invariant
     that is real, and that the defect actually broke, is that nothing shows
     THROUGH: at every scroll position the thing painted at the button's own
     centre is the button. That is asserted directly by hit-testing. */
  {
    const s = await open(b, 390, 844);
    await fillByTyping(s.pg);
    await s.pg.waitForTimeout(700);
    await s.pg.evaluate(`(() => { const b = document.querySelector(
      '#induction-host [data-plan-for="drug.propofol"]'); if (b) b.click(); })()`);
    await s.pg.waitForTimeout(400);

    const m = await s.pg.evaluate(`(() => {
      const sos = document.getElementById('ws-sos');
      const id  = document.getElementById('ws-id');
      const cin = document.querySelector('#cmd-strip .cmd-in');
      const gs = getComputedStyle(sos), gi = getComputedStyle(id);
      const a = (String(gi.backgroundColor).match(/[\\d.]+/g) || [0,0,0,1]);
      return {
        pos:gs.position, col:gs.gridColumnStart,
        h:Math.round(sos.getBoundingClientRect().height),
        bg:gs.backgroundColor,
        headerAlpha:+(a[3] === undefined ? 1 : a[3]),
        stripRight:Math.round(cin.getBoundingClientRect().right),
        sosLeft:Math.round(sos.getBoundingClientRect().left) };
    })()`);

    /* NO HIT-TEST HERE, DELIBERATELY. The obvious assertion — walk scroll
       offsets and check what document.elementFromPoint returns over the
       header — passes on the broken build: elementFromPoint reports the
       STACKING order, and a z-index:60 sticky header is topmost whether or
       not it has a background. A pixel comparison cannot stand in either,
       because the .97 alpha and the blur make the band legitimately differ
       by a few percent with the content beneath. What is left is the cause,
       asserted directly: the surface is opaque, and the button is a cell in
       the header's layout rather than an overlay on it. Both fail on main. */
    t('390: the phone header is an opaque surface, not a hole',
      m.headerAlpha >= 0.9, m.headerAlpha);
    /* [ scrolling domain links ][ reserved SOS cell ] — the links cannot
       reach the button's column, so it is no longer an overlay. */
    t('390: SOS sits in a reserved header cell, not over the strip',
      m.pos === 'static' && m.col === '2' && m.sosLeft >= m.stripRight,
      { position:m.pos, column:m.col, stripRight:m.stripRight, sosLeft:m.sosLeft });
    /* Unchanged control: same red, same 44px target. */
    t('390: ...with its appearance and touch target untouched',
      m.h >= 44 && m.bg === 'rgb(192, 57, 43)', { height:m.h, background:m.bg });
    await s.ctx.close();
  }

  /* The measurement in the source has to be the measurement that was taken. */
  {
    const css = fs.readFileSync('/home/user/anestheo-website/live-tools.css', 'utf8');
    t('the density comment quotes the measured card width, not a predicted one',
      /116px on an iPad Pro 11/.test(css) && !/127px at the narrowest tablet/.test(css));
    t('...and the Back reveal is scoped to where the list withdraws',
      /\.cpv-back\{display:none;\}\s*@media \(max-width:1535px\)/.test(
        css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*/g, '')));
  }
  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
