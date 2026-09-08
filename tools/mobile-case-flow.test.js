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
     the 75 kg fix                 nothing folds the editor except Continue
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
    npVisible: vis(document.querySelector('.case-np')),
    npInEditor: !!document.querySelector('#acc-patient .case-np'),
    noPatientPanels: [...document.querySelectorAll('.empty-state, .case-state')]
      .filter(vis).filter(e => /no active patient|not entered/i.test(e.textContent)).length,
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
      t(P + 'fresh: New case is not offered with no case', fresh.newCaseVisible === false);
      t(P + 'fresh: no induction workstation yet', fresh.hostExists === false);
      t(P + 'fresh: one patient-start surface, not two',
        fresh.noPatientPanels <= 1, fresh.noPatientPanels);
      t(P + 'fresh: Create patient record lives in Patient Setup', fresh.npInEditor === true);
      t(P + 'fresh: ...and is hidden for an unauthorized session', fresh.npVisible === false);
      t(P + 'fresh: Continue is present but disabled',
        fresh.goVisible === true && fresh.goDisabled === true);
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
      t(P + 'A: Continue is enabled', min.goDisabled === false);
      t(P + 'A: New case appears once a case exists', min.newCaseVisible === true);
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
      t(P + 'A: no horizontal overflow', min.overflowX <= 0, min.overflowX);

      /* ── FLOW B · Continue ───────────────────────────────────────────── */
      await pg.click('#pt-go-b');
      await pg.waitForTimeout(900);
      const after = await snap(pg);
      t(P + 'B: the editor folded — because it was asked to', after.ptOpen === false);
      t(P + 'B: age survives Continue', after.age === '42', after.age);
      t(P + 'B: weight survives Continue and is still 75', after.weight === '75', after.weight);
      t(P + 'B: the case is still live — Continue is not New Case',
        after.caseLive === true && after.caseReady === true);
      t(P + 'B: focus left the input', after.active !== 'i-weight', after.active);
      t(P + 'B: Induction Strategy is visible', after.stratVisible === true);
      t(P + 'B: Induction Strategy within 650px of the document top',
        after.stratY !== null && after.stratY <= 650, after.stratY);
      t(P + 'B: the page did not jump to the document top', after.scrollY > 0, after.scrollY);
      t(P + 'B: no horizontal overflow', after.overflowX <= 0, after.overflowX);

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
      t(P + 'C: Continue still works', full.goDisabled === false);

      /* ── FLOW D · New case ───────────────────────────────────────────── */
      t(P + 'D: New case is visible while a case exists', full.newCaseVisible === true);
      await pg.evaluate(() => { if (window.newCase) newCase(); });
      await pg.waitForTimeout(700);
      const cleared = await snap(pg);
      t(P + 'D: New case clears the patient values',
        cleared.age === '' && cleared.weight === '' && cleared.height === '',
        [cleared.age, cleared.weight, cleared.height]);
      t(P + 'D: ...and the induction selections', cleared.planKeys === '[]', cleared.planKeys);
      t(P + 'D: ...and the case is no longer live', cleared.caseLive === false);
      t(P + 'D: ...and New case hides itself again', cleared.newCaseVisible === false);
      t(P + 'D: ...and Patient Setup is the surface again', cleared.goDisabled === true);

      t(P + 'no page or runtime errors in the whole flow', errs.length === 0, errs.slice(0, 3));
      await ctx.close();
    }

    /* ── THE TWO PATHS MUST AGREE ABOUT A CHILD ──────────────────────────
       The case-ready branch computes the paediatric working values itself
       rather than sharing the full path's code, so the same child could in
       principle be given one EBV before a height is entered and a different
       one after. These are the age- and weight-derived values only; they do
       not depend on sex or height and must therefore be IDENTICAL either
       side of the anthropometric gate. This is what stands in for factoring
       the duplication out, and it fails the moment the two copies drift. */
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
        await pg.selectOption('#i-sex', 'F');
        await type(pg, '#i-height', '103');
        const full = peds(await pg.evaluate(() => window.patientContext.derived));
        t('peds/' + label + ': age+weight values identical either side of the gate',
          JSON.stringify(partial) === JSON.stringify(full), [partial, full]);
        await pg.selectOption('#i-age-unit', 'y');
      }
      await ctx.close();
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
      await pg.selectOption('#i-sex', 'M');
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
      t('RSI: suxamethonium has no reviewed RSI dose and says so',
        /not reviewed/i.test(seen.rsi.suxamethonium.cov), seen.rsi.suxamethonium);
      t('RSI: ...and does NOT fall back to its routine intubating dose',
        seen.rsi.suxamethonium.amt === '' && seen.rsi.suxamethonium.rule === '',
        seen.rsi.suxamethonium);
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
