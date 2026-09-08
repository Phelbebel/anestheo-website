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
   reading than a narrower card. The approved desktop card is 112px, so 110 is
   the floor below which the tablet is no longer showing the composition it
   was approved at. Phones drop to two per line instead. */
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
  await pg.locator('#i-age').tap();    await pg.locator('#i-age').type('42', { delay:40 });
  await pg.locator('#i-sex').selectOption('M');
  await pg.locator('#i-height').tap(); await pg.locator('#i-height').type('175', { delay:40 });
  await pg.locator('#i-weight').tap(); await pg.locator('#i-weight').type('75', { delay:40 });
  await pg.locator('#i-asa').selectOption('II');
  await pg.locator('#i-proc').tap();
  await pg.locator('#i-proc').type('Laparoscopic cholecystectomy', { delay:8 });
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
    t(P + 'the whole board renders — 16 cards, 4 rows, 4 controls',
      m.cards === 16 && m.rows === 4 && m.plus === 4,
      { cards:m.cards, rows:m.rows, plus:m.plus });
    t(P + '...no card below the ' + MIN_CARD + 'px floor',
      m.minWidth >= MIN_CARD, { min:m.minWidth, widths:m.widths });
    /* NO ORPHAN DRUG. A tablet row is four cards on ONE line; a phone row is
       two and two, which is the approved phone treatment and not a wrap. What
       is forbidden is an uneven break — 3+1 leaves the fourth drug stranded
       under the first three and stretches the role label over both lines,
       which is exactly what auto-fit produced between 1181 and 1299. */
    const EXPECT = w >= 740 ? '4' : '2+2';
    t(P + '...every clinical row breaks evenly, with no orphan card',
      m.perRow.every(r => r.split('+').every(n => n === r.split('+')[0])), m.perRow);
    t(P + '...four across on a tablet, two and two on a phone',
      m.perRow.every(r => r === EXPECT), { expect:EXPECT, got:m.perRow });
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
    t('1536: ...four cards at the approved 112px',
      m.widths.length === 1 && m.widths[0] === 112, m.widths);
    t('1536: ...16 cards and 4 controls', m.cards === 16 && m.plus === 4);
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
    t(P + '...the workstation populates', after.empty === false && after.cards === 16 &&
      after.plus === 4 && after.airway === 10,
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
    t('A ...the editor is still on screen', vis === true);
    t('A ...and still reachable', usable === true || usable === 'offscreen-but-present', usable);
    t('A ...the workstation populated underneath', v.empty === false && v.cards === 16, v.cards);
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
    t('B dismissing the keyboard moves focus out of the panel', active === 'BODY', active);
    t('B ...and the editor is STILL on screen', visAfterBlur === true);
    /* And the rest of the patient can still be entered. */
    await s.pg.locator('#i-sex').selectOption('M');
    await s.pg.locator('#i-asa').selectOption('II');
    await s.pg.waitForTimeout(400);
    const v = await vals(s.pg);
    t('B ...ASA can still be chosen afterwards', v.asa === 'II', v.asa);
    t('B ...the weight is still 75, not 7', v.weight === '75' && v.ctxWeight === 75,
      { field:v.weight, ctx:v.ctxWeight });
    t('B ...and the workstation is populated', v.empty === false && v.cards === 16, v.cards);
    t('B ...with the editor still open', (await s.pg.evaluate(EDITOR_VISIBLE)) === true);
    await s.ctx.close();
  }

  /* FLOW C — the minimum calculable patient is not a reason to fold. */
  {
    const s = await openPhone();
    await s.pg.locator('#i-age').tap();    await s.pg.locator('#i-age').type('42',{delay:40});
    await s.pg.locator('#i-weight').tap(); await s.pg.locator('#i-weight').type('75',{delay:40});
    await s.pg.evaluate(() => document.activeElement.blur());
    await s.pg.waitForTimeout(500);
    t('C age and weight alone do not close the editor',
      (await s.pg.evaluate(EDITOR_VISIBLE)) === true);
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
      stillLive.empty === false && stillLive.cards === 16, stillLive.cards);
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
      next.weight === '62' && next.ctxWeight === 62 && next.cards === 16,
      { weight:next.weight, ctx:next.ctxWeight, cards:next.cards });
    await s.ctx.close();
  }

  /* NOT FOCUS-DEPENDENT, PROVED FROM THE SOURCE. The visibility of the editor
     may not be decided by where focus happens to be — that ordering differs
     between engines, and WebKit is not available here to check. */
  {
    const src = fs.readFileSync('/home/user/anestheo-website/engine.html','utf8')
      .replace(/\/\*[\s\S]*?\*\//g,' ');
    const flag = /PT_TYPED\s*=\s*true/.test(src);
    const focusDriven = /(focusout|blur|relatedTarget|activeElement)[\s\S]{0,200}?pt-open/.test(src);
    t('the editor flag is set by a keystroke', flag === true);
    t('...and nothing about focus decides whether the editor is open',
      focusDriven === false);
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
