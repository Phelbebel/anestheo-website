/* ═════════════════════════════════════════════════════════════════════════
   MOBILE CASE FLOW — THE PHONE REACHES THE MEDICINE
   ─────────────────────────────────────────────────────────────────────────
   The rejected build could not be driven on a phone. Typing an age and a
   weight — the two values every dose on the page is a function of — produced
   no induction workstation, because compute() would not build one without a
   sex and a height, and #induction-host is created inside the output those
   four fields gate. The workstation was not below the fold; it was not in
   the document.

   These tests type through the real inputs with real key events. A test that
   assigns a value directly cannot see the bug that made "75" into "7", so
   none of them do it for the primary path.

   WHAT THEY PROTECT
     the case-ready split          age + weight open the workstation
     the anthropometric withhold   height/sex take only their own values
     the 75 kg fix                 nothing folds the editor on an input event
     clinician intent              strategy never touches planKeys
     no fabricated clinical value  no volatile number, no TCI target
   ═════════════════════════════════════════════════════════════════════════ */
const { chromium } = require('playwright');
const fs = require('fs');

const MOCK = fs.readFileSync('/tmp/adm/mock.js', 'utf8');
const BASE = process.env.LT_BASE || 'http://127.0.0.1:8890';
const VIEWS = [[390, 844], [393, 852], [430, 932]];

let pass = 0, fail = 0;
const t = (n, ok, d) => {
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + n.padEnd(62) + ' ' +
    (d === undefined ? '' : JSON.stringify(d).slice(0, 150)));
};

const route = ctx => ctx.route('**/*', r => {
  const u = r.request().url();
  if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({ status:200, contentType:'text/javascript', body:MOCK });
  if (/googleapis|gstatic/.test(u))  return r.fulfill({ status:200, contentType:'text/css', body:'' });
  if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  return r.continue();
});

const phone = (b, w, h) => b.newContext({
  viewport:{ width:w, height:h }, isMobile:true, hasTouch:true, deviceScaleFactor:3,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
            '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });

/* The state a clinician could describe by looking at the screen. */
const snap = pg => pg.evaluate(() => {
  const vis = e => !!(e && e.getClientRects().length > 0);
  const app = document.getElementById('app');
  const host = document.getElementById('induction-host');
  const strat = host ? [...host.querySelectorAll('.wf-sec')]
    .find(s => /Induction strategy/i.test(s.textContent)) : null;
  const pc = window.patientContext;
  const go = document.getElementById('pt-go-b');
  return {
    hostExists:!!host,
    stratY: strat ? Math.round(strat.getBoundingClientRect().top + window.pageYOffset) : null,
    stratVisible: vis(strat),
    age:(document.getElementById('i-age') || {}).value,
    weight:(document.getElementById('i-weight') || {}).value,
    sex:(document.getElementById('i-sex') || {}).value,
    height:(document.getElementById('i-height') || {}).value,
    asa:(document.getElementById('i-asa') || {}).value,
    caseReady: pc ? !!pc.caseReady : null,
    complete: pc ? !!pc.complete : null,
    derived: pc ? pc.derived : null,
    scalars: pc ? pc.dosingScalars : null,
    ptOpen: app ? app.classList.contains('pt-open') : null,
    caseLive: app ? app.classList.contains('case-live') : null,
    goVisible: vis(go), goDisabled: go ? go.disabled : null,
    newCaseVisible: vis(document.querySelector('.case-new')),
    /* The semantic state. On a phone the whole case bar stands down while the
       editor is the active surface, so painted visibility answers a different
       question from "is a reset being offered". */
    newCaseOffered: !document.querySelector('.case-new').hidden,
    npVisible: vis(document.querySelector('.case-np')),
    npInEditor: !!document.querySelector('#acc-patient .case-np'),
    /* SURFACES, NOT WORDS. Counting elements that happen to contain the
       phrase "No active patient" passed a screen showing the case bar AND
       the editor AND an empty-output prompt, because only one of the three
       used that wording. These are the three actual roots. */
    surfaces: {
      caseBar: vis(document.querySelector('.case-bar')),
      ptSummary: vis(document.querySelector('.pt-row')),
      editor: vis(document.getElementById('acc-patient')),
      outputPrompt: vis(document.querySelector('#output .empty-state'))
    },
    active: document.activeElement ?
      (document.activeElement.id || document.activeElement.tagName) : null,
    scrollY: window.pageYOffset,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    planKeys: JSON.stringify((window.Induction && window.Induction.planKeys) || []),
    technique: window.Induction ? window.Induction.technique : null,
    stx: (() => { const e = document.querySelector('.stx');
      return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; })(),
    boardRows: host ? [...host.querySelectorAll('.tb-row')].map(r => {
      const c = [...r.children].filter(vis);
      return c.length + '/' + new Set(c.map(x => Math.round(x.getBoundingClientRect().top))).size;
    }) : null,
    rocuronium: (() => {
      if (!host) return null;
      const c = [...host.querySelectorAll('.tb-c')]
        .find(x => /Rocuronium/.test((x.querySelector('.tb-c-n') || {}).textContent || ''));
      if (!c) return null;
      const g = s => ((c.querySelector(s) || {}).textContent || '').trim();
      return { use:g('.tb-c-u'), rule:g('.tb-c-r'), amt:g('.tb-c-a'), cov:g('.tb-c-cov') };
    })(),
    suxamethonium: (() => {
      if (!host) return null;
      const c = [...host.querySelectorAll('.tb-c')]
        .find(x => /Suxamethonium/.test((x.querySelector('.tb-c-n') || {}).textContent || ''));
      if (!c) return null;
      const g = s => ((c.querySelector(s) || {}).textContent || '').trim();
      return { use:g('.tb-c-u'), rule:g('.tb-c-r'), amt:g('.tb-c-a'), cov:g('.tb-c-cov') };
    })(),
    rsiChip: !!document.querySelector('.tb-g-x'),
    hostText: host ? host.textContent.replace(/\s+/g, ' ') : ''
  };
});

/* The optional context is entered through Edit once the commit has opened the
   workstation, which is where it lives now. Anything setting sex, height or
   ASA after a weight has been committed reopens it first, as the clinician
   does. */
async function reopenEditor(pg) {
  await pg.evaluate(() => { const a = document.getElementById('app');
    if (a && !a.classList.contains('pt-open') && window.ptToggle) ptToggle(); });
  await pg.waitForTimeout(300);
}

/* Real keystrokes into a real field. */
async function type(pg, sel, text) {
  await pg.click(sel);
  await pg.waitForTimeout(80);
  await pg.keyboard.type(text, { delay:70 });
  await pg.waitForTimeout(320);
}

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.PW_CHROME ||
      '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    for (const [w, h] of VIEWS) {
      const P = w + ': ';
      const ctx = await phone(b, w, h);
      await route(ctx);
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
      pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);

      /* ── FLOW A · fresh load, then the minimum case ───────────────────── */
      const fresh = await snap(pg);
      t(P + 'fresh: New case is not offered with no case',
        fresh.newCaseOffered === false && fresh.newCaseVisible === false);
      t(P + 'fresh: no induction workstation yet', fresh.hostExists === false);
      t(P + 'fresh: the editor is the ONE patient-start surface',
        fresh.surfaces.editor === true && fresh.surfaces.caseBar === false &&
        fresh.surfaces.ptSummary === false && fresh.surfaces.outputPrompt === false,
        fresh.surfaces);
      t(P + 'fresh: Create patient record lives in Patient Setup', fresh.npInEditor === true);
      t(P + 'fresh: ...and is hidden for an unauthorized session', fresh.npVisible === false);
      /* WAS: Continue present and disabled. There is no Continue control —
         the workstation opens on the commit of a valid age and weight — so
         this asserts the button is gone and nothing opened without one. */
      t(P + 'fresh: there is no Continue control',
        fresh.goVisible === false && fresh.goDisabled === null);
      t(P + 'fresh: ...and nothing opened on its own', fresh.hostExists === false);
      t(P + 'fresh: no horizontal overflow', fresh.overflowX <= 0, fresh.overflowX);

      await type(pg, '#i-age', '42');
      await type(pg, '#i-weight', '75');
      const min = await snap(pg);
      t(P + 'A: weight is exactly 75, never 7', min.weight === '75', min.weight);
      t(P + 'A: age is 42', min.age === '42', min.age);
      t(P + 'A: caseReady is true', min.caseReady === true);
      t(P + 'A: complete is still false — sex and height are missing',
        min.complete === false);
      t(P + 'A: #induction-host EXISTS on age + weight alone', min.hostExists === true);
      t(P + 'A: Induction Strategy is rendered', min.stratY !== null, min.stratY);
      /* WAS: Continue enabled. The equivalent guarantee is that the
         workstation is reachable from age and weight alone, asserted above. */
      t(P + 'A: no Continue control is waiting to be pressed', min.goVisible === false);
      t(P + 'A: New case is offered once a case exists', min.newCaseOffered === true);
      t(P + 'A: sex stays empty — nothing defaulted', min.sex === '', min.sex);
      t(P + 'A: height stays empty — nothing estimated', min.height === '', min.height);
      t(P + 'A: no height-derived value fabricated',
        !min.derived.bmi && !min.derived.bsa, min.derived);
      t(P + 'A: no sex-derived value fabricated',
        !min.derived.ibw && !min.derived.lbw && !min.derived.abw, min.derived);
      t(P + 'A: dosing scalars carry TBW only',
        min.scalars.tbw === 75 && min.scalars.ibw == null && min.scalars.lbw == null,
        min.scalars);
      t(P + 'A: the editor did NOT fold on its own', min.ptOpen === true);
      t(P + 'A: still exactly one patient surface while typing',
        min.surfaces.editor === true && min.surfaces.caseBar === false &&
        min.surfaces.outputPrompt === false, min.surfaces);
      t(P + 'A: no horizontal overflow', min.overflowX <= 0, min.overflowX);

      /* ── MINIMUM-CASE VALIDITY · zero, negative and empty ─────────────
         One rule decides this now, and it looks at the values rather than at
         whether the input strings are non-empty. A weight of 0 or -5 used to
         satisfy every readiness check on the page and produce a case the
         doses were scaled against. Age 0 is a real age and must survive. */
      for (const [label, ageV, unit, wtV, want] of [
        ['age empty + weight 75',   '',   'y', '75', false],
        ['age 42 + weight empty',   '42', 'y', '',   false],
        ['age 42 + weight 0',       '42', 'y', '0',  false],
        ['age 42 + weight -5',      '42', 'y', '-5', false],
        ['age -1 + weight 75',      '-1', 'y', '75', false],
        ['age 0 days + weight 3.2', '0',  'd', '3.2', true],
        ['age 42 + weight 75',      '42', 'y', '75',  true]
      ]) {
        await pg.evaluate(() => window.newCase && newCase());
        await pg.waitForTimeout(250);
        if (unit !== 'y') await pg.selectOption('#i-age-unit', unit);
        if (ageV !== '') await type(pg, '#i-age', ageV);
        if (wtV !== '')  await type(pg, '#i-weight', wtV);
        await pg.waitForTimeout(250);
        const m = await snap(pg);
        const L = P + 'valid/' + label + ': ';
        t(L + 'caseReady is ' + want, m.caseReady === want,
          { caseReady:m.caseReady, age:m.age, weight:m.weight });
        /* WAS: Continue enabled/disabled. Readiness is expressed by whether
           committing opens a workstation, which caseReady and the workstation
           assertion below already state. */
        t(L + 'no Continue control exists in either state',
          m.goVisible === false, m.goVisible);
        t(L + 'case-live is ' + want, m.caseLive === want, m.caseLive);
        t(L + 'workstation ' + (want ? 'present' : 'absent'),
          m.hostExists === want, m.hostExists);
        t(L + 'New case ' + (want ? 'offered' : 'not offered'),
          m.newCaseOffered === want, m.newCaseOffered);
        if (!want) {
          /* nothing may have been scaled against a bad weight */
          t(L + 'no dose was scaled at all', m.rocuronium === null, m.rocuronium);
        } else {
          t(L + 'a dose is scaled and is a positive amount',
            !!(m.rocuronium && /[1-9]/.test(m.rocuronium.amt)) &&
            !/-/.test(m.rocuronium.amt || ''), m.rocuronium);
        }
        if (unit !== 'y') await pg.selectOption('#i-age-unit', 'y');
      }
      await pg.evaluate(() => window.newCase && newCase());
      await pg.waitForTimeout(250);
      await type(pg, '#i-age', '42');
      await type(pg, '#i-weight', '75');
      await pg.waitForTimeout(250);

      /* ── FLOW B · THE COMMIT OPENS IT ─────────────────────────────────
         There is no button to press. The weight was typed above and this blur
         is the commit — what the thumb does when it leaves the field. */
      await pg.evaluate(() => document.activeElement && document.activeElement.blur());
      await pg.waitForTimeout(1100);
      const after = await snap(pg);
      t(P + 'B: the editor folded — on the commit, not on a keystroke', after.ptOpen === false);
      t(P + 'B: age survives the transition', after.age === '42', after.age);
      t(P + 'B: weight survives the transition and is still 75', after.weight === '75', after.weight);
      t(P + 'B: the case is still live — opening is not New Case',
        after.caseLive === true && after.caseReady === true);
      t(P + 'B: focus left the input', after.active !== 'i-weight', after.active);
      t(P + 'B: Induction Strategy is visible', after.stratVisible === true);
      t(P + 'B: Induction Strategy within 650px of the document top',
        after.stratY !== null && after.stratY <= 650, after.stratY);
      t(P + 'B: the page did not jump to the document top', after.scrollY > 0, after.scrollY);
      t(P + 'B: no horizontal overflow', after.overflowX <= 0, after.overflowX);
      t(P + 'B: the editor folds and the compact summary takes over',
        after.surfaces.editor === false && after.surfaces.caseBar === true,
        after.surfaces);
      t(P + 'B: ...and New case is now both offered and reachable',
        after.newCaseOffered === true && after.newCaseVisible === true);

      /* ── FLOW C · completing the context later ───────────────────────── */
      await pg.evaluate(() => window.ptToggle && ptToggle());
      await pg.waitForTimeout(400);
      await pg.selectOption('#i-sex', 'M');
      await type(pg, '#i-height', '175');
      await pg.selectOption('#i-asa', 'II');
      await pg.waitForTimeout(600);
      const full = await snap(pg);
      t(P + 'C: age 42 survived completing the context', full.age === '42', full.age);
      t(P + 'C: weight 75 survived completing the context', full.weight === '75', full.weight);
      t(P + 'C: complete becomes true', full.complete === true);
      t(P + 'C: the height-derived values now exist',
        !!full.derived.bmi && !!full.derived.bsa, full.derived);
      t(P + 'C: the sex-derived values now exist',
        !!full.derived.ibw && !!full.derived.lbw, full.derived);
      t(P + 'C: the workstation is still there', full.hostExists === true);
      /* WAS: Continue still works. Completing the context through Edit must
         not re-trigger the transition — auto-open fires once per case. */
      t(P + 'C: completing the context does not re-fold the editor',
        full.ptOpen === true, { ptOpen:full.ptOpen });

      /* ── FLOW D · New case ───────────────────────────────────────────── */
      t(P + 'D: New case is offered while a case exists', full.newCaseOffered === true);
      await pg.evaluate(() => { if (window.newCase) newCase(); });
      await pg.waitForTimeout(700);
      const cleared = await snap(pg);
      t(P + 'D: New case clears the patient values',
        cleared.age === '' && cleared.weight === '' && cleared.height === '',
        [cleared.age, cleared.weight, cleared.height]);
      t(P + 'D: ...and the induction selections', cleared.planKeys === '[]', cleared.planKeys);
      t(P + 'D: ...and the case is no longer live', cleared.caseLive === false);
      t(P + 'D: ...and New case withdraws itself again',
        cleared.newCaseOffered === false && cleared.newCaseVisible === false);
      /* WAS: Continue disabled again. New Case clears the auto-open flag with
         the case, so the editor is the surface and the next commit opens a
         fresh workstation. */
      t(P + 'D: ...and Patient Setup is the surface again',
        cleared.surfaces.editor === true && cleared.hostExists === false, cleared.surfaces);

      t(P + 'no page or runtime errors in the whole flow', errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }

    /* ── THE TWO PATHS MUST AGREE ABOUT A CHILD ──────────────────────────
       The case-ready branch computes the paediatric working values itself
       through the SAME helpers the full path uses — maint421(),
       pedsEbvPerKg() and pedsAirwayValues() — so there is one copy of each
       formula rather than two. This asserts the consequence: the values a
       child is given cannot change merely because a height was entered.

       It is not a substitute for the sharing; the sharing is asserted
       directly below, from the source. */
    {
      const ctx = await phone(b, 390, 844);
      await route(ctx);
      const pg = await ctx.newPage();
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);
      const peds = d => ({ ebv:d.ebv, maint:d.maint, ett:d.ett,
                           ettDepth:d.ettDepth, lma:d.lma, igel:d.igel });
      for (const [label, age, wt] of
           [['child 4y 16kg', '4', '16'], ['infant 8mo 8kg', '8', '8'],
            ['neonate 3kg', '2', '3']]) {
        await pg.evaluate(() => window.newCase && newCase());
        await pg.waitForTimeout(250);
        if (label.startsWith('infant')) await pg.selectOption('#i-age-unit', 'mo');
        if (label.startsWith('neonate')) await pg.selectOption('#i-age-unit', 'w');
        await type(pg, '#i-age', age);
        await type(pg, '#i-weight', wt);
        const partial = peds(await pg.evaluate(() => window.patientContext.derived));
        await reopenEditor(pg);
        await pg.selectOption('#i-sex', 'F');
        /* Selecting the sex is itself a commit on the weight beside it, so the
           workstation opens here; Edit is how the height is added after. */
        await reopenEditor(pg);
        await type(pg, '#i-height', '103');
        const full = peds(await pg.evaluate(() => window.patientContext.derived));
        t('peds/' + label + ': age+weight values identical either side of the gate',
          JSON.stringify(partial) === JSON.stringify(full), [partial, full]);
        await pg.selectOption('#i-age-unit', 'y');
      }
      await ctx.close();
    }

    /* ── NOTHING OVERLAPS ANYTHING, MEASURED FROM REAL RECTS ────────────
       The rejected screen had the age-unit select and the weight field
       sharing 1,080 square pixels of ground, and the SOS block painted over
       the domain title so "Induction" read "Inductio". Neither is visible in
       the CSS — .ws-sos was positioned absolutely inside the scrolling strip,
       and the age cell simply needed more width than its track had. Only the
       rendered boxes show it, so only the rendered boxes are asserted. */
    for (const [w, h] of VIEWS) {
      const ctx = await phone(b, w, h);
      await route(ctx);
      const pg = await ctx.newPage();
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);
      const g = await pg.evaluate(() => {
        const R = sel => { const e = document.querySelector(sel);
          if (!e || !e.getClientRects().length) return null;
          const r = e.getBoundingClientRect();
          return { x:r.left, y:r.top + window.pageYOffset, r:r.right,
                   b:r.bottom + window.pageYOffset, w:r.width, h:r.height,
                   clipped:e.scrollWidth > e.clientWidth + 1 }; };
        const setup = document.getElementById('acc-patient');
        let last = 0;
        [...setup.querySelectorAll('input,select,button')].forEach(e => {
          if (!e.getClientRects().length) return;
          const bb = e.getBoundingClientRect().bottom + window.pageYOffset;
          if (bb > last) last = bb; });
        const domain = [...document.querySelectorAll('.cmd-b')]
          .find(e => /^Induction$/.test(e.textContent.trim()));
        return {
          age:R('#i-age'), unit:R('#i-age-unit'), weight:R('#i-weight'),
          sex:R('#i-sex'), height:R('#i-height'), asa:R('#i-asa'), proc:R('#i-proc'),
          go:R('#pt-go-b'), setup:R('#acc-patient'), bar:R('#acc-patient .input-bar'),
          sos:R('.ws-sos'), find:R('.ws-id-find'), avatar:R('.nb-avatar'),
          brand:R('.ws-id-home'),
          domain: domain ? (() => { const r = domain.getBoundingClientRect();
            return { x:r.left, y:r.top + window.pageYOffset, r:r.right,
                     b:r.bottom + window.pageYOffset, w:r.width, h:r.height,
                     clipped:domain.scrollWidth > domain.clientWidth + 1 }; })() : null,
          setupGap: Math.round(setup.getBoundingClientRect().bottom + window.pageYOffset - last),
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          pacuVisible: !!(document.querySelector('.pacu-mod') &&
                          document.querySelector('.pacu-mod').getClientRects().length),
          pacuPresent: !!document.querySelector('.pacu-mod'),
          /* Everything visibly rendered between the patient surface and the
             workstation host. PACU and the disclaimer both used to be here. */
          betweenSetupAndWork: (() => {
            const wrap = document.querySelector('.eng-wrap');
            const setup = document.getElementById('acc-patient');
            const grid = document.querySelector('.ws-grid');
            if (!setup || !grid) return [];
            const sB = setup.getBoundingClientRect().bottom + window.pageYOffset;
            const gT = grid.getBoundingClientRect().top + window.pageYOffset;
            return [...wrap.children].filter(e => {
              if (!e.getClientRects().length) return false;
              const r = e.getBoundingClientRect();
              const t2 = r.top + window.pageYOffset;
              return r.height > 0 && t2 >= sB && t2 < gT;
            }).map(e => e.id || (e.className || '').toString().slice(0, 20));
          })()
        };
      });
      const area = (a, b2) => { if (!a || !b2) return null;
        return Math.max(0, Math.min(a.r, b2.r) - Math.max(a.x, b2.x)) *
               Math.max(0, Math.min(a.b, b2.b) - Math.max(a.y, b2.y)); };
      const Q = w + ' rects: ';
      t(Q + 'Age and its unit do not overlap', area(g.age, g.unit) === 0, area(g.age, g.unit));
      t(Q + 'the unit and Weight do not overlap', area(g.unit, g.weight) === 0,
        area(g.unit, g.weight));
      t(Q + 'Age and Weight do not overlap', area(g.age, g.weight) === 0, area(g.age, g.weight));
      t(Q + 'Weight and Height do not overlap', area(g.weight, g.height) === 0);
      t(Q + 'Sex, Height and ASA do not overlap',
        area(g.sex, g.height) === 0 && area(g.height, g.asa) === 0);
      t(Q + 'the domain title does not overlap SOS', area(g.domain, g.sos) === 0,
        area(g.domain, g.sos));
      t(Q + 'the domain title is not clipped', g.domain && g.domain.clipped === false);
      t(Q + 'the brand does not overlap SOS', area(g.brand, g.sos) === 0);
      t(Q + 'SOS does not overlap the utility control', area(g.sos, g.find) === 0);
      t(Q + 'the utility control does not overlap the avatar', area(g.find, g.avatar) === 0);
      t(Q + 'SOS keeps a 44px target', g.sos && g.sos.h >= 44, g.sos && g.sos.h);
      t(Q + 'the utility control keeps a 44px target', g.find && g.find.h >= 44,
        g.find && g.find.h);
      t(Q + 'Procedure uses essentially the whole content width',
        g.proc && g.bar && g.proc.w >= g.bar.w - 2, [g.proc && g.proc.w, g.bar && g.bar.w]);
      /* WAS: Continue sized as a button rather than a card. The control is
         gone; what its absence must not cost is the reachability it provided,
         and the rect gates below already measure that the form ends cleanly
         and Procedure keeps the full row. */
      t(Q + 'no Continue control occupies the form', g.go === null, g.go);
      t(Q + 'Patient Setup reserves no empty space', g.setupGap <= 20, g.setupGap);
      t(Q + 'no horizontal document overflow', g.overflowX <= 0, g.overflowX);
      /* THE RULE IS ABOUT THE INDUCTION STREAM, NOT ABOUT ORDER. Asserting
         "PACU comes after the workstation" passes a screen where it sits
         between the patient form and the medicine as long as something else
         is below it. What must be true is that while induction is the active
         domain on a phone, recovery scoring is not in the stream at all —
         and that the module itself is still there, unchanged, for the
         contexts it belongs to. */
      t(Q + 'recovery scoring is not in the phone induction stream',
        g.pacuVisible === false, g.pacuVisible);
      t(Q + '...and the PACU module itself is intact, not deleted',
        g.pacuPresent === true);
      t(Q + '...and nothing sits between Patient Setup and the workstation',
        g.betweenSetupAndWork.length === 0, g.betweenSetupAndWork);
      await ctx.close();
    }

    /* ── ONE PAEDIATRIC INSERTION DEPTH, EVERYWHERE ───────────────────
       Two depths were published for the same tube: the airway plan used
       age/2+12 and the paediatric context used ETT x 3. They agree for
       weight-based patients — both are ETT x 3 there — and disagreed for
       every age-based one, by 3 cm at twelve years.

       The weight-based pathway keeps the depth it had. The age-based
       pathway is age/2+12, and that expression now exists once, in
       pedsAirwayValues(), which every surface reads. */
    {
      const ctx = await phone(b, 390, 844);
      await route(ctx);
      const pg = await ctx.newPage();
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);
      const CASES = [
        ['neonate 1w 3.0kg',  '1',  'w', '3',   10.5, true],
        ['infant 6mo 7.0kg',  '6',  'mo','7',   12,   true],
        ['13mo 4.8kg (wt<5)', '13', 'mo','4.8', 10.5, true],
        ['13mo 5.2kg',        '13', 'mo','5.2', 12.5, false],
        ['2 years 12kg',      '2',  'y', '12',  13,   false],
        ['4 years 16kg',      '4',  'y', '16',  14,   false],
        ['8 years 25kg',      '8',  'y', '25',  16,   false],
        ['12 years 40kg',     '12', 'y', '40',  18,   false]
      ];
      for (const [label, age, unit, wt, want, weightBased] of CASES) {
        const r = await pg.evaluate(a => {
          const set = (id, v) => { const e = document.getElementById(id);
            e.value = v; e.dispatchEvent(new Event('change', { bubbles:true })); };
          if (window.newCase) newCase();
          set('i-age-unit', a.unit); set('i-age', a.age); set('i-weight', a.wt);
          compute();
          const partial = (window.patientContext.pediatric || {}).ettDepth;
          const plan = window.airwayPlan ? window.airwayPlan.depth : null;
          set('i-sex', 'F'); set('i-height', '100'); compute();
          return { partial, planPartial:plan,
                   full:(window.patientContext.pediatric || {}).ettDepth,
                   planFull: window.airwayPlan ? window.airwayPlan.depth : null };
        }, { age, unit, wt });
        const tag = 'depth/' + label + ': ';
        t(tag + 'airway plan, context and case-ready all read ' + want,
          r.partial === want && r.full === want && r.planFull === want,
          r);
        if (weightBased)
          t(tag + '...and the weight-based rule is unchanged', r.full === want, r.full);
      }
      await ctx.close();
    }

    /* ── ONE COPY OF EACH FORMULA, PROVED FROM THE SOURCE ─────────────── */
    {
      const src = fs.readFileSync('/home/user/anestheo-website/engine.html', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ');
      const count = re => (src.match(re) || []).length;
      t('src: the 4-2-1 rule exists once', count(/40\s*\+\s*\(wt-10\)\*2/g) === 1,
        count(/40\s*\+\s*\(wt-10\)\*2/g));
      t('src: the paediatric EBV band exists once',
        count(/ageDays\s*<\s*28\s*\?\s*90/g) === 1, count(/ageDays\s*<\s*28\s*\?\s*90/g));
      t('src: the age-based ETT size exists once in the context path',
        count(/ageYears\/4\s*\+\s*4/g) === 1, count(/ageYears\/4\s*\+\s*4/g));
      /* ── DEPTH IS DECIDED IN ONE PLACE ──────────────────────────────
         Not "two copies that currently agree" — one expression, read by
         every surface. The age-based rule and the weight-based rule both
         live in pedsAirwayValues(); nothing else computes a paediatric
         depth, and the consumers reference the helper's result. */
      t('src: the age-based depth rule exists once',
        count(/ageYears\/2 \+ 12/g) === 1, count(/ageYears\/2 \+ 12/g));
      t('src: no surface recomputes age/2+12 for itself',
        count(/\(age\/2\)\+12/g) === 0, count(/\(age\/2\)\+12/g));
      t('src: no surface recomputes the weight-based depth for itself',
        count(/neoETT\(wt\)\*3/g) === 0, count(/neoETT\(wt\)\*3/g));
      t('src: the helper result is what the surfaces read',
        count(/_pw\.ettDepth/g) >= 5, count(/_pw\.ettDepth/g));
      t('src: the dead depthW variable is gone', count(/depthW/g) === 0);
      t('src: readiness is decided in one place',
        count(/function caseReadyFrom/g) === 1 &&
        count(/caseReadyFrom\(/g) >= 4, count(/caseReadyFrom\(/g));
      t('src: no readiness test on input-string presence',
        !/v\('i-age'\)\s*&&\s*v\('i-weight'\)/.test(src));
      /* WAS: asserted the airway plan still computed (age/2)+12 for itself,
         which recorded the unresolved conflict — two depths for one tube.
         That conflict has now been resolved deliberately: the age-based rule
         IS age/2+12, it lives in the shared helper, and the airway plan reads
         it from there rather than recomputing it. The safety meaning is
         stronger, not weaker: before, the rule merely had to exist somewhere;
         now no surface may hold a depth rule of its own at all. */
      t('src: the airway plan reads the shared depth rather than its own',
        /depth:_pw\.ettDepth/.test(src) && !/\(age\/2\)\+12/.test(src));
    }

    /* ── CREATE PATIENT RECORD · authorized, both keyboard states ─────── */
    for (const mode of ['no input focused', 'weight focused']) {
      const ctx = await phone(b, 390, 844);
      await route(ctx);
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);
      const shown = await pg.evaluate(() => {
        window.LT_ACCESS.resolved = true; window.LT_ACCESS.allowed = true;
        window.LT_ACCESS.uid = '11111111-2222-3333-4444-555555555555';
        if (window.ltPaintAccess) ltPaintAccess();
        const b = document.querySelector('.case-np');
        return { visible: !!(b && b.getClientRects().length > 0),
                 label: b ? b.textContent.trim() : null,
                 h: b ? Math.round(b.getBoundingClientRect().height) : null };
      });
      t('np/' + mode + ': the action is offered to an authorized session',
        shown.visible === true);
      t('np/' + mode + ': it is named for what it creates',
        shown.label === 'Create patient record', shown.label);
      t('np/' + mode + ': touch target is at least 44px', shown.h >= 44, shown.h);
      if (mode === 'weight focused') { await type(pg, '#i-weight', '75'); }
      await pg.evaluate(() => document.querySelector('.case-np').click());
      await pg.waitForTimeout(800);
      const opened = await pg.evaluate(() => {
        const bg = document.querySelector('.np-bg');
        const r = bg ? bg.getBoundingClientRect() : null;
        return { modal: !!document.getElementById('np-modal'),
                 open: bg ? bg.classList.contains('open') : false,
                 rect: r ? Math.round(r.width) * Math.round(r.height) : 0,
                 notice: !!document.querySelector('.lt-notice, .np-err') };
      });
      t('np/' + mode + ': #np-modal exists', opened.modal === true);
      t('np/' + mode + ': .np-bg is open', opened.open === true);
      t('np/' + mode + ': the dialog has a visible rect', opened.rect > 0, opened.rect);
      t('np/' + mode + ': one press, no silent no-op', opened.modal && opened.open);
      t('np/' + mode + ': no runtime error', errs.length === 0, errs.slice(0, 2));
      await ctx.close();
    }

    /* ── THE COMPONENT CANNOT FAIL SILENTLY ──────────────────────────── */
    {
      const ctx = await phone(b, 390, 844);
      await route(ctx);
      const pg = await ctx.newPage();
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);
      const r = await pg.evaluate(() => {
        window.LT_ACCESS.resolved = true; window.LT_ACCESS.allowed = true;
        window.LT_ACCESS.uid = '11111111-2222-3333-4444-555555555555';
        if (window.ltPaintAccess) ltPaintAccess();
        window.NewPatient = null;                    /* the asset did not load */
        const before = document.body.textContent;
        document.querySelector('.case-np').click();
        return { changed: document.body.textContent !== before,
                 says: /could not be opened/i.test(document.body.textContent) };
      });
      t('np/asset missing: the clinician is told, not ignored', r.says === true, r);
    }

    /* ── STRATEGY · context changes, intent does not ──────────────────── */
    {
      const ctx = await phone(b, 390, 844);
      await route(ctx);
      const pg = await ctx.newPage();
      const errs = [];
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
      await pg.waitForTimeout(2000);
      await type(pg, '#i-age', '42');
      await type(pg, '#i-weight', '75');
      await reopenEditor(pg);
      await pg.selectOption('#i-sex', 'M');
      await reopenEditor(pg);
      await type(pg, '#i-height', '175');
      /* the clinician's own selection, made once, before any strategy press */
      await pg.evaluate(() => {
        const c = document.querySelector('#induction-host .tb-c[data-drug="drug.propofol"]');
        if (c) c.click();
      });
      await pg.waitForTimeout(500);
      const chosen = await snap(pg);
      t('strategy: the clinician selected propofol',
        /drug\.propofol/.test(chosen.planKeys), chosen.planKeys);

      const seen = {};
      for (const id of ['iv', 'rsi', 'inhalational', 'tiva']) {
        await pg.evaluate(t => {
          if (window.Induction.technique) Induction.setTechnique(Induction.technique);
          Induction.setTechnique(t);
        }, id);
        await pg.waitForTimeout(400);
        seen[id] = await snap(pg);
        t('strategy/' + id + ': planKeys UNCHANGED by the strategy press',
          seen[id].planKeys === chosen.planKeys, seen[id].planKeys);
        t('strategy/' + id + ': a context surface states the active strategy',
          !!seen[id].stx, (seen[id].stx || '').slice(0, 50));
        t('strategy/' + id + ': the board is still four rows of four, 2-up on a phone',
          (seen[id].boardRows || []).join(' ') === '4/2 4/2 4/2 4/2',
          seen[id].boardRows);
      }
      t('strategy: every strategy produces a DIFFERENT workstation state',
        new Set(['iv','rsi','inhalational','tiva'].map(k => seen[k].stx)).size === 4,
        ['iv','rsi','inhalational','tiva'].map(k => (seen[k].stx || '').slice(0, 22)));

      /* RSI is the one that also changes what the board asks. */
      t('RSI: the blocker row states its context', seen.rsi.rsiChip === true);
      t('RSI: rocuronium moves to the rapid sequence record',
        /Rapid sequence/i.test(seen.rsi.rocuronium.use) &&
        seen.rsi.rocuronium.rule !== seen.iv.rocuronium.rule,
        [seen.iv.rocuronium, seen.rsi.rocuronium]);
      t('RSI: ...and its amount changes with it',
        seen.rsi.rocuronium.amt !== seen.iv.rocuronium.amt,
        [seen.iv.rocuronium.amt, seen.rsi.rocuronium.amt]);
      /* WAS: suxamethonium has no reviewed RSI dose and says so, and does not
         fall back to its routine intubating dose — an empty rule and an empty
         amount. One was written in this pass, so the coverage state is gone
         and the drug answers. The claim underneath it is untouched and is
         what these two now assert: the RSI cell must hold the RSI RECORD, not
         the routine record wearing an RSI label. Suxamethonium's routine
         entry is a 0.3–1.1 mg/kg range and its RSI entry is a single 1 mg/kg
         value, so a fallback would be visible in both the rule and the
         patient amount — and neither may match. */
      t('RSI: suxamethonium moves to its own rapid sequence record',
        /Rapid sequence/i.test(seen.rsi.suxamethonium.use) &&
        seen.rsi.suxamethonium.cov === '' &&
        seen.rsi.suxamethonium.rule !== '' && seen.rsi.suxamethonium.amt !== '',
        seen.rsi.suxamethonium);
      t('RSI: ...and does NOT fall back to its routine intubating dose',
        /Intubation/i.test(seen.iv.suxamethonium.use) &&
        !/Rapid sequence/i.test(seen.iv.suxamethonium.use) &&
        seen.rsi.suxamethonium.rule !== seen.iv.suxamethonium.rule &&
        seen.rsi.suxamethonium.amt !== seen.iv.suxamethonium.amt,
        [seen.iv.suxamethonium, seen.rsi.suxamethonium]);
      t('RSI: the routine context is what it was before',
        /Intubation/i.test(seen.iv.rocuronium.use), seen.iv.rocuronium.use);

      /* Nothing may invent a volatile or a target-controlled number. */
      const NUMERIC = /\b\d+(\.\d+)?\s*(%|mac|vol%|mcg\/ml|ng\/ml|µg\/ml)\b/i;
      t('inhalational: no concentration, MAC or inspired percentage',
        !NUMERIC.test(seen.inhalational.stx || ''), seen.inhalational.stx);
      t('inhalational: it says the volatile dosing is not reviewed',
        /not reviewed/i.test(seen.inhalational.stx || ''), seen.inhalational.stx);
      t('TIVA: no target concentration or model invented',
        !NUMERIC.test(seen.tiva.stx || '') &&
        !/marsh|schnider|minto|eleveld/i.test(seen.tiva.stx || ''), seen.tiva.stx);
      t('strategy: no runtime error across all four', errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
