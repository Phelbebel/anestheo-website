#!/usr/bin/env node
/* live-tools-shell.test.js — PHASE 2: THE WORKSTATION SHELL
 *
 * Identity, clinical-domain navigation and the patient command bar.
 *
 * The shell is CHROME. It changes where things sit, how dense they are and
 * how loud they read. It computes nothing, stores nothing, and claims nothing
 * the application does not already know. Every assertion below exists to hold
 * one of those three lines, because chrome is exactly where a clinical claim
 * can be smuggled onto a screen without anyone reviewing it as clinical.
 *
 * The two that matter most:
 *
 *   NO INVENTED STATUS. The design reference carries "connected", "monitoring
 *   active", "system healthy". This application holds no device link, no
 *   telemetry and no session health. A status light that cannot fail is
 *   decoration wearing a safety word, and on a clinical screen that is a lie
 *   with a colour.
 *
 *   NO SECOND CALCULATION STORE. Every number in the command bar is read from
 *   the patientContext that compute() already built. The shell may present
 *   them; it may not derive them.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 170);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(62) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(62) + ' ' + fmt(d)); }
};
const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
const ENG = read('engine.html'), ENGC = code(ENG);
const CSS = read('live-tools.css'), CSSC = code(CSS);

const ADULT = { 'i-age':'42','i-sex':'M','i-height':'175','i-weight':'75','i-asa':'II',
                'i-proc':'Laparoscopic cholecystectomy' };
const PEDS  = { 'i-age':'4','i-sex':'F','i-height':'103','i-weight':'16','i-asa':'I',
                'i-proc':'Tonsillectomy' };

async function open(b, w, h, id) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, isMobile:w<900, hasTouch:w<900 });
  if (id) await ctx.addInitScript(({role,profile}) => {
    window.__TEST_ROLE = role; if (profile) window.__TEST_PROFILE = profile; }, id);
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr|unpkg/.test(u)) return r.fulfill({status:200,contentType:'text/javascript',body:MOCK});
    if (/googleapis|gstatic/.test(u))  return r.fulfill({status:200,contentType:'text/css',body:''});
    if (/youtube|ytimg|supabase\.co/.test(u)) return r.fulfill({status:200,contentType:'application/json',body:'[]'});
    return r.continue();
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message)));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' });
  await pg.waitForTimeout(1800);
  return { ctx, pg, errs };
}
const fill = (pg, o) => pg.evaluate(o => {
  if (window.newCase) newCase();
  const s = (i,v) => { const e = document.getElementById(i);
    if (e) { e.value = v; e.dispatchEvent(new Event('change',{bubbles:true})); } };
  Object.keys(o).forEach(k => s(k, o[k]));
  compute(); if (window.ptSummary) ptSummary();
}, o);

(async () => {
  console.log('\n=== LIVE TOOLS · WORKSTATION SHELL ==========================\n');

  /* ── 1. THE SHELL INVENTS NOTHING ─────────────────────────────────────
     Asserted against the SOURCE, because a fabricated status indicator is
     a string literal long before it is a pixel. */
  console.log('1. NO INVENTED STATUS, NO SECOND STORE');
  const shellText = /<header class="ws-id"[\s\S]*?<\/header>/.exec(ENG);
  t('the workstation identity block exists', !!shellText);
  const idBlock = shellText ? shellText[0] : '';
  t('...and claims no connectivity, monitoring or health state',
    !/connected|online|offline|monitoring|synced|sync\b|live data|system (ok|healthy)|all systems|status/i
      .test(code(idBlock)), code(idBlock).replace(/\s+/g,' ').slice(0,150));
  t('...and names the tool, nothing more',
    /Anestheo/.test(idBlock) && /Live Tools/i.test(idBlock));
  /* A green dot is the specific lie this guards against. */
  t('no status dot is styled into the identity row',
    !/\.ws-id[^{]*\b(dot|pulse|status|beacon|led)\b/i.test(CSSC));

  /* The shell must not compute. Any of these appearing in the identity or
     command-bar chrome would be a second source of a clinical number. */
  t('the shell declares no formula of its own',
    !/ws-id[\s\S]{0,400}?(Math\.(round|pow|sqrt)|\*\s*weight|weight\s*\*)/i.test(ENGC));

  /* ── 2. NAVIGATION IS HONEST ─────────────────────────────────────────
     Every entry resolves to a workspace that renders panels. Nothing is
     listed to match a picture. */
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    /* 1536, NOT 1440. The airway sits beside the drug board only while the
       board can still hold four cards at the approved 112px width, which the
       shell's own arithmetic puts at 1536 — below it the airway stacks under
       the plan by design. A suite asserting the DESKTOP composition has to
       ask at a desktop width; the responsive matrix further down still
       exercises 1440 and everything under it. */
    const s = await open(b, 1536, 1250);
    await fill(s.pg, ADULT);
    await s.pg.waitForTimeout(600);

    console.log('\n2. CLINICAL DOMAIN NAVIGATION');
    const nav = await s.pg.evaluate(`(() => {
      const tabs = [...document.querySelectorAll('#cmd-strip .cmd-b[data-domain]')];
      return { labels:tabs.map(a => a.textContent.trim()),
               domains:tabs.map(a => a.getAttribute('data-domain')),
               resolvable:tabs.map(a => {
                 const d = a.getAttribute('data-domain');
                 return { d, panels:document.querySelectorAll('.panel[data-domain="'+d+'"]').length };
               }),
               first:tabs[0] ? tabs[0].getAttribute('data-domain') : null,
               hasSearchInStrip:!!document.querySelector('#cmd-strip .cmd-find'),
               hasSosInStrip:!!document.querySelector('#cmd-strip .cmd-sos'),
               searchInHeader:!!document.querySelector('#ws-id .ws-id-find'),
               sosInHeader:!!document.querySelector('#ws-id .ws-id-sos') };
    })()`);
    t('every navigation entry resolves to a workspace with panels',
      nav.resolvable.every(r => r.panels > 0), nav.resolvable.filter(r => !r.panels));
    t('...and no entry exists that has no destination',
      nav.domains.length === nav.resolvable.filter(r => r.panels > 0).length, nav.domains);
    t('Induction is first and is the default workspace', nav.first === 'induction', nav.first);
    /* The strip is domains and only domains now. */
    t('search and emergency moved out of the domain strip',
      !nav.hasSearchInStrip && !nav.hasSosInStrip);
    t('...into the workstation header', nav.searchInHeader && nav.sosInHeader);

    /* SELECTING A DOMAIN CHANGES WHAT IS ON SCREEN AND NOTHING ELSE. */
    const sw = await s.pg.evaluate(`(() => {
      const doseSnapshot = () => {
        const CC = window.ClinicalContent, wt = window.patientContext.anthropometrics.weight, m = {};
        CC.GROUPS.forEach(g => CC.visibleDrugsInGroup(g.id, wt)
          .forEach(d => { m[d.id] = [d.val, d.unit, d.doseRule, d.warn].join('|'); }));
        return JSON.stringify(m);
      };
      const before = doseSnapshot();
      const derivedBefore = JSON.stringify(window.patientContext.derived);
      const out = { moved:[] };
      ['maintenance','analgesia','fluids','vasopressors','reversal','tiva','induction']
        .forEach(d => {
          const a = document.querySelector('#cmd-strip .cmd-b[data-domain="'+d+'"]');
          a.click();
          const cur = document.getElementById('output').dataset.domain;
          if (cur !== d) out.moved.push(d + '->' + cur);
        });
      out.doseDrift = doseSnapshot() !== before;
      out.derivedDrift = JSON.stringify(window.patientContext.derived) !== derivedBefore;
      out.finalDomain = document.getElementById('output').dataset.domain;
      return out;
    })()`);
    t('every tab selects the domain it names', sw.moved.length === 0, sw.moved);
    t('...and selecting a domain changes no dose', sw.doseDrift === false);
    t('...and no derived patient value', sw.derivedDrift === false);

    /* COLOUR IS NOT THE ONLY SELECTED-STATE CUE. */
    const state = await s.pg.evaluate(`(() => {
      const on = document.querySelector('#cmd-strip .cmd-b.on');
      const off = [...document.querySelectorAll('#cmd-strip .cmd-b[data-domain]')]
        .find(a => !a.classList.contains('on'));
      const cs = getComputedStyle(on), co = getComputedStyle(off);
      return { current:on.getAttribute('aria-current'),
               weightDiffers:cs.fontWeight !== co.fontWeight,
               indicator:cs.boxShadow !== 'none' && cs.boxShadow !== co.boxShadow,
               colourDiffers:cs.color !== co.color,
               onWeight:cs.fontWeight, offWeight:co.fontWeight };
    })()`);
    t('the active domain is announced to a screen reader',
      state.current === 'true', state.current);
    t('...marked by an indicator, not only by colour', state.indicator === true);
    t('...and by weight, so it survives a monochrome screen',
      state.weightDiffers === true, { on:state.onWeight, off:state.offWeight });

    /* Keyboard. Both element types in the strip must be reachable and fire. */
    const kb = await s.pg.evaluate(`(() => {
      const a = document.querySelector('#cmd-strip .cmd-b[data-domain="fluids"]');
      a.focus();
      const focused = document.activeElement === a;
      const before = document.getElementById('output').dataset.domain;
      a.dispatchEvent(new MouseEvent('click', { bubbles:true }));   /* Enter on an <a> */
      const after = document.getElementById('output').dataset.domain;
      const find = document.querySelector('#ws-id .ws-id-find');
      find.focus();
      const findFocusable = document.activeElement === find;
      document.querySelector('#cmd-strip .cmd-b[data-domain="induction"]').click();
      return { focused, changed: before !== after && after === 'fluids', findFocusable };
    })()`);
    t('a domain tab takes keyboard focus and activates', kb.focused && kb.changed, kb);
    t('...and so does the header search control', kb.findFocusable === true);
    t('focus-visible styling exists for the shell controls',
      /#cmd-strip .cmd-b:focus-visible/.test(CSSC) && /\.ws-id-b:focus-visible/.test(CSSC));

    /* ── 3. THE PATIENT COMMAND BAR ────────────────────────────────────
       Every number read back out of the DOM must equal the value
       patientContext already holds. */
    console.log('\n3. PATIENT COMMAND BAR — CANONICAL VALUES ONLY');
    const bar = await s.pg.evaluate(`(() => {
      const cells = {};
      [...document.querySelectorAll('#cw-derived .cw-d')].forEach(d => {
        cells[d.querySelector('.cw-d-l').textContent.trim().replace(/\\\\s+/g,' ')] =
          d.querySelector('.cw-d-val').textContent.trim();
      });
      const c = window.patientContext;
      return { cells, ctxDerived:c.derived, ctxScalars:c.dosingScalars,
               caseLine:document.querySelector('.case-state').textContent.replace(/\\\\s+/g,' ').trim() };
    })()`);
    const S = bar.ctxScalars, D = bar.ctxDerived;
    t('TBW is shown, and it is dosingScalars.tbw',
      bar.cells['TBW'] === String(S.tbw), { shown:bar.cells['TBW'], ctx:S.tbw });
    t('IBW / LBW / Adjusted BW come from dosingScalars',
      bar.cells['IBW'] === String(S.ibw) && bar.cells['LBW'] === String(S.lbw) &&
      bar.cells['Adjusted BW'] === String(S.abw),
      { ibw:[bar.cells['IBW'],S.ibw], lbw:[bar.cells['LBW'],S.lbw], abw:[bar.cells['Adjusted BW'],S.abw] });
    t('BSA comes from dosingScalars, BMI and EBV from derived',
      bar.cells['BSA'] === String(S.bsa) && bar.cells['BMI'] === String(D.bmi) &&
      bar.cells['EBV'] === String(D.ebv),
      { bsa:[bar.cells['BSA'],S.bsa], bmi:[bar.cells['BMI'],D.bmi], ebv:[bar.cells['EBV'],D.ebv] });
    t('the case line carries age, sex, weight, height, ASA and procedure',
      /* The bar prints labelled facts now — "42 years / Age" rather than the
         run-on "42y · Male · 75 kg" headline it replaced. Same six facts. */
      /42 years/.test(bar.caseLine) && /Male/.test(bar.caseLine) && /75 kg/.test(bar.caseLine) &&
      /175 cm/.test(bar.caseLine) && /ASA II/.test(bar.caseLine) &&
      /Laparoscopic cholecystectomy/.test(bar.caseLine), bar.caseLine);

    /* A NEW CASE SHOWS NO STALE NUMBER. This is the failure mode that matters:
       a dose belonging to the previous patient still on screen. */
    const stale = await s.pg.evaluate(`(() => {
      newCase();
      const vals = [...document.querySelectorAll('#cw-derived .cw-d-val')].map(e => e.textContent.trim());
      return { vals, allBlank:vals.every(v => v === '\\u2014'),
               caseLine:document.querySelector('.case-state').textContent.replace(/\\\\s+/g,' ').trim(),
               ctx:window.patientContext ? window.patientContext.complete : null,
               placeholders:vals.length };
    })()`);
    t('New Case leaves no stale derived value on screen',
      stale.allBlank === true, stale.vals);
    t('...keeps the shape of the bar rather than collapsing it',
      stale.placeholders >= 7, stale.placeholders);
    t('...and the case line says there is no patient',
      /No active patient/i.test(stale.caseLine), stale.caseLine);

    /* And the paediatric set stays the paediatric set. Devine IBW/LBW/ABW are
       deliberately absent for a child — showing them is what once made a
       10 kg one-year-old read IBW 50 kg. */
    await fill(s.pg, PEDS); await s.pg.waitForTimeout(500);
    const ped = await s.pg.evaluate(`(() => {
      const labels = [...document.querySelectorAll('#cw-derived .cw-d-l')]
        .map(e => e.textContent.trim().replace(/\\\\s+/g,' '));
      const cells = {};
      [...document.querySelectorAll('#cw-derived .cw-d')].forEach(d => {
        cells[d.querySelector('.cw-d-l').textContent.trim()] = d.querySelector('.cw-d-val').textContent.trim(); });
      const c = window.patientContext;
      return { labels, cells, tbw:c.dosingScalars.tbw, lma:c.pediatric.lma, igel:c.pediatric.igel };
    })()`);
    t('a child gets the paediatric scalar set',
      ped.labels.indexOf('IBW') < 0 && ped.labels.indexOf('LBW') < 0 &&
      ped.labels.indexOf('Adjusted BW') < 0, ped.labels);
    t('...with TBW, which is the weight and is defined for a child',
      ped.cells['TBW'] === String(ped.tbw), { shown:ped.cells['TBW'], ctx:ped.tbw });
    t('...and LMA and i-gel still shown independently',
      ped.cells['LMA'] === ped.lma && ped.cells['i-gel'] === ped.igel,
      { lma:[ped.cells['LMA'],ped.lma], igel:[ped.cells['i-gel'],ped.igel] });

    /* ── 3b. THE CRISIS RAIL IS PART OF THE WORKSTATION ────────────────
       Pressing a protocol must not navigate, must not cover the central plan,
       and must not replace the page. On a desktop the protocol expands INSIDE
       the rail: index above, protocol below, induction plan beside. It was a
       fixed panel floating over its own index, which never covered the plan
       but read as a window rather than as part of the layout. */
    console.log('\nCRISIS RAIL — DESKTOP');
    const rail = await s.pg.evaluate(`(() => {
      /* build a plan first, so "the plan stays visible" means something */
      /* SELECTION IS IN PLACE NOW. There is no chooser to open: every drug
         is already on the board, so this presses USE on its own row. */
      const add = id => {
        const b = document.querySelector('#induction-host [data-plan-for="'+id+'"]');
        if (b) b.click();
      };
      add('drug.propofol'); add('drug.rocuronium');
      /* SELECTION IS IN PLACE, so "the plan" is the set of rows marked
         USING rather than a separate container of cards. */
      const planBefore = [...document.querySelectorAll('#induction-host .tb-c.on .tb-c-n')]
        .map(e => e.textContent);
      const y0 = window.pageYOffset;
      const dom0 = document.getElementById('output').dataset.domain;
      document.querySelectorAll('#ws-crisis .wsc-b')[0].click();      /* LAST */
      const h = document.getElementById('crisis-preview');
      const hr = h.getBoundingClientRect();
      const out = document.getElementById('output').getBoundingClientRect();
      const grid = getComputedStyle(document.querySelector('.ws-grid')).gridTemplateColumns;
      const o = {
        position:getComputedStyle(h).position,
        insideRail:h.parentElement.classList.contains('ws-right'),
        coversPlan:hr.left < out.right - 4,
        planVisible:[...document.querySelectorAll('#induction-host .tb-c.on .tb-c-n')].map(e => e.textContent),
        steps:h.querySelectorAll('.crisis-step').length,
        doses:h.querySelectorAll('.crisis-dose').length,
        indexStillThere:document.querySelectorAll('#ws-crisis .wsc-b').length,
        moved:window.pageYOffset - y0,
        domainSame:document.getElementById('output').dataset.domain === dom0,
        gridOpen:grid,
        full:!!h.querySelector('.cpv-full'),
        planBefore
      };
      /* switching keeps the plan and shows one protocol */
      document.querySelectorAll('#ws-crisis .wsc-b')[7].click();      /* Anaphylaxis */
      o.switchedTitle = (h.querySelector('.crisis-emg-t')||{}).textContent || '';
      o.copies = document.querySelectorAll('.crisis-preview').length;
      o.planAfterSwitch = [...document.querySelectorAll('#induction-host .tb-c.on .tb-c-n')]
        .map(e => e.textContent);
      crisisPreviewClose();
      o.gridClosed = getComputedStyle(document.querySelector('.ws-grid')).gridTemplateColumns;
      o.planAfterClose = [...document.querySelectorAll('#induction-host .tb-c.on .tb-c-n')]
        .map(e => e.textContent);
      return o;
    })()`);
    t('the protocol renders inside the rail, in the layout',
      rail.insideRail === true && rail.position === 'static', rail.position);
    t('...without navigating or moving the page',
      rail.moved === 0 && rail.domainSame === true, { moved:rail.moved });
    t('...without covering the induction plan', rail.coversPlan === false);
    t('...and the plan is still on screen beside it',
      rail.planVisible.join() === rail.planBefore.join() && rail.planVisible.length === 2,
      rail.planVisible);
    t('...carrying its steps and its weight-aware doses',
      rail.steps > 0 && rail.doses > 0, { steps:rail.steps, doses:rail.doses });
    t('...with the index still reachable', rail.indexStillThere === 8);
    /* WAS: "the rail widens for a protocol and narrows again". It did — from
       324 to 380 — and those 56px came out of the centre, which re-flowed the
       four drug rows under the reader's hand and ellipsised "2.5–3.5 mg/kg
       TBW" at the moment an emergency was opened. A protocol grows DOWN the
       rail, which has the whole height of the column; the plan beside it does
       not change width because someone opened Cardiac Arrest. */
    const px = g => parseFloat((g.trim().split(/\s+/).pop() || '0'));
    t('opening a protocol does not take width from the induction plan',
      px(rail.gridOpen) === px(rail.gridClosed) && px(rail.gridClosed) >= 320,
      { open:rail.gridOpen, closed:rail.gridClosed });
    t('switching protocols replaces the one shown, one at a time',
      /Anaphylaxis/.test(rail.switchedTitle) && rail.copies === 1, rail.switchedTitle);
    t('...and never touches the plan',
      rail.planAfterSwitch.join() === rail.planBefore.join() &&
      rail.planAfterClose.join() === rail.planBefore.join(),
      { afterSwitch:rail.planAfterSwitch, afterClose:rail.planAfterClose });
    t('"View full protocol" is still the one control that leaves',
      rail.full === true);

    /* ── 3c. DENSITY ────────────────────────────────────────────────────
       A workstation is judged by what it fits on one screen. These are the
       three ways this page wasted it: reserved grid cells for agents nobody
       selected, containers taller than their own contents, and anonymous
       30–60px gaps between modules. All three are measured, not eyeballed. */
    console.log('\nDENSITY');
    const dens = await s.pg.evaluate(`(() => {
      /* SELECTION IS IN PLACE NOW. There is no chooser to open: every drug
         is already on the board, so this presses USE on its own row. */
      const add = id => {
        const b = document.querySelector('#induction-host [data-plan-for="'+id+'"]');
        if (b) b.click();
      };
      /* Measure the RESTING state of a LIVE case. An earlier block ends with
         newCase(), and without a live case the command bar's two rows are
         correctly separate — they only join once there is a patient. Neither
         that nor an open patient form is the waste this checks. */
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II'); set('i-proc','Laparoscopic cholecystectomy');
      compute(); if (window.ptSummary) ptSummary();
      document.getElementById('app').classList.remove('pt-open');
      if (window.Induction) window.Induction.clearPlan();
      add('drug.propofol'); add('drug.fentanyl'); add('drug.rocuronium');
      /* MEASURE FROM THE TOP OF THE PAGE. The command strip lives inside the
         sticky workstation header now, so on a scrolled page it reports its
         PINNED position while the case bar below it has scrolled away — and
         the distance between them comes out negative for a layout in which
         nothing overlaps. */
      window.scrollTo(0, 0);
      const bb = e => e.getBoundingClientRect();

      /* GAPS BETWEEN THE MAJOR STACKED BLOCKS. Below the column pair the
         centre is a stack of full-width blocks — the backup airway strip,
         then the reference — so each is measured against the one before it.
         The column pair is measured by its TALLER column, because the
         distance from the shorter one is not a gap in the stack: it is the
         airway column standing beside it. That space is reported separately
         below. */
      const colsBottom = Math.max(bb(document.querySelector('.wf-col-main')).bottom,
                                  bb(document.querySelector('.wf-col-side')).bottom);
      const blocks = [document.querySelector('#cmd-strip'), document.querySelector('.eng-notice'),
        document.querySelector('.case-bar'), document.getElementById('cw-derived'),
        document.querySelector('.wf-lead'), document.querySelector('.wf-cols')]
        /* A BLOCK THAT IS NOT RENDERED IS NOT A GAP. The engine notice and
           the derived-values drawer are display:none in the workstation, and
           a display:none element measures 0×0 at the origin, which turned the
           distance to the block after it into a large negative number. Only
           blocks that occupy the page take part in the spacing check. */
        .filter(e => e && e.getBoundingClientRect().height > 0);
      const gaps = [];
      for (let i = 1; i < blocks.length; i++)
        gaps.push(Math.round(bb(blocks[i]).top - bb(blocks[i-1]).bottom));
      const centre = [document.querySelector('.wf-bkp'),
                      document.querySelector('.wf-full')].filter(Boolean);
      let prevBottom = colsBottom;
      centre.forEach(el => { gaps.push(Math.round(bb(el).top - prevBottom));
                             prevBottom = bb(el).bottom; });

      /* container height minus the height its children actually use */
      const slack = [];
      document.querySelectorAll('#induction-host .wf-sec, .wf-col-main, .wf-col-side, .pl-grid')
        .forEach(e => {
          const kids = [...e.children].filter(k => bb(k).height > 0);
          if (!kids.length) return;
          const top = Math.min(...kids.map(k => bb(k).top));
          const bot = Math.max(...kids.map(k => bb(k).bottom));
          const box = bb(e);
          const unused = Math.round((box.bottom - bot) + (top - box.top));
          if (unused > 26) slack.push((e.className||'').split(' ')[0] + ':' + unused);
        });

      /* THE BOARD, NOT A CARD GRID. Selection lights a row in place, so the
         row count is the same before and after choosing. */
      const cards = [...document.querySelectorAll('#induction-host .tb .tb-c')];
      const rows = {};
      cards.forEach(c => { const y = Math.round(bb(c).top); rows[y] = (rows[y]||0) + 1; });
      const heights = cards.map(c => Math.round(bb(c).height));

      return { gaps, slack,
        usingRows: document.querySelectorAll('#induction-host .tb-c.on').length,
        boardRows: cards.length, boardRowsBefore: cards.length,
        emptyCells: [...document.querySelectorAll('#induction-host .tb > *, ' +
          '.wf-col-side .awp-grid > *, .wf-full #iref-body tr.dtab-r')]
          .filter(e => !e.textContent.trim()).length,
        cards: cards.length, perRow: Object.values(rows),
        catPerRow: ((window.InductionCatalog || {}).rows || [])
          .filter(r => !r.strategy ||
                       r.strategy === (window.Induction || {}).technique)
          .map(r => r.members.length),
        stretched: new Set(heights).size === 1 && heights.length > 2,
        cardWidths: cards.map(c => Math.round(bb(c).width)),
        refTop: Math.round(bb(document.querySelector('.wf-full')).top + window.pageYOffset),
        /* How many rows the scrollport shows at once — the density property
           that survived the move to a full-width reference. */
        refRowsRendered: (() => {
          const port = document.querySelector('.wf-full .idref');
          if (!port) return 0;
          const p = bb(port);
          return [...document.querySelectorAll('.wf-full #iref-body tr.dtab-r')]
            .filter(r => bb(r).top >= p.top - 1 && bb(r).bottom <= p.bottom + 1).length;
        })(),
        planBottom: Math.round(bb(document.querySelector('.wf-col-main .wf-sec')).bottom) };
    })()`);
    /* NO RESERVED CELLS. This is the compromise the brief refused. */
    t('no empty grid or flex cell anywhere in the workstation',
      dens.emptyCells === 0, dens.emptyCells);
    /* THREE AGENTS ARE THREE LIT ROWS, NOT THREE CARDS IN A ROW. The board
       does not reflow when a drug is selected — that is the point of an
       in-place state — so what is asserted is that exactly the three chosen
       rows are marked and the board's row count has not changed. */
    t('three chosen agents light three rows, and the board does not reflow',
      dens.usingRows === 3 && dens.boardRows === dens.boardRowsBefore,
      { using:dens.usingRows, rows:dens.boardRows, before:dens.boardRowsBefore });
    /* THE APPROVED COMPOSITION IS A FOUR-COLUMN GRID. It was a list of
       full-width rows; the cockpit specifies clinical rows of equal cards on
       a four-column track, with the row's fifth element a control and not a
       fifth card. So the width assertion is not "full" — it is "equal, and a
       quarter of the board", and the count is what carries the rest.

       WAS: "four to the row", four rows of four. That was a literal 4 x 4
       and it stopped being true when morphine left the analgesia row: its
       only canonical dose is postoperative, so the card was a permanent
       coverage line in the row a clinician reads first when choosing an
       opioid. Keeping the number would have meant inventing a fourth opioid
       to fill the cell, which is exactly the pressure induction-catalog.js
       exists to remove. THE CARD WIDTH DOES NOT CHANGE — a short row leaves
       its fourth track empty rather than stretching three cards across it —
       so the geometry this assertion protects is intact and asserted
       literally; only the per-row count now comes from the catalog. */
    t('...and every card is the same width, each row exactly its catalog row',
      new Set(dens.cardWidths).size === 1 && dens.cardWidths[0] > 70 &&
      dens.perRow.length === dens.catPerRow.length &&
      dens.perRow.every((n,i) => n === dens.catPerRow[i]),
      { widths:dens.cardWidths, perRow:dens.perRow, catalog:dens.catPerRow });
    t('no container is more than 26px taller than its contents',
      dens.slack.length === 0, dens.slack);
    /* 30–60px anonymous gaps were the complaint; the brief's band is 10–16px
       between major modules. */
    t('no anonymous gap between major modules exceeds 16px',
      dens.gaps.every(g => g <= 16), dens.gaps);
    t('...and none is negative — nothing overlaps',
      dens.gaps.every(g => g >= 0), dens.gaps);
    /* THE POINT OF THE WHOLE PASS. */
    /* WAS: ">= 4 entries above the fold". The reference spans the centre
       BENEATH both columns now, so it cannot begin above the taller of them —
       1048px with a 715px airway column — and at a 1250px viewport only the
       chrome and the first row clear the fold. That is arithmetic, not
       density. What density still owns is how many rows the reference itself
       shows at once, which is what this asserts. */
    t('the drug reference shows a working set of rows without scrolling it',
      dens.refRowsRendered >= 8, dens.refRowsRendered);

    /* ── 3d. THE AGENT ROW IS PACKED FROM THE LEFT ──────────────────────
       "Three agents are on one row" was not enough, and the density check
       that only counted empty cells could not see this: the cards WERE in one
       row with 8px between the boxes, but flex-grow inflated each one from
       its 150px basis to 157.5px so it filled the column. Measured, the
       widest ink inside them was 77, 104 and 87px against a 133.5px content
       box — 29 to 57px of dead width per card — so the names and doses ended
       well short of each card's right edge and the row read as three islands.

       This asserts the geometry directly: adjacency, order, the exact gaps,
       and that the leftover width is AFTER the last card rather than
       distributed between them. */
    /* ── THE BOARD'S OWN PACKING ─────────────────────────────────────────
       WAS: three selected agents as cards flowed across a grid, and this
       measured their adjacency, gaps and leftover width. There is no card
       grid any more — every drug is a row on the board and selecting one
       lights it where it stands — so what is measured is the property that
       replaced it: the board does not move, reflow or change size when the
       clinician chooses, and its rows stay compact at every count. */
    console.log('\nBOARD PACKING');
    const pack = await s.pg.evaluate(`(() => {
      const add = id => {
        const b = document.querySelector('#induction-host [data-plan-for="'+id+'"]');
        if (b) b.click();
      };
      const IDS = ['drug.propofol','drug.fentanyl','drug.rocuronium',
                   'drug.ketamine','drug.midazolam'];
      const read = () => {
        const box = document.querySelector('#induction-host .tb');
        const bb = box.getBoundingClientRect();
        const rows = [...box.querySelectorAll('.tb-c')].map(r => {
          const b2 = r.getBoundingClientRect();
          return { id:r.dataset.drug, on:r.classList.contains('on'),
                   l:+b2.left.toFixed(1), r:+b2.right.toFixed(1),
                   t:+b2.top.toFixed(1), h:+b2.height.toFixed(1) };
        });
        /* Only between rows that are DOM siblings — a group heading sits
           between two rows and its height is not a gap. */
        const gaps = [];
        const els = [...box.querySelectorAll('.tb-c')];
        for (let i = 1; i < els.length; i++)
          if (els[i].previousElementSibling === els[i-1]){
            const a2 = els[i-1].getBoundingClientRect(), b2 = els[i].getBoundingClientRect();
            gaps.push(+(b2.top - a2.bottom).toFixed(1));
          }
        /* THE CARDS TILE A SHARED FOUR-COLUMN TRACK.
           WAS: every row holds exactly four cards, and the fourth reaches
           the row's right edge. The analgesia row is three wide now —
           morphine left the board because its only canonical dose is
           postoperative — and a row that is short must NOT stretch its cards
           to fill the strip, because then one row's cards would be a
           different size from another's and the board would read as two
           different grids stacked.

           So the measurement is the track, not the count: every card on the
           board is the same width, every card sits at one of the same four
           left offsets, and a row is contiguous from its own left edge with
           nothing but the grid gap between cards. A full row still reaches
           the right edge, which is what proves the track spans the board. */
        const rws = [...box.querySelectorAll('.tb-row')];
        const allC = rws.map(rw =>
          [...rw.querySelectorAll('.tb-c')].map(c => c.getBoundingClientRect()));
        const widths = allC.flat().map(c => c.width);
        const full = allC.find(cs => cs.length === 4);
        const tiled = allC.length > 0 && full &&
          Math.max(...widths) - Math.min(...widths) <= 1 &&
          allC.every((cs, ri) => {
            if (!cs.length || cs.length > 4) return false;
            const rb = rws[ri].getBoundingClientRect();
            for (let i = 1; i < cs.length; i++)
              if (cs[i].left - cs[i-1].right > 6) return false;
            /* the same four columns, whatever the row's length */
            if (!cs.every((c,i) => Math.abs(c.left - full[i].left) < 2)) return false;
            if (Math.abs(cs[0].left - rb.left) >= 2) return false;
            /* only a full row may reach the right edge; a short one must
               leave its missing tracks empty rather than stretching */
            return cs.length === 4
              ? Math.abs(cs[3].right - rb.right) < 2
              : rb.right - cs[cs.length-1].right > 2;
          });
        return { n:rows.length, on:rows.filter(r => r.on).length,
                 boxW:+bb.width.toFixed(1), boxTop:+bb.top.toFixed(1),
                 tiled: tiled,
                 heights:[...new Set(rows.map(r => Math.round(r.h)))],
                 maxRowGap: gaps.length ? Math.max(...gaps) : 0,
                 order: rows.map(r => r.id) };
      };
      const out = {};
      if (window.Induction) window.Induction.clearPlan();
      out.none = read();
      [1,2,3,4,5].forEach(n => {
        if (window.Induction) window.Induction.clearPlan();
        IDS.slice(0, n).forEach(add);
        out[n] = read();
      });
      if (window.Induction) window.Induction.clearPlan();
      return out;
    })()`);

    t('the board is fully populated before anything is selected',
      pack.none.n >= 8 && pack.none.on === 0, { rows:pack.none.n, on:pack.none.on });
    [1,2,3,4,5].forEach(n => {
      t('  ' + n + ' selected: exactly ' + n + ' rows lit, none added or removed',
        pack[n].on === n && pack[n].n === pack.none.n,
        { on:pack[n].on, rows:pack[n].n });
    });
    t('SELECTING NEVER REFLOWS THE BOARD — same rows, same order, same top',
      [1,2,3,4,5].every(n =>
        pack[n].order.join() === pack.none.order.join() &&
        Math.abs(pack[n].boxTop - pack.none.boxTop) < 1 &&
        Math.abs(pack[n].boxW - pack.none.boxW) < 1),
      { orderStable:pack[3].order.join() === pack.none.order.join(),
        top:[pack.none.boxTop, pack[3].boxTop], w:[pack.none.boxW, pack[3].boxW] });
    t('...and no card floats: equal cards on one four-column track, no stretching',
      pack.none.tiled === true);
    /* A card carries four lines now — name, route and context, the per-kg
       rule and the amount for this patient — so the band is the four-line
       card's, not the one-line row's. Nothing is stretched beyond it. */
    /* A card is name, route and context, the per-kg rule and the amount for
       this patient. In a narrow centre the name and the rule each take a
       second line, which is the card printing what it has rather than
       abbreviating it — the band is the four-to-six-line card's. */
    t('...cards are compact and evenly spaced',
      pack.none.heights.every(h => h >= 60 && h <= 110) && pack.none.maxRowGap <= 12,
      { heights:pack.none.heights, maxGap:pack.none.maxRowGap });

    /* NO MECHANISM THAT DISTRIBUTES FREE SPACE MAY COME BACK. The board is
       always rendered now, so this reads it directly; the click is kept only
       so a selected row is measured as well as an unselected one. */
    const mech = await s.pg.evaluate(`(() => {
      document.querySelector('#induction-host [data-plan-for="drug.propofol"]').click();
      const box = getComputedStyle(document.querySelector('#induction-host .tb'));
      const card = getComputedStyle(document.querySelector('#induction-host .tb-c'));
      const out = { justify:box.justifyContent, grow:card.flexGrow,
                    ml:card.marginLeft, mr:card.marginRight };
      if (window.Induction) window.Induction.clearPlan();
      return out;
    })()`);
    t('the container never distributes free space between cards',
      ['space-between','space-around','space-evenly'].indexOf(mech.justify) < 0, mech.justify);
    t('...no card may grow past its own width', mech.grow === '0', mech.grow);
    t('...and no auto margin pushes cards apart',
      mech.ml !== 'auto' && mech.mr !== 'auto', { ml:mech.ml, mr:mech.mr });

    /* ── 3e. NO LARGE ANONYMOUS EMPTY REGIONS ───────────────────────────
       Three specific ones, each asserted as a RELATIONSHIP so a content
       change cannot make the test lie. */
    console.log('\nSTRUCTURAL EMPTINESS');
    const empt = await s.pg.evaluate(`(() => {
      /* SELECTION IS IN PLACE NOW. There is no chooser to open: every drug
         is already on the board, so this presses USE on its own row. */
      const add = id => {
        const b = document.querySelector('#induction-host [data-plan-for="'+id+'"]');
        if (b) b.click();
      };
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II'); set('i-proc','Laparoscopic cholecystectomy');
      compute(); if (window.ptSummary) ptSummary();
      document.getElementById('app').classList.remove('pt-open');
      if (window.Induction) window.Induction.clearPlan();
      add('drug.propofol'); add('drug.fentanyl'); add('drug.rocuronium');
      const R = e => { const b = e.getBoundingClientRect();
        return { t:Math.round(b.top), b:Math.round(b.bottom), h:Math.round(b.height),
                 w:Math.round(b.width) }; };

      /* A · the timer rail must be sized by its timers, not stretched */
      const rail = document.querySelector('.ws-rail');
      const cards = [...rail.querySelectorAll('.lt-card')];
      const last = cards.length ? cards[cards.length-1] : null;
      const rs = getComputedStyle(rail);

      /* B · THERE IS NO ADD CONTROL. It existed to reveal a board that is
         now the section itself, so the row it must not take is a row that
         cannot exist. Asserted as absence. */
      const addBtn = document.querySelector('#induction-host .pl-add');
      /* The technique strip is the strategy tile grid now — one top-level
         option per approach, with RSI's variants inside the RSI tile. */
      const techRow = document.querySelector('#induction-host .st');
      const head = document.querySelector('#induction-host .wf-col-main .wf-h');
      const card1 = document.querySelector('#induction-host .tb .tb-c');

      /* C · the reference spans the centre beneath both columns */
      const ref = document.querySelector('.wf-full');
      const idref = document.querySelector('.wf-full .idref');
      const side = document.querySelector('.wf-col-side');
      const mainc = document.querySelector('.wf-col-main');
      const strip = document.querySelector('.wf-bkp');

      return {
        rail: { box:R(rail), lastCard:last?R(last):null,
                deadUnderLast: last ? R(rail).b - R(last).b : null,
                declaredHeight: rail.style.height || '(none)',
                minHeight: rs.minHeight, alignSelf: rs.alignSelf, grow: rs.flexGrow,
                parentAlign: getComputedStyle(document.querySelector('.ws-grid')).alignItems },
        add: { present: !!addBtn,
               chooser: !!document.querySelector('#induction-host .pl-chooser'),
               emptyPlan: !!document.querySelector('#induction-host .pl-empty'),
               firstRowTop: card1 ? R(card1).t : null,
               techBottom: R(techRow).b,
               /* the board starts immediately under the technique strip */
               gapUnderTech: card1 ? R(card1).t - R(techRow).b : null },
        ref: { box:R(ref), idrefH:R(idref).h,
               colsBottom: Math.max(R(side).b, R(mainc).b),
               /* THE BACKUP STRIP SITS BETWEEN THEM NOW. It left the airway
                  column, where it was making that column 715px against the
                  plan's 291, and runs the centre width in about a fifth of
                  the height. Each block is measured against the one directly
                  above it. */
               strip: R(strip),
               gapUnderCols: R(strip).t - Math.max(R(side).b, R(mainc).b),
               gapUnderStrip: R(ref).t - R(strip).b,
               stripSpans: R(strip).w >= R(side).w + R(mainc).w,
               /* the space beside it under the SHORTER column — reported, not
                  asserted: it is what spanning the centre costs, and it is a
                  judgement about layout rather than a defect a number can
                  settle */
               spaceUnderShorter: Math.abs(R(side).b - R(mainc).b),
               spans: R(ref).w >= R(side).w + R(mainc).w,
               widerThanPlan: R(ref).w / R(mainc).w,
               hidden: idref.scrollHeight - idref.clientHeight,
               scrolls: getComputedStyle(idref).overflowY === 'auto',
               bounded: parseFloat(getComputedStyle(idref).maxHeight) > 0,
               cap: getComputedStyle(idref).maxHeight }
      };
    })()`);

    /* THE CAP IS PROPORTIONAL TO THE VIEWPORT, PROVED BY CHANGING IT. The
       reference is no longer beside anything, so there is no sibling column
       to measure against; what must hold is that a taller screen shows more
       of it rather than the same short window, and that it never grows the
       page without limit. */
    const avail = await s.pg.evaluate(`(() => {
      const H = () => {
        const i = document.querySelector('.wf-full .idref');
        return { cap:Math.round(parseFloat(getComputedStyle(i).maxHeight)),
                 h:Math.round(i.getBoundingClientRect().height) };
      };
      return H();
    })()`);
    const availTall = await (async () => {
      await s.pg.setViewportSize({ width:1536, height:1700 });
      await s.pg.waitForTimeout(400);
      const r = await s.pg.evaluate(`(() => {
        const i = document.querySelector('.wf-full .idref');
        return { cap:Math.round(parseFloat(getComputedStyle(i).maxHeight)),
                 h:Math.round(i.getBoundingClientRect().height) };
      })()`);
      await s.pg.setViewportSize({ width:1536, height:1250 });
      await s.pg.waitForTimeout(400);
      return r;
    })();

    /* C — THE REFERENCE SPANS THE CENTRE. It was a child of the plan column
       and inherited its 488px; a seven-column reference table does not go
       into 488px, which is what forced the indication under the drug name
       and a 78px average row. */
    t('the drug reference spans both columns, not just the plan',
      empt.ref.spans === true && empt.ref.widerThanPlan > 1.4,
      { width:empt.ref.box.w, ratioToPlan:Math.round(empt.ref.widerThanPlan*100)/100 });
    /* THE BACKUP AIRWAY IS A STRIP ACROSS THE CENTRE, not the bottom of the
       airway column. Inside that column it made it 715px against the plan's
       291 and the 424px of ground beside the plan was the difference. */
    t('...with the backup airway a full-width strip directly under the columns',
      empt.ref.stripSpans === true &&
      empt.ref.gapUnderCols >= 0 && empt.ref.gapUnderCols <= 16,
      { spans:empt.ref.stripSpans, gap:empt.ref.gapUnderCols,
        stripHeight:empt.ref.strip.h });
    t('...and the reference begins directly under that strip',
      empt.ref.gapUnderStrip >= 0 && empt.ref.gapUnderStrip <= 16,
      empt.ref.gapUnderStrip);
    t('...still scrolling inside itself rather than growing the page',
      empt.ref.scrolls === true && empt.ref.bounded === true,
      { overflowY:empt.ref.scrolls, cap:empt.ref.cap });
    /* THE RELATIONSHIP, NOT A NUMBER. A flat cap fails this: a screen 450px
       taller must show more reference, not the same window. */
    t('...and a taller viewport shows more of it, not the same window',
      availTall.cap > avail.cap + 100 && availTall.h > avail.h + 100,
      { at1250:avail, at1700:availTall });
    /* REPORTED, NOT ASSERTED. Spanning the centre means the shorter column
       ends above the reference; that space is the cost of the geometry and a
       judgement rather than a defect. It is measured here so a change in it
       is visible in the log. */
    console.log('       (space under the shorter column: ' +
      empt.ref.spaceUnderShorter + 'px)');

    /* THERE IS NO EMPTY PLAN ANY MORE. The section held only what had been
       selected, so with nothing selected it was 131px of heading beside a
       448px airway plan. The board is the section now: with nothing selected
       it is every eligible drug, which is both the denser state and the more
       useful one. */
    const emptyPlan = await s.pg.evaluate(`(() => {
      if (window.Induction) window.Induction.clearPlan();
      const host = document.getElementById('induction-host');
      /* THE WORKING COLUMN, NOT ITS FIRST SECTION. A .wf-sec inside the main
         column matched the strategy tiles — an 80px block — and compared to the
         whole airway column. What has to fill the space beside the airway is
         the column: strategy above, drug board below. */
      const sec = host.querySelector('.wf-col-main');
      const side = host.querySelector('.wf-col-side');
      return { h:Math.round(sec.getBoundingClientRect().height),
               sideH:Math.round(side.getBoundingClientRect().height),
               rows:host.querySelectorAll('.tb-c').length,
               using:host.querySelectorAll('.tb-c.on').length,
               groups:host.querySelectorAll('.tb-g').length,
               chooser:host.querySelectorAll('.pl-chooser').length,
               add:host.querySelectorAll('.pl-add').length,
               emptyState:host.querySelectorAll('.pl-empty').length };
    })()`);
    t('with nothing selected the board is fully populated, not an empty state',
      emptyPlan.rows >= 8 && emptyPlan.groups >= 3 && emptyPlan.using === 0,
      emptyPlan);
    t('...with no add control, no chooser and no empty-plan container',
      emptyPlan.add === 0 && emptyPlan.chooser === 0 && emptyPlan.emptyState === 0,
      emptyPlan);
    t('...and it fills the column beside the airway rather than leaving a void',
      Math.abs(emptyPlan.h - emptyPlan.sideH) < 100,
      { induction:emptyPlan.h, airway:emptyPlan.sideH,
        delta:Math.abs(emptyPlan.h - emptyPlan.sideH) });

    /* ── 4. SEARCH IS THE EXISTING SEARCH ───────────────────────────── */
    console.log('\n4. SEARCH');
    t('the header control calls the existing ClinicalSearch',
      /ws-id-find[\s\S]{0,200}ClinicalSearch\.open/.test(ENG));
    t('...and no second search implementation was added',
      !/function\s+\w*[Ss]earch\w*\s*\(/.test(code(CSS)) &&
      (ENGC.match(/window\.ClinicalSearch/g) || []).length > 0);
    const search = await s.pg.evaluate(`(() => {
      let called = null;
      const real = window.ClinicalSearch;
      window.ClinicalSearch = { open:function(q){ called = (q === undefined ? '<undef>' : q); } };
      document.querySelector('#ws-id .ws-id-find').click();
      window.ClinicalSearch = real;
      return { called, realExists:!!(real && real.open) };
    })()`);
    t('...and pressing it opens that search', search.called === '' && search.realExists,
      search);

    await s.ctx.close();

    /* ── 5. RESPONSIVE SHELL ─────────────────────────────────────────── */
    console.log('\n5. RESPONSIVE SHELL');
    for (const [w, h] of [[1440,1250],[1180,1000],[900,1000],[768,1024],[600,900],[390,844]]) {
      const v = await open(b, w, h);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(600);
      const r = await v.pg.evaluate(`(() => {
        const el = s => document.querySelector(s);
        const box = s => { const e = el(s); return e ? Math.round(e.getBoundingClientRect().height) : null; };
        const small = [...document.querySelectorAll('#ws-id button, #cmd-strip .cmd-b, .case-new, .case-np')]
          .filter(e => e.offsetParent && e.getBoundingClientRect().height < 40)
          .map(e => (e.className||'') + ':' + Math.round(e.getBoundingClientRect().height));
        const clipped = [...document.querySelectorAll('.case-state, .case-state *, #cw-derived *, #ws-id *')]
          .filter(e => e.children.length === 0 && e.scrollWidth > e.clientWidth + 2 &&
                       getComputedStyle(e).textOverflow !== 'ellipsis')
          .map(e => (e.className||e.tagName) + ':' + e.textContent.slice(0,24));
        /* offsetParent IS NULL FOR position:fixed. The SOS button is fixed,
           so the first version of this line counted it as hidden at every
           width it is actually the only emergency control — and reported the
           page as having none. Computed display is the honest test. */
        const shown = e => { const cs = getComputedStyle(e), r = e.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0; };
        const sos = [...document.querySelectorAll('#ws-id .ws-id-sos, .ws-sos')]
          .filter(shown).length;
        return { overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
                 idH:box('#ws-id'), navH:box('#cmd-strip'), small, clipped, sos,
                 caseText:el('.case-state').textContent.replace(/\\\\s+/g,' ').trim(),
                 scalars:document.querySelectorAll('#cw-derived .cw-d').length };
      })()`);
      const P = w + ': ';
      t(P + 'no horizontal page overflow', r.overflow <= 0, r.overflow);
      t(P + 'no clipped command-bar or header content', r.clipped.length === 0, r.clipped);
      t(P + 'the case line still says everything',
        /42 years/.test(r.caseText) && /75 kg/.test(r.caseText) &&
        /Laparoscopic cholecystectomy/.test(r.caseText), r.caseText);
      t(P + 'all scalars present', r.scalars >= 7, r.scalars);
      /* 44px touch ergonomics wherever a finger is expected. */
      if (w <= 900) t(P + 'shell controls are at least 40px tall', r.small.length === 0, r.small);
      t(P + 'exactly one emergency control is on screen', r.sos === 1, r.sos);
      t(P + 'no runtime errors', v.errs.length === 0, v.errs.slice(0,2));
      await v.ctx.close();
    }

    /* ── 5b. THE PHONE'S EMERGENCY SHEET ───────────────────────────────
       A permanent rail is impossible at 390px. The emergency control is
       docked in the sticky domain strip — it was a floating action button,
       which sat over whatever clinical control happened to scroll under it —
       and it opens a sheet that closes back to the exact workstation state. */
    console.log('\nCRISIS — PHONE');
    {
      const v = await open(b, 390, 844);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(600);
      /* THE SCAN. Every 50px across the real scroll range, clamped to the
         document rather than assuming a fixed height. */
      const scan = await v.pg.evaluate(`(() => {
        const add = document.querySelector('#induction-host [data-plan-for="drug.propofol"]');
        if (add) add.click();
        const sos = document.getElementById('ws-sos');
        const strip = sos.closest('#ws-id') || sos.parentElement;
        const alpha = c => { const mm = /^rgba?\\(([^)]+)\\)$/.exec(c || '');
          if (!mm) return 0; const p = mm[1].split(',').map(x => parseFloat(x));
          return p.length < 4 ? 1 : p[3]; };
        const H = document.documentElement.scrollHeight;
        const maxY = Math.max(0, H - window.innerHeight);
        let offsets = 0, offScreen = 0, stolen = 0, stolenOutsideStrip = 0;
        const reachable = {}, allCards = {};
        for (let y = 200; y <= maxY; y += 50) {
          window.scrollTo(0, y); offsets++;
          const sr = sos.getBoundingClientRect();
          if (!(sr.top >= 0 && sr.bottom <= window.innerHeight)) offScreen++;
          const st = strip.getBoundingClientRect();
          [...document.querySelectorAll('#induction-host .tb-c')].forEach(c => {
            const r = c.getBoundingClientRect();
            /* THE CARD IS THE BUTTON, so its centre is the representative
               actionable point — it is what a thumb lands on and it is
               stable across every card size and wrap. */
            const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
            if (cy < 0 || cy > window.innerHeight || cx < 0 || cx > window.innerWidth) return;
            const id = c.getAttribute('data-drug') || c.getAttribute('data-member') || '?';
            allCards[id] = true;
            const top = document.elementFromPoint(cx, cy);
            if (top && (top === sos || sos.contains(top) || strip.contains(top))) {
              stolen++;
              if (!(cx >= st.left && cx <= st.right && cy >= st.top && cy <= st.bottom))
                stolenOutsideStrip++;
            } else if (top && (c === top || c.contains(top))) reachable[id] = true;
          });
        }
        window.scrollTo(0, 0);
        const ids = Object.keys(allCards);
        return { offsets, maxY, offScreen, stolen, stolenOutsideStrip,
                 cards:ids.length, unreachable:ids.filter(k => !reachable[k]),
                 sosInStrip: strip !== sos && strip.contains(sos),
                 stripId: strip.id, stripPos: getComputedStyle(strip).position,
                 stripAlpha: alpha(getComputedStyle(strip).backgroundColor),
                 stripBg: getComputedStyle(strip).backgroundColor }; })()`);

      const m = await v.pg.evaluate(`(() => {
        /* SELECTION IS IN PLACE NOW. There is no chooser to open: every drug
         is already on the board, so this presses USE on its own row. */
      const add = id => {
        const b = document.querySelector('#induction-host [data-plan-for="'+id+'"]');
        if (b) b.click();
      };
        add('drug.propofol');
          const plan = () => [...document.querySelectorAll('#induction-host .tb-c.on .tb-c-n')]
          .map(e => e.textContent);
        const planBefore = plan();
        window.scrollTo(0, 1400);
        const sos = document.getElementById('ws-sos');
        const sr = sos.getBoundingClientRect();
        const onScreen = sr.top >= 0 && sr.bottom <= window.innerHeight;
        /* it must not be sitting on top of a clinical control */
        const covered = [...document.querySelectorAll('#induction-host button')]
          .filter(e => { const r = e.getBoundingClientRect();
            return r.right > sr.left && r.left < sr.right &&
                   r.bottom > sr.top && r.top < sr.bottom; }).length;
        const y0 = window.pageYOffset;
        sos.click();
        const h = document.getElementById('crisis-preview');
        const o = { onScreen, covered, height:Math.round(sr.height),
                    opened:!h.hidden, position:getComputedStyle(h).position,
                    picks:h.querySelectorAll('.cpv-p').length,
                    moved:window.pageYOffset - y0,
                    domain:document.getElementById('output').dataset.domain };
        h.querySelector('.cpv-p').click();               /* choose a protocol */
        o.steps = h.querySelectorAll('.crisis-step').length;
        o.closeSize = Math.round(h.querySelector('.cpv-x').getBoundingClientRect().height);
        h.querySelector('.cpv-x').click();               /* and close it */
        o.closed = h.hidden;
        o.scrollKept = window.pageYOffset === y0;
        o.planKept = plan().join() === planBefore.join();
        return o;
      })()`);
      t('390: the emergency control is on screen after a long scroll',
        m.onScreen === true, m);
      /* ── A ONE-POINT RECTANGLE TEST WAS NOT A SAFETY INVARIANT ───────
         WAS: covered === 0 at scrollY 1400 — a single sample, counting raw
         rectangle intersections with the emergency control.

         IT PASSED ON MAIN BY COINCIDENCE OF DOCUMENT HEIGHT. Scanning every
         offset shows card text under the strip at 14 of 159 offsets on
         da0217f and card centres taken by it at 38 — before this branch
         existed. 1400 simply happened to be a clean point in that document.
         A taller board moves the clean points, so the test reported a
         regression where the only thing that changed was page height.

         AND THE CLAIM IS FALSE FOR ANY STICKY HEADER. #ws-id is 108px,
         position:sticky, and content scrolls beneath it by design. Requiring
         nothing to ever pass under it is requiring it not to be sticky.

         SO THE SCAN BELOW ASSERTS WHAT A STICKY EMERGENCY CONTROL MUST
         ACTUALLY GUARANTEE, at every offset in the real scroll range:

           the control is always in the viewport;
           every clinical card is hit-testable at SOME offset, so nothing is
             permanently unreachable behind it;
           nothing is ever taken outside the strip's own footprint, which is
             what would distinguish a floating overlay from a docked bar;
           the control is structurally inside that sticky strip;
           the strip paints a near-opaque background, so what passes beneath
             it is hidden rather than half-legible.

         WHAT THIS DELIBERATELY DOES NOT CLAIM: that no text ever passes
         beneath the strip. It does — 16 offsets here, 14 on main — and that
         residual phone legibility issue is pre-existing and recorded as
         deferred work, not fixed in a clinical-content branch. */
      t('390: the emergency control never leaves the viewport while scrolling',
        scan.offScreen === 0 && scan.offsets > 100,
        { offsets:scan.offsets, offScreen:scan.offScreen, range:scan.maxY });
      t('390: ...and no clinical card is permanently unreachable behind it',
        scan.unreachable.length === 0 && scan.cards === 16,
        { cards:scan.cards, unreachable:scan.unreachable });
      t('390: ...nothing is ever taken outside the sticky strip itself',
        scan.stolenOutsideStrip === 0,
        { insideStrip:scan.stolen, outside:scan.stolenOutsideStrip });
      t('390: ...the control is docked INSIDE that sticky strip, not floating',
        scan.sosInStrip === true && scan.stripPos === 'sticky' &&
        scan.stripId === 'ws-id', { inStrip:scan.sosInStrip, pos:scan.stripPos });
      /* Alpha is read off the computed colour, so a background declaration
         that is actually translucent cannot pass as opaque. It measures 0.97
         today — near-opaque, not 1 — and the threshold is stated so a change
         that made the strip genuinely see-through would fail here. */
      t('390: ...and that strip paints a near-opaque background',
        scan.stripAlpha >= 0.95, { alpha:scan.stripAlpha, bg:scan.stripBg });
      t('390: ...at a comfortable touch size', m.height >= 40, m.height);
      t('390: it opens a sheet, not a page', m.opened && m.position === 'fixed' &&
        m.domain === 'induction' && m.moved === 0, m);
      t('390: ...offering the eight protocols', m.picks === 8, m.picks);
      t('390: ...which open with their steps', m.steps > 0, m.steps);
      t('390: ...and close back to the same workstation state',
        m.closed && m.scrollKept && m.planKept, m);
      t('390: the sheet close control is a real target', m.closeSize >= 32, m.closeSize);
      t('390: no runtime errors', v.errs.length === 0, v.errs.slice(0,2));
      await v.ctx.close();
    }

    /* ── 6. ACCESS MODEL UNCHANGED ───────────────────────────────────── */
    console.log('\n6. PUBLIC AND ROLE BEHAVIOUR');
    /* The shell must not restate an auth predicate. The approved layer is the
       only place that decides. */
    const shellSrc = /<header class="ws-id"[\s\S]*?<\/nav>/.exec(ENG);
    t('the shell restates no authentication predicate',
      !/verification_status|role\s*===|is_admin|unverifiedDoctor|requireRole|requireAuth/
        .test(shellSrc ? shellSrc[0] : ''), 'a predicate appeared in the shell markup');
    t('...and adds no redirect', !/ws-id[\s\S]{0,300}location\.(href|replace)/.test(ENGC));

    const IDS = {
      anonymous:{ role:'anon', profile:null },
      'verified doctor':{ role:'session', profile:{ role:'doctor', verification_status:'verified',
        full_name:'Dr V', professional_level:'specialist', medical_license_number:'L1',
        country:'GE', hospital:'H', specialty:'anesthesiology' } },
      patient:{ role:'session', profile:{ role:'patient', verification_status:'not_required',
        full_name:'Pat' } }
    };
    for (const k of Object.keys(IDS)) {
      const v = await open(b, 1440, 1150, IDS[k]);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(600);
      const r = await v.pg.evaluate(`(() => {
        const np = document.querySelector('.case-np');
        return { url:location.pathname,
                 shell:!!document.getElementById('ws-id'),
                 navTabs:document.querySelectorAll('#cmd-strip .cmd-b[data-domain]').length,
                 clinicalUsable:!!document.getElementById('i-weight') &&
                   /mg\\/kg/.test(document.getElementById('output').textContent),
                 search:!!document.querySelector('#ws-id .ws-id-find'),
                 newPatientPresent:!!np, newPatientVisible:!!(np && np.offsetParent) };
      })()`);
      t(k + ': stays on Live Tools, no redirect', r.url === '/engine.html', r.url);
      t(k + ': gets the whole shell and every domain', r.shell && r.navTabs === 11,
        { shell:r.shell, tabs:r.navTabs });
      t(k + ': clinical reference remains usable without logging in',
        r.clinicalUsable === true);
      t(k + ': search is available', r.search === true);
      /* Staff-only stays staff-only, decided by the approved layer. */
      t(k + ': New Patient is present but not granted by the shell',
        r.newPatientPresent === true && r.newPatientVisible === false,
        { present:r.newPatientPresent, visible:r.newPatientVisible });
      await v.ctx.close();
    }

    /* ══ 7. THE DRUG REFERENCE WORKSTATION ══════════════════════════════
       PHASE 3. The reference is one engine mounted twice — the workspace tab
       over every published drug, the induction column over the groups an
       induction reaches for. Everything below holds one of three lines:

         ONE SEARCH. The private substring matcher that used to filter this
         table is gone; the canonical index answers, so class and indication
         are searchable and unpublished content cannot be returned.

         ONE PLAN. "Add to plan" calls Induction's own API. It holds no list,
         it preselects nothing, and it removes nothing on its own.

         NOTHING IS COVERED. The detail surface and the tools are disclosures
         inside the page. Opening either leaves the case, the plan, the
         technique, the airway, the timers and the crisis state exactly as
         they were.                                                        */
    console.log('\n7. DRUG REFERENCE — SEARCH, FILTERS, PLAN, DETAIL, TOOLS');
    const RESP = {};

    t('no second matcher survives in the reference',
      !/function\s+drefMatch\s*\(/.test(ENGC));
    t('...the reference asks ClinicalContent.search for its results',
      /function\s+drefQueryRank[\s\S]{0,400}CC\.search\(/.test(ENGC));
    t('...and one engine serves both mounts',
      (ENGC.match(/function\s+drefTable\s*\(/g) || []).length === 1 &&
      (ENGC.match(/function\s+drefCards\s*\(/g) || []).length === 1 &&
      /DREF_I\s*=\s*\{[\s\S]{0,400}iref\s*:/.test(ENGC));

    const r3 = await open(b, 1440, 1250);
    await fill(r3.pg, ADULT); await r3.pg.waitForTimeout(700);

    /* ── the two mounts and their shapes ── */
    const mounts = await r3.pg.evaluate(`(() => {
      const rows = s => [...document.querySelectorAll(s + ' tr.dtab-r')]
        .map(r => (r.querySelector('.dtab-n')||{}).textContent);
      setDomain('drugs');
      const wide = rows('#dref-body');
      setDomain('induction');
      return { iref:rows('#iref-body'), dref:wide,
               irefChips:[...document.querySelectorAll('#iref-cats .dref-cat')].length,
               drefChips:[...document.querySelectorAll('#dref-cats .dref-cat')].length,
               irefTable:!!document.querySelector('#iref-body table.dtab'),
               reduced:!!document.querySelector('#iref-body table.dtab-red'),
               /* the three action columns carry sr-only headings; the data
                  columns are the ones a clinician reads across */
               cols:[...document.querySelectorAll('#iref-body thead th')]
                 .filter(th => !th.querySelector('.sr-only'))
                 .map(th => th.textContent.trim()).filter(Boolean) };
    })()`);
    t('the induction column mounts the reference as a table',
      mounts.irefTable === true && mounts.iref.length > 6, mounts.iref.length);
    /* At 1440 the centre is 826px, which is the full seven columns. The
       reduced set is for a narrower container and is asserted at 1180. */
    t('...with the full column set at this width',
      mounts.reduced === false &&
      mounts.cols.join('|') === 'Drug|Use|Dose|This patient|Preparation',
      mounts.cols);
    t('...scoped to the induction groups, while the workspace holds them all',
      mounts.iref.length < mounts.dref.length && mounts.dref.length >= 20,
      { induction:mounts.iref.length, workspace:mounts.dref.length });
    t('...and both build their filters from classes that are actually present',
      mounts.irefChips >= 3 && mounts.drefChips > mounts.irefChips,
      { induction:mounts.irefChips, workspace:mounts.drefChips });
    /* PROVENANCE IS THE SAFETY GATE, AND SEARCH IS NOT A WAY ROUND IT. Five
       records in DRUGS are proposed-unverified and must never reach a
       clinician — not in the table, not through a filter, and not by being
       searched for by name. */
    const unpub = await r3.pg.evaluate(`(() => {
      const CC = window.ClinicalContent;
      const hidden = CC.DRUGS.filter(d => !CC.isPublishable(d));
      const shown = [], found = [];
      hidden.forEach(d => {
        if (mountHas(d.id)) shown.push(d.id);
        drefSet('dref','q', d.name);
        if (mountHas(d.id)) found.push(d.id);
      });
      drefSet('dref','q','');
      function mountHas(id){
        return !!document.querySelector('#dref-body [data-drug="'+id+'"]');
      }
      return { count:hidden.length, shown, found,
               ids:hidden.map(d => d.id) };
    })()`);
    t('unpublished records are in the dataset and on no screen',
      unpub.count > 0 && unpub.shown.length === 0,
      { unpublished:unpub.count, rendered:unpub.shown });
    t('...and searching for one by name does not surface it',
      unpub.found.length === 0, unpub.found);

    /* ── SEARCH ── */
    const srch = await r3.pg.evaluate(`(() => {
      const names = () => [...document.querySelectorAll('#iref-body .dtab-n')]
        .map(n => n.textContent);
      const doses = () => [...document.querySelectorAll('#iref-body tr.dtab-r')]
        .map(r => (r.querySelector('.dtab-n')||{}).textContent + '=' +
                  (r.querySelector('.dtab-dose')||{}).textContent.replace(/\\s+/g,' ').trim());
      const before = doses();
      const go = q => { drefSet('iref','q',q); return names(); };
      const generic = go('rocuronium');
      const alias   = go('esmeron');
      const trade   = go('diprivan');
      const klass   = go('opioid');
      /* What each drug the class query returned actually IS, from its own
         record — so an indication-tier hit can be told from a class one. */
      const CC = window.ClinicalContent;
      const klassWhy = [...new Set([...document.querySelectorAll('#iref-body tr.dtab-r')]
        .map(r => r.dataset.drug))].map(id => { const d = CC.byId(id);
          return { id, pclass:d ? d.pclass : null,
                   viaIndication: !!(d && (d.indications||[])
                     .some(s => /opioid/i.test(s))) }; });
      const indic   = go('rapid sequence');
      const fuzzy   = go('propofl');
      const none    = go('zzzznotadrug');
      go('');
      const after = doses();
      return { generic, alias, trade, klass, klassWhy, indic, fuzzy, none,
               unchanged: JSON.stringify(before) === JSON.stringify(after),
               beforeCount: before.length, afterCount: after.length };
    })()`);
    /* The canonical index also returns sugammadex here, because its recorded
       indication is "reversal of rocuronium" — a class/indication hit, one
       tier below the exact name. That is the ranking working, so what is
       asserted is that the exact name LEADS, not that it is alone. */
    t('search finds a generic name, and the exact name leads',
      srch.generic[0] === 'Rocuronium', srch.generic);
    /* SEARCH RETURNS ROWS, AND A DRUG CAN BE SEVERAL. Rocuronium carries a
       routine intubating record and an RSI record, so the alias query
       returns two rows of the same drug. What is asserted is the set of
       drugs matched, not the number of rows. */
    t('search finds an alias the name does not contain',
      [...new Set(srch.alias)].join() === 'Rocuronium', srch.alias);
    t('...and a trade name', srch.trade.join() === 'Propofol', srch.trade);
    /* WAS: exactly three distinct names. Alfentanil is a fourth opioid record
       now, and IV lidocaine is returned too — not as an opioid, but because
       "opioid-sparing analgesia" is one of its recorded indications. That is
       the same indication tier that already returns sugammadex for a
       rocuronium query, and it is the behaviour the reference is meant to
       have: a clinician asking about opioids should be shown the drug whose
       stated purpose is to spare them.
       What must NOT happen is the taxonomy bending to the query. So the class
       is asserted separately from the match: every opioid-class record comes
       back, and the one non-opioid that comes back is still filed as a local
       anaesthetic and earned its place through an indication string. */
    t('search finds drugs by class',
      ['Fentanyl','Morphine','Remifentanil','Alfentanil']
        .every(n => srch.klass.indexOf(n) >= 0) &&
      [...new Set(srch.klass)].length === 5, [...new Set(srch.klass)]);
    t('...and a drug matched on indication is not reclassified by the match',
      srch.klassWhy.filter(d => d.pclass === 'opioid').length === 4 &&
      srch.klassWhy.filter(d => d.pclass !== 'opioid')
        .every(d => d.id === 'drug.lidocaine-iv' && d.pclass === 'local' &&
                    d.viaIndication === true), srch.klassWhy);
    t('search finds drugs by indication',
      srch.indic.length > 0 && srch.indic.indexOf('Suxamethonium') >= 0, srch.indic);
    t('...and tolerates a typo, as the canonical index does',
      srch.fuzzy.join() === 'Propofol', srch.fuzzy);
    t('a query that matches nothing returns nothing, not everything',
      srch.none.length === 0, srch.none);
    /* THE POINT. Filtering is a view; it may never touch a value. */
    t('searching changes no clinical value anywhere in the reference',
      srch.unchanged === true && srch.beforeCount === srch.afterCount,
      { before:srch.beforeCount, after:srch.afterCount });

    /* ── FILTERS ── */
    const filt = await r3.pg.evaluate(`(() => {
      const read = () => [...document.querySelectorAll('#iref-body tr.dtab-r')]
        .map(r => (r.querySelector('.dtab-n')||{}).textContent + '=' +
                  (r.querySelector('.dtab-dose')||{}).textContent.replace(/\\s+/g,' ').trim());
      const all = read();
      drefSet('iref','cat','opioid');
      const opi = read();
      drefSet('iref','cat','nmb');
      const nmb = read();
      drefSet('iref','cat','all');
      const back = read();
      const chips = [...document.querySelectorAll('#iref-cats .dref-cat')]
        .map(c => c.innerText.replace(/\\s+/g,' ').trim());
      return { all, opi, nmb, back, chips,
               opiSubset: opi.every(x => all.indexOf(x) >= 0),
               nmbSubset: nmb.every(x => all.indexOf(x) >= 0),
               restored: JSON.stringify(all) === JSON.stringify(back) };
    })()`);
    t('a category filter narrows the list', filt.opi.length > 0 &&
      filt.opi.length < filt.all.length && filt.nmb.length < filt.all.length,
      { all:filt.all.length, opioids:filt.opi.length, nmb:filt.nmb.length });
    t('...to a strict subset of the same rows, values included',
      filt.opiSubset === true && filt.nmbSubset === true);
    t('...and clearing it restores exactly what was there',
      filt.restored === true);
    t('...no filter offers a category with nothing in it',
      filt.chips.every(c => !/\b0$/.test(c)), filt.chips);

    /* ── ADD TO PLAN ── */
    const plan = await r3.pg.evaluate(`(() => {
      Induction.clearPlan();
      const btn = id => document.querySelector('#iref-body [data-plan-for="'+id+'"]');
      /* The row's Add control, and — beside it — the drug's own group, read
         from the canonical record rather than from a list written here. */
      const CC = window.ClinicalContent;
      const offered = [...document.querySelectorAll('#iref-body tr.dtab-r')]
        .map(r => { const d = CC.byId(r.dataset.drug);
          return { id:r.dataset.drug, group:d ? d.group : null,
                   has:!!r.querySelector('[data-plan-for]') }; });
      const empty = Induction.plan.slice();
      btn('drug.propofol').click();
      const one = Induction.plan.slice();
      btn('drug.fentanyl').click();
      const two = Induction.plan.slice();
      /* a SECOND agent in a role that is already filled */
      btn('drug.midazolam').click();
      const three = Induction.plan.slice();
      const pressed = !!btn('drug.propofol') &&
        btn('drug.propofol').getAttribute('aria-pressed') === 'true';
      /* pressing it again is a removal, and only of that one */
      btn('drug.midazolam').click();
      const afterRemove = Induction.plan.slice();
      return { offered, empty, one, two, three, pressed, afterRemove,
               planCards: document.querySelectorAll('#induction-host .pl-sel').length };
    })()`);
    t('nothing is in the plan until it is put there', plan.empty.length === 0);
    t('Add to plan adds exactly the drug pressed',
      plan.one.join() === 'drug.propofol', plan.one);
    t('...a second drug joins it rather than replacing it',
      plan.two.length === 2 && plan.two.indexOf('drug.propofol') >= 0 &&
      plan.two.indexOf('drug.fentanyl') >= 0, plan.two);
    t('...and a second agent in the SAME role joins the first',
      plan.three.length === 3 && plan.three.indexOf('drug.midazolam') >= 0, plan.three);
    t('...the button then reads as pressed', plan.pressed === true);
    t('...and pressing it again removes only that one',
      plan.afterRemove.length === 2 && plan.afterRemove.indexOf('drug.midazolam') < 0 &&
      plan.afterRemove.indexOf('drug.propofol') >= 0, plan.afterRemove);
    /* THE MODEL DECIDES WHAT MAY BE PLANNED, NOT THE TABLE.
       WAS: a nine-id regex — the drugs that happened to be publishable when
       it was written. Eight more drugs became publishable in this pass and
       the list went stale, which is the flaw in stating the rule as a roster:
       it says WHICH drugs rather than WHY, and a correct new record reads as
       a failure. The rule the page actually applies is DREF_ROLE_GROUP —
       induction, analgesia and nmb get a control, everything else does not —
       so the assertion now reads each row's group off its own canonical
       record and requires the control to follow it exactly. A vasopressor
       row gaining a button, or a new nmb record silently missing one, both
       still fail; adding a correct record no longer does. */
    const PLANNABLE = ['induction', 'analgesia', 'nmb'];
    t('...and only canonical induction-compatible groups are offered it',
      plan.offered.length > 0 &&
      plan.offered.every(o => o.group !== null &&
        o.has === (PLANNABLE.indexOf(o.group) >= 0)),
      plan.offered.filter(o => o.has !== (PLANNABLE.indexOf(o.group) >= 0))
        .map(o => o.id + '/' + o.group + '/' + o.has));
    /* And the groups it excludes are really present in the table, so the
       assertion above is not passing over a set with no negative case. */
    t('...with the reversal rows present and carrying none',
      plan.offered.some(o => o.group === 'reversal') &&
      plan.offered.filter(o => o.group === 'reversal').every(o => o.has === false),
      plan.offered.filter(o => o.group === 'reversal').map(o => o.id));

    /* ── DETAIL, TOOLS, AND WHAT MUST SURVIVE THEM ── */
    const keep = await r3.pg.evaluate(`(() => {
      Induction.clearPlan();
      Induction.setTechnique('classic');
      document.querySelector('#iref-body [data-plan-for="drug.propofol"]').click();
      const snap = () => ({
        plan: Induction.plan.slice().join(),
        technique: Induction.technique,
        weight: document.getElementById('i-weight').value,
        airway: (document.querySelector('#induction-host .awp-grid')||{}).textContent || '',
        timers: (document.querySelector('#live-timers')||{}).textContent || '',
        crisisOpen: !document.querySelector('.crisis-preview[hidden]') ,
        url: location.pathname + location.hash,
        domain: document.getElementById('output').getAttribute('data-domain')
      });
      const before = snap();
      /* SEARCH */
      drefSet('iref','q','fentanyl');
      const afterSearch = snap();
      drefSet('iref','q','');
      /* DETAIL — open, read, close */
      drefDetails('iref','drug.propofol');
      const det = document.querySelector('#iref-body .ddet');
      const detOpen = snap();
      const detText = det ? det.innerText : '';
      const modal = !!document.querySelector('.cp-bg');
      /* The board is always on screen; what must survive opening a detail is
         the SELECTION, which is a lit row rather than a card. */
      const planStillVisible = !!document.querySelector('#induction-host .tb-c.on') ||
                               !!document.querySelector('#induction-host .tb-c');
      drefDetails('iref','drug.propofol');
      const detClosed = snap();
      const stillThere = !!document.querySelector('#iref-body .ddet');
      /* TOOLS */
      ctoolsToggle();
      const toolsPanel = document.getElementById('ctools');
      const toolsOpen = snap();
      const toolsText = toolsPanel ? toolsPanel.innerText : '';
      const toolsCells = toolsPanel ? toolsPanel.querySelectorAll('.ctl-c').length : 0;
      const toolsJumps = toolsPanel ? toolsPanel.querySelectorAll('.ctl-j').length : 0;
      ctoolsToggle();
      const toolsClosed = snap();
      return { before, afterSearch, detOpen, detClosed, toolsOpen, toolsClosed,
               detText, modal, planStillVisible, stillThere,
               toolsText, toolsCells, toolsJumps,
               toolsHidden: toolsPanel ? toolsPanel.hasAttribute('hidden') : null };
    })()`);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    t('searching preserves the case, the plan, the technique and the timers',
      same(keep.before, keep.afterSearch), { before:keep.before, after:keep.afterSearch });
    t('opening a drug detail preserves all of it',
      same(keep.before, keep.detOpen), keep.detOpen);
    t('...closing it preserves all of it and puts nothing back',
      same(keep.before, keep.detClosed) && keep.stillThere === false, keep.detClosed);
    t('...and the detail is inline — the workstation is never covered',
      keep.modal === false && keep.planStillVisible === true,
      { modal:keep.modal, planVisible:keep.planStillVisible });
    t('opening and closing the clinical tools preserves all of it',
      same(keep.before, keep.toolsOpen) && same(keep.before, keep.toolsClosed),
      { open:keep.toolsOpen, closed:keep.toolsClosed });
    t('...and the tools close again', keep.toolsHidden === true);

    /* THE DETAIL SHOWS ONLY WHAT THE RECORD CARRIES. No record in DRUGS has a
       duration, an onset, an offset or a contraindication list, so none of
       those words may appear as a heading. */
    t('the detail names only canonical fields',
      /CLASS/i.test(keep.detText) && /ALSO KNOWN AS/i.test(keep.detText) &&
      /INDICATIONS/i.test(keep.detText) && /PREPARATION/i.test(keep.detText) &&
      /PROVENANCE/i.test(keep.detText), keep.detText.slice(0,120));
    t('...and invents no onset, duration or contraindication',
      !/\b(onset|duration|offset|half.life|contraindications)\b/i.test(keep.detText),
      keep.detText.slice(0,160));
    /* 75 kg against the reviewed adult record: 2–2.5 mg/kg = 150–188 mg.
       Was 113–188 under the shipped 1.5–2.5. */
    t('...including the amount for THIS patient, from the same renderer',
      /150.188\s*mg/.test(keep.detText.replace(/\s+/g,' ')), keep.detText.slice(0,200));

    /* THE TOOLS EXPOSE; THEY DO NOT CALCULATE. */
    t("the clinical tools show this case's own scalars",
      keep.toolsCells >= 6 && /TBW|BSA|EBV/.test(keep.toolsText), keep.toolsCells);
    t('...and route the rest to the workspace that owns them',
      keep.toolsJumps >= 3, keep.toolsJumps);
    t('...and no new formula was written for them',
      !/Math\.(pow|sqrt)|\*\s*0\.\d|\/\s*3600/.test(
        (/function ctoolsHtml\(\)[\s\S]*?\n\}/.exec(ENGC) || [''])[0]),
      'ctoolsHtml computes something');

    t('no runtime errors through any of it', r3.errs.length === 0, r3.errs.slice(0,2));
    await r3.ctx.close();

    /* ── RESPONSIVE: THREE PRESENTATIONS, CHOSEN BY THE WIDTH THAT IS THERE ──
       'table'    seven columns          — the centre is 760px or more
       'reduced'  six, Preparation folds — 520 to 760
       'list'     compact clinical rows  — a phone

       The threshold is the CONTAINER's measured width, not the viewport,
       because the two do not track each other: the reference is 826px at
       1440, 606px at 1180 where the Crisis rail is still beside it, and 732px
       at 768 where the columns have stacked and it has the whole page. A
       viewport breakpoint gets at least one of those wrong — 768 was being
       handed a phone list while measuring 732px. */
    const MODES = { 1440:'table', 1280:'reduced', 1180:'reduced', 1024:'table',
                    768:'reduced', 390:'list' };
    for (const [w, h] of [[1440,1250],[1280,900],[1180,900],[1024,900],[768,1024],[390,844]]) {
      const v = await open(b, w, h);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(650);
      const rr = await v.pg.evaluate(`(() => {
        const body = document.getElementById('iref-body');
        const tbl = body.querySelector('table.dtab');
        const shown = !!tbl && getComputedStyle(tbl).display !== 'none';
        const items = shown ? [...body.querySelectorAll('tr.dtab-r')]
                            : [...body.querySelectorAll('.dcard')];
        return { mode: shown ? (tbl.classList.contains('dtab-red') ? 'reduced' : 'table')
                             : 'list',
                 refW:Math.round(document.querySelector('.wf-full').getBoundingClientRect().width),
                 cols: shown ? [...tbl.querySelectorAll('thead th')]
                   .filter(t => !t.querySelector('.sr-only'))
                   .map(t => t.textContent.trim()).filter(Boolean) : [],
                 n: items.length,
                 /* Rows and drugs are no longer the same number: a drug with
                    an IV and an IM reviewed record is two rows. Both are
                    reported so an assertion can say which it means. */
                 nDrugs: new Set(items.map(e => {
                   const n = e.querySelector('.dtab-n, .dm-n');
                   return n ? n.textContent : ''; })).size,
                 names: items.map(e => {
                   const n = e.querySelector('.dtab-n, .dm-n');
                   return n ? n.textContent.trim() : ''; }),
                 /* The whole row, so an assertion can say WHICH record of a
                    drug was admitted rather than only that the drug was. */
                 rows: items.map(e => {
                   const q = sel => { const x = e.querySelector(sel);
                     return x ? x.textContent.replace(/\s+/g, ' ').trim() : ''; };
                   return { name:q('.dtab-n, .dm-n'), use:q('.dtab-u, .dm-u'),
                            rule:q('.dtab-r, .dm-r'), amount:q('.dtab-a, .dm-a'),
                            all:e.textContent.replace(/\s+/g, ' ').trim() }; }),
                 heights: items.slice(0,6).map(e => Math.round(e.getBoundingClientRect().height)),
                 toggle: !!document.querySelector('.dref-view'),
                 /* THE VALUES MUST NOT CHANGE WITH THE PRESENTATION. */
                 doses: items.map(e => {
                   const n = e.querySelector('.dtab-n, .dm-n');
                   const a = [...e.querySelectorAll('.dtab-d2, .dtab-au')]
                     .map(x => x.textContent).join('');
                   return (n ? n.textContent : '') + '=' + a; }),
                 overflowX:document.documentElement.scrollWidth -
                           document.documentElement.clientWidth,
                 tiny:[...body.querySelectorAll('button')]
                   .filter(b => b.offsetParent &&
                     b.getBoundingClientRect().height < (window.innerWidth <= 900 ? 40 : 30))
                   .map(b => b.className.split(' ')[0] + ':' +
                             Math.round(b.getBoundingClientRect().height)) };
      })()`);
      t(w + ': the reference renders the ' + MODES[w] + ' presentation',
        rr.mode === MODES[w], { mode:rr.mode, containerWidth:rr.refW });
      /* TWENTY DRUGS AND TWENTY-NINE ROWS, AND THE VOLATILE PACKAGE DID NOT
         CHANGE EITHER NUMBER. It briefly did. Sevoflurane, desflurane and
         isoflurane became reviewed records, the induction mount's scope still
         listed the volatile group from when that group held nothing
         publishable, and seven maintenance concentrations arrived here —
         23 drugs, 36 rows. That was a leak, not a widening.

         This mount is the reference INSIDE the induction workstation, above a
         board whose own note tells the clinician that no volatile induction
         dose is reviewed. Printing a volatile concentration there contradicts
         the sentence beside it. The group left iref's scope; the agents are
         published in the full Drug reference and in Maintenance, which is
         where a reviewed maintenance record belongs.

         So this pair is a BOUNDARY assertion now, not only a drift one. If it
         reads 23 and 36 again, the induction scope has re-acquired the
         volatile group and the boundary is gone.

         WAS: TWELVE DRUGS, SIXTEEN ROWS — twelve publishable drugs in the
         induction scope carrying nineteen reviewed records, three of which
         (propofol, fentanyl and rocuronium paediatric) are withheld from a
         44-year-old, leaving sixteen rendered rows.

         NOW: TWENTY DRUGS, TWENTY-NINE ROWS, and the arithmetic is the same
         arithmetic. Eight drugs were written as reviewed records in this pass
         — etomidate, thiopental, atropine, glycopyrrolate, IV lidocaine,
         alfentanil, atracurium, mivacurium — and one existing drug gained one
         record, suxamethonium's RSI dose. That is 34 publishable records over
         20 drugs. Five are outside this patient: the three paediatric rows
         above, glycopyrrolate paediatric, and propofol's new 65-and-over
         record, which a 44-year-old does not meet. 34 − 5 = 29.

         NOW THIRTY. Fentanyl gained one reviewed row in the strategy-regimen
         pass: the adult anaesthetic dose the SmPC actually states, 50-200 mcg
         in absolute units. The unreviewed 1-3 mcg/kg adult row it sits beside
         is unchanged and still rendered here, because the reference is a
         formulary and prints what the model holds — the difference is that a
         strategy may no longer auto-select the unreviewed one. 35 − 5 = 30.

         NOW THIRTY-TWO. Fentanyl gained a second reviewed row, the adult
         INDUCTION record 0.5-2 mcg/kg TBW, and this patient meets it. The
         50-200 mcg row is a spontaneous-respiration regimen and could never
         answer a controlled-airway induction, so the board printed nothing
         where the commonest opioid at induction should have had a number;
         the new record is what that gap is closed with. 36 − 5 = 31, and
         the row this patient gains over the old count is the thirty-second.

         MORPHINE IS STILL COUNTED HERE, and that is the boundary working.
         It left the induction BOARD in this pass — a composition decision
         taken in induction-catalog.js, because its only canonical dose is
         postoperative and the analgesia row was showing a permanent
         coverage line. The RECORD was not touched, so the reference, which
         is a formulary and not a board, still prints it. If this number
         ever drops by morphine's rows, a composition decision has reached
         the clinical model, which is the thing that must not happen.

         NO VOLATILE IS IN THIS COUNT. Sevoflurane gained an induction record
         and a place on the induction BOARD in the same pass; the induction
         drug REFERENCE scope was deliberately not widened to the volatile
         group, so no maintenance concentration entered this surface. If this
         number ever jumps by the size of the volatile group, that is what
         happened.

         NOW THIRTY-FOUR. Two records this pass, both for a 44-year-old:
         morphine's peri-induction row (0.1-0.15 mg/kg, the dose studied when
         given with induction) and dexmedetomidine's standard loading
         infusion (1 mcg/kg over 10 min). Its over-65 loading row exists too
         and is NOT counted here, because this patient is 44 and the
         reference withholds by age exactly as it withholds by population —
         which is the same invariant the elderly propofol row demonstrates
         below, now exercised by a second drug.

         The elderly row being absent HERE is the point of the count: the
         reference withholds by population exactly as the board does, so a
         number that included it would be evidence of a leak. The count that
         must not drift is the DRUG count; the row count is asserted beside it
         so an accidental duplicate still fails. */
      t(w + ': ...over all twenty-one drugs', rr.nDrugs === 21, rr.nDrugs);
      t(w + ': ...as thirty-four reviewed rows', rr.n === 34, rr.n);
      /* C. WAS: no volatile agent among them, at all. Sevoflurane holds a
            reviewed INDUCTION record now and this is an induction reference,
            so it belongs — and the rule that replaced the blanket is what is
            asserted instead: the only volatile admitted is one that answers
            the question this surface asks. Desflurane and isoflurane hold
            maintenance records only and must still be absent, and no
            maintenance concentration may appear for sevoflurane either. */
      t(w + ': ...and the only volatile among them is sevoflurane',
        !/desflurane|isoflurane|nitrous/i.test(rr.names.join(' ')),
        rr.names.filter(n => /desflurane|isoflurane|nitrous/i.test(n)));
      t(w + ': ...admitted for its induction titration, not a maintenance row',
        (() => { const sevo = rr.rows.filter(r => /sevoflurane/i.test(r.all || ''));
          return sevo.length === 1 && /Induction/.test(sevo[0].all) &&
                 /Start/.test(sevo[0].all) &&
                 !/0\.5.{0,3}3\s*%/.test(sevo[0].all); })(),
        rr.rows.filter(r => /sevoflurane/i.test(r.all || '')).map(r => r.all.slice(0, 120)));
      if (rr.mode === 'reduced')
        t(w + ': ...with Preparation folded into the detail, the rest kept',
          rr.cols.join('|') === 'Drug|Use|Dose|This patient', rr.cols);
      if (rr.mode !== 'list')
        t(w + ': ...at 40-64px a row', rr.heights.every(x => x >= 40 && x <= 64),
          rr.heights);
      else
        t(w + ': ...as compact rows, not full cards',
          rr.heights.every(x => x <= 130), rr.heights);
      t(w + ': ...no view-mode toggle anywhere', rr.toggle === false);
      t(w + ': ...and never scrolls the page sideways', rr.overflowX === 0, rr.overflowX);
      t(w + ': ...with no control below its target size', rr.tiny.length === 0, rr.tiny);
      t(w + ': ...and no runtime errors', v.errs.length === 0, v.errs.slice(0,2));
      RESP[w] = rr.doses;
      await v.ctx.close();
    }
    /* THE PRESENTATION IS A VIEW. Every width prints the same drug names and
       the same patient amounts, or one of them is doing arithmetic. */
    {
      const ws = Object.keys(RESP);
      const ref = RESP[ws[0]];
      const bad = ws.filter(w => JSON.stringify(RESP[w]) !== JSON.stringify(ref));
      t('every width prints identical clinical values',
        bad.length === 0, { widths:ws, disagreed:bad });
    }

    /* ── THE INDUCTION VOLATILE BOUNDARY, RENDERED ───────────────────────
       maintenance-content.test.js proves the four gates as properties of the
       model and of engine.html's source. This proves the consequence on the
       actual page: the agents are absent from the induction reference by
       every path including an explicit search, present in the full Drug
       reference where a reviewed record belongs, and carry no route into the
       selected drug plan from either. */
    {
      const v = await open(b, 1440, 1250);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(650);
      /* One helper, defined in the page, used by every probe below so that
         the induction mount and the full mount are read the same way. */
      const ROWS = `const rowsIn = sel => [...document.querySelectorAll(
          sel + ' tr.dtab-r, ' + sel + ' .dcard')];
        const namesIn = sel => rowsIn(sel).map(e => {
          const n = e.querySelector('.dtab-n, .dm-n'); return n ? n.textContent.trim() : ''; });
        const VOL = /sevoflurane|desflurane|isoflurane/i;`;

      /* C. WAS: the default induction reference contains no volatile agent.
            The rule it stood for was that a maintenance concentration may not
            reach an induction surface, and that still holds — what changed is
            that sevoflurane has a reviewed INDUCTION record and the surface
            admits volatiles by phase rather than excluding the group. So the
            claim becomes: sevoflurane yes, and only its induction row; the
            two agents with maintenance records only, no. */
      const idef = await v.pg.evaluate(`(() => {
        ${ROWS}
        const names = namesIn('#iref-body');
        const sevo = rowsIn('#iref-body')
          .filter(e => /sevoflurane/i.test(e.textContent))
          .map(e => e.textContent.replace(/\s+/g, ' ').trim());
        return { names, sevo,
                 other:names.filter(n => /desflurane|isoflurane|nitrous/i.test(n)) };
      })()`);
      t('C. the induction reference admits sevoflurane, for its induction row',
        idef.sevo.length === 1 && /Induction/.test(idef.sevo[0]) &&
        /Start/.test(idef.sevo[0]) && !/0\.5.{0,3}3\s*%/.test(idef.sevo[0]),
        idef.sevo.map(x => x.slice(0, 110)));
      t('C. ...and admits no volatile that holds maintenance records only',
        idef.other.length === 0, idef.other);

      /* D. And an explicit search does not widen it. Each agent is typed into
            the induction reference's own search box; the correct answer is an
            empty result, because drefRows() intersects the query with the
            mount's scope rather than reaching past it into the index. The
            same query is run against the FULL reference in the same breath,
            so a zero here is proved to be the scope and not a broken search. */
      /* Sevoflurane is deliberately absent from this loop: it is IN the
         induction scope now, and asserting a search for it returns nothing
         would assert the opposite of what section C just proved. The two
         agents that hold maintenance records only are still unreachable, and
         a search is how a clinician would try hardest to reach them. */
      for (const q of ['desflurane', 'isoflurane']) {
        const r = await v.pg.evaluate(`(async () => {
          ${ROWS}
          const set = (id, val) => { const el = document.getElementById(id);
            if (!el) return false;
            el.value = val; el.dispatchEvent(new Event('input', { bubbles:true }));
            return true; };
          const okI = set('iref-q', ${JSON.stringify(q)});
          const okF = set('dref-q', ${JSON.stringify(q)});
          await new Promise(r => setTimeout(r, 300));
          return { boxes:[okI, okF],
                   induction:namesIn('#iref-body'),
                   full:namesIn('#dref-body'),
                   fullUse:rowsIn('#dref-body')
                     .filter(e => VOL.test((e.querySelector('.dtab-n, .dm-n')||{}).textContent||''))
                     .map(e => e.querySelectorAll('[data-plan-for]').length)
                     .reduce((a, b) => a + b, 0) };
        })()`);
        t('D. both search boxes exist, so an empty result means the scope',
          r.boxes[0] === true && r.boxes[1] === true, r.boxes);
        t('D. searching "' + q + '" in the induction reference returns nothing',
          r.induction.length === 0, r.induction);
        /* F. the same query in the full reference DOES find it. */
        t('F. ...while the full Drug reference finds it',
          r.full.some(n => new RegExp(q, 'i').test(n)), r.full.slice(0, 4));
        /* E. and the row it finds offers no USE control. */
        t('E. ...and that row carries no USE control',
          r.fullUse === 0, r.fullUse);
      }

      /* E, stated once more over the whole surface: every [data-plan-for] on
         the page belongs to a drug whose group maps to a plan role, and no
         volatile id is among them. This is the assertion that fails if
         DREF_ROLE_GROUP ever gains a volatile entry. */
      const plan = await v.pg.evaluate(`(() => {
        const ids = [...document.querySelectorAll('[data-plan-for]')]
          .map(e => e.getAttribute('data-plan-for'));
        return { total:ids.length,
                 volatile:ids.filter(id => /sevoflurane|desflurane|isoflurane/i.test(id)) };
      })()`);
      t('E. no volatile agent is addable to the selected drug plan, anywhere on the page',
        plan.volatile.length === 0 && plan.total > 0, plan);
      t('...and no runtime errors through any of it', v.errs.length === 0, v.errs.slice(0,2));
      await v.ctx.close();
    }

    /* ── THE ACCESS MODEL IS UNCHANGED BY ANY OF IT ── */
    const IDS3 = {
      anonymous:{ role:'anon', profile:null },
      patient:{ role:'session', profile:{ role:'patient',
        verification_status:'not_required', full_name:'Pat' } }
    };
    for (const k of Object.keys(IDS3)) {
      const v = await open(b, 1440, 1150, IDS3[k]);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(650);
      const a = await v.pg.evaluate(`(() => {
        const body = document.getElementById('iref-body');
        return { url:location.pathname,
                 rows:body ? body.querySelectorAll('tr.dtab-r').length : 0,
                 search:!!document.getElementById('iref-q'),
                 tools:!!document.getElementById('ctools-b'),
                 addable:body ? body.querySelectorAll('[data-plan-for]').length : 0,
                 newPatientVisible:(() => { const n = document.querySelector('.case-np');
                   return !!(n && n.offsetParent); })() };
      })()`);
      t(k + ': the reference is fully usable without logging in',
        a.rows > 6 && a.search === true && a.tools === true, a);
      t(k + ': ...Add to plan is offered — it is clinical, not patient data',
        a.addable > 0, a.addable);
      t(k + ': ...no redirect', a.url === '/engine.html', a.url);
      t(k + ': ...and no doctor-only action is granted by the reference',
        a.newPatientVisible === false, a.newPatientVisible);
      await v.ctx.close();
    }
    /* ══ ONE USING ROW PER SELECTED DRUG, WHICHEVER DRUG IT IS ══════════
       The plan stores drug ids and nothing else, which is correct — "this
       drug is being used" is what a clinician declared. The reference draws
       one row per DOSE, so asking the plan alone marked EVERY row of a
       selected drug as in use: rocuronium's routine 0.6 mg/kg read "USING"
       under a rapid sequence, beside the RSI row that was actually answering.

       The active row is DERIVED at paint time from the board's own resolver
       and compared by drefRowKey, so it moves with the patient and the
       strategy and there is no stored row to go stale.

       THIS TEST DISCOVERS ITS OWN SUBJECTS. It asks the rendered table which
       drugs have more than one selectable row rather than carrying a list,
       so a fix that only satisfied fentanyl or dexmedetomidine would fail
       here the moment any other multi-row drug was selected. */
    {
      const v = await open(b, 1536, 1300);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(700);
      await v.pg.evaluate(`setDomain('drugs')`); await v.pg.waitForTimeout(700);

      const multi = await v.pg.evaluate(`(() => {
        const by = {};
        [...document.querySelectorAll('#dref-body tr.dtab-r')].forEach(r => {
          const btn = r.querySelector('.dtab-plus[data-plan-for]'); if (!btn) return;
          (by[btn.getAttribute('data-plan-for')] =
            by[btn.getAttribute('data-plan-for')] || []).push(1); });
        return Object.keys(by).filter(k => by[k].length > 1); })()`);
      t('the reference has multi-row drugs to test, discovered not listed',
        multi.length >= 6, { found:multi.length, drugs:multi.slice(0, 4) });

      const seen = [];
      for (const id of multi) {
        const r = await v.pg.evaluate(`(() => {
          const I = window.Induction;
          I.clear(); I.setTechnique('iv');
          const role = window.drefRoleOf(${JSON.stringify(id)});
          if (!role) return { skipped:true };
          if (I.plan.indexOf(${JSON.stringify(id)}) < 0) I.toggle(role, ${JSON.stringify(id)});
          drefSyncPlan();
          const rows = [...document.querySelectorAll('#dref-body tr.dtab-r')]
            .filter(x => x.querySelector('.dtab-plus[data-plan-for=' +
                     JSON.stringify(${JSON.stringify(id)}) + ']'));
          const st = rows.map(x => x.querySelector('.dtab-plus')
                                    .getAttribute('data-plan-state'));
          const active = I.activeRowFor ? I.activeRowFor(${JSON.stringify(id)}) : null;
          return { id:${JSON.stringify(id)}, rows:rows.length,
                   using:st.filter(x => x === 'using').length,
                   plan:st.filter(x => x === 'plan').length,
                   none:st.filter(x => x === 'none').length,
                   resolvable: !!active,
                   entries:I.plan.filter(x => x === ${JSON.stringify(id)}).length,
                   pressed:rows.every(x => x.querySelector('.dtab-plus')
                     .getAttribute('aria-pressed') === 'true') }; })()`);
        if (!r.skipped) seen.push(r);
      }
      t('...every one of them was actually exercised',
        seen.length === multi.length && seen.length > 0,
        { exercised:seen.length, of:multi.length });
      /* THE CORE CLAIM, over every multi-row drug the table holds. */
      t('a selected multi-row drug marks EXACTLY ONE row as USING',
        seen.filter(r => r.resolvable).every(r => r.using === 1),
        seen.filter(r => r.resolvable && r.using !== 1)
            .map(r => r.id + ':' + r.using));
      t('...and its other rows read IN PLAN, never USING',
        seen.filter(r => r.resolvable)
            .every(r => r.plan === r.rows - 1 && r.none === 0),
        seen.filter(r => r.resolvable && r.plan !== r.rows - 1)
            .map(r => r.id + ':' + r.plan + '/' + r.rows));
      /* WHERE NO ACTIVE ROW CAN BE RESOLVED, NOTHING CLAIMS TO BE ONE. */
      t('...while a drug with no resolvable active row claims no USING row',
        seen.filter(r => !r.resolvable).every(r => r.using === 0),
        seen.filter(r => !r.resolvable).map(r => r.id + ':' + r.using));
      /* THE PLAN NEVER GAINS A SECOND ENTRY, whichever row was pressed. */
      t('...and the drug is in the plan exactly once throughout',
        seen.every(r => r.entries === 1), seen.map(r => r.id + ':' + r.entries));
      /* ARIA IS HONEST: pressed is true on every row of a selected drug,
         because pressing any of them removes that drug. The label carries
         the distinction, not a false pressed=false. */
      t('...with aria-pressed true on every row of a selected drug',
        seen.every(r => r.pressed === true), seen.filter(r => !r.pressed).map(r => r.id));

      /* SINGLE-ROW DRUGS ARE UNCHANGED. */
      const single = await v.pg.evaluate(`(() => {
        const I = window.Induction; I.clear(); I.setTechnique('iv');
        const by = {};
        [...document.querySelectorAll('#dref-body tr.dtab-r')].forEach(r => {
          const btn = r.querySelector('.dtab-plus[data-plan-for]'); if (!btn) return;
          (by[btn.getAttribute('data-plan-for')] =
            by[btn.getAttribute('data-plan-for')] || []).push(r); });
        /* A drug the IV preset has NOT already selected, or the probe would
           be measuring a removal rather than a selection. */
        const one = Object.keys(by).filter(k => by[k].length === 1);
        const id = one.find(k => window.drefRoleOf(k) && I.plan.indexOf(k) < 0);
        if (!id) return { none:true };
        const before = by[id][0].querySelector('.dtab-plus')
                         .getAttribute('data-plan-state');
        I.toggle(window.drefRoleOf(id), id); drefSyncPlan();
        const btn = document.querySelector('.dtab-plus[data-plan-for="' + id + '"]');
        return { id, before, after:btn.getAttribute('data-plan-state'),
                 label:btn.textContent.trim() }; })()`);
      t('a single-row drug still reads USE then USING, unchanged',
        single.before === 'none' && single.after === 'using' &&
        /USING/.test(single.label), single);
      await v.ctx.close();
    }

    /* ══ DURATION: STRUCTURED IN THE MODEL, NOT DUPLICATED ON SCREEN ════
       Dexmedetomidine's loading infusions are given over 10 minutes. The
       time is part of the instruction, so rowFor folds it into the dose
       rule — and the row keeps `duration` as its own field, because that is
       clinical data and not a rendering choice.

       THE Dur. COLUMN IS THE RENDERER'S DECISION. drefHasDuration() draws it
       only for a duration the Dose cell does not already carry, so the same
       phrase is not printed twice a column apart. The last assertion is the
       one that makes this meaningful: a synthetic row whose duration is NOT
       in its rule must still light the column, or the policy could have been
       "never show duration" and passed on today's dataset by luck. */
    {
      const v = await open(b, 1536, 1200);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(700);
      await v.pg.evaluate(`setDomain('drugs')`); await v.pg.waitForTimeout(700);
      await v.pg.evaluate(`drefSet('dref','q','dexmedetomidine')`);
      await v.pg.waitForTimeout(800);
      const d = await v.pg.evaluate(`(() => {
        const heads = [...document.querySelectorAll('#dref-body table.dtab thead th')]
          .map(e => e.textContent.trim());
        const rows = [...document.querySelectorAll('#dref-body tr.dtab-r')]
          .map(r => [...r.querySelectorAll('td')].map(c => c.textContent.trim()));
        return { heads, rows,
          durCells: document.querySelectorAll('#dref-body .dtab-dur').length,
          /* the renderer's policy, exercised directly */
          inlineOnly: drefHasDuration([
            { duration:'over 10 min', doseRule:'1 mcg/kg over 10 min' }]),
          notInline: drefHasDuration([
            { duration:'4\u20136 h', doseRule:'0.6 mg/kg TBW' }]),
          none: drefHasDuration([{ doseRule:'2\u20132.5 mg/kg TBW' }]) }; })()`);
      const loading = d.rows.find(r => r.join(' ').indexOf('Loading') >= 0) || [];
      t('the dexmedetomidine Dose cell carries the time with the figure',
        loading.some(c => /1\s*mcg\/kg over 10 min/.test(c)), loading.slice(0, 4));
      t('...and no separate Dur. column repeats it',
        d.heads.indexOf('Dur.') < 0 && d.durCells === 0,
        { heads:d.heads, durCells:d.durCells });
      /* THE GUARD AGAINST A VACUOUS POLICY. */
      t('...while a duration NOT already in the rule still activates the column',
        d.notInline === true, d.notInline);
      t('...and one already in the rule does not, nor does no duration at all',
        d.inlineOnly === false && d.none === false,
        { inlineOnly:d.inlineOnly, none:d.none });
      await v.ctx.close();
    }

    /* ══ THE WARNING DISCLOSURE IS THE WARNING SURFACE ═══════════════════
       The trigger used to carry the whole clinical warning in a native
       title attribute. A title is plain text by specification, so nitrous
       oxide's section headings reached the clinician as literal <b> and
       <br>, and suxamethonium's &gt; and neostigmine's &ge; as literal
       entity strings. The disclosure the same button opens has always
       rendered that string correctly, so the fix was to delete the title
       rather than to build a second renderer.

       Nitrous oxide lives in the volatile group, which the induction
       reference admits only at phase 'induction' — it has no such record,
       so it is not on that surface. The FULL Drug reference is where it
       renders, and setDomain('drugs') is what puts that panel on screen. */
    {
      const v = await open(b, 1536, 1200);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(700);
      await v.pg.evaluate(`setDomain('drugs')`); await v.pg.waitForTimeout(700);

      const probe = async (q, needle) => {
        await v.pg.evaluate(`drefSet('dref','q',` + JSON.stringify(q) + `)`);
        await v.pg.waitForTimeout(700);
        return v.pg.evaluate(`(() => {
          const btn = document.querySelector('#dref-body .dtab-wi');
          if (!btn) return { noBtn:true };
          const out = { title:btn.getAttribute('title'),
                        aria:(btn.getAttribute('aria-label')||'').trim(),
                        visible: btn.offsetParent !== null,
                        expanded0:btn.getAttribute('aria-expanded') };
          btn.click();
          out.expanded1 = btn.getAttribute('aria-expanded');
          const box = [...document.querySelectorAll('#dref-body .dtab-warn')]
            .find(e => e.textContent.indexOf(` + JSON.stringify(needle) + `) >= 0);
          if (box) {
            const span = box.querySelector('span:last-child');
            const r = span.getBoundingClientRect(), cs = getComputedStyle(span);
            out.b = box.querySelectorAll('b').length;
            out.br = box.querySelectorAll('br').length;
            out.text = box.textContent;
            out.spanW = Math.round(r.width);
            out.maxWidth = cs.maxWidth;
            out.rightInside = Math.round(r.right) <= window.innerWidth + 1;
            out.overflowX = Math.max(0, document.documentElement.scrollWidth -
                                        document.documentElement.clientWidth);
          }
          btn.click(); out.expanded2 = btn.getAttribute('aria-expanded');
          return out; })()`);
      };

      const n2o = await probe('nitrous', 'AVOID, CLOSED GAS SPACES');
      t('the warning trigger carries NO title attribute',
        n2o.title === null, n2o.title);
      t('...but keeps a non-empty accessible name',
        /^Caution for /.test(n2o.aria) && n2o.aria.length > 12, n2o.aria);
      t('...and aria-expanded tracks open and closed',
        n2o.expanded0 === 'false' && n2o.expanded1 === 'true' &&
        n2o.expanded2 === 'false',
        [n2o.expanded0, n2o.expanded1, n2o.expanded2]);
      /* The counts are tied to the reviewed nitrous record as it stands:
         four headings, three separators. If that content is legitimately
         re-written the numbers move with it, and this failing is the
         correct outcome — it names the record it is pinned to. */
      t('NITROUS OXIDE renders four bold headings and three line breaks',
        n2o.b === 4 && n2o.br === 3, { b:n2o.b, br:n2o.br });
      t('...with no literal <b or <br anywhere in the rendered text',
        n2o.text.indexOf('<b') < 0 && n2o.text.indexOf('<br') < 0,
        n2o.text.slice(0, 90));
      t('...and its line length is capped at a readable measure',
        n2o.maxWidth !== 'none' && n2o.spanW <= 520 && n2o.spanW > 300,
        { spanW:n2o.spanW, maxWidth:n2o.maxWidth });
      t('...inside the viewport, with no horizontal overflow',
        n2o.rightInside === true && n2o.overflowX === 0,
        { rightInside:n2o.rightInside, overflowX:n2o.overflowX });

      /* ENTITIES DECODE. These two records are the whole entity corpus. */
      const sux = await probe('suxamethonium', 'hyperkalaemia');
      t('SUXAMETHONIUM shows > as a character, not &gt;',
        sux.text.indexOf('>24 h') >= 0 && sux.text.indexOf('&gt;') < 0,
        sux.text.replace(/\s+/g,' ').trim().slice(0, 80));
      t('...and its trigger carries no title either',
        sux.title === null && /^Contraindication for /.test(sux.aria), sux.aria);
      const neo = await probe('neostigmine', 'TOF count');
      t('NEOSTIGMINE shows \u2265 as a character, not &ge;',
        neo.text.indexOf('\u2265') >= 0 && neo.text.indexOf('&ge;') < 0,
        neo.text.replace(/\s+/g,' ').trim().slice(0, 80));
      await v.ctx.close();
    }

    /* The disclosure must stay inside the viewport and keep wrapping at the
       widths the workstation is used at — the native tooltip it replaced
       could not be constrained at all. */
    for (const w of [1536, 1194, 390]) {
      const v = await open(b, w, 1100);
      await fill(v.pg, ADULT); await v.pg.waitForTimeout(700);
      await v.pg.evaluate(`setDomain('drugs')`); await v.pg.waitForTimeout(600);
      await v.pg.evaluate(`drefSet('dref','q','nitrous')`); await v.pg.waitForTimeout(700);
      const m = await v.pg.evaluate(`(() => {
        const btn = document.querySelector('#dref-body .dtab-wi');
        if (!btn) return { noBtn:true };
        btn.click();
        const box = [...document.querySelectorAll('#dref-body .dtab-warn')]
          .find(e => /AVOID, CLOSED GAS SPACES/.test(e.textContent));
        if (!box) return { noBox:true };
        const span = box.querySelector('span:last-child');
        const r = span.getBoundingClientRect(), cs = getComputedStyle(span);
        return { w:Math.round(r.width), h:Math.round(r.height),
                 lines: Math.round(r.height / parseFloat(cs.lineHeight)),
                 rightInside: Math.round(r.right) <= window.innerWidth + 1,
                 overflowX: Math.max(0, document.documentElement.scrollWidth -
                                        document.documentElement.clientWidth),
                 fitsContainer: Math.round(r.width) <= Math.round(
                   box.getBoundingClientRect().width) + 1 }; })()`);
      t(w + ': the open warning stays inside the viewport',
        m.rightInside === true && m.overflowX === 0, m);
      t(w + ': ...and wraps rather than running off',
        m.lines >= 8 && m.fitsContainer === true, m);
      await v.ctx.close();
    }
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
