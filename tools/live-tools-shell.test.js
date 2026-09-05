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
    const s = await open(b, 1440, 1250);
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
      /42y/.test(bar.caseLine) && /Male/.test(bar.caseLine) && /75 kg/.test(bar.caseLine) &&
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
      const add = id => {
        if (!document.querySelector('#induction-host .pl-chooser'))
          document.querySelector('#induction-host .pl-add').click();
        document.querySelector('#induction-host [data-alt="'+id+'"]').click();
      };
      add('drug.propofol'); add('drug.rocuronium');
      document.querySelector('#induction-host .pl-add').click();
      const planBefore = [...document.querySelectorAll('#induction-host .pl-sel-n')]
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
        planVisible:[...document.querySelectorAll('#induction-host .pl-sel-n')].map(e => e.textContent),
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
      o.planAfterSwitch = [...document.querySelectorAll('#induction-host .pl-sel-n')]
        .map(e => e.textContent);
      crisisPreviewClose();
      o.gridClosed = getComputedStyle(document.querySelector('.ws-grid')).gridTemplateColumns;
      o.planAfterClose = [...document.querySelectorAll('#induction-host .pl-sel-n')]
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
    /* The column widens to read a protocol and returns to a list width.
       The two widths changed with the workstation geometry (330 resting, 350
       reading); what is asserted is the RELATIONSHIP and the specified band,
       not a pair of remembered numbers. */
    const px = g => parseFloat((g.trim().split(/\s+/).pop() || '0'));
    t('the rail widens for a protocol and narrows again',
      px(rail.gridOpen) > px(rail.gridClosed) &&
      px(rail.gridClosed) >= 320 && px(rail.gridOpen) <= 350,
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
      const add = id => {
        if (!document.querySelector('#induction-host .pl-chooser'))
          document.querySelector('#induction-host .pl-add').click();
        document.querySelector('#induction-host [data-alt="'+id+'"]').click();
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
      document.querySelector('#induction-host .pl-add').click();
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
        document.querySelector('.wf-lead'), document.querySelector('.wf-cols')].filter(Boolean);
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

      /* a card must not be stretched to a taller sibling's height */
      const cards = [...document.querySelectorAll('#induction-host .pl-grid .pl-sel')];
      const rows = {};
      cards.forEach(c => { const y = Math.round(bb(c).top); rows[y] = (rows[y]||0) + 1; });
      const heights = cards.map(c => Math.round(bb(c).height));

      return { gaps, slack,
        emptyCells: [...document.querySelectorAll('#induction-host .pl-grid > *, ' +
          '.wf-col-side .awp-grid > *, .wf-full #iref-body tr.dtab-r')]
          .filter(e => !e.textContent.trim()).length,
        cards: cards.length, perRow: Object.values(rows),
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
    t('three agents fit one row at 1440', dens.cards === 3 &&
      dens.perRow.length === 1 && dens.perRow[0] === 3, dens.perRow);
    /* WAS: "a lone card is not stretched to a sibling's height". Cards in a
       row are now deliberately bottom-aligned — a three-line warning on one
       agent should not leave the row staggered — so equal HEIGHTS are the
       intent. What must never be stretched is WIDTH, and that is asserted by
       the packing geometry below. */
    t('...and every card is its own width, not the column\'s',
      dens.cardWidths.every(w => w <= 160), dens.cardWidths);
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
    console.log('\nAGENT ROW PACKING');
    const pack = await s.pg.evaluate(`(() => {
      const add = id => {
        if (!document.querySelector('#induction-host .pl-chooser'))
          document.querySelector('#induction-host .pl-add').click();
        document.querySelector('#induction-host [data-alt="'+id+'"]').click();
      };
      const close = () => { if (document.querySelector('#induction-host .pl-chooser'))
        document.querySelector('#induction-host .pl-add').click(); };
      const IDS = ['drug.propofol','drug.fentanyl','drug.rocuronium',
                   'drug.ketamine','drug.midazolam'];
      const out = {};
      [1,2,3,4,5].forEach(n => {
        if (window.Induction) window.Induction.clearPlan();
        IDS.slice(0, n).forEach(add);
        close();
        const box = document.querySelector('#induction-host .pl-grid');
        const bb = box.getBoundingClientRect();
        const cards = [...box.querySelectorAll('.pl-sel')].map(c => {
          const r = c.getBoundingClientRect();
          return { name:(c.querySelector('.pl-sel-n')||{}).textContent,
                   l:+r.left.toFixed(1), r:+r.right.toFixed(1), t:+r.top.toFixed(1),
                   w:+r.width.toFixed(1), h:+r.height.toFixed(1) };
        });
        const rows = {};
        cards.forEach(c => { rows[Math.round(c.t)] = (rows[Math.round(c.t)] || 0) + 1; });
        const rowTops = Object.keys(rows).map(Number).sort((a,b) => a-b);
        /* gaps only between cards that share a row */
        const gaps = [];
        for (let i = 1; i < cards.length; i++)
          if (Math.round(cards[i].t) === Math.round(cards[i-1].t))
            gaps.push(+(cards[i].l - cards[i-1].r).toFixed(1));
        const firstRow = cards.filter(c => Math.round(c.t) === rowTops[0]);
        out[n] = { cards, gaps,
          perRow: rowTops.map(t => rows[t]),
          rowTops,
          leading:+(cards[0].l - bb.left).toFixed(1),
          trailing:+(bb.right - firstRow[firstRow.length-1].r).toFixed(1),
          containerW:+bb.width.toFixed(1),
          rowGap: rowTops.length > 1
            ? +(rowTops[1] - Math.max(...firstRow.map(c => c.t + c.h))).toFixed(1) : null,
          bottomsAligned: firstRow.every(c =>
            Math.abs((c.t + c.h) - (firstRow[0].t + firstRow[0].h)) < 1.5) };
      });
      if (window.Induction) window.Induction.clearPlan();
      return out;
    })()`);

    const P3 = pack[3];
    t('3 agents: all three share one row', P3.perRow.length === 1 && P3.perRow[0] === 3,
      P3.perRow);
    t('3 agents: in the order they were added, left to right',
      P3.cards.map(c => c.name).join(' ') === 'Propofol Fentanyl Rocuronium' &&
      P3.cards[0].r <= P3.cards[1].l && P3.cards[1].r <= P3.cards[2].l,
      P3.cards.map(c => c.name + '@' + c.l));
    /* THE ASSERTION THAT WAS MISSING. */
    t('3 agents: card-to-card gaps are 4-10px, not distributed whitespace',
      P3.gaps.length === 2 && P3.gaps.every(g => g >= 4 && g <= 10), P3.gaps);
    t('3 agents: nothing overlaps', P3.gaps.every(g => g > 0), P3.gaps);
    t('3 agents: packed hard against the left edge', P3.leading === 0, P3.leading);
    /* The leftover belongs after the last card. With three 150px cards and
       two 8px gaps in a 488px column that is 22px — it must not have been
       shared out between them. */
    t('3 agents: the leftover width sits AFTER the last card',
      P3.trailing > 0 &&
      Math.abs(P3.containerW - (P3.cards.reduce((a,c) => a + c.w, 0) + 16 + P3.trailing)) < 1.5,
      { trailing:P3.trailing, container:P3.containerW, cards:P3.cards.map(c => c.w) });
    t('3 agents: no card is narrower than the readable minimum',
      P3.cards.every(c => c.w >= 140), P3.cards.map(c => c.w));
    t('3 agents: bottoms align across the row', P3.bottomsAligned === true,
      P3.cards.map(c => +(c.t + c.h).toFixed(1)));

    t('1 agent: one normal-width card at the left, not stretched across',
      pack[1].cards.length === 1 && pack[1].leading === 0 &&
      pack[1].cards[0].w <= 160 && pack[1].trailing > 200,
      { w:pack[1].cards[0].w, trailing:pack[1].trailing });
    t('2 agents: adjacent, 4-10px apart, leftover after the second',
      pack[2].perRow.join() === '2' && pack[2].gaps.length === 1 &&
      pack[2].gaps[0] >= 4 && pack[2].gaps[0] <= 10 && pack[2].trailing > 100,
      { gaps:pack[2].gaps, trailing:pack[2].trailing });
    /* 4 and 5 wrap, and the next row starts directly underneath. */
    t('4 agents: wrap to a second row with no reserved holes',
      pack[4].perRow.join() === '3,1' && pack[4].gaps.every(g => g >= 4 && g <= 10),
      { perRow:pack[4].perRow, gaps:pack[4].gaps });
    t('5 agents: three then two, still packed left',
      pack[5].perRow.join() === '3,2' && pack[5].leading === 0 &&
      pack[5].gaps.every(g => g >= 4 && g <= 10),
      { perRow:pack[5].perRow, gaps:pack[5].gaps });
    t('...and the wrapped row sits about 8px below the first',
      pack[5].rowGap !== null && pack[5].rowGap >= 4 && pack[5].rowGap <= 10,
      pack[5].rowGap);
    /* NO MECHANISM THAT DISTRIBUTES FREE SPACE MAY COME BACK. The grid only
       exists once something is in the plan, so this puts an agent there
       first rather than reading a container that is not rendered. */
    const mech = await s.pg.evaluate(`(() => {
      const c = document.querySelector('#induction-host .pl-add');
      if (!document.querySelector('#induction-host .pl-chooser')) c.click();
      document.querySelector('#induction-host [data-alt="drug.propofol"]').click();
      c.click();
      const box = getComputedStyle(document.querySelector('#induction-host .pl-grid'));
      const card = getComputedStyle(document.querySelector('#induction-host .pl-sel'));
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
      const add = id => {
        if (!document.querySelector('#induction-host .pl-chooser'))
          document.querySelector('#induction-host .pl-add').click();
        document.querySelector('#induction-host [data-alt="'+id+'"]').click();
      };
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
      set('i-asa','II'); set('i-proc','Laparoscopic cholecystectomy');
      compute(); if (window.ptSummary) ptSummary();
      document.getElementById('app').classList.remove('pt-open');
      if (window.Induction) window.Induction.clearPlan();
      add('drug.propofol'); add('drug.fentanyl'); add('drug.rocuronium');
      document.querySelector('#induction-host .pl-add').click();
      const R = e => { const b = e.getBoundingClientRect();
        return { t:Math.round(b.top), b:Math.round(b.bottom), h:Math.round(b.height),
                 w:Math.round(b.width) }; };

      /* A · the timer rail must be sized by its timers, not stretched */
      const rail = document.querySelector('.ws-rail');
      const cards = [...rail.querySelectorAll('.lt-card')];
      const last = cards.length ? cards[cards.length-1] : null;
      const rs = getComputedStyle(rail);

      /* B · Add agent must never take a row of its own */
      const addBtn = document.querySelector('#induction-host .pl-add');
      const techRow = document.querySelector('#induction-host .pl-tech');
      const head = document.querySelector('#induction-host .wf-col-main .wf-h');
      const card1 = document.querySelector('#induction-host .pl-grid .pl-sel');

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
        add: { box:R(addBtn), inHeading: head.contains(addBtn),
               belowTechRow: R(addBtn).t >= R(techRow).b - 2,
               overlapsTech: !(R(addBtn).b <= R(techRow).t || R(addBtn).t >= R(techRow).b),
               firstCardTop: card1 ? R(card1).t : null,
               techBottom: R(techRow).b, visible: !!addBtn.offsetParent },
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
      await s.pg.setViewportSize({ width:1440, height:1700 });
      await s.pg.waitForTimeout(400);
      const r = await s.pg.evaluate(`(() => {
        const i = document.querySelector('.wf-full .idref');
        return { cap:Math.round(parseFloat(getComputedStyle(i).maxHeight)),
                 h:Math.round(i.getBoundingClientRect().height) };
      })()`);
      await s.pg.setViewportSize({ width:1440, height:1250 });
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

    /* An empty plan must be dense too — not three empty role containers. */
    const emptyPlan = await s.pg.evaluate(`(() => {
      if (window.Induction) window.Induction.clearPlan();
      const host = document.getElementById('induction-host');
      const sec = host.querySelector('.wf-col-main .wf-sec');
      return { h:Math.round(sec.getBoundingClientRect().height),
               cards:host.querySelectorAll('.pl-sel').length,
               chooser:host.querySelectorAll('.pl-chooser').length,
               add:host.querySelectorAll('.pl-add').length,
               says:(host.querySelector('.pl-empty')||{}).textContent || '' };
    })()`);
    t('an empty plan is a compact empty state, not three empty containers',
      emptyPlan.cards === 0 && emptyPlan.chooser === 0 && emptyPlan.add === 1 &&
      emptyPlan.h < 200, emptyPlan);
    t('...and it says so', /No agents selected/i.test(emptyPlan.says), emptyPlan.says);

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
        /42y/.test(r.caseText) && /75 kg/.test(r.caseText) &&
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
      const m = await v.pg.evaluate(`(() => {
        const add = id => {
          if (!document.querySelector('#induction-host .pl-chooser'))
            document.querySelector('#induction-host .pl-add').click();
          document.querySelector('#induction-host [data-alt="'+id+'"]').click();
        };
        add('drug.propofol');
        document.querySelector('#induction-host .pl-add').click();
        const plan = () => [...document.querySelectorAll('#induction-host .pl-sel-n')]
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
      t('390: ...and sits on top of no clinical control', m.covered === 0, m.covered);
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
      const indic   = go('rapid sequence');
      const fuzzy   = go('propofl');
      const none    = go('zzzznotadrug');
      go('');
      const after = doses();
      return { generic, alias, trade, klass, indic, fuzzy, none,
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
    t('search finds drugs by class', [...new Set(srch.klass)].length === 3 &&
      srch.klass.indexOf('Fentanyl') >= 0 && srch.klass.indexOf('Remifentanil') >= 0,
      srch.klass);
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
      const offered = [...document.querySelectorAll('#iref-body tr.dtab-r')]
        .map(r => ({ id:r.dataset.drug, has:!!r.querySelector('[data-plan-for]') }));
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
    /* THE MODEL DECIDES WHAT MAY BE PLANNED, NOT THE TABLE. */
    t('...and only canonical induction-compatible groups are offered it',
      plan.offered.every(o => o.has === /^drug\.(propofol|ketamine|midazolam|dexmedetomidine|fentanyl|morphine|remifentanil|rocuronium|suxamethonium)$/.test(o.id)),
      plan.offered.filter(o => o.has).map(o => o.id));

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
      const planStillVisible = !!document.querySelector('#induction-host .pl-sel');
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
      /* TWELVE DRUGS, SIXTEEN ROWS. The induction scope holds twelve
         publishable drugs and, since the Tier 1 migration, sixteen reviewed
         dose records among them — ketamine IV and IM, rocuronium routine and
         RSI, remifentanil infusion, induction infusion and bolus. The count
         that must not drift is the DRUG count; the row count is asserted
         beside it so an accidental duplicate still fails. */
      t(w + ': ...over all twelve drugs', rr.nDrugs === 12, rr.nDrugs);
      t(w + ': ...as sixteen reviewed rows', rr.n === 16, rr.n);
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
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
