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

/* THE FLOOR. The approved desktop card is 112px and four of them fit only at
   1536 and above; below that the board reflows rather than shrinking, and no
   responsive card may be narrower than the desktop's own. 140 is the declared
   minimum and is what the CSS grid is given as its minmax floor. */
const MIN_CARD = 140;

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
  await b.close();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
