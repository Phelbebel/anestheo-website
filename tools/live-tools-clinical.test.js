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
const IND   = read('induction.js');
const INDC  = code(IND);

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

    /* ── EVERY WORKSPACE NAMES ITSELF ───────────────────────────────────
       A tab that only filters is a filter. Each workspace now states what it
       is and what it holds, and the eight phases of a case are numbered in
       the order they happen — the same numbering the Induction sections use,
       because this is one workstation with a sequence rather than eleven
       unrelated pages.

       The lead is CHROME. It describes what is on the tab. If one of these
       lines ever starts naming a drug or quoting a dose it has become
       unreviewed clinical content in a string literal, which is asserted
       against below. */
    console.log('\nWORKSPACE LEADS');
    const leads = await s.pg.evaluate(`(() => {
      const out = {};
      Object.keys(DOMAIN_LEAD).forEach(d => {
        if (!setDomain(d)) { out[d] = null; return; }
        const n = document.querySelector('#wf-lead .wfl-n');
        out[d] = { num:n ? n.textContent : null,
                   title:(document.querySelector('#wf-lead .wfl-t')||{}).textContent||'',
                   sub:(document.querySelector('#wf-lead .wfl-s')||{}).textContent||'',
                   tag:(document.querySelector('#wf-lead .wfl-tag')||{}).textContent||'',
                   folded:document.querySelectorAll('.panel.head-folded').length,
                   panels:[...document.querySelectorAll('.panel[data-domain="'+d+'"]')].length };
      });
      setDomain('induction');
      return out;
    })()`);
    const doms = Object.keys(leads);
    t('every workflow domain has a lead', doms.every(d => leads[d] && leads[d].title &&
      leads[d].sub), doms.filter(d => !leads[d] || !leads[d].title || !leads[d].sub));
    /* "Phase 3", not a bare 3 in a circle — the circle is what the Induction
       sections use for their steps, and on a phone the two sat touching. */
    t('the eight phases of a case are numbered in order',
      ['induction','maintenance','tiva','analgesia','reversal','fluids','vasopressors','local']
        .map(d => leads[d].num).join(',') ===
      'Phase 1,Phase 2,Phase 3,Phase 4,Phase 5,Phase 6,Phase 7,Phase 8',
      ['induction','maintenance','tiva','analgesia','reversal','fluids','vasopressors','local']
        .map(d => d + ':' + leads[d].num));
    /* Reachable at ANY point in the case, so they are not a step in it. The
       brief is explicit that the drug reference must not live inside
       Induction, and an unnumbered top-level tab is what that means. */
    t('drug reference, scores and emergency carry no phase number',
      ['drugs','scores','emergency'].every(d => leads[d].num === null),
      ['drugs','scores','emergency'].map(d => d + ':' + leads[d].num));
    t('the drug reference is a workspace of its own, not a section of Induction',
      leads.drugs.panels > 0 &&
      /data-domain="drugs"/.test(ENGC) && !/drug-reference'\s*:\s*'induction'/.test(ENGC));

    /* NO CLINICAL CONTENT IN THE CHROME. A lead may say the tab holds
       opioids; it may not say how much of one. */
    const leadText = doms.map(d => leads[d].title + ' ' + leads[d].sub).join(' ');
    t('no lead quotes a dose', !/\d+\s*(mg|mcg|microgram|ng|mL|units?)\b/i.test(leadText),
      leadText);
    t('no lead names a drug',
      !/propofol|ketamine|rocuronium|suxamethonium|fentanyl|morphine|adrenaline|sugammadex/i
        .test(leadText));

    /* THE FOLDED HEAD. Where the only panel repeated the workspace title, the
       head is folded and its tag moves into the lead. Where the head carries
       a control it is never folded — the drug reference's Table/Cards switch
       lives in that slot and folding would take a working control off the
       page. */
    t('a single panel repeating the workspace title folds its head',
      leads.tiva.folded === 1 && leads.tiva.tag === 'Reference',
      { folded:leads.tiva.folded, tag:leads.tiva.tag });
    t('...and a workspace of several panels folds none',
      leads.maintenance.folded === 0 && leads.local.folded === 0);
    const dref = await s.pg.evaluate(`(() => {
      setDomain('drugs');
      const p = document.querySelector('.panel[data-domain="drugs"]');
      const h = p.querySelector('.panel-head');
      const c = document.getElementById('dref-ctl');
      const r = { folded:p.classList.contains('head-folded'),
                  headShown:getComputedStyle(h).display !== 'none',
                  control:!!c && !!c.offsetParent && c.textContent.trim().length > 0,
                  buttons:c ? c.querySelectorAll('button').length : 0 };
      setDomain('induction');
      return r;
    })()`);
    t('the drug reference head is never folded away',
      dref.folded === false && dref.headShown === true, dref);
    t('...so its Table / Cards control is still on the page',
      dref.control === true && dref.buttons > 0, dref);

    /* ── DRUG CLASS COLOURS ─────────────────────────────────────────────
       Three drugs carried no class at all, so they rendered a blank badge
       beside drugs that had one. They have one now.

       The bigger correction is what this palette CLAIMS to be. Five comments
       across two files said the hues follow ISO 26825 "so the colour on
       screen matches the colour on the syringe". They never did — the values
       were chosen for legibility on a dark screen — and a clinician who
       believes that sentence has been invited to confirm an ampoule by its
       colour on a phone. The claim is withdrawn everywhere and asserted gone
       here, because a false safety claim reintroduced by a well-meaning
       comment would look exactly like a comment. */
    console.log('\nDRUG CLASS COLOURS');
    /* The withdrawal note quotes the sentence it is withdrawing, so it is
       excluded before searching. Removing the quote would leave a future
       reader no record of what was corrected or why. */
    const ALLSRC = (ENG + IDX + read('live-tools.css') + IND)
      .replace(/An earlier version of this comment[\s\S]*?nothing more\./, '');
    t('no file claims ISO 26825 syringe-label colours', !/26825/.test(ALLSRC),
      'an ISO 26825 claim is present');
    t('...and none says the screen colour matches the syringe',
      !/matche?s? the colour on the syringe|what is on the syringe/i.test(ALLSRC));
    t('...and the withdrawal itself is still recorded in clinical-index.js',
      /THEY ARE NOT SYRINGE-LABEL COLOURS/.test(IDX) && /26825/.test(IDX));

    const pal = await s.pg.evaluate(`(() => {
      const P = window.ClinicalContent.PCLASS || null;
      const D = window.ClinicalContent.DRUGS;
      const find = n => D.find(d => d.name === n);
      return { classes: P ? Object.keys(P) : null,
               meta: P ? { inhalational:P.inhalational, antiemetic:P.antiemetic,
                           haemostatic:P.haemostatic } : null,
               sevo:(find('Sevoflurane')||{}).pclass,
               onda:(find('Ondansetron')||{}).pclass,
               txa: (find('Tranexamic acid')||{}).pclass,
               /* every previously shipped colour, unchanged */
               kept: P ? [P.induction.color, P.benzo.color, P.opioid.color, P.nmb.color,
                          P.vasopressor.color, P.anticholinergic.color, P.local.color,
                          P.uterotonic.color, P.reversal.color].join(',') : null };
    })()`);
    t('Sevoflurane is an inhalational anaesthetic', pal.sevo === 'inhalational', pal.sevo);
    t('Ondansetron is an antiemetic', pal.onda === 'antiemetic', pal.onda);
    t('Tranexamic acid is a haemostatic / antifibrinolytic',
      pal.txa === 'haemostatic', pal.txa);
    t('the three classes carry the labels that were asked for',
      pal.meta.inhalational.label === 'Inhalational anaesthetic' &&
      pal.meta.antiemetic.label === 'Antiemetic' &&
      pal.meta.haemostatic.label === 'Haemostatic / Antifibrinolytic',
      pal.meta);
    /* THE POINT OF THE WHOLE DECISION: adding classes must not restyle the
       established ones. This is the exact shipped string. */
    t('no established class colour moved',
      pal.kept === '#FFD84D,#FFA23E,#6BB6FF,#FF7A6B,#C79BFF,#4FE39B,#C3D2CD,#FFFFFF,#5FE0A4',
      pal.kept);

    /* Contrast, computed rather than asserted from memory. Same rule the
       comment states: AA against the ground the badge is actually drawn on. */
    const contrast = await s.pg.evaluate(`(() => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
      const lum = ([r,g,b]) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
      const hex = h => [1,3,5].map(i => parseInt(h.substr(i,2),16));
      const page = [10,20,28];
      const over = (f,a,b) => f.map((v,i) => v*a + b[i]*(1-a));
      const ground = over([255,255,255], 0.024, page);
      const P = window.ClinicalContent.PCLASS;
      const out = {};
      Object.keys(P).forEach(k => {
        const c = hex(P[k].color);
        const l1 = lum(c), l2 = lum(over(c, 0.15, ground));
        out[k] = +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2));
      });
      return out;
    })()`);
    const belowAA = Object.keys(contrast).filter(k => contrast[k] < 4.5);
    t('every class colour clears WCAG AA on the badge ground',
      belowAA.length === 0, belowAA.map(k => k + ' ' + contrast[k]));

    /* Colour is never the only cue — the badge carries the class in text. */
    t('the badge renderer always emits the class name, not colour alone',
      /m\.short/.test(code(IDX)));

    /* ── THE INDUCTION WORKSTATION ──────────────────────────────────────
       induction.js composes; it must never decide. Three properties keep it
       honest, and each one is a rule the brief set explicitly:

         a strategy changes emphasis and order, never a dose or a drug
         an adult renders no paediatric section at all, not a hidden one
         every number traces to clinical-index.js or to compute()

       The first two are asserted against the live DOM, because a promise in
       a comment is not a guarantee. The third is asserted against the source,
       because the way this screen would go wrong is by growing a dose table
       of its own — and that is visible in the file long before it is visible
       on screen. */
    console.log('\nINDUCTION WORKSTATION');

    const ind = sel => `[...document.querySelectorAll('#induction-host ${sel}')]`;
    const planSnapshot = `(() => {
      const m = {};
      ${ind('.idc')}.forEach(c => {
        const n = (c.querySelector('.idc-name') || {}).textContent;
        /* \\s, not \s — template literal. This one still CAUGHT drift, because
           before and after went through the same broken normalisation, but it
           printed dose text with every letter s missing when it reported. */
        const d = (c.querySelector('.idc-dose') || {}).textContent.replace(/\\s+/g, ' ').trim();
        m[n + '@' + ((c.closest('.wf-sec').querySelector('.wf-n')) || {}).textContent] = d;
      });
      return m;
    })()`;

    /* An adult. Section 6 is paediatric and must not exist in any form. */
    const adult = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      compute();
      const host = document.getElementById('induction-host');
      return { nums: ${ind('.wf-sec .wf-n')}.map(n => n.textContent),
               pedsNodes: ${ind('.pdx, .pdx-grid')}.length,
               pedsWords: /EBV|Maintenance|Paediatric context/.test(host.textContent),
               plan: ${planSnapshot},
               refScrolls: (() => { const r = host.querySelector('.idref');
                 return !!r && getComputedStyle(r).overflowY === 'auto'; })(),
               emphasised: ${ind('.idc.on')}.length };
    })()`);
    t('adult: the workstation renders its sections in case order',
      adult.nums.join(',') === '1,2,3,4,5,7', adult.nums);
    t('adult: the paediatric section does not exist — not hidden, absent',
      adult.pedsNodes === 0 && adult.pedsWords === false,
      { nodes:adult.pedsNodes, words:adult.pedsWords });
    t('adult: nothing is emphasised before a strategy is chosen',
      adult.emphasised === 0, adult.emphasised);
    t('adult: the induction reference scrolls in its own box',
      adult.refScrolls === true);

    /* Choosing a strategy. Emphasis and order may move; a dose may not. */
    const after = await s.pg.evaluate(`(() => {
      const b = ${ind('.ist')}.find(x => /Classic RSI/.test(x.textContent));
      b.click();
      return { plan: ${planSnapshot},
               emphasised: ${ind('.idc.on')}.length,
               pressed: ${ind('.ist')}.map(x => x.getAttribute('aria-pressed')),
               /* Scoped to the CONTROLS AND CARDS, not the prose. The
                  strategy note contains the word "recommending" precisely
                  because it says the application does not do it, and a test
                  that fails on a disclaimer would push us to delete the
                  disclaimer. What must not exist is a pathway or a drug
                  wearing the label. */
               labelled: [...${ind('.ist')}, ...${ind('.idc-top')},
                          ...${ind('.wf-t')}, ...${ind('.rsi-h')}]
                 .some(e => /recommend|preferred|suggested|first.line|drug of choice/i
                   .test(e.textContent)) };
    })()`);
    const drifted = Object.keys(adult.plan)
      .filter(k => !(k in after.plan) || after.plan[k] !== adult.plan[k]);
    const gone  = Object.keys(adult.plan).filter(k => !(k in after.plan));
    const extra = Object.keys(after.plan).filter(k => !(k in adult.plan));
    t('strategy: not one dose changes', drifted.length === 0, drifted);
    t('strategy: no drug is removed and none is added',
      gone.length === 0 && extra.length === 0, { gone, extra });
    t('strategy: it does change emphasis, or it would do nothing',
      after.emphasised > 0 && after.pressed.filter(p => p === 'true').length === 1,
      { on:after.emphasised, pressed:after.pressed });
    t('strategy: no pathway or drug is labelled recommended or preferred',
      after.labelled === false);

    const back = await s.pg.evaluate(`(() => {
      ${ind('.ist')}.find(x => x.getAttribute('aria-pressed') === 'true').click();
      return { plan: ${planSnapshot}, emphasised: ${ind('.idc.on')}.length };
    })()`);
    t('strategy: pressing the chosen one clears it, restoring every dose',
      back.emphasised === 0 &&
      JSON.stringify(back.plan) === JSON.stringify(adult.plan));

    /* A child. Section 6 appears, and its values are the ones compute()
       published — the same ones the derived strip is showing. */
    const child = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','4'); set('i-age-unit','y'); set('i-sex','F');
      set('i-height','103'); set('i-weight','22');
      compute();
      const P = window.patientContext.pediatric;
      const pdx = {};
      ${ind('.pdx')}.forEach(d => {
        pdx[d.querySelector('.pdx-l').textContent.trim()] =
          d.querySelector('.pdx-v').firstChild.textContent.trim(); });
      return { nums: ${ind('.wf-sec .wf-n')}.map(n => n.textContent), pdx,
               ctxLma:P.lma, ctxIgel:P.igel,
               airway: window.airwayPlan };
    })()`);
    t('child: the paediatric section appears, in position 6',
      child.nums.join(',') === '1,2,3,4,5,6,7', child.nums);
    /* 22 kg is a divergence weight: LMA 2.5, i-gel 2. If the workstation ever
       recomputed instead of reading compute(), this is where it would show. */
    t('child: paediatric LMA and i-gel match patientContext at 22 kg',
      child.pdx['LMA'] === child.ctxLma && child.pdx['i-gel'] === child.ctxIgel &&
      child.pdx['LMA'] === '2.5' && child.pdx['i-gel'] === '2',
      { shown:{ lma:child.pdx['LMA'], igel:child.pdx['i-gel'] },
        ctx:{ lma:child.ctxLma, igel:child.ctxIgel } });
    t('child: the airway plan is published and carries both devices',
      !!child.airway && child.airway.lma === '2.5' &&
      /^2\b/.test(String(child.airway.igel)),
      child.airway);

    /* THE SOURCE RULE. The workstation may read the clinical data; it may not
       become clinical data. A dose literal here would be a second source of
       truth that no drug-table test would ever check. */
    t('induction.js declares no dose of its own',
      !/\b(mg|mcg|microgram|units?)\s*\/\s*kg\b/i.test(INDC) &&
      !/\bdoses\s*:/.test(INDC), 'a dose literal appeared in induction.js');
    t('...and reads every drug through visibleDrugsInGroup',
      /visibleDrugsInGroup/.test(INDC));
    t('...and every airway value through window.airwayPlan',
      /root\.airwayPlan/.test(INDC) &&
      !/lmaForWeight|igelForWeight|neoETT/.test(INDC));
    t('...and no strategy is chosen by default',
      /var chosen = null/.test(INDC));
    t('engine.html fills the workstation after it builds the host',
      ENGC.indexOf('id="induction-host"') < ENGC.indexOf('window.Induction.render()'));

    /* ── THE CASE HEADER AND THE READING ORDER ──────────────────────────
       Six inputs, two accordions and a seven-cell derived band stood between
       the top of the page and the first clinical answer — 560px of a 1440
       screen spent on values the clinician had just finished typing. The
       phone already folded the form behind one line; the desktop kept it
       open permanently.

       Nothing is deleted. The header states the same values and IS the
       control that brings the form back, and the derived band never folds,
       because those numbers are how a clinician checks the dose on screen
       belongs to the patient in front of them. */
    console.log('\nTHE CASE HEADER');
    const hdr = await s.pg.evaluate(`(() => {
      newCase();
      const app = document.getElementById('app');
      const form = () => !!document.getElementById('acc-patient').offsetParent;
      const derived = () => !!document.getElementById('cw-derived').offsetParent;
      const out = { emptyForm:form() };
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75'); set('i-asa','II');
      set('i-proc','Laparoscopic cholecystectomy');
      compute(); ptSummary();
      out.liveForm = form(); out.liveDerived = derived();
      out.live = app.classList.contains('case-live');
      out.workstationY = Math.round(
        document.querySelector('.ws-grid').getBoundingClientRect().top + window.pageYOffset);
      out.noticeH = Math.round(document.querySelector('.eng-notice').getBoundingClientRect().height);
      out.caseText = document.querySelector('.case-state').textContent;
      document.getElementById('case-state').click();
      out.openedForm = form(); out.ageKept = document.getElementById('i-age').value;
      document.getElementById('case-state').click();
      out.closedAgain = form();
      /* a value edited through the reopened form still drives everything */
      document.getElementById('case-state').click();
      const w = document.getElementById('i-weight'); w.value = '40'; compute(); ptSummary();
      out.reweighed = (document.querySelector('#induction-host .idc-amt')||{}).textContent||'';
      out.headerFollowed = /40 kg/.test(document.querySelector('.case-v').textContent);
      document.getElementById('case-state').click();
      return out;
    })()`);
    t('an empty page shows the form — there would be no way in otherwise',
      hdr.emptyForm === true);
    t('a live case folds it, at 1440 as well as on a phone',
      hdr.live === true && hdr.liveForm === false, hdr);
    t('...but never the derived band', hdr.liveDerived === true);
    t('...and the header still states every value',
      /42y/.test(hdr.caseText) && /75 kg/.test(hdr.caseText) && /175 cm/.test(hdr.caseText) &&
      /ASA II/.test(hdr.caseText) && /Laparoscopic cholecystectomy/.test(hdr.caseText),
      hdr.caseText);
    t('the header is the control: pressing it brings the form back',
      hdr.openedForm === true && hdr.ageKept === '42' && hdr.closedAgain === false, hdr);
    t('...and a value edited there still drives every dose',
      /60/.test(hdr.reweighed) && hdr.headerFollowed === true,
      { propofolAt40kg:hdr.reweighed, header:hdr.headerFollowed });
    /* The whole point of the exercise. Measured at 1440x1250 before this
       pass: 560. */
    t('the workstation begins in the first screenful',
      hdr.workstationY < 400, hdr.workstationY);
    t('the professional notice is kept but no longer dominates',
      hdr.noticeH < 60, hdr.noticeH);

    /* ── THE READING ORDER WITHIN A SECTION ─────────────────────────────
       Rank is asserted as a RELATIONSHIP, not as a pixel count, so a later
       type change has to preserve the hierarchy rather than match a number.
       A section heading was 19px and a drug name inside it 16px — near enough
       the same rank that the page read as one flat list. */
    console.log('\nTYPE HIERARCHY');
    const rank = await s.pg.evaluate(`(() => {
      const px = (sel, prop) => { const e = document.querySelector(sel);
        return e ? parseFloat(getComputedStyle(e)[prop || 'fontSize']) : null; };
      return { lead:px('.wfl-t'), heading:px('#output .wf-t'),
               drug:px('.idc-name'), amount:px('.idc-amt'),
               rule:px('.idc-rule'), label:px('.idc-route'),
               airwayValue:px('.awp-v'), airwayLabel:px('.awp-l'),
               timer:px('.ws-rail .lt-time'), timerLabel:px('.ws-rail .lt-head') };
    })()`);
    t('the workspace lead outranks a section heading', rank.lead > rank.heading, rank);
    t('a section heading outranks a drug name inside it', rank.heading > rank.drug, rank);
    t('a drug name outranks its own labels', rank.drug > rank.label, rank);
    /* The amount for THIS patient is what gets drawn up, so it is the largest
       thing on the card — larger than the per-kg rule it came from. */
    t('the patient amount is the largest thing on a drug card',
      rank.amount > rank.drug && rank.amount > rank.rule, rank);
    t('an airway size outranks its device label', rank.airwayValue > rank.airwayLabel, rank);
    t('a running time is the largest thing in the timer rail',
      rank.timer > rank.timerLabel * 2, rank);

    /* ── COLOUR ANSWERS ONE QUESTION ────────────────────────────────────
       "What kind of drug is this." The class colour was a 3px rule on the
       left edge, which is three pixels of answer. It now runs the card's
       header band and its badge — and NOTHING ELSE on the page is coloured
       by it, because a workstation where everything is coloured says
       nothing. */
    console.log('\nSEMANTIC COLOUR');
    const col = await s.pg.evaluate(`(() => {
      const cards = [...document.querySelectorAll('#induction-host .idc')];
      const seen = {};
      cards.forEach(c => { seen[getComputedStyle(c).getPropertyValue('--pc').trim()] = 1; });
      const first = cards[0];
      return { cards:cards.length, distinctColours:Object.keys(seen).filter(Boolean).length,
               bandTinted:getComputedStyle(first.querySelector('.idc-top')).backgroundColor,
               badgeFilled:getComputedStyle(first.querySelector('.pc')).backgroundColor,
               everyCardNamesItsClass:cards.every(c => {
                 const b = c.querySelector('.pc');
                 return !!b && b.textContent.trim().length > 0; }),
               dimmed:getComputedStyle(cards[0]).opacity };
    })()`);
    t('drug cards carry several distinct class colours',
      col.distinctColours >= 4, col.distinctColours);
    t('...the class band is tinted with the card colour, not a hairline',
      !/rgba\(0, 0, 0, 0\)/.test(col.bandTinted), col.bandTinted);
    t('...the badge is filled with it', !/rgba\(0, 0, 0, 0\)/.test(col.badgeFilled),
      col.badgeFilled);
    /* COLOUR IS NEVER THE ONLY CUE — the same rule clinical-index.js states. */
    t('...and every card still names its class in text',
      col.everyCardNamesItsClass === true);

    /* ── THE AIRWAY PLAN IS READ BY SHAPE ───────────────────────────────
       These were emoji: a microscope for the laryngoscope, a spool of thread
       for the ETT, a droplet for the LMA. They rendered differently on every
       platform and none was the object it stood for. */
    const awp = await s.pg.evaluate(`(() => {
      const tiles = [...document.querySelectorAll('#induction-host .awp')];
      return { tiles:tiles.length,
               drawn:tiles.filter(x => x.querySelector('.awp-i svg')).length,
               namedInText:tiles.every(x => (x.querySelector('.awp-l')||{}).textContent.trim()),
               iconsHidden:tiles.every(x => x.querySelector('.awp-i')
                 .getAttribute('aria-hidden') === 'true'),
               /* A SENTENCE MUST NOT BE SET AS THOUGH IT WERE A SIZE.
                  Measured on the VALUE, not on value-plus-unit: appending
                  "mm ID" to "8.0 (7.5–8.5)" makes an 18-character string out
                  of a perfectly good number, and that number belongs at
                  number size. The test that got this wrong first asserted
                  the opposite of what the rule says. */
               phrases:(() => {
                 const vals = [...document.querySelectorAll('#induction-host .awp-v')]
                   .map(v => ({ txt:v.childNodes[0].textContent.trim(),
                                long:v.classList.contains('awp-long') }));
                 /* A LOWERCASE WORD, not any four letters. "Size 4 (90 mm)"
                    is a size that happens to contain the word Size, and it
                    belongs at number size; "Yankauer" and "Appropriate size"
                    are prose. Capital-initial words are how a size names
                    itself, so the run has to be lowercase to count. */
                 const prose = t => /[a-z]{4}/.test(t);
                 return { wordy:vals.filter(v => prose(v.txt)),
                          numeric:vals.filter(v => !prose(v.txt)) };
               })() };
    })()`);
    t('every airway tile carries a drawn device icon',
      awp.tiles > 0 && awp.drawn === awp.tiles, awp);
    t('...and still names its device in text', awp.namedInText === true);
    t('...with the drawings hidden from a screen reader', awp.iconsHidden === true);
    t('a phrase is not set as though it were a size',
      awp.phrases.wordy.length > 0 && awp.phrases.wordy.every(v => v.long),
      awp.phrases.wordy.filter(v => !v.long));
    t('...and a size still is, however long it prints',
      awp.phrases.numeric.length > 0 && awp.phrases.numeric.every(v => !v.long),
      awp.phrases.numeric.filter(v => v.long));

    /* ── THE INLINE CRISIS PREVIEW ──────────────────────────────────────
       Pressing a protocol used to call setDomain('emergency') and scroll the
       page. The workstation was replaced, the induction plan being read was
       gone, and the scroll position with it — at the one moment there are no
       spare presses. Reading a protocol is now not navigation.

       The tests below are the four ways that could quietly come back: a
       domain change, a scroll, a rebuilt workstation, or a second simplified
       copy of the crisis data drifting away from the real one. */
    console.log('\nINLINE CRISIS PREVIEW');

    /* An adult, scrolled well down the page, so a scroll reset would show. */
    const opened = await s.pg.evaluate(`(() => {
      newCase();
      const set = (i,v) => { const e = document.getElementById(i); if (e) e.value = v; };
      set('i-age','42'); set('i-age-unit','y'); set('i-sex','M');
      set('i-height','175'); set('i-weight','75');
      compute();
      window.scrollTo(0, 800);
      const before = { y:window.pageYOffset,
                       domain:document.getElementById('output').dataset.domain,
                       secs:document.querySelectorAll('#induction-host .wf-sec').length };
      document.querySelectorAll('#ws-crisis .wsc-b')[7].click();   /* Anaphylaxis */
      const h = document.getElementById('crisis-preview');
      return { before,
        after:{ y:window.pageYOffset,
                domain:document.getElementById('output').dataset.domain,
                secs:document.querySelectorAll('#induction-host .wf-sec').length },
        open:!h.hidden,
        title:(h.querySelector('.crisis-emg-t')||{}).textContent||'',
        steps:h.querySelectorAll('.crisis-step').length,
        doses:h.querySelectorAll('.crisis-dose').length,
        switcher:h.querySelectorAll('.cpv-sw').length,
        hasClose:!!h.querySelector('.cpv-x'),
        hasFull:!!h.querySelector('.cpv-full'),
        railMarked:document.querySelectorAll('#ws-crisis .wsc-b.on').length };
    })()`);
    t('one press opens the protocol', opened.open === true &&
      /Anaphylaxis/.test(opened.title), opened.title);
    t('...without changing the workflow domain',
      opened.after.domain === opened.before.domain &&
      opened.after.domain === 'induction', opened.after.domain);
    t('...without moving the page', opened.after.y === opened.before.y,
      { was:opened.before.y, now:opened.after.y });
    t('...and the induction workstation is still on screen behind it',
      opened.after.secs === opened.before.secs && opened.after.secs > 0,
      opened.after.secs);
    t('the protocol carries its steps and its weight-aware doses',
      opened.steps > 0 && opened.doses > 0, opened);
    t('...a close control, and the switcher for every protocol',
      opened.hasClose && opened.switcher === 8, opened.switcher);
    t('...and the index marks which protocol is open', opened.railMarked === 1);

    /* THE SAME DATA, NOT A SIMPLIFIED SECOND COPY. The preview and the full
       panel are rendered from one function over one CRISIS entry, so this
       compares them protocol by protocol rather than trusting that. */
    const same = await s.pg.evaluate(`(() => {
      const bad = [];
      for (let i = 0; i < CRISIS.length; i++){
        const m = crisisMarkup(i);
        crisisPreview(i);
        const h = document.getElementById('crisis-preview');
        const pv = [...h.querySelectorAll('.crisis-step, .crisis-dose')]
          .map(e => e.textContent).join('|');
        crisisInline(i);
        const full = [...document.querySelectorAll('#crisis-inline-body .crisis-step, ' +
          '#crisis-inline-body .crisis-dose')].map(e => e.textContent).join('|');
        if (pv !== full) bad.push(CRISIS[i][1]);
      }
      crisisPreviewClose();
      return { bad, n:CRISIS.length, names:CRISIS.map(c => c[1]), keys:CRISIS.map(c => c[0]) };
    })()`);
    t('the preview and the full panel render identical protocols',
      same.bad.length === 0, same.bad);
    t('there is one crisis renderer, not two',
      /function crisisMarkup/.test(ENGC) &&
      (ENGC.match(/CRISIS\[i\]\[3\]\(w\)/g) || []).length === 1);

    /* OUR PROTOCOLS, NOT THE MOCKUP'S. The design reference showed
       laryngospasm, bronchospasm and massive haemorrhage. This application
       does not carry them, and inventing three protocols to match a picture
       would be the worst possible reason to write a clinical algorithm. */
    t('the eight protocols are unchanged', same.n === 8 &&
      same.keys.join(',') === 'last,mh,brady,tachy,arrest,da,cico,anaph', same.keys);
    t('no protocol was invented to match the design reference',
      !/laryngospasm|bronchospasm|massive h(a)?emorrhage/i.test(same.names.join(' ')),
      same.names);

    /* Replacement, Escape, close — and the ONE control allowed to navigate. */
    const flow = await s.pg.evaluate(`(() => {
      const h = document.getElementById('crisis-preview');
      const out = {};
      crisisPreview(7);
      document.querySelectorAll('.cpv-sw')[0].click();      /* switch to LAST */
      out.replaced = (h.querySelector('.crisis-emg-t')||{}).textContent || '';
      out.copies = document.querySelectorAll('.crisis-preview').length;
      out.domainAfterSwitch = document.getElementById('output').dataset.domain;
      document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      out.escClosed = h.hidden;
      out.railCleared = document.querySelectorAll('#ws-crisis .wsc-b.on').length === 0;
      crisisPreview(2);
      h.querySelector('.cpv-x').click();
      out.xClosed = h.hidden;
      /* by key, the way the induction backup buttons open one */
      out.byKey = crisisPreviewByKey('cico') &&
                  /CICO/.test((h.querySelector('.crisis-emg-t')||{}).textContent||'');
      out.domainAfterKey = document.getElementById('output').dataset.domain;
      /* the explicit secondary action, and only it, leaves for the library */
      h.querySelector('.cpv-full').click();
      out.domainAfterFull = document.getElementById('output').dataset.domain;
      out.fullClosedPreview = h.hidden;
      return out;
    })()`);
    t('choosing another protocol replaces this one', /LAST/.test(flow.replaced) &&
      flow.copies === 1, flow);
    t('...still without navigating', flow.domainAfterSwitch === 'induction');
    t('Escape closes it and clears the index', flow.escClosed && flow.railCleared);
    t('the close button closes it', flow.xClosed === true);
    t('a protocol can be opened by name from the workstation',
      flow.byKey === true && flow.domainAfterKey === 'induction');
    t('"View full protocol" is the one control that goes to the library',
      flow.domainAfterFull === 'emergency' && flow.fullClosedPreview === true, flow);

    /* THE SOURCE RULE. Opening a protocol must not be wired to a domain
       change again. The rail's own buttons are checked directly. */
    const railBtn = /class="wsc-b[\s\S]{0,200}?onclick="([^"]+)"/.exec(ENGC);
    t('the rail buttons preview in place and nothing else',
      !!railBtn && /crisisPreview\(/.test(railBtn[1]) &&
      !/setDomain|crisisJump/.test(railBtn[1]), railBtn && railBtn[1]);
    t('crisisPreview itself never changes domain and never scrolls',
      !/setDomain|scrollTo|scrollIntoView/.test(
        /function crisisPreview\(([\s\S]*?)\n}/.exec(ENGC)[1]));

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

    /* ── 7. THE PHONE ───────────────────────────────────────────────────
       Three things were true on a 390px screen and on no other width, which
       is exactly how they survived: the layout was correct everywhere it was
       being looked at.

         the timer rail was ordered AFTER the workspace, and the workspace on
         a phone is over seven thousand pixels tall, so reaching a stopwatch
         mid-case meant scrolling the entire page

         the Crisis rail withdraws below 1180px and the command strip scrolls
         away with the page, so there was no fixed route to a protocol at all

         the case line was set in uppercase at .12em tracking and took four
         lines and 159px — more of the screen than the first clinical answer

       Each is asserted at the width it breaks at AND at the width it does
       not, because "the timers come first" is only correct on a phone. */
    console.log('\n7. THE PHONE');
    for (const w of [390, 1440]) {
      const v = await openEngine(b, { width:w, height:w === 1440 ? 1200 : 844 });
      const m = await v.pg.evaluate(`(() => {
        const set = (i,x) => { const e = document.getElementById(i); if (e) e.value = x; };
        set('i-age','42'); set('i-sex','M'); set('i-height','175'); set('i-weight','75');
        set('i-asa','II'); set('i-proc','Laparoscopic cholecystectomy'); compute();
        const y = e => e ? Math.round(e.getBoundingClientRect().top + window.pageYOffset) : null;
        const rail = document.querySelector('.ws-rail');
        const out  = document.getElementById('output');
        const sos  = document.getElementById('ws-sos');
        const ss   = sos ? getComputedStyle(sos) : null;
        const cs   = document.querySelector('.case-state');
        const csS  = getComputedStyle(cs);
        const before = { y:window.pageYOffset,
                         domain:out.dataset.domain };
        let opened = null;
        if (ss && ss.display !== 'none'){
          window.scrollTo(0, 2000);
          const y0 = window.pageYOffset;
          const r0 = sos.getBoundingClientRect();
          sos.click();
          const h = document.getElementById('crisis-preview');
          opened = { picks:h.querySelectorAll('.cpv-p').length, open:!h.hidden,
                     scrolled:window.pageYOffset - y0,
                     domain:out.dataset.domain,
                     bottomGap:Math.round(window.innerHeight - r0.bottom),
                     inView:r0.bottom <= window.innerHeight && r0.top >= 0 };
          crisisPreviewClose();
          window.scrollTo(0, 0);
        }
        const lt = document.getElementById('live-timers');
        return {
          sosShown:!!ss && ss.display !== 'none',
          sosFixed:ss ? ss.position : null,
          opened,
          railY:y(rail), outY:y(out),
          timersFolded:lt ? !lt.open : null,
          timersH:rail ? Math.round(rail.getBoundingClientRect().height) : null,
          caseH:Math.round(document.querySelector('.case-bar').getBoundingClientRect().height),
          noticeH:Math.round(document.querySelector('.eng-notice').getBoundingClientRect().height),
          /* the two ranks the header claims to have */
          kSize:parseFloat(getComputedStyle(document.querySelector('.case-k')).fontSize),
          vSize:parseFloat(getComputedStyle(document.querySelector('.case-v')).fontSize),
          formShown:!!document.getElementById('acc-patient').offsetParent,
          workstationY:y(document.querySelector('.ws-grid')),
          /* \\s, not \s. This is inside a TEMPLATE LITERAL, where \s is just
             "s" — the first version of this line silently deleted every
             letter s from the case summary and then reported it as clipped. */
          caseText:cs.textContent.replace(/\\s+/g,' ').trim(),
          caseClipped:cs.scrollWidth > cs.clientWidth + 1,
          caseUpper:csS.textTransform,
          /* the phase eyebrow must not look like a section's step number */
          phaseIsCircle:!!document.querySelector('#wf-lead .wf-n'),
          phaseText:(document.querySelector('.wfl-n')||{}).textContent||'',
          overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })()`);

      if (w === 390) {
        t('390: the timers come BEFORE the workspace, not after it',
          m.railY < m.outY, { rail:m.railY, output:m.outY });
        t('390: ...and cost one folded bar until they are wanted',
          m.timersFolded === true && m.timersH < 120, m.timersH);
        t('390: SOS is a fixed control', m.sosShown && m.sosFixed === 'fixed', m.sosFixed);
        t('390: ...on screen after scrolling 2000px', m.opened.inView === true, m.opened);
        t('390: ...clear of the tab bar', m.opened.bottomGap >= 57, m.opened.bottomGap);
        t('390: ...and it opens the eight protocols',
          m.opened.open && m.opened.picks === 8, m.opened);
        t('390: ...without scrolling or changing workspace',
          m.opened.scrolled === 0 && m.opened.domain === 'induction', m.opened);
        /* It was one uppercase run at 10.5px/.12em over four lines and 159px.
           It is now a label and a value at two different sizes — which is the
           whole claim — and smaller than it was despite the value being
           larger, because the tracking is what was costing the height. */
        t('390: the case header is a label and a value, at two ranks',
          m.vSize > m.kSize * 1.4 && m.caseUpper === 'none',
          { label:m.kSize, value:m.vSize, transform:m.caseUpper });
        t('390: ...and costs less than the headline it replaced',
          m.caseH < 150, m.caseH);
        t('390: ...and still says everything, unclipped',
          m.caseClipped === false && /42y/.test(m.caseText) &&
          /Laparoscopic cholecystectomy/i.test(m.caseText) && /ASA II/.test(m.caseText),
          m.caseText);
      } else {
        /* The rail column exists here, so SOS would be a second answer to a
           question already answered on screen. */
        t('1440: SOS stays out of the way where the Crisis rail is',
          m.sosShown === false);
        t('1440: the timers keep their own column beside the workspace',
          m.railY === m.outY, { rail:m.railY, output:m.outY });
      }
      /* THE PHASE IS NOT A STEP. Both were numbered circles, and on a phone
         the workspace lead sits directly above section 1 — two "1" badges
         meaning different things, touching. */
      t(w + ': the phase reads as a phase, not as step one',
        m.phaseIsCircle === false && /^Phase 1$/.test(m.phaseText), m.phaseText);
      t(w + ': nothing overflows sideways', m.overflow <= 0, m.overflow);
      await v.ctx.close();
    }
  } finally {
    await b.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
