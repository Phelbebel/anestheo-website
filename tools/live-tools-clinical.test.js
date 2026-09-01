#!/usr/bin/env node
/* live-tools-clinical.test.js
 *
 * TWO CLINICAL SAFETY LAYERS IN LIVE TOOLS.
 *
 * ── ONE: OBSTETRIC CONTEXT IS NEVER INFERRED ──────────────────────────────
 * The page used to decide obstetric content with a regex whose match list
 * included `hysterect` and `gyn`. A woman having a hysterectomy was therefore
 * shown Caesarean spinal dosing, labour epidural mixes and uterotonics,
 * because a gynaecological field had been read as a delivering patient. It is
 * not one, and the two are not the same specialty even.
 *
 * A later revision required female sex plus a recognised obstetric procedure,
 * which fixed the hysterectomy and left a different hole: a one-year-old girl
 * booked for Caesarean section came out VALID, and the obstetric modules
 * loaded. Sex is not enough on its own either.
 *
 * The rule now is: recognised obstetric procedure, sex recorded as female,
 * and — where the recorded age is paediatric — an explicit confirmation from
 * the clinician. No age threshold is invented anywhere; `pediatric` is the
 * band this application already used to choose paediatric airway and fluid
 * behaviour, handed to the catalogue rather than re-derived inside it.
 *
 * Requires-context, not incompatible, is the deliberate choice for the
 * paediatric female: an adolescent obstetric case is real, and the answer is
 * to let it be confirmed rather than to silently accept or silently reject.
 *
 * ── TWO: NO FABRICATED PAEDIATRIC VALUES ──────────────────────────────────
 * The estimate assistant is built and switched off. There is no verified
 * growth dataset in this repository, so growth-reference.js exports null and
 * the component renders nothing at all — not a disabled panel, not a teaser.
 * A control describing a feature the product cannot perform is a promise it
 * does not keep, and on a page whose output is drug doses that is worse than
 * absence. These tests hold that line and, using a stub, also hold the rules
 * that will apply the day real data arrives: never auto-fill, mark what was
 * estimated, and let a measured value win.
 */
const { chromium } = require('/home/user/anestheo-website/node_modules/playwright');
const fs = require('fs');

const REPO = '/home/user/anestheo-website';
const BASE = process.env.NB_BASE || 'http://127.0.0.1:8890';
const MOCK = fs.readFileSync(process.env.NB_MOCK || '/tmp/adm/mock.js', 'utf8');

let pass = 0, fail = 0;
const fmt = d => d === undefined ? '' : (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 180);
const t = (n, ok, d) => {
  if (ok) { pass++; console.log('  ok   ' + n.padEnd(64) + ' ' + fmt(d)); }
  else    { fail++; console.log('  FAIL ' + n.padEnd(64) + ' ' + fmt(d)); }
};

const read = p => fs.readFileSync(REPO + '/' + p, 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const PROC  = read('procedures.js');
const PROCC = code(PROC);
const ENG   = read('engine.html');
const ENGC  = code(ENG);
const GROW  = read('growth-reference.js');
const GROWC = code(GROW);
const IDX   = read('clinical-index.js');

/* Drive one case and report everything that matters about it. */
const CASE = c => `(() => {
  newCase();
  const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
  set('i-age', ${JSON.stringify(c.age)});
  set('i-age-unit', 'y');
  set('i-sex', ${JSON.stringify(c.sex)});
  set('i-height', ${JSON.stringify(c.h || '120')});
  set('i-weight', ${JSON.stringify(c.w || '40')});
  set('i-proc', ${JSON.stringify(c.proc)});
  compute();
  const dom = document.getElementById('output').textContent;
  const p = window.patientContext.procedure;
  return {
    state: p.compatibility,
    recognized: p.recognized,
    specialty: p.specialty,
    obstetric: window.patientContext.context.obstetric,
    /* the three things that must never appear without obstetric context */
    caesarean: /Caesarean section/.test(dom),
    labour:    /Labour mix/.test(dom),
    uterotonic: /Uterotonic|xytocin|rgometrine|arboprost/.test(dom),
    panel: !!document.querySelector('.panel[data-pk="obstetric"]'),
    confirmOffered: !!document.querySelector('.proc-confirm'),
    notice: (document.getElementById('proc-notice').innerText || '').replace(/\\s+/g,' ').trim()
  };
})()`;

async function openEngine(b, viewport) {
  const ctx = await b.newContext({ viewport: viewport || { width:1440, height:1150 } });
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
  await pg.goto(BASE + '/engine.html', { waitUntil:'domcontentloaded' }).catch(() => {});
  await pg.waitForTimeout(1300);
  return { ctx, pg, errs };
}

(async () => {
  console.log('\n=== LIVE TOOLS CLINICAL LAYERS =============================\n');

  /* ── 1. THE CATALOGUE IS SEPARATE AND CONTAINS NO INVENTED RULE ───────── */
  console.log('1. THE PROCEDURE CATALOGUE');
  t('procedures live in their own file', /root\.ProcedureIndex\s*=/.test(PROCC));
  t('...loaded by Live Tools', /procedures\.js/.test(ENG));
  t('...and not mixed into the drug index',
    !/ProcedureIndex|obstetricOnly|contextTags/.test(IDX));
  t('clinical-index still owns drugs', /var DRUGS\s*=/.test(IDX) && /var PCLASS\s*=/.test(IDX));
  /* No age threshold is asserted by the catalogue. ageApplicability is
     honoured if an entry ever carries one; none does. */
  t('no entry declares an age cutoff', !/ageApplicability\s*:\s*\{/.test(PROCC));
  t('...and the file holds no bare age number at all',
    !/(minYears|maxYears)\s*:\s*\d/.test(PROCC));
  t('pediatric is supplied by the caller, not derived in the catalogue',
    /ctx\.pediatric/.test(PROCC) && !/<\s*16|>=\s*16/.test(PROCC));
  t('Live Tools hands it the band it already used',
    /pediatric\s*:\s*pedsFlag/.test(ENGC));

  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  try {
    const s = await openEngine(b);

    /* ── 2. THE REQUIRED MATRIX ────────────────────────────────────────── */
    console.log('\n2. OBSTETRIC COMPATIBILITY');
    const M = {};
    for (const c of [
      { k:'1y-M-caes',   age:'1',  sex:'M', proc:'Caesarean section', h:'76', w:'10' },
      { k:'1y-F-caes',   age:'1',  sex:'F', proc:'Caesarean section', h:'76', w:'10' },
      { k:'15y-F-caes',  age:'15', sex:'F', proc:'Caesarean section', h:'160', w:'55' },
      { k:'32y-F-caes',  age:'32', sex:'F', proc:'Caesarean section', h:'165', w:'72' },
      { k:'32y-M-caes',  age:'32', sex:'M', proc:'Caesarean section', h:'178', w:'82' },
      { k:'32y-F-hyst',  age:'32', sex:'F', proc:'Hysterectomy',      h:'165', w:'72' },
      { k:'32y-F-gyn',   age:'32', sex:'F', proc:'Gynaecological laparoscopy', h:'165', w:'72' },
      { k:'32y-F-lab',   age:'32', sex:'F', proc:'Labour epidural',   h:'165', w:'72' },
      { k:'no-sex-caes', age:'32', sex:'',  proc:'Caesarean section', h:'165', w:'72' },
      { k:'free-text',   age:'45', sex:'M', proc:'Whipple procedure', h:'178', w:'82' }
    ]) M[c.k] = await s.pg.evaluate(CASE(c));

    const clean = r => !r.caesarean && !r.labour && !r.uterotonic && !r.panel;

    t('1y male + Caesarean is INCOMPATIBLE', M['1y-M-caes'].state === 'incompatible', M['1y-M-caes'].state);
    t('...with zero obstetric clinical content', clean(M['1y-M-caes']), M['1y-M-caes']);
    t('...and the notice names the conflict', /Procedure conflict/.test(M['1y-M-caes'].notice));

    t('1y female + Caesarean is REQUIRES-CONTEXT',
      M['1y-F-caes'].state === 'requires-context', M['1y-F-caes'].state);
    t('...with zero obstetric clinical content until confirmed', clean(M['1y-F-caes']), M['1y-F-caes']);
    t('...and it is confirmable rather than rejected', M['1y-F-caes'].confirmOffered === true);

    t('15y female + Caesarean is REQUIRES-CONTEXT',
      M['15y-F-caes'].state === 'requires-context', M['15y-F-caes'].state);
    t('...with zero obstetric clinical content', clean(M['15y-F-caes']));

    t('32y female + Caesarean is VALID', M['32y-F-caes'].state === 'valid', M['32y-F-caes'].state);
    t('...obstetric context activates from the procedure alone',
      M['32y-F-caes'].obstetric === true);
    t('...and the obstetric content is present',
      M['32y-F-caes'].caesarean && M['32y-F-caes'].labour && M['32y-F-caes'].uterotonic,
      M['32y-F-caes']);
    t('...with no confirmation demanded', M['32y-F-caes'].confirmOffered === false);

    t('32y male + Caesarean is INCOMPATIBLE', M['32y-M-caes'].state === 'incompatible');
    t('...with zero obstetric clinical content', clean(M['32y-M-caes']));

    t('32y female + hysterectomy is VALID and NON-obstetric',
      M['32y-F-hyst'].state === 'valid' && M['32y-F-hyst'].obstetric === false,
      M['32y-F-hyst'].state + '/' + M['32y-F-hyst'].obstetric);
    t('...zero Caesarean, labour or uterotonic content', clean(M['32y-F-hyst']), M['32y-F-hyst']);
    t('...and it is filed as gynaecology, not obstetrics',
      M['32y-F-hyst'].specialty === 'gynaecology', M['32y-F-hyst'].specialty);
    t('gynaecological laparoscopy is likewise non-obstetric',
      M['32y-F-gyn'].obstetric === false && clean(M['32y-F-gyn']));

    t('labour epidural does activate for an adult female',
      M['32y-F-lab'].state === 'valid' && M['32y-F-lab'].obstetric === true);
    t('Caesarean with no sex recorded is REQUIRES-CONTEXT',
      M['no-sex-caes'].state === 'requires-context', M['no-sex-caes'].state);
    t('...with zero obstetric clinical content', clean(M['no-sex-caes']));
    t('an unrecognised procedure is FREE TEXT and claims nothing',
      M['free-text'].state === 'free-text' && M['free-text'].recognized === false &&
      clean(M['free-text']), M['free-text'].state);

    /* ── 3. THE CONFIRMATION IS EXPLICIT, SCOPED AND REVOCABLE ──────────── */
    console.log('\n3. EXPLICIT CONFIRMATION');
    const conf = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','15'); set('i-sex','F'); set('i-height','160'); set('i-weight','55');
      set('i-proc','Caesarean section'); compute();
      const before = { state:window.patientContext.procedure.compatibility,
                       ob:window.patientContext.context.obstetric,
                       caes:/Caesarean section/.test(document.getElementById('output').textContent) };
      document.querySelector('.proc-confirm').click();
      const after = { state:window.patientContext.procedure.compatibility,
                      ob:window.patientContext.context.obstetric,
                      caes:/Caesarean section/.test(document.getElementById('output').textContent) };
      /* a confirmation belongs to the procedure it was given for */
      set('i-proc','Vaginal delivery'); compute();
      const moved = { state:window.patientContext.procedure.compatibility,
                      ob:window.patientContext.context.obstetric };
      /* and never survives a new case */
      set('i-proc','Caesarean section'); compute();
      document.querySelector('.proc-confirm').click();
      newCase();
      set('i-age','15'); set('i-sex','F'); set('i-height','160'); set('i-weight','55');
      set('i-proc','Caesarean section'); compute();
      const fresh = { state:window.patientContext.procedure.compatibility,
                      ob:window.patientContext.context.obstetric };
      return { before, after, moved, fresh };
    })()`);
    t('before confirming: requires-context, nothing loaded',
      conf.before.state === 'requires-context' && !conf.before.ob && !conf.before.caes, conf.before);
    t('confirming makes it valid and loads the references',
      conf.after.state === 'valid' && conf.after.ob && conf.after.caes, conf.after);
    t('the confirmation does not carry to a different procedure',
      conf.moved.state === 'requires-context' && !conf.moved.ob, conf.moved);
    t('...nor survive a new case',
      conf.fresh.state === 'requires-context' && !conf.fresh.ob, conf.fresh);

    /* ── 4. NO FABRICATED PAEDIATRIC VALUES ────────────────────────────── */
    console.log('\n4. PAEDIATRIC ESTIMATE: DEFERRED, NOT FAKED');
    t('the growth reference is its own file', /growth-reference\.js/.test(ENG));
    t('...and exports null', /root\.PEDS_GROWTH_REFERENCE\s*=\s*null/.test(GROWC));
    t('...carrying no numeric table of any kind',
      !/\[\s*[\d.]+\s*,\s*[\d.]+\s*,/.test(GROWC), 'no numeric rows');
    t('the file records which WHO datasets are needed',
      /WHO Child Growth Standards/.test(GROW) && /WHO Growth Reference/.test(GROW));
    t('...their coverage', /birth to 60 months/.test(GROW) && /5 to 19 years/.test(GROW));
    t('...that weight-for-age stops at 10 years',
      /ONLY TO 10 YEARS/.test(GROW));
    t('...that weight and height are separate indicators',
      /weight-for-age/.test(GROW) && /height-for-age/.test(GROW));
    t('...and the recommended representation', /LMS/.test(GROW) && /ageDays/.test(GROW));

    const off = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','3'); set('i-sex','M'); compute();
      const host = document.getElementById('peds-est');
      return { html:host.innerHTML.trim().length, text:host.innerText.trim(),
               tilde:/~/.test(host.innerText), ref:window.PEDS_GROWTH_REFERENCE };
    })()`);
    t('with no dataset the assistant renders nothing at all', off.html === 0, off.html);
    t('...shows no "~x.x" anywhere', off.tilde === false);
    t('...and the reference really is null', off.ref === null, off.ref);

    /* The rules that will apply the day data arrives, held now with a stub so
       they cannot be lost in the gap. The stub is injected at runtime; no
       value from it is ever committed to the repository. */
    console.log('\n5. THE RULES THAT WILL APPLY WHEN DATA ARRIVES');
    const on = await s.pg.evaluate(`(() => {
      window.PEDS_GROWTH_REFERENCE = { source:'TEST STUB — not clinical data',
        lookup:function(){ return { weightKg:14.3, heightCm:96.1, basis:'50th centile' }; } };
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','3'); set('i-sex','M'); compute();
      const host = document.getElementById('peds-est');
      const shown = { text:host.innerText.replace(/\\s+/g,' ').trim(),
                      weightField:document.getElementById('i-weight').value,
                      source:window.patientContext.anthropometrics.weightSource };
      host.querySelector('.pest-b').click();
      const accepted = { weightField:document.getElementById('i-weight').value,
                         source:window.patientContext.anthropometrics.weightSource };
      /* a measured value typed afterwards must win, and lose the mark */
      set('i-weight','16.2');
      document.getElementById('i-weight').dispatchEvent(new Event('input', { bubbles:true }));
      compute();
      const manual = { weightField:document.getElementById('i-weight').value,
                       source:window.patientContext.anthropometrics.weightSource };
      window.PEDS_GROWTH_REFERENCE = null;
      return { shown, accepted, manual };
    })()`);
    t('the offer is labelled as an estimate', /ESTIMATED/i.test(on.shown.text), on.shown.text.slice(0, 90));
    t('...and names its source', /TEST STUB/.test(on.shown.text));
    t('NOTHING is auto-filled', on.shown.weightField === '' && on.shown.source === null, on.shown);
    t('pressing Use accepts the value', on.accepted.weightField === '14.3', on.accepted.weightField);
    t('...and marks it estimated', on.accepted.source === 'estimated', on.accepted.source);
    t('a value typed afterwards wins', on.manual.weightField === '16.2', on.manual.weightField);
    t('...and is recorded as measured, not estimated',
      on.manual.source === 'measured', on.manual.source);

    t('no page errors across every case', s.errs.length === 0, s.errs.slice(0, 3));
    /* ── EVERY PANEL HAS A HOME ─────────────────────────────────────────
       The navigation was re-keyed from equipment categories to the order of a
       case. That is a re-filing, and the thing a re-filing can silently do is
       orphan a module: a panel whose data-domain matches no tab renders for
       nobody and nobody notices, because the page still looks full.

       So this walks every panel actually in the DOM, checks its domain is one
       the strip can reach, and then visits each domain and requires it to
       render something. An empty tab is a regression, not a layout. */
    console.log('\nWORKFLOW NAVIGATION');
    const DOMAINS = ['induction','maintenance','tiva','analgesia','reversal','fluids',
                     'vasopressors','local','drugs','scores','emergency'];
    const nav = await s.pg.evaluate(`(() => {
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      newCase();
      /* an obstetric-capable adult, so every conditional panel exists */
      set('i-age','32'); set('i-sex','F'); set('i-height','165'); set('i-weight','72');
      set('i-proc','Caesarean section'); compute();
      const panels = [...document.querySelectorAll('#output .panel')]
        .map(p => ({ pk:p.getAttribute('data-pk'), dom:p.getAttribute('data-domain') }));
      const tabs = [...document.querySelectorAll('#cmd-strip .cmd-b[data-domain]')]
        .map(a => a.getAttribute('data-domain'));
      return { panels, tabs, dflt: document.getElementById('output').getAttribute('data-domain') };
    })()`);
    t('Induction is the default workspace', nav.dflt === 'induction', nav.dflt);
    t('no panel is orphaned by the re-keying',
      nav.panels.every(p => DOMAINS.indexOf(p.dom) >= 0),
      nav.panels.filter(p => DOMAINS.indexOf(p.dom) < 0));
    t('every workflow domain has a tab',
      DOMAINS.filter(d => d !== 'emergency').every(d => nav.tabs.indexOf(d) >= 0),
      nav.tabs);
    for (const d of DOMAINS) {
      const r = await s.pg.evaluate(`(() => {
        setDomain('${d}');
        const shown = [...document.querySelectorAll('#output .panel')]
          .filter(p => p.offsetParent !== null).map(p => p.getAttribute('data-pk'));
        return { shown, chars: document.getElementById('output').innerText.trim().length };
      })()`);
      t(d + ': renders at least one panel', r.shown.length > 0, r.shown);
    }
    await s.pg.evaluate("setDomain('induction')");

    /* ── LMA AND i-GEL ARE DIFFERENT DEVICES ────────────────────────────
       lmaForWeight() and igelForWeight() are separate helpers with different
       weight bands, and patientContext published `igel: d.lma` — the LMA size
       under the i-gel name — while the derived strip showed one cell labelled
       "LMA / i-gel" carrying only the LMA value. It was right wherever the two
       happen to agree and wrong everywhere else, including at 10 kg, which is
       the paediatric case every screenshot of this page has used.

       A supraglottic airway that is one size too large is not a cosmetic
       defect, so the weights below are the divergence boundaries themselves,
       not a convenient sample. */
    console.log('\nLMA / i-GEL INDEPENDENCE');
    const AIRWAY = [
      { w:7,  lma:'1.5', igel:'1.5' },   /* agree */
      { w:10, lma:'2',   igel:'1.5' },   /* diverge */
      { w:15, lma:'2',   igel:'2'   },   /* agree */
      { w:22, lma:'2.5', igel:'2'   },   /* diverge */
      { w:55, lma:'4',   igel:'3'   },   /* diverge */
      { w:75, lma:'5',   igel:'4'   }    /* diverge */
    ];
    for (const a of AIRWAY) {
      const r = await s.pg.evaluate(`(() => {
        newCase();
        const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
        set('i-age','10'); set('i-age-unit','y'); set('i-sex','M');
        set('i-height','120'); set('i-weight','${a.w}');
        compute();
        const P = window.patientContext.pediatric;
        const cells = [...document.querySelectorAll('#cw-derived .cw-d')].map(d => ({
          l: d.querySelector('.cw-d-l').textContent.trim().toLowerCase(),
          v: d.querySelector('.cw-d-val').textContent.trim() }));
        const get = n => { const c = cells.find(c => c.l === n); return c ? c.v : null; };
        const flat = document.getElementById('output').textContent.replace(/\\s+/g, ' ');
        /* The panel emits "LMA size2.5i-gel size2 (small ped)" — label and
           value are adjacent nodes with no separating text, so the space this
           regex first demanded never existed and both captures came back null
           while the values on screen were correct. */
        const pm = /LMA size\\s*([0-9.]+)/.exec(flat), pi = /i-gel size\\s*([0-9.]+)/.exec(flat);
        return { ctxLma:P.lma, ctxIgel:P.igel, stripLma:get('lma'), stripIgel:get('i-gel'),
                 panelLma: pm ? pm[1] : null, panelIgel: pi ? pi[1] : null,
                 combined: cells.some(c => /lma \\/ i-gel/.test(c.l)) };
      })()`);
      const tag = a.w + 'kg';
      t(tag + ': patientContext carries both, independently',
        r.ctxLma === a.lma && r.ctxIgel === a.igel, { lma:r.ctxLma, igel:r.ctxIgel });
      t(tag + ': the strip shows LMA ' + a.lma + ' and i-gel ' + a.igel,
        r.stripLma === a.lma && r.stripIgel === a.igel, { lma:r.stripLma, igel:r.stripIgel });
      t(tag + ': the airway panel agrees with the strip',
        r.panelLma === a.lma && r.panelIgel === a.igel, { lma:r.panelLma, igel:r.panelIgel });
      t(tag + ': no combined "LMA / i-gel" cell remains', r.combined === false);
    }
    /* The defect could only exist because one value fed two names. */
    t('patientContext never assigns igel from lma', !/igel\s*:\s*d\.lma/.test(ENGC));
    t('...and each comes from its own helper',
      /_pedsLMA\s*=\s*lmaForWeight/.test(ENGC) && /_pedsIgel\s*=\s*\(igelForWeight/.test(ENGC));

    await s.ctx.close();

    /* ── 6. THE FIRST SCREEN ───────────────────────────────────────────── */
    console.log('\n6. HIERARCHY AND TERMINOLOGY');
    for (const w of [1440, 390]) {
      const v = await openEngine(b, { width:w, height:w === 1440 ? 1200 : 844 });
      const g = await v.pg.evaluate(`(() => {
        const set = (i,x) => { const e = document.getElementById(i); if (e) e.value = x; };
        set('i-age','1'); set('i-sex','M'); set('i-height','76'); set('i-weight','10');
        set('i-asa','I'); set('i-proc','Inguinal hernia'); compute();
        const y = e => e ? Math.round(e.getBoundingClientRect().top + scrollY) : null;
        const cs = document.getElementById('case-state');
        /* \\s, not \s. This line lives inside a template literal, where
           JavaScript resolves \s to a bare "s" before the browser ever sees
           it — so /\s+/ became /s+/ and the assertion quietly deleted every
           lowercase s from the text it was checking ("Current ca e"). */
        return { caseText:cs.textContent.replace(/\\s+/g,' ').trim(),
                 caseClipped: cs.scrollWidth > cs.clientWidth + 1,
                 caseScroll: cs.scrollWidth, caseClient: cs.clientWidth,
                 grid:y(document.querySelector('.ws-grid')),
                 timers:y(document.getElementById('live-timers')),
                 pacu:y(document.querySelector('.pacu-mod')),
                 newPatient:(function(){ var e=document.querySelector('.case-np');
                   return !!e && getComputedStyle(e).display !== 'none'; })(),
                 newPatientPresent:!!document.querySelector('.case-np'),
                 newPatientHidden:(function(){ var e=document.querySelector('.case-np');
                   return !!e && e.hidden === true; })(),
                 domains:document.querySelectorAll('#cmd-strip .cmd-b').length,
                 /* A table above 900px, cards below it — counting only rows
                    reported an empty drug reference on a phone, where it is
                    simply a different shape. Count whichever it rendered. */
                 drugRows:(document.querySelectorAll('.dtab tbody tr.dtab-r').length ||
                           (document.getElementById('dref-body')||{children:[]}).children.length),
                 chips:[...document.querySelectorAll('.dref-cat')].map(c => c.innerText.split('\\n')[0].trim()),
                 overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      t(w + ': the workstation precedes the timers', g.grid < g.timers, [g.grid, g.timers]);
      t(w + ': ...and precedes PACU', g.grid < g.pacu, [g.grid, g.pacu]);
      /* NO SESSION IN THIS SUITE, so the correct answer here is HIDDEN. New
         Patient is patient management and it is gated on the same rule the
         dashboard uses; an anonymous visitor gets the whole workstation and
         not that one action. The authorized case — button present, and the
         created row owned by the authenticated uid — is driven in
         new-patient-modal.test.js, which signs in. */
      t(w + ': New Patient is NOT offered without a session', g.newPatient === false);
      t(w + ': ...but the button exists and is gated, not deleted',
        g.newPatientPresent === true && g.newPatientHidden === true,
        { present:g.newPatientPresent, hidden:g.newPatientHidden });
      t(w + ': ...and the rest of Live Tools is fully available',
        g.domains > 0 && g.drugRows > 0, { domains:g.domains, drugRows:g.drugRows });
      /* ADDING THAT BUTTON BROKE THE CASE LINE ON A PHONE. Three controls
         beside an ellipsised summary left it about six characters, so 390px
         read "CURREN" and nothing else. The bar wraps below 900px now, and
         this asserts the summary is fully rendered rather than clipped —
         which is the property the ellipsis was silently destroying. */
      t(w + ': the case summary is not clipped', g.caseClipped === false,
        { text:g.caseText, scroll:g.caseScroll, client:g.caseClient });
      t(w + ': ...and still names the patient and procedure',
        /1y/.test(g.caseText) && /Inguinal hernia/i.test(g.caseText), g.caseText);
      t(w + ': Opioids, never Narcotics',
        g.chips.some(c => /OPIOIDS/i.test(c)) && !g.chips.some(c => /NARCOTIC/i.test(c)), g.chips);
      t(w + ': Neuromuscular blockers, never Relaxants',
        g.chips.some(c => /NEUROMUSCULAR|NMB/i.test(c)) && !g.chips.some(c => /RELAXANT/i.test(c)));
      t(w + ': nothing overflows', g.overflow <= 0, g.overflow);
      await v.ctx.close();
    }
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
